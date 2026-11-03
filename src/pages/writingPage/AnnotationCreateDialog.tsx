import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import { t } from '../../i18n';
import type { WritingSetting } from '../../services/writing';
import { uiFontSize } from '../../theme/appearanceScales';

export interface AnnotationCreateDialogProps {
  draft: { excerpt: string } | null;
  onClose: () => void;
  text: string;
  onTextChange: (v: string) => void;
  /** 可选的设定卡选择（人物/世界观）：传入即渲染「关联设定」选择器。 */
  settings?: WritingSetting[];
  settingId?: string;
  onSettingIdChange?: (v: string) => void;
  onSave: () => void;
}

const settingKindLabel = (kind: WritingSetting['kind']) =>
  kind === 'character' ? t('editor.writing.inspector.tabCharacter') : t('writing.viewKind.worldview');

/** 章内批注（批次② T4）新增：选中文本 → 弹窗录入并保存（⌘⏎ 快捷保存） */
export function AnnotationCreateDialog({
  draft,
  onClose,
  text,
  onTextChange,
  settings,
  settingId = '',
  onSettingIdChange,
  onSave,
}: AnnotationCreateDialogProps) {
  return (
    <Dialog open={draft !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: uiFontSize(15) }}>
        <StickyNote2RoundedIcon sx={{ fontSize: uiFontSize(18), color: 'primary.main' }} />
        {t('writing.annotationAdd')}
      </DialogTitle>
      <DialogContent>
        <Box
          sx={{
            mb: 1.5,
            p: 1.25,
            borderRadius: 1.5,
            bgcolor: 'action.hover',
            borderLeft: '3px solid',
            borderColor: 'primary.main',
            maxHeight: 110,
            overflowY: 'auto',
          }}
        >
          <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled', mb: 0.5 }}>
            {t('writing.annotationExcerpt')}
          </Typography>
          <Typography sx={{ fontSize: uiFontSize(13.5), lineHeight: 1.7 }}>{draft?.excerpt ?? ''}</Typography>
        </Box>
        <TextField
          autoFocus
          fullWidth
          size="small"
          multiline
          minRows={3}
          maxRows={6}
          label={t('writing.annotationText')}
          placeholder={t('writing.annotationPlaceholder')}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave();
          }}
          sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(13.5) } }}
        />
        {settings && onSettingIdChange && settings.length > 0 && (
          <TextField
            select
            fullWidth
            size="small"
            label={t('writing.annotationSetting')}
            value={settingId}
            onChange={(e) => onSettingIdChange(e.target.value)}
            sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: uiFontSize(13) } }}
          >
            <MenuItem value="">{t('writing.annotationSettingNone')}</MenuItem>
            {settings.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {settingKindLabel(s.kind)} · {s.name}
              </MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('nav.cancel')}
        </Button>
        <Button size="small" variant="contained" onClick={onSave}>
          {t('writing.annotationSave')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
