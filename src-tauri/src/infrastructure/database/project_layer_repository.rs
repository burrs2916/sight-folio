use crate::domain::project_layers::ProjectLayer;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectLayerRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectLayer>>;
    fn save(&self, layer: &ProjectLayer) -> AppResult<()>;
    fn delete(&self, id: &str) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
}

pub struct SqliteProjectLayerRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectLayerRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectLayerRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_layer(row: &rusqlite::Row) -> rusqlite::Result<ProjectLayer> {
    Ok(ProjectLayer {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        sort_order: row.get::<_, i64>(4)?,
        y_position: row.get::<_, f64>(5)?,
        description: row.get(6)?,
        rule_pattern: row.get(7)?,
        metadata: row.get(8)?,
        created_at: row.get::<_, i64>(9)?,
        updated_at: row.get::<_, i64>(10)?,
    })
}

impl ProjectLayerRepository for SqliteProjectLayerRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectLayer>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, name, color, sort_order, y_position, description, rule_pattern, metadata, created_at, updated_at
             FROM project_layers WHERE analysis_id = ?1 ORDER BY sort_order ASC, name ASC",
        )?;
        let layers = stmt
            .query_map([analysis_id], row_to_layer)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(layers)
    }

    fn save(&self, layer: &ProjectLayer) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO project_layers
             (id, analysis_id, name, color, sort_order, y_position, description, rule_pattern, metadata, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                layer.id, layer.analysis_id, layer.name, layer.color,
                layer.sort_order, layer.y_position, layer.description, layer.rule_pattern,
                layer.metadata, layer.created_at, layer.updated_at,
            ],
        )?;
        Ok(())
    }

    fn delete(&self, id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_layers WHERE id = ?1", [id])?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_layers WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }
}