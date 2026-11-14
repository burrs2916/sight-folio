// sight-folio: 工作台 AI 面板（对标 VS Code Copilot Chat 侧栏）
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

import { useState, useEffect, lazy, Suspense } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StopIcon from '@mui/icons-material/Stop';
import ReplayIcon from '@mui/icons-material/Replay';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import LinkIcon from '@mui/icons-material/Link';
import CodeIcon from '@mui/icons-material/Code';
import AssessmentIcon from '@mui/icons-material/Assessment';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import HistoryIcon from '@mui/icons-material/History';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LayersIcon from '@mui/icons-material/Layers';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useTheme } from '@mui/material/styles';
import { emit } from '@tauri-apps/api/event';

import { t } from '../../i18n';
import {
  bookStartersFor,
  codeStarters,
  topicStartersFor,
  bookOverviewPrompt,
  type BookTopicKey,
} from '../../ai/starterPrompts';
import { useAgentStore } from '../../store/agentStore';
import { useToastStore } from '../../store/toastStore';
import { clearAllContextPacks } from '../../ai/contextPersist';
import { type WritingSetting } from '../../services/tauri';
import { monacoLanguageOf } from '../../utils/languageMeta';
import { useCodeFont } from '../../hooks/useCodeFont';
import type { EditorSelectionInfo, MonacoEditorHandle } from './MonacoCodeEditor';
import { type WorkbenchMode, WORKBENCH_MODES } from './workbenchContext';
import { MarkdownView, type CodeBlockMeta } from './aiMarkdown';
import { ToolStepList, parseToolTrace } from './aiToolSteps';
import { UserMessageBubble } from './aiUserMessage';
import { ChangeReviewBar } from './ChangeReviewBar';
// 纯展示组件与工具函数（已从本文件拆出，见 workbenchComponents.tsx）
import { relTime, modeLabel, VerifySection, ImpactSurfaceBlock, WorkbenchInputBar } from './workbenchComponents';
import { useWorkbenchContext, useWorkbenchEdits, useWorkbenchChat } from './workbenchPanelHooks';
import { uiFontSize } from '../../theme/appearanceScales';
export { computeApplyDiff, computeInlineEdit } from './workbenchPanelHooks';

const DiffEditorLazy = lazy(async () => {
  await import('./monacoSetup');
  const m = await import('@monaco-editor/react');
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
  /** 书场景（novel-zh）：提示词组装切换为写作向（人设/设定/情节），不出现代码分析术语（零回归：缺省 false = 代码场景） */
  isBookScene?: boolean;
  /** 方案 A（2026-09-14）：书场景「AI 优化」入口从顶栏迁入本面板 —— 打开画布 AI 对话框（H3 方案预览流）。
      仅书场景且回调存在时渲染入口按钮；代码场景传 undefined，零回归 */
  onOpenCanvasAi?: () => void;
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
  /** 书场景：AI 角色随左栏题材 tab 切换（characters/世界观/catalog/timeline/overview）；null = 未限定题材。 */
  bookTopic?: BookTopicKey | null;
  /** 当前书名（注入 AI 上下文，让 AI 知道在写哪本书）。 */
  bookTitle?: string | null;
  /**
   * 当前书体裁（㉟ AI-4a，2026-11-10 轮 12）：书场景默认「起步示例」快捷问句按体裁取
   * （诗集不再领到「读懂本章」「审情节节奏」）。未设 / 脏值 = 小说口径（逐字零回归）。
   * 缺省不影响代码场景（isBookScene=false 一律不读它）。
   */
  genre?: string | null;
  /** 当前选中的具体设定项（人物/世界观卡），钻入详情时带上，让 AI 聚焦这一个。setting = 完整档案。 */
  focusSetting?: { name: string; kind: 'character' | 'worldbuilding'; setting?: WritingSetting | null } | null;
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
  const cardDark = useTheme().palette.mode === 'dark';
  const [open, setOpen] = useState(true);
  return (
    <Box
      sx={{
        width: '94%',
        mt: 0.5,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: cardDark
          ? 'rgb(var(--template-palette-primary-mainChannel) / 0.06)'
          : 'rgb(var(--template-palette-primary-mainChannel) / 0.04)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.4 }}>
        <IconButton
          size="small"
          onClick={() => setOpen((v) => !v)}
          sx={{ p: 0.25 }}
          aria-label={open ? t('workbench.aiApply.collapse') : t('workbench.aiApply.expand')}
        >
          {open ? (
            <ExpandLessIcon sx={{ fontSize: uiFontSize(16) }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: uiFontSize(16) }} />
          )}
        </IconButton>
        <AssessmentIcon sx={{ fontSize: uiFontSize(15), color: 'primary.main' }} />
        <Typography
          variant="caption"
          sx={{ flex: 1, fontSize: uiFontSize(10.5), fontWeight: 600, color: 'text.primary' }}
        >
          {t('workbench.aiApply.composerTitle', { n: items.length })}
        </Typography>
        <Button
          size="small"
          variant="contained"
          color="primary"
          onClick={onApplyAll}
          sx={{ fontSize: uiFontSize(10), minWidth: 0, px: 0.75, py: 0 }}
        >
          {t('workbench.aiApply.composerApplyAll')}
        </Button>
        <Button
          size="small"
          color="inherit"
          onClick={onSkipAll}
          sx={{ fontSize: uiFontSize(10), minWidth: 0, px: 0.5, py: 0 }}
        >
          {t('workbench.aiApply.composerSkipAll')}
        </Button>
      </Box>
      {open && (
        <Box sx={{ px: 1, pb: 0.6, maxHeight: 200, overflow: 'auto' }}>
          {items.map((it) => (
            <Box
              key={it.key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                py: 0.25,
                borderTop: '1px dashed',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {it.cross && (
                    <Chip
                      size="small"
                      label={t('workbench.aiApply.composerCrossTag')}
                      color="warning"
                      sx={{ height: 15, fontSize: uiFontSize(8.5) }}
                    />
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontSize: uiFontSize(10),
                      color: it.cross ? 'warning.main' : 'primary.main',
                      fontWeight: 600,
                    }}
                  >
                    {it.rangeLabel}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    fontSize: uiFontSize(10),
                    color: 'text.secondary',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {it.summary || t('workbench.aiApply.composerNoSummary')}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={() => onApplyOne(it)}
                sx={{ fontSize: uiFontSize(9.5), minWidth: 0, px: 0.5, py: 0, lineHeight: 1.4 }}
              >
                {t('workbench.aiApply.composerApplyOne')}
              </Button>
              <IconButton
                size="small"
                onClick={() => onSkip(it.key)}
                sx={{ p: 0.25 }}
                aria-label={t('workbench.aiApply.composerSkip')}
              >
                <CloseIcon sx={{ fontSize: uiFontSize(14) }} />
              </IconButton>
            </Box>
          ))}
          {items.some((it) => it.cross) && (
            <Typography
              variant="caption"
              sx={{ display: 'block', mt: 0.5, fontSize: uiFontSize(9.5), color: 'text.secondary' }}
            >
              {t('workbench.aiApply.composerCrossNote')}
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
 *  - 删除对所有消息开放，但走面板二次确认框（批次 5②：转录清理语义，仅删该条）。
 *  - 流式期间全部禁用（后端正在写库，截断/删除会与落库竞争）。
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
  onDelete,
}: {
  role: 'user' | 'assistant';
  canRetry: boolean;
  canEdit: boolean;
  disabled: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Box
      className="ps-msg-actions"
      sx={{
        display: 'flex',
        gap: 0.15,
        mt: 0.15,
        opacity: 0,
        transition: 'opacity 120ms',
        justifyContent: role === 'user' ? 'flex-end' : 'flex-start',
      }}
    >
      <Tooltip title={t('workbench.aiMsgAction.copy')}>
        <IconButton size="small" onClick={onCopy} sx={{ p: 0.25 }} aria-label={t('workbench.aiMsgAction.copy')}>
          <ContentCopyIcon sx={{ fontSize: uiFontSize(13), color: 'text.disabled' }} />
        </IconButton>
      </Tooltip>
      {canEdit && (
        <Tooltip title={t('workbench.aiMsgAction.edit')}>
          <IconButton
            size="small"
            onClick={onEdit}
            disabled={disabled}
            sx={{ p: 0.25 }}
            aria-label={t('workbench.aiMsgAction.edit')}
          >
            <EditIcon sx={{ fontSize: uiFontSize(13), color: 'text.disabled' }} />
          </IconButton>
        </Tooltip>
      )}
      {canRetry && (
        <Tooltip title={t('workbench.aiMsgAction.retry')}>
          <IconButton
            size="small"
            onClick={onRetry}
            disabled={disabled}
            sx={{ p: 0.25 }}
            aria-label={t('workbench.aiMsgAction.retry')}
          >
            <RefreshIcon sx={{ fontSize: uiFontSize(13), color: 'text.disabled' }} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title={t('workbench.aiMsgAction.delete')}>
        <IconButton
          size="small"
          onClick={onDelete}
          disabled={disabled}
          sx={{ p: 0.25 }}
          aria-label={t('workbench.aiMsgAction.delete')}
        >
          <DeleteIcon sx={{ fontSize: uiFontSize(13), color: 'text.disabled' }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

// 开箱即用引导（R66，收口 R62 差距 D「没配 Agent 即死面板」）：
// 无助手时给明确配置入口；有助手但空会话时给起步示例，让右侧面板「打开即用」而非空白死寂。
//
// ㉒（AI-4b′，2026-11-10 轮 14）三张起步示例表全部搬入 `src/ai/starterPrompts.ts`：
//   - 代码场景四枚 → `codeStarters()`（旧表嵌死 `L()`，切语言不刷新；搬入后存语言对，取用时才定语种）；
//   - 书场景题材表 → `topicStartersFor(genre, topic)`（按体裁换词，novel 逐字零回归；旧表同样是嵌死 `L()` 的反例）；
//   - 全书总览体检问句 → `bookOverviewPrompt(genre)`（㉢ AI-4b″ 轮 15 收口：维度串与 overview
//     题材组同一张嘴，同轮换词；novel 逐字节零回归）。
// 此处不留第二份表（轮 5 / 轮 6 / 轮 12 删表手法的第四次）。

// 需求分析引导起步 Chip 已迁至独立「需求分析」业务面板（RequirementsPanel），
// AI 面板模式下拉回归纯 ask / edit / agent，不再承载业务功能。

export function WorkbenchAiPanel({
  activeFile,
  selection,
  editorRef,
  onClose,
  onOpenPath,
  initialPrompt,
  onConsumeInitialPrompt,
  isBookScene = false,
  onOpenCanvasAi,
  bookTopic,
  bookTitle,
  genre,
  focusSetting,
}: WorkbenchAiPanelProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  // AI 建议对照的字号跟随「设置 → 字体大小」（此前写死 12，抽屉切档位这边不跟着变）
  const inlineDiffFont = useCodeFont('inlineDiff');
  // 全书统筹（健康度/连续性）是 AI 的临时角色覆盖：点「全书总览」按钮时本地切到 overview，
  // 切换左栏题材 tab（bookTopic prop 变化）即还原为跟随题材。零回归：不改动父级分派链。
  const [localTopic, setLocalTopic] = useState<BookTopicKey | null>(null);
  const resolvedTopic = localTopic ?? bookTopic;
  useEffect(() => {
    setLocalTopic(null);
  }, [bookTopic]);

  // ── 批次 5 · 会话功能：删除与清理都要二次确认（破坏性操作不许一点即删）──
  // 待删除的会话 / 单条消息 / 上下文缓存清理确认框开关。真源全在 agentStore 与 contextPersist，
  // 面板只收集意图、确认后转发，失败经全局 toast 回执（界面不静默吞错）。
  const [pendingConvDelete, setPendingConvDelete] = useState<{ id: string; title: string } | null>(null);
  const [pendingMsgDelete, setPendingMsgDelete] = useState<{ id: string; role: string; preview: string } | null>(null);
  const [clearCtxOpen, setClearCtxOpen] = useState(false);
  const [clearCtxBusy, setClearCtxBusy] = useState(false);

  const confirmDeleteConversation = async () => {
    const target = pendingConvDelete;
    setPendingConvDelete(null);
    if (!target) return;
    try {
      await useAgentStore.getState().deleteConversation(target.id);
    } catch {
      useToastStore.getState().showToast(t('workbench.aiThread.deleteFailed'), 'error');
    }
  };

  const confirmDeleteMessage = async () => {
    const target = pendingMsgDelete;
    setPendingMsgDelete(null);
    if (!target) return;
    try {
      await useAgentStore.getState().deleteMessage(target.id);
    } catch {
      useToastStore.getState().showToast(t('workbench.aiMsgAction.deleteFailed'), 'error');
    }
  };

  const confirmClearContextPacks = async () => {
    setClearCtxBusy(true);
    try {
      const n = await clearAllContextPacks();
      useToastStore.getState().showToast(t('workbench.aiContextClear.cleared', { n }), 'info');
      setClearCtxOpen(false);
    } catch {
      useToastStore.getState().showToast(t('workbench.aiContextClear.failed'), 'error');
    } finally {
      setClearCtxBusy(false);
    }
  };
  // 书场景下，AI 角色随左栏题材 tab 切换（人物/世界观/大纲/全书统筹），在头部明示当前角色。
  const bookRoleLabel =
    isBookScene && resolvedTopic
      ? t(
          resolvedTopic === 'characters'
            ? 'workbench.aiRole.character'
            : resolvedTopic === 'worldview'
              ? 'workbench.aiRole.worldview'
              : resolvedTopic === 'timeline'
                ? 'workbench.aiRole.timeline'
                : resolvedTopic === 'storylines'
                  ? 'workbench.aiRole.storylines'
                  : resolvedTopic === 'foreshadowing'
                    ? 'workbench.aiRole.foreshadowing'
                    : resolvedTopic === 'inspiration'
                      ? 'workbench.aiRole.inspiration'
                      : resolvedTopic === 'proofread'
                        ? 'workbench.aiRole.proofread'
                        : resolvedTopic === 'stats'
                          ? 'workbench.aiRole.stats'
                          : resolvedTopic === 'writing'
                            ? 'workbench.aiRole.writing'
                            : resolvedTopic === 'overview'
                              ? 'workbench.aiRole.overview'
                              : 'workbench.aiRole.catalog',
        )
      : null;

  const ctx = useWorkbenchContext({
    activeFile,
    selection,
    editorRef,
    onOpenPath,
    isBookScene,
    bookTopic: resolvedTopic,
    bookTitle,
    focusSetting,
  });
  const edits = useWorkbenchEdits({ activeFile, selection, editorRef, onOpenPath, ctx });
  const chat = useWorkbenchChat({ activeFile, ctx, edits });
  const {
    mode,
    setMode,
    attachments,
    setAttachments,
    setInput,
    attachOpen,
    setAttachOpen,
    attachQuery,
    setAttachQuery,
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
    setView,
    verifyList,
    verifySettled,
    dismissVerify,
    toggleVerifyCanvas,
    handleAppliedChange,
    listEndRef,
    attachCandidates,
    addAttachment,
    canApply,
    send,
    factsLabel,
    scopeSuggestions,
    impactFiles,
    fileInsights,
    contextSig,
    showContextBar,
    facts,
  } = ctx;

  // 需求分析面板「AI 协助」芯片注入的预填提示词：一次性消费，避免重复触发。
  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      onConsumeInitialPrompt?.();
    }
  }, [initialPrompt, setInput, onConsumeInitialPrompt]);
  const {
    diff,
    setDiff,
    pendingInline,
    rejectInline,
    acceptInline,
    onCodeInsert,
    onCodeApply,
    applyCrossFileDirect,
    applyDiff,
  } = edits;
  const {
    agents,
    conversationsLoading,
    messages,
    streamingContent,
    isStreaming,
    stoppedConversationId,
    currentStreamConversationId,
    lastStreamError,
    toolCalls,
    selectedAgentId,
    selectedConversationId,
    currentAgent,
    historyAnchor,
    setHistoryAnchor,
    moreAnchorEl,
    setMoreAnchorEl,
    citeIntoInput,
    composersByMsg,
    composerSkip,
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
    msgListRef,
    handleMsgScroll,
  } = chat;

  // 高危工具审批（human-in-the-loop）：引擎即将执行 run_command 前推审批请求，这里弹确认框。
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
        height: '100%',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        position: 'relative',
      }}
    >
      {/* 拖拽手柄已上移到代码工作台右侧 dock（整块共享宽度与拖拽），本面板只填充 dock 内部 */}

      {/* 头部：标题 + 更多 + 关闭（助手选择已下沉到底部输入条，与输入框同行对齐，见 WorkbenchInputBar） */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <SmartToyIcon sx={{ fontSize: uiFontSize(16), color: 'primary.main', flexShrink: 0 }} />
        <Typography variant="caption" sx={{ fontWeight: 700, flexShrink: 0 }}>
          {t('workbench.aiPanelTitle')}
        </Typography>
        {bookRoleLabel && (
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={bookRoleLabel}
            sx={{ fontSize: uiFontSize(9.5), height: 18, ml: 0.25, '& .MuiChip-label': { px: 0.5 } }}
          />
        )}
        {isBookScene && (
          <Tooltip title={t('studio.overviewAi.tip')}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AssessmentIcon sx={{ fontSize: uiFontSize(14) }} />}
              onClick={() => {
                setLocalTopic('overview');
                void send(bookOverviewPrompt(genre ?? ''));
              }}
              sx={{ textTransform: 'none', fontSize: uiFontSize(10), ml: 0.25, minHeight: 18 }}
            >
              {t('studio.overviewAi.button')}
            </Button>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('workbench.aiMore.label')}>
          <IconButton
            size="small"
            onClick={(e) => setMoreAnchorEl(e.currentTarget)}
            aria-label={t('workbench.aiMore.label')}
          >
            <MoreVertIcon sx={{ fontSize: uiFontSize(15) }} />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose} aria-label={t('workbench.aiMore.label')}>
          <CloseIcon sx={{ fontSize: uiFontSize(15) }} />
        </IconButton>
      </Box>

      {/* 头部「更多」菜单（对标 VS Code Copilot Chat 顶栏的「…」：把历史/新对话等低频操作收进一处，
          头部不再并列 5 个控件，只留 标题 + 助手选择 + 更多 + 关闭，对齐 VS Code 信息架构） */}
      <Menu
        anchorEl={moreAnchorEl}
        open={!!moreAnchorEl}
        onClose={() => setMoreAnchorEl(null)}
        sx={{ '& .MuiMenu-paper': { minWidth: 184 } }}
      >
        <MenuItem
          onClick={() => {
            useAgentStore.getState().selectConversation(null);
            setMoreAnchorEl(null);
          }}
          sx={{ fontSize: uiFontSize(11), gap: 0.75 }}
        >
          <AddIcon sx={{ fontSize: uiFontSize(15) }} />
          {t('workbench.aiMore.newChat')}
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
          sx={{ fontSize: uiFontSize(11), gap: 0.75 }}
        >
          <HistoryIcon sx={{ fontSize: uiFontSize(15) }} />
          {t('workbench.aiMore.history')}
        </MenuItem>
        {/* 上下文缓存清理（批次 5③）：包是派生数据，孤儿包（删掉的书/项目）没有别的回收通道，
            这里给一个确定性入口；容量闸兜总量，这里管「现在就想要回来」的场景 */}
        <Divider sx={{ my: 0.25 }} />
        <MenuItem
          onClick={() => {
            setMoreAnchorEl(null);
            setClearCtxOpen(true);
          }}
          sx={{ fontSize: uiFontSize(11), gap: 0.75 }}
        >
          <DeleteSweepIcon sx={{ fontSize: uiFontSize(15) }} />
          {t('workbench.aiMore.clearContext')}
        </MenuItem>
      </Menu>

      {/* 对话历史菜单（对标 VS Code Copilot Chat 的「浏览历史对话」）：列出当前 Agent 的会话，
          点击切回；当前会话高亮标记。后端 listConversations 已持久化，刷新/重开不丢。 */}
      <Menu
        anchorEl={historyAnchor}
        open={!!historyAnchor}
        onClose={() => setHistoryAnchor(null)}
        sx={{ '& .MuiMenu-paper': { maxHeight: 320, minWidth: 224 } }}
      >
        {conversationsLoading ? (
          <MenuItem disabled sx={{ fontSize: uiFontSize(11), gap: 0.5 }}>
            <CircularProgress size={12} />
            {t('workbench.aiThread.loading')}
          </MenuItem>
        ) : historyList.length === 0 ? (
          <MenuItem disabled sx={{ fontSize: uiFontSize(11) }}>
            {t('workbench.aiThread.historyEmpty')}
          </MenuItem>
        ) : (
          historyList.map((c) => (
            <MenuItem
              key={c.id}
              selected={c.id === selectedConversationId}
              onClick={() => {
                useAgentStore.getState().selectConversation(c.id);
                setHistoryAnchor(null);
              }}
              sx={{ fontSize: uiFontSize(11), gap: 0.5, alignItems: 'flex-start', py: 0.75 }}
            >
              {c.id === selectedConversationId ? (
                <CheckIcon sx={{ fontSize: uiFontSize(14), color: 'primary.main', flexShrink: 0, mt: 0.25 }} />
              ) : (
                <Box sx={{ width: 14, flexShrink: 0 }} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    fontSize: uiFontSize(11),
                    fontWeight: c.id === selectedConversationId ? 700 : 400,
                    color: 'text.primary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.title}
                  {c.id === selectedConversationId ? ` ${t('workbench.aiThread.current')}` : ''}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', fontSize: uiFontSize(9.5), color: 'text.secondary' }}
                >
                  {relTime(c.updatedAt)}
                </Typography>
              </Box>
              {/* 会话删除入口（批次 5①）：不点整行（整行是「切回该会话」），
                  stopPropagation 后收进二次确认框，确认才走 store 真源删除 */}
              <Tooltip title={t('workbench.aiThread.delete')}>
                <IconButton
                  size="small"
                  aria-label={t('workbench.aiThread.delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setHistoryAnchor(null);
                    setPendingConvDelete({ id: c.id, title: c.title });
                  }}
                  sx={{ p: 0.25, ml: 0.25, alignSelf: 'center', opacity: 0.45, '&:hover': { opacity: 1 } }}
                >
                  <DeleteIcon sx={{ fontSize: uiFontSize(13) }} />
                </IconButton>
              </Tooltip>
            </MenuItem>
          ))
        )}
      </Menu>

      {/* 删除会话二次确认（批次 5① 红线：破坏性操作不许一点即删）。文案里带会话标题，
          用户在菜单里点的是哪一条，确认框就说清删的是哪一条 */}
      <Dialog open={!!pendingConvDelete} onClose={() => setPendingConvDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: uiFontSize(14) }}>{t('workbench.aiThread.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography
            variant="caption"
            sx={{ fontSize: uiFontSize(11), color: 'text.secondary', lineHeight: 1.6, display: 'block' }}
          >
            {t('workbench.aiThread.deleteConfirmBody', { title: pendingConvDelete?.title ?? '' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPendingConvDelete(null)}>
            {t('nav.cancel')}
          </Button>
          <Button size="small" color="error" variant="contained" onClick={() => void confirmDeleteConversation()}>
            {t('nav.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除单条消息二次确认（批次 5②）：仅删该条、其后对话保留——确认文案必须把这条语义讲透，
          不然用户会以为点了「删除」等于把这一轮连同后面的都撤掉（那是「重试」的口径） */}
      <Dialog open={!!pendingMsgDelete} onClose={() => setPendingMsgDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: uiFontSize(14) }}>{t('workbench.aiMsgAction.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography
            variant="caption"
            sx={{ fontSize: uiFontSize(11), color: 'text.secondary', lineHeight: 1.6, display: 'block' }}
          >
            {t('workbench.aiMsgAction.deleteConfirmBody')}
          </Typography>
          {pendingMsgDelete?.preview && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 1,
                p: 0.75,
                fontSize: uiFontSize(10.5),
                bgcolor: 'action.hover',
                borderRadius: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {pendingMsgDelete.preview}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPendingMsgDelete(null)}>
            {t('nav.cancel')}
          </Button>
          <Button size="small" color="error" variant="contained" onClick={() => void confirmDeleteMessage()}>
            {t('nav.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 清理 AI 上下文缓存确认框（批次 5③）：讲清楚「删的是派生缓存、文档代码零风险、
          下次扫描/分析自动重建」，别让用户误以为会动自己的书 */}
      <Dialog open={clearCtxOpen} onClose={() => !clearCtxBusy && setClearCtxOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: uiFontSize(14) }}>{t('workbench.aiContextClear.title')}</DialogTitle>
        <DialogContent>
          <Typography
            variant="caption"
            sx={{ fontSize: uiFontSize(11), color: 'text.secondary', lineHeight: 1.6, display: 'block' }}
          >
            {t('workbench.aiContextClear.body')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" disabled={clearCtxBusy} onClick={() => setClearCtxOpen(false)}>
            {t('nav.cancel')}
          </Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            disabled={clearCtxBusy}
            onClick={() => void confirmClearContextPacks()}
          >
            {clearCtxBusy ? t('workbench.aiContextClear.clearing') : t('workbench.aiContextClear.ok')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 顶部工具栏（单行）：单一模式下拉（对标 VS Code Copilot 的 Chat/Edits/Agent 模式选择），
          合并原「视图 Chat/Edits 切换」+「模式 Ask/Edit/Agent chips」两套正交控件为 1 个控件——
          VS Code 正是用「一个模式下拉」同时承担「看对话」与「直接改」，而非两套并列。
          改动（台账/验证）不再独立 Tab，而是内联在对话流里（见下方 body）；选 edit 模式时强制 view=chat，
          保证对话始终是主轴、改动就地长在对话下。 */}
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          alignItems: 'center',
        }}
      >
        <FormControl size="small" sx={{ minWidth: 116 }}>
          <Select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as WorkbenchMode;
              setMode(m);
              // 统一为对话流渲染：无论选哪个模式，对话都是主轴（改动内联其中），不再切到隐藏对话的独立 Tab
              setView('chat');
            }}
            sx={{ fontSize: uiFontSize(11), height: 26 }}
            displayEmpty
            renderValue={(v) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AutoAwesomeIcon sx={{ fontSize: uiFontSize(13), color: 'primary.main' }} />
                <span>{modeLabel(v as WorkbenchMode)}</span>
              </Box>
            )}
          >
            {WORKBENCH_MODES.map((m) => (
              <Tooltip key={m} title={t(`workbench.aiMode.${m}`)}>
                <MenuItem value={m} sx={{ fontSize: uiFontSize(11) }}>
                  {modeLabel(m)}
                </MenuItem>
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
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              py: 0.5,
              cursor: 'pointer',
              borderBottom: 1,
              borderColor: 'divider',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <LayersIcon sx={{ fontSize: uiFontSize(14), color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: uiFontSize(11), color: 'text.primary' }}>
              {t('workbench.aiContextBar.title')}
            </Typography>
            <Chip
              size="small"
              label={t('workbench.aiContextBar.count', { n: contextSig })}
              sx={{ fontSize: uiFontSize(8.5), height: 16, '& .MuiChip-label': { px: 0.5 } }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="caption"
                sx={{
                  fontSize: uiFontSize(9.5),
                  color: 'text.secondary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {activeFile ? activeFile.relPath : t('workbench.aiContextBar.noFile')}
                {canvasScope ? ` · ${canvasScope.label}` : ''}
                {impactFiles.length > 0 ? ` · ${t('workbench.aiContextBar.impact', { n: impactFiles.length })}` : ''}
                {fileInsights.length > 0
                  ? ` · ${t('workbench.aiContextBar.insights', { n: fileInsights.length })}`
                  : ''}
              </Typography>
            </Box>
            {contextOpen ? (
              <ExpandLessIcon sx={{ fontSize: uiFontSize(16) }} />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: uiFontSize(16) }} />
            )}
          </Box>
          {contextOpen && (
            <Box sx={{ pb: 0.5 }}>
              {/* 上下文芯片行 */}
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0.5,
                  px: 1,
                  py: 0.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  maxHeight: 64,
                  overflow: 'auto',
                }}
              >
                {activeFile && (
                  <Chip
                    size="small"
                    icon={<CodeIcon sx={{ fontSize: uiFontSize(13) }} />}
                    label={activeFile.relPath}
                    sx={{ fontSize: uiFontSize(10), height: 22, maxWidth: 220 }}
                  />
                )}
                {/* 画布作用域芯片（VS Code 没有的维度）：点击把画布重新居中到该实体。
            次级色与「当前文件」芯片区分——它代表「用户在画布上看的」，可能不同于编辑器打开的。 */}
                {canvasScope && (
                  <Tooltip title={t('workbench.aiScope.focusTip')}>
                    <Chip
                      size="small"
                      color="secondary"
                      icon={<LinkIcon sx={{ fontSize: uiFontSize(13) }} />}
                      label={t('workbench.aiScope.label', { label: canvasScope.label })}
                      onClick={() => void emit('workbench-focus-canvas', { fileId: canvasScope.fileId })}
                      sx={{ fontSize: uiFontSize(10), height: 22, maxWidth: 200 }}
                    />
                  </Tooltip>
                )}
                {selection?.text && (
                  <Chip
                    size="small"
                    color="info"
                    label={t('workbench.aiContext.selection', { start: selection.startLine, end: selection.endLine })}
                    sx={{ fontSize: uiFontSize(10), height: 22 }}
                  />
                )}
                {facts && factsLabel && (
                  <Tooltip title={t('workbench.aiFacts.title')}>
                    <Chip
                      size="small"
                      icon={<AssessmentIcon sx={{ fontSize: uiFontSize(13) }} />}
                      color="warning"
                      label={factsLabel}
                      sx={{ fontSize: uiFontSize(10), height: 22, maxWidth: 220 }}
                    />
                  </Tooltip>
                )}
                {attachments.map((a, i) => (
                  <Chip
                    key={`${a.refPath}-${a.symbolName ?? i}`}
                    size="small"
                    icon={
                      a.kind === 'symbol' ? (
                        <LinkIcon sx={{ fontSize: uiFontSize(13) }} />
                      ) : (
                        <CodeIcon sx={{ fontSize: uiFontSize(13) }} />
                      )
                    }
                    label={a.kind === 'symbol' ? `${a.symbolName}` : a.label}
                    onDelete={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    sx={{ fontSize: uiFontSize(10), height: 22, maxWidth: 180 }}
                  />
                ))}
                <Chip
                  size="small"
                  clickable
                  icon={<AddIcon sx={{ fontSize: uiFontSize(13) }} />}
                  label={t('workbench.aiContext.attach')}
                  onClick={() => setAttachOpen((v) => !v)}
                  sx={{ fontSize: uiFontSize(10), height: 22, borderStyle: 'dashed' }}
                />
              </Box>

              {/* 作用域级影响面（比 VS Code 更强）：聚焦实体后，按调用图算出改它会波及哪些文件 */}
              <ImpactSurfaceBlock
                files={impactFiles}
                onOpenPath={onOpenPath}
                enabled={impactCanvasOn}
                onToggle={setImpactCanvasOn}
              />

              {/* # 附件选择器 */}
              {attachOpen && (
                <Box
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    maxHeight: 180,
                    overflow: 'auto',
                    bgcolor: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                  }}
                >
                  <Box sx={{ p: 0.5 }}>
                    <TextField
                      size="small"
                      autoFocus
                      fullWidth
                      placeholder={t('workbench.aiAttach.placeholder')}
                      value={attachQuery}
                      onChange={(e) => setAttachQuery(e.target.value)}
                      sx={{ '& .MuiInputBase-root': { fontSize: uiFontSize(11), height: 28 } }}
                    />
                  </Box>
                  {attachCandidates.length === 0 ? (
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 1, py: 0.5 }}>
                      {t('workbench.aiAttach.empty')}
                    </Typography>
                  ) : (
                    attachCandidates.map((c, i) => (
                      <Box
                        key={`${c.type}-${c.relPath}-${c.symbolName ?? i}`}
                        onClick={() => addAttachment(c)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          px: 1,
                          py: 0.4,
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <CodeIcon sx={{ fontSize: uiFontSize(13), color: 'text.secondary', flexShrink: 0 }} />
                        <Typography
                          variant="caption"
                          sx={{
                            flex: 1,
                            fontSize: uiFontSize(11),
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.type === 'symbol' ? `${c.symbolName} · ${c.relPath}:${c.line}` : c.relPath}
                        </Typography>
                      </Box>
                    ))
                  )}
                </Box>
              )}

              {/* 本文件相关洞察（差异化：复用分析页既有结论，VS Code 没有） */}
              {activeFile && (fileInsights.length > 0 || insightsLoading) && (
                <Box
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                  }}
                >
                  <Box
                    onClick={() => setInsightsOpen((v) => !v)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1,
                      py: 0.5,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <LightbulbIcon sx={{ fontSize: uiFontSize(14), color: 'warning.main', flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: uiFontSize(11), flex: 1 }}>
                      {insightsLoading
                        ? t('workbench.aiInsights.loading')
                        : t('workbench.aiInsights.title', { n: fileInsights.length })}
                    </Typography>
                    {insightsLoading ? (
                      <CircularProgress size={11} />
                    ) : insightsOpen ? (
                      <ExpandLessIcon sx={{ fontSize: uiFontSize(16) }} />
                    ) : (
                      <ExpandMoreIcon sx={{ fontSize: uiFontSize(16) }} />
                    )}
                  </Box>
                  {insightsOpen && (
                    <Box sx={{ maxHeight: 200, overflow: 'auto', pb: 0.5 }}>
                      {fileInsights.map((it) => (
                        <Box
                          key={it.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 0.5,
                            px: 1,
                            py: 0.4,
                            borderTop: 1,
                            borderColor: 'divider',
                          }}
                        >
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              mt: 0.7,
                              flexShrink: 0,
                              bgcolor:
                                it.severity === 'high' || it.severity === 'critical'
                                  ? 'error.main'
                                  : it.severity === 'medium'
                                    ? 'warning.main'
                                    : 'info.main',
                            }}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                fontSize: uiFontSize(11),
                                fontWeight: 600,
                                color: 'text.primary',
                                lineHeight: 1.4,
                              }}
                            >
                              {it.title}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25, alignItems: 'center' }}>
                              {it.freshness === 'stale' && (
                                <Chip
                                  size="small"
                                  label={t('workbench.aiInsights.stale')}
                                  color="warning"
                                  sx={{ height: 16, fontSize: uiFontSize(8.5) }}
                                />
                              )}
                              {it.status === 'resolved' && (
                                <Chip
                                  size="small"
                                  label={t('workbench.aiInsights.resolved')}
                                  color="default"
                                  sx={{ height: 16, fontSize: uiFontSize(8.5) }}
                                />
                              )}
                              {it.seenCount && it.seenCount > 1 && (
                                <Chip
                                  size="small"
                                  label={t('workbench.aiInsights.confirmed', { n: it.seenCount })}
                                  color="success"
                                  sx={{ height: 16, fontSize: uiFontSize(8.5) }}
                                />
                              )}
                              <Box sx={{ flex: 1 }} />
                              {/* 引用必须落到「当前视图那个输入框」：本栏已跨视图共用，若恒定写 setInput，
                          在改动视图点引用会把文本塞进不可见的对话输入框，用户看不到任何反应。 */}
                              <Button
                                size="small"
                                sx={{ fontSize: uiFontSize(9.5), minWidth: 0, px: 0.5, py: 0, lineHeight: 1.6 }}
                                onClick={() => citeIntoInput(`[已有洞察] ${it.title}\n${it.body}`)}
                              >
                                {t('workbench.aiInsights.cite')}
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
          <ChangeReviewBar
            activeRelPath={activeFile?.relPath ?? null}
            onOpenPath={onOpenPath}
            onAppliedChange={handleAppliedChange}
          />
          <VerifySection
            entries={verifyList}
            settled={verifySettled}
            onDismiss={dismissVerify}
            onToggleCanvas={toggleVerifyCanvas}
          />

          {/* 改动工作台引导（仅「直接改」模式内联在对话流顶部，对标 VS Code Copilot Edits：
          改动不再藏在独立 Tab，而是贴着对话出现；AI 用 apply_change 工具改文件后逐条保留/撤销。 */}
          {mode === 'edit' && (
            <Box
              sx={{
                mx: 1,
                mt: 0.5,
                px: 1,
                py: 0.75,
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: dark
                  ? 'rgb(var(--template-palette-primary-mainChannel) / 0.10)'
                  : 'rgb(var(--template-palette-primary-mainChannel) / 0.06)',
              }}
            >
              <Typography variant="caption" sx={{ fontSize: uiFontSize(11), fontWeight: 600, color: 'text.primary' }}>
                {t('workbench.aiEdits.title')}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 0.25,
                  fontSize: uiFontSize(10.5),
                  color: 'text.secondary',
                  lineHeight: 1.5,
                }}
              >
                {isBookScene ? t('workbench.aiEdits.bookIntro') : t('workbench.aiEdits.intro')}
              </Typography>
            </Box>
          )}

          {/* AI 内联改动预览横幅（对标 VS Code：改动直接在编辑器内红/绿展示，待确认） */}
          {pendingInline && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.5,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: dark ? 'rgba(63,185,80,0.10)' : 'rgba(63,185,80,0.12)',
              }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }} />
              <Typography variant="caption" sx={{ flex: 1, fontSize: uiFontSize(10.5), color: 'text.primary' }}>
                {t('workbench.aiApply.preview')}
              </Typography>
              <Button
                size="small"
                color="inherit"
                onClick={rejectInline}
                sx={{ fontSize: uiFontSize(10), minWidth: 0, px: 0.75, py: 0 }}
              >
                {t('workbench.aiApply.reject')}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={acceptInline}
                sx={{ fontSize: uiFontSize(10), minWidth: 0, px: 0.75, py: 0 }}
              >
                {t('workbench.aiApply.accept')}
              </Button>
            </Box>
          )}

          {/* 方案 A：书场景「AI 优化」（画布 AI，H3 方案预览流）——顶栏迁入后在本面板常驻入口，
          与 AI 助手同栏不同流：优化是「出方案→预览→应用/撤销」，不混进聊天 */}
          {isBookScene && onOpenCanvasAi && (
            <Box sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
              <Tooltip title={t('studio.canvasAi.tip')}>
                <Button
                  size="small"
                  variant="outlined"
                  fullWidth
                  startIcon={<AutoFixHighIcon sx={{ fontSize: uiFontSize(14) }} />}
                  onClick={onOpenCanvasAi}
                  sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
                >
                  {t('studio.canvasAi.button')}
                </Button>
              </Tooltip>
            </Box>
          )}

          {/* 消息列表 */}
          <Box ref={msgListRef} onScroll={handleMsgScroll} sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}>
            {!selectedConversationId && messages.length === 0 && !isStreaming && (
              <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 2, px: 1 }}>
                <SmartToyIcon sx={{ fontSize: uiFontSize(30), opacity: 0.3, color: 'primary.main' }} />
                {currentAgent ? (
                  <>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mt: 0.5,
                        fontSize: uiFontSize(12),
                        fontWeight: 700,
                        color: 'text.primary',
                      }}
                    >
                      {currentAgent.name}
                    </Typography>
                    {currentAgent.description && (
                      <Typography
                        variant="caption"
                        sx={{ display: 'block', mt: 0.25, fontSize: uiFontSize(10.5), lineHeight: 1.5 }}
                      >
                        {currentAgent.description}
                      </Typography>
                    )}
                    {/* 起步示例：空会话给几个可点提示词，打开即用（对标 VS Code 空聊天引导） */}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'center', mt: 1 }}>
                      {(isBookScene
                        ? resolvedTopic
                          ? topicStartersFor(genre ?? '', resolvedTopic)
                          : bookStartersFor(genre ?? '')
                        : codeStarters()
                      ).map((s) => (
                        <Chip
                          key={s.key}
                          size="small"
                          clickable
                          color="primary"
                          variant="outlined"
                          label={t(s.labelKey)}
                          onClick={() => citeIntoInput(s.prompt)}
                          sx={{ fontSize: uiFontSize(10), height: 22 }}
                        />
                      ))}
                    </Box>
                  </>
                ) : agents.length === 0 ? (
                  /* 开箱即用引导：未配置任何助手时给明确配置入口，而非空白死面板（R62 差距 D） */
                  <Box sx={{ mt: 0.5 }}>
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', fontSize: uiFontSize(12), fontWeight: 700, color: 'text.primary' }}
                    >
                      {t('workbench.aiOnboard.title')}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mt: 0.25,
                        fontSize: uiFontSize(10.5),
                        lineHeight: 1.5,
                        maxWidth: 260,
                        mx: 'auto',
                      }}
                    >
                      {t('workbench.aiOnboard.desc')}
                    </Typography>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<SettingsIcon />}
                      onClick={() => void emit('open-ai-settings')}
                      sx={{ mt: 1, fontSize: uiFontSize(11) }}
                    >
                      {t('workbench.aiOnboard.cta')}
                    </Button>
                  </Box>
                ) : (
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontSize: uiFontSize(11) }}>
                    {t('workbench.aiOnboard.pick')}
                  </Typography>
                )}
              </Box>
            )}
            {messages.map((msg) => (
              <Box
                key={msg.id}
                sx={{
                  mb: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  // 悬浮才亮起消息工具条（对标 VS Code：转录干净，动作随手可得）
                  '&:hover .ps-msg-actions': { opacity: 1 },
                }}
              >
                {/* 历史工具轨迹：AI 这轮读了哪些文件 / 改了哪儿，永久留在转录里（对标 VS Code Agent 步骤）。
                轨迹排在回答正文之前——它是「怎么得出这个结论的」，先因后果。 */}
                {msg.role === 'assistant' && (
                  <Box sx={{ width: '94%' }}>
                    <ToolStepList steps={parseToolTrace(msg.toolCalls)} onOpenPath={onOpenPath} />
                  </Box>
                )}
                <Box
                  sx={{
                    px: 1,
                    py: 0.5,
                    borderRadius: 1.5,
                    maxWidth: '94%',
                    border: 1,
                    borderColor: msg.role === 'user' ? 'primary.dark' : 'divider',
                    bgcolor:
                      msg.role === 'user'
                        ? dark
                          ? 'rgb(var(--template-palette-primary-mainChannel) / 0.15)'
                          : 'rgb(var(--template-palette-primary-mainChannel) / 0.08)'
                        : 'transparent',
                  }}
                >
                  {msg.role === 'user' ? (
                    /* 只显示用户真正打的那句话 + 上下文徽标（完整提示词可一键展开）：
                   落库正文含模式指令/[Workspace]/[上下文]/[画布作用域]，直接铺开转录没法读 */
                    <UserMessageBubble content={msg.content} />
                  ) : (
                    <MarkdownView
                      content={msg.content}
                      onCodeInsert={canApply ? onCodeInsert : undefined}
                      onCodeApply={canApply ? onCodeApply : undefined}
                      canApply={canApply}
                    />
                  )}
                </Box>
                {/* 消息级动作（R68）：复制人人有；重试只给最后一条回答、编辑重发只给最后一条请求 */}
                <MessageActions
                  role={msg.role === 'user' ? 'user' : 'assistant'}
                  canRetry={msg.role === 'assistant' && msg.id === lastAssistantId}
                  canEdit={msg.role === 'user' && msg.id === lastUserId}
                  disabled={isStreaming}
                  onCopy={() => void copyMessage(msg.id)}
                  onRetry={() => void retryLastTurn()}
                  onEdit={() => void editLastRequest()}
                  onDelete={() =>
                    setPendingMsgDelete({
                      id: msg.id,
                      role: msg.role,
                      // 预览只用来「认出删的是哪条」：去标签、压空白、截 80 字，不承担正文还原职责
                      preview: (msg.content ?? '')
                        .replace(/<[^>]*>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 80),
                    })
                  }
                />
                {/* B 深化：改动就地长在对话流——每条含代码块的助手消息下方挂一张「改动卡」，
                逐条 Accept/Discard（对标 VS Code Copilot Edits 的 diff 长在气泡下）。
                取代原「仅最新消息挂在顶部」的 composer，改动与它的回答不再割裂。 */}
                {msg.role === 'assistant' &&
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

            {isStreaming && currentStreamConversationId === selectedConversationId && (
              <Box sx={{ mb: 1 }}>
                {/* 流式实时轨迹与历史轨迹共用同一渲染：两处必须长得一样，否则流式结束的瞬间界面会「跳形」。
                流式期间不折叠（collapseOver 给足），用户正盯着 AI 干活。 */}
                <ToolStepList steps={toolCalls} onOpenPath={onOpenPath} collapseOver={999} />
                {streamingContent && (
                  <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: 1, borderColor: 'divider', maxWidth: '94%' }}>
                    <MarkdownView content={streamingContent} canApply={false} streaming />
                  </Box>
                )}
                {!streamingContent && toolCalls.length === 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5 }}>
                    <CircularProgress size={10} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: uiFontSize(10) }}>
                      {t('workbench.aiThinking')}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
            {/* 流错误回执：归属当前会话且不在流式中时，展示最近一轮错误 + 重试（错误优先于停止标注） */}
            {!isStreaming && lastStreamError && currentStreamConversationId === selectedConversationId && (
              <Alert
                severity="error"
                variant="outlined"
                sx={{ fontSize: uiFontSize(12), mb: 1, '& .MuiAlert-message': { py: 0.25 } }}
                action={
                  <Button
                    size="small"
                    color="error"
                    startIcon={<ReplayIcon sx={{ fontSize: uiFontSize(14) }} />}
                    onClick={() => void retryLastTurn()}
                  >
                    {t('ui.retry')}
                  </Button>
                }
              >
                {lastStreamError === 'timeout' ? t('workbench.aiTimeout') : lastStreamError}
              </Alert>
            )}
            {/* 停止回执：后端会保留「已吐出的部分回答」并落库，不标注的话用户分不清是答完了还是被自己截断了 */}
            {!isStreaming &&
              !lastStreamError &&
              stoppedConversationId &&
              stoppedConversationId === selectedConversationId && (
                <Chip
                  size="small"
                  icon={<StopIcon sx={{ fontSize: uiFontSize(12) }} />}
                  label={t('workbench.aiStopped')}
                  color="error"
                  variant="outlined"
                  sx={{ fontSize: uiFontSize(9.5), height: 20 }}
                />
              )}
            <div ref={listEndRef} />
          </Box>

          {/* 对话后「下一步建议」（对标 VS Code Copilot / Cursor：每次回答后给 follow-up）。
            只在最后一条助手消息已落定（非流式）时出现；点击把成型提示词预填进输入框，
            用户审阅后回车才发——避免误触消耗 token，更避免 edit/agent 模式误触改盘。 */}
          {followups.length > 0 && !isStreaming && (
            <Box sx={{ mb: 1, ml: '6%', display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
              <AutoAwesomeIcon sx={{ fontSize: uiFontSize(13), color: 'primary.main', flexShrink: 0 }} />
              <Typography variant="caption" sx={{ fontSize: uiFontSize(9.5), color: 'text.secondary', mr: 0.25 }}>
                {t('workbench.aiFollowup.title')}
              </Typography>
              {followups.map((f) => (
                <Chip
                  key={f.key}
                  size="small"
                  clickable
                  label={t(f.labelKey)}
                  onClick={() => citeIntoInput(f.prompt)}
                  sx={{ fontSize: uiFontSize(10), height: 22 }}
                />
              ))}
            </Box>
          )}

          {/* 作用域主动建议（比 VS Code 更强）：聚焦实体后，面板基于扫描事实主动给出可执行追问。
          原只在独立「改动」Tab 渲染，现并入对话流（仅「直接改」模式），避免与对话割裂。 */}
          {mode === 'edit' && scopeSuggestions.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5, px: 1, alignItems: 'center' }}>
              <LightbulbIcon sx={{ fontSize: uiFontSize(13), color: 'info.main' }} />
              <Typography variant="caption" sx={{ fontSize: uiFontSize(10), color: 'text.secondary' }}>
                {t('workbench.aiSuggest.title')}
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
                  sx={{ fontSize: uiFontSize(10), height: 22 }}
                />
              ))}
            </Box>
          )}

          {/* 统一输入栏（诊断条 + 快捷动作 + 输入框 + 斜杠菜单）：对话流唯一输入框，
          消除两视图各复制一套输入 UI 的行为发散（见 workbenchComponents.WorkbenchInputBar） */}
          <WorkbenchInputBar
            ctx={{ ...ctx, agents, selectedAgentId, selectAgent }}
            selection={selection}
            isStreaming={isStreaming}
          />

          {/* 应用改动：diff 预览 */}
          <Dialog open={!!diff} onClose={() => setDiff(null)} maxWidth="md" fullWidth>
            <DialogTitle sx={{ fontSize: uiFontSize(14) }}>
              {t('workbench.aiCode.diffTitle')}
              {diff?.rangeLabel ? ` · ${diff.rangeLabel}` : diff?.meta.path ? ` · ${diff.meta.path}` : ''}
            </DialogTitle>
            <DialogContent sx={{ p: 0 }}>
              <Box sx={{ height: '50vh' }}>
                <Suspense
                  fallback={
                    <Box sx={{ p: 2 }}>
                      <CircularProgress size={18} />
                    </Box>
                  }
                >
                  {diff && (
                    <DiffEditorLazy
                      height="100%"
                      language={monacoLanguageOf(activeFile?.language ?? 'plaintext')}
                      original={diff.original}
                      modified={diff.modified}
                      theme={dark ? 'vs-dark' : 'light'}
                      options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        fontSize: inlineDiffFont.fontSize,
                      }}
                    />
                  )}
                </Suspense>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button size="small" onClick={() => setDiff(null)}>
                {t('workbench.aiCode.discard')}
              </Button>
              <Button size="small" variant="contained" onClick={applyDiff}>
                {t('workbench.aiCode.keep')}
              </Button>
            </DialogActions>
          </Dialog>

          {/* 主动建议「一键直接发起」确认框（R16/R19 待续②）：替换原「只预填」交互，避免误触消耗额度；
          确认后带画布作用域直接 send（对话流内直接看流式回答）。原仅在独立「改动」Tab 渲染，现并入对话流。 */}
          <Dialog open={!!pendingSuggestion} onClose={() => setPendingSuggestion(null)} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontSize: uiFontSize(14) }}>{t('workbench.aiSuggest.launchTitle')}</DialogTitle>
            <DialogContent>
              <Typography
                variant="caption"
                sx={{ fontSize: uiFontSize(11), color: 'text.secondary', lineHeight: 1.6, display: 'block' }}
              >
                {t('workbench.aiSuggest.launchBody', { label: pendingSuggestion?.label ?? '' })}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button size="small" onClick={() => setPendingSuggestion(null)}>
                {t('workbench.aiSuggest.launchCancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  const p = pendingSuggestion?.prompt;
                  setPendingSuggestion(null);
                  if (p) void send(p);
                }}
              >
                {t('workbench.aiSuggest.launchOk')}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      }

      {/* 高危工具审批弹窗已上移到 App 层（`components/ui/ToolApprovalDialog`）：
          两处同时绑 `pendingToolApproval` 会双弹，故此处只留说明不再渲染。 */}
    </Box>
  );
}
