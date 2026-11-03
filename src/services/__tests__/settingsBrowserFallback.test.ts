// 设置库双通道的回归锁（本轮病灶：健康条弹「当前环境连不上设置库（非桌面应用 / IPC 不可用）」）
//
// 要锁住的不是"浏览器里能不能存"，而是**两条通道不许互相越界**：
//  ① 桌面壳内失败必须原样炸出来。一旦有人给桌面分支也加上浏览器兜底，一个已经丢掉整套设置的
//     进程会对着健康条说"没问题"—— 那是第 23 轮立 `get_database_status` 要消灭的那类谎。
//  ② 非桌面环境必须有可用通道。vite dev 用浏览器直开 23010 时 IPC 桥不存在，此前设置域七个域
//     全部读不回，用户怎么改都是空的。
//
// 判据口径（历轮铁律）：源码扫描锁先剥注释、先归一空白，不绑 prettier 换行。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('../core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

import { settingsApi, BROWSER_SETTINGS_PREFIX } from '../settings';

/** 装出「在桌面壳里」的样子：core.ts 的守卫与 settings.ts 的分流看的是同一个标记 */
function inShell(on: boolean): void {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { ipc: () => {} };
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

const realLocalStorage = window.localStorage;
const browserKeyOf = (key: string) => `${BROWSER_SETTINGS_PREFIX}${key}`;

beforeEach(() => {
  inShell(false);
  invokeMock.mockReset();
  realLocalStorage.clear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  inShell(false);
});

describe('非桌面环境：浏览器兜底通道真的可用', () => {
  it('写入后能读回，且键挂在约定前缀下', async () => {
    await settingsApi.set('theme', '{"mode":"dark"}');
    expect(await settingsApi.get('theme')).toBe('{"mode":"dark"}');
    // 真存进 localStorage 的是带前缀那把键，不与界面里 workbench.* / ps.* 的散装键混用
    expect(realLocalStorage.getItem(browserKeyOf('theme'))).toBe('{"mode":"dark"}');
  });

  it('删除生效；读不存在的键返回 null 而不是抛错', async () => {
    await settingsApi.set('language', 'en-US');
    await settingsApi.delete('language');
    expect(await settingsApi.get('language')).toBeNull();
    expect(await settingsApi.get('never_written')).toBeNull();
  });

  it('自报落点时说清是浏览器存储，不冒充 config.db', async () => {
    const status = await settingsApi.databaseStatus();
    expect(status.persistent).toBe(true);
    expect(status.location).toContain('localStorage');
    expect(status.location).not.toContain('config.db');
  });

  it('浏览器存储被禁（隐私模式）时 reject，不许静默成功', async () => {
    const boom = () => {
      throw new Error('denied');
    };
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: boom, setItem: boom, removeItem: boom },
      configurable: true,
      writable: true,
    });
    await expect(settingsApi.set('theme', '{}')).rejects.toThrow();
    await expect(settingsApi.get('theme')).rejects.toThrow();
    await expect(settingsApi.databaseStatus()).rejects.toThrow();
    Object.defineProperty(window, 'localStorage', {
      value: realLocalStorage,
      configurable: true,
      writable: true,
    });
  });
});

describe('桌面壳内：一次都不许碰浏览器兜底', () => {
  it('四个方法全部走 invoke，命令名一个都不许改错', async () => {
    inShell(true);
    invokeMock.mockResolvedValue(null);
    await settingsApi.get('theme');
    await settingsApi.set('theme', '{}');
    await settingsApi.delete('theme');
    invokeMock.mockResolvedValue({ persistent: true, location: '/x/config.db' });
    await settingsApi.databaseStatus();
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      'get_setting',
      'set_setting',
      'delete_setting',
      'get_database_status',
    ]);
    expect(realLocalStorage.getItem(browserKeyOf('theme'))).toBeNull();
  });

  it('IPC 失败原样 reject —— 绝不退到 localStorage（退了就等于对着坏库说"没问题"）', async () => {
    inShell(true);
    invokeMock.mockRejectedValue(new Error('command get_setting not found'));
    await expect(settingsApi.get('theme')).rejects.toThrow('not found');
    // 关键断言：浏览器里不许留下任何"看起来成功了"的副本
    expect(realLocalStorage.length).toBe(0);
  });

  it('后端自报退内存库时，落点原样透给健康条，前端不做修饰', async () => {
    inShell(true);
    invokeMock.mockResolvedValue({ persistent: false, location: '(memory)' });
    expect(await settingsApi.databaseStatus()).toEqual({ persistent: false, location: '(memory)' });
  });
});

describe('源码扫描锁：边界不许被后人改回去', () => {
  const stripComments = (s: string): string =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '\n')
      .replace(/\s+/g, ' ');

  const src = stripComments(readFileSync(`${process.cwd()}/src/services/settings.ts`, 'utf8'));

  it('四个方法都以「桌面壳内 ⇒ 直接 return invoke」开头，桌面分支外没有 try 包住它', () => {
    expect([...src.matchAll(/if \(inTauriShell\(\)\) return invoke</g)].length).toBe(4);
    expect(src).not.toMatch(/try \{[^}]*inTauriShell\(\)/);
  });

  it('兜底前缀不在 settings.ts 之外被直接读写（绕开双通道判据就是又一处真源分身）', () => {
    const root = `${process.cwd()}/src`;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const abs = `${dir}/${name}`;
        if (statSync(abs).isDirectory()) {
          if (name === '__tests__') continue;
          walk(abs);
        } else if (/\.(ts|tsx)$/.test(name) && !abs.endsWith('/services/settings.ts')) {
          if (readdirSkipTest(name)) continue;
          if (stripComments(readFileSync(abs, 'utf8')).includes(BROWSER_SETTINGS_PREFIX)) offenders.push(abs);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

function readdirSkipTest(name: string): boolean {
  return name.includes('.test.');
}
