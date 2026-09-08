// project-sight: Go 分析器插件
// 后端支持：Tier 2（正则符号提取：function/struct/interface + import 解析）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const goAnalyzerManifest: AnalyzerManifest = {
  id: "go-analyzer",
  name: "analyzer.go.name",
  version: "1.0.0",
  language: "Go",
  capabilities: {
    scanning: true,
    rules: true,
    dependencyAnalysis: true,
    rendering: true,
  },

  entityTypes: [
    {
      type: "package",
      name: "analyzer.go.entity.package.name",
      icon: "inventory",
      color: "#00add8",
      properties: [
        { key: "name", label: "analyzer.go.entity.package.prop.name", type: "string" },
        { key: "path", label: "analyzer.go.entity.string.prop.path", type: "string" },
        { key: "fileCount", label: "analyzer.go.entity.string.prop.fileCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "module",
      name: "analyzer.go.entity.module.name",
      icon: "description",
      color: "#00add8",
      properties: [
        { key: "name", label: "analyzer.go.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.go.entity.string.prop.path", type: "string" },
        { key: "lineCount", label: "analyzer.go.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "struct",
      name: "analyzer.go.entity.struct.name",
      icon: "data_object",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.go.entity.struct.prop.name", type: "string" },
        { key: "path", label: "analyzer.go.entity.string.prop.path", type: "string" },
        { key: "fields", label: "analyzer.go.entity.string.prop.fields", type: "number", default: 0 },
        { key: "methods", label: "analyzer.go.entity.number.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.go.entity.interface.name",
      icon: "account_tree",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.go.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.go.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.go.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.go.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.go.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.go.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.go.entity.string.prop.complexity", type: "number", default: 0 },
        { key: "hasError", label: "analyzer.go.entity.number.prop.hasError", type: "boolean", default: false },
      ],
      defaultLayer: "infra",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.go.view.architecture.name",
      description: "analyzer.go.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "business", name: "analyzer.go.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.go.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.go.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.go.view.dependency.name",
      description: "analyzer.go.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.go.view.default.name", color: "#00add8" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.go.view.layering.name",
      description: "analyzer.go.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "business", name: "analyzer.go.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.go.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.go.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "interface-impl",
      name: "analyzer.go.view.interface-impl.name",
      description: "analyzer.go.view.interface-impl.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.go.view.default.name", color: "#8b5cf6" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "business", name: "analyzer.go.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.go.layerType.business.desc" },
    { type: "domain", name: "analyzer.go.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.go.layerType.domain.desc" },
    { type: "infra", name: "analyzer.go.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.go.layerType.infra.desc" },
    { type: "default", name: "analyzer.go.layerType.default.name", icon: "layers", color: "#00add8", description: "analyzer.go.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.go.handler.navigate-to-source.name", description: "analyzer.go.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.go.handler.show-detail.name", description: "analyzer.go.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.go.handler.open-file.name", description: "analyzer.go.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.go.handler.highlight-cycle.name", description: "analyzer.go.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "go-complexity",
      name: "analyzer.go.rule.go-complexity.name",
      description: "analyzer.go.rule.go-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "go-error-handling",
      name: "analyzer.go.rule.go-error-handling.name",
      description: "analyzer.go.rule.go-error-handling.desc",
      severity: "critical",
      category: "metric",
    },
    {
      id: "go-coupling",
      name: "analyzer.go.rule.go-coupling.name",
      description: "analyzer.go.rule.go-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "go-layering",
      name: "analyzer.go.rule.go-layering.name",
      description: "analyzer.go.rule.go-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "go-unused-import",
      name: "analyzer.go.rule.go-unused-import.name",
      description: "analyzer.go.rule.go-unused-import.desc",
      severity: "info",
      category: "metadata",
    },
    {
      id: "go-long-function",
      name: "analyzer.go.rule.go-long-function.name",
      description: "analyzer.go.rule.go-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "go-deep-nesting",
      name: "analyzer.go.rule.go-deep-nesting.name",
      description: "analyzer.go.rule.go-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
  ],
};
