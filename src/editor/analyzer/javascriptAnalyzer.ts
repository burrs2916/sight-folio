// project-sight: JavaScript 分析器插件
// 后端支持：Tier 1（与 TypeScript 共享 tree-sitter Tsx dialect，AST 级解析）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const javascriptAnalyzerManifest: AnalyzerManifest = {
  id: "javascript-analyzer",
  name: "analyzer.js.name",
  version: "1.0.0",
  language: "JavaScript",
  capabilities: {
    scanning: true,
    rules: true,
    dependencyAnalysis: true,
    rendering: true,
  },

  entityTypes: [
    {
      type: "module",
      name: "analyzer.js.entity.module.name",
      icon: "inventory_2",
      color: "#f7df1e",
      properties: [
        { key: "name", label: "analyzer.js.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.js.entity.string.prop.path", type: "string" },
        { key: "fileCount", label: "analyzer.js.entity.string.prop.fileCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "file",
      name: "analyzer.js.entity.file.name",
      icon: "description",
      color: "#f7df1e",
      properties: [
        { key: "fileName", label: "analyzer.js.entity.file.prop.fileName", type: "string" },
        { key: "filePath", label: "analyzer.js.entity.string.prop.filePath", type: "string" },
        { key: "lineCount", label: "analyzer.js.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
    {
      type: "class",
      name: "analyzer.js.entity.class.name",
      icon: "view_module",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.js.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.js.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.js.entity.string.prop.methods", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.js.entity.number.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.js.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.js.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.js.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.js.entity.string.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.js.view.architecture.name",
      description: "analyzer.js.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "presentation", name: "analyzer.js.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.js.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.js.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.js.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.js.view.dependency.name",
      description: "analyzer.js.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.js.view.default.name", color: "#f7df1e" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.js.view.layering.name",
      description: "analyzer.js.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "presentation", name: "analyzer.js.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.js.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.js.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.js.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "complexity",
      name: "analyzer.js.view.complexity.name",
      description: "analyzer.js.view.complexity.desc",
      icon: "whatshot",
      defaultLayers: [
        { type: "default", name: "analyzer.js.view.default.name", color: "#ef4444" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "presentation", name: "analyzer.js.layerType.presentation.name", icon: "web", color: "#0ea5e9", description: "analyzer.js.layerType.presentation.desc" },
    { type: "business", name: "analyzer.js.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.js.layerType.business.desc" },
    { type: "domain", name: "analyzer.js.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.js.layerType.domain.desc" },
    { type: "infra", name: "analyzer.js.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.js.layerType.infra.desc" },
    { type: "default", name: "analyzer.js.layerType.default.name", icon: "layers", color: "#f7df1e", description: "analyzer.js.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.js.handler.navigate-to-source.name", description: "analyzer.js.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.js.handler.show-detail.name", description: "analyzer.js.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.js.handler.open-file.name", description: "analyzer.js.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.js.handler.highlight-cycle.name", description: "analyzer.js.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "js-complexity",
      name: "analyzer.js.rule.js-complexity.name",
      description: "analyzer.js.rule.js-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "js-coupling",
      name: "analyzer.js.rule.js-coupling.name",
      description: "analyzer.js.rule.js-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "js-layering",
      name: "analyzer.js.rule.js-layering.name",
      description: "analyzer.js.rule.js-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "js-unused",
      name: "analyzer.js.rule.js-unused.name",
      description: "analyzer.js.rule.js-unused.desc",
      severity: "info",
      category: "metadata",
    },
    {
      id: "js-deep-nesting",
      name: "analyzer.js.rule.js-deep-nesting.name",
      description: "analyzer.js.rule.js-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "js-long-function",
      name: "analyzer.js.rule.js-long-function.name",
      description: "analyzer.js.rule.js-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "js-too-many-params",
      name: "analyzer.js.rule.js-too-many-params.name",
      description: "analyzer.js.rule.js-too-many-params.desc",
      severity: "info",
      category: "complexity",
    },
  ],
};
