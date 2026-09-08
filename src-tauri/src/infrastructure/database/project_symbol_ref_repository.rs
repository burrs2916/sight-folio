use crate::domain::project_symbol_refs::SymbolRef;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectSymbolRefRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<SymbolRef>>;
    fn save_batch(&self, refs: &[SymbolRef]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
    /// 增量重扫：仅删除「变更/新增/删除」文件产生的引用（按 from_file_path 匹配），
    /// 保留未变文件的旧引用，避免重插整个表。
    fn delete_by_analysis_and_files(
        &self,
        analysis_id: &str,
        rel_paths: &[String],
    ) -> AppResult<()>;
}

pub struct SqliteProjectSymbolRefRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectSymbolRefRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectSymbolRefRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_ref(row: &rusqlite::Row) -> rusqlite::Result<SymbolRef> {
    Ok(SymbolRef {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        from_file_id: row.get(2)?,
        from_file_path: row.get(3)?,
        to_symbol_id: row.get(4)?,
        to_file_id: row.get(5)?,
        to_file_path: row.get(6)?,
        symbol_name: row.get(7)?,
        ref_line: row.get::<_, i64>(8)?,
        ref_text: row.get(9)?,
        kind: row.get(10)?,
        created_at: row.get::<_, i64>(11)?,
    })
}

const REF_COLS: &str = "id, analysis_id, from_file_id, from_file_path, to_symbol_id,
                        to_file_id, to_file_path, symbol_name, ref_line, ref_text,
                        kind, created_at";

impl ProjectSymbolRefRepository for SqliteProjectSymbolRefRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<SymbolRef>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_symbol_refs WHERE analysis_id = ?1
             ORDER BY from_file_path ASC, ref_line ASC",
            REF_COLS
        ))?;
        let refs = stmt
            .query_map([analysis_id], row_to_ref)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(refs)
    }

    fn save_batch(&self, refs: &[SymbolRef]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_symbol_refs
                 (id, analysis_id, from_file_id, from_file_path, to_symbol_id,
                  to_file_id, to_file_path, symbol_name, ref_line, ref_text,
                  kind, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            )?;
            for r in refs {
                stmt.execute(rusqlite::params![
                    r.id, r.analysis_id, r.from_file_id, r.from_file_path, r.to_symbol_id,
                    r.to_file_id, r.to_file_path, r.symbol_name, r.ref_line, r.ref_text,
                    r.kind, r.created_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_symbol_refs WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }

    fn delete_by_analysis_and_files(
        &self,
        analysis_id: &str,
        rel_paths: &[String],
    ) -> AppResult<()> {
        if rel_paths.is_empty() {
            return Ok(());
        }
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let placeholders: Vec<&str> = (0..rel_paths.len()).map(|_| "?").collect();
        let sql = format!(
            "DELETE FROM project_symbol_refs WHERE analysis_id = ?1 AND from_file_path IN ({})",
            placeholders.join(",")
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut params: Vec<&dyn rusqlite::types::ToSql> = vec![&analysis_id];
        for p in rel_paths {
            params.push(p);
        }
        stmt.execute(rusqlite::params_from_iter(params))?;
        Ok(())
    }
}
