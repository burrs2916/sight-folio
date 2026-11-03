// 圆角档位改版锁（2026-11-03 李先生直令）：撤「大圆 / 全圆」两档，新增「自定义」数值档
// （0–20px），直角/小圆/中圆改名 直角/微圆/标准（纯 i18n 文案，档位值不变）。
//
// 七件套逐件钉：
//  ① 落库：setBorderRadiusCustom 写进设置库 'theme' 键（不是 localStorage 单通道）；
//  ② init 读回：重开读回 custom + 数值；
//  ③ 跨窗口生效值比较：isSameThemeConfig 对「只改数值不换档位」必须判「变了」，
//     否则另一窗口会跳过同步（就是「设置没生效」）；
//  ④ 旧值迁移：库里/旧 localStorage 的 'large'/'round' 按原基准迁到 custom 12/20，
//     不许静默回落 medium（那是把用户已选观感改掉）；
//  ⑤ 脏值归一：clampRadiusPx 只认有限数、四舍五入、钳 0–20，脏值回落缺省 6；
//  ⑥ 恢复默认：resetConfig 把档位与数值一起复位；
//  ⑦ i18n 双包：radiusCustom/Hint 同增，radiusLarge/round 同删（差集为空口径）。
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

import { useThemeStore, THEME_SETTINGS_KEY, normalizeThemeConfig, isSameThemeConfig } from '../themeStore';
import type { ThemeConfig } from '../themeStore';
import { clampRadiusPx, radiusBasePx, RADIUS_CUSTOM_RANGE } from '../../theme/appearanceScales';
import { readFileSync } from 'node:fs';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const baseConfig = (over: Partial<ThemeConfig> = {}): ThemeConfig => ({
  mode: 'light',
  preset: 'default',
  fontSize: 'medium',
  borderRadius: 'medium',
  borderRadiusCustom: 6,
  ...over,
});

describe('圆角档位改版（三档 + 自定义数值）', () => {
  beforeEach(() => {
    kv.clear();
    useThemeStore.setState({ config: baseConfig(), initialized: false });
  });

  it('⑤ clampRadiusPx：只认有限数、四舍五入、钳 0–20，脏值回落 6', () => {
    expect(clampRadiusPx(undefined)).toBe(RADIUS_CUSTOM_RANGE.default);
    expect(clampRadiusPx(null)).toBe(RADIUS_CUSTOM_RANGE.default);
    expect(clampRadiusPx('8' as never)).toBe(RADIUS_CUSTOM_RANGE.default); // 字符串=手改库脏值，回落缺省而不是猜
    expect(clampRadiusPx(Number.NaN)).toBe(RADIUS_CUSTOM_RANGE.default);
    expect(clampRadiusPx(-5)).toBe(0);
    expect(clampRadiusPx(99)).toBe(20);
    expect(clampRadiusPx(8.6)).toBe(9);
  });

  it('⑤b radiusBasePx：固定档查表，custom 读数值，脏档位回落 medium', () => {
    expect(radiusBasePx({ borderRadius: 'none' })).toBe(0);
    expect(radiusBasePx({ borderRadius: 'small' })).toBe(2);
    expect(radiusBasePx({ borderRadius: 'medium' })).toBe(6);
    expect(radiusBasePx({ borderRadius: 'custom', borderRadiusCustom: 15 })).toBe(15);
    expect(radiusBasePx({ borderRadius: 'custom', borderRadiusCustom: 99 })).toBe(20);
    expect(radiusBasePx({ borderRadius: 'bogus' as never })).toBe(6);
  });

  it('④ 旧档迁移：large→custom/12、round→custom/20；真脏档位仍回落 medium', () => {
    const fromLarge = normalizeThemeConfig({
      mode: 'light',
      preset: 'default',
      fontSize: 'medium',
      borderRadius: 'large' as never,
    });
    expect(fromLarge.borderRadius).toBe('custom');
    expect(fromLarge.borderRadiusCustom).toBe(12);
    const fromRound = normalizeThemeConfig({ borderRadius: 'round' as never });
    expect(fromRound.borderRadius).toBe('custom');
    expect(fromRound.borderRadiusCustom).toBe(20);
    // 已有显式自定义数值时迁移不许盖掉它
    const keep = normalizeThemeConfig({ borderRadius: 'round' as never, borderRadiusCustom: 4 });
    expect(keep.borderRadiusCustom).toBe(4);
    expect(normalizeThemeConfig({ borderRadius: 'huge' as never }).borderRadius).toBe('medium');
  });

  it('①② 写入口 → 设置库 → 重开读回：档位与数值一条链', async () => {
    await useThemeStore.getState().setBorderRadius('custom');
    await useThemeStore.getState().setBorderRadiusCustom(11);
    await flush();
    const stored = JSON.parse(kv.get(THEME_SETTINGS_KEY)!);
    expect(stored.borderRadius).toBe('custom');
    expect(stored.borderRadiusCustom).toBe(11);

    useThemeStore.setState({ config: baseConfig(), initialized: false });
    await useThemeStore.getState().init();
    expect(useThemeStore.getState().config.borderRadius).toBe('custom');
    expect(useThemeStore.getState().config.borderRadiusCustom).toBe(11);
  });

  it('③ isSameThemeConfig 对「只改数值」判变（跨窗口漏同步防线）', () => {
    expect(
      isSameThemeConfig(
        baseConfig({ borderRadius: 'custom', borderRadiusCustom: 8 }),
        baseConfig({ borderRadius: 'custom', borderRadiusCustom: 14 }),
      ),
    ).toBe(false);
    expect(
      isSameThemeConfig(
        baseConfig({ borderRadius: 'custom', borderRadiusCustom: 8 }),
        baseConfig({ borderRadius: 'custom', borderRadiusCustom: 8 }),
      ),
    ).toBe(true);
  });

  it('⑥ resetConfig：档位与自定义数值一起回缺省', async () => {
    useThemeStore.setState({ config: baseConfig({ borderRadius: 'custom', borderRadiusCustom: 18 }) });
    await useThemeStore.getState().resetConfig();
    await flush();
    expect(useThemeStore.getState().config.borderRadius).toBe('medium');
    expect(useThemeStore.getState().config.borderRadiusCustom).toBe(RADIUS_CUSTOM_RANGE.default);
  });

  it('⑦ i18n 双包：新键同增、旧键同删', () => {
    const zh = readFileSync(`${process.cwd()}/src/i18n/zh-CN.json`, 'utf8');
    const en = readFileSync(`${process.cwd()}/src/i18n/en-US.json`, 'utf8');
    for (const pack of [zh, en]) {
      expect(pack).toContain('radiusCustom');
      expect(pack).toContain('radiusCustomHint');
      expect(pack).not.toContain('radiusLarge');
      expect(pack).not.toContain('radiusRound');
    }
    expect(zh).toContain('微圆');
    expect(zh).toContain('标准');
  });

  it('抽屉接线：自定义滑杆只在 custom 档出现并接 setBorderRadiusCustom（源码锁）', () => {
    const drawer = readFileSync(`${process.cwd()}/src/components/layout/SettingsDrawer.tsx`, 'utf8');
    expect(drawer).toContain('data-testid="radius-custom-slider"');
    expect(drawer).toContain('setBorderRadiusCustom');
    expect(drawer.match(/RADIUS_CUSTOM_RANGE\.(min|max|step)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
