// 第二十八轮 · 第 27 轮新功能的 store 侧回归锁（推进记录第 27 轮待办 1 的 ①②③）
//
// 第 27 轮落了四件事但一条锁都没配（当时因轮次被截，明写「下一轮唯一必须交付的东西」）。
// 本文件锁住其中属于 store 语义的三条：
//  ① 外观预设的「连写作偏好一起存」：不声明不碰 / 声明了才落地 / 更新未勾选时原样保留 / 反查算这一维；
//  ② adoptProfiles 恢复备份：只采纳预设清单，选中态不被静默盖掉，引用失效才清并落盘；
//  ③ 全出血页开关 setFullBleedFollowsLayout：写库 → init 读回 → 布局「已微调」判定如实。
// （④ 打字机滚动与 ⑤ 字号扫描锁在 utils/__tests__/typewriterScroll.test.ts 与
//   theme/__tests__/settingsRound28.test.ts，UI 接线在 components/__tests__/SettingsDrawerRound28.test.tsx。）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../appearanceStore';
import { useThemeStore } from '../themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG, isConfigMatchingPreset } from '../layoutStore';
import { useTypographyDefaultsStore } from '../typographyDefaultsStore';
import { useWritingPrefsStore, DEFAULT_WRITING_PREFS } from '../writingPrefsStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { setLang } from '../../i18n';

const { kv, setCalls } = vi.hoisted(() => ({ kv: new Map<string, string>(), setCalls: [] as string[] }));
vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.set(key, value);
      setCalls.push(key);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
  },
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** 关掉「office」内置预设所需的全部维度（主题 light/default/medium/medium + 布局默认 + 默认排版/偏好） */
function seedFactoryDefaults() {
  useThemeStore.setState({
    config: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    initialized: true,
  });
  useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT_CONFIG }, initialized: true });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
  useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS }, initialized: true });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
    initialized: true,
  });
}

beforeEach(() => {
  kv.clear();
  setCalls.length = 0;
  setLang('zh-CN');
  seedFactoryDefaults();
});

describe('① 外观预设 · 写作偏好按勾选沉淀（第 25 轮待办 1 的产品裁决）', () => {
  it('不勾选另存：卡上压根不写 writing 字段 —— 这张卡永远不管禅模式', () => {
    const id = useAppearanceStore.getState().saveCurrentAsProfile('不带偏好');
    const profile = useAppearanceStore.getState().getProfile(id)!;
    expect(profile.writing).toBeUndefined();
  });

  it('勾选另存：写作偏好按「当时现值」快照进卡，且是拷贝不是引用', () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    const id = useAppearanceStore.getState().saveCurrentAsProfile('带偏好', { includeWriting: true });
    const profile = useAppearanceStore.getState().getProfile(id)!;
    expect(profile.writing).toEqual({ focusMode: 'zen', typewriterScroll: 'zen', saveCadence: 'standard' });
    // 快照语义：存卡之后再改偏好，卡里的读数不许跟着漂
    useWritingPrefsStore.getState().setFocusMode('normal');
    expect(useAppearanceStore.getState().getProfile(id)!.writing!.focusMode).toBe('zen');
  });

  it('applyProfile：内置预设不声明写作偏好 → 禅模式原样不动', () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    useAppearanceStore.getState().applyProfile('night');
    // 夜读确实换了外观（dark / large）
    expect(useThemeStore.getState().config.mode).toBe('dark');
    // 但点预设不该顺手把人从禅模式里拽出来（那是改变工作方式）
    expect(useWritingPrefsStore.getState().config.focusMode).toBe('zen');
  });

  it('applyProfile：勾着沉淀出来的卡声明了写作偏好 → 当场落地', () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    const id = useAppearanceStore.getState().saveCurrentAsProfile('一套夜读', { includeWriting: true });
    // 回到普通态，再点这张卡 → 应该切回禅模式
    useWritingPrefsStore.getState().setFocusMode('normal');
    useAppearanceStore.getState().applyProfile(id);
    expect(useWritingPrefsStore.getState().config.focusMode).toBe('zen');
  });

  it('未声明偏好的卡：点它只换外观，不碰当前偏好', () => {
    const id = useAppearanceStore.getState().saveCurrentAsProfile('不带偏好');
    useWritingPrefsStore.getState().setFocusMode('zen');
    useAppearanceStore.getState().applyProfile(id);
    expect(useWritingPrefsStore.getState().config.focusMode).toBe('zen');
  });

  it('overwriteProfileWithCurrent：没勾选时该维原样保留，而不是被抹掉', () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    const id = useAppearanceStore.getState().saveCurrentAsProfile('一套夜读', { includeWriting: true });
    // 之后：外观变了、偏好也变了，但「更新为当前状态」没勾 → 偏好维度保持存卡时的快照
    useWritingPrefsStore.getState().setFocusMode('focus');
    useThemeStore.getState().setPreset('blue');
    const ok = useAppearanceStore.getState().overwriteProfileWithCurrent(id, { includeWriting: false });
    expect(ok).toBe(true);
    const profile = useAppearanceStore.getState().getProfile(id)!;
    expect(profile.writing!.focusMode).toBe('zen');
    expect(profile.theme.preset).toBe('blue');
  });

  it('overwriteProfileWithCurrent：勾了才把当前偏好覆盖进卡', () => {
    const id = useAppearanceStore.getState().saveCurrentAsProfile('卡');
    expect(useAppearanceStore.getState().getProfile(id)!.writing).toBeUndefined();
    useWritingPrefsStore.getState().setFocusMode('zen');
    useAppearanceStore.getState().overwriteProfileWithCurrent(id, { includeWriting: true });
    expect(useAppearanceStore.getState().getProfile(id)!.writing!.focusMode).toBe('zen');
  });

  it('反查「已微调」只标真管偏好的卡：内置卡不声明，禅模式不碍它；声明过的卡一改偏好就失配', () => {
    const { detectActiveProfile } = useAppearanceStore.getState();
    // 出厂态 → 反查命中内置 office，无论偏好怎么调（office 不声明偏好吗）
    detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    expect(useAppearanceStore.getState().activeProfileId).toBe('office');
    useWritingPrefsStore.getState().setFocusMode('zen');
    detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    expect(useAppearanceStore.getState().activeProfileId).toBe('office');

    // 勾着沉淀的卡（外观上与所有内置卡错开，反查才能唯一命中它）：
    // 只改禅模式 → 该卡失配、也没有别的卡声明了偏好 → 高亮清空并标「已微调」，
    // 这是「它真管偏好这一维」的证据；基准仍指向它，「还原该预设」能一步回来。
    seedFactoryDefaults();
    useThemeStore.getState().setFontSize('large');
    const id = useAppearanceStore.getState().saveCurrentAsProfile('带偏好', { includeWriting: true });
    expect(useAppearanceStore.getState().activeProfileId).toBe(id);
    useWritingPrefsStore.getState().setFocusMode('zen');
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
    expect(useAppearanceStore.getState().activeProfileId).toBeNull();
    expect(useAppearanceStore.getState().isModified).toBe(true);
    expect(useAppearanceStore.getState().baseProfileId).toBe(id);
  });
});

describe('② adoptProfiles · 恢复备份只采纳预设清单，不静默盖选中态（第 25 轮待办 5）', () => {
  /** 造一份「另一台机器上导出」的 appearance_profiles 原始读数 */
  function snapshotRaw(activeId: string | null, customIds: string[]) {
    return JSON.stringify({
      version: 3,
      profiles: customIds.map((cid) => ({
        id: cid,
        name: cid,
        theme: { mode: 'dark', preset: 'blue', fontSize: 'medium', borderRadius: 'small' },
        layout: {
          preset: 'wide',
          sidebarCollapsed: false,
          sidebarWidth: 280,
          sidebarPosition: 'left',
          contentPadding: 'large',
          navbarStyle: 'slim',
        },
      })),
      // 备份那一刻的选中态：与本机此刻不同，adoptProfiles 不许把它盖到本机上
      activeProfileId: activeId,
      baseProfileId: activeId,
      isModified: activeId === null,
    });
  }

  it('备份里的选中态指向别的卡 → 本机 activeProfileId 原样保留，且一个字节都不多写', async () => {
    await settle(); // 清掉前面操作的写入记录
    setCalls.length = 0;
    useAppearanceStore.setState({ activeProfileId: 'mine', baseProfileId: 'mine' });
    useAppearanceStore.getState().adoptProfiles(snapshotRaw('theirs', ['mine', 'theirs']));
    await settle();
    expect(useAppearanceStore.getState().activeProfileId).toBe('mine');
    expect(useAppearanceStore.getState().baseProfileId).toBe('mine');
    expect(setCalls.filter((k) => k === 'appearance_profiles')).toHaveLength(0);
  });

  it('当前卡在这份备份里不存在 → 引用清掉（宁可无高亮也不指向不存在的卡），并落盘', async () => {
    await settle();
    setCalls.length = 0;
    useAppearanceStore.setState({ activeProfileId: 'gone', baseProfileId: 'gone' });
    useAppearanceStore.getState().adoptProfiles(snapshotRaw(null, ['other']));
    await settle();
    expect(useAppearanceStore.getState().activeProfileId).toBeNull();
    expect(useAppearanceStore.getState().baseProfileId).toBeNull();
    expect(setCalls.filter((k) => k === 'appearance_profiles')).toHaveLength(1);
    // 清掉的读数要真的写进库，否则重启后又指着不存在的卡
    expect(JSON.parse(kv.get('appearance_profiles')!).activeProfileId).toBeNull();
  });

  it('自定义预设清单被采纳；内置卡只存在于代码定义，不随恢复写进库', () => {
    // 真实链路里 kv 已由 applySettingsSnapshot.persistAndWait 写入备份读数，adopt 只并内存。
    // 引用仍成立（本机原为 null → 恢复后仍 null）时 adopt 刻意不再回写，所以库内容 = 备份内容。
    const raw = snapshotRaw(null, ['c_alpha', 'c_beta']);
    kv.set('appearance_profiles', raw);
    useAppearanceStore.getState().adoptProfiles(raw);
    const { profiles } = useAppearanceStore.getState();
    expect(profiles.some((p) => p.id === 'c_alpha')).toBe(true);
    expect(profiles.some((p) => p.id === 'c_beta')).toBe(true);
    expect(profiles.some((p) => p.id === 'office')).toBe(true);
    const persisted = JSON.parse(kv.get('appearance_profiles')!) as { profiles: { id: string }[] };
    expect(persisted.profiles.map((p) => p.id)).toEqual(['c_alpha', 'c_beta']);
  });

  it('旧格式（裸数组）读数同样能采纳', () => {
    const raw = JSON.stringify([
      {
        id: 'legacy',
        name: 'legacy',
        theme: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
        layout: {
          preset: 'default',
          sidebarCollapsed: false,
          sidebarWidth: 240,
          sidebarPosition: 'left',
          contentPadding: 'medium',
          navbarStyle: 'standard',
        },
      },
    ]);
    useAppearanceStore.getState().adoptProfiles(raw);
    expect(useAppearanceStore.getState().profiles.some((p) => p.id === 'legacy')).toBe(true);
  });

  it('备份恢复链路走 adoptProfiles 而不是 init()（消费点见 settingsBackup.adoptIntoStores，源码锁在 theme/__tests__/settingsRound28）', () => {
    // init() 会连 activeProfileId / isModified 一起盖 —— 那正是第 25 轮待办 5 的病灶形态。
    // 这里锁住语义差：init 读到备份读数会盖选中态，adoptProfiles 不会。
    useAppearanceStore.setState({ activeProfileId: 'mine', baseProfileId: 'mine' });
    kv.set('appearance_profiles', snapshotRaw('theirs', ['mine', 'theirs']));
    // 同一个读数，init 的行为就是「盖」：用它自证两个入口的分工不是巧合
    return useAppearanceStore
      .getState()
      .init()
      .then(() => {
        expect(useAppearanceStore.getState().activeProfileId).toBe('theirs'); // init 会盖 —— 所以恢复链路禁止用它
        seedFactoryDefaults();
        useAppearanceStore.setState({ activeProfileId: 'mine', baseProfileId: 'mine' });
        useAppearanceStore.getState().adoptProfiles(kv.get('appearance_profiles')!);
        // 同一份读数：'mine' 在清单里 → 引用仍成立 → 保留本机读数，不跟备份里的 'theirs' 走
        expect(useAppearanceStore.getState().activeProfileId).toBe('mine');
      });
  });
});

describe('③ 全出血页开关 · 写库读回与「已微调」判定', () => {
  it('setFullBleedFollowsLayout(true) 即写库；init 读回 true；复位后读回 false', async () => {
    useLayoutStore.getState().setFullBleedFollowsLayout(true);
    await settle();
    expect(JSON.parse(kv.get('layout')!).fullBleedFollowsLayout).toBe(true);
    useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT_CONFIG } });
    await useLayoutStore.getState().init();
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(true);

    useLayoutStore.getState().setFullBleedFollowsLayout(false);
    await settle();
    await useLayoutStore.getState().init();
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(false);
  });

  it('打开它会把布局判成「已微调」（模板不声明这一维，但用户确实偏离了模板）', () => {
    expect(isConfigMatchingPreset(useLayoutStore.getState().config)).toBe(true);
    useLayoutStore.getState().setFullBleedFollowsLayout(true);
    expect(isConfigMatchingPreset(useLayoutStore.getState().config)).toBe(false);
  });

  it('应用声明了 false 的自定义布局配置也不许把用户刚打开的 true 抹掉（未声明才保现值；显式 false 是配置自己的口径）', () => {
    useLayoutStore.getState().setFullBleedFollowsLayout(true);
    // 未声明（undefined）→ 保住 true
    useLayoutStore.getState().applyConfig({
      ...DEFAULT_LAYOUT_CONFIG,
      fullBleedFollowsLayout: undefined,
    } as never);
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(true);
    // 显式 false → 按声明落地（配置说了算，保住的是「没表态」的情形）
    useLayoutStore.getState().applyConfig({
      ...DEFAULT_LAYOUT_CONFIG,
      fullBleedFollowsLayout: false,
    });
    expect(useLayoutStore.getState().config.fullBleedFollowsLayout).toBe(false);
  });
});
