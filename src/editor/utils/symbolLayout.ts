/**
 * 「代码结构画像」的纯布局引擎（v2：目录横带 + 缩进树）
 *
 * v1 只把符号按「文件」平铺成 8 列一行的网格 —— 本质上是一张符号清单，
 * 看不出任何结构关系。v2 改为按「目录（模块）」组织：
 *
 *   每个目录 = 一条横带（宽头标 + 下属文件/符号整体缩进）
 *   目录内按文件分子带（文件头标）
 *   文件内符号排成网格，整体相对目录再缩进一级
 *
 * 这样画布上读起来就是一棵「模块 → 文件 → 符号」的结构树，而非一张表。
 * 另：每个符号按外部引用数（refCount）归一化成 centrality 0..1，
 * 渲染器据此在卡片上点出「承重」强度（引用越多越红）——
 * 一眼能看出哪些符号是结构上的关键节点。
 *
 * 业务联动：每个符号实体的 config 都带 fileId + lineStart —— 画布选中符号
 * 实体时，「所属文件 + 该文件的依赖邻居」自动高亮；双击符号实体直接打开源码。
 */

import type { ProjectFile, ProjectSymbol, ProjectSymbolRef } from "../../services/tauri";
import { topDirOf } from "./architectureMetrics";

/** 画布上一个符号级实体的完整描述 */
export interface SymbolNode {
  /** 符号在 project_symbols 中的主键（调用连线 / 影响面画像按它对齐） */
  symbolId: string;
  /** 画布实体类型：class / function / interface / module（其它 kind 归并） */
  entityType: string;
  /** 符号名 */
  name: string;
  /** 符号原始 kind（class/function/struct/... 后端提取口径） */
  symbolKind: string;
  fileId: string;
  fileName: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  /** 被引用次数（跨文件 import 到该符号的计数，0 表示无引用） */
  refCount: number;
  /** 外部依赖度 0..1（refCount 归一化），用于承重着色 */
  centrality: number;
  /** centrality 对应的热力色（绿→橙→红，引用越多越红） */
  centralityColor: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画布上的分组头标（layer-marker 实体）：目录横带头 / 文件子带头 */
export interface SymbolGroupHeader {
  /** 显示名（v2.12：目录取最后一段 `app`，不再整段路径；文件取文件名） */
  name: string;
  /** 层级：dir=目录横带，file=文件子带 */
  level: "dir" | "file";
  /** 颜色（dir 用天蓝、file 用石板灰，区分两级） */
  color: string;
  /** 组内符号数（v2.12 目录=子树全量含子目录；用于头标副标题） */
  symbolCount: number;
  /** 组内实际渲染到画布的符号数（受上限截断，可能小于 symbolCount） */
  renderedCount: number;
  /** file 级组的文件 id（内聚度徽标按它查表） */
  fileId?: string;
  /** v2.12 完整路径（dir=完整目录路径；file=文件相对路径，副行/tooltip 用） */
  path?: string;
  /** v2.12 dir 的顶层目录名（模块依赖徽标/环匹配用，与 topDirOf 同口径） */
  topDir?: string;
  /** v2.12 目录层级深度（0=顶层），画布横带按 depth 缩进 */
  depth?: number;
  /** v2.12 目录是否有子目录（中间节点无 ownFiles，仅作层级横带） */
  hasChildren?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SymbolLayout {
  groups: SymbolGroupHeader[];
  nodes: SymbolNode[];
  summary: {
    files: number;
    symbols: number;
    rendered: number;
    /** 因上限截断未渲染的符号数 */
    truncated: number;
    byKind: Record<string, number>;
    /** 参与展示的目录数 */
    dirs: number;
    /** 目录（模块）→ 目录的调用聚合（全量 callEdges，不受画布截断影响） */
    moduleDeps: ModuleDepEdge[];
    /** 调用环上的符号 id（Tarjan SCC size>1；环上符号渲染红色描边） */
    cycleSymbolIds: Set<string>;
    /** 环上符号所属的顶层目录（去重；对应目录横带标红） */
    cycleDirs: string[];
    /** 逐环分组（每个环的符号 id 列表），供「先破哪个环」处方 */
    cycles: string[][];
    /** 枢纽符号 id（fan-in 前 N，承重墙） */
    hubSymbolIds: string[];
  };
}

/** 目录（模块）级调用聚合：A 目录的符号调用了 B 目录的符号 */
export interface ModuleDepEdge {
  fromDir: string;
  toDir: string;
  /** 聚合调用次数 */
  count: number;
  /** 是否存在跨文件调用（同一对目录内任意跨文件调用即置真） */
  crossFile: boolean;
}

/**
 * 目录（模块）级调用聚合（全量 callEdges，不随画布截断）。
 * 回答「模块之间到底谁依赖谁、依赖多重」——这是结构画像从「符号清单」
 * 升级为「架构图」的第一块基石。
 * 模块 = 顶层目录（与 ModuleRenderer / architectureMetrics.topDirOf 同口径）。
 */
export function buildModuleDeps(edges: CallEdgeInput[], files: ProjectFile[]): ModuleDepEdge[] {
  if (edges.length === 0) return [];
  const fileById = new Map(files.map((f) => [f.id, f]));
  const pairs = new Map<string, { fromDir: string; toDir: string; count: number; crossFile: boolean }>();
  for (const e of edges) {
    const fromFile = fileById.get(e.callerFileId ?? "");
    const toFile = fileById.get(e.calleeFileId ?? "");
    if (!fromFile || !toFile) continue;
    const fromDir = topDirOf(fromFile.relPath);
    const toDir = topDirOf(toFile.relPath);
    if (fromDir === toDir) continue; // 模块内部调用不聚合（那是符号级边的事）
    const key = `${fromDir}\u0000${toDir}`;
    const cur = pairs.get(key) || { fromDir, toDir, count: 0, crossFile: false };
    cur.count += 1;
    cur.crossFile = cur.crossFile || e.kind === "cross-file";
    pairs.set(key, cur);
  }
  return Array.from(pairs.values()).sort((a, b) => b.count - a.count);
}

/** 目录级出/入依赖计数（横带徽标用）：Map<dir, {out, in}> */
export function summarizeModuleDeps(deps: ModuleDepEdge[]): Map<string, { out: number; in: number }> {
  const m = new Map<string, { out: number; in: number }>();
  for (const d of deps) {
    const a = m.get(d.fromDir) || { out: 0, in: 0 };
    a.out += d.count;
    m.set(d.fromDir, a);
    const b = m.get(d.toDir) || { out: 0, in: 0 };
    b.in += d.count;
    m.set(d.toDir, b);
  }
  return m;
}

/**
 * 调用环检测：在「画布符号子图」上做 Tarjan SCC（size>1 才算环）。
 * 限制在画布子图上：环上符号必然有实体可渲染红描边，且节点数 ≤ 数百，
 * 递归 DFS 无爆栈风险。返回环上符号 id 集合 + 环上符号所属顶层目录。
 */
export function detectSymbolCycles(nodes: SymbolNode[], edges: CallEdgeInput[]): {
  cycleSymbolIds: Set<string>;
  cycleDirs: string[];
  /** 逐环分组（每个 size>1 的 SCC 的符号 id 列表），供「先破哪个环」处方 */
  cycles: string[][];
} {
  const nodeById = new Map(nodes.map((n) => [n.symbolId, n]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.callerSymbolId || !e.calleeSymbolId) continue;
    if (e.callerSymbolId === e.calleeSymbolId) continue; // 自环不参与结构环
    if (!nodeById.has(e.callerSymbolId) || !nodeById.has(e.calleeSymbolId)) continue;
    const list = adj.get(e.callerSymbolId);
    if (list) list.push(e.calleeSymbolId);
    else adj.set(e.callerSymbolId, [e.calleeSymbolId]);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycleSymbols = new Set<string>();
  const cycles: string[][] = [];
  let counter = 0;

  const strongconnect = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) {
        for (const id of comp) cycleSymbols.add(id);
        cycles.push(comp);
      }
    }
  };

  for (const n of nodes) {
    if (!index.has(n.symbolId)) strongconnect(n.symbolId);
  }

  const cycleDirs = new Set<string>();
  for (const id of cycleSymbols) {
    const n = nodeById.get(id);
    if (n) cycleDirs.add(topDirOf(n.filePath));
  }
  return { cycleSymbolIds: cycleSymbols, cycleDirs: Array.from(cycleDirs), cycles };
}

/** 枢纽符号筛选：fan-in（refCount）前 N 且 >0 的符号 id（承重墙，系统里被依赖最多的节点） */
export function pickHubSymbols(nodes: SymbolNode[], max: number = 10): string[] {
  return nodes
    .filter((n) => n.refCount > 0)
    .sort((a, b) => b.refCount - a.refCount)
    .slice(0, max)
    .map((n) => n.symbolId);
}

/** 画布上一条继承连线（dependency-edge 实体描述，depType="inherits"） */
export interface InheritanceEdge {
  fromSymbolId: string;
  toSymbolId: string;
  name: string;
  /** extends | implements */
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

/**
 * 继承连线（v2.2）：把 symbol_refs 里 kind=inherits/implements 的关系画成
 * 子类 → 父类的 UML 式连线。两端符号都在画布上时才画：
 * - from = 声明行匹配（fromFilePath + refLine === 符号 lineStart）
 * - to   = toSymbolId 命中，或按父类名在画布符号里取 refCount 最高的同名节点
 */
export function buildInheritanceEdges(nodes: SymbolNode[], refs: ProjectSymbolRef[]): InheritanceEdge[] {
  if (nodes.length === 0 || refs.length === 0) return [];
  const nodeById = new Map(nodes.map((n) => [n.symbolId, n]));
  const nodeByFileLine = new Map(nodes.map((n) => [`${n.filePath}\u0000${n.lineStart}`, n]));
  const nodeByName = new Map<string, SymbolNode>();
  for (const n of nodes) {
    const cur = nodeByName.get(n.name);
    if (!cur || n.refCount > cur.refCount) nodeByName.set(n.name, n);
  }

  const edges: InheritanceEdge[] = [];
  for (const r of refs) {
    // 后端落库口径：kind = "extends" | "implements"（见 code_structure.rs parse_inheritance）
    if (r.kind !== "extends" && r.kind !== "implements") continue;
    const from = nodeByFileLine.get(`${r.fromFilePath}\u0000${r.refLine}`);
    if (!from) continue;
    const to =
      (r.toSymbolId && nodeById.get(r.toSymbolId)) ||
      (r.symbolName ? nodeByName.get(r.symbolName) : undefined);
    if (!to || to.symbolId === from.symbolId) continue;

    // 继承方向：子类底边中点 → 父类顶边中点
    const absFromX = from.x + from.width / 2;
    const absFromY = from.y + from.height;
    const absToX = to.x + to.width / 2;
    const absToY = to.y;
    const minX = Math.min(absFromX, absToX);
    const minY = Math.min(absFromY, absToY);
    edges.push({
      fromSymbolId: from.symbolId,
      toSymbolId: to.symbolId,
      name: `${from.name} ${r.kind === "implements" ? "implements" : "extends"} ${to.name}`,
      kind: r.kind,
      x: minX,
      y: minY,
      width: Math.max(4, Math.abs(absToX - absFromX) + 16),
      height: Math.max(4, Math.abs(absToY - absFromY) + 16),
      config: {
        depType: "inherits",
        fromX: absFromX - minX,
        fromY: absFromY - minY,
        toX: absToX - minX,
        toY: absToY - minY,
        fromFileId: from.fileId,
        toFileId: to.fileId,
        fromSymbolId: from.symbolId,
        toSymbolId: to.symbolId,
        symbolNames: [to.name],
        kind: r.kind,
        portraitMode: "symbols",
      },
    });
  }
  return edges;
}

// ─── 布局参数 ───
// v2.12 规模预算：画布符号画像默认容量。行距 104（卡 96 高，缝 8px+）
// 之前 ROW_H=92 缝只有 8px，fit 全览 clamp 0.2 后缝 1.6px = 卡贴卡「重叠感」。
// 规模同时压缩（目录/文件/符号上限），fit 后整体不糊成一团。
export const MAX_DIRS = 10; // 符号最多的前 N 个顶层目录（模块）
export const MAX_FILES_PER_DIR = 4; // 每个目录最多展示 N 个文件
export const MAX_SYMBOLS_PER_FILE = 6; // 每个文件最多渲染 N 个符号
export const COL_W = 150;
export const COL_PER_ROW = 8; // 一行符号最多 8 个
export const ROW_H = 104;
// v2.12 目录层级树 + 双行横带：主行名 + 副行路径/统计
export const DIR_HEADER_H = 30;
export const FILE_HEADER_H = 24;
export const LEFT = 40;
export const TOP = 40;
export const FILE_INDENT = 16; // 文件子带相对目录横带缩进
export const SYM_INDENT = 30; // 符号相对文件子带再缩进
export const DIR_INDENT = 20; // 每级目录横带再缩进（层级树）
export const MAX_DIR_CHILDREN = 3; // 每个目录最多展开 N 个子目录
export const MAX_DIR_BANDS = 14; // 总目录横带上限（含子目录）
const DIR_COLOR = "#38bdf8"; // 天蓝：目录横带
const FILE_COLOR = "#64748b"; // 石板灰（v2.12 深一档：slate-500 替换 slate-400 #94a3b8，横带文字/色条可读性）

/** 引用热度 → 颜色：0 绿（叶子）→ 0.5 橙 → 1 红（承重节点） */
export function centralityColor(c: number): string {
  if (c >= 0.66) return "#ef4444";
  if (c >= 0.33) return "#f59e0b";
  if (c > 0) return "#22c55e";
  return "#64748b";
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** 符号 kind → 画布实体类型映射（有精确渲染器的精确对应，其余归 module 通用卡片） */
export function entityTypeForSymbolKind(kind: string): string {
  const k = kind.toLowerCase();
  if (k === "class") return "class";
  if (k === "function" || k === "method") return "function";
  if (k === "interface") return "interface";
  // struct / enum / trait / module / const / type_alias 等：ModuleRenderer 通用卡片
  return "module";
}

/** 符号过滤条件（画像内搜索 v2.3）：query 子串（不区分大小写，命中符号名）或 kind 精确 */
export interface SymbolFilter {
  query?: string;
  kinds?: string[];
}

/** v2.13 符号画像层级钻取的布局范围：只布局指定顶层目录子树 / 单文件 */
export interface SymbolScope {
  /** 顶层目录名（topDirOf 口径）：只保留该模块子树下的符号 */
  moduleDir?: string;
  /** 单文件 id：只布局该文件的符号（通常配合 moduleDir） */
  fileId?: string;
}

/**
 * 核心入口：符号 → 目录横带 / 文件子带 / 符号实体的树形布局。
 *
 * @param symbols  代码结构分析出的全部符号（project_symbols）
 * @param refs     符号级引用（project_symbol_refs，toSymbolId 命中计为一次引用）
 * @param files    扫描文件（用于取文件名/语言/是否有效文件）
 * @param callEdges 符号级调用边（模块依赖聚合 / 环检测 / 枢纽筛选的数据源）
 * @param filter   （可选）画像内搜索：只布局命中的符号；目录/文件分组随之收缩
 * @returns 分组头（目录+文件）+ 符号实体描述 + 摘要统计
 */
export function buildSymbolLayout(
  symbols: ProjectSymbol[],
  refs: ProjectSymbolRef[],
  files: ProjectFile[],
  callEdges: CallEdgeInput[] = [],
  filter?: SymbolFilter,
  scope?: SymbolScope
): SymbolLayout {
  // ─── 1. 引用计数聚合：toSymbolId → 被引用次数 ───
  // 只统计 import 引用（v2.2 起 symbol_refs 混入 inherits/implements 继承引用，
  // 那属于结构关系不算 fan-in 热度，避免「被继承=枢纽」污染承重口径）。
  const refCountBySymbol = new Map<string, number>();
  for (const r of refs) {
    if (!r.toSymbolId) continue;
    if (r.kind !== "import") continue;
    refCountBySymbol.set(r.toSymbolId, (refCountBySymbol.get(r.toSymbolId) || 0) + 1);
  }

  // ─── 2. 按目录 → 文件 → 符号 三层分组 ───
  const validFileIds = new Set(files.filter((f) => !f.isDirectory).map((f) => f.id));
  // v2.3 画像内搜索：query 子串（不区分大小写）/ kind 精确过滤，命中才进入分组
  const q = filter?.query?.trim().toLowerCase() ?? "";
  const kinds = filter?.kinds?.length ? new Set(filter.kinds) : null;
  // v2.13 层级钻取 scope：只布局指定模块子树 / 单文件（模块总览层不调用本函数）
  const scopeMod = scope?.moduleDir;
  const scopeFile = scope?.fileId;
  const byFile = new Map<string, ProjectSymbol[]>();
  for (const s of symbols) {
    if (!validFileIds.has(s.fileId)) continue;
    if (scopeFile && s.fileId !== scopeFile) continue;
    if (scopeMod) {
      const f = files.find((x) => x.id === s.fileId);
      if (!f || topDirOf(f.relPath) !== scopeMod) continue;
    }
    if (q && !s.name.toLowerCase().includes(q)) continue;
    if (kinds && !kinds.has(s.kind)) continue;
    const arr = byFile.get(s.fileId) || [];
    arr.push(s);
    byFile.set(s.fileId, arr);
  }

  // dir -> (fileId -> symbols[])，文件内按定义行号升序
  const dirMap = new Map<string, Map<string, ProjectSymbol[]>>();
  for (const [fileId, syms] of byFile) {
    const file = files.find((f) => f.id === fileId);
    const dir = dirnameOf(syms[0].filePath);
    if (!dirMap.has(dir)) dirMap.set(dir, new Map());
    dirMap.get(dir)!.set(
      fileId,
      [...syms].sort((a, b) => a.lineStart - b.lineStart)
    );
  }

  // ─── v2.12 目录层级树 ───
  // 此前目录横带名 = 完整路径（`src-tauri/src/app`）平铺无层级、长文字截断，
  // 且模块依赖/环按顶层目录聚合时多层路径永远匹配不上（depCounts.get(完整路径)=∅）。
  // 现在：name=最后一段、path=完整路径、depth=层级、topDir=顶层模块归属；
  // 画布横带按 depth 缩进成树形，模块徽标只挂顶层横带。
  interface DirBandNode {
    path: string;
    name: string;
    depth: number;
    topDir: string;
    total: number;
    ownFiles: { fileId: string; file: ProjectFile | undefined; syms: ProjectSymbol[] }[];
    children: DirBandNode[];
    parent: DirBandNode | null;
  }
  const bandNode = new Map<string, DirBandNode>();
  const ensureNode = (path: string): DirBandNode => {
    const existing = bandNode.get(path);
    if (existing) return existing;
    const segs = path.split("/");
    const node: DirBandNode = {
      path,
      // 根目录（path=""，文件直接在项目根）显示 "(root)"
      name: segs[segs.length - 1] || "(root)",
      depth: Math.max(0, segs.length - 1),
      topDir: segs[0] || "(root)",
      total: 0,
      ownFiles: [],
      children: [],
      parent: null,
    };
    bandNode.set(path, node);
    // 递归补全祖先链：中间目录即使没有自己的文件符号也必须有横带，否则 `src-tauri/src/app`
    // 的父链断在 `src-tauri/src`，`app` 会被误判成顶层。
    const p = dirnameOf(path);
    if (p) {
      const parent = ensureNode(p);
      node.parent = parent;
      parent.children.push(node);
    }
    return node;
  };
  for (const [dir] of dirMap) ensureNode(dir);
  for (const [dir, fileMap] of dirMap) {
    const node = bandNode.get(dir)!;
    node.ownFiles = Array.from(fileMap.entries())
      .map(([fileId, syms]) => ({ fileId, file: files.find((f) => f.id === fileId), syms }))
      .filter((g) => g.file)
      .sort((a, b) => b.syms.length - a.syms.length)
      .slice(0, MAX_FILES_PER_DIR);
  }
  // 自底向上算子树符号总数（含子目录）
  const computeTotal = (n: DirBandNode): number => {
    let t = n.ownFiles.reduce((a, g) => a + g.syms.length, 0);
    for (const c of n.children) t += computeTotal(c);
    n.total = t;
    return t;
  };
  for (const n of bandNode.values()) if (!n.parent) computeTotal(n);
  // 每层子目录按子树符号数降序 + 截断（符号最密的子目录优先展开）
  for (const n of bandNode.values()) {
    n.children.sort((a, b) => b.total - a.total);
    if (n.children.length > MAX_DIR_CHILDREN) n.children = n.children.slice(0, MAX_DIR_CHILDREN);
  }
  // DFS 展平（先父后子，保证前缀树完整）：顶层按 total 降序取前 MAX_DIRS，
  // 总横带不超 MAX_DIR_BANDS（超出时整棵较次要的顶层子树被裁掉，层级不破）
  const roots = Array.from(bandNode.values())
    .filter((n) => !n.parent)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_DIRS);
  const dirBands: DirBandNode[] = [];
  const visit = (n: DirBandNode) => {
    if (dirBands.length >= MAX_DIR_BANDS) return;
    dirBands.push(n);
    for (const c of n.children) visit(c);
  };
  for (const r of roots) {
    visit(r);
    if (dirBands.length >= MAX_DIR_BANDS) break;
  }

  // ─── 3. 布局：目录横带（顶）→ 文件子带（中）→ 符号网格（底，逐级缩进）───
  const groups: SymbolGroupHeader[] = [];
  const nodes: SymbolNode[] = [];
  let rendered = 0;
  let truncated = 0;
  const byKind: Record<string, number> = {};
  const bandW = SYM_INDENT + COL_PER_ROW * COL_W;

  // 先扫一遍求全局最大引用数，用于 centrality 归一化
  let maxRef = 0;
  for (const [, syms] of byFile) for (const s of syms) maxRef = Math.max(maxRef, refCountBySymbol.get(s.id) || 0);

  let y = TOP;
  for (const d of dirBands) {
    let dirRendered = 0;
    const dX = LEFT + d.depth * DIR_INDENT; // v2.12 层级缩进：子目录横带右移
    groups.push({
      name: d.name,
      level: "dir",
      color: DIR_COLOR,
      symbolCount: d.total,
      renderedCount: 0, // 占位，循环结束回填
      path: d.path,
      topDir: d.topDir,
      depth: d.depth,
      hasChildren: d.children.length > 0,
      x: dX,
      y,
      width: bandW - d.depth * DIR_INDENT,
      height: DIR_HEADER_H,
    });
    const dirHeaderIdx = groups.length - 1;
    y += DIR_HEADER_H + 6;

    for (const f of d.ownFiles) {
      // v2.3 截断按重要性而非行序：先按 refCount 降序，再取前 N ——
      // 高引用的核心符号永远不被行号截断误杀（截断前按行序，靠后的核心符号
      // 可能被丢掉，是最冤的丢失）。文件网格列序随之变为「重要度序」。
      const shown = [...f.syms]
        .sort((a, b) => (refCountBySymbol.get(b.id) || 0) - (refCountBySymbol.get(a.id) || 0))
        .slice(0, MAX_SYMBOLS_PER_FILE);
      truncated += Math.max(0, f.syms.length - shown.length);
      const rows = Math.ceil(shown.length / COL_PER_ROW);
      groups.push({
        name: f.file?.name ?? "文件",
        level: "file",
        color: FILE_COLOR,
        symbolCount: f.syms.length,
        renderedCount: shown.length,
        fileId: f.file?.id,
        path: f.file?.relPath, // v2.12 完整相对路径（副行/tooltip，同名文件可辨）
        x: dX + FILE_INDENT,
        y,
        width: bandW - d.depth * DIR_INDENT - FILE_INDENT,
        height: FILE_HEADER_H,
      });
      y += FILE_HEADER_H + 4;

      shown.forEach((s, i) => {
        byKind[s.kind] = (byKind[s.kind] || 0) + 1;
        const ref = refCountBySymbol.get(s.id) || 0;
        const centrality = maxRef > 0 ? ref / maxRef : 0;
        const col = i % COL_PER_ROW;
        const rowi = Math.floor(i / COL_PER_ROW);
        nodes.push({
          symbolId: s.id,
          entityType: entityTypeForSymbolKind(s.kind),
          name: s.name,
          symbolKind: s.kind,
          fileId: s.fileId,
          fileName: f.file?.name ?? "",
          filePath: s.filePath,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          signature: s.signature,
          refCount: ref,
          centrality,
          centralityColor: centralityColor(centrality),
          x: dX + SYM_INDENT + col * COL_W,
          y: y + rowi * ROW_H,
          width: COL_W - 8,
          height: ROW_H - 8,
        });
        rendered += 1;
        dirRendered += 1;
      });
      y += rows * ROW_H + 12;
    }
    groups[dirHeaderIdx].renderedCount = dirRendered;
    y += 18; // 目录之间的间隔
  }

  // 结构体检三件套（v2.1）：模块依赖聚合 / 调用环 / 枢纽符号
  const moduleDeps = buildModuleDeps(callEdges, files);
  const { cycleSymbolIds, cycleDirs, cycles } = detectSymbolCycles(nodes, callEdges);
  const hubSymbolIds = pickHubSymbols(nodes);

  return {
    groups,
    nodes,
    summary: {
      files: Array.from(byFile.keys()).length,
      symbols: symbols.length,
      rendered,
      truncated,
      byKind,
      dirs: dirBands.length,
      moduleDeps,
      cycleSymbolIds,
      cycleDirs,
      cycles,
      hubSymbolIds,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 符号级调用连线
//
// 「代码结构画像」此前只有孤立的符号方块 —— 用户能看到有哪些类和函数，却看不出
// 它们之间谁调用谁。后端 analyze_call_graph 早就把调用边写进了 project_call_edges
// （callerSymbolId → calleeSymbolId），前端也拉进了 store，但从没上过画布：
// 又一条「挂着不通电」的链路。
//
// 这里把调用边接上：两端符号都在画布上时才画线（画布上没有的符号不画，避免
// 悬空箭头），同一对符号的多次调用聚合成一条（callCount 标注调用次数）。
// ─────────────────────────────────────────────────────────────────────────────

/** 画布上一条符号级调用连线（dependency-edge 实体描述，depType="call"） */
export interface SymbolCallEdge {
  fromSymbolId: string;
  toSymbolId: string;
  fromFileId: string;
  toFileId: string;
  name: string;
  /** internal（同文件）/ cross-file（跨文件），跨文件更值得关注 */
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

/** 调用连线上限：符号画像最多 14 目录 × 6 文件 × 8 符号 节点，连线必须限流 */
export const MAX_CALL_EDGES = 100;

/** 最小调用边（只取 buildSymbolCallEdges 需要的字段，避免把整表类型带进纯函数） */
export interface CallEdgeInput {
  callerSymbolId: string;
  calleeSymbolId: string;
  callerName?: string;
  calleeName?: string;
  callerFileId?: string;
  calleeFileId?: string;
  kind?: string;
}

/**
 * 用已布局好的符号节点 + 调用边，生成画布连线。
 *
 * @param nodes  buildSymbolLayout 产出的符号节点（含坐标）
 * @param edges  后端调用图边
 * @param maxEdges 连线上限（跨文件调用优先保留）
 */
export function buildSymbolCallEdges(
  nodes: SymbolNode[],
  edges: CallEdgeInput[],
  maxEdges: number = MAX_CALL_EDGES
): SymbolCallEdge[] {
  if (nodes.length === 0 || edges.length === 0) return [];
  const nodeById = new Map(nodes.map((n) => [n.symbolId, n]));

  const pairs = new Map<
    string,
    { from: string; to: string; count: number; crossFile: boolean }
  >();
  for (const e of edges) {
    if (!e.callerSymbolId || !e.calleeSymbolId) continue;
    if (e.callerSymbolId === e.calleeSymbolId) continue;
    if (!nodeById.has(e.callerSymbolId) || !nodeById.has(e.calleeSymbolId)) continue;
    const key = `${e.callerSymbolId}->${e.calleeSymbolId}`;
    const cur = pairs.get(key) || {
      from: e.callerSymbolId,
      to: e.calleeSymbolId,
      count: 0,
      crossFile: false,
    };
    cur.count += 1;
    cur.crossFile = cur.crossFile || e.kind === "cross-file";
    pairs.set(key, cur);
  }

  // 跨文件调用优先（更能揭示模块耦合），其次按调用次数
  const ranked = Array.from(pairs.values())
    .sort((a, b) => {
      if (a.crossFile !== b.crossFile) return a.crossFile ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, maxEdges);

  return ranked.map((p) => {
    const a = nodeById.get(p.from)!;
    const b = nodeById.get(p.to)!;
    // 调用方向：调用者底边中点 → 被调用者顶边中点
    const absFromX = a.x + a.width / 2;
    const absFromY = a.y + a.height;
    const absToX = b.x + b.width / 2;
    const absToY = b.y;
    const minX = Math.min(absFromX, absToX);
    const minY = Math.min(absFromY, absToY);
    return {
      fromSymbolId: p.from,
      toSymbolId: p.to,
      fromFileId: a.fileId,
      toFileId: b.fileId,
      name: `${a.name} → ${b.name}`,
      kind: p.crossFile ? "cross-file" : "internal",
      x: minX,
      y: minY,
      width: Math.max(4, Math.abs(absToX - absFromX) + 16),
      height: Math.max(4, Math.abs(absToY - absFromY) + 16),
      config: {
        depType: "call",
        callEdge: true,
        crossFile: p.crossFile,
        callCount: p.count,
        fromX: absFromX - minX,
        fromY: absFromY - minY,
        toX: absToX - minX,
        toY: absToY - minY,
        // 复用文件级联动字段：选中符号所属文件时这条调用线也会点亮
        fromFileId: a.fileId,
        toFileId: b.fileId,
        fromSymbolId: p.from,
        toSymbolId: p.to,
        symbolNames: [b.name],
        portraitMode: "symbols",
      },
    };
  });
}

/** 文件内聚度统计（v2.2）：文件内符号互调比例。回答「这个文件是一组协作紧密的
 *  函数，还是各干各的乱麻」。只统计两端符号都在画布上的调用（被截断的符号不计）。 */
export interface FileCohesion {
  /** 文件内符号互相调用的对数 */
  internal: number;
  /** 本文件符号与外部文件的调用对数（出+入） */
  external: number;
  /** internal / (internal + external)，无调用参与为 0 */
  ratio: number;
  /** 是否参与了任何调用（没参与不标徽标，避免把没调用图的文件误判成低内聚） */
  participated: boolean;
}

export function computeFileCohesion(
  nodes: SymbolNode[],
  callEdges: CallEdgeInput[]
): Map<string, FileCohesion> {
  const symByFile = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (!symByFile.has(n.fileId)) symByFile.set(n.fileId, new Set());
    symByFile.get(n.fileId)!.add(n.symbolId);
  }
  const out = new Map<string, FileCohesion>();
  for (const fid of symByFile.keys()) {
    out.set(fid, { internal: 0, external: 0, ratio: 0, participated: false });
  }
  for (const e of callEdges) {
    const fromFid = e.callerFileId;
    const toFid = e.calleeFileId;
    if (!fromFid || !toFid) continue;
    const fromSet = symByFile.get(fromFid);
    const toSet = symByFile.get(toFid);
    if (!fromSet || !toSet) continue;
    if (fromFid === toFid) {
      const c = out.get(fromFid)!;
      c.internal += 1;
      c.participated = true;
    } else {
      const c = out.get(fromFid)!;
      c.external += 1;
      c.participated = true;
      const d = out.get(toFid)!;
      d.external += 1;
      d.participated = true;
    }
  }
  for (const v of out.values()) {
    const total = v.internal + v.external;
    v.ratio = total > 0 ? v.internal / total : 0;
  }
  return out;
}

/**
 * 模块级调用环（v2.3 模块依赖图）：在 dir→dir 依赖图上做 Tarjan SCC，
 * size>1 的强连通分量 = 模块间循环依赖。返回环上的目录集合（渲染红描边）。
 * 节点数 = 顶层目录数（几十个），递归安全。
 */
export function detectModuleCycles(moduleDeps: ModuleDepEdge[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of moduleDeps) {
    const list = adj.get(e.fromDir);
    if (list) list.push(e.toDir);
    else adj.set(e.fromDir, [e.toDir]);
  }
  const nodes = Array.from(new Set(moduleDeps.flatMap((e) => [e.fromDir, e.toDir])));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycleDirs = new Set<string>();
  let counter = 0;

  const strongconnect = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) {
        for (const d of comp) cycleDirs.add(d);
      }
    }
  };

  for (const n of nodes) {
    if (!index.has(n)) strongconnect(n);
  }
  return cycleDirs;
}
