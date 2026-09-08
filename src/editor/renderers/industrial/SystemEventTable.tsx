/**
 * SystemEventTable - 系统事件分页表格
 *
 * 列：时间、事件类型、级别、模块、消息、详情
 * - 级别列用颜色区分（info=蓝色, warn=橙色, error=红色）
 * - 分页控件
 * - 挂载时自动查询一次，分页变化时重新查询
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TablePagination from "@mui/material/TablePagination";
import { useEffect } from "react";
import type { ComponentRendererProps } from "../../../types/editor";
import { useLogQueryStore } from "../../../store/logQueryStore";
import { formatTimestamp, type SystemEvent } from "../../../services/historyApi";

/** 级别颜色映射 */
function getLevelColor(level?: string): "info" | "warning" | "error" | "default" {
  const l = String(level ?? "").toLowerCase();
  if (l === "info") return "info";
  if (l === "warn" || l === "warning") return "warning";
  if (l === "error") return "error";
  return "default";
}

function getLevelLabel(level?: string): string {
  const l = String(level ?? "").toLowerCase();
  if (l === "info") return "信息";
  if (l === "warn" || l === "warning") return "警告";
  if (l === "error") return "错误";
  return level || "-";
}

/** 格式化详情（支持对象/数组） */
function formatDetails(val: unknown): string {
  if (val === undefined || val === null) return "-";
  if (typeof val === "string") return val;
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export default function SystemEventTable(props?: ComponentRendererProps) {
  const config = props?.config ?? {};
  const title = (config.title as string) ?? "系统事件";
  const autoQuery = (config.autoQuery as boolean) ?? true;
  const defaultPageSize = (config.pageSize as number) ?? 20;

  const systemEvents = useLogQueryStore((s) => s.systemEvents);
  const loading = useLogQueryStore((s) => s.loading);
  const currentPage = useLogQueryStore((s) => s.currentPage);
  const pageSize = useLogQueryStore((s) => s.pageSize);
  const error = useLogQueryStore((s) => s.error);
  const querySystemEvents = useLogQueryStore((s) => s.querySystemEvents);
  const setCurrentPage = useLogQueryStore((s) => s.setCurrentPage);
  const setPageSize = useLogQueryStore((s) => s.setPageSize);

  useEffect(() => {
    if (defaultPageSize !== pageSize) {
      setPageSize(defaultPageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoQuery) {
      void querySystemEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize]);

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
          共 {systemEvents.total} 条
        </Typography>
      </Box>

      {/* 表格 */}
      <TableContainer sx={{ flex: 1, overflow: "auto" }}>
        {loading && systemEvents.data.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", minHeight: 120 }}>
            <CircularProgress size={24} sx={{ color: "rgba(90,158,214,0.7)" }} />
          </Box>
        ) : error ? (
          <Box sx={{ p: 2, textAlign: "center" }}>
            <Typography sx={{ fontSize: 12, color: "#ef4444" }}>{error}</Typography>
          </Box>
        ) : systemEvents.data.length === 0 ? (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography sx={{ fontSize: 12, color: "rgba(176,190,197,0.4)" }}>暂无系统事件</Typography>
          </Box>
        ) : (
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={headerCellSx}>时间</TableCell>
                <TableCell sx={headerCellSx}>事件类型</TableCell>
                <TableCell sx={headerCellSx}>级别</TableCell>
                <TableCell sx={headerCellSx}>模块</TableCell>
                <TableCell sx={headerCellSx}>消息</TableCell>
                <TableCell sx={headerCellSx}>详情</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {systemEvents.data.map((row: SystemEvent, idx) => {
                const key = row.id ?? idx;
                const detailStr = formatDetails(row.details);
                return (
                  <TableRow key={key} hover sx={{ "&:hover": { bgcolor: "rgba(90,158,214,0.06)" } }}>
                    <TableCell sx={bodyCellSx}>{formatTimestamp(row.timestamp)}</TableCell>
                    <TableCell sx={bodyCellSx}>{row.event_type || "-"}</TableCell>
                    <TableCell sx={bodyCellSx}>
                      <Chip
                        label={getLevelLabel(row.level)}
                        size="small"
                        color={getLevelColor(row.level)}
                        sx={{ height: 18, fontSize: 10, minWidth: 40 }}
                      />
                    </TableCell>
                    <TableCell sx={{ ...bodyCellSx, fontFamily: "monospace" }}>{row.module || "-"}</TableCell>
                    <TableCell sx={{ ...bodyCellSx, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={row.message || ""}>
                      {row.message || "-"}
                    </TableCell>
                    <TableCell sx={{ ...bodyCellSx, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis" }} title={detailStr}>
                      {detailStr}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* 分页 */}
      <TablePagination
        component="div"
        count={systemEvents.total}
        page={currentPage}
        onPageChange={(_, page) => setCurrentPage(page)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => setPageSize(parseInt(e.target.value, 10))}
        rowsPerPageOptions={[10, 20, 50, 100]}
        labelRowsPerPage="每页"
        labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
        sx={paginationSx}
      />
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 样式常量
// ═══════════════════════════════════════════════════════════════════

const headerCellSx = {
  bgcolor: "rgba(40,58,82,0.9)",
  color: "#B0BEC5",
  fontSize: 11,
  fontWeight: 600,
  borderBottom: "1px solid rgba(120,144,156,0.3)",
  py: 0.6,
  px: 1,
  whiteSpace: "nowrap",
} as const;

const bodyCellSx = {
  color: "#e0e8f0",
  fontSize: 11,
  borderBottom: "1px solid rgba(120,144,156,0.12)",
  py: 0.5,
  px: 1,
  whiteSpace: "nowrap",
} as const;

const paginationSx = {
  color: "rgba(176,190,197,0.7)",
  fontSize: 11,
  borderTop: "1px solid rgba(120,144,156,0.3)",
  flexShrink: 0,
  "& .MuiTablePagination-select": { fontSize: 11, color: "rgba(176,190,197,0.7)" },
  "& .MuiTablePagination-selectIcon": { color: "rgba(176,190,197,0.5)" },
  "& .MuiTablePagination-actions button": { color: "rgba(176,190,197,0.7)" },
} as const;
