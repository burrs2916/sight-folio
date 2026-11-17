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
    let book = writing.get_book(&version.book_id)?.ok_or_else(|| {
        AppError::NotFound(format!("作品 {} 已被删除，无法导出其版本", version.book_id))
    })?;
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
pub fn retry_export_job(
    versions: &Arc<SqliteWorkVersionRepository>,
    job_id: &str,
) -> AppResult<()> {
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
        "running" => Err(AppError::Validation(
            "任务正在导出中，请等它结束".to_string(),
        )),
        other => Err(AppError::Validation(format!(
            "任务当前状态 {other} 不可重试"
        ))),
    }
}

/// 移除任务记录（§6 dismiss_export_job）。
/// running 不许移除（它还占着并发槽，移了记录线程回来就写不回结局）；
/// ready 不许从这里移除——产物移除是成品页的删除动作（§5.3，带文件处置勾选）。
pub fn dismiss_export_job(
    versions: &Arc<SqliteWorkVersionRepository>,
    job_id: &str,
) -> AppResult<()> {
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
pub fn fail_interrupted_exports(versions: &Arc<SqliteWorkVersionRepository>) -> AppResult<i64> {
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

// ─── 产物交付（B4b，需求 §6 / §9 验收 8、10）─────────────────────────────
//
// 「取回」与「复制到其他位置」都要把库里的 `file_rel_path` 解析成作品库根下的
// 绝对路径 —— 这个解析只允许有一个入口。§4 的换根语义（按相对路径在新根下
// 重定位，解析不到 = 文件缺失，而不是报错崩溃）全部收敛在 [resolve_artifact_abs]。

/// 把产物记录解析为作品库根下的绝对路径，并顺手对账（§4 / §9-8 / §9-10）：
/// - 记录不存在 → NotFound；`queued/running` 还没产生物理文件 → Validation；
/// - 文件在：此前被标 `missing`（换根/挪走又还回来）→ 恢复 `ready` 并回填真实大小；
/// - 文件不在：改判 `missing` + 错误原文，并把 NotFound（带绝对路径）原样抛给 UI。
///   这里没有「凭记录假装成功」这一支 —— 「取回定位到的文件与记录一致」（§9-8）。
pub fn resolve_artifact_abs(
    versions: &Arc<SqliteWorkVersionRepository>,
    settings: &SqliteSettingsRepository,
    artifact_id: &str,
) -> AppResult<PathBuf> {
    let artifact = versions
        .find_artifact(artifact_id)?
        .ok_or_else(|| AppError::NotFound(format!("产物 {artifact_id} 不存在，无法取用")))?;
    match artifact.status.as_str() {
        "queued" | "running" => {
            return Err(AppError::Validation(format!(
                "任务还在导出队列里（{}），产物生成后才能取用",
                artifact.status
            )));
        }
        _ => {}
    }
    let root = library_root::get_works_library_root(settings)?;
    let abs = PathBuf::from(root.path).join(&artifact.file_rel_path);
    if let Ok(meta) = std::fs::metadata(&abs) {
        if meta.is_file() {
            if artifact.status != "ready" {
                versions.update_artifact_outcome(artifact_id, "ready", meta.len() as i64, "")?;
            }
            return Ok(abs);
        }
    }
    let msg = format!("文件不在作品库记录的位置：{}", abs.display());
    if artifact.status != "missing" {
        versions.update_artifact_outcome(artifact_id, "missing", 0, &msg)?;
    }
    Err(AppError::NotFound(msg))
}

/// 取回（reveal）用定位：解析出绝对路径。真正的「在文件管理器中高亮」由命令层
/// 走既有 `reveal_in_file_manager` —— 进程派生属于 OS 边界，不掺进业务层。
pub fn reveal_artifact(
    versions: &Arc<SqliteWorkVersionRepository>,
    settings: &SqliteSettingsRepository,
    artifact_id: &str,
) -> AppResult<PathBuf> {
    resolve_artifact_abs(versions, settings, artifact_id)
}

/// 复制到其他位置（§4：交付动作，产物本体留在作品库内不动）。
/// 只读库内文件写到目标，不改 `export_artifacts` 一行 —— 交付副本不是新产物。
pub fn copy_artifact_to(
    versions: &Arc<SqliteWorkVersionRepository>,
    settings: &SqliteSettingsRepository,
    artifact_id: &str,
    dest_path: &str,
) -> AppResult<i64> {
    let src = resolve_artifact_abs(versions, settings, artifact_id)?;
    let trimmed = dest_path.trim();
    let dest = PathBuf::from(trimmed);
    if trimmed.is_empty() || !dest.is_absolute() {
        return Err(AppError::Validation(format!(
            "复制目标必须是绝对路径：{dest_path}"
        )));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::Internal(format!("无法创建目标目录 {}：{e}", parent.display()))
        })?;
    }
    std::fs::copy(&src, &dest)
        .map(|bytes| bytes as i64)
        .map_err(|e| AppError::Internal(format!("复制产物到 {} 失败：{e}", dest.display())))
}

/// §5.3 / §9-12：删版本勾选「同时删除作品库中的产物文件」时，把相对路径对应的
/// 磁盘文件在作品库根下删掉。返回**操作后磁盘上仍存在**的相对路径清单。
///
/// 三条诚实口径：
/// - 文件本就不在（NotFound，用户早已挪走）视为「已消失」，不报错 —— §9-12 的
///   「两者都消失」不要求文件必须由本次操作亲手删掉；
/// - 删除失败（权限/只读卷）把该路径原样计入「仍存在」返回，绝不假装删干净；
/// - 空串、绝对路径、含 `..` 段的路径一律拒拼并计入「仍存在」。正常写入口
///   `plan_file_rel_path` 产不出这类路径，这里只防异常数据借删文件逃出库根。
///
/// 根目录读取失败同样返回「全部仍存在」：记录已在上层事务里删掉，文件确实还在
/// 盘上 —— 把真实情况交还给 UI 提示，而不是吞掉或报错阻断删版本。
pub fn delete_exported_files(
    settings: &SqliteSettingsRepository,
    rel_paths: &[String],
) -> Vec<String> {
    let root = match library_root::get_works_library_root(settings) {
        Ok(info) => info.path,
        Err(_) => return rel_paths.to_vec(),
    };
    let mut remaining = Vec::new();
    for rel in rel_paths {
        let as_path = Path::new(rel);
        let unsafe_rel = rel.is_empty()
            || as_path.is_absolute()
            || as_path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir));
        if unsafe_rel {
            remaining.push(rel.clone());
            continue;
        }
        let abs = PathBuf::from(&root).join(rel);
        match std::fs::remove_file(&abs) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => remaining.push(rel.clone()),
        }
    }
    remaining
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
        Self {
            max,
            running: Arc::new(AtomicUsize::new(0)),
        }
    }
    pub fn try_acquire(&self) -> Option<ExportSlot> {
        if self.running.fetch_add(1, Ordering::AcqRel) >= self.max {
            self.running.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(ExportSlot {
            running: self.running.clone(),
        })
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
    settings: &Arc<SqliteSettingsRepository>,
    job: &ExportArtifact,
    root: &Path,
) -> AppResult<ExportArtifact> {
    match render_job(versions, writing, settings, job, root) {
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

/// 书封现取：素材库 `assets/writing/covers-<bookId>/` 里**最新修改**的那张图片。
///
/// 判据与书架完全同源，不许另立一套：书架走 `assetApi.list('writing', 'covers-<bookId>')`
/// 取首项，而后端 `list_assets` 是 `sort_by(modified DESC)` 后的首项
/// （`commands/asset.rs:163`），BookshelfPage / BookMetaPanel 都按「有文件 = 有封面」渲染。
/// 这里同向排序，产物封面与用户在书架上看到的那一张才是同一张。
///
/// 目录不存在 / 没有图片文件 → `None`：没设封面的书就不该有封面图，不拿色块冒充图。
pub fn resolve_book_cover(book_id: &str) -> Option<String> {
    let dir = crate::infrastructure::database::connection::app_data_dir()
        .join("assets")
        .join("writing")
        .join(format!("covers-{book_id}"));
    let mut files: Vec<(std::time::SystemTime, String)> = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let name = name.to_string();
        let is_image = matches!(
            name.rsplit('.')
                .next()
                .map(|e| e.to_ascii_lowercase())
                .as_deref(),
            Some("png") | Some("jpg") | Some("jpeg") | Some("webp") | Some("gif") | Some("bmp")
        );
        if !is_image {
            continue;
        }
        let Ok(meta) = path.metadata() else { continue };
        let Ok(m) = meta.modified() else { continue };
        files.push((m, name));
    }
    // 与 list_assets 同向：新的在前
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let name = files.into_iter().next()?.1;
    Some(format!("assets/writing/covers-{book_id}/{name}"))
}

/// 渲染主体。**取数只走版本快照表**；这个函数里出现 `writing_chapters` 就是违规。
fn render_job(
    versions: &Arc<SqliteWorkVersionRepository>,
    writing: &Arc<SqliteWritingRepository>,
    settings: &Arc<SqliteSettingsRepository>,
    job: &ExportArtifact,
    root: &Path,
) -> AppResult<i64> {
    let version = versions.find_version(&job.version_id)?.ok_or_else(|| {
        AppError::NotFound(format!(
            "版本 {} 已不存在，任务 {} 无法导出",
            job.version_id, job.id
        ))
    })?;
    // 书名/简介在渲染当时从 writing_books 现取（文件名词干已在入队时定格，见 plan_file_rel_path）
    let book = writing.get_book(&job.book_id)?.ok_or_else(|| {
        AppError::NotFound(format!(
            "作品 {} 已被删除，任务 {} 无法导出",
            job.book_id, job.id
        ))
    })?;
    let chapters = versions.list_version_chapters(&job.version_id)?;
    if chapters.is_empty() {
        return Err(AppError::Validation(format!(
            "版本 v{} 的快照内容是空的，拒绝产出空文件",
            version.seq
        )));
    }
    // 书目元数据装配：作者/出版社/完结日期/ISBN **随版本定格**；题材随书目**现取**。
    // 题材不定格是刻意的 —— 它和书名、简介同口径：作者改了，重导就该跟着变。
    let meta = crate::application::writing::BookMeta {
        author: version.author.clone(),
        publisher: version.publisher.clone(),
        completed_at: version.completed_at.clone(),
        isbn: version.isbn.clone(),
        subject: book.genre.trim().to_string(),
    };
    let dest = root.join(&job.file_rel_path);
    // 书封与书名/简介同源同口径：**渲染当时**从素材库现取（快照管正文，不管书目展示属性）。
    let book_cover = resolve_book_cover(&job.book_id);
    // R4（2026-11-06）：取数只走快照，图片同理 —— 优先用锁定当刻定格的字节。
    // 空表意味着这一版锁在定格机制之前，渲染层会回退去读活资产（历史行为，不静默跳过）。
    let frozen: crate::application::writing::FrozenAssets = versions
        .list_version_assets(&job.version_id)?
        .into_iter()
        .map(|a| {
            (
                a.rel_path,
                crate::application::writing::FrozenAsset {
                    media_type: a.media_type,
                    bytes: a.bytes,
                    missing: a.missing,
                },
            )
        })
        .collect();
    // 版式与书名/简介同口径：**渲染当时**读设置库（作者调完排版重导就该生效）
    let layout =
        crate::application::writing::layout::resolve_from_settings(settings, Some(&job.book_id));
    render_export_file(
        &job.format,
        &book.title,
        book.description.as_deref(),
        &chapters,
        book_cover.as_deref(),
        &layout,
        &frozen,
        &meta,
        // ㉱ E-A′：体裁与书名同口径**现取**（`get_book()` 是刻意的，见上方 R2/F4 注释），
        // 空串 = 旧书没设过体裁 = 小说口径，产物逐字与改造前一致。
        &book.genre,
        &dest,
    )?;
    let meta = std::fs::metadata(&dest).map_err(|e| {
        AppError::Internal(format!("产物已渲染但 stat 失败 {}: {e}", dest.display()))
    })?;
    Ok(meta.len() as i64)
}

/// 按格式分派渲染并写盘（父目录自动创建）。
/// epub/docx/pdf 复用既有写作导出器；html/txt/md 由本模块的快照渲染器产出。
///
/// `book_cover` = 书封相对引用（`assets/writing/covers-<bookId>/` 现取，见
/// [resolve_book_cover]）。当前 EPUB 会把它挂成 `cover-image`（阅读器书架位有图）；
/// PDF/DOCX 的封面页仍是文字版式 —— 那是 P1 余项 #5/#8 的范围，本轮不假装已做。
/// 逐章做结构层规范化。改动条数写进日志——导出成功不代表可以不说自己改了什么，
/// 真正的落处是交付回执（R5-a），这里先把"静默"这一半堵掉。
///
/// ㉱ E-A′（2026-11-11）：日志行的单位词跟着书的体裁走 —— 诗集别再报「章《第 1 首》」。
/// 小说/旧书拿到的仍是「章」（逐字零回归）。
fn normalize_chapters_structure(
    chapters: &[WorkVersionChapter],
    genre: &str,
) -> Vec<WorkVersionChapter> {
    use crate::application::writing::format_html::normalize_structure;
    let unit = crate::application::writing::layout::export_unit_classifier(genre);
    chapters
        .iter()
        .map(|c| {
            // pangu 传 **false**：中西文之间插薄空格等于替作者改字（实测把「快照原文A」
            // 变成「快照原文\u{2009}A」）。这类改动只能由作者在写作侧显式点「一键修」发起，
            // 导出侧只保留零风险的空白/分段规范化，绝不擅自动内容。
            let (content, fx) = normalize_structure(&c.content, false);
            if fx.total() > 0 {
                println!(
                    "[format] {unit}《{}》结构层修正：缩进{} 末空{} 空段{} 多余空格{} 假分段{} 薄空格{}",
                    c.title,
                    fx.leading_indent,
                    fx.trailing_space,
                    fx.empty_para,
                    fx.redundant_space,
                    fx.fake_break,
                    fx.pangu
                );
            }
            WorkVersionChapter { content, ..c.clone() }
        })
        .collect()
}

pub fn render_export_file(
    format: &str,
    title: &str,
    description: Option<&str>,
    chapters: &[WorkVersionChapter],
    book_cover: Option<&str>,
    layout: &crate::application::writing::layout::BookLayoutSpec,
    assets: &crate::application::writing::FrozenAssets,
    meta: &crate::application::writing::BookMeta,
    genre: &str,
    dest: &Path,
) -> AppResult<()> {
    // ㉱ E-A′（2026-11-11）：`genre` = `writing_books.genre` 原值（渲染当时现取，与
    // 书名/简介/版式同口径，见 render_job 里 F4/R2 的注释；空串 = 旧书 = 小说口径）。
    // 到这一层为止「体裁」只有 EPUB 元数据一个消费者；从这里起它进两条判据：
    // ① 结构层日志的量词（normalize_chapters_structure）；② 首行缩进的体裁豁免（诗撤缩进）。
    // 六种格式共用**同一份规范化**；`layout` 的消费者是四支（epub/docx/pdf/html），
    // `assets` 自轮 39 起是五支（+md）。逐支点名列在这里，是因为轮 31 勾「六个渲染分支」
    // 这句数量词时实际只落四支，`txt`/`md` 藏在合计数里 7 轮无人知（N-7 教训）：
    //  · `txt` 不吃 layout/assets —— 纯文本不表达字体度量，图片走 `html_to_plain_text`
    //    整只脱壳、连裸路径都不留（`r39乙` 钉住），拿不到可观测信号；
    //  · `md` 吃 assets、**仍不吃 layout** —— Markdown 缩进四空格会变成代码块。
    // 两支要不要长出体裁信号（量词进标题、缩进…）= 版式决策，台账待拍 P7 同族，
    // 不许在实现轮里顺手造一套没人认的排版；`r39戊` 是这条裁定的锁，接进来它必须红。
    // 判据仍旧只在这一个咽喉做（F3 口径）。

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::Internal(format!("无法创建产物目录 {}：{}", parent.display(), e))
        })?;
    }
    // F3：结构层规范化在**这一个咽喉**做一次，六种格式共用同一份结果。
    // 分散到各渲染器里各改一遍，必然改出六种样子（这次修的就是这个病）。
    let chapters = normalize_chapters_structure(chapters, genre);
    // F4：成书首行缩进按语种定，不再被编辑器预览开关左右；
    // ㉱ E-A′ 起再叠一道体裁闸：诗集任何语种不缩。语种×体裁的裁定本体在
    // layout::finalise_for_book —— 与写作台「另存为」共用同一枚判据（入口不分叉）。
    let all_text: String = chapters
        .iter()
        .map(|c| c.content.as_str())
        .collect::<Vec<&str>>()
        .join("\n");
    let layout = crate::application::writing::layout::finalise_for_book(layout, &all_text, genre);
    let layout = &layout;
    let text = match format {
        "epub" => {
            return export_epub(
                title.to_string(),
                description.map(|s| s.to_string()),
                snapshot_to_epub_chapters(&chapters),
                book_cover.map(str::to_string),
                layout.clone(),
                assets.clone(),
                meta.clone(),
                dest.to_string_lossy().into_owned(),
            )
        }
        "docx" => {
            return crate::application::writing::docx_export::export_docx(
                title.to_string(),
                description.map(|s| s.to_string()),
                snapshot_to_epub_chapters(&chapters),
                layout.clone(),
                assets.clone(),
                meta.clone(),
                dest.to_string_lossy().into_owned(),
            )
        }
        "pdf" => {
            return crate::application::writing::pdf_export::export_pdf(
                title.to_string(),
                description.map(|s| s.to_string()),
                snapshot_to_epub_chapters(&chapters),
                layout.clone(),
                assets.clone(),
                meta.clone(),
                dest.to_string_lossy().into_owned(),
            )
        }
        "html" => render_html_book(title, description, &chapters, assets, meta, layout)?,
        "txt" => render_text_book(title, description, &chapters, meta),
        "md" => render_markdown_book(title, description, &chapters, assets, meta)?,
        other => return Err(AppError::Validation(format!("渲染器不认识格式「{other}」"))),
    };
    std::fs::write(dest, text.as_bytes())
        .map_err(|e| AppError::Internal(format!("写入产物 {} 失败：{e}", dest.display())))
}

/// 快照章节 → 导出载荷：**按目录树先序展平，并把父子关系交给渲染层**。
///
/// 丢层级曾经断在这里（旧实现把快照按 sort_order 平铺、`volume` 写死 None，注释还
/// 写着"快照表本来就没有"）。事实上 `kind` + `parent_id` 从需求 §3 起就一直存在，
/// 缺的只是这一步的消费。两个必须同时修的点：
///
/// 1. **顺序**：`sort_order` 是「同父兄弟内」的序（`writingStore.reparentNode` 取兄弟
///    max+1），跨父级不可比 → 扁平排序会把卷整堆在前面、章跟在后面，与树面板不一致。
///    这里按先序（父紧跟其子）重排，产物顺序 == 目录树可见顺序。
/// 2. **父子**：容器节点（卷/篇/部…）单独成"卷页"，子章带 `depth` 传给渲染层，
///    EPUB 目录 / PDF 目录 / DOCX 导航窗格据此成树。
///
/// 判据不新造：容器 = `kind ∈ {卷, 篇}` 或确有子级，与前端 `utils/writingStats.ts`
/// 的 `STRUCTURE_KINDS` / `isVolumeNode` 同一口径（改一边必须改另一边）。
/// 旧模型书（全书无 parent 且无卷级 kind）走扁平分支，载荷与改动前一致 —— 产物零变化。
fn snapshot_to_epub_chapters(chapters: &[WorkVersionChapter]) -> Vec<EpubChapter> {
    let tree = snapshot_tree_rows(chapters);
    tree.into_iter()
        .map(|row| EpubChapter {
            title: row.title,
            content: row.content,
            cover: row.cover,
            // 结构口径下 volume 字符串一律留空：层级由 depth/is_volume 表达。
            // 再填一份卷名会让渲染层把卷题打两遍（卷页一次、章前一次）。
            volume: None,
            kind: Some(row.kind),
            depth: Some(row.depth),
            is_volume: Some(row.is_volume),
        })
        .collect()
}

/// 渲染层消费的一行结构信息（标题 / 正文 / 自己的封面 / 层级 / 深度 / 是否容器）。
#[derive(Debug, Clone)]
struct SnapshotRow {
    title: String,
    content: String,
    cover: Option<String>,
    kind: String,
    depth: usize,
    is_volume: bool,
}

/// 默认结构层（与前端 `writingStats.ts` 的 `STRUCTURE_KINDS` 同一份词表）：
/// novel → 卷，essay/poetry/script → 篇。创作者自定义的层级靠「确有子级」兜底。
const STRUCTURE_KINDS: [&str; 2] = ["卷", "篇"];

fn is_structure_kind(kind: &str) -> bool {
    STRUCTURE_KINDS.contains(&kind)
}

/// 快照 → 先序结构行。不查库、不碰文件系统，纯函数可单测证伪。
///
/// 输入是 `list_version_chapters` 的 `ORDER BY sort_order ASC` 平铺序；输出先序。
/// 悬空父（父节点在锁定前被清进回收站，快照里只剩子）按根处理：内容一条都不能丢。
fn snapshot_tree_rows(chapters: &[WorkVersionChapter]) -> Vec<SnapshotRow> {
    use std::collections::{HashMap, HashSet};

    // src_chapter_id 为空（裸 SQL 塞的历史行）时用「行序号」兜底做键，保证不互相覆盖
    let key_of = |idx: usize, c: &WorkVersionChapter| {
        if c.src_chapter_id.is_empty() {
            format!("#row{idx}")
        } else {
            c.src_chapter_id.clone()
        }
    };
    let ids: HashSet<String> = chapters
        .iter()
        .enumerate()
        .map(|(idx, c)| key_of(idx, c))
        .collect();
    let has_children: HashSet<String> = chapters
        .iter()
        .filter_map(|c| {
            c.parent_id
                .as_deref()
                .filter(|p| !p.is_empty() && ids.contains(*p))
                .map(str::to_string)
        })
        .collect();
    let is_volume_at = |idx: usize, c: &WorkVersionChapter| {
        is_structure_kind(&c.kind) || has_children.contains(&key_of(idx, c))
    };

    // 旧模型（全书既无有效 parent 也无卷级 kind）：保持平铺，产物与改动前逐字节一致
    let structural = chapters.iter().enumerate().any(|(idx, c)| {
        c.parent_id
            .as_deref()
            .filter(|p| !p.is_empty() && ids.contains(*p))
            .is_some()
            || is_volume_at(idx, c)
    });
    if !structural {
        return chapters
            .iter()
            .map(|c| SnapshotRow {
                title: c.title.clone(),
                content: c.content.clone(),
                cover: (!c.cover.is_empty()).then(|| c.cover.clone()),
                kind: c.kind.clone(),
                depth: 0,
                is_volume: false,
            })
            .collect();
    }

    // 建「父 → 子」邻接表；输入已按 sort_order 升序，push 顺序即兄弟顺序
    let mut children: HashMap<String, Vec<usize>> = HashMap::new();
    let mut roots: Vec<usize> = Vec::new();
    for (idx, c) in chapters.iter().enumerate() {
        let parent = c.parent_id.as_deref().filter(|p| !p.is_empty());
        match parent.filter(|p| ids.contains(*p)) {
            Some(p) => children.entry(p.to_string()).or_default().push(idx),
            // 无父 或 父已不存在（悬空）→ 按根处理，内容不丢
            None => roots.push(idx),
        }
    }

    let mut out: Vec<SnapshotRow> = Vec::with_capacity(chapters.len());
    let mut walked: HashSet<usize> = HashSet::new();
    {
        // 迭代式先序（长篇上万行不赌调用栈深度）
        let mut stack: Vec<(usize, usize)> = roots.iter().rev().map(|&i| (i, 0usize)).collect();
        while let Some((idx, depth)) = stack.pop() {
            if !walked.insert(idx) {
                continue; // 防脏数据成环
            }
            let c = &chapters[idx];
            out.push(SnapshotRow {
                title: c.title.clone(),
                content: c.content.clone(),
                cover: (!c.cover.is_empty()).then(|| c.cover.clone()),
                kind: c.kind.clone(),
                depth,
                is_volume: is_volume_at(idx, c),
            });
            if let Some(kids) = children.get(&key_of(idx, c)) {
                for &kid in kids.iter().rev() {
                    stack.push((kid, depth + 1));
                }
            }
        }
    }
    // 理论上不该发生（每个非根节点的父都在 ids 里）；真发生了也要把内容补齐而不是丢
    for (idx, c) in chapters.iter().enumerate() {
        if walked.insert(idx) {
            out.push(SnapshotRow {
                title: c.title.clone(),
                content: c.content.clone(),
                cover: (!c.cover.is_empty()).then(|| c.cover.clone()),
                kind: c.kind.clone(),
                depth: 0,
                is_volume: is_volume_at(idx, c),
            });
        }
    }
    out
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
    scheduler_tick_with_runner(versions, writing, settings, slots, |v, w, st, job, root| {
        if let Err(e) = process_export_job(v, w, st, job, root) {
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
    R: Fn(
            &Arc<SqliteWorkVersionRepository>,
            &Arc<SqliteWritingRepository>,
            &Arc<SqliteSettingsRepository>,
            &ExportArtifact,
            &Path,
        ) + Send
        + Sync
        + 'static,
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
                let (v, w, st, r, run) = (
                    versions.clone(),
                    writing.clone(),
                    settings.clone(),
                    root.clone(),
                    runner.clone(),
                );
                std::thread::spawn(move || {
                    let _slot = slot; // 槽位随任务线程结束归还（含 panic 路径）
                    // catch_unwind：run 内部任何 panic 都被吞掉，只打日志不进程崩溃。
                    // 任务不会被自动标记 failed（run 自己的 error handling 才做），
                    // 但至少不会让整个 sight-folio 进程被拉下来。
                    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        run(&v, &w, &st, &job, &r);
                    })) {
                        Ok(()) => {}
                        Err(panic) => {
                            let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                                s.to_string()
                            } else if let Some(s) = panic.downcast_ref::<String>() {
                                s.clone()
                            } else {
                                "<unknown panic payload>".to_string()
                            };
                            eprintln!(
                                "[sight-folio] 导出任务 panic（已吞掉，不影响进程）：\n\
                                 job_id={}\nversion_id={}\nformat={}\npayload={}",
                                job.id, job.version_id, job.format, msg
                            );
                        }
                    }
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
        "p" | "div"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "li"
            | "ul"
            | "ol"
            | "blockquote"
            | "pre"
            | "br"
            | "hr"
            | "tr"
            | "table"
            | "figure"
            | "figcaption"
            | "section"
            | "article"
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

/// 整本纯文本：书名 → 简介 → 按目录树先序的「卷题 + 章标题 + 正文」。
///
/// 卷题走分隔线（与写作台 txt 同口径），章标题按深度缩进；**旧模型书（无卷、无父子）
/// 一条卷题都不出、缩进为空**，序列与改动前一致。
fn render_text_book(
    title: &str,
    description: Option<&str>,
    chapters: &[WorkVersionChapter],
    meta: &crate::application::writing::BookMeta,
) -> String {
    let mut parts: Vec<String> = vec![title.to_string()];
    // 署名行（作者 ｜ 出版社）：与 EPUB/PDF/DOCX 同一份判据，没录就整行不出现
    let byline = crate::application::writing::byline_of(meta);
    if !byline.is_empty() {
        parts.push(String::new());
        parts.push(byline);
    }
    if let Some(desc) = description.map(str::trim).filter(|d| !d.is_empty()) {
        parts.push(String::new());
        parts.push(desc.to_string());
    }
    for row in snapshot_tree_rows(chapters) {
        parts.push(String::new());
        if row.is_volume {
            // 卷题只排一次：分隔行本身就带卷名，再补一行同名标题就是重复（实测产物里出现过）
            parts.push(volume_rule(&row.title, row.depth));
            // 卷页带正文（卷首语）才继续排正文，空卷不留"标题 + 空正文"的尾巴
            let body = html_to_plain_text(&row.content);
            if !body.trim().is_empty() {
                parts.push(String::new());
                parts.push(body);
            }
            continue;
        }
        // 章题**不缩进**：缩进属于正文段落，标题按层级顶格排（旧实现按深度缩了标题）
        parts.push(row.title.clone());
        parts.push(String::new());
        parts.push(html_to_plain_text(&row.content));
    }
    let mut text = parts.join("\n");
    text.push('\n');
    text
}

/// txt 卷题分隔行：深度越高分量越轻，纯文本里也能一眼看出父子。
fn volume_rule(name: &str, depth: usize) -> String {
    let rule = match depth {
        0 => "════",
        1 => "────",
        _ => "····",
    };
    format!("{rule} {name} {rule}")
}

/// 整本自包含 HTML（模板与写作台旧导出同构；P1 排版批次统一升级样式）。
///
/// ⚠ 这条「已知边界」已经作废，别再照它下判断（轮 39 对盘）：快照插画自 R4 起在本函数里
/// 过 `inline_images_as_data_uri` 内联成 data URI，产物单文件即可异地看图；轮 39 起 MD 支
/// 也接上同一枚判据。真正还没做的边界只剩「书封不进 txt/md/html 正文」，那在台账另册。
fn render_html_book(
    title: &str,
    description: Option<&str>,
    chapters: &[WorkVersionChapter],
    assets: &crate::application::writing::FrozenAssets,
    meta: &crate::application::writing::BookMeta,
    layout: &crate::application::writing::layout::BookLayoutSpec,
) -> AppResult<String> {
    // 层级 = 2 + 树深度（旧模型全书深度 0 → 仍是 <h2>，序列与改动前一致）；
    // 容器节点带 class="volume"，与写作台另存为同一份口径，不再是「卷章同级一堆 h2」。
    let mut parts: Vec<String> = Vec::new();
    for row in snapshot_tree_rows(chapters) {
        let level = (2 + row.depth).min(6);
        let class = if row.is_volume {
            " class=\"volume\""
        } else {
            ""
        };
        // R4：产物必须自包含。正文里的 `data-asset` 是指向作者机器的相对引用，
        // 原样写进 HTML = 发给别人就打不开图；这里一律内联成 data URI。
        // 缺图时 inline_images_as_data_uri 直接报错点名，宁可不出产物。
        let content =
            crate::application::writing::inline_images_as_data_uri(&row.content, Some(assets))?;
        parts.push(format!(
            "<h{level}{class}>{title}</h{level}>\n{content}",
            level = level,
            class = class,
            title = html_escape(&row.title),
            content = content
        ));
    }
    let body = parts.join("\n<hr/>\n");
    let desc_html = description
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|d| format!("<p class=\"book-desc\">{}</p>", html_escape(d)))
        .unwrap_or_default();

    // 署名行（作者 ｜ 出版社）：判据与 EPUB/PDF/DOCX/TXT/MD 同一个 `byline_of`。
    // 没录就整行不出现 —— 留白比留"作者："空壳诚实。
    let byline = crate::application::writing::byline_of(meta);
    let desc_html = if byline.is_empty() {
        desc_html
    } else {
        format!(
            "<p class=\"byline\">{}</p>\n{}",
            html_escape(&byline),
            desc_html
        )
    };
    // 版式来自作者的排版设置，与 EPUB/PDF/DOCX 同一个 BookLayoutSpec；
    // 「跟随系统」时保留这份历史字体栈 —— 清空 font-family 会让整本书掉进阅读器默认字面。
    const HIST_STACK: &str = r#"-apple-system, "PingFang SC", "Microsoft YaHei", serif"#;
    let body_style = format!(
        r#"  body {{ max-width: 46em; margin: 2em auto; padding: 0 1.5em; color: #1a1a1a;
            font-family: {}; font-size: {}px; line-height: {}; }}"#,
        layout.css_font_family_or(HIST_STACK),
        layout.font_size_px.round(),
        crate::application::writing::layout::css_num(layout.line_height)
    );
    // 段落版式：段距 + 首行缩进（作者没开缩进就是 0）
    let p_style = format!(
        r#"  p {{ margin: 0 0 {}em; text-indent: {}; }}"#,
        crate::application::writing::layout::css_num(layout.para_spacing_em),
        layout.indent_css()
    );
    let html = format!(
        "<!DOCTYPE html>\n\
<html lang=\"zh-CN\">\n\
<head>\n\
<meta charset=\"utf-8\"/>\n\
<title>{title_e}</title>\n\
<style>\n\
{body_style}\n\
  h1 {{ font-size: 1.8em; text-align: center; margin-bottom: 0.3em; }}\n\
  h2 {{ font-size: 1.3em; margin-top: 2em; }}\n\
  h2.volume {{ font-size: 1.5em; text-align: center; color: #4A338F; letter-spacing: 0.15em; margin-top: 0; padding-top: 1.5em; page-break-before: always; }}\n\
  h3 {{ font-size: 1.15em; margin-top: 1.6em; }}\n\
{p_style}\n\
  .byline {{ text-align: center; color: #555; }}\n\
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
    );
    Ok(html)
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
                    // 两级判据，顺序不许反（㉵ E-A′-尾②，2026-11-11 轮 39）：
                    // ① `src` 已经是 `data:` / `http(s):` —— 那是渲染前 `inline_images_as_data_uri`
                    //    打进去的**终值**，必须赢过 `data-asset`。那个内联函数只摘 `src`、
                    //    **保留 `data-asset`**，这里若仍优先读 `data-asset`，产物里就是一行
                    //    指向作者机器应用数据目录的裸相对引用 —— 图离机即碎，等于没修。
                    // ② 其余情形保持旧判据：`src` 还是 `asset://` 本机协议时，`data-asset`
                    //    相对引用更可移植，优先它（存量测试 `md渲染_…` 钉的就是这一级）。
                    let data_asset = get_attr(attrs, "data-asset");
                    let raw_src = get_attr(attrs, "src");
                    let portable = raw_src.starts_with("data:")
                        || raw_src.starts_with("http://")
                        || raw_src.starts_with("https://");
                    let src = if portable {
                        raw_src
                    } else if data_asset.is_empty() {
                        raw_src
                    } else {
                        data_asset
                    };
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

/// 整本 Markdown：`# 书名` → 简介引言 → 按目录树先序的「卷 `##` / 章 `###`」。
///
/// 标题级 = `##` + 树深度（旧模型深度 0 → 仍是 `##`，与改动前一致）；卷节点与其子章
/// 因此天然差一级，Markdown 大纲/编辑器目录树能看到父子。
///
/// ㉵ E-A′-尾②（2026-11-11 轮 39）：正文先过 `inline_images_as_data_uri` 再进
/// `html_to_markdown`，与 HTML 支**共用同一枚判据**（不在这里另写一份内联逻辑）。
/// 改前这里直穿转换器，img 分支只回读 `data-asset`，产物里留的是指向**作者机器**
/// 应用数据目录的裸相对引用 —— 书发给别人、换台机器打开，图就是碎的。缺图与 HTML
/// 同政策：在这里就炸掉并点名文件，宁可不出产物，也不出一个碎图产物。
fn render_markdown_book(
    title: &str,
    description: Option<&str>,
    chapters: &[WorkVersionChapter],
    assets: &crate::application::writing::FrozenAssets,
    meta: &crate::application::writing::BookMeta,
) -> AppResult<String> {
    let mut parts: Vec<String> = vec![format!("# {title}")];
    let byline = crate::application::writing::byline_of(meta);
    if !byline.is_empty() {
        parts.push(String::new());
        parts.push(format!("*{byline}*"));
    }
    if let Some(desc) = description.map(str::trim).filter(|d| !d.is_empty()) {
        parts.push(String::new());
        parts.push(format!("> {desc}"));
    }
    for row in snapshot_tree_rows(chapters) {
        let hashes = "#".repeat((2 + row.depth).min(6));
        parts.push(String::new());
        parts.push(format!("{hashes} {}", row.title));
        parts.push(String::new());
        // 先内联再转换：`html_to_markdown` 的 img 分支拿到 `data:` 终值才会把它打进产物，
        // 顺序反过来就等于把裸引用原样搬进 Markdown（本轮修的就是这个）。
        let content =
            crate::application::writing::inline_images_as_data_uri(&row.content, Some(assets))?;
        parts.push(html_to_markdown(&content));
    }
    let mut text = parts.join("\n");
    text.push('\n');
    Ok(text)
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
        lock_version(
            book_id,
            "",
            "",
            false,
            false,
            &crate::application::work_version::VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap()
        .id
    }

    fn artifact_row(id: &str, status: &str) -> ExportArtifact {
        ExportArtifact {
            id: id.to_string(),
            // version_id 带上 id — 避免同测试里多条 queued/running 记录触发
            // IX_ea_idempotent 唯一索引（UNIQUE version_id+format+spec_id WHERE status IN queued/running）。
            // 生产场景同 version_id 同 format 只会有一条 queued 记录（入队幂等锁），
            // 但测试场景需要多条独立 artifact 验证状态流转，这里拆 version_id。
            version_id: format!("ver_x_{id}"),
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

        let queued = enqueue_export(
            &h.versions,
            &h.writing,
            &vid,
            &fmts(&["epub", "md", "txt"]),
            None,
        )
        .unwrap();

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
            assert!(
                !a.file_rel_path.starts_with('/'),
                "库里只存相对路径：{}",
                a.file_rel_path
            );
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
        assert!(enqueue_export(
            &h.versions,
            &h.writing,
            &vid,
            &fmts(&["epub", " PDF ", "pdf"]),
            None
        )
        .is_ok());
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
        assert_eq!(
            rel.split('/').filter(|s| !s.is_empty()).count(),
            3,
            "只有 bookId/vN/文件名 三层：{rel}"
        );
        assert!(
            rel.split('/').all(|s| s != ".."),
            "不许出现可回溯目录段：{rel}"
        );
    }

    #[test]
    fn 导出内容只读快照_活章节改稿不影响产物() {
        let h = harness("snapshot-only");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>快照原文A</p>");
        let queued = enqueue_export(
            &h.versions,
            &h.writing,
            &vid,
            &fmts(&["md", "txt", "epub"]),
            None,
        )
        .unwrap();

        // 锁定之后书又改了 —— 产物一个字都不许带上
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "<p>改稿后的新字B</p>"))
            .unwrap();

        let mut done = 0;
        while let Some(job) = h.versions.claim_next_queued().unwrap() {
            process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0).unwrap();
            done += 1;
        }
        assert_eq!(done, 3);

        for job in &queued {
            let path = h.root.0.join(&job.file_rel_path);
            let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("产物未落盘 {path:?}: {e}"));
            let row = h.versions.find_artifact(&job.id).unwrap().unwrap();
            assert_eq!(row.status, "ready", "产物 {} 应回写 ready", job.format);
            assert_eq!(
                row.file_size,
                bytes.len() as i64,
                "file_size 必须回填为真实落盘字节数"
            );

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
                assert!(
                    !text.contains("改稿后的新字B"),
                    "{} 产物回读了活的写作章节",
                    job.format
                );
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
        process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0).unwrap();
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
        let err = process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0);
        assert!(err.is_err());

        let row = h.versions.find_artifact(&job.id).unwrap().unwrap();
        assert_eq!(row.status, "failed");
        assert!(
            row.error.contains("无法创建产物目录"),
            "错误要能指认现场：{}",
            row.error
        );
        assert_eq!(row.file_size, 0);
    }

    #[test]
    fn 重启残留queued与running一律改判failed_ready与旧账不动() {
        let h = harness("restart");
        for (id, status) in [
            ("a", "queued"),
            ("b", "running"),
            ("c", "ready"),
            ("d", "failed"),
        ] {
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
        assert_eq!(
            (ready.status.as_str(), ready.file_size, ready.error.as_str()),
            ("ready", 7, "")
        );
        let old_failed = h.versions.find_artifact("d").unwrap().unwrap();
        assert_eq!(
            old_failed.error, "真实失败原因",
            "旧失败的真因不许被中断文案覆盖"
        );
    }

    #[test]
    fn 重试只放行failed_移除不碰running与ready() {
        let h = harness("retry-dismiss");
        for (id, status) in [
            ("j_failed", "failed"),
            ("j_ready", "ready"),
            ("j_running", "running"),
            ("j_queued", "queued"),
        ] {
            let mut row = artifact_row(id, status);
            if status == "failed" {
                row.error = "上次导出被中断".to_string();
            }
            h.versions.insert_artifact(&row).unwrap();
        }

        retry_export_job(&h.versions, "j_failed").unwrap();
        let row = h.versions.find_artifact("j_failed").unwrap().unwrap();
        assert_eq!(
            (row.status.as_str(), row.error.as_str()),
            ("queued", ""),
            "重试必须清掉旧错误"
        );

        assert!(matches!(
            retry_export_job(&h.versions, "j_ready"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            retry_export_job(&h.versions, "j_running"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            retry_export_job(&h.versions, "art_ghost"),
            Err(AppError::NotFound(_))
        ));

        assert!(matches!(
            dismiss_export_job(&h.versions, "j_running"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            dismiss_export_job(&h.versions, "j_ready"),
            Err(AppError::Validation(_))
        ));
        dismiss_export_job(&h.versions, "j_queued").unwrap();
        assert!(h.versions.find_artifact("j_queued").unwrap().is_none());
        assert!(matches!(
            dismiss_export_job(&h.versions, "j_queued"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn 领取任务同事务改running_不会被二次领取() {
        let h = harness("claim");
        h.versions
            .insert_artifact(&artifact_row("k1", "queued"))
            .unwrap();

        let first = h.versions.claim_next_queued().unwrap();
        assert!(first.is_some());
        assert_eq!(first.unwrap().status, "running");
        let reread = h.versions.find_artifact("k1").unwrap().unwrap();
        assert_eq!(
            reread.status, "running",
            "库里态必须已经是 running，否则第二个 worker 会重复导出"
        );
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
        enqueue_export(
            &h.versions,
            &h.writing,
            &vid,
            &fmts(&["md", "txt", "html"]),
            None,
        )
        .unwrap();

        let slots = ExportConcurrency::new(MAX_CONCURRENCY);
        // 不预设单轮启动数：并发闸限的是瞬时并发，快任务腾出槽位后同轮补位合法。
        // 「瞬时最多 2 个」由下面的阻塞 runner 测试硬断言。
        for _ in 0..30 {
            scheduler_tick(&h.versions, &h.writing, &h.settings, &slots);
            let ready = h
                .versions
                .list_artifacts(Some("b1"))
                .unwrap()
                .iter()
                .filter(|a| a.status == "ready")
                .count();
            if ready == 3 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let rows = h.versions.list_artifacts(Some("b1")).unwrap();
        assert!(
            rows.iter().all(|a| a.status == "ready"),
            "三个任务最终必须全部 ready：{:?}",
            rows.iter()
                .map(|a| (&a.format, &a.status))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            std::fs::read_dir(h.root.0.join("b1/v1")).unwrap().count(),
            3,
            "产物真实落在作品库 vN 目录"
        );
    }

    /// 并发上限硬断言：注入「阻塞不还槽」的 runner，闸若失效，第三个任务
    /// 会被同一轮领起 —— started 会大于 2、queued 会清零，两条断言当场翻脸。
    #[test]
    fn 并发闸_两个在场任务未结束时第三个绝不启动() {
        let h = harness("concurrency");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>正文</p>");
        enqueue_export(
            &h.versions,
            &h.writing,
            &vid,
            &fmts(&["md", "txt", "html"]),
            None,
        )
        .unwrap();

        let (started_tx, started_rx) = std::sync::mpsc::channel::<()>();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let release_rx = std::sync::Mutex::new(release_rx);
        let runner = move |v: &Arc<SqliteWorkVersionRepository>,
                           w: &Arc<SqliteWritingRepository>,
                           st: &Arc<SqliteSettingsRepository>,
                           job: &ExportArtifact,
                           root: &Path| {
            started_tx.send(()).expect("在场上报");
            // 占住槽位不放（等价「一个慢导出」），解除后才做真正的渲染收尾
            release_rx.lock().unwrap().recv().expect("解除信号");
            process_export_job(v, w, st, job, root).ok();
        };

        let slots = ExportConcurrency::new(MAX_CONCURRENCY);
        let started =
            scheduler_tick_with_runner(&h.versions, &h.writing, &h.settings, &slots, runner);

        for _ in 0..MAX_CONCURRENCY {
            started_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("两个任务应进入执行体");
        }
        assert_eq!(
            started, MAX_CONCURRENCY,
            "闸上只有 2 个槽，同轮不许领起第三个"
        );
        assert_eq!(slots.running(), MAX_CONCURRENCY);
        let rows = h.versions.list_artifacts(Some("b1")).unwrap();
        assert_eq!(
            rows.iter().filter(|a| a.status == "queued").count(),
            1,
            "第三个必须还在排队"
        );

        release_tx.send(()).unwrap();
        release_tx.send(()).unwrap();
        wait_until("两个在场任务完成", || {
            h.versions
                .list_artifacts(Some("b1"))
                .unwrap()
                .iter()
                .filter(|a| a.status == "ready")
                .count()
                == 2
        });
        wait_until("槽位自动归还", || slots.running() == 0);

        let started2 = scheduler_tick(&h.versions, &h.writing, &h.settings, &slots);
        assert_eq!(started2, 1, "槽位空了，下一个心跳该把排队的第三个领走");
        wait_until("三个任务全部 ready", || {
            h.versions
                .list_artifacts(Some("b1"))
                .unwrap()
                .iter()
                .all(|a| a.status == "ready")
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
            content: "<p>甲&amp;乙</p><p>第二段</p><p><em>斜体</em>与<script>鬼鬼鬼</script></p>"
                .to_string(),
            kind: "章".to_string(),
            parent_id: None,
            status: "finished".to_string(),
            word_count: 3,
            cover: String::new(),
            entry_date: String::new(),
        }];
        let text = render_text_book(
            "书名",
            Some("  "),
            &chapters,
            &crate::application::writing::BookMeta::default(),
        );
        assert!(text.starts_with("书名\n"), "第一行是书名：{text}");
        assert!(
            text.contains("甲&乙\n\n第二段"),
            "段落之间必须有空行（旧 textContent 粘连不带走）：{text}"
        );
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
        assert!(
            md.contains("![图](assets/a.png)"),
            "data-asset 相对引用优先于 asset:// 本机协议：{md}"
        );
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
            cover: String::new(),
            entry_date: String::new(),
        }];
        let html = render_html_book(
            "书&名",
            Some("简<介>"),
            &chapters,
            &crate::application::writing::FrozenAssets::default(),
            &crate::application::writing::BookMeta::default(),
            &crate::application::writing::layout::BookLayoutSpec::default(),
        )
        .unwrap();
        assert!(html.contains("<h1>书&amp;名</h1>"));
        assert!(html.contains("<p class=\"book-desc\">简&lt;介&gt;</p>"));
        assert!(html.contains("<h2>章&lt;名&gt;</h2>"));
        assert!(
            html.contains("<p>正文一</p>"),
            "快照正文原样嵌入，不做二次加工"
        );
    }

    #[test]
    fn 整本md落盘结构_书名简介章节齐全() {
        let h = harness("md-book");
        seed_book(&h, "b1", "测试长篇");
        let vid = lock_one_chapter(&h, "b1", "<p>快照原文A</p>");
        let queued = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["md"]), None).unwrap();
        let job = h.versions.claim_next_queued().unwrap().unwrap();
        process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0).unwrap();
        let text = std::fs::read_to_string(h.root.0.join(&queued[0].file_rel_path)).unwrap();
        assert!(text.starts_with("# 测试长篇\n"));
        assert!(text.contains("> 官方简介"), "简介进引言块：{text}");
        assert!(text.contains("## 第一章"));
        assert!(text.contains("快照原文A"));
    }

    // ─── 产物交付：取回 / 复制（B4b，§9-8 / §9-10）───

    /// 走完一个 txt 任务，返回产物记录（status=ready，文件已在作品库根下）。
    fn ready_txt_artifact(h: &Harness) -> ExportArtifact {
        seed_book(h, "b1", "测试长篇");
        let vid = lock_one_chapter(h, "b1", "<p>快照原文A</p>");
        let queued = enqueue_export(&h.versions, &h.writing, &vid, &fmts(&["txt"]), None).unwrap();
        let job = h.versions.claim_next_queued().unwrap().unwrap();
        process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0).unwrap();
        h.versions.find_artifact(&queued[0].id).unwrap().unwrap()
    }

    #[test]
    fn 取回解析到作品库根下绝对路径_就绪记录不误改() {
        let h = harness("reveal-ok");
        let art = ready_txt_artifact(&h);

        let abs = reveal_artifact(&h.versions, &h.settings, &art.id).unwrap();

        assert_eq!(
            abs,
            h.root.0.join(&art.file_rel_path),
            "§9-8：定位必须落在根下记录路径"
        );
        let after = h.versions.find_artifact(&art.id).unwrap().unwrap();
        assert_eq!(
            after.status, "ready",
            "文件本来就在，状态不许被取回动作搅乱"
        );
        assert_eq!(after.file_size, art.file_size);
    }

    #[test]
    fn 排队与进行中的任务不可取回() {
        let h = harness("reveal-pending");
        for status in ["queued", "running"] {
            let row = artifact_row(&format!("art_{status}"), status);
            h.versions.insert_artifact(&row).unwrap();
            let err = reveal_artifact(&h.versions, &h.settings, &row.id);
            assert!(
                matches!(err, Err(AppError::Validation(_))),
                "{status} 态没有物理产物，必须拦下而不是指空气：{err:?}"
            );
        }
        assert!(
            matches!(
                copy_artifact_to(&h.versions, &h.settings, "art_missing_id", "/tmp/x.txt"),
                Err(AppError::NotFound(_))
            ),
            "不存在的产物记录如实 NotFound"
        );
    }

    #[test]
    fn 文件被挪走_取回改判missing并带路径抛错() {
        let h = harness("reveal-missing");
        let art = ready_txt_artifact(&h);
        let file = h.root.0.join(&art.file_rel_path);
        std::fs::remove_file(&file).unwrap(); // 模拟用户手动挪走/删掉产物

        let err = reveal_artifact(&h.versions, &h.settings, &art.id);
        assert!(
            matches!(err, Err(AppError::NotFound(ref msg)) if msg.contains(&art.file_rel_path)),
            "§9-10：解析不到必须带具体路径如实抛错，不静默：{err:?}"
        );
        let after = h.versions.find_artifact(&art.id).unwrap().unwrap();
        assert_eq!(after.status, "missing", "改判缺失，成品页据此显示文件缺失");
        assert!(
            after.error.contains(&art.file_rel_path),
            "错误原文入库可回溯"
        );
    }

    #[test]
    fn 缺失文件回位_再取回恢复ready并回填真实大小() {
        let h = harness("reveal-restore");
        let art = ready_txt_artifact(&h);
        let file = h.root.0.join(&art.file_rel_path);
        let bytes = std::fs::read(&file).unwrap();
        std::fs::remove_file(&file).unwrap();
        assert!(reveal_artifact(&h.versions, &h.settings, &art.id).is_err());
        assert_eq!(
            h.versions.find_artifact(&art.id).unwrap().unwrap().status,
            "missing"
        );

        std::fs::write(&file, &bytes).unwrap(); // 用户又放回来了
        let abs = reveal_artifact(&h.versions, &h.settings, &art.id).unwrap();

        assert_eq!(abs, file);
        let after = h.versions.find_artifact(&art.id).unwrap().unwrap();
        assert_eq!(
            after.status, "ready",
            "文件回位后取回成功就必须自愈回 ready"
        );
        assert_eq!(
            after.file_size,
            bytes.len() as i64,
            "缺失期被清零的大小要回填"
        );
    }

    #[test]
    fn 换根后按相对路径重定位_新根有同名文件即恢复() {
        // §9-10 主案：修改作品库根 → 产物按 file_rel_path 在新根下解析。
        let h = harness("reveal-relocate");
        let art = ready_txt_artifact(&h);
        let bytes = std::fs::read(h.root.0.join(&art.file_rel_path)).unwrap();

        let new_root = TempRoot::new("reveal-relocate-new");
        h.settings
            .set(WORKS_LIBRARY_ROOT_KEY, &new_root.0.to_string_lossy())
            .unwrap();

        assert!(
            matches!(
                reveal_artifact(&h.versions, &h.settings, &art.id),
                Err(AppError::NotFound(_))
            ),
            "新根下没有这个文件：缺失，而不是继续指向旧根"
        );
        // 把整个相对路径结构搬进新根（等价于用户把作品库文件夹整个拷走）
        let dest = new_root.0.join(&art.file_rel_path);
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, &bytes).unwrap();

        let abs = reveal_artifact(&h.versions, &h.settings, &art.id).unwrap();
        assert_eq!(abs, dest, "换根后解析必须走新根");
        assert_eq!(
            h.versions.find_artifact(&art.id).unwrap().unwrap().status,
            "ready"
        );
    }

    #[test]
    fn 复制到其他位置_字节一致且库内记录与本体不动() {
        let h = harness("copy-to");
        let art = ready_txt_artifact(&h);
        let src = h.root.0.join(&art.file_rel_path);
        let src_before = std::fs::read(&src).unwrap();
        let dest = h.root.0.join("_交付").join("给人看的副本.txt"); // 故意放库里子目录外，验证只读不写库

        let copied =
            copy_artifact_to(&h.versions, &h.settings, &art.id, &dest.to_string_lossy()).unwrap();

        assert_eq!(copied as usize, src_before.len(), "回执字节数 = 真实复制量");
        assert_eq!(
            std::fs::read(&dest).unwrap(),
            src_before,
            "副本内容必须与库内产物逐字节一致"
        );
        assert_eq!(
            std::fs::read(&src).unwrap(),
            src_before,
            "§4：交付动作不许碰库内本体"
        );
        let after = h.versions.find_artifact(&art.id).unwrap().unwrap();
        assert_eq!(after, art, "§4：复制不产生新产物记录、不改旧记录");
    }

    #[test]
    fn 复制目标必须绝对路径否则拒绝() {
        let h = harness("copy-reject");
        let art = ready_txt_artifact(&h);
        for bad in ["", "   ", "交付/副本.txt"] {
            assert!(
                matches!(
                    copy_artifact_to(&h.versions, &h.settings, &art.id, bad),
                    Err(AppError::Validation(_))
                ),
                "相对/空目标路径必须拒：{bad:?}"
            );
        }
        // 被拒的相对路径不许有任何落盘副作用
        assert!(!h.root.0.join("交付").exists());
    }

    // ─── 目录树父子联动（2026-11-06：卷和章不再各排各的）────────────────
    //
    // 夹具按库里真实形态造：卷 1-4 排 sort_order 1-4，章 5-7 排 5-7，章的 parent_id
    // 指向卷。**扁平排序 = 卷整堆在最前面**，正是李先生报的「不按目录树排序」，
    // 所以这些用例断言的是消费侧有没有把先序与父子关系重建出来。

    fn tree_snapshot_with_cover(cover: &str) -> Vec<WorkVersionChapter> {
        let mk = |so: i64,
                  id: &str,
                  title: &str,
                  parent: Option<&str>,
                  kind: &str,
                  content: &str,
                  cover: &str| WorkVersionChapter {
            version_id: "v_tree".to_string(),
            sort_order: so,
            src_chapter_id: id.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            kind: kind.to_string(),
            parent_id: parent.map(str::to_string),
            status: "draft".to_string(),
            word_count: content.chars().count() as i64,
            cover: cover.to_string(),
            entry_date: String::new(),
        };
        vec![
            mk(
                1,
                "v1",
                "卷 1",
                None,
                "卷",
                "<p>卷首语：风从海上来。</p>",
                cover,
            ),
            mk(2, "v2", "卷 2", None, "卷", "", ""),
            mk(3, "v3", "卷 3", None, "卷", "", ""),
            mk(4, "v4", "卷 4", None, "卷", "", ""),
            mk(5, "c1", "章 1", Some("v1"), "章", "<p>正文一。</p>", ""),
            mk(6, "c2", "章 2", Some("v1"), "章", "<p>正文二。</p>", ""),
            mk(7, "c3", "章 3", Some("v2"), "章", "<p>正文三。</p>", ""),
        ]
    }

    fn tree_snapshot() -> Vec<WorkVersionChapter> {
        tree_snapshot_with_cover("assets/writing/illustrations/vol1.png")
    }

    #[test]
    fn 作者的排版设置真的落进产物_epub与docx同源于设置库() {
        use crate::application::writing::layout;
        let h = harness("typo_r1");
        seed_book(&h, "b1", "版式之书");
        let vid = lock_one_chapter(&h, "b1", "<p>正文一段。</p>");

        // 全局默认：18px / 行距 2.0 / 段距 1em / 开了首行缩进 / 宋体 + Georgia
        h.settings
            .set(
                layout::GLOBAL_TYPOGRAPHY_KEY,
                r#"{"fontSize":18,"lineHeight":2.0,"paraSpacing":1,"indent":true,"fontFamily":"song","latinFontFamily":"georgia"}"#,
            )
            .unwrap();
        // 书级覆盖：只把这本书字号单独调到 22（其余字段必须继续跟随全局）
        h.settings
            .set(
                layout::BOOK_TYPOGRAPHY_KEY,
                r#"{"version":1,"overrides":{"b1":{"fontSize":22}}}"#,
            )
            .unwrap();

        enqueue_export(
            &h.versions,
            &h.writing,
            &vid,
            &fmts(&["epub", "docx", "pdf"]),
            None,
        )
        .unwrap();
        for _ in 0..3 {
            let job = h.versions.claim_next_queued().unwrap().unwrap();
            let art =
                process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0).unwrap();
            assert_eq!(art.status, "ready", "任务要真跑成，不能悄悄失败");
        }

        let read_entry = |abs: &std::path::Path, name: &str| -> String {
            let f = std::fs::File::open(abs).expect("产物必须存在");
            let mut zip = zip::ZipArchive::new(f).unwrap();
            let mut buf = String::new();
            if let Ok(mut rf) = zip.by_name(name) {
                let _ = std::io::Read::read_to_string(&mut rf, &mut buf);
            }
            assert!(!buf.is_empty(), "条目 {name} 要真在包里");
            buf
        };

        let arts = h.versions.list_artifacts(Some("b1")).unwrap();
        let epub = arts
            .iter()
            .find(|a| a.format == "epub")
            .unwrap()
            .file_rel_path
            .clone();
        let docx = arts
            .iter()
            .find(|a| a.format == "docx")
            .unwrap()
            .file_rel_path
            .clone();

        // ── EPUB：书级 22px + 全局行距/段距/缩进 + 中西文双栈 ──
        let css = read_entry(&h.root.0.join(&epub), "OEBPS/style.css");
        assert!(css.contains("font-size: 22px"), "书级字号要落进产物：{css}");
        assert!(
            css.contains("line-height: 2;"),
            "未单独调的行距继续跟全局 2.0：{css}"
        );
        assert!(css.contains("text-indent: 2em"), "开了首行缩进才缩：{css}");
        assert!(
            css.contains("'Georgia'") && css.contains("'Songti SC'"),
            "西文栈在前、中文栈在后：{css}"
        );
        assert!(css.contains("margin: 0 0 22px;"), "段距 1em × 22px：{css}");

        // ── DOCX：同一份版式换算成 OOXML 单位（22px × 0.75 = 16.5pt → 17pt = 34 半磅）──
        let styles = read_entry(&h.root.0.join(&docx), "word/styles.xml");
        assert!(
            styles.contains(r#"<w:sz w:val="33"/>"#),
            "DOCX 字号必须跟设置：22px = 16.5pt = 33 半磅：{styles}"
        );
        // 结构完好性：spacing 自封后才是 ind，二者是 pPr 的兄弟（曾经把 ind 拼进 spacing 内部，
        // 产出的是坏 OOXML —— Word 打不开，而单测只看数字对不上是不够的）
        assert!(
            styles.contains(r#"w:lineRule="auto"/><w:ind w:firstLineChars="200"/>"#),
            "w:ind 必须是 w:pPr 的独立子元素：{styles}"
        );
        assert!(
            !styles.contains(r#"auto" <w:ind"#),
            "不许出现未闭合的 spacing：{styles}"
        );
        assert!(
            styles.contains(r#"w:firstLineChars="200""#),
            "DOCX 首行缩进 2 字符（200 = 2 个字符，Word 的字符单位）：{styles}"
        );
        assert!(
            styles.contains("w:line=\"480\""),
            "行距 2.0 × 240 = 480：{styles}"
        );

        // ── PDF：字号必须真出现在内容流的 Tf 算子里（22px = 16.5pt）──
        // 只断「文件生成成功」不够：版式没接进去时文件照样生成，只是字号还是历史那个值。
        let pdf_rel = arts
            .iter()
            .find(|a| a.format == "pdf")
            .unwrap()
            .file_rel_path
            .clone();
        let raw = std::fs::read(h.root.0.join(&pdf_rel)).expect("PDF 产物必须存在");
        let pdf_text = String::from_utf8_lossy(&raw).to_string();
        assert!(
            pdf_text.contains("/F1 16.5 Tf"),
            "PDF 正文要用作者的字号（16.5pt = 22px），仍是 11 就说明版式没接进来"
        );
        // 章题字号必须跟正文**等比**走（历史 15pt / 正文 11pt）：作者把正文调到 16.5pt 后
        // 章题应到 22.5pt。这才是真判据 —— 只换正文不换层级，章题会比正文还小。
        // （封面页与目录页仍是各自校准的 11/12pt 版面家具值，本轮有意不动。我第一版
        //   断的是「不许出现 /F1 11 Tf」，把家具值误当成正文残留 —— 记着别再犯。）
        assert!(
            pdf_text.contains("/F1 22.5 Tf"),
            "章题必须随正文字号等比放大（16.5 × 15/11 = 22.5pt）"
        );
    }

    // ─── R4 定格资产进导出（2026-11-06）─────────────────────────────
    //
    // 这三条锁的是同一件事：**产物只认锁定当刻定格的字节**。
    // 用例里的引用在磁盘上**故意不存在**，跑通即证明导出没有偷偷回读活资产；
    // 墓碑那条则证明缺图会失败并点名 —— 宁可不产出，也不出「看着成功但少图」的书。

    fn frozen_map(
        rel: &str,
        bytes: Vec<u8>,
        media: &str,
        missing: bool,
    ) -> crate::application::writing::FrozenAssets {
        let mut map = crate::application::writing::FrozenAssets::new();
        map.insert(
            rel.to_string(),
            crate::application::writing::FrozenAsset {
                media_type: media.to_string(),
                bytes,
                missing,
            },
        );
        map
    }

    fn row_with_image(rel: &str) -> Vec<WorkVersionChapter> {
        vec![WorkVersionChapter {
            version_id: "v_freeze".to_string(),
            sort_order: 0,
            src_chapter_id: "c1".to_string(),
            title: "第一章".to_string(),
            content: format!(r#"<p>正文</p><img data-asset="{rel}" src="asset://x"/>"#),
            kind: "章".to_string(),
            parent_id: None,
            status: "draft".to_string(),
            word_count: 2,
            cover: String::new(),
            entry_date: String::new(),
        }]
    }

    /// 一个磁盘上绝不存在的引用：能导出就说明走的是定格件
    const GONE_REL: &str = "assets/writing/illustrations/此文件已删除.png";

    #[test]
    fn 源文件已删产物仍完整_epub用定格件_html自包含() {
        assert!(
            !std::path::Path::new(GONE_REL).exists(),
            "前提：这条引用在磁盘上不存在"
        );
        let dir =
            std::env::temp_dir().join(format!("sf_frozen_out_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = b"\x89PNG\r\n\x1a\n fake".to_vec();
        let frozen = frozen_map(GONE_REL, png.clone(), "image/png", false);
        let rows = row_with_image(GONE_REL);

        // EPUB：包内必须真带这张图
        let epub = dir.join("book.epub");
        render_export_file(
            "epub",
            "定格之书",
            None,
            &rows,
            None,
            &crate::application::writing::layout::BookLayoutSpec::default(),
            &frozen,
            &crate::application::writing::BookMeta::default(),
            "",
            &epub,
        )
        .expect("图已定格，源文件删了也必须能导出");
        let f = std::fs::File::open(&epub).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
        assert!(
            names
                .iter()
                .any(|n| n.starts_with("OEBPS/images/") && n.ends_with(".png")),
            "定格件要真的进包：{names:?}"
        );

        // HTML：必须内联成 data URI（产物自包含），不能留指向作者机器的裸引用
        let html = render_html_book(
            "定格之书",
            None,
            &rows,
            &frozen,
            &crate::application::writing::BookMeta::default(),
            &crate::application::writing::layout::BookLayoutSpec::default(),
        )
        .unwrap();
        assert!(
            html.contains("data:image/png;base64,"),
            "HTML 要自包含：{html}"
        );
        assert!(
            !html.contains(&format!("src=\"{GONE_REL}\"")),
            "不许残留裸相对引用：{html}"
        );
        assert!(
            !html.contains("asset://"),
            "编辑器占位 src 也要一并换掉：{html}"
        );

        // 同一张图的字节确实被打进去了（大小对得上，不是空文件）
        let mut zip2 = zip::ZipArchive::new(std::fs::File::open(&epub).unwrap()).unwrap();
        let mut found = false;
        for i in 0..zip2.len() {
            let mut rf = zip2.by_index(i).unwrap();
            if rf.name().starts_with("OEBPS/images/") {
                let mut buf = Vec::new();
                std::io::Read::read_to_end(&mut rf, &mut buf).unwrap();
                assert_eq!(buf, png, "包内字节必须等于定格字节");
                found = true;
            }
        }
        assert!(found, "images/ 里要能找到那张图");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 轮 39 金样夹具：一卷两章（含列表），**全支无图** —— 无图是刻意的：
    /// 有图那一半的账由 `r39丙 / r39丁` 两条缺陷锁单独管，不许混进零回归基线。
    fn r39_gold_rows() -> Vec<WorkVersionChapter> {
        let mk =
            |so: i64, id: &str, title: &str, parent: Option<&str>, kind: &str, content: &str| {
                WorkVersionChapter {
                    version_id: "v_gold".to_string(),
                    sort_order: so,
                    src_chapter_id: id.to_string(),
                    title: title.to_string(),
                    content: content.to_string(),
                    kind: kind.to_string(),
                    parent_id: parent.map(str::to_string),
                    status: "finished".to_string(),
                    word_count: content.chars().count() as i64,
                    cover: String::new(),
                    entry_date: String::new(),
                }
            };
        vec![
            mk(0, "v1", "卷·上部", None, "卷", "<p>卷首语。</p>"),
            mk(
                1,
                "c1",
                "第一章",
                Some("v1"),
                "章",
                "<p>甲段</p><p>乙段</p>",
            ),
            mk(
                2,
                "c2",
                "第二章",
                Some("v1"),
                "章",
                "<p>丙段</p><ul><li>一</li><li>二</li></ul>",
            ),
        ]
    }

    /// 从**咽喉**（`render_export_file`）取产物文本：金样锁与缺陷锁共用这一道取物口径。
    /// 金样钉在咽喉而不是直连渲染器，是因为它的签名跨改动稳定，而且结构层规范化
    /// （`normalize_structure`）与版式咽喉（`finalise_for_book`）都在这道口之后才发生。
    fn r39_render_via_throat(
        fmt: &str,
        rows: &[WorkVersionChapter],
        assets: &crate::application::writing::FrozenAssets,
        genre: &str,
    ) -> String {
        let dir =
            std::env::temp_dir().join(format!("sf_r39_{}_{}", uuid::Uuid::new_v4().simple(), fmt));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join(format!("book.{fmt}"));
        let r = render_export_file(
            fmt,
            "金样书",
            Some("一句简介"),
            rows,
            None,
            &crate::application::writing::layout::BookLayoutSpec::default(),
            assets,
            &crate::application::writing::BookMeta::default(),
            genre,
            &out,
        );
        let text = match r {
            Ok(()) => std::fs::read_to_string(&out).unwrap(),
            Err(e) => panic!("{fmt} 咽喉导出失败：{e}"),
        };
        let _ = std::fs::remove_dir_all(&dir);
        text
    }

    /// ㉲ E-A′-尾 · **零回归金样**：txt / md 两支无图产物的逐字基线。
    ///
    /// 两串字面量不是手搓的，是**改前**跑咽喉抓出来的（`.tmp/r39/cargo_probe2.log`）。
    /// 本轮改的是「MD 图片内联」，无图那一支一个字都不许漂。它同时把轮 38 那条范围裁定
    /// 从注释里的说法变成跑得起来的东西：`layout` / `genre` 不进这两支 ⇒ 谁将来给纯文本或
    /// Markdown 接版式、接体裁量词，必须先让这两串红，再明确改判据。
    #[test]
    fn r39金样_txt与md无图产物逐字对拍() {
        const GOLD_TXT: &str = "金样书\n\n一句简介\n\n════ 卷·上部 ════\n\n卷首语。\n\n第一章\n\n甲段\n\n乙段\n\n第二章\n\n丙段\n\n一\n\n二\n";
        const GOLD_MD: &str = "# 金样书\n\n> 一句简介\n\n## 卷·上部\n\n卷首语。\n\n### 第一章\n\n甲段\n\n乙段\n\n### 第二章\n\n丙段\n\n- 一\n- 二\n";
        let rows = r39_gold_rows();
        let empty = crate::application::writing::FrozenAssets::default();
        assert_eq!(r39_render_via_throat("txt", &rows, &empty, ""), GOLD_TXT);
        assert_eq!(r39_render_via_throat("md", &rows, &empty, ""), GOLD_MD);
    }

    /// ㉲ E-A′-尾② · **真缺陷锁**：MD 产物里的插画必须像 HTML 那样自包含。
    ///
    /// 改前形态（本轮要灭掉的）：`render_markdown_book` 直穿 `html_to_markdown`，img 分支
    /// 只回读 `data-asset`，产物里留下一条指向**作者机器**应用数据目录的裸相对引用 ——
    /// 书发给别人、换台机器打开，图就是碎的。HTML 支在 `render_html_book` 里早已过
    /// `inline_images_as_data_uri`，两支从此共用同一枚判据。
    #[test]
    fn r39丙_md产物图片必须内联成data_uri_与html支同一判据() {
        assert!(
            !std::path::Path::new(GONE_REL).exists(),
            "前提：这条引用在磁盘上不存在"
        );
        let png = b"\x89PNG\r\n\x1a\n fake".to_vec();
        let frozen = frozen_map(GONE_REL, png, "image/png", false);
        let rows = row_with_image(GONE_REL);

        let md = r39_render_via_throat("md", &rows, &frozen, "");
        assert!(
            md.contains("data:image/png;base64,"),
            "MD 产物必须自包含：{md}"
        );
        assert!(
            !md.contains(GONE_REL),
            "不许残留指向作者机器的裸相对引用：{md}"
        );
        assert!(
            !md.contains("asset://"),
            "编辑器占位 src 也要一并换掉：{md}"
        );

        // 同一枚判据的另一张嘴：HTML 支逐字同构（两处各写一遍就是真源分身）
        let html = r39_render_via_throat("html", &rows, &frozen, "");
        assert!(
            html.contains("data:image/png;base64,"),
            "HTML 支对照组：{html}"
        );
    }

    /// ㉳ E-A′-尾② · **缺图政策与 HTML 对齐**：宁可不出产物，也不出一个碎图产物。
    ///
    /// 锁定当刻就缺的那张图（墓碑 `missing = true`）必须让任务失败，而且错误要点名是哪个
    /// 文件 —— 作者拿到「导出失败」却不知道哪张图坏了，等于没拿到错误。
    #[test]
    fn r39丁_md缺图与html同政策_失败点名文件不留半截产物() {
        let dir =
            std::env::temp_dir().join(format!("sf_r39_gap_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let frozen = frozen_map(GONE_REL, Vec::new(), "image/png", true);
        let out = dir.join("book.md");
        let err = render_export_file(
            "md",
            "缺图书",
            None,
            &row_with_image(GONE_REL),
            None,
            &crate::application::writing::layout::BookLayoutSpec::default(),
            &frozen,
            &crate::application::writing::BookMeta::default(),
            "",
            &out,
        )
        .expect_err("锁定当刻就缺的图必须让 MD 导出失败，不许出碎图产物");
        assert!(
            err.to_string().contains(GONE_REL),
            "错误要点名是哪个文件，否则作者无从下手：{err}"
        );
        assert!(!out.exists(), "失败了就不该留下半截文件：{out:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ㉴ E-A′-尾① · **裁定锁**：体裁信号不进 txt / md 两支的正文。
    ///
    /// `genre` 在咽喉处只有两个消费者：结构层**日志**的量词（`export_unit_classifier` 只
    /// `println!`）和首行缩进的体裁豁免（`finalise_for_book` → `layout`）。而纯文本不表达
    /// 字体度量、Markdown 缩进四空格会变代码块 ⇒ 这两支**拿不到可观测的体裁信号**。
    /// 这条锁钉的是"本轮裁定"而非"永远如此"：将来要把量词/缩进接进来，它必须红，
    /// 迫使改的人先拍板（台账待拍 P7 同族），而不是顺手改出一套没人认的排版。
    #[test]
    fn r39戊_txt与md产物不长了体裁量词_裁定在册() {
        let rows = r39_gold_rows();
        let empty = crate::application::writing::FrozenAssets::default();
        for fmt in ["txt", "md"] {
            let novel = r39_render_via_throat(fmt, &rows, &empty, "novel");
            let poetry = r39_render_via_throat(fmt, &rows, &empty, "poetry");
            let diary = r39_render_via_throat(fmt, &rows, &empty, "diary");
            assert_eq!(
                novel, poetry,
                "{fmt} 支不该因体裁漂字：若真要漂，先拍板再改这条"
            );
            assert_eq!(
                novel, diary,
                "{fmt} 支不该因体裁漂字：若真要漂，先拍板再改这条"
            );
        }
    }

    /// ㉲ E-A′-尾①（2026-11-11 轮 39）：txt 支的图片**本来就不产裸引用** ——
    /// `html_to_plain_text` 整只脱壳（`img` 不在 `is_block_boundary_tag` 里，连换行都不留），
    /// 所以轮 38 那句「txt/md 不接 assets」在纯文本这边**没有可证明的错误产物**。
    /// 这条锁钉的是"txt 不许长出裸路径"：将来谁给 txt 加图片输出，必须显式改判据并过这条。
    #[test]
    fn r39乙_txt产物不残留图片裸引用() {
        let rows = row_with_image(GONE_REL);
        let text = render_text_book(
            "定格之书",
            None,
            &rows,
            &crate::application::writing::BookMeta::default(),
        );
        assert!(
            !text.contains(GONE_REL),
            "txt 不许把指向作者机器的相对引用打进产物：{text}"
        );
        assert!(!text.contains("asset://"), "本机协议占位不许进产物：{text}");
        assert!(!text.contains("<"), "不许残留标签：{text}");
    }

    #[test]
    fn docx与pdf也只认定格件_不许偷偷回读活盘() {
        // 用真 PNG（docx 要解尺寸），但引用名在磁盘上**不存在**：
        // 三个格式现在都走 read_asset_bytes，若哪一个还偷偷读活盘，这里就会失败而不是成功。
        // 真 PNG（1×1 RGBA，构造出来的合法文件）：docx 要解尺寸，假字节会让它走不通
        let png: Vec<u8> = vec![
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 96, 96,
            248, 15, 0, 1, 4, 1, 0, 95, 229, 195, 75, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ];
        assert!(
            image::load_from_memory(&png).is_ok(),
            "测试用的 PNG 必须合法"
        );
        let frozen = frozen_map(GONE_REL, png.clone(), "image/png", false);
        let dir =
            std::env::temp_dir().join(format!("sf_frozen_all_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let lay = crate::application::writing::layout::BookLayoutSpec::default();
        let rows = row_with_image(GONE_REL);

        let docx = dir.join("book.docx");
        render_export_file(
            "docx",
            "定格之书",
            None,
            &rows,
            None,
            &lay,
            &frozen,
            &crate::application::writing::BookMeta::default(),
            "novel",
            &docx,
        )
        .expect("docx 要用定格件导出");
        let zip = zip::ZipArchive::new(std::fs::File::open(&docx).unwrap()).unwrap();
        let media: Vec<String> = zip
            .file_names()
            .filter(|n| n.starts_with("word/media/"))
            .map(|s| s.to_string())
            .collect();
        assert!(
            media.iter().any(|n| n.ends_with(".png")),
            "docx 要真带图：{media:?}"
        );

        let pdf = dir.join("book.pdf");
        render_export_file(
            "pdf",
            "定格之书",
            None,
            &rows,
            None,
            &lay,
            &frozen,
            &crate::application::writing::BookMeta::default(),
            "novel",
            &pdf,
        )
        .expect("pdf 要用定格件导出");
        assert!(std::fs::metadata(&pdf)
            .map(|m| m.len() > 1024)
            .unwrap_or(false));

        // 同一张图缺了（墓碑）→ 两个格式都不许静默出残书
        let gap = frozen_map(GONE_REL, Vec::new(), "image/png", true);
        for fmt in ["docx", "pdf"] {
            let out = dir.join(format!("gap.{fmt}"));
            let err = match render_export_file(
                fmt,
                "缺图书",
                None,
                &rows,
                None,
                &lay,
                &gap,
                &crate::application::writing::BookMeta::default(),
                "novel",
                &out,
            ) {
                Ok(()) => panic!("{fmt} 不许静默丢图 —— 缺图必须让任务失败"),
                Err(e) => e,
            };
            assert!(
                err.to_string().contains(GONE_REL),
                "{fmt} 缺图要点名：{err}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 书封是现取资源_有定格件的版本设过封面也要能导出() {
        // 回归锁：书封曾被拿去做定格查表，于是"版本有定格资产 + 作者设了书封"
        // 这种**最常见的真实组合**会报「图没随本版本定格」而导出失败。
        // 书封与书名/简介同口径 = 渲染当时现取，不许走定格判定。
        let dir =
            std::env::temp_dir().join(format!("sf_livecover_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let png: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let frozen = frozen_map(GONE_REL, png.clone(), "image/png", false); // 定格表**非空**
        let rows = row_with_image(GONE_REL);

        let out = dir.join("with-cover.epub");
        // 书封文件自己造在临时目录里（不依赖 /tmp 下的外部文件，也不碰真实素材库）。
        // 它**不在定格表里** —— 按现取口径应能读到；按被修正掉的错误定格口径会直接报"没定格"。
        let live_cover = dir.join("live-cover.png");
        std::fs::write(
            &live_cover,
            [0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].as_slice(),
        )
        .unwrap();
        render_export_file(
            "epub",
            "有封面的书",
            None,
            &rows,
            Some(&live_cover.to_string_lossy()),
            &crate::application::writing::layout::BookLayoutSpec::default(),
            &frozen,
            &crate::application::writing::BookMeta::default(),
            "novel",
            &out,
        )
        .expect("书封现取不该被定格表拦住");
        assert!(out.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 墓碑缺图必须让任务失败并点名文件() {
        let dir =
            std::env::temp_dir().join(format!("sf_frozen_gap_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let frozen = frozen_map(GONE_REL, Vec::new(), "image/png", true);
        let out = dir.join("book.epub");
        let r = render_export_file(
            "epub",
            "缺图书",
            None,
            &row_with_image(GONE_REL),
            None,
            &crate::application::writing::layout::BookLayoutSpec::default(),
            &frozen,
            &crate::application::writing::BookMeta::default(),
            "",
            &out,
        );
        let err = r.expect_err("锁定当刻就缺的图必须让导出失败，不许出残图产物");
        let msg = err.to_string();
        assert!(
            msg.contains(GONE_REL),
            "错误要点名是哪个文件，否则作者无从下手：{msg}"
        );
        assert!(!out.exists(), "失败了就不该留下半截文件：{out:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 书目元数据随版本定格并写进epub_空值不许被编出来() {
        let h = harness("meta_r2");
        seed_book(&h, "b1", "元数据之书");
        // 先种一章（lock_version 要求至少有一章有正文，空书会被拒）
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "<p>正文一段。</p>"))
            .unwrap();
        let meta = crate::application::work_version::VersionMeta {
            author: "张三丰".to_string(),
            publisher: "星海文艺社".to_string(),
            completed_at: "2026-11-06".to_string(),
            isbn: "978-7-000-12345-6".to_string(),
        };
        let version = crate::application::work_version::lock_version(
            "b1",
            "交稿版",
            "",
            false,
            false,
            &meta,
            &h.writing,
            &h.versions,
        )
        .unwrap();
        assert_eq!(
            version.author, "张三丰",
            "元数据要真的进版本头（不是只活在对话框里）"
        );

        enqueue_export(&h.versions, &h.writing, &version.id, &fmts(&["epub"]), None).unwrap();
        let job = h.versions.claim_next_queued().unwrap().unwrap();
        process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0)
            .expect("带元数据的导出必须成功");
        let art = h
            .versions
            .list_artifacts(Some("b1"))
            .unwrap()
            .into_iter()
            .find(|a| a.format == "epub")
            .unwrap();
        let raw = std::fs::read(h.root.0.join(&art.file_rel_path)).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(raw)).unwrap();
        let read = |zip: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>, name: &str| {
            let mut buf = String::new();
            if let Ok(mut f) = zip.by_name(name) {
                use std::io::Read;
                let _ = f.read_to_string(&mut buf);
            }
            buf
        };
        let opf = read(&mut zip, "OEBPS/content.opf");
        let cover = read(&mut zip, "OEBPS/cover.xhtml");

        assert!(
            opf.contains("<dc:creator>张三丰</dc:creator>"),
            "作者要进 dc:creator：{opf}"
        );
        assert!(
            opf.contains("<dc:publisher>星海文艺社</dc:publisher>"),
            "出版社要进 OPF：{opf}"
        );
        assert!(
            opf.contains("<dc:date>2026-11-06</dc:date>"),
            "完结日期要进 dc:date：{opf}"
        );
        assert!(
            opf.contains("urn:ISBN:978-7-000-12345-6"),
            "ISBN 要进标识符：{opf}"
        );
        assert!(
            !opf.contains("<dc:creator>Sight Folio"),
            "软件名不许再冒充作者"
        );
        assert!(
            cover.contains("作者：张三丰") && cover.contains("ISBN：978-7-000-12345-6"),
            "扉页要排版权行：{cover}"
        );
    }

    #[test]
    fn 署名行进全部六种产物_没录的作者不许被编出来() {
        use crate::application::work_version::VersionMeta;
        let h = harness("byline_r2");
        seed_book(&h, "b1", "署名之书");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "<p>正文一段。</p>"))
            .unwrap();

        let v1 = crate::application::work_version::lock_version(
            "b1",
            "交稿版",
            "",
            false,
            false,
            &VersionMeta {
                author: "张三丰".to_string(),
                publisher: "星海文艺社".to_string(),
                completed_at: String::new(),
                isbn: String::new(),
            },
            &h.writing,
            &h.versions,
        )
        .unwrap();
        // 第二版：作者留空 —— 用来验"不许编"
        let v2 = crate::application::work_version::lock_version(
            "b1",
            "修订版",
            "",
            false,
            true,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        let all = ["epub", "docx", "html", "txt", "md", "pdf"];
        enqueue_export(&h.versions, &h.writing, &v1.id, &fmts(&all), None).unwrap();
        while let Some(job) = h.versions.claim_next_queued().unwrap() {
            process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0)
                .unwrap_or_else(|e| panic!("{} 导出失败：{e}", job.format));
        }
        let read_all = |vid: &str, fmt: &str| -> Vec<u8> {
            let art = h
                .versions
                .list_artifacts(Some("b1"))
                .unwrap()
                .into_iter()
                .find(|a| a.version_id == vid && a.format == fmt)
                .unwrap_or_else(|| panic!("缺 {fmt} 产物"));
            std::fs::read(h.root.0.join(&art.file_rel_path)).unwrap()
        };

        // ── 文本类：直接能搜到署名 ──
        let txt = String::from_utf8(read_all(&v1.id, "txt")).unwrap();
        assert!(
            txt.contains("作者：张三丰") && txt.contains("星海文艺社"),
            "txt 署名行：{txt}"
        );
        let md = String::from_utf8(read_all(&v1.id, "md")).unwrap();
        assert!(md.contains("作者：张三丰"), "md 署名行：{md}");
        let html_raw = read_all(&v1.id, "html");
        let html = String::from_utf8(html_raw).unwrap();
        assert!(
            html.contains("<p class=\"byline\">作者：张三丰"),
            "html 要带署名段落：{html}"
        );

        // ── 压缩包类：解一层再搜 ──
        let zip_text = |vid: &str, fmt: &str, member: &str| -> String {
            let mut z = zip::ZipArchive::new(std::io::Cursor::new(read_all(vid, fmt))).unwrap();
            let mut buf = String::new();
            use std::io::Read;
            if let Ok(mut f) = z.by_name(member) {
                let _ = f.read_to_string(&mut buf);
            }
            buf
        };
        assert!(
            zip_text(&v1.id, "docx", "word/document.xml").contains("作者：张三丰"),
            "docx 扉页要带署名行"
        );

        // ── 空作者的第二版：任何产物都不许出现"作者：" ──
        enqueue_export(
            &h.versions,
            &h.writing,
            &v2.id,
            &fmts(&["html", "txt", "md"]),
            None,
        )
        .unwrap();
        while let Some(job) = h.versions.claim_next_queued().unwrap() {
            process_export_job(&h.versions, &h.writing, &h.settings, &job, &h.root.0)
                .unwrap_or_else(|e| panic!("{} 导出失败：{e}", job.format));
        }
        for fmt in ["html", "txt", "md"] {
            let body = String::from_utf8(read_all(&v2.id, fmt)).unwrap();
            assert!(!body.contains("作者："), "{fmt} 里不许凭空冒出作者行");
        }
        // PDF 的字形做了子集化，正文不是可搜的 UTF-8 文本，因此只锁"带元数据能出片"；
        // 署名内容正确性由 `byline_of` 的单测与其余五种格式共同兜住。
    }

    /// 人工目测样本（`cargo test -- --ignored` 手动跑，不进常规回归）：
    /// 用真实正文形态产出 html/pdf/docx 三件产物，浏览器打开截图看排版到底差在哪。
    #[test]
    #[ignore = "产出 /tmp 目测样本用，非断言测试"]
    fn dump_visual_samples_for_browser_review() {
        use crate::application::writing::layout::BookLayoutSpec;
        use crate::application::writing::{BookMeta, FrozenAssets};
        let dir = std::path::Path::new("/tmp/sf_visual");
        std::fs::create_dir_all(dir).unwrap();
        // 真实内容形态：段首手工硬空格、半角标点、无缩进、长段、中英混排无空格
        let row =
            |so: i64, id: &str, title: &str, parent: Option<&str>, kind: &str, content: &str| {
                WorkVersionChapter {
                    version_id: "v_vis".to_string(),
                    sort_order: so,
                    src_chapter_id: id.to_string(),
                    title: title.to_string(),
                    content: content.to_string(),
                    kind: kind.to_string(),
                    parent_id: parent.map(str::to_string),
                    status: "draft".to_string(),
                    word_count: content.chars().count() as i64,
                    cover: String::new(),
                    entry_date: String::new(),
                }
            };
        let chapters = vec![
            row(1, "vol1", "卷 一 · 风从海上来", None, "卷", ""),
            row(
                2,
                "c1",
                "第一章 离港",
                Some("vol1"),
                "章",
                "<p>&nbsp; &nbsp; &nbsp; &nbsp; 她一连说了十几声谢谢,一声比一声轻,到最后连自己都听不见了。船离港那天没有风,海面平得像一块刚打磨过的青石,只有缆绳绞紧时发出的钝响提醒人这是要出事了。</p><p>&nbsp; &nbsp; 他站在尾楼上看岸上的人越来越小,最后连同整座港一起被潮气抹平。跟船的老周说,头一回出海都这样,吐完了就学会看风了。</p><p>他没有说话,把怀里的帆布包抱得更紧了些。包里有母亲缝进去的两件换洗衣裳、半块干饼,还有一封他没能送出去的信。</p><p>&nbsp; &nbsp; 第三天起了风,浪从船舷两侧翻上来,咸味一直溅到嘴里。他吐了三次,第四次的时候居然觉得有些饿。   </p><p>老周递给他半块饼,说:这就叫上船了。他咬了一口,饼硬得像木头,嚼了半天才嚼出一点麦香。他忽然很想家,可是家里已经没有等的人了。</p>",
            ),
            row(3, "c2", "第二章 风暴", Some("vol1"), "章", "<p>&nbsp;&nbsp;夜里起了大风,帆被撕开一道口子,像一面破旗在 mast 上乱抖。</p>"),
            row(4, "vol2", "卷 二 · 长夜", None, "卷", ""),
        ];
        let meta = BookMeta {
            author: "张三丰".to_string(),
            publisher: "星海文艺社".to_string(),
            completed_at: "2026-11-06".to_string(),
            isbn: String::new(),
            subject: "长篇".to_string(),
        };
        let layout = BookLayoutSpec::default();
        let frozen = FrozenAssets::new();
        for (fmt, name) in [
            ("html", "sample.html"),
            ("pdf", "sample.pdf"),
            ("docx", "sample.docx"),
            ("txt", "sample.txt"),
        ] {
            let out = dir.join(name);
            match render_export_file(
                fmt,
                "海上一日",
                Some("一部关于离港与归来的长篇"),
                &chapters,
                None,
                &layout,
                &frozen,
                &meta,
                "novel",
                &out,
            ) {
                Ok(()) => println!("OK {fmt} -> {}", out.display()),
                Err(e) => println!("ERR {fmt}: {e}"),
            }
        }
    }

    #[test]
    fn 快照导出按目录树先序_卷紧跟它的章() {
        let rows = snapshot_to_epub_chapters(&tree_snapshot());
        let titles: Vec<&str> = rows.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["卷 1", "章 1", "章 2", "卷 2", "章 3", "卷 3", "卷 4"],
            "必须是先序（父紧跟子），而不是卷 1-4 整堆在前、章跟在后面"
        );
        assert_eq!(
            rows[0].is_volume,
            Some(true),
            "卷节点要标成容器，渲染层才知道出卷页"
        );
        assert_eq!(rows[0].depth, Some(0));
        assert_eq!(rows[1].is_volume, Some(false), "章是内容章，不是容器");
        assert_eq!(rows[1].depth, Some(1), "章挂在卷下 → 深度 1");
        assert_eq!(
            rows[0].cover.as_deref(),
            Some("assets/writing/illustrations/vol1.png"),
            "卷自己的封面必须进载荷（旧实现写死 None，卷封从此消失）"
        );
        assert!(
            rows.iter().all(|r| r.volume.is_none()),
            "结构口径下不再填 volume 字符串，否则卷题会被打两遍"
        );
    }

    #[test]
    fn 旧模型快照无树信息时保持平铺_产物零变化() {
        let flat: Vec<WorkVersionChapter> = (1..=3)
            .map(|i| WorkVersionChapter {
                version_id: "v".to_string(),
                sort_order: i,
                src_chapter_id: format!("c{i}"),
                title: format!("第{i}章"),
                content: format!("<p>内容{i}</p>"),
                kind: "章".to_string(),
                parent_id: None,
                status: "draft".to_string(),
                word_count: 3,
                cover: String::new(),
                entry_date: String::new(),
            })
            .collect();
        let rows = snapshot_to_epub_chapters(&flat);
        assert_eq!(
            rows.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
            vec!["第1章", "第2章", "第3章"]
        );
        assert!(
            rows.iter()
                .all(|r| r.depth == Some(0) && r.is_volume == Some(false)),
            "无卷无父的书不许被硬造出层级"
        );
        // 空卷不许被吞：用户明确要求「空不空卷不由我们判断」，父子关系先连上
        let rows2 = snapshot_to_epub_chapters(&tree_snapshot());
        assert!(rows2
            .iter()
            .any(|r| r.title == "卷 3" && r.is_volume == Some(true)));
        assert!(rows2
            .iter()
            .any(|r| r.title == "卷 4" && r.is_volume == Some(true)));
    }

    #[test]
    fn txt_md_html_三种快照格式都带出卷层() {
        let s = tree_snapshot();

        let txt = render_text_book(
            "书名",
            None,
            &s,
            &crate::application::writing::BookMeta::default(),
        );
        let vol1 = txt.find("════ 卷 1 ════").expect("txt 要有卷题分隔行");
        let ch1 = txt.find("章 1").expect("章 1 必须在");
        let vol2 = txt.find("════ 卷 2 ════").expect("卷 2 也要出（空卷不丢）");
        assert!(vol1 < ch1 && ch1 < vol2, "txt 里卷题也要夹住它的子章");
        assert!(txt.contains("卷首语：风从海上来。"), "卷节点自带正文不许丢");

        let md = render_markdown_book(
            "书名",
            None,
            &s,
            &crate::application::writing::FrozenAssets::default(),
            &crate::application::writing::BookMeta::default(),
        )
        .unwrap();
        assert!(md.contains("## 卷 1"), "卷走二级标题：{md}");
        assert!(md.contains("### 章 1"), "章走三级标题：{md}");
        assert!(md.find("## 卷 1").unwrap() < md.find("### 章 1").unwrap());

        let html = render_html_book(
            "书名",
            None,
            &s,
            &crate::application::writing::FrozenAssets::default(),
            &crate::application::writing::BookMeta::default(),
            &crate::application::writing::layout::BookLayoutSpec::default(),
        )
        .unwrap();
        assert!(
            html.contains("<h2 class=\"volume\">卷 1</h2>"),
            "卷标题带 volume 类：{html}"
        );
        assert!(html.contains("<h3>章 1</h3>"), "章降一级：{html}");
    }

    #[test]
    fn 端到端_epub_目录嵌套成父子_卷页带自己的封面() {
        // 造一张真图当卷封：collect_asset 会读盘，路径给绝对值时按字面读
        let dir =
            std::env::temp_dir().join(format!("sf_tree_epub_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("vol1.png");
        std::fs::write(&png, base64_of_tiny_png()).unwrap();
        let out = dir.join("tree.epub");
        let cover = png.to_string_lossy().to_string();

        let chapters = snapshot_to_epub_chapters(&tree_snapshot_with_cover(&cover));
        crate::application::writing::export_epub(
            "树之书".to_string(),
            Some("父子联动校验".to_string()),
            chapters,
            None,
            crate::application::writing::layout::BookLayoutSpec::default(),
            crate::application::writing::FrozenAssets::default(),
            crate::application::writing::BookMeta::default(),
            out.to_string_lossy().to_string(),
        )
        .expect("export_epub 必须成功");

        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
        // 一次性把要看的条目读出来（借用 zip mutably，读完才继续用它做断言）
        let mut zip_text = |name: &str| -> String {
            let mut buf = String::new();
            if let Ok(mut rf) = zip.by_name(name) {
                let _ = rf.read_to_string(&mut buf);
            }
            buf
        };
        let nav = zip_text("OEBPS/nav.xhtml");
        assert!(
            names.iter().any(|n| n.starts_with("OEBPS/images/")),
            "卷封面要真的进包，否则用户看到的还是一本没有图的书：{names:?}"
        );

        let vol_pos = nav.find(">卷 1</a>").expect("目录里卷 1 必须是可点条目");
        let nested = nav.find("<ol>").expect("目录必须有嵌套 ol");
        let ch1_pos = nav.find(">章 1</a>").expect("章 1 要在目录里");
        assert!(
            nested <= vol_pos && vol_pos < ch1_pos,
            "卷 → 嵌套 ol → 章 的先序结构：{nav}"
        );
        assert!(
            nav[..ch1_pos].rfind("</ol>").is_none()
                || nav[..ch1_pos].matches("<ol>").count() > nav[..ch1_pos].matches("</ol>").count(),
            "章 1 必须出现在卷 1 打开的子列表里：{nav}"
        );

        let ch0 = zip_text("OEBPS/chapter_0.xhtml");
        assert!(
            ch0.contains("class=\"volume-title volume-depth-0\""),
            "卷页走 volume-title（带深度类）而非章题：{ch0}"
        );
        assert!(!ch0.contains("chapter-title"), "卷页不许再挂章题类：{ch0}");
        assert!(ch0.contains("卷首语"), "卷页要排卷自带正文：{ch0}");
        assert!(
            ch0.contains("OEBPS") || ch0.contains("images/"),
            "卷页要引用包内封面图：{ch0}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 1x1 透明 PNG（够 collect_asset 读字节、算 media-type）。
    fn base64_of_tiny_png() -> Vec<u8> {
        let b64 = "iVBORw0KGgoAAAANuGAAAAD6AAAADAAAAElEQVR42mNkpKIYB1DwMgA=";
        // 不引 base64 依赖：直接写死这段最小 PNG 的字节
        let tbl = |c: u8| -> u8 {
            match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                _ => 0,
            }
        };
        let mut out: Vec<u8> = Vec::new();
        let mut acc: u32 = 0;
        let mut bits: u32 = 0;
        for c in b64.bytes() {
            if c == b'=' {
                break;
            }
            acc = (acc << 6) | tbl(c) as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((acc >> bits) as u8);
            }
        }
        out
    }

    #[test]
    fn docx_按层级出标题段_word导航窗格能成树() {
        let dir =
            std::env::temp_dir().join(format!("sf_tree_docx_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("tree.docx");
        render_export_file(
            "docx",
            "树之书",
            Some("层级校验"),
            &tree_snapshot(),
            None,
            &crate::application::writing::layout::BookLayoutSpec::default(),
            &crate::application::writing::FrozenAssets::default(),
            &crate::application::writing::BookMeta::default(),
            "novel",
            &out,
        )
        .expect("docx 渲染必须成功");

        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let mut doc = String::new();
        zip.by_name("word/document.xml")
            .map(|mut rf| rf.read_to_string(&mut doc).unwrap())
            .ok();
        assert!(doc.contains("Heading2"), "卷走 Heading2：{doc}");
        assert!(
            doc.contains("Heading3"),
            "章走 Heading3（此前根本没有第三级）：{doc}"
        );
        let vol = doc.find("卷 1</w:t>").expect("卷标题在文档里");
        let ch = doc.find("章 1</w:t>").expect("章标题在文档里");
        assert!(vol < ch, "先序：卷在自己的章之前");
        assert!(
            doc[..vol].rfind("Heading2").is_some(),
            "卷标题段落必须挂 Heading2 样式"
        );
        assert!(
            doc[..ch].rfind("Heading3").is_some(),
            "章标题段落必须挂 Heading3 样式"
        );

        let mut styles = String::new();
        zip.by_name("word/styles.xml")
            .map(|mut rf| rf.read_to_string(&mut styles).unwrap())
            .ok();
        assert!(
            styles.contains("w:styleId=\"Heading3\""),
            "styles.xml 要定义 Heading3"
        );
        assert!(
            styles.contains("outlineLvl w:val=\"2\""),
            "Heading3 的 outlineLvl 必须是 2"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── ㉱ E-A′（2026-11-11）：导出体裁化 ──
    //
    // 钉两件产物侧看得见的后果：
    //  ① 中文诗集的首行缩进 —— 撤缩进必须在 **EPUB css / DOCX 样式层+段落层 / HTML p**
    //    每一层都成立（旧实现 DOCX 段落级与 PDF 排版各自硬编码 2em，咽喉判了也白判）。
    //  ② 小说与旧书（未设体裁）的产物逐字零回归 —— 缩进串与改造前同一枚字面。

    fn genre_row(id: &str, title: &str, kind: &str, content: &str) -> WorkVersionChapter {
        WorkVersionChapter {
            version_id: "v_genre".to_string(),
            sort_order: 0,
            src_chapter_id: id.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            kind: kind.to_string(),
            parent_id: None,
            status: "draft".to_string(),
            word_count: 4,
            cover: String::new(),
            entry_date: String::new(),
        }
    }

    fn zip_entry_to_string(path: &std::path::Path, entry: &str) -> String {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        let mut buf = String::new();
        zip.by_name(entry)
            .map(|mut rf| rf.read_to_string(&mut buf).unwrap())
            .ok();
        buf
    }

    #[test]
    fn 中文诗集导出_epub与docx与html三层齐撤首行缩进() {
        let dir =
            std::env::temp_dir().join(format!("sf_ea_poetry_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let rows = vec![genre_row(
            "c1",
            "第 1 首",
            "首",
            "<p>她走了。</p><p>风还在。</p>",
        )];
        let lay = crate::application::writing::layout::BookLayoutSpec::default();
        let frozen = crate::application::writing::FrozenAssets::new();
        let meta = crate::application::writing::BookMeta::default();

        // HTML（本模块快照渲染器）
        let html_out = dir.join("b.html");
        render_export_file(
            "html", "诗集", None, &rows, None, &lay, &frozen, &meta, "poetry", &html_out,
        )
        .unwrap();
        let html = std::fs::read_to_string(&html_out).unwrap();
        assert!(html.contains("text-indent: 0"), "诗的 p 必须零缩进：{html}");
        assert!(
            !html.contains("text-indent: 2em"),
            "诗集产物里不许再出现 2em：{html}"
        );

        // EPUB（style.css）
        let epub_out = dir.join("b.epub");
        render_export_file(
            "epub", "诗集", None, &rows, None, &lay, &frozen, &meta, "poetry", &epub_out,
        )
        .unwrap();
        let css = zip_entry_to_string(&epub_out, "OEBPS/style.css");
        assert!(
            !css.contains("text-indent: 2em"),
            "EPUB css 不许给诗行 2em：{css}"
        );

        // DOCX（样式层 + 段落层 —— 旧实现断的是段落层这一半）
        let docx_out = dir.join("b.docx");
        render_export_file(
            "docx", "诗集", None, &rows, None, &lay, &frozen, &meta, "poetry", &docx_out,
        )
        .unwrap();
        let doc = zip_entry_to_string(&docx_out, "word/document.xml");
        assert!(
            !doc.contains("firstLineChars"),
            "DOCX 段落级不许私加缩进（旧实现每个 <w:p> 硬编码 200/480）：{doc}"
        );
        let styles = zip_entry_to_string(&docx_out, "word/styles.xml");
        assert!(
            !styles.contains("firstLineChars"),
            "DOCX 样式层同样零缩进：{styles}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 中文小说与旧书_缩进串逐字零回归() {
        let dir =
            std::env::temp_dir().join(format!("sf_ea_novel_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let rows = vec![genre_row("c1", "第一章", "章", "<p>她走了。</p>")];
        let lay = crate::application::writing::layout::BookLayoutSpec::default();
        let frozen = crate::application::writing::FrozenAssets::new();
        let meta = crate::application::writing::BookMeta::default();

        // 未设体裁的旧书（genre=""）= 小说口径：中文成书惯例 2em，与改造前逐字相同
        let html_out = dir.join("n.html");
        render_export_file(
            "html", "旧书", None, &rows, None, &lay, &frozen, &meta, "", &html_out,
        )
        .unwrap();
        let html = std::fs::read_to_string(&html_out).unwrap();
        assert!(
            html.contains("text-indent: 2em"),
            "中文小说（旧书）照 F4 原判缩进：{html}"
        );

        let docx_out = dir.join("n.docx");
        render_export_file(
            "docx", "小说", None, &rows, None, &lay, &frozen, &meta, "novel", &docx_out,
        )
        .unwrap();
        let doc = zip_entry_to_string(&docx_out, "word/document.xml");
        assert!(
            doc.contains(r#"<w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>"#),
            "中文小说段落级缩进串必须与旧常量逐字相同：{doc}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 西文书_docx段落层不再私加缩进_f4贯通() {
        // F4 的原判：西文成书靠段距分段、不缩进。styles 层早就照办了，
        // 段落层硬编码把它盖了过去 —— 本笔是 F4 在 DOCX 的欠账，不是新口径。
        let dir = std::env::temp_dir().join(format!("sf_ea_en_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let rows = vec![genre_row(
            "c1",
            "Chapter 1",
            "章",
            "<p>She left. The wind stayed.</p>",
        )];
        let lay = crate::application::writing::layout::BookLayoutSpec::default();
        let frozen = crate::application::writing::FrozenAssets::new();
        let meta = crate::application::writing::BookMeta::default();
        let docx_out = dir.join("en.docx");
        render_export_file(
            "docx", "En Book", None, &rows, None, &lay, &frozen, &meta, "novel", &docx_out,
        )
        .unwrap();
        let doc = zip_entry_to_string(&docx_out, "word/document.xml");
        assert!(
            !doc.contains("firstLineChars"),
            "西文书（语种判据）段落不许缩进：{doc}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
