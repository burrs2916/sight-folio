use crate::domain::writing::{
    WritingBook, WritingChapter, WritingChapterSnapshot, WritingDailyStat, WritingForeshadowing,
    WritingOutline, WritingSetting, WritingStoryline, WritingTimelineEvent,
};
use crate::error::AppResult;
use crate::infrastructure::database::analysis_repository::{AnalysisRepository, SqliteAnalysisRepository};
use crate::infrastructure::database::project_file_repository::{
    ProjectFileRepository, SqliteProjectFileRepository,
};
use crate::infrastructure::database::review_finding_repository::{
    ReviewFindingRepository, SqliteReviewFindingRepository,
};
use crate::infrastructure::database::writing_repository::WritingRepository;
use crate::infrastructure::database::SqliteWritingRepository;
use std::sync::Arc;
use tauri::State;

// T4 领域下沉后，原命令层落地的常量/纯函数移居 application/writing；
// 通过 pub use 再导出保持既有引用点（如 source_view.rs）零改动。
pub use crate::application::writing::{WRITING_PATH_PREFIX, writing_analysis_id};

/// 写作域命令（Sight Folio）：书籍与章节 CRUD。
///
/// 纯新增命令，不与代码分析域共享状态。保存统一走 INSERT OR REPLACE
/// （前端持完整对象，后端不做字段级合并），updated_at 由前端写入当前时间。

#[tauri::command]
pub fn list_writing_books(
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingBook>> {
    repo.list_books()
}

#[tauri::command]
pub fn save_writing_book(
    book: WritingBook,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_book(&book)
}

#[tauri::command]
pub fn delete_writing_book(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
    analysis_repo: State<'_, Arc<SqliteAnalysisRepository>>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    finding_repo: State<'_, Arc<SqliteReviewFindingRepository>>,
) -> AppResult<()> {
    // 连带清理本书的写作扫描产物（wscan_ 前缀分析记录 + 章节虚拟文件行 +
    // 写作审查发现），避免图鉴 / 分析列表 / 审查面板出现幽灵条目。
    // 清不到（从未扫描过）不算失败。
    let analysis_id = writing_analysis_id(&book_id);
    let _ = finding_repo.delete_by_analysis(&analysis_id);
    let _ = file_repo.delete_by_analysis(&analysis_id);
    let _ = analysis_repo.delete_analysis(&analysis_id);
    repo.delete_book(&book_id)
}

#[tauri::command]
pub fn list_writing_chapters(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingChapter>> {
    repo.list_chapters(&book_id)
}

#[tauri::command]
pub fn save_writing_chapter(
    chapter: WritingChapter,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_chapter(&chapter)?;
    // 顺手记当日统计快照（全书总字数）。统计是增益能力：失败只提示，绝不连累保存主流程。
    if let Err(e) = repo.record_daily_snapshot(&chapter.book_id, &local_today()) {
        eprintln!("[writing] daily snapshot failed (ignored): {e}");
    }
    Ok(())
}

#[tauri::command]
pub fn rename_writing_chapter(
    chapter_id: String,
    title: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    // title-only 更新：只改 title 列，绝不动 content——避免前端内存里的旧正文
    // 覆盖并发编辑中的新内容（「一键出多字」根因的数据库侧根治）。
    repo.rename_chapter(&chapter_id, &title, chrono::Utc::now().timestamp())
}

/// 正文自动保存（content-only）：只更新 content/word_count/updated_at 三列，
/// 绝不带 title/kind/status 内存副本整行落库（防并发回滚，与 rename_writing_chapter
/// 同一原则）。顺手记当日快照——统计是增益能力，失败只提示不连累保存主流程。
#[tauri::command]
pub fn save_writing_chapter_content(
    chapter_id: String,
    content: String,
    word_count: i64,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_chapter_content(&chapter_id, &content, word_count, chrono::Utc::now().timestamp())?;
    if let Ok(Some(ch)) = repo.get_chapter(&chapter_id) {
        if let Err(e) = repo.record_daily_snapshot(&ch.book_id, &local_today()) {
            eprintln!("[writing] daily snapshot failed (ignored): {e}");
        }
    }
    Ok(())
}

/// 每章保留的快照上限（超过裁最旧的；切章自动存 + 手动存共用该上限）。
/// 常量与裁剪口径集中在 application/writing（T4 领域下沉），命令层不再重复定义。
#[tauri::command]
pub fn save_writing_chapter_snapshot(
    snapshot: WritingChapterSnapshot,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    crate::application::writing::save_chapter_snapshot(&snapshot, &*repo)
}

#[tauri::command]
pub fn list_writing_chapter_snapshots(
    chapter_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingChapterSnapshot>> {
    crate::application::writing::list_chapter_snapshots(&chapter_id, &*repo)
}

#[tauri::command]
pub fn delete_writing_chapter(
    chapter_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_chapter(&chapter_id)
}

/// 最近 N 天的写作统计快照（日更量由前端按相邻差值计算）。
#[tauri::command]
pub fn list_writing_daily_stats(
    book_id: String,
    days: Option<i64>,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingDailyStat>> {
    repo.list_daily_stats(&book_id, days.unwrap_or(30).clamp(1, 365))
}

/// 本地日期 YYYY-MM-DD（日更口径按用户本机时区，不按 UTC）。
fn local_today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

// ─── 创作设定库（人设卡 / 世界观） ───

#[tauri::command]
pub fn list_writing_settings(
    book_id: String,
    kind: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingSetting>> {
    repo.list_settings(&book_id, &kind)
}

#[tauri::command]
pub fn save_writing_setting(
    setting: WritingSetting,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_setting(&setting)
}

#[tauri::command]
pub fn delete_writing_setting(
    setting_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_setting(&setting_id)
}

/// 把文本写到用户经系统对话框选定的路径（导出 Markdown 用）。
///
/// 路径由前端 dialog save() 提供，后端只负责写盘；不引 plugin-fs，
/// 避免为单一导出功能扩一整套文件系统能力。
#[tauri::command]
pub fn save_text_file(path: String, contents: String) -> AppResult<()> {
    std::fs::write(&path, contents)
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
    Ok(())
}

// ─── 大纲（P5）：与章节可双向关联的结构规划 ───

#[tauri::command]
pub fn list_writing_outlines(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingOutline>> {
    repo.list_outlines(&book_id)
}

#[tauri::command]
pub fn save_writing_outline(
    outline: WritingOutline,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_outline(&outline)
}

#[tauri::command]
pub fn delete_writing_outline(
    outline_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_outline(&outline_id)
}

// ─── 时间线事件（D）：全书级实体，独立于设定卡 extra.timeline ───

#[tauri::command]
pub fn list_writing_timeline_events(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingTimelineEvent>> {
    repo.list_timeline_events(&book_id)
}

#[tauri::command]
pub fn save_writing_timeline_event(
    event: WritingTimelineEvent,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_timeline_event(&event)
}

#[tauri::command]
pub fn delete_writing_timeline_event(
    event_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_timeline_event(&event_id)
}

// ─── 剧情线（多线叙事实体，P0）：事件通过 storyline_id 挂线，删线不删事件 ───

#[tauri::command]
pub fn list_writing_storylines(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingStoryline>> {
    repo.list_storylines(&book_id)
}

#[tauri::command]
pub fn save_writing_storyline(
    storyline: WritingStoryline,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_storyline(&storyline)
}

#[tauri::command]
pub fn delete_writing_storyline(
    storyline_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_storyline(&storyline_id)
}

// ─── 伏笔（「埋设 → 回收」承诺） ───

#[tauri::command]
pub fn list_writing_foreshadowings(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingForeshadowing>> {
    repo.list_foreshadowings(&book_id)
}

#[tauri::command]
pub fn save_writing_foreshadowing(
    item: WritingForeshadowing,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_foreshadowing(&item)
}

#[tauri::command]
pub fn delete_writing_foreshadowing(
    foreshadowing_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_foreshadowing(&foreshadowing_id)
}

// ─── EPUB 导出（P5）：实现在 application/writing（T4 领域下沉） ───

#[tauri::command]
pub fn save_writing_epub(
    title: String,
    description: Option<String>,
    chapters: Vec<crate::application::writing::EpubChapter>,
    path: String,
) -> AppResult<()> {
    crate::application::writing::export_epub(title, description, chapters, path)
}

// ─── 分析器融合（F1）：实现在 application/writing::scan_book（T4 领域下沉） ───
// 书 = 分析记录、章节 = 项目文件、死设定/未落地节拍 = review_findings，
// 语义映射与写作域注释详见 application/writing/mod.rs。

#[tauri::command]
pub fn scan_writing_book(
    book_id: String,
    writing_repo: State<'_, Arc<SqliteWritingRepository>>,
    analysis_repo: State<'_, Arc<crate::infrastructure::database::analysis_repository::SqliteAnalysisRepository>>,
    file_repo: State<'_, Arc<crate::infrastructure::database::project_file_repository::SqliteProjectFileRepository>>,
    finding_repo: State<'_, Arc<crate::infrastructure::database::review_finding_repository::SqliteReviewFindingRepository>>,
) -> AppResult<crate::application::writing::WritingScanSummary> {
    crate::application::writing::scan_book(
        &book_id,
        &*writing_repo,
        &*analysis_repo,
        &*file_repo,
        &*finding_repo,
    )
}

// ─── 导入作品（F4）：实现在 application/writing::import_book（T4 领域下沉） ───

#[tauri::command]
pub fn import_writing_book(
    file_path: String,
    title: Option<String>,
    writing_repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<crate::application::writing::WritingImportSummary> {
    crate::application::writing::import_book(file_path, title, &*writing_repo)
}
