// 第二十八轮 · 第 27 轮两个新控件的抽屉接线锁（待办 1 的 ①③ UI 侧）
//
// store 语义在 appearanceRound28.test.ts，消费点在 settingsRound28.test.ts；这里补的是中间那段
// —— **抽屉里那两颗可点的控件真的接到那条链路**：
//  ① 「连写作偏好一起存」勾选框：默认不勾；勾与不勾分别决定另存出来的卡带不带 writing 字段。
//     （这条 UI 锁不可省：store 支持 options 但 UI 没传，就又回到「能力在界面上不存在」。）
//  ③ 「全出血页遵循布局」开关：翻转即改 layoutStore 并落设置库 —— 与主抽屉其余设置项同一口径。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useWritingPrefsStore, DEFAULT_WRITING_PREFS } from '../../store/writingPrefsStore';
import { useLanguageStore } from '../../store/languageStore';
import { useSettingsSyncStore } from '../../store/settingsSyncStore';
import { useSettingsHealthStore } from '../../store/settingsHealthStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { setLang, t } from '../../i18n';

const { kv } = vi.hoisted(() => ({ kv: new Map<string, string>() }));
vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.set(key, value);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
  },
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function renderDrawer() {
  return render(
    <AppTheme>
      <SettingsDrawer open onClose={() => {}} />
    </AppTheme>,
  );
}

beforeEach(() => {
  cleanup();
  kv.clear();
  setLang('zh-CN');
  useThemeStore.setState({
    config: {
      mode: 'system',
      preset: 'default',
      fontSize: 'medium',
      borderRadius: 'medium',
      motion: 'auto',
      uiFont: 'system',
    },
    systemMode: 'light',
    systemReducedMotion: false,
    initialized: true,
  });
  useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT_CONFIG }, initialized: true });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
  useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS }, initialized: true });
  useLanguageStore.setState({ lang: 'zh-CN', initialized: true });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
  useSettingsSyncStore.getState().reset();
  useSettingsHealthStore.getState().reset();
});

// 抽屉整体渲染的 jsdom 用例在**全量并发**下会超过 5s 默认预算（单跑同一用例约 1.4s，
// 228 文件同跑时 CPU 争用把它顶过线 —— 第 33 轮全量门禁实测 2 例超时、单跑 5/5 绿）。
// 这里抬高的是**时间预算**，不是判据：断言一条没松，慢用例照样超时照样红。
// 口径出自第 31 轮待办 5（同类问题第 25 轮文件已点名一次）。
const DRAWER_TEST = { timeout: 20_000 };

describe('抽屉 · 「连写作偏好一起存」勾选框（第 25 轮待办 1 的 UI 面）', DRAWER_TEST, () => {
  const checkbox = () =>
    screen.getByRole('checkbox', { name: new RegExp(t('settings.presetIncludeWriting')) }) as HTMLInputElement;

  it('默认不勾 —— 「点预设不该顺手切禅模式」要在界面上看得见，而不只是代码口径', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('appearance-preset-summary'));
    expect(checkbox().checked).toBe(false);
  });

  it('不勾另存：新卡不带写作偏好（点了不会切禅模式）', async () => {
    useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS, focusMode: 'zen' } });
    renderDrawer();
    fireEvent.click(screen.getByTestId('appearance-preset-summary'));
    fireEvent.click(screen.getByTestId('appearance-save-preset'));
    fireEvent.change(screen.getByPlaceholderText(t('settings.presetNamePlaceholder')), {
      target: { value: '只存外观' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('settings.savePreset') }));
    await settle();
    const card = useAppearanceStore.getState().profiles.find((p) => p.name === '只存外观');
    expect(card).toBeTruthy();
    expect(card!.writing).toBeUndefined();
  });

  it('勾上另存：写作偏好按现值沉淀进卡；点这张卡当场切到那一套写作状态', async () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('appearance-preset-summary'));
    fireEvent.click(screen.getByTestId('appearance-save-preset'));
    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(true);
    useWritingPrefsStore.getState().setFocusMode('zen');
    fireEvent.change(screen.getByPlaceholderText(t('settings.presetNamePlaceholder')), {
      target: { value: '一套夜读' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('settings.savePreset') }));
    await settle();
    const card = useAppearanceStore.getState().profiles.find((p) => p.name === '一套夜读');
    expect(card!.writing).toEqual({ focusMode: 'zen', typewriterScroll: 'zen', saveCadence: 'standard' });

    // 点这张卡 → 禅模式真的落地（抽屉卡片 → applyProfile → writingPrefsStore 一条链路）
    useWritingPrefsStore.getState().setFocusMode('normal');
    fireEvent.click(screen.getByTestId(`appearance-card-${card!.id}`));
    await settle();
    expect(useWritingPrefsStore.getState().config.focusMode).toBe('zen');
  });
});

describe('抽屉 · 「全出血页遵循布局」开关（第 26 轮待办 1 的 UI 面）', DRAWER_TEST, () => {
  const fullBleedSwitch = () =>
    screen.getByRole('switch', { name: new RegExp(t('settings.fullBleedFollowsLayout')) }) as HTMLInputElement;

  it('默认关（三页无边距的既成事实）；打开即落 layoutStore 并写设置库', async () => {
    renderDrawer();
    // layoutDensity 是默认展开的章节 —— 别再点 summary，点下去反而收起来了
    expect(fullBleedSwitch().checked).toBe(false);

    fireEvent.click(fullBleedSwitch());
    await settle();
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(true);
    expect(JSON.parse(kv.get('layout')!).fullBleedFollowsLayout).toBe(true);

    fireEvent.click(fullBleedSwitch());
    await settle();
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(false);
    expect(JSON.parse(kv.get('layout')!).fullBleedFollowsLayout).toBe(false);
  });

  it('开关旁边挂着说实话的提示（哪三页、跟随哪两档），而不是光秃一颗开关', () => {
    renderDrawer();
    const hint = screen.getByText(t('settings.fullBleedFollowsLayoutHint'));
    expect(hint).toBeTruthy();
  });
});
