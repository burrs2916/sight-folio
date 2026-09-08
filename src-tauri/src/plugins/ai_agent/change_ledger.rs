//! AI 改动台账（R47 P2-A）
//!
//! 承接 `code_patch` 的定位结果，负责三件事：**登记**、**列出**、**撤销**。
//!
//! 设计立场：磁盘是唯一真相源
//! -------------------------
//! 另一种流行做法是「AI 的改动先进内存待审队列，用户点确认才写盘」。我们不这么做，
//! 原因是本项目的整条链路都建立在磁盘之上：写盘 → file_watcher → 增量重扫 →
//! metrics/引用/技术债刷新 → 打开的标签页原地重载。改动不落盘，AI 就读不到自己的修改
//! （多步改同一文件必然基于过期内容），扫描也无法验证这次改动带来的质量变化，
//! 「AI 改完自动验证」的闭环整条断掉。
//!
//! 所以形态与 VS Code 的 Agent 编辑一致：**先落盘、再评审**，代价是必须提供可靠的撤销。
//! 撤销的可靠性全在 `revert_change` 的三档降级上——它是这个模块真正的核心，
//! 其余都是 CRUD。
//!
//! 撤销为什么必须分三档
//! -------------------
//! 用户点「撤销」时，文件可能已经不是 AI 写下的那一份了（他自己改过、或 AI 又改了一轮）。
//! 此时拿改动前快照整文回写，会连带吞掉这些后续修改——一次撤销制造两处数据丢失。
//! 因此：
//!   ① 磁盘指纹 == 我们写盘后的指纹 → 整文回写快照（完全精确）；
//!   ② 指纹不符，但 `new_text` 在当前内容里仍**唯一**出现 → 只把这一处换回 `old_text`
//!      （片段级回滚，保留后续修改）；
//!   ③ 两者都不成立 → 拒绝撤销，回报原因并指向 `.bak`。宁可让用户手动处理，
//!      也不要在无法定位时改错地方。

use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::params;

use super::code_patch::{content_hash, revert_patch, PatchError};
use crate::infrastructure::Database;

/// 登记一条改动所需的全部信息（写盘成功之后调用）。
#[derive(Debug, Clone, Default)]
pub struct NewCodeChange {
    pub analysis_id: String,
    pub file_id: String,
    pub rel_path: String,
    pub abs_path: String,
    /// "patch" | "full"
    pub mode: String,
    /// "agent"（AI 自己写盘，进待审）| "user"（用户在面板点应用，直接确认）
    pub origin: String,
    pub reason: String,
    pub old_text: String,
    pub new_text: String,
    /// 改动前全文；None = 不留快照（超大文件），撤销时只能走片段级
    pub before_content: Option<String>,
    pub after_content_hash: String,
    pub before_lines: i64,
    pub after_lines: i64,
    pub start_line: i64,
    pub end_line: i64,
    pub approx: bool,
    pub conversation_id: String,
    /// "pending" | "kept"
    pub status: String,
}

/// 台账行（发给前端评审视图）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeChangeRow {
    pub id: String,
    pub analysis_id: String,
    pub file_id: String,
    pub rel_path: String,
    pub mode: String,
    pub origin: String,
    pub reason: String,
    pub old_text: String,
    pub new_text: String,
    /// 是否留有改动前全文快照（决定撤销能力强弱，UI 需要据此提示）
    pub has_snapshot: bool,
    pub before_lines: i64,
    pub after_lines: i64,
    pub delta_lines: i64,
    pub start_line: i64,
    pub end_line: i64,
    pub approx: bool,
    pub conversation_id: String,
    pub status: String,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
}

/// 撤销结果：告诉前端走了哪一档，UI 需要区分措辞
/// （整文回滚可以说「已还原」，片段回滚只能说「已还原这一处」）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertOutcome {
    pub id: String,
    pub rel_path: String,
    pub abs_path: String,
    /// "snapshot"（整文回写）| "fragment"（片段级反向补丁）
    pub strategy: String,
    pub new_lines: usize,
    /// 撤销后写入磁盘的内容（调用方据此 emit file-changes / 刷新编辑器）
    #[serde(skip)]
    pub content: String,
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// 超过这个体量就不留全文快照：一条 512KB 的记录 × 每轮几十条改动会把配置库
/// 撑成几十 MB，而这类超大文件本来就不该整文替换（护栏也会拦）。
/// 不留快照不等于不能撤销——片段级反向补丁仍然可用。
const SNAPSHOT_LIMIT_BYTES: usize = 512 * 1024;

pub struct ChangeLedger;

impl ChangeLedger {
    /// 快照裁剪：超限返回 None（调用方无需自己判断，避免两处口径不一致）
    pub fn snapshot_or_none(before: &str) -> Option<String> {
        if before.len() > SNAPSHOT_LIMIT_BYTES {
            None
        } else {
            Some(before.to_string())
        }
    }

    pub fn record(db: &Arc<Database>, change: &NewCodeChange) -> Result<String, String> {
        let id = format!("chg_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let delta = change.after_lines - change.before_lines;
        conn.execute(
            "INSERT INTO ai_code_changes (
                id, analysis_id, file_id, rel_path, abs_path, mode, origin, reason,
                old_text, new_text, before_content, after_hash,
                before_lines, after_lines, delta_lines, start_line, end_line, approx,
                conversation_id, status, created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
            params![
                id,
                change.analysis_id,
                change.file_id,
                change.rel_path,
                change.abs_path,
                change.mode,
                change.origin,
                change.reason,
                change.old_text,
                change.new_text,
                change.before_content,
                change.after_content_hash,
                change.before_lines,
                change.after_lines,
                delta,
                change.start_line,
                change.end_line,
                if change.approx { 1 } else { 0 },
                change.conversation_id,
                change.status,
                now_secs(),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    }

    /// 列出改动。`status`：None = 全部；Some("pending") = 只看待审。
    pub fn list(
        db: &Arc<Database>,
        analysis_id: &str,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<CodeChangeRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let lim = limit.clamp(1, 500);
        let sql = if status.is_some() {
            "SELECT id, analysis_id, file_id, rel_path, mode, origin, reason, old_text, new_text,
                    before_content IS NOT NULL, before_lines, after_lines, delta_lines,
                    start_line, end_line, approx, conversation_id, status, created_at, resolved_at
             FROM ai_code_changes WHERE analysis_id = ?1 AND status = ?2
             ORDER BY created_at DESC, rowid DESC LIMIT ?3"
        } else {
            "SELECT id, analysis_id, file_id, rel_path, mode, origin, reason, old_text, new_text,
                    before_content IS NOT NULL, before_lines, after_lines, delta_lines,
                    start_line, end_line, approx, conversation_id, status, created_at, resolved_at
             FROM ai_code_changes WHERE analysis_id = ?1 AND ?2 = ''
             ORDER BY created_at DESC, rowid DESC LIMIT ?3"
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![analysis_id, status.unwrap_or(""), lim], |row| {
                Ok(CodeChangeRow {
                    id: row.get(0)?,
                    analysis_id: row.get(1)?,
                    file_id: row.get(2)?,
                    rel_path: row.get(3)?,
                    mode: row.get(4)?,
                    origin: row.get(5)?,
                    reason: row.get(6)?,
                    old_text: row.get(7)?,
                    new_text: row.get(8)?,
                    has_snapshot: row.get::<_, i64>(9)? == 1,
                    before_lines: row.get(10)?,
                    after_lines: row.get(11)?,
                    delta_lines: row.get(12)?,
                    start_line: row.get(13)?,
                    end_line: row.get(14)?,
                    approx: row.get::<_, i64>(15)? == 1,
                    conversation_id: row.get(16)?,
                    status: row.get(17)?,
                    created_at: row.get(18)?,
                    resolved_at: row.get(19)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// 待审计数（AI 面板徽标用，避免为了一个数字把全量记录拉过去）
    pub fn pending_count(db: &Arc<Database>, analysis_id: &str) -> Result<i64, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM ai_code_changes WHERE analysis_id = ?1 AND status = 'pending'",
            params![analysis_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    }

    /// 标记状态（kept = 用户确认保留 / reverted = 已撤销）。
    pub fn set_status(db: &Arc<Database>, id: &str, status: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute(
                "UPDATE ai_code_changes SET status = ?2, resolved_at = ?3 WHERE id = ?1",
                params![id, status, now_secs()],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("change '{}' not found", id));
        }
        Ok(())
    }

    /// 一次性确认某个分析下所有待审改动（「全部保留」）。返回影响条数。
    pub fn keep_all(db: &Arc<Database>, analysis_id: &str) -> Result<usize, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE ai_code_changes SET status = 'kept', resolved_at = ?2
             WHERE analysis_id = ?1 AND status = 'pending'",
            params![analysis_id, now_secs()],
        )
        .map_err(|e| e.to_string())
    }

    /// 撤销一条改动（三档降级，见模块头注释）。
    ///
    /// 写盘在本函数内完成（撤销必须原子地「决定策略 + 落盘 + 改状态」，
    /// 拆到调用方会出现「状态已改成 reverted 但盘没回滚」的中间态）。
    pub fn revert(db: &Arc<Database>, id: &str) -> Result<RevertOutcome, String> {
        // 1) 取记录（尽早释放锁：随后要读写文件，不该攥着 DB 锁做 IO）
        let (rel_path, abs_path, before_content, after_hash, old_text, new_text, status) = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT rel_path, abs_path, before_content, after_hash, old_text, new_text, status
                 FROM ai_code_changes WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .map_err(|_| format!("change '{}' not found", id))?
        };

        if status == "reverted" {
            return Err(format!("change '{}' was already reverted", id));
        }

        let path = PathBuf::from(&abs_path);
        if abs_path.is_empty() || !path.exists() {
            return Err(format!(
                "cannot revert: file '{}' no longer exists on disk",
                rel_path
            ));
        }
        let current = std::fs::read_to_string(&path)
            .map_err(|e| format!("cannot revert: read '{}' failed: {}", rel_path, e))?;

        // 2) 三档降级
        let (content, strategy) = if let Some(snapshot) = before_content
            .as_ref()
            .filter(|_| content_hash(&current) == after_hash && !after_hash.is_empty())
        {
            // ① 磁盘还是我们写下的那一份 → 整文回写（完全精确）
            (snapshot.clone(), "snapshot")
        } else if !new_text.is_empty() {
            // ② 文件后来被改过 → 只把这一处换回去，保住后续修改
            match revert_patch(&current, &old_text, &new_text) {
                Ok(res) => (res.content, "fragment"),
                Err(e) => {
                    return Err(format!(
                        "cannot revert '{}' safely: {} A newer edit overlaps this change — \
                         restore manually from '{}.bak' if needed.",
                        rel_path,
                        revert_hint(&e),
                        abs_path
                    ))
                }
            }
        } else {
            return Err(format!(
                "cannot revert '{}': the file changed after this edit and no anchor text is \
                 recorded (full-content write). Restore manually from '{}.bak'.",
                rel_path, abs_path
            ));
        };

        std::fs::write(&path, &content)
            .map_err(|e| format!("cannot revert: write '{}' failed: {}", rel_path, e))?;

        Self::set_status(db, id, "reverted")?;

        Ok(RevertOutcome {
            id: id.to_string(),
            rel_path,
            abs_path,
            strategy: strategy.to_string(),
            new_lines: content.lines().count(),
            content,
        })
    }

    /// 撤销某次会话产生的全部改动（对标 VS Code Copilot Edits 的「Discard all」）。
    ///
    /// 按 `created_at DESC` 逆序逐条还原：同一文件里后落地的改动先撤销，
    /// 它的锚点（new_text）还在、而更早改动的锚点尚未被破坏——顺序错了会出现
    /// 「先撤的把后撤的锚点也吃了」导致后续 revert 找不到片段。每条复用 `revert`
    /// 既有三档降级，撤销本身是安全的；个别失败不阻断其余（首个错误回传前端提示）。
    pub fn revert_by_conversation(
        db: &Arc<Database>,
        conversation_id: &str,
    ) -> Result<Vec<String>, String> {
        let ids: Vec<String> = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            conn.prepare(
                "SELECT id FROM ai_code_changes WHERE conversation_id = ?1 AND status != 'reverted' \
                 ORDER BY created_at DESC, rowid DESC",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![conversation_id], |r| r.get::<_, String>(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .map_err(|e| e.to_string())?
        };
        let mut reverted_paths: Vec<String> = Vec::new();
        let mut first_err: Option<String> = None;
        for id in ids {
            match ChangeLedger::revert(db, &id) {
                Ok(out) => reverted_paths.push(out.abs_path),
                Err(e) => {
                    if first_err.is_none() {
                        first_err = Some(e);
                    }
                }
            }
        }
        if reverted_paths.is_empty() {
            if let Some(e) = first_err {
                return Err(e);
            }
        }
        Ok(reverted_paths)
    }
}

/// 把补丁错误翻译成撤销语境下的人话（同一个 PatchError 在「应用」与「撤销」
/// 两个方向上该说的话不同：应用时要引导模型重读文件，撤销时要告诉用户为什么不敢动）。
fn revert_hint(e: &PatchError) -> String {
    match e {
        PatchError::NotFound => "the changed snippet is no longer present.".to_string(),
        PatchError::Ambiguous(n) => {
            format!("the changed snippet now appears {} times (ambiguous).", n)
        }
        PatchError::EmptyAnchor => "no anchor text recorded.".to_string(),
        PatchError::NoOp => "the change is already undone.".to_string(),
        PatchError::OccurrenceOutOfRange { .. } => "the snippet count no longer matches.".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_is_dropped_beyond_limit() {
        let small = "a".repeat(1024);
        assert!(ChangeLedger::snapshot_or_none(&small).is_some());
        let huge = "a".repeat(SNAPSHOT_LIMIT_BYTES + 1);
        assert!(
            ChangeLedger::snapshot_or_none(&huge).is_none(),
            "oversized snapshots must be dropped, not stored"
        );
    }

    #[test]
    fn revert_hint_differs_per_reason() {
        // 撤销失败必须说清「为什么不敢动」，否则用户只会重复点按钮
        assert!(revert_hint(&PatchError::NotFound).contains("no longer present"));
        assert!(revert_hint(&PatchError::Ambiguous(3)).contains("3 times"));
    }
}
