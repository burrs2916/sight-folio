pub mod provider;
pub mod openai_provider;
pub mod engine;
pub mod scope;
pub mod tools;
pub mod scan_records;
pub mod file_dossier;
pub mod code_patch;
pub mod change_ledger;

// ─── 运行时取消令牌表 ───
//
// `run_agent` 每次执行登记一个 run_id → `Arc<AtomicBool>`；`cancel_agent_run`
// 按 run_id 置位，引擎循环在每轮迭代前检查，实现「真取消」（对标 VS Code 的停止）。
// 见 docs/代码工作台-AI面板重构-复盘与设计.md §5 P2.3。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::oneshot;

static RUN_CANCEL_TOKENS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

/// 为指定 run_id 登记（或取回已有）取消令牌。
pub fn register_run_token(run_id: &str) -> Arc<AtomicBool> {
    let map = RUN_CANCEL_TOKENS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap();
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
        map.lock().unwrap().remove(run_id);
    }
}

/// 按 run_id 置位取消（幂等：已结束 / 未知 id 也返回成功，前端可重复点停止）。
pub fn request_cancel(run_id: &str) {
    if let Some(map) = RUN_CANCEL_TOKENS.get() {
        if let Some(token) = map.lock().unwrap().get(run_id) {
            token.store(true, Ordering::SeqCst);
        }
    }
}

// ─── 工具审批通道（human-in-the-loop）───
//
// `run_command` 是高危能力：即便助手已授权该工具，每条 shell 命令仍须用户在 UI 确认
// （对标 VS Code Agent 运行终端命令前的「Run command?」拦截）。引擎在即将执行 run_command
// 前登记一次性 oneshot，把审批请求推给前端，等前端经 `resolve_tool_approval` 落定后收到
// true/false。超时 / 取消 / 通道异常一律按「拒绝」处理——安全默认，绝不静默执行。

static TOOL_APPROVALS: OnceLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> = OnceLock::new();

/// 为 `run_id:tool_call_id` 登记一次性审批通道，返回接收端供引擎 await。
pub fn register_approval(key: &str) -> oneshot::Receiver<bool> {
    let (tx, rx) = oneshot::channel();
    let map = TOOL_APPROVALS.get_or_init(|| Mutex::new(HashMap::new()));
    map.lock().unwrap().insert(key.to_string(), tx);
    rx
}

/// 前端落定审批结果；返回 true 表示引擎已收到。
pub fn resolve_approval(key: &str, approved: bool) -> bool {
    if let Some(map) = TOOL_APPROVALS.get() {
        if let Some(tx) = map.lock().unwrap().remove(key) {
            return tx.send(approved).is_ok();
        }
    }
    false
}

/// 引擎在超时 / 取消退出等待时清理可能残留的发送端，避免登记表无限增长。
pub fn clear_approval(key: &str) {
    if let Some(map) = TOOL_APPROVALS.get() {
        map.lock().unwrap().remove(key);
    }
}
