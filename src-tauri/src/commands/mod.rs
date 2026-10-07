/// AI Agent 系统（LLM 配置 + 流式对话 + 工具调用）
pub mod agent;
/// AI 上下文包持久化（模块供给者产物落库，供 Agent 按需取用）
pub mod ai_context;
pub mod analysis;
pub mod asset;
pub mod auth;
pub mod call_graph;
/// 变更耦合分析（时间维度耦合：总是一起改的文件对 / 隐性架构耦合）
pub mod change_coupling;
pub mod code_clone;
pub mod code_index;
pub mod code_structure;
/// 代码写回（R46 P1：AI 改代码的前提；受控写盘 + 备份 + 触发增量重扫）
pub mod code_write;
pub mod component_plugin;
/// 过程间数据流分析（函数级 def-use 摘要：谁把输入传出去了）
pub mod data_flow;
pub mod datasource;
pub mod dead_code;
/// 设计模式识别引擎（被 code_structure 调用；无 tauri command，故不做 glob 再导出）
pub mod design_patterns;
pub mod file_metrics;
pub mod file_watcher;
pub mod git_history;
pub mod icons;
pub mod logger;
/// 操作系统级辅助命令（Reveal in File Manager 等，仅依赖 std）
pub mod os;
/// 解析器能力查询（R45 前后端能力联动：前端按后端真实能力矩阵对齐）
pub mod parser_capabilities;
pub mod project_scan;
pub mod review;
pub mod settings;
pub mod source_view;
pub mod tech_debt;
/// 代码工作台集成终端（IDE 标准可交互 shell：portable_pty + 前端 xterm.js）
pub mod terminal;
pub use os::*;
/// ACP Host WebSocket 桥（P0.1）：外部 ACP Agent 经 ws 驱动本工作台（传输层，无业务逻辑）
pub mod acp_ws;
pub use acp_ws::*;

pub use agent::*;
pub use ai_context::*;
pub use analysis::*;
pub use asset::*;
pub use auth::*;
pub use call_graph::*;
pub use change_coupling::*;
pub use code_clone::*;
pub use code_index::*;
pub use code_structure::*;
pub use code_write::*;
pub use component_plugin::*;
pub use data_flow::*;
pub use datasource::*;
pub use dead_code::*;
pub use file_metrics::*;
pub use file_watcher::*;
pub use git_history::*;
pub use icons::*;
pub use logger::*;
pub use parser_capabilities::*;
pub use project_scan::*;
pub use review::*;
pub use settings::*;
pub use source_view::*;
pub use tech_debt::*;
pub use terminal::*;
/// 写作域命令（Sight Folio：书籍与章节 CRUD）
pub mod writing;
pub use writing::*;
pub mod corpus;
pub use corpus::*;
