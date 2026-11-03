// 外观预设（appearanceStore）回归锁
//
// 覆盖三类风险：
//  1. 预设数量与字段合法性 —— 每个 profile 的枚举取值必须落在 store 支持的集合内；
//  2. 名称/描述可本地化 —— 内置预设存的是 i18n key，两份语言包都必须能解析出真实文本，
//     否则卡片会直接渲染裸 key（历史踩坑）；
//  3. 应用后真实生效 —— applyProfile 必须把「主题 + 布局」按声明落地，且能被
//     detectActiveProfile 反查回同一套预设（否则高亮与实际状态脱节）。
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppearanceStore, BUILT_IN_PROFILES } from '../appearanceStore';
import { useThemeStore } from '../themeStore';
import type { ThemeMode, ThemePreset, FontSize, BorderRadius } from '../themeStore';
import { useLayoutStore, LAYOUT_PRESET_DEFAULTS } from '../layoutStore';
import type { LayoutPreset, SidebarPosition, ContentPadding, NavbarStyle } from '../layoutStore';
import { resolveFragments, setLang } from '../../i18n';

const THEME_PRESETS: ThemePreset[] = ['default', 'blue', 'green', 'orange', 'purple', 'indigo', 'custom'];
const LAYOUT_PRESETS: LayoutPreset[] = ['default', 'compact', 'wide'];
const MODES: ThemeMode[] = ['light', 'dark', 'system'];
const FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];
const RADII: BorderRadius[] = ['none', 'small', 'medium', 'custom'];
const PADDINGS: ContentPadding[] = ['none', 'small', 'medium', 'large'];
const NAVBAR_STYLES: NavbarStyle[] = ['standard', 'slim'];
const POSITIONS: SidebarPosition[] = ['left', 'right'];

function resetState() {
  useThemeStore.getState().resetConfig();
  useLayoutStore.getState().resetLayout();
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
}

beforeEach(() => {
  resetState();
  setLang('zh-CN');
});

describe('内置外观预设 · 数量与字段合法性', () => {
  it('至少提供 12 套预设，且 id 两两不同', () => {
    expect(BUILT_IN_PROFILES.length).toBeGreaterThanOrEqual(12);
    const ids = BUILT_IN_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每套预设的主题/布局字段取值都在支持集合内', () => {
    for (const profile of BUILT_IN_PROFILES) {
      expect(MODES).toContain(profile.theme.mode);
      expect(THEME_PRESETS).toContain(profile.theme.preset);
      expect(FONT_SIZES).toContain(profile.theme.fontSize);
      expect(RADII).toContain(profile.theme.borderRadius);
      expect(LAYOUT_PRESETS).toContain(profile.layout.preset);
      expect(POSITIONS).toContain(profile.layout.sidebarPosition);
      expect(PADDINGS).toContain(profile.layout.contentPadding);
      expect(NAVBAR_STYLES).toContain(profile.layout.navbarStyle);
      expect(typeof profile.layout.sidebarCollapsed).toBe('boolean');
      expect(profile.layout.sidebarWidth).toBeGreaterThan(0);
    }
  });
});

describe('内置外观预设 · 名称与描述可本地化', () => {
  it('zh-CN / en-US 两份语言包都能把 name 与 description 解析为真实文本（不残留裸 key）', () => {
    for (const profile of BUILT_IN_PROFILES) {
      for (const lang of ['zh-CN', 'en-US'] as const) {
        setLang(lang);
        for (const raw of [profile.name, profile.description ?? '']) {
          expect(raw, `${profile.id} 缺少文案`).toBeTruthy();
          const resolved = resolveFragments(raw);
          expect(resolved, `${profile.id} 在 ${lang} 下解析为空`).toBeTruthy();
          // 解析结果必须与原始 key 不同，且不能再残留下任何点分 key 片段
          expect(resolved, `${profile.id} 在 ${lang} 下未翻译，仍是裸 key: ${raw}`).not.toBe(raw);
          expect(resolved).not.toMatch(/appearance\.profile/);
        }
      }
    }
  });

  it('同一套预设的中英文名称确实不同（证明真的走了翻译而非原样返回）', () => {
    for (const profile of BUILT_IN_PROFILES) {
      setLang('zh-CN');
      const zh = resolveFragments(profile.name);
      setLang('en-US');
      const en = resolveFragments(profile.name);
      expect(zh, `${profile.id} 中英文名称相同`).not.toBe(en);
    }
  });
});

describe('内置外观预设 · 覆盖度', () => {
  it('覆盖全部 6 套可选主题色板（default/blue/green/orange/purple/indigo）', () => {
    const used = new Set(BUILT_IN_PROFILES.map((p) => p.theme.preset));
    for (const preset of ['default', 'blue', 'green', 'orange', 'purple', 'indigo'] as ThemePreset[]) {
      expect(used, `没有任何预设使用主题色板 ${preset}`).toContain(preset);
    }
  });

  it('覆盖全部 3 种布局模板（default/compact/wide）', () => {
    const used = new Set(BUILT_IN_PROFILES.map((p) => p.layout.preset));
    for (const preset of LAYOUT_PRESETS) {
      expect(used, `没有任何预设使用布局模板 ${preset}`).toContain(preset);
    }
  });

  it('覆盖 light / dark / system 三种明暗模式', () => {
    const used = new Set(BUILT_IN_PROFILES.map((p) => p.theme.mode));
    for (const mode of MODES) {
      expect(used, `没有任何预设使用明暗模式 ${mode}`).toContain(mode);
    }
  });
});

describe('内置外观预设 · 与布局模板默认值一致', () => {
  // 这条是**内置预设的设计一致性**约束（每套预设都从某个模板出发，避免「预设名不副实」），
  // 不再是 applyProfile 的实现限制：第十八轮起 applyProfile 走 applyConfig 全量写入，
  // 自定义预设完全可以声明与模板不同的侧栏状态（见下方「自定义预设」用例）。
  it('sidebarCollapsed / sidebarWidth 等于所属布局模板的默认值', () => {
    for (const profile of BUILT_IN_PROFILES) {
      const defaults = LAYOUT_PRESET_DEFAULTS[profile.layout.preset];
      expect(profile.layout.sidebarCollapsed, `${profile.id} 的 sidebarCollapsed 与布局模板不一致`).toBe(
        defaults.sidebarCollapsed,
      );
      expect(profile.layout.sidebarWidth, `${profile.id} 的 sidebarWidth 与布局模板不一致`).toBe(defaults.sidebarWidth);
    }
  });
});

describe('内置外观预设 · 应用后真实生效', () => {
  it('applyProfile 后预设声明过的每个维度都按声明落地', () => {
    for (const profile of BUILT_IN_PROFILES) {
      resetState();
      useAppearanceStore.getState().applyProfile(profile.id);
      const theme = useThemeStore.getState().config;
      const layout = useLayoutStore.getState().config;
      // 逐项而非整对象比较：预设的可选维度（typography / motion / contentWidth）
      // 「没声明」就是「这套预设不管这一维」，整对象 toEqual 会把不管的维度误报成没落地。
      for (const key of ['mode', 'preset', 'fontSize', 'borderRadius'] as const) {
        expect(theme[key], `${profile.id} 主题 ${key} 未落地`).toBe(profile.theme[key]);
      }
      if (profile.theme.motion) {
        expect(theme.motion, `${profile.id} 主题 motion 未落地`).toBe(profile.theme.motion);
      }
      for (const key of [
        'preset',
        'sidebarCollapsed',
        'sidebarWidth',
        'sidebarPosition',
        'contentPadding',
        'navbarStyle',
      ] as const) {
        expect(layout[key], `${profile.id} 布局 ${key} 未落地`).toBe(profile.layout[key]);
      }
      if (profile.layout.contentWidth) {
        expect(layout.contentWidth, `${profile.id} 布局 contentWidth 未落地`).toBe(profile.layout.contentWidth);
      }
    }
  });

  it('预设未声明的维度不越权：动效与内容宽度在应用预设后保持用户现值', () => {
    // 内置预设一律不声明 motion / contentWidth。若哪天有预设开始管这两维，本用例先吵起来，
    // 而不是等用户发现「点了一下预设，我关掉的动画又回来了」。
    useThemeStore.getState().setMotion('reduce');
    useLayoutStore.getState().setContentWidth('full');
    useAppearanceStore.getState().applyProfile('graphite');
    expect(useThemeStore.getState().config.motion).toBe('reduce');
    expect(useLayoutStore.getState().config.contentWidth).toBe('full');
  });

  it('每一套预设应用后都能被 detectActiveProfile 反查回自己（可到达、可区分）', () => {
    for (const profile of BUILT_IN_PROFILES) {
      resetState();
      useAppearanceStore.getState().applyProfile(profile.id);
      useAppearanceStore
        .getState()
        .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
      const state = useAppearanceStore.getState();
      expect(state.activeProfileId, `${profile.id} 应用后未被反查为当前预设`).toBe(profile.id);
      expect(state.isModified, `${profile.id} 应用后不应处于「已改动」态`).toBe(false);
    }
  });
});

describe('detectActiveProfile · 高亮反映真实状态', () => {
  it('单项微调后清除高亮并标记 isModified，同时保留 baseProfileId', () => {
    useAppearanceStore.getState().applyProfile('office');
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    expect(useAppearanceStore.getState().activeProfileId).toBe('office');

    // 单独改字号：已不再是任何内置预设的精确组合
    useThemeStore.getState().setFontSize('small');
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    const state = useAppearanceStore.getState();
    expect(state.activeProfileId).toBeNull();
    expect(state.isModified).toBe(true);
    expect(state.baseProfileId).toBe('office');
  });

  it('重新应用预设后高亮恢复', () => {
    useThemeStore.getState().setFontSize('small');
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    expect(useAppearanceStore.getState().activeProfileId).toBeNull();

    useAppearanceStore.getState().applyProfile('violet');
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    expect(useAppearanceStore.getState().activeProfileId).toBe('violet');
    expect(useAppearanceStore.getState().isModified).toBe(false);
  });
});
