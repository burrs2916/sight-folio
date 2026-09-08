// project-sight: PHP 分析器插件
// 后端支持：Tier 2（正则符号提取：class/interface/struct）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const phpAnalyzerManifest: AnalyzerManifest = {
  id: "php-analyzer",
  name: "analyzer.php.name",
  version: "1.0.0",
  language: "PHP",
  capabilities: {
    scanning: true,
    rules: true,
    // 审计修复（2026-08-12，R44）：后端依赖解析（review.rs detect_dependencies）无此语言分支，如实降级声明
    dependencyAnalysis: false,
    rendering: true,
  },

  entityTypes: [
    {
      type: "package",
      name: "analyzer.php.entity.package.name",
      icon: "inventory",
      color: "#777bb4",
      properties: [
        { key: "name", label: "analyzer.php.entity.string.prop.name", type: "string" },
        { key: "path", label: "analyzer.php.entity.string.prop.path", type: "string" },
        { key: "classCount", label: "analyzer.php.entity.package.prop.classCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "class",
      name: "analyzer.php.entity.class.name",
      icon: "view_module",
      color: "#777bb4",
      properties: [
        { key: "name", label: "analyzer.php.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.php.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.php.entity.string.prop.methods", type: "number", default: 0 },
        { key: "properties", label: "analyzer.php.entity.class.prop.properties", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.php.entity.number.prop.complexity", type: "number", default: 0 },
        { key: "isAbstract", label: "analyzer.php.entity.class.prop.isAbstract", type: "boolean", default: false },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.php.entity.interface.name",
      icon: "account_tree",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.php.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.php.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.php.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.php.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.php.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.php.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.php.entity.string.prop.complexity", type: "number", default: 0 },
        { key: "visibility", label: "analyzer.php.entity.function.prop.visibility", type: "select", options: ["public", "protected", "private"], default: "public" },
      ],
      defaultLayer: "infra",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.php.view.architecture.name",
      description: "analyzer.php.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "presentation", name: "analyzer.php.view.architecture.layer.presentation", color: "#0ea5e9" },
        { type: "business", name: "analyzer.php.view.architecture.layer.business", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.php.view.architecture.layer.domain", color: "#f59e0b" },
        { type: "infra", name: "analyzer.php.view.architecture.layer.infra", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.php.view.dependency.name",
      description: "analyzer.php.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.php.view.dependency.layer.default", color: "#777bb4" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.php.view.layering.name",
      description: "analyzer.php.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "presentation", name: "analyzer.php.view.layering.layer.presentation", color: "#0ea5e9" },
        { type: "business", name: "analyzer.php.view.layering.layer.business", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.php.view.layering.layer.domain", color: "#f59e0b" },
        { type: "infra", name: "analyzer.php.view.layering.layer.infra", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "inheritance",
      name: "analyzer.php.view.inheritance.name",
      description: "analyzer.php.view.inheritance.desc",
      icon: "family_tree",
      defaultLayers: [
        { type: "default", name: "analyzer.php.view.inheritance.layer.default", color: "#ec4899" },
      ],
      layout: { scale: 0.85, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "presentation", name: "analyzer.php.layerType.presentation.name", icon: "web", color: "#0ea5e9", description: "analyzer.php.layerType.presentation.desc" },
    { type: "business", name: "analyzer.php.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.php.layerType.business.desc" },
    { type: "domain", name: "analyzer.php.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.php.layerType.domain.desc" },
    { type: "infra", name: "analyzer.php.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.php.layerType.infra.desc" },
    { type: "default", name: "analyzer.php.layerType.default.name", icon: "layers", color: "#777bb4", description: "analyzer.php.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.php.handler.navigate-to-source.name", description: "analyzer.php.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.php.handler.show-detail.name", description: "analyzer.php.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.php.handler.open-file.name", description: "analyzer.php.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.php.handler.highlight-cycle.name", description: "analyzer.php.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "php-complexity",
      name: "analyzer.php.rule.php-complexity.name",
      description: "analyzer.php.rule.php-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "php-coupling",
      name: "analyzer.php.rule.php-coupling.name",
      description: "analyzer.php.rule.php-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "php-layering",
      name: "analyzer.php.rule.php-layering.name",
      description: "analyzer.php.rule.php-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "php-unused-import",
      name: "analyzer.php.rule.php-unused-import.name",
      description: "analyzer.php.rule.php-unused-import.desc",
      severity: "info",
      category: "metadata",
    },
    {
      id: "php-long-method",
      name: "analyzer.php.rule.php-long-method.name",
      description: "analyzer.php.rule.php-long-method.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "php-deep-nesting",
      name: "analyzer.php.rule.php-deep-nesting.name",
      description: "analyzer.php.rule.php-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
  ],
};
