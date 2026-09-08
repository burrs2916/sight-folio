use crate::domain::project_modules::ProjectModule;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectModuleRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectModule>>;
    fn save_batch(&self, modules: &[ProjectModule]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectModuleRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectModuleRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectModuleRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_module(row: &rusqlite::Row) -> rusqlite::Result<ProjectModule> {
    Ok(ProjectModule {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        layer_id: row.get(4)?,
        file_count: row.get::<_, i64>(5)?,
        dep_count: row.get::<_, i64>(6)?,
        be_dep_count: row.get::<_, i64>(7)?,
        x: row.get::<_, f64>(8)?,
        y: row.get::<_, f64>(9)?,
        width: row.get::<_, f64>(10)?,
        height: row.get::<_, f64>(11)?,
        color: row.get(12)?,
        metadata: row.get(13)?,
        created_at: row.get::<_, i64>(14)?,
        updated_at: row.get::<_, i64>(15)?,
    })
}

impl ProjectModuleRepository for SqliteProjectModuleRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectModule>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, name, description, layer_id, file_count, dep_count, be_dep_count,
                    x, y, width, height, color, metadata, created_at, updated_at
             FROM project_modules WHERE analysis_id = ?1 ORDER BY sort_order_via_layer NULLS LAST, name ASC",
        )?;
        // 注：layer_id 排序简化处理，按 name 排序够用
        let mods = stmt
            .query_map([analysis_id], row_to_module)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(mods)
    }

    fn save_batch(&self, modules: &[ProjectModule]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_modules
                 (id, analysis_id, name, description, layer_id, file_count, dep_count, be_dep_count,
                  x, y, width, height, color, metadata, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            )?;
            for m in modules {
                stmt.execute(rusqlite::params![
                    m.id, m.analysis_id, m.name, m.description, m.layer_id,
                    m.file_count, m.dep_count, m.be_dep_count,
                    m.x, m.y, m.width, m.height, m.color,
                    m.metadata, m.created_at, m.updated_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_modules WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }
}