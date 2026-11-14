pub mod change_ledger;
pub mod code_patch;
pub mod engine;
pub mod file_dossier;
/// 本地 Ollama 自动发现（扫描 + 识别 + 接入计划）
pub mod ollama;
pub mod openai_provider;
pub mod provider;
pub mod scan_records;
pub mod scope;
pub mod tools;

// ─── 运行时取消令牌表 ───
//
// `run_agent` 每次执行登记一个 run_id → `Arc<AtomicBool>`；`cancel_agent_run`
// 按 run_id 置位，引擎循环在每轮迭代前检查，实现「真取消」（对标 VS Code 的停止）。
// 见 docs/代码工作台-AI面板重构-复盘与设计.md §5 P2.3。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use tokio::sync::oneshot;

static RUN_CANCEL_TOKENS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

/// 为指定 run_id 登记（或取回已有）取消令牌。
pub fn register_run_token(run_id: &str) -> Arc<AtomicBool> {
    let map = RUN_CANCEL_TOKENS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(token) = guard.get(run_id) {
        return token.clone();
    }
    let token = Arc::new(AtomicBool::new(false));
    guard.insert(run_id.to_string(), token.clone());
    token
}

/// run 结束时移除令牌，避免表无限增长。
pub fn deregister_run_token(run_id: &str) {
    if let Some(map) = RUN_CANCEL_TOKENS.get() {
        map.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(run_id);
    }
}

/// 按 run_id 置位取消（幂等：已结束 / 未知 id 也返回成功，前端可重复点停止）。
pub fn request_cancel(run_id: &str) {
    if let Some(map) = RUN_CANCEL_TOKENS.get() {
        if let Some(token) = map
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(run_id)
        {
            token.store(true, Ordering::SeqCst);
        }
    }
}

// ─── 工具审批通道（human-in-the-loop）───
//
// 高危能力即便助手已授权该工具，也须用户在 UI 确认（对标 VS Code Agent 的「Run command?」拦截）：
//   - `run_command` 每条命令逐次确认；
//   - 写入类工具（apply_change、context_insight 的 save/resolve）支持「本会话不再询问」，
//     用户允许时可勾选记住（见 SESSION_TOOL_GRANTS）。
// 引擎在即将执行受审批工具前登记一次性 oneshot，把审批请求推给前端，等前端经
// `resolve_tool_approval` 落定后收到结果。超时 / 取消 / 通道异常一律按「拒绝」处理——
// 安全默认，绝不静默执行。

/// 审批落定结果：是否允许 + 是否本会话内对同类操作不再询问（写入类低危用）。
#[derive(Debug, Clone, Copy)]
pub struct ApprovalDecision {
    pub approved: bool,
    pub remember_session: bool,
}

impl ApprovalDecision {
    pub fn plain(approved: bool) -> Self {
        Self {
            approved,
            remember_session: false,
        }
    }
}

static TOOL_APPROVALS: OnceLock<Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>> =
    OnceLock::new();

/// 为 `run_id:tool_call_id` 登记一次性审批通道，返回接收端供引擎 await。
pub fn register_approval(key: &str) -> oneshot::Receiver<ApprovalDecision> {
    let (tx, rx) = oneshot::channel();
    let map = TOOL_APPROVALS.get_or_init(|| Mutex::new(HashMap::new()));
    map.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(key.to_string(), tx);
    rx
}

/// 前端落定审批结果；返回 true 表示引擎已收到。
pub fn resolve_approval(key: &str, decision: ApprovalDecision) -> bool {
    if let Some(map) = TOOL_APPROVALS.get() {
        if let Some(tx) = map
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(key)
        {
            return tx.send(decision).is_ok();
        }
    }
    false
}

/// 引擎在超时 / 取消退出等待时清理可能残留的发送端，避免登记表无限增长。
pub fn clear_approval(key: &str) {
    if let Some(map) = TOOL_APPROVALS.get() {
        map.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(key);
    }
}

// ─── 会话级工具授权 ───
//
// 写入类低危工具（apply_change / context_insight 的 save|resolve）在用户勾选
// 「本会话不再询问」后记入此表；应用重启即清空。仅按工具名记，不按参数记——
// 参数级记忆容易让用户在「允许这一个文件」后意外放行整批写入。

static SESSION_TOOL_GRANTS: OnceLock<Mutex<HashMap<String, ()>>> = OnceLock::new();

/// 该工具本会话内是否已被用户整体放行。
pub fn is_session_granted(tool: &str) -> bool {
    SESSION_TOOL_GRANTS
        .get()
        .map(|m| {
            m.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .contains_key(tool)
        })
        .unwrap_or(false)
}

/// 用户勾选「本会话不再询问」时按工具名登记。
pub fn grant_tool_for_session(tool: &str) {
    SESSION_TOOL_GRANTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(tool.to_string(), ());
}
