// sight-folio: AI 改动评审条（R47 P2-A，对标 VS Code Copilot 的 "Changed files" / Keep · Undo）
//
// 为什么必须有这一块 UI
// -------------------
// AI 在 Agent 模式下会自己写盘（这是刻意的：本项目的验证链路建立在磁盘之上——
// 写盘 → file_watcher → 增量重扫 → metrics/引用/技术债刷新。改动不落盘，AI 读不到
// 自己刚写的内容，「改完自动验证」的闭环整条断掉）。但只落盘不评审，等于让 AI 在用户
// 背后改代码：他既不知道动了哪几个文件，也无从反悔——只有一个覆盖式的 `.bak`。
//
// 本组件把后端 `ai_code_changes` 台账变成可操作的评审列表：**哪个文件、第几行、为什么改、
// 保留还是撤销**。撤销的安全判定全在后端（磁盘是否还是 AI 写下的那一份、能否只回滚这一处），
// 前端只呈现结果与措辞差异：整文还原说「已还原」，片段还原必须说清「只还原了这一处」，
// 因为文件里还留着别人后来的修改。
//
// 独立组件是为了零回归：AI 面板只多挂一行，分析页与既有面板一行未动。

import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CircularProgress from "@mui/material/CircularProgress";
import DifferenceIcon from "@mui/icons-material/Difference";
import CheckIcon from "@mui/icons-material/Check";
import UndoIcon from "@mui/icons-material/Undo";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useTheme } from "@mui/material/styles";
import { lazy, Suspense } from "react";

import { t } from "../../i18n";
import { useProjectStore } from "../../store/projectStore";
import { useAgentStore } from "../../store/agentStore";
import { useToastStore } from "../../store/toastStore";
import { codeChangeApi, type CodeChangeRow } from "../../services/tauri";
import { monacoLanguageOf } from "../../utils/languageMeta";
import { useCodeFont } from "../../hooks/useCodeFont";

const DiffEditorLazy = lazy(async () => {
  await import("./monacoSetup");
  const m = await import("@monaco-editor/react");
  return { default: m.DiffEditor };
});

export interface ChangeReviewBarProps {
  /** 当前打开的文件（本文件的改动排在最前，便于「我正看着的这个文件被改了什么」） */
  activeRelPath?: string | null;
  /** 跳到某个改动的位置（同文件用 revealLine，跨文件由工作台打开标签） */
  onOpenPath?: (relPath: string, line?: number) => void;
  /** 台账为空时渲染的占位（右侧 Edits 视图用它做智能空态；不传则直接隐藏，保持分析页原行为） */
  emptySlot?: React.ReactNode;
  /** 用户「保留」一处改动（即真正写盘）时回调，参数为该改动的文件 relPath。
   *  用于 AI 面板在落盘前快照事实、写后回读指标做「改动后自动验证」。可选，不影响分析页既有行为。 */
  onAppliedChange?: (relPath: string) => void;
}

export function ChangeReviewBar({ activeRelPath, onOpenPath, emptySlot, onAppliedChange }: ChangeReviewBarProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  // 代码区字号跟随「设置 → 字体大小」：此前两处 diff 各写死 11 / 12，抽屉切档位这边纹丝不动
  const compactDiffFont = useCodeFont("compact");
  const inlineDiffFont = useCodeFont("inlineDiff");
  const analysisId = useProjectStore((s) => s.activeAnalysisId);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const selectedConversationId = useAgentStore((s) => s.selectedConversationId);

  const [rows, setRows] = useState<CodeChangeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [diffRow, setDiffRow] = useState<CodeChangeRow | null>(null);
  // 回退本会话全部改动（对标 VS Code「Discard all」）：确认框状态
  const [confirmSession, setConfirmSession] = useState(false);
  // 方案 B：行内可折叠 diff（对标 Copilot Edits 的对话内联预览），与全屏 Dialog 并存
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!analysisId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      // 统一改动面板：拉全部（pending + kept），让侧栏 Edit 工具改的、用户在侧栏/内联
      // 点应用的改动都在这里可见、可撤销。kept 是「用户已确认」，仍保留撤销能力（安全网）。
      const list = await codeChangeApi.list(analysisId, undefined, 200);
      setRows(list);
    } catch {
      // 台账读失败不该阻塞对话：静默保持上一次结果（评审是辅助视图，不是主链路）
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  // 首次 + 分析切换时加载
  useEffect(() => {
    void load();
  }, [load]);

  // 每轮回答结束刷新一次：AI 的改动正是在这一轮里写盘的。
  // 只在 true → false 的下降沿触发，避免流式过程中反复查询。
  useEffect(() => {
    if (!isStreaming) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const sorted = useMemo(() => {
    const rank = (r: CodeChangeRow) => {
      const s = r.status === "pending" ? 0 : 1; // 待审置顶，已保留在后
      const a = activeRelPath && r.relPath === activeRelPath ? 0 : 1; // 当前打开的文件置顶
      return s * 2 + a;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [rows, activeRelPath]);

  // 本会话产生的改动（用于「回退本会话全部改动」）——台账已按 conversation_id 归并，纯前端过滤零新增查询
  const sessionRows = useMemo(
    () => (selectedConversationId ? rows.filter((r) => r.conversationId === selectedConversationId) : []),
    [rows, selectedConversationId],
  );

  const keep = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        // 落盘前先通知（AI 面板据此快照改动前事实）；快照取的是当前 store 值，必须在写盘前调用
        const row = rows.find((r) => r.id === id);
        if (row) onAppliedChange?.(row.relPath);
        await codeChangeApi.keep(id);
        setRows((prev) => prev.filter((r) => r.id !== id));
      } catch (e: any) {
        useToastStore.getState().showToast(String(e?.message ?? e), "error");
      } finally {
        setBusyId(null);
      }
    },
    [rows, onAppliedChange],
  );

  const keepAll = useCallback(async () => {
    if (!analysisId) return;
    setBusyId("*");
    try {
      // 落盘前逐条通知，供 AI 面板对每一处改动做「改动后自动验证」快照
      rows.forEach((r) => onAppliedChange?.(r.relPath));
      const n = await codeChangeApi.keep("", analysisId);
      setRows([]);
      useToastStore.getState().showToast(t("workbench.aiChanges.keptAll", { n }), "success");
    } catch (e: any) {
      useToastStore.getState().showToast(String(e?.message ?? e), "error");
    } finally {
      setBusyId(null);
    }
  }, [analysisId]);

  const revert = useCallback(async (row: CodeChangeRow) => {
    setBusyId(row.id);
    try {
      const out = await codeChangeApi.revert(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      // 措辞必须区分：片段回滚只还原了这一处，文件里仍留着后来的修改
      useToastStore
        .getState()
        .showToast(
          out.strategy === "snapshot"
            ? t("workbench.aiChanges.revertedFull", { file: row.relPath })
            : t("workbench.aiChanges.revertedFragment", { file: row.relPath }),
          "success",
        );
    } catch (e: any) {
      // 后端拒绝撤销时会说清原因（片段找不到 / 有歧义 / 文件已删），原样透出，
      // 不要压成一句「撤销失败」——用户需要知道该去看 .bak 还是手动改
      useToastStore.getState().showToast(String(e?.message ?? e), "error", 8000);
    } finally {
      setBusyId(null);
    }
  }, []);

  if (!analysisId) return null;
  if (rows.length === 0 && !loading) {
    if (emptySlot) {
      return (
        <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider", bgcolor: dark ? "rgb(var(--template-palette-primary-mainChannel) / 0.06)" : "rgb(var(--template-palette-primary-mainChannel) / 0.04)" }}>
          {emptySlot}
        </Box>
      );
    }
    return null;
  }

  return (
    <Box
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: dark ? "rgba(255,167,38,0.08)" : "rgba(255,167,38,0.10)",
      }}
    >
      {/* 头部：待审数量 + 全部保留 + 刷新 + 折叠 */}
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <DifferenceIcon sx={{ fontSize: 15, color: "warning.main" }} />
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11, flex: 1 }}>
          {t("workbench.aiChanges.title", { n: rows.length })}
        </Typography>
        <Button
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            void keepAll();
          }}
          disabled={busyId != null || rows.length === 0}
          sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}
        >
          {t("workbench.aiChanges.keepAll")}
        </Button>
        <Button
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmSession(true);
          }}
          disabled={busyId != null || sessionRows.length === 0}
          sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}
        >
          {t("workbench.aiChanges.revertSession")}
        </Button>
        <Tooltip title={t("workbench.aiChanges.refresh")}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              void load();
            }}
           aria-label={t("workbench.aiChanges.refresh")}>
            {loading ? <CircularProgress size={11} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
          </IconButton>
        </Tooltip>
        {open ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </Box>

      {open && (
        <Box sx={{ maxHeight: 220, overflow: "auto", pb: 0.5 }}>
          {sorted.map((row) => (
            <Box
              key={row.id}
              sx={{
                px: 1,
                py: 0.5,
                borderTop: 1,
                borderColor: "divider",
                opacity: busyId === row.id ? 0.5 : row.status === "kept" ? 0.62 : 1,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  onClick={() => onOpenPath?.(row.relPath, row.startLine || undefined)}
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: onOpenPath ? "pointer" : "default",
                    color: row.relPath === activeRelPath ? "primary.main" : "text.primary",
                    "&:hover": { textDecoration: onOpenPath ? "underline" : "none" },
                  }}
                  title={row.relPath}
                >
                  {row.relPath}
                  {row.startLine > 0 && `:${row.startLine}`}
                </Typography>
                <Chip
                  size="small"
                  label={
                    row.deltaLines >= 0
                      ? `+${row.deltaLines}`
                      : String(row.deltaLines)
                  }
                  color={row.deltaLines >= 0 ? "success" : "error"}
                  variant="outlined"
                  sx={{ fontSize: 9, height: 16 }}
                />
                {row.mode === "full" && (
                  <Tooltip title={t("workbench.aiChanges.fullHint")}>
                    <Chip size="small" label={t("workbench.aiChanges.full")} color="warning" sx={{ fontSize: 9, height: 16 }} />
                  </Tooltip>
                )}
                {row.approx && (
                  <Tooltip title={t("workbench.aiChanges.approxHint")}>
                    <Chip size="small" label={t("workbench.aiChanges.approx")} color="warning" variant="outlined" sx={{ fontSize: 9, height: 16 }} />
                  </Tooltip>
                )}
                {row.status === "kept" && (
                  <Chip size="small" label={t("workbench.aiChanges.kept")} variant="outlined" sx={{ fontSize: 9, height: 16, color: "text.disabled" }} />
                )}
              </Box>
              {row.reason && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", fontSize: 10, mt: 0.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={row.reason}
                >
                  {row.reason}
                </Typography>
              )}
              <Box sx={{ display: "flex", gap: 0.5, mt: 0.25 }}>
                <Tooltip title={t("workbench.aiChanges.inlineDiff")}>
                  <IconButton
                    size="small"
                    onClick={() => setExpandedId((v) => (v === row.id ? null : row.id))}
                    sx={{ fontSize: 10, minWidth: 0, p: 0.25 }}
                   aria-label={t("workbench.aiChanges.inlineDiff")}>
                    {expandedId === row.id ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                  </IconButton>
                </Tooltip>
                <Button
                  size="small"
                  startIcon={<DifferenceIcon sx={{ fontSize: 12 }} />}
                  onClick={() => setDiffRow(row)}
                  sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}
                >
                  {t("workbench.aiChanges.viewDiff")}
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  color="success"
                  startIcon={<CheckIcon sx={{ fontSize: 12 }} />}
                  disabled={busyId != null}
                  onClick={() => void keep(row.id)}
                  style={{ display: row.status === "kept" ? "none" : undefined }}
                  sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}
                >
                  {t("workbench.aiChanges.keep")}
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<UndoIcon sx={{ fontSize: 12 }} />}
                  disabled={busyId != null}
                  onClick={() => void revert(row)}
                  sx={{ fontSize: 10, minWidth: 0, px: 0.75, py: 0 }}
                >
                  {t("workbench.aiChanges.undo")}
                </Button>
              </Box>

              {/* 方案 B：行内可折叠 diff（对话流内联预览，替代只能开弹窗看 diff） */}
              {expandedId === row.id && (
                <Box
                  sx={{
                    mt: 0.5,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    overflow: "hidden",
                    bgcolor: dark ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.02)",
                  }}
                >
                  {row.mode === "patch" ? (
                    <Box sx={{ height: 160 }}>
                      <Suspense fallback={<Box sx={{ p: 1 }}><CircularProgress size={14} /></Box>}>
                        <DiffEditorLazy
                          height="100%"
                          language={monacoLanguageOf(languageOfPath(row.relPath))}
                          original={row.oldText}
                          modified={row.newText}
                          theme={dark ? "vs-dark" : "light"}
                          options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: compactDiffFont.fontSize, scrollBeyondLastLine: false }}
                        />
                      </Suspense>
                    </Box>
                  ) : (
                    <Typography variant="caption" sx={{ display: "block", fontSize: 10, p: 1, color: "text.secondary" }}>
                      {t("workbench.aiChanges.fullNoDiff", { before: row.beforeLines ?? 0, after: row.afterLines ?? 0 })}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* 片段 diff 预览：patch 模式直接比锚点前后（比整文 diff 可读得多；
          整文写入没有片段可比，只能引导用户去看文件本身） */}
      <Dialog open={!!diffRow} onClose={() => setDiffRow(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 14 }}>
          {t("workbench.aiChanges.diffTitle")}
          {diffRow ? ` · ${diffRow.relPath}${diffRow.startLine > 0 ? `:${diffRow.startLine}` : ""}` : ""}
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {diffRow?.mode === "patch" ? (
            <Box sx={{ height: "50vh" }}>
              <Suspense fallback={<Box sx={{ p: 2 }}><CircularProgress size={18} /></Box>}>
                <DiffEditorLazy
                  height="100%"
                  language={monacoLanguageOf(languageOfPath(diffRow.relPath))}
                  original={diffRow.oldText}
                  modified={diffRow.newText}
                  theme={dark ? "vs-dark" : "light"}
                  options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: inlineDiffFont.fontSize }}
                />
              </Suspense>
            </Box>
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ fontSize: 12 }}>
                {t("workbench.aiChanges.fullNoDiff", {
                  before: diffRow?.beforeLines ?? 0,
                  after: diffRow?.afterLines ?? 0,
                })}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {diffRow && onOpenPath && (
            <Button
              size="small"
              onClick={() => {
                onOpenPath(diffRow.relPath, diffRow.startLine || undefined);
                setDiffRow(null);
              }}
            >
              {t("workbench.aiChanges.openFile")}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" color="error" disabled={busyId != null} onClick={() => {
            const row = diffRow;
            setDiffRow(null);
            if (row) void revert(row);
          }}>
            {t("workbench.aiChanges.undo")}
          </Button>
          <Button size="small" variant="contained" onClick={() => {
            const row = diffRow;
            setDiffRow(null);
            if (row) void keep(row.id);
          }}>
            {t("workbench.aiChanges.keep")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 回退本会话全部改动（对标 VS Code「Discard all」）：撤销当前会话产生的所有 AI 改动，
          后端按落地逆序逐条还原（同文件锚点正确），确认后才写盘，零无提示的破坏性动作 */}
      <Dialog open={confirmSession} onClose={() => setConfirmSession(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 14 }}>{t("workbench.aiChanges.revertSessionTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary", lineHeight: 1.6, display: "block" }}>
            {t("workbench.aiChanges.revertSessionConfirm", { n: sessionRows.length })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setConfirmSession(false)}>{t("workbench.aiChanges.revertSessionCancel")}</Button>
          <Button
            size="small"
            variant="contained"
            color="error"
            disabled={busyId != null}
            onClick={async () => {
              setConfirmSession(false);
              if (!selectedConversationId) return;
              setBusyId("*");
              try {
                const paths = await codeChangeApi.revertByConversation(selectedConversationId);
                setRows((prev) => prev.filter((r) => r.conversationId !== selectedConversationId));
                useToastStore.getState().showToast(t("workbench.aiChanges.revertedSession", { n: paths.length }), "success");
              } catch (e: any) {
                useToastStore.getState().showToast(String(e?.message ?? e), "error", 8000);
              } finally {
                setBusyId(null);
              }
            }}
          >
            {t("workbench.aiChanges.revertSessionOk")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** 从路径后缀推语言（diff 高亮用；台账不存 language，避免与 files 表口径漂移） */
function languageOfPath(relPath: string): string {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    rs: "rust",
    py: "python",
    go: "go",
    java: "java",
    kt: "kotlin",
    cpp: "cpp",
    cc: "cpp",
    c: "c",
    h: "cpp",
    cs: "csharp",
    swift: "swift",
    rb: "ruby",
    vue: "vue",
    svelte: "svelte",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    sql: "sql",
    sh: "shell",
  };
  return map[ext] ?? "plaintext";
}
