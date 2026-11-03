// 第三十六轮 · 设置抽屉里的「代码编辑器字号」那一行
//
// 这一维此前**在设置界面上根本不存在**：只能去代码工作台状态栏调，而且调完只写 localStorage。
// 于是用户的三条体感同时成立 —— 「设置里没这个」「恢复默认没生效」「换设备/重装就没了」。
// 本轮把它接进抽屉，并且每一例都验到设置库那一层：界面读数对一次不算数，落进库才算「记住了」。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore, THEME_SETTINGS_KEY } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useWritingPrefsStore, DEFAULT_WRITING_PREFS } from '../../store/writingPrefsStore';
import { useLanguageStore } from '../../store/languageStore';
import { useSettingsSyncStore } from '../../store/settingsSyncStore';
import { useSettingsHealthStore } from '../../store/settingsHealthStore';
import { useBookTypographyStore } from '../../store/bookTypographyStore';
import { useWritingStore } from '../../store/writingStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { CODE_FONT_ZOOM_MAX, CODE_FONT_ZOOM_MIN, codeFontSizeWithZoom } from '../../theme/appearanceScales';
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

/** 设置库里真正落下的那一维（界面读数只对一次，落库的读数才算「记住了」） */
function dbZoom(): number | undefined {
  const raw = kv.get(THEME_SETTINGS_KEY);
  if (!raw) return undefined;
  return (JSON.parse(raw) as { codeFontZoom?: number }).codeFontZoom;
}

const zoomButton = (which: 'minus' | 'plus' | 'reset') =>
  screen.getByTestId(`code-font-zoom-${which}`) as HTMLButtonElement;
const pxReadout = () => screen.getByTestId('settings-code-font-px');
/** 只改内存的夹具（验按钮禁用态这类「界面判据」用它就够） */
const setZoom = (zoom: number) =>
  useThemeStore.setState({ config: { ...useThemeStore.getState().config, codeFontZoom: zoom } });
/**
 * 走真实写入口的夹具：先让库里也有这一维。
 * 用 setState 当「已有微调」的夹具会让下面 `dbZoom()` 那类断言假红 —— setState 绕过了 persist，
 * 库里根本没写过，本轮要证的恰恰是「它到底有没有落库」。
 */
async function primeZoom(zoom: number) {
  useThemeStore.getState().setCodeFontZoom(zoom);
  await settle();
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
      codeFontZoom: 0,
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
  useWritingStore.setState({ books: [] as never });
});

describe('抽屉 · 代码字号那一行的读数', () => {
  it('显示的是真正喂给 Monaco 的那一个数，不是档位基准的副本', () => {
    renderDrawer();
    // medium 档 0 步 = 13px：与迁移前状态栏显示的值逐像素一致（老用户看不出改动）
    expect(pxReadout().textContent).toBe(`${codeFontSizeWithZoom('editor', 'medium', 0)}px`);
    expect(pxReadout().textContent).toBe('13px');
  });

  it('档位切到「大」时这一行跟着走（与档位同源，不是第二套独立字号）', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('font-size-large'));
    expect(pxReadout().textContent).toBe(`${codeFontSizeWithZoom('editor', 'large', 0)}px`);
  });

  it('已有微调时读数 = 基准 + 步数，提示里同时报出基准与步数', () => {
    setZoom(2);
    renderDrawer();
    expect(pxReadout().textContent).toBe('15px');
    // 提示那句必须把「基准 13 / +2 步」都说清：只报最终值，用户不知道该按几下回到原样
    expect(document.body.textContent).toContain('13');
    expect(document.body.textContent).toContain('+2');
  });
});

describe('抽屉 · 加减按钮真的改到设置库', () => {
  it('点 + 一步 → 内存与设置库同时跟上', async () => {
    renderDrawer();
    fireEvent.click(zoomButton('plus'));
    await settle();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(1);
    expect(dbZoom()).toBe(1);
    expect(pxReadout().textContent).toBe('14px');
  });

  it('点 − 一步 → 负步数也照样落库', async () => {
    renderDrawer();
    fireEvent.click(zoomButton('minus'));
    await settle();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(-1);
    expect(dbZoom()).toBe(-1);
    expect(pxReadout().textContent).toBe('12px');
  });

  it('连点 3 次 + 就是 +3（每一步都写库，不是只有最后一次算）', async () => {
    renderDrawer();
    for (let i = 0; i < 3; i++) fireEvent.click(zoomButton('plus'));
    await settle();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(3);
    expect(dbZoom()).toBe(3);
  });

  it('到端点就禁用按钮，硬点也不会越界写库', async () => {
    await primeZoom(CODE_FONT_ZOOM_MAX);
    renderDrawer();
    expect(zoomButton('plus').disabled).toBe(true);
    fireEvent.click(zoomButton('plus'));
    await settle();
    expect(dbZoom()).toBe(CODE_FONT_ZOOM_MAX);
  });

  it('最小端同理：− 禁用，复位可用', () => {
    setZoom(CODE_FONT_ZOOM_MIN);
    renderDrawer();
    expect(zoomButton('minus').disabled).toBe(true);
    expect(zoomButton('plus').disabled).toBe(false);
  });

  it('复位回到档位基准；本来就在基准时它是禁用的（不给一个按了没反应的按钮）', async () => {
    setZoom(4);
    renderDrawer();
    expect(zoomButton('reset').disabled).toBe(false);

    fireEvent.click(zoomButton('reset'));
    await settle();
    expect(useThemeStore.getState().config.codeFontZoom).toBe(0);
    expect(dbZoom()).toBe(0);
    expect(pxReadout().textContent).toBe('13px');
    expect(zoomButton('reset').disabled).toBe(true);
  });
});

describe('抽屉 · 状态一致（这一维算不算「已微调」）', () => {
  it('只改了代码微调 ⇒ 字体大小这一章标出「已微调」', () => {
    setZoom(1);
    renderDrawer();
    expect(screen.getByTestId('settings-tuned-fontSize')).toBeTruthy();
  });

  it('一切默认 ⇒ 不标（误标会让人以为自己有哪儿没设好）', () => {
    renderDrawer();
    expect(screen.queryByTestId('settings-tuned-fontSize')).toBeNull();
  });

  it('走界面那条路点「恢复默认设置」⇒ 这一维一起归零（文案与覆盖面终于一致）', async () => {
    await primeZoom(5);
    renderDrawer();
    expect(dbZoom()).toBe(5);

    fireEvent.click(screen.getByTestId('settings-reset-all'));
    fireEvent.click(screen.getByTestId('settings-reset-confirm'));
    await settle();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(0);
    expect(dbZoom()).toBe(0);
  });
});

describe('抽屉 · 双语与可发现性', () => {
  it('英文界面用英文包（这一行不能只有中文才有）', () => {
    setLang('en-US');
    renderDrawer();
    expect(document.body.textContent).toContain('Code editor font size');
    setLang('zh-CN');
  });

  it('搜「代码」能翻到这一章（住在字体大小章节里，搜不到 = 等于没有）', () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: '代码' } });
    expect(screen.getByTestId('settings-section-fontSize')).toBeTruthy();
    expect(pxReadout()).toBeTruthy();
  });

  it('搜一个不相关的词时这一章整块收起（证明过滤真在起作用，不是摆设）', () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'zzz-no-such-thing' } });
    expect(screen.queryByTestId('settings-section-fontSize')).toBeNull();
  });
});
