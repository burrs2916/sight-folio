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
use crate::domain::writing::{WritingBook, WritingChapter, WritingChapterSnapshot};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::analysis_repository::{
    AnalysisRepository, SqliteAnalysisRepository,
};
use crate::infrastructure::database::project_file_repository::{
    ProjectFileRepository, SqliteProjectFileRepository,
};
use crate::infrastructure::database::review_finding_repository::{
    ReviewFindingRepository, SqliteReviewFindingRepository,
};
use crate::infrastructure::database::writing_repository::{
    SqliteWritingRepository, WritingRepository, SETTING_REVISION_KEEP,
    SETTING_REVISION_ORIGIN_RESTORE,
};

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

/// 重命名章节快照（只改 name 一列）。`None`/空白 = 清除自定义名。
pub fn rename_chapter_snapshot(
    snapshot_id: &str,
    name: Option<&str>,
    repo: &Arc<SqliteWritingRepository>,
) -> AppResult<()> {
    repo.rename_chapter_snapshot(snapshot_id, name)
}

/// 某张设定卡的改写历史（倒序）。设定卡被 AI 改写前必定先把旧值存进来，
/// 这个读出口就是"改错了能找回"的唯一依据——没有它，写入历史只是无人可读的垃圾。
pub fn list_setting_revisions(
    setting_id: &str,
    limit: i64,
    repo: &Arc<SqliteWritingRepository>,
) -> AppResult<Vec<crate::domain::writing::WritingSettingRevision>> {
    repo.list_setting_revisions(setting_id, limit)
}

/// 把设定卡恢复到某条修订历史的值，返回恢复后的卡。
///
/// **恢复本身也是一次改写，所以当前值先入历史**（origin=`restore`）。
/// 否则"点错一次恢复"就成了不可逆操作——而这正是这张历史表存在的目的。
/// 有了这一步，恢复可以反复点：每次被顶掉的内容都留得下来。
pub fn restore_setting_revision(
    setting_id: &str,
    revision_id: &str,
    repo: &Arc<SqliteWritingRepository>,
) -> AppResult<crate::domain::writing::WritingSetting> {
    use crate::domain::writing::WritingSettingRevision;
    use chrono::Utc;

    let current = repo
        .get_setting(setting_id)?
        .ok_or_else(|| AppError::NotFound(format!("设定卡不存在: {setting_id}")))?;
    // revision_id 必须属于这张卡：不校验就能拿 A 卡的历史去覆写 B 卡
    let revision = repo
        .get_setting_revision(revision_id, setting_id)?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "修订记录不存在或不属于该卡: {revision_id} / {setting_id}"
            ))
        })?;

    let now = Utc::now().timestamp();
    repo.save_setting_revision(
        &WritingSettingRevision {
            id: format!("srev_{}", uuid::Uuid::new_v4().simple()),
            setting_id: current.id.clone(),
            book_id: current.book_id.clone(),
            name: current.name.clone(),
            subtitle: current.subtitle.clone(),
            description: current.description.clone(),
            extra: current.extra.clone(),
            origin: SETTING_REVISION_ORIGIN_RESTORE.to_string(),
            created_at: now,
        },
        SETTING_REVISION_KEEP,
    )?;

    let mut restored = current;
    restored.name = revision.name;
    restored.subtitle = revision.subtitle;
    restored.description = revision.description;
    restored.extra = revision.extra;
    restored.updated_at = now;
    repo.save_setting(&restored)?;
    Ok(restored)
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
    /// 所属卷/部（批次 2 增强）：前端 WritingChapter.volume 透传，'' = 未分卷。
    /// 有值时导出（PDF 目录卷层级/DOCX 卷标/EPUB nav 分组）以其为卷标题。
    #[serde(default)]
    pub volume: Option<String>,
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
    match path
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
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
fn rewrite_img_to_epub(
    html: &str,
    rel_to_href: &std::collections::HashMap<String, String>,
) -> String {
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
    let bytes =
        std::fs::read(&abs).map_err(|e| AppError::Internal(format!("read asset {abs}: {e}")))?;
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
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let deflated =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

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

    // 5. content.opf（manifest = cover + nav + 各章 + 各图 + style.css）
    let mut manifest = String::from(
        r#"    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>"#,
    );
    let mut spine = String::from("\n    <itemref idref=\"cover\"/>");
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
    let desc = description.as_deref().map(xml_escape).unwrap_or_default();
    let opf = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:{uuid}</dc:identifier>
    <dc:title>{esc_title}</dc:title>
    <dc:creator>Sight Folio</dc:creator>
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

    // 6. nav.xhtml（EPUB3 目录；章节按卷分组：卷名作 <span> 组标题，卷内章节嵌套 <ol>）
    let mut nav_lis = String::new();
    let mut open_volume_li = false;
    let mut current_volume: Option<String> = None;
    for (i, ch) in chapters.iter().enumerate() {
        let volume = ch.volume.as_deref().filter(|v| !v.is_empty());
        if volume != current_volume.as_deref() {
            // 上一卷组收尾
            if open_volume_li {
                nav_lis.push_str("\n      </ol></li>");
                open_volume_li = false;
            }
            current_volume = volume.map(str::to_string);
            if let Some(v) = volume {
                nav_lis.push_str(&format!(
                    "\n      <li><span class=\"nav-volume\">{}</span>\n      <ol>",
                    xml_escape(v)
                ));
                open_volume_li = true;
            }
        }
        nav_lis.push_str(&format!(
            "\n        <li><a href=\"chapter_{i}.xhtml\">{}</a></li>",
            xml_escape(&ch.title)
        ));
    }
    if open_volume_li {
        nav_lis.push_str("\n      </ol></li>");
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

    // 6.5 style.css：统一定制正文（行距/首行缩进）、章标题（居中/加粗/强制新页）、插画自适应。
    const STYLE_CSS: &str = r#"/* Sight Folio EPUB 排版 */
body {
  font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", serif;
  line-height: 1.8;
  margin: 0 2em;
  max-width: 30em;
  margin-left: auto;
  margin-right: auto;
}
p {
  text-indent: 2em;
  margin: 0;
}
p:first-of-type {
  text-indent: 0;
}
p img, .chapter-cover img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}
h1 {
  font-size: 1.5em;
  font-weight: bold;
  text-align: center;
  line-height: 1.4;
  margin: 1em 0 1.2em;
}
h1.chapter-title {
  page-break-before: always;
  break-before: page;
}
h1 + p, h1 + div p:first-child {
  text-indent: 2em;
}
h1:first-child + p {
  text-indent: 2em;
}
.chapter-cover {
  text-align: center;
  margin: 1em 0;
}
/* 书封面页：整页垂直居中的卡片式封面 */
.cover-page {
  margin: 0;
  max-width: none;
  height: auto;
}
.cover-box {
  text-align: center;
  margin-top: 30vh;
}
.cover-title {
  font-size: 2em;
  font-weight: bold;
  margin: 0 0 0.6em;
}
.cover-desc {
  color: #555;
  font-size: 0.95em;
  text-indent: 0;
  margin: 0.4em 0;
}
.cover-brand {
  color: #999;
  font-size: 0.75em;
  letter-spacing: 0.3em;
  text-indent: 0;
  margin-top: 2.5em;
}
/* nav 卷组标题 */
.nav-volume {
  font-weight: bold;
}
"#;
    zip.start_file("OEBPS/style.css", deflated)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(STYLE_CSS.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 6.75 cover.xhtml：书封面页（书名 + 简介 + 出品署名，居中卡片式封面）
    let cover_desc = description
        .as_deref()
        .map(|d| format!("<p class=\"cover-desc\">{}</p>\n", xml_escape(d)))
        .unwrap_or_default();
    let cover_xhtml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title>{esc_title}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body class="cover-page">
<div class="cover-box">
<h1 class="cover-title">{esc_title}</h1>
{cover_desc}
<p class="cover-brand">Sight Folio 出品</p>
</div>
</body>
</html>"#
    );
    zip.start_file("OEBPS/cover.xhtml", deflated)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(cover_xhtml.as_bytes())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 7. 各章 xhtml（正文 src 改写 + 章头图前置 + 章标题 h1 注入 + 引 style.css）
    for (i, ch) in chapters.iter().enumerate() {
        let rewritten = rewrite_img_to_epub(&ch.content, &rel_to_href);
        let body = html_to_xhtml(&rewritten);
        let cover_img = match &ch.cover {
            Some(c) if !c.is_empty() => rel_to_href.get(c).map(|href| {
                format!("<div class=\"chapter-cover\"><img alt=\"cover\" src=\"{href}\"/></div>\n")
            }),
            _ => None,
        };
        // 章标题注入：正文自身已含 <h1>（章节正文结构完整）时不重复注入。
        let title_tag = if ch.content.trim_start().starts_with("<h1") {
            String::new()
        } else {
            format!(
                "<h1 class=\"chapter-title\">{}</h1>\n",
                xml_escape(&ch.title)
            )
        };
        let xhtml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title>{}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
{}{}{}
</body>
</html>"#,
            xml_escape(&ch.title),
            cover_img.unwrap_or_default(),
            title_tag,
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
        let html =
            r#"<img src="asset://x" data-asset="assets/writing/illustrations/a.png" alt="a">"#;
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
        viewport_sync_rules: existing
            .as_ref()
            .and_then(|a| a.viewport_sync_rules.clone()),
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
            metadata: serde_json::json!({ "bookId": book_id, "settingName": card.name })
                .to_string(),
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
    if MARKERS
        .iter()
        .any(|m| s.starts_with(m) && s.chars().count() <= 20)
    {
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
        return Err(AppError::Validation("文件超过 10MB 导入上限".into()));
    }
    let text = std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Internal(format!("无法以 UTF-8 文本读取: {e}")))?;
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
            let end = headings
                .get(idx + 1)
                .map(|(e, _)| *e)
                .unwrap_or(lines.len());
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
                    image::Rgb([(x * 3) as u8, (y * 5) as u8, ((x + y) * 2) as u8])
                });
                img.save(&png_path).unwrap();
            }
            img = format!(
                r#"<p><img data-asset="{}" alt="t"></p>"#,
                png_path.display()
            );
        }
        vec![
            EpubChapter {
                volume: None,
                title: "第一章 缘起".into(),
                content: format!(
                    r#"<h1>开篇</h1><p>这是一个用于验证中文 PDF 离线导出的长段落。没有空格的连续中文应当按字形宽度自动换行，而不能被截断。{}</p>"#,
                    "这是一个很长的中文句子，用来验证自动换行逻辑是否正确，句子足够长到会跨行显示。".repeat(8)
                ) + &img,
                cover: None,
            },
            EpubChapter {
                volume: None,
                title: "第二章 发展".into(),
                content: r#"<p>English text with some words to wrap across lines correctly as well.</p><ul><li>要点一</li><li>要点二</li></ul><table><tr><td>甲</td><td>乙</td></tr><tr><td>1</td><td>2</td></tr></table>"#.into(),
                cover: None,
            },
        ]
    }

    /// 扫描 PDF 全部内容流并拼接文本，供正文级排版断言。
    /// 内容流可能带 FlateDecode（压缩）也可能直接明文；图像/字体流解压后是二进制，
    /// 拼接进 out 不影响文本断言（只做 contains / 坐标区间匹配）。
    fn pdf_decompressed_text(path: &std::path::Path) -> String {
        let bytes = std::fs::read(path).unwrap();
        let mut out = String::new();
        let mut pos = 0usize;
        loop {
            // 找下一个 stream 起始（兼容 \r\n 与 \n 两种行尾）
            let crlf = bytes[pos..].windows(8).position(|w| w == b"stream\r\n");
            let lf = bytes[pos..].windows(7).position(|w| w == b"stream\n");
            let rel = match (crlf, lf) {
                (Some(a), Some(b)) => a.min(b),
                (Some(a), None) => a,
                (None, Some(b)) => b,
                _ => break,
            };
            let delim_len = if crlf == Some(rel) { 8 } else { 7 };
            let start = pos + rel + delim_len;
            let Some(end) = bytes[start..].windows(9).position(|w| w == b"endstream") else {
                break;
            };
            use std::io::Read;
            let chunk = &bytes[start..start + end];
            let mut dec = flate2::read::ZlibDecoder::new(chunk);
            let mut buf = Vec::new();
            if dec.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                out.push_str(&String::from_utf8_lossy(&buf));
            } else {
                // 明文内容流（未压缩）
                out.push_str(&String::from_utf8_lossy(chunk));
            }
            pos = start + end;
        }
        out
    }

    #[test]
    fn export_pdf_produces_valid_pdf_with_embedded_cjk_font() {
        let out = std::env::temp_dir()
            .join("sightfolio_export_test")
            .join("smoke.pdf");
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
        assert!(
            text.ends_with("%%EOF") || text.contains("%%EOF"),
            "missing %%EOF trailer"
        );
        assert!(
            text.contains("Subtype/Type0") || text.contains("/Type0"),
            "Type0 font missing"
        );
        assert!(text.contains("FontFile2"), "FontFile2 missing");
        assert!(text.contains("FlateDecode"), "compressed stream missing");
        assert!(
            text.contains("/Type/Page") || text.contains("/Type /Page"),
            "Page objects missing"
        );
        // 页对象计数（粗糙统计，>=3 页应有至少 3 个 /Type /Page）：
        let page_count = text.matches("/Type/Page").count() + text.matches("/Type /Page").count();
        assert!(page_count >= 3, "expected >=3 pages, got {page_count}");

        // 文件大小：字体已嵌入（压缩后应明显大于 500KB，且包含压缩字体流）
        let size = std::fs::metadata(&out).unwrap().len();
        assert!(size > 200_000, "embedding likely missing, size={size}");

        // 正文级排版断言（解码全部内容流，验证 T1/T3/T6 修复）：
        let st = pdf_decompressed_text(&out);
        assert!(
            !st.contains("td甲") && !st.contains("td乙"),
            "table cell tag residue leaked into pdf text"
        );
        // T3 正文首行缩进 2 字符：首行 x = MARGIN(50) + BODY_FONT_SIZE(11)*2 = 72
        assert!(
            st.contains("1 0 0 1 72 "),
            "first-line indent missing in content stream"
        );
        // T3 页脚页码居中（正文页 "页码 / 总页数" 关于页面水平居中，x≈288.74）
        assert!(
            st.contains("288.74"),
            "footer page number not horizontally centered"
        );
        // T3 封面书名居中（x≈245.5）
        assert!(
            st.contains("245.5"),
            "cover title not horizontally centered"
        );
        // T6 目录页码右对齐贴右页边（x∈(500, 545]，右页边 = PAGE_W - MARGIN = 545）
        let toc_right_ok = st.split("Tm").any(|seg| {
            let head = seg.rsplit("1 0 0 1 ").next().unwrap_or("");
            let mut it = head.split_whitespace();
            match (it.next(), it.next()) {
                (Some(x), Some(_y)) => x
                    .parse::<f64>()
                    .map(|xv| xv > 500.0 && xv <= 545.0)
                    .unwrap_or(false),
                _ => false,
            }
        });
        assert!(toc_right_ok, "toc page number not right-aligned to margin");
        println!(
            "[smoke] pdf ok: {page_count} pages, {size} bytes -> {}",
            out.display()
        );
    }

    #[test]
    fn export_docx_produces_valid_docx() {
        let out = std::env::temp_dir()
            .join("sightfolio_export_test")
            .join("smoke.docx");
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
        assert!(
            names.iter().any(|n| n.contains("word/document.xml")),
            "missing document.xml: {names:?}"
        );
        assert!(
            names.iter().any(|n| n.contains("word/media/")),
            "image not embedded: {names:?}"
        );
        // 表格导出为真实 w:tbl，且单元格内容不再降级为 "甲 | 乙" 纯文本行
        {
            let mut buf = String::new();
            {
                let mut f = zip.by_name("word/document.xml").unwrap();
                use std::io::Read;
                f.read_to_string(&mut buf).unwrap();
            }
            assert!(buf.contains("<w:tbl>"), "table not exported as w:tbl");
            assert!(buf.contains("<w:tc>"), "w:tbl cells missing");
            assert!(buf.contains("甲"), "table cell text missing");
            assert!(
                !buf.contains("甲 | 乙"),
                "table still degraded to plain-text row"
            );
            // 图片按源图 64×40 @96DPI 等比：cx=609600 cy=381000，不再固定 4×3
            assert!(
                buf.contains("cx=\"609600\"") && buf.contains("cy=\"381000\""),
                "image size not derived from source dims"
            );
            assert!(
                !buf.contains("cx=\"4000000\""),
                "hardcoded 4×3 image size remains"
            );
        }
        println!(
            "[smoke] docx ok: {} entries -> {}",
            names.len(),
            out.display()
        );
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
        let img_tag = format!(
            r#"<p><img data-asset="{}" alt="插图"></p>"#,
            png_path.display()
        );
        vec![
            EpubChapter {
                volume: None,
                title: "第一章 风起".into(),
                content: format!(r#"<h1>第一章 风起</h1><p>长夜漫漫，雨敲窗棂。</p>{img_tag}"#),
                cover: if with_cover {
                    Some(png_path.to_string_lossy().to_string())
                } else {
                    None
                },
            },
            EpubChapter {
                volume: None,
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
        assert_eq!(
            buf.as_bytes(),
            b"application/epub+zip",
            "mimetype content must be exact"
        );
        assert_eq!(names[0], "mimetype", "mimetype must be the first zip entry");

        // 2. container.xml 指向 content.opf
        let cbuf = read_entry(&mut zip, "META-INF/container.xml");
        assert!(
            cbuf.contains("OEBPS/content.opf"),
            "container must point to content.opf"
        );

        // 3. content.opf：元数据 + manifest 含 nav/章节/插画 + spine 章节顺序
        let obuf = read_entry(&mut zip, "OEBPS/content.opf");
        assert!(
            obuf.contains("<dc:title>测试之书</dc:title>"),
            "missing dc:title"
        );
        assert!(
            obuf.contains("<dc:description>端到端校验用书</dc:description>"),
            "missing description"
        );
        // T7 元数据与封面：dc:creator、cover manifest、spine 首位为封面
        assert!(
            obuf.contains("<dc:creator>Sight Folio</dc:creator>"),
            "missing dc:creator"
        );
        assert!(
            obuf.contains("id=\"cover\" href=\"cover.xhtml\""),
            "missing cover manifest item"
        );
        assert!(
            zip.file_names().any(|n| n == "OEBPS/cover.xhtml"),
            "cover.xhtml not packaged"
        );
        let spine_cover_first = {
            let spine = obuf.split("<spine").nth(1).unwrap_or("");
            // spine 标签可能带属性/换行，取 `>` 之后的内容判断首个 itemref
            let body = spine.split('>').nth(1).unwrap_or("");
            body.trim_start().starts_with("<itemref idref=\"cover\"")
        };
        assert!(spine_cover_first, "spine must put cover first");
        assert!(
            obuf.contains("id=\"nav\" href=\"nav.xhtml\""),
            "missing nav manifest item"
        );
        assert!(
            obuf.contains("href=\"chapter_0.xhtml\""),
            "missing chapter_0 manifest item"
        );
        assert!(
            obuf.contains("href=\"chapter_1.xhtml\""),
            "missing chapter_1 manifest item"
        );
        assert!(
            obuf.contains("media-type=\"image/png\""),
            "missing image manifest item"
        );
        assert!(
            obuf.contains("<itemref idref=\"chap_0\"/>"),
            "spine must order chapter 0 first"
        );
        assert!(
            obuf.contains("<itemref idref=\"chap_1\"/>"),
            "spine must include chapter 1"
        );

        // 4. nav.xhtml（EPUB3 目录含全部章标题）
        let nbuf = read_entry(&mut zip, "OEBPS/nav.xhtml");
        assert!(nbuf.contains("epub:type=\"toc\""), "nav must be epub:toc");
        assert!(nbuf.contains("第一章 风起"), "nav missing chapter 1 title");
        assert!(nbuf.contains("第二章 灯下"), "nav missing chapter 2 title");

        // 5. 章节 xhtml：正文入包，插图 src 改写为包内路径
        let x0 = read_entry(&mut zip, "OEBPS/chapter_0.xhtml");
        assert!(
            x0.contains("<h1>第一章 风起</h1>"),
            "chapter body missing in xhtml"
        );
        assert!(
            x0.contains("src=\"images/cover_illus.png\""),
            "img must be rewritten to packaged href"
        );
        assert!(
            x0.contains("chapter-cover"),
            "cover image must be prepended in chapter"
        );
        // T5 样式表：style.css 入包、章节头部引用、正文章标题注入
        assert!(
            zip.file_names().any(|n| n == "OEBPS/style.css"),
            "style.css not packaged"
        );
        let sbuf = read_entry(&mut zip, "OEBPS/style.css");
        assert!(
            sbuf.contains("page-break-before: always"),
            "style.css missing chapter page-break"
        );
        assert!(
            sbuf.contains("text-indent: 2em"),
            "style.css missing first-line indent"
        );
        assert!(
            x0.contains("href=\"style.css\""),
            "chapter xhtml missing stylesheet link"
        );
        let cbuf2 = read_entry(&mut zip, "OEBPS/cover.xhtml");
        assert!(
            cbuf2.contains("cover-title") && cbuf2.contains("Sight Folio"),
            "cover.xhtml missing title/brand structure"
        );
        assert!(Path::new(&out).exists(), "epub file must exist on disk");

        // 6. 插画实际入包（正文引用 + 章头图同图只打包一次）
        let img_count = names
            .iter()
            .filter(|n| n.starts_with("OEBPS/images/"))
            .count();
        assert_eq!(
            img_count, 1,
            "same image referenced twice must be packaged once: {names:?}"
        );
        println!(
            "[smoke] epub ok: {} entries -> {}",
            names.len(),
            out.display()
        );
    }

    /// T6/T7 卷嵌套分组：nav 按卷开 <span class="nav-volume"> + <ol> 分卷嵌套，
    /// spine 顺序为 cover → 各章；无卷章节平铺回退由 export_epub_escapes_xml_in_titles 覆盖。
    #[test]
    fn export_epub_groups_toc_by_volume() {
        let out = std::env::temp_dir()
            .join("sightfolio_epub_test")
            .join("volumes.epub");
        let _ = std::fs::remove_file(&out);
        let r = crate::application::writing::export_epub(
            "卷之书".into(),
            None,
            vec![
                EpubChapter {
                    volume: Some("第一卷 风起".into()),
                    title: "第一章 起势".into(),
                    content: r#"<h1>第一章 起势</h1><p>雨落。</p>"#.into(),
                    cover: None,
                },
                EpubChapter {
                    volume: Some("第一卷 风起".into()),
                    title: "第二章 破竹".into(),
                    content: r#"<h1>第二章 破竹</h1><p>风起。</p>"#.into(),
                    cover: None,
                },
                EpubChapter {
                    volume: Some("第二卷 云涌".into()),
                    title: "第三章 合龙".into(),
                    content: r#"<h1>第三章 合龙</h1><p>云聚。</p>"#.into(),
                    cover: None,
                },
            ],
            out.to_string_lossy().to_string(),
        );
        assert!(r.is_ok(), "export failed: {:?}", r.err());

        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let nbuf = read_entry(&mut zip, "OEBPS/nav.xhtml");
        // 第一卷 名下两条目嵌套在同一 <ol> 内
        let vol1 = nbuf.find("第一卷 风起").expect("volume 1 in nav");
        let ch1 = nbuf.find("第一章 起势").expect("chapter 1 in nav");
        let ch2 = nbuf.find("第二章 破竹").expect("chapter 2 in nav");
        assert!(
            vol1 < ch1 && ch1 < ch2,
            "chapters of volume 1 must nest under volume header"
        );
        assert!(
            nbuf.contains("class=\"nav-volume\""),
            "nav volume must use nav-volume span"
        );
        assert!(
            nbuf.matches("<ol").count() >= 2,
            "each volume must open its own <ol>"
        );
        // 第二卷跟在第一卷的嵌套 <ol> 之后（平级新卷）
        let vol2 = nbuf.find("第二卷 云涌").expect("volume 2 in nav");
        let ch3 = nbuf.find("第三章 合龙").expect("chapter 3 in nav");
        assert!(
            vol2 < ch3 && vol2 > ch2,
            "volume 2 must start after volume 1 chapters"
        );
        // 正文以 <h1 开头则不重复注入章标题
        let x0 = read_entry(&mut zip, "OEBPS/chapter_0.xhtml");
        assert_eq!(
            x0.matches("<h1>第一章 起势</h1>").count(),
            1,
            "chapter title must not be duplicated when content already has h1"
        );
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
                EpubChapter {
                    volume: None,
                    title: "第一章".into(),
                    content: "<p>无图章节一。</p>".into(),
                    cover: None,
                },
                EpubChapter {
                    volume: None,
                    title: "第二章".into(),
                    content: "<p>无图章节二。</p>".into(),
                    cover: None,
                },
            ],
            out.to_string_lossy().to_string(),
        );
        assert!(r.is_ok(), "export failed: {:?}", r.err());
        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
        assert!(
            !names.iter().any(|n| n.starts_with("OEBPS/images/")),
            "no images expected"
        );
        let obuf = read_entry(&mut zip, "OEBPS/content.opf");
        assert!(
            !obuf.contains("<dc:description>"),
            "description must be absent when None"
        );
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
                volume: None,
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
        assert!(
            obuf.contains("A &amp; B &lt;book&gt;"),
            "dc:title must be escaped: {obuf}"
        );
        let nbuf = read_entry(&mut zip, "OEBPS/nav.xhtml");
        assert!(
            nbuf.contains("第1章 &lt;序&gt; &amp; 后记"),
            "nav title must be escaped: {nbuf}"
        );
    }
}

#[cfg(test)]
mod import_tests {
    use super::*;
    use crate::infrastructure::database::connection::Database;
    use crate::infrastructure::database::migration::{init_tables, migrate};
    use std::sync::Mutex;

    fn make_repo() -> Arc<SqliteWritingRepository> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        migrate(&conn).unwrap();
        Arc::new(SqliteWritingRepository::new(Arc::new(Database(
            Mutex::new(conn),
        ))))
    }

    fn write_temp_file(name: &str, content: &str) -> String {
        let dir = std::env::temp_dir().join("sightfolio_import_test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().to_string()
    }

    /// 按章节标题行切分：标题按出现顺序落库，strategy=heading，字数为非空白字符数。
    #[test]
    fn import_splits_by_chapter_headings_in_order() {
        let repo = make_repo();
        let text = "序章\n前情提要只言片语\n第一章 初见\n正文一的内容\n第二章 重逢\n正文二的内容\n";
        let path = write_temp_file("split.txt", text);
        let summary = import_book(path, Some("测试书".into()), &repo).unwrap();

        assert_eq!(summary.strategy, "heading");
        assert_eq!(summary.chapter_count, 3);
        // 序章在首个标题位（index 0），其前无内容 → 无「开篇」

        let chapters = repo.list_chapters(&summary.book_id).unwrap();
        let titles: Vec<&str> = chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["序章", "第一章 初见", "第二章 重逢"]);

        let ch1 = chapters.iter().find(|c| c.title == "第一章 初见").unwrap();
        assert_eq!(ch1.word_count, "正文一的内容".chars().count() as i64);
        assert_eq!(ch1.content, "<p>正文一的内容</p>");
        // 章序稳定：sort_order 按出现顺序
        let mut orders: Vec<i64> = chapters.iter().map(|c| c.sort_order).collect();
        orders.sort();
        assert_eq!(orders, vec![0, 1, 2]);
    }

    /// 首个标题行之前字数 >50 的零散内容归入「开篇」，且排在所有章节之前。
    #[test]
    fn import_preamble_over_fifty_chars_becomes_opener_chapter() {
        let repo = make_repo();
        let preamble = "这是一段足够长的书名页与作者语，".repeat(6); // >50 非空白字符
        let text = format!("{preamble}\n第一章 开始\n正文一\n第二章 继续\n正文二\n");
        let path = write_temp_file("preamble.txt", &text);
        let summary = import_book(path, Some("开篇书".into()), &repo).unwrap();

        assert_eq!(summary.strategy, "heading");
        let chapters = repo.list_chapters(&summary.book_id).unwrap();
        assert_eq!(chapters.first().unwrap().title, "开篇");
        assert_eq!(chapters.len(), 3);
    }

    /// 无章节标题行 → 全书单章，章节名 = 书名。
    #[test]
    fn import_without_headings_falls_back_to_single_chapter() {
        let repo = make_repo();
        let text = "这是一部没有章节结构的散文集。\n第二行也是正文。\n";
        let path = write_temp_file("single.txt", text);
        let summary = import_book(path, Some("散文集".into()), &repo).unwrap();

        assert_eq!(summary.strategy, "single");
        assert_eq!(summary.chapter_count, 1);
        let chapters = repo.list_chapters(&summary.book_id).unwrap();
        assert_eq!(chapters[0].title, "散文集");
        assert_eq!(summary.total_words, chapters[0].word_count);
    }

    /// 标题缺省/空白 → 取文件名主干。
    #[test]
    fn import_title_falls_back_to_file_stem() {
        let repo = make_repo();
        let path = write_temp_file("我的旧稿.txt", "随便一些正文。\n");
        let summary = import_book(path, None, &repo).unwrap();
        assert_eq!(summary.title, "我的旧稿");

        let path2 = write_temp_file("另一个主干.txt", "正文。\n");
        let summary2 = import_book(path2, Some("   ".into()), &repo).unwrap();
        assert_eq!(summary2.title, "另一个主干");
    }

    /// 超过 10MB 上限 → 校验错误，不落库。
    #[test]
    fn import_rejects_oversize_file_without_writing() {
        let repo = make_repo();
        let dir = std::env::temp_dir().join("sightfolio_import_test");
        let path = dir.join("huge.txt");
        let big = "a".repeat(10 * 1024 * 1024 + 1);
        std::fs::write(&path, &big).unwrap();

        let books_before = repo.list_books().unwrap().len();
        let err = import_book(path.to_string_lossy().to_string(), None, &repo).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        assert_eq!(repo.list_books().unwrap().len(), books_before);
        let _ = std::fs::remove_file(&path);
    }

    /// 纯新增导入：既有书籍不受影响，导入书是独立新记录。
    #[test]
    fn import_is_pure_insert_and_keeps_existing_books() {
        let repo = make_repo();
        let existing = WritingBook {
            id: "book_existing".into(),
            title: "既有书".into(),
            description: None,
            genre: String::new(),
            medium: String::new(),
            status: "draft".into(),
            cover_color: "#4A338F".into(),
            daily_goal: 0,
            extra: "{}".into(),
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        };
        repo.save_book(&existing).unwrap();

        let path = write_temp_file("newbook.txt", "第一章 新书\n内容\n");
        let summary = import_book(path, None, &repo).unwrap();

        let books = repo.list_books().unwrap();
        assert_eq!(books.len(), 2);
        assert!(books.iter().any(|b| b.id == "book_existing"));
        assert_ne!(summary.book_id, "book_existing");
        // 既有书的章节数不变（本来为 0）
        assert_eq!(repo.list_chapters("book_existing").unwrap().len(), 0);
        assert_eq!(repo.list_chapters(&summary.book_id).unwrap().len(), 1);
    }
}

#[cfg(test)]
mod setting_revision_restore_tests {
    use super::*;
    use crate::domain::writing::{WritingBook, WritingSetting, WritingSettingRevision};
    use crate::infrastructure::database::connection::Database;
    use crate::infrastructure::database::migration::{init_tables, migrate};
    use std::sync::Mutex;

    fn repo() -> Arc<SqliteWritingRepository> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        migrate(&conn).unwrap();
        Arc::new(SqliteWritingRepository::new(Arc::new(Database(
            Mutex::new(conn),
        ))))
    }

    fn card(id: &str, book_id: &str, desc: &str, extra: &str) -> WritingSetting {
        WritingSetting {
            id: id.into(),
            book_id: book_id.into(),
            kind: "character".into(),
            name: "沈砚".into(),
            subtitle: "青冥剑宗首席弟子".into(),
            description: desc.into(),
            extra: extra.into(),
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        }
    }

    fn revision(id: &str, setting_id: &str, desc: &str, origin: &str) -> WritingSettingRevision {
        WritingSettingRevision {
            id: id.into(),
            setting_id: setting_id.into(),
            book_id: "b1".into(),
            name: "沈砚".into(),
            subtitle: "青冥剑宗首席弟子".into(),
            description: desc.into(),
            extra: "{}".into(),
            origin: origin.into(),
            created_at: 1_700_000_001,
        }
    }

    fn seed_book(r: &SqliteWritingRepository, id: &str) {
        r.save_book(&WritingBook {
            id: id.into(),
            title: "长夜将尽".into(),
            description: None,
            genre: "novel".into(),
            medium: "serial".into(),
            status: "writing".into(),
            cover_color: "#4A338F".into(),
            daily_goal: 0,
            extra: "{}".into(),
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        })
        .unwrap();
    }

    /// 恢复的完整语义：卡回到历史值，**被顶掉的当前值同时进历史**（origin=restore）。
    /// 少了后半句，"点错一次恢复"就变成不可逆操作，而这张表存在的目的正是防止不可逆。
    #[test]
    fn restore_rolls_card_back_and_preserves_the_value_it_replaced() {
        let r = repo();
        seed_book(&r, "b1");
        r.save_setting(&card("s1", "b1", "最初的描述", "{}"))
            .unwrap();
        // 模拟 AI 改写：先把旧值存进历史，再把卡改成新值
        r.save_setting_revision(
            &revision("rev_ai", "s1", "最初的描述", "ai"),
            SETTING_REVISION_KEEP,
        )
        .unwrap();
        r.save_setting(&card("s1", "b1", "AI 改过的描述", "{}"))
            .unwrap();

        let restored = restore_setting_revision("s1", "rev_ai", &r).unwrap();
        assert_eq!(restored.description, "最初的描述", "卡没回到历史值");

        let after = r.get_setting("s1").unwrap().unwrap();
        assert_eq!(after.description, "最初的描述");

        let revs = r.list_setting_revisions("s1", 10).unwrap();
        assert_eq!(revs.len(), 2, "恢复应留下一条历史：{revs:?}");
        let restore_rev = revs
            .iter()
            .find(|x| x.origin == "restore")
            .expect("缺少 origin=restore 的历史");
        assert_eq!(
            restore_rev.description, "AI 改过的描述",
            "存错值：应是被恢复顶掉的那个当前值"
        );
    }

    /// 恢复可反复点：恢复回去之后还能再恢复回来，每一步都有留痕。
    #[test]
    fn restore_is_repeatable_in_both_directions() {
        let r = repo();
        seed_book(&r, "b1");
        r.save_setting(&card("s1", "b1", "版本A", "{}")).unwrap();
        r.save_setting_revision(
            &revision("rev_a", "s1", "版本A", "ai"),
            SETTING_REVISION_KEEP,
        )
        .unwrap();
        r.save_setting(&card("s1", "b1", "版本B", "{}")).unwrap();

        restore_setting_revision("s1", "rev_a", &r).unwrap();
        assert_eq!(r.get_setting("s1").unwrap().unwrap().description, "版本A");
        // 上一步恢复时把"版本B"存进了历史，于是还能恢复回版本B
        let revs = r.list_setting_revisions("s1", 10).unwrap();
        let back = revs
            .iter()
            .find(|x| x.description == "版本B")
            .expect("版本B 应留在历史里");
        restore_setting_revision("s1", &back.id, &r).unwrap();
        assert_eq!(r.get_setting("s1").unwrap().unwrap().description, "版本B");
    }

    /// revision_id 必须属于这张卡：不校验就能拿 A 卡的历史去覆写 B 卡。
    #[test]
    fn restore_rejects_revision_belonging_to_another_card() {
        let r = repo();
        seed_book(&r, "b1");
        r.save_setting(&card("s1", "b1", "一卡", "{}")).unwrap();
        r.save_setting(&card("s2", "b1", "二卡", "{}")).unwrap();
        r.save_setting_revision(
            &revision("rev_s2", "s2", "二卡的旧值", "ai"),
            SETTING_REVISION_KEEP,
        )
        .unwrap();

        let before = r.get_setting("s1").unwrap().unwrap().description;
        let err = restore_setting_revision("s1", "rev_s2", &r).unwrap_err();
        assert!(
            matches!(err, AppError::NotFound(_)),
            "应报 NotFound，实际 {err:?}"
        );
        assert_eq!(
            r.get_setting("s1").unwrap().unwrap().description,
            before,
            "被越权改写了"
        );
    }

    /// 卡不存在 / 历史不存在都要响亮失败，不能静默返回"成功但什么都没做"。
    #[test]
    fn restore_fails_loudly_on_unknown_ids() {
        let r = repo();
        seed_book(&r, "b1");
        r.save_setting(&card("s1", "b1", "描述", "{}")).unwrap();

        assert!(matches!(
            restore_setting_revision("查无此卡", "rev_x", &r).unwrap_err(),
            AppError::NotFound(_)
        ));
        assert!(matches!(
            restore_setting_revision("s1", "查无此历史", &r).unwrap_err(),
            AppError::NotFound(_)
        ));
        // 失败不该留下任何历史记录
        assert!(r.list_setting_revisions("s1", 10).unwrap().is_empty());
    }

    /// 恢复要保住卡的**身份字段**：kind / bookId / sortOrder / createdAt 都不属于历史内容，
    /// 一旦被历史里的旧值带跑，卡会换书、换类型或丢排序。
    #[test]
    fn restore_keeps_identity_fields_untouched() {
        let r = repo();
        seed_book(&r, "b1");
        let mut original = card("s1", "b1", "旧描述", "{}");
        original.kind = "worldbuilding".into();
        original.sort_order = 7;
        original.created_at = 1_600_000_000;
        r.save_setting(&original).unwrap();
        r.save_setting_revision(
            &revision("rev_id", "s1", "旧描述", "ai"),
            SETTING_REVISION_KEEP,
        )
        .unwrap();
        // 模拟改写必须基于原卡改：`save_setting` 是整行 upsert，
        // 用默认夹具重新造一张卡会在"改写"这步就把 kind/sortOrder 冲掉，
        // 那测试就变成在测夹具、而不是测恢复（第一版就栽在这里）。
        let mut edited = original.clone();
        edited.description = "新描述".into();
        r.save_setting(&edited).unwrap();

        let restored = restore_setting_revision("s1", "rev_id", &r).unwrap();
        assert_eq!(restored.kind, "worldbuilding", "卡的类型被历史值带跑了");
        assert_eq!(restored.sort_order, 7, "排序被重置");
        assert_eq!(restored.created_at, 1_600_000_000, "创建时间被改写");
        assert_eq!(restored.book_id, "b1");
    }
}
