// 「跟随系统」不再白写一次盘（2026-11-02，第二十轮）
//
// 对应第十九轮台账待办 2：App 的 matchMedia 回调此前调 `setMode('system')`，
// 档位根本没变，但 config 是新对象 → 操作系统每切一次明暗就白写一次设置库、
// 白广播一次跨窗口事件，还会在落盘状态里留下一次「用户改了设置」的假记录。
// 本轮把系统明暗改成 store 里一个**不持久化**的派生读数 systemMode，
// 回调只调 syncSystemMode()：只更新内存，不落库、不广播。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useThemeStore, resolveModeWithSystem, getSystemMode, THEME_SETTINGS_KEY } from '../themeStore';
import { broadcastAppearanceChange } from '../../services/appearanceSync';
import { settingsApi } from '../../services/tauri';

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async () => null,
    set: vi.fn(async () => {}),
    delete: async () => {},
  },
}));

vi.mock('../../services/appearanceSync', () => ({
  broadcastAppearanceChange: vi.fn(),
}));

/** 把系统的明暗偏好伪造成指定值（jsdom 默认不实现 matchMedia，getSystemMode 会兜底成浅色） */
function stubSystemMode(dark: boolean) {
  window.matchMedia = vi.fn(() => ({
    matches: dark,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const setSpy = vi.mocked(settingsApi.set);
const broadcastSpy = vi.mocked(broadcastAppearanceChange);

beforeEach(() => {
  setSpy.mockClear();
  broadcastSpy.mockClear();
  useThemeStore.setState({
    config: { mode: 'system', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    systemMode: 'light',
    initialized: true,
  });
});

afterEach(() => {
  // @ts-expect-error 还原 jsdom 原状（无 matchMedia）
  delete window.matchMedia;
});

describe('resolveModeWithSystem · 纯函数口径', () => {
  it('只有「跟随」档位才采信系统读数', () => {
    expect(resolveModeWithSystem('system', 'dark')).toBe('dark');
    expect(resolveModeWithSystem('system', 'light')).toBe('light');
    expect(resolveModeWithSystem('light', 'dark')).toBe('light');
    expect(resolveModeWithSystem('dark', 'light')).toBe('dark');
  });

  it('无 matchMedia 的环境按浅色兜底（不抛错）', () => {
    expect(getSystemMode()).toBe('light');
  });
});

describe('syncSystemMode · 只重算派生读数', () => {
  it('系统换成深色 → systemMode 跟上，且不写设置库、不广播', () => {
    stubSystemMode(true);

    useThemeStore.getState().syncSystemMode();

    expect(useThemeStore.getState().systemMode).toBe('dark');
    expect(setSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
    // 用户存的偏好仍是三态的 system，没有被降格成某个固定明暗
    expect(useThemeStore.getState().config.mode).toBe('system');
  });

  it('读数没变就一次 set 都不做（不制造无谓重渲染）', () => {
    stubSystemMode(false);
    const before = useThemeStore.getState();

    useThemeStore.getState().syncSystemMode();

    expect(useThemeStore.getState()).toBe(before);
  });

  it('系统明暗连续变化：无论切多少次，设置库始终一次没写', () => {
    stubSystemMode(true);
    useThemeStore.getState().syncSystemMode();
    stubSystemMode(false);
    useThemeStore.getState().syncSystemMode();
    stubSystemMode(true);
    useThemeStore.getState().syncSystemMode();

    expect(useThemeStore.getState().systemMode).toBe('dark');
    expect(setSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('用户主动改档位仍然要落库 + 广播（可信层没有把正常路径一起消掉）', async () => {
    useThemeStore.getState().setMode('dark');
    await new Promise((r) => setTimeout(r, 0));

    expect(useThemeStore.getState().config.mode).toBe('dark');
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(THEME_SETTINGS_KEY);
    expect(broadcastSpy).toHaveBeenCalledWith('theme', expect.objectContaining({ mode: 'dark' }));
  });

  it('跨窗口 hydrate 不碰本窗口的系统读数（各窗口对自己的操作系统负责）', () => {
    stubSystemMode(true);
    useThemeStore.getState().syncSystemMode();

    useThemeStore.getState().hydrate({ mode: 'dark', preset: 'purple', fontSize: 'small', borderRadius: 'small' });

    const s = useThemeStore.getState();
    expect(s.config.preset).toBe('purple');
    expect(s.systemMode).toBe('dark');
    expect(setSpy).not.toHaveBeenCalled();
  });
});
