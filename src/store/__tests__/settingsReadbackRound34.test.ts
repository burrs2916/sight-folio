// 第三十四轮：设置「读回迟到」竞态回归锁
//
// 用户原话：「确保设置完成后生效，关闭软件、启停软件设置不会失效。」
// 本轮治的是这句话里**没被前 33 轮覆盖到的那半条**：设置库读回比首帧门控的 1500ms 兜底更慢时，
// 界面上已经能点，用户点完，迟到的读数又把内存整份盖回旧值 —— 观感是「刚点的不生效」，
// 第二跳是「他再改一次，库里刚选的那项也没了」（因为写库是以未初始化的内存为底做的整份覆盖）。
//
// 为什么每条都要「两向断言」：只断「用户那项还在」是不够的 —— 合并写错方向（内存吃掉整库）
// 同样能过。所以每条同时断 ① 用户碰过的以内存为准 ② 他没碰过的以库为准 ③ 门控标志照常放行。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useThemeStore, THEME_SETTINGS_KEY } from '../themeStore';
import { useLayoutStore } from '../layoutStore';
import { useTypographyDefaultsStore, WRITING_TYPOGRAPHY_SETTINGS_KEY } from '../typographyDefaultsStore';
import { useWritingPrefsStore, WRITING_PREFS_SETTINGS_KEY } from '../writingPrefsStore';
import { useLanguageStore, LANGUAGE_SETTINGS_KEY } from '../languageStore';
import { useBookTypographyStore, BOOK_TYPOGRAPHY_SETTINGS_KEY } from '../bookTypographyStore';
import { useAppearanceStore, BUILT_IN_PROFILES } from '../appearanceStore';
import { useSettingsSyncStore } from '../settingsSyncStore';
import { mergeStaleReadback, isSameReadbackByFields, EVERY_FIELD } from '../settingsReadbackGuard';
import { loadTypography } from '../../utils/typography';
import type { Lang } from '../../i18n';

const h = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  /** 被卡住的读回键 → 放行它的函数（模拟「IPC 比首帧门控更慢」这个真实形状） */
  gates: new Map<string, () => void>(),
  /** 这一键的读回直接抛错（模拟库被占 / IPC 断） */
  fail: new Set<string>(),
  writes: [] as string[],
}));

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => {
      if (h.fail.has(key)) throw new Error('settings db unavailable');
      // 关键建模：读回拿到的是**发起查询那一刻**的快照。真实场景是 SQL 查询已在飞，
      // 期间用户又写了一次库 —— 迟到的那次 get 回的是旧值，不是刚写进去的新值。
      // 之前写成「放行时才读 kv」，等于让迟到读数永远等于用户自己的写入，本文件的
      // 场景一条也造不出来（假绿方向还正好相反）。
      const snapshot = h.kv.get(key) ?? null;
      if (h.gates.has(key)) {
        await new Promise<void>((resolve) => {
          h.gates.set(key, resolve);
        });
      }
      return snapshot;
    },
    set: async (key: string, value: string) => {
      h.writes.push(key);
      h.kv.set(key, value);
    },
    delete: async (key: string) => {
      h.kv.delete(key);
    },
  },
  // appearanceSync 在非 Tauri 环境静默跳过，这里连真实实现都不需要，但 store 顶层 import 了它
  default: {},
}));

/** 让 fire-and-forget 的可信层写完（persist 内部只 await 一层微任务） */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 卡住某个键的读回：调用后该键的 settingsApi.get 会挂住，直到 releaseLateReadback(key) */
function holdReadback(key: string) {
  h.gates.set(key, () => {});
}
async function releaseLateReadback(key: string) {
  const release = h.gates.get(key);
  h.gates.delete(key);
  release?.();
  await flush();
}

function resetStores() {
  useThemeStore.getState().resetConfig();
  useLayoutStore.getState().resetLayout();
  useTypographyDefaultsStore.getState().reset();
  useWritingPrefsStore.getState().reset();
  useBookTypographyStore.getState().reset();
  useLanguageStore.setState({ lang: 'zh-CN' as Lang, initialized: false });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
    initialized: false,
  });
  useSettingsSyncStore.getState().reset();
}

beforeEach(async () => {
  h.kv.clear();
  h.gates.clear();
  h.fail.clear();
  localStorage.clear();
  // resetStores() 里那些 resetXxx 自己就会落一次库，而且是 fire-and-forget，
  // 所以要先把它们等完再清写入账：本文件的写入断言问的是「这次 init 有没有多写」，
  // 把铺路数的写入算进来就是一条假红（第一版就是这么红的）。
  resetStores();
  await flush();
  h.writes.length = 0;
});

describe('主题域 · 迟到读数不得整份盖回用户刚改的那一档', () => {
  it('门控超时后选了深色 → 迟到库值只补他没碰过的维度，不抢回明暗', async () => {
    // 库里是「浅色 + 靛蓝 + 大字号」（用户很久前调好的一套）
    h.kv.set(
      THEME_SETTINGS_KEY,
      JSON.stringify({ mode: 'light', preset: 'indigo', fontSize: 'large', borderRadius: 'medium' }),
    );
    holdReadback(THEME_SETTINGS_KEY);
    const initing = useThemeStore.getState().init();

    // 首帧门控到点放行后，用户做的第一件事：切深色
    useThemeStore.getState().setMode('dark');
    await releaseLateReadback(THEME_SETTINGS_KEY);
    await initing;

    const config = useThemeStore.getState().config;
    expect(config.mode, '迟到的库读数把用户刚选的深色抢回去了 → 「设置点了没生效」').toBe('dark');
    // 另一向：他没碰过的维度必须从库里补回来，不能停在内置默认
    expect(config.preset).toBe('indigo');
    expect(config.fontSize, '用户在窗口里那次整份写入把字号冲成了默认档，合并时要按库值修回来').toBe('large');
    expect(useThemeStore.getState().initialized, '门控标志必须放行，否则界面永久白屏').toBe(true);
  });

  it('合并结果重新落库：库里不再停在「刚选的深色被抹掉」那份读值', async () => {
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'light', preset: 'indigo', fontSize: 'large' }));
    holdReadback(THEME_SETTINGS_KEY);
    const initing = useThemeStore.getState().init();
    useThemeStore.getState().setMode('dark');
    await releaseLateReadback(THEME_SETTINGS_KEY);
    await initing;

    const persisted = JSON.parse(h.kv.get(THEME_SETTINGS_KEY)!) as Record<string, unknown>;
    expect(persisted.mode, '库里的 mode 必须还是用户刚选的（否则重启就又回浅色）').toBe('dark');
    expect(persisted.fontSize, '库里被那次整份写入冲掉的字号，要在合并时修回去').toBe('large');
    expect(persisted.preset).toBe('indigo');
  });

  it('无人改动时照常整份读回（防护不许把正常链路一起关掉）', async () => {
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'dark', preset: 'rose', fontSize: 'small' }));
    await useThemeStore.getState().init();
    const config = useThemeStore.getState().config;
    expect([config.mode, config.preset, config.fontSize]).toEqual(['dark', 'rose', 'small']);
    expect(
      h.writes.filter((k) => k === THEME_SETTINGS_KEY),
      '正常读回不该顺手写一次库',
    ).toHaveLength(0);
  });

  it('StrictMode 双跑 init 不产生第二次写入（第 20 轮「不白写盘」口径的延续）', async () => {
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'dark', preset: 'teal' }));
    const first = useThemeStore.getState().init();
    const second = useThemeStore.getState().init(); // 挂载→卸载→重挂载，两个 init 同时在飞
    await Promise.all([first, second]);
    await flush();
    expect(
      h.writes.filter((k) => k === THEME_SETTINGS_KEY),
      '同一份库读数被两次 init 各写回一次就是白写盘',
    ).toHaveLength(0);
    const config = useThemeStore.getState().config;
    expect([config.mode, config.preset]).toEqual(['dark', 'teal']);
  });

  it('读回直接失败（库被占 / IPC 断）时，也不许把用户刚改的那一项回落成默认', async () => {
    // get 是异步的：init() 之后同步发生的那一次 setFontSize 一定排在 reject 处理之前，
    // 所以这条走的就是「拍号之后本窗口自己改过 → catch 分支也不许盖」这一支。
    h.fail.add(THEME_SETTINGS_KEY);
    const initing = useThemeStore.getState().init();
    useThemeStore.getState().setFontSize('large');
    await initing;
    await flush();

    expect(useThemeStore.getState().config.fontSize, '读回失败走了「回落默认」，把用户刚选的大字号一起吃掉').toBe(
      'large',
    );
    expect(useThemeStore.getState().initialized, '读回失败也必须放行门控，不能让界面停住').toBe(true);
  });

  it('读回失败且无人改动时仍按旧口径回落（防护不许把兜底链路一起关掉）', async () => {
    localStorage.setItem('project-sight.theme', JSON.stringify({ mode: 'dark', preset: 'slate' }));
    h.fail.add(THEME_SETTINGS_KEY);
    await useThemeStore.getState().init();

    const config = useThemeStore.getState().config;
    expect(config.mode).toBe('dark');
    expect(config.preset).toBe('slate');
  });
});

describe('布局域 · 迟到的库值不得回滚侧栏宽度与留白档', () => {
  it('用户拖过宽度滑杆后，库里的宽度让位给他，内容留白仍按库值补回', async () => {
    h.kv.set(
      'layout',
      JSON.stringify({ preset: 'wide', sidebarWidth: 320, contentPadding: 'large', navbarStyle: 'slim' }),
    );
    holdReadback('layout');
    const initing = useLayoutStore.getState().init();
    useLayoutStore.getState().setSidebarWidth(260);
    await releaseLateReadback('layout');
    await initing;

    const config = useLayoutStore.getState().config;
    expect(config.sidebarWidth, '刚拖好的侧栏宽度被迟到读数弹回 → 典型的「设置没生效」').toBe(260);
    expect(config.contentPadding, '用户没碰过的内容留白应按库值补回，不能被默认档冲掉').toBe('large');
    expect(config.navbarStyle).toBe('slim');
    expect(JSON.parse(h.kv.get('layout')!).sidebarWidth).toBe(260);
  });
});

describe('正文默认排版域 · 合并必须同时推到模块级读数', () => {
  it('store 与 loadTypography() 两边同一个值（只改一边就是「读数与观感分家」）', async () => {
    h.kv.set(WRITING_TYPOGRAPHY_SETTINGS_KEY, JSON.stringify({ fontSize: 19, lineHeight: 2.2, paper: 'sepia' }));
    holdReadback(WRITING_TYPOGRAPHY_SETTINGS_KEY);
    const initing = useTypographyDefaultsStore.getState().init();
    useTypographyDefaultsStore.getState().setConfig({ paper: 'green' });
    await releaseLateReadback(WRITING_TYPOGRAPHY_SETTINGS_KEY);
    await initing;

    const config = useTypographyDefaultsStore.getState().config;
    expect(config.paper, '用户刚选的纸色被迟到读数抢回').toBe('green');
    expect(config.fontSize, '用户没碰过的正文字号应从库里补回 19').toBe(19);
    expect(config.lineHeight).toBe(2.2);

    // 真正的消费点在编辑器渲染路径上，它同步读的是 utils/typography 那份模块级读数
    const rendered = loadTypography(null);
    expect(rendered.paper, 'store 改了、模块级读数没跟上 → 写作台照旧显示库里的旧纸色').toBe('green');
    expect(rendered.fontSize).toBe(19);
  });
});

describe('写作偏好域 · 「首次使用写缺省档」那条分支不许盖掉用户刚选的档位', () => {
  it('库里还没有这一键 + 用户已开禅模式 → 不落缺省档、不回滚', async () => {
    holdReadback(WRITING_PREFS_SETTINGS_KEY);
    const initing = useWritingPrefsStore.getState().init();
    useWritingPrefsStore.getState().setFocusMode('zen');
    await releaseLateReadback(WRITING_PREFS_SETTINGS_KEY);
    await initing;

    expect(useWritingPrefsStore.getState().config.focusMode, '迟到的「空库」分支把刚开的禅模式覆盖回默认').toBe('zen');
    expect(JSON.parse(h.kv.get(WRITING_PREFS_SETTINGS_KEY)!).focusMode).toBe('zen');
    expect(useWritingPrefsStore.getState().initialized).toBe(true);
  });

  it('库里已有读数：用户改的那项以内存为准，其余按库值补回', async () => {
    h.kv.set(
      WRITING_PREFS_SETTINGS_KEY,
      JSON.stringify({ focusMode: 'normal', typewriterScroll: 'always', saveCadence: 'fast' }),
    );
    holdReadback(WRITING_PREFS_SETTINGS_KEY);
    const initing = useWritingPrefsStore.getState().init();
    useWritingPrefsStore.getState().setSaveCadence('steady');
    await releaseLateReadback(WRITING_PREFS_SETTINGS_KEY);
    await initing;

    const config = useWritingPrefsStore.getState().config;
    expect(config.saveCadence).toBe('steady');
    expect(config.typewriterScroll, '用户没碰过的打字机滚动档位被默认值冲掉了').toBe('always');
  });
});

describe('界面语言域 · 标量读数没有「按字段合并」的余地', () => {
  it('用户切过语言后，迟到的库值与首装推导值都不许盖上来', async () => {
    h.kv.set(LANGUAGE_SETTINGS_KEY, 'zh-CN');
    holdReadback(LANGUAGE_SETTINGS_KEY);
    const initing = useLanguageStore.getState().init();
    useLanguageStore.getState().setLanguage('en-US');
    await releaseLateReadback(LANGUAGE_SETTINGS_KEY);
    await initing;

    expect(useLanguageStore.getState().lang, '刚切的英文被迟到读数换回中文').toBe('en-US');
    expect(h.kv.get(LANGUAGE_SETTINGS_KEY), '库里的语言必须是用户刚选的那一门').toBe('en-US');
    expect(useLanguageStore.getState().initialized).toBe(true);
  });
});

describe('书级排版覆盖域 · 合并粒度 = 一本书', () => {
  it('库里 A 书的覆盖 + 用户本次调的 B 书，两边都在表里', async () => {
    h.kv.set(BOOK_TYPOGRAPHY_SETTINGS_KEY, JSON.stringify({ version: 1, overrides: { 'book-a': { fontSize: 20 } } }));
    holdReadback(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    const initing = useBookTypographyStore.getState().init();
    useBookTypographyStore.getState().patchBookTypography('book-b', { lineHeight: 2.4 });
    await releaseLateReadback(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    await initing;

    const overrides = useBookTypographyStore.getState().overrides;
    expect(Object.keys(overrides)).toEqual(expect.arrayContaining(['book-a', 'book-b']));
    expect(overrides['book-b'], '用户刚调的那本书被迟到读数整表换掉 → 单独排版当场消失').toEqual({ lineHeight: 2.4 });
    expect(overrides['book-a'].fontSize).toBe(20);
    const persisted = JSON.parse(h.kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!).overrides;
    expect(Object.keys(persisted)).toEqual(expect.arrayContaining(['book-a', 'book-b']));
  });

  it('用户改的那本书整本以内存为准，库里其余各本原样保留（合并粒度 = 一本书）', async () => {
    h.kv.set(
      BOOK_TYPOGRAPHY_SETTINGS_KEY,
      JSON.stringify({ version: 1, overrides: { 'book-a': { fontSize: 20 }, 'book-c': { paper: 'sepia' } } }),
    );
    holdReadback(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    const initing = useBookTypographyStore.getState().init();
    useBookTypographyStore.getState().patchBookTypography('book-a', { lineHeight: 1.8 });
    await releaseLateReadback(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    await initing;

    const overrides = useBookTypographyStore.getState().overrides;
    // 这一本上用户是「在还没读回的空表上」调的，所以他那一次就是这一本的全部真相；
    // 库里其余各本（他没碰过的）必须一并回来 —— 少一本就是他另一本书的单独排版没了。
    expect(overrides['book-a']).toEqual({ lineHeight: 1.8 });
    expect(overrides['book-c']).toEqual({ paper: 'sepia' });
    const persisted = JSON.parse(h.kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!).overrides;
    expect(Object.keys(persisted).sort()).toEqual(['book-a', 'book-c']);
  });
});

describe('外观预设域 · 它不在首帧门控里，竞态窗口比其余六域更长', () => {
  it('读回期间另存的自定义预设不许被迟到读数整表抹掉', async () => {
    h.kv.set(
      'appearance_profiles',
      JSON.stringify({ version: 3, profiles: [], activeProfileId: null, baseProfileId: null, isModified: false }),
    );
    holdReadback('appearance_profiles');
    const initing = useAppearanceStore.getState().init();
    const id = useAppearanceStore.getState().saveCurrentAsProfile('我的夜读');
    await releaseLateReadback('appearance_profiles');
    await initing;

    const profiles = useAppearanceStore.getState().profiles;
    expect(
      profiles.some((p) => p.id === id),
      '刚存的预设被迟到读数抹掉 —— 第 20 轮记过的「重启才发现预设丢了」',
    ).toBe(true);
    const persisted = JSON.parse(h.kv.get('appearance_profiles')!);
    expect(
      persisted.profiles.some((p: { id: string }) => p.id === id),
      '没落库的预设不算存住',
    ).toBe(true);
  });
});

describe('guard 原语 · 合并取舍的三条边界', () => {
  it('EVERY_FIELD 哨兵：整域以内存为准（标量读数与「显式写回同值」走这一支）', () => {
    const merged = mergeStaleReadback(
      { mode: 'light', preset: 'indigo' },
      { mode: 'dark', preset: 'default' },
      new Set([EVERY_FIELD]),
    );
    expect(merged).toEqual({ mode: 'dark', preset: 'default' });
  });

  it('用户把某项**删掉**了（customPrimary 清空 / 整本收回）：合并后不许留一条值为 undefined 的键', () => {
    // 留一条 undefined 会让「Object.keys(表).length」这类读数虚高 —— 抽屉那句
    // 「N 本书单独调过排版」就会多算一本（第 32 轮为同样的问题专门立过口径）。
    type Overrides = Record<string, { fontSize?: number; paper?: string }>;
    const db: Overrides = { 'book-a': { fontSize: 20 }, 'book-c': { paper: 'sepia' } };
    const current: Overrides = { 'book-c': { paper: 'sepia' } };
    const merged = mergeStaleReadback<Overrides>(db, current, new Set(['book-a']));
    expect('book-a' in merged).toBe(false);
    expect(Object.keys(merged)).toEqual(['book-c']);
  });

  it('内存里有、库里没有的新维度字段：用户改过就带上，不许在合并时弄丢', () => {
    const merged = mergeStaleReadback({ mode: 'light' }, { mode: 'light', uiFont: 'serif' }, new Set(['uiFont']));
    expect(merged).toEqual({ mode: 'light', uiFont: 'serif' });
  });

  it('isSameReadbackByFields：键集不同就不算相同（少一本 / 多一本都不能被读成「没变化」而免写）', () => {
    expect(isSameReadbackByFields({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(isSameReadbackByFields({ a: 1, b: undefined as unknown }, { a: 1 })).toBe(false);
    expect(isSameReadbackByFields({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('本轮无人改动 ⇒ 走正常路径整份读回（拍号之后的改动才算数，此前的不算）', async () => {
    // 先留一份「上一轮改动」的脏账，再让本轮 init 在无人改动的情况下读回：
    // 若 capture() 不清账，这里会误走合并分支，库里的 motion 就回不来。
    useThemeStore.getState().setMotion('reduce');
    h.kv.set(THEME_SETTINGS_KEY, JSON.stringify({ mode: 'dark', preset: 'slate', motion: 'auto' }));
    await useThemeStore.getState().init();
    await flush();

    const config = useThemeStore.getState().config;
    expect([config.mode, config.preset, config.motion]).toEqual(['dark', 'slate', 'auto']);
  });
});
