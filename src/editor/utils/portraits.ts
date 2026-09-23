/**
 * 画布画像引擎（统一入口）
 *
 * 「画像」= 把某一维分析数据变成画布上的空间秩序：**排序决定位置，等级决定颜色，
 * 计数决定徽标**。此前复杂度画像、技术债画像各写一份 80 行的重复布局代码，
 * 每加一种画像就复制一次，配置字段还容易漏掉 —— 本模块把这套流程收成一个
 * 声明式表：新增画像只要写一条 PORTRAIT_SPECS 记录。
 *
 * 覆盖的画像维度：
 * - complexity：圈复杂度（哪里最难懂）
 * - techDebt：TODO/FIXME 密度（哪里欠账最多）
 * - churn：git 变更热度（哪里在快速变坏）
 * - deadCode：零引用符号（哪里是死肉）
 * - risk：审查发现严重度加权（哪里最危险）
 * - duplication：代码克隆重复率（哪里在复制粘贴）
 * - callGraph：函数调用链（谁在支撑谁）—— 带连线，单独实现
 * - architecture：模块 × 分层 × 依赖边（项目骨架）—— 带连线，单独实现
 * - dependency：文件级依赖图，力导向聚簇 + Tarjan 环检测 —— 带连线，单独实现
 * - layering：文件按架构分层归位 + 分层违规检测 —— 带连线，单独实现
 * - coupling：主序图（抽象度 × 不稳定性），架构形状体检 —— 带连线，单独实现
 * - quadrant：重构四象限（变更热度 × 复杂度），回答「先重构谁」—— 二维散点
 * - impact：变更影响面（以某符号/文件为中心的上下游调用链）—— 需指定目标，
 *           不走 runPortrait 而是 runImpactPortraitFor
 *
 * 每个 analyzer 插件注册的视角模板（architecture / dependency / layering /
 * complexity / unsafe-risk / call-graph）都能在这里找到对应画像，
 * 保证「新建视角 → 立刻有内容」，不会出现空白画布。
 */

import { useEditorStore, type BulkComponentInput } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { useSceneStore } from "../../store/sceneStore";
import { entityTypeForFile } from "./fileKind";
import { receiverQualifiedName } from "./callEdgeReceiver";
import {
  buildFileInsights,
  duplicationLevelOf,
  emptyFileInsight,
  QUADRANT_HINT,
  QUADRANT_HINT_RISK,
  QUADRANT_HINT_DUP,
  QUADRANT_HINT_SIZE,
  QUADRANT_META,
  PATTERN_CATEGORY_LABEL_KEY,
  PATTERN_CATEGORY_COLORS,
  PATTERN_CATEGORY_ORDER,
  patternCategoryOf,
  patternColorOf,
  patternLabel,
  type FileInsight,
  type RiskQuadrant,
} from "./fileInsights";
import {
  analyzeImpact,
  buildCallIndex,
  impactLevelOf,
  traverseImpact,
  IMPACT_LEVEL_META,
  impactLevelLabel,
  type ImpactNode,
} from "./impactGraph";
import {
  buildModuleGraph,
  computeModuleCoupling,
  findCycles,
  ZONE_COLOR,
  zoneLabelOf,
} from "./architectureMetrics";
import { forceDirectedLayout, layeredLayout, separateOverlaps } from "./forceLayout";
import { buildDirectoryTree, flattenDirectoryTree, type DirNode } from "./directoryTree";
import { summarizeTechDebt, formatDebtHours } from "./techDebtScore";
import { buildSymbolCallEdges, buildModuleDeps, buildInheritanceEdges, buildSymbolLayout, computeFileCohesion, detectModuleCycles, entityTypeForSymbolKind, MAX_SYMBOLS_PER_FILE, summarizeModuleDeps, type SymbolGroupHeader } from "./symbolLayout";
import {
  buildFunctionHotspots,
  HOTSPOT_COLORS,
  HOTSPOT_LABELS,
} from "./functionHotspots";
import {
  buildFlowPortrait,
  summarizeFlowPortrait,
  FLOW_ROLE_COLOR,
  FLOW_ROLE_HINT,
  FLOW_ROLE_LABEL,
  FLOW_ROLE_LEVEL,
  FLOW_ROLE_ORDER,
} from "./dataFlowPortrait";
import {
  buildTaintPaths,
  filterTaintPaths,
  layoutTaintPaths,
  SINK_KIND_COLOR,
  SINK_KIND_LABEL,
  TAINT_ROLE_COLOR,
  TAINT_ROLE_LABEL,
  type TaintEndKind,
  type TaintLayoutNode,
  type TaintView,
} from "./taintFlow";
import { projectScanApi, type ProjectFile, type ProjectSymbol, type SourceFileContent } from "../../services/tauri";
import { t, resolveFragments } from "../../i18n";
import { useToastStore } from "../../store/toastStore";

/** 网格式画像：单一维度排序 → 网格排布，无连线 */
export type GridPortraitKind =
  | "complexity"
  | "techDebt"
  | "churn"
  | "deadCode"
  | "syntax"
  | "risk"
  | "duplication";
/** 图式画像：带连线，各有专属布局 */
export type GraphPortraitKind =
  | "callGraph"
  | "callGraph_redetect"
  | "architecture"
  | "dependency"
  | "layering"
  | "coupling"
  | "changeCoupling"
  | "quadrant"
  | "directory";
/** 设计模式画像：无连线，按分类分区栅格排布（单独实现，见 runPatternsPortrait） */
export type PatternPortraitKind = "patterns";
/** 代码结构画像：符号级实体（class/function/interface 等）按文件分组排布（单独实现） */
export type SymbolPortraitKind = "symbols";
/** 函数热点画像：AST 逐函数度量 → 风险排序的函数级实体（R31，单独实现） */
export type FunctionPortraitKind = "hotspotFunctions" | "hotspotFunctions_redetect";
/** 数据流画像：函数摘要按污点角色分三区（R36，单独实现，见 runDataFlowPortrait） */
export type DataFlowPortraitKind = "dataFlow" | "dataFlow_redetect";
export type PortraitKind =
  | GridPortraitKind
  | GraphPortraitKind
  | PatternPortraitKind
  | SymbolPortraitKind
  | FunctionPortraitKind
  | DataFlowPortraitKind
  | "moduleGraph"
  | "testCoverage"
  | "security"
  | "apiSurface"
  | "busFactor"
  | "ripple"
  | "executionFlow"
  | "apiTrace"
  | "taintFlow"
  | "docsCoverage"
  | "errorHandling"
  | "logging"
  | "commentRatio"
  | "patterns_redetect";
/**
 * 需要「指定目标」才能生成的画像：不出现在画像菜单里（菜单项没有上下文），
 * 由影响面面板 / 画布右键菜单在选中实体后触发。
 */
export type TargetedPortraitKind = "impact";
/** 写进实体 config.portraitMode 的取值域 */
export type PortraitMode = PortraitKind | TargetedPortraitKind;

export interface PortraitOutcome {
  ok: boolean;
  message: string;
  severity: "success" | "info" | "warning";
  /** 实际落在画布上的实体数 */
  placed: number;
}

interface PortraitSpec {
  labelKey: string;
  cols: number;
  colW: number;
  rowH: number;
  /** 参与画像的文件筛选（返回 false 则不上画布） */
  include?: (ins: FileInsight) => boolean;
  /** 排序：返回负数表示 a 靠前 */
  rank: (a: FileInsight, b: FileInsight) => number;
  /** 空结果时的提示 */
  emptyHintKey: string;
  /** 成功文案 */
  summarize: (rows: { file: ProjectFile; ins: FileInsight }[]) => string;
}

const PORTRAIT_SPECS: Record<GridPortraitKind, PortraitSpec> = {
  complexity: {
    labelKey: "portrait.spec.complexity.label",
    cols: 8,
    colW: 190,
    rowH: 76,
    rank: (a, b) => b.complexity - a.complexity,
    emptyHintKey: "portrait.spec.complexity.empty",
    summarize: (rows) => {
      const risky = rows.filter(
        (r) => r.ins.complexityLevel === "extreme" || r.ins.complexityLevel === "high"
      ).length;
      return t("portrait.spec.complexity.done", {
        n: rows.length,
        risky: risky > 0 ? t("portrait.spec.complexity.risky", { n: risky }) : "",
      });
    },
  },
  techDebt: {
    labelKey: "portrait.spec.techDebt.label",
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.techDebtCount > 0,
    rank: (a, b) => b.techDebtCount - a.techDebtCount,
    emptyHintKey: "portrait.spec.techDebt.empty",
    summarize: (rows) => {
      const total = rows.reduce((acc, r) => acc + r.ins.techDebtCount, 0);
      // 需求点 C：技术债量化为「预计清偿工时」（SQALE 口径，纯前端聚合）
      const debt = useProjectStore.getState().techDebt;
      const hours = summarizeTechDebt(debt).hours;
      return t("portrait.spec.techDebt.done", {
        n: rows.length,
        total,
        hours: hours > 0 ? t("portrait.spec.techDebt.hours", { h: formatDebtHours(hours) }) : "",
      });
    },
  },
  churn: {
    labelKey: "portrait.spec.churn.label",
    cols: 7,
    colW: 195,
    rowH: 78,
    include: (ins) => ins.churnScore > 0,
    rank: (a, b) => b.churnScore - a.churnScore,
    emptyHintKey: "portrait.spec.churn.empty",
    summarize: (rows) => {
      const first = rows.filter((r) => r.ins.quadrant === "refactorFirst").length;
      const commits = rows.reduce((acc, r) => acc + r.ins.commitCount, 0);
      return t("portrait.spec.churn.done", {
        n: rows.length,
        commits,
        first: first > 0 ? t("portrait.spec.churn.refactorFirst", { n: first }) : "",
      });
    },
  },
  deadCode: {
    labelKey: "portrait.spec.deadCode.label",
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.deadCount > 0,
    rank: (a, b) => b.deadCount - a.deadCount,
    emptyHintKey: "portrait.spec.deadCode.empty",
    summarize: (rows) => {
      const total = rows.reduce((acc, r) => acc + r.ins.deadCount, 0);
      return t("portrait.spec.deadCode.done", { n: rows.length, total });
    },
  },
  syntax: {
    labelKey: "portrait.spec.syntax.label",
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.syntaxErrorCount > 0,
    rank: (a, b) => b.syntaxErrorCount - a.syntaxErrorCount,
    emptyHintKey: "portrait.spec.syntax.empty",
    summarize: (rows) => {
      const total = rows.reduce((acc, r) => acc + r.ins.syntaxErrorCount, 0);
      return t("portrait.spec.syntax.done", { n: rows.length, total });
    },
  },
  risk: {
    labelKey: "portrait.spec.risk.label",
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.riskScore > 0,
    rank: (a, b) => b.riskScore - a.riskScore,
    emptyHintKey: "portrait.spec.risk.empty",
    summarize: (rows) => {
      const err = rows.reduce((acc, r) => acc + r.ins.findingSeverities.error, 0);
      const warn = rows.reduce((acc, r) => acc + r.ins.findingSeverities.warning, 0);
      return t("portrait.spec.risk.done", { n: rows.length, err, warn });
    },
  },
  duplication: {
    labelKey: "portrait.spec.duplication.label",
    cols: 6,
    colW: 200,
    rowH: 80,
    include: (ins) => ins.cloneCount > 0,
    // 先按重复率排，重复率相同再按绝对重复行数 —— 只按行数排会让
    // 一个 3000 行的巨型文件里 60 行重复排在 80 行文件里 50 行重复的前面，
    // 但后者的「烂」程度显然更高。
    rank: (a, b) => b.duplicationRatio - a.duplicationRatio || b.duplicatedLines - a.duplicatedLines,
    emptyHintKey: "portrait.spec.duplication.empty",
    summarize: (rows) => {
      const blocks = rows.reduce((acc, r) => acc + r.ins.cloneCount, 0);
      const lines = rows.reduce((acc, r) => acc + r.ins.duplicatedLines, 0);
      const type2 = rows.reduce((acc, r) => acc + r.ins.cloneType2Count, 0);
      const worst = rows[0];
      return t("portrait.spec.duplication.done", {
        n: rows.length,
        blocks,
        lines,
        type2: type2 > 0 ? t("portrait.spec.duplication.type2", { n: type2 }) : "",
        worst: worst ? t("portrait.spec.duplication.worst", { name: worst.file.name, pct: (worst.ins.duplicationRatio * 100).toFixed(0) }) : "",
      });
    },
  },
};

/** 用当前 store 里的全量分析数据构建画像映射 */
export function currentInsights(): Map<string, FileInsight> {
  const pst = useProjectStore.getState();
  return buildFileInsights(
    pst.files,
    pst.symbols,
    pst.patternHits,
    pst.symbolRefs,
    pst.metrics,
    pst.techDebt,
    pst.gitChurn,
    pst.callEdges,
    pst.deadSymbols,
    pst.findings,
    pst.clones
  );
}

/** 把画像数据写进实体 config（渲染器读取的统一契约；模块下钻等外部路径复用同一口径） */
export function fileConfig(
  f: ProjectFile,
  ins: FileInsight,
  portraitMode: PortraitMode,
  extra?: Record<string, unknown>
) {
  return {
    fileName: f.name,
    language: f.language,
    fileSize: f.size,
    filePath: f.relPath,
    fileId: f.id,
    lineCount: f.lineCount,
    projectLayerId: f.layerId,
    symbolCount: ins.symbolCount,
    patternNames: ins.patternNames,
    refCount: ins.refCount,
    complexity: ins.complexity,
    complexityLevel: ins.complexityLevel,
    complexityEngine: ins.complexityEngine,
    syntaxErrorCount: ins.syntaxErrorCount,
    syntaxErrorLines: ins.syntaxErrorLines,
    techDebtCount: ins.techDebtCount,
    churnScore: ins.churnScore,
    churnLevel: ins.churnLevel,
    commitCount: ins.commitCount,
    authorCount: ins.authorCount,
    callIn: ins.callIn,
    callOut: ins.callOut,
    deadCount: ins.deadCount,
    cloneCount: ins.cloneCount,
    duplicatedLines: ins.duplicatedLines,
    duplicationRatio: ins.duplicationRatio,
    duplicationLevel: duplicationLevelOf(ins.duplicationRatio),
    quadrant: ins.quadrant,
    findingCount: ins.findingCount,
    riskScore: ins.riskScore,
    errorCount: ins.findingSeverities.error,
    warningCount: ins.findingSeverities.warning,
    portraitMode,
    ...(extra ?? {}),
  };
}

async function persist(analysisId: string, tag: string) {
  // 落库缓冲：所有 place/connect 收集的实体在此一次性写入（单条历史、单次 set）
  flushPending(analysisId);
  try {
    const { views, globalComponents, activeViewId } = useEditorStore.getState().exportSceneWithViews();
    await useSceneStore.getState().updateScene(analysisId, {
      views,
      globalComponents,
      activeViewId,
    } as any);
  } catch (e) {
    console.error(`[portraits] persist ${tag} failed`, e);
  }
  // 统筹全局：画像重建后自动「适应视口」，让整幅画像进入视野
  useEditorStore.getState().requestFit();
}

/** 等级 → 语义色（与 FileRenderer 热度档一致） */
const GRID_TIER_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  extreme: "#ef4444",
};

/** 画像红/橙阈值集中（便于调参，避免散落魔法数字）。仅覆盖本项目新增画像；risk/techDebt 复用既有 GRID_TIER_COLOR。 */
const PORTRAIT_THRESHOLDS = {
  security: { red: 6, orange: 2 },
  apiSurface: { red: 12, orange: 4 },
  ripple: { red: 30, orange: 8 },
  deadCode: { red: 10, orange: 2 }, // 零引用符号数量分档
  errorHandling: { red: 5, orange: 2 },
  logging: { red: 8, orange: 3 }, // console 泄漏 + 吞 error 日志合计
};

/** 网格画像的精准着色 + 徽标：把单维指标翻译成「色条 + 卡上主指标 + 悬浮详情」 */
function gridStyle(kind: GridPortraitKind, ins: FileInsight): {
  accentColor: string;
  metricBadge: string;
  metricTitle: string;
} {
  switch (kind) {
    case "complexity":
      return {
        accentColor: GRID_TIER_COLOR[ins.complexityLevel] ?? "#22c55e",
        metricBadge: `CC${ins.complexity}`,
        metricTitle: t("portrait.metric.complexity", { n: ins.complexity, level: ins.complexityLevel }),
      };
    case "techDebt":
      return {
        accentColor: ins.techDebtCount >= 10 ? "#ef4444" : ins.techDebtCount >= 4 ? "#f97316" : "#eab308",
        metricBadge: t("portrait.metric.debtBadge", { n: ins.techDebtCount }),
        metricTitle: t("portrait.metric.techDebt", { n: ins.techDebtCount }),
      };
    case "churn":
      return {
        accentColor: GRID_TIER_COLOR[ins.churnLevel] ?? "#22c55e",
        metricBadge: t("portrait.metric.churnBadge", { n: ins.commitCount }),
        metricTitle: t("portrait.metric.churn", { n: ins.commitCount, level: ins.churnLevel }),
      };
    case "deadCode": {
      const n = ins.deadCount;
      const color =
        n >= PORTRAIT_THRESHOLDS.deadCode.red
          ? "#ef4444"
          : n >= PORTRAIT_THRESHOLDS.deadCode.orange
          ? "#f59e0b"
          : "#22c55e";
      const level =
        n >= PORTRAIT_THRESHOLDS.deadCode.red
          ? t("portrait.metric.deadLevelHigh")
          : n >= PORTRAIT_THRESHOLDS.deadCode.orange
          ? t("portrait.metric.deadLevelMid")
          : t("portrait.metric.deadLevelLow");
      return {
        accentColor: color,
        metricBadge: t("portrait.metric.deadBadge", { n }),
        metricTitle: t("portrait.metric.deadCode", { n, level }),
      };
    }
    case "syntax": {
      const n = ins.syntaxErrorCount;
      return {
        accentColor: n > 0 ? "#ef4444" : "#22c55e",
        metricBadge: `✕${n}`,
        metricTitle: t("portrait.metric.syntax", { n }),
      };
    }
    case "risk":
      return {
        accentColor: ins.riskScore >= 40 ? "#ef4444" : ins.riskScore >= 15 ? "#f97316" : "#eab308",
        metricBadge: `⚠${ins.findingCount}`,
        metricTitle: t("portrait.metric.risk", { e: ins.findingSeverities.error, w: ins.findingSeverities.warning, s: ins.riskScore }),
      };
    case "duplication":
      return {
        accentColor: GRID_TIER_COLOR[duplicationLevelOf(ins.duplicationRatio)] ?? "#22c55e",
        metricBadge: t("portrait.metric.cloneBadge", { n: ins.cloneCount }),
        metricTitle: t("portrait.metric.duplication", { n: ins.cloneCount, lines: ins.duplicatedLines, pct: Math.round(ins.duplicationRatio * 100) }),
      };
  }
}

/** 网格式文件画像（complexity / techDebt / churn / deadCode / risk / duplication 共用）
 * 统一走 renderMetricPortrait → 一次性 addComponentsBulk 落库，不再逐条 addComponent（避开 O(N²)）。 */
async function runGridPortrait(
  kind: GridPortraitKind,
  analysisId: string
): Promise<PortraitOutcome> {
  const spec = PORTRAIT_SPECS[kind];
  const pst = useProjectStore.getState();
  const insights = currentInsights();

  const rows = pst.files
    .filter((f) => !f.isDirectory)
    .map((f) => ({ file: f, ins: insights.get(f.id) ?? emptyFileInsight() }))
    .filter((r) => (spec.include ? spec.include(r.ins) : true))
    .sort((a, b) => spec.rank(a.ins, b.ins))
    .map(({ file, ins }) => ({ file, ins, ...gridStyle(kind, ins) }));

  if (rows.length === 0) {
    return { ok: false, message: t(spec.emptyHintKey), severity: "info", placed: 0 };
  }

  return renderMetricPortrait(kind, analysisId, rows, {
    cols: spec.cols,
    colW: spec.colW,
    rowH: spec.rowH,
    emptyHint: t(spec.emptyHintKey),
    summarize: spec.summarize,
  });
}

/**
 * 调用链画像：以「调用入度最高的文件」为核心节点，画出跨文件调用边
 *
 * 布局用同心环而非网格 —— 调用图关心的是中心性，环形能一眼看出
 * 哪些文件是被围绕的基础设施。上限 60 个节点，超出会糊成一团。
 */
async function runCallGraphPortrait(
  analysisId: string,
  force = false
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let edges = pst.callEdges.filter((e) => e.kind === "cross-file");

  // 自愈：store 为空（扫描漏跑 callGraph 阶段 / 增量未带出）时主动重拉一次再渲染，
  // 避免用户永远看到「无数据」且无入口强刷（与设计模式/数据流同思路）。
  // force=true（菜单「调用链（重新分析）」）无论是否为空都强制重拉，确保刷新生效。
  if (force || edges.length === 0) {
    try {
      await pst.analyzeCallGraph(analysisId, undefined);
      await pst.loadCallEdges(analysisId);
      edges = useProjectStore.getState().callEdges.filter((e) => e.kind === "cross-file");
    } catch (err) {
      console.error("[runCallGraphPortrait] 自愈重拉 callGraph 失败", err);
    }
  }

  if (edges.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.callGraphNoData"),
      severity: "info",
      placed: 0,
    };
  }

  const insights = currentInsights();
  const fileById = new Map(pst.files.map((f) => [f.id, f]));

  // 参与节点：出现在跨文件调用边两端的文件，按（入度+出度）取前 60
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.callerFileId, (degree.get(e.callerFileId) || 0) + 1);
    degree.set(e.calleeFileId, (degree.get(e.calleeFileId) || 0) + 1);
  }
  const nodes = Array.from(degree.entries())
    .filter(([id]) => fileById.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([id]) => fileById.get(id)!);

  if (nodes.length === 0) {
    return { ok: false, message: t("portrait.msg.callGraphStale"), severity: "warning", placed: 0 };
  }

  clearCanvas();

  // 同心环布局：入度前 8 名放内环（基础设施），其余放外环
  const NODE_W = 170;
  const NODE_H = 64;
  const CX = 620;
  const CY = 460;
  const placedPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const inner = nodes.slice(0, Math.min(8, nodes.length));
  const outer = nodes.slice(inner.length);

  const layout = (list: ProjectFile[], radius: number, phase: number) => {
    list.forEach((f, i) => {
      const angle = phase + (2 * Math.PI * i) / Math.max(list.length, 1);
      const x = CX + radius * Math.cos(angle) - NODE_W / 2;
      const y = CY + radius * 0.62 * Math.sin(angle) - NODE_H / 2;
      const ins = insights.get(f.id) ?? emptyFileInsight();
      place("file", { x, y }, f.name, fileConfig(f, ins, "callGraph"));
      placedPos.set(f.id, { x, y, w: NODE_W, h: NODE_H });
    });
  };
  layout(inner, 210, -Math.PI / 2);
  layout(outer, 460, -Math.PI / 2 + 0.2);

  // 聚合文件级调用边（同一对文件只画一条，标注调用的函数名）
  const pairs = new Map<string, { from: string; to: string; names: Set<string>; count: number }>();
  for (const e of edges) {
    if (!placedPos.has(e.callerFileId) || !placedPos.has(e.calleeFileId)) continue;
    if (e.callerFileId === e.calleeFileId) continue;
    const key = `${e.callerFileId}->${e.calleeFileId}`;
    const cur = pairs.get(key) || {
      from: e.callerFileId,
      to: e.calleeFileId,
      names: new Set<string>(),
      count: 0,
    };
    // 接收者限定名：同名 sink（child_process.exec / re.exec）经 calleeReceiver 区分，
    // 避免文件级调用边标签合并成无意义的裸 `exec`（P1 · 对标 joern CALL.methodFullName）。
    cur.names.add(receiverQualifiedName(e.calleeName, e.calleeReceiver));
    cur.count += 1;
    pairs.set(key, cur);
  }

  let edgeCount = 0;
  for (const p of pairs.values()) {
    const a = placedPos.get(p.from)!;
    const b = placedPos.get(p.to)!;
    connect(
      a,
      b,
      `${fileById.get(p.from)?.name} → ${fileById.get(p.to)?.name}`,
      {
        depType: "call",
        isCircular: false,
        fromFileId: p.from,
        toFileId: p.to,
        symbolNames: Array.from(p.names).slice(0, 5),
        callCount: p.count,
      }
    );
    edgeCount += 1;
  }

  // ── 符号级调用链（下钻，呼应「链」字）──
  // 同心环是文件级宏观骨架；这里取高频被调枢纽符号（topCallees），从 cross-file 边溯源其
  // 调用者，画出 caller → callee 的「入链」；并取高频出度枢纽（topCallers）画出 hub → callee
  // 的「出链」，让"谁在支撑谁 / 谁扩散到哪"双向可探索。
  // 节点带 symbolId+fileId+lineStart → 双击直达函数定义行；边带 fromFileId/toFileId 复用高亮。
  const SYM_W = 210;
  const SYM_H = 52;
  const symbolById = new Map(pst.symbols.map((s) => [s.id, s]));
  const topCallees = pst.callGraphSummary?.topCallees ?? [];
  const topCallers = pst.callGraphSummary?.topCallers ?? [];
  let symChainNodes = 0;
  let symChainEdges = 0;

  // 入链区（谁在调用这些枢纽函数）：caller(左) → 枢纽(右)
  if (topCallees.length > 0) {
    const CHAIN_Y = CY + 460 + 40; // 同心环下方留白后起链
    place("layer-marker", { x: 40, y: CHAIN_Y - 34 }, t("portrait.msg.callChainZoneIn"), {
      layerName: t("portrait.msg.callChainZoneIn"),
      layerColor: "#7c3aed",
      layerOrder: 0,
      fileCount: topCallees.length,
      description: t("portrait.msg.callChainHintIn"),
      portraitMode: "callGraph",
    });
    const perChainGap = SYM_H + 30;
    topCallees.slice(0, 6).forEach((hot, idx) => {
      const calleeSym = symbolById.get(hot.symbolId);
      const calleeFileId = calleeSym?.fileId ?? null;
      const calleeLine = calleeSym?.lineStart ?? null;
      const chainY = CHAIN_Y + idx * perChainGap;
      const calleeX = 40 + (SYM_W + 120) * 2; // 链尾（枢纽）最右
      const calleeId = place(
        "function",
        { x: calleeX, y: chainY },
        hot.name,
        {
          name: hot.name,
          symbolKind: calleeSym?.kind ?? "function",
          fileId: calleeFileId,
          filePath: calleeSym?.filePath ?? hot.filePath,
          lineStart: calleeLine,
          callIn: hot.count,
          portraitMode: "callGraph",
          isChainHub: true,
        },
        { w: SYM_W, h: SYM_H }
      );
      if (!calleeId) return;
      symChainNodes += 1;
      const callers = edges
        .filter((e) => e.calleeSymbolId === hot.symbolId && e.callerFileId !== e.calleeFileId)
        .slice(0, 3);
      callers.forEach((e, ci) => {
        const callerSym = symbolById.get(e.callerSymbolId);
        const callerX = 40 + ci * (SYM_W + 120);
        const callerId = place(
          "function",
          { x: callerX, y: chainY },
          e.callerName,
          {
            name: e.callerName,
            symbolKind: callerSym?.kind ?? "function",
            fileId: e.callerFileId,
            filePath: e.callerFilePath,
            lineStart: callerSym?.lineStart ?? null,
            portraitMode: "callGraph",
          },
          { w: SYM_W, h: SYM_H }
        );
        if (!callerId) return;
        symChainNodes += 1;
        const ca = { x: callerX, y: chainY, w: SYM_W, h: SYM_H };
        const cb = { x: calleeX, y: chainY, w: SYM_W, h: SYM_H };
        connect(ca, cb, `${e.callerName} → ${hot.name}`, {
          depType: "call",
          isCircular: false,
          fromFileId: e.callerFileId,
          toFileId: e.calleeFileId,
          symbolNames: [hot.name],
          callCount: 1,
        });
        symChainEdges += 1;
      });
    });

    // 出链区（这些枢纽函数又扩散调用了谁）：枢纽(左) → callee(右)，位于入链区下方
    if (topCallers.length > 0) {
      const OUT_Y = CHAIN_Y + 6 * perChainGap + 40;
      place("layer-marker", { x: 40, y: OUT_Y - 34 }, t("portrait.msg.callChainZoneOut"), {
        layerName: t("portrait.msg.callChainZoneOut"),
        layerColor: "#0ea5e9",
        layerOrder: 1,
        fileCount: topCallers.length,
        description: t("portrait.msg.callChainHintOut"),
        portraitMode: "callGraph",
      });
      topCallers.slice(0, 6).forEach((hot, idx) => {
        const callerSym = symbolById.get(hot.symbolId);
        const callerFileId = callerSym?.fileId ?? null;
        const callerLine = callerSym?.lineStart ?? null;
        const chainY = OUT_Y + idx * perChainGap;
        const callerX = 40; // 链头（枢纽）最左
        const callerId = place(
          "function",
          { x: callerX, y: chainY },
          hot.name,
          {
            name: hot.name,
            symbolKind: callerSym?.kind ?? "function",
            fileId: callerFileId,
            filePath: callerSym?.filePath ?? hot.filePath,
            lineStart: callerLine,
            callOut: hot.count,
            portraitMode: "callGraph",
            isChainHub: true,
          },
          { w: SYM_W, h: SYM_H }
        );
        if (!callerId) return;
        symChainNodes += 1;
        const callees = edges
          .filter((e) => e.callerSymbolId === hot.symbolId && e.callerFileId !== e.calleeFileId)
          .slice(0, 3);
        callees.forEach((e, ci) => {
          const calleeSym = symbolById.get(e.calleeSymbolId);
          const calleeX = 40 + (SYM_W + 120) * (ci + 1);
          const calleeId = place(
            "function",
            { x: calleeX, y: chainY },
            e.calleeName,
            {
              name: e.calleeName,
              symbolKind: calleeSym?.kind ?? "function",
              fileId: e.calleeFileId,
              filePath: e.calleeFilePath,
              lineStart: calleeSym?.lineStart ?? null,
              portraitMode: "callGraph",
            },
            { w: SYM_W, h: SYM_H }
          );
          if (!calleeId) return;
          symChainNodes += 1;
          const ca = { x: callerX, y: chainY, w: SYM_W, h: SYM_H };
          const cb = { x: calleeX, y: chainY, w: SYM_W, h: SYM_H };
          connect(ca, cb, `${hot.name} → ${e.calleeName}`, {
            depType: "call",
            isCircular: false,
            fromFileId: e.callerFileId,
            toFileId: e.calleeFileId,
            symbolNames: [hot.name],
            callCount: 1,
          });
          symChainEdges += 1;
        });
      });
    }
  }

  await persist(analysisId, "callGraph");

  const summary = pst.callGraphSummary;
  const hub = summary?.topCallees?.[0];
  const totalFiles = degree.size;
  const truncated = totalFiles - nodes.length;
  return {
    ok: true,
    message: t("portrait.msg.callGraphDone", {
      n: nodes.length,
      edges: edgeCount,
      hub: hub ? t("portrait.msg.callHub", { name: hub.name, n: hub.count }) : "",
      trunc: truncated > 0 ? t("portrait.msg.truncated", { total: totalFiles, keep: nodes.length, n: truncated }) : "",
      chain: symChainNodes > 0 ? t("portrait.msg.callChainDone", { nodes: symChainNodes, edges: symChainEdges }) : "",
    }),
    severity: "success",
    placed: nodes.length + symChainNodes,
  };
}

/**
 * 执行流画像（Execution-Flow Portrait · 纯静态，零 AI）
 *
 * ── 回答什么问题 ──────────────────────────────────────────────────────────
 * 「不知道代码入口、不知道流动方向」—— 本质上不是推理问题，而是静态分析 + 图算法问题。
 * 本画像把**整张符号级调用图**按「执行先后顺序」铺开成一张可读的走线图：
 *   - 左边一列 = 入口（main / bootstrap / 事件处理器 / 生命周期 / 路由 handler …）
 *   - 向右逐级 = 调用深入（入口 → 被调 → 再被调），整图读作「左进右出」的执行走线
 *   - 每一条跨文件调用边都画出来，双击任意节点直达该符号源码定义行
 *
 * ── 与 runCallGraphPortrait 的区别 ──────────────────────────────────────────
 * callGraph 只画「入度最高的文件同心环 + top 6 枢纽符号链」，是**中心性视角**；
 * 本画像是**顺序视角**：全量符号级调用边 + 以入口为根的拓扑排序，让「代码按什么顺序跑」可见。
 *
 * ── 入口点识别（框架感知分层，取代旧的「入度 0 即入口」）─────────────────────
 * 旧规则 ②「入度 0 且出度 > 0」危害极大：实测 web-craft 参与跨文件调用的 820 个符号里
 * 525 个（**64%**）被判为入口 —— 标记铺满全图，完全无法回答「我从哪个入口开始读」。
 * 故改为分层判定，每层都有明确语义：
 *   T0 应用入口：main.rs 的 main、main.tsx/main.ts 引导、App.tsx 根组件、router/routes 定义
 *   T1 边界入口：后端 #[tauri::command] 命令（前端跨语言调用真正的落点）
 *   T2 前端事件入口：on… / handle… 前缀命名且无调用方的事件处理器
 * 另按「可达度」（能触达多少下游节点/文件）排序，直接给出 Top N「从这里开始读」。
 *
 * ── 两项数据修正（纯前端，零 Rust）─────────────────────────────────────
 * ① 清洗跨语言假边：调用图解析器按名字全库匹配、不区分语言作用域，
 *    Rust 的 .lines()/.ok() 被错配到前端同名符号。web-craft 实测 945 条跨文件边里
 *    174 条（18.4%）是这类假边，既画出不存在的「前端↔后端」连线，又污染入/出度。
 *    按扩展名语种族剔除（Rust 不可能静态调用 TS，反之亦然）。
 * ② FE→BE invoke 桥接：前端 invoke('cmd') → 后端 #[tauri::command] 是字符串派发，
 *    call_graph 跳过字面量 → 调用图里根本不存在这条边。这是「前端事件 → 后端」
 *    唯一的实现路径，本画像扫描源码后合成 depType="invoke" 的琥珀虚线补上。
 */

/** 语言族：静态调用不可能跨源语言（跨语言只剩字符串派发，由 invoke 桥接边显式补出）。未知扩展返回 ""（保守保留）。 */
function langFamilyOf(path: string): string {
  const s = (path || "").toLowerCase();
  if (s.endsWith(".rs")) return "rust";
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(s)) return "tsjs";
  if (s.endsWith(".py")) return "py";
  if (s.endsWith(".go")) return "go";
  if (/\.(java|kt|kts)$/.test(s)) return "jvm";
  if (/\.(c|h|cc|cpp|hpp)$/.test(s)) return "cpp";
  if (s.endsWith(".cs")) return "csharp";
  return "";
}

/** 前端 invoke 调用点：兼容泛型形态 invoke<OpsScript[]>('cmd') —— 旧正则漏掉全部泛型调用（web-craft 23/160 命中不到） */
const INVOKE_RE = /\binvoke\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/;
/** 后端 Tauri 命令属性：惯例独立成行，故不能单行匹配（web-craft 170 处全部换行，旧正则命中 0） */
const TAURI_ATTR_RE = /#\[tauri::command(?:\([^)]*\))?\]/;
/** 属性下方最近的 fn 名 */
const RUST_FN_RE = /\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/;
/** 动态导入：main.tsx 用 `await import('./App')` 拉起根组件，静态导入表里根本没有这条边 */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

// ─── 导入解析修复（纯前端）─────────────────────────────────────────────────
// 扫描器把大量项目内相对导入误判成 external：metadata 里其实存着正确路径
// （{"raw":"./pages/TerminalPage","resolved":"src/pages/TerminalPage"}），
// 但查文件时没补扩展名（实际是 TerminalPage.tsx）→ 查不到 → 打成 external:。
// web-craft 实测：1717 条依赖里 1498 条被标 external，其中 182 条是 './' 相对导入（100% 误判），
// 导致 App.tsx 的 14 个页面组件导入全部丢失，前端主干在第一步就断了。
const IMPORT_EXT_CANDIDATES = [
  "", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts",
  "/index.tsx", "/index.ts", "/index.js", "/index.jsx",
];

/** 把 import 说明符按导入方所在目录归一化为项目相对路径 */
function normalizeImportPath(baseDir: string, spec: string): string {
  let s = (spec || "").replace(/\\/g, "/").trim();
  if (!s) return "";
  if (s.startsWith(".")) {
    const parts = (baseDir ? baseDir.split("/") : []).concat(s.split("/"));
    const out: string[] = [];
    for (const seg of parts) {
      if (!seg || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    s = out.join("/");
  }
  return s.replace(/^\/+/, "");
}

/** 目录名：src/App.tsx → src；App.tsx → "" */
function dirOfRel(relPath: string): string {
  const s = (relPath || "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i > 0 ? s.slice(0, i) : "";
}
/** 文件基名去扩展名：src/pages/TerminalPage.tsx → TerminalPage */
function baseNameNoExt(relPath: string): string {
  const s = (relPath || "").replace(/\\/g, "/");
  const seg = s.slice(s.lastIndexOf("/") + 1);
  const i = seg.lastIndexOf(".");
  return i > 0 ? seg.slice(0, i) : seg;
}
async function runExecutionFlowPortrait(
  analysisId: string
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  // allCallEdges 保留全量（含同文件调用），仅用于「入口可达度」计算：
  // 同文件调用也是真实执行流的一部分，只用跨文件边会让可达度普遍偏低
  // （实测 web-craft 后端命令可达数普遍仅 3~4，Top N 排序被大量并列淹没、失去区分度）。
  let allCallEdges = pst.callEdges;
  // —— 构图与连通性一律用【全量边】（含 internal 同文件调用）——
  // 这是本轮「执行流画像画不出来」的最深根因：此前构图只用 cross-file 边，
  // 而 reach 用全量边，两套口径不一致。实测本仓 internal 边占全部调用边的 52.1%，
  // 丢掉它们后从真入口出发只能走到 89 个符号（92.7% 未接入），执行流整条断在
  // 第一跳——`main()` 调用同文件的 `setup()` 这条边根本不存在，链从起点就断了。
  // 改用全量边后可达 338 个、入图节点全部落在真实执行流上（未接入 0 个）。
  let edges = allCallEdges;

  // 自愈：与 runCallGraphPortrait 同思路——扫描漏跑 callGraph 阶段时主动重拉
  if (edges.length === 0) {
    try {
      await pst.analyzeCallGraph(analysisId, undefined);
      await pst.loadCallEdges(analysisId);
      allCallEdges = useProjectStore.getState().callEdges;
      edges = allCallEdges;
    } catch (err) {
      console.error("[runExecutionFlowPortrait] 自愈重拉 callGraph 失败", err);
    }
  }
  if (edges.length === 0) {
    return { ok: false, message: t("portrait.msg.flowNoData"), severity: "info", placed: 0 };
  }

  const symbolById = new Map(pst.symbols.map((s) => [s.id, s]));

  // ── P0 清洗跨语言假边 ──
  // 调用图解析器按名字全库匹配、不区分语言作用域：Rust 的 .lines()/.ok() 被错配到前端同名符号。
  // web-craft 实测 945 条跨文件边里 174 条（18.4%）是 rust↔ts 假边，既画出不存在的
  // 「前端↔后端」连线，又污染入/出度。Rust 不可能静态调用 TS（反之亦然）→ 按语种族剔除。
  const rawEdgeCount = edges.length;
  const staticEdges = edges.filter((e) => {
    const a = langFamilyOf(e.callerFilePath);
    const b = langFamilyOf(e.calleeFilePath);
    return !a || !b || a === b;
  });
  const droppedCrossLang = rawEdgeCount - staticEdges.length;

  // ── 符号级入/出度 + 邻接表（执行流骨架，仅静态调用）──
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const calleesOf = new Map<string, string[]>();
  const allSym = new Set<string>();
  for (const e of staticEdges) {
    if (e.callerSymbolId === e.calleeSymbolId) continue;
    allSym.add(e.callerSymbolId);
    allSym.add(e.calleeSymbolId);
    inDeg.set(e.calleeSymbolId, (inDeg.get(e.calleeSymbolId) || 0) + 1);
    outDeg.set(e.callerSymbolId, (outDeg.get(e.callerSymbolId) || 0) + 1);
    if (!calleesOf.has(e.callerSymbolId)) calleesOf.set(e.callerSymbolId, []);
    calleesOf.get(e.callerSymbolId)!.push(e.calleeSymbolId);
  }

  // ── FE→BE invoke 桥接：补出调用图看不见的「前端事件 → 后端命令」──
  // 前端 invoke('cmd') 是字符串派发，call_graph 跳过字面量 → 这条边在调用图里不存在。
  // 后端 #[tauri::command] 已作为符号入库（file+line），故扫描源码即可双向对齐。
  const symByFile = new Map<string, ProjectSymbol[]>();
  for (const s of pst.symbols) {
    if (!symByFile.has(s.fileId)) symByFile.set(s.fileId, []);
    symByFile.get(s.fileId)!.push(s);
  }
  const allFiles = pst.files.filter((f) => !f.isDirectory);
  // 项目相对路径 → 文件（导入修复与动态导入都靠它把说明符落到真实文件）
  const fileByRelPath = new Map<string, ProjectFile>();
  for (const f of allFiles) fileByRelPath.set(f.relPath.replace(/\\/g, "/"), f);
  const feFiles = allFiles.filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(f.relPath)).slice(0, 300);
  const beFiles = allFiles.filter((f) => /\.rs$/i.test(f.relPath)).slice(0, 300);

  // 后端命令名 → 符号（#[tauri::command] 惯例独立成行，故向下找最近的 fn NAME）
  const cmdByName = new Map<string, ProjectSymbol>();
  await mapLimit(beFiles, 16, async (f: ProjectFile) => {
    const lines = await readLines(f);
    if (!lines) return;
    for (let i = 0; i < lines.length; i++) {
      if (!TAURI_ATTR_RE.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const m = lines[j].match(RUST_FN_RE);
        if (!m) continue;
        const list = symByFile.get(f.id) ?? [];
        const hit = list.find((x) => x.name === m[1]);
        if (hit) cmdByName.set(m[1], hit);
        break;
      }
    }
  });

  // 前端 invoke → 后端命令：合成跨语言派发边
  type InvokeEdge = { from: string; to: string; label: string };
  const invokeEdges: InvokeEdge[] = [];
  const seenInvoke = new Set<string>();
  // 全部 invoke 站点（含「所在文件无任何符号」的那些）。web-craft 实测 src/ 下 28/144 个
  // ts/tsx 文件零符号，其 invoke 无法挂到符号上 → 后面用主干上最后一个可表示组件兜底连到后端命令。
  const invokeSites: { fileId: string; targetId: string; cmd: string }[] = [];
  /** 动态导入边（文件级）：from 文件 id → to 文件 id */
  const dynamicImportEdges: { from: string; to: string }[] = [];
  await mapLimit(feFiles, 16, async (f: ProjectFile) => {
    const lines = await readLines(f);
    if (!lines) return;
    for (let i = 0; i < lines.length; i++) {
      // 动态 import('...')：与 invoke 同一次扫描，避免重复读盘
      if (/\bimport\s*\(/.test(lines[i])) {
        let dm: RegExpExecArray | null;
        DYNAMIC_IMPORT_RE.lastIndex = 0;
        while ((dm = DYNAMIC_IMPORT_RE.exec(lines[i])) !== null) {
          const spec = dm[1];
          const norm = normalizeImportPath(dirOfRel(f.relPath), spec);
          if (!norm) continue;
          const target = fileByRelPath.get(norm)
            ?? IMPORT_EXT_CANDIDATES.map((ext) => fileByRelPath.get(norm + ext)).find(Boolean);
          if (target && target.id !== f.id) dynamicImportEdges.push({ from: f.id, to: target.id });
        }
      }
      const m = lines[i].match(INVOKE_RE);
      if (!m) continue;
      const target = cmdByName.get(m[1]);
      if (!target) continue;
      invokeSites.push({ fileId: f.id, targetId: target.id, cmd: m[1] });
      const lineNo = i + 1;
      const list = symByFile.get(f.id) ?? [];
      // 取包含该 invoke 的最内层符号（行号落在 [lineStart, lineEnd] 内，取 lineStart 最大者）
      let owner: ProjectSymbol | undefined;
      for (const s of list) {
        if (s.lineStart <= lineNo && (s.lineEnd || s.lineStart) >= lineNo) {
          if (!owner || s.lineStart >= owner.lineStart) owner = s;
        }
      }
      if (!owner || owner.id === target.id) continue;
      const key = `${owner.id}->${target.id}`;
      if (seenInvoke.has(key)) continue;
      seenInvoke.add(key);
      invokeEdges.push({ from: owner.id, to: target.id, label: `invoke('${m[1]}')` });
    }
  });

  // 桥接边并入图：参与度数与深度计算，使后端命令不再是被孤立的死叶
  for (const ie of invokeEdges) {
    allSym.add(ie.from);
    allSym.add(ie.to);
    outDeg.set(ie.from, (outDeg.get(ie.from) || 0) + 1);
    inDeg.set(ie.to, (inDeg.get(ie.to) || 0) + 1);
    if (!calleesOf.has(ie.from)) calleesOf.set(ie.from, []);
    calleesOf.get(ie.from)!.push(ie.to);
  }

  // ── 前端渲染主干：补出「应用入口 → … → 发起 invoke 的前端函数」这条链路 ──
  // React 组件靠 JSX 渲染（<App/>），不是函数调用 → 调用图里根本没有这条主干，
  // 实测 web-craft 的 T0 入口（main.tsx 的 root）可达数只有个位数。
  // 这里改用「导入关系」补：静态导入（含被误判 external 的修复）+ 动态 import()，
  // 正向 BFS 求「入口 → 跨界文件」最短路径，只保留这条主干（避免把整棵组件树倒进来变毛线团）。
  const importAdj = new Map<string, string[]>();
  const addImportEdge = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    if (!importAdj.has(from)) importAdj.set(from, []);
    const arr = importAdj.get(from)!;
    if (!arr.includes(to)) arr.push(to);
  };
  const fileById = new Map(allFiles.map((f) => [f.id, f]));
  // ① 静态导入：修复被误判为 external 的项目内相对导入（metadata.resolved 补扩展名反查）
  for (const d of pst.dependencies ?? []) {
    let toFileId: string | null = fileById.has(d.toId) ? d.toId : null;
    if (!toFileId) {
      let resolved = "";
      try {
        resolved = (JSON.parse(d.metadata || "{}") as { resolved?: string }).resolved ?? "";
      } catch {
        resolved = "";
      }
      const fromFile = fileById.get(d.fromId);
      if (!resolved || !fromFile) continue;
      const norm = normalizeImportPath(dirOfRel(fromFile.relPath), resolved);
      if (!norm) continue;
      const cand =
        fileByRelPath.get(norm) ??
        IMPORT_EXT_CANDIDATES.map((ext) => fileByRelPath.get(norm + ext)).find(Boolean);
      if (!cand) continue;
      toFileId = cand.id;
    }
    addImportEdge(d.fromId, toFileId);
  }
  // ② 动态 import()（main.tsx 用 await import('./App') 拉起根组件）
  for (const e of dynamicImportEdges) addImportEdge(e.from, e.to);

  // 跨界文件 = 含 invoke 桥接起点的前端文件；入口文件 = main/App/router
  const crossFileIds = new Set<string>();
  for (const ie of invokeEdges) {
    const s = symbolById.get(ie.from);
    if (s?.fileId) crossFileIds.add(s.fileId);
  }
  // 无符号文件里的 invoke 站点也算跨界（靠主干兜底连到后端）
  for (const site of invokeSites) crossFileIds.add(site.fileId);
  const entryFileIds = allFiles
    .filter(
      (f) =>
        /\/(main|App)\.(tsx|ts)$/i.test("/" + f.relPath) ||
        /\bmain\.rs$/i.test(f.relPath) ||
        /\/(router|routes)\.(tsx|ts)$/i.test("/" + f.relPath)
    )
    .map((f) => f.id);

  // 正向 BFS：入口 → … → 跨界文件，parent 记录最短路径
  const parentOf = new Map<string, string | null>();
  const visitedFile = new Set<string>();
  const fileQueue: string[] = [];
  for (const eid of entryFileIds) {
    if (!visitedFile.has(eid)) { visitedFile.add(eid); parentOf.set(eid, null); fileQueue.push(eid); }
  }
  const reachedCross = new Set<string>();
  while (fileQueue.length) {
    const u = fileQueue.shift()!;
    if (crossFileIds.has(u)) reachedCross.add(u);
    for (const v of importAdj.get(u) ?? []) {
      if (visitedFile.has(v)) continue;
      visitedFile.add(v);
      parentOf.set(v, u);
      fileQueue.push(v);
    }
  }

  // 文件 → 代表符号：优先与文件同名的组件（TerminalPage.tsx → TerminalPage），否则取行跨度最大的函数
  const repOf = (fileId: string): ProjectSymbol | undefined => {
    const file = fileById.get(fileId);
    const list = (symByFile.get(fileId) ?? []).filter((s) => s.kind === "function" || s.kind === "component");
    if (list.length === 0) return undefined;
    const want = baseNameNoExt(file?.relPath ?? "").toLowerCase();
    const same = list.find((s) => (s.name || "").toLowerCase() === want);
    if (same) return same;
    return list.slice().sort((a, b) => b.lineEnd - b.lineStart - (a.lineEnd - a.lineStart))[0];
  };

  const renderEdges: { from: string; to: string }[] = [];
  const seenRender = new Set<string>();
  const pushRender = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    if (seenRender.has(key)) return;
    seenRender.add(key);
    renderEdges.push({ from, to });
  };
  // 兜底 invoke 边：跨界文件自身零符号时，用主干上最后一个可表示组件直接连后端命令
  const trunkInvoke: { from: string; to: string; label: string }[] = [];
  for (const crossId of reachedCross) {
    const path: string[] = [];
    let cur: string | null | undefined = crossId;
    while (cur) { path.push(cur); cur = parentOf.get(cur) ?? null; }
    path.reverse();
    for (let i = 0; i + 1 < path.length; i++) {
      const a = repOf(path[i]);
      const b = repOf(path[i + 1]);
      if (a && b) pushRender(a.id, b.id);
    }
    // 末段：跨界文件的代表符号 → 真正发起 invoke 的函数（接上 invoke 桥接边）
    if (path[path.length - 1] === crossId) {
      const rep = repOf(crossId);
      if (rep) {
        for (const ie of invokeEdges) {
          const owner = symbolById.get(ie.from);
          if (owner && owner.fileId === crossId) pushRender(rep.id, owner.id);
        }
      }
    }
    // 锚点 = 路径上最后一个能取到代表符号的文件（自深向浅找），零符号文件的 invoke 挂到它身上
    let anchor: ProjectSymbol | undefined;
    for (let i = path.length - 1; i >= 0; i--) {
      const r = repOf(path[i]);
      if (r) { anchor = r; break; }
    }
    if (anchor) {
      for (const site of invokeSites) {
        if (site.fileId !== crossId || anchor.id === site.targetId) continue;
        const key = `${anchor.id}->${site.targetId}`;
        if (seenInvoke.has(key)) continue;
        seenInvoke.add(key);
        trunkInvoke.push({ from: anchor.id, to: site.targetId, label: `invoke('${site.cmd}')` });
      }
    }
  }
  for (const ti of trunkInvoke) invokeEdges.push(ti);
  // 渲染主干并入图
  for (const re of renderEdges) {
    allSym.add(re.from);
    allSym.add(re.to);
    outDeg.set(re.from, (outDeg.get(re.from) || 0) + 1);
    inDeg.set(re.to, (inDeg.get(re.to) || 0) + 1);
    if (!calleesOf.has(re.from)) calleesOf.set(re.from, []);
    calleesOf.get(re.from)!.push(re.to);
  }
  // 兜底 invoke 边并入图（invokeEdges 的合并循环在前面已跑过，这里补合并）
  for (const ti of trunkInvoke) {
    allSym.add(ti.from);
    allSym.add(ti.to);
    outDeg.set(ti.from, (outDeg.get(ti.from) || 0) + 1);
    inDeg.set(ti.to, (inDeg.get(ti.to) || 0) + 1);
    if (!calleesOf.has(ti.from)) calleesOf.set(ti.from, []);
    calleesOf.get(ti.from)!.push(ti.to);
  }

  if (allSym.size === 0) {
    return { ok: false, message: t("portrait.msg.flowNoData"), severity: "info", placed: 0 };
  }

  // ── 入口点识别（框架感知分层，取代「入度 0 即入口」）──
  const tierOf = new Map<string, "T0" | "T1" | "T2">();
  // T1 边界入口：后端 Tauri 命令（前端跨语言调用的真正落点）
  for (const s of cmdByName.values()) {
    tierOf.set(s.id, "T1");
  }
  // T2 前端事件入口：**命名启发式已被实测证伪**（本仓 738 个「入度 0」种子里
  // 694 个是伪入口，样例 get_executed_migrations / generate_etag / json_to_sql_value
  // 全是普通工具函数）。故 T2 不再单看 `on*/handle*` 前缀，改为**图结构**判定：
  // 无调用者 + 有下游 + 且实际能驱动足够多的下游（reach 阈值）。
  // 这与污点画像入口选择的既有结论一致：入口必须由可达性证明，不能靠名字猜。
  const T2_MIN_REACH = 3;
  // 先按旧规则收集候选，稍后用 reach 过滤（reach 需在 fullCallees 就绪后才算得出）
  const t2Candidates: string[] = [];
  for (const sid of allSym) {
    const sym = symbolById.get(sid);
    if (!sym) continue;
    const p = sym.filePath ?? "";
    const name = sym.name ?? "";
    const outd = outDeg.get(sid) || 0;
    const ind = inDeg.get(sid) || 0;
    const base = "/" + p;
    const appEntryFile =
      /\bmain\.rs$/i.test(p) || /\/(main|App)\.(tsx|ts|jsx|js)$/i.test(base) || /\/(router|routes)\.(tsx|ts)$/i.test(base);
    const isFrontend = langFamilyOf(p) === "tsjs";
    if (appEntryFile && (outd > 0 || /^(main|App|bootstrap|default)$/i.test(name))) {
      // T0 应用入口：文件级约定（main.rs / main.tsx / App.tsx / router），是硬证据
      tierOf.set(sid, "T0");
    } else if (isFrontend && ind === 0 && outd > 0 && /^(on|handle)[A-Z]/.test(name)) {
      t2Candidates.push(sid);
    }
  }
  let entryIds = new Set(tierOf.keys());

  // ── 可达性判定：直接复用 `calleesOf` 作为单一真相源 ──
  // calleesOf 此刻已含「全量调用边（含同文件） + invoke 桥接 + render 主干」，
  // 与构图完全同一口径。此前这里另建 fullCallees 却只喂 allCallEdges，
  // 两套邻接表不一致正是「reach 算得出来、执行流却走不通」的根源。
  // 提前到入口识别之前：T2 必须由「实际能驱动多少下游」证明，而这依赖邻接表。
  const fullCallees = calleesOf;
  /** 从某节点出发能触达的下游节点数（不含自身） */
  const reachFrom = (root: string): number => {
    const seen = new Set<string>([root]);
    const q: string[] = [root];
    while (q.length) {
      const u = q.shift()!;
      for (const v of fullCallees.get(u) ?? []) {
        if (seen.has(v)) continue;
        seen.add(v);
        q.push(v);
      }
    }
    return seen.size - 1;
  };

  // T2 过滤：只有真能驱动下游的候选才算事件入口。
  // 本仓实测：508 个「入度 0」种子出度仅 1（只调一个跨文件函数），
  // 把它们当入口会把 60% 的节点塞进 depth=0 列、纵向撑爆画布。
  for (const sid of t2Candidates) {
    if (reachFrom(sid) >= T2_MIN_REACH) tierOf.set(sid, "T2");
  }
  entryIds = new Set(tierOf.keys());

  // ── 执行顺序：以**真入口**为根的最短路径深度 ──
  // depth=0 即入口列，向右递增 = 调用逐级深入，整图读作「左进右出」的执行走线。
  //
  // 两处修正（本仓实测根因）：
  //  ① 种子不再包含「入度 0」的全体符号 —— 那会把 738 个伪入口（94% 不是入口）
  //     全部铺到第 0 列，纵向需 6766px 而画布仅 4096px，fit 视口后整图缩成一条线。
  //  ② 由「最长路径」改为「最短路径」—— 最长路径会被调用链随意拉长，
  //     语义上也不表示「从入口读下来第几步」。
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const id of entryIds) if (!depth.has(id)) { depth.set(id, 0); queue.push(id); }
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]; // 数组 + 游标代替 shift()，避免 O(N²)
    const base = depth.get(u) ?? 0;
    for (const v of calleesOf.get(u) ?? []) {
      // 最短路径：首次到达即定层，不再用 nd > depth 反复松弛
      if (!depth.has(v)) { depth.set(v, base + 1); queue.push(v); }
    }
  }
  // 不可达任何入口的节点：归入末列，并在节点上标注「未接入」
  // （用户选定：保留可见但明确标注，而非直接丢弃——信息不丢，也不再污染入口列）
  let maxD = 0;
  for (const v of depth.values()) if (v > maxD) maxD = v;
  const UNREACHED_LAYER = maxD + 1;
  const unreachedIds = new Set<string>();
  for (const sid of allSym) {
    if (!depth.has(sid)) { depth.set(sid, UNREACHED_LAYER); unreachedIds.add(sid); }
  }

  // ── 入口可达度：每个入口能触达多少下游节点（正面回答「从哪个入口开始读」）──
  const reachOf = new Map<string, number>();
  for (const eid of entryIds) reachOf.set(eid, reachFrom(eid));

  // T1 命令若既不参与调用图、又完全不触达下游（可达 0），对「从哪里开始读」没有价值 → 不标为入口。
  // 反之，可达度高的命令即使不在跨文件图里也要纳入渲染（可达数证明它驱动着真实代码，
  // 例如 web-craft 的 build_llm_provider 可达 71 个下游节点，是最值得先读的入口之一）。
  for (const id of Array.from(tierOf.keys())) {
    if (tierOf.get(id) === "T1" && !allSym.has(id) && (reachOf.get(id) ?? 0) === 0) tierOf.delete(id);
  }
  for (const id of tierOf.keys()) allSym.add(id);
  entryIds.clear();
  for (const id of tierOf.keys()) entryIds.add(id);

  // ── 节点选取：硬上限防马赛克 ──
  // 排序键：「是否接入执行流 → 入口分层 → 可达度 → 中心度」。
  //
  // **「是否接入执行流」必须是第一键**（本仓实测根因）：reachOf 只对 entryIds 填充，
  // 非入口符号的 reach 恒为 0，于是「按 reach 排序」对占绝大多数的非入口完全失效，
  // 实际退化成纯按度数排序 → 选入 176 个与任何入口都不连通的高热度节点，
  // 1544 条构图边只有 395 条（25.6%）两端都入图，图碎成一堆散点。
  const FLOW_LIMIT = 220;
  const TIER_RANK: Record<string, number> = { T0: 0, T1: 1, T2: 2 };
  const scored = Array.from(allSym).map((sid) => ({
    sid,
    entry: entryIds.has(sid),
    tier: tierOf.get(sid) ?? null,
    deg: (inDeg.get(sid) || 0) + (outDeg.get(sid) || 0),
    reach: reachOf.get(sid) ?? 0,
    unreached: unreachedIds.has(sid),
  }));
  scored.sort((a, b) => {
    const ua = a.unreached ? 1 : 0;
    const ub = b.unreached ? 1 : 0;
    const ta = a.tier ? TIER_RANK[a.tier] ?? 3 : 3;
    const tb = b.tier ? TIER_RANK[b.tier] ?? 3 : 3;
    return ua - ub || ta - tb || b.reach - a.reach || b.deg - a.deg;
  });
  const kept = scored.slice(0, FLOW_LIMIT);
  const keptSet = new Set(kept.map((k) => k.sid));

  // ── 拓扑分层布局（入口列在左，底座在右）──
  // maxRowsPerLayer=28：单层超过 28 个就横向分列。分层布局原本每层只是一根垂直单列，
  // 节点一多纵向就远超画布（本仓 depth=0 曾堆到 104 个 → 该列 6766px vs 画布 4096px），
  // fit 视口后整图缩成一条线，这就是「执行流画像画不出来」的直接观感。
  // 28 是本仓最大层的节点数（再往上加无收益，实测 28/32/36/40 结果完全相同）。
  // layerGap 由 200 降到 120：13 层 × (列宽224 + 间距) 是宽度主因，压到 120 后
  // 整图 4418×2065，fit 缩放从修复前的约 0.13 提升到约 0.36（节点从 26px 宽到 72px，可读）。
  const SYM_W = 200;
  const SYM_H = 50;
  const layoutNodes = kept.map((k) => ({ id: k.sid, weight: k.deg }));
  const posMap = layeredLayout(
    layoutNodes,
    depth,
    { width: 4096, height: 4096, originX: 90, originY: 110, nodeWidth: SYM_W, nodeHeight: SYM_H, layerGap: 120, nodeGap: 14, maxRowsPerLayer: 28 }
  );

  clearCanvas();

  // ── 「从这里开始读」：入口按 分层 → 可达度 排序取前 6，直接回答「该从哪个入口分析」──
  const topEntries = Array.from(entryIds)
    .map((id) => ({
      id,
      name: symbolById.get(id)?.name ?? id,
      tier: tierOf.get(id) ?? "T2",
      reach: reachOf.get(id) ?? 0,
    }))
    .sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3) || b.reach - a.reach)
    .slice(0, 6);
  const startHere = topEntries.map((e) => `${e.name}·${e.reach}`).join(" → ");
  const invokePlaced = invokeEdges.filter((ie) => keptSet.has(ie.from) && keptSet.has(ie.to)).length;
  const renderPlaced = renderEdges.filter((re) => keptSet.has(re.from) && keptSet.has(re.to)).length;
  const flowUnreached = kept.filter((k) => k.unreached).length;

  // 左上角图例：读法 + 数据修正说明 + 「从这里开始读」
  const legendParts = [
    t("portrait.msg.flowLegendHint"),
    droppedCrossLang > 0 ? t("portrait.msg.flowClean", { n: droppedCrossLang }) : "",
    invokePlaced > 0 ? t("portrait.msg.flowBridge", { n: invokePlaced }) : "",
    renderPlaced > 0 ? t("portrait.msg.flowRender", { n: renderPlaced }) : "",
    flowUnreached > 0 ? t("portrait.msg.flowUnreached", { n: flowUnreached }) : "",
    startHere ? t("portrait.msg.flowStartHere", { list: startHere }) : "",
  ].filter(Boolean);
  place("layer-marker", { x: 40, y: 40 }, t("portrait.msg.flowLegend"), {
    layerName: t("portrait.msg.flowLegend"),
    layerColor: "#22c55e",
    layerOrder: 0,
    fileCount: entryIds.size,
    description: legendParts.join("\n"),
    portraitMode: "executionFlow",
  });

  const placedPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const k of kept) {
    const p = posMap.get(k.sid);
    if (!p) continue;
    const sym = symbolById.get(k.sid);
    place(
      "function",
      { x: p.x, y: p.y },
      sym?.name ?? k.sid,
      {
        name: sym?.name ?? k.sid,
        symbolKind: sym?.kind ?? "function",
        fileId: sym?.fileId ?? null,
        filePath: sym?.filePath ?? null,
        lineStart: sym?.lineStart ?? null,
        symbolId: k.sid,
        portraitMode: "executionFlow",
        isEntry: k.entry,
        entryTier: k.tier ?? undefined,
        entryReach: k.entry ? reachOf.get(k.sid) ?? 0 : undefined,
        // 未接入任何入口：末列单独成区，节点上可见，不与真入口混淆
        unreachable: k.unreached ? true : undefined,
        callIn: inDeg.get(k.sid) ?? 0,
        callOut: outDeg.get(k.sid) ?? 0,
      },
      { w: SYM_W, h: SYM_H }
    );
    placedPos.set(k.sid, { x: p.x, y: p.y, w: SYM_W, h: SYM_H });
  }

  // ── 画「每一条线」：所有落在已选节点之间的静态调用边（已剔除跨语言假边）──
  let edgeCount = 0;
  for (const e of staticEdges) {
    if (e.callerSymbolId === e.calleeSymbolId) continue;
    if (!keptSet.has(e.callerSymbolId) || !keptSet.has(e.calleeSymbolId)) continue;
    const a = placedPos.get(e.callerSymbolId)!;
    const b = placedPos.get(e.calleeSymbolId)!;
    connect(a, b, `${e.callerName} → ${receiverQualifiedName(e.calleeName, e.calleeReceiver)}`, {
      depType: "call",
      isCircular: false,
      fromFileId: e.callerFileId,
      toFileId: e.calleeFileId,
      symbolNames: [receiverQualifiedName(e.calleeName, e.calleeReceiver)],
      callCount: 1,
      portraitMode: "executionFlow",
    });
    edgeCount += 1;
  }

  // ── 跨语言派发边（invoke）：前端事件 → 后端 #[tauri::command]，琥珀虚线 ──
  let invokeCount = 0;
  for (const ie of invokeEdges) {
    if (!keptSet.has(ie.from) || !keptSet.has(ie.to)) continue;
    const a = placedPos.get(ie.from)!;
    const b = placedPos.get(ie.to)!;
    connect(a, b, ie.label, {
      depType: "invoke",
      isCircular: false,
      symbolNames: [ie.label],
      callCount: 1,
      portraitMode: "executionFlow",
    });
    invokeCount += 1;
  }

  // ── 组件渲染主干（render）：应用入口 → 页面 → 组件 → 发起 invoke 的函数，青虚线 ──
  let renderCount = 0;
  for (const re of renderEdges) {
    if (!keptSet.has(re.from) || !keptSet.has(re.to)) continue;
    const a = placedPos.get(re.from)!;
    const b = placedPos.get(re.to)!;
    connect(a, b, `${symbolById.get(re.from)?.name ?? ""} → ${symbolById.get(re.to)?.name ?? ""}`, {
      depType: "render",
      isCircular: false,
      symbolNames: [],
      callCount: 1,
      portraitMode: "executionFlow",
    });
    renderCount += 1;
  }

  await persist(analysisId, "executionFlow");

  const truncated = kept.length < allSym.size;
  const extra = [
    droppedCrossLang > 0 ? t("portrait.msg.flowClean", { n: droppedCrossLang }) : "",
    invokeCount > 0 ? t("portrait.msg.flowBridge", { n: invokeCount }) : "",
    renderCount > 0 ? t("portrait.msg.flowRender", { n: renderCount }) : "",
    startHere ? t("portrait.msg.flowStartHere", { list: startHere }) : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ok: true,
    message: [
      t("portrait.msg.flowDone", {
        n: kept.length,
        edges: edgeCount,
        entries: entryIds.size,
        trunc: truncated
          ? t("portrait.msg.flowTrunc", { total: allSym.size, keep: kept.length })
          : "",
      }),
      extra,
    ]
      .filter(Boolean)
      .join(" "),
    severity: "success",
    placed: kept.length,
  };
}

// ───────────────────────── API 调用链路画像（前后端关联） ─────────────────────────
/**
 * API 调用链路画像（apiTrace）：把「前端访问了哪个 API → 该 API 落到后端哪个方法」画成
 * 一条条**纵向单列**走线（从上到下读），每个节点双击直达源码。满足三硬要求：
 *  ① 前后端关联：前端调用点 → API 路由 → 后端 handler → 下游方法；
 *  ② 点击直接打开源码定位（fileId/filePath/lineStart → SceneEditor 双击兜底）；
 *  ③ 每条依赖连线占一行、从上到下（纵向单列，边为 top→bottom 垂直线）。
 *
 * 纯前端、零 Rust/零新表/零新依赖：后端路由识别复用 apiSurface 同款正则思路，
 * 前端调用点正则 + URL→路由链接器 + 路由→handler 符号解析均在本函数内补齐。
 *
 * 三视图（view）：all=全链路 / orphan=悬空调用(前端调了但无后端路由) / dead=死路由(后端路由无前端调用)。
 */
async function runApiTracePortrait(
  analysisId: string,
  view: "all" | "orphan" | "dead" = "all"
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const files = pst.files.filter(
    (f: any) =>
      !f.isDirectory &&
      CODE_LANGS.has((f.language || "").toLowerCase()) &&
      (f.lineCount || 0) > 0 &&
      (f.lineCount || 0) <= 6000
  );
  const symbols: any[] = pst.symbols || [];
  const symbolById = new Map<string, any>(symbols.map((s) => [s.id, s]));
  const symbolByName = new Map<string, any[]>();
  for (const s of symbols) {
    const arr = symbolByName.get(s.name) ?? [];
    arr.push(s);
    symbolByName.set(s.name, arr);
  }
  const callEdges = (pst.callEdges || []).filter((e: any) => e.kind === "cross-file");

  // ── 归一化（链接器核心）──
  const normPath = (p: string): string => {
    if (!p) return "";
    let s = p.trim();
    if (/^https?:\/\//i.test(s)) {
      try {
        s = new URL(s).pathname;
      } catch {
        /* keep raw */
      }
    }
    s = s.split("?")[0].split("#")[0];
    s = s.toLowerCase();
    s = s.replace(/[:<*]\w+/g, "{param}"); // :id / {id} / <id> / *id → {param}
    if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  };
  const normInvoke = (name: string): string => name.toLowerCase().replace(/[_-]/g, "");

  interface ApiNode {
    verb: string;
    path: string;
    norm: string;
    fileId: string | null;
    filePath: string;
    line: number;
    handler: string | null;
    raw: string;
    kind: "call" | "route";
  }

  const CALL_RES: RegExp[] = [
    /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{[^}]*?method\s*:\s*['"`](\w+)['"`]/i,
    /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/i,
    /\baxios\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/i,
    /\baxios\s*\(\s*\{[^}]*?url\s*:\s*['"`]([^'"`]+)['"`]/i,
    /\$\s*\.\s*ajax\s*\(\s*\{[^}]*?url\s*:\s*['"`]([^'"`]+)['"`]/i,
    /\b(got|httpx|requests)\b(?:\s*\.\s*(get|post|put|delete|patch))?\s*\(\s*['"`]([^'"`]+)['"`]/i,
    /\binvoke\s*\(\s*['"`]([^'"`]+)['"`]/i,
  ];
  const ROUTE_RE =
    /(?:app|router|server|api|res|req|fastify|koa|hapi|engine|http|client|db|conn|pool|srv|web|bp|blueprint|r|e)\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))?/i;
  const ROUTE_DECORATOR =
    /@(?:Get|Post|Put|Delete|Patch|Head|Options|RequestMapping|app\.route|router\.(?:get|post|put|delete|patch)|\w+\.(?:get|post|put|delete|patch))\b[^)]*\((['"`][^'"`]+['"`])?\)/;
  const NEXT_RE =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/;
  const TAURI_RE = /#\[tauri::command(?:\([^)]*\))?\]\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/;

  const scanned = await mapLimit(files, 16, async (f: any) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const out: ApiNode[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      let m: RegExpMatchArray | null = null;
      for (const re of CALL_RES) {
        const mm = ln.match(re);
        if (mm) {
          m = mm;
          break;
        }
      }
      if (m) {
        let verb = "GET";
        let path = m[1] ?? "";
        if (/fetch/i.test(m[0])) {
          verb = m[2] ? m[2].toUpperCase() : "GET";
          path = m[1];
        } else if (/axios/i.test(m[0])) {
          if (/\.(get|post|put|delete|patch|head|options)/i.test(m[0])) {
            verb = (m[1] || "GET").toUpperCase();
            path = m[2];
          } else {
            verb = "GET";
            path = m[1];
          }
        } else if (/ajax/i.test(m[0])) {
          verb = "GET";
          path = m[1];
        } else if (/got|httpx|requests/i.test(m[0])) {
          verb = m[2] ? m[2].toUpperCase() : "GET";
          path = m[3];
        } else if (/invoke/i.test(m[0])) {
          verb = "invoke";
          path = m[1];
        }
        const norm = verb === "invoke" ? normInvoke(path) : normPath(path);
        out.push({
          verb,
          path,
          norm,
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: null,
          raw: ln.trim().slice(0, 56),
          kind: "call",
        });
      }

      const rm = ln.match(ROUTE_RE);
      if (rm) {
        out.push({
          verb: rm[1].toUpperCase(),
          path: rm[2],
          norm: normPath(rm[2]),
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: rm[3] ?? null,
          raw: `${rm[1].toUpperCase()} ${rm[2]}`,
          kind: "route",
        });
        continue;
      }
      const dm = ln.match(ROUTE_DECORATOR);
      if (dm) {
        let handler: string | null = null;
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const hm = lines[j].match(/\b(?:function|fn|def|const|let|var)\s+([A-Za-z_][\w]*)/);
          if (hm) {
            handler = hm[1];
            break;
          }
          const hm2 = lines[j].match(/([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?\(/);
          if (hm2) {
            handler = hm2[1];
            break;
          }
        }
        out.push({
          verb: "DECORATOR",
          path: dm[1] || "",
          norm: normPath(dm[1] || ""),
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler,
          raw: (dm[1] || "decorator").slice(0, 56),
          kind: "route",
        });
        continue;
      }
      const nm = ln.match(NEXT_RE);
      if (nm) {
        out.push({
          verb: nm[1].toUpperCase(),
          path: "",
          norm: `next:${nm[1].toUpperCase()}`,
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: nm[1],
          raw: `${nm[1]} handler`,
          kind: "route",
        });
        continue;
      }
      const tm = ln.match(TAURI_RE);
      if (tm) {
        out.push({
          verb: "invoke",
          path: `/${tm[1]}`,
          norm: normInvoke(tm[1]),
          fileId: f.id,
          filePath: f.relPath,
          line: i + 1,
          handler: tm[1],
          raw: `invoke ${tm[1]}`,
          kind: "route",
        });
      }
    }
    return out;
  });

  const calls: ApiNode[] = [];
  const routes: ApiNode[] = [];
  for (const arr of scanned) {
    if (!arr) continue;
    for (const n of arr) (n.kind === "call" ? calls : routes).push(n);
  }

  if (calls.length === 0 && routes.length === 0) {
    return { ok: false, message: t("portrait.msg.apiTraceNoData"), severity: "info", placed: 0 };
  }

  // ── 链接器：call → route ──
  const pushRoute = (map: Map<string, ApiNode[]>, key: string, node: ApiNode) => {
    const arr = map.get(key);
    if (arr) arr.push(node);
    else map.set(key, [node]);
  };
  const routeByVerbNorm = new Map<string, ApiNode[]>();
  const routeByNorm = new Map<string, ApiNode[]>();
  for (const r of routes) {
    pushRoute(routeByVerbNorm, `${r.verb}|${r.norm}`, r);
    pushRoute(routeByNorm, r.norm, r);
  }
  const matchRoute = (call: ApiNode): ApiNode | null => {
    if (call.verb === "invoke") {
      const arr = routeByVerbNorm.get(`invoke|${call.norm}`) ?? routeByNorm.get(call.norm) ?? [];
      return arr.find((r) => r.verb === "invoke") ?? arr[0] ?? null;
    }
    const exact = routeByVerbNorm.get(`${call.verb}|${call.norm}`);
    if (exact && exact.length) return exact[0];
    const byNorm = routeByNorm.get(call.norm);
    if (byNorm && byNorm.length) return byNorm[0];
    for (const r of routes) {
      if (r.verb !== call.verb) continue;
      if (r.norm.startsWith(call.norm + "/") || call.norm.startsWith(r.norm + "/")) return r;
    }
    return null;
  };

  // 分类
  const matched: { call: ApiNode; route: ApiNode }[] = [];
  const matchedRouteKeys = new Set<string>();
  const seenEndpoint = new Set<string>();
  const orphan: ApiNode[] = [];
  for (const c of calls) {
    const r = matchRoute(c);
    if (r) {
      const key = `${c.verb}|${c.norm}`;
      if (!seenEndpoint.has(key)) {
        seenEndpoint.add(key);
        matched.push({ call: c, route: r });
      }
      matchedRouteKeys.add(`${r.verb}|${r.norm}`);
      matchedRouteKeys.add(r.norm);
    } else {
      orphan.push(c);
    }
  }
  const dead = routes.filter(
    (r) => !matchedRouteKeys.has(`${r.verb}|${r.norm}`) && !matchedRouteKeys.has(r.norm)
  );

  // 解析 handler 符号 + 下游
  const resolveHandler = (handler: string | null, routeFile: string): any | null => {
    if (!handler) return null;
    const name = handler.includes(".") ? handler.split(".").pop()! : handler;
    const cands = symbolByName.get(name);
    if (!cands || cands.length === 0) return null;
    return cands.find((s) => s.filePath === routeFile) ?? cands[0];
  };
  const downstream = (handlerSymId: string): any[] => {
    const visited = new Set<string>([handlerSymId]);
    const found: string[] = [];
    let frontier = [handlerSymId];
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const sid of frontier) {
        for (const e of callEdges) {
          if (e.callerSymbolId === sid && e.callerFileId !== e.calleeFileId) {
            if (!visited.has(e.calleeSymbolId)) {
              visited.add(e.calleeSymbolId);
              found.push(e.calleeSymbolId);
              next.push(e.calleeSymbolId);
            }
          }
        }
      }
      frontier = next;
    }
    return found.slice(0, 6).map((id) => symbolById.get(id)).filter(Boolean);
  };

  // ── 渲染 ──
  clearCanvas();
  const NODE_W = 250;
  const NODE_H = 46;
  const COL_GAP = 70;
  const ROW_GAP = 18;
  const LEFT = 60;
  const TOP = 80;

  // 竖向连线（top→bottom）：a 底中点 → b 顶中点
  // 纵向连线用共享原语 connectVertical（与 taintFlow 同一套几何，改一处即两处生效）

  const ROLE_COLOR: Record<string, string> = {
    call: "#3b82f6",
    route: "#f59e0b",
    handler: "#22c55e",
    downstream: "#94a3b8",
  };
  const placeNode = (
    role: "call" | "route" | "handler" | "downstream",
    x: number,
    y: number,
    label: string,
    fileId: string | null,
    filePath: string,
    line: number,
    symbolId?: string | null,
    extra?: Record<string, unknown>
  ) => {
    place(
      "function",
      { x, y },
      label,
      {
        name: label,
        symbolKind: "function",
        fileId: fileId ?? null,
        filePath: filePath ?? null,
        lineStart: line,
        symbolId: symbolId ?? null,
        portraitMode: "apiTrace",
        accentColor: ROLE_COLOR[role],
        apiRole: role,
        isEntry: role === "handler",
        ...(extra || {}),
      },
      { w: NODE_W, h: NODE_H }
    );
  };

  // 图例
  place("layer-marker", { x: LEFT, y: 24 }, t("portrait.msg.apiTraceLegend"), {
    layerName: t("portrait.msg.apiTraceLegend"),
    layerColor: "#3b82f6",
    layerOrder: 0,
    fileCount: view === "all" ? matched.length : view === "orphan" ? orphan.length : dead.length,
    description: t("portrait.msg.apiTraceLegendHint"),
    portraitMode: "apiTrace",
  });

  let edgeCount = 0;
  let placed = 0;

  if (view === "all") {
    if (matched.length === 0) {
      return { ok: false, message: t("portrait.msg.apiTraceNoLink"), severity: "info", placed: 0 };
    }
    const CAP = 60;
    const traces = matched.slice(0, CAP);
    const colW = NODE_W + COL_GAP;
    traces.forEach((tr, col) => {
      const x = LEFT + col * colW;
      const callNode = { x, y: TOP, w: NODE_W, h: NODE_H };
      placeNode(
        "call",
        x,
        TOP,
        `${tr.call.verb === "invoke" ? "invoke" : tr.call.verb} ${tr.call.path || ""}`.trim().slice(0, 40),
        tr.call.fileId,
        tr.call.filePath,
        tr.call.line
      );
      placed++;
      const routeY = TOP + (NODE_H + ROW_GAP);
      const routeNode = { x, y: routeY, w: NODE_W, h: NODE_H };
      placeNode(
        "route",
        x,
        routeY,
        `${tr.route.verb === "DECORATOR" ? "API" : tr.route.verb} ${tr.route.path || ""}`.trim().slice(0, 40),
        tr.route.fileId,
        tr.route.filePath,
        tr.route.line
      );
      placed++;
      connectVertical(callNode, routeNode, `${tr.call.verb} ${tr.call.path} → ${tr.route.verb} ${tr.route.path}`, {
        depType: "api-link",
        isCircular: false,
        fromFileId: tr.call.fileId,
        toFileId: tr.route.fileId,
        portraitMode: "apiTrace",
        apiCrossBoundary: true,
      });
      edgeCount++;

      const handlerSym = resolveHandler(tr.route.handler, tr.route.filePath);
      let prev = routeNode;
      if (handlerSym) {
        const hY = routeY + (NODE_H + ROW_GAP);
        const hNode = { x, y: hY, w: NODE_W, h: NODE_H };
        placeNode(
          "handler",
          x,
          hY,
          (handlerSym.name || "handler").slice(0, 40),
          handlerSym.fileId ?? null,
          handlerSym.filePath ?? tr.route.filePath,
          handlerSym.lineStart ?? tr.route.line,
          handlerSym.id,
          { callIn: handlerSym.callIn ?? 0, callOut: handlerSym.callOut ?? 0 }
        );
        placed++;
        connectVertical(prev, hNode, `${tr.route.path} → ${handlerSym.name}`, {
          depType: "api-handler",
          isCircular: false,
          fromFileId: tr.route.fileId,
          toFileId: handlerSym.fileId ?? null,
          portraitMode: "apiTrace",
        });
        edgeCount++;
        prev = hNode;
        const ds = downstream(handlerSym.id);
        for (const d of ds) {
          const dY = prev.y + (NODE_H + ROW_GAP);
          const dNode = { x, y: dY, w: NODE_W, h: NODE_H };
          placeNode(
            "downstream",
            x,
            dY,
            (d.name || "method").slice(0, 40),
            d.fileId ?? null,
            d.filePath ?? "",
            d.lineStart ?? 0,
            d.id
          );
          placed++;
          connectVertical(prev, dNode, `${handlerSym.name} → ${d.name}`, {
            depType: "call",
            isCircular: false,
            fromFileId: handlerSym.fileId ?? null,
            toFileId: d.fileId ?? null,
            portraitMode: "apiTrace",
          });
          edgeCount++;
          prev = dNode;
        }
      }
    });
  } else if (view === "orphan") {
    if (orphan.length === 0) {
      return { ok: false, message: t("portrait.msg.apiTraceNoOrphan"), severity: "info", placed: 0 };
    }
    const CAP = 80;
    const items = orphan.slice(0, CAP);
    const perRow = Math.max(1, Math.floor((4096 - LEFT) / (NODE_W + COL_GAP)));
    items.forEach((c, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = LEFT + col * (NODE_W + COL_GAP);
      const y = TOP + row * (NODE_H + ROW_GAP);
      placeNode(
        "call",
        x,
        y,
        `${c.verb === "invoke" ? "invoke" : c.verb} ${c.path || ""}`.trim().slice(0, 40),
        c.fileId,
        c.filePath,
        c.line,
        null,
        { apiOrphan: true }
      );
      placed++;
    });
  } else {
    // dead
    if (dead.length === 0) {
      return { ok: false, message: t("portrait.msg.apiTraceNoDead"), severity: "info", placed: 0 };
    }
    const CAP = 80;
    const items = dead.slice(0, CAP);
    const perRow = Math.max(1, Math.floor((4096 - LEFT) / (NODE_W + COL_GAP)));
    items.forEach((r, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = LEFT + col * (NODE_W + COL_GAP);
      const y = TOP + row * (NODE_H + ROW_GAP);
      placeNode(
        "route",
        x,
        y,
        `${r.verb === "DECORATOR" ? "API" : r.verb} ${r.path || ""}`.trim().slice(0, 40),
        r.fileId,
        r.filePath,
        r.line,
        null,
        { apiDead: true }
      );
      placed++;
    });
  }

  await persist(analysisId, "apiTrace");

  const overCap =
    (view === "all" && matched.length > 60) ||
    (view === "orphan" && orphan.length > 80) ||
    (view === "dead" && dead.length > 80);
  return {
    ok: true,
    message: t("portrait.msg.apiTraceDone", {
      n: view === "all" ? Math.min(matched.length, 60) : placed,
      edges: edgeCount,
      orphan: orphan.length,
      dead: dead.length,
      trunc: overCap ? t("portrait.msg.apiTraceTrunc") : "",
    }),
    severity: "success",
    placed,
  };
}

// ───────────────────────── 污点传播路径画像（对标 joern reachableByFlows） ─────────────────────────
/**
 * 污点传播路径画像（taintFlow）：回答安全与审计最核心的问题 ——
 * **不可信数据从哪个函数进来 → 经过哪些函数 → 在第几个参数位置传递 → 落到哪个危险调用**。
 *
 * 此前所有画像都在回答「代码长什么样」与「代码怎么调」，没有一张回答「数据怎么流、
 * 流到哪会出事」。joern 的旗舰能力 `reachableByFlows` 做的正是这件事，但我们没有
 * 语句级 DDG，只有 `project_data_flow` 的函数级摘要 + `project_call_edges` 的调用边，
 * 因此本画像是**诚实的能力降级版**（函数级 / 参数位置感知 / 上下文不敏感），
 * 完整取舍与局限说明见 `taintFlow.ts` 头部。
 *
 * 可行动性（画像价值铁律）：每个节点都带 fileId + filePath + lineStart，
 * 双击经 SceneEditor 兜底分支直达源码；sink 节点锚定在**危险调用所在行**
 * （不是函数定义行），点开即是出事的那一行。
 *
 * 三视图（view）：all=全部链路 / critical=仅高危(score≥4) / sanitized=已被净化函数拦下。
 */
async function runTaintFlowPortrait(
  analysisId: string,
  view: TaintView = "all"
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let facts = pst.dataFlow;

  // 自愈：dataFlow 为空（扫描漏跑 / 增量未带出）时主动重拉，避免永远「无数据」且无入口强刷
  if (facts.length === 0) {
    try {
      await pst.analyzeDataFlow(analysisId, undefined);
      await pst.loadDataFlow(analysisId);
      facts = useProjectStore.getState().dataFlow;
    } catch (err) {
      console.error("[runTaintFlowPortrait] 自愈重拉 dataFlow 失败", err);
    }
  }
  if (facts.length === 0) {
    return { ok: false, message: t("portrait.msg.taintNoData"), severity: "info", placed: 0 };
  }

  let edges = pst.callEdges;
  if (edges.length === 0) {
    try {
      await pst.loadCallEdges(analysisId);
      edges = useProjectStore.getState().callEdges;
    } catch (err) {
      console.error("[runTaintFlowPortrait] 加载调用边失败", err);
    }
  }
  if (edges.length === 0) {
    return { ok: false, message: t("portrait.msg.taintNoEdges"), severity: "info", placed: 0 };
  }

  const built = buildTaintPaths(facts, edges);
  const filtered = filterTaintPaths(built, view);
  if (filtered.paths.length === 0) {
    const msg =
      view === "critical"
        ? t("portrait.msg.taintNoCritical")
        : view === "sanitized"
          ? t("portrait.msg.taintNoSanitized")
          : t("portrait.msg.taintNoPath", { n: facts.length });
    return { ok: false, message: msg, severity: "info", placed: 0 };
  }

  const layout = layoutTaintPaths(filtered, {
    left: 60,
    top: 80,
    nodeW: 250,
    nodeH: 46,
    rowGap: 18,
    colGap: 70,
    maxPaths: 40,
  });

  clearCanvas();

  place("layer-marker", { x: 60, y: 24 }, t("portrait.msg.taintLegend"), {
    layerName: t("portrait.msg.taintLegend"),
    layerColor: "#ef4444",
    layerOrder: 0,
    fileCount: filtered.paths.length,
    description: t("portrait.msg.taintLegendHint"),
    portraitMode: "taintFlow",
  });

  let placed = 0;
  let edgeCount = 0;
  for (const p of layout.paths) {
    for (const n of p.nodes) {
      const node = n as TaintLayoutNode;
      const label = node.name.length > 34 ? `${node.name.slice(0, 33)}…` : node.name;
      const color =
        node.role === "sink" && node.endKind ? SINK_KIND_COLOR[node.endKind] : TAINT_ROLE_COLOR[node.role];
      place(
        "function",
        { x: node.x, y: node.y },
        label,
        {
          name: node.name,
          symbolKind: "function",
          fileId: node.fileId || null,
          filePath: node.filePath || null,
          lineStart: node.line,
          symbolId: node.symbolId ?? null,
          portraitMode: "taintFlow",
          accentColor: color,
          taintRole: node.role,
          taintEndKind: node.endKind ?? null,
          taintSeverity: node.severity,
          taintRule: node.rule ?? null,
          taintParams: node.tainted,
          // 复用 FunctionRenderer 的等级配色：汇点最重、源次之、净化最轻
          level:
            node.role === "sink"
              ? "extreme"
              : node.role === "source"
                ? "high"
                : node.role === "sanitized"
                  ? "low"
                  : "medium",
          levelLabel: TAINT_ROLE_LABEL[node.role],
          signature: node.rule && node.endKind ? `${SINK_KIND_LABEL[node.endKind]} · ${node.rule}` : null,
        },
        { w: node.width, h: node.height }
      );
      placed++;
    }
    for (const e of p.edges) {
      const a = p.nodes[e.from];
      const b = p.nodes[e.to];
      if (!a || !b) continue;
      connectVertical(
        { x: a.x, y: a.y, w: a.width, h: a.height },
        { x: b.x, y: b.y, w: b.width, h: b.height },
        e.label,
        {
          depType: "taint",
          isCircular: false,
          fromFileId: a.fileId || null,
          toFileId: b.fileId || null,
          portraitMode: "taintFlow",
          taintSink: p.endKind,
        }
      );
      edgeCount++;
    }
  }

  await persist(analysisId, "taintFlow");

  const st = layout.stats;
  return {
    ok: true,
    message: t("portrait.msg.taintDone", {
      n: st.paths,
      sinks: st.sinks,
      sanitized: st.sanitized,
      edges: edgeCount,
      unresolved: st.unresolved,
      trunc: st.truncated ? t("portrait.msg.taintTrunc") : "",
    }),
    severity: st.sinks > 0 ? "warning" : "success",
    placed,
  };
}

/**
 * 调用链画像：从某个符号沿调用图做多跳展开（真正 A→B→C→D 完整链路）。
 *
 * - 双向 BFS：上游 caller（谁调用它）+ 下游 callee（它调用谁），各 `depth` 跳（默认 2）。
 * - 增量追加到当前画布（不重建全图），节点带 symbolId+fileId+lineStart（双击跳源码），
 *   边带 fromFileId/toFileId（复用 DependencyEdgeRenderer 高亮）。
 * - 返回创建的组件 id，供调用方在「再次单击」时收起（removeComponentsBulk）。
 * - 非侵入：零后端、不触碰 runCallGraphPortrait 的全量布局。
 */
export function expandCallChain(
  analysisId: string,
  symbolId: string,
  origin: { x: number; y: number },
  depth = 2
): { nodeIds: string[]; edgeIds: string[]; count: number } {
  const pst = useProjectStore.getState();
  const edges = pst.callEdges.filter((e) => e.kind === "cross-file");
  const symbolById = new Map(pst.symbols.map((s) => [s.id, s]));

  // BFS 收集多跳邻居符号（去重，排除起点自身与同文件内边）
  const visited = new Set<string>([symbolId]);
  const frontier = [symbolId];
  const found = new Set<string>(); // 多跳到达的符号（不含起点）
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const sid of frontier) {
      for (const e of edges) {
        if (e.callerFileId === e.calleeFileId) continue;
        // 上游：sid 是被调方 → 找调用者
        if (e.calleeSymbolId === sid && !visited.has(e.callerSymbolId)) {
          visited.add(e.callerSymbolId);
          found.add(e.callerSymbolId);
          next.push(e.callerSymbolId);
        }
        // 下游：sid 是调用方 → 找被调者
        if (e.callerSymbolId === sid && !visited.has(e.calleeSymbolId)) {
          visited.add(e.calleeSymbolId);
          found.add(e.calleeSymbolId);
          next.push(e.calleeSymbolId);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }

  if (found.size === 0) return { nodeIds: [], edgeIds: [], count: 0 };

  const SYM_W = 210;
  const SYM_H = 52;
  const GAP_X = SYM_W + 60;
  const GAP_Y = SYM_H + 36;
  const perCol = Math.ceil(Math.sqrt(found.size)) || 1;

  // 起点节点放在 origin，邻居沿右下网格铺开
  const idBySymbol = new Map<string, string>();
  const items: BulkComponentInput[] = [];

  const startSym = symbolById.get(symbolId);
  const startId = `cg-${globalThis.crypto?.randomUUID?.() ?? `${symbolId}-${Date.now()}`}`;
  idBySymbol.set(symbolId, startId);
  items.push({
    type: "function",
    name: startSym?.name ?? symbolId,
    x: origin.x,
    y: origin.y,
    width: SYM_W,
    height: SYM_H,
    config: {
      name: startSym?.name ?? symbolId,
      symbolKind: startSym?.kind ?? "function",
      fileId: startSym?.fileId ?? null,
      filePath: startSym?.filePath ?? null,
      lineStart: startSym?.lineStart ?? null,
      symbolId,
      portraitMode: "callGraph",
      isChainHub: true,
      expandOwner: symbolId,
    },
  });

  const foundArr = Array.from(found);
  foundArr.forEach((sid, i) => {
    const sym = symbolById.get(sid);
    const col = i % perCol;
    const row = Math.floor(i / perCol);
    const id = `cg-${globalThis.crypto?.randomUUID?.() ?? `${sid}-${Date.now()}-${i}`}`;
    idBySymbol.set(sid, id);
    items.push({
      type: "function",
      name: sym?.name ?? sid,
      x: origin.x + GAP_X * (col + 1),
      y: origin.y + GAP_Y * row,
      width: SYM_W,
      height: SYM_H,
      config: {
        name: sym?.name ?? sid,
        symbolKind: sym?.kind ?? "function",
        fileId: sym?.fileId ?? null,
        filePath: sym?.filePath ?? null,
        lineStart: sym?.lineStart ?? null,
        symbolId: sid,
        portraitMode: "callGraph",
        expandOwner: symbolId,
      },
    });
  });

  // 边：连接起点与所有多跳邻居（直接 1 跳）+ 邻居间若也存在调用则补边
  const edgeItems: BulkComponentInput[] = [];
  const linkEdge = (fromSid: string, toSid: string, label: string) => {
    const fa = idBySymbol.get(fromSid);
    const tb = idBySymbol.get(toSid);
    if (!fa || !tb) return;
    const fromComp = items.find((it) => it.config?.symbolId === fromSid) as any;
    const toComp = items.find((it) => it.config?.symbolId === toSid) as any;
    if (!fromComp || !toComp) return;
    const ax = fromComp.x + fromComp.width;
    const ay = fromComp.y + fromComp.height / 2;
    const bx = toComp.x;
    const by = toComp.y + toComp.height / 2;
    const minX = Math.min(ax, bx);
    const minY = Math.min(ay, by);
    const cf = pst.callEdges.find(
      (e) => e.callerSymbolId === fromSid && e.calleeSymbolId === toSid
    );
    edgeItems.push({
      type: "dependency-edge",
      name: label,
      x: minX,
      y: minY,
      width: Math.max(4, Math.abs(bx - ax) + 16),
      height: Math.max(4, Math.abs(by - ay) + 16),
      config: {
        depType: "call",
        isCircular: false,
        fromFileId: cf?.callerFileId ?? null,
        toFileId: cf?.calleeFileId ?? null,
        symbolNames: [label],
        callCount: 1,
        portraitMode: "callGraph",
        expandOwner: symbolId,
        fromX: ax - minX,
        fromY: ay - minY,
        toX: bx - minX,
        toY: by - minY,
      },
    });
  };

  // 1 跳直连：起点 ↔ 邻居
  for (const sid of foundArr) {
    const upEdge = edges.find((e) => e.calleeSymbolId === symbolId && e.callerSymbolId === sid);
    const downEdge = edges.find((e) => e.callerSymbolId === symbolId && e.calleeSymbolId === sid);
    if (upEdge) linkEdge(sid, symbolId, `${upEdge.callerName} → ${receiverQualifiedName(upEdge.calleeName, upEdge.calleeReceiver)}`);
    else if (downEdge) linkEdge(symbolId, sid, `${downEdge.callerName} → ${receiverQualifiedName(downEdge.calleeName, downEdge.calleeReceiver)}`);
  }
  // 2 跳及以上：邻居之间存在调用也画边（补全路径可视性）
  for (let i = 0; i < foundArr.length; i++) {
    for (let j = 0; j < foundArr.length; j++) {
      if (i === j) continue;
      const e = edges.find(
        (ed) => ed.callerSymbolId === foundArr[i] && ed.calleeSymbolId === foundArr[j]
      );
      if (e) linkEdge(foundArr[i], foundArr[j], `${e.callerName} → ${receiverQualifiedName(e.calleeName, e.calleeReceiver)}`);
    }
  }

  const allItems = [...items, ...edgeItems];
  let nodeIds: string[] = [];
  let edgeIds: string[] = [];
  if (allItems.length > 0) {
    const ids = useEditorStore.getState().addComponentsBulk(allItems);
    // addComponentsBulk 返回顺序与输入一致：前 items.length 个是节点，其余是边
    nodeIds = ids.slice(0, items.length);
    edgeIds = ids.slice(items.length);
  }
  return { nodeIds, edgeIds, count: found.size };
}

// ───────────────────────── 通用画布原语 ─────────────────────────

/** 清空当前视图的画布实体（画像都是「重建」语义） */
function clearCanvas() {
  useEditorStore.setState((s: any) => {
    s.components = [];
  });
}

/** v2.17 依赖画像模块簇色板（高区分度 10 色，按顶层目录哈希取色） */
const MODULE_PALETTE = [
  "#0ea5e9", "#f97316", "#8b5cf6", "#10b981", "#ef4444",
  "#eab308", "#ec4899", "#14b8a6", "#6366f1", "#f59e0b",
];

// 画布落库缓冲：place/connect 不再逐个 addComponent（每次触发 setState 让全画布重渲染，
// 几百节点即 O(N²) 卡顿），改为先收集到 _pending，由 persist 开头一次性 addComponentsBulk。
let _pending: BulkComponentInput[] = [];

/** 把缓冲的实体一次性落库（单条历史、单次 set），调用后清空缓冲 */
function flushPending(_analysisId: string) {
  if (_pending.length === 0) return;
  const items = _pending;
  _pending = [];
  try {
    useEditorStore.getState().addComponentsBulk(items);
  } catch (e) {
    console.error("[portraits] flushPending failed", e);
  }
}

/** 添加实体并覆写 name / config，返回本地占位 id（供 connect 引用，落库由 flushPending 统一完成） */
function place(
  type: string,
  pos: { x: number; y: number },
  name: string,
  config: Record<string, unknown>,
  size?: { w: number; h: number }
): string {
  const id = `p${_pending.length}`;
  _pending.push({
    type,
    name,
    x: pos.x,
    y: pos.y,
    ...(size ? { width: size.w, height: size.h } : {}),
    config,
  });
  return id;
}

/**
 * 画一条从 A 底边中点 → B 顶边中点的**纵向**依赖连线（每条依赖占一行、从上到下读）
 *
 * apiTrace / taintFlow 这类「一条链一列、节点自上而下」的画像都用这个：
 * 竖线比斜线更容易一眼读出顺序。包围盒端点换算同 connect。
 */
function connectVertical(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  name: string,
  config: Record<string, unknown>
): void {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h;
  const bx = b.x + b.w / 2;
  const by = b.y;
  const minX = Math.min(ax, bx);
  const minY = Math.min(ay, by);
  _pending.push({
    type: "dependency-edge",
    name,
    x: minX,
    y: minY,
    width: Math.max(4, Math.abs(bx - ax) + 28),
    height: Math.max(4, Math.abs(by - ay) + 16),
    config: {
      ...config,
      fromX: ax - minX,
      fromY: ay - minY,
      toX: bx - minX,
      toY: by - minY,
    },
  });
}

/**
 * 画一条从 A 右边缘中点 → B 左边缘中点的依赖连线
 *
 * dependency-edge 实体的 transform 是包围盒，端点坐标要转成盒内相对坐标，
 * 这段换算在三个画像里重复了三遍，收成一个函数。
 */
function connect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  name: string,
  config: Record<string, unknown>
): string {
  const absFromX = a.x + a.w;
  const absFromY = a.y + a.h / 2;
  const absToX = b.x;
  const absToY = b.y + b.h / 2;
  const minX = Math.min(absFromX, absToX);
  const minY = Math.min(absFromY, absToY);
  const id = `p${_pending.length}`;
  _pending.push({
    type: "dependency-edge",
    name,
    x: minX,
    y: minY,
    width: Math.max(4, Math.abs(absToX - absFromX) + 16),
    height: Math.max(4, Math.abs(absToY - absFromY) + 16),
    config: {
      ...config,
      fromX: absFromX - minX,
      fromY: absFromY - minY,
      toX: absToX - minX,
      toY: absToY - minY,
    },
  });
  return id;
}

/** 文件 relPath → 顶层目录名（模块口径，全项目统一） */
function topDirOf(relPath: string): string {
  return relPath.includes("/") ? relPath.split("/")[0] : "root";
}

// ───────────────────────── 架构画像 ─────────────────────────

/**
 * 架构画像：模块按分层 y 轴排布 + 模块级依赖连线
 *
 * 这是「项目骨架图」——每行一个架构分层，行内是该层的模块，
 * 模块间连线由文件级 import 边按顶层目录聚合而来，循环依赖标红。
 */
async function runArchitecturePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const { layers, modules, dependencies, files, symbolRefs, metrics, techDebt } = pst;
  if (modules.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.archNoModules"),
      severity: "info",
      placed: 0,
    };
  }

  clearCanvas();

  const sortedLayers = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
  const unlayered = modules.filter((m) => !layers.some((l) => l.id === m.layerId));
  const groups: { layer: (typeof layers)[number] | null; mods: typeof modules }[] = [];
  for (const l of sortedLayers) {
    groups.push({ layer: l, mods: modules.filter((m) => m.layerId === l.id) });
  }
  if (unlayered.length > 0) groups.push({ layer: null, mods: unlayered });

  const TOP = 80;
  const LEFT = 40;
  const ROW_GAP = 190;
  const COL_GAP = 250;
  const MOD_W = 220;
  const MOD_H = 88;
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = TOP;

  for (const g of groups) {
    if (g.mods.length === 0) {
      if (g.layer) y += ROW_GAP;
      continue;
    }
    if (g.layer) {
      place("layer-marker", { x: LEFT, y: y - 34 }, g.layer.name, {
        layerName: g.layer.name,
        layerColor: g.layer.color,
        layerOrder: g.layer.sortOrder,
      });
    }
    let x = LEFT;
    for (const m of g.mods) {
      // 模块级聚合口径（与 ModuleRenderer / SVG 报告保持一致）：顶层目录名匹配
      const modFiles = files.filter((f) => !f.isDirectory && topDirOf(f.relPath) === m.name);
      const lineCount = modFiles.reduce((acc, f) => acc + (f.lineCount || 0), 0);
      const ccs = metrics
        .filter((mt) => mt.cyclomaticComplexity > 0 && modFiles.some((f) => f.id === mt.fileId))
        .map((mt) => mt.cyclomaticComplexity);
      const avgComplexity = ccs.length > 0 ? ccs.reduce((a, b) => a + b, 0) / ccs.length : 0;
      const maxComplexity = ccs.length > 0 ? Math.max(...ccs) : 0;
      const complexityLevel =
        avgComplexity <= 5 ? "low" : avgComplexity <= 10 ? "medium" : avgComplexity <= 20 ? "high" : "extreme";
      const techDebtCount = techDebt.filter((t) => modFiles.some((f) => f.id === t.fileId)).length;
      const id = place("module", { x, y }, m.name, {
        name: m.name,
        moduleName: m.name,
        fileCount: m.fileCount,
        depCount: m.depCount,
        beDepCount: m.beDepCount,
        lineCount,
        avgComplexity,
        maxComplexity,
        complexityLevel,
        techDebtCount,
        projectLayerId: m.layerId,
        color: m.color,
        moduleId: m.id,
        portraitMode: "architecture",
      });
      if (id) placed.set(m.id, { x, y, w: MOD_W, h: MOD_H });
      x += COL_GAP;
    }
    y += ROW_GAP;
  }

  // 文件级依赖 → 模块级聚合边
  const fileToModule = new Map<string, string>();
  for (const f of files) {
    if (!f.isDirectory) fileToModule.set(f.id, topDirOf(f.relPath));
  }
  const moduleNameToId = new Map(modules.map((m) => [m.name, m.id]));
  const seen = new Set<string>();
  let edgeCount = 0;
  let circularCount = 0;
  for (const d of dependencies) {
    const fromMod = fileToModule.get(d.fromId);
    const toMod = fileToModule.get(d.toId);
    if (!fromMod || !toMod || fromMod === toMod) continue;
    const fromId = moduleNameToId.get(fromMod);
    const toId = moduleNameToId.get(toMod);
    if (!fromId || !toId) continue;
    const key = `${fromId}->${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = placed.get(fromId);
    const b = placed.get(toId);
    if (!a || !b) continue;
    const refsOnEdge = symbolRefs.filter((r) => r.fromFileId === d.fromId && r.toFileId === d.toId);
    const symbolNames = Array.from(
      new Set(refsOnEdge.map((r) => r.symbolName).filter(Boolean))
    ).slice(0, 5);
    if (
      connect(a, b, `${fromMod} → ${toMod}`, {
        depType: d.kind || "import",
        isCircular: !!d.isCircular,
        fromMod,
        toMod,
        symbolNames,
      })
    ) {
      edgeCount += 1;
      if (d.isCircular) circularCount += 1;
    }
  }

  await persist(analysisId, "architecture");
  return {
    ok: true,
    message: t("portrait.msg.archDone", {
      n: modules.length,
      edges: edgeCount,
      cycles: circularCount > 0 ? t("portrait.msg.archCycles", { n: circularCount }) : "",
    }),
    severity: "success",
    placed: placed.size,
  };
}

// ───────────────────────── 依赖关系画像 ─────────────────────────

/**
 * 文件级依赖图：力导向布局 + Tarjan 环检测
 *
 * 与架构画像（模块粒度）互补，这里是文件粒度。
 *
 * 布局原本是「按依赖深度分列」，节点一多就退化成几根竖直的长条，
 * 30 个文件挤在一列、连线横穿整张画布，看不出任何聚类。改用力导向后
 * 互相 import 的文件被弹簧拉到一起，**模块簇会自己浮现出来**，
 * 而稀疏区域自动留白。拓扑深度依然保留，只是不再决定坐标，
 * 改为写进实体 config 供属性面板展示。
 *
 * 循环依赖也从「后端两两比对的 isCircular 布尔位」升级为 Tarjan 强连通分量，
 * 能挖出 a→b→c→a 这类三元以上的长环 —— 那才是真正难拆的那种。
 * 上限 90 个节点。
 */
async function runDependencyPortrait(analysisId: string, focusFileId?: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const fileById = new Map(pst.files.filter((f) => !f.isDirectory).map((f) => [f.id, f]));
  const edges = pst.dependencies.filter(
    (d) => fileById.has(d.fromId) && fileById.has(d.toId) && d.fromId !== d.toId
  );
  if (edges.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.depNoData"),
      severity: "info",
      placed: 0,
    };
  }

  // v2.17 模块簇着色：按顶层目录取模块色（画布上同模块同色 → 模块边界一眼可见）
  const moduleOf = new Map<string, string>();
  for (const id of fileById.keys()) {
    const f = fileById.get(id);
    if (f) moduleOf.set(id, topDirOf(f.relPath));
  }
  const moduleColorOf = (id: string): string => {
    const m = moduleOf.get(id) ?? "";
    let h = 0;
    for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
    return MODULE_PALETTE[h % MODULE_PALETTE.length];
  };

  // 参与依赖的文件，按度数取前 90
  const degree = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const d of edges) {
    degree.set(d.fromId, (degree.get(d.fromId) || 0) + 1);
    degree.set(d.toId, (degree.get(d.toId) || 0) + 1);
  }

  // v2.17 依赖焦点（方案 A 修正 · 修回归）：点左侧项目树里一个【不在 top-90 采样上】
  // 的文件时，绝不能把整张全局依赖图重绘成「只有该文件+邻居」的子图 —— 那会让用户
  // 看到「其它节点全消失」（即本次回归）。正确做法：保留 top-90 全局图，把焦点文件
  // 及其 1 跳邻居「并入」并高亮（焦点文件描环），其余节点原样留在画布上。
  // keep = top-90 ∪ {焦点 + 它的全部 1 跳邻居}；
  // kept = keep 内任意两节点之间的「全部」依赖边（含 top-90 之间的全局边 + 焦点邻域边）。
  // 这样全局依赖关系永远不丢，焦点邻域也可见、可被点击/双击。
  const top90 = Array.from(degree.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 90)
    .map(([id]) => id);
  const top90Set = new Set(top90);
  const focusFile = focusFileId ? fileById.get(focusFileId) : undefined;
  let keep: Set<string>;
  if (focusFile && focusFileId) {
    // 保留全局图 + 并入焦点邻域（并集，非替换）—— 全局依赖关系永不消失
    keep = new Set(top90);
    keep.add(focusFileId);
    for (const d of edges) {
      if (d.fromId === focusFileId) keep.add(d.toId);
      if (d.toId === focusFileId) keep.add(d.fromId);
    }
  } else {
    keep = new Set(top90);
  }
  // 诱导子图：保留 keep 内任意两节点之间的所有边（不只与焦点相连的边）
  const kept = edges.filter((d) => keep.has(d.fromId) && keep.has(d.toId));
  for (const id of keep) {
    outAdj.set(id, []);
    inDeg.set(id, 0);
  }
  for (const d of kept) {
    outAdj.get(d.fromId)!.push(d.toId);
    outDeg.set(d.fromId, (outDeg.get(d.fromId) || 0) + 1);
    inDeg.set(d.toId, (inDeg.get(d.toId) || 0) + 1);
  }

  // ── Tarjan 找出真实的循环依赖环（含 3 元以上长环，不只是两两互引）──
  const fileCycles = findCycles(
    Array.from(keep),
    kept.map((d) => ({ from: d.fromId, to: d.toId }))
  );
  const cycleOf = new Map<string, number>();
  fileCycles.forEach((c, ci) => c.nodes.forEach((n) => cycleOf.set(n, ci)));

  // 拓扑深度仍然要算：它是「谁是入口、谁是底座」的语义信息。
  // 力导向只负责摆位置，深度写进 config 供属性面板与 Tooltip 使用。
  const depth = new Map<string, number>();
  let frontier = Array.from(keep).filter((id) => (inDeg.get(id) || 0) === 0);
  const remainingIn = new Map(inDeg);
  let level = 0;
  const visited = new Set<string>();
  while (frontier.length > 0 && level < 40) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      depth.set(id, level);
      for (const to of outAdj.get(id) || []) {
        remainingIn.set(to, (remainingIn.get(to) || 0) - 1);
        if ((remainingIn.get(to) || 0) <= 0 && !visited.has(to)) next.push(to);
      }
    }
    frontier = next;
    level += 1;
  }
  for (const id of keep) if (!depth.has(id)) depth.set(id, level);

  clearCanvas();

  const insights = currentInsights();
  const NODE_W = 180;
  const NODE_H = 66;

  // ── 力导向布局：互相 import 的文件被弹簧拉到一起，模块簇自己浮现 ──
  // 画布尺寸随节点数开方增长：节点少时紧凑、节点多时留白，不会糊成一坨。
  // ── 布局双模式（v2.17）：力导向聚簇（默认）/ 拓扑分层（工具条切换）──
  // 聚簇：互相 import 的文件被弹簧拉到一起，模块簇自己浮现，画布尺寸随节点
  // 数开方增长（节点少紧凑、节点多留白，不会糊成一坨）。
  // 分层：按拓扑深度分列 —— 入口在左、底座在右，依赖方向从左向右流过画布，
  // 直接回答「架构分层是否干净」。环内节点同层聚在最后一列（红虚线回流）。
  const layoutMode = useEditorStore.getState().depLayoutMode;
  const nodeList = Array.from(keep).map((id) => ({ id, weight: degree.get(id) ?? 1 }));
  const edgeList = kept.map((d) => ({ from: d.fromId, to: d.toId }));
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  let positions: Map<string, { x: number; y: number }>;
  if (layoutMode === "layered") {
    positions = layeredLayout(nodeList, depth, {
      width: Math.max(1200, (maxDepth + 1) * (NODE_W + 144)),
      height: Math.max(760, Math.round(Math.sqrt(keep.size) * 215)),
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      originX: 60,
      originY: 40,
    });
  } else {
    positions = forceDirectedLayout(nodeList, edgeList, {
      width: Math.max(1200, Math.round(Math.sqrt(keep.size) * 320)),
      height: Math.max(760, Math.round(Math.sqrt(keep.size) * 215)),
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      originX: 60,
      originY: 60,
    }).positions;
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const ordered = Array.from(keep).sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));
  for (const id of ordered) {
    const f = fileById.get(id);
    const p = positions.get(id);
    if (!f || !p) continue;
    const ins = insights.get(id) ?? emptyFileInsight();
    const ci = cycleOf.get(id);
    const out = outDeg.get(id) ?? 0;
    const inn = inDeg.get(id) ?? 0;
    const mod = moduleOf.get(id) ?? "";
    // v2.17 节点徽标：→出 ←入 度数（环内节点前缀 ⭕）；模块色作 accentColor（卡片底色/色条跟随）
    const inCycleFlag = ci !== undefined;
    const metricBadge = `${inCycleFlag ? "\u2b55" : ""}\u2192${out} \u2190${inn}`;
    const metricTitle = [
      t("portrait.msg.depNodeModule", { module: mod || "-" }),
      t("portrait.msg.depNodeDepth", { n: depth.get(id) ?? 0 }),
      inCycleFlag ? t("portrait.msg.depNodeCycle", { n: fileCycles[ci].size }) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (
      place("file", { x: p.x, y: p.y }, f.name, {
        ...fileConfig(f, ins, "dependency"),
        depDepth: depth.get(id) ?? 0,
        depDegree: degree.get(id) ?? 0,
        inCycle: inCycleFlag,
        cycleSize: ci !== undefined ? fileCycles[ci].size : 0,
        // v2.17 模块簇着色 + 节点徽标
        moduleName: mod,
        accentColor: moduleColorOf(id),
        metricBadge,
        metricTitle,
        depInCycle: inCycleFlag,
        // v2.17 焦点子图：以该文件为焦点的节点描一圈高亮环（FileRenderer 读取）
        isFocus: id === focusFileId,
      })
    ) {
      pos.set(id, { x: p.x, y: p.y, w: NODE_W, h: NODE_H });
    }
  }

  let edgeCount = 0;
  let circular = 0;
  const drawn = new Set<string>();
  for (const d of kept) {
    const key = `${d.fromId}->${d.toId}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const a = pos.get(d.fromId);
    const b = pos.get(d.toId);
    if (!a || !b) continue;
    const symbolNames = Array.from(
      new Set(
        pst.symbolRefs
          .filter((r) => r.fromFileId === d.fromId && r.toFileId === d.toId)
          .map((r) => r.symbolName)
          .filter(Boolean)
      )
    ).slice(0, 4);
    // 环内边：两端落在同一个强连通分量里 —— 比后端的两两 isCircular 更准
    const sameCycle =
      cycleOf.has(d.fromId) && cycleOf.get(d.fromId) === cycleOf.get(d.toId);
    // v2.17 跨模块边：两端顶层目录不同 → 深色加粗（架构边界被绕过，需要人看）
    const crossModule = (moduleOf.get(d.fromId) ?? "") !== (moduleOf.get(d.toId) ?? "");
    if (
      connect(a, b, `${fileById.get(d.fromId)?.name} → ${fileById.get(d.toId)?.name}`, {
        depType: d.kind || "import",
        isCircular: sameCycle || !!d.isCircular,
        inCycle: sameCycle,
        symbolNames,
        crossModule,
        // v2.17 依赖画像点击高亮：把端点文件 id 写进边，画布选中节点时
        // 关联边才能被「点亮」（此前缺这两个字段，所有依赖边在选中时被误淡化）。
        fromFileId: d.fromId,
        toFileId: d.toId,
      })
    ) {
      edgeCount += 1;
      if (sameCycle || d.isCircular) circular += 1;
    }
  }

  await persist(analysisId, "dependency");
  const biggest = fileCycles[0];
  const truncated = degree.size - keep.size;
  // v2.17 焦点高亮（修回归）：焦点文件已并入全局图并描环，提示语点明
  // 「它在全局图中的哪个位置、并入了多少个原本没画出来的 1 跳邻居」，
  // 让用户清楚全局图没丢、只是多高亮了一处。
  const addedToGlobal = focusFile ? Array.from(keep).filter((id) => !top90Set.has(id)).length : 0;
  if (focusFile) {
    return {
      ok: true,
      message: t("portrait.msg.depFocus", {
        name: focusFile.name,
        added: addedToGlobal,
        files: pos.size,
        edges: edgeCount,
      }),
      severity: "info",
      placed: pos.size,
    };
  }
  return {
    ok: true,
    message: t("portrait.msg.depDone", {
      n: pos.size,
      edges: edgeCount,
      cycles: fileCycles.length > 0
        ? t("portrait.msg.depCycles", { n: fileCycles.length, size: biggest.size, edges: circular })
        : t("portrait.msg.depClean"),
      trunc: truncated > 0 ? t("portrait.msg.depTrunc", { keep: keep.size, n: truncated }) : "",
    }),
    severity: fileCycles.length > 0 ? "warning" : "success",
    placed: pos.size,
  };
}

// ───────────────────── 变更耦合画像（时间维度） ─────────────────────

/**
 * 风险等级数值化（与 Rust 端 `commands/change_coupling.rs` 的 `rank` 函数同形）：
 * - extreme → 3 / high → 2 / medium → 1 / low → 0
 * 前端切片后排序用，保证"切时窗 / 切 filter"后图上仍是"最该处理的"在前。
 */
function rankRisk(lv: string | undefined): number {
  if (lv === "extreme") return 3;
  if (lv === "high") return 2;
  if (lv === "medium") return 1;
  return 0;
}

/**
 * 变更耦合视图：把「总是一起改的文件对」画成无向图
 *
 * 与依赖画像的根本差别：
 * - 依赖画像画的是 **代码里写着的** 关系（import/use），编译器都知道
 * - 本画像画的是 **代码里没写、只存在于 git 历史里的** 关系
 *
 * 最有价值的是 `hidden` 边：两个文件之间没有任何 import，却总是一起改。
 * 这类耦合不会被任何静态工具提醒，新人改了 A 不知道要改 B —— 缺陷正是
 * 从这种地方溜出去的。画布上用**加粗实线 + 暖色**强调，跨模块的再加「!」。
 *
 * 布局用力导向 + 耦合度作为边权：耦合越强的文件被拉得越近，
 * 「命运共同体」会自己聚成团 —— 这些团往往就是真实的（而非文档上的）模块边界。
 */
async function runChangeCouplingPortrait(
  analysisId: string,
  opts?: {
    /** 前端切片：all=不过滤 / hidden=仅隐性 / highRisk=仅高风险 / crossModule=仅跨模块 */
    filter?: "all" | "hidden" | "highRisk" | "crossModule";
    /** 前端兜底时窗（天）：>0 时再按 lastCoChangeAt 二次切片。正常路径在 UI 切时窗已触发后端重扫入库。 */
    windowDays?: number | null;
    /** 焦点文件 1-跳子图：B3 详细实施，B1 先占位透传 store 会话态 */
    focusFileId?: string | null;
    /** v2.18 布局模式：force=力导向自然聚团 / cluster=按顶层目录硬分区+模块簇染色 */
    layoutMode?: "force" | "cluster";
  }
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const st = useEditorStore.getState();
  const filter = opts?.filter ?? st.couplingFilter;
  const windowDays = opts?.windowDays ?? st.couplingWindowDays;
  const focusFileId = opts?.focusFileId ?? st.couplingFocusFileId;
  const layoutMode = opts?.layoutMode ?? st.couplingLayoutMode;
  // 前端切片：filter + windowDays（focusFileId 在 B3 处理，本轮不画单文件子图）
  const allPairs = pst.changeCoupling;
  let pairs = allPairs;
  if (filter !== "all") {
    pairs = pairs.filter((p) => {
      if (filter === "hidden") return p.couplingKind === "hidden";
      if (filter === "highRisk") return p.riskLevel === "high" || p.riskLevel === "extreme";
      if (filter === "crossModule") return p.crossModule === true;
      return true;
    });
  }
  if (typeof windowDays === "number" && windowDays > 0) {
    const cutSec = Math.floor(Date.now() / 1000) - windowDays * 86400;
    pairs = pairs.filter((p) => (p.lastCoChangeAt || 0) >= cutSec);
  }

  // v2.18 焦点 1-跳子图（B3）：与 dep v2.17 修正版同形态 —— 保留全图观点 + 焦点文件 + 它
  // 的全部 1-跳邻居都并入画布（含邻居间横向边，避免"局部失真"），焦点节点 isFocus=true。
  // 与 dep 的差异：filter / window 仍生效（让用户能"在过滤视角下聚焦"）；
  // 但子图判定用「焦点 file 的所有 partner」从 allPairs 算，不受 filter/window 影响。
  // （具体实现挪到 fileById 定义之后，因需要 fileById.has() 校验焦点合法性）

  if (filter !== "all" || (typeof windowDays === "number" && windowDays > 0)) {
    pairs = [...pairs].sort(
      (a, b) =>
        // 与后端排序口径对齐：风险等级 desc → 耦合度 desc → 共变次数 desc
        rankRisk(b.riskLevel) - rankRisk(a.riskLevel) ||
        (b.degree || 0) - (a.degree || 0) ||
        (b.coChanges || 0) - (a.coChanges || 0)
    );
  }

  if (pairs.length === 0) {
    return {
      ok: false,
      message: pst.isGitRepo
        ? t("portrait.msg.couplingNone")
        : t("portrait.msg.couplingNoGit"),
      severity: "info",
      placed: 0,
    };
  }

  const fileById = new Map(pst.files.filter((f) => !f.isDirectory).map((f) => [f.id, f]));

  // v2.18 焦点 1-跳子图（B3）：与 dep v2.17 修正版同形态 —— 焦点文件 + 它的全部 1-跳邻居
  // 都并入画布（含邻居间横向边，避免「局部失真」），焦点节点 isFocus=true（FileRenderer
  // 已有品牌金 #EF9F27 外环 + 「焦点」药丸，直接复用）。子图判定用 allPairs 算 partner，
  // 不受 filter/window 影响（让用户能"在过滤视角下聚焦"）。
  let focusNodeId: string | null = null;
  if (focusFileId && fileById.has(focusFileId)) {
    focusNodeId = focusFileId;
    const partnerSet = new Set<string>([focusFileId]);
    for (const p of allPairs) {
      if (p.fileAId === focusFileId) partnerSet.add(p.fileBId);
      if (p.fileBId === focusFileId) partnerSet.add(p.fileAId);
    }
    pairs = pairs.filter(
      (p) => partnerSet.has(p.fileAId) && partnerSet.has(p.fileBId)
    );
  }

  // 上限 140 对：再多画布就成毛线团了，且后端已按风险降序排好，截断只丢弱信号
  const kept = pairs
    .filter((p) => fileById.has(p.fileAId) && fileById.has(p.fileBId))
    .slice(0, 140);

  if (kept.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.couplingStale"),
      severity: "info",
      placed: 0,
    };
  }

  // 节点侧统计：每个文件有几个耦合伙伴、其中几个是隐性的、最强耦合度多少
  interface NodeStat {
    partners: number;
    hiddenPartners: number;
    maxDegree: number;
    totalCoChanges: number;
  }
  const stats = new Map<string, NodeStat>();
  const bump = (id: string, p: (typeof kept)[number]) => {
    const s = stats.get(id) ?? {
      partners: 0,
      hiddenPartners: 0,
      maxDegree: 0,
      totalCoChanges: 0,
    };
    s.partners += 1;
    if (p.couplingKind === "hidden") s.hiddenPartners += 1;
    s.maxDegree = Math.max(s.maxDegree, p.degree);
    s.totalCoChanges += p.coChanges;
    stats.set(id, s);
  };
  for (const p of kept) {
    bump(p.fileAId, p);
    bump(p.fileBId, p);
  }

  clearCanvas();

  const insights = currentInsights();
  const NODE_W = 176;
  const NODE_H = 64;
  const nodeIds = Array.from(stats.keys());

  // v2.18 模块归属与配色（cluster 布局和模块簇染色都依赖）—— 复用 dep 画像的
  // topDirOf + MODULE_PALETTE 哈希取色方案，让「命运共同体的真实模块边界」视觉化。
  const moduleOf = new Map<string, string>();
  for (const id of nodeIds) {
    const f = fileById.get(id);
    if (f && !f.isDirectory) moduleOf.set(id, topDirOf(f.relPath));
  }
  const moduleColorOf = (id: string): string => {
    const m = moduleOf.get(id) ?? "";
    let h = 0;
    for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
    return MODULE_PALETTE[h % MODULE_PALETTE.length];
  };

  // ─── 布局算法（v2.18 双模式：force / cluster）───
  // force   ：力导向自然聚团（耦合伙伴数做 weight），与 v2.18 之前行为一致
  // cluster ：按 topDirOf 把节点分桶 → 各桶独立力导向 → 平移到 2D 网格子区；
  //           同时把 moduleColor 写到 config.accentColor 让 FileRenderer 染色，
  //           跨模块边按 cluster 模式视觉强化（strokeWidth/strokeOpacity 上调）
  let positions: Map<string, { x: number; y: number }>;
  if (layoutMode === "cluster") {
    // 桶：module 名 → 节点 id 列表
    const buckets = new Map<string, string[]>();
    for (const id of nodeIds) {
      const m = moduleOf.get(id) ?? "root";
      const arr = buckets.get(m) ?? [];
      arr.push(id);
      buckets.set(m, arr);
    }
    // 网格列数 = ceil(sqrt(M))：水平优先铺，桶多时仍可控
    const M = buckets.size;
    const COLS = Math.max(1, Math.ceil(Math.sqrt(M)));
    // 子区大小按最大桶动态算，保证最大桶内也能铺开
    const maxBucket = Math.max(...Array.from(buckets.values()).map((a) => a.length));
    const subW = Math.max(360, Math.round(Math.sqrt(maxBucket) * 220) + NODE_W + 80);
    const subH = Math.max(280, Math.round(Math.sqrt(maxBucket) * 110) + NODE_H + 60);
    positions = new Map();
    let bi = 0;
    for (const [, ids] of buckets) {
      const col = bi % COLS;
      const row = Math.floor(bi / COLS);
      const ox = 60 + col * subW;
      const oy = 60 + row * subH;
      // 桶内也用 force 让天然亲密关系（耦合对）优先聚拢
      const localForce = forceDirectedLayout(
        ids.map((id) => ({ id, weight: stats.get(id)?.partners ?? 1 })),
        kept
          .filter((p) => ids.includes(p.fileAId) && ids.includes(p.fileBId))
          .map((p) => ({ from: p.fileAId, to: p.fileBId })),
        {
          width: subW - 40,
          height: subH - 40,
          nodeWidth: NODE_W,
          nodeHeight: NODE_H,
          originX: ox,
          originY: oy,
        }
      );
      for (const [id, p] of localForce.positions) positions.set(id, p);
      bi += 1;
    }
  } else {
    const forceResult = forceDirectedLayout(
      // 权重用「耦合伙伴数」：耦合中心（改一处牵动一片的文件）被推到布局核心
      nodeIds.map((id) => ({ id, weight: stats.get(id)?.partners ?? 1 })),
      kept.map((p) => ({ from: p.fileAId, to: p.fileBId })),
      {
        width: Math.max(1200, Math.round(Math.sqrt(nodeIds.length) * 330)),
        height: Math.max(760, Math.round(Math.sqrt(nodeIds.length) * 220)),
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        originX: 60,
        originY: 60,
      }
    );
    positions = forceResult.positions;
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  // 按耦合伙伴数降序放置，保证画布上限触顶时留下的是耦合中心
  const ordered = nodeIds.sort(
    (a, b) => (stats.get(b)?.partners ?? 0) - (stats.get(a)?.partners ?? 0)
  );
  for (const id of ordered) {
    const f = fileById.get(id);
    const p = positions.get(id);
    if (!f || !p) continue;
    const ins = insights.get(id) ?? emptyFileInsight();
    const st = stats.get(id)!;
    // v2.18 模块簇配色 + 节点徽标：与 dep 画像共用同一套字段语义，
    // FileRenderer 已消费 accentColor（卡片底色/色条）+ metricBadge（指标药丸）+ metricTitle（hover）
    const mod = moduleOf.get(id) ?? "";
    const moduleColor = moduleColorOf(id);
    const metricBadge = `⇄${st.partners}` + (st.hiddenPartners > 0 ? ` · ⚠${st.hiddenPartners}` : "");
    const metricTitle = [
      t("portrait.metric.couplingNodeTitle", {
        module: mod || "—",
        partners: st.partners,
        hidden: st.hiddenPartners,
        total: st.totalCoChanges,
      }),
    ]
      .filter(Boolean)
      .join("\n");
    if (
      place("file", { x: p.x, y: p.y }, f.name, {
        ...fileConfig(f, ins, "changeCoupling"),
        couplingPartners: st.partners,
        hiddenPartners: st.hiddenPartners,
        maxCouplingDegree: Math.round(st.maxDegree * 100) / 100,
        coChangeTotal: st.totalCoChanges,
        // v2.18 模块簇视觉化（与 dep v2.17 共用 FileRenderer 通道）
        moduleName: mod,
        moduleColor,
        accentColor: moduleColor,
        metricBadge,
        metricTitle,
        // v2.18 焦点子图：FileRenderer 消费 isFocus 画品牌金外环 + 「焦点」药丸
        isFocus: id === focusNodeId,
      })
    ) {
      pos.set(id, { x: p.x, y: p.y, w: NODE_W, h: NODE_H });
    }
  }

  let edgeCount = 0;
  let hiddenCount = 0;
  let crossModuleHidden = 0;
  for (const p of kept) {
    const a = pos.get(p.fileAId);
    const b = pos.get(p.fileBId);
    if (!a || !b) continue;
    const hidden = p.couplingKind === "hidden";
    if (
      connect(
        a,
        b,
        `${fileById.get(p.fileAId)?.name} ⇄ ${fileById.get(p.fileBId)?.name}`,
        {
          couplingEdge: true,
          couplingKind: p.couplingKind,
          degree: p.degree,
          jaccard: p.jaccard,
          coChanges: p.coChanges,
          riskLevel: p.riskLevel,
          crossModule: p.crossModule,
          isStructural: p.isStructural,
          // v2.18 cluster 模式：跨模块边在 DependencyEdgeRenderer 里被进一步加粗加深
          // （让「绕过模块边界」的隐性耦合一眼可见），同模块边正常；force 模式不加粗
          clusterMode: layoutMode === "cluster",
          // 双向 id 供画布联动（选中文件 → 高亮其耦合伙伴）复用既有邻居机制
          fromFileId: p.fileAId,
          toFileId: p.fileBId,
        }
      )
    ) {
      edgeCount += 1;
      if (hidden) {
        hiddenCount += 1;
        if (p.crossModule) crossModuleHidden += 1;
      }
    }
  }

  await persist(analysisId, "changeCoupling");

  const worst = kept.find((p) => p.couplingKind === "hidden") ?? kept[0];
  const worstName = worst
    ? `${fileById.get(worst.fileAId)?.name} ⇄ ${fileById.get(worst.fileBId)?.name} ${t("portrait.msg.couplingWorstName", { n: worst.coChanges, pct: (worst.degree * 100).toFixed(0) })}`
    : "";

  // v2.18 工具栏反馈：filter / timeWindow 任一激活时，把"已过滤 N/M"打到 message 里
  // 让用户明确知道当前画布是子集而不是缺数据。
  const filterActive = filter !== "all";
  const windowActive = typeof windowDays === "number" && windowDays > 0;
  const filterNote = filterActive
    ? t("portrait.msg.couplingFilterApplied", {
        filter: t(`editor.couplingFilter${filter[0].toUpperCase()}${filter.slice(1)}`),
        kept: kept.length,
        total: pairs.length,
      })
    : "";
  const windowNote = windowActive
    ? t("portrait.msg.couplingWindowApplied", { days: windowDays ?? 0 })
    : "";
  const suffix = [filterNote, windowNote].filter(Boolean).join(" · ");
  // v2.18 焦点子图反馈（B3）：focusNodeId 非空时把「焦点+邻居数+边数」打到 message
  const focusNote = focusNodeId
    ? t("portrait.msg.couplingFocus", {
        name: fileById.get(focusNodeId)?.name ?? focusNodeId,
        neighbors: pos.size - 1,
        files: pos.size,
        edges: edgeCount,
      })
    : "";
  const baseMsg = t("portrait.msg.couplingDone", {
    n: pos.size,
    edges: edgeCount,
    hidden: hiddenCount > 0
      ? t("portrait.msg.couplingHidden", {
          n: hiddenCount,
          cross: crossModuleHidden > 0 ? t("portrait.msg.couplingCross", { n: crossModuleHidden }) : "",
        })
      : t("portrait.msg.couplingNormal"),
    worst: worstName ? t("portrait.msg.couplingWorst", { name: worstName }) : "",
  });
  const fullMsg = [baseMsg, suffix, focusNote].filter(Boolean).join(" · ");

  return {
    ok: true,
    message: fullMsg,
    severity: crossModuleHidden > 0 ? "warning" : "success",
    placed: pos.size,
  };
}

// ───────────────────────── 分层画像 ─────────────────────────

/**
 * 分层视图：文件按架构分层归位，并检出「分层违规」
 *
 * 约定 sortOrder 小 = 上层（表现层），大 = 下层（基础设施层）。
 * 正常依赖方向是自上而下（上层用下层）；一旦出现下层反过来依赖上层
 * （fromOrder > toOrder），就是架构腐化信号，连线标红并计入违规数。
 */
async function runLayeringPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const { layers, files, dependencies } = pst;
  if (layers.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.layerNoData"),
      severity: "info",
      placed: 0,
    };
  }

  const sorted = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
  const orderOf = new Map(sorted.map((l, i) => [l.id, i]));
  const realFiles = files.filter((f) => !f.isDirectory);
  const insights = currentInsights();

  clearCanvas();

  const LEFT = 40;
  const COL_W = 190;
  const ROW_H = 74;
  const PER_ROW = 8;
  const NODE_W = 170;
  const NODE_H = 62;
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = 80;
  let placedCount = 0;

  const groups: { layer: (typeof sorted)[number] | null; items: typeof realFiles }[] = sorted.map(
    (l) => ({ layer: l, items: realFiles.filter((f) => f.layerId === l.id) })
  );
  const orphan = realFiles.filter((f) => !f.layerId || !orderOf.has(f.layerId));
  if (orphan.length > 0) groups.push({ layer: null, items: orphan });

  for (const g of groups) {
    if (g.items.length === 0) continue;
    place(
      "layer-marker",
      { x: LEFT, y: y - 34 },
      g.layer ? g.layer.name : t("portrait.msg.unlayered"),
      {
        layerName: g.layer ? g.layer.name : t("portrait.msg.unlayered"),
        layerColor: g.layer ? g.layer.color : "#64748b",
        layerOrder: g.layer ? g.layer.sortOrder : 999,
        fileCount: g.items.length,
      }
    );
    g.items.forEach((f, i) => {
      const col = i % PER_ROW;
      const row = Math.floor(i / PER_ROW);
      const x = LEFT + col * COL_W;
      const fy = y + row * ROW_H;
      const ins = insights.get(f.id) ?? emptyFileInsight();
      if (
        place("file", { x, y: fy }, f.name, {
          ...fileConfig(f, ins, "layering"),
          layerName: g.layer?.name ?? t("portrait.msg.unlayered"),
          layerColor: g.layer?.color ?? "#64748b",
        })
      ) {
        pos.set(f.id, { x, y: fy, w: NODE_W, h: NODE_H });
        placedCount += 1;
      }
    });
    y += Math.ceil(g.items.length / PER_ROW) * ROW_H + 70;
  }

  // 只画跨层边，避免同层内部连线糊成一片
  let violations = 0;
  let crossEdges = 0;
  const drawn = new Set<string>();
  for (const d of dependencies) {
    const fromFile = realFiles.find((f) => f.id === d.fromId);
    const toFile = realFiles.find((f) => f.id === d.toId);
    if (!fromFile || !toFile) continue;
    const fo = fromFile.layerId ? orderOf.get(fromFile.layerId) : undefined;
    const to = toFile.layerId ? orderOf.get(toFile.layerId) : undefined;
    if (fo === undefined || to === undefined || fo === to) continue;
    const key = `${d.fromId}->${d.toId}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const a = pos.get(d.fromId);
    const b = pos.get(d.toId);
    if (!a || !b) continue;
    const isViolation = fo > to; // 下层反向依赖上层
    if (
      connect(a, b, `${fromFile.name} → ${toFile.name}`, {
        depType: d.kind || "import",
        isCircular: isViolation || !!d.isCircular,
        layerViolation: isViolation,
        symbolNames: [],
      })
    ) {
      crossEdges += 1;
      if (isViolation) violations += 1;
    }
  }

  await persist(analysisId, "layering");
  return {
    ok: true,
    message: t("portrait.msg.layerDone", {
      n: placedCount,
      layers: groups.length,
      edges: crossEdges,
      viol: violations > 0 ? t("portrait.msg.layerViol", { n: violations }) : t("portrait.msg.layerClean"),
    }),
    severity: violations > 0 ? "warning" : "success",
    placed: placedCount,
  };
}

// ───────────────────────── 耦合矩形树图（treemap）画像 ─────────────────────────

/**
 * 耦合矩形树图（squarified treemap）—— 用面积编码模块体量、颜色编码耦合健康度
 *
 * 替代原先的「主序散点图」：散点图需要用户脑补 X/Y 轴含义、模块一多就糊成一片，
 * 体验差。treemap 是更直观的呈现：
 * - 矩形面积 = 模块文件数（体量一目了然，谁是大头立刻可见）
 * - 矩形颜色 = 耦合 zone（painful 红 / useless 紫 / mainSequence 绿 / 其它灰蓝）
 * - 矩形内文字 = 模块名 + 文件数 + Ce/Ca 徽标
 *
 * 布局用 Bruls et al. 的 squarified 算法：每行/列尽量贴近正方形，长宽比接近 1，
 * 视觉最干净、不会拉出细长条。算法纯函数，输入带权重的模块列表，输出 {x,y,w,h}。
 */
interface TreemapInput {
  name: string;
  weight: number;
  /** 渲染用附带字段 */
  zone: string;
  zoneLabel: string;
  fileCount: number;
  ca: number;
  ce: number;
  instability: number;
  abstractness: number;
  inCycle: boolean;
  /** 面积占比（%），渲染器在单元格内显示 */
  sharePct: number;
}
interface TreemapBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** squarified treemap：把带权重的条目铺进 (x,y,w,h) 矩形区域，返回 name→box 映射 */
function squarify(
  items: TreemapInput[],
  x: number,
  y: number,
  w: number,
  h: number
): Map<string, TreemapBox> {
  const result = new Map<string, TreemapBox>();
  const total = items.reduce((s, it) => s + it.weight, 0);
  if (total <= 0 || items.length === 0) return result;

  // 归一化权重到面积
  const areas = items.map((it) => ({ ...it, area: (it.weight / total) * (w * h) }));
  // 按面积降序：大的先放，squarify 收敛更好
  areas.sort((a, b) => b.area - a.area);

  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;

  let row: typeof areas = [];
  let rowArea = 0;

  const worst = (r: typeof areas, side: number): number => {
    if (r.length === 0) return Infinity;
    const s = r.reduce((s, it) => s + it.area, 0);
    const max = Math.max(...r.map((it) => it.area));
    const min = Math.min(...r.map((it) => it.area));
    const s2 = s * s;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  const layoutRow = (r: typeof areas, horizontal: boolean) => {
    const s = r.reduce((acc, it) => acc + it.area, 0);
    if (horizontal) {
      // 横向铺：row 占满 rw 高度的一行，按面积分配宽度
      const rowH = s / rw;
      let cx = rx;
      for (const it of r) {
        const cw = it.area / rowH;
        result.set(it.name, { x: Math.round(cx), y: Math.round(ry), w: Math.round(cw), h: Math.round(rowH) });
        cx += cw;
      }
      ry += rowH;
      rh -= rowH;
    } else {
      // 纵向铺：row 占满 rh 宽度的一列，按面积分配高度
      const colW = s / rh;
      let cy = ry;
      for (const it of r) {
        const ch = it.area / colW;
        result.set(it.name, { x: Math.round(rx), y: Math.round(cy), w: Math.round(colW), h: Math.round(ch) });
        cy += ch;
      }
      rx += colW;
      rw -= colW;
    }
  };

  for (const it of areas) {
    const horizontal = rw >= rh; // 当前剩余区域更宽 → 横向铺一行
    const side = horizontal ? rw : rh;
    const newRow = [...row, it];
    if (row.length === 0 || worst(newRow, side) <= worst(row, side)) {
      row = newRow;
      rowArea += it.area;
    } else {
      layoutRow(row, horizontal);
      row = [it];
      rowArea = it.area;
    }
  }
  if (row.length > 0) {
    layoutRow(row, rw >= rh);
  }
  return result;
}

async function runCouplingPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const realFiles = pst.files.filter((f) => !f.isDirectory);
  const graph = buildModuleGraph(realFiles, pst.dependencies);

  if (graph.nodes.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.msNoModules"),
      severity: "info",
      placed: 0,
    };
  }
  if (graph.edges.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.msNoDeps"),
      severity: "info",
      placed: 0,
    };
  }

  const cycles = findCycles(
    graph.nodes.map((n) => n.name),
    graph.edges
  );
  const coupling = computeModuleCoupling(graph, pst.symbols, cycles);

  clearCanvas();

  // treemap 画布区域（留出顶部标题 + 底部图例的空间）
  const PAD = 40;
  const TITLE_H = 70;
  const PLOT_X = PAD;
  const PLOT_Y = PAD + TITLE_H;
  const PLOT_W = 1120;
  const PLOT_H = 640;

  // 顶部标题
  place("layer-marker", { x: PLOT_X, y: PAD - 10 }, t("portrait.msg.treemapTitle"), {
    layerName: t("portrait.msg.treemapTitle"),
    layerColor: "#0f172a",
    layerOrder: 5,
  }, { w: PLOT_W, h: 44 });

  // 图例（右下角，4 个 zone 色块）
  const legend: Array<[string, string]> = [
    [t("portrait.msg.zonePainful"), ZONE_COLOR.painful],
    [t("portrait.msg.zoneUseless"), ZONE_COLOR.useless],
    [t("health.zone.mainSequence"), ZONE_COLOR.mainSequence],
    [t("portrait.msg.zoneNormal"), "#64748b"],
  ];
  let lx = PLOT_X + PLOT_W - 720;
  const ly = PLOT_Y + PLOT_H + 24;
  for (const [label, color] of legend) {
    place("layer-marker", { x: lx, y: ly }, "", {
      layerName: "",
      layerColor: color,
      layerOrder: 4,
    }, { w: 18, h: 18 });
    place("layer-marker", { x: lx + 24, y: ly - 2 }, label, {
      layerName: label,
      layerColor: "#475569",
      layerOrder: 4,
    }, { w: 140, h: 22 });
    lx += 170;
  }

  // 面积权重：用文件数（体量最直观）；单文件模块保底权重避免 0 面积
  const totalFiles = coupling.reduce((s, c) => s + Math.max(c.fileCount, 1), 0);
  const inputs: TreemapInput[] = coupling.map((c) => ({
    name: c.name,
    weight: Math.max(c.fileCount, 1),
    zone: c.zone,
    zoneLabel: zoneLabelOf(c.zone),
    fileCount: c.fileCount,
    ca: c.ca,
    ce: c.ce,
    instability: c.instability,
    abstractness: c.abstractness,
    inCycle: c.inCycle,
    sharePct: totalFiles === 0 ? 0 : (Math.max(c.fileCount, 1) / totalFiles) * 100,
  }));

  const boxes = squarify(inputs, PLOT_X, PLOT_Y, PLOT_W, PLOT_H);
  const moduleByName = new Map(pst.modules.map((m) => [m.name, m]));
  const shareMap = new Map(inputs.map((it) => [it.name, it.sharePct]));
  let placed = 0;

  for (const c of coupling) {
    const box = boxes.get(c.name);
    if (!box) continue;
    const mod = moduleByName.get(c.name);
    place("treemap-cell", { x: box.x, y: box.y }, c.name, {
      name: c.name,
      moduleName: c.name,
      fileCount: c.fileCount,
      depCount: c.ce,
      beDepCount: c.ca,
      moduleId: mod?.id,
      projectLayerId: mod?.layerId,
      ca: c.ca,
      ce: c.ce,
      instability: c.instability,
      abstractness: c.abstractness,
      distance: c.distance,
      zone: c.zone,
      zoneLabel: zoneLabelOf(c.zone),
      symbolCount: c.symbolCount,
      abstractSymbolCount: c.abstractSymbolCount,
      inCycle: c.inCycle,
      // treemap 单元格占比（渲染器显示 N文件 (XX%)）
      sharePct: shareMap.get(c.name) ?? 0,
      // treemap 单元格宽度（渲染器据此决定字体大小 / 是否换行）
      cellW: box.w,
      cellH: box.h,
    }, { w: box.w, h: box.h });
    placed += 1;
  }

  await persist(analysisId, "coupling");

  const painful = coupling.filter((c) => c.zone === "painful");
  const useless = coupling.filter((c) => c.zone === "useless");
  const parts: string[] = [t("portrait.msg.msDone", { n: placed })];
  if (painful.length > 0) {
    parts.push(t("portrait.msg.msPainful", { n: painful.length, names: painful.slice(0, 3).map((c) => c.name).join("、") }));
  }
  if (useless.length > 0) parts.push(t("portrait.msg.msUseless", { n: useless.length }));
  if (cycles.length > 0) parts.push(t("portrait.msg.msCycles", { n: cycles.length, edges: 0 }));
  if (painful.length === 0 && useless.length === 0 && cycles.length === 0) {
    parts.push(t("portrait.msg.msHealthy"));
  }

  return {
    ok: true,
    message: parts.join("；"),
    severity: painful.length > 0 || cycles.length > 0 ? "warning" : "success",
    placed,
  };
}

// ───────────────────────── 重构四象限画像 ─────────────────────────

/**
 * 四象限画像：churn（变更频率）× complexity（圈复杂度）散点分区
 *
 * 这是 Michael Feathers / CodeScene 那套「重构优先级」判据的可视化。
 * 别的画像都是一维排序（谁最复杂、谁改得最多），一维的问题是**会骗人**：
 * 一个圈复杂度 80 但三年没人动的解析器，和一个复杂度 25 但每周改五次的
 * 订单服务，前者排在前面，可真正该先重构的是后者。
 *
 * 两个维度交叉之后，四个角落各有明确的行动建议：
 * - 右上（高复杂 × 高变更）→ **优先重构**，每次改都痛且还在一直改
 * - 左上（高复杂 × 低变更）→ 稳定遗留，别主动碰，但要补文档
 * - 右下（低复杂 × 高变更）→ 活跃开发区，正常状态
 * - 左下 → 健康
 *
 * X 轴 = churn 分值，Y 轴 = 圈复杂度（向上为高），坐标用分位数归一化，
 * 避免个别极端值把所有点压到角落里。
 */
// ───────────────────────── 目录结构画像 ─────────────────────────

/**
 * 目录结构画像：把项目的目录树画成缩进冰柱图（indented icicle）
 *
 * 回答的问题是「这个项目是怎么组织的、代码堆在哪几个目录里」——
 * 这是需求 §7.3「文件目录」维度唯一对应的画像，此前整个画像体系里没有。
 * 顺带激活 folder 实体：该类型注册过、渲染器也写了，但在此之前
 * 没有任何代码创建过 folder 实体，属于挂着不通电的一条链路。
 *
 * 布局取舍：
 * - x = 深度 × 缩进：一眼看出层级，比 treemap 的嵌套矩形更容易读出路径
 * - 宽度 ∝ 该目录代码行数占比：大目录一眼可见，小目录也不至于缩到看不见
 * - y = 先序行号：父目录紧跟其子树，与左侧文件树的阅读顺序一致
 * - 颜色 = 平均圈复杂度档位：结构图顺带回答「哪一块最难啃」
 *
 * 默认只展开 4 层、最多 160 个节点：再深的层级在画布上退化成一堆细条，
 * 而且画布是 DOM + CSS Transform，实体数量上去直接掉帧（需求 §9 要 60fps）。
 */
/** 在目录树里按路径定位节点（深度优先） */
function findNode(root: DirNode, dirPath: string): DirNode | null {
  if (root.path === dirPath) return root;
  for (const c of root.children) {
    const r = findNode(c, dirPath);
    if (r) return r;
  }
  return null;
}

/**
 * 目录树引导线：把缩进层级画成直角连线（父竖干 + 子横枝）。
 *
 * 产出**单个** dependency-edge 实体，config.segments 是相对包围盒左上角的
 * 扁平坐标数组 [x1,y1,x2,y2, …]。用扁平数组而不是对象数组：这份 config 要
 * 随场景一起序列化落库，760 个节点下对象数组的 JSON 体积是它的三倍多。
 */
function buildTreeGuide(
  rows: { x: number; y: number; w: number; h: number; parentPath: string | null; path: string }[],
  rowIndexByPath: Map<string, number>,
  indent: number
): BulkComponentInput | null {
  if (rows.length < 2) return null;

  // 按父节点归拢子节点，才能画出「一条竖干贯穿所有孩子」而不是每个孩子一条
  const childrenOf = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.parentPath === null) return;
    if (!rowIndexByPath.has(r.parentPath)) return; // 父节点被搜索/截断过滤掉了
    const arr = childrenOf.get(r.parentPath);
    if (arr) arr.push(i);
    else childrenOf.set(r.parentPath, [i]);
  });
  if (childrenOf.size === 0) return null;

  const abs: number[] = [];
  for (const [parentPath, kids] of childrenOf) {
    const p = rows[rowIndexByPath.get(parentPath)!];
    // 竖干贴在父节点左内侧、子节点缩进的一半处
    const trunkX = p.x + indent / 2;
    const trunkTop = p.y + p.h;
    let trunkBottom = trunkTop;
    for (const ci of kids) {
      const c = rows[ci];
      const cy = c.y + c.h / 2;
      if (cy > trunkBottom) trunkBottom = cy;
      // 横枝：竖干 → 子节点左边缘
      abs.push(trunkX, cy, c.x, cy);
    }
    // 竖干：父节点底 → 最后一个子节点中线
    if (trunkBottom > trunkTop) abs.push(trunkX, trunkTop, trunkX, trunkBottom);
  }
  if (abs.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < abs.length; i += 2) {
    const x = abs[i];
    const y = abs[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const segments = abs.map((v, i) => (i % 2 === 0 ? v - minX : v - minY));

  return {
    type: "dependency-edge",
    name: t("portrait.msg.treeGuide"),
    x: minX,
    y: minY,
    // +1 防零宽/零高包围盒（单列树时 maxX===minX）导致 SVG 不可见
    width: Math.max(1, maxX - minX) + 1,
    height: Math.max(1, maxY - minY) + 1,
    config: {
      depType: "tree-guide",
      segments,
      /** 引导线是装饰，不参与选中/影响链/统计 */
      decorative: true,
    },
  };
}

async function runDirectoryPortrait(
  analysisId: string,
  scopeDir?: string,
  opts?: { includeFiles?: boolean; search?: string; sort?: "size" | "name" | "path" }
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const root = buildDirectoryTree({
    files: pst.files,
    metrics: pst.metrics,
    techDebt: pst.techDebt,
    findings: pst.findings,
    clones: pst.clones,
  });

  if (!root) {
    return { ok: false, message: t("portrait.msg.dirNoScan"), severity: "info", placed: 0 };
  }

  const target = scopeDir ? findNode(root, scopeDir) : root;
  if (!target) {
    return { ok: false, message: t("portrait.msg.dirMissing", { dir: scopeDir ?? "" }), severity: "info", placed: 0 };
  }
  const baseDepth = scopeDir ? scopeDir.split("/").length : 0;

  // 文件叶子：双击下钻的子树视图始终显示（范围小、可用）；主目录树跟随 store.directoryShowFiles 开关
  const includeFiles =
    opts?.includeFiles ?? (scopeDir ? true : useEditorStore.getState().directoryShowFiles);

  // 目录画像文件叶也走统一 fileConfig 契约，保证画布渲染与属性面板共享同一份度量
  // （refCount / symbolCount / churn …）。否则画布显示 0 依赖 / 无复杂度，而面板按
  // fileId 从 store 算出真实依赖数，二者不一致（与 image/asset 类型 bug 同类根因：
  // 实体 config 没有单一事实源）。复杂度维度在目录树里不强调（保留 R38 语言色身份条），
  // 故在 extra 里置 0 避免低复杂度文件被刷成绿色热力底；其余度量照常带出。
  const insights = currentInsights();

  const q = opts?.search?.trim().toLowerCase() || "";
  const flat = flattenDirectoryTree(target, {
    maxDepth: 4,
    maxNodes: 160,
    minFiles: 1,
    search: q || undefined,
    sort: opts?.sort ?? "size",
  });
  const nodes = flat.nodes;
  // 搜索命中集合：渲染层高亮命中目录，其余命中路径上的祖先节点淡化
  const matched = new Set<string>();
  if (q) for (const n of nodes) if (n.path.toLowerCase().includes(q)) matched.add(n.path);
  if (nodes.length <= 1) {
    if (q) {
      return { ok: false, message: t("portrait.msg.dirNoMatch", { q: opts!.search ?? "" }), severity: "info", placed: 0 };
    }
    return {
      ok: false,
      message: scopeDir
        ? t("portrait.msg.dirLeaf", { dir: scopeDir })
        : t("portrait.msg.dirNoDepth"),
      severity: "info",
      placed: 0,
    };
  }

  clearCanvas();

  const LEFT = 60;
  const TOP = 60;
  const INDENT = 34;
  // 行高与节点高：目录行要塞下「名称 + 语言条 + 条目数 + 复杂度 + 徽标」两行信息，
  // 文件行要塞下 FileRenderer full 档三行（文件名 16.8 + 路径 13.35 + 徽标 13 +
  // padding 6 ≈ 49px）。2026-08-19 修裁切：FILE_H 曾 32px（单行时代的遗留），
  // full 档 49px / compact 档 36px 都放不下，路径行+徽标行被 overflow:hidden 吃掉，
  // 观感即「xml 等文件实体高度不够」。DIR_H 52→56 同理给目录行留出 AI 药丸换行余量。
  // 行距按内容需要给足，宁可多滚一屏。buildTreeGuide 完全基于 rows 几何，自动适配。
  const DIR_H = 56;
  const FILE_H = 52;
  // 图片叶子行：代码文件行只有 52px，缩略图挤不出来。给图片一档更方的尺寸，
  // 目录树画像里图片资源直接以图示人（口径与画布同步的 fileKind.IMAGE_NODE_* 同源）。
  const IMG_ROW_H = 112;
  const IMG_ROW_W = 168;
  const ROW_GAP = 8;
  const MIN_W = 190;
  const MAX_W = 470;
  // 文件叶子保护：主目录树开文件时全树文件数可能上千，必须封顶防止画布爆炸
  const MAX_FILE_LEAVES = 600;
  const MAX_FILES_PER_DIR = 20;

  const maxLines = Math.max(...nodes.map((n) => n.totalLines), 1);

  // 取某目录直属文件（与 directoryTree.dirOf 同源）
  const dirOf = (relPath: string) => {
    const i = relPath.lastIndexOf("/");
    return i < 0 ? "" : relPath.slice(0, i);
  };
  const filesByDir = new Map<string, typeof pst.files>();
  if (includeFiles) {
    for (const f of pst.files) {
      if (f.isDirectory) continue;
      const d = dirOf(f.relPath);
      const arr = filesByDir.get(d);
      if (arr) arr.push(f);
      else filesByDir.set(d, [f]);
    }
  }

  // ─── 第一趟：只算布局，不碰 store ───
  //
  // 原实现对每个节点调 place() → addComponent()，而 addComponent 每次都要
  // structuredClone 整个 components 数组做历史快照。目录树开文件时节点数可达
  // 760，累计克隆量 O(N²)（约 29 万个对象），主线程一冻就是十几秒 —— 这正是
  // 「点排序之后目录树再也画不出来」的真身：不是没渲染，是卡在克隆里回不来。
  // 现在改成先纯计算布局，再 addComponentsBulk 一次性入库、只记一条历史。
  interface LaidOutRow {
    x: number;
    y: number;
    w: number;
    h: number;
    /** 父目录路径，用于连线；根节点为 null */
    parentPath: string | null;
    /** 自身路径（目录行才有，文件行用所属目录路径 + 文件名保证唯一） */
    path: string;
  }
  const items: BulkComponentInput[] = [];
  const rows: LaidOutRow[] = [];
  /** path → 该行在 rows 中的下标（连线时按父路径回查几何） */
  const rowIndexByPath = new Map<string, number>();

  let fileLeaves = 0;
  let hiddenFilesTotal = 0;
  let cursorY = TOP;

  // 父目录路径：nodes 是先序遍历结果，靠 path 前缀即可定位父节点
  const parentPathOf = (p: string): string | null => {
    if (!p) return null;
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  };

  for (const n of nodes) {
    const effDepth = Math.max(0, n.depth - baseDepth);
    const x = LEFT + effDepth * INDENT;
    const y = cursorY;
    cursorY += DIR_H + ROW_GAP;
    // 宽度按行数占比开方压缩：线性映射会让 src/ 独占全宽、其余全部贴下限
    const ratio = Math.sqrt(n.totalLines / maxLines);
    const w = Math.round(MIN_W + (MAX_W - MIN_W) * ratio);

    rowIndexByPath.set(n.path, rows.length);
    rows.push({
      x,
      y,
      w,
      h: DIR_H,
      parentPath: n === target ? null : parentPathOf(n.path),
      path: n.path,
    });
    items.push({
      type: "folder",
      name: n.name,
      x,
      y,
      width: w,
      height: DIR_H,
      locked: true,
      config: {
        name: n.name,
        dirPath: n.path,
        depth: n.depth,
        // childCount 沿用旧字段名（FolderRenderer 既有契约）：直属条目数
        childCount: n.directFiles + n.childDirCount,
        directFiles: n.directFiles,
        childDirCount: n.childDirCount,
        fileCount: n.fileCount,
        totalLines: n.totalLines,
        avgComplexity: n.avgComplexity,
        maxComplexity: n.maxComplexity,
        complexityLevel: n.complexityLevel,
        techDebtCount: n.techDebtCount,
        findingCount: n.findingCount,
        cloneCount: n.cloneCount,
        dominantLanguage: n.dominantLanguage,
        languageShare: n.languages.slice(0, 4),
        portraitMode: "directory" as PortraitMode,
        searchMatched: q ? matched.has(n.path) : undefined,
      },
    });

    // 文件叶子：紧贴各自目录下方、缩进再深一级；带全树/每目录上限保护
    if (includeFiles && fileLeaves < MAX_FILE_LEAVES) {
      const dirFiles = filesByDir.get(n.path);
      if (dirFiles && dirFiles.length > 0) {
        let list = dirFiles.slice(0, MAX_FILES_PER_DIR);
        // 搜索模式：文件叶子按文件名过滤，与目录搜索口径一致
        if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
        const more = dirFiles.length - list.length;
        hiddenFilesTotal += more;
        for (const f of list) {
          if (fileLeaves >= MAX_FILE_LEAVES) break;
          // 图片资源另走 image 实体：52px 的代码文件行放不下缩略图，给它 IMG_ROW_H 一档，
          // 目录树画像里 icon/png/svg 才是「看得见的图」而不是又一行文字。
          const entityType = entityTypeForFile(f);
          const isImg = entityType === "image";
          const rowH = isImg ? IMG_ROW_H : FILE_H;
          const rowW = Math.max(160, w - INDENT);
          const fx = LEFT + (effDepth + 1) * INDENT;
          const fy = cursorY;
          cursorY += rowH + ROW_GAP;
          fileLeaves += 1;
          rows.push({
            x: fx,
            y: fy,
            w: rowW,
            h: rowH,
            parentPath: n.path,
            path: `${n.path}\u0000${f.relPath}`,
          });
          const ins = insights.get(f.id) ?? emptyFileInsight();
          items.push({
            type: entityType,
            name: f.name,
            x: fx,
            y: fy,
            width: isImg ? Math.min(rowW, IMG_ROW_W) : rowW,
            height: rowH,
            locked: true,
            config: fileConfig(f, ins, "directory", {
              fromDirectory: true,
              // 目录树是结构视图：保留 R38 语言色身份条，不把低复杂度文件刷成绿色热力底
              complexity: 0,
              complexityLevel: "low",
              complexityEngine: undefined,
              lineCount: f.lineCount ?? 0,
            } as Record<string, unknown>),
          });
        }
      }
    }
  }

  // ─── 树形连线：把「缩进」升级成看得见的父子归属 ───
  //
  // 只用缩进表达层级，列一多就得靠数像素猜谁是谁的孩子。这里补上文件浏览器
  // 式的直角引导线：父节点下方一条竖干，每个子节点一条横枝。
  // 全部段落塞进 **一个** 实体（一张 SVG），而不是每条线一个实体 ——
  // 后者会让实体数翻倍，把刚省下来的性能又还回去。
  const guide = buildTreeGuide(rows, rowIndexByPath, INDENT);
  if (guide) {
    guide.locked = true; // 引导线是背景装饰，禁用拖动
    items.unshift(guide); // 放最前 = DOM 最先渲染 = 压在实体底下
  }

  const ids = useEditorStore.getState().addComponentsBulk(items);
  const placed = ids.length;

  await persist(analysisId, "directory");

  const deepest = nodes.reduce((a, b) => (b.depth > a.depth ? b : a), nodes[0]);
  const hottest = [...nodes]
    .filter((n) => n.depth > 0)
    .sort((a, b) => b.avgComplexity - a.avgComplexity)[0];

  const scopeFileCount = scopeDir ? target.fileCount : root.fileCount;
  const scopeLines = scopeDir ? target.totalLines : root.totalLines;
  const scopeNote = scopeDir ? t("portrait.msg.dirScope", { dir: scopeDir }) : "";
  const sortLabel = { size: t("portrait.msg.sortSize"), name: t("portrait.msg.sortName"), path: t("portrait.msg.sortPath") }[opts?.sort ?? "size"];
  const searchNote = q ? t("portrait.msg.dirSearch", { q: opts!.search ?? "" }) : "";
  const sortNote = t("portrait.msg.sortNote", { s: sortLabel });
  const fileNote = includeFiles
    ? t("portrait.msg.dirFileLeaves", { n: fileLeaves, hidden: hiddenFilesTotal > 0 ? t("portrait.msg.dirHidden", { n: hiddenFilesTotal }) : "" })
    : "";
  const truncNote = flat.truncated ? t("portrait.msg.dirTrunc", { a: flat.shownDirs, b: flat.totalDirs }) : "";
  return {
    ok: true,
    message:
      t("portrait.msg.dirDone", { n: nodes.length, search: searchNote, sort: sortNote, files: fileNote, scope: scopeNote, fc: scopeFileCount, lines: scopeLines.toLocaleString() }) +
      truncNote +
      t("portrait.msg.dirDeep", { depth: deepest.depth }) +
      (hottest && hottest.avgComplexity > 0 ? t("portrait.msg.dirHottest", { path: hottest.path, avg: hottest.avgComplexity }) : "") +
      (flat.truncated ? t("portrait.msg.dirDrill") : "") +
      "）",
    severity: "success",
    placed,
  };
}

/**
 * 目录树下钻：双击画布上的目录实体 → 在【旁边新开一个独立可关视图】渲染该目录的子树。
 * 复用 handlePortrait 同款的「addView + 渲染 + 失败自动清理空标签」逻辑，
 * 与 §「每个画像独立视图」体验一致。目录树（id=default）永远保留，不受影响。
 */
export async function openDirectorySubtree(dirPath: string, analysisId: string): Promise<PortraitOutcome> {
  const editor = useEditorStore.getState();
  editor.beginBatch();
  _pending = [];
  try {
    const baseName = dirPath === "" ? t("portrait.msg.rootDir") : dirPath.split("/").pop() || dirPath;
    const taken = new Set(editor.views.map((v) => v.name));
    let name = t("portrait.msg.dirView", { name: baseName });
    for (let i = 2; taken.has(name); i++) name = t("portrait.msg.dirViewN", { name: baseName, n: i });
    const newViewId = editor.addView(name);
    const outcome = await runDirectoryPortrait(analysisId, dirPath || undefined, {
      includeFiles: true,
      // 下钻子树继承当前排序维度，与主目录树保持一致（不再永远按 size 排）
      sort: useEditorStore.getState().directorySort,
    });
    if (!outcome.ok) {
      const st = useEditorStore.getState();
      if (st.views.length > 1) st.removeView(newViewId);
    }
    return outcome;
  } finally {
    editor.endBatch();
  }
}

/**
 * 重新渲染目录树视图：应用 store.directoryShowFiles 当前开关值。
 * 供画布工具栏「显示文件」开关调用 —— 切换后即时重画当前目录树（主目录树）。
 */
export async function rerenderDirectoryTree(analysisId: string): Promise<PortraitOutcome> {
  const st = useEditorStore.getState();
  st.beginBatch();
  _pending = [];
  try {
    return runDirectoryPortrait(analysisId, undefined, {
      includeFiles: st.directoryShowFiles,
      search: st.directorySearch || undefined,
      sort: st.directorySort,
    });
  } finally {
    st.endBatch();
  }
}

/**
 * 重构四象限画像：churn（变更频率）× complexity（圈复杂度）散点分区。
 *
 * v2.28 自愈（根治「不能用」）：象限依赖两个维度——complexity 来自 store.metrics、
 * churn 来自 store.gitChurn。两者都是扫描阶段产物，若内存 store 未填充（扫描漏跑
 * metrics/git 阶段、或本会话首次打开画像前未载入），所有文件 churnScore 与 complexity
 * 全是 0 → 被下方 filter 全滤掉 → 永远 quadNoData，且此前无自愈、无强制刷新入口，
 * 与 dataFlow/callGraph 早期「体感不能用」完全同因。现在：store 空或 force 时先
 * loadMetrics/loadGitChurn 从库补回；仍空则 analyzeMetrics/analyzeGitHistory 重算
 * （projectRoot 由 runPortrait 透传；非 git 仓库 analyzeGitHistory 直接返回空数组并把
 * isGitRepo 置 false，象限仍可凭 complexity 维出图，仅缺变更轴）。
 */
async function runQuadrantPortrait(
  analysisId: string,
  projectRoot?: string | null,
  force?: boolean,
  nameFilter?: string
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  // v2.31 加固：菜单路径在某些分支下可能未把 projectRoot 透传到画像（历史上曾导致横轴
  // 塌陷成竖线）。活跃场景（AnalysisDSL）必然携带 projectRoot，这里做兜底派生，
  // 保证 churn 自愈（analyzeGitHistory）在 git 仓库下一定能被触发，杜绝「竖线」退化。
  const sceneRoot = useSceneStore.getState().getActiveScene()?.projectRoot;
  const effectiveRoot =
    projectRoot && projectRoot.trim()
      ? projectRoot.trim()
      : sceneRoot && sceneRoot.trim()
        ? sceneRoot.trim()
        : undefined;

  const needMetrics = force || pst.metrics.length === 0;
  const needChurn = force || pst.gitChurn.length === 0;

  if (needMetrics) {
    // 先尝试从库补回（扫描已跑过时零成本）；没有再重算
    if (!force) await pst.loadMetrics(analysisId);
    if (useProjectStore.getState().metrics.length === 0) {
      await pst.analyzeMetrics(analysisId);
    }
  }
  if (needChurn) {
    if (!force) await pst.loadGitChurn(analysisId);
    if (useProjectStore.getState().gitChurn.length === 0 && effectiveRoot) {
      await pst.analyzeGitHistory(analysisId, effectiveRoot);
    }
  }

  // 自愈后重取 store 快照，判定两轴可用性与真实数据存在性
  const afterPst = useProjectStore.getState();

  // v2.32 横轴数据源自适应（根治「非 git 仓库 → 竖线塌缩」这一最典型的「不能用」观感）：
  // - 有 git 变更热度 → 横轴=变更频率（教科书 churn×complexity 四象限）
  // - 无 git 变更但有审查发现 → 横轴回退为「审查风险分」(error×5+warning×2+info)
  // - 以上皆无 → 回退到「代码重复率」（扫描必然落库，仍保持二维意义）
  // - 连重复率都为 0 → 回退到「文件规模（行数）」，scan 永远落库，保证横轴至少有 spread
  // v2.38：把最终 xAxis 的判定推迟到 rows（已带 churnScore/riskScore/duplicationRatio）构建后，
  // 用「真实信号是否存在」而非「数组非空」判定，杜绝「数组有元素但分值全 0 → 竖线」的塌缩。
  // 至此四个候选维度任一有信号画像即为二维散点，size 维度兜底下横轴永不塌缩成竖线。
  let xAxis: "churn" | "risk" | "duplication" | "size" = "size";

  // v2.32 真实信号过滤：emptyFileInsight 默认 complexity=1，若沿用旧 `complexity>0`
  // 会把「未扫描/无度量」项目里每个文件都算进来 → 渲染出一坨堆在左上的假点
  // （renderable but useless）。改为只保留「真有信息量」的文件：圈复杂度>1（真实度量）
  // 或 有变更热度 或 有审查风险分 或 有代码重复。无信号文件直接剔除，避免假点阵误导。
  const insights = currentInsights();
  // v2.35 鲁棒兜底：真实圈复杂度来自 metrics 阶段，若该阶段未产出（扫描漏跑 /
  // 大仓 analyzeMetrics 静默失败 / 用户在扫描完成前就点开画像），所有文件
  // complexity 退化成 1 → 旧 filter `complexity>1` 把全仓文件滤光 → quadNoData
  // 渲染空白，用户体感即「不能用」。这里派生代理复杂度（符号数 + 行数，二者
  // 都是扫描必然落库的数据），让真实代码文件永远拿到 >1 的可区分分值，
  // 画像始终能回答「先重构谁」；只有 0 文件（真无数据）才诚实 quadNoData。
  const effComplexityOf = (f: ProjectFile, ins: FileInsight): number =>
    ins.complexity > 1
      ? ins.complexity
      : Math.max(1, Math.round((ins.symbolCount || 0) / 3 + (f.lineCount || 0) / 25));
  const nf = nameFilter && nameFilter.trim() ? nameFilter.trim().toLowerCase() : "";
  const rows = afterPst.files
    .filter((f) => !f.isDirectory)
    .map((f) => ({ file: f, ins: insights.get(f.id) ?? emptyFileInsight() }))
    .map((r) => ({ ...r, effCc: effComplexityOf(r.file, r.ins) }))
    .filter(
      (r) =>
        (r.effCc > 1 || r.ins.churnScore > 0 || r.ins.riskScore > 0 || r.ins.duplicationRatio > 0) &&
        (!nf || r.file.name.toLowerCase().includes(nf))
    );

  // v2.38 横轴最终判定（基于真实信号，优先级 churn>risk>dup>size）：
  // 只要 rows 里任一文件在对应维度有正值，就铺开该横轴；否则顺延到下一个候选。
  // size（文件行数）几乎恒有正值，故 rows 非空时横轴恒为二维，根治「竖线=不能用」。
  if (rows.some((r) => r.ins.churnScore > 0)) xAxis = "churn";
  else if (rows.some((r) => r.ins.riskScore > 0)) xAxis = "risk";
  else if (rows.some((r) => r.ins.duplicationRatio > 0)) xAxis = "duplication";
  else xAxis = "size";

  if (rows.length === 0) {
    // v2.37 可行动兜底：此前无数据/无匹配时返回 ok:false → handlePortrait 静默移除空白视图，
    // 用户看到「点了没反应、什么都没出现」= 体感「不能用」。改为在视图内渲染引导卡
    // （视图保留、可见、可解释），明确告知「为何无图 / 该做什么」，把沉默失效变成可行动指引。
    const emptyMsg = nf
      ? t("portrait.msg.quadNoMatch", { q: nameFilter!.trim() })
      : t("portrait.msg.quadNoData");
    clearCanvas();
    place(
      "layer-marker",
      { x: 380, y: 360 },
      emptyMsg,
      { layerName: emptyMsg, layerColor: "#EF9F27", layerOrder: 0 }
    );
    if (!nf) {
      const hint = t("portrait.msg.quadNoDataHint");
      place(
        "layer-marker",
        { x: 300, y: 398 },
        hint,
        { layerName: hint, layerColor: "#94a3b8", layerOrder: 0 }
      );
    }
    await persist(analysisId, "quadrant");
    return { ok: true, message: emptyMsg, severity: "info", placed: 0 };
  }

  clearCanvas();

  // v2.34 紧凑可定位节点：把 180×60 大卡换成 118×44 紧凑芯片，配合「按节点尺寸分桶」的
  // 网格避让，让散点真正互不重叠（此前 453 张 180×60 大卡挤成一团色块，是「图是乱的 /
  // 不能用」根源）。节点越小，fit 全览退化成色块后的可读性反而越高，放大后 compact 档仍是可读卡。
  const LEFT = 70;
  const TOP = 64;
  const W = 780; // 散点区宽度（右侧留作「优先重构」排行栏）
  const H = 720;
  const NODE_W = 118;
  const NODE_H = 44;

  // v2.30 避免超大仓库（>~65k 文件）时 Math.max(...spread) 触发 RangeError: Maximum call stack。
  // 改用 reduce 扫描求极值，零栈深开销。
  const xValOf = (r: { file: ProjectFile; ins: FileInsight }): number =>
    xAxis === "churn"
      ? r.ins.churnScore
      : xAxis === "risk"
        ? r.ins.riskScore
        : xAxis === "duplication"
          ? Math.round((r.ins.duplicationRatio ?? 0) * 100)
          : xAxis === "size"
            ? (r.file.lineCount || 0)
            : 0;
  const maxX = rows.reduce((m, r) => Math.max(m, xValOf(r)), 1);

  // v2.39 可读性根治：真实仓库 churn/复杂度呈长尾分布（少数文件极高、多数极低），
  // 旧 sqrt 归一化把绝大多数文件压在左下角，四象限严重失衡、可读性崩坏 = 用户体感「图看不出名堂 / 不能用」。
  // 改用「秩百分位」铺开：每文件按横轴/纵轴真实值从高到低排名，名次均匀映射 0~1，
  // 四象限恒为均衡分位（各约 1/4），既保留「高复杂×高变更=右上优先重构」语义，又让每个文件都可见、可定位。
  const sortedByX = [...rows].sort((a, b) => xValOf(b) - xValOf(a));
  const rankXOf = new Map<string, number>();
  // 名次 i=0 为最高值 → 映射 1（右侧/上方）；i 越大值越低 → 映射 0，保证「高变更在右、高复杂在上」
  sortedByX.forEach((r, i) => rankXOf.set(r.file.id, rows.length > 1 ? 1 - i / (rows.length - 1) : 0.5));
  const sortedByCc = [...rows].sort((a, b) => b.effCc - a.effCc);
  const rankYOf = new Map<string, number>();
  sortedByCc.forEach((r, i) => rankYOf.set(r.file.id, rows.length > 1 ? 1 - i / (rows.length - 1) : 0.5));
  const nxOf = (r: { file: ProjectFile }): number => rankXOf.get(r.file.id) ?? 0.5;
  const nyOf = (r: { file: ProjectFile }): number => rankYOf.get(r.file.id) ?? 0.5;

  // v2.41 坐标轴 + 刻度数值 + 公式：把「象限」做成真正的坐标系，而非只有四块色区。
  // 刻度按「节点中心映射」定位（与散点落点、象限分界线严格对齐），数值取 0/25/50/75/100
  // 百分位对应的真实度量值（横轴=当前 xAxis 维度，纵轴=圈复杂度）—— 刻度即真实数据，
  // 不是抽象名次；十字轴落在象限中线上，既对齐分区边界、又压在对应文件列上。
  const axisXFrac = (p: number): number => (p * (W - NODE_W) + NODE_W / 2) / W;
  const axisYFrac = (p: number): number => ((1 - p) * (H - NODE_H) + NODE_H / 2) / H;
  const fmtX = (v: number): string => (xAxis === "duplication" ? `${Math.round(v)}%` : `${Math.round(v)}`);
  const pcts = [0, 0.25, 0.5, 0.75, 1];
  const nRows = rows.length;
  const xTicks = pcts.map((p) => {
    const idx = Math.min(nRows - 1, Math.max(0, Math.round(p * (nRows - 1))));
    return { frac: axisXFrac(p), label: fmtX(xValOf(sortedByX[idx])) };
  });
  const yTicks = pcts.map((p) => {
    const idx = Math.min(nRows - 1, Math.max(0, Math.round(p * (nRows - 1))));
    return { frac: axisYFrac(p), label: `${Math.round(sortedByCc[idx].effCc)}` };
  });
  const axisXTitle =
    xAxis === "churn"
      ? t("portrait.msg.quadAxisXChurn")
      : xAxis === "risk"
        ? t("portrait.msg.quadAxisXRisk")
        : xAxis === "duplication"
          ? t("portrait.msg.quadAxisXDup")
          : t("portrait.msg.quadAxisXSize");
  const axisYTitle = t("portrait.msg.quadAxisY");
  const axisFormula = t("portrait.msg.quadAxisFormula");
  const axisHint = t("portrait.msg.quadAxisHint");

  // v2.33 可读性收敛：大仓下文件节点可达数百（如本项目 445+），全量绘制会让散点
  // 在画布上严重重叠成一团不可读的色块，用户体感即「图是乱的 / 不能用」。
  // 按「重构优先级」取 Top-N 绘制 —— 复合分 = 复杂度 ×(1 + 横轴值/最大值)，
  // 自然把「高复杂×高变更」的优先重构文件排在最前；其余低复杂度/低变更文件
  // 本就不是「先重构谁」的关注对象，省略绘制并在底部说明已省略数量。
  // 散点区 780×720 配 130×52 避让单元约 78 格，70 ≤ 78 保证 Top-N 无需螺旋即可各自占位。
  const PLOT_CAP = 70;
  const rankScore = (r: { file: ProjectFile; ins: FileInsight; effCc: number }): number =>
    r.effCc * (1 + xValOf(r) / (maxX || 1));
  const ranked = [...rows].sort((a, b) => rankScore(b) - rankScore(a));
  // v2.37：带文件名筛选时不再截断（匹配集通常很小），确保「用户要找的文件」一定出现，
  // 不被 Top-70 优先级门槛挡掉；无筛选才保留 Top-70 紧凑布局。
  const truncated = !nf && ranked.length > PLOT_CAP;
  const plotted = nf ? ranked : truncated ? ranked.slice(0, PLOT_CAP) : ranked;

  // v2.32 标题/图例区：两轴含义与当前横轴数据源的说明，现由 quadrant-axis 渲染器
  // 统一承载（轴名 + 秩百分位公式 + 右上=优先重构 行动指引），单一可信源、零冗余。
  // 此处不再重复放置底部长公式 layer-marker（避免与坐标轴渲染器重复、造成「公式不完整」观感）。

  // v2.33 截断提示：大仓省略了低优先级文件时，在底部明确告知「只画了 Top-N，
  // 共 N 个文件参与评估」，避免用户误以为画像漏了数据。
  if (truncated) {
    place(
      "layer-marker",
      { x: LEFT + W / 2 - 250, y: TOP + H + 44 },
      t("portrait.msg.quadTopN", { shown: PLOT_CAP, total: rows.length }),
      {
        layerName: t("portrait.msg.quadTopN", { shown: PLOT_CAP, total: rows.length }),
        layerColor: "#a855f7",
        layerOrder: 0,
      }
    );
    // v2.39 大仓定位可达性：散点仅画 Top-N，其余文件被截断，用户常找不到自己关心的文件
    // = 体感「图里没有我要的 / 不能用」。补一行提示：顶部搜索框按文件名筛选可绕过截断、任意文件必现。
    place(
      "layer-marker",
      { x: LEFT + W / 2 - 250, y: TOP + H + 74 },
      t("portrait.msg.quadSearchHint"),
      {
        layerName: t("portrait.msg.quadSearchHint"),
        layerColor: "#64748b",
        layerOrder: 0,
      }
    );
  }

  // v2.29 象限背景区：在散点图底层铺四块半透明色区，让「高复杂×高变更」等四象限
  // 一眼可辨（散点图若无分区边界，用户无法判断「右上角=优先重构」），回答「先重构谁」。
  // 背景区不可点击（pointer-events:none，命中测试让给上方 file 节点），仅作视觉分区。
  const ZONE_BG: { key: RiskQuadrant; rx: number; ry: number }[] = [
    { key: "legacyStable", rx: LEFT, ry: TOP }, // 左上：高复杂×低变更
    { key: "refactorFirst", rx: LEFT + W / 2, ry: TOP }, // 右上：高复杂×高变更
    { key: "healthy", rx: LEFT, ry: TOP + H / 2 }, // 左下：低复杂×低变更
    { key: "activeSimple", rx: LEFT + W / 2, ry: TOP + H / 2 }, // 右下：低复杂×高变更
  ];
  for (const z of ZONE_BG) {
    const meta = QUADRANT_META[z.key];
    // v2.47 给背景组件一个有意义的名称（解析后的 i18n 文案），避免实体列表/选中信息里
    // 显示原始 key `entityProj.quadrantZoneBg.name`（此前 name 传空 → 回退到注册类型原始 key）。
    place("quadrant-zone-bg", { x: z.rx, y: z.ry }, t("entityProj.quadrantZoneBg.name"), {
      zoneColor: meta.color,
      zoneKey: z.key,
      w: W / 2,
      h: H / 2,
    }, { w: W / 2, h: H / 2 });
  }

  // 四象限背景标记（layer-marker 复用为区域标签）
  const zones: { key: RiskQuadrant; x: number; y: number }[] = [
    { key: "legacyStable", x: LEFT, y: TOP - 34 },
    { key: "refactorFirst", x: LEFT + W / 2, y: TOP - 34 },
    { key: "healthy", x: LEFT, y: TOP + H / 2 - 34 },
    { key: "activeSimple", x: LEFT + W / 2, y: TOP + H / 2 - 34 },
  ];
  for (const z of zones) {
    const meta = QUADRANT_META[z.key];
    // v2.32 横轴数据源自适应：非 git 仓库（横轴=审查风险分）时，区域标签的行动建议
    // 同步从「变更」口径切到「风险」口径，避免标签写「高变更」而真实横轴是风险分。
    // v2.38 横轴数据源自适应：重复率/规模回退时，区域标签行动建议同步切到对应口径，
    // 避免标签写「高变更」而真实横轴是重复率/规模（renderable but misleading）。
    const hintKey =
      xAxis === "risk"
        ? QUADRANT_HINT_RISK[z.key]
        : xAxis === "duplication"
          ? QUADRANT_HINT_DUP[z.key]
          : xAxis === "size"
            ? QUADRANT_HINT_SIZE[z.key]
            : QUADRANT_HINT[z.key];
    place("layer-marker", { x: z.x, y: z.y }, resolveFragments(meta.label), {
      layerName: `${resolveFragments(meta.label)}（${resolveFragments(hintKey)}）`,
      layerColor: meta.color,
      layerOrder: 0,
      // v2.28 象限聚焦：区域标签携带 quadrantZone，单击即可高亮该象限全部文件、淡化其余
      // （SceneEditor onClick 捕获 layer-marker + quadrantZone → setQuadrantFocusZone）。
      quadrantZone: z.key,
    });
  }

  // v2.40 重叠根治：改为「网格分桶 + 唯一格占用」（见下），单元尺寸严格 ≥ 节点尺寸。
  const occupiedCell = new Set<number>();
  const counts: Record<RiskQuadrant, number> = {
    refactorFirst: 0,
    legacyStable: 0,
    activeSimple: 0,
    healthy: 0,
  };

  // v2.40 重叠根治：旧网格避让用 Math.round(x/CELL_W) 的「点式」单元键，但节点宽 118 ≈
  // 单元宽 130，相邻单元两节点水平仍重叠 50+px —— 即用户直观看到的「实体重叠」。
  // 改为「网格分桶 + 唯一格占用」：把散点区切成 COLS×ROWS 个严格 ≥ 节点尺寸的格，
  // 每个节点按归一化坐标定位到最近空闲格（螺旋搜索最近空格），每格只放一个节点。
  // 单元尺寸 ≥ 节点尺寸 + 间距，故任意两节点零重叠；网格有界，不会溢出画布。
  // 节点象限归属仍按数据归一化坐标 nx/ny 判定（与背景区对齐），与落格位置解耦，
  // 既保证「右上方=优先重构」语义，又彻底消除视觉重叠。
  const GAP_X = 10;
  const GAP_Y = 8;
  const CELL_W = NODE_W + GAP_X; // 128
  const CELL_H = NODE_H + GAP_Y; // 52
  const COLS = Math.max(1, Math.floor(W / CELL_W)); // ≈ 6
  const ROWS = Math.max(1, Math.floor(H / CELL_H)); // ≈ 13 → 78 格 ≥ PLOT_CAP(70)
  // v2.47 象限带约束（根治「位置≠象限」可视化错位）：散点按秩百分位定位后在网格内螺旋找
  // 最近空格，但旧逻辑不限制象限带 —— 理想格被占时螺旋可能把节点推到中线另一侧，
  // 导致「红卡（refactorFirst）却落在左半区」的视觉矛盾，用户读图困惑（renderable but misleading）。
  // 改为优先把螺旋搜索约束在节点「真实象限带」内（不越中线），保证视觉位置恒等于逻辑象限；
  // 仅在极端偏斜（某象限节点数超过带内容量）时回退全局搜索保零重叠（牺牲极少数位置精度）。
  const halfC = Math.floor(COLS / 2);
  const halfR = Math.floor(ROWS / 2);
  const quadBandOf = (zone: RiskQuadrant): { cMin: number; cMax: number; rMin: number; rMax: number } => {
    const right = zone === "refactorFirst" || zone === "activeSimple";
    const bottom = zone === "activeSimple" || zone === "healthy";
    return {
      cMin: right ? halfC : 0,
      cMax: right ? COLS - 1 : halfC - 1,
      rMin: bottom ? halfR : 0,
      rMax: bottom ? ROWS - 1 : halfR - 1,
    };
  };
  const spiralFreeCell = (
    c0: number,
    r0: number,
    cMin: number,
    cMax: number,
    rMin: number,
    rMax: number
  ): number => {
    c0 = Math.min(cMax, Math.max(cMin, c0));
    r0 = Math.min(rMax, Math.max(rMin, r0));
    const maxR = Math.max(cMax - cMin, rMax - rMin) + 2;
    for (let radius = 0; radius <= maxR; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // 仅环
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < cMin || c > cMax || r < rMin || r > rMax) continue;
          const idx = r * COLS + c;
          if (!occupiedCell.has(idx)) {
            occupiedCell.add(idx);
            return idx;
          }
        }
      }
    }
    return -1;
  };
  const fitCell = (
    c0: number,
    r0: number,
    band: { cMin: number; cMax: number; rMin: number; rMax: number }
  ): number => {
    const inBand = spiralFreeCell(c0, r0, band.cMin, band.cMax, band.rMin, band.rMax);
    if (inBand >= 0) return inBand;
    // 兜底全局（极端偏斜时牺牲位置精度保零重叠，避免跨象限误标）
    return spiralFreeCell(c0, r0, 0, COLS - 1, 0, ROWS - 1);
  };

  let placedCount = 0;
  for (let i = 0; i < plotted.length; i++) {
    const { file: f, ins, effCc } = plotted[i];
    const rank = i + 1; // 全局重构优先级（ranked 降序，与排行栏一致）
    const nx = nxOf({ file: f });
    const ny = nyOf({ file: f });
    // v2.30 象限落区与散点坐标严格一致：按归一化坐标是否过中线（0.5）判定所属象限，
    // 与背景区 W/2、H/2 分界线完全对齐 —— 视觉位置即逻辑象限，聚焦命中零错位。
    // v2.47 此处先于落格计算，作为网格带约束（fitCell）的输入，杜绝跨中线漂移。
    const zoneByPos: RiskQuadrant =
      nx > 0.5 && ny > 0.5
        ? "refactorFirst"
        : nx <= 0.5 && ny > 0.5
          ? "legacyStable"
          : nx > 0.5 && ny <= 0.5
            ? "activeSimple"
            : "healthy";
    const idealX = LEFT + nx * (W - NODE_W);
    const idealY = TOP + (1 - ny) * (H - NODE_H); // 复杂度高 → 靠上
    const c0 = Math.floor((idealX - LEFT) / CELL_W);
    const r0 = Math.floor((idealY - TOP) / CELL_H);
    // v2.47 把网格落位约束在节点真实象限带内，保证视觉位置恒等于逻辑象限
    const idx = fitCell(c0, r0, quadBandOf(zoneByPos));
    let x: number;
    let y: number;
    if (idx >= 0) {
      const cc = idx % COLS;
      const rr = Math.floor(idx / COLS);
      x = LEFT + cc * CELL_W + (CELL_W - NODE_W) / 2;
      y = TOP + rr * CELL_H + (CELL_H - NODE_H) / 2;
    } else {
      x = Math.max(LEFT, Math.min(idealX, LEFT + W - NODE_W));
      y = Math.max(TOP, Math.min(idealY, TOP + H - NODE_H));
    }

    // 象限位置已编码「变更×复杂度」两维，左侧色条再编码第三维风险分（综合性热点）：
    // 高风险红、中风险橙、低风险绿。FileRenderer 的 stripe 优先用 accentColor 覆盖复杂度色条。
    // v2.20 修复：riskScore 是 0~N 的加权整数（error*5+warning*2+info*1，fileInsights.ts:441），
    // 对齐 gridStyle 风险口径（portraits.ts:436 的整数阈值）。
    const riskColor =
      ins.riskScore >= 40 ? "#EF4444" : ins.riskScore >= 15 ? "#F97316" : "#22c55e";
    const proxy = ins.complexity <= 1;
    const id = place(
      "file",
      { x, y },
      f.name,
      fileConfig(f, ins, "quadrant", {
        accentColor: riskColor,
        quadrant: zoneByPos,
        // v2.45：全局重构优先级序号，画布卡左上角徽标直接读出「先重构谁」
        rank,
        // v2.38：把当前生效的横轴维度写进节点 config，画像面板据此显示一致的指标与建议
        quadrantXAxis: xAxis,
        // v2.35：代理复杂度诚实落库，使画像面板显示的分值与实际散点位置一致
        complexity: proxy ? effCc : ins.complexity,
        complexityProxy: proxy,
      }),
      { w: NODE_W, h: NODE_H }
    );
    if (id) {
      placedCount += 1;
      counts[zoneByPos] += 1;
    }
  }

  // v2.34 可行动排行栏：把「先重构谁」从散点里拎出来，右侧列出优先级 Top-N
  // 文件（复合分 rankScore 降序，即 plotted 的最优先者）。每张是带 fileId 的 file 实体
  // —— 双击即跳源码（复用 SceneEditor 双击 → navigateToSource 既有路径），比在散点里
  // 逐个找点更直给，真正落实「画像可行动」而非只「能渲染」（见项目铁律 renderable ≠ useful）。
  const RAIL_X = LEFT + W + 44;
  const RAIL_W = 286;
  const RAIL_ITEM_H = 42;
  const RAIL_GAP = 8;
  const RAIL_N = Math.min(12, ranked.length);
  place("layer-marker", { x: RAIL_X, y: TOP - 36 }, t("portrait.msg.quadRailTitle", { n: RAIL_N }), {
    layerName: t("portrait.msg.quadRailTitle", { n: RAIL_N }),
    layerColor: "#EF9F27",
    layerOrder: 0,
  });
  for (let i = 0; i < RAIL_N; i++) {
    const { file: f, ins, effCc } = ranked[i];
    const nxr = nxOf({ file: f });
    const nyr = nyOf({ file: f });
    const rk =
      ins.riskScore >= 40 ? "#EF4444" : ins.riskScore >= 15 ? "#F97316" : "#22c55e";
    const proxy = ins.complexity <= 1;
    const id = place(
      "file",
      { x: RAIL_X, y: TOP + i * (RAIL_ITEM_H + RAIL_GAP) },
      `#${i + 1} ${f.name}`,
      fileConfig(f, ins, "quadrant", {
        accentColor: rk,
        quadrant:
          nxr > 0.5 && nyr > 0.5
            ? "refactorFirst"
            : nxr <= 0.5 && nyr > 0.5
              ? "legacyStable"
            : nxr > 0.5 && nyr <= 0.5
              ? "activeSimple"
              : "healthy",
        quadrantRail: true,
        rank: i + 1,
        quadrantXAxis: xAxis,
        complexity: proxy ? effCc : ins.complexity,
        complexityProxy: proxy,
      }),
      { w: RAIL_W, h: RAIL_ITEM_H }
    );
    if (id) placedCount += 1;
  }

  // v2.41 坐标轴 + 刻度数值 + 公式：最后绘制（覆盖在 file 节点之上）以保证刻度可读，
  // 但 pointer-events:none 不拦截节点交互。十字轴落在象限中线上（与 quadrant-zone-bg 分区
  // 边界严格对齐），刻度数值由上方 xTicks/yTicks 携带真实度量值。
  // v2.47 同象限背景：解析后的名称避免实体列表显示原始 key `entityProj.quadrantAxis.name`
  place(
    "quadrant-axis",
    { x: LEFT, y: TOP },
    t("entityProj.quadrantAxis.name"),
    { xTicks, yTicks, xTitle: axisXTitle, yTitle: axisYTitle, formula: axisFormula, hint: axisHint },
    { w: W, h: H }
  );

  await persist(analysisId, "quadrant");

  const first = counts.refactorFirst;
  // v2.28：补四象限完整计数统计，让用户一眼看清分布（回答「先重构谁」的可行动信息），
  // 不再只报「优先重构」一档。counts 已在上方循环按 ins.quadrant 累加。
  return {
    ok: true,
    message:
      t("portrait.msg.quadDone", {
        n: placedCount,
        first: first > 0 ? t("portrait.msg.quadFirst", { n: first }) : t("portrait.msg.quadHealthy"),
      }) +
      t("portrait.msg.quadStats", {
        rf: counts.refactorFirst,
        ls: counts.legacyStable,
        as: counts.activeSimple,
        h: counts.healthy,
      }) +
      (truncated ? t("portrait.msg.quadTopNMsg", { shown: PLOT_CAP, total: rows.length }) : ""),
    severity: first > 0 ? "warning" : "success",
    placed: placedCount,
  };
}

// ───────────────────────── 设计模式画像 ─────────────────────────

/**
 * 设计模式画像：后端识别出的每条模式命中在画布上落一个 pattern-node
 *
 * 需求「扫描项目要分析…代码的设计模式」的画布落点。布局按 GoF 分类分区：
 * 创建型 / 结构型 / 行为型 / 架构角色四列，每列顶部一个分区头（layer-marker），
 * 列内是该分类的模式命中节点，置信度环 + 证据 tooltip 由 PatternNodeRenderer 呈现。
 *
 * 命中数上限 120：模式识别是启发式推断，命中可能很多，超过上限只保留
 * 置信度最高的前 120 条，避免画布糊成一团（tooltip 文案说明截断）。
 */
/// 模块依赖图（v2.3）：顶层目录为节点、模块间调用聚合为边的环形依赖图。
/// 回答「模块之间到底谁依赖谁、方向对不对、哪里成环」——符号画像横带上的
/// →N ←M 徽标升级为独立视图。节点大小按依赖总量，环上模块红描边。
const MOD_GRAPH_NODE_W = 200;
const MOD_GRAPH_NODE_H = 88;
const MOD_GRAPH_MAX = 24;

async function runModuleGraphPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  if (pst.callEdges.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.impactNoData"),
      severity: "info",
      placed: 0,
    };
  }
  const deps = buildModuleDeps(pst.callEdges, pst.files);
  const counts = summarizeModuleDeps(deps);
  // 参与调用的模块（有出/入依赖），按依赖总量降序取前 N
  const dirs = Array.from(counts.entries())
    .map(([dir, c]) => ({ dir, total: c.out + c.in, out: c.out, in: c.in }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MOD_GRAPH_MAX);
  if (dirs.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.modNoData"),
      severity: "info",
      placed: 0,
    };
  }

  // 环形布局：节点均布圆周，半径按节点数自适应（防重叠）
  const N = dirs.length;
  const R = Math.max(380, (N * (MOD_GRAPH_NODE_W + 90)) / (2 * Math.PI));
  const CX = 520;
  const CY = 400;
  const nodes = dirs.map((m, i) => {
    const angle = (2 * Math.PI * i) / N - Math.PI / 2;
    return {
      ...m,
      x: CX + R * Math.cos(angle) - MOD_GRAPH_NODE_W / 2,
      y: CY + R * Math.sin(angle) - MOD_GRAPH_NODE_H / 2,
    };
  });
  const dirSet = new Set(nodes.map((n) => n.dir));
  const edges = deps.filter((e) => dirSet.has(e.fromDir) && dirSet.has(e.toDir));
  const maxCount = Math.max(1, ...edges.map((e) => e.count));
  const cycleDirs = detectModuleCycles(edges);
  const fileCountOf = (dir: string) =>
    pst.files.filter((f) => !f.isDirectory && topDirOf(f.relPath) === dir).length;
  // v2.4 节点大小按依赖总量缩放（160~260 宽）：承重模块视觉上更显眼
  const maxTotal = Math.max(1, ...nodes.map((n) => n.total));
  const nodeWOf = (n: { total: number }) => Math.round(160 + 100 * (n.total / maxTotal));

  clearCanvas();

  let placedCount = 0;
  for (const n of nodes) {
    const id = place(
      "module",
      { x: n.x, y: n.y },
      n.dir,
      {
        name: n.dir,
        moduleName: n.dir,
        fileCount: fileCountOf(n.dir),
        depCount: n.total,
        ca: n.in,
        ce: n.out,
        inCycle: cycleDirs.has(n.dir),
        portraitMode: "moduleGraph",
      },
      { w: nodeWOf(n), h: MOD_GRAPH_NODE_H }
    );
    if (id) placedCount += 1;
  }

  // v2.5 双向边合并：A→B 与 B→A 成对时向垂直方向各偏移 14px ——
  // 两条边平行不重合，且各自箭头方向（谁依赖谁）仍可读。
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const byPair = new Map<string, typeof edges>();
  for (const e of edges) {
    const k = pairKey(e.fromDir, e.toDir);
    const arr = byPair.get(k);
    if (arr) arr.push(e);
    else byPair.set(k, [e]);
  }

  let edgeCount = 0;
  const placeEdge = (e: (typeof edges)[number], side: -1 | 0 | 1) => {
    const a = nodes.find((n) => n.dir === e.fromDir);
    const b = nodes.find((n) => n.dir === e.toDir);
    if (!a || !b) return;
    const aW = nodeWOf(a);
    const bW = nodeWOf(b);
    let absFromX = a.x + aW / 2;
    let absFromY = a.y + MOD_GRAPH_NODE_H / 2;
    let absToX = b.x + bW / 2;
    let absToY = b.y + MOD_GRAPH_NODE_H / 2;
    if (side !== 0) {
      // 垂直于 A→B 方向的单位向量 × 偏移量 × 方向
      const dx = absToX - absFromX;
      const dy = absToY - absFromY;
      const len = Math.hypot(dx, dy) || 1;
      const off = 14;
      absFromX += (-dy / len) * off * side;
      absFromY += (dx / len) * off * side;
      absToX += (-dy / len) * off * side;
      absToY += (dx / len) * off * side;
    }
    const minX = Math.min(absFromX, absToX);
    const minY = Math.min(absFromY, absToY);
    const id = place(
      "dependency-edge",
      { x: minX, y: minY },
      `${e.fromDir} → ${e.toDir}`,
      {
        depType: "import",
        fromX: absFromX - minX,
        fromY: absFromY - minY,
        toX: absToX - minX,
        toY: absToY - minY,
        // 模块级联动：选中模块实体时这条依赖边点亮（复用 fromMod/toMod 字段）
        fromMod: e.fromDir,
        toMod: e.toDir,
        edgeCount: e.count,
        weight: e.count,
        // v2.4 权重分级：低权重边淡且细，高权重边粗且实（一眼看出主依赖链）
        weightRatio: e.count / maxCount,
        symbolNames: [],
        isCircular: cycleDirs.has(e.fromDir) && cycleDirs.has(e.toDir),
        portraitMode: "moduleGraph",
      },
      { w: Math.max(4, Math.abs(absToX - absFromX) + 16), h: Math.max(4, Math.abs(absToY - absFromY) + 16) }
    );
    if (id) edgeCount += 1;
  };

  for (const arr of byPair.values()) {
    if (arr.length >= 2) {
      placeEdge(arr[0], 1);
      placeEdge(arr[1], -1);
    } else {
      placeEdge(arr[0], 0);
    }
  }

  await persist(analysisId, "moduleGraph");

  const cycN = cycleDirs.size;
  return {
    ok: true,
    message: t("portrait.msg.modDone", {
      n: placedCount,
      edges: edgeCount,
      cyc: cycN > 0 ? t("portrait.msg.modCycles", { n: cycN }) : "",
      maxW: maxCount,
    }),
    severity: "success",
    placed: placedCount + edgeCount,
  };
}

// v2.27 会话级去重：同一分析在一次会话内只自动重检测一次，避免每次打开画像都重读源码；
// 用户手动「设计模式（重新检测）」走 force，不受此标记限制，始终强制刷新。
const patternsRedetectedThisSession = new Set<string>();

// v2.27 修正「自愈门禁误判」：
// 旧引擎（v2.24 之前）其实已经能识别 store/provider/service/repository/controller/middleware/
// plugin/factory 这类「命名即模式」的类级符号——所以旧快照里往往残留一两个 factory/service 命中。
// 若把这些都算作「已重检」判据，一个残留的 `factory` 单点命中就会让 needsRefresh 永远为 false，
// 自愈重检被跳过，画像卡在「1 个节点」——这正是反复报「设计模式画像不能用」的真根因。
// 真正只有 v2.24+ 证据引擎才产出的、旧引擎绝不出现的模式只有三个：hook / hoc / factory_fn。
// 用它们做「新版引擎已跑过」的判据，残缺快照（缺这三个）才能被正确识别并重检补全。
const NEW_ENGINE_CANARY_IDS = new Set(["hook", "hoc", "factory_fn"]);

async function runPatternsPortrait(
  analysisId: string,
  projectRoot?: string | null,
  force = false
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let hits = pst.patternHits;
  // v2.20.1 自愈：画像运行时若 store 未持有模式数据（例如存量会话未重新 loadAll、
  // 或刚切到新分析），先尝试拉取一次再判定，避免「点开设计模式什么都没有」被误判为功能失效。
  if (hits.length === 0) {
    try {
      await pst.loadPatterns(analysisId);
      hits = useProjectStore.getState().patternHits;
    } catch {
      /* 拉取失败则走下方空态提示 */
    }
  }
  // v2.21 自愈增强：存量分析多为旧保守引擎扫描，patterns 列几乎全空 → 画像「无数据」。
  // 此时若已知项目根目录，直接对源码重新检测设计模式（仅回写 patterns/metadata 两列，
  // 不动符号稳定 id 与引用边），让画像无需整库重扫即可出数据——这正是「不能用」的根因修复。
  // v2.22 鲁棒化：重检测的错误与「缺根目录」不再被静默吞掉——把真实原因带出去，
  // 让「点开设计模式什么都没有」变成「为什么 + 怎么修」，而不是被误判为功能失效。
  let redetected = false;
  let redetectError: string | null = null;
  // v2.26 后端陈旧自检：若运行的是旧构建，redetect_design_patterns 命令不存在，
  // invoke 会抛「command not found / unknown command」类错误。此时不能把它当成
  // 「源码读取失败」误导用户去查路径，而应明确指向「请重启应用加载最新后端」——
  // 这正是「不能用」反复出现的真因，给一条可执行指引比静默/误报更有用（renderable≠useful）。
  let backendStale = false;
  // v2.27 自愈强化：旧引擎扫描产物往往「只有类级模式、缺函数式/架构角色模式」。
  // 此前 redetect 仅在 hits 全空时才触发 —— 一旦旧扫描里残存了几个类级模式（singleton/
  // factory 等），hits 非空就永远跳过重检，用户每次打开都只看到残缺快照，持续误判为
  // 「设计模式画像不能用」。现在：只要命中里没有任何 v2.24 后的函数式/架构角色模式，
  // 即视为残缺快照，自动对源码重检补全（一次会话内只跑一次，手动「重新检测」走 force 强刷）。
  // 仅在命中里包含「新版引擎独有」的模式（hook/hoc/factory_fn）时，才认为这份快照已由新版引擎产出；
  // 旧引擎只会产生 factory/service/repository 等类级命中，不会产出上述三种，从而触发重检。
  const hasNewEngineMark = hits.some((h) => NEW_ENGINE_CANARY_IDS.has(h.pattern));
  // v2.27 额外兜底：即便命中非空，若模式数量相对项目规模过少（例如只有 1~2 个），
  // 也视为旧引擎的残缺快照，强制重检，避免「打开一次就被残缺数据钉死」。
  const tooThin = hits.length > 0 && hits.length <= 2;
  const needsRefresh = force || hits.length === 0 || !hasNewEngineMark || tooThin;
  const alreadyRedetected = patternsRedetectedThisSession.has(analysisId);
  // v2.25 手动重新检测：菜单「设计模式（重新检测）」走 force=true，绕过「空数据才重检」门禁，
  // 强制对源码重跑引擎并刷新画像——解决存量项目被旧引擎误判后、用户无入口刷新的「不能用」死局。
  if (needsRefresh && projectRoot && projectRoot.trim() && (force || !alreadyRedetected)) {
    try {
      // 重检测要读全部源码、逐符号跑引擎，可能耗时数秒。先给一条「检测中」提示，
      // 否则用户点击后画布毫无反应，会误以为功能失效（即「不能用」的典型体感）。
      if (!force) useToastStore.getState().showToast(t("portrait.msg.patternRedetecting"), "info");
      await projectScanApi.redetectDesignPatterns(analysisId, projectRoot.trim());
      redetected = true;
      patternsRedetectedThisSession.add(analysisId);
      await pst.loadPatterns(analysisId);
      hits = useProjectStore.getState().patternHits;
    } catch (e) {
      // 不再静默：记下真实原因，下方空态直接呈现，用户才知道问题出在源码读取/DB 而非功能缺失。
      redetectError = e instanceof Error ? e.message : String(e);
      // 后端陈旧特征：命令未注册 / invoke 失败（旧二进制没有 redetect_design_patterns）。
      if (/not found|unknown command|invoke error|does not exist|no handler/i.test(redetectError)) {
        backendStale = true;
      }
      console.error("[runPatternsPortrait] 重新检测设计模式失败", e);
    }
  }
  if (hits.length === 0) {
    // 后端陈旧：命令不可用 → 明确指引重启应用，而非误导去查源码路径。
    if (backendStale) {
      return {
        ok: false,
        message: t("portrait.msg.patternBackendStale"),
        severity: "warning",
        placed: 0,
      };
    }
    // 缺项目根目录：重检测无从读取源码，明确指引用户先打开项目文件夹（设置 projectRoot）。
    if (!projectRoot || !projectRoot.trim()) {
      return {
        ok: false,
        message: t("portrait.msg.patternNoRoot"),
        severity: "warning",
        placed: 0,
      };
    }
    // 有根目录但仍是空：区分「重检测报错」与「确实无模式」，分别给可执行的下一步。
    return {
      ok: false,
      message: redetectError
        ? t("portrait.msg.patternRedetectError", { err: redetectError })
        : redetected
          ? t("portrait.msg.patternNoDataAfterRedetect")
          : t("portrait.msg.patternNoData"),
      severity: redetectError ? "warning" : "info",
      placed: 0,
    };
  }

  const MAX_HITS = 120;
  const sorted = [...hits].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_HITS);

  clearCanvas();

  // 解析 fileId / symbolId：让模式节点与画布文件 / 符号实体同源联动
  // （双击跳源码、选中高亮所属文件、AI 诊断都走 fileId，与 symbols/dependency 一致）。
  // 设计模式识别是启发式推断，命中的符号在 symbols 表里必有对应条目（同一 filePath + 同名）。
  const fileIdByPath = new Map<string, string>();
  for (const f of pst.files) if (!f.isDirectory) fileIdByPath.set(f.relPath, f.id);
  const symIdByFileSym = new Map<string, string>();
  for (const s of pst.symbols) symIdByFileSym.set(`${s.filePath}\u0000${s.name}`, s.id);

  const COL_W = 250;
  const ROW_H = 62;
  const LEFT = 40;
  const TOP = 104; // 顶部留给总览横幅（24..70），避免与分类分区头重叠
  const SUB_H = 24;
  let placed = 0;

  // ── 总览横幅：直接回答「我的项目用了哪些设计模式」──
  // 这是该画像的「灵魂」：此前只是一屏扁平节点，用户看不到聚合结论。
  const catCounts: Record<string, number> = { creational: 0, structural: 0, behavioral: 0, architectural: 0 };
  for (const h of sorted) catCounts[patternCategoryOf(h)] = (catCounts[patternCategoryOf(h)] ?? 0) + 1;
  const byPatternAgg = new Map<string, number>();
  for (const h of sorted) byPatternAgg.set(h.pattern, (byPatternAgg.get(h.pattern) || 0) + 1);
  const topPattern = Array.from(byPatternAgg.entries()).sort((a, b) => b[1] - a[1])[0];
  const distinctKinds = byPatternAgg.size;
  const breakdown = PATTERN_CATEGORY_ORDER
    .map((cat) => `${t(PATTERN_CATEGORY_LABEL_KEY[cat] ?? cat)} ${catCounts[cat] ?? 0}`)
    .join(" · ");
  // 健康提示（v2.25）：低置信命中占比高说明引擎靠命名推断、可能误报，提示用户人工核对，
  // 让画像从「列清单」升级为「可行动的分析」——契合「renderable ≠ useful」验收标尺。
  const lowConf = sorted.filter((h) => h.confidence < 0.7).length;
  const healthNote = lowConf > 0 ? t("portrait.msg.patternLowConf", { n: lowConf }) : "";
  const overviewName = t("portrait.msg.patternOverviewTitle", { kinds: distinctKinds, n: sorted.length });
  const overviewSub = `${breakdown}${topPattern ? t("portrait.msg.patternOverviewTop", { name: patternLabel(topPattern[0]), n: topPattern[1] }) : ""}${healthNote}`;
  place(
    "layer-marker",
    { x: LEFT, y: 24 },
    overviewName,
    {
      layerName: overviewName,
      subtitle: overviewSub,
      layerColor: "#38bdf8",
      fullPath: overviewSub,
    },
    { w: COL_W * PATTERN_CATEGORY_ORDER.length - 10, h: 46 }
  );

  // ── 四分类列：每列内按「模式」聚簇（同类色块下，同模式一组、共享配色）──
  PATTERN_CATEGORY_ORDER.forEach((cat, col) => {
    const catHits = sorted.filter((h) => patternCategoryOf(h) === cat);
    if (catHits.length === 0) return;
    const x = LEFT + col * COL_W;
    const color = PATTERN_CATEGORY_COLORS[cat] ?? "#94a3b8";
    // 分类分区头
    place("layer-marker", { x, y: TOP - 30 }, t(PATTERN_CATEGORY_LABEL_KEY[cat] ?? cat), {
      layerName: t(PATTERN_CATEGORY_LABEL_KEY[cat] ?? cat),
      layerColor: color,
      layerOrder: col,
      fileCount: catHits.length,
    });
    // 按模式聚簇：同模式命中归一组，组头显示「模式名 (n)」并染该模式配色
    const groups = new Map<string, typeof catHits>();
    for (const h of catHits) {
      const arr = groups.get(h.pattern);
      if (arr) arr.push(h);
      else groups.set(h.pattern, [h]);
    }
    const orderedGroups = Array.from(groups.entries()).sort(
      (a, b) => b[1].length - a[1].length
    );
    let y = TOP;
    for (const [pid, group] of orderedGroups) {
      const pcolor = patternColorOf(pid);
      // 模式子头（带该模式配色，扫一眼即知这一簇是什么模式）
      place(
        "layer-marker",
        { x: x + 4, y },
        `${patternLabel(pid)} (${group.length})`,
        {
          layerName: `${patternLabel(pid)} (${group.length})`,
          layerColor: pcolor,
        },
        { w: COL_W - 12, h: SUB_H }
      );
      y += SUB_H + 2;
      for (const h of group) {
        const fileId = fileIdByPath.get(h.filePath);
        const symbolId = symIdByFileSym.get(`${h.filePath}\u0000${h.symbolName}`);
        if (
          place(
            "pattern-node",
            { x, y },
            `${patternLabel(h.pattern)} · ${h.symbolName}`,
            {
              patternId: h.pattern,
              patternName: patternLabel(h.pattern),
              patternCategory: cat,
              symbolName: h.symbolName,
              filePath: h.filePath,
              fileId,
              symbolId,
              line: h.line,
              confidence: h.confidence,
              evidence: h.evidence,
              signals:  h.signals,
              // v2.20 设计模式节点从「死节点」改为可行动实体：带 portraitMode 让双击/选中/AI
              // 诊断能精确识别，fileId 打通与文件实体的同源联动（与 symbols/dependency 同口径）。
              portraitMode: "patterns",
            },
            // v2.28 修复「实体渲染不全/相邻重叠」：此前节点漏传尺寸，画布外壳 width/height 为
            // undefined → 节点塌缩成内容宽度溢出 250px 列宽，跨列互相覆盖。这里显式给定列内盒，
            // 宽度略小于列距(250)留 12px 间隙，高度留出 6px 行距，确保实体互不重叠且完整渲染。
            { w: COL_W - 12, h: ROW_H - 6 }
          )
        ) {
          placed += 1;
        }
        y += ROW_H;
      }
      y += 8; // 模式簇间留白
    }
  });

  if (placed === 0) {
    return { ok: false, message: t("portrait.msg.patternNoNode"), severity: "warning", placed: 0 };
  }

  await persist(analysisId, "patterns");

  return {
    ok: true,
    message: t("portrait.msg.patternOverview", {
      kinds: distinctKinds,
      n: placed,
      breakdown,
      trunc: hits.length > MAX_HITS ? t("portrait.msg.patternTrunc", { keep: MAX_HITS, total: hits.length }) : "",
      redetect: redetected ? t("portrait.msg.patternRedetected") : "",
      top: topPattern ? t("portrait.msg.patternTop", { name: patternLabel(topPattern[0]), n: topPattern[1] }) : "",
    }),
    severity: "success",
    placed,
  };
}

// ───────────────────────── 代码结构画像 ─────────────────────────

/**
 * 代码结构画像：把分析出的符号（class/function/interface/struct/enum/trait...）
 * 渲染成符号级画布实体，每个文件一组（分组头 + 一行符号卡片）。
 *
 * 需求「扫描项目要分析…代码结构」的画布落点 —— 此前符号数据只存在于左侧
 * 面板列表里，画布上没有任何符号实体。这也是本轮「实体补充」的核心：
 * ClassRenderer / FunctionRenderer / InterfaceRenderer 三个渲染器早已注册，
 * 但从没有代码用真实符号数据创建过对应实体（挂着不通电）。
 *
 * 业务联动（不只是静态画像）：
 * - 每个符号实体 config 带 fileId → 选中符号时，所属文件 + 该文件依赖邻居
 *   自动高亮（复用画布 fileId 联动机制）；
 * - 双击符号实体 → 打开源码并定位到符号定义行（lineStart）。
 */
async function runSymbolsPortrait(
  analysisId: string,
  filter?: { query?: string; kinds?: string[] }
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  if (pst.symbols.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.symNoData"),
      severity: "info",
      placed: 0,
    };
  }

  // v2.14 范式：项目目录树 + 符号叶子（用户建议「代码结构在目录树基础上扩展」）。
  // 画布 = 目录树（folder/file 实体 + 树形引导线，与左侧目录树同一套心智）；
  // 文件行显示符号数徽标；双击文件展开/收起其符号卡（expandedSymFiles）。
  // 默认全部折叠 → 画布 = 干净的目录树；按需展开看符号 —— 不再一次画几百个实体。
  const root = buildDirectoryTree({
    files: pst.files,
    metrics: pst.metrics,
    techDebt: pst.techDebt,
    findings: pst.findings,
    clones: pst.clones,
  });
  if (!root) {
    return { ok: false, message: t("portrait.msg.dirNoScan"), severity: "info", placed: 0 };
  }
  const flat = flattenDirectoryTree(root, { maxDepth: 4, maxNodes: 160, minFiles: 1, sort: "size" });
  const nodes = flat.nodes;
  if (nodes.length <= 1) {
    return { ok: false, message: t("portrait.msg.dirNoDepth"), severity: "info", placed: 0 };
  }

  // 符号按文件分组 + import 引用计数（文件徽标/符号卡引用数，口径与 buildSymbolLayout 一致）
  const symsByFile = new Map<string, ProjectSymbol[]>();
  const refCountBySymbol = new Map<string, number>();
  for (const r of pst.symbolRefs) {
    if (!r.toSymbolId || r.kind !== "import") continue;
    refCountBySymbol.set(r.toSymbolId, (refCountBySymbol.get(r.toSymbolId) ?? 0) + 1);
  }
  for (const sym of pst.symbols) {
    const arr = symsByFile.get(sym.fileId);
    if (arr) arr.push(sym);
    else symsByFile.set(sym.fileId, [sym]);
  }

  const expanded = useEditorStore.getState().expandedSymFiles;
  clearCanvas();

  const LEFT = 40;
  const TOP = 40;
  const INDENT = 34;
  const DIR_H = 52;
  const FILE_H = 44;
  const SYM_H = 64;
  const ROW_GAP = 8;
  const SYM_W = 240;
  const MIN_W = 190;
  const MAX_W = 470;
  const MAX_FILE_LEAVES = 600;
  const MAX_FILES_PER_DIR = 20;
  const maxLines = Math.max(...nodes.map((n) => n.totalLines), 1);

  const dirOf = (relPath: string) => {
    const i = relPath.lastIndexOf("/");
    return i < 0 ? "" : relPath.slice(0, i);
  };
  const filesByDir = new Map<string, typeof pst.files>();
  for (const f of pst.files) {
    if (f.isDirectory) continue;
    const d = dirOf(f.relPath);
    const arr = filesByDir.get(d);
    if (arr) arr.push(f);
    else filesByDir.set(d, [f]);
  }

  interface LaidOutRow {
    x: number;
    y: number;
    w: number;
    h: number;
    parentPath: string | null;
    path: string;
  }
  const items: BulkComponentInput[] = [];
  const rows: LaidOutRow[] = [];
  const rowIndexByPath = new Map<string, number>();
  const parentPathOf = (p: string): string | null => {
    if (!p) return null;
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  };

  let fileLeaves = 0;
  let cursorY = TOP;
  let symPlaced = 0;
  let expandedCount = 0;

  for (const n of nodes) {
    const x = LEFT + n.depth * INDENT;
    const y = cursorY;
    cursorY += DIR_H + ROW_GAP;
    const ratio = Math.sqrt(n.totalLines / maxLines);
    const w = Math.round(MIN_W + (MAX_W - MIN_W) * ratio);
    rowIndexByPath.set(n.path, rows.length);
    rows.push({ x, y, w, h: DIR_H, parentPath: n === root ? null : parentPathOf(n.path), path: n.path });
    items.push({
      type: "folder",
      name: n.name,
      x,
      y,
      width: w,
      height: DIR_H,
      locked: true,
      config: {
        name: n.name,
        dirPath: n.path,
        depth: n.depth,
        childCount: n.directFiles + n.childDirCount,
        directFiles: n.directFiles,
        childDirCount: n.childDirCount,
        fileCount: n.fileCount,
        totalLines: n.totalLines,
        avgComplexity: n.avgComplexity,
        maxComplexity: n.maxComplexity,
        complexityLevel: n.complexityLevel,
        techDebtCount: n.techDebtCount,
        findingCount: n.findingCount,
        cloneCount: n.cloneCount,
        dominantLanguage: n.dominantLanguage,
        languageShare: n.languages.slice(0, 4),
        portraitMode: "symbols" as PortraitMode,
        dirSymbolTree: true,
      },
    });

    if (fileLeaves < MAX_FILE_LEAVES) {
      const dirFiles = filesByDir.get(n.path);
      if (dirFiles && dirFiles.length > 0) {
        for (const f of dirFiles.slice(0, MAX_FILES_PER_DIR)) {
          if (fileLeaves >= MAX_FILE_LEAVES) break;
          const entityType = entityTypeForFile(f);
          const isImg = entityType === "image";
          const rowH = isImg ? 112 : FILE_H;
          const rowW = Math.max(160, w - INDENT);
          const fx = LEFT + (n.depth + 1) * INDENT;
          const fy = cursorY;
          cursorY += rowH + ROW_GAP;
          fileLeaves += 1;
          const filePathKey = `${n.path}\u0000${f.relPath}`;
          rowIndexByPath.set(filePathKey, rows.length);
          rows.push({ x: fx, y: fy, w: rowW, h: rowH, parentPath: n.path, path: filePathKey });
          const syms = symsByFile.get(f.id) ?? [];
          items.push({
            type: entityType,
            name: f.name,
            x: fx,
            y: fy,
            width: isImg ? Math.min(rowW, 168) : rowW,
            height: rowH,
            locked: true,
            config: {
              fileName: f.name,
              filePath: f.relPath,
              language: f.language,
              fileSize: f.size,
              lineCount: f.lineCount ?? 0,
              fileId: f.id,
              symbolCount: syms.length,
              // v2.14 展开标记：双击文件展开/收起符号
              expandableFile: true,
              symbolDrillFile: f.id,
              expanded: expanded.has(f.id),
              portraitMode: "symbols" as PortraitMode,
            },
          });

          // 展开符号：该文件的符号卡（前 MAX_SYMBOLS_PER_FILE 个，按引用降序）
          if (expanded.has(f.id)) {
            expandedCount += 1;
            const shown = [...syms]
              .sort((a, b) => (refCountBySymbol.get(b.id) ?? 0) - (refCountBySymbol.get(a.id) ?? 0))
              .slice(0, MAX_SYMBOLS_PER_FILE);
            for (const sym of shown) {
              const sx = LEFT + (n.depth + 2) * INDENT;
              const sy = cursorY;
              cursorY += SYM_H + ROW_GAP;
              const symPath = `sym:${sym.id}`;
              rowIndexByPath.set(symPath, rows.length);
              rows.push({ x: sx, y: sy, w: SYM_W, h: SYM_H, parentPath: filePathKey, path: symPath });
              items.push({
                type: entityTypeForSymbolKind(sym.kind),
                name: sym.name,
                x: sx,
                y: sy,
                width: SYM_W,
                height: SYM_H,
                locked: true,
                config: {
                  name: sym.name,
                  symbolId: sym.id,
                  symbolKind: sym.kind,
                  fileId: sym.fileId,
                  fileName: f.name,
                  filePath: sym.filePath,
                  lineStart: sym.lineStart,
                  lineEnd: sym.lineEnd,
                  signature: sym.signature,
                  refCount: refCountBySymbol.get(sym.id) ?? 0,
                  portraitMode: "symbols" as PortraitMode,
                },
              });
              symPlaced += 1;
            }
          }
        }
      }
    }
  }

  // 树形引导线：父竖干 + 子横枝（单 SVG 实体，压在实体底下）
  const guide = buildTreeGuide(rows, rowIndexByPath, INDENT);
  if (guide) {
    guide.locked = true;
    items.unshift(guide);
  }

  const ids = useEditorStore.getState().addComponentsBulk(items);
  await persist(analysisId, "symbols");

  return {
    ok: true,
    message: t("portrait.msg.symTreeDone", {
      dirs: nodes.length,
      files: fileLeaves,
      syms: symPlaced,
      exp: expandedCount > 0 ? t("portrait.msg.symTreeExpanded", { n: expandedCount }) : "",
    }),
    severity: "success",
    placed: ids.length,
  };
}

// ───────────────────────── 影响面画像 ─────────────────────────

/** 影响面画像的目标：符号级或文件级二选一 */
export interface ImpactTarget {
  rootSymbolId?: string;
  rootFileId?: string;
  maxDepth?: number;
}

/**
 * 影响面画像：以目标为中心，上游（调用者）向左分环、下游（被调用者）向右分环
 *
 * 其它画像回答「整个项目怎么样」，这张图只回答一个问题：
 * **「我改这里，谁会跟着崩」** —— 因此布局是以自我为中心的，
 * 左边每一列是一跳调用者（越往左越远），右边每一列是一跳依赖。
 *
 * 中心节点用 module 实体（视觉上更大更醒目），周围用 file 实体。
 */
async function runImpactPortrait(
  analysisId: string,
  target: ImpactTarget
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  if (pst.callEdges.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.impactNoData"),
      severity: "info",
      placed: 0,
    };
  }

  const index = buildCallIndex(pst.callEdges);
  const maxDepth = target.maxDepth ?? 3;

  // 归一到「一批根符号」：符号级就是它自己，文件级是文件内所有参与调用图的符号
  let rootIds: string[] = [];
  let centerLabel = "";
  let centerSub = "";
  if (target.rootSymbolId) {
    rootIds = [target.rootSymbolId];
    const rep = analyzeImpact(pst.callEdges, target.rootSymbolId, {
      maxDepth,
      symbols: pst.symbols,
      index,
    });
    centerLabel = rep.rootName;
    centerSub = rep.rootFilePath;
  } else if (target.rootFileId) {
    index.meta.forEach((m, id) => {
      if (m.fileId === target.rootFileId) rootIds.push(id);
    });
    const f = pst.files.find((x) => x.id === target.rootFileId);
    centerLabel = f?.name || t("portrait.msg.targetFile");
    centerSub = f?.relPath || "";
  }

  if (rootIds.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.impactIsolated"),
      severity: "info",
      placed: 0,
    };
  }

  // 合并多根的传播结果，同一符号取最小跳数
  const collect = (dir: "upstream" | "downstream") => {
    const best = new Map<string, ImpactNode>();
    for (const rid of rootIds) {
      for (const n of traverseImpact(index, rid, dir, maxDepth).nodes) {
        if (rootIds.includes(n.symbolId)) continue;
        const cur = best.get(n.symbolId);
        if (!cur || n.depth < cur.depth) best.set(n.symbolId, n);
      }
    }
    return [...best.values()];
  };

  const upstream = collect("upstream");
  const downstream = collect("downstream");

  if (upstream.length === 0 && downstream.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.impactOrphan", { name: centerLabel }),
      severity: "info",
      placed: 0,
    };
  }

  clearCanvas();

  const NODE_W = 176;
  const NODE_H = 62;
  const CX = 640;
  const CY = 420;
  const COL_GAP = 250;
  const ROW_GAP = 78;
  const MAX_PER_COL = 9; // 每跳最多铺 9 个，超出折叠为一个「其余 N 个」节点

  const fileById = new Map(pst.files.map((f) => [f.id, f]));
  const insights = currentInsights();
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();

  // 中心节点
  const centerX = CX - 110;
  const centerY = CY - 44;
  // 中心节点尺寸随 place 第 5 参落库（与连线用的 centerBox 220×88 对齐）
  place("module", { x: centerX, y: centerY }, centerLabel, {
    name: centerLabel,
    moduleName: centerLabel,
    filePath: centerSub,
    fileCount: rootIds.length,
    depCount: downstream.length,
    beDepCount: upstream.length,
    color: "#8b5cf6",
    portraitMode: "impact",
    isImpactRoot: true,
  }, { w: 220, h: 88 });
  const centerBox = { x: centerX, y: centerY, w: 220, h: 88 };

  /** 把某一方向的节点按跳数铺成列 */
  const layoutSide = (nodes: ImpactNode[], side: -1 | 1) => {
    let count = 0;
    for (let d = 1; d <= maxDepth; d++) {
      const layer = nodes
        .filter((n) => n.depth === d)
        .sort((a, b) => Number(b.crossFile) - Number(a.crossFile) || a.name.localeCompare(b.name));
      if (layer.length === 0) continue;
      const shown = layer.slice(0, MAX_PER_COL);
      const x = CX + side * (COL_GAP * d) - NODE_W / 2 + (side < 0 ? -60 : 60);
      const totalH = shown.length * ROW_GAP;
      shown.forEach((n, i) => {
        const y = CY - totalH / 2 + i * ROW_GAP;
        const f = fileById.get(n.fileId);
        const ins = f ? insights.get(f.id) ?? emptyFileInsight() : emptyFileInsight();
        const id = place(
          "file",
          { x, y },
          n.name,
          f
            ? {
                ...fileConfig(f, ins, "impact"),
                // 覆盖显示名：影响面关心的是「哪个函数」而不是「哪个文件」
                symbolName: n.name,
                impactDepth: d,
                impactSide: side < 0 ? "upstream" : "downstream",
                crossFile: n.crossFile,
                viaName: n.viaName,
                callLine: n.callLine,
              }
            : {
                fileName: n.name,
                filePath: n.filePath,
                symbolName: n.name,
                impactDepth: d,
                impactSide: side < 0 ? "upstream" : "downstream",
                portraitMode: "impact",
              }
        );
        if (id) {
          positions.set(n.symbolId, { x, y, w: NODE_W, h: NODE_H });
          count += 1;
        }
      });
      if (layer.length > shown.length) {
        const y = CY - totalH / 2 + shown.length * ROW_GAP;
        place(
          "annotation-text",
          { x, y },
          t("portrait.msg.impactMore", { n: layer.length - shown.length, d }),
          { text: t("portrait.msg.impactMore", { n: layer.length - shown.length, d }), color: "#94a3b8" }
        );
      }
    }
    return count;
  };

  const upCount = layoutSide(upstream, -1);
  const downCount = layoutSide(downstream, 1);

  // 连线：第 1 跳直接连中心，第 n 跳连它的 via 节点，还原真实调用链路径
  let edges = 0;
  const drawEdge = (n: ImpactNode, side: -1 | 1) => {
    const box = positions.get(n.symbolId);
    if (!box) return;
    const viaBox = n.depth === 1 ? centerBox : positions.get(n.viaSymbolId);
    if (!viaBox) return;
    // 上游是「别人调用我」，箭头方向应是 调用者 → 中心
    const a = side < 0 ? box : viaBox;
    const b = side < 0 ? viaBox : box;
    if (
      connect(a, b, `${n.viaName || centerLabel} ← ${n.name}`, {
        depType: "call",
        isCircular: false,
        symbolNames: [n.name],
        impactDepth: n.depth,
        impactSide: side < 0 ? "upstream" : "downstream",
      })
    ) {
      edges += 1;
    }
  };
  for (const n of upstream) drawEdge(n, -1);
  for (const n of downstream) drawEdge(n, 1);

  await persist(analysisId, "impact");

  const affectedFiles = new Set(upstream.map((n) => n.fileId).filter(Boolean));
  affectedFiles.delete(target.rootFileId || "");
  const level = impactLevelOf(upstream.length, affectedFiles.size);
  const meta = IMPACT_LEVEL_META[level];

  return {
    ok: true,
    message: t("portrait.msg.impactDone", {
      name: centerLabel,
      up: upCount,
      files: affectedFiles.size,
      level: impactLevelLabel(level),
      down: downCount,
      edges,
    }),
    severity: level === "critical" || level === "wide" ? "warning" : "success",
    placed: upCount + downCount + 1,
  };
}

/** 影响面画像（外部入口：面板与右键菜单调用） */
export async function runImpactPortraitFor(
  analysisId: string,
  target: ImpactTarget
): Promise<PortraitOutcome> {
  if (!analysisId) {
    return { ok: false, message: t("portrait.msg.noAnalysis"), severity: "warning", placed: 0 };
  }
  return runImpactPortrait(analysisId, target);
}

/**
 * 函数热点画像（R31）：AST 逐函数度量 → 风险排序的函数级实体
 *
 * 与「复杂度画像」的区别，一句话：复杂度画像告诉你**哪个文件**红了，
 * 这张图告诉你**哪个函数**红了、红在哪（嵌套/CC/行数/形参），双击直接跳到那一行。
 *
 * 业务联动（不是"简单画像"）：
 * - config.fileId → 选中函数卡片时所属文件与其依赖邻居在画布上自动高亮；
 * - config.symbolKind = "function" + lineStart → 双击走 SceneEditor 的符号定位分支，
 *   直接打开源码停在函数定义行；
 * - config.level/reasons → 检查器面板直接说明「为什么它上榜」。
 */
async function runFunctionHotspotPortrait(
  analysisId: string,
  force = false
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  // 自愈：metrics/callEdges/gitChurn 为空（扫描漏跑相关阶段 / 增量未带出）时主动从库重拉
  // 一次再渲染，避免用户永远看到「无数据」且无入口强刷（与设计模式/数据流/调用链同思路）。
  // force=true（菜单「函数热点（重新分析）」）无论是否为空都强制重拉，确保刷新生效。
  if (force || pst.metrics.length === 0 || pst.callEdges.length === 0 || pst.gitChurn.length === 0) {
    try {
      await pst.loadMetrics(analysisId);
      await pst.loadCallEdges(analysisId);
      await pst.loadGitChurn(analysisId);
      const fresh = useProjectStore.getState();
      const layout = buildFunctionHotspots(fresh.metrics, fresh.files, fresh.symbols, fresh.callEdges, fresh.gitChurn);
      return renderHotspotLayout(analysisId, layout);
    } catch (err) {
      console.error("[runFunctionHotspotPortrait] 自愈重拉失败", err);
    }
  }
  // v2.5：heuristic 语言无 AST 明细时，用结构方法符号兜底生成方法级热点
  const layout = buildFunctionHotspots(pst.metrics, pst.files, pst.symbols, pst.callEdges, pst.gitChurn);
  return renderHotspotLayout(analysisId, layout);
}

/** 把已算好的函数热点布局渲染到画布（runFunctionHotspotPortrait 与自愈路径共用） */
function renderHotspotLayout(
  analysisId: string,
  layout: ReturnType<typeof buildFunctionHotspots>
): PortraitOutcome {
  // AST 明细为空且符号兜底也为空 → 才提示无数据（兜底已产出节点则继续渲染）
  if (layout.summary.astFiles === 0 && layout.nodes.length === 0) {
    return {
      ok: false,
      message: layout.summary.totalFunctions > 0 ? t("portrait.msg.hotNoNode", { files: 0, fns: layout.summary.totalFunctions }) : t("portrait.msg.hotNoAst"),
      severity: "info",
      placed: 0,
    };
  }
  if (layout.nodes.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.hotNoNode", { files: layout.summary.astFiles, fns: layout.summary.totalFunctions }),
      severity: "warning",
      placed: 0,
    };
  }

  clearCanvas();

  // 模块分组头：模块名 + 组内热点数，颜色取组内最高风险等级
  for (const g of layout.groups) {
    const top = layout.nodes.filter((n) => n.moduleName === g.name)[0];
    place("layer-marker", { x: g.x, y: g.y }, g.name, {
      layerName: t("portrait.msg.hotGroup", { name: g.name, a: g.renderedCount, b: g.functionCount }),
      layerColor: top ? HOTSPOT_COLORS[top.level] : "#64748b",
      layerOrder: 0,
      moduleName: g.name,
      portraitMode: "hotspotFunctions",
    });
  }

  let placedCount = 0;
  for (const n of layout.nodes) {
    // 尺寸随 place 第 5 参落库（原 place 后 setState 设尺寸已失效）
    const id = place(
      "function",
      { x: n.x, y: n.y },
      n.name,
      {
        name: n.name,
        // symbolKind 存在 → 双击走 SceneEditor 的「符号定位」分支（打开源码到 lineStart）
        symbolKind: "function",
        fileId: n.fileId,
        fileName: n.fileName,
        filePath: n.filePath,
        moduleName: n.moduleName,
        lineStart: n.line,
        lineEnd: n.endLine,
        // FunctionRenderer 读这几个字段渲染卡片
        params: n.params,
        complexity: n.cc,
        maxNesting: n.maxNesting,
        lines: n.lines,
        risk: n.risk,
        level: n.level,
        levelLabel: HOTSPOT_LABELS[n.level],
        reasons: n.reasons,
        callIn: n.callIn,
        churnScore: n.churnScore,
        signature: t("portrait.msg.hotSignature", { name: n.name, params: n.params, lines: n.lines, cc: n.cc, nesting: n.maxNesting }),
        portraitMode: "hotspotFunctions",
      },
      { w: n.width, h: n.height }
    );
    if (!id) continue;
    placedCount += 1;
  }

  persist(analysisId, "hotspotFunctions");

  const { byLevel, worst, truncated, degraded, totalFunctions, astFiles } = layout.summary;
  if (degraded) {
    return {
      ok: true,
      message: t("portrait.msg.hotHealthy", { files: astFiles, fns: totalFunctions, n: placedCount }),
      severity: "success",
      placed: placedCount,
    };
  }
  const levelTxt = (["extreme", "high", "medium", "low"] as const)
    .filter((l) => byLevel[l] > 0)
    .map((l) => `${t(`canvasTip.hotspot.${l}`)} ${byLevel[l]}`)
    .join("、");
  return {
    ok: true,
    message: t("portrait.msg.hotDone", {
      files: astFiles,
      fns: totalFunctions,
      n: placedCount,
      levels: levelTxt,
      worst: worst ? t("portrait.msg.hotWorst", { path: worst.filePath, name: worst.name, reasons: worst.reasons.join("、") }) : "",
      trunc: truncated > 0 ? t("portrait.msg.hotTrunc", { n: truncated }) : "",
    }),
    severity: "success",
    placed: placedCount,
  };
}

// ───────────────────────── 数据流画像 ─────────────────────────

/**
 * 数据流画像（R36）：函数摘要按「污点传播角色」分三区铺开
 *
 * 与函数热点画像的区别，一句话：热点图告诉你**哪个函数难改**，
 * 这张图告诉你**改了之后数据会流到哪去** —— 前者是静态质量，后者是动态波及。
 *
 * 业务联动（不是"简单画像"）：
 * - config.fileId → 选中卡片时所属文件与依赖邻居在画布上高亮；
 * - config.symbolKind = "function" + lineStart → 双击直达函数定义行；
 * - config.flowRole / reasons → 检查器面板说明「它在数据流上扮演什么角色」；
 * - 阻断区（绿）就是 R36 影响链剪枝掉的那批节点 —— 把「为什么剪」摊开给用户看。
 */
async function runDataFlowPortrait(
  analysisId: string,
  force = false
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  let facts = pst.dataFlow;

  // 自愈：store 为空（扫描漏跑 dataFlow 阶段 / 增量未带出）时，主动重拉一次再渲染，
  // 避免用户永远看到「无数据」且无入口强刷（与设计模式 patterns_redetect 同思路）。
  // force=true（菜单「数据流（重新分析）」）无论是否为空都强制重拉，确保刷新生效。
  if (force || facts.length === 0) {
    try {
      await pst.analyzeDataFlow(analysisId, undefined);
      await pst.loadDataFlow(analysisId);
      facts = useProjectStore.getState().dataFlow;
    } catch (err) {
      console.error("[runDataFlowPortrait] 自愈重拉 dataFlow 失败", err);
    }
  }

  if (facts.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.flowNoData"),
      severity: "info",
      placed: 0,
    };
  }

  const layout = buildFlowPortrait(facts);
  if (layout.nodes.length === 0) {
    return {
      ok: false,
      message: t("portrait.msg.flowNoNode", { n: facts.length }),
      severity: "warning",
      placed: 0,
    };
  }

  clearCanvas();

  // 分区头：角色名 + 数量 + 该角色的工程含义
  for (const z of layout.zones) {
    if (z.count === 0) continue;
    place("layer-marker", { x: z.x, y: z.y }, resolveFragments(FLOW_ROLE_LABEL[z.role]), {
      layerName: `${FLOW_ROLE_LABEL[z.role]} · ${z.renderedCount}/${z.count}`,
      layerColor: z.color,
      layerOrder: FLOW_ROLE_ORDER.indexOf(z.role),
      fileCount: z.count,
      description: FLOW_ROLE_HINT[z.role],
      portraitMode: "dataFlow",
    });
  }

  let placedCount = 0;
  for (const n of layout.nodes) {
    // 尺寸随 place 第 5 参落库（原 place 后 setState 设尺寸已失效）
    const id = place(
      "function",
      { x: n.x, y: n.y },
      n.name,
      {
        name: n.name,
        symbolKind: "function",
        fileId: n.fileId,
        filePath: n.filePath,
        lineStart: n.line,
        params: n.paramCount,
        // 复用 FunctionRenderer 的等级配色：汇点红 / 透传橙 / 阻断绿
        level: FLOW_ROLE_LEVEL[n.role],
        levelLabel: FLOW_ROLE_LABEL[n.role],
        flowRole: n.role,
        flowSinks: n.sinks,
        flowToReturn: n.toReturn,
        flowCallCount: n.callFlowCount,
        reasons: n.reasons,
        signature: n.signature,
        portraitMode: "dataFlow",
      },
      { w: n.width, h: n.height }
    );
    if (!id) continue;
    placedCount += 1;
  }

  await persist(analysisId, "dataFlow");

  const s = layout.summary;
  const ratio = Math.round(s.blockRatio * 100);
  return {
    ok: true,
    message: t("portrait.msg.flowDone", {
      summary: summarizeFlowPortrait(layout),
      ratio,
      note: ratio >= 30 ? t("portrait.msg.flowPrune") : "",
    }),
    severity: s.sinks > 0 ? "success" : "info",
    placed: placedCount,
  };
}

/** 统一入口 */
export async function runPortrait(
  kind: PortraitKind,
  analysisId: string,
  filter?: { query?: string; kinds?: string[]; focusFileId?: string },
  projectRoot?: string | null,
  options?: {
    forceRedetect?: boolean;
    nameFilter?: string;
    apiTraceView?: "all" | "orphan" | "dead";
    taintView?: TaintView;
  }
): Promise<PortraitOutcome> {
  if (!analysisId) {
    return { ok: false, message: t("portrait.msg.noAnalysis"), severity: "warning", placed: 0 };
  }
  const editor = useEditorStore.getState();
  // v2.17 依赖画像焦点子图：把焦点文件落到会话态，工具条「总览」可一键复位；
  // 非依赖画像不触碰该状态，避免污染其它画像。
  if (kind === "dependency") {
    editor.setDepFocusFileId(filter?.focusFileId ?? null);
  }
  editor.beginBatch();
  _pending = [];
  try {
    switch (kind) {
    case "callGraph":
      return runCallGraphPortrait(analysisId, false);
    case "callGraph_redetect":
      // 菜单「调用链（重新分析）」：强制对源码重跑调用图分析并刷新画像。
      return runCallGraphPortrait(analysisId, true);
    case "executionFlow":
      return runExecutionFlowPortrait(analysisId);
    case "apiTrace":
      return runApiTracePortrait(analysisId, options?.apiTraceView ?? "all");
    case "taintFlow":
      return runTaintFlowPortrait(analysisId, options?.taintView ?? "all");
    case "architecture":
      return runArchitecturePortrait(analysisId);
    case "dependency":
      return runDependencyPortrait(analysisId, filter?.focusFileId);
    case "layering":
      return runLayeringPortrait(analysisId);
    case "coupling":
      return runCouplingPortrait(analysisId);
    case "changeCoupling": {
      // v2.18：与 dep 入口同形态——把焦点文件落会话态，避免下次切到 dep 时残留
      const focusId = filter?.focusFileId ?? null;
      useEditorStore.getState().setCouplingFocusFileId(focusId);
      return runChangeCouplingPortrait(analysisId, {
        filter: undefined, // filter 走 store.couplingFilter（前端切片，UI 切换即生效）
        windowDays: undefined, // windowDays 走 store.couplingWindowDays（UI 切时窗已先触发 invoke 重扫落库）
        focusFileId: focusId,
      });
    }
    case "quadrant":
      return runQuadrantPortrait(analysisId, projectRoot, options?.forceRedetect, options?.nameFilter);
    case "directory":
      return runDirectoryPortrait(analysisId);
    case "moduleGraph":
      return runModuleGraphPortrait(analysisId);
    case "patterns":
      return runPatternsPortrait(analysisId, projectRoot, options?.forceRedetect);
    case "patterns_redetect":
      // 菜单「设计模式（重新检测）」：强制对源码重跑引擎并刷新画像。
      return runPatternsPortrait(analysisId, projectRoot, true);
    case "symbols":
      return runSymbolsPortrait(analysisId, filter);
    case "hotspotFunctions":
      return runFunctionHotspotPortrait(analysisId);
    case "hotspotFunctions_redetect":
      return runFunctionHotspotPortrait(analysisId, true);
    case "dataFlow":
      return runDataFlowPortrait(analysisId, false);
    case "dataFlow_redetect":
      // 菜单「数据流（重新分析）」：强制对源码重跑 dataFlow 分析并刷新画像。
      return runDataFlowPortrait(analysisId, true);
    case "testCoverage":
      return runTestCoveragePortrait(analysisId);
    case "busFactor":
      return runBusFactorPortrait(analysisId);
    case "ripple":
      return runRipplePortrait(analysisId);
    case "docsCoverage":
      return runDocsCoveragePortrait(analysisId);
    case "security":
      return runSecurityPortrait(analysisId);
    case "apiSurface":
      return runApiSurfacePortrait(analysisId);
    case "errorHandling":
      return runErrorHandlingPortrait(analysisId);
    case "logging":
      return runLoggingPortrait(analysisId);
    case "commentRatio":
      return runCommentRatioPortrait(analysisId);
    default:
      // 其余未识别 kind 兜底到网格画像（impact 是定向画像，不在此路径）
      return runGridPortrait(kind as GridPortraitKind, analysisId);
    }
  } finally {
    editor.endBatch();
  }
}

/**
 * 视角模板 → 画像动作映射
 *
 * 需求「视角模板」原本只创建一个空视图，用户还得自己再点一次画像按钮 ——
 * 模板名字都叫「复杂度热力」了，创建完却是空白画布，这是断链。
 * 这里把模板 type 直接绑定到画像，创建即出图。
 */
export const VIEW_TEMPLATE_PORTRAIT: Record<string, PortraitKind> = {
  // ── 各 analyzer 插件实际注册的模板 type（必须全覆盖，否则新建视角=空白画布）──
  architecture: "architecture", // TS / Rust / Python：架构总览
  dependency: "dependency", // TS / Rust / Python：依赖关系图
  layering: "layering", // TS / Rust / Python：分层视图
  complexity: "complexity", // TS / Rust / Python：复杂度热力
  "unsafe-risk": "risk", // Rust：unsafe / 风险聚焦
  "call-graph": "callGraph", // Python：函数调用图
  // ── 常见别名（模板 type 命名风格不统一时的兜底）──
  directory: "directory", // 目录结构（缩进冰柱图）
  "directory-tree": "directory",
  "file-tree": "directory",
  structure: "directory",
  coupling: "coupling", // 主序图（抽象度 × 不稳定性）
  "change-coupling": "changeCoupling", // 变更耦合（总是一起改的文件对 / 隐性耦合）
  "temporal-coupling": "changeCoupling",
  "hidden-coupling": "changeCoupling",
  "co-change": "changeCoupling",
  "complexity-heatmap": "complexity",
  "dependency-graph": "dependency",
  layers: "layering",
  risk: "risk",
  "tech-debt": "techDebt",
  churn: "churn",
  "dead-code": "deadCode",
  "main-sequence": "coupling",
  duplication: "duplication",
  "code-clone": "duplication",
  clone: "duplication",
  "duplicate-code": "duplication",
  patterns: "patterns", // 设计模式画像（代码用了哪些模式）
  "design-patterns": "patterns",
  pattern: "patterns",
  gof: "patterns",
  symbols: "symbols", // 代码结构画像（class/function/interface 符号级实体）
  "code-structure": "symbols",
  "symbol-structure": "symbols",
  "hotspot-functions": "hotspotFunctions", // 函数热点（AST 逐函数风险排序）
  "function-hotspot": "hotspotFunctions",
  "function-complexity": "hotspotFunctions",
  "hot-functions": "hotspotFunctions",
  "data-flow": "dataFlow", // 数据流（污点角色三区：汇点/透传/阻断）
  dataflow: "dataFlow",
  "def-use": "dataFlow",
  // v2.25 修正：此前 taint 别名被映射到 dataFlow（那时根本没有污点分析，属命名误导）。
  // 真实污点传播路径画像落地后，这些别名改指 taintFlow —— 语义对齐，不再骗用户。
  taint: "taintFlow",
  "taint-flow": "taintFlow",
  "taint-analysis": "taintFlow",
  "source-sink": "taintFlow",
};

/** 按视角模板 type 找到对应画像（找不到返回 null） */
export function portraitForTemplate(type: string | undefined | null): PortraitKind | null {
  if (!type) return null;
  return VIEW_TEMPLATE_PORTRAIT[type.toLowerCase()] ?? null;
}

/* ============================================================================
 * 新增画像：测试覆盖 / 安全 / 接口暴露面 / 责任人(bus-factor) / 涟漪影响面 /
 * 文档覆盖 / 错误处理
 *
 * 设计约定（与既有画像一致，避免重蹈 O(N²) 覆辙）：
 * - 一律先算出 rows，再一次性 addComponentsBulk 落库（不在循环里 addComponent）。
 * - 每个实体通过 fileConfig 的 extra 注入 accentColor / metricBadge / metricTitle，
 *   由 FileRenderer 统一据此精准着色与标注，不新增渲染器分支。
 * - 源码扫描类画像（安全 / 接口 / 错误处理）用 readSourceFile 按需读行，
 *   受并发上限保护，避免一次性把几百个文件内容灌进主线程。
 * ========================================================================== */

const TEST_RE = /\b(__tests__|tests?|spec|__mocks__)\b|[-_.](test|spec)\.|(?:^|[/_])(?:test|spec)_/i;
const CODE_LANGS = new Set([
  "typescript", "javascript", "tsx", "jsx", "python", "rust", "go", "java",
  "csharp", "cpp", "c", "ruby", "php", "swift", "kotlin", "dart", "scala",
  "html", "vue", "svelte", "sql",
]);

interface MetricRow {
  file: ProjectFile;
  ins: FileInsight;
  accentColor: string;
  metricBadge: string;
  metricTitle: string;
}

/** 取文件洞察，并把复杂度清零，避免复杂度色条盖掉新画像的 accent 色条 */
function metricInsight(f: ProjectFile, insights: Map<string, FileInsight>): FileInsight {
  const base = insights.get(f.id) ?? emptyFileInsight();
  const ins = { ...base } as FileInsight;
  ins.complexity = 0;
  return ins;
}

/** 通用网格式画像渲染：rows → 一次性 bulk 落库 → 持久化 + 自适应视口 */
async function renderMetricPortrait(
  kind: PortraitKind,
  analysisId: string,
  rows: MetricRow[],
  opts: {
    cols: number;
    colW: number;
    rowH: number;
    emptyHint: string;
    summarize: (rows: MetricRow[]) => string;
  }
): Promise<PortraitOutcome> {
  if (rows.length === 0) {
    return { ok: false, message: opts.emptyHint, severity: "info", placed: 0 };
  }
  const items: BulkComponentInput[] = rows.map((r, i) => {
    const col = i % opts.cols;
    const row = Math.floor(i / opts.cols);
    return {
      type: "file",
      name: r.file.name,
      x: 40 + col * opts.colW,
      y: 40 + row * opts.rowH,
      config: fileConfig(r.file, r.ins, kind, {
        accentColor: r.accentColor,
        metricBadge: r.metricBadge,
        metricTitle: r.metricTitle,
        rank: i + 1,
      }),
    };
  });
  useEditorStore.setState((s: any) => {
    s.components = [];
  });
  const ids = useEditorStore.getState().addComponentsBulk(items);
  await persist(analysisId, kind);
  return { ok: true, message: opts.summarize(rows), severity: "success", placed: ids.length };
}

function isTestFile(f: ProjectFile): boolean {
  return TEST_RE.test(f.relPath) || TEST_RE.test(f.name);
}
function moduleOf(relPath: string): string {
  const i = relPath.indexOf("/");
  return i > 0 ? relPath.slice(0, i) : "(root)";
}

/**
 * Candidate relative paths (lowercased) of a test file that would "pair" with
 * the given source file. File-level pairing instead of the old top-dir proxy so
 * one test file no longer greens an entire directory.
 */
function pairedTestPaths(srcRel: string): string[] {
  const idx = srcRel.lastIndexOf("/");
  const dir = idx > 0 ? srcRel.slice(0, idx) : "";
  const base = idx > 0 ? srcRel.slice(idx + 1) : srcRel;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot) : "";
  const name = dot >= 0 ? base.slice(0, dot) : base;
  const cands: string[] = [];
  const push = (p: string) => {
    if (p) cands.push(p.toLowerCase());
  };
  if (dir) {
    push(`${dir}/${name}.test${ext}`);
    push(`${dir}/${name}.spec${ext}`);
    push(`${dir}/${name}.e2e${ext}`);
    push(`${dir}/__tests__/${name}${ext}`);
    push(`${dir}/__tests__/${name}.test${ext}`);
  }
  push(`test/${name}.test${ext}`);
  push(`tests/${name}.test${ext}`);
  push(`__tests__/${name}${ext}`);
  const mirrorTest = dir.replace(/^src\//i, "test/");
  const mirrorTests = dir.replace(/^src\//i, "tests/");
  if (mirrorTest !== dir) {
    push(`${mirrorTest}/${name}.test${ext}`);
    push(`${mirrorTest}/${name}.spec${ext}`);
  }
  if (mirrorTests !== dir) {
    push(`${mirrorTests}/${name}.test${ext}`);
    push(`${mirrorTests}/${name}.spec${ext}`);
  }
  return cands;
}

/** 测试配对画像：按文件配对判断源文件是否有同名测试（*.test/*.spec），红=无配对测试保护（非行级覆盖率） */
async function runTestCoveragePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const files = pst.files.filter((f) => !f.isDirectory);
  if (files.length === 0) {
    return { ok: false, message: t("portrait.spec.testCoverage.empty"), severity: "info", placed: 0 };
  }
  const testFiles = files.filter(isTestFile);
  const testSet = new Set(testFiles.map((tf) => tf.relPath.toLowerCase()));
  const rows: MetricRow[] = files
    .filter((f) => !isTestFile(f))
    .map((f) => {
      const hasTest = pairedTestPaths(f.relPath).some((c) => testSet.has(c));
      return {
        file: f,
        ins: (() => {
          const c = emptyFileInsight();
          c.complexity = 0;
          return c;
        })(),
        accentColor: hasTest ? "#22c55e" : "#ef4444",
        metricBadge: hasTest ? t("portrait.metric.testPaired") : t("portrait.metric.testUnpaired"),
        metricTitle: hasTest
          ? t("portrait.metric.testPairedTitle", { name: f.name })
          : t("portrait.metric.testUnpairedTitle", { name: f.name }),
      };
    })
    .sort((a, b) =>
      a.accentColor === b.accentColor
        ? b.file.lineCount - a.file.lineCount
        : a.accentColor === "#ef4444"
        ? -1
        : 1
    );
  return renderMetricPortrait("testCoverage", analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t("portrait.spec.testCoverage.empty"),
    summarize: (rs) => {
      const untested = rs.filter((r) => r.accentColor === "#ef4444").length;
      const tested = rs.length - untested;
      const pct = rs.length ? Math.round((tested / rs.length) * 100) : 0;
      return t("portrait.spec.testCoverage.done", { n: rs.length, tested, untested, pct });
    },
  });
}

/** 责任人 / bus-factor 画像：用 git 贡献者数做知识集中度代理（单人=孤岛风险） */
async function runBusFactorPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const rows: MetricRow[] = pst.files
    .filter((f) => !f.isDirectory)
    .map((f) => {
      const ins = metricInsight(f, insights);
      const authors = ins.authorCount;
      const color = authors <= 1 ? "#ef4444" : authors === 2 ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins,
        accentColor: color,
        metricBadge: `👥${authors}`,
        metricTitle: t("portrait.metric.busFactor", {
          n: authors,
          note: authors <= 1 ? t("portrait.metric.busSolo") : authors === 2 ? t("portrait.metric.busTwo") : "",
        }),
      };
    })
    .filter((r) => r.ins.authorCount > 0)
    .sort((a, b) => a.ins.authorCount - b.ins.authorCount);
  return renderMetricPortrait("busFactor", analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t("portrait.spec.busFactor.empty"),
    summarize: (rs) => {
      const solo = rs.filter((r) => r.ins.authorCount <= 1).length;
      return t("portrait.spec.busFactor.done", { n: rs.length, solo });
    },
  });
}

/** 涟漪 / 影响面画像：用调用入度（fan-in）衡量「改它会影响多少处」 */
async function runRipplePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const rows: MetricRow[] = pst.files
    .filter((f) => !f.isDirectory)
    .map((f) => {
      const ins = metricInsight(f, insights);
      const fanIn = ins.callIn;
      const color = fanIn >= PORTRAIT_THRESHOLDS.ripple.red ? "#ef4444" : fanIn >= PORTRAIT_THRESHOLDS.ripple.orange ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins,
        accentColor: color,
        metricBadge: `↓${fanIn}`,
        metricTitle: t("portrait.metric.ripple", { n: fanIn }),
      };
    })
    .filter((r) => r.ins.callIn > 0)
    .sort((a, b) => b.ins.callIn - a.ins.callIn);
  return renderMetricPortrait("ripple", analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t("portrait.spec.ripple.empty"),
    summarize: (rs) => {
      const hubs = rs.filter((r) => r.ins.callIn >= PORTRAIT_THRESHOLDS.ripple.orange).length;
      return t("portrait.spec.ripple.done", { n: rs.length, hubs });
    },
  });
}

/** 文档覆盖画像：导出/公开符号中未写 doc 的比例 */
async function runDocsCoveragePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  // 诚实护栏：扫描器当前不提取符号 doc 注释（doc 字段恒为 None，见 code_structure.rs:719
  // 等三处），若整个项目没有任何符号带 doc，说明该能力未实现 —— 直接提示不可用，
  // 避免伪造"100% 未文档化"的红色卡片（审计：.workbuddy/audit-portraits-2026-08-22.md）。
  // 一旦后端实现 doc 提取（选项 A），此处自动恢复真实分析，无需再改前端。
  const docAvailable = (pst.symbols as ProjectSymbol[]).some((s) => !!s.doc);
  if (!docAvailable) {
    return { ok: false, message: t("portrait.msg.docUnavailable"), severity: "info", placed: 0 };
  }
  const exportedByFile = new Map<string, { total: number; undoc: number }>();
  for (const s of pst.symbols as ProjectSymbol[]) {
    if (!/(?:export|public)/i.test(s.modifiers || "")) continue;
    const e = exportedByFile.get(s.fileId) || { total: 0, undoc: 0 };
    e.total += 1;
    if (!s.doc) e.undoc += 1;
    exportedByFile.set(s.fileId, e);
  }
  const rows: MetricRow[] = pst.files
    .filter((f) => !f.isDirectory && exportedByFile.has(f.id))
    .map((f) => {
      const e = exportedByFile.get(f.id)!;
      const ratio = e.total > 0 ? e.undoc / e.total : 0;
      const color = ratio >= 0.5 ? "#ef4444" : ratio > 0 ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: e.undoc > 0 ? t("portrait.metric.docBadge", { n: e.undoc }) : t("portrait.metric.docOk"),
        metricTitle: t("portrait.metric.docsCoverage", { n: e.total, m: e.undoc }),
      };
    })
    .sort((a, b) => {
      const ea = exportedByFile.get(a.file.id)!;
      const eb = exportedByFile.get(b.file.id)!;
      return eb.undoc - ea.undoc || eb.total - ea.total;
    });
  return renderMetricPortrait("docsCoverage", analysisId, rows, {
    cols: 8,
    colW: 190,
    rowH: 76,
    emptyHint: t("portrait.spec.docsCoverage.empty"),
    summarize: (rs) => {
      const bad = rs.filter((r) => r.accentColor === "#ef4444").length;
      return t("portrait.spec.docsCoverage.done", { n: rs.length, bad });
    },
  });
}

/* ─── 源码扫描类画像（安全 / 接口 / 错误处理）共用 ─── */

async function readLines(f: ProjectFile): Promise<string[] | null> {
  try {
    const c: SourceFileContent = await projectScanApi.readSourceFile(f.id);
    if (c.skippedReason || c.lines.length === 0) return null;
    return c.lines;
  } catch {
    return null;
  }
}
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const SECRET_RE = [
  /password\s*[:=]\s*["'][^"'\n]{4,}/i,
  /passwd\s*[:=]\s*["'][^"'\n]{4,}/i,
  /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{12,}/i,
  /secret\s*[:=]\s*["'][^"'\n]{8,}/i,
  /token\s*[:=]\s*["'][A-Za-z0-9._-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /sk-[A-Za-z0-9]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
];
// 测试 / 示例 / 占位假密钥（sk-test-xxx、apiKey: "example"、your-key 等），不计入硬编码告警
const FAKE_SECRET_RE =
  /(?:test|example|dummy|mock|sample|fake|demo|xxxx|placeholder|your[-_]?key|your[-_]?secret|your[-_]?token)/i;
const UNSAFE_RE = [
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /\.dangerouslySetInnerHTML/,
  /innerHTML\s*=/,
  /child_process/,
  /vm\.runInThisContext/,
  /\.execSync\s*\(/,
  /require\(\s*['"]child_process['"]\s*\)/,
];

/** 安全画像：密钥硬编码 + 不安全 API 调用 */
async function runSecurityPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || "").toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const hits: string[] = [];
    let secretCount = 0;
    lines.forEach((ln, idx) => {
      let secretHit = false;
      for (const re of SECRET_RE) if (re.test(ln)) { secretHit = true; break; }
      // 测试 / 示例 / 占位假密钥不计入硬编码告警
      if (secretHit && !FAKE_SECRET_RE.test(ln)) { hits.push(t("portrait.security.secretHit", { line: idx + 1 })); secretCount += 1; }
      for (const re of UNSAFE_RE) if (re.test(ln)) { hits.push(t("portrait.security.unsafeHit", { line: idx + 1 })); break; }
    });
    if (hits.length === 0) return null;
    const secrets = secretCount;
    const unsafe = hits.length - secrets;
    const score = secrets * 3 + unsafe;
    return { f, hits, score };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; hits: string[]; score: number } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.score - a.score)
    .map(({ f, hits, score }) => {
      const color = score >= PORTRAIT_THRESHOLDS.security.red ? "#ef4444" : score >= PORTRAIT_THRESHOLDS.security.orange ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `⚠${score}`,
        metricTitle: t("portrait.metric.security", { n: score, sample: hits.slice(0, 4).join("；"), more: hits.length > 4 ? "…" : "" }),
      };
    });
  return renderMetricPortrait("security", analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t("portrait.spec.security.empty"),
    summarize: (rs) => t("portrait.spec.security.done", { n: src.length, m: rs.length }),
  });
}

// verb-call style: Express / Koa / Fastify / Hapi / Gin / Axum(.route) ...
const API_RE =
  /(?:\b(?:app|router|server|api|res|req|fastify|koa|hapi|engine|http|client|db|conn|pool|srv|web|bp|blueprint|r|e)\.(?:get|post|put|delete|patch|head|options|all|route)\s*\(\s*['"`][^'"`]+['"`])/i;
// decorator style: Spring / Nest / FastAPI(@app.route) / Flask(@router.get) ...
const API_DECORATOR =
  /@(?:Get|Post|Put|Delete|Patch|Head|Options|RequestMapping|app\.route|router\.(?:get|post|put|delete|patch)|\w+\.(?:get|post|put|delete|patch))\b[^)]*\(/;
// Next.js / Remix route handlers: `export async function GET(req)`
const API_NEXT =
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/;
// GraphQL / tRPC: type Query|Mutation, createResolver, createRouter().query((
const API_GQL_TRPC =
  /\b(?:type\s+(?:Query|Mutation)|createResolver|defineResolver|createRouter|\.query\(\s*\(|\.mutation\(\s*\()/;
// Laravel / Rails / Symfony: Route::get, resources :x, $router->get
const API_PHP_RB =
  /\b(?:Route::(?:get|post|put|delete|patch)|resources\s+:\w+|\$(?:router|app)->(?:get|post|put|delete|patch))/;

/** 接口暴露面画像：路由/handler 中的 URL 端点 */
async function runApiSurfacePortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || "").toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    let count = 0;
    const sample: string[] = [];
    for (const ln of lines) {
      const m =
        ln.match(API_RE) ||
        ln.match(API_DECORATOR) ||
        ln.match(API_NEXT) ||
        ln.match(API_GQL_TRPC) ||
        ln.match(API_PHP_RB);
      if (m) {
        count += 1;
        if (sample.length < 3) sample.push(m[0].slice(0, 40));
      }
    }
    if (count === 0) return null;
    return { f, count, sample };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; count: number; sample: string[] } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.count - a.count)
    .map(({ f, count, sample }) => {
      const color = count >= PORTRAIT_THRESHOLDS.apiSurface.red ? "#ef4444" : count >= PORTRAIT_THRESHOLDS.apiSurface.orange ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `API${count}`,
        metricTitle: t("portrait.metric.apiSurface", { n: count, sample: sample.length ? t("portrait.metric.apiSample", { s: sample.join("；") }) : "" }),
      };
    });
  return renderMetricPortrait("apiSurface", analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t("portrait.spec.apiSurface.empty"),
    summarize: (rs) => {
      const total = valid.reduce((a, b) => a + b.count, 0);
      return t("portrait.spec.apiSurface.done", { n: rs.length, total });
    },
  });
}

// 多行匹配：catch(...) { 块内仅空白/注释 = 空 catch（覆盖单行与多行块）
const EMPTY_CATCH_RE =
  /catch\s*\([^)]*\)\s*\{[ \t]*?(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|\n[ \t]*?)*?\}\s*(?=catch|finally|;|\)|\n[^\s]|$)/g;
// 多行匹配：catch 块内只做 return null/undefined / continue / console.log|debug / logger.info|debug / pass = 吞异常
const SWALLOW_RE =
  /catch\s*\([^)]*\)\s*\{[\s\S]*?\b(?:return\s+(?:null|undefined)|;\s*pass\b|continue\b|logger\.(?:debug|info)\b|console\.(?:log|debug)\b)[\s\S]*?\}\s*(?=catch|finally|;|\)|\n[^\s]|$)/g;

/**
 * 去掉源码里的注释与字符串字面量，让 catch/console/logger 等关键词只在「真实代码」上匹配，
 * 消除它们出现在注释、JSDoc、字符串字面量里造成的误报。仅用于「是否存在某模式」的计数，
 * 不改行号/结构。保护 `://`（URL 协议分隔）不被当行注释误删。
 */
function stripCommentsAndStrings(code: string): string {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];
    if (c === "/" && c2 === "/" && (i === 0 || code[i - 1] !== ":")) {
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 错误处理画像：空 catch / 吞异常 */
async function runErrorHandlingPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || "").toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const text = stripCommentsAndStrings(lines.join("\n"));
    const empty = (text.match(EMPTY_CATCH_RE) || []).length;
    const swallow = (text.match(SWALLOW_RE) || []).length;
    const total = empty + swallow;
    if (total === 0) return null;
    return { f, empty, swallow };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; empty: number; swallow: number } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.empty + b.swallow - (a.empty + a.swallow))
    .map(({ f, empty, swallow }) => {
      const total = empty + swallow;
      const color = total >= PORTRAIT_THRESHOLDS.errorHandling.red ? "#ef4444" : total >= PORTRAIT_THRESHOLDS.errorHandling.orange ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `∅${total}`,
        metricTitle: t("portrait.metric.errorHandling", { e: empty, s: swallow }),
      };
    });
  return renderMetricPortrait("errorHandling", analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t("portrait.spec.errorHandling.empty"),
    summarize: (rs) => {
      const total = valid.reduce((a, b) => a + b.empty + b.swallow, 0);
      return t("portrait.spec.errorHandling.done", { n: rs.length, total });
    },
  });
}

/* ─── 日志卫生画像（R42）：console.* 泄漏 / logger.* 吞掉 / 裸 console 调试输出 ─── */

// 生产代码里不应出现的裸 console 调试输出（保留 console.error 与注释中的示例）
export const LEAK_CONSOLE_RE =
  /\bconsole\.(?:log|debug|info|warn|trace)\s*\([^)]*\)/g;

/**
 * 统计「logger.error/fatal 被吞掉」的行数（行级启发式，比纯正则可靠）。
 * 规则：某行调用了 logger.error(...)，其后 3 行内（或到当前块结束）没有
 * throw / return / process.exit / panic! 等处理动作 → 判为吞掉错误。
 */
export function countSwallowedLoggerErrors(lines: string[]): number {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/logger\.(?:error|fatal)\s*\(/.test(lines[i])) continue;
    const lookahead = lines.slice(i + 1, i + 4).join("\n");
    const handled =
      /\b(?:throw|return|process\.exit|panic!|std::process::exit|os\.exit|abort)\b/.test(lookahead);
    if (!handled) count += 1;
  }
  return count;
}

/**
 * 日志卫生画像：console.log/debug 泄漏到生产 + logger.error 吞掉不处理。
 * 区分「日志规范性」与 errorHandling 画像 —— 后者只关注 catch 块内吞异常，
 * 这里关注**正常代码路径**里把调试输出留在生产、以及打了 error 日志却无后续动作。
 */
async function runLoggingPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || "").toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000
  );
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    // 先剥掉注释（//、块注释、JSDoc）与字符串字面量，消除它们内部出现的
    // console/logger 误报；再按行还原并跳过 # 行注释（Python/Ruby/shell）。
    // 仅用于「是否存在某模式」的计数，不改动检测语义。
    const stripped = stripCommentsAndStrings(lines.join("\n"));
    const codeLines = stripped
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    const code = codeLines.join("\n");
    const leaks = (code.match(LEAK_CONSOLE_RE) || []).length;
    const swallowed = countSwallowedLoggerErrors(codeLines);
    const total = leaks + swallowed;
    if (total === 0) return null;
    return { f, leaks, swallowed };
  });
  const valid = scanned.filter((x): x is { f: ProjectFile; leaks: number; swallowed: number } => x !== null);
  const rows: MetricRow[] = valid
    .sort((a, b) => b.leaks + b.swallowed - (a.leaks + a.swallowed))
    .map(({ f, leaks, swallowed }) => {
      const total = leaks + swallowed;
      const color = total >= PORTRAIT_THRESHOLDS.logging.red ? "#ef4444" : total >= PORTRAIT_THRESHOLDS.logging.orange ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: `◉${total}`,
        metricTitle: t("portrait.metric.logging", { l: leaks, s: swallowed }),
      };
    });
  return renderMetricPortrait("logging", analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t("portrait.spec.logging.empty"),
    summarize: (rs) => {
      const total = valid.reduce((a, b) => a + b.leaks + b.swallowed, 0);
      return t("portrait.spec.logging.done", { n: rs.length, total });
    },
  });
}

/**
 * 注释占比画像：注释率（基于 metrics.commentLines/codeLines，数据已就绪）
 * + 注释掉的死代码（扫描源码：// 与块注释里像代码的行）。
 *
 * 注释掉的死代码是「不敢删的历史遗留」信号——比缺注释更糟：
 * 它既占阅读负担，又暗示作者对删除没有把握。阈值：≥5 行红 / ≥2 行橙。
 */

/** 注释块里的代码特征行（去掉注释前缀后仍像可执行代码） */
const COMMENTED_CODE_RE =
  /^\s*\/\/\s*(?:\b(?:if|for|while|switch|return|throw|const|let|var|function|async|await|try|catch|new|import|export|case|break|continue)\b|.*[;{}]\s*$)/;

function countCommentedCode(lines: string[]): number {
  let count = 0;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith("//")) continue;
    const body = t.replace(/^\/\/\s*/, "");
    // 忽略文档型注释（todo/fixme 说明、中文说明、纯符号分隔）
    if (/^(todo|fixme|hack|note|see|example|deprecated|@\w+)/i.test(body)) continue;
    if (/[\u4e00-\u9fff]/.test(body) && !/[;{}]/.test(body)) continue;
    if (COMMENTED_CODE_RE.test(t)) count += 1;
  }
  return count;
}

/** 注释掉的死代码（导出供测试） */
export { countCommentedCode };

async function runCommentRatioPortrait(analysisId: string): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const insights = currentInsights();
  const metrics = pst.metrics.filter((m) => {
    const f = pst.files.find((x) => x.id === m.fileId);
    return f && !f.isDirectory && (m.codeLines + m.commentLines) > 0;
  });
  // 需要读源码的文件（可能有注释掉的代码）：全部 code 文件，受并发上限保护
  const src = pst.files.filter(
    (f) => !f.isDirectory && CODE_LANGS.has((f.language || "").toLowerCase()) && f.lineCount > 0 && f.lineCount <= 6000
  );
  const commentedByFile = new Map<string, number>();
  const scanned = await mapLimit(src, 16, async (f) => {
    const lines = await readLines(f);
    if (!lines) return null;
    const n = countCommentedCode(lines);
    if (n === 0) return null;
    commentedByFile.set(f.id, n);
    return null;
  });
  void scanned;

  const rows: MetricRow[] = metrics
    .map((m) => {
      const f = pst.files.find((x) => x.id === m.fileId)!;
      const total = m.codeLines + m.commentLines;
      const ratio = total > 0 ? Math.round((m.commentLines / total) * 100) : 0;
      const commented = commentedByFile.get(f.id) ?? 0;
      // 双信号：注释率 <5% 或注释掉的代码 ≥2 行即需关注
      const red = ratio < 5 || commented >= 5;
      const orange = !red && (ratio < 15 || commented >= 2);
      const color = red ? "#ef4444" : orange ? "#f59e0b" : "#22c55e";
      return {
        file: f,
        ins: metricInsight(f, insights),
        accentColor: color,
        metricBadge: ratio + "%" + (commented > 0 ? t("trend.metric.blockedSuffix", { n: commented }) : ""),
        metricTitle:
          commented > 0
            ? t("portrait.metric.commentRatioWithBlocked", { pct: ratio, c: m.commentLines, t: total, n: commented })
            : t("portrait.metric.commentRatio", { pct: ratio, c: m.commentLines, t: total }),
      };
    })
    .filter((r) => r.accentColor !== "#22c55e") // 只列出需要关注的文件
    .sort((a, b) => {
      const ra = (a.file as ProjectFile).lineCount;
      const rb = (b.file as ProjectFile).lineCount;
      return rb - ra;
    });
  return renderMetricPortrait("commentRatio", analysisId, rows, {
    cols: 8,
    colW: 200,
    rowH: 78,
    emptyHint: t("portrait.spec.commentRatio.empty"),
    summarize: (rs) => {
      const bad = rs.filter((r) => r.accentColor === "#ef4444").length;
      const blocked = rs.filter((r) => (r.metricBadge || "").includes("块")).length;
      return t("portrait.spec.commentRatio.done2", { n: rs.length, bad, blocked });
    },
  });
}

/**
 * v2.12 旧版符号画像横带检测：旧版（2026-08-19 前）layer-marker 的 layerName 是
 * `目录 src-tauri/src/app · 40/135 符号` / `licensing.ts · 3/3 符号`（`a/b 符号` 旧模板），
 * 且 place 未传 size → 实体以注册默认 300×40 落库，横带与下一行内容重叠。
 * 新代码输出 `symBandSub`（`{path} · {b} 符号 · 画布 {a}`）副行 + 精确尺寸，不含 `/` 分隔。
 * 命中旧格式 → 提示/触发一次自动重建（新布局）。
 */
export function hasLegacySymbolBands(
  components: { type?: string; config?: Record<string, unknown> }[]
): boolean {
  return components.some(
    (c) =>
      c.type === "layer-marker" &&
      typeof c.config?.layerName === "string" &&
      /\d+\/\d+\s*符号/.test(c.config.layerName as string)
  );
}
