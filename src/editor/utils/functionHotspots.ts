/**
 * 「函数热点画像」的纯布局引擎（R31）
 *
 * 背景 —— 为什么必须有这个模块：
 * 在 R31 之前，项目里所有复杂度都是**文件级**的：一个 2000 行的文件 CC=180，
 * 画布上显示一个红色方块，然后呢？开发者依然不知道该改哪一行。「文件复杂」
 * 绝大多数时候只说明文件长，真正难维护的是**藏在文件里的那一两个函数**。
 *
 * R31 接入 tree-sitter 之后，后端 file_metrics 的 metadata 里第一次带上了
 * 逐函数明细（名字/起止行/行数/圈复杂度/形参数/嵌套深度）。本模块把这份明细
 * 变成画布上的函数级实体 —— 这是「每一次分析都要落实到代码上」的最直接兑现：
 * 画布上的每一个卡片都对应源码里一个具体函数，双击直接跳到它的定义行。
 *
 * 与 symbolLayout.ts 的分工：
 * - symbolLayout：按 project_symbols 表渲染**结构**（有哪些类/函数/接口），
 *   回答「这个项目长什么样」；
 * - functionHotspots：按 AST 度量渲染**风险**（哪些函数最该改），
 *   回答「我明天上班应该先动哪一行」。
 * 两者数据源不同（符号表 vs AST 度量），不可互相替代。
 *
 * 纯函数、无副作用、不依赖 store，便于单测。
 */

import type { FileMetric, ProjectFile, ProjectSymbol, GitChurn, CallEdge } from "../../services/tauri";
import { parseFileMetricMeta } from "../../services/tauri";

/** 一个函数级热点（画布上的一张函数卡片） */
export interface FunctionHotspot {
  /** 稳定 id：文件 id + 起始行（同文件同名重载也能区分） */
  key: string;
  fileId: string;
  filePath: string;
  fileName: string;
  /** 所属模块（顶层目录名，与 ModuleRenderer / SVG 报告口径一致） */
  moduleName: string;
  name: string;
  /** 定义起始行（双击定位用） */
  line: number;
  endLine: number;
  lines: number;
  cc: number;
  params: number;
  maxNesting: number;
  /** 综合风险分（见 RISK_WEIGHTS 注释） */
  risk: number;
  level: HotspotLevel;
  /** 人话说明「为什么它上榜」，直接进实体 config 供检查器展示 */
  reasons: string[];
  /** 跨文件被调用次数（扇入，>0 说明是被广泛依赖的枢纽函数） */
  callIn: number;
  /** Git 变更频率分（churnScore，>0 说明近期频繁改动） */
  churnScore: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HotspotLevel = "low" | "medium" | "high" | "extreme";

/** 模块分组头 */
export interface HotspotGroupHeader {
  name: string;
  functionCount: number;
  renderedCount: number;
  /** 组内风险分总和（分组排序依据） */
  riskSum: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FunctionHotspotLayout {
  groups: HotspotGroupHeader[];
  nodes: FunctionHotspot[];
  summary: {
    /** 参与统计的 AST 精确解析文件数 */
    astFiles: number;
    /** AST 解析出的函数总数 */
    totalFunctions: number;
    /** 达到关注阈值的函数数 */
    candidates: number;
    rendered: number;
    /** 因上限截断未渲染的函数数 */
    truncated: number;
    byLevel: Record<HotspotLevel, number>;
    /** 风险最高的函数（用于成功文案） */
    worst: FunctionHotspot | null;
    /** 是否因为无人达标而降级展示 Top-N */
    degraded: boolean;
  };
}

// ─── 风险权重 ───
/**
 * 热点风险 = 内禀复杂度 + 扇入权重 + 变更频率权重
 *
 * risk = cc×2 + nesting×4 + ⌊lines/20⌋ + max(0, params−5)×3
 *      + callIn×CALLIN_W + churnScore×CHURN_W
 *
 * 权重取值理由（不是拍脑袋）：
 * - **嵌套权重最高（×4）**：认知复杂度研究一致表明，嵌套对「读懂一段代码要在脑子里
 *   压多少栈」的影响远超分支总数。CC 相同的两个函数，扁平的那个好读得多。
 * - **圈复杂度 ×2**：经典 McCabe 指标，直接对应需要覆盖的测试路径数。
 * - **行数 /20**：长只是弱信号（有些函数就是一长串直白赋值），给低权重但不忽略。
 * - **形参超 5 个才计分**：5 个以内属正常，超出说明职责没拆干净，每多一个 +3。
 * - **扇入 ×2（CALLIN_W）**：被越多函数依赖，改动它的爆炸半径越大——「又复杂又被广泛
 *   依赖」才是真正的高危热点，不是单纯看函数自身有多长。
 * - **变更频率 ×0.5（CHURN_W）**：近期频繁改动的复杂函数，往往意味着它仍在「带病演进」
 *   （需求不稳定 / 补丁叠补丁），是技术债高发区。churnScore 本身量级较大（累计增删行×提交），
 *   给低权重避免淹没内禀复杂度。
 */
export const RISK_WEIGHTS = { cc: 2, nesting: 4, linesPer: 20, paramsFree: 5, paramsOver: 3, callIn: 2, churn: 0.5 } as const;

/** 风险分 → 等级阈值 */
export const RISK_LEVELS: { level: HotspotLevel; min: number }[] = [
  { level: "extreme", min: 60 },
  { level: "high", min: 35 },
  { level: "medium", min: 18 },
  { level: "low", min: 0 },
];

/** 低于此风险分的函数不上画布（否则几千个健康函数会把画布淹掉） */
export const MIN_RISK = 18;

// ─── 布局参数（与 symbolLayout 视觉节奏保持一致）───
export const MAX_MODULES = 12;
export const MAX_PER_MODULE = 12;
export const MAX_TOTAL = 160;
/** 无人达标时的降级展示条数 */
export const DEGRADED_TOP_N = 24;
export const COL_W = 168;
export const COL_PER_ROW = 6;
export const HEADER_H = 26;
export const ROW_H = 76;
export const CARD_W = 152;
export const CARD_H = 46;
export const LEFT = 40;

/** 等级配色（画布卡片边框/底色，与复杂度画像同色系，用户不用重新学一套） */
export const HOTSPOT_COLORS: Record<HotspotLevel, string> = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#f97316",
  extreme: "#ef4444",
};

export const HOTSPOT_LABELS: Record<HotspotLevel, string> = {
  low: "健康",
  medium: "关注",
  high: "偏危险",
  extreme: "急需重构",
};

/** 顶层目录名 = 模块名（与 ModuleRenderer / SceneEditorPage / 报告生成器口径一致） */
function topDirOf(relPath: string): string {
  const seg = relPath.split("/")[0];
  return seg || relPath;
}

export function riskScoreOf(fn: {
  cc: number;
  lines: number;
  params: number;
  maxNesting: number;
  callIn?: number;
  churnScore?: number;
}): number {
  const overParams = Math.max(0, fn.params - RISK_WEIGHTS.paramsFree);
  return (
    fn.cc * RISK_WEIGHTS.cc +
    fn.maxNesting * RISK_WEIGHTS.nesting +
    Math.floor(fn.lines / RISK_WEIGHTS.linesPer) +
    overParams * RISK_WEIGHTS.paramsOver +
    (fn.callIn ?? 0) * RISK_WEIGHTS.callIn +
    (fn.churnScore ?? 0) * RISK_WEIGHTS.churn
  );
}

export function levelOfRisk(risk: number): HotspotLevel {
  for (const l of RISK_LEVELS) {
    if (risk >= l.min) return l.level;
  }
  return "low";
}

/** 生成「为什么它上榜」的人话理由（最多 3 条，按严重度排） */
function reasonsFor(fn: {
  cc: number;
  lines: number;
  params: number;
  maxNesting: number;
  callIn?: number;
  churnScore?: number;
}): string[] {
  const out: { weight: number; text: string }[] = [];
  if (fn.maxNesting > 4) out.push({ weight: fn.maxNesting * 4, text: `嵌套 ${fn.maxNesting} 层` });
  if (fn.cc > 10) out.push({ weight: fn.cc * 2, text: `圈复杂度 ${fn.cc}` });
  if ((fn.callIn ?? 0) > 0) out.push({ weight: (fn.callIn ?? 0) * 2, text: `被 ${fn.callIn} 处调用（枢纽）` });
  if (fn.lines > 80) out.push({ weight: fn.lines / 20, text: `${fn.lines} 行` });
  if ((fn.churnScore ?? 0) > 0) out.push({ weight: (fn.churnScore ?? 0) * 0.5, text: `变更频繁（churn ${Math.round(fn.churnScore ?? 0)}）` });
  if (fn.params > 5) out.push({ weight: (fn.params - 5) * 3, text: `${fn.params} 个形参` });
  if (out.length === 0) {
    // 没触发任何单项阈值但综合分不低 —— 说明是「哪项都不算离谱，但加起来就累」
    out.push({ weight: 1, text: `CC ${fn.cc} / 嵌套 ${fn.maxNesting} / ${fn.lines} 行` });
  }
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((r) => r.text);
}

/**
 * 核心入口：AST 文件度量 → 函数级热点布局。
 *
 * @param metrics 全部文件度量（内部只取 engine === "ast" 的，heuristic 没有函数明细）
 * @param files   扫描文件（取文件名 / 相对路径 / 模块归属）
 * @param symbols 结构符号（AST 缺失时兜底生成方法级热点）
 * @param callEdges 调用边（用于按 name+fileId 算函数扇入 callIn）
 * @param churn   Git 变更频率（按 fileId 映射到函数，体现"带病演进"热点）
 */
export function buildFunctionHotspots(
  metrics: FileMetric[],
  files: ProjectFile[],
  symbols: ProjectSymbol[] = [],
  callEdges: CallEdge[] = [],
  churn: GitChurn[] = []
): FunctionHotspotLayout {
  const fileById = new Map(files.map((f) => [f.id, f]));
  const all: FunctionHotspot[] = [];
  let astFiles = 0;
  let totalFunctions = 0;

  // 扇入：按 calleeName+calleeFileId 聚合（AST 函数无 symbolId，用 name+file 近似匹配）
  const callInByFn = new Map<string, number>();
  for (const e of callEdges) {
    if (e.kind !== "cross-file") continue;
    const key = `${e.calleeName}@${e.calleeFileId}`;
    callInByFn.set(key, (callInByFn.get(key) ?? 0) + 1);
  }
  // 变更频率：按 fileId 聚合 churnScore
  const churnByFile = new Map<string, number>();
  for (const c of churn) {
    churnByFile.set(c.fileId, (churnByFile.get(c.fileId) ?? 0) + c.churnScore);
  }

  for (const m of metrics) {
    if (m.engine !== "ast") continue;
    const meta = parseFileMetricMeta(m);
    const fns = meta.functions ?? [];
    if (fns.length === 0) continue;
    astFiles += 1;
    const f = fileById.get(m.fileId);
    const relPath = f?.relPath ?? m.filePath;
    const fileName = f?.name ?? relPath.split("/").pop() ?? relPath;
    const ciFile = churnByFile.get(m.fileId) ?? 0;
    for (const fn of fns) {
      totalFunctions += 1;
      const callIn = callInByFn.get(`${fn.name}@${m.fileId}`) ?? 0;
      const risk = riskScoreOf({ ...fn, callIn, churnScore: ciFile });
      all.push({
        key: `${m.fileId}:${fn.line}`,
        fileId: m.fileId,
        filePath: relPath,
        fileName,
        moduleName: topDirOf(relPath),
        name: fn.name,
        line: fn.line,
        endLine: fn.endLine,
        lines: fn.lines,
        cc: fn.cc,
        params: fn.params,
        maxNesting: fn.maxNesting,
        risk,
        level: levelOfRisk(risk),
        reasons: reasonsFor({ ...fn, callIn, churnScore: ciFile }),
        callIn,
        churnScore: ciFile,
        x: 0,
        y: 0,
        width: CARD_W,
        height: CARD_H,
      });
    }
  }

  // v2.5 heuristic 语言兜底：AST 函数明细为空（无 tree-sitter 支持）时，
  // 用结构分析的方法/函数符号 + 调用入度生成方法级热点 —— 否则这类语言
  // 的热点画像永远退化成「暂无 AST 数据」。风险近似：被调用越多 + 体量越大 + 变更频繁。
  if (all.length === 0 && symbols.length > 0) {
    const callInBySym = new Map<string, number>();
    for (const e of callEdges) {
      if (e.kind !== "cross-file") continue;
      if (e.calleeSymbolId) callInBySym.set(e.calleeSymbolId, (callInBySym.get(e.calleeSymbolId) ?? 0) + 1);
    }
    for (const s of symbols) {
      if (s.kind !== "function" && s.kind !== "method") continue;
      const f = fileById.get(s.fileId);
      const relPath = f?.relPath ?? s.filePath;
      const span = Math.max(1, s.lineEnd - s.lineStart);
      const ci = callInBySym.get(s.id) ?? 0;
      const ciFile = churnByFile.get(s.fileId) ?? 0;
      const risk = ci * 3 + span / 40 + ciFile * RISK_WEIGHTS.churn;
      if (risk < 1) continue;
      totalFunctions += 1;
      all.push({
        key: `sym:${s.id}`,
        fileId: s.fileId,
        filePath: relPath,
        fileName: f?.name ?? relPath.split("/").pop() ?? relPath,
        moduleName: topDirOf(relPath),
        name: s.name,
        line: s.lineStart,
        endLine: s.lineEnd,
        lines: span,
        cc: 0,
        params: 0,
        maxNesting: 0,
        risk,
        level: levelOfRisk(risk),
        reasons: [`被调用 ${ci} 次`, `${span} 行`],
        callIn: ci,
        churnScore: ciFile,
        x: 0,
        y: 0,
        width: CARD_W,
        height: CARD_H,
      });
    }
  }

  const emptyLayout = (): FunctionHotspotLayout => ({
    groups: [],
    nodes: [],
    summary: {
      astFiles,
      totalFunctions,
      candidates: 0,
      rendered: 0,
      truncated: 0,
      byLevel: { low: 0, medium: 0, high: 0, extreme: 0 },
      worst: null,
      degraded: false,
    },
  });

  if (all.length === 0) return emptyLayout();

  // ─── 候选筛选：默认只看 medium 以上；一个都没有就降级展示 Top-N ───
  let degraded = false;
  let candidates = all.filter((h) => h.risk >= MIN_RISK);
  if (candidates.length === 0) {
    degraded = true;
    candidates = all.slice().sort((a, b) => b.risk - a.risk).slice(0, DEGRADED_TOP_N);
  }
  const candidateCount = candidates.length;

  // ─── 按模块分组，组内按风险降序 ───
  const byModule = new Map<string, FunctionHotspot[]>();
  for (const h of candidates) {
    const list = byModule.get(h.moduleName) ?? [];
    list.push(h);
    byModule.set(h.moduleName, list);
  }
  const moduleEntries = Array.from(byModule.entries())
    .map(([name, list]) => {
      const sorted = list.slice().sort((a, b) => b.risk - a.risk || a.filePath.localeCompare(b.filePath));
      return { name, list: sorted, riskSum: sorted.reduce((acc, h) => acc + h.risk, 0) };
    })
    .sort((a, b) => b.riskSum - a.riskSum)
    .slice(0, MAX_MODULES);

  // ─── 排布：每模块一个分组头 + 网格卡片 ───
  const groups: HotspotGroupHeader[] = [];
  const nodes: FunctionHotspot[] = [];
  let y = 40;
  let placed = 0;

  for (const mod of moduleEntries) {
    if (placed >= MAX_TOTAL) break;
    const room = Math.min(MAX_PER_MODULE, MAX_TOTAL - placed);
    const take = mod.list.slice(0, room);
    if (take.length === 0) continue;

    const rows = Math.ceil(take.length / COL_PER_ROW);
    const groupH = HEADER_H + rows * ROW_H;
    groups.push({
      name: mod.name,
      functionCount: mod.list.length,
      renderedCount: take.length,
      riskSum: mod.riskSum,
      x: LEFT,
      y,
      width: COL_PER_ROW * COL_W,
      height: HEADER_H,
    });

    take.forEach((h, i) => {
      const col = i % COL_PER_ROW;
      const row = Math.floor(i / COL_PER_ROW);
      nodes.push({
        ...h,
        x: LEFT + col * COL_W,
        y: y + HEADER_H + 12 + row * ROW_H,
      });
    });
    placed += take.length;
    y += groupH + 24;
  }

  const byLevel: Record<HotspotLevel, number> = { low: 0, medium: 0, high: 0, extreme: 0 };
  for (const h of nodes) byLevel[h.level] += 1;
  const worst = nodes.slice().sort((a, b) => b.risk - a.risk)[0] ?? null;

  return {
    groups,
    nodes,
    summary: {
      astFiles,
      totalFunctions,
      candidates: candidateCount,
      rendered: nodes.length,
      truncated: Math.max(0, candidateCount - nodes.length),
      byLevel,
      worst,
      degraded,
    },
  };
}
