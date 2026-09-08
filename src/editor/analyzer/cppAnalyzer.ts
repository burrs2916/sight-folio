// project-sight: C/C++ 分析器插件
// 后端支持：Tier 2（正则符号提取：class/struct/interface + #include 解析）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const cppAnalyzerManifest: AnalyzerManifest = {
  id: "cpp-analyzer",
  name: "analyzer.cpp.name",
  version: "1.0.0",
  language: "C/C++",
  languageAliases: ["cpp", "c"],
  capabilities: {
    scanning: true,
    rules: true,
    dependencyAnalysis: true,
    rendering: true,
  },

  entityTypes: [
    {
      type: "module",
      name: "analyzer.cpp.entity.module.name",
      icon: "description",
      color: "#659ad2",
      properties: [
        { key: "name", label: "analyzer.cpp.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.cpp.entity.string.prop.path", type: "string" },
        { key: "lineCount", label: "analyzer.cpp.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
    {
      type: "class",
      name: "analyzer.cpp.entity.class.name",
      icon: "view_module",
      color: "#659ad2",
      properties: [
        { key: "name", label: "analyzer.cpp.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.cpp.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.cpp.entity.string.prop.methods", type: "number", default: 0 },
        { key: "fields", label: "analyzer.cpp.entity.number.prop.fields", type: "number", default: 0 },
        { key: "isAbstract", label: "analyzer.cpp.entity.number.prop.isAbstract", type: "boolean", default: false },
      ],
      defaultLayer: "domain",
    },
    {
      type: "struct",
      name: "analyzer.cpp.entity.struct.name",
      icon: "data_object",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.cpp.entity.struct.prop.name", type: "string" },
        { key: "path", label: "analyzer.cpp.entity.string.prop.path", type: "string" },
        { key: "fields", label: "analyzer.cpp.entity.string.prop.fields", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.cpp.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.cpp.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.cpp.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.cpp.entity.string.prop.complexity", type: "number", default: 0 },
        { key: "hasUnsafe", label: "analyzer.cpp.entity.number.prop.hasUnsafe", type: "boolean", default: false },
      ],
      defaultLayer: "infra",
    },
    {
      type: "interface",
      name: "analyzer.cpp.entity.interface.name",
      icon: "account_tree",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.cpp.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.cpp.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.cpp.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.cpp.view.architecture.name",
      description: "analyzer.cpp.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "business", name: "analyzer.cpp.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.cpp.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.cpp.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.cpp.view.dependency.name",
      description: "analyzer.cpp.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.cpp.view.default.name", color: "#659ad2" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.cpp.view.layering.name",
      description: "analyzer.cpp.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "business", name: "analyzer.cpp.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.cpp.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.cpp.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "inheritance",
      name: "analyzer.cpp.view.inheritance.name",
      description: "analyzer.cpp.view.inheritance.desc",
      icon: "family_tree",
      defaultLayers: [
        { type: "default", name: "analyzer.cpp.view.default.name", color: "#ec4899" },
      ],
      layout: { scale: 0.85, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "business", name: "analyzer.cpp.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.cpp.layerType.business.desc" },
    { type: "domain", name: "analyzer.cpp.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.cpp.layerType.domain.desc" },
    { type: "infra", name: "analyzer.cpp.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.cpp.layerType.infra.desc" },
    { type: "default", name: "analyzer.cpp.layerType.default.name", icon: "layers", color: "#659ad2", description: "analyzer.cpp.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.cpp.handler.navigate-to-source.name", description: "analyzer.cpp.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.cpp.handler.show-detail.name", description: "analyzer.cpp.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.cpp.handler.open-file.name", description: "analyzer.cpp.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.cpp.handler.highlight-cycle.name", description: "analyzer.cpp.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "cpp-complexity",
      name: "analyzer.cpp.rule.cpp-complexity.name",
      description: "analyzer.cpp.rule.cpp-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "cpp-unsafe",
      name: "analyzer.cpp.rule.cpp-unsafe.name",
      description: "analyzer.cpp.rule.cpp-unsafe.desc",
      severity: "critical",
      category: "metric",
    },
    {
      id: "cpp-coupling",
      name: "analyzer.cpp.rule.cpp-coupling.name",
      description: "analyzer.cpp.rule.cpp-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "cpp-layering",
      name: "analyzer.cpp.rule.cpp-layering.name",
      description: "analyzer.cpp.rule.cpp-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "cpp-long-function",
      name: "analyzer.cpp.rule.cpp-long-function.name",
      description: "analyzer.cpp.rule.cpp-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "cpp-deep-nesting",
      name: "analyzer.cpp.rule.cpp-deep-nesting.name",
      description: "analyzer.cpp.rule.cpp-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "cpp-magic-number",
      name: "analyzer.cpp.rule.cpp-magic-number.name",
      description: "analyzer.cpp.rule.cpp-magic-number.desc",
      severity: "info",
      category: "metadata",
    },
  ],
};
