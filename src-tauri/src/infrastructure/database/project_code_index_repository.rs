use crate::domain::project_code_index::CodeIndexEntry;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectCodeIndexRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<CodeIndexEntry>>;
    fn save_batch(&self, entries: &[CodeIndexEntry]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
    /// 全文检索：content LIKE %query%，按 analysis_id 分片，limit 条
    fn search(&self, analysis_id: &str, like: &str, limit: i64) -> AppResult<Vec<CodeIndexEntry>>;
    /// FTS5 倒排索引检索：分词匹配 + bm25 相关度排序
    ///
    /// 相比 LIKE 全表扫描，FTS5 在大项目下是数量级的差异，且能按相关度排序
    /// （命中词频高、所在行短的结果排前）。FTS5 不可用或无命中时返回空，
    /// 由命令层回退到 LIKE。
    fn search_fts(&self, analysis_id: &str, query: &str, limit: i64) -> AppResult<Vec<CodeIndexEntry>>;
}

pub struct SqliteProjectCodeIndexRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectCodeIndexRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectCodeIndexRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<CodeIndexEntry> {
    Ok(CodeIndexEntry {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        file_id: row.get(2)?,
        file_path: row.get(3)?,
        line_no: row.get::<_, i64>(4)?,
        content: row.get(5)?,
        created_at: row.get::<_, i64>(6)?,
    })
}

const IDX_COLS: &str = "id, analysis_id, file_id, file_path, line_no, content, created_at";

impl ProjectCodeIndexRepository for SqliteProjectCodeIndexRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<CodeIndexEntry>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_code_index WHERE analysis_id = ?1 LIMIT 5000",
            IDX_COLS
        ))?;
        let entries = stmt
            .query_map([analysis_id], row_to_entry)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(entries)
    }

    fn save_batch(&self, entries: &[CodeIndexEntry]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_code_index
                 (id, analysis_id, file_id, file_path, line_no, content, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
            )?;
            for e in entries {
                stmt.execute(rusqlite::params![
                    e.id, e.analysis_id, e.file_id, e.file_path, e.line_no,
                    e.content, e.created_at,
                ])?;
            }

            // 同步写入 FTS5 倒排索引（best-effort：FTS5 不可用时静默跳过，
            // 检索侧会自动回退 LIKE，不影响既有功能）
            if let Ok(mut fts) = tx.prepare(
                "INSERT INTO project_code_fts
                 (entry_id, analysis_id, file_id, file_path, line_no, content, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
            ) {
                for e in entries {
                    let _ = fts.execute(rusqlite::params![
                        e.id, e.analysis_id, e.file_id, e.file_path, e.line_no,
                        e.content, e.created_at,
                    ]);
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_code_index WHERE analysis_id = ?1", [analysis_id])?;
        // FTS 影子表同步清理（表不存在时忽略）
        let _ = conn.execute(
            "DELETE FROM project_code_fts WHERE analysis_id = ?1",
            [analysis_id],
        );
        Ok(())
    }

    fn search(&self, analysis_id: &str, like: &str, limit: i64) -> AppResult<Vec<CodeIndexEntry>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_code_index
             WHERE analysis_id = ?1 AND content LIKE ?2
             ORDER BY file_path ASC, line_no ASC
             LIMIT ?3",
            IDX_COLS
        ))?;
        let entries = stmt
            .query_map(rusqlite::params![analysis_id, like, limit], row_to_entry)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(entries)
    }

    fn search_fts(
        &self,
        analysis_id: &str,
        query: &str,
        limit: i64,
    ) -> AppResult<Vec<CodeIndexEntry>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // FTS5 查询串转义：整体当作短语，内部双引号转义，末词开启前缀匹配
        // （`"foo bar"*` = 短语 foo bar，且 bar 允许前缀扩展）
        let match_expr = format!("\"{}\"*", query.replace('"', "\"\""));

        let mut stmt = match conn.prepare(
            "SELECT entry_id, analysis_id, file_id, file_path, line_no, content, created_at
             FROM project_code_fts
             WHERE project_code_fts MATCH ?1 AND analysis_id = ?2
             ORDER BY bm25(project_code_fts, 0.0, 0.0, 0.0, 2.0, 0.0, 5.0, 0.0)
             LIMIT ?3",
        ) {
            Ok(s) => s,
            // FTS5 不可用 → 交由命令层回退 LIKE
            Err(_) => return Ok(Vec::new()),
        };

        let rows = stmt.query_map(
            rusqlite::params![match_expr, analysis_id, limit],
            |row| {
                Ok(CodeIndexEntry {
                    id: row.get(0)?,
                    analysis_id: row.get(1)?,
                    file_id: row.get(2)?,
                    file_path: row.get(3)?,
                    line_no: row.get::<_, i64>(4)?,
                    content: row.get(5)?,
                    created_at: row.get::<_, i64>(6)?,
                })
            },
        );

        match rows {
            Ok(iter) => Ok(iter.filter_map(|r| r.ok()).collect()),
            // MATCH 语法错误（用户输入了 FTS5 保留字符）→ 回退 LIKE
            Err(_) => Ok(Vec::new()),
        }
    }
}
