// sight-folio: 工作台内联对话（对标 VS Code 的 Ctrl/⌘+I 内联对话）
//
// 选中一段代码 → 按 Ctrl/⌘+I 唤起编辑器内悬浮对话 → 发问 → 流式回答就地展示 →
// 代码块「应用到文件」（diff 预览后落盘）。这是工作台 AI 面板「对标 VS Code Copilot 内联聊天」的入口：
// 默认就地问答（ask 模式），输入 /fix、/doc、/generate 等斜杠命令即升级为改盘动作——与右侧面板同一套命令路由，
// 零行为漂移。
//
// 复用既有 agentStore 会话（线程连续，不新建后端通道）；apply 复用 WorkbenchAiPanel 导出的
// computeApplyDiff（与侧栏同一套 range-diff 逻辑，零新增依赖）。本组件为独立新增，不改动任何
// 既有面板，分析页零回归。

import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import CloseIcon from "@mui/icons-material/Close";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlined";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { useTheme } from "@mui/material/styles";

import { t } from "../../i18n";
import { useAgentStore } from "../../store/agentStore";
import { useToastStore } from "../../store/toastStore";
import { projectScanApi } from "../../services/tauri";
import { monacoLanguageOf } from "../../utils/languageMeta";
import type { EditorSelectionInfo, MonacoEditorHandle } from "./MonacoCodeEditor";
import {
  buildUserMessage,
  WORKBENCH_MODE_TOOLS,
  extractUserMessageView,
  type WorkbenchContext,
  type WorkbenchContextDiagnostic,
  type WorkbenchMode,
} from "./workbenchContext";
import { MarkdownView, type CodeBlockMeta } from "./aiMarkdown";
import { computeApplyDiff, computeInlineEdit } from "./WorkbenchAiPanel";
import { useEditorDiagnosticsStore } from "../../store/editorDiagnosticsStore";
import { parseSlashCommand } from "./workbenchSlashCommands";

const DiffEditorLazy = lazy(async () => {
  await import("./monacoSetup");
  const m = await import("@monaco-editor/react");
  return { default: m.DiffEditor };
});

// 浮动 widget 尺寸（VS Code 内联聊天：紧凑、锚定选区、不占整屏）
const WIDGET_W = 440;
const WIDGET_MAX_H = 360;

export interface InlineChatProps {
  open: boolean;
  onClose: () => void;
  /** 当前激活文件（来自编辑器标签页），无则内联提问仍可用但无法应用代码 */
  activeFile: {
    fileId: string;
    relPath: string;
    language: string | null;
    name: string;
    totalLines?: number;
  } | null;
  /** 当前编辑器选区（Ctrl/⌘+K 唤起时由 Body 透传） */
  selection: EditorSelectionInfo | null;
  /** 编辑器命令句柄（应用到文件时取全文做 range-diff） */
  editorRef: React.MutableRefObject<MonacoEditorHandle | null>;
  /** 展开右侧完整 AI 面板（内联视图仅显示本轮会话） */
  onOpenPanel: () => void;
}

interface DiffState {
  meta: CodeBlockMeta;
  original: string;
  modified: string;
  rangeLabel?: string;
  /** 被替换的原文片段（用于台账片段级撤销；插入场景为空） */
  replacedText?: string;
}

export function InlineChat({ open, onClose, activeFile, selection, editorRef, onOpenPanel }: InlineChatProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";

  const messages = useAgentStore((s) => s.messages);
  const streamingContent = useAgentStore((s) => s.streamingContent);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const interruptRequested = useAgentStore((s) => s.interruptRequested);

  const [input, setInput] = useState("");
  const [beforeCount, setBeforeCount] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  // VS Code 式内联 ghost-diff：AI 提议的改动直接投到编辑器（红/绿行），此状态保存待确认上下文。
  const [pendingInline, setPendingInline] = useState<{ meta: CodeBlockMeta; replacedText: string; rangeLabel: string } | null>(null);

  // 关闭浮窗前先回滚编辑器里的 ghost-diff（避免红/绿行残留），与右侧面板切换文件清理同源。
  const handleClose = useCallback(() => {
    editorRef.current?.clearInlineEdit?.();
    setPendingInline(null);
    onClose();
  }, [editorRef, onClose]);
  // 浮动 widget 视口位置（相对窗口，position:fixed 直接消费）。place=above 时用 translateY(-100%) 向上生长。
  const [pos, setPos] = useState<{ left: number; top: number; place: "above" | "below" } | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 计算浮窗锚点：优先落在选区上方（VS Code Ctrl/⌘+I 体感），选区太靠顶则改落下方，无选区则锚编辑器右上。
  const computePos = useCallback((): { left: number; top: number; place: "above" | "below" } => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const width = Math.min(WIDGET_W, vw - 24);
    const anchor = editorRef.current?.getSelectionAnchor() ?? null;
    if (anchor) {
      const left = Math.max(12, Math.min(anchor.left, vw - width - 12));
      if (anchor.top > 240) return { left, top: anchor.top - 10, place: "above" };
      return { left, top: anchor.top + anchor.height + 10, place: "below" };
    }
    const rect = editorRef.current?.getEditorRect() ?? null;
    const left = rect ? Math.max(12, Math.min(rect.right - width - 12, vw - width - 12)) : Math.max(12, vw - width - 24);
    const top = rect ? rect.top + 64 : 80;
    return { left, top, place: "below" };
  }, [editorRef]);

  // 打开时聚焦输入框、清空上一轮切片标记、定位浮窗；编辑器滚动 / 窗口缩放时重新锚定。
  useEffect(() => {
    if (open) {
      setBeforeCount(null);
      setPos(computePos());
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      const onScroll = () => setPos(computePos());
      const onResize = () => setPos(computePos());
      // 捕获阶段监听 window 滚动即可覆盖 Monaco 内部滚动容器（scroll 不冒泡，capture 能捕到）
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onResize);
      return () => {
        clearTimeout(id);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
      };
    }
  }, [open, computePos, editorRef]);

  // 仅展示本轮内联会话（beforeCount 之后的消息），与侧栏共享同一会话但视图聚焦
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, beforeCount]);

  const visibleMessages = useMemo(
    () => (beforeCount == null ? [] : messages.slice(beforeCount)),
    [messages, beforeCount],
  );

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
    async (text: string) => {
      // 与右侧面板同一套命令路由：行首 /cmd 升级为动作（强制模式 + 折叠正文 + 吃真实诊断），
      // 否则默认 ask（VS Code 式就地问答），零行为漂移。
      const trimmed = text.trim().replace(/^@(workspace|work)\s*/i, "");
      if (!trimmed || isStreaming) return;
      const slash = parseSlashCommand(trimmed);
      const effectiveMode: WorkbenchMode = slash ? slash.def.mode : "ask";
      const plainText = slash
        ? slash.def.buildText(slash.args, {
            activeFile: activeFile ? { relPath: activeFile.relPath, language: activeFile.language } : null,
            selection,
            diagnostics: activeFile ? (useEditorDiagnosticsStore.getState().byRelPath[activeFile.relPath] ?? []) : [],
          })
        : trimmed;
      // 命令正文自己内联了选区代码（embedSelection）时，抑制上下文块的二次选区注入，避免模型看到两份重复代码
      const suppressSelection = slash ? !!slash.def.embedSelection : false;
      const convId = await ensureConversation();
      if (!convId) return;
      // 记录发问前的消息数，本轮内联视图只显示这条提问及其后的回答
      setBeforeCount(useAgentStore.getState().messages.length);
      const diags: WorkbenchContextDiagnostic[] = activeFile
        ? (useEditorDiagnosticsStore.getState().byRelPath[activeFile.relPath] ?? []).map(
            (d): WorkbenchContextDiagnostic => ({
              message: d.message,
              severity: d.severity,
              line: d.startLine,
              code: d.code,
              source: d.source,
            }),
          )
        : [];
      const ctx: WorkbenchContext = {
        activeFile,
        selection: suppressSelection ? null : selection,
        attachments: [],
        mode: effectiveMode,
        facts: null,
        diagnostics: diags.length ? diags : undefined,
      };
      const message = buildUserMessage(ctx, plainText);
      // 按模式下发单次工具白名单：ask 只读+分析、edit 放开 apply_change（与 Agent 配置取交集，不越权）
      await useAgentStore.getState().sendMessage(convId, message, WORKBENCH_MODE_TOOLS[effectiveMode], null);
      setInput("");
    },
    [activeFile, selection, isStreaming, ensureConversation],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  const onCodeApply = useCallback(
    (meta: CodeBlockMeta) => {
      if (!activeFile) return;
      if (meta.path && meta.path !== activeFile.relPath) {
        useToastStore.getState().showToast(t("workbench.aiCode.applyOnlyCurrent"), "info");
        return;
      }
      const ed = editorRef.current;
      // 有实时编辑器且目标即当前文件 → VS Code 式「编辑器内 ghost-diff 预览」（红/绿行 + 就地 保留/放弃），
      // 不再弹独立 Dialog。Dialog 仅留给无编辑器 / 跨文件兜底（零回归）。
      if (ed) {
        ed.clearInlineEdit?.();
        const originalLines = ed.getValue().split("\n");
        const range = computeInlineEdit(originalLines, meta, selection, activeFile.relPath);
        if (range) {
          const replacedText =
            range.endLine < range.startLine ? "" : originalLines.slice(range.startLine - 1, range.endLine).join("\n");
          const rangeLabel = `${activeFile.relPath}:${range.startLine}${range.endLine !== range.startLine ? "-" + range.endLine : ""}`;
          ed.previewInlineEdit(range); // 绿行植入 + 红行打删线，待 acceptInlineEdit/rejectInlineEdit 确认
          setPendingInline({ meta, replacedText, rangeLabel });
          return;
        }
        useToastStore.getState().showToast(t("workbench.aiCode.applyNeedRange"), "info");
        return;
      }
      // 兜底：无实时编辑器 → 独立 diff Dialog（无原文可算 diff，computeApplyDiff 会回退提示）
      const original = "";
      const res = computeApplyDiff(original, meta, selection, activeFile.relPath);
      if (!res) {
        useToastStore.getState().showToast(t("workbench.aiCode.applyNeedRange"), "info");
        return;
      }
      setDiff({ meta, original, modified: res.modified, rangeLabel: res.rangeLabel, replacedText: res.replacedText });
    },
    [activeFile, editorRef, selection],
  );

  // 就地保留：编辑器已执行 acceptInlineEdit（绿行顶上、红行删），把最终内容写盘并进改动台账。
  const acceptInline = useCallback(async () => {
    if (!pendingInline || !activeFile) return;
    const ed = editorRef.current;
    if (!ed) {
      setPendingInline(null);
      return;
    }
    ed.acceptInlineEdit();
    const modified = ed.getValue();
    try {
      await projectScanApi.writeSourceFile(activeFile.fileId, modified, {
        origin: "ai-apply",
        reason: t("workbench.aiChanges.reasonInline", { range: pendingInline.rangeLabel }),
        oldText: pendingInline.replacedText,
        newText: pendingInline.meta.code,
        conversationId: useAgentStore.getState().selectedConversationId ?? undefined,
      });
      useToastStore.getState().showToast(t("workbench.aiCode.applied"), "success");
    } catch (e: any) {
      useToastStore.getState().showToast(t("workbench.aiCode.applyFail", { error: e?.message ?? String(e) }), "error");
    }
    setPendingInline(null);
  }, [pendingInline, activeFile, editorRef]);

  // 就地放弃：删掉绿行、红行（原样）保留，编辑器回到改动前状态。
  const rejectInline = useCallback(() => {
    editorRef.current?.rejectInlineEdit();
    setPendingInline(null);
    useToastStore.getState().showToast(t("workbench.aiApply.rejected"), "info");
  }, [editorRef]);

  const applyDiff = useCallback(async () => {
    if (!diff || !activeFile) return;
    try {
      // 与侧栏「应用到文件」一致：登记台账（reason/origin/oldText/newText），
      // 让内联聊天的改动也进 ai_code_changes —— 右侧 Edits 视图统一可见、可撤销。
      await projectScanApi.writeSourceFile(activeFile.fileId, diff.modified, {
        origin: "ai-apply",
        reason: t("workbench.aiChanges.reasonInline", { range: diff.rangeLabel ?? diff.meta.path ?? "" }),
        oldText: diff.replacedText,
        newText: diff.meta.code,
        conversationId: useAgentStore.getState().selectedConversationId ?? undefined,
      });
      useToastStore.getState().showToast(t("workbench.aiCode.applied"), "success");
    } catch (e: any) {
      useToastStore.getState().showToast(t("workbench.aiCode.applyFail", { error: e?.message ?? String(e) }), "error");
    }
    setDiff(null);
  }, [diff, activeFile]);

  if (!open) return null;

  return (
    <>
      {/* 透明遮罩：点击编辑器其它区域即关闭浮窗（VS Code 内联聊天点外部消失） */}
      <Box
        onClick={handleClose}
        sx={{ position: "fixed", inset: 0, zIndex: 1290, background: "transparent" }}
      />
      <Box
        ref={rootRef}
        sx={{
          position: "fixed",
          left: pos?.left ?? 40,
          top: pos?.top ?? 80,
          transform: pos?.place === "above" ? "translateY(-100%)" : undefined,
          width: WIDGET_W,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: WIDGET_MAX_H,
          display: "flex",
          flexDirection: "column",
          bgcolor: dark ? "rgba(13,17,23,0.98)" : "rgba(255,255,255,0.99)",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          boxShadow: "0 10px 30px rgba(0,0,0,0.30)",
          zIndex: 1300,
          overflow: "hidden",
        }}
      >
      {/* 头部 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <SmartToyIcon sx={{ fontSize: 15, color: "primary.main", flexShrink: 0 }} />
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11, flex: 1 }}>
          {t("workbench.aiInline.title")}
        </Typography>
        <Chip
          size="small"
          label={t("workbench.aiInline.binding")}
          sx={{ height: 18, fontSize: 10, fontWeight: 700, "& .MuiChip-label": { px: 0.75 } }}
        />
        <Tooltip title={t("workbench.aiInline.openPanel")}>
          <IconButton size="small" onClick={onOpenPanel} aria-label={t("workbench.aiInline.openPanel")}>
            <OpenInFullIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.aiInline.close")}>
          <IconButton size="small" onClick={handleClose} aria-label={t("workbench.aiInline.close")}>
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 模式/命令提示：默认问答，斜杠命令升级为改盘动作 */}
      <Box sx={{ px: 1, pb: 0.5 }}>
        <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
          {t("workbench.aiInline.hint")}
        </Typography>
      </Box>

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
          <Typography variant="caption" sx={{ flex: 1, fontSize: 10.5, color: "text.primary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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

      {/* 消息区（仅本轮内联会话） */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1 }}>
        {visibleMessages.length === 0 && !isStreaming && (
          <Box sx={{ textAlign: "center", color: "text.secondary", mt: 2 }}>
            <ChatBubbleOutlineIcon sx={{ fontSize: 30, opacity: 0.25 }} />
            <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontSize: 11 }}>
              {t("workbench.aiInline.empty")}
            </Typography>
          </Box>
        )}
        {visibleMessages.map((msg) => (
          <Box
            key={msg.id}
            sx={{ mb: 1, display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}
          >
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
                <Typography variant="caption" sx={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "primary.main" }}>
                  {extractUserMessageView(msg.content).text}
                </Typography>
              ) : (
                <MarkdownView
                  content={msg.content}
                  onCodeApply={onCodeApply}
                  canApply
                />
              )}
            </Box>
          </Box>
        ))}
        {isStreaming && (
          <Box sx={{ mb: 1 }}>
            {streamingContent && (
              <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: 1, borderColor: "divider", maxWidth: "94%" }}>
                <MarkdownView content={streamingContent} canApply={false} />
              </Box>
            )}
            {!streamingContent && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5 }}>
                <CircularProgress size={10} />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                  {t("workbench.aiInline.thinking")}
                </Typography>
              </Box>
            )}
          </Box>
        )}
        <div ref={listEndRef} />
      </Box>

      {/* 输入区 */}
      <Box sx={{ p: 1, borderTop: 1, borderColor: "divider", display: "flex", gap: 0.5, alignItems: "flex-end" }}>
        <TextField
          inputRef={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("workbench.aiInline.placeholder")}
          size="small"
          fullWidth
          multiline
          maxRows={4}
          disabled={isStreaming}
          sx={{ "& .MuiInputBase-root": { fontSize: 12, py: 0.5 }, "& .MuiOutlinedInput-notchedOutline": { borderRadius: 1.5 } }}
        />
        {isStreaming ? (
          <IconButton size="small" color="error" disabled={interruptRequested} onClick={() => useAgentStore.getState().requestInterrupt()} aria-label={t("workbench.aiInline.stop")}>
            <StopIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ) : (
          <IconButton size="small" color="primary" onClick={() => void send(input)} disabled={!input.trim()} aria-label={t("workbench.aiInline.send")}>
            <SendIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>

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
      </Box>
    </>
  );
}
