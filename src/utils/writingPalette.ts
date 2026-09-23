// 右栏「创作组件」面板的组件注册表（纯数据：只存 i18n key，模块级绝不调 t()）
//
// 定位：右栏第 1 栏是**拖源**（创作时往编辑区拖的组件），不是业务数据浏览器。
// 内容随当前 L2 视图变化：typed 组 = 本视图专属组件，generic 组 = 任何视图都能用的通用组件。
//
// 铁律（宁缺毋滥）：这里的每一项都必须是**真实存在**的实体类型，且拖出去要落在有意义的地方。
//   真建档（blank:true → SceneEditor 的 __blank 链路 → createBlankWritingEntity）：
//     writing-chapter / writing-character / writing-worldview（失败降级壳卡并 toast）
//   纯画布卡（blank:false → 直接 addComponent，不建业务实体）：
//     writing-outline（大纲卡）/ annotation-text（便签）
// 半成品条目会变成「拖了没反应」的死节点 —— 缺数据模型的 L2（时间线/剧情线/伏笔/灵感/校对）
// **不放假条目占位**，只给通用组 + 一句 hint 明示「待数据模型就位」（联动绝不静默）。
//
// 文案策略：label/desc 一律复用既有键（`analyzer.writing.entity.*.name` / `writingLeft.tpl*`）——
// 同一中文值挂两个 key 会污染 resolveFragments 的 zh 反查索引，只给真正的新概念加键。

import type { WritingViewKind } from "./studioBook";

export interface PaletteItem {
  id: string;
  labelKey: string;
  descKey: string;
  color: string;
  /** 拖拽类型（application/x-project-entity） */
  entityType: string;
  /** true → 落点走 __blank 真建档；false → 纯画布卡，不建业务实体 */
  blank: boolean;
  config: Record<string, unknown>;
}

export interface PaletteGroup {
  key: string;
  labelKey: string;
  items: PaletteItem[];
}

export interface PaletteResult {
  groups: PaletteGroup[];
  /** 该视图没有专属组件时的明示文案键；null = 不需要提示 */
  hintKey: string | null;
}

/** 已注册的写作实体类型（componentRegistry / writingAnalyzer 桥接），测试据此兜底校验 */
export const PALETTE_ENTITY_TYPES = [
  "writing-chapter",
  "writing-character",
  "writing-worldview",
  "writing-outline",
  "annotation-text",
] as const;

export const GROUP_TYPED = "editor.writing.palette.groupTyped";
export const GROUP_GENERIC = "editor.writing.palette.groupGeneric";
export const PALETTE_PENDING = "editor.writing.palette.pending";
export const PALETTE_WRITING_HINT = "editor.writing.palette.writingHint";
export const PALETTE_TIMELINE_HINT = "editor.writing.palette.timelineHint";

const COLOR_CHAPTER = "#8b5cf6";
const COLOR_CHARACTER = "#f59e0b";
const COLOR_WORLDVIEW = "#10b981";
const COLOR_OUTLINE = "#0ea5e9";
const COLOR_NOTE = "#94a3b8";

/**
 * 章 / 篇：命名跟随**当前书体裁**（散文书拖出即「篇目」），与
 * createBlankWritingEntity 的 genreHint 口径一致；genre 也随拖拽 payload 传给落点建档。
 */
function chapterItem(genre: string): PaletteItem {
  return {
    id: "chapter",
    labelKey: genre === "essay" ? "writingLeft.tplEssayPiece" : "analyzer.writing.entity.chapter.name",
    descKey: "editor.writing.palette.descChapter",
    color: COLOR_CHAPTER,
    entityType: "writing-chapter",
    blank: true,
    config: { __blank: true, genre },
  };
}

const CHARACTER: PaletteItem = {
  id: "character",
  labelKey: "analyzer.writing.entity.character.name",
  descKey: "editor.writing.palette.descCharacter",
  color: COLOR_CHARACTER,
  entityType: "writing-character",
  blank: true,
  config: { __blank: true },
};

const WORLDVIEW: PaletteItem = {
  id: "worldview",
  labelKey: "analyzer.writing.entity.worldview.name",
  descKey: "editor.writing.palette.descWorldview",
  color: COLOR_WORLDVIEW,
  entityType: "writing-worldview",
  blank: true,
  config: { __blank: true, kind: "worldview" },
};

/** 大纲卡：画布上的分组/概要条，无业务实体（与卷头/统计卡同 type，靠 kind 区分版式） */
const OUTLINE: PaletteItem = {
  id: "outline",
  labelKey: "writingLeft.tplOutline",
  descKey: "editor.writing.palette.descOutline",
  color: COLOR_OUTLINE,
  entityType: "writing-outline",
  blank: false,
  config: { title: "", summary: 0 },
};

/** 便签：自由写作块，全文在右栏属性面板编辑 */
const NOTE: PaletteItem = {
  id: "note",
  labelKey: "writingLeft.tplNote",
  descKey: "editor.writing.palette.descNote",
  color: COLOR_NOTE,
  entityType: "annotation-text",
  blank: false,
  config: { text: "" },
};

/** 各 L2 视图的专属组件。缺位的 kind（时间线/剧情线/伏笔/灵感/校对/统计）留给 hint 明示。 */
const TYPED: Partial<Record<WritingViewKind, (genre: string) => PaletteItem[]>> = {
  // 大纲：骨架 —— 拖出即建章 + 分组概要条
  catalog: (genre) => [chapterItem(genre), OUTLINE],
  // 人物：设定卡（真建档，建档后右栏属性可改名并回写业务层）
  characters: () => [CHARACTER],
  //  worldview：设定卡
  worldview: () => [WORLDVIEW],
  // 时间线：事件实体在独立表 writing_timeline_events（settingId 可空），在设定编辑器维护，
  // 时间线视图只做「分轨 + 按时序铺开」的只读聚合，没有专属拖拽条目
  timeline: () => [],
  // 正文（L3 容器）：画布被铺满的 writing-docs 卡占满，落卡必然被遮住 → 不给条目，
  // 改为 hint 指向页签栏的 ＋（「在正文视图拖章节 → 开 L3 页签」属落点分层改造，另批）
  writing: () => [],
};

export function paletteFor(genre: string, kind: string | undefined): PaletteResult {
  // 遗留视图（无 kind，如代码场景遗留的 default）按大纲处理，保证有可用条目而不是空面板。
  // 参数放开成 string：store 里的 view.kind 还带有历史遗留值（"overview"），它不是
  // WritingViewKind 成员 —— 这类视图按「无专属元素」处理（通用组 + 待数据模型提示），
  // 与 SceneTabBar 的清理逻辑同一口径，不在这里静默当大纲。
  const k = kind ?? "catalog";
  const typed = ((TYPED as Record<string, ((g: string) => PaletteItem[]) | undefined>)[k] ?? (() => []))(
    genre
  );

  const groups: PaletteGroup[] = [];
  if (typed.length > 0) {
    groups.push({ key: "typed", labelKey: GROUP_TYPED, items: typed });
  }
  // 正文视图不给通用组（落了也被铺满卡遮住，不如不给）
  if (k !== "writing") {
    groups.push({ key: "generic", labelKey: GROUP_GENERIC, items: [NOTE] });
  }

  let hintKey: string | null = null;
  if (k === "writing") hintKey = PALETTE_WRITING_HINT;
  else if (k === "timeline") hintKey = PALETTE_TIMELINE_HINT;
  else if (typed.length === 0) hintKey = PALETTE_PENDING;

  return { groups, hintKey };
}
