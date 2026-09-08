/**
 * focusPatrol —— 让自动轮转在「补维度」之外，也能「补文件」。
 *
 * 它补的是什么
 * ------------
 * 轮转台账（analysisCoverage）解决的是「各个**方面**都被问过一遍」：这一轮问架构，
 * 下一轮问技术债。但每一轮问的对象仍然是整个项目，具体看哪个文件完全由 Agent 自由发挥。
 * 实际发生的事情非常一致：**每轮都在同一批显眼的大文件上打转**——它们在任何一个分节的
 * Top-N 里都排在前面，随手一读就能写出结论。
 *
 * 而 riskMatrix 的全部价值恰恰在另一头：那个「每一维都排第 20 名、四维同时报警」的文件，
 * 在所有分节明细里一次都不出现，只出现在共振榜第一行。它是头号重构目标，
 * 却也是最容易被 Agent 漏掉的目标——因为它在别处不显眼。
 *
 * 于是自动化可以一路绿灯：维度全覆盖、轨迹全 completed、洞察也有几十条，
 * 但共振榜第一名从头到尾无人碰过。这不是数据问题，也不是提示词问题，
 * 是**编排从不指定对象**的结构性缺口。本文件把「看哪个文件」也纳入编排。
 *
 * 销账口径：派单即销账（这是唯一不能改的地方）
 * --------------------------------------------
 * 直觉上的做法是「有洞察 = 看过」，用 ai_insights 反推覆盖。这个口径是错的：
 * Agent 认真读完一个文件、判定「没问题」时不会写洞察，于是它永远显示未覆盖，
 * 每一轮都被重新点名——一个永不收敛、持续烧 token 的循环，而且越是干净的代码烧得越久。
 *
 * 所以销账看的是「派过单没有」，不是「有没有结论」：点名一次就记一笔，
 * 之后除非数据变了（上下文指纹变化）才重新排队。这保证了两件事：
 *   · 每个高共振目标迟早都会被点名一次（有限步收敛）；
 *   · 同一份数据上不会重复点名同一个文件（不烧冤枉钱）。
 *
 * 为什么门槛是「共振 ≥ 2 维」
 * --------------------------
 * 单维极端值（自动生成的巨型文件复杂度爆表却从不改动）本来就在对应分节的 Top-N 里
 * 一目了然，不需要额外点名；专门为它开一轮，正好把省下来的 token 又花回去。
 * 值得动用「点名」这个稀缺手段的，是那些**在别处看不见**的多维共振目标。
 *
 * 模块无关：本文件只认协议里的 AiFocusTarget（filePath / resonance / score / dims）
 * 与派单记录，不含任何扫描知识。任何实现了 describeFocus 的模块都能直接复用。
 */
import type { AiFocusTarget } from "./contextTypes";
import { L } from "./aiLang";
import type { AiFocusAssignmentDto } from "../services/tauri";
import {
  emptyInsightFeedback,
  needsRecheck,
  severityRank,
  type FileInsightSignal,
  type InsightFeedback,
} from "./insightFeedback";
import {
  REGRESSION_INJECT_LIMIT,
  emptyRegressionFeedback,
  needsRegressionPatrol,
  type FileRegressionSignal,
  type RegressionFeedback,
} from "./regressionFocus";

/** 一个焦点目标的巡查状态 */
export type FocusPatrolState =
  /**
   * 这个文件已经有 AI 结论，而结论依据的代码之后又改了 —— 欠一次**复核**。
   *
   * 它与其它几档的区别在于「已知」：问题是什么、在第几行、上次判成什么严重度都在库里，
   * Agent 不必重新理解整个文件，只需回答「修好了、还在、还是更糟了」。
   * 单位 token 的信息量是全场最高的一档，而且有时效压力 —— 不复核的话，
   * 这条过期结论会继续挂在面板上、继续进入后续每一轮上下文，误导人也误导模型。
   *
   * 收敛靠 evidenceDigest 记账，不靠「洞察有没有更新」：后者会让
   * 「Agent 复核后判定结论仍成立、于是什么都没写」变成永久重复点名。
   */
  | "recheck"
  /**
   * 这个文件**相对上一次扫描明显变坏了** —— 欠一次**追责**。
   *
   * 前面几档判的都是「有没有人看过」，只有这一档判的是「刚刚发生了什么」。
   * 静态共振榜永远回答「现在谁最糟」，于是长期糟糕、谁也不敢动的巨型文件稳坐榜首，
   * 而昨天被一次改动从复杂度 20 推到 38 的文件，因为绝对值还排在二十名开外，
   * 一次都不会被点名——尽管它才是此刻最容易修、也最该修的那个。
   *
   * 它是唯一**会过期**的一档：再扫一次，这次劣化就滚进基线成为「一直如此」，
   * 从此没有任何视图看得见它。never / recheck 漏一轮还在原地等，回归漏一轮就没了。
   *
   * 收敛靠 regressionDigest（这次回归本身的指纹）记账，不靠整包指纹：
   * 后者会因为改个 README 而翻新，让同一笔劣化被反复点名。
   */
  | "regressed"
  /** 从未派单过——压过「内容没变就跳过」的理由之一 */
  | "never"
  /**
   * 派过单，但那一轮没跑成：账销了、事没办。
   *
   * 两种死法都归这一档 —— 对话失败（error），以及应用在 Agent 答完之前被关掉、
   * 轨迹悬在 pending 最终被清算成 interrupted。对用户而言是同一件事：
   * 这个文件实际上没有被看过。
   *
   * 这是「派单即销账」留下的反向漏洞：销账口径解决了「判定没问题不写洞察 →
   * 永远重复点名」的不收敛循环，却让**发起了但没跑成**的那一轮也销了账。
   * 补跑调度会把规则重新排队，可焦点台账读库时这个文件已是「已巡查」，
   * 从此不再被点名 —— 一次网络抖动、一次关窗口，都足以让共振榜第一名永久沉默，
   * 而账面上一切正常。所以它必须与 never 同权：都还欠着一次真正的巡查。
   */
  | "failed"
  /** 派过单，但之后数据变了：上一轮的结论未必还对得上现在的代码 */
  | "stale-data"
  /** 派过单且数据未变：这一轮不必再点它 */
  | "patrolled";

export interface FocusPatrolRow {
  filePath: string;
  /** 共振维度数（排序主键：它比综合分更不依赖权重） */
  resonance: number;
  score: number;
  state: FocusPatrolState;
  /**
   * 该文件在洞察侧的信号（无历史结论时为 undefined）。
   *
   * 只用来决定**先看谁**与**怎么跟 Agent 说**，绝不参与 resonance / score 的计算：
   * severity 是模型自评、天然通胀，一旦进入打分，共振榜就会退化成
   * 「哪个文件被 AI 夸得最厉害」，而它「客观、可复现、与模型无关」的立身之本也就没了。
   */
  insight?: FileInsightSignal;
  /**
   * 该文件在回归侧的信号（本轮没有变坏、或还没有可比历史时为 undefined）。
   *
   * 与 insight 同样只决定**先看谁**与**怎么跟 Agent 说**，绝不参与 resonance / score：
   * 「变坏了多少」和「现在有多糟」是两个正交的量，混在一起会让一个从 1 涨到 2 的
   * 无关紧要指标，压过一个一直是 90 的真实雷区。
   */
  regression?: FileRegressionSignal;
  /**
   * 派单时应当记账的「本轮回归指纹」（本轮没有变坏时为空串）。
   *
   * 三本账各记各的（见 migration 30d）：contextDigest 管整包、evidenceDigest 管已知结论、
   * 本列管这次劣化。同一个文件可以同时欠复核和欠追责，合并会让两笔账互相冲销。
   */
  regressionDigest: string;
  /**
   * 派单时应当记账的「证据现状指纹」（无历史结论时为空串）。
   *
   * 它与 contextDigest 是两套独立的时钟，缺一不可：
   *   · contextDigest 回答「整包上下文变了没有」——粒度是整个作用域，任何一处改动都会翻脸；
   *   · evidenceDigest 回答「**这个文件的已知问题所在之处**变了没有」——粒度到文件。
   * 只有后者才能让复核收敛：项目里别处的改动不该把一个已复核过的文件重新拖回队列。
   */
  evidenceDigest: string;
  /** 上次派单时间（秒）；从未派单为 null */
  lastAssignedAt: number | null;
  /** 累计被点名次数：点名多次仍无任何结论，是需要人工介入的信号 */
  assignCount: number;
  /**
   * 已重试到上限、本轮不再自动点名。
   *
   * 只对 failed 有意义。它存在的理由很实际：Agent 配置坏掉（模型下线、密钥过期）时
   * 每一轮都会失败，而失败又会让目标重新排队 —— 没有这个封顶，自动化会稳定地
   * 每小时对同一批文件发起一次注定失败的对话，直到有人发现为止。
   * 到顶之后状态仍留在 failed（不伪装成已巡查），只是不再自动重排，转由人处理。
   */
  exhausted: boolean;
  /** 点名理由：哪几维同时处于高位（带该维度名次），直接发给 Agent */
  note: string;
  /** 人可读状态说明，直接显示在面板上 */
  detail: string;
}

/** 本轮实际点名的目标 */
export interface FocusPatrolPick {
  filePath: string;
  resonance: number;
  note: string;
  state: FocusPatrolState;
  /**
   * 派单时该文件的证据现状指纹，随派单一起落库。
   * 下一轮据此判断「这次证据变化是否已经派过复核单」——复核档收敛的唯一依据。
   */
  evidenceDigest: string;
  /**
   * 派单时该文件这次劣化的指纹，随派单一起落库。
   * 下一轮据此判断「这次劣化是否已经派过追责单」——回归档收敛的唯一依据。
   */
  regressionDigest: string;
}

export interface FocusPatrolPlan {
  /** 全量台账（含已巡查的），给人看 */
  rows: FocusPatrolRow[];
  /** 本轮点名清单（队列前 limit 个），给单条规则用 */
  picks: FocusPatrolPick[];
  /**
   * 待巡查队列全序（never 在前、stale-data 在后，不截断）。
   *
   * 一轮编排里可能有多条规则同时触发。给每条规则都塞同一批 picks 是错的：
   * 同一个文件会被连点两次（派单次数虚增、token 白烧），而队列后面那些
   * 同样从未巡查过的目标却一个都没轮到——本该一轮覆盖 6 个，实际只覆盖 3 个。
   * 所以队列要完整给出，由 {@link createFocusDispatcher} 在规则之间**顺序消费**。
   */
  queue: FocusPatrolPick[];
  /**
   * 存在「从未派单」的高共振目标。
   *
   * 与轮转的 hasUncovered 同构，是压过指纹去重的理由：同一份数据上换一个**对象**去看，
   * 结论必然是新的。注意 stale-data 不算——数据变了指纹自然就变了，
   * 正常闸门本来就会放行，不需要例外。
   */
  hasUnpatrolled: boolean;
  /**
   * 队列里还有欠着复核的文件。
   *
   * 与 hasUnpatrolled 分开是必要的：两者都能压过指纹去重，但语义不同——
   * 一个是「还有没看过的对象」，一个是「已看过的结论可能已经不作数了」。
   * 分开记，编排审计里才说得清这一轮 token 到底花在补空白还是在还旧账。
   */
  hasPendingRecheck: boolean;
  /**
   * 队列里还有本轮变坏、却尚未追责的文件。
   *
   * 三个「压过指纹去重」的理由里，只有这一个带**时效**：数据再变一次，
   * 这次劣化就滚进基线，此后任何视图都看不见它。所以它在编排里排得比
   * 补文件/补复核更靠前——不是因为更重要，而是因为漏了就补不回来。
   */
  hasRegressed: boolean;
}

export interface FocusPatrolOptions {
  /** 当前上下文指纹；缺省则无法判定 stale-data，派过单一律算已巡查 */
  currentDigest?: string;
  /**
   * 洞察回流信号。不传（或 available=false）时整条复核链路静默关闭，
   * 判定结果与本特性上线前**逐字节一致**——观测手段的缺失不该改变既有行为。
   */
  feedback?: InsightFeedback;
  /**
   * 回归观测信号。不传（或 available=false）时整条追责链路静默关闭，
   * 判定结果与本特性上线前**逐字节一致**——同 feedback 的取向。
   */
  regression?: RegressionFeedback;
  /** 一轮最多点名几个。点一串等于没点：Agent 的注意力会被摊薄成走过场 */
  limit?: number;
  /** 参与巡查的最低共振维度数 */
  minResonance?: number;
  /** 同一目标因对话失败自动重派的上限；超过则留给人处理 */
  failedRetryLimit?: number;
  nowSec?: number;
}

/** 一轮点名上限。3 个是「够 Agent 认真看完」与「别把一轮分析摊薄」的折中 */
export const DEFAULT_PATROL_LIMIT = 3;
/** 共振门槛：多维同时报警才值得动用「点名」这个稀缺手段 */
export const DEFAULT_MIN_RESONANCE = 2;
/**
 * 因对话失败自动重派的次数上限。
 *
 * 3 次的含义：偶发的网络抖动、模型限流都能自愈；而配置性故障（模型下线、密钥过期）
 * 三轮之内必然暴露，此时继续自动重试只是稳定地烧钱，应当交给人。
 */
export const DEFAULT_FAILED_RETRY_LIMIT = 3;

const STATE_PRIORITY: Record<FocusPatrolState, number> = {
  // 失败重派排在最前：这个目标本来就该被看，只是上一轮没跑成，
  // 而且它已经占用过一次点名名额，再漏掉一次代价最大。
  failed: 0,
  // 复核排在「从未巡查」之前，理由是投入产出比而不是重要性：
  // 复核是「已知问题 + 已知变化」，Agent 不必重新理解文件就能给出确定的增量结论；
  // 而 never 是完全未知，同样一轮 token 换回来的可能只是「看起来还好」。
  // 另外复核有时效压力 —— 拖着不复核，那条过期结论会持续污染面板和后续每一轮上下文。
  recheck: 1,
  // 回归排在「从未巡查」之前：那些空白不会跑掉，这次劣化会。再扫一次，
  // 它就滚进基线成为「一直如此」，从此没有任何视图看得见——补都补不回来。
  // 排在 recheck 之后则是因为后者还多一层时效之外的代价：一条过期结论不仅是漏看，
  // 它还在持续污染面板和后续每一轮上下文，同时误导人和模型。
  regressed: 2,
  never: 3,
  "stale-data": 4,
  patrolled: 5,
};

function fmtAge(nowSec: number, thenSec: number): string {
  const s = Math.max(0, nowSec - thenSec);
  if (s < 3600) return L(`${Math.max(1, Math.round(s / 60))} 分钟前`, `${Math.max(1, Math.round(s / 60))} min ago`);
  if (s < 86400) return L(`${Math.round(s / 3600)} 小时前`, `${Math.round(s / 3600)} h ago`);
  return L(`${Math.round(s / 86400)} 天前`, `${Math.round(s / 86400)} d ago`);
}

/** 拼接点名理由的两半（静态可疑点 + 已知结论），任一为空时不留下孤零零的分隔符 */
function joinNote(...parts: (string | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join("；");
}

/**
 * 点名理由：哪几维同时处于高位，各自第几名。
 *
 * 必须带**名次**而不只是维度名：名次大于 Top-N 截断线的维度，意味着这个文件
 * 在对应分节的明细表里根本不出现。把名次写给 Agent，它才明白
 * 「为什么我在别处没见过这个文件，却要我优先看它」——否则点名像是无来由的指派，
 * 模型很容易顺手把它降级成次要目标。
 *
 * label 取自 dims（协议要求模块侧填好）：本文件没有、也不该有维度字典。
 */
export function describePatrolReason(target: AiFocusTarget): string {
  const keys = target.resonantKeys?.length
    ? target.resonantKeys
    : Object.keys(target.dims ?? {});
  const parts = keys
    .map((k) => {
      const hit = target.dims?.[k];
      if (!hit) return "";
      return L(`${hit.label}第 ${hit.rank} 名`, `${hit.label} rank ${hit.rank}`);
    })
    .filter(Boolean);
  return parts.join(" · ");
}

/**
 * 规划一轮巡查：焦点目标 × 派单台账 → 台账全景 + 本轮点名。
 *
 * 纯函数：不碰 store、不碰 DB、不看时钟。这套判定是「会不会重复烧 token」的
 * 唯一把关处，必须能被回归测试钉死。
 */
export function planFocusPatrol(
  targets: readonly AiFocusTarget[],
  assignments: readonly AiFocusAssignmentDto[],
  options: FocusPatrolOptions = {},
): FocusPatrolPlan {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const limit = Math.max(1, options.limit ?? DEFAULT_PATROL_LIMIT);
  const minResonance = options.minResonance ?? DEFAULT_MIN_RESONANCE;
  const currentDigest = options.currentDigest ?? "";
  const retryLimit = Math.max(1, options.failedRetryLimit ?? DEFAULT_FAILED_RETRY_LIMIT);

  const byPath = new Map(assignments.map((a) => [a.filePath, a]));
  const feedback = options.feedback ?? emptyInsightFeedback(false);
  const regressionFeed = options.regression ?? emptyRegressionFeedback(false);

  const buildRow = (t: AiFocusTarget): FocusPatrolRow => {
    const insight = feedback.available ? feedback.byFile.get(t.filePath) : undefined;
    const regression = regressionFeed.available
      ? regressionFeed.byFile.get(t.filePath)
      : undefined;
    const baseNote = describePatrolReason(t);
    // 点名理由要把三件事都说清楚：静态为什么可疑、已知结论是什么、这一轮变坏了什么。
    // 少了第一件，Agent 会把复核当成一次陌生文件的通读，白白丢掉已有结论这个最便宜的起点；
    // 少了最后一件，它只会泛泛评价「这个文件很复杂」，而不是去查这次劣化是哪个改动引入的。
    //
    // 回归说明**不论该文件最终判在哪一档都要带上**：一个既欠复核又刚变坏的文件按
    // recheck 派出去时，如果不说「而且它这一轮还变坏了」，Agent 会以为只需要核对旧结论。
    const note = joinNote(
      baseNote,
      insight?.signal === "recheck" ? insight.note : undefined,
      regression?.note,
    );
    const prev = byPath.get(t.filePath);
    const evidenceDigest = insight?.evidenceDigest ?? "";
    const regressionDigest = regression?.digest ?? "";
    const base = {
      filePath: t.filePath,
      resonance: t.resonance,
      score: t.score,
      insight,
      regression,
      evidenceDigest,
      regressionDigest,
      note,
    };

    // 复核档必须判在 !prev 之前：一个文件可以同时「从未派过单」且「已有结论待复核」
    // （结论来自另一条规则的自由发挥，而非点名），此时按 never 处理会丢掉
    // 「已知问题是什么」这条最值钱的线索，Agent 只能从零重读。
    // 但要排在 failed 之后 —— 那一档带着重试封顶，是 Agent 配置坏掉时唯一的刹车。
    const failedBefore = !!prev && (prev.outcome === "error" || prev.outcome === "interrupted");
    if (!failedBefore && needsRecheck(insight, prev?.evidenceDigest)) {
      return {
        ...base,
        state: "recheck" as const,
        lastAssignedAt: prev?.assignedAt ?? null,
        assignCount: prev?.assignCount ?? 0,
        exhausted: false,
        detail: prev
          ? L(`${fmtAge(nowSec, prev.assignedAt || 0)}巡查过，之后这些结论依据的代码又改了（${insight?.staleCount ?? 0} 条待复核）`, `Patrolled ${fmtAge(nowSec, prev.assignedAt || 0)}; the code these conclusions rely on changed since (${insight?.staleCount ?? 0} to re-check)`)
          : L(`已有 ${insight?.openCount ?? 0} 条结论，其依据的代码已改动，需复核`, `${insight?.openCount ?? 0} conclusion(s) exist whose evidence code changed; re-review needed`),
      };
    }

    // 回归档同样必须判在 !prev 之前，理由与复核一致：一个文件可以既「从未派过单」
    // 又「这一轮刚变坏」，按 never 处理会把「哪一维、从多少到多少」这条最精确的线索丢掉，
    // Agent 只能对着一个陌生文件泛泛而谈。
    // 也必须判在 failed 之后 —— 那一档带着重试封顶，是 Agent 配置坏掉时唯一的刹车。
    if (!failedBefore && needsRegressionPatrol(regression, prev?.regressionDigest)) {
      return {
        ...base,
        state: "regressed" as const,
        lastAssignedAt: prev?.assignedAt ?? null,
        assignCount: prev?.assignCount ?? 0,
        exhausted: false,
        detail: prev
          ? L(`${fmtAge(nowSec, prev.assignedAt || 0)}巡查过，之后这个文件明显变坏了（${regression?.driverLabel ?? "多维"}劣化）`, `Patrolled ${fmtAge(nowSec, prev.assignedAt || 0)}; this file clearly worsened since (${regression?.driverLabel ?? "multi-dim"} regression)`)
          : L(`本轮相对上一次扫描明显变坏（${regression?.driverLabel ?? "多维"}劣化），尚未追责`, `Clearly worsened vs. previous scan (${regression?.driverLabel ?? "multi-dim"} regression) and not yet attributed`),
      };
    }

    if (!prev) {
      return {
        ...base,
        state: "never" as const,
        lastAssignedAt: null,
        assignCount: 0,
        exhausted: false,
        detail: L("从未安排 AI 巡查过这个目标", "This target was never assigned an AI patrol"),
      };
    }
    const age = fmtAge(nowSec, prev.assignedAt || 0);
    const times = prev.assignCount > 1 ? L(`，累计 ${prev.assignCount} 次`, `, ${prev.assignCount} times total`) : "";
    // 派单发出去了，但那一轮没跑成——账销了、事没办。
    // 这一档必须排在指纹判定**之前**：无论数据变没变，这个文件都还欠着一次巡查，
    // 而 stale-data 的语义是「上次看过、之后数据变了」，用在这里会掩盖没跑成的事实。
    if (failedBefore) {
      const exhausted = prev.assignCount >= retryLimit;
      // 死法不同，给人的下一步动作也不同：对话失败要去查模型和密钥，
      // 而中断多半只是「关了窗口」，说成失败会让用户白排查一遍配置。
      const how = prev.outcome === "interrupted" ? L("分析中断", "interrupted") : L("对话失败", "conversation failed");
      return {
        ...base,
        state: "failed" as const,
        lastAssignedAt: prev.assignedAt,
        assignCount: prev.assignCount,
        exhausted,
        detail: exhausted
          ? L(`${age}点名过${times}，但每一轮都没跑成（最近一次${how}）。已达自动重试上限，请检查该 Agent 的模型与密钥配置`, `${age}named it${times}, but every round failed (last: ${how}). Auto-retry limit reached; check the Agent's model and API key config`)
          : L(`${age}点名过${times}，但那一轮${how}，实际未被巡查，将重新排队`, `${age}named it${times}, but that round ${how} and it was not actually patrolled; it will be re-queued`),
      };
    }
    // 指纹是硬判据。历史记录没有指纹（空串）时不能当作「变了」，
    // 否则台账一上线就全部标红，用户直接把它当摆设——与覆盖台账同一条教训。
    if (currentDigest && prev.contextDigest && prev.contextDigest !== currentDigest) {
      return {
        ...base,
        state: "stale-data" as const,
        lastAssignedAt: prev.assignedAt,
        assignCount: prev.assignCount,
        exhausted: false,
        detail: L(`${age}巡查过${times}，之后数据已更新，值得复巡`, `${age}patrolled${times}; data updated since, worth re-patrolling`),
      };
    }
    return {
      ...base,
      state: "patrolled" as const,
      lastAssignedAt: prev.assignedAt,
      assignCount: prev.assignCount,
      exhausted: false,
      detail: insight
        ? L(`${age}巡查过${times}，依据的数据与当前一致（${insight.note}）`, `${age}patrolled${times}; evidence matches current data (${insight.note})`)
        : L(`${age}巡查过${times}，依据的数据与当前一致`, `${age}patrolled${times}; evidence matches current data`),
    };
  };

  // 共振门槛对「欠复核」的目标网开一面。
  //
  // 门槛存在的理由是「单维极端值在对应分节的 Top-N 明细里本来就看得见，不必浪费点名名额」。
  // 但这条理由对复核档不成立：明细表按静态指标排序，它既不知道这个文件有没有结论，
  // 更不知道那条结论已经因为代码改动而作废了。一个共振只有 1 维、却挂着一条
  // critical 且已过期的结论的文件，在任何视图里都看不出「它现在需要被重新确认」。
  //
  // 同样对「本轮刚变坏」的目标网开一面，而且理由更强：明细表按**当前取值**排序，
  // 它根本不含变化这一维信息。一个共振只有 1 维、这一轮却劣化了 60% 的文件，
  // 在除回归分节之外的任何视图里都看不出「它刚出事」。
  const isExempt = (filePath: string): boolean =>
    (feedback.available && feedback.byFile.get(filePath)?.signal === "recheck") ||
    (regressionFeed.available && regressionFeed.byFile.has(filePath));

  const onBoard = new Set(targets.map((t) => t.filePath));
  // 榜外劣化文件的注入：焦点目标集是共振榜 Top-15，实体榜单收 Top-25，
  // 中间这一段恰恰最需要回归视角——排第 20 名的文件突然劣化 60%，
  // 在任何静态明细里都不显眼，只有对比才看得见。
  //
  // 注入有封顶（REGRESSION_INJECT_LIMIT）：一次大重构可能让十几个文件同时变坏，
  // 全部注入会把 never 档挤到几轮之后。回归优先是对的（它会过期，never 不会），
  // 无限优先不是。按劣化幅度取前几名，其余留给下一轮——若它们还在恶化，自然还会排队。
  const injected: AiFocusTarget[] = regressionFeed.available
    ? [...regressionFeed.byFile.values()]
        .filter((s) => !onBoard.has(s.filePath))
        .sort((a, b) => b.weight - a.weight || a.filePath.localeCompare(b.filePath))
        .slice(0, REGRESSION_INJECT_LIMIT)
        .map((s) => ({
          filePath: s.filePath,
          codeLines: 0,
          resonance: s.resonance,
          score: s.score,
          // 榜外目标没有维度名次可报（它不在 describeFocus 的输出里），
          // 留空即可——note 会由回归说明独立撑起来，绝不编造一个假名次。
          dims: {},
          resonantKeys: [],
        }))
    : [];

  // 放行范围：describeFocus 给出的目标集（共振榜 Top-N）+ 少量榜外劣化文件。
  const rows: FocusPatrolRow[] = [...targets, ...injected]
    .filter((t) => (t.resonance ?? 0) >= minResonance || isExempt(t.filePath))
    .map(buildRow);

  const queue: FocusPatrolPick[] = rows
    // 重试到顶的失败目标不再自动排队：Agent 配置坏掉时，重排只会让自动化
    // 每小时稳定地发起一批注定失败的对话。它仍留在台账上标红，等人来处理。
    .filter((r) => r.state !== "patrolled" && !r.exhausted)
    .sort((a, b) => {
      const byState = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
      if (byState !== 0) return byState;
      // 复巡队列（stale-data）按「最久没被巡查过」排，**不**按共振分排。
      //
      // 这不是审美问题，是这个特性会不会自我作废的问题：活跃开发期每次扫描都让指纹
      // 变化，于是整张共振榜会同时翻成 stale-data。若此时仍按共振分排序，每一轮领走的
      // 永远是同样那 3 个分数最高的文件——它们巡查完又立刻被下一次扫描重新标脏，
      // 第 4 名往后一次都轮不到。那正是本特性要消灭的「每轮都在同一批文件上打转」，
      // 只不过换了个地方复发，而且因为账面上「派单一直在动」，几乎不可能被发现。
      //
      // never 档不适用这条：它们从没被派过单，谁都「一样久」，此时共振分才是对的优先级。
      if (a.state === "stale-data") {
        const at = a.lastAssignedAt ?? 0;
        const bt = b.lastAssignedAt ?? 0;
        if (at !== bt) return at - bt;
      }
      // 复核队列内部按**已知严重度**排，不按共振分排：这一档的价值来自「已知问题」，
      // 而不是「静态上有多可疑」。一条 critical 结论所在的文件被改动了，
      // 无论它静态分排第几，都比一个 low 结论的文件更该先看。
      // 严重度只在这里（同为 recheck 时的内部次序）出现，绝不外溢到 resonance/score，
      // 否则共振榜就会变成「哪个文件被 AI 说得最严重」——见 insightFeedback 铁律①。
      if (a.state === "recheck") {
        const sev = severityRank(b.insight?.maxSeverity) - severityRank(a.insight?.maxSeverity);
        if (sev !== 0) return sev;
        const stale = (b.insight?.staleCount ?? 0) - (a.insight?.staleCount ?? 0);
        if (stale !== 0) return stale;
      }
      // 回归队列内部按**劣化幅度**排，不按共振分排：这一档的价值来自「刚刚发生了什么」。
      // 一个从 20 涨到 38 的文件（+90%）比一个从 88 涨到 92 的文件（+5%）更该先看，
      // 尽管后者的绝对值和共振分都高得多——那份糟糕是历史遗留，前者是这次改动造成的，
      // 现在回滚或拆分的成本最低。幅度同样封闭在本档内部，绝不外溢到 resonance/score。
      if (a.state === "regressed") {
        const w = (b.regression?.weight ?? 0) - (a.regression?.weight ?? 0);
        if (w !== 0) return w;
      }
      // 共振维度数优先于综合分：权重可争议，「N 维同时报警」几乎不依赖权重。
      // 与 riskMatrix 的排序口径保持一致，人和 AI 才不会看到两份不同的优先级。
      if (b.resonance !== a.resonance) return b.resonance - a.resonance;
      if (b.score !== a.score) return b.score - a.score;
      return a.filePath.localeCompare(b.filePath);
    })
    .map((r) => ({
      filePath: r.filePath,
      resonance: r.resonance,
      note: r.note,
      state: r.state,
      // 两本账都随派单一起记，**与本行最终判在哪一档无关**。
      // 一个因欠复核而被点名的文件，这一轮同样被 Agent 看过了，它的回归账当然也该销；
      // 只记「当前档位对应的那一本」，另一本会永远挂着，下一轮把同一个文件再点一次名。
      evidenceDigest: r.evidenceDigest,
      regressionDigest: r.regressionDigest,
    }));

  return {
    rows,
    picks: queue.slice(0, limit),
    queue,
    // 口径取自**队列**而非 rows：重试到顶的失败目标已被挡在队列外，
    // 若仍按 rows 判定，编排每轮都会被 focus-gap 唤醒却拿到空清单——
    // 一个「数据没变还照跑不误」的空转，正是指纹去重当初要拦住的事。
    hasUnpatrolled: queue.some((q) => q.state === "never" || q.state === "failed"),
    hasPendingRecheck: queue.some((q) => q.state === "recheck"),
    hasRegressed: queue.some((q) => q.state === "regressed"),
  };
}

/**
 * 把待巡查队列在**同一轮编排的多条规则之间**顺序分发。
 *
 * 为什么需要它
 * ------------
 * 焦点计划整轮只算一次（省掉重复的重打分与查库），但触发的规则可能有好几条。
 * 若每条规则都拿 `plan.picks`，就会出现：
 *   · 同一个文件在同一轮里被点名 N 次 —— 派单次数虚增，N 份 token 得到同一个结论；
 *   · 队列后面同样「从未巡查」的目标一个都轮不到 —— 覆盖速度凭空慢了 N 倍。
 *
 * 更要紧的是 `hasUnpatrolled` 必须跟着**剩余队列**走：第一条规则把 never 目标
 * 全领走之后，第二条规则若还看到 `hasUnpatrolledFocus=true`，就会以 focus-gap
 * 为由在「数据没变」的情况下被唤醒，却拿到一个空点名清单 —— 白跑一轮，
 * 而这正是指纹去重当初要拦住的事。
 *
 * 有状态但不共享：每轮编排现造一个，随本轮结束一起丢弃。
 */
export function createFocusDispatcher(plan: FocusPatrolPlan, limit: number = DEFAULT_PATROL_LIMIT) {
  const size = Math.max(1, limit);
  let cursor = 0;
  return {
    /** 剩余队列里还有「实际未被巡查过」的目标吗——压过指纹去重的唯一理由 */
    hasUnpatrolled(): boolean {
      for (let i = cursor; i < plan.queue.length; i += 1) {
        const s = plan.queue[i].state;
        // failed 与 never 同权：一个从没派过单，一个派了单但那轮没跑成，
        // 两者都还欠着一次真正的巡查。
        if (s === "never" || s === "failed") return true;
      }
      return false;
    },
    /**
     * 剩余队列里还有欠着复核的目标吗——压过指纹去重的另一个理由。
     *
     * 与 hasUnpatrolled 同样必须跟着**剩余**队列走：第一条规则领走全部复核目标之后，
     * 第二条规则若还看到 true，就会在「数据没变」的情况下被唤醒却拿到空清单。
     */
    hasPendingRecheck(): boolean {
      for (let i = cursor; i < plan.queue.length; i += 1) {
        if (plan.queue[i].state === "recheck") return true;
      }
      return false;
    },
    /**
     * 剩余队列里还有本轮变坏、尚未追责的目标吗——压过指纹去重的第三个理由，
     * 也是三个里唯一带时效的那个。同样必须跟着**剩余**队列走。
     */
    hasRegressed(): boolean {
      for (let i = cursor; i < plan.queue.length; i += 1) {
        if (plan.queue[i].state === "regressed") return true;
      }
      return false;
    },
    /** 领走下一批点名目标（队列耗尽时返回空数组，调用方据此不再点名） */
    take(): FocusPatrolPick[] {
      const slice = plan.queue.slice(cursor, cursor + size);
      cursor += slice.length;
      return slice;
    },
    /** 本轮已分发出去的目标数（写编排日志用） */
    dispatched(): number {
      return cursor;
    },
  };
}

export interface FocusPatrolSummary {
  total: number;
  never: number;
  stale: number;
  /** 已有结论、但结论依据的代码之后又改了，欠一次复核 */
  recheck: number;
  /** 本轮相对上一次扫描明显变坏，欠一次追责 */
  regressed: number;
  patrolled: number;
  /** 派单发出去但那一轮对话失败、实际没被看过的目标数 */
  failed: number;
  /** 其中已达自动重试上限、需要人工介入的目标数 */
  exhausted: number;
  /** 已巡查且数据未变的比例（0-100，一位小数） */
  patrolledRatio: number;
}

/** 汇总一行给面板标题栏：一眼看出「共振榜到底被照顾到了多少」 */
export function summarizeFocusPatrol(rows: readonly FocusPatrolRow[]): FocusPatrolSummary {
  const total = rows.length;
  const never = rows.filter((r) => r.state === "never").length;
  const patrolled = rows.filter((r) => r.state === "patrolled").length;
  const failed = rows.filter((r) => r.state === "failed").length;
  const recheck = rows.filter((r) => r.state === "recheck").length;
  const regressed = rows.filter((r) => r.state === "regressed").length;
  return {
    total,
    never,
    // stale 仍由减法得出，但新增状态时**必须记得从这里扣掉**：
    // 早先的注释说「新增状态时不必再改」是错的——recheck 上线时若不扣，
    // 待复核的文件会被静默计进「数据已变」，面板上两个数字对不上账。
    // regressed 上线时同理，这已经是同一个坑的第二次。
    stale: total - never - patrolled - failed - recheck - regressed,
    recheck,
    regressed,
    patrolled,
    failed,
    exhausted: rows.filter((r) => r.exhausted).length,
    patrolledRatio: total === 0 ? 0 : Math.round((patrolled / total) * 1000) / 10,
  };
}
