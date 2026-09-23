// sight-folio: 插件规则执行引擎（前端）
//
// 背景：需求文档 §4.4 RuleRegistry 要求插件声明审查规则，但此前这些规则只是
// 装饰性声明 —— 后端 review.rs 跑的是自己硬编码的规则，插件规则从未真正执行过，
// 「插件是死的」根源之一就在这里。本引擎把插件的 RuleRegistration 变成可执行的
// 检查：**用已扫描的真实数据**（文件度量/模块依赖/分层/死符号/审查发现）逐条
// 判定违规，产出每条规则的违规清单与摘要。
//
// 口径约定（与 portraits.ts / architectureMetrics.ts 一致）：
// - 复杂度：FileMetric.cyclomaticComplexity > 10 违规
// - 耦合：模块入度+出度 > 12 违规
// - 分层：sortOrder 小=上层；fromOrder > toOrder = 下层反向依赖上层 = 违规
// - 未使用：deadSymbols 按文件计数
// - 循环/unsafe 等后端可执行规则：优先取 ReviewFinding.ruleId 精确命中
// - 魔法数字 / 深层嵌套 / 超长函数 / 参数过多：R31 起由 tree-sitter AST 度量真实执行
//   （FileMetric.engine === "ast" 的文件才有这些数据；全为 heuristic 时诚实标 unsupported）
// - 命名规范类规则：仍无数据支撑，保持 unsupported，不假装执行
//
// 纯函数、无副作用，便于单测与在 PluginSelector 菜单中实时计算。

import type { AnalyzerManifest, RuleRegistration } from "../analyzer/types";
import { L } from "../../ai/aiLang";
import {
  parseFileMetricMeta,
  type DeadSymbol,
  type FileMetric,
  type ProjectDependency,
  type ProjectFile,
  type ProjectLayer,
  type ProjectModule,
  type ReviewFinding,
} from "../../services/tauri";

/** 规则引擎的输入：全部来自 projectStore 已扫描数据，零新增后端成本 */
export interface RuleEngineData {
  files: ProjectFile[];
  fileMetrics: FileMetric[];
  modules: ProjectModule[];
  deps: ProjectDependency[];
  layers: ProjectLayer[];
  deadSymbols: DeadSymbol[];
  findings: ReviewFinding[];
}

/** 一条违规：目标 + 度量值 + 人话说明 */
export interface RuleViolation {
  /** 违规目标名（文件路径 / 模块名 / 符号名） */
  target: string;
  /** 目标 id（文件 id / 模块 id / 符号 id），可用于画布定位 */
  targetId: string;
  /** 度量值 */
  value: number;
  /** 阈值（0 表示非数值类违规） */
  threshold: number;
  /** 判定依据的人话 */
  detail: string;
}

/** 一条规则的执行结果 */
export interface PluginRuleEval {
  rule: RuleRegistration;
  /** 是否有执行该规则所需的数据 */
  supported: boolean;
  /** 不支持的原因（如「魔法数字需源码级 AST 解析」） */
  unsupportedReason?: string;
  violations: RuleViolation[];
}

/** 插件全部规则的执行摘要 */
export interface RuleEvalSummary {
  total: number;
  executed: number;
  unsupported: number;
  /** 违规总数（含多条规则） */
  violationCount: number;
  /** 存在违规的规则数 */
  failingRules: number;
}

// ───────────────────────── 阈值常量（与插件声明/后端 seed 对齐）─────────────────────────

export const RULE_THRESHOLDS = {
  /** 圈复杂度告警阈值 */
  complexity: 10,
  /** 模块耦合度（入+出）告警阈值 */
  coupling: 12,
  /** 控制流嵌套深度告警阈值（AST）：超过 4 层的代码几乎无法在脑子里跑完 */
  nesting: 4,
  /** 单函数行数告警阈值（AST） */
  functionLines: 80,
  /** 单函数形参个数告警阈值（AST） */
  params: 5,
} as const;

// ───────────────────────── 判定函数 ─────────────────────────

function ruleIdOf(r: RuleRegistration): string {
  return r.id.toLowerCase();
}

function isComplexityRule(r: RuleRegistration): boolean {
  const id = ruleIdOf(r);
  return id.includes("complexity") || r.category === "complexity";
}

function isCouplingRule(r: RuleRegistration): boolean {
  const id = ruleIdOf(r);
  return id.includes("coupling") || r.category === "coupling";
}

function isLayeringRule(r: RuleRegistration): boolean {
  const id = ruleIdOf(r);
  return id.includes("layering") || r.category === "layering";
}

function isUnusedRule(r: RuleRegistration): boolean {
  const id = ruleIdOf(r);
  return id.includes("unused");
}

function isCycleRule(r: RuleRegistration): boolean {
  const id = ruleIdOf(r);
  return id.includes("cycle") || id.includes("circular");
}

function isUnsafeRule(r: RuleRegistration): boolean {
  return ruleIdOf(r).includes("unsafe");
}

/** 魔法数字规则（R31 起由 AST 度量真实执行） */
function isMagicNumberRule(r: RuleRegistration): boolean {
  const id = ruleIdOf(r);
  return id.includes("magic") || id.includes("constant");
}

/** 深层嵌套规则（AST） */
function isNestingRule(r: RuleRegistration): boolean {
  return ruleIdOf(r).includes("nesting");
}

/** 超长函数规则（AST） */
function isLongFunctionRule(r: RuleRegistration): boolean {
  const id = ruleIdOf(r);
  return id.includes("long-function") || id.includes("long-fn") || id.includes("god-function");
}

/** 参数过多规则（AST） */
function isParamRule(r: RuleRegistration): boolean {
  return ruleIdOf(r).includes("param");
}

/** 仍然无数据支撑的规则（命名规范需要词法+约定库，本轮不假装能做） */
function isStillUnsupportedRule(r: RuleRegistration): boolean {
  return ruleIdOf(r).includes("naming");
}

/** 是否存在 AST 精确度量的文件（决定 AST 类规则能否执行） */
function hasAstMetrics(data: RuleEngineData): boolean {
  return data.fileMetrics.some((m) => m.engine === "ast");
}

// ───────────────────────── 各维度判定 ─────────────────────────

function evalComplexity(data: RuleEngineData): RuleViolation[] {
  const threshold = RULE_THRESHOLDS.complexity;
  const out: RuleViolation[] = [];
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  for (const m of data.fileMetrics) {
    if (m.cyclomaticComplexity > threshold) {
      const f = fileById.get(m.fileId);
      // AST 度量能指到具体函数：「文件 CC 高」常常只是文件长，
      // 「某个函数 CC 高」才是真的难维护，能说清就别含糊。
      const hot =
        m.engine === "ast" && m.hotFunction
          ? L(`，最复杂函数 ${m.hotFunction}()（CC ${m.maxFunctionCc}）`, `, hottest function ${m.hotFunction}() (CC ${m.maxFunctionCc})`)
          : "";
      out.push({
        target: f ? f.relPath : m.filePath,
        targetId: m.fileId,
        value: m.cyclomaticComplexity,
        threshold,
        detail: L(`圈复杂度 ${m.cyclomaticComplexity}（${m.complexityLevel}）超过阈值 ${threshold}${hot}`, `Cyclomatic complexity ${m.cyclomaticComplexity} (${m.complexityLevel}) exceeds threshold ${threshold}${hot}`),
      });
    }
  }
  return out.sort((a, b) => b.value - a.value);
}

/** 魔法数字：AST 在比较上下文中抓到的裸数字（`if (retry > 37)`） */
function evalMagicNumbers(data: RuleEngineData): RuleViolation[] {
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  const out: RuleViolation[] = [];
  for (const m of data.fileMetrics) {
    if (m.engine !== "ast" || m.magicNumberCount <= 0) continue;
    const meta = parseFileMetricMeta(m);
    const nums = meta.magicNumbers ?? [];
    const sample = nums
      .slice(0, 4)
      .map((n) => `${n.value}@L${n.line}`)
      .join("、");
    out.push({
      target: fileById.get(m.fileId)?.relPath ?? m.filePath,
      targetId: m.fileId,
      value: m.magicNumberCount,
      threshold: 0,
      detail: L(
        `${m.magicNumberCount} 处比较用裸数字${sample ? `：${sample}` : ""}${nums.length > 4 ? " 等" : ""}`,
        `${m.magicNumberCount} comparison(s) use bare numbers${sample ? `: ${sample}` : ""}${nums.length > 4 ? " etc." : ""}`,
      ),
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** 深层嵌套：AST 统计的最大控制流嵌套深度 */
function evalNesting(data: RuleEngineData): RuleViolation[] {
  const threshold = RULE_THRESHOLDS.nesting;
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  const out: RuleViolation[] = [];
  for (const m of data.fileMetrics) {
    if (m.engine !== "ast" || m.maxNesting <= threshold) continue;
    const meta = parseFileMetricMeta(m);
    const worst = (meta.functions ?? [])
      .slice()
      .sort((a, b) => b.maxNesting - a.maxNesting)[0];
    out.push({
      target: fileById.get(m.fileId)?.relPath ?? m.filePath,
      targetId: m.fileId,
      value: m.maxNesting,
      threshold,
      detail: L(
        `最大嵌套 ${m.maxNesting} 层超过阈值 ${threshold}${worst ? `，最深处在 ${worst.name}()（L${worst.line}）` : ""}`,
        `Max nesting ${m.maxNesting} levels exceeds threshold ${threshold}${worst ? `; deepest at ${worst.name}() (L${worst.line})` : ""}`,
      ),
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** 超长函数：AST 函数明细中行数超阈值的函数 */
function evalLongFunctions(data: RuleEngineData): RuleViolation[] {
  const threshold = RULE_THRESHOLDS.functionLines;
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  const out: RuleViolation[] = [];
  for (const m of data.fileMetrics) {
    if (m.engine !== "ast") continue;
    const meta = parseFileMetricMeta(m);
    const longs = (meta.functions ?? []).filter((f) => f.lines > threshold);
    if (longs.length === 0) continue;
    const worst = longs.slice().sort((a, b) => b.lines - a.lines)[0];
    out.push({
      target: fileById.get(m.fileId)?.relPath ?? m.filePath,
      targetId: m.fileId,
      value: worst.lines,
      threshold,
      detail: L(`${longs.length} 个函数超过 ${threshold} 行，最长 ${worst.name}() ${worst.lines} 行（L${worst.line}）`, `${longs.length} function(s) exceed ${threshold} lines; longest ${worst.name}() ${worst.lines} lines (L${worst.line})`),
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** 参数过多：AST 函数明细中形参数超阈值的函数 */
function evalManyParams(data: RuleEngineData): RuleViolation[] {
  const threshold = RULE_THRESHOLDS.params;
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  const out: RuleViolation[] = [];
  for (const m of data.fileMetrics) {
    if (m.engine !== "ast") continue;
    const meta = parseFileMetricMeta(m);
    const heavy = (meta.functions ?? []).filter((f) => f.params > threshold);
    if (heavy.length === 0) continue;
    const worst = heavy.slice().sort((a, b) => b.params - a.params)[0];
    out.push({
      target: fileById.get(m.fileId)?.relPath ?? m.filePath,
      targetId: m.fileId,
      value: worst.params,
      threshold,
      detail: L(`${heavy.length} 个函数形参超过 ${threshold} 个，最多 ${worst.name}() ${worst.params} 个（L${worst.line}）`, `${heavy.length} function(s) exceed ${threshold} params; most ${worst.name}() ${worst.params} (L${worst.line})`),
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

function evalCoupling(data: RuleEngineData): RuleViolation[] {
  const threshold = RULE_THRESHOLDS.coupling;
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const d of data.deps) {
    if (d.fromType === "module") outDeg.set(d.fromId, (outDeg.get(d.fromId) || 0) + 1);
    if (d.toType === "module") inDeg.set(d.toId, (inDeg.get(d.toId) || 0) + 1);
  }
  const violations: RuleViolation[] = [];
  for (const mod of data.modules) {
    const deg = (inDeg.get(mod.id) || 0) + (outDeg.get(mod.id) || 0);
    if (deg > threshold) {
      violations.push({
        target: mod.name,
        targetId: mod.id,
        value: deg,
        threshold,
        detail: L(`模块耦合度 ${deg}（入 ${inDeg.get(mod.id) || 0} / 出 ${outDeg.get(mod.id) || 0}）超过阈值 ${threshold}`, `Module coupling ${deg} (in ${inDeg.get(mod.id) || 0} / out ${outDeg.get(mod.id) || 0}) exceeds threshold ${threshold}`),
      });
    }
  }
  return violations.sort((a, b) => b.value - a.value);
}

function evalLayering(data: RuleEngineData): RuleViolation[] {
  if (data.layers.length === 0) return [];
  const orderOf = new Map(data.layers.map((l, i) => [l.id, i]));
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const violations: RuleViolation[] = [];
  for (const d of data.deps) {
    const from = fileById.get(d.fromId);
    const to = fileById.get(d.toId);
    if (!from || !to) continue;
    const fo = from.layerId ? orderOf.get(from.layerId) : undefined;
    const toIdx = to.layerId ? orderOf.get(to.layerId) : undefined;
    if (fo === undefined || toIdx === undefined || fo === toIdx) continue;
    if (fo <= toIdx) continue; // 上层依赖下层 = 合法
    const key = `${d.fromId}->${d.toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      target: from.relPath,
      targetId: d.fromId,
      value: fo,
      threshold: toIdx,
      detail: L(`下层「${from.relPath}」反向依赖上层「${to.relPath}」`, `Lower layer "${from.relPath}" reverse-depends on upper layer "${to.relPath}"`),
    });
  }
  return violations;
}

function evalUnused(data: RuleEngineData): RuleViolation[] {
  const byFile = new Map<string, DeadSymbol[]>();
  for (const s of data.deadSymbols) {
    const list = byFile.get(s.fileId) ?? [];
    list.push(s);
    byFile.set(s.fileId, list);
  }
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  const violations: RuleViolation[] = [];
  for (const [fileId, list] of byFile) {
    const f = fileById.get(fileId);
    violations.push({
      target: f ? f.relPath : list[0].filePath,
      targetId: fileId,
      value: list.length,
      threshold: 0,
      detail: L(
        `${list.length} 个符号零引用：${list.slice(0, 4).map((s) => s.name).join("、")}${list.length > 4 ? " 等" : ""}`,
        `${list.length} symbol(s) with zero references: ${list.slice(0, 4).map((s) => s.name).join(", ")}${list.length > 4 ? " etc." : ""}`,
      ),
    });
  }
  return violations.sort((a, b) => b.value - a.value);
}

function evalFindingsByRule(data: RuleEngineData, rule: RuleRegistration): RuleViolation[] {
  const hits = data.findings.filter(
    (f) => f.ruleId === rule.id || (f.ruleId && f.ruleId.includes(rule.id))
  );
  if (hits.length === 0) return [];
  // 按目标聚合（同一目标多条命中算一处，detail 列出计数）
  const byTarget = new Map<string, { name: string; id: string; count: number }>();
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  for (const h of hits) {
    const f = fileById.get(h.targetId);
    const name = f ? f.relPath : h.targetId;
    const cur = byTarget.get(h.targetId) ?? { name, id: h.targetId, count: 0 };
    cur.count += 1;
    byTarget.set(h.targetId, cur);
  }
  return Array.from(byTarget.values())
    .map((t) => ({
      target: t.name,
      targetId: t.id,
      value: t.count,
      threshold: 0,
      detail: L(`后端规则命中 ${t.count} 处：${hits.find((h) => h.targetId === t.id)?.message ?? ""}`, `Backend rule hit ${t.count} site(s): ${hits.find((h) => h.targetId === t.id)?.message ?? ""}`),
    }))
    .sort((a, b) => b.value - a.value);
}

/** 循环依赖：优先取后端 findings（ruleId 命中），兜底用依赖图的 isCircular 标记 */
function evalCycles(data: RuleEngineData, rule: RuleRegistration): RuleViolation[] {
  const fromFindings = evalFindingsByRule(data, rule);
  if (fromFindings.length > 0) return fromFindings;
  // 兜底：isCircular 依赖按起点聚合
  const fileById = new Map(data.files.map((f) => [f.id, f]));
  const byFrom = new Map<string, number>();
  for (const d of data.deps) {
    if (!d.isCircular) continue;
    byFrom.set(d.fromId, (byFrom.get(d.fromId) || 0) + 1);
  }
  return Array.from(byFrom.entries())
    .map(([id, count]) => ({
      target: fileById.get(id)?.relPath ?? id,
      targetId: id,
      value: count,
      threshold: 0,
      detail: L(`该文件/模块有 ${count} 条边卷入循环依赖`, `This file/module has ${count} edge(s) in a circular dependency`),
    }))
    .sort((a, b) => b.value - a.value);
}

// ───────────────────────── 主入口 ─────────────────────────

/**
 * 执行插件的全部规则，返回逐条结果。
 * 不抛异常：数据缺失的维度按「0 违规」处理，AST-only 规则标 unsupported。
 */
export function evaluatePluginRules(
  manifest: AnalyzerManifest,
  data: RuleEngineData
): PluginRuleEval[] {
  const astReady = hasAstMetrics(data);
  return manifest.rules.map((rule) => {
    if (isStillUnsupportedRule(rule)) {
      return {
        rule,
        supported: false,
        unsupportedReason: L("命名规范需要词法约定库支撑，当前不做（不假装执行）", "Naming conventions need a lexical-convention library; not implemented (we don't pretend to run it)"),
        violations: [],
      };
    }
    // AST 类规则：只有真的解析出了 AST 度量才执行，否则如实说明原因
    const needsAst =
      isMagicNumberRule(rule) || isNestingRule(rule) || isLongFunctionRule(rule) || isParamRule(rule);
    if (needsAst && !astReady) {
      return {
        rule,
        supported: false,
        unsupportedReason: L("该规则依赖 AST 度量，当前分析结果里没有 AST 精确解析的文件（语言暂无语法支持或需重新扫描）", "This rule depends on AST metrics, but no file in the current analysis has precise AST parsing (language lacks syntax support, or a re-scan is needed)"),
        violations: [],
      };
    }
    let violations: RuleViolation[];
    if (isMagicNumberRule(rule)) violations = evalMagicNumbers(data);
    else if (isNestingRule(rule)) violations = evalNesting(data);
    else if (isLongFunctionRule(rule)) violations = evalLongFunctions(data);
    else if (isParamRule(rule)) violations = evalManyParams(data);
    else if (isComplexityRule(rule)) violations = evalComplexity(data);
    else if (isCouplingRule(rule)) violations = evalCoupling(data);
    else if (isLayeringRule(rule)) violations = evalLayering(data);
    else if (isUnusedRule(rule)) violations = evalUnused(data);
    else if (isCycleRule(rule)) violations = evalCycles(data, rule);
    else if (isUnsafeRule(rule)) violations = evalFindingsByRule(data, rule);
    else violations = evalFindingsByRule(data, rule);
    return { rule, supported: true, violations };
  });
}

/** 聚合插件全部规则的执行摘要（菜单徽标/面板数字用） */
export function summarizeRuleEvals(evals: PluginRuleEval[]): RuleEvalSummary {
  const executed = evals.filter((e) => e.supported);
  const violationCount = executed.reduce((acc, e) => acc + e.violations.length, 0);
  return {
    total: evals.length,
    executed: executed.length,
    unsupported: evals.length - executed.length,
    violationCount,
    failingRules: executed.filter((e) => e.violations.length > 0).length,
  };
}
