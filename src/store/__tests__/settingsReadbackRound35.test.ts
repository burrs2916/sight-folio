// 第三十五轮 · 「设置读回迟到」要在界面上说实话 —— 计数与镜像的回归锁
//
// 第 34 轮把行为修好了（迟到读数不再整份盖内存），但这件事**只有 console 里没有界面**：
// 用户在门控超时后点了一档，界面没跳回去，他看到的形状和「设置没生效」一模一样，
// 只是这次数据是对的。不写一句实话，下一轮它还会被当成回归报上来。
//
// 这把锁管四件事，缺一都可能悄悄退化成「说了假话」或「假话变没话」：
//  ① 只在**真的迟到**时计数（正常读回一条都不许多报 —— 误报比不报更糟，用户会以为软件坏了）；
//  ② 一次迟到只记一条（同一次读回跨多个分支、StrictMode 双跑 init 都不该刷成两三条）；
//  ③ 报名字且顺序稳定（界面要说得出是哪几项迟到，不能每次换个顺序）；
//  ④ 界面读数与 guard 真源同步、且可重放（reset 只清镜像不清真源，下一轮用例就会串读数）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useThemeStore, THEME_SETTINGS_KEY } from '../themeStore';
import { useLayoutStore } from '../layoutStore';
import { useSettingsSyncStore } from '../settingsSyncStore';
import { useSettingsHealthStore } from '../settingsHealthStore';
import { getLateReadbackSnapshot, subscribeLateReadbacks, resetLateReadbacks } from '../settingsReadbackGuard';
import { BACKUPABLE_SETTINGS_KEYS } from '../../utils/settingsBackup';

/** `layoutStore` 里这个键是模块私有的（没导出），值就是它写库用的字面量 */
const LAYOUT_KEY = 'layout';

const h = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  /** 卡住的读回键 → 放行函数**列表**：模拟「IPC 比首帧门控的 1500ms 更慢」这个真实形状。
   *  刻意用列表而不是单个函数：StrictMode 双跑 init 会让同一个键有**两个**读回在飞，
   *  只存最后一个的话前一个永远等不到放行 —— 本轮第一版就是这么把用例卡到超时的。*/
  gates: new Map<string, Array<() => void>>(),
}));

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => {
      // 与第 34 轮同一口径：快照必须在**发起查询时**取，否则迟到读数永远等于用户自己的写入，
      // 下面的场景一条也造不出来。
      const snapshot = h.kv.get(key) ?? null;
      if (h.gates.has(key)) {
        await new Promise<void>((resolve) => {
          const list = h.gates.get(key) ?? [];
          list.push(resolve);
          h.gates.set(key, list);
        });
      }
      return snapshot;
    },
    set: async (key: string, value: string) => {
      h.kv.set(key, value);
    },
    delete: async (key: string) => {
      h.kv.delete(key);
    },
  },
  default: {},
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function holdReadback(key: string) {
  h.gates.set(key, []);
}
/** 放行该键上**所有**在飞的读回（双跑 init 就是两个） */
async function releaseReadback(key: string) {
  const list = h.gates.get(key) ?? [];
  h.gates.delete(key);
  list.forEach((release) => release());
  await flush();
}

beforeEach(async () => {
  h.kv.clear();
  h.gates.clear();
  localStorage.clear();
  resetLateReadbacks();
  // 必须走 resetXxx 把配置**真的**回到默认，而不是 setState 一份同值副本：
  // 「同值重写」会被 guard 记成 EVERY_FIELD（整域以内存为准），下一条用例里
  // setMode('dark') 若恰好与残留值相同，合并方向就悄悄变了，断言会在错误的路径上过（本轮第一版实测撞红）。
  useThemeStore.getState().resetConfig();
  useThemeStore.setState({ initialized: false });
  useLayoutStore.getState().resetLayout();
  useLayoutStore.setState({ initialized: false });
  useSettingsSyncStore.getState().reset();
  useSettingsHealthStore.getState().reset();
  await flush();
});

describe('① 正常读回不报账', () => {
  it('库读数按时回来、期间没人改动 ⇒ 一条都不记（误报会让人以为存储坏了）', async () => {
    h.kv.set(
      THEME_SETTINGS_KEY,
      JSON.stringify({ mode: 'dark', preset: 'default', fontSize: 'medium', borderRadius: 'medium' }),
    );
    await useThemeStore.getState().init();
    await flush();
    expect(getLateReadbackSnapshot().count).toBe(0);
    expect(useSettingsHealthStore.getState().lateReadbacks.count).toBe(0);
    // 正常链路本身照常工作（防护没把读回关掉）
    expect(useThemeStore.getState().config.mode).toBe('dark');
    expect(useThemeStore.getState().initialized).toBe(true);
  });
});

describe('② 迟到记一条，不多记', () => {
  it('门控超时后用户改了明暗、库读数迟到 ⇒ 记一次并报名字', async () => {
    h.kv.set(
      THEME_SETTINGS_KEY,
      JSON.stringify({ mode: 'light', preset: 'default', fontSize: 'large', borderRadius: 'medium' }),
    );
    holdReadback(THEME_SETTINGS_KEY);
    const pending = useThemeStore.getState().init();

    // 门控放行后用户点了「深色」：这就是那条真实改动
    useThemeStore.getState().setMode('dark');
    await flush();
    await releaseReadback(THEME_SETTINGS_KEY);
    await pending;

    const snap = getLateReadbackSnapshot();
    expect(snap.count).toBe(1);
    expect(snap.scopes).toEqual(['theme']);
    expect(snap.lastAt, '界面要能说「什么时候发生的」，读数不能是 null').not.toBeNull();
    // 行为口径不许因为本轮加了计数而回退：用户那一项仍在，他没碰的字号按库值补回
    expect(useThemeStore.getState().config.mode).toBe('dark');
    expect(useThemeStore.getState().config.fontSize).toBe('large');
  });

  it('StrictMode 双跑 init ⇒ 仍只算一次事件（双跑是 React 开发期常态，刷两条纯属噪音）', async () => {
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'light', fontSize: 'medium' }));
    holdReadback(THEME_SETTINGS_KEY);
    const first = useThemeStore.getState().init();
    const second = useThemeStore.getState().init();

    useThemeStore.getState().setMode('dark');
    await flush();
    await releaseReadback(THEME_SETTINGS_KEY);
    await Promise.all([first, second]);

    expect(getLateReadbackSnapshot().count).toBe(1);
  });

  it('库里根本没有这一键、但用户已经改过 ⇒ 也算一次迟到（这件事确实发生过）', async () => {
    holdReadback(THEME_SETTINGS_KEY);
    const pending = useThemeStore.getState().init();
    useThemeStore.getState().setMode('dark');
    await flush();
    await releaseReadback(THEME_SETTINGS_KEY);
    await pending;

    expect(getLateReadbackSnapshot().count).toBe(1);
    expect(useThemeStore.getState().config.mode).toBe('dark');
    expect(useThemeStore.getState().initialized, '没读数也要放行门控（第 34 轮口径）').toBe(true);
  });
});

describe('③ 报名字：去重 + 稳定顺序', () => {
  it('两域各迟到一次 ⇒ 记两条，scopes 按登记顺序而不是完成顺序', async () => {
    // 先让**布局**迟到、后让**主题**迟到：如果 scopes 是按插入顺序拼的，这条会红。
    // 界面每次换个域名顺序，读起来就像软件在随机报故障。
    h.kv.set(LAYOUT_KEY, JSON.stringify({ sidebarWidth: 300, contentPadding: 24 }));
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'light', fontSize: 'small' }));
    holdReadback(LAYOUT_KEY);
    holdReadback(THEME_SETTINGS_KEY);

    const layoutPending = useLayoutStore.getState().init();
    const themePending = useThemeStore.getState().init();
    useLayoutStore.getState().setConfig({ sidebarWidth: 260 });
    useThemeStore.getState().setMode('dark');
    await flush();

    await releaseReadback(LAYOUT_KEY);
    await layoutPending;
    await releaseReadback(THEME_SETTINGS_KEY);
    await themePending;

    const snap = getLateReadbackSnapshot();
    expect(snap.count).toBe(2);
    expect(snap.scopes).toEqual(['theme', 'layout']);
  });

  it('七个 scope 都能反查到显示名（界面那句不能出现空白或裸 scope）', () => {
    const labelScopes = BACKUPABLE_SETTINGS_KEYS.map((item) => item.scope);
    for (const scope of [
      'theme',
      'layout',
      'typography',
      'typographyBooks',
      'writing',
      'language',
      'appearance',
    ] as const) {
      expect(labelScopes, `scope ${scope} 没有 labelKey：健康条那句会退化成裸英文，和备份区叫法分家`).toContain(scope);
    }
    expect(new Set(labelScopes).size, '同一个 scope 登记了两次：反查取到哪一个取决于数组顺序').toBe(labelScopes.length);
  });
});

describe('④ 真源与镜像：界面拿得到、用例可重放', () => {
  it('guard 记一次账 ⇒ 健康自检那份读数同步跟上（界面订阅的是 store，不是模块变量）', async () => {
    expect(useSettingsHealthStore.getState().lateReadbacks.count).toBe(0);
    resetLateReadbacks();
    useThemeStore.setState({ initialized: false });
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'light' }));
    holdReadback(THEME_SETTINGS_KEY);
    const pending = useThemeStore.getState().init();
    useThemeStore.getState().setPreset('teal');
    await flush();
    await releaseReadback(THEME_SETTINGS_KEY);
    await pending;

    expect(getLateReadbackSnapshot().count).toBe(1);
    expect(useSettingsHealthStore.getState().lateReadbacks.count, '镜像没跟上 = 健康条永远不说这句实话').toBe(1);
    expect(useSettingsHealthStore.getState().lateReadbacks.scopes).toEqual(['theme']);
  });

  it('reset 同时清掉真源与镜像（只清镜像的话下一条用例会读到上一条的次数）', async () => {
    resetLateReadbacks();
    useThemeStore.setState({ initialized: false });
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'light' }));
    holdReadback(THEME_SETTINGS_KEY);
    const pending = useThemeStore.getState().init();
    useThemeStore.getState().setMode('dark');
    await flush();
    await releaseReadback(THEME_SETTINGS_KEY);
    await pending;
    expect(getLateReadbackSnapshot().count).toBe(1);

    useSettingsHealthStore.getState().reset();
    expect(getLateReadbackSnapshot().count).toBe(0);
    expect(useSettingsHealthStore.getState().lateReadbacks.count).toBe(0);
  });

  it('订阅可退订，且退订后记账不再回调（防组件卸载后 setState）', () => {
    let hits = 0;
    const off = subscribeLateReadbacks(() => {
      hits += 1;
    });
    resetLateReadbacks();
    expect(hits).toBe(1);
    off();
    resetLateReadbacks();
    expect(hits, '退订没生效：卸载后的回调会在 React 里报「更新已卸载组件」').toBe(1);
  });
});
