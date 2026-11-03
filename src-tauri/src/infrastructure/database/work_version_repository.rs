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
use crate::domain::work_version::{ExportArtifact, WorkVersion, WorkVersionChapter};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::connection::Database;
use std::sync::Arc;

const VERSION_COLS: &str = "id, book_id, seq, label, note, is_final, chapter_count, word_count, \
                            content_hash, schema_ver, locked_at";
const VERSION_CHAPTER_COLS: &str = "version_id, sort_order, src_chapter_id, title, content, kind, \
                                    parent_id, status, word_count";
const ARTIFACT_COLS: &str = "id, version_id, book_id, format, spec_id, file_rel_path, file_size, \
                             status, error, origin, created_at";

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

    // ─── 导出任务 / 产物（B4）───
    // 任务与产物同表（export_artifacts）：status 走 queued→running→ready/failed，
    // 「任务面板」与「产物列表」只是同一张表的不同状态视图，不再另立 jobs 表。

    fn insert_artifact(&self, artifact: &ExportArtifact) -> AppResult<()>;
    fn find_artifact(&self, id: &str) -> AppResult<Option<ExportArtifact>>;
    /// 产物全集视图（成品页用）：可按书过滤，含 queued/running —— 排队态也要出现在版本行上。
    fn list_artifacts(&self, book_id: Option<&str>) -> AppResult<Vec<ExportArtifact>>;
    /// 任务面板视图：queued/running/failed 三种「要人看」的状态，先入队先出。
    fn list_export_jobs(&self) -> AppResult<Vec<ExportArtifact>>;
    /// 原子领取最早的 queued 改成 running；队列空返回 None。
    /// select+update 必须同事务：两步分开会让两个 worker 领到同一条任务重复导出。
    fn claim_next_queued(&self) -> AppResult<Option<ExportArtifact>>;
    /// 回写结局：ready（带 file_size）或 failed（带 error）。
    fn update_artifact_outcome(&self, id: &str, status: &str, file_size: i64, error: &str) -> AppResult<()>;
    /// 重试：仅 failed → queued 并清 error；状态不符返回 false（判不判归用例层）。
    fn requeue_failed_artifact(&self, id: &str) -> AppResult<bool>;
    /// 按 id 删一条产物/任务记录；不存在返回 false。
    fn delete_artifact(&self, id: &str) -> AppResult<bool>;
    /// 重启清污（需求 §5.2-4）：残留 queued/running 一律改判 failed，返回改写行数。
    /// ready 不动；已 failed 的旧账也不动（它的 error 是上一次的真因，别覆盖成中断）。
    fn fail_interrupted_artifacts(&self, error: &str) -> AppResult<i64>;
    /// 某书某格式的 **ready** 产物计数（写作台「已有 n 个」徽标，需求 §6）。
    /// 只数 ready：排队/失败/缺失都不算「已有成品」，徽标不许撒谎。format 空串 = 全部格式。
    fn count_ready_artifacts(&self, book_id: &str, format: &str) -> AppResult<i64>;
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

fn row_to_artifact(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExportArtifact> {
    Ok(ExportArtifact {
        id: row.get(0)?,
        version_id: row.get(1)?,
        book_id: row.get(2)?,
        format: row.get(3)?,
        spec_id: row.get(4)?,
        file_rel_path: row.get(5)?,
        file_size: row.get(6)?,
        status: row.get(7)?,
        error: row.get(8)?,
        origin: row.get(9)?,
        created_at: row.get(10)?,
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
            "SELECT {VERSION_CHAPTER_COLS} FROM work_version_chapters\n             WHERE version_id = ?1 ORDER BY sort_order ASC"
        ))?;
        let rows = stmt
            .query_map([version_id], row_to_version_chapter)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn insert_artifact(&self, artifact: &ExportArtifact) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO export_artifacts
             (id, version_id, book_id, format, spec_id, file_rel_path, file_size, status,
              error, origin, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                artifact.id,
                artifact.version_id,
                artifact.book_id,
                artifact.format,
                artifact.spec_id,
                artifact.file_rel_path,
                artifact.file_size,
                artifact.status,
                artifact.error,
                artifact.origin,
                artifact.created_at,
            ],
        )?;
        Ok(())
    }

    fn find_artifact(&self, id: &str) -> AppResult<Option<ExportArtifact>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {ARTIFACT_COLS} FROM export_artifacts WHERE id = ?1 LIMIT 1"
        ))?;
        let mut rows = stmt.query_map([id], row_to_artifact)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn list_artifacts(&self, book_id: Option<&str>) -> AppResult<Vec<ExportArtifact>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let sql = format!(
            "SELECT {ARTIFACT_COLS} FROM export_artifacts {} ORDER BY created_at ASC, id ASC",
            if book_id.is_some() { "WHERE book_id = ?1" } else { "" }
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = match book_id {
            Some(b) => stmt
                .query_map([b], row_to_artifact)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => stmt
                .query_map([], row_to_artifact)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(rows)
    }

    fn list_export_jobs(&self) -> AppResult<Vec<ExportArtifact>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {ARTIFACT_COLS} FROM export_artifacts
             WHERE status IN ('queued', 'running', 'failed')
             ORDER BY created_at ASC, id ASC"
        ))?;
        let rows = stmt
            .query_map([], row_to_artifact)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn claim_next_queued(&self) -> AppResult<Option<ExportArtifact>> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        let claimed: Option<ExportArtifact> = tx
            .query_row(
                &format!(
                    "SELECT {ARTIFACT_COLS} FROM export_artifacts
                     WHERE id = (SELECT id FROM export_artifacts WHERE status = 'queued'
                                 ORDER BY created_at ASC, id ASC LIMIT 1)"
                ),
                [],
                row_to_artifact,
            )
            .ok();
        let Some(job) = claimed else {
            tx.commit()?;
            return Ok(None);
        };
        // 领取即改态：同事务里 queued → running，别的 worker 再进来领不到同一条
        let updated = tx.execute(
            "UPDATE export_artifacts SET status = 'running' WHERE id = ?1 AND status = 'queued'",
            [&job.id],
        )?;
        if updated == 0 {
            // 理论到不了这一步（全局连接锁下 select/update 之间无并发）；真到说明状态机被旁路改坏
            return Err(AppError::Internal(format!(
                "任务 {} 领取竞态：queued 读到了却改不动",
                job.id
            )));
        }
        tx.commit()?;
        Ok(Some(ExportArtifact {
            status: "running".to_string(),
            ..job
        }))
    }

    fn update_artifact_outcome(&self, id: &str, status: &str, file_size: i64, error: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE export_artifacts SET status = ?2, file_size = ?3, error = ?4 WHERE id = ?1",
            rusqlite::params![id, status, file_size, error],
        )?;
        Ok(())
    }

    fn requeue_failed_artifact(&self, id: &str) -> AppResult<bool> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let changed = conn.execute(
            "UPDATE export_artifacts SET status = 'queued', error = '' WHERE id = ?1 AND status = 'failed'",
            [id],
        )?;
        Ok(changed > 0)
    }

    fn delete_artifact(&self, id: &str) -> AppResult<bool> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(conn.execute("DELETE FROM export_artifacts WHERE id = ?1", [id])? > 0)
    }

    fn fail_interrupted_artifacts(&self, error: &str) -> AppResult<i64> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let changed = conn.execute(
            "UPDATE export_artifacts SET status = 'failed', error = ?1
             WHERE status IN ('queued', 'running')",
            [error],
        )?;
        Ok(changed as i64)
    }

    fn count_ready_artifacts(&self, book_id: &str, format: &str) -> AppResult<i64> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let count = if format.is_empty() {
            conn.query_row(
                "SELECT COUNT(*) FROM export_artifacts WHERE book_id = ?1 AND status = 'ready'",
                [book_id],
                |r| r.get(0),
            )?
        } else {
            conn.query_row(
                "SELECT COUNT(*) FROM export_artifacts
                 WHERE book_id = ?1 AND format = ?2 AND status = 'ready'",
                rusqlite::params![book_id, format],
                |r| r.get(0),
            )?
        };
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::{init_tables, migrate, Database};
    use rusqlite::Connection;
    use std::sync::Mutex;

    /// 建库走**生产同一套** init_tables + migrate：手抄 schema 会得到假的绿（本仓硬口径）。
    fn make_repo() -> SqliteWorkVersionRepository {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        migrate(&conn).unwrap();
        SqliteWorkVersionRepository::new(Arc::new(Database(Mutex::new(conn))))
    }

    fn artifact(id: &str, book_id: &str, format: &str, status: &str) -> ExportArtifact {
        ExportArtifact {
            id: id.to_string(),
            version_id: format!("ver_{id}").to_string(),
            book_id: book_id.to_string(),
            format: format.to_string(),
            spec_id: "default".to_string(),
            file_rel_path: format!("{book_id}/v1/{id}.{format}"),
            file_size: 1024,
            status: status.to_string(),
            error: String::new(),
            origin: "export".to_string(),
            created_at: 1,
        }
    }

    /// B6：写作台徽标计数改按 export_artifacts 的三条硬规则——
    /// 只数 ready（排队/失败/缺失不许冒充成品）、按书隔离、空 format = 全书汇总。
    #[test]
    fn count_ready_artifacts_counts_only_ready_per_book_and_format() {
        let repo = make_repo();
        repo.insert_artifact(&artifact("a1", "book_x", "epub", "ready"))
            .unwrap();
        repo.insert_artifact(&artifact("a2", "book_x", "pdf", "ready"))
            .unwrap();
        repo.insert_artifact(&artifact("a3", "book_x", "pdf", "ready"))
            .unwrap();
        repo.insert_artifact(&artifact("a4", "book_x", "pdf", "queued"))
            .unwrap();
        repo.insert_artifact(&artifact("a5", "book_x", "pdf", "failed"))
            .unwrap();
        repo.insert_artifact(&artifact("a6", "book_x", "pdf", "missing"))
            .unwrap();
        repo.insert_artifact(&artifact("a7", "book_y", "epub", "ready"))
            .unwrap();

        assert_eq!(repo.count_ready_artifacts("book_x", "pdf").unwrap(), 2);
        assert_eq!(repo.count_ready_artifacts("book_x", "epub").unwrap(), 1);
        assert_eq!(
            repo.count_ready_artifacts("book_x", "docx").unwrap(),
            0,
            "没导出过的格式不许有数"
        );
        assert_eq!(
            repo.count_ready_artifacts("book_x", "").unwrap(),
            3,
            "空 format 应汇总该书全部 ready"
        );
        assert_eq!(repo.count_ready_artifacts("book_y", "epub").unwrap(), 1);
        assert_eq!(
            repo.count_ready_artifacts("book_z", "").unwrap(),
            0,
            "别人的产物不许串到这本书的徽标上"
        );
    }
}
