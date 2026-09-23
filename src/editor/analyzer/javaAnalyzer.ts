// sight-folio: Java 分析器插件
// 后端支持：Tier 2（正则符号提取：class/interface/enum + import 解析）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const javaAnalyzerManifest: AnalyzerManifest = {
  id: "java-analyzer",
  name: "analyzer.java.name",
  version: "1.0.0",
  language: "Java",
  capabilities: {
    scanning: true,
    rules: true,
    dependencyAnalysis: true,
    rendering: true,
  },

  entityTypes: [
    {
      type: "package",
      name: "analyzer.java.entity.package.name",
      icon: "inventory",
      color: "#e76f00",
      properties: [
        { key: "name", label: "analyzer.java.entity.package.prop.name", type: "string" },
        { key: "path", label: "analyzer.java.entity.string.prop.path", type: "string" },
        { key: "classCount", label: "analyzer.java.entity.string.prop.classCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "class",
      name: "analyzer.java.entity.class.name",
      icon: "view_module",
      color: "#e76f00",
      properties: [
        { key: "name", label: "analyzer.java.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.java.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.java.entity.string.prop.methods", type: "number", default: 0 },
        { key: "fields", label: "analyzer.java.entity.number.prop.fields", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.java.entity.number.prop.complexity", type: "number", default: 0 },
        { key: "isAbstract", label: "analyzer.java.entity.number.prop.isAbstract", type: "boolean", default: false },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.java.entity.interface.name",
      icon: "account_tree",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.java.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.java.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.java.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.java.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.java.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.java.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.java.entity.string.prop.complexity", type: "number", default: 0 },
        { key: "params", label: "analyzer.java.entity.number.prop.params", type: "number", default: 0 },
        { key: "visibility", label: "analyzer.java.entity.number.prop.visibility", type: "select", options: ["public", "protected", "private", "package"], default: "public" },
      ],
      defaultLayer: "infra",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.java.view.architecture.name",
      description: "analyzer.java.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "presentation", name: "analyzer.java.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.java.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.java.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.java.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.java.view.dependency.name",
      description: "analyzer.java.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.java.view.default.name", color: "#e76f00" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.java.view.layering.name",
      description: "analyzer.java.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "presentation", name: "analyzer.java.view.presentation.name", color: "#0ea5e9" },
        { type: "business", name: "analyzer.java.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.java.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.java.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "inheritance",
      name: "analyzer.java.view.inheritance.name",
      description: "analyzer.java.view.inheritance.desc",
      icon: "family_tree",
      defaultLayers: [
        { type: "default", name: "analyzer.java.view.default.name", color: "#ec4899" },
      ],
      layout: { scale: 0.85, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "presentation", name: "analyzer.java.layerType.presentation.name", icon: "web", color: "#0ea5e9", description: "analyzer.java.layerType.presentation.desc" },
    { type: "business", name: "analyzer.java.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.java.layerType.business.desc" },
    { type: "domain", name: "analyzer.java.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.java.layerType.domain.desc" },
    { type: "infra", name: "analyzer.java.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.java.layerType.infra.desc" },
    { type: "default", name: "analyzer.java.layerType.default.name", icon: "layers", color: "#e76f00", description: "analyzer.java.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.java.handler.navigate-to-source.name", description: "analyzer.java.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.java.handler.show-detail.name", description: "analyzer.java.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.java.handler.open-file.name", description: "analyzer.java.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.java.handler.highlight-cycle.name", description: "analyzer.java.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "java-complexity",
      name: "analyzer.java.rule.java-complexity.name",
      description: "analyzer.java.rule.java-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "java-coupling",
      name: "analyzer.java.rule.java-coupling.name",
      description: "analyzer.java.rule.java-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "java-layering",
      name: "analyzer.java.rule.java-layering.name",
      description: "analyzer.java.rule.java-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "java-unused-import",
      name: "analyzer.java.rule.java-unused-import.name",
      description: "analyzer.java.rule.java-unused-import.desc",
      severity: "info",
      category: "metadata",
    },
    {
      id: "java-long-method",
      name: "analyzer.java.rule.java-long-method.name",
      description: "analyzer.java.rule.java-long-method.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "java-too-many-params",
      name: "analyzer.java.rule.java-too-many-params.name",
      description: "analyzer.java.rule.java-too-many-params.desc",
      severity: "info",
      category: "complexity",
    },
    {
      id: "java-deep-nesting",
      name: "analyzer.java.rule.java-deep-nesting.name",
      description: "analyzer.java.rule.java-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
  ],
};
