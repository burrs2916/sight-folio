/**
 * 「同步到画布」的纯布局引擎
 *
 * 职责：把扁平的文件扫描结果排布成画布网格（按顶层目录分组），
 * 并从 project_dependencies 中聚合出文件级依赖连线。
 * 全部为纯函数，无 store 依赖，可单测。
 *
 * 为什么独立成模块：
 * 1. 可测 —— 分组、坐标、边聚合、限量截断都能写单测；
 * 2. 可复用 —— 同步到画布 / 未来「按目录同步」都走同一套排布口径；
 * 3. 性能 —— 布局在 store 外算好，调用方一次性批量落库（见 addComponentsBulk）。
 */

import type { ProjectDependency, ProjectFile} from "../../services/tauri";
import { FILE_NODE_H, FILE_NODE_W, fileNodeSize } from "./fileKind";

/** 符号级引用（画布依赖连线标注符号名用）：只取关键字段，避免把整表引用带进纯函数 */
export interface SyncSymbolRef {
  fromFileId: string;
  toFileId: string;
  symbolName: string;
}

/** 画布上一个文件实体的完整描述（含 config，config 由调用方注入） */
export interface SyncNode {
  fileId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 调用方注入的画布画像 config（复杂度/技术债/引用等徽标数据） */
  config: Record<string, unknown>;
}

/** 画布上一条文件级依赖连线（dependency-edge 实体描述） */
export interface SyncEdge {
  /** 聚合后的源/目标文件 id（画布高亮联动用） */
  fromFileId: string;
  toFileId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

/** 符号级引用 → 每条依赖边引用的具体符号名集合（连线标注，去重保序，上限 12 防膨胀） */
export function symbolNamesForEdge(
  refs: SyncSymbolRef[] | undefined,
  fromId: string,
  toId: string
): string[] {
  if (!refs || refs.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    if (r.fromFileId !== fromId || r.toFileId !== toId) continue;
    if (!r.symbolName || !r.symbolName.trim()) continue;
    if (seen.has(r.symbolName)) continue;
    seen.add(r.symbolName);
    out.push(r.symbolName);
    if (out.length >= 12) break;
  }
  return out;
}

/** 画布上的模块分组头实体（module 实体描述，带 fileIds 供画布联动高亮） */
export interface SyncModule {
  /** 模块名（顶层目录名，全项目统一口径） */
  name: string;
  /** 模块下全部文件 id（画布选中模块 → 高亮模块内文件子图） */
  fileIds: string[];
  fileCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

export interface SyncLayout {
  nodes: SyncNode[];
  edges: SyncEdge[];
  /** 模块分组头实体（每个顶层目录一个） */
  modules: SyncModule[];
  summary: { groups: number; files: number; edges: number; edgeTotal: number };
}

// ─── 网格布局参数（与既有「同步到画布」口径保持一致）───
const COLS = 8;
const COL_W = 180;
const ROW_H = 70;
const HEADER_H = 40;
const GROUP_GAP = 60;

/** 单个文件实体默认尺寸（R38：高 60 → 66，容纳新增的目录路径行）
 *  口径来自 fileKind（图片实体另有一档更高的尺寸，见 fileNodeSize） */
export const FILE_W = FILE_NODE_W;
export const FILE_H = FILE_NODE_H;

/** 依赖连线数量上限：画布不是蜘蛛网，边太多反而看不清；按 weight 降序截断 */
export const MAX_EDGES = 120;

/** 顶层目录名（模块口径，全项目统一） */
function topDirOf(relPath: string): string {
  return relPath.includes("/") ? relPath.split("/")[0] : "root";
}

/**
 * 核心入口：生成「同步到画布」的完整布局。
 *
 * @param files   扫描到的全部文件（含目录项，目录不落画布）
 * @param deps    文件级依赖边（fromId/toId 为 project_files.id）
 * @param configFor 给定文件 → 画布 config（复杂度/徽标等画像数据由调用方从 fileInsights 取）
 * @returns 排布好的文件实体 + 聚合后的依赖连线
 */
export function buildSyncLayout(
  files: ProjectFile[],
  deps: ProjectDependency[],
  configFor: (f: ProjectFile) => Record<string, unknown>,
  symbolRefs?: SyncSymbolRef[]
): SyncLayout {
  const realFiles = files.filter((f) => !f.isDirectory);

  // ─── 1. 按顶层目录分组，网格排布 ───
  const groups = new Map<string, ProjectFile[]>();
  for (const f of realFiles) {
    const top = topDirOf(f.relPath);
    const arr = groups.get(top) || [];
    arr.push(f);
    groups.set(top, arr);
  }

  const nodes: SyncNode[] = [];
  const modules: SyncModule[] = [];
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  let groupIndex = 0;
  for (const [dir, groupFiles] of groups.entries()) {
    // 每行的行距按该行最高的实体决定 —— 图片实体比文件卡高一档（见 fileKind.fileNodeSize），
    // 固定 ROW_H 会让图片卡压到下一行上。
    const rowCount = Math.ceil(groupFiles.length / COLS);
    const rowPitch: number[] = [];
    for (let r = 0; r < rowCount; r++) {
      const rowFiles = groupFiles.slice(r * COLS, (r + 1) * COLS);
      const tallest = rowFiles.reduce((max, f) => Math.max(max, fileNodeSize(f).height), 0);
      rowPitch.push(Math.max(ROW_H, tallest + (ROW_H - FILE_H)));
    }
    /** 组内第 r 行相对组顶（HEADER_H 之后）的 y 偏移 */
    const rowOffset = (r: number) => rowPitch.slice(0, r).reduce((a, b) => a + b, 0);
    const groupH = HEADER_H + rowOffset(rowCount);
    // 模块分组头实体：占组内顶部 HEADER_H 区域，绑定模块内全部文件 id（画布选中 → 子图高亮）
    const modFileIds = groupFiles.map((f) => f.id);
    modules.push({
      name: dir,
      fileIds: modFileIds,
      fileCount: groupFiles.length,
      x: 40,
      y: 40 + groupIndex * (groupH + GROUP_GAP),
      width: COLS * COL_W,
      height: HEADER_H - 8,
      config: {
        moduleName: dir,
        name: dir,
        fileCount: groupFiles.length,
        fileIds: modFileIds,
        portraitMode: "sync",
      },
    });
    groupFiles.forEach((f, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = 40 + col * COL_W;
      const y = 40 + groupIndex * (groupH + GROUP_GAP) + HEADER_H + rowOffset(row);
      const config = { ...configFor(f), fileId: f.id, fileName: f.name, filePath: f.relPath };
      const { width, height } = fileNodeSize(f);
      nodes.push({ fileId: f.id, name: f.name, x, y, width, height, config });
      placed.set(f.id, { x, y, w: width, h: height });
    });
    groupIndex++;
  }

  // ─── 2. 文件级依赖边聚合（同一对文件只画一条，weight 累加）───
  const pairs = new Map<
    string,
    { from: string; to: string; weight: number; count: number; circular: boolean; kinds: Set<string> }
  >();
  for (const d of deps) {
    if (d.fromId === d.toId) continue;
    if (!placed.has(d.fromId) || !placed.has(d.toId)) continue;
    const key = `${d.fromId}->${d.toId}`;
    const cur = pairs.get(key) || {
      from: d.fromId,
      to: d.toId,
      weight: 0,
      count: 0,
      circular: false,
      kinds: new Set<string>(),
    };
    cur.weight += d.weight ?? 1;
    cur.count += 1;
    cur.circular = cur.circular || d.isCircular;
    if (d.kind) cur.kinds.add(d.kind);
    pairs.set(key, cur);
  }

  // 按 weight 降序截断，保留最重要的边
  const ranked = Array.from(pairs.values()).sort((a, b) => b.weight - a.weight).slice(0, MAX_EDGES);

  const edges: SyncEdge[] = [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  for (const p of ranked) {
    const a = placed.get(p.from)!;
    const b = placed.get(p.to)!;
    // 依赖边包围盒：从 A 右边缘中点 → B 左边缘中点
    const absFromX = a.x + a.w;
    const absFromY = a.y + a.h / 2;
    const absToX = b.x;
    const absToY = b.y + b.h / 2;
    const minX = Math.min(absFromX, absToX);
    const minY = Math.min(absFromY, absToY);
    const fromName = fileById.get(p.from)?.name ?? p.from;
    const toName = fileById.get(p.to)?.name ?? p.to;
    edges.push({
      fromFileId: p.from,
      toFileId: p.to,
      name: `${fromName} → ${toName}`,
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
        edgeCount: p.count,
        weight: p.weight,
        kinds: Array.from(p.kinds),
        // 符号级引用标注：该依赖边引用了哪些具体符号（import {A, B}），连线标签显示
        symbolNames: symbolNamesForEdge(symbolRefs, p.from, p.to),
      },
    });
  }

  return {
    nodes,
    edges,
    modules,
    summary: { groups: groups.size, files: nodes.length, edges: edges.length, edgeTotal: pairs.size },
  };
}

// ─── 树形布局（从左到右的层级路径图）───

/** 树形布局中的一个节点 */
export interface TreeNodeItem {
  /** 实体 id（file.id 或 directory.id） */
  id: string;
  /** 显示名 */
  name: string;
  /** 是否目录 */
  isDirectory: boolean;
  /** 相对路径 */
  relPath: string;
  /** 父节点 id */
  parentId: string | null;
  /** 原始文件数据（用于 configFor 回调） */
  raw: ProjectFile;
}

/** 树形布局输出：一个树节点 */
export interface TreeLayoutNode {
  id: string;
  name: string;
  isDirectory: boolean;
  relPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  config: Record<string, unknown>;
  /** 原始文件数据引用 */
  raw: ProjectFile;
}

/** 树形布局中的父子连线（结构边，非依赖边） */
export interface TreeLayoutEdge {
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface TreeLayout {
  nodes: TreeLayoutNode[];
  /** 结构边：父子连线（树形引导线） */
  structureEdges: TreeLayoutEdge[];
  /** 依赖边（与 buildSyncLayout 一致） */
  dependencyEdges: SyncEdge[];
  summary: { totalNodes: number; folders: number; files: number; depth: number; depEdges: number };
}

/** 树形布局参数（R38 放宽：用户反馈全览时图形「局促」，间距与卡片同时加大） */
const TREE_LEVEL_GAP = 300;   // 层级间水平间距（原 260）
const TREE_SIBLING_GAP = 28;  // 兄弟间垂直间距（原 14 —— 14px 让同级目录/文件贴在一起）
const TREE_PADDING_X = 80;    // 起始 x 偏移（原 60）
const TREE_PADDING_Y = 60;    // 起始 y 偏移（原 40）

/** 文件夹实体尺寸（原 200×80，加大给路径行与指标留空间） */
const FOLDER_W = 224;
const FOLDER_H = 88;

/**
 * 树形布局入口：将文件扫描结果排布为从左到右的层级树。
 *
 * 目录结构 → 树节点；文件 → 叶子节点；依赖 → 跨树连线。
 * 使用简化版 Reingold-Tilford 算法：
 *   1. 从 parentId 构建树
 *   2. 自底向上计算子树高度
 *   3. 自顶向下分配坐标
 */
export function buildTreeLayout(
  files: ProjectFile[],
  deps: ProjectDependency[],
  configFor: (f: ProjectFile) => Record<string, unknown>,
  symbolRefs?: SyncSymbolRef[]
): TreeLayout {
  if (files.length === 0) {
    return { nodes: [], structureEdges: [], dependencyEdges: [], summary: { totalNodes: 0, folders: 0, files: 0, depth: 0, depEdges: 0 } };
  }

  // ─── 1. 构建树结构 ───
  const fileMap = new Map<string, ProjectFile>();
  for (const f of files) fileMap.set(f.id, f);

  const childrenOf = new Map<string, ProjectFile[]>();
  const roots: ProjectFile[] = [];

  for (const f of files) {
    const pid = f.parentId;
    if (pid && fileMap.has(pid)) {
      const arr = childrenOf.get(pid) || [];
      arr.push(f);
      childrenOf.set(pid, arr);
    } else {
      roots.push(f);
    }
  }

  // 排序：目录在前，文件在后；同层按名称排序（视觉稳定）
  for (const [, children] of childrenOf) {
    children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  roots.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // ─── 2. 计算子树高度（自底向上）───
  const nodeHeight = new Map<string, number>(); // 子树占用的总高度

  /** 节点自身尺寸：目录固定，文件按种类（图片比代码文件高一档，见 fileKind） */
  const selfSize = (f: ProjectFile): { w: number; h: number } => {
    if (f.isDirectory) return { w: FOLDER_W, h: FOLDER_H };
    const { width, height } = fileNodeSize(f);
    return { w: width, h: height };
  };

  // ─── 3. 分配坐标（自顶向下）───
  const layoutNodes: TreeLayoutNode[] = [];
  const structureEdges: TreeLayoutEdge[] = [];
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  let maxDepth = 0;

  function assignPosition(f: ProjectFile, x: number, yStart: number, depth: number): void {
    const { w: selfW, h: selfH } = selfSize(f);
    const subH = nodeHeight.get(f.id) ?? selfH;

    // 节点垂直居中于其子树占用区域
    const y = yStart + (subH - selfH) / 2;

    const config = {
      ...configFor(f),
      ...(f.isDirectory
        ? { dirPath: f.relPath, name: f.name, childCount: (childrenOf.get(f.id) || []).length }
        : { fileId: f.id, fileName: f.name, filePath: f.relPath }),
    };

    layoutNodes.push({
      id: f.id,
      name: f.name,
      isDirectory: f.isDirectory,
      relPath: f.relPath,
      x,
      y,
      width: selfW,
      height: selfH,
      depth,
      config,
      raw: f,
    });
    placed.set(f.id, { x, y, w: selfW, h: selfH });
    if (depth > maxDepth) maxDepth = depth;

    // 递归子节点
    const children = childrenOf.get(f.id) || [];
    let childY = yStart;
    const childX = x + selfW + TREE_LEVEL_GAP;

    for (const child of children) {
      const childSelfH = selfSize(child).h;
      const childSubH = nodeHeight.get(child.id) ?? childSelfH;
      assignPosition(child, childX, childY, depth + 1);

      // 结构边：从父右边缘中点 → 子左边缘中点（toY 在第 4 步按实际落位回填）
      structureEdges.push({
        fromId: f.id,
        toId: child.id,
        fromX: x + selfW,
        fromY: y + selfH / 2,
        toX: childX,
        toY: childY + (childSubH - childSelfH) / 2 + childSelfH / 2,
      });

      childY += childSubH + TREE_SIBLING_GAP;
    }
  }

  // 从根开始布局
  let rootY = TREE_PADDING_Y;
  for (const root of roots) {
    const rootSubH = nodeHeight.get(root.id) ?? selfSize(root).h;
    assignPosition(root, TREE_PADDING_X, rootY, 0);
    rootY += rootSubH + TREE_SIBLING_GAP;
  }

  // ─── 4. 修正结构边的 toY（上面计算时子节点位置还未完全确定，现在回填）───
  for (const edge of structureEdges) {
    const toNode = placed.get(edge.toId);
    const fromNode = placed.get(edge.fromId);
    if (toNode && fromNode) {
      edge.fromY = fromNode.y + fromNode.h / 2;
      edge.toY = toNode.y + toNode.h / 2;
    }
  }

  // ─── 5. 依赖边（与 buildSyncLayout 逻辑一致）───
  const depEdges = buildDependencyEdges(deps, placed, files, symbolRefs);

  const folderCount = layoutNodes.filter((n) => n.isDirectory).length;
  return {
    nodes: layoutNodes,
    structureEdges,
    dependencyEdges: depEdges,
    summary: {
      totalNodes: layoutNodes.length,
      folders: folderCount,
      files: layoutNodes.length - folderCount,
      depth: maxDepth + 1,
      depEdges: depEdges.length,
    },
  };
}

/** 依赖边聚合（提取为公共函数，树形/网格布局共用） */
function buildDependencyEdges(
  deps: ProjectDependency[],
  placed: Map<string, { x: number; y: number; w: number; h: number }>,
  files: ProjectFile[],
  symbolRefs?: SyncSymbolRef[]
): SyncEdge[] {
  const pairs = new Map<
    string,
    { from: string; to: string; weight: number; count: number; circular: boolean; kinds: Set<string> }
  >();
  for (const d of deps) {
    if (d.fromId === d.toId) continue;
    if (!placed.has(d.fromId) || !placed.has(d.toId)) continue;
    const key = `${d.fromId}->${d.toId}`;
    const cur = pairs.get(key) || {
      from: d.fromId,
      to: d.toId,
      weight: 0,
      count: 0,
      circular: false,
      kinds: new Set<string>(),
    };
    cur.weight += d.weight ?? 1;
    cur.count += 1;
    cur.circular = cur.circular || d.isCircular;
    if (d.kind) cur.kinds.add(d.kind);
    pairs.set(key, cur);
  }

  const ranked = Array.from(pairs.values()).sort((a, b) => b.weight - a.weight).slice(0, MAX_EDGES);
  const fileById = new Map(files.map((f) => [f.id, f]));
  const edges: SyncEdge[] = [];

  for (const p of ranked) {
    const a = placed.get(p.from)!;
    const b = placed.get(p.to)!;
    const absFromX = a.x + a.w;
    const absFromY = a.y + a.h / 2;
    const absToX = b.x;
    const absToY = b.y + b.h / 2;
    const minX = Math.min(absFromX, absToX);
    const minY = Math.min(absFromY, absToY);
    const fromName = fileById.get(p.from)?.name ?? p.from;
    const toName = fileById.get(p.to)?.name ?? p.to;
    edges.push({
      fromFileId: p.from,
      toFileId: p.to,
      name: `${fromName} → ${toName}`,
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
        edgeCount: p.count,
        weight: p.weight,
        kinds: Array.from(p.kinds),
        symbolNames: symbolNamesForEdge(symbolRefs, p.from, p.to),
      },
    });
  }

  return edges;
}
