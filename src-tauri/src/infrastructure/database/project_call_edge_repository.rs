use crate::domain::project_call_edges::CallEdge;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ProjectCallEdgeRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<CallEdge>>;
    fn save_batch(&self, items: &[CallEdge]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
    /// 增量重扫：仅删除「变更/新增/删除」文件的调用边（按 caller_file_path 匹配），
    /// 保留未变调用方的旧边，避免重插整个表。
    fn delete_by_analysis_and_files(
        &self,
        analysis_id: &str,
        rel_paths: &[String],
    ) -> AppResult<()>;
}

pub struct SqliteProjectCallEdgeRepository {
    db: Arc<Database>,
}

impl Clone for SqliteProjectCallEdgeRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteProjectCallEdgeRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

/// 行 → 调用边。
///
/// # 必须按**列名**读取，不要用位置索引
/// 本表经历过 `ALTER TABLE ADD COLUMN`（`callee_receiver`、`receiver_target` 都是后加的），
/// 故**物理列序**是 `…, line_no, kind, created_at, callee_receiver, receiver_target`，
/// 而下方 `CALL_COLS` 的显式 SELECT 列表把它**重排**成了
/// `…, line_no, kind, callee_receiver, receiver_target, created_at`（新列紧随语义相邻列）。
///
/// 此前这里是按位置索引读取，且索引写的是**物理序**（13/14/12），与 SELECT 列表的
/// 12/13/14 不一致 → `receiver_target` 实际读到 `created_at`（INTEGER），
/// 前端 `loadCallEdges` 直接报
/// `Invalid column type Integer at index: 14, name: created_at`。
///
/// 用列名读取可让本函数与两个列序彻底解耦：以后再加列，只改 `CALL_COLS` 与
/// `CallEdge` 结构体即可，不存在需要手工同步的第二处。
fn row_to_edge(row: &rusqlite::Row) -> rusqlite::Result<CallEdge> {
    Ok(CallEdge {
        id: row.get("id")?,
        analysis_id: row.get("analysis_id")?,
        caller_symbol_id: row.get("caller_symbol_id")?,
        caller_name: row.get("caller_name")?,
        caller_file_id: row.get("caller_file_id")?,
        caller_file_path: row.get("caller_file_path")?,
        callee_symbol_id: row.get("callee_symbol_id")?,
        callee_name: row.get("callee_name")?,
        callee_file_id: row.get("callee_file_id")?,
        callee_file_path: row.get("callee_file_path")?,
        line_no: row.get::<_, i64>("line_no")?,
        kind: row.get("kind")?,
        callee_receiver: row.get("callee_receiver")?,
        receiver_target: row.get("receiver_target")?,
        created_at: row.get::<_, i64>("created_at")?,
    })
}

const CALL_COLS: &str = "id, analysis_id, caller_symbol_id, caller_name, caller_file_id,
                         caller_file_path, callee_symbol_id, callee_name, callee_file_id,
                         callee_file_path, line_no, kind, callee_receiver, receiver_target, created_at";

impl ProjectCallEdgeRepository for SqliteProjectCallEdgeRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<CallEdge>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM project_call_edges WHERE analysis_id = ?1
             ORDER BY caller_file_path ASC, line_no ASC",
            CALL_COLS
        ))?;
        let items = stmt
            .query_map([analysis_id], row_to_edge)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(items)
    }

    fn save_batch(&self, items: &[CallEdge]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt =             tx.prepare(
                "INSERT OR REPLACE INTO project_call_edges
                 (id, analysis_id, caller_symbol_id, caller_name, caller_file_id,
                  caller_file_path, callee_symbol_id, callee_name, callee_file_id,
                  callee_file_path, line_no, kind, callee_receiver, receiver_target, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            )?;
            for it in items {
                stmt.execute(rusqlite::params![
                    it.id,
                    it.analysis_id,
                    it.caller_symbol_id,
                    it.caller_name,
                    it.caller_file_id,
                    it.caller_file_path,
                    it.callee_symbol_id,
                    it.callee_name,
                    it.callee_file_id,
                    it.callee_file_path,
                    it.line_no,
                    it.kind,
                    it.callee_receiver,
                    it.receiver_target,
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
            "DELETE FROM project_call_edges WHERE analysis_id = ?1",
            [analysis_id],
        )?;
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
            "DELETE FROM project_call_edges WHERE analysis_id = ?1 AND caller_file_path IN ({})",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::Database;
    use rusqlite::Connection;
    use std::sync::Mutex;

    /// 按**生产真实的 schema 演进**建表：先建不含新列的表，再用 ALTER 追加。
    ///
    /// 这是本测试的核心价值所在——`callee_receiver` / `receiver_target` 都是后加的列，
    /// 故物理列序是 `…, kind, created_at, callee_receiver, receiver_target`，
    /// 而 `CALL_COLS` 的 SELECT 列表把它们**重排**成了
    /// `…, kind, callee_receiver, receiver_target, created_at`。
    /// 若 `row_to_edge` 退回位置索引且按物理序书写，本测试会立刻失败——
    /// 正是这个不同步曾让 `loadCallEdges` 报
    /// `Invalid column type Integer at index: 14, name: created_at`。
    fn make_repo() -> SqliteProjectCallEdgeRepository {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE project_call_edges (
                id TEXT, analysis_id TEXT, caller_symbol_id TEXT, caller_name TEXT,
                caller_file_id TEXT, caller_file_path TEXT, callee_symbol_id TEXT,
                callee_name TEXT, callee_file_id TEXT, callee_file_path TEXT,
                line_no INTEGER, kind TEXT, created_at INTEGER
             );
             ALTER TABLE project_call_edges ADD COLUMN callee_receiver TEXT;
             ALTER TABLE project_call_edges ADD COLUMN receiver_target TEXT;",
        )
        .unwrap();
        SqliteProjectCallEdgeRepository::new(Arc::new(Database(Mutex::new(conn))))
    }

    fn edge() -> CallEdge {
        CallEdge {
            id: "e1".into(),
            analysis_id: "a1".into(),
            caller_symbol_id: "cs".into(),
            caller_name: "callerFn".into(),
            caller_file_id: "cf".into(),
            caller_file_path: "src/a.ts".into(),
            callee_symbol_id: "ms".into(),
            callee_name: "calleeFn".into(),
            callee_file_id: "mf".into(),
            callee_file_path: "src/b.ts".into(),
            line_no: 42,
            kind: "cross-file".into(),
            callee_receiver: "obj".into(),
            receiver_target: "ClassA".into(),
            created_at: 1700000000,
        }
    }

    #[test]
    fn roundtrip_preserves_receiver_and_created_at_after_alter() {
        let repo = make_repo();
        repo.save_batch(&[edge()]).unwrap();
        let got = repo.list_by_analysis("a1").unwrap();
        assert_eq!(got.len(), 1, "应读回一条边（错位时会直接报 Invalid column type）");
        let e = &got[0];
        assert_eq!(e.callee_receiver, "obj", "接收者不得读到 receiver_target");
        assert_eq!(e.receiver_target, "ClassA", "接收者类型不得读到 created_at");
        assert_eq!(e.created_at, 1700000000, "created_at 不得读到 callee_receiver");
        assert_eq!(e.line_no, 42);
        assert_eq!(e.kind, "cross-file");
    }

    #[test]
    fn empty_receiver_columns_are_preserved_as_empty_not_shifted() {
        // 新列为空串的旧数据：错位时会读到相邻列的值（非 None 语义），必须保持空串
        let repo = make_repo();
        let mut e = edge();
        e.callee_receiver = String::new();
        e.receiver_target = String::new();
        repo.save_batch(&[e]).unwrap();
        let got = repo.list_by_analysis("a1").unwrap();
        assert_eq!(got[0].callee_receiver, "");
        assert_eq!(got[0].receiver_target, "");
        assert_eq!(got[0].created_at, 1700000000);
    }
}
