/**
 * 架构健康度面板（右侧「健康」Tab）
 *
 * 此前项目里所有质量信息都是「一条条列出来」的：多少个 TODO、多少条审查发现、
 * 哪些文件复杂 —— 但用户真正想知道的是一句话结论：**这个项目的架构到底行不行**。
 *
 * 这个面板给出那句结论，并且把分数怎么算的完全摊开：
 * - 顶部：0-100 分 + 等级 + 一句话判语
 * - 中部：五项扣分明细（循环依赖 / 主序偏离 / 复杂度 / 技术债 / 死代码），
 *         每项都写清扣了几分、依据是什么，不做黑盒打分
 * - 下部：循环依赖环列表（点击定位画布）+ 痛苦区 / 无用区模块排行（点击定位画布）
 *
 * 所有指标都由 architectureMetrics 纯函数算出，面板只负责展示与联动。
 */

import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import LinearProgress from "@mui/material/LinearProgress";
import Divider from "@mui/material/Divider";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import LoopIcon from "@mui/icons-material/Loop";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";

import { useProjectStore } from "../../store/projectStore";
import { useToastStore } from "../../store/toastStore";
import { gradeHintOf, zoneHintOf, zoneLabelOf } from "../utils/architectureMetrics";
import {
  buildModuleGraph,
  computeArchitectureHealth,
  computeModuleCoupling,
  findCycles,
  GRADE_COLOR,
  ZONE_COLOR,
  type ModuleCoupling,
} from "../utils/architectureMetrics";
import { findComponentForModule, locateComponentInCanvas } from "../utils/canvasLink";
import { t } from "../../i18n";

export function ArchitectureHealthPanel() {
  const files = useProjectStore((s) => s.files);
  const dependencies = useProjectStore((s) => s.dependencies);
  const symbols = useProjectStore((s) => s.symbols);
  const metrics = useProjectStore((s) => s.metrics);
  const techDebt = useProjectStore((s) => s.techDebt);
  const deadSymbols = useProjectStore((s) => s.deadSymbols);
  const showToast = useToastStore((s) => s.showToast);

  const analysis = useMemo(() => {
    const realFiles = files.filter((f) => !f.isDirectory);
    const graph = buildModuleGraph(realFiles, dependencies);
    const cycles = findCycles(
      graph.nodes.map((n) => n.name),
      graph.edges
    );
    const coupling = computeModuleCoupling(graph, symbols, cycles);
    const highComplexityFiles = metrics.filter(
      (m) => m.complexityLevel === "high" || m.complexityLevel === "extreme"
    ).length;
    const totalLines = realFiles.reduce((acc, f) => acc + (f.lineCount || 0), 0);
    const health = computeArchitectureHealth({
      coupling,
      cycles,
      highComplexityFiles,
      totalFiles: metrics.length || realFiles.length,
      techDebtCount: techDebt.length,
      totalLines,
      deadSymbolCount: deadSymbols.length,
      totalSymbols: symbols.filter((s) => s.kind !== "import").length,
    });
    return { graph, cycles, coupling, health };
  }, [files, dependencies, symbols, metrics, techDebt, deadSymbols]);

  const { cycles, coupling, health, graph } = analysis;

  const locateModule = (name: string) => {
    locateComponentInCanvas(findComponentForModule(name), () =>
      showToast(t("health.moduleNotOnCanvas", { name }), "warning")
    );
  };

  if (graph.nodes.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: "center", color: "text.secondary" }}>
        <MonitorHeartIcon sx={{ fontSize: 38, opacity: 0.2, mb: 1 }} />
        <Typography variant="caption" sx={{ display: "block" }}>
          {t("health.noModules")}
        </Typography>
      </Box>
    );
  }

  const painful = coupling.filter((c) => c.zone === "painful").slice(0, 6);
  const useless = coupling.filter((c) => c.zone === "useless").slice(0, 4);
  const gradeColor = GRADE_COLOR[health.grade];

  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
      {/* ── 总分 ── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          p: 1.25,
          borderRadius: 1,
          border: 1,
          borderColor: `${gradeColor}55`,
          bgcolor: `${gradeColor}12`,
        }}
      >
        <Box sx={{ textAlign: "center", minWidth: 58 }}>
          <Typography sx={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: gradeColor }}>
            {health.score}
          </Typography>
          <Typography sx={{ fontSize: 9, color: "text.secondary", letterSpacing: 1 }}>
            {t("health.grade", { g: health.grade })}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, display: "block", color: gradeColor }}>
            {gradeHintOf(health.grade)}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", display: "block", mt: 0.25 }}>
            {t("health.summary", {
              nodes: graph.nodes.length,
              edges: graph.edges.length,
              d: health.avgDistance.toFixed(2),
            })}
          </Typography>
        </Box>
      </Box>

      {/* ── 扣分明细 ── */}
      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}
        >
          {t("health.deductionsTitle")}
        </Typography>
        <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.9 }}>
          {health.deductions.map((d) => (
            <Tooltip key={d.key} title={d.detail} placement="left" arrow>
              <Box>
                <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <Typography variant="caption" sx={{ fontSize: 10.5, fontWeight: 600 }}>
                    {d.label}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: d.points > 0 ? "warning.main" : "success.main",
                    }}
                  >
                    {d.points > 0 ? `-${d.points}` : "0"}
                    <span style={{ opacity: 0.5, fontWeight: 400 }}> / {d.max}</span>
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, (d.points / d.max) * 100)}
                  sx={{
                    height: 4,
                    borderRadius: 2,
                    mt: 0.25,
                    bgcolor: "action.hover",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 2,
                      bgcolor: d.points > 0 ? "warning.main" : "success.main",
                    },
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{ fontSize: 9, color: "text.disabled", display: "block", mt: 0.25, lineHeight: 1.35 }}
                >
                  {d.detail}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
      </Box>

      <Divider />

      {/* ── 循环依赖环 ── */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <LoopIcon sx={{ fontSize: 13, color: cycles.length > 0 ? "error.main" : "success.main" }} />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}
          >
            {t("health.cyclesTitle", { n: cycles.length })}
          </Typography>
        </Box>
        {cycles.length === 0 ? (
          <Typography variant="caption" sx={{ fontSize: 9.5, color: "success.main", display: "block", mt: 0.5 }}>
            {t("health.noCycles")}
          </Typography>
        ) : (
          <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.75 }}>
            {cycles.slice(0, 6).map((c, i) => (
              <Box
                key={`${c.nodes.join("-")}-${i}`}
                sx={{
                  p: 0.75,
                  borderRadius: 0.75,
                  border: 1,
                  borderColor: "error.light",
                  bgcolor: "action.hover",
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={() => locateModule(c.nodes[0])}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                  <Chip
                    size="small"
                    label={t("health.cycleSize", { n: c.size })}
                    sx={{ height: 15, fontSize: 8.5, bgcolor: "error.main", color: "#fff" }}
                  />
                  <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled" }}>
                    {t("health.cycleDetail", { n: c.edgeCount, w: c.weight })}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  sx={{ fontSize: 9.5, display: "block", mt: 0.25, wordBreak: "break-all", lineHeight: 1.4 }}
                >
                  {c.nodes.join(" → ")}
                  {c.size > 1 ? ` → ${c.nodes[0]}` : ""}
                </Typography>
              </Box>
            ))}
            {cycles.length > 6 && (
              <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled" }}>
                {t("health.cyclesMore", { n: cycles.length - 6 })}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      <Divider />

      {/* ── 危险区模块 ── */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <ReportProblemIcon sx={{ fontSize: 13, color: "warning.main" }} />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}
          >
            {t("health.deviantTitle")}
          </Typography>
        </Box>
        {painful.length === 0 && useless.length === 0 ? (
          <Typography variant="caption" sx={{ fontSize: 9.5, color: "success.main", display: "block", mt: 0.5 }}>
            {t("health.noDeviant")}
          </Typography>
        ) : (
          <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.5 }}>
            {[...painful, ...useless].map((c) => (
              <ZoneRow key={c.name} item={c} onClick={() => locateModule(c.name)} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function ZoneRow({ item, onClick }: { item: ModuleCoupling; onClick: () => void }) {
  const color = ZONE_COLOR[item.zone];
  return (
    <Tooltip title={zoneHintOf(item.zone)} placement="left" arrow>
      <Box
        onClick={onClick}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 0.75,
          py: 0.5,
          borderRadius: 0.75,
          cursor: "pointer",
          borderLeft: `3px solid ${color}`,
          bgcolor: "action.hover",
          "&:hover": { bgcolor: "action.selected" },
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="caption"
            sx={{ fontSize: 10.5, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {item.name}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 8.5, color: "text.disabled" }}>
            {t("health.zoneMetrics", {
              ca: item.ca,
              ce: item.ce,
              i: item.instability.toFixed(2),
              a: item.abstractness.toFixed(2),
            })}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={`${zoneLabelOf(item.zone)} D${item.distance.toFixed(2)}`}
          sx={{ height: 16, fontSize: 8.5, bgcolor: `${color}22`, color, fontWeight: 700 }}
        />
      </Box>
    </Tooltip>
  );
}

export default ArchitectureHealthPanel;
