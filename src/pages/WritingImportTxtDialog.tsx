// 写作台 TXT 批量导入对话框（骨架走查 P2-G3）：
// 存量文本迁入此前只能逐章粘贴——此处粘贴正文，按「第X章」标题行或空行自动分章
// （算法复用 utils/writingImport 唯一口径），预览识别结果后确认，
// 实际建章由调用方执行（createChapter + saveChapterContent）。粘贴方案零新依赖
// （plugin-fs 不在依赖内，file picker 记 backlog）。上限 200 章防误操作。
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { splitChaptersFromText, type ParsedChapter } from '../utils/writingImport';
import { t } from '../i18n';

export const IMPORT_TXT_MAX_CHAPTERS = 200;

export interface WritingImportTxtDialogProps {
  open: boolean;
  onClose: () => void;
  /** 单块兜底标题（i18n 由调用方传入，组件保持纯展示） */
  fallbackTitle: string;
  /** 确认导入：调用方执行建章并落正文 */
  onImport: (chapters: ParsedChapter[]) => Promise<void>;
}

export function WritingImportTxtDialog({ open, onClose, fallbackTitle, onImport }: WritingImportTxtDialogProps) {
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);

  const parsed = useMemo(() => splitChaptersFromText(text, fallbackTitle), [text, fallbackTitle]);
  const tooMany = parsed.length > IMPORT_TXT_MAX_CHAPTERS;

  const handleConfirm = async () => {
    if (parsed.length === 0 || tooMany || importing) return;
    setImporting(true);
    try {
      await onImport(parsed);
    } finally {
      setImporting(false);
      setText('');
      onClose();
    }
  };

  const previewTitles = parsed.slice(0, 3).map((c) => c.title);

  return (
    <Dialog open={open} onClose={importing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{t('writing.importTxtTitle')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('writing.importTxtHint')}</Typography>
        <TextField
          fullWidth
          multiline
          minRows={8}
          maxRows={14}
          placeholder={t('writing.importTxtPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          slotProps={{ htmlInput: { 'data-testid': 'import-txt-textarea' } }}
        />
        {text.trim().length > 0 && (
          <Typography
            sx={{ fontSize: 12, fontWeight: 700, color: tooMany ? 'error.main' : 'primary.main' }}
            data-testid="import-txt-preview"
          >
            {tooMany
              ? t('writing.importTxtTooMany', { n: IMPORT_TXT_MAX_CHAPTERS, total: parsed.length })
              : t('writing.importTxtPreview', { n: parsed.length })}
            {!tooMany && previewTitles.length > 0 && `：${previewTitles.join('、')}${parsed.length > 3 ? '…' : ''}`}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={importing}>
          {t('nav.cancel')}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={() => void handleConfirm()}
          disabled={parsed.length === 0 || tooMany || importing}
          data-testid="import-txt-run"
        >
          {importing ? t('writing.importTxtImporting') : t('writing.importTxtConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
