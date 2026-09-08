use crate::domain::project_file_metrics::FileMetric;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectFileMetricRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<FileMetric>>;
    fn save_batch(&self, metrics: &[FileMetric]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectFileMetricRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectFileMetricRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectFileMetricRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_metric(row: &rusqlite::Row) -> rusqlite::Result<FileMetric> {
    Ok(FileMetric {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        file_id: row.get(2)?,
        file_path: row.get(3)?,
        total_lines: row.get::<_, i64>(4)?,
        code_lines: row.get::<_, i64>(5)?,
        comment_lines: row.get::<_, i64>(6)?,
        blank_lines: row.get::<_, i64>(7)?,
        cyclomatic_complexity: row.get::<_, i64>(8)?,
        complexity_level: row.get(9)?,
        metadata: row.get(10)?,
        created_at: row.get::<_, i64>(11)?,
        // 以下为 AST 级字段：旧库 ALTER 出来的列可能为 NULL，统一给缺省值
        engine: row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "heuristic".into()),
        max_nesting: row.get::<_, Option<i64>>(13)?.unwrap_or(0),
        function_count: row.get::<_, Option<i64>>(14)?.unwrap_or(0),
        max_function_cc: row.get::<_, Option<i64>>(15)?.unwrap_or(0),
        hot_function: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
        magic_number_count: row.get::<_, Option<i64>>(17)?.unwrap_or(0),
    })
}

const METRIC_COLS: &str = "id, analysis_id, file_id, file_path, total_lines, code_lines,
                           comment_lines, blank_lines, cyclomatic_complexity,
                           complexity_level, metadata, created_at,
                           engine, max_nesting, function_count, max_function_cc,
                           hot_function, magic_number_count";

impl ProjectFileMetricRepository for SqliteProjectFileMetricRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<FileMetric>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_file_metrics WHERE analysis_id = ?1
             ORDER BY cyclomatic_complexity DESC, file_path ASC",
            METRIC_COLS
        ))?;
        let metrics = stmt
            .query_map([analysis_id], row_to_metric)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(metrics)
    }

    fn save_batch(&self, metrics: &[FileMetric]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_file_metrics
                 (id, analysis_id, file_id, file_path, total_lines, code_lines,
                  comment_lines, blank_lines, cyclomatic_complexity,
                  complexity_level, metadata, created_at,
                  engine, max_nesting, function_count, max_function_cc,
                  hot_function, magic_number_count)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
            )?;
            for m in metrics {
                stmt.execute(rusqlite::params![
                    m.id, m.analysis_id, m.file_id, m.file_path, m.total_lines,
                    m.code_lines, m.comment_lines, m.blank_lines,
                    m.cyclomatic_complexity, m.complexity_level, m.metadata, m.created_at,
                    m.engine, m.max_nesting, m.function_count, m.max_function_cc,
                    m.hot_function, m.magic_number_count,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_file_metrics WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }
}
