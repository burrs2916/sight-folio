/* 一次性脚本：把提亮后的画布实体渲染成 HTML 快照到 /tmp，供视觉验证（R38）。
 * 用法：npx vite-node scripts/gen-canvas-preview.tsx
 */
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { FileRenderer } from "../src/editor/renderers/FileRenderer";
import { FolderRenderer } from "../src/editor/renderers/FolderRenderer";
import { ModuleRenderer } from "../src/editor/renderers/ModuleRenderer";
import { ClassRenderer } from "../src/editor/renderers/ClassRenderer";
import { DependencyEdgeRenderer } from "../src/editor/renderers/DependencyEdgeRenderer";

// 卡片容器：模拟画布上实体被布局系统摆放后的尺寸
function card(html: string, w: number, h: number): string {
  return `<div style="width:${w}px;height:${h}px;flex:none;margin:14px;display:inline-flex;">${html}</div>`;
}

const file = (c: Record<string, unknown>, w = 180, h = 66, lod: "full" | "compact" | "block" = "full") =>
  card(renderToStaticMarkup(createElement(FileRenderer, { config: c, lod })), w, h);

const folder = (c: Record<string, unknown>, w = 224, h = 88, lod: "full" | "compact" | "block" = "full") =>
  card(renderToStaticMarkup(createElement(FolderRenderer, { config: c, lod })), w, h);

const moduleCard = (c: Record<string, unknown>, w = 220, h = 80) =>
  card(renderToStaticMarkup(createElement(ModuleRenderer, { config: c })), w, h);

const cls = (c: Record<string, unknown>, w = 200, h = 62) =>
  card(renderToStaticMarkup(createElement(ClassRenderer, { config: c })), w, h);

const section = (title: string, body: string) => `
  <div style="margin:18px 6px 4px;font:600 13px/1.4 -apple-system,'PingFang SC',sans-serif;color:#1e293b;">${title}</div>
  <div style="display:flex;flex-wrap:wrap;align-items:flex-start;">${body}</div>`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>画布实体视觉预览（R38 提亮）</title>
<style>
  body { margin: 24px; background: #eef1f6; font-family: -apple-system, 'PingFang SC', sans-serif; }
  .canvas-bg {
    background:
      radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0) 0 0/22px 22px,
      #f8fafc;
    border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-top: 10px;
    display: block; min-height: 260px;
  }
  .hint { font-size: 12px; color: #64748b; line-height: 1.6; }
</style>
</head>
<body>
  <h2 style="margin:0;font:700 16px/1.4 -apple-system,'PingFang SC',sans-serif;color:#0f172a;">
    画布实体视觉预览（R38：提亮 + 路径标注 + 布局放宽）
  </h2>
  <p class="hint">
    目录卡片 224×88 · 文件卡片 180×66 · 色条 4px 全饱和 · 文件卡带语言色淡底渐变 + 语言实底徽标 +
    目录路径行 · 悬浮 title 首行是完整路径 · R39：连线加深（#475569 / 0.9 透明度 / 2px）、
    LOD 阈值下移（full 0.60 / compact 0.30）—— 全览也能看到路径行
  </p>
  <div class="canvas-bg">
    ${section("① 文件实体 · full 档（语言色淡底 + 路径行 + 实底语言徽标）", [
      file({ fileName: "FileRenderer.tsx", filePath: "src/editor/renderers/FileRenderer.tsx", language: "typescript", lineCount: 392, refCount: 5, callOut: 12, callIn: 9, techDebtCount: 2 }),
      file({ fileName: "dataflow.rs", filePath: "src-tauri/src/infrastructure/ast/dataflow.rs", language: "rust", lineCount: 612, complexity: 22, complexityLevel: "high", refCount: 3 }),
      file({ fileName: "main.py", filePath: "scripts/nlp/tokenizer.py", language: "python", lineCount: 148, cloneCount: 3, duplicationRatio: 0.31, churnScore: 18, churnLevel: "high" }),
      file({ fileName: "package.json", filePath: "package.json", language: "json", lineCount: 120 }),
      file({ fileName: "App.tsx", filePath: "src/App.tsx", language: "typescript", lineCount: 210, deadCount: 2, patternNames: ["工厂"], symbolCount: 14 }),
    ])}
  </div>
  <div class="canvas-bg">
    ${section("② 文件/目录实体 · compact 档（R39 新增路径行 —— 全览默认档位）", [
      file({ fileName: "FileRenderer.tsx", filePath: "src/editor/renderers/FileRenderer.tsx", language: "typescript", lineCount: 392, complexity: 22, complexityLevel: "high" }, 180, 66, "compact"),
      file({ fileName: "dataflow.rs", filePath: "src-tauri/src/infrastructure/ast/dataflow.rs", language: "rust", lineCount: 612 }, 180, 66, "compact"),
      file({ fileName: "index.ts", filePath: "src/store/__tests__/index.ts", language: "typescript", lineCount: 45 }, 180, 66, "compact"),
      folder({ name: "renderers", dirPath: "src/editor", fileCount: 32, totalLines: 14200, avgComplexity: 7.4, complexityLevel: "medium" }, 224, 88, "compact"),
      folder({ name: "ast", dirPath: "src-tauri/src/infrastructure", fileCount: 18, totalLines: 9800, avgComplexity: 11.2, complexityLevel: "high" }, 224, 88, "compact"),
    ])}
  </div>
  <div class="canvas-bg">
    ${section("③ 目录实体 · full 档（完整路径行 + 复杂度热力 + 语言构成条）", [
      folder({ name: "renderers", dirPath: "src/editor", fileCount: 32, totalLines: 14200, avgComplexity: 7.4, maxComplexity: 31, complexityLevel: "medium", techDebtCount: 12, findingCount: 5, cloneCount: 4, languageShare: [{ language: "typescript", files: 28, lines: 12000 }, { language: "css", files: 4, lines: 2200 }] }),
      folder({ name: "ast", dirPath: "src-tauri/src/infrastructure", fileCount: 18, totalLines: 9800, avgComplexity: 11.2, maxComplexity: 44, complexityLevel: "high", techDebtCount: 21, findingCount: 9, languageShare: [{ language: "rust", files: 18, lines: 9800 }] }),
      folder({ name: "components", dirPath: "src", fileCount: 26, totalLines: 8100, avgComplexity: 3.9, complexityLevel: "low", techDebtCount: 3, languageShare: [{ language: "typescript", files: 26, lines: 8100 }] }),
    ])}
  </div>
  <div class="canvas-bg">
    ${section("④ 模块 / 类实体（主题色渐变 + compact 路径行）", [
      moduleCard({ name: "editor", filePath: "src/editor", fileCount: 96, avgComplexity: 6.8, complexityLevel: "medium" }),
      moduleCard({ name: "store", filePath: "src/store", fileCount: 12, avgComplexity: 4.2, complexityLevel: "low" }),
      cls({ name: "CanvasEntityNode", filePath: "src/editor/SceneEditor.tsx", methods: 9, complexity: 24, refCount: 7 }),
      cls({ name: "FlowGate", filePath: "src/editor/utils/impactChain.ts", methods: 4, complexity: 6, refCount: 11 }),
    ])}
  </div>
  <div class="canvas-bg">
    ${section("⑤ 依赖连线（R39 加深加粗：import 边 #475569 / 2px / 0.9 透明度）", `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${renderToStaticMarkup(createElement(DependencyEdgeRenderer, { config: { depType: "import", fromX: 10, fromY: 30, toX: 220, toY: 12 }, width: 240, height: 40, lod: "full" }))}
        ${renderToStaticMarkup(createElement(DependencyEdgeRenderer, { config: { callEdge: true, crossFile: true, fromX: 10, fromY: 12, toX: 220, toY: 30 }, width: 240, height: 40, lod: "full" }))}
        ${renderToStaticMarkup(createElement(DependencyEdgeRenderer, { config: { isCircular: true, fromX: 10, fromY: 30, toX: 220, toY: 30 }, width: 240, height: 40, lod: "full" }))}
      </div>
      <div class="hint" style="margin-top:6px;">依次为：普通 import 依赖（灰 #475569）· 跨文件调用（紫 #7C3AED）· 循环依赖（红 #EF4444 虚线）</div>`)}
  </div>
</body>
</html>`;

writeFileSync("/tmp/canvas-preview-r39.html", html, "utf8");
console.log("written: /tmp/canvas-preview-r39.html");

