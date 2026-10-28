/**
 * 焦点目标 × 洞察覆盖 —— 回答「扫描点名的头号目标，AI 到底看过没有」。
 *
 * 为什么这层交叉必须做
 * --------------------
 * 共振榜（riskMatrix / describeFocus）说的是「该从哪下手」，
 * 洞察列表（ai_insights）说的是「AI 已经得出过什么结论」。
 * 这两份数据此前各挂各的面板，中间那个最该被问出口的问题反而没人回答：
 *
 *   排名第一的四维共振文件，历次自动分析里一条结论都没有 —— 是它真没问题，
 *   还是每一轮的 Agent 都在别处打转、从没被引导到它身上？
 *
 * 前者不必管，后者是自动化跑空转的信号：token 花了、轨迹也记了「已分析」，
 * 但最该被分析的文件始终是空白。只有把两份数据摆在同一行上，这件事才看得见。
 *
 * 口径两条（都踩过坑，别改）
 * --------------------------
 * 1. **按 info 级统计，不用画布阈值**。画布默认只标 medium 以上，
 *    拿画布口径来算覆盖，会把「AI 认真看过、判定为 low」显示成「无人分析」——
 *    这正好把结论反过来了。
 * 2. **已收口（resolved）的结论不算现存覆盖**，与画布语义保持一致；
 *    所以文案只敢说「暂无 AI 结论」，不说「AI 从未分析过」——
 *    后者是这份数据回答不了的问题，写上去就是编。
 *
 * 模块无关：只吃 { filePath } 列表 + 路径→标记字典，不认识扫描的任何字段。
 */
import type { InsightMark } from "./insightOverlay";

export interface FocusCoverageSummary {
  /** 已有现存 AI 结论的目标数 */
  covered: number;
  /** 尚无现存 AI 结论的目标数 */
  blank: number;
  /**
   * 空白目标里名次最靠前的那个（榜单已排好序，取第一个即可）。
   * 提示语只点名一个：点名一串等于没点名，用户不会逐个去看。
   */
  topBlankPath?: string;
  /** 该空白目标的共振维度数，用来判断这句提示值不值得说 */
  topBlankResonance: number;
}

/**
 * @param targets 已按「共振数 → 综合分」排好序的焦点目标
 * @param marks   路径 → 洞察标记（务必用 minSeverity: "info" 构建，理由见文件头）
 */
export function summarizeFocusCoverage(
  targets: readonly { filePath: string; resonance: number }[],
  marks: Readonly<Record<string, InsightMark>>,
): FocusCoverageSummary {
  let covered = 0;
  let topBlankPath: string | undefined;
  let topBlankResonance = 0;

  for (const t of targets) {
    if (marks[t.filePath]) {
      covered += 1;
    } else if (!topBlankPath) {
      topBlankPath = t.filePath;
      topBlankResonance = t.resonance;
    }
  }

  return {
    covered,
    blank: targets.length - covered,
    topBlankPath,
    topBlankResonance,
  };
}
