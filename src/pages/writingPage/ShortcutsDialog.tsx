import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { t } from '../../i18n';
import { uiFontSize } from '../../theme/appearanceScales';

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 快捷键速查（批次③）：⌘[ / ⌘] 章间导航、⌘S 保存、⌘F 查找替换、⌘K 跳章 */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('writing.shortcutsTitle')}</DialogTitle>
      <DialogContent dividers>
        {(
          [
            ['⌘[', 'writing.prevChapter'],
            ['⌘]', 'writing.nextChapter'],
            ['⌘S', 'writing.shortcutSave'],
            ['⌘F', 'writing.shortcutFind'],
            ['⌘K', 'writing.shortcutJump'],
          ] as const
        ).map(([key, labelKey]) => (
          <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 0.75 }}>
            <Typography
              component="span"
              sx={{
                fontSize: uiFontSize(11.5),
                fontFamily: 'monospace',
                px: 1,
                py: 0.25,
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'action.hover',
                minWidth: 44,
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              {key}
            </Typography>
            <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>{t(labelKey)}</Typography>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('nav.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
