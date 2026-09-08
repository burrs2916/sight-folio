/**
 * 转到行对话框（对标 Zed crates/go_to_line）。
 *
 * 参考项目深度理解要点（zed-main/crates/go_to_line/src/go_to_line.rs）：
 *  - 模态单输入框，占位符显示当前 `line:column`；
 *  - 边输入边高亮目标行并居中滚动（highlight_current_line + autoscroll center），
 *    用户「落地前就能看到要去哪」——这正是 renderable≠useful 的落点；
 *  - 相对当前行导航：前导 `+`/`-`/`f`/`F`/`b`/`B`（取最后一个方向符，其余作数值）；
 *  - 绝对行:列：`12` 或 `12:3`；
 *  - 底部 help 文本随输入变更（"Go to line X (offset from current)" / "Go to line L, character C" / "Current Line: X of Y (column Z)"）；
 *  - 确认落光标并居中，取消还原滚动+清高亮。
 *
 * 差异化增强（renderable AND useful）：Zed 仅有编辑器内行高亮，我们额外给出
 * 可读的「当前行/总行数/列」与实时解析提示，且与命令面板、面包屑共享同一套导航心智。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Dialog, TextField, Typography } from "@mui/material";
import { t } from "../../i18n";
import type { MonacoEditorHandle } from "./MonacoCodeEditor";

type GotoParse =
  | { kind: "empty" }
  | { kind: "relative"; offset: number; targetLine: number }
  | { kind: "abs"; targetLine: number; targetColumn?: number }
  | { kind: "invalid"; raw: string };

/** 解析输入（对齐 Zed relative_line_from_query / line_and_char_from_query） */
function parseGoto(input: string, curLine: number, total: number): GotoParse {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "empty" };

  // 相对当前行：前导方向符 [+ - f F b B]（Zed 取最后一个方向符，其余部分作数值）
  let i = 0;
  let dir: string | null = null;
  while (i < trimmed.length) {
    const c = trimmed[i];
    if (c === "+" || c === "-" || c === "f" || c === "F" || c === "b" || c === "B") {
      dir = c;
      i++;
    } else break;
  }
  if (dir !== null) {
    const numPart = trimmed.slice(i).split(":")[0].trim();
    const value = parseInt(numPart, 10);
    if (numPart.length > 0 && Number.isFinite(value)) {
      const offset = dir === "+" || dir === "f" || dir === "F" ? value : -value;
      const targetLine = Math.max(1, curLine + offset);
      return { kind: "relative", offset, targetLine };
    }
  }

  // 绝对行（可带列）：12 或 12:3
  const [rowStr, colStr] = trimmed.split(":");
  const row = parseInt(rowStr.trim(), 10);
  if (Number.isFinite(row)) {
    const col = colStr !== undefined ? parseInt(colStr.trim(), 10) : NaN;
    const targetLine = Math.max(1, Math.min(row, total));
    const targetColumn = Number.isFinite(col) && col > 0 ? col : undefined;
    return { kind: "abs", targetLine, targetColumn };
  }
  return { kind: "invalid", raw: trimmed };
}

export function GotoLineDialog({
  open,
  onClose,
  editorHandleRef,
}: {
  open: boolean;
  onClose: () => void;
  editorHandleRef: React.MutableRefObject<MonacoEditorHandle | null>;
}) {
  const [query, setQuery] = useState("");
  const [cur, setCur] = useState<{ line: number; column: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [available, setAvailable] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时捕获光标行/列与总行数（对标 Zed GoToLine::new 记录 current_line/column/last_line）
  useEffect(() => {
    if (!open) return;
    const handle = editorHandleRef.current;
    const pos = handle?.getCursorPosition();
    const lc = handle?.getLineCount() ?? 0;
    setCur(pos ?? null);
    setTotal(lc);
    setAvailable(!!pos);
    setQuery("");
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open, editorHandleRef]);

  const parsed = useMemo(
    () => parseGoto(query, cur?.line ?? 1, total || 1),
    [query, cur, total]
  );

  const helpText = useMemo(() => {
    if (!available) return t("workbench.gotoLineUnavailable");
    switch (parsed.kind) {
      case "empty":
        return t("workbench.gotoLineHelpCurrent", {
          line: cur?.line ?? 1,
          total: total || 1,
          col: cur?.column ?? 1,
        });
      case "relative":
        return t("workbench.gotoLineHelpRelative", {
          line: parsed.targetLine,
          offset: (parsed.offset >= 0 ? "+" : "") + parsed.offset,
        });
      case "abs":
        return parsed.targetColumn
          ? t("workbench.gotoLineHelpLineColumn", {
              line: parsed.targetLine,
              col: parsed.targetColumn,
            })
          : t("workbench.gotoLineHelpLine", { line: parsed.targetLine });
      case "invalid":
        return t("workbench.gotoLineInvalid", { query: parsed.raw });
    }
  }, [parsed, cur, total, available]);

  // 输入即实时预览（滚动+高亮目标行，不改光标）；非法则清高亮（对标 Zed highlight_current_line）
  useEffect(() => {
    if (!open || !available) return;
    if (parsed.kind === "relative" || parsed.kind === "abs") {
      editorHandleRef.current?.previewLine(parsed.targetLine);
    } else {
      editorHandleRef.current?.clearLinePreview();
    }
  }, [parsed, open, available, editorHandleRef]);

  const handleClose = () => {
    editorHandleRef.current?.clearLinePreview();
    onClose();
  };

  const confirm = () => {
    if (!available) return handleClose();
    if (parsed.kind === "relative" || parsed.kind === "abs") {
      const col = parsed.kind === "abs" ? parsed.targetColumn : undefined;
      editorHandleRef.current?.gotoLineColumn(parsed.targetLine, col);
    }
    editorHandleRef.current?.clearLinePreview();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={false}
      slotProps={{
        paper: { sx: { width: 380, maxWidth: "92vw", mt: 10, mb: "auto" } },
      }}
    >
      {/* 转到行预览高亮样式（随对话框挂载/卸载，全局生效） */}
      <style>{`.goto-line-preview{background:rgba(239,159,39,0.22)!important;}`}</style>
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          disabled={!available}
          placeholder={available && cur ? `${cur.line}:${cur.column}` : ""}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </Box>
      <Box sx={{ px: 2, pb: 0.5, pt: 0.5 }}>
        <Typography variant="caption" color={parsed.kind === "invalid" ? "error" : "text.secondary"}>
          {helpText}
        </Typography>
      </Box>
      <Box
        sx={{
          px: 2,
          pb: 1,
          pt: 0.25,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="caption" color="text.disabled">
          {t("workbench.gotoLineFooter")}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          +N / -N / f / b · 行:列
        </Typography>
      </Box>
    </Dialog>
  );
}
