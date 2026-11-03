//! 导出任务队列（完结作品重设计 B4，需求 §5.2 + D1/D8）。
//!
//! 一句话模型：**产物表就是任务表**。`enqueue_export` 按格式往 `export_artifacts`
//! 插 `queued` 行，后台调度线程按「同时最多 2 个」（开放项 Q5 默认）领取执行，
//! 成功 `ready` + 回填 `file_size`，失败 `failed` + `error` 可原地重试。
//!
//! 三条不可退让的口径：
//!  ① **渲染只读 `work_version_chapters` 快照，绝不回读活的 `writing_chapters`**
//!     （需求 §5.2-2）。这是「版本不可变」的实际兑现点：书后来改一百章，
//!     从 v1 导出的文件内容仍等于 v1 锁定那一刻（§9 验收 6）。
//!  ② **产物只落作品库**：`<根>/<bookId>/v<seq>/<书名>-v<seq>.<格式>`，库里只存
//!     相对路径 `file_rel_path`（§4）。根目录不可用时不领取任务、不假失败——
//!     读数路径已把真实错误抛给界面（B3），这里排队等待即可。
//!  ③ **重启不留假进行态**：上次进程死掉的 `queued/running` 一律改判
//!     `failed('上次导出被中断')`（§5.2-4），由用户在成品页决定要不要重试。
use crate::application::work_version::library_root;
use crate::application::writing::{export_epub, EpubChapter};
use crate::domain::work_version::{ArtifactView, ExportArtifact, WorkVersionChapter};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::work_version_repository::WorkVersionRepository;
use crate::infrastructure::database::writing_repository::WritingRepository;
use crate::infrastructure::database::{
    SqliteSettingsRepository, SqliteWorkVersionRepository, SqliteWritingRepository,
};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// 作品导出合法格式白名单（需求 §2）。`backup` 被明确排除在外——
/// 整库备份是设置页职责，绝不进作品产物表（§9 验收 11）。
pub const EXPORT_FORMATS: [&str; 6] = ["epub", "pdf", "docx", "html", "md", "txt"];

/// 开放项 Q5 默认值：同时最多 2 个导出任务，其余排队。
pub const MAX_CONCURRENCY: usize = 2;

/// 重启清污写入的失败原因（需求 §5.2-4 的定档文案）。
pub const INTERRUPTED_ERROR: &str = "上次导出被中断";

/// 渠道规格预设列的当前取值（P2 才落地多预设，先把列写实）。
pub const DEFAULT_SPEC_ID: &str = "default";

/// 调度线程轮询间隔。导出是重操作，秒级轮询换实现简单与可测性，够用。
const POLL_INTERVAL_MS: u64 = 600;

/// 归一化格式输入：trim + 小写；不在白名单内返回 None（`backup` 即在此被拒）。
pub fn normalize_format(raw: &str) -> Option<&'static str> {
    let v = raw.trim().to_ascii_lowercase();
    EXPORT_FORMATS.iter().find(|f| **f == v).copied()
}

/// 书名 → 安全的文件名词干。目录只认 bookId（§4），书名只出现在文件名里，
/// 所以路径注入的风险全部收敛在这一步：分隔符、Windows 非法字符、控制字符、
/// 首尾的点与空格（资源管理器会静默吃掉尾巴，导致记录名 ≠ 实际名）统统清洗。
pub fn sanitize_file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        return "作品".to_string();
    }
    trimmed.to_string()
}

/// 产物相对路径规划：`<bookId>/v<seq>/<书名>-v<seq>.<格式>`（需求 §4 布局）。
/// 书名取**入队当时**——之后改名不迁移旧文件、不影响已入队任务的落点（§4 规则）。
pub fn plan_file_rel_path(book_id: &str, seq: i64, title: &str, format: &str) -> String {
    format!(
        "{}/v{}/{}-v{}.{}",
        book_id,
        seq,
        sanitize_file_stem(title),
        seq,
        format
    )
}

/// 入队导出：校验版本存在 + 格式全部合法，然后一格式一条 `queued` 记录。
///
/// 记录一旦落库，任务就与页面无关了——写作台照常写作，成品页可关可开，
/// 后台线程负责把它们做完（§5.2-1「页面不阻塞写作」）。
pub fn enqueue_export(
    versions: &Arc<SqliteWorkVersionRepository>,
    writing: &Arc<SqliteWritingRepository>,
    version_id: &str,
    formats: &[String],
    spec_id: Option<&str>,
) -> AppResult<Vec<ExportArtifact>> {
    let version = versions
        .find_version(version_id)?
        .ok_or_else(|| AppError::NotFound(format!("版本 {version_id} 不存在，无法导出")))?;
    let book = writing
        .get_book(&version.book_id)?
        .ok_or_else(|| AppError::NotFound(format!("作品 {} 已被删除，无法导出其版本", version.book_id)))?;
    if formats.is_empty() {
        return Err(AppError::Validation("至少选择一个导出格式".to_string()));
    }
    // 归一 + 去重（同一次入队里 epub 出现两次没有意义），保持用户给定的先后
    let mut normalized: Vec<&'static str> = Vec::new();
    for raw in formats {
        match normalize_format(raw) {
            Some(f) => {
                if !normalized.contains(&f) {
                    normalized.push(f);
                }
            }
            None => {
                return Err(AppError::Validation(format!(
                    "不支持的导出格式「{raw}」。作品导出只认：{}",
                    EXPORT_FORMATS.join(" / ")
                )))
            }
        }
    }
    let spec = spec_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_SPEC_ID.to_string());
    let now = chrono::Utc::now().timestamp();

    let mut queued = Vec::new();
    for format in normalized {
        let artifact = ExportArtifact {
            id: format!("art_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
            version_id: version_id.to_string(),
            book_id: version.book_id.clone(),
            format: format.to_string(),
            spec_id: spec.clone(),
            file_rel_path: plan_file_rel_path(&version.book_id, version.seq, &book.title, format),
            file_size: 0,
            status: "queued".to_string(),
            error: String::new(),
            origin: "export".to_string(),
            created_at: now,
        };
        versions.insert_artifact(&artifact)?;
        queued.push(artifact);
    }
    Ok(queued)
}

/// 任务面板视图（queued/running/failed）。ready 的是产物不是任务，归产物列表管。
pub fn list_export_jobs(
    versions: &Arc<SqliteWorkVersionRepository>,
) -> AppResult<Vec<ExportArtifact>> {
    versions.list_export_jobs()
}

/// 原地重试（§5.2-3）：只有 failed 能回到 queued。
/// running 拦下是诚实——这一版没有中断线程的能力，放它回队列就是双重执行。
pub fn retry_export_job(versions: &Arc<SqliteWorkVersionRepository>, job_id: &str) -> AppResult<()> {
    let job = versions
        .find_artifact(job_id)?
        .ok_or_else(|| AppError::NotFound(format!("导出任务 {job_id} 不存在")))?;
    match job.status.as_str() {
        "failed" => {
            if !versions.requeue_failed_artifact(job_id)? {
                return Err(AppError::Internal(format!(
                    "任务 {job_id} 重试改态未生效（状态可能被并发改动）"
                )));
            }
            Ok(())
        }
        "ready" => Err(AppError::Validation(
            "产物已生成，不需要重试；如需重做请在版本上重新导出".to_string(),
        )),
        "running" => Err(AppError::Validation("任务正在导出中，请等它结束".to_string())),
        other => Err(AppError::Validation(format!("任务当前状态 {other} 不可重试"))),
    }
}

/// 移除任务记录（§6 dismiss_export_job）。
/// running 不许移除（它还占着并发槽，移了记录线程回来就写不回结局）；
/// ready 不许从这里移除——产物移除是成品页的删除动作（§5.3，带文件处置勾选）。
pub fn dismiss_export_job(versions: &Arc<SqliteWorkVersionRepository>, job_id: &str) -> AppResult<()> {
    let job = versions
        .find_artifact(job_id)?
        .ok_or_else(|| AppError::NotFound(format!("导出任务 {job_id} 不存在")))?;
    match job.status.as_str() {
        "queued" | "failed" => {
            versions.delete_artifact(job_id)?;
            Ok(())
        }
        "running" => Err(AppError::Validation(
            "任务正在导出中，等它结束或失败后再移除".to_string(),
        )),
        other => Err(AppError::Validation(format!(
            "「{other}」不是待处理任务；产物请在成品页删除"
        ))),
    }
}

/// 应用重启清污（§5.2-4）：上次进程残留的 queued/running 全部改判 failed。
/// 在 setup 里、调度线程拉起**之前**调用——顺序反了会先把僵尸任务领起来再自杀。
pub fn fail_interrupted_exports(
    versions: &Arc<SqliteWorkVersionRepository>,
) -> AppResult<i64> {
    versions.fail_interrupted_artifacts(INTERRUPTED_ERROR)
}

/// 产物列表（成品页/徽标用）：join `writing_books` 现取书名，库里没有书名副本。
/// 书已被删除的产物记录直接跳过（不编名字）——这类幽灵行由 B6 的书删除级联清理。
pub fn list_export_artifact_views(
    versions: &Arc<SqliteWorkVersionRepository>,
    writing: &Arc<SqliteWritingRepository>,
    book_id: Option<&str>,
) -> AppResult<Vec<ArtifactView>> {
    let artifacts = versions.list_artifacts(book_id)?;
    let mut views = Vec::new();
    for artifact in artifacts {
        if let Some(book) = writing.get_book(&artifact.book_id)? {
            views.push(ArtifactView {
                artifact,
                book_title: book.title,
            });
        }
    }
    Ok(views)
}

// ─── 并发闸 ───────────────────────────────────────────────────────────────

/// 并发额度（Q5 默认 2）。领到 [ExportSlot] 才能开新任务，槽随任务线程结束自动归还。
///
/// 计数器放 Arc 里：槽位守卫要跟着 std::thread::spawn 进 'static 线程，
/// 借用生命周期版本编译不过（borrowed data escapes），拥有权版本才走得进线程。
pub struct ExportConcurrency {
    max: usize,
    running: Arc<AtomicUsize>,
}

/// 一个已占用的并发槽。归还是 Drop 里写的，忘调 release 这类事故
/// 结构上不可能发生（线程 panic 也一样，Drop 照样跑）。
pub struct ExportSlot {
    running: Arc<AtomicUsize>,
}

impl ExportConcurrency {
    pub fn new(max: usize) -> Self {
        Self { max, running: Arc::new(AtomicUsize::new(0)) }
    }
    pub fn try_acquire(&self) -> Option<ExportSlot> {
        if self.running.fetch_add(1, Ordering::AcqRel) >= self.max {
            self.running.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(ExportSlot { running: self.running.clone() })
    }
    /// 在场任务数（诊断/测试观测点；调度正确性只依赖 try_acquire 的原子闸）。
    #[allow(dead_code)]
    pub fn running(&self) -> usize {
        self.running.load(Ordering::Acquire)
    }
}

impl Drop for ExportSlot {
    fn drop(&mut self) {
        self.running.fetch_sub(1, Ordering::AcqRel);
    }
}

// ─── 任务执行 ─────────────────────────────────────────────────────────────

/// 执行一个已处于 running 的任务：读快照 → 渲染 → 写盘 → 回写结局。
///
/// 同步返回结局（回写 ready/failed 后），调度线程与单测走同一条路；
/// 真正的「后台不阻塞」由 [scheduler_tick] 的线程层提供。
pub fn process_export_job(
    versions: &Arc<SqliteWorkVersionRepository>,
    writing: &Arc<SqliteWritingRepository>,
    job: &ExportArtifact,
    root: &Path,
) -> AppResult<ExportArtifact> {
    match render_job(versions, writing, job, root) {
        Ok(file_size) => {
            versions.update_artifact_outcome(&job.id, "ready", file_size, "")?;
            Ok(ExportArtifact {
                status: "ready".to_string(),
                file_size,
                error: String::new(),
                ..job.clone()
            })
        }
        Err(e) => {
            let msg = e.to_string();
            // 连失败态都写不回时两条错都要见天日，别只留一条
            if let Err(write_err) = versions.update_artifact_outcome(&job.id, "failed", 0, &msg) {
                eprintln!(
                    "[sight-folio] 导出任务 {} 失败态回写也失败：{write_err}（原始失败：{msg}）",
                    job.id
                );
            }
            Err(e)
        }
    }
}

/// 渲染主体。**取数只走版本快照表**；这个函数里出现 `writing_chapters` 就是违规。
fn render_job(
    versions: &Arc<SqliteWorkVersionRepository>,
    writing: &Arc<SqliteWritingRepository>,
    job: &ExportArtifact,
    root: &Path,
) -> AppResult<i64> {
    let version = versions
        .find_version(&job.version_id)?
        .ok_or_else(|| AppError::NotFound(format!("版本 {} 已不存在，任务 {} 无法导出", job.version_id, job.id)))?;
    // 书名/简介在渲染当时从 writing_books 现取（文件名词干已在入队时定格，见 plan_file_rel_path）
    let book = writing
        .get_book(&job.book_id)?
        .ok_or_else(|| AppError::NotFound(format!("作品 {} 已被删除，任务 {} 无法导出", job.book_id, job.id)))?;
    let chapters = versions.list_version_chapters(&job.version_id)?;
    if chapters.is_empty() {
        return Err(AppError::Validation(format!(
            "版本 v{} 的快照内容是空的，拒绝产出空文件",
            version.seq
        )));
    }
    let dest = root.join(&job.file_rel_path);
    render_export_file(&job.format, &book.title, book.description.as_deref(), &chapters, &dest)?;
    let meta = std::fs::metadata(&dest)
        .map_err(|e| AppError::Internal(format!("产物已渲染但 stat 失败 {}: {e}", dest.display())))?;
    Ok(meta.len() as i64)
}

/// 按格式分派渲染并写盘（父目录自动创建）。
/// epub/docx/pdf 复用既有写作导出器；html/txt/md 由本模块的快照渲染器产出。
pub fn render_export_file(
    format: &str,
    title: &str,
    description: Option<&str>,
    chapters: &[WorkVersionChapter],
    dest: &Path,
) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::Internal(format!("无法创建产物目录 {}：{}", parent.display(), e))
        })?;
    }
    let text = match format {
        "epub" => {
            return export_epub(
                title.to_string(),
                description.map(|s| s.to_string()),
                snapshot_to_epub_chapters(chapters),
                dest.to_string_lossy().into_owned(),
            )
        }
        "docx" => {
            return crate::application::writing::docx_export::export_docx(
                title.to_string(),
                description.map(|s| s.to_string()),
                snapshot_to_epub_chapters(chapters),
                dest.to_string_lossy().into_owned(),
            )
        }
        "pdf" => {
            return crate::application::writing::pdf_export::export_pdf(
                title.to_string(),
                description.map(|s| s.to_string()),
                snapshot_to_epub_chapters(chapters),
                dest.to_string_lossy().into_owned(),
            )
        }
        "html" => render_html_book(title, description, chapters),
        "txt" => render_text_book(title, description, chapters),
        "md" => render_markdown_book(title, description, chapters),
        other => {
            return Err(AppError::Validation(format!("渲染器不认识格式「{other}」")))
        }
    };
    std::fs::write(dest, text.as_bytes())
        .map_err(|e| AppError::Internal(format!("写入产物 {} 失败：{e}", dest.display())))
}

/// 快照章节 → 既有导出器载荷。
/// 快照表（需求 §3 DDL）没有 cover/volume 列：章头图与分卷标注在 P0 快照里
/// 本就不存在，如实传空，绝不拿活章节脑补（那正是被禁止的回读）。排版补齐在 P1。
fn snapshot_to_epub_chapters(chapters: &[WorkVersionChapter]) -> Vec<EpubChapter> {
    chapters
        .iter()
        .map(|c| EpubChapter {
            title: c.title.clone(),
            content: c.content.clone(),
            cover: None,
            volume: None,
        })
        .collect()
}

// ─── 后台调度线程 ──────────────────────────────────────────────────────

/// 调度心跳（生产入口）：领任务、开线程、归还槽位。**返回本轮启动的任务数**。
///
/// 注意语义：**「同时最多 2 个」限的是瞬时并发，不是单轮启动数**。
/// 前面的任务秒完、槽位即时归还后，同一个 tick 可以继续补位启动 —— 这是正确行为。
/// 想确定性断言并发上限，走 [scheduler_tick_with_runner] 注入阻塞式执行体。
pub fn scheduler_tick(
    versions: &Arc<SqliteWorkVersionRepository>,
    writing: &Arc<SqliteWritingRepository>,
    settings: &Arc<SqliteSettingsRepository>,
    slots: &ExportConcurrency,
) -> usize {
    scheduler_tick_with_runner(versions, writing, settings, slots, |v, w, job, root| {
        if let Err(e) = process_export_job(v, w, job, root) {
            eprintln!("[sight-folio] 导出任务 {} 失败：{e}", job.id);
        }
    })
}

/// 同一心跳，但任务执行体可注入（测试缝：塞一个阻塞 runner，就能把
/// 「同时在跑的任务数」钉死在闸的值上，行为测不靠 sleep 猜时机）。
pub fn scheduler_tick_with_runner<R>(
    versions: &Arc<SqliteWorkVersionRepository>,
    writing: &Arc<SqliteWritingRepository>,
    settings: &Arc<SqliteSettingsRepository>,
    slots: &ExportConcurrency,
    runner: R,
) -> usize
where
    R: Fn(&Arc<SqliteWorkVersionRepository>, &Arc<SqliteWritingRepository>, &ExportArtifact, &Path) + Send + Sync + 'static,
{
    let root = match library_root::get_works_library_root(settings) {
        Ok(info) => PathBuf::from(info.path),
        Err(e) => {
            eprintln!("[sight-folio] 作品库根不可用，导出任务继续排队：{e}");
            return 0;
        }
    };
    let runner = std::sync::Arc::new(runner);
    let mut started = 0usize;
    while let Some(slot) = slots.try_acquire() {
        match versions.claim_next_queued() {
            Ok(Some(job)) => {
                let (v, w, r, run) = (versions.clone(), writing.clone(), root.clone(), runner.clone());
                std::thread::spawn(move || {
                    let _slot = slot; // 槽位随任务线程结束归还（含 panic 路径）
                    run(&v, &w, &job, &r);
                });
                started += 1;
            }
            Ok(None) => break, // break 时 slot 走 Drop，自动归还
            Err(e) => {
                eprintln!("[sight-folio] 领取导出任务失败：{e}");
                break;
            }
        }
    }
    started
}

/// 生产队列主循环（lib.rs setup 里拉起的后台线程入口）。
pub fn run_queue_loop(
    versions: Arc<SqliteWorkVersionRepository>,
    writing: Arc<SqliteWritingRepository>,
    settings: Arc<SqliteSettingsRepository>,
) {
    let slots = ExportConcurrency::new(MAX_CONCURRENCY);
    loop {
        scheduler_tick(&versions, &writing, &settings, &slots);
        std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
    }
}

// ─── 快照渲染器（html / txt / md）──────────────────────────────────────
//
// 纯函数：输入 = 版本快照（标题 + TipTap HTML 正文），输出 = 产物全文。
// 不查库、不碰文件系统，行为全部可单测证伪。P1 的「导出排版十项」会替换这里的
// 模板细节，但**取数口径（只吃快照）从 P0 起就是死的**。

/// HTML 文本/属性转义（五个实体，与前端 useExportActions 的 esc 同口径）。
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 常用实体反解。`&amp;` 放最后，防止 `&amp;lt;` 被二次解码成 `<`。
fn decode_basic_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&#xA0;", " ")
        .replace("&#xa0;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
}

/// 块级/结构标签：命中就在纯文本里换行。旧前端 txt 用 DOMParser 的
/// textContent，段落会粘连成一行；那是旧毛病，快照渲染器不带走。
fn is_block_boundary_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "ul" | "ol"
            | "blockquote" | "pre" | "br" | "hr" | "tr" | "table" | "figure"
            | "figcaption" | "section" | "article"
    )
}

/// 从标签体开头解析标签名（`p` / `/p` / `h2 class=..` → `p` / `p` / `h2`）。
fn tag_name(tag_body: &str) -> String {
    let t = tag_body.trim().trim_start_matches('/');
    t.chars()
        .take_while(|c| c.is_ascii_alphabetic() || c.is_ascii_digit())
        .collect::<String>()
        .to_lowercase()
}

/// 行整理：去行尾空白；连续空行压成一个（段间距保留）；首尾空行裁掉。
fn normalize_blank_lines(text: &str) -> String {
    let mut lines: Vec<&str> = Vec::new();
    let mut prev_blank = false;
    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            if !prev_blank {
                lines.push("");
            }
            prev_blank = true;
        } else {
            lines.push(trimmed);
            prev_blank = false;
        }
    }
    while lines.first().copied() == Some("") {
        lines.remove(0);
    }
    while lines.last().copied() == Some("") {
        lines.pop();
    }
    lines.join("\n")
}

/// TipTap HTML → 纯文本：剥标签、解实体、块级之间留空行。
fn html_to_plain_text(html: &str) -> String {
    let mut out = String::new();
    let mut tag = String::new();
    let mut in_tag = false;
    // script/style 的字节流不是正文：开标签起跳过，闭标签止
    let mut skip_content = false;
    for c in html.chars() {
        if c == '<' {
            in_tag = true;
            tag.clear();
        } else if c == '>' {
            if in_tag {
                let name = tag_name(&tag);
                if name == "script" || name == "style" {
                    skip_content = !tag.trim_start().starts_with('/');
                } else if !skip_content && is_block_boundary_tag(&name) {
                    out.push('\n');
                }
                in_tag = false;
            } else {
                out.push(c); // 裸 '>'（理论上正文里早已转义）：如实保留
            }
        } else if in_tag {
            tag.push(c);
        } else if !skip_content {
            out.push(c);
        }
    }
    normalize_blank_lines(&decode_basic_entities(&out))
}

/// 整本纯文本：书名 → 简介 → 每章「标题 + 正文」（与前端 txt 结构一致）。
fn render_text_book(title: &str, description: Option<&str>, chapters: &[WorkVersionChapter]) -> String {
    let mut parts: Vec<String> = vec![title.to_string()];
    if let Some(desc) = description.map(str::trim).filter(|d| !d.is_empty()) {
        parts.push(String::new());
        parts.push(desc.to_string());
    }
    for ch in chapters {
        parts.push(String::new());
        parts.push(ch.title.clone());
        parts.push(String::new());
        parts.push(html_to_plain_text(&ch.content));
    }
    let mut text = parts.join("\n");
    text.push('\n');
    text
}

/// 整本自包含 HTML（模板与写作台旧导出同构；P1 排版批次统一升级样式）。
/// 已知边界（P1 处理）：快照里的插画仍是 data-asset / asset:// 引用，
/// 旧前端的 data URI 内联尚未搬进快照渲染器 —— 产物在本机可看图，异地暂不看，不装可移植。
fn render_html_book(title: &str, description: Option<&str>, chapters: &[WorkVersionChapter]) -> String {
    let body = chapters
        .iter()
        .map(|ch| format!("<h2>{}</h2>\n{}", html_escape(&ch.title), ch.content))
        .collect::<Vec<String>>()
        .join("\n<hr/>\n");
    let desc_html = description
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|d| format!("<p class=\"book-desc\">{}</p>", html_escape(d)))
        .unwrap_or_default();
    format!(
        "<!DOCTYPE html>\n\
<html lang=\"zh-CN\">\n\
<head>\n\
<meta charset=\"utf-8\"/>\n\
<title>{title_e}</title>\n\
<style>\n\
  body {{ max-width: 46em; margin: 2em auto; padding: 0 1.5em; font: 16px/1.9 -apple-system, \"PingFang SC\", \"Microsoft YaHei\", serif; color: #1a1a1a; }}\n\
  h1 {{ font-size: 1.8em; text-align: center; margin-bottom: 0.3em; }}\n\
  h2 {{ font-size: 1.3em; margin-top: 2em; }}\n\
  .book-desc {{ text-align: center; color: #666; font-style: italic; }}\n\
  hr {{ border: none; border-top: 1px dashed #ccc; margin: 2.5em 0; }}\n\
  @media print {{ body {{ margin: 0 auto; max-width: none; }} hr {{ page-break-after: always; border: none; }} }}\n\
</style>\n\
</head>\n\
<body>\n\
<h1>{title_e}</h1>\n\
{desc_html}\n\
{body}\n\
</body>\n\
</html>\n",
        title_e = html_escape(title),
    )
}

/// 列表状态（有序列表带当前序号）。
enum MdListKind {
    Unordered,
    Ordered(usize),
}

/// 在块边界处补一个空行（已有尾随换行则收编成恰好一个空行，幂等）。
fn push_blank_break(out: &mut String) {
    if out.is_empty() {
        return;
    }
    while out.ends_with('\n') {
        out.pop();
    }
    out.push('\n');
    out.push('\n');
}

/// 标签属性取值（key="v" / key='v' / key=v，大小写不敏感；取不到回空串）。
/// 值里的实体已反解 —— 图片 src 常以 &amp; 形态存着。
fn get_attr(attrs: &str, key: &str) -> String {
    let chars: Vec<char> = attrs.chars().collect();
    let key_lower = key.to_lowercase();
    let mut i = 0usize;
    while i < chars.len() {
        let mut name = String::new();
        while i < chars.len()
            && (chars[i].is_ascii_alphanumeric() || matches!(chars[i], '-' | '_' | ':'))
        {
            name.push(chars[i]);
            i += 1;
        }
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if !name.is_empty() && i < chars.len() && chars[i] == '=' {
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            let mut value = String::new();
            if i < chars.len() && (chars[i] == '"' || chars[i] == '\'') {
                let quote = chars[i];
                i += 1;
                while i < chars.len() && chars[i] != quote {
                    value.push(chars[i]);
                    i += 1;
                }
                i += 1; // 跳过闭引号（缺闭引号时越界，无副作用）
            } else {
                while i < chars.len() && !chars[i].is_whitespace() {
                    value.push(chars[i]);
                    i += 1;
                }
            }
            if name.to_lowercase() == key_lower {
                return decode_basic_entities(&value);
            }
        }
        // 无论本段是否命中，保证前进：停在非标识符字符上就吞一格
        if i < chars.len()
            && !(chars[i].is_ascii_alphanumeric() || matches!(chars[i], '-' | '_' | ':'))
        {
            i += 1;
        }
    }
    String::new()
}

/// TipTap HTML → Markdown 子集转换器（P0 口径：结构保真，排版精修归 P1）。
/// 支持：h1-h6 / p / div / blockquote / pre>code / ul / ol / li / strong / b /
/// em / i / s / del / a / img / br / hr；其余未知标签脱壳留字（span/mark/u…）。
fn html_to_markdown(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let mut out = String::new();
    let mut lists: Vec<MdListKind> = Vec::new();
    let mut link_hrefs: Vec<String> = Vec::new();
    let mut in_pre = false;
    // script/style 的字节流不是正文（与 html_to_plain_text 同一口径）
    let mut skip_content = false;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '<' {
            if !skip_content {
                out.push(chars[i]);
            }
            i += 1;
            continue;
        }
        // 截取完整标签（TipTap 产物属性里不出现 '>'；遇不到就吃到串尾）
        let mut j = i + 1;
        let mut tag = String::new();
        while j < chars.len() && chars[j] != '>' {
            tag.push(chars[j]);
            j += 1;
        }
        i = j + 1;
        let closing = tag.trim_start().starts_with('/');
        let body: String = tag
            .trim()
            .trim_start_matches('/')
            .trim_end_matches('/')
            .trim()
            .to_string();
        let name: String = body
            .chars()
            .take_while(|c| c.is_ascii_alphabetic() || c.is_ascii_digit())
            .collect::<String>()
            .to_lowercase();
        let attrs = &body[name.len()..];
        match name.as_str() {
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                push_blank_break(&mut out);
                if !closing {
                    let level = name[1..].parse::<usize>().unwrap_or(3);
                    for _ in 0..level {
                        out.push('#');
                    }
                    out.push(' ');
                }
            }
            "p" | "div" | "section" | "article" | "figure" | "figcaption" => {
                push_blank_break(&mut out);
            }
            "blockquote" => {
                push_blank_break(&mut out);
                if !closing {
                    out.push_str("> ");
                }
            }
            "br" => out.push_str("\\\n"), // 反斜杠硬换行：两空格写法会被行尾清理吃掉
            "hr" => {
                push_blank_break(&mut out);
                out.push_str("---");
                push_blank_break(&mut out);
            }
            "pre" => {
                if !closing {
                    push_blank_break(&mut out);
                    out.push_str("```\n");
                    in_pre = true;
                } else {
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                    out.push_str("```");
                    push_blank_break(&mut out);
                    in_pre = false;
                }
            }
            "code" => {
                if !in_pre {
                    out.push('`');
                }
            }
            "strong" | "b" => out.push_str("**"),
            "em" | "i" => out.push('*'),
            "s" | "del" | "strike" => out.push_str("~~"),
            "a" => {
                if !closing {
                    out.push('[');
                    link_hrefs.push(get_attr(attrs, "href"));
                } else if let Some(href) = link_hrefs.pop() {
                    out.push_str(&format!("]({href})"));
                }
            }
            "ul" | "ol" => {
                if !closing {
                    lists.push(if name == "ul" {
                        MdListKind::Unordered
                    } else {
                        MdListKind::Ordered(0)
                    });
                    out.push('\n');
                } else {
                    lists.pop();
                    push_blank_break(&mut out);
                }
            }
            "li" => {
                if !closing {
                    // 嵌套缩进：每层列表两空格（栈顶是当前列表，不计）
                    let indent = "  ".repeat(lists.len().saturating_sub(1));
                    match lists.last_mut() {
                        Some(MdListKind::Ordered(n)) => {
                            *n += 1;
                            out.push_str(&format!("\n{indent}{n}. "));
                        }
                        Some(MdListKind::Unordered) => {
                            out.push_str(&format!("\n{indent}- "));
                        }
                        None => out.push_str("\n- "), // 没套列表容器的裸 li：按无序处理
                    }
                }
            }
            "img" | "image" => {
                if !closing {
                    // data-asset 相对引用比 asset:// 本机协议更可移植，优先用它
                    let data_asset = get_attr(attrs, "data-asset");
                    let src = if data_asset.is_empty() { get_attr(attrs, "src") } else { data_asset };
                    let alt = get_attr(attrs, "alt");
                    push_blank_break(&mut out);
                    out.push_str(&format!("![{alt}]({src})"));
                    push_blank_break(&mut out);
                }
            }
            "script" | "style" => {
                skip_content = !closing;
            }
            _ => {} // 未知标签：脱壳留字（span/mark/u 等），不产出任何记号
        }
    }
    normalize_blank_lines(&decode_basic_entities(&out))
}

/// 整本 Markdown：`# 书名` → 简介引言 → 每章 `## 标题` + 正文转换。
fn render_markdown_book(title: &str, description: Option<&str>, chapters: &[WorkVersionChapter]) -> String {
    let mut parts: Vec<String> = vec![format!("# {title}")];
    if let Some(desc) = description.map(str::trim).filter(|d| !d.is_empty()) {
        parts.push(String::new());
        parts.push(format!("> {desc}"));
    }
    for ch in chapters {
        parts.push(String::new());
        parts.push(format!("## {}", ch.title));
        parts.push(String::new());
        parts.push(html_to_markdown(&ch.content));
    }
    let mut text = parts.join("\n");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::work_version::library_root::WORKS_LIBRARY_ROOT_KEY;
    use crate::application::work_version::lock_version;
    use crate::domain::writing::{WritingBook, WritingChapter};
    use crate::infrastructure::database::{init_tables, migrate, Database};
    use rusqlite::Connection;
    use std::io::Read;
    use std::sync::Mutex;

    /// 每片一个独立临时作品库根，结束即删（不碰 data/，不依赖 $HOME）。
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "sf_b4_{}_{}_{}",
                tag,
                std::process::id(),
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct Harness {
        writing: Arc<SqliteWritingRepository>,
        versions: Arc<SqliteWorkVersionRepository>,
        settings: Arc<SqliteSettingsRepository>,
        root: TempRoot,
    }

    /// 建库走**生产同一套** init_tables + migrate：手抄 schema 会得到假的绿。
    /// 作品库根预置为临时目录 —— 调度路径与生产同一个 get_works_library_root。
    fn harness(tag: &str) -> Harness {
        let db = Arc::new(Database(Mutex::new(Connection::open_in_memory().unwrap())));
        {
            let conn = db.0.lock().unwrap();
            init_tables(&conn).unwrap();
            migrate(&conn).unwrap();
        }
        let settings = Arc::new(SqliteSettingsRepository::new(db.clone()));
        let root = TempRoot::new(tag);
        settings
            .set(WORKS_LIBRARY_ROOT_KEY, &root.0.to_string_lossy())
            .unwrap();
        Harness {
            writing: Arc::new(SqliteWritingRepository::new(db.clone())),
            versions: Arc::new(SqliteWorkVersionRepository::new(db)),
            settings,
            root,
        }
    }

    fn seed_book(h: &Harness, id: &str, title: &str) {
        h.writing
            .save_book(&WritingBook {
                id: id.to_string(),
                title: title.to_string(),
                description: Some("官方简介".to_string()),
                genre: String::new(),
                medium: String::new(),
                status: "ongoing".to_string(),
                cover_color: "#4A338F".to_string(),
                daily_goal: 0,
                extra: "{}".to_string(),
                created_at: 1,
                updated_at: 1,
            })
            .unwrap();
    }

    fn chapter(book_id: &str, id: &str, title: &str, content: &str) -> WritingChapter {
        WritingChapter {
            id: id.to_string(),
            book_id: book_id.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            sort_order: 1,
            word_count: content.chars().count() as i64,
            status: "finished".to_string(),
            volume: String::new(),
            parent_id: None,
            kind: "章".to_string(),
            extra: "{}".to_string(),
            storyline_id: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    /// 种一书一章并锁定 v1，返回版本 id。
    fn lock_one_chapter(h: &Harness, book_id: &str, content: &str) -> String {
        h.writing
            .save_chapter(&chapter(book_id, "c1", "第一章", content))
            .unwrap();
        lock_version(book_id, "", "", false, false, &h.writing, &h.versions)
            .unwrap()
            .id
    }

    fn artifact_row(id: &str, status: &str) -> ExportArtifact {
        ExportArtifact {
            id: id.to_string(),
            version_id: "ver_x".to_string(),
            book_id: "b1".to_string(),
            format: "epub".to_string(),
            spec_id: "default".to_string(),
            file_rel_path: format!("b1/v1/{id}.epub"),
            file_size: 0,
            status: status.to_string(),
            error: String::new(),
            origin: "export".to_string(),
            created_at: 1,
        }
    }

    /// 轮询直到条件成立（后台线程落库有延迟），超时即测失败。
    fn wait_until(what: &str, mut pred: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while !pred() {
            if std::time::Instant::now() > deadline {
                panic!("轮询超时，条件始终未成立：{what}");
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn fmts(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn 入队三种格式_三条queued记录且相对路径就是作品库布局() {
        let h = harness("enqueue");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");

        let queued = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["epub", "md", "txt"]), None).unwrap();

        assert_eq!(queued.len(), 3);
        assert_eq!(
            queued.iter().map(|a| a.format.as_str()).collect::<Vec<_>>(),
            vec!["epub", "md", "txt"],
            "顺序保持用户给定的先后"
        );
        for (a, format) in queued.iter().zip(["epub", "md", "txt"]) {
            assert_eq!(a.status, "queued");
            assert_eq!(a.file_size, 0);
            assert_eq!(a.error, "");
            assert_eq!(a.origin, "export");
            assert_eq!(a.spec_id, DEFAULT_SPEC_ID);
            assert_eq!(a.file_rel_path, format!("b1/v1/测试长篇-v1.{format}"));
            assert!(!a.file_rel_path.starts_with('/'), "库里只存相对路径：{}", a.file_rel_path);
        }
        let stored = h.versions.list_artifacts(Some("b1")).unwrap();
        assert_eq!(stored.len(), 3);
    }

    #[test]
    fn backup与未知格式被白名单拒_重复格式去重_空格式报错() {
        let h = harness("format-guard");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");

        let err = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["backup"]), None);
        assert!(
            matches!(err, Err(AppError::Validation(msg)) if msg.contains("backup")),
            "§9-11：backup 绝不有写入产物表的通路"
        );
        assert!(enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["epub", " PDF ", "pdf"]), None).is_ok());
        let stored = h.versions.list_artifacts(Some("b1")).unwrap();
        assert_eq!(stored.len(), 2); // 前一次失败不落任何行；这次去重后只有 epub+pdf 两条
        // 库读回序按 (created_at, id)（同秒任务由 uuid id 断并列），入队序断言在返回值上做
        let mut formats: Vec<&str> = stored.iter().map(|a| a.format.as_str()).collect();
        formats.sort_unstable();
        assert_eq!(formats, vec!["epub", "pdf"]);

        assert!(matches!(
            enqueue_export(&h.versions, &h.writing, &vid, &fmts(&[]), None),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn 版本不存在时入队报NotFound() {
        let h = harness("ghost-version");
        seed_book(&h, "b1", "测试长篇");
        let err = enqueue_export(&h.versions, &h.writing, "ver_ghost", &fmts(&["epub"]), None);
        assert!(matches!(err, Err(AppError::NotFound(_))), "实际 {err:?}");
        assert!(h.versions.list_artifacts(None).unwrap().is_empty());
    }

    #[test]
    fn 书名注入路径分隔符_清洗后目录层级只剩bookId() {
        assert_eq!(sanitize_file_stem("长/篇:名"), "长_篇_名");
        assert_eq!(sanitize_file_stem("   "), "作品");
        assert_eq!(sanitize_file_stem(".."), "作品");
        assert_eq!(
            plan_file_rel_path("b1", 2, "a/b:c", "md"),
            "b1/v2/a_b_c-v2.md"
        );

        let h = harness("sanitize");
        seed_book(&h, "b1", "../../etc/passwd");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");
        let queued = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md"]), None).unwrap();
        let rel = &queued[0].file_rel_path;
        assert_eq!(rel.split('/').filter(|s| !s.is_empty()).count(), 3, "只有 bookId/vN/文件名 三层：{rel}");
        assert!(rel.split('/').all(|s| s != ".."), "不许出现可回溯目录段：{rel}");
    }

    #[test]
    fn 导出内容只读快照_活章节改稿不影响产物() {
        let h = harness("snapshot-only");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>快照原文A</p>");
        let queued = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md", "txt", "epub"]), None).unwrap();

        // 锁定之后书又改了 —— 产物一个字都不许带上
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "<p>改稿后的新字B</p>"))
            .unwrap();

        let mut done = 0;
        while let Some(job) = h.versions.claim_next_queued().unwrap() {
            process_export_job(&h.versions, &h.writing, &job, &h.root.0).unwrap();
            done += 1;
        }
        assert_eq!(done, 3);

        for job in &queued {
            let path = h.root.0.join(&job.file_rel_path);
            let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("产物未落盘 {path:?}: {e}"));
            let row = h.versions.find_artifact(&job.id).unwrap().unwrap();
            assert_eq!(row.status, "ready", "产物 {} 应回写 ready", job.format);
            assert_eq!(row.file_size, bytes.len() as i64, "file_size 必须回填为真实落盘字节数");

            if job.format == "epub" {
                // §9-6 的原文就是 EPUB：解包读 xhtml，不许只查文件存在
                let file = std::fs::File::open(&path).unwrap();
                let mut archive = zip::ZipArchive::new(file).unwrap();
                let mut xhtml = String::new();
                for idx in 0..archive.len() {
                    let mut entry = archive.by_index(idx).unwrap();
                    if entry.name().ends_with(".xhtml") {
                        entry.read_to_string(&mut xhtml).unwrap();
                    }
                }
                assert!(xhtml.contains("快照原文A"), "EPUB 内容必须等于 v1 快照");
                assert!(!xhtml.contains("改稿后的新字B"), "活章节的新字漏进了产物");
            } else {
                let text = String::from_utf8(bytes).unwrap();
                assert!(text.contains("快照原文A"));
                assert!(!text.contains("改稿后的新字B"), "{} 产物回读了活的写作章节", job.format);
            }
        }
    }

    #[test]
    fn 文件名词干定格入队当时_内容里的书名渲染当时现取() {
        let h = harness("title-timing");
        seed_book(&h, "b1", "原名");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");
        let queued = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md"]), None).unwrap();

        // 导出排队期间改书名：落点不动（§4 规则），正文标题用渲染当时的新名（现取）
        let mut book = h.writing.get_book("b1").unwrap().unwrap();
        book.title = "新名".to_string();
        h.writing.save_book(&book).unwrap();

        let job = h.versions.claim_next_queued().unwrap().unwrap();
        process_export_job(&h.versions, &h.writing, &job, &h.root.0).unwrap();
        let path = h.root.0.join("b1/v1/原名-v1.md");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# 新名"), "内容书名必须现取：{text}");
        assert!(!text.contains("原名"), "旧名只允许出现在文件名里：{text}");
        assert_eq!(queued[0].file_rel_path, "b1/v1/原名-v1.md");
    }

    #[test]
    fn 写盘失败_任务改判failed并留错误原文() {
        let h = harness("write-fail");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");
        enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md"]), None).unwrap();
        // 产物目录路径上放一个同名普通文件：create_dir_all(b1/v1) 必失败
        std::fs::write(h.root.0.join("b1"), b"x").unwrap();

        let job = h.versions.claim_next_queued().unwrap().unwrap();
        let err = process_export_job(&h.versions, &h.writing, &job, &h.root.0);
        assert!(err.is_err());

        let row = h.versions.find_artifact(&job.id).unwrap().unwrap();
        assert_eq!(row.status, "failed");
        assert!(row.error.contains("无法创建产物目录"), "错误要能指认现场：{}", row.error);
        assert_eq!(row.file_size, 0);
    }

    #[test]
    fn 重启残留queued与running一律改判failed_ready与旧账不动() {
        let h = harness("restart");
        for (id, status) in [("a", "queued"), ("b", "running"), ("c", "ready"), ("d", "failed")] {
            let mut row = artifact_row(id, status);
            if status == "ready" {
                row.file_size = 7;
            }
            if status == "failed" {
                row.error = "真实失败原因".to_string();
            }
            h.versions.insert_artifact(&row).unwrap();
        }

        let changed = fail_interrupted_exports(&h.versions).unwrap();

        assert_eq!(changed, 2, "只许改 queued/running 两种假进行态");
        for id in ["a", "b"] {
            let row = h.versions.find_artifact(id).unwrap().unwrap();
            assert_eq!(row.status, "failed");
            assert_eq!(row.error, INTERRUPTED_ERROR);
        }
        let ready = h.versions.find_artifact("c").unwrap().unwrap();
        assert_eq!((ready.status.as_str(), ready.file_size, ready.error.as_str()), ("ready", 7, ""));
        let old_failed = h.versions.find_artifact("d").unwrap().unwrap();
        assert_eq!(old_failed.error, "真实失败原因", "旧失败的真因不许被中断文案覆盖");
    }

    #[test]
    fn 重试只放行failed_移除不碰running与ready() {
        let h = harness("retry-dismiss");
        for (id, status) in [("j_failed", "failed"), ("j_ready", "ready"), ("j_running", "running"), ("j_queued", "queued")] {
            let mut row = artifact_row(id, status);
            if status == "failed" {
                row.error = "上次导出被中断".to_string();
            }
            h.versions.insert_artifact(&row).unwrap();
        }

        retry_export_job(&h.versions, "j_failed").unwrap();
        let row = h.versions.find_artifact("j_failed").unwrap().unwrap();
        assert_eq!((row.status.as_str(), row.error.as_str()), ("queued", ""), "重试必须清掉旧错误");

        assert!(matches!(retry_export_job(&h.versions, "j_ready"), Err(AppError::Validation(_))));
        assert!(matches!(retry_export_job(&h.versions, "j_running"), Err(AppError::Validation(_))));
        assert!(matches!(retry_export_job(&h.versions, "art_ghost"), Err(AppError::NotFound(_))));

        assert!(matches!(dismiss_export_job(&h.versions, "j_running"), Err(AppError::Validation(_))));
        assert!(matches!(dismiss_export_job(&h.versions, "j_ready"), Err(AppError::Validation(_))));
        dismiss_export_job(&h.versions, "j_queued").unwrap();
        assert!(h.versions.find_artifact("j_queued").unwrap().is_none());
        assert!(matches!(dismiss_export_job(&h.versions, "j_queued"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn 领取任务同事务改running_不会被二次领取() {
        let h = harness("claim");
        h.versions.insert_artifact(&artifact_row("k1", "queued")).unwrap();

        let first = h.versions.claim_next_queued().unwrap();
        assert!(first.is_some());
        assert_eq!(first.unwrap().status, "running");
        let reread = h.versions.find_artifact("k1").unwrap().unwrap();
        assert_eq!(reread.status, "running", "库里态必须已经是 running，否则第二个 worker 会重复导出");
        assert!(h.versions.claim_next_queued().unwrap().is_none());
    }

    #[test]
    fn 并发闸_超出上限拒领_归还后可以再领() {
        let slots = ExportConcurrency::new(2);
        let a = slots.try_acquire();
        assert!(a.is_some());
        let b = slots.try_acquire();
        assert!(b.is_some());
        assert!(slots.try_acquire().is_none(), "Q5 默认同时最多 2 个");
        assert_eq!(slots.running(), 2);
        drop(b);
        assert_eq!(slots.running(), 1);
        assert!(slots.try_acquire().is_some());
        // a 仍被持有：函数结束时才归还 —— 归还走 Drop，不需要任何人记得手动 release
    }

    #[test]
    fn 三个任务排队_轮询到全部ready_产物全部落作品库() {
        let h = harness("scheduler");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");
        enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md", "txt", "html"]), None).unwrap();

        let slots = ExportConcurrency::new(MAX_CONCURRENCY);
        // 不预设单轮启动数：并发闸限的是瞬时并发，快任务腾出槽位后同轮补位合法。
        // 「瞬时最多 2 个」由下面的阻塞 runner 测试硬断言。
        for _ in 0..30 {
            scheduler_tick(&h.versions, &h.writing, &h.settings, &slots);
            let ready = h.versions.list_artifacts(Some("b1")).unwrap()
                .iter().filter(|a| a.status == "ready").count();
            if ready == 3 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let rows = h.versions.list_artifacts(Some("b1")).unwrap();
        assert!(
            rows.iter().all(|a| a.status == "ready"),
            "三个任务最终必须全部 ready：{:?}",
            rows.iter().map(|a| (&a.format, &a.status)).collect::<Vec<_>>()
        );
        assert_eq!(std::fs::read_dir(h.root.0.join("b1/v1")).unwrap().count(), 3, "产物真实落在作品库 vN 目录");
    }

    /// 并发上限硬断言：注入「阻塞不还槽」的 runner，闸若失效，第三个任务
    /// 会被同一轮领起 —— started 会大于 2、queued 会清零，两条断言当场翻脸。
    #[test]
    fn 并发闸_两个在场任务未结束时第三个绝不启动() {
        let h = harness("concurrency");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");
        enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md", "txt", "html"]), None).unwrap();

        let (started_tx, started_rx) = std::sync::mpsc::channel::<()>();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let release_rx = std::sync::Mutex::new(release_rx);
        let runner = move |v: &Arc<SqliteWorkVersionRepository>,
                           w: &Arc<SqliteWritingRepository>,
                           job: &ExportArtifact,
                           root: &Path| {
            started_tx.send(()).expect("在场上报");
            // 占住槽位不放（等价「一个慢导出」），解除后才做真正的渲染收尾
            release_rx.lock().unwrap().recv().expect("解除信号");
            process_export_job(v, w, job, root).ok();
        };

        let slots = ExportConcurrency::new(MAX_CONCURRENCY);
        let started = scheduler_tick_with_runner(&h.versions, &h.writing, &h.settings, &slots, runner);

        for _ in 0..MAX_CONCURRENCY {
            started_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("两个任务应进入执行体");
        }
        assert_eq!(started, MAX_CONCURRENCY, "闸上只有 2 个槽，同轮不许领起第三个");
        assert_eq!(slots.running(), MAX_CONCURRENCY);
        let rows = h.versions.list_artifacts(Some("b1")).unwrap();
        assert_eq!(rows.iter().filter(|a| a.status == "queued").count(), 1, "第三个必须还在排队");

        release_tx.send(()).unwrap();
        release_tx.send(()).unwrap();
        wait_until("两个在场任务完成", || {
            h.versions.list_artifacts(Some("b1")).unwrap()
                .iter().filter(|a| a.status == "ready").count() == 2
        });
        wait_until("槽位自动归还", || slots.running() == 0);

        let started2 = scheduler_tick(&h.versions, &h.writing, &h.settings, &slots);
        assert_eq!(started2, 1, "槽位空了，下一个心跳该把排队的第三个领走");
        wait_until("三个任务全部 ready", || {
            h.versions.list_artifacts(Some("b1")).unwrap().iter().all(|a| a.status == "ready")
        });
    }

    #[test]
    fn 格式归一_大小写与空白不影响白名单判定() {
        assert_eq!(normalize_format(" epub "), Some("epub"));
        assert_eq!(normalize_format("EPUB"), Some("epub"));
        assert_eq!(normalize_format("backup"), None);
        assert_eq!(normalize_format(""), None);
    }

    #[test]
    fn txt渲染_断段保形_实体还原_标签不残留() {
        let chapters = vec![WorkVersionChapter {
            version_id: "v".to_string(),
            sort_order: 0,
            src_chapter_id: "c1".to_string(),
            title: "第一章".to_string(),
            content: "<p>甲&amp;乙</p><p>第二段</p><p><em>斜体</em>与<script>鬼鬼鬼</script></p>".to_string(),
            kind: "章".to_string(),
            parent_id: None,
            status: "finished".to_string(),
            word_count: 3,
        }];
        let text = render_text_book("书名", Some("  "), &chapters);
        assert!(text.starts_with("书名\n"), "第一行是书名：{text}");
        assert!(text.contains("甲&乙\n\n第二段"), "段落之间必须有空行（旧 textContent 粘连不带走）：{text}");
        assert!(text.contains("斜体"));
        assert!(!text.contains("鬼鬼鬼"), "script 内容不属于正文");
        assert!(!text.contains('<'), "不许残留标签：{text}");
    }

    #[test]
    fn md渲染_标题加粗两种列表链接图片引用块与代码块() {
        let html = "<h2>章名</h2><p>粗<strong>调</strong>与<em>斜</em></p>\
                    <ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>\
                    <p><a href=\"https://example.com\">链</a></p>\
                    <p><img src=\"asset://本机协议\" data-asset=\"assets/a.png\" alt=\"图\"></p>\
                    <blockquote>引</blockquote><pre><code>let a = 1;</code></pre>";
        let md = html_to_markdown(html);
        assert!(md.contains("## 章名"), "{md}");
        assert!(md.contains("粗**调**与*斜*"), "{md}");
        assert!(md.contains("- a\n- b"), "{md}");
        assert!(md.contains("1. x\n2. y"), "{md}");
        assert!(md.contains("[链](https://example.com)"), "{md}");
        assert!(md.contains("![图](assets/a.png)"), "data-asset 相对引用优先于 asset:// 本机协议：{md}");
        assert!(md.contains("> 引"), "{md}");
        assert!(md.contains("```\nlet a = 1;\n```"), "{md}");
    }

    #[test]
    fn html渲染_书名简介转义_快照正文原样进模板() {
        let chapters = vec![WorkVersionChapter {
            version_id: "v".to_string(),
            sort_order: 0,
            src_chapter_id: "c1".to_string(),
            title: "章<名>".to_string(),
            content: "<p>正文一</p>".to_string(),
            kind: "章".to_string(),
            parent_id: None,
            status: "finished".to_string(),
            word_count: 3,
        }];
        let html = render_html_book("书&名", Some("简<介>"), &chapters);
        assert!(html.contains("<h1>书&amp;名</h1>"));
        assert!(html.contains("<p class=\"book-desc\">简&lt;介&gt;</p>"));
        assert!(html.contains("<h2>章&lt;名&gt;</h2>"));
        assert!(html.contains("<p>正文一</p>"), "快照正文原样嵌入，不做二次加工");
    }

    #[test]
    fn 整本md落盘结构_书名简介章节齐全() {
        let h = harness("md-book");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>快照原文A</p>");
        let queued = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md"]), None).unwrap();
        let job = h.versions.claim_next_queued().unwrap().unwrap();
        process_export_job(&h.versions, &h.writing, &job, &h.root.0).unwrap();
        let text = std::fs::read_to_string(h.root.0.join(&queued[0].file_rel_path)).unwrap();
        assert!(text.starts_with("# 测试长篇\n"));
        assert!(text.contains("> 官方简介"), "简介进引言块：{text}");
        assert!(text.contains("## 第一章"));
        assert!(text.contains("快照原文A"));
    }
}
