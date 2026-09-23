// sight-folio: 工作台 AI 面板的纯展示组件与工具函数（从 WorkbenchAiPanel 拆出）。
//
// 拆分目的：WorkbenchAiPanel 单体曾达 2531 行，编排函数与展示组件/工具函数混在一起，
// 任何改动都易牵一发动全身，是后续对标 VS Code 深活的连续性风险点。本文件只放「无状态的
// 展示组件 + 纯工具函数 + 类型」，不持有会话状态；编排逻辑仍留在 WorkbenchAiPanel。
// 行为零改动，仅搬运。

import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Menu from "@mui/material/Menu";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import AssessmentIcon from "@mui/icons-material/Assessment";
import HubIcon from "@mui/icons-material/Hub";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import CloseIcon from "@mui/icons-material/Close";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import StopIcon from "@mui/icons-material/Stop";
import CodeIcon from "@mui/icons-material/Code";
import { useTheme } from "@mui/material/styles";

import { t } from "../../i18n";
import { L } from "../../ai/aiLang";
import { useVerifyOverlayStore } from "../../store/verifyOverlayStore";
import { useProjectStore } from "../../store/projectStore";
import { useAgentStore } from "../../store/agentStore";
import { getSlashCommands } from "./workbenchSlashCommands";
import type { WorkbenchMode } from "./workbenchContext";
import type { AiAgent } from "../../services/tauri";
import type { EditorSelectionInfo } from "./MonacoCodeEditor";
import type { EditorDiagnostic } from "../../store/editorDiagnosticsStore";

/** 轻量子序列模糊匹配（用于 # 附件选择器） */
export function fuzzyScore(text: string, q: string): number {
  const t = text.toLowerCase();
  const ql = q.toLowerCase();
  if (!ql) return 1;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < ql.length; qi++) {
    const ch = ql[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] === ch) {
        found = k;
        break;
      }
    }
    if (found < 0) return 0;
    if (found === ti) {
      streak++;
      score += 2 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    ti = found + 1;
  }
  return score - (t.length - ql.length) * 0.05;
}

/** 相对时间（用于对话历史列表）：刚发生 / 分钟 / 小时 / 天 / 日期 */
export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60000, h = 3600000, d = 86400000;
  if (diff < m) return L("刚刚", "just now");
  if (diff < h) return L(`${Math.floor(diff / m)} 分钟前`, `${Math.floor(diff / m)} min`);
  if (diff < d) return L(`${Math.floor(diff / h)} 小时前`, `${Math.floor(diff / h)} h`);
  if (diff < 7 * d) return L(`${Math.floor(diff / d)} 天前`, `${Math.floor(diff / d)} d`);
  const dt = new Date(ts);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/** 单文件「代码健康度」事实快照（供改动前后对比） */
export interface FileFacts {
  /** 单函数最高圈复杂度（maxFunctionCc 与文件总 CC 取大，至少抓住最坏函数） */
  cc: number;
  lines: number;
  fns: number;
  dead: number;
  clones: number;
  /** 该文件当前「未修复」审查发现数（targetType=file 且 targetId=fileId；排除死代码双算）。
   *  接进验证卡后，AI 改完代码能直接量化「是否引入了新 bug」——VS Code 没有的闭环维度。 */
  findings: number;
}

export interface VerifyEntry {
  id: string;
  relPath: string;
  status: "verifying" | "done";
  before: FileFacts;
  after?: FileFacts;
}

/**
 * 快照某文件的扫描事实（复杂度 / 行数 / 函数数 / 死代码 / 克隆组 / 审查发现）。
 * 直接读 projectStore 的最新值——写盘后 file-changes → 增量重扫会刷新这些字段，
 * 所以我们只需在「改动前」「改动后」各取一次就能算出 delta。
 */
export function snapshotFileFacts(fileId: string): FileFacts {
  const st = useProjectStore.getState();
  const metric = st.metrics.find((m) => m.fileId === fileId);
  const cc = metric ? Math.max(metric.maxFunctionCc || 0, metric.cyclomaticComplexity || 0) : 0;
  const fns = metric?.functionCount ?? 0;
  const lines = metric?.totalLines ?? 0;
  const dead = st.deadSymbols.filter((d) => d.fileId === fileId).length;
  const clones = new Set(st.clones.filter((c) => c.fileId === fileId).map((c) => c.groupId)).size;
  // 审查发现：targetType=file 的发现其 target_id 即 project_files.id（后端 review.rs 写入约定），
  // 因此可按 fileId 精确归并到文件，无需脆弱的 symbol→file 反查。排除死代码类避免与 deadSymbols 双算。
  const findings = st.findings.filter(
    (f) => f.status === "open" && f.targetType === "file" && f.targetId === fileId && f.ruleId !== "rule_dead_symbol",
  ).length;
  return { cc, lines, fns, dead, clones, findings };
}

export function factsSig(f: FileFacts): string {
  return `${f.cc}|${f.lines}|${f.fns}|${f.dead}|${f.clones}|${f.findings}`;
}

/** 「改动后自动验证」结果卡：列出发生变化维度的 before→after，按方向着色 */
export function VerifyDeltas({ before, after, relPath }: { before: FileFacts; after: FileFacts; relPath: string }) {
  const dims: { key: string; label: string; b: number; a: number; better: "down" | "up" | "none" }[] = [
    { key: "cc", label: t("workbench.aiVerify.cc"), b: before.cc, a: after.cc, better: "down" },
    { key: "lines", label: t("workbench.aiVerify.lines"), b: before.lines, a: after.lines, better: "none" },
    { key: "fns", label: t("workbench.aiVerify.fns"), b: before.fns, a: after.fns, better: "none" },
    { key: "dead", label: t("workbench.aiVerify.dead"), b: before.dead, a: after.dead, better: "down" },
    { key: "clones", label: t("workbench.aiVerify.clones"), b: before.clones, a: after.clones, better: "down" },
    { key: "findings", label: t("workbench.aiVerify.findings"), b: before.findings, a: after.findings, better: "down" },
  ];
  const changed = dims.filter((d) => d.b !== d.a);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
      <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>{relPath}：</Typography>
      {changed.map((d) => {
        const improved = d.better === "down" ? d.a < d.b : d.better === "up" ? d.a > d.b : false;
        const regressed = d.better === "down" ? d.a > d.b : d.better === "up" ? d.a < d.b : false;
        const color = improved ? "success.main" : regressed ? "error.main" : "text.secondary";
        return (
          <Chip
            key={d.key}
            size="small"
            label={`${d.label} ${d.b}→${d.a}`}
            sx={{ fontSize: 9, height: 16, color, borderColor: color, "& .MuiChip-label": { px: 0.5 } }}
            variant="outlined"
          />
        );
      })}
    </Box>
  );
}

/** 「本轮改动总账」：把本会话所有已结算的逐文件验证聚成一条会话级汇总（VS Code 没有的闭环汇总） */
export function VerifySummary({ entries }: { entries: { relPath: string; before: FileFacts; after: FileFacts }[] }) {
  // 单文件改动逐文件卡已讲清，聚合只在「跨多文件」时有意义，避免噪声。
  if (entries.length < 2) return null;
  let ccDown = 0, ccUp = 0, deadDown = 0, deadUp = 0, cloneDown = 0, cloneUp = 0, findingsDown = 0, findingsUp = 0;
  for (const e of entries) {
    if (e.after.cc < e.before.cc) ccDown++;
    else if (e.after.cc > e.before.cc) ccUp++;
    if (e.after.dead < e.before.dead) deadDown++;
    else if (e.after.dead > e.before.dead) deadUp++;
    if (e.after.clones < e.before.clones) cloneDown++;
    else if (e.after.clones > e.before.clones) cloneUp++;
    if (e.after.findings < e.before.findings) findingsDown++;
    else if (e.after.findings > e.before.findings) findingsUp++;
  }
  const chips: { label: string; tone: "ok" | "bad" | "neutral" }[] = [
    { label: t("workbench.aiVerify.summaryFiles", { n: entries.length }), tone: "neutral" },
  ];
  if (ccDown) chips.push({ label: t("workbench.aiVerify.summaryCcDown", { n: ccDown }), tone: "ok" });
  if (ccUp) chips.push({ label: t("workbench.aiVerify.summaryCcUp", { n: ccUp }), tone: "bad" });
  if (deadDown) chips.push({ label: t("workbench.aiVerify.summaryDeadDown", { n: deadDown }), tone: "ok" });
  if (deadUp) chips.push({ label: t("workbench.aiVerify.summaryDeadUp", { n: deadUp }), tone: "bad" });
  if (cloneDown) chips.push({ label: t("workbench.aiVerify.summaryCloneDown", { n: cloneDown }), tone: "ok" });
  if (cloneUp) chips.push({ label: t("workbench.aiVerify.summaryCloneUp", { n: cloneUp }), tone: "bad" });
  if (findingsDown) chips.push({ label: t("workbench.aiVerify.summaryFindingsDown", { n: findingsDown }), tone: "ok" });
  if (findingsUp) chips.push({ label: t("workbench.aiVerify.summaryFindingsUp", { n: findingsUp }), tone: "bad" });
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", px: 1, pb: 0.5 }}>
      <Typography variant="caption" sx={{ fontSize: 9.5, fontWeight: 700, color: "text.primary" }}>{t("workbench.aiVerify.summaryTitle")}：</Typography>
      {chips.map((c, i) => {
        const color = c.tone === "ok" ? "success.main" : c.tone === "bad" ? "error.main" : "text.secondary";
        const border = c.tone === "ok" ? "success.main" : c.tone === "bad" ? "error.main" : "divider";
        return (
          <Chip
            key={i}
            size="small"
            label={c.label}
            variant="outlined"
            sx={{ fontSize: 9, height: 16, color, borderColor: border, "& .MuiChip-label": { px: 0.5 } }}
          />
        );
      })}
    </Box>
  );
}

/** 「改动后自动验证」区块：改动落盘后回读扫描台账，量化本次改动影响（通用 IDE 插件没有的闭环） */
export function VerifySection({ entries, settled, onDismiss, onToggleCanvas }: { entries: VerifyEntry[]; settled: { relPath: string; before: FileFacts; after: FileFacts }[]; onDismiss: (id: string) => void; onToggleCanvas: () => void }) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const canvasEnabled = useVerifyOverlayStore((s) => s.enabled);
  if (entries.length === 0 && settled.length < 2) return null;
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: dark ? "rgba(76,175,80,0.08)" : "rgba(76,175,80,0.06)" }}>
      <VerifySummary entries={settled} />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.25 }}>
        <AssessmentIcon sx={{ fontSize: 14, color: "success.main" }} />
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 10.5, flex: 1, color: "text.primary" }}>{t("workbench.aiVerify.title")}</Typography>
        <Tooltip title={canvasEnabled ? t("workbench.aiVerify.canvasOn") : t("workbench.aiVerify.canvasOff")}>
          <IconButton size="small" onClick={onToggleCanvas} sx={{ p: 0.2 }}>
            {canvasEnabled ? <VisibilityIcon sx={{ fontSize: 14, color: "success.main" }} /> : <VisibilityOffIcon sx={{ fontSize: 14, color: "text.disabled" }} />}
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.aiVerify.tip")}>
          <Box sx={{ cursor: "help", display: "flex" }}>
            <LightbulbIcon sx={{ fontSize: 13, color: "text.secondary" }} />
          </Box>
        </Tooltip>
      </Box>
      {/* 图例：解释画布上 AI✓ / AI! 角标的含义（护城河对用户是「未知符号」unless 解释） */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, pb: 0.25, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
          <span style={{ ...legendBadge, color: "#22c55e", borderColor: "#22c55e" }}>AI✓</span>
          <Typography variant="caption" sx={{ fontSize: 8.5, color: "text.secondary" }}>{t("workbench.aiVerify.legendImproved")}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
          <span style={{ ...legendBadge, color: "#dc2626", borderColor: "#dc2626" }}>AI!</span>
          <Typography variant="caption" sx={{ fontSize: 8.5, color: "text.secondary" }}>{t("workbench.aiVerify.legendWorsened")}</Typography>
        </Box>
      </Box>
      {entries.map((e) => (
        <Box key={e.id} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, pb: 0.5, flexWrap: "wrap" }}>
          {e.status === "verifying" ? (
            <>
              <CircularProgress size={10} />
              <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>{t("workbench.aiVerify.verifying", { file: e.relPath })}</Typography>
            </>
          ) : e.after && factsSig(e.after) !== factsSig(e.before) ? (
            <VerifyDeltas before={e.before} after={e.after} relPath={e.relPath} />
          ) : (
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>{t("workbench.aiVerify.noChange")} · {e.relPath}</Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => onDismiss(e.id)} sx={{ p: 0.2 }}>
            <CloseIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}

/**
 * 作用域级影响面（比 VS Code 更强）：聚焦某文件后，按调用图反向闭包列出「改它会波及哪些文件」。
 * 纯前端消费 projectStore.callEdges（扫描时已加载），无需额外后端调用 / 权限；
 * 点击文件可经 onOpenPath 跳转到代码工作台查看。VS Code 的 AI 完全没有这层「爆炸半径」认知。
 */
export function ImpactSurfaceBlock({
  files,
  onOpenPath,
  enabled,
  onToggle,
}: {
  files: { fileId: string; relPath: string }[];
  onOpenPath?: (relPath: string, line?: number) => void;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "rgba(255,152,0,0.05)" }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
      >
        <HubIcon sx={{ fontSize: 14, color: "warning.main", flexShrink: 0 }} />
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, flex: 1, color: "text.primary" }}>
          {t("workbench.aiImpact.title", { n: files.length })}
        </Typography>
        {onToggle && (
          <Tooltip title={t("workbench.aiImpact.canvasToggleTip")}>
            <span onClick={(e) => e.stopPropagation()}>
              <IconButton size="small" onClick={() => onToggle(!enabled)} sx={{ p: 0.25, ml: 0.5 }}>
                {enabled ? (
                  <VisibilityIcon sx={{ fontSize: 15, color: "primary.main" }} />
                ) : (
                  <VisibilityOffIcon sx={{ fontSize: 15, color: "text.disabled" }} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {open ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </Box>
      {/* 图例：解释画布上靛蓝「波及」标记的语义（护城河对用户是「未知符号」unless 解释，与 verify 图例同形） */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, px: 1, pb: 0.25 }}>
        <span style={{ ...legendBadge, color: "#6366f1", borderColor: "#6366f1" }}>{t("workbench.aiImpact.canvasBadge")}</span>
        <Typography variant="caption" sx={{ fontSize: 8.5, color: "text.secondary" }}>{t("workbench.aiImpact.legend")}</Typography>
      </Box>
      {open && (
        <Box sx={{ px: 1, pb: 0.5, maxHeight: 200, overflow: "auto" }}>
          <Typography variant="caption" sx={{ display: "block", fontSize: 9.5, color: "text.secondary", mb: 0.25 }}>{t("workbench.aiImpact.hint")}</Typography>
          {files.map((f) => (
            <Box
              key={f.fileId}
              onClick={() => onOpenPath?.(f.relPath)}
              sx={{ display: "flex", alignItems: "center", gap: 0.25, px: 0.5, py: 0.2, cursor: onOpenPath ? "pointer" : "default", "&:hover": onOpenPath ? { bgcolor: "action.selected" } : {} }}
            >
              <CallSplitIcon sx={{ fontSize: 12, color: "text.disabled", flexShrink: 0 }} />
              <Typography variant="caption" sx={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "text.secondary" }}>{f.relPath}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** 模式标签（Ask/Direct/Agent），供头部模式组渲染。
 *  getter 而非模块级 const：L() 每次调用才读当前语言，const 会在模块加载时
 *  固化一次 → 切语言不刷新（历史教训 ×3，见 aiLang.ts 注释）。 */
export function modeLabel(m: WorkbenchMode): string {
  const zh: Record<WorkbenchMode, string> = { ask: "问答", edit: "直接改", agent: "代理" };
  const en: Record<WorkbenchMode, string> = { ask: "Ask", edit: "Direct", agent: "Agent" };
  return L(zh[m], en[m]);
}

/** 验证图例小药丸（与画布角标同形，仅用于面板内图例说明） */
export const legendBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 8.5,
  fontWeight: 700,
  lineHeight: 1,
  height: 14,
  padding: "0 3px",
  borderRadius: 3,
  border: "1px solid",
};

/**
 * VS Code 式「修复此错误」诊断条：把编辑器里真实的语法/类型错误暴露给用户，
 * 一键让 AI 以 edit 模式修复（apply_change 真实改盘，改动进台账供评审）。
 * 这是原面板（围着预计算扫描台账转）完全缺失、却最像传统 IDE 的能力。
 */
export function DiagnosticsStrip({ diagnostics, onFix }: { diagnostics: EditorDiagnostic[]; onFix: () => void }) {
  if (diagnostics.length === 0) return null;
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const first = diagnostics[0];
  return (
    <Box sx={{ px: 1, pt: 0.5 }}>
      <Box
        sx={{
          borderRadius: 1,
          border: 1,
          borderColor: errors.length > 0 ? "error.main" : "warning.main",
          bgcolor: (th) => (th.palette.mode === "dark" ? "rgba(248,81,73,0.08)" : "rgba(248,81,73,0.05)"),
          px: 1,
          py: 0.5,
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
          {errors.length > 0 && (
            <Chip size="small" label={t("workbench.aiDiag.errorCount", { n: errors.length })} color="error" sx={{ fontSize: 9.5, height: 18 }} />
          )}
          {warnings.length > 0 && (
            <Chip size="small" label={t("workbench.aiDiag.warnCount", { n: warnings.length })} color="warning" sx={{ fontSize: 9.5, height: 18 }} />
          )}
          <Typography
            variant="caption"
            sx={{
              fontSize: 10,
              color: "text.secondary",
              lineHeight: 1.4,
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {`L${first.startLine}: ${first.message}`}
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={onFix}
            sx={{ fontSize: 9.5, height: 20, minWidth: 0, px: 0.75 }}
          >
            {t("workbench.aiDiag.fix")}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * 统一输入栏（对标 VS Code Copilot Chat 的单一、连贯输入框）。
 *
 * 此前 Chat 视图与 Edits 视图各自复制了一整套「诊断条 + 快捷动作 + 输入框 + 斜杠菜单」
 * （约 250 行重复 JSX）。这是 R31 警告过的典型「跨视图共用 UI 写回输入框」发散源——
 * 一处修了 bug，另一处不会跟着动，最终导致两个视图行为漂移、面板「不像一个连贯的 IDE 面板」。
 *
 * 这里抽成单一组件，两个视图共用同一份状态寻址逻辑：所有写回都按 `ctx.view` 落到对应
 * （chat / edits）输入框，行为零改动，从根上消除发散。槽位（ctx）只暴露本组件真正需要的字段。
 */
export interface WorkbenchInputBarCtx {
  view: "chat" | "edits";
  input: string;
  setInput: (v: string) => void;
  editInput: string;
  setEditInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  editInputRef: React.RefObject<HTMLTextAreaElement>;
  submitInput: (raw: string) => void;
  detectHashMention: (v: string, origin: "chat" | "edits") => void;
  detectSlashCommand: (v: string, target: "chat" | "edits") => void;
  setSlashAnchor: (el: HTMLElement | null) => void;
  setSlashQuery: (v: string) => void;
  setSlashTarget: (t: "chat" | "edits") => void;
  slashAnchor: HTMLElement | null;
  slashQuery: string;
  slashTarget: "chat" | "edits";
  fileDiagnostics: EditorDiagnostic[];
  fixErrors: () => void;
  quickAction: (kind: "file" | "selection" | "test" | "review" | "fix" | "book-understand" | "book-explain-sel" | "book-polish" | "book-consistency" | "book-plot" | "book-consistency-world") => void;
  queued: string[];
  /** 书场景（novel-zh）：快捷动作与占位符切换为写作向文案 */
  isBookScene?: boolean;
  /** 模型覆盖：传统聊天 UI 把模型选择器放在底部、与输入框同区（而非藏在头部菜单），
   *  便于随时切换当前会话模型；affiliation（端点·供应商）在输入栏内从 store 现算，避免选错端点。 */
  /** 助手选择：从头部下沉到底部输入条、与输入框同行对齐（传统聊天/IDE composer 把助手选择器放在输入条一端）。 */
  agents: AiAgent[];
  selectedAgentId: string | null;
  selectAgent: (id: string | null) => void;
}

export function WorkbenchInputBar({
  ctx,
  selection,
  isStreaming,
}: {
  ctx: WorkbenchInputBarCtx;
  selection: EditorSelectionInfo | null;
  isStreaming: boolean;
}) {
  const interruptRequested = useAgentStore((s) => s.interruptRequested);
  const value = ctx.view === "edits" ? ctx.editInput : ctx.input;
  const setValue = ctx.view === "edits" ? ctx.setEditInput : ctx.setInput;
  const inputRef = ctx.view === "edits" ? ctx.editInputRef : ctx.inputRef;
  const placeholder =
    ctx.view === "edits"
      ? (ctx.isBookScene ? t("workbench.aiEdits.bookPlaceholder") : t("workbench.aiEdits.placeholder"))
      : (ctx.isBookScene ? t("workbench.aiInput.bookPlaceholder") : t("workbench.aiInput.placeholder"));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    ctx.detectHashMention(v, ctx.view);
    ctx.detectSlashCommand(v, ctx.view);
  };
  const submit = () => {
    ctx.submitInput(value);
    setValue("");
  };

  return (
    <>
      {ctx.fileDiagnostics.length > 0 && <DiagnosticsStrip diagnostics={ctx.fileDiagnostics} onFix={ctx.fixErrors} />}

      {/* 一体化 composer 卡片（对标主流 AI 聊天输入框：圆角大卡片 + 无边框编辑区 + 底部动作条）。
          快捷动作、助手选择、斜杠命令、发送/停止全部收进同一张卡，取代此前「分割线 + 裸 TextField」
          的粗放布局；聚焦时描边 + 光晕，行为（提交/斜杠/排队/中断）零改动。 */}
      <Box
        sx={{
          m: 1,
          mt: 0.5,
          borderRadius: "20px",
          border: 1,
          borderColor: "divider",
          bgcolor: (theme) => (theme.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"),
          px: 1.25,
          py: 1,
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
          transition: "border-color 120ms ease, box-shadow 120ms ease",
          "&:focus-within": {
            borderColor: "primary.main",
            boxShadow: (theme) =>
              `0 0 0 3px ${theme.palette.mode === "dark" ? "rgba(144,202,249,0.16)" : "rgba(25,118,210,0.12)"}`,
          },
        }}
      >
        {/* 卡片内第一排：编辑快捷动作 pill（左）+ 助手选择框（右） */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
          {ctx.isBookScene ? (
            <>
              {selection && (
                <>
                  <Chip size="small" clickable variant="outlined" label={t("workbench.aiExplainSelectionBook")} onClick={() => ctx.quickAction("book-explain-sel")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
                  <Chip size="small" clickable variant="outlined" label={t("workbench.aiPolishSelection")} onClick={() => ctx.quickAction("book-polish")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
                </>
              )}
              <Chip size="small" clickable variant="outlined" label={t("workbench.aiUnderstandChapter")} onClick={() => ctx.quickAction("book-understand")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
              <Chip size="small" clickable variant="outlined" label={t("workbench.aiConsistencyChapter")} onClick={() => ctx.quickAction("book-consistency")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
              <Chip size="small" clickable variant="outlined" label={t("workbench.aiPlotChapter")} onClick={() => ctx.quickAction("book-plot")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
              <Chip size="small" clickable variant="outlined" label={t("workbench.aiConsistencyWorld")} onClick={() => ctx.quickAction("book-consistency-world")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
            </>
          ) : (
            <>
              {selection && (
                <>
                  <Chip size="small" clickable variant="outlined" label={t("workbench.aiExplainSelection")} onClick={() => ctx.quickAction("selection")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
                  <Chip size="small" clickable variant="outlined" label={t("workbench.aiFixSelection")} onClick={() => ctx.quickAction("fix")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
                </>
              )}
              <Chip size="small" clickable variant="outlined" label={t("workbench.aiExplainFile")} onClick={() => ctx.quickAction("file")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
              <Chip size="small" clickable variant="outlined" label={t("workbench.aiGenTest")} onClick={() => ctx.quickAction("test")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
              <Chip size="small" clickable variant="outlined" label={t("workbench.aiReviewFile")} onClick={() => ctx.quickAction("review")} sx={{ fontSize: 10, height: 22, borderRadius: "11px" }} />
            </>
          )}
          <Box sx={{ flex: 1 }} />
          {ctx.agents.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 112, flexShrink: 0 }}>
              <Select
                value={ctx.selectedAgentId ?? ""}
                onChange={(e) => ctx.selectAgent((e.target.value as string) || null)}
                sx={{ fontSize: 11, "& .MuiOutlinedInput-notchedOutline": { border: "none" } }}
                displayEmpty
                MenuProps={{ sx: { "& .MuiPaper-root": { maxWidth: 300 }, "& .MuiMenuItem-root": { whiteSpace: "normal" } } }}
              >
                <MenuItem value="" disabled sx={{ fontSize: 11 }}>{t("workbench.aiAgent.none")}</MenuItem>
                {ctx.agents.map((a) => (
                  <MenuItem key={a.id} value={a.id} sx={{ fontSize: 11, flexDirection: "column", alignItems: "flex-start", py: 0.75, gap: 0.25 }}>
                    <Box component="span" sx={{ fontWeight: 600, lineHeight: 1.2 }}>{a.name}</Box>
                    {a.description && (
                      <Box component="span" sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1.4 }}>{a.description}</Box>
                    )}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        {/* 卡片内编辑区：无边框 textarea（焦点光晕由外层卡片承担） */}
        <TextField
          inputRef={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          size="small"
          fullWidth
          multiline
          minRows={2}
          maxRows={8}
          sx={{
            "& .MuiInputBase-root": { fontSize: 12.5, p: 0, py: 0.25, alignItems: "flex-start", "&::before, &::after": { display: "none" } },
            "& .MuiOutlinedInput-notchedOutline": { border: "none" },
            // 占位提示词左对齐（输入正文本身也是左对齐，保持统一）
            "& textarea::placeholder": { textAlign: "left", color: "text.secondary", opacity: 1 },
          }}
        />

        {/* 卡片内底部动作条：斜杠命令（左，圆形）+ 排队徽标与发送/停止（右，圆形填充） */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Tooltip title={t("workbench.aiSlash")}>
            <IconButton
              size="small"
              onClick={(e) => {
                if (ctx.view === "edits") {
                  ctx.setSlashTarget("edits");
                  ctx.setSlashQuery("");
                }
                ctx.setSlashAnchor(e.currentTarget);
              }}
              sx={{ width: 30, height: 30, borderRadius: "50%", color: "text.secondary", "&:hover": { color: "text.primary" } }}
            >
              <CodeIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          {ctx.queued.length > 0 && (
            <Tooltip title={t("workbench.aiQueue.queued")}>
              <Chip size="small" label={t("workbench.aiQueue.badge", { n: ctx.queued.length })} color="info" sx={{ fontSize: 9.5, height: 20 }} />
            </Tooltip>
          )}
          {isStreaming ? (
            <IconButton
              size="small"
              disabled={interruptRequested}
              onClick={() => useAgentStore.getState().requestInterrupt()}
              sx={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                bgcolor: "error.main",
                color: "error.contrastText",
                "&:hover": { bgcolor: "error.dark" },
                "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" },
              }}
            >
              <StopIcon sx={{ fontSize: 15 }} />
            </IconButton>
          ) : (
            <IconButton
              size="small"
              onClick={submit}
              disabled={!value.trim()}
              sx={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
                "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" },
              }}
            >
              <ArrowUpwardIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* 斜杠命令菜单（VS Code 式：输入 / 唤起，按前缀实时过滤；选中把「/cmd 」回填到对应输入框，
          真正的行为在 send 里由 parseSlashCommand 路由为动作——强制模式 + 折叠正文） */}
      <Menu anchorEl={ctx.slashAnchor} open={!!ctx.slashAnchor} onClose={() => ctx.setSlashAnchor(null)}>
        {getSlashCommands(ctx.isBookScene)
          .filter((s) => s.cmd.startsWith(ctx.slashQuery))
          .map((s) => (
            <MenuItem
              key={s.cmd}
              onClick={() => {
                const prefill = `/${s.cmd} `;
                if (ctx.slashTarget === "edits") {
                  ctx.setEditInput(prefill);
                  ctx.editInputRef.current?.focus();
                } else {
                  ctx.setInput(prefill);
                  ctx.inputRef.current?.focus();
                }
                ctx.setSlashAnchor(null);
              }}
            >
              <Box sx={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75 }}>
                  <Typography variant="caption" sx={{ fontFamily: "monospace", color: "primary.main", fontWeight: 700 }}>{`/${s.cmd}`}</Typography>
                  <Typography variant="caption" sx={{ fontSize: 11 }}>{s.label()}</Typography>
                </Box>
                <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary" }}>{s.description()}</Typography>
              </Box>
            </MenuItem>
          ))}
      </Menu>
    </>
  );
}
