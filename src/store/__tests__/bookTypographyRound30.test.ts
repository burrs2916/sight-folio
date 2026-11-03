// 第三十轮 P1 · 「书级排版」迁进设置库 —— 新增设置域 6 件套的验收锁
//
// 用户原话里的两句诉求在这一域上是同一件事：
//  「设置完成后生效」+「关闭软件、启停软件设置不会失效」，以及「设置功能还是不完整」。
// 书级排版此前逐本躺在 localStorage：不进设置库、不进备份、不跨窗口广播、写失败静默，
// 是「设置不完整」当前最实的一块。第 25 轮给「新增设置域」立了 6 件套的交付标准，
// 本文件逐件锁死 —— 以后谁再建一个设置域，照这份清单抄一遍就知道漏了哪件。
//
//  ① 落库走可信层 scope（失败可见、可重试）
//  ② init 从设置库读回（重启不丢）
//  ③ 跨窗口 hydrate（只改内存，不回声）
//  ④ 设置抽屉入口（看得见、能收回默认）
//  ⑤ 真实消费点（写作台 + 画布两套渲染器同源）
//  ⑥ 进设置备份键（导出/恢复都带着它）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { useBookTypographyStore, BOOK_TYPOGRAPHY_SETTINGS_KEY } from '../bookTypographyStore';
import { useSettingsSyncStore } from '../settingsSyncStore';
import { BACKUPABLE_SETTINGS_KEYS, collectSettingsSnapshot, applySettingsSnapshot } from '../../utils/settingsBackup';
import { loadTypography, setBookTypographyOverrides } from '../../utils/typography';
import zhCN from '../../i18n/zh-CN.json';
import enUS from '../../i18n/en-US.json';

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
    // 备份的「导出 → 恢复」闭环要读整表、也要批量写回（16:54 审计 §3 尾巴 2 的锁用得上）
    getAll: async () => [...kv.entries()],
    setMany: async (entries: [string, string][]) => {
      for (const [key, value] of entries) kv.set(key, value);
    },
  },
}));

const read = (rel: string) => readFileSync(`${process.cwd()}/src/${rel}`, 'utf8');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  kv.clear();
  localStorage.clear();
  useBookTypographyStore.getState().reset();
  useSettingsSyncStore.getState().reset();
});

describe('6 件套 ①②· 落库走可信层 + 重启读回', () => {
  it('改一档即以 typographyBooks 这个 scope 走可信层，并写进设置库', async () => {
    await useBookTypographyStore.getState().init();
    useBookTypographyStore.getState().patchBookTypography('book-a', { fontSize: 20 });
    // 状态读数落在**这个** scope 上：少这一格，抽屉底部那句「已自动保存」就会对书级排版说不准
    expect(useSettingsSyncStore.getState().status.typographyBooks).toBe('pending');
    await flush();
    expect(useSettingsSyncStore.getState().status.typographyBooks).toBe('saved');
    expect(kv.has(BOOK_TYPOGRAPHY_SETTINGS_KEY)).toBe(true);
  });

  it('重启读回：新 store 实例（reset 后 init）仍拿到上一本调过的那几项', async () => {
    await useBookTypographyStore.getState().init();
    useBookTypographyStore.getState().patchBookTypography('book-a', { paper: 'green' });
    await flush();
    useBookTypographyStore.getState().reset();
    setBookTypographyOverrides({});
    expect(loadTypography('book-a').paper).toBe('default');
    await useBookTypographyStore.getState().init();
    expect(loadTypography('book-a').paper).toBe('green');
  });
});

describe('6 件套 ③· 跨窗口 hydrate 不回写（防回声）', () => {
  it('hydrate 只改内存与渲染层读数，绝不再写一次设置库', async () => {
    await useBookTypographyStore.getState().init();
    kv.delete(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    useBookTypographyStore.getState().hydrate({ 'book-b': { lineHeight: 2.2 } });
    expect(loadTypography('book-b').lineHeight).toBe(2.2);
    expect(kv.has(BOOK_TYPOGRAPHY_SETTINGS_KEY)).toBe(false);
  });

  it('广播 scope 与订阅两端同源：appearanceSync 的枚举里有它，App 才接得住', () => {
    expect(read('services/appearanceSync.ts')).toMatch(/AppearanceScope[\s\S]*'typographyBooks'/);
    expect(read('App.tsx')).toContain("scope === 'typographyBooks'");
  });
});

describe('6 件套 ④· 设置抽屉入口（看得见 + 能收回默认）', () => {
  it('抽屉里有书级覆盖的读数与清空白口，写作台排版面板有「跟随默认」出口', () => {
    const drawer = read('components/layout/SettingsDrawer.tsx');
    expect(drawer).toContain('settings-book-typography-count');
    expect(drawer).toContain('settings-book-typography-clear');
    // 有代价的批量动作沿用就地二次确认，不是一点就清
    expect(drawer).toContain('settings-book-typography-clear-cancel');
    const popover = read('pages/writingPage/TypographyPopover.tsx');
    expect(popover).toContain('typography-override-state');
    expect(popover).toContain('typography-follow-default');
  });

  it('首帧读回门控把这一域算进去了（否则写作台会先闪一帧默认排版）', () => {
    const app = read('App.tsx');
    expect(app).toContain('bookTypographyInit()');
    expect(app).toContain('bookTypographyInitialized &&');
  });
});

describe('6 件套 ⑤· 真实消费点（两套渲染器 + 写作台本地状态都跟着走）', () => {
  it('写作台不再自己写 localStorage，走的是设置库 store', () => {
    const page = read('pages/WritingPage.tsx');
    expect(page).not.toContain('saveTypography');
    expect(page).toContain('patchBookTypography');
    expect(page).toContain('clearBookTypography');
  });

  it('画布那条非 Emotion 通道也订阅了覆盖表，否则抽屉/主窗口改完画布不跟', () => {
    const hook = read('hooks/useBodyTypography.ts');
    expect(hook).toContain('useBookTypographyStore');
    // 覆盖表必须真的进了那份 useMemo 的依赖数组，不然画布停在旧排版（判据不绑 prettier 换行）
    expect(hook).toContain('useBookTypographyStore((s) => s.overrides)');
    expect(hook).toMatch(/\[[^\]]*\bbookOverrides\b[^\]]*\]/);
  });
});

describe('6 件套 ⑥· 进设置备份（导出/恢复/界面列项三处同源）', () => {
  it('备份键清单里有它，且 scope 与状态读数一致', () => {
    const entry = BACKUPABLE_SETTINGS_KEYS.find((k) => k.key === BOOK_TYPOGRAPHY_SETTINGS_KEY);
    expect(entry?.scope).toBe('typographyBooks');
    expect(entry?.labelKey).toBe('settings.backupKeyTypographyBooks');
  });

  it('恢复走的还是同一份 adopt 分派（键 → hydrate），漏一支就是「恢复了但界面不动」', () => {
    expect(read('utils/settingsBackup.ts')).toContain('useBookTypographyStore.getState().hydrate');
  });

  // 「键清单里有它」和「导得出去、恢得回来」是两件事（16:54 只读审计 §3 尾巴 2 点名：
  // 备份侧此前只有键数锁与反查锁，新键没有真闭环）。这一条走完整闭环。
  it('真闭环：导出带得上书级覆盖 → 清空 → 恢复 → 渲染层读数回来且重新落库', async () => {
    await useBookTypographyStore.getState().init();
    useBookTypographyStore.getState().patchBookTypography('book-a', { fontSize: 21, paper: 'green' });
    await flush();

    const snapshot = await collectSettingsSnapshot();
    // 快照口径：键 → 库里的原始字符串（缺失的键直接不出现，不写空串冒充「有值」）
    expect(snapshot.settings[BOOK_TYPOGRAPHY_SETTINGS_KEY]).toContain('book-a');

    // 模拟「换设备 / 库被清」：库里与内存里都没有这一域
    kv.delete(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    useBookTypographyStore.getState().reset();
    expect(loadTypography('book-a').fontSize).not.toBe(21);

    const result = await applySettingsSnapshot(snapshot);
    expect(result.failed).toEqual([]);
    expect(result.applied).toContain(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    expect(loadTypography('book-a').fontSize).toBe(21);
    expect(loadTypography('book-a').paper).toBe('green');
    // 恢复是真落了库的，不是只把界面抹亮一档（否则下次重启又丢）
    await flush();
    expect(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)).toContain('book-a');
  });
});

describe('本轮新增文案在两门语言里都在（缺一边就是英文界面下露出 key 串）', () => {
  const NEW_KEYS: [string[], unknown][] = [
    [['settings', 'backupKeyTypographyBooks'], null],
    [['settings', 'bookTypographyOverrides'], null],
    [['settings', 'bookTypographyOverrideCount'], null],
    [['settings', 'bookTypographyNoOverride'], null],
    [['settings', 'bookTypographyOverrideHint'], null],
    [['settings', 'bookTypographyClearAll'], null],
    [['settings', 'bookTypographyClearAllConfirm'], null],
    [['settings', 'bookTypographyCleared'], null],
    [['settings', 'resetConfirmBookNote'], null],
    [['writing', 'typography', 'overrideOn'], null],
    [['writing', 'typography', 'followingGlobal'], null],
    [['writing', 'typography', 'followDefaultNow'], null],
    [['writing', 'typography', 'noBookHint'], null],
  ];

  const dig = (bag: unknown, path: string[]) => path.reduce<unknown>((acc, key) => (acc as never)?.[key], bag);

  it.each(NEW_KEYS.map(([path]) => ({ title: path.join('.') })))('%title', ({ title }) => {
    const path = title.split('.');
    expect(typeof dig(zhCN, path)).toBe('string');
    expect(typeof dig(enUS, path)).toBe('string');
  });
});
