import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  base: "/",
  plugins: [
    react(),
  ],
  clearScreen: false,
  server: {
    port: 23010,
    strictPort: true,
    host: host || false,
    // 关键：dev server 的所有响应都禁止缓存。
    // macOS 的 WKWebView 会把 Vite 转换后的模块持久缓存到磁盘
    // （~/Library/WebKit/sight-folio/WebsiteData），应用重启也不重新拉取，
    // 导致「源码改了 UI 永远不更新」。no-store 从源头掐死这条缓存链。
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  optimizeDeps: {
    // 2026-09-14：摘除 force: serve。
    // 强制重优化让每次 dev 启动都换一个 browserHash（依赖模块 URL 的 ?v= 每次都不同），
    // 会话中途懒加载再触发补优化时，新旧 hash 的模块副本会在同一页面共存 ——
    // MUI 的 Tabs 与 Tab 落到两个模块实例上，React context 对不上：
    // 右栏「要素/详情/AI」tabs 点击无效、aria-selected 全空、无任何报错（实锤复现）。
    // 不再强制：依赖只优化一次、hash 稳定，中途补优化走 vite 自带的 full-reload 兜底。
  },
  build: {
    modulePreload: false,
  },
}));
