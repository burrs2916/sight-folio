use crate::domain::project_data_flow::DataFlowFact;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectDataFlowRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<DataFlowFact>>;
    fn save_batch(&self, items: &[DataFlowFact]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectDataFlowRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectDataFlowRepository {
    fn clone(&self) -> Self {
        Self {
            db: self.db.clone(),
        }
    }
}

impl SqliteProjectDataFlowRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

const COLS: &str = "id, analysis_id, file_id, file_path, function_name, line_no, params,
                    param_to_return, propagates, returns_call_result, call_flows, sinks, created_at";

fn row_to_fact(row: &rusqlite::Row) -> rusqlite::Result<DataFlowFact> {
    Ok(DataFlowFact {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        file_id: row.get(2)?,
        file_path: row.get(3)?,
        function_name: row.get(4)?,
        line_no: row.get::<_, i64>(5)?,
        params: row.get(6)?,
        param_to_return: row.get(7)?,
        propagates: row.get::<_, i64>(8)? != 0,
        returns_call_result: row.get::<_, i64>(9)? != 0,
        call_flows: row.get(10)?,
        sinks: row.get(11)?,
        created_at: row.get::<_, i64>(12)?,
    })
}

impl ProjectDataFlowRepository for SqliteProjectDataFlowRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<DataFlowFact>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_data_flow WHERE analysis_id = ?1
             ORDER BY file_path ASC, line_no ASC",
            COLS
        ))?;
        let items = stmt
            .query_map([analysis_id], row_to_fact)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_batch(&self, items: &[DataFlowFact]) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_data_flow
                 (id, analysis_id, file_id, file_path, function_name, line_no, params,
                  param_to_return, propagates, returns_call_result, call_flows, sinks, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            )?;
            for it in items {
                stmt.execute(rusqlite::params![
                    it.id,
                    it.analysis_id,
                    it.file_id,
                    it.file_path,
                    it.function_name,
                    it.line_no,
                    it.params,
                    it.param_to_return,
                    if it.propagates { 1i64 } else { 0i64 },
                    if it.returns_call_result { 1i64 } else { 0i64 },
                    it.call_flows,
                    it.sinks,
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
            "DELETE FROM project_data_flow WHERE analysis_id = ?1",
            [analysis_id],
        )?;
        Ok(())
    }
}
