// 载体工作台实体注册（工作室重构 P1 → V2 设计视图 → G3 文字编辑容器 → 编辑面铺进 L2）
//
// writing-workbench：拖「载体」进画布落下的大尺寸卡。
//   - 不带 chapterId → 设计视图（小说三栏 / 散文两栏，书级绑定）；
//   - 带 chapterId   → 纸面卡（内嵌 TipTap，绑定真实章节/篇目）。
// writing-docs（G3）：kind="writing" 容器视图的铺满卡——L3 卷/章节文档页签 +
// 正文编辑区。页签是会话态（writingDocsStore），不落 scene.views。
// writing-studio-pane（2026-09-12）：L2 题材视图（大纲/人物设定/世界观）的铺满卡，
// 按 config.pane 渲染对应编辑面。此前 L2 题材视图铺的是只读分析板，
// 导致「在大纲视图里编辑不了大纲」——内容编辑面回到编辑区。
// 三者都**直接注册**而非走 writingAnalyzer manifest 桥接，原因：桥接对所有实体统一
// defaultSize 200×80，工作台需要大卡尺寸（设计视图三栏需更宽：780×540），
// 且这三类卡是程序化铺的（seed/拖载体），不该出现在左栏「元素」清单里。
// 组件注册表「已存在则跳过」语义保证与桥接互不冲突（先到先得）。
import { componentRegistry } from "./registryCore";
import { resolveFragments } from "../i18n";

componentRegistry.register({
  type: "writing-workbench",
  name: "writingWorkbench.defName",
  icon: "auto_stories",
  description: "writingWorkbench.defDesc",
  category: "analyzer-writing-analyzer",
  version: "1.0.0",
  defaultSize: { width: 780, height: 540 },
  minSize: { width: 560, height: 360 },
  defaultConfig: {
    // 同分析器桥接口径：defaultConfig.name 解引用为显示文本（IA 修复约定）
    name: resolveFragments("writingWorkbench.defName"),
    entityType: "writing-workbench",
    color: "#8b5cf6",
    genre: "",
  },
  capabilities: {
    resizable: true,
    rotatable: false,
    draggable: true,
    connectable: false,
    embeddable: false,
  },
  renderer: {
    loader: async () => ({
      default: (await import("./renderers/WritingWorkbenchRenderer")).WritingWorkbenchRenderer,
    }),
  },
});

componentRegistry.register({
  type: "writing-docs",
  name: "writingWorkbench.docsName",
  icon: "menu_book",
  description: "writingWorkbench.docsDesc",
  category: "analyzer-writing-analyzer",
  version: "1.0.0",
  defaultSize: { width: 780, height: 540 },
  minSize: { width: 560, height: 360 },
  defaultConfig: {
    name: resolveFragments("writingWorkbench.docsName"),
    entityType: "writing-docs",
    color: "#8b5cf6",
  },
  capabilities: {
    resizable: true,
    rotatable: false,
    draggable: true,
    connectable: false,
    embeddable: false,
  },
  renderer: {
    loader: async () => ({
      default: (await import("./renderers/WritingDocsRenderer")).WritingDocsRenderer,
    }),
  },
});

componentRegistry.register({
  type: "writing-studio-pane",
  name: "writingWorkbench.studioPaneName",
  icon: "edit_note",
  description: "writingWorkbench.studioPaneDesc",
  category: "analyzer-writing-analyzer",
  version: "1.0.0",
  defaultSize: { width: 780, height: 540 },
  minSize: { width: 420, height: 260 },
  defaultConfig: {
    name: resolveFragments("writingWorkbench.studioPaneName"),
    entityType: "writing-studio-pane",
    color: "#4A338F",
    pane: "storyline",
  },
  capabilities: {
    resizable: true,
    rotatable: false,
    draggable: true,
    connectable: false,
    embeddable: false,
  },
  renderer: {
    loader: async () => ({
      default: (await import("./renderers/WritingStudioPane")).WritingStudioPane,
    }),
  },
});
