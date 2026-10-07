import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import { writingStatsApi, type WritingDailyStat } from '../services/tauri';
import { diffDailyStats, WINDOW_DAYS } from '../utils/writingStats';
import type { WritingBookGoal } from '../services/writing';
import { t } from '../i18n';
import { logger } from '../utils/logger';

/**
 * 写作统计面板（P4，doc §4.6）+ 写作目标（T2）
 *
 * 数据口径：后端在每次存章时落「当日全书总字数」快照（end-of-day total），
 * 前端把快照差分出每日新增字数。缺记录的日期按「无写作」补零，
 * 并用前一天的快照做基线（缺快照 ≠ 字数归零，是没保存而已）。
 *
 * 多取 1 天（31 天）就是为了给窗口第 1 天一个差分基线，避免首日虚高。
 * 差分算法已下沉 utils/writingStats（与统计页签共用一份，禁止第二份）。
 *
 * 全书目标（T2）：目标总字数 / 目标章节数 / 截止日期存 WritingBook.extra
 * JSON 透传（parseBookGoal / store.setBookGoal），与日更目标并列展示，
 * 达成率进度条 + 剩余天数走本地派生，零新表零新命令。
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
  /** 全书目标（T2）：读自 WritingBook.extra */
  bookGoal: WritingBookGoal;
  onBookGoalChange: (goal: WritingBookGoal) => void;
}

/** Unix 秒 → 本地日期 input value（YYYY-MM-DD）；0 → 空串 */
function deadlineToInput(sec: number): string {
  if (!(sec > 0)) return '';
  const d = new Date(sec * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 本地日期（YYYY-MM-DD）→ Unix 秒（本地当日零点）；空串 → 0 */
function inputToDeadline(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return 0;
  const t = new Date(y, m - 1, d).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export default function WritingStatsDialog({
  open,
  onClose,
  bookId,
  bookTitle,
  chapterCount,
  chapterTotalWords,
  dailyGoal,
  onGoalChange,
  bookGoal,
  onBookGoalChange,
}: WritingStatsDialogProps) {
  const [stats, setStats] = useState<WritingDailyStat[] | null>(null);
  const [goalInput, setGoalInput] = useState('');
  // 全书目标编辑缓冲：三个字段分别编辑，blur/Enter 才提交（与日更目标同交互）
  const [goalWordsInput, setGoalWordsInput] = useState('');
  const [goalChaptersInput, setGoalChaptersInput] = useState('');
  const [goalDeadlineInput, setGoalDeadlineInput] = useState('');

  useEffect(() => {
    if (!open || !bookId) return;
    let cancelled = false;
    setStats(null);
    setGoalInput(dailyGoal > 0 ? String(dailyGoal) : '');
    setGoalWordsInput(bookGoal.targetWords > 0 ? String(bookGoal.targetWords) : '');
    setGoalChaptersInput(bookGoal.targetChapters > 0 ? String(bookGoal.targetChapters) : '');
    setGoalDeadlineInput(deadlineToInput(bookGoal.deadline));
    writingStatsApi
      .listDailyStats(bookId, WINDOW_DAYS + 1)
      .then((rows) => {
        if (!cancelled) setStats(rows);
      })
      .catch((e) => {
        logger.warn('WritingStatsDialog', 'load daily stats failed', { error: e });
        if (!cancelled) setStats([]);
      });
    return () => {
      cancelled = true;
    };
    // 打开时同步一次各目标输入框；后续由用户编辑驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookId]);

  const deltas = useMemo(() => (stats ? diffDailyStats(stats, new Date()) : []), [stats]);

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

  // ─── 全书目标（T2）：达成率本地派生，未设字段不显示进度 ───
  const wordGoalPct =
    bookGoal.targetWords > 0 ? Math.min(100, Math.round((totalWords / bookGoal.targetWords) * 100)) : 0;
  const chapterGoalPct =
    bookGoal.targetChapters > 0 ? Math.min(100, Math.round((chapterCount / bookGoal.targetChapters) * 100)) : 0;
  /** 剩余天数（截止日当天算剩余 0；过期返回负值；未设截止 null） */
  const daysLeft = useMemo(() => {
    if (!(bookGoal.deadline > 0)) return null;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    return Math.floor((bookGoal.deadline - todayStart) / 86400);
  }, [bookGoal.deadline]);
  const wordGoalHit = bookGoal.targetWords > 0 && totalWords >= bookGoal.targetWords;
  const chapterGoalHit = bookGoal.targetChapters > 0 && chapterCount >= bookGoal.targetChapters;

  const commitBookGoal = () => {
    const w = parseInt(goalWordsInput, 10);
    const c = parseInt(goalChaptersInput, 10);
    onBookGoalChange({
      targetWords: Number.isFinite(w) && w > 0 ? w : 0,
      targetChapters: Number.isFinite(c) && c > 0 ? c : 0,
      deadline: inputToDeadline(goalDeadlineInput),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>
        {t('writing.stats')}
        {bookTitle && (
          <Typography component="span" sx={{ fontSize: 12.5, color: 'text.secondary', ml: 1 }}>
            {bookTitle}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip size="small" label={`${t('writing.totalWords')} ${totalWords.toLocaleString()}`} />
          <Chip size="small" label={`${t('writing.chapterCount')} ${chapterCount}`} />
          <Chip size="small" label={`${t('writing.daysRecorded')} ${recordedDays}`} />
        </Box>

        {/* 日更目标（P6）：今日进度 + 可编辑目标 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {t('writing.todayProgress', { n: todayDelta.toLocaleString() })}
              </Typography>
              {dailyGoal > 0 && (
                <Typography
                  sx={{ fontSize: 12, fontWeight: 600, color: goalPct >= 100 ? 'success.main' : 'text.secondary' }}
                >
                  {goalPct}%{goalPct >= 100 ? ` · ${t('writing.goalReached')}` : ''}
                </Typography>
              )}
            </Box>
            {dailyGoal > 0 && (
              <LinearProgress
                variant="determinate"
                value={goalPct}
                color={goalPct >= 100 ? 'success' : 'primary'}
                sx={{ height: 6, borderRadius: 3 }}
              />
            )}
          </Box>
          <TextField
            size="small"
            type="number"
            label={t('writing.dailyGoal')}
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onBlur={commitGoal}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitGoal();
            }}
            slotProps={{
              input: {
                sx: { width: 110, fontSize: 12.5 },
                endAdornment: (
                  <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>{t('writing.goalUnit')}</Typography>
                ),
              },
            }}
            sx={{ flexShrink: 0 }}
          />
        </Box>

        {/* 全书目标（T2）：总字数/章节数/截止日期 + 达成率进度与剩余天数 */}
        <Box sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>
              {t('writing.bookGoal')}
            </Typography>
            {daysLeft !== null && (
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: daysLeft < 0 ? 'error.main' : daysLeft <= 7 ? 'warning.main' : 'success.main',
                }}
              >
                {daysLeft < 0
                  ? t('writing.goalDeadlineOver', { n: Math.abs(daysLeft) })
                  : t('writing.goalDaysLeft', { n: daysLeft })}
              </Typography>
            )}
          </Box>

          {/* 总字数目标 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
            <Box sx={{ flex: 1 }}>
              {bookGoal.targetWords > 0 ? (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {t('writing.bookWordProgress', {
                        words: totalWords.toLocaleString(),
                        target: bookGoal.targetWords.toLocaleString(),
                      })}
                    </Typography>
                    <Typography
                      sx={{ fontSize: 12, fontWeight: 600, color: wordGoalHit ? 'success.main' : 'text.secondary' }}
                    >
                      {wordGoalPct}%{wordGoalHit ? ` · ${t('writing.goalReached')}` : ''}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={wordGoalPct}
                    color={wordGoalHit ? 'success' : 'primary'}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </>
              ) : (
                <Typography sx={{ fontSize: 12, color: 'text.disabled', py: 1 }}>
                  {t('writing.bookGoalUnset')}
                </Typography>
              )}
            </Box>
            <TextField
              size="small"
              type="number"
              label={t('writing.bookTargetWords')}
              value={goalWordsInput}
              onChange={(e) => setGoalWordsInput(e.target.value)}
              onBlur={commitBookGoal}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitBookGoal();
              }}
              slotProps={{
                input: {
                  sx: { width: 96, fontSize: 12.5 },
                  endAdornment: (
                    <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>{t('writing.goalWordUnit')}</Typography>
                  ),
                },
              }}
              sx={{ flexShrink: 0 }}
            />
          </Box>

          {/* 目标章节数 + 截止日期 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
            <Box sx={{ flex: 1 }}>
              {bookGoal.targetChapters > 0 ? (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {t('writing.bookChapterProgress', {
                        chapters: chapterCount,
                        target: bookGoal.targetChapters,
                      })}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: chapterGoalHit ? 'success.main' : 'text.secondary',
                      }}
                    >
                      {chapterGoalPct}%{chapterGoalHit ? ` · ${t('writing.goalReached')}` : ''}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={chapterGoalPct}
                    color={chapterGoalHit ? 'success' : 'primary'}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </>
              ) : (
                <Typography sx={{ fontSize: 12, color: 'text.disabled', py: 1 }}>
                  {t('writing.bookChapterUnset')}
                </Typography>
              )}
            </Box>
            <TextField
              size="small"
              type="number"
              label={t('writing.bookTargetChapters')}
              value={goalChaptersInput}
              onChange={(e) => setGoalChaptersInput(e.target.value)}
              onBlur={commitBookGoal}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitBookGoal();
              }}
              slotProps={{ input: { sx: { width: 82, fontSize: 12.5 } } }}
              sx={{ flexShrink: 0 }}
            />
            <TextField
              size="small"
              type="date"
              label={t('writing.bookDeadline')}
              value={goalDeadlineInput}
              onChange={(e) => setGoalDeadlineInput(e.target.value)}
              onBlur={commitBookGoal}
              slotProps={{
                input: { sx: { width: 132, fontSize: 12.5 } },
                inputLabel: { shrink: true },
              }}
              sx={{ flexShrink: 0 }}
            />
          </Box>
        </Box>

        {stats === null ? null : !chartAvailable ? (
          <Typography sx={{ fontSize: 12.5, color: 'text.disabled', textAlign: 'center', py: 4 }}>
            {t('writing.noStats')}
          </Typography>
        ) : (
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 1 }}>
              {t('writing.dailyTrend')} · {totalDelta.toLocaleString()}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '3px',
                height: 120,
                px: 0.5,
                pb: 0.5,
                borderBottom: 1,
                borderColor: 'divider',
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
                    bgcolor: d.delta > 0 ? 'primary.main' : 'transparent',
                    borderRadius: '2px 2px 0 0',
                    minHeight: d.delta > 0 ? 4 : 0,
                  }}
                />
              ))}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>{deltas[0]?.day}</Typography>
              <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>{deltas[deltas.length - 1]?.day}</Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('nav.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
