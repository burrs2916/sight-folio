//! 成稿版本命令（完结作品重设计 B1）。
//!
//! 薄壳：注入仓储 State，规则全在 `application::work_version`。
//! 刻意不把新职责继续堆进已经很长的 `commands/writing.rs`（需求文档 §12）。
use crate::application::work_version;
use crate::application::work_version::library_root::WorksLibraryRootInfo;
use crate::commands::SettingsState;
use crate::domain::work_version::{ArtifactView, ExportArtifact, WorkVersion, WorkVersionChapter};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::work_version_repository::WorkVersionRepository;
use crate::infrastructure::database::{SqliteWorkVersionRepository, SqliteWritingRepository};
use std::sync::Arc;
use tauri::State;

/// 锁定一版：把当前**已落盘**的正文快照成不可变版本。
///
/// 正文由后端自己从库里取，不接受前端把 content 传上来 —— 前端只负责在调用前
/// 把未保存的编辑冲干净（B2）。这样「锁进版本的字」与「库里的字」不可能不一致。
/// `force = true` 用于内容与上一版完全相同时仍然留痕（见需求 §5.1 第 3 步）。
#[tauri::command]
pub fn lock_work_version(
    book_id: String,
    label: String,
    note: String,
    is_final: bool,
    force: bool,
    writing_repo: State<'_, Arc<SqliteWritingRepository>>,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<WorkVersion> {
    work_version::lock_version(
        &book_id,
        &label,
        &note,
        is_final,
        force,
        &writing_repo.inner().clone(),
        &version_repo.inner().clone(),
    )
}

/// 某书的全部版本（seq 倒序，最新在前）。
#[tauri::command]
pub fn list_work_versions(
    book_id: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<Vec<WorkVersion>> {
    version_repo.list_versions(&book_id)
}

/// 版本快照正文明细（预览 / 与上一版比对用）。
#[tauri::command]
pub fn get_version_snapshot(
    version_id: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<Vec<WorkVersionChapter>> {
    version_repo.list_version_chapters(&version_id)
}

/// 换正稿：全书有且仅有一版是正稿（库上另有部分唯一索引 ux_wv_book_final 兜底）。
#[tauri::command]
pub fn set_final_version(
    book_id: String,
    version_id: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<()> {
    work_version::set_final_version(&book_id, &version_id, &version_repo.inner().clone())
}

/// 删版本（连带抹掉章节快照与产物记录）。
///
/// 返回被抹掉的产物**相对路径**，磁盘文件删不删由上层按用户勾选决定 —— 而"删文件"需要
/// 作品库根目录，那是 B3 的产物。所以本片先只回传路径，不假装已经会删文件。
#[tauri::command]
pub fn delete_work_version(
    version_id: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<Vec<String>> {
    work_version::delete_work_version(&version_id, &version_repo.inner().clone())
}

/// 读作品库根（B3）。语义是「确保可用」：目录不存在则创建；
/// **创建失败把错误原样抛给 UI**，不许静默降级回「另存为」（需求 §4）。
#[tauri::command]
pub fn get_works_library_root(settings: State<'_, SettingsState>) -> AppResult<WorksLibraryRootInfo> {
    work_version::library_root::get_works_library_root(&settings.repository)
}

/// 换作品库根（B3）。只改配置值不搬文件；目录创建成功后才落库。
#[tauri::command]
pub fn set_works_library_root(
    path: String,
    settings: State<'_, SettingsState>,
) -> AppResult<WorksLibraryRootInfo> {
    work_version::library_root::set_works_library_root(&settings.repository, &path)
}

// ─── 导出任务队列（B4，需求 §5.2 / §6）───
// 命令层只做 State 解包；格式白名单、快照取数、状态机全在 export_jobs。

/// 入队导出：一格式一条 queued 任务，后台线程按并发上限 2 消化（Q5 默认）。
/// 返回刚入队的任务列表，界面据此即时展示排队态。
#[tauri::command]
pub fn enqueue_export(
    version_id: String,
    formats: Vec<String>,
    spec_id: Option<String>,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
    writing_repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<ExportArtifact>> {
    work_version::export_jobs::enqueue_export(
        &version_repo.inner().clone(),
        &writing_repo.inner().clone(),
        &version_id,
        &formats,
        spec_id.as_deref(),
    )
}

/// 任务面板视图：queued/running/failed（先入队先出）。
#[tauri::command]
pub fn list_export_jobs(
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<Vec<ExportArtifact>> {
    work_version::export_jobs::list_export_jobs(&version_repo.inner().clone())
}

/// 原地重试：只放行 failed（running 拒绝是诚实——没有中断线程的能力就不假装能重派）。
#[tauri::command]
pub fn retry_export_job(
    job_id: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<()> {
    work_version::export_jobs::retry_export_job(&version_repo.inner().clone(), &job_id)
}

/// 移除任务记录：queued（取消排队）与 failed（清失败账）可移除。
#[tauri::command]
pub fn dismiss_export_job(
    job_id: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<()> {
    work_version::export_jobs::dismiss_export_job(&version_repo.inner().clone(), &job_id)
}

/// 产物列表（成品页/计数徽标用）：书名 join 现取，库里零副本。
#[tauri::command]
pub fn list_export_artifacts(
    book_id: Option<String>,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
    writing_repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<ArtifactView>> {
    work_version::export_jobs::list_export_artifact_views(
        &version_repo.inner().clone(),
        &writing_repo.inner().clone(),
        book_id.as_deref(),
    )
}

/// 取回产物（§9-8）：按 `file_rel_path` 在作品库根下定位并高亮。
/// 解析不到时用例会改判 `missing` 并把带路径的错误抛给 UI（§9-10），不假装成功。
#[tauri::command]
pub fn reveal_artifact(
    artifact_id: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
    settings: State<'_, SettingsState>,
) -> AppResult<String> {
    let abs = work_version::export_jobs::reveal_artifact(
        &version_repo.inner().clone(),
        &settings.repository,
        &artifact_id,
    )?;
    let path = abs.to_string_lossy().into_owned();
    crate::commands::os::reveal_in_file_manager(path.clone()).map_err(AppError::Internal)?;
    Ok(path)
}

/// 复制产物到其他位置（§4：交付动作，库内本体与记录都不动）。
/// 返回复制的字节数，界面可以如实回执。
#[tauri::command]
pub fn copy_artifact_to(
    artifact_id: String,
    dest_path: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
    settings: State<'_, SettingsState>,
) -> AppResult<i64> {
    work_version::export_jobs::copy_artifact_to(
        &version_repo.inner().clone(),
        &settings.repository,
        &artifact_id,
        &dest_path,
    )
}

/// 某书某格式的导出产物计数（写作台「已有 n 个」徽标数据源）。
///
/// 命令名沿用 §6 的退役口径（前端零改动切换），实现已改按 `export_artifacts`：
/// 只数 `ready` —— 排队中/失败/文件缺失都不算「已有成品」，徽标不许撒谎。
/// format 传空串 = 该书全部格式总数。
#[tauri::command]
pub fn query_completed_work_count(
    book_id: String,
    format: String,
    version_repo: State<'_, Arc<SqliteWorkVersionRepository>>,
) -> AppResult<i64> {
    version_repo.count_ready_artifacts(&book_id, &format)
}
