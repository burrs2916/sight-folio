/// 语料参考价值评估（纯函数，无 IO）。
///
/// 定位：pipeline 的 [`crate::domain::corpus::pipeline::is_noise_text`] 解决
/// 「格式/站点噪声」（水印、求票、纯拟声、省略号），本模块解决「内容参考价值」——
/// 以「语料库供创作者参考」为最终目标，把对写作参考没有表达价值的句子
/// 挡在索引之外，并按叙事信号做质量分层（High/Medium/Low）。
///
/// 能力边界：这是**可判定的启发式规则评分**（叙事动词、对话、描写意象、
/// 修辞词、信息密度），确定性强、可单测，不引入外部依赖；
/// 不是模型化语义理解（embedding/LLM 需要 IO 与运行时，超出纯函数管线设计，
/// 若要做真正的语义主题模型需另行架构）。
///
/// 分层语义（供创作者参考）：
/// - High：含对话、叙事动作/心理动词、描写意象或修辞信号——表达骨架完整，
///   是创作者最常查的「怎么说/怎么写」参考；
/// - Medium：无显著叙事信号但信息量充分（有效字符 ≥4）的普通完整句；
/// - Low：长度不足（有效字符 <[`MIN_INDEX_CHARS`]，如 1–2 字短句）或无信号且
///   信息量不足（<4 有效字符）的碎片——单独成句时无参考价值，不进索引
///   （已在上一级被合并/吸收的碎片不受影响）。

/// 叙事/动作/心理动词（高频子串）：命中任一 → 叙事信号（High）。
/// 覆盖动作（走/看/拿）、心理（想/觉得）、言语（说/问/喊）等表达骨架。
const NARRATIVE_VERBS: &[&str] = &[
    "说道", "说", "问", "答道", "喊", "叫", "笑", "哭", "看", "望", "盯", "走", "跑", "坐", "站",
    "躺", "来", "去", "回", "转", "抬", "低头", "点", "摇头", "握", "拉", "推", "拿", "放", "想",
    "觉得", "感到", "知道", "明白", "记得", "忘", "爱", "恨", "怕", "惊", "怒", "骂", "吼", "听",
    "闻", "追", "逃", "躲", "藏", "翻", "找", "递", "接", "叹", "皱眉", "眨眼", "咬牙",
];

/// 描写意象词：环境/感官/色泽/光影（High 次级信号）。
/// 「山风很大。」这类纯描写句凭意象词即可标 High 保留。
const IMAGERY_WORDS: &[&str] = &[
    "风", "云", "雨", "雪", "月", "星", "日光", "光", "影", "天", "地", "山", "水", "树", "花",
    "草", "石", "海", "河", "湖", "雾", "霜", "露", "霞", "虹", "香", "味", "声", "音", "静", "冷",
    "热", "暖", "凉", "黑", "白", "红", "绿", "蓝", "黄", "灰", "暗", "亮", "寂静", "灯火", "夜色",
];

/// 修辞/比喻词（附加信号）：比喻/拟人/出乎意料是创作者重点参考的表达手法。
const FIGURATIVE_WORDS: &[&str] = &[
    "仿佛", "似乎", "好像", "如同", "犹如", "一样", "似的", "竟然", "居然", "果然",
];

/// 参考价值层级（导入时由 `tier_of` 裁定；Low 不进索引）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceTier {
    /// 叙事/对话/描写/修辞信号完整的句子，参考价值最高。
    High,
    /// 无显著信号但信息量充分的普通完整句。
    Medium,
    /// 长度不足（有效字符 <[`MIN_INDEX_CHARS`]）或信息量不足（<4 有效字符），不进入索引。
    Low,
}

/// 最小索引单元长度（有效字符数）。短于该值的句子（1–2 字碎片）无论是否携带
/// 对话/叙事/意象信号，单独成句均无索引价值，导入即不入索引。
const MIN_INDEX_CHARS: usize = 3;

/// 多字感叹词短语（剔除引号/标点/空白后整体精确命中即判定为纯感叹词）。
/// 独立成行/成句的纯感叹词不承载叙事语义，作为孤单元无检索参考价值 → Low 不入索引。
/// 仅收**整体相等**命中：短语后接正文（如「天哪，这可怎么办？」）剥离后为整串
/// 「天哪这可怎么办」≠ 短语，不会被误伤。保守收编语料常见独立感叹形式。
const EXCLAMATION_PHRASES: &[&str] = &[
    "我的天",
    "我的天哪",
    "老天爷",
    "天哪",
    "天呐",
    "天啦",
    "天啊",
    "天呀",
    "妈呀",
    "我的妈",
    "哎呀",
    "哎呀妈呀",
    "哎哟",
    "哎哟喂",
    "哎呦",
    "哎呦喂",
    "哦豁",
    "噢耶",
    "好家伙",
    "乖乖",
    "糟了",
    "坏了",
    "啊呀",
    "喔唷",
];

/// 有效字符数（汉字/字母/数字，剔除空白与标点）——信息量基准。
fn effective_chars(content: &str) -> usize {
    content.chars().filter(|c| c.is_alphanumeric()).count()
}

/// 纯感叹词判定：剔除引号/标点/空白后（仅保留字母/数字/汉字），整体精确命中
/// [`EXCLAMATION_PHRASES`] 之一。用于把独立的「我的天！」「老天爷！」「哎呀妈呀！」等
/// 多字感叹词（含非语气字，不满足 pipeline 的 TONE_WORDS 字符集判定）识别为
/// 无叙事语义的孤单元；带正文的句子（「哎哟，这可不得了。」）剥离后是整串，
/// 不等于短语，不会被误伤。
pub fn is_pure_exclamation(content: &str) -> bool {
    let s: String = content.chars().filter(|c| c.is_alphanumeric()).collect();
    !s.is_empty() && EXCLAMATION_PHRASES.contains(&s.as_str())
}

/// 对切分合并后的句子裁定参考价值层级。
///
/// 规则（保守优先，宁可保留不误伤）：
/// 1. 有效字符 <[`MIN_INDEX_CHARS`] → Low（长度门槛：1–2 字碎片无论信号一律不进索引）；
/// 2. 纯感叹词（多字感叹短语整体命中，如「我的天！」「老天爷！」）→ Low
///    （也不进索引：孤单元无检索参考价值，且避免「天」等意象子串误判 High）；
/// 3. 含对话引号对 / 叙事动词 / 描写意象 / 修辞词 → High；
/// 4. 否则若有效字符 ≥4 → Medium（信息量足够的普通句，如「孤独是宿命……」）；
/// 5. 否则 → Low（孤立碎片，如无引号单字「嗯。」）。
pub fn tier_of(content: &str) -> ReferenceTier {
    // 长度门槛优先：带信号的 1–2 字短句（引号对话「“好。”」、叙事词「走吧。」）也不再豁免
    if effective_chars(content) < MIN_INDEX_CHARS {
        return ReferenceTier::Low;
    }
    // 纯感叹词：独立成句的多字感叹（我的天/老天爷/哎呀妈呀…）无叙事语义，
    // 先于信号判定置 Low，避免「天」等意象/「走」等叙事子串误判 High 入索引。
    if is_pure_exclamation(content) {
        return ReferenceTier::Low;
    }
    let has_dialogue = (content.contains('“') && content.contains('”'))
        || (content.contains('「') && content.contains('」'))
        || (content.contains('『') && content.contains('』'));
    let has_narrative = NARRATIVE_VERBS.iter().any(|v| content.contains(v));
    let has_imagery = IMAGERY_WORDS.iter().any(|w| content.contains(w));
    let has_figurative = FIGURATIVE_WORDS.iter().any(|w| content.contains(w));

    if has_dialogue || has_narrative || has_imagery || has_figurative {
        ReferenceTier::High
    } else if effective_chars(content) >= 4 {
        ReferenceTier::Medium
    } else {
        ReferenceTier::Low
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 叙事动词/动作信号 → High（创作者最常参考的「怎么写动作」）。
    #[test]
    fn narrative_signal_is_high() {
        assert_eq!(
            tier_of("他回头看了一眼，脚下是万丈深渊！"),
            ReferenceTier::High
        );
        assert_eq!(tier_of("老者说。"), ReferenceTier::High);
        assert_eq!(tier_of("他点点头。"), ReferenceTier::High);
        assert_eq!(tier_of("她想了想，终于开口。"), ReferenceTier::High);
    }

    /// 对话引号（含语气应答句）→ High。
    #[test]
    fn dialogue_signal_is_high() {
        assert_eq!(tier_of("“这是宿命。”"), ReferenceTier::High);
        assert_eq!(tier_of("“嗯。”他点点头，转身离开。"), ReferenceTier::High);
        assert_eq!(tier_of("「你来了。」老者说。"), ReferenceTier::High);
    }

    /// 描写意象/修辞 → High。
    #[test]
    fn imagery_and_figurative_signal_is_high() {
        assert_eq!(tier_of("山风很大。"), ReferenceTier::High);
        assert_eq!(tier_of("夜色像墨一样浓。"), ReferenceTier::High);
        assert_eq!(tier_of("雨声仿佛在耳边。"), ReferenceTier::High);
    }

    /// 无信号但信息量充分的普通句 → Medium（不误伤，如既有测试依赖的样本）。
    #[test]
    fn sufficient_info_without_signal_is_medium() {
        assert_eq!(tier_of("孤独是宿命……"), ReferenceTier::Medium);
        assert_eq!(tier_of("这是宿命……"), ReferenceTier::Medium);
        assert_eq!(tier_of("崭新的句子出现了。"), ReferenceTier::Medium);
        assert_eq!(tier_of("It was the best of times."), ReferenceTier::Medium);
        assert_eq!(
            tier_of(" completely unrelated prose about rivers."),
            ReferenceTier::Medium
        );
    }

    /// 无信号且信息量不足的碎片 → Low（单独成句无参考价值，不进索引）。
    #[test]
    fn fragment_without_signal_is_low() {
        assert_eq!(tier_of("嗯。"), ReferenceTier::Low);
        assert_eq!(tier_of("啊？"), ReferenceTier::Low);
        assert_eq!(tier_of("嗯嗯。"), ReferenceTier::Low);
        assert_eq!(tier_of("哦。"), ReferenceTier::Low);
    }

    /// 带引号的 1–2 字短语气词达到长度门槛 → Low：虽带对话信号，但有效字符 <MIN_INDEX_CHARS，
    /// 单独成句无索引价值（导入期过滤掉孤立单字/双字短句）。
    #[test]
    fn short_quoted_tone_word_is_low() {
        assert_eq!(tier_of("“嗯。”"), ReferenceTier::Low);
        assert_eq!(tier_of("“啊？”"), ReferenceTier::Low);
        assert_eq!(tier_of("“好。”"), ReferenceTier::Low);
    }

    /// 带叙事/意象信号但有效字符 <MIN_INDEX_CHARS 的 1–2 字短句也判 Low：
    /// 长度门槛优先于信号（“走吧。”“风大。”不再豁免）。
    #[test]
    fn short_with_signal_is_low() {
        assert_eq!(tier_of("走吧。"), ReferenceTier::Low);
        assert_eq!(tier_of("风大。"), ReferenceTier::Low);
        assert_eq!(tier_of("嗯嗯。"), ReferenceTier::Low);
    }

    /// 纯符号/空白行 → Low（噪声层已挡，评分器兜底）。
    #[test]
    fn empty_and_symbols_are_low() {
        assert_eq!(tier_of(""), ReferenceTier::Low);
        assert_eq!(tier_of("。。"), ReferenceTier::Low);
        assert_eq!(tier_of("!!!"), ReferenceTier::Low);
    }

    /// 多字感叹词独立成句（“我的天！”“老天爷！”“哎呀妈呀！”）→ Low：
    /// 即使含「天」等意象/「走」等叙事子串，纯感叹孤单元也无检索参考价值，不进索引。
    #[test]
    fn pure_exclamation_is_low() {
        assert_eq!(tier_of("“我的天！”"), ReferenceTier::Low);
        assert_eq!(tier_of("我的天！"), ReferenceTier::Low);
        assert_eq!(tier_of("「老天爷！」"), ReferenceTier::Low);
        assert_eq!(tier_of("“哎呀妈呀！”"), ReferenceTier::Low);
        assert_eq!(tier_of("“好家伙！”"), ReferenceTier::Low);
        assert_eq!(tier_of("“天哪！”"), ReferenceTier::Low);
    }

    /// 感叹词并入正文的完整单元不受纯感叹判定影响：剥离后为整串 ≠ 短语。
    #[test]
    fn exclamation_with_body_is_not_low() {
        assert_eq!(tier_of("“我的天！”他猛地睁开眼。"), ReferenceTier::High);
        assert_eq!(tier_of("“哎哟，这可不得了。”"), ReferenceTier::High);
        assert_eq!(tier_of("“嗯。”他点点头，转身离开。"), ReferenceTier::High);
    }

    /// is_pure_exclamation 精确匹配：剥引号/标点/空白后整体等于短语才命中。
    #[test]
    fn is_pure_exclamation_matches_whole_phrase_only() {
        assert!(is_pure_exclamation("“我的天！”"));
        assert!(is_pure_exclamation("我的天！"));
        assert!(is_pure_exclamation("老天爷"));
        assert!(!is_pure_exclamation("“我的天！”他猛地睁开眼。"));
        assert!(!is_pure_exclamation("“天哪，这可怎么办？”"));
        assert!(!is_pure_exclamation(""));
        assert!(!is_pure_exclamation("123456"));
    }
}
