use crate::domain::project_change_coupling::ChangeCoupling;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectChangeCouplingRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ChangeCoupling>>;
    fn save_batch(&self, items: &[ChangeCoupling]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectChangeCouplingRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectChangeCouplingRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectChangeCouplingRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

const CC_COLS: &str = "id, analysis_id, file_a_id, file_a_path, file_b_id, file_b_path,
                       co_changes, commits_a, commits_b, degree, jaccard, is_structural,
                       cross_module, coupling_kind, risk_level, last_co_change_at, created_at";

fn row_to_coupling(row: &rusqlite::Row) -> rusqlite::Result<ChangeCoupling> {
    Ok(ChangeCoupling {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        file_a_id: row.get(2)?,
        file_a_path: row.get(3)?,
        file_b_id: row.get(4)?,
        file_b_path: row.get(5)?,
        co_changes: row.get::<_, i64>(6)?,
        commits_a: row.get::<_, i64>(7)?,
        commits_b: row.get::<_, i64>(8)?,
        degree: row.get::<_, f64>(9)?,
        jaccard: row.get::<_, f64>(10)?,
        is_structural: row.get::<_, i64>(11)? != 0,
        cross_module: row.get::<_, i64>(12)? != 0,
        coupling_kind: row.get(13)?,
        risk_level: row.get(14)?,
        last_co_change_at: row.get::<_, i64>(15)?,
        created_at: row.get::<_, i64>(16)?,
    })
}

impl ProjectChangeCouplingRepository for SqliteProjectChangeCouplingRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ChangeCoupling>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_change_coupling WHERE analysis_id = ?1
             ORDER BY degree DESC, co_changes DESC, file_a_path ASC",
            CC_COLS
        ))?;
        let items = stmt
            .query_map([analysis_id], row_to_coupling)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_batch(&self, items: &[ChangeCoupling]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_change_coupling
                 (id, analysis_id, file_a_id, file_a_path, file_b_id, file_b_path,
                  co_changes, commits_a, commits_b, degree, jaccard, is_structural,
                  cross_module, coupling_kind, risk_level, last_co_change_at, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            )?;
            for it in items {
                stmt.execute(rusqlite::params![
                    it.id,
                    it.analysis_id,
                    it.file_a_id,
                    it.file_a_path,
                    it.file_b_id,
                    it.file_b_path,
                    it.co_changes,
                    it.commits_a,
                    it.commits_b,
                    it.degree,
                    it.jaccard,
                    if it.is_structural { 1i64 } else { 0i64 },
                    if it.cross_module { 1i64 } else { 0i64 },
                    it.coupling_kind,
                    it.risk_level,
                    it.last_co_change_at,
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
            "DELETE FROM project_change_coupling WHERE analysis_id = ?1",
            [analysis_id],
        )?;
        Ok(())
    }
}
