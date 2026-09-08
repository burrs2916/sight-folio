/**
 * LogStatsCards - 日志统计卡片行
 *
 * 展示4个统计卡片：
 * 1. 今日操作总数 - 调用 queryOperationHistory 获取 total
 * 2. 操作成功率 - 调用 queryOperationHistory 分别获取总数和成功数
 * 3. 告警总数 - 调用 queryEventHistory 带 level=error 获取 total
 * 4. 设备在线数 - 从 deviceStore 统计在线设备数
 *
 * 挂载时自动加载，每30秒刷新一次。
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import { useEffect, useState, useCallback } from "react";
import type { ComponentRendererProps } from "../../../types/editor";
import { queryOperationHistory, queryEventHistory, recentTimeRange } from "../../../services/historyApi";
import { useDeviceStore } from "../../../store/deviceStore";
import { logger } from "../../../utils/logger";

interface Stats {
  operationTotal: number;
  successRate: number;
  alarmTotal: number;
  onlineDevices: number;
  totalDevices: number;
}

const EMPTY_STATS: Stats = {
  operationTotal: 0,
  successRate: 0,
  alarmTotal: 0,
  onlineDevices: 0,
  totalDevices: 0,
};

export default function LogStatsCards(props?: ComponentRendererProps) {
  const config = props?.config ?? {};
  const refreshInterval = (config.refreshInterval as number) ?? 30000;

  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  // 设备在线数（从 deviceStore 获取）
  const devices = useDeviceStore((s) => s.devices);
  const getEffectiveOnline = useDeviceStore((s) => s.getEffectiveOnline);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const range = recentTimeRange(24);

      // 并行查询：操作总数 + 告警总数
      // 操作成功率需要两次查询（总数 + 成功数），合并为一个 Promise
      const [opsResp, okResp, alarmResp] = await Promise.all([
        queryOperationHistory({ from: range.from, to: range.to, limit: 1, offset: 0 }),
        queryOperationHistory({ from: range.from, to: range.to, limit: 1, offset: 0, result: "ok" }),
        queryEventHistory({ from: range.from, to: range.to, level: "error", limit: 1, offset: 0 }),
      ]);

      const opTotal = opsResp.total;
      const okTotal = okResp.total;
      const successRate = opTotal > 0 ? Math.round((okTotal / opTotal) * 1000) / 10 : 0;

      // 设备在线数
      const deviceList = Object.values(devices);
      let online = 0;
      for (const d of deviceList) {
        if (getEffectiveOnline(d.deviceId)) online++;
      }

      setStats({
        operationTotal: opTotal,
        successRate,
        alarmTotal: alarmResp.total,
        onlineDevices: online,
        totalDevices: deviceList.length,
      });
    } catch (err) {
      logger.error("LogStatsCards", "loadStats failed", { error: err });
      // 仍然更新设备在线数（不依赖后端API）
      const deviceList = Object.values(devices);
      let online = 0;
      for (const d of deviceList) {
        if (getEffectiveOnline(d.deviceId)) online++;
      }
      setStats((prev) => ({
        ...prev,
        onlineDevices: online,
        totalDevices: deviceList.length,
      }));
    } finally {
      setLoading(false);
    }
  }, [devices, getEffectiveOnline]);

  useEffect(() => {
    void loadStats();
    const timer = setInterval(() => void loadStats(), refreshInterval);
    return () => clearInterval(timer);
  }, [loadStats, refreshInterval]);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        gap: 1,
        overflow: "hidden",
      }}
    >
      <StatCard
        label="今日操作总数"
        value={stats.operationTotal}
        unit="次"
        color="#5A9ED6"
        icon="ops"
        loading={loading}
      />
      <StatCard
        label="操作成功率"
        value={stats.successRate}
        unit="%"
        color="#4caf50"
        icon="rate"
        loading={loading}
      />
      <StatCard
        label="告警总数"
        value={stats.alarmTotal}
        unit="条"
        color="#ef4444"
        icon="alarm"
        loading={loading}
      />
      <StatCard
        label="设备在线数"
        value={stats.onlineDevices}
        suffix={`/ ${stats.totalDevices}`}
        unit="台"
        color="#F8B448"
        icon="device"
        loading={loading}
      />
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 单个统计卡片
// ═══════════════════════════════════════════════════════════════════

interface StatCardProps {
  label: string;
  value: number;
  unit?: string;
  suffix?: string;
  color: string;
  icon: string;
  loading: boolean;
}

function StatCard({ label, value, unit, suffix, color, loading }: StatCardProps) {
  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 0.3,
        background: "linear-gradient(180deg, rgba(22,38,62,0.92) 0%, rgba(16,28,48,0.95) 100%)",
        border: "1px solid rgba(120,144,156,0.4)",
        borderRadius: 1.5,
        p: 1,
        position: "relative",
        overflow: "hidden",
        "&::before": {
          content: '""',
          position: "absolute",
          top: 0,
          left: 0,
          width: 3,
          height: "100%",
          background: color,
          opacity: 0.8,
        },
      }}
    >
      <Typography sx={{ fontSize: 11, color: "rgba(176,190,197,0.7)", fontWeight: 500, whiteSpace: "nowrap" }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={60} height={28} sx={{ bgcolor: "rgba(120,144,156,0.15)" }} />
      ) : (
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.3 }}>
          <Typography
            sx={{
              fontSize: 24,
              fontWeight: 700,
              color,
              fontFamily: "monospace",
              lineHeight: 1.1,
              textShadow: `0 0 8px ${color}44`,
            }}
          >
            {value}
          </Typography>
          {unit && <Typography sx={{ fontSize: 11, color: "rgba(176,190,197,0.6)" }}>{unit}</Typography>}
          {suffix && <Typography sx={{ fontSize: 10, color: "rgba(176,190,197,0.4)", ml: 0.3 }}>{suffix}</Typography>}
        </Box>
      )}
    </Box>
  );
}
