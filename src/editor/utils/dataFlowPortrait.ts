/**
 * 数据流画像布局（Data-Flow Portrait · 纯函数）
 *
 * ── 这张图回答什么问题 ──────────────────────────────────────────────────────
 * 前面所有画像回答的都是「代码长什么样」（复杂度、耦合、模式）。
 * 这张图回答的是「**数据在代码里怎么流**」—— 也是影响链剪枝的依据可视化。
 *
 * 后端 `analyze_data_flow` 为每个函数产出一份 IFDS 风格的**函数摘要**：
 * 形参有没有流到返回值、有没有流进下游调用的实参、有没有写外部状态（sink）。
 * 把这份摘要按「污点传播中的角色」分三区铺开：
 *
 *   ┌── 汇点 sink ────┐ ┌── 透传 conduit ──┐ ┌── 阻断 blocker ──┐
 *   │ 写外部状态       │ │ 输入 → 输出       │ │ 吃进去不吐出来    │
 *   │ 数据在这里落地    │ │ 影响链一路传下去   │ │ 影响链到此为止    │
 *   │ 改这里 = 改行为   │ │ 改这里 = 波及上游  │ │ 改这里 = 局部     │
 *   └────────────────┘ └─────────────────┘ └──────────────────┘
 *
 * ── 为什么这三类值得单独画一张图 ────────────────────────────────────────────
 * 1. **sink 是审计入口**：全局变量写、字段赋值、日志/IO —— 安全审计与副作用排查
 *    第一步就是找 sink。以前用户只能全文搜 `console.` / `unsafe`，现在一屏可见。
 * 2. **conduit 是爆炸半径的高速路**：改一个透传函数，污染会顺着它一路传到上游。
 *    影响链的 N 跳传播基本都是沿着这批函数走的。
 * 3. **blocker 是安全区**：改它们的内部实现，外部调用方大概率不用回归 ——
 *    这正是 R36 影响链剪枝掉的那批节点，这里把「为什么剪」摊开给用户看。
 *
 * ── 设计约束 ────────────────────────────────────────────────────────────────
 * - 零副作用、不 import store / 不碰 DOM，可直接单测
 * - 节点上限硬约束，超大仓库不会把画布铺成马赛克
 * - 分类优先级固定（sink > conduit > blocker），同一函数不会同时出现在两区
 */

import type { DataFlowFact } from "../../services/tauri";
import { L } from "../../ai/aiLang";

/** 函数在污点传播中的角色 */
export type FlowRole = "sink" | "conduit" | "blocker";

export const FLOW_ROLE_ORDER: FlowRole[] = ["sink", "conduit", "blocker"];

export const FLOW_ROLE_LABEL: Record<FlowRole, string> = {
  sink: "flow.role.sink",
  conduit: "flow.role.conduit",
  blocker: "flow.role.blocker",
};

export const FLOW_ROLE_COLOR: Record<FlowRole, string> = {
  sink: "#ef4444",
  conduit: "#f97316",
  blocker: "#10B981",
};

/** 复用 FunctionRenderer 的等级配色，避免再造一套渲染器 */
export const FLOW_ROLE_LEVEL: Record<FlowRole, string> = {
  sink: "extreme",
  conduit: "high",
  blocker: "low",
};

export const FLOW_ROLE_HINT: Record<FlowRole, string> = {
  sink: "flow.hint.sink",
  conduit: "flow.hint.conduit",
  blocker: "flow.hint.blocker",
};

/** 画布节点上限：一屏能读的量级，超出按角色优先级 + 权重截断 */
export const FLOW_PORTRAIT_LIMIT = 180;

export interface FlowNode {
  id: string;
  role: FlowRole;
  name: string;
  fileId: string;
  filePath: string;
  line: number;
  /** 形参个数 */
  paramCount: number;
  /** 流向返回值的形参 */
  toReturn: string[];
  /** 流向下游调用实参的条目数 */
  callFlowCount: number;
  /** 写出的外部状态 */
  sinks: string[];
  /** 排序权重（区内降序） */
  weight: number;
  /** 人话解释（hover / 检查器展示） */
  reasons: string[];
  signature: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowZone {
  role: FlowRole;
  label: string;
  color: string;
  count: number;
  /** 该角色实际渲染出的节点数 */
  renderedCount: number;
  x: number;
  y: number;
}

export interface FlowPortraitLayout {
  nodes: FlowNode[];
  zones: FlowZone[];
  summary: {
    totalFunctions: number;
    sinks: number;
    conduits: number;
    blockers: number;
    /** 被上限截断掉的节点数 */
    truncated: number;
    /** sink 里出现最多的写入目标 */
    topSink: { target: string; count: number } | null;
    /** 阻断占比（0~1）—— 越高说明影响链剪枝收益越大 */
    blockRatio: number;
  };
}

/**
 * JSON 数组字段的宽容解析：后端存的是紧凑 JSON，脏数据不能让整张图挂掉。
 *
 * 三档处理，顺序不可换：
 * 1. `[...]` → 严格 JSON，解析失败返回空（**不能**退化成 CSV：
 *    半截 JSON 按逗号切会切出 `"a"` `"b]` 这种带引号残片，比空还糟）；
 * 2. 不含任何 JSON 结构字符 → 按 CSV 容忍（兼容早期纯文本写法）；
 * 3. 其余（如 `{not json`）→ 判定为垃圾，返回空。
 *
 * 第 3 档很重要：sinks 一旦被垃圾串污染，函数会被误判成「汇点」而标红，
 * 用户会去审计一个根本没有副作用的函数。宁可少报也不能错报。
 */
function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s || s === "[]") return [];
  if (s.startsWith("[")) {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
    } catch {
      return [];
    }
  }
  if (/[[\]{}"]/.test(s)) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 逗号分隔字段解析（params / paramToReturn 用的是紧凑文本而非 JSON） */
function parseCsv(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 角色判定。
 *
 * 优先级 sink > conduit > blocker —— 一个函数既透传又写外部状态时算 sink，
 * 因为「有副作用」是比「会传导」更强的信号：审计时必须先看到它。
 */
export function roleOf(fact: DataFlowFact): FlowRole {
  if (parseList(fact.sinks).length > 0) return "sink";
  return fact.propagates ? "conduit" : "blocker";
}

/** 区内排序权重：sink 看写入点数量，conduit 看传导面，blocker 看形参数（吞掉多少输入） */
function weightOf(role: FlowRole, sinks: string[], toReturn: string[], callFlows: number, params: number): number {
  if (role === "sink") return sinks.length * 10 + callFlows;
  if (role === "conduit") return toReturn.length * 10 + callFlows * 2 + params;
  return params * 2 + callFlows;
}

/** 生成人话解释：卡片 hover 与检查器面板共用同一口径 */
function reasonsOf(
  role: FlowRole,
  sinks: string[],
  toReturn: string[],
  callFlowCount: number,
  paramCount: number
): string[] {
  const out: string[] = [];
  if (role === "sink") {
    out.push(L(`写外部状态 ${sinks.length} 处：${sinks.slice(0, 3).join("、")}${sinks.length > 3 ? " 等" : ""}`, `Writes external state at ${sinks.length} sites: ${sinks.slice(0, 3).join(", ")}${sinks.length > 3 ? " etc." : ""}`));
  }
  if (toReturn.length > 0) out.push(L(`形参 ${toReturn.join("/")} 直达返回值`, `Params ${toReturn.join("/")} flow straight to the return value`));
  if (callFlowCount > 0) out.push(L(`形参转发进 ${callFlowCount} 处下游调用`, `Params forwarded into ${callFlowCount} downstream call(s)`));
  if (role === "blocker") {
    out.push(
      paramCount > 0
        ? L(`${paramCount} 个形参均未流向返回值或下游 —— 影响链在此终止`, `${paramCount} param(s) flow to neither return nor downstream — the impact chain terminates here`)
        : L("无形参且无外部写入 —— 数据流上的孤立节点", "No params and no external writes — an isolated node on the data-flow graph")
    );
  }
  return out;
}

export interface FlowLayoutOptions {
  limit?: number;
  /** 每区列数 */
  cols?: number;
  colW?: number;
  rowH?: number;
  zoneGap?: number;
  left?: number;
  top?: number;
}

/**
 * 三区布局：sink / conduit / blocker 横向并排，区内网格。
 *
 * 截断策略不是「全局按权重砍」，而是**按区配额**：三个区各拿 limit/3，
 * 某区不足时把余额让给其它区。理由：如果全局按权重砍，
 * conduit 通常量最大会把 sink 挤没 —— 而 sink 恰恰是最该看到的那批。
 */
export function buildFlowPortrait(
  facts: DataFlowFact[],
  opts: FlowLayoutOptions = {}
): FlowPortraitLayout {
  const limit = opts.limit ?? FLOW_PORTRAIT_LIMIT;
  const cols = opts.cols ?? 4;
  const colW = opts.colW ?? 176;
  const rowH = opts.rowH ?? 62;
  const zoneGap = opts.zoneGap ?? 72;
  const left = opts.left ?? 40;
  const top = opts.top ?? 60;

  const buckets: Record<FlowRole, FlowNode[]> = { sink: [], conduit: [], blocker: [] };

  for (const f of facts) {
    if (!f.functionName) continue;
    const sinks = parseList(f.sinks);
    const toReturn = parseCsv(f.paramToReturn);
    const params = parseCsv(f.params);
    const callFlowCount = parseList(f.callFlows).length || countCallFlows(f.callFlows);
    const role = roleOf(f);
    buckets[role].push({
      id: f.id || `${f.fileId}::${f.functionName}:${f.lineNo}`,
      role,
      name: f.functionName,
      fileId: f.fileId,
      filePath: f.filePath,
      line: f.lineNo,
      paramCount: params.length,
      toReturn,
      callFlowCount,
      sinks,
      weight: weightOf(role, sinks, toReturn, callFlowCount, params.length),
      reasons: reasonsOf(role, sinks, toReturn, callFlowCount, params.length),
      signature: signatureOf(f.functionName, params, toReturn, sinks),
      x: 0,
      y: 0,
      width: 168,
      height: 44,
    });
  }

  const totalFunctions = buckets.sink.length + buckets.conduit.length + buckets.blocker.length;
  for (const role of FLOW_ROLE_ORDER) buckets[role].sort((a, b) => b.weight - a.weight);

  // 按区配额分配，余额顺延（sink 优先拿满）
  const quota = allocateQuota(
    FLOW_ROLE_ORDER.map((r) => buckets[r].length),
    limit
  );

  const nodes: FlowNode[] = [];
  const zones: FlowZone[] = [];
  let cursorX = left;

  FLOW_ROLE_ORDER.forEach((role, i) => {
    const all = buckets[role];
    const take = all.slice(0, quota[i]);
    zones.push({
      role,
      label: FLOW_ROLE_LABEL[role],
      color: FLOW_ROLE_COLOR[role],
      count: all.length,
      renderedCount: take.length,
      x: cursorX,
      y: top - 36,
    });
    take.forEach((n, idx) => {
      n.x = cursorX + (idx % cols) * colW;
      n.y = top + Math.floor(idx / cols) * rowH;
      nodes.push(n);
    });
    cursorX += cols * colW + zoneGap;
  });

  // 最常见的写入目标：一眼看出「这个项目的副作用主要往哪写」
  const sinkCount = new Map<string, number>();
  for (const n of buckets.sink) for (const s of n.sinks) sinkCount.set(s, (sinkCount.get(s) || 0) + 1);
  const topSinkEntry = [...sinkCount.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    nodes,
    zones,
    summary: {
      totalFunctions,
      sinks: buckets.sink.length,
      conduits: buckets.conduit.length,
      blockers: buckets.blocker.length,
      truncated: Math.max(0, totalFunctions - nodes.length),
      topSink: topSinkEntry ? { target: topSinkEntry[0], count: topSinkEntry[1] } : null,
      blockRatio: totalFunctions > 0 ? buckets.blocker.length / totalFunctions : 0,
    },
  };
}

/** callFlows 是对象数组时 parseList 会返回空（元素非 string），这里单独数长度 */
function countCallFlows(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = raw.trim();
  if (!s || s === "[]") return 0;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

function signatureOf(name: string, params: string[], toReturn: string[], sinks: string[]): string {
  const p = params.length > 0 ? params.join(", ") : "";
  const flow =
    toReturn.length > 0 ? ` → return(${toReturn.join(",")})` : sinks.length > 0 ? ` → ${sinks[0]}` : " ⊣";
  return `${name}(${p})${flow}`;
}

/**
 * 配额分配：先均分，某区不足的余额按顺序让给后面还没吃饱的区。
 * 导出以便单测 —— 这段逻辑决定了 sink 会不会被 conduit 挤掉。
 */
export function allocateQuota(sizes: number[], limit: number): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= limit) return [...sizes];

  const base = Math.floor(limit / n);
  const out = sizes.map((s) => Math.min(s, base));
  let rest = limit - out.reduce((a, b) => a + b, 0);
  // 余额分两轮：先给还有剩余的区，直到用完
  for (let round = 0; round < n && rest > 0; round++) {
    for (let i = 0; i < n && rest > 0; i++) {
      const room = sizes[i] - out[i];
      if (room <= 0) continue;
      const give = Math.min(room, rest);
      out[i] += give;
      rest -= give;
    }
  }
  return out;
}

/** 一句话结论（toast / 图例共用） */
export function summarizeFlowPortrait(layout: FlowPortraitLayout): string {
  const s = layout.summary;
  if (s.totalFunctions === 0) return L("数据流画像：暂无摘要数据", "Data-flow portrait: no summary data yet");
  const parts = [
    L(`${s.totalFunctions} 个函数摘要`, `${s.totalFunctions} function summary(ies)`),
    L(`汇点 ${s.sinks}`, `Sinks ${s.sinks}`),
    L(`透传 ${s.conduits}`, `Conduits ${s.conduits}`),
    L(`阻断 ${s.blockers}`, `Blockers ${s.blockers}`),
  ];
  if (s.topSink) parts.push(L(`写得最多：${s.topSink.target}（${s.topSink.count} 处）`, `Most written: ${s.topSink.target} (${s.topSink.count} sites)`));
  if (s.truncated > 0) parts.push(L(`另有 ${s.truncated} 个未渲染`, `${s.truncated} more not rendered`));
  return parts.join(" · ");
}
