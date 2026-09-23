// sight-folio: Swift 分析器插件
// 后端支持：Tier 1（tree-sitter AST 度量：class/struct/func/init 圈复杂度 + 嵌套）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const swiftAnalyzerManifest: AnalyzerManifest = {
  id: "swift-analyzer",
  name: "analyzer.swift.name",
  version: "1.0.0",
  language: "Swift",
  languageAliases: ["swift"],
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
      name: "analyzer.swift.entity.module.name",
      icon: "description",
      color: "#f05138",
      properties: [
        { key: "name", label: "analyzer.swift.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.swift.entity.string.prop.path", type: "string" },
        { key: "lineCount", label: "analyzer.swift.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
    {
      type: "class",
      name: "analyzer.swift.entity.class.name",
      icon: "view_module",
      color: "#f05138",
      properties: [
        { key: "name", label: "analyzer.swift.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.swift.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.swift.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "struct",
      name: "analyzer.swift.entity.struct.name",
      icon: "data_object",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.swift.entity.struct.prop.name", type: "string" },
        { key: "path", label: "analyzer.swift.entity.string.prop.path", type: "string" },
        { key: "fields", label: "analyzer.swift.entity.string.prop.fields", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.swift.entity.interface.name",
      icon: "account_tree",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.swift.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.swift.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.swift.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.swift.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.swift.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.swift.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.swift.entity.string.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.swift.view.architecture.name",
      description: "analyzer.swift.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "business", name: "analyzer.swift.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.swift.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.swift.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.swift.view.dependency.name",
      description: "analyzer.swift.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.swift.view.default.name", color: "#f05138" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.swift.view.layering.name",
      description: "analyzer.swift.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "business", name: "analyzer.swift.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.swift.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.swift.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "business", name: "analyzer.swift.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.swift.layerType.business.desc" },
    { type: "domain", name: "analyzer.swift.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.swift.layerType.domain.desc" },
    { type: "infra", name: "analyzer.swift.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.swift.layerType.infra.desc" },
    { type: "default", name: "analyzer.swift.layerType.default.name", icon: "layers", color: "#f05138", description: "analyzer.swift.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.swift.handler.navigate-to-source.name", description: "analyzer.swift.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.swift.handler.show-detail.name", description: "analyzer.swift.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.swift.handler.open-file.name", description: "analyzer.swift.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.swift.handler.highlight-cycle.name", description: "analyzer.swift.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "swift-complexity",
      name: "analyzer.swift.rule.swift-complexity.name",
      description: "analyzer.swift.rule.swift-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "swift-force-unwrap",
      name: "analyzer.swift.rule.swift-force-unwrap.name",
      description: "analyzer.swift.rule.swift-force-unwrap.desc",
      severity: "critical",
      category: "metric",
    },
    {
      id: "swift-long-function",
      name: "analyzer.swift.rule.swift-long-function.name",
      description: "analyzer.swift.rule.swift-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "swift-deep-nesting",
      name: "analyzer.swift.rule.swift-deep-nesting.name",
      description: "analyzer.swift.rule.swift-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "swift-coupling",
      name: "analyzer.swift.rule.swift-coupling.name",
      description: "analyzer.swift.rule.swift-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "swift-layering",
      name: "analyzer.swift.rule.swift-layering.name",
      description: "analyzer.swift.rule.swift-layering.desc",
      severity: "critical",
      category: "layering",
    },
  ],
};
