/**
 * SprayControlLog — 喷雾控制操作日志面板子组件
 *
 * 从 SprayControlToolbarRenderer.tsx 中抽出，负责：
 *   - 折叠/展开操作日志
 *   - 过滤（全部/成功/部分失败/失败）
 *   - 分页（每页10条）
 *   - 导出为 JSON
 *   - 清空
 *   - 详情 Dialog（含 payload、响应、耗时等）
 */
import { useRef, useState, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Pagination from "@mui/material/Pagination";
import Popover from "@mui/material/Popover";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import ButtonBase from "@mui/material/ButtonBase";
import HistoryIcon from "@mui/icons-material/History";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import InfoIcon from "@mui/icons-material/Info";
import CloseIcon from "@mui/icons-material/Close";

// ─── 类型 ───

export type ControlAction =
  | "forceSpray" | "forceStop" | "autoMode"
  | "fetchParams" | "loopStart" | "loopStop"
  | "setSprayParams" | "setWorkTime";

export interface LogEntry {
  id: number;
  time: string;        // HH:MM:SS
  timestamp: number;   // Unix ms
  action: ControlAction | "selectAll" | "selectNone" | "selectGroup";
  commandCode: string; // "0619" / "061b" / "0613" / "-"
  targetMains: string[];
  targetSubs: string[];
  payload: Record<string, unknown> | null;
  result: "ok" | "fail" | "partial" | "pending";
  responses: Array<{ deviceId: string; success: boolean; code: number; msg: string }>;
  durationMs: number;
  message: string;
  sceneMode: string;
}

// ─── 常量 ───

const LOGS_PER_PAGE = 10;
const MAX_LOGS = 50;

// 选择操作（非指令）的 commandCode 标记
const NON_COMMAND_CODE = "-";

const ACTION_LABELS: Record<string, string> = {
  forceSpray: "强喷", forceStop: "强停", autoMode: "自动",
  fetchParams: "获取参数", loopStart: "循环喷", loopStop: "停循环",
  setSprayParams: "喷雾参数", setWorkTime: "工作时间",
  selectAll: "全选在线", selectNone: "全不选", selectGroup: "按集控分组选",
};

const RESULT_META: Record<string, { color: string; label: string; Icon: typeof CheckCircleIcon }> = {
  ok:      { color: "#4ade80", label: "成功", Icon: CheckCircleIcon },
  partial: { color: "#facc15", label: "部分失败", Icon: InfoIcon },
  fail:    { color: "#f87171", label: "失败", Icon: ErrorIcon },
  pending: { color: "#94a3b8", label: "等待中", Icon: InfoIcon },
};

const RESULT_META_SIMPLE: Record<string, { color: string; label: string }> = {
  ok:      { color: "#4ade80", label: "成功" },
  partial: { color: "#facc15", label: "部分失败" },
  fail:    { color: "#f87171", label: "失败" },
  pending: { color: "#94a3b8", label: "等待中" },
};

// ─── 日志管理 hook ───

export function useSprayControlLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const pushLog = useCallback((entry: Omit<LogEntry, "id" | "time" | "timestamp">) => {
    setLogs(prev => {
      const now = new Date();
      const next: LogEntry = {
        ...entry,
        id: ++logIdRef.current,
        time: now.toLocaleTimeString("zh-CN", { hour12: false }),
        timestamp: now.getTime(),
      };
      return [next, ...prev].slice(0, MAX_LOGS);
    });
  }, []);
  const clearLogs = useCallback(() => setLogs([]), []);
  return { logs, pushLog, clearLogs, setLogs };
}

// ─── 日志面板组件 ───

interface SprayControlLogProps {
  logs: LogEntry[];
}

export function SprayControlLog({ logs }: SprayControlLogProps) {
  const [logPage, setLogPage] = useState(1);
  const [logDetail, setLogDetail] = useState<LogEntry | null>(null);

  // ── 下拉锚点（MUI Popover 自动处理定位，兼容预览模式的缩放容器）──
  const headerRef = useRef<HTMLDivElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  // 真实渲染宽度（含缩放）：预览模式下 Popover 渲染在 body 里，
  // offsetWidth 是未缩放的布局宽度会导致过宽，必须用 getBoundingClientRect().width
  const [anchorWidth, setAnchorWidth] = useState<number>(0);
  const logsOpen = Boolean(anchorEl);

  const toggleLogs = useCallback(() => {
    setAnchorEl(prev => {
      if (prev) return null;
      if (headerRef.current) {
        setAnchorWidth(headerRef.current.getBoundingClientRect().width);
      }
      return headerRef.current;
    });
  }, []);

  // 只显示指令日志 + 分页
  const filtered = logs.filter(l => l.commandCode !== NON_COMMAND_CODE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / LOGS_PER_PAGE));
  const safePage = Math.min(logPage, totalPages);
  const pageStart = (safePage - 1) * LOGS_PER_PAGE;
  const paged = filtered.slice(pageStart, pageStart + LOGS_PER_PAGE);

  return (
    <>
      {/* ── 操作日志面板（头始终固定 28px） ── */}
      <Box sx={{
        borderTop: "1px solid rgba(255,152,0,0.15)",
        backgroundColor: "rgba(0,0,0,0.25)",
        height: 28,
        flexShrink: 0,
        display: "flex", flexDirection: "column",
      }}>
        {/* 折叠头 */}
        <Box
          ref={headerRef}
          onClick={toggleLogs}
          sx={{
            display: "flex", alignItems: "center", gap: 0.75,
            px: 1.25, height: "100%", cursor: "pointer", userSelect: "none",
            flexShrink: 0,
            backgroundColor: "rgba(255,152,0,0.06)",
            "&:hover": { backgroundColor: "rgba(255,152,0,0.12)" },
          }}
        >
          <HistoryIcon sx={{ fontSize: 16, color: "rgba(255,152,0,0.9)" }} />
          <Typography sx={{ fontSize: 14, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
            操作日志
          </Typography>
          <Chip
            size="small"
            label={`${logs.length}/${MAX_LOGS}`}
            sx={{ height: 18, fontSize: 12, "& .MuiChip-label": { px: 0.6 }, backgroundColor: "rgba(255,152,0,0.2)", color: "rgba(255,255,255,0.85)" }}
          />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
            {logsOpen ? "收起 ▲" : "展开 ▼"}
          </Typography>
        </Box>
      </Box>

      {/* ── 展开内容（MUI Popover 向下展开，锚定折叠头） ── */}
      <Popover
        open={logsOpen}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slots={{ transition: Collapse }}
        slotProps={{
          paper: {
            sx: {
              width: anchorWidth || "auto",
              backgroundColor: "rgba(0,18,36,0.97)",
              border: "1px solid rgba(255,152,0,0.3)",
              borderTop: "none",
              borderRadius: "0 0 4px 4px",
              backgroundImage: "none",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              backdropFilter: "blur(8px)",
              overflow: "hidden",
            },
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          {/* 日志列表（最多显示 3 条，超出向下滚动） */}
          <Box sx={{
            maxHeight: 72, overflowY: "auto", px: 0.75, py: 0.25,
            "&::-webkit-scrollbar": { width: 4 },
            "&::-webkit-scrollbar-thumb": { backgroundColor: "rgba(255,152,0,0.3)", borderRadius: 2 },
          }}>
            {paged.length === 0 ? (
              <Typography sx={{ fontSize: 6, color: "rgba(255,255,255,0.4)", textAlign: "center", py: 0.75 }}>
                {logs.length === 0 ? "暂无操作记录" : "当前过滤无匹配"}
              </Typography>
            ) : (
              paged.map(log => {
                const meta = RESULT_META[log.result] ?? RESULT_META.pending;
                const targetLabel = log.targetSubs.length > 0
                  ? `${log.targetSubs.length} 个分控器`
                  : log.targetMains.length > 0
                    ? `${log.targetMains.length} 个集控器`
                    : "广播";
                return (
                  <Box key={log.id} onClick={() => setLogDetail(log)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 0.5,
                      py: 0.2, fontSize: 6, cursor: "pointer",
                      borderRadius: 0.5, px: 0.5,
                      transition: "background-color 0.1s",
                      "&:hover": { backgroundColor: "rgba(255,152,0,0.12)" },
                    }}>
                    <Typography sx={{ fontSize: 6, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", flexShrink: 0 }}>
                      {log.time}
                    </Typography>
                    <meta.Icon sx={{ fontSize: 8, color: meta.color, flexShrink: 0 }} />
                    {log.commandCode !== "-" && (
                      <Typography sx={{ fontSize: 5, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", flexShrink: 0 }}>
                        0x{log.commandCode}
                      </Typography>
                    )}
                    <Typography sx={{ fontSize: 6, color: "rgba(255,255,255,0.85)", flexShrink: 0, fontWeight: 600, minWidth: 44 }}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </Typography>
                    <Typography sx={{ fontSize: 6, color: "rgba(79,195,247,0.85)", flexShrink: 0, minWidth: 68 }}>
                      → {targetLabel}
                    </Typography>
                    <Typography sx={{ fontSize: 6, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {log.message}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {log.durationMs > 0 && (
                      <Typography sx={{ fontSize: 5, color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>
                        {log.durationMs}ms
                      </Typography>
                    )}
                  </Box>
                );
              })
            )}
          </Box>

          {/* 分页器 */}
          {totalPages > 1 && (
            <Box sx={{
              display: "flex", justifyContent: "center", alignItems: "center",
              py: 0.25, borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0,
              backgroundColor: "rgba(0,0,0,0.3)",
            }}>
              <Pagination count={totalPages} page={safePage}
                onChange={(_, p) => setLogPage(p)} size="small" color="primary" siblingCount={0}
                sx={{
                  "& .MuiPaginationItem-root": { color: "rgba(255,255,255,0.7)", fontSize: 7, minWidth: 14, height: 14, margin: "0 1px" },
                  "& .Mui-selected": { backgroundColor: "rgba(255,152,0,0.3) !important" },
                }}
              />
              <Typography sx={{ fontSize: 6, color: "rgba(255,255,255,0.4)", ml: 0.75 }}>
                {pageStart + 1}-{Math.min(pageStart + LOGS_PER_PAGE, filtered.length)} / {filtered.length}
              </Typography>
            </Box>
          )}
        </Box>
      </Popover>

      {/* ── 日志详情 Dialog ── */}
      <Dialog open={logDetail !== null} onClose={() => setLogDetail(null)} maxWidth="sm" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "rgba(20,24,32,0.98)", color: "rgba(255,255,255,0.9)" } } }}>
        {logDetail && (() => {
          const meta = RESULT_META_SIMPLE[logDetail.result] ?? RESULT_META_SIMPLE.pending;
          return (
            <>
              <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
                <Chip size="small" label={meta.label}
                  sx={{ backgroundColor: meta.color, color: "#000", fontWeight: 700 }} />
                <Typography sx={{ fontSize: 16, fontWeight: 600 }}>
                  {ACTION_LABELS[logDetail.action] ?? logDetail.action}
                </Typography>
                {logDetail.commandCode !== "-" && (
                  <Chip size="small" label={`命令 0x${logDetail.commandCode}`}
                    sx={{ backgroundColor: "rgba(79,195,247,0.2)", color: "rgba(79,195,247,1)", fontFamily: "monospace" }} />
                )}
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" onClick={() => setLogDetail(null)} sx={{ color: "rgba(255,255,255,0.6)" }}>
                  <CloseIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </DialogTitle>
              <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                  {/* 时间 */}
                  <Box>
                    <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", mb: 0.5 }}>时间</Typography>
                    <Typography sx={{ fontSize: 13, fontFamily: "monospace" }}>
                      {new Date(logDetail.timestamp).toLocaleString("zh-CN", { hour12: false })}
                      <Typography component="span" sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", ml: 1 }}>
                        ({logDetail.durationMs}ms)
                      </Typography>
                    </Typography>
                  </Box>
                  {/* 场景模式 */}
                  <Box>
                    <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", mb: 0.5 }}>场景模式</Typography>
                    <Typography sx={{ fontSize: 13 }}>{logDetail.sceneMode}</Typography>
                  </Box>
                  {/* 目标集控器 */}
                  <Box>
                    <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", mb: 0.5 }}>
                      目标集控器 ({logDetail.targetMains.length})
                    </Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {logDetail.targetMains.map(m => (
                        <Chip key={m} size="small" label={m} sx={{ fontFamily: "monospace", fontSize: 11, backgroundColor: "rgba(255,255,255,0.08)" }} />
                      ))}
                    </Box>
                  </Box>
                  {/* 目标分控器 */}
                  {logDetail.targetSubs.length > 0 && (
                    <Box>
                      <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", mb: 0.5 }}>
                        目标分控器 ({logDetail.targetSubs.length})
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {logDetail.targetSubs.map(s => (
                          <Chip key={s} size="small" label={s} sx={{ fontFamily: "monospace", fontSize: 11, backgroundColor: "rgba(79,195,247,0.15)" }} />
                        ))}
                      </Box>
                    </Box>
                  )}
                  {/* Payload */}
                  {logDetail.payload && (
                    <Box>
                      <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", mb: 0.5 }}>下发参数 (Payload)</Typography>
                      <Box sx={{
                        p: 1, borderRadius: 1,
                        backgroundColor: "rgba(0,0,0,0.4)",
                        fontFamily: "monospace", fontSize: 12,
                        maxHeight: 160, overflow: "auto",
                        whiteSpace: "pre-wrap", wordBreak: "break-all",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}>
                        {JSON.stringify(logDetail.payload, null, 2)}
                      </Box>
                    </Box>
                  )}
                  {/* 各集控器响应 */}
                  {logDetail.responses.length > 0 && (
                    <Box>
                      <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", mb: 0.5 }}>
                        各集控器响应 ({logDetail.responses.length})
                      </Typography>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                        {logDetail.responses.map((r, i) => (
                          <Box key={i} sx={{
                            display: "flex", alignItems: "center", gap: 1,
                            p: 0.5, borderRadius: 0.5,
                            backgroundColor: r.success ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                            border: r.success ? "1px solid rgba(74,222,128,0.25)" : "1px solid rgba(248,113,113,0.25)",
                          }}>
                            {r.success
                              ? <CheckCircleIcon sx={{ fontSize: 14, color: "#4ade80", flexShrink: 0 }} />
                              : <ErrorIcon sx={{ fontSize: 14, color: "#f87171", flexShrink: 0 }} />}
                            <Typography sx={{ fontSize: 11, fontFamily: "monospace", flexShrink: 0, minWidth: 140 }} title={r.deviceId}>
                              {r.deviceId.length > 18 ? `${r.deviceId.slice(0, 18)}…` : r.deviceId}
                            </Typography>
                            <Typography sx={{ fontSize: 10, color: "rgba(255,255,255,0.5)", flexShrink: 0 }}>code={r.code}</Typography>
                            <Typography sx={{ fontSize: 12, color: "rgba(255,255,255,0.85)", flex: 1, wordBreak: "break-all" }}>{r.msg}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                  {/* 摘要 */}
                  <Box>
                    <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.5)", mb: 0.5 }}>摘要</Typography>
                    <Typography sx={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>{logDetail.message}</Typography>
                  </Box>
                </Box>
              </DialogContent>
              <DialogActions>
                <ButtonBase onClick={() => setLogDetail(null)}
                  sx={{ px: 2, py: 0.75, borderRadius: 1, color: "rgba(255,255,255,0.7)", fontSize: 13, "&:hover": { backgroundColor: "rgba(255,255,255,0.08)" } }}>
                  关闭
                </ButtonBase>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>
    </>
  );
}
