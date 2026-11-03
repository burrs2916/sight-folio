// 设置抽屉界面层回归锁（2026-11-02，第十九轮）
//
// 第十八轮把设置抽屉扩到 890+ 行后，界面层还缺三条「看得见」的保证，本轮补齐并锁住：
//  ① 新增的「界面语言」章节：可见、可点、点完 store 与 i18n 同时变（顶栏按钮与抽屉同源）；
//  ② 「恢复默认」按钮声称含正文排版，界面点一次就要真的三项都复位；
//  ③ 带正文排版的预设卡片要标出来，创作者才能在卡片上看出「点它会连正文一起换」。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useLanguageStore } from '../../store/languageStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { getLang, setLang, t } from '../../i18n';

const { kv } = vi.hoisted(() => ({ kv: new Map<string, string>() }));

// 界面层只关心「点了之后状态对不对」，落盘走内存 KV，避免测试环境里刷一屏 IPC 失败日志
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

function renderDrawer() {
  return render(
    <AppTheme>
      <SettingsDrawer open onClose={() => {}} />
    </AppTheme>,
  );
}

function expandAppearanceSection() {
  const summary = screen.getByTestId('appearance-preset-summary');
  fireEvent.click(summary);
}

beforeEach(() => {
  cleanup();
  kv.clear();
  setLang('zh-CN');
  useThemeStore.getState().resetConfig();
  useLayoutStore.getState().resetLayout();
  useTypographyDefaultsStore.getState().reset();
  useLanguageStore.setState({ lang: 'zh-CN', initialized: true });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
});

describe('设置抽屉 · 界面语言章节', () => {
  it('章节里能看到中英文两个档位，当前语言处于选中态', () => {
    renderDrawer();

    const zh = screen.getByRole('button', { name: /简体中文/ });
    const en = screen.getByRole('button', { name: /English/ });
    expect(zh.getAttribute('aria-pressed')).toBe('true');
    expect(en.getAttribute('aria-pressed')).toBe('false');
  });

  it('点 English 后 i18n 与 store 同时切过去（顶栏按钮读数一致）', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: /English/ }));

    expect(useLanguageStore.getState().lang).toBe('en-US');
    expect(getLang()).toBe('en-US');
    // 抽屉自身文案也跟着换语言，说明这一项是真的生效而非只改了个字段
    expect(screen.queryByText(t('settings.language'))).toBeTruthy();
  });

  it('语言写进设置库（键 language），重开仍是它', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /English/ }));
    await new Promise((r) => setTimeout(r, 0));

    expect(kv.get('language')).toBe('en-US');
  });
});

describe('设置抽屉 · 恢复默认覆盖三项', () => {
  it('点「恢复默认」先要二次确认，确认后才把主题 / 布局 / 正文排版一起复位', () => {
    useThemeStore.getState().setPreset('green');
    useLayoutStore.getState().setContentPadding('large');
    useTypographyDefaultsStore.getState().setConfig({ fontSize: 21, lineHeight: 2.4, paper: 'sepia' });
    renderDrawer();

    // 用 testid 而不是按钮名：MUI Modal 打开时会给兄弟 portal（设置抽屉本身）挂 aria-hidden，
    // 那时 getByRole 在可访问性树里就找不到抽屉里的按钮了 —— 这是测试工具口径，不是界面坏了。
    fireEvent.click(screen.getByTestId('settings-reset-all'));

    // 第二十一轮：一键复位三个域属于「误点成本高」的动作，第一下只弹确认，不许当场改数据
    expect(useThemeStore.getState().config.preset).toBe('green');
    expect(useLayoutStore.getState().config.contentPadding).toBe('large');
    expect(useTypographyDefaultsStore.getState().config.paper).toBe('sepia');

    // 取消 = 什么都没发生，这是这次确认框存在的唯一理由
    fireEvent.click(screen.getByTestId('settings-reset-cancel'));
    expect(useThemeStore.getState().config.preset).toBe('green');
    expect(useTypographyDefaultsStore.getState().config.paper).toBe('sepia');

    fireEvent.click(screen.getByTestId('settings-reset-all'));
    fireEvent.click(screen.getByTestId('settings-reset-confirm'));

    expect(useThemeStore.getState().config.preset).toBe('default');
    expect(useLayoutStore.getState().config.contentPadding).toBe('medium');
    expect(useTypographyDefaultsStore.getState().config).toEqual(DEFAULT_TYPOGRAPHY);
  });
});

describe('设置抽屉 · 预设卡片标注', () => {
  it('内置预设不标注「含正文排版」，自定义带排版的预设标注出来', () => {
    useTypographyDefaultsStore.getState().setConfig({ ...DEFAULT_TYPOGRAPHY, fontSize: 19 });
    useAppearanceStore.setState({ profiles: [...BUILT_IN_PROFILES] });
    const id = useAppearanceStore.getState().saveCurrentAsProfile('我的稿纸');
    renderDrawer();
    expandAppearanceSection();

    expect(screen.getByTestId(`appearance-typography-tag-${id}`)).toBeTruthy();
    expect(screen.queryByTestId('appearance-typography-tag-office')).toBeNull();
  });
});
