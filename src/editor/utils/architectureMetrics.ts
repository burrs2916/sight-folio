/**
 * 架构度量引擎（纯函数，可测）
 *
 * 之前项目里「循环依赖」只有后端两两比对得到的 `dependency.isCircular` 布尔位 ——
 * 它只能发现 A→B→A 这种二元环，而真实项目里最难拆的是
 * `auth → store → services → auth` 这类三元以上的长环，之前完全看不见。
 * 本模块用 Tarjan 强连通分量把真实环整条挖出来。
 *
 * 在此之上补齐业界公认的架构量化指标（Robert C. Martin 的包设计度量，
 * 也是 NDepend / Structure101 的核心指标）：
 *
 * - Ca（Afferent Coupling，传入耦合）：有多少个模块依赖我 → 我有多重要
 * - Ce（Efferent Coupling，传出耦合）：我依赖了多少个模块 → 我有多脆弱
 * - I  = Ce / (Ca + Ce)，不稳定性。0 = 谁都依赖我、我谁都不依赖（最稳定）；1 = 反之
 * - A  = 抽象符号数 / 总符号数，抽象度（interface / trait / type 占比）
 * - D  = |A + I - 1|，主序距离。理想架构落在 A + I = 1 这条「主序线」上
 *
 * 由 D 推出两个危险区：
 * - 痛苦区（Zone of Pain）：A 低 + I 低 —— 又具体又被大量依赖，改一行牵动全身
 * - 无用区（Zone of Uselessness）：A 高 + I 高 —— 抽象了一堆却没人用
 *
 * 最后把「循环依赖 / 主序距离 / 复杂度 / 技术债 / 死代码」折算成一个
 * 0-100 的架构健康度分数，每一项都带可解释的扣分明细（不做黑盒打分）。
 */

import type { ProjectFile, ProjectDependency, ProjectSymbol } from "../../services/tauri";
import { t } from "../../i18n";

// ───────────────────────── 模块图 ─────────────────────────

/** 文件 relPath → 顶层目录名（模块口径，与画布画像 / SVG 报告全项目统一） */
export function topDirOf(relPath: string): string {
  return relPath.includes("/") ? relPath.split("/")[0] : "root";
}

/**
 * v2.18 耦合主序图专用模块口径：取前两段路径作为模块名。
 *
 * 顶层目录（topDirOf）对纯前端/纯 Rust 项目天然产出"无跨模块 import"的退化形态
 * —— 前后端分离的项目通过 Tauri IPC 通信，不互相 import；
 * 单一端项目（如纯前端）的所有内部 import 都落在同一顶层目录下。
 * 切到二层路径（src/editor、src/utils、src/ai、src-tauri/commands …）作为模块边界，
 * 才能让主序图在常见的「前后端分离」「单端 + 多子模块」项目结构里产出有意义的图。
 *
 * **本函数专供耦合主序图使用**，不要替换 topDirOf 的全局调用 —— 其它画像
 * （架构 / 依赖 / 同步布局等）仍按顶层目录作为「项目真实边界」的语义运作。
 */
export function subDirOf(relPath: string): string {
  const parts = relPath.split("/");
  if (parts.length === 1) return "root"; // 单文件无目录
  if (parts.length === 2) return parts[0]; // 仅一层目录时退化为顶层（与 topDirOf 同）
  // 两层及以上：取前两段作为模块名（src/editor、src-tauri/commands …）
  return `${parts[0]}/${parts[1]}`;
}

export interface ModuleGraphNode {
  name: string;
  fileIds: string[];
  fileCount: number;
}

export interface ModuleGraphEdge {
  from: string;
  to: string;
  /** 底层文件级依赖边数量（耦合强度） */
  weight: number;
}

export interface ModuleGraph {
  nodes: ModuleGraphNode[];
  edges: ModuleGraphEdge[];
}

/**
 * 把文件级依赖聚合成模块级依赖图
 *
 * 只保留跨模块边（模块内互相 import 不算耦合），外部依赖（external:*）天然
 * 不在 files 里，会被自动过滤掉。
 */
export function buildModuleGraph(
  files: ProjectFile[],
  dependencies: ProjectDependency[]
): ModuleGraph {
  const fileToModule = new Map<string, string>();
  const nodeMap = new Map<string, ModuleGraphNode>();

  for (const f of files) {
    if (f.isDirectory) continue;
    // v2.18：耦合主序图用二层路径作为模块边界（见 subDirOf 注释）；其它画像仍用 topDirOf
    const mod = subDirOf(f.relPath);
    fileToModule.set(f.id, mod);
    const node = nodeMap.get(mod) ?? { name: mod, fileIds: [], fileCount: 0 };
    node.fileIds.push(f.id);
    node.fileCount += 1;
    nodeMap.set(mod, node);
  }

  const edgeMap = new Map<string, ModuleGraphEdge>();
  for (const d of dependencies) {
    const from = fileToModule.get(d.fromId);
    const to = fileToModule.get(d.toId);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    const cur = edgeMap.get(key) ?? { from, to, weight: 0 };
    cur.weight += 1;
    edgeMap.set(key, cur);
  }

  return {
    nodes: Array.from(nodeMap.values()).sort((a, b) => b.fileCount - a.fileCount),
    edges: Array.from(edgeMap.values()),
  };
}

// ───────────────────────── Tarjan 强连通分量 ─────────────────────────

export interface DependencyCycle {
  /** 环上的节点名（按 Tarjan 出栈顺序，已排序保证结果确定） */
  nodes: string[];
  size: number;
  /** 环内部的边数：边越多说明缠得越紧，拆解代价越高 */
  edgeCount: number;
  /** 环内总耦合权重（底层文件依赖边总数） */
  weight: number;
}

/**
 * Tarjan 算法找出所有强连通分量（即循环依赖环）
 *
 * 迭代实现而非递归 —— 大型项目的依赖图深度可能上千，递归会爆栈。
 * 返回结果按「环大小降序 → 名称字典序」排序，保证同样输入永远同样输出
 * （画布画像要可复现，不能每次刷新换一个顺序）。
 */
export function findCycles(
  nodeNames: string[],
  edges: { from: string; to: string; weight?: number }[]
): DependencyCycle[] {
  const adj = new Map<string, string[]>();
  for (const n of nodeNames) adj.set(n, []);
  const selfLoops = new Set<string>();
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    if (e.from === e.to) {
      selfLoops.add(e.from);
      continue;
    }
    adj.get(e.from)!.push(e.to);
  }
  // 邻接表排序：保证遍历顺序确定
  for (const list of adj.values()) list.sort();

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const components: string[][] = [];

  for (const root of [...nodeNames].sort()) {
    if (index.has(root)) continue;

    // 迭代版 DFS：frame = [节点, 下一个待访问邻居下标]
    const frames: { node: string; i: number }[] = [{ node: root, i: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbors = adj.get(frame.node) ?? [];

      if (frame.i < neighbors.length) {
        const next = neighbors[frame.i];
        frame.i += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, i: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      // 邻居走完：回溯并判断是否为强连通分量的根
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const comp: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === frame.node) break;
        }
        if (comp.length > 1) components.push(comp.sort());
      }
    }
  }

  // 自环（模块自己依赖自己，通常是聚合口径造成的，也值得提示）
  for (const n of [...selfLoops].sort()) components.push([n]);

  const inComp = (comp: string[]) => new Set(comp);
  const cycles: DependencyCycle[] = components.map((comp) => {
    const members = inComp(comp);
    let edgeCount = 0;
    let weight = 0;
    for (const e of edges) {
      if (members.has(e.from) && members.has(e.to)) {
        if (comp.length === 1 && e.from !== e.to) continue;
        edgeCount += 1;
        weight += e.weight ?? 1;
      }
    }
    return { nodes: comp, size: comp.length, edgeCount, weight };
  });

  return cycles.sort(
    (a, b) => b.size - a.size || b.edgeCount - a.edgeCount || a.nodes[0].localeCompare(b.nodes[0])
  );
}

// ───────────────────────── Martin 包设计度量 ─────────────────────────

/** 抽象类符号种类：这些符号只描述契约、不含实现细节 */
export const ABSTRACT_SYMBOL_KINDS = new Set([
  "interface",
  "trait",
  "type_alias",
  "type",
  "protocol",
  "abstract",
  "abstract_class",
]);

export type CouplingZone = "painful" | "useless" | "mainSequence";

export interface ModuleCoupling {
  name: string;
  fileCount: number;
  /** 传入耦合：依赖我的模块数 */
  ca: number;
  /** 传出耦合：我依赖的模块数 */
  ce: number;
  /** 不稳定性 I = Ce/(Ca+Ce)，孤立模块记 0 */
  instability: number;
  /** 抽象度 A = 抽象符号 / 总符号，无符号记 0 */
  abstractness: number;
  /** 主序距离 D = |A + I - 1| */
  distance: number;
  zone: CouplingZone;
  symbolCount: number;
  abstractSymbolCount: number;
  /** 是否落在某个循环依赖环上 */
  inCycle: boolean;
}

/** 区域判定：D 超过 0.45 才算偏离主序，再按 I 高低分痛苦/无用 */
export function zoneOf(instability: number, abstractness: number): CouplingZone {
  const distance = Math.abs(abstractness + instability - 1);
  if (distance <= 0.45) return "mainSequence";
  return instability < 0.5 ? "painful" : "useless";
}

export const ZONE_LABEL: Record<CouplingZone, string> = {
  painful: "health.zone.painful",
  useless: "health.zone.useless",
  mainSequence: "health.zone.mainSequence",
};
/** 区域名（跟随 UI 语言） */
export function zoneLabelOf(zone: CouplingZone): string {
  return t(ZONE_LABEL[zone]);
}

export const ZONE_COLOR: Record<CouplingZone, string> = {
  painful: "#ef4444",
  useless: "#a855f7",
  mainSequence: "#22c55e",
};

export const ZONE_HINT: Record<CouplingZone, string> = {
  painful: "health.zone.painfulHint",
  useless: "health.zone.uselessHint",
  mainSequence: "health.zone.mainSequenceHint",
};
/** 区域提示（跟随 UI 语言） */
export function zoneHintOf(zone: CouplingZone): string {
  return t(ZONE_HINT[zone]);
}

/** 计算模块级 Martin 度量 */
export function computeModuleCoupling(
  graph: ModuleGraph,
  symbols: ProjectSymbol[],
  cycles: DependencyCycle[] = []
): ModuleCoupling[] {
  const fileToModule = new Map<string, string>();
  for (const n of graph.nodes) {
    for (const fid of n.fileIds) fileToModule.set(fid, n.name);
  }

  const caSet = new Map<string, Set<string>>();
  const ceSet = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    caSet.set(n.name, new Set());
    ceSet.set(n.name, new Set());
  }
  for (const e of graph.edges) {
    ceSet.get(e.from)?.add(e.to);
    caSet.get(e.to)?.add(e.from);
  }

  const symbolTotal = new Map<string, number>();
  const symbolAbstract = new Map<string, number>();
  for (const s of symbols) {
    if (s.kind === "import") continue;
    const mod = fileToModule.get(s.fileId) ?? (s.filePath ? subDirOf(s.filePath) : null);
    if (!mod) continue;
    symbolTotal.set(mod, (symbolTotal.get(mod) ?? 0) + 1);
    if (ABSTRACT_SYMBOL_KINDS.has(s.kind)) {
      symbolAbstract.set(mod, (symbolAbstract.get(mod) ?? 0) + 1);
    }
  }

  const cycleMembers = new Set<string>();
  for (const c of cycles) for (const n of c.nodes) cycleMembers.add(n);

  return graph.nodes
    .map((n) => {
      const ca = caSet.get(n.name)?.size ?? 0;
      const ce = ceSet.get(n.name)?.size ?? 0;
      const instability = ca + ce === 0 ? 0 : ce / (ca + ce);
      const total = symbolTotal.get(n.name) ?? 0;
      const abs = symbolAbstract.get(n.name) ?? 0;
      const abstractness = total === 0 ? 0 : abs / total;
      const distance = Math.abs(abstractness + instability - 1);
      return {
        name: n.name,
        fileCount: n.fileCount,
        ca,
        ce,
        instability,
        abstractness,
        distance,
        zone: zoneOf(instability, abstractness),
        symbolCount: total,
        abstractSymbolCount: abs,
        inCycle: cycleMembers.has(n.name),
      };
    })
    .sort((a, b) => b.distance - a.distance || a.name.localeCompare(b.name));
}

// ───────────────────────── 架构健康度评分 ─────────────────────────

export interface HealthDeduction {
  key: string;
  label: string;
  /** 扣掉的分数（正数） */
  points: number;
  /** 扣分依据的人话解释 */
  detail: string;
  /** 该项理论最大扣分，用于面板画进度条 */
  max: number;
}

export interface ArchitectureHealth {
  /** 0-100，越高越健康 */
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  deductions: HealthDeduction[];
  cycleCount: number;
  /** 卷入循环依赖的模块数 */
  cycleModuleCount: number;
  painfulCount: number;
  uselessCount: number;
  avgDistance: number;
}

export interface HealthInput {
  coupling: ModuleCoupling[];
  cycles: DependencyCycle[];
  /** 高/极高复杂度文件数 与 参与统计的文件总数 */
  highComplexityFiles: number;
  totalFiles: number;
  /** 技术债标记数 与 代码总行数（算每千行密度） */
  techDebtCount: number;
  totalLines: number;
  /** 死代码符号数 与 符号总数 */
  deadSymbolCount: number;
  totalSymbols: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 折算架构健康度
 *
 * 五个扣分项都是「有据可查」的：面板会把 detail 原样展示出来，
 * 用户能立刻知道分是怎么丢的，而不是看到一个玄学分数。
 */
export function computeArchitectureHealth(input: HealthInput): ArchitectureHealth {
  const deductions: HealthDeduction[] = [];

  // ① 循环依赖：环越大越致命（3 元环比 2 元环难拆得多）
  const cycleModules = new Set<string>();
  for (const c of input.cycles) for (const n of c.nodes) cycleModules.add(n);
  const cyclePenaltyRaw = input.cycles.reduce((acc, c) => acc + Math.min(4 * c.size, 16), 0);
  const cyclePenalty = clamp(cyclePenaltyRaw, 0, 30);
  deductions.push({
    key: "cycles",
    label: t("health.deductionCycles"),
    points: round1(cyclePenalty),
    max: 30,
    detail:
      input.cycles.length === 0
        ? t("health.noCycles")
        : t("health.cyclesDetail", {
            n: input.cycles.length,
            m: cycleModules.size,
            size: input.cycles[0]?.size ?? 0,
            names: input.cycles[0]?.nodes.slice(0, 4).join(" → ") ?? "",
          }),
  });

  // ② 主序偏离：抽象度与稳定性不匹配
  const withCoupling = input.coupling.filter((c) => c.ca + c.ce > 0);
  const avgDistance =
    withCoupling.length === 0
      ? 0
      : withCoupling.reduce((acc, c) => acc + c.distance, 0) / withCoupling.length;
  const painful = input.coupling.filter((c) => c.zone === "painful");
  const useless = input.coupling.filter((c) => c.zone === "useless");
  const distancePenalty = clamp((avgDistance - 0.3) * 50, 0, 25);
  deductions.push({
    key: "distance",
    label: t("health.deductionDistance"),
    points: round1(distancePenalty),
    max: 25,
    detail:
      withCoupling.length === 0
        ? t("health.noDepsToAssess")
        : t("health.distanceDetail", {
            d: avgDistance.toFixed(2),
            p: painful.length,
            names: painful.length > 0 ? `（${painful.slice(0, 3).map((c) => c.name).join("、")}）` : "",
            u: useless.length,
          }),
  });

  // ③ 复杂度：高/极高复杂度文件占比
  const complexRatio = input.totalFiles === 0 ? 0 : input.highComplexityFiles / input.totalFiles;
  const complexPenalty = clamp(complexRatio * 60, 0, 20);
  deductions.push({
    key: "complexity",
    label: t("health.deductionComplexity"),
    points: round1(complexPenalty),
    max: 20,
    detail:
      input.totalFiles === 0
        ? t("health.noMetrics")
        : t("health.complexityDetail", {
            n: input.highComplexityFiles,
            m: input.totalFiles,
            pct: (complexRatio * 100).toFixed(1),
          }),
  });

  // ④ 技术债密度：每千行代码的 TODO/FIXME 数
  const kloc = input.totalLines / 1000;
  const debtDensity = kloc <= 0 ? 0 : input.techDebtCount / kloc;
  const debtPenalty = clamp(debtDensity * 3, 0, 15);
  deductions.push({
    key: "techDebt",
    label: t("health.deductionTechDebt"),
    points: round1(debtPenalty),
    max: 15,
    detail:
      kloc <= 0
        ? t("health.noLines")
        : t("health.techDebtDetail", {
            n: input.techDebtCount,
            k: Math.round(kloc),
            d: debtDensity.toFixed(2),
          }),
  });

  // ⑤ 死代码占比
  const deadRatio = input.totalSymbols === 0 ? 0 : input.deadSymbolCount / input.totalSymbols;
  const deadPenalty = clamp(deadRatio * 40, 0, 10);
  deductions.push({
    key: "deadCode",
    label: t("health.deductionDead"),
    points: round1(deadPenalty),
    max: 10,
    detail:
      input.totalSymbols === 0
        ? t("health.noSymbols")
        : t("health.deadDetail", {
            n: input.deadSymbolCount,
            m: input.totalSymbols,
            pct: (deadRatio * 100).toFixed(1),
          }),
  });

  const total = deductions.reduce((acc, d) => acc + d.points, 0);
  const score = Math.round(clamp(100 - total, 0, 100));
  const grade: ArchitectureHealth["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "E";

  return {
    score,
    grade,
    deductions,
    cycleCount: input.cycles.length,
    cycleModuleCount: cycleModules.size,
    painfulCount: painful.length,
    uselessCount: useless.length,
    avgDistance: round1(avgDistance * 100) / 100,
  };
}

export const GRADE_COLOR: Record<ArchitectureHealth["grade"], string> = {
  A: "#22c55e",
  B: "#84cc16",
  C: "#f59e0b",
  D: "#f97316",
  E: "#ef4444",
};

export const GRADE_HINT: Record<ArchitectureHealth["grade"], string> = {
  A: "health.grade.A",
  B: "health.grade.B",
  C: "health.grade.C",
  D: "health.grade.D",
  E: "health.grade.E",
};
/** 等级判语（跟随 UI 语言） */
export function gradeHintOf(grade: ArchitectureHealth["grade"]): string {
  return t(GRADE_HINT[grade]);
}
