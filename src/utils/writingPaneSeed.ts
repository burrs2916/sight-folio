// L2 题材视图 → 编辑面 的纯语义（从 studioBook 抽出来，为的是能单测）
//
// 这里的每条规则都**不能错**：
//   ① 哪个 L2 kind 该铺哪个 pane —— 错了就是「点在人物页签里编辑大纲」；
//   ② 哪些卡是**只读分析板的残留** —— 老视图升级时要清掉它们。这条错了会**删用户内容**：
//      用户自己拖进来的章节卡 / 设定卡与布局器产物是同一批 type
//      （writing-chapter / writing-character / writing-worldview），
//      按类型一刀切就会连用户拖动的东西一起删。所以只认**布局器写死的 seed 标记**，不认 type。
//   ③ 哪些卡算「画布已有内容」—— 漏判会让空态引导叠在编辑面之上；
//   ④ 哪些卡「铺满画布且固定」—— 漏判会让一次框选把整块编辑区选中拖走。
// 抽成纯函数还有一个好处：它不 import 任何 store / Tauri，单测直接跑。

import type { WritingViewKind } from "./studioBook";

/** L2 题材视图 kind → 编辑面 pane。非题材编辑视图（含 writing/正文/custom）不在表内。
 *  stats 已从旧「只读画布板」升级为 StatsPane 编辑面（2026-09-19），走同一 reconcile 清场铺面。 */
export const STUDIO_PANE_BY_KIND: Partial<Record<WritingViewKind, StudioPaneKind>> = {
  catalog: "storyline",
  characters: "characters",
  worldview: "worldview",
  timeline: "timeline",
  storylines: "storylines",
  foreshadowing: "foreshadowings",
  inspiration: "inspirations",
  proofread: "proofread",
  stats: "stats",
  overview: "overview",
};

export type StudioPaneKind = "storyline" | "characters" | "worldview" | "timeline" | "storylines" | "foreshadowings" | "inspirations" | "proofread" | "stats" | "overview";

export function studioPaneForViewKind(kind: string | undefined): StudioPaneKind | null {
  if (!kind) return null;
  return STUDIO_PANE_BY_KIND[kind as WritingViewKind] ?? null;
}

/**
 * 铺满画布的写作内容卡类型。
 * 用途：判断「书场景画布上是不是已经有东西了」——空态引导（「拖入载体，开始创作」）
 * 与 L1/L2 页签栏的显隐都靠它。**只判 writing-workbench 是错的**：
 * L2 题材编辑面（writing-studio-pane）与正文容器（writing-docs）同样是内容卡，
 * 漏判会让空态引导叠在编辑面之上（点开「大纲」页签还提示「拖入载体」）。
 */
export const WRITING_CANVAS_CARD_TYPES: ReadonlySet<string> = new Set([
  "writing-workbench",
  "writing-docs",
  "writing-studio-pane",
]);

export function hasWritingCanvasCard(components: readonly { type: string }[]): boolean {
  return components.some((c) => WRITING_CANVAS_CARD_TYPES.has(c.type));
}

/**
 * 铺满画布、**固定不可选**的容器卡（正文容器 / 题材编辑面）。
 * 它们整卡拦截指针事件，所以「点选」根本选不中；但**框选是按几何命中的**，
 * 一次框选就能把它们选中 → 拖动会把整块编辑区拖走，Delete 会把它删掉。
 * 因此框选命中必须同等排除（与 dependency-edge / quadrant-zone-bg 同一口径）。
 */
export const FULL_CANVAS_WRITING_CARDS: ReadonlySet<string> = new Set([
  "writing-docs",
  "writing-studio-pane",
]);

export function isFullCanvasWritingCard(type: string): boolean {
  return FULL_CANVAS_WRITING_CARDS.has(type);
}

/**
 * 铺满画布的编辑面（视口贴面层）的 DOM 标记。
 *
 * **它不是 `data-component-id`** —— 这个区别是刻意的：`data-component-id` 是
 * 「我是画布上的一个实体」的身份牌，挂上它就会被接进右键菜单 / 定位 / 框选那一整套
 * 实体语义。贴面层确实是**画布本身**，不是画布上的一个对象，所以它只配拿这个标记。
 *
 * 起因（真实缺陷）：贴面层一度带 `data-component-id`，于是右键编辑区内部任何位置
 * 都被 `closest("[data-component-id]")` 命中 → 弹出针对这张卡的**画布实体菜单**
 * （复制 / 上移 / 置顶 / 锁定 / 隐藏 / 删除）。而贴面层不走变换层，菜单 9 项里 7 项
 * 是静默 no-op，只有「删除」有反应，反应是编辑区整块消失；同时正文（TipTap）的
 * 剪切 / 复制 / 粘贴 / 拼写菜单被一并拦掉 —— 写小说时右键连粘贴都没有。
 */
export const WRITING_SURFACE_ATTR = "data-writing-surface";

/** 右键 / 点击命中：目标是否落在贴面编辑层之内（是则应放行原生行为，不弹画布实体菜单）。 */
export function isWritingSurfaceTarget(target: Element | null | undefined): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return target.closest(`[${WRITING_SURFACE_ATTR}]`) !== null;
}

/** 文书编辑区选择器：TipTap 正文（ProseMirror 的可编辑 div）、大纲/人设里的 input、便签 textarea。 */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"], [contenteditable=""]';

/**
 * 右键是否该**放行给原生菜单**（而不是弹画布实体菜单）。
 *
 * 两条规则，都只在书场景生效（`bookScene` 为假的代码场景返回 false，一行未动）：
 *   ① 目标在贴面编辑层内 —— 那层是「画布本身」，不是画布上的实体；
 *   ② 目标是可编辑区 —— 载体卡（`writing-workbench`）里的章编辑器虽然是真实体卡，
 *      但卡**里面**的正文照样要剪切/复制/粘贴/拼写。
 * 放行 = 既不弹菜单也不 preventDefault，事件继续冒泡到 WebView 原生菜单。
 */
export function shouldYieldToNativeContextMenu(
  target: Element | null | undefined,
  bookScene: boolean,
): boolean {
  if (!target || typeof target.closest !== "function") return false;
  if (isWritingSurfaceTarget(target)) return true;
  if (!bookScene) return false;
  return target.closest(EDITABLE_SELECTOR) !== null;
}

/** 画布组件的判定输入（只取用得到的三个字段，避免耦合 SceneComponent 全量类型） */
export interface CanvasCardLike {
  id: string;
  type: string;
  config?: Record<string, unknown>;
  transform?: { x: number; y: number; width: number; height: number };
}

/**
 * 视图里该以「视口贴面」渲染的卡（铺满画布那类，取第一张）。
 *
 * 为什么铺满画布的编辑面不能当画布实体渲染：实体活在 transform 层里，随视口缩放 ——
 * 一张 1920×1080 的编辑面在「适应画布」（padding 80、居中）后只剩 0.46 倍，四周
 * 全是画布底纹（用户原话：「编辑区要覆盖整个画布，中间不要留背景」），pane 里 11px
 * 的字被压到 5px。贴面渲染（inset:0 撑满视口、1:1 像素、不吃缩放平移）才是
 * 「编辑区就是整块画布」。判定收在这里，渲染侧只消费这个纯函数。
 */
export function findFullBleedCard<T extends CanvasCardLike>(comps: readonly T[]): T | null {
  return comps.find((c) => isFullCanvasWritingCard(c.type)) ?? null;
}

/**
 * 重复铺下的编辑面残留 → 应被清掉的 id（保留第一张）。
 *
 * 起因（真实事故）：reconcileStudioPaneView 的两个触发点（点 L2 页签 / 激活视图自愈）
 * 在同一轮 React 提交里各自读到「没有编辑面」的同一份快照，于是同一视图落了**两张坐标
 * 完全相同的 writing-studio-pane**。叠在一起肉眼看不出来，实际是两个编辑面同时在读写
 * 同一份数据、DOM 与订阅翻倍。
 *
 * 判定刻意收紧到「同 pane 种类 + 几何完全一致」：只有种子（addStudioPaneCard 铺满画布）
 * 会产出这种完全重合的重复项；用户自己拖进来、摆到别处的编辑面卡一张都不动
 * （宁可漏清也不删用户内容）。
 */
export function duplicateStudioPaneIds(comps: readonly CanvasCardLike[]): string[] {
  const panes = comps.filter((c) => c.type === "writing-studio-pane");
  if (panes.length < 2) return [];
  const keep = panes[0];
  const kt = keep.transform;
  const kpane = keep.config?.pane ?? null;
  return panes
    .slice(1)
    .filter((c) => {
      const t = c.transform;
      const sameGeom =
        !!kt && !!t && kt.x === t.x && kt.y === t.y && kt.width === t.width && kt.height === t.height;
      return sameGeom && (c.config?.pane ?? null) === kpane;
    })
    .map((c) => c.id);
}

/**
 * 只读分析板卡的识别（老视图升级时清场用）。
 *
 * 标记来源（utils/writingBoards 的布局器）：
 *   buildStoryboard      章节卡 → shotNo；卷头 → config.kind === "volume"
 *   buildStatsBoard      KPI/卷/章卡 → config.kind === "stat"
 *   buildRelationBoard   边 → config.depType === "cooccur"；
 *                        节点卡（人物/世界观）→ **带 chapterCount**
 *                        （真建档的 settingCardConfig 只有 appearances，没有 chapterCount）
 *
 * 反例（必须判 false，否则会删用户内容）：
 *   - studioBook.chapterCardConfig 的产物：有 chapterId + fileId=wfile_*，无 shotNo
 *   - studioBook.settingCardConfig 的产物：有 settingId + appearances，无 chapterCount
 *   - dependency-edge 里非共现的边（structure/deps 场景）：depType 不是 cooccur
 */
export function isLegacyBoardCard(type: string, config: Record<string, unknown> | undefined): boolean {
  const c = config ?? {};
  if (type === "dependency-edge") return c.depType === "cooccur";
  if (type === "writing-outline") {
    return (
      c.kind === "volume" ||
      c.kind === "event" ||
      c.kind === "stat" ||
      c.kind === "event-track" ||
      c.kind === "timeline-axis" ||
      c.kind === "timeline-empty"
    );
  }
  if (type === "writing-chapter") return c.shotNo !== undefined;
  if (type === "writing-character" || type === "writing-worldview") {
    return c.chapterCount !== undefined;
  }
  return false;
}
