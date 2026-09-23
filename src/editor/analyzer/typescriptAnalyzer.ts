// sight-folio: TypeScript 分析器插件（第一阶段，最高优先级，项目自身使用）
// 对应需求文档 §4.6 渐进式语言支持路线图：
//   核心能力 = 模块扫描、import 依赖分析、架构分层、圈复杂度

import type { AnalyzerManifest } from "./types";

export const typescriptAnalyzerManifest: AnalyzerManifest = {
  id: "typescript-analyzer",
  name: "analyzer.ts.name",
  version: "1.0.0",
  language: "TypeScript",
  capabilities: {
    scanning: true, // 模块/文件扫描
    rules: true, // 审查规则
    dependencyAnalysis: true, // import 依赖分析
    rendering: true, // 自定义渲染
  },

  // 实体类型注册（ComponentTypeRegistry）
  entityTypes: [
    {
      type: "module",
      name: "analyzer.ts.entity.module.name",
      icon: "inventory_2",
      color: "#6366f1",
      properties: [
        { key: "name", label: "analyzer.ts.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.ts.entity.string.prop.path", type: "string" },
        { key: "fileCount", label: "analyzer.ts.entity.string.prop.fileCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "file",
      name: "analyzer.ts.entity.file.name",
      icon: "description",
      color: "#0ea5e9",
      properties: [
        { key: "fileName", label: "analyzer.ts.entity.file.prop.fileName", type: "string" },
        { key: "filePath", label: "analyzer.ts.entity.string.prop.filePath", type: "string" },
        { key: "language", label: "analyzer.ts.entity.string.prop.language", type: "string" },
        { key: "lineCount", label: "analyzer.ts.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
    {
      type: "class",
      name: "analyzer.ts.entity.class.name",
      icon: "view_module",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.ts.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.ts.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.ts.entity.string.prop.methods", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.ts.entity.number.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.ts.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.ts.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.ts.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.ts.entity.string.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.ts.entity.interface.name",
      icon: "account_tree",
      color: "#ec4899",
      properties: [
        { key: "name", label: "analyzer.ts.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.ts.entity.string.prop.path", type: "string" },
        { key: "members", label: "analyzer.ts.entity.string.prop.members", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
  ],

  // 视角模板注册（ViewTemplateRegistry）
  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.ts.view.architecture.name",
      description: "analyzer.ts.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "presentation", name: "analyzer.ts.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.ts.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.ts.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.ts.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.ts.view.dependency.name",
      description: "analyzer.ts.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.ts.view.default.name", color: "#6366f1" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.ts.view.layering.name",
      description: "analyzer.ts.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "presentation", name: "analyzer.ts.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.ts.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.ts.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.ts.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "complexity",
      name: "analyzer.ts.view.complexity.name",
      description: "analyzer.ts.view.complexity.desc",
      icon: "whatshot",
      defaultLayers: [
        { type: "default", name: "analyzer.ts.view.default.name", color: "#ef4444" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "coupling",
      name: "analyzer.ts.view.coupling.name",
      description: "analyzer.ts.view.coupling.desc",
      icon: "scatter_plot",
      defaultLayers: [{ type: "default", name: "analyzer.ts.view.default.name", color: "#a855f7" }],
      layout: { scale: 0.85, panX: 0, panY: 0, grid: true },
    },
  ],

  // 图层类型注册（LayerTypeRegistry）
  layerTypes: [
    { type: "presentation", name: "analyzer.ts.layerType.presentation.name", icon: "web", color: "#0ea5e9", description: "analyzer.ts.layerType.presentation.desc" },
    { type: "business", name: "analyzer.ts.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.ts.layerType.business.desc" },
    { type: "domain", name: "analyzer.ts.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.ts.layerType.domain.desc" },
    { type: "infra", name: "analyzer.ts.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.ts.layerType.infra.desc" },
    { type: "default", name: "analyzer.ts.layerType.default.name", icon: "layers", color: "#6366f1", description: "analyzer.ts.layerType.default.desc" },
  ],

  // 事件处理器注册（EventHandlerRegistry）
  eventHandlers: [
    {
      event: "entity:click",
      handlerId: "navigate-to-source",
      name: "analyzer.ts.handler.navigate-to-source.name",
      description: "analyzer.ts.handler.navigate-to-source.desc",
    },
    {
      event: "entity:hover",
      handlerId: "show-detail",
      name: "analyzer.ts.handler.show-detail.name",
      description: "analyzer.ts.handler.show-detail.desc",
    },
    {
      event: "entity:dblclick",
      handlerId: "open-file",
      name: "analyzer.ts.handler.open-file.name",
      description: "analyzer.ts.handler.open-file.desc",
    },
    {
      event: "dependency:cycle",
      handlerId: "highlight-cycle",
      name: "analyzer.ts.handler.highlight-cycle.name",
      description: "analyzer.ts.handler.highlight-cycle.desc",
    },
  ],

  // 规则引擎注册（RuleRegistry）
  rules: [
    {
      id: "ts-complexity",
      name: "analyzer.ts.rule.ts-complexity.name",
      description: "analyzer.ts.rule.ts-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "ts-coupling",
      name: "analyzer.ts.rule.ts-coupling.name",
      description: "analyzer.ts.rule.ts-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "ts-layering",
      name: "analyzer.ts.rule.ts-layering.name",
      description: "analyzer.ts.rule.ts-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "ts-unused",
      name: "analyzer.ts.rule.ts-unused.name",
      description: "analyzer.ts.rule.ts-unused.desc",
      severity: "info",
      category: "metadata",
    },
    {
      id: "ts-magic-number",
      name: "analyzer.ts.rule.ts-magic-number.name",
      description: "analyzer.ts.rule.ts-magic-number.desc",
      severity: "info",
      category: "metadata",
    },
    // ── 以下三条由 tree-sitter AST 度量驱动（R31 新增）──
    {
      id: "ts-deep-nesting",
      name: "analyzer.ts.rule.ts-deep-nesting.name",
      description: "analyzer.ts.rule.ts-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "ts-long-function",
      name: "analyzer.ts.rule.ts-long-function.name",
      description: "analyzer.ts.rule.ts-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "ts-too-many-params",
      name: "analyzer.ts.rule.ts-too-many-params.name",
      description: "analyzer.ts.rule.ts-too-many-params.desc",
      severity: "info",
      category: "complexity",
    },
  ],
};
