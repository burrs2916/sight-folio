// sight-folio: Vue 分析器插件
// 后端支持：Tier 1（与 TypeScript 共享 tree-sitter Tsx dialect，
//   <script setup> / <script> 内的符号提取 + import 解析）
// 插件通过 AnalyzerManifest 向核心引擎声明能力，由 analyzerRegistry 注册。

import type { AnalyzerManifest } from "./types";

export const vueAnalyzerManifest: AnalyzerManifest = {
  id: "vue-analyzer",
  name: "analyzer.vue.name",
  version: "1.0.0",
  language: "Vue",
  capabilities: {
    scanning: true,
    rules: true,
    // 审计修复（2026-08-12，R44）：后端依赖解析（review.rs detect_dependencies）
    // 没有 vue 分支，SFC 的 import 无法可靠解析——如实降级声明，
    // 避免 UI 显示「依赖分析」徽标但实际没跑。
    dependencyAnalysis: false,
    rendering: true,
  },

  entityTypes: [
    {
      type: "module",
      name: "analyzer.vue.entity.module.name",
      icon: "web",
      color: "#42b883",
      properties: [
        { key: "name", label: "analyzer.vue.entity.module.prop.name", type: "string" },
        { key: "path", label: "analyzer.vue.entity.string.prop.path", type: "string" },
        { key: "componentCount", label: "analyzer.vue.entity.string.prop.componentCount", type: "number", default: 0 },
      ],
      defaultLayer: "presentation",
    },
    {
      type: "file",
      name: "analyzer.vue.entity.file.name",
      icon: "description",
      color: "#42b883",
      properties: [
        { key: "fileName", label: "analyzer.vue.entity.file.prop.fileName", type: "string" },
        { key: "filePath", label: "analyzer.vue.entity.string.prop.filePath", type: "string" },
        { key: "lineCount", label: "analyzer.vue.entity.string.prop.lineCount", type: "number", default: 0 },
      ],
      defaultLayer: "presentation",
    },
    {
      type: "class",
      name: "analyzer.vue.entity.class.name",
      icon: "view_module",
      color: "#35495e",
      properties: [
        { key: "name", label: "analyzer.vue.entity.class.prop.name", type: "string" },
        { key: "path", label: "analyzer.vue.entity.string.prop.path", type: "string" },
        { key: "methods", label: "analyzer.vue.entity.string.prop.methods", type: "number", default: 0 },
        { key: "props", label: "analyzer.vue.entity.number.prop.props", type: "number", default: 0 },
        { key: "emits", label: "analyzer.vue.entity.number.prop.emits", type: "number", default: 0 },
      ],
      defaultLayer: "presentation",
    },
    {
      type: "function",
      name: "analyzer.vue.entity.function.name",
      icon: "functions",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.vue.entity.function.prop.name", type: "string" },
        { key: "path", label: "analyzer.vue.entity.string.prop.path", type: "string" },
        { key: "complexity", label: "analyzer.vue.entity.string.prop.complexity", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
    {
      type: "interface",
      name: "analyzer.vue.entity.interface.name",
      icon: "account_tree",
      color: "#ec4899",
      properties: [
        { key: "name", label: "analyzer.vue.entity.interface.prop.name", type: "string" },
        { key: "path", label: "analyzer.vue.entity.string.prop.path", type: "string" },
        { key: "members", label: "analyzer.vue.entity.string.prop.members", type: "number", default: 0 },
      ],
      defaultLayer: "domain",
    },
  ],

  viewTemplates: [
    {
      type: "architecture",
      name: "analyzer.vue.view.architecture.name",
      description: "analyzer.vue.view.architecture.desc",
      icon: "account_tree",
      defaultLayers: [
        { type: "presentation", name: "analyzer.vue.view.presentation.name", color: "#42b883" },
        { type: "business", name: "analyzer.vue.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.vue.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.vue.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "dependency",
      name: "analyzer.vue.view.dependency.name",
      description: "analyzer.vue.view.dependency.desc",
      icon: "hub",
      defaultLayers: [
        { type: "default", name: "analyzer.vue.view.default.name", color: "#42b883" },
      ],
      layout: { scale: 0.9, panX: 0, panY: 0, grid: true },
    },
    {
      type: "component-tree",
      name: "analyzer.vue.view.component-tree.name",
      description: "analyzer.vue.view.component-tree.desc",
      icon: "family_tree",
      defaultLayers: [
        { type: "presentation", name: "analyzer.vue.view.presentation.name", color: "#35495e" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
    {
      type: "layering",
      name: "analyzer.vue.view.layering.name",
      description: "analyzer.vue.view.layering.desc",
      icon: "layers",
      defaultLayers: [
        { type: "presentation", name: "analyzer.vue.view.presentation.name", color: "#42b883" },
        { type: "business", name: "analyzer.vue.view.business.name", color: "#8b5cf6" },
        { type: "domain", name: "analyzer.vue.view.domain.name", color: "#f59e0b" },
        { type: "infra", name: "analyzer.vue.view.infra.name", color: "#10b981" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    { type: "presentation", name: "analyzer.vue.layerType.presentation.name", icon: "web", color: "#42b883", description: "analyzer.vue.layerType.presentation.desc" },
    { type: "business", name: "analyzer.vue.layerType.business.name", icon: "business_center", color: "#8b5cf6", description: "analyzer.vue.layerType.business.desc" },
    { type: "domain", name: "analyzer.vue.layerType.domain.name", icon: "domain", color: "#f59e0b", description: "analyzer.vue.layerType.domain.desc" },
    { type: "infra", name: "analyzer.vue.layerType.infra.name", icon: "dns", color: "#10b981", description: "analyzer.vue.layerType.infra.desc" },
    { type: "default", name: "analyzer.vue.layerType.default.name", icon: "layers", color: "#35495e", description: "analyzer.vue.layerType.default.desc" },
  ],

  eventHandlers: [
    { event: "entity:click", handlerId: "navigate-to-source", name: "analyzer.vue.handler.navigate-to-source.name", description: "analyzer.vue.handler.navigate-to-source.desc" },
    { event: "entity:hover", handlerId: "show-detail", name: "analyzer.vue.handler.show-detail.name", description: "analyzer.vue.handler.show-detail.desc" },
    { event: "entity:dblclick", handlerId: "open-file", name: "analyzer.vue.handler.open-file.name", description: "analyzer.vue.handler.open-file.desc" },
    { event: "dependency:cycle", handlerId: "highlight-cycle", name: "analyzer.vue.handler.highlight-cycle.name", description: "analyzer.vue.handler.highlight-cycle.desc" },
  ],

  rules: [
    {
      id: "vue-complexity",
      name: "analyzer.vue.rule.vue-complexity.name",
      description: "analyzer.vue.rule.vue-complexity.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "vue-coupling",
      name: "analyzer.vue.rule.vue-coupling.name",
      description: "analyzer.vue.rule.vue-coupling.desc",
      severity: "warning",
      category: "coupling",
    },
    {
      id: "vue-layering",
      name: "analyzer.vue.rule.vue-layering.name",
      description: "analyzer.vue.rule.vue-layering.desc",
      severity: "critical",
      category: "layering",
    },
    {
      id: "vue-unused-component",
      name: "analyzer.vue.rule.vue-unused-component.name",
      description: "analyzer.vue.rule.vue-unused-component.desc",
      severity: "info",
      category: "metadata",
    },
    {
      id: "vue-long-component",
      name: "analyzer.vue.rule.vue-long-component.name",
      description: "analyzer.vue.rule.vue-long-component.desc",
      severity: "warning",
      category: "complexity",
    },
    {
      id: "vue-too-many-props",
      name: "analyzer.vue.rule.vue-too-many-props.name",
      description: "analyzer.vue.rule.vue-too-many-props.desc",
      severity: "info",
      category: "complexity",
    },
    {
      id: "vue-deep-nesting",
      name: "analyzer.vue.rule.vue-deep-nesting.name",
      description: "analyzer.vue.rule.vue-deep-nesting.desc",
      severity: "warning",
      category: "complexity",
    },
  ],
};
