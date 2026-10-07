use crate::domain::analysis::{Analysis, AnalysisCategory};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait AnalysisRepository: Send + Sync {
    fn get_all_analyses(&self) -> AppResult<Vec<Analysis>>;
    fn get_analysis_by_id(&self, id: &str) -> AppResult<Option<Analysis>>;
    fn get_analyses_by_category(&self, category_id: &str) -> AppResult<Vec<Analysis>>;
    fn save_analysis(&self, analysis: &Analysis) -> AppResult<()>;
    fn delete_analysis(&self, id: &str) -> AppResult<()>;
    /// 只更新 metadata 字段（R40 扫描排除配置），不动 analysis 其它字段
    fn update_metadata(&self, id: &str, metadata: &str) -> AppResult<()>;

    fn get_all_analysis_categories(&self) -> AppResult<Vec<AnalysisCategory>>;
    fn get_analysis_category_by_id(&self, id: &str) -> AppResult<Option<AnalysisCategory>>;
    fn save_analysis_category(&self, category: &AnalysisCategory) -> AppResult<()>;
    fn delete_analysis_category(&self, id: &str) -> AppResult<()>;
}

pub struct SqliteAnalysisRepository {
    db: Arc<Database>,
}

impl Clone for SqliteAnalysisRepository {
    fn clone(&self) -> Self {
        Self {
            db: self.db.clone(),
        }
    }
}

impl SqliteAnalysisRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn row_to_analysis(&self, row: &rusqlite::Row) -> rusqlite::Result<Analysis> {
        Ok(Analysis {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            project_root: row.get(3)?,
            editor_components: row.get(4)?,
            editor_layers: row.get(5)?,
            canvas_config: row.get(6)?,
            global_components: row.get(7)?,
            views: row.get(8)?,
            active_view_id: row.get(9)?,
            viewport_sync_rules: row.get(10)?,
            category_id: row.get(11)?,
            tags: row.get(12)?,
            status: crate::domain::analysis::AnalysisStatus::from(row.get::<_, String>(13)?),
            metadata: row.get(14)?,
            scan_status: row.get(15)?,
            scan_progress: row.get::<_, i64>(16)?,
            last_scanned_at: row.get(17)?,
            total_files: row.get::<_, i64>(18)?,
            total_lines: row.get::<_, i64>(19)?,
            primary_language: row.get(20)?,
            created_at: row.get::<_, i64>(21)?,
            updated_at: row.get::<_, i64>(22)?,
        })
    }

    fn row_to_category(&self, row: &rusqlite::Row) -> rusqlite::Result<AnalysisCategory> {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let icon: Option<String> = row.get(2)?;
        let color: Option<String> = row.get(3)?;
        let sort_order: i32 = row.get(4)?;
        let parent_id: Option<String> = row.get(5)?;
        let description: Option<String> = row.get(6)?;
        let created_at: i64 = row.get(7)?;
        let updated_at: i64 = row.get(8)?;

        Ok(AnalysisCategory {
            id,
            name,
            icon,
            color,
            sort_order,
            parent_id,
            description,
            created_at,
            updated_at,
        })
    }
}

impl AnalysisRepository for SqliteAnalysisRepository {
    fn get_all_analyses(&self) -> AppResult<Vec<Analysis>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut stmt = conn.prepare(
            "SELECT id, name, description, project_root, editor_components, editor_layers, canvas_config,
                    global_components, views, active_view_id, viewport_sync_rules, category_id, tags,
                    status, metadata, scan_status, scan_progress, last_scanned_at, total_files,
                    total_lines, primary_language, created_at, updated_at
             FROM analyses
             ORDER BY updated_at DESC"
        )?;

        let rows = stmt.query_map([], |row| self.row_to_analysis(row))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }

        Ok(result)
    }

    fn get_analysis_by_id(&self, id: &str) -> AppResult<Option<Analysis>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let result = conn.query_row(
            "SELECT id, name, description, project_root, editor_components, editor_layers, canvas_config,
                    global_components, views, active_view_id, viewport_sync_rules, category_id, tags,
                    status, metadata, scan_status, scan_progress, last_scanned_at, total_files,
                    total_lines, primary_language, created_at, updated_at
             FROM analyses WHERE id = ?1",
            [id],
            |row| self.row_to_analysis(row),
        );

        match result {
            Ok(scene) => Ok(Some(scene)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    fn get_analyses_by_category(&self, category_id: &str) -> AppResult<Vec<Analysis>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut stmt = conn.prepare(
            "SELECT id, name, description, project_root, editor_components, editor_layers, canvas_config,
                    global_components, views, active_view_id, viewport_sync_rules, category_id, tags,
                    status, metadata, scan_status, scan_progress, last_scanned_at, total_files,
                    total_lines, primary_language, created_at, updated_at
             FROM analyses WHERE category_id = ?1
             ORDER BY updated_at DESC"
        )?;

        let rows = stmt.query_map([category_id], |row| self.row_to_analysis(row))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }

        Ok(result)
    }

    fn save_analysis(&self, analysis: &Analysis) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let status_str: String = analysis.status.clone().into();

        conn.execute(
            "INSERT OR REPLACE INTO analyses (id, name, description, project_root, editor_components, editor_layers, canvas_config, global_components, views, active_view_id, viewport_sync_rules, category_id, tags, status, metadata, scan_status, scan_progress, last_scanned_at, total_files, total_lines, primary_language, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, strftime('%s', 'now'))",
            rusqlite::params![
                &analysis.id,
                &analysis.name,
                &analysis.description,
                &analysis.project_root,
                &analysis.editor_components,
                &analysis.editor_layers,
                &analysis.canvas_config,
                &analysis.global_components,
                &analysis.views,
                &analysis.active_view_id,
                &analysis.viewport_sync_rules,
                &analysis.category_id,
                &analysis.tags,
                &status_str,
                &analysis.metadata,
                &analysis.scan_status,
                analysis.scan_progress,
                &analysis.last_scanned_at,
                analysis.total_files,
                analysis.total_lines,
                &analysis.primary_language,
                analysis.created_at,
            ],
        ).map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    fn delete_analysis(&self, id: &str) -> AppResult<()> {
        let mut conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // v2.14 级联清理：孤儿数据根因 —— 此前只删 analyses 主表，project_* 等子表
        // 按 analysis_id 残留（曾积累 27k 孤儿符号 / 23.8 万索引行 / 21k 数据流）。
        // 事务包裹：任一子表删除失败则整体回滚，不留半删状态。
        const CHILD_TABLES: &[&str] = &[
            "ai_code_changes",
            "ai_insights",
            "project_call_edges",
            "project_change_coupling",
            "project_code_clones",
            "project_code_fts",
            "project_code_index",
            "project_data_flow",
            "project_dependencies",
            "project_file_metrics",
            "project_files",
            "project_git_churn",
            "project_layers",
            "project_modules",
            "project_symbol_refs",
            "project_symbols",
            "project_tech_debt",
            "review_findings",
            "scan_jobs",
        ];
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        for table in CHILD_TABLES {
            let sql = format!("DELETE FROM {} WHERE analysis_id = ?1", table);
            tx.execute(&sql, rusqlite::params![id])
                .map_err(|e| AppError::Database(e.to_string()))?;
        }
        tx.execute("DELETE FROM analyses WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    fn update_metadata(&self, id: &str, metadata: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        conn.execute(
            "UPDATE analyses SET metadata = ?1, updated_at = strftime('%s', 'now') WHERE id = ?2",
            rusqlite::params![metadata, id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    fn get_all_analysis_categories(&self) -> AppResult<Vec<AnalysisCategory>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut stmt = conn.prepare(
            "SELECT id, name, icon, color, sort_order, parent_id, description, created_at, updated_at
             FROM scene_categories
             ORDER BY sort_order ASC, name ASC"
        )?;

        let rows = stmt.query_map([], |row| self.row_to_category(row))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }

        Ok(result)
    }

    fn get_analysis_category_by_id(&self, id: &str) -> AppResult<Option<AnalysisCategory>> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let result = conn.query_row(
            "SELECT id, name, icon, color, sort_order, parent_id, description, created_at, updated_at
             FROM scene_categories WHERE id = ?1",
            [id],
            |row| self.row_to_category(row),
        );

        match result {
            Ok(cat) => Ok(Some(cat)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    fn save_analysis_category(&self, category: &AnalysisCategory) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        conn.execute(
            "INSERT OR REPLACE INTO scene_categories (id, name, icon, color, sort_order, parent_id, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, strftime('%s', 'now'))",
            rusqlite::params![
                &category.id,
                &category.name,
                &category.icon,
                &category.color,
                category.sort_order,
                &category.parent_id,
                &category.description,
                category.created_at,
            ],
        ).map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    fn delete_analysis_category(&self, id: &str) -> AppResult<()> {
        let conn = self
            .db
            .0
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        conn.execute(
            "DELETE FROM scene_categories WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }
}
