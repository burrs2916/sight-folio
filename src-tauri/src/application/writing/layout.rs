//! 成书版式规范（R1：把作者的排版设置接进产物）
//!
//! **为什么要有这个模块**：导出链路以前是六个格式各自写死版式 —— EPUB 的 `style.css`
//! 是常量串、PDF 的字号行距是模块内常量、DOCX 是硬编码 `styles.xml`。结果是用户在
//! 写作台/设置抽屉里调的字号、行距、字体、段距、首行缩进**对产物一个字都不生效**。
//! 本模块把那套设置的唯一真源读进来、收敛成一份 `BookLayoutSpec`，六个渲染器共用。
//!
//! **真源与优先级**（与前端完全一致，不许在此另立判据）：
//! `书级覆盖(writing_typography_books.overrides[bookId]) > 全局默认(writing_typography) > DEFAULT`。
//! 书级覆盖按**字段**沉淀（前端只存"这本书真调过的那几项"），所以这里也是逐字段叠，
//! 不做整本快照 —— 整本快照会让"只把字号调大 1px"的那本书从此再也不跟全局默认走。
//!
//! 表与 clamp 口径来自 `src/utils/typography.ts`（`FONT_FAMILY_OPTIONS` /
//! `LATIN_FONT_OPTIONS` / `resolveBodyFont` / `normalizeTypography`）。跨语言两份表必然
//! 漂移，所以有源码锁：`src/utils/__tests__/typographyExportLock.test.ts` 逐条比对，
//! 改一边不改另一边会红。

use serde_json::Value;

/// 一本成品的正文版式（已收敛完，渲染器直接用，不再各自解释设置 JSON）。
#[derive(Debug, Clone, PartialEq)]
pub struct BookLayoutSpec {
    /// 正文字号（px，14..=22，与前端连续滑杆同区间）
    pub font_size_px: f64,
    /// 已合成的 CSS `font-family` 值（西文栈在前 + 中文栈在后）；空串 = 全跟随系统
    pub font_family: String,
    /// 行距倍数（1.4..=2.6）
    pub line_height: f64,
    /// 段间距（em，0..=2；0 是合法档位）
    pub para_spacing_em: f64,
    /// 首行缩进 2em（中文出版惯例；跟随用户开关）
    pub indent: bool,
}

/// 内置默认（与 `DEFAULT_TYPOGRAPHY` 逐项一致）
impl Default for BookLayoutSpec {
    fn default() -> Self {
        Self {
            font_size_px: 16.0,
            font_family: String::new(),
            line_height: 1.9,
            para_spacing_em: 0.5,
            indent: false,
        }
    }
}

/// 中文栈（与 `FONT_FAMILY_OPTIONS` 一一对应；system = 空串跟随系统）
const CJK_STACKS: [(&str, &str); 6] = [
    ("system", ""),
    ("song", "'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif"),
    (
        "kai",
        "'Kaiti SC', 'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif",
    ),
    (
        "hei",
        "'Heiti SC', 'SimHei', 'Noto Sans CJK SC', sans-serif",
    ),
    (
        "fangsong",
        "'FangSong', 'STFangsong', 'Noto Serif CJK SC', serif",
    ),
    (
        "yahei",
        "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
    ),
];

/// 西文栈（与 `LATIN_FONT_OPTIONS` 一一对应；刻意不含末尾通用族，收尾由组合函数负责）
const LATIN_STACKS: [(&str, &str); 14] = [
    ("system", ""),
    ("georgia", "'Georgia', 'Times New Roman'"),
    ("times", "'Times New Roman', 'Times'"),
    ("garamond", "'Garamond', 'EB Garamond', 'ITC Garamond'"),
    ("playfair", "'Playfair Display', 'Georgia'"),
    ("lora", "'Lora', 'Georgia', 'Times New Roman'"),
    ("inter", "'Inter', 'Helvetica Neue', 'Arial'"),
    ("helvetica", "'Helvetica Neue', 'Helvetica', 'Arial'"),
    ("sf", "'SF Pro Text', -apple-system, 'Segoe UI'"),
    ("roboto", "'Roboto', 'Segoe UI', 'Arial'"),
    ("lato", "'Lato', 'Helvetica Neue', 'Arial'"),
    ("montserrat", "'Montserrat', 'Segoe UI', 'Arial'"),
    ("consolas", "'Consolas', 'SF Mono', 'Menlo'"),
    ("courier", "'Courier New', 'Courier', 'Menlo'"),
];

/// 系统缺省中文回退栈（与 `CJK_FALLBACK_STACK` 同串）
const CJK_FALLBACK: &str = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";

/// 「JetBrains Mono」这一档刻意不在下表：等宽档用于代码感强调，成书正文不给它出场机会，
/// 但设置库若存了它也必须能读出来（读成"西文跟随"即可，不许因此整项作废）。
const LATIN_STACKS_EXTRA: [(&str, &str); 1] =
    [("jetbrains", "'JetBrains Mono', 'Fira Code', 'Menlo'")];

fn stack_of(table: &[(&'static str, &'static str)], key: &str) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

/// 组合正文 font-family（逐行对齐 `resolveBodyFont`：全 system → 空串；
/// 只有中文 → 中文栈；只有西文 → 西文栈 + 中文回退栈；都有 → `latin, cjk`）。
///
/// 返回空串表示「跟随系统」，渲染层必须**保留自己原有的字体栈**，
/// 不许把 font-family 写成空 —— 那是"设置没生效"的另一种形态。
/// CSS 数值串：去掉无意义的尾零。
///
/// `1.9` 不该打成 `1.900000`，`2.0` 该打成 `2`。版式数值会原样进产物（style.css / HTML），
/// 用户会看见它 —— 也让产物 diff 干净，重导一次不该产生字节噪音。
/// 成书首行缩进的最终裁定（F4，2026-11-06；㉱ E-A′ 追加体裁豁免）
///
/// **成书版式不再被屏幕阅读偏好左右**：写作台那个 `indent` 开关管的是编辑器预览观感，
/// 而中文成书的惯例是首行缩两字、西文成书靠段距分段。二者本来就不同，
/// 用一个布尔去共用必然一头错——实测就是 PDF 各段行首空白 4/3/2/3 不一致。
///
/// 将来 R5-b 的「版式档」会给出显式覆盖位；在那之前按语种定，且**不再读 indent**。
///
/// **㉱ E-A′（2026-11-11）**：语种之外还要过一道体裁闸 —— **诗歌任何语种一律不缩**。
/// 分行与节次就是诗的本体（prompt 层与前端排版都按这条口径办事），2em 首行缩进会把
/// 每一行诗排成散文段落的开头，中文诗集照缩是 F4 只判语种没判体裁留下的洞。
/// 非诗支路的渲染结果与改造前逐字相同（小说/旧书零回归）。
pub fn indent_for_book(spec: &BookLayoutSpec, zh_book: bool, genre: &str) -> BookLayoutSpec {
    BookLayoutSpec {
        indent: zh_book && genre != "poetry",
        ..spec.clone()
    }
}

/// 成书版式的**完整裁定**（㉱ E-A′，2026-11-11）：正文拼成一把文本 → 语种 × 体裁。
///
/// 完结导出（`export_jobs::render_export_file` 咽喉）与写作台「另存为」
/// （`commands/writing.rs` 三个 save 命令）现在共用这一枚判据。
/// 分叉的代价本刀已经付过一次：DOCX 段落级缩进此前硬编码 200/480，
/// 「另存为」靠它维持中文成书惯例、完结导出靠咽喉判 —— 同一本书两条出口
/// 两种排法。判据只留这一处，入口一律换源。
pub fn finalise_for_book(
    spec: &BookLayoutSpec,
    all_body_text: &str,
    genre: &str,
) -> BookLayoutSpec {
    let zh_book = matches!(
        crate::application::writing::format_html::detect_lang(all_body_text),
        crate::application::writing::format_html::BookLang::Zh
    );
    indent_for_book(spec, zh_book, genre)
}

/// 导出侧的**量词**（㉱ E-A′：日志行「章/篇/首/场《题名》结构层修正」用它换口）。
///
/// 与前端 `src/i18n/*.json` 的 `writing.unitClassifier.*` 逐字同表
/// （novel=章 / essay=篇 / poetry=首 / script=场 / diary=篇；未设置与脏值落小说）——
/// 两份语言各存一份是跨语言的必然，漂移由源码锁拦：
/// `src/utils/__tests__/exportGenreUnitLock.test.ts`。
///
/// 注意与 `plugins/ai_agent/tools.rs::default_root_kind` 不是一把尺子：那张表给
/// **结构层名**（日记的顶层是「天」），这张表管**怎么数它**（日记数它说「一篇」）。
pub fn export_unit_classifier(genre: &str) -> &'static str {
    match genre {
        "essay" => "篇",
        "poetry" => "首",
        "script" => "场",
        // 日记的单位名是「天」，量词是「篇」（「一篇日记」），与前端 unitClassifier 同表。
        "diary" => "篇",
        _ => "章",
    }
}

pub fn css_num(v: f64) -> String {
    let raw = format!("{:.3}", v);
    let trimmed = raw.trim_end_matches('0').trim_end_matches('.');
    trimmed.to_string()
}

pub fn resolve_body_font(latin_key: &str, cjk_key: &str) -> String {
    let latin = stack_of(&LATIN_STACKS, latin_key)
        .or_else(|| stack_of(&LATIN_STACKS_EXTRA, latin_key))
        .unwrap_or_default();
    let cjk = stack_of(&CJK_STACKS, cjk_key).unwrap_or_default();
    match (latin.is_empty(), cjk.is_empty()) {
        (true, true) => String::new(),
        (true, false) => cjk.to_string(),
        (false, true) => format!("{latin}, {CJK_FALLBACK}"),
        (false, false) => format!("{latin}, {cjk}"),
    }
}

/// 读一份排版 JSON 的字段（缺失字段一律不动 `into`，这就是「按字段叠加」的实现）。
///
/// 枚举字段只认表里的 key：脏 key **整字段丢掉**（等于"这一项没单独调过"，自然回落
/// 上一层），与前端 `normalizeBookOverride` 同口径 —— 硬塞缺省值会让一处脏数据把整本书
/// 的排版打回内置默认，那比丢一项坏得多。
#[derive(Debug, Clone, Default)]
struct RawTypography {
    font_size_px: Option<f64>,
    line_height: Option<f64>,
    para_spacing_em: Option<f64>,
    indent: Option<bool>,
    cjk_key: Option<String>,
    latin_key: Option<String>,
}

fn as_f64(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| {
        x.as_f64()
            .or_else(|| x.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    })
}

fn as_key(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string)
}

fn read_into(raw: &Value, into: &mut RawTypography) {
    let Some(obj) = raw.as_object() else { return };
    let get = |k: &str| obj.get(k);
    if let Some(n) = as_f64(get("fontSize")) {
        into.font_size_px = Some(clamp(n, 14.0, 22.0));
    }
    if let Some(n) = as_f64(get("lineHeight")) {
        into.line_height = Some(clamp(n, 1.4, 2.6));
    }
    // 段距 0 是合法档位，不能按「0 视为没设过」读
    if let Some(n) = as_f64(get("paraSpacing")) {
        into.para_spacing_em = Some(clamp(n, 0.0, 2.0));
    }
    if let Some(b) = get("indent").and_then(|x| x.as_bool()) {
        into.indent = Some(b);
    }
    if let Some(k) = as_key(get("fontFamily")) {
        if stack_of(&CJK_STACKS, &k).is_some() {
            into.cjk_key = Some(k);
        }
    }
    if let Some(k) = as_key(get("latinFontFamily")) {
        if stack_of(&LATIN_STACKS, &k)
            .or_else(|| stack_of(&LATIN_STACKS_EXTRA, &k))
            .is_some()
        {
            into.latin_key = Some(k);
        }
    }
}

fn parse_json(raw: Option<&str>) -> Option<Value> {
    serde_json::from_str::<Value>(raw?).ok()
}

/// 解析设置库两份 JSON → 本书版式。**任何一步坏数据都只回落一层，绝不因脏设置让导出失败**。
///
/// `books_json` 形状：`{ "version": 1, "overrides": { "<bookId>": { 字段... } } }`
pub fn resolve_spec(
    global_json: Option<&str>,
    books_json: Option<&str>,
    book_id: Option<&str>,
) -> BookLayoutSpec {
    let mut raw = RawTypography::default();
    if let Some(v) = parse_json(global_json) {
        read_into(&v, &mut raw);
    }
    if let Some(bid) = book_id.filter(|b| !b.is_empty()) {
        if let Some(ov) = parse_json(books_json)
            .and_then(|v| v.get("overrides").cloned())
            .and_then(|o| o.get(bid).cloned())
        {
            read_into(&ov, &mut raw);
        }
    }
    let d = BookLayoutSpec::default();
    BookLayoutSpec {
        font_size_px: raw.font_size_px.unwrap_or(d.font_size_px),
        font_family: resolve_body_font(
            raw.latin_key.as_deref().unwrap_or_default(),
            raw.cjk_key.as_deref().unwrap_or_default(),
        ),
        line_height: raw.line_height.unwrap_or(d.line_height),
        para_spacing_em: raw.para_spacing_em.unwrap_or(d.para_spacing_em),
        indent: raw.indent.unwrap_or(d.indent),
    }
}

/// clamp（与前端同：非有限值一律落到区间下界，脏数据最多让排版回到最小档）
fn clamp(v: f64, min: f64, max: f64) -> f64 {
    if !v.is_finite() {
        min
    } else {
        v.min(max).max(min)
    }
}

impl BookLayoutSpec {
    /// EPUB/HTML 用：字号 px（四舍五入，避免 15.9999 这种串）
    pub fn font_size_px_rounded(&self) -> i64 {
        (self.font_size_px.round() as i64).clamp(14, 22)
    }
    /// PDF 用：px → pt（1px = 0.75pt，出版常规换算）
    pub fn body_pt(&self) -> f64 {
        self.font_size_px * 0.75
    }
    /// PDF 用：段后距（pt）
    pub fn para_gap_pt(&self) -> f64 {
        self.para_spacing_em * self.font_size_px * 0.75
    }
    /// 首行缩进 em → CSS 值（关掉就是 0）
    pub fn indent_css(&self) -> &'static str {
        if self.indent {
            "2em"
        } else {
            "0"
        }
    }
    /// DOCX 用：半磅（w:sz 单位）
    pub fn docx_half_points(&self) -> i64 {
        // 直接 半磅 = pt × 2，中间不取整到整磅：22px = 16.5pt = **33** 半磅。
        // 先 round 到 17pt 会得到 34，再被上限夹回 33 —— 数值凑对、口径是错的。
        (self.body_pt() * 2.0).round() as i64
    }
    /// DOCX 用：240 分之一行的行高（`w:line w:lineRule="auto"`）
    pub fn docx_line(&self) -> i64 {
        (self.line_height * 240.0).round() as i64
    }
    /// DOCX 用：段后距（twip）
    pub fn docx_after_twip(&self) -> i64 {
        (self.para_spacing_em * self.body_pt() * 20.0).round() as i64
    }
    /// 版式一句话（写进导出回执，产物对不对可对人说清）
    pub fn summary(&self) -> String {
        let family = if self.font_family.is_empty() {
            "跟随系统".to_string()
        } else {
            self.font_family.clone()
        };
        format!(
            "正文 {}pt · 行距 {} · 段距 {}em · 首行缩进 {} · 字体 {}",
            self.body_pt().round(),
            self.line_height,
            self.para_spacing_em,
            if self.indent { "2 字" } else { "无" },
            family
        )
    }
}
/// 设置库里的两个真源键（与前端常量逐字一致，改一边不改另一边会被源码锁打红）：
/// `WRITING_TYPOGRAPHY_SETTINGS_KEY` / `BOOK_TYPOGRAPHY_SETTINGS_KEY`
pub const GLOBAL_TYPOGRAPHY_KEY: &str = "writing_typography";
pub const BOOK_TYPOGRAPHY_KEY: &str = "writing_typography_books";

/// 从设置仓储读真源（导出流水线用：它本来就持有 settings）。
pub fn resolve_from_settings(
    settings: &crate::infrastructure::SqliteSettingsRepository,
    book_id: Option<&str>,
) -> BookLayoutSpec {
    let global = settings.get(GLOBAL_TYPOGRAPHY_KEY).ok().flatten();
    let books = settings.get(BOOK_TYPOGRAPHY_KEY).ok().flatten();
    resolve_spec(global.as_deref(), books.as_deref(), book_id)
}

/// 从主库连接读设置并解析（命令层「另存为」用：它只有 `State<Arc<Database>>`）。
/// 与 [resolve_from_settings] 同一读法，两处共用 `resolve_spec` —— 判据不许分叉。
pub fn resolve_from_db(
    db: &std::sync::Arc<crate::infrastructure::database::connection::Database>,
    book_id: Option<&str>,
) -> BookLayoutSpec {
    let settings = crate::infrastructure::SqliteSettingsRepository::new(db.clone());
    resolve_from_settings(&settings, book_id)
}

impl BookLayoutSpec {
    /// CSS `font-family` 值；空串时回退到 `fallback`（历史字体栈）——
    /// 「跟随系统」不等于「产物里没有字体声明」，那会让整本书掉进阅读器的默认字面。
    pub fn css_font_family_or<'a>(&'a self, fallback: &'a str) -> &'a str {
        if self.font_family.is_empty() {
            fallback
        } else {
            &self.font_family
        }
    }

    /// 取字体栈里第一个**具名**字体，给 DOCX 的 `w:rFonts`（CSS 栈不能整串塞进 OOXML）。
    /// 通用族与 `-apple-system` 这类系统别名不算具名字体，返回 None 让调用方保留历史字面。
    pub fn first_family(&self) -> Option<String> {
        let head = self
            .font_family
            .split(',')
            .next()?
            .trim()
            .trim_matches('\'');
        if head.is_empty()
            || head.starts_with('-')
            || matches!(head, "serif" | "sans-serif" | "monospace")
        {
            return None;
        }
        Some(head.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 缺省版式与前端默认逐项一致() {
        let d = BookLayoutSpec::default();
        assert_eq!(d.font_size_px, 16.0);
        assert_eq!(d.line_height, 1.9);
        assert_eq!(d.para_spacing_em, 0.5);
        assert!(
            !d.indent,
            "首行缩进默认关（与 DEFAULT_TYPOGRAPHY 一致，导出侧不许自作主张打开）"
        );
        assert!(d.font_family.is_empty(), "默认字体跟随系统");
    }

    #[test]
    fn 全局设置生效且字号行距段距缩进逐项落位() {
        let g = r#"{"fontSize":20,"lineHeight":2.2,"paraSpacing":1,"indent":true,"fontFamily":"song","latinFontFamily":"georgia"}"#;
        let s = resolve_spec(Some(g), None, None);
        assert_eq!(s.font_size_px, 20.0);
        assert_eq!(s.line_height, 2.2);
        assert_eq!(s.para_spacing_em, 1.0);
        assert!(s.indent);
        assert_eq!(
            s.font_family,
            "'Georgia', 'Times New Roman', 'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif"
        );
        assert_eq!(s.body_pt(), 15.0, "px→pt 必须是 0.75 倍");
    }

    #[test]
    fn 书级覆盖只叠作者真调过的那几项其余跟随全局() {
        let g = r#"{"fontSize":16,"lineHeight":1.9,"paraSpacing":0.5,"fontFamily":"song","latinFontFamily":"system","indent":false}"#;
        let b = r#"{"version":1,"overrides":{"b1":{"fontSize":18}}}"#;
        let s = resolve_spec(Some(g), Some(b), Some("b1"));
        assert_eq!(s.font_size_px, 18.0, "本书单独调过字号");
        assert_eq!(s.line_height, 1.9, "没调过的字段必须继续跟随全局");
        // 另一本没调过的书完全不受影响
        let other = resolve_spec(Some(g), Some(b), Some("b2"));
        assert_eq!(other.font_size_px, 16.0);
    }

    #[test]
    fn 脏值逐项回落绝不整本打回默认() {
        let g = r#"{"fontSize":18,"lineHeight":99,"fontFamily":"ComicSans"}"#;
        let s = resolve_spec(Some(g), None, None);
        assert_eq!(s.font_size_px, 18.0, "合法字段照收");
        assert_eq!(s.line_height, 2.6, "越界夹紧，与前端 clamp 同口径");
        assert!(
            s.font_family.is_empty(),
            "表里没有的字体 key 整字段丢掉 = 这项没调过"
        );
    }

    #[test]
    fn 字体组合四种情形与前端同一口径() {
        assert_eq!(resolve_body_font("system", "system"), "");
        assert!(resolve_body_font("system", "kai").starts_with("'Kaiti SC'"));
        let only_latin = resolve_body_font("times", "system");
        assert!(
            only_latin.contains("'Times New Roman'") && only_latin.contains("PingFang SC"),
            "{only_latin}"
        );
        let both = resolve_body_font("inter", "hei");
        assert!(
            both.starts_with("'Inter'") && both.contains("'Heiti SC'"),
            "西文栈在前: {both}"
        );
    }

    #[test]
    fn docx_单位换算落位() {
        let g = r#"{"fontSize":16,"lineHeight":2.0,"paraSpacing":0.5,"indent":true}"#;
        let s = resolve_spec(Some(g), None, None);
        assert_eq!(s.docx_half_points(), 24, "16px=12pt=24 半磅");
        assert_eq!(s.docx_line(), 480, "行距 2.0 × 240");
        assert_eq!(s.docx_after_twip(), 120, "0.5em × 12pt × 20");
        assert_eq!(s.indent_css(), "2em");
    }

    // ── ㉱ E-A′（2026-11-11）：缩进判据从「语种」补成「语种 × 体裁」──

    #[test]
    fn 中文书按语种缩进_小说散文剧本日记口径逐字不变() {
        let d = BookLayoutSpec::default();
        for g in ["novel", "essay", "script", "diary", "", "脏值"] {
            assert!(
                indent_for_book(&d, true, g).indent,
                "中文书（体裁 {g:?}）维持 F4 原判：缩进开"
            );
        }
        for g in ["novel", "poetry", ""] {
            assert!(
                !indent_for_book(&d, false, g).indent,
                "西文书（体裁 {g:?}）维持 F4 原判：不缩进"
            );
        }
    }

    #[test]
    fn 诗集任何语种一律撤首行缩进() {
        // 诗的本体是分行：2em 缩进会把每一行诗排成散文段落开头。
        // 这是 E-A′ 唯一新增的判据分支，两侧语种都必须压住。
        assert!(!indent_for_book(&BookLayoutSpec::default(), true, "poetry").indent);
        assert!(!indent_for_book(&BookLayoutSpec::default(), false, "poetry").indent);
    }

    #[test]
    fn 导出量词表与前端量词键同表且脏值落章() {
        assert_eq!(export_unit_classifier("novel"), "章");
        assert_eq!(export_unit_classifier("essay"), "篇");
        assert_eq!(export_unit_classifier("poetry"), "首");
        assert_eq!(export_unit_classifier("script"), "场");
        assert_eq!(export_unit_classifier("diary"), "篇");
        // 未设置体裁的旧书与脏值一律落小说口径（零回归）
        assert_eq!(export_unit_classifier(""), "章");
        assert_eq!(
            export_unit_classifier("Poetry"),
            "章",
            "大小写脏值不许误换口"
        );
    }
}
