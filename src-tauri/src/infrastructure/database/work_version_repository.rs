//! 成稿版本仓储（完结作品重设计 B1）。
//!
//! 三张表由 B0 迁移建好：`work_versions`（版本头）、`work_version_chapters`（内容副本）、
//! `export_artifacts`（导出产物）。本文件只负责读写；业务规则（内容指纹、seq 递增、
//! 空版本与同指纹拦截）在 `application/work_version`，命令层在 `commands/work_version`。
//!
//! 三条硬约定：
//! 1. **写入必须原子**：版本头 + N 条章节副本要么全进要么全不进，否则会留下「有版本没内容」
//!    的空壳版本，导出时读不到正文。
//! 2. **换正稿必须同事务**：正稿唯一最终由库上的部分唯一索引 `ux_wv_book_final` 兜底，
//!    但「清旧 + 置新」是两条 UPDATE，中途失败会留下零个或两个正稿。
//! 3. **删版本连带抹产物记录**：产物必然挂在版本下（D1），版本没了还留着产物记录，
//!    成品页就会出现指向空气的幽灵条目。磁盘文件是否删除由调用方决定，本层只回传相对路径。
use crate::domain::work_version::{WorkVersion, WorkVersionChapter};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::connection::Database;
use std::sync::Arc;

const VERSION_COLS: &str = "id, book_id, seq, label, note, is_final, chapter_count, word_count, \
                            content_hash, schema_ver, locked_at";
const VERSION_CHAPTER_COLS: &str = "version_id, sort_order, src_chapter_id, title, content, kind, \
                                    parent_id, status, word_count";

pub trait WorkVersionRepository {
    /// 原子写入一个版本头 + 它的全部章节副本；`version.is_final` 为真时同事务清掉旧正稿。
    fn insert_version(
        &self,
        version: &WorkVersion,
        chapters: &[WorkVersionChapter],
    ) -> AppResult<()>;
    fn list_versions(&self, book_id: &str) -> AppResult<Vec<WorkVersion>>;
    fn find_version(&self, id: &str) -> AppResult<Option<WorkVersion>>;
    /// 最新一版（seq 最大）：指纹比对与「下一版序号」都以它为参照。
    fn latest_version(&self, book_id: &str) -> AppResult<Option<WorkVersion>>;
    fn max_seq(&self, book_id: &str) -> AppResult<i64>;
    /// 换正稿：先清该书全部 is_final，再置目标为 1，单事务。
    fn set_final_version(&self, book_id: &str, version_id: &str) -> AppResult<()>;
    /// 删版本 + 章节副本 + 产物记录；返回被抹掉的产物相对路径（调用方据此决定是否删文件）。
    fn delete_version(&self, version_id: &str) -> AppResult<Vec<String>>;
    fn list_version_chapters(&self, version_id: &str) -> AppResult<Vec<WorkVersionChapter>>;
}

pub struct SqliteWorkVersionRepository {
    db: Arc<Database>,
}

impl SqliteWorkVersionRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_version(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkVersion> {
    Ok(WorkVersion {
        id: row.get(0)?,
        book_id: row.get(1)?,
        seq: row.get(2)?,
        label: row.get(3)?,
        note: row.get(4)?,
        // 库里是 INTEGER 0/1，边界处收敛成 bool，不让 0/1 语义漏到上层
        is_final: row.get::<_, i64>(5)? != 0,
        chapter_count: row.get(6)?,
        word_count: row.get(7)?,
        content_hash: row.get(8)?,
        schema_ver: row.get(9)?,
        locked_at: row.get(10)?,
    })
}

fn row_to_version_chapter(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkVersionChapter> {
    Ok(WorkVersionChapter {
        version_id: row.get(0)?,
        sort_order: row.get(1)?,
        src_chapter_id: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        kind: row.get(5)?,
        parent_id: row.get(6)?,
        status: row.get(7)?,
        word_count: row.get(8)?,
    })
}

impl WorkVersionRepository for SqliteWorkVersionRepository {
    fn insert_version(
        &self,
        version: &WorkVersion,
        chapters: &[WorkVersionChapter],
    ) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;

        if version.is_final {
            // 先清后立：顺序不能反，否则部分唯一索引会在「旧正稿还在」时把新正稿顶掉。
            tx.execute(
                "UPDATE work_versions SET is_final = 0 WHERE book_id = ?1 AND is_final = 1",
                [&version.book_id],
            )?;
        }
        tx.execute(
            "INSERT INTO work_versions
             (id, book_id, seq, label, note, is_final, chapter_count, word_count,
              content_hash, schema_ver, locked_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                version.id,
                version.book_id,
                version.seq,
                version.label,
                version.note,
                version.is_final,
                version.chapter_count,
                version.word_count,
                version.content_hash,
                version.schema_ver,
                version.locked_at,
            ],
        )?;
        for ch in chapters {
            tx.execute(
                "INSERT INTO work_version_chapters
                 (version_id, sort_order, src_chapter_id, title, content, kind, parent_id,
                  status, word_count)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                rusqlite::params![
                    ch.version_id,
                    ch.sort_order,
                    ch.src_chapter_id,
                    ch.title,
                    ch.content,
                    ch.kind,
                    ch.parent_id,
                    ch.status,
                    ch.word_count,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    fn list_versions(&self, book_id: &str) -> AppResult<Vec<WorkVersion>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {VERSION_COLS} FROM work_versions WHERE book_id = ?1 ORDER BY seq DESC"
        ))?;
        let rows = stmt
            .query_map([book_id], row_to_version)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn find_version(&self, id: &str) -> AppResult<Option<WorkVersion>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {VERSION_COLS} FROM work_versions WHERE id = ?1 LIMIT 1"
        ))?;
        let mut rows = stmt.query_map([id], row_to_version)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn latest_version(&self, book_id: &str) -> AppResult<Option<WorkVersion>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {VERSION_COLS} FROM work_versions WHERE book_id = ?1 ORDER BY seq DESC LIMIT 1"
        ))?;
        let mut rows = stmt.query_map([book_id], row_to_version)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn max_seq(&self, book_id: &str) -> AppResult<i64> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        // MAX() 在无行时返回 NULL，这不是查询失败：显式按 Option 取，取不到即视为 0 版。
        let max: Option<i64> = conn
            .query_row(
                "SELECT MAX(seq) FROM work_versions WHERE book_id = ?1",
                [book_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .unwrap_or(None);
        Ok(max.unwrap_or(0))
    }

    fn set_final_version(&self, book_id: &str, version_id: &str) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        let owned: i64 = tx.query_row(
            "SELECT COUNT(*) FROM work_versions WHERE id = ?1 AND book_id = ?2",
            [version_id, book_id],
            |row| row.get(0),
        )?;
        if owned == 0 {
            // 不返「成功但什么都没改」：版本不属于这本书时宁可报错，也不要静默丢正稿
            return Err(AppError::NotFound(format!(
                "版本 {version_id} 不属于作品 {book_id}"
            )));
        }
        tx.execute(
            "UPDATE work_versions SET is_final = 0 WHERE book_id = ?1 AND is_final = 1",
            [book_id],
        )?;
        tx.execute("UPDATE work_versions SET is_final = 1 WHERE id = ?1", [version_id])?;
        tx.commit()?;
        Ok(())
    }

    fn delete_version(&self, version_id: &str) -> AppResult<Vec<String>> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        let rel_paths: Vec<String> = tx
            .prepare("SELECT file_rel_path FROM export_artifacts WHERE version_id = ?1")?
            .query_map([version_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        tx.execute("DELETE FROM export_artifacts WHERE version_id = ?1", [version_id])?;
        tx.execute("DELETE FROM work_version_chapters WHERE version_id = ?1", [version_id])?;
        let removed = tx.execute("DELETE FROM work_versions WHERE id = ?1", [version_id])?;
        if removed == 0 {
            return Err(AppError::NotFound(format!("版本 {version_id} 不存在")));
        }
        tx.commit()?;
        Ok(rel_paths)
    }

    fn list_version_chapters(&self, version_id: &str) -> AppResult<Vec<WorkVersionChapter>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {VERSION_CHAPTER_COLS} FROM work_version_chapters
             WHERE version_id = ?1 ORDER BY sort_order ASC"
        ))?;
        let rows = stmt
            .query_map([version_id], row_to_version_chapter)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}
