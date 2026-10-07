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
///   **短语气应答行例外**（[`is_retainable_tone_line`]）：“嗯。”“啊？”等独立成行的
///   语气应答行携带对话语义，不按噪声丢弃——暂存为跨段语气词，并入后续正文首句，
///   与既有短句合并规则一起形成 `“嗯。”他点点头，转身离开。` 式完整索引单元；
///   无法并入（EOF/章标题/后续语气行前）时按参考价值判级落库。
/// - **最小索引长度门槛**（[`super::reference::MIN_INDEX_CHARS`]）：有效字符 <3 的
///   句子（1–2 字碎片，如孤立落库的“嗯。”或“走吧。”）无论是否携带叙事信号，
///   导入即不入索引——解决全文检索命中单字/双字短句的问题；
/// - **参考价值过滤**（[`super::reference::tier_of`]）：导入以「供创作者参考」为目标，
///   合并后的索引单元无叙事信号且信息量不足（Low 层，如孤立的无引号语气词碎片）
///   不再入库。过滤发生在导入时，不改变库表结构与检索语义；
///   章标题行（[{ParsedChunk::kind}]=="chapter"）不经此过滤，始终保留。

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

/// 语气应答词闭合字符集（[`ONOMATOPOEIA`] 中携带人物对话应答语义的字符，
/// 独立成行时保留而非丢弃；拟声效果字符如 嘭/轰/咔嚓 不在此列，仍按噪声过滤）。
/// 依据：应答语气词（嗯/啊/哦…）通常引出后续动作或对话，并入后可形成
/// `“嗯。”他点点头。` 式完整检索单元；拟声行是孤立音效，不承载叙事语义。
const TONE_WORDS: &str = "嗯啊哦噢喔唉呃咦诶欸呀哇啦咧嘞喂哟唷呦";

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

/// 书外运营词（作者向读者求票/求订阅/汇报票数的运营商用语，小说正文零出现）。
/// 存量实证（斗破苍穹全本 corpus.db）：含「月票/推荐票/订阅/票票」任一子串的句子
/// 100% 为作者附言（求月票、拜求推荐票、求订阅、投一张票票等），正文叙事中的
/// 「票」均为打包票/售票台/投票/一票等剧情用法，不含上述运营词子串。
/// 与 [`WATERMARK_PHRASES`] 的区别：运营词判定不限短行（附言常长句），
/// 且为整行 contains 而非行首前缀——附言多以正文句开头（「四章已更，最后二十三小时
/// 求月票！」「另外,强烈的请求月票」），既有 starts_with 前缀判定全部漏网。
const OPERATION_WORDS: [&str; 4] = ["月票", "推荐票", "订阅", "票票"];

/// 非正文噪声判定（导入跳行与查重报告过滤共用）。依次判：
/// ① 去引号/标点/空白后为空（纯省略号/标点）或纯数字（页码）；
/// ② 剩余字符全部 ∈ 拟声/语气闭合集合（“嘭!”“嗯。”“轰隆隆!”“呼...”）；
/// ③ 作者更新注/求票（`（/(` 开头且前段含 更/票/订/求/爆/PS，或 「作者：」「上架感言」等起头）；
/// ④ 站点水印/页脚（短行内含 www./.com/「天才一秒记住」等短语）；
/// ⑤ 作者附言行首模板（不依赖括号开头）：裸行首「PS:」系附言、起点章尾广告
///    （「新书大主宰已发」「新书开张,请大家收藏」前缀）、整行圆括号包裹
///    （行首 (/( 且行尾 )/））——存量实证全部为作者言/广告，正文不以此起头。
///
/// 注意：本函数契约不含「短语气应答行」例外——[`is_retainable_tone_line`] 的
/// 放行只作用于语料导入的 [`parse_text`]，查重报告过滤仍原样丢弃这些行。
pub fn is_noise_text(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return true;
    }
    // ③ 作者更新注（括号/方括号开头且前段含 更/票/订/求/爆/PS）。
    // 支持「(第一更!」「（求月票）」「【第三更到，呐喊一声，月票~~~！」「[二更]」等；
    // 【 开头正文（「【系统提示】…」）前 12 字符不含这些词，不会误伤。
    if t.starts_with('（') || t.starts_with('(') || t.starts_with('【') || t.starts_with('[') {
        let head: String = t.chars().take(12).collect();
        if head.contains('更')
            || head.contains('票')
            || head.contains('订')
            || head.contains('求')
            || head.contains('爆')
            || head.contains("PS")
            || head.contains("ps")
            // 「(此章免费~」类起点免章声明：括号开头且前段含「免费」，
            // 正文内心独白不以「此章/本章免费」起头
            || head.contains("免费")
        {
            return true;
        }
    }
    // ⑤ 作者附言行首模板（不依赖括号开头，存量实证均为作者言/广告，正文不以此起头）：
    //   a) 裸行首「PS:」系附言——作者更新说明/求票/推书（「PS:一点左右还有更新。)」等），
    //      既有③仅在括号开头分支查 PS，裸行首完全不命中；变体含全角冒号与「再PS:」；
    //   b) 起点章尾广告模板——「新书大主宰已发」「新书开张,请大家收藏」行首，
    //      形如「新书大主宰已发,起点中文网首发,…您的支持,就是我最大的动力。」（79 字符超
    //      ④ 短行门槛漏网，须行首前缀拦截）；注意「新书开张了,不知不觉,…」为作者感言正文，
    //      前缀「新书开张,请大家收藏」不匹配「新书开张了」，不会误伤；
    //   c) 整行圆括号包裹（行首 (/( 且行尾 )/））——作者附言用整行括号括注的固定排版形态
    //      （「(请诸位看完后,顺手投几张推荐票吧,谢了。)」）；正文内心独白如「(杀?还是不杀?」
    //      未闭合括号不命中，不误伤；
    //   d) 书外运营词（月票/推荐票/订阅/票票）——作者向读者求票/求订阅/汇报票数的整句，
    //      存量实证（斗破苍穹全本）含这四词的句子 100% 为作者附言，正文零出现
    //      （正文中的「票」均为打包票/售票台/投票/一票等剧情用法，不含上述子串）；
    //      与既有③③/前缀模板互补：这些附言常以「四章已更，最后二十三小时求月票！」式
    //      正文句开头、或以「另外,强烈的请求月票」「继续求推荐票」「24小时订阅达到两万!」
    //      形态出现，既有 starts_with 前缀判定全部漏网，须整行 contains 拦截；
    //   e) 电子书版权门户行（行首「本书版权由」/「版权所有，未经书面许可」/「此电子书由」）
    //      ——全本电子书文件头/尾的出版方版权声明与公众号分享行（「此电子书由公众号：三秋君
    //      分享」）；注意「版权归作者所有，投稿请注明来源」类正文说明不以这些前缀起头，
    //      不受影响。存量实证其中「本书版权由…提供。2016」同行句号破句出「2016」纯数字
    //      碎句，行首前缀拦截后整行消失，附带清除该破句产物。
    if t.starts_with("PS:") || t.starts_with("PS：") || t.starts_with("ps:")
        || t.starts_with("ps：") || t.starts_with("Ps:") || t.starts_with("Ps：")
        || t.starts_with("pS:") || t.starts_with("pS：") || t.starts_with("再PS:")
        || t.starts_with("再PS：")
    {
        return true;
    }
    if t.starts_with("新书大主宰已发") || t.starts_with("新书开张,请大家收藏") {
        return true;
    }
    if (t.starts_with('(') && t.ends_with(')')) || (t.starts_with('（') && t.ends_with('）')) {
        return true;
    }
    // ⑥ 起点作者运营注裸行（不依赖括号/PS 开头，存量实证均为附言，正文零起头）：
    //   a) 更新注固定前缀——「继续码第X更!」「今日三更!」「今日继续三更!」
    //      「今天继续三更!」「还有一更!」：正文叙事句行首为动作/人物/对话，
    //      不含「码字更新」语义；行内后接长句求票（「今日三更,月票恐怕…」）
    //      同样以这些前缀起头，一并拦截；
    //   b) 完结感言/推书起头——「新书已发」「感言。」：书尾作者话固定模板，
    //      「感言。」独立行是资源站感言节起始，正文不以「感言。」起句；
    //   c) 短括句感谢——独立短行「鞠躬拜谢!)」「感谢大家!)」等：行尾 )/）
    //      但行首非（（⑤c 仅拦整行圆括号包裹），且含感恩词；正文人物致谢
    //      散落在叙事长行内，不会以「鞠躬/拜谢…!」孤行括句形态收尾。
    if t.starts_with("继续码")
        || t.starts_with("今日三更")
        || t.starts_with("今日继续三更")
        || t.starts_with("今天继续三更")
        || t.starts_with("还有一更")
        || t.starts_with("六更,继续码")
        || t.starts_with("新书已发")
        || t.starts_with("感言。")
    {
        return true;
    }
    if (t.ends_with(')') || t.ends_with('）'))
        && [
            "鞠躬", "拜谢", "感谢", "为了荣耀", "看大家", "大家", "万分感谢", "绝不",
            "土豆", "抱歉",
        ]
        .iter()
        .any(|w| t.contains(w))
    {
        return true;
    }
    // d) 书外运营词：整行 contains 拦截（正文零出现，见上注释）。
    if OPERATION_WORDS.iter().any(|w| t.contains(w)) {
        return true;
    }
    // e) 电子书版权门户行（行首模板）。
    if t.starts_with("本书版权由")
        || t.starts_with("版权所有，未经书面许可")
        || t.starts_with("此电子书由")
    {
        return true;
    }
    for p in [
        "作者：", "作者:", "作者的话", "本章说", "上架感言", "完本感言", "求月票", "求收藏",
        "求推荐", "求订阅", "求点击",
        // 求票短语变体（存量实证：求保底月票/求一声月票/求五百票 等短行）
        "求保底月票", "求声保底月票", "求一声月票", "求五百票",
    ] {
        if t.starts_with(p) {
            return true;
        }
    }
    // 卷标/版权页（独立短行的「VIP卷」「版权信息」；版权行精确匹配避免误伤
    // 「版权归作者所有」类正文说明）
    if t.starts_with("VIP卷") || t.starts_with("VIP 卷") || t == "版权信息" {
        return true;
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

/// 可保留的短语气应答行判定：被 [`is_noise_text`] 判噪声后特判——
/// 剥引号/标点/空白后非空、不超过 3 个字符、且全部字符 ∈ [`TONE_WORDS`]。
/// 命中则视为「人物应答/情绪语气」（“嗯。”“啊？”“嗯嗯。”），保留并入后续句子；
/// 拟声效果行（“嘭!”“轰隆隆!”）、多字语气（“嗯嗯嗯嗯。”）及内容词行
/// （“知道了。”）不满足条件，维持噪声过滤。
fn is_retainable_tone_line(raw: &str) -> bool {
    let content: String = raw
        .chars()
        .filter(|c| !(c.is_whitespace() || is_quote_or_punct(*c)))
        .collect();
    if content.is_empty() || content.chars().count() > 3 {
        return false;
    }
    content.chars().all(|c| TONE_WORDS.contains(c))
}

/// 纯感叹词行判定（“我的天！”“老天爷！”“哎呀妈呀！”等多字感叹）：
/// 剥引号/标点/空白后整体精确命中 [`super::reference::is_pure_exclamation`]。
/// 与短语气行（[`is_retainable_tone_line`]）互补：前者覆盖 ≤3 字纯语气字符，
/// 此判定覆盖含内容字（天/爷/家/伙…）的独立多字感叹——它们不命中
/// [`is_noise_text`] 的闭合字符集，须在正文分支前拦截，避免独立成句入索引。
/// 带正文的感叹句（「哎哟，这可不得了。」）剥离后为整串 ≠ 短语，不命中。
fn is_pure_exclamation_line(raw: &str) -> bool {
    !raw.trim().is_empty() && super::reference::is_pure_exclamation(raw)
}

/// 软标点（硬切超长句时的优先断点）。
fn is_soft_break(c: char) -> bool {
    matches!(c, '，' | '、' | '；' | '：' | ',' | ';' | ':')
}

/// 闭合引号/括号：句末终止符后紧跟这些字符时并入本句。
fn is_closing_quote(c: char) -> bool {
    matches!(c, '”' | '』' | '」' | '）' | '"' | '\'' | ')')
}

/// 对话开引号（进入对话模式）：中文成对开引号。
/// 命中后引号内（直至配对的 [`is_dialog_close`]）的句末终止符不触发切句，
/// 避免 `“萧媚,斗之气:七段!级别:高级!”` 这类台词被内部感叹号切碎。
fn is_dialog_open(c: char) -> bool {
    matches!(c, '“' | '‘' | '「' | '『')
}

/// 对话闭引号（退出对话模式）：与 [`is_dialog_open`] 成对的闭引号。
fn is_dialog_close(c: char) -> bool {
    matches!(c, '”' | '’' | '」' | '』')
}

/// 对话轮边界判定：`prev` 以闭引号结尾、且 `next` 以开引号开头时，
/// 是两个独立对话轮（敌我喊话、拍卖交替出价、同行连续两轮台词），
/// 段内合并与跨段并入都应保持分离、不粘合为一句
/// （“碎心掌!” 与 “劈石腿!” 各属不同对白轮次，不并成 “碎心掌!”“劈石腿!”）。
fn is_dialog_turn_boundary(prev: &str, next: &str) -> bool {
    matches!(prev.chars().next_back(), Some(c) if is_dialog_close(c))
        && matches!(next.chars().next(), Some(c) if is_dialog_open(c))
}

/// 常见卷章关键词（需后随空白或行尾，避免「尾声的…」被误判为标题）。
const CHAPTER_KEYWORDS: [&str; 10] = [
    "序章", "序言", "楔子", "引子", "前言", "尾声", "后记", "番外", "终章", "大结局",
];

/// 剥离行尾「【作者注」：从第一个「【」起截断（含其后全部），返回剩余部分。
/// 覆盖「第三百零八章 过于简单的第二轮【这算是第一千票的加更吧。」这类
/// 章节标题行混挂作者注的形态——去掉作者注尾巴后按标题入库。
/// 存量实证：正文「第X章【标题】」紧贴形态为 0，剥离安全。
fn strip_author_note(t: &str) -> &str {
    match t.find('【') {
        Some(i) => &t[..i],
        None => t,
    }
}

/// 章标题行判定：行首「第X章/回/节/卷/部/篇」、「Chapter N」或常见卷章关键词，
/// 剥离尾随「【作者注」后为标题结构，且剩余部分无正文句子终结标点（。…；）。
/// 返回剥离作者注后的净标题文本（如「第三百零八章 过于简单的第二轮」）；
/// 非标题行返回 None。
///
/// 标点规则说明：感叹/问号/逗号是章节标题的合法组成部分
/// （「第七章 休！」「第一百八十章 曾经的十大强者，冰皇！」），不拦截；
/// 句号/省略号/分号是正文句子的终结标志（防「第一章的内容很精彩，值得一看。」误判）。
pub fn clean_chapter_heading(line: &str) -> Option<&str> {
    let t = line.trim();
    if t.is_empty() || t.chars().count() > 50 {
        return None;
    }
    let core = strip_author_note(t).trim_end();
    if core.is_empty() || !is_heading_structure(core) {
        return None;
    }
    if core.chars().any(|c| matches!(c, '。' | '…' | '；')) {
        return None;
    }
    Some(core)
}

/// 章标题结构判定：仅判断「第X章/回/节/卷/部/篇」、「Chapter N」或常见卷章关键词
/// 的行首结构，不含标点检查（由 [`clean_chapter_heading`] 统一把关）。
fn is_heading_structure(t: &str) -> bool {
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

/// 章标题行判定（bool 版，保留旧契约）：剥离作者注后是否为标题行。
pub fn is_chapter_heading(line: &str) -> bool {
    clean_chapter_heading(line).is_some()
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
    /// 参考价值层级（[`super::reference`]）：供创作者参考的质量标注。
    /// 仅管线内可见——入库仍只写 kind/content/chapter_title 三列（索引形态不变）。
    pub tier: super::reference::ReferenceTier,
}

/// 把整本文本切分为句序列（含章标题行）。
pub fn parse_text(text: &str) -> Vec<ParsedChunk> {
    let mut out: Vec<ParsedChunk> = Vec::new();
    let mut current_chapter = String::new();
    // 段缓冲：按空行分段，段内切句
    let mut para = String::new();
    // 跨段语气词缓冲：独立成行的保留语气行（“嗯。”/“啊？”）直接暂存于此，
    // 待后续正文行并入（`“嗯。”` + `他点点头。` → 一个完整检索单元）；
    // 无法并入（章标题/EOF/后续语气行前）时经判级落库：有效字符 <3（Low）不入索引。
    let mut pending_tone: Option<String> = None;
    // 跨段段尾短句缓冲：段内合并后仍不足 MIN_MERGED_CHARS 的段尾短句
    // （独立成段的短对话行“八极崩!”、短叙述行“萧战苦笑道。”）暂存于此，
    // 待下一正文段首句并入（“萧战苦笑道。” + “是的,父亲!” → 一个完整检索单元）；
    // 无法并入（章标题/EOF/新短句/语气行前）时经 flush_pending_short 判级落库。
    let mut pending_short: Option<String> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            // 段尾若残留短句（独立成段的短对话/短叙述），暂存跨段并入；
            // 连续短句段不叠加：已有 pending 先判级落库，避免对话轮次粘连
            // （“八极崩!”“吹火掌!” 是两轮独立对话，非一句）。
            if let Some(short) = flush_paragraph(&para, &current_chapter, &mut out) {
                flush_pending_short(&mut pending_short, &current_chapter, &mut out);
                pending_short = Some(short);
            }
            para.clear();
            // 空行本身不触发放行语气词落库：pending 期待后续正文行并入；
            // 若始终无正文，后续章标题/EOF 分支统一按判级收口。
            continue;
        }
        if let Some(heading) = clean_chapter_heading(line) {
            // 标题行独立成章：先把前文收尾（不依赖空行分隔）
            if let Some(short) = flush_paragraph(&para, &current_chapter, &mut out) {
                // 段尾短句不跨章标题：直接判级落库（不并入标题后的正文，保持段落边界语义）
                flush_pending_short(&mut Some(short), &current_chapter, &mut out);
            }
            para.clear();
            // 跨段缓冲不跨标题：章标题前统一判级落库
            flush_pending_short(&mut pending_short, &current_chapter, &mut out);
            // 跨段语气词不跨标题：在章标题前判级落库（有效字符 <3 不入索引；
            // 这里不并入标题后的正文，保持段落边界语义）
            flush_pending_tone(&mut pending_tone, &current_chapter, &mut out);
            // 用剥离作者注后的净标题作为章标题（「第X章 标题【作者注】」→「第X章 标题」）
            current_chapter = heading.to_string();
            out.push(ParsedChunk {
                kind: "chapter",
                content: heading.to_string(),
                chapter_title: String::new(),
                // 章标题是导航结构，不入 sentence 评分，恒为 Highest（保留参考价值）
                tier: super::reference::ReferenceTier::High,
            });
            continue;
        }
        // 非正文噪声行（独立拟声/语气行、纯省略号、作者更新注、站点水印）：直接跳过，不入索引
        if is_noise_text(line) {
            // 短语气应答行（“嗯。”/“啊？”）例外：不丢弃，暂存为跨段语气词，
            // 后续正文行并入后按短句合并规则形成 `“嗯。”他点点头，转身离开。` 式
            // 完整检索单元；若始终无正文并入（章标题/EOF/后续语气行前），按判级落库。
            // 前文已有内容时先收尾，避免语气行粘连到前句末尾形成碎单元。
            if is_retainable_tone_line(line) {
                // 已有跨段 pending 语气词：先判级落库（新语气行开始新语义单元，不叠加；
                // 有效字符 <3 的孤立语气词不入索引）
                flush_pending_tone(&mut pending_tone, &current_chapter, &mut out);
                if !para.is_empty() {
                    if let Some(short) = flush_paragraph(&para, &current_chapter, &mut out) {
                        // 语气行前段落残留的短句：不跨语气行并入，直接落库
                        // （语气行开启新语义单元，避免短句粘连到语气行后正文）
                        flush_pending_short(&mut Some(short), &current_chapter, &mut out);
                    }
                    para.clear();
                }
                // 已有跨段 pending 短句：语气行开启新语义单元，先落库不叠加
                flush_pending_short(&mut pending_short, &current_chapter, &mut out);
                // 语气行直接进 pending：不经过 flush_paragraph 的 Low 过滤，
                // 保留跨段合并链（与正文行并入后统一判级，避免误伤““嗯。”他点点头。”）
                pending_tone = Some(line.to_string());
            }
            continue;
        }
        // 纯感叹词行（“我的天！”“老天爷！”“哎呀妈呀！”）：多字感叹词含非拟声字，
        // 不命中 is_noise_text 字符集，走正文分支会独立成句且因「天」等意象/叙事子串
        // 被 tier_of 误判 High 入索引。与语气行同待遇：暂存 pending 并入后续正文，
        // 形成「“我的天！”他猛地睁开眼。」式完整单元；无法并入（章标题/EOF）时
        // 经 tier_of 的纯感叹判定判 Low 丢弃。
        if is_pure_exclamation_line(line) {
            flush_pending_tone(&mut pending_tone, &current_chapter, &mut out);
            if !para.is_empty() {
                if let Some(short) = flush_paragraph(&para, &current_chapter, &mut out) {
                    flush_pending_short(&mut Some(short), &current_chapter, &mut out);
                }
                para.clear();
            }
            flush_pending_short(&mut pending_short, &current_chapter, &mut out);
            pending_tone = Some(line.to_string());
            continue;
        }
        // 正文行：若存在跨段 pending 语气词，先拼入本段开头，
        // 经短句合并规则与首句并成一个索引单元（“嗯。”+“他点点头。”→““嗯。”他点点头。”）
        // 对话轮守卫：交叉引用 [`is_dialog_turn_boundary`]——pending_short 以闭合引号
        // 结尾、且本行以开引号开头时是两个独立对话轮（敌我喊话、拍卖交替出价），
        // 不粘合为一句——先判级落库，后续行按自身语义处理
        // （“八极崩!” 与 “吹火掌!” 各属不同对白轮次）。
        if let Some(short) = &pending_short {
            if is_dialog_turn_boundary(short, line) {
                flush_pending_short(&mut pending_short, &current_chapter, &mut out);
            }
        }
        if let Some(short) = pending_short.take() {
            // 跨段段尾短句并入本段首句：独立成段的短对话/短叙述行不再单独成句，
            // 而是作为段首前缀与后续正文合成完整检索单元
            // （“萧战苦笑道。”+“是的,父亲!”→“萧战苦笑道。“是的,父亲!””）。
            if !para.is_empty() {
                // 防御：理论不可达（pending_short 只在 para 清空后暂存）
                if let Some(tail) = flush_paragraph(&para, &current_chapter, &mut out) {
                    pending_short = Some(tail);
                }
                para.clear();
            }
            para.push_str(&short);
        }
        if let Some(tone) = pending_tone.take() {
            if !para.is_empty() {
                // 防御：理论不可达（pending_tone 只在 para 清空后暂存）
                if let Some(tail) = flush_paragraph(&para, &current_chapter, &mut out) {
                    pending_short = Some(tail);
                }
                para.clear();
            }
            para.push_str(&tone);
        }
        // 段内软换行拼接：仅英文（两侧端点均为 ASCII 字母/数字）补空格，
        // 中文等非空格分词语种直接相连，避免词内插空格破坏子串检索。
        if !para.is_empty() && needs_space_join(&para, line) {
            para.push(' ');
        }
        para.push_str(line);
    }
    if let Some(short) = flush_paragraph(&para, &current_chapter, &mut out) {
        flush_pending_short(&mut Some(short), &current_chapter, &mut out);
    }
    // 文件结尾：pending 段尾短句与语气词判级落库（有效字符 <3 的碎片不入索引；
    // 有正文并入的合并单元已在 flush_paragraph 中按完整内容判级）
    flush_pending_short(&mut pending_short, &current_chapter, &mut out);
    flush_pending_tone(&mut pending_tone, &current_chapter, &mut out);
    out
}

/// 跨段语气词落库：按 [`super::reference::tier_of`] 判级（含 MIN_INDEX_CHARS
/// 长度门槛），Low（有效字符 <3 的孤立语气词）不入索引；非 Low 保留为独立单元。
/// 调用点：章标题前 / 后续语气行前 / EOF——即语气词确定无法与正文并入的时刻。
fn flush_pending_tone(
    pending: &mut Option<String>,
    chapter: &str,
    out: &mut Vec<ParsedChunk>,
) {
    if let Some(tone) = pending.take() {
        let tier = super::reference::tier_of(&tone);
        if tier != super::reference::ReferenceTier::Low {
            out.push(ParsedChunk {
                kind: "sentence",
                content: tone,
                chapter_title: chapter.to_string(),
                tier,
            });
        }
    }
}

/// 段落收尾：段内切句；短句（< [`MIN_MERGED_CHARS`]）并入下一句，
/// 让索引单元尽量是「一句完整的话」（“嗯。”他点点头，转身离开。 → 一个检索单元）。
///
/// 返回值：**段尾残留短句**——段内合并后最后一句仍不足 [`MIN_MERGED_CHARS`]
/// （典型如独立成段的短对话行“八极崩!”、短叙述行“萧战苦笑道。”，段内没有
/// 下一句可并入）。由调用方暂存 [`parse_text`] 的 `pending_short`，等待后续
/// 正文段首句拼入（“萧战苦笑道。” + “是的…” → “萧战苦笑道。“是的…”” 一个索引单元）；
/// 无后续正文（章标题/EOF/新语气行前）时经 [`flush_pending_short`] 判级落库。
fn flush_paragraph(para: &str, chapter: &str, out: &mut Vec<ParsedChunk>) -> Option<String> {
    if para.trim().is_empty() {
        return None;
    }
    let mut merged: Vec<String> = Vec::new();
    for s in split_sentences(para) {
        match merged.last_mut() {
            // 上一单元仍不足一句 → 就近续上（段内补全；续后仍短则继续吸收下一句）。
            // 守卫：prev 以闭引号结尾、s 以开引号开头时是两个独立对话轮
            // （同行双轮 `“碎心掌!”“劈石腿!”`），不粘合成一句。
            Some(prev)
                if prev.chars().count() < MIN_MERGED_CHARS
                    && !is_dialog_turn_boundary(prev, &s) =>
            {
                if needs_space_merge(prev, &s) {
                    prev.push(' ');
                }
                prev.push_str(&s);
            }
            _ => merged.push(s),
        }
    }
    // 段尾短句弹出：交给跨段并入（爪本段没有后续宾语，段内存并无法吸收）。
    let tail = merged
        .last()
        .filter(|s| s.chars().count() < MIN_MERGED_CHARS)
        .cloned();
    if tail.is_some() {
        merged.pop();
    }
    for content in merged {
        // 参考价值过滤（供创作者参考）：Low 层（无叙事信号且信息量不足的碎片）
        // 不进入索引。过滤只发生在导入时，不改变索引形态与检索语义；
        // 与 `is_noise_text`（格式/站点噪声）是互补的两层。
        let tier = super::reference::tier_of(&content);
        if tier == super::reference::ReferenceTier::Low {
            continue;
        }
        out.push(ParsedChunk {
            kind: "sentence",
            content,
            chapter_title: chapter.to_string(),
            tier,
        });
    }
    tail
}

/// 跨段段尾短句落库：按 [`super::reference::tier_of`] 判级（含 MIN_INDEX_CHARS
/// 长度门槛），Low（有效字符 <3 的孤立碎片）不入索引；非 Low 保留为独立单元。
/// 调用点：章标题前 / 新语气行前 / 新段尾短句前 / EOF——即短句确定无法与
/// 后续正文并入的时刻。
fn flush_pending_short(
    pending: &mut Option<String>,
    chapter: &str,
    out: &mut Vec<ParsedChunk>,
) {
    if let Some(short) = pending.take() {
        let tier = super::reference::tier_of(&short);
        if tier != super::reference::ReferenceTier::Low {
            out.push(ParsedChunk {
                kind: "sentence",
                content: short,
                chapter_title: chapter.to_string(),
                tier,
            });
        }
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
///
/// 对话模式：遇中文成对开引号（“『「‘）进入引号深度计数，引号内的
/// 句末终止符（。！？…）不再在出现处触发切句——一段台词内部的感叹/问号/
/// 省略号是语气而非句界（`“萧媚,斗之气:七段!级别:高级!”` 不再被切碎）。
/// 切句点延迟到闭引号（”』」’）：闭引号使深度归零时，若缓冲内容以句末
/// 终止符结尾（`“走吧。”` `“快!”` `“也许吧……”`），在此切句——保留 `。”`
/// 原有句界语义（整句台词完整切出），又不会因台词内部标点切出碎片。
/// 同行双轮边界：闭引号归零后，若下一个非空白字符是开引号
/// （`“碎心掌!”“劈石腿!”`），也在闭引号处切句，两轮独立对话不粘合。
/// 超长硬切（[`MAX_SENTENCE_CHARS`]）在对话内外均生效。
fn split_sentences(para: &str) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut chars = para.chars().peekable();
    let mut quote_depth: u32 = 0;

    while let Some(c) = chars.next() {
        buf.push(c);
        if is_dialog_open(c) {
            quote_depth += 1;
        } else if is_dialog_close(c) {
            quote_depth = quote_depth.saturating_sub(1);
            // 闭引号退出对话模式后，在此处依据两条件决定是否切句：
            // ① 缓冲以句末终止符结尾（“走吧。”→ 整句台词收束）；
            // ② 下一个非空白字符是开引号（同行双轮，“碎心掌!” “劈石腿!”）。
            if quote_depth == 0 {
                // 闭引号已 push 进 buf；判断其**前一个**字符（台词尾标点）是否为终止符
                let buf_ends_terminator =
                    matches!(buf[..buf.len() - c.len_utf8()].chars().next_back(),
                        Some(ch) if is_sentence_terminator(ch));
                let mut rest = chars.clone();
                let mut next_char = None;
                for n in rest.by_ref() {
                    if !n.is_whitespace() {
                        next_char = Some(n);
                        break;
                    }
                }
                if buf_ends_terminator || matches!(next_char, Some(n) if is_dialog_open(n)) {
                    push_sentence(&mut sentences, &mut buf);
                    continue;
                }
            }
        } else if is_sentence_terminator(c) {
            if quote_depth == 0 {
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
                continue;
            }
            // 对话内部终止符：不在此处切句（语气而非句界），
            // 延迟到闭引号退出后按上文规则切（buf 仍以终止符结尾）。
        }
        if buf.chars().count() >= MAX_SENTENCE_CHARS {
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

    /// 章标题可含感叹/问号/逗号（真实章节名常见形态），不再因句读标点被当正文：
    /// 「第七章 休！」「第五十章 帮？」「第一百八十章 曾经的十大强者，冰皇！」。
    /// 句号/省略号/分号仍是正文句子终结标志，维持拒判守卫。
    #[test]
    fn chapter_heading_allows_exclamation_question_comma() {
        for h in [
            "第七章 休！",
            "第九章 药老！",
            "第五十章 帮？",
            "第一百八十章 曾经的十大强者，冰皇！",
            "第三百零五章 第一轮，开始！",
            "第四百二十五章 分赃，养伤",
            "第一章：出山！",
        ] {
            assert!(is_chapter_heading(h), "should be heading: {h}");
        }
        for b in [
            "第一章的内容很精彩，值得一看。",
            "第五章 内容很精彩……",
            "第二章 他说的；她没答。",
            "第二天他醒来。",
            "第七章 的正文片段，他说道。",
        ] {
            assert!(!is_chapter_heading(b), "should NOT be heading: {b}");
        }
    }

    /// 章标题行混挂作者注：剥离「【…」尾巴后按净标题入库（存量大量形态，
    /// 如「第三百零八章 过于简单的第二轮【这算是第一千票的加更吧。」）。
    #[test]
    fn chapter_heading_strips_author_note() {
        use super::super::reference::ReferenceTier;
        assert_eq!(
            clean_chapter_heading("第三百零八章 过于简单的第二轮【这算是第一千票的加更吧。"),
            Some("第三百零八章 过于简单的第二轮"),
        );
        assert_eq!(
            clean_chapter_heading("第三百四十四章 一触即发【第一更，求保底月票！"),
            Some("第三百四十四章 一触即发"),
        );
        assert_eq!(clean_chapter_heading("第一章 出山"), Some("第一章 出山"));
        assert_eq!(clean_chapter_heading("第一章的内容很精彩，值得一看。"), None);
        assert_eq!(clean_chapter_heading("……"), None);

        // parse_text 集成：净标题入 chapter，作者注不混入标题内容
        let chunks = parse_text(
            "第一章 出山\n\n山风很大。\n\n第二章 入世【第三更！】\n\n他点点头。",
        );
        assert!(chunks
            .iter()
            .any(|c| c.kind == "chapter" && c.content == "第二章 入世"),
            "got: {chunks:?}"
        );
        assert!(!chunks.iter().any(|c| c.content.contains('更')), "got: {chunks:?}");
        assert!(chunks
            .iter()
            .any(|c| c.kind == "sentence" && c.content == "他点点头。"),
            "got: {chunks:?}"
        );
        // 章标题 tier 恒 High 的既有契约保持
        let chap = chunks.iter().find(|c| c.kind == "chapter").unwrap();
        assert_eq!(chap.tier, ReferenceTier::High);
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
            "【系统提示】你获得了新任务", "【我要让世界面临一股狂潮——炼金狂潮!!",
        ] {
            assert!(!is_noise_text(k), "should NOT be noise: {k}");
        }
    }

    /// 作者附言行首模板（不依赖括号）：裸「PS:」系、起点章尾广告、整行圆括号包裹
    /// 均判噪声；正文内心独白（未闭合括号）、作者感言正文（“新书开张了…”）不误伤。
    #[test]
    fn noise_author_note_line_templates() {
        for n in [
            "PS:一点左右还有更新。)",
            "PS：新的一周,请诸位看完后,顺手投几张推荐票吧。",
            "ps:新书已上传。",
            "ps：明天恢复正常更新。",
            "Ps:今日两更。",
            "Ps：抱歉,晚了点。",
            "pS:求推荐票。",
            "再PS:继续码第三章。",
            "再PS：下一章十点前。",
            "新书大主宰已发。",
            "新书大主宰已发,起点中文网首发,请大家支持。(未完待续。如果您喜欢这部作品,欢迎您来起点(qidian.com)投推荐票、月票,您的支持,就是我最大的动力。)",
            "新书开张,请大家收藏与推荐新书,感谢。",
            "(请诸位看完后,顺手投几张推荐票吧,谢了。)",
            "(晚上还有。)",
            "（新的一周,请诸位投一张推荐票,谢谢。）",
            "(第二更,九点左右。)",
        ] {
            assert!(is_noise_text(n), "should be noise: {n}");
        }
        for k in [
            "(杀?还是不杀?",
            "(高潮终于即将来到!",
            "(丹会终于是开始~~~~",
            "新书开张了,不知不觉,这是我的第四本小说了。",
            "PSP 游戏机摆在一旁。",
        ] {
            assert!(!is_noise_text(k), "should NOT be noise: {k}");
        }
    }

    /// 作者更新注扩展形态：方括号开头（【三更合一/【第三更到/【拉推荐票）与
    /// 求票短语变体（求保底月票/求声保底月票）均按噪声过滤；卷标/版权行同样过滤。
    #[test]
    fn noise_bracket_author_notes_and_vote_variants() {
        for n in [
            "【三更合一，包括了五百票的加更！",
            "【两更合一！",
            "【第三更到，呐喊一声，月票~~~！",
            "【拉推荐票！谢谢！",
            "【拉推荐票！",
            "【七千字，月中求月票！",
            "【抱歉，这是昨天第三更，我囧！",
            "[第二更到!",
            "求保底月票！",
            "求保底月票,感谢大家!!!!)",
            "求声保底月票,谢谢大家!)",
            "求一声月票,谢谢大家。)",
            "求五百票!",
            "VIP卷",
            "VIP 卷",
            "版权信息",
            "求月票！",
            "求收藏！",
        ] {
            assert!(is_noise_text(n), "should be noise: {n}");
        }
        // 误伤守卫：正文中以【或求开头的正常句、建议类正文、卷名正文不被过滤
        for k in [
            "【系统提示】你获得了新任务",
            "【我要让世界面临一股狂潮——炼金狂潮!!",
            "求你了，别走。",
            "求一个痛快。",
            "求他帮忙把剑拔出来。",
            "求收下这份心意。",
            "版权归作者所有，投稿请注明来源",
            "第二天他醒来。",
        ] {
            assert!(!is_noise_text(k), "should NOT be noise: {k}");
        }
    }

    /// 书外运营词（月票/推荐票/订阅/票票）与电子书版权门户行——
    /// 存量实证（斗破苍穹全本，重建后 100800 chunks）：
    /// - 含运营词子串的句子 100% 为作者求票/求订阅/汇报票数附言（376 条），正文零出现；
    ///   「四章已更，最后二十三小时求月票！」式正文句开头、「继续求推荐票!」式变体、
    ///   纯「推荐票!!!!!!!!!!)」咆哮行均由此整行 contains 拦截，既有 starts_with 前缀漏网；
    /// - 版权门户行「本书版权由…」「版权所有，未经书面许可…」「此电子书由公众号…」
    ///   为全本电子书文件头/尾元数据（4 条）；「本书版权由…提供。2016」同行破句出的
    ///   纯数字碎句「2016」随行首前缀拦截整行而一并消失。
    /// 误伤守卫：正文「打包票/售票台/投票/一票」等剧情「票」字用法不含上述运营词子串；
    /// 未闭合括号的正文内心独白「(杀?还是不杀?」不含运营词，不受影响。
    #[test]
    fn noise_operation_words_and_copyright_pages() {
        for n in [
            // 运营词：臆求票开头的正文句 + 变体 + 汇报票数
            "四章已更，最后二十三小时求月票！",
            "三章已更，月初拜求诸位弟兄手中保底月票！",
            "另外,强烈的请求月票,最后三天了,请大家月票砸过来吧!!!)",
            "最后八天时间,拜求一声月票!)",
            "诸位弟兄,拜求月票,推荐票~~~~~)",
            "再求月票!!)",
            "继续拜求月票!!!!!!!)",
            "拜求月票!)",
            "另外再求月票!)",
            "继续求月票~~~~)",
            "继续求推荐票!",
            "推荐票!!!!!!!!!!)",
            "继续嘶吼着拜求大家手中的月票,推荐票!",
            "月末很少三更,求月票倒是其次,更多的,还是想用这法子倒是强迫着自己安静坐着码字,稍稍对过年期间的更新速度做一些补偿。",
            "另外,在这里推荐一本书,【星际屠夫】,作者罗霸道是土豆朋友,而且书也的却不错,如今他正在冲击破万大关,所以土豆恳请诸位斗破的读者,若是有VIP账号的话,希望你们能够订阅一下他VIP章节的第一章",
            "24小时订阅达到两万!",
            "呵呵,诸位弟兄,请用票票来决定云山的该死程度,想他死得异常凄惨,有月票的弟兄便砸一张,没有月票的弟兄,就用推荐票砸一下!",
            "最后六小时,诸位弟兄,再嚎一声票票~~~~~)",
            "战斗激烈,也拜托大家为斗破投上一张票票,为萧炎助威吧!!)",
            // 电子书版权门户行
            "本书版权由上海阅文信息技术有限公司提供。",
            "版权所有，未经书面许可，不得转载、复制，违者必究",
            "此电子书由公众号：三秋君分享",
        ] {
            assert!(is_noise_text(n), "should be noise: {n}");
        }
        // 误伤守卫：正文「票」字剧情用法、正文内心独白、作者感言正文均不命中运营词
        for k in [
            "“所以,整个斗气大陆我不敢说,不过这加玛帝国,我却能打包票,没人能够炼制出与我相同的筑基灵液!”",
            "炼制二品的丹药,有着不小的失败率,即使现在在场的一些炼药师,那也不敢打包票的说自己炼制二品丹药能够达到五成以上的成功率!",
            "愕然的望着这一幕,半晌后,萧炎苦笑着摇了摇头,拉着一位路人,问清购票地点之后,这才渡着步子来到广场东南角落的一处售票台处",
            "此时的售票台之前,正排着长长的队伍,见状,萧炎也只得无奈的在那队伍之后安静的等待着。",
            "闻言,女子微微撇了撇嘴,低声嘀咕了几声,然后扯出一张用特殊的魔兽皮毛制作而成的票单,不过就在她即将递给萧炎之时,不耐移动",
            "站在一旁,青鳞望着脸色急速变幻的萧炎,也是一片忐忑,对于火灵蛇传过来的消息,她也是不敢打包票,若是萧炎真的跳了下去出现了",
            "“说句让你挺伤心的话,在岩枭未出现之前,如果是在家族内部长老会上投票选择最适合你的人,恐怕木战将会有超过大半的得票,因为",
            "(杀?还是不杀?",
            "(高潮终于即将来到!",
            "新书开张了,不知不觉,这是我的第四本小说了。",
            "版权归作者所有，投稿请注明来源",
        ] {
            assert!(!is_noise_text(k), "should NOT be noise: {k}");
        }
    }

    /// 短语气应答行保留判定：仅纯语气词（含引号/标点）短行放行；
    /// 拟声效果行、多字语气、内容词行、作者注均不放行。
    #[test]
    fn retainable_tone_line_guards() {
        for keep in ["“嗯。”", "“啊？”", "“嗯嗯。”", "“喂？”", "“唉……”"] {
            assert!(is_retainable_tone_line(keep), "should keep: {keep}");
        }
        for drop in [
            "“轰隆隆!”",
            "“嘭！”",
            "“嗯嗯嗯嗯。”",
            "“知道了。”",
            "“嗤!”",
            "(第一更!",
            "作者：天蚕土豆",
            "……",
        ] {
            assert!(!is_retainable_tone_line(drop), "should drop: {drop}");
        }
    }

    /// 独立成行的短语气应答行不再丢弃，与后续句子合并成一个索引单元。
    #[test]
    fn standalone_tone_line_merges_with_following_sentence() {
        let chunks = parse_text("“嗯。”\n他点点头，转身离开。");
        assert!(
            chunks
                .iter()
                .any(|c| c.content == "“嗯。”他点点头，转身离开。"),
            "got: {chunks:?}"
        );
        // 不产出孤立的“嗯。”碎单元
        assert!(!chunks.iter().any(|c| c.content == "“嗯。”"), "got: {chunks:?}");
    }

    /// 语气词行前已有正文时：前文先收尾成单元，语气词作为新段起点并入后续句。
    #[test]
    fn tone_line_after_previous_text_starts_new_unit() {
        let chunks = parse_text("山风很大。\n“啊？”\n他回头看了一眼。");
        assert!(chunks.iter().any(|c| c.content == "山风很大。"), "got: {chunks:?}");
        assert!(
            chunks.iter().any(|c| c.content == "“啊？”他回头看了一眼。"),
            "got: {chunks:?}"
        );
    }

    /// 空行分隔的独立语气词段：跨段并入下一段首句，形成完整索引单元（不丢弃、不孤立）。
    #[test]
    fn tone_line_in_own_paragraph_is_kept() {
        let text = "“嗯。”\n\n他点点头。";
        let chunks = parse_text(text);
        assert!(
            chunks.iter().any(|c| c.content == "“嗯。”他点点头。"),
            "got: {chunks:?}"
        );
        // 不再产出孤立的“嗯。”碎单元
        assert!(!chunks.iter().any(|c| c.content == "“嗯。”"), "got: {chunks:?}");
    }

    /// 跨段语气词后无正文（文末落款）：EOF 落库时按判级过滤——
    /// 有效字符 <MIN_INDEX_CHARS 的孤立语气词（“嗯。”，1 字）不入索引。
    #[test]
    fn tone_line_at_eof_short_is_filtered_out() {
        let text = "他点点头。\n\n“嗯。”";
        let chunks = parse_text(text);
        assert!(chunks.iter().any(|c| c.content == "他点点头。"), "got: {chunks:?}");
        assert!(
            !chunks.iter().any(|c| c.content == "“嗯。”"),
            "got: {chunks:?}"
        );
    }

    /// 跨段语气词遇章标题：不跨标题合并，且孤立语气词（有效字符 <MIN_INDEX_CHARS）
    /// 在章标题前判级落库被过滤——不并入标题后的正文，也不留独立碎单元。
    #[test]
    fn tone_line_does_not_cross_chapter_heading() {
        let text = "“嗯。”\n\n第二章 入世\n\n他点点头。";
        let chunks = parse_text(text);
        // 孤立“嗯。”有效字符 1 <3：不入索引（即无独立 tone 单元、也不并入标题后正文）
        assert!(
            !chunks.iter().any(|c| c.content == "“嗯。”"),
            "got: {chunks:?}"
        );
        assert!(
            chunks
                .iter()
                .any(|c| c.kind == "chapter" && c.content == "第二章 入世"),
            "got: {chunks:?}"
        );
        assert!(chunks.iter().any(|c| c.content == "他点点头。"), "got: {chunks:?}");
        // 不与标题后正文合并（不跨标题粘合）
        assert!(
            !chunks.iter().any(|c| c.content.contains("“嗯。”他点点头")),
            "got: {chunks:?}"
        );
    }

    /// 连续两个跨段语气行：第二个语气行开始新语义单元，第一行（有效字符 <3）
    /// 在判级落库时被过滤不叠加；第二行与后续正文正常合并。
    #[test]
    fn consecutive_tone_lines_do_not_stack() {
        let text = "“嗯。”\n\n“啊？”\n\n他点点头。";
        let chunks = parse_text(text);
        // 第一行孤立“嗯。”有效字符 1 <3 → 不入索引
        assert!(
            !chunks.iter().any(|c| c.content == "“嗯。”"),
            "got: {chunks:?}"
        );
        // 第二行“啊？”与正文合并为完整单元（有效字符达标，保留）
        assert!(
            chunks.iter().any(|c| c.content == "“啊？”他点点头。"),
            "got: {chunks:?}"
        );
    }

    /// 拟声效果行（独立成段或与语气词混合）仍按噪声丢弃——与既有契约一致。
    #[test]
    fn onomatopoeia_lines_still_dropped() {
        let text = "“嘭！”\n\n“轰隆隆!”\n\n山风很大。";
        let chunks = parse_text(text);
        assert!(!chunks.iter().any(|c| c.content.contains('嘭')), "got: {chunks:?}");
        assert!(!chunks.iter().any(|c| c.content.contains('轰')), "got: {chunks:?}");
        assert!(chunks.iter().any(|c| c.content == "山风很大。"), "got: {chunks:?}");
    }

    /// 多字感叹词行（“我的天！”）：不命中噪声字符集（含非拟声字），
    /// 独立成行时与短语气行同待遇——暂存 pending 并入后续正文，
    /// 形成「“我的天！”他猛地睁开眼。」式完整检索单元，不再独立成句。
    #[test]
    fn exclamation_line_merges_with_following_sentence() {
        let chunks = parse_text("“我的天！”\n他猛地睁开眼。");
        assert!(
            chunks
                .iter()
                .any(|c| c.content == "“我的天！”他猛地睁开眼。"),
            "got: {chunks:?}"
        );
        assert!(
            !chunks.iter().any(|c| c.content == "“我的天！”"),
            "got: {chunks:?}"
        );
    }

    /// 感叹词行紧邻正文行（无空行分隔）同样并入，不因缺失短句合并触发条件而孤立。
    #[test]
    fn exclamation_line_merges_without_blank_line() {
        let chunks = parse_text("“老天爷！”\n轰的一声，巨掌拍落。");
        assert!(
            chunks
                .iter()
                .any(|c| c.content == "“老天爷！”轰的一声，巨掌拍落。"),
            "got: {chunks:?}"
        );
    }

    /// 感叹词行前已有正文：前文先收尾成单元，感叹词作为新段起点并入后续句。
    #[test]
    fn exclamation_line_after_previous_text_starts_new_unit() {
        let chunks = parse_text("山风很大。\n“哎呀妈呀！”\n他连退三步。");
        assert!(chunks.iter().any(|c| c.content == "山风很大。"), "got: {chunks:?}");
        assert!(
            chunks
                .iter()
                .any(|c| c.content == "“哎呀妈呀！”他连退三步。"),
            "got: {chunks:?}"
        );
    }

    /// EOF 孤立感叹词（文末落款）：经 tier_of 纯感叹判定判 Low 不入索引，
    /// 有正文并入的合并单元正常保留。
    #[test]
    fn exclamation_line_at_eof_is_filtered_out() {
        let chunks = parse_text("他点点头。\n\n“我的天！”");
        assert!(chunks.iter().any(|c| c.content == "他点点头。"), "got: {chunks:?}");
        assert!(
            !chunks.iter().any(|c| c.content == "“我的天！”"),
            "got: {chunks:?}"
        );
    }

    /// 感叹词行遇章标题：不跨标题合并；孤立感叹词（纯感叹判 Low）在章标题前
    /// 判级落库被过滤——不入索引，也不并入标题后的正文。
    #[test]
    fn exclamation_line_does_not_cross_chapter_heading() {
        let text = "“我的天！”\n\n第二章 入世\n\n他点点头。";
        let chunks = parse_text(text);
        assert!(
            !chunks.iter().any(|c| c.content == "“我的天！”"),
            "got: {chunks:?}"
        );
        assert!(
            chunks
                .iter()
                .any(|c| c.kind == "chapter" && c.content == "第二章 入世"),
            "got: {chunks:?}"
        );
        assert!(chunks.iter().any(|c| c.content == "他点点头。"), "got: {chunks:?}");
        assert!(
            !chunks.iter().any(|c| c.content.contains("“我的天！”他点点头")),
            "got: {chunks:?}"
        );
    }

    /// 连续两个感叹词行：第二个开始新语义单元，第一个（纯感叹判 Low）
    /// 在判级落库时被过滤不叠加；第二个与后续正文正常合并。
    #[test]
    fn consecutive_exclamation_lines_do_not_stack() {
        let text = "“我的天！”\n\n“老天爷！”\n\n他连退三步。";
        let chunks = parse_text(text);
        assert!(
            !chunks.iter().any(|c| c.content == "“我的天！”"),
            "got: {chunks:?}"
        );
        assert!(
            chunks
                .iter()
                .any(|c| c.content == "“老天爷！”他连退三步。"),
            "got: {chunks:?}"
        );
    }

    /// 带正文的感叹句（“哎哟，这可不得了。”）剥离后为整串 ≠ 感叹短语，
    /// 不被误判为纯感叹行，正常按正文处理。
    #[test]
    fn exclamation_with_body_is_not_pure_line() {
        let chunks = parse_text("“哎哟，这可不得了。”\n他赶紧扶住桌子。");
        assert!(chunks.iter().any(|c| c.content.contains("这可不得了")), "got: {chunks:?}");
    }

    /// 纯感叹词行判定：多字感叹短语整体命中；带正文、纯数字、空行不命中。
    #[test]
    fn pure_exclamation_line_guards() {
        for keep in ["“我的天！”", "我的天！", "「老天爷！」", "“哎呀妈呀！”", "好家伙！"] {
            assert!(is_pure_exclamation_line(keep), "should keep: {keep}");
        }
        for drop in [
            "“哎哟，这可不得了。”",
            "“嗯。”",
            "“嗯嗯嗯嗯。”",
            "123456",
            "……",
            "作者：天蚕土豆",
        ] {
            assert!(!is_pure_exclamation_line(drop), "should drop: {drop}");
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

    /// 参考价值过滤：无叙事信号且信息量不足的碎片（Low 层）不入 parse_text 输出；
    /// 章标题与叙事正文不受影响；带引号的对话语气词（High）保留。
    #[test]
    fn low_reference_value_fragments_are_filtered() {
        use super::super::reference::ReferenceTier;
        // 无引号孤立语气词“嗯。”单独成段 → Low 过滤；章标题（chapter）不经评分，始终保留
        let chunks = parse_text("第一章 出山\n\n嗯。");
        assert!(!chunks.iter().any(|c| c.content == "嗯。"), "got: {chunks:?}");
        assert!(chunks.iter().any(|c| c.kind == "chapter"), "got: {chunks:?}");
        // 叙事正文（High/Medium）保留
        let chunks2 = parse_text("山风很大。他回头看了一眼，脚下是万丈深渊！");
        assert_eq!(chunks2.len(), 1, "got: {chunks2:?}");
        // 带引号的对话语气词跨段并入后仍保留（High 对话信号，不因评分被过滤）
        let chunks3 = parse_text("“嗯。”\n\n他点点头。");
        assert!(
            chunks3
                .iter()
                .any(|c| c.content == "“嗯。”他点点头。" && c.tier == ReferenceTier::High),
            "got: {chunks3:?}"
        );
    }

    /// 质量分层标注：章标题恒 High；叙事/对话/描写句 High；普通完整句 Medium；均保留。
    #[test]
    fn sentence_tiers_are_tagged_on_chunks() {
        use super::super::reference::ReferenceTier;
        let chunks = parse_text("第一章 出山\n\n山风很大。他回头看了一眼，脚下是万丈深渊！\n\n孤独是宿命……");
        // 章标题：导航结构，恒 High
        assert_eq!(chunks[0].tier, ReferenceTier::High);
        // 叙事+意象句 → High
        assert_eq!(chunks[1].tier, ReferenceTier::High);
        // 无信号但信息量充分的普通句 → Medium，仍保留
        assert_eq!(chunks[2].tier, ReferenceTier::Medium);
        assert!(chunks.iter().all(|c| c.tier != ReferenceTier::Low));
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

    // ===== 段尾短句跨段并入（短句/语气词/对话不单独成句） =====

    /// 独立成段的短叙述行（段尾短句）跨段并入后续对话首句：
    /// 「萧战苦笑道。」+「“是的,父亲,还有一年!”」→ 一个完整检索单元。
    #[test]
    fn cross_para_short_narrative_merges_into_dialogue() {
        let chunks = parse_text("萧战苦笑道。\n\n“是的,父亲,还有一年!”");
        assert!(
            chunks
                .iter()
                .any(|c| c.content == "萧战苦笑道。“是的,父亲,还有一年!”"),
            "got: {chunks:?}"
        );
        assert!(
            !chunks.iter().any(|c| c.content == "萧战苦笑道。"),
            "got: {chunks:?}"
        );
    }

    /// 独立成段的短对话行跨段并入后续叙述首句：
    /// 「“两万五!”」+「加列毕笑道。」→「“两万五!”加列毕笑道。」。
    #[test]
    fn cross_para_short_dialogue_merges_into_narrative() {
        let chunks = parse_text("“两万五!”\n\n加列毕笑道。");
        assert!(
            chunks
                .iter()
                .any(|c| c.content == "“两万五!”加列毕笑道。"),
            "got: {chunks:?}"
        );
    }

    /// 连续两个独立短对话段（对话轮）：不跨段粘合为一句——
    /// “八极崩!” 以闭合引号结尾、下一行 “吹火掌!” 以开引号开头 → 对话轮守卫生效，
    /// 前一轮判级落库（High），后一轮并入后续叙述正文。
    #[test]
    fn consecutive_short_dialogue_paras_do_not_stack() {
        let chunks = parse_text("“八极崩!”\n\n“吹火掌!”\n\n萧炎身形一动。");
        // 第一轮不并入第二轮（独立对话轮），判级落库保留
        assert!(
            chunks.iter().any(|c| c.content == "“八极崩!”"),
            "got: {chunks:?}"
        );
        // 第二轮正常并入后续正文
        assert!(
            chunks.iter().any(|c| c.content == "“吹火掌!”萧炎身形一动。"),
            "got: {chunks:?}"
        );
        // 两轮对话绝不粘合
        assert!(
            !chunks.iter().any(|c| c.content == "“八极崩!”“吹火掌!”"),
            "got: {chunks:?}"
        );
    }

    /// 段尾短句跨段并入后，若整段仍不足一句，继续沿正文链吸收直到 ≥ MIN_MERGED_CHARS。
    /// 「地.玄.黄!」+「而每一阶,又分初,中,高三级!」→ 一个完整描述单元。
    #[test]
    fn cross_para_short_continues_absorbing_until_complete() {
        let chunks = parse_text("地.玄.黄!\n\n而每一阶,又分初,中,高三级!");
        assert!(
            chunks.iter().any(|c| c.content == "地.玄.黄!而每一阶,又分初,中,高三级!"),
            "got: {chunks:?}"
        );
    }

    /// 短句跨段并入不跨章标题：章边界处独立短句判级落库，不并入标题后的正文。
    #[test]
    fn cross_para_short_does_not_cross_chapter_heading() {
        let text = "萧战苦笑道。\n\n第二章 入世\n\n他点点头。";
        let chunks = parse_text(text);
        assert!(
            chunks
                .iter()
                .any(|c| c.kind == "chapter" && c.content == "第二章 入世"),
            "got: {chunks:?}"
        );
        // 章标题前的短句独立判级落库（“萧战苦笑道。”High 叙事信号保留），不粘到标题后正文
        assert!(
            chunks.iter().any(|c| c.content == "萧战苦笑道。"),
            "got: {chunks:?}"
        );
        assert!(
            !chunks.iter().any(|c| c.content.contains("萧战苦笑道。他点点头")),
            "got: {chunks:?}"
        );
    }

    /// EOF 前段尾短句：无后续正文可并入，判级落库（叙事短句保留）。
    /// 两个独立叙述短句段（“山风很大。”+“萧战苦笑道。”）均 <8 字符，
    /// 跨段链式吸收成完整单元（并入所述场景），EOF 时以合并结果落库。
    #[test]
    fn cross_para_short_at_eof_is_tiered() {
        let chunks = parse_text("山风很大。\n\n萧战苦笑道。");
        assert!(
            chunks.iter().any(|c| c.content == "山风很大。萧战苦笑道。"),
            "got: {chunks:?}"
        );
    }

    /// 同段短叙述 + 短对话（无空行分隔）仍走段内合并，不依赖跨段路径：
    /// 独立成段的形态变化不影响既有段内行为。
    #[test]
    fn in_para_short_merge_still_works_after_cross_para_added() {
        let chunks = parse_text("萧战苦笑道。“是的,父亲,还有一年!”");
        assert_eq!(chunks.len(), 1, "got: {chunks:?}");
        assert_eq!(chunks[0].content, "萧战苦笑道。“是的,父亲,还有一年!”");
    }

    /// 对话模式切句：引号内的感叹号/问号/省略号是语气而非句界，不触发切句——
    /// `“萧媚,斗之气:七段!级别:高级!”` 必须保持为一个完整检索单元。
    #[test]
    fn dialog_internal_terminators_do_not_split() {
        let chunks = parse_text("“萧媚,斗之气:七段!级别:高级!”");
        assert_eq!(chunks.len(), 1, "got: {chunks:?}");
        assert_eq!(chunks[0].content, "“萧媚,斗之气:七段!级别:高级!”");
    }

    /// 对话模式切句：省略号（含多连发）与问号在引号内同样不切，
    /// 且嵌套引号（“‘…’” ）按深度计数闭合。
    #[test]
    fn dialog_ellipsis_and_nested_quotes_keep_single() {
        assert_eq!(parse_text("“薰…薰儿?”").len(), 1, "ellipsis+? split");
        let nested = parse_text("“他说：‘这里。’”");
        assert_eq!(nested.len(), 1, "got: {nested:?}");
        assert_eq!(nested[0].content, "“他说：‘这里。’”");
    }

    /// 同行双轮（“碎心掌!”“劈石腿!”）：闭引号归零后紧跟开引号 → 仍切为两句，
    /// 且段内短句向前并入守卫防止两个 <MIN 的对话轮在合并阶段被重新粘合。
    #[test]
    fn same_line_double_dialog_turns_stay_separate() {
        let chunks = parse_text("“碎心掌!”“劈石腿!”");
        assert!(
            chunks.iter().any(|c| c.content == "“碎心掌!”"),
            "got: {chunks:?}"
        );
        assert!(
            chunks
                .iter()
                .any(|c| c.content.contains("“劈石腿!”")),
            "got: {chunks:?}"
        );
        assert!(
            !chunks.iter().any(|c| c.content.contains("“碎心掌!”“劈石腿!”")),
            "双轮被粘合: {chunks:?}"
        );
    }

    /// 对话 + 短叙述同行尾部：闭引号后跟叙述文字（非开引号）时不切，
    /// 整句保持“对话+叙述”一体，且长度 ≥ MIN 不再作为短句残留。
    #[test]
    fn dialog_plus_short_narration_merges_inline() {
        let text = "“傻瓜!”萧炎笑道。";
        let chunks = parse_text(text);
        assert_eq!(chunks.len(), 1, "got: {chunks:?}");
        assert_eq!(chunks[0].content, "“傻瓜!”萧炎笑道。");
    }

    /// 同一轮对话内部多个感叹号/问号连续时保持一句（分号软换行拼接后仍一体）；
    /// 同行叙述句号正常切分，不因前文对话模式而漏切。
    #[test]
    fn dialog_multi_terminators_then_narration_still_splits() {
        let chunks = parse_text("“快!快!”萧炎催促道。他冲向门外。");
        assert_eq!(chunks.len(), 2, "got: {chunks:?}");
        assert_eq!(chunks[0].content, "“快!快!”萧炎催促道。");
        assert_eq!(chunks[1].content, "他冲向门外。");
    }

    /// 终点作者更新注裸行（无括号/PS 前缀）：行首「继续码/今日三更/还有一更」等
    /// 固定模板，正文叙事句不以「码字更新」语义起头，整行丢弃。
    #[test]
    fn update_note_bare_lines_are_noise() {
        for l in [
            "继续码第三更!",
            "今日三更!",
            "今日三更!!我码我码我码码码!!!",
            "今日继续三更!",
            "今天继续三更!",
            "今天继续三更!还有两更!",
            "还有一更!",
            "还有一更!继续码!",
            "六更,继续码!",
        ] {
            assert!(is_noise_text(l), "应判定为噪声: {l:?}");
        }
    }

    /// 起点免章声明（「(此章免费~」）与完结感言/推书起头（「新书已发」「感言。」）：
    /// 括号开头 + 前段含「免费」、或书尾作者话固定模板，整行丢弃。
    #[test]
    fn free_chapter_and_finish_notes_are_noise() {
        for l in ["(此章免费~", "新书已发~~~", "感言。新世界"] {
            assert!(is_noise_text(l), "应判定为噪声: {l:?}");
        }
    }

    /// 短括句感谢（行首非括号、行尾 )/））：「鞠躬拜谢!)」「感谢大家!)」等孤行
    /// 为作者致谢附言，正文人物致谢散落在叙事长行内、不以孤行括句收尾。
    #[test]
    fn wrapped_gratitude_lines_are_noise() {
        for l in [
            "鞠躬拜谢!)",
            "鞠躬感谢!)",
            "感谢你们。)",
            "感谢大家!)",
            "抱歉啊大家。)",
            "万分感谢。)",
            "拜谢大家!!)",
            "绝不放弃!!)",
            "土豆拜谢了!)",
            "看大家的吧。)",
            "谢谢大家了。)",
        ] {
            assert!(is_noise_text(l), "应判定为噪声: {l:?}");
        }
    }

    /// 反向护栏：裸「谢谢大家。」与完结感言正文句会被误判为噪声丢弃。
    #[test]
    fn gratitude_like_body_lines_keep() {
        assert!(!is_noise_text("谢谢大家。"), "裸句可能为正文致谢");
        assert!(!is_noise_text("努力到现在。"), "完结感言正文句");
        assert!(!is_noise_text("愿望终达成。"), "完结感言正文句");
        // 正文人物致谢长行（含叙事语境）不受影响
        assert!(!is_noise_text("萧炎拱手道:“多谢诸位相助,谢谢大家。”"));
    }

    }
