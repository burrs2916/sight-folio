import { useState, useEffect, useRef, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ComponentRendererProps } from "../../../types/editor";
import { useDeviceStore } from "../../../store/deviceStore";
const getEffectiveOnline = (id: string) => useDeviceStore.getState().getEffectiveOnline(id);
import { useDataSourceStore } from "../../../store/datasourceStore";
import type { DeviceInstance } from "../../../types/device";

/**
 * 滚动状态表格 - 工业大屏风格
 *
 * 纯表格：只有表头 + 数据行，无杂项
 * - 数据源：自动从 useDataSourceStore 找 http+enabled
 * - 设备：config.selectedDeviceIds 勾选
 * - 列：config.columnMappings（键值对），用户在属性栏配置
 * - 状态列特殊处理：呼吸灯 + 行背景着色
 * - 未完成配置时显示步骤引导
 *
 * 列对齐规则（按 value 字段自动推断）：
 * - 状态列(state/status/online) → 居中
 * - 文本列(Id/Name/Code/Type/Category) → 左对齐 + 左padding
 * - 时间列(Time/Date) → 右对齐 + 右padding
 * - 数字型 → 右对齐 + 右padding + monospace
 * - 其余 → 左对齐 + 左padding
 */

/** 列对齐类型 */
type ColumnAlign = "center" | "left" | "right";

/** 根据 value 字段推断列对齐方式 */
function inferColumnAlign(col: { key: string; value: string }): ColumnAlign {
  const v = col.value;
  // 状态列 → 居中
  if (/state|status|online/i.test(v)) return "center";
  // 时间列 → 右对齐
  if (/time|date|timestamp/i.test(v)) return "right";
  // 纯数字字段(以 Value/sensorValue/finalValue 等结尾) → 右对齐
  if (/^(sensorValue|finalValue|alarmHigh|alarmLow|maxRange|minRange|batteryVoltage)$/.test(v)) return "right";
  // 文本列 → 左对齐
  return "left";
}

/** 根据对齐方式生成单元格 padding */
function getCellPadding(align: ColumnAlign, base: number): { paddingLeft: number; paddingRight: number } {
  switch (align) {
    case "left":   return { paddingLeft: base * 0.6, paddingRight: base * 0.2 };
    case "right":  return { paddingLeft: base * 0.2, paddingRight: base * 0.6 };
    case "center": return { paddingLeft: base * 0.25, paddingRight: base * 0.25 };
  }
}

export function ScrollingTableRenderer(props: ComponentRendererProps) {
  const config = props?.config ?? {};
  const height = props?.height ?? 300;
  const scrollSpeed = (config.scrollSpeed as number) ?? 30;
  const scrollDirection = (config.scrollDirection as string) ?? "vertical";
  const maxRows = (config.maxRows as number) ?? 20;
  const headerBgColor = (config.headerBgColor as string) || "#1a3a6e";
  const rowBgColor = (config.rowBgColor as string) || "rgba(79,195,247,0.06)";
  const textColor = (config.textColor as string) || "#ffffff";
  const accentColor = (config.accentColor as string) || "#4fc3f7";

  const devices = useDeviceStore((s) => s.devices) as Record<string, DeviceInstance>;
  const deviceStates = useDeviceStore((s) => s.deviceStates) as Record<string, string>;

  const dataSources = useDataSourceStore((s) => s.dataSources);
  const connectionStatuses = useDataSourceStore((s) => s.connectionStatuses);
  const edgeDataSource = useMemo(
    () => dataSources.find((ds) => ds.type === "http" && ds.enabled) || null,
    [dataSources]
  );
  const connStatus = edgeDataSource ? connectionStatuses[edgeDataSource.id] : undefined;

  // 列映射：用户配置后才显示表格
  const userColumns: Array<{ key: string; value: string }> = useMemo(() => {
    const arr = config.columnMappings as Array<{ key: string; value: string }> | undefined;
    return Array.isArray(arr) ? arr.filter((m) => m.key && m.value) : [];
  }, [config.columnMappings]);

  // 状态列：如果用户没配状态列，自动前置一列
  const hasStatusCol = userColumns.some((c) => /state|status|online/i.test(c.value));
  const columns: Array<{ key: string; value: string }> = useMemo(() => {
    if (hasStatusCol) return userColumns;
    return [{ key: "状态", value: "stateName" }, ...userColumns];
  }, [userColumns, hasStatusCol]);

  // 预计算每列的对齐方式
  const columnAligns = useMemo(() => columns.map((col) => inferColumnAlign(col)), [columns]);

  const selectedIds = (config.selectedDeviceIds as string[]) || [];
  const productCodeFilter = (config.productCodeFilter as string) || "";

  const rows = useMemo(() => {
    const selSet = new Set(selectedIds);
    const codeSet = new Set(
      productCodeFilter.split(",").map((s) => s.trim()).filter(Boolean)
    );
    return Object.values(devices)
      .filter((d) => selSet.size === 0 || selSet.has(d.deviceId))
      .filter((d) => codeSet.size === 0 || codeSet.has(d.productCode))
      .sort((a, b) => {
        const aOnline = getEffectiveOnline(a.deviceId);
        const bOnline = getEffectiveOnline(b.deviceId);
        if (aOnline !== bOnline) return aOnline ? -1 : 1;
        return a.deviceId.localeCompare(b.deviceId);
      })
      .slice(0, maxRows)
      .map((d) => {
        const row: Record<string, unknown> = { __device: d };
        columns.forEach((m) => {
          row[m.key] = extractFieldValue(d, m.value, deviceStates[d.deviceId]);
        });
        return row;
      });
  }, [devices, deviceStates, selectedIds, productCodeFilter, maxRows, columns]);

  // 滚动动画
  const [offset, setOffset] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rows.length <= 2) return;
    let raf: number;
    let lastTime = performance.now();
    const animate = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      setOffset((prev) => {
        const contentHeight = contentRef.current?.scrollHeight ?? 0;
        const contentWidth = contentRef.current?.scrollWidth ?? 0;
        const newOffset = prev - scrollSpeed * dt;
        if (scrollDirection === "vertical") {
          if (contentHeight > 0 && Math.abs(newOffset) > contentHeight / 2) return 0;
          return newOffset;
        } else {
          if (contentWidth > 0 && Math.abs(newOffset) > contentWidth / 2) return 0;
          return newOffset;
        }
      });
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [rows.length, scrollSpeed, scrollDirection]);

  const headerHeight = Math.max(28, height * 0.12);
  const rowHeight = Math.max(22, (height - headerHeight) / Math.max(rows.length, 6));
  const fontSize = Math.max(10, rowHeight * 0.38);
  const cellPad = fontSize * 1.2; // 基础 padding 单位

  // ── 状态列识别 ──
  const isStatusColumn = (col: { key: string; value: string }) =>
    /state|status|online/i.test(col.value);

  // ── 行状态（用于行背景着色） ──
  const getRowStatus = (row: Record<string, unknown>): "normal" | "alarm" | "offline" | "fault" | "unknown" => {
    const dev = row.__device as DeviceInstance;
    if (!dev) return "unknown";
    if (!getEffectiveOnline(dev.deviceId)) return "offline";
    const sn = String(deviceStates[dev.deviceId] ?? "").toLowerCase();
    if (sn.includes("alarm")) return "alarm";
    if (sn.includes("fault")) return "fault";
    return "normal";
  };

  const statusColors: Record<string, { dot: string; bg: string; text: string }> = {
    normal:  { dot: "#22c55e", bg: "transparent",            text: "正常" },
    alarm:   { dot: "#f59e0b", bg: "rgba(245,158,11,0.10)",  text: "异常" },
    fault:   { dot: "#ef4444", bg: "rgba(239,68,68,0.10)",   text: "故障" },
    offline: { dot: "#6b7280", bg: "rgba(107,114,128,0.08)", text: "离线" },
    unknown: { dot: "#6b7280", bg: "transparent",            text: "--" },
  };

  // 网格线颜色
  const rowBorderColor = "rgba(255,255,255,0.06)";    // 行间线 — 可见
  const colBorderColor = "rgba(255,255,255,0.04)";    // 列间线 — 淡于行线
  const headerBorderColor = `${accentColor}40`;        // 表头底线 — accent 25%

  // ── 单元格渲染 ──
  const renderCell = (row: Record<string, unknown>, col: { key: string; value: string }, align: ColumnAlign) => {
    const value = row[col.key];

    // 状态列 -> 呼吸灯 + 状态文字
    if (isStatusColumn(col)) {
      const dev = row.__device as DeviceInstance;
      let status: "normal" | "alarm" | "offline" | "fault" | "unknown" = "unknown";
      if (dev) {
        if (!getEffectiveOnline(dev.deviceId)) status = "offline";
        else {
          const sn = String(deviceStates[dev.deviceId] ?? "").toLowerCase();
          if (sn.includes("alarm")) status = "alarm";
          else if (sn.includes("fault")) status = "fault";
          else if (sn) status = "normal";
        }
      }
      const sc = statusColors[status];
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%", justifyContent: "center" }}>
          <Box
            sx={{
              width: fontSize * 0.6,
              height: fontSize * 0.6,
              borderRadius: "50%",
              bgcolor: sc.dot,
              boxShadow: status === "alarm" || status === "fault"
                ? `0 0 ${fontSize * 0.5}px ${sc.dot}`
                : "none",
              animation: status === "alarm" || status === "fault"
                ? "statusBlink 1.2s ease-in-out infinite"
                : "none",
              "@keyframes statusBlink": {
                "0%, 100%": { opacity: 1 },
                "50%": { opacity: 0.3 },
              },
              flexShrink: 0,
            }}
          />
          <Typography sx={{ fontSize, color: sc.dot, fontWeight: 500 }}>{sc.text}</Typography>
        </Box>
      );
    }

    // 布尔型 -> 圆点
    if (typeof value === "boolean") {
      return renderDotCell(value, fontSize);
    }
    // 数字型 → 右对齐 + monospace
    if (typeof value === "number") {
      return (
        <Typography
          sx={{
            fontSize, color: textColor, fontFamily: "monospace", fontWeight: 600,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            textAlign: "right", width: "100%",
          }}
        >
          {value}
        </Typography>
      );
    }
    // 默认文本 → 按对齐规则
    return (
      <Typography
        sx={{
          fontSize, color: textColor, opacity: 0.9,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          textAlign: align, width: "100%",
        }}
      >
        {String(value ?? "--")}
      </Typography>
    );
  };

  // ── 显示条件 ──
  const hasRows = rows.length > 0;
  const hasDataSource = !!edgeDataSource;
  const isConnected = connStatus?.status === "connected";
  const hasSelectedDevices = selectedIds.length > 0;
  const hasColumnMappings = userColumns.length > 0;
  const showTable = hasRows && hasColumnMappings;

  return (
    <Box
      sx={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.2) 100%)",
        borderRadius: 1, border: `1px solid ${accentColor}15`, overflow: "hidden",
      }}
    >
      {/* 表头 */}
      {showTable && (
        <Box
          sx={{
            display: "flex", height: headerHeight, minHeight: headerHeight,
            background: headerBgColor,
            borderBottom: `1.5px solid ${headerBorderColor}`,
            flexShrink: 0,
          }}
        >
          {columns.map((col, ci) => {
            const align = columnAligns[ci];
            const pad = getCellPadding(align, cellPad);
            return (
              <Box
                key={col.key}
                sx={{
                  flex: 1, display: "flex", alignItems: "center",
                  justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
                  paddingLeft: pad.paddingLeft,
                  paddingRight: pad.paddingRight,
                  minWidth: 0,
                  // 列间线（最后一列不加）
                  borderRight: ci < columns.length - 1 ? `1px solid ${colBorderColor}` : "none",
                }}
              >
                <Typography
                  sx={{
                    fontSize: fontSize * 0.95, color: textColor, fontWeight: 700,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
                    letterSpacing: "0.5px",
                  }}
                >
                  {col.key}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}

      {/* 内容区 */}
      {showTable ? (
        <Box sx={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <Box
            ref={contentRef}
            sx={{
              position: "absolute", top: 0, left: 0, width: "100%",
              transform: scrollDirection === "vertical"
                ? `translateY(${offset}px)`
                : `translateX(${offset}px)`,
              willChange: "transform",
            }}
          >
            {/* 渲染两遍实现无缝循环 */}
            {[...rows, ...rows].map((row, idx) => {
              const rs = getRowStatus(row);
              const sc = statusColors[rs];
              return (
                <Box
                  key={`${(row.__device as DeviceInstance).deviceId}-${idx}`}
                  sx={{
                    display: "flex", height: rowHeight, minHeight: rowHeight,
                    backgroundColor: sc.bg !== "transparent"
                      ? sc.bg
                      : (idx % 2 === 0 ? rowBgColor : "transparent"),
                    borderBottom: `1px solid ${rowBorderColor}`,
                    "&:hover": { backgroundColor: `${accentColor}20` },
                    transition: "background-color 0.2s",
                  }}
                >
                  {columns.map((col, ci) => {
                    const align = columnAligns[ci];
                    const pad = getCellPadding(align, cellPad);
                    return (
                      <Box
                        key={col.key}
                        sx={{
                          flex: 1, display: "flex", alignItems: "center",
                          paddingLeft: pad.paddingLeft,
                          paddingRight: pad.paddingRight,
                          minWidth: 0,
                          // 列间线
                          borderRight: ci < columns.length - 1 ? `1px solid ${colBorderColor}` : "none",
                        }}
                      >
                        {renderCell(row, col, align)}
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        </Box>
      ) : (
        // 配置引导
        <Box
          sx={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 1, p: 2,
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxWidth: 300, width: "100%" }}>
            {[
              { done: hasDataSource && isConnected, label: "连接边缘计算数据源", tip: !hasDataSource ? "请在数据源管理中创建 http 类型数据源" : !isConnected ? "请检查网络连接" : "" },
              { done: hasSelectedDevices, label: "勾选要显示的设备", tip: !hasSelectedDevices ? "在属性栏「勾选设备」中选择" : "" },
              { done: hasColumnMappings, label: "配置列字段映射", tip: !hasColumnMappings ? "在属性栏「列字段映射」中添加表头和对应字段" : "" },
            ].map((step, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
                <Box
                  sx={{
                    width: 16, height: 16, borderRadius: "50%",
                    bgcolor: step.done ? "#22c55e" : "transparent",
                    border: `1.5px solid ${step.done ? "#22c55e" : "rgba(255,255,255,0.3)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, mt: 0.1,
                  }}
                >
                  {step.done && <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "#fff" }} />}
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 11, color: step.done ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.9)", fontWeight: step.done ? 400 : 600, textDecoration: step.done ? "line-through" : "none" }}>
                    {i + 1}. {step.label}
                  </Typography>
                  {step.tip && (
                    <Typography sx={{ fontSize: 9, color: "rgba(255,255,255,0.4)", mt: 0.1 }}>
                      {step.tip}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
          <Typography sx={{ color: "rgba(255,255,255,0.3)", fontSize: 10, textAlign: "center", mt: 0.5 }}>
            {hasColumnMappings && !hasRows ? "已配置字段映射，但未获取到设备数据" : "完成以上配置后表格自动显示"}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ─── 辅助函数 ──

function extractFieldValue(
  device: DeviceInstance,
  fieldName: string,
  stateName: string | undefined
): unknown {
  const basicMap: Record<string, unknown> = {
    deviceId: device.deviceId,
    productCode: device.productCode,
    productName: device.productName,
    category: device.category,
    sensorSubType: device.sensorSubType,
    parentDeviceId: device.parentDeviceId,
    online: device.online,
  };
  if (fieldName in basicMap) return basicMap[fieldName];

  if (fieldName === "stateName" || fieldName === "state") return stateName ?? "unknown";
  if (fieldName === "onlineText") return device.online ? "在线" : "离线";

  const meta = device.metadata || {};
  const realtime = (meta.realtime as Record<string, unknown>) || {};
  if (fieldName in realtime) return realtime[fieldName];
  if (fieldName in meta) return meta[fieldName];

  return undefined;
}

function renderDotCell(value: boolean, fontSize: number) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
      <Box
        sx={{
          width: fontSize * 0.7, height: fontSize * 0.7, borderRadius: "50%",
          backgroundColor: value ? "#22c55e" : "#6b7280",
          boxShadow: value ? `0 0 ${fontSize * 0.4}px #22c55e66` : "none",
        }}
      />
    </Box>
  );
}
