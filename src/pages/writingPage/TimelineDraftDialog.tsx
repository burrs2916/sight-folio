// 「待补全草稿事件」补全工作台。
//
// 体检报告里 `tl:drafts` 是一条汇总行（「待补全草稿 N 条」）。汇总本身是对的——草稿
// 可能几十条，逐条铺开会把报告刷爆、把真正要命的 block 级发现挤下去。但汇总行此前
// 只能跳到时间线页签，作者还得自己在几十个事件里挑出哪几条缺字段：发现给了，活没给。
//
// 这里补的就是那一截：一屏只列缺字段的事件，两个字段都补齐才算完（口径 = isComplete，
// 不自己另判）。补完后 store 一变，这条汇总行自己从报告里消失。
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useI18n } from '../../i18n';
import { useWritingStore } from '../../store/writingStore';
import { isComplete } from '../../utils/writingTimeline';
import { logger } from '../../utils/logger';

export interface TimelineDraftDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 一行的本地草稿。不直接写库：逐键提交会每敲一个字发一次 IPC。 */
type RowEdit = { at: string; event: string };

export function TimelineDraftDialog({ open, onClose }: TimelineDraftDialogProps) {
  const { t } = useI18n();
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const updateTimelineEvent = useWritingStore((s) => s.updateTimelineEvent);

  // 从 store 派生：保存成功后这里自然少一条，不需要自己维护"已处理"集合
  const drafts = useMemo(() => timelineEvents.filter((e) => !isComplete(e)), [timelineEvents]);

  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  /** 逐行的失败原因。不许静默：哪一行没存上必须在那一行上看得见 */
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const editOf = (id: string, at: string, event: string): RowEdit =>
    edits[id] ?? { at: at ?? '', event: event ?? '' };

  const ready = (v: RowEdit) => v.at.trim() !== '' && v.event.trim() !== '';

  const saveOne = async (id: string) => {
    const row = drafts.find((e) => e.id === id);
    if (!row) return;
    const v = editOf(id, row.at ?? '', row.event ?? '');
    if (!ready(v)) return; // 双保险：按钮已禁用，别绕过它写进半个事件
    setSavingId(id);
    try {
      await updateTimelineEvent(id, { at: v.at.trim(), event: v.event.trim() });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setErrors((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('TimelineDraftDialog', '补全草稿事件失败', { id, error: msg });
      setErrors((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle
        sx={{
          fontSize: 15,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {t('writing.timelineDraftWorkbenchTitle')}
        <IconButton size="small" onClick={onClose} aria-label={t('ui.close')}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 460 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('writing.timelineDraftWorkbenchHint')}
        </Typography>

        {drafts.length === 0 ? (
          // 全部补完时不能留个空框：这一行也是"报告里那条发现会自己消失"的可见确认
          <Typography variant="body2" sx={{ color: 'success.main' }}>
            {t('writing.timelineDraftWorkbenchEmpty')}
          </Typography>
        ) : (
          drafts.map((e) => {
            const v = editOf(e.id, e.at ?? '', e.event ?? '');
            const missingAt = (e.at ?? '').trim() === '';
            const missingEvent = (e.event ?? '').trim() === '';
            return (
              <Box
                key={e.id}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1,
                  p: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              >
                {/* 说明列：平时讲"缺哪个字段"（两个都说等于没说）；这一行存失败时
                    就地换成失败原因。错误绝不能堆到列表底部——作者分不清是哪条没存上 */}
                <Typography
                  variant="caption"
                  sx={{
                    color: errors[e.id] ? 'error.main' : 'text.secondary',
                    width: 108,
                    flexShrink: 0,
                    pt: 1.2,
                  }}
                >
                  {errors[e.id]
                    ? t('writing.timelineDraftSaveFailed', { msg: errors[e.id] })
                    : missingAt && missingEvent
                      ? t('writing.timelineDraftBoth')
                      : missingAt
                        ? t('writing.timelineDraftMissingAt')
                        : t('writing.timelineDraftMissingEvent')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flex: 1, minWidth: 0 }}>
                  <TextField
                    size="small"
                    sx={{ width: 150, flexShrink: 0 }}
                    label={t('writing.timelineAt')}
                    value={v.at}
                    onChange={(ev) => setEdits((prev) => ({ ...prev, [e.id]: { ...v, at: ev.target.value } }))}
                  />
                  <TextField
                    size="small"
                    sx={{ flex: 1, minWidth: 0 }}
                    label={t('writing.timelineEvent')}
                    placeholder={t('writing.timelineEventHint')}
                    value={v.event}
                    onChange={(ev) =>
                      setEdits((prev) => ({ ...prev, [e.id]: { ...v, event: ev.target.value } }))
                    }
                  />
                </Box>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!ready(v) || savingId === e.id}
                  onClick={() => void saveOne(e.id)}
                  sx={{ flexShrink: 0 }}
                >
                  {t('ui.save')}
                </Button>
              </Box>
             );
           })
         )}
      </DialogContent>
      <DialogActions>
        {/* 底部只报"还剩几条"：这一数与报告里那条汇总同源（都来自 isComplete），
            补到 0 条时报告里那行也会一起消失 */}
        <Typography variant="caption" sx={{ mr: 'auto', color: 'text.secondary' }}>
          {t('writing.timelineDraftRemaining', { n: drafts.length })}
        </Typography>
        <Button size="small" onClick={onClose}>
          {t('ui.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

