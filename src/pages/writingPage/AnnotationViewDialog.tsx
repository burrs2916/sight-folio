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
import type { WritingAnnotation, WritingSetting } from '../../services/writing';

export interface AnnotationViewDialogProps {
  annotation: WritingAnnotation | null;
  onClose: () => void;
  onDelete: () => void;
  /** 全部设定卡（解析 settingId 名称 + 修改关联）；传入且提供 onUpdateSetting 时渲染关联选择器。 */
  settings?: WritingSetting[];
  onUpdateSetting?: (annotation: WritingAnnotation, settingId: string) => void;
}

const settingKindLabel = (kind: WritingSetting['kind']) =>
  kind === 'character' ? t('editor.writing.inspector.tabCharacter') : t('writing.viewKind.worldview');

/** 章内批注查看/删除：点击正文批注高亮处弹出；支持查看/修改关联设定卡 */
export function AnnotationViewDialog({
  annotation,
  onClose,
  onDelete,
  settings,
  onUpdateSetting,
}: AnnotationViewDialogProps) {
  const linked = annotation?.settingId ? ((settings ?? []).find((s) => s.id === annotation.settingId) ?? null) : null;
  return (
    <Dialog open={annotation !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 15 }}>
        <StickyNote2RoundedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        {t('writing.annotationTitle')}
      </DialogTitle>
      <DialogContent>
        <Box
          sx={{
            mb: 1.5,
            p: 1.25,
            borderRadius: 1.5,
            bgcolor: 'action.hover',
            borderLeft: '3px solid',
            borderColor: 'warning.main',
            maxHeight: 110,
            overflowY: 'auto',
          }}
        >
          <Typography sx={{ fontSize: 11, color: 'text.disabled', mb: 0.5 }}>
            {t('writing.annotationExcerpt')}
          </Typography>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.7 }}>{annotation?.excerpt ?? ''}</Typography>
        </Box>
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
          {annotation?.text ?? ''}
        </Typography>
        {annotation && settings && onUpdateSetting && settings.length > 0 ? (
          <TextField
            select
            fullWidth
            size="small"
            label={t('writing.annotationSetting')}
            value={annotation.settingId ?? ''}
            onChange={(e) => onUpdateSetting(annotation, e.target.value)}
            sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: 13 } }}
          >
            <MenuItem value="">{t('writing.annotationSettingNone')}</MenuItem>
            {settings.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {settingKindLabel(s.kind)} · {s.name}
              </MenuItem>
            ))}
          </TextField>
        ) : linked ? (
          <Box
            sx={{
              mt: 1.5,
              display: 'inline-flex',
              alignItems: 'center',
              px: 1,
              py: 0.5,
              borderRadius: 3,
              bgcolor: 'action.hover',
              fontSize: 11.5,
              color: 'text.secondary',
            }}
          >
            {settingKindLabel(linked.kind)} · {linked.name}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button size="small" color="error" onClick={onDelete}>
          {t('writing.annotationDelete')}
        </Button>
        <Button size="small" variant="contained" onClick={onClose}>
          {t('workbench.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
