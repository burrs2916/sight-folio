// pdf_export.rs
// 离线原生 PDF 导出（T7）：不依赖浏览器打印，纯 Rust 生成。
//
// 技术要点：
// - lopdf 0.26（default-features=false，规避 0.34 解析器编译缺陷）手写 PDF 对象树；
// - 中文字体：定位系统 CJK TTF → ttf-parser 解析字形 → 嵌入
//   Type0/CIDFontType2（Identity-H 编码，CID=GID 由 FontFile2 字形表决定，
//   ToUnicode CMap 保证复制/搜索，W 数组按真实 advance 建立）；
// - 正文图片：`<img data-asset="...">` 经 `resolve_asset_ref` 读字节 →
//   image 解码为 RGB → FlateDecode 压缩为图像 XObject；
// - 换行：按字符 advance 累加逐字断行（CJK 无空格，不依赖空格分词）。
//
// 页面：A4（595 × 842 pt），左右 50pt 边距。版面：封面 → 目录 → 正文。

use std::collections::{HashMap, HashSet};
use std::io::Write;

use lopdf::dictionary;
use lopdf::{Object, ObjectId, Stream};

use super::EpubChapter;
use crate::commands::asset::resolve_asset_ref;
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
    path: String,
) -> AppResult<()> {
    // 1. 定位系统 CJK 字体
    let font_path = find_cjk_font()?;
    let font_bytes = std::fs::read(&font_path)
        .map_err(|e| AppError::Internal(format!("read font {font_path}: {e}")))?;

    // 2. 收集排版需要的全部字符（正文 + 标题 + 封面/目录辅助字符）
    let mut charset: HashSet<char> = HashSet::new();
    for ch in &chapters {
        charset.extend(ch.title.chars());
        charset.extend(clean_text(&ch.content).chars());
    }
    if let Some(d) = &description {
        charset.extend(d.chars());
    }
    charset.extend(title.chars());
    // 目录/封面固定文案字符（数字、点、书名号、冒号、空格等）
    for extra in "0123456789.…·，。、：；！？（）《》——· SightFolio导出之目录".chars()
    {
        charset.insert(extra);
    }
    let glyphs = GlyphTable::build(&font_bytes, &charset)?;

    // 3. 预收集正文图片
    let img_cache = collect_images(&chapters)?;
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
        "Encoding" => Object::string_literal("Identity-H"),
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
    page_streams.push(build_cover_stream(&title, &description, &glyphs));
    page_streams.push(build_toc_stream(&title, &chapters, &[], &glyphs)); // 页码占位，稍后回填

    let mut current: Vec<u8> = Vec::new();
    let mut baseline = PAGE_H - MARGIN - BODY_FONT_SIZE; // 首行基线
    let mut page_count: u32 = 2; // 已含封面+目录
    let mut chap_start: Vec<u32> = Vec::new();

    for ch in &chapters {
        // 章节标题
        ensure_space(
            &mut current,
            &mut baseline,
            &mut page_streams,
            &mut page_count,
            HEADING_LINE_H(),
        );
        chap_start.push(page_count); // 该章起始落在当前页（ensure_space 已翻页则已 +1）
        append_text_line(&mut current, &ch.title, 15.0, &glyphs, baseline);
        baseline -= 15.0 * LINE_HEIGHT_FACTOR + SKIP_GAP;

        let blocks = parse_blocks(&ch.content);
        for block in blocks {
            match block {
                HtmlBlock::Paragraph(text) => {
                    for line in layout_text(&text, BODY_FONT_SIZE, BODY_W, &glyphs) {
                        ensure_space(
                            &mut current,
                            &mut baseline,
                            &mut page_streams,
                            &mut page_count,
                            BODY_LINE_H(),
                        );
                        append_text_line(&mut current, &line, BODY_FONT_SIZE, &glyphs, baseline);
                        baseline -= BODY_FONT_SIZE * LINE_HEIGHT_FACTOR;
                    }
                    baseline -= SKIP_GAP;
                }
                HtmlBlock::Heading(text, level) => {
                    let size = if level <= 1 { 14.0 } else { 12.0 };
                    ensure_space(
                        &mut current,
                        &mut baseline,
                        &mut page_streams,
                        &mut page_count,
                        size * LINE_HEIGHT_FACTOR * 2.0 + SKIP_GAP,
                    );
                    append_text_line(&mut current, &text, size, &glyphs, baseline);
                    baseline -= size * LINE_HEIGHT_FACTOR + SKIP_GAP;
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
                                dh + SKIP_GAP,
                            );
                            append_image(&mut current, obj, dw, dh, baseline);
                            baseline -= dh + SKIP_GAP;
                        }
                    }
                }
                HtmlBlock::Table(rows) => {
                    for row in rows {
                        let line = row;
                        if line.is_empty() {
                            continue;
                        }
                        for wrapped in layout_text(&line, BODY_FONT_SIZE, BODY_W, &glyphs) {
                            ensure_space(
                                &mut current,
                                &mut baseline,
                                &mut page_streams,
                                &mut page_count,
                                BODY_LINE_H(),
                            );
                            append_text_line(
                                &mut current,
                                &wrapped,
                                BODY_FONT_SIZE,
                                &glyphs,
                                baseline,
                            );
                            baseline -= BODY_FONT_SIZE * LINE_HEIGHT_FACTOR;
                        }
                    }
                    baseline -= SKIP_GAP;
                }
            }
        }
    }
    if !current.is_empty() {
        page_streams.push(current);
    }

    // 7. 页面对象（目录页 Contents 用真实页码重建）
    let mut page_ids: Vec<Object> = Vec::new();
    for (i, stream) in page_streams.iter().enumerate() {
        let content_obj = if i == 1 {
            build_toc_stream(&title, &chapters, &chap_start, &glyphs)
        } else {
            stream.clone()
        };
        let content_id = doc.add_object(Stream::new(dictionary! {}, content_obj));
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

fn BODY_LINE_H() -> f64 {
    BODY_FONT_SIZE * LINE_HEIGHT_FACTOR
}

fn HEADING_LINE_H() -> f64 {
    15.0 * LINE_HEIGHT_FACTOR * 2.0 + SKIP_GAP
}

// ─── 排版辅助 ───

fn ensure_space(
    current: &mut Vec<u8>,
    baseline: &mut f64,
    pages: &mut Vec<Vec<u8>>,
    page_count: &mut u32,
    need: f64,
) {
    // 所需行高超过本页剩余空间（基线到页底）时翻页。
    let top = *baseline; // 当前基线 = 距页顶的绝对高度
    if top < MARGIN + need {
        pages.push(std::mem::take(current));
        *page_count += 1;
        *baseline = PAGE_H - MARGIN - BODY_FONT_SIZE;
    }
}

/// 追加一行文本：Identity-H 编码，用十六进制字符串写入 GID 字节（每字 2 字节）。
fn append_text_line(buf: &mut Vec<u8>, text: &str, size: f64, glyphs: &GlyphTable, baseline: f64) {
    let mut hex = String::with_capacity(text.len() * 4);
    for ch in text.chars() {
        let gid = glyphs.glyph(ch);
        hex.push_str(&format!("{:04X}", gid));
    }
    let _ = write!(
        buf,
        "BT /F1 {} Tf 1 0 0 1 {} {} Tm <{}> Tj ET\n",
        size,
        format_f64(MARGIN),
        format_f64(baseline),
        hex
    );
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

/// 按字符 advance 累加断行（任意语言都按真实字形宽度换行）。
fn layout_text(text: &str, font_size: f64, max_width: f64, glyphs: &GlyphTable) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut w: f64 = 0.0;
    for ch in text.chars() {
        let cw = glyphs.advance_em(ch) * font_size;
        if w + cw > max_width && !line.is_empty() {
            lines.push(line.clone());
            line.clear();
            w = 0.0;
        }
        line.push(ch);
        w += cw;
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
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
            text_acc.push_str(rest);
            break;
        };
        text_acc.push_str(&rest[..pos]);
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
                        clean_text(cell)
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

fn extract_data_asset(tag: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let key = "data-asset=\"";
    let pos = lower.find(key)?;
    let rest = &tag[pos + key.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// ─── 封面/目录页 ───

fn build_cover_stream(title: &str, description: &Option<String>, glyphs: &GlyphTable) -> Vec<u8> {
    let mut buf = Vec::new();
    // 书名（大字号）
    let mut y = PAGE_H / 2.0 + 60.0;
    for line in layout_text(title, 24.0, BODY_W, glyphs) {
        append_text_line(&mut buf, &line, 24.0, glyphs, y);
        y -= 24.0 * 1.4;
    }
    y -= 30.0;
    if let Some(d) = description {
        for line in layout_text(d, 12.0, BODY_W, glyphs) {
            append_text_line(&mut buf, &line, 12.0, glyphs, y);
            y -= 12.0 * 1.5;
        }
    }
    y -= 20.0;
    append_text_line(&mut buf, "Sight Folio 导出", 10.0, glyphs, y);
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
    append_text_line(&mut buf, &head, 16.0, glyphs, y);
    y -= 40.0;

    for (i, ch) in chapters.iter().enumerate() {
        let p = pages.get(i).copied().unwrap_or(0);
        let dots = "······".repeat(2);
        let line = if p > 0 {
            format!("{} {} {}", ch.title, dots, p)
        } else {
            ch.title.clone()
        };
        append_text_line(&mut buf, &line, 11.0, glyphs, y);
        y -= 18.0;
    }
    buf
}

// ─── 图片 ───

fn collect_images(chapters: &[EpubChapter]) -> AppResult<HashMap<String, Vec<u8>>> {
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
                // 优先相对引用解析；失败则按字面路径尝试
                let abs = resolve_asset_ref(rel.to_string())
                    .or_else(|_| Ok::<String, String>(rel.to_string()));
                if let Ok(abs) = abs {
                    if let Ok(bytes) = std::fs::read(&abs) {
                        map.insert(rel.to_string(), bytes);
                    }
                }
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
