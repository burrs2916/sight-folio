// 第二十三轮回归锁 · 界面字体族（新增设置项）+ 主题色板扩充
//
// 用户诉求：「外观预设 / 颜色模式 / 主题色彩 / 字体大小 / 圆角风格 / 布局预设要确保设置完成后
// 生效，关闭软件、启停软件设置不会失效；设置功能还要继续完善扩展」。
//
// 本轮新增的每一项都按同一条口径验收：**档位有单一真源 → 渲染层真的读到 → 落设置库 →
// 重启读回 → 不破坏外观预设的反查**。少任何一环都会退化成历史上反复出现的「只存不读」。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTheme } from '@mui/material/styles';
import AppTheme from '../AppTheme';
import { UI_FONT_OPTIONS, UI_FONT_STACKS, resolveUiFontStack } from '../appearanceScales';
import { UI_FONT_STACK_SYSTEM } from '../themePrimitives';
import { PRESET_ORDER, THEME_PRESETS, getPresetSwatch, buildColorSchemes } from '../themePresets';
import { useThemeStore, normalizeThemeConfig, isSameThemeConfig } from '../../store/themeStore';
import { useAppearanceStore, BUILT_IN_PROFILES } from '../../store/appearanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import type { ThemeConfig, UiFontFamily } from '../../store/themeStore';

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 探针：把主题里真正生效的字体族写到 DOM 上（只有写出来才能证明「注入到了界面」） */
function FontProbe() {
  const theme = useTheme();
  return <div data-testid="font-probe" data-font={theme.typography.fontFamily} />;
}

function cfg(partial: Partial<ThemeConfig>): ThemeConfig {
  return { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium', ...partial };
}

function renderFont(config: ThemeConfig): string {
  const view = render(
    <AppTheme config={config}>
      <FontProbe />
    </AppTheme>,
  );
  const value = screen.getByTestId('font-probe').getAttribute('data-font') ?? '';
  view.unmount();
  return value;
}

beforeEach(() => {
  kv.clear();
  useThemeStore.getState().resetConfig();
  useLayoutStore.getState().resetLayout();
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
});

describe('界面字体档位表（单一真源）', () => {
  it('四档两两不同 —— 存在「切了看不出」的档位就是假设置', () => {
    const stacks = UI_FONT_OPTIONS.map((id) => UI_FONT_STACKS[id]);
    expect(new Set(stacks).size).toBe(UI_FONT_OPTIONS.length);
    for (const stack of stacks) expect(stack.trim().length).toBeGreaterThan(0);
  });

  it('system 档逐字符等于改版前的历史字体栈（老用户升级当天观感不变）', () => {
    expect(UI_FONT_STACKS.system).toBe(UI_FONT_STACK_SYSTEM);
    expect(resolveUiFontStack('system')).toBe(UI_FONT_STACK_SYSTEM);
  });

  it('脏档位与未声明都回落 system，绝不把 undefined 带进渲染层', () => {
    expect(resolveUiFontStack('comic-sans' as UiFontFamily)).toBe(UI_FONT_STACK_SYSTEM);
    expect(resolveUiFontStack(undefined)).toBe(UI_FONT_STACK_SYSTEM);
  });
});

describe('界面字体生效链路（设置抽屉的档位 → MUI 主题 typography.fontFamily）', () => {
  it('每个档位都真的注入到 useTheme()，且档位之间取值不同', () => {
    const seen = new Set<string>();
    for (const id of UI_FONT_OPTIONS) {
      const injected = renderFont(cfg({ uiFont: id }));
      expect(injected, `${id} 档没有注入到主题`).toBe(UI_FONT_STACKS[id]);
      seen.add(injected);
    }
    expect(seen.size).toBe(UI_FONT_OPTIONS.length);
  });

  it('不声明 uiFont 时按 system 档渲染（旧设置库 / 旧外观预设不受影响）', () => {
    expect(renderFont(cfg({}))).toBe(UI_FONT_STACK_SYSTEM);
  });
});


describe('界面字体持久化（关掉软件再打开仍然是那套）', () => {
  it('setUiFont 即时写设置库，init 读回同一档', async () => {
    useThemeStore.getState().setUiFont('serif');
    await flush();
    expect(JSON.parse(kv.get('theme') ?? '{}').uiFont).toBe('serif');

    useThemeStore.setState({ config: cfg({}), initialized: false });
    await useThemeStore.getState().init();
    expect(useThemeStore.getState().config.uiFont).toBe('serif');
  });

  it('库里是脏档位时回落 system，而不是把野值传给字体栈', async () => {
    kv.set('theme', JSON.stringify({ mode: 'light', preset: 'blue', uiFont: 'papyrus' }));
    useThemeStore.setState({ initialized: false });
    await useThemeStore.getState().init();
    expect(useThemeStore.getState().config.uiFont).toBe('system');
  });

  it('归一化与等值判定：未声明与显式 system 是同一生效值（不白重渲染、不误判成改动）', () => {
    expect(normalizeThemeConfig({}).uiFont).toBe('system');
    expect(isSameThemeConfig(cfg({}), cfg({ uiFont: 'system' }))).toBe(true);
    expect(isSameThemeConfig(cfg({ uiFont: 'serif' }), cfg({ uiFont: 'mono' }))).toBe(false);
  });

  it('内置外观预设不声明界面字体：换字族不该把高亮判成「已微调」', () => {
    const office = BUILT_IN_PROFILES.find((p) => p.id === 'office');
    expect(office, '内置 office 预设不见了').toBeTruthy();
    useThemeStore.getState().setConfig({ ...office!.theme, uiFont: 'serif' });
    useLayoutStore.getState().applyConfig(office!.layout);
    useAppearanceStore.getState().detectActiveProfile(
      { ...office!.theme, uiFont: 'serif' },
      useLayoutStore.getState().config,
    );
    const state = useAppearanceStore.getState();
    expect(state.activeProfileId).toBe('office');
    expect(state.isModified, '内置预设本来不管界面字体，换了不该算微调').toBe(false);
  });
});

describe('主题色板扩充（第二十三轮：6 套 → 9 套）', () => {
  const BUILT_IN = PRESET_ORDER.filter((p) => p !== 'custom');

  it('新增的青碧 / 蔷薇 / 石墨都在合法档位里，且有完整明暗两套色板', () => {
    for (const id of ['teal', 'rose', 'slate'] as const) {
      expect(PRESET_ORDER).toContain(id);
      const def = THEME_PRESETS[id];
      expect(def.light.primary.main).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.dark.background.default).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('档位合法值取自 PRESET_ORDER：抽屉能选的一定归一化也认（否则选了会被回落成没选）', () => {
    for (const preset of PRESET_ORDER) {
      expect(normalizeThemeConfig({ preset }).preset).toBe(preset);
    }
  });

  it('新色板的色卡所见 = 生效值，且页面底色随色板变（不是只换主色）', () => {
    for (const id of ['teal', 'rose', 'slate'] as const) {
      expect(getPresetSwatch(id)).toBe(THEME_PRESETS[id].light.primary.main);
      expect(buildColorSchemes(id).light.palette.background.default).toBe(THEME_PRESETS[id].light.background.default);
    }
    // 九套色板互不相同，杜绝「多了一套但和某套一模一样」的凑数档位
    const mains = BUILT_IN.map((p) => buildColorSchemes(p).light.palette.primary.main.toLowerCase());
    expect(new Set(mains).size).toBe(BUILT_IN.length);
  });
});
