import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import { t } from '../../i18n';
import type { WritingAnnotation } from '../../services/writing';

export interface AnnotationViewDialogProps {
  annotation: WritingAnnotation | null;
  onClose: () => void;
  onDelete: () => void;
}

/** 章内批注查看/删除：点击正文批注高亮处弹出 */
export function AnnotationViewDialog({ annotation, onClose, onDelete }: AnnotationViewDialogProps) {
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
