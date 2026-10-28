// 画布加载态骨架屏：扫描中 / 同步中显示占位结构 + 实时进度
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import LinearProgress from "@mui/material/LinearProgress";
import {t} from "../../i18n";

// 画布加载态骨架屏：扫描中 / 同步中显示占位结构 + 实时进度，替代静态空状态文案
export function CanvasLoadingSkeleton({
  mode,
  stage,
  percent,
  scanned,
  total,
}: {
  mode: "scan" | "sync";
  stage?: string | null;
  percent?: number;
  scanned?: number;
  total?: number;
}) {
  const determinate = mode === "scan" && typeof total === "number" && total > 0;
  const pct = determinate && typeof percent === "number" ? percent : 0;
  return (
    <Box sx={{ width: "min(440px, 84%)", display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center" }}>
      {/* 模拟即将出现的目录树结构网格 */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5, width: "100%" }}>
        <Skeleton variant="rounded" width="100%" height={56} sx={{ gridColumn: "span 3", borderRadius: 2 }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            variant="rounded"
            width="100%"
            height={44}
            sx={{ borderRadius: 2, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "text.primary" }}>
        {mode === "scan" ? t("editor.scanningTitle") : t("editor.syncingTitle")}
      </Typography>
      {mode === "scan" && stage && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t("editor.scanStage", { stage })}
        </Typography>
      )}
      {determinate ? (
        <>
          <LinearProgress variant="determinate" value={pct} sx={{ width: "100%", borderRadius: 1, height: 6 }} />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {t("editor.scanProgress", { scanned: scanned ?? 0, total: total ?? 0, pct: Math.round(pct) })}
          </Typography>
        </>
      ) : (
        <LinearProgress variant="indeterminate" sx={{ width: "100%", borderRadius: 1, height: 6 }} />
      )}
    </Box>
  );
}
