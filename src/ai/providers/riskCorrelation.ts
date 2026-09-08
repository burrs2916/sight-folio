import type { AiContextSection, AiFocusReport, AiFocusTarget, AiFocusDimensionHit } from "../contextTypes";
import { cell, makeSection, mdTable, type ScanSnapshot } from "./scanSections";
import { buildStageCoverage, type ScanStageCoverage } from "./scanCoverage";
import { t, getLang } from "../../i18n";
import { H, L } from "../aiLang";

/**
 * 跨维度风险交叉 —— 在**全量数据**上找「多维共振」的文件。
 *
 * 为什么必须由扫描侧算，而不能交给 Agent 自己交叉
 * ------------------------------------------------
 * 上下文包的每个分节都只给 Top-15，这是省 token 的必要取舍。但它带来一个
 * Agent 无论多聪明都救不回来的**系统性失真**：
 *
 *   某个文件复杂度排第 20、变更频率排第 18、重复代码排第 25、技术债排第 22——
 *   它每一个单项都进不了任何一节的 Top-15，于是在整份上下文里一次都不出现；
 *   而它恰恰是「四个维度同时处在全项目前 5%」的头号重构目标。
 *
 * 让 Agent 读六七个分节再自己求交集，既要花几千 token，求出来的还是
 * 「Top-15 之间的交集」——那个交集在中大型项目上经常是空的。数据根本没给它，
 * 这不是提示词能补的。
 *
 * 所以交叉必须发生在**截断之前**：这里对全量文件逐维打分、算共振、排完序再截断输出。
 * 一节的成本，顶掉六节的阅读量，且结论比 Agent 自己交叉更准。
 *
 * 三条设计底线
 * ------------
 * 1. **盲区维度不参与打分，权重重新归一**。没有 Git 历史就把变更频率算成 0 分，
 *    等于系统性地把所有文件的分数一起压低——排名会被扭曲成「只看复杂度」，
 *    而 Agent 完全看不出来。宁可少一个维度，也不能让缺失数据伪装成「表现良好」。
 * 2. **共振维度数排在综合分之前**。加权分依赖权重，而权重是可争议的；
 *    「四个独立维度同时报警」这件事本身几乎不依赖权重，是更硬的信号。
 * 3. **输出路径一律取自 files 表的 relPath**。Agent 会直接拿这些路径写进洞察 refs，
 *    而 refs 在落库时要与 project_files 逐条核对；这里但凡拼出一个不在表里的路径，
 *    下游就是一次拒收。
 */

/** 「该维度上的高位」= 前 10%；小项目文件太少，至少放行前两名 */
const HOT_DECILE = 10;
const HOT_RANK_FLOOR = 2;
/** 明细行数上限 */
const TOP_N = 15;
/** 维度共现表行数上限 */
const TOP_PAIRS = 8;

export interface RiskDimensionDef {
  key: string;
  /** 语言包键（risk.dim.<key>.label），消费点 t() 取当前语言 */
  labelKey: string;
  /** 加权综合分里的权重（仅用于同共振数内部排序） */
  weight: number;
  /** 绝对信号下限：低于它一律不算高位，避免稀疏维度把「只有 1 条 TODO」捧成 P99 */
  minSignal: number;
  /** 供养该维度的扫描阶段 key（与 buildStageCoverage 对齐），阶段不可用则整维度排除 */
  stage: string;
  /** 单位语言包键（risk.dim.<key>.unit），消费点 t() 取当前语言 */
  unitKey: string;
}

/**
 * 维度定义。
 *
 * 权重的排序理由（数值本身不必精确，相对次序才有意义）：
 *   复杂度 / 变更频率并列最高——「既难改又常改」是重构收益的经典判据；
 *   扇入紧随其后：它决定改错了会波及多远；
 *   审查发现是外部规则给出的直接证据，高于「重复 / 技术债」这类需要人判断收益的项；
 *   死代码最低：清理成本低，但收益也低，不该把它顶到榜首。
 */
export const RISK_DIMENSIONS: RiskDimensionDef[] = [
  { key: "complexity", labelKey: "risk.dim.complexity", weight: 1.0, minSignal: 10, stage: "metrics", unitKey: "risk.dim.complexity.unit" },
  { key: "churn", labelKey: "risk.dim.churn", weight: 1.0, minSignal: 5, stage: "git", unitKey: "risk.dim.churn.unit" },
  { key: "fanIn", labelKey: "risk.dim.fanIn", weight: 0.9, minSignal: 5, stage: "symbolRefs", unitKey: "risk.dim.fanIn.unit" },
  { key: "findings", labelKey: "risk.dim.findings", weight: 0.8, minSignal: 2, stage: "review", unitKey: "risk.dim.findings.unit" },
  { key: "clones", labelKey: "risk.dim.clones", weight: 0.7, minSignal: 20, stage: "clones", unitKey: "risk.dim.clones.unit" },
  { key: "techDebt", labelKey: "risk.dim.techDebt", weight: 0.6, minSignal: 2, stage: "techDebt", unitKey: "risk.dim.techDebt.unit" },
  { key: "coupling", labelKey: "risk.dim.coupling", weight: 0.6, minSignal: 1, stage: "changeCoupling", unitKey: "risk.dim.coupling.unit" },
  { key: "deadCode", labelKey: "risk.dim.deadCode", weight: 0.4, minSignal: 1, stage: "deadCode", unitKey: "risk.dim.deadCode.unit" },
];

export interface RiskDimensionState extends RiskDimensionDef {
  available: boolean;
  /** 不可用时的原因，直接来自覆盖度体检，口径与 coverage 分节一致 */
  reason?: string;
  /** 该维度上取值非零的文件数 */
  nonZero: number;
  max: number;
}

export interface RiskDimensionHit {
  value: number;
  /** 分位：严格低于该值的文件占比（0..100），分母含取值为 0 的文件 */
  pct: number;
  /** 该维度内的名次（并列同名次） */
  rank: number;
  /** 是否处于该维度高位（前 10%，且达到绝对信号下限） */
  hot: boolean;
}

export interface RiskFileScore {
  filePath: string;
  codeLines: number;
  /** 加权分位综合分 0..100 */
  score: number;
  /** 处于高位的维度数 */
  resonance: number;
  resonantKeys: string[];
  dims: Record<string, RiskDimensionHit>;
}

export interface RiskCorrelationResult {
  dimensions: RiskDimensionState[];
  /** 因阶段盲区被排除、未参与打分的维度 */
  excluded: RiskDimensionState[];
  /** 已按「共振数 → 综合分」排序的全部文件（调用方自行截断） */
  files: RiskFileScore[];
  scoredFiles: number;
  /** 至少两个维度同时高位的文件数 */
  resonantFiles: number;
  cooccurrence: Array<{ a: string; b: string; count: number }>;
  /** 名次进入前多少名才算「该维度高位」，随项目规模浮动 */
  hotRankLimit: number;
}

/** 审查严重度 → 权重：critical/error 才是真问题，info/hint 只作微弱加权 */
function severityWeight(sev: string): number {
  switch ((sev || "").toLowerCase()) {
    case "critical":
    case "error":
      return 3;
    case "warning":
      return 1;
    default:
      return 0.3;
  }
}

/** 技术债严重度 → 权重：FIXME/HACK 被扫描器标为 critical，价值远高于普通 TODO */
function debtWeight(sev: string): number {
  switch ((sev || "").toLowerCase()) {
    case "critical":
      return 3;
    case "warning":
      return 1.5;
    default:
      return 1;
  }
}

/** 累加到 map（缺省 0） */
function bump(map: Map<string, number>, key: string | undefined | null, delta: number): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + delta);
}

/**
 * 分位表：把一组值排序一次，之后任意取值都能 O(log n) 换算成分位。
 *
 * 用**严格小于**的口径（分母含取值为 0 的文件）：取值为 0 的文件在该维度上分位就是 0，
 * 对综合分的贡献也是 0。若改用「小于等于」，一个技术债为 0 的文件会在
 * 「全项目 90% 文件都没有技术债」时拿到 P90，凭空被这一维抬高综合分——
 * 那是把「没有问题」误算成「表现优异」。
 *
 * 至于「高位」判定不看这个分位而看名次，见 hotRankLimit：并列取值必须同进同出，
 * 三个复杂度完全相同的文件不能有两个算高位、一个不算。
 */
class Percentiles {
  private sorted: number[];

  constructor(values: number[]) {
    this.sorted = [...values].sort((a, b) => a - b);
  }

  /** 严格小于 value 的元素占比 */
  pctOf(value: number): number {
    const n = this.sorted.length;
    if (n === 0) return 0;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return Math.round((lo / n) * 1000) / 10;
  }
}

/**
 * 全量多维交叉。纯函数，输入只有扫描快照，便于回归测试钉住排序语义。
 */
export function computeRiskCorrelation(
  s: ScanSnapshot,
  stages?: ScanStageCoverage[],
): RiskCorrelationResult {
  const stageList = stages ?? buildStageCoverage(s);
  const stageByKey = new Map(stageList.map((st) => [st.key, st]));

  // 文件全集只认 files 表里的非目录项：Agent 会把这里的路径原样写进 refs，
  // 而 refs 落库时要与 project_files 逐条核对，拼出表外路径等于制造一次拒收。
  const codeFiles = s.files.filter((f) => !f.isDirectory);
  const known = new Set(codeFiles.map((f) => f.relPath));
  const linesByPath = new Map(codeFiles.map((f) => [f.relPath, f.lineCount || 0]));

  // 只统计落在 files 表里的路径，其余静默忽略（多为分析器给出的绝对路径或已删除文件）
  const only = (path: string | null | undefined): string | null =>
    path && known.has(path) ? path : null;

  const raw: Record<string, Map<string, number>> = {};
  for (const d of RISK_DIMENSIONS) raw[d.key] = new Map<string, number>();

  for (const m of s.metrics) {
    const p = only(m.filePath);
    if (!p) continue;
    const cc = m.maxFunctionCc > 0 ? m.maxFunctionCc : m.cyclomaticComplexity;
    // 同一路径多条度量时取最大，不累加：复杂度是「这个文件最难的那块」，不是总量
    raw.complexity.set(p, Math.max(raw.complexity.get(p) ?? 0, cc));
  }

  for (const g of s.gitChurn) {
    const p = only(g.filePath);
    if (p) raw.churn.set(p, Math.max(raw.churn.get(p) ?? 0, g.commitCount));
  }

  // 扇入按「不同的引用方文件数」去重计，而不是引用次数：
  // 同一个调用方写了 40 次调用，影响面仍然只有一个文件。
  const fanInSets = new Map<string, Set<string>>();
  for (const r of s.symbolRefs) {
    const to = only(r.toFilePath);
    if (!to || r.fromFilePath === r.toFilePath) continue;
    let set = fanInSets.get(to);
    if (!set) {
      set = new Set<string>();
      fanInSets.set(to, set);
    }
    set.add(r.fromFilePath);
  }
  for (const [p, set] of fanInSets) raw.fanIn.set(p, set.size);

  // 审查发现的 targetId 可能指向文件，也可能指向符号，两张索引都要建
  const fileIdToPath = new Map(codeFiles.map((f) => [f.id, f.relPath]));
  const symbolIdToPath = new Map(s.symbols.map((sym) => [sym.id, sym.filePath]));
  for (const f of s.findings) {
    const p = only(fileIdToPath.get(f.targetId) ?? symbolIdToPath.get(f.targetId));
    if (p) bump(raw.findings, p, severityWeight(f.severity));
  }

  for (const c of s.clones) {
    const p = only(c.filePath);
    // 用重复行数而非片段条数：抽公共实现的收益跟着行数走
    if (p) bump(raw.clones, p, c.lineCount || 0);
  }

  for (const t of s.techDebt) {
    const p = only(t.filePath);
    if (p) bump(raw.techDebt, p, debtWeight(t.severity));
  }

  for (const c of s.changeCoupling) {
    if (c.couplingKind !== "hidden") continue;
    const a = only(c.fileAPath);
    const b = only(c.fileBPath);
    if (a) bump(raw.coupling, a, 1);
    if (b) bump(raw.coupling, b, 1);
  }

  for (const d of s.deadSymbols) {
    const p = only(d.filePath);
    if (p) bump(raw.deadCode, p, 1);
  }

  // 维度可用性直接复用覆盖度体检的判定：口径必须与 coverage 分节完全一致，
  // 否则会出现「coverage 说 Git 是盲区，风险矩阵却把变更频率算进了分」这种自相矛盾。
  const states: RiskDimensionState[] = RISK_DIMENSIONS.map((d) => {
    const st = stageByKey.get(d.stage);
    const values = [...raw[d.key].values()];
    const unavailable = st?.quality.status === "unavailable";
    return {
      ...d,
      available: !unavailable && values.length > 0,
      reason: unavailable
        ? (st?.quality.reason ?? L(
            `${t(st?.labelKey ?? d.labelKey)}阶段不可用`,
            `${t(st?.labelKey ?? d.labelKey)} stage unavailable`,
          ))
        : values.length === 0
          ? L("本项目在该维度上没有任何非零取值", "This project has no non-zero value on this dimension")
          : undefined,
      nonZero: values.length,
      max: values.length ? Math.max(...values) : 0,
    };
  });

  const active = states.filter((d) => d.available);
  const excluded = states.filter((d) => !d.available);
  const weightSum = active.reduce((sum, d) => sum + d.weight, 0);

  // 高位 = 该维度前 10%。名次用**并列名次**（取值相同者名次相同）：
  // 三个复杂度一模一样的文件，不能因为排序碰巧把谁放前面就判两个高位、一个不高位。
  const hotRankLimit = Math.max(HOT_RANK_FLOOR, Math.ceil(codeFiles.length / HOT_DECILE));

  // 每个维度算一次分位表 + 一份并列名次表
  const pctTables = new Map<string, Percentiles>();
  const rankByPath = new Map<string, Map<string, number>>();
  for (const d of active) {
    const perFile = codeFiles.map((f) => raw[d.key].get(f.relPath) ?? 0);
    pctTables.set(d.key, new Percentiles(perFile));
    const ranked = [...raw[d.key].entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const ranks = new Map<string, number>();
    let lastValue = Number.NaN;
    let lastRank = 0;
    ranked.forEach(([p, v], i) => {
      if (v !== lastValue) {
        lastRank = i + 1;
        lastValue = v;
      }
      ranks.set(p, lastRank);
    });
    rankByPath.set(d.key, ranks);
  }

  const files: RiskFileScore[] = [];
  for (const f of codeFiles) {
    const dims: Record<string, RiskDimensionHit> = {};
    const resonantKeys: string[] = [];
    let weighted = 0;
    let anySignal = false;

    for (const d of active) {
      const value = raw[d.key].get(f.relPath) ?? 0;
      const pct = pctTables.get(d.key)!.pctOf(value);
      const rank = rankByPath.get(d.key)!.get(f.relPath) ?? Number.MAX_SAFE_INTEGER;
      const hot = value >= d.minSignal && rank <= hotRankLimit;
      dims[d.key] = { value: Math.round(value * 10) / 10, pct, rank, hot };
      if (value > 0) anySignal = true;
      if (hot) resonantKeys.push(d.key);
      weighted += d.weight * pct;
    }

    // 全维度零信号的文件不进榜：它们只会把结果稀释成一张噪音表
    if (!anySignal) continue;

    files.push({
      filePath: f.relPath,
      codeLines: linesByPath.get(f.relPath) ?? 0,
      score: weightSum > 0 ? Math.round((weighted / weightSum) * 10) / 10 : 0,
      resonance: resonantKeys.length,
      resonantKeys,
      dims,
    });
  }

  files.sort(
    (a, b) =>
      b.resonance - a.resonance ||
      b.score - a.score ||
      a.filePath.localeCompare(b.filePath),
  );

  // 维度共现：项目的**系统性病灶**长什么样，比单个文件更能指导整改方向。
  // 「复杂度 × 变更频率」共现最多说明缺重构；「重复 × 技术债」共现最多说明缺抽象。
  const pairCount = new Map<string, number>();
  for (const f of files) {
    for (let i = 0; i < f.resonantKeys.length; i += 1) {
      for (let j = i + 1; j < f.resonantKeys.length; j += 1) {
        const key = `${f.resonantKeys[i]}|${f.resonantKeys[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }
  const cooccurrence = [...pairCount.entries()]
    .map(([k, count]) => {
      const [a, b] = k.split("|");
      return { a, b, count };
    })
    .sort((x, y) => y.count - x.count || x.a.localeCompare(y.a))
    .slice(0, TOP_PAIRS);

  return {
    dimensions: active,
    excluded,
    files,
    scoredFiles: files.length,
    resonantFiles: files.filter((f) => f.resonance >= 2).length,
    cooccurrence,
    hotRankLimit,
  };
}

const labelOf = (key: string): string =>
  t(RISK_DIMENSIONS.find((d) => d.key === key)?.labelKey ?? key);

/**
 * 命中维度的紧凑写法：`复杂度 34CC(第20名) · 变更 88次提交(第17名)`。
 *
 * 名次刻意写在最显眼处：它直接回答「为什么我在别的分节里没见过这个文件」——
 * 各节明细只列 Top-15，第 20 名在那些表里根本不存在。
 */
function formatHits(f: RiskFileScore): string {
  if (f.resonantKeys.length === 0) return "-";
  return f.resonantKeys
    .map((k) => {
      const d = RISK_DIMENSIONS.find((x) => x.key === k);
      const hit = f.dims[k];
      const label = d ? t(d.labelKey) : k;
      const unit = d ? t(d.unitKey) : "";
      return L(
        `${label} ${hit.value}${unit}(第${hit.rank}名/P${hit.pct})`,
        `${label} ${hit.value}${unit}(rank ${hit.rank}/P${hit.pct})`,
      );
    })
    .join(" · ");
}

/**
 * 风险矩阵分节。
 *
 * priority 1：仅次于 coverage / overview。它是「该从哪下手」这个问题的直接答案，
 * 一旦被 token 预算降级成摘要，Agent 就会退回逐节自己交叉的老路。
 */
export function buildRiskMatrixSection(
  s: ScanSnapshot,
  stages?: ScanStageCoverage[],
): AiContextSection {
  const r = computeRiskCorrelation(s, stages);
  const top = r.files.slice(0, TOP_N);

  const rows = top.map((f) => [
    cell(f.filePath, 56),
    f.resonance > 0 ? L(`${f.resonance} 维`, `${f.resonance} dims`) : "-",
    f.score.toFixed(1),
    cell(formatHits(f), 76),
    String(f.codeLines || "-"),
  ]);

  const pairRows = r.cooccurrence.map((p) => [
    labelOf(p.a),
    labelOf(p.b),
    String(p.count),
  ]);

  const dimLegend = r.dimensions
    .map((d) =>
      L(
        `${t(d.labelKey)}(权重 ${d.weight}，${d.nonZero} 个文件非零，最高 ${d.max}${t(d.unitKey)})`,
        `${t(d.labelKey)} (weight ${d.weight}, ${d.nonZero} files non-zero, max ${d.max}${t(d.unitKey)})`,
      ),
    )
    .join(" · ");

  const excludedLines = r.excluded.map((d) =>
    L(
      `- **${t(d.labelKey)}**：${d.reason ?? "该维度不可用"}——本项目在这个方向上的风险**看不见，不等于没有**。`,
      `- **${t(d.labelKey)}**: ${d.reason ?? "dimension unavailable"} — the risk in this direction is **invisible, not absent**.`,
    ),
  );

  const lines = [
    L(
      `在**全量**扫描数据上做跨维度交叉：${r.scoredFiles} 个文件有风险信号，` +
        `其中 **${r.resonantFiles} 个文件在 ≥2 个维度上同时处于高位**（多维共振）。` +
        `参与打分的维度 ${r.dimensions.length} 个，排除 ${r.excluded.length} 个。` +
        `「高位」= 该维度前 ${r.hotRankLimit} 名（约前 10%）且达到该维度的绝对信号下限。`,
      `Cross-dimension intersection on **full** scan data: ${r.scoredFiles} files carry risk signals, ` +
        `of which **${r.resonantFiles} are simultaneously in the top band of ≥2 dimensions** (multi-dimensional resonance). ` +
        `${r.dimensions.length} dimensions participated in scoring, ${r.excluded.length} excluded. ` +
        `"Top band" = top ${r.hotRankLimit} of the dimension (about the top 10%) AND above the dimension's absolute signal floor.`,
    ),
    "",
    L(`**参与维度**：${dimLegend || "无（所有维度均不可用）"}`, `**Participating dimensions**: ${dimLegend || "none (all dimensions unavailable)"}`),
    "",
    L(
      `**多维共振 Top ${rows.length}**（先按共振维度数，再按加权分位综合分）`,
      `**Multi-dimensional resonance Top ${rows.length}** (sorted by resonant dimension count, then weighted-percentile composite score)`,
    ),
    ...mdTable(
      H(
        ["文件", "共振", "综合分", "命中维度（原值 / 该维度名次 / 分位）", "代码行"],
        ["File", "Res.", "Score", "Hits (value / rank / percentile)", "Lines"],
      ),
      rows,
    ),
    "",
    L(
      `**维度共现 Top ${pairRows.length}**（哪两类问题总是落在同一个文件上 = 项目的系统性病灶）`,
      `**Dimension co-occurrence Top ${pairRows.length}** (which two problem types always land on the same file = the project's systemic ailment)`,
    ),
    ...mdTable(H(["维度 A", "维度 B", "共现文件数"], ["Dimension A", "Dimension B", "Co-occurring files"]), pairRows),
    "",
    ...(excludedLines.length
      ? [
          L(
            "**未参与打分的维度（盲区，权重已重新归一，不会拉低任何文件的分数）**",
            "**Dimensions excluded from scoring (blind spots; weights renormalized so no file is dragged down)**",
          ),
          ...excludedLines,
          "",
        ]
      : []),
    L("> 怎么用这一节：", "> How to use this section:"),
    L(
      "> · 这里的交叉是在**全量数据**上算的，不是各分节 Top-N 之间求交集——那个交集在中大型项目上通常是空的。",
      "> · The intersection here is computed over **full data**, not across per-section Top-N lists — that cross-section is usually empty on medium/large projects.",
    ),
    L(
      ">   注意上表的「名次」列：名次大于 15 的维度，意味着这个文件在对应分节的明细表里根本不出现；",
      ">   Note the 'rank' column: a rank above 15 means the file does not appear in that dimension's section at all;",
    ),
    L(
      ">   一个「每维都排第 20 名」的四维共振文件在别处一次都不会露面，只会出现在这张表的第一行。",
      ">   a file resonating on four dimensions while ranking ~20th on each never shows up elsewhere — it appears only in the first rows of this table.",
    ),
    L(
      "> · **共振维度数比综合分更可信**：综合分依赖权重（可争议），而「四个独立维度同时报警」几乎不依赖权重。",
      "> · **Resonant dimension count is more trustworthy than the composite score**: the score depends on weights (debatable), while 'four independent dimensions alarming together' barely depends on weights.",
    ),
    L(
      ">   单维极端值（例如自动生成的巨型文件复杂度爆表却从不改动）会被这个排序自然压下去。",
      ">   Single-dimension extremes (e.g. an auto-generated giant file with huge complexity that never changes) are naturally pushed down by this ordering.",
    ),
    L(
      "> · 想省 token 就先读这一节：它已经替你把 hotspots / review / clones / techDebt / deadCode / coupling 交叉过了，",
      "> · To save tokens, read this section first: it already crosses hotspots / review / clones / techDebt / deadCode / coupling for you,",
    ),
    L(
      ">   确认目标之后再单独取那一两个分节的明细，不必逐节通读。",
      ">   fetch the one or two section details only after confirming the targets — no need to read every section.",
    ),
    L(
      "> · 分位 P 是相对本项目的排名（分母含取值为 0 的文件），不是绝对好坏；跨项目之间不可比。",
      "> · Percentile P is a rank relative to this project (denominator includes zero-valued files), not an absolute quality; it is not comparable across projects.",
    ),
  ];

  const headline = top[0]
    ? L(
        `${cell(top[0].filePath, 46)}（${top[0].resonance} 维共振）`,
        `${cell(top[0].filePath, 46)} (${top[0].resonance} dims)`,
      )
    : L("无", "none");

  return makeSection(
    "riskMatrix",
    L("跨维度风险交叉（全量共振）", "Cross-dimension Risk Intersection (full resonance)"),
    1,
    L(
      `${r.resonantFiles} 个文件多维共振，首位：${headline}；参与维度 ${r.dimensions.length}/${RISK_DIMENSIONS.length}`,
      `${r.resonantFiles} files resonate on multiple dimensions; top: ${headline}; participating dimensions ${r.dimensions.length}/${RISK_DIMENSIONS.length}`,
    ),
    lines,
    {
      scoredFiles: r.scoredFiles,
      resonantFiles: r.resonantFiles,
      dimensions: r.dimensions.map((d) => ({
        key: d.key,
        label: t(d.labelKey),
        weight: d.weight,
        nonZero: d.nonZero,
        max: d.max,
      })),
      excludedDimensions: r.excluded.map((d) => ({ key: d.key, label: t(d.labelKey), reason: d.reason })),
      hotRankLimit: r.hotRankLimit,
      topRisks: top.map((f) => ({
        filePath: f.filePath,
        score: f.score,
        resonance: f.resonance,
        // 只回高位维度的原值：非高位的那些是噪音，塞进 facts 只会让机读端也跟着变贵
        hits: Object.fromEntries(f.resonantKeys.map((k) => [k, f.dims[k].value])),
        ranks: Object.fromEntries(f.resonantKeys.map((k) => [k, f.dims[k].rank])),
      })),
      cooccurrence: r.cooccurrence,
    },
  );
}

const unitOf = (key: string): string =>
  t(RISK_DIMENSIONS.find((d) => d.key === key)?.unitKey ?? "");

/**
 * 焦点目标报告（给人读的版本）。
 *
 * 直接复用 computeRiskCorrelation 的全量交叉结果，只做「Markdown 分节 → 结构化报告」的形状转换，
 * 不重复任何打分逻辑。保证人和 AI 看到的是同一份共振榜——同一个文件、同样的名次、同样的综合分。
 *
 * 排序语义、盲区排除、稀疏维度噪音、路径可用性等全部由 computeRiskCorrelation 负责，
 * 本函数只是把 RiskFileScore / RiskDimensionHit 翻译成协议里的 AiFocusTarget / AiFocusDimensionHit，
 * 并补齐 label / unit（这些只存在于 RISK_DIMENSIONS 定义里，不属于每次打分的中间量）。
 */
export function buildScanFocusReport(
  s: ScanSnapshot,
  scopeId: string,
  scopeLabel?: string,
  stages?: ScanStageCoverage[],
): AiFocusReport {
  const r = computeRiskCorrelation(s, stages);

  const toHit = (key: string, hit: RiskDimensionHit): AiFocusDimensionHit => ({
    key,
    label: labelOf(key),
    value: hit.value,
    pct: hit.pct,
    rank: hit.rank,
    unit: unitOf(key),
    hot: hit.hot,
  });

  const targets: AiFocusTarget[] = r.files.slice(0, TOP_N).map((f) => ({
    filePath: f.filePath,
    codeLines: f.codeLines,
    score: f.score,
    resonance: f.resonance,
    resonantKeys: f.resonantKeys,
    // 只带高位维度的明细：非高位的维度是噪音，塞进给人读的表只会稀释注意力
    dims: Object.fromEntries(f.resonantKeys.map((k) => [k, toHit(k, f.dims[k])])),
  }));

  return {
    moduleId: "project-scan",
    scopeId,
    scopeLabel,
    scoredFiles: r.scoredFiles,
    resonantFiles: r.resonantFiles,
    hotRankLimit: r.hotRankLimit,
    dimensions: r.dimensions.map((d) => ({
      key: d.key,
      label: t(d.labelKey),
      weight: d.weight,
      nonZero: d.nonZero,
      max: d.max,
      unit: t(d.unitKey),
    })),
    blindSpots: r.excluded.map((d) => ({ key: d.key, label: t(d.labelKey), reason: d.reason })),
    targets,
    // 在这里翻译，而不是让渲染侧翻译：维度字典只存在于本模块，
    // 面板拿到裸 key 会把「复杂度 × 变更频率」印成「complexity × churn」。
    cooccurrence: r.cooccurrence.map((p) => ({
      ...p,
      aLabel: labelOf(p.a),
      bLabel: labelOf(p.b),
    })),
  };
}
