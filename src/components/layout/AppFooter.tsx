import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { t } from '../../i18n';

export default function AppFooter() {
  return (
    <Box
      component="footer"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 0.75,
        backgroundColor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        minHeight: 32,
        flexShrink: 0,
        gap: 1,
      }}
    >
      <Typography variant="caption" color="text.disabled">
        {t('footer.desc')}
      </Typography>
    </Box>
  );
}
