//! 语料查重指纹（零依赖）：内容精确指纹 + 近似指纹 + 相似度。
//!
//! 设计取舍：
//! - **不用 `std::hash::DefaultHasher`**：其算法不保证跨 Rust 版本稳定，而指纹要落库
//!   （corpus.db）——版本一变全部失效。改用自实现 FNV-1a：算法由常量完全确定，跨版本/跨平台稳定。
//! - **非加密用途**：只做去重判等，不做安全。128 位足以把碰撞概率压到可忽略。
//! - **「精确」= 归一化（去空白/控制字符）后逐字符相同**：同一本书的 epub/txt/mobi 抽取后行结构
//!   不同，但去空白后一致 → 精确指纹直接命中；排版/标点不同的版本靠 SimHash 近似命中。

/// FNV-1a 64 位 offset basis（标准值）。
const FNV_OFFSET_BASIS_64: u64 = 0xcbf2_9ce4_8422_2325;
/// FNV-1a 64 位 prime（标准值）。
const FNV_PRIME_64: u64 = 0x0000_0100_0000_01b3;
/// 第二路 offset basis：标准值异或黄金比例常量，产出与第一路独立的哈希（合起来构成 128 位）。
const FNV_ALT_BASIS_64: u64 = FNV_OFFSET_BASIS_64 ^ 0x9E37_79B9_7F4A_7C15;

/// SimHash 词元（shingle）长度：字符 3-gram，中英通用。
const SHINGLE_CHARS: usize = 3;

/// SimHash 判定「近似重复」的最大海明距离（64 位中允许 16 位不同 ≈ 相似度 ≥ 75%）。
///
/// 取 16 的依据：无关文本的期望距离 ≈ 32（64 位各半，σ≈4），16 距其 4σ 以上，几乎不会误报；
/// 而同一本书的不同版本/排版（局部差异）实测距离通常在个位数，能被稳定命中。相似度会一并展示，
/// 供用户自行判断（阈值只决定"是否提示"，不决定"是否阻断"）。
pub const SIMHASH_NEAR_DUP_MAX_DISTANCE: u32 = 16;

/// 归一化：去掉所有空白与控制字符，**保留标点与大小写**。
///
/// 去空白是关键：同一本书不同格式（epub 的块级换行 / txt 的 CRLF）抽取后行结构不同，
/// 去空白后逐字符一致 → 精确指纹可直接命中。保留大小写与标点：它们是内容差异，不该抹平。
pub fn normalize_for_hash(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && !c.is_control())
        .collect()
}

/// FNV-1a 64 位哈希（`basis` 决定独立的一路输出）。
fn fnv1a_64(bytes: &[u8], basis: u64) -> u64 {
    let mut h = basis;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(FNV_PRIME_64);
    }
    h
}

/// 内容精确指纹：归一化文本的 128 位 FNV-1a（两路不同 basis），输出 32 位小写十六进制。
pub fn content_fingerprint(text: &str) -> String {
    content_fingerprint_normalized(&normalize_for_hash(text))
}

/// **已归一化**文本的内容精确指纹（跳过内部 normalize，供批量路径复用一次归一化结果）。
///
/// 大书导入时全书文本会被扫描多次（content 指纹 + SimHash 各扫一遍）；调用方先
/// [`normalize_for_hash`] 一次，再同时喂给本函数与 [`simhash64_normalized`]，全程只归一化一次。
pub(crate) fn content_fingerprint_normalized(norm: &str) -> String {
    let lo = fnv1a_64(norm.as_bytes(), FNV_OFFSET_BASIS_64);
    let hi = fnv1a_64(norm.as_bytes(), FNV_ALT_BASIS_64);
    format!("{lo:016x}{hi:016x}")
}

/// 单句/单块归一化指纹（64 位，落库为 i64 位型）。
pub fn chunk_fingerprint(content: &str) -> i64 {
    fnv1a_64(normalize_for_hash(content).as_bytes(), FNV_OFFSET_BASIS_64) as i64
}

/// SimHash 64：对归一化文本的字符 3-gram 逐位投票，得到 64 位近似指纹。
///
/// 特性：只反映词元的**多重集**，对局部增删改稳健（改一句话只翻转少数位）——
/// 正是「同一本书不同版本/排版」需要的行为。
pub fn simhash64(text: &str) -> i64 {
    simhash64_normalized(&normalize_for_hash(text))
}

/// **已归一化**文本的 SimHash（跳过内部 normalize，供批量路径复用一次归一化结果）。
pub(crate) fn simhash64_normalized(norm: &str) -> i64 {
    let chars: Vec<char> = norm.chars().collect();
    if chars.is_empty() {
        return 0;
    }
    let mut votes = [0i32; 64];
    if chars.len() < SHINGLE_CHARS {
        // 极短文本：整体作为一个 shingle，避免空集合
        vote_one(&norm, &mut votes);
    } else {
        let mut shingle = String::with_capacity(SHINGLE_CHARS * 4);
        for w in chars.windows(SHINGLE_CHARS) {
            shingle.clear();
            shingle.extend(w.iter().copied());
            vote_one(&shingle, &mut votes);
        }
    }
    let mut out: u64 = 0;
    for (i, v) in votes.iter().enumerate() {
        if *v > 0 {
            out |= 1u64 << i;
        }
    }
    out as i64
}

/// 单个 shingle 对 64 位投票（置位 +1，未置位 -1）。
fn vote_one(shingle: &str, votes: &mut [i32; 64]) {
    let h = fnv1a_64(shingle.as_bytes(), FNV_OFFSET_BASIS_64);
    for (i, v) in votes.iter_mut().enumerate() {
        if (h >> i) & 1 == 1 {
            *v += 1;
        } else {
            *v -= 1;
        }
    }
}

/// 两枚 SimHash 的海明距离（按位异或后数 1；i64 的补码位型与 u64 一一对应）。
pub fn hamming64(a: i64, b: i64) -> u32 {
    (a ^ b).count_ones()
}

/// 相似度百分比（由海明距离折算，0..=100）。
pub fn similarity_percent(a: i64, b: i64) -> i64 {
    let d = hamming64(a, b) as i64;
    (((64 - d) * 100) / 64).clamp(0, 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_fingerprint_is_stable_and_whitespace_insensitive() {
        let a = "山风很大。他回头\n看了一眼。";
        let b = "山风很大。他回头看了一眼。"; // 仅空白差异
        let c = "山风很大。\r\n  他回头\t看了一眼。"; // CRLF + 缩进 + 制表符
        assert_eq!(content_fingerprint(a), content_fingerprint(b));
        assert_eq!(content_fingerprint(b), content_fingerprint(c));
        assert_eq!(content_fingerprint(a).len(), 32);
        // 确定性：重复调用同值（跨版本稳定由 FNV 常量保证）
        assert_eq!(content_fingerprint(a), content_fingerprint(a));
    }

    #[test]
    fn content_fingerprint_differs_on_real_change() {
        // 标点是内容差异，不应被抹平
        assert_ne!(
            content_fingerprint("山风很大。"),
            content_fingerprint("山风很大！")
        );
        assert_ne!(content_fingerprint("甲"), content_fingerprint("乙"));
        assert_eq!(content_fingerprint(""), content_fingerprint("   \n\t "));
    }

    #[test]
    fn chunk_fingerprint_ignores_wrapping() {
        assert_eq!(
            chunk_fingerprint("他回头\n看了一眼。"),
            chunk_fingerprint("他回头看了一眼。")
        );
        assert_ne!(chunk_fingerprint("甲"), chunk_fingerprint("乙"));
    }

    /// 生成"每句都不同"的长文本，使 shingle 多重集接近真实书籍分布（非重复句堆叠）。
    fn sample_book(offset: usize) -> String {
        let mut s = String::new();
        for i in 0..300usize {
            s.push_str(&format!(
                "第{}段：他在第{}次回头的时候，看见山脊上第{}棵松树在风里摇晃，心里想着第{}件旧事。\n",
                i,
                i + offset,
                i * 3 + offset,
                i * 5 + offset
            ));
        }
        s
    }

    #[test]
    fn simhash_is_local_and_separates_unrelated() {
        let base = sample_book(0);
        // 近似一：整本书只改 1/300 的句子 → 距离应很小（局部性）
        let mut lines: Vec<String> = base.lines().map(|l| l.to_string()).collect();
        lines[150] = "第150段：这一句被完全改写成了另一番叙述，讲的是海边灯塔与长夜。".to_string();
        let one_edit = lines.join("\n");
        // 近似二：每 10 句改 1 句（模拟不同版本/排版的小幅差异）
        let edition: String = base
            .lines()
            .enumerate()
            .map(|(i, l)| {
                if i % 10 == 0 {
                    format!("{l}（此版本多了一句校注编号{}）", i)
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        // 无关：完全不同的另一本书
        let unrelated = {
            let mut s = String::new();
            for i in 0..300usize {
                s.push_str(&format!(
                    "第{}章：深海探测器在洋流第{}层的观测记录显示，样本温度与盐度呈负相关，编号{}。\n",
                    i,
                    i * 2 + 11,
                    i * 13 + 7
                ));
            }
            s
        };

        let hb = simhash64(&base);
        let h1 = simhash64(&one_edit);
        let he = simhash64(&edition);
        let hu = simhash64(&unrelated);

        assert_eq!(hamming64(hb, hb), 0);
        assert_eq!(similarity_percent(hb, hb), 100);

        let d_one = hamming64(hb, h1);
        let d_edition = hamming64(hb, he);
        let d_far = hamming64(hb, hu);
        assert!(d_one <= 4, "1/300 句改动距离过大：{d_one}");
        assert!(
            d_edition <= SIMHASH_NEAR_DUP_MAX_DISTANCE,
            "版本式小幅差异应判近似：{d_edition} > {SIMHASH_NEAR_DUP_MAX_DISTANCE}"
        );
        assert!(
            d_far > SIMHASH_NEAR_DUP_MAX_DISTANCE,
            "无关文本不该判近似：{d_far} <= {SIMHASH_NEAR_DUP_MAX_DISTANCE}"
        );
        assert!(d_edition < d_far);
        assert!(similarity_percent(hb, he) > similarity_percent(hb, hu));
    }

    #[test]
    fn simhash_handles_empty_and_short() {
        assert_eq!(simhash64(""), 0);
        assert_eq!(simhash64("   "), 0);
        let _ = simhash64("短"); // 不 panic
        assert_eq!(hamming64(0, 0), 0);
    }
}
