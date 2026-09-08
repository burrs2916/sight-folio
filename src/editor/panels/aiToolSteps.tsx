// project-sight: 转录内「工具步骤」渲染（对标 VS Code Copilot Agent 的 tool invocation steps）
//
// 为什么需要这个文件（Round 48 复盘结论）：
// 在 Agent / 直接改 模式下，AI 真正做的事情**不在正文里**——它读了哪些文件、搜了什么、
// 用 apply_change 改了哪一段，全部发生在工具调用里。此前面板只在 `isStreaming` 期间用一行
// 裸 Chip 显示 `名称 · 状态`，流式一结束 `loadMessages` 重刷转录，这段记录就整体消失：
//   1) 历史会话完全看不出 AI 动过什么（写盘工具是追责漏洞）；
//   2) 一行 Chip 没有入参 / 结果 / 展开，比它取代的旧 AiAgentPanel.ToolCallCard 还弱。
// VS Code 的做法是：工具步骤是转录的**一等内容**，永久留在消息里、可折叠、可点文件跳转。
// 本组件即此，并被「流式实时列表」与「历史消息回看」两处**共用**，保证两边长得一模一样。
//
// 落库格式 = `ToolCallEvent[]` 的 JSON（后端 commands/agent.rs 随助手消息写入
// `ai_messages.tool_calls`；字段名由 engine.rs 的 `rename_all = "camelCase"` 保证）。

import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
// 注意：本项目安装的 @mui/icons-material 没有 `CheckCircleOutline` / `ErrorOutline` 这两个入口
// （只有 `*Outlined` 后缀版），写成前者会直接 TS2307 编译失败。
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import TerminalIcon from "@mui/icons-material/Terminal";
import { t } from "../../i18n";
import { formatToolArguments } from "../../utils/toolCallDisplay";
import type { ToolCallEvent } from "../../services/tauri";

/** 单条步骤展开后结果文本的显示上限：project_context 之类工具能返回几十 KB，整段铺开会把面板顶爆 */
const RESULT_MAX_CHARS = 1200;

/**
 * 把落库的 `tool_calls` 字段解析成步骤数组。
 *
 * 容错优先：历史行是空串（Round 48 之前从没写过）、脏数据、非数组，一律当「没有轨迹」处理，
 * 绝不因为解析失败让整条消息渲染崩掉。
 */
export function parseToolTrace(raw: string | null | undefined): ToolCallEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ToolCallEvent => !!e && typeof e === "object" && typeof e.toolName === "string",
    );
  } catch {
    return [];
  }
}

/** 工具名 → 人话标签（对标 VS Code「Read file / Searched codebase」式动作描述） */
function toolLabel(name: string): string {
  const key = `workbench.aiTool.${name}`;
  const label = t(key);
  // i18n 未命中时 t() 回传 key 本身，此时退回原始工具名，别把 "workbench.aiTool.xxx" 摆给用户
  return label === key ? name : label;
}

/**
 * 从入参里挑出「主语」摆在标签后面（VS Code 在步骤行直接显示文件名/搜索词，不用展开就知道干了什么）。
 * 返回 `[摘要文本, 可跳转的相对路径]`——后者存在时摘要可点击。
 */
function argSummary(name: string, args: unknown): [string, string | null] {
  if (!args || typeof args !== "object") return ["", null];
  const a = args as Record<string, unknown>;
  const str = (k: string): string | null => (typeof a[k] === "string" && a[k] ? String(a[k]) : null);
  const num = (k: string): number | null => (typeof a[k] === "number" ? (a[k] as number) : null);

  const path = str("file_path");
  switch (name) {
    case "file_read": {
      const start = num("start_line");
      const end = num("end_line");
      const range = start && end ? `:${start}-${end}` : start ? `:${start}` : "";
      return path ? [`${path}${range}`, path] : ["", null];
    }
    case "apply_change": {
      const occ = num("occurrence");
      return path ? [`${path}${occ && occ > 1 ? ` #${occ}` : ""}`, path] : ["", null];
    }
    case "code_search": {
      const q = str("query") ?? "";
      const pattern = str("file_pattern");
      return [pattern ? `${q} · ${pattern}` : q, null];
    }
    case "symbol_lookup":
      return [[str("name"), str("kind")].filter(Boolean).join(" · "), null];
    case "architecture_query":
    case "project_context":
      return [str("query_type") ?? str("section_keys") ?? "", null];
    case "scan_records":
      return [str("analysis_id") ?? str("query_type") ?? "", null];
    case "impact_assess":
      return [[str("target_type"), str("target")].filter(Boolean).join(" · "), null];
    case "review_explain":
      return [str("rule_id") ?? str("finding") ?? "", null];
    case "context_insight":
      return [[str("action"), str("title")].filter(Boolean).join(" · "), null];
    default: {
      // 未知工具：优先展示看着像路径的字段，其次第一个短字符串入参
      if (path) return [path, path];
      const first = Object.values(a).find((v) => typeof v === "string" && v.length > 0 && v.length < 80);
      return [typeof first === "string" ? first : "", null];
    }
  }
}

/**
 * 把 run_command 工具的 `result` 字符串解析成结构化字段。
 * 后端 `tools.rs::RunCommandTool` 产出的格式固定为：
 *   `[run_command] cwd=<cwd>\n$ <command>\nexit_code=<n>\n<combined stdout/stderr>`
 * 被拒绝时则为 `[run_command] REFUSED — <reason>`（无 $ / exit_code）。
 * 用宽松正则解析，缺失字段降级为空，绝不因格式微调让整条步骤崩掉。
 */
interface RunCommandResult {
  refused: boolean;
  reason: string;
  cwd: string;
  command: string;
  exitCode: number | null;
  output: string;
}
function parseRunCommandResult(raw: string): RunCommandResult {
  const refused = raw.match(/^\[run_command\]\s*REFUSED\s*[—-]\s*([\s\S]*)$/);
  if (refused) {
    return { refused: true, reason: refused[1].trim(), cwd: "", command: "", exitCode: null, output: "" };
  }
  const cwdM = raw.match(/\[run_command\]\s*cwd=(.*)/);
  const cmdM = raw.match(/\n\$\s?(.*)/);
  const exitM = raw.match(/exit_code=(\d+)/);
  const cwd = cwdM ? cwdM[1].trim() : "";
  const command = cmdM ? cmdM[1].trim() : "";
  const exitCode = exitM ? parseInt(exitM[1], 10) : null;
  let output = "";
  const exitIdx = raw.indexOf("exit_code=");
  if (exitIdx >= 0) {
    const after = raw.slice(exitIdx);
    const nl = after.indexOf("\n");
    output = nl >= 0 ? after.slice(nl + 1) : "";
  } else if (cmdM) {
    output = raw.slice(raw.indexOf(cmdM[0]) + cmdM[0].length).trim();
  }
  return { refused: false, reason: "", cwd, command, exitCode, output: output.replace(/\n+$/, "") };
}

/**
 * run_command 输出渲染成「终端」风格块（对标 VS Code Agent / Cursor 把终端输出直接铺在对话里）：
 * 深色标题栏（终端图标 + Terminal + 目录 + 退出码徽标）+ 等宽正文（`$ command` + 输出，可滚动）。
 * 默认展开——终端输出是重点，不该再藏在一层 expand 后面。颜色用固定 hex，使亮/暗主题下都像真终端。
 */
function TerminalBlock({ raw }: { raw: string }) {
  const parsed = useMemo(() => parseRunCommandResult(raw), [raw]);
  const [open, setOpen] = useState(true);
  const exitCode = parsed.exitCode;
  const exitOk = exitCode !== null && exitCode === 0;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", mt: 0.25, bgcolor: "#0b0e14" }}>
      {/* 终端标题栏 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 0.75,
          py: 0.3,
          bgcolor: "#11151c",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <TerminalIcon sx={{ fontSize: 13, color: "#4ade80" }} />
        <Typography sx={{ fontSize: 9.5, color: "#e5e7eb", fontFamily: "monospace", fontWeight: 600 }}>
          {t("workbench.aiTerminal.title")}
        </Typography>
        {parsed.cwd && (
          <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <Typography sx={{ fontSize: 9, color: "#9ca3af", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("workbench.aiTerminal.cwd")}: {parsed.cwd}
            </Typography>
          </Box>
        )}
        {!parsed.cwd && <Box sx={{ flex: 1 }} />}
        {exitCode !== null && (
          <Chip
            size="small"
            label={`${t("workbench.aiTerminal.exit")} ${exitCode}`}
            color={exitOk ? "success" : "error"}
            sx={{ height: 16, fontSize: 8.5, fontFamily: "monospace", "& .MuiChip-label": { px: 0.5 } }}
          />
        )}
        <IconButton size="small" sx={{ p: 0.1, color: "#9ca3af" }} onClick={() => setOpen((v) => !v)}>
          {open ? <ExpandLessIcon sx={{ fontSize: 13 }} /> : <ExpandMoreIcon sx={{ fontSize: 13 }} />}
        </IconButton>
      </Box>
      {open && (
        <Box sx={{ p: 0.75, fontFamily: "monospace", fontSize: 9.5, lineHeight: 1.5, maxHeight: 240, overflow: "auto" }}>
          {parsed.refused ? (
            <Typography sx={{ color: "#fca5a5", fontSize: 9.5, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              ⚠ {t("workbench.aiTerminal.refused")}: {parsed.reason}
            </Typography>
          ) : (
            <>
              {parsed.command && (
                <Box sx={{ display: "flex", gap: 0.5, alignItems: "baseline" }}>
                  <Box component="span" sx={{ color: "#4ade80", flexShrink: 0 }}>$</Box>
                  <Box component="span" sx={{ color: "#e5e7eb", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{parsed.command}</Box>
                </Box>
              )}
              {parsed.output && (
                <Box
                  component="pre"
                  sx={{ m: 0, mt: 0.25, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#d1d5db", fontSize: 9.5, fontFamily: "monospace" }}
                >
                  {parsed.output}
                </Box>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

function StepRow({
  step,
  onOpenPath,
}: {
  step: ToolCallEvent;
  onOpenPath?: (relPath: string, line?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, jumpPath] = useMemo(
    () => argSummary(step.toolName, step.arguments),
    [step.toolName, step.arguments],
  );
  const argsText = useMemo(() => formatToolArguments(step.arguments), [step.arguments]);
  const running = step.status === "running";
  const failed = step.status === "error" || step.success === false;
  const result = step.result ?? "";
  const truncated = result.length > RESULT_MAX_CHARS;
  // 展开后才有内容可看：入参/结果任一非空
  const expandable = !!argsText || !!result;

  // 点击文件名跳转时带上起始行：AI 读的是第 120 行，跳到文件开头没意义
  const jumpLine =
    step.arguments && typeof step.arguments === "object"
      ? (() => {
          const v = (step.arguments as Record<string, unknown>).start_line;
          return typeof v === "number" ? v : undefined;
        })()
      : undefined;

  return (
    <Box sx={{ borderLeft: 2, borderColor: failed ? "error.main" : running ? "warning.main" : "success.main", pl: 0.75, mb: 0.25 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: 20 }}>
        {running ? (
          <CircularProgress size={10} />
        ) : failed ? (
          <ErrorOutlinedIcon sx={{ fontSize: 13, color: "error.main" }} />
        ) : (
          <CheckCircleOutlinedIcon sx={{ fontSize: 13, color: "success.main" }} />
        )}
        <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: "text.primary", whiteSpace: "nowrap" }}>
          {toolLabel(step.toolName)}
        </Typography>
        {summary && (
          <Typography
            variant="caption"
            onClick={jumpPath && onOpenPath ? () => onOpenPath(jumpPath, jumpLine) : undefined}
            sx={{
              fontSize: 10,
              fontFamily: "monospace",
              color: jumpPath && onOpenPath ? "primary.main" : "text.secondary",
              cursor: jumpPath && onOpenPath ? "pointer" : "default",
              textDecoration: jumpPath && onOpenPath ? "underline dotted" : "none",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={summary}
          >
            {summary}
          </Typography>
        )}
        {!summary && <Box sx={{ flex: 1 }} />}
        {jumpPath && onOpenPath && (
          <Tooltip title={t("workbench.aiToolStep.open")}>
            <IconButton size="small" sx={{ p: 0.1 }} onClick={() => onOpenPath(jumpPath, jumpLine)}>
              <OpenInNewIcon sx={{ fontSize: 12 }} />
            </IconButton>
          </Tooltip>
        )}
        {expandable && (
          <Tooltip title={open ? t("workbench.aiToolStep.collapse") : t("workbench.aiToolStep.expand")}>
            <IconButton size="small" sx={{ p: 0.1 }} onClick={() => setOpen((v) => !v)}>
              {open ? <ExpandLessIcon sx={{ fontSize: 13 }} /> : <ExpandMoreIcon sx={{ fontSize: 13 }} />}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {open && (
        <Box sx={{ pb: 0.5 }}>
          {argsText && (
            <>
              <Typography variant="caption" sx={{ display: "block", fontSize: 9, color: "text.secondary", mt: 0.25 }}>
                {t("workbench.aiToolStep.args")}
              </Typography>
              <Box
                component="pre"
                sx={{ m: 0, fontSize: 9.5, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflow: "auto", color: "text.secondary" }}
              >
                {argsText}
              </Box>
            </>
          )}
          {result && (
            <>
              <Typography variant="caption" sx={{ display: "block", fontSize: 9, color: "text.secondary", mt: 0.25 }}>
                {t("workbench.aiToolStep.result")}
              </Typography>
              <Box
                component="pre"
                sx={{ m: 0, fontSize: 9.5, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 160, overflow: "auto", color: failed ? "error.main" : "text.secondary" }}
              >
                {truncated ? `${result.slice(0, RESULT_MAX_CHARS)}\n…` : result}
              </Box>
              {truncated && (
                <Typography variant="caption" sx={{ display: "block", fontSize: 9, color: "text.secondary" }}>
                  {t("workbench.aiToolStep.truncated", { n: result.length })}
                </Typography>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

export interface ToolStepListProps {
  steps: ToolCallEvent[];
  /** 点击工具涉及的文件名时打开它（历史回看的关键：AI 改的往往不是当前标签） */
  onOpenPath?: (relPath: string, line?: number) => void;
  /** 步骤数超过该值时整组默认折叠，只留一行汇总（长 Agent 轨迹不至于把转录挤爆） */
  collapseOver?: number;
}

/**
 * 工具步骤列表。流式实时轨迹与历史消息轨迹共用同一渲染，避免两处长得不一样。
 */
export function ToolStepList({ steps, onOpenPath, collapseOver = 4 }: ToolStepListProps) {
  const shouldCollapse = steps.length > collapseOver;
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 0) return null;

  const failedCount = steps.filter((s) => s.status === "error" || s.success === false).length;
  const showAll = !shouldCollapse || expanded;

  return (
    <Box sx={{ mb: 0.5 }}>
      {shouldCollapse && (
        <Box
          onClick={() => setExpanded((v) => !v)}
          sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", py: 0.25 }}
        >
          {expanded ? <ExpandLessIcon sx={{ fontSize: 13 }} /> : <ExpandMoreIcon sx={{ fontSize: 13 }} />}
          <Typography variant="caption" sx={{ fontSize: 10, color: failedCount > 0 ? "error.main" : "text.secondary" }}>
            {failedCount > 0
              ? t("workbench.aiToolStep.summaryWithError", { n: steps.length, e: failedCount })
              : t("workbench.aiToolStep.summary", { n: steps.length })}
          </Typography>
        </Box>
      )}
      {showAll && steps.map((s, i) => <StepRow key={`${s.toolName}-${i}`} step={s} onOpenPath={onOpenPath} />)}
    </Box>
  );
}
