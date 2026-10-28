/**
 * 变更影响面分析（Impact Analysis · 纯函数）
 *
 * 代码分析器最有价值的问题不是「这个项目有多少行」，而是——
 * **「我改这个函数，会炸到谁？」**
 *
 * 此前项目里已经有了 `project_call_edges`（函数调用图，caller → callee 的符号级边），
 * 但它只被用来画一张同心环的调用图，边一进画布就被聚合成了文件粒度，
 * `callerSymbolId` / `calleeSymbolId` 直接丢弃 —— 等于「采了矿没炼钢」。
 *
 * 本模块把这批符号级边炼成两种可回答的问题：
 * - **上游（upstream）**：谁在调用我 → 改我，这些人受影响（**爆炸半径**）
 * - **下游（downstream）**：我在调用谁 → 我依赖这些人（理解成本 / 移植成本）
 *
 * 两个方向都做**多跳 BFS 传播**：直接调用者是 depth=1，调用者的调用者是 depth=2……
 * 传播过程中记录「经由谁传过来的（via）」，因此能还原完整调用链路径，
 * 而不是只给一个扁平的名字列表。
 *
 * 设计约束（与项目既有风格一致）：
 * - 纯函数、零副作用、不 import store，可直接单测
 * - 输入就是 store 里已有的 `CallEdge[]` / `ProjectSymbol[]`，不需要任何新后端命令
 * - 环（递归 / 相互调用）不会导致死循环：visited 集合按方向独立维护
 */

import type { CallEdge, ProjectSymbol } from "../../services/tauri";
import { t } from "../../i18n";

/** 传播方向：上游=调用我的人（受影响面）；下游=我调用的人（依赖面） */
export type ImpactDirection = "upstream" | "downstream";

/** 爆炸半径等级（决定 UI 配色与「能不能放心改」的结论） */
export type ImpactLevel = "isolated" | "local" | "wide" | "critical";

/** 影响面节点：一个受波及的符号 + 它离根节点有多远 */
export interface ImpactNode {
  symbolId: string;
  name: string;
  kind: string;
  fileId: string;
  filePath: string;
  /** 距离根符号的跳数，1 = 直接调用关系 */
  depth: number;
  /** 经由哪个符号传播过来的（路径上一跳），根的直接邻居为根自身 */
  viaSymbolId: string;
  viaName: string;
  /** 该跳调用点所在行号 */
  callLine: number;
  /** 是否跨文件（跨文件的传播风险更高） */
  crossFile: boolean;
  /** 该调用解析到的接收者声明类型名（如 `ClassA`）；空串表示裸函数/未锁定。
   *  对标 joern：joern 动态分派超近似丢失接收者类型，这里给出精确类型，
   *  让同名方法（ClassA.foo / ClassB.foo）在影响面里可区分。 */
  receiverType?: string;
}

export interface ImpactReport {
  rootSymbolId: string;
  rootName: string;
  rootKind: string;
  rootFileId: string;
  rootFilePath: string;
  /** 上游：会被我影响的调用者（按 depth 升序、同层按名字排） */
  upstream: ImpactNode[];
  /** 下游：我依赖的被调用者 */
  downstream: ImpactNode[];
  /** 上游按 depth 分层，索引 0 对应 depth=1 */
  upstreamByDepth: ImpactNode[][];
  downstreamByDepth: ImpactNode[][];
  /** 爆炸半径：上游波及的符号数 / 文件数 / 最远跳数 */
  blastRadius: { symbols: number; files: number; maxDepth: number };
  /** 受影响文件（上游涉及的文件 + 根文件，去重） */
  affectedFileIds: string[];
  affectedFilePaths: string[];
  /** 风险级别 */
  level: ImpactLevel;
  /** 是否存在回到根符号的调用环（递归 / 相互调用） */
  cyclic: boolean;
  /** 直接调用者数 / 直接被调用者数 */
  directCallers: number;
  directCallees: number;
}

/** 调用图索引：一次构建，多次查询（避免每次分析都全表扫边） */
export interface CallIndex {
  /** callerSymbolId → 它发出的边 */
  byCaller: Map<string, CallEdge[]>;
  /** calleeSymbolId → 指向它的边 */
  byCallee: Map<string, CallEdge[]>;
  /** symbolId → 元信息（名字 / 文件），来源于边自带的冗余字段，无需符号表也能用 */
  meta: Map<string, { name: string; fileId: string; filePath: string }>;
  totalEdges: number;
}

export const IMPACT_LEVEL_META: Record<ImpactLevel, { labelKey: string; color: string; hintKey: string }> = {
  isolated: { labelKey: "impact.level.isolated", color: "#22c55e", hintKey: "impact.level.isolatedHint" },
  local: { labelKey: "impact.level.local", color: "#3b82f6", hintKey: "impact.level.localHint" },
  wide: { labelKey: "impact.level.wide", color: "#f59e0b", hintKey: "impact.level.wideHint" },
  critical: { labelKey: "impact.level.critical", color: "#ef4444", hintKey: "impact.level.criticalHint" },
};

/** 影响等级名（跟随 UI 语言） */
export function impactLevelLabel(level: ImpactLevel): string {
  return t(IMPACT_LEVEL_META[level].labelKey);
}

/** 影响等级提示（跟随 UI 语言） */
export function impactLevelHint(level: ImpactLevel): string {
  return t(IMPACT_LEVEL_META[level].hintKey);
}

/**
 * 爆炸半径 → 风险级别
 * 阈值取自经验：跨 5 文件以上就已经超出「一次 code review 能兜住」的范围。
 */
export function impactLevelOf(symbolCount: number, fileCount: number): ImpactLevel {
  if (symbolCount === 0) return "isolated";
  if (symbolCount >= 20 || fileCount >= 8) return "critical";
  if (symbolCount >= 6 || fileCount >= 3) return "wide";
  return "local";
}

/** 构建正/反向邻接索引 */
export function buildCallIndex(edges: CallEdge[]): CallIndex {
  const byCaller = new Map<string, CallEdge[]>();
  const byCallee = new Map<string, CallEdge[]>();
  const meta = new Map<string, { name: string; fileId: string; filePath: string }>();

  for (const e of edges) {
    if (!e.callerSymbolId || !e.calleeSymbolId) continue;
    const outs = byCaller.get(e.callerSymbolId);
    if (outs) outs.push(e);
    else byCaller.set(e.callerSymbolId, [e]);

    const ins = byCallee.get(e.calleeSymbolId);
    if (ins) ins.push(e);
    else byCallee.set(e.calleeSymbolId, [e]);

    if (!meta.has(e.callerSymbolId)) {
      meta.set(e.callerSymbolId, {
        name: e.callerName,
        fileId: e.callerFileId,
        filePath: e.callerFilePath,
      });
    }
    if (!meta.has(e.calleeSymbolId)) {
      meta.set(e.calleeSymbolId, {
        name: e.calleeName,
        fileId: e.calleeFileId,
        filePath: e.calleeFilePath,
      });
    }
  }

  return { byCaller, byCallee, meta, totalEdges: edges.length };
}

/**
 * 单方向多跳 BFS 传播
 *
 * @param direction upstream 走反向边（谁调用我），downstream 走正向边（我调用谁）
 * @param maxDepth  最大跳数，默认 3（再深人也看不过来，且噪声大于信号）
 * @returns 命中的节点（不含根）+ 是否回到过根（环）
 */
export function traverseImpact(
  index: CallIndex,
  rootSymbolId: string,
  direction: ImpactDirection,
  maxDepth = 3
): { nodes: ImpactNode[]; cyclic: boolean } {
  if (!rootSymbolId || maxDepth < 1) return { nodes: [], cyclic: false };

  const nodes: ImpactNode[] = [];
  const visited = new Set<string>([rootSymbolId]);
  let cyclic = false;

  // 队列元素：待展开的符号 + 它所处的深度
  let frontier: string[] = [rootSymbolId];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];

    for (const current of frontier) {
      const edges =
        direction === "upstream" ? index.byCallee.get(current) : index.byCaller.get(current);
      if (!edges) continue;

      for (const e of edges) {
        // 上游：边的 caller 是「波及到的人」；下游：边的 callee 是「我依赖的人」
        const nextId = direction === "upstream" ? e.callerSymbolId : e.calleeSymbolId;
        if (nextId === rootSymbolId) {
          // 传播了一圈又回到起点 —— 递归或相互调用
          cyclic = true;
          continue;
        }
        if (visited.has(nextId)) continue;
        visited.add(nextId);

        const info = index.meta.get(nextId);
        const viaInfo = index.meta.get(current);
        nodes.push({
          symbolId: nextId,
          name:
            (direction === "upstream" ? e.callerName : e.calleeName) || info?.name || nextId,
          // 边上没有 kind 字段，调用图里的节点按定义都是可调用体
          kind: "function",
          fileId: (direction === "upstream" ? e.callerFileId : e.calleeFileId) || info?.fileId || "",
          filePath:
            (direction === "upstream" ? e.callerFilePath : e.calleeFilePath) ||
            info?.filePath ||
            "",
          depth,
          viaSymbolId: current,
          viaName: viaInfo?.name || "",
          callLine: e.lineNo,
          crossFile: e.kind === "cross-file",
          receiverType: e.receiverTarget || undefined,
        });
        next.push(nextId);
      }
    }

    frontier = next;
  }

  return { nodes, cyclic };
}

/** 按 depth 把扁平节点切成层（索引 0 = depth 1） */
export function groupByDepth(nodes: ImpactNode[], maxDepth: number): ImpactNode[][] {
  const layers: ImpactNode[][] = [];
  for (let d = 1; d <= maxDepth; d++) {
    const layer = nodes.filter((n) => n.depth === d);
    if (layer.length > 0) layers.push(layer);
    else if (layers.length > 0) break; // 中间断层说明后面也没有了
  }
  return layers;
}

/** 稳定排序：先按跳数，再按跨文件优先（风险更高），再按接收者类型聚簇（同名方法按类分组），
 *  最后按名字 */
function sortNodes(nodes: ImpactNode[]): ImpactNode[] {
  return [...nodes].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.crossFile !== b.crossFile) return a.crossFile ? -1 : 1;
    const ra = a.receiverType ?? "";
    const rb = b.receiverType ?? "";
    if (ra !== rb) return ra.localeCompare(rb);
    return a.name.localeCompare(b.name);
  });
}

/**
 * 完整影响面分析（主入口）
 *
 * @param edges    调用边全集（projectStore.callEdges）
 * @param rootSymbolId 目标符号
 * @param opts.maxDepth 传播跳数，默认 3
 * @param opts.symbols  可选的符号表，用来补全根节点的 kind / 文件信息
 *                      （根符号可能是「零调用」的，此时调用边里查不到它）
 */
export function analyzeImpact(
  edges: CallEdge[],
  rootSymbolId: string,
  opts?: { maxDepth?: number; symbols?: ProjectSymbol[]; index?: CallIndex }
): ImpactReport {
  const maxDepth = opts?.maxDepth ?? 3;
  const index = opts?.index ?? buildCallIndex(edges);

  const up = traverseImpact(index, rootSymbolId, "upstream", maxDepth);
  const down = traverseImpact(index, rootSymbolId, "downstream", maxDepth);

  const upstream = sortNodes(up.nodes);
  const downstream = sortNodes(down.nodes);

  const rootMeta = index.meta.get(rootSymbolId);
  const rootSym = opts?.symbols?.find((s) => s.id === rootSymbolId);

  const affected = new Set<string>();
  const affectedPaths = new Set<string>();
  for (const n of upstream) {
    if (n.fileId) affected.add(n.fileId);
    if (n.filePath) affectedPaths.add(n.filePath);
  }
  const rootFileId = rootSym?.fileId || rootMeta?.fileId || "";
  const rootFilePath = rootSym?.filePath || rootMeta?.filePath || "";
  if (rootFileId) affected.add(rootFileId);
  if (rootFilePath) affectedPaths.add(rootFilePath);

  const maxReached = upstream.reduce((m, n) => Math.max(m, n.depth), 0);

  return {
    rootSymbolId,
    rootName: rootSym?.name || rootMeta?.name || rootSymbolId,
    rootKind: rootSym?.kind || "function",
    rootFileId,
    rootFilePath,
    upstream,
    downstream,
    upstreamByDepth: groupByDepth(upstream, maxDepth),
    downstreamByDepth: groupByDepth(downstream, maxDepth),
    blastRadius: {
      symbols: upstream.length,
      // 爆炸半径只算「除根文件之外被波及的文件」
      files: Math.max(0, affected.size - (rootFileId ? 1 : 0)),
      maxDepth: maxReached,
    },
    affectedFileIds: [...affected],
    affectedFilePaths: [...affectedPaths],
    level: impactLevelOf(upstream.length, Math.max(0, affected.size - (rootFileId ? 1 : 0))),
    cyclic: up.cyclic || down.cyclic,
    directCallers: upstream.filter((n) => n.depth === 1).length,
    directCallees: downstream.filter((n) => n.depth === 1).length,
  };
}

/**
 * 文件级影响面：把文件内所有符号的上游并成一张影响面
 *
 * 画布上选中的通常是**文件实体**而不是单个函数，因此需要这个聚合口径：
 * 「改这个文件，会波及哪些文件」。
 */
export interface FileImpactReport {
  fileId: string;
  filePath: string;
  /** 文件内参与调用图的符号数 */
  activeSymbols: number;
  /** 波及到的其它文件（不含自身），按被波及的符号数降序 */
  affectedFiles: { fileId: string; filePath: string; symbolCount: number; minDepth: number }[];
  /** 依赖到的其它文件（下游） */
  dependsOnFiles: { fileId: string; filePath: string; symbolCount: number; minDepth: number }[];
  blastRadius: { symbols: number; files: number };
  level: ImpactLevel;
}

export function analyzeFileImpact(
  edges: CallEdge[],
  fileId: string,
  opts?: { maxDepth?: number; index?: CallIndex }
): FileImpactReport {
  const maxDepth = opts?.maxDepth ?? 2;
  const index = opts?.index ?? buildCallIndex(edges);

  // 文件内所有出现在调用图里的符号
  const rootIds: string[] = [];
  let filePath = "";
  index.meta.forEach((m, id) => {
    if (m.fileId === fileId) {
      rootIds.push(id);
      if (!filePath) filePath = m.filePath;
    }
  });

  const upAgg = new Map<string, { filePath: string; symbols: Set<string>; minDepth: number }>();
  const downAgg = new Map<string, { filePath: string; symbols: Set<string>; minDepth: number }>();
  const allUpstream = new Set<string>();

  for (const rid of rootIds) {
    const up = traverseImpact(index, rid, "upstream", maxDepth);
    for (const n of up.nodes) {
      if (!n.fileId || n.fileId === fileId) continue;
      allUpstream.add(n.symbolId);
      const cur = upAgg.get(n.fileId);
      if (cur) {
        cur.symbols.add(n.symbolId);
        cur.minDepth = Math.min(cur.minDepth, n.depth);
      } else {
        upAgg.set(n.fileId, {
          filePath: n.filePath,
          symbols: new Set([n.symbolId]),
          minDepth: n.depth,
        });
      }
    }
    const down = traverseImpact(index, rid, "downstream", maxDepth);
    for (const n of down.nodes) {
      if (!n.fileId || n.fileId === fileId) continue;
      const cur = downAgg.get(n.fileId);
      if (cur) {
        cur.symbols.add(n.symbolId);
        cur.minDepth = Math.min(cur.minDepth, n.depth);
      } else {
        downAgg.set(n.fileId, {
          filePath: n.filePath,
          symbols: new Set([n.symbolId]),
          minDepth: n.depth,
        });
      }
    }
  }

  const toList = (m: typeof upAgg) =>
    [...m.entries()]
      .map(([fid, v]) => ({
        fileId: fid,
        filePath: v.filePath,
        symbolCount: v.symbols.size,
        minDepth: v.minDepth,
      }))
      .sort((a, b) => b.symbolCount - a.symbolCount || a.filePath.localeCompare(b.filePath));

  const affectedFiles = toList(upAgg);

  return {
    fileId,
    filePath,
    activeSymbols: rootIds.length,
    affectedFiles,
    dependsOnFiles: toList(downAgg),
    blastRadius: { symbols: allUpstream.size, files: affectedFiles.length },
    level: impactLevelOf(allUpstream.size, affectedFiles.length),
  };
}

/** 一句话结论（toast / 面板顶部摘要复用同一口径） */
export function summarizeImpact(report: ImpactReport): string {
  if (report.upstream.length === 0 && report.downstream.length === 0) {
    return t("impact.summaryNoRefs", { name: report.rootName });
  }
  if (report.upstream.length === 0) {
    return t("impact.summaryNoCallers", { name: report.rootName, n: report.downstream.length });
  }
  return t("impact.summaryBlast", {
    name: report.rootName,
    symbols: report.blastRadius.symbols,
    files: report.blastRadius.files,
    level: impactLevelLabel(report.level),
    depth: report.blastRadius.maxDepth,
    cycle: report.cyclic ? t("impact.summaryCycle") : "",
  });
}

/**
 * 从符号表里挑出「可以作为影响面根」的候选
 * 只有可调用体（函数 / 方法 / 类）参与调用图，常量与类型别名不算。
 */
const CALLABLE_KINDS = new Set(["function", "method", "class", "struct", "trait", "interface"]);

export function impactCandidates(symbols: ProjectSymbol[], fileId: string): ProjectSymbol[] {
  return symbols
    .filter((s) => s.fileId === fileId && CALLABLE_KINDS.has(s.kind))
    .sort((a, b) => a.lineStart - b.lineStart);
}
