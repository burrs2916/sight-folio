/**
 * analysisScheduler —— 让自动分析「不掉链子」的调度心跳。
 *
 * 它补的是什么
 * ------------
 * 在此之前，自动分析只有一个触发源：一次扫描落库完成。这在扫描频繁时看着没问题，
 * 但只要撞上任何一次临时状况，那一轮就**永久消失**：
 *
 *   · 冷却窗口没过 → 跳过。冷却结束后没有人再来问一次，直到用户碰巧又扫一遍；
 *   · Agent 正在回答别的问题（busy）→ 跳过。它答完之后同样无人接续；
 *   · 用户刚建好规则，然后项目进入稳定期不再扫描 → 这条规则一次都不会跑；
 *   · 分析发起后应用被关掉 → 轨迹永远停在 pending，那一轮实际上什么也没产出。
 *
 * 也就是说，「自动化」此前的准确描述是「扫描的副产品」。项目越稳定、扫描越少，
 * 自动分析越接近彻底停摆 —— 恰恰与「轮转把各个维度都覆盖一遍」的目标背道而驰。
 *
 * 设计要点
 * --------
 * 1. **心跳必须便宜**。每个 tick 只做两次 SQL 查询（规则表 + 每规则最近一条轨迹），
 *    确认真有欠账才去构建上下文包。绝大多数 tick 的答案是「没有欠账」，
 *    这种情况下不碰 buildPack、不写库、不写审计。
 * 2. **巡检的 no-op 不留痕**。心跳每几分钟问一次，照记 skipped 会把轨迹表刷成噪音，
 *    真正需要用户看见的那几条反而被淹没（recordSkips: false）。
 * 3. **失败要退避**。一条永远失败的规则若每个 tick 都重试，就成了持续烧钱的循环。
 * 4. **判定是纯函数**（shouldBackfill）。调度里最容易出错的就是这套状态判断，
 *    独立出来才写得了回归测试。
 *
 * 模块无关：本文件不含任何扫描知识，只认 AiContextProvider 协议与轨迹表。
 * 未来任意模块接入 AI 时，只要注册了 provider 就自动获得同一套连续性保障。
 */
import type { AiAutoAnalysisRule, AiAutoAnalysisRun } from "../services/tauri";
import { L } from "./aiLang";
import { aiContextApi } from "../services/tauri";
import { aiContextRegistry } from "./contextRegistry";
import { lastPersistedDigest, persistModuleContext } from "./contextPersist";
import { automationBlocklistFor, isOrchestrating, isRotatingRule, runAutoAnalysis } from "./autoAnalysisOrchestrator";
import { buildAnalysisCoverage } from "./analysisCoverage";
import { planFocusPatrol } from "./focusPatrol";
import { loadEntityRegression } from "./entityRegression";
import { buildRegressionFeedback, emptyRegressionFeedback } from "./regressionFocus";
import { logger } from "../utils/logger";

/** 默认心跳间隔：5 分钟。够快到让用户觉得「它自己会接着跑」，又不至于频繁查库 */
export const DEFAULT_TICK_MS = 5 * 60 * 1000;

/**
 * 失败/出错后的重试退避（秒）。
 * 没有它，一条因为配置错误永远失败的规则会在每个 tick 重试一次 ——
 * 自动化从「不掉链子」变成「不停地撞墙」。
 */
export const RETRY_BACKOFF_SEC = 15 * 60;

/**
 * pending 多久算「大概率中断了」（秒）。
 * 分析发起后应用被关掉，轨迹就永远停在 pending。等得太短会把正在认真思考的
 * 长任务误判成中断并重复发起，等得太久则整轮白丢。30 分钟是两头的折中。
 */
export const STALE_PENDING_SEC = 30 * 60;

/**
 * 「补齐类欠账」的最小间隔（秒）。
 *
 * 冷却窗口是用户为「**数据变化**驱动的分析」设的额度；而补齐类欠账
 * （还有维度没覆盖、还有文件没巡查）是系统在数据完全没变的情况下**自作主张**
 * 多花的一笔钱，必须有自己的地板，不能借用户设的冷却来兜底 ——
 * 冷却填 0 的规则（不少人图省事就这么填）会让心跳每 5 分钟发起一轮真实对话。
 *
 * 1 小时的含义：一个补齐类的洞见，一小时补一条，一天也有二十几条，
 * 足够在几天内把维度和共振榜都覆盖一遍；而它烧掉的钱是有上限、可预期的。
 */
export const GAP_BACKFILL_FLOOR_SEC = 60 * 60;

/** 可恢复的跳过原因：这些跳过意味着「稍后再来」，而不是「不该跑」 */
const RECOVERABLE_SKIP_REASONS = new Set(["cooling", "busy"]);

export type BackfillReason =
  | "never-run"
  | "recoverable-skip"
  | "failed-retry"
  | "errored-retry"
  | "stale-pending"
  /**
   * 数据没变，但覆盖面上还有空白：某个维度从未被分析过，或共振榜上某个文件从未被巡查过。
   *
   * 这一类与上面五种的性质不同：上面五种都是「某一轮**本来会跑**却被临时状况打断」，
   * 而这一类是「谁都没被打断，但覆盖面天生就补不完」——因为 rotate-gap / focus-gap
   * 这两条压过指纹去重的例外，此前只写在 evaluateAutoRule 里，而
   * evaluateAutoRule 只有在**一次扫描落库**时才会被调用。
   *
   * 于是出现一个正好反过来的荒谬情形：项目越稳定、越不需要重扫，
   * 补齐机制就越跑不起来 —— 恰恰在最有余裕去补覆盖面的时候彻底停摆。
   * 项目进入维护期后，剩下的维度和剩下的共振文件将**永远**是空白。
   */
  | "gap-backlog";

export interface BackfillVerdict {
  owed: boolean;
  reason?: BackfillReason;
  detail?: string;
}

/**
 * 判断一条规则是否还欠着一轮分析。
 *
 * 只看**最近一条**轨迹：再往前的记录已经被后来的轮次覆盖，翻出来只会把早已补过的
 * 旧账重新算一遍。传 undefined 表示这条规则在该作用域下从来没有过任何记录。
 *
 * 注意这里刻意**不**判断冷却是否已过 —— 那是 evaluateAutoRule 的职责，
 * 且它才拿得到规则上权威的 lastRunAt。这里只回答「有没有欠账」，
 * 至于现在能不能补，交给下游那三道闸门去把关，两边各管一段才不会判重或判漏。
 *
 * 「补齐类欠账」（gap-backlog）不在本函数里判：它要跨规则看整张覆盖台账和共振榜，
 * 需要额外 I/O，塞进来就毁掉了这个函数「纯、可回归」的价值。见 {@link probeCoverageGaps}。
 */
export function shouldBackfill(
  rule: AiAutoAnalysisRule,
  latest: AiAutoAnalysisRun | undefined,
  nowSec: number,
): BackfillVerdict {
  if (!rule.enabled) return { owed: false };

  if (!latest) {
    // 规则建好了却从没跑过。最常见的成因是「建完规则之后再没扫描过」，
    // 用户看到的是一条配置齐全、却永远不动的自动化。
    return { owed: true, reason: "never-run", detail: L("规则从未执行过，补跑首轮", "Rule has never run; backfill the first round") };
  }

  const elapsed = nowSec - (latest.createdAt || 0);

  if (latest.status === "skipped") {
    if (RECOVERABLE_SKIP_REASONS.has(latest.reason ?? "")) {
      return {
        owed: true,
        reason: "recoverable-skip",
        detail: L(`上一轮因「${latest.reason}」暂缓，条件恢复后补上`, `Deferred last round due to "${latest.reason}"; backfill once conditions recover`),
      };
    }
    // unchanged / trigger-mismatch / disabled 等属于「本来就不该跑」，不是欠账
    return { owed: false };
  }

  if (latest.status === "failed") {
    if (elapsed < RETRY_BACKOFF_SEC) return { owed: false };
    return { owed: true, reason: "failed-retry", detail: L("上一轮发起失败，退避后重试", "Last round failed to launch; retrying after backoff") };
  }

  // 到这里 status === "triggered"：消息发出去了，但结局未必是好的
  const outcome = latest.outcome ?? "";
  if (outcome === "error") {
    if (elapsed < RETRY_BACKOFF_SEC) return { owed: false };
    return { owed: true, reason: "errored-retry", detail: L("上一轮对话失败，退避后重试", "Last round conversation failed; retrying after backoff") };
  }
  if (outcome === "interrupted") {
    // 已被清算器落定的中断轮次：它能被标成 interrupted，就说明早已过了判定窗口。
    // 这里**不再叠一层退避**——否则「关掉应用」这件极常见的事要额外多等一轮心跳。
    return { owed: true, reason: "stale-pending", detail: L("上一轮疑似中断未完成，重新发起", "Last round seems interrupted; relaunching") };
  }
  if (outcome === "pending") {
    // 还没被清算器碰过的悬空轮次（清算失败，或本进程内刚过窗口）。
    // 判据与清算器一致，两边任意一边生效都不会漏账。
    if (elapsed < STALE_PENDING_SEC) return { owed: false };
    return { owed: true, reason: "stale-pending", detail: L("上一轮疑似中断未完成，重新发起", "Last round seems interrupted; relaunching") };
  }

  // completed / no-output / 空串（回执特性之前的历史数据）都算已了结
  return { owed: false };
}

/**
 * 这条规则现在值不值得为它花代价去**探测**补齐类欠账。
 *
 * 强调「探测」二字：本函数不是闸门，权威的放行判定始终在 evaluateAutoRule。
 * 它存在的唯一理由是成本 —— 探测一次要重算共振榜并查两张表，
 * 若在明知不可能放行的时候还每 5 分钟算一遍，心跳就不再便宜了。
 *
 * 三条否决：
 *   · 从未跑过 —— never-run 已经在便宜阶段报过账，不必重复；
 *   · 距上次运行不足补齐地板 —— 见 {@link GAP_BACKFILL_FLOOR_SEC}，
 *     这一条同时兜住了「冷却填 0」的规则，是真正防失控的那道；
 *   · 还在用户设的冷却窗口里 —— 探了也会被下游拦回来，纯属白算。
 */
export function gapProbeEligible(rule: AiAutoAnalysisRule, nowSec: number): boolean {
  if (!rule.enabled) return false;
  if (rule.lastRunAt <= 0) return false;
  const idle = nowSec - rule.lastRunAt;
  if (idle < GAP_BACKFILL_FLOOR_SEC) return false;
  if (idle < Math.max(0, rule.cooldownMinutes) * 60) return false;
  return true;
}

/** 覆盖面上的三类空白：缺一个「方面」、缺一个「对象」，或欠一笔「刚发生的劣化」 */
export interface CoverageGapProbe {
  /** 还有分析维度从未被覆盖过（只有轮转规则消费得了） */
  hasUncoveredDimension: boolean;
  /** 共振榜上还有文件从未被巡查过（任何规则都消费得了） */
  hasUnpatrolledFocus: boolean;
  /**
   * 有文件相对上一次扫描明显变坏、却还没被追责过（任何规则都消费得了）。
   *
   * 这一类空白最需要心跳来兜，理由是**它会过期**：劣化是在扫描落库那一刻算出来的，
   * 若那一刻恰好撞上冷却或 Agent 忙碌，扫描侧的编排就跳过了；而下一次扫描一到，
   * 这次劣化就滚进新基线成为「一直如此」，从此任何视图都看不见它。
   * 维度空白和文件空白漏一轮还在原地等，这一笔漏了就是**永久损失**。
   *
   * 反过来说，只要还没有下一次扫描，这笔欠账就一直挂着 —— 心跳完全来得及补，
   * 这也正是把它放进补齐类欠账（而不是只在扫描后判一次）的全部意义。
   */
  hasRegressedFocus: boolean;
}

const NO_GAP: CoverageGapProbe = {
  hasUncoveredDimension: false,
  hasUnpatrolledFocus: false,
  hasRegressedFocus: false,
};

/**
 * 探测覆盖面上的空白。
 *
 * 两处判定都**刻意不传当前指纹**，因为这里要找的只是「从未」，不是「过期」：
 *   · 「数据变了所以结论过期」本来就会让指纹变化，正常闸门自然放行，用不着例外；
 *   · 真正会被指纹去重永久埋掉的，只有那些**从头到尾没人碰过**的维度和文件。
 * 不传指纹既省掉一次 buildPack，又让这个判定的语义收窄到只剩它该管的那一件事。
 *
 * 任何一路探测失败都退回「没有空白」：观测手段的故障宁可少补一轮
 * （下一拍还会再问），也不能凭一个读不到的结果去发起真实对话烧钱 ——
 * 这与 planRotation「故障时不阻断分析」的取向相反，因为那里的默认动作是
 * 「本来就要跑，只是挑哪个维度」，而这里的默认动作是「本来不该跑」。
 */
export async function probeCoverageGaps(
  moduleId: string,
  scopeId: string,
  eligible: AiAutoAnalysisRule[],
  nowSec: number,
): Promise<CoverageGapProbe> {
  const provider = aiContextRegistry.get(moduleId);
  if (!provider || eligible.length === 0) return NO_GAP;

  let hasUncoveredDimension = false;
  // 只有轮转规则能去补一个「没被分析过的维度」；全是锁定维度的规则时连查都不用查。
  // ㉴ AU-1：探针与编排是同一把尺子的两头——池先过体裁白名单再算「从未分析」。
  // 不裁，心跳会永远把诗集「人设一致性」这种**永远补不上**的格子报成 gap-backlog：
  // 编排那头永远领不到这张卡，每一拍补跑都空转，欠账账面上永远挂着。
  const blockedKeys = automationBlocklistFor(moduleId, scopeId);
  const presets = (provider.presets ?? []).filter((p) => !blockedKeys.includes(p.key));
  if (eligible.some(isRotatingRule) && presets.length > 0) {
    try {
      const runs = await aiContextApi.listAnalysisCoverage(moduleId, scopeId);
      hasUncoveredDimension = buildAnalysisCoverage(presets, runs, { nowSec }).some(
        (r) => r.state === "never",
      );
    } catch (err) {
      logger.warn("analysisScheduler", "覆盖台账探测失败，本拍不按维度欠账处理", { error: err });
    }
  }

  let hasUnpatrolledFocus = false;
  let hasRegressedFocus = false;
  if (provider.describeFocus || provider.collectEntitySnapshot) {
    try {
      const report = provider.describeFocus?.(scopeId);
      const targets = report?.targets ?? [];
      // 回归信号必须用 load（异步读库）而不是 read（同步读缓存）：心跳可能在
      // 应用刚启动、任何面板都还没渲染过的时候敲响，此时缓存是空的，
      // 用 read 会一律判成「没有回归」——恰好把最该补的那一档静默关掉。
      const regression = provider.collectEntitySnapshot
        ? buildRegressionFeedback(await loadEntityRegression(moduleId, scopeId))
        : emptyRegressionFeedback(false);
      // 共振榜为空不等于没有回归目标：榜外劣化文件会被 planFocusPatrol 单独注入。
      // 两者都空才真的没什么可探的，此时连派单表都不用查。
      if (targets.length || regression.byFile.size > 0) {
        const assignments = await aiContextApi.listFocusAssignments(moduleId, scopeId);
        // 刻意不传 currentDigest：这里找的是「从未」，不是「过期」（见函数头注释）。
        const plan = planFocusPatrol(targets, assignments, { nowSec, regression });
        hasUnpatrolledFocus = plan.hasUnpatrolled;
        hasRegressedFocus = plan.hasRegressed;
      }
    } catch (err) {
      logger.warn("analysisScheduler", "焦点巡查探测失败，本拍不按文件欠账处理", { error: err });
    }
  }

  return { hasUncoveredDimension, hasUnpatrolledFocus, hasRegressedFocus };
}

/** 心跳查到的欠账明细，便于日志与 UI 说明「为什么现在要补」 */
export interface BackfillSurvey {
  owed: Array<{ ruleId: string; reason: BackfillReason; detail: string }>;
}

/**
 * 巡检一次：该模块在该作用域下有哪些规则欠着分析。
 *
 * 只查两张表，不构建上下文包 —— 这是心跳能设成几分钟一次的前提。
 */
export async function surveyBackfills(
  moduleId: string,
  scopeId: string,
  nowSec: number,
): Promise<BackfillSurvey> {
  const [rules, latestRuns] = await Promise.all([
    aiContextApi.listAutoAnalysisRules(moduleId),
    aiContextApi.listLatestRunPerRule(moduleId, scopeId),
  ]);
  const byRule = new Map(latestRuns.map((r) => [r.ruleId, r]));
  // scopeId 为空 = 该模块所有作用域通用，仍适用于当前作用域
  const scoped = rules.filter((r) => !r.scopeId || r.scopeId === scopeId);
  const owed: BackfillSurvey["owed"] = [];
  for (const rule of scoped) {
    const verdict = shouldBackfill(rule, byRule.get(rule.id), nowSec);
    if (verdict.owed && verdict.reason) {
      owed.push({ ruleId: rule.id, reason: verdict.reason, detail: verdict.detail ?? "" });
    }
  }

  // 已经有中断类欠账了就到此为止：反正这一拍必然会发起编排，
  // 而编排里本来就会重算共振榜、顺带把覆盖面的空白一并补上。
  // 此时再探测一次，只是把同一件事算两遍。
  if (owed.length > 0) return { owed };

  // 便宜阶段查不出欠账 —— 绝大多数心跳到这里就结束了。
  // 只有当确实存在「跑过、又冷静了足够久」的规则时，才值得为补齐类欠账多花一次探测。
  const eligible = scoped.filter((r) => gapProbeEligible(r, nowSec));
  if (eligible.length === 0) return { owed };

  const gaps = await probeCoverageGaps(moduleId, scopeId, eligible, nowSec);
  if (!gaps.hasUncoveredDimension && !gaps.hasUnpatrolledFocus && !gaps.hasRegressedFocus) {
    return { owed };
  }

  for (const rule of eligible) {
    // 三类空白的先后与编排里的例外顺序保持一致（rotate → regression → focus），
    // 否则同一件事在调度日志和编排审计里会讲成两个故事，排查时对不上账。
    //
    // 维度空白排在最前：缺一整个方面，比缺几个文件更严重。
    // 但锁定了维度的规则消费不了「换个维度」这件事，对它只能报后两类。
    if (gaps.hasUncoveredDimension && isRotatingRule(rule)) {
      owed.push({
        ruleId: rule.id,
        reason: "gap-backlog",
        detail: L("数据未变，但仍有分析维度从未被覆盖过，补齐一轮", "Data unchanged, but some analysis dimensions were never covered; backfill one round"),
      });
    } else if (gaps.hasRegressedFocus) {
      // 排在文件空白之前的唯一理由是时效：下一次扫描一到，这次劣化就滚进基线，
      // 补都补不回来；而「从未巡查过的文件」会一直在那儿等着。
      owed.push({
        ruleId: rule.id,
        reason: "gap-backlog",
        detail: L("数据未变，但有文件相对上一次扫描明显变坏且尚未追责，补一轮（再扫一次就查不到了）", "Data unchanged, but some files clearly worsened vs. the previous scan and were not attributed; backfill one round (another scan would lose the signal)"),
      });
    } else if (gaps.hasUnpatrolledFocus) {
      owed.push({
        ruleId: rule.id,
        reason: "gap-backlog",
        detail: L("数据未变，但共振榜上仍有文件从未被巡查过，点名补齐一轮", "Data unchanged, but some resonance-board files were never patrolled; backfill one round with named targets"),
      });
    }
  }
  return { owed };
}

let timer: ReturnType<typeof setInterval> | null = null;
let resolveScope: () => string | null = () => null;
let ticking = false;
let lastTickAt = 0;

export interface SchedulerStatus {
  running: boolean;
  intervalMs: number;
  /** 上次 tick 的时间戳（毫秒）；0 = 尚未跑过 */
  lastTickAt: number;
}

let intervalMs = DEFAULT_TICK_MS;

export function getSchedulerStatus(): SchedulerStatus {
  return { running: timer !== null, intervalMs, lastTickAt };
}

/**
 * 跑一次心跳。导出是为了让 UI 提供「立即检查」按钮，以及给测试直接驱动。
 *
 * 返回实际发起的补跑数量（0 是最常见也最正常的结果）。
 */
export async function tickAnalysisScheduler(nowMs = Date.now()): Promise<number> {
  if (ticking) return 0; // 上一拍还没跑完（补跑本身可能耗时），本拍让路
  ticking = true;
  lastTickAt = nowMs;
  try {
    const scopeId = resolveScope();
    if (!scopeId) return 0;
    // 扫描收尾正在编排时不插队：它马上就会把该跑的都跑了
    if (isOrchestrating()) return 0;

    // 遍历所有「对当前作用域可用」的模块，而不是写死某一个。
    // 未来画布/报告模块注册了 provider，就自动获得同一套补跑保障，这里一行都不用改。
    const providers = aiContextRegistry.listAvailable(scopeId);
    let triggered = 0;
    for (const provider of providers) {
      triggered += await tickModule(provider.moduleId, scopeId, nowMs);
    }
    return triggered;
  } catch (err) {
    // 调度是增强能力，任何异常都不能让它把自己搞死循环或冒泡到 UI
    logger.warn("analysisScheduler", "心跳执行异常（已忽略，等待下一拍）", { error: err });
    return 0;
  } finally {
    ticking = false;
  }
}

/** 单个模块的一拍。抽出来是为了让某个模块出问题时不连累其他模块的补跑 */
async function tickModule(moduleId: string, scopeId: string, nowMs: number): Promise<number> {
  try {
    const provider = aiContextRegistry.get(moduleId);
    if (!provider) return 0;

    const nowSec = Math.floor(nowMs / 1000);

    // 清算必须排在巡检**之前**，而且必须在这里做而不是等读侧自己判。
    //
    // 回执写在 sendMessage 的回调里 —— 进程还活着才写得成。应用被随手关掉时，
    // 那一轮既没 completed 也没 error，永远停在 pending：覆盖台账看 status='triggered'
    // 点绿灯、派单台账看 outcome=''（待回执）当已落实，两张表一起说谎。
    // 规则层面的 stale-pending 判定救得回「这条规则还欠一轮」，却救不回
    // 「这批文件还欠一次巡查」—— 派单行没有轨迹的时间信息，读侧无从判断
    // 它是「刚发出待回执」还是「悬了三天」。所以由清算器把两张表一起落定。
    //
    // 代价是每拍多一次带索引的 SELECT，绝大多数时候返回空；
    // 失败也不阻断本拍：规则层面的 pending 判定仍在，只是这一拍少退几批派单。
    try {
      const reaped = await aiContextApi.reapStalePendingRuns(moduleId, scopeId, STALE_PENDING_SEC);
      if (reaped > 0) {
        logger.info("analysisScheduler", "清算中断轮次", { module: moduleId, count: reaped });
      }
    } catch (err) {
      logger.warn("analysisScheduler", "中断轮次清算失败（本拍照常巡检）", { moduleId, error: err });
    }

    const survey = await surveyBackfills(moduleId, scopeId, nowSec);
    if (survey.owed.length === 0) return 0;

    // 确认有欠账才构建上下文包。指纹优先取内存里上次落库的值；
    // 取不到（应用重启后还没扫过）才真正构建一次——这也顺带把库里的包补新。
    let digest = lastPersistedDigest(moduleId, scopeId);
    if (!digest) {
      const persisted = await persistModuleContext(provider, scopeId);
      if (!persisted) return 0;
      digest = persisted.pack.digest;
    }

    logger.info("analysisScheduler", "发现欠账，发起补跑", {
      module: moduleId,
      scope: scopeId,
      owed: survey.owed,
    });

    const outcome = await runAutoAnalysis(
      { moduleId, scopeId, trigger: "backfill", digest },
      // 巡检性质的跳过不写审计：几分钟一次的「没有欠账」会把轨迹表淹掉
      { recordSkips: false },
    );
    return outcome.triggered;
  } catch (err) {
    logger.warn("analysisScheduler", "模块补跑失败（不影响其他模块）", { moduleId, error: err });
    return 0;
  }
}

export interface StartSchedulerOptions {
  /** 每拍间隔，默认 5 分钟 */
  intervalMs?: number;
  /**
   * 当前该盯着哪个作用域（当前工程里就是活动分析 id）；null = 没有可分析的对象。
   *
   * 做成函数而不是固定值：用户随时会切换项目，固定值会让调度器一直对着一个
   * 早已关掉的分析发起补跑。至于「这个作用域下有哪些模块」，由注册表回答，
   * 调用方不需要、也不应该知道。
   */
  getScopeId: () => string | null;
  /**
   * 启动后是否立刻跑一拍。默认 true —— 应用重启正是最容易积压欠账的时刻
   * （上次退出时中断的那一轮就停在 pending），等满一个周期才检查太迟。
   */
  immediate?: boolean;
}

/**
 * 启动调度心跳（幂等：重复调用只会用新参数重启，不会叠加多个定时器）。
 *
 * 叠加是这类模块最典型的事故：切一次项目起一个 timer，切五次就有五拍同时敲，
 * 同一条规则被并发补跑五次。宁可每次都先停再起。
 */
export function startAnalysisScheduler(options: StartSchedulerOptions): void {
  stopAnalysisScheduler();
  intervalMs = Math.max(30_000, options.intervalMs ?? DEFAULT_TICK_MS);
  resolveScope = options.getScopeId;
  timer = setInterval(() => {
    void tickAnalysisScheduler();
  }, intervalMs);
  logger.info("analysisScheduler", "调度心跳已启动", { intervalMs });
  if (options.immediate !== false) {
    void tickAnalysisScheduler();
  }
}

export function stopAnalysisScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("analysisScheduler", "调度心跳已停止");
  }
  resolveScope = () => null;
}
