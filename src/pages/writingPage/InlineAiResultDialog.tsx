import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { InlineWritingKind } from '../../ai/writingAssistant';
import { t } from '../../i18n';

export interface InlineAiResult {
  kind: InlineWritingKind;
  text: string;
  selectionChars?: number;
}

export interface InlineAiResultDialogProps {
  result: InlineAiResult | null;
  onClose: () => void;
  onApply: () => void;
}

/** 内联 AI 结果预览：用户确认后才动正文，绝无静默改写 */
export function InlineAiResultDialog({ result, onClose, onApply }: InlineAiResultDialogProps) {
  return (
    <Dialog open={result !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>
        {result?.kind === 'continue' ? t('writing.resultContinueTitle') : t('writing.resultPolishTitle')}
        {result?.kind === 'polish' && result.selectionChars != null && (
          <Typography component="span" sx={{ fontSize: 12, fontWeight: 400, color: 'text.secondary', ml: 1 }}>
            {t('writing.resultReplaceSelection', { n: result.selectionChars })}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ maxHeight: 420, overflowY: 'auto', bgcolor: 'action.hover', borderRadius: 1.5, p: 1.5 }}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>{result?.text}</Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('writing.discard')}
        </Button>
        <Button size="small" variant="contained" onClick={onApply}>
          {result?.kind === 'continue' ? t('writing.insertToChapter') : t('writing.applyToChapter')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
