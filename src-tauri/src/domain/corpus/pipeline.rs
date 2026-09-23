/// 语料导入管线（纯函数，无 IO）：文本 → 句序列切分 + 字数统计。
///
/// 设计约束：
/// - 中英双语：句末标点同时覆盖中文（。！？…）与英文（.!?），引号闭合跟随；
/// - 章标题识别：「第X章/回/节/卷/部/篇」或「Chapter N」开头的短行；
/// - 句子为检索单元（KWIC），超长句硬切（FTS trigram 索引与前端展示都需要上限）。
///   硬切边界选在软标点（，、；：）优先，退而求其次按固定长度切。
/// - **短句合并**：切出的句子短于 [`MIN_MERGED_CHARS`] 时并入下一句，
///   让索引单元尽量是「一句完整的话」（trigram 子串检索不受影响，KWIC 上下文更完整）；
/// - **非正文噪声过滤**（[`is_noise_text`]）：纯省略号/标点、独立拟声/语气行、
///   作者更新注/求票、站点水印页脚，导入即跳过不入索引。检索能力不缩水——
///   段内出现的拟声词仍随合并单元可被检索到。

/// 单句最大长度（字符）。超过即从最近的软标点硬切。
const MAX_SENTENCE_CHARS: usize = 400;

/// 短句合并下限（字符，含标点）：切分出的句子不足此值时并入下一句。
const MIN_MERGED_CHARS: usize = 8;

/// 超长硬切时，允许向前回退找软标点的最大窗口（字符）。
/// 窗口内无软标点则按固定长度硬切，避免软标点过远时切出碎块。
const HARD_CUT_WINDOW: usize = 120;

/// 句末终止符（中英）。切句点：终止符后跟随闭合引号/空白/结尾时切。
fn is_sentence_terminator(c: char) -> bool {
    matches!(c, '。' | '！' | '？' | '…' | '.' | '!' | '?')
}

/// 拟声/语气闭合字符集（独立成行且全部字符 ∈ 此集合即判噪声；
/// 重复组合如 轰隆隆/噗嗤/砰砰砰 亦命中。内容词因含集合外字符天然不误伤，如「八极崩!」）。
const ONOMATOPOEIA: &str = "嘭嗤轰砰噗哼呼吼咻嗯啊哦噢喔唉呃咦咳叮铛咔嚓噼啪嗖咚呜嘶哗滴嘎吱咯呵嘿嘻哈乒乓当啷哐锵隆嘟哒嘀喽啾嗷嗄诶欸呀哇啦咧嘞喂嗡哟唷呦吭喳";

/// 引号与标点（噪声判定时剥除，只看剩余内容字符）。
fn is_quote_or_punct(c: char) -> bool {
    matches!(
        c,
        '“' | '”' | '‘' | '’' | '「' | '」' | '『' | '』' | '《' | '》' | '〈' | '〉'
            | '(' | ')' | '（' | '）' | '【' | '】' | '[' | ']' | '{' | '}'
            | '。' | '．' | '.' | '！' | '!' | '？' | '?' | '…' | '~' | '～' | '、'
            | '，' | ',' | '；' | ';' | '：' | ':' | '-' | '—' | '_' | '·' | '*'
            | '#' | '%' | '&' | '=' | '+' | '@' | '$' | '^' | '<' | '>' | '/' | '\\' | '|'
    )
}

/// 站点水印/页脚短语（限短行命中，降低误伤正文概率）。
const WATERMARK_PHRASES: [&str; 17] = [
    "www.", "http://", "https://", ".com", ".net", ".cn", ".org", ".cc", "天才一秒记住",
    "本站地址", "最新章节", "无错章节", "请记住本书", "手机阅读", "书友群", "上一页", "下一页",
];

/// 非正文噪声判定（导入跳行与查重报告过滤共用）。依次判：
/// ① 去引号/标点/空白后为空（纯省略号/标点）或纯数字（页码）；
/// ② 剩余字符全部 ∈ 拟声/语气闭合集合（“嘭!”“嗯。”“轰隆隆!”“呼...”）；
/// ③ 作者更新注/求票（`（/(` 开头且前段含 更/票/订/求/爆/PS，或 「作者：」「上架感言」等起头）；
/// ④ 站点水印/页脚（短行内含 www./.com/「天才一秒记住」等短语）。
pub fn is_noise_text(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return true;
    }
    // ③ 作者更新注（括号开头的「(第一更!」「（求月票）」等）
    if t.starts_with('（') || t.starts_with('(') {
        let head: String = t.chars().take(12).collect();
        if head.contains('更')
            || head.contains('票')
            || head.contains('订')
            || head.contains('求')
            || head.contains('爆')
            || head.contains("PS")
            || head.contains("ps")
        {
            return true;
        }
    }
    for p in [
        "作者：", "作者:", "作者的话", "本章说", "上架感言", "完本感言", "求月票", "求收藏",
        "求推荐", "求订阅", "求点击",
    ] {
        if t.starts_with(p) {
            return true;
        }
    }
    // ④ 站点水印/页脚
    if t.chars().count() <= 60 && WATERMARK_PHRASES.iter().any(|w| t.contains(w)) {
        return true;
    }
    // 剥引号/标点/空白
    let content: String = t
        .chars()
        .filter(|c| !(c.is_whitespace() || is_quote_or_punct(*c)))
        .collect();
    // ① 纯省略号/标点/页码
    if content.is_empty() || content.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    // ② 纯拟声/语气
    content.chars().all(|c| ONOMATOPOEIA.contains(c))
}

/// 软标点（硬切超长句时的优先断点）。
fn is_soft_break(c: char) -> bool {
    matches!(c, '，' | '、' | '；' | '：' | ',' | ';' | ':')
}

/// 闭合引号/括号：句末终止符后紧跟这些字符时并入本句。
fn is_closing_quote(c: char) -> bool {
    matches!(c, '”' | '』' | '」' | '）' | '"' | '\'' | ')')
}

/// 常见卷章关键词（需后随空白或行尾，避免「尾声的…」被误判为标题）。
const CHAPTER_KEYWORDS: [&str; 10] = [
    "序章", "序言", "楔子", "引子", "前言", "尾声", "后记", "番外", "终章", "大结局",
];

/// 章标题行判定：行首「第X章/回/节/卷/部/篇」、「Chapter N」或常见卷章关键词，
/// 且为不含句读标点的短行。
pub fn is_chapter_heading(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.chars().count() > 50 {
        return false;
    }
    // 含句末/句读标点 → 更像正文句子，不判标题（防「第一章的内容很精彩，值得一看。」误判）。
    // 注意放行全角冒号，兼容「第一章：出山」。
    if t.chars()
        .any(|c| matches!(c, '。' | '！' | '？' | '…' | '，' | '、' | '；'))
    {
        return false;
    }
    // 「第 + 数字/汉数字 + 章/回/节/卷/部/篇」（后随可有标题文字）
    let mut chars = t.chars();
    if chars.next() == Some('第') {
        let rest: String = chars.collect();
        let num_end = rest
            .char_indices()
            .find(|(_, c)| {
                !matches!(
                    c,
                    '0'..='9'
                        | '零' | '一' | '二' | '三' | '四' | '五' | '六' | '七' | '八' | '九'
                        | '十' | '百' | '千' | '万' | '亿'
                )
            })
            .map(|(i, _)| i)
            .unwrap_or(rest.len());
        if num_end > 0 {
            if let Some(unit) = rest[num_end..].chars().next() {
                if matches!(unit, '章' | '回' | '节' | '卷' | '部' | '篇') {
                    return true;
                }
            }
        }
    }
    // 「Chapter N」（大小写不敏感，允许 chapter 与数字间无空格）
    let lower = t.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("chapter") {
        if rest
            .trim_start()
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit())
        {
            return true;
        }
    }
    // 常见卷章关键词：命中后须为行尾或空白
    for kw in CHAPTER_KEYWORDS {
        if let Some(rest) = t.strip_prefix(kw) {
            if rest.is_empty() || rest.chars().next().is_some_and(|c| c.is_whitespace()) {
                return true;
            }
        }
    }
    false
}

/// 统计字数：中文字符/标点计 1，连续英文字母数字串计 1（与写作域口径一致）。
pub fn count_words(text: &str) -> i64 {
    let mut count = 0i64;
    let mut in_word = false;
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            if !in_word {
                count += 1;
                in_word = true;
            }
        } else {
            in_word = false;
            if !c.is_whitespace() {
                count += 1;
            }
        }
    }
    count
}

/// 切分结果：一条索引单元（章标题行或句子）。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedChunk {
    pub kind: &'static str, // "chapter" | "sentence"
    pub content: String,
    /// 所属章标题（章标题行自身为空串）。
    pub chapter_title: String,
}

/// 把整本文本切分为句序列（含章标题行）。
pub fn parse_text(text: &str) -> Vec<ParsedChunk> {
    let mut out: Vec<ParsedChunk> = Vec::new();
    let mut current_chapter = String::new();
    // 段缓冲：按空行分段，段内切句
    let mut para = String::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            flush_paragraph(&para, &current_chapter, &mut out);
            para.clear();
            continue;
        }
        if is_chapter_heading(line) {
            // 标题行独立成章：先把前文收尾（不依赖空行分隔）
            flush_paragraph(&para, &current_chapter, &mut out);
            para.clear();
            current_chapter = line.to_string();
            out.push(ParsedChunk {
                kind: "chapter",
                content: line.to_string(),
                chapter_title: String::new(),
            });
            continue;
        }
        // 非正文噪声行（独立拟声/语气行、纯省略号、作者更新注、站点水印）：直接跳过，不入索引
        if is_noise_text(line) {
            continue;
        }
        // 段内软换行拼接：仅英文（两侧端点均为 ASCII 字母/数字）补空格，
        // 中文等非空格分词语种直接相连，避免词内插空格破坏子串检索。
        if !para.is_empty() && needs_space_join(&para, line) {
            para.push(' ');
        }
        para.push_str(line);
    }
    flush_paragraph(&para, &current_chapter, &mut out);
    out
}

/// 段落收尾：段内切句；短句（< [`MIN_MERGED_CHARS`]）并入下一句，
/// 让索引单元尽量是「一句完整的话」（“嗯。”他点点头，转身离开。 → 一个检索单元）。
fn flush_paragraph(para: &str, chapter: &str, out: &mut Vec<ParsedChunk>) {
    if para.trim().is_empty() {
        return;
    }
    let mut merged: Vec<String> = Vec::new();
    for s in split_sentences(para) {
        match merged.last_mut() {
            // 上一单元仍不足一句 → 就近续上（段内补全；续后仍短则继续吸收下一句）
            Some(prev) if prev.chars().count() < MIN_MERGED_CHARS => {
                if needs_space_merge(prev, &s) {
                    prev.push(' ');
                }
                prev.push_str(&s);
            }
            _ => merged.push(s),
        }
    }
    for content in merged {
        out.push(ParsedChunk {
            kind: "sentence",
            content,
            chapter_title: chapter.to_string(),
        });
    }
}

/// 合并相邻短句时的空格补全：仅英文场景补空格（上一单元以句点/字母数字结尾、
/// 下一单元以字母数字开头，如 `Yes.` + `No.` → `Yes. No.`）；中文等直接相连。
fn needs_space_merge(prev: &str, next: &str) -> bool {
    let tail = matches!(
        prev.chars().next_back(),
        Some(c) if c.is_ascii_alphanumeric() || c == '.'
    );
    matches!(next.chars().next(), Some(c) if c.is_ascii_alphanumeric()) && tail
}

/// 段内软换行拼接是否需要补空格：仅当连接处两侧端点均为 ASCII 字母/数字（英文词内换行）。
/// 中文等非空格分词语种直接相连，避免在词内插空格破坏子串检索。
fn needs_space_join(prev: &str, next: &str) -> bool {
    matches!(prev.chars().next_back(), Some(c) if c.is_ascii_alphanumeric())
        && matches!(next.chars().next(), Some(c) if c.is_ascii_alphanumeric())
}

/// 段内切句：终止符 + 闭合引号/结尾处切；超长句在软标点硬切。
fn split_sentences(para: &str) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut chars = para.chars().peekable();

    while let Some(c) = chars.next() {
        buf.push(c);
        if is_sentence_terminator(c) {
            // 闭合引号跟随（如 。」 ！” ？' ），省略号连续字符一并并入
            while let Some(&n) = chars.peek() {
                if is_closing_quote(n) || is_sentence_terminator(n) {
                    buf.push(n);
                    chars.next();
                } else {
                    break;
                }
            }
            push_sentence(&mut sentences, &mut buf);
        } else if buf.chars().count() >= MAX_SENTENCE_CHARS {
            // 超长硬切：仅在末尾窗口内回退到最近的软标点；
            // 窗口内无软标点则按固定长度硬切（避免软标点过远导致碎块）。
            let offsets: Vec<(usize, char)> = buf.char_indices().collect();
            let window_start = offsets.len().saturating_sub(HARD_CUT_WINDOW);
            let cut = offsets
                .iter()
                .enumerate()
                .rev()
                .find(|(ci, (_, ch))| *ci >= window_start && is_soft_break(*ch))
                .map(|(_, (bi, ch))| bi + ch.len_utf8())
                .unwrap_or_else(|| {
                    offsets
                        .get(MAX_SENTENCE_CHARS)
                        .map(|(bi, _)| *bi)
                        .unwrap_or(buf.len())
                });
            let tail = buf.split_off(cut);
            push_sentence(&mut sentences, &mut buf);
            buf = tail;
        }
    }
    push_sentence(&mut sentences, &mut buf);
    sentences
}

/// 收录一句：去首尾空白，有效内容（非空白 ≥2 字符）才入库。
fn push_sentence(sentences: &mut Vec<String>, buf: &mut String) {
    let s = buf.trim().to_string();
    buf.clear();
    if s.chars().filter(|c| !c.is_whitespace()).count() >= 2 {
        sentences.push(s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_chinese_novel_with_chapters() {
        let text = "第一章 出山\n\n山风很大。他回头看了一眼，脚下是万丈深渊！\n\n第二章 入世\n\n「你来了。」老者说。这是宿命……";
        let chunks = parse_text(text);
        assert_eq!(chunks[0].kind, "chapter");
        assert_eq!(chunks[0].content, "第一章 出山");
        assert_eq!(chunks[1].kind, "sentence");
        assert_eq!(chunks[1].chapter_title, "第一章 出山");
        // 短句「山风很大。」并入后句：索引单元是一句完整的话
        assert_eq!(chunks[1].content, "山风很大。他回头看了一眼，脚下是万丈深渊！");
        assert_eq!(chunks[2].kind, "chapter");
        // 「你来了。」并入「老者说。」
        assert_eq!(chunks[3].content, "「你来了。」老者说。");
        assert_eq!(chunks[4].content, "这是宿命……");
    }

    #[test]
    fn parse_english_text() {
        let text = "It was the best of times. It was the worst of times!\n\nChapter 1\n\nMr. Jones woke up.";
        let chunks = parse_text(text);
        // "Mr." 的句点后非空白则跟随；此处句点后是空格会切——接受该近似
        assert!(chunks.iter().any(|c| c.content.contains("best of times")));
        assert!(chunks.iter().any(|c| c.kind == "chapter"));
    }

    #[test]
    fn long_paragraph_hard_cut_at_soft_break() {
        let text = format!("{}。", "很".repeat(10) + "，" + &"长".repeat(500));
        let chunks = parse_text(&text);
        let total: usize = chunks.iter().map(|c| c.content.chars().count()).sum();
        assert!(total >= 510);
        assert!(chunks.iter().all(|c| c.content.chars().count() <= MAX_SENTENCE_CHARS));
    }

    #[test]
    fn count_words_mixed_script() {
        // 中文字符各计 1（你好=2），连续英文/数字串各计 1（world=1，42=1）
        assert_eq!(count_words("你好 world 42"), 4);
    }

    #[test]
    fn paragraph_wrap_keeps_chinese_joined() {
        // 段内软换行（中文）不得插入空格，否则子串检索失败
        let chunks = parse_text("他回头\n看了一眼，脚下是万丈深渊。");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content, "他回头看了一眼，脚下是万丈深渊。");
        assert!(!chunks[0].content.contains(' '));
    }

    #[test]
    fn paragraph_wrap_keeps_english_word_boundary() {
        // 英文软换行仍需保留词间空格
        let chunks = parse_text("It was the best of\ntimes.");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content, "It was the best of times.");
    }

    #[test]
    fn chapter_heading_without_blank_line() {
        // 无空行分隔的章标题也必须切出，且后续句子归属正确
        let chunks = parse_text("第一章 出山\n山风很大。\n第二章 入世\n老者说。");
        assert_eq!(chunks[0].kind, "chapter");
        assert_eq!(chunks[0].content, "第一章 出山");
        assert_eq!(chunks[1].content, "山风很大。");
        assert_eq!(chunks[1].chapter_title, "第一章 出山");
        assert_eq!(chunks[2].kind, "chapter");
        assert_eq!(chunks[2].content, "第二章 入世");
        assert_eq!(chunks[3].content, "老者说。");
        assert_eq!(chunks[3].chapter_title, "第二章 入世");
    }

    #[test]
    fn chapter_heading_keywords_and_guards() {
        for h in [
            "序章",
            "楔子",
            "尾声 归乡",
            "番外 其一",
            "终章",
            "第一章：出山",
            "Chapter2",
        ] {
            assert!(is_chapter_heading(h), "should be heading: {h}");
        }
        for b in [
            "第一章的内容很精彩，值得一看。",
            "尾声的承诺",
            "第二天他醒来。",
        ] {
            assert!(!is_chapter_heading(b), "should NOT be heading: {b}");
        }
    }

    #[test]
    fn long_sentence_hard_cut_stays_within_window() {
        // 软标点很远时不得切出碎块：首块长度应 ≥ MAX - HARD_CUT_WINDOW
        let text = format!("{}。", "很".repeat(3) + "，" + &"长".repeat(500));
        let chunks = parse_text(&text);
        assert!(chunks
            .iter()
            .all(|c| c.content.chars().count() <= MAX_SENTENCE_CHARS));
        assert!(chunks[0].content.chars().count() >= MAX_SENTENCE_CHARS - HARD_CUT_WINDOW);
        let total: usize = chunks.iter().map(|c| c.content.chars().count()).sum();
        assert!(total >= 504);
    }

    /// 非正文噪声判定（用户报告的真实样例回归）。
    #[test]
    fn noise_text_rules() {
        for n in [
            "嘭!", "嘭！", "“嗯。”", "“嗤!”", "……", "......", "...", "“噗嗤!”", "“呼...”",
            "轰隆隆!", "“轰隆隆!”", "“咔嚓!”", "“砰砰砰!”", "(第一更!", "(第二更到!", "（求月票）",
            "作者：天蚕土豆", "本书由www.example.com提供下载", "天才一秒记住本站地址", "123456",
        ] {
            assert!(is_noise_text(n), "should be noise: {n}");
        }
        for k in [
            "八极崩!", "是!", "走!", "怎么回事?", "药老笑道。", "“这是...", "“你...",
            "山风很大。", "第一章 出山", "他点点头。", "“喂？”他喊了一声。",
        ] {
            assert!(!is_noise_text(k), "should NOT be noise: {k}");
        }
    }

    /// 噪声行在切分时被丢弃（独立拟声段/省略号/作者注），章标题与正文不受影响。
    #[test]
    fn parse_drops_noise_lines() {
        let text = "第一章 出山\n\n“嘭！”\n\n山风很大。他回头看了一眼。\n\n……\n\n(第一更!\n\n第二章 入世\n\n老者说。";
        let chunks = parse_text(text);
        // 章标题保留
        assert_eq!(chunks.iter().filter(|c| c.kind == "chapter").count(), 2);
        // 噪声行不产生任何单元
        assert!(!chunks.iter().any(|c| c.content.contains('嘭')));
        assert!(!chunks.iter().any(|c| c.content.contains('更')));
        // 正文短句并入成完整单元
        assert!(chunks
            .iter()
            .any(|c| c.kind == "sentence" && c.content == "山风很大。他回头看了一眼。"));
        assert!(chunks
            .iter()
            .any(|c| c.kind == "sentence" && c.content == "老者说。"));
    }

    /// 短句合并：索引单元尽量是一句完整的话；长句不受影响。
    #[test]
    fn short_sentences_merge_into_complete_units() {
        let chunks = parse_text("“嗯。”他点点头，转身离开。\n\n山风很大，他回头看了一眼，脚下是万丈深渊！");
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].content, "“嗯。”他点点头，转身离开。");
        assert_eq!(chunks[1].content, "山风很大，他回头看了一眼，脚下是万丈深渊！");
    }

    /// 短句合并的英文边界：句点结尾续下一句时补空格。
    #[test]
    fn merge_english_keeps_word_boundary() {
        let chunks = parse_text("Yes. No. Come here!");
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].content, "Yes. No.");
        assert_eq!(chunks[1].content, "Come here!");
    }
}
