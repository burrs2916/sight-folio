// 设置抽屉 · 搜索定位与「已微调」标记（2026-11-02，第二十六轮，落第 25 轮待办 3）
//
// 为什么值得单独一份：抽屉已经 12 个章节，之前找设置项只能滚动翻，而且**除布局与外观预设外
// 没有任何地方能看出「这一章被改过」** —— 用户改完字号关掉抽屉，下次进来无从判断现状。
// 这里同时锁住三件容易回潮的事：
//  ① 章节标题与搜索关键词只有 getSectionIndex 那一份来源（不许两处各写文案）；
//  ② 「已微调」的判据必须走各 store 的 isXxxDefault / isConfigMatchingPreset，不许在组件里现拼；
//  ③ 界面字号档位真的落到样式表里（不是只改了 store 读数）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { matchesSectionQuery } from '../layout/settingsOptions';
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
import { FONT_SIZE_BASE } from '../../theme/appearanceScales';

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

const searchBox = () => screen.getByTestId('settings-search');

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

describe('设置抽屉 · 搜索定位', () => {
  it('命中档位关键词时只显示该章节，并自动展开（找到还要人手点开等于没找到）', () => {
    renderDrawer();
    fireEvent.change(searchBox(), { target: { value: t('settings.typewriterScroll') } });
    // 写作偏好章节：命中 + 展开
    const summary = screen.getByTestId('writing-prefs-summary');
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    // 未命中的章节整体不渲染（不是藏起来，是压根不在 DOM 里）
    expect(screen.queryByTestId('settings-section-language')).toBeNull();
    expect(screen.queryByTestId('settings-section-bodyTypography')).toBeNull();
  });

  it('命中计数是真实读数：搜「圆角」只命中一章', () => {
    renderDrawer();
    fireEvent.change(searchBox(), { target: { value: t('settings.borderRadius') } });
    expect(screen.getByTestId('settings-search-result').textContent).toBe('1');
    expect(screen.getByTestId('settings-section-borderRadius')).toBeTruthy();
  });

  it('一个都没命中时给空态与换词提示，而不是留一片看起来像加载失败的面板', () => {
    renderDrawer();
    fireEvent.change(searchBox(), { target: { value: 'zzz-不存在-xyz' } });
    expect(screen.getByTestId('settings-search-result').textContent).toContain(t('settings.searchEmpty'));
    expect(document.querySelector('.MuiAccordion-root')).toBeNull();
  });

  it('清空搜索后所有章节回来，且保留用户自己的折叠状态', () => {
    renderDrawer();
    const body = screen.getByTestId('settings-section-bodyTypography');
    expect(body.getAttribute('aria-expanded')).toBe('false'); // 默认收起
    fireEvent.click(body);
    expect(body.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(searchBox(), { target: { value: '禅' } });
    fireEvent.click(screen.getByTestId('settings-search-clear'));
    expect(screen.getByTestId('settings-section-bodyTypography').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('settings-section-language')).toBeTruthy();
  });

  it('关键词跟着界面语言走：英文界面下搜中文档位名不再「搜不到」', () => {
    renderDrawer();
    // 先切语言（抽屉订阅全局语言，重渲染后关键词是英文那份）
    useLanguageStore.getState().setLanguage('en-US');
    fireEvent.change(searchBox(), { target: { value: 'typewriter' } });
    expect(screen.queryByTestId('writing-prefs-summary')).toBeTruthy();
    useLanguageStore.getState().setLanguage('zh-CN');
  });
});

describe('matchesSectionQuery（标题 + 档位关键词）', () => {
  it('空查询恒命中；大小写与首尾空白不敏感', () => {
    expect(matchesSectionQuery('   ', '布局与密度', ['顶栏'])).toBe(true);
    // 关键词里带上语言中立的档位 id（getSectionIndex 正是这么写的），英文界面下也能搜到
    expect(matchesSectionQuery(' Zen ', '写作偏好', ['禅模式', 'zen'])).toBe(true);
    expect(matchesSectionQuery('typewriter', '写作偏好', ['打字机滚动'])).toBe(false);
  });
});

describe('设置抽屉 · 「已微调」标记', () => {
  it('全是默认值时一章都不标', () => {
    renderDrawer();
    expect(document.querySelectorAll('.MuiChip-colorWarning').length).toBe(0);
  });

  it('改一项只标对应那一章，恢复默认后标记消失', async () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('font-size-large'));
    await settle();
    expect(screen.getByTestId('settings-tuned-fontSize')).toBeTruthy();
    expect(screen.queryByTestId('settings-tuned-colorMode')).toBeNull();
    expect(useThemeStore.getState().config.fontSize).toBe('large');

    useAppearanceStore.getState().resetAll();
    await settle();
    expect(screen.queryByTestId('settings-tuned-fontSize')).toBeNull();
  });

  it('布局单项微调同样被标出来（此前只有布局章节内部有小字提示，折叠状态下看不见）', () => {
    useLayoutStore.getState().setNavbarStyle('slim');
    renderDrawer();
    expect(screen.getByTestId('settings-tuned-layoutDensity')).toBeTruthy();
  });

  it('写作偏好 / 正文排版各标各章', () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    useTypographyDefaultsStore.getState().setConfig({ paper: 'sepia' });
    renderDrawer();
    expect(screen.getByTestId('settings-tuned-writingPrefs')).toBeTruthy();
    expect(screen.getByTestId('settings-tuned-bodyTypography')).toBeTruthy();
  });

  it('恢复默认确认弹窗：四项都还是默认值时说实话，不再假装「点了会变回去」', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('settings-reset-all'));
    expect(screen.getByTestId('settings-reset-nothing-tuned')).toBeTruthy();
    fireEvent.click(screen.getByTestId('settings-reset-cancel'));

    fireEvent.click(screen.getByTestId('settings-reset-all'));
    useThemeStore.getState().setFontSize('small');
    fireEvent.click(screen.getByTestId('settings-reset-cancel'));
    expect(screen.queryByTestId('settings-reset-nothing-tuned')).toBeNull();
  });
});

describe('界面字号档位真的写进样式表（不只是改了 store 读数）', () => {
  it('AppTheme 按档位写 --app-font-scale，档位换值当场变', () => {
    const { rerender } = render(
      <AppTheme config={{ mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium' }}>
        <div />
      </AppTheme>,
    );
    expect(parseFloat(document.documentElement.style.getPropertyValue('--app-font-scale'))).toBe(1);
    rerender(
      <AppTheme config={{ mode: 'light', preset: 'default', fontSize: 'large', borderRadius: 'medium' }}>
        <div />
      </AppTheme>,
    );
    const scale = parseFloat(document.documentElement.style.getPropertyValue('--app-font-scale'));
    expect(scale).toBeCloseTo(FONT_SIZE_BASE.large / FONT_SIZE_BASE.medium, 3);
    expect(document.documentElement.style.getPropertyValue('--app-font-size-base')).toBe(`${FONT_SIZE_BASE.large}px`);
  });
});
