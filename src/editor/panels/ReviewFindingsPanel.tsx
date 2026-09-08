// project-sight: 审查结果面板
// 展示当前分析的所有审查结果，按严重度分组，支持筛选和排序
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorIcon from "@mui/icons-material/Error";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RuleIcon from "@mui/icons-material/Rule";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useProjectStore } from "../../store/projectStore";
import { useToastStore } from "../../store/toastStore";
import { useEditorStore } from "../../store/editorStore";
import { findComponentForFile, findComponentForModule } from "../utils/canvasLink";
import { navigateToSource, navigateToModule, readLineFromMetadata } from "../utils/sourceNavigate";
import { topDirOf } from "../utils/architectureMetrics";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import type { ReviewFinding } from "../../services/tauri";
import { t } from "../../i18n";

const SEVERITY_ORDER = ["critical", "warning", "info"] as const;

const SEVERITY_CONFIG: Record<
  string,
  { color: "error" | "warning" | "info" | "default"; icon: React.ReactNode }
> = {
  critical: {
    color: "error",
    icon: <ErrorIcon sx={{ fontSize: 16 }} />,
  },
  warning: {
    color: "warning",
    icon: <WarningAmberIcon sx={{ fontSize: 16 }} />,
  },
  info: {
    color: "info",
    icon: <InfoOutlinedIcon sx={{ fontSize: 16 }} />,
  },
};

const SEV_LABEL_KEY: Record<string, string> = {
  critical: "panel.review.severityCritical",
  warning: "panel.review.severityWarning",
  info: "panel.review.severityInfo",
};

const sevLabel = (sev: string): string => t(SEV_LABEL_KEY[sev] || SEV_LABEL_KEY.info);

function groupBySeverity(findings: ReviewFinding[]): Map<string, ReviewFinding[]> {
  const map = new Map<string, ReviewFinding[]>();
  for (const f of findings) {
    const arr = map.get(f.severity) || [];
    arr.push(f);
    map.set(f.severity, arr);
  }
  return map;
}

function FindingCard({
  finding,
  onLocate,
  onDiagnose,
  flash,
}: {
  finding: ReviewFinding;
  onLocate: (f: ReviewFinding) => void;
  onDiagnose: (f: ReviewFinding) => void;
  /** 编辑器内联标记点击聚焦时短暂高亮（供用户在长列表中一眼定位） */
  flash?: boolean;
}) {
  const sevCfg = SEVERITY_CONFIG[finding.severity] || SEVERITY_CONFIG.info;
  return (
    <Paper
      variant="outlined"
      data-finding-id={finding.id}
      onClick={() => onLocate(finding)}
      sx={{
        p: 1,
        mb: 0.5,
        borderLeft: 3,
        borderColor: `${sevCfg.color}.main`,
        cursor: "pointer",
        transition: "box-shadow .25s ease, background-color .25s ease",
        ...(flash
          ? {
              boxShadow: `0 0 0 2px ${sevCfg.color === "error" ? "#f85149" : sevCfg.color === "warning" ? "#d29922" : "#58a6ff"}`,
              backgroundColor: "action.selected",
            }
          : {}),
        "&:hover": {
          backgroundColor: "action.hover",
        },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
        {sevCfg.icon}
        <Chip
          label={sevLabel(finding.severity)}
          size="small"
          color={sevCfg.color}
          sx={{ height: 16, fontSize: 9 }}
        />
        {finding.ruleId && (
          <Chip
            label={finding.ruleId.replace(/_/g, " ")}
            size="small"
            variant="outlined"
            sx={{ height: 16, fontSize: 8, ml: "auto" }}
          />
        )}
      </Box>
      <Typography variant="caption" sx={{ display: "block", mt: 0.25, fontSize: 11, lineHeight: 1.4 }}>
        {finding.message}
      </Typography>
      {finding.suggestion && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.25, fontSize: 10, lineHeight: 1.3 }}
        >
          {t("panel.review.suggestion")}: {finding.suggestion}
        </Typography>
      )}
      {finding.targetId && (
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: "block", mt: 0.25, fontSize: 9, fontFamily: "monospace" }}
          noWrap
        >
          {t("panel.review.target")}: {finding.targetId}
        </Typography>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}>
        <Button
          size="small"
          variant="text"
          onClick={(e) => {
            e.stopPropagation();
            onDiagnose(finding);
          }}
          sx={{
            fontSize: 9,
            textTransform: "none",
            p: 0,
            minWidth: 0,
            color: "primary.main",
            "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
          }}
          startIcon={<AutoFixHighIcon sx={{ fontSize: 12 }} />}
        >
          {t("panel.review.aiDiagnose")}
        </Button>
        <Typography variant="caption" sx={{ fontSize: 9, color: "primary.main", opacity: 0.7, ml: "auto" }}>
          {t("panel.review.locateHint")}
        </Typography>
      </Box>
    </Paper>
  );
}

export function ReviewFindingsPanel() {
  const findings = useProjectStore((s) => s.findings);
  const files = useProjectStore((s) => s.files);
  const modules = useProjectStore((s) => s.modules);
  const showToast = useToastStore((s) => s.showToast);
  // 编辑器内联审查标记点击 → 聚焦并高亮本条发现
  const reviewFindingFocus = useEditorStore((s) => s.reviewFindingFocus);
  // 严重度筛选 + 内联总开关：唯一事实来源（与工作台编辑器内联标记共享，双向联动）
  const findingFilter = useEditorStore((s) => s.reviewFindingFilter);
  const setFindingSeverities = useEditorStore((s) => s.setFindingSeverities);
  const setFindingShowInline = useEditorStore((s) => s.setFindingShowInline);
  const [expandedSeverities, setExpandedSeverities] = useState<Set<string>>(new Set(SEVERITY_ORDER));
  // 聚焦闪高亮（瞬时）
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 监听 focusReviewFinding：展开对应严重度分组 + 滚动卡片入视 + 短暂闪高亮
  useEffect(() => {
    const id = reviewFindingFocus?.id;
    if (!id) return;
    const target = findings.find((f) => f.id === id);
    if (target) {
      setExpandedSeverities((prev) => {
        if (prev.has(target.severity)) return prev;
        const next = new Set(prev);
        next.add(target.severity);
        return next;
      });
    }
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-finding-id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1600);
    return () => {
      cancelAnimationFrame(raf);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [reviewFindingFocus, findings]);

  // ─── 审查发现 → 源码定位（主）+ 画布联动（附带）───
  //
  // 审查结果面板的价值在于"带我去看违规的那行代码"。
  // 旧实现只在画布上找实体，找不到就 warning 结束，审查结论无处落地。
  const handleLocateFinding = useCallback(
    (finding: ReviewFinding) => {
      const file = files.find((x) => x.id === finding.targetId);
      if (file) {
        const r = navigateToSource(file.id, null, `${t("panel.review.prefix")}：${finding.message}`);
        showToast(r.message, r.opened ? "info" : "warning");
        return;
      }
      const mod = modules.find((m) => m.id === finding.targetId);
      if (mod) {
        const r = navigateToModule(mod.name);
        showToast(r.message, r.opened || r.focusedCanvas ? "info" : "warning");
        return;
      }
      showToast(t("panel.review.notFileOrModule", { msg: finding.message }), "info");
    },
    [files, modules, showToast]
  );

  // ─── 审查发现 → AI 诊断（G3：从分析点发起）───
  // 解析出具体文件路径与行号，连同结论摘要交给 AI；AI 落库的洞察会自动投射回画布。
  const handleDiagnoseFinding = useCallback(
    (finding: ReviewFinding) => {
      const file = files.find((x) => x.id === finding.targetId);
      let filePath: string | undefined = file?.relPath;
      if (!filePath) {
        // 目标是模块：取该模块目录下第一个文件作为诊断入口（与「定位到源码」同口径）
        const mod = modules.find((m) => m.id === finding.targetId);
        if (mod) {
          const first = files
            .filter((f) => !f.isDirectory && topDirOf(f.relPath) === mod.name)
            .sort((a, b) => a.relPath.localeCompare(b.relPath))[0];
          filePath = first?.relPath;
        }
      }
      if (!filePath) {
        showToast(t("panel.review.diagnoseNoFile", { msg: finding.message }), "warning");
        return;
      }
      const line = readLineFromMetadata(finding.metadata);
      triggerDiagnosis({
        filePath,
        kind: "review",
        title: finding.ruleId ? finding.ruleId.replace(/_/g, " ") : finding.message,
        lineRange: line ? [line, line] : undefined,
        detail: finding.message,
      });
    },
    [files, modules, showToast]
  );

  const handleFilterChange = useCallback(
    (_event: React.MouseEvent<HTMLElement>, newFilters: string[]) => {
      setFindingSeverities(newFilters);
    },
    [setFindingSeverities]
  );

  const toggleSeverity = useCallback((sev: string) => {
    setExpandedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }, []);

  const filteredFindings = useMemo(() => {
    if (findingFilter.severities.length === 0) return findings;
    return findings.filter((f) => findingFilter.severities.includes(f.severity));
  }, [findings, findingFilter.severities]);

  const grouped = useMemo(() => groupBySeverity(filteredFindings), [filteredFindings]);

  // 统计
  const countCritical = findings.filter((f) => f.severity === "critical").length;
  const countWarning = findings.filter((f) => f.severity === "warning").length;
  const countInfo = findings.filter((f) => f.severity === "info").length;

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <RuleIcon sx={{ fontSize: 16, color: "primary.main" }} />
        <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          {t("panel.review.title")}
        </Typography>
        <Chip
          label={`${findings.length}`}
          size="small"
          color={countCritical > 0 ? "error" : countWarning > 0 ? "warning" : "default"}
          variant="outlined"
          sx={{ height: 18, fontSize: 10 }}
        />
      </Box>

      {/* 严重度筛选 + 内联标记总开关（唯一事实来源，双向联动编辑器内联标记） */}
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          flexWrap: "wrap",
        }}
      >
        <ToggleButtonGroup
          size="small"
          value={findingFilter.severities}
          onChange={handleFilterChange}
          sx={{
            gap: 0.5,
            "& .MuiToggleButton-root": {
              border: 0,
              borderRadius: "8px !important",
              px: 1,
              py: 0.25,
              fontSize: 10,
              textTransform: "none",
              "&.Mui-selected": {
                backgroundColor: "action.selected",
              },
            },
          }}
        >
          <ToggleButton value="critical" sx={{ color: "error.main" }}>
            {t("panel.review.severityCritical")} ({countCritical})
          </ToggleButton>
          <ToggleButton value="warning" sx={{ color: "warning.main" }}>
            {t("panel.review.severityWarning")} ({countWarning})
          </ToggleButton>
          <ToggleButton value="info" sx={{ color: "info.main" }}>
            {t("panel.review.severityInfo")} ({countInfo})
          </ToggleButton>
        </ToggleButtonGroup>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            ml: "auto",
            color: findingFilter.showInline ? "primary.main" : "text.disabled",
            userSelect: "none",
          }}
        >
          <Tooltip title={t("panel.review.inlineToggleHint")}>
            <VisibilityIcon sx={{ fontSize: 15 }} />
          </Tooltip>
          <Typography variant="caption" sx={{ fontSize: 10 }}>
            {t("panel.review.inlineToggle")}
          </Typography>
          <Switch
            size="small"
            checked={findingFilter.showInline}
            onChange={(e) => setFindingShowInline(e.target.checked)}
            slotProps={{ input: { "aria-label": t("panel.review.inlineToggle") } }}
          />
        </Box>
      </Box>

      {/* 审查结果列表 */}
      <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto", px: 1.5, py: 1 }}>
        {filteredFindings.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              py: 4,
              color: "text.secondary",
              textAlign: "center",
            }}
          >
            <SearchOffIcon sx={{ fontSize: 32, opacity: 0.3, mb: 1 }} />
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {t("panel.review.noResults")}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.5, mt: 0.5, fontSize: 10 }}>
              {t("panel.review.scanHint")}
            </Typography>
          </Box>
        ) : (
          SEVERITY_ORDER.map((sev) => {
            const items = grouped.get(sev) || [];
            if (items.length === 0) return null;
            const isExpanded = expandedSeverities.has(sev);
            const sevCfg = SEVERITY_CONFIG[sev];
            return (
              <Box key={sev} sx={{ mb: 1 }}>
                <Box
                  onClick={() => toggleSeverity(sev)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    cursor: "pointer",
                    py: 0.25,
                    "&:hover": { opacity: 0.8 },
                    userSelect: "none",
                  }}
                >
                  {sevCfg.icon}
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      fontSize: 11,
                      color: `${sevCfg.color}.main`,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {sevLabel(sev)}
                  </Typography>
                  <Chip
                    label={items.length}
                    size="small"
                    color={sevCfg.color}
                    variant="outlined"
                    sx={{ height: 16, fontSize: 9, ml: "auto" }}
                  />
                </Box>
                {isExpanded && (
                  <Box sx={{ mt: 0.5 }}>
                    {items.map((f) => (
                      <FindingCard key={f.id} finding={f} onLocate={handleLocateFinding} onDiagnose={handleDiagnoseFinding} flash={flashId === f.id} />
                    ))}
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
