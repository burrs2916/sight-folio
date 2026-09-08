use crate::domain::project_symbols::ProjectSymbol;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectSymbolRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectSymbol>>;
    fn save_batch(&self, symbols: &[ProjectSymbol]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
    /// 增量重扫：仅删除指定文件（rel_path，存于 file_path 列）的符号，保留其余。
    /// `rel_paths` 为空时直接返回（避免 `IN ()` 语法错误）——调用方据此省一次无谓写。
    fn delete_by_analysis_and_files(&self, analysis_id: &str, rel_paths: &[String]) -> AppResult<()>;
    fn count_by_kind(&self, analysis_id: &str) -> AppResult<std::collections::HashMap<String, i64>>;
    /// 设计模式重检测：仅更新单个符号的 `patterns` + `metadata` 两列。
    /// 不动 id/引用边/位置等其它列，避免整行重写导致符号稳定 id 与引用关系漂移。
    fn update_patterns(&self, id: &str, patterns: &str, metadata: &str) -> AppResult<()>;
    /// 符号索引搜索：name / file_path 模糊匹配（kind 权重排序，符号名短的优先）
    fn search(&self, analysis_id: &str, like: &str, limit: i64) -> AppResult<Vec<ProjectSymbol>>;
    /// 死代码候选：在 project_symbol_refs 中没有任何入边（to_symbol_id）的符号
    ///
    /// 只返回「有外部可见价值」的符号种类，method/const 这类噪音大的不参与，
    /// 是否真死还需在命令层过滤入口文件与测试文件。
    fn list_unreferenced(&self, analysis_id: &str) -> AppResult<Vec<ProjectSymbol>>;

    /// 跨文件未使用导出：已导出（export/pub）符号在本文件内有引用/调用，
    /// 但项目内其它文件均无任何引用或调用 —— 对标 joern `cpg.method.isPublic.whereNot(_.callIn)`
    /// （零外部调用入边＝未使用导出）。
    ///
    /// 依赖 analyze_symbol_references 与 analyze_call_graph 已运行，否则引用表为空会误判；
    /// 与 `list_unreferenced`（零引用即死）互补：本查询要求符号「至少被本文件使用过」，
    /// 专门挑出「被自身模块消费、但其导出面对外无人引用」的冗余导出，避免与 rule_dead_symbol 重复。
    fn list_unused_exports(&self, analysis_id: &str) -> AppResult<Vec<ProjectSymbol>>;
}

pub struct SqliteProjectSymbolRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectSymbolRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectSymbolRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_symbol(row: &rusqlite::Row) -> rusqlite::Result<ProjectSymbol> {
    Ok(ProjectSymbol {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        file_id: row.get(2)?,
        file_path: row.get(3)?,
        name: row.get(4)?,
        kind: row.get(5)?,
        line_start: row.get::<_, i64>(6)?,
        line_end: row.get::<_, i64>(7)?,
        signature: row.get(8)?,
        doc: row.get(9)?,
        modifiers: row.get(10)?,
        patterns: row.get(11)?,
        metadata: row.get(12)?,
        created_at: row.get::<_, i64>(13)?,
    })
}

const SYMBOL_COLS: &str = "id, analysis_id, file_id, file_path, name, kind, line_start, line_end,
                           signature, doc, modifiers, patterns, metadata, created_at";

impl ProjectSymbolRepository for SqliteProjectSymbolRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ProjectSymbol>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_symbols WHERE analysis_id = ?1 ORDER BY file_path ASC, line_start ASC",
            SYMBOL_COLS
        ))?;
        let symbols = stmt
            .query_map([analysis_id], row_to_symbol)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(symbols)
    }

    fn save_batch(&self, symbols: &[ProjectSymbol]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO project_symbols
                 (id, analysis_id, file_id, file_path, name, kind, line_start, line_end,
                  signature, doc, modifiers, patterns, metadata, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            )?;
            for s in symbols {
                stmt.execute(rusqlite::params![
                    s.id, s.analysis_id, s.file_id, s.file_path, s.name, s.kind,
                    s.line_start, s.line_end, s.signature, s.doc, s.modifiers,
                    s.patterns, s.metadata, s.created_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM project_symbols WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }

    fn delete_by_analysis_and_files(&self, analysis_id: &str, rel_paths: &[String]) -> AppResult<()> {
        if rel_paths.is_empty() {
            return Ok(());
        }
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let placeholders: Vec<&str> = (0..rel_paths.len()).map(|_| "?").collect();
        let sql = format!(
            "DELETE FROM project_symbols WHERE analysis_id = ?1 AND file_path IN ({})",
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

    fn count_by_kind(&self, analysis_id: &str) -> AppResult<std::collections::HashMap<String, i64>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT kind, COUNT(*) FROM project_symbols WHERE analysis_id = ?1 GROUP BY kind",
        )?;
        let rows = stmt
            .query_map([analysis_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows.into_iter().collect())
    }

    fn search(&self, analysis_id: &str, like: &str, limit: i64) -> AppResult<Vec<ProjectSymbol>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_symbols
             WHERE analysis_id = ?1 AND (name LIKE ?2 OR file_path LIKE ?2)
             ORDER BY CASE kind
                        WHEN 'class' THEN 0 WHEN 'interface' THEN 1 WHEN 'struct' THEN 2
                        WHEN 'function' THEN 3 WHEN 'method' THEN 4 WHEN 'enum' THEN 5
                        ELSE 6 END,
                      length(name) ASC, name ASC
             LIMIT ?3",
            SYMBOL_COLS
        ))?;
        let symbols = stmt
            .query_map(rusqlite::params![analysis_id, like, limit], row_to_symbol)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(symbols)
    }

    fn update_patterns(&self, id: &str, patterns: &str, metadata: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE project_symbols SET patterns = ?2, metadata = ?3 WHERE id = ?1",
            rusqlite::params![id, patterns, metadata],
        )?;
        Ok(())
    }

    fn list_unreferenced(&self, analysis_id: &str) -> AppResult<Vec<ProjectSymbol>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_symbols s
             WHERE s.analysis_id = ?1
               AND s.kind IN ('function','class','interface','struct','trait','enum','type_alias')
               AND NOT EXISTS (
                     SELECT 1 FROM project_symbol_refs r WHERE r.to_symbol_id = s.id
               )
               AND NOT EXISTS (
                     SELECT 1 FROM project_call_edges c WHERE c.callee_symbol_id = s.id
               )
             ORDER BY s.file_path ASC, s.line_start ASC",
            SYMBOL_COLS
        ))?;
        let symbols = stmt
            .query_map([analysis_id], row_to_symbol)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(symbols)
    }

    fn list_unused_exports(&self, analysis_id: &str) -> AppResult<Vec<ProjectSymbol>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_symbols s
             WHERE s.analysis_id = ?1
               AND s.kind IN ('function','class','interface','struct','trait','enum','type_alias','const')
               AND (lower(s.modifiers) LIKE '%export%' OR lower(s.modifiers) LIKE '%pub%')
               AND (
                   EXISTS (SELECT 1 FROM project_symbol_refs r
                           WHERE r.to_symbol_id = s.id AND r.from_file_id = s.file_id AND r.from_file_id <> '')
                   OR EXISTS (SELECT 1 FROM project_call_edges c
                           WHERE c.callee_symbol_id = s.id AND c.caller_file_id = s.file_id AND c.caller_file_id <> '')
               )
               AND NOT EXISTS (SELECT 1 FROM project_symbol_refs r
                           WHERE r.to_symbol_id = s.id AND r.from_file_id <> '' AND r.from_file_id <> s.file_id)
               AND NOT EXISTS (SELECT 1 FROM project_call_edges c
                           WHERE c.callee_symbol_id = s.id AND c.caller_file_id <> '' AND c.caller_file_id <> s.file_id)
             ORDER BY s.file_path ASC, s.line_start ASC",
            SYMBOL_COLS
        ))?;
        let symbols = stmt
            .query_map([analysis_id], row_to_symbol)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(symbols)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::Database;
    use std::sync::{Arc, Mutex};
    use rusqlite::Connection;

    fn make_repo() -> SqliteProjectSymbolRepository {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE project_symbols (
                id TEXT, analysis_id TEXT, file_id TEXT, file_path TEXT,
                name TEXT, kind TEXT, line_start INTEGER, line_end INTEGER,
                signature TEXT, doc TEXT, modifiers TEXT, patterns TEXT,
                metadata TEXT, created_at INTEGER
            );",
        )
        .unwrap();
        SqliteProjectSymbolRepository::new(Arc::new(Database(Mutex::new(conn))))
    }

    fn insert(repo: &SqliteProjectSymbolRepository, analysis: &str, file: &str, name: &str) {
        let sym = ProjectSymbol {
            id: format!("sym_{}_{}_{}_0", analysis, file, name),
            analysis_id: analysis.into(),
            file_id: format!("file_{}", file),
            file_path: file.into(),
            name: name.into(),
            kind: "function".into(),
            line_start: 1,
            line_end: 2,
            signature: String::new(),
            doc: None,
            modifiers: String::new(),
            patterns: "[]".into(),
            metadata: "{}".into(),
            created_at: 0,
        };
        repo.save_batch(&[sym]).unwrap();
    }

    #[test]
    fn delete_by_analysis_and_files_removes_only_target_files() {
        let repo = make_repo();
        insert(&repo, "a", "src/a.ts", "foo");
        insert(&repo, "a", "src/b.ts", "bar");
        insert(&repo, "a", "src/c.ts", "baz");
        insert(&repo, "other", "src/a.ts", "foo"); // 不同 analysis 不受影响

        repo.delete_by_analysis_and_files("a", &["src/b.ts".to_string()])
            .unwrap();

        let remaining = repo.list_by_analysis("a").unwrap();
        let paths: Vec<&str> = remaining.iter().map(|s| s.file_path.as_str()).collect();
        assert!(paths.contains(&"src/a.ts"));
        assert!(paths.contains(&"src/c.ts"));
        assert!(!paths.contains(&"src/b.ts"));
        assert_eq!(repo.list_by_analysis("other").unwrap().len(), 1);
    }

    #[test]
    fn delete_by_analysis_and_files_empty_is_noop() {
        let repo = make_repo();
        insert(&repo, "a", "src/a.ts", "foo");
        repo.delete_by_analysis_and_files("a", &[]).unwrap();
        assert_eq!(repo.list_by_analysis("a").unwrap().len(), 1);
    }

    #[test]
    fn list_unused_exports_finds_only_cross_file_unused_exports() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE project_symbols (
                id TEXT, analysis_id TEXT, file_id TEXT, file_path TEXT,
                name TEXT, kind TEXT, line_start INTEGER, line_end INTEGER,
                signature TEXT, doc TEXT, modifiers TEXT, patterns TEXT,
                metadata TEXT, created_at INTEGER
            );
            CREATE TABLE project_symbol_refs (
                id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, from_file_id TEXT NOT NULL,
                from_file_path TEXT NOT NULL, to_symbol_id TEXT, to_file_id TEXT NOT NULL,
                to_file_path TEXT NOT NULL, symbol_name TEXT NOT NULL, ref_line INTEGER,
                ref_text TEXT, kind TEXT, created_at INTEGER
            );
            CREATE TABLE project_call_edges (
                id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL,
                caller_symbol_id TEXT, caller_name TEXT, caller_file_id TEXT,
                caller_file_path TEXT, callee_symbol_id TEXT, callee_name TEXT,
                callee_file_id TEXT, callee_file_path TEXT, call_line INTEGER,
                call_text TEXT, kind TEXT, created_at INTEGER
            );",
        )
        .unwrap();
        let repo = SqliteProjectSymbolRepository::new(Arc::new(Database(Mutex::new(conn))));

        let mk = |id: &str, file: &str, name: &str, kind: &str, modifiers: &str| ProjectSymbol {
            id: id.into(),
            analysis_id: "a".into(),
            file_id: format!("file_{}", file),
            file_path: file.into(),
            name: name.into(),
            kind: kind.into(),
            line_start: 1,
            line_end: 2,
            signature: String::new(),
            doc: None,
            modifiers: modifiers.into(),
            patterns: "[]".into(),
            metadata: "{}".into(),
            created_at: 0,
        };
        // 1) 导出 + 本文件自引用 + 无跨文件引用 → 命中
        repo.save_batch(&[mk("s1", "src/util.ts", "formatDate", "function", "export")])
            .unwrap();
        // 2) 导出 + 有跨文件引用 → 不命中
        repo.save_batch(&[mk("s2", "src/api.ts", "fetchUser", "function", "export")])
            .unwrap();
        // 3) 非导出 + 本文件自引用 → 不命中（未导出）
        repo.save_batch(&[mk("s3", "src/helper.ts", "internalOnly", "function", "")]).unwrap();
        // 4) 导出 + 既无自引用也无跨文件引用 → 不命中（归 rule_dead_symbol 范畴）
        repo.save_batch(&[mk("s4", "src/orphan.ts", "neverUsed", "function", "export")])
            .unwrap();

        let db = repo.db.0.lock().unwrap();
        db.execute(
            "INSERT INTO project_symbol_refs (id, analysis_id, from_file_id, from_file_path, to_symbol_id, to_file_id, to_file_path, symbol_name, ref_line, ref_text, kind, created_at)
             VALUES ('r1','a','file_src/util.ts','src/util.ts','s1','file_src/util.ts','src/util.ts','formatDate',5,'','import',0)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO project_symbol_refs (id, analysis_id, from_file_id, from_file_path, to_symbol_id, to_file_id, to_file_path, symbol_name, ref_line, ref_text, kind, created_at)
             VALUES ('r2','a','file_src/main.ts','src/main.ts','s2','file_src/api.ts','src/api.ts','fetchUser',5,'','import',0)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO project_symbol_refs (id, analysis_id, from_file_id, from_file_path, to_symbol_id, to_file_id, to_file_path, symbol_name, ref_line, ref_text, kind, created_at)
             VALUES ('r3','a','file_src/helper.ts','src/helper.ts','s3','file_src/helper.ts','src/helper.ts','internalOnly',5,'','import',0)",
            [],
        )
        .unwrap();
        drop(db);

        let out = repo.list_unused_exports("a").unwrap();
        let ids: Vec<&str> = out.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["s1"],
            "只有 s1（导出且本文件自引用、无跨文件引用）应命中，实际: {:?}",
            ids
        );
    }
}
