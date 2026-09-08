/**
 * analysisCoverage —— 「分析维度覆盖台账」。
 *
 * 解决的问题
 * ----------
 * 到上一轮为止，整条链路能保证的是「**数据**是完整的」：14 阶段扫了什么、哪些维度是盲区，
 * 都写在 dataQuality 里。但还有一层完整性一直是空白：**分析本身覆盖了哪些方面**。
 *
 * 现实里它长这样：用户建了一条自动规则，预设写死「全面优化诊断」，于是每次扫描完
 * 都在重复同一个视角；架构健康度、技术债清偿、热点攻坚从来没人跑过。数据再全，
 * 也只有一个切面被解读过——而「项目在各个方面如何优化」恰恰要求各个方面都被看过一遍。
 *
 * 本文件把这件事变成可度量的台账：每个分析维度（preset）当前处于
 * 「从未分析 / 结论仍对得上当前数据 / 数据已变结论过期 / 太久没跑」四态之一。
 * 有了它，UI 能显示覆盖矩阵，编排器能自动挑「最该补的那个维度」去跑。
 *
 * 判定为什么以指纹为主、时间为辅
 * ------------------------------
 * 「上次分析在 3 天前」说明不了任何事——如果这 3 天代码没动，结论依然成立，重跑纯属烧钱。
 * 真正的过期信号是**上下文内容指纹变了**：数据都换了，基于旧数据的结论自然不再可信。
 * 时间只作为兜底：指纹一直没变但过了很久，也值得用当前更强的模型重看一眼（可关闭）。
 *
 * 模块无关：本文件不含任何扫描知识，只认 preset 列表与运行轨迹。
 * 未来任意实现了 AiContextProvider 的模块都能直接复用整张台账。
 */
import type { AiAnalysisPreset } from "./contextTypes";
import type { AiAutoAnalysisRun } from "../services/tauri";
import { pickLang, t } from "../i18n";

/** 一个分析维度的覆盖状态 */
export type AnalysisCoverageState =
  /** 从未分析过——台账上最该优先补的格子 */
  | "never"
  /** 分析过，且所依据的上下文与当前一致：结论仍然可用，不必重跑 */
  | "fresh"
  /** 分析过，但上下文内容已经变了：结论可能已经对不上代码 */
  | "stale-data"
  /** 上下文没变，只是距上次分析太久（兜底信号，强度低于 stale-data） */
  | "stale-time";

export interface AnalysisCoverageRow {
  presetKey: string;
  title: string;
  description?: string;
  state: AnalysisCoverageState;
  /** 上次分析时间（秒级时间戳）；从未分析为 null */
  lastRunAt: number | null;
  /** 上次分析所基于的上下文指纹；历史数据可能为空串 */
  lastDigest: string;
  /** 上次由哪个 Agent 跑的（展示用，绝不用于「下次也用它」的推断） */
  lastAgentId: string | null;
  /** 上次分析产生的会话，便于用户点回去看原文 */
  lastConversationId: string | null;
  /** 人可读的状态说明，直接显示在 UI 与审计里 */
  detail: string;
}

export interface CoverageOptions {
  /** 当前上下文包指纹；缺省则无法做 stale-data 判定，只按时间兜底 */
  currentDigest?: string;
  /** 当前时间（秒），显式传入便于测试 */
  nowSec?: number;
  /** 超过这么多小时未分析就标 stale-time；<=0 关闭时间兜底 */
  staleAfterHours?: number;
}

/** 默认时间兜底阈值：一天。比这更短会让「今天已经跑过」被反复重跑。 */
export const DEFAULT_STALE_AFTER_HOURS = 24;

function fmtAge(nowSec: number, thenSec: number): string {
  const s = Math.max(0, nowSec - thenSec);
  if (s < 3600) return t("aiPanel.time.agoMinutes", { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86400) return t("aiPanel.time.agoHours", { n: Math.round(s / 3600) });
  return t("aiPanel.time.agoDays", { n: Math.round(s / 86400) });
}

/**
 * 构建覆盖台账：预设清单 × 运行轨迹 → 每个维度一行。
 *
 * runs 只应包含「真正发起过」的记录（后端已按 status='triggered' 过滤）。
 * 这里再做一次防御性过滤：一旦有人把 skipped 也传进来，绿灯就会说谎，
 * 而说谎的绿灯比没有台账更危险——用户会以为这个维度已经看过了。
 */
export function buildAnalysisCoverage(
  presets: AiAnalysisPreset[],
  runs: AiAutoAnalysisRun[],
  options: CoverageOptions = {},
): AnalysisCoverageRow[] {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const staleAfterHours = options.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS;
  const currentDigest = options.currentDigest ?? "";

  // 同一 preset 可能有多条（后端已分组，但手动与自动混流时仍要防御）：取最近的一条
  const latest = new Map<string, AiAutoAnalysisRun>();
  for (const r of runs) {
    if (r.status !== "triggered") continue;
    const prev = latest.get(r.presetKey);
    if (!prev || r.createdAt > prev.createdAt) latest.set(r.presetKey, r);
  }

  return presets.map((p) => {
    const run = latest.get(p.key);
    if (!run) {
      return {
        presetKey: p.key,
        title: pickLang(p.title),
        description: pickLang(p.description),
        state: "never" as const,
        lastRunAt: null,
        lastDigest: "",
        lastAgentId: null,
        lastConversationId: null,
        detail: t("aiPanel.coverageDetail.never"),
      };
    }

    const lastDigest = run.contextDigest ?? "";
    const age = fmtAge(nowSec, run.createdAt);
    let state: AnalysisCoverageState = "fresh";
    let detail = t("aiPanel.coverageDetail.fresh", { age });

    // 指纹判定优先：有指纹可比时它是硬证据。
    // 历史记录没有指纹（空串）时不能当作「变了」——那会让所有旧记录集体标红，
    // 台账第一次上线就全是噪音，用户直接把它当摆设。
    if (currentDigest && lastDigest && lastDigest !== currentDigest) {
      state = "stale-data";
      detail = t("aiPanel.coverageDetail.staleData", { age });
    } else if (staleAfterHours > 0 && nowSec - run.createdAt > staleAfterHours * 3600) {
      state = "stale-time";
      detail = t("aiPanel.coverageDetail.staleTime", { age, hours: staleAfterHours });
    } else if (!lastDigest) {
      detail = t("aiPanel.coverageDetail.noDigest", { age });
    }

    return {
      presetKey: p.key,
      title: pickLang(p.title),
      description: pickLang(p.description),
      state,
      lastRunAt: run.createdAt,
      lastDigest,
      lastAgentId: run.agentId || null,
      lastConversationId: run.conversationId,
      detail,
    };
  });
}

/** 状态优先级：数字越小越该先补 */
const STATE_PRIORITY: Record<AnalysisCoverageState, number> = {
  never: 0,
  "stale-data": 1,
  "stale-time": 2,
  fresh: 3,
};

/**
 * 挑「下一个最该分析的维度」。
 *
 * 这是自动编排从「反复重跑同一个预设」升级为「轮转补齐各个方面」的关键：
 * 规则不指定预设时，每次触发都由这里挑一个最缺的维度，跑上几轮之后
 * 全部方面自然都被覆盖过一遍，用户不必手工建 N 条规则。
 *
 * 排序：从未分析 > 数据已变 > 太久没跑 > 仍新鲜；同档内取上次分析时间最早的
 * （从未分析视为无穷早），保证轮转而不是卡在同一个维度上。
 *
 * 全部 fresh 时返回 undefined —— 让调用方明确决定「这轮不跑」，
 * 而不是随便挑一个已经新鲜的维度重烧一遍 token。
 */
export function pickNextPreset(
  coverage: AnalysisCoverageRow[],
  options: { includeFresh?: boolean } = {},
): AnalysisCoverageRow | undefined {
  const pool = options.includeFresh
    ? coverage
    : coverage.filter((r) => r.state !== "fresh");
  if (pool.length === 0) return undefined;

  return [...pool].sort((a, b) => {
    const byState = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
    if (byState !== 0) return byState;
    // null（从未分析）排最前
    const at = a.lastRunAt ?? -1;
    const bt = b.lastRunAt ?? -1;
    if (at !== bt) return at - bt;
    // 时间也相同（同一秒内批量补齐）时按 key 稳定排序，避免每次渲染顺序抖动
    return a.presetKey.localeCompare(b.presetKey);
  })[0];
}

export interface CoverageSummary {
  total: number;
  never: number;
  stale: number;
  fresh: number;
  /** 已覆盖且仍新鲜的比例（0-100，一位小数） */
  freshRatio: number;
}

/** 汇总一行给 UI 标题栏用：一眼看出「各个方面」到底覆盖了多少 */
export function summarizeCoverage(coverage: AnalysisCoverageRow[]): CoverageSummary {
  const total = coverage.length;
  const never = coverage.filter((r) => r.state === "never").length;
  const fresh = coverage.filter((r) => r.state === "fresh").length;
  const stale = total - never - fresh;
  return {
    total,
    never,
    stale,
    fresh,
    freshRatio: total === 0 ? 0 : Math.round((fresh / total) * 1000) / 10,
  };
}
