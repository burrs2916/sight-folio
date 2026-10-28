/**
 * 画布小地图（Minimap）的纯计算层 —— R33
 *
 * ## 为什么现在必须做这个
 *
 * R27/R28 给画布加了**视口虚拟化**：视口外的实体根本不挂载。这对卡顿是必需的，
 * 但同时带来一个副作用 —— 用户永远只能看见一屏。一个 500 文件的项目同步到画布后
 * 内容宽高上万像素，「我现在在整张图的哪里」「问题都堆在哪个角落」这两个问题
 * 在缩放到 20% 全览之前无法回答，而 20% 全览时文字已经糊成一片。
 *
 * 用户说的「画布的功能，统筹全局」，缺的正是这块：一个**始终可见的全局俯瞰**，
 * 既是导航器（点哪去哪），也是**热区图**（哪块红就是哪块烂）。
 *
 * ## 设计取舍
 *
 * - **纯函数 + 零 React**：投影算术、视口反算、风险配色全在这里，组件只管画 SVG。
 *   投影公式一旦写错（很容易，涉及两套坐标系三次变换），表现是"点小地图跳到错误
 *   位置"，靠肉眼调试极其痛苦 —— 所以这层必须可单测。
 * - **等比投影，不拉伸**：世界包围盒宽高比与小地图不一致时取较小的 scale 并居中，
 *   保证小地图上的形状与画布上的形状一致（拉伸会让人对"哪块大"产生错觉）。
 * - **最小可见尺寸**：一个 140×60 的文件实体在 1/60 缩放下只有 2×1 像素，
 *   低于 1px 会被浏览器抹掉。这里给每个矩形保底 `MIN_DOT`，宁可略微失真
 *   也不能让实体在俯瞰图上凭空消失 —— 俯瞰图的第一职责是"数量与分布"。
 */

import type { SceneComponent } from "../../types/editor";
import type { CanvasViewport } from "./panZoom";

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MinimapSize {
  width: number;
  height: number;
}

/** 世界坐标 → 小地图像素坐标的仿射变换（等比 + 居中偏移） */
export interface MinimapProjection {
  /** 等比缩放系数（世界 px → 小地图 px） */
  scale: number;
  /** 居中留白造成的平移量 */
  offsetX: number;
  offsetY: number;
  /** 世界包围盒（反算时需要） */
  bounds: WorldBounds;
}

export interface MiniRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 低于这个像素的矩形会被浏览器抹掉，保底放大到它 */
const MIN_DOT = 1.5;

/**
 * 计算世界包围盒到小地图画布的等比投影。
 *
 * 返回 null 的三种情况（调用方据此不渲染小地图，而不是画一张错位的图）：
 * 包围盒为空 / 包围盒退化成点或线 / 小地图容器尺寸尚未就绪。
 */
export function computeProjection(
  bounds: WorldBounds | null,
  size: MinimapSize,
  padding = 4
): MinimapProjection | null {
  if (!bounds) return null;
  if (!(size.width > 0) || !(size.height > 0)) return null;

  const boxW = bounds.maxX - bounds.minX;
  const boxH = bounds.maxY - bounds.minY;
  // 退化盒（只有一个实体时宽高可能为 0）给一个最小尺寸，避免除零得到 Infinity
  const safeW = boxW > 0 ? boxW : 1;
  const safeH = boxH > 0 ? boxH : 1;

  const availW = size.width - padding * 2;
  const availH = size.height - padding * 2;
  if (!(availW > 0) || !(availH > 0)) return null;

  const scale = Math.min(availW / safeW, availH / safeH);
  // 等比后剩余空间平分到两侧 → 内容在小地图里居中
  const offsetX = padding + (availW - safeW * scale) / 2;
  const offsetY = padding + (availH - safeH * scale) / 2;

  return { scale, offsetX, offsetY, bounds };
}

/** 世界矩形 → 小地图矩形（带最小可见尺寸保底） */
export function projectRect(
  t: { x: number; y: number; width: number; height: number },
  proj: MinimapProjection
): MiniRect {
  return {
    x: (t.x - proj.bounds.minX) * proj.scale + proj.offsetX,
    y: (t.y - proj.bounds.minY) * proj.scale + proj.offsetY,
    w: Math.max(MIN_DOT, (t.width || 0) * proj.scale),
    h: Math.max(MIN_DOT, (t.height || 0) * proj.scale),
  };
}

/** 小地图像素坐标 → 世界坐标（点击导航用） */
export function minimapToWorld(mx: number, my: number, proj: MinimapProjection): { x: number; y: number } {
  return {
    x: (mx - proj.offsetX) / proj.scale + proj.bounds.minX,
    y: (my - proj.offsetY) / proj.scale + proj.bounds.minY,
  };
}

/**
 * 当前视口在**世界坐标**下覆盖的矩形。
 *
 * 推导：屏幕点 s 对应世界点 w = (s - offset) / scale，
 * 因此容器左上角(0,0) → (-offset/scale)，右下角(cw,ch) → ((cw-offset)/scale)。
 */
export function viewportWorldRect(
  vp: CanvasViewport,
  container: MinimapSize
): { x: number; y: number; width: number; height: number } {
  const s = vp.scale > 0 ? vp.scale : 1;
  return {
    x: -vp.offset.x / s,
    y: -vp.offset.y / s,
    width: container.width / s,
    height: container.height / s,
  };
}

/**
 * 让某个世界坐标点落到画布视口正中 —— 点击小地图后的目标视口。
 * 缩放保持不变（小地图导航只改变"看哪里"，不改变"看多大"，
 * 否则每点一下都在跳缩放，方向感会丢）。
 */
export function centerViewportOn(
  world: { x: number; y: number },
  scale: number,
  container: MinimapSize
): CanvasViewport {
  const s = scale > 0 ? scale : 1;
  return {
    scale: s,
    offset: { x: container.width / 2 - world.x * s, y: container.height / 2 - world.y * s },
  };
}

// ══════════════════════════════════════════════════════════════════
// 风险配色：小地图不只是缩略图，是「问题分布热区图」
// ══════════════════════════════════════════════════════════════════

export type RiskTier = "critical" | "warning" | "watch" | "healthy" | "neutral";

/** 与 COMPLEXITY_COLORS / SEVERITY 配色同族，保证画布与小地图看起来是同一套语言 */
export const RISK_TIER_COLORS: Record<RiskTier, string> = {
  critical: "#ef4444",
  warning: "#f97316",
  watch: "#f59e0b",
  healthy: "#22c55e",
  neutral: "#64748b",
};

/**
 * 风险档位 → i18n key（图例/提示用）。组件渲染时用 t(key) 取文案，
 * 不在这里存中文：utils 层不依赖语言包，且模块级 const 求值一次会固化文案
 * （切语言不刷新，历史教训 ×3）。
 */
export const RISK_TIER_LABEL_KEYS: Record<RiskTier, string> = {
  critical: "canvasTip.tierCritical",
  warning: "canvasTip.tierWarning",
  watch: "canvasTip.tierWatch",
  healthy: "canvasTip.tierHealthy",
  neutral: "canvasTip.tierNeutral",
};

/**
 * 由实体 config（同步到画布时注入的 fileInsights 画像字段）判定风险档位。
 *
 * 判定顺序刻意与"该先看哪个"一致：
 * 1. `refactorFirst` 象限（高复杂 × 高变更）—— 投入产出比最高的重构目标，必红；
 * 2. 复杂度 extreme 同样必红（哪怕最近没人改，它也是定时炸弹）；
 * 3. high 复杂度 / 死代码 / 克隆 / 技术债 依次降档；
 * 4. 没有任何画像字段（模块头、手工拖入的实体）判为 neutral，
 *    用灰色而不是绿色 —— 绿色是"体检过且没问题"，灰是"没体检"，两者不能混。
 */
export function riskTierOf(config: Record<string, unknown> | undefined): RiskTier {
  if (!config) return "neutral";
  const complexity = config.complexityLevel as string | undefined;
  const quadrant = config.quadrant as string | undefined;
  const dead = Number(config.deadCount ?? 0);
  const clones = Number(config.cloneCount ?? 0);
  const debt = Number(config.techDebtCount ?? 0);

  const hasInsight =
    complexity !== undefined || quadrant !== undefined || config.symbolCount !== undefined;
  if (!hasInsight) return "neutral";

  if (quadrant === "refactorFirst" || complexity === "extreme") return "critical";
  if (complexity === "high" || dead > 0 || clones > 1) return "warning";
  if (debt > 0 || clones > 0 || complexity === "medium") return "watch";
  return "healthy";
}

/** 小地图一个点的绘制描述（组件直接 map 成 <rect>） */
export interface MinimapDot extends MiniRect {
  id: string;
  color: string;
  tier: RiskTier;
  selected: boolean;
}

/**
 * 把画布实体批量投影成小地图点。
 *
 * @param colorMode risk = 风险热区（默认）；layer = 架构分层色（看分层是否被越界摆放）
 * @param layerColorOf 分层色取色器（layer 模式用；取不到色回退 neutral）
 */
export function buildMinimapDots(
  components: readonly SceneComponent[],
  proj: MinimapProjection,
  opts: {
    selectedIds?: readonly string[];
    colorMode?: "risk" | "layer";
    layerColorOf?: (component: SceneComponent) => string | undefined;
  } = {}
): MinimapDot[] {
  const selected = new Set(opts.selectedIds ?? []);
  const mode = opts.colorMode ?? "risk";
  const dots: MinimapDot[] = [];
  for (const c of components) {
    // 连线类实体不画进小地图：依赖边/调用边（都注册为 dependency-edge，
    // 靠 config.callEdge 区分）的 transform 是「两端点的包围盒」，
    // 画成实心矩形会变成一大片色块，把真正的实体全盖住。
    if (c.type === "dependency-edge") continue;
    const r = projectRect(c.transform, proj);
    const tier = riskTierOf(c.config as Record<string, unknown> | undefined);
    let color = RISK_TIER_COLORS[tier];
    if (mode === "layer") {
      color = opts.layerColorOf?.(c) || RISK_TIER_COLORS.neutral;
    }
    dots.push({ id: c.id, ...r, color, tier, selected: selected.has(c.id) });
  }
  return dots;
}

/** 风险档位分布统计（小地图底部图例显示「红 12 · 橙 30 …」） */
export function summarizeTiers(dots: readonly MinimapDot[]): Record<RiskTier, number> {
  const out: Record<RiskTier, number> = { critical: 0, warning: 0, watch: 0, healthy: 0, neutral: 0 };
  for (const d of dots) out[d.tier] += 1;
  return out;
}
