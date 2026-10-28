import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerBuiltinComponents } from "./editor/registry";
// 注册 AI 上下文供给者（扫描 → 上下文包的构建器），随应用启动加载。
import "./ai/providers/scanContextProvider";
// 注册需求基线供给者（客户陈述的需求规格 → 上下文包的构建器），与扫描供给者并列。
import "./ai/providers/requirementsSpecProvider";
// 注册写作域供给者（书籍/章节/人设卡/世界观 → 上下文包的构建器），与扫描供给者并列。
import "./ai/providers/writingContextProvider";

registerBuiltinComponents();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
