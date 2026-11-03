// 设置抽屉 · 写作偏好章节回归锁（2026-11-02，第二十五轮）
//
// 为什么单独一份：第廿四轮新增的写作偏好域在**界面上完全不存在** —— store、落盘、跨窗口链路
// 都齐了，抽屉里却没有入口，用户唯一能改到它的路径是去改设置库文件。本轮补上章节，
// 这里从「点得动 → 读数变 → 真落库」三段全部走一遍，顺带锁住英文包不缺文案、
// 以及「恢复默认」的说明真的覆盖到第四域（文案与实现一致是本仓抽屉的铁律）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useWritingPrefsStore, DEFAULT_WRITING_PREFS, WRITING_PREFS_SETTINGS_KEY } from '../../store/writingPrefsStore';
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

/** 等 fire-and-forget 的写入链跑完 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function renderDrawer() {
  return render(
    <AppTheme>
      <SettingsDrawer open onClose={() => {}} />
    </AppTheme>,
  );
}

/** 写作偏好章节默认收起（抽屉已有六章默认展开，再摊开会让人找不到重点） */
function expandWritingSection() {
  const summary = screen.getByTestId('writing-prefs-summary');
  expect(summary.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(summary);
  expect(summary.getAttribute('aria-expanded')).toBe('true');
}

beforeEach(() => {
  cleanup();
  kv.clear();
  setLang('zh-CN');
  useThemeStore.setState({
    config: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    systemMode: 'light',
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

// 同 SettingsDrawerRound28：抽屉整体渲染在全量并发下超 5s 默认预算（第 31 轮待办 5 点名，
// 第 33 轮兑现）。抬的是时间预算，不是判据 —— 断言未动，真挂照样红。
const DRAWER_TEST = { timeout: 20_000 };

describe('设置抽屉 · 写作偏好章节', DRAWER_TEST, () => {
  it('九个档位全部渲染（专注模式 3 + 打字机滚动 3 + 保存节奏 3）', () => {
    renderDrawer();
    expandWritingSection();
    for (const id of ['normal', 'focus', 'zen']) {
      expect(screen.getByTestId(`settings-desk-focus-${id}`), `专注模式 ${id} 档没渲染`).toBeTruthy();
    }
    for (const id of ['off', 'zen', 'always']) {
      expect(screen.getByTestId(`settings-typewriter-${id}`), `打字机滚动 ${id} 档没渲染`).toBeTruthy();
    }
    for (const id of ['fast', 'standard', 'steady']) {
      expect(screen.getByTestId(`settings-save-cadence-${id}`), `保存节奏 ${id} 档没渲染`).toBeTruthy();
    }
  });

  it('当前档位按 store 现值高亮，不是永远选中第一档', () => {
    useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS, saveCadence: 'steady' } });
    renderDrawer();
    expandWritingSection();
    expect(screen.getByTestId('settings-save-cadence-steady').className).toContain('Mui-selected');
    expect(screen.getByTestId('settings-save-cadence-fast').className).not.toContain('Mui-selected');
  });

  it('点「禅模式」当场改读数并写进设置库（即时生效 + 即时落盘，无保存按钮）', async () => {
    renderDrawer();
    expandWritingSection();
    fireEvent.click(screen.getByTestId('settings-desk-focus-zen'));
    expect(useWritingPrefsStore.getState().config.focusMode).toBe('zen');
    await settle();
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY)!).focusMode).toBe('zen');
  });

  it('打字机滚动与保存节奏同样落库；节奏档位标注真实毫秒数', async () => {
    renderDrawer();
    expandWritingSection();
    fireEvent.click(screen.getByTestId('settings-typewriter-always'));
    fireEvent.click(screen.getByTestId('settings-save-cadence-fast'));
    expect(useWritingPrefsStore.getState().config).toMatchObject({ typewriterScroll: 'always', saveCadence: 'fast' });
    // 档位上写着真实毫秒：让人知道「快」到底是多久
    expect(screen.getByTestId('settings-save-cadence-fast').textContent).toContain('400ms');
    await settle();
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY)!)).toMatchObject({
      typewriterScroll: 'always',
      saveCadence: 'fast',
    });
  });

  it('英文界面下这一章不缺文案（双包同批加 key，缺一边就是一句中文挂在英文界面上）', () => {
    setLang('en-US');
    renderDrawer();
    expandWritingSection();
    expect(screen.getByText(t('settings.deskFocusMode'))).toBeTruthy();
    expect(screen.getByText(t('settings.typewriterScroll'))).toBeTruthy();
    expect(screen.getByTestId('settings-desk-focus-zen').textContent).toBe(t('settings.deskFocusZen'));
    setLang('zh-CN');
  });
});

describe('设置抽屉 · 恢复默认覆盖到写作偏好', DRAWER_TEST, () => {
  it('确认弹窗列出四项（含写作偏好），确认后这一域真的回到缺省档并落库', async () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    useWritingPrefsStore.getState().setSaveCadence('steady');
    await settle();
    renderDrawer();

    fireEvent.click(screen.getByTestId('settings-reset-all'));
    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain(t('settings.resetConfirmWriting'));

    fireEvent.click(screen.getByTestId('settings-reset-confirm'));
    await settle();
    expect(useWritingPrefsStore.getState().config).toEqual({ ...DEFAULT_WRITING_PREFS });
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY)!)).toEqual({ ...DEFAULT_WRITING_PREFS });
  });
});
