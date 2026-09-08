/**
 * 问题面板（Project Diagnostics）
 *
 * 对标 Zed `crates/diagnostics` 的 `ProjectDiagnosticsEditor` / `DiagnosticBlock`：
 * - 聚合**所有已打开文件**的实时诊断（来自 Monaco 标记，经 editorDiagnosticsStore 共享），
 *   与状态栏「问题」指示项同源（同一数据源，renderable≠useful 的闭环：计数 → 可浏览 → 可跳转）；
 * - 按文件分组、组内按位置排序（对齐 Zed：文件按路径排序 → 诊断按位置，不做严重度排序）；
 * - 每条诊断带严重度色条 + 消息 + 位置(file:line:col) + 来源/code，可点击跳转到编辑器对应行；
 * - 支持「隐藏警告」开关（对齐 Zed `include_warnings`：关闭后只显示错误）；
 * - 文件分组可折叠。
 *
 * 纯前端，零 Rust / 零契约 / 零新依赖。数据随 editorDiagnosticsStore 实时刷新。
 */
import { useCallback, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Collapse from "@mui/material/Collapse";
import Button from "@mui/material/Button";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useTheme } from "@mui/material/styles";
import { t } from "../../i18n";
import { useEditorDiagnosticsStore, type EditorDiagnostic } from "../../store/editorDiagnosticsStore";

interface WorkbenchProblemsPanelProps {
  onClose: () => void;
  /** 跳转：父组件负责把 relPath 反查 fileId 并 openTab 落到编辑器 revealLine */
  onJump: (relPath: string, line: number) => void;
}

/** 严重度配色（与 MonacoCodeEditor SEVERITY_RGB / 状态栏指示项一致） */
const SEV_COLOR: Record<"error" | "warning", string> = {
  error: "#f85149",
  warning: "#d29922",
};

interface FileGroup {
  relPath: string;
  name: string;
  diagnostics: EditorDiagnostic[]; // 已按 startLine/startColumn 排序
  errors: number;
  warnings: number;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export function WorkbenchProblemsPanel({ onClose, onJump }: WorkbenchProblemsPanelProps) {
  const dark = useTheme().palette.mode === "dark";
  const byRelPath = useEditorDiagnosticsStore((s) => s.byRelPath);
  const [includeWarnings, setIncludeWarnings] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo<FileGroup[]>(() => {
    const out: FileGroup[] = [];
    for (const [relPath, diags] of Object.entries(byRelPath)) {
      if (!diags || diags.length === 0) continue;
      const visible = diags.filter((d) => includeWarnings || d.severity !== "warning");
      if (visible.length === 0) continue;
      const sorted = [...visible].sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn);
      out.push({
        relPath,
        name: basename(relPath),
        diagnostics: sorted,
        errors: diags.filter((d) => d.severity === "error").length,
        warnings: diags.filter((d) => d.severity === "warning").length,
      });
    }
    out.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return out;
  }, [byRelPath, includeWarnings]);

  const totalErrors = useMemo(() => groups.reduce((s, g) => s + g.errors, 0), [groups]);
  const totalWarnings = useMemo(() => groups.reduce((s, g) => s + g.warnings, 0), [groups]);
  const hasProblems = groups.length > 0;

  const handleCopy = useCallback((d: EditorDiagnostic, relPath: string) => {
    const text = `${relPath}:${d.startLine}:${d.startColumn}\n${d.message}${d.source ? `\n(${d.source})` : ""}`;
    void navigator.clipboard?.writeText(text);
  }, []);

  return (
    <Box
      sx={{
        height: 260,
        flexShrink: 0,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* 头部：标题 + 聚合计数 + 隐藏警告开关 + 关闭 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          gap: 1,
        }}
      >
        <ReportProblemIcon sx={{ fontSize: 16, color: totalErrors > 0 ? SEV_COLOR.error : "text.disabled" }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: 13 }}>
          {t("workbench.problems.title")}
        </Typography>
        {totalErrors > 0 && (
          <Typography variant="caption" sx={{ color: SEV_COLOR.error, fontSize: 11.5 }}>
            {t("workbench.problems.errorsCount", { count: totalErrors })}
          </Typography>
        )}
        {includeWarnings && totalWarnings > 0 && (
          <Typography variant="caption" sx={{ color: SEV_COLOR.warning, fontSize: 11.5 }}>
            {t("workbench.problems.warningsCount", { count: totalWarnings })}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t("workbench.problems.warnToggleTip")}>
          <IconButton
            size="small"
            color={includeWarnings ? "warning" : "default"}
            onClick={() => setIncludeWarnings((v) => !v)}
          >
            <WarningAmberIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.close")}>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 主体：分组列表 */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", py: 0.5 }}>
        {!hasProblems && (
          <Box
            sx={{
              p: 2,
              color: "text.secondary",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <CheckCircleIcon sx={{ fontSize: 18, color: "success.main" }} />
            {totalWarnings > 0 && !includeWarnings
              ? t("workbench.problems.noErrors")
              : t("workbench.problems.empty")}
            {totalWarnings > 0 && !includeWarnings && (
              <Button size="small" onClick={() => setIncludeWarnings(true)}>
                {t("workbench.problems.showWarnings", { count: totalWarnings })}
              </Button>
            )}
          </Box>
        )}

        {hasProblems &&
          groups.map((g) => {
            const isCollapsed = collapsed[g.relPath];
            return (
              <Box key={g.relPath} sx={{ mb: 0.25 }}>
                {/* 文件分组头 */}
                <Box
                  onClick={() => setCollapsed((c) => ({ ...c, [g.relPath]: !c[g.relPath] }))}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    px: 1,
                    py: 0.25,
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRightIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  ) : (
                    <ExpandMoreIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  )}
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12.5 }}>
                    {g.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, ml: 0.5 }}>
                    {g.relPath}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {g.errors > 0 && (
                    <Typography variant="caption" sx={{ color: SEV_COLOR.error, fontSize: 11, fontWeight: 600 }}>
                      {g.errors}
                    </Typography>
                  )}
                  {includeWarnings && g.warnings > 0 && (
                    <Typography variant="caption" sx={{ color: SEV_COLOR.warning, fontSize: 11, fontWeight: 600, ml: 0.5 }}>
                      {g.warnings}
                    </Typography>
                  )}
                </Box>

                <Collapse in={!isCollapsed}>
                  {g.diagnostics.map((d, i) => (
                    <Box
                      key={`${g.relPath}:${d.startLine}:${d.startColumn}:${i}`}
                      onClick={() => onJump(g.relPath, d.startLine)}
                      sx={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 1,
                        pl: 3,
                        pr: 1,
                        py: 0.5,
                        ml: 1,
                        cursor: "pointer",
                        borderLeft: `3px solid ${SEV_COLOR[d.severity]}`,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{
                            fontSize: 12.5,
                            color: d.severity === "error" ? SEV_COLOR.error : SEV_COLOR.warning,
                            fontWeight: 500,
                          }}
                        >
                          {d.message}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                          {t("workbench.problems.line", { line: d.startLine, col: d.startColumn })}
                          {d.source ? ` · ${t("workbench.problems.source", { source: d.source })}` : ""}
                          {d.code ? ` [${d.code}]` : ""}
                        </Typography>
                      </Box>
                      <Tooltip title={t("workbench.problems.copyDiagnostic")}>
                        <IconButton
                          size="small"
                          sx={{ opacity: 0.45, "&:hover": { opacity: 1 } }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(d, g.relPath);
                          }}
                        >
                          <ContentCopyIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                </Collapse>
              </Box>
            );
          })}
      </Box>
    </Box>
  );
}
