import Box from "@mui/material/Box";
import { t, resolveFragments } from "../../i18n";
import Typography from "@mui/material/Typography";

interface TreemapCellRendererProps {
  config?: {
    name?: string;
    fileCount?: number;
    depCount?: number;
    beDepCount?: number;
    ca?: number;
    ce?: number;
    instability?: number;
    abstractness?: number;
    zone?: string;
    zoneLabel?: string;
    inCycle?: boolean;
    /** 面积占比（%），echart 同款块内显示 */
    sharePct?: number;
    cellW?: number;
    cellH?: number;
    [key: string]: unknown;
  };
}

// zone → 底色（与 ModuleRenderer 主序形态同款色板，保证全局语义一致）
const ZONE_FILL: Record<string, string> = {
  painful: "#ef4444",
  useless: "#a855f7",
  mainSequence: "#22c55e",
};
const ZONE_NORMAL = "#64748b";

function readableText(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = ((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114;
  return lum > 150 * 1000 ? "#1e293b" : "#ffffff";
}

/**
 * 耦合矩形树图单元格（echart 同款视觉）：
 * - 紧凑色块 + 1px 白边分隔（解决色块融在一起分不清边界的问题）
 * - 块内显示模块名 + 占比%（echart treemap 默认 name + value% 形态）
 * - 单元格宽 < 120 时只显示模块名（避免文字溢出）
 */
export function TreemapCellRenderer(props: TreemapCellRendererProps) {
  const config = props?.config ?? {};
  const zone = typeof config.zone === "string" ? config.zone : "normal";
  const base = ZONE_FILL[zone] ?? ZONE_NORMAL;
  const fill = `${base}2e`; // 18% 透明底，比之前略深一点让色块更"实"
  const textColor = readableText(base);

  const w = typeof config.cellW === "number" ? config.cellW : 200;
  const h = typeof config.cellH === "number" ? config.cellH : 80;
  const compact = w < 120;
  const name = resolveFragments(config.name ?? t("entityProj.unnamedModule"));
  const pct = typeof config.sharePct === "number" ? config.sharePct : 0;

  return (
    <Box
      title={
        `${name}\n` +
        t("editor.treemap.filesShare", { n: config.fileCount ?? 0, pct: pct.toFixed(1), ce: config.ce ?? 0, ca: config.ca ?? 0 }) +
        "\n" +
        t("editor.treemap.instabilityAbs", { i: (config.instability ?? 0).toFixed(2), a: (config.abstractness ?? 0).toFixed(2) }) +
        (config.inCycle ? "\n" + t("editor.treemap.inCycle") : "")
      }
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        px: 1,
        bgcolor: fill,
        // echart 同款：1px 实色描边分隔块，避免融在一起
        border: "1px solid",
        borderColor: "rgba(255,255,255,0.85)",
        borderRadius: 1,
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <Typography
        noWrap
        sx={{
          fontSize: Math.min(Math.max(w > 200 ? 15 : 12, 9), 18),
          fontWeight: 700,
          color: textColor,
          lineHeight: 1.2,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </Typography>
      {!compact && h > 40 && (
        <Typography
          noWrap
          sx={{ fontSize: 9.5, color: textColor, opacity: 0.9, lineHeight: 1.3, mt: 0.25 }}
        >
          {t("editor.treemap.fileCount", { n: config.fileCount ?? 0, pct: pct.toFixed(1) })}
        </Typography>
      )}
      {!compact && h > 60 && (
        <Typography
          noWrap
          sx={{ fontSize: 9, color: textColor, opacity: 0.75, lineHeight: 1.3, mt: 0.25 }}
        >
          {`Ce ${config.ce ?? 0} · Ca ${config.ca ?? 0}`}
        </Typography>
      )}
      {config.inCycle && !compact && h > 76 && (
        <Typography
          noWrap
          sx={{ fontSize: 9, color: "#fecaca", fontWeight: 600, lineHeight: 1.3, mt: 0.25 }}
        >
          {t("editor.treemap.cycleBadge")}
        </Typography>
      )}
    </Box>
  );
}
