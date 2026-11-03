// 设置库探针的并发竞态锁（2026-11-03 李先生报修：打开应用弹「当前环境连不上设置库」）。
//
// 病灶：`probe()` 的「写读回」判据拿 bootId 逐字比对回显，但同一次合法写入有两个来源会撞车：
//  ① dev 的 React.StrictMode 把挂载 effect 跑两遍（src/main.tsx 开着 StrictMode），
//     同一窗口两个 probe 并发，后写的 bootId 盖掉先写的，先写那个回读判假 ⇒ 弹 unavailable；
//  ② 多窗口（main / writing-desk-* / editor-*）都挂 App 都跑 probe，跨进程同撞一个探针键。
// 而库里探针行实际写进去了（2026-11-03 10:10:31 实测 `settings_probe` 落库）——库是好的，
// 弹窗是误报。判据改形：回显只要是**任一合法探针记录**（别人盖写）就算库通；
// 只有写失败/读不回/内容不是探针记录才算 unavailable。第二判据（跨启动留住没有）不受影响。
//
// 本锁钉：
//  ① 并发双 probe（StrictMode 形态）⇒ 双双 ok、零降级弹（病灶复现即此条必红）；
//  ② 真故障照抓：set 抛 / 回读 null / 回读垃圾 ⇒ unavailable + 弹一次（赦免并发≠赦免故障）；
//  ③ 回显被别的窗口合法盖写 ⇒ ok 不弹（判据改形的正向断言）；
//  ④ 跨启动判据不改弱：本机有 last_boot、库里零探针 ⇒ 仍报 not_persisted；
//  ⑤ 单飞：并发 probe 只产生一次探针写。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 探针通道整段换成内存 Map（模拟共享设置库：所有 probe 写同一个键，才能复现盖写竞态）。
// vi.mock 工厂会被提升到 import 之前，桩必须经 vi.hoisted 建，别用普通顶层变量。
const { fakeDb, settingsApiMock } = vi.hoisted(() => {
  const db = new Map<string, string>();
  const api = {
    get: vi.fn(async (key: string) => db.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      db.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      db.delete(key);
    }),
    databaseStatus: vi.fn(async () => ({ persistent: true, location: 'file:/fake/config.db' })),
  };
  return { fakeDb: db, settingsApiMock: api };
});
vi.mock('../../services/tauri', () => ({ settingsApi: settingsApiMock }));

import { useSettingsHealthStore, SETTINGS_PROBE_KEY } from '../settingsHealthStore';
import { useToastStore } from '../toastStore';

const LAST_BOOT_KEY = 'settings_probe_last_boot';

/** 降级弹的收集桩：健康 store 弹的是 useToastStore.getState().warning，直接换成记账函数 */
let warnCalls: string[] = [];

describe('设置库探针 · 并发写者不误报（2026-11-03 弹窗病灶）', () => {
  beforeEach(() => {
    fakeDb.clear();
    localStorage.clear();
    useSettingsHealthStore.getState().reset();
    vi.clearAllMocks();
    warnCalls = [];
    useToastStore.setState({
      warning: (msg: string) => {
        warnCalls.push(msg);
      },
    });
  });

  it('① StrictMode 式并发双 probe：双双 ok、零降级弹（病灶复现即此条必红）', async () => {
    await Promise.all([useSettingsHealthStore.getState().probe(), useSettingsHealthStore.getState().probe()]);
    expect(useSettingsHealthStore.getState().status).toBe('ok');
    expect(warnCalls).toEqual([]);
    // 探针确实落了库（合法写入不因并发判据改形而消失）
    expect(fakeDb.get(SETTINGS_PROBE_KEY)).toBeTruthy();
  });

  it('② 真故障照抓：set 抛 = unavailable + 弹（并发豁免不许顺带赦免故障）', async () => {
    settingsApiMock.set.mockRejectedValueOnce(new Error('IPC dead'));
    await useSettingsHealthStore.getState().probe();
    expect(useSettingsHealthStore.getState().status).toBe('unavailable');
    expect(warnCalls.length).toBe(1);
  });

  it('②b 回读 null（写了读不回）= unavailable + 弹', async () => {
    settingsApiMock.get.mockImplementation(async () => null);
    await useSettingsHealthStore.getState().probe();
    expect(useSettingsHealthStore.getState().status).toBe('unavailable');
    expect(warnCalls.length).toBe(1);
    settingsApiMock.get.mockImplementation(async (key: string) => fakeDb.get(key) ?? null);
  });

  it('②c 回读垃圾（不是探针记录形态）= unavailable + 弹', async () => {
    const originalSet = settingsApiMock.set.getMockImplementation()!;
    settingsApiMock.set.mockImplementationOnce(async (key: string, value: string) => {
      await originalSet(key, value);
      if (key === SETTINGS_PROBE_KEY) fakeDb.set(key, 'i am not a probe record');
    });
    await useSettingsHealthStore.getState().probe();
    expect(useSettingsHealthStore.getState().status).toBe('unavailable');
    expect(warnCalls.length).toBe(1);
    settingsApiMock.set.mockImplementation(originalSet);
  });

  it('③ 回显被别的窗口合法盖写 ⇒ ok 不弹（判据改形的核心断言）', async () => {
    const originalSet = settingsApiMock.set.getMockImplementation()!;
    settingsApiMock.set.mockImplementationOnce(async (key: string, value: string) => {
      await originalSet(key, value);
      // 模拟另一窗口抢先又写了它自己的合法探针（盖掉本次 bootId）
      if (key === SETTINGS_PROBE_KEY) {
        fakeDb.set(key, JSON.stringify({ bootId: 'other-window-boot-999', at: Date.now() }));
      }
    });
    await useSettingsHealthStore.getState().probe();
    expect(useSettingsHealthStore.getState().status).toBe('ok');
    expect(warnCalls.length).toBe(0);
    settingsApiMock.set.mockImplementation(originalSet);
  });

  it('④ 跨启动判据不改弱：有 last_boot 标记而库里零探针 ⇒ not_persisted + 弹', async () => {
    localStorage.setItem(LAST_BOOT_KEY, 'boot-from-last-session');
    // record 预读发生在写之前：fakeDb 为空即「库里连一份探针都没有」
    await useSettingsHealthStore.getState().probe();
    expect(useSettingsHealthStore.getState().status).toBe('not_persisted');
    expect(warnCalls.length).toBe(1);
  });

  it('⑤ 单飞：并发 probe 不产生成倍的库写入', async () => {
    await Promise.all([
      useSettingsHealthStore.getState().probe(),
      useSettingsHealthStore.getState().probe(),
      useSettingsHealthStore.getState().probe(),
    ]);
    expect(settingsApiMock.set).toHaveBeenCalledTimes(1);
  });
});
