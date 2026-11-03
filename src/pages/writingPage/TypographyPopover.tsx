import {
  Box,
  Button,
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
import { uiFontSize } from '../../theme/appearanceScales';

export interface TypographyPopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  typo: BookTypography;
  onChange: (patch: Partial<BookTypography>) => void;
  /**
   * 本书单独调过几项（第三十轮 P1）。> 0 时面板顶部标出「本书已单独设置 N 项」并给出
   * 「跟随全局默认」出口 —— 此前书级覆盖既看不见也清不掉，只能一项一项手动改回去。
   */
  overrideFieldCount?: number;
  /** 当前是否选着书：没选书时改动不落库（无处可落），界面必须说实话而不是假装已保存 */
  canOverride?: boolean;
  /** 清掉本书全部覆盖，让这本书重新跟随「设置 → 正文默认排版」 */
  onFollowDefault?: () => void;
  /**
   * 本书**真的单独调过**的那几项（第三十二轮，收第 31 轮待办 7②）。
   * 面板据此在对应字段旁画一个「跟随默认」出口 —— 此前想只让字号回到跟随默认、
   * 行距保留自己调的那档，唯一的按钮却会把整本书的排版一起冲掉：
   * 粒度比需求粗一档，用户就只能放弃调整，读起来还是「设置不顺手」。
   */
  overriddenFields?: (keyof BookTypography)[];
  /** 把某一项收回「跟随全局默认」，其余单独调过的项保持不变 */
  onFollowDefaultField?: (field: keyof BookTypography) => void;
}

/** P3 排版面板：字号/行距/段距/首行缩进/页宽/纸色，书级覆盖落设置库（第三十轮 P1） */
export function TypographyPopover({
  anchorEl,
  onClose,
  typo,
  onChange,
  overrideFieldCount = 0,
  canOverride = true,
  onFollowDefault,
  overriddenFields = [],
  onFollowDefaultField,
}: TypographyPopoverProps) {
  /**
   * 字段级「跟随默认」出口：只在这一项**确实是这本书单独调过的**时才画出来。
   * 没调过的项挂一个按了没反应的按钮，就又造出一处「设置了没生效」（本仓反复在清的病灶）。
   */
  const followBack = (field: keyof BookTypography) =>
    canOverride && onFollowDefaultField && overriddenFields.includes(field) ? (
      <Button
        size="small"
        data-testid={`typography-follow-default-${field}`}
        onClick={() => onFollowDefaultField(field)}
        sx={{
          textTransform: 'none',
          fontSize: uiFontSize(10.5),
          lineHeight: 1.2,
          minWidth: 0,
          px: 0.5,
          py: 0,
          color: 'primary.main',
          flexShrink: 0,
        }}
      >
        {t('writing.typography.followDefaultField')}
      </Button>
    ) : null;

  /** TextField 的 label 支持节点：把「字段名 + 收回出口」排成一行 */
  const fieldLabel = (label: string, field: keyof BookTypography) => (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, width: '100%' }}
    >
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
        {label}
      </Box>
      {followBack(field)}
    </Box>
  );

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
            fontSize: uiFontSize(12),
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'text.secondary',
          }}
        >
          {t('writing.typography.title')}
        </Typography>

        {/* 覆盖状态条（第三十轮 P1）：把「这本书跟不跟全局默认」变成一眼可见、可撤销的事实 */}
        <Typography
          variant="caption"
          color={overrideFieldCount > 0 ? 'primary.main' : 'text.disabled'}
          data-testid="typography-override-state"
          sx={{ display: 'block', mt: -0.75, lineHeight: 1.5 }}
        >
          {overrideFieldCount > 0
            ? t('writing.typography.overrideOn', { n: overrideFieldCount })
            : t('writing.typography.followingGlobal')}
        </Typography>
        {overrideFieldCount > 0 && (
          <Button
            size="small"
            onClick={onFollowDefault}
            data-testid="typography-follow-default"
            sx={{ textTransform: 'none', fontSize: uiFontSize(11), alignSelf: 'flex-start', mt: -0.5 }}
          >
            {t('writing.typography.followDefaultNow')}
          </Button>
        )}
        {!canOverride && (
          <Typography
            variant="caption"
            color="warning.main"
            data-testid="typography-no-book-hint"
            sx={{ display: 'block', mt: -0.75, lineHeight: 1.5 }}
          >
            {t('writing.typography.noBookHint')}
          </Typography>
        )}

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mb: 0.25 }}>
              {t('writing.typography.fontSize', { n: typo.fontSize })}
            </Typography>
            {followBack('fontSize')}
          </Box>
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
          label={fieldLabel(t('writing.typography.fontFamily'), 'fontFamily')}
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
          label={fieldLabel(t('writing.typography.latinFontFamily'), 'latinFontFamily')}
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
                sx={{ fontSize: uiFontSize(11), lineHeight: '30px', color: 'text.secondary', bgcolor: 'transparent' }}
              >
                {t(`writing.typography.latinGroup_${group}`)}
              </ListSubheader>
              {LATIN_FONT_OPTIONS.filter((o) => o.group === group).map((o) => (
                <MenuItem key={o.key} value={o.key} sx={{ fontFamily: o.stack || undefined, fontSize: uiFontSize(13) }}>
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
          label={fieldLabel(t('writing.typography.lineHeight'), 'lineHeight')}
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
          label={fieldLabel(t('writing.typography.paraSpacing'), 'paraSpacing')}
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
          label={fieldLabel(t('writing.typography.pageWidth'), 'pageWidth')}
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
          label={fieldLabel(t('writing.typography.paper'), 'paper')}
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
          label={fieldLabel(t('writing.typography.indent'), 'indent')}
          sx={{ mr: 0 }}
        />
      </Box>
    </Popover>
  );
}
