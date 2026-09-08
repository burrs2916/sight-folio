use crate::domain::project_files::ProjectFile;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectFileRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectFile>>;
    fn get(&self, id: &str) -> AppResult<Option<ProjectFile>>;
    fn save_batch(&self, files: &[ProjectFile]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectFileRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectFileRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectFileRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_file(row: &rusqlite::Row) -> rusqlite::Result<ProjectFile> {
    Ok(ProjectFile {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        path: row.get(2)?,
        rel_path: row.get(3)?,
        name: row.get(4)?,
        extension: row.get(5)?,
        language: row.get(6)?,
        size: row.get::<_, i64>(7)?,
        line_count: row.get::<_, i64>(8)?,
        content_hash: row.get(9)?,
        parent_id: row.get(10)?,
        is_directory: row.get::<_, i64>(11)? != 0,
        layer_id: row.get(12)?,
        x: row.get::<_, f64>(13)?,
        y: row.get::<_, f64>(14)?,
        width: row.get::<_, f64>(15)?,
        height: row.get::<_, f64>(16)?,
        metadata: row.get(17)?,
        scanned_at: row.get::<_, i64>(18)?,
    })
}

impl ProjectFileRepository for SqliteProjectFileRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectFile>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, path, rel_path, name, extension, language, size, line_count,
                    content_hash, parent_id, is_directory, layer_id, x, y, width, height, metadata, scanned_at
             FROM project_files WHERE analysis_id = ?1 ORDER BY is_directory DESC, rel_path ASC",
        )?;
        let files = stmt
            .query_map([analysis_id], row_to_file)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(files)
    }

    fn get(&self, id: &str) -> AppResult<Option<ProjectFile>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, path, rel_path, name, extension, language, size, line_count,
                    content_hash, parent_id, is_directory, layer_id, x, y, width, height, metadata, scanned_at
             FROM project_files WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], row_to_file)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn save_batch(&self, files: &[ProjectFile]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_files
                 (id, analysis_id, path, rel_path, name, extension, language, size, line_count,
                  content_hash, parent_id, is_directory, layer_id, x, y, width, height, metadata, scanned_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            )?;
            for file in files {
                stmt.execute(rusqlite::params![
                    file.id, file.analysis_id, file.path, file.rel_path, file.name,
                    file.extension, file.language, file.size, file.line_count, file.content_hash,
                    file.parent_id, file.is_directory as i64, file.layer_id,
                    file.x, file.y, file.width, file.height, file.metadata, file.scanned_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_files WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }
}