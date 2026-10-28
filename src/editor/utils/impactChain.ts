/**
 * 影响链传播（Impact Chain · 纯函数）
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 * 画布此前的「选中联动」是**单跳无向**的：选中一个文件，点亮它 import 的和
 * import 它的直接邻居，就结束了。这回答的是「谁挨着我」，
 * 但工程师真正要问的是「**改了我，波及会传到多远**」——
 * A 调 B、B 调 C，改 A 之后 C 也可能炸，而单跳邻接把 C 完全隐藏了。
 *
 * 本模块把选中实体扩展成**有向、多跳、带跳数分级**的影响链：
 * - **上游（upstream）**：谁（间接）依赖我 → 我改了他们要回归（爆炸半径）
 * - **下游（downstream）**：我（间接）依赖谁 → 我要理解/移植的成本面
 * - 每个命中节点记录**最短跳数**（depth），画布据此做梯度着色：
 *   1 跳最亮、2 跳次之、3 跳最淡 —— 影响强度一眼可读。
 *
 * ── 双通道精度 ──────────────────────────────────────────────────────────────
 * 通道 A（精确 · callGraph）：基于 `project_call_edges` 的**符号级**调用边。
 *   「文件 A 引用了文件 B」太粗——A 里 100 个函数只有 1 个碰了 B。
 *   符号级传播能精确到「是 `parseConfig` 这条链传过来的」。
 * 通道 B（兜底 · dependency）：调用图未分析（或该语言不支持）时，
 *   退化到 `project_dependencies` 的**文件级** import 有向边。
 *   仍然是有向多跳，只是粒度粗一档，UI 会如实标注精度来源。
 *
 * ── 设计约束（与项目既有纯函数工具一致）─────────────────────────────────────
 * - 零副作用、不 import store、可直接单测
 * - 环（循环依赖 / 相互递归）不死循环：visited 按方向独立维护
 * - 有节点上限，超大项目不会把整个仓库点亮成一片白（那等于没高亮）
 */

import type { CallEdge, DataFlowFact, ProjectDependency } from "../../services/tauri";
import type { CallIndex } from "./impactGraph";
import { L } from "../../ai/aiLang";

/** 节点在影响链中的角色 */
export type ChainSide = "root" | "upstream" | "downstream" | "both";

/** 影响链的数据来源精度 */
export type ChainSource = "callGraph" | "dependency" | "none";

export interface ChainNodeInfo {
  /** 距根的最短跳数，0 = 根自身 */
  depth: number;
  side: ChainSide;
}

export interface ImpactChain {
  /** fileId → 跳数与方向 */
  files: Map<string, ChainNodeInfo>;
  /** symbolId → 跳数与方向（仅 callGraph 通道有值） */
  symbols: Map<string, ChainNodeInfo>;
  source: ChainSource;
  /** 请求的最大跳数 */
  maxDepth: number;
  /** 实际到达的最远跳数 */
  reachedDepth: number;
  /** 是否因节点上限被截断 */
  truncated: boolean;
  /** 被数据流剪枝挡下的节点数（污染在这些函数处终止，其上游未再展开） */
  pruned: number;
  counts: {
    /** 不含根文件 */
    upstreamFiles: number;
    downstreamFiles: number;
    /** 上下游合计受影响文件（不含根） */
    totalFiles: number;
    symbols: number;
  };
}

/** 文件级有向依赖索引：out = 我依赖谁；in = 谁依赖我 */
export interface FileDepIndex {
  out: Map<string, string[]>;
  in: Map<string, string[]>;
  totalEdges: number;
}

/**
 * 单次传播的节点上限。
 * 超大仓库里 3 跳传递闭包很容易命中几千个文件，全点亮 = 没高亮，
 * 而且会把 React 的 memo 优化全部击穿。600 是「一屏画布能承载的实体量级」的经验上界。
 */
export const CHAIN_NODE_LIMIT = 600;

/** 跳数 → 视觉强度（画布梯度着色 / 图例共用同一口径） */
export const CHAIN_DEPTH_STYLE: { opacity: number; label: string }[] = [
  { opacity: 1, label: "impact.depth.root" },
  { opacity: 1, label: "impact.depth.hop1" },
  { opacity: 0.82, label: "impact.depth.hop2" },
  { opacity: 0.64, label: "impact.depth.hop3" },
  { opacity: 0.5, label: "impact.depth.hop4" },
];

export function chainDepthStyle(depth: number) {
  return CHAIN_DEPTH_STYLE[Math.min(Math.max(depth, 0), CHAIN_DEPTH_STYLE.length - 1)];
}

export const CHAIN_SIDE_COLOR: Record<ChainSide, string> = {
  root: "#6366f1",
  // 上游 = 会被我波及的人 —— 用告警色，因为这是「改动风险」
  upstream: "#f59e0b",
  // 下游 = 我依赖的人 —— 用中性青色，这是「理解成本」不是风险
  downstream: "#06b6d4",
  both: "#ef4444",
};

export const CHAIN_SIDE_LABEL: Record<ChainSide, string> = {
  root: "impact.side.root",
  upstream: "impact.side.upstream",
  downstream: "impact.side.downstream",
  both: "impact.side.both",
};

/** 合并两个方向：同一节点既在上游又在下游 → both（说明存在环路） */
function mergeSide(a: ChainSide, b: ChainSide): ChainSide {
  if (a === b) return a;
  if (a === "root" || b === "root") return "root";
  return "both";
}

/** 把节点写入结果表：同一节点保留最短跳数，方向做合并 */
function upsert(map: Map<string, ChainNodeInfo>, id: string, depth: number, side: ChainSide): boolean {
  const cur = map.get(id);
  if (!cur) {
    map.set(id, { depth, side });
    return true;
  }
  if (depth < cur.depth) cur.depth = depth;
  cur.side = mergeSide(cur.side, side);
  return false;
}

/** 构建文件级有向依赖索引（通道 B） */
export function buildFileDepIndex(deps: ProjectDependency[]): FileDepIndex {
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  let total = 0;
  for (const d of deps) {
    if (!d.fromId || !d.toId || d.fromId === d.toId) continue;
    total++;
    const o = out.get(d.fromId);
    if (o) o.push(d.toId);
    else out.set(d.fromId, [d.toId]);
    const i = inn.get(d.toId);
    if (i) i.push(d.fromId);
    else inn.set(d.toId, [d.fromId]);
  }
  return { out, in: inn, totalEdges: total };
}

/** callIndex.meta 反查：fileId → 该文件参与调用图的符号 id 列表 */
export function symbolsByFileFrom(index: CallIndex): Map<string, string[]> {
  const m = new Map<string, string[]>();
  index.meta.forEach((info, symbolId) => {
    if (!info.fileId) return;
    const arr = m.get(info.fileId);
    if (arr) arr.push(symbolId);
    else m.set(info.fileId, [symbolId]);
  });
  return m;
}

function emptyChain(maxDepth: number, source: ChainSource = "none"): ImpactChain {
  return {
    files: new Map(),
    symbols: new Map(),
    source,
    maxDepth,
    reachedDepth: 0,
    truncated: false,
    pruned: 0,
    counts: { upstreamFiles: 0, downstreamFiles: 0, totalFiles: 0, symbols: 0 },
  };
}

/** 统计收尾：从 files/symbols 表推导 counts / reachedDepth */
function finalize(chain: ImpactChain): ImpactChain {
  let up = 0;
  let down = 0;
  let reached = 0;
  chain.files.forEach((info) => {
    if (info.depth > reached) reached = info.depth;
    if (info.depth === 0) return;
    if (info.side === "upstream") up++;
    else if (info.side === "downstream") down++;
    else {
      up++;
      down++;
    }
  });
  chain.symbols.forEach((info) => {
    if (info.depth > reached) reached = info.depth;
  });
  const rootCount = [...chain.files.values()].filter((f) => f.depth === 0).length;
  chain.reachedDepth = reached;
  chain.counts = {
    upstreamFiles: up,
    downstreamFiles: down,
    totalFiles: Math.max(0, chain.files.size - rootCount),
    symbols: Math.max(0, chain.symbols.size),
  };
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// 数据流闸门（过程间分析的精度分水岭）
//
// 调用可达 ≠ 数据可达。调用图里有大量「吃进去不吐出来」的边：
//
//   handleScan(payload) ──▶ logger.info(msg)   // 数据进去了，出不来
//
// 改 `payload` 的结构，`logger.info` 的**其他**调用方毫发无损 —— 污染在
// logger.info 这里就终止了。后端 `analyze_data_flow` 为每个函数产出
// 「输入 → 输出」摘要（IFDS function summary），这里把摘要接到调用图上：
// 上游传播遇到**非透传函数**就停止扩散（该函数自身仍算受影响）。
//
// 为什么只剪上游、不剪下游：上游是「爆炸半径」（改我会炸谁），语义上就是
// 数据/行为向外传播，剪枝有明确依据；下游是「我依赖谁」的理解成本面，
// 即使被调函数不回传数据，我依然依赖它 —— 剪掉反而丢信息。
// ─────────────────────────────────────────────────────────────────────────────

/** 数据流闸门：哪些函数会让污染继续往上游流 */
export interface FlowGate {
  /** 阻断函数集合，key = `${fileId}::${functionName}` */
  blocking: Set<string>;
  /** 有摘要覆盖的函数数（UI 展示分析覆盖率） */
  covered: number;
}

/** 闸门 key：数据流摘要与调用图元信息的共同锚点 */
export function flowKey(fileId: string, functionName: string): string {
  return `${fileId}::${functionName}`;
}

/**
 * 函数是否把形参写进了外部状态（`this.cache = v` / `self.blocks.push(v)`）。
 *
 * 后端把 sinks 序列化成 JSON 数组字符串，空集就是字面量 `"[]"`
 * （与 `data_flow.rs` 里 `f.sinks != "[]"` 的统计口径一致）。
 */
function writesExternalState(fact: DataFlowFact): boolean {
  const s = (fact.sinks ?? "").trim();
  return s.length > 0 && s !== "[]";
}

/**
 * 由后端数据流摘要构建闸门。
 *
 * **保守原则**：只把「明确判定为不透传」的函数放进 blocking。
 * 没有摘要的函数（不支持 AST 的语言、解析失败、匿名函数）一律放行 ——
 * 分析能力缺失时宁可高估影响面，也绝不让用户漏掉真实风险。
 *
 * 同名多定义（重载 / 同文件内重复名）只要有**任一**定义是透传的，
 * 整体按透传处理，同样是保守方向。
 *
 * **写外部状态的函数一律放行**（真实仓库探针暴露的漏判）。后端的
 * `propagates()` 只回答「形参有没有流到返回值」，而 setter 这类函数
 * 走的是另一条出口 —— 堆：
 *
 *   fn add_block(&mut self, name: u32) { self.blocks.push(name); }   // propagates = false
 *
 * 它不回传数据，但调用方手上的对象状态被改了，改动照样往外扩散。
 * 把它当阻断点会真实地漏掉影响面，而漏报正是这套闸门最不能犯的错。
 * 画像侧的 `roleOf` 早就把这类函数归为 sink 而非 blocker，这里对齐口径。
 */
export function buildFlowGate(facts: DataFlowFact[]): FlowGate {
  const transparent = new Set<string>();
  const blocking = new Set<string>();
  for (const f of facts) {
    if (!f.fileId || !f.functionName || f.functionName === "(anonymous)") continue;
    const key = flowKey(f.fileId, f.functionName);
    if (f.propagates || writesExternalState(f)) transparent.add(key);
    else blocking.add(key);
  }
  // 任一定义透传 → 整体放行
  transparent.forEach((k) => blocking.delete(k));
  return { blocking, covered: transparent.size + blocking.size };
}

/**
 * 通道 A：符号级调用图传播
 *
 * 根文件内所有参与调用图的符号同时作为 BFS 起点（多源 BFS），
 * 文件的 depth 取「它内部任一符号被触达的最短跳数」。
 *
 * 传入 `gate` 时启用数据流剪枝：上游方向命中阻断函数即停止继续展开。
 */
export function chainFromCallGraph(
  index: CallIndex,
  rootFileIds: string[],
  maxDepth: number,
  symbolsByFile?: Map<string, string[]>,
  gate?: FlowGate | null
): ImpactChain {
  const chain = emptyChain(maxDepth, "callGraph");
  if (rootFileIds.length === 0 || maxDepth < 1) return finalize(chain);

  const byFile = symbolsByFile ?? symbolsByFileFrom(index);
  const rootSet = new Set(rootFileIds);
  const roots: string[] = [];
  for (const fid of rootFileIds) {
    chain.files.set(fid, { depth: 0, side: "root" });
    const syms = byFile.get(fid);
    if (syms) {
      for (const s of syms) {
        chain.symbols.set(s, { depth: 0, side: "root" });
        roots.push(s);
      }
    }
  }
  // 根文件在调用图里一个符号都没有（纯类型文件 / 未解析语言）→ 交给兜底通道
  if (roots.length === 0) return finalize(emptyChain(maxDepth, "none"));

  let budget = CHAIN_NODE_LIMIT;

  const walk = (side: Exclude<ChainSide, "root" | "both">) => {
    const visited = new Set<string>(roots);
    let frontier = roots;
    for (let depth = 1; depth <= maxDepth && frontier.length > 0 && budget > 0; depth++) {
      const next: string[] = [];
      for (const cur of frontier) {
        const edges: CallEdge[] | undefined =
          side === "upstream" ? index.byCallee.get(cur) : index.byCaller.get(cur);
        if (!edges) continue;
        for (const e of edges) {
          const nid = side === "upstream" ? e.callerSymbolId : e.calleeSymbolId;
          if (!nid || visited.has(nid)) continue;
          visited.add(nid);
          if (budget-- <= 0) {
            chain.truncated = true;
            break;
          }
          upsert(chain.symbols, nid, depth, side);
          const fid = side === "upstream" ? e.callerFileId : e.calleeFileId;
          if (fid && !rootSet.has(fid)) upsert(chain.files, fid, depth, side);
          // 数据流剪枝：该节点自身受影响，但它不把数据传出去 → 不再向外扩散
          if (side === "upstream" && gate && gate.blocking.size > 0) {
            const meta = index.meta.get(nid);
            if (meta && gate.blocking.has(flowKey(meta.fileId, meta.name))) {
              chain.pruned++;
              continue;
            }
          }
          next.push(nid);
        }
        if (budget <= 0) break;
      }
      frontier = next;
    }
  };

  walk("upstream");
  walk("downstream");
  return finalize(chain);
}

/** 通道 B：文件级 import 有向边传播（调用图缺席时的兜底） */
export function chainFromDependencies(
  idx: FileDepIndex,
  rootFileIds: string[],
  maxDepth: number
): ImpactChain {
  const chain = emptyChain(maxDepth, "dependency");
  if (rootFileIds.length === 0 || maxDepth < 1) return finalize(chain);

  const rootSet = new Set(rootFileIds);
  for (const fid of rootFileIds) chain.files.set(fid, { depth: 0, side: "root" });

  let budget = CHAIN_NODE_LIMIT;

  const walk = (side: Exclude<ChainSide, "root" | "both">) => {
    const visited = new Set<string>(rootFileIds);
    let frontier = rootFileIds;
    for (let depth = 1; depth <= maxDepth && frontier.length > 0 && budget > 0; depth++) {
      const next: string[] = [];
      for (const cur of frontier) {
        // upstream = 谁 import 我（in 边）；downstream = 我 import 谁（out 边）
        const neighbors = side === "upstream" ? idx.in.get(cur) : idx.out.get(cur);
        if (!neighbors) continue;
        for (const nid of neighbors) {
          if (visited.has(nid)) continue;
          visited.add(nid);
          if (budget-- <= 0) {
            chain.truncated = true;
            break;
          }
          if (!rootSet.has(nid)) upsert(chain.files, nid, depth, side);
          next.push(nid);
        }
        if (budget <= 0) break;
      }
      frontier = next;
    }
  };

  walk("upstream");
  walk("downstream");
  return finalize(chain);
}

export interface BuildChainOptions {
  rootFileIds: string[];
  maxDepth: number;
  callIndex?: CallIndex | null;
  fileDepIndex?: FileDepIndex | null;
  symbolsByFile?: Map<string, string[]> | null;
  /** 强制使用文件级通道（UI 上允许用户显式降级对比） */
  preferFileLevel?: boolean;
  /** 数据流闸门：传入则启用上游剪枝（仅符号级通道有效） */
  flowGate?: FlowGate | null;
}

/**
 * 主入口：优先走符号级精确通道，不可用时自动降级到文件级
 *
 * 「不可用」的判定不是「有没有调用边」，而是「**根文件在调用图里有没有符号**」——
 * 一个 Rust 项目扫过调用图，不代表你选中的那个 .md 或 .json 也在图里。
 */
export function buildImpactChain(opts: BuildChainOptions): ImpactChain {
  const { rootFileIds, maxDepth } = opts;
  if (rootFileIds.length === 0 || maxDepth < 1) return emptyChain(Math.max(maxDepth, 0));

  if (!opts.preferFileLevel && opts.callIndex && opts.callIndex.totalEdges > 0) {
    const viaCalls = chainFromCallGraph(
      opts.callIndex,
      rootFileIds,
      maxDepth,
      opts.symbolsByFile ?? undefined,
      opts.flowGate ?? null
    );
    if (viaCalls.source === "callGraph") return viaCalls;
  }

  if (opts.fileDepIndex && opts.fileDepIndex.totalEdges > 0) {
    return chainFromDependencies(opts.fileDepIndex, rootFileIds, maxDepth);
  }

  return emptyChain(maxDepth);
}

/** 一句话结论（画布图例 / 状态栏 / toast 共用同一口径，随 UI 语言） */
export function summarizeChain(chain: ImpactChain): string {
  if (chain.source === "none" || chain.counts.totalFiles === 0) {
    return L(
      "影响链：未发现跨文件传播（孤立节点或数据未分析）",
      "Impact chain: no cross-file propagation (isolated node or data not analyzed)",
    );
  }
  const acc = L(
    chain.source === "callGraph" ? "符号级" : "文件级",
    chain.source === "callGraph" ? "Symbol-level" : "File-level",
  );
  const parts = [
    L(`${acc}影响链 ${chain.reachedDepth} 跳`, `${acc} chain ${chain.reachedDepth} hop(s)`),
    L(`受影响 ${chain.counts.upstreamFiles} 文件`, `${chain.counts.upstreamFiles} files affected`),
    L(`依赖 ${chain.counts.downstreamFiles} 文件`, `${chain.counts.downstreamFiles} dependencies`),
  ];
  if (chain.source === "callGraph" && chain.counts.symbols > 0) {
    parts.push(L(`${chain.counts.symbols} 个函数`, `${chain.counts.symbols} functions`));
  }
  if (chain.pruned > 0) parts.push(L(`数据流剪枝 ${chain.pruned} 处`, `data-flow pruned ${chain.pruned}`));
  if (chain.truncated) parts.push(L(`已截断至 ${CHAIN_NODE_LIMIT} 节点`, `truncated to ${CHAIN_NODE_LIMIT} nodes`));
  return parts.join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// 测试影响分析（TIA · Test Impact Analysis）
//
// 影响链算出「改这个文件会波及谁」之后，最直接的工程价值是回答下一句：
// **「那我该跑哪些测试？」**
// 大厂 CI 里这套叫 Test Impact Analysis —— 不再全量跑测试套件，
// 只跑落在改动影响面内的用例，把 CI 从小时级压到分钟级。
//
// 这里用的是「测试文件也是代码文件」这一事实：测试文件同样参与依赖/调用图，
// 只要它落在上游影响面里，就说明它（间接）覆盖了被改的代码。
// ─────────────────────────────────────────────────────────────────────────────

/** 多语言测试文件识别（TS/JS/Rust/Python/Go/Java 常见约定） */
const TEST_PATH_PATTERNS: RegExp[] = [
  /(^|\/)__tests__\//i,
  /(^|\/)tests?\//i,
  /(^|\/)spec\//i,
  /\.test\.[cm]?[jt]sx?$/i,
  /\.spec\.[cm]?[jt]sx?$/i,
  /_test\.(rs|go|py)$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /Test[s]?\.java$/,
  /(^|\/)conftest\.py$/i,
];

export function isTestPath(relPath: string): boolean {
  if (!relPath) return false;
  return TEST_PATH_PATTERNS.some((re) => re.test(relPath));
}

export interface TestImpactItem {
  fileId: string;
  relPath: string;
  depth: number;
}

export interface TestImpactReport {
  /** 落在影响面内的测试文件，按跳数升序 */
  tests: TestImpactItem[];
  /** 影响面内的非测试文件数（用来判断「有覆盖 vs 无覆盖」） */
  impactedNonTestFiles: number;
  /** 覆盖判定：影响面里一个测试都没有 = 这次改动裸奔 */
  uncovered: boolean;
}

/**
 * 从影响链中筛出需要回归的测试
 *
 * @param chain      已算好的影响链
 * @param pathOf     fileId → 相对路径（画布只持有 id，路径要外部提供）
 * @param opts.includeDownstream 默认 false —— 只有**上游**测试才是「覆盖我的测试」，
 *                   下游是我依赖的东西，跑它们的测试没意义
 */
export function testImpactOf(
  chain: ImpactChain | null,
  pathOf: (fileId: string) => string | undefined,
  opts?: { includeDownstream?: boolean }
): TestImpactReport {
  const tests: TestImpactItem[] = [];
  let nonTest = 0;
  if (!chain) return { tests, impactedNonTestFiles: 0, uncovered: true };

  chain.files.forEach((info, fileId) => {
    const rel = pathOf(fileId);
    if (!rel) return;
    const relevant =
      info.depth === 0 ||
      info.side === "upstream" ||
      info.side === "both" ||
      info.side === "root" ||
      (opts?.includeDownstream === true && info.side === "downstream");
    if (!relevant) return;
    if (isTestPath(rel)) {
      if (info.depth > 0) tests.push({ fileId, relPath: rel, depth: info.depth });
    } else if (info.depth > 0) {
      nonTest++;
    }
  });

  tests.sort((a, b) => a.depth - b.depth || a.relPath.localeCompare(b.relPath));
  return { tests, impactedNonTestFiles: nonTest, uncovered: tests.length === 0 };
}

/** 回归范围的一句话结论 */
export function summarizeTestImpact(report: TestImpactReport): string {
  if (report.tests.length === 0) {
    return report.impactedNonTestFiles > 0
      ? L(
          `影响面内没有任何测试文件 —— 这次改动没有回归保护，建议先补测试`,
          "No test files in the impact area — this change has no regression protection; consider adding tests",
        )
      : L(`影响面为空，无需回归`, "Impact area empty, no regression needed");
  }
  const depths = report.tests.map((t) => t.depth);
  return L(
    `建议回归 ${report.tests.length} 个测试文件（最近 ${Math.min(...depths)} 跳，最远 ${Math.max(...depths)} 跳）`,
    `Suggest running ${report.tests.length} test files (nearest ${Math.min(...depths)} hop(s), farthest ${Math.max(...depths)} hop(s))`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TIA → 可运行命令（把分析结论真正落到代码动作上）
//
// 上一步 `testImpactOf` 只给出「该跑哪些测试文件」的清单，但工程师拿到清单还要
// 自己翻译成命令。这一步把清单直接编译成**各语言的真实可运行命令 + CI 片段**，
// 让「每一次分析都落实在代码上」闭环：选中改动 → 影响链 → 回归范围 → 一行命令即可跑。
// 全部为纯函数，可直接单测，不依赖任何 store。
// ─────────────────────────────────────────────────────────────────────────────

/** 支持的测试运行器（按本项目/主流生态常见约定识别） */
export type TestRunner = "vitest" | "cargo" | "go" | "pytest" | "maven" | "unknown";

export interface TestCommandEntry {
  fileId: string;
  relPath: string;
  depth: number;
  runner: TestRunner;
  /** 单文件可运行命令 */
  command: string;
}

export interface TestCommandGroup {
  runner: TestRunner;
  label: string;
  /** 该运行器下所有用例命令（每行一条），可直接粘贴运行 */
  command: string;
  tests: TestCommandEntry[];
}

export interface TestCommandPlan {
  groups: TestCommandGroup[];
  /** 所有命令按运行器顺序拼接（去重行），CI 脚本主体 */
  flatCommands: string[];
  /** 全部命令文本（\n 连接） */
  allCommandsText: string;
}

const RUNNER_LABEL: Record<TestRunner, string> = {
  vitest: "Vitest",
  cargo: "Cargo test",
  go: "Go test",
  pytest: "pytest",
  maven: "Maven",
  unknown: "impact.runner.unknown",
};

/** 展示顺序：前端生态优先，再到系统语言，未知放最后 */
const RUNNER_ORDER: TestRunner[] = ["vitest", "cargo", "go", "pytest", "maven", "unknown"];

/** 由测试文件路径识别其测试运行器（复用 isTestPath 的测试约定，但不依赖它） */
export function detectTestRunner(relPath: string): TestRunner {
  if (!relPath) return "unknown";
  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(relPath)) return "vitest";
  if (/\.rs$/i.test(relPath) && (/_test\.rs$/i.test(relPath) || relPath.includes("/tests/"))) {
    return "cargo";
  }
  if (/_test\.go$/i.test(relPath)) return "go";
  if (
    /\.py$/i.test(relPath) &&
    (/_test\.py$/i.test(relPath) || /(^|\/)tests?\//i.test(relPath) || /conftest\.py$/i.test(relPath))
  ) {
    return "pytest";
  }
  if (/Tests?\.java$/i.test(relPath)) return "maven";
  return "unknown";
}

/** 为单个测试文件生成可运行命令（路径带空格时加引号） */
export function buildSingleTestCommand(runner: TestRunner, relPath: string): string {
  const p = relPath.includes(" ") ? `"${relPath}"` : relPath;
  switch (runner) {
    case "vitest":
      // Vite 项目：npx vitest run <路径> 精确到文件
      return `npx vitest run ${p}`;
    case "cargo": {
      // tests/ 下的集成测试 → --test <name>；其余按 crate::path 跑该模块
      const m = relPath.match(/\/tests\/([^/]+)\.rs$/i);
      if (m) return `cargo test --test ${m[1]}`;
      const base = relPath.replace(/\.rs$/i, "").replace(/\//g, "::");
      return `cargo test ${base}`;
    }
    case "go": {
      const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : ".";
      return `go test ./${dir}`;
    }
    case "pytest":
      return `python -m pytest ${p}`;
    case "maven": {
      const cls = relPath.split("/").pop()?.replace(/\.java$/i, "") ?? "Test";
      return `mvn test -Dtest=${cls}`;
    }
    default:
      return L(`# 无法识别测试运行器，请手动运行：${relPath}`, `# Cannot detect test runner; run manually: ${relPath}`);
  }
}

/** 把 TIA 报告编译成可运行命令计划（按运行器分组，便于分层复制） */
export function buildTestCommands(report: TestImpactReport): TestCommandPlan {
  const byRunner = new Map<TestRunner, TestCommandEntry[]>();
  for (const t of report.tests) {
    const runner = detectTestRunner(t.relPath);
    const entry: TestCommandEntry = {
      fileId: t.fileId,
      relPath: t.relPath,
      depth: t.depth,
      runner,
      command: buildSingleTestCommand(runner, t.relPath),
    };
    const arr = byRunner.get(runner);
    if (arr) arr.push(entry);
    else byRunner.set(runner, [entry]);
  }

  const groups: TestCommandGroup[] = [];
  for (const runner of RUNNER_ORDER) {
    const tests = byRunner.get(runner);
    if (!tests || tests.length === 0) continue;
    groups.push({
      runner,
      label: RUNNER_LABEL[runner],
      command: tests.map((x) => x.command).join("\n"),
      tests,
    });
  }

  const flatCommands = groups.flatMap((g) => g.tests.map((x) => x.command));
  return { groups, flatCommands, allCommandsText: flatCommands.join("\n") };
}

/** 生成可直接落地的 bash 回归脚本（CI 片段） */
export function buildCIPipelineScript(report: TestImpactReport): string {
  if (report.tests.length === 0) {
    return L("# 影响面内没有测试文件，无需生成回归命令（建议先为改动补测试）", "# No test files in the impact area; no regression command generated (consider adding tests for the change)");
  }
  const plan = buildTestCommands(report);
  return [
    "#!/usr/bin/env bash",
    L("# 测试影响分析（TIA）自动生成 —— 仅回归本次改动影响面内的用例", "# Auto-generated by Test Impact Analysis (TIA) — only regresses test cases inside the impact area"),
    L("# 由 sight-folio 影响链引擎生成，可加入 CI 步骤或本地预提交钩子", "# Generated by the sight-folio impact-chain engine; can be added to CI steps or local pre-commit hooks"),
    "set -e",
    "",
    ...plan.flatCommands,
    "",
  ].join("\n");
}

/** 生成 GitHub Actions 步骤片段（CI 配置，可粘贴进 .github/workflows/*.yml） */
export function buildGitHubActionStep(report: TestImpactReport): string {
  if (report.tests.length === 0) {
    return L("# 影响面内没有测试文件，无需生成回归步骤（建议先为改动补测试）", "# No test files in the impact area; no regression step generated (consider adding tests for the change)");
  }
  const plan = buildTestCommands(report);
  const runLines = plan.flatCommands.map((c) => `          ${c}`).join("\n");
  return [
    `      - name: "${L("TIA 回归 · 影响面内 ", "TIA regression · ")}${report.tests.length} ${L("个用例", "case(s)")}"`,
    "        run: |",
    runLines,
    "",
  ].join("\n");
}

/** 供画布 O(1) 查询的扁平视图（避免渲染循环里反复解构 Map<…, object>） */
export interface ChainLookup {
  depthOf: (fileId: string) => number | null;
  sideOf: (fileId: string) => ChainSide | null;
  has: (fileId: string) => boolean;
  fileIds: Set<string>;
  size: number;
}

export function chainLookup(chain: ImpactChain | null): ChainLookup {
  const files = chain?.files ?? new Map<string, ChainNodeInfo>();
  const ids = new Set(files.keys());
  return {
    depthOf: (fileId: string) => files.get(fileId)?.depth ?? null,
    sideOf: (fileId: string) => files.get(fileId)?.side ?? null,
    has: (fileId: string) => files.has(fileId),
    fileIds: ids,
    size: ids.size,
  };
}
