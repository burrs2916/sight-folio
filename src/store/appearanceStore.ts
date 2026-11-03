// 外观配置持久化口径（第十七轮 T6）：自定义预设 + 当前选中的外观预设（activeProfileId /
// baseProfileId / isModified）一并写入应用设置库（settingsApi KV，键 APPEARANCE_PROFILES_KEY）。
// 重启 init() 直接读回，界面默认就是用户上次选的那套外观（不再只靠 detectActiveProfile 反查）。
// 兼容旧格式：早期只存自定义预设数组（无外层对象），读到时按数组解析。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { persistSettings } from './settingsSyncStore';
// 读回迟到竞态防护（第三十四轮）：口径与为什么需要它见 settingsReadbackGuard.ts 文件头
import { attachSettingsReadbackGuard, mergeStaleReadback, isSameReadbackByFields } from './settingsReadbackGuard';
import { t } from '../i18n';
import type { ThemeConfig } from './themeStore';
import type { LayoutConfig } from './layoutStore';
import { useThemeStore } from './themeStore';
import { useLayoutStore } from './layoutStore';
import { useTypographyDefaultsStore } from './typographyDefaultsStore';
import { useWritingPrefsStore, isSameWritingPrefs } from './writingPrefsStore';
import type { WritingPrefs } from './writingPrefsStore';
import { getGlobalTypographyDefaults } from '../utils/typography';
import type { BookTypography } from '../utils/typography';

export interface AppearanceProfile {
  id: string;
  name: string;
  description?: string;
  theme: ThemeConfig;
  layout: LayoutConfig;
  /**
   * 正文默认排版（可选）。缺省 = 这套预设只管「明暗 / 色彩 / 字号 / 圆角 / 布局」，
   * 不碰写作正文的字号行距纸色 —— 内置预设一律走这个口径，避免点一下预设就把创作者
   * 的正文排版换掉。自定义预设（另存为预设）会带上当前正文排版，做到「存一套 = 存全套」。
   */
  typography?: BookTypography;
  /**
   * 写作偏好（专注模式 / 打字机滚动 / 保存节奏）（第二十七轮，收第 25 轮待办 1）。
   *
   * **可选 = 这套预设不管写作偏好**，与 typography / motion / contentWidth 同一条
   * `declaredMatches` 口径，内置预设一律不声明 —— 理由第 25 轮已立：点一张「夜读」不该顺手
   * 把写作台切进禅模式（禅模式会连带收起左右栏，那是改变工作方式，不是改变颜色）。
   *
   * 但「我调好的一套夜读」确实常常连禅模式一起用。于是**由创作者决定要不要沉淀**：
   * 抽屉里勾上「连写作偏好一起存」，另存 / 更新预设时才把这三档存进卡里；
   * 存了之后点这张卡才会一并落地，反查「已微调」也随之算这一维。
   */
  writing?: WritingPrefs;
  isBuiltIn?: boolean;
}

/**
 * 「另存为预设 / 更新为当前状态」的沉淀范围（第二十七轮）。
 *
 * 为什么要把这一维做成开关而不是"一律带上"：写作偏好里的专注模式会**改变工作台的形态**
 * （禅模式收起左右栏），点一张外观预设顺手切形态是越界；但创作者自己调好的一套夜读，
 * 又确实常常连禅模式一起用。所以带上与否交给他勾，默认不带（保持第 25 轮的裁决不变）。
 */
export interface SaveProfileOptions {
  /** true = 连「专注模式 / 打字机滚动 / 保存节奏」一起沉淀进这张卡 */
  includeWriting?: boolean;
}

/** 外观配置的持久化键（设置库 KV）：存自定义预设 + 当前选中预设状态。 */
const APPEARANCE_PROFILES_KEY = 'appearance_profiles';

/** 自定义预设 id 的单调后缀（见 saveCurrentAsProfile 注释：时间戳会在同一毫秒内撞 id） */
let profileIdSeq = 1;

const BUILT_IN_PROFILES: AppearanceProfile[] = [
  {
    id: 'office',
    // 内置预设的 name/description 存 i18n key（appearance.profile.*），渲染侧 resolveFragments 解引用；
    // 用户自定义 profile 存真实文本，切语言不翻译（resolveFragments 对非 key 文本原样保留）。
    name: 'appearance.profile.office.name',
    description: 'appearance.profile.office.desc',
    theme: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    layout: {
      preset: 'default',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'medium',
      navbarStyle: 'standard',
    },
    isBuiltIn: true,
  },
  {
    id: 'monitor',
    name: 'appearance.profile.monitor.name',
    description: 'appearance.profile.monitor.desc',
    theme: { mode: 'dark', preset: 'blue', fontSize: 'medium', borderRadius: 'small' },
    layout: {
      preset: 'wide',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      sidebarPosition: 'left',
      contentPadding: 'large',
      navbarStyle: 'slim',
    },
    isBuiltIn: true,
  },
  {
    id: 'editor',
    name: 'appearance.profile.editor.name',
    description: 'appearance.profile.editor.desc',
    theme: { mode: 'dark', preset: 'purple', fontSize: 'medium', borderRadius: 'small' },
    layout: {
      preset: 'compact',
      sidebarCollapsed: true,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'small',
      navbarStyle: 'slim',
    },
    isBuiltIn: true,
  },
  {
    id: 'night',
    name: 'appearance.profile.night.name',
    description: 'appearance.profile.night.desc',
    theme: { mode: 'dark', preset: 'default', fontSize: 'medium', borderRadius: 'custom', borderRadiusCustom: 12 },
    layout: {
      preset: 'compact',
      sidebarCollapsed: true,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'small',
      navbarStyle: 'slim',
    },
    isBuiltIn: true,
  },
  // ── 以下为扩充预设（2026-11-02）─────────────────────────────────────────────
  // 设计口径：每套 = 「明暗模式 + 主题色彩 + 字号 + 圆角 + 布局模板 + 内容留白 + 顶栏样式」
  // 的协调组合，各自对应一个真实使用场景；色彩取全局主题注册表已校准的 6 套色板
  // （见 src/theme/themePresets.ts），不另造色值，保证「选预设 = 选一套已协调好的配色」。
  // 布局字段（sidebarCollapsed / sidebarWidth）与对应布局模板的默认值保持一致：
  // sidebarWidth 恒为「展开态宽度」（折叠宽度是渲染层常量，不在这里表达）。
  {
    // 明亮留白 + 大字号 + 收起侧栏：把注意力集中在正文
    id: 'paper',
    name: 'appearance.profile.paper.name',
    description: 'appearance.profile.paper.desc',
    theme: { mode: 'light', preset: 'default', fontSize: 'large', borderRadius: 'custom', borderRadiusCustom: 12 },
    layout: {
      preset: 'compact',
      sidebarCollapsed: true,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'large',
      navbarStyle: 'slim',
    },
    isBuiltIn: true,
  },
  {
    // 品牌金点缀的暖色阅读界面：暖底配暖主色，大字大圆角减轻长文压迫感
    id: 'amber',
    name: 'appearance.profile.amber.name',
    description: 'appearance.profile.amber.desc',
    theme: { mode: 'light', preset: 'orange', fontSize: 'medium', borderRadius: 'custom', borderRadiusCustom: 12 },
    layout: {
      preset: 'default',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'large',
      navbarStyle: 'standard',
    },
    isBuiltIn: true,
  },
  {
    // 清透绿：浅绿底 + 松绿主色，长时间写作不刺眼
    id: 'forest',
    name: 'appearance.profile.forest.name',
    description: 'appearance.profile.forest.desc',
    theme: { mode: 'light', preset: 'green', fontSize: 'medium', borderRadius: 'custom', borderRadiusCustom: 12 },
    layout: {
      preset: 'default',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'medium',
      navbarStyle: 'standard',
    },
    isBuiltIn: true,
  },
  {
    // 高密度蓝：小字 + 小圆角 + 宽屏 + 细顶栏，一屏容纳更多信息
    id: 'ocean',
    name: 'appearance.profile.ocean.name',
    description: 'appearance.profile.ocean.desc',
    theme: { mode: 'light', preset: 'blue', fontSize: 'small', borderRadius: 'small' },
    layout: {
      preset: 'wide',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      sidebarPosition: 'left',
      contentPadding: 'medium',
      navbarStyle: 'slim',
    },
    isBuiltIn: true,
  },
  {
    // 柔紫创意：紫罗兰主色 + 全圆角，偏柔和的创作氛围
    id: 'violet',
    name: 'appearance.profile.violet.name',
    description: 'appearance.profile.violet.desc',
    theme: { mode: 'light', preset: 'purple', fontSize: 'medium', borderRadius: 'custom', borderRadiusCustom: 20 },
    layout: {
      preset: 'default',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'large',
      navbarStyle: 'standard',
    },
    isBuiltIn: true,
  },
  {
    // 午夜靛蓝：深靛蓝底 + 宽屏多栏，夜间处理大量文档
    id: 'midnight',
    name: 'appearance.profile.midnight.name',
    description: 'appearance.profile.midnight.desc',
    theme: { mode: 'dark', preset: 'indigo', fontSize: 'medium', borderRadius: 'medium' },
    layout: {
      preset: 'wide',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      sidebarPosition: 'left',
      contentPadding: 'large',
      navbarStyle: 'slim',
    },
    isBuiltIn: true,
  },
  {
    // 石墨极简：深色 + 直角 + 小字号 + 紧凑侧栏，信息密度最高
    id: 'graphite',
    name: 'appearance.profile.graphite.name',
    description: 'appearance.profile.graphite.desc',
    theme: { mode: 'dark', preset: 'default', fontSize: 'small', borderRadius: 'none' },
    layout: {
      preset: 'compact',
      sidebarCollapsed: true,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'small',
      navbarStyle: 'slim',
    },
    isBuiltIn: true,
  },
  {
    // 随光自动：明暗交给系统，湖蓝主色作为中性稳妥的默认
    id: 'system',
    name: 'appearance.profile.system.name',
    description: 'appearance.profile.system.desc',
    theme: { mode: 'system', preset: 'blue', fontSize: 'medium', borderRadius: 'medium' },
    layout: {
      preset: 'default',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      sidebarPosition: 'left',
      contentPadding: 'medium',
      navbarStyle: 'standard',
    },
    isBuiltIn: true,
  },
];

/**
 * 预设「声明了才参与反查」的通用口径：未声明（内置预设的 motion / contentWidth / typography）
 * 即这套预设本来不管这一维度，用户在这维度上怎么调都不该把高亮判成「已微调」。
 * 第二十一轮把这条口径从排版推广到动效与内容宽度，实现只留一处，后面再加维度不会漏。
 */
function declaredMatches<T>(declared: T | undefined, actual: T): boolean {
  return declared === undefined || declared === actual;
}

/**
 * 按「实际生效值」反查它属于哪套预设。
 * 遍历的是 profiles（内置 + 自定义）而非只遍历内置：病灶是自定义预设不参与反查，用户把自己
 * 调好的一套存成预设并应用后，一打开设置抽屉反查失败 → 高亮被清空，看起来像「预设没保存住」。
 */
function matchProfile(
  theme: ThemeConfig,
  layout: LayoutConfig,
  typography: BookTypography,
  writing: WritingPrefs,
  candidates: AppearanceProfile[],
): string | null {
  for (const profile of candidates) {
    const t = profile.theme;
    const l = profile.layout;
    // 预设未声明排版（内置预设都是这种）→ 排版不参与匹配，否则用户调一次正文行距
    // 就会把高亮判成「已微调」，而这套预设本来就不管排版。
    const typographyMatches = !profile.typography || isSameTypography(profile.typography, typography);
    // 写作偏好同口径（第二十七轮）：没声明就不参与反查。勾了「连写作偏好一起存」的自定义预设
    // 才会算这一维 —— 于是「改了禅模式」只会让那张**真的管禅模式**的卡标成已微调。
    const writingMatches = !profile.writing || isSameWritingPrefs(profile.writing, writing);
    if (
      typographyMatches &&
      writingMatches &&
      theme.mode === t.mode &&
      theme.preset === t.preset &&
      theme.fontSize === t.fontSize &&
      theme.borderRadius === t.borderRadius &&
      declaredMatches(t.motion, theme.motion) &&
      // 界面字体同口径：内置预设不声明它，用户换字族不该把高亮判成「已微调」
      declaredMatches(t.uiFont, theme.uiFont) &&
      // 代码字号微调同口径（第三十六轮）：这一维是「手感」不是「皮肤」，内置预设一律不声明，
      // 所以点一张内置卡不该顺手把创作者调好的代码字号改回去
      declaredMatches(t.codeFontZoom, theme.codeFontZoom) &&
      (theme.preset !== 'custom' || theme.customPrimary === t.customPrimary) &&
      layout.preset === l.preset &&
      layout.sidebarCollapsed === l.sidebarCollapsed &&
      layout.sidebarWidth === l.sidebarWidth &&
      layout.sidebarPosition === l.sidebarPosition &&
      layout.contentPadding === l.contentPadding &&
      layout.navbarStyle === l.navbarStyle &&
      declaredMatches(l.contentWidth, layout.contentWidth)
    ) {
      return profile.id;
    }
  }
  return null;
}

/** 排版逐项比较：只比字段值，不比对象引用（每次读回都是新对象） */
function isSameTypography(a: BookTypography, b: BookTypography): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.paraSpacing === b.paraSpacing &&
    a.fontFamily === b.fontFamily &&
    a.latinFontFamily === b.latinFontFamily &&
    a.indent === b.indent &&
    a.pageWidth === b.pageWidth &&
    a.paper === b.paper
  );
}

interface AppearanceState {
  profiles: AppearanceProfile[];
  initialized: boolean;
  activeProfileId: string | null;
  baseProfileId: string | null;
  isModified: boolean;

  init: () => Promise<void>;
  /** 备份恢复：只采纳预设清单，不顺手盖掉当前选中态（详见实现处注释） */
  adoptProfiles: (raw: string) => void;
  getProfile: (id: string) => AppearanceProfile | undefined;
  addProfile: (profile: AppearanceProfile) => void;
  updateProfile: (id: string, updates: Partial<Omit<AppearanceProfile, 'id' | 'isBuiltIn'>>) => void;
  deleteProfile: (id: string) => void;
  detectActiveProfile: (theme: ThemeConfig, layout: LayoutConfig) => void;
  applyProfile: (profileId: string) => void;
  saveCurrentAsProfile: (name?: string, options?: SaveProfileOptions) => string;
  /**
   * 用「当前实际生效的外观」就地覆盖某张自定义预设（第二十一轮）。
   * 病灶：此前只有「另存为新预设」和「还原该预设」，微调后想把所选预设就地更新，
   * 只能删掉重建（updateProfile 早就能写，UI 一直没接）。返回是否覆盖成功。
   */
  overwriteProfileWithCurrent: (profileId: string, options?: SaveProfileOptions) => boolean;
  revertToBaseProfile: () => void;
  resetAll: () => void;
}

interface PersistedAppearance {
  version: number;
  profiles: AppearanceProfile[];
  activeProfileId: string | null;
  baseProfileId: string | null;
  isModified: boolean;
}

/** 把「自定义预设 + 当前选中状态」一并落盘（内置预设不存，靠代码里的定义）。 */
const _persist = (state: Pick<AppearanceState, 'profiles' | 'activeProfileId' | 'baseProfileId' | 'isModified'>) => {
  const payload: PersistedAppearance = {
    // v3：自定义预设开始携带 typography。v2 数据缺该字段即视为「预设不管正文排版」，
    // 读取侧无需迁移分支（字段可选），老库直接可用。
    // 第二十轮只把写入换成统一可信层（失败自动重试 + 状态可读），payload 结构一字未改，
    // 因此版本号保持 v3 —— 空升版本会让读回侧误判成需要迁移。
    version: 3,
    profiles: state.profiles.filter((p) => !p.isBuiltIn),
    activeProfileId: state.activeProfileId,
    baseProfileId: state.baseProfileId,
    isModified: state.isModified,
  };
  // 第二十轮：外观预设同样走可信层。此前只 console.error，自定义预设没写进去时
  // 界面高亮照旧，重启才发现「预设丢了」。
  persistSettings('appearance', APPEARANCE_PROFILES_KEY, JSON.stringify(payload));
};

/**
 * 把库里的预设清单读成「本窗口状态形状」（第三十四轮，给读回竞态的合并用）。
 * 内置预设始终来自代码、库里只存自定义那几套；旧版裸数组格式同样认（与 init 的兼容口径一致）。
 */
function readDbAppearanceState(
  saved: string,
): Pick<AppearanceState, 'profiles' | 'activeProfileId' | 'baseProfileId' | 'isModified'> {
  const parsed = JSON.parse(saved) as PersistedAppearance | AppearanceProfile[];
  const customProfiles = Array.isArray(parsed) ? parsed : (parsed.profiles ?? []);
  const profiles = [...BUILT_IN_PROFILES, ...customProfiles.map((p) => ({ ...p, isBuiltIn: false }))];
  if (Array.isArray(parsed)) {
    return { profiles, activeProfileId: null, baseProfileId: null, isModified: false };
  }
  const active = typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : null;
  return {
    profiles,
    activeProfileId: active,
    baseProfileId: typeof parsed.baseProfileId === 'string' ? parsed.baseProfileId : active,
    isModified: Boolean(parsed.isModified),
  };
}

/** 本域真正落库的字段（第三十四轮，给读回竞态防护用）；`initialized` 刻意不在其中 */
const APPEARANCE_PERSISTED_FIELDS = ['profiles', 'activeProfileId', 'baseProfileId', 'isModified'] as const;

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  profiles: [...BUILT_IN_PROFILES],
  initialized: false,
  activeProfileId: null,
  baseProfileId: null,
  isModified: false,

  init: async () => {
    // 第三十四轮：这一域不在首帧门控里（第 29 轮定：它不参与首帧渲染），于是竞态窗口比其余六域
    // 更长 —— 从「界面出来」到「init 回来」之间存的自定义预设都会被迟到的读数整表抹掉，
    // 而卡片列表照旧亮着那张，直到重启才发现「预设丢了」（第 20 轮就记过这个观感）。
    const mark = appearanceReadback.capture();
    try {
      const saved = await settingsApi.get(APPEARANCE_PROFILES_KEY);
      if (appearanceReadback.isStale(mark)) {
        const current = {
          profiles: get().profiles,
          activeProfileId: get().activeProfileId,
          baseProfileId: get().baseProfileId,
          isModified: get().isModified,
        };
        if (saved) {
          const merged = mergeStaleReadback<Record<string, unknown>>(
            readDbAppearanceState(saved) as unknown as Record<string, unknown>,
            current as unknown as Record<string, unknown>,
            appearanceReadback.dirtyKeys(),
          );
          if (!isSameReadbackByFields(merged, current, APPEARANCE_PERSISTED_FIELDS)) {
            set({ ...(merged as unknown as AppearanceState), initialized: true });
            _persist(merged as unknown as AppearanceState);
            return;
          }
        }
        set({ initialized: true });
        return;
      }
      if (!saved) {
        set({ initialized: true });
        return;
      }
      const parsed = JSON.parse(saved) as PersistedAppearance | AppearanceProfile[];
      // 兼容旧格式：早期直接存自定义预设数组
      const customProfiles = Array.isArray(parsed) ? parsed : (parsed.profiles ?? []);
      // 旧版自定义预设缺 motion / contentWidth 等新维度字段：这里刻意**不补默认值**。
      // 「字段缺失」正是「这套预设不管这一维度」的表达（与 typography 同一口径，见 declaredMatches），
      // 补上默认值反而会让老预设下次启动突然开始管起动效和内容宽度。
      const merged = [...BUILT_IN_PROFILES, ...customProfiles.map((p) => ({ ...p, isBuiltIn: false }))];
      if (Array.isArray(parsed)) {
        set({ profiles: merged, initialized: true });
      } else {
        const active = typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : null;
        set({
          profiles: merged,
          activeProfileId: active,
          baseProfileId: typeof parsed.baseProfileId === 'string' ? parsed.baseProfileId : active,
          isModified: Boolean(parsed.isModified),
          initialized: true,
        });
      }
    } catch (error) {
      console.error('[AppearanceStore] 从后端加载外观方案失败:', error);
      set({ initialized: true });
    }
  },

  /**
   * 采纳一份「已落库的外观预设读数」（设置备份恢复用，第二十七轮，收第 25 轮待办 5）。
   *
   * 病灶：恢复备份此前走的是 `init()` —— 那会把 `activeProfileId` / `isModified` 也一并盖成
   * 备份导出那一刻的值。两个后果：① 备份只含部分键时（老备份 / 用户只勾了几域），
   * 主题没变而选中态被换掉，高亮指向一套与界面完全不符的预设；② 恢复动作「顺手」改了
   * 用户此刻正在用的那套，界面上却没有任何解释。
   *
   * 口径：这里**只采纳预设清单**（自定义预设回来了 = 恢复备份真正要的东西）。
   * 选中态的处理是「引用还成立就留着，指向已不存在的预设才清掉」，
   * 至于它是否还该高亮，交给 `detectActiveProfile` 按**实际生效值**反查（同一口径，不另造一套）。
   */
  adoptProfiles: (raw: string) => {
    const parsed = JSON.parse(raw) as PersistedAppearance | AppearanceProfile[];
    const customProfiles = Array.isArray(parsed) ? parsed : (parsed.profiles ?? []);
    // 与 init() 同一口径：自定义预设缺 motion / contentWidth / writing 等新维度字段时刻意不补默认值，
    // 「字段缺失」正是「这套预设不管这一维度」的表达。
    const profiles = [...BUILT_IN_PROFILES, ...customProfiles.map((p) => ({ ...p, isBuiltIn: false }))];
    const exists = (id: string | null) => (id === null ? null : profiles.some((p) => p.id === id) ? id : null);
    const { activeProfileId: prevActive, baseProfileId: prevBase } = get();
    const nextActive = exists(prevActive);
    const nextBase = exists(prevBase);
    set({ profiles, activeProfileId: nextActive, baseProfileId: nextBase });
    // 选中态被清掉时才落盘：引用仍成立就保持原读数，恢复备份不该白写一次设置库。
    // 注意比较必须在 set 之前取旧值 —— set 之后 get() 已经是新读数，比出来永远相等。
    if (nextActive !== prevActive || nextBase !== prevBase) _persist(get());
  },

  getProfile: (id: string) => {
    return get().profiles.find((p) => p.id === id);
  },

  addProfile: (profile: AppearanceProfile) => {
    const profiles = [...get().profiles, { ...profile, isBuiltIn: false }];
    set({ profiles });
    _persist({ ...get(), profiles });
  },

  updateProfile: (id: string, updates: Partial<Omit<AppearanceProfile, 'id' | 'isBuiltIn'>>) => {
    const profiles = get().profiles.map((p) => (p.id === id ? { ...p, ...updates } : p));
    set({ profiles });
    _persist({ ...get(), profiles });
  },

  deleteProfile: (id: string) => {
    const target = get().profiles.find((p) => p.id === id);
    // 内置预设不可删（删了下次启动又回来，只会造成列表跳动）
    if (!target || target.isBuiltIn) return;
    const profiles = get().profiles.filter((p) => p.id !== id);
    const { activeProfileId, baseProfileId } = get();
    set({
      profiles,
      // 删掉的正是当前/基准预设时同步清掉引用，否则高亮与「还原」指向一套已不存在的预设
      activeProfileId: activeProfileId === id ? null : activeProfileId,
      baseProfileId: baseProfileId === id ? null : baseProfileId,
    });
    _persist(get());
  },

  // 正文排版不进入参数：typographyDefaultsStore 每次变化都会把读数推给 utils/typography 的
  // 模块级默认值（那边是编辑器渲染路径上的同步读取点），从那里取即是当前生效值，
  // 也让调用方（设置抽屉）无需为一个可选维度改签名。
  detectActiveProfile: (theme: ThemeConfig, layout: LayoutConfig) => {
    // 写作偏好也从 store 现取（与排版取模块级默认值同理）：调用方（抽屉）不必为一个可选维度改签名
    const writing = useWritingPrefsStore.getState().config;
    const matchedId = matchProfile(theme, layout, getGlobalTypographyDefaults(), writing, get().profiles);
    const { baseProfileId, activeProfileId, isModified: prevModified } = get();
    const nextBase = matchedId !== null ? matchedId : baseProfileId;
    const nextModified = matchedId === null && nextBase !== null;
    // 仅在真实变化时落盘：面板每次打开都会反查，避免无谓写设置库
    if (activeProfileId === matchedId && baseProfileId === nextBase && prevModified === nextModified) return;
    set({ activeProfileId: matchedId, baseProfileId: nextBase, isModified: nextModified });
    _persist(get());
  },

  // 全量落地：主题与布局都按预设声明一次性写入。
  // 病灶（第十八轮修）：此前这里先 applyPreset(layout.preset) 铺模板默认值，再只覆盖
  // position / padding / navbarStyle 三项，preset 里声明的 sidebarCollapsed 与 sidebarWidth
  // 被模板默认值吃掉 —— 用户看到的现象是「选了预设，侧栏却不完全按预设变」。
  applyProfile: (profileId: string) => {
    const profile = get().profiles.find((p) => p.id === profileId);
    if (!profile) return;
    useThemeStore.getState().setConfig(profile.theme);
    useLayoutStore.getState().applyConfig(profile.layout);
    // 预设声明了排版才动正文默认值；未声明（内置预设）保持用户现有排版不变
    if (profile.typography) useTypographyDefaultsStore.getState().setConfig(profile.typography);
    // 写作偏好同一口径（第二十七轮）：只有勾着「连写作偏好一起存」沉淀出来的卡才带这一维，
    // 点内置「夜读」不会把写作台切进禅模式 —— 那是改变工作方式，不是改变外观。
    if (profile.writing) useWritingPrefsStore.getState().setConfig(profile.writing);
    set({ activeProfileId: profileId, baseProfileId: profileId, isModified: false });
    _persist(get());
  },

  /**
   * 把「当前实际生效的外观」另存为自定义预设（设置面板调好一套后沉淀成可复用资产）。
   * 返回新预设 id；名称留空时按序号自动命名。
   */
  saveCurrentAsProfile: (name?: string, options?: SaveProfileOptions) => {
    const theme = useThemeStore.getState().config;
    const layout = useLayoutStore.getState().config;
    // 单调计数器进 id：只用时间戳时，同一毫秒内连续另存两张预设会撞同一个 id，
    // 而所有读写都走 profiles.find(p => p.id === ...) —— 撞 id 后改名/应用/删除只会命中先那张，
    // 后存的那套等于凭空丢掉（React 列表也会报 duplicate key）。
    const id = `custom-${Date.now().toString(36)}-${(profileIdSeq++).toString(36)}`;
    const seq = get().profiles.filter((p) => !p.isBuiltIn).length + 1;
    const profile: AppearanceProfile = {
      id,
      // 自动命名走 i18n（此前硬编码「外观方案 N」：英文界面下存出来的预设挂着中文名，
      // 且与抽屉其余文案不同源）。放在 action 内取值，切语言后新预设跟当前语言一致。
      name: name && name.trim() ? name.trim() : t('settings.presetAutoName', { n: seq }),
      theme: { ...theme },
      layout: { ...layout },
      // 「另存为预设」沉淀的是全套：连正文默认排版一起存，下次点这张卡一步回到今天的状态
      typography: { ...useTypographyDefaultsStore.getState().config },
      // 写作偏好**按勾选**沉淀（第二十七轮）：没勾就不写这个字段，于是这张卡永远不管禅模式，
      // 点它只换外观。带与不带都在卡的数据里自证，不靠调用方的记忆。
      ...(options?.includeWriting ? { writing: { ...useWritingPrefsStore.getState().config } } : {}),
      isBuiltIn: false,
    };
    set({
      profiles: [...get().profiles, profile],
      activeProfileId: id,
      baseProfileId: id,
      isModified: false,
    });
    _persist(get());
    return id;
  },

  overwriteProfileWithCurrent: (profileId: string, options?: SaveProfileOptions) => {
    const target = get().profiles.find((p) => p.id === profileId);
    // 内置预设不可覆盖：它们的定义在代码里，写进设置库也会在下次启动被内置值盖回，
    // 用户看到的现象就是「覆盖了但没生效」。要给内置预设换参数，请另存为自定义预设。
    if (!target || target.isBuiltIn) return false;
    const profile: AppearanceProfile = {
      ...target,
      // name / description / isBuiltIn 原样保留：覆盖的是「这套外观的参数」，不是这张卡的身份
      theme: { ...useThemeStore.getState().config },
      layout: { ...useLayoutStore.getState().config },
      typography: { ...useTypographyDefaultsStore.getState().config },
      // 没勾 → 这一维**原样保留**（走上面的 `...target`）而不是被抹掉：
      // 「更新为当前状态」更新的是外观，悄悄把这张卡本来管的禅模式删掉属于另一件事。
      ...(options?.includeWriting ? { writing: { ...useWritingPrefsStore.getState().config } } : {}),
    };
    const profiles = get().profiles.map((p) => (p.id === profileId ? profile : p));
    set({ profiles, activeProfileId: profileId, baseProfileId: profileId, isModified: false });
    _persist(get());
    return true;
  },

  /** 还原到所选预设的原始定义（从「已微调」回到「该预设本来的样子」） */
  revertToBaseProfile: () => {
    const { baseProfileId } = get();
    if (!baseProfileId) return;
    get().applyProfile(baseProfileId);
  },

  /** 恢复默认：主题 + 布局 + 正文默认排版 + 写作偏好一起复位（第二十五轮带上第四域） */
  resetAll: () => {
    useThemeStore.getState().resetConfig();
    useLayoutStore.getState().resetLayout();
    // 抽屉底部按钮文案写着「恢复默认设置（含布局与正文排版）」，实现必须真的覆盖每一项：
    // 否则用户点完恢复默认，写作台字号 / 行距 / 纸色仍是上一套，观感就是「设置没生效」。
    useTypographyDefaultsStore.getState().reset();
    // 写作偏好（第二十五轮）：这一域是第二十四轮建的，reset() 当时写好却没有调用点 ——
    // 于是「恢复默认」漏掉专注模式与保存节奏，用户点完仍留着禅模式，又是一处「说了没做」。
    useWritingPrefsStore.getState().reset();
    set({ activeProfileId: null, baseProfileId: null, isModified: false });
    _persist(get());
  },
}));

export { BUILT_IN_PROFILES };

/**
 * 读回竞态防护（第三十四轮）。`select` 取整份 state，所以关掉「同值重写也算改过」：
 * 否则 init 自己把 `initialized` 翻成真就会被下一轮读回判成「用户改过」，白写一次库。
 * 四个落库字段（预设表 / 选中态 / 沉淀基准 / 微调标记）都在这份清单里，逐处 _persist 的
 * 9 个写入口一次覆盖，不必逐处接线。
 */
const appearanceReadback = attachSettingsReadbackGuard(useAppearanceStore, {
  scope: 'appearance',
  select: (s) => s,
  fields: APPEARANCE_PERSISTED_FIELDS,
  countSameValueRewrite: false,
});
