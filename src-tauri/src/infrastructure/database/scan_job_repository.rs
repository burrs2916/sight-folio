use crate::domain::scan_jobs::ScanJob;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ScanJobRepository: Send + Sync {
    fn get(&self, id: &str) -> AppResult<Option<ScanJob>>;
    fn latest_for_analysis(&self, analysis_id: &str) -> AppResult<Option<ScanJob>>;
    fn save(&self, job: &ScanJob) -> AppResult<()>;
}

pub struct SqliteScanJobRepository {
    db: Arc<Database>,
}

impl Clone for SqliteScanJobRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteScanJobRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<ScanJob> {
    Ok(ScanJob {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        status: row.get(2)?,
        progress: row.get::<_, i64>(3)?,
        files_scanned: row.get::<_, i64>(4)?,
        total_files: row.get::<_, i64>(5)?,
        started_at: row.get(6)?,
        finished_at: row.get(7)?,
        error: row.get(8)?,
        config: row.get(9)?,
        created_at: row.get::<_, i64>(10)?,
    })
}

impl ScanJobRepository for SqliteScanJobRepository {
    fn get(&self, id: &str) -> AppResult<Option<ScanJob>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, status, progress, files_scanned, total_files, started_at, finished_at, error, config, created_at
             FROM scan_jobs WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], row_to_job)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn latest_for_analysis(&self, analysis_id: &str) -> AppResult<Option<ScanJob>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, status, progress, files_scanned, total_files, started_at, finished_at, error, config, created_at
             FROM scan_jobs WHERE analysis_id = ?1 ORDER BY created_at DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map([analysis_id], row_to_job)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn save(&self, job: &ScanJob) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO scan_jobs
             (id, analysis_id, status, progress, files_scanned, total_files, started_at, finished_at, error, config, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                job.id, job.analysis_id, job.status, job.progress,
                job.files_scanned, job.total_files, job.started_at,
                job.finished_at, job.error, job.config, job.created_at,
            ],
        )?;
        Ok(())
    }
}