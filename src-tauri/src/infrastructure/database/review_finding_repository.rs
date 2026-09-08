use crate::domain::review_findings::ReviewFinding;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ReviewFindingRepository: Send + Sync {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ReviewFinding>>;
    fn count_by_severity(&self, analysis_id: &str) -> AppResult<std::collections::HashMap<String, i64>>;
    fn save_batch(&self, findings: &[ReviewFinding]) -> AppResult<()>;
    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()>;
    /// 按规则清理某次分析下该规则产生的旧 finding（重跑检测前调用，避免重复堆积）
    fn delete_by_rule(&self, analysis_id: &str, rule_id: &str) -> AppResult<()>;
    /// 幂等确保某条 review_rule 存在（INSERT OR IGNORE），用于运行时补全新规则，
    /// 避免依赖迁移重跑导致既有库缺失规则定义。
    fn ensure_rule(
        &self,
        id: &str,
        name: &str,
        description: &str,
        rule_type: &str,
        target_type: &str,
        rule_body: &str,
        severity: &str,
        scope: &str,
    ) -> AppResult<()>;
}

pub struct SqliteReviewFindingRepository {
    db: Arc<Database>,
}

impl Clone for SqliteReviewFindingRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteReviewFindingRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_finding(row: &rusqlite::Row) -> rusqlite::Result<ReviewFinding> {
    Ok(ReviewFinding {
        id: row.get(0)?,
        analysis_id: row.get(1)?,
        rule_id: row.get(2)?,
        target_id: row.get(3)?,
        target_type: row.get(4)?,
        severity: row.get(5)?,
        message: row.get(6)?,
        suggestion: row.get(7)?,
        status: row.get(8)?,
        found_at: row.get::<_, i64>(9)?,
        fixed_at: row.get(10)?,
        metadata: row.get(11)?,
    })
}

impl ReviewFindingRepository for SqliteReviewFindingRepository {
    fn list_by_analysis(&self, analysis_id: &str) -> AppResult<Vec<ReviewFinding>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_id, rule_id, target_id, target_type, severity, message, suggestion, status, found_at, fixed_at, metadata
             FROM review_findings WHERE analysis_id = ?1 ORDER BY found_at DESC",
        )?;
        let findings = stmt
            .query_map([analysis_id], row_to_finding)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(findings)
    }

    fn count_by_severity(&self, analysis_id: &str) -> AppResult<std::collections::HashMap<String, i64>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT severity, COUNT(*) FROM review_findings WHERE analysis_id = ?1 AND status = 'open' GROUP BY severity",
        )?;
        let mut map = std::collections::HashMap::new();
        let rows = stmt.query_map([analysis_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (sev, cnt) = row?;
            map.insert(sev, cnt);
        }
        Ok(map)
    }

    fn save_batch(&self, findings: &[ReviewFinding]) -> AppResult<()> {
        let mut conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO review_findings
                 (id, analysis_id, rule_id, target_id, target_type, severity, message, suggestion, status, found_at, fixed_at, metadata)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            )?;
            for f in findings {
                stmt.execute(rusqlite::params![
                    f.id, f.analysis_id, f.rule_id,
                    f.target_id, f.target_type, f.severity,
                    f.message, f.suggestion, f.status,
                    f.found_at, f.fixed_at, f.metadata,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_by_analysis(&self, analysis_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute("DELETE FROM review_findings WHERE analysis_id = ?1", [analysis_id])?;
        Ok(())
    }

    fn delete_by_rule(&self, analysis_id: &str, rule_id: &str) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "DELETE FROM review_findings WHERE analysis_id = ?1 AND rule_id = ?2",
            rusqlite::params![analysis_id, rule_id],
        )?;
        Ok(())
    }

    fn ensure_rule(
        &self,
        id: &str,
        name: &str,
        description: &str,
        rule_type: &str,
        target_type: &str,
        rule_body: &str,
        severity: &str,
        scope: &str,
    ) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT OR IGNORE INTO review_rules
             (id, name, description, rule_type, target_type, rule_body, severity, enabled, scope, builtin, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8,1,?9,?9)",
            rusqlite::params![id, name, description, rule_type, target_type, rule_body, severity, scope, now],
        )?;
        Ok(())
    }
}