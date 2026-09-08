import { useState, useEffect, useMemo, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ComponentRendererProps } from "../../../types/editor";
import { useDeviceStore } from "../../../store/deviceStore";

/**
 * 告警轮播栏 — 工业大屏风格（4K 适配）
 *
 * 实时数据接入（与"传感器实时监控"组件一致）：
 *   - 从 deviceStore 实时聚合"选中的集控器下"传感器的告警
 *   - 6 类告警：报警触发 / 阈值告警(超限+欠限) / 量程告警 / 电池预警 / 状态码告警 / 设备故障&离线
 *   - selectedDeviceIds 留空时 → 自动用 deviceStore 中所有集控器（零配置）
 *
 * 视觉设计：
 *   - 4K 大屏字体自适应（基准 22-28px，随 width/height 缩放）
 *   - 无告警：绿色状态面板 + 统计摘要 + 扫描线动画
 *   - 有告警：左侧级别色带脉动 + 消息主体 + 来源/时间 + 分页指示
 */

type Level = "critical" | "warning" | "info";
type AlarmType = "alarm" | "overHigh" | "underLow" | "overRange" | "batteryWarning" | "statusCode" | "deviceFault" | "deviceOffline";

interface AlarmItem {
  id: string;
  level: Level;
  type: AlarmType;
  deviceId: string;
  deviceName: string;
  parentName: string;
  message: string;
  value?: number | string;
  time: number;
  timestamp: number;
}

const MAIN_CONTROLLER_PRODUCT_CODES = ["18", "FY002-MainController"];

function isMainController(d: Record<string, unknown> | undefined): boolean {
  if (!d) return false;
  const pc = String(d.productCode ?? "");
  const cat = String(d.category ?? "");
  return MAIN_CONTROLLER_PRODUCT_CODES.includes(pc) || cat === "main";
}

function isSubController(pc: string): boolean {
  return pc === "18001" || pc === "FY002-SubController-Spray";
}

function isSensor(pc: string): boolean {
  const n = parseInt(pc, 10);
  if (isNaN(n)) return false;
  if (pc === "FY002-FreqSensor-WindSpeed") return true;
  if (pc === "FY002-AlarmSensor-IR") return true;
  return (n >= 18010 && n <= 18015) || (n >= 18020 && n <= 18031);
}

function isFreqSensor(pc: string): boolean {
  const n = parseInt(pc, 10);
  if (isNaN(n)) return false;
  if (pc === "FY002-FreqSensor-WindSpeed") return true;
  return n >= 18010 && n <= 18015;
}

function isAlarmSensor(pc: string): boolean {
  const n = parseInt(pc, 10);
  if (isNaN(n)) return false;
  if (pc === "FY002-AlarmSensor-IR") return true;
  return n >= 18020 && n <= 18031;
}

function levelPriority(l: Level): number {
  return l === "critical" ? 0 : l === "warning" ? 1 : 2;
}

/** 告警类型中文标签 */
const TYPE_LABELS: Record<AlarmType, string> = {
  alarm: "报警触发",
  overHigh: "超上限",
  underLow: "超下限",
  overRange: "超量程",
  batteryWarning: "电池预警",
  statusCode: "状态码异常",
  deviceFault: "设备故障",
  deviceOffline: "设备离线",
};

export function AlarmCarouselRenderer(props: ComponentRendererProps) {
  const config = props?.config ?? {};
  const width = props?.width ?? 400;
  const height = props?.height ?? 60;
  const intervalMs = (config.intervalMs as number) ?? 4000;
  void config.dataSourceId;
  void config.dataField;

  const devicesMap = useDeviceStore((s) => s.devices) as unknown as Record<string, Record<string, unknown>>;
  const getEffectiveOnline = useDeviceStore((s) => s.getEffectiveOnline);
  const mainControllerIds = (config.selectedDeviceIds as string[]) ?? [];

  // ── 字体系统：4K 大屏自适应 ──
  // 基准：width=3800, height=100 时，主字体 26px
  const baseFontSize = Math.max(14, Math.min(width / 150, height * 0.3, 30));
  const labelFontSize = baseFontSize * 0.7;     // 级别标签、次要文字
  const smallFontSize = baseFontSize * 0.55;    // 统计、时间
  const iconSize = baseFontSize * 1.1;          // 状态图标尺寸

  // ── UI tick ──
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  // ── 集控器发现 ──
  const resolvedMains = useMemo(() => {
    const userPicked = mainControllerIds.filter((id) => isMainController(devicesMap[id]));
    if (userPicked.length > 0) return userPicked;
    return Object.entries(devicesMap)
      .filter(([, d]) => isMainController(d))
      .map(([id]) => id);
  }, [mainControllerIds, devicesMap]);

  // ── 三级发现：集控器 → 分控器 → 传感器 ──
  const sensors = useMemo(() => {
    if (resolvedMains.length === 0) return [];
    const relevant = new Set<string>(resolvedMains);
    for (const [id, d] of Object.entries(devicesMap)) {
      const dev = d as Record<string, unknown>;
      const parentId = dev.parentDeviceId as string | undefined;
      if (isSubController(String(dev.productCode ?? "")) && parentId && resolvedMains.includes(parentId)) {
        relevant.add(id);
      }
    }
    const result: Array<Record<string, unknown>> = [];
    for (const [id, d] of Object.entries(devicesMap)) {
      const dev = d as Record<string, unknown>;
      const pc = String(dev.productCode ?? "");
      const parentId = dev.parentDeviceId as string | undefined;
      if (isSensor(pc) && parentId && relevant.has(parentId)) {
        result.push({ id, ...dev });
      }
    }
    return result;
  }, [resolvedMains, devicesMap]);

  // ── 6 类告警聚合 ──
  const alarms: AlarmItem[] = useMemo(() => {
    const list: AlarmItem[] = [];
    for (const s of sensors) {
      const id = String(s.id);
      const pc = String(s.productCode ?? "");
      const md = (s.metadata ?? {}) as Record<string, unknown>;
      const rt = (md.realtime ?? {}) as Record<string, { value?: unknown; timestamp?: number }>;
      const alias = String(md.alias ?? "");
      const productName = String(s.productName ?? alias ?? id);
      const parentId = String(s.parentDeviceId ?? "");
      const parent = parentId ? devicesMap[parentId] : undefined;
      const parentName = String((parent as Record<string, unknown> | undefined)?.productName ?? "分控器");
      const online = getEffectiveOnline(id);
      const fault = Boolean(s.fault);
      const lastHb = Number(rt.lastHeartbeat?.timestamp ?? md.lastHeartbeat ?? 0) || 0;

      // 1) 报警型
      if (isAlarmSensor(pc) && rt.alarm?.value === true) {
        const ts = Number(rt.alarm.timestamp ?? 0) || lastHb;
        list.push({ id: `${id}-alarm`, level: "critical", type: "alarm", deviceId: id, deviceName: productName, parentName, message: "触发报警", time: ts, timestamp: ts });
      }
      // 2) 频率型阈值
      if (isFreqSensor(pc)) {
        const finalVal = rt.finalValue?.value ?? rt.sensorValue?.value;
        const v = finalVal != null ? Number(finalVal) : null;
        const ts = Number(rt.finalValue?.timestamp ?? rt.sensorValue?.timestamp ?? 0) || lastHb;
        const alarmHigh = Number(md.alarmHigh);
        const alarmLow = Number(md.alarmLow);
        const maxRange = Number(md.maxRange);
        if (v != null && !isNaN(v)) {
          if (!isNaN(alarmHigh) && v > alarmHigh)
            list.push({ id: `${id}-overHigh`, level: "warning", type: "overHigh", deviceId: id, deviceName: productName, parentName, message: "超上限", value: v, time: ts, timestamp: ts });
          if (!isNaN(alarmLow) && v < alarmLow)
            list.push({ id: `${id}-underLow`, level: "warning", type: "underLow", deviceId: id, deviceName: productName, parentName, message: "超下限", value: v, time: ts, timestamp: ts });
          if (!isNaN(maxRange) && v > maxRange)
            list.push({ id: `${id}-overRange`, level: "critical", type: "overRange", deviceId: id, deviceName: productName, parentName, message: "超量程", value: v, time: ts, timestamp: ts });
        }
      }
      // 3) 电池预警
      if (rt.batteryWarning?.value === true) {
        const ts = Number(rt.batteryWarning.timestamp ?? 0) || lastHb;
        list.push({ id: `${id}-battery`, level: "warning", type: "batteryWarning", deviceId: id, deviceName: productName, parentName, message: "电池预警", time: ts, timestamp: ts });
      }
      // 4) 状态码
      const code = Number(rt.sensorStatusCode?.value ?? 0);
      if (code & 0x77) {
        const ts = Number(rt.sensorStatusCode?.timestamp ?? 0) || lastHb;
        list.push({ id: `${id}-code`, level: "info", type: "statusCode", deviceId: id, deviceName: productName, parentName, message: "状态码异常", time: ts, timestamp: ts, value: code });
      }
      // 5) 设备故障
      if (fault) {
        list.push({ id: `${id}-fault`, level: "critical", type: "deviceFault", deviceId: id, deviceName: productName, parentName, message: "设备故障", time: lastHb, timestamp: lastHb });
      }
      // 6) 设备离线
      if (!online) {
        list.push({ id: `${id}-offline`, level: "info", type: "deviceOffline", deviceId: id, deviceName: productName, parentName, message: "设备离线", time: lastHb, timestamp: lastHb });
      }
    }
    return list.sort((a, b) => levelPriority(a.level) - levelPriority(b.level) || b.timestamp - a.timestamp);
  }, [sensors, devicesMap, getEffectiveOnline]);

  // ── 告警统计（按级别） ──
  const stats = useMemo(() => {
    const critical = alarms.filter((a) => a.level === "critical").length;
    const warning = alarms.filter((a) => a.level === "warning").length;
    const info = alarms.filter((a) => a.level === "info").length;
    return { critical, warning, info, total: alarms.length };
  }, [alarms]);

  // ── 自动轮播 ──
  const [currentIdx, setCurrentIdx] = useState(0);
  useEffect(() => {
    if (alarms.length <= 1) { setCurrentIdx(0); return; }
    const timer = setInterval(() => setCurrentIdx((prev) => (prev + 1) % alarms.length), intervalMs);
    return () => clearInterval(timer);
  }, [alarms.length, intervalMs]);

  // ── 辅助函数 ──
  const levelColor = useCallback((level: Level) => {
    if (level === "critical") return "#ef4444";
    if (level === "warning") return "#f59e0b";
    return "#3b82f6";
  }, []);
  const levelLabel = useCallback((level: Level) => {
    if (level === "critical") return "严重";
    if (level === "warning") return "警告";
    return "提示";
  }, []);
  const relTime = useCallback((ts: number) => {
    if (!ts) return "未知";
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}秒前`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
    return `${Math.floor(sec / 86400)}天前`;
  }, []);

  const padH = Math.max(12, baseFontSize * 0.8);
  const isWide = width > height * 3;

  // ═══════════════════════════════════════════════════════════
  // 无告警：系统正常面板
  // ═══════════════════════════════════════════════════════════
  if (alarms.length === 0) {
    const sensorText = sensors.length > 0 ? `${sensors.length} 个传感器` : "";
    const mainText = resolvedMains.length > 0 ? `${resolvedMains.length} 台集控器` : "";
    const summaryParts = [mainText, sensorText].filter(Boolean);
    const summary = summaryParts.length > 0 ? summaryParts.join(" / ") : "等待设备接入…";

    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: "linear-gradient(90deg, rgba(34,197,94,0.08) 0%, rgba(15,23,42,0.85) 30%, rgba(15,23,42,0.9) 70%, rgba(34,197,94,0.08) 100%)",
          borderRadius: 1.5,
          border: "1px solid rgba(34,197,94,0.25)",
          px: padH,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 左侧绿色竖条 */}
        <Box sx={{
          position: "absolute", left: 0, top: "10%", bottom: "10%", width: 4,
          background: "linear-gradient(180deg, transparent, #22c55e, transparent)",
          borderRadius: 2,
          boxShadow: "0 0 12px #22c55e66",
        }} />

        {/* 扫描线动画 */}
        <Box sx={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: "100%",
          background: "linear-gradient(90deg, transparent 0%, rgba(34,197,94,0.06) 45%, rgba(34,197,94,0.12) 50%, rgba(34,197,94,0.06) 55%, transparent 100%)",
          animation: "scanLine 4s linear infinite",
          "@keyframes scanLine": { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
        }} />

        {/* 绿色状态点 */}
        <Box sx={{
          width: iconSize, height: iconSize, borderRadius: "50%",
          backgroundColor: "#22c55e",
          boxShadow: "0 0 12px #22c55e88, 0 0 24px #22c55e44",
          animation: "greenPulse 2.5s ease-in-out infinite",
          "@keyframes greenPulse": { "0%,100%": { boxShadow: "0 0 12px #22c55e88, 0 0 24px #22c55e44" }, "50%": { boxShadow: "0 0 20px #22c55eaa, 0 0 40px #22c55e66" } },
          flexShrink: 0, mr: 1.5,
        }} />

        {/* 主标题 */}
        <Typography sx={{
          fontSize: baseFontSize,
          color: "#22c55e",
          fontWeight: 700,
          letterSpacing: 2,
          whiteSpace: "nowrap",
          textShadow: "0 0 12px #22c55e44",
          flexShrink: 0,
        }}>
          系统正常
        </Typography>

        {/* 分隔竖线 */}
        <Box sx={{ width: 1, height: baseFontSize * 0.7, backgroundColor: "rgba(34,197,94,0.3)", mx: 2, flexShrink: 0 }} />

        {/* 统计摘要 */}
        <Typography sx={{
          fontSize: labelFontSize,
          color: "rgba(34,197,94,0.7)",
          fontWeight: 500,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          无告警 · {summary}
        </Typography>

        {/* 右侧：监测数量 badge */}
        {sensors.length > 0 && (
          <>
            <Box sx={{ flex: 1 }} />
            <Box sx={{
              display: "flex", alignItems: "center", gap: 0.8,
              px: 1.5, py: 0.4,
              borderRadius: 1,
              backgroundColor: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.2)",
              flexShrink: 0,
            }}>
              <Typography sx={{ fontSize: smallFontSize, color: "rgba(34,197,94,0.5)", fontWeight: 400 }}>
                MONITORING
              </Typography>
              <Typography sx={{ fontSize: baseFontSize * 0.8, color: "#22c55e", fontWeight: 700, fontFeatures: '"tnum"', ml: 0.5 }}>
                {sensors.length}
              </Typography>
            </Box>
          </>
        )}
      </Box>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // 有告警：轮播面板
  // ═══════════════════════════════════════════════════════════
  const current = alarms[currentIdx];
  const color = levelColor(current.level);
  const isCritical = current.level === "critical";

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        background: `linear-gradient(90deg, ${color}10 0%, rgba(15,23,42,0.9) 25%, rgba(15,23,42,0.92) 75%, ${color}08 100%)`,
        borderRadius: 1.5,
        border: `1px solid ${color}35`,
        px: padH,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 左侧级别色带 */}
      <Box sx={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: isCritical ? 5 : 3,
        background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
        boxShadow: isCritical ? `0 0 16px ${color}aa` : `0 0 8px ${color}66`,
        animation: isCritical ? "alarmBar 1.2s ease-in-out infinite" : "none",
        "@keyframes alarmBar": {
          "0%,100%": { boxShadow: `0 0 16px ${color}aa`, opacity: 1 },
          "50%": { boxShadow: `0 0 32px ${color}cc`, opacity: 0.7 },
        },
      }} />

      {/* 扫描线（仅严重告警） */}
      {isCritical && (
        <Box sx={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: "100%",
          background: `linear-gradient(90deg, transparent 0%, ${color}08 45%, ${color}15 50%, ${color}08 55%, transparent 100%)`,
          animation: "alarmScan 2s linear infinite",
          "@keyframes alarmScan": { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
        }} />
      )}

      {/* ── 级别标签 ── */}
      <Box sx={{
        px: 1.2, py: 0.2,
        borderRadius: 0.8,
        backgroundColor: `${color}20`,
        border: `1px solid ${color}40`,
        mr: 1.5, ml: 1,
        flexShrink: 0,
        boxShadow: `0 0 8px ${color}22`,
      }}>
        <Typography sx={{ fontSize: labelFontSize, color, fontWeight: 700, whiteSpace: "nowrap", letterSpacing: 1 }}>
          {levelLabel(current.level)}
        </Typography>
      </Box>

      {/* ── 告警类型图标标签 ── */}
      <Box sx={{
        px: 0.8, py: 0.15,
        borderRadius: 0.5,
        backgroundColor: `${color}12`,
        mr: 1.2,
        flexShrink: 0,
      }}>
        <Typography sx={{ fontSize: smallFontSize, color: `${color}bb`, fontWeight: 500, whiteSpace: "nowrap" }}>
          {TYPE_LABELS[current.type]}
        </Typography>
      </Box>

      {/* ── 来源（分控器 · 传感器） ── */}
      {isWide && (
        <Typography sx={{
          fontSize: labelFontSize,
          color: "rgba(255,255,255,0.45)",
          mr: 1.2,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}>
          {current.parentName} · {current.deviceName}
        </Typography>
      )}

      {/* ── 告警消息主体 ── */}
      <Typography sx={{
        fontSize: baseFontSize,
        color: `${color}ee`,
        fontWeight: 700,
        flex: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        lineHeight: 1.3,
        textShadow: isCritical ? `0 0 8px ${color}44` : "none",
      }}>
        {current.message}
        {current.value != null && current.type !== "statusCode" && current.type !== "deviceFault" && current.type !== "deviceOffline"
          ? `  ${current.value}`
          : ""}
      </Typography>

      {/* ── 右侧信息区 ── */}
      {isWide && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, ml: 2, flexShrink: 0 }}>
          {/* 告警计数 */}
          <Box sx={{
            display: "flex", alignItems: "center", gap: 0.5,
            px: 1, py: 0.2, borderRadius: 0.5,
            backgroundColor: `${color}15`,
          }}>
            <Typography sx={{ fontSize: smallFontSize, color: "rgba(255,255,255,0.35)", fontWeight: 400 }}>
              {currentIdx + 1}/{alarms.length}
            </Typography>
          </Box>

          {/* 相对时间 */}
          <Typography sx={{ fontSize: smallFontSize, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
            {relTime(current.timestamp)}
          </Typography>

          {/* 级别统计 */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
            {stats.critical > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, px: 0.6, py: 0.1, borderRadius: 0.3, backgroundColor: "rgba(239,68,68,0.15)" }}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#ef4444", boxShadow: "0 0 4px #ef4444" }} />
                <Typography sx={{ fontSize: smallFontSize, color: "#ef4444", fontWeight: 600, fontFeatures: '"tnum"' }}>{stats.critical}</Typography>
              </Box>
            )}
            {stats.warning > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, px: 0.6, py: 0.1, borderRadius: 0.3, backgroundColor: "rgba(245,158,11,0.12)" }}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#f59e0b" }} />
                <Typography sx={{ fontSize: smallFontSize, color: "#f59e0b", fontWeight: 600, fontFeatures: '"tnum"' }}>{stats.warning}</Typography>
              </Box>
            )}
            {stats.info > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, px: 0.6, py: 0.1, borderRadius: 0.3, backgroundColor: "rgba(59,130,246,0.1)" }}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#3b82f6" }} />
                <Typography sx={{ fontSize: smallFontSize, color: "#3b82f6", fontWeight: 600, fontFeatures: '"tnum"' }}>{stats.info}</Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── 分页指示条 ── */}
      {alarms.length > 1 && (
        <Box sx={{ display: "flex", gap: 0.3, ml: 1.5, flexShrink: 0, alignItems: "center" }}>
          {alarms.slice(0, 30).map((a, i) => (
            <Box
              key={i}
              sx={{
                width: i === currentIdx % 30 ? baseFontSize * 0.7 : baseFontSize * 0.25,
                height: baseFontSize * 0.25,
                borderRadius: baseFontSize * 0.13,
                backgroundColor: i === currentIdx % 30
                  ? `${levelColor(a.level)}cc`
                  : "rgba(255,255,255,0.1)",
                transition: "all 0.3s ease",
                boxShadow: i === currentIdx % 30 ? `0 0 4px ${levelColor(a.level)}66` : "none",
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
