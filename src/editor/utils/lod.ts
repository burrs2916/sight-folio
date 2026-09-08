// project-sight: 画布实体的 LOD（Level of Detail）分级渲染
//
// ─── 为什么需要 LOD（R37 卡顿攻坚的第五刀）─────────────────────────────────
//
// 视口虚拟化（R28）解决的是「视口外的实体不渲染」。但它有一个致命盲区：
// **用户点「适应」全览时，所有实体都在视口内** —— 虚拟化一个都剪不掉，
// 而这恰恰是最卡的时刻，也是用户看画布的默认姿势。
//
// 基准实测（`renderers/__bench__/renderCost.test.tsx`）：一个文件实体展开是
// 23 个 DOM 节点（色条 + 图标 + 标题 + 语言 + 行数 + 最多 9 个画像徽标 +
// 3 个风险角标）。500 个文件 = **11,500 个 DOM 节点**，浏览器光是布局与合成
// 就会掉到个位数帧率。
//
// 地图 / CAD / 游戏引擎里这道题的标准解法是 LOD：**离得远就少画**。而且在
// 本项目里，少画不是妥协而是改善 —— 全览时缩放常在 0.25~0.4，卡片实际显示
// 高度只有 10px 上下，9px 的徽标字被压到 3px，本来就是不可读的视觉噪声。
//
// ─── 三档 ────────────────────────────────────────────────────────────────
//
// | 档位      | 触发缩放      | 画什么                              | 节点数 |
// |-----------|--------------|-------------------------------------|--------|
// | `full`    | ≥ 0.60       | 完整卡片（徽标 + 角标 + 全部文字）    | ~24    |
// | `compact` | 0.30 ~ 0.60  | 色条 + 名称 + 路径行 + 单个风险角标   | ~6     |
// | `block`   | < 0.30       | 纯色块（风险色）+ 色条                | ~2     |
//
// ─── 迟滞（hysteresis）─────────────────────────────────────────────────────
//
// 阈值单点判定会在边界附近抖动：用户在 0.72 附近微调滚轮，档位反复横跳，
// 每次横跳都是一次全画布重挂载 —— 比不做 LOD 还卡。所以升档与降档用不同
// 阈值（升档需超出 8%），跨过去就得走远一点才回得来。

export type CanvasLod = "full" | "compact" | "block";

/**
 * 降档阈值：缩放低于此值就往下走一档。
 *
 * R39：阈值整体下移并跟「fit 全览的真实 scale」对齐。fit 把缩放 clamp 在
 * 0.2~0.4，旧阈值 0.72/0.38 意味着**默认全览必然是 block 色块海** ——
 * 用户反馈「颜色太浅、看不清、效果没实现」的机制性根源就是这里：
 * 路径行/语言徽标/连线语义全被降档砍掉了。下移后：
 *   - full 0.60：放大到 0.6 就能看到完整卡片（路径行 + 徽标）
 *   - compact 0.30：常见全览（0.3~0.6）落在 compact，显示名称 + 路径行
 *   - block <0.30：真正挤成像素级（上千文件全览）才退化成色块
 * 性能仍在预算内（compact 6 节点、block 1~3 节点），基准测试会盯住。
 */
export const LOD_DOWN = { full: 0.6, compact: 0.3 } as const;

/** 迟滞系数：升档要比降档阈值再高 8%，避免边界抖动 */
const HYSTERESIS = 1.08;

/**
 * 由当前缩放算 LOD 档位。
 *
 * @param scale 画布缩放
 * @param prev  上一档位（提供时启用迟滞；首次调用传 undefined）
 */
export function lodForScale(scale: number, prev?: CanvasLod): CanvasLod {
  if (!Number.isFinite(scale) || scale <= 0) return "full";
  if (prev === undefined) {
    if (scale >= LOD_DOWN.full) return "full";
    if (scale >= LOD_DOWN.compact) return "compact";
    return "block";
  }
  // 升档（画得更细）需要越过带迟滞的高阈值
  const upToFull = LOD_DOWN.full * HYSTERESIS;
  const upToCompact = LOD_DOWN.compact * HYSTERESIS;
  switch (prev) {
    case "block":
      if (scale >= upToFull) return "full";
      if (scale >= upToCompact) return "compact";
      return "block";
    case "compact":
      if (scale >= upToFull) return "full";
      if (scale < LOD_DOWN.compact) return "block";
      return "compact";
    case "full":
    default:
      if (scale < LOD_DOWN.compact) return "block";
      if (scale < LOD_DOWN.full) return "compact";
      return "full";
  }
}

/** 该档位是否绘制画像徽标行（符号数 / 引用数 / 技术债 …） */
export function lodShowsBadges(lod: CanvasLod): boolean {
  return lod === "full";
}

/** 该档位是否绘制任何文字 */
export function lodShowsText(lod: CanvasLod): boolean {
  return lod !== "block";
}

/**
 * 档位对应的「预计单实体 DOM 节点数」——仅用于日志/自检与基准断言，
 * 让性能回归在测试里看得见而不是靠感觉。
 */
export const LOD_NODE_BUDGET: Record<CanvasLod, number> = {
  full: 24,
  compact: 6,
  block: 3,
};
