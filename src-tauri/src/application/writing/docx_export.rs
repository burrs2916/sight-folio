// docx_export.rs
// 离线 DOCX 导出：轻量 zip 打包，遵循 OOXML 规范。
// 策略：生成最小合法 docx（[Content_Types].xml + _rels/.rels + word/document.xml），
// 正文图片以内联方式嵌入（base64 解码后写入 word/media/ + 关系声明）。

use std::collections::HashMap;
use std::io::Write;

use super::{has_tree_payload, EpubChapter};
use crate::error::{AppError, AppResult};

/// 将整书章节导出为 DOCX，写到 `path`。
pub fn export_docx(
    title: String,
    description: Option<String>,
    chapters: Vec<EpubChapter>,
    layout: super::layout::BookLayoutSpec,
    assets: super::FrozenAssets,
    meta: super::BookMeta,
    path: String,
) -> AppResult<()> {
    // R1：正文字号 / 行距 / 段距 / 首行缩进 / 字体全部来自作者设置（详见 layout.rs）。
    let styles_xml = STYLES_XML
        .replace(
            "<w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/>",
            &format!(
                "<w:sz w:val=\"{hp}\"/><w:szCs w:val=\"{hp}\"/>",
                hp = layout.docx_half_points()
            ),
        )
        .replace(
            "<w:spacing w:after=\"120\" w:line=\"360\" w:lineRule=\"auto\"/>",
            &format!(
                // 注意：`w:ind` 是 `w:pPr` 的子元素，**不能**塞进 `w:spacing .../>` 内部，
                // 那样产出的 OOXML 是坏的（Word 打不开）。集成测里断过这个位置。
                "<w:spacing w:after=\"{after}\" w:line=\"{line}\" w:lineRule=\"auto\"/>{first_line}",
                after = layout.docx_after_twip(),
                line = layout.docx_line(),
                first_line = if layout.indent {
                    "<w:ind w:firstLineChars=\"200\"/>"
                } else {
                    ""
                }
            ),
        );
    let styles_xml = match layout.first_family() {
        // OOXML 要具名字体，CSS 栈不能整串塞进去；取栈首那个具名字体，中英文各归一位
        Some(family) => styles_xml.replace(
            "<w:rFonts w:ascii=\"Times New Roman\" w:hAnsi=\"Times New Roman\" w:cs=\"Times New Roman\"/>",
            &format!(
                "<w:rFonts w:ascii=\"{f}\" w:hAnsi=\"{f}\" w:cs=\"{f}\" w:eastAsia=\"{f}\"/>",
                f = family
            ),
        ),
        None => styles_xml,
    };
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
            // R4：走统一读法（定格优先）。此前这里是 `if let Ok(..)` —— 读不到就**静默丢图**，
            // 产出一本「看起来成功、翻开少图」的 docx。缺图现在直接失败并点名文件。
            let (ext, bytes) = load_image_bytes(&rel, &assets)?;
            let (w, h) = image::load_from_memory(&bytes)
                .map(|img| img.dimensions())
                .unwrap_or((0, 0));
            img_cache.insert(rel, (ext, bytes, w, h));
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

    // ㉱ E-A′（2026-11-11）：段落级首行缩进**跟着版式开关走**。旧实现在每个正文段
    // 硬编码 firstLineChars=200/480 —— 它会盖掉 styles.xml 里按语种×体裁裁出的默认
    // （诗集/西文书在咽喉处已撤缩进，段落级却不领情），F4 在 DOCX 只接通了样式层这一半。
    // 中文小说：`layout.indent = true`，本串与旧常量逐字相同（产物零回归）。
    let body_ppr = if layout.indent {
        r#"<w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>"#
    } else {
        ""
    };

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
    // 署名行（作者 ｜ 出版社）：与 PDF/HTML 同一份判据 `byline_of`，两项都没录就整行不出
    let byline = super::byline_of(&meta);
    if !byline.is_empty() {
        doc_xml.push_str(&format!(
            "<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>",
            xml_escape(&byline)
        ));
    }
    if let Some(desc) = &description {
        doc_xml.push_str(&paragraph(desc, &[], body_ppr));
    }

    // 各章节
    let mut img_sizes: HashMap<String, (u32, u32)> = HashMap::new(); // rel → (w, h)
    for (rel, (_, _, w, h)) in &img_cache {
        img_sizes.insert(rel.clone(), (*w, *h));
    }
    // 层级口径（与 EPUB/PDF 同一个判据）：结构书的卷走 Heading2、章走 Heading3、
    // 节走 Heading4（outlineLvl 1/2/3），Word 导航窗格据此成树；
    // 遗留口径（旧调用方只给 volume 字符串）恒为 Heading2 —— 输出与改动前逐字节一致。
    let tree = has_tree_payload(&chapters);
    for ch in &chapters {
        let level = if tree {
            (2 + ch.depth.unwrap_or(0)).min(4)
        } else {
            2
        };
        doc_xml.push_str(&heading_paragraph(&ch.title, level));
        // 把 HTML 转成 DOCX 段落序列
        let segments = parse_html_to_segments(&ch.content, &img_rel_ids, &img_sizes);
        for seg in segments {
            match seg {
                DocxSegment::Paragraph(runs) => {
                    doc_xml.push_str(&runs_paragraph(&runs, body_ppr));
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

    // 写入 word/styles.xml（Normal + Heading1..Heading4，跨端稳定标题样式）
    //
    // 为什么必须有 Heading3/4：结构书导出的层级是 Heading1=书名 / Heading2=卷 /
    // Heading3=章 / Heading4=节（outlineLvl 0..3）。只定义到 Heading2 时，卷和章会挤在
    // 同一级，Word 导航窗格就是一盘平铺 —— 正是「卷章对应不起来」在 DOCX 上的表现。
    const STYLES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="240"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="1F2430"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="312E81"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="140"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="1F2430"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="3C4254"/></w:rPr></w:style>
</w:styles>"#;
    zip.start_file("word/styles.xml", options)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(styles_xml.as_bytes())
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
    // 【E-F · 轮 54】两条同形状的漏口在这一支一起收：
    // ① `<br>` 以前连同标签名被整只丢掉 ⇒ 段回退（288/357/372）与列表项（543/550）这两条
    //    吃 strip 的路径，作者的分行无声消失 ⇒ 脱签前先看标签名，是 `br` 就留 `\n` 痕；
    // ② 源码里**裸写**的换行原样留着 ⇒ 会被下游新的「`\n` = 硬换行」判据误认成真分行。
    //    按 HTML 口径折成空格。`\n` 这个记号从本轮起只归 `<br>` 所有。
    let mut out = String::new();
    let mut in_tag = false;
    let mut tag = String::new();
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            tag.clear();
        } else if ch == '>' {
            in_tag = false;
            if is_br_tag_name(&tag) {
                out.push('\n');
            }
        } else if in_tag {
            tag.push(ch);
        } else {
            out.push(match ch {
                '\n' | '\r' | '\t' => ' ',
                c => c,
            });
        }
    }
    out.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// 标签内文是否为 `br`（吃 `<br>` / `<br/>` / `<br />` / `</br>` 各种形状）。
/// 从略大小写；别的标签一律返回 false，调用方只关心硬换行。
fn is_br_tag_name(tag_inner: &str) -> bool {
    let t = tag_inner.trim().trim_start_matches('/');
    let name: String = t
        .chars()
        .take_while(|c| !c.is_whitespace() && *c != '/')
        .collect();
    name.eq_ignore_ascii_case("br")
}

/// 标题段唯一出口：级别 1..4 对应 styles.xml 里定义好的 Heading1..Heading4（越界钳到 4）。
///
/// 为什么要收成一个函数：原来只有 heading1/2 两个各写一份 XML 的函数，第三、四级
/// 无处可去，卷和章只好挤在同一级 —— 层级就是在这里丢的。
fn heading_paragraph(text: &str, level: usize) -> String {
    let style = match level {
        1 => "Heading1",
        2 => "Heading2",
        3 => "Heading3",
        _ => "Heading4",
    };
    let escaped = xml_escape(text);
    format!(
        r#"<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>{escaped}</w:t></w:r></w:p>"#
    )
}

fn heading1_paragraph(text: &str) -> String {
    heading_paragraph(text, 1)
}

#[allow(dead_code)]
fn heading2_paragraph(text: &str) -> String {
    heading_paragraph(text, 2)
}

/// `body_ppr`：正文段的 pPr（缩进与否由调用方按 `BookLayoutSpec` 裁，㉱ E-A′）。
/// 中文小说拿到的串与旧常量逐字相同 —— 产物零回归；撤缩进的书得到空串（段落不再声明缩进）。
fn paragraph(text: &str, runs: &[DocxRun], body_ppr: &str) -> String {
    if runs.is_empty() {
        // 【E-F · 轮 54】这条回退分支（简介/无 inline 内容的段）与 `run_to_xml` 有同一个漏口，
        // 一起收掉。无 `\n` 时**保持改前那个串逐字节不变** —— 简介行在零回归口径覆盖的面上
        // （`r54丙` 钉住），所以这里只在真出现硬换行时才走新路径，不顺手改 `xml:space` 判据。
        let body = if text.contains('\n') {
            text_to_run_children(text)
        } else {
            format!("<w:t>{}</w:t>", xml_escape(text))
        };
        format!(r#"<w:p>{body_ppr}<w:r>{body}</w:r></w:p>"#)
    } else {
        let runs_xml: String = runs.iter().map(run_to_xml).collect();
        format!(r#"<w:p>{body_ppr}{runs_xml}</w:p>"#)
    }
}

fn runs_paragraph(runs: &[DocxRun], body_ppr: &str) -> String {
    if runs.is_empty() {
        return format!(r#"<w:p>{body_ppr}<w:r><w:t></w:t></w:r></w:p>"#);
    }
    let runs_xml: String = runs.iter().map(run_to_xml).collect();
    format!(r#"<w:p>{body_ppr}{runs_xml}</w:p>"#)
}

/// 【E-F · 轮 54】把 run 文本写成 `w:t` 序列，其中的 `\n`（= 作者的 `<br>` 硬换行）
/// 落成 OOXML 的 `<w:br/>`。
///
/// 改前 `run_to_xml` 把 `\n` 原样塞进 `<w:t>`：OOXML 里换行不是换行，Word 打开退化成
/// 一个空格 ⇒ 12 行诗的 DOCX 是一整段，且全仓零 `<w:br/>`（台账 E-F / 旧导出报告 P0-1 E-2）。
///
/// **零回归口径**（`r54乙` 钉）：无 `\n` 时输出与改前**逐字节相同**，包括 `xml:space`
/// 那条判据仍然吃**转义后**的串这一细节。
fn text_to_run_children(text: &str) -> String {
    let mut out = String::new();
    for (i, seg) in text.split('\n').enumerate() {
        if i > 0 {
            out.push_str("<w:br/>");
        }
        let escaped = xml_escape(seg);
        // 如果文本包含前导/尾随空格，需要 w:t 带 xml:space="preserve"
        let space_attr =
            if escaped.starts_with(' ') || escaped.ends_with(' ') || escaped.contains("  ") {
                r#" xml:space="preserve""#
            } else {
                ""
            };
        out.push_str(&format!("<w:t{space_attr}>{escaped}</w:t>"));
    }
    out
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
    format!("<w:r>{prop_str}{}</w:r>", text_to_run_children(&run.text))
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

fn load_image_bytes(rel: &str, frozen: &super::FrozenAssets) -> AppResult<(String, Vec<u8>)> {
    // 定格优先、活盘兜底、缺图点名 —— 与 EPUB/PDF 同一个函数，口径不许分叉
    let (bytes, media) = super::read_asset_bytes(rel, Some(frozen))?;
    // 扩展名以定格记的 media_type 为准（那才是真字节的类型），猜不出来才退回按引用名猜
    let ext = match media.rsplit('/').next() {
        Some(sub) if sub != "octet-stream" => sub.to_ascii_lowercase(),
        _ => std::path::Path::new(rel)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_ascii_lowercase(),
    };
    let ext = if ext == "jpg" {
        "jpeg".to_string()
    } else {
        ext
    };
    Ok((ext, bytes))
}

// ─── 测试 · E-F（轮 54 新建：本文件此前零 test mod，DOCX 这支从来没有护栏）───

#[cfg(test)]
mod tests {
    use super::*;

    fn plain_run(text: &str) -> DocxRun {
        DocxRun {
            text: text.to_string(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            highlight: false,
        }
    }

    /// 12 行诗走完整链路（HTML → runs → OOXML）：必须出 11 枚 `<w:br/>`，且零残留 `\n`。
    /// 改前 `run_to_xml` 把 `\n` 原样塞进 `<w:t>` ⇒ OOXML 里退化成空格、全仓零 `<w:br/>`。
    #[test]
    fn r54甲_十二行诗docx必须出十一枚wbr() {
        let html = format!("<p>{}</p>", poem_lines("<br>"));
        let xml: String = parse_inline_elements(&html)
            .iter()
            .map(run_to_xml)
            .collect();
        assert_eq!(xml.matches("<w:br/>").count(), 11, "{xml}");
        assert!(!xml.contains('\n'), "`\\n` 不许残留在 OOXML 里：{xml}");
    }

    /// **零回归金样（改前就必须为绿）**：无 `\n` 的 run 逐字节不变，含 `xml:space` 那条判据
    /// （判据吃的是**转义后**的串 —— 与改前一致，不许顺手换成转义前）。
    #[test]
    fn r54乙_无硬换行的run逐字节不变() {
        assert_eq!(
            run_to_xml(&plain_run("普通句子。")),
            "<w:r><w:t>普通句子。</w:t></w:r>"
        );
        assert_eq!(
            run_to_xml(&plain_run(" 前导空格")),
            "<w:r><w:t xml:space=\"preserve\"> 前导空格</w:t></w:r>"
        );
        assert_eq!(
            run_to_xml(&plain_run("A & B <c>")),
            "<w:r><w:t>A &amp; B &lt;c&gt;</w:t></w:r>"
        );
        let mut bold = plain_run("重点");
        bold.bold = true;
        assert_eq!(
            run_to_xml(&bold),
            "<w:r><w:rPr><w:b/></w:rPr><w:t>重点</w:t></w:r>"
        );
    }

    /// `paragraph()` 的空 runs 回退分支（简介行走这里）是同一个漏口的第二张嘴。
    /// 无 `\n` 时它必须逐字节维持旧串 —— 简介行在零回归口径覆盖的面上。
    #[test]
    fn r54丙_paragraph空runs回退也必须认硬换行() {
        assert_eq!(
            paragraph("第一行\n第二行", &[], "")
                .matches("<w:br/>")
                .count(),
            1
        );
        assert_eq!(
            paragraph("一句简介", &[], ""),
            "<w:p><w:r><w:t>一句简介</w:t></w:r></w:p>"
        );
    }

    /// `strip_html_tags`（段回退 288/357/372、列表项 543/550 都吃它）以前把 `<br>` 连同
    /// 标签名一起丢；裸换行则相反 —— 它原样留着，会被下一轮新加的 `<w:br/>` 判据误认成真分行。
    #[test]
    fn r54丁_strip标签必须给br留痕而不留裸换行() {
        assert_eq!(strip_html_tags("甲<br>乙"), "甲\n乙");
        assert!(!strip_html_tags("甲<br>乙").contains("<br"));
        assert!(
            !strip_html_tags("甲\n  乙").contains('\n'),
            "裸换行是排版空白，不是分行"
        );
    }

    fn poem_lines(sep: &str) -> String {
        (1..=12)
            .map(|i| format!("第{i}行"))
            .collect::<Vec<String>>()
            .join(sep)
    }
}
