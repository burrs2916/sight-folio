// sight-folio: Rust 分析器插件（第二阶段，中等优先级）
// 对应需求文档 §4.6 渐进式语言支持路线图：
//   核心能力 = mod 树扫描、use 依赖分析、crate 依赖、unsafe 检测
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const rustAnalyzerManifest: AnalyzerManifest = {
  id: "rust-analyzer",
  name: "analyzer.rs.name",
  version: "1.0.0",
  language: "Rust",
  capabilities: {
    scanning: true, // mod 树 / 文件扫描
    rules: true, // 审查规则（unsafe 检测等）
    dependencyAnalysis: true, // use / crate 依赖分析
    rendering: true, // 自定义渲染
  },

  // 实体类型注册（ComponentTypeRegistry）—— Rust 特有实体
  entityTypes: [
    {
      type: "crate",
      name: "analyzer.rs.entity.crate.name",
      icon: "inventory",
      color: "#d97706",
      properties: [
        { key: "name", label: "analyzer.rs.entity.crate.prop.name", type: "string" },
        { key: "path", label: "analyzer.rs.entity.string.prop.path", type: "string" },
        { key: "moduleCount", label: "analyzer.rs.entity.string.prop.moduleCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "module",
      name: "analyzer.rs.entity.module.name",
      icon: "inventory_2",
      color: "#6366f1",
      properties: [
        { key: "name", label: "analyzer.rs.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.rs.entity.string.prop.path", type: "string" },
        { key: "fileCount", label: "analyzer.rs.entity.string.prop.fileCount", type: "number", default: 0 },
        { key: "visibility", label: "analyzer.rs.entity.number.prop.visibility", type: "select", options: ["pub", "pub(crate)", "private"], default: "private" },
      ],
      defaultLayer: "domain",
    },
    {
      type: "struct",
      name: "analyzer.rs.entity.struct.name",
      icon: "data_object",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.rs.entity.struct.prop.name", type: "string" },
        { key: "path", label: "analyzer.rs.entity.string.prop.path", type: "string" },
        { key: "fields", label: "analyzer.rs.entity.string.prop.fields", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.rs.entity.number.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "trait",
      name: "analyzer.rs.entity.trait.name",
      icon: "api",
      color: "#8b5cf6",
      properties: [
        { key: "name", label: "analyzer.rs.entity.trait.prop.name", type: "string" },
        { key: "path", label: "analyzer.rs.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.rs.entity.string.prop.methods", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.rs.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.rs.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.rs.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.rs.entity.string.prop.complexity", type: "number", default: 0 },
        { key: "hasUnsafe", label: "analyzer.rs.entity.number.prop.hasUnsafe", type: "boolean", default: false },
      ],
      defaultLayer: "infra",
    },
  ],

  // 视角模板注册（ViewTemplateRegistry）
  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.rs.view.architecture.name",
      description: "analyzer.rs.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "business", name: "analyzer.rs.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.rs.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.rs.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.rs.view.dependency.name",
      description: "analyzer.rs.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.rs.view.default.name", color: "#6366f1" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.rs.view.layering.name",
      description: "analyzer.rs.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "business", name: "analyzer.rs.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.rs.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.rs.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "unsafe-risk",
      name: "analyzer.rs.view.unsafe-risk.name",
      description: "analyzer.rs.view.unsafe-risk.desc",
      icon: "warning",
      defaultLayers: [
        { type: "default", name: "analyzer.rs.view.default.name", color: "#ef4444" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  // 图层类型注册（LayerTypeRegistry）
  layerTypes: [
    { type: "business", name: "analyzer.rs.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.rs.layerType.business.desc" },
    { type: "domain", name: "analyzer.rs.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.rs.layerType.domain.desc" },
    { type: "infra", name: "analyzer.rs.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.rs.layerType.infra.desc" },
    { type: "default", name: "analyzer.rs.layerType.default.name", icon: "layers", color: "#6366f1", description: "analyzer.rs.layerType.default.desc" },
  ],

  // 事件处理器注册（EventHandlerRegistry）
  eventHandlers: [
    {
      event: "entity:click",
      handlerId: "navigate-to-source",
      name: "analyzer.rs.handler.navigate-to-source.name",
      description: "analyzer.rs.handler.navigate-to-source.desc",
    },
    {
      event: "entity:hover",
      handlerId: "show-detail",
      name: "analyzer.rs.handler.show-detail.name",
      description: "analyzer.rs.handler.show-detail.desc",
    },
    {
      event: "entity:dblclick",
      handlerId: "open-file",
      name: "analyzer.rs.handler.open-file.name",
      description: "analyzer.rs.handler.open-file.desc",
    },
    {
      event: "dependency:cycle",
      handlerId: "highlight-cycle",
      name: "analyzer.rs.handler.highlight-cycle.name",
      description: "analyzer.rs.handler.highlight-cycle.desc",
    },
  ],

  // 规则引擎注册（RuleRegistry）—— 含 Rust 特有 unsafe 检测
  rules: [
    {
      id: "rs-unsafe",
      name: "analyzer.rs.rule.rs-unsafe.name",
      description: "analyzer.rs.rule.rs-unsafe.desc",
      severity: "critical",
      category: "metric",
    },
    {
      id: "rs-complexity",
      name: "analyzer.rs.rule.rs-complexity.name",
      description: "analyzer.rs.rule.rs-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "rs-coupling",
      name: "analyzer.rs.rule.rs-coupling.name",
      description: "analyzer.rs.rule.rs-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "rs-layering",
      name: "analyzer.rs.rule.rs-layering.name",
      description: "analyzer.rs.rule.rs-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "rs-unused",
      name: "analyzer.rs.rule.rs-unused.name",
      description: "analyzer.rs.rule.rs-unused.desc",
      severity: "info",
      category: "metadata",
    },
    // ── 以下三条由 tree-sitter AST 度量驱动（R31 新增）──
    // Rust 的 match 臂与 `?` 都会计入判定，行级启发式此前完全数不准
    {
      id: "rs-deep-nesting",
      name: "analyzer.rs.rule.rs-deep-nesting.name",
      description: "analyzer.rs.rule.rs-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "rs-long-function",
      name: "analyzer.rs.rule.rs-long-function.name",
      description: "analyzer.rs.rule.rs-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "rs-magic-number",
      name: "analyzer.rs.rule.rs-magic-number.name",
      description: "analyzer.rs.rule.rs-magic-number.desc",
      severity: "info",
      category: "metadata",
    },
  ],
};
