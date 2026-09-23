// 底栏「今日新增」徽章（批次② 写作动线）：把日更激励放进写作主界面。
//
// 数据口径 = 日快照差分（今日累计 − 上一记录日累计），与写作统计弹窗同源
// （writingStatsApi.listDailyStats，快照由后端在每次正文保存时顺手 upsert）。
// 刷新时机：挂载 + flushSave 成功派发的 writing-saved 事件 + 60s 兜底轮询——
// 全部走本地事件/独立组件 state，不触发 WritingPage 顶层重渲染。
import { useCallback, useEffect, useState } from 'react';
import Typography from '@mui/material/Typography';
import { writingStatsApi, type WritingDailyStat } from '../services/tauri';
import { WRITING_SAVED_EVENT } from '../utils/writingSavedEvent';
import { t } from '../i18n';

/** 本机时区的 YYYY-MM-DD（与后端 record_daily_snapshot 的 local_today 同口径）。 */
function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
      const today = localDay();
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
  const hitGoal = goal > 0 && delta >= goal;
  return (
    <Typography
      onClick={onOpenStats}
      title={t('writing.statsOpenHint')}
      sx={{
        fontSize: 11,
        color: hitGoal ? 'success.main' : 'text.secondary',
        cursor: 'pointer',
        flexShrink: 0,
        '&:hover': { color: 'primary.main' },
      }}
    >
      {goal > 0 ? t('writing.todayWithGoal', { n: delta, goal }) : t('writing.todayWords', { n: delta })}
    </Typography>
  );
}
