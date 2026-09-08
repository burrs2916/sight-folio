/**
 * 污点传播路径布局（Taint Flow Portrait · 纯函数）
 *
 * ── 这张图回答什么问题 ──────────────────────────────────────────────────────
 * 已有画像回答的是「代码长什么样」（复杂度 / 耦合 / 模式）与「代码怎么调」
 * （调用图 / 执行流 / API 链路）。这张图回答的是安全与审计最核心的问题：
 *
 *   **不可信数据从哪个函数进来 → 经过哪些函数 → 在第几个参数位置传递 → 最终落到哪个危险调用**
 *
 * ── 对标 joern：能力降级版，不是平替 ────────────────────────────────────────
 * joern 的旗舰能力是 `reachableByFlows`：给定 source traversal 与 sink traversal，
 * 沿 CPG 的 REACHING_DEF 边做过程间回溯，输出完整污点路径。它的精度依赖三件事：
 *   ① 语句级 DDG —— `ReachingDefPass`（worklist 定点迭代 + BitSet 定义集）；
 *   ② `FlowSemantic` 语义表 —— `0=receiver / -1=return`，决定污染能否穿过一次调用，
 *      同时承担 sanitizer 语义（某调用若不流向返回值，则其入参不能流出去）；
 *   ③ `TaskFingerprint(sink, callSiteStack, callDepth)` 缓存键做上下文敏感去重。
 *
 * 我们**没有语句级 DDG**，只有 `project_data_flow` 的函数级摘要（形参→返回值、
 * 形参→下游实参、形参→外部状态）。因此本模块是诚实的能力降级版：
 *   - 粒度：函数级（非语句级），沿「第 i 个形参 → 下游调用第 j 个实参」传播；
 *   - 语义表：用一张前端危险 API / 净化函数名单替代 joern 的 Semantics 表；
 *   - 上下文：不敏感，用 (节点, 污染形参集) 去重替代 callSiteStack；
 *   - 方向：只做前向 DOWN 传播（形参→下游实参）。反向 UP 传播（被调返回值→调用方）
 *     需要语句级 def-use 链，我们没有，故**不做**，而不是假装做了。
 *
 * 保留下来的是 joern 那个最关键的思想：**污染不是「函数到函数」，而是
 * 「第 i 个形参到第 j 个实参」**。这条约束让我们比「调用可达即污染可达」精确得多。
 *
 * ── 设计约束 ────────────────────────────────────────────────────────────────
 * - 零副作用、不 import store / 不碰 DOM，可直接单测（与 dataFlowPortrait.ts 同构）
 * - 路径数与展开步数硬上限，超大仓库不会把画布铺成马赛克
 * - 未知即未知：无法解析的被调方计入 `unresolved` 并在摘要里如实上报，绝不静默
 */

import type { CallEdge, DataFlowFact } from "../../services/tauri";

/** 函数在一条污点路径上扮演的角色 */
export type TaintRole = "source" | "hop" | "sink" | "sanitized";

/** 危险汇点类别（严重度对标 joern Query.score） */
export type SinkKind = "rce" | "sql" | "deser" | "xss" | "path" | "ssrf" | "sideEffect";

/** 路径终点类别：命中危险 API / 副作用写入 / 被净化函数拦下 */
export type TaintEndKind = SinkKind | "sanitized";

export const TAINT_ROLE_COLOR: Record<TaintRole, string> = {
  source: "#3b82f6",
  hop: "#22c55e",
  sink: "#ef4444",
  sanitized: "#10b981",
};

export const SINK_KIND_COLOR: Record<TaintEndKind, string> = {
  rce: "#dc2626",
  sql: "#ef4444",
  deser: "#f97316",
  xss: "#f59e0b",
  path: "#eab308",
  ssrf: "#a855f7",
  sideEffect: "#64748b",
  sanitized: "#10b981",
};

/** i18n key（渲染侧用 resolveFragments 解析） */
export const SINK_KIND_LABEL: Record<TaintEndKind, string> = {
  rce: "taint.kind.rce",
  sql: "taint.kind.sql",
  deser: "taint.kind.deser",
  xss: "taint.kind.xss",
  path: "taint.kind.path",
  ssrf: "taint.kind.ssrf",
  sideEffect: "taint.kind.sideEffect",
  sanitized: "taint.kind.sanitized",
};

export const TAINT_ROLE_LABEL: Record<TaintRole, string> = {
  source: "taint.role.source",
  hop: "taint.role.hop",
  sink: "taint.role.sink",
  sanitized: "taint.role.sanitized",
};

/** 过程间展开深度上限（对标 joern EngineConfig.maxCallDepth = 4） */
export const TAINT_MAX_DEPTH = 4;
/** 画布上最多画多少条路径 */
export const TAINT_MAX_PATHS = 40;
/** 全局展开步数预算，防病态图跑飞 */
export const TAINT_MAX_STEPS = 20000;
/** 单个 source 最多贡献多少条路径（防枢纽 source 独占画布、饿死其它入口） */
export const TAINT_MAX_PATHS_PER_SOURCE = 12;
/** 单个节点（函数,污染形参）最多向下展开几次（对标 joern EngineConfig.maxArgsToAllow 的扇出闸门） */
export const TAINT_MAX_FANOUT = 64;
/** 候选 source 上限（按可疑度排序后截断） */
export const TAINT_MAX_SOURCES = 60;

// ─────────────────────────── 危险汇点 / 净化函数名单 ───────────────────────────
// 这是 joern `FlowSemantic` 表的降级等价物：joern 用 methodFullName 匹配的语义表
// 决定「污染能否穿过这次调用」，我们用两张名单近似 —— 命中 sink 则污染落地，
// 命中 sanitizer 则污染终止。

interface SinkRule {
  kind: SinkKind;
  /** 严重度 1..5，对标 joern Query.score */
  score: number;
  re: RegExp;
}

const SINK_RULES: SinkRule[] = [
  // 代码执行 / 命令注入（RCE）—— 最严重
  //
  // P0：恢复裸 `exec`（与 `child_process.exec` 同名的真 RCE 汇点）。此前因
  // `RegExp.prototype.exec` / Rust `self.exec` 同名碰撞被迫移除；现在 dataFlow 的
  // `callFlows` 已带 `receiver`（接收者根标识符），taintFlow 在 sink 命中处加
  // 「接收者守卫」——`RegExp`/`self`/正则变量名的 `exec` 不报 RCE，从源头消除碰撞，
  // 同时恢复 `child_process.exec` 的真实检测（见 isRegexReceiver + taintFlow.test.ts 回归锁）。
  {
    kind: "rce",
    score: 5,
    re: /(^|[$_.\s])(eval|exec|execsync|execfile|spawn|spawnsync|system|popen|function|getruntime)$/,
  },
  // SQL 注入：注意刻意排除 `prepare` —— 参数化预处理恰恰是 SQL 注入的解药，
  // 把 prepare 当 sink 会制造大量假阳性（joern 的 SQLInjection 打的是 query）。
  // 同理排除裸 `raw`（见下方注释）。
  {
    kind: "sql",
    score: 5,
    // 裸 `raw` 已被移除：真实项目探针里 `list_dir_raw()` 被误判成 SQL 注入。
    // Prisma 风格的 $queryRaw / $executeRaw / rawQuery 仍由下列三项精确覆盖。
    re: /(^|[$_.\s])(query|execute|execsql|queryraw|executeraw|rawquery)$/,
  },
  // 不安全反序列化
  {
    kind: "deser",
    score: 4,
    re: /(^|[$_.\s])(unserialize|loads|unsafe_load|load_dangerous|marshal_loads)$/,
  },
  // XSS / 模板注入：`write` 必须带 document. 前缀，否则 res.write / stream.write 全是噪声
  {
    kind: "xss",
    score: 4,
    re: /(^|[$_.\s])(innerhtml|outerhtml|insertadjacenthtml|dangerouslysetinnerhtml|render_template_string|v-html|markup)$|(^|\.)document\.write$/,
  },
  // 路径穿越 / 任意文件读写
  {
    kind: "path",
    score: 4,
    re: /(^|[$_.\s])(readfile|writefile|appendfile|readfilesync|writefilesync|createreadstream|createwritestream|unlink|rmdir|rmtree|rm)$/,
  },
  // SSRF / 任意外发请求
  { kind: "ssrf", score: 3, re: /(^|[$_.\s])(fetch|request|got|axios|curl)$/ },
];

/**
 * 副作用落点的严重度（污染被写进外部状态，而非命中危险 API）。
 * 原为散落在求解器与预筛图里的裸数字 `2`，抽成常量保证两处判定永不漂移。
 */
const SIDE_EFFECT_SCORE = 2;

/** 净化落点的严重度（污染被拦下，不构成漏洞），同时作为可达性分档的最低档 */
const SANITIZED_SCORE = 0;

/**
 * 净化函数名正则 —— **仅作兜底**。
 *
 * 权威判定已下沉到 Rust 侧语义表（`infrastructure/ast/flow_semantics.rs`，
 * 对标 joern `DefaultSemantics.scala`），只有在语义表查不到时才走到这里
 * （旧数据没有 `sem` 字段也都走这里，保证零回归）。
 *
 * 保留它而不是删掉，是因为未知调用必须有个保守默认值；但**不要**在这里加条目 ——
 * 语义表是按语言可区分、可单测、可回放验证的结构化名单，正则不是。
 */
const SANITIZER_RE =
  /(^|[$_.\s])(escape\w*|sanitize\w*|sanitise\w*|encodeuri\w*|encodeuricomponent|htmlspecialchars|striptags|strip_tags|quote\w*|parameterize|whitelist|allowlist|parseint|parsefloat|number|normalize|normalise|basename|dompurify|xss)$/;

// ─────────────────────────── source 启发式（仅用于排序，不用于过滤） ───────────────────────────
// source 的主判据是图性质：形参没有任何上游喂入，却往下游传 —— 即外部输入入口。
// 下列命名/路径信号只决定「哪些 source 优先展示」，避免大仓库里被弱信号淹没。

const SOURCE_NAME_RE =
  /(^|[^a-z])(read|load|fetch|request|receive|recv|input|decode|deserialize|parse|import|accept|query|search|fromenv|fromargv|getenv|argv|stdin|payload|body|upload|webhook|subscribe|handle|listen|route|controller|middleware|resolver)\w*$/i;
const SOURCE_PATH_RE =
  /(\/|\\)(route|routes|router|controller|controllers|handler|handlers|api|middleware|cmd|cli|server|web|http|grpc|rpc|gateway|entry|main)(\/|\\|$)/i;
const SOURCE_PARAM_RE =
  /^(input|raw|data|payload|body|req|request|res|arg|args|argv|value|val|text|str|cmd|command|url|uri|path|file|sql|query|html|expr|code|name|key|id|param|params|opt|options|config|env)$/i;

// ─────────────────────────── 解析辅助 ───────────────────────────

export interface CallArgFlowView {
  callee: string;
  argIndex: number;
  param: string;
  line: number;
  /** 接收者根标识符（P0：dataFlow 的 callFlows.receiver），用于区分 exec 碰撞 */
  receiver?: string;
  /**
   * 形参到达该实参**途中经过的调用名**（求值顺序，内层在前）。
   * 空 = 形参直接出现在实参里。
   *
   * 由 dataflow 的局部变量展开（对标 joern 到达定义）产生：
   * `const v = escapeHtml(req.body); render(v)` 展开成 `req → render` 后，
   * 净化痕迹只存在于 via 里，不看 via 就会把已净化的数据报成漏洞。
   */
  via?: string[];
  /**
   * 整条求值链（`via ++ [callee]`）的 FlowSemantic 语义结论，由 Rust 侧
   * `infrastructure/ast/flow_semantics.rs` 落库（对标 joern `DefaultSemantics`）。
   *
   * | 取值 | 含义 |
   * |---|---|
   * | `"block:<name>"` | 语义表判定 `<name>` 为净化器 → 污染终止 |
   * | `"pass"` | 链上有语义表收录的透传调用 → **明确不净化** |
   * | `""` / 缺失 | 语义表无记录 → 回退 `SANITIZER_RE` 正则（旧数据零回归） |
   */
  sem?: string;
}

function splitList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseJsonArray<T>(s: string | null | undefined): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function parseCallFlows(s: string | null | undefined): CallArgFlowView[] {
  return parseJsonArray<Partial<CallArgFlowView>>(s)
    .filter((f) => f && typeof f.callee === "string" && typeof f.param === "string")
    .map((f) => ({
      callee: String(f.callee),
      argIndex: Number.isFinite(f.argIndex) ? Number(f.argIndex) : 0,
      param: String(f.param),
      line: Number.isFinite(f.line) ? Number(f.line) : 0,
      receiver: typeof f.receiver === "string" ? f.receiver : "",
      via: Array.isArray(f.via) ? f.via.filter((x): x is string => typeof x === "string") : [],
      sem: typeof f.sem === "string" ? f.sem : "",
    }));
}

/** 归一化调用名：`fs.readFileSync` → `readfilesync`，保留点号供 `document.write` 类规则使用 */
function normCallName(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
}

function lastSegment(norm: string): string {
  const parts = norm.split(".");
  return parts[parts.length - 1] || norm;
}

export interface SinkMatch {
  kind: TaintEndKind;
  score: number;
  rule: string;
}

/** 命中危险 API 名单？（对标 joern `cpg.method.name("query")` 形式的 sink traversal） */
export function matchSink(rawName: string): SinkMatch | null {
  const norm = normCallName(rawName);
  if (!norm) return null;
  const last = lastSegment(norm);
  for (const r of SINK_RULES) {
    if (r.re.test(last) || r.re.test(norm)) {
      return { kind: r.kind, score: r.score, rule: last };
    }
  }
  return null;
}

/**
 * P0 接收者守卫：裸 `exec` 命中 RCE 时，若接收者表明它是 `RegExp.prototype.exec`
 * 或 Rust `self.exec`（SFTP 内部执行器）而非 `child_process.exec`，则**不**当命令执行上报。
 *
 * 依据（真实探针）：web-craft 里 5 条 exec 误报的接收者分别是 `RegExp` / `SENTINEL_RE` /
 * `startRegex` / `doneRegex`（均暗示正则）与 `self`（Rust 结构体方法）。这些接收者根标识符
 * 现在由 dataFlow 的 `callFlows.receiver` 提供，故能精确区分。
 *
 * 接收者判据（保守：只在裸 exec 上生效，不影响 execSync/spawn 等无歧义 API）：
 *  - `self` → Rust 内部执行器，非命令注入；
 *  - `/.../` 字面量正则 或 `RegExp` → 正则匹配；
 *  - 变量名含 `regex`/`regexp`/`_re`/`re$`/`pattern`（大小写不敏感）→ 暗示正则接收者。
 * 空接收者（无信息）不抑制，保守按 RCE 上报（宁报不漏）。
 */
export function isRegexReceiverSink(callee: string, receiver?: string): boolean {
  const short = lastSegment(normCallName(callee));
  if (short !== "exec") return false;
  const r = (receiver ?? "").trim();
  if (r === "") return false;
  const rl = r.toLowerCase();
  if (rl === "self" || rl === "regexp" || r.startsWith("/")) return true;
  return /regex|regexp|_re$|re$|pattern/.test(rl);
}

/** 命中净化函数名单？（对标 joern Semantics 表的阻断语义） */
export function matchSanitizer(rawName: string): boolean {
  const norm = normCallName(rawName);
  if (!norm) return false;
  const last = lastSegment(norm);
  return SANITIZER_RE.test(last) || SANITIZER_RE.test(norm);
}

/**
 * 净化判定：**语义表优先，正则名单兜底**。
 *
 * 判定权在 Rust 侧 —— 语义表（`flow_semantics.rs`）是单一真源，前端只消费结论。
 * 这样三处（后端摘要、语义表、前端求解器）不会各维护一份会漂移的名单。
 *
 * 优先级与 joern `EdgeValidator` 对齐：
 *
 * 1. 语义表判 `block:<name>` → 净化，并带上**决定性**调用名供报告标注；
 * 2. 语义表判 `pass` → 明确**不**净化。这一档专治正则名单的误伤：
 *    `path.normalize()` 返回 `../etc/passwd`、`String.prototype.normalize()`
 *    只做 Unicode 规范化，两者都不是净化器，却被 `SANITIZER_RE` 的
 *    `normalize` 分支命中，导致路径穿越整条漏报；
 * 3. 语义表无记录（含旧数据缺 `sem` 字段）→ 回退正则，行为与改动前逐字节一致。
 *
 * @returns 决定性净化调用名，未净化返回 `undefined`
 */
export function resolveSanitizer(flow: CallArgFlowView): string | undefined {
  const sem = flow.sem ?? "";
  if (sem.startsWith("block:")) {
    const name = sem.slice("block:".length);
    return name || undefined;
  }
  if (sem === "pass") return undefined;
  // 兜底分支：语义表查不到。旧数据没有 sem 字段，走的就是这条路 —— 零回归。
  return matchSanitizer(flow.callee) ? flow.callee : (flow.via ?? []).find((v) => matchSanitizer(v));
}

// ─────────────────────────── 图构建 ───────────────────────────

interface ParsedFact {
  key: string;
  fileId: string;
  filePath: string;
  line: number;
  name: string;
  params: string[];
  paramToReturn: string[];
  propagates: boolean;
  returnsCallResult: boolean;
  flows: CallArgFlowView[];
  sinks: string[];
}

function factKey(f: DataFlowFact): string {
  return `${f.fileId || ""}::${(f.functionName || "").toLowerCase()}::${f.lineNo || 0}`;
}

function parseFact(f: DataFlowFact): ParsedFact {
  return {
    key: factKey(f),
    fileId: f.fileId || "",
    filePath: f.filePath || "",
    line: f.lineNo || 0,
    name: f.functionName || "",
    params: splitList(f.params),
    paramToReturn: splitList(f.paramToReturn),
    propagates: !!f.propagates,
    returnsCallResult: !!f.returnsCallResult,
    flows: parseCallFlows(f.callFlows),
    sinks: parseJsonArray<string>(f.sinks),
  };
}

/** 被调名匹配：`repo.save` 的摘要里 callee 记的是末段 `save` */
function calleeNameMatches(edgeName: string, flowCallee: string): boolean {
  const a = normCallName(edgeName);
  const b = normCallName(flowCallee);
  if (!a || !b) return false;
  if (a === b) return true;
  return lastSegment(a) === lastSegment(b);
}

interface TaintGraph {
  facts: ParsedFact[];
  byKey: Map<string, ParsedFact>;
  /** fileId + 函数名 → 摘要（同名取行号最小者，避免重载歧义） */
  byFileAndName: Map<string, ParsedFact>;
  /** callerFileId → 该文件的调用边（按行号升序） */
  callsByFile: Map<string, CallEdge[]>;
}

function buildGraph(facts: DataFlowFact[], edges: CallEdge[]): TaintGraph {
  const parsed = facts.map(parseFact);
  const byKey = new Map<string, ParsedFact>();
  const byFileAndName = new Map<string, ParsedFact>();
  for (const f of parsed) {
    byKey.set(f.key, f);
    const k = `${f.fileId}::${f.name.toLowerCase()}`;
    const prev = byFileAndName.get(k);
    if (!prev || f.line < prev.line) byFileAndName.set(k, f);
  }
  const callsByFile = new Map<string, CallEdge[]>();
  for (const e of edges) {
    const k = e.callerFileId || "";
    if (!k) continue;
    const arr = callsByFile.get(k);
    if (arr) arr.push(e);
    else callsByFile.set(k, [e]);
  }
  for (const arr of callsByFile.values()) arr.sort((a, b) => a.lineNo - b.lineNo);
  return { facts: parsed, byKey, byFileAndName, callsByFile };
}

/** 调用边消歧：调用点必在函数定义行之后，取行号距离最近的一条（同语句内多行实参的容差） */
const MAX_CALL_LINE_DIST = 200;

function resolveCallee(
  g: TaintGraph,
  caller: ParsedFact,
  flow: CallArgFlowView
): { edge: CallEdge; fact: ParsedFact | null } | null {
  const cands = g.callsByFile.get(caller.fileId);
  if (!cands || cands.length === 0) return null;
  let best: CallEdge | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of cands) {
    // 调用点一定不早于所属函数的定义行
    if (e.lineNo < caller.line - 1) continue;
    if (!calleeNameMatches(e.calleeName, flow.callee)) continue;
    const d = Math.abs(e.lineNo - flow.line);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  if (!best || bestDist > MAX_CALL_LINE_DIST) return null;
  const fact =
    g.byFileAndName.get(`${best.calleeFileId}::${(best.calleeName || "").toLowerCase()}`) ??
    (best.calleeSymbolId ? g.byKey.get(`${best.calleeFileId}::${(best.calleeName || "").toLowerCase()}::${best.lineNo}`) ?? null : null);
  return { edge: best, fact };
}

// ─────────────────────────── 路径求解 ───────────────────────────

/**
 * 边标签：带上中间调用链（`req → buildQuery() → query() #0`）。
 *
 * 局部变量展开把 `const q = buildQuery(req.id); query(q)` 压成一条直达边之后，
 * 若只标 `req → query() #0`，用户看到的是一条跳过了 `buildQuery` 的假直达链 ——
 * 既看不懂来龙去脉，也没法判断中间那步是否做了净化。链必须画出来。
 */
function viaLabel(
  taint: string,
  callee: string,
  via: string[] | undefined,
  suffix = ""
): string {
  const chain = (via ?? []).filter(Boolean);
  const steps = chain.length > 0 ? `${chain.map((v) => `${v}()`).join(" → ")} → ` : "";
  return `${taint} → ${steps}${callee}()${suffix}`;
}

export interface TaintPathNode {
  key: string;
  name: string;
  fileId: string;
  filePath: string;
  line: number;
  role: TaintRole;
  /** 到达该节点时仍处于污染中的形参名 */
  tainted: string[];
  /** 终点类别（仅 sink / sanitized 节点有） */
  endKind?: TaintEndKind;
  severity: number;
  /** 命中的规则名（危险 API 名 / 净化函数名 / 副作用目标） */
  rule?: string;
  symbolId?: string | null;
}

export interface TaintPathEdge {
  /** 从 nodes[from] 到 nodes[from+1] */
  from: number;
  label: string;
}

export interface TaintPath {
  id: string;
  nodes: TaintPathNode[];
  edges: TaintPathEdge[];
  /** 终点类别 */
  endKind: TaintEndKind;
  /** 终点严重度（sanitized = 0） */
  severity: number;
}

export interface TaintStats {
  /** 候选 source 总数（入度为 0 且有下游传播的函数） */
  sources: number;
  /** 实际画出的路径数 */
  paths: number;
  sinks: number;
  sanitized: number;
  /**
   * 无法解析到摘要、也无法归类为 sink/sanitizer 的被调次数（如实上报，不静默）。
   *
   * 口径：**只统计被实际探索的入口**（④ 可达性预筛会把「可证明走不到任何落点」的
   * 入口挡在探索之外，那些入口里的不可解析调用不影响结果，计入只会虚增数字）。
   * 全库的不可解析调用绝大多数是 `map` / `set` / `Some` / `Ok` 这类标准库调用，
   * 它们本就没有被调摘要，全量计入会**夸大**分析的不完整程度，同样不可取。
   */
  unresolved: number;
  /** 是否因上限而截断 —— 任何一种预算造成丢失都必须置位，绝不静默 */
  truncated: boolean;
  /** 全局展开步数预算耗尽（部分路径未走完） */
  stepBudgetExhausted: boolean;
  /** 单 source 路径配额耗尽（该入口还有更多路径，但被配额挡下） */
  sourceBudgetExhausted: boolean;
  /** 扇出闸门触发（存在日志/工具类枢纽节点，其展开被整体放弃） */
  fanOutTruncated: boolean;
}

export interface TaintResult {
  paths: TaintPath[];
  stats: TaintStats;
}

/** source 可疑度：命名信号 + 路径信号 + 形参名信号，仅用于排序 */
function sourceScore(f: ParsedFact): number {
  let s = 0;
  if (SOURCE_NAME_RE.test(f.name)) s += 2;
  if (SOURCE_PATH_RE.test(f.filePath)) s += 2;
  if (f.params.some((p) => SOURCE_PARAM_RE.test(p))) s += 1;
  return s;
}

/**
 * 求污点传播路径。
 *
 * 算法（前向、参数位置感知、上下文不敏感）：
 *   1. 建立「形参被上游喂入」索引：F 把形参 p 作为第 i 个实参传给 G，则 G.params[i] 被喂入；
 *   2. source = 形参未被任何上游喂入、却往下游传的函数（外部输入入口），按可疑度排序截断；
 *   3. 从 source 的污染形参出发 BFS：污染沿「形参 → 下游实参位置」传播到被调方的
 *      第 argIndex 个形参；命中 sink / sanitizer 名单即终止并成链；
 *   4. 去重键 = (节点, 污染形参集)，对标 joern 的 TaskFingerprint。
 */
export function buildTaintPaths(
  facts: DataFlowFact[],
  edges: CallEdge[],
  options?: {
    maxDepth?: number;
    maxPaths?: number;
    maxSources?: number;
    maxSteps?: number;
    maxPathsPerSource?: number;
    maxFanOut?: number;
  }
): TaintResult {
  const maxDepth = options?.maxDepth ?? TAINT_MAX_DEPTH;
  const maxPaths = options?.maxPaths ?? TAINT_MAX_PATHS;
  const maxSources = options?.maxSources ?? TAINT_MAX_SOURCES;
  const maxSteps = options?.maxSteps ?? TAINT_MAX_STEPS;
  const maxPathsPerSource = options?.maxPathsPerSource ?? TAINT_MAX_PATHS_PER_SOURCE;
  const maxFanOut = options?.maxFanOut ?? TAINT_MAX_FANOUT;

  const g = buildGraph(facts, edges);

  /**
   * ① 一次全量遍历同时产出三样东西。
   *
   * `resolveCallee` 是全库最贵的一步（本仓实测 4341 流边各调一次），
   * 所以 `fed` / 跳转边 / sink 落点必须在同一遍里算完，绝不做第二遍。
   *
   * | 产物 | 键 | 含义 |
   * |---|---|---|
   * | `fed` | 被调函数 key → 形参集 | 形参被上游喂入（判 source 用） |
   * | `jump` | (函数,形参) → (函数,形参)[] | 污染沿调用边下钻的正向跳转 |
   * | `sinkAt` | (函数,形参) → 严重度 | 该处能**直接**命中的落点严重度（sink 取 score，净化取 0） |
   */
  const fed = new Map<string, Set<string>>();
  const jump = new Map<string, string[]>();
  const sinkAt = new Map<string, number>();
  const vkeyOf = (key: string, param: string) => `${key}|${param}`;

  for (const f of g.facts) {
    for (const flow of f.flows) {
      const from = vkeyOf(f.key, flow.param);
      // 终结判定与 `walk` 严格同序：净化 → sink → 下钻，保证预筛图与真实搜索一致。
      const stopped = resolveSanitizer(flow) !== undefined;
      const sink = stopped ? null : matchSink(flow.callee);
      const sinkHit = sink && !isRegexReceiverSink(flow.callee, flow.receiver) ? sink : null;
      if (sinkHit) {
        const prev = sinkAt.get(from) ?? 0;
        if (sinkHit.score > prev) sinkAt.set(from, sinkHit.score);
      } else if (stopped) {
        // 净化终结点同样算「走得到头」，但严重度取 0（SANITIZED_SCORE）。
        //
        // 这不是可选优化：UI 有「仅已被净化拦下的链路」视图，若净化终点不进可达图，
        // 那么**只能**通向净化器的入口会被预筛整体剔除，该视图永久空白 ——
        // 属于「改一个功能、丢另一个功能」的回归，必须在此兜住。
        if (!sinkAt.has(from)) sinkAt.set(from, SANITIZED_SCORE);
      }

      const r = resolveCallee(g, f, flow);
      if (!r || !r.fact) continue;
      const target = r.fact.params[flow.argIndex];
      if (!target) continue;

      // fed：与改动前逐字节一致 —— 不论中途是否净化/命中 sink，数据确实到了该形参
      let set = fed.get(r.fact.key);
      if (!set) {
        set = new Set<string>();
        fed.set(r.fact.key, set);
      }
      set.add(target);

      // 终结点不产生跳转边（对应 walk 里的 continue）
      if (stopped || sinkHit) continue;
      // 被调方把污染写进外部状态：低严重度落点（walk 里落点后仍继续下钻，故此处同样不 return）
      if (r.fact.sinks.length > 0) {
        const prev = sinkAt.get(from) ?? 0;
        if (SIDE_EFFECT_SCORE > prev) sinkAt.set(from, SIDE_EFFECT_SCORE);
      }
      const to = vkeyOf(r.fact.key, target);
      const arr = jump.get(from);
      if (arr) arr.push(to);
      else jump.set(from, [to]);
    }
  }

  /**
   * ② 反向可达：从所有落点（sink 取其 score、净化取 SANITIZED_SCORE）回溯，
   * 算出每个 (函数,形参) 能到达的**最高落点严重度**。走不到任何落点的节点不在 `reach` 里。
   *
   * ── 为什么需要这一步（对标 joern，先证伪再动手）──────────────────────────────
   * joern 的 source 是**用户用 traversal 明给的**：`SourcesToStartingPoints.scala:69-71`
   * 对全部 source 逐个派发任务，第 40 行 `.sortBy(_.source.id)` 只为**确定性**而非优先级，
   * 既没有按名字猜重要性，也没有 Top-K 截断。规模化靠 per-node 闸门
   * （maxCallDepth / maxArgsToAllow / maxOutputArgsExpansion）而非丢弃 source。
   *
   * 我们没有 source 查询、只能自动派生入口，于是用命名启发式排序后截断到 60 个。
   * 真实仓库回放证明这条路是错的（本仓 4156 摘要 / 4341 流边）：
   *   - `fed` 只覆盖 360/4156 个函数（8.7%）→ 1549 个函数被当成候选入口；
   *   - 只探索前 60 个 = **覆盖 3.9%**；
   *   - 命中率：选中的 60 个里 1 步直达 sink 的 3 个（5.0%），
   *     全库基线 90/1549 = 5.8% —— **排序毫无区分力，等于随机抽样**。
   *
   * 因此改用**图结构**筛选（命名启发式降级为同分时的次级排序键）：
   * 能证明走不到任何 sink 的入口，不值得占用有限的探索预算。
   */
  const reach = new Map<string, number>();
  {
    const rev = new Map<string, string[]>();
    for (const [from, tos] of jump) {
      for (const to of tos) {
        const arr = rev.get(to);
        if (arr) arr.push(from);
        else rev.set(to, [from]);
      }
    }
    const queue: string[] = [];
    for (const [v, score] of sinkAt) {
      reach.set(v, score);
      queue.push(v);
    }
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const curScore = reach.get(cur)!;
      for (const prev of rev.get(cur) ?? []) {
        // 严重度只增不减，且上界为 5 → 每个节点最多重入 5 次，必然终止
        const known = reach.get(prev);
        if (known !== undefined && known >= curScore) continue;
        reach.set(prev, curScore);
        queue.push(prev);
      }
    }
  }

  /**
   * ③ 候选入口：形参未被上游喂入 + 确实往下游传 + **可证明能走到某个落点**。
   *
   * 与改动前的差别一：粒度从「函数」细化到「(函数, 形参)」。同一个函数的两个形参
   * 可能一个通向 `execute()`、另一个只是打日志，按函数整体取舍会互相连坐。
   */
  const candidates: Array<{ fact: ParsedFact; param: string; reachScore: number; score: number }> = [];
  for (const f of g.facts) {
    if (f.params.length === 0 || f.flows.length === 0) continue;
    const fedSet = fed.get(f.key);
    for (const p of f.params) {
      if (fedSet && fedSet.has(p)) continue;
      if (!f.flows.some((fl) => fl.param === p)) continue;
      const reachScore = reach.get(vkeyOf(f.key, p));
      if (reachScore === undefined) continue; // 走不到任何落点 —— 不值得探索
      candidates.push({ fact: f, param: p, reachScore, score: sourceScore(f) });
    }
  }
  candidates.sort((a, b) => {
    // 主序是图结构（能到达的落点有多严重），命名启发式只作同分次级键
    if (b.reachScore !== a.reachScore) return b.reachScore - a.reachScore;
    if (b.score !== a.score) return b.score - a.score;
    if (b.fact.flows.length !== a.fact.flows.length) return b.fact.flows.length - a.fact.flows.length;
    // 兜底：按 fileId+line 稳定排序，保证同输入同输出（对标 joern 的确定性约束）
    return a.fact.key < b.fact.key ? -1 : a.fact.key > b.fact.key ? 1 : 0;
  });

  /**
   * ④ 取用入口：**每档保底 + 剩余名额高危优先**。
   *
   * 这里是两次实测教训的收敛，两版都跑过真实仓库（本仓 4156 摘要 / 4341 流边）：
   *
   * - **纯按严重度取前 N**：severity 5 的入口吃光全部 40 条路径配额 →
   *   `sql 31 / rce 9`，但 `sanitized = 0`，UI 的「仅已净化」视图**永久空白**
   *   （改一个功能丢另一个功能，属回归）。
   * - **每档严格轮转（5/4/3/2/0 各取一个）**：sanitized 回到 15，
   *   但 severity 5 只探到 12 条 → `sql 3 / rce 9`，高危召回反而掉了。
   *
   * 根因是 `maxPaths` 是**收集**上限而非展示上限：一旦收满 40 条就停止探索，
   * 所以「先探索谁」直接决定最终收成，最后那次 `sort by severity` 只是给已收到的
   * 40 条重新排序，救不回没探索到的。
   *
   * 因此：先给每档保底名额（保证没有档被饿死），剩余名额按严重度降序填满
   * （高危档优先吃下预算）。
   */
  const sources: typeof candidates = [];
  {
    const tiers: Array<{ score: number; items: typeof candidates }> = [];
    const tierIndex = new Map<number, number>();
    for (const c of candidates) {
      let idx = tierIndex.get(c.reachScore);
      if (idx === undefined) {
        idx = tiers.length;
        tierIndex.set(c.reachScore, idx);
        tiers.push({ score: c.reachScore, items: [] });
      }
      tiers[idx].items.push(c);
    }
    // 档位按严重度降序 —— 保底之后的高危优先填充依赖这个顺序
    tiers.sort((a, b) => b.score - a.score);
    const taken = new Array<number>(tiers.length).fill(0);
    // ① 保底轮转：每档至少 minPerTier 个，防止任一档被完全饿死
    const minPerTier = Math.max(1, Math.floor(maxSources / 8));
    guarantee: for (let round = 0; round < minPerTier; round += 1) {
      for (let i = 0; i < tiers.length; i += 1) {
        if (round >= tiers[i].items.length) continue;
        sources.push(tiers[i].items[round]);
        taken[i] = round + 1;
        if (sources.length >= maxSources) break guarantee;
      }
    }
    // ② 剩余名额按严重度降序填满
    fill: for (let i = 0; i < tiers.length; i += 1) {
      while (taken[i] < tiers[i].items.length) {
        if (sources.length >= maxSources) break fill;
        sources.push(tiers[i].items[taken[i]]);
        taken[i] += 1;
      }
    }
  }

  const paths: TaintPath[] = [];
  const seenPath = new Set<string>();
  let steps = 0;
  let unresolved = 0;
  let stepBudgetExhausted = false;
  let sourceBudgetExhausted = false;
  let fanOutTruncated = false;

  const pushPath = (nodes: TaintPathNode[], edgeLabels: string[], endKind: TaintEndKind, severity: number) => {
    const sig = `${endKind}|${nodes.map((n) => n.key).join(">")}|${nodes[nodes.length - 1].rule ?? ""}`;
    if (seenPath.has(sig)) return;
    seenPath.add(sig);
    paths.push({
      id: `taint-${paths.length}`,
      nodes: nodes.slice(),
      edges: edgeLabels.map((label, i) => ({ from: i, label })),
      endKind,
      severity,
    });
  };

  outer: for (const src of sources) {
    if (paths.length >= maxPaths) break;
    // 每个候选本身就是一个 (函数, 污染形参) 入口 —— 见 ③ 的粒度说明
    const param = src.param;
    if (paths.length >= maxPaths) break outer;
    {
      const start: TaintPathNode = {
        key: src.fact.key,
        name: src.fact.name,
        fileId: src.fact.fileId,
        filePath: src.fact.filePath,
        line: src.fact.line,
        role: "source",
        tainted: [param],
        severity: 0,
      };
      // 路径级去重（对标 joern TaskCreator.removeTasksWithLoopsAndTooHighCallDepth：
      //   `t.taskStack.dedup.size == t.taskStack.size`）。
      //
      // 语义是「当前路径内不得出现重复节点」，**不是**全局访问过就不能再来。
      // joern package.scala:57-59 的原话：同一节点若经不同调用序列到达，应视为不同的
      // 路径元素。此前这里是全局集合且回溯时不删除 —— 菱形汇聚图
      // （entry→branchA/B→merge→eval）里先走到的分叉会占住 `merge`，另一条分叉
      // 直接被静默吞掉（truncated/stepBudgetExhausted 都不置位，用户完全无感知）。
      //
      // 随 stack push/pop 维护即同时得到两个性质：
      //   ① 环检测：A→B→A 在下钻前被挡住（此前靠全局 visited 意外兜住，改后必须显式有）；
      //   ② 分叉保全：换一条路径仍可经过同一节点，召回不损失。
      const onPath = new Set<string>([`${src.fact.key}|${param}`]);
      // 本 source 的路径配额基线：防单个枢纽入口独占画布、饿死其它入口。
      // （joern 无全局步数上限，靠 maxCallDepth + 扇出闸门控制规模；我们额外加这层
      //  是因为 paths 数组本身就是画布预算，一个 source 吃光就没别人的位置了。）
      const baseline = paths.length;
      // nodes/labels 平行栈，回溯即 pop
      const stack: Array<{ fact: ParsedFact; taint: string; node: TaintPathNode }> = [
        { fact: src.fact, taint: param, node: start },
      ];
      const labels: string[] = [];

      const walk = (cur: ParsedFact, taint: string, depth: number) => {
        if (paths.length >= maxPaths) return;
        if (paths.length - baseline >= maxPathsPerSource) {
          sourceBudgetExhausted = true;
          return;
        }
        if (steps++ > maxSteps) {
          stepBudgetExhausted = true;
          return;
        }
        let fanOut = 0;
        for (const flow of cur.flows) {
          if (flow.param !== taint) continue;
          // 扇出闸门（对标 joern EngineConfig.maxArgsToAllow 的 fail-closed 取舍）：
          // 单节点展开过多说明这是日志/工具类枢纽，继续展开只会制造组合爆炸并把
          // 全局步数预算吃光，导致其它真实路径饿死。宁可整体放弃该节点，不静默拖垮全局。
          if (++fanOut > maxFanOut) {
            fanOutTruncated = true;
            break;
          }

          // 净化函数：污染到此为止（joern Semantics 阻断的降级等价物）。
          //
          // 中间调用链（via）必须一起判：dataflow 把局部变量展开成直达边之后，
          // `const v = escapeHtml(req.body); render(v)` 里的 `escapeHtml` 只存在于
          // via 中。若只看 flow.callee，已净化的数据会被当成漏洞报出来 ——
          // 展开带来了召回，代价就是净化判定必须跟着一起展开。
          //
          // 判定本身由 Rust 侧语义表给出（resolveSanitizer）：语义表有记录时按语义，
          // 没有记录时才回退到这里的正则名单。
          const sanStop = resolveSanitizer(flow);
          if (sanStop) {
            const terminal: TaintPathNode = {
              key: `${cur.key}#san#${sanStop}#${flow.line}`,
              name: `${flow.callee}()`,
              fileId: cur.fileId,
              filePath: cur.filePath,
              line: flow.line,
              role: "sanitized",
              tainted: [],
              endKind: "sanitized",
              severity: 0,
              rule: sanStop,
            };
            pushPath([...stack.map((s) => s.node), terminal], [...labels, viaLabel(taint, flow.callee, flow.via)], "sanitized", 0);
            continue;
          }

          // 危险 API：污染落地（锚点取调用点行 —— 那才是危险调用真实所在）
          const sink = matchSink(flow.callee);
          // P0 接收者守卫：裸 exec 落在 RegExp/self/正则变量接收者上时不报 RCE（消除碰撞）
          if (sink && !isRegexReceiverSink(flow.callee, flow.receiver)) {
            const terminal: TaintPathNode = {
              key: `${cur.key}#sink#${flow.callee}#${flow.line}`,
              name: `${flow.callee}()`,
              fileId: cur.fileId,
              filePath: cur.filePath,
              line: flow.line,
              role: "sink",
              tainted: [],
              endKind: sink.kind,
              severity: sink.score,
              rule: sink.rule,
            };
            pushPath(
              [...stack.map((s) => s.node), terminal],
              [...labels, viaLabel(taint, flow.callee, flow.via, ` #${flow.argIndex}`)],
              sink.kind,
              sink.score
            );
            continue;
          }

          const r = resolveCallee(g, cur, flow);
          if (!r) {
            unresolved += 1;
            continue;
          }

          // 被调方把污染写进外部状态（Rust 侧算好的 sinks）—— 低严重度落地
          if (r.fact && r.fact.sinks.length > 0) {
            const terminal: TaintPathNode = {
              key: `${r.fact.key}#sink#state#${flow.line}`,
              name: r.fact.name,
              fileId: r.fact.fileId,
              filePath: r.fact.filePath,
              line: r.fact.line,
              role: "sink",
              tainted: [r.fact.params[flow.argIndex] ?? taint],
              endKind: "sideEffect",
              severity: SIDE_EFFECT_SCORE,
              rule: r.fact.sinks[0],
            };
            pushPath(
              [...stack.map((s) => s.node), terminal],
              [...labels, `${taint} → ${r.fact.name}() #${flow.argIndex}`],
              "sideEffect",
              SIDE_EFFECT_SCORE
            );
          }

          // 路径级去重 + 环检测：当前路径上已出现过的 (函数,污染形参) 不再进入。
          // 这是 joern `taskStack.dedup.size == taskStack.size` 的等价判定 ——
          // 挡的是「同一条路径上转圈」，不挡「另一条分叉也经过这里」。
          if (!r.fact || depth + 1 > maxDepth) continue;
          const nextParam = r.fact.params[flow.argIndex];
          if (!nextParam) continue;
          const vkey = `${r.fact.key}|${nextParam}`;
          if (onPath.has(vkey)) continue;
          onPath.add(vkey);

          const hop: TaintPathNode = {
            key: `${r.fact.key}#${nextParam}`,
            name: r.fact.name,
            fileId: r.fact.fileId,
            filePath: r.fact.filePath,
            line: r.fact.line,
            role: "hop",
            tainted: [nextParam],
            severity: 0,
            symbolId: r.edge.calleeSymbolId || null,
          };
          stack.push({ fact: r.fact, taint: nextParam, node: hop });
          labels.push(viaLabel(taint, r.fact.name, flow.via, ` #${flow.argIndex}`));
          walk(r.fact, nextParam, depth + 1);
          // 回溯即释放：离开这条路径后，该节点对其它分叉重新可用。
          // 这一行是本次修复的落点 —— 缺了它，onPath 就退化回全局 visited。
          onPath.delete(vkey);
          labels.pop();
          stack.pop();
        }
      };

      walk(src.fact, param, 0);
    }
  }

  // 严重度降序，同分按路径签名稳定排序（确定性）
  paths.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    const sa = a.nodes.map((n) => n.key).join(">");
    const sb = b.nodes.map((n) => n.key).join(">");
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  const kept = paths.slice(0, maxPaths);

  return {
    paths: kept,
    stats: {
      sources: candidates.length,
      paths: kept.length,
      sinks: kept.filter((p) => p.endKind !== "sanitized").length,
      sanitized: kept.filter((p) => p.endKind === "sanitized").length,
      unresolved,
      // 任何一种预算造成路径丢失都必须体现为 truncated —— 之前只有 maxPaths/maxSources
      // 会置位，步数预算烧穿导致的漏报对用户完全不可见（画像只按 truncated 提示）。
      truncated:
        paths.length > maxPaths ||
        candidates.length > maxSources ||
        stepBudgetExhausted ||
        sourceBudgetExhausted ||
        fanOutTruncated,
      stepBudgetExhausted,
      sourceBudgetExhausted,
      fanOutTruncated,
    },
  };
}

// ─────────────────────────── 布局 ───────────────────────────

export interface TaintLayoutOptions {
  left?: number;
  top?: number;
  nodeW?: number;
  nodeH?: number;
  rowGap?: number;
  colGap?: number;
  maxPaths?: number;
}

export interface TaintLayoutNode {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  fileId: string;
  filePath: string;
  line: number;
  role: TaintRole;
  tainted: string[];
  endKind?: TaintEndKind;
  severity: number;
  rule?: string;
  symbolId?: string | null;
}

export interface TaintLayoutEdge {
  /** 起止节点在 nodes 数组中的下标 */
  from: number;
  to: number;
  label: string;
}

export interface TaintPathLayout {
  id: string;
  endKind: TaintEndKind;
  severity: number;
  nodes: TaintLayoutNode[];
  edges: TaintLayoutEdge[];
}

export interface TaintLayout {
  paths: TaintPathLayout[];
  stats: TaintStats;
}

/**
 * 把路径铺成「每条路径一列、节点自上而下」的纵向走线。
 * 与 apiTrace 同款读法：从上到下读一条链，每个节点双击直达源码。
 */
export function layoutTaintPaths(result: TaintResult, options?: TaintLayoutOptions): TaintLayout {
  const left = options?.left ?? 60;
  const top = options?.top ?? 80;
  const nodeW = options?.nodeW ?? 250;
  const nodeH = options?.nodeH ?? 46;
  const rowGap = options?.rowGap ?? 18;
  const colGap = options?.colGap ?? 70;
  const maxPaths = options?.maxPaths ?? TAINT_MAX_PATHS;

  const out: TaintPathLayout[] = [];
  const paths = result.paths.slice(0, maxPaths);
  paths.forEach((p, col) => {
    const x = left + col * (nodeW + colGap);
    const nodes: TaintLayoutNode[] = p.nodes.map((n, row) => ({
      x,
      y: top + row * (nodeH + rowGap),
      width: nodeW,
      height: nodeH,
      name: n.name,
      fileId: n.fileId,
      filePath: n.filePath,
      line: n.line,
      role: n.role,
      tainted: n.tainted,
      endKind: n.endKind,
      severity: n.severity,
      rule: n.rule,
      symbolId: n.symbolId ?? null,
    }));
    out.push({
      id: p.id,
      endKind: p.endKind,
      severity: p.severity,
      nodes,
      edges: p.edges.map((e) => ({ from: e.from, to: e.from + 1, label: e.label })),
    });
  });
  return { paths: out, stats: result.stats };
}

/** 三视图：全部 / 仅高危（score ≥ 4）/ 仅已被净化拦下的链路 */
export type TaintView = "all" | "critical" | "sanitized";

export function filterTaintPaths(result: TaintResult, view: TaintView): TaintResult {
  if (view === "all") return result;
  const paths =
    view === "critical"
      ? result.paths.filter((p) => p.endKind !== "sanitized" && p.severity >= 4)
      : result.paths.filter((p) => p.endKind === "sanitized");
  return { paths, stats: { ...result.stats, paths: paths.length } };
}
