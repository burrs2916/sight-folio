//! 句子字/词数统计：面向检索命中的单句（KWIC），为创作者提供「字数 / 词数」基础数据。
//!
//! 历史背景：本模块曾是完整的句子语言要素分析（jieba 词性标注 + 启发式主谓宾提取 +
//! UDPipe 依存句法校正 + 句式类型推断）。因启发式对复杂句易碎词错判（如「主语:微
//! 谓语:移」）、识别错误反而干扰写作参考，且语法分析复杂度高、AI 能力留给其他场景，
//! 该功能已整体移除；现仅保留稳定可靠的字数 / 词数统计（`count_words` + jieba 分词计数）。

use std::sync::OnceLock;

use jieba_rs::Jieba;
use serde::{Deserialize, Serialize};

use super::pipeline::count_words;

/// 单句的字/词数统计结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceAnalysis {
    /// 字数（与写作域 `count_words` 口径一致：汉字/标点计 1，连续 ASCII 词计 1）。
    pub char_count: i64,
    /// 词数（jieba 切分后的 token 数，含标点）。
    pub token_count: usize,
}

/// 进程级 jieba 单例：首次加载默认词典 + 项目用户词典（人名/昵称等，
/// 修正默认词典缺失导致「萧[nr] 薰[v] 儿[n]」类碎切），此后所有检索复用
/// （避免每次分析重建词典）。
///
/// 用户词典格式：`词 频率 词性` 每行一条（`load_dict` 追加式合并）。
/// 资源文件：`resources/jieba/userdict.txt`，经 `include_str!` 编译期内嵌，
/// dev / test / 打包环境行为一致。
fn jieba() -> &'static Jieba {
    static JIEBA: OnceLock<Jieba> = OnceLock::new();
    JIEBA.get_or_init(|| {
        let mut j = Jieba::new();
        let mut dict = include_str!("../../../resources/jieba/userdict.txt").as_bytes();
        let _ = j.load_dict(&mut dict);
        j
    })
}

/// 统计单句的字数与词数（仅保留语料参考的「N 字 · M 词」展示；语法识别已移除）。
pub fn analyze_sentence(sentence: &str) -> SentenceAnalysis {
    SentenceAnalysis {
        char_count: count_words(sentence),
        token_count: jieba().tag(sentence, false).len(),
    }
}
