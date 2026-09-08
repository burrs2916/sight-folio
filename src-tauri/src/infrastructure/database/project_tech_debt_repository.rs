use crate::domain::project_tech_debt::TechDebtItem;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectTechDebtRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<TechDebtItem>>;
    fn save_batch(&self, items: &[TechDebtItem]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectTechDebtRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectTechDebtRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectTechDebtRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<TechDebtItem> {
    Ok(TechDebtItem {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        file_id: row.get(2)?,
        file_path: row.get(3)?,
        line_no: row.get::<_, i64>(4)?,
        marker: row.get(5)?,
        severity: row.get(6)?,
        snippet: row.get(7)?,
        created_at: row.get::<_, i64>(8)?,
    })
}

const DEBT_COLS: &str = "id, analysis_id, file_id, file_path, line_no, marker,
                         severity, snippet, created_at";

impl ProjectTechDebtRepository for SqliteProjectTechDebtRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<TechDebtItem>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_tech_debt WHERE analysis_id = ?1
             ORDER BY
               CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               file_path ASC, line_no ASC",
            DEBT_COLS
        ))?;
        let items = stmt
            .query_map([analysis_id], row_to_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_batch(&self, items: &[TechDebtItem]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_tech_debt
                 (id, analysis_id, file_id, file_path, line_no, marker,
                  severity, snippet, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            )?;
            for it in items {
                stmt.execute(rusqlite::params![
                    it.id, it.analysis_id, it.file_id, it.file_path, it.line_no,
                    it.marker, it.severity, it.snippet, it.created_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_tech_debt WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }
}
