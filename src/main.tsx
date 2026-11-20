import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { registerBuiltinComponents } from "./editor/registry";
// 注册 AI 上下文供给者（扫描 → 上下文包的构建器），随应用启动加载。
import "./ai/providers/scanContextProvider";
// 注册需求基线供给者（客户陈述的需求规格 → 上下文包的构建器），与扫描供给者并列。
import "./ai/providers/requirementsSpecProvider";
// 注册写作域供给者（书籍/章节/人设卡/世界观 → 上下文包的构建器），与扫描供给者并列。
import "./ai/providers/writingContextProvider";

registerBuiltinComponents();

// ─── 前端诊断日志桥接（发布兼容性准备）───
// 打包版没有控制台，WebView 里未捕获的 JS 错误在 release 下完全无痕。
// 这里把全局错误同步到 Rust 端的 debug.log（exe 同级 / %LOCALAPPDATA%），
// 本地测试出错时把 debug.log 发回来即可定位，前后端时间线在同一文件可串联。
// Best-effort：日志链路任何故障都被吞掉，绝不影响业务渲染。
window.addEventListener("error", (e) => {
  void invoke("append_debug_log", {
    level: "error",
    tag: "webview",
    message: `onerror: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`,
  }).catch(() => {});
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason);
  void invoke("append_debug_log", {
    level: "error",
    tag: "webview",
    message: `unhandledrejection: ${reason}`,
  }).catch(() => {});
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
