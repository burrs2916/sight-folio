use serde::{Deserialize, Serialize};

/// 变更耦合（Change Coupling / Temporal Coupling）：两个文件在版本历史中「总是一起改」
///
/// ## 为什么需要它（现有分析维度都答不了的问题）
///
/// 已有的依赖分析回答的是「谁 import 了谁」——那是**显性耦合**，编译器都知道。
/// 但真正拖垮项目的往往是**隐性耦合**：两个文件之间没有任何 import 关系，
/// 却每次都要一起改。典型来源：
///
/// - 前端组件与后端接口契约（改了字段名，两边都要动，静态分析看不见）
/// - 一份配置在多处硬编码复制（改一处必须同步改其它处，否则线上出事）
/// - 抽象泄漏：调用方绕过接口依赖了实现细节
/// - 复制粘贴的孪生代码（克隆检测能抓形似的，抓不到"形不似但命运相同"的）
///
/// 隐性耦合的危害在于**它不会被任何工具提醒**：新人改了 A 不知道要改 B，
/// 于是缺陷从这里溜出去。这正是 CodeScene / Adam Tornhill《Your Code as a Crime
/// Scene》把 change coupling 列为行为代码分析头号指标的原因。
///
/// ## 度量口径
///
/// 设文件 a 出现在 `commits_a` 个提交中，b 出现在 `commits_b` 个，二者共同出现
/// 在 `co_changes` 个提交中：
///
/// - `degree = co_changes / min(commits_a, commits_b)`
///   —— 耦合度。取 min 而非 max，语义是「较少改动的那个文件有多大比例是被另一个
///   拖着一起改的」。这是 CodeScene 采用的口径，对新旧文件混合的仓库更稳健。
/// - `jaccard = co_changes / (commits_a + commits_b - co_changes)`
///   —— 对称相似度，惩罚"一方改动次数远多于另一方"的伪耦合，作为交叉验证。
///
/// ## 与静态依赖交叉
///
/// `is_structural` 表示这对文件之间存在静态依赖（import/use）。据此分两类：
/// - `structural`：有依赖且共变 —— 正常现象，只在耦合度极高时提示"是否该合并"
/// - `hidden`：**无依赖却高共变 —— 隐性耦合，本分析的核心价值所在**
///
/// `cross_module` 表示两者分属不同顶层模块。跨模块的隐性耦合等于「架构边界
/// 已经被绕过了」，风险最高。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeCoupling {
    pub id: String,
    pub analysis_id: String,
    /// 关联 project_files.id（字典序在前的一侧）
    pub file_a_id: String,
    pub file_a_path: String,
    pub file_b_id: String,
    pub file_b_path: String,
    /// 共同出现的提交数
    pub co_changes: i64,
    /// a 单独的提交数
    pub commits_a: i64,
    /// b 单独的提交数
    pub commits_b: i64,
    /// 耦合度 co / min(a, b)，0..1
    pub degree: f64,
    /// Jaccard 相似度 co / (a + b - co)，0..1
    pub jaccard: f64,
    /// 是否存在静态依赖（任一方向）
    pub is_structural: bool,
    /// 是否跨顶层模块
    pub cross_module: bool,
    /// structural | hidden
    pub coupling_kind: String,
    /// low | medium | high | extreme
    pub risk_level: String,
    /// 最近一次共同变更时间（unix 秒）
    pub last_co_change_at: i64,
    pub created_at: i64,
}

impl Default for ChangeCoupling {
    fn default() -> Self {
        Self {
            id: format!(
                "cc_{}",
                uuid::Uuid::new_v4().to_string().replace('-', "")
            ),
            analysis_id: String::new(),
            file_a_id: String::new(),
            file_a_path: String::new(),
            file_b_id: String::new(),
            file_b_path: String::new(),
            co_changes: 0,
            commits_a: 0,
            commits_b: 0,
            degree: 0.0,
            jaccard: 0.0,
            is_structural: false,
            cross_module: false,
            coupling_kind: "structural".to_string(),
            risk_level: "low".to_string(),
            last_co_change_at: 0,
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// 耦合度：共变次数占「改动较少一方」的比例
///
/// 取 min 的理由见结构体文档。分母为 0 时返回 0（不可能发生，防御性处理）。
pub fn degree_of(co_changes: i64, commits_a: i64, commits_b: i64) -> f64 {
    let denom = commits_a.min(commits_b);
    if denom <= 0 {
        return 0.0;
    }
    let d = co_changes as f64 / denom as f64;
    // 理论上 co <= min(a,b)，异常数据（路径归一化后重复计数）钳到 1
    if d > 1.0 {
        1.0
    } else {
        (d * 10000.0).round() / 10000.0
    }
}

/// Jaccard：共变次数占并集的比例，用来识别"一方改得远多于另一方"的伪耦合
pub fn jaccard_of(co_changes: i64, commits_a: i64, commits_b: i64) -> f64 {
    let union = commits_a + commits_b - co_changes;
    if union <= 0 {
        return 0.0;
    }
    let j = co_changes as f64 / union as f64;
    if j > 1.0 {
        1.0
    } else {
        (j * 10000.0).round() / 10000.0
    }
}

/// 顶层模块名（与前端 `topDirOf` 口径一致：relPath 第一段）
pub fn top_dir_of(path: &str) -> &str {
    let p = path.trim_start_matches("./");
    match p.find('/') {
        Some(i) if i > 0 => &p[..i],
        _ => "",
    }
}

/// 风险分级
///
/// 基线由耦合度决定，隐性耦合（无静态依赖）与跨模块各升一级 —— 这两个条件
/// 同时满足时，意味着「架构上本该无关的两个模块，实际上被一根看不见的线拴死」，
/// 是最需要人工介入的情形。
///
/// 同时要求一定的共变基数：只共变 2~3 次的组合统计意义太弱，不允许进 high。
pub fn risk_level_of(degree: f64, co_changes: i64, hidden: bool, cross_module: bool) -> &'static str {
    let mut level = if degree >= 0.8 {
        3
    } else if degree >= 0.6 {
        2
    } else if degree >= 0.4 {
        1
    } else {
        0
    };
    if hidden {
        level += 1;
    }
    if cross_module {
        level += 1;
    }
    // 样本量约束：共变次数少时不允许高等级（统计噪声）
    let cap = if co_changes >= 10 {
        4
    } else if co_changes >= 5 {
        2
    } else {
        1
    };
    if level > cap {
        level = cap;
    }
    match level {
        0 => "low",
        1 => "low",
        2 => "medium",
        3 => "high",
        _ => "extreme",
    }
}

/// 把两个路径排成稳定顺序（保证同一对文件只产生一条记录）
pub fn ordered_pair<'a>(a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degree_uses_min_side() {
        // a 改了 100 次，b 改了 10 次，一起改了 8 次
        // → 对 b 而言 80% 的改动都拖着 a，这才是耦合的实感
        assert!((degree_of(8, 100, 10) - 0.8).abs() < 1e-6);
    }

    #[test]
    fn degree_zero_denominator() {
        assert_eq!(degree_of(5, 0, 10), 0.0);
    }

    #[test]
    fn degree_clamped_to_one() {
        assert_eq!(degree_of(20, 10, 10), 1.0);
    }

    #[test]
    fn jaccard_penalizes_lopsided_pairs() {
        // 同样共变 8 次，Jaccard 会因 a 改动过多而显著低于 degree
        let j = jaccard_of(8, 100, 10);
        assert!(j < 0.1, "jaccard = {}", j);
    }

    #[test]
    fn top_dir_extracts_first_segment() {
        assert_eq!(top_dir_of("src/editor/a.ts"), "src");
        assert_eq!(top_dir_of("./src/a.ts"), "src");
        assert_eq!(top_dir_of("README.md"), "");
    }

    #[test]
    fn hidden_cross_module_escalates() {
        // 同样 0.65 的耦合度：有依赖同模块 = medium；无依赖跨模块 = extreme
        assert_eq!(risk_level_of(0.65, 12, false, false), "medium");
        assert_eq!(risk_level_of(0.65, 12, true, true), "extreme");
    }

    #[test]
    fn small_sample_is_capped() {
        // 只共变 3 次，即便耦合度 100% + 隐性 + 跨模块，也压到 low
        assert_eq!(risk_level_of(1.0, 3, true, true), "low");
        // 共变 6 次最多到 medium
        assert_eq!(risk_level_of(1.0, 6, true, true), "medium");
    }

    #[test]
    fn ordered_pair_is_stable() {
        assert_eq!(ordered_pair("b.ts", "a.ts"), ("a.ts", "b.ts"));
        assert_eq!(ordered_pair("a.ts", "b.ts"), ("a.ts", "b.ts"));
    }
}
