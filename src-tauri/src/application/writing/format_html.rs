//! 导出前的**结构层**规范化（F3，2026-11-06）
//!
//! **为什么必须有**：作者用手工空格敲缩进（真库第一章段首就是 `&nbsp; &nbsp; &nbsp; &nbsp;`），
//! 硬空格会原样进产物。实测同一本书 PDF 各段行首空白是 **4 / 3 / 2 / 3** ——
//! 缩进由"作者手敲了几个空格"决定，而不是由版式决定。这不是"不够美"，是**不合格**。
//!
//! 判据分工（不许重叠：重叠会两边互相打脸，回执也说不清是谁改的）：
//! - 本模块只管**结构层**：段首手工缩进、空段、多余空白、`<br>` 冒充分段、中西文薄空格；
//! - **标点 / 错别字 / 冗余词**交还给前端文本层引擎（`editor/proofread/proofreadEngine.ts`，
//!   带词典、带 fix、可定位）。词典只有一份，不在 Rust 里再抄一遍。
//!
//! 与前端 `utils/writingFormat.ts` 是同一套规则的镜像，由跨语言源码锁钉住不漂移。
//! 改动一律保守：只动空白与分段结构，绝不改措辞、绝不自动分段、绝不删正文。

/// 语种（只用于决定薄空格与首行缩进的默认值）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BookLang {
    Zh,
    En,
}

const NBSP: char = '\u{a0}';
const IDEO_SPACE: char = '\u{3000}';
const THIN: char = '\u{2009}';

fn is_ws(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r') || c == NBSP || c == IDEO_SPACE
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x4e00..=0x9fff | 0x3400..=0x4dbf)
}

/// 剥标签取纯文本（只用于判断与统计，不回写）
pub fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
}

/// 按纯文本判语种：CJK 占比过阈值算中文；拿不准按 `Zh`（规则更严，宁可多提示）
pub fn detect_lang(html: &str) -> BookLang {
    let text = strip_tags(html);
    let total = text.chars().filter(|c| !c.is_whitespace()).count();
    if total == 0 {
        return BookLang::Zh;
    }
    let cjk = text.chars().filter(|c| is_cjk(*c)).count();
    if (cjk as f64) / (total as f64) >= 0.05 {
        BookLang::Zh
    } else {
        BookLang::En
    }
}

/// 本层修了什么。数量必须报得出来——"悄悄改好了"和"没改"在用户眼里都是不透明。
#[derive(Debug, Default, Clone, Copy)]
pub struct StructureFixes {
    pub leading_indent: usize,
    pub trailing_space: usize,
    pub empty_para: usize,
    pub redundant_space: usize,
    pub fake_break: usize,
    pub pangu: usize,
}

impl StructureFixes {
    pub fn total(&self) -> usize {
        self.leading_indent
            + self.trailing_space
            + self.empty_para
            + self.redundant_space
            + self.fake_break
            + self.pangu
    }
}

fn find_from(hay: &str, from: usize, needle: &str) -> Option<usize> {
    hay.get(from..)
        .and_then(|tail| tail.find(needle).map(|i| from + i))
}

/// 空白实体（HTML 里 **`&nbsp;` 是 6 个 ASCII 字符，不是空格字符**）。
/// 不认实体的话，真库那种 `&nbsp; &nbsp;` 手工缩进一个都摘不掉 —— 这是 2026-11-06
/// 实测出来的：规范化上线后 PDF 行首空白仍是 4/3/2/3，就是因为只按 char 判空白。
const WS_ENTITIES: [&str; 4] = ["&nbsp;", "&NBSP;", "&#160;", "&#xA0;"];

/// 取前缀判定。**不能按字节切**：`&nbsp;她` 的前 8 字节会落在汉字的中间，
/// `str::get` 直接返回 None —— 于是"摘到最后一个实体就停"，实测会剩一个 `&nbsp;` 在段首。
/// 按字符取窗口，再比字节长度。
fn is_ws_entity_prefix(s: &str) -> Option<usize> {
    let head: String = s.chars().take(8).collect::<String>().to_ascii_lowercase();
    WS_ENTITIES
        .iter()
        .find(|e| head.starts_with(&e.to_ascii_lowercase()))
        .map(|e| e.len())
}

/// 同上，尾部版。只取末 8 个字符比对，避免整串 lowercase 造成为二次方。
fn is_ws_entity_suffix(s: &str) -> Option<usize> {
    let chars: Vec<char> = s.chars().collect();
    let start = chars.len().saturating_sub(8);
    let tail: String = chars[start..]
        .iter()
        .collect::<String>()
        .to_ascii_lowercase();
    WS_ENTITIES
        .iter()
        .find(|e| tail.ends_with(&e.to_ascii_lowercase()))
        .map(|e| e.len())
}

/// 段首空白：空白字符与空白实体交替摘除，直到出现真实内容
fn trim_start_ws(s: &str) -> String {
    let mut rest = s;
    loop {
        if let Some(n) = is_ws_entity_prefix(rest) {
            rest = &rest[n..];
            continue;
        }
        match rest.chars().next() {
            Some(c) if is_ws(c) => rest = &rest[c.len_utf8()..],
            _ => break,
        }
    }
    rest.to_string()
}

/// 段末空白（同上，从尾部摘）
fn trim_end_ws(s: &str) -> String {
    let mut rest = s;
    loop {
        if let Some(n) = is_ws_entity_suffix(rest) {
            rest = &rest[..rest.len() - n];
            continue;
        }
        match rest.chars().next_back() {
            Some(c) if is_ws(c) => rest = &rest[..rest.len() - c.len_utf8()],
            _ => break,
        }
    }
    rest.to_string()
}

/// 段内是否已经没有任何实际内容（只剩空白或空标签）
fn is_empty_paragraph(s: &str) -> bool {
    strip_tags(s).chars().all(|c| is_ws(c) || c.is_whitespace())
}

/// 把一个 `<br>` 标签从字符串里摘出来，同时数它是不是"连续第二个"
fn split_fake_breaks(s: &str, fx: &mut StructureFixes) -> Vec<String> {
    let mut pieces: Vec<String> = vec![String::new()];
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    let mut last_was_br = false;
    while i < chars.len() {
        if chars[i] == '<' {
            // 匹配 <br> / <br/> / <br />
            if let Some(end) = chars[i..].iter().position(|c| *c == '>') {
                let tag: String = chars[i..i + end + 1].iter().collect();
                let name: String = tag
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .trim_end_matches('/')
                    .chars()
                    .filter(|c| !c.is_whitespace())
                    .collect();
                if name.eq_ignore_ascii_case("br") {
                    if last_was_br {
                        // 连续第二个及以后：这里就是作者想分的新段
                        pieces.push(String::new());
                        fx.fake_break += 1;
                    }
                    last_was_br = true;
                    i += end + 1;
                    continue;
                }
            }
        }
        last_was_br = false;
        pieces.last_mut().map(|p| p.push(chars[i]));
        i += 1;
    }
    pieces
}

/// 连续空白折叠成一个普通空格（标签内不动；实体整体跳过）
fn collapse_spaces(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    let mut pending_space = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '<' {
            in_tag = true;
        }
        if c == '>' {
            in_tag = false;
        }
        if !in_tag && is_ws(c) {
            pending_space = true;
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(c);
    }
    out
}

/// 中西文之间插薄空格。`&nbsp;` 之类实体当整体，绝不从中间断开。
fn insert_pangu(s: &str) -> (String, usize) {
    let mut out = String::new();
    let mut inserted = 0usize;
    let mut prev: Option<char> = None;
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        // 实体整体搬运
        if chars[i] == '&' {
            if let Some(end) = chars[i..].iter().position(|c| *c == ';') {
                let ent: String = chars[i..i + end + 1].iter().collect();
                out.push_str(&ent);
                prev = None;
                i += end + 1;
                continue;
            }
        }
        let c = chars[i];
        if c == '<' {
            // 标签原样搬运，并切断相邻关系（不在标签两侧插空格）
            if let Some(end) = chars[i..].iter().position(|x| *x == '>') {
                let tag: String = chars[i..i + end + 1].iter().collect();
                out.push_str(&tag);
                prev = None;
                i += end + 1;
                continue;
            }
        }
        if let Some(p) = prev {
            let need = (is_cjk(p) && (c.is_ascii_alphanumeric()))
                || ((p.is_ascii_alphanumeric()) && is_cjk(c));
            if need {
                out.push(THIN);
                inserted += 1;
            }
        }
        out.push(c);
        prev = Some(c);
        i += 1;
    }
    (out, inserted)
}

/// 结构层规范化：只动 `<p>…</p>` 之内；段内 `<br><br>` 会裂成多段。
pub fn normalize_structure(html: &str, pangu: bool) -> (String, StructureFixes) {
    let mut fx = StructureFixes::default();
    let mut out = String::new();
    let mut cursor = 0usize;

    while let Some(rel) = find_from(html, cursor, "<p") {
        let Some(open_len) = html[rel..].find('>') else {
            break;
        };
        let open_end = rel + open_len + 1;
        let Some(close) = find_from(html, open_end, "</p>") else {
            break;
        };
        // 段外内容原样保留
        let pieces = fix_paragraph(&html[open_end..close], pangu, &mut fx);
        // 整段被清空 → **连开标签一起丢掉**。只丢内容会留下 `<p></p>` 空壳，
        // 既污染产物，又让下一遍规范化再数一次空段（幂等性当场破掉）。
        if !pieces.is_empty() {
            out.push_str(&html[cursor..open_end]);
            let mut first = true;
            for piece in pieces {
                if !first {
                    out.push_str("</p><p>");
                }
                out.push_str(&piece);
                first = false;
            }
            out.push_str("</p>");
        }
        cursor = close + "</p>".len();
    }
    if cursor < html.len() {
        out.push_str(&html[cursor..]);
    }
    (out, fx)
}

/// 单段规范化，返回一个或多个段内文
fn fix_paragraph(inner: &str, pangu: bool, fx: &mut StructureFixes) -> Vec<String> {
    // 段首只要出现空白/硬空格就算"手工缩进"，摘掉后统一由版式给
    let mut s = trim_start_ws(inner);
    if inner.chars().next().is_some_and(is_ws) || is_ws_entity_prefix(inner).is_some() {
        fx.leading_indent += 1;
    }
    let t = trim_end_ws(&s);
    if t != s {
        fx.trailing_space += 1;
    }
    s = t;

    let mut out: Vec<String> = Vec::new();
    for piece in split_fake_breaks(&s, fx) {
        if is_empty_paragraph(&piece) {
            fx.empty_para += 1;
            continue;
        }
        let collapsed = collapse_spaces(&piece);
        if collapsed != piece {
            fx.redundant_space += 1;
        }
        if pangu {
            let (spaced, n) = insert_pangu(&collapsed);
            fx.pangu += n;
            out.push(spaced);
        } else {
            out.push(collapsed);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 段首硬空格实体缩进必须摘干净() {
        // 真库第一章的真实形态：四个 &nbsp; 与普通空格交替
        let (out, fx) = normalize_structure(
            "<p>&nbsp; &nbsp; &nbsp; &nbsp; 她一连说了十几声谢谢。</p>",
            false,
        );
        assert_eq!(
            out, "<p>她一连说了十几声谢谢。</p>",
            "实体与空白要交替摘除，实际：{out:?}"
        );
        assert_eq!(fx.leading_indent, 1, "要能报出改了几处");
    }

    #[test]
    fn 规范化之后不许再残留任何段首空白() {
        let cases = [
            "<p>&nbsp;&nbsp;甲</p>",
            "<p>&#160;乙</p>",
            "<p>\u{3000}\u{3000}丙</p>",
            "<p>   丁</p>",
        ];
        for c in cases {
            let (out, _) = normalize_structure(c, false);
            let inner = out.trim_start_matches("<p>").trim_end_matches("</p>");
            assert!(
                !inner.starts_with('&')
                    && !inner.starts_with(' ')
                    && !inner.starts_with('\u{3000}'),
                "仍残留段首空白：{out}"
            );
        }
    }

    #[test]
    fn 空段被删且计数() {
        let (out, fx) = normalize_structure("<p>甲</p><p>&nbsp;</p><p>   </p><p>乙</p>", false);
        assert!(!out.contains("<p></p>"), "不该留下空壳标签：{out}");
        assert_eq!(fx.empty_para, 2, "两个空段都要计上：{fx:?} / 输出 {out:?}");
        assert!(
            out.contains("甲") && out.contains("乙"),
            "正文一个字都不许丢"
        );
    }

    #[test]
    fn 连续换行冒充分段被折成多段() {
        let (out, fx) = normalize_structure("<p>第二段<br><br>第三段</p>", false);
        assert_eq!(fx.fake_break, 1);
        assert_eq!(out, "<p>第二段</p><p>第三段</p>");
    }

    #[test]
    fn 中西之间补薄空格而中文之间绝不补() {
        let (out, fx) = normalize_structure("<p>他用Vue写了三年</p>", true);
        assert_eq!(fx.pangu, 2, "只有 用|Vue 与 Vue|写 两处边界");
        assert!(
            out.contains("用\u{2009}Vue") && out.contains("Vue\u{2009}写"),
            "{out}"
        );
        assert!(!out.contains("他\u{2009}用"), "两个汉字之间不许插东西");
    }

    #[test]
    fn 幂等_再跑一遍不许再动() {
        let dirty = "<p>&nbsp;&nbsp;甲段</p><p>&nbsp;</p><p>乙段<br><br>丙段</p>";
        let (once, _) = normalize_structure(dirty, true);
        let (twice, fx2) = normalize_structure(&once, true);
        assert_eq!(twice, once, "不幂等会让重导产生字节噪音");
        assert_eq!(fx2.total(), 0, "第二遍不该再报改动：{fx2:?}");
    }

    #[test]
    fn 保守边界_标签与正文不许被动过() {
        let (out, _) = normalize_structure(
            "<p>他说<mark data-color=\"#f9a8d4\" style=\"color: inherit;\">谢谢</mark>完就走了</p>",
            false,
        );
        assert!(out.contains("data-color=\"#f9a8d4\""), "属性不许丢");
        assert!(
            out.contains("他说") && out.contains("完就走了"),
            "正文不许丢"
        );
    }

    #[test]
    fn 语种判定按内容不按键名() {
        assert_eq!(detect_lang("<p>她走了。</p>"), BookLang::Zh);
        assert_eq!(
            detect_lang("<p>She walked away and never came back.</p>"),
            BookLang::En
        );
        // 中文里夹术语仍算中文（阈值保守）
        assert_eq!(detect_lang("<p>他用 Vue 写了三年的书。</p>"), BookLang::Zh);
        // 空内容按严的一边
        assert_eq!(detect_lang(""), BookLang::Zh);
    }
}
