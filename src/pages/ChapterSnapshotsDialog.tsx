// 章节版本快照对话框（批次④）：列表 + 恢复 + 手动快照。
//
// 快照来源：切章时内容有改动自动存一份（origin=auto，见 WritingPage 切章 effect）+
// 本对话框「保存当前快照」（origin=manual）。每章保留最近 20 份（后端事务内裁剪）。
// 恢复是可逆的：父层（WritingPage.handleRestoreSnapshot）恢复前会先把当前正文存一份快照。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { writingSnapshotsApi, type WritingChapterSnapshot } from '../services/tauri';
import { t } from '../i18n';

function fmtTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ChapterSnapshotsDialog({
  open,
  onClose,
  chapterId,
  onManualSnapshot,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  chapterId: string | null;
  /** 手动快照（编辑器实例在父层，取当前正文由父层完成） */
  onManualSnapshot: () => Promise<void>;
  /** 恢复某快照：父层负责先存当前内容快照 + setContent + 落库 */
  onRestore: (content: string, wordCount: number) => void;
}) {
  const [items, setItems] = useState<WritingChapterSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<WritingChapterSnapshot | null>(null);

  const refresh = useCallback(async () => {
    if (!chapterId) return;
    setLoading(true);
    try {
      setItems(await writingSnapshotsApi.list(chapterId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  // 对话框每次打开清掉上次遗留的恢复确认（渲染期调整 state，避免 effect 同步 setState）
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setPending(null);
  }

  useEffect(() => {
    // 打开时加载快照：走微任务发起（refresh 同步段含 setLoading，移出 effect
    // 同步调用链避免级联渲染；拉取本身仍为异步）
    if (open) void Promise.resolve().then(refresh);
  }, [open, refresh]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{t('writing.snapshots.title')}</Typography>
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
          {t('writing.snapshots.keepHint', { n: 20 })}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 1 }}>
        {pending && (
          <Box
            sx={{
              mb: 1,
              mx: 0.5,
              p: 1,
              borderRadius: 1,
              bgcolor: 'rgba(139,92,246,0.08)',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 1, lineHeight: 1.6 }}>
              {t('writing.snapshots.restoreHint', { time: fmtTime(pending.createdAt) })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => setPending(null)}>
                {t('nav.cancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  onRestore(pending.content, pending.wordCount);
                  setPending(null);
                }}
              >
                {t('writing.snapshots.restore')}
              </Button>
            </Box>
          </Box>
        )}
        <List dense disablePadding>
          {items.map((s) => (
            <ListItemButton key={s.id} onClick={() => setPending(s)} disabled={!!pending}>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      size="small"
                      label={
                        s.origin === 'manual' ? t('writing.snapshots.originManual') : t('writing.snapshots.originAuto')
                      }
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18 }}
                    />
                    <Typography sx={{ fontSize: 12 }}>{fmtTime(s.createdAt)}</Typography>
                  </Box>
                }
                secondary={t('writing.words', { n: s.wordCount })}
                slotProps={{ secondary: { sx: { fontSize: 10.5 } } }}
              />
            </ListItemButton>
          ))}
          {!loading && items.length === 0 && (
            <Typography sx={{ fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 2, px: 1 }}>
              {t('writing.snapshots.empty')}
            </Typography>
          )}
        </List>
      </DialogContent>
      <DialogActions>
        <Button
          size="small"
          onClick={async () => {
            await onManualSnapshot();
            void refresh();
          }}
        >
          {t('writing.snapshots.manual')}
        </Button>
        <Button size="small" onClick={onClose}>
          {t('nav.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
