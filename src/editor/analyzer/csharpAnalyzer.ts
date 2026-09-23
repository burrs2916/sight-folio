// sight-folio: C# 分析器插件
// 后端支持：Tier 1（tree-sitter AST 度量：class/interface/method 圈复杂度 + 嵌套）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const csharpAnalyzerManifest: AnalyzerManifest = {
  id: "csharp-analyzer",
  name: "analyzer.cs.name",
  version: "1.0.0",
  language: "C#",
  languageAliases: ["csharp"],
  capabilities: {
    scanning: true,
    rules: true,
    // 审计修复（2026-08-12，R44）：后端依赖解析（review.rs detect_dependencies）无此语言分支，如实降级声明
    dependencyAnalysis: false,
    rendering: true,
  },

  entityTypes: [
    {
      type: "module",
      name: "analyzer.cs.entity.module.name",
      icon: "description",
      color: "#68217a",
      properties: [
        { key: "name", label: "analyzer.cs.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.cs.entity.string.prop.path", type: "string" },
        { key: "lineCount", label: "analyzer.cs.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
    {
      type: "class",
      name: "analyzer.cs.entity.class.name",
      icon: "view_module",
      color: "#68217a",
      properties: [
        { key: "name", label: "analyzer.cs.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.cs.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.cs.entity.string.prop.methods", type: "number", default: 0 },
        { key: "isAbstract", label: "analyzer.cs.entity.number.prop.isAbstract", type: "boolean", default: false },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.cs.entity.interface.name",
      icon: "account_tree",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.cs.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.cs.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.cs.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "struct",
      name: "analyzer.cs.entity.struct.name",
      icon: "data_object",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.cs.entity.struct.prop.name", type: "string" },
        { key: "path", label: "analyzer.cs.entity.string.prop.path", type: "string" },
        { key: "fields", label: "analyzer.cs.entity.string.prop.fields", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.cs.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.cs.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.cs.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.cs.entity.string.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.cs.view.architecture.name",
      description: "analyzer.cs.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "business", name: "analyzer.cs.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.cs.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.cs.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.cs.view.dependency.name",
      description: "analyzer.cs.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.cs.view.default.name", color: "#68217a" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "inheritance",
      name: "analyzer.cs.view.inheritance.name",
      description: "analyzer.cs.view.inheritance.desc",
      icon: "family_tree",
      defaultLayers: [
        { type: "default", name: "analyzer.cs.view.default.name", color: "#ec4899" },
      ],
      layout: { scale: 0.85, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.cs.view.layering.name",
      description: "analyzer.cs.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "business", name: "analyzer.cs.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.cs.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.cs.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "business", name: "analyzer.cs.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.cs.layerType.business.desc" },
    { type: "domain", name: "analyzer.cs.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.cs.layerType.domain.desc" },
    { type: "infra", name: "analyzer.cs.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.cs.layerType.infra.desc" },
    { type: "default", name: "analyzer.cs.layerType.default.name", icon: "layers", color: "#68217a", description: "analyzer.cs.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.cs.handler.navigate-to-source.name", description: "analyzer.cs.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.cs.handler.show-detail.name", description: "analyzer.cs.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.cs.handler.open-file.name", description: "analyzer.cs.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.cs.handler.highlight-cycle.name", description: "analyzer.cs.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "csharp-complexity",
      name: "analyzer.cs.rule.csharp-complexity.name",
      description: "analyzer.cs.rule.csharp-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "csharp-long-method",
      name: "analyzer.cs.rule.csharp-long-method.name",
      description: "analyzer.cs.rule.csharp-long-method.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "csharp-deep-nesting",
      name: "analyzer.cs.rule.csharp-deep-nesting.name",
      description: "analyzer.cs.rule.csharp-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "csharp-coupling",
      name: "analyzer.cs.rule.csharp-coupling.name",
      description: "analyzer.cs.rule.csharp-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "csharp-layering",
      name: "analyzer.cs.rule.csharp-layering.name",
      description: "analyzer.cs.rule.csharp-layering.desc",
      severity: "critical",
      category: "layering",
    },
  ],
};
