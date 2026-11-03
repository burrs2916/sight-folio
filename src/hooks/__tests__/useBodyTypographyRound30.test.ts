// 第三十轮 · `useBodyTypography` 的裁决锁（16:54 只读审计 §3 尾巴 1 兑现）
//
// 为什么这条锁必须有：画布（工作室章节卡）不走 Emotion，它的排版完全来自这个 hook。
// 而 `loadTypography()` 读的是 utils/typography 里**两份非响应式**的模块级读数
// （全局默认 + 书级覆盖），所以「书级 > 全局默认」这条优先级在画布上到底成不成立，
// 全看这个 hook 有没有把两个 store 都订阅上 —— 少订阅一个，画布就停在旧排版，
// 表现又是用户那句「设置没生效」。第 26 轮立的规矩是「先补锁再开新功能」，本轮欠的一格在这里补上。
//
// ⚠️ 写这份锁时踩到一个**会假绿**的坑，留在文件头防止重演：
//    `useTypographyDefaultsStore.setState(...)` 只改 store 读数，**不会**推 utils/typography 的
//    模块级 `globalDefaults`（那条推送在 `setConfig` / `init` 内部）。用 setState 铺读数时，
//    hook 读到的仍是模块里的旧默认值 —— 于是「跟随全局默认」这类断言会因默认值恰好相等而通过。
//    本文件因此一律走 `setConfig`，并把默认值取成与 `DEFAULT_TYPOGRAPHY` **不同**的数
//    （字号 17 / 行距 2.2），让「读到的是真默认」这件事本身可被证伪。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBodyTypographyCssVars } from '../useBodyTypography';
import { useBookTypographyStore } from '../../store/bookTypographyStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useThemeStore } from '../../store/themeStore';
import { BODY_TYPOGRAPHY_CSS_VARS, DEFAULT_TYPOGRAPHY } from '../../utils/typography';

// 设置库写入口在本文件里不关心结果，给个哑实现即可（真实写链路见 bookTypographyRound30.test.ts）
vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
  },
}));

const VARS = BODY_TYPOGRAPHY_CSS_VARS;

/** 明暗固定成 light：纸色在两套主题下是两组色值，本文件只锁「取到哪一档」，不锁色板 */
function setLightMode() {
  useThemeStore.setState((s) => ({ config: { ...s.config, mode: 'light' }, systemMode: 'light' }));
}

beforeEach(() => {
  useBookTypographyStore.getState().reset();
  setLightMode();
  useTypographyDefaultsStore.getState().setConfig({ ...DEFAULT_TYPOGRAPHY, fontSize: 17, lineHeight: 2.2 });
});

describe('useBodyTypography · 画布那条通道的取值优先级', () => {
  it('书级覆盖那一项听书的，没覆盖的那一项继续听全局默认', () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20 } });
    const { result } = renderHook(() => useBodyTypographyCssVars('book-a'));
    expect(result.current[VARS.fontSize]).toBe('20px');
    expect(result.current[VARS.lineHeight]).toBe('2.2');
  });

  it('没单独调过的书整套跟随全局默认（17 / 2.2 是本轮特意与内置默认错开的数）', () => {
    const { result } = renderHook(() => useBodyTypographyCssVars('book-b'));
    expect(result.current[VARS.fontSize]).toBe('17px');
    expect(result.current[VARS.lineHeight]).toBe('2.2');
  });

  it('抽屉/另一窗口改了这本书的排版 → 画布跟着重算（订阅 bookTypographyStore 的唯一证明）', () => {
    const { result } = renderHook(() => useBodyTypographyCssVars('book-b'));
    expect(result.current[VARS.paper]).toBeUndefined();
    // 旧实现这一格是断的：书级覆盖换进设置库后，这个 hook 只订阅了全局默认，
    // 于是「主窗口把这本书调成护眼纸色，开着的写作台画布仍是白底」。
    act(() => {
      useBookTypographyStore.getState().patchBookTypography('book-b', { paper: 'sepia' });
    });
    expect(result.current[VARS.paper]).toBe('#f7efe0');
  });

  it('全局默认改了也要重算（订阅 typographyDefaultsStore 的证明）', () => {
    const { result } = renderHook(() => useBodyTypographyCssVars('book-b'));
    expect(result.current[VARS.lineHeight]).toBe('2.2');
    act(() => {
      useTypographyDefaultsStore.getState().setConfig({ lineHeight: 1.6 });
    });
    expect(result.current[VARS.lineHeight]).toBe('1.6');
    // 这本书没调过字号 → 默认字号的变化它也要接住
    expect(result.current[VARS.fontSize]).toBe('17px');
  });

  it('书里调过的那一项不被默认反向盖掉', () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20 } });
    const { result } = renderHook(() => useBodyTypographyCssVars('book-a'));
    act(() => {
      useTypographyDefaultsStore.getState().setConfig({ fontSize: 18 });
    });
    expect(result.current[VARS.fontSize]).toBe('20px');
  });

  it('没有书（bookId=null）时取全局默认，不炸', () => {
    const { result } = renderHook(() => useBodyTypographyCssVars(null));
    expect(result.current[VARS.fontSize]).toBe('17px');
  });

  it('纸色按「已解析的实际明暗」取值：暗色下是另一组色值', () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { paper: 'sepia' } });
    useThemeStore.setState((s) => ({ config: { ...s.config, mode: 'dark' }, systemMode: 'light' }));
    const { result } = renderHook(() => useBodyTypographyCssVars('book-a'));
    expect(result.current[VARS.paper]).toBe('#2b261d');
  });
});
