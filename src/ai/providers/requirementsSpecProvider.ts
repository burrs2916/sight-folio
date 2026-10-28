import { aiContextRegistry } from "../contextRegistry";
import {
  AI_CONTEXT_SCHEMA_VERSION,
  type AiContextPack,
  type AiContextProvider,
  type AiContextSection,
} from "../contextTypes";
import { makeSection } from "./scanSections";
import { packWithinBudget } from "../tokenBudget";
import { packDigestFromSections, stampSections } from "../sectionDiff";
import { useProjectStore } from "../../store/projectStore";
import { useRequirementsStore, REQUIREMENTS_SPEC_MODULE_ID, REQUIREMENTS_SPEC_SECTION_KEY } from "../../store/requirementsStore";
import { L } from "../aiLang";
import { t } from "../../i18n";

/**
 * 需求规格供给者（正向「客户 → 需求」维度）。
 *
 * 与 `scanContextProvider`（反向「代码 → 需求」）并列，共用同一套
 * `AiContextProvider` 协议 + `aiContextRegistry` 注册表。注册即被 AI 层与 UI
 * 自动纳入——`ScanAnalysisLauncher` 的 `requirements` 分组 tab 会显示本模块的
 * `requirements-capture` 预设，扫描收尾的持久化闭环也会把本模块基线一并落库。
 *
 * 关键约定（与项目铁律一致）：
 *   - `requirements-spec` 是**客户陈述的客观基线**，不标 `derived`（区别于 AI 结论账本）。
 *   - 落库永远走 `contextPersist.persistModuleContext` 整包写，不在本模块裁剪。
 *   - 不写死任何 Agent / 模型；预设只描述任务。
 */

/** 作用域展示名：与 scanContextProvider.deriveScopeLabel 同口径，优先取项目根目录名 */
function deriveScopeLabel(analysisId: string): string {
  const s = useProjectStore.getState();
  const root = s.watchProjectRoot;
  if (root) {
    const base = root.replace(/[/\\]+$/g, "").split(/[/\\]/).pop();
    if (base) return base;
  }
  const first = s.files.find((f) => !f.isDirectory);
  if (first) {
    const dir = first.relPath.split("/").slice(0, -1).join("/");
    const top = dir.split("/")[0];
    if (top) return top;
  }
  return analysisId;
}

/**
 * 正向「需求采集对照」预设。
 *
 * 注意：本项目扫描分析链路的上下文工具（project_context）按 **packId** 取分节，
 * 而 `requirements-spec` 落在独立的 `requirements-spec` 包里；扫描启动提示只会把
 * Agent 指向扫描包。因此该预设挂在 `scanContextProvider` 上（ScanAnalysisLauncher /
 * AutoAnalysisPanel 都从扫描供给者读预设），并在指令里显式告诉 Agent 用推导出的
 * packId（`<scopeId>:requirements-spec`）去取客户基线——保证「想做」一侧真的送达。
 * 见 scanContextProvider.ts 中 REQUIREMENTS_CAPTURE_PRESET 的定义。
 */
export const REQUIREMENTS_CAPTURE_PRESET_KEY = "requirements-capture";

const requirementsSpecProvider: AiContextProvider = {
  moduleId: REQUIREMENTS_SPEC_MODULE_ID,
  label: L("需求基线", "Requirements Baseline"),
  description:
    "客户在「需求分析」面板模式里登记的结构化需求规格（项目本质/愿景/目标用户/功能/非功能/范围边界/验收标准）。作为需求驱动分析的客观基线，与代码反推的 requirements 语义面并列，供 Agent 对照「想做」与「实际做」。",
  isAvailable: (scopeId) => useRequirementsStore.getState().hasBaseline(scopeId),
  buildPack: (scopeId, options) => {
    const baseline = useRequirementsStore.getState().getBaseline(scopeId);
    if (!baseline) return null;

    const content = baseline.content;
    const preview =
      content.trim().split("\n").find((l) => l.trim().length > 0)?.slice(0, 80) ??
      t("workbench.reqBaseline.emptySummary");
    const section: AiContextSection = makeSection(
      REQUIREMENTS_SPEC_SECTION_KEY,
      L("需求基线（客户陈述）", "Requirements Baseline (Customer-Stated)"),
      6,
      preview,
      [content],
      { length: content.length, updatedAt: baseline.updatedAt },
    );

    const { sections: packed, truncatedSections, tokenEstimate } = packWithinBudget([section]);
    const now = options?.now ?? Date.now();
    const { sections: stamped, changed, unchanged } = stampSections(packed, options?.previousSections, now);
    const digest = packDigestFromSections(scopeId, AI_CONTEXT_SCHEMA_VERSION, stamped);

    const pack: AiContextPack = {
      moduleId: REQUIREMENTS_SPEC_MODULE_ID,
      scopeId,
      scopeLabel: deriveScopeLabel(scopeId),
      schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
      generatedAt: now,
      sections: stamped,
      tokenEstimate,
      digest,
      truncatedSections,
      changedSections: changed,
      unchangedSections: unchanged,
    };
    return pack;
  },
};

aiContextRegistry.register(requirementsSpecProvider);

export { requirementsSpecProvider };
export default requirementsSpecProvider;
