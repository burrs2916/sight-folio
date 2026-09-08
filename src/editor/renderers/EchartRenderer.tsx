import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { echarts, CHART_BOX_SX } from "./echarts/echartsCore";
import type { ComponentRendererProps } from "../../types/editor";
import { t } from "../../i18n";

/**
 * 通用 ECharts 渲染器（向后兼容）
 * 推荐使用专用图表组件：echart-bar, echart-line, echart-pie 等
 *
 * 审计修复（2026-08-12，R44）：config.option 为空时不再随机展示 DEMO_OPTIONS 假图表
 * （假图表会被误读成真实数据），改为空态提示，避免误导。
 */
export function EchartRenderer(props: ComponentRendererProps) {
  const config = props?.config ?? {};
  const option = config.option as object | undefined;
  const theme = (config.theme as string) || "default";
  const hasOption = option && Object.keys(option).length > 0;

  if (!hasOption) {
    return (
      <Box sx={{ ...CHART_BOX_SX, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography variant="caption" color="text.secondary">
          {t("echart.emptyHint")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={CHART_BOX_SX}>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        theme={theme === "dark" ? "dark" : undefined}
        style={{ width: "100%", height: "100%" }}
        notMerge
        lazyUpdate
      />
    </Box>
  );
}
