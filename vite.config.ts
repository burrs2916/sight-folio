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
    // 生产构建自动剥离 console.* 和 debugger：
    // dev 模式保留（方便调试），生产包里全部移除 —— 减体积 + 不暴露敏感信息（如 authStore 里 accessToken 刷新的 debug log）。
    // 用 terser：esbuild 的 drop 选项在 Vite 6 的 minify 路径上透传不稳定，terser 的 compress.drop_console/debugger 100% 生效。
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        // 手动 chunk 拆分：把大型第三方库各自拆出独立 chunk，
        // 避免全部塞进 index 主 chunk（之前 5 MB），并行下载 + 更好的缓存命中。
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@mui")) return "mui";
            if (id.includes("@tiptap") || id.includes("tiptap")) return "tiptap";
            if (id.includes("echarts")) return "echarts";
            if (id.includes("three")) return "three";
            if (id.includes("@monaco-editor") || id.includes("monaco-editor")) return "monaco-core";
            if (id.includes("zustand")) return "zustand";
            if (id.includes("@tauri-apps")) return "tauri";
            if (id.includes("prosemirror") || id.includes("@tiptap")) return "prosemirror";
            return "vendor";
          }
        },
      },
    },
  },
}));
