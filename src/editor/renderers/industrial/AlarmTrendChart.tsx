/**
 * AlarmTrendChart - 告警趋势柱状图
 *
 * 使用 ECharts 渲染告警趋势柱状图：
 * - 按小时统计告警次数（调用 queryEventHistory 带 agg=count, step=1h）
 * - 自动加载最近24小时数据
 * - 暗色工业大屏风格
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { useEffect, useMemo, useState } from "react";
import { echarts, PALETTE, createBarGradient, calcFontScale, chartFontSizes } from "../echarts/echartsCore";
import type { ComponentRendererProps } from "../../../types/editor";
import { queryEventHistory, recentTimeRange, type DeviceEvent } from "../../../services/historyApi";
import { useLogQueryStore } from "../../../store/logQueryStore";
import { logger } from "../../../utils/logger";

interface Bucket {
  hour: string;
  count: number;
}

export default function AlarmTrendChart(props?: ComponentRendererProps) {
  const config = props?.config ?? {};
  const width = props?.width ?? 300;
  const height = props?.height ?? 200;
  const title = (config.title as string) ?? "告警趋势";
  const hours = (config.hours as number) ?? 24;

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 从 logQueryStore 获取时间范围（用于联动筛选面板）
  const storeTimeRange = useLogQueryStore((s) => s.timeRange);
  const deviceId = useLogQueryStore((s) => s.deviceId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const range = recentTimeRange(hours);
        const resp = await queryEventHistory({
          from: range.from,
          to: range.to,
          device_id: deviceId || undefined,
          level: "error",
          agg: "count",
          step: "1h",
          limit: 1000,
          offset: 0,
        });

        if (cancelled) return;

        // 尝试解析聚合响应：
        // 1. 数据项包含 count 字段 -> 直接使用
        // 2. 否则按小时本地分桶统计
        const data = resp.data;
        if (data.length > 0 && typeof (data[0] as Record<string, unknown>).count === "number") {
          const parsed = data.map((d) => {
            const ts = (d as DeviceEvent).timestamp;
            const count = Number((d as Record<string, unknown>).count ?? 0);
            const d2 = typeof ts === "number" ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(String(ts));
            const pad = (n: number) => String(n).padStart(2, "0");
            return { hour: `${pad(d2.getHours())}:00`, count };
          });
          setBuckets(parsed);
        } else {
          // 本地按小时分桶
          setBuckets(bucketByHour(data, range.from, range.to));
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("AlarmTrendChart", "load failed", { error: msg });
        setError(msg);
        setBuckets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, deviceId, storeTimeRange.from, storeTimeRange.to]);

  // ECharts option
  const option = useMemo(() => {
    const scale = calcFontScale(width, height);
    const fs = chartFontSizes(scale);

    const categories = buckets.map((b) => b.hour);
    const values = buckets.map((b) => b.count);

    return {
      title: { show: false },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(22,38,62,0.95)",
        borderColor: "rgba(100,180,255,0.35)",
        textStyle: { color: "#e0e8f0", fontSize: fs.tooltip },
        formatter: (params: unknown) => {
          const arr = params as Array<{ name: string; value: number; color: string }>;
          if (!Array.isArray(arr) || arr.length === 0) return "";
          const p = arr[0];
          return `<div style="font-size:11px">${p.name}<br/><span style="color:${p.color}">●</span> 告警次数: <b>${p.value}</b></div>`;
        },
      },
      grid: { left: 40, right: 12, top: 12, bottom: 28 },
      xAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.2)" } },
        axisLabel: {
          color: "rgba(255,255,255,0.6)",
          fontSize: fs.axisLabelSmall,
          rotate: categories.length > 12 ? 45 : 0,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: "次数",
        nameTextStyle: { color: "rgba(255,255,255,0.5)", fontSize: fs.axisLabelSmall },
        axisLine: { show: false },
        axisLabel: { color: "rgba(255,255,255,0.6)", fontSize: fs.axisLabelSmall },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        minInterval: 1,
      },
      series: [
        {
          name: "告警次数",
          type: "bar",
          data: values,
          barWidth: "60%",
          itemStyle: {
            color: createBarGradient(PALETTE.orange, PALETTE.red),
            borderRadius: [3, 3, 0, 0],
          },
          emphasis: {
            itemStyle: {
              color: createBarGradient(PALETTE.red, PALETTE.red),
            },
          },
          label: {
            show: values.length <= 12,
            position: "top",
            color: "rgba(255,255,255,0.7)",
            fontSize: fs.label,
          },
        },
      ],
      animation: true,
      animationDuration: 400,
    };
  }, [buckets, width, height]);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "linear-gradient(180deg, rgba(22,38,62,0.92) 0%, rgba(16,28,48,0.95) 100%)",
        border: "1px solid rgba(120,144,156,0.4)",
        borderRadius: 1.5,
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.6,
          borderBottom: "1px solid rgba(120,144,156,0.3)",
          background: "linear-gradient(90deg, rgba(120,144,156,0.12), transparent)",
          flexShrink: 0,
        }}
      >
        <Box sx={{ width: 3, height: 14, background: "#B0BEC5", borderRadius: 0.5 }} />
        <Typography sx={{ fontSize: 13, color: "#B0BEC5", fontWeight: 700, letterSpacing: 1 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 10, color: "rgba(176,190,197,0.5)", ml: "auto" }}>
          最近 {hours} 小时
        </Typography>
      </Box>

      {/* 图表 */}
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
            <CircularProgress size={24} sx={{ color: "rgba(90,158,214,0.7)" }} />
          </Box>
        ) : error ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", p: 2 }}>
            <Typography sx={{ fontSize: 12, color: "#ef4444", textAlign: "center" }}>{error}</Typography>
          </Box>
        ) : buckets.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
            <Typography sx={{ fontSize: 12, color: "rgba(176,190,197,0.4)" }}>暂无告警数据</Typography>
          </Box>
        ) : (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ width: "100%", height: "100%" }}
            notMerge={true}
            lazyUpdate={true}
          />
        )}
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 将事件列表按小时分桶统计
 * 生成从 from 到 to 的完整小时序列（即使某小时无事件也显示0）
 */
function bucketByHour(events: DeviceEvent[], fromIso: string, toIso: string): Bucket[] {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (isNaN(from) || isNaN(to) || to <= from) return [];

  // 对齐到整点
  const startHour = new Date(from);
  startHour.setMinutes(0, 0, 0);
  const buckets: Bucket[] = [];
  const bucketMap = new Map<number, number>();

  let cursor = startHour.getTime();
  while (cursor <= to) {
    const d = new Date(cursor);
    const pad = (n: number) => String(n).padStart(2, "0");
    const label = `${pad(d.getHours())}:00`;
    buckets.push({ hour: label, count: 0 });
    bucketMap.set(cursor, buckets.length - 1);
    cursor += 60 * 60 * 1000;
    if (buckets.length > 168) break; // 安全上限：7天
  }

  // 统计事件到对应桶
  for (const ev of events) {
    const ts = ev.timestamp;
    const t = typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : new Date(String(ts)).getTime();
    if (isNaN(t)) continue;
    const hourBucket = new Date(t);
    hourBucket.setMinutes(0, 0, 0);
    const idx = bucketMap.get(hourBucket.getTime());
    if (idx !== undefined) {
      buckets[idx].count++;
    }
  }

  return buckets;
}
