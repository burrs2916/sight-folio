/**
 * 源码查看器（画布 / 面板 → 代码行的落地界面）
 *
 * 设计取舍：不引入 Monaco / CodeMirror。
 * 这里是「只读、看一眼、确认问题在哪」的场景，不是编辑器；
 * 引一个 3MB 的编辑器内核进来，首屏加载预算（需求 §9 要求 < 1.5s）直接崩掉。
 * 所以走轻量方案：正则分词着色 + 虚拟视窗只渲染可视区行。
 *
 * 提供三件事：
 * 1. 行号 + 目标行高亮 + 自动滚动定位
 * 2. 沟槽标记（审查发现 / 技术债 / 符号定义），点击可在标记间跳转
 * 3. 语法着色（注释 / 字符串 / 关键字 / 数字），语言无关的通用规则
 */

import { useEffect, useMemo, useRef, useState, memo } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SaveIcon from "@mui/icons-material/Save";
import { useSourceViewerStore, type SourceMark } from "../../store/sourceViewerStore";
import { useToastStore } from "../../store/toastStore";
import { t } from "../../i18n";
import { projectScanApi } from "../../services/tauri";
import { useProjectStore } from "../../store/projectStore";
import { MonacoCodeEditor } from "./MonacoCodeEditor";
import { useTheme } from "@mui/material/styles";

const LINE_H = 20;
/** 视窗外额外渲染的行数，滚动时不至于看到空白 */
const OVERSCAN = 30;

const MARK_COLOR: Record<SourceMark["severity"], string> = {
  error: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
  debt: "#f97316",
  symbol: "#8b5cf6",
};

/** 通用关键字表：覆盖 TS/JS/Rust/Python/Go/Java/C 的公共子集 */
const KEYWORDS = new Set([
  "abstract","as","async","await","break","case","catch","class","const","continue","crate","def",
  "default","del","elif","else","enum","except","export","extends","extern","false","final","finally",
  "fn","for","from","func","go","if","impl","implements","import","in","instanceof","interface","is",
  "let","loop","match","mod","move","mut","new","nil","none","not","null","or","package","pass","priv",
  "private","protected","pub","public","raise","ref","return","select","self","static","struct","super",
  "switch","this","throw","trait","true","try","type","typeof","unsafe","use","var","void","where",
  "while","with","yield","and","None","True","False",
]);

type Tok = { t: string; c: string | null };

/**
 * 单行分词着色
 *
 * 只做行内判断，不维护跨行块注释状态 —— 跨行状态会让虚拟滚动
 * 必须从头扫描才能知道第 N 行是否在注释里，代价远大于收益。
 * 代价是多行注释的中间行按普通代码着色，可以接受。
 */
function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const rest = line.slice(i);
    // 行注释
    if (rest.startsWith("//") || rest.startsWith("#") || rest.startsWith("--")) {
      out.push({ t: rest, c: "comment" });
      break;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      const seg = end >= 0 ? rest.slice(0, end + 2) : rest;
      out.push({ t: seg, c: "comment" });
      i += seg.length;
      continue;
    }
    // 字符串
    const q = line[i];
    if (q === '"' || q === "'" || q === "`") {
      let j = i + 1;
      while (j < n && (line[j] !== q || line[j - 1] === "\\")) j += 1;
      out.push({ t: line.slice(i, Math.min(j + 1, n)), c: "string" });
      i = j + 1;
      continue;
    }
    // 标识符 / 关键字
    if (/[A-Za-z_$]/.test(q)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      out.push({ t: word, c: KEYWORDS.has(word) ? "kw" : null });
      i = j;
      continue;
    }
    // 数字
    if (/[0-9]/.test(q)) {
      let j = i;
      while (j < n && /[0-9a-fA-FxX._]/.test(line[j])) j += 1;
      out.push({ t: line.slice(i, j), c: "num" });
      i = j;
      continue;
    }
    out.push({ t: q, c: null });
    i += 1;
  }
  return out;
}

const TOKEN_SX: Record<string, string> = {
  comment: "#6b7280",
  string: "#10b981",
  kw: "#c084fc",
  num: "#f59e0b",
};

const CodeLine = memo(function CodeLine({
  no,
  text,
  active,
  mark,
  onClick,
}: {
  no: number;
  text: string;
  active: boolean;
  mark?: SourceMark;
  onClick: () => void;
}) {
  const toks = useMemo(() => tokenize(text), [text]);
  return (
    <Box
      onClick={onClick}
      sx={{
        display: "flex",
        height: LINE_H,
        lineHeight: `${LINE_H}px`,
        cursor: "pointer",
        bgcolor: active ? "rgba(250, 204, 21, 0.16)" : "transparent",
        borderLeft: `3px solid ${mark ? MARK_COLOR[mark.severity] : active ? "#facc15" : "transparent"}`,
        "&:hover": { bgcolor: active ? "rgba(250,204,21,0.22)" : "rgba(148,163,184,0.10)" },
      }}
    >
      <Box
        sx={{
          width: 58,
          flexShrink: 0,
          textAlign: "right",
          pr: 1.2,
          color: active ? "#facc15" : "text.disabled",
          fontWeight: active ? 700 : 400,
          userSelect: "none",
        }}
      >
        {no}
      </Box>
      <Box sx={{ whiteSpace: "pre", flex: 1, pr: 2 }}>
        {toks.map((tk, i) => (
          <span key={i} style={tk.c ? { color: TOKEN_SX[tk.c] } : undefined}>
            {tk.t}
          </span>
        ))}
      </Box>
    </Box>
  );
});

export function SourceViewerDialog() {
  const { open, loading, error, content, targetLine, reason, marks, seq } = useSourceViewerStore();
  const close = useSourceViewerStore((s) => s.close);
  const jumpTo = useSourceViewerStore((s) => s.jumpTo);
  const setState = useSourceViewerStore.setState;
  const showToast = useToastStore((s) => s.showToast);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  // R46 IDE 基础层：只读查看（轻量）↔ 编辑（Monaco 懒加载）双模式
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const themeMode = useTheme().palette.mode;

  // 打开新文件时退出编辑模式（编辑态是「当前文件」的局部状态）
  useEffect(() => {
    setEditMode(false);
    setDraft(null);
  }, [content?.fileId, open]);

  const lines = content?.lines ?? [];
  const markByLine = useMemo(() => {
    const m = new Map<number, SourceMark>();
    for (const k of marks) if (!m.has(k.line)) m.set(k.line, k);
    return m;
  }, [marks]);

  // 目标行滚动到视窗上三分之一处（不是顶端 —— 需要看到上下文）
  useEffect(() => {
    if (!open || !targetLine || lines.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const want = Math.max(0, (targetLine - 1) * LINE_H - el.clientHeight / 3);
    el.scrollTo({ top: want, behavior: "smooth" });
  }, [open, targetLine, lines.length, seq]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) setViewH(el.clientHeight || 600);
  }, [open, content]);

  const sortedMarks = useMemo(() => [...marks].sort((a, b) => a.line - b.line), [marks]);
  const gotoAdjacentMark = (dir: 1 | -1) => {
    if (sortedMarks.length === 0) return;
    const cur = targetLine ?? 0;
    const next =
      dir === 1
        ? sortedMarks.find((m) => m.line > cur) ?? sortedMarks[0]
        : [...sortedMarks].reverse().find((m) => m.line < cur) ?? sortedMarks[sortedMarks.length - 1];
    jumpTo(next.line, next.label);
  };

  // 虚拟滚动窗口
  const first = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scrollTop + viewH) / LINE_H) + OVERSCAN);
  const slice = lines.slice(first, last);

  const copyPath = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content.path);
      showToast(t("viewer.copiedPath", { path: content.relPath }), "success");
    } catch {
      showToast(t("viewer.copyFail"), "warning");
    }
  };

  // R46 P1：保存草稿 → 后端受控写盘（.bak 备份）→ 刷新查看器内容。
  // 写盘后 file_watcher 会 emit file-changes，前端 handleFileChanges 走增量重扫。
  const [saving, setSaving] = useState(false);
  const saveDraft = async () => {
    if (!content || draft === null || saving) return;
    if (draft === content.lines.join("\n")) {
      showToast(t("viewer.noChange"), "info");
      return;
    }
    setSaving(true);
    try {
      const res = await projectScanApi.writeSourceFile(content.fileId, draft);
      // 写盘成功：刷新查看器为最新磁盘内容
      setState((s) => {
        s.content = {
          ...(s.content ?? content),
          lines: draft.split("\n"),
          totalLines: res.newLines,
          truncated: false,
        };
      });
      setDraft(null);
      // 增量重扫由 file_watcher 驱动：write_file 已 emit file-changes，
      // 前端 handleFileChanges 走增量链路（依赖→结构→引用→度量→技术债→克隆）。
      // 若当前 analysis 未开启 watch，提示用户开启文件监视以自动重扫。
      const pj = useProjectStore.getState();
      if (!pj.watching) {
        showToast(t("viewer.savedNoWatch"), "info");
      }
      showToast(
        t("viewer.saved", {
          delta: res.deltaLines > 0 ? `+${res.deltaLines}` : String(res.deltaLines),
          backup: res.backupPath ? t("viewer.backupHint") : "",
        }),
        "success"
      );
    } catch (e) {
      showToast(t("viewer.saveFail", { error: e instanceof Error ? e.message : String(e) }), "error");
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S / Cmd+S 保存（编辑模式）
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, draft, content, saving]);

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { height: "86vh", maxHeight: "86vh" } } }}
    >
      <DialogTitle sx={{ py: 1.2, pr: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                {content?.name ?? t("viewer.sourceCode")}
              </Typography>
              {content?.language && (
                <Chip size="small" label={content.language} sx={{ height: 18, fontSize: 10 }} />
              )}
              {targetLine && (
                <Chip
                  size="small"
                  color="warning"
                  label={t("viewer.lineLabel", { n: targetLine })}
                  sx={{ height: 18, fontSize: 10 }}
                />
              )}
            </Box>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {content?.relPath}
              {content ? t("viewer.totalLines", { n: content.totalLines }) : ""}
              {reason ? ` · ${reason}` : ""}
            </Typography>
          </Box>
          {sortedMarks.length > 0 && (
            <>
              <Chip
                size="small"
                label={t("viewer.marks", { n: sortedMarks.length })}
                sx={{ height: 20, fontSize: 10 }}
              />
              <Tooltip title={t("viewer.prevMark")}>
                <IconButton size="small" onClick={() => gotoAdjacentMark(-1)}>
                  <KeyboardArrowUpIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("viewer.nextMark")}>
                <IconButton size="small" onClick={() => gotoAdjacentMark(1)}>
                  <KeyboardArrowDownIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip title={t(editMode ? "viewer.viewMode" : "viewer.editMode")}>
            <IconButton
              size="small"
              onClick={() => {
                if (!content) return;
                // 进入编辑模式时用当前内容初始化草稿（若已编辑则保留）
                if (!editMode && draft === null) setDraft(content.lines.join("\n"));
                setEditMode((m) => !m);
              }}
              disabled={!content || !!content.skippedReason}
            >
              {editMode ? <VisibilityIcon fontSize="small" /> : <EditIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          {editMode && (
            <Tooltip title={t("viewer.saveHint")}>
              <IconButton size="small" color="primary" onClick={() => void saveDraft()} disabled={saving}>
                <SaveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t("viewer.copyPath")}>
            <IconButton size="small" onClick={copyPath} disabled={!content}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={close}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, gap: 1.5 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              {t("viewer.loading")}
            </Typography>
          </Box>
        )}

        {!loading && error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {t("viewer.loadFail", { error })}
          </Alert>
        )}

        {!loading && !error && content?.skippedReason && (
          <Alert severity="info" sx={{ m: 2 }}>
            {content.skippedReason}
          </Alert>
        )}

        {!loading && !error && content && !content.skippedReason && (
          <>
            {editMode ? (
              // R46：Monaco 编辑模式（懒加载；语法高亮 + 错误波浪线 + 编辑）
              <Box sx={{ flex: 1, minHeight: 0, bgcolor: themeMode === "dark" ? "#0d1117" : "#ffffff" }}>
                <MonacoCodeEditor
                  value={draft ?? content.lines.join("\n")}
                  language={content.language}
                  theme={themeMode}
                  onChange={(v) => setDraft(v ?? null)}
                  readOnly={false}
                  revealLine={targetLine}
                />
              </Box>
            ) : (
            <>
            {content.truncated && (
              <Alert severity="warning" sx={{ borderRadius: 0, py: 0.3 }}>
                {t("viewer.truncated", { total: content.totalLines, shown: content.lines.length })}
              </Alert>
            )}
            <Box
              ref={scrollRef}
              onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
              sx={{
                flex: 1,
                overflow: "auto",
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, monospace',
                fontSize: 12.5,
                bgcolor: (t) => (t.palette.mode === "dark" ? "#0d1117" : "#fafafa"),
              }}
            >
              {/* 用上下占位撑出总高度，中间只渲染可视区的行 */}
              <Box sx={{ height: first * LINE_H }} />
              {slice.map((text, i) => {
                const no = first + i + 1;
                return (
                  <CodeLine
                    key={no}
                    no={no}
                    text={text}
                    active={no === targetLine}
                    mark={markByLine.get(no)}
                    onClick={() => jumpTo(no, null)}
                  />
                );
              })}
              <Box sx={{ height: Math.max(0, (lines.length - last) * LINE_H) }} />
            </Box>
            </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
