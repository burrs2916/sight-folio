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
// 全局基础样式（reset / #root 尺寸 / moveable 覆盖）。
// ⚠️ 必须是外部 CSS 文件，不能写成 index.html 内联 <style>（会导致 CSP 失效，
// 生产版全应用失真）—— 详见 base.css 文件头与 index.html 注释。
import "./base.css";

registerBuiltinComponents();

// ─── 前端诊断日志桥接（发布兼容性准备）───
// 打包版没有控制台，WebView 里未捕获的 JS 错误在 release 下完全无痕。
// 这里把全局错误同步到 Rust 端的 debug.log（exe 同级 / %LOCALAPPDATA%），
// 本地测试出错时把 debug.log 发回来即可定位，前后端时间线在同一文件可串联。
// Best-effort：日志链路任何故障都被吞掉，绝不影响业务渲染。

// 启动时间线：证明 bundle 真的在执行。debug.log 里只有 boot 横幅而无本行 =
// 前端 bundle 根本没被加载（协议/路径问题），与「执行了但崩了」立即区分开。
void invoke("append_debug_log", {
  level: "info",
  tag: "boot",
  message: `main.tsx executing, UA=${navigator.userAgent}`,
});

// 资源加载失败（CSS/JS/图片 404、协议拒绝）必须用捕获阶段监听：
// <link>/<script> 的加载错误不冒泡，普通 window error 监听抓不到。
window.addEventListener(
  "error",
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t && "tagName" in t && t !== e.currentTarget) {
      const el = t as HTMLLinkElement & HTMLScriptElement & HTMLImageElement;
      void invoke("append_debug_log", {
        level: "error",
        tag: "webview",
        message: `resource-failed: <${el.tagName}> ${el.href || el.src || "?"}`,
      }).catch(() => {});
      return;
    }
    const ev = e as ErrorEvent;
    void invoke("append_debug_log", {
      level: "error",
      tag: "webview",
      message: `onerror: ${ev.message} at ${ev.filename}:${ev.lineno}:${ev.colno}`,
    }).catch(() => {});
  },
  true
);
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason);
  void invoke("append_debug_log", {
    level: "error",
    tag: "webview",
    message: `unhandledrejection: ${reason}`,
  }).catch(() => {});
});

// CSP 违规捕获：CSP 拦截资源时既不触发 onerror 也不报网络错误，只有这个
// 事件能抓到（上一版「整个应用失真但日志全空」的教训 —— CSP 拦截是静默的）。
document.addEventListener("securitypolicyviolation", (e) => {
  void invoke("append_debug_log", {
    level: "error",
    tag: "csp",
    message: `${e.effectiveDirective} blocked ${e.blockedURI} (${e.disposition})`,
  }).catch(() => {});
});

// DOMContentLoaded / load 时刻汇报样式表数量：生产版若再次出现「有 DOM 无样式」，
// 这两行能立即判断是「样式表没加载」还是「运行时注入被 CSP 拦」。
const reportSheets = (phase: string) => {
  void invoke("append_debug_log", {
    level: "info",
    tag: "boot",
    message: `${phase}, stylesheets=${document.styleSheets.length}`,
  }).catch(() => {});
};
document.addEventListener("DOMContentLoaded", () => reportSheets("DOMContentLoaded"));
window.addEventListener("load", () => reportSheets("load"));

// React 挂载后再探一次（关键）：MUI/emotion 的样式是运行时注入的动态样式表，
// DOMContentLoaded/load 时刻只有 3 个外部 CSS；挂载后应涨到 20+。
// 若 +3s/+8s 仍停在 3 且无 [csp] 违规 → emotion 注入本身失败（非 CSP），
// 这行日志就是直接证据。同时探 body 计算样式，直接反映样式是否生效。
const probeSheets = (label: string) => {
  void invoke("append_debug_log", {
    level: "info",
    tag: "boot",
    message: `${label}: stylesheets=${document.styleSheets.length}, bodyBg=${getComputedStyle(document.body).backgroundColor}`,
  }).catch(() => {});
};
window.setTimeout(() => probeSheets("boot+3s"), 3000);
window.setTimeout(() => probeSheets("boot+8s"), 8000);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
