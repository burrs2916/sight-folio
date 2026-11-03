import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { broadcastAppearanceChange } from '../services/appearanceSync';
import { persistSettings } from './settingsSyncStore';
import { CONTENT_WIDTH_OPTIONS, SIDEBAR_COLLAPSED_WIDTH, clampSidebarWidth } from '../theme/appearanceScales';
// 读回迟到竞态防护（第三十四轮）：口径与为什么需要它见 settingsReadbackGuard.ts 文件头
import { attachSettingsReadbackGuard, mergeStaleReadback, isSameReadbackByFields } from './settingsReadbackGuard';

export type LayoutPreset = 'default' | 'compact' | 'wide';
export type SidebarPosition = 'left' | 'right';
export type ContentPadding = 'none' | 'small' | 'medium' | 'large';
export type NavbarStyle = 'standard' | 'slim';
/**
 * 内容区宽度上限（第二十一轮新增设置项）。
 * 此前主内容壳的 `maxWidth: 1700px` 是 App.tsx 里的硬编码：27 寸屏上正文被压在中间一条、
 * 两侧大片空白，想铺开只能改代码。档位表见 theme/appearanceScales.ts（单一真源）。
 */
export type ContentWidth = 'narrow' | 'default' | 'wide' | 'full';

/** 内容区宽度的缺省档（未声明即按此解读，与标准档 1700px 一致 = 老用户观感不变） */
export const CONTENT_WIDTH_DEFAULT: ContentWidth = 'default';

/**
 * 全出血页遵循布局两档的缺省值：**false** = 三页保持无边距、不限宽（2026-09 以来的既成事实）。
 * 老库没这个字段 → 读到 undefined 也按 false 解读，升级当天观感不变。
 */
export const FULL_BLEED_FOLLOWS_LAYOUT_DEFAULT = false;

/** 读数收敛：只有显式 true 才算开（脏值 / 缺字段 / 字符串 'true' 都不算，与档位收敛同一保守口径） */
export function resolveFullBleedFollowsLayout(value: unknown): boolean {
  return value === true;
}

export interface LayoutConfig {
  preset: LayoutPreset;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  sidebarPosition: SidebarPosition;
  contentPadding: ContentPadding;
  navbarStyle: NavbarStyle;
  /**
   * 内容区宽度上限。**可选**：与 AppearanceProfile.typography / ThemeConfig.motion 同口径 ——
   * 没声明即「本套配置不管内容宽度」，内置外观预设一律不声明，消费侧按 default 档解读。
   */
  contentWidth?: ContentWidth;
  /**
   * 全出血页（工作室 /analyzer、语料库 /library、AI 助手 /ai）是否也遵循「内容留白」与「内容区宽度」。
   *
   * 为什么需要这一项（第二十七轮，收第 26 轮待办 1）：这三页在 `App.tsx` 里被强制 `p:0 / maxWidth:none`，
   * 起因是用户 2026-09-19 / 09-28 / 10-05 三次点名「编辑区没占满、四周还有空隙」—— 那是**真实的产品决策**，
   * 不能为了「让设置看起来生效」把它悄悄改回去（那会让画布再次被压在中间一条）。
   * 但另一头，「内容留白 / 内容区宽度」这两档在三页上无声失效，用户读到的仍是「设置没生效」。
   * 口径：**默认关**（保持三页无边距的既成事实），打开后三页一并遵循这两档 ——
   * 例外从此写在设置项里、由创作者自己决定，而不是藏在代码里。
   */
  fullBleedFollowsLayout?: boolean;
}

const LAYOUT_SETTINGS_KEY = 'layout';
/**
 * 本域真正落库的字段清单（第三十四轮，给读回竞态防护用）。
 * 与 `LayoutConfig` 逐字段对齐：以后加布局字段记得同时加进来，否则那一项在「迟到读数」里
 * 会被当成「用户没碰过」而按库值回填（漏登记的后果见 settingsRound34.test.ts 的扫描锁）。
 */
const LAYOUT_PERSISTED_FIELDS = [
  'preset',
  'sidebarCollapsed',
  'sidebarWidth',
  'sidebarPosition',
  'contentPadding',
  'navbarStyle',
  'contentWidth',
  'fullBleedFollowsLayout',
] as const;

const LAYOUT_PRESET_DEFAULTS: Record<LayoutPreset, Omit<LayoutConfig, 'preset'>> = {
  default: {
    sidebarCollapsed: false,
    sidebarWidth: 240,
    sidebarPosition: 'left',
    contentPadding: 'medium',
    navbarStyle: 'standard',
  },
  compact: {
    sidebarCollapsed: true,
    // 模板只描述**展开态**宽度：折叠宽度是常量 64（图标栏），由渲染层在 collapsed 时使用。
    // 曾经把这里写成 64，于是「折叠一次再展开」会把用户调好的宽度冲成模板值（设置留不住）。
    sidebarWidth: 240,
    sidebarPosition: 'left',
    contentPadding: 'small',
    navbarStyle: 'slim',
  },
  wide: {
    sidebarCollapsed: false,
    sidebarWidth: 280,
    sidebarPosition: 'left',
    contentPadding: 'large',
    navbarStyle: 'standard',
  },
};

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  preset: 'default',
  ...LAYOUT_PRESET_DEFAULTS.default,
  contentWidth: CONTENT_WIDTH_DEFAULT,
  fullBleedFollowsLayout: FULL_BLEED_FOLLOWS_LAYOUT_DEFAULT,
};

interface LayoutState {
  config: LayoutConfig;
  initialized: boolean;

  init: () => Promise<void>;
  applyPreset: (preset: LayoutPreset) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarPosition: (position: SidebarPosition) => void;
  setContentPadding: (padding: ContentPadding) => void;
  setNavbarStyle: (style: NavbarStyle) => void;
  /** 内容区宽度上限（第二十一轮）：档位表见 theme/appearanceScales.ts，消费点 App.tsx 内容壳 */
  setContentWidth: (width: ContentWidth) => void;
  /** 全出血页（工作室/语料库/AI）是否遵循内容留白与内容宽度（第二十七轮）：消费点 App.tsx 内容壳 */
  setFullBleedFollowsLayout: (follows: boolean) => void;
  setConfig: (config: Partial<LayoutConfig>) => void;
  /** 全量应用一套布局（外观预设用）：preset 与各字段一并落地，不再被模板默认值覆盖 */
  applyConfig: (config: LayoutConfig) => void;
  /** 跨窗口跟随：只把另一窗口广播来的布局并进内存，绝不回写设置库（避免回声与互相覆盖） */
  hydrate: (config: Partial<LayoutConfig> | null | undefined) => void;
  resetLayout: () => void;
}

const _persist = (config: LayoutConfig) => {
  // 广播与落库同处：另一窗口立刻跟随同一套布局（侧栏位置/宽度、顶栏样式、内容留白）
  broadcastAppearanceChange('layout', config);
  // 第二十轮：统一可信层（失败重试 + 状态可读），不再只 console.error 把失败吞进控制台
  persistSettings('layout', LAYOUT_SETTINGS_KEY, JSON.stringify(config));
};

const PRESETS: LayoutPreset[] = ['default', 'compact', 'wide'];
const SIDEBAR_POSITIONS: SidebarPosition[] = ['left', 'right'];
const CONTENT_PADDING: ContentPadding[] = ['none', 'small', 'medium', 'large'];
const NAVBAR_STYLES: NavbarStyle[] = ['standard', 'slim'];
const CONTENT_WIDTHS: ContentWidth[] = CONTENT_WIDTH_OPTIONS;

/**
 * 内容区宽度档位的读数口径：**未声明 = 缺省档**，脏值同样回落缺省档。
 * 抽成函数是因为三处都要用同一份判断（消费点 App.tsx、模板一致性判定、跨窗口 hydrate），
 * 各写一份 `?? "default"` 迟早会漂移成「设置读了不生效」。
 */
function resolveContentWidth(width: unknown): ContentWidth {
  return CONTENT_WIDTHS.includes(width as ContentWidth) ? (width as ContentWidth) : CONTENT_WIDTH_DEFAULT;
}

/** 模板/预设没声明内容宽度时保住用户现值（切布局模板不该顺手把内容宽度打回标准档） */
function carryContentWidth(next: Partial<LayoutConfig>, current: LayoutConfig): ContentWidth {
  return next.contentWidth === undefined
    ? resolveContentWidth(current.contentWidth)
    : resolveContentWidth(next.contentWidth);
}

/**
 * 同上口径的「全出血页」维度：模板与内置外观预设都不声明这一项，
 * 切模板 / 应用预设时保住用户现值 —— 否则「我明明开了三页遵循布局」会被一次模板点击抹掉。
 */
function carryFullBleedFollowsLayout(next: Partial<LayoutConfig>, current: LayoutConfig): boolean {
  return next.fullBleedFollowsLayout === undefined
    ? resolveFullBleedFollowsLayout(current.fullBleedFollowsLayout)
    : resolveFullBleedFollowsLayout(next.fullBleedFollowsLayout);
}

/**
 * 归一化「展开态宽度」。
 * 旧数据里 compact 模板把 sidebarWidth 存成 64（与折叠常量同值），这类值不当作用户意图，
 * 回落到模板展开宽度；其余按合法区间收敛。折叠常量本身不在本字段表达，由渲染层取
 * SIDEBAR_COLLAPSED_WIDTH，避免一份宽度两种含义。
 */
function resolveSidebarWidth(_collapsed: boolean, width: unknown, preset: LayoutPreset): number {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= SIDEBAR_COLLAPSED_WIDTH) return LAYOUT_PRESET_DEFAULTS[preset].sidebarWidth;
  return clampSidebarWidth(n);
}

const migrateConfig = (parsed: Partial<LayoutConfig>): LayoutConfig => {
  // 旧值兼容：focus 模板 / hidden 顶栏已废弃，逐项回落现存档位；
  // 档位外的脏值（手改设置库 / 降级安装）一律回落默认，避免渲染层拿到 undefined 档位。
  const preset: LayoutPreset = PRESETS.includes(parsed.preset as LayoutPreset)
    ? (parsed.preset as LayoutPreset)
    : DEFAULT_LAYOUT_CONFIG.preset;
  const navbarStyle: NavbarStyle = NAVBAR_STYLES.includes(parsed.navbarStyle as NavbarStyle)
    ? (parsed.navbarStyle as NavbarStyle)
    : DEFAULT_LAYOUT_CONFIG.navbarStyle;
  const sidebarPosition: SidebarPosition = SIDEBAR_POSITIONS.includes(parsed.sidebarPosition as SidebarPosition)
    ? (parsed.sidebarPosition as SidebarPosition)
    : DEFAULT_LAYOUT_CONFIG.sidebarPosition;
  const contentPadding: ContentPadding = CONTENT_PADDING.includes(parsed.contentPadding as ContentPadding)
    ? (parsed.contentPadding as ContentPadding)
    : DEFAULT_LAYOUT_CONFIG.contentPadding;
  const sidebarCollapsed = parsed.sidebarCollapsed ?? DEFAULT_LAYOUT_CONFIG.sidebarCollapsed;
  // 内容宽度：老库没有这个字段（第廿一轮新增），未声明即按缺省档解读 —— 老用户观感不变
  const contentWidth = resolveContentWidth(parsed.contentWidth);

  return {
    preset,
    sidebarCollapsed,
    sidebarWidth: resolveSidebarWidth(sidebarCollapsed, parsed.sidebarWidth, preset),
    sidebarPosition,
    contentPadding,
    navbarStyle,
    contentWidth,
    // 全出血页口径（第二十七轮新增）：老库没这个字段 → 按缺省 false 解读，升级当天三页仍无边距
    fullBleedFollowsLayout: resolveFullBleedFollowsLayout(parsed.fullBleedFollowsLayout),
  };
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  config: { ...DEFAULT_LAYOUT_CONFIG },
  initialized: false,

  init: async () => {
    // 第三十四轮：门控超时（1500ms）后界面已可交互，这段时间里用户可能已经折叠过侧栏、
    // 拖过宽度滑杆。迟到的库读数只能按字段并回来，不能整份盖 —— 否则「刚拖的宽度自己弹回去」。
    const mark = layoutReadback.capture();
    try {
      const saved = await settingsApi.get(LAYOUT_SETTINGS_KEY);
      if (layoutReadback.isStale(mark)) {
        const current = get().config;
        if (saved) {
          const merged = mergeStaleReadback<LayoutConfig>(
            migrateConfig(JSON.parse(saved) as Partial<LayoutConfig>),
            current,
            layoutReadback.dirtyKeys(),
          );
          if (!isSameReadbackByFields(merged, current, LAYOUT_PERSISTED_FIELDS)) {
            set({ config: merged, initialized: true });
            _persist(merged);
            return;
          }
        }
        set({ initialized: true });
        return;
      }
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<LayoutConfig>;
        set({ config: migrateConfig(parsed), initialized: true });
      } else {
        set({ initialized: true });
      }
    } catch (error) {
      console.error('[LayoutStore] 从后端加载布局配置失败:', error);
      set({ initialized: true });
    }
  },

  applyPreset: (preset: LayoutPreset) => {
    const defaults = LAYOUT_PRESET_DEFAULTS[preset];
    // 模板未声明内容宽度 → 保住用户现值：切一下布局模板就把内容宽度打回标准档，
    // 又是一次「设置又没记住」（模板只管它声明的那几项）。
    const config: LayoutConfig = {
      preset,
      ...defaults,
      contentWidth: carryContentWidth(defaults, get().config),
      // 同理：模板也不管「全出血页」这一项，点模板不该把创作者刚打开的口径抹掉
      fullBleedFollowsLayout: carryFullBleedFollowsLayout(defaults, get().config),
    };
    set({ config });
    _persist(config);
  },

  // 单项微调不再篡改 preset（第十八轮修）。
  // 病灶：此前 toggleSidebar / setSidebarCollapsed / setContentPadding / setNavbarStyle /
  // setSidebarPosition 一律把 preset 强写成 "default"，于是用户只是点一下侧栏折叠按钮，
  // 「布局预设」的高亮就跳到「标准」、外观预设的反查同时失配 —— 观感即「设置没记住」。
  // 现在 preset 表示「用户选定的模板」，各字段表示「实际状态」；两者是否一致由
  // isConfigMatchingPreset() 派生给界面显示「已微调」，而不是靠抹掉选择来伪装一致。
  // 折叠/展开只翻标记：sidebarWidth 恒为展开态宽度，不因折叠而被常量覆盖，
  // 所以「调好宽度 → 折叠写正文 → 展开」仍然是原来那个宽度。
  toggleSidebar: () => {
    const config = { ...get().config, sidebarCollapsed: !get().config.sidebarCollapsed };
    set({ config });
    _persist(config);
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    const config = { ...get().config, sidebarCollapsed: collapsed };
    set({ config });
    _persist(config);
  },

  // 侧栏宽度：滑杆调的是展开态宽度；调宽即视为要看见侧栏，顺带展开
  setSidebarWidth: (width: number) => {
    const { config } = get();
    const newConfig = {
      ...config,
      sidebarWidth: clampSidebarWidth(width),
      sidebarCollapsed: false,
    };
    set({ config: newConfig });
    _persist(newConfig);
  },

  setSidebarPosition: (position: SidebarPosition) => {
    const config = { ...get().config, sidebarPosition: position };
    set({ config });
    _persist(config);
  },

  setContentPadding: (padding: ContentPadding) => {
    const config = { ...get().config, contentPadding: padding };
    set({ config });
    _persist(config);
  },

  setNavbarStyle: (style: NavbarStyle) => {
    const config = { ...get().config, navbarStyle: style };
    set({ config });
    _persist(config);
  },

  setContentWidth: (width: ContentWidth) => {
    const config = { ...get().config, contentWidth: resolveContentWidth(width) };
    set({ config });
    _persist(config);
  },

  // 全出血页口径（第二十七轮）：与其余布局项同一条链路 —— 即时生效（App.tsx 内容壳重算）、
  // 落设置库、跨窗口广播，因此重启读回与另一窗口跟随都无需额外接线。
  setFullBleedFollowsLayout: (follows: boolean) => {
    const config = { ...get().config, fullBleedFollowsLayout: resolveFullBleedFollowsLayout(follows) };
    set({ config });
    _persist(config);
  },

  setConfig: (partial: Partial<LayoutConfig>) => {
    const config = { ...get().config, ...partial };
    set({ config });
    _persist(config);
  },

  applyConfig: (next: LayoutConfig) => {
    const config: LayoutConfig = {
      ...next,
      sidebarWidth: resolveSidebarWidth(next.sidebarCollapsed, next.sidebarWidth, next.preset),
      contentWidth: carryContentWidth(next, get().config),
      fullBleedFollowsLayout: carryFullBleedFollowsLayout(next, get().config),
    };
    set({ config });
    _persist(config);
  },

  // 跨窗口跟随：一致就跳过（Tauri 的 emit 会广播回发起窗口自己）；只 set 不 persist。
  // 走 migrateConfig 而非直接覆盖：另一窗口传来脏值 / 缺字段时，本窗口同样收敛到合法档位。
  hydrate: (partial) => {
    if (!partial) return;
    const next = migrateConfig({ ...get().config, ...partial });
    if (JSON.stringify(next) === JSON.stringify(get().config)) return;
    set({ config: next });
  },

  resetLayout: () => {
    set({ config: { ...DEFAULT_LAYOUT_CONFIG } });
    _persist(DEFAULT_LAYOUT_CONFIG);
  },
}));

export { LAYOUT_PRESET_DEFAULTS, DEFAULT_LAYOUT_CONFIG, resolveContentWidth };

/** 当前布局是否仍等于所选模板的默认值（界面据此显示「已微调」，不再伪装成「标准」） */
export function isConfigMatchingPreset(config: LayoutConfig): boolean {
  const defaults = LAYOUT_PRESET_DEFAULTS[config.preset];
  return (
    defaults.sidebarCollapsed === config.sidebarCollapsed &&
    defaults.sidebarWidth === config.sidebarWidth &&
    defaults.sidebarPosition === config.sidebarPosition &&
    defaults.contentPadding === config.contentPadding &&
    defaults.navbarStyle === config.navbarStyle &&
    // 模板不声明内容宽度，两侧都按缺省档口径比较：未调过的用户不会被误判成「已微调」
    resolveContentWidth(defaults.contentWidth) === resolveContentWidth(config.contentWidth) &&
    // 「全出血页」同理：模板不声明它，但用户一旦打开，布局就确实偏离了模板，该标「已微调」
    resolveFullBleedFollowsLayout(defaults.fullBleedFollowsLayout) ===
      resolveFullBleedFollowsLayout(config.fullBleedFollowsLayout)
  );
}

/**
 * 读回竞态防护（第三十四轮）：订阅口径，理由与 themeStore 同一条 —— 本域 12 个写入口
 * （applyPreset / 四个 set 单项 / 折叠开关 / 宽度 / 内容宽度 / 全出血 / setConfig / applyConfig /
 * hydrate / resetLayout），逐处接线必然漏。
 */
const layoutReadback = attachSettingsReadbackGuard(useLayoutStore, {
  scope: 'layout',
  select: (s) => s.config,
  fields: LAYOUT_PERSISTED_FIELDS,
});
