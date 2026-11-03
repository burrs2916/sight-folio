// 写作台独立窗口（desk=1）的设置面板（第二十六轮，落第 25 轮待办 2）
//
// 为什么单独一个组件、而不是把主抽屉搬过来：写作台是沉浸窗口，主抽屉那 12 个章节里
// 大半（外观预设 / 布局与密度 / 备份恢复 / 语言）在写正文时根本用不到，搬进来等于
// 把沉浸感砸掉。这里只放**写着写着会想调**的六项：颜色模式、界面字号、正文字号、行距、
// 纸色、写作偏好（专注模式 / 打字机滚动 / 自动保存节奏）。
//
// 持久化口径与主抽屉**完全一致**，没有第二条链路：写的是同一批 store 的同一批 action，
// 于是即时生效、persistSettings 落库、失败重试与提示、appearance-changed 跨窗口跟随
// （主窗口立刻同步同一档位）全都自动具备。反过来主窗口改档位，这边也即时跟随。
import { useCallback } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Slider from '@mui/material/Slider';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import CloseIcon from '@mui/icons-material/Close';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import SyncIcon from '@mui/icons-material/Sync';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import { useThemeStore } from '../../store/themeStore';
import type { ThemeMode } from '../../store/themeStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useWritingPrefsStore } from '../../store/writingPrefsStore';
import { useSettingsPanelStore } from '../../store/settingsPanelStore';
import { useSettingsSyncStore, overallStatus } from '../../store/settingsSyncStore';
import { uiFontSize } from '../../theme/appearanceScales';
import {
  getDeskFocusOptions,
  getFontSizeOptions,
  getSaveCadenceOptions,
  getTypewriterOptions,
} from './settingsOptions';
import { settingsShortcutLabel } from '../../hooks/useSettingsShortcut';
import { t } from '../../i18n';

interface DeskSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/** 一组横向档位按钮（与主抽屉同一交互，不另创控件） */
function ChoiceRow(props: {
  label: string;
  value: string | number;
  options: { id: string | number; label: string }[];
  onChange: (v: string | number) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        size="small"
        fullWidth
        onChange={(_: unknown, v: string | number | null) => v !== null && onChange(v)}
      >
        {options.map((o) => (
          <ToggleButton
            key={String(o.id)}
            value={o.id}
            data-testid={`desk-setting-${String(o.id)}`}
            sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
          >
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

export default function DeskSettingsPanel({ open, onClose }: DeskSettingsPanelProps) {
  const themeMode = useThemeStore((s) => s.config.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const uiFontSizeValue = useThemeStore((s) => s.config.fontSize);
  const setUiFontSize = useThemeStore((s) => s.setFontSize);

  const typoConfig = useTypographyDefaultsStore((s) => s.config);
  const setTypoConfig = useTypographyDefaultsStore((s) => s.setConfig);

  const writingPrefs = useWritingPrefsStore((s) => s.config);
  const setFocusMode = useWritingPrefsStore((s) => s.setFocusMode);
  const setTypewriterScroll = useWritingPrefsStore((s) => s.setTypewriterScroll);
  const setSaveCadence = useWritingPrefsStore((s) => s.setSaveCadence);

  // 落盘读数（与主抽屉同一可信层）：写作台里改档位同样可能写库失败，那边必须看得见
  const syncStatusMap = useSettingsSyncStore((s) => s.status);
  const lastSavedAt = useSettingsSyncStore((s) => s.lastSavedAt);
  const retryFailedWrites = useSettingsSyncStore((s) => s.retryFailed);
  const syncState = overallStatus(syncStatusMap, lastSavedAt);

  const modeOptions = [
    { id: 'light', label: t('settings.modeLight') },
    { id: 'dark', label: t('settings.modeDark') },
    { id: 'system', label: t('settings.modeSystem') },
  ];
  const focusOptions = getDeskFocusOptions().map((o) => ({ id: o.id, label: o.label }));
  const typewriterOptions = getTypewriterOptions().map((o) => ({ id: o.id, label: o.label }));
  const cadenceOptions = getSaveCadenceOptions().map((o) => ({ id: o.id, label: `${o.label} ${o.ms}ms` }));
  const uiFontOptions = getFontSizeOptions().map((o) => ({ id: o.id, label: `${o.label} ${o.px}px` }));
  const paperOptions = [
    { id: 'default', label: t('writing.typography.paperDefault') },
    { id: 'sepia', label: t('writing.typography.paperSepia') },
    { id: 'green', label: t('writing.typography.paperGreen') },
  ];

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: { xs: '100%', sm: 360 }, maxWidth: '100vw', display: 'flex', flexDirection: 'column' } },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('settings.deskPanelTitle')}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('settings.close')}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, py: 1.75 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.6 }}>
          {t('settings.deskPanelHint', { shortcut: settingsShortcutLabel() })}
        </Typography>

        <ChoiceRow
          label={t('settings.colorMode')}
          value={themeMode}
          options={modeOptions}
          onChange={(v) => setThemeMode(v as ThemeMode)}
        />
        <ChoiceRow
          label={t('settings.fontSize')}
          value={uiFontSizeValue}
          options={uiFontOptions}
          onChange={(v) => setUiFontSize(v as 'small' | 'medium' | 'large')}
        />
        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
          {t('settings.bodyTypography')}
        </Typography>
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
            {t('writing.typography.fontSize')} {typoConfig.fontSize}px
          </Typography>
          <Slider
            size="small"
            min={14}
            max={22}
            step={1}
            value={typoConfig.fontSize}
            aria-label={t('writing.typography.fontSize')}
            onChange={(_: unknown, v: number | number[]) => setTypoConfig({ fontSize: Array.isArray(v) ? v[0] : v })}
          />
        </Box>
        <ChoiceRow
          label={`${t('writing.typography.lineHeight')}`}
          value={typoConfig.lineHeight}
          options={[1.6, 1.9, 2.2].map((v) => ({ id: v, label: String(v) }))}
          onChange={(v) => setTypoConfig({ lineHeight: Number(v) })}
        />
        <ChoiceRow
          label={t('writing.typography.paper')}
          value={typoConfig.paper}
          options={paperOptions}
          onChange={(v) => setTypoConfig({ paper: v as 'default' | 'sepia' | 'green' })}
        />
        <Divider sx={{ my: 1.5 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
          {t('settings.writingPrefs')}
        </Typography>
        <ChoiceRow
          label={t('settings.deskFocusMode')}
          value={writingPrefs.focusMode}
          options={focusOptions}
          onChange={(v) => setFocusMode(v as 'normal' | 'focus' | 'zen')}
        />
        <ChoiceRow
          label={t('settings.typewriterScroll')}
          value={writingPrefs.typewriterScroll}
          options={typewriterOptions}
          onChange={(v) => setTypewriterScroll(v as 'off' | 'zen' | 'always')}
        />
        <ChoiceRow
          label={t('settings.saveCadence')}
          value={writingPrefs.saveCadence}
          options={cadenceOptions}
          onChange={(v) => setSaveCadence(v as 'fast' | 'standard' | 'steady')}
        />
      </Box>

      {/* 落盘状态：与主抽屉同口径的四态读数。写作台里改的是「自动保存节奏」这类要命的档位，
          写库失败却看不见的话，关掉窗口才发现没记住 —— 第二十轮在抽屉里修的病灶不能在这边重演。 */}
      <Box
        sx={{
          p: 1.5,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexShrink: 0,
        }}
      >
        {syncState.status === 'failed' ? (
          <>
            <Typography
              variant="caption"
              color="warning.main"
              data-testid="desk-sync-status"
              sx={{ lineHeight: 1.4, minWidth: 0 }}
            >
              <SyncProblemIcon sx={{ fontSize: uiFontSize(14), verticalAlign: '-2px', mr: 0.5 }} />
              {t('settings.syncFailedNote')}
            </Typography>
            <Button
              size="small"
              onClick={retryFailedWrites}
              data-testid="desk-sync-retry"
              sx={{ textTransform: 'none', fontSize: uiFontSize(11), flexShrink: 0 }}
            >
              {t('settings.syncRetry')}
            </Button>
          </>
        ) : syncState.status === 'pending' ? (
          <Typography variant="caption" color="text.secondary" data-testid="desk-sync-status">
            <SyncIcon sx={{ fontSize: uiFontSize(13), verticalAlign: '-2px', mr: 0.5 }} />
            {t('settings.syncPendingNote')}
          </Typography>
        ) : syncState.status === 'saved' ? (
          <Typography variant="caption" color="text.secondary" data-testid="desk-sync-status">
            <CloudDoneIcon sx={{ fontSize: uiFontSize(13), verticalAlign: '-2px', mr: 0.5, color: 'success.main' }} />
            {t('settings.syncSavedNote', { time: lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : '' })}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" data-testid="desk-sync-status">
            {t('settings.autoSaveNote')}
          </Typography>
        )}
        <Button
          size="small"
          onClick={onClose}
          data-testid="desk-settings-close"
          sx={{ textTransform: 'none', fontSize: uiFontSize(12), flexShrink: 0 }}
        >
          {t('settings.close')}
        </Button>
      </Box>
    </Drawer>
  );
}

/**
 * 写作台独立窗口的设置宿主：入口按钮 + 面板。
 *
 * 禅模式下连入口按钮一起收起 —— 这一档的全部意义就是「除了字什么都别在屏幕上」，
 * 浮一颗齿轮进去等于把它自己否掉了。⌘, 仍然可用（那是用户主动按键，不是我们塞的浮层）。
 */
export function WritingDeskSettingsHost() {
  const open = useSettingsPanelStore((s) => s.open);
  const setOpen = useSettingsPanelStore((s) => s.setOpen);
  const focusMode = useWritingPrefsStore((s) => s.config.focusMode);
  const handleClose = useCallback(() => setOpen(false), [setOpen]);
  if (focusMode === 'zen' && !open) return null;
  return (
    <>
      <Tooltip title={t('settings.deskOpenSettings', { shortcut: settingsShortcutLabel() })} arrow>
        <Fab
          size="small"
          onClick={() => setOpen(true)}
          data-testid="desk-settings-open"
          aria-label={t('settings.deskOpenSettings', { shortcut: settingsShortcutLabel() })}
          sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1100 }}
        >
          <SettingsRoundedIcon />
        </Fab>
      </Tooltip>
      <DeskSettingsPanel open={open} onClose={handleClose} />
    </>
  );
}
