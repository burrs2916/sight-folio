// project-sight: Kotlin 分析器插件
// 后端支持：Tier 2（正则符号提取：class/interface/enum/object）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const kotlinAnalyzerManifest: AnalyzerManifest = {
  id: "kotlin-analyzer",
  name: "analyzer.kt.name",
  version: "1.0.0",
  language: "Kotlin",
  capabilities: {
    scanning: true,
    rules: true,
    dependencyAnalysis: true,
    rendering: true,
  },

  entityTypes: [
    {
      type: "package",
      name: "analyzer.kt.entity.package.name",
      icon: "inventory",
      color: "#7f52ff",
      properties: [
        { key: "name", label: "analyzer.kt.entity.package.prop.name", type: "string" },
        { key: "path", label: "analyzer.kt.entity.string.prop.path", type: "string" },
        { key: "classCount", label: "analyzer.kt.entity.string.prop.classCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "class",
      name: "analyzer.kt.entity.class.name",
      icon: "view_module",
      color: "#7f52ff",
      properties: [
        { key: "name", label: "analyzer.kt.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.kt.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.kt.entity.string.prop.methods", type: "number", default: 0 },
        { key: "properties", label: "analyzer.kt.entity.number.prop.properties", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.kt.entity.number.prop.complexity", type: "number", default: 0 },
        { key: "isData", label: "data class", type: "boolean", default: false },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.kt.entity.interface.name",
      icon: "account_tree",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.kt.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.kt.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.kt.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.kt.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.kt.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.kt.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.kt.entity.string.prop.complexity", type: "number", default: 0 },
        { key: "isSuspend", label: "suspend", type: "boolean", default: false },
        { key: "isExtension", label: "analyzer.kt.entity.boolean.prop.isExtension", type: "boolean", default: false },
      ],
      defaultLayer: "infra",
    },
    {
      type: "struct",
      name: "Object/Enum",
      icon: "diamond",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.kt.entity.struct.prop.name", type: "string" },
        { key: "path", label: "analyzer.kt.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.kt.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.kt.view.architecture.name",
      description: "analyzer.kt.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "presentation", name: "analyzer.kt.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.kt.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.kt.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.kt.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.kt.view.dependency.name",
      description: "analyzer.kt.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.kt.view.default.name", color: "#7f52ff" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.kt.view.layering.name",
      description: "analyzer.kt.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "presentation", name: "analyzer.kt.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.kt.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.kt.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.kt.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "coroutine-flow",
      name: "analyzer.kt.view.coroutine-flow.name",
      description: "analyzer.kt.view.coroutine-flow.desc",
      icon: "call_split",
      defaultLayers: [
        { type: "default", name: "analyzer.kt.view.default.name", color: "#7f52ff" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "presentation", name: "analyzer.kt.layerType.presentation.name", icon: "web", color: "#0ea5e9", description: "analyzer.kt.layerType.presentation.desc" },
    { type: "business", name: "analyzer.kt.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.kt.layerType.business.desc" },
    { type: "domain", name: "analyzer.kt.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.kt.layerType.domain.desc" },
    { type: "infra", name: "analyzer.kt.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.kt.layerType.infra.desc" },
    { type: "default", name: "analyzer.kt.layerType.default.name", icon: "layers", color: "#7f52ff", description: "analyzer.kt.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.kt.handler.navigate-to-source.name", description: "analyzer.kt.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.kt.handler.show-detail.name", description: "analyzer.kt.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.kt.handler.open-file.name", description: "analyzer.kt.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.kt.handler.highlight-cycle.name", description: "analyzer.kt.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "kt-complexity",
      name: "analyzer.kt.rule.kt-complexity.name",
      description: "analyzer.kt.rule.kt-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "kt-coupling",
      name: "analyzer.kt.rule.kt-coupling.name",
      description: "analyzer.kt.rule.kt-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "kt-layering",
      name: "analyzer.kt.rule.kt-layering.name",
      description: "analyzer.kt.rule.kt-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "kt-unused-import",
      name: "analyzer.kt.rule.kt-unused-import.name",
      description: "analyzer.kt.rule.kt-unused-import.desc",
      severity: "info",
      category: "metadata",
    },
    {
      id: "kt-long-function",
      name: "analyzer.kt.rule.kt-long-function.name",
      description: "analyzer.kt.rule.kt-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "kt-too-many-params",
      name: "analyzer.kt.rule.kt-too-many-params.name",
      description: "analyzer.kt.rule.kt-too-many-params.desc",
      severity: "info",
      category: "complexity",
    },
    {
      id: "kt-deep-nesting",
      name: "analyzer.kt.rule.kt-deep-nesting.name",
      description: "analyzer.kt.rule.kt-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
  ],
};
