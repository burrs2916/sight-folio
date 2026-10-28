import {
  Box,
  FormControlLabel,
  ListSubheader,
  MenuItem,
  Popover,
  Slider,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { t } from '../../i18n';
import {
  FONT_FAMILY_OPTIONS,
  LATIN_FONT_OPTIONS,
  type BookTypography,
  type LatinFontGroup,
} from '../../utils/typography';

export interface TypographyPopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  typo: BookTypography;
  onChange: (patch: Partial<BookTypography>) => void;
}

/** P3 排版面板：字号/行距/段距/首行缩进/页宽/纸色，per-book 持久化 */
export function TypographyPopover({ anchorEl, onClose, typo, onChange }: TypographyPopoverProps) {
  return (
    <Popover
      open={anchorEl !== null}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Box sx={{ p: 2, width: 264, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'text.secondary',
          }}
        >
          {t('writing.typography.title')}
        </Typography>

        <Box>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.25 }}>
            {t('writing.typography.fontSize', { n: typo.fontSize })}
          </Typography>
          <Slider
            size="small"
            min={14}
            max={22}
            step={1}
            value={typo.fontSize}
            marks
            valueLabelDisplay="auto"
            onChange={(_, v) => onChange({ fontSize: v as number })}
          />
        </Box>

        <TextField
          select
          size="small"
          fullWidth
          label={t('writing.typography.fontFamily')}
          value={typo.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value as BookTypography['fontFamily'] })}
        >
          {FONT_FAMILY_OPTIONS.map((o) => (
            <MenuItem key={o.key} value={o.key} sx={{ fontFamily: o.stack || undefined }}>
              {t(`writing.typography.font_${o.key}`)}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          fullWidth
          label={t('writing.typography.latinFontFamily')}
          value={typo.latinFontFamily}
          onChange={(e) => onChange({ latinFontFamily: e.target.value as BookTypography['latinFontFamily'] })}
        >
          {/* 跟随系统：单独置于最前，不参与分组 */}
          <MenuItem value="system" sx={{ fontFamily: undefined }}>
            {t('writing.typography.latinFont_system')}
          </MenuItem>
          {(['serif', 'sans', 'mono'] as readonly LatinFontGroup[]).map((group) => (
            <Box key={group}>
              <ListSubheader
                disableSticky
                sx={{ fontSize: 11, lineHeight: '30px', color: 'text.secondary', bgcolor: 'transparent' }}
              >
                {t(`writing.typography.latinGroup_${group}`)}
              </ListSubheader>
              {LATIN_FONT_OPTIONS.filter((o) => o.group === group).map((o) => (
                <MenuItem key={o.key} value={o.key} sx={{ fontFamily: o.stack || undefined, fontSize: 13 }}>
                  {t(`writing.typography.latinFont_${o.key}`)}
                </MenuItem>
              ))}
            </Box>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          fullWidth
          label={t('writing.typography.lineHeight')}
          value={typo.lineHeight}
          onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
        >
          <MenuItem value={1.6}>1.6</MenuItem>
          <MenuItem value={1.9}>1.9</MenuItem>
          <MenuItem value={2.2}>2.2</MenuItem>
        </TextField>

        <TextField
          select
          size="small"
          fullWidth
          label={t('writing.typography.paraSpacing')}
          value={typo.paraSpacing}
          onChange={(e) => onChange({ paraSpacing: Number(e.target.value) })}
        >
          <MenuItem value={0}>{t('writing.typography.paraNone')}</MenuItem>
          <MenuItem value={0.5}>{t('writing.typography.paraSmall')}</MenuItem>
          <MenuItem value={1}>{t('writing.typography.paraMedium')}</MenuItem>
          <MenuItem value={1.5}>{t('writing.typography.paraLarge')}</MenuItem>
        </TextField>

        <TextField
          select
          size="small"
          fullWidth
          label={t('writing.typography.pageWidth')}
          value={typo.pageWidth}
          onChange={(e) => onChange({ pageWidth: Number(e.target.value) })}
        >
          <MenuItem value={620}>{t('writing.typography.widthNarrow')}</MenuItem>
          <MenuItem value={760}>{t('writing.typography.widthMedium')}</MenuItem>
          <MenuItem value={900}>{t('writing.typography.widthWide')}</MenuItem>
        </TextField>

        <TextField
          select
          size="small"
          fullWidth
          label={t('writing.typography.paper')}
          value={typo.paper}
          onChange={(e) => onChange({ paper: e.target.value as BookTypography['paper'] })}
        >
          <MenuItem value="default">{t('writing.typography.paperDefault')}</MenuItem>
          <MenuItem value="sepia">{t('writing.typography.paperSepia')}</MenuItem>
          <MenuItem value="green">{t('writing.typography.paperGreen')}</MenuItem>
        </TextField>

        <FormControlLabel
          control={
            <Switch size="small" checked={typo.indent} onChange={(e) => onChange({ indent: e.target.checked })} />
          }
          label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.typography.indent')}</Typography>}
          sx={{ mr: 0 }}
        />
      </Box>
    </Popover>
  );
}
