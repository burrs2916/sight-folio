// 「锁定一版」弹窗（完结作品重设计 · B2，需求 §5.1 / D8）。
//
// 职责边界（刻意窄）：
// - 只做「冲未保存改动 → 调 lock_work_version → 处理冲突/失败/成功」这一条流程，
//   不碰写作台任何编辑逻辑；flush 口径复用 useExportActions 的 useFreshChapters，
//   不另抄一份，避免导出与锁定两边 flush 行为漂移。
// - 正文由后端从库里落盘态自取（B1 决策），这里只传标签/备注/正稿开关。
// - 同指纹拦截走「仍然锁定」次级出口（force）：冲突判据是错误消息里的
//   SAME_CONTENT| 机读前缀，不看中文字面 —— 文案换词不能弄断出口。
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import { workVersionApi, SAME_CONTENT_ERROR_MARK } from '../../services/workVersion';
import { useToastStore } from '../../store/toastStore';
import { logger } from '../../utils/logger';
import { t } from '../../i18n';
import { useFreshChapters } from './useExportActions';

export interface LockVersionDialogProps {
  open: boolean;
  onClose: () => void;
  bookId: string;
  flushSave: () => Promise<boolean>;
  flushSettingSave: () => Promise<boolean>;
}

export function LockVersionDialog({ open, onClose, bookId, flushSave, flushSettingSave }: LockVersionDialogProps) {
  const navigate = useNavigate();
  const getFreshChapters = useFreshChapters();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** 同指纹冲突：展示提示 + 「仍然锁定」出口（需求 §5.1 第 3 步） */
  const [conflict, setConflict] = useState(false);
  /** 其他失败：就地显示原因，不静默关窗 */
  const [error, setError] = useState('');

  const closeAndReset = useCallback(() => {
    setLabel('');
    setNote('');
    setIsFinal(false);
    setConflict(false);
    setError('');
    setSubmitting(false);
    onClose();
  }, [onClose]);

  const submit = useCallback(
    async (force: boolean) => {
      if (!bookId || submitting) return;
      setSubmitting(true);
      setConflict(false);
      setError('');
      try {
        // 先把未保存改动冲干净再锁（与整书导出同一 flush 口径）。
        // 章节本身不上传：lock 的正文由后端从库里取，这里只要 flush 的副作用。
        await getFreshChapters(flushSave, flushSettingSave);
        const version = await workVersionApi.lock(bookId, label.trim(), note.trim(), isFinal, force);
        useToastStore
          .getState()
          .showToast(
            t('writing.lockVersionDone', { seq: version.seq }),
            'info',
            6000,
            { label: t('published.viewWorks'), onClick: () => navigate('/published') },
          );
        closeAndReset();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('LockVersionDialog', 'lock version failed', { error: e, bookId, force });
        if (msg.includes(SAME_CONTENT_ERROR_MARK)) {
          setConflict(true);
        } else {
          setError(t('writing.lockVersionFailed', { msg }));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [bookId, closeAndReset, flushSave, flushSettingSave, getFreshChapters, isFinal, label, navigate, note, submitting],
  );

  return (
    <Dialog open={open} onClose={(_, reason) => reason !== 'backdropClick' && closeAndReset()} maxWidth="xs" fullWidth>
      <DialogTitle>{t('writing.lockVersionTitle')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t('writing.lockVersionHint')}
        </Typography>
        <TextField
          size="small"
          label={t('writing.lockVersionLabel')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'lock-version-label' } }}
        />
        <TextField
          size="small"
          multiline
          minRows={2}
          label={t('writing.lockVersionNote')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'lock-version-note' } }}
        />
        <FormControlLabel
          control={<Checkbox checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} size="small" />}
          label={<Typography variant="body2">{t('writing.lockVersionAsFinal')}</Typography>}
        />
        {conflict && (
          <Box
            sx={{
              p: 1.25,
              borderRadius: 1,
              bgcolor: 'warning.light',
            }}
          >
            <Typography variant="body2">{t('writing.lockVersionConflict')}</Typography>
          </Box>
        )}
        {error && (
          <Box sx={{ p: 1.25, borderRadius: 1, bgcolor: 'error.light' }}>
            <Typography variant="body2">{error}</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={closeAndReset} disabled={submitting}>
          {t('ui.cancel')}
        </Button>
        {conflict && (
          <Button variant="outlined" onClick={() => void submit(true)} disabled={submitting}>
            {t('writing.lockAnyway')}
          </Button>
        )}
        <Button variant="contained" onClick={() => void submit(false)} disabled={submitting}>
          {t('writing.lockVersionConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
