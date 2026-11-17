// 设置抽屉界面层回归锁（2026-11-02，第二十三轮）
//
// 本轮从界面点进去验三件事：
//  ① 新增的「界面字体」四个档位点得动、当场落设置库（不是又一个只存不读的开关）；
//  ② 扩充的青碧 / 蔷薇 / 石墨三套色板在抽屉里可选，选了真的改 theme.preset 并落库；
//  ③ 设置库究竟存在哪个文件要能在界面看到 —— 后端自报内存库时立刻说「可能记不住」，
//     而不是等用户重启自己发现。
// 另附一条源码锁：首帧必须等主题 / 布局 / 正文排版都从设置库读回后再画，
// 否则打开软件会先闪一遍默认外观，观感就是「设置又没生效」。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useLanguageStore } from '../../store/languageStore';
import { useSettingsSyncStore } from '../../store/settingsSyncStore';
import { useSettingsHealthStore } from '../../store/settingsHealthStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { setLang, t } from '../../i18n';

const { kv, dbStatus } = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  // 可在单个用例里改写：模拟老后端（null = 没有这条命令）与内存库两种情形
  dbStatus: { current: null as { persistent: boolean; location: string } | null },
}));

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.set(key, value);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
    databaseStatus: async () => {
      if (!dbStatus.current) throw new Error('unknown command: get_database_status');
      return dbStatus.current;
    },
  },
}));

/** 等 fire-and-forget 的写入链与探针都跑完 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

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
  dbStatus.current = {
    persistent: true,
    location: '/Users/demo/Library/Application Support/com.sight.folio/config.db',
  };
  useThemeStore.setState({
    config: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    systemMode: 'light',
    initialized: true,
  });
  useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT_CONFIG }, initialized: true });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
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

describe('设置抽屉 · 界面字体', () => {
  it('四个档位都在抽屉里，点「衬线」当场生效并写进设置库', async () => {
    renderDrawer();
    for (const id of ['system', 'sans', 'serif', 'mono']) {
      expect(screen.getByTestId(`ui-font-${id}`), `${id} 档没有渲染出来`).toBeTruthy();
    }

    fireEvent.click(screen.getByTestId('ui-font-serif'));
    expect(useThemeStore.getState().config.uiFont).toBe('serif');
    await settle();
    expect(JSON.parse(kv.get('theme') ?? '{}').uiFont).toBe('serif');
  });

  it('默认选中「跟随系统」，档位上画的就是该档真正注入的那条字体栈', () => {
    renderDrawer();
    const systemBtn = screen.getByTestId('ui-font-system');
    expect(systemBtn.className).toContain('Mui-selected');
    expect(systemBtn.getAttribute('style') ?? '').toContain('apple-system');
  });
});

describe('设置抽屉 · 扩充后的主题色板', () => {
  it('青碧 / 蔷薇 / 石墨都出现在色卡行里，点「青碧」改了 preset 并落库', async () => {
    renderDrawer();
    for (const label of [t('settings.presetTeal'), t('settings.presetRose'), t('settings.presetSlate')]) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
    // 色卡的 title 就是本地化 label（色卡本身没有文字，靠 title 标注是哪一套）
    const tealCard = document.querySelector('[title="' + t('settings.presetTeal') + '"]');
    expect(tealCard).toBeTruthy();
    fireEvent.click(tealCard as Element);
    expect(useThemeStore.getState().config.preset).toBe('teal');
    await settle();
    expect(JSON.parse(kv.get('theme') ?? '{}').preset).toBe('teal');
  });
});

describe('设置抽屉 · 设置库落点可见', () => {
  it('后端给出路径时，抽屉里能看到「设置存在哪儿」', async () => {
    renderDrawer();
    await useSettingsHealthStore.getState().probe();
    await settle();
    expect(screen.getByTestId('settings-db-location').textContent).toContain('com.sight.folio/config.db');
    // 一切正常时不该出现告警文案（只在可能记不住时才打扰）
    expect(screen.queryByTestId('settings-health-notice')?.textContent).not.toContain(t('settings.healthNotPersisted'));
  });

  it('后端自报内存库（persistent=false）：立刻说明记不住，而不是继续谎称已保存', async () => {
    dbStatus.current = { persistent: false, location: '(memory)' };
    renderDrawer();
    await useSettingsHealthStore.getState().probe();
    await settle();
    expect(useSettingsHealthStore.getState().status).toBe('not_persisted');
    expect(screen.getByTestId('settings-health-notice').textContent).toContain(t('settings.healthNotPersisted'));
  });

  it('老后端没有这条命令：不报错、也不编一个路径出来', async () => {
    dbStatus.current = null;
    renderDrawer();
    await useSettingsHealthStore.getState().probe();
    await settle();
    expect(useSettingsHealthStore.getState().dbLocation).toBeNull();
    expect(screen.queryByTestId('settings-db-location')).toBeNull();
    // 探针本身的判定不受影响（库能写能读 → ok）
    expect(useSettingsHealthStore.getState().status).toBe('ok');
  });
});

describe('首帧门控 · 等设置库读回再画界面', () => {
  it('App 同时等主题 / 布局 / 正文排版 / 书级排版 / 语言 / 写作偏好六项读回，并带超时兜底', () => {
    const src = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
    // 第二十四轮补上语言与写作偏好，第三十轮 P1 补上书级排版：漏等一项 = 开机先闪一帧
    // 「不是用户那套」的界面，观感就是设置没生效。
    // 判据锁的是「这些项都进了门控」这件事本身，因此先取出门控表达式再逐项点名：
    // 既不受 prettier 折行影响（第二十六轮的教训），也不受**新增项插在中间**影响
    // （第三十轮：原来那条按顺序写死的长正则，一插新读数就整段误报）。
    const gate = src.replace(/\s+/g, ' ');
    const gateExpr = /const appearanceReady = useAppearanceReadbackReady\(([^)]+)\)/.exec(gate)?.[1] ?? '';
    expect(gateExpr, '门控表达式取不到：App.tsx 的读回门控被改写了吗').not.toBe('');
    for (const flag of [
      'themeInitialized',
      'layoutInitialized',
      'typographyDefaultsInitialized',
      'bookTypographyInitialized',
      'languageInitialized',
      'writingPrefsInitialized',
    ]) {
      expect(gateExpr, `门控漏等 ${flag}：开机就会闪一帧「不是用户那套」的界面`).toContain(flag);
    }
    expect(src).not.toMatch(/^ {2}if \(!themeInitialized\) \{/m);
    // 有兜底：读回万一回不来，不能永远白屏
    expect(src).toMatch(/APPEARANCE_READBACK_TIMEOUT_MS/);
  });
});
