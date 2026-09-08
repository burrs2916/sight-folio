// project-sight: Svelte 分析器插件
// 后端支持：语言识别（detect_language 支持 .svelte），暂无符号/依赖/AST 分析
// （SvelteParser capabilities 全 false → 前端显示「基础分析」徽标）。
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。
// 能力展示以后端 ParserRegistry 查询结果为准（R45），本声明仅作非 Tauri 环境兜底。

import type { AnalyzerManifest } from "./types";

export const svelteAnalyzerManifest: AnalyzerManifest = {
  id: "svelte-analyzer",
  name: "analyzer.svelte.name",
  version: "1.0.0",
  language: "Svelte",
  languageAliases: ["svelte"],
  capabilities: {
    scanning: true,
    rules: true,
    // 后端 SvelteParser 无依赖解析（capabilities 全 false），如实声明
    dependencyAnalysis: false,
    rendering: true,
  },

  entityTypes: [
    {
      type: "module",
      name: "analyzer.svelte.entity.module.name",
      icon: "description",
      color: "#ff3e00",
      properties: [
        { key: "name", label: "analyzer.svelte.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.svelte.entity.string.prop.path", type: "string" },
        { key: "lineCount", label: "analyzer.svelte.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
  ],

  viewTemplates: [],
  layerTypes: [],
  eventHandlers: [],
  rules: [],
};
