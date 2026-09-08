use crate::domain::review_rules::ReviewRule;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::Database;
use std::sync::Arc;

pub trait ReviewRuleRepository: Send + Sync {
    fn list_all(&self) -> AppResult<Vec<ReviewRule>>;
    fn list_enabled(&self) -> AppResult<Vec<ReviewRule>>;
    fn get(&self, id: &str) -> AppResult<Option<ReviewRule>>;
    fn save(&self, rule: &ReviewRule) -> AppResult<()>;
}

pub struct SqliteReviewRuleRepository {
    db: Arc<Database>,
}

impl Clone for SqliteReviewRuleRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteReviewRuleRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

fn row_to_rule(row: &rusqlite::Row) -> rusqlite::Result<ReviewRule> {
    Ok(ReviewRule {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        rule_type: row.get(3)?,
        target_type: row.get(4)?,
        rule_body: row.get(5)?,
        severity: row.get(6)?,
        enabled: row.get::<_, i64>(7)? != 0,
        scope: row.get(8)?,
        builtin: row.get::<_, i64>(9)? != 0,
        created_at: row.get::<_, i64>(10)?,
        updated_at: row.get::<_, i64>(11)?,
    })
}

impl ReviewRuleRepository for SqliteReviewRuleRepository {
    fn list_all(&self) -> AppResult<Vec<ReviewRule>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, rule_type, target_type, rule_body, severity, enabled, scope, builtin, created_at, updated_at
             FROM review_rules ORDER BY builtin DESC, target_type ASC, name ASC",
        )?;
        let rules = stmt
            .query_map([], row_to_rule)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rules)
    }

    fn list_enabled(&self) -> AppResult<Vec<ReviewRule>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, rule_type, target_type, rule_body, severity, enabled, scope, builtin, created_at, updated_at
             FROM review_rules WHERE enabled = 1 ORDER BY target_type ASC",
        )?;
        let rules = stmt
            .query_map([], row_to_rule)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rules)
    }

    fn get(&self, id: &str) -> AppResult<Option<ReviewRule>> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, rule_type, target_type, rule_body, severity, enabled, scope, builtin, created_at, updated_at
             FROM review_rules WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], row_to_rule)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    fn save(&self, rule: &ReviewRule) -> AppResult<()> {
        let conn = self.db.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO review_rules
             (id, name, description, rule_type, target_type, rule_body, severity, enabled, scope, builtin, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                rule.id, rule.name, rule.description, rule.rule_type, rule.target_type,
                rule.rule_body, rule.severity, rule.enabled as i64, rule.scope,
                rule.builtin as i64, rule.created_at, rule.updated_at,
            ],
        )?;
        Ok(())
    }
}