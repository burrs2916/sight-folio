use crate::domain::project_dependencies::ProjectDependency;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectDependencyRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectDependency>>;
    fn save_batch(&self, deps: &[ProjectDependency]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectDependencyRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectDependencyRepository {
    fn clone(&self) -> Self {
        Self {
            db: self.db.clone(),
        }
    }
}

impl SqliteProjectDependencyRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_dep(row: &rusqlite::Row) -> rusqlite::Result<ProjectDependency> {
    Ok(ProjectDependency {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        from_id: row.get(2)?,
        from_type: row.get(3)?,
        to_id: row.get(4)?,
        to_type: row.get(5)?,
        kind: row.get(6)?,
        line_no: row.get(7)?,
        is_circular: row.get::<_, i64>(8)? != 0,
        weight: row.get::<_, i64>(9)?,
        metadata: row.get(10)?,
        detected_at: row.get::<_, i64>(11)?,
    })
}

impl ProjectDependencyRepository for SqliteProjectDependencyRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectDependency>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, from_id, from_type, to_id, to_type, kind, line_no, is_circular, weight, metadata, detected_at
             FROM project_dependencies WHERE analysis_id = ?1",
        )?;
        let deps = stmt
            .query_map([analysis_id], row_to_dep)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(deps)
    }

    fn save_batch(&self, deps: &[ProjectDependency]) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_dependencies
                 (id, analysis_id, from_id, from_type, to_id, to_type, kind, line_no, is_circular, weight, metadata, detected_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            )?;
            for d in deps {
                stmt.execute(rusqlite::params![
                    d.id,
                    d.analysis_id,
                    d.from_id,
                    d.from_type,
                    d.to_id,
                    d.to_type,
                    d.kind,
                    d.line_no,
                    d.is_circular as i64,
                    d.weight,
                    d.metadata,
                    d.detected_at,
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
            "DELETE FROM project_dependencies WHERE analysis_id = ?1",
            [analysis_id],
        )?;
        Ok(())
    }
}
