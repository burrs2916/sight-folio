/**
 * LogFilterPanel - 日志监控筛选面板
 *
 * 左侧筛选面板，提供：
 * - 时间范围选择器（datetime-local）
 * - 设备选择（从 deviceStore 加载设备列表）
 * - 日志级别选择（all/info/warn/error）
 * - 事件类型选择
 * - 查询按钮、导出CSV按钮
 *
 * 通过 logQueryStore 的 setQueryParams 和 queryActiveTab 触发查询。
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import { useCallback } from "react";
import type { ComponentRendererProps } from "../../../types/editor";
import { useLogQueryStore } from "../../../store/logQueryStore";
import { useDeviceStore } from "../../../store/deviceStore";
import { toDateTimeLocalValue, fromDateTimeLocalValue, recentTimeRange } from "../../../services/historyApi";

// 日志级别选项
const LEVEL_OPTIONS = [
  { label: "全部级别", value: "all" },
  { label: "信息 (info)", value: "info" },
  { label: "警告 (warn)", value: "warn" },
  { label: "错误 (error)", value: "error" },
];

// 事件类型选项
const EVENT_TYPE_OPTIONS = [
  { label: "全部类型", value: "all" },
  { label: "状态变更", value: "status_change" },
  { label: "上线", value: "online" },
  { label: "离线", value: "offline" },
  { label: "告警", value: "alarm" },
  { label: "故障", value: "fault" },
  { label: "参数变更", value: "param_change" },
];

// 快捷时间范围
const QUICK_RANGES = [
  { label: "1小时", hours: 1 },
  { label: "6小时", hours: 6 },
  { label: "24小时", hours: 24 },
  { label: "7天", hours: 24 * 7 },
];

export default function LogFilterPanel(props?: ComponentRendererProps) {
  const config = props?.config ?? {};
  const title = (config.title as string) ?? "日志筛选";
  const showExport = (config.showExport as boolean) ?? true;

  const timeRange = useLogQueryStore((s) => s.timeRange);
  const deviceId = useLogQueryStore((s) => s.deviceId);
  const logLevel = useLogQueryStore((s) => s.logLevel);
  const eventType = useLogQueryStore((s) => s.eventType);
  const loading = useLogQueryStore((s) => s.loading);
  const exporting = useLogQueryStore((s) => s.exporting);
  const setQueryParams = useLogQueryStore((s) => s.setQueryParams);
  const queryActiveTab = useLogQueryStore((s) => s.queryActiveTab);
  const exportCsv = useLogQueryStore((s) => s.exportCsv);

  // 设备列表（从 deviceStore 获取）
  const devices = useDeviceStore((s) => s.devices);
  const deviceList = Object.values(devices);

  const handleQuery = useCallback(() => {
    void queryActiveTab();
  }, [queryActiveTab]);

  const handleExport = useCallback(() => {
    void exportCsv();
  }, [exportCsv]);

  const handleQuickRange = useCallback(
    (hours: number) => {
      setQueryParams({ timeRange: recentTimeRange(hours) });
    },
    [setQueryParams],
  );

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        background: "linear-gradient(180deg, rgba(22,38,62,0.92) 0%, rgba(16,28,48,0.95) 100%)",
        border: "1px solid rgba(120,144,156,0.4)",
        borderRadius: 1.5,
        p: 1.5,
        gap: 1.2,
      }}
    >
      {/* 标题栏 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
        <Box sx={{ width: 3, height: 14, background: "#B0BEC5", borderRadius: 0.5 }} />
        <Typography sx={{ fontSize: 13, color: "#B0BEC5", fontWeight: 700, letterSpacing: 1 }}>
          {title}
        </Typography>
      </Box>

      {/* 快捷时间范围 */}
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", flexShrink: 0 }}>
        {QUICK_RANGES.map((r) => (
          <Button
            key={r.hours}
            size="small"
            variant="outlined"
            onClick={() => handleQuickRange(r.hours)}
            sx={{
              minWidth: 0,
              py: 0.15,
              px: 0.8,
              fontSize: 10,
              color: "rgba(176,190,197,0.8)",
              borderColor: "rgba(120,144,156,0.4)",
              "&:hover": {
                borderColor: "rgba(90,158,214,0.7)",
                bgcolor: "rgba(90,158,214,0.1)",
              },
            }}
          >
            {r.label}
          </Button>
        ))}
      </Box>

      {/* 时间范围 - 开始 */}
      <TextField
        label="开始时间"
        type="datetime-local"
        size="small"
        fullWidth
        value={toDateTimeLocalValue(timeRange.from)}
        onChange={(e) => {
          const val = fromDateTimeLocalValue(e.target.value);
          if (val) setQueryParams({ timeRange: { ...timeRange, from: val } });
        }}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={textFieldSx}
      />

      {/* 时间范围 - 结束 */}
      <TextField
        label="结束时间"
        type="datetime-local"
        size="small"
        fullWidth
        value={toDateTimeLocalValue(timeRange.to)}
        onChange={(e) => {
          const val = fromDateTimeLocalValue(e.target.value);
          if (val) setQueryParams({ timeRange: { ...timeRange, to: val } });
        }}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={textFieldSx}
      />

      {/* 设备选择 */}
      <TextField
        label="设备ID"
        size="small"
        fullWidth
        select
        value={deviceId}
        onChange={(e) => setQueryParams({ deviceId: e.target.value })}
        sx={textFieldSx}
      >
        <MenuItem value="">
          <em>全部设备</em>
        </MenuItem>
        {deviceList.map((d) => (
          <MenuItem key={d.deviceId} value={d.deviceId}>
            {d.productName || d.deviceId}
          </MenuItem>
        ))}
      </TextField>

      {/* 日志级别 */}
      <TextField
        label="日志级别"
        size="small"
        fullWidth
        select
        value={logLevel}
        onChange={(e) => setQueryParams({ logLevel: e.target.value })}
        sx={textFieldSx}
      >
        {LEVEL_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>

      {/* 事件类型 */}
      <TextField
        label="事件类型"
        size="small"
        fullWidth
        select
        value={eventType}
        onChange={(e) => setQueryParams({ eventType: e.target.value })}
        sx={textFieldSx}
      >
        {EVENT_TYPE_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>

      {/* 操作按钮 */}
      <Box sx={{ display: "flex", gap: 1, mt: "auto", flexShrink: 0 }}>
        <Button
          variant="contained"
          size="small"
          fullWidth
          disabled={loading}
          onClick={handleQuery}
          sx={{
            bgcolor: "rgba(90,158,214,0.85)",
            "&:hover": { bgcolor: "rgba(90,158,214,1)" },
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {loading ? <CircularProgress size={16} color="inherit" /> : "查询"}
        </Button>
        {showExport && (
          <Button
            variant="outlined"
            size="small"
            fullWidth
            disabled={exporting}
            onClick={handleExport}
            sx={{
              color: "rgba(176,190,197,0.9)",
              borderColor: "rgba(120,144,156,0.5)",
              fontSize: 12,
              fontWeight: 600,
              "&:hover": {
                borderColor: "rgba(90,158,214,0.7)",
                bgcolor: "rgba(90,158,214,0.08)",
              },
            }}
          >
            {exporting ? <CircularProgress size={16} color="inherit" /> : "导出CSV"}
          </Button>
        )}
      </Box>
    </Box>
  );
}

/** 暗色主题 TextField 样式 */
const textFieldSx = {
  "& .MuiInputLabel-root": {
    color: "rgba(176,190,197,0.7)",
    fontSize: 12,
  },
  "& .MuiOutlinedInput-root": {
    color: "#e0e8f0",
    fontSize: 12,
    "& fieldset": {
      borderColor: "rgba(120,144,156,0.4)",
    },
    "&:hover fieldset": {
      borderColor: "rgba(90,158,214,0.6)",
    },
    "&.Mui-focused fieldset": {
      borderColor: "rgba(90,158,214,0.8)",
    },
  },
  "& .MuiSelect-icon": {
    color: "rgba(176,190,197,0.6)",
  },
  "& input": {
    colorScheme: "dark",
  },
} as const;
