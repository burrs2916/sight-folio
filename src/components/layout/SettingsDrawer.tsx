import { useCallback } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useAppearanceStore } from '../../store/appearanceStore';
import type { ThemeMode, ThemePreset, FontSize, BorderRadius } from '../../store/themeStore';
import type { LayoutPreset } from '../../store/layoutStore';
import { t, resolveFragments } from '../../i18n';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

// 铁律：含 t() 的数据定义必须放函数体内/getter（模块级 const 会在加载时固化，切语言不刷新）
function getThemePresets(): { id: ThemePreset; label: string; color: string }[] {
  return [
    { id: 'default', label: t('settings.presetDefault'), color: '#1976D2' },
    { id: 'blue', label: t('settings.presetBlue'), color: '#1565C0' },
    { id: 'green', label: t('settings.presetGreen'), color: '#2E7D32' },
    { id: 'orange', label: t('settings.presetOrange'), color: '#E65100' },
    { id: 'purple', label: t('settings.presetPurple'), color: '#7B1FA2' },
    { id: 'indigo', label: t('settings.presetIndigo'), color: '#4F46E5' },
    { id: 'custom', label: t('settings.presetCustom'), color: 'linear-gradient(135deg, #f00, #00f)' },
  ];
}

function getFontSizeOptions(): { id: FontSize; label: string; preview: string }[] {
  return [
    { id: 'small', label: t('settings.fontSmall'), preview: '11px' },
    { id: 'medium', label: t('settings.fontMedium'), preview: '13px' },
    { id: 'large', label: t('settings.fontLarge'), preview: '15px' },
  ];
}

function getBorderRadiusOptions(): { id: BorderRadius; label: string }[] {
  return [
    { id: 'none', label: t('settings.radiusNone') },
    { id: 'small', label: t('settings.radiusSmall') },
    { id: 'medium', label: t('settings.radiusMedium') },
    { id: 'large', label: t('settings.radiusLarge') },
    { id: 'round', label: t('settings.radiusRound') },
  ];
}

/** 主题预设 id → 本地化 label（Chip 展示 profile.theme.preset 用） */
function presetLabel(id: string): string {
  const found = getThemePresets().find((p) => p.id === id);
  return found?.label ?? id;
}

export default function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const themeConfig = useThemeStore((s) => s.config);
  const setMode = useThemeStore((s) => s.setMode);
  const setPreset = useThemeStore((s) => s.setPreset);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const setBorderRadius = useThemeStore((s) => s.setBorderRadius);
  const setCustomPrimary = useThemeStore((s) => s.setCustomPrimary);
  const resetConfig = useThemeStore((s) => s.resetConfig);

  const layoutConfig = useLayoutStore((s) => s.config);
  const applyPreset = useLayoutStore((s) => s.applyPreset);

  const profiles = useAppearanceStore((s) => s.profiles);
  const activeProfileId = useAppearanceStore((s) => s.activeProfileId);
  const applyProfile = useAppearanceStore((s) => s.applyProfile);

  // 所有设置项（颜色模式 / 主题色 / 字号 / 圆角 / 布局 / 外观预设）在每个 action 内
  // 即时 persist 落盘——不存在「未保存」状态。底部原先那颗「✓ 确认设置」按钮
  // 只弹一个假「已保存 ✓」chip、并不写任何数据，是死控件：既误导创作者「不点保存不生效」，
  // 又和「重置」并列加重误解。本批移除它，改为诚实的「自动保存」提示 + 明确「关闭设置」出口。

  const handleModeChange = useCallback(
    (_: any, val: ThemeMode | null) => {
      if (val) setMode(val);
    },
    [setMode],
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 480, md: 560 },
            maxWidth: '100vw',
            p: 0,
          },
        },
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('settings.title')}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('settings.close')}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {/* 外观预设 */}
        {profiles.length > 0 && (
          <Accordion defaultExpanded disableGutters sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {t('settings.appearancePreset')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
                {profiles.map((profile) => {
                  const isActive = activeProfileId === profile.id;
                  return (
                    <Card
                      key={profile.id}
                      variant="outlined"
                      sx={{
                        cursor: 'pointer',
                        borderColor: isActive ? 'primary.main' : 'divider',
                        bgcolor: isActive ? 'action.selected' : 'background.paper',
                        transition: 'all 0.15s',
                        '&:hover': { borderColor: 'primary.light' },
                      }}
                      onClick={() => applyProfile(profile.id)}
                    >
                      <CardActionArea sx={{ p: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>
                            {resolveFragments(profile.name)}
                          </Typography>
                          {isActive && <CheckCircleIcon sx={{ fontSize: 14, color: 'primary.main', ml: 'auto' }} />}
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                          {resolveFragments(profile.description)}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }}>
                          <Chip
                            label={
                              profile.theme.mode === 'dark'
                                ? t('settings.profileDark')
                                : profile.theme.mode === 'light'
                                  ? t('settings.profileLight')
                                  : t('settings.profileSystem')
                            }
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, fontSize: 9 }}
                          />
                          <Chip
                            label={presetLabel(profile.theme.preset)}
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, fontSize: 9 }}
                          />
                        </Box>
                      </CardActionArea>
                    </Card>
                  );
                })}
              </Box>
            </AccordionDetails>
          </Accordion>
        )}

        <Divider />

        {/* 颜色模式 */}
        <Accordion defaultExpanded disableGutters sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('settings.colorMode')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <ToggleButtonGroup value={themeConfig.mode} exclusive onChange={handleModeChange} size="small" fullWidth>
              <ToggleButton value="light" sx={{ textTransform: 'none', gap: 0.5 }}>
                <LightModeIcon sx={{ fontSize: 16 }} /> {t('settings.modeLight')}
              </ToggleButton>
              <ToggleButton value="dark" sx={{ textTransform: 'none', gap: 0.5 }}>
                <DarkModeIcon sx={{ fontSize: 16 }} /> {t('settings.modeDark')}
              </ToggleButton>
              <ToggleButton value="system" sx={{ textTransform: 'none', gap: 0.5 }}>
                <SettingsBrightnessIcon sx={{ fontSize: 16 }} /> {t('settings.modeSystem')}
              </ToggleButton>
            </ToggleButtonGroup>
          </AccordionDetails>
        </Accordion>

        <Divider />

        {/* 主题色彩 */}
        <Accordion defaultExpanded disableGutters sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('settings.themeColor')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {getThemePresets().map((preset) => (
                <Box
                  key={preset.id}
                  onClick={() => setPreset(preset.id)}
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1.5,
                    background: preset.color,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: themeConfig.preset === preset.id ? '2px solid' : '2px solid transparent',
                    borderColor: themeConfig.preset === preset.id ? 'primary.main' : 'divider',
                    transition: 'all 0.15s',
                    '&:hover': { transform: 'scale(1.1)' },
                    position: 'relative',
                  }}
                >
                  {themeConfig.preset === preset.id && (
                    <CheckCircleIcon
                      sx={{ fontSize: 16, color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                    />
                  )}
                </Box>
              ))}
            </Box>
            {themeConfig.preset === 'custom' && (
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <input
                  type="color"
                  value={themeConfig.customPrimary || '#1976D2'}
                  onChange={(e) => setCustomPrimary(e.target.value)}
                  style={{ width: 32, height: 32, border: 'none', cursor: 'pointer', borderRadius: 4 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {t('settings.customPrimary')}
                </Typography>
              </Box>
            )}
          </AccordionDetails>
        </Accordion>

        <Divider />

        {/* 字体大小 */}
        <Accordion defaultExpanded disableGutters sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('settings.fontSize')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <ToggleButtonGroup
              value={themeConfig.fontSize}
              exclusive
              onChange={(_, val: FontSize | null) => val && setFontSize(val)}
              size="small"
              fullWidth
            >
              {getFontSizeOptions().map((opt) => (
                <ToggleButton key={opt.id} value={opt.id} sx={{ textTransform: 'none' }}>
                  <Typography variant="caption">{opt.label}</Typography>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </AccordionDetails>
        </Accordion>

        <Divider />

        {/* 圆角风格 */}
        <Accordion defaultExpanded disableGutters sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('settings.borderRadius')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {getBorderRadiusOptions().map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  onClick={() => setBorderRadius(opt.id)}
                  color={themeConfig.borderRadius === opt.id ? 'primary' : 'default'}
                  variant={themeConfig.borderRadius === opt.id ? 'filled' : 'outlined'}
                  size="small"
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>

        <Divider />

        {/* 布局预设 */}
        <Accordion defaultExpanded disableGutters sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t('settings.layoutPreset')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {(
                [
                  { id: 'default' as LayoutPreset, icon: <ViewSidebarIcon />, label: t('settings.layoutStandard') },
                  { id: 'compact' as LayoutPreset, icon: <ViewCompactIcon />, label: t('settings.layoutCompact') },
                  { id: 'wide' as LayoutPreset, icon: <ViewColumnIcon />, label: t('settings.layoutWide') },
                ] as const
              ).map((opt) => (
                <Card
                  key={opt.id}
                  variant="outlined"
                  sx={{
                    flex: 1,
                    cursor: 'pointer',
                    borderColor: layoutConfig.preset === opt.id ? 'primary.main' : 'divider',
                    bgcolor: layoutConfig.preset === opt.id ? 'action.selected' : 'transparent',
                    transition: 'all 0.15s',
                    '&:hover': { borderColor: 'primary.light' },
                  }}
                  onClick={() => applyPreset(opt.id)}
                >
                  <CardActionArea sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {opt.icon}
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                      {opt.label}
                    </Typography>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>

        <Divider />

        {/* 底部重置按钮 */}
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            color="warning"
            onClick={resetConfig}
            sx={{ textTransform: 'none', fontSize: 12 }}
          >
            {t('settings.reset')}
          </Button>
        </Box>
      </Box>

      {/* 底部栏：即时生效说明（自动保存）+ 明确关闭出口（替代原假「确认设置」死控件） */}
      <Box
        sx={{
          p: 1.5,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          <CheckCircleIcon sx={{ fontSize: 13, color: 'success.main', verticalAlign: '-2px', mr: 0.5 }} />
          {t('settings.autoSaveNote')}
        </Typography>
        <Button
          variant="contained"
          size="small"
          onClick={onClose}
          sx={{ textTransform: 'none', fontSize: 12, flexShrink: 0 }}
        >
          {t('settings.close')}
        </Button>
      </Box>
    </Drawer>
  );
}
