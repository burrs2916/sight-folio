/**
 * 模块实体下钻：把画布上的一个「模块」实体展开成它内部的文件子图
 *
 * 为什么需要这个（用户原话：「画布中的实体是可以和我们的业务进行联动的，
 * 不只是一个简单的画像而已」）：
 *
 * 同步到画布后，模块实体只是一个"分组头"——它知道自己有多少文件，但用户点它
 * 只能看到高亮，没法真正走进去。真正的代码分析工具（Structure101 / CodeScene /
 * Sourcetrail）核心交互都是**下钻**：全局架构图 → 点某个模块 → 展开该模块的
 * 内部结构 → 再点某个文件 → 展开符号。层层深入，且每一层都带真实数据。
 *
 * 本模块提供第一层下钻：模块 → 模块内文件 + 模块内依赖连线。
 *
 * 设计要点：
 * 1. **不打乱既有布局**：子图放在当前画布内容包围盒的右侧空白区，展开多个模块
 *    时依次排开，可以横向对比两个模块的内部结构。
 * 2. **可逆**：所有生成实体带 `drillOwnerId`（发起下钻的模块实体 id），折叠时
 *    按此标记批量清除，不误伤用户手工摆的实体。
 * 3. **纯函数布局**：buildModuleDrillLayout 无 store 依赖，可单测。
 */

import type { ProjectDependency, ProjectFile } from "../../services/tauri";
import { symbolNamesForEdge, type SyncSymbolRef } from "./syncLayout";
import { fileNodeSize } from "./fileKind";
import { t } from "../../i18n";

export interface DrillNodeSpec {
  fileId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

export interface DrillEdgeSpec {
  fromFileId: string;
  toFileId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

export interface ModuleDrillLayout {
  /** 子图标题框（annotation 实体） */
  frame: { name: string; x: number; y: number; width: number; height: number; config: Record<string, unknown> };
  nodes: DrillNodeSpec[];
  edges: DrillEdgeSpec[];
  /** 子图整体包围盒（供展开后自动聚焦） */
  bounds: { x: number; y: number; width: number; height: number };
  summary: { files: number; edges: number; internalEdgeTotal: number; externalEdges: number };
}

// 与 fileNodeSize 的文件宽度对齐（FILE_NODE_W=180），保证网格列对齐；
// 图片节点更宽更高，由 fileNodeSize 逐节点取整，行高随之变化。
const NODE_W = 180;
const NODE_H = 66;
const GAP_X = 16;
const GAP_Y = 14;
const FRAME_PAD = 24;
const TITLE_H = 34;
/** 子图内连线上限：模块内部依赖也可能上百条，超过就不是图是毛线团 */
export const MAX_DRILL_EDGES = 80;

/** 网格列数：随文件数开方增长，让子图接近正方形，便于并排对比 */
export function drillColumns(fileCount: number): number {
  if (fileCount <= 1) return 1;
  return Math.max(2, Math.min(8, Math.ceil(Math.sqrt(fileCount))));
}

/**
 * 生成模块下钻子图布局。
 *
 * @param moduleName  模块名（顶层目录口径）
 * @param ownerId     发起下钻的模块实体 id（写进每个子实体 config.drillOwnerId）
 * @param origin      子图左上角画布坐标（调用方算好，通常是内容包围盒右侧）
 * @param files       模块内文件（调用方已按模块过滤，不含目录项）
 * @param deps        全量文件依赖（内部自行筛出「两端都在本模块」的边）
 * @param configFor   文件 → 画像 config（复用 fileInsights 口径）
 * @param symbolRefs  符号级引用（连线标注具体 import 符号）
 */
export function buildModuleDrillLayout(
  moduleName: string,
  ownerId: string,
  origin: { x: number; y: number },
  files: ProjectFile[],
  deps: ProjectDependency[],
  configFor: (f: ProjectFile) => Record<string, unknown>,
  symbolRefs?: SyncSymbolRef[]
): ModuleDrillLayout {
  const sorted = [...files]
    .filter((f) => !f.isDirectory)
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
  const cols = drillColumns(sorted.length);
  const rows = Math.max(1, Math.ceil(sorted.length / cols));

  const innerX = origin.x + FRAME_PAD;
  const innerY = origin.y + TITLE_H + FRAME_PAD;

  // 逐行最大高度（图片节点比文件高，行高随内容变化，避免重叠）
  const rowHeights: number[] = [];
  for (let r = 0; r < rows; r++) {
    let maxH = NODE_H;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < sorted.length) {
        const h = fileNodeSize(sorted[idx]).height;
        if (h > maxH) maxH = h;
      }
    }
    rowHeights.push(maxH);
  }
  const rowStartY: number[] = [];
  {
    let acc = innerY;
    for (let r = 0; r < rows; r++) {
      rowStartY.push(acc);
      acc += rowHeights[r] + GAP_Y;
    }
  }

  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  const nodes: DrillNodeSpec[] = sorted.map((f, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const size = fileNodeSize(f);
    const x = innerX + col * (NODE_W + GAP_X);
    const y = rowStartY[row];
    placed.set(f.id, { x, y, w: size.width, h: size.height });
    return {
      fileId: f.id,
      name: f.name,
      x,
      y,
      width: size.width,
      height: size.height,
      config: {
        ...configFor(f),
        fileId: f.id,
        fileName: f.name,
        filePath: f.relPath,
        drillOwnerId: ownerId,
        drillModule: moduleName,
        portraitMode: "drill",
      },
    };
  });

  const frameW = Math.max(NODE_W + FRAME_PAD * 2, cols * (NODE_W + GAP_X) - GAP_X + FRAME_PAD * 2);
  const frameH =
    TITLE_H + FRAME_PAD * 2 + (rows > 0 ? rowHeights.reduce((a, b) => a + b, 0) + GAP_Y * (rows - 1) : 0);

  // ─── 模块内部依赖边（两端都在本模块）+ 统计外部耦合度 ───
  const inModule = new Set(sorted.map((f) => f.id));
  const pairs = new Map<
    string,
    { from: string; to: string; weight: number; count: number; circular: boolean }
  >();
  let externalEdges = 0;
  for (const d of deps) {
    if (d.fromId === d.toId) continue;
    const fromIn = inModule.has(d.fromId);
    const toIn = inModule.has(d.toId);
    if (!fromIn && !toIn) continue;
    if (!fromIn || !toIn) {
      externalEdges += 1;
      continue;
    }
    const key = `${d.fromId}->${d.toId}`;
    const cur = pairs.get(key) || { from: d.fromId, to: d.toId, weight: 0, count: 0, circular: false };
    cur.weight += d.weight ?? 1;
    cur.count += 1;
    cur.circular = cur.circular || d.isCircular;
    pairs.set(key, cur);
  }

  const fileById = new Map(sorted.map((f) => [f.id, f]));
  const edges: DrillEdgeSpec[] = Array.from(pairs.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_DRILL_EDGES)
    .map((p) => {
      const a = placed.get(p.from)!;
      const b = placed.get(p.to)!;
      const absFromX = a.x + a.w / 2;
      const absFromY = a.y + a.h;
      const absToX = b.x + b.w / 2;
      const absToY = b.y;
      const minX = Math.min(absFromX, absToX);
      const minY = Math.min(absFromY, absToY);
      return {
        fromFileId: p.from,
        toFileId: p.to,
        name: `${fileById.get(p.from)?.name ?? p.from} → ${fileById.get(p.to)?.name ?? p.to}`,
        x: minX,
        y: minY,
        width: Math.max(4, Math.abs(absToX - absFromX) + 16),
        height: Math.max(4, Math.abs(absToY - absFromY) + 16),
        config: {
          depType: p.circular ? "circular" : "import",
          isCircular: p.circular,
          fromX: absFromX - minX,
          fromY: absFromY - minY,
          toX: absToX - minX,
          toY: absToY - minY,
          fromFileId: p.from,
          toFileId: p.to,
          fromMod: moduleName,
          toMod: moduleName,
          edgeCount: p.count,
          weight: p.weight,
          symbolNames: symbolNamesForEdge(symbolRefs, p.from, p.to),
          drillOwnerId: ownerId,
          drillModule: moduleName,
        },
      };
    });

  return {
    frame: {
      name: t("editor.drillFrameTitle", { name: moduleName }),
      x: origin.x,
      y: origin.y,
      width: frameW,
      height: frameH,
      config: {
        text: t("editor.drillFrameText", {
          name: moduleName,
          files: sorted.length,
          deps: pairs.size,
          ext: externalEdges,
        }),
        title: t("editor.drillFrameTitle", { name: moduleName }),
        variant: "frame",
        drillOwnerId: ownerId,
        drillModule: moduleName,
        drillFrame: true,
      },
    },
    nodes,
    edges,
    bounds: { x: origin.x, y: origin.y, width: frameW, height: frameH },
    summary: {
      files: sorted.length,
      edges: edges.length,
      internalEdgeTotal: pairs.size,
      externalEdges,
    },
  };
}

/**
 * 计算子图落点：放在现有内容包围盒右侧，避免与既有布局重叠。
 * items 为空时落在原点附近。
 */
export function drillOrigin(
  items: readonly { transform: { x: number; y: number; width: number; height: number } }[],
  gap = 200
): { x: number; y: number } {
  if (items.length === 0) return { x: 40, y: 40 };
  let maxX = -Infinity;
  let minY = Infinity;
  for (const it of items) {
    const right = it.transform.x + (it.transform.width || 0);
    if (right > maxX) maxX = right;
    if (it.transform.y < minY) minY = it.transform.y;
  }
  if (!isFinite(maxX)) return { x: 40, y: 40 };
  return { x: maxX + gap, y: isFinite(minY) ? minY : 40 };
}
