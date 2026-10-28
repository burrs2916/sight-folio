// docx_export.rs
// 离线 DOCX 导出：轻量 zip 打包，遵循 OOXML 规范。
// 策略：生成最小合法 docx（[Content_Types].xml + _rels/.rels + word/document.xml），
// 正文图片以内联方式嵌入（base64 解码后写入 word/media/ + 关系声明）。

use std::collections::HashMap;
use std::io::Write;

use super::EpubChapter;
use crate::error::{AppError, AppResult};

/// 将整书章节导出为 DOCX，写到 `path`。
pub fn export_docx(
    title: String,
    description: Option<String>,
    chapters: Vec<EpubChapter>,
    path: String,
) -> AppResult<()> {
    let file = std::fs::File::create(&path)
        .map_err(|e| AppError::Internal(format!("create {path}: {e}")))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 预收集图片
    use image::GenericImageView;
    let mut img_cache: HashMap<String, (String, Vec<u8>, u32, u32)> = HashMap::new(); // rel → (ext, bytes, width, height)
    for ch in &chapters {
        for rel in extract_data_asset_refs(&ch.content) {
            if img_cache.contains_key(&rel) {
                continue;
            }
            if let Ok((ext, bytes)) = load_image_bytes(&rel) {
                let (w, h) = image::load_from_memory(&bytes)
                    .map(|img| img.dimensions())
                    .unwrap_or((0, 0));
                img_cache.insert(rel, (ext, bytes, w, h));
            }
        }
    }

    // 写入 [Content_Types].xml
    let mut overrides = String::new();
    overrides.push_str(r#"<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#);
    overrides.push_str(r#"<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#);
    for (i, (_rel, (ext, _, _, _))) in img_cache.iter().enumerate() {
        let ct = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            _ => "image/png",
        };
        overrides.push_str(&format!(
            r#"<Override PartName="/word/media/img{i}.{ext}" ContentType="{ct}"/>"#
        ));
    }
    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
{overrides}
</Types>"#
    );
    zip.start_file("[Content_Types].xml", options)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(content_types.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 写入 _rels/.rels
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
    zip.start_file("_rels/.rels", options)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(rels.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 写入图片到 word/media/
    let mut img_rel_ids: HashMap<String, String> = HashMap::new();
    for (i, (rel, (ext, bytes, _, _))) in img_cache.iter().enumerate() {
        let filename = format!("word/media/img{i}.{ext}");
        zip.start_file(&filename, options)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        zip.write_all(bytes)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        img_rel_ids.insert(rel.clone(), format!("imgRel{i}"));
    }

    // 构建 word/document.xml
    let mut doc_xml = String::new();
    doc_xml.push_str(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>"#,
    );

    // 书名作为标题
    doc_xml.push_str(&heading1_paragraph(&title));
    if let Some(desc) = &description {
        doc_xml.push_str(&paragraph(desc, &[]));
    }

    // 各章节
    let mut img_sizes: HashMap<String, (u32, u32)> = HashMap::new(); // rel → (w, h)
    for (rel, (_, _, w, h)) in &img_cache {
        img_sizes.insert(rel.clone(), (*w, *h));
    }
    for ch in &chapters {
        doc_xml.push_str(&heading2_paragraph(&ch.title));
        // 把 HTML 转成 DOCX 段落序列
        let segments = parse_html_to_segments(&ch.content, &img_rel_ids, &img_sizes);
        for seg in segments {
            match seg {
                DocxSegment::Paragraph(runs) => {
                    doc_xml.push_str(&runs_paragraph(&runs));
                }
                DocxSegment::Image(rel_id, w, h) => {
                    doc_xml.push_str(&image_paragraph(&rel_id, w, h));
                }
                DocxSegment::Table(rows) => {
                    doc_xml.push_str(&table_to_xml(&rows));
                }
            }
        }
    }

    // 文档末尾节属性
    doc_xml.push_str(r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#);
    doc_xml.push_str("</w:body></w:document>");

    // 写入 word/document.xml
    zip.start_file("word/document.xml", options)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(doc_xml.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 写入 word/styles.xml（定义 Heading1/Heading2/Normal，跨端稳定标题样式）
    const STYLES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="240"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="1F2430"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="312E81"/></w:rPr></w:style>
</w:styles>"#;
    zip.start_file("word/styles.xml", options)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(STYLES_XML.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 写入 word/_rels/document.xml.rels
    let mut doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#
        .to_string();
    for (i, (_rel, (ext, _, _, _))) in img_cache.iter().enumerate() {
        let rel_id = format!("imgRel{i}");
        let ct = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            _ => "image/png",
        };
        doc_rels.push_str(&format!(
            r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img{i}.{ext}"/>"#
        ));
    }
    doc_rels.push_str("</Relationships>");
    zip.start_file("word/_rels/document.xml.rels", options)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(doc_rels.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    zip.finish()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

// ─── HTML → DOCX 段落分段 ───

enum DocxSegment {
    Paragraph(Vec<DocxRun>),
    Image(String, u32, u32),       // rel_id, width_emu, height_emu
    Table(Vec<Vec<Vec<DocxRun>>>), // rows → cells → runs
}

#[derive(Clone)]
struct DocxRun {
    text: String,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    highlight: bool,
}

/// 极简 HTML 解析器：按段落/图片/表格切分。
fn parse_html_to_segments(
    html: &str,
    img_rel_ids: &HashMap<String, String>,
    img_sizes: &HashMap<String, (u32, u32)>,
) -> Vec<DocxSegment> {
    let mut segments: Vec<DocxSegment> = Vec::new();
    let mut cursor = html;

    while !cursor.is_empty() {
        // 找下一个块级标签
        let block_start = find_block_tag(cursor);
        if let Some((pos, tag_name)) = block_start {
            // 处理 tag 前的文本（如果有的话，作为独立段落）
            let before = &cursor[..pos];
            if !before.trim().is_empty() {
                let text = strip_html_tags(before);
                if !text.is_empty() {
                    segments.push(DocxSegment::Paragraph(vec![DocxRun {
                        text,
                        bold: false,
                        italic: false,
                        underline: false,
                        strike: false,
                        highlight: false,
                    }]));
                }
            }

            // 找到对应结束标签
            let end_tag = format!("</{tag_name}>");
            let after_tag = &cursor[pos..];
            if let Some(end_pos) = after_tag.find(&end_tag) {
                let inner = &after_tag[after_tag.find('>').unwrap_or(0) + 1..end_pos];
                match tag_name.as_str() {
                    "p" => {
                        // <p> 内纯 <img>（无文字）视为图片段，否则按普通段落
                        if let Some(img_seg) =
                            image_segment_from_html(inner, img_rel_ids, img_sizes)
                        {
                            segments.push(img_seg);
                        } else {
                            let runs = parse_inline_elements(inner);
                            segments.push(DocxSegment::Paragraph(runs));
                        }
                    }
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        let mut runs = parse_inline_elements(inner);
                        for r in &mut runs {
                            r.bold = true;
                        }
                        segments.push(DocxSegment::Paragraph(runs));
                    }
                    "blockquote" => {
                        let runs = parse_inline_elements(inner);
                        segments.push(DocxSegment::Paragraph(runs));
                    }
                    "ul" | "ol" => {
                        // 列表项：按 <li> 拆分
                        let items = split_list_items(inner);
                        for item in items {
                            let runs = parse_inline_elements(&item);
                            segments.push(DocxSegment::Paragraph(runs));
                        }
                    }
                    "img" => {
                        // 独立 <img> 标签（不带包裹）
                        if let Some(seg) =
                            image_segment_from_html(after_tag, img_rel_ids, img_sizes)
                        {
                            segments.push(seg);
                        }
                    }
                    "table" => {
                        // 表格：导出为真实 OOXML w:tbl 结构
                        let rows = parse_table_rows(inner);
                        if !rows.is_empty() {
                            segments.push(DocxSegment::Table(rows));
                        }
                    }
                    _ => {}
                }
                cursor = &after_tag[end_pos + end_tag.len()..];
            } else {
                // 未找到结束标签，把剩余作为文本
                let text = strip_html_tags(cursor);
                if !text.is_empty() {
                    segments.push(DocxSegment::Paragraph(vec![DocxRun {
                        text,
                        bold: false,
                        italic: false,
                        underline: false,
                        strike: false,
                        highlight: false,
                    }]));
                }
                break;
            }
        } else {
            // 没有更多块标签，剩余全部作为文本
            let text = strip_html_tags(cursor);
            if !text.is_empty() {
                segments.push(DocxSegment::Paragraph(vec![DocxRun {
                    text,
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                    highlight: false,
                }]));
            }
            break;
        }
    }

    segments
}

fn find_block_tag(html: &str) -> Option<(usize, String)> {
    let block_tags = [
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "ul",
        "ol",
        "img",
        "table",
    ];
    let mut earliest: Option<(usize, String)> = None;
    for tag in &block_tags {
        let open = format!("<{tag}");
        let open2 = format!("<{tag}>");
        if let Some(pos) = html.find(&open) {
            let cur = earliest.as_ref().map(|(p, _)| *p).unwrap_or(usize::MAX);
            if pos < cur {
                earliest = Some((pos, tag.to_string()));
            }
        } else if let Some(pos) = html.find(&open2) {
            let cur = earliest.as_ref().map(|(p, _)| *p).unwrap_or(usize::MAX);
            if pos < cur {
                earliest = Some((pos, tag.to_string()));
            }
        }
    }
    earliest
}

fn parse_inline_elements(html: &str) -> Vec<DocxRun> {
    let mut runs: Vec<DocxRun> = Vec::new();
    let mut current = DocxRun {
        text: String::new(),
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        highlight: false,
    };

    let mut in_tag = false;
    let mut tag_buf = String::new();
    let mut chars = html.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '<' {
            if !current.text.is_empty() {
                runs.push(current.clone());
                current.text.clear();
            }
            in_tag = true;
            tag_buf.clear();
            tag_buf.push(ch);
        } else if ch == '>' && in_tag {
            in_tag = false;
            tag_buf.push(ch);
            let tag = tag_buf.clone();

            if tag.starts_with("<b>") || tag.starts_with("<strong>") {
                current.bold = true;
            } else if tag.starts_with("</b>") || tag.starts_with("</strong>") {
                if !current.text.is_empty() {
                    runs.push(current.clone());
                    current.text.clear();
                }
                current.bold = false;
            } else if tag.starts_with("<i>") || tag.starts_with("<em>") {
                current.italic = true;
            } else if tag.starts_with("</i>") || tag.starts_with("</em>") {
                if !current.text.is_empty() {
                    runs.push(current.clone());
                    current.text.clear();
                }
                current.italic = false;
            } else if tag.starts_with("<u>") || tag.starts_with("<ins>") {
                current.underline = true;
            } else if tag.starts_with("</u>") || tag.starts_with("</ins>") {
                if !current.text.is_empty() {
                    runs.push(current.clone());
                    current.text.clear();
                }
                current.underline = false;
            } else if tag.starts_with("<s>")
                || tag.starts_with("<del>")
                || tag.starts_with("<strike>")
            {
                current.strike = true;
            } else if tag.starts_with("</s>")
                || tag.starts_with("</del>")
                || tag.starts_with("</strike>")
            {
                if !current.text.is_empty() {
                    runs.push(current.clone());
                    current.text.clear();
                }
                current.strike = false;
            } else if tag.starts_with("<mark>")
                || (tag.starts_with("<span") && tag.contains("background"))
            {
                current.highlight = true;
            } else if tag.starts_with("</mark>")
                || (tag.starts_with("</span") && tag.contains("background"))
            {
                if !current.text.is_empty() {
                    runs.push(current.clone());
                    current.text.clear();
                }
                current.highlight = false;
            } else if tag.starts_with("<br") {
                current.text.push('\n');
            }
            // 忽略其他标签（img、table、嵌套块标签等）
        } else if in_tag {
            tag_buf.push(ch);
        } else {
            current.text.push(ch);
        }
    }

    if !current.text.is_empty() {
        runs.push(current);
    }

    if runs.is_empty() {
        runs.push(DocxRun {
            text: String::new(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            highlight: false,
        });
    }

    runs
}

fn split_list_items(html: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut cursor = html;
    while let Some(start) = cursor.find("<li") {
        let after_li = &cursor[start..];
        let close_tag = ">";
        let close_pos = after_li.find(close_tag).unwrap_or(after_li.len()) + close_tag.len();
        let after_open = &after_li[close_pos..];
        let end_tag = "</li>";
        if let Some(end_pos) = after_open.find(end_tag) {
            let inner = &after_open[..end_pos];
            items.push(strip_html_tags(inner));
            cursor = &after_open[end_pos + end_tag.len()..];
        } else {
            break;
        }
    }
    if items.is_empty() {
        items.push(strip_html_tags(html));
    }
    items
}

/// 从 <table> 内部 HTML 解析为 行 → 单元格 → runs。
fn parse_table_rows(html: &str) -> Vec<Vec<Vec<DocxRun>>> {
    let mut rows = Vec::new();
    let mut cursor = html;
    while let Some(start) = cursor.find("<tr") {
        let after_tr = &cursor[start..];
        if let Some(end_pos) = after_tr.find("</tr>") {
            let inner = &after_tr[..end_pos];
            rows.push(parse_row_cells(inner));
            cursor = &after_tr[end_pos + "</tr>".len()..];
        } else {
            break;
        }
    }
    rows
}

/// 行内按 <td / <th 文档顺序提取各格 runs；表头格按 HTML 语义加粗。
fn parse_row_cells(row_html: &str) -> Vec<Vec<DocxRun>> {
    let mut cells: Vec<Vec<DocxRun>> = Vec::new();
    let mut cursor = row_html;
    while let Some((kind, content_start)) = find_cell_open(cursor) {
        let after_open = &cursor[content_start..];
        let end_tag = if kind == 'd' { "</td>" } else { "</th>" };
        if let Some(end_pos) = after_open.find(end_tag) {
            let mut runs = parse_inline_elements(&after_open[..end_pos]);
            if kind == 'h' {
                for r in &mut runs {
                    r.bold = true;
                }
            }
            cells.push(runs);
            cursor = &after_open[end_pos + end_tag.len()..];
        } else {
            break;
        }
    }
    cells
}

/// 定位下一个单元格开标签，返回 (单元格类型, 内容起始字节位置)；排除 thead/tbody/tfoot 误匹配。
fn find_cell_open(html: &str) -> Option<(char, usize)> {
    let bytes = html.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b != b'<' {
            continue;
        }
        if let Some(seg) = html.get(i..i + 3) {
            if seg == "<td" {
                let gt = html[i..].find('>')?;
                return Some(('d', i + gt + 1));
            }
            if seg == "<th"
                && !html[i + 3..].starts_with('e')
                && !html[i + 3..].starts_with('b')
                && !html[i + 3..].starts_with('f')
            {
                let gt = html[i..].find('>')?;
                return Some(('h', i + gt + 1));
            }
        }
    }
    None
}

/// 生成 OOXML <w:tbl>：细边框、自动列宽，单元格内为无缩进段落。
fn table_to_xml(rows: &[Vec<Vec<DocxRun>>]) -> String {
    const TBL_PR: &str = r#"<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="8A8F98"/><w:left w:val="single" w:sz="4" w:space="0" w:color="8A8F98"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="8A8F98"/><w:right w:val="single" w:sz="4" w:space="0" w:color="8A8F98"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="8A8F98"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="8A8F98"/></w:tblBorders></w:tblPr>"#;
    let mut xml = String::from("<w:tbl>");
    xml.push_str(TBL_PR);
    for row in rows {
        xml.push_str("<w:tr>");
        for cell in row {
            xml.push_str(r#"<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>"#);
            if cell.is_empty() {
                xml.push_str("<w:p><w:r><w:t></w:t></w:r></w:p>");
            } else {
                let runs_xml: String = cell.iter().map(run_to_xml).collect();
                xml.push_str(&format!("<w:p>{runs_xml}</w:p>"));
            }
            xml.push_str("</w:tc>");
        }
        xml.push_str("</w:tr>");
    }
    xml.push_str("</w:tbl>");
    xml
}

/// 从 HTML 片段提取纯图片段（无文字内容时）。
fn image_segment_from_html(
    html: &str,
    img_rel_ids: &HashMap<String, String>,
    img_sizes: &HashMap<String, (u32, u32)>,
) -> Option<DocxSegment> {
    let img_start = html.find("<img")?;
    let (rel, rel_id) = extract_img_rel(&html[img_start..], img_rel_ids)?;
    // 仅当 <img> 之外没有正文时视为图片段
    let text = strip_html_tags(html);
    if !text.trim().is_empty() {
        return None;
    }
    let (w, h) = img_sizes.get(&rel).copied().unwrap_or((0, 0));
    let (width_emu, height_emu) = image_emu_size(w, h);
    Some(DocxSegment::Image(rel_id, width_emu, height_emu))
}

/// 源图像素尺寸 → DOCX EMU：按 96 DPI 自然尺寸展示，宽度超过内容宽（与 PDF MAX_IMG_W=420pt 一致）时等比缩小，不放大小图。
fn image_emu_size(w: u32, h: u32) -> (u32, u32) {
    const MAX_IMG_W_EMU: u64 = 420 * 12_700; // 420pt ≈ 内容宽上限
    if w == 0 || h == 0 {
        return (4_000_000, 3_000_000); // 未知尺寸回退 4×3
    }
    let natural_w = u64::from(w) * 9525; // 96 DPI：1px = 9525 EMU
    let natural_h = u64::from(h) * 9525;
    let scale = (MAX_IMG_W_EMU as f64 / natural_w as f64).min(1.0);
    (
        (natural_w as f64 * scale).round() as u32,
        (natural_h as f64 * scale).round() as u32,
    )
}

fn extract_img_rel(html: &str, img_rel_ids: &HashMap<String, String>) -> Option<(String, String)> {
    // 从 <img ...> 标签提取 data-asset
    if let Some(start) = html.find("data-asset=\"") {
        let rest = &html[start + 12..];
        let end = rest.find('"').unwrap_or(rest.len());
        let rel = &rest[..end];
        img_rel_ids
            .get(rel)
            .map(|rel_id| (rel.to_string(), rel_id.clone()))
    } else {
        None
    }
}

fn strip_html_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            out.push(ch);
        }
    }
    out.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn heading1_paragraph(text: &str) -> String {
    let escaped = xml_escape(text);
    format!(
        r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{escaped}</w:t></w:r></w:p>"#
    )
}

fn heading2_paragraph(text: &str) -> String {
    let escaped = xml_escape(text);
    format!(
        r#"<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>{escaped}</w:t></w:r></w:p>"#
    )
}

fn paragraph(text: &str, runs: &[DocxRun]) -> String {
    // 中文出版惯例：正文段落首行缩进 2 字符（firstLineChars=200，Word 按字号自适应）
    const INDENT_PPR: &str = r#"<w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>"#;
    if runs.is_empty() {
        let escaped = xml_escape(text);
        format!(r#"<w:p>{INDENT_PPR}<w:r><w:t>{escaped}</w:t></w:r></w:p>"#)
    } else {
        let runs_xml: String = runs.iter().map(run_to_xml).collect();
        format!(r#"<w:p>{INDENT_PPR}{runs_xml}</w:p>"#)
    }
}

fn runs_paragraph(runs: &[DocxRun]) -> String {
    const INDENT_PPR: &str = r#"<w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>"#;
    if runs.is_empty() {
        return format!(r#"<w:p>{INDENT_PPR}<w:r><w:t></w:t></w:r></w:p>"#);
    }
    let runs_xml: String = runs.iter().map(run_to_xml).collect();
    format!(r#"<w:p>{INDENT_PPR}{runs_xml}</w:p>"#)
}

fn run_to_xml(run: &DocxRun) -> String {
    let mut props = String::new();
    if run.bold {
        props.push_str("<w:b/>");
    }
    if run.italic {
        props.push_str("<w:i/>");
    }
    if run.underline {
        props.push_str("<w:u w:val=\"single\"/>");
    }
    if run.strike {
        props.push_str("<w:strike/>");
    }
    if run.highlight {
        props.push_str("<w:highlight w:val=\"yellow\"/>");
    }
    let prop_str = if props.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{props}</w:rPr>")
    };
    let text = xml_escape(&run.text);
    // 如果文本包含前导/尾随空格，需要 w:t 带 xml:space="preserve"
    let space_attr = if text.starts_with(' ') || text.ends_with(' ') || text.contains("  ") {
        r#" xml:space="preserve""#
    } else {
        ""
    };
    format!("<w:r>{prop_str}<w:t{space_attr}>{text}</w:t></w:r>")
}

fn image_paragraph(rel_id: &str, width_emu: u32, height_emu: u32) -> String {
    format!(
        r#"<w:p>
<w:r>
<w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="{width_emu}" cy="{height_emu}"/>
<wp:effectExtent l="0" t="0" r="0" b="0"/>
<wp:docPr id="1" name="Picture"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr>
<pic:cNvPr id="0" name="Image.png"/>
<pic:cNvPicPr/>
</pic:nvPicPr>
<pic:blipFill>
<a:blip r:embed="{rel_id}"/>
<a:stretch>
<a:fillRect/>
</a:stretch>
</pic:blipFill>
<pic:spPr>
<a:xfrm>
<a:off x="0" y="0"/>
<a:ext cx="{width_emu}" cy="{height_emu}"/>
</a:xfrm>
<a:prstGeom prst="rect">
<a:avLst/>
</a:prstGeom>
</pic:spPr>
</pic:pic>
</a:graphicData>
</a:graphic>
</wp:inline>
</w:drawing>
</w:r>
</w:p>"#
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn extract_data_asset_refs(html: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut cursor = html;
    while let Some(start) = cursor.find("data-asset=\"") {
        let rest = &cursor[start + 12..];
        let end = rest.find('"').unwrap_or(rest.len());
        let rel = &rest[..end];
        if !rel.is_empty() {
            refs.push(rel.to_string());
        }
        cursor = &rest[end..];
    }
    refs
}

fn load_image_bytes(rel: &str) -> AppResult<(String, Vec<u8>)> {
    // 优先相对引用解析；失败时按字面路径直接读取（与 pdf_export 一致）。
    let abs = crate::commands::asset::resolve_asset_ref(rel.to_string())
        .or_else(|_| Ok::<String, String>(rel.to_string()))
        .map_err(|e| AppError::Internal(format!("resolve asset {rel}: {e}")))?;
    let bytes =
        std::fs::read(&abs).map_err(|e| AppError::Internal(format!("read image {abs}: {e}")))?;
    let ext = std::path::Path::new(&abs)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let ext = if ext == "jpg" {
        "jpeg".to_string()
    } else {
        ext
    };
    Ok((ext, bytes))
}
