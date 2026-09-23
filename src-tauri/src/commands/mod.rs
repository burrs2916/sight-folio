pub mod asset;
pub mod auth;
pub mod component_plugin;
pub mod datasource;
pub mod icons;
pub mod logger;
pub mod analysis;
pub mod settings;
pub mod project_scan;
pub mod review;
pub mod file_watcher;
pub mod code_structure;
/// 设计模式识别引擎（被 code_structure 调用；无 tauri command，故不做 glob 再导出）
pub mod design_patterns;
pub mod file_metrics;
pub mod tech_debt;
pub mod code_index;
pub mod dead_code;
pub mod git_history;
pub mod call_graph;
pub mod source_view;
pub mod code_clone;
/// 变更耦合分析（时间维度耦合：总是一起改的文件对 / 隐性架构耦合）
pub mod change_coupling;
/// 过程间数据流分析（函数级 def-use 摘要：谁把输入传出去了）
pub mod data_flow;
/// AI Agent 系统（LLM 配置 + 流式对话 + 工具调用）
pub mod agent;
/// AI 上下文包持久化（模块供给者产物落库，供 Agent 按需取用）
pub mod ai_context;
/// 解析器能力查询（R45 前后端能力联动：前端按后端真实能力矩阵对齐）
pub mod parser_capabilities;
/// 代码写回（R46 P1：AI 改代码的前提；受控写盘 + 备份 + 触发增量重扫）
pub mod code_write;
/// 代码工作台集成终端（IDE 标准可交互 shell：portable_pty + 前端 xterm.js）
pub mod terminal;
/// 操作系统级辅助命令（Reveal in File Manager 等，仅依赖 std）
pub mod os;
pub use os::*;
/// ACP Host WebSocket 桥（P0.1）：外部 ACP Agent 经 ws 驱动本工作台（传输层，无业务逻辑）
pub mod acp_ws;
pub use acp_ws::*;

pub use asset::*;
pub use auth::*;
pub use component_plugin::*;
pub use datasource::*;
pub use icons::*;
pub use logger::*;
pub use analysis::*;
pub use settings::*;
pub use project_scan::*;
pub use review::*;
pub use file_watcher::*;
pub use code_structure::*;
pub use file_metrics::*;
pub use tech_debt::*;
pub use code_index::*;
pub use dead_code::*;
pub use git_history::*;
pub use call_graph::*;
pub use source_view::*;
pub use code_clone::*;
pub use change_coupling::*;
pub use data_flow::*;
pub use agent::*;
pub use ai_context::*;
pub use parser_capabilities::*;
pub use code_write::*;
pub use terminal::*;
/// 写作域命令（Sight Folio：书籍与章节 CRUD）
pub mod writing;
pub use writing::*;
pub mod corpus;
pub use corpus::*;
