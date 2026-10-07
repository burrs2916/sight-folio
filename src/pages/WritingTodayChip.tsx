// 底栏「今日进度可视化」徽章（批次④ T6）：把日更目标进度（当前字数 vs dailyGoal）嵌进写作主界面。
//
// 数据口径 = 日快照差分（今日累计 − 上一记录日累计），与写作统计弹窗同源
// （writingStatsApi.listDailyStats，快照由后端在每次正文保存时顺手 upsert）。
// 刷新时机：挂载 + flushSave 成功派发的 writing-saved 事件 + 60s 兜底轮询——
// 全部走本地事件/独立组件 state，不触发 WritingPage 顶层重渲染。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import { writingStatsApi, type WritingDailyStat } from '../services/tauri';
import { WRITING_SAVED_EVENT } from '../utils/writingSavedEvent';
import { localDay, goalProgress } from '../utils/writingStats';
import { t } from '../i18n';

export function WritingTodayChip({
  bookId,
  goal,
  onOpenStats,
}: {
  bookId: string | null;
  goal: number;
  onOpenStats: () => void;
}) {
  const [delta, setDelta] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!bookId) return;
    try {
      const rows: WritingDailyStat[] = await writingStatsApi.listDailyStats(bookId, 30);
      const today = localDay(new Date());
      const idx = rows.findIndex((r) => r.day === today);
      const todayTotal = idx >= 0 ? rows[idx].wordCount : 0;
      const prevTotal = idx > 0 ? rows[idx - 1].wordCount : 0;
      setDelta(todayTotal - prevTotal);
    } catch {
      setDelta(null);
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载首刷走宏任务：refresh 内 setDelta 全在 await 之后（非同步 setState），
    // 移出 effect 同步调用链以避免级联渲染（react-hooks/set-state-in-effect）
    const kick = setTimeout(() => void refresh(), 0);
    const onSaved = () => void refresh();
    window.addEventListener(WRITING_SAVED_EVENT, onSaved);
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      clearTimeout(kick);
      window.removeEventListener(WRITING_SAVED_EVENT, onSaved);
      clearInterval(timer);
    };
  }, [refresh]);

  if (!bookId || delta === null) return null;

  // 已设目标 → 进度条 + 百分比 + 差距；未设目标 → 仅今日新增
  const progress = goalProgress(delta, goal);
  if (progress) {
    const { pct, remain, hit } = progress;
    return (
      <Box
        onClick={onOpenStats}
        title={t('writing.statsOpenHint')}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          cursor: 'pointer',
          flexShrink: 0,
          '&:hover': { '& .sf-progress-label': { color: 'primary.main' } },
        }}
      >
        <Box sx={{ width: 96, display: 'flex', alignItems: 'center' }}>
          <LinearProgress
            variant="determinate"
            value={pct}
            color={hit ? 'success' : 'primary'}
            sx={{ height: 6, borderRadius: 3, flex: 1 }}
          />
        </Box>
        <Typography
          className="sf-progress-label"
          sx={{ fontSize: 11, color: hit ? 'success.main' : 'text.secondary', whiteSpace: 'nowrap' }}
        >
          {t('writing.goalProgress', { n: delta, goal, pct })}
        </Typography>
        {!hit && remain > 0 && (
          <Typography sx={{ fontSize: 11, color: 'text.disabled', whiteSpace: 'nowrap' }}>
            {t('writing.goalRemain', { n: remain })}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Typography
      onClick={onOpenStats}
      title={t('writing.statsOpenHint')}
      sx={{
        fontSize: 11,
        color: 'text.secondary',
        cursor: 'pointer',
        flexShrink: 0,
        '&:hover': { color: 'primary.main' },
      }}
    >
      {t('writing.todayWords', { n: delta })}
    </Typography>
  );
}
