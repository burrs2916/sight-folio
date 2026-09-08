use crate::domain::project_git_churn::GitChurn;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectGitChurnRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<GitChurn>>;
    fn save_batch(&self, items: &[GitChurn]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectGitChurnRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectGitChurnRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectGitChurnRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_churn(row: &rusqlite::Row) -> rusqlite::Result<GitChurn> {
    Ok(GitChurn {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        file_id: row.get(2)?,
        file_path: row.get(3)?,
        commit_count: row.get::<_, i64>(4)?,
        added_lines: row.get::<_, i64>(5)?,
        deleted_lines: row.get::<_, i64>(6)?,
        author_count: row.get::<_, i64>(7)?,
        last_commit_at: row.get::<_, i64>(8)?,
        first_commit_at: row.get::<_, i64>(9)?,
        churn_score: row.get::<_, i64>(10)?,
        hotspot_level: row.get(11)?,
        created_at: row.get::<_, i64>(12)?,
    })
}

const CHURN_COLS: &str = "id, analysis_id, file_id, file_path, commit_count, added_lines,
                          deleted_lines, author_count, last_commit_at, first_commit_at,
                          churn_score, hotspot_level, created_at";

impl ProjectGitChurnRepository for SqliteProjectGitChurnRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<GitChurn>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_git_churn WHERE analysis_id = ?1
             ORDER BY churn_score DESC, commit_count DESC, file_path ASC",
            CHURN_COLS
        ))?;
        let items = stmt
            .query_map([analysis_id], row_to_churn)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_batch(&self, items: &[GitChurn]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_git_churn
                 (id, analysis_id, file_id, file_path, commit_count, added_lines,
                  deleted_lines, author_count, last_commit_at, first_commit_at,
                  churn_score, hotspot_level, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            )?;
            for it in items {
                stmt.execute(rusqlite::params![
                    it.id,
                    it.analysis_id,
                    it.file_id,
                    it.file_path,
                    it.commit_count,
                    it.added_lines,
                    it.deleted_lines,
                    it.author_count,
                    it.last_commit_at,
                    it.first_commit_at,
                    it.churn_score,
                    it.hotspot_level,
                    it.created_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "DELETE FROM project_git_churn WHERE analysis_id = ?1",
            [analysis_id],
        )?;
        Ok(())
    }
}
