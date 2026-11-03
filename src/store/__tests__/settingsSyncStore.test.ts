// 设置落盘可信层回归锁（2026-11-02，第二十轮）
//
// 对应第十九轮台账待办 1：「落盘失败要让人看见」。此前外观域五个 store 都是
// `settingsApi.set(...).catch(console.error)`：写库失败时界面照样立刻变、抽屉底部照样
// 写着「自动保存」，作者重启才发现没记住。本锁住四条口径：
//  ① 写成功 → 状态 saved + 记录时间，供界面把「自动保存」变成可核对的事实；
//  ② 首次失败、自动重试成功 → 不打扰用户（瞬时故障不该弹提示），状态回到 saved；
//  ③ 重试仍失败 → 状态 failed + 留住待重放内容 + 只弹一次提示（节流）；
//  ④ 手动重放（抽屉「重试」按钮）能把失败的那次写入补上，不需要用户再点一遍设置。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsSyncStore, overallStatus, persistSettings } from '../settingsSyncStore';
import { useToastStore } from '../toastStore';

const { calls, mode } = vi.hoisted(() => ({
  calls: [] as { key: string; value: string }[],
  // 'ok' 全部成功；'flaky' 首次失败重试成功；'down' 一直失败
  mode: { current: 'ok' as 'ok' | 'flaky' | 'down' },
}));
const attempt = { n: 0 };

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async () => null,
    set: async (key: string, value: string) => {
      attempt.n += 1;
      if (mode.current === 'down') throw new Error('db down');
      if (mode.current === 'flaky' && attempt.n === 1) throw new Error('transient lock');
      calls.push({ key, value });
    },
    delete: async () => {},
  },
}));

/** 等 fire-and-forget 的写入链跑完（含失败后 500ms 的自动重试间隔） */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 700));
};

beforeEach(() => {
  calls.length = 0;
  attempt.n = 0;
  mode.current = 'ok';
  useSettingsSyncStore.getState().reset();
  useToastStore.setState({ toasts: [] });
});

describe('落盘可信层 · 成功路径', () => {
  it('写库成功即记为 saved 并留下可对账的时间', async () => {
    persistSettings('theme', 'theme', '{"preset":"green"}');
    expect(useSettingsSyncStore.getState().status.theme).toBe('pending');
    await settle();

    const s = useSettingsSyncStore.getState();
    expect(s.status.theme).toBe('saved');
    expect(s.lastSavedAt).toBeTypeOf('number');
    expect(calls).toEqual([{ key: 'theme', value: '{"preset":"green"}' }]);
  });

  it('首次失败、自动重试即补上：不弹提示、状态回到 saved', async () => {
    mode.current = 'flaky';
    persistSettings('layout', 'layout', '{"preset":"wide"}');
    await settle();

    const s = useSettingsSyncStore.getState();
    expect(s.status.layout).toBe('saved');
    expect(useToastStore.getState().toasts).toHaveLength(0);
    // 一次失败 + 一次成功重放
    expect(attempt.n).toBe(2);
  });
});

describe('落盘可信层 · 失败可见', () => {
  it('重试仍失败 → failed + 留住待重放内容 + 提示一次', async () => {
    mode.current = 'down';
    persistSettings('typography', 'writing_typography', '{"fontSize":20}');
    await settle();

    const s = useSettingsSyncStore.getState();
    expect(s.status.typography).toBe('failed');
    expect(s.lastErrorScope).toBe('typography');
    expect(s.failedWrites.typography).toEqual({ key: 'writing_typography', value: '{"fontSize":20}' });
    expect(useToastStore.getState().toasts.filter((x) => x.severity === 'warning')).toHaveLength(1);
  });

  it('连续写入失败只弹一次提示（拖滑杆不该刷一屏报错）', async () => {
    mode.current = 'down';
    persistSettings('theme', 'theme', '1');
    await settle();
    persistSettings('theme', 'theme', '2');
    await settle();

    expect(useToastStore.getState().toasts.filter((x) => x.severity === 'warning')).toHaveLength(1);
  });

  it('「重试」按钮重放最后一次想写的值，成功后清掉失败态', async () => {
    mode.current = 'down';
    persistSettings('appearance', 'appearance_profiles', '{"version":3}');
    await settle();
    expect(useSettingsSyncStore.getState().status.appearance).toBe('failed');

    mode.current = 'ok';
    useSettingsSyncStore.getState().retryFailed();
    await settle();

    const s = useSettingsSyncStore.getState();
    expect(s.status.appearance).toBe('saved');
    expect(s.failedWrites.appearance).toBeUndefined();
    expect(calls.some((c) => c.key === 'appearance_profiles' && c.value === '{"version":3}')).toBe(true);
  });

  it('用户改了新值就覆盖旧的失败记录：重放不会写回过期内容', async () => {
    mode.current = 'down';
    persistSettings('theme', 'theme', 'stale');
    await settle();

    mode.current = 'ok';
    persistSettings('theme', 'theme', 'fresh');
    await settle();

    const s = useSettingsSyncStore.getState();
    expect(s.failedWrites.theme).toBeUndefined();
    useSettingsSyncStore.getState().retryFailed();
    await settle();
    // 重放只补新值，不重复写 stale
    expect(calls.filter((c) => c.value === 'stale')).toHaveLength(0);
    expect(calls.filter((c) => c.value === 'fresh').length).toBeGreaterThanOrEqual(1);
  });
});

describe('落盘可信层 · 界面汇总读数', () => {
  // 七个 scope 一个都不能少（第二十四轮加了 writing，第三十轮 P1 加了 typographyBooks）：
  // 少一格既过不了类型，也会让抽屉底部那句「已自动保存」对那一域说不准。
  const IDLE = {
    theme: 'idle',
    layout: 'idle',
    typography: 'idle',
    language: 'idle',
    appearance: 'idle',
    writing: 'idle',
    typographyBooks: 'idle',
  } as const;

  it('一个 scope 失败就报失败（不能被其它 scope 的成功盖掉）', () => {
    expect(overallStatus({ ...IDLE, theme: 'failed' }, 123)).toEqual({ status: 'failed', failedCount: 1 });
  });

  it('写作偏好失败同样要冒出来（该域是新加的，漏接汇总就等于静默失败）', () => {
    expect(overallStatus({ ...IDLE, writing: 'failed' }, 123)).toEqual({ status: 'failed', failedCount: 1 });
  });

  it('书级排版覆盖失败也要冒出来（第三十轮 P1 新增域，同一条铁律）', () => {
    expect(overallStatus({ ...IDLE, typographyBooks: 'failed' }, 123)).toEqual({ status: 'failed', failedCount: 1 });
  });

  it('没失败但有写入中 → pending；全部落定且写过 → saved；一次没写过 → idle', () => {
    expect(overallStatus({ ...IDLE, layout: 'pending' }, 123).status).toBe('pending');
    expect(overallStatus({ ...IDLE, writing: 'pending' }, 123).status).toBe('pending');
    expect(overallStatus({ ...IDLE, typographyBooks: 'pending' }, 123).status).toBe('pending');
    expect(overallStatus({ ...IDLE, layout: 'saved' }, 123).status).toBe('saved');
    expect(overallStatus({ ...IDLE }, null).status).toBe('idle');
  });
});
