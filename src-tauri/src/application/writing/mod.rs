//! 写作域应用服务层（T4 领域下沉）。
//!
//! 职责：承载写作域的中重逻辑——EPUB 导出、全书扫描（分析器融合）、
//! 作品导入、DOCX/PDF 导出、全书备份恢复。commands/writing.rs 只保留
//! `#[tauri::command]` 薄壳透传，前端命令名与签名不变（零感知迁移）。
//!
//! 分层对齐：application/auth、application/icons 的既有模式。

pub mod docx_export;
pub mod pdf_export;

use crate::domain::analysis::Analysis;
use crate::domain::project_files::ProjectFile;
use crate::domain::review_findings::ReviewFinding;
use crate::domain::writing::{
    WritingBook, WritingChapter, WritingChapterSnapshot,
};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::analysis_repository::{AnalysisRepository, SqliteAnalysisRepository};
use crate::infrastructure::database::project_file_repository::{ProjectFileRepository, SqliteProjectFileRepository};
use crate::infrastructure::database::review_finding_repository::{ReviewFindingRepository, SqliteReviewFindingRepository};
use crate::infrastructure::database::writing_repository::{WritingRepository, SqliteWritingRepository};

use std::sync::Arc;

/// 每章保留的快照上限（切章自动存 + 手动存共用该上限；裁剪在仓储层落地）。
pub const SNAPSHOT_KEEP_PER_CHAPTER: i64 = 20;

/// 保存章节快照（由仓储按上限裁剪最旧）。
pub fn save_chapter_snapshot(
    snapshot: &WritingChapterSnapshot,
    repo: &Arc<SqliteWritingRepository>,
) -> AppResult<()> {
    repo.save_chapter_snapshot(snapshot, SNAPSHOT_KEEP_PER_CHAPTER)
}

/// 列出章节快照（同样带上限约束，与写入口径一致）。
pub fn list_chapter_snapshots(
    chapter_id: &str,
    repo: &Arc<SqliteWritingRepository>,
) -> AppResult<Vec<WritingChapterSnapshot>> {
    repo.list_chapter_snapshots(chapter_id, SNAPSHOT_KEEP_PER_CHAPTER)
}

// ─── EPUB 导出（原 commands/writing.rs L301-666） ───────────────────────

/// EPUB 章节载荷：前端把当前书的章节（标题 + TipTap HTML）传上来，
/// 后端只负责打包写盘——不在 Rust 侧重复查询与排序逻辑。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubChapter {
    pub title: String,
    /// 章节正文（TipTap HTML，插画以 `<img data-asset="...">` 单一事实源存相对引用）。
    pub content: String,
    /// 章头图（批次 2）：相对引用 `assets/writing/illustrations/<name>`，无则 None。
    /// 创作者主权：有/无等价合法，导出时仅当存在才接入。
    #[serde(default)]
    pub cover: Option<String>,
}

/// XML 转义（属性/文本两用，最保守的五个实体）。
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// 图片扩展名 → EPUB manifest media-type（默认 image/png）。
fn image_media_type(path: &str) -> &'static str {
    match path.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "image/png",
    }
}

/// 取标签里某个双引号属性的取值，例如 `data-asset="a/b.png"` → `a/b.png`。
fn attr_quoted_value(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let idx = tag.find(&needle)?;
    let after = idx + needle.len();
    let rest = &tag[after..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// 从一段 HTML 里提取所有 `data-asset="..."` 的相对引用（插画单一事实源）。
/// 只扫 `<img ...>` 标签，不依赖外部解析库，符合本仓库受控的 TipTap 输出。
fn extract_data_asset_refs(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = 0;
    while let Some(pos) = html[start..].find("<img") {
        let tag_start = start + pos;
        let tag_end = match html[tag_start..].find('>') {
            Some(i) => tag_start + i,
            None => break,
        };
        let tag = &html[tag_start..=tag_end];
        if let Some(val) = attr_quoted_value(tag, "data-asset") {
            out.push(val);
        }
        start = tag_end + 1;
    }
    out
}

/// 把 `<img ...>` 的 src 重写到 EPUB 内相对路径，并确保自闭合（XHTML 兼容）。
/// 仅当标签带 `data-asset` 且能在映射里命中时才改；否则原样保留（兼容外链图）。
fn rewrite_img_to_epub(html: &str, rel_to_href: &std::collections::HashMap<String, String>) -> String {
    let mut out = String::with_capacity(html.len());
    let mut start = 0;
    while let Some(pos) = html[start..].find("<img") {
        let tag_start = start + pos;
        let tag_end = match html[tag_start..].find('>') {
            Some(i) => tag_start + i,
            None => break,
        };
        let tag = &html[tag_start..=tag_end];
        out.push_str(&html[start..tag_start]);
        if let Some(rel) = attr_quoted_value(tag, "data-asset") {
            if let Some(href) = rel_to_href.get(&rel) {
                out.push_str(&set_img_src(tag, href));
            } else {
                out.push_str(tag);
            }
        } else {
            out.push_str(tag);
        }
        start = tag_end + 1;
    }
    out.push_str(&html[start..]);
    out
}

/// 把 `src="..."` 替换为 `src="href"`，并确保标签以 `/>` 结尾（XHTML 自闭合）。
fn set_img_src(tag: &str, href: &str) -> String {
    let needle = "src=\"";
    let mut s = if let Some(idx) = tag.find(needle) {
        let after = idx + needle.len();
        let rest = &tag[after..];
        match rest.find('"') {
            Some(end) => {
                let before = &tag[..idx];
                let after_quote = &rest[end + 1..];
                format!("{before}src=\"{href}\"{after_quote}")
            }
            None => tag.to_string(),
        }
    } else {
        tag.to_string()
    };
    if !s.ends_with("/>") {
        if let Some(strip) = s.strip_suffix('>') {
            s = format!("{strip}/>");
        }
    }
    s
}

/// 把 `<tag ...>`（未自闭合）改成 `<tag .../>`；已自闭合则原样（XHTML 兼容）。
fn self_close_void(html: &str, tag: &str) -> String {
    let open = format!("<{}", tag);
    let exact = format!("<{}>", tag);
    let mut out = String::with_capacity(html.len());
    let mut start = 0;
    while let Some(pos) = html[start..].find(&open) {
        let tag_start = start + pos;
        let tag_end = match html[tag_start..].find('>') {
            Some(i) => tag_start + i,
            None => break,
        };
        let snippet = &html[tag_start..=tag_end];
        out.push_str(&html[start..tag_start]);
        if snippet.ends_with("/>") || snippet.ends_with(" />") {
            out.push_str(snippet);
        } else if snippet.starts_with(&format!("<{} ", tag)) || snippet == exact {
            let inner = &snippet[..snippet.len() - 1];
            out.push_str(inner);
            out.push_str("/>");
        } else {
            out.push_str(snippet);
        }
        start = tag_end + 1;
    }
    out.push_str(&html[start..]);
    out
}

/// TipTap HTML → 严格 XHTML 可嵌入内容：
/// - `&nbsp;` 等命名实体不是预定义 XML 实体，严格的 EPUB 阅读器会拒开，改数字引用；
/// - void 元素（br / hr / img）自闭合，否则 EPUBCheck 会报 XML 良构错误。
fn html_to_xhtml(html: &str) -> String {
    let mut s = html.replace("&nbsp;", "&#160;");
    s = self_close_void(&s, "br");
    s = self_close_void(&s, "hr");
    s = self_close_void(&s, "img");
    s
}

/// 收集一个插画相对引用：解析磁盘绝对路径、读字节、去重、决定 EPUB 内路径。
/// 结果写入 `img_entries`（写盘用）与 `rel_to_href`（正文 src 改写用）。
fn collect_asset(
    rel: &str,
    rel_to_href: &mut std::collections::HashMap<String, String>,
    img_entries: &mut Vec<(String, Vec<u8>, String)>,
    used_names: &mut std::collections::HashMap<String, String>,
) -> AppResult<()> {
    if rel_to_href.contains_key(rel) {
        return Ok(()); // 同一张图在多处引用，只打包一次
    }
    // 与 DOCX/PDF 导出一致：相对引用优先经 resolve_asset_ref 解析到应用数据目录；
    // 解析失败（如外部绝对路径 / URL 风格引用）则按字面路径直接读取。
    let abs = crate::commands::asset::resolve_asset_ref(rel.to_string())
        .or_else(|_| Ok::<String, String>(rel.to_string()))
        .map_err(|e| AppError::Internal(format!("resolve asset {rel}: {e}")))?;
    let bytes = std::fs::read(&abs)
        .map_err(|e| AppError::Internal(format!("read asset {abs}: {e}")))?;
    let base = std::path::Path::new(rel)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "image.bin".to_string());
    let mut name = base.clone();
    let mut n = 1;
    while used_names.contains_key(&name) {
        n += 1;
        match base.rfind('.') {
            Some(d) => {
                let (stem, ext) = base.split_at(d);
                name = format!("{}_{}{}", stem, n, ext);
            }
            None => name = format!("{}_{}", base, n),
        }
    }
    used_names.insert(name.clone(), rel.to_string());
    let href = format!("images/{}", name);
    let media = image_media_type(&abs).to_string();
    img_entries.push((href.clone(), bytes, media));
    rel_to_href.insert(rel.to_string(), href);
    Ok(())
}

/// 生成 EPUB 3 并写到用户选定路径。
///
/// 结构：mimetype（STORED 首条目，规范要求不压缩）→ META-INF/container.xml
/// → OEBPS/content.opf（元数据 + manifest + spine）→ OEBPS/nav.xhtml（EPUB3 目录）
/// → OEBPS/images/*（插画 + 章头图）→ OEBPS/chapter_N.xhtml。
///
/// 图片接入（批次 3）：正文 `<img data-asset="相对引用">` 与章头图 `cover`
/// 都经 `resolve_asset_ref` 解析绝对路径 → 读字节写入 OEBPS/images/，正文 src
/// 改写为 EPUB 内相对路径；章头图作为章节首图前置到该章 `<body>`。无图章节不受影响。
pub fn export_epub(
    title: String,
    description: Option<String>,
    chapters: Vec<EpubChapter>,
    path: String,
) -> AppResult<()> {
    use std::collections::HashMap;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // 1. 预扫描整书所有插画引用（正文 <img data-asset> + 章头图 cover），去重收集。
    let mut rel_to_href: HashMap<String, String> = HashMap::new();
    let mut img_entries: Vec<(String, Vec<u8>, String)> = Vec::new();
    let mut used_names: HashMap<String, String> = HashMap::new();
    for ch in &chapters {
        if let Some(cover) = &ch.cover {
            if !cover.is_empty() {
                collect_asset(cover, &mut rel_to_href, &mut img_entries, &mut used_names)?;
            }
        }
        for rel in extract_data_asset_refs(&ch.content) {
            collect_asset(&rel, &mut rel_to_href, &mut img_entries, &mut used_names)?;
        }
    }

    let file = std::fs::File::create(&path)
        .map_err(|e| AppError::Internal(format!("create {path}: {e}")))?;
    let mut zip = ZipWriter::new(file);
    let stored = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let esc_title = xml_escape(&title);
    let uuid = uuid::Uuid::new_v4();
    let lang = "zh";

    // 2. mimetype（必须首条目且 STORED）
    zip.start_file("mimetype", stored)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(b"application/epub+zip")
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 3. container.xml
    let container = r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;
    zip.start_file("META-INF/container.xml", deflated)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(container.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 4. 插画写入 OEBPS/images/（在 opf 之前，顺序无关，mimetype 已占首条目）
    for (href, bytes, _media) in &img_entries {
        zip.start_file(format!("OEBPS/{}", href), deflated)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        zip.write_all(bytes)
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // 5. content.opf（manifest = nav + 各章 + 各图）
    let mut manifest = String::from(
        r#"    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
    );
    let mut spine = String::new();
    for (i, _ch) in chapters.iter().enumerate() {
        let id = format!("chap_{i}");
        let href = format!("chapter_{i}.xhtml");
        manifest.push_str(&format!(
            "\n    <item id=\"{id}\" href=\"{href}\" media-type=\"application/xhtml+xml\"/>"
        ));
        spine.push_str(&format!("\n    <itemref idref=\"{id}\"/>"));
    }
    for (k, (href, _bytes, media)) in img_entries.iter().enumerate() {
        let id = format!("img_{k}");
        manifest.push_str(&format!(
            "\n    <item id=\"{id}\" href=\"{href}\" media-type=\"{media}\"/>"
        ));
    }
    let desc = description
        .as_deref()
        .map(xml_escape)
        .unwrap_or_default();
    let opf = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:{uuid}</dc:identifier>
    <dc:title>{esc_title}</dc:title>
    <dc:language>{lang}</dc:language>
    {desc_tag}
  </metadata>
  <manifest>
{manifest}
  </manifest>
  <spine>{spine}
  </spine>
</package>"#,
        desc_tag = if desc.is_empty() {
            String::new()
        } else {
            format!("<dc:description>{desc}</dc:description>")
        },
    );
    zip.start_file("OEBPS/content.opf", deflated)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(opf.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 6. nav.xhtml（EPUB3 目录）
    let mut nav_lis = String::new();
    for (i, ch) in chapters.iter().enumerate() {
        nav_lis.push_str(&format!(
            "\n      <li><a href=\"chapter_{i}.xhtml\">{}</a></li>",
            xml_escape(&ch.title)
        ));
    }
    let nav = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>{esc_title}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>{esc_title}</h1>
    <ol>{nav_lis}
    </ol>
  </nav>
</body>
</html>"#
    );
    zip.start_file("OEBPS/nav.xhtml", deflated)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(nav.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 7. 各章 xhtml（正文 src 改写 + 章头图前置）
    for (i, ch) in chapters.iter().enumerate() {
        let rewritten = rewrite_img_to_epub(&ch.content, &rel_to_href);
        let body = html_to_xhtml(&rewritten);
        let cover_img = match &ch.cover {
            Some(c) if !c.is_empty() => rel_to_href
                .get(c)
                .map(|href| format!("<div class=\"chapter-cover\"><img alt=\"cover\" src=\"{href}\"/></div>\n")),
            _ => None,
        };
        let xhtml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>{}</title></head>
<body>
{}{}
</body>
</html>"#,
            xml_escape(&ch.title),
            cover_img.unwrap_or_default(),
            body
        );
        zip.start_file(format!("OEBPS/chapter_{i}.xhtml"), deflated)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        zip.write_all(xhtml.as_bytes())
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    zip.finish()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod epub_tests {
    use super::*;

    #[test]
    fn extract_data_asset_refs_finds_relative_refs_only() {
        let html = r#"<p>text</p><img src="asset://x" data-asset="assets/writing/illustrations/a.png" alt="a"/><img src="https://e.com/b.jpg"/>"#;
        let refs = extract_data_asset_refs(html);
        assert_eq!(refs, vec!["assets/writing/illustrations/a.png".to_string()]);
    }

    #[test]
    fn extract_data_asset_refs_keeps_all_occurrences() {
        let html = r#"<img data-asset="assets/1.png"><img data-asset="assets/1.png"><img data-asset="assets/2.png">"#;
        assert_eq!(extract_data_asset_refs(html).len(), 3);
    }

    #[test]
    fn rewrite_img_to_epub_rewrites_src_and_self_closes() {
        let mut map = std::collections::HashMap::new();
        map.insert(
            "assets/writing/illustrations/a.png".to_string(),
            "images/a.png".to_string(),
        );
        let html = r#"<img src="asset://x" data-asset="assets/writing/illustrations/a.png" alt="a">"#;
        let out = rewrite_img_to_epub(html, &map);
        assert!(out.contains("src=\"images/a.png\""), "got: {out}");
        assert!(out.trim_end().ends_with("/>"), "got: {out}");
    }

    #[test]
    fn rewrite_img_to_epub_leaves_external_images_untouched() {
        let map = std::collections::HashMap::new();
        let html = r#"<img src="https://e.com/b.jpg"/>"#;
        assert_eq!(rewrite_img_to_epub(html, &map), html);
    }

    #[test]
    fn html_to_xhtml_self_closes_void_elements_and_fixes_nbsp() {
        assert_eq!(
            html_to_xhtml("a<br>b<hr>c<img src=\"x\">"),
            "a<br/>b<hr/>c<img src=\"x\"/>"
        );
        assert_eq!(html_to_xhtml("&nbsp;"), "&#160;");
        // 已自闭合的不重复处理
        assert_eq!(html_to_xhtml("<br/>"), "<br/>");
    }
}

// ─── 分析器融合（F1）：把书扫进既有分析记录体系 ───
//
// 语义映射：书 = 分析记录（analyses 行），章节 = 项目文件（project_files 行）。
// 这是「分析器就是写作台」的地基：实体图鉴 / 代码工作台 / 画布全部消费
// analyses + project_files，书扫进去之后这些既有面板无需任何前端改动即被点亮。
//
// path 约定 `writing://{book_id}/{chapter_id}.md`：
// - chapter_id 可从 path 反解 → read_source_file 据此从 writing_chapters 取正文；
// - 不落磁盘，正文唯一事实来源仍是写作库。
// - `wscan_` 前缀隔离用户手动创建的分析记录，删除书籍时同步清理。

/// 写作扫描产物的 analysis id 前缀（wscan_{book_id}）
pub fn writing_analysis_id(book_id: &str) -> String {
    format!("wscan_{}", book_id)
}

/// 章节虚拟文件的 path 前缀（read_source_file 据此分流到写作库）
pub const WRITING_PATH_PREFIX: &str = "writing://";

/// 扫描结果摘要（前端 toast + 接线 projectStore 用）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingScanSummary {
    pub analysis_id: String,
    pub file_count: i64,
    pub total_words: i64,
    /// 本次写作发现的条数（死设定 + 未落地节拍）
    pub finding_count: i64,
}

/// 把一本书扫描为分析记录：
/// upsert analyses 行 + 全量重建章节的 project_files 行，
/// 并产出写作审查发现（对标死代码 / 技术债语义）。
///
/// 跨仓编排入口：由 commands/writing.rs 薄壳注入四个仓储 State 后调用。
/// 软删章节判定：extra.deletedAt 为真数（>0）即视为已进回收站。
/// 前端软删把时间戳写进 extra JSON（零迁移），读取侧（扫描/统计）据此排除；
/// 坏数据/缺字段一律视为未删除（保守，不丢内容）。
fn is_chapter_soft_deleted(extra: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(extra)
        .ok()
        .and_then(|v| v.get("deletedAt").and_then(|d| d.as_i64()))
        .map(|t| t > 0)
        .unwrap_or(false)
}

pub fn scan_book(
    book_id: &str,
    writing_repo: &Arc<SqliteWritingRepository>,
    analysis_repo: &Arc<SqliteAnalysisRepository>,
    file_repo: &Arc<SqliteProjectFileRepository>,
    finding_repo: &Arc<SqliteReviewFindingRepository>,
) -> AppResult<WritingScanSummary> {
    let book = writing_repo
        .get_book(book_id)?
        .ok_or_else(|| AppError::NotFound(format!("书籍不存在: {}", book_id)))?;
    // 软删章（回收站）不参与全书解析：内容已从用户视角删除，不进 analyses/语料/统计
    let chapters = writing_repo
        .list_chapters(book_id)?
        .into_iter()
        .filter(|c| !is_chapter_soft_deleted(&c.extra))
        .collect::<Vec<_>>();
    let analysis_id = writing_analysis_id(book_id);
    let now = chrono::Utc::now().timestamp();
    let total_words: i64 = chapters.iter().map(|c| c.word_count).sum();

    // 1) analyses 行：书即分析记录（字数充当行数口径，主语言标记 novel-zh）。
    //    INSERT OR REPLACE 是整行覆写：必须先把既有行读出来，把画布持久化字段
    //    （editor_components/editor_layers/canvas_config/...）原样带回去，
    //    否则每次重扫都会把用户在工作室画布上摆好的布局抹成 NULL（书=场景的数据丢失根因）。
    let existing = analysis_repo.get_analysis_by_id(&analysis_id)?;
    analysis_repo.save_analysis(&Analysis {
        id: analysis_id.clone(),
        name: book.title.clone(),
        description: book.description.clone(),
        project_root: format!("{}{}/", WRITING_PATH_PREFIX, book_id),
        editor_components: existing.as_ref().and_then(|a| a.editor_components.clone()),
        editor_layers: existing.as_ref().and_then(|a| a.editor_layers.clone()),
        canvas_config: existing.as_ref().and_then(|a| a.canvas_config.clone()),
        global_components: existing.as_ref().and_then(|a| a.global_components.clone()),
        views: existing.as_ref().and_then(|a| a.views.clone()),
        active_view_id: existing.as_ref().and_then(|a| a.active_view_id.clone()),
        viewport_sync_rules: existing.as_ref().and_then(|a| a.viewport_sync_rules.clone()),
        category_id: existing.as_ref().and_then(|a| a.category_id.clone()),
        tags: "[\"writing\"]".to_string(),
        scan_status: "ready".to_string(),
        scan_progress: 100,
        last_scanned_at: Some(now),
        total_files: chapters.len() as i64,
        total_lines: total_words,
        primary_language: Some("novel-zh".to_string()),
        created_at: existing.as_ref().map(|a| a.created_at).unwrap_or(now),
        ..Default::default()
    })?;

    // 2) 设定卡（人设 + 世界观）：出场统计与死设定检测的检测对象
    let characters = writing_repo.list_settings(book_id, "character")?;
    let worldbuilding = writing_repo.list_settings(book_id, "worldbuilding")?;
    let cards: Vec<&crate::domain::writing::WritingSetting> = characters
        .iter()
        .chain(worldbuilding.iter())
        .filter(|s| !s.name.trim().is_empty())
        .collect();

    // 3) project_files 行：每章一个虚拟文件（按 sort_order 排序，卷名进 rel_path），
    //    metadata.appearances 记录本章各设定卡提及次数
    let mut sorted = chapters;
    sorted.sort_by_key(|c| c.sort_order);
    let mut files = Vec::with_capacity(sorted.len());
    // 设定卡总提及次数（跨全书），收敛后判死设定
    let mut card_totals: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for (i, ch) in sorted.iter().enumerate() {
        let num = i + 1;
        let prefix = if ch.volume.is_empty() {
            String::new()
        } else {
            format!("{}/", ch.volume)
        };
        // 正文段落近似行数（TipTap HTML 的 <p> 数）；空章至少 1 行
        let para_count = (ch.content.matches("<p").count() as i64).max(1);
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        std::hash::Hash::hash(&ch.content, &mut hasher);
        // 本章纯文本（出场统计的口径：正文提及，不含标题/大纲）
        let plain = crate::commands::source_view::html_to_plain_text(&ch.content);
        let mut appearances = Vec::new();
        for card in &cards {
            let count = plain.matches(card.name.as_str()).count() as i64;
            if count > 0 {
                *card_totals.entry(card.id.clone()).or_insert(0) += count;
                appearances.push(serde_json::json!({
                    "id": card.id,
                    "name": card.name,
                    // kind（character/worldbuilding）供实体图鉴按写作口径分别计数；
                    // 旧数据没有该字段，前端按「人物」兜底，零回归。
                    "kind": card.kind,
                    "count": count,
                }));
            }
        }
        files.push(ProjectFile {
            id: format!("wfile_{}", ch.id),
            analysis_id: analysis_id.clone(),
            path: format!("{}{}/{}.md", WRITING_PATH_PREFIX, book_id, ch.id),
            rel_path: format!("{}{:02}-{}.md", prefix, num, ch.title),
            name: ch.title.clone(),
            extension: Some("md".to_string()),
            language: Some("novel-zh".to_string()),
            size: ch.word_count,
            line_count: para_count,
            content_hash: Some(format!("{:016x}", std::hash::Hasher::finish(&hasher))),
            is_directory: false,
            metadata: serde_json::json!({
                "volume": ch.volume,
                "chapterStatus": ch.status,
                "bookId": book_id,
                "appearances": appearances,
            })
            .to_string(),
            scanned_at: now,
            ..Default::default()
        });
    }
    file_repo.delete_by_analysis(&analysis_id)?;
    file_repo.save_batch(&files)?;

    // 4) 写作审查发现（对标死代码 / 技术债，target_type 对齐图鉴写作实体类型）
    let mut findings = Vec::new();
    for card in &cards {
        let total = card_totals.get(&card.id).copied().unwrap_or(0);
        if total > 0 {
            continue;
        }
        let is_character = card.kind == "character";
        findings.push(ReviewFinding {
            analysis_id: analysis_id.clone(),
            rule_id: Some("writing-dead-setting".to_string()),
            target_id: card.id.clone(),
            target_type: if is_character {
                "writing-character".to_string()
            } else {
                "writing-worldview".to_string()
            },
            severity: if is_character { "warning" } else { "info" }.to_string(),
            message: if is_character {
                format!("人物「{}」全书 {} 章均未出场", card.name, sorted.len())
            } else {
                format!("世界观「{}」全书均未提及", card.name)
            },
            suggestion: Some(
                if is_character {
                    "在正文中安排其出场，或确认该人设卡是否已废弃"
                } else {
                    "在正文中引入该设定，或确认该卡是否已废弃"
                }
                .to_string(),
            ),
            metadata: serde_json::json!({ "bookId": book_id, "settingName": card.name }).to_string(),
            ..Default::default()
        });
    }
    let outlines = writing_repo.list_outlines(book_id)?;
    for o in &outlines {
        if o.chapter_id.is_some() {
            continue;
        }
        findings.push(ReviewFinding {
            analysis_id: analysis_id.clone(),
            rule_id: Some("writing-unbound-outline".to_string()),
            target_id: o.id.clone(),
            target_type: "writing-outline".to_string(),
            severity: "info".to_string(),
            message: format!("灵感条目「{}」尚未挂接到任何章节", o.title),
            suggestion: Some("在章节详情中挂接该条目，或将其纳入后续卷规划".to_string()),
            metadata: serde_json::json!({ "bookId": book_id }).to_string(),
            ..Default::default()
        });
    }
    finding_repo.delete_by_analysis(&analysis_id)?;
    finding_repo.save_batch(&findings)?;

    Ok(WritingScanSummary {
        analysis_id,
        file_count: files.len() as i64,
        total_words,
        finding_count: findings.len() as i64,
    })
}

// ─── 导入作品（F4）：把已有 txt/md 全书导入写作库，工作室入口用 ───

/// 导入结果摘要
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingImportSummary {
    pub book_id: String,
    pub title: String,
    pub chapter_count: i64,
    pub total_words: i64,
    /// 章节切分策略：heading（按章节标题行）/ single（无标题，全书单章）
    pub strategy: String,
}

/// 导入文件上限 10MB（长篇单文件足够，防误选巨型文件）
const IMPORT_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// 章节标题行识别：第X章/节/卷/回、序章/楔子/尾声/终章/番外、Chapter N。
/// 只认行首短行（≤40 字符），防止「他说这是第三章」这类正文句子误切。
fn chapter_heading(line: &str) -> Option<String> {
    let s = line.trim();
    if s.is_empty() || s.chars().count() > 40 {
        return None;
    }
    const MARKERS: [&str; 5] = ["序章", "楔子", "尾声", "终章", "番外"];
    if MARKERS.iter().any(|m| s.starts_with(m) && s.chars().count() <= 20) {
        return Some(s.to_string());
    }
    if s.starts_with('第') {
        let head: String = s.chars().take(12).collect();
        if head.contains(['章', '节', '卷', '回']) {
            return Some(s.to_string());
        }
    }
    let lower = s.to_lowercase();
    if lower.starts_with("chapter ") && lower.chars().count() <= 30 {
        return Some(s.to_string());
    }
    None
}

/// 纯文本 → TipTap 可解析的段落 HTML（每非空行一段，最小实体转义）
fn text_to_html(text: &str) -> String {
    let mut out = String::new();
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        out.push_str("<p>");
        for c in t.chars() {
            match c {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                c => out.push(c),
            }
        }
        out.push_str("</p>");
    }
    out
}

fn count_words(text: &str) -> i64 {
    text.chars().filter(|c| !c.is_whitespace()).count() as i64
}

/// 导入一本已有作品：按章节标题行切分（第X章/序章/楔子/Chapter N），
/// 无标题行则全书单章（strategy=single）。纯新增写库，不碰既有书籍。
pub fn import_book(
    file_path: String,
    title: Option<String>,
    writing_repo: &Arc<SqliteWritingRepository>,
) -> AppResult<WritingImportSummary> {
    let meta = std::fs::metadata(&file_path)
        .map_err(|e| AppError::Internal(format!("读取文件失败: {e}")))?;
    if meta.len() > IMPORT_MAX_BYTES {
        return Err(AppError::Validation(
            "文件超过 10MB 导入上限".into(),
        ));
    }
    let text = std::fs::read_to_string(&file_path).map_err(|e| {
        AppError::Internal(format!("无法以 UTF-8 文本读取: {e}"))
    })?;
    let book_title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            std::path::Path::new(&file_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("导入作品")
                .to_string()
        });
    let now = chrono::Utc::now().timestamp();

    let lines: Vec<&str> = text.lines().collect();
    let mut headings: Vec<(usize, String)> = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if let Some(h) = chapter_heading(l) {
            headings.push((i, h));
        }
    }

    let mut chapters: Vec<(String, String)> = Vec::new(); // (标题, 正文纯文本)
    let strategy;
    if headings.len() >= 2 {
        strategy = "heading".to_string();
        // 首个标题行之前的零散内容（书名页/作者语）字数可观时归入「开篇」
        if headings[0].0 > 0 {
            let pre: String = lines[..headings[0].0].join("\n");
            if count_words(&pre) > 50 {
                chapters.push(("开篇".to_string(), pre));
            }
        }
        for (idx, (start, htitle)) in headings.iter().enumerate() {
            let end = headings.get(idx + 1).map(|(e, _)| *e).unwrap_or(lines.len());
            let body: String = lines[*start + 1..end].join("\n");
            chapters.push((htitle.clone(), body));
        }
    } else {
        strategy = "single".to_string();
        chapters.push((book_title.clone(), text.clone()));
    }

    let book = WritingBook {
        id: format!("book_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
        title: book_title.clone(),
        description: None,
        genre: String::new(),
        medium: String::new(),
        status: "draft".to_string(),
        cover_color: "#4A338F".to_string(),
        daily_goal: 0,
        extra: "{}".to_string(),
        created_at: now,
        updated_at: now,
    };
    writing_repo.save_book(&book)?;

    let mut total_words = 0i64;
    for (i, (ch_title, body)) in chapters.iter().enumerate() {
        let wc = count_words(body);
        total_words += wc;
        writing_repo.save_chapter(&WritingChapter {
            id: format!("ch_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
            book_id: book.id.clone(),
            title: ch_title.chars().take(60).collect(),
            content: text_to_html(body),
            sort_order: i as i64,
            word_count: wc,
            status: "draft".to_string(),
            volume: String::new(),
            parent_id: None,
            kind: "章".to_string(),
            storyline_id: None,
            extra: "{}".to_string(),
            created_at: now,
            updated_at: now,
        })?;
    }

    Ok(WritingImportSummary {
        book_id: book.id,
        title: book.title,
        chapter_count: chapters.len() as i64,
        total_words,
        strategy,
    })
}
#[cfg(test)]
mod export_smoke_tests {
    use super::*;

    fn sample_chapters(with_img: bool) -> Vec<EpubChapter> {
        let mut img = String::new();
        if with_img {
            // 生成一张临时 PNG，用绝对路径（collect_images 对相对 resolve 失败时会按字面路径尝试）
            let dir = std::env::temp_dir().join("sightfolio_export_test");
            std::fs::create_dir_all(&dir).unwrap();
            let png_path = dir.join("smoke.png");
            if !png_path.exists() {
                let img = image::RgbImage::from_fn(64, 40, |x, y| {
                    image::Rgb([
                        (x * 3) as u8,
                        (y * 5) as u8,
                        ((x + y) * 2) as u8,
                    ])
                });
                img.save(&png_path).unwrap();
            }
            img = format!(r#"<p><img data-asset="{}" alt="t"></p>"#, png_path.display());
        }
        vec![
            EpubChapter {
                title: "第一章 缘起".into(),
                content: format!(
                    r#"<h1>开篇</h1><p>这是一个用于验证中文 PDF 离线导出的长段落。没有空格的连续中文应当按字形宽度自动换行，而不能被截断。{}"#,
                    "这是一个很长的中文句子，用来验证自动换行逻辑是否正确，句子足够长到会跨行显示。".repeat(8)
                ) + &img,
                cover: None,
            },
            EpubChapter {
                title: "第二章 发展".into(),
                content: r#"<p>English text with some words to wrap across lines correctly as well.</p><ul><li>要点一</li><li>要点二</li></ul><table><tr><td>甲</td><td>乙</td></tr><tr><td>1</td><td>2</td></tr></table>"#.into(),
                cover: None,
            },
        ]
    }

    #[test]
    fn export_pdf_produces_valid_pdf_with_embedded_cjk_font() {
        let out = std::env::temp_dir().join("sightfolio_export_test").join("smoke.pdf");
        let _ = std::fs::remove_file(&out);
        let r = crate::application::writing::pdf_export::export_pdf(
            "测试之书".into(),
            Some("一本验证导出的书".into()),
            sample_chapters(true),
            out.to_string_lossy().to_string(),
        );
        assert!(r.is_ok(), "export failed: {:?}", r.err());
        assert!(out.exists(), "pdf not created");

        // 字节级结构校验（lopdf 0.26 default-features=false 无读取器，改手验）
        let bytes = std::fs::read(&out).expect("read pdf");
        let text = String::from_utf8_lossy(&bytes);
        assert!(bytes.starts_with(b"%PDF"), "missing %PDF header");
        assert!(text.ends_with("%%EOF") || text.contains("%%EOF"), "missing %%EOF trailer");
        assert!(text.contains("Subtype/Type0") || text.contains("/Type0"), "Type0 font missing");
        assert!(text.contains("FontFile2"), "FontFile2 missing");
        assert!(text.contains("FlateDecode"), "compressed stream missing");
        assert!(text.contains("/Type/Page") || text.contains("/Type /Page"), "Page objects missing");
        // 页对象计数（粗糙统计，>=3 页应有至少 3 个 /Type /Page）：
        let page_count = text.matches("/Type/Page").count() + text.matches("/Type /Page").count();
        assert!(page_count >= 3, "expected >=3 pages, got {page_count}");

        // 文件大小：字体已嵌入（压缩后应明显大于 500KB，且包含压缩字体流）
        let size = std::fs::metadata(&out).unwrap().len();
        assert!(size > 200_000, "embedding likely missing, size={size}");
        println!("[smoke] pdf ok: {page_count} pages, {size} bytes -> {}", out.display());
    }

    #[test]
    fn export_docx_produces_valid_docx() {
        let out = std::env::temp_dir().join("sightfolio_export_test").join("smoke.docx");
        let _ = std::fs::remove_file(&out);
        let r = crate::application::writing::docx_export::export_docx(
            "测试之书".into(),
            None,
            sample_chapters(true),
            out.to_string_lossy().to_string(),
        );
        assert!(r.is_ok(), "export failed: {:?}", r.err());
        assert!(out.exists());

        // 用 zip 读取验证结构
        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
        assert!(names.contains(&"[Content_Types].xml".to_string())); // zip 层可能去掉前缀
        assert!(names.iter().any(|n| n.contains("word/document.xml")), "missing document.xml: {names:?}");
        assert!(names.iter().any(|n| n.contains("word/media/")), "image not embedded: {names:?}");
        println!("[smoke] docx ok: {} entries -> {}", names.len(), out.display());
    }
}

#[cfg(test)]
mod epub_export_smoke_tests {
    use super::*;
    use std::path::Path;

    /// 读取 zip 中某条目为字符串（ZipFile 有 Drop，独立作用域避免借用冲突）。
    fn read_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> String {
        let mut buf = String::new();
        {
            let mut f = zip.by_name(name).expect(name);
            use std::io::Read;
            f.read_to_string(&mut buf).unwrap();
        }
        buf
    }

    fn smoke_chapters(with_cover: bool) -> Vec<EpubChapter> {
        // 一张临时 PNG，绝对路径引用（与 export_smoke_tests 同约定，resolve_asset_ref 直接读）
        let dir = std::env::temp_dir().join("sightfolio_epub_test");
        std::fs::create_dir_all(&dir).unwrap();
        let png_path = dir.join("cover_illus.png");
        if !png_path.exists() {
            let img = image::RgbImage::from_fn(80, 60, |x, y| {
                image::Rgb([(x * 2) as u8, (y * 3) as u8, 128u8])
            });
            img.save(&png_path).unwrap();
        }
        let img_tag = format!(r#"<p><img data-asset="{}" alt="插图"></p>"#, png_path.display());
        vec![
            EpubChapter {
                title: "第一章 风起".into(),
                content: format!(r#"<h1>第一章 风起</h1><p>长夜漫漫，雨敲窗棂。</p>{img_tag}"#),
                cover: if with_cover { Some(png_path.to_string_lossy().to_string()) } else { None },
            },
            EpubChapter {
                title: "第二章 灯下".into(),
                content: r#"<p>她翻开了旧信。</p>"#.into(),
                cover: None,
            },
        ]
    }

    /// 端到端：真实生成 .epub，解 zip 校验 EPUB3 结构契约
    /// （mimetype 首条目 / container.xml → content.opf / nav.xhtml / 各章 xhtml / 插画入包）。
    #[test]
    fn export_epub_produces_valid_epub3_structure() {
        let out = std::env::temp_dir()
            .join("sightfolio_epub_test")
            .join("smoke.epub");
        let _ = std::fs::remove_file(&out);
        let r = crate::application::writing::export_epub(
            "测试之书".into(),
            Some("端到端校验用书".into()),
            smoke_chapters(true),
            out.to_string_lossy().to_string(),
        );
        assert!(r.is_ok(), "export failed: {:?}", r.err());
        assert!(out.exists());

        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).expect("epub must be a valid zip");
        let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();

        // 1. mimetype 首条目、内容精确
        let buf = read_entry(&mut zip, "mimetype");
        assert_eq!(buf.as_bytes(), b"application/epub+zip", "mimetype content must be exact");
        assert_eq!(names[0], "mimetype", "mimetype must be the first zip entry");

        // 2. container.xml 指向 content.opf
        let cbuf = read_entry(&mut zip, "META-INF/container.xml");
        assert!(cbuf.contains("OEBPS/content.opf"), "container must point to content.opf");

        // 3. content.opf：元数据 + manifest 含 nav/章节/插画 + spine 章节顺序
        let obuf = read_entry(&mut zip, "OEBPS/content.opf");
        assert!(obuf.contains("<dc:title>测试之书</dc:title>"), "missing dc:title");
        assert!(obuf.contains("<dc:description>端到端校验用书</dc:description>"), "missing description");
        assert!(obuf.contains("id=\"nav\" href=\"nav.xhtml\""), "missing nav manifest item");
        assert!(obuf.contains("href=\"chapter_0.xhtml\""), "missing chapter_0 manifest item");
        assert!(obuf.contains("href=\"chapter_1.xhtml\""), "missing chapter_1 manifest item");
        assert!(obuf.contains("media-type=\"image/png\""), "missing image manifest item");
        assert!(obuf.contains("<itemref idref=\"chap_0\"/>"), "spine must order chapter 0 first");
        assert!(obuf.contains("<itemref idref=\"chap_1\"/>"), "spine must include chapter 1");

        // 4. nav.xhtml（EPUB3 目录含全部章标题）
        let nbuf = read_entry(&mut zip, "OEBPS/nav.xhtml");
        assert!(nbuf.contains("epub:type=\"toc\""), "nav must be epub:toc");
        assert!(nbuf.contains("第一章 风起"), "nav missing chapter 1 title");
        assert!(nbuf.contains("第二章 灯下"), "nav missing chapter 2 title");

        // 5. 章节 xhtml：正文入包，插图 src 改写为包内路径
        let x0 = read_entry(&mut zip, "OEBPS/chapter_0.xhtml");
        assert!(x0.contains("<h1>第一章 风起</h1>"), "chapter body missing in xhtml");
        assert!(x0.contains("src=\"images/cover_illus.png\""), "img must be rewritten to packaged href");
        assert!(x0.contains("chapter-cover"), "cover image must be prepended in chapter");
        assert!(Path::new(&out).exists(), "epub file must exist on disk");

        // 6. 插画实际入包（正文引用 + 章头图同图只打包一次）
        let img_count = names.iter().filter(|n| n.starts_with("OEBPS/images/")).count();
        assert_eq!(img_count, 1, "same image referenced twice must be packaged once: {names:?}");
        println!("[smoke] epub ok: {} entries -> {}", names.len(), out.display());
    }

    /// 无插画/无描述的最小书：export 仍产出合法结构（无 description 标签、无 images）。
    #[test]
    fn export_epub_without_assets_and_description() {
        let out = std::env::temp_dir()
            .join("sightfolio_epub_test")
            .join("minimal.epub");
        let _ = std::fs::remove_file(&out);
        let r = crate::application::writing::export_epub(
            "无图之书".into(),
            None,
            vec![
                EpubChapter { title: "第一章".into(), content: "<p>无图章节一。</p>".into(), cover: None },
                EpubChapter { title: "第二章".into(), content: "<p>无图章节二。</p>".into(), cover: None },
            ],
            out.to_string_lossy().to_string(),
        );
        assert!(r.is_ok(), "export failed: {:?}", r.err());
        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
        assert!(!names.iter().any(|n| n.starts_with("OEBPS/images/")), "no images expected");
        let obuf = read_entry(&mut zip, "OEBPS/content.opf");
        assert!(!obuf.contains("<dc:description>"), "description must be absent when None");
        assert!(obuf.contains("<dc:title>无图之书</dc:title>"));
    }

    /// 章标题含需要 XML 转义的字符（& < >）时，opf/nav/xhtml 全部转义且不破坏结构。
    #[test]
    fn export_epub_escapes_xml_in_titles() {
        let out = std::env::temp_dir()
            .join("sightfolio_epub_test")
            .join("escape.epub");
        let _ = std::fs::remove_file(&out);
        let r = crate::application::writing::export_epub(
            "A & B <book>".into(),
            None,
            vec![EpubChapter {
                title: "第1章 <序> & 后记".into(),
                content: "<p>x</p>".into(),
                cover: None,
            }],
            out.to_string_lossy().to_string(),
        );
        assert!(r.is_ok(), "export failed: {:?}", r.err());
        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let obuf = read_entry(&mut zip, "OEBPS/content.opf");
        assert!(obuf.contains("A &amp; B &lt;book&gt;"), "dc:title must be escaped: {obuf}");
        let nbuf = read_entry(&mut zip, "OEBPS/nav.xhtml");
        assert!(nbuf.contains("第1章 &lt;序&gt; &amp; 后记"), "nav title must be escaped: {nbuf}");
    }
}
