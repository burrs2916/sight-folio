import { useEffect, useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import { writingStatsApi, type WritingDailyStat } from "../services/tauri";
import { diffDailyStats, WINDOW_DAYS, type DailyDelta } from "../utils/writingStats";
import { t } from "../i18n";
import { logger } from "../utils/logger";

/**
 * 写作统计面板（P4，doc §4.6）
 *
 * 数据口径：后端在每次存章时落「当日全书总字数」快照（end-of-day total），
 * 前端把快照差分出每日新增字数。缺记录的日期按「无写作」补零，
 * 并用前一天的快照做基线（缺快照 ≠ 字数归零，是没保存而已）。
 *
 * 多取 1 天（31 天）就是为了给窗口第 1 天一个差分基线，避免首日虚高。
 * 差分算法已下沉 utils/writingStats（与统计页签共用一份，禁止第二份）。
 */

interface WritingStatsDialogProps {
  open: boolean;
  onClose: () => void;
  bookId: string | null;
  bookTitle: string;
  chapterCount: number;
  /** 各章字数之和（实时口径；有快照记录时优先用快照） */
  chapterTotalWords: number;
  /** 日更目标（字数/天，0 = 未设）。P6 写作目标。 */
  dailyGoal: number;
  onGoalChange: (goal: number) => void;
}

export default function WritingStatsDialog({ open, onClose, bookId, bookTitle, chapterCount, chapterTotalWords, dailyGoal, onGoalChange }: WritingStatsDialogProps) {
  const [stats, setStats] = useState<WritingDailyStat[] | null>(null);
  const [goalInput, setGoalInput] = useState("");

  useEffect(() => {
    if (!open || !bookId) return;
    let cancelled = false;
    setStats(null);
    setGoalInput(dailyGoal > 0 ? String(dailyGoal) : "");
    writingStatsApi
      .listDailyStats(bookId, WINDOW_DAYS + 1)
      .then((rows) => { if (!cancelled) setStats(rows); })
      .catch((e) => {
        logger.warn("WritingStatsDialog", "load daily stats failed", { error: e });
        if (!cancelled) setStats([]);
      });
    return () => { cancelled = true; };
    // 打开时同步一次目标输入框；后续由用户编辑驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookId]);

  const deltas = useMemo(
    () => (stats ? diffDailyStats(stats, new Date()) : []),
    [stats],
  );

  // 有快照记录时用最近一条快照的总字数（比章节实时和更贴近落库口径）；否则退回章节和
  const totalWords = useMemo(() => {
    if (stats && stats.length > 0) {
      const latest = stats[stats.length - 1];
      if (latest && latest.wordCount > 0) return latest.wordCount;
    }
    return chapterTotalWords;
  }, [stats, chapterTotalWords]);

  const recordedDays = stats?.filter((s) => s.wordCount >= 0).length ?? 0;
  const maxDelta = Math.max(1, ...deltas.map((d) => d.delta));
  const totalDelta = deltas.reduce((sum, d) => sum + d.delta, 0);

  const chartAvailable = deltas.some((d) => d.delta > 0);

  // 今日新增 = 差分序列最后一位（窗口从今天往回排，末位即今天）
  const todayDelta = deltas.length > 0 ? deltas[deltas.length - 1].delta : 0;
  const goalPct = dailyGoal > 0 ? Math.min(100, Math.round((todayDelta / dailyGoal) * 100)) : 0;

  const commitGoal = () => {
    const n = parseInt(goalInput, 10);
    onGoalChange(Number.isFinite(n) && n > 0 ? n : 0);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>
        {t("writing.stats")}
        {bookTitle && (
          <Typography component="span" sx={{ fontSize: 12.5, color: "text.secondary", ml: 1 }}>
            {bookTitle}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
          <Chip size="small" label={`${t("writing.totalWords")} ${totalWords.toLocaleString()}`} />
          <Chip size="small" label={`${t("writing.chapterCount")} ${chapterCount}`} />
          <Chip size="small" label={`${t("writing.daysRecorded")} ${recordedDays}`} />
        </Box>

        {/* 日更目标（P6）：今日进度 + 可编辑目标 */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                {t("writing.todayProgress", { n: todayDelta.toLocaleString() })}
              </Typography>
              {dailyGoal > 0 && (
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: goalPct >= 100 ? "success.main" : "text.secondary" }}>
                  {goalPct}%{goalPct >= 100 ? ` · ${t("writing.goalReached")}` : ""}
                </Typography>
              )}
            </Box>
            {dailyGoal > 0 && (
              <LinearProgress
                variant="determinate"
                value={goalPct}
                color={goalPct >= 100 ? "success" : "primary"}
                sx={{ height: 6, borderRadius: 3 }}
              />
            )}
          </Box>
          <TextField
            size="small"
            type="number"
            label={t("writing.dailyGoal")}
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onBlur={commitGoal}
            onKeyDown={(e) => { if (e.key === "Enter") commitGoal(); }}
            slotProps={{ input: { sx: { width: 110, fontSize: 12.5 }, endAdornment: <Typography sx={{ fontSize: 10, color: "text.disabled" }}>{t("writing.goalUnit")}</Typography> } }}
            sx={{ flexShrink: 0 }}
          />
        </Box>

        {stats === null ? null : !chartAvailable ? (
          <Typography sx={{ fontSize: 12.5, color: "text.disabled", textAlign: "center", py: 4 }}>
            {t("writing.noStats")}
          </Typography>
        ) : (
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary", mb: 1 }}>
              {t("writing.dailyTrend")} · {totalDelta.toLocaleString()}
            </Typography>
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-end",
                gap: "3px",
                height: 120,
                px: 0.5,
                pb: 0.5,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              {deltas.map((d) => (
                <Box
                  key={d.day}
                  title={`${d.day} · +${d.delta.toLocaleString()}`}
                  sx={{
                    flex: 1,
                    minWidth: 2,
                    height: `${Math.max(d.delta > 0 ? 4 : 0, (d.delta / maxDelta) * 100)}%`,
                    bgcolor: d.delta > 0 ? "primary.main" : "transparent",
                    borderRadius: "2px 2px 0 0",
                    minHeight: d.delta > 0 ? 4 : 0,
                  }}
                />
              ))}
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
              <Typography sx={{ fontSize: 10, color: "text.disabled" }}>{deltas[0]?.day}</Typography>
              <Typography sx={{ fontSize: 10, color: "text.disabled" }}>
                {deltas[deltas.length - 1]?.day}
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t("nav.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
