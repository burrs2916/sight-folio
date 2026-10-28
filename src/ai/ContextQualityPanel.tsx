/**
 * ContextQualityPanel —— 数据可信度体检，给**人**看的那一份。
 *
 * 为什么必须有这块 UI
 * ------------------
 * dataQuality 已经贯通到 Agent 侧了：分节带状态、outline 列盲区、正文插警示。
 * 但如果人看不到同一份体检，就会出现最糟的情况——Agent 输出「架构健康、无循环依赖」，
 * 用户没有任何依据去质疑这句话到底来自「查过了」还是「没查」。
 * 人和 AI 被同一个盲区骗，比只有 AI 被骗更危险，因为再没有第二道防线。
 *
 * 模块无关
 * --------
 * 本组件只认 AiContextProvider.describeQuality 这一个协议方法，
 * 不认识扫描/画布/报告任何具体模块。未来任意模块实现该方法后，
 * 把 moduleId 传进来即可复用，这里零改动；未实现的模块静默不渲染。
 */
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import { aiContextRegistry } from "./contextRegistry";
import { coverageRatio } from "./dataQuality";
import type { AiDataQualityStatus } from "./contextTypes";
import { useProjectStore } from "../store/projectStore";
import { t, getLang } from "../i18n";

interface Props {
  /** 供给者模块 id，如 "project-scan" */
  moduleId: string;
  /** 作用域 id（扫描模块 = analysisId）；为空则不渲染 */
  scopeId?: string;
  compact?: boolean;
}

/** 状态配色：盲区必须足够刺眼，它代表「这里的结论一个都不能信」 */
const STATUS_COLOR: Record<AiDataQualityStatus, string> = {
  ok: "#22c55e",
  partial: "#f59e0b",
  empty: "#94a3b8",
  unavailable: "#ef4444",
};

export function ContextQualityPanel({ moduleId, scopeId, compact = false }: Props) {
  const [open, setOpen] = useState(false);

  // 订阅扫描数据本身，重扫后体检结果要跟着变；
  // 只订阅数组引用，计数在 useMemo 里做，不会因为无关状态变化重算。
  const files = useProjectStore((s) => s.files);
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);

  const report = useMemo(() => {
    if (!scopeId) return null;
    const provider = aiContextRegistry.get(moduleId);
    if (!provider?.describeQuality) return null;
    try {
      return provider.describeQuality(scopeId);
    } catch {
      // 体检本身出问题绝不能拖垮整个面板：无非是少一块信息，
      // 而面板挂掉会连「开始分析」按钮一起弄没。
      return null;
    }
    // files / activeAnalysisId 是重算触发器：数据换了，体检就该重做
    // getLang() 是文案触发器：切语言后 label/reason 要跟着刷新
  }, [moduleId, scopeId, files, activeAnalysisId, getLang()]);

  if (!report || report.dimensions.length === 0) return null;

  const fs = (n: number) => (compact ? n - 1 : n);
  const blind = report.dimensions.filter((d) => d.quality.status === "unavailable");
  const partial = report.dimensions.filter((d) => d.quality.status === "partial");
  const color = STATUS_COLOR[report.overall];

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        overflow: "hidden",
      }}
    >
      {/* 折叠头：一眼看清「这次扫描看清了多少」 */}
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1,
          py: 0.75,
          cursor: "pointer",
          userSelect: "none",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        {open ? (
          <ExpandMoreIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        ) : (
          <ChevronRightIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        )}
        <FactCheckOutlinedIcon sx={{ fontSize: 15, color }} />
        <Typography sx={{ fontSize: fs(12), fontWeight: 600, flex: 1 }}>
          {t("aiPanel.quality.title")}
        </Typography>
        <Tooltip title={t("aiPanel.quality.hint." + report.overall)} placement="top">
          <Chip
            size="small"
            label={
              blind.length > 0
                ? t("aiPanel.quality.blind", { n: blind.length })
                : partial.length > 0
                  ? t("aiPanel.quality.partialCov", { n: partial.length })
                  : t("aiPanel.quality.allOk")
            }
            sx={{
              height: 18,
              fontSize: fs(10),
              fontWeight: 600,
              color,
              bgcolor: `${color}1F`,
              "& .MuiChip-label": { px: 0.75 },
            }}
          />
        </Tooltip>
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1, pb: 1, pt: 0.25 }}>
          <Typography
            sx={{ fontSize: fs(10), color: "text.secondary", lineHeight: 1.5, mb: 0.75 }}
          >
            {t("aiPanel.quality.hint." + report.overall)}
          </Typography>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {report.dimensions.map((d) => {
              const c = STATUS_COLOR[d.quality.status];
              const ratio = coverageRatio(d.quality);
              return (
                <Tooltip
                  key={d.key}
                  placement="left"
                  title={
                    d.quality.reason || d.quality.caveat
                      ? `${d.quality.reason ?? ""}${d.quality.caveat ? t("aiPanel.quality.caveat", { caveat: d.quality.caveat }) : ""}`
                      : t("aiPanel.quality.dimTrusted", { n: d.observed })
                  }
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      py: 0.25,
                      borderRadius: 0.75,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        bgcolor: c,
                        flexShrink: 0,
                      }}
                    />
                    <Typography sx={{ fontSize: fs(11), flex: 1, minWidth: 0 }} noWrap>
                      {d.label}
                    </Typography>
                    <Typography
                      sx={{ fontSize: fs(10), color: "text.disabled", fontVariantNumeric: "tabular-nums" }}
                    >
                      {ratio !== null ? `${ratio}%` : d.observed}
                    </Typography>
                    <Typography
                      sx={{ fontSize: fs(10), color: c, fontWeight: 600, width: 48, textAlign: "right" }}
                    >
                      {t("aiPanel.quality.status." + d.quality.status)}
                    </Typography>
                  </Box>
                </Tooltip>
              );
            })}
          </Box>

          {blind.length > 0 && (
            <Typography
              sx={{
                fontSize: fs(10),
                color: "warning.main",
                lineHeight: 1.5,
                mt: 0.75,
                pt: 0.75,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              {t("aiPanel.quality.blindNote")}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
