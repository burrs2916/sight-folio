import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import type { Editor } from '@tiptap/react';
import { t } from '../../i18n';
import { findMatches, replaceAllMatches } from './editorUtils';
import { useToastStore } from '../../store/toastStore';

export interface FindReplaceDialogProps {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
  findText: string;
  onFindTextChange: (v: string) => void;
  replaceText: string;
  onReplaceTextChange: (v: string) => void;
}

/**
 * 查找替换（P9）：当前章节内，替换全部走一次事务（触发既有防抖自动保存）。
 */
export function FindReplaceDialog({
  open,
  onClose,
  editor,
  findText,
  onFindTextChange,
  replaceText,
  onReplaceTextChange,
}: FindReplaceDialogProps) {
  const doReplace = () => {
    if (!editor) return;
    const n = replaceAllMatches(editor, findText, replaceText);
    onClose();
    useToastStore.getState().success(t('writing.replacedCount', { n }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>{t('writing.findReplace')}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label={t('writing.findText')}
          value={findText}
          onChange={(e) => onFindTextChange(e.target.value)}
          sx={{ mt: 1 }}
        />
        <TextField
          fullWidth
          size="small"
          label={t('writing.replaceText')}
          value={replaceText}
          onChange={(e) => onReplaceTextChange(e.target.value)}
          sx={{ mt: 1.5 }}
        />
        {findText.trim() && editor && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>
            {t('writing.matchCount', { n: findMatches(editor, findText).length })}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('nav.cancel')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!findText.trim() || !editor || findMatches(editor, findText).length === 0}
          onClick={doReplace}
        >
          {t('writing.replaceAll')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
