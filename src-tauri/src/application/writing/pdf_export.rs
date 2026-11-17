// [public API reserved] allow dead_code: 封存域/预留公共 API，保留签名
#![allow(dead_code)]
// pdf_export.rs
// 离线原生 PDF 导出（T7）：不依赖浏览器打印，纯 Rust 生成。
//
// 技术要点：
// - lopdf 0.26（default-features=false，规避 0.34 解析器编译缺陷）手写 PDF 对象树；
// - 中文字体：定位系统 CJK TTF → ttf-parser 解析字形 → 嵌入
//   Type0/CIDFontType2（Identity-H 编码，CID=GID 由 FontFile2 字形表决定，
//   ToUnicode CMap 保证复制/搜索，W 数组按真实 advance 建立）；
// - 正文图片：`<img data-asset="...">` 经 `writing::read_asset_bytes`（定格优先、缺图点名）读字节 →
//   image 解码为 RGB → FlateDecode 压缩为图像 XObject；
// - 换行：按字符 advance 累加逐字断行（CJK 无空格，不依赖空格分词）。
//
// 页面：A4（595 × 842 pt），左右 50pt 边距。版面：封面 → 目录 → 正文。

use std::collections::{HashMap, HashSet};
use std::io::Write;

use lopdf::dictionary;
use lopdf::{Object, ObjectId, Stream};

use super::{has_tree_payload, EpubChapter};
use crate::error::{AppError, AppResult};

// ─── 常量 ───
const PAGE_W: f64 = 595.0;
const PAGE_H: f64 = 842.0;
const MARGIN: f64 = 50.0;
const BODY_W: f64 = PAGE_W - 2.0 * MARGIN; // 495
const BODY_FONT_SIZE: f64 = 11.0;
const LINE_HEIGHT_FACTOR: f64 = 1.5;
const SKIP_GAP: f64 = 8.0;
const MAX_IMG_W: f64 = 420.0;

/// PDF 正文版式（**由 `BookLayoutSpec` 派生，不许在这另立字号常量**）。
///
/// 为什么需要一个独立结构而不是就地遮蔽常量：`BODY_FONT_SIZE / LINE_HEIGHT_FACTOR / SKIP_GAP`
/// 除了正文循环，还被 `ensure_space`（翻页基线）、`BODY_LINE_H` / `HEADING_LINE_H`（行高）用到。
/// 只遮蔽正文循环那几十行会造出**「正文用新字号、翻页与行高用旧值」**的混合版式 ——
/// 比完全不接更坏。所以把这三值收成一个结构，整条链路一次切过去。
///
/// 封面页与目录页**本轮仍用既有校准值**：那两页的点线引导、页码位置是按固定字号排死的，
/// 跟着正文一起放大需要重排整套版面，属独立一批（不许半改）。
#[derive(Debug, Clone, Copy)]
pub struct PdfLayout {
    /// 正文字号（pt）
    pub body: f64,
    /// 行距倍数
    pub line: f64,
    /// 段后距（pt）
    pub gap: f64,
    /// 首行缩进（em，0 = 作者没开缩进）
    pub indent_em: f64,
}

impl PdfLayout {
    /// 与历史常量对齐的缺省（11pt / 1.5 / 8pt），供不传版式时逐字节保持旧行为
    pub const fn legacy() -> Self {
        Self {
            body: BODY_FONT_SIZE,
            line: LINE_HEIGHT_FACTOR,
            gap: SKIP_GAP,
            indent_em: 2.0,
        }
    }

    /// px→pt 用 0.75；段距按 em×正文字号；缩进跟随作者开关
    pub fn from_spec(spec: &super::layout::BookLayoutSpec) -> Self {
        Self {
            body: spec.body_pt(),
            line: spec.line_height,
            gap: spec.para_spacing_em * spec.body_pt(),
            indent_em: if spec.indent { 2.0 } else { 0.0 },
        }
    }

    pub fn body_line(self) -> f64 {
        self.body * self.line
    }
    /// 章题层级：历史上是 15.0pt（= 正文 11pt × 1.36），跟着正文字号等比走，
    /// 否则作者把正文调到 16.5pt 后**章题会比正文还小**。
    pub fn heading_size(self) -> f64 {
        self.body * (15.0 / 11.0)
    }
    pub fn heading_line(self) -> f64 {
        self.heading_size() * self.line * 2.0 + self.gap
    }
    /// 章前卷标（遗留口径）字号：历史 13.0pt 相对 11pt 正文
    pub fn volume_size(self) -> f64 {
        self.body * (13.0 / 11.0)
    }
    pub fn volume_line(self) -> f64 {
        self.volume_size() * self.line + self.gap
    }
}

/// 字形表：把 ttf-parser 的 `Face`（借用字体字节、生命周期受限）降级为
/// 纯标量与哈希表，避免自引用结构。
struct GlyphTable {
    map: HashMap<char, u16>,
    advance: HashMap<char, f64>, // em 单位宽度（如 1.0 = 全角）
    units_per_em: f64,
    ascender: f64,
    descender: f64,
}

impl GlyphTable {
    fn glyph(&self, ch: char) -> u16 {
        *self.map.get(&ch).unwrap_or(&0)
    }

    fn advance_em(&self, ch: char) -> f64 {
        *self.advance.get(&ch).unwrap_or(&0.5)
    }

    /// 建立字形表；charset 为排版中会出现的全部字符。
    fn build(font_bytes: &[u8], charset: &HashSet<char>) -> AppResult<Self> {
        let face = ttf_parser::Face::parse(font_bytes, 0)
            .map_err(|e| AppError::Internal(format!("parse font: {e:?}")))?;
        let units_per_em = f64::from(face.units_per_em());
        let mut map = HashMap::new();
        let mut advance = HashMap::new();
        for &c in charset {
            if let Some(gid) = face.glyph_index(c) {
                let gid = gid.0;
                let adv = face
                    .glyph_hor_advance(ttf_parser::GlyphId(gid))
                    .unwrap_or(500) as f64
                    / units_per_em;
                map.insert(c, gid as u16);
                advance.insert(c, adv);
            }
        }
        let ascender = f64::from(face.ascender()) / units_per_em;
        let descender = f64::from(face.descender()) / units_per_em;
        Ok(GlyphTable {
            map,
            advance,
            units_per_em,
            ascender,
            descender,
        })
    }
}

// ─── 入口 ───

pub fn export_pdf(
    title: String,
    description: Option<String>,
    chapters: Vec<EpubChapter>,
    layout: super::layout::BookLayoutSpec,
    assets: super::FrozenAssets,
    meta: super::BookMeta,
    path: String,
) -> AppResult<()> {
    // R1：正文版式来自作者的排版设置（`PdfLayout` 只负责换算成 PDF 单位）
    let lay = PdfLayout::from_spec(&layout);
    // 1. 定位系统 CJK 字体
    let font_path = find_cjk_font()?;
    let font_bytes = std::fs::read(&font_path)
        .map_err(|e| AppError::Internal(format!("read font {font_path}: {e}")))?;

    // 2. 收集排版需要的全部字符（正文 + 标题 + 封面/目录辅助字符）
    let mut charset: HashSet<char> = HashSet::new();
    for ch in &chapters {
        charset.extend(ch.title.chars());
        charset.extend(clean_text(&ch.content).chars());
        if let Some(v) = &ch.volume {
            charset.extend(v.chars());
        }
    }
    if let Some(d) = &description {
        charset.extend(d.chars());
    }
    charset.extend(title.chars());
    // 目录/封面固定文案字符（数字、点、书名号、冒号、空格、页码斜杠、出品字样等）
    for extra in "0123456789.…·，。、：；！？（）《》——· SightFolio导出之目录出品/ pgt".chars()
    {
        charset.insert(extra);
    }
    // 扉页署名行（作者 ｜ 出版社）。字符必须进子集：字形缺失不报错，只会安静地什么都不显示，
    // 那种"看起来没问题"的坏法最难查，所以这里连同 charset 一起处理并留在注释里提醒。
    let byline = super::byline_of(&meta);
    charset.extend(byline.chars());
    let glyphs = GlyphTable::build(&font_bytes, &charset)?;

    // 3. 预收集正文图片
    let img_cache = collect_images(&chapters, &assets)?;
    let img_dims: HashMap<String, (u32, u32)> = img_cache
        .iter()
        .filter_map(|(k, v)| image_dimensions(v).ok().map(|d| (k.clone(), d)))
        .collect();

    // 4. 建立 PDF 文档与字体对象链
    let mut doc = lopdf::Document::with_version("1.4");

    // FontFile2：整字体 FlateDecode 压缩后嵌入（TTF 的 glyf/cmap 表压缩率高）。
    let mut font_file_compressed = Vec::new();
    {
        let mut enc = flate2::write::ZlibEncoder::new(
            &mut font_file_compressed,
            flate2::Compression::default(),
        );
        enc.write_all(&font_bytes)
            .map_err(|e| AppError::Internal(format!("compress font: {e}")))?;
        enc.finish()
            .map_err(|e| AppError::Internal(format!("compress font finish: {e}")))?;
    }
    let font_file_id: ObjectId = doc.add_object(Stream::new(
        dictionary! {
            "Length1" => Object::from(font_bytes.len() as i64),
            "Filter" => Object::Name(b"FlateDecode".to_vec()),
        },
        font_file_compressed,
    ));
    let font_descriptor_id: ObjectId = doc.add_object(dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => "SightFolioCJK",
        "Flags" => Object::from(4), // Symbolic
        "FontBBox" => vec![
            Object::from(-1000i64),
            Object::from(-1000i64),
            Object::from(2000i64),
            Object::from(2000i64),
        ],
        "ItalicAngle" => Object::from(0),
        "Ascent" => (glyphs.ascender * 1000.0) as i64,
        "Descent" => (glyphs.descender * 1000.0) as i64,
        "CapHeight" => (glyphs.ascender * 1000.0) as i64,
        "StemV" => Object::from(80),
        "FontFile2" => font_file_id,
    });
    let cid_font_id: ObjectId = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "CIDFontType2",
        "BaseFont" => "SightFolioCJK",
        "CIDSystemInfo" => dictionary! {
            "Registry" => Object::string_literal("Adobe"),
            "Ordering" => Object::string_literal("Identity"),
            "Supplement" => Object::from(0),
        },
        "FontDescriptor" => font_descriptor_id,
        "CIDToGIDMap" => "Identity",
        "DW" => Object::from(1000),
        "W" => build_width_array(&glyphs),
    });
    let to_unicode_id = doc.add_object(build_to_unicode_cmap(&glyphs));
    let type0_font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type0",
        "BaseFont" => "SightFolioCJK",
        // 必须是 **Name** 对象（`/Identity-H`），不能是字符串字面量。
        // 写成 `Object::string_literal` 会输出成 `(Identity-H)`，poppler / Safari / Chrome
        // 一律判 `Invalid Encoding in Type 0 font` → 字体装载失败 → `No font in show`
        // → 所有文字绘制被静默丢弃，**每一页都是白纸**，而导出仍然返回成功。
        // 这一行是 2026-11-06 用真产物 + 浏览器截屏查出来的 P0。
        "Encoding" => Object::Name(b"Identity-H".to_vec()),
        "DescendantFonts" => vec![Object::from(cid_font_id)],
        "ToUnicode" => to_unicode_id,
    });

    // 5. 图片 XObjects
    let mut img_objs: HashMap<String, Object> = HashMap::new();
    for (rel, bytes) in &img_cache {
        if let Ok(stream) = make_image_xobject(bytes) {
            let id = doc.add_object(stream);
            img_objs.insert(rel.clone(), Object::from(id));
        }
    }

    // 6. 排版：封面页 + 目录页 + 正文（按章流式分页，基线坐标模型）
    let mut page_streams: Vec<Vec<u8>> = Vec::new();
    page_streams.push(build_cover_stream(&title, &byline, &description, &glyphs));
    page_streams.push(build_toc_stream(&title, &chapters, &[], &glyphs)); // 页码占位，稍后回填

    let mut current: Vec<u8> = Vec::new();
    let mut baseline = PAGE_H - MARGIN - lay.body; // 首行基线
    let mut page_count: u32 = 2; // 已含封面+目录
    let mut chap_start: Vec<u32> = Vec::new();
    let mut last_volume: String = String::new();
    // 结构口径判据（与目录页同源）：容器行走卷页排版，遗留 volume 字符串卷标自动失效
    let tree = has_tree_payload(&chapters);

    for ch in &chapters {
        // 章首强制新页（出版惯例：每章起新页；第一章紧随目录页亦从新页开始）
        if !current.is_empty() {
            page_streams.push(std::mem::take(&mut current));
            page_count += 1;
            baseline = PAGE_H - MARGIN - lay.body;
        }
        // 结构口径（快照导出）：容器节点自己就是**卷页**，卷题走居中大字，
        // 它带的正文按卷首语排在下面 —— 所以这一行不再需要"章前卷标"，两套同时给会重复。
        // 遗留口径：仍按 volume 字符串在章前打一行卷标（旧调用方零变化）。
        let is_volume_page = tree && ch.is_volume == Some(true);
        let volume = if tree {
            ""
        } else {
            ch.volume.as_deref().unwrap_or("").trim()
        };
        // 卷标题：卷名变化时在新页顶部输出粗体卷标（目录卷层级与正文呼应）
        let vol_line_h = if !volume.is_empty() && volume != last_volume {
            lay.volume_line()
        } else {
            0.0
        };
        ensure_space(
            &mut current,
            &mut baseline,
            &mut page_streams,
            &mut page_count,
            lay.heading_line() + vol_line_h,
            lay.body,
        );
        if vol_line_h > 0.0 {
            append_text_line_center(
                &mut current,
                volume,
                lay.volume_size(),
                &glyphs,
                baseline,
                true,
            );
            baseline -= lay.volume_line();
            last_volume = volume.to_string();
        }
        chap_start.push(page_count); // 该章起始落在当前页（ensure_space 已翻页则已 +1）
        let title_size = if is_volume_page {
            lay.body * (17.0 / 11.0)
        } else {
            lay.heading_size()
        };
        if is_volume_page {
            append_text_line_center(&mut current, &ch.title, title_size, &glyphs, baseline, true);
        } else {
            append_text_line_at(
                &mut current,
                &ch.title,
                title_size,
                &glyphs,
                MARGIN,
                baseline,
                true,
            );
        }
        baseline -= title_size * lay.line + lay.gap;

        let blocks = parse_blocks(&ch.content);
        for block in blocks {
            match block {
                HtmlBlock::Paragraph(text) => {
                    // 中文出版惯例：段落首行缩进 2 字符（2 × 字号）。
                    // ㉱ E-A′：字符数从 `lay.indent_em` 取 —— 这张表的值由 layout 裁定
                    // （语种×体裁：中文非诗=2.0，西文与诗集=0.0）。旧实现写死 2.0，
                    // `from_spec` 算好的开关在排版循环里从未被消费 —— F4 在 PDF 断在这里。
                    let indent = lay.body * lay.indent_em;
                    let (first_line, rest) =
                        layout_text_first_indent(&text, lay.body, BODY_W, indent, &glyphs);
                    if let Some(fl) = first_line {
                        ensure_space(
                            &mut current,
                            &mut baseline,
                            &mut page_streams,
                            &mut page_count,
                            lay.body_line(),
                            lay.body,
                        );
                        append_text_line_at(
                            &mut current,
                            &fl,
                            lay.body,
                            &glyphs,
                            MARGIN + indent,
                            baseline,
                            false,
                        );
                        baseline -= lay.body * lay.line;
                    }
                    for line in rest {
                        ensure_space(
                            &mut current,
                            &mut baseline,
                            &mut page_streams,
                            &mut page_count,
                            lay.body_line(),
                            lay.body,
                        );
                        append_text_line(&mut current, &line, lay.body, &glyphs, baseline);
                        baseline -= lay.body * lay.line;
                    }
                    baseline -= lay.gap;
                }
                HtmlBlock::Heading(text, level) => {
                    let size = if level <= 1 { 14.0 } else { 12.0 };
                    ensure_space(
                        &mut current,
                        &mut baseline,
                        &mut page_streams,
                        &mut page_count,
                        size * lay.line * 2.0 + lay.gap,
                        lay.body,
                    );
                    append_text_line_at(&mut current, &text, size, &glyphs, MARGIN, baseline, true);
                    baseline -= size * lay.line + lay.gap;
                }
                HtmlBlock::Image(rel) => {
                    if let Some((w, h)) = img_dims.get(&rel) {
                        if let Some(obj) = img_objs.get(&rel) {
                            let scale = (MAX_IMG_W / f64::from(*w)).min(1.0);
                            let dw = f64::from(*w) * scale;
                            let dh = f64::from(*h) * scale;
                            ensure_space(
                                &mut current,
                                &mut baseline,
                                &mut page_streams,
                                &mut page_count,
                                dh + lay.gap,
                                lay.body,
                            );
                            append_image(&mut current, obj, dw, dh, baseline);
                            baseline -= dh + lay.gap;
                        }
                    }
                }
                HtmlBlock::Table(rows) => {
                    for row in rows {
                        let line = row;
                        if line.is_empty() {
                            continue;
                        }
                        for wrapped in layout_text(&line, lay.body, BODY_W, &glyphs) {
                            ensure_space(
                                &mut current,
                                &mut baseline,
                                &mut page_streams,
                                &mut page_count,
                                lay.body_line(),
                                lay.body,
                            );
                            append_text_line(&mut current, &wrapped, lay.body, &glyphs, baseline);
                            baseline -= lay.body * lay.line;
                        }
                    }
                    baseline -= lay.gap;
                }
            }
        }
    }
    if !current.is_empty() {
        page_streams.push(current);
    }

    // 7. 页面对象（目录页 Contents 用真实页码重建；非封面页追加页脚页码）
    let total_pages = page_streams.len();
    let mut page_ids: Vec<Object> = Vec::new();
    for (i, stream) in page_streams.iter().enumerate() {
        let content_obj = if i == 1 {
            build_toc_stream(&title, &chapters, &chap_start, &glyphs)
        } else {
            stream.clone()
        };
        let mut content_final = content_obj;
        if i > 0 {
            // 页脚页码：正文页从第 2 页（目录）起计；"页码 / 总页数" 持平于页底居中
            let footer = format!("{} / {}", i, total_pages - 1);
            let footer_y = MARGIN / 2.0;
            let mut footer_buf: Vec<u8> = Vec::new();
            append_text_line_center(&mut footer_buf, &footer, 9.0, &glyphs, footer_y, false);
            content_final.extend_from_slice(&footer_buf);
        }
        let content_id = doc.add_object(Stream::new(dictionary! {}, content_final));
        let mut xobj = lopdf::Dictionary::new();
        for (k, v) in &img_objs {
            xobj.set(k.clone(), v.clone());
        }
        let page_id = doc.add_object(
            dictionary! {
                "Type" => "Page",
                "MediaBox" => vec![Object::from(0), Object::from(0), Object::from(PAGE_W), Object::from(PAGE_H)],
                "Contents" => content_id,
                "Resources" => dictionary! {
                    "Font" => dictionary! { "F1" => type0_font_id },
                    "XObject" => xobj,
                },
            },
        );
        page_ids.push(Object::from(page_id));
    }

    // 8. Pages / Catalog / trailer
    let page_count_val = page_ids.len() as i64;
    let pages_id = doc.add_object(dictionary! {
        "Type" => "Pages",
        "Kids" => page_ids,
        "Count" => Object::from(page_count_val),
    });
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", Object::from(catalog_id));

    doc.save(&path)
        .map_err(|e| AppError::Internal(format!("pdf save: {e}")))?;
    Ok(())
}

fn ensure_space(
    current: &mut Vec<u8>,
    baseline: &mut f64,
    pages: &mut Vec<Vec<u8>>,
    page_count: &mut u32,
    need: f64,
    body: f64,
) {
    // 所需行高超过本页剩余空间（基线到页底）时翻页。
    let top = *baseline; // 当前基线 = 距页顶的绝对高度
    if top < MARGIN + need {
        pages.push(std::mem::take(current));
        *page_count += 1;
        *baseline = PAGE_H - MARGIN - body;
    }
}

/// 追加一行文本：Identity-H 编码，用十六进制字符串写入 GID 字节（每字 2 字节），
/// 起点在 (x, baseline)。`bold` 用 TextRenderingMode=2（fill+stroke）描边模拟加粗，
/// 对嵌入的单一字重 CJK 字体（无 Bold 变体）可用。
fn append_text_line_at(
    buf: &mut Vec<u8>,
    text: &str,
    size: f64,
    glyphs: &GlyphTable,
    x: f64,
    baseline: f64,
    bold: bool,
) {
    let mut hex = String::with_capacity(text.len() * 4);
    for ch in text.chars() {
        let gid = glyphs.glyph(ch);
        hex.push_str(&format!("{:04X}", gid));
    }
    let stroke = if bold { "2 Tr 0.55 w " } else { "" };
    let restore = if bold { " 0 Tr" } else { "" };
    let _ = write!(
        buf,
        "BT /F1 {} Tf {}1 0 0 1 {} {} Tm <{}> Tj{} ET\n",
        size,
        stroke,
        format_f64(x),
        format_f64(baseline),
        hex,
        restore
    );
}

/// 追加一行文本：默认左页边距、非加粗（兼容旧调用点）。
fn append_text_line(buf: &mut Vec<u8>, text: &str, size: f64, glyphs: &GlyphTable, baseline: f64) {
    append_text_line_at(buf, text, size, glyphs, MARGIN, baseline, false)
}

/// 计算一行文本的按字形宽度（单位：pt，与 font_size 同尺度），供居中排版用。
fn text_width(text: &str, font_size: f64, glyphs: &GlyphTable) -> f64 {
    text.chars().map(|c| glyphs.advance_em(c) * font_size).sum()
}

/// 居中追加一行文本（x 自适应，使文本水平居中于页面）。
fn append_text_line_center(
    buf: &mut Vec<u8>,
    text: &str,
    size: f64,
    glyphs: &GlyphTable,
    baseline: f64,
    bold: bool,
) {
    let w = text_width(text, size, glyphs);
    let x = (PAGE_W - w) / 2.0;
    append_text_line_at(buf, text, size, glyphs, x, baseline, bold);
}

/// 追加一张图：q w 0 0 h x y cm /ImN Do Q（图左下角在绝对坐标）。
/// baseline 是当前行基线（页面绝对 y），图片底边贴基线、向上绘制。
fn append_image(buf: &mut Vec<u8>, obj: &Object, w: f64, h: f64, baseline: f64) {
    let n = match obj {
        Object::Reference(id) => id.0,
        _ => return,
    };
    let bottom = baseline; // 图片底边贴当前基线，向上绘制
    let _ = write!(
        buf,
        "q {} 0 0 {} {} {} cm /Im{} Do Q\n",
        format_f64(w),
        format_f64(h),
        format_f64(MARGIN),
        format_f64(bottom),
        n
    );
}

fn format_f64(v: f64) -> String {
    let s = format!("{:.2}", v);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// 按字符 advance 累加断行的**软折**本体（任意语言都按真实字形宽度换行）：只管页宽，
/// 不解释 `\n` —— 硬换行由 `layout_text` / `layout_text_first_indent` 先切段。
/// 拆成独立函数是因为首行缩进那一支要复用同一段算术，不许复制粘贴两份。
/// 软折的循环本体。首行缩进那一支要复用同一段算术，所以单独拆出来（不许复制粘贴两份）。
fn wrap_width(line: &str, font_size: f64, max_width: f64, glyphs: &GlyphTable) -> Vec<String> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    let mut w: f64 = 0.0;
    for ch in line.chars() {
        let cw = glyphs.advance_em(ch) * font_size;
        if w + cw > max_width && !cur.is_empty() {
            lines.push(cur.clone());
            cur.clear();
            w = 0.0;
        }
        cur.push(ch);
        w += cw;
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

/// 【E-F · 轮 54】先按 `\n` 切**硬换行**（`<br>` 在解析层留的痕），每段再按字宽软折。
/// 改前只认字宽 ⇒ 作者的分行到 PDF 全塌；空段（`<br><br>`）在这里产出一条**真空行**，
/// 而不是被末尾那句 `if !line.is_empty()` 顺手吞掉（`r54丙` 钉住）。
fn layout_text(text: &str, font_size: f64, max_width: f64, glyphs: &GlyphTable) -> Vec<String> {
    let mut lines = Vec::new();
    for seg in text.split('\n') {
        if seg.is_empty() {
            lines.push(String::new());
        } else {
            lines.extend(wrap_width(seg, font_size, max_width, glyphs));
        }
    }
    lines
}

/// 按字符 advance 累加断行（任意语言都按真实字形宽度换行）。
/// `first_indent` > 0 时，第一行可用宽度扣除该缩进量（中文首行缩进 2 字符），
/// 返回 `(首行, 后续行)`；首行需横向偏移 `first_indent` 绘制。
///
/// 【E-F · 轮 54】缩进只作用于**第一个物理行段**：段后的 `<br>` 是作者分行，
/// 既不继续缩进、也不许被折回首行。**零回归口径**（`r54丁` 钉）：无 `\n` 时逐字等于改前 ——
/// 首行填到 `first_max` 就换行，剩余部分按**满宽**重排，不是整段按 `first_max` 折。
fn layout_text_first_indent(
    text: &str,
    font_size: f64,
    max_width: f64,
    first_indent: f64,
    glyphs: &GlyphTable,
) -> (Option<String>, Vec<String>) {
    if text.is_empty() {
        return (None, Vec::new());
    }
    if first_indent <= 0.0 {
        let mut rest = layout_text(text, font_size, max_width, glyphs);
        let first = rest.first().cloned();
        if !rest.is_empty() {
            rest.remove(0);
        }
        return (first, rest);
    }
    // 首行按 first_max 断行；剩余字符按满宽重排（这一段算术与改前逐字一致）
    let first_max = max_width - first_indent;
    let head = text.split('\n').next().unwrap_or("");
    let mut first = String::new();
    let mut w = 0.0f64;
    // `taken` = 真正吃进首行的字数。剩余部分一律按**已取字数**回退（与改前
    // `text.chars().skip(first.chars().count())` 同一口径）。这里曾用 `while let Some(ch) = chars.next()`
    // 迭代器取到再 break，那个字符既没进首行也没进 remainder ⇒ **正文丢字**，
    // 被零回归金样 `r54丁` 当场抓住（少一个"甲"）。不许再拿迭代器当前位置当"已消费"。
    let mut taken = 0usize;
    for ch in head.chars() {
        let cw = glyphs.advance_em(ch) * font_size;
        if w + cw > first_max && !first.is_empty() {
            break;
        }
        first.push(ch);
        w += cw;
        taken += 1;
    }
    let remainder: String = head.chars().skip(taken).collect();
    let mut rest = wrap_width(&remainder, font_size, max_width, glyphs);
    // 其后的硬换行段：满宽、不缩进；空段 = 一条真空行
    for seg in text.split('\n').skip(1) {
        if seg.is_empty() {
            rest.push(String::new());
        } else {
            rest.extend(wrap_width(seg, font_size, max_width, glyphs));
        }
    }
    (Some(first), rest)
}

/// W 宽度数组：每字符 `gid [advance]` 段。
fn build_width_array(glyphs: &GlyphTable) -> Object {
    let mut entries: Vec<(u16, i64)> = glyphs
        .map
        .iter()
        .map(|(c, gid)| (*gid, (glyphs.advance_em(*c) * 1000.0).round() as i64))
        .collect();
    entries.sort_by_key(|e| e.0);
    let mut items: Vec<Object> = Vec::with_capacity(entries.len() * 2);
    for (gid, adv) in entries {
        items.push(Object::from(i64::from(gid)));
        items.push(Object::from(vec![Object::from(adv)]));
    }
    Object::from(items)
}

// ─── HTML 块解析（轻量） ───

enum HtmlBlock {
    Paragraph(String),
    Heading(String, u32),
    Image(String),
    Table(Vec<String>),
}

fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div" | "blockquote" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
    )
}

/// 从 `<tag ...>` 提取标签名（小写）。
fn tag_name(lower_tag: &str) -> Option<&str> {
    let inner = lower_tag.strip_prefix('<')?;
    let name = inner
        .split(|c: char| c.is_whitespace() || c == '/' || c == '>')
        .next()?;
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// 【E-F · 轮 54】把源文本并入累积器，顺手按 HTML 口径把**裸换行折成空格**。
///
/// `\n` 这个记号从本轮起**只归 `<br>` 所有**：不折这一步，导入稿/格式化过的 HTML 里那些
/// 排版用的换行会被 `layout_text` 当成作者手打的分行，凭空切出假分行（`r54戊` 钉这条边界）。
/// 所以 `<br>` 那一支不走这里 —— 它直接 `push('\n')`，两者不许混用同一个记号。
fn push_plain(acc: &mut String, s: &str) {
    for ch in s.chars() {
        acc.push(match ch {
            '\n' | '\r' => ' ',
            c => c,
        });
    }
}

/// 块级解析：把 HTML 降维成段落/标题/图片/表格。递归处理块内子内容，
/// 变换累计文本到最近的块级结构。
fn parse_blocks(html: &str) -> Vec<HtmlBlock> {
    let mut blocks = Vec::new();
    parse_blocks_into(html, &mut blocks);
    blocks
}

fn parse_blocks_into(html: &str, blocks: &mut Vec<HtmlBlock>) {
    let mut rest = html;
    let mut text_acc = String::new();

    let flush = |acc: &mut String, blk: &mut Vec<HtmlBlock>| {
        if !acc.trim().is_empty() {
            blk.push(HtmlBlock::Paragraph(clean_text(acc)));
            acc.clear();
        }
    };

    loop {
        let Some(pos) = rest.find('<') else {
            push_plain(&mut text_acc, rest);
            break;
        };
        push_plain(&mut text_acc, &rest[..pos]);
        let after = &rest[pos..];
        let Some(gt) = after.find('>') else {
            text_acc.push_str(after);
            break;
        };
        let tag = &after[..=gt];
        let tail = &after[gt + 1..];
        let lower = tag.to_lowercase();

        // 注释/声明直接跳过
        if lower.starts_with("<!--") {
            rest = match tail.find("-->") {
                Some(e) => &tail[e + 3..],
                None => "",
            };
            continue;
        }
        // 闭合标签仅消耗
        if lower.starts_with("</") {
            rest = tail;
            continue;
        }

        let name = tag_name(&lower);
        match name {
            Some("br") => {
                // 【E-F · 轮 54】`<br>` 是作者手打的**硬换行**。改前这里只消耗标签、什么痕都不留
                // ⇒ 12 行诗的 PDF 塌成一整段（台账 E-F / 旧导出报告 P0-1 E-1）。这里只负责**留痕**，
                // 真正的换行落点在 layout_text / layout_text_first_indent。
                text_acc.push('\n');
                rest = tail;
            }
            Some(n) if is_block_tag(n) => {
                flush(&mut text_acc, blocks);
                let close = format!("</{n}>");
                let (content, tail2) = match tail.find(&close) {
                    Some(e) => (&tail[..e], &tail[e + close.len()..]),
                    None => (tail, ""),
                };
                if n.starts_with('h') {
                    let mut sub = Vec::new();
                    parse_blocks_into(content, &mut sub);
                    let txt: String = sub
                        .into_iter()
                        .filter_map(|b| match b {
                            HtmlBlock::Paragraph(t) | HtmlBlock::Heading(t, _) => Some(t),
                            _ => None,
                        })
                        .collect();
                    let level = n[1..].parse().unwrap_or(1);
                    blocks.push(HtmlBlock::Heading(clean_text(&txt), level));
                } else {
                    parse_blocks_into(content, blocks);
                }
                rest = tail2;
            }
            Some("img") => {
                flush(&mut text_acc, blocks);
                if let Some(rel) = extract_data_asset(tag) {
                    blocks.push(HtmlBlock::Image(rel));
                }
                rest = tail;
            }
            Some("table") => {
                flush(&mut text_acc, blocks);
                let close = "</table>";
                let (content, tail2) = match tail.find(close) {
                    Some(e) => (&tail[..e], &tail[e + close.len()..]),
                    None => (tail, ""),
                };
                let rows: Vec<String> = content
                    .split("<tr")
                    .skip(1)
                    .map(|r| {
                        let cell = r.split("</tr>").next().unwrap_or("");
                        // 行内单元格以 | 拼接（粗化，保证可读）
                        table_row_to_text(cell)
                    })
                    .collect();
                blocks.push(HtmlBlock::Table(rows));
                rest = tail2;
            }
            _ => {
                // 未知标签：消耗标签本身，内部内容继续累积
                rest = tail;
            }
        }
    }
    if !text_acc.trim().is_empty() {
        blocks.push(HtmlBlock::Paragraph(clean_text(&text_acc)));
    }
}

fn clean_text(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        match ch {
            '<' | '>' => {}
            _ => out.push(ch),
        }
    }
    out.trim()
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// 表格行 → "单元格 | 单元格" 文本（仿 DOCX 导出的 extract_cells_text）：
/// 提取 <td>/<th> 单元格内容并以 " | " 拼接，避免 clean_text 只删尖括号导致的标签残渣。
fn table_row_to_text(row_html: &str) -> String {
    let mut cells: Vec<String> = Vec::new();
    let cursor = row_html;
    for tag in ["<td", "<th"] {
        let mut sub = cursor;
        while let Some(start) = sub.find(tag) {
            let after = &sub[start..];
            let Some(gt_rel) = after.find('>') else { break };
            let after_open = &after[gt_rel + 1..];
            let end = if tag == "<td" { "</td>" } else { "</th>" };
            let Some(end_pos) = after_open.find(end) else {
                break;
            };
            cells.push(clean_text(&after_open[..end_pos]));
            sub = &after_open[end_pos + end.len()..];
        }
    }
    if cells.is_empty() {
        // 兜底：无标准单元格时退化为纯文本清理
        clean_text(row_html)
    } else {
        cells.join(" | ")
    }
}

fn extract_data_asset(tag: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let key = "data-asset=\"";
    let pos = lower.find(key)?;
    let rest = &tag[pos + key.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// ─── 封面/目录页 ───

fn build_cover_stream(
    title: &str,
    byline: &str,
    description: &Option<String>,
    glyphs: &GlyphTable,
) -> Vec<u8> {
    let mut buf = Vec::new();
    // 垂直居中排布：书名、简介（如有）、出品行
    let mut y = PAGE_H / 2.0 + 60.0;
    // 书名（大字号 + 加粗描边）
    for line in layout_text(title, 26.0, BODY_W, glyphs) {
        append_text_line_center(&mut buf, &line, 26.0, glyphs, y, true);
        y -= 26.0 * 1.4;
    }
    y -= 26.0;
    // 署名行：作者没录就整行不排
    if !byline.is_empty() {
        for line in layout_text(byline, 14.0, BODY_W, glyphs) {
            append_text_line_center(&mut buf, &line, 14.0, glyphs, y, false);
            y -= 14.0 * 1.6;
        }
        y -= 14.0;
    }
    if let Some(d) = description {
        for line in layout_text(d, 12.0, BODY_W, glyphs) {
            append_text_line_center(&mut buf, &line, 12.0, glyphs, y, false);
            y -= 12.0 * 1.6;
        }
        y -= 18.0;
    } else {
        y -= 40.0;
    }
    append_text_line_center(&mut buf, "Sight Folio 出品", 11.0, glyphs, y, false);
    buf
}

fn build_toc_stream(
    title: &str,
    chapters: &[EpubChapter],
    pages: &[u32],
    glyphs: &GlyphTable,
) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut y = PAGE_H - MARGIN;
    let head = format!("『{}』· 目录", title);
    // 目录标题加粗（与正文章标题字重一致）
    append_text_line_at(&mut buf, &head, 16.0, &glyphs, MARGIN, y, true);
    y -= 40.0;

    // 卷分组：卷名首次出现输出卷标题（粗体），后续章条目相对卷缩进 2 字符；
    // 无卷的书保持平铺。页码右对齐到页尾（右缩进 = MARGIN），点线自适应填充中间空隙。
    // 目录两种口径（判据只在 has_tree_payload 一处）：
    //  · 结构口径（快照导出）：条目按 depth 逐层缩进，容器（卷/篇）自身加粗 —— 目录里
    //    就是父子关系，卷不再是「凭空多出来的一行组标题」；
    //  · 遗留口径（旧调用方只给 volume 字符串）：卷名首现输出粗体组题，卷下章缩进 2 字。
    let tree = has_tree_payload(chapters);
    let page_right = PAGE_W - MARGIN;
    let mut seen_volume: Option<String> = None;
    for (i, ch) in chapters.iter().enumerate() {
        let indent; // 不初始化：if/else 所有路径都赋值，消除 unused_assignments 警告
        let mut bold = false; // 保留初始值，else 分支里不赋值（粗体只在 tree 模式生效）
        if tree {
            indent = 22.0 * ch.depth.unwrap_or(0).min(3) as f64;
            bold = ch.is_volume == Some(true);
        } else {
            let volume = ch.volume.as_deref().filter(|v| !v.is_empty());
            if volume != seen_volume.as_deref() {
                if let Some(v) = volume {
                    append_text_line_at(&mut buf, v, 12.0, &glyphs, MARGIN, y, true);
                    y -= 22.0;
                }
            }
            seen_volume = volume.map(str::to_string); // 不管 volume 是 Some/None 都更新
            indent = if volume.is_some() { 22.0 } else { 0.0 }; // 卷下章条目缩进（2 × 11pt）
        }
        let entry_size = if bold { 12.0 } else { 11.0 };
        let p = pages.get(i).copied().unwrap_or(0);

        // 标题（左起点 = 页边距 + 层级缩进）
        append_text_line_at(
            &mut buf,
            &ch.title,
            entry_size,
            &glyphs,
            MARGIN + indent,
            y,
            bold,
        );
        if p > 0 {
            // 页码右对齐：右端贴页边距
            let page_text = p.to_string();
            let page_w = text_width(&page_text, 11.0, &glyphs);
            let page_x = page_right - page_w;
            // 点线自适应：从标题末尾到页码左端之间填满（宽度按条目实际字号算）
            let title_w = text_width(&ch.title, entry_size, &glyphs);
            let dot_w = text_width("·", 11.0, &glyphs);
            let gap = page_x - (MARGIN + indent + title_w) - 6.0; // 标题与页码的最小间距
            let dot_count = if gap > 0.0 && dot_w > 0.0 {
                (gap / dot_w).floor().max(1.0) as usize
            } else {
                0
            };
            if dot_count > 0 {
                let dots = "·".repeat(dot_count);
                append_text_line_at(
                    &mut buf,
                    &dots,
                    11.0,
                    &glyphs,
                    MARGIN + indent + title_w,
                    y,
                    false,
                );
            }
            append_text_line_at(&mut buf, &page_text, 11.0, &glyphs, page_x, y, false);
        }
        y -= 18.0;
    }
    buf
}

// ─── 图片 ───

fn collect_images(
    chapters: &[EpubChapter],
    frozen: &super::FrozenAssets,
) -> AppResult<HashMap<String, Vec<u8>>> {
    let mut map = HashMap::new();
    for ch in chapters {
        let mut cursor = ch.content.as_str();
        while let Some(pos) = cursor.find("data-asset=\"") {
            let rest = &cursor[pos + "data-asset=\"".len()..];
            let Some(end) = rest.find('"') else {
                break;
            };
            let rel = &rest[..end];
            if !rel.is_empty() && !map.contains_key(rel) {
                // R4：走统一读法（定格优先、活盘兜底、缺图点名）。
                // 此前这里是两层 `if let Ok(..)` —— 读不到就**静默丢图**，PDF 里那块位置直接空着，
                // 作者拿到手才发现少了插画。缺图现在让任务失败并说出是哪个文件。
                let (bytes, _media) = super::read_asset_bytes(rel, Some(frozen))?;
                map.insert(rel.to_string(), bytes);
            }
            cursor = &rest[end..];
        }
    }
    Ok(map)
}

fn image_dimensions(bytes: &[u8]) -> AppResult<(u32, u32)> {
    use image::GenericImageView;
    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::Internal(format!("decode image: {e}")))?;
    Ok(img.dimensions())
}

/// 解码为 RGB8 → FlateDecode 压缩 → 图像 XObject 流。
fn make_image_xobject(bytes: &[u8]) -> AppResult<Stream> {
    use image::GenericImageView;
    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::Internal(format!("decode image: {e}")))?;
    let (w, h) = img.dimensions();
    let rgb = img.to_rgb8();
    let mut compressed = Vec::new();
    {
        let mut enc =
            flate2::write::ZlibEncoder::new(&mut compressed, flate2::Compression::default());
        enc.write_all(&rgb)
            .map_err(|e| AppError::Internal(format!("compress image: {e}")))?;
        enc.finish()
            .map_err(|e| AppError::Internal(format!("compress finish: {e}")))?;
    }
    Ok(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => Object::from(w as i64),
            "Height" => Object::from(h as i64),
            "ColorSpace" => Object::Name(b"DeviceRGB".to_vec()),
            "BitsPerComponent" => Object::from(8i64),
            "Filter" => Object::Name(b"FlateDecode".to_vec()),
        },
        compressed,
    ))
}

// ─── ToUnicode CMap ───

fn build_to_unicode_cmap(glyphs: &GlyphTable) -> Stream {
    let mut entries: Vec<(u16, char)> = glyphs.map.iter().map(|(c, gid)| (*gid, *c)).collect();
    entries.sort_by_key(|e| e.0);
    let mut buf = String::new();
    buf.push_str("/CIDInit /ProcSet findresource begin\n");
    buf.push_str("12 dict begin\n");
    buf.push_str("begincmap\n");
    buf.push_str("/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n");
    buf.push_str("/CMapName /Adobe-Identity-UCS def\n");
    buf.push_str("/CMapType 2 def\n");
    buf.push_str("1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");
    if !entries.is_empty() {
        buf.push_str(&format!("{} beginbfchar\n", entries.len()));
        for (gid, c) in &entries {
            let u = *c as u32;
            let unicode = if u <= 0xFFFF {
                format!("{:04X}", u)
            } else {
                format!("{:08X}", u)
            };
            buf.push_str(&format!("<{:04X}> <{}>\n", gid, unicode));
        }
        buf.push_str("endbfchar\n");
    }
    buf.push_str("endcmap\n");
    buf.push_str("CMapName currentdict /CMap defineresource pop\n");
    buf.push_str("end\nend\n");
    Stream::new(dictionary! {}, buf.into_bytes())
}

// ─── 字体探测 ───

fn find_cjk_font() -> AppResult<String> {
    let candidates: Vec<&str> = vec![
        // macOS：单 TTF，含完整 CJK
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Arial Unicode.ttf",
        // Windows 黑体（单 TTF）
        "C:/Windows/Fonts/simhei.ttf",
        "C:\\Windows\\Fonts\\simhei.ttf",
        // Linux 常见单 TTF
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    ];
    for &p in &candidates {
        if std::path::Path::new(p).exists() {
            return Ok(p.to_string());
        }
    }
    Err(AppError::Internal(
        "no system CJK TTF font; PDF export requires a TTF font (e.g. DroidSansFallback).".into(),
    ))
}

// ─── 测试 · E-F（轮 54 新建：本文件此前零 test mod，PDF 这支从来没有护栏）───

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 空字形表 ⇒ `GlyphTable::advance_em` 对任何字符回退 0.5 em（见其 `unwrap_or(&0.5)`）；
    /// 字号 12pt ⇒ 每字 6pt。把「系统里有 CJK 字体」这个环境依赖从断言里摘掉，只留算术本身。
    fn fixed_glyphs() -> GlyphTable {
        GlyphTable {
            map: HashMap::new(),
            advance: HashMap::new(),
            units_per_em: 1000.0,
            ascender: 0.8,
            descender: -0.2,
        }
    }

    /// 12 行诗（台账 E-F 的验收形状）：11 枚硬换行，每行 3 字。
    fn poem_text(sep: &str) -> String {
        (1..=12)
            .map(|i| format!("第{i}行"))
            .collect::<Vec<String>>()
            .join(sep)
    }

    fn one_paragraph(blocks: &[HtmlBlock]) -> String {
        assert_eq!(blocks.len(), 1, "整段应合成一个段落块");
        match &blocks[0] {
            HtmlBlock::Paragraph(t) => t.clone(),
            _ => panic!("期望 Paragraph 块，得到别的块型"),
        }
    }

    /// **上游那枚钉**：`<br>` 必须在段落文本里留下痕。旧实现 `Some("br") => { rest = tail; }`
    /// 只消耗标签什么痕都不留 ⇒ 下游再怎么改也拿不到分行信息。三种写法都得认。
    #[test]
    fn r54甲_解析层必须把br留成硬换行痕() {
        assert_eq!(
            one_paragraph(&parse_blocks("<p>一行<br>二行<br/>三行<br />四行</p>")),
            "一行\n二行\n三行\n四行"
        );
    }

    /// 验收口径「逐格式行数 = 源」在 PDF 布局层的落点。满宽 420pt、每行 18pt ⇒ 一个物理
    /// 行段恰好一行；首行缩进只许作用于**第一个**行段，不许把后续行拉回缩进或合并。
    #[test]
    fn r54乙_十二行诗的布局行数必须等于源() {
        let g = fixed_glyphs();
        let text = poem_text("\n");
        let lines = layout_text(&text, 12.0, 420.0, &g);
        assert_eq!(lines.len(), 12, "实际折出 {} 行", lines.len());
        let (first, rest) = layout_text_first_indent(&text, 12.0, 420.0, 24.0, &g);
        assert_eq!(first.as_deref(), Some("第1行"));
        assert_eq!(rest.len(), 11, "缩进多吃了行段 ⇒ 行数漂");
        assert_eq!(rest[0], "第2行");
    }

    /// `<br><br>` = 一次真实空行。旧 `layout_text` 末尾的 `if !line.is_empty()` 会把空行吞掉。
    #[test]
    fn r54丙_连续两枚br必须产出一条真空行() {
        let g = fixed_glyphs();
        assert_eq!(
            layout_text("甲\n\n乙", 12.0, 420.0, &g),
            vec!["甲".to_string(), String::new(), "乙".to_string()]
        );
    }

    /// **零回归金样（改前就必须为绿）**：无 `<br>` 的小说段，断行算术逐字不变。
    /// 数字按改前实现手推（每字 6pt）：满宽 60pt ⇒ 10 字一行；首行缩进 30pt ⇒ 首行 5 字，
    /// 剩余按**满宽**重排 —— 改前就是「首行填到 first_max 就 break，其余交给 layout_text」，
    /// 不许改成「整段按 first_max 折」，那是把小说排版偷偷换掉。
    #[test]
    fn r54丁_无硬换行的小说段断行逐字不变() {
        let g = fixed_glyphs();
        let novel = "甲".repeat(20);
        assert_eq!(
            layout_text(&novel, 12.0, 60.0, &g),
            vec!["甲".repeat(10), "甲".repeat(10)]
        );
        let (first, rest) = layout_text_first_indent(&novel, 12.0, 60.0, 30.0, &g);
        assert_eq!(first.as_deref(), Some("甲甲甲甲甲"));
        assert_eq!(rest, vec!["甲".repeat(10), "甲".repeat(5)]);
        assert_eq!(
            layout_text_first_indent("", 12.0, 60.0, 30.0, &g),
            (None, Vec::new())
        );
    }

    /// `\n` 这个记号从本轮起**只归 `<br>` 所有**：源 HTML 里裸写的换行是排版空白，
    /// 按 HTML 口径折成空格。不做这一步，导入稿/格式化过的 HTML 会被切成一片假分行。
    #[test]
    fn r54戊_源码级裸换行不得冒充硬换行() {
        assert!(
            !one_paragraph(&parse_blocks("<p>第一段\n  续写\n第二段</p>")).contains('\n'),
            "裸换行必须折成空格"
        );
    }
}
