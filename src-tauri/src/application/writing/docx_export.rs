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
    let mut img_cache: HashMap<String, (String, Vec<u8>)> = HashMap::new(); // rel → (ext, bytes)
    for ch in &chapters {
        for rel in extract_data_asset_refs(&ch.content) {
            if img_cache.contains_key(&rel) {
                continue;
            }
            if let Ok((ext, bytes)) = load_image_bytes(&rel) {
                img_cache.insert(rel, (ext, bytes));
            }
        }
    }

    // 写入 [Content_Types].xml
    let mut overrides = String::new();
    overrides.push_str(r#"<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#);
    for (i, (_rel, (ext, _))) in img_cache.iter().enumerate() {
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
    for (i, (rel, (ext, bytes))) in img_cache.iter().enumerate() {
        let filename = format!("word/media/img{i}.{ext}");
        zip.start_file(&filename, options)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        zip.write_all(bytes)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        img_rel_ids.insert(rel.clone(), format!("imgRel{i}"));
    }

    // 构建 word/document.xml
    let mut doc_xml = String::new();
    doc_xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>"#);

    // 书名作为标题
    doc_xml.push_str(&heading1_paragraph(&title));
    if let Some(desc) = &description {
        doc_xml.push_str(&paragraph(desc, &[]));
    }

    // 各章节
    for ch in &chapters {
        doc_xml.push_str(&heading2_paragraph(&ch.title));
        // 把 HTML 转成 DOCX 段落序列
        let segments = parse_html_to_segments(&ch.content, &img_rel_ids);
        for seg in segments {
            match seg {
                DocxSegment::Paragraph(runs) => {
                    doc_xml.push_str(&runs_paragraph(&runs));
                }
                DocxSegment::Image(rel_id, w, h) => {
                    doc_xml.push_str(&image_paragraph(&rel_id, w, h));
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

    // 写入 word/_rels/document.xml.rels
    let mut doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#.to_string();
    for (i, (rel, (ext, _))) in img_cache.iter().enumerate() {
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

    zip.finish().map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

// ─── HTML → DOCX 段落分段 ───

enum DocxSegment {
    Paragraph(Vec<DocxRun>),
    Image(String, u32, u32), // rel_id, width_emu, height_emu
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
fn parse_html_to_segments(html: &str, img_rel_ids: &HashMap<String, String>) -> Vec<DocxSegment> {
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
                        let runs = parse_inline_elements(inner);
                        segments.push(DocxSegment::Paragraph(runs));
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
                        if let Some(rel_id) = extract_img_rel(after_tag, img_rel_ids) {
                            segments.push(DocxSegment::Image(rel_id, 4000000, 3000000)); // 默认 4×3 EMU
                        }
                    }
                    "table" => {
                        // 表格：简化处理，每行作为一个段落
                        let rows = extract_table_text_rows(inner);
                        for row_text in rows {
                            segments.push(DocxSegment::Paragraph(vec![DocxRun {
                                text: row_text,
                                bold: false,
                                italic: false,
                                underline: false,
                                strike: false,
                                highlight: false,
                            }]));
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
    let block_tags = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "img", "table"];
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
            } else if tag.starts_with("<s>") || tag.starts_with("<del>") || tag.starts_with("<strike>") {
                current.strike = true;
            } else if tag.starts_with("</s>") || tag.starts_with("</del>") || tag.starts_with("</strike>") {
                if !current.text.is_empty() {
                    runs.push(current.clone());
                    current.text.clear();
                }
                current.strike = false;
            } else if tag.starts_with("<mark>") || (tag.starts_with("<span") && tag.contains("background")) {
                current.highlight = true;
            } else if tag.starts_with("</mark>") || (tag.starts_with("</span") && tag.contains("background")) {
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

fn extract_table_text_rows(html: &str) -> Vec<String> {
    let mut rows = Vec::new();
    let mut cursor = html;
    while let Some(start) = cursor.find("<tr") {
        let after_tr = &cursor[start..];
        let end_tag = "</tr>";
        if let Some(end_pos) = after_tr.find(end_tag) {
            let inner = &after_tr[..end_pos + end_tag.len()];
            let cells = extract_cells_text(inner);
            rows.push(cells.join(" | "));
            cursor = &after_tr[end_pos + end_tag.len()..];
        } else {
            break;
        }
    }
    if rows.is_empty() {
        rows.push(strip_html_tags(html));
    }
    rows
}

fn extract_cells_text(row_html: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut cursor = row_html;
    for tag in ["<td", "<th"] {
        let mut sub = cursor;
        while let Some(start) = sub.find(tag) {
            let after = &sub[start..];
            let close_pos = after.find(">").unwrap_or(after.len()) + 1;
            let after_open = &after[close_pos..];
            let end = if tag == "<td" { "</td>" } else { "</th>" };
            if let Some(end_pos) = after_open.find(end) {
                cells.push(strip_html_tags(&after_open[..end_pos]));
                sub = &after_open[end_pos + end.len()..];
            } else {
                break;
            }
        }
    }
    cells
}

fn extract_img_rel(html: &str, img_rel_ids: &HashMap<String, String>) -> Option<String> {
    // 从 <img ...> 标签提取 data-asset
    if let Some(start) = html.find("data-asset=\"") {
        let rest = &html[start + 12..];
        let end = rest.find('"').unwrap_or(rest.len());
        let rel = &rest[..end];
        img_rel_ids.get(rel).cloned()
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
    if runs.is_empty() {
        let escaped = xml_escape(text);
        format!(r#"<w:p><w:r><w:t>{escaped}</w:t></w:r></w:p>"#)
    } else {
        let runs_xml: String = runs.iter().map(run_to_xml).collect();
        format!(r#"<w:p>{runs_xml}</w:p>"#)
    }
}

fn runs_paragraph(runs: &[DocxRun]) -> String {
    if runs.is_empty() {
        return r#"<w:p><w:r><w:t></w:t></w:r></w:p>"#.to_string();
    }
    let runs_xml: String = runs.iter().map(run_to_xml).collect();
    format!(r#"<w:p>{runs_xml}</w:p>"#)
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
    let bytes = std::fs::read(&abs)
        .map_err(|e| AppError::Internal(format!("read image {abs}: {e}")))?;
    let ext = std::path::Path::new(&abs)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let ext = if ext == "jpg" { "jpeg".to_string() } else { ext };
    Ok((ext, bytes))
}
