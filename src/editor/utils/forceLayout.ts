/**
 * 力导向布局引擎（确定性 Fruchterman-Reingold，纯函数可测）
 *
 * 之前依赖画像用「按依赖深度分列」、调用链画像用「同心环」——
 * 这两种固定布局在节点一多的时候都会退化：同一列挤 30 个文件、连线全部横穿画布，
 * 看不出任何聚类结构。真实的模块聚簇（哪几个文件总是互相调用）根本显示不出来。
 *
 * 力导向布局把依赖边当弹簧、节点之间当同极磁铁：
 * - 有依赖关系的节点被拉近 → 天然形成「模块簇」
 * - 无关节点互相推开 → 稀疏区域自动留白
 *
 * 关键约束：**必须确定性**。画布是要持久化的，同一份分析数据每次画像必须落在
 * 同样的位置，否则用户每次刷新都看到不一样的图，也没法和上次截图对照。
 * 所以初始位置不用 Math.random()，而是用节点 id 哈希喂进 LCG 伪随机，
 * 同样输入必然同样输出。
 */

export interface ForceNode {
  id: string;
  /** 权重：度数越高的节点质量越大，越不容易被推走（默认 1） */
  weight?: number;
  /** 节点尺寸，用于最后的防重叠（默认取 options 里的全局值） */
  width?: number;
  height?: number;
}

export interface ForceEdge {
  from: string;
  to: string;
  /** 边权：耦合越强弹簧越硬（默认 1） */
  weight?: number;
}

export interface ForceLayoutOptions {
  /** 布局区域尺寸 */
  width?: number;
  height?: number;
  /** 迭代次数，越多越收敛也越慢（默认 260） */
  iterations?: number;
  /** 伪随机种子，改种子换一种布局形态 */
  seed?: number;
  /** 节点默认宽高（防重叠用） */
  nodeWidth?: number;
  nodeHeight?: number;
  /** 输出坐标的左上角偏移 */
  originX?: number;
  originY?: number;
  /** 防重叠迭代轮数（0 = 关闭） */
  separationPasses?: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface ForceLayoutResult {
  positions: Map<string, LayoutPoint>;
  /** 布局后实际占用的包围盒（已含偏移），供调用方居中/缩放 */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** 32 位字符串哈希（FNV-1a），用于把节点 id 变成确定的初始位置 */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 线性同余伪随机：给定种子必然产生同一串数，保证布局可复现 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * 计算力导向布局
 *
 * 返回的是节点**左上角**坐标（画布实体的 transform 用左上角定位），
 * 内部计算过程用的是中心点，最后统一换算。
 */
export function forceDirectedLayout(
  nodes: ForceNode[],
  edges: ForceEdge[],
  options: ForceLayoutOptions = {}
): ForceLayoutResult {
  const width = options.width ?? 1600;
  const height = options.height ?? 1000;
  const iterations = options.iterations ?? 260;
  const seed = options.seed ?? 20260801;
  const nodeW = options.nodeWidth ?? 170;
  const nodeH = options.nodeHeight ?? 64;
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const separationPasses = options.separationPasses ?? 24;

  const positions = new Map<string, LayoutPoint>();
  if (nodes.length === 0) {
    return { positions, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }
  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: originX, y: originY });
    return {
      positions,
      bounds: { minX: originX, minY: originY, maxX: originX + nodeW, maxY: originY + nodeH },
    };
  }

  const idx = new Map<string, number>();
  nodes.forEach((n, i) => idx.set(n.id, i));

  // ── 初始位置：以节点 id 哈希为种子的确定性散布（黄金角螺旋 + 微扰）──
  const rand = makeRandom(seed);
  const px = new Float64Array(nodes.length);
  const py = new Float64Array(nodes.length);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  nodes.forEach((n, i) => {
    const jitter = (hashId(n.id) % 1000) / 1000;
    const r = (Math.sqrt((i + 0.5) / nodes.length) * Math.min(width, height)) / 2;
    const angle = i * GOLDEN + jitter * 0.6;
    px[i] = width / 2 + r * Math.cos(angle) + (rand() - 0.5) * 12;
    py[i] = height / 2 + r * Math.sin(angle) * 0.7 + (rand() - 0.5) * 12;
  });

  // 质量：度数越大越重（重节点在斥力下移动更小，形成稳定核心）
  const mass = new Float64Array(nodes.length);
  nodes.forEach((n, i) => {
    mass[i] = Math.max(1, n.weight ?? 1);
  });
  for (const e of edges) {
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    mass[a] += 0.35;
    mass[b] += 0.35;
  }

  // 理想边长 k：面积均分给每个节点后的半径
  const k = Math.sqrt((width * height) / nodes.length) * 0.72;
  const dx = new Float64Array(nodes.length);
  const dy = new Float64Array(nodes.length);
  let temperature = Math.min(width, height) / 6;
  const cooling = temperature / (iterations + 1);

  const validEdges = edges
    .map((e) => ({ a: idx.get(e.from), b: idx.get(e.to), w: Math.max(0.2, e.weight ?? 1) }))
    .filter((e): e is { a: number; b: number; w: number } => {
      return e.a !== undefined && e.b !== undefined && e.a !== e.b;
    });

  for (let it = 0; it < iterations; it += 1) {
    dx.fill(0);
    dy.fill(0);

    // 斥力：所有节点两两相斥 f = k²/d
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        let vx = px[i] - px[j];
        let vy = py[i] - py[j];
        let dist = Math.hypot(vx, vy);
        if (dist < 0.01) {
          // 完全重合时按索引给一个确定的分离方向，避免除零和随机抖动
          vx = ((i % 7) - 3) * 0.1 + 0.05;
          vy = ((j % 5) - 2) * 0.1 + 0.05;
          dist = Math.hypot(vx, vy);
        }
        const force = (k * k) / dist;
        const ux = (vx / dist) * force;
        const uy = (vy / dist) * force;
        dx[i] += ux;
        dy[i] += uy;
        dx[j] -= ux;
        dy[j] -= uy;
      }
    }

    // 引力：有边相连的节点相吸 f = d²/k（乘边权）
    for (const e of validEdges) {
      const vx = px[e.a] - px[e.b];
      const vy = py[e.a] - py[e.b];
      const dist = Math.max(0.01, Math.hypot(vx, vy));
      const force = ((dist * dist) / k) * e.w;
      const ux = (vx / dist) * force;
      const uy = (vy / dist) * force;
      dx[e.a] -= ux;
      dy[e.a] -= uy;
      dx[e.b] += ux;
      dy[e.b] += uy;
    }

    // 弱重力：把飘散的孤立节点拉回中心，否则画布会被空白撑爆
    for (let i = 0; i < nodes.length; i += 1) {
      dx[i] += (width / 2 - px[i]) * 0.012;
      dy[i] += (height / 2 - py[i]) * 0.012;
    }

    // 位移：受温度上限约束，随迭代退火
    for (let i = 0; i < nodes.length; i += 1) {
      const disp = Math.hypot(dx[i], dy[i]);
      if (disp < 1e-9) continue;
      const limited = Math.min(disp, temperature) / mass[i];
      px[i] += (dx[i] / disp) * limited;
      py[i] += (dy[i] / disp) * limited;
    }
    temperature = Math.max(0.5, temperature - cooling);
  }

  // ── 防重叠：力导向不保证矩形不相交，最后做几轮矩形分离 ──
  const w = nodes.map((n) => n.width ?? nodeW);
  const h = nodes.map((n) => n.height ?? nodeH);
  const GAP_X = 26;
  const GAP_Y = 18;
  for (let pass = 0; pass < separationPasses; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const needX = (w[i] + w[j]) / 2 + GAP_X;
        const needY = (h[i] + h[j]) / 2 + GAP_Y;
        const diffX = px[i] - px[j];
        const diffY = py[i] - py[j];
        const overlapX = needX - Math.abs(diffX);
        const overlapY = needY - Math.abs(diffY);
        if (overlapX <= 0 || overlapY <= 0) continue;
        // 沿重叠更少的轴分离，形状扰动最小
        if (overlapX / needX < overlapY / needY) {
          const shift = (overlapX / 2) * (diffX >= 0 ? 1 : -1);
          px[i] += shift;
          px[j] -= shift;
        } else {
          const shift = (overlapY / 2) * (diffY >= 0 ? 1 : -1);
          py[i] += shift;
          py[j] -= shift;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  // ── 归一化到 origin 起点，输出左上角坐标 ──
  let minCX = Infinity;
  let minCY = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    minCX = Math.min(minCX, px[i] - w[i] / 2);
    minCY = Math.min(minCY, py[i] - h[i] / 2);
  }
  const offX = originX - minCX;
  const offY = originY - minCY;

  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((n, i) => {
    const x = Math.round(px[i] - w[i] / 2 + offX);
    const y = Math.round(py[i] - h[i] / 2 + offY);
    positions.set(n.id, { x, y });
    maxX = Math.max(maxX, x + w[i]);
    maxY = Math.max(maxY, y + h[i]);
  });

  return {
    positions,
    bounds: { minX: originX, minY: originY, maxX, maxY },
  };
}

/**
 * 矩形防重叠（保持语义坐标尽量不动）
 *
 * 用于「坐标本身有含义」的图 —— 比如主序图的 X = 不稳定性、Y = 抽象度，
 * 节点不能随便挪位置，只能在重叠时做最小幅度的推挤。
 * 与力导向内部那一轮分离的区别是：这里每轮位移都乘一个衰减系数，
 * 优先沿重叠更浅的轴推开，尽量保住原始语义位置。
 */
export function separateOverlaps(
  items: { id: string; x: number; y: number; width: number; height: number }[],
  passes = 40,
  gapX = 18,
  gapY = 12
): Map<string, LayoutPoint> {
  const n = items.length;
  const cx = items.map((it) => it.x + it.width / 2);
  const cy = items.map((it) => it.y + it.height / 2);

  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    const damp = 0.5 + 0.5 * (1 - pass / passes);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const needX = (items[i].width + items[j].width) / 2 + gapX;
        const needY = (items[i].height + items[j].height) / 2 + gapY;
        const diffX = cx[i] - cx[j];
        const diffY = cy[i] - cy[j];
        const overlapX = needX - Math.abs(diffX);
        const overlapY = needY - Math.abs(diffY);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX / needX < overlapY / needY) {
          const dir = diffX === 0 ? (i % 2 === 0 ? 1 : -1) : diffX > 0 ? 1 : -1;
          const shift = (overlapX / 2) * dir * damp;
          cx[i] += shift;
          cx[j] -= shift;
        } else {
          const dir = diffY === 0 ? (i % 2 === 0 ? 1 : -1) : diffY > 0 ? 1 : -1;
          const shift = (overlapY / 2) * dir * damp;
          cy[i] += shift;
          cy[j] -= shift;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  const out = new Map<string, LayoutPoint>();
  items.forEach((it, i) => {
    out.set(it.id, {
      x: Math.round(cx[i] - it.width / 2),
      y: Math.round(cy[i] - it.height / 2),
    });
  });
  return out;
}

/**
 * 从边集推导每个节点的度数（力导向的 weight 输入）
 * 度数高 = 枢纽节点，布局时应该更稳
 */
export function degreeMap(edges: { from: string; to: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    m.set(e.from, (m.get(e.from) ?? 0) + 1);
    m.set(e.to, (m.get(e.to) ?? 0) + 1);
  }
  return m;
}

/**
 * v2.17 拓扑分层布局（依赖画像「分层模式」）：
 * 按拓扑深度把节点排成若干列 —— 入口（depth=0）在左、底座（最大 depth）在右，
 * 依赖方向从左向右流过画布。与力导向「聚簇模式」互补：
 * 聚簇回答「哪些文件互相依赖」（模块边界），分层回答「架构分层是否干净、依赖方向」。
 *
 * 环内节点拓扑深度相同（都在最后一层），会聚到同一列 —— 红虚线回流正是
 * 「这里有环」的最直观表达，刻意保留。
 *
 * 列内顺序：度数降序（枢纽优先置顶）；画布尺寸随最大列节点数扩展，不挤。
 */
export interface LayeredLayoutOptions {
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  originX?: number;
  originY?: number;
  layerGap?: number; // 列间距
  nodeGap?: number;  // 列内行间距
  /**
   * 单层最多多少行；超出则**层内横向分列**（同一 depth 占连续的若干子列）。
   *
   * 为什么需要（执行流画像实测根因）：分层布局原本每层只是一根垂直单列，
   * 层数少而单层节点多时（执行流 depth=0 曾堆到 104 个），该列纵向会远超画布
   * 高度，fit 视口后整图缩成一条线，看起来就是「画不出来」。
   *
   * 0（默认）= 不分列，与历史行为完全一致（依赖画像等既有调用方零回归）。
   */
  maxRowsPerLayer?: number;
  /** 层内子列之间的间距，缺省取 layerGap 的一半 */
  subColGap?: number;
}

export function layeredLayout(
  nodes: { id: string; weight?: number }[],
  depthMap: Map<string, number>,
  options: LayeredLayoutOptions
): Map<string, LayoutPoint> {
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const layerGap = options.layerGap ?? 120;
  const nodeGap = options.nodeGap ?? 10;

  // 按深度分桶（depth 缺失 → 归入最后一层）
  const maxDepth = Math.max(0, ...Array.from(depthMap.values()));
  const byLayer = new Map<number, { id: string; weight?: number }[]>();
  for (const n of nodes) {
    const d = Math.min(depthMap.get(n.id) ?? maxDepth, maxDepth);
    const arr = byLayer.get(d) ?? [];
    arr.push(n);
    byLayer.set(d, arr);
  }
  // 层内按度数降序（枢纽置顶）
  for (const arr of byLayer.values()) {
    arr.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }

  const colW = options.nodeWidth + 24;
  const out = new Map<string, LayoutPoint>();

  // ── 层内分列（可选）：单层节点数超阈值时横向摊开，避免纵向溢出画布 ──
  // 同一 depth 会占用连续的若干子列，列偏移按前面各层实际占用的子列数累加，
  // 故不同 depth 之间仍保持「左→右」的层次顺序，不会被子列挤乱。
  const maxRows = options.maxRowsPerLayer && options.maxRowsPerLayer > 0
    ? Math.floor(options.maxRowsPerLayer)
    : 0;
  const subGap = options.subColGap ?? Math.round((layerGap || 120) / 2);

  // 先统计每层子列数，算出各层的起始 x 偏移。
  // 注意：byLayer 的迭代顺序是**插入顺序**（取决于 nodes 顺序）而非 depth 序，
  // 直接边遍历边累加会把列偏移算到错误的层上 → 必须按 depth 升序排定后再累加。
  const sortedLayers = Array.from(byLayer.entries()).sort((a, b) => a[0] - b[0]);
  const layerStartX = new Map<number, number>();
  let cursor = originX;
  for (const [d, arr] of sortedLayers) {
    layerStartX.set(d, cursor);
    const subCols = maxRows > 0 ? Math.max(1, Math.ceil(arr.length / maxRows)) : 1;
    cursor += subCols * colW + (subCols - 1) * subGap + layerGap;
  }

  for (const [d, arr] of sortedLayers) {
    const x0 = layerStartX.get(d) ?? originX;
    const subCols = maxRows > 0 ? Math.max(1, Math.ceil(arr.length / maxRows)) : 1;
    // 层高按**单个子列**的节点数计算（分列后不再按整层节点数撑高）
    const rowsPerCol = Math.ceil(arr.length / subCols);
    const layerH = Math.max(1, rowsPerCol) * (options.nodeHeight + nodeGap) - nodeGap;
    let y = originY;
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      const x = maxRows > 0 ? x0 + Math.floor(i / maxRows) * (colW + subGap) : x0;
      out.set(n.id, {
        x: Math.round(x),
        y: Math.round(y + layerH * 0.1), // 层内微下沉，视觉上列之间留呼吸
      });
      y += options.nodeHeight + nodeGap;
      // 换子列时 y 归位（从该层顶部重新往下排）
      if (maxRows > 0 && (i + 1) % maxRows === 0) y = originY;
    }
  }
  return out;
}
