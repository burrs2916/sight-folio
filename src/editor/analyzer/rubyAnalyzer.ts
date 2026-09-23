// sight-folio: Ruby 分析器插件
// 后端支持：Tier 1（tree-sitter AST 度量：class/module/method 圈复杂度 + 嵌套）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const rubyAnalyzerManifest: AnalyzerManifest = {
  id: "ruby-analyzer",
  name: "analyzer.rb.name",
  version: "1.0.0",
  language: "Ruby",
  languageAliases: ["ruby"],
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
      name: "analyzer.rb.entity.module.name",
      icon: "description",
      color: "#cc342d",
      properties: [
        { key: "name", label: "analyzer.rb.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.rb.entity.string.prop.path", type: "string" },
        { key: "lineCount", label: "analyzer.rb.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
    {
      type: "class",
      name: "analyzer.rb.entity.class.name",
      icon: "view_module",
      color: "#cc342d",
      properties: [
        { key: "name", label: "analyzer.rb.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.rb.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.rb.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.rb.entity.interface.name",
      icon: "account_tree",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.rb.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.rb.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.rb.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.rb.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.rb.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.rb.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.rb.entity.string.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.rb.view.architecture.name",
      description: "analyzer.rb.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "business", name: "analyzer.rb.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.rb.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.rb.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.rb.view.dependency.name",
      description: "analyzer.rb.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.rb.view.default.name", color: "#cc342d" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.rb.view.layering.name",
      description: "analyzer.rb.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "business", name: "analyzer.rb.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.rb.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.rb.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "business", name: "analyzer.rb.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.rb.layerType.business.desc" },
    { type: "domain", name: "analyzer.rb.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.rb.layerType.domain.desc" },
    { type: "infra", name: "analyzer.rb.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.rb.layerType.infra.desc" },
    { type: "default", name: "analyzer.rb.layerType.default.name", icon: "layers", color: "#cc342d", description: "analyzer.rb.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.rb.handler.navigate-to-source.name", description: "analyzer.rb.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.rb.handler.show-detail.name", description: "analyzer.rb.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.rb.handler.open-file.name", description: "analyzer.rb.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.rb.handler.highlight-cycle.name", description: "analyzer.rb.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "ruby-complexity",
      name: "analyzer.rb.rule.ruby-complexity.name",
      description: "analyzer.rb.rule.ruby-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "ruby-long-method",
      name: "analyzer.rb.rule.ruby-long-method.name",
      description: "analyzer.rb.rule.ruby-long-method.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "ruby-deep-nesting",
      name: "analyzer.rb.rule.ruby-deep-nesting.name",
      description: "analyzer.rb.rule.ruby-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "ruby-coupling",
      name: "analyzer.rb.rule.ruby-coupling.name",
      description: "analyzer.rb.rule.ruby-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "ruby-layering",
      name: "analyzer.rb.rule.ruby-layering.name",
      description: "analyzer.rb.rule.ruby-layering.desc",
      severity: "critical",
      category: "layering",
    },
  ],
};
