// 外观设置跨窗口同步回归锁（2026-11-02，第十九轮）
//
// 病灶：写作台 / 代码工作台是独立 webview，各跑一份 store，而外观配置只在窗口启动时被
// init() 读一次。主窗口把主题切成深色，已经开着的写作台仍是浅色 —— 用户点名「设置改了几遍
// 另一边不生效」。业务数据早有 *Changed 广播，外观域缺一条，本锁看住新增的这条链路：
//  ① 四个子项（主题 / 布局 / 正文排版 / 语言）每次落盘都广播一次，且带上完整生效配置；
//  ② 接收侧 hydrate 只改内存，既不落库也不再广播（否则两窗口互相回声）；
//  ③ 非 Tauri 环境（vite dev 直开 / vitest）静默跳过，不能因为没有 IPC 就打断本窗口生效。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emit: vi.fn(async (..._args: unknown[]) => {}),
  listen: vi.fn(async () => () => {}),
  kv: new Map<string, string>(),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit, listen: h.listen }));
vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => h.kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      h.kv.set(key, value);
    },
    delete: async (key: string) => {
      h.kv.delete(key);
    },
  },
}));

import { APPEARANCE_CHANGED_EVENT, broadcastAppearanceChange, subscribeAppearanceChanges } from '../appearanceSync';
import { useThemeStore, normalizeThemeConfig, THEME_SETTINGS_KEY } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore, WRITING_TYPOGRAPHY_SETTINGS_KEY } from '../../store/typographyDefaultsStore';
import { useLanguageStore, LANGUAGE_SETTINGS_KEY } from '../../store/languageStore';

/** appearanceSync 用这个标记判定「跑在 Tauri webview 里」，测试里手动造出来 */
function asTauri(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: () => {} };
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type EmitCall = [string, { scope: string; config: unknown }];

/** 取某个 scope 那次广播的 payload.config（emit(event, { scope, config })） */
function emitted(scope: string): unknown {
  const calls = h.emit.mock.calls as unknown as EmitCall[];
  const hit = calls.find(([evt, payload]) => evt === APPEARANCE_CHANGED_EVENT && payload?.scope === scope);
  return hit ? hit[1].config : undefined;
}

beforeEach(() => {
  h.kv.clear();
  h.emit.mockClear();
  h.listen.mockClear();
  asTauri(true);
  // 状态必须经过各自的归一化函数：直接摆字面量会造出「生产到不了的形状」
  // （缺 motion / contentWidth），下一轮加设置项时这类快照会集体失真。
  useThemeStore.setState({
    config: normalizeThemeConfig({ mode: 'system', preset: 'default', fontSize: 'medium', borderRadius: 'medium' }),
    initialized: true,
  });
  useLayoutStore.setState({
    config: DEFAULT_LAYOUT_CONFIG,
    initialized: true,
  });
  useLanguageStore.setState({ lang: 'zh-CN', initialized: true });
});

afterEach(() => {
  asTauri(false);
});

describe('外观设置跨窗口广播', () => {
  it('主题 / 布局 / 排版 / 语言各自在落盘的同处广播一次，并带上完整配置', async () => {
    useThemeStore.getState().setMode('dark');
    useLayoutStore.getState().setSidebarPosition('right');
    useTypographyDefaultsStore.getState().setConfig({ fontSize: 20 });
    useLanguageStore.getState().setLanguage('en-US');
    await flush();

    expect(emitted('theme')).toMatchObject({ mode: 'dark', preset: 'default' });
    expect(emitted('layout')).toMatchObject({ sidebarPosition: 'right' });
    expect(emitted('typography')).toMatchObject({ fontSize: 20 });
    expect(emitted('language')).toBe('en-US');
  });

  it('广播不替代落库：同一项既进了设置库也广播了出去', async () => {
    useThemeStore.getState().setPreset('green');
    await flush();

    expect(JSON.parse(h.kv.get(THEME_SETTINGS_KEY)!).preset).toBe('green');
    expect(emitted('theme')).toMatchObject({ preset: 'green' });
  });

  it('hydrate 只改内存：不落库、不再广播（否则两窗口互相回声）', async () => {
    useThemeStore.getState().hydrate({ mode: 'dark', preset: 'purple', fontSize: 'large', borderRadius: 'small' });
    useLayoutStore.getState().hydrate({ contentPadding: 'large' });
    await flush();

    expect(useThemeStore.getState().config).toMatchObject({ mode: 'dark', preset: 'purple', fontSize: 'large' });
    expect(useLayoutStore.getState().config).toMatchObject({ preset: 'default', contentPadding: 'large' });
    expect(h.kv.size).toBe(0);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('hydrate 收到与本地一致的配置时不产生新对象引用（避免无谓整树重渲染）', () => {
    const before = useThemeStore.getState().config;
    useThemeStore.getState().hydrate({ ...before });
    expect(useThemeStore.getState().config).toBe(before);
  });

  it('非 Tauri 环境静默跳过广播，本窗口照常生效并尝试落库', async () => {
    asTauri(false);
    h.emit.mockClear();

    useThemeStore.getState().setFontSize('large');
    await flush();

    expect(h.emit).not.toHaveBeenCalled();
    expect(useThemeStore.getState().config.fontSize).toBe('large');
  });

  it('broadcastAppearanceChange 在 Tauri 下发出约定事件名与 scope/config 结构', () => {
    broadcastAppearanceChange('typography', { fontSize: 18 });
    expect(h.emit).toHaveBeenCalledWith(APPEARANCE_CHANGED_EVENT, { scope: 'typography', config: { fontSize: 18 } });
  });

  it('订阅建立前就取消时，后到的 unlisten 会被立刻回收', async () => {
    const unlisten = vi.fn();
    h.listen.mockImplementationOnce(async () => unlisten);
    const dispose = subscribeAppearanceChanges(() => {});
    dispose();
    await flush();
    expect(unlisten).toHaveBeenCalled();
  });

  it('正文排版既落自己的设置库键，也广播出同 scope 的配置', async () => {
    useTypographyDefaultsStore.getState().setConfig({ lineHeight: 2.4 });
    await flush();
    expect(JSON.parse(h.kv.get(WRITING_TYPOGRAPHY_SETTINGS_KEY)!).lineHeight).toBe(2.4);
    expect(emitted('typography')).toMatchObject({ lineHeight: 2.4 });
  });

  it('语言广播的 scope 与设置库键一致', async () => {
    useLanguageStore.getState().setLanguage('en-US');
    await flush();
    expect(h.kv.get(LANGUAGE_SETTINGS_KEY)).toBe('en-US');
    expect(emitted('language')).toBe('en-US');
  });
});
