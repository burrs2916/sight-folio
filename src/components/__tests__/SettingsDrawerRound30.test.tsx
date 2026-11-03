// 第三十轮 P1 · 抽屉与写作台排版面板上的「书级覆盖」行为锁
//
// 与 bookTypographyRound30.test.ts 的分工：那份锁的是**链路是否齐**（6 件套逐项），
// 这份锁的是**界面行为**：计数是不是真的读数、二次确认是不是真拦一道、
// 「让本书跟随默认」按下去是不是真清掉并落库。
// 病灶口径：这一域此前在设置里既看不见也清不掉（只能逐本书逐字段手动改回去），
// 「设置不完整」在界面上的表现就是这两句。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { TypographyPopover } from '../../pages/writingPage/TypographyPopover';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useWritingPrefsStore, DEFAULT_WRITING_PREFS } from '../../store/writingPrefsStore';
import { useLanguageStore } from '../../store/languageStore';
import { useSettingsSyncStore } from '../../store/settingsSyncStore';
import { useSettingsHealthStore } from '../../store/settingsHealthStore';
import { useBookTypographyStore, BOOK_TYPOGRAPHY_SETTINGS_KEY } from '../../store/bookTypographyStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { setLang } from '../../i18n';

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
  useBookTypographyStore.getState().reset();
});

describe('设置抽屉 · 书级排版覆盖', () => {
  it('没有书单独调过时说实话「全部跟随默认」，且不画那颗清理按钮', () => {
    renderDrawer();
    const count = screen.getByTestId('settings-book-typography-count');
    expect(count.textContent).toContain('还没有书单独调过排版');
    expect(screen.queryByTestId('settings-book-typography-clear')).toBeNull();
  });

  it('有书单独调过时给出真实本数，并标出「本章有非默认值」（默认值没动过也算）', () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20 }, 'book-b': { paper: 'sepia' } });
    renderDrawer();
    expect(screen.getByTestId('settings-book-typography-count').textContent).toContain('2');
    expect(screen.getByTestId('settings-tuned-bodyTypography')).toBeTruthy();
  });

  it('「全部收回跟随默认」第一下只进确认态，第二下才真清并落库（有代价的动作不能一点就动）', async () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20 } });
    renderDrawer();
    fireEvent.click(screen.getByTestId('settings-book-typography-clear'));
    // 第一下：表还在，且出现了取消出口
    expect(Object.keys(useBookTypographyStore.getState().overrides)).toHaveLength(1);
    expect(screen.getByTestId('settings-book-typography-clear-cancel')).toBeTruthy();
    // 第二下：真清掉，并写进设置库（不是只清内存）
    fireEvent.click(screen.getByTestId('settings-book-typography-clear'));
    await settle();
    expect(Object.keys(useBookTypographyStore.getState().overrides)).toHaveLength(0);
    expect(JSON.parse(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!)).toMatchObject({ version: 1, overrides: {} });
  });

  it('取消按钮退回未确认态，什么都不清', () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20 } });
    renderDrawer();
    fireEvent.click(screen.getByTestId('settings-book-typography-clear'));
    fireEvent.click(screen.getByTestId('settings-book-typography-clear-cancel'));
    expect(Object.keys(useBookTypographyStore.getState().overrides)).toHaveLength(1);
  });

  it('恢复默认弹窗说明边界：书级覆盖不归这颗按钮管', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('settings-reset-all'));
    expect(screen.getByTestId('settings-reset-book-note').textContent).toContain('单独调过的排版');
  });
});

describe('写作台排版面板 · 覆盖状态与跟随默认出口', () => {
  const anchor = document.createElement('button');

  it('完全跟随默认时说「跟随默认」，不画清理入口', () => {
    render(
      <AppTheme>
        <TypographyPopover
          anchorEl={anchor}
          onClose={() => {}}
          typo={{ ...DEFAULT_TYPOGRAPHY }}
          onChange={() => {}}
          overrideFieldCount={0}
        />
      </AppTheme>,
    );
    expect(screen.getByTestId('typography-override-state').textContent).toContain('跟随');
    expect(screen.queryByTestId('typography-follow-default')).toBeNull();
  });

  it('调过的项数写在面板上，并给一次「让本书跟随默认」的动作', () => {
    const onFollowDefault = vi.fn();
    render(
      <AppTheme>
        <TypographyPopover
          anchorEl={anchor}
          onClose={() => {}}
          typo={{ ...DEFAULT_TYPOGRAPHY, fontSize: 20 }}
          onChange={() => {}}
          overrideFieldCount={2}
          onFollowDefault={onFollowDefault}
        />
      </AppTheme>,
    );
    expect(screen.getByTestId('typography-override-state').textContent).toContain('2');
    fireEvent.click(screen.getByTestId('typography-follow-default'));
    expect(onFollowDefault).toHaveBeenCalledTimes(1);
  });

  it('没选作品时说实话「不会保存」—— 不能让人以为调完就存住了', () => {
    render(
      <AppTheme>
        <TypographyPopover
          anchorEl={anchor}
          onClose={() => {}}
          typo={{ ...DEFAULT_TYPOGRAPHY }}
          onChange={() => {}}
          canOverride={false}
        />
      </AppTheme>,
    );
    expect(screen.getByTestId('typography-no-book-hint')).toBeTruthy();
  });
});
