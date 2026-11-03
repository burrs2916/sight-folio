// 第三十六轮 · 代码编辑器字号微调迁入设置库（store 侧行为锁）
//
// 用户那两句原话在「代码字号微调」这一维上的具体形状：
//  ① 点了「恢复默认设置」，代码区还是自己以前调过的大小 —— 因为那份微调不在 resetAll 的覆盖面里；
//  ② 换设备 / 重装后设置没了 —— 因为它躺在 localStorage，从来不在设置备份的那 7 个键里；
//  ③ 另一窗口改了微调，这边已开着的编辑器停在旧值 —— 因为它不广播；
//  ④ 没落盘也没人知道 —— 因为写失败是空 catch。
// 所以每一例都验到「落进设置库」那一层，而不是只验内存里改了数。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useThemeStore, THEME_SETTINGS_KEY, normalizeThemeConfig } from '../themeStore';
import { useAppearanceStore, BUILT_IN_PROFILES } from '../appearanceStore';
import { collectSettingsSnapshot } from '../../utils/settingsBackup';
import { broadcastAppearanceChange } from '../../services/appearanceSync';
import { settingsApi } from '../../services/tauri';
import { CODE_FONT_ZOOM_MAX, CODE_FONT_ZOOM_MIN } from '../../theme/appearanceScales';

const { kv } = vi.hoisted(() => ({ kv: new Map<string, string>() }));

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: vi.fn(async (key: string, value: string) => {
      kv.set(key, value);
    }),
    delete: async (key: string) => {
      kv.delete(key);
    },
  },
}));

vi.mock('../../services/appearanceSync', () => ({
  broadcastAppearanceChange: vi.fn(),
}));

const setSpy = vi.mocked(settingsApi.set);
const broadcastSpy = vi.mocked(broadcastAppearanceChange);

/** 落盘是 fire-and-forget（可信层内部还有重试），等一个宏任务让写入落地 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const ZOOM_IN_DB = (zoom: number | null) =>
  JSON.stringify({
    mode: 'system',
    preset: 'default',
    fontSize: 'medium',
    borderRadius: 'medium',
    motion: 'auto',
    uiFont: 'system',
    ...(zoom === null ? {} : { codeFontZoom: zoom }),
  });

function resetMemory(zoom?: number) {
  useThemeStore.setState({
    config: {
      mode: 'system',
      preset: 'default',
      fontSize: 'medium',
      borderRadius: 'medium',
      motion: 'auto',
      uiFont: 'system',
      codeFontZoom: zoom ?? 0,
    },
    systemMode: 'light',
    systemReducedMotion: false,
    initialized: true,
  });
}

/** 读设置库里那一维（所有「真记住了」的断言都按这个口径，而不是看内存） */
function dbZoom(): number | undefined {
  const raw = kv.get(THEME_SETTINGS_KEY);
  if (!raw) return undefined;
  return (JSON.parse(raw) as { codeFontZoom?: number }).codeFontZoom;
}

beforeEach(() => {
  kv.clear();
  localStorage.clear();
  setSpy.mockClear();
  broadcastSpy.mockClear();
  resetMemory();
});

describe('normalizeThemeConfig · 这一维的脏值口径', () => {
  it('未声明 / 脏值 / 越界都收敛回合法步数，绝不带进渲染层', () => {
    expect(normalizeThemeConfig({}).codeFontZoom).toBe(0);
    expect(normalizeThemeConfig({ codeFontZoom: undefined }).codeFontZoom).toBe(0);
    expect(normalizeThemeConfig({ codeFontZoom: 'abc' as unknown as number }).codeFontZoom).toBe(0);
    expect(normalizeThemeConfig({ codeFontZoom: 999 }).codeFontZoom).toBe(CODE_FONT_ZOOM_MAX);
    expect(normalizeThemeConfig({ codeFontZoom: -999 }).codeFontZoom).toBe(CODE_FONT_ZOOM_MIN);
  });

  it('「没声明」与「显式声明 0 步」是同一生效值（否则反查预设会白抖一次已微调）', () => {
    const bare = normalizeThemeConfig({});
    const explicit = normalizeThemeConfig({ codeFontZoom: 0 });
    expect(bare.codeFontZoom).toBe(explicit.codeFontZoom);
    expect(useThemeStore.getState().config.codeFontZoom).toBe(0);
  });
});

describe('写入口 · 即时生效并落进设置库', () => {
  it('setCodeFontZoom：改一档 → 内存 + 设置库 + 广播三处同源', async () => {
    useThemeStore.getState().setCodeFontZoom(3);
    await settle();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(3);
    expect(dbZoom()).toBe(3);
    // 广播带的就是这一份配置：另一窗口 hydrate 之后代码区跟着变
    expect(broadcastSpy).toHaveBeenCalledWith('theme', expect.objectContaining({ codeFontZoom: 3 }));
  });

  it('越界值在写之前就被钳住：抽屉/状态栏不可能把 999 步写进库', async () => {
    useThemeStore.getState().setCodeFontZoom(999);
    await settle();
    expect(dbZoom()).toBe(CODE_FONT_ZOOM_MAX);

    useThemeStore.getState().setCodeFontZoom(-999);
    await settle();
    expect(dbZoom()).toBe(CODE_FONT_ZOOM_MIN);
  });

  it('adjustCodeFontZoom 连续加到端点就停住（不越过区间，也不回绕）', async () => {
    for (let i = 0; i < 20; i++) useThemeStore.getState().adjustCodeFontZoom(1);
    await settle();
    expect(useThemeStore.getState().config.codeFontZoom).toBe(CODE_FONT_ZOOM_MAX);
    expect(dbZoom()).toBe(CODE_FONT_ZOOM_MAX);

    for (let i = 0; i < 40; i++) useThemeStore.getState().adjustCodeFontZoom(-1);
    await settle();
    expect(useThemeStore.getState().config.codeFontZoom).toBe(CODE_FONT_ZOOM_MIN);
  });

  it('脏增量不该把用户的微调凭空清零（按了没反应 ≠ 回到档位基准）', () => {
    useThemeStore.getState().setCodeFontZoom(4);
    useThemeStore.getState().adjustCodeFontZoom(Number.NaN);
    expect(useThemeStore.getState().config.codeFontZoom).toBe(4);
  });
});

describe('恢复默认 · 这一维终于跟着复位', () => {
  it('resetConfig 之后设置库里也是缺省步数（此前恢复默认管不到它）', async () => {
    useThemeStore.getState().setCodeFontZoom(6);
    await settle();
    expect(dbZoom()).toBe(6);

    useThemeStore.getState().resetConfig();
    await settle();
    expect(useThemeStore.getState().config.codeFontZoom).toBe(0);
    expect(dbZoom()).toBe(0);
  });

  it('从外观预设的「恢复默认」入口进来同样复位（走的是抽屉底部那颗按钮的同一条链）', async () => {
    useThemeStore.getState().setCodeFontZoom(5);
    await settle();

    useAppearanceStore.getState().resetAll();
    await settle();
    expect(dbZoom()).toBe(0);
  });
});

describe('点外观预设 · 不该顺手改掉手感', () => {
  it('内置预设没声明这一维 → 点它只换皮肤，微调原样留着', async () => {
    useThemeStore.getState().setCodeFontZoom(3);
    await settle();

    useAppearanceStore.getState().applyProfile('night');
    await settle();

    // 皮肤确实换了（证明这次 apply 真的执行了，而不是断言跑了个空操作）
    expect(useThemeStore.getState().config.mode).toBe('dark');
    // 2026-11-03 档位改版：night 预设的原「大圆」= 自定义 12px（迁移表口径），皮肤维度照换不误
    expect(useThemeStore.getState().config.borderRadius).toBe('custom');
    expect(useThemeStore.getState().config.borderRadiusCustom).toBe(12);
    // 代码字号微调不在它的管辖范围里
    expect(useThemeStore.getState().config.codeFontZoom).toBe(3);
    expect(dbZoom()).toBe(3);
  });

  it('自定义预设声明了它 → 应用这张卡就把微调一起换过去（存一套 = 存全套）', () => {
    resetMemory(2);
    const id = useAppearanceStore.getState().saveCurrentAsProfile('我的深色');
    expect(useAppearanceStore.getState().getProfile(id)?.theme.codeFontZoom).toBe(2);

    useThemeStore.getState().setCodeFontZoom(0);
    useAppearanceStore.getState().applyProfile(id);
    expect(useThemeStore.getState().config.codeFontZoom).toBe(2);
  });

  it('微调不参与预设反查：内置预设没声明这一维，改了它不该把高亮判成「已微调」', () => {
    // 「夜读」这张内置卡的读数取自注册表本身（写死一份参数，改内置预设时会假绿）
    const night = BUILT_IN_PROFILES.find((p) => p.id === 'night');
    if (!night) throw new Error('内置预设里没有 night：这把锁的判据需要重新对准');
    useThemeStore.setState({ config: { ...night.theme, codeFontZoom: 0 } });
    useAppearanceStore.getState().detectActiveProfile(useThemeStore.getState().config, night.layout);
    const matchedWithZero = useAppearanceStore.getState().activeProfileId;

    // 只把微调挪一步，其它一切不变 → 高亮必须还在那张卡上（声明式匹配的口径）
    useThemeStore.setState({ config: { ...useThemeStore.getState().config, codeFontZoom: 4 } });
    useAppearanceStore.getState().detectActiveProfile(useThemeStore.getState().config, night.layout);
    expect(useAppearanceStore.getState().activeProfileId).toBe(matchedWithZero);
    expect(matchedWithZero).toBe('night');
  });
});

describe('跨窗口 · 只改了微调也要能被认成「变了」', () => {
  it('hydrate 收到只带微调差异的配置 → 本窗口跟上', () => {
    resetMemory(0);
    useThemeStore.getState().hydrate({
      mode: 'system',
      preset: 'default',
      fontSize: 'medium',
      borderRadius: 'medium',
      motion: 'auto',
      uiFont: 'system',
      codeFontZoom: 5,
    });
    expect(useThemeStore.getState().config.codeFontZoom).toBe(5);
  });

  it('收到完全相同的读数时不重渲染（isSameThemeConfig 认这一维，否则每切一次明暗白刷一次）', () => {
    resetMemory(2);
    const before = useThemeStore.getState().config;
    useThemeStore.getState().hydrate({ ...before, codeFontZoom: 2 });
    expect(useThemeStore.getState().config).toBe(before);
  });
});

describe('旧落点一次性迁移 · 老用户升级当天手感不变', () => {
  it('库里有读数但没声明这一维 → 采信旧步数并清掉旧键', async () => {
    kv.set(THEME_SETTINGS_KEY, ZOOM_IN_DB(null));
    localStorage.setItem('ps.editor.fontZoom', '3');

    await useThemeStore.getState().init();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(3);
    expect(localStorage.getItem('ps.editor.fontZoom')).toBeNull();
  });

  it('库里已经声明了 → 库为准，旧键只负责被清掉（否则旧值永远盖住新值）', async () => {
    kv.set(THEME_SETTINGS_KEY, ZOOM_IN_DB(1));
    localStorage.setItem('ps.editor.fontZoom', '3');

    await useThemeStore.getState().init();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(1);
    expect(localStorage.getItem('ps.editor.fontZoom')).toBeNull();
  });

  it('更老的绝对像素键折算成相对步数，且不再叠第二层', async () => {
    kv.set(THEME_SETTINGS_KEY, ZOOM_IN_DB(null));
    localStorage.setItem('ps.editor.fontSize', '16');

    await useThemeStore.getState().init();

    // 16px = medium 基准 13 + 3 步；直接采信 16 当步数会把档位彻底盖掉
    expect(useThemeStore.getState().config.codeFontZoom).toBe(3);
    expect(localStorage.getItem('ps.editor.fontSize')).toBeNull();
  });

  it('设置库里连主题读数都没有 + 旧落点有微调 → 补上这一维并落库，别让它凭空丢', async () => {
    localStorage.setItem('ps.editor.fontZoom', '2');

    await useThemeStore.getState().init();
    await settle();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(2);
    expect(dbZoom()).toBe(2);
  });

  it('读库失败时旧落点已被清掉 → 兜底配置必须照样采信它（否则这次微调两头都不在）', async () => {
    const getSpy = vi.spyOn(settingsApi, 'get').mockRejectedValueOnce(new Error('IPC down'));
    localStorage.setItem('ps.editor.fontZoom', '5');

    await useThemeStore.getState().init();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(5);
    getSpy.mockRestore();
  });

  it('本机从来没有这一维 → 保持缺省步数，不凭空造出偏移', async () => {
    kv.set(THEME_SETTINGS_KEY, ZOOM_IN_DB(null));

    await useThemeStore.getState().init();

    expect(useThemeStore.getState().config.codeFontZoom).toBe(0);
  });
});

describe('设置备份 · 这一维终于在那份快照里', () => {
  it('导出的 theme 键里带着 codeFontZoom（备份「假装完整」就是这一类病灶）', async () => {
    useThemeStore.getState().setCodeFontZoom(4);
    await settle();

    const snapshot = await collectSettingsSnapshot();
    const themeRaw = snapshot.settings[THEME_SETTINGS_KEY];
    expect(themeRaw).toBeTruthy();
    expect((JSON.parse(themeRaw) as { codeFontZoom?: number }).codeFontZoom).toBe(4);
  });
});
