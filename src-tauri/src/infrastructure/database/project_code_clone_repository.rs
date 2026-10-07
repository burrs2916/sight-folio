use crate::domain::project_code_clones::CodeClone;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectCodeCloneRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<CodeClone>>;
    fn save_batch(&self, items: &[CodeClone]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectCodeCloneRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectCodeCloneRepository {
    fn clone(&self) -> Self {
        Self {
            db: self.db.clone(),
        }
    }
}

impl SqliteProjectCodeCloneRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<CodeClone> {
    Ok(CodeClone {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        group_id: row.get(2)?,
        file_id: row.get(3)?,
        file_path: row.get(4)?,
        start_line: row.get::<_, i64>(5)?,
        end_line: row.get::<_, i64>(6)?,
        line_count: row.get::<_, i64>(7)?,
        group_size: row.get::<_, i64>(8)?,
        snippet: row.get(9)?,
        language: row.get(10)?,
        clone_type: row.get(11)?,
        created_at: row.get::<_, i64>(12)?,
    })
}

const CLONE_COLS: &str = "id, analysis_id, group_id, file_id, file_path, start_line,
                          end_line, line_count, group_size, snippet, language, clone_type, created_at";

impl ProjectCodeCloneRepository for SqliteProjectCodeCloneRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<CodeClone>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_code_clones WHERE analysis_id = ?1
             ORDER BY line_count DESC, group_size DESC, file_path ASC, start_line ASC",
            CLONE_COLS
        ))?;
        let items = stmt
            .query_map([analysis_id], row_to_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_batch(&self, items: &[CodeClone]) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_code_clones
                 (id, analysis_id, group_id, file_id, file_path, start_line,
                  end_line, line_count, group_size, snippet, language, clone_type, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            )?;
            for it in items {
                stmt.execute(rusqlite::params![
                    it.id,
                    it.analysis_id,
                    it.group_id,
                    it.file_id,
                    it.file_path,
                    it.start_line,
                    it.end_line,
                    it.line_count,
                    it.group_size,
                    it.snippet,
                    it.language,
                    it.clone_type,
                    it.created_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "DELETE FROM project_code_clones WHERE analysis_id = ?1",
            [analysis_id],
        )?;
        Ok(())
    }
}
