/**
 * insightFeedback —— 让 AI 自己的结论回流成「下一轮看哪里」的一等输入。
 *
 * 它补的是什么：回路只有一半
 * --------------------------
 * 到目前为止，整条链路是单向的：扫描产出数据 → 排序（riskMatrix 共振榜）→ 点名（focusPatrol）
 * → Agent 分析 → 结论沉淀到 ai_insights。沉淀之后，这些结论只被用来**展示**
 * （面板列表、画布角标、报告导出），从来没有回到链路的前端去影响下一轮的注意力分配。
 *
 * 于是自动化每一轮都在用同一套**纯静态指标**决定看哪里，就像一个每天早上失忆的巡检员：
 *   · 上一轮 Agent 判定 `src/x.ts` 有严重的循环依赖，这一轮 x.ts 恰好被改了 ——
 *     「那个问题修好了没有？还是变得更糟了？」这是全项目当下最值得问、也最便宜的一个问题
 *     （已知问题 + 已知变化，Agent 不必重新理解整个文件），但排序侧完全不知道它的存在，
 *     x.ts 静态分若排在第 40 名，就永远轮不到。
 *   · 反过来，一个已被反复确认、代码却纹丝未动的文件，静态分很高，于是每一轮都占着名额，
 *     每一轮都得到同一个结论 —— 这是纯粹的 token 浪费，而且账面上一切正常。
 *
 * 所以这里做一件事：把 ai_insights 翻译成**按文件的注意力信号**，供派单队列与编排闸门消费。
 *
 * 四个信号（互斥，按优先级判定）
 * ------------------------------
 * · recheck   —— 有 open 结论，且它依据的证据文件内容已经变了。**最高价值**：
 *                问题可能已修（该收口）、也可能恶化（该升级），而且不复核的话，
 *                这条过期结论会继续误导人和后续每一轮 Agent。
 * · orphaned  —— 有 open 结论，但证据文件已经不存在了。多半是删除/重命名，
 *                需要人或 Agent 确认后收口，但**不值得动用点名名额**（没有对象可看）。
 * · confirmed —— 有 open 结论且证据未变。已知问题，静态分之外的确定性加分。
 * · settled   —— 只剩已收口的结论且证据未变。这个文件近期被认真看过并给出了交代，
 *                优先级应当**下调**（但绝不排除，见下）。
 *
 * 三条判定铁律
 * ------------
 * ① **反馈只改「谁先看」，绝不改「有多严重」。**
 *    共振榜的分数保持纯静态。severity 是 Agent 自评，天然通胀（模型倾向于把自己发现的问题
 *    说得重要），一旦让它进入打分，排序就会退化成「哪个文件被 AI 夸张得最厉害」，
 *    而共振榜「客观、可复现、与模型无关」这个唯一的立身之本也就没了。
 *
 * ② **settled 只降权，不排除。**
 *    「AI 说这里没问题」与「这里确实没问题」不是一回事。永久排除等于让模型的一次误判
 *    获得终身豁免权，而这类误判恰恰最难被发现——它不会报错，只是让一个真实的问题
 *    从此在所有视图里消失。
 *
 * ③ **recheck 必须能收敛。**
 *    这是 focusPatrol「派单即销账」那条血泪的同构复发：如果用「洞察有没有更新」判断
 *    复核完成了没有，那么 Agent 认真复核后判定「结论仍然成立、无需改动」时不会写任何东西
 *    （工具提示本身就在劝阻重复保存稳定结论），于是这个文件会被每一轮重新点名，
 *    永不收敛地烧钱。所以销账看的是 {@link FileInsightSignal.evidenceDigest}：
 *    派单时把「该文件当下的证据现状指纹」记进台账，只有证据**再次**变化才重新排队。
 *
 * 模块无关：本文件只认 AiInsightDto 这一个通用 DTO，不含任何扫描知识。
 * 洞察沉淀本身就是跨模块的（按 scopeId 归档），因此任何接入 AiContextProvider 的模块
 * 都能直接继承这套回流，无需实现任何额外钩子。
 */
import { aiContextApi, type AiInsightDto } from "../services/tauri";
import { t } from "../i18n";
import { L } from "./aiLang";
import type { AiContextSection } from "./contextTypes";
import { logger } from "../utils/logger";
import { digestOf, estimateTokens } from "./tokenBudget";

/** 一个文件在洞察侧的注意力信号（互斥，优先级 recheck > orphaned > confirmed > settled） */
export type InsightSignal = "recheck" | "orphaned" | "confirmed" | "settled";

/** 严重度排序，仅用于「取最严重的那条」，不参与任何打分 */
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** 严重度 → 可比整数。仅用于「同为待复核时谁先看」，不参与任何风险打分 */
export function severityRank(s: string | undefined): number {
  return SEVERITY_RANK[(s ?? "").toLowerCase()] ?? 0;
}

/** 把引用里的 `path:line` 归一成纯路径——与后端 normalize_ref_path 同口径 */
export function refPath(raw: string): string {
  const trimmed = (raw ?? "").trim().replace(/^\.\//, "");
  // 只剥「结尾的 :数字(-数字)?」，避免把 Windows 盘符 C: 或 URL 里的冒号误伤
  const m = trimmed.match(/^(.*?):(\d+)(?:-\d+)?$/);
  return (m ? m[1] : trimmed).trim();
}

export interface FileInsightSignal {
  filePath: string;
  signal: InsightSignal;
  /** 仍在占用注意力的结论数 */
  openCount: number;
  /** 其中证据已变、需要复核的条数 */
  staleCount: number;
  /** 证据文件已不存在的条数 */
  orphanCount: number;
  /** 已收口的结论数 */
  resolvedCount: number;
  /** open 结论里最严重的那一档（无 open 时为空串） */
  maxSeverity: string;
  /** 最近一次有结论被确认的时间（秒） */
  lastSeenAt: number;
  /** 最具代表性的一条结论标题（取最严重、同档取最近） */
  headline: string;
  /**
   * 证据现状指纹：该文件下所有 open 结论「当前观测到的证据状态」的聚合。
   *
   * 它是 recheck 收敛的唯一判据（见文件头铁律③）。取值只来自**后端观测**
   * （evidenceDigest 由 list_by_analysis 按当前文件哈希实时算出），不含任何本地推测：
   * Agent 什么都不写时它不变（→ 已派过单就不再点名），文件被再次改动时它必然变
   * （→ 重新排队）。
   */
  evidenceDigest: string;
  /** 一句话说明，人与 Agent 共用 */
  note: string;
}

export interface InsightFeedbackSummary {
  /** 参与统计的结论总数 */
  insights: number;
  openInsights: number;
  /** 有信号的文件数 */
  files: number;
  recheckFiles: number;
  orphanedFiles: number;
  confirmedFiles: number;
  settledFiles: number;
}

export interface InsightFeedback {
  byFile: Map<string, FileInsightSignal>;
  summary: InsightFeedbackSummary;
  /** 待复核文件（按严重度、再按证据变化条数排序），队列直接可用 */
  recheck: FileInsightSignal[];
  /**
   * 数据是否可用。读库失败时为 false —— 此时**所有**判定必须退回纯静态口径，
   * 绝不能把「没读到洞察」当成「没有洞察」：后者会让待复核的文件被静默降级成
   * 「从未分析过」，反而排到更后面。
   */
  available: boolean;
}

const EMPTY_SUMMARY: InsightFeedbackSummary = {
  insights: 0,
  openInsights: 0,
  files: 0,
  recheckFiles: 0,
  orphanedFiles: 0,
  confirmedFiles: 0,
  settledFiles: 0,
};

export function emptyInsightFeedback(available = true): InsightFeedback {
  return { byFile: new Map(), summary: { ...EMPTY_SUMMARY }, recheck: [], available };
}

interface Bucket {
  open: AiInsightDto[];
  resolved: AiInsightDto[];
  stale: AiInsightDto[];
  orphan: AiInsightDto[];
  evidenceParts: string[];
}

/**
 * 把结论列表折成「按文件」的注意力信号。
 *
 * 纯函数：不查库、不看时钟（now 仅用于文案，可注入）。这套判定决定了自动化每一轮
 * 把 token 花在哪里，必须能被回归测试钉死。
 */
export function buildInsightFeedback(
  insights: readonly AiInsightDto[] | null | undefined,
  options: { available?: boolean } = {},
): InsightFeedback {
  if (options.available === false) return emptyInsightFeedback(false);
  const list = insights ?? [];
  if (list.length === 0) return emptyInsightFeedback(true);

  const buckets = new Map<string, Bucket>();
  let openInsights = 0;

  for (const ins of list) {
    const isOpen = (ins.status ?? "open") !== "resolved";
    if (isOpen) openInsights += 1;

    const changed = new Set((ins.changedRefs ?? []).map(refPath));
    const missing = new Set((ins.missingRefs ?? []).map(refPath));
    // 引用为空的结论（unanchored）无处归档：它不指向任何文件，
    // 自然也无法参与「看哪个文件」的决策。计入总数但不进桶。
    const paths = new Set((ins.refs ?? []).map(refPath).filter(Boolean));

    for (const p of paths) {
      let b = buckets.get(p);
      if (!b) {
        b = { open: [], resolved: [], stale: [], orphan: [], evidenceParts: [] };
        buckets.set(p, b);
      }
      if (isOpen) {
        b.open.push(ins);
        if (missing.has(p)) b.orphan.push(ins);
        else if (changed.has(p)) b.stale.push(ins);
        // 只有 open 结论进证据指纹：已收口的结论再怎么变都不该把文件拉回复核队列。
        // 指纹缺席（后端旧数据没有该字段）时退回 freshness，保证老库不至于完全失效。
        b.evidenceParts.push(`${ins.id}=${ins.evidenceDigest ?? ins.freshness ?? ""}`);
      } else {
        b.resolved.push(ins);
      }
    }
  }

  const byFile = new Map<string, FileInsightSignal>();
  for (const [filePath, b] of buckets) {
    const signal: InsightSignal =
      b.stale.length > 0
        ? "recheck"
        : b.orphan.length > 0
          ? "orphaned"
          : b.open.length > 0
            ? "confirmed"
            : "settled";

    const pool = b.open.length > 0 ? b.open : b.resolved;
    const lead = [...pool].sort(
      (x, y) =>
        severityRank(y.severity) - severityRank(x.severity) || (y.lastSeen ?? 0) - (x.lastSeen ?? 0),
    )[0];
    const maxSeverity = b.open.length > 0 ? (lead?.severity ?? "") : "";
    const lastSeenAt = pool.reduce((acc, i) => Math.max(acc, i.lastSeen ?? 0), 0);

    byFile.set(filePath, {
      filePath,
      signal,
      openCount: b.open.length,
      staleCount: b.stale.length,
      orphanCount: b.orphan.length,
      resolvedCount: b.resolved.length,
      maxSeverity,
      lastSeenAt,
      headline: lead?.title ?? "",
      // 排序保证同一组结论无论查询顺序如何都得到同一个指纹
      evidenceDigest: b.evidenceParts.length ? digestOf(b.evidenceParts.sort().join("|")) : "",
      note: describeSignal(signal, b),
    });
  }

  const values = [...byFile.values()];
  const recheck = values
    .filter((v) => v.signal === "recheck")
    .sort(
      (a, b) =>
        severityRank(b.maxSeverity) - severityRank(a.maxSeverity) ||
        b.staleCount - a.staleCount ||
        a.filePath.localeCompare(b.filePath),
    );

  return {
    byFile,
    recheck,
    available: true,
    summary: {
      insights: list.length,
      openInsights,
      files: byFile.size,
      recheckFiles: recheck.length,
      orphanedFiles: values.filter((v) => v.signal === "orphaned").length,
      confirmedFiles: values.filter((v) => v.signal === "confirmed").length,
      settledFiles: values.filter((v) => v.signal === "settled").length,
    },
  };
}

function describeSignal(signal: InsightSignal, b: Bucket): string {
  switch (signal) {
    case "recheck":
      return L(
        `已有 ${b.open.length} 条待办结论，其中 ${b.stale.length} 条依据的代码已改动，需复核是否已修复或已恶化`,
        `${b.open.length} open conclusion(s), ${b.stale.length} of which rely on changed code — re-verify whether fixed or worsened`,
      );
    case "orphaned":
      return L(
        `有 ${b.orphan.length} 条结论的证据文件已不存在，需确认是否可收口`,
        `${b.orphan.length} conclusion(s) lost their evidence file; confirm whether to close them`,
      );
    case "confirmed":
      return L(`已确认 ${b.open.length} 条待办结论，代码未变动`, `${b.open.length} open conclusion(s) confirmed; code unchanged`);
    case "settled":
      return L(`${b.resolved.length} 条结论均已复核收口`, `${b.resolved.length} conclusion(s) all reviewed and closed`);
  }
}

/**
 * 该文件当下是否欠一次复核，以及是否**已经**为这次变化派过单。
 *
 * 分成两问是必要的：只问第一问会永远重复点名（Agent 复核后不写东西时证据仍是「已变」），
 * 只问第二问则一次派单等于终身免检（文件后来又改了也不再看）。
 */
export function needsRecheck(
  signal: FileInsightSignal | undefined,
  lastAssignedEvidenceDigest: string | null | undefined,
): boolean {
  if (!signal || signal.signal !== "recheck") return false;
  const prev = (lastAssignedEvidenceDigest ?? "").trim();
  // 没有历史记账（从未派单，或派单早于本特性上线）：按「欠一次」处理。
  // 宁可多看一次，也不能让一条过期结论永远挂着——它会持续误导人和后续每一轮 Agent。
  if (!prev) return true;
  return prev !== signal.evidenceDigest;
}

// ─── 读库入口（唯一有 IO 的一段，与上面的纯判定严格分开） ───

interface FeedbackCacheEntry {
  scopeId: string;
  atMs: number;
  value: InsightFeedback;
}

let cache: FeedbackCacheEntry | null = null;

/**
 * 同一轮编排内的短时缓存窗口（毫秒）。
 *
 * 一轮编排里这份数据至少要用两次：派单排队（computeFocusPlan）与账本分节
 * （persistModuleContext），两次调用相隔通常不到一秒。20 秒足够覆盖一整轮，
 * 又短到不会让「Agent 刚写完结论」的更新被压住超过一个心跳间隔。
 */
const FEEDBACK_TTL_MS = 20_000;

/**
 * 读取并折算某个作用域的洞察回流信号。
 *
 * 失败时返回 `available:false` 而不是空信号，这个区分是硬要求：
 * 空信号会让待复核的文件被静默降级成「从未分析过」，反而排到更后面，
 * 而且账面上一切正常——正是最难被发现的那类失真。
 */
export async function loadInsightFeedback(
  scopeId: string,
  options: { force?: boolean; nowMs?: number } = {},
): Promise<InsightFeedback> {
  const nowMs = options.nowMs ?? Date.now();
  if (
    !options.force &&
    cache &&
    cache.scopeId === scopeId &&
    nowMs - cache.atMs < FEEDBACK_TTL_MS
  ) {
    return cache.value;
  }
  let value: InsightFeedback;
  try {
    value = buildInsightFeedback(await aiContextApi.listAiInsights(scopeId));
  } catch (err) {
    logger.warn("insightFeedback", "结论沉淀读取失败，本轮退回纯静态口径", { scopeId, error: err });
    // 失败结果**不缓存**：下一次调用应当重试，而不是把一次网络抖动固化 20 秒
    return emptyInsightFeedback(false);
  }
  cache = { scopeId, atMs: nowMs, value };
  return value;
}

/** Agent 写回结论后调用，避免账本在缓存窗口内继续报旧数 */
export function invalidateInsightFeedback(): void {
  cache = null;
}

// ─── 洞察账本分节（模块无关的派生分节） ───

/** 账本分节的固定键。与模块分节共处一个命名空间，前缀 `ai` 表示「由 AI 产出反推」 */
export const INSIGHT_LEDGER_KEY = "aiInsightLedger";

const LEDGER_TOP_N = 12;

function severityLabel(s: string): string {
  const key = `severity.${(s ?? "").toLowerCase()}`;
  const v = t(key);
  return v !== key ? v : s ?? "-";
}

/**
 * 构建「AI 结论账本」分节 —— 让 Agent 用几百 token 知道自己上几轮说过什么。
 *
 * 为什么它能省 token
 * ------------------
 * 现有闭环里，Agent 每轮开头都要调 `context_insight list` 把历史结论整包拉回来，
 * 项目跑上几周之后这一步本身就是上千 token，而其中绝大部分是「稳定且无需处理」的旧账。
 * 账本把它压成一张按文件聚合的表：待复核的排在最前并写明「哪几条、为什么」，
 * 其余只给计数。Agent 据此**只对需要处理的那几条**调 list/section 取正文。
 *
 * 为什么它必须是 derived 分节
 * ---------------------------
 * 这一节的内容由 Agent 自己的产出决定。如果它进入包指纹，就会形成正反馈：
 * 存一条洞察 → 账本变 → 包指纹变 → 「内容已变化」闸门放行 → 再分析一轮 → 再存洞察……
 * 一个无人察觉、按小时稳定烧钱的死循环。derived 标记就是为了斩断这条回路，
 * 详见 contextTypes 里 AiContextSection.derived 的说明。
 */
export function buildInsightLedgerSection(
  feedback: InsightFeedback,
  options: { priority?: number } = {},
): AiContextSection {
  const priority = options.priority ?? 1;
  const { summary } = feedback;
  const lines: string[] = [];

  if (!feedback.available) {
    lines.push(L("_结论沉淀读取失败，本节数据不可用。不要据此判断「以前没有分析过」。_", "_Failed to read saved conclusions; this section is unavailable. Do not conclude \"never analyzed before\" from it._"));
  } else if (summary.insights === 0) {
    lines.push(L("_尚无任何 AI 结论沉淀（这是首轮分析，不是「查过没问题」）。_", "_No AI conclusions yet (first-round analysis, not \"checked and clean\")._"));
  } else {
    lines.push(
      L(`累计 ${summary.insights} 条结论，其中 ${summary.openInsights} 条仍待办，涉及 ${summary.files} 个文件。`, `${summary.insights} conclusion(s) in total, ${summary.openInsights} still open, across ${summary.files} file(s).`),
      L(`**待复核 ${summary.recheckFiles} 个文件**（结论依据的代码已改动）· 证据已失联 ${summary.orphanedFiles} 个 · 已确认待办 ${summary.confirmedFiles} 个 · 已收口 ${summary.settledFiles} 个。`, `**${summary.recheckFiles} file(s) to re-review** (conclusions rely on changed code) · evidence lost for ${summary.orphanedFiles} · ${summary.confirmedFiles} confirmed open · ${summary.settledFiles} settled.`),
      "",
    );

    if (feedback.recheck.length > 0) {
      lines.push(
        L("### 优先复核（已有结论 + 代码已改动）", "### Priority re-review (existing conclusions + changed code)"),
        "",
        L("这些文件此前已被分析过并留下结论，之后代码发生了改动。复核它们比重新分析一个陌生文件便宜得多，", "These files were analyzed before with conclusions, and the code has changed since. Re-reviewing them is far cheaper than analyzing a new file from scratch,"),
        L("而且不复核的话，这些过期结论会继续出现在面板与后续每一轮上下文里误导判断。", "and without re-review, these stale conclusions keep misleading the panels and every future context round."),
        "",
        L("| 文件 | 最高严重度 | 待办 | 待复核 | 代表结论 |", "| File | Max severity | Open | Re-check | Representative conclusion |"),
        "| --- | --- | --- | --- | --- |",
      );
      for (const r of feedback.recheck.slice(0, LEDGER_TOP_N)) {
        lines.push(
          `| ${r.filePath} | ${severityLabel(r.maxSeverity)} | ${r.openCount} | ${r.staleCount} | ${r.headline || "-"} |`,
        );
      }
      if (feedback.recheck.length > LEDGER_TOP_N) {
        lines.push("", L(`_另有 ${feedback.recheck.length - LEDGER_TOP_N} 个待复核文件未列出。_`, `_${feedback.recheck.length - LEDGER_TOP_N} more re-review files omitted._`));
      }
      lines.push("");
    }

    const orphaned = [...feedback.byFile.values()].filter((v) => v.signal === "orphaned");
    if (orphaned.length > 0) {
      lines.push(
        L("### 证据已失联（文件不存在了）", "### Evidence lost (file no longer exists)"),
        "",
        L("可能是已删除或重命名。确认后请用 `context_insight` 的 resolve 收口，别让它继续占位。", "The file may be deleted or renamed. After confirming, close it with `context_insight` resolve so it stops occupying space."),
        "",
        ...orphaned.slice(0, LEDGER_TOP_N).map((r) => L(`- ${r.filePath}（${r.orphanCount} 条）`, `- ${r.filePath} (${r.orphanCount})`)),
        "",
      );
    }

    const confirmed = [...feedback.byFile.values()]
      .filter((v) => v.signal === "confirmed")
      .sort(
        (a, b) => severityRank(b.maxSeverity) - severityRank(a.maxSeverity) || b.openCount - a.openCount,
      );
    if (confirmed.length > 0) {
      lines.push(
        L("### 已确认待办（代码未变动，结论仍然成立）", "### Confirmed open (code unchanged, conclusions still valid)"),
        "",
        L("**不要重复保存这些结论**，它们已经在库里。除非你有新的证据推翻或细化它们。", "**Do not re-save these conclusions** — they are already in the database. Only revisit them if you have new evidence that refutes or refines them."),
        "",
        ...confirmed
          .slice(0, LEDGER_TOP_N)
          .map((r) => L(`- ${r.filePath} · ${severityLabel(r.maxSeverity)} · ${r.openCount} 条 · ${r.headline}`, `- ${r.filePath} · ${severityLabel(r.maxSeverity)} · ${r.openCount} open · ${r.headline}`)),
        "",
      );
    }
  }

  const content = lines.join("\n");
  return {
    key: INSIGHT_LEDGER_KEY,
    title: L("AI 结论账本（历史沉淀与待复核）", "AI Conclusion Ledger (history & re-review)"),
    summary: feedback.available
      ? summary.insights === 0
        ? L("尚无历史结论沉淀", "No historical conclusions yet")
        : L(`${summary.openInsights} 条待办 · ${summary.recheckFiles} 个文件待复核`, `${summary.openInsights} open · ${summary.recheckFiles} files awaiting re-review`)
      : L("结论沉淀读取失败", "Failed to read saved conclusions"),
    content,
    tokenEstimate: estimateTokens(content),
    priority,
    // 派生分节：内容来自 AI 自己的产出，不得进入包指纹（否则形成自激循环）
    derived: true,
    facts: {
      ...summary,
      recheckPaths: feedback.recheck.slice(0, LEDGER_TOP_N).map((r) => r.filePath),
    },
    dataQuality: feedback.available
      ? {
          status: summary.insights === 0 ? "empty" : "ok",
          observed: summary.insights,
          reason:
            summary.insights === 0
              ? L("该作用域下还没有任何 AI 结论沉淀", "No AI conclusions have been saved in this scope yet")
              : L("由历次分析回写的结论汇总而成，时效性按当前文件内容哈希实时判定", "Aggregated from conclusions written back by past analyses; freshness is judged live against current file content hashes"),
          caveat:
            summary.insights === 0
              ? L("「没有结论」不等于「没有问题」——只说明还没有人分析过，不要据此判断项目健康", "\"No conclusions\" is not \"no problems\" — it only means nothing was analyzed yet; do not judge project health from it")
              : undefined,
          truncated: summary.files > LEDGER_TOP_N,
        }
      : {
          status: "unavailable",
          reason: L("结论沉淀读取失败", "Failed to read saved conclusions"),
          caveat: L("不要把本节的缺失理解为「此前没有分析过」", "Do not interpret this section's absence as \"never analyzed before\""),
        },
    digest: "",
    updatedAt: 0,
  };
}
