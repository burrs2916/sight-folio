/**
 * triggerDiagnosis —— 从「分析点」一键发起 AI 诊断（G3：分析点 ↔ AI 双向通道）。
 *
 * ─── 这是「AI 全面介入」最贴近用户的一步 ─────────────────────────────────
 * 普通 IDE 只把问题摆出来（语法错误徽标、复杂度热点、审查发现），sight-folio
 * 的差异化在于：点一下就能把这个问题连同它的精确坐标（文件 + 行号）交给 AI，
 * AI 读真实代码 → 给结论 → 用 context_insight 把结论写回 → 结论自动投射回画布
 * （靠 useInsightOverlaySync 在 isStreaming 落定时回库刷新角标）。本模块只负责
 * 「把分析点组装成一次诊断对话」这一跳，洞察落库 / 画布投射全是既有管道。
 *
 * ─── 为什么不在本模块直接落库洞察 ───────────────────────────────────────
 * 结论必须由跑在后端、能读真实代码的 Agent 产出，前端没有代码上下文也不该伪造。
 * 这里只保证：① 选好用来跑诊断的 Agent；② 把坐标喂进 prompt；③ 打开对话与画布聚焦。
 * 诊断所需的写回工具（context_insight / apply_change）以「单次调用白名单」随 run_agent 下发，
 * 覆盖式启用、绝不改写用户 Agent 配置。写回交给 Agent 工具，守门（verify_refs）
 * 与去重（evidence_digest）都在后端，前端强写反而破坏那套闭环。
 */
import { useAgentStore } from "../store/agentStore";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { useToastStore } from "../store/toastStore";
import { findComponentForFile } from "../editor/utils/canvasLink";
import { t } from "../i18n";
import { L } from "./aiLang";
import { CONTEXT_TOOL_ID, INSIGHT_TOOL_ID, RECORDS_TOOL_ID } from "./analysisRunner";

/** 分析点类型：决定 prompt 的措辞与画布入口 */
export type DiagnosisKind =
  | "syntax"
  | "complexity"
  | "review"
  | "file"
  | "techDebt"
  | "duplication"
  | "churn"
  | "deadCode"
  | "generic";

/** 一个待诊断的分析点：精确坐标（文件 + 行区间）是让 AI 不跑偏的关键 */
export interface DiagnosisTarget {
  /** 相对路径（与 files 表 relPath / 画像 config.filePath 对齐，守门据此纠正路径） */
  filePath: string;
  kind: DiagnosisKind;
  /** 人读标题（如「语法错误 ×3」「圈复杂度过高 CC=18」） */
  title: string;
  /** 可选行区间 [起, 止]（1 起），定位到具体行 */
  lineRange?: [number, number];
  /** 可选补充（如 ruleId + message 摘要） */
  detail?: string;
}

/** apply_change 工具 id（analysisRunner 未导出，这里单独定义，与 tools.rs 注册保持一致） */
const APPLY_CHANGE_TOOL_ID = "apply_change";

/** 诊断所需工具：读上下文(project_context) + 读真实代码(scan_records) + 写回结论(context_insight) + 直接改代码(apply_change) */
const REQUIRED_TOOLS = [CONTEXT_TOOL_ID, INSIGHT_TOOL_ID, RECORDS_TOOL_ID, APPLY_CHANGE_TOOL_ID];

const KIND_LABEL_ZH: Record<DiagnosisKind, string> = {
  syntax: "语法错误",
  complexity: "圈复杂度热点",
  review: "审查发现",
  file: "文件整体审查",
  techDebt: "技术债",
  duplication: "重复代码",
  churn: "变更热点",
  deadCode: "死代码",
  generic: "通用诊断",
};

const KIND_LABEL_EN: Record<DiagnosisKind, string> = {
  syntax: "syntax error",
  complexity: "complexity hotspot",
  review: "review finding",
  file: "whole-file review",
  techDebt: "tech debt",
  duplication: "duplicated code",
  churn: "change hotspot",
  deadCode: "dead code",
  generic: "generic diagnosis",
};

/** 组装诊断 prompt：坐标（文件:行）是硬约束，让 AI 不去瞎猜整库 */
function buildDiagnosisPrompt(target: DiagnosisTarget, analysisId: string, diagnosisId: string): string {
  const anchor = target.lineRange ? target.lineRange[0] : 1;
  const ref = `${target.filePath}:${anchor}`;
  const lines = target.lineRange
    ? L(`【涉及行】第 ${target.lineRange[0]}–${target.lineRange[1]} 行`, `【Lines】lines ${target.lineRange[0]}–${target.lineRange[1]}`)
    : "";
  const detail = target.detail ? L(`【补充】${target.detail}`, `【Detail】${target.detail}`) : "";

  const zh =
    `请诊断下面这个代码分析点，并给出可落地的结论：\n\n` +
    `【文件】${target.filePath}\n` +
    `【类型】${KIND_LABEL_ZH[target.kind]}\n` +
    `【问题摘要】${target.title}\n` +
    `${lines}\n` +
    `${detail}\n\n` +
    `诊断要求：\n` +
    `1. 先用 project_context / scan_records(action="dossier", path="${target.filePath}") 读取该文件真实代码与上下文，不要凭空猜测。\n` +
    `2. 定位根本原因，引用具体「文件:行号」证据。\n` +
    `3. 若是可修复的问题，给出修复方案（可直接用 apply_change 写回，或附代码建议）。\n` +
    `4. 把最终结论用 context_insight(action="save", analysis_id="${analysisId}", diagnosis_id="${diagnosisId}", source_kind="${target.kind}", refs=["${ref}"]) 写回，使其投射到画布。\n\n` +
    `当前项目分析 ID：${analysisId}`;

  const en =
    `Please diagnose the following code analysis point and give an actionable conclusion:\n\n` +
    `[File] ${target.filePath}\n` +
    `[Type] ${KIND_LABEL_EN[target.kind]}\n` +
    `[Summary] ${target.title}\n` +
    `${lines}\n` +
    `${detail}\n\n` +
    `Diagnosis requirements:\n` +
    `1. First read the real code and context via project_context / scan_records(action="dossier", path="${target.filePath}") — do not guess.\n` +
    `2. Pinpoint the root cause, citing concrete "file:line" evidence.\n` +
    `3. If it is fixable, propose a fix (you may write it back with apply_change, or attach a code suggestion).\n` +
    `4. Write the final conclusion back with context_insight(action="save", analysis_id="${analysisId}", diagnosis_id="${diagnosisId}", source_kind="${target.kind}", refs=["${ref}"]) so it projects onto the canvas.\n\n` +
    `Current analysis ID: ${analysisId}`;

  return L(zh, en);
}

/**
 * 从分析点发起一次 AI 诊断。
 *
 * 流程：取分析 ID → 取/确保 Agent（累加式启用诊断所需工具）→ 建诊断会话 →
 * 发坐标化 prompt → 聚焦画布实体 → 打开右侧 AI 面板。AI 跑完落库的洞察会经
 * useInsightOverlaySync 自动投射回画布（无需本模块干预）。
 */
export async function triggerDiagnosis(target: DiagnosisTarget): Promise<void> {
  const toast = useToastStore.getState().showToast;
  const analysisId = useProjectStore.getState().activeAnalysisId;
  if (!analysisId) {
    toast(t("aiPanel.diagnose.noAnalysis"), "error");
    return;
  }

  // ① 选 Agent：优先当前选中，回退第一个
  const agentStore = useAgentStore.getState();
  if (agentStore.agents.length === 0) await agentStore.loadAgents();
  const agents = useAgentStore.getState().agents;
  if (agents.length === 0) {
    toast(t("aiPanel.diagnose.noAgent"), "error");
    return;
  }
  const agent = agents.find((a) => a.id === useAgentStore.getState().selectedAgentId) ?? agents[0];

  // ② 切到该 Agent 上下文，建一个独立诊断会话（标题带问题摘要，便于在会话列表里回溯）
  useAgentStore.getState().selectAgent(agent.id);
  const conv = await useAgentStore.getState().createConversation(
    agent.id,
    t("aiPanel.diagnose.convTitle", { title: target.title }),
  );
  useAgentStore.getState().selectConversation(conv.id);

  toast(t("aiPanel.diagnose.started", { title: target.title }), "info");

  // ③ 画布联动：聚焦命中的文件实体（让右侧 AI 面板与画布同一目标）
  const file = useProjectStore.getState().files.find((f) => f.relPath === target.filePath);
  if (file) {
    const comp = findComponentForFile(file);
    if (comp) useEditorStore.getState().focusComponent(comp.id);
  }
  // ④ 打开右侧 AI Agent 面板（tab 5）
  useEditorStore.getState().requestAiPanel();

  // ⑤ 发出诊断（prompt 含精确坐标；AI 落库的洞察会经 overlay sync 自动投射画布）。
  // 诊断所需工具（读上下文 / 写回结论 / 直接改代码）以「单次调用白名单」传入 run_agent，
  // 覆盖式启用、绝不持久改写用户 Agent 配置——根治旧实现用 saveAgent 累加工具污染配置的缺陷。
  await useAgentStore.getState().sendMessage(
    conv.id,
    buildDiagnosisPrompt(target, analysisId, conv.id),
    REQUIRED_TOOLS,
  );
}
