/**
 * autoAnalysisOrchestrator —— 「上下文更新后自动交给 Agent 分析」的编排器。
 *
 * 它补上的是整条链路最后一环：在此之前，扫描把数据整理得再好，也要用户手动点一次
 * 「开始深度分析」才会发生。对一个每天跑很多次扫描的项目来说，这意味着绝大多数
 * 数据更新最终无人解读。编排器让分析随数据自动发生，人只在结果里做决策。
 *
 * 三道闸门防止「自动」变成「失控」：
 *   · trigger  —— 区分全量扫描与 watch 增量重扫，用户可以只在全量后分析；
 *   · cooldown —— 冷却窗口内不重复触发，避免连续改文件把 Agent 打爆（也是花钱的闸门）；
 *   · digest   —— 内容指纹没变就不重复烧一次 AI（改个注释不该触发一轮全量解读）。
 *
 * 每一次判定结果都会写进 ai_auto_analysis_runs：**跳过也要记，并且必须带原因**。
 * 否则用户面对「怎么没自动跑」时只能猜，自动化就成了黑箱。
 *
 * 模块无关：本文件不含扫描知识，任何实现了 AiContextProvider 的模块都能复用。
 */
import type { AiAutoAnalysisRule, AiFocusAssignmentDto } from "../services/tauri";
import { aiContextApi } from "../services/tauri";
import { useAgentStore } from "../store/agentStore";
import { AnalysisLaunchError, launchModuleAnalysis } from "./analysisRunner";
import { aiContextRegistry } from "./contextRegistry";
import { buildAnalysisCoverage, pickNextPreset } from "./analysisCoverage";
import { createFocusDispatcher, planFocusPatrol, type FocusPatrolPlan } from "./focusPatrol";
import { loadInsightFeedback } from "./insightFeedback";
import { loadEntityRegression } from "./entityRegression";
import { buildRegressionFeedback } from "./regressionFocus";
import type { AiFocusReport } from "./contextTypes";
import { logger } from "../utils/logger";
import { t } from "../i18n";

/**
 * 触发种类。
 *
 * · full-scan / incremental —— 由扫描事件驱动，数据刚更新。
 * · backfill —— 由调度心跳驱动，用来补上一轮**本该跑却被拦下**的分析。
 *   没有它，自动化就只能在「用户恰好又扫了一次」的瞬间发生：撞上冷却窗口
 *   或撞上 Agent 正在回答，这一轮就永久丢失，而界面上毫无提示。
 */
export type AutoTriggerKind = "full-scan" | "incremental" | "backfill";

/** 规则的触发时机配置 */
export const TRIGGER_ON_FULL = "full-scan";
export const TRIGGER_ON_ANY = "any-scan";

export interface AutoRuleEvalContext {
  moduleId: string;
  scopeId: string;
  trigger: AutoTriggerKind;
  /** 本次上下文包指纹 */
  digest: string;
  /** 当前时间（秒），显式传入便于测试 */
  nowSec: number;
  /**
   * 轮转规则专用：当前还有**从未分析过**的维度。
   *
   * 指纹去重成立的前提是「同样的数据 + 同样的问题 = 同样的结论」。轮转下一轮问的是
   * 另一个方面，结论必然是新的，此时被「内容没变」拦下就意味着：项目稳定不动的时候，
   * 除第一个维度外的所有方面**永远不会被分析**——恰好把轮转这个功能架空。
   */
  hasUncoveredDimension?: boolean;
  /**
   * 当前还有**从未巡查过**的高共振文件。
   *
   * 与上一条同源的第二种失真：指纹去重假设「同样的数据 = 同样的结论」，
   * 但那只在**看的是同一个对象**时才成立。共振榜上还有从没被点名过的文件时，
   * 换一个对象去看，结论必然是新的——被「内容没变」拦下，等于宣布
   * 「凡是第一轮没被 Agent 挑中的文件，此后永远不会有人看」。
   *
   * 与维度轮转不同的是，这一条对**所有规则**生效，不只是轮转规则：
   * 用户锁定了「重构优先级」这个维度，并不代表他希望永远只重构那几个显眼的大文件。
   * 收敛性由派单台账保证：点名即销账，目标总数有限（共振榜 Top-N），
   * 且每一轮仍受冷却闸门约束，所以它是「每个冷却窗口补几个文件」而非无限烧 token。
   */
  hasUnpatrolledFocus?: boolean;
  /**
   * 有文件欠着一次**复核**：它已有 AI 结论，而结论依据的代码之后又改了。
   *
   * 这是第三种「数据没变但仍该跑」的情形，也是三者里最不直观的一种：
   * 上下文包指纹确实可能没动（改动落在包里没有逐字收录的位置，或者变化被
   * Top-N 截断挡在外面），但**这条结论对不对**已经变成了未知数。
   * 不复核的代价不只是漏看：那条过期结论会继续挂在面板上、继续进入
   * 后续每一轮的上下文，同时误导人和模型——问题越拖越贵。
   *
   * 与前两条一样受冷却闸门约束，且靠 evidenceDigest 记账收敛（派单时记下
   * 「这次证据长什么样」，只有证据再次变化才重新排队），不会无限重复点名。
   */
  hasPendingRecheck?: boolean;
  /**
   * 有文件**相对上一次扫描明显变坏**，欠一次追责。
   *
   * 这是第四种「数据没变但仍该跑」的情形，也是四者里唯一**会过期**的一种：
   * 前三种漏一轮还在原地等着补，而这一次劣化只要再扫一次就会滚进基线成为
   * 「一直如此」——从此没有任何视图看得见它，补都补不回来。
   *
   * 值钱的地方也正在这里：改动是谁引入的还查得到、作者也还记得当时在想什么，
   * 而且「哪一维从多少变到多少」是客观量，问题描述天然精确，不依赖模型的主观判断。
   *
   * 收敛靠 regressionDigest（这次劣化本身的指纹）记账：榜单因别的文件重算不会
   * 让它翻新，本文件继续恶化才会——那本来就是一次新的回归。
   */
  hasRegressedFocus?: boolean;
}

export interface AutoRuleDecision {
  shouldRun: boolean;
  /** 机器可读原因（disabled / module-mismatch / scope-mismatch / trigger-mismatch / cooling / unchanged / ok） */
  reason: string;
  /** 人可读说明，直接写进审计 detail */
  detail: string;
}

/**
 * 判定一条规则在本次上下文更新时是否应触发。
 *
 * 纯函数：不碰 store、不碰 DB、不看时钟（now 由外部传）。判定逻辑是这套自动化里
 * 最容易出错也最需要回归保护的部分，独立出来才好写单测。
 */
export function evaluateAutoRule(
  rule: AiAutoAnalysisRule,
  ctx: AutoRuleEvalContext,
): AutoRuleDecision {
  if (!rule.enabled) {
    return { shouldRun: false, reason: "disabled", detail: t("aiPanel.autoDetail.disabled") };
  }
  if (rule.moduleId !== ctx.moduleId) {
    return {
      shouldRun: false,
      reason: "module-mismatch",
      detail: t("aiPanel.autoDetail.moduleMismatch", { rule: rule.moduleId, ctx: ctx.moduleId }),
    };
  }
  // scopeId 为空 = 该模块下所有作用域通用
  if (rule.scopeId && rule.scopeId !== ctx.scopeId) {
    return {
      shouldRun: false,
      reason: "scope-mismatch",
      detail: t("aiPanel.autoDetail.scopeMismatch", { scope: rule.scopeId }),
    };
  }
  // 补跑不是一次新的触发，而是把上一次**已经满足触发条件、却被临时状况拦下**的
  // 那一轮接着跑完。所以它天然不该再被「触发时机」二次审查：那一关上次就过了。
  // 若在这里按 trigger 字面值比对，设成「仅全量扫描后」的规则将永远补不上任何一轮，
  // 补跑对最常见的配置直接失效。
  if (rule.triggerOn === TRIGGER_ON_FULL && ctx.trigger === "incremental") {
    return {
      shouldRun: false,
      reason: "trigger-mismatch",
      detail: t("aiPanel.autoDetail.triggerMismatch"),
    };
  }
  if (rule.cooldownMinutes > 0 && rule.lastRunAt > 0) {
    const elapsedMin = (ctx.nowSec - rule.lastRunAt) / 60;
    if (elapsedMin < rule.cooldownMinutes) {
      const left = Math.max(1, Math.ceil(rule.cooldownMinutes - elapsedMin));
      return {
        shouldRun: false,
        reason: "cooling",
        detail: t("aiPanel.autoDetail.cooling", { left, window: rule.cooldownMinutes }),
      };
    }
  }
  if (rule.skipIfUnchanged && rule.lastDigest && rule.lastDigest === ctx.digest) {
    // 例外一：轮转规则还有从未分析过的维度（换个**问题**问，结论必然是新的）。
    // 冷却闸门在上面已经过了，所以这不会变成「不停地烧 token」，
    // 而是「同一份数据上，每个冷却窗口补一个此前没人看过的方面」。
    if (isRotatingRule(rule) && ctx.hasUncoveredDimension) {
      return {
        shouldRun: true,
        reason: "rotate-gap",
        detail: t("aiPanel.autoDetail.rotateGap"),
      };
    }
    // 例外二：有文件相对上一次扫描明显变坏（换个**时点**看，而且这个时点马上就没了）。
    //
    // 排序原则是「这一轮不跑，会永久损失什么」，而不是「哪个更重要」：
    //   · rotate-gap / focus-gap 的空白不会跑掉，这轮不补下轮还在；
    //   · recheck 拖着只是更贵，结论还在库里等；
    //   · 而回归只要再扫一次就滚进基线，此后任何视图都看不见——这是四者中唯一的永久损失。
    // 唯独让 rotate-gap 排在它前面：轮转空白是「整整一个方面从没被问过」，粒度最粗、
    // 且预设数量有限、几轮就能收敛完，让它先走的代价是有界的。
    if (ctx.hasRegressedFocus) {
      return {
        shouldRun: true,
        reason: "regression-gap",
        detail: t("aiPanel.autoDetail.regressionGap"),
      };
    }
    // 例外三：共振榜上还有从未巡查过的文件（换个**对象**看，结论同样必然是新的）。
    // 排在维度之后：缺一整个方面比缺几个文件更严重，先补粗粒度的那个。
    if (ctx.hasUnpatrolledFocus) {
      return {
        shouldRun: true,
        reason: "focus-gap",
        detail: t("aiPanel.autoDetail.focusGap"),
      };
    }
    // 例外四：已有结论所依据的代码变了，欠一次复核。
    // 排在最后不是因为价值最低——恰恰相反，单位 token 的信息量它最高——
    // 而是因为它最不该「顶掉」前面几种：那几种要么补的是永久空白，
    // 要么带着过期时限；复核漏一轮还有下一轮，只是会更贵。
    if (ctx.hasPendingRecheck) {
      return {
        shouldRun: true,
        reason: "recheck-gap",
        detail: t("aiPanel.autoDetail.recheckGap"),
      };
    }
    return {
      shouldRun: false,
      reason: "unchanged",
      detail: t("aiPanel.autoDetail.unchanged"),
    };
  }
  return { shouldRun: true, reason: "ok", detail: t("aiPanel.autoDetail.ok") };
}

function runId(): string {
  return `arun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 规则里的「轮转」哨兵值：不锁定维度，每轮由覆盖台账挑最缺的那个 */
export const PRESET_ROTATE = "__rotate__";

/** 这条规则是否处于轮转模式 */
export function isRotatingRule(rule: AiAutoAnalysisRule): boolean {
  return rule.presetKey === PRESET_ROTATE;
}

/** 一轮的维度决策：跑哪个预设、为什么、是否还有从未分析过的方面 */
export interface RotationPlan {
  presetKey: string | undefined;
  note: string;
  /** 存在「从未分析过」的维度——它是压过指纹去重的唯一理由 */
  hasUncovered: boolean;
}

/**
 * 决定这一轮用哪个预设。
 *
 * 规则显式指定了维度就照办——用户的选择优先于任何自动推断。
 * 选了「轮转」才查覆盖台账：从未分析过的维度优先，其次是数据已变的，
 * 这样一条规则跑上几轮，各个方面自然都被覆盖过一遍，不必让用户手工建 N 条规则。
 *
 * 台账查询失败时**不阻断**，退回模块第一个预设（由 runner 的 resolvePreset 兜底）：
 * 观测手段的故障不该让分析本身停摆。
 */
export async function planRotation(
  rule: AiAutoAnalysisRule,
  ctx: { moduleId: string; scopeId: string; digest: string; nowSec: number },
): Promise<RotationPlan> {
  if (!isRotatingRule(rule)) {
    // 空串是早于轮转特性的历史规则：保持原语义，交给 runner 取第一个预设
    return { presetKey: rule.presetKey || undefined, note: "", hasUncovered: false };
  }

  const presets = aiContextRegistry.get(ctx.moduleId)?.presets ?? [];
  if (presets.length === 0) return { presetKey: undefined, note: "", hasUncovered: false };

  try {
    const runs = await aiContextApi.listAnalysisCoverage(ctx.moduleId, ctx.scopeId);
    const coverage = buildAnalysisCoverage(presets, runs, {
      currentDigest: ctx.digest,
      nowSec: ctx.nowSec,
    });
    const hasUncovered = coverage.some((r) => r.state === "never");
    const next = pickNextPreset(coverage);
    if (next) {
      return {
        presetKey: next.presetKey,
        note: t("aiPanel.autoDetail.rotateNote", { title: next.title, detail: next.detail }),
        hasUncovered,
      };
    }
    // 全都新鲜时仍要跑一轮（能走到这里说明指纹已变或用户关了去重），
    // 挑最久没看的那个，总比永远盯着第一个预设强
    const fallback = pickNextPreset(coverage, { includeFresh: true });
    return {
      presetKey: fallback?.presetKey,
      note: fallback ? t("aiPanel.autoDetail.revisitNote", { title: fallback.title }) : "",
      hasUncovered: false,
    };
  } catch (err) {
    logger.warn("autoAnalysis", "覆盖台账读取失败，本轮退回默认预设", { error: err });
    return { presetKey: undefined, note: "", hasUncovered: false };
  }
}

async function recordSkip(
  rule: AiAutoAnalysisRule,
  ctx: AutoRuleEvalContext,
  status: "skipped" | "failed",
  reason: string,
  detail: string,
): Promise<void> {
  try {
    await aiContextApi.recordAutoAnalysisRun({
      id: runId(),
      ruleId: rule.id,
      moduleId: ctx.moduleId,
      scopeId: ctx.scopeId,
      agentId: rule.agentId,
      presetKey: rule.presetKey,
      packId: null,
      conversationId: null,
      triggerKind: ctx.trigger,
      status,
      detail,
      // 机器可读原因：补跑调度据此判断「这条规则是不是还欠着一轮」。
      // 只写 detail 的中文句子，等于让调度去解析文案，改一个字就失灵。
      reason,
      outcome: "",
    });
  } catch (err) {
    // 审计写失败不该影响主流程，但要留痕，否则连「审计没写上」都无从得知
    logger.error("autoAnalysis", "record run failed", { error: err });
  }
}

export interface AutoAnalysisOutcome {
  /** 实际发起的分析次数（0 = 全部被闸门拦下，属正常情况） */
  triggered: number;
  /** 被跳过的规则数 */
  skipped: number;
  /** 发起失败的规则数 */
  failed: number;
  /** 本轮因已有编排在跑而整体让路 */
  busy?: boolean;
}

/**
 * 编排重入锁。
 *
 * 扫描收尾与调度心跳是两个独立的触发源，完全可能撞在一起（一次全量扫描刚落库，
 * 心跳恰好到点）。两边同时遍历同一批规则，会对同一条规则连发两次分析：
 * 既翻倍烧 token，又让覆盖台账把一次分析数成两次。
 * 让后到的那一方直接退出即可——它要做的事，先到的那一方正在做。
 */
let orchestrating = false;

/** 供 UI / 调度器查询：当前是否有一轮编排正在进行 */
export function isOrchestrating(): boolean {
  return orchestrating;
}

export interface RunAutoAnalysisOptions {
  /**
   * 是否把「被闸门拦下」写进审计轨迹。默认 true。
   *
   * 扫描驱动的跳过必须记：用户扫完一次没等到分析，需要在轨迹里看到「冷却中」这样的解释。
   * 但心跳驱动的补跑巡检不能记 —— 心跳每几分钟问一次「有没有欠账」，
   * 绝大多数时候答案是「没有」，照记会把轨迹表刷成一片无意义的 skipped，
   * 真正有价值的那几条反而被淹没。
   */
  recordSkips?: boolean;
}

/**
 * 上下文更新后调用一次：遍历该模块的规则，逐条判定并执行。
 *
 * 调用方（如 projectStore.persistScanContext）应当 try/catch 包裹或忽略返回值——
 * 自动分析是增强能力，任何异常都不能反过来打断扫描主流程。
 */
/**
 * 决定这一轮要不要「点名几个长期空白的高共振文件」，以及点哪几个。
 *
 * 这条路径与维度轮转正交：轮转解决「各个**方面**都被问过」，本函数解决
 * 「每个方面问的对象都是同一个显眼大文件」。两者在编排器里各算各的、互相不依赖，
 * 但都指向同一个目标——让自动化不遗漏任何值得看的东西。
 *
 * 模块无关：目标来自 provider.describeFocus（与给人看的 FocusReportPanel 同源同口径），
 * 派单台账来自 listFocusAssignments。任何实现了 describeFocus 的模块自动复用本能力，
 * 无需改动编排器一行。
 *
 * 故障降级策略与 planRotation 一致：观测手段（派单表/焦点计算）出错时，宁可多跑一轮、
 * 也别漏掉头号目标——派单记录查不到就当作「从未巡查」（planFocusPatrol 全部判 never）；
 * 焦点计算直接失败就退回不点名（本轮损失有限，下一轮数据还在）。
 */
const EMPTY_FOCUS_PLAN: FocusPatrolPlan = {
  rows: [],
  picks: [],
  queue: [],
  hasUnpatrolled: false,
  hasPendingRecheck: false,
  hasRegressed: false,
};

async function computeFocusPlan(
  ctx: { moduleId: string; scopeId: string; digest: string },
  nowSec: number,
): Promise<FocusPatrolPlan> {
  const provider = aiContextRegistry.get(ctx.moduleId);
  if (!provider?.describeFocus) {
    return EMPTY_FOCUS_PLAN;
  }

  // 回归观测：让「这一轮谁变坏了」参与注意力分配。
  //
  // 用 load 而不是 read 缓存：编排既可能紧跟扫描收尾（缓存刚被 capture 刷新过），
  // 也可能由重启后的第一拍心跳发起（缓存是空的）。后者若读缓存，会把
  // 「进程刚起来还没算过」误当成「没有文件变坏」，回归追责在重启后彻底静默。
  // 读库失败时 buildRegressionFeedback(null) 返回 available:false，链路静默关闭。
  const regressionReport = provider.collectEntitySnapshot
    ? await loadEntityRegression(ctx.moduleId, ctx.scopeId)
    : null;
  const regression = buildRegressionFeedback(regressionReport);

  let assignments: AiFocusAssignmentDto[] = [];
  try {
    assignments = await aiContextApi.listFocusAssignments(ctx.moduleId, ctx.scopeId);
  } catch (err) {
    // 派单表读不到：当作「全部从未巡查」，下一轮必然把头号目标补上。
    // 不能就此退回不点名——那样头号目标会被永久沉默。
    logger.warn("autoAnalysis", "焦点派单读取失败，本轮按从未巡查处理", { error: err });
  }

  // 洞察回流：让 AI 自己上几轮的结论参与「先看谁」的排序。
  // 读失败时 loadInsightFeedback 返回 available:false，整条复核链路静默关闭，
  // 判定退回纯静态口径——绝不能把「没读到」当成「没有结论」。
  const feedback = await loadInsightFeedback(ctx.scopeId);

  let report: AiFocusReport | null = null;
  try {
    report = provider.describeFocus(ctx.scopeId);
  } catch (err) {
    logger.warn("autoAnalysis", "describeFocus 失败，本轮不点名", { error: err });
    return EMPTY_FOCUS_PLAN;
  }
  // 共振榜为空**不等于**没有该看的文件：回归信号可以带来榜外目标（planFocusPatrol
  // 会把它们注入队列）。这里直接返回空计划，会让「刚变坏的文件」在共振榜尚未成形时
  // （扫描维度跑得少、共振全为 0）彻底静默。
  const targets = report?.targets ?? [];
  if (!targets.length && regression.byFile.size === 0) {
    return EMPTY_FOCUS_PLAN;
  }

  return planFocusPatrol(targets, assignments, {
    currentDigest: ctx.digest,
    feedback,
    regression,
    nowSec,
  });
}

export async function runAutoAnalysis(
  ctx: {
    moduleId: string;
    scopeId: string;
    trigger: AutoTriggerKind;
    digest: string;
  },
  options: RunAutoAnalysisOptions = {},
): Promise<AutoAnalysisOutcome> {
  const outcome: AutoAnalysisOutcome = { triggered: 0, skipped: 0, failed: 0 };
  const recordSkips = options.recordSkips !== false;

  if (orchestrating) {
    logger.info("autoAnalysis", "已有编排在进行，本轮让路", { trigger: ctx.trigger });
    return { ...outcome, busy: true };
  }
  orchestrating = true;
  try {
    return await orchestrate(ctx, outcome, recordSkips);
  } finally {
    orchestrating = false;
  }
}

async function orchestrate(
  ctx: {
    moduleId: string;
    scopeId: string;
    trigger: AutoTriggerKind;
    digest: string;
  },
  outcome: AutoAnalysisOutcome,
  recordSkips: boolean,
): Promise<AutoAnalysisOutcome> {
  let rules: AiAutoAnalysisRule[];
  try {
    rules = await aiContextApi.listAutoAnalysisRules(ctx.moduleId);
  } catch (err) {
    logger.error("autoAnalysis", "list rules failed", { error: err });
    return outcome;
  }
  if (!rules.length) return outcome;

  const evalCtx: AutoRuleEvalContext = {
    ...ctx,
    nowSec: Math.floor(Date.now() / 1000),
  };

  // 焦点目标巡查：模块+作用域级，与具体规则无关，整轮只算一次。
  // 决定「要不要点名几个长期空白的高共振文件」以及「点哪几个」，
  // 与维度轮转是两条正交的补齐路径（一个补「方面」、一个补「对象」）。
  // 它必须早于规则循环：focus-gap 是唯一能压过指纹去重的第二条例外，
  // 判定每一条规则时都得上这个值。
  const focusPlan = await computeFocusPlan(ctx, evalCtx.nowSec);
  // 队列在多条规则之间**顺序消费**：一轮里若触发了两条规则，第二条领的是队列后半段，
  // 而不是把同一批文件再点一次名（那既虚增派单次数，又让后面的目标一个都轮不到）。
  const focusDispatch = createFocusDispatcher(focusPlan);

  // Agent 列表可能还没加载（应用刚启动就完成了一次扫描），先确保拿得到，
  // 否则会把「Agent 不存在」误判成用户配置错误，写出误导性的审计记录。
  const agentState = useAgentStore.getState();
  if (agentState.agents.length === 0) {
    try {
      await agentState.loadAgents();
    } catch {
      /* 加载失败走下面的 agent-missing 分支，原因照样落审计 */
    }
  }

  for (const rule of rules) {
    // 维度决策必须在闸门判定**之前**：轮转规则「还有没被分析过的方面」这件事，
    // 是唯一能压过指纹去重的理由，判定时就得知道。
    const plan = await planRotation(rule, evalCtx);
    const decision = evaluateAutoRule(rule, {
      ...evalCtx,
      hasUncoveredDimension: plan.hasUncovered,
      // 看**剩余**队列而非整轮计划：前一条规则已经把 never 目标领完时，
      // 这一条不该再以 focus-gap 为由在「数据没变」时被唤醒——它拿到的会是空清单，
      // 白跑一轮，而这正是指纹去重本来要拦住的事。
      hasUnpatrolledFocus: focusDispatch.hasUnpatrolled(),
      // 同理看**剩余**队列：复核目标被前一条规则领完之后，这一条不该再以
      // recheck-gap 为由被唤醒然后拿到空清单。
      hasPendingRecheck: focusDispatch.hasPendingRecheck(),
      // 回归目标同理。
      hasRegressedFocus: focusDispatch.hasRegressed(),
    });
    if (!decision.shouldRun) {
      // module-mismatch 只是过滤噪声，不值得写审计（列表已按模块过滤，正常不会出现）
      if (decision.reason !== "module-mismatch" && decision.reason !== "scope-mismatch") {
        outcome.skipped += 1;
        if (recordSkips) {
          await recordSkip(rule, evalCtx, "skipped", decision.reason, decision.detail);
        }
      }
      continue;
    }

    // 领单必须在发起**之前**：launchModuleAnalysis 会把这批目标写进派单台账，
    // 领完即从本轮队列里划掉，同一轮的下一条规则自然拿到不同的文件。
    //
    // 发起失败时这批目标只在**本轮**作废、不入库，下一轮读库仍是「从未巡查」，
    // 会被重新排队——跨轮的唯一真相是派单表，队列游标只管本轮不重复。
    const focusTargets = focusDispatch.take();

    try {
      const res = await launchModuleAnalysis({
        moduleId: ctx.moduleId,
        scopeId: ctx.scopeId,
        agentId: rule.agentId,
        presetKey: plan.presetKey,
        titlePrefix: ctx.trigger === "backfill" ? "[补跑]" : "[自动]",
        // 自动触发不抢用户当前视图：分析在后台跑，结果沉淀到洞察面板
        focusConversation: false,
        // 轨迹由 runner 统一写（手动与自动同一份口径），这里只把来源标识传下去
        ruleId: rule.id,
        triggerKind: ctx.trigger,
        reason: decision.reason,
        // 本轮点名的焦点目标（共振榜上从未巡查的高共振文件）；空数组等价于不点名。
        // 不论规则因何种原因触发都一并带上：维度轮转和文件点名是两条独立的补齐路径，
        // 能同时推进就同时推进，不浪费已经发起的这一轮 Agent 调用。
        focusTargets,
      });

      // 推进规则状态（冷却起点与去重指纹）。triggered 轨迹已由 runner 写过，
      // 这里再写一条会让覆盖台账把同一次分析数成两次。
      await aiContextApi.markAutoAnalysisRun(rule.id, res.digest, res.conversationId);
      outcome.triggered += 1;
      logger.info("autoAnalysis", "已自动发起分析", {
        rule: rule.id,
        preset: res.presetKey,
        conversation: res.conversationId,
        reason: decision.reason,
        note: plan.note,
        focus: res.focusPaths,
      });
    } catch (err) {
      const isLaunchErr = err instanceof AnalysisLaunchError;
      // busy（上一轮还在回答）本质是「稍后再来」而非配置错误，记为 skipped 更贴切
      const status = isLaunchErr && err.reason === "busy" ? "skipped" : "failed";
      const detail = isLaunchErr
        ? `${err.message}（${err.reason}）`
        : `发起失败：${(err as Error)?.message ?? String(err)}`;
      if (status === "skipped") outcome.skipped += 1;
      else outcome.failed += 1;
      // 发起阶段的失败一律记，哪怕来自心跳巡检：
      // 「巡检没有欠账」不值得写，「巡检发现欠账、去补却补不动」必须写。
      await recordSkip(rule, evalCtx, status, isLaunchErr ? err.reason : "launch-error", detail);
      logger.warn("autoAnalysis", "自动分析未发起", { rule: rule.id, detail });
    }
  }

  // 本轮点名总数：诊断「这一轮为什么烧了 token」时，第一个要看的就是它——
  // 是数据变了（reason=ok），还是在补维度（rotate-gap），还是在补文件（focus-gap）。
  if (focusDispatch.dispatched() > 0) {
    logger.info("autoAnalysis", "本轮焦点巡查派单", {
      dispatched: focusDispatch.dispatched(),
      queued: focusPlan.queue.length,
      tracked: focusPlan.rows.length,
    });
  }

  return outcome;
}
