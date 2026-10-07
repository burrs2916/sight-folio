import type {
  AiContextSection,
  AiDataQualityStatus,
  AiSectionDataQuality,
  AiSectionDrilldown} from "./contextTypes";
import { estimateTokens } from "./tokenBudget";
import { L } from "./aiLang";

/**
 * 数据可信度工具 —— 模块无关。
 *
 * 这里只做三件事：判定、聚合、渲染成一行给 Agent 看的文字。
 * 不认识扫描 / 画布 / 报告任何具体模块，任何实现 AiContextProvider 的模块都能直接复用。
 *
 * 判定的核心是一个常被忽略的区分：**「统计出 0 条」和「根本没统计」不是一回事**。
 *   - 重复代码检测跑完了、结果 0 条  → status=ok，observed=0，Agent 可以放心说「没有重复」；
 *   - 数据流分析不支持这门语言、结果 0 条 → status=unavailable，Agent 必须说「这一维度是盲区」。
 * 调用方通过 `zeroMeans` 显式声明本维度「0」的语义，避免把盲区说成健康。
 */

/** 严重程度排序：越大越不可信，用于聚合取最差 */
const STATUS_RANK: Record<AiDataQualityStatus, number> = {
  ok: 0,
  partial: 1,
  empty: 2,
  unavailable: 3,
};

/** 状态标签语言包键（ai.dq.<status>），消费点 t() 取当前语言 */
export const DATA_QUALITY_LABEL_KEY: Record<AiDataQualityStatus, string> = {
  ok: "ai.dq.ok",
  partial: "ai.dq.partial",
  empty: "ai.dq.empty",
  unavailable: "ai.dq.unavailable",
};

/** 未声明可信度的分节按「可信」处理：兼容历史数据与尚未接入的模块 */
export const DEFAULT_QUALITY: AiSectionDataQuality = { status: "ok" };

export function qualityOf(section: Pick<AiContextSection, "dataQuality">): AiSectionDataQuality {
  return section.dataQuality ?? DEFAULT_QUALITY;
}

/** 该分节的结论能否直接采信（partial 也算能用，但结论只在覆盖范围内成立） */
export function isConclusive(q: AiSectionDataQuality | undefined): boolean {
  const status = q?.status ?? "ok";
  return status === "ok" || status === "partial";
}

/** 一组可信度取最差的那个：用于给整包一个总体判断 */
export function worstStatus(list: Array<AiSectionDataQuality | undefined>): AiDataQualityStatus {
  let worst: AiDataQualityStatus = "ok";
  for (const q of list) {
    const s = q?.status ?? "ok";
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  }
  return worst;
}

export interface QualityInput {
  /** 观测到的记录数 */
  observed: number;
  /**
   * 「0 条」到底意味着什么：
   *   - "finding"（默认）：分析跑过了，0 条就是「确实没有」，可下结论 → status=ok
   *   - "empty"：分析可用但项目里没有可分析对象 → status=empty
   *   - "unavailable"：这维度在本项目上根本没跑成 → status=unavailable，禁止下结论
   */
  zeroMeans?: "finding" | "empty" | "unavailable";
  /** 覆盖面（如数据流只覆盖了部分语言的文件）；covered < expected 时降级为 partial */
  covered?: number;
  expected?: number;
  /** 状态说明（unavailable / empty / partial 时强烈建议给出，Agent 会直接引用） */
  reason?: string;
  /** 正文只列了 Top-N */
  truncated?: boolean;
  /** 明确禁止下的结论 */
  caveat?: string;
  /**
   * 截断时的补救路径：这一维度的全量原始记录在哪个工具的哪个数据集里。
   * 由模块声明，本工具只负责透传与渲染（AI 层不认识任何具体模块）。
   */
  drilldown?: AiSectionDrilldown;
}

/**
 * 统一判定入口。
 *
 * 判定顺序：先看「有没有数据」，再看「覆盖全不全」——
 * 一个 observed>0 但只覆盖了 30% 文件的维度，本质上仍是部分结论，不能当全量看。
 */
export function classifyQuality(input: QualityInput): AiSectionDataQuality {
  const { observed, covered, expected, reason, truncated, caveat, drilldown } = input;
  const zeroMeans = input.zeroMeans ?? "finding";

  const base: AiSectionDataQuality = { status: "ok", observed };
  if (reason) base.reason = reason;
  if (truncated) base.truncated = true;
  if (caveat) base.caveat = caveat;
  if (drilldown) base.drilldown = drilldown;
  if (typeof covered === "number") base.covered = covered;
  if (typeof expected === "number") base.expected = expected;

  if (observed <= 0) {
    if (zeroMeans === "unavailable") return { ...base, status: "unavailable" };
    if (zeroMeans === "empty") return { ...base, status: "empty" };
    // 分析跑过、结果为 0：这是真结论，保持 ok
    return base;
  }

  // 有数据但只覆盖了一部分对象：结论仅在覆盖范围内成立
  if (typeof covered === "number" && typeof expected === "number" && expected > 0 && covered < expected) {
    return { ...base, status: "partial" };
  }
  return base;
}

/** 覆盖率百分比（无 expected 时返回 null） */
export function coverageRatio(q: AiSectionDataQuality | undefined): number | null {
  if (!q || typeof q.covered !== "number" || typeof q.expected !== "number" || q.expected <= 0) {
    return null;
  }
  return Math.round((q.covered / q.expected) * 1000) / 10;
}

/**
 * 截断提示 —— 「你看到的不是全部，全部在这里」。
 *
 * 光说「明细为 Top-N 摘录」是不够的：Agent 知道自己看的是样本，却不知道去哪儿拿全量，
 * 结果要么硬着头皮外推，要么退回去 file_read 读源码重算一遍已经算好的数字。
 * 把总数和取数入口一并写出来，这句提示才真正可执行。
 */
function truncationNotice(q: AiSectionDataQuality): string {
  const d = q.drilldown;
  if (!d) return L("ℹ️ 明细为 Top-N 摘录，聚合数字为全量口径。", "ℹ️ Details are a Top-N excerpt; aggregate numbers are full-scope.");
  const total = typeof d.total === "number" ? L(`全量共 ${d.total} 条，`, `total ${d.total}, `) : "";
  return L(
    `ℹ️ 明细为 Top-N 摘录（${total}聚合数字为全量口径）；` +
      `需要核实全量口径时用 \`${d.tool}\` 工具下钻 dataset="${d.dataset}"，支持按路径/条件过滤与分页。`,
    `ℹ️ Details are a Top-N excerpt (${total}aggregate numbers are full-scope); ` +
      `to verify a full-scope figure, drill into dataset="${d.dataset}" with the \`${d.tool}\` tool — path/condition filtering and pagination are supported.`,
  );
}

/**
 * 渲染成一行 Markdown 提示，插在分节正文开头。
 * status=ok 且无截断时返回 null —— 可信的分节不该为「我很可信」再花 token。
 */
export function qualityNotice(q: AiSectionDataQuality | undefined): string | null {
  if (!q) return null;
  const parts: string[] = [];
  const ratio = coverageRatio(q);

  if (q.status === "unavailable") {
    parts.push(L(`⚠️ **数据不可用**${q.reason ? `：${q.reason}` : ""}`, `⚠️ **Data unavailable**${q.reason ? `: ${q.reason}` : ""}`));
  } else if (q.status === "empty") {
    parts.push(L(`ℹ️ **本项目无可分析对象**${q.reason ? `：${q.reason}` : ""}`, `ℹ️ **No analyzable objects in this project**${q.reason ? `: ${q.reason}` : ""}`));
  } else if (q.status === "partial") {
    const cov = ratio !== null ? L(`（覆盖 ${q.covered}/${q.expected}，${ratio}%）`, ` (covered ${q.covered}/${q.expected}, ${ratio}%)`) : "";
    parts.push(L(`⚠️ **部分覆盖**${cov}${q.reason ? `：${q.reason}` : ""}`, `⚠️ **Partial coverage**${cov}${q.reason ? `: ${q.reason}` : ""}`));
  }

  // 截断提示必须独立成条，不能挂在上面的 else 链上：
  // 「部分覆盖」的分节同样会被 Top-N 截断，串成 else-if 就只说得出前一半，
  // Agent 会把一页样本当成该覆盖范围内的全部。
  if (q.truncated) parts.push(truncationNotice(q));

  if (parts.length === 0) return null;
  if (q.caveat) parts.push(L(`**请勿据此断言**：${q.caveat}`, `**Do not assert based on this**: ${q.caveat}`));
  return parts.join(" ");
}

/**
 * 把可信度贴到分节上：写入 dataQuality 字段，并把提示语插到正文最前面。
 *
 * 为什么正文里也要写一遍（而不是只放结构化字段）：
 * 分节正文会被整段塞进对话，而结构化字段只在 outline / section 的 JSON 外层。
 * 如果只放外层，模型很容易在长上下文里只记住正文那句「未发现循环依赖」，
 * 把盲区读成结论。提示语与结论同处一段，才拦得住。
 *
 * 正文变化会自然反映到指纹上（sectionDigest 只认 key + content），
 * 所以「可信度从盲区变为可信」这件事本身就会触发该节的增量更新——这是对的：
 * 上一轮的盲区结论必须失效重读。
 */
export function applyQuality(
  section: AiContextSection,
  quality: AiSectionDataQuality | undefined,
): AiContextSection {
  if (!quality) return section;
  const notice = qualityNotice(quality);
  if (!notice) return { ...section, dataQuality: quality };
  const content = `${notice}\n\n${section.content}`;
  return {
    ...section,
    dataQuality: quality,
    content,
    tokenEstimate: estimateTokens(content),
  };
}
