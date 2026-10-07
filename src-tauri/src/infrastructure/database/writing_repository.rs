use crate::domain::writing::{
    CompletedWork, WritingAnnotation, WritingBook, WritingChapter, WritingChapterSnapshot,
    WritingDailyStat, WritingForeshadowing, WritingNote, WritingOutline, WritingSetting,
    WritingStoryline, WritingTimelineEvent,
};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use rusqlite::OptionalExtension;
use std::sync::Arc;

/// 写作域仓储（Sight Folio）
///
/// 铁律：row mapper 一律按列名读取（row.get("col")），禁用位置索引——
/// 未来任何 ALTER TABLE 加列都不会造成物理列序与逻辑列序漂移。
pub trait WritingRepository: Send + Sync {
    fn list_books(&self) -> AppResult<Vec<WritingBook>>;
    fn get_book(&self, id: &str) -> AppResult<Option<WritingBook>>;
    fn save_book(&self, book: &WritingBook) -> AppResult<()>;
    /// 删除传播矩阵（P0 一致性）：删书 = 放弃整部作品，事务内级联清掉
    /// 全部子域行（章节/设定/大纲/时间线/剧情线/伏笔/日快照），不留孤儿。
    fn delete_book(&self, id: &str) -> AppResult<()>;
    fn list_chapters(&self, book_id: &str) -> AppResult<Vec<WritingChapter>>;
    fn get_chapter(&self, id: &str) -> AppResult<Option<WritingChapter>>;
    fn save_chapter(&self, chapter: &WritingChapter) -> AppResult<()>;
    /// 改名只更新 title（title-only）：绝不整行覆写——save_chapter 是 INSERT OR REPLACE，
    /// 用前端内存里的旧 content 落库会把并发编辑中的正文回滚掉。updated_at 由调用方传入。
    fn rename_chapter(&self, id: &str, title: &str, updated_at: i64) -> AppResult<()>;
    /// 正文保存只更新 content/word_count（content-only）：自动保存高频走这里，
    /// 绝不带 title/kind/status 等内存副本整行落库（与 rename_chapter 同一防回滚原则）。
    fn save_chapter_content(
        &self,
        id: &str,
        content: &str,
        word_count: i64,
        updated_at: i64,
    ) -> AppResult<()>;
    /// 章节挂线只更新 storyline_id（storyline-only，G1）：章↔线归属是低频率元数据更新，
    /// 走独立 UPDATE 不整行覆写，防旧 content 回滚（与 rename/save_content 同一原则）。
    /// storyline_id=None 表示解绑（去线）。updated_at 由调用方传入。
    fn set_chapter_storyline(
        &self,
        id: &str,
        storyline_id: Option<&str>,
        updated_at: i64,
    ) -> AppResult<()>;
    /// 章节版本快照（批次④）：追加一条，并裁剪到每章最近 N 份（事务内）。
    fn save_chapter_snapshot(
        &self,
        snapshot: &WritingChapterSnapshot,
        keep_per_chapter: i64,
    ) -> AppResult<()>;
    /// 按章列出快照（created_at 倒序）。
    fn list_chapter_snapshots(
        &self,
        chapter_id: &str,
        limit: i64,
    ) -> AppResult<Vec<WritingChapterSnapshot>>;
    /// 删除传播矩阵（P0 一致性）：删章不删关联内容（零强制）——
    /// 时间线事件、伏笔、大纲均保留，仅把指向该章的引用解绑回「未绑定章」。
    fn delete_chapter(&self, id: &str) -> AppResult<()>;
    fn list_settings(&self, book_id: &str, kind: &str) -> AppResult<Vec<WritingSetting>>;
    fn save_setting(&self, setting: &WritingSetting) -> AppResult<()>;
    /// 删除传播矩阵（P0 一致性）：删设定不删事件（零强制）——
    /// 挂在设定卡上的时间线事件保留，仅 setting_id 解绑回「书级事件」。
    fn delete_setting(&self, id: &str) -> AppResult<()>;
    /// 记录当日快照：全书总字数 upsert 到 (book_id, day)。返回总字数。
    fn record_daily_snapshot(&self, book_id: &str, day: &str) -> AppResult<i64>;
    /// 最近 N 天的快照（只含有记录的日期；缺失日期由前端补零）。
    fn list_daily_stats(&self, book_id: &str, days: i64) -> AppResult<Vec<WritingDailyStat>>;
    fn list_outlines(&self, book_id: &str) -> AppResult<Vec<WritingOutline>>;
    fn save_outline(&self, outline: &WritingOutline) -> AppResult<()>;
    fn delete_outline(&self, id: &str) -> AppResult<()>;
    /// 全书时间线事件（D）：按书列出，前端按 setting_id 分组铺轨。
    fn list_timeline_events(&self, book_id: &str) -> AppResult<Vec<WritingTimelineEvent>>;
    /// 保存单条时间线事件（INSERT OR REPLACE，前端持完整对象）。
    fn save_timeline_event(&self, event: &WritingTimelineEvent) -> AppResult<()>;
    fn delete_timeline_event(&self, id: &str) -> AppResult<()>;
    /// 剧情线（多线叙事实体）：按书列出，前端按线分轨。
    fn list_storylines(&self, book_id: &str) -> AppResult<Vec<WritingStoryline>>;
    fn save_storyline(&self, storyline: &WritingStoryline) -> AppResult<()>;
    /// 删线不删事件：挂在该线上的事件 storyline_id 置 NULL（零强制，事件回到「未挂线」）。
    fn delete_storyline(&self, id: &str) -> AppResult<()>;
    /// 伏笔（「埋设 → 回收」承诺）：按书列出。
    fn list_foreshadowings(&self, book_id: &str) -> AppResult<Vec<WritingForeshadowing>>;
    fn save_foreshadowing(&self, item: &WritingForeshadowing) -> AppResult<()>;
    fn delete_foreshadowing(&self, id: &str) -> AppResult<()>;
    /// 章内批注（批次② T4）：按章列出（created_at 倒序）。
    fn list_annotations(&self, chapter_id: &str) -> AppResult<Vec<WritingAnnotation>>;
    fn save_annotation(&self, item: &WritingAnnotation) -> AppResult<()>;
    fn delete_annotation(&self, id: &str) -> AppResult<()>;
    /// 完结作品记录（Phase 2）：按导出时间倒序列出全部。
    fn list_completed_works(&self) -> AppResult<Vec<CompletedWork>>;
    /// 落一条完结作品记录（INSERT OR REPLACE，前端持完整对象）。
    fn save_completed_work(&self, work: &CompletedWork) -> AppResult<()>;
    /// 灵感/快速笔记（T4）：按书列出（pin DESC → updated_at DESC → created_at DESC）。
    fn list_notes(&self, book_id: &str) -> AppResult<Vec<WritingNote>>;
    fn save_note(&self, item: &WritingNote) -> AppResult<()>;
    fn delete_note(&self, id: &str) -> AppResult<()>;
    /// 解绑笔记上的章节引用（删章时把该章的 notes 置 chapter_id=''，不删笔记本身）。
    fn unbind_notes_from_chapter(&self, chapter_id: &str) -> AppResult<()>;
    /// 删除完结作品记录（只删元数据行，不删源文件——语义由前端文案明确）。
    fn delete_completed_work(&self, id: &str) -> AppResult<()>;
    /// 按 file_path 精确查一条完结作品记录（导入去重用：同路径不重复生成）。
    fn find_completed_work_by_path(&self, file_path: &str) -> AppResult<Option<CompletedWork>>;
    /// 更新完结作品记录的 file_path（改名/改目录/重新定位后记录与磁盘对齐），
    /// file_size 由命令层 stat 新路径后传入。
    fn update_completed_work_path(&self, id: &str, new_path: &str, file_size: i64)
        -> AppResult<()>;
    /// 统计某书某格式的完结作品数量（format 为空串 = 该书全部格式）。
    fn count_completed_works(&self, book_id: &str, format: &str) -> AppResult<i64>;
    /// 回写源文件缺失标记（列表加载时顺带检测磁盘后落库，未来可作为定时探测的落点）。
    fn set_completed_work_missing(&self, id: &str, is_missing: bool) -> AppResult<()>;
}

pub struct SqliteWritingRepository {
    db: Arc<Database>,
}

impl Clone for SqliteWritingRepository {
    fn clone(&self) -> Self {
        Self {
            db: self.db.clone(),
        }
    }
}

impl SqliteWritingRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_book(row: &rusqlite::Row) -> rusqlite::Result<WritingBook> {
    Ok(WritingBook {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        genre: row.get("genre")?,
        medium: row.get("medium")?,
        status: row.get("status")?,
        cover_color: row.get("cover_color")?,
        daily_goal: row.get("daily_goal")?,
        extra: row.get("extra")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_chapter(row: &rusqlite::Row) -> rusqlite::Result<WritingChapter> {
    Ok(WritingChapter {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        title: row.get("title")?,
        content: row.get("content")?,
        sort_order: row.get("sort_order")?,
        word_count: row.get("word_count")?,
        status: row.get("status")?,
        volume: row.get("volume")?,
        parent_id: row.get::<_, Option<String>>("parent_id")?,
        kind: row.get::<_, String>("kind")?,
        storyline_id: row.get::<_, Option<String>>("storyline_id")?,
        extra: row.get("extra")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_setting(row: &rusqlite::Row) -> rusqlite::Result<WritingSetting> {
    Ok(WritingSetting {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        kind: row.get("kind")?,
        name: row.get("name")?,
        subtitle: row.get("subtitle")?,
        description: row.get("description")?,
        extra: row.get("extra")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// ⚠️ 这张列清单是 row_to_book 的**唯一取数来源**，必须与 `row.get("...")` 一一对应。
/// 2026-09-12 事故：medium 只加进了模型 / INSERT / row_to_book，**漏了这里** →
/// `list_books()` 在 `row.get("medium")` 处抛 `InvalidColumnName: medium`
/// （rusqlite 的列名错误，不是 SQL 报错，所以日志里看不到 SQL 语句），
/// books 恒为空 → 工作室 L1 作品栏整条空白。
/// 加列时的顺序：migration ALTER → 模型字段 → INSERT 列+值 → **本清单** → row mapper。
const BOOK_COLS: &str =
    "id, title, description, genre, medium, status, cover_color, daily_goal, extra, created_at, updated_at";
const CHAPTER_COLS: &str =
    "id, book_id, title, content, sort_order, word_count, status, volume, parent_id, kind, storyline_id, extra, created_at, updated_at";
const SETTING_COLS: &str =
    "id, book_id, kind, name, subtitle, description, extra, sort_order, created_at, updated_at";
const OUTLINE_COLS: &str =
    "id, book_id, title, summary, chapter_id, extra, sort_order, created_at, updated_at";
const TIMELINE_EVENT_COLS: &str =
    "id, book_id, setting_id, at, event, chapter_id, storyline_id, sort_order, created_at, updated_at";
const STORYLINE_COLS: &str =
    "id, book_id, name, color, description, sort_order, created_at, updated_at";
const FORESHADOWING_COLS: &str =
    "id, book_id, title, description, plant_chapter_id, payoff_chapter_id, status, storyline_id, sort_order, created_at, updated_at";
const SNAPSHOT_COLS: &str = "id, chapter_id, book_id, content, word_count, origin, created_at";

const ANNOTATION_COLS: &str = "id, chapter_id, book_id, text, excerpt, created_at, updated_at";

const NOTE_COLS: &str = "id, book_id, chapter_id, content, tags, pin, created_at, updated_at";

const COMPLETED_WORK_COLS: &str =
    "id, book_id, book_title, format, file_path, file_size, is_file_missing, word_count, chapter_count, created_at";

fn row_to_completed_work(row: &rusqlite::Row) -> rusqlite::Result<CompletedWork> {
    Ok(CompletedWork {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        book_title: row.get("book_title")?,
        format: row.get("format")?,
        file_path: row.get("file_path")?,
        file_size: row.get("file_size")?,
        is_file_missing: row.get::<_, i64>("is_file_missing")? != 0,
        word_count: row.get("word_count")?,
        chapter_count: row.get("chapter_count")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_annotation(row: &rusqlite::Row) -> rusqlite::Result<WritingAnnotation> {
    Ok(WritingAnnotation {
        id: row.get("id")?,
        chapter_id: row.get("chapter_id")?,
        book_id: row.get("book_id")?,
        text: row.get("text")?,
        excerpt: row.get("excerpt")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<WritingNote> {
    Ok(WritingNote {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        chapter_id: row.get("chapter_id")?,
        content: row.get("content")?,
        tags: row.get("tags")?,
        pin: row.get("pin")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_snapshot(row: &rusqlite::Row) -> rusqlite::Result<WritingChapterSnapshot> {
    Ok(WritingChapterSnapshot {
        id: row.get("id")?,
        chapter_id: row.get("chapter_id")?,
        book_id: row.get("book_id")?,
        content: row.get("content")?,
        word_count: row.get("word_count")?,
        origin: row.get("origin")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_outline(row: &rusqlite::Row) -> rusqlite::Result<WritingOutline> {
    Ok(WritingOutline {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        title: row.get("title")?,
        summary: row.get("summary")?,
        chapter_id: row.get("chapter_id")?,
        extra: row.get("extra")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_timeline_event(row: &rusqlite::Row) -> rusqlite::Result<WritingTimelineEvent> {
    Ok(WritingTimelineEvent {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        setting_id: row.get("setting_id")?,
        at: row.get("at")?,
        event: row.get("event")?,
        chapter_id: row.get("chapter_id")?,
        storyline_id: row.get("storyline_id")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_storyline(row: &rusqlite::Row) -> rusqlite::Result<WritingStoryline> {
    Ok(WritingStoryline {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        description: row.get("description")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_foreshadowing(row: &rusqlite::Row) -> rusqlite::Result<WritingForeshadowing> {
    Ok(WritingForeshadowing {
        id: row.get("id")?,
        book_id: row.get("book_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        plant_chapter_id: row.get("plant_chapter_id")?,
        payoff_chapter_id: row.get("payoff_chapter_id")?,
        status: row.get("status")?,
        storyline_id: row.get("storyline_id")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

impl WritingRepository for SqliteWritingRepository {
    fn list_books(&self) -> AppResult<Vec<WritingBook>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {BOOK_COLS} FROM writing_books ORDER BY updated_at DESC"
        ))?;
        let books = stmt
            .query_map([], row_to_book)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(books)
    }

    fn get_book(&self, id: &str) -> AppResult<Option<WritingBook>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {BOOK_COLS} FROM writing_books WHERE id = ?1"
        ))?;
        let mut rows = stmt.query_map([id], row_to_book)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn save_book(&self, book: &WritingBook) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_books
             (id, title, description, genre, medium, status, cover_color, daily_goal, extra, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                book.id,
                book.title,
                book.description,
                book.genre,
                book.medium,
                book.status,
                book.cover_color,
                book.daily_goal,
                book.extra,
                book.created_at,
                book.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_book(&self, id: &str) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // 删除传播矩阵（P0 一致性）：书 = 全书数据根，删书级联清掉所有子域行。
        // 同一事务内完成，任一步失败整体回滚，绝不半删（半删 = 书没了但子域
        // 孤儿残留，重启后仍会被按 book_id 查出，与「已放弃」不符）。
        let tx = conn.transaction()?;
        for table in [
            "writing_timeline_events",
            "writing_foreshadowings",
            "writing_storylines",
            "writing_settings",
            "writing_daily_stats",
            "writing_outlines",
            "writing_chapters",
            "writing_annotations",
        ] {
            tx.execute(&format!("DELETE FROM {table} WHERE book_id = ?1"), [id])?;
        }
        tx.execute("DELETE FROM writing_books WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    fn list_chapters(&self, book_id: &str) -> AppResult<Vec<WritingChapter>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {CHAPTER_COLS} FROM writing_chapters WHERE book_id = ?1 ORDER BY sort_order ASC, created_at ASC"
        ))?;
        let chapters = stmt
            .query_map([book_id], row_to_chapter)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(chapters)
    }

    fn get_chapter(&self, id: &str) -> AppResult<Option<WritingChapter>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {CHAPTER_COLS} FROM writing_chapters WHERE id = ?1"
        ))?;
        let mut rows = stmt.query_map([id], row_to_chapter)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn save_chapter(&self, chapter: &WritingChapter) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_chapters
             (id, book_id, title, content, sort_order, word_count, status, volume, parent_id, kind, extra, storyline_id, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            rusqlite::params![
                chapter.id,
                chapter.book_id,
                chapter.title,
                chapter.content,
                chapter.sort_order,
                chapter.word_count,
                chapter.status,
                chapter.volume,
                chapter.parent_id,
                chapter.kind,
                chapter.extra,
                chapter.storyline_id,
                chapter.created_at,
                chapter.updated_at,
            ],
        )?;
        Ok(())
    }

    fn rename_chapter(&self, id: &str, title: &str, updated_at: i64) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE writing_chapters SET title = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, title, updated_at],
        )?;
        Ok(())
    }

    fn save_chapter_content(
        &self,
        id: &str,
        content: &str,
        word_count: i64,
        updated_at: i64,
    ) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE writing_chapters SET content = ?2, word_count = ?3, updated_at = ?4 WHERE id = ?1",
            rusqlite::params![id, content, word_count, updated_at],
        )?;
        Ok(())
    }

    fn set_chapter_storyline(
        &self,
        id: &str,
        storyline_id: Option<&str>,
        updated_at: i64,
    ) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE writing_chapters SET storyline_id = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, storyline_id, updated_at],
        )?;
        Ok(())
    }

    fn save_chapter_snapshot(
        &self,
        snapshot: &WritingChapterSnapshot,
        keep_per_chapter: i64,
    ) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // 追加 + 裁剪同一事务：任一步失败整体回滚，绝不出现「快照存了但旧的没裁」的漂移
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO writing_chapter_snapshots
             (id, chapter_id, book_id, content, word_count, origin, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                snapshot.id,
                snapshot.chapter_id,
                snapshot.book_id,
                snapshot.content,
                snapshot.word_count,
                snapshot.origin,
                snapshot.created_at,
            ],
        )?;
        tx.execute(
            "DELETE FROM writing_chapter_snapshots WHERE chapter_id = ?1 AND id NOT IN (
                 SELECT id FROM writing_chapter_snapshots WHERE chapter_id = ?1
                 ORDER BY created_at DESC, id DESC LIMIT ?2
             )",
            rusqlite::params![snapshot.chapter_id, keep_per_chapter],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn list_chapter_snapshots(
        &self,
        chapter_id: &str,
        limit: i64,
    ) -> AppResult<Vec<WritingChapterSnapshot>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SNAPSHOT_COLS} FROM writing_chapter_snapshots WHERE chapter_id = ?1 \
             ORDER BY created_at DESC, id DESC LIMIT ?2"
        ))?;
        let rows = stmt
            .query_map(rusqlite::params![chapter_id, limit], row_to_snapshot)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn delete_chapter(&self, id: &str) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // 删除传播矩阵（P0 一致性，零强制）：删章只删章节行本身，绝不连带删内容。
        // 时间线事件 / 伏笔 / 大纲条目全部保留，仅把指向该章的引用解绑回「未绑定章」——
        // 与删线（storyline）同语义：创作者删除结构，不没收其创作内容。
        // 事务内完成，解绑 + 删除任一步失败整体回滚。
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE writing_timeline_events SET chapter_id = NULL WHERE chapter_id = ?1",
            [id],
        )?;
        tx.execute(
            "UPDATE writing_foreshadowings SET plant_chapter_id = NULL, payoff_chapter_id = NULL \
             WHERE plant_chapter_id = ?1 OR payoff_chapter_id = ?1",
            [id],
        )?;
        tx.execute(
            "UPDATE writing_outlines SET chapter_id = NULL WHERE chapter_id = ?1",
            [id],
        )?;
        tx.execute(
            "DELETE FROM writing_annotations WHERE chapter_id = ?1",
            [id],
        )?;
        tx.execute(
            "UPDATE writing_notes SET chapter_id = '' WHERE chapter_id = ?1",
            [id],
        )?;
        tx.execute("DELETE FROM writing_chapters WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    fn list_notes(&self, book_id: &str) -> AppResult<Vec<WritingNote>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {NOTE_COLS} FROM writing_notes WHERE book_id = ?1 \
             ORDER BY pin DESC, updated_at DESC, created_at DESC"
        ))?;
        let rows = stmt
            .query_map([book_id], row_to_note)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn save_note(&self, item: &WritingNote) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_notes
             (id, book_id, chapter_id, content, tags, pin, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                item.id,
                item.book_id,
                item.chapter_id,
                item.content,
                item.tags,
                item.pin,
                item.created_at,
                item.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_note(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM writing_notes WHERE id = ?1", [id])?;
        Ok(())
    }

    fn unbind_notes_from_chapter(&self, chapter_id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE writing_notes SET chapter_id = '' WHERE chapter_id = ?1",
            [chapter_id],
        )?;
        Ok(())
    }

    fn list_settings(&self, book_id: &str, kind: &str) -> AppResult<Vec<WritingSetting>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SETTING_COLS} FROM writing_settings WHERE book_id = ?1 AND kind = ?2 ORDER BY sort_order ASC, created_at ASC"
        ))?;
        let settings = stmt
            .query_map([book_id, kind], row_to_setting)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(settings)
    }

    fn save_setting(&self, setting: &WritingSetting) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_settings
             (id, book_id, kind, name, subtitle, description, extra, sort_order, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                setting.id,
                setting.book_id,
                setting.kind,
                setting.name,
                setting.subtitle,
                setting.description,
                setting.extra,
                setting.sort_order,
                setting.created_at,
                setting.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_setting(&self, id: &str) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // 删除传播矩阵（P0 一致性，零强制）：删设定只删设定卡本身，事件保留，
        // 仅把 setting_id 解绑回「书级事件」（时间线事件 = 全书级实体，不因
        // 某张卡的删除而消失——后续可重新挂到别的卡或留在书级轨）。
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE writing_timeline_events SET setting_id = NULL WHERE setting_id = ?1",
            [id],
        )?;
        tx.execute("DELETE FROM writing_settings WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    fn record_daily_snapshot(&self, book_id: &str, day: &str) -> AppResult<i64> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(word_count), 0) FROM writing_chapters \
             WHERE book_id = ?1 AND COALESCE(json_extract(extra, '$.deletedAt'), 0) <= 0",
            [book_id],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO writing_daily_stats (book_id, day, word_count, updated_at)
             VALUES (?1, ?2, ?3, strftime('%s', 'now'))
             ON CONFLICT(book_id, day) DO UPDATE SET
               word_count = excluded.word_count,
               updated_at = excluded.updated_at",
            rusqlite::params![book_id, day, total],
        )?;
        Ok(total)
    }

    fn list_daily_stats(&self, book_id: &str, days: i64) -> AppResult<Vec<WritingDailyStat>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT day, word_count FROM writing_daily_stats \
             WHERE book_id = ?1 AND day >= date('now', ?2) ORDER BY day ASC",
        )?;
        let since = format!("-{} days", days.saturating_sub(1));
        let stats = stmt
            .query_map(rusqlite::params![book_id, since], |row| {
                Ok(WritingDailyStat {
                    day: row.get("day")?,
                    word_count: row.get("word_count")?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(stats)
    }

    fn list_outlines(&self, book_id: &str) -> AppResult<Vec<WritingOutline>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {OUTLINE_COLS} FROM writing_outlines WHERE book_id = ?1 ORDER BY sort_order ASC, created_at ASC"
        ))?;
        let outlines = stmt
            .query_map([book_id], row_to_outline)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(outlines)
    }

    fn save_outline(&self, outline: &WritingOutline) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_outlines
             (id, book_id, title, summary, chapter_id, extra, sort_order, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                outline.id,
                outline.book_id,
                outline.title,
                outline.summary,
                outline.chapter_id,
                outline.extra,
                outline.sort_order,
                outline.created_at,
                outline.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_outline(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM writing_outlines WHERE id = ?1", [id])?;
        Ok(())
    }

    fn list_timeline_events(&self, book_id: &str) -> AppResult<Vec<WritingTimelineEvent>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {TIMELINE_EVENT_COLS} FROM writing_timeline_events WHERE book_id = ?1 ORDER BY sort_order ASC, created_at ASC"
        ))?;
        let events = stmt
            .query_map([book_id], row_to_timeline_event)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(events)
    }

    fn save_timeline_event(&self, event: &WritingTimelineEvent) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_timeline_events
             (id, book_id, setting_id, at, event, chapter_id, storyline_id, sort_order, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                event.id,
                event.book_id,
                event.setting_id,
                event.at,
                event.event,
                event.chapter_id,
                event.storyline_id,
                event.sort_order,
                event.created_at,
                event.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_timeline_event(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM writing_timeline_events WHERE id = ?1", [id])?;
        Ok(())
    }

    fn list_storylines(&self, book_id: &str) -> AppResult<Vec<WritingStoryline>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {STORYLINE_COLS} FROM writing_storylines WHERE book_id = ?1 ORDER BY sort_order ASC, created_at ASC"
        ))?;
        let items = stmt
            .query_map([book_id], row_to_storyline)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_storyline(&self, storyline: &WritingStoryline) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_storylines
             (id, book_id, name, color, description, sort_order, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                storyline.id,
                storyline.book_id,
                storyline.name,
                storyline.color,
                storyline.description,
                storyline.sort_order,
                storyline.created_at,
                storyline.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_storyline(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM writing_storylines WHERE id = ?1", [id])?;
        // 删线不删事件：挂线事件回到「未挂线」（零强制）。
        conn.execute(
            "UPDATE writing_timeline_events SET storyline_id = NULL WHERE storyline_id = ?1",
            [id],
        )?;
        // 删线同样不删伏笔：挂线伏笔回到「未挂线」（零强制）。
        conn.execute(
            "UPDATE writing_foreshadowings SET storyline_id = NULL WHERE storyline_id = ?1",
            [id],
        )?;
        // 删线不删章节（零强制）：挂线章节回到「未挂线」（G1 章→线直连后同步解绑）。
        conn.execute(
            "UPDATE writing_chapters SET storyline_id = NULL WHERE storyline_id = ?1",
            [id],
        )?;
        Ok(())
    }

    fn list_foreshadowings(&self, book_id: &str) -> AppResult<Vec<WritingForeshadowing>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {FORESHADOWING_COLS} FROM writing_foreshadowings WHERE book_id = ?1 ORDER BY sort_order ASC, created_at ASC"
        ))?;
        let items = stmt
            .query_map([book_id], row_to_foreshadowing)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_foreshadowing(&self, item: &WritingForeshadowing) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_foreshadowings
             (id, book_id, title, description, plant_chapter_id, payoff_chapter_id, status, storyline_id, sort_order, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                item.id,
                item.book_id,
                item.title,
                item.description,
                item.plant_chapter_id,
                item.payoff_chapter_id,
                item.status,
                item.storyline_id,
                item.sort_order,
                item.created_at,
                item.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_foreshadowing(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM writing_foreshadowings WHERE id = ?1", [id])?;
        Ok(())
    }

    fn list_annotations(&self, chapter_id: &str) -> AppResult<Vec<WritingAnnotation>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {ANNOTATION_COLS} FROM writing_annotations WHERE chapter_id = ?1 \
             ORDER BY created_at DESC, id DESC"
        ))?;
        let rows = stmt
            .query_map([chapter_id], row_to_annotation)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn save_annotation(&self, item: &WritingAnnotation) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO writing_annotations
             (id, chapter_id, book_id, text, excerpt, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                item.id,
                item.chapter_id,
                item.book_id,
                item.text,
                item.excerpt,
                item.created_at,
                item.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete_annotation(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM writing_annotations WHERE id = ?1", [id])?;
        Ok(())
    }

    fn list_completed_works(&self) -> AppResult<Vec<CompletedWork>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COMPLETED_WORK_COLS} FROM completed_works ORDER BY created_at DESC, id DESC"
        ))?;
        let works = stmt
            .query_map([], row_to_completed_work)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(works)
    }

    fn save_completed_work(&self, work: &CompletedWork) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO completed_works
             (id, book_id, book_title, format, file_path, file_size, is_file_missing, word_count, chapter_count, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                work.id,
                work.book_id,
                work.book_title,
                work.format,
                work.file_path,
                work.file_size,
                work.is_file_missing,
                work.word_count,
                work.chapter_count,
                work.created_at,
            ],
        )?;
        Ok(())
    }

    fn delete_completed_work(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM completed_works WHERE id = ?1", [id])?;
        Ok(())
    }

    fn find_completed_work_by_path(&self, file_path: &str) -> AppResult<Option<CompletedWork>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COMPLETED_WORK_COLS} FROM completed_works WHERE file_path = ?1 LIMIT 1"
        ))?;
        let mut rows = stmt.query_map([file_path], row_to_completed_work)?;
        match rows.next() {
            Some(Ok(work)) => Ok(Some(work)),
            Some(Err(e)) => Err(AppError::Internal(e.to_string())),
            None => Ok(None),
        }
    }

    fn update_completed_work_path(
        &self,
        id: &str,
        new_path: &str,
        file_size: i64,
    ) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE completed_works SET file_path = ?2, file_size = ?3 WHERE id = ?1",
            rusqlite::params![id, new_path, file_size],
        )?;
        Ok(())
    }

    fn count_completed_works(&self, book_id: &str, format: &str) -> AppResult<i64> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let count = if format.is_empty() {
            conn.query_row(
                "SELECT COUNT(*) FROM completed_works WHERE book_id = ?1",
                [book_id],
                |r| r.get(0),
            )?
        } else {
            conn.query_row(
                "SELECT COUNT(*) FROM completed_works WHERE book_id = ?1 AND format = ?2",
                rusqlite::params![book_id, format],
                |r| r.get(0),
            )?
        };
        Ok(count)
    }

    fn set_completed_work_missing(&self, id: &str, is_missing: bool) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE completed_works SET is_file_missing = ?2 WHERE id = ?1",
            rusqlite::params![id, is_missing as i64],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::{init_tables, migrate};
    use rusqlite::Connection;
    use std::sync::Mutex;

    /// 走**生产同一套建表 + 迁移**，而不是在测试里手抄一份 schema ——
    /// 手抄的 schema 会和 migration 各自漂移，测出来的绿是假的。
    fn make_repo() -> SqliteWritingRepository {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        migrate(&conn).unwrap();
        SqliteWritingRepository::new(Arc::new(Database(Mutex::new(conn))))
    }

    fn sample_book(id: &str) -> WritingBook {
        WritingBook {
            id: id.into(),
            title: "长夜".into(),
            description: None,
            genre: "novel".into(),
            medium: "serial".into(),
            status: "draft".into(),
            cover_color: "#4A338F".into(),
            daily_goal: 0,
            extra: "{}".into(),
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        }
    }

    fn table_cols(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    /// 事故回归（2026-09-12）：`medium` 加进了模型 / INSERT / `row_to_book`，
    /// **独独漏了 `BOOK_COLS` 的 SELECT 列清单**。`row.get("medium")` 于是抛
    /// `InvalidColumnName`（rusqlite 的列名错误，不是 SQL 报错，日志里根本看不到 SQL），
    /// `list_books()` 整体失败 → books 恒为空 → 工作室 L1 作品栏整条空白。
    ///
    /// 这里锁的是**「显式列清单 ≡ 表实际列」**这个不变量：row mapper 按列名读能扛住
    /// ALTER 改列序，但**扛不住 SELECT 清单漏列**。加列的人只要漏掉清单里的名字，
    /// 这个测试立刻红，不用等运行期报错。
    #[test]
    fn cols_lists_cover_every_column_of_each_table() {
        let repo = make_repo();
        let conn = repo.db.0.lock().unwrap();
        for (table, cols) in [
            ("writing_books", BOOK_COLS),
            ("writing_chapters", CHAPTER_COLS),
            ("writing_settings", SETTING_COLS),
            ("writing_outlines", OUTLINE_COLS),
            ("writing_timeline_events", TIMELINE_EVENT_COLS),
            ("writing_storylines", STORYLINE_COLS),
            ("writing_foreshadowings", FORESHADOWING_COLS),
            ("writing_chapter_snapshots", SNAPSHOT_COLS),
            ("writing_annotations", ANNOTATION_COLS),
            ("writing_notes", NOTE_COLS),
            ("completed_works", COMPLETED_WORK_COLS),
        ] {
            let listed: Vec<String> = cols.split(',').map(|c| c.trim().to_string()).collect();
            let real = table_cols(&conn, table);
            let mut missing: Vec<_> = real.iter().filter(|c| !listed.contains(c)).collect();
            let mut unknown: Vec<_> = listed.iter().filter(|c| !real.contains(c)).collect();
            missing.sort();
            unknown.sort();
            assert!(
                missing.is_empty() && unknown.is_empty(),
                "{table} 的列清单与表结构不一致：清单漏了 {missing:?}，清单里表里没有 {unknown:?}"
            );
        }
    }

    /// 行为锁：体裁×载体必须**存取往返不丢**。
    /// 断言的是读回来的值，所以任何一环（INSERT 列、SELECT 清单、row mapper）漏了
    /// `medium` 都会在这里断掉，而不是在用户面前变成一片空白。
    #[test]
    fn book_roundtrip_keeps_genre_and_medium() {
        let repo = make_repo();

        let mut book = sample_book("book_roundtrip");
        repo.save_book(&book).unwrap();

        let got = repo
            .get_book("book_roundtrip")
            .unwrap()
            .expect("save 后应当读得回来");
        assert_eq!(got.genre, "novel");
        assert_eq!(got.medium, "serial", "medium 在落库/取数链路上丢了");

        let listed = repo.list_books().unwrap();
        assert_eq!(listed.len(), 1, "list_books 应当返回刚存进去的那本");
        assert_eq!(listed[0].medium, "serial", "list_books 的列清单漏了 medium");

        // 全字段一起比对，任何一列漏出 SELECT 清单都会在这里暴露
        book.updated_at = 1_700_000_999;
        repo.save_book(&book).unwrap();
        let again = repo.get_book("book_roundtrip").unwrap().unwrap();
        assert_eq!(again.updated_at, 1_700_000_999);
        assert_eq!(again.cover_color, book.cover_color);
        assert_eq!(again.status, book.status);
        assert_eq!(again.daily_goal, book.daily_goal);
    }

    /// 旧书兼容：早于「体裁×载体」的书 medium 为空串，必须仍能正常读出
    /// （这条是书场景 `bookGenre` 三级回落的前提，不许在仓储层被过滤掉）。
    #[test]
    fn book_without_medium_still_reads() {
        let repo = make_repo();
        let mut book = sample_book("book_legacy");
        book.genre = String::new();
        book.medium = String::new();
        repo.save_book(&book).unwrap();

        let got = repo.get_book("book_legacy").unwrap().unwrap();
        assert_eq!(got.genre, "");
        assert_eq!(got.medium, "");
        assert_eq!(repo.list_books().unwrap().len(), 1);
    }

    /// 章 extra 往返（批次 2 章头图）：章头图引用存 `extra.coverImage`，
    /// 必须存取往返不丢，且 list_chapters 的列清单漏列会立刻红（不变量测试兜底）。
    fn sample_chapter(book_id: &str, id: &str) -> WritingChapter {
        WritingChapter {
            id: id.into(),
            book_id: book_id.into(),
            title: "第一章".into(),
            content: "<p>正文</p>".into(),
            sort_order: 0,
            word_count: 2,
            status: "draft".into(),
            volume: String::new(),
            parent_id: None,
            kind: "章".into(),
            storyline_id: None,
            extra: "{}".into(),
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        }
    }

    /// title-only 改名（2026-09-22）：rename_chapter 只更新 title 与 updated_at，
    /// **绝不动 content**——save_chapter 是 INSERT OR REPLACE 整行覆写，若改名走
    /// 整行落库，前端内存里的旧正文会把并发编辑中的新内容回滚掉（「一键出多字」
    /// 的库侧放大因子）。这条锁死 UPDATE 只碰 title/updated_at 两列。
    #[test]
    fn rename_chapter_updates_title_only() {
        let repo = make_repo();
        let book = sample_book("book_rename");
        repo.save_book(&book).unwrap();

        let mut ch = sample_chapter("book_rename", "ch_rename");
        ch.content = "<p>磁盘上的新正文</p>".into();
        ch.word_count = 7;
        repo.save_chapter(&ch).unwrap();

        repo.rename_chapter("ch_rename", "第一章 · 改", 1_700_000_999)
            .unwrap();

        let got = repo
            .get_chapter("ch_rename")
            .unwrap()
            .expect("改名后应读得回来");
        assert_eq!(got.title, "第一章 · 改");
        assert_eq!(got.content, "<p>磁盘上的新正文</p>", "改名不得触碰 content");
        assert_eq!(got.updated_at, 1_700_000_999);
        assert_eq!(got.word_count, 7, "除 title/updated_at 外其余列应原样");
        assert_eq!(got.sort_order, ch.sort_order);
        assert_eq!(got.kind, "章");
    }

    /// content-only 正文保存（批次①）：save_chapter_content 只更新 content/word_count/
    /// updated_at——若误改回整行覆写，这条会以「title/kind 被旧值回滚」的方式变红。
    #[test]
    fn save_chapter_content_updates_content_only() {
        let repo = make_repo();
        let book = sample_book("book_content");
        repo.save_book(&book).unwrap();

        let mut ch = sample_chapter("book_content", "ch_content");
        ch.title = "磁盘上的新标题".into();
        ch.kind = "节".into();
        repo.save_chapter(&ch).unwrap();

        repo.save_chapter_content("ch_content", "<p>新正文</p>", 3, 1_700_000_999)
            .unwrap();

        let got = repo.get_chapter("ch_content").unwrap().unwrap();
        assert_eq!(got.content, "<p>新正文</p>");
        assert_eq!(got.word_count, 3);
        assert_eq!(got.updated_at, 1_700_000_999);
        assert_eq!(got.title, "磁盘上的新标题", "content 保存不得触碰 title");
        assert_eq!(got.kind, "节", "content 保存不得触碰 kind");
    }

    /// 版本快照（批次④）：追加 + 每章裁剪到上限；列表按 created_at 倒序。
    #[test]
    fn snapshot_roundtrip_and_prune() {
        let repo = make_repo();
        let book = sample_book("book_snap");
        repo.save_book(&book).unwrap();

        for i in 0..25 {
            repo.save_chapter_snapshot(
                &WritingChapterSnapshot {
                    id: format!("snap_{i:02}"),
                    chapter_id: "ch_snap".into(),
                    book_id: "book_snap".into(),
                    content: format!("<p>v{i}</p>"),
                    word_count: i,
                    origin: "auto".into(),
                    created_at: 1_700_000_000 + i,
                },
                20,
            )
            .unwrap();
        }
        let listed = repo.list_chapter_snapshots("ch_snap", 20).unwrap();
        assert_eq!(listed.len(), 20, "超过上限应被裁剪");
        // 倒序：最新在前
        assert_eq!(listed[0].id, "snap_24");
        assert_eq!(listed[19].id, "snap_05", "最旧的 5 份应被裁掉");
    }

    #[test]
    fn chapter_roundtrip_keeps_extra_cover_image() {
        let repo = make_repo();
        let book = sample_book("book_ch_extra");
        repo.save_book(&book).unwrap();

        let mut ch = sample_chapter("book_ch_extra", "ch_cover");
        ch.extra = r#"{"coverImage":"assets/writing/illustrations/cover01.png"}"#.into();
        repo.save_chapter(&ch).unwrap();

        let got = repo
            .get_chapter("ch_cover")
            .unwrap()
            .expect("save 后应当读得回");
        assert_eq!(
            got.extra, r#"{"coverImage":"assets/writing/illustrations/cover01.png"}"#,
            "章头图引用在落库/取数链路上丢了"
        );

        let listed = repo.list_chapters("book_ch_extra").unwrap();
        assert_eq!(listed.len(), 1, "list_chapters 应当返回刚存进去的那章");
        assert_eq!(
            listed[0].extra, r#"{"coverImage":"assets/writing/illustrations/cover01.png"}"#,
            "list_chapters 的列清单漏了 extra"
        );
    }

    /// 旧章兼容：extra 为默认空 JSON 串的章，必须仍能正常读出（不加列前写的库）
    #[test]
    fn chapter_without_extra_still_reads() {
        let repo = make_repo();
        let book = sample_book("book_ch_legacy");
        repo.save_book(&book).unwrap();

        let ch = sample_chapter("book_ch_legacy", "ch_legacy");
        repo.save_chapter(&ch).unwrap();

        let got = repo.get_chapter("ch_legacy").unwrap().unwrap();
        assert_eq!(got.extra, "{}");
        assert_eq!(repo.list_chapters("book_ch_legacy").unwrap().len(), 1);
    }

    /// 完结作品记录（Phase 2）：save→list 往返 + delete 删除（已先经
    /// `cols_lists_cover_every_column_of_each_table` 锁列清单一致性，这里锁行为）。
    fn sample_completed_work(id: &str) -> CompletedWork {
        CompletedWork {
            id: id.into(),
            book_id: "book_cw".into(),
            book_title: "长夜".into(),
            format: "epub".into(),
            file_path: "/tmp/长夜.epub".into(),
            file_size: 2_097_152,
            is_file_missing: false,
            word_count: 120_000,
            chapter_count: 8,
            created_at: 1_700_000_000,
        }
    }

    #[test]
    fn completed_work_roundtrip_and_delete() {
        let repo = make_repo();
        let book = sample_book("book_cw");
        repo.save_book(&book).unwrap();

        let mut epub = sample_completed_work("cw_epub");
        repo.save_completed_work(&epub).unwrap();
        let mut pdf = sample_completed_work("cw_pdf");
        pdf.format = "pdf".into();
        pdf.file_size = 8_589_934;
        pdf.created_at = 1_700_000_100;
        repo.save_completed_work(&pdf).unwrap();

        let listed = repo.list_completed_works().unwrap();
        assert_eq!(listed.len(), 2, "list 应返回刚存进去的两条");
        // created_at DESC：最新在前
        assert_eq!(listed[0].id, "cw_pdf");
        assert_eq!(listed[0].file_size, 8_589_934, "file_size 存取往返不丢");
        assert_eq!(listed[1].format, "epub");
        assert_eq!(listed[1].book_title, "长夜");
        assert_eq!(listed[1].chapter_count, 8);

        // 同名 id 覆盖（INSERT OR REPLACE）
        epub.word_count = 121_000;
        repo.save_completed_work(&epub).unwrap();
        let listed = repo.list_completed_works().unwrap();
        assert_eq!(listed.len(), 2, "同 id 重存是覆盖不是新增");
        assert_eq!(listed[1].word_count, 121_000);

        // 删除只删记录
        repo.delete_completed_work("cw_epub").unwrap();
        let listed = repo.list_completed_works().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "cw_pdf");
    }

    #[test]
    fn completed_work_find_by_path_and_update_path() {
        let repo = make_repo();
        let book = sample_book("book_cw");
        repo.save_book(&book).unwrap();
        let epub = sample_completed_work("cw_path");
        repo.save_completed_work(&epub).unwrap();

        // 按路径查重：命中与未命中
        let hit = repo.find_completed_work_by_path("/tmp/长夜.epub").unwrap();
        assert!(hit.is_some(), "同路径应查得到");
        assert_eq!(hit.unwrap().id, "cw_path");
        let miss = repo
            .find_completed_work_by_path("/tmp/不存在的书.epub")
            .unwrap();
        assert!(miss.is_none(), "不同路径不应命中");

        // 改名/改目录：更新 file_path + file_size，其余字段不动
        repo.update_completed_work_path("cw_path", "/Documents/长夜_v2.epub", 3_145_728)
            .unwrap();
        let listed = repo.list_completed_works().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_path, "/Documents/长夜_v2.epub");
        assert_eq!(listed[0].file_size, 3_145_728);
        assert_eq!(listed[0].book_id, "book_cw", "未变字段应保持");
        // 旧路径不再命中，新路径命中
        let old_hit = repo.find_completed_work_by_path("/tmp/长夜.epub").unwrap();
        assert!(old_hit.is_none(), "旧路径更新后不应再命中");
        let new_hit = repo
            .find_completed_work_by_path("/Documents/长夜_v2.epub")
            .unwrap();
        assert!(new_hit.is_some());
    }

    /// T3：按 (book_id, format) 统计数量 —— 写作台「已有 n 个 PDF」的数据源。
    #[test]
    fn completed_work_count_by_book_and_format() {
        let repo = make_repo();
        let book = sample_book("book_cw");
        repo.save_book(&book).unwrap();

        let mut epub = sample_completed_work("cw_epub");
        repo.save_completed_work(&epub).unwrap();
        let mut pdf1 = sample_completed_work("cw_pdf1");
        pdf1.format = "pdf".into();
        repo.save_completed_work(&pdf1).unwrap();
        let mut pdf2 = sample_completed_work("cw_pdf2");
        pdf2.format = "pdf".into();
        pdf2.id = "cw_pdf2".into();
        repo.save_completed_work(&pdf2).unwrap();

        // 空串 format = 该书全部格式
        assert_eq!(repo.count_completed_works("book_cw", "").unwrap(), 3);
        assert_eq!(repo.count_completed_works("book_cw", "pdf").unwrap(), 2);
        assert_eq!(repo.count_completed_works("book_cw", "epub").unwrap(), 1);
        assert_eq!(repo.count_completed_works("book_cw", "docx").unwrap(), 0);
        // 其他书不受影响
        assert_eq!(repo.count_completed_works("book_other", "pdf").unwrap(), 0);
    }

    /// T3：文件缺失标记往返 + 仅标记位更新、其余字段保持。
    #[test]
    fn completed_work_missing_flag_roundtrip() {
        let repo = make_repo();
        let book = sample_book("book_cw");
        repo.save_book(&book).unwrap();
        let epub = sample_completed_work("cw_missing");
        repo.save_completed_work(&epub).unwrap();

        assert!(!repo.list_completed_works().unwrap()[0].is_file_missing);

        repo.set_completed_work_missing("cw_missing", true).unwrap();
        let listed = repo.list_completed_works().unwrap();
        assert!(listed[0].is_file_missing, "缺失标记应读回 true");
        assert_eq!(
            listed[0].file_path, "/tmp/长夜.epub",
            "标记更新不动其它字段"
        );

        repo.set_completed_work_missing("cw_missing", false)
            .unwrap();
        assert!(!repo.list_completed_works().unwrap()[0].is_file_missing);
    }

    /// 时间线事件（D）：setting_id 绑定 + NULL 两种，存取往返不丢，list 列清单覆盖。
    fn sample_timeline_event(
        book_id: &str,
        id: &str,
        setting_id: Option<&str>,
    ) -> WritingTimelineEvent {
        WritingTimelineEvent {
            id: id.into(),
            book_id: book_id.into(),
            setting_id: setting_id.map(|s| s.to_string()),
            at: "第3年".into(),
            event: "主角登基".into(),
            chapter_id: Some("ch1".into()),
            storyline_id: None,
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        }
    }

    #[test]
    fn timeline_event_roundtrip_keeps_fields() {
        let repo = make_repo();
        let book = sample_book("book_tl");
        repo.save_book(&book).unwrap();

        let bound = sample_timeline_event("book_tl", "ev_bound", Some("set1"));
        let book_level = sample_timeline_event("book_tl", "ev_book", None);
        repo.save_timeline_event(&bound).unwrap();
        repo.save_timeline_event(&book_level).unwrap();

        let listed = repo.list_timeline_events("book_tl").unwrap();
        assert_eq!(listed.len(), 2, "应当列出刚存进去的两条时间线事件");
        let got_bound = listed.iter().find(|e| e.id == "ev_bound").unwrap();
        assert_eq!(got_bound.setting_id.as_deref(), Some("set1"));
        assert_eq!(got_bound.at, "第3年");
        assert_eq!(got_bound.event, "主角登基");
        assert_eq!(got_bound.chapter_id.as_deref(), Some("ch1"));
        let got_book = listed.iter().find(|e| e.id == "ev_book").unwrap();
        assert!(
            got_book.setting_id.is_none(),
            "书级事件 setting_id 必须为 NULL"
        );
        assert!(
            got_book.storyline_id.is_none(),
            "未挂线事件 storyline_id 必须为 NULL"
        );
    }

    /// 剧情线（P0 核心闭环）：CRUD 往返 + 删线不删事件（挂线事件 storyline_id 置 NULL）。
    fn sample_storyline(book_id: &str, id: &str, name: &str) -> WritingStoryline {
        WritingStoryline {
            id: id.into(),
            book_id: book_id.into(),
            name: name.into(),
            color: "#ec4899".into(),
            description: String::new(),
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        }
    }

    #[test]
    fn storyline_crud_and_delete_detaches_events() {
        let repo = make_repo();
        let book = sample_book("book_sl");
        repo.save_book(&book).unwrap();

        repo.save_storyline(&sample_storyline("book_sl", "sl_main", "主线"))
            .unwrap();
        let listed = repo.list_storylines("book_sl").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "主线");
        assert_eq!(listed[0].color, "#ec4899");

        // 挂线事件
        let mut ev = sample_timeline_event("book_sl", "ev_sl", None);
        ev.storyline_id = Some("sl_main".into());
        repo.save_timeline_event(&ev).unwrap();

        // 删线：事件保留、storyline_id 置 NULL
        repo.delete_storyline("sl_main").unwrap();
        assert!(repo.list_storylines("book_sl").unwrap().is_empty());
        let events = repo.list_timeline_events("book_sl").unwrap();
        assert_eq!(events.len(), 1, "删线不得删事件");
        assert!(
            events[0].storyline_id.is_none(),
            "删线后事件应回到「未挂线」"
        );
    }

    /// G1 章→线直连：章节挂线默认空、set_chapter_storyline 挂线/解绑往返（mentionable-only 更新，
    /// 不碰 content/title）、删线把挂线章节解绑回「未挂线」（零强制：删线不删章）。
    #[test]
    fn chapter_storyline_roundtrip_and_delete_detaches_chapters() {
        let repo = make_repo();
        let book = sample_book("book_sl_ch");
        repo.save_book(&book).unwrap();
        repo.save_storyline(&sample_storyline("book_sl_ch", "sl_a", "A线"))
            .unwrap();

        // 新章节默认未挂线
        let mut ch = sample_chapter("book_sl_ch", "ch_sl");
        ch.content = "<p>必须留在库里</p>".into();
        ch.title = "孤儿章".into();
        repo.save_chapter(&ch).unwrap();

        // 挂线
        repo.set_chapter_storyline("ch_sl", Some("sl_a"), 1_700_000_001)
            .unwrap();
        let got = repo.get_chapter("ch_sl").unwrap().expect("应当读得回来");
        assert_eq!(got.storyline_id.as_deref(), Some("sl_a"));
        // storyline-only 更新不能回滚 content/title（防并发回滚原则）
        assert_eq!(got.content, "<p>必须留在库里</p>");
        assert_eq!(got.title, "孤儿章");

        // 解绑
        repo.set_chapter_storyline("ch_sl", None, 1_700_000_002)
            .unwrap();
        let got = repo.get_chapter("ch_sl").unwrap().unwrap();
        assert!(got.storyline_id.is_none(), "显式解绑后应回到「未挂线」");

        // 再挂线，删线只解绑不删章
        repo.set_chapter_storyline("ch_sl", Some("sl_a"), 1_700_000_003)
            .unwrap();
        repo.delete_storyline("sl_a").unwrap();
        let got = repo.get_chapter("ch_sl").unwrap().unwrap();
        assert!(got.storyline_id.is_none(), "删线后挂线章节应回到「未挂线」");
        assert_eq!(got.content, "<p>必须留在库里</p>", "删线不得动章节内容");
        assert_eq!(
            repo.list_chapters("book_sl_ch").unwrap().len(),
            1,
            "删线不得删章节"
        );
    }

    /// 伏笔（「埋设 → 回收」承诺）：CRUD 往返（章绑定/状态/挂线全字段）+ 删线不删伏笔（置 NULL）。
    fn sample_foreshadowing(book_id: &str, id: &str, title: &str) -> WritingForeshadowing {
        WritingForeshadowing {
            id: id.into(),
            book_id: book_id.into(),
            title: title.into(),
            description: String::new(),
            plant_chapter_id: None,
            payoff_chapter_id: None,
            status: "pending".into(),
            storyline_id: None,
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        }
    }

    #[test]
    fn foreshadowing_crud_and_delete_detaches_storyline() {
        let repo = make_repo();
        let book = sample_book("book_fs");
        repo.save_book(&book).unwrap();

        let mut fs = sample_foreshadowing("book_fs", "fs_1", "怀表的去向");
        fs.description = "第三章出现的怀表，背面刻着名字".into();
        fs.plant_chapter_id = Some("ch_1".into());
        fs.payoff_chapter_id = Some("ch_9".into());
        fs.status = "pending".into();
        fs.storyline_id = Some("sl_x".into());
        repo.save_foreshadowing(&fs).unwrap();

        let listed = repo.list_foreshadowings("book_fs").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "怀表的去向");
        assert_eq!(listed[0].plant_chapter_id.as_deref(), Some("ch_1"));
        assert_eq!(listed[0].payoff_chapter_id.as_deref(), Some("ch_9"));
        assert_eq!(listed[0].status, "pending");
        assert_eq!(listed[0].storyline_id.as_deref(), Some("sl_x"));

        // 更新（状态闭环：pending → paidoff）
        fs.status = "paidoff".into();
        fs.updated_at = 1_700_000_100;
        repo.save_foreshadowing(&fs).unwrap();
        let got = repo.list_foreshadowings("book_fs").unwrap();
        assert_eq!(got[0].status, "paidoff");

        // 删线：伏笔保留、storyline_id 置 NULL（零强制）
        repo.delete_storyline("sl_x").unwrap();
        let after = repo.list_foreshadowings("book_fs").unwrap();
        assert_eq!(after.len(), 1, "删线不得删伏笔");
        assert!(
            after[0].storyline_id.is_none(),
            "删线后伏笔应回到「未挂线」"
        );

        // 删除
        repo.delete_foreshadowing("fs_1").unwrap();
        assert!(repo.list_foreshadowings("book_fs").unwrap().is_empty());
    }

    /// 数据迁移（D）：设定卡 extra.timeline 应按确定性 ID 灌入新表，并从 extra 剥离（保留其余字段）。
    #[test]
    fn timeline_events_migrated_from_setting_extra() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        conn.execute(
            "INSERT INTO writing_books (id, title, genre, status, cover_color, created_at, updated_at)
             VALUES ('b1','书','novel','draft','#4A338F',1700000000,1700000000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO writing_settings (id, book_id, kind, name, subtitle, description, extra, sort_order, created_at, updated_at)
             VALUES ('s1','b1','character','阿强','主角','',?1,0,1700000000,1700000000)",
            rusqlite::params![r#"{"timeline":[{"at":"第1年","event":"出生","chapterId":"c1"},{"at":"第2年","event":""}],"profile":{"appearance":"高"}}"#],
        )
        .unwrap();
        // 跑迁移（与启动同一条 migrate）
        migrate(&conn).unwrap();

        let migrated: Vec<(String, String, Option<String>, String, String)> = conn
            .prepare("SELECT id, book_id, setting_id, at, event FROM writing_timeline_events ORDER BY id")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(migrated.len(), 1, "空 event 的脏数据应被跳过");
        assert_eq!(
            migrated[0].0, "ev_s1_0",
            "迁移 ID 必须确定性 = ev_{{settingId}}_{{index}}"
        );
        assert_eq!(migrated[0].2.as_deref(), Some("s1"));
        assert_eq!(migrated[0].3, "第1年");
        assert_eq!(migrated[0].4, "出生");

        let extra: String = conn
            .query_row(
                "SELECT extra FROM writing_settings WHERE id='s1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            !extra.contains("timeline"),
            "迁移后应从 extra 剥离 timeline"
        );
        assert!(
            extra.contains("profile"),
            "迁移不应破坏其他 extra 字段（profile）"
        );

        // 幂等：再跑一次 migrate，不应重复插入（INSERT OR IGNORE + ID 确定性）
        migrate(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM writing_timeline_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1, "重复 migrate 不应重复插入");
    }

    /// 删除传播矩阵（P0 一致性）① 删书：级联清掉全部子域行（章节/设定/大纲/
    /// 时间线/剧情线/伏笔/日快照），不留孤儿——书删除后各表必须没有任何残留。
    #[test]
    fn delete_book_cascades_all_writing_tables() {
        let repo = make_repo();
        let book = sample_book("book_del_all");
        repo.save_book(&book).unwrap();

        repo.save_setting(&WritingSetting {
            id: "set_del".into(),
            book_id: book.id.clone(),
            kind: "character".into(),
            name: "要删的人".into(),
            subtitle: String::new(),
            description: String::new(),
            extra: "{}".into(),
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        })
        .unwrap();
        repo.save_chapter(&sample_chapter(&book.id, "ch_del"))
            .unwrap();
        repo.save_outline(&WritingOutline {
            id: "out_del".into(),
            book_id: book.id.clone(),
            title: "删书大纲".into(),
            summary: String::new(),
            chapter_id: None,
            extra: "{}".into(),
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        })
        .unwrap();
        repo.save_timeline_event(&sample_timeline_event(&book.id, "ev_del", None))
            .unwrap();
        repo.save_storyline(&sample_storyline(&book.id, "sl_del", "删书线"))
            .unwrap();
        repo.save_foreshadowing(&sample_foreshadowing(&book.id, "fs_del", "删书伏笔"))
            .unwrap();
        repo.record_daily_snapshot(&book.id, "2026-09-19").unwrap();

        // 前置：每张子表都有数据，删书才有意义
        assert_eq!(repo.list_settings(&book.id, "character").unwrap().len(), 1);
        assert_eq!(repo.list_chapters(&book.id).unwrap().len(), 1);
        assert_eq!(repo.list_outlines(&book.id).unwrap().len(), 1);
        assert_eq!(repo.list_timeline_events(&book.id).unwrap().len(), 1);
        assert_eq!(repo.list_storylines(&book.id).unwrap().len(), 1);
        assert_eq!(repo.list_foreshadowings(&book.id).unwrap().len(), 1);
        assert_eq!(repo.list_daily_stats(&book.id, 30).unwrap().len(), 1);

        repo.delete_book(&book.id).unwrap();

        assert!(repo.get_book(&book.id).unwrap().is_none(), "书行必须删除");
        assert!(
            repo.list_settings(&book.id, "character")
                .unwrap()
                .is_empty(),
            "删书后设定不得残留"
        );
        assert!(
            repo.list_chapters(&book.id).unwrap().is_empty(),
            "删书后章节不得残留"
        );
        assert!(
            repo.list_outlines(&book.id).unwrap().is_empty(),
            "删书后大纲不得残留"
        );
        assert!(
            repo.list_timeline_events(&book.id).unwrap().is_empty(),
            "删书后时间线不得残留"
        );
        assert!(
            repo.list_storylines(&book.id).unwrap().is_empty(),
            "删书后剧情线不得残留"
        );
        assert!(
            repo.list_foreshadowings(&book.id).unwrap().is_empty(),
            "删书后伏笔不得残留"
        );
        assert!(
            repo.list_daily_stats(&book.id, 30).unwrap().is_empty(),
            "删书后日快照不得残留"
        );
    }

    /// 删除传播矩阵（P0 一致性）② 删章：只删章节行，时间线事件/伏笔/大纲
    /// 全部保留，仅把指向该章的引用解绑回「未绑定章」（零强制）。
    #[test]
    fn delete_chapter_unbinds_refs_keeps_related_content() {
        let repo = make_repo();
        let book = sample_book("book_del_ch");
        repo.save_book(&book).unwrap();
        repo.save_chapter(&sample_chapter(&book.id, "ch_del"))
            .unwrap();

        // 时间线事件挂章 a；伏笔 plant/payoff 都指向章 a；大纲条目绑定章 a
        let mut ev = sample_timeline_event(&book.id, "ev_ch_bound", None);
        ev.chapter_id = Some("ch_del".into());
        repo.save_timeline_event(&ev).unwrap();
        let mut fs = sample_foreshadowing(&book.id, "fs_ch_bound", "章联动伏笔");
        fs.plant_chapter_id = Some("ch_del".into());
        fs.payoff_chapter_id = Some("ch_del".into());
        repo.save_foreshadowing(&fs).unwrap();
        repo.save_outline(&WritingOutline {
            id: "out_ch_bound".into(),
            book_id: book.id.clone(),
            title: "落章大纲".into(),
            summary: String::new(),
            chapter_id: Some("ch_del".into()),
            extra: "{}".into(),
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        })
        .unwrap();

        repo.delete_chapter("ch_del").unwrap();

        assert!(
            repo.list_chapters(&book.id).unwrap().is_empty(),
            "章节行必须删除"
        );
        let events = repo.list_timeline_events(&book.id).unwrap();
        assert_eq!(events.len(), 1, "删章不得删时间线事件");
        assert!(
            events[0].chapter_id.is_none(),
            "删章后事件应回到「未绑定章」"
        );
        let fss = repo.list_foreshadowings(&book.id).unwrap();
        assert_eq!(fss.len(), 1, "删章不得删伏笔");
        assert!(fss[0].plant_chapter_id.is_none(), "删章后伏笔埋设章应解绑");
        assert!(fss[0].payoff_chapter_id.is_none(), "删章后伏笔回收章应解绑");
        let outlines = repo.list_outlines(&book.id).unwrap();
        assert_eq!(outlines.len(), 1, "删章不得删大纲");
        assert!(
            outlines[0].chapter_id.is_none(),
            "删章后大纲应回到「未落章」"
        );
    }

    /// 删除传播矩阵（P0 一致性）③ 删设定：只删设定卡，时间线事件保留，
    /// 仅 setting_id 解绑回「书级事件」；书级事件不受影响。
    #[test]
    fn delete_setting_unbinds_timeline_keeps_events() {
        let repo = make_repo();
        let book = sample_book("book_del_set");
        repo.save_book(&book).unwrap();
        repo.save_setting(&WritingSetting {
            id: "set_del_s".into(),
            book_id: book.id.clone(),
            kind: "character".into(),
            name: "要删的卡".into(),
            subtitle: String::new(),
            description: String::new(),
            extra: "{}".into(),
            sort_order: 0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        })
        .unwrap();
        let bound = sample_timeline_event(&book.id, "ev_set_bound", Some("set_del_s"));
        let book_level = sample_timeline_event(&book.id, "ev_set_book", None);
        repo.save_timeline_event(&bound).unwrap();
        repo.save_timeline_event(&book_level).unwrap();

        repo.delete_setting("set_del_s").unwrap();

        assert!(
            repo.list_settings(&book.id, "character")
                .unwrap()
                .is_empty(),
            "设定卡必须删除"
        );
        let events = repo.list_timeline_events(&book.id).unwrap();
        assert_eq!(events.len(), 2, "删设定不得删时间线事件");
        let got = events.iter().find(|e| e.id == "ev_set_bound").unwrap();
        assert!(got.setting_id.is_none(), "删设定后挂卡事件应回到「书级」");
        let untouched = events.iter().find(|e| e.id == "ev_set_book").unwrap();
        assert!(untouched.setting_id.is_none(), "原本书级的事件不受影响");
    }
}
