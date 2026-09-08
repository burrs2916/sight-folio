import Box from "@mui/material/Box";
import { t, resolveFragments } from "../../i18n";
import Typography from "@mui/material/Typography";

interface LayerMarkerRendererProps {
  config?: {
    layerName?: string;
    layerColor?: string;
    /** v2.12 副行（完整路径 + 符号统计 / 模块依赖徽标），可选 */
    subtitle?: string;
    /** v2.12 完整路径（tooltip），可选 */
    fullPath?: string;
    [key: string]: unknown;
  };
}

/** 亮度感知加深：浅色（低饱和灰 #94a3b8 等）在浅底上对比度差 → 混黑加深；
 * 饱和色（天蓝 #38bdf8 等）保持原色相。已持久化的旧色值（如 #94a3b8）
 * 无需重跑画像即可在渲染层修正可读性。 */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114;
}
function mixBlack(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - pct));
  const g = Math.round(((n >> 8) & 255) * (1 - pct));
  const b = Math.round((n & 255) * (1 - pct));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
function readableBandColor(hex: string): string {
  // 阈值 160（加权亮度 0~255）：石板灰 #94a3b8≈161 加深，天蓝 #38bdf8≈156 保持
  return luminance(hex) > 160 * 1000 ? mixBlack(hex, 0.22) : hex;
}

// v2.12 双行横带：主行 = 目录最后一段/文件名；副行 = 完整路径 + 统计（灰小字）。
// 无 subtitle 时保持单行（其他画像的 layer-marker 仍只有一行标题）。
export function LayerMarkerRenderer(props: LayerMarkerRendererProps) {
  const _config = props?.config;
  const config = _config ?? {};
  // 预览区安全：无自定义颜色时用亮色演示（text.secondary 在深色预览底上太暗）
  const hasCustomColor = !!config.layerColor;
  const demoColor = "#60A5FA"; // 亮蓝 — 深色底清晰可见
  const rawColor = config.layerColor || demoColor;
  const bandColor = readableBandColor(rawColor);
  const hasSub = !!config.subtitle;
  // v2.12 背景条带化：之前 `${color}15`（8% 透明度）几乎看不见（用户反馈「没有背景」）。
  // 改为左→右渐变（左 19% → 右 7%），配合 3px 左色条形成明确的「横带」视觉。
  const bandBg = config.layerColor
    ? `linear-gradient(90deg, ${rawColor}30, ${rawColor}12)`
    : hasCustomColor
      ? "action.hover"
      : "rgba(96,165,250,0.12)";
  return (
    <Box
      title={config.fullPath || (hasSub ? config.subtitle : undefined)}
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        px: 2,
        bgcolor: bandBg,
        borderLeft: 3,
        borderColor: bandColor,
        borderRadius: "0 4px 4px 0",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {/* v2.18：当 layerName 为空字符串时只画背景条带，不画文字 —— 让大色块作背景色阶而不抢戏 */}
      {config.layerName ? (
        <Typography
          variant="caption"
          noWrap
          sx={{ fontSize: 11, fontWeight: 600, color: config.layerColor ? bandColor : hasCustomColor ? "text.secondary" : demoColor, lineHeight: 1.3, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {resolveFragments(config.layerName) || t("entityProj.unnamedLayerFallback")}
        </Typography>
      ) : null}
      {hasSub && (
        <Typography
          variant="caption"
          noWrap
          sx={{ fontSize: 8.5, color: "text.secondary", lineHeight: 1.3, display: "block", overflow: "hidden", textOverflow: "ellipsis", mt: 0.25 }}
        >
          {config.subtitle}
        </Typography>
      )}
    </Box>
  );
}
