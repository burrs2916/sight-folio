// 外观配置专用持久化回归锁（2026-11-02，第十七轮 T6）
//
// 用户诉求：「我们设定以后我们就持久化，下次用户再打开的话它就会默认就是个颜色了，
// 我们需要一个持久化配置项，专门做这个的。」
//
// 覆盖三条链路：
//  ① themeStore 把外观/主题配置写进应用设置库（settingsApi KV，键 'theme'），
//     而不是只写浏览器 localStorage；重开 init() 读回同一配置（颜色不丢）。
//  ② 老用户升级迁移：设置库为空时把历史 localStorage 配置一次性搬进设置库并清理旧键；
//     迁移后不再写旧键（外观配置的唯一真源是设置库）。
//  ③ appearanceStore 把「当前选中的外观预设」连同自定义预设一并落盘，重开恢复高亮；
//     并兼容只存自定义预设数组的旧格式。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useThemeStore, THEME_SETTINGS_KEY } from '../themeStore';
import type { ThemeConfig } from '../themeStore';
import { useAppearanceStore, BUILT_IN_PROFILES } from '../appearanceStore';
import type { AppearanceProfile } from '../appearanceStore';
import { LAYOUT_PRESET_DEFAULTS } from '../layoutStore';
import type { LayoutConfig } from '../layoutStore';

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

/** 与 themeStore 内 DEFAULT_THEME_CONFIG 保持一致（用于模拟「重开」时清空内存态）。 */
const DEFAULT_THEME: ThemeConfig = { mode: 'system', preset: 'default', fontSize: 'medium', borderRadius: 'medium' };
const LEGACY_KEY = 'project-sight.theme';

/** 等待 fire-and-forget 的持久化 Promise 落地。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function resetThemeMemory(config: ThemeConfig = { ...DEFAULT_THEME }) {
  useThemeStore.setState({ config: { ...config }, initialized: false });
}

function resetAppearanceMemory() {
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
    initialized: false,
  });
}

beforeEach(() => {
  kv.clear();
  localStorage.clear();
  resetThemeMemory();
  resetAppearanceMemory();
});

describe('外观配置持久化 · 写设置库并重开读回', () => {
  it('设置库为空时 init 落到默认配置，不误读 localStorage', async () => {
    await useThemeStore.getState().init();
    expect(useThemeStore.getState().config).toEqual(DEFAULT_THEME);
    expect(useThemeStore.getState().initialized).toBe(true);
  });

  it('改主题后写入设置库键 theme，重开（init）读回同一配置', async () => {
    await useThemeStore.getState().init();
    useThemeStore.getState().setMode('dark');
    useThemeStore.getState().setPreset('green');
    useThemeStore.getState().setFontSize('large');
    await flush();

    expect(kv.has(THEME_SETTINGS_KEY)).toBe(true);
    expect(JSON.parse(kv.get(THEME_SETTINGS_KEY)!)).toMatchObject({
      mode: 'dark',
      preset: 'green',
      fontSize: 'large',
      borderRadius: 'medium',
    });

    // 模拟重开：内存态清空后 init 应读回用户上次的颜色
    resetThemeMemory();
    await useThemeStore.getState().init();
    expect(useThemeStore.getState().config).toMatchObject({ mode: 'dark', preset: 'green', fontSize: 'large' });
  });

  it('外观配置的唯一真源是设置库：改主题不再写旧 localStorage 键', async () => {
    await useThemeStore.getState().init();
    useThemeStore.getState().setPreset('blue');
    await flush();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse(kv.get(THEME_SETTINGS_KEY)!).preset).toBe('blue');
  });

  it('老用户升级迁移：设置库为空时把旧 localStorage 配置搬进设置库并清理旧键', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ mode: 'dark', preset: 'purple', fontSize: 'large', borderRadius: 'round' }),
    );
    await useThemeStore.getState().init();

    // 2026-11-03 档位改版：旧「全圆」按原基准迁移到自定义档（20px），观感无缝衔接；
    // 直接回落 medium 会静默改掉用户已选圆度 = 另一种「设置没生效」
    expect(useThemeStore.getState().config).toMatchObject({
      mode: 'dark',
      preset: 'purple',
      borderRadius: 'custom',
      borderRadiusCustom: 20,
    });
    expect(JSON.parse(kv.get(THEME_SETTINGS_KEY)!)).toMatchObject({ preset: 'purple', mode: 'dark' });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe('外观配置持久化 · 选中预设一并保存并恢复', () => {
  it('applyProfile 后把选中预设与状态一并落盘，重开恢复高亮', async () => {
    await useAppearanceStore.getState().init();
    useAppearanceStore.getState().applyProfile('violet');
    await flush();

    const stored = JSON.parse(kv.get('appearance_profiles')!);
    // v3 起自定义预设可带 typography；v2 数据字段可选，读取侧无需迁移（见 appearanceStore 注释）
    expect(stored.version).toBe(3);
    expect(stored.activeProfileId).toBe('violet');
    expect(stored.baseProfileId).toBe('violet');
    expect(stored.isModified).toBe(false);

    // 模拟重开：内存态清空后 init 应恢复出上次选中的预设
    resetAppearanceMemory();
    await useAppearanceStore.getState().init();
    const state = useAppearanceStore.getState();
    expect(state.activeProfileId).toBe('violet');
    expect(state.baseProfileId).toBe('violet');
    expect(state.isModified).toBe(false);
  });

  it('自定义预设随选中状态一并持久化，重开仍在列表里', async () => {
    await useAppearanceStore.getState().init();
    const custom: AppearanceProfile = {
      id: 'my-custom',
      name: '我的外观',
      theme: { mode: 'light', preset: 'green', fontSize: 'small', borderRadius: 'small' },
      layout: {
        preset: 'default',
        ...LAYOUT_PRESET_DEFAULTS.default,
      },
    };
    useAppearanceStore.getState().addProfile(custom);
    useAppearanceStore.getState().applyProfile('my-custom');
    await flush();

    resetAppearanceMemory();
    await useAppearanceStore.getState().init();
    const state = useAppearanceStore.getState();
    expect(state.activeProfileId).toBe('my-custom');
    expect(state.profiles.find((p) => p.id === 'my-custom')).toBeTruthy();
    expect(state.profiles.filter((p) => p.isBuiltIn).length).toBe(BUILT_IN_PROFILES.length);
  });

  it('兼容旧格式：设置库里直接是自定义预设数组时照常加载', async () => {
    const legacy: AppearanceProfile[] = [
      {
        id: 'legacy-1',
        name: '旧版自定义',
        theme: { mode: 'dark', preset: 'blue', fontSize: 'medium', borderRadius: 'medium' },
        layout: { preset: 'wide', ...LAYOUT_PRESET_DEFAULTS.wide } as LayoutConfig,
      },
    ];
    kv.set('appearance_profiles', JSON.stringify(legacy));
    await useAppearanceStore.getState().init();

    const state = useAppearanceStore.getState();
    expect(state.profiles.find((p) => p.id === 'legacy-1')).toBeTruthy();
    expect(state.activeProfileId).toBeNull();
    // 内置预设始终在列（旧格式不含内置，靠代码定义补齐）
    expect(state.profiles.filter((p) => p.isBuiltIn).length).toBe(BUILT_IN_PROFILES.length);
  });
});
