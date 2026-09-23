// sight-folio: 写作分析器插件（F1 分析器融合）
//
// 「分析器就是写作台」：本插件把小说写作业务接入既有分析器插件体系，
// 让实体图鉴 / 画布 / 组件注册表按写作语义说话——
//   章节（writing-chapter）↔ 源文件（file）
//   人物（writing-character）↔ 类（class）
//   世界观（writing-worldview）↔ 模块（module）
//   大纲（writing-outline）↔ 依赖图（module graph）
// 消费方只有 analyzerRegistry（激活时实体类型桥接进 componentRegistry），
// 与代码分析器完全同一条链路，零特判。

import type { AnalyzerManifest } from "./types";

export const writingAnalyzerManifest: AnalyzerManifest = {
  id: "writing-analyzer",
  name: "analyzer.writing.name",
  version: "1.0.0",
  // 后端 scan_writing_book 给章节文件标记 language = "novel-zh"
  language: "Novel",
  languageAliases: ["novel", "novel-zh", "writing"],
  // 实体图鉴「按语言」分组标签用短名（全名「小说写作分析器」太长）
  langNameKey: "analyzer.writing.langName",
  capabilities: {
    scanning: true, // 书 → 章节文件清单（scan_writing_book）
    rules: false, // 审查规则待 F3（伏笔账本 / 死设定）
    dependencyAnalysis: false, // 人物互动链待 F2（symbol-refs 语义）
    rendering: true,
  },

  entityTypes: [
    {
      type: "writing-chapter",
      name: "analyzer.writing.entity.chapter.name",
      icon: "menu_book",
      color: "#8b5cf6",
      properties: [
        { key: "title", label: "analyzer.writing.entity.chapter.prop.title", type: "string" },
        { key: "volume", label: "analyzer.writing.entity.chapter.prop.volume", type: "string" },
        { key: "wordCount", label: "analyzer.writing.entity.chapter.prop.wordCount", type: "number", default: 0 },
        { key: "chapterStatus", label: "analyzer.writing.entity.chapter.prop.status", type: "string" },
      ],
      defaultLayer: "writing-plot",
    },
    {
      type: "writing-character",
      name: "analyzer.writing.entity.character.name",
      icon: "person",
      color: "#f59e0b",
      properties: [
        { key: "name", label: "analyzer.writing.entity.character.prop.name", type: "string" },
        { key: "role", label: "analyzer.writing.entity.character.prop.role", type: "string" },
        { key: "appearances", label: "analyzer.writing.entity.character.prop.appearances", type: "number", default: 0 },
      ],
      defaultLayer: "writing-setting",
    },
    {
      type: "writing-worldview",
      name: "analyzer.writing.entity.worldview.name",
      icon: "public",
      color: "#10b981",
      properties: [
        { key: "name", label: "analyzer.writing.entity.worldview.prop.name", type: "string" },
        { key: "kind", label: "analyzer.writing.entity.worldview.prop.kind", type: "string" },
      ],
      defaultLayer: "writing-setting",
    },
    {
      type: "writing-outline",
      name: "analyzer.writing.entity.outline.name",
      icon: "account_tree",
      color: "#0ea5e9",
      properties: [
        { key: "title", label: "analyzer.writing.entity.outline.prop.title", type: "string" },
        { key: "summary", label: "analyzer.writing.entity.outline.prop.summary", type: "string" },
      ],
      defaultLayer: "writing-plot",
    },
  ],

  viewTemplates: [
    {
      type: "writing-overview",
      name: "analyzer.writing.view.overview.name",
      description: "analyzer.writing.view.overview.desc",
      icon: "auto_stories",
      defaultLayers: [
        { type: "writing-plot", name: "analyzer.writing.layer.plot.name", color: "#8b5cf6" },
        { type: "writing-setting", name: "analyzer.writing.layer.setting.name", color: "#f59e0b" },
      ],
      layout: { scale: 1, panX: 0, panY: 0, grid: true },
    },
  ],

  layerTypes: [
    {
      type: "writing-plot",
      name: "analyzer.writing.layer.plot.name",
      icon: "timeline",
      color: "#8b5cf6",
      description: "analyzer.writing.layer.plot.desc",
    },
    {
      type: "writing-setting",
      name: "analyzer.writing.layer.setting.name",
      icon: "category",
      color: "#f59e0b",
      description: "analyzer.writing.layer.setting.desc",
    },
  ],

  eventHandlers: [
    {
      event: "entity:click",
      handlerId: "navigate-to-source",
      name: "analyzer.writing.event.openChapter.name",
      description: "analyzer.writing.event.openChapter.desc",
    },
  ],

  rules: [],
};
