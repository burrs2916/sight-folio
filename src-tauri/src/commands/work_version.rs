//! 成稿版本命令（完结作品重设计 B1）。
//!
//! 薄壳：注入仓储 State，规则全在 `application::work_version`。
//! 刻意不把新职责继续堆进已经很长的 `commands/writing.rs`（需求文档 §12）。
use crate::application::work_version;
use crate::application::work_version::library_root::WorksLibraryRootInfo;
use crate::commands::SettingsState;
use crate::domain::work_version::{WorkVersion, WorkVersionChapter};
use crate::error::AppResult;
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
