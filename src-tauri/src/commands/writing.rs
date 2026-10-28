use crate::domain::writing::{
    CompletedWork, ExternalCapture, WritingAnnotation, WritingBook, WritingChapter,
    WritingChapterSnapshot, WritingDailyStat, WritingForeshadowing, WritingNote, WritingOutline,
    WritingSetting, WritingStoryline, WritingTimelineEvent,
};
use crate::error::AppResult;
use crate::infrastructure::database::analysis_repository::{
    AnalysisRepository, SqliteAnalysisRepository,
};
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
pub use crate::application::writing::{writing_analysis_id, WRITING_PATH_PREFIX};

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
    //
    // 崩溃安全设计（勿随意改成单一事务）：扫描产物是「可再生的派生数据」，
    // 必须先清、且清不到（从未扫描过）或清失败都不算失败——真正不可再生的
    // 核心数据（章节/设定/大纲…）由 repo.delete_book 的单事务原子删除，
    // 放在最后一步。若反过来把派生清理并进核心事务，派生数据的小故障会
    // 连累核心删除回滚，方向就错了。顺序错了才会出现「书没了、产物还在」
    // 的幽灵条目；当前顺序下任何一步失败，最坏结果也只是「书还在、产物
    // 被清空」，重扫即可自愈。
    let analysis_id = writing_analysis_id(&book_id);
    if let Err(e) = finding_repo.delete_by_analysis(&analysis_id) {
        eprintln!("[writing] delete book {book_id}: cleanup review findings failed (ignored): {e}");
    }
    if let Err(e) = file_repo.delete_by_analysis(&analysis_id) {
        eprintln!("[writing] delete book {book_id}: cleanup scanned files failed (ignored): {e}");
    }
    if let Err(e) = analysis_repo.delete_analysis(&analysis_id) {
        eprintln!("[writing] delete book {book_id}: cleanup analysis run failed (ignored): {e}");
    }
    repo.delete_book(&book_id)
}

#[tauri::command]
pub fn list_writing_chapters(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingChapter>> {
    repo.list_chapters(&book_id)
}

/// 按 id 取单章最新落库态（含正文）。AI 写工具落库后，前端据此判断
/// 当前编辑器是否被外部修改（对比 updated_at）并按需重载，避免整书列表全量刷新。
#[tauri::command]
pub fn get_writing_chapter(
    chapter_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Option<WritingChapter>> {
    repo.get_chapter(&chapter_id)
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
    repo.save_chapter_content(
        &chapter_id,
        &content,
        word_count,
        chrono::Utc::now().timestamp(),
    )?;
    if let Ok(Some(ch)) = repo.get_chapter(&chapter_id) {
        if let Err(e) = repo.record_daily_snapshot(&ch.book_id, &local_today()) {
            eprintln!("[writing] daily snapshot failed (ignored): {e}");
        }
    }
    Ok(())
}

/// 章节挂线 / 解绑（storyline-only，G1）：只更新 storyline_id 一列，
/// 绝不整行覆写——防前端内存里的旧 content/title 回滚并发编辑（与
/// rename_writing_chapter / save_writing_chapter_content 同一防回滚原则）。
/// storyline_id 传 null = 解绑（去线）。
#[tauri::command]
pub fn set_writing_chapter_storyline(
    chapter_id: String,
    storyline_id: Option<String>,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.set_chapter_storyline(
        &chapter_id,
        storyline_id.as_deref(),
        chrono::Utc::now().timestamp(),
    )
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

/// 重命名快照：只更新 name 一列（与 `set_writing_chapter_storyline` /
/// `rename_writing_chapter` 同一防整行覆写原则）。name 传 null/空白 = 清除自定义名。
#[tauri::command]
pub fn rename_writing_chapter_snapshot(
    snapshot_id: String,
    name: Option<String>,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    crate::application::writing::rename_chapter_snapshot(&snapshot_id, name.as_deref(), &repo)
}

/// 设定卡改写历史（批次③ 增-3）：AI 改卡前存的旧值。
/// 上限夹到 50，防前端误传大数把整张历史表拖出来。
#[tauri::command]
pub fn list_writing_setting_revisions(
    setting_id: String,
    limit: Option<i64>,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<crate::domain::writing::WritingSettingRevision>> {
    let cap = limit.unwrap_or(20).clamp(1, 50);
    crate::application::writing::list_setting_revisions(&setting_id, cap, &repo)
}

/// 把设定卡恢复到某条修订历史，返回恢复后的卡（前端据此重载编辑草稿）。
/// 当前值会先存入历史，所以恢复可反复点、每次被顶掉的内容都留得下来。
#[tauri::command]
pub fn restore_writing_setting_revision(
    setting_id: String,
    revision_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<crate::domain::writing::WritingSetting> {
    crate::application::writing::restore_setting_revision(&setting_id, &revision_id, &repo)
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
    std::fs::write(&path, contents).map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
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

// ─── 章内批注（批次② T4）：内容独立表持久化，正文只存引用 id ───

#[tauri::command]
pub fn list_writing_annotations(
    chapter_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingAnnotation>> {
    repo.list_annotations(&chapter_id)
}

#[tauri::command]
pub fn save_writing_annotation(
    item: WritingAnnotation,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_annotation(&item)
}

#[tauri::command]
pub fn delete_writing_annotation(
    annotation_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_annotation(&annotation_id)
}

#[tauri::command]
pub fn list_writing_annotations_by_setting(
    setting_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingAnnotation>> {
    repo.list_annotations_by_setting(&setting_id)
}

// ─── 灵感/快速笔记（T4）：全局级、跨章、作者心流暂存。 ───

#[tauri::command]
pub fn list_writing_notes(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<WritingNote>> {
    repo.list_notes(&book_id)
}

#[tauri::command]
pub fn save_writing_note(
    item: WritingNote,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_note(&item)
}

#[tauri::command]
pub fn delete_writing_note(
    note_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_note(&note_id)
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
    analysis_repo: State<
        '_,
        Arc<crate::infrastructure::database::analysis_repository::SqliteAnalysisRepository>,
    >,
    file_repo: State<
        '_,
        Arc<crate::infrastructure::database::project_file_repository::SqliteProjectFileRepository>,
    >,
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

// ─── DOCX / PDF 导出（T7）：后端原生离线生成 ───

#[tauri::command]
pub fn save_writing_docx(
    title: String,
    description: Option<String>,
    chapters: Vec<crate::application::writing::EpubChapter>,
    path: String,
) -> AppResult<()> {
    crate::application::writing::docx_export::export_docx(title, description, chapters, path)
}

#[tauri::command]
pub fn save_writing_pdf(
    title: String,
    description: Option<String>,
    chapters: Vec<crate::application::writing::EpubChapter>,
    path: String,
) -> AppResult<()> {
    crate::application::writing::pdf_export::export_pdf(title, description, chapters, path)
}

// ─── 全书备份与恢复（T7） ───
//
// 数据库是 WAL 模式：直接 fs::copy 主文件会遗漏 WAL 中尚未 checkpoint 的
// 最新事务，备份不完整。因此：
// - 备份：对主连接执行 `VACUUM INTO '<dest>'`，SQLite 内部完成 checkpoint，
//   产出单文件完整快照（含全部已提交事务）；
// - 恢复：先用 rusqlite backup API 把备份文件整体搬进当前活动连接
//   （比替换文件安全：不破坏打开中的连接与 WAL 状态），随后
//   integrity_check 快速校验 + writing_books 可读性确认。

#[tauri::command]
pub fn backup_writing_book(
    path: String,
    db: State<'_, Arc<crate::infrastructure::database::connection::Database>>,
) -> AppResult<()> {
    use rusqlite::Connection;
    use std::io::Write;
    use std::path::PathBuf;

    let dest = PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| crate::error::AppError::Internal(format!("backup dir {parent:?}: {e}")))?;
    }
    // VACUUM INTO 的目标路径不支持参数绑定；单引号会破坏 SQL 字符串，
    // 这里做最小转义（SQLite 字符串字面量内 '' 表示单个 '）。
    let escaped = path.replace('\'', "''");
    let sql = format!("VACUUM INTO '{}'", escaped);

    let conn =
        db.0.lock()
            .map_err(|e| crate::error::AppError::Internal(format!("backup lock: {e}")))?;
    let journal_before = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
        .ok();
    println!(
        "[backup] journal_mode={:?} → VACUUM INTO {path}",
        journal_before
    );
    conn.execute_batch(&sql)
        .map_err(|e| crate::error::AppError::Internal(format!("backup vacuum into: {e}")))?;

    // 校验：备份文件可独立只读打开且能读取 writing_books 表。
    let check = Connection::open(&dest).and_then(|c| {
        c.query_row("SELECT COUNT(*) FROM writing_books", [], |r| {
            r.get::<_, i64>(0)
        })
    });
    match check {
        Ok(count) => println!("[backup] verified {path}: writing_books={count}"),
        Err(e) => {
            let _ = std::fs::remove_file(&dest);
            return Err(crate::error::AppError::Internal(format!(
                "backup verify failed (removed {path}): {e}"
            )));
        }
    }
    let _ = std::io::stdout().flush();
    Ok(())
}

#[tauri::command]
pub fn restore_writing_book(
    path: String,
    db: State<'_, Arc<crate::infrastructure::database::connection::Database>>,
) -> AppResult<()> {
    use rusqlite::Connection;

    // 1. 备份文件必须存在且可读
    if !std::path::Path::new(&path).exists() {
        return Err(crate::error::AppError::NotFound(format!(
            "backup file not found: {path}"
        )));
    }
    // 2. 源文件只读打开（不篡改备份）
    let src = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| crate::error::AppError::Internal(format!("open backup {path}: {e}")))?;

    // 3. 目标连接加锁，用 backup API 整库导入（安全替换活动连接内容）
    let mut conn =
        db.0.lock()
            .map_err(|e| crate::error::AppError::Internal(format!("restore lock: {e}")))?;
    let backup = rusqlite::backup::Backup::new(&src, &mut conn)
        .map_err(|e| crate::error::AppError::Internal(format!("backup init: {e}")))?;
    backup
        .run_to_completion(5, std::time::Duration::from_millis(100), None)
        .map_err(|e| crate::error::AppError::Internal(format!("backup restore: {e}")))?;
    drop(backup);

    // 4. 完整性校验 + 业务表确认
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| crate::error::AppError::Internal(format!("integrity check: {e}")))?;
    if integrity != "ok" {
        return Err(crate::error::AppError::Internal(format!(
            "restored db integrity failed: {integrity}"
        )));
    }
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM writing_books", [], |r| r.get(0))
        .map_err(|e| crate::error::AppError::Internal(format!("verify writing_books: {e}")))?;
    println!("[restore] ok from {path}: integrity={integrity}, writing_books={count}");
    Ok(())
}

// ─── 完结作品记录（Phase 2）：导出/备份成功后由写作台写入，供「完结作品」页统一管理 ───

#[tauri::command]
pub fn list_completed_works(
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<CompletedWork>> {
    let mut works = repo.list_completed_works()?;
    // 顺带做文件存在性检测并回写标记：用户移动/删除源文件后列表能如实显示
    // 「找不到文件」，而不是保留旧的「可下载」假象。变化才回写，避免无谓写库。
    for w in works.iter_mut() {
        let missing = w.file_path.is_empty() || !std::path::Path::new(&w.file_path).exists();
        if missing != w.is_file_missing {
            repo.set_completed_work_missing(&w.id, missing)?;
            w.is_file_missing = missing;
        }
    }
    Ok(works)
}

/// 统计某书某格式的完结作品数量（写作台展示「已有 n 个 PDF」）。
/// format 传空串 = 该书全部格式总数。
#[tauri::command]
pub fn query_completed_work_count(
    book_id: String,
    format: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<i64> {
    repo.count_completed_works(&book_id, &format)
}

/// 保存一条完结作品记录（INSERT OR REPLACE，前端持完整对象）。
/// file_size 由命令层 stat file_path 回填——前端没有文件系统能力；
/// 文件不存在（用户事后删了源文件）时保留前端传入值（0），不阻塞记录。
#[tauri::command]
pub fn save_completed_work(
    work: CompletedWork,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    let mut work = work;
    if !work.file_path.is_empty() {
        if let Ok(meta) = std::fs::metadata(&work.file_path) {
            work.file_size = meta.len() as i64;
        }
    }
    repo.save_completed_work(&work)
}

/// 移除完结作品记录（只删记录，不动源文件——与页面「仅从列表移除」语义一致）。
#[tauri::command]
pub fn delete_completed_work(
    id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_completed_work(&id)
}

/// 完结作品改名/改目录（重新定位）：物理移动源文件到新路径，并更新记录 file_path。
/// - 旧文件不存在（用户已手动移动/删除）时跳过移动，仅把记录指向新路径；
/// - 新路径对应的文件已存在且与旧路径不同 → 视为用户想把记录指向已有文件（导入语义），不移动；
/// - 无论移动与否都会 stat 新路径回填 file_size。
/// 用户视角：把「这一个导出产物」从磁盘挪个地方放/改个名，或修正记录指向。
#[tauri::command]
pub fn move_completed_work(
    id: String,
    new_path: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    if new_path.trim().is_empty() {
        return Err(crate::error::AppError::Validation(
            "new path is empty".into(),
        ));
    }
    let existing = repo
        .list_completed_works()?
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| crate::error::AppError::NotFound(format!("completed work {id}")))?;

    let old_path = existing.file_path;
    let new_exists = std::path::Path::new(&new_path).exists();
    let same = !old_path.is_empty() && old_path == new_path;

    // 旧文件存在且目标不同：物理移动。目标已存在时不覆盖（rsync 语义取保守）。
    if !old_path.is_empty() && !same && std::path::Path::new(&old_path).exists() && !new_exists {
        if let Err(e) = std::fs::rename(&old_path, &new_path) {
            return Err(crate::error::AppError::Internal(format!(
                "move {} -> {} failed: {e}",
                old_path, new_path
            )));
        }
    }

    // stat 新路径回填 file_size（文件不在时保留 0）
    let file_size = std::fs::metadata(&new_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    repo.update_completed_work_path(&id, &new_path, file_size)
}

/// 扫描/导入磁盘上已存在的导出文件为完结作品记录（不重复生成）。
/// 前端负责挑选文件；命令按 file_path 去重——已在库里则跳过。
/// 返回 (imported, skipped)。id/created_at 由命令层生成（导入场景前端无完整对象）。
#[tauri::command]
pub fn import_completed_works(
    book_id: String,
    book_title: String,
    file_paths: Vec<String>,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<(usize, usize)> {
    let mut imported = 0usize;
    let mut skipped = 0usize;
    for raw in file_paths {
        let path = raw.trim().to_string();
        if path.is_empty() {
            skipped += 1;
            continue;
        }
        if repo.find_completed_work_by_path(&path)?.is_some() {
            skipped += 1;
            continue;
        }
        let file_size = std::fs::metadata(&path)
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        let work = CompletedWork {
            id: format!("cw_{}", uuid::Uuid::new_v4().simple()),
            book_id: book_id.clone(),
            book_title: book_title.clone(),
            format: infer_export_format(&path),
            file_path: path,
            file_size,
            is_file_missing: false,
            word_count: 0,
            chapter_count: 0,
            created_at: chrono::Utc::now().timestamp(),
        };
        repo.save_completed_work(&work)?;
        imported += 1;
    }
    Ok((imported, skipped))
}

// ─── 外部素材采集（Writing Phase 1）：图片/文字/记事本片段/链接 → 素材库 ───
// book_id='' = 全局素材；AI 分析由前端调用 Agent 完成后回填 analysis_json，
// 此处仅负责持久化与检索（命令层不做 OCR/分析，保持与其它 writing 命令一致）。

#[tauri::command]
pub fn list_external_captures(
    book_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<Vec<ExternalCapture>> {
    repo.list_external_captures(&book_id)
}

#[tauri::command]
pub fn save_external_capture(
    item: ExternalCapture,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.save_external_capture(&item)
}

#[tauri::command]
pub fn delete_external_capture(
    capture_id: String,
    repo: State<'_, Arc<SqliteWritingRepository>>,
) -> AppResult<()> {
    repo.delete_external_capture(&capture_id)
}

/// 按扩展名推断导出格式（与前端 FORMAT_META 对齐；未知扩展名回退 "md" 之外 → 用 "" 表示未知）。
fn infer_export_format(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "epub" => "epub".into(),
        "pdf" => "pdf".into(),
        "docx" => "docx".into(),
        "html" | "htm" => "html".into(),
        "md" | "markdown" => "md".into(),
        "txt" => "txt".into(),
        "db" => "backup".into(),
        _ => "".into(),
    }
}
