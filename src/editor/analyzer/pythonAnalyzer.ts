// project-sight: Python 分析器插件（第三阶段，低优先级）
// 对应需求文档 §4.6 渐进式语言支持路线图：
//   核心能力 = 模块扫描、import 分析、函数调用图
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const pythonAnalyzerManifest: AnalyzerManifest = {
  id: "python-analyzer",
  name: "analyzer.py.name",
  version: "1.0.0",
  language: "Python",
  capabilities: {
    scanning: true, // 模块/包扫描
    rules: true, // 审查规则
    dependencyAnalysis: true, // import 依赖分析
    rendering: true, // 自定义渲染
  },

  // 实体类型注册（ComponentTypeRegistry）—— Python 特有实体
  entityTypes: [
    {
      type: "package",
      name: "analyzer.py.entity.package.name",
      icon: "inventory",
      color: "#0ea5e9",
      properties: [
        { key: "name", label: "analyzer.py.entity.package.prop.name", type: "string" },
        { key: "path", label: "analyzer.py.entity.string.prop.path", type: "string" },
        { key: "moduleCount", label: "analyzer.py.entity.string.prop.moduleCount", type: "number", default: 0 },
      ],
      defaultLayer: "business",
    },
    {
      type: "module",
      name: "analyzer.py.entity.module.name",
      icon: "description",
      color: "#6366f1",
      properties: [
        { key: "name", label: "analyzer.py.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.py.entity.string.prop.path", type: "string" },
        { key: "lineCount", label: "analyzer.py.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "class",
      name: "analyzer.py.entity.class.name",
      icon: "view_module",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.py.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.py.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.py.entity.string.prop.methods", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.py.entity.number.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "function",
      name: "analyzer.py.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.py.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.py.entity.string.prop.path", type: "string" },
        { key: "params", label: "analyzer.py.entity.string.prop.params", type: "number", default: 0 },
        { key: "complexity", label: "analyzer.py.entity.number.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "infra",
    },
  ],

  // 视角模板注册（ViewTemplateRegistry）
  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.py.view.architecture.name",
      description: "analyzer.py.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "business", name: "analyzer.py.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.py.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.py.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.py.view.dependency.name",
      description: "analyzer.py.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.py.view.default.name", color: "#6366f1" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "call-graph",
      name: "analyzer.py.view.call-graph.name",
      description: "analyzer.py.view.call-graph.desc",
      icon: "call_split",
      defaultLayers: [
        { type: "default", name: "analyzer.py.view.default.name", color: "#0ea5e9" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.py.view.layering.name",
      description: "analyzer.py.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "business", name: "analyzer.py.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.py.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.py.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  // 图层类型注册（LayerTypeRegistry）
  layerTypes: [
    { type: "business", name: "analyzer.py.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.py.layerType.business.desc" },
    { type: "domain", name: "analyzer.py.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.py.layerType.domain.desc" },
    { type: "infra", name: "analyzer.py.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.py.layerType.infra.desc" },
    { type: "default", name: "analyzer.py.layerType.default.name", icon: "layers", color: "#6366f1", description: "analyzer.py.layerType.default.desc" },
  ],

  // 事件处理器注册（EventHandlerRegistry）
  eventHandlers: [
    {
      event: "entity:click",
      handlerId: "navigate-to-source",
      name: "analyzer.py.handler.navigate-to-source.name",
      description: "analyzer.py.handler.navigate-to-source.desc",
    },
    {
      event: "entity:hover",
      handlerId: "show-detail",
      name: "analyzer.py.handler.show-detail.name",
      description: "analyzer.py.handler.show-detail.desc",
    },
    {
      event: "entity:dblclick",
      handlerId: "open-file",
      name: "analyzer.py.handler.open-file.name",
      description: "analyzer.py.handler.open-file.desc",
    },
    {
      event: "dependency:cycle",
      handlerId: "highlight-cycle",
      name: "analyzer.py.handler.highlight-cycle.name",
      description: "analyzer.py.handler.highlight-cycle.desc",
    },
  ],

  // 规则引擎注册（RuleRegistry）
  rules: [
    {
      id: "py-complexity",
      name: "analyzer.py.rule.py-complexity.name",
      description: "analyzer.py.rule.py-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "py-import-cycle",
      name: "analyzer.py.rule.py-import-cycle.name",
      description: "analyzer.py.rule.py-import-cycle.desc",
      severity: "critical",
      category: "coupling",
    },
    {
      id: "py-coupling",
      name: "analyzer.py.rule.py-coupling.name",
      description: "analyzer.py.rule.py-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "py-layering",
      name: "analyzer.py.rule.py-layering.name",
      description: "analyzer.py.rule.py-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "py-unused-import",
      name: "analyzer.py.rule.py-unused-import.name",
      description: "analyzer.py.rule.py-unused-import.desc",
      severity: "info",
      category: "metadata",
    },
    // ── 以下两条由 tree-sitter AST 度量驱动（R31 新增）──
    // Python 没有大括号，缩进嵌套深度只有 AST 才数得准
    {
      id: "py-deep-nesting",
      name: "analyzer.py.rule.py-deep-nesting.name",
      description: "analyzer.py.rule.py-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "py-long-function",
      name: "analyzer.py.rule.py-long-function.name",
      description: "analyzer.py.rule.py-long-function.desc",
      severity: "warning",
      category: "complexity",
    },
  ],
};
