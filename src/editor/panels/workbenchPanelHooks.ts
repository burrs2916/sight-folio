// sight-folio: 工作台 AI 面板的编排逻辑（从 WorkbenchAiPanel 单体拆出，第二阶段）。
//
// 拆分目的：WorkbenchAiPanel 曾把展示组件、工具函数与 ~1940 行编排状态/回调全混在一个 2172 行单体里，
// 任何改动都易牵一发动全身，是后续对标 VS Code 深活的连续性风险点。第一阶段（R53）已把纯展示组件与
// 工具函数抽到 workbenchComponents.tsx；本文件承接第二阶段，把编排函数按职责拆成三个 hook：
//   - useWorkbenchContext：共享「大脑」——扫描事实 / 验证闭环 / 画布作用域 / 附件 / 斜杠 / @workspace /
//     视图与宽度 / send 与快捷动作 / 流式排队 / 模型选择器 / 输入框。
//   - useWorkbenchEdits：代码改动落地机械（内联预览 / diff 落盘 / 跨文件 / 批量应用）。
//   - useWorkbenchChat：agentStore UI 状态 + 改动清单 Composer。
// 调用顺序 ctx → edits(ctx) → chat(ctx, edits)，无环。本文件只搬运逻辑，行为零改动。
//
// computeApplyDiff / computeInlineEdit 这两个纯函数也从 WorkbenchAiPanel 末尾挪到此处，
// 并由 WorkbenchAiPanel 再导出，确保 InlineChat 的 import 路径不变（零回归）。

import { useState, useEffect, useRef, useMemo, useCallback, type MutableRefObject } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import { t } from "../../i18n";
import { L } from "../../ai/aiLang";
import { computeVerifyMarks } from "../../ai/verifyOverlay";
import { useAgentStore } from "../../store/agentStore";
import { useProjectStore } from "../../store/projectStore";
import { useToastStore } from "../../store/toastStore";
import { useVerifyOverlayStore } from "../../store/verifyOverlayStore";
import { useEditorDiagnosticsStore, type EditorDiagnostic } from "../../store/editorDiagnosticsStore";
import { useWritingStore } from "../../store/writingStore";
import { broadcastVerify } from "../useVerifyOverlaySync";
import { broadcastImpact } from "../useImpactOverlaySync";
import {
  parseSettingExtra,
  projectScanApi,
  aiContextApi,
  agentApi,
  parseFileMetricMeta,
  type WritingSetting,
  type WritingTimelineEvent,
  type WritingStoryline,
  type WritingForeshadowing,
  type WritingOutline,
  type WritingChapter,
  type ProjectFile,
  type ProjectSymbol,
  type AiInsightDto,
  type AiModel,
} from "../../services/tauri";
import { isComplete, computeTimelineConflicts, beatEventText, beatImported } from "../../utils/writingTimeline";
import { isOverdue } from "../../utils/writingForeshadowing";
import { looseBeats } from "../../utils/writingOutline";
import { beatPlantedAsForeshadowing } from "../../utils/writingInspiration";
import { buildProofreadReport, chapterTextIssues } from "../../utils/writingProofread";
import { buildChapterWordRows, buildVolumeRows, computeWritingKpis } from "../../utils/writingStats";
import { buildBookOverview, buildBookOverviewCorpus } from "../../utils/writingOverview";
import { buildCharactersCorpus, buildCatalogCorpus, buildSettingCorpus } from "../../utils/writingAiCorpus";
import { useWritingDocsStore } from "../../store/writingDocsStore";
import type { EditorSelectionInfo, MonacoEditorHandle } from "./MonacoCodeEditor";
import {
  buildUserMessage,
  extractUserMessageView,
  type WorkbenchMode,
  type WorkbenchContext,
  type WorkbenchContextFacts,
  type WorkbenchContextDiagnostic,
  type ContextAttachment,
  type WorkspaceFacts,
  WORKBENCH_MODE_TOOLS,
} from "./workbenchContext";
import { parseBlocks, type CodeBlockMeta } from "./aiMarkdown";
import { getSlashCommands, parseSlashCommand } from "./workbenchSlashCommands";
import { AI_SCOPE_EVENT, type AiScopePayload } from "../utils/canvasWorkbenchLink";
import { fuzzyScore, snapshotFileFacts, factsSig, type FileFacts, type VerifyEntry } from "./workbenchComponents";

/** AI 面板当前打开的文件（与 WorkbenchAiPanelProps.activeFile 同形） */
export interface WorkbenchActiveFile {
  fileId: string;
  relPath: string;
  language: string | null;
  name: string;
  totalLines?: number;
}

/** 三个 hook 共享的依赖（来自面板 props + 编辑器句柄） */
interface WorkbenchPanelDeps {
  activeFile: WorkbenchActiveFile | null;
  selection: EditorSelectionInfo | null;
  editorRef: MutableRefObject<MonacoEditorHandle | null>;
  onOpenPath?: (relPath: string, line?: number) => void;
  /** 书场景（novel-zh）：提示词组装切换为写作向，不出现代码分析/构建/lint 术语（零回归：缺省 false = 代码场景） */
  isBookScene?: boolean;
  /** 书场景下 AI 角色随左栏题材 tab 切换（characters/世界观/catalog）；null = 未限定题材。 */
  bookTopic?: "characters" | "worldview" | "catalog" | "timeline" | "storylines" | "foreshadowing" | "inspiration" | "proofread" | "stats" | "writing" | "overview" | null;
  /** 当前书名（书场景注入上下文，让 AI 知道在写哪本书）。 */
  bookTitle?: string | null;
  /** 当前选中的具体设定项（人物/世界观卡），钻入详情时带上，让 AI 聚焦这一个。 */
  focusSetting?: { name: string; kind: "character" | "worldbuilding"; setting?: WritingSetting | null } | null;
}

interface DiffState {
  meta: CodeBlockMeta;
  original: string;
  modified: string;
  /** 应用到文件时命中的目标区间标签，用于 diff 标题（如 src/foo.ts:10-15） */
  rangeLabel?: string;
  /** 被替换掉的原文片段（空串=纯插入）；台账靠它做片段级撤销 */
  replacedText?: string;
  /** 目标文件 fileId：跨文件应用必须精确落到目标文件，绝不能写当前激活标签 */
  fileId: string;
}

/**
 * 把 AI 的代码块派生为「应用到文件」后的完整文档，并给出命中区间标签。
 * 三种策略（对标 VS Code Copilot Apply 的 range diff）：
 *  1) path:start-end（且 path 命中当前文件）→ 替换该闭区间 [start,end] 的原有内容；
 *  2) path:line（仅起始行）→ 在该行前插入（小补丁）；
 *  3) 无 path + 用户有选区 → 替换用户选区（最贴近「选中→修复→应用」的流）。
 * 任一都不满足时返回 null（调用方提示无法定位）。绝不做「整文件全文覆盖」。
 *
 * `replacedText` 是被替换掉的原文片段（插入场景为空串）。它存在的唯一目的是让
 * 改动台账能做**片段级撤销**：撤销时若文件已被后续编辑，整文快照回写会吞掉那些编辑，
 * 只有拿着这段原文才能精确地把这一处换回去。
 */
export function computeApplyDiff(
  original: string,
  meta: CodeBlockMeta,
  selection: EditorSelectionInfo | null,
  activeRelPath: string,
): { modified: string; rangeLabel: string; replacedText: string } | null {
  const lines = original.split("\n");
  const snip = meta.code.split("\n");
  // 目标文件 = 代码块头声明的 path（跨文件锚点补丁），否则落到当前激活文件。
  // 调用方必须保证传入的 `original` 就是目标文件的内容；本函数只按 targetRelPath 做行索引与标签，
  // 不再用 pathMatches 卡「只能改当前文件」——否则跨文件代码块（path:line 指向别的文件）会静默返回 null，
  // 表现为「点应用毫无反应」。这是「AI 给的改动应用不上」这一体感硬伤的根因。
  const targetRelPath = meta.path ?? activeRelPath;

  // 1) 结构化区段替换
  if (meta.line != null && meta.endLine != null) {
    const s = meta.line;
    const e = meta.endLine;
    if (s >= 1 && e >= s && e <= lines.length) {
      const modified = [...lines.slice(0, s - 1), ...snip, ...lines.slice(e)].join("\n");
      return {
        modified,
        rangeLabel: `${targetRelPath}:${s}-${e}`,
        replacedText: lines.slice(s - 1, e).join("\n"),
      };
    }
  }

  // 2) 仅起始行（path:line）→ 在该行前插入小补丁
  if (meta.line != null && meta.endLine == null) {
    const s = meta.line;
    if (s >= 1 && s <= lines.length + 1) {
      const insertAt = s - 1;
      const modified = [...lines.slice(0, insertAt), ...snip, ...lines.slice(insertAt)].join("\n");
      return {
        modified,
        rangeLabel: `${targetRelPath}:${s}`,
        replacedText: "",
      };
    }
  }

  // 3) 无 path + 有选区 → 替换用户选区（最贴近「选中→修复→应用」的流）
  if (!meta.path && selection && selection.startLine != null && selection.endLine != null) {
    const s = selection.startLine;
    const e = selection.endLine;
    if (s >= 1 && e >= s && e <= lines.length) {
      const modified = [...lines.slice(0, s - 1), ...snip, ...lines.slice(e)].join("\n");
      return {
        modified,
        rangeLabel: `${activeRelPath}:${s}-${e}`,
        replacedText: lines.slice(s - 1, e).join("\n"),
      };
    }
  }

  // 兜底：用户给了选区，但没给可定位的行区间（只给了列/纯文本选区）→ 退化为「在当前文件末尾追加」
  if (!meta.path && selection && selection.startLine != null && selection.endLine == null) {
    const s = selection.startLine;
    if (s >= 1 && s <= lines.length + 1) {
      const insertAt = s;
      const modified = [...lines.slice(0, insertAt), ...snip, ...lines.slice(insertAt)].join("\n");
      return {
        modified,
        rangeLabel: `${activeRelPath}:${s}`,
        replacedText: "",
      };
    }
  }

  return null;
}

/**
 * 与 computeApplyDiff 同源，但返回「区间 + 新文本」而非整文，便于在编辑器内逐行红/绿预览、
 * 由 executeEdits 精确植入（可撤销、触发保存→增量重扫）。三类定位策略与 computeApplyDiff 一致。
 */
export function computeInlineEdit(
  originalLines: string[],
  meta: CodeBlockMeta,
  selection: EditorSelectionInfo | null,
  activeRelPath: string,
): { startLine: number; endLine: number; newText: string } | null {
  const snip = meta.code.split("\n");
  // 同 computeApplyDiff：目标文件 = meta.path ?? activeRelPath，去掉 pathMatches 卡死，
  // 让跨文件 path:line 的锚点补丁也能在编辑器内联预览。调用方保证 originalLines 即目标文件内容。
  const targetRelPath = meta.path ?? activeRelPath;

  if (meta.line != null && meta.endLine != null) {
    const s = meta.line;
    const e = meta.endLine;
    if (s >= 1 && e >= s && e <= originalLines.length) {
      return { startLine: s, endLine: e, newText: meta.code };
    }
  }
  if (meta.line != null && meta.endLine == null) {
    const s = meta.line;
    if (s >= 1 && s <= originalLines.length + 1) {
      return { startLine: s, endLine: s, newText: meta.code };
    }
  }
  if (!meta.path && selection && selection.startLine != null && selection.endLine != null) {
    const s = selection.startLine;
    const e = selection.endLine;
    if (s >= 1 && e >= s && e <= originalLines.length) {
      return { startLine: s, endLine: e, newText: meta.code };
    }
  }
  return null;
}

/**
 * 对话后「下一步建议」（对标 VS Code Copilot / Cursor 在每次回答后给出的 follow-up）。
 *
 * 设计立场：真实 IDE 代理在回答后会主动给「接下来可以做什么」，而不是等用户再想一句。
 * 这与 R16 的「画布作用域主动建议」互补——作用域建议是「聚焦实体时产生的可执行追问」，
 * 本函数是「AI 刚答完一轮后，基于这轮内容给的下一步」。
 *
 * 安全约束：只负责算出建议，绝不自动发送。点击由面板调 `citeIntoInput` 把成型提示词预填进输入框，
 * 用户审阅后回车才发——避免误触消耗 token，更关键的是避免 edit/agent 模式下误触触发 apply_change 改盘。
 *
 * 启发式按优先级取前 3 条：本轮产生了代码块 → 围绕「改动」；当前文件有诊断 → 围绕「修复」；
 * 有画布作用域 → 围绕「影响面/重构」；否则给通用兜底。label 走 i18n 键，prompt 用 L() 双语成型。
 */
export interface FollowupItem {
  key: string;
  /** i18n 键（短标签，渲染侧 t()） */
  labelKey: string;
  /** 成型提示词（L() 双语），点击预填输入框 */
  prompt: string;
}

export function buildFollowups(args: {
  hasActiveFile: boolean;
  relPath?: string | null;
  /** 本轮助手消息是否包含代码块（通常是改盘/补丁） */
  producedCode: boolean;
  /** 当前文件是否有实时诊断（错误/警告） */
  hasDiagnostics: boolean;
  /** 是否处于画布作用域（聚焦某个实体） */
  hasScope: boolean;
  /** 书场景（novel-zh）：follow-up 走写作向，不出现单元测试/重构等代码术语 */
  isBookScene?: boolean;
  /** 书场景当前题材（含 overview 全书总览）：不同题材给不同的「下一步」追问 */
  bookTopic?: string;
}): FollowupItem[] {
  const { hasActiveFile, relPath, producedCode, hasDiagnostics, hasScope, isBookScene, bookTopic } = args;
  const file = relPath || "this file";
  const out: FollowupItem[] = [];
  if (isBookScene && bookTopic === "overview") {
    out.push({
      key: "ovTimeline",
      labelKey: "workbench.aiFollowup.book.overviewTimeline",
      prompt: L(
        `基于全书总览，列出所有时间线冲突（同一角色 / 事件在不同章节的时间点矛盾、顺序打架），逐条给出理顺建议，并指明涉及的章节。`,
        `From the whole-book overview, list every timeline conflict (same character / event with contradictory timestamps or ordering across chapters); give a fix per conflict and name the chapters involved.`,
      ),
    });
    out.push({
      key: "ovForeshadow",
      labelKey: "workbench.aiFollowup.book.overviewForeshadow",
      prompt: L(
        `检查全书伏笔的埋设与回收：哪些伏笔尚未回收、哪些回收章与埋设章跨度不合理、有无跨章逻辑漏洞，逐条给出处理建议。`,
        `Check foreshadowing plant/payoff across the book: which are unpayed, which have unreasonable plant-to-payoff gaps, any cross-chapter logic holes; suggest a fix per item.`,
      ),
    });
    out.push({
      key: "ovOrphan",
      labelKey: "workbench.aiFollowup.book.overviewOrphan",
      prompt: L(
        `找出尚未被任何章节引用的人物 / 世界观设定（孤儿设定），评估每个是删、补场景还是并入其他设定，给出优先级。`,
        `Find characters / worldbuilding settings never referenced by any chapter (orphan settings); for each, decide drop / add a scene / merge, with priority.`,
      ),
    });
    out.push({
      key: "ovLoose",
      labelKey: "workbench.aiFollowup.book.overviewLoose",
      prompt: L(
        `汇总全书未落章的念头（loose beats）与校对问题，给出优先级排序与处理建议（转时间线 / 挂章 / 转伏笔 / 修正）。`,
        `Consolidate all loose beats (unplaced ideas) and proofread issues; prioritize and suggest handling (timeline / attach to chapter / foreshadowing / fix).`,
      ),
    });
    return out.slice(0, 4);
  }
  if (isBookScene) {
    out.push({
      key: "improve",
      labelKey: "workbench.aiFollowup.book.improve",
      prompt: L(
        `请润色上面这段正文：提升文笔、节奏与可读性，保持人设口吻与全文风格一致。`,
        `Polish the passage above: improve the prose, pacing and readability while keeping the character's voice and the overall style consistent.`,
      ),
    });
    out.push({
      key: "consistency",
      labelKey: "workbench.aiFollowup.book.consistency",
      prompt: L(
        `对照人设卡与世界观设定，检查上面正文是否出现人设 / 设定矛盾，逐条列出并给出修改建议。没有人设卡覆盖到的角色请明确声明「设定缺失」，不要凭空推断。`,
        `Against the character cards and worldbuilding, check the passage above for any character / setting contradictions; list them with revision suggestions. For characters without a card, explicitly say the setting is missing instead of inventing one.`,
      ),
    });
    out.push({
      key: "continue",
      labelKey: "workbench.aiFollowup.book.continue",
      prompt: L(
        `基于上面的正文与已有大纲 / 设定，给出接下来 2-3 个可行的情节走向，并说明各自的张力与风险。`,
        `Based on the passage above plus the existing outline / setting, suggest 2-3 viable next plot directions, noting the tension and risk of each.`,
      ),
    });
    return out.slice(0, 3);
  }
  if (producedCode && hasActiveFile) {
    out.push({
      key: "explainChange",
      labelKey: "workbench.aiFollowup.explainChange",
      prompt: L(
        `请解释你刚才对 ${file} 所做的改动：改了什么、为什么这样改、有没有更优方案。`,
        `Explain the change you just made to ${file}: what changed, why, and whether there is a better approach.`,
      ),
    });
    out.push({
      key: "writeTests",
      labelKey: "workbench.aiFollowup.writeTests",
      prompt: L(
        `为 ${file} 刚才改动的相关函数编写单元测试，覆盖关键分支与边界情况。`,
        `Write unit tests for the functions affected by the recent change in ${file}, covering key branches and edge cases.`,
      ),
    });
    out.push({
      key: "checkRisk",
      labelKey: "workbench.aiFollowup.checkRisk",
      prompt: L(
        `审查刚才对 ${file} 的改动：是否引入了新的 bug、坏味道或安全隐患，引用 file:line 说明。`,
        `Review the recent change to ${file}: any new bugs, smells or security risks? Cite file:line.`,
      ),
    });
  } else if (hasDiagnostics && hasActiveFile) {
    out.push({
      key: "whyError",
      labelKey: "workbench.aiFollowup.whyError",
      prompt: L(
        `当前文件 ${file} 的这些错误是怎么产生的？给出根因与最小修复方案。`,
        `Why are these errors in ${file} happening? Give the root cause and a minimal fix.`,
      ),
    });
    out.push({
      key: "minFix",
      labelKey: "workbench.aiFollowup.minFix",
      prompt: L(
        `请直接修复 ${file} 当前的诊断错误（用 apply_change 工具最小改动），先通过 file_read / project_context 确认上下文再改。`,
        `Fix the current diagnostics in ${file} with a minimal change (use apply_change), confirm context via file_read / project_context first.`,
      ),
    });
    out.push({
      key: "reviewPath",
      labelKey: "workbench.aiFollowup.reviewPath",
      prompt: L(
        `审查 ${file} 当前出错的逻辑路径，指出潜在问题与改进。`,
        `Review the failing logic path in ${file}; point out issues and improvements.`,
      ),
    });
  } else if (hasScope) {
    out.push({
      key: "impactFiles",
      labelKey: "workbench.aiFollowup.impactFiles",
      prompt: L(
        `列出受此实体改动波及的文件，并说明每个文件为什么要改。`,
        `List the files impacted by editing this entity and explain why each needs a change.`,
      ),
    });
    out.push({
      key: "refactor",
      labelKey: "workbench.aiFollowup.refactor",
      prompt: L(
        `给出此实体的重构方案，关注可读性与调用方影响。`,
        `Propose a refactor for this entity, focusing on readability and caller impact.`,
      ),
    });
    out.push({
      key: "reconfirm",
      labelKey: "workbench.aiFollowup.reconfirm",
      prompt: L(
        `用 project_context / file_read 读取真实代码，再确认上面的结论是否成立。`,
        `Re-read the real code via project_context / file_read and confirm whether the conclusion holds.`,
      ),
    });
  } else {
    out.push({
      key: "reconfirm",
      labelKey: "workbench.aiFollowup.reconfirm",
      prompt: L(
        `用 project_context / file_read 读取真实代码，不要凭空猜测，再确认上面的结论。`,
        `Re-read the real code via project_context / file_read, don't guess, then confirm the conclusion.`,
      ),
    });
    out.push({
      key: "listImprove",
      labelKey: "workbench.aiFollowup.listImprove",
      prompt: L(
        `列出可以改进的后续事项，按优先级排序。`,
        `List actionable next improvements, ordered by priority.`,
      ),
    });
  }
  return out.slice(0, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// useWorkbenchContext：共享大脑（事实 / 验证 / 画布 / 附件 / 斜杠 / 视图 / send）
// ─────────────────────────────────────────────────────────────────────────────

export function useWorkbenchContext(deps: WorkbenchPanelDeps) {
  const { activeFile, selection, editorRef, onOpenPath, isBookScene = false, bookTopic, bookTitle, focusSetting } = deps;

  // 模型选择器（对标 VS Code 的模型下拉）：独立于 Agent 维度的「本会话用哪个模型」覆盖。
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const currentAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  // 当前助手是否具备 run_command 能力（决定 @terminal participant 是否可用）：纯前端读 AiAgent.toolIds
  const hasRunCommand = !!currentAgent?.toolIds?.includes("run_command");
  const [selectedModelId, setSelectedModelId] = useState<string>(currentAgent?.modelId ?? "");
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!modelsLoaded) {
      agentApi
        .listModels()
        .then((ms) => {
          if (!cancelled) {
            setModels(ms.filter((m) => m.enabled));
            setModelsLoaded(true);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [modelsLoaded]);
  // 助手列表：面板挂载即加载，确保 Agent 下拉始终能从 DB 取到已配置的助手
  // （否则重启 dev / 未先打开配置页时 agents 为空，下拉显示「未配置助手」而实际已配过）。
  // 仅当列表为空时触发，避免重复拉取；依赖 agents.length 而非每次渲染，失败也不会死循环。
  useEffect(() => {
    if (agents.length === 0) {
      void loadAgents().catch(() => {});
    }
  }, [agents.length, loadAgents]);
  useEffect(() => {
    if (!currentAgent) return;
    if (!selectedModelId || !models.some((m) => m.id === selectedModelId)) {
      setSelectedModelId(currentAgent.modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

  const files = useProjectStore((s) => s.files);
  const symbols = useProjectStore((s) => s.symbols);
  const deadSymbols = useProjectStore((s) => s.deadSymbols);
  const clones = useProjectStore((s) => s.clones);
  const metrics = useProjectStore((s) => s.metrics);
  const findings = useProjectStore((s) => s.findings);
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const callEdges = useProjectStore((s) => s.callEdges);

  const [mode, setMode] = useState<WorkbenchMode>("ask");
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [input, setInput] = useState("");
  const [slashAnchor, setSlashAnchor] = useState<null | HTMLElement>(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashTarget, setSlashTarget] = useState<"chat" | "edits">("chat");
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachQuery, setAttachQuery] = useState("");
  const [hashMention, setHashMention] = useState<null | "chat" | "edits">(null);
  const workspaceFacts = useMemo<WorkspaceFacts>(() => {
    const langMap = new Map<string, number>();
    const dirMap = new Map<string, number>();
    for (const f of files) {
      const lang = f.language ?? "unknown";
      langMap.set(lang, (langMap.get(lang) ?? 0) + 1);
      const seg = f.relPath.includes("/") ? f.relPath.split("/")[0] : "(root)";
      dirMap.set(seg, (dirMap.get(seg) ?? 0) + 1);
    }
    const languages = [...langMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const topDirs = [...dirMap.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return { fileCount: files.length, languages, topDirs };
  }, [files]);
  const [insights, setInsights] = useState<AiInsightDto[]>([]);
  const [insightsLoadedFor, setInsightsLoadedFor] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // Opt-in by default (VS Code-style): impact-surface canvas staining starts
  // off so the canvas stays clean; the user enables it via the block toggle.
  // The user's choice persists across panel open/close via localStorage.
  const [impactCanvasOn, setImpactCanvasOnState] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("ps.workbench.impactCanvas");
      return v === null ? false : v === "1";
    } catch {
      return false;
    }
  });
  const setImpactCanvasOn = useCallback((v: boolean) => {
    try {
      localStorage.setItem("ps.workbench.impactCanvas", v ? "1" : "0");
    } catch {
      /* ignore persistence failure */
    }
    setImpactCanvasOnState(v);
  }, []);
  const [pendingSuggestion, setPendingSuggestion] = useState<{ key: string; label: string; prompt: string } | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [canvasScope, setCanvasScope] = useState<{ relPath: string; label: string; fileId: string } | null>(null);
  const [view, setView] = useState<"chat" | "edits">("chat");
  const [editInput, setEditInput] = useState("");
  const [queued, setQueued] = useState<string[]>([]);

  const [verifyList, setVerifyList] = useState<VerifyEntry[]>([]);
  const [verifySettled, setVerifySettled] = useState<{ relPath: string; before: FileFacts; after: FileFacts }[]>([]);
  const verifyTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const armVerify = useCallback((fileId: string, relPath: string) => {
    const before = snapshotFileFacts(fileId);
    const id = `${fileId}@${Date.now()}`;
    setVerifyList((prev) => [...prev, { id, relPath, status: "verifying" as const, before }].slice(-3));
    const start = Date.now();
    const timer = setInterval(() => {
      const cur = snapshotFileFacts(fileId);
      const changed = factsSig(cur) !== factsSig(before);
      const elapsed = Date.now() - start;
      if (changed || elapsed >= 9000) {
        clearInterval(timer);
        verifyTimers.current.delete(id);
        setVerifyList((prev) => prev.map((e) => (e.id === id ? { ...e, status: "done", after: cur } : e)));
        setVerifySettled((prev) => {
          const next = [...prev, { relPath, before, after: cur }].slice(-20);
          const marks = computeVerifyMarks(next);
          useVerifyOverlayStore.getState().setEntries(next);
          void broadcastVerify(marks);
          return next;
        });
      }
    }, 450);
    verifyTimers.current.set(id, timer);
  }, []);
  const dismissVerify = useCallback((id: string) => {
    setVerifyList((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const toggleVerifyCanvas = useCallback(() => {
    const next = !useVerifyOverlayStore.getState().enabled;
    useVerifyOverlayStore.getState().setEnabled(next);
    void broadcastVerify(computeVerifyMarks(verifySettled), next);
  }, [verifySettled]);
  const handleAppliedChange = useCallback(
    (relPath: string) => {
      const fid = files.find((f) => f.relPath === relPath)?.id;
      if (fid) armVerify(fid, relPath);
    },
    [files, armVerify],
  );
  useEffect(() => {
    const timers = verifyTimers.current;
    return () => {
      timers.forEach((t) => clearInterval(t));
      timers.clear();
    };
  }, []);

  const [width, setWidth] = useState<number>(() => {
    const w = Number(localStorage.getItem("workbench.ai.width"));
    return w >= 260 && w <= 760 ? w : 360;
  });
  const draggingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const facts = useMemo(() => {
    if (!activeFile) return null;
    const fid = activeFile.fileId;
    const deadCount = deadSymbols.filter((d) => d.fileId === fid).length;
    const cloneGroups = new Set(clones.filter((c) => c.fileId === fid).map((c) => c.groupId)).size;
    let maxCc = 0;
    for (const m of metrics) {
      if (m.fileId !== fid) continue;
      const meta = parseFileMetricMeta(m);
      for (const f of meta.functions ?? []) {
        if (typeof f.cc === "number" && f.cc > maxCc) maxCc = f.cc;
      }
    }
    if (deadCount === 0 && cloneGroups === 0 && maxCc === 0) return null;
    return {
      deadCount: deadCount || undefined,
      cloneGroups: cloneGroups || undefined,
      cc: maxCc > 0 ? maxCc : undefined,
    };
  }, [activeFile, deadSymbols, clones, metrics]);

  const EMPTY_DIAGS: EditorDiagnostic[] = [];
  const fileDiagnostics = useEditorDiagnosticsStore(
    (s) => s.byRelPath[activeFile?.relPath ?? ""] ?? EMPTY_DIAGS,
  );

  const factsLabel = useMemo(() => {
    if (!facts) return "";
    const parts: string[] = [];
    if (facts.cc != null) parts.push(t("workbench.aiFacts.cc", { cc: facts.cc }));
    if (facts.deadCount != null) parts.push(t("workbench.aiFacts.dead", { n: facts.deadCount }));
    if (facts.cloneGroups != null) parts.push(t("workbench.aiFacts.clone", { n: facts.cloneGroups }));
    return parts.join(" · ");
  }, [facts]);

  const scopeFacts = useMemo<WorkbenchContextFacts | null>(() => {
    if (!canvasScope) return null;
    const fid = canvasScope.fileId;
    const deadCount = deadSymbols.filter((d) => d.fileId === fid).length;
    const cloneGroups = new Set(clones.filter((c) => c.fileId === fid).map((c) => c.groupId)).size;
    let maxCc = 0;
    for (const m of metrics) {
      if (m.fileId !== fid) continue;
      const meta = parseFileMetricMeta(m);
      for (const f of meta.functions ?? []) {
        if (typeof f.cc === "number" && f.cc > maxCc) maxCc = f.cc;
      }
    }
    const findingsCount = findings.filter(
      (f) => f.status === "open" && f.targetType === "file" && f.targetId === fid && f.ruleId !== "rule_dead_symbol",
    ).length;
    if (deadCount === 0 && cloneGroups === 0 && maxCc === 0 && findingsCount === 0) return null;
    return {
      cc: maxCc > 0 ? maxCc : undefined,
      deadCount: deadCount || undefined,
      cloneGroups: cloneGroups || undefined,
      findings: findingsCount || undefined,
    };
  }, [canvasScope, deadSymbols, clones, metrics, findings]);

  interface ScopeSuggestion {
    key: string;
    label: string;
    prompt: string;
  }
  const scopeSuggestions = useMemo<ScopeSuggestion[]>(() => {
    if (!canvasScope || !scopeFacts) return [];
    const loc = `${canvasScope.label} (${canvasScope.relPath})`;
    const out: ScopeSuggestion[] = [];
    if (scopeFacts.cc != null && scopeFacts.cc >= 15) {
      out.push({
        key: "cc",
        label: t("workbench.aiSuggest.cc", { n: scopeFacts.cc }),
        prompt: t("workbench.aiSuggest.ccPrompt", { loc, n: scopeFacts.cc }),
      });
    }
    if (scopeFacts.deadCount) {
      out.push({
        key: "dead",
        label: t("workbench.aiSuggest.dead", { n: scopeFacts.deadCount }),
        prompt: t("workbench.aiSuggest.deadPrompt", { loc, n: scopeFacts.deadCount }),
      });
    }
    if (scopeFacts.cloneGroups) {
      out.push({
        key: "clone",
        label: t("workbench.aiSuggest.clone", { n: scopeFacts.cloneGroups }),
        prompt: t("workbench.aiSuggest.clonePrompt", { loc, n: scopeFacts.cloneGroups }),
      });
    }
    if (scopeFacts.findings) {
      out.push({
        key: "findings",
        label: t("workbench.aiSuggest.findings", { n: scopeFacts.findings }),
        prompt: t("workbench.aiSuggest.findingsPrompt", { loc, n: scopeFacts.findings }),
      });
    }
    return out;
  }, [canvasScope, scopeFacts, t]);

  const impactFiles = useMemo<{ fileId: string; relPath: string }[]>(() => {
    const focusId = canvasScope?.fileId ?? activeFile?.fileId;
    if (!focusId || callEdges.length === 0) return [];
    const rev = new Map<string, string[]>();
    for (const e of callEdges) {
      if (!e.calleeFileId) continue;
      const arr = rev.get(e.calleeFileId);
      if (arr) arr.push(e.callerFileId);
      else rev.set(e.calleeFileId, [e.callerFileId]);
    }
    const seen = new Set<string>([focusId]);
    const queue: string[] = [focusId];
    while (queue.length) {
      const cur = queue.shift()!;
      const callers = rev.get(cur);
      if (!callers) continue;
      for (const c of callers) {
        if (!seen.has(c)) {
          seen.add(c);
          queue.push(c);
        }
      }
    }
    seen.delete(focusId);
    const fileMap = new Map(files.map((f) => [f.id, f.relPath]));
    return [...seen]
      .map((id) => ({ fileId: id, relPath: fileMap.get(id) ?? id }))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));
  }, [canvasScope?.fileId, activeFile?.fileId, callEdges, files]);

  useEffect(() => {
    if (!activeAnalysisId || insightsLoadedFor === activeAnalysisId) return;
    let cancelled = false;
    setInsightsLoading(true);
    aiContextApi
      .listAiInsights(activeAnalysisId)
      .then((list) => {
        if (cancelled) return;
        setInsights(list);
        setInsightsLoadedFor(activeAnalysisId);
      })
      .catch(() => {
        if (!cancelled) setInsightsLoadedFor(activeAnalysisId);
      })
      .finally(() => {
        if (!cancelled) setInsightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAnalysisId, insightsLoadedFor]);

  useEffect(() => {
    let un: UnlistenFn | undefined;
    (async () => {
      try {
        un = await listen<AiScopePayload>(AI_SCOPE_EVENT, (e) => {
          const p = e.payload;
          setCanvasScope(
            p && p.kind === "entity" && p.relPath && p.fileId
              ? { relPath: p.relPath, label: p.label ?? p.relPath, fileId: p.fileId }
              : null,
          );
        });
      } catch {
        /* 非 Tauri 运行时（纯 web 预览）静默失败，不影响面板其余逻辑 */
      }
    })();
    return () => {
      un?.();
    };
  }, []);

  useEffect(() => {
    const relPaths = impactCanvasOn ? impactFiles.map((f) => f.relPath) : [];
    void broadcastImpact(relPaths, impactCanvasOn);
  }, [impactFiles, impactCanvasOn]);

  const fileInsights = useMemo(() => {
    if (!activeFile || insights.length === 0) return [] as AiInsightDto[];
    const rp = activeFile.relPath;
    return insights.filter(
      (it) =>
        (it.refs ?? []).some((r) => r.includes(rp)) ||
        it.title.includes(rp) ||
        it.body.includes(rp),
    );
  }, [activeFile, insights]);

  const contextSig = [
    activeFile,
    canvasScope,
    facts,
    attachments.length > 0,
    impactFiles.length > 0,
    fileInsights.length > 0,
  ].filter(Boolean).length;
  const showContextBar = contextSig > 0 || attachOpen;

  const isStreaming = useAgentStore((s) => s.isStreaming);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    const toast = useToastStore.getState().showToast;
    let st = useAgentStore.getState();
    if (st.agents.length === 0) await st.loadAgents();
    st = useAgentStore.getState();
    if (st.agents.length === 0) {
      toast(t("workbench.aiNoAgent"), "error");
      return null;
    }
    if (st.selectedConversationId) {
      const conv = st.conversations.find((c) => c.id === st.selectedConversationId);
      if (conv) {
        if (st.selectedAgentId !== conv.agentId) useAgentStore.getState().selectAgent(conv.agentId);
        return st.selectedConversationId;
      }
    }
    const agent = st.agents.find((a) => a.id === st.selectedAgentId) ?? st.agents[0];
    if (st.selectedAgentId !== agent.id) useAgentStore.getState().selectAgent(agent.id);
    const conv = await useAgentStore.getState().createConversation(
      agent.id,
      t("workbench.aiConvTitle", { file: activeFile?.name ?? "?" }),
    );
    useAgentStore.getState().selectConversation(conv.id);
    return conv.id;
  }, [activeFile]);

  const send = useCallback(
    async (userText: string, opts?: { suppressSelection?: boolean; mode?: WorkbenchMode }) => {
      const trimmed = userText.trim().replace(/^@(workspace|work)\s*/i, "");
      if (!trimmed || isStreaming) return;
      const slash = parseSlashCommand(trimmed, isBookScene);
      if (slash) setSlashAnchor(null);
      const effectiveMode = slash ? slash.def.mode : opts?.mode ?? mode;
      const text = slash
        ? slash.def.buildText(slash.args, {
            activeFile: activeFile ? { relPath: activeFile.relPath, language: activeFile.language } : null,
            selection,
            diagnostics: fileDiagnostics,
          })
        : trimmed;
      const suppressSelection = slash ? !!slash.def.embedSelection : !!opts?.suppressSelection;
      const convId = await ensureConversation();
      if (!convId) return;
      // 题材语料：发消息前实时聚合当前书数据注入 ctx，让 AI 每轮带真实数据作答。
      // worldview=设定库（世界观设定 + 人物卡 + 关系）；timeline=时间线档案（章节骨架 + 事件全表 + 冲突 + 待补全）。
      const bookSettingCorpus =
        isBookScene && bookTopic === "worldview"
          ? (() => {
              const { activeBookId, settings } = useWritingStore.getState();
              const bookSettings = activeBookId ? settings.filter((s) => s.bookId === activeBookId) : settings;
              return buildWorldBibleCorpus(bookSettings);
            })()
          : isBookScene && (bookTopic === "timeline" || bookTopic === "storylines")
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const chapters = bookId ? ws.chapters.filter((c) => c.bookId === bookId) : ws.chapters;
              const settings = bookId ? ws.settings.filter((s) => s.bookId === bookId) : ws.settings;
              const lines = bookId ? ws.storylines.filter((l) => l.bookId === bookId) : ws.storylines;
              return buildTimelineCorpus(bookId, ws.timelineEvents, chapters, settings, lines);
            })()
          : isBookScene && bookTopic === "foreshadowing"
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const chapters = bookId ? ws.chapters.filter((c) => c.bookId === bookId) : ws.chapters;
              const lines = bookId ? ws.storylines.filter((l) => l.bookId === bookId) : ws.storylines;
              return buildForeshadowingCorpus(bookId, ws.foreshadowings, chapters, lines);
            })()
          : isBookScene && bookTopic === "inspiration"
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const outlines = bookId ? ws.outlines.filter((o) => o.bookId === bookId) : ws.outlines;
              const events = bookId ? ws.timelineEvents.filter((e) => e.bookId === bookId) : ws.timelineEvents;
              const shadows = bookId ? ws.foreshadowings.filter((f) => f.bookId === bookId) : ws.foreshadowings;
              return buildInspirationCorpus(bookId, outlines, events, shadows);
            })()
          : isBookScene && bookTopic === "proofread"
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const chapters = bookId ? ws.chapters.filter((c) => c.bookId === bookId) : ws.chapters;
              const outlines = bookId ? ws.outlines.filter((o) => o.bookId === bookId) : ws.outlines;
              const events = bookId ? ws.timelineEvents.filter((e) => e.bookId === bookId) : ws.timelineEvents;
              const shadows = bookId ? ws.foreshadowings.filter((f) => f.bookId === bookId) : ws.foreshadowings;
              const lines = bookId ? ws.storylines.filter((l) => l.bookId === bookId) : ws.storylines;
              return buildProofreadCorpus(bookId, chapters, outlines, events, shadows, lines);
            })()
          : isBookScene && bookTopic === "stats"
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const chapters = bookId ? ws.chapters.filter((c) => c.bookId === bookId) : ws.chapters;
              const settings = bookId ? ws.settings.filter((s) => s.bookId === bookId) : ws.settings;
              return buildStatsCorpus(bookTitle ?? null, chapters, settings);
            })()
          : isBookScene && bookTopic === "writing"
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const chapters = bookId ? ws.chapters.filter((c) => c.bookId === bookId) : ws.chapters;
              const activeChapterId = useWritingDocsStore.getState().activeChapterByBook[bookId ?? ""] ?? null;
              return buildManuscriptCorpus(bookTitle ?? null, chapters, activeChapterId);
            })()
          : isBookScene && bookTopic === "characters"
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const settings = bookId ? ws.settings.filter((s) => s.bookId === bookId) : ws.settings;
              return buildCharactersCorpus(settings);
            })()
          : isBookScene && bookTopic === "catalog"
          ? (() => {
              const ws = useWritingStore.getState();
              const bookId = ws.activeBookId;
              const chapters = bookId ? ws.chapters.filter((c) => c.bookId === bookId) : ws.chapters;
              const outlines = bookId ? ws.outlines.filter((o) => o.bookId === bookId) : ws.outlines;
              return buildCatalogCorpus(chapters, outlines);
            })()
          : null;
      // 全书总览语料：发消息前实时聚合当前书跨维度数据，注入 ctx。
      // 与右栏《全书总览》仪表盘同一口径（utils/writingOverview，单一事实来源）。
      // 刻意对所有书题材注入——即便在 characters/catalog 等当前无题材语料的视图，
      // AI 也能拿到全书跨维度快照，避免「只见一隅不知全貌」。
      const bookOverviewCorpus = (() => {
        if (!isBookScene) return null;
        const ws = useWritingStore.getState();
        const bookId = ws.activeBookId;
        const chapters = bookId ? ws.chapters.filter((c) => c.bookId === bookId) : ws.chapters;
        const settings = bookId ? ws.settings.filter((s) => s.bookId === bookId) : ws.settings;
        const outlines = bookId ? ws.outlines.filter((o) => o.bookId === bookId) : ws.outlines;
        const events = bookId ? ws.timelineEvents.filter((e) => e.bookId === bookId) : ws.timelineEvents;
        const lines = bookId ? ws.storylines.filter((l) => l.bookId === bookId) : ws.storylines;
        const shadows = bookId ? ws.foreshadowings.filter((f) => f.bookId === bookId) : ws.foreshadowings;
        return buildBookOverviewCorpus(
          buildBookOverview({ bookTitle: bookTitle ?? null, chapters, settings, outlines, timelineEvents: events, storylines: lines, foreshadowings: shadows }),
        );
      })();
      // 聚焦设定语料：右栏选中某个具体人物/世界观设定（钻入详情）时，
      // 把该设定的完整档案灌进 ctx，让 AI 围绕这一个设定作答（不再只拿到名字）。
      const focusSettingCorpus = (() => {
        if (!isBookScene || !focusSetting?.setting) return null;
        return buildSettingCorpus(focusSetting.setting);
      })();
      const ctx: WorkbenchContext = {
        activeFile: activeFile
          ? { fileId: activeFile.fileId, relPath: activeFile.relPath, language: activeFile.language, name: activeFile.name, totalLines: activeFile.totalLines }
          : null,
        selection: suppressSelection ? null : selection,
        attachments,
        mode: effectiveMode,
        facts,
        scope: canvasScope
          ? { label: canvasScope.label, relPath: canvasScope.relPath, facts: scopeFacts ?? {}, impact: impactFiles }
          : null,
        workspace: workspaceFacts,
        hasRunCommand,
        diagnostics: fileDiagnostics.length
          ? fileDiagnostics.map(
              (d): WorkbenchContextDiagnostic => ({
                message: d.message,
                severity: d.severity,
                line: d.startLine,
                code: d.code,
                source: d.source,
              }),
            )
          : undefined,
        bookTopic: isBookScene ? bookTopic : null,
        bookTitle: isBookScene ? bookTitle : null,
        focusSetting: isBookScene ? focusSetting : null,
        bookSettingCorpus,
        bookOverviewCorpus,
        focusSettingCorpus,
      };
      const message = buildUserMessage(ctx, text, isBookScene);
      await useAgentStore.getState().sendMessage(convId, message, WORKBENCH_MODE_TOOLS[effectiveMode], selectedModelId || null);
    },
    [activeFile, selection, attachments, mode, facts, canvasScope, scopeFacts, fileDiagnostics, isStreaming, ensureConversation, workspaceFacts, hasRunCommand, selectedModelId, isBookScene, bookTopic, bookTitle, focusSetting],
  );

  const submitInput = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (isStreaming) {
        setQueued((q) => [...q, text]);
        useToastStore.getState().showToast(t("workbench.aiQueue.queued"), "info");
        return;
      }
      void send(text);
    },
    [isStreaming, send, t],
  );

  const prevStreaming = useRef(isStreaming);
  useEffect(() => {
    if (prevStreaming.current && !isStreaming && queued.length > 0) {
      const [first, ...rest] = queued;
      setQueued(rest);
      void send(first);
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, queued, send]);

  const quickAction = useCallback(
    (kind: "file" | "selection" | "test" | "review" | "fix" | "book-understand" | "book-explain-sel" | "book-polish" | "book-consistency" | "book-plot" | "book-consistency-world") => {
      // 全书世界观/人物设定一致性审查：不依赖当前章节文件，直接读 activeBook 的设定/人物资料。
      if (kind === "book-consistency-world") {
        const { activeBookId, books, settings } = useWritingStore.getState();
        const bookTitle = activeBookId ? (books.find((b) => b.id === activeBookId)?.title ?? "") : "";
        const bookSettings = activeBookId ? settings.filter((s) => s.bookId === activeBookId) : settings;
        const { zh, en } = buildWorldConsistencyPrompt(bookTitle, bookSettings);
        void send(L(zh, en));
        return;
      }
      if (!activeFile) return;
      const ref = selection ? `${activeFile.relPath}:${selection.startLine}-${selection.endLine}` : activeFile.relPath;
      let text: string;
      if (isBookScene) {
        // 书场景：写作向快捷动作，不出现「代码 / 单元测试 / 审查」等术语
        if (kind === "book-explain-sel" && selection) {
          text = L(
            `请解释下面这段正文在情节推进、人设塑造与主题上的作用，并指出可改进处：\n\n【${ref}】\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
            `Explain what this passage does for plot progression, character and theme, and point out improvements:\n\n[${ref}]\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
          );
        } else if (kind === "book-polish" && selection) {
          text = L(
            `请润色下面这段正文：提升文笔、节奏与可读性，保持人设口吻与全文风格一致，只改必要处：\n\n【${ref}】\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
            `Polish this passage: improve prose, pacing and readability while keeping the character's voice and overall style consistent; change only what's needed:\n\n[${ref}]\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
          );
        } else if (kind === "book-consistency") {
          text = L(
            `请对照人设卡与世界观设定，审查章节 ${activeFile.relPath} 是否出现人设 / 设定矛盾，逐条列出并给出修改建议。没有人设卡覆盖的角色请明确声明「设定缺失」。`,
            `Against the character cards and worldbuilding, review ${activeFile.relPath} for character / setting contradictions; list them with revision suggestions. For characters without a card, explicitly say the setting is missing.`,
          );
        } else if (kind === "book-plot") {
          text = L(
            `请基于作品概览（全书章节结构与字数分布）、当前章节正文与世界观设定，审视情节连贯性、伏笔回收与叙事节奏，给出具体到章节的修改建议。`,
            `Based on the book overview (chapter structure and word distribution), the current chapter text and the worldbuilding, review plot coherence, foreshadowing payoff and pacing, with chapter-specific revision suggestions.`,
          );
        } else {
          text = L(
            `请读懂章节 ${activeFile.relPath}：它在全书里承担什么情节功能、与前后章怎么衔接、写得好的地方与可改进点分别是什么。`,
            `Help me understand chapter ${activeFile.relPath}: what plot function it serves in the book, how it connects to the surrounding chapters, and what works versus what could improve.`,
          );
        }
        void send(text, { suppressSelection: kind === "book-explain-sel" || kind === "book-polish" });
        return;
      }
      if (kind === "selection" && selection) {
        text = L(
          `请解释下面选中的代码，并说明它的作用、潜在问题与改进点：\n\n【${ref}】\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
          `Explain the selected code and point out its purpose, issues and improvements:\n\n[${ref}]\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
        );
      } else if (kind === "fix" && selection) {
        text = L(
          `请修复下面选中的代码中的问题（bug、坏味道、安全隐患），给出修改后的完整片段并说明改动理由：\n\n【${ref}】\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
          `Fix the issues (bugs, smells, security risks) in the selected code, give the full corrected snippet and explain the changes:\n\n[${ref}]\n\`\`\`${activeFile.language ?? ""}\n${selection.text}\n\`\`\``,
        );
      } else if (kind === "test") {
        text = L(`请为文件 ${activeFile.relPath} 编写单元测试，覆盖关键函数/分支与边界情况。`, `Write unit tests for ${activeFile.relPath} covering key functions/branches and edge cases.`);
      } else if (kind === "review") {
        text = L(`请审查文件 ${activeFile.relPath}，指出 bug、坏味道、安全隐患并引用「file:line」证据。`, `Review ${activeFile.relPath}, citing concrete "file:line" evidence for bugs/smells/risks.`);
      } else {
        text = L(`请解释文件 ${activeFile.relPath} 的整体结构、关键逻辑、依赖关系与潜在问题，给出模块级概述。`, `Explain the overall structure, key logic, dependencies and potential issues of ${activeFile.relPath}.`);
      }
      void send(text, { suppressSelection: kind === "selection" || kind === "fix" });
    },
    [activeFile, selection, send, isBookScene],
  );

  const fixErrors = useCallback(() => {
    if (!activeFile || fileDiagnostics.length === 0) return;
    const list = fileDiagnostics
      .map((d) => `- L${d.startLine}: ${d.message}${d.source ? ` (${d.source}${d.code ? " " + d.code : ""})` : ""}`)
      .join("\n");
    const text = isBookScene
      ? L(
          `当前章节 ${activeFile.relPath} 存在以下批注，请逐一修正，给出最小改动（优先用 apply_change 工具直接改正文）：\n\n${list}\n\n先通过 file_read 读取真实正文，确认每处上下文后再修改，不要凭空猜测。`,
          `The chapter ${activeFile.relPath} currently has these annotations. Fix each with a minimal change (prefer the apply_change tool to edit the prose directly):\n\n${list}\n\nFirst read the real prose via file_read to confirm the context of each before editing; do not guess.`,
        )
      : L(
          `当前文件 ${activeFile.relPath} 存在以下诊断问题，请逐一修复，给出最小改动（优先用 apply_change 工具直接改文件）：\n\n${list}\n\n先通过 project_context / file_read 读取真实的当前代码，确认每处上下文后再修改，不要凭空猜测。`,
          `The file ${activeFile.relPath} currently has these diagnostics. Fix each with a minimal change (prefer the apply_change tool to edit the file directly):\n\n${list}\n\nFirst read the real current code via project_context / file_read to confirm the context of each before editing; do not guess.`,
        );
    void send(text, { mode: "edit" });
  }, [activeFile, fileDiagnostics, send, isBookScene]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const move = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const nw = window.innerWidth - ev.clientX;
      if (nw >= 260 && nw <= 760) {
        setWidth(nw);
        localStorage.setItem("workbench.ai.width", String(nw));
      }
    };
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  const attachCandidates = useMemo(() => {
    const q = attachQuery.trim();
    interface AttachItem {
      type: "file" | "symbol";
      relPath: string;
      label: string;
      fileId: string;
      line?: number;
      symbolName?: string;
    }
    const fileItems: AttachItem[] = files
      .map((f: ProjectFile) => ({ type: "file" as const, relPath: f.relPath, label: f.name, fileId: f.id, line: undefined }))
      .sort((a, b) => fuzzyScore(b.relPath, q) - fuzzyScore(a.relPath, q));
    const symItems: AttachItem[] = symbols
      .map((s: ProjectSymbol) => ({
        type: "symbol" as const,
        relPath: s.filePath,
        label: s.name,
        fileId: s.fileId,
        line: s.lineStart,
        symbolName: s.name,
      }))
      .sort((a, b) => fuzzyScore(b.label, q) - fuzzyScore(a.label, q));
    return [...fileItems, ...symItems].filter((_, i) => i < 40);
  }, [files, symbols, attachQuery]);

  const addAttachment = (c: (typeof attachCandidates)[number]) => {
    const exists = attachments.some((a) => a.refPath === c.relPath && a.symbolName === c.symbolName);
    if (exists) {
      setAttachOpen(false);
      setHashMention(null);
      return;
    }
    const att: ContextAttachment =
      c.type === "symbol"
        ? { kind: "symbol", label: c.symbolName ?? c.label, refPath: c.relPath, symbolName: c.symbolName, line: c.line }
        : { kind: "file", label: c.label, refPath: c.relPath };
    setAttachments((prev) => [...prev, att]);
    setAttachOpen(false);
    setAttachQuery("");
    if (hashMention === "chat") setInput((prev) => prev.replace(/(^|\s)#\S*$/, "$1"));
    else if (hashMention === "edits") setEditInput((prev) => prev.replace(/(^|\s)#\S*$/, "$1"));
    if (hashMention) setHashMention(null);
  };

  const detectHashMention = (v: string, origin: "chat" | "edits") => {
    const m = v.match(/(?:^|\s)#(\S*)$/);
    if (m) {
      setAttachOpen(true);
      setContextOpen(true);
      setAttachQuery(m[1]);
      setHashMention(origin);
    } else if (hashMention === origin) {
      setAttachOpen(false);
      setHashMention(null);
      setAttachQuery("");
    }
  };

  const detectSlashCommand = (v: string, target: "chat" | "edits") => {
    const m = v.match(/^\/(\w*)$/);
    if (m) {
      setSlashTarget(target);
      setSlashQuery(m[1]);
      setSlashAnchor(target === "edits" ? editInputRef.current : inputRef.current);
    } else if (slashAnchor && !v.startsWith("/")) {
      setSlashAnchor(null);
    }
  };

  const canApply = mode !== "ask";

  return {
    activeFile,
    files,
    selectedModelId,
    setSelectedModelId,
    models,
    mode,
    setMode,
    attachments,
    setAttachments,
    input,
    setInput,
    slashAnchor,
    setSlashAnchor,
    slashQuery,
    setSlashQuery,
    slashTarget,
    setSlashTarget,
    attachOpen,
    setAttachOpen,
    attachQuery,
    setAttachQuery,
    hashMention,
    setHashMention,
    workspaceFacts,
    hasRunCommand,
    insights,
    insightsLoading,
    insightsOpen,
    setInsightsOpen,
    impactCanvasOn,
    setImpactCanvasOn,
    pendingSuggestion,
    setPendingSuggestion,
    contextOpen,
    setContextOpen,
    canvasScope,
    view,
    setView,
    editInput,
    setEditInput,
    queued,
    setQueued,
    verifyList,
    verifySettled,
    dismissVerify,
    toggleVerifyCanvas,
    handleAppliedChange,
    width,
    draggingRef,
    inputRef,
    editInputRef,
    listEndRef,
    startDrag,
    attachCandidates,
    addAttachment,
    detectHashMention,
    detectSlashCommand,
    canApply,
    send,
    submitInput,
    quickAction,
    fixErrors,
    fileDiagnostics,
    factsLabel,
    scopeFacts,
    scopeSuggestions,
    impactFiles,
    fileInsights,
    contextSig,
    showContextBar,
    armVerify,
    facts,
    isBookScene,
    bookTopic,
    bookTitle,
    focusSetting,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useWorkbenchEdits：代码改动落地机械
// ─────────────────────────────────────────────────────────────────────────────

export function useWorkbenchEdits(deps: WorkbenchPanelDeps & { ctx: ReturnType<typeof useWorkbenchContext> }) {
  const { activeFile, selection, editorRef, onOpenPath, ctx } = deps;

  const [diff, setDiff] = useState<DiffState | null>(null);
  const [pendingInline, setPendingInline] = useState<{ from: CodeBlockMeta } | null>(null);
  const filesCacheRef = useRef<{ analysisId: string; map: Map<string, string> } | null>(null);
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const files = useProjectStore((s) => s.files);
  const selectedConversationId = useAgentStore((s) => s.selectedConversationId);

  useEffect(() => {
    if (pendingInline) {
      editorRef.current?.clearInlineEdit?.();
      setPendingInline(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.fileId]);

  const onCodeInsert = useCallback(
    (meta: CodeBlockMeta) => {
      if (!activeFile) return;
      const ed = editorRef.current;
      if (!ed) {
        useToastStore.getState().showToast(t("workbench.aiCode.insertNeedEditor"), "info");
        return;
      }
      if (meta.path && meta.path !== activeFile.relPath) {
        useToastStore.getState().showToast(t("workbench.aiCode.applyOnlyCurrent"), "info");
        return;
      }
      ed.insertAtCursor(meta.code);
      useToastStore.getState().showToast(t("workbench.aiCode.inserted"), "success");
    },
    [activeFile, editorRef],
  );

  const resolveFileId = useCallback(
    async (relPath: string): Promise<string | null> => {
      const aid = activeAnalysisId;
      if (!aid) return null;
      if (filesCacheRef.current && filesCacheRef.current.analysisId === aid) {
        return filesCacheRef.current.map.get(relPath) ?? null;
      }
      const list = await projectScanApi.listFiles(aid);
      const map = new Map(list.map((f) => [f.relPath, f.id]));
      filesCacheRef.current = { analysisId: aid, map };
      return map.get(relPath) ?? null;
    },
    [activeAnalysisId],
  );

  const applyCrossFileDirect = useCallback(
    async (meta: CodeBlockMeta): Promise<boolean> => {
      if (!meta.path) return false;
      const fileId = await resolveFileId(meta.path);
      if (!fileId) {
        useToastStore.getState().showToast(t("workbench.aiApply.composerCrossNotFound", { path: meta.path }), "error");
        return false;
      }
      let original = "";
      try {
        const sfc = await projectScanApi.readSourceFile(fileId);
        if (sfc.skippedReason) {
          useToastStore.getState().showToast(t("workbench.aiCode.readSkipped", { reason: sfc.skippedReason }), "error");
          return false;
        }
        original = sfc.lines.join("\n");
      } catch (e: any) {
        useToastStore.getState().showToast(t("workbench.aiCode.readFail", { error: e?.message ?? String(e) }), "error");
        return false;
      }
      const res = computeApplyDiff(original, meta, null, meta.path);
      if (!res) {
        useToastStore.getState().showToast(t("workbench.aiCode.applyNeedRange"), "info");
        return false;
      }
      try {
        ctx.armVerify(fileId, meta.path);
        await projectScanApi.writeSourceFile(fileId, res.modified, {
          origin: "ai-apply",
          reason: t("workbench.aiChanges.reasonApplied", { range: res.rangeLabel ?? meta.path }),
          oldText: res.replacedText,
          newText: meta.code,
          conversationId: selectedConversationId ?? undefined,
        });
        return true;
      } catch (e: any) {
        useToastStore.getState().showToast(t("workbench.aiCode.applyFail", { error: e?.message ?? String(e) }), "error");
        return false;
      }
    },
    [activeAnalysisId, resolveFileId, selectedConversationId, ctx],
  );

  const onCodeApply = useCallback(
    async (meta: CodeBlockMeta) => {
      if (!activeFile) return;
      // 目标文件 = 代码块头声明的 path，否则落到当前打开的文件（VS Code 式：无 path 即作用于当前文件）。
      const target = meta.path ?? activeFile.relPath;
      const ed = editorRef.current;
      // 目标就是当前打开的文件：优先在编辑器内做红/绿内联预览，可逐条保留/放弃。
      if (ed && target === activeFile.relPath) {
        ed.clearInlineEdit?.();
        setPendingInline(null);
        const originalLines = ed.getValue().split("\n");
        const range = computeInlineEdit(originalLines, meta, selection, activeFile.relPath);
        if (range) {
          ed.previewInlineEdit(range);
          setPendingInline({ from: meta });
          return;
        }
        // 无 path/选区无法定位：退化为「在光标处插入」（VS Code 式兜底，apply 不静默失败）。
        ed.insertAtCursor(meta.code);
        useToastStore.getState().showToast(t("workbench.aiCode.inserted"), "success");
        return;
      }
      // 跨文件：按 path 解析目标文件 → 读盘 → 弹 diff 预览（与改动台账共用，用户确认才落盘）。
      const fileId = await resolveFileId(target);
      if (!fileId) {
        useToastStore.getState().showToast(t("workbench.aiApply.composerCrossNotFound", { path: target }), "error");
        return;
      }
      let original = "";
      try {
        const sfc = await projectScanApi.readSourceFile(fileId);
        if (sfc.skippedReason) {
          useToastStore.getState().showToast(t("workbench.aiCode.readSkipped", { reason: sfc.skippedReason }), "error");
          return;
        }
        original = sfc.lines.join("\n");
      } catch (e: any) {
        useToastStore.getState().showToast(t("workbench.aiCode.readFail", { error: e?.message ?? String(e) }), "error");
        return;
      }
      const res = computeApplyDiff(original, meta, null, target);
      if (!res) {
        useToastStore.getState().showToast(t("workbench.aiCode.applyNeedRange"), "info");
        return;
      }
      setDiff({ meta, original, modified: res.modified, rangeLabel: res.rangeLabel, fileId });
    },
    [activeFile, editorRef, selection, resolveFileId],
  );

  const acceptInline = useCallback(() => {
    if (activeFile) ctx.armVerify(activeFile.fileId, activeFile.relPath);
    editorRef.current?.acceptInlineEdit();
    setPendingInline(null);
    useToastStore.getState().showToast(t("workbench.aiApply.applied"), "success");
  }, [editorRef, activeFile, ctx]);

  const rejectInline = useCallback(() => {
    editorRef.current?.rejectInlineEdit();
    setPendingInline(null);
    useToastStore.getState().showToast(t("workbench.aiApply.rejected"), "info");
  }, [editorRef]);

  const applyInlineDirect = useCallback(
    (meta: CodeBlockMeta): boolean => {
      const ed = editorRef.current;
      if (!ed || !activeFile) return false;
      ed.clearInlineEdit?.();
      const originalLines = ed.getValue().split("\n");
      const range = computeInlineEdit(originalLines, meta, selection, activeFile.relPath);
      if (!range) return false;
      ed.previewInlineEdit(range);
      ed.acceptInlineEdit();
      return true;
    },
    [activeFile, editorRef, selection],
  );

  const applyDiff = useCallback(async () => {
    if (!diff) return;
    try {
      const replaced = diff.replacedText ?? "";
      ctx.armVerify(diff.fileId, diff.meta.path ?? activeFile?.relPath ?? "");
      await projectScanApi.writeSourceFile(diff.fileId, diff.modified, {
        origin: "ai-apply",
        reason: t("workbench.aiChanges.reasonApplied", {
          range: diff.rangeLabel ?? diff.meta.path ?? "",
        }),
        oldText: replaced,
        newText: diff.meta.code,
        conversationId: selectedConversationId ?? undefined,
      });
      useToastStore.getState().showToast(t("workbench.aiCode.applied"), "success");
    } catch (e: any) {
      useToastStore.getState().showToast(t("workbench.aiCode.applyFail", { error: e?.message ?? String(e) }), "error");
    }
    setDiff(null);
  }, [diff, selectedConversationId, ctx]);

  return {
    diff,
    setDiff,
    pendingInline,
    rejectInline,
    acceptInline,
    onCodeInsert,
    onCodeApply,
    applyCrossFileDirect,
    applyInlineDirect,
    applyDiff,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useWorkbenchChat：agentStore UI 状态 + 输入框 + 改动清单 Composer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 全书「世界观设定库」语料（双语，纯函数、零迁移）。汇集当前书的世界观设定
 * （类型/规则/例外/关联/关系/备注）与人物卡概要，供两处复用：
 * ① 普通世界观消息自动注入（buildContextBlock 经 ctx.bookSettingCorpus 透传）；
 * ② 全书设定一致性审查提示词（buildWorldConsistencyPrompt）。
 * 关系（relations）逐条展开为「#targetId / 名称 / 类型」，便于模型核对自洽性。
 */
export function buildWorldBibleCorpus(settings: WritingSetting[]): { zh: string; en: string } {
  const worlds = settings.filter((s) => s.kind === "worldbuilding");
  const chars = settings.filter((s) => s.kind === "character");
  const worldRows = worlds.map((s) => {
    const e = parseSettingExtra(s.extra);
    const wb = e.worldbuildingProfile ?? {};
    const rels = (e.relations ?? [])
      .map((r) => (r.targetId ? `#${r.targetId}` : "") || r.target || r.type || "")
      .filter(Boolean)
      .join("、");
    return {
      zh: `- ${s.name}（${wb.type || "未分类"}）：规则=${wb.rules || "—"}；例外=${wb.exceptions || "—"}；关联=${wb.linkedTo || "—"}；关系=[${rels || "—"}]；备注=${wb.notes || "—"}`,
      en: `- ${s.name} (${wb.type || "uncategorized"}): rules=${wb.rules || "—"}; exceptions=${wb.exceptions || "—"}; linked=${wb.linkedTo || "—"}; relations=[${rels || "—"}]; notes=${wb.notes || "—"}`,
    };
  });
  const charRows = chars.map((s) => {
    const p = parseSettingExtra(s.extra).profile ?? {};
    return {
      zh: `- ${s.name}：外貌=${p.appearance || "—"}；性格=${p.personality || "—"}；动机=${p.motivation || "—"}；备注=${p.notes || "—"}`,
      en: `- ${s.name}: appearance=${p.appearance || "—"}; personality=${p.personality || "—"}; motivation=${p.motivation || "—"}; notes=${p.notes || "—"}`,
    };
  });
  const worldSectionZh = worldRows.length ? worldRows.map((r) => r.zh).join("\n") : "（暂无世界观设定）";
  const worldSectionEn = worldRows.length ? worldRows.map((r) => r.en).join("\n") : "(no worldbuilding yet)";
  const charSectionZh = charRows.length ? charRows.map((r) => r.zh).join("\n") : "（暂无人物卡）";
  const charSectionEn = charRows.length ? charRows.map((r) => r.en).join("\n") : "(no characters yet)";
  return {
    zh: `【世界观设定】\n${worldSectionZh}\n\n【人物】\n${charSectionZh}`,
    en: `[Worldbuilding]\n${worldSectionEn}\n\n[Characters]\n${charSectionEn}`,
  };
}

/**
 * 全书「时间线档案」语料（双语，纯函数、零迁移）。汇集当前书的章节骨架 + 剧情线结构（线名 +
 * 挂线事件摘要 + 未挂线清单）+ 时间线事件全表
 * （时点=作者原文自由文本，不换算不推导）+ 冲突清单 + 待补全草稿，供时间线题材的 AI 消息
 * 自动注入（buildContextBlock 经 ctx.bookSettingCorpus 透传）。冲突口径与右栏总览卡一致
 * （book+chapter 两视图并集，复用 utils/writingTimeline 同一份算法，禁再写第二份）。
 */
export function buildTimelineCorpus(
  bookId: string | null,
  events: WritingTimelineEvent[],
  chapters: WritingChapter[],
  settings: WritingSetting[],
  storylines: WritingStoryline[] = []
): { zh: string; en: string } {
  const coll = new Intl.Collator("zh", { numeric: true });
  const chapterName = (id: string | null | undefined): { zh: string; en: string } => {
    const c = id ? chapters.find((x) => x.id === id) : null;
    if (!c) return { zh: "未绑章", en: "unbound" };
    const t = c.title || "未命名";
    return { zh: t, en: t };
  };
  const settingName = (id: string | null | undefined): string => {
    if (!id) return "全书级";
    return settings.find((s) => s.id === id)?.name || "未命名";
  };
  const settingNameEn = (id: string | null | undefined): string => {
    if (!id) return "book-level";
    return settings.find((s) => s.id === id)?.name || "unnamed";
  };

  // 章节骨架（阅读顺序 = sortOrder）
  const skeleton = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const skelZh = skeleton.length
    ? skeleton.map((c, i) => `${i + 1}. ${c.title || "未命名"}${c.kind ? `（${c.kind}）` : ""}`).join(" ")
    : "（暂无章节）";
  const skelEn = skeleton.length
    ? skeleton.map((c, i) => `${i + 1}. ${c.title || "untitled"}${c.kind ? ` (${c.kind})` : ""}`).join(" ")
    : "(no chapters yet)";

  // 事件全表：完整事件按 at 排序；待补全草稿单列
  const complete = events.filter(isComplete).sort((a, b) => coll.compare(a.at?.trim() || "", b.at?.trim() || ""));
  const drafts = events.filter((e) => !isComplete(e));
  const eventRows = complete.map((e) => {
    const src = `来源：${settingName(e.settingId)}`;
    const srcEn = `source: ${settingNameEn(e.settingId)}`;
    const ch = e.chapterId ? `；绑章：${chapterName(e.chapterId).zh}` : "";
    const chEn = e.chapterId ? `; chapter: ${chapterName(e.chapterId).en}` : "";
    return {
      zh: `- [${e.at}] ${e.event}（${src}${ch}）`,
      en: `- [${e.at}] ${e.event} (${srcEn}${chEn})`,
    };
  });
  const draftRows = drafts.map((e) => {
    const has = e.event || e.at;
    return {
      zh: `- ${has ? `[${e.at ?? "无时点"}] ${e.event ?? "无描述"}` : "空草稿"}（来源：${settingName(e.settingId)}）`,
      en: `- ${has ? `[${e.at ?? "no when"}] ${e.event ?? "no description"}` : "empty draft"} (source: ${settingNameEn(e.settingId)})`,
    };
  });
  const evZh = eventRows.length ? eventRows.map((r) => r.zh).join("\n") : "（暂无时间线事件）";
  const evEn = eventRows.length ? eventRows.map((r) => r.en).join("\n") : "(no timeline events yet)";
  const draftZh = draftRows.length ? draftRows.map((r) => r.zh).join("\n") : "（无待补全草稿）";
  const draftEn = draftRows.length ? draftRows.map((r) => r.en).join("\n") : "(no drafts to complete)";

  // 冲突清单：与右栏总览卡同口径（两视图并集）
  const conflictIds = new Set([
    ...computeTimelineConflicts(events, { view: "book" }),
    ...computeTimelineConflicts(events, { view: "chapter", chapters: [...chapters].sort((a, b) => a.sortOrder - b.sortOrder) }),
  ]);
  const conflictEvents = events.filter((e) => conflictIds.has(e.id));
  const conflictZh = conflictEvents.length
    ? conflictEvents.map((e) => `- [${e.at}] ${e.event}（${e.chapterId ? `章：${chapterName(e.chapterId).zh}` : `来源：${settingName(e.settingId)}`}）`).join("\n")
    : "（未检出冲突）";
  const conflictEn = conflictEvents.length
    ? conflictEvents.map((e) => `- [${e.at}] ${e.event} (${e.chapterId ? `chapter: ${chapterName(e.chapterId).en}` : `source: ${settingNameEn(e.settingId)}`})`).join("\n")
    : "(no conflicts detected)";

  // 剧情线结构：每条线名 + 挂线事件摘要 + 未挂线清单（advisory 口径，与右栏总览卡一致）
  const lineRows = storylines.map((sl) => {
    const evs = complete.filter((e) => e.storylineId === sl.id);
    const summary = evs.length
      ? evs.map((e) => `[${e.at}] ${e.event}`).join("；")
      : null;
    return {
      sl,
      count: evs.length,
      zh: `- ${sl.name}（${evs.length} 条事件）${summary ? `：${summary}` : "：尚无挂线事件"}`,
      en: `- ${sl.name} (${evs.length} events)${summary ? `: ${summary}` : ": no attached events yet"}`,
    };
  });
  const unlined = complete.filter((e) => !e.storylineId);
  const lineZh = lineRows.length
    ? lineRows.map((r) => r.zh).join("\n") +
      (unlined.length ? `\n- 未挂线事件（${unlined.length} 条）：${unlined.map((e) => `[${e.at}] ${e.event}`).join("；")}` : "")
    : "（暂无剧情线）";
  const lineEn = lineRows.length
    ? lineRows.map((r) => r.en).join("\n") +
      (unlined.length ? `\n- unlined events (${unlined.length}): ${unlined.map((e) => `[${e.at}] ${e.event}`).join("; ")}` : "")
    : "(no storylines yet)";

  return {
    zh: `【时间线档案】\n【章节骨架】${skelZh}\n\n【剧情线（${storylines.length} 条）】\n${lineZh}\n\n【事件全表（${complete.length} 条）】\n${evZh}\n\n【时间线冲突（${conflictEvents.length}，规划提示非硬错误）】\n${conflictZh}\n\n【待补全草稿（${drafts.length}）】\n${draftZh}`,
    en: `[Timeline]\n[Chapter skeleton] ${skelEn}\n\n[Storylines (${storylines.length})]\n${lineEn}\n\n[Events (${complete.length})]\n${evEn}\n\n[Timeline conflicts (${conflictEvents.length}, planning hints, not hard errors)]\n${conflictEn}\n\n[Drafts to complete (${drafts.length})]\n${draftEn}`,
  };
}

/**
 * 全书「伏笔档案」语料（双语，纯函数、零迁移）：三态清单（标题/状态/埋设章/计划回收章/挂线）
 * + 跨章预警（回收点已到/已过仍待回收）+ 未挂线计数，供伏笔题材的 AI 消息自动注入。
 */
export function buildForeshadowingCorpus(
  bookId: string | null,
  foreshadowings: WritingForeshadowing[],
  chapters: WritingChapter[],
  storylines: WritingStoryline[] = []
): { zh: string; en: string } {
  const chName = (id: string | null | undefined): string => {
    if (!id) return "未锚定";
    return chapters.find((c) => c.id === id)?.title || "未命名";
  };
  const chNameEn = (id: string | null | undefined): string => {
    if (!id) return "unanchored";
    return chapters.find((c) => c.id === id)?.title || "untitled";
  };
  const statusZh = (s: string): string => (s === "pending" ? "待回收" : s === "paidoff" ? "已回收" : "已弃置");
  const statusEn = (s: string): string => (s === "pending" ? "pending" : s === "paidoff" ? "paid off" : "abandoned");

  const rows = foreshadowings.map((f) => {
    const overdue = isOverdue(f, chapters);
    const line = f.storylineId ? storylines.find((sl) => sl.id === f.storylineId)?.name ?? "" : "";
    const zh =
      `- [${statusZh(f.status)}] ${f.title || "未命名"}（埋设：${chName(f.plantChapterId)}；计划回收：${chName(f.payoffChapterId)}）` +
      (line ? `〔挂线：${line}〕` : "") +
      (overdue ? " ⚠ 回收点已过仍未回收" : "") +
      (f.description ? `—— ${f.description}` : "");
    const en =
      `- [${statusEn(f.status)}] ${f.title || "unnamed"} (planted: ${chNameEn(f.plantChapterId)}; planned payoff: ${chNameEn(f.payoffChapterId)})` +
      (line ? ` [line: ${line}]` : "") +
      (overdue ? " ⚠ payoff point passed but still pending" : "") +
      (f.description ? ` — ${f.description}` : "");
    return { zh, en };
  });
  const pending = foreshadowings.filter((f) => f.status === "pending").length;
  const overdue = foreshadowings.filter((f) => isOverdue(f, chapters)).length;
  const rowsZh = rows.length ? rows.map((r) => r.zh).join("\n") : "（暂无伏笔）";
  const rowsEn = rows.length ? rows.map((r) => r.en).join("\n") : "(no foreshadowing yet)";
  return {
    zh: `【伏笔档案】共 ${foreshadowings.length} 条（待回收 ${pending}，跨章预警 ${overdue}）\n${rowsZh}\n（伏笔=作者手填的「埋设→回收」承诺，预警仅为规划提示非硬错误）`,
    en: `[Foreshadowing] ${foreshadowings.length} total (${pending} pending, ${overdue} overdue warnings)\n${rowsEn}\n(Foreshadowing = the author's hand-written plant/payoff promises; warnings are planning hints, not hard errors)`,
  };
}

/**
 * 全书「灵感念头池」语料（双语，纯函数、零迁移）：未落章 beat（loose beats）清单
 * （标题/摘要/分发状态：已入时间线 / 已入伏笔）+ 未分发计数，供灵感题材的 AI 消息自动注入。
 * 口径与编辑面/右栏同一份：looseBeats（writingOutline）+ beatImported（writingTimeline）
 * + beatPlantedAsForeshadowing（writingInspiration），禁止第二套。
 */
export function buildInspirationCorpus(
  bookId: string | null,
  outlines: WritingOutline[],
  timelineEvents: WritingTimelineEvent[],
  foreshadowings: WritingForeshadowing[] = []
): { zh: string; en: string } {
  void bookId; // 与 buildForeshadowingCorpus 同签名惯例：调用方已按书过滤
  const loose = looseBeats(outlines);
  const rows = loose.map((b) => {
    const inTimeline = beatImported(timelineEvents, beatEventText(b));
    const inForeshadow = beatPlantedAsForeshadowing(foreshadowings, b);
    const marksZh = (inTimeline ? "〔已入时间线〕" : "") + (inForeshadow ? "〔已入伏笔〕" : "");
    const marksEn = (inTimeline ? " [in timeline]" : "") + (inForeshadow ? " [in foreshadowing]" : "");
    const zh = `- ${b.title || "未命名念头"}${marksZh}` + (b.summary ? `—— ${b.summary}` : "");
    const en = `- ${b.title || "untitled idea"}${marksEn}` + (b.summary ? ` — ${b.summary}` : "");
    return { zh, en };
  });
  const dispatched = rows.filter((_, i) => {
    const b = loose[i];
    return beatImported(timelineEvents, beatEventText(b)) || beatPlantedAsForeshadowing(foreshadowings, b);
  }).length;
  const rowsZh = rows.length ? rows.map((r) => r.zh).join("\n") : "（念头池为空）";
  const rowsEn = rows.length ? rows.map((r) => r.en).join("\n") : "(idea pool is empty)";
  return {
    zh: `【灵感念头池】共 ${loose.length} 条（未分发 ${rows.length - dispatched}）\n${rowsZh}\n（念头=作者手记的灵感收件箱=未落章节拍，脑暴时尊重已有念头的语气与题材；分发去向：挂章/转时间线/转伏笔，标记〔已入…〕的不要重复建议）`,
    en: `[Idea pool] ${loose.length} total (${rows.length - dispatched} undispatched)\n${rowsEn}\n(Ideas = the author's hand-captured inbox = unanchored beats; respect the tone and genre of existing ideas; dispatch = bind to a chapter / timeline draft / foreshadowing draft; do not re-suggest ideas already marked [in …])`,
  };
}

/**
 * 全书「校对体检」语料（双语，纯函数、零迁移）：复用 buildProofreadReport 六组发现，
 * 输出分组计数 + 关键明细（空章/完稿 0 字章/预警伏笔/冲突事件/文本问题章），
 * 供校对题材的 AI 消息自动注入。语义层检查（错别字/连贯性）明确交给 AI 在对话里做。
 */
export function buildProofreadCorpus(
  bookId: string | null,
  chapters: WritingChapter[],
  outlines: WritingOutline[],
  timelineEvents: WritingTimelineEvent[],
  foreshadowings: WritingForeshadowing[],
  storylines: WritingStoryline[] = []
): { zh: string; en: string } {
  void bookId; // 与其他 corpus 同签名惯例：调用方已按书过滤
  const report = buildProofreadReport(chapters, outlines, timelineEvents, foreshadowings, storylines);
  const total = report.issues.length;

  const emptyZh = chapters.filter((c) => !c.content?.trim() && (c.wordCount ?? 0) === 0).map((c) => c.title || "未命名");
  const emptyEn = chapters.filter((c) => !c.content?.trim() && (c.wordCount ?? 0) === 0).map((c) => c.title || "untitled");
  const fin0Zh = chapters.filter((c) => c.status === "finished" && (c.wordCount ?? 0) === 0).map((c) => c.title || "未命名");
  const fin0En = chapters.filter((c) => c.status === "finished" && (c.wordCount ?? 0) === 0).map((c) => c.title || "untitled");
  const overdueZh = foreshadowings.filter((f) => isOverdue(f, chapters)).map((f) => f.title || "未命名");
  const overdueEn = [...overdueZh];
  const conflictTexts = [...computeTimelineConflicts(timelineEvents, { view: "book" })]
    .map((id) => timelineEvents.find((e) => e.id === id)?.event || "")
    .filter(Boolean)
    .slice(0, 8);
  const drafts = timelineEvents.filter((e) => !isComplete(e)).length;
  const unlined = timelineEvents.filter((e) => !e.storylineId).length;
  const loose = looseBeats(outlines);
  const fresh = loose.filter((b) => !beatImported(timelineEvents, beatEventText(b)) && !beatPlantedAsForeshadowing(foreshadowings, b)).length;
  const textIssuesZh = chapters
    .map((c) => ({ title: c.title || "未命名", issues: chapterTextIssues(c) }))
    .filter((x) => x.issues.length > 0)
    .slice(0, 12);

  const linesZh: string[] = [`【校对体检】共 ${total} 项发现`];
  if (textIssuesZh.length > 0) {
    linesZh.push(`〔章文本〕` + textIssuesZh.map((x) => `《${x.title}》(${x.issues.length} 项)`).join("、"));
  }
  if (emptyZh.length > 0) linesZh.push(`〔章账〕空章：${emptyZh.join("、")}`);
  if (fin0Zh.length > 0) linesZh.push(`〔章账〕标记完稿但 0 字：${fin0Zh.join("、")}`);
  if (overdueZh.length > 0) linesZh.push(`〔伏笔〕回收点已过仍未回收：${overdueZh.join("、")}`);
  if (conflictTexts.length > 0) linesZh.push(`〔时间线〕冲突事件：${conflictTexts.join("；")}`);
  if (drafts > 0) linesZh.push(`〔时间线〕待补全草稿 ${drafts} 条`);
  if (unlined > 0) linesZh.push(`〔剧情线〕未挂线事件 ${unlined} 条`);
  if (fresh > 0) linesZh.push(`〔念头池〕未分发念头 ${fresh} 条`);
  if (total === 0) linesZh.push("（体检全绿：暂无本地可派生的发现）");
  linesZh.push("（校对=本地派生软提示，advisory 不强制；错别字/重复用词/连贯性等语义层问题请用 file_read 逐章细读后在回答里指出）");

  const linesEn: string[] = [`[Proofread] ${total} findings`];
  if (textIssuesZh.length > 0) {
    linesEn.push(`[Chapter text] ` + textIssuesZh.map((x) => `"${x.title}" (${x.issues.length})`).join(", "));
  }
  if (emptyEn.length > 0) linesEn.push(`[Chapters] empty: ${emptyEn.join(", ")}`);
  if (fin0En.length > 0) linesEn.push(`[Chapters] marked finished but 0 words: ${fin0En.join(", ")}`);
  if (overdueEn.length > 0) linesEn.push(`[Foreshadowing] payoff overdue: ${overdueEn.join(", ")}`);
  if (conflictTexts.length > 0) linesEn.push(`[Timeline] conflicting events: ${conflictTexts.join("; ")}`);
  if (drafts > 0) linesEn.push(`[Timeline] ${drafts} draft(s) to complete`);
  if (unlined > 0) linesEn.push(`[Storylines] ${unlined} unlined event(s)`);
  if (fresh > 0) linesEn.push(`[Idea pool] ${fresh} undispatched idea(s)`);
  if (total === 0) linesEn.push("(All green: no locally derivable findings)");
  linesEn.push("(Proofread = local derived soft hints, advisory only; for typos / repeated wording / coherence, read chapters via file_read and point them out in your answer)");

  return { zh: linesZh.join("\n"), en: linesEn.join("\n") };
}

/**
 * 全书「写作统计」语料（双语，纯函数、零迁移）：复用 utils/writingStats 的 KPI/卷分布/
 * 章节体量口径，输出体量 KPI + 卷分布 + 离群章（advisory）+ 节奏提示，供统计题材的
 * AI 消息自动注入。日更趋势（Rust 快照）不进语料——异步数据由页签面直接呈现。
 */
export function buildStatsCorpus(
  bookTitle: string | null,
  chapters: WritingChapter[],
  settings: WritingSetting[]
): { zh: string; en: string } {
  const kpis = computeWritingKpis(chapters, settings);
  const volRows = buildVolumeRows(chapters);
  const chRows = buildChapterWordRows(chapters);
  const outliers = chRows.filter((r) => r.outlier !== null);
  const titleZh = bookTitle ? `《${bookTitle}》` : "";
  const titleEn = bookTitle ? `"${bookTitle}"` : "";

  const linesZh: string[] = [
    `【写作统计】${titleZh}总字数 ${kpis.totalWords.toLocaleString()} · 章节 ${kpis.chapterCount} · 卷 ${kpis.volumeCount} · 设定条目 ${kpis.settingCount} · 章均 ${kpis.avgWords} 字`,
  ];
  if (volRows.length > 0) {
    linesZh.push(
      `〔卷分布〕` +
        volRows
          .map((v) => `${v.volume || "未分卷"}：${v.chapters} 章 ${v.finished} 完稿 ${v.words.toLocaleString()} 字`)
          .join("；"),
    );
  }
  if (outliers.length > 0) {
    linesZh.push(
      `〔体量离群〕` +
        outliers
          .slice(0, 10)
          .map((r) => `《${r.title}》${r.outlier === "long" ? "超长" : "偏短"} ${r.words.toLocaleString()} 字`)
          .join("、") +
        "（advisory 仅供参考，可能是刻意的节奏设计）",
    );
  } else {
    linesZh.push("〔体量离群〕无（各章体量均在章均常规区间）");
  }
  linesZh.push("（统计=本地派生软提示；节奏与体量建议尊重创作者意图，advisory 不强制）");

  const linesEn: string[] = [
    `[Writing stats] ${titleEn} total ${kpis.totalWords.toLocaleString()} words · ${kpis.chapterCount} chapters · ${kpis.volumeCount} volumes · ${kpis.settingCount} setting entries · avg ${kpis.avgWords} words/chapter`,
  ];
  if (volRows.length > 0) {
    linesEn.push(
      `[Volume distribution] ` +
        volRows
          .map((v) => `${v.volume || "unfiled"}: ${v.chapters} ch, ${v.finished} finished, ${v.words.toLocaleString()} words`)
          .join("; "),
    );
  }
  if (outliers.length > 0) {
    linesEn.push(
      `[Outliers] ` +
        outliers
          .slice(0, 10)
          .map((r) => `"${r.title}" ${r.outlier === "long" ? "long" : "short"} ${r.words.toLocaleString()} words`)
          .join(", ") +
        " (advisory only; may be deliberate pacing)",
    );
  } else {
    linesEn.push("[Outliers] none (chapter sizes within normal range)");
  }
  linesEn.push("(Stats = local derived soft hints; respect the creator's intent, advisory only)");

  return { zh: linesZh.join("\n"), en: linesEn.join("\n") };
}

/** 把章节 content（TipTap HTML）拍平成纯文本段落（语料注入用，标签噪声不进模型上下文） */
function stripChapterHtml(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 正文写作语料（双语，纯函数、零迁移）：当前激活章全文 + 前情提要（前 2 章各尾部 400 字）
 * + 全书章节骨架。供「写作」题材（正文视图）的 AI 消息自动注入——续写/修改建议
 * 都要有当前章正文与前后文才能作答。无激活章时只给骨架。
 */
export function buildManuscriptCorpus(
  bookTitle: string | null,
  chapters: WritingChapter[],
  activeChapterId: string | null
): { zh: string; en: string } {
  const sorted = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = activeChapterId ? sorted.findIndex((c) => c.id === activeChapterId) : -1;
  const current = idx >= 0 ? sorted[idx] : null;
  const titleZh = bookTitle ? `《${bookTitle}》` : "";
  const titleEn = bookTitle ? `"${bookTitle}"` : "";

  // 章节骨架（限 120 章，防超长书撑爆上下文）
  const skeletonZh = sorted.slice(0, 120).map((c, i) => `${i + 1}. ${c.title || "未命名"} · ${(c.wordCount || 0).toLocaleString()} 字${c.status === "finished" ? " · 完稿" : ""}`);
  const skeletonEn = sorted.slice(0, 120).map((c, i) => `${i + 1}. ${c.title || "untitled"} · ${(c.wordCount || 0).toLocaleString()} words${c.status === "finished" ? " · finished" : ""}`);

  // 前情提要：当前章之前 2 章，各取尾部 400 字
  const prevZh: string[] = [];
  const prevEn: string[] = [];
  if (idx > 0) {
    for (const c of sorted.slice(Math.max(0, idx - 2), idx)) {
      const text = stripChapterHtml(c.content ?? "");
      if (!text) continue;
      prevZh.push(`〔${c.title || "未命名"} 尾段〕…${text.slice(-400)}`);
      prevEn.push(`[${c.title || "untitled" } ending] …${text.slice(-400)}`);
    }
  }

  const linesZh: string[] = [`【正文写作】${titleZh}共 ${sorted.length} 章`];
  linesZh.push("〔章节骨架〕");
  linesZh.push(...skeletonZh);
  if (current) {
    linesZh.push(`〔当前章〕${current.title || "未命名"}（${(current.wordCount || 0).toLocaleString()} 字）`);
    const text = stripChapterHtml(current.content ?? "");
    if (text) linesZh.push(text);
    else linesZh.push("（本章正文为空——新章起步）");
    if (prevZh.length > 0) {
      linesZh.push("〔前情提要〕");
      linesZh.push(...prevZh);
    }
  } else {
    linesZh.push("（当前无激活章节——正文页签未打开章节，按骨架作答即可）");
  }
  linesZh.push("（续写时衔接上文语气与叙事节奏；尊重已有情节，改写建议说清理由，不要整章重写）");

  const linesEn: string[] = [`[Manuscript] ${titleEn} ${sorted.length} chapters`];
  linesEn.push("[Chapter skeleton]");
  linesEn.push(...skeletonEn);
  if (current) {
    linesEn.push(`[Current chapter] ${current.title || "untitled"} (${(current.wordCount || 0).toLocaleString()} words)`);
    const text = stripChapterHtml(current.content ?? "");
    if (text) linesEn.push(text);
    else linesEn.push("(This chapter is empty — fresh start)");
    if (prevEn.length > 0) {
      linesEn.push("[Previously]");
      linesEn.push(...prevEn);
    }
  } else {
    linesEn.push("(No active chapter — manuscript tab has no chapter open; answer from the skeleton)");
  }
  linesEn.push("When continuing, match the voice and pacing above; respect existing plot; give reasons for revision suggestions instead of rewriting whole chapters.");

  return { zh: linesZh.join("\n"), en: linesEn.join("\n") };
}

/**
 * 全书世界观/人物设定一致性审查提示词（双语）。复用 buildWorldBibleCorpus 汇集设定语料，
 * 让 AI 核对：人物能力是否违反核心规则、与例外是否冲突、relations 是否自洽、
 * rules 与 exceptions 是否内部矛盾。纯函数、零迁移，便于单测。
 */
function buildWorldConsistencyPrompt(bookTitle: string, settings: WritingSetting[]): { zh: string; en: string } {
  const corpus = buildWorldBibleCorpus(settings);
  const zh =
    `请作为严谨的「世界观/设定一致性审查」助手，审查小说《${bookTitle}》的设定资料，` +
    `找出人物与世界观设定之间的冲突或矛盾。重点关注：\n` +
    `1. 人物能力/属性是否违反世界观的「核心规则」；\n` +
    `2. 是否存在与「例外/破例」相冲突的设定；\n` +
    `3. 关联关系（relations）是否自洽、是否指向不存在的条目；\n` +
    `4. 同一世界观设定内部 rules 与 exceptions 是否互相矛盾。\n\n` +
    `要求：逐条列出发现的冲突，指明涉及的人物/设定名称与具体字段；若未发现明显冲突，` +
    `也请说明你核对了哪些维度、结论是什么。若没有任何设定资料，请直接说明「暂无设定资料」。\n\n` +
    corpus.zh;
  const en =
    `Act as a rigorous worldbuilding/setting consistency reviewer. Examine the setting material of the novel "${bookTitle}" ` +
    `and find conflicts or contradictions between characters and worldbuilding. Focus on:\n` +
    `1. whether character abilities/traits violate the world's "core rules";\n` +
    `2. whether any setting contradicts its own "exceptions";\n` +
    `3. whether relations are self-consistent and point to existing entries;\n` +
    `4. whether a worldbuilding entry's rules and exceptions contradict each other.\n\n` +
    `List each conflict with the involved character/setting names and specific fields; if none, ` +
    `state what you checked and the conclusion. If there is no setting material at all, say "no setting material".\n\n` +
    corpus.en;
  return { zh, en };
}

export function useWorkbenchChat(deps: { activeFile: WorkbenchActiveFile | null; ctx: ReturnType<typeof useWorkbenchContext>; edits: ReturnType<typeof useWorkbenchEdits> }) {
  const { activeFile, ctx, edits } = deps;

  const agents = useAgentStore((s) => s.agents);
  const conversations = useAgentStore((s) => s.conversations);
  const conversationsLoading = useAgentStore((s) => s.loading.conversations);
  const messages = useAgentStore((s) => s.messages);
  const streamingContent = useAgentStore((s) => s.streamingContent);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const interruptRequested = useAgentStore((s) => s.interruptRequested);
  const stoppedConversationId = useAgentStore((s) => s.stoppedConversationId);
  const toolCalls = useAgentStore((s) => s.toolCalls);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedConversationId = useAgentStore((s) => s.selectedConversationId);
  const currentAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const [historyAnchor, setHistoryAnchor] = useState<null | HTMLElement>(null);
  const [moreAnchorEl, setMoreAnchorEl] = useState<null | HTMLElement>(null);
  // R69：改动卡「已处理（应用/跳过）」状态按会话持久化到 localStorage。
  // 旧实现是纯内存 useState，重载或切会话后丢失 → composersByMsg 从持久化消息正文重新派生全部卡
  // → 已应用/已跳过的卡复位为待应用 → 再次点「应用」会用原始行号在已改动的文件上二次插入/错位。
  // 修复：每个 conversationId 维护一份已处理 key 集合，切会话时载入、变更时落盘。
  const composerSkipKey = (convId: string | null): string | null =>
    convId ? `ps-workbench-composer-skip:${convId}` : null;

  const loadComposerSkip = (convId: string | null): Set<string> => {
    const key = composerSkipKey(convId);
    if (!key) return new Set();
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? (arr as string[]) : []);
    } catch {
      return new Set();
    }
  };

  const saveComposerSkip = (convId: string | null, skip: Set<string>) => {
    const key = composerSkipKey(convId);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify([...skip]));
    } catch {
      // localStorage 不可用/配额满：非致命，内存态仍正确
    }
  };

  const [composerSkip, _setComposerSkip] = useState<Set<string>>(() => loadComposerSkip(selectedConversationId));

  // 当前会话 id 的实时引用，供持久化写入读取，避免回调闭包捕获过期值
  const selectedConversationIdRef = useRef(selectedConversationId);
  selectedConversationIdRef.current = selectedConversationId;

  // 写入即落盘（按当前会话 id）。兼容旧用法：可传 Set 或函数更新器。
  const setComposerSkip = useCallback(
    (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      _setComposerSkip((prev) => {
        const resolved = typeof next === "function" ? (next as (p: Set<string>) => Set<string>)(prev) : next;
        saveComposerSkip(selectedConversationIdRef.current, resolved);
        return resolved;
      });
    },
    [],
  );

  // 切换会话：从 localStorage 载入该会话的已处理集合。用原始 setter 避免回写，
  // 杜绝「把上一会话的集合误写到新会话 key」的竞态。
  useEffect(() => {
    _setComposerSkip(loadComposerSkip(selectedConversationId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId]);

  useEffect(() => {
    ctx.listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, ctx]);

  // 对话后「下一步建议」：最后一条助手消息落定（非流式）后，按其内容 + 当前上下文算出最多 3 条 follow-up。
  // 仅作展示与预填，不自动发送（见 buildFollowups 顶部说明）。流式期间不计算，避免半成品。
  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages],
  );
  const followups = useMemo<FollowupItem[]>(() => {
    if (!lastAssistant || isStreaming) return [];
    const producedCode = parseBlocks(lastAssistant.content).some((n) => n.type === "code");
    return buildFollowups({
      hasActiveFile: !!activeFile,
      relPath: activeFile?.relPath,
      producedCode,
      hasDiagnostics: (ctx.fileDiagnostics?.length ?? 0) > 0,
      hasScope: !!ctx.canvasScope,
      isBookScene: ctx.isBookScene,
      bookTopic: ctx.bookTopic ?? undefined,
    });
  }, [lastAssistant, isStreaming, activeFile, ctx.fileDiagnostics, ctx.canvasScope, ctx.isBookScene]);

  // B 深化（对标 VS Code Copilot Edits）：改动就地长在对话流——每条含代码块的助手消息
  // 都派生自己的改动清单，按 message id 索引，对话里逐条 Accept/Discard。
  // 取代原「仅最新消息挂在顶部」的 composer：改动不再藏在一处，而是贴在它所属的回答下方。
  const composersByMsg = useMemo(() => {
    type ComposerItem = { key: string; meta: CodeBlockMeta; rangeLabel: string; summary: string; cross: boolean };
    const out: Record<string, ComposerItem[]> = {};
    if (!activeFile) return out;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const blocks = parseBlocks(m.content)
        .filter((n) => n.type === "code")
        .map((n) => (n as { meta: CodeBlockMeta }).meta);
      const items: ComposerItem[] = [];
      blocks.forEach((meta, idx) => {
        const targetsActive = !meta.path || meta.path === activeFile.relPath;
        const firstLine = (meta.code.split("\n")[0] ?? "").trim().slice(0, 64);
        const base = meta.path ?? activeFile.relPath;
        const rangeLabel = meta.line ? `${base}:${meta.line}${meta.endLine ? "-" + meta.endLine : ""}` : base;
        items.push({ key: `${m.id}#${idx}`, meta, rangeLabel, summary: firstLine, cross: !targetsActive });
      });
      if (items.length > 0) out[m.id] = items;
    }
    return out;
  }, [messages, activeFile]);

  const historyList = useMemo(() => {
    const aid = selectedAgentId ?? "";
    return conversations
      .filter((c) => c.agentId === aid)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations, selectedAgentId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    ctx.setInput(v);
    ctx.detectHashMention(v, "chat");
    ctx.detectSlashCommand(v, "chat");
  };

  const citeIntoInput = (text: string) => {
    const append = (v: string) => (v ? v + "\n\n" : "") + text;
    if (ctx.view === "edits") ctx.setEditInput(append);
    else ctx.setInput(append);
  };

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    ctx.setEditInput(v);
    ctx.detectHashMention(v, "edits");
    ctx.detectSlashCommand(v, "edits");
  };

  const applyAllForMsg = useCallback(
    async (msgId: string) => {
      const ed = ctx.inputRef.current;
      if (!ed) {
        useToastStore.getState().showToast(t("workbench.aiApply.composerNeedEditor"), "info");
        return;
      }
      const items = composersByMsg[msgId];
      if (!items) return;
      const visible = items.filter((it) => !composerSkip.has(it.key));
      const activeItems = visible.filter((it) => !it.cross).sort((a, b) => (a.meta.line ?? 0) - (b.meta.line ?? 0));
      const crossItems = visible.filter((it) => it.cross);
      let delta = 0;
      let n = 0;
      for (const it of activeItems) {
        const meta = it.meta;
        const adjusted: CodeBlockMeta =
          meta.line != null
            ? { ...meta, line: meta.line + delta, endLine: meta.endLine != null ? meta.endLine + delta : undefined }
            : meta;
        if (edits.applyInlineDirect(adjusted)) {
          n++;
          if (ctx.activeFile) ctx.armVerify(ctx.activeFile.fileId, ctx.activeFile.relPath);
          if (meta.line != null) {
            const added = meta.code.split("\n").length;
            const removed = meta.endLine != null ? meta.endLine - meta.line + 1 : 0;
            delta += added - removed;
          }
          setComposerSkip((s) => new Set(s).add(it.key));
        }
      }
      for (const it of crossItems) {
        if (await edits.applyCrossFileDirect(it.meta)) {
          n++;
          const crossFid = ctx.files.find((f) => f.relPath === it.meta.path)?.id;
          if (crossFid && it.meta.path) ctx.armVerify(crossFid, it.meta.path);
          setComposerSkip((s) => new Set(s).add(it.key));
        }
      }
      if (n > 0) {
        useToastStore.getState().showToast(t("workbench.aiApply.composerApplied", { n }), "success");
      }
    },
    [composersByMsg, composerSkip, edits, ctx],
  );

  // ── 消息级操作（对标 VS Code Copilot Chat 的气泡悬浮工具条）──
  //
  // 为什么必须做「先截断再重跑」：run_agent 由后端落库（用户消息 + 助手回复各一行）。
  // 若只是把同一句再发一遍，会话里会留两份同样的请求，模型下一轮读到重复对话、
  // 转录也越滚越脏。所以重试/编辑重发都先删掉旧的那一轮（truncateMessagesFrom），再发。
  //
  // 破坏面刻意限制在**最后一轮**（面板只在最后一条助手/用户消息上渲染按钮）：
  // 中间某条重试会连带删掉后面所有对话，那种「静默丢历史」不值得为了对齐而做。
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return messages[i].id;
    return null;
  }, [messages]);
  const lastUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].id;
    return null;
  }, [messages]);

  /** 重试：删掉「最后一次用户请求 + 它的回答」，用**原始正文**（含当轮上下文）重跑一次 */
  const retryLastTurn = useCallback(async () => {
    if (isStreaming) return;
    const convId = selectedConversationId;
    if (!convId) return;
    let userIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    const target = messages[userIdx];
    try {
      const first = await useAgentStore.getState().truncateMessagesFrom(target.id);
      const content = first?.content ?? target.content;
      // 原始正文已经是 buildUserMessage 拼好的完整提示词，直接重发，
      // 保证「重试」重跑的是同一个请求，而不是被当前上下文改写过的另一个请求。
      await useAgentStore.getState().sendMessage(convId, content, WORKBENCH_MODE_TOOLS[ctx.mode], ctx.selectedModelId || null);
    } catch {
      useToastStore.getState().showToast(t("workbench.aiMsgAction.retryFailed"), "error");
    }
  }, [isStreaming, selectedConversationId, messages, ctx.mode, ctx.selectedModelId]);

  /** 编辑重发：删掉最后一轮，把用户那句**人读正文**回填输入框，用户改完自己按发送 */
  const editLastRequest = useCallback(async () => {
    if (isStreaming || !lastUserId) return;
    const target = messages.find((m) => m.id === lastUserId);
    if (!target) return;
    const humanText = extractUserMessageView(target.content).text;
    try {
      await useAgentStore.getState().truncateMessagesFrom(target.id);
    } catch {
      useToastStore.getState().showToast(t("workbench.aiMsgAction.editFailed"), "error");
      return;
    }
    ctx.setInput(humanText);
    ctx.inputRef.current?.focus();
  }, [isStreaming, lastUserId, messages, ctx]);

  /** 复制消息正文：助手消息复制原文，用户消息只复制自己打的那句（不含机器提示词） */
  const copyMessage = useCallback(async (msgId: string) => {
    const m = messages.find((x) => x.id === msgId);
    if (!m) return;
    const text = m.role === "user" ? extractUserMessageView(m.content).text : m.content;
    try {
      await navigator.clipboard.writeText(text);
      useToastStore.getState().showToast(t("workbench.aiMsgAction.copied"), "success");
    } catch {
      useToastStore.getState().showToast(t("workbench.aiMsgAction.copyFailed"), "error");
    }
  }, [messages]);

  const skipComposerItem = useCallback((key: string) => {
    setComposerSkip((s) => new Set(s).add(key));
  }, []);
  const skipAllForMsg = useCallback(
    (msgId: string) => {
      const items = composersByMsg[msgId];
      if (!items) return;
      setComposerSkip((s) => {
        const next = new Set(s);
        for (const it of items) next.add(it.key);
        return next;
      });
    },
    [composersByMsg],
  );

  return {
    agents,
    conversations,
    conversationsLoading,
    messages,
    streamingContent,
    isStreaming,
    interruptRequested,
    stoppedConversationId,
    toolCalls,
    selectedAgentId,
    selectedConversationId,
    currentAgent,
    historyAnchor,
    setHistoryAnchor,
    moreAnchorEl,
    setMoreAnchorEl,
    handleInputChange,
    handleEditInputChange,
    citeIntoInput,
    composersByMsg,
    composerSkip,
    setComposerSkip,
    skipComposerItem,
    applyAllForMsg,
    skipAllForMsg,
    historyList,
    followups,
    lastAssistantId,
    lastUserId,
    retryLastTurn,
    editLastRequest,
    copyMessage,
  };
}
