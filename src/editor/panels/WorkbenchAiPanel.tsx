// project-sight: 工作台 AI 面板（对标 VS Code Copilot Chat 侧栏）
//
// 设计立场（见 docs/代码工作台-AI面板重构-复盘与设计.md）：交互形态对齐 VS Code，
// 上下文能力用我们的扫描台账压过它。本组件为**全新组件**，不改动分析页的 AiAgentPanel
// （零回归）。所有对话仍走既有 agentStore（同一后端、同一套会话/流式），只重写「上下文接入」
// 与「改动落地」两条链路——这正是原实现缺失的。
//
// 已落地能力：
//  - 隐式上下文：当前文件 + 选区每次发消息自动进 prompt（不再依赖恰好点了某个 chip）
//  - 上下文芯片：当前文件 / 选区可见，#file / #symbol 附件可增删
//  - 单一模式下拉（问答 / 直接改 / 代理）对标 VS Code Copilot Chat：取消独立的「对话 / 改动」双 Tab，
//    对话始终是主轴，改动台账 / 验证 / 改动工作台引导 / 作用域建议内联在流里（见 Round63 重新设计）。
//  - 三档模式 Ask / Edit / Agent：以 prompt 指令约束（后端单次工具白名单归 P2）
//  - 斜杠命令 / # 附件选择器
//  - markdown 渲染 + 代码块卡片（复制 / 插入光标 / 应用到文件，diff 预览后落盘）
//  - 配置移出聊天侧栏（仅留「打开 AI 设置」入口），宽度可拖拽并记忆
//  - 线程连续：快捷动作追加到当前会话，只有「新对话」才开线程
//  - 改动后自动验证（P2-4）+ 本轮改动总账（跨多文件会话级聚合，量化「复杂度↓X 死代码↓Y」，VS Code 没有的闭环汇总）
//  - 分析上下文栏（可折叠）只承载参考型上下文：附件、影响面、洞察、# 提及；栏内动作落到当前输入框（citeIntoInput），
//    # 提及按来源回清 #token（hashMention 仍记 "chat" | "edits" 兼容遗留）。对话流为唯一渲染分支。

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import SettingsIcon from "@mui/icons-material/Settings";
import LinkIcon from "@mui/icons-material/Link";
import CodeIcon from "@mui/icons-material/Code";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlined";
import AssessmentIcon from "@mui/icons-material/Assessment";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import HistoryIcon from "@mui/icons-material/History";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CheckIcon from "@mui/icons-material/Check";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import HubIcon from "@mui/icons-material/Hub";
import LayersIcon from "@mui/icons-material/Layers";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditIcon from "@mui/icons-material/Edit";
import { useTheme } from "@mui/material/styles";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import { t } from "../../i18n";
import { L } from "../../ai/aiLang";
import { computeVerifyMarks } from "../../ai/verifyOverlay";
import { useAgentStore } from "../../store/agentStore";
import { useToastStore } from "../../store/toastStore";
import { useVerifyOverlayStore } from "../../store/verifyOverlayStore";
import { useEditorDiagnosticsStore, type EditorDiagnostic } from "../../store/editorDiagnosticsStore";
import { broadcastVerify } from "../useVerifyOverlaySync";
import { broadcastImpact } from "../useImpactOverlaySync";
import { projectScanApi, aiContextApi, agentApi, parseFileMetricMeta, type ProjectFile, type ProjectSymbol, type AiInsightDto, type CallEdge, type AiModel } from "../../services/tauri";
import { monacoLanguageOf } from "../../utils/languageMeta";
import type { EditorSelectionInfo, MonacoEditorHandle } from "./MonacoCodeEditor";
import {
  buildUserMessage,
  type WorkbenchMode,
  type WorkbenchContext,
  type WorkbenchContextFacts,
  type WorkbenchContextDiagnostic,
  type ContextAttachment,
  type WorkspaceFacts,
  WORKBENCH_MODES,
  WORKBENCH_MODE_TOOLS,
} from "./workbenchContext";
import { MarkdownView, parseBlocks, type CodeBlockMeta } from "./aiMarkdown";
import { ToolStepList, parseToolTrace } from "./aiToolSteps";
import { UserMessageBubble } from "./aiUserMessage";
import { parseSlashCommand } from "./workbenchSlashCommands";
import { ChangeReviewBar } from "./ChangeReviewBar";
import { AI_SCOPE_EVENT, type AiScopePayload } from "../utils/canvasWorkbenchLink";
// 纯展示组件与工具函数（已从本文件拆出，见 workbenchComponents.tsx）
import {
  fuzzyScore,
  relTime,
  snapshotFileFacts,
  factsSig,
  modeLabel,
  VerifySection,
  ImpactSurfaceBlock,
  DiagnosticsStrip,
  WorkbenchInputBar,
  type FileFacts,
  type VerifyEntry,
} from "./workbenchComponents";
import { useWorkbenchContext, useWorkbenchEdits, useWorkbenchChat } from "./workbenchPanelHooks";
export { computeApplyDiff, computeInlineEdit } from "./workbenchPanelHooks";

const DiffEditorLazy = lazy(async () => {
  await import("./monacoSetup");
  const m = await import("@monaco-editor/react");
  return { default: m.DiffEditor };
});

export interface WorkbenchAiPanelProps {
  activeFile: {
    fileId: string;
    relPath: string;
    language: string | null;
    name: string;
    totalLines?: number;
  } | null;
  selection: EditorSelectionInfo | null;
  editorRef: React.MutableRefObject<MonacoEditorHandle | null>;
  onClose: () => void;
  /**
   * 打开某个相对路径（并可跳到指定行）。改动评审列表点击文件名时用：
   * AI 改的往往不是当前打开的那个文件，没有这个能力，评审只能看不能查。
   */
  onOpenPath?: (relPath: string, line?: number) => void;
  /**
   * 需求分析面板里的「AI 协助」芯片点击后，由代码工作台 dock 注入的预填提示词。
   * 仅作一次性消费：面板挂载/变化时若非空，写入输入框并回调 onConsumeInitialPrompt 清空，
   * 避免重复触发。这是「业务面板 → AI 面板」的单向触发，AI 面板本身不承载业务功能。
   */
  initialPrompt?: string | null;
  onConsumeInitialPrompt?: () => void;
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

interface MessageChangeItem {
  key: string;
  meta: CodeBlockMeta;
  rangeLabel: string;
  summary: string;
  cross: boolean;
}

/**
 * 单条助手消息下方的「改动卡」（B 深化，对标 VS Code Copilot Edits）：
 * 这条回答提议的所有代码改动（path:line 锚点补丁）逐条列出，用户就地 Accept（编辑器红/绿预览）
 * 或 Discard（跳过）。改动与它的回答绑定在一起，不再藏在顶部的独立清单里。
 */
function MessageChangeCard({
  items,
  onApplyOne,
  onSkip,
  onApplyAll,
  onSkipAll,
}: {
  items: MessageChangeItem[];
  onApplyOne: (it: MessageChangeItem) => void;
  onSkip: (key: string) => void;
  onApplyAll: () => void;
  onSkipAll: () => void;
}) {
  const cardDark = useTheme().palette.mode === "dark";
  const [open, setOpen] = useState(true);
  return (
    <Box
      sx={{
        width: "94%",
        mt: 0.5,
        borderRadius: 1,
        border: 1,
        borderColor: "divider",
        bgcolor: cardDark ? "rgba(25,118,210,0.06)" : "rgba(25,118,210,0.04)",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.4 }}>
        <IconButton size="small" onClick={() => setOpen((v) => !v)} sx={{ p: 0.25 }}>
          {open ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
        </IconButton>
        <AssessmentIcon sx={{ fontSize: 15, color: "primary.main" }} />
        <Typography variant="caption" sx={{ flex: 1, fontSize: 10.5, fontWeight: 600, color: "text.primary" }}>
          {t("workbench.aiApply.composerTitle", { n: items.length })}
        </Typography>
        <Button size="small" variant="contained" color="primary" onClick={onApplyAll} sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}>
          {t("workbench.aiApply.composerApplyAll")}
        </Button>
        <Button size="small" color="inherit" onClick={onSkipAll} sx={{ fontSize: 10, minWidth: 0, px: 0.5, py: 0 }}>
          {t("workbench.aiApply.composerSkipAll")}
        </Button>
      </Box>
      {open && (
        <Box sx={{ px: 1, pb: 0.6, maxHeight: 200, overflow: "auto" }}>
          {items.map((it) => (
            <Box
              key={it.key}
              sx={{ display: "flex", alignItems: "center", gap: 0.5, py: 0.25, borderTop: "1px dashed", borderColor: "divider" }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {it.cross && (
                    <Chip size="small" label={t("workbench.aiApply.composerCrossTag")} color="warning" sx={{ height: 15, fontSize: 8.5 }} />
                  )}
                  <Typography variant="caption" sx={{ display: "block", fontSize: 10, color: it.cross ? "warning.main" : "primary.main", fontWeight: 600 }}>{it.rangeLabel}</Typography>
                </Box>
                <Typography variant="caption" sx={{ display: "block", fontSize: 10, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {it.summary || t("workbench.aiApply.composerNoSummary")}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={() => onApplyOne(it)}
                sx={{ fontSize: 9.5, minWidth: 0, px: 0.5, py: 0, lineHeight: 1.4 }}
              >
                {t("workbench.aiApply.composerApplyOne")}
              </Button>
              <IconButton size="small" onClick={() => onSkip(it.key)} sx={{ p: 0.25 }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
          {items.some((it) => it.cross) && (
            <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontSize: 9.5, color: "text.secondary" }}>
              {t("workbench.aiApply.composerCrossNote")}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * 消息悬浮工具条（R68，对标 VS Code Copilot Chat 的气泡 hover actions）。
 *
 * VS Code 里每条消息都能就地「复制 / 重试 / 编辑重发」，这是聊天转录之所以像 IDE 面板
 * 而不像聊天机器人的关键一环：答错了不用重新打一遍字，问错了不用新开一轮。
 *
 * 设计约束（刻意保守）：
 *  - 重试只挂**最后一条助手消息**、编辑重发只挂**最后一条用户消息**——中间某条重试要连带
 *    删掉后面全部对话，那种静默丢历史不值得为对齐而做。
 *  - 复制对所有消息开放（纯读，无破坏面）。
 *  - 流式期间全部禁用（后端正在写库，截断会与落库竞争）。
 *  - 默认半透明，hover 才亮起：不抢转录的视觉主位。
 */
function MessageActions({
  role,
  canRetry,
  canEdit,
  disabled,
  onCopy,
  onRetry,
  onEdit,
}: {
  role: "user" | "assistant";
  canRetry: boolean;
  canEdit: boolean;
  disabled: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onEdit: () => void;
}) {
  return (
    <Box
      className="ps-msg-actions"
      sx={{
        display: "flex",
        gap: 0.15,
        mt: 0.15,
        opacity: 0,
        transition: "opacity 120ms",
        justifyContent: role === "user" ? "flex-end" : "flex-start",
      }}
    >
      <Tooltip title={t("workbench.aiMsgAction.copy")}>
        <IconButton size="small" onClick={onCopy} sx={{ p: 0.25 }}>
          <ContentCopyIcon sx={{ fontSize: 13, color: "text.disabled" }} />
        </IconButton>
      </Tooltip>
      {canEdit && (
        <Tooltip title={t("workbench.aiMsgAction.edit")}>
          <IconButton size="small" onClick={onEdit} disabled={disabled} sx={{ p: 0.25 }}>
            <EditIcon sx={{ fontSize: 13, color: "text.disabled" }} />
          </IconButton>
        </Tooltip>
      )}
      {canRetry && (
        <Tooltip title={t("workbench.aiMsgAction.retry")}>
          <IconButton size="small" onClick={onRetry} disabled={disabled} sx={{ p: 0.25 }}>
            <RefreshIcon sx={{ fontSize: 13, color: "text.disabled" }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

// 开箱即用引导（R66，收口 R62 差距 D「没配 Agent 即死面板」）：
// 无助手时给明确配置入口；有助手但空会话时给起步示例，让右侧面板「打开即用」而非空白死寂。
const STARTER_PROMPTS = [
  { key: "explain", labelKey: "workbench.aiStarter.explain", prompt: L("解释当前文件的作用、结构与关键逻辑", "Explain this file's purpose, structure, and key logic") },
  { key: "fix", labelKey: "workbench.aiStarter.fix", prompt: L("修复当前文件里的报错", "Fix the errors reported in the current file") },
  { key: "refactor", labelKey: "workbench.aiStarter.refactor", prompt: L("重构当前选中的代码，提升可读性与可维护性", "Refactor the selected code to improve readability and maintainability") },
  { key: "tests", labelKey: "workbench.aiStarter.tests", prompt: L("为当前选中的代码编写单元测试", "Write unit tests for the selected code") },
];

// 需求分析引导起步 Chip 已迁至独立「需求分析」业务面板（RequirementsPanel），
// AI 面板模式下拉回归纯 ask / edit / agent，不再承载业务功能。

export function WorkbenchAiPanel({ activeFile, selection, editorRef, onClose, onOpenPath, initialPrompt, onConsumeInitialPrompt }: WorkbenchAiPanelProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";

  const ctx = useWorkbenchContext({ activeFile, selection, editorRef, onOpenPath });
  const edits = useWorkbenchEdits({ activeFile, selection, editorRef, onOpenPath, ctx });
  const chat = useWorkbenchChat({ activeFile, ctx, edits });
  const {
    mode, setMode, attachments, setAttachments,
    input, setInput, slashAnchor, setSlashAnchor, slashQuery, setSlashQuery, slashTarget, setSlashTarget,
    attachOpen, setAttachOpen, attachQuery, setAttachQuery, hashMention, setHashMention,
    workspaceFacts, insights, insightsLoading, insightsOpen, setInsightsOpen,
    impactCanvasOn, setImpactCanvasOn, pendingSuggestion, setPendingSuggestion,
    contextOpen, setContextOpen, canvasScope, view, setView, editInput, setEditInput,
    queued, setQueued, verifyList, verifySettled, dismissVerify, toggleVerifyCanvas, handleAppliedChange,
    inputRef, editInputRef, listEndRef, attachCandidates, addAttachment,
    detectHashMention, detectSlashCommand, canApply, send, submitInput,
    quickAction, fixErrors, fileDiagnostics, factsLabel, scopeFacts, scopeSuggestions,
    impactFiles, fileInsights, contextSig, showContextBar, armVerify, facts, files,
  } = ctx;

  // 需求分析面板「AI 协助」芯片注入的预填提示词：一次性消费，避免重复触发。
  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      onConsumeInitialPrompt?.();
    }
  }, [initialPrompt, setInput, onConsumeInitialPrompt]);
  const {
    diff, setDiff, pendingInline, rejectInline, acceptInline, onCodeInsert, onCodeApply,
    applyCrossFileDirect, applyInlineDirect, applyDiff,
  } = edits;
  const {
    agents, conversations, conversationsLoading, messages, streamingContent, isStreaming,
    interruptRequested, stoppedConversationId, toolCalls, selectedAgentId, selectedConversationId,
    currentAgent, historyAnchor, setHistoryAnchor, moreAnchorEl, setMoreAnchorEl,
    handleInputChange, handleEditInputChange, citeIntoInput, composersByMsg,
    composerSkip, setComposerSkip, skipComposerItem, applyAllForMsg, skipAllForMsg,
    historyList, followups,
    lastAssistantId, lastUserId, retryLastTurn, editLastRequest, copyMessage,
  } = chat;

  // 高危工具审批（human-in-the-loop）：引擎即将执行 run_command 前推审批请求，这里弹确认框。
  const pendingToolApproval = useAgentStore((s) => s.pendingToolApproval);
  const resolveToolApproval = useAgentStore((s) => s.resolveToolApproval);
  // 模型归属（endpoint · provider）：运行时要选的模型能一眼看出属于哪个端点/供应商，
  // 多个供应商都有同名模型（如都叫 "gpt-4o"）时可区分，避免选错端点把调用打到错误的 base_url/api_key。
  const endpoints = useAgentStore((s) => s.endpoints);
  const providers = useAgentStore((s) => s.providers);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const loadEndpoints = useAgentStore((s) => s.loadEndpoints);
  const loadProviders = useAgentStore((s) => s.loadProviders);
  useEffect(() => {
    if (endpoints.length === 0) void loadEndpoints();
    if (providers.length === 0) void loadProviders();
  }, [endpoints.length, providers.length, loadEndpoints, loadProviders]);
  // 模型归属（endpoint · provider）已下沉到 WorkbenchInputBar 内现算；此处仅负责加载 endpoints/providers 数据。
  // ── 渲染 ──
  return (
    <Box
      sx={{
        // 关键：面板必须撑满挂载容器的确定高度（两处父级均为 flex:1 + minHeight:0），
        // 否则面板按内容高度撑开、消息列表 flex:1 无可比较高度而整体撑高，导致底部输入栏被推到消息下方、滚走看不见。
        // 拿到确定高度后，消息列表（flex:1 + overflow:auto）成为唯一滚动区，输入栏自然固定在底部。
        height: "100%",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* 拖拽手柄已上移到代码工作台右侧 dock（整块共享宽度与拖拽），本面板只填充 dock 内部 */}

      {/* 头部：标题 + 更多 + 关闭（助手选择已下沉到底部输入条，与输入框同行对齐，见 WorkbenchInputBar） */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <SmartToyIcon sx={{ fontSize: 16, color: "primary.main", flexShrink: 0 }} />
        <Typography variant="caption" sx={{ fontWeight: 700, flexShrink: 0 }}>{t("workbench.aiPanelTitle")}</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t("workbench.aiMore.label")}>
          <IconButton size="small" onClick={(e) => setMoreAnchorEl(e.currentTarget)}>
            <MoreVertIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Box>

      {/* 头部「更多」菜单（对标 VS Code Copilot Chat 顶栏的「…」：把历史/新对话等低频操作收进一处，
          头部不再并列 5 个控件，只留 标题 + 助手选择 + 更多 + 关闭，对齐 VS Code 信息架构） */}
      <Menu
        anchorEl={moreAnchorEl}
        open={!!moreAnchorEl}
        onClose={() => setMoreAnchorEl(null)}
        sx={{ "& .MuiMenu-paper": { minWidth: 184 } }}
      >
        <MenuItem
          onClick={() => {
            useAgentStore.getState().selectConversation(null);
            setMoreAnchorEl(null);
          }}
          sx={{ fontSize: 11, gap: 0.75 }}
        >
          <AddIcon sx={{ fontSize: 15 }} />
          {t("workbench.aiMore.newChat")}
        </MenuItem>
        <MenuItem
          disabled={agents.length === 0}
          onClick={() => {
            const el = moreAnchorEl;
            setMoreAnchorEl(null);
            const aid = useAgentStore.getState().selectedAgentId;
            if (aid) void useAgentStore.getState().loadConversations(aid);
            setHistoryAnchor(el);
          }}
          sx={{ fontSize: 11, gap: 0.75 }}
        >
          <HistoryIcon sx={{ fontSize: 15 }} />
          {t("workbench.aiMore.history")}
        </MenuItem>
      </Menu>

      {/* 对话历史菜单（对标 VS Code Copilot Chat 的「浏览历史对话」）：列出当前 Agent 的会话，
          点击切回；当前会话高亮标记。后端 listConversations 已持久化，刷新/重开不丢。 */}
      <Menu
        anchorEl={historyAnchor}
        open={!!historyAnchor}
        onClose={() => setHistoryAnchor(null)}
        sx={{ "& .MuiMenu-paper": { maxHeight: 320, minWidth: 224 } }}
      >
        {conversationsLoading ? (
          <MenuItem disabled sx={{ fontSize: 11, gap: 0.5 }}>
            <CircularProgress size={12} />
            {t("workbench.aiThread.loading")}
          </MenuItem>
        ) : historyList.length === 0 ? (
          <MenuItem disabled sx={{ fontSize: 11 }}>{t("workbench.aiThread.historyEmpty")}</MenuItem>
        ) : (
          historyList.map((c) => (
            <MenuItem
              key={c.id}
              selected={c.id === selectedConversationId}
              onClick={() => {
                useAgentStore.getState().selectConversation(c.id);
                setHistoryAnchor(null);
              }}
              sx={{ fontSize: 11, gap: 0.5, alignItems: "flex-start", py: 0.75 }}
            >
              {c.id === selectedConversationId ? (
                <CheckIcon sx={{ fontSize: 14, color: "primary.main", flexShrink: 0, mt: 0.25 }} />
              ) : (
                <Box sx={{ width: 14, flexShrink: 0 }} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: c.id === selectedConversationId ? 700 : 400,
                    color: "text.primary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.title}
                  {c.id === selectedConversationId ? ` ${t("workbench.aiThread.current")}` : ""}
                </Typography>
                <Typography variant="caption" sx={{ display: "block", fontSize: 9.5, color: "text.secondary" }}>
                  {relTime(c.updatedAt)}
                </Typography>
              </Box>
            </MenuItem>
          ))
        )}
      </Menu>

      {/* 顶部工具栏（单行）：单一模式下拉（对标 VS Code Copilot 的 Chat/Edits/Agent 模式选择），
          合并原「视图 Chat/Edits 切换」+「模式 Ask/Edit/Agent chips」两套正交控件为 1 个控件——
          VS Code 正是用「一个模式下拉」同时承担「看对话」与「直接改」，而非两套并列。
          改动（台账/验证）不再独立 Tab，而是内联在对话流里（见下方 body）；选 edit 模式时强制 view=chat，
          保证对话始终是主轴、改动就地长在对话下。 */}
      <Box sx={{ display: "flex", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", alignItems: "center" }}>
        <FormControl size="small" sx={{ minWidth: 116 }}>
          <Select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as WorkbenchMode;
              setMode(m);
              // 统一为对话流渲染：无论选哪个模式，对话都是主轴（改动内联其中），不再切到隐藏对话的独立 Tab
              setView("chat");
            }}
            sx={{ fontSize: 11, height: 26 }}
            displayEmpty
            renderValue={(v) => (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <AutoAwesomeIcon sx={{ fontSize: 13, color: "primary.main" }} />
                <span>{modeLabel(v as WorkbenchMode)}</span>
              </Box>
            )}
          >
            {WORKBENCH_MODES.map((m) => (
              <Tooltip key={m} title={t(`workbench.aiMode.${m}`)}>
                <MenuItem value={m} sx={{ fontSize: 11 }}>{modeLabel(m)}</MenuItem>
              </Tooltip>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* 分析上下文栏（D 收口）：参考型上下文收进一条可折叠栏，聊天区成为英雄，对齐 VS Code「上下文紧贴输入、默认收起」范式。
          位置刻意放在视图分支**之外**——对话/改动两视图共用同一条栏。此前整段嵌在 chat 分支内，
          切到改动视图后附件仍被 send 注入 prompt 却看不见也删不掉（不可见的隐式状态），是两视图最大的体感断层。 */}
      {showContextBar && (
        <Box>
          <Box
            onClick={() => setContextOpen((v) => !v)}
            sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, cursor: "pointer", borderBottom: 1, borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}
          >
            <LayersIcon sx={{ fontSize: 14, color: "primary.main", flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, color: "text.primary" }}>{t("workbench.aiContextBar.title")}</Typography>
            <Chip size="small" label={t("workbench.aiContextBar.count", { n: contextSig })} sx={{ fontSize: 8.5, height: 16, "& .MuiChip-label": { px: 0.5 } }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                {activeFile ? activeFile.relPath : t("workbench.aiContextBar.noFile")}
                {canvasScope ? ` · ${canvasScope.label}` : ""}
                {impactFiles.length > 0 ? ` · ${t("workbench.aiContextBar.impact", { n: impactFiles.length })}` : ""}
                {fileInsights.length > 0 ? ` · ${t("workbench.aiContextBar.insights", { n: fileInsights.length })}` : ""}
              </Typography>
            </Box>
            {contextOpen ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
          </Box>
          {contextOpen && (
            <Box sx={{ pb: 0.5 }}>
      {/* 上下文芯片行 */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", maxHeight: 64, overflow: "auto" }}>
        {activeFile && (
          <Chip size="small" icon={<CodeIcon sx={{ fontSize: 13 }} />} label={activeFile.relPath} sx={{ fontSize: 10, height: 22, maxWidth: 220 }} />
        )}
        {/* 画布作用域芯片（VS Code 没有的维度）：点击把画布重新居中到该实体。
            次级色与「当前文件」芯片区分——它代表「用户在画布上看的」，可能不同于编辑器打开的。 */}
        {canvasScope && (
          <Tooltip title={t("workbench.aiScope.focusTip")}>
            <Chip
              size="small"
              color="secondary"
              icon={<LinkIcon sx={{ fontSize: 13 }} />}
              label={t("workbench.aiScope.label", { label: canvasScope.label })}
              onClick={() => void emit("workbench-focus-canvas", { fileId: canvasScope.fileId })}
              sx={{ fontSize: 10, height: 22, maxWidth: 200 }}
            />
          </Tooltip>
        )}
        {selection?.text && (
          <Chip size="small" color="info" label={t("workbench.aiContext.selection", { start: selection.startLine, end: selection.endLine })} sx={{ fontSize: 10, height: 22 }} />
        )}
        {facts && factsLabel && (
          <Tooltip title={t("workbench.aiFacts.title")}>
            <Chip size="small" icon={<AssessmentIcon sx={{ fontSize: 13 }} />} color="warning" label={factsLabel} sx={{ fontSize: 10, height: 22, maxWidth: 220 }} />
          </Tooltip>
        )}
        {attachments.map((a, i) => (
          <Chip
            key={`${a.refPath}-${a.symbolName ?? i}`}
            size="small"
            icon={a.kind === "symbol" ? <LinkIcon sx={{ fontSize: 13 }} /> : <CodeIcon sx={{ fontSize: 13 }} />}
            label={a.kind === "symbol" ? `${a.symbolName}` : a.label}
            onDelete={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
            sx={{ fontSize: 10, height: 22, maxWidth: 180 }}
          />
        ))}
        <Chip size="small" clickable icon={<AddIcon sx={{ fontSize: 13 }} />} label={t("workbench.aiContext.attach")} onClick={() => setAttachOpen((v) => !v)} sx={{ fontSize: 10, height: 22, borderStyle: "dashed" }} />
      </Box>

      {/* 作用域级影响面（比 VS Code 更强）：聚焦实体后，按调用图算出改它会波及哪些文件 */}
      <ImpactSurfaceBlock files={impactFiles} onOpenPath={onOpenPath} enabled={impactCanvasOn} onToggle={setImpactCanvasOn} />

      {/* # 附件选择器 */}
      {attachOpen && (
        <Box sx={{ borderBottom: 1, borderColor: "divider", maxHeight: 180, overflow: "auto", bgcolor: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
          <Box sx={{ p: 0.5 }}>
            <TextField
              size="small"
              autoFocus
              fullWidth
              placeholder={t("workbench.aiAttach.placeholder")}
              value={attachQuery}
              onChange={(e) => setAttachQuery(e.target.value)}
              sx={{ "& .MuiInputBase-root": { fontSize: 11, height: 28 } }}
            />
          </Box>
          {attachCandidates.length === 0 ? (
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1, py: 0.5 }}>{t("workbench.aiAttach.empty")}</Typography>
          ) : (
            attachCandidates.map((c, i) => (
              <Box
                key={`${c.type}-${c.relPath}-${c.symbolName ?? i}`}
                onClick={() => addAttachment(c)}
                sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.4, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <CodeIcon sx={{ fontSize: 13, color: "text.secondary", flexShrink: 0 }} />
                <Typography variant="caption" sx={{ flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.type === "symbol" ? `${c.symbolName} · ${c.relPath}:${c.line}` : c.relPath}
                </Typography>
              </Box>
            ))
          )}
        </Box>
      )}

      {/* 本文件相关洞察（差异化：复用分析页既有结论，VS Code 没有） */}
      {activeFile && (fileInsights.length > 0 || insightsLoading) && (
        <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
          <Box
            onClick={() => setInsightsOpen((v) => !v)}
            sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
          >
            <LightbulbIcon sx={{ fontSize: 14, color: "warning.main", flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, flex: 1 }}>
              {insightsLoading
                ? t("workbench.aiInsights.loading")
                : t("workbench.aiInsights.title", { n: fileInsights.length })}
            </Typography>
            {insightsLoading
              ? <CircularProgress size={11} />
              : (insightsOpen ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />)}
          </Box>
          {insightsOpen && (
            <Box sx={{ maxHeight: 200, overflow: "auto", pb: 0.5 }}>
              {fileInsights.map((it) => (
                <Box key={it.id} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, px: 1, py: 0.4, borderTop: 1, borderColor: "divider" }}>
                  <Box
                    sx={{
                      width: 6, height: 6, borderRadius: "50%", mt: 0.7, flexShrink: 0,
                      bgcolor: it.severity === "high" || it.severity === "critical" ? "error.main" : it.severity === "medium" ? "warning.main" : "info.main",
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" sx={{ display: "block", fontSize: 11, fontWeight: 600, color: "text.primary", lineHeight: 1.4 }}>{it.title}</Typography>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.25, alignItems: "center" }}>
                      {it.freshness === "stale" && <Chip size="small" label={t("workbench.aiInsights.stale")} color="warning" sx={{ height: 16, fontSize: 8.5 }} />}
                      {it.status === "resolved" && <Chip size="small" label={t("workbench.aiInsights.resolved")} color="default" sx={{ height: 16, fontSize: 8.5 }} />}
                      {it.seenCount && it.seenCount > 1 && <Chip size="small" label={t("workbench.aiInsights.confirmed", { n: it.seenCount })} color="success" sx={{ height: 16, fontSize: 8.5 }} />}
                      <Box sx={{ flex: 1 }} />
                      {/* 引用必须落到「当前视图那个输入框」：本栏已跨视图共用，若恒定写 setInput，
                          在改动视图点引用会把文本塞进不可见的对话输入框，用户看不到任何反应。 */}
                      <Button size="small" sx={{ fontSize: 9.5, minWidth: 0, px: 0.5, py: 0, lineHeight: 1.6 }} onClick={() => citeIntoInput(`[已有洞察] ${it.title}\n${it.body}`)}>
                        {t("workbench.aiInsights.cite")}
                      </Button>
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
            </Box>
          )}
        </Box>
      )}

      {/*
        AI 改动评审（R47 P2-A）：AI 在 Agent 模式下自己写盘，这里是用户唯一能看到
        「刚才动了哪几个文件、为什么动」并逐条保留/撤销的地方。没有待审改动时整块不渲染。
        位置刻意放在模式切换之下、对话之上——它是需要立刻处置的事，不该滚进消息流里被埋掉。
      */}
      {
        <>
          <ChangeReviewBar activeRelPath={activeFile?.relPath ?? null} onOpenPath={onOpenPath} onAppliedChange={handleAppliedChange} />
          <VerifySection entries={verifyList} settled={verifySettled} onDismiss={dismissVerify} onToggleCanvas={toggleVerifyCanvas} />

      {/* 改动工作台引导（仅「直接改」模式内联在对话流顶部，对标 VS Code Copilot Edits：
          改动不再藏在独立 Tab，而是贴着对话出现；AI 用 apply_change 工具改文件后逐条保留/撤销。 */}
      {mode === "edit" && (
        <Box sx={{ mx: 1, mt: 0.5, px: 1, py: 0.75, borderRadius: 1, border: 1, borderColor: "divider", bgcolor: dark ? "rgba(25,118,210,0.10)" : "rgba(25,118,210,0.06)" }}>
          <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, color: "text.primary" }}>
            {t("workbench.aiEdits.title")}
          </Typography>
          <Typography variant="caption" sx={{ display: "block", mt: 0.25, fontSize: 10.5, color: "text.secondary", lineHeight: 1.5 }}>
            {t("workbench.aiEdits.intro")}
          </Typography>
        </Box>
      )}

      {/* AI 内联改动预览横幅（对标 VS Code：改动直接在编辑器内红/绿展示，待确认） */}
      {pendingInline && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: 0.5,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: dark ? "rgba(63,185,80,0.10)" : "rgba(63,185,80,0.12)",
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "success.main", flexShrink: 0 }} />
          <Typography variant="caption" sx={{ flex: 1, fontSize: 10.5, color: "text.primary" }}>
            {t("workbench.aiApply.preview")}
          </Typography>
          <Button size="small" color="inherit" onClick={rejectInline} sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}>
            {t("workbench.aiApply.reject")}
          </Button>
          <Button size="small" variant="contained" color="success" onClick={acceptInline} sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}>
            {t("workbench.aiApply.accept")}
          </Button>
        </Box>
      )}

      {/* 消息列表 */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1 }}>
        {!selectedConversationId && messages.length === 0 && !isStreaming && (
          <Box sx={{ textAlign: "center", color: "text.secondary", mt: 2, px: 1 }}>
            <SmartToyIcon sx={{ fontSize: 30, opacity: 0.3, color: "primary.main" }} />
            {currentAgent ? (
              <>
                <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontSize: 12, fontWeight: 700, color: "text.primary" }}>{currentAgent.name}</Typography>
                {currentAgent.description && (
                  <Typography variant="caption" sx={{ display: "block", mt: 0.25, fontSize: 10.5, lineHeight: 1.5 }}>{currentAgent.description}</Typography>
                )}
                {/* 起步示例：空会话给几个可点提示词，打开即用（对标 VS Code 空聊天引导） */}
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, justifyContent: "center", mt: 1 }}>
                  {STARTER_PROMPTS.map((s) => (
                    <Chip
                      key={s.key}
                      size="small"
                      clickable
                      color="primary"
                      variant="outlined"
                      label={t(s.labelKey)}
                      onClick={() => citeIntoInput(s.prompt)}
                      sx={{ fontSize: 10, height: 22 }}
                    />
                  ))}
                </Box>
              </>
            ) : agents.length === 0 ? (
              /* 开箱即用引导：未配置任何助手时给明确配置入口，而非空白死面板（R62 差距 D） */
              <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" sx={{ display: "block", fontSize: 12, fontWeight: 700, color: "text.primary" }}>{t("workbench.aiOnboard.title")}</Typography>
                <Typography variant="caption" sx={{ display: "block", mt: 0.25, fontSize: 10.5, lineHeight: 1.5, maxWidth: 260, mx: "auto" }}>{t("workbench.aiOnboard.desc")}</Typography>
                <Button size="small" variant="contained" startIcon={<SettingsIcon />} onClick={() => void emit("open-ai-settings")} sx={{ mt: 1, fontSize: 11 }}>
                  {t("workbench.aiOnboard.cta")}
                </Button>
              </Box>
            ) : (
              <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontSize: 11 }}>{t("workbench.aiOnboard.pick")}</Typography>
            )}
          </Box>
        )}
        {messages.map((msg) => (
          <Box
            key={msg.id}
            sx={{
              mb: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              // 悬浮才亮起消息工具条（对标 VS Code：转录干净，动作随手可得）
              "&:hover .ps-msg-actions": { opacity: 1 },
            }}
          >
            {/* 历史工具轨迹：AI 这轮读了哪些文件 / 改了哪儿，永久留在转录里（对标 VS Code Agent 步骤）。
                轨迹排在回答正文之前——它是「怎么得出这个结论的」，先因后果。 */}
            {msg.role === "assistant" && (
              <Box sx={{ width: "94%" }}>
                <ToolStepList steps={parseToolTrace(msg.toolCalls)} onOpenPath={onOpenPath} />
              </Box>
            )}
            <Box
              sx={{
                px: 1,
                py: 0.5,
                borderRadius: 1.5,
                maxWidth: "94%",
                border: 1,
                borderColor: msg.role === "user" ? "primary.dark" : "divider",
                bgcolor: msg.role === "user" ? (dark ? "rgba(25,118,210,0.15)" : "rgba(25,118,210,0.08)") : "transparent",
              }}
            >
              {msg.role === "user" ? (
                /* 只显示用户真正打的那句话 + 上下文徽标（完整提示词可一键展开）：
                   落库正文含模式指令/[Workspace]/[上下文]/[画布作用域]，直接铺开转录没法读 */
                <UserMessageBubble content={msg.content} />
              ) : (
                <MarkdownView content={msg.content} onCodeInsert={canApply ? onCodeInsert : undefined} onCodeApply={canApply ? onCodeApply : undefined} canApply={canApply} />
              )}
            </Box>
            {/* 消息级动作（R68）：复制人人有；重试只给最后一条回答、编辑重发只给最后一条请求 */}
            <MessageActions
              role={msg.role === "user" ? "user" : "assistant"}
              canRetry={msg.role === "assistant" && msg.id === lastAssistantId}
              canEdit={msg.role === "user" && msg.id === lastUserId}
              disabled={isStreaming}
              onCopy={() => void copyMessage(msg.id)}
              onRetry={() => void retryLastTurn()}
              onEdit={() => void editLastRequest()}
            />
            {/* B 深化：改动就地长在对话流——每条含代码块的助手消息下方挂一张「改动卡」，
                逐条 Accept/Discard（对标 VS Code Copilot Edits 的 diff 长在气泡下）。
                取代原「仅最新消息挂在顶部」的 composer，改动与它的回答不再割裂。 */}
            {msg.role === "assistant" &&
              (() => {
                const items = composersByMsg[msg.id] ?? [];
                const visible = items.filter((it) => !composerSkip.has(it.key));
                if (!canApply || !activeFile || visible.length === 0) return null;
                return (
                  <MessageChangeCard
                    items={visible}
                    onApplyOne={(it) =>
                      it.cross
                        ? void applyCrossFileDirect(it.meta).then((ok) => ok && skipComposerItem(it.key))
                        : onCodeApply(it.meta)
                    }
                    onSkip={skipComposerItem}
                    onApplyAll={() => void applyAllForMsg(msg.id)}
                    onSkipAll={() => skipAllForMsg(msg.id)}
                  />
                );
              })()}
          </Box>
        ))}

        {isStreaming && (
          <Box sx={{ mb: 1 }}>
            {/* 流式实时轨迹与历史轨迹共用同一渲染：两处必须长得一样，否则流式结束的瞬间界面会「跳形」。
                流式期间不折叠（collapseOver 给足），用户正盯着 AI 干活。 */}
            <ToolStepList steps={toolCalls} onOpenPath={onOpenPath} collapseOver={999} />
            {streamingContent && (
              <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: 1, borderColor: "divider", maxWidth: "94%" }}>
                <MarkdownView content={streamingContent} canApply={false} />
              </Box>
            )}
            {!streamingContent && toolCalls.length === 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5 }}>
                <CircularProgress size={10} />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{t("workbench.aiThinking")}</Typography>
              </Box>
            )}
          </Box>
        )}
        {/* 停止回执：后端会保留「已吐出的部分回答」并落库，不标注的话用户分不清是答完了还是被自己截断了 */}
        {!isStreaming && stoppedConversationId && stoppedConversationId === selectedConversationId && (
          <Chip
            size="small"
            icon={<StopIcon sx={{ fontSize: 12 }} />}
            label={t("workbench.aiStopped")}
            color="error"
            variant="outlined"
            sx={{ fontSize: 9.5, height: 20 }}
          />
        )}
        <div ref={listEndRef} />
      </Box>

        {/* 对话后「下一步建议」（对标 VS Code Copilot / Cursor：每次回答后给 follow-up）。
            只在最后一条助手消息已落定（非流式）时出现；点击把成型提示词预填进输入框，
            用户审阅后回车才发——避免误触消耗 token，更避免 edit/agent 模式误触改盘。 */}
        {followups.length > 0 && !isStreaming && (
          <Box sx={{ mb: 1, ml: "6%", display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
            <AutoAwesomeIcon sx={{ fontSize: 13, color: "primary.main", flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", mr: 0.25 }}>
              {t("workbench.aiFollowup.title")}
            </Typography>
            {followups.map((f) => (
              <Chip
                key={f.key}
                size="small"
                clickable
                label={t(f.labelKey)}
                onClick={() => citeIntoInput(f.prompt)}
                sx={{ fontSize: 10, height: 22 }}
              />
            ))}
          </Box>
        )}

      {/* 作用域主动建议（比 VS Code 更强）：聚焦实体后，面板基于扫描事实主动给出可执行追问。
          原只在独立「改动」Tab 渲染，现并入对话流（仅「直接改」模式），避免与对话割裂。 */}
      {mode === "edit" && scopeSuggestions.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5, px: 1, alignItems: "center" }}>
          <LightbulbIcon sx={{ fontSize: 13, color: "info.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
            {t("workbench.aiSuggest.title")}
          </Typography>
          {scopeSuggestions.map((s) => (
            <Chip
              key={s.key}
              size="small"
              clickable
              color="info"
              variant="outlined"
              label={s.label}
              onClick={() => setPendingSuggestion(s)}
              sx={{ fontSize: 10, height: 22 }}
            />
          ))}
        </Box>
      )}

      {/* 统一输入栏（诊断条 + 快捷动作 + 输入框 + 斜杠菜单）：对话流唯一输入框，
          消除两视图各复制一套输入 UI 的行为发散（见 workbenchComponents.WorkbenchInputBar） */}
      <WorkbenchInputBar ctx={{ ...ctx, agents, selectedAgentId, selectAgent }} selection={selection} isStreaming={isStreaming} />

      {/* 应用改动：diff 预览 */}
      <Dialog open={!!diff} onClose={() => setDiff(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 14 }}>
          {t("workbench.aiCode.diffTitle")}
          {diff?.rangeLabel ? ` · ${diff.rangeLabel}` : diff?.meta.path ? ` · ${diff.meta.path}` : ""}
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ height: "50vh" }}>
            <Suspense fallback={<Box sx={{ p: 2 }}><CircularProgress size={18} /></Box>}>
              {diff && (
                <DiffEditorLazy
                  height="100%"
                  language={monacoLanguageOf(activeFile?.language ?? "plaintext")}
                  original={diff.original}
                  modified={diff.modified}
                  theme={dark ? "vs-dark" : "light"}
                  options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12 }}
                />
              )}
            </Suspense>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setDiff(null)}>{t("workbench.aiCode.discard")}</Button>
          <Button size="small" variant="contained" onClick={applyDiff}>{t("workbench.aiCode.keep")}</Button>
        </DialogActions>
      </Dialog>

      {/* 主动建议「一键直接发起」确认框（R16/R19 待续②）：替换原「只预填」交互，避免误触消耗额度；
          确认后带画布作用域直接 send（对话流内直接看流式回答）。原仅在独立「改动」Tab 渲染，现并入对话流。 */}
      <Dialog open={!!pendingSuggestion} onClose={() => setPendingSuggestion(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 14 }}>{t("workbench.aiSuggest.launchTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary", lineHeight: 1.6, display: "block" }}>
            {t("workbench.aiSuggest.launchBody", { label: pendingSuggestion?.label ?? "" })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPendingSuggestion(null)}>{t("workbench.aiSuggest.launchCancel")}</Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              const p = pendingSuggestion?.prompt;
              setPendingSuggestion(null);
              if (p) void send(p);
            }}
          >
            {t("workbench.aiSuggest.launchOk")}
          </Button>
        </DialogActions>
      </Dialog>
        </>
      }

      {/* 高危工具审批（human-in-the-loop）：引擎即将执行 run_command 前弹确认框，对标 VS Code Agent 的「Run command?」拦截。
          用户允许才执行，拒绝则命令不落地；超时 / 取消引擎按拒绝处理。 */}
      <Dialog open={!!pendingToolApproval} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 14, display: "flex", alignItems: "center", gap: 1 }}>
          <WarningAmberIcon sx={{ fontSize: 18, color: "warning.main" }} />
          {t("workbench.aiApproval.title")}
        </DialogTitle>
        <DialogContent sx={{ fontSize: 12 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
            {t("workbench.aiApproval.warning")}
          </Typography>
          {pendingToolApproval && (
            <Box
              sx={{
                bgcolor: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                p: 1,
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                lineHeight: 1.5,
              }}
            >
              {pendingToolApproval.cwd ? `$ ${pendingToolApproval.cwd}> ` : "$ "}
              {pendingToolApproval.command}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" color="error" variant="outlined" onClick={() => void resolveToolApproval(false)}>
            {t("workbench.aiApproval.deny")}
          </Button>
          <Button size="small" variant="contained" onClick={() => void resolveToolApproval(true)}>
            {t("workbench.aiApproval.allow")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
