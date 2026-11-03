// 「恢复默认」与「预设带正文排版」回归锁（2026-11-02，第十九轮）
//
// 病灶一：设置抽屉底部按钮文案写着「恢复默认设置（含布局与正文排版）」，但 resetAll 只复位
// 主题与布局两项，正文默认排版（字号 / 行距 / 纸色 / 页宽）永远回不去 —— 文案与实现不符，
// 用户点完发现写作台还是旧排版，观感即「设置没生效」。
//
// 病灶二：外观预设此前只含 theme + layout，「另存为预设」沉淀不了正文排版，选一套预设还得
// 再手动调一次排版。现在自定义预设连排版一起存；内置预设一律不声明排版（点预设不该顺手
// 改掉创作者的正文习惯）。两种口径都由本文件锁住。
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { useAppearanceStore, BUILT_IN_PROFILES } from '../appearanceStore';
import { useThemeStore, THEME_SETTINGS_KEY } from '../themeStore';
import { useLayoutStore } from '../layoutStore';
import { useTypographyDefaultsStore, WRITING_TYPOGRAPHY_SETTINGS_KEY } from '../typographyDefaultsStore';
import { DEFAULT_TYPOGRAPHY, getGlobalTypographyDefaults } from '../../utils/typography';
import type { BookTypography } from '../../utils/typography';

/** layoutStore 的持久化键未导出，测试侧写字面量（与 store 内 LAYOUT_SETTINGS_KEY 一致） */
const LAYOUT_KEY = 'layout';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const DEFAULT_LAYOUT = {
  preset: 'default' as const,
  sidebarCollapsed: false,
  sidebarWidth: 240,
  sidebarPosition: 'left' as const,
  contentPadding: 'medium' as const,
  navbarStyle: 'standard' as const,
};

function resetMemory() {
  useThemeStore.setState({
    config: { mode: 'system', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    initialized: true,
  });
  useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT }, initialized: true });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
    initialized: true,
  });
}

beforeEach(() => {
  kv.clear();
  resetMemory();
});

describe('恢复默认 · 主题 / 布局 / 正文排版三项一起复位', () => {
  it('resetAll 把三项都写回默认值并各自落库（重启后仍是默认）', async () => {
    useThemeStore.getState().setMode('dark');
    useThemeStore.getState().setPreset('green');
    useLayoutStore.getState().setContentPadding('large');
    useTypographyDefaultsStore.getState().setConfig({ fontSize: 20, lineHeight: 2.2, paper: 'sepia' });
    await flush();
    expect(useTypographyDefaultsStore.getState().config.fontSize).toBe(20);

    useAppearanceStore.getState().resetAll();
    await flush();

    expect(useThemeStore.getState().config).toMatchObject({ mode: 'system', preset: 'default' });
    expect(useLayoutStore.getState().config).toMatchObject({ preset: 'default', contentPadding: 'medium' });
    expect(useTypographyDefaultsStore.getState().config).toEqual(DEFAULT_TYPOGRAPHY);

    expect(JSON.parse(kv.get(THEME_SETTINGS_KEY)!)).toMatchObject({ mode: 'system', preset: 'default' });
    expect(JSON.parse(kv.get(LAYOUT_KEY)!)).toMatchObject({ contentPadding: 'medium' });
    expect(JSON.parse(kv.get(WRITING_TYPOGRAPHY_SETTINGS_KEY)!)).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it('resetAll 同步把默认排版推给 utils/typography 的模块级读数（写作台走的是同步读取）', async () => {
    useTypographyDefaultsStore.getState().setConfig({ fontSize: 22 });
    expect(getGlobalTypographyDefaults().fontSize).toBe(22);

    useAppearanceStore.getState().resetAll();
    await flush();

    expect(getGlobalTypographyDefaults().fontSize).toBe(DEFAULT_TYPOGRAPHY.fontSize);
  });
});

describe('外观预设 · 正文排版的纳入口径', () => {
  const customTypography: BookTypography = { ...DEFAULT_TYPOGRAPHY, fontSize: 18, lineHeight: 2.2 };

  it('内置预设不声明排版：点预设不会顺手改掉创作者的正文习惯', () => {
    expect(BUILT_IN_PROFILES.every((p) => p.typography === undefined)).toBe(true);

    useTypographyDefaultsStore.getState().setConfig({ fontSize: 21 });
    const office = BUILT_IN_PROFILES.find((p) => p.id === 'office')!;
    useAppearanceStore.getState().applyProfile(office.id);

    expect(useThemeStore.getState().config.mode).toBe('light');
    expect(useTypographyDefaultsStore.getState().config.fontSize).toBe(21);
  });

  it('另存为预设会把当前正文排版一起沉淀，且卡片带排版声明', async () => {
    useThemeStore.getState().setPreset('purple');
    useTypographyDefaultsStore.getState().setConfig(customTypography);
    await flush();

    const id = useAppearanceStore.getState().saveCurrentAsProfile('我的夜间稿纸');
    const saved = useAppearanceStore.getState().getProfile(id)!;
    expect(saved.typography).toMatchObject({ fontSize: 18, lineHeight: 2.2 });

    // 落盘后重开（清内存 + init）预设仍带着排版 —— 「存一套 = 存全套」不能只在内存里成立
    await flush();
    const persisted = JSON.parse(kv.get('appearance_profiles')!);
    expect(persisted.version).toBe(3);
    expect(persisted.profiles[0].typography).toMatchObject({ fontSize: 18, lineHeight: 2.2 });

    resetMemory();
    await useAppearanceStore.getState().init();
    expect(useAppearanceStore.getState().getProfile(id)?.typography).toMatchObject({ fontSize: 18 });
  });

  it('应用带排版的自定义预设会把正文排版一并落地', () => {
    const id = useAppearanceStore.getState().saveCurrentAsProfile('稿纸');
    useAppearanceStore.getState().updateProfile(id, { typography: customTypography });
    useTypographyDefaultsStore.getState().setConfig({ fontSize: 14, lineHeight: 1.6 });

    useAppearanceStore.getState().applyProfile(id);

    expect(useTypographyDefaultsStore.getState().config).toMatchObject({ fontSize: 18, lineHeight: 2.2 });
  });

  it('v2 旧数据（预设没有 typography 字段）照旧可用：不参与匹配也不改排版', async () => {
    kv.set(
      'appearance_profiles',
      JSON.stringify({
        version: 2,
        profiles: [
          {
            id: 'legacy',
            name: '旧预设',
            theme: { mode: 'dark', preset: 'blue', fontSize: 'medium', borderRadius: 'small' },
            layout: { ...DEFAULT_LAYOUT },
          },
        ],
        activeProfileId: 'legacy',
        baseProfileId: 'legacy',
        isModified: false,
      }),
    );
    await useAppearanceStore.getState().init();

    const legacy = useAppearanceStore.getState().getProfile('legacy')!;
    expect(legacy.typography).toBeUndefined();

    useTypographyDefaultsStore.getState().setConfig({ fontSize: 19 });
    useAppearanceStore.getState().detectActiveProfile(
      { mode: 'dark', preset: 'blue', fontSize: 'medium', borderRadius: 'small' },
      { ...DEFAULT_LAYOUT },
    );
    // 预设不管排版 → 用户改了行距字号也不该把它判成「已微调」
    expect(useAppearanceStore.getState().activeProfileId).toBe('legacy');
    expect(useAppearanceStore.getState().isModified).toBe(false);
  });
});
