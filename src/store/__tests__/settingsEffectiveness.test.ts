// 设置「真的生效 + 真的记住」回归锁（第十八轮）
//
// 用户诉求：「右侧的设置抽屉——外观预设、颜色模式、主题色彩、字体大小、圆角风格、布局预设，
// 确保设置完成后生效，关闭软件、启停软件设置不会失效。」
//
// 本文件锁住历史上真实断过的四类链路（每类都对应一处可定位的旧实现）：
//  ① 单项微调把 preset 抹成 "default" —— 用户点一下侧栏折叠，「布局预设」高亮就跳走；
//  ② applyProfile 只覆盖 3 个布局字段 —— 预设里声明的 sidebarCollapsed / sidebarWidth 被模板默认值吃掉；
//  ③ 自定义预设不参与反查 —— 存了自己的预设，一开抽屉高亮就被清空；
//  ④ 重启读回：布局 / 正文默认排版都从设置库 KV 恢复，脏值逐项回落而不是炸界面。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayoutStore, LAYOUT_PRESET_DEFAULTS, DEFAULT_LAYOUT_CONFIG, isConfigMatchingPreset } from '../layoutStore';
import type { LayoutConfig } from '../layoutStore';
import { useThemeStore } from '../themeStore';
import { useAppearanceStore, BUILT_IN_PROFILES } from '../appearanceStore';
import { useTypographyDefaultsStore, WRITING_TYPOGRAPHY_SETTINGS_KEY } from '../typographyDefaultsStore';
// 书级排版覆盖（第三十轮 P1）：这一域本轮从 localStorage 迁进设置库，优先级口径在这里一起锁
import { useBookTypographyStore, BOOK_TYPOGRAPHY_SETTINGS_KEY } from '../bookTypographyStore';
import { loadTypography, DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH_RANGE } from '../../theme/appearanceScales';

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
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function resetAll() {
  useThemeStore.getState().resetConfig();
  useLayoutStore.getState().resetLayout();
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
  // 书级覆盖是模块级读数 + store 读数两处（第三十轮 P1），两边都要归零才谈得上「优先级」
  useBookTypographyStore.getState().reset();
}

beforeEach(() => {
  kv.clear();
  localStorage.clear();
  resetAll();
});

describe('布局单项微调 · 不再篡改用户选的模板', () => {
  it('改顶栏样式 / 内容留白 / 侧栏位置 / 侧栏宽度都不动 preset', () => {
    useLayoutStore.getState().applyPreset('wide');
    const { setNavbarStyle, setContentPadding, setSidebarPosition, setSidebarWidth } = useLayoutStore.getState();
    setNavbarStyle('slim');
    setContentPadding('large');
    setSidebarPosition('right');
    setSidebarWidth(320);
    expect(useLayoutStore.getState().config.preset, '单项微调把布局模板抹掉了 → 面板高亮会跳到「标准」').toBe('wide');
  });

  it('折叠/展开侧栏不切模板，且展开时恢复可调宽度（不回弹成 240）', () => {
    useLayoutStore.getState().applyPreset('wide');
    useLayoutStore.getState().setSidebarWidth(300);
    useLayoutStore.getState().toggleSidebar();
    const collapsedConfig = useLayoutStore.getState().config;
    expect(collapsedConfig.sidebarCollapsed).toBe(true);
    // 折叠态下 sidebarWidth 仍存「展开态宽度」（渲染层用 SIDEBAR_COLLAPSED_WIDTH 画图标栏），
    // 所以折叠不会冲掉用户调好的宽度
    expect(collapsedConfig.sidebarWidth).toBe(300);
    expect(collapsedConfig.sidebarWidth).not.toBe(SIDEBAR_COLLAPSED_WIDTH);
    expect(collapsedConfig.preset).toBe('wide');

    useLayoutStore.getState().toggleSidebar();
    const expanded = useLayoutStore.getState().config;
    expect(expanded.sidebarCollapsed).toBe(false);
    expect(expanded.sidebarWidth, '展开后宽度被重置，用户调好的侧栏宽度白设').toBe(300);
  });

  it('isConfigMatchingPreset 如实反映「是否仍等于模板默认」（面板据此显示已微调）', () => {
    useLayoutStore.getState().applyPreset('default');
    expect(isConfigMatchingPreset(useLayoutStore.getState().config)).toBe(true);
    useLayoutStore.getState().setContentPadding('large');
    expect(isConfigMatchingPreset(useLayoutStore.getState().config)).toBe(false);
  });

  it('侧栏宽度收敛到合法区间（脏值不会把界面挤没）', () => {
    useLayoutStore.getState().setSidebarWidth(10);
    expect(useLayoutStore.getState().config.sidebarWidth).toBe(SIDEBAR_WIDTH_RANGE.min);
    useLayoutStore.getState().setSidebarWidth(5000);
    expect(useLayoutStore.getState().config.sidebarWidth).toBe(SIDEBAR_WIDTH_RANGE.max);
  });
});

describe('布局设置 · 重启读回', () => {
  it('设置库里的布局在 init 后完整恢复（含位置 / 顶栏 / 留白 / 宽度）', async () => {
    const persisted: LayoutConfig = {
      preset: 'wide',
      sidebarCollapsed: false,
      sidebarWidth: 300,
      sidebarPosition: 'right',
      contentPadding: 'large',
      navbarStyle: 'slim',
      // 内容宽度也要能重启读回：这一维曾只在内存里调，关掉软件就回到标准档
      contentWidth: 'narrow',
      // 全出血页口径（第二十七轮）：同理，「我开了三页遵循布局」不该在重启后被抹回默认
      fullBleedFollowsLayout: true,
    };
    kv.set('layout', JSON.stringify(persisted));
    useLayoutStore.setState({ config: { ...LAYOUT_PRESET_DEFAULTS.default, preset: 'default' }, initialized: false });
    await useLayoutStore.getState().init();
    expect(useLayoutStore.getState().config).toEqual(persisted);
  });

  it('老设置库没有「全出血页」字段时按关读回 —— 升级当天三页仍保持无边距', async () => {
    // 第 26 轮之前的库里压根没这个键。读到 undefined 必须收敛成 false，
    // 否则 App.tsx 的 shellFollowsLayout 会拿到 undefined 走 falsy 分支 —— 结果碰巧对，
    // 但抽屉的选中态与「已微调」判定读的是 store 读数，缺一处收敛就会显示成已改动。
    kv.set('layout', JSON.stringify({ preset: 'default', ...LAYOUT_PRESET_DEFAULTS.default }));
    useLayoutStore.setState({ initialized: false });
    await useLayoutStore.getState().init();
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(false);
    // 脏值（字符串 'true' / 数字 1）也不算开：只有显式 true 才让三页放弃无边距
    kv.set(
      'layout',
      JSON.stringify({ preset: 'default', ...LAYOUT_PRESET_DEFAULTS.default, fullBleedFollowsLayout: 'yes' }),
    );
    useLayoutStore.setState({ initialized: false });
    await useLayoutStore.getState().init();
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(false);
  });

  it('切布局模板 / 应用预设不抹掉「全出血页」现值（模板不管这一维）', () => {
    useLayoutStore.getState().setFullBleedFollowsLayout(true);
    useLayoutStore.getState().applyPreset('compact');
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(true);
    // 反向：模板同样不该顺手把它打开
    useLayoutStore.getState().setFullBleedFollowsLayout(false);
    useLayoutStore.getState().applyPreset('wide');
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(false);
  });

  it('档位外的脏值逐项回落默认，不把 undefined 传给渲染层', async () => {
    kv.set(
      'layout',
      JSON.stringify({ preset: 'focus', navbarStyle: 'hidden', sidebarPosition: 'top', contentPadding: 'giant' }),
    );
    useLayoutStore.setState({ initialized: false });
    await useLayoutStore.getState().init();
    const config = useLayoutStore.getState().config;
    expect(config.preset).toBe('default');
    expect(config.navbarStyle).toBe('standard');
    expect(config.sidebarPosition).toBe('left');
    expect(config.contentPadding).toBe('medium');
  });

  it('老设置库没有内容宽度字段时按标准档读回，而不是把 undefined 传给渲染层', async () => {
    // 升级前的库就是这个形状（第二十一轮才加 contentWidth）：读回必须是缺省档而不是 undefined，
    // 否则消费点 resolveContentMaxWidth(undefined) 靠兜底救场，抽屉里的选中态却会空掉。
    kv.set('layout', JSON.stringify({ preset: 'default', ...LAYOUT_PRESET_DEFAULTS.default }));
    useLayoutStore.setState({ initialized: false });
    await useLayoutStore.getState().init();
    expect(useLayoutStore.getState().config.contentWidth).toBe('default');
  });

  it('每次改动都写设置库（不点保存也不会丢）', async () => {
    await useLayoutStore.getState().init();
    useLayoutStore.getState().setNavbarStyle('slim');
    await flush();
    expect(JSON.parse(kv.get('layout')!).navbarStyle).toBe('slim');
  });
});

describe('外观预设 · 应用与记忆', () => {
  it('applyProfile 全量落地自定义预设的侧栏状态（不再被模板默认值覆盖）', () => {
    const custom = {
      id: 'my-wide',
      name: '我的宽栏',
      theme: { mode: 'light', preset: 'blue', fontSize: 'medium', borderRadius: 'medium' } as const,
      layout: {
        preset: 'compact',
        sidebarCollapsed: false,
        sidebarWidth: 320,
        sidebarPosition: 'left',
        contentPadding: 'medium',
        navbarStyle: 'slim',
      } as LayoutConfig,
    };
    // 预设没声明内容宽度这一维：先把现值调到 full，应用后必须还是 full
    // （模板/预设只管它声明的字段，顺手把内容宽度打回标准档就是「设置又没记住」）
    useLayoutStore.getState().setContentWidth('full');
    useAppearanceStore.getState().addProfile(custom);
    useAppearanceStore.getState().applyProfile('my-wide');
    // 声明的是「compact 模板 + 展开 + 320px」，三个字段都必须按声明生效
    const applied = useLayoutStore.getState().config;
    expect({
      preset: applied.preset,
      sidebarCollapsed: applied.sidebarCollapsed,
      sidebarWidth: applied.sidebarWidth,
      sidebarPosition: applied.sidebarPosition,
      contentPadding: applied.contentPadding,
      navbarStyle: applied.navbarStyle,
    }).toEqual(custom.layout);
    expect(applied.contentWidth).toBe('full');
  });

  it('自定义预设参与反查：应用后 detect 仍认它（否则一开抽屉高亮就被清空）', () => {
    const custom = {
      id: 'mine',
      name: '我的一套',
      theme: {
        mode: 'dark',
        preset: 'green',
        fontSize: 'small',
        borderRadius: 'custom',
        borderRadiusCustom: 20,
      } as const,
      layout: {
        preset: 'default',
        ...LAYOUT_PRESET_DEFAULTS.default,
        contentPadding: 'large',
      } as LayoutConfig,
    };
    useAppearanceStore.getState().addProfile(custom);
    useAppearanceStore.getState().applyProfile('mine');
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    const state = useAppearanceStore.getState();
    expect(state.activeProfileId).toBe('mine');
    expect(state.isModified).toBe(false);
  });

  it('saveCurrentAsProfile 把当前实际生效值沉淀成新预设并高亮', () => {
    useThemeStore.getState().setPreset('orange');
    useLayoutStore.getState().setNavbarStyle('slim');
    const id = useAppearanceStore.getState().saveCurrentAsProfile('我的橙');
    const state = useAppearanceStore.getState();
    expect(state.profiles.find((p) => p.id === id)).toMatchObject({ name: '我的橙', isBuiltIn: false });
    expect(state.activeProfileId).toBe(id);
    expect(state.isModified).toBe(false);
    expect(useThemeStore.getState().config.preset).toBe('orange');
  });

  it('revertToBaseProfile 从「已微调」回到基准预设原样', () => {
    const office = BUILT_IN_PROFILES.find((p) => p.id === 'office')!;
    useAppearanceStore.getState().applyProfile('office');
    useThemeStore.getState().setFontSize('large');
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    expect(useAppearanceStore.getState().isModified).toBe(true);

    useAppearanceStore.getState().revertToBaseProfile();
    // 逐项断言预设声明过的维度；motion / contentWidth 预设没声明，还原时不该被顺手改掉
    const theme = useThemeStore.getState().config;
    expect({
      mode: theme.mode,
      preset: theme.preset,
      fontSize: theme.fontSize,
      borderRadius: theme.borderRadius,
    }).toEqual({
      mode: office.theme.mode,
      preset: office.theme.preset,
      fontSize: office.theme.fontSize,
      borderRadius: office.theme.borderRadius,
    });
    const layout = useLayoutStore.getState().config;
    expect({
      preset: layout.preset,
      sidebarCollapsed: layout.sidebarCollapsed,
      sidebarWidth: layout.sidebarWidth,
      sidebarPosition: layout.sidebarPosition,
      contentPadding: layout.contentPadding,
      navbarStyle: layout.navbarStyle,
    }).toEqual(office.layout);
    expect(useAppearanceStore.getState().isModified).toBe(false);
  });

  it('删除自定义预设时同步清掉当前/基准引用；内置预设删不掉', () => {
    const id = useAppearanceStore.getState().saveCurrentAsProfile('临时');
    useAppearanceStore.getState().deleteProfile(id);
    const state = useAppearanceStore.getState();
    expect(state.profiles.find((p) => p.id === id)).toBeUndefined();
    expect(state.activeProfileId).toBeNull();
    expect(state.baseProfileId).toBeNull();

    const builtInCount = state.profiles.filter((p) => p.isBuiltIn).length;
    useAppearanceStore.getState().deleteProfile('office');
    expect(useAppearanceStore.getState().profiles.filter((p) => p.isBuiltIn)).toHaveLength(builtInCount);
  });

  it('resetAll 主题与布局一起复位（原来只能复位主题）', () => {
    useThemeStore.getState().setMode('dark');
    useLayoutStore.getState().applyPreset('wide');
    useLayoutStore.getState().setContentWidth('full');
    useAppearanceStore.getState().saveCurrentAsProfile('留着');
    useAppearanceStore.getState().resetAll();
    expect(useThemeStore.getState().config.mode).toBe('system');
    // 恢复默认的口径 = 回到各域的 DEFAULT_* 单一真源，包含第二十一轮新增的内容宽度
    expect(useLayoutStore.getState().config).toEqual(DEFAULT_LAYOUT_CONFIG);
    expect(useLayoutStore.getState().config.contentWidth).toBe('default');
    // 自定义预设是用户的资产，恢复默认不删它
    expect(useAppearanceStore.getState().profiles.some((p) => !p.isBuiltIn)).toBe(true);
  });
});

describe('正文默认排版（新增设置项）· 生效与持久化', () => {
  const store = () => useTypographyDefaultsStore.getState();

  it('init 前用内置默认；改档后写入设置库并重开读回', async () => {
    await store().init();
    store().setConfig({ fontSize: 20, lineHeight: 2.2, pageWidth: 900 });
    await flush();
    expect(JSON.parse(kv.get(WRITING_TYPOGRAPHY_SETTINGS_KEY)!)).toMatchObject({
      fontSize: 20,
      lineHeight: 2.2,
      pageWidth: 900,
    });

    useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: false });
    await store().init();
    expect(store().config).toMatchObject({ fontSize: 20, lineHeight: 2.2, pageWidth: 900 });
  });

  it('越界 / 脏值逐项回落（字号 99 收到上界，纸色脏值回跟随主题）', async () => {
    await store().init();
    store().setConfig({ fontSize: 99, lineHeight: 9, paraSpacing: -3, paper: 'neon' as never, pageWidth: 1234 });
    expect(store().config.fontSize).toBe(22);
    expect(store().config.lineHeight).toBe(2.6);
    expect(store().config.paraSpacing).toBe(0);
    expect(store().config.paper).toBe('default');
    expect(store().config.pageWidth).toBe(760);
  });

  it('段距 0 是合法档位，不被当成「没设过」', async () => {
    await store().init();
    store().setConfig({ paraSpacing: 0 });
    expect(store().config.paraSpacing).toBe(0);
  });

  it('优先级：书级覆盖 > 全局默认 > 内置默认', async () => {
    await store().init();
    // ① 没有书级设置时，新书跟随全局默认
    store().setConfig({ fontSize: 18 });
    expect(loadTypography('book-a').fontSize).toBe(18);
    // ② 书里单独调过那一项 → 以书为准（第三十轮 P1：写入走设置库 store，不再走 localStorage）
    useBookTypographyStore.getState().patchBookTypography('book-a', { fontSize: 14 });
    expect(loadTypography('book-a').fontSize).toBe(14);
    // ③ 换一本没调过的书，仍跟随全局默认
    expect(loadTypography('book-b').fontSize).toBe(18);
  });

  it('书级覆盖只记「真的调过的那一项」，其余字段继续跟随全局默认', async () => {
    await store().init();
    await useBookTypographyStore.getState().init();
    store().setConfig({ fontSize: 18, lineHeight: 2.2 });
    useBookTypographyStore.getState().patchBookTypography('book-a', { fontSize: 14 });
    // 字号被这本书接管，行距仍跟着默认走 —— 旧实现把「合并后的整套」写回，
    // 于是调过一次字号的书从此再也不理默认排版，这正是「抽屉改字号没反应」的成因之一。
    expect(loadTypography('book-a').fontSize).toBe(14);
    expect(loadTypography('book-a').lineHeight).toBe(2.2);
    store().setConfig({ lineHeight: 1.6 });
    expect(loadTypography('book-a').lineHeight).toBe(1.6);
    expect(loadTypography('book-a').fontSize).toBe(14);
  });

  it('书级覆盖落设置库、重开读回，且清掉后回到跟随默认（P1 的主诉求）', async () => {
    await useBookTypographyStore.getState().init();
    useBookTypographyStore.getState().patchBookTypography('book-a', { paper: 'sepia', indent: true });
    await flush();
    // 落的是带版本信封的一张表（多本书共用一个键，与 appearance_profiles 同口径）
    expect(JSON.parse(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!)).toMatchObject({
      version: 1,
      overrides: { 'book-a': { paper: 'sepia', indent: true } },
    });
    // 模拟重启：内存清空后从库里读回
    useBookTypographyStore.getState().reset();
    expect(loadTypography('book-a').paper).toBe(DEFAULT_TYPOGRAPHY.paper);
    await useBookTypographyStore.getState().init();
    expect(loadTypography('book-a').paper).toBe('sepia');
    expect(loadTypography('book-a').indent).toBe(true);
    // 「让本书重新跟随默认」这条出口真的能清掉，且清掉后库里也没有残留
    useBookTypographyStore.getState().clearBookTypography('book-a');
    await flush();
    expect(loadTypography('book-a').paper).toBe(DEFAULT_TYPOGRAPHY.paper);
    expect(JSON.parse(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!).overrides).toEqual({});
  });

  it('老 localStorage 逐本排版：首启动迁进设置库并清掉旧键，之后不再复活', async () => {
    // 先把「正文默认排版」钉成一个与迁移值不同的读数，这样「清掉覆盖后回到哪一版」才是可分辨的
    store().setConfig({ fontSize: 17 });
    localStorage.setItem('sight-folio.typography.book-legacy', JSON.stringify({ ...DEFAULT_TYPOGRAPHY, fontSize: 20 }));
    await useBookTypographyStore.getState().init();
    await flush();
    expect(loadTypography('book-legacy').fontSize).toBe(20);
    expect(JSON.parse(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!)).toMatchObject({
      overrides: { 'book-legacy': { fontSize: 20 } },
    });
    expect(localStorage.getItem('sight-folio.typography.book-legacy')).toBeNull();
    // 迁移只在「库里还没有这一键」时发生：库里有了真源之后，旧键即便被别的窗口残留也不该盖回
    useBookTypographyStore.getState().clearBookTypography('book-legacy');
    await flush();
    localStorage.setItem('sight-folio.typography.book-legacy', JSON.stringify({ ...DEFAULT_TYPOGRAPHY, fontSize: 20 }));
    await useBookTypographyStore.getState().init();
    expect(loadTypography('book-legacy').fontSize).toBe(17);
    expect(localStorage.getItem('sight-folio.typography.book-legacy')).toBeNull();
  });

  it('hydrate（另一窗口广播 / 备份恢复）只改内存，不再写一次库造成回声', async () => {
    await useBookTypographyStore.getState().init();
    kv.delete(BOOK_TYPOGRAPHY_SETTINGS_KEY);
    useBookTypographyStore.getState().hydrate({ version: 1, overrides: { 'book-c': { fontSize: 21 } } });
    expect(loadTypography('book-c').fontSize).toBe(21);
    expect(kv.has(BOOK_TYPOGRAPHY_SETTINGS_KEY)).toBe(false);
  });
});
