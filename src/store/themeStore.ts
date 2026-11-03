// sight-folio: 主题配置（外观配置专用持久化项）
//
// 持久化口径（第十七轮 T6）：外观/主题配置写入应用设置库（settingsApi KV，键 THEME_SETTINGS_KEY），
// 与 layoutStore / appearanceStore 走同一套后端持久化，重启由 init() 读回，界面默认就是用户上次的颜色。
// 早期版本只写浏览器 localStorage（LEGACY_THEME_STORAGE_KEY），init 时一次性迁移进设置库并清理旧键，
// 保证老用户升级后颜色不丢。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { broadcastAppearanceChange } from '../services/appearanceSync';
import { persistSettings } from './settingsSyncStore';
// 读回迟到竞态防护（第三十四轮）：口径与为什么需要它见 settingsReadbackGuard.ts 文件头
import { attachSettingsReadbackGuard, mergeStaleReadback, isSameReadbackByFields } from './settingsReadbackGuard';
// 档位合法值取自两个单一真源：色板顺序 = themePresets，界面字体 = appearanceScales。
// 两处都只 import 值，反向的 import 全是 `import type`（编译期擦除），不会成环。
import { PRESET_ORDER } from '../theme/themePresets';
import {
  UI_FONT_OPTIONS,
  CODE_FONT_ZOOM_DEFAULT,
  clampCodeFontZoom,
  clampRadiusPx,
  codeFontZoomFromAbsolutePx,
} from '../theme/appearanceScales';

export type ThemeMode = 'light' | 'dark' | 'system';
/**
 * 主题色板。teal / rose / slate 为第二十三轮扩充：此前只有 6 套，创作者想要青碧 / 蔷薇 /
 * 中性石墨就只能走「自定义主色」，而自定义只换主色、不换页面底色与分割线，观感是「主色跳、底不跟」。
 */
export type ThemePreset =
  | 'default'
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'indigo'
  | 'teal'
  | 'rose'
  | 'slate'
  | 'custom';
export type FontSize = 'small' | 'medium' | 'large';
export type BorderRadius = 'none' | 'small' | 'medium' | 'custom';
/**
 * 界面字体族（第二十三轮新增设置项）：管的是**界面**（导航 / 面板 / 按钮 / 标题）的字族，
 * 与「正文默认排版」里的字体设置各管一段 —— 后者只作用在写作台纸面上，改不到界面。
 * system = 改版前的那串历史字体栈（默认档，老用户观感不变）。
 */
export type UiFontFamily = 'system' | 'sans' | 'serif' | 'mono';
/**
 * 动效偏好（第二十一轮新增设置项）。
 * - auto：跟随操作系统「减弱动态效果」（此前的唯一行为，只有一条 @media 兜底）
 * - reduce：不论系统读数一律压缩非必要过渡/动画 —— 系统设置没开、但长时间写作不想被打扰的创作者
 *   在应用里应能自己关掉，而不是去改系统级设置（会影响别的软件）
 */
export type MotionPreference = 'auto' | 'reduce';

export interface ThemeConfig {
  mode: ThemeMode;
  preset: ThemePreset;
  customPrimary?: string;
  fontSize: FontSize;
  borderRadius: BorderRadius;
  /**
   * 自定义圆角半径（px，0–20 整数，钳制走 clampRadiusPx）。**仅当 borderRadius === 'custom'
   * 时被读取**（2026-11-03 档位改版：撤「大圆/全圆」，旧值由 normalizeThemeConfig 迁移进来）。
   * 声明式缺省同 codeFontZoom 口径：normalize 一律补齐数值，跨窗口 isSame 比较才稳定。
   */
  borderRadiusCustom?: number;
  /**
   * 动效偏好。**可选**：与 AppearanceProfile.typography 同口径 —— 没声明即「本套配置不管动效」，
   * 内置外观预设一律不声明（点预设不该顺手改掉创作者的动效习惯），消费侧按 auto 解读。
   */
  motion?: MotionPreference;
  /**
   * 界面字体族（第二十三轮）。**可选**：与 motion / contentWidth 同口径 —— 没声明即「本套配置
   * 不管界面字体」，内置外观预设一律不声明（点预设不该顺手改掉创作者的界面字族习惯），
   * 消费侧按 system 档解读。档位表与字体栈见 theme/appearanceScales.ts。
   */
  uiFont?: UiFontFamily;
  /**
   * 代码编辑器字号微调**步数**（第三十六轮新增设置项）：叠在「字体大小」档位换算出的代码区
   * 基准之上，± 一步 = 1px。存步数而不是绝对像素，是第二十四轮定下的口径 —— 绝对值会把档位
   * 盖过去，观感又是「切字号档位对代码区没反应」。
   *
   * 为什么这一轮把它从 localStorage 搬进设置库：那一读数此前是「字体大小」这一维唯一还留在
   * localStorage 的用户偏好，于是它**不在设置备份的 7 个键里**（换设备/重装后丢）、
   * **不参与「恢复默认」**（点了恢复默认，代码区仍是自己以前调过的大小 —— 体感就是「恢复没生效」）、
   * **不跨窗口跟随**（另一窗口已开着的编辑器停在旧值）、**写失败是空 catch**（没落盘也没人知道）。
   * 这四条都是用户那句「设置没生效 / 重启就没了」的同族成因，只是此前一直没被点名。
   *
   * **可选**：与 motion / uiFont 同口径 —— 内置外观预设一律不声明（点预设不该顺手改掉创作者
   * 的手感），消费侧按 0 步解读；自定义预设「另存为预设」会连它一起沉淀（存一套 = 存全套）。
   */
  codeFontZoom?: number;
}

/** 界面字体族档位的缺省值（未声明 = 历史字体栈） */
export const UI_FONT_DEFAULT: UiFontFamily = 'system';

/** 动效偏好的缺省档（未声明 = 跟随系统） */
export const MOTION_DEFAULT: MotionPreference = 'auto';

const MOTIONS: MotionPreference[] = ['auto', 'reduce'];
// 各维度的合法档位（第二十二轮补全归一化用）：与类型定义同处维护，加档位时不容易漏
const MODES: ThemeMode[] = ['light', 'dark', 'system'];
// 合法色板档位取自 PRESET_ORDER（themePresets 是色板唯一真源）：这里再列一份就是两份数，
// 而「抽屉能选、归一化不认」正是「选了没生效」的成因之一。
const PRESETS: ThemePreset[] = PRESET_ORDER;
const FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];
const BORDER_RADII: BorderRadius[] = ['none', 'small', 'medium', 'custom'];
// 界面字体档位合法值取自档位表同一真源（见 appearanceScales.UI_FONT_OPTIONS）
const UI_FONTS: UiFontFamily[] = UI_FONT_OPTIONS;

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'system',
  preset: 'default',
  fontSize: 'medium',
  borderRadius: 'medium',
  // 自定义圆角显式写缺省值（6 = medium 档观感）：resetConfig 后读数仍是「显式且合法」，
  // isSameThemeConfig / 跨窗口比较不因 undefined 抖动（与 motion / codeFontZoom 同一条理由）
  borderRadiusCustom: 6,
  // 默认档位显式写 auto：resetConfig 之后读数仍是「显式且合法」，反查预设不会因为 undefined 抖动
  motion: MOTION_DEFAULT,
  uiFont: UI_FONT_DEFAULT,
  // 代码字号微调同样显式写缺省步数：resetConfig 之后读数仍是「显式且合法」，
  // 反查外观预设不会因为 undefined 抖动（与 motion / uiFont 同一条理由）
  codeFontZoom: CODE_FONT_ZOOM_DEFAULT,
};

/** 外观/主题配置的专用持久化键（写入应用设置库，重启由 init 读回）。 */
export const THEME_SETTINGS_KEY = 'theme';
/**
 * 本域真正落库的字段清单（第三十四轮，给读回竞态防护用）。
 * 刻意不含 `systemMode` / `systemReducedMotion`：那两格属于操作系统、不进设置库（第 20 轮口径），
 * 它们翻动不是「用户改了设置」，算进来会让系统换明暗把迟到读数判成不可覆盖。
 */
const THEME_PERSISTED_FIELDS = [
  'mode',
  'preset',
  'customPrimary',
  'fontSize',
  'borderRadius',
  'borderRadiusCustom',
  'motion',
  'uiFont',
  'codeFontZoom',
] as const;
/**
 * 代码字号微调的**旧落点**（第三十六轮一次性迁移）。
 * 这两个键从今往后只在本文件的迁移函数里出现（有源码扫描锁把关）：组件侧再写一份读/写，
 * 就等于把这一维重新拆回「两处各存一份」，那正是本仓一直在清的假生效。
 */
const LEGACY_CODE_FONT_ZOOM_KEY = 'ps.editor.fontZoom';
/** 更早的版本存的是绝对像素，读到就折算成相对步数 */
const LEGACY_CODE_FONT_PX_KEY = 'ps.editor.fontSize';
/** 历史遗留键：早期版本只写浏览器 localStorage，init 时一次性迁移到设置库。 */
const LEGACY_THEME_STORAGE_KEY = 'project-sight.theme';

/** 读取系统级明暗偏好（无 matchMedia 环境按浅色兜底）。 */
export function getSystemMode(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/** 读取操作系统「减弱动态效果」读数（无 matchMedia 环境按不减弱兜底，宁多动画不少功能）。 */
export function getSystemReducedMotion(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

/** 把三态 mode 解析成实际生效的明暗（唯一真源：App 根主题与页面级局部主题共用）。 */
export function resolveThemeMode(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? getSystemMode() : mode;
}

/**
 * 纯函数版解析（第二十轮）：把「三态 mode」与「已知的系统明暗」合起来。
 * 之所以要一份不读 matchMedia 的口径：AppTheme / App 需要「系统明暗变了」这件事能触发重算，
 * 而 matchMedia 是渲染期的外部读数，改它不会让 useMemo 重新执行。
 * 读数由本 store 的 `systemMode` 字段承载（见 syncSystemMode）。
 */
export function resolveModeWithSystem(mode: ThemeMode, systemMode: 'light' | 'dark'): 'light' | 'dark' {
  return mode === 'system' ? systemMode : mode;
}

/**
 * 纯函数版动效解析（第二十一轮）：档位 + 系统读数 → 本窗口是否真的要压缩动效。
 * 与 resolveModeWithSystem 同一口径：系统读数由 store 的 systemReducedMotion 字段承载，
 * 不在渲染期直接读 matchMedia（后者变了不会让 useMemo 重算）。
 */
export function resolveMotionWithSystem(motion: MotionPreference | undefined, systemReducedMotion: boolean): boolean {
  return motion === 'reduce' ? true : systemReducedMotion;
}

/**
 * 把（可能残缺的）配置与默认值合并，容忍旧版本缺字段 / 读到脏值。
 * 第二十二轮：把「逐项回落」从只有 motion 扩到全部五个维度。病灶是脏值会一路走到渲染层 ——
 * 例如设置库里 mode 被写成 'sepia' 时，`resolveModeWithSystem` 原样透传，createTheme 拿到
 * `defaultColorScheme: 'sepia'`，MUI 会静默退回浅色，用户看到的是「选了深色没反应」，
 * 而界面上抽屉仍高亮着深色，读数和观感彻底分家。
 */
export function normalizeThemeConfig(parsed: Partial<ThemeConfig> | null | undefined): ThemeConfig {
  const merged = { ...DEFAULT_THEME_CONFIG, ...(parsed ?? {}) };
  // 档位外的脏值（手改设置库 / 降级安装）回落缺省档，绝不把 undefined / 非法档位带进渲染层
  if (!MODES.includes(merged.mode)) merged.mode = DEFAULT_THEME_CONFIG.mode;
  if (!PRESETS.includes(merged.preset)) merged.preset = DEFAULT_THEME_CONFIG.preset;
  if (!FONT_SIZES.includes(merged.fontSize)) merged.fontSize = DEFAULT_THEME_CONFIG.fontSize;
  // 2026-11-03 档位改版：「大圆 / 全圆」两档撤销。旧库里存了这两档的配置**按原基准值迁移到
  // 自定义档**（large→12px、round→20px，正是自定义范围的上端），观感无缝衔接；
  // 直接回落 medium 会静默改掉用户已选的圆度，那是另一种「设置没生效」。
  const legacyRadius = merged.borderRadius as string;
  if (legacyRadius === 'large' || legacyRadius === 'round') {
    merged.borderRadius = 'custom';
    // 守卫读**原始 parsed**：merged 已合过 DEFAULT（里面恒有缺省 6），看 merged 会永远判成
    // 「用户已有数值」而丢掉迁移值（本文件第一轮自测就抓出这条，留注释防再踩）
    if (parsed?.borderRadiusCustom === undefined) merged.borderRadiusCustom = legacyRadius === 'round' ? 20 : 12;
  }
  if (!BORDER_RADII.includes(merged.borderRadius)) merged.borderRadius = DEFAULT_THEME_CONFIG.borderRadius;
  // 自定义圆角数值：脏值（undefined/NaN/小数/越界）一律收敛回合法整数（clampRadiusPx 口径）
  merged.borderRadiusCustom = clampRadiusPx(merged.borderRadiusCustom);
  if (!MOTIONS.includes(merged.motion as MotionPreference)) merged.motion = MOTION_DEFAULT;
  if (!UI_FONTS.includes(merged.uiFont as UiFontFamily)) merged.uiFont = UI_FONT_DEFAULT;
  // 代码字号微调：脏值（'abc' / NaN / 越界 / 小数）一律收敛回合法步数，
  // 绝不把 undefined 或越界值带进 Monaco / 抽屉读数（同上面每一维的口径）
  merged.codeFontZoom = clampCodeFontZoom(merged.codeFontZoom);
  // 自定义主色只认 '#xxx' / '#xxxxxx'：脏值不进色彩生成（否则 CSS 拿到非法颜色整片失色）
  if (merged.customPrimary !== undefined && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(merged.customPrimary))) {
    delete merged.customPrimary;
  }
  return merged;
}

/**
 * 两份配置是否「生效值相同」（第二十二轮）。
 * 此前 hydrate 用 `JSON.stringify` 比较，有两个致命细节：
 *  ① 键序敏感 —— customPrimary 在 setCustomPrimary 里是追加到末尾的，normalizeThemeConfig
 *     出来的键序却是默认值在前，同样的值会因为顺序不同被判成「变了」，白重渲染整棵树；
 *  ② 缺字段敏感 —— 另一套配置没声明 motion 时 normalize 会补 'auto'，而消费侧本来就把
 *     未声明读成 'auto'，两边生效值其实一致，却会被判成变化。
 * 逐字段比较归一化后的读数，才是「生效值没变」的正确口径。
 */
export function isSameThemeConfig(a: ThemeConfig, b: ThemeConfig): boolean {
  // 两侧先各自归一化再逐字段比：未声明的 motion / uiFont / codeFontZoom 会补成缺省值，
  // 「没声明」与「显式选了缺省值」是同一生效值，不该被判成变化而白重渲染整棵树。
  const na = normalizeThemeConfig(a);
  const nb = normalizeThemeConfig(b);
  return (
    na.mode === nb.mode &&
    na.preset === nb.preset &&
    na.fontSize === nb.fontSize &&
    na.borderRadius === nb.borderRadius &&
    // 自定义圆角数值也是生效值：只改数值不换档位时，漏掉这条会让另一窗口跳过同步
    na.borderRadiusCustom === nb.borderRadiusCustom &&
    na.motion === nb.motion &&
    na.uiFont === nb.uiFont &&
    // 代码字号微调也是生效值的一部分：漏掉这一条，跨窗口收到「只改了微调」的广播时会被判成
    // 「没变」而直接跳过 set，另一边就永远停在旧字号（又是一次「设置没生效」）
    na.codeFontZoom === nb.codeFontZoom &&
    na.customPrimary === nb.customPrimary
  );
}

/**
 * 是否仍是「出厂那一套」（第二十六轮，给设置抽屉的章节标记用）。
 *
 * 为什么逐字段比而不是 `JSON.stringify(config) === JSON.stringify(DEFAULT)`：
 * 与 isSameThemeConfig 同一个理由 —— 键序与「未声明 vs 显式缺省档」都会让字符串比较说谎。
 * 归一化后逐字段比才是「生效值仍是默认」的正确口径，否则用户没改过也会被标上「已微调」。
 */
export function isThemeConfigDefault(config: ThemeConfig): boolean {
  return isSameThemeConfig(config, DEFAULT_THEME_CONFIG);
}

/** 读取历史遗留的 localStorage 配置（仅用于一次性迁移 / KV 不可用时的兜底）。 */
function loadLegacyConfig(): ThemeConfig | null {
  try {
    const saved = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (!saved) return null;
    return normalizeThemeConfig(JSON.parse(saved) as Partial<ThemeConfig>);
  } catch {
    return null;
  }
}

/**
 * 读旧落点的代码字号微调（第三十六轮），返回 null 表示「本机没有这一维的旧读数」。
 *
 * 口径与第十九轮的语言迁移、第二十四轮的旧 px 折算一致：
 *  ① 新一点的键存的是**步数**，直接采信（钳制后）；
 *  ② 只有绝对像素那份时按 medium 档基准折算成步数 —— 直接采信绝对值会在档位之上再叠一层旧值，
 *     用户切字号档位就又「看不见生效」；
 *  ③ 无论走哪条，读完立刻 removeItem：留着它，下次启动仍会在设置库读数之外再多盖一层。
 * localStorage 不可用（非浏览器环境 / 隐私模式抛错）时按「没有旧读数」处理，绝不抛穿 init。
 */
function readLegacyCodeFontZoom(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const steps = localStorage.getItem(LEGACY_CODE_FONT_ZOOM_KEY);
    if (steps != null) {
      localStorage.removeItem(LEGACY_CODE_FONT_ZOOM_KEY);
      return clampCodeFontZoom(steps);
    }
    const absolutePx = localStorage.getItem(LEGACY_CODE_FONT_PX_KEY);
    if (absolutePx == null) return null;
    localStorage.removeItem(LEGACY_CODE_FONT_PX_KEY);
    return codeFontZoomFromAbsolutePx(absolutePx);
  } catch {
    return null;
  }
}

/**
 * 把旧落点的微调并进一份主题配置（第三十六轮）。
 * `declaredInSource` = 这份配置本身有没有显式声明 codeFontZoom：声明了就说明它是**更新的读数**
 * （设置库里的现值 / 另一窗口广播来的配置），旧 localStorage 不能再把它盖回去；
 * 只有「这一维还空着」时才用旧读数补位 —— 于是老用户升级当天手感不变，新用户也不会凭空多出偏移。
 */
function withLegacyCodeFontZoom(
  config: ThemeConfig,
  declaredInSource: boolean,
  legacyZoom: number | null,
): ThemeConfig {
  if (declaredInSource || legacyZoom === null) return config;
  return { ...config, codeFontZoom: clampCodeFontZoom(legacyZoom) };
}

/**
 * 解析一份序列化后的主题配置，并顺带回答「它自己有没有声明 codeFontZoom 这一维」。
 * 为什么不能只回一份 normalizeThemeConfig 的结果：归一化会把没声明的维度补成缺省值，
 * 补完之后「库里明确存了 0 步」与「库里根本没有这一维」长得一模一样，
 * 而迁移旧读数只有后者才该采信 —— 用归一化后的读数判断，等于让 0 步去覆盖旧落点的 +3 步。
 *
 * JSON 非法时**照原样抛出**（沿用改动前 `JSON.parse(saved)` 在 try 里的行为），
 * 由 init 的 catch 决定兜底口径；这里悄悄吞掉会让「设置库被写坏」这种真故障降级成
 * 「界面回到默认」，用户和下一轮排查的人都看不见它。
 */
function parseThemeConfig(
  raw: string | null | undefined,
): { config: ThemeConfig; declaresCodeFontZoom: boolean } | null {
  if (raw === null || raw === undefined) return null;
  const parsed = JSON.parse(raw) as Partial<ThemeConfig> | null;
  return {
    config: normalizeThemeConfig(parsed),
    declaresCodeFontZoom: parsed?.codeFontZoom !== undefined,
  };
}

function persist(config: ThemeConfig): void {
  // 先广播再落库：本窗口状态已 set，写作台 / 工作台窗口立刻跟随同一份配置；
  // 落库失败也只是重启后回到旧值，不该让另一边继续显示旧主题（见 appearanceSync 注释）。
  broadcastAppearanceChange('theme', config);
  // 第二十轮：走统一可信层 —— 失败自动重试一次，并把状态交给设置抽屉那句「自动保存」文案
  persistSettings('theme', THEME_SETTINGS_KEY, JSON.stringify(config));
}

interface ThemeState {
  config: ThemeConfig;
  initialized: boolean;
  /**
   * 系统当前的明暗读数（**不持久化**：它属于操作系统，不属于用户在这台设备上存的偏好）。
   * mode='system' 时实际生效明暗 = 本字段，见 resolveModeWithSystem。
   */
  systemMode: 'light' | 'dark';
  /**
   * 操作系统「减弱动态效果」读数（**不持久化**，同 systemMode：属于操作系统，不属于用户偏好）。
   * motion='auto' 时是否压缩动效 = 本字段，见 resolveMotionWithSystem。
   */
  systemReducedMotion: boolean;

  init: () => Promise<void>;
  /**
   * 重新读取系统明暗并只更新内存（第二十轮）。
   * 病灶（第十九轮台账待办 2）：此前 App 的 matchMedia 回调调 `setMode('system')`，
   * 值没变但 config 是新对象 → 每次操作系统切明暗都白写一次设置库、白广播一次，
   * 还会把「本次写入」误报给落盘状态。这里改成只重算派生读数。
   * 也不广播：每个窗口对自己的操作系统有同样的 matchMedia，各算各的即可。
   */
  syncSystemMode: () => void;
  /** 重新读取系统「减弱动态效果」并只更新内存（不落库、不广播，同 syncSystemMode 口径） */
  syncSystemMotion: () => void;
  /** 跨窗口跟随：只把另一窗口广播来的配置并进内存，绝不回写设置库（避免回声与互相覆盖） */
  hydrate: (config: Partial<ThemeConfig> | null | undefined) => void;
  setMode: (mode: ThemeMode) => void;
  setPreset: (preset: ThemePreset) => void;
  setCustomPrimary: (color: string) => void;
  setFontSize: (fontSize: FontSize) => void;
  setBorderRadius: (borderRadius: BorderRadius) => void;
  setBorderRadiusCustom: (px: number) => void;
  /** 动效偏好（第二十一轮）：auto = 跟随系统，reduce = 一律压缩非必要动效 */
  setMotion: (motion: MotionPreference) => void;
  /** 界面字体族（第二十三轮）：只管界面字族，不碰写作台正文（正文走 typographyDefaultsStore） */
  setUiFont: (uiFont: UiFontFamily) => void;
  /**
   * 代码编辑器字号微调步数（第三十六轮）：叠在「字体大小」档位换算出的代码区基准之上。
   * 越界 / 脏值在写之前先钳制，抽屉与状态栏因此不可能把越界步数写进设置库。
   */
  setCodeFontZoom: (zoom: number) => void;
  /**
   * ± 一步（状态栏与抽屉的加减按钮共用）。
   * 「读当前步数 → 加增量 → 钳制」整条放 store 里而不是各调用方手写：两处各写一份钳制，
   * 迟早有一处漏掉，于是越界值又能进库了。
   */
  adjustCodeFontZoom: (delta: number) => void;
  setConfig: (config: Partial<ThemeConfig>) => void;
  resetConfig: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  config: { ...DEFAULT_THEME_CONFIG },
  initialized: false,
  systemMode: getSystemMode(),
  systemReducedMotion: getSystemReducedMotion(),

  syncSystemMode: () => {
    const next = getSystemMode();
    // 与当前读数一致直接跳过：连一次 set 都不做，避免无谓重渲染
    if (next === get().systemMode) return;
    set({ systemMode: next });
  },

  syncSystemMotion: () => {
    const next = getSystemReducedMotion();
    if (next === get().systemReducedMotion) return;
    set({ systemReducedMotion: next });
  },

  // 启动时从设置库读回上次的颜色；设置库为空则迁移旧 localStorage 配置；
  // 设置库不可用（纯浏览器 / IPC 失败）时退回旧 localStorage 值，保证界面仍有颜色。
  init: async () => {
    // 第三十四轮：发请求前拍号。门控只有 1500ms，超时后界面已经能点；这段时间里用户改了主题，
    // 迟到的库读数就只能按字段并进来，绝不能整份盖内存（否则观感就是「刚选的深色又弹回去了」）。
    const mark = themeReadback.capture();
    // 旧落点（localStorage）的代码字号微调：先读出来再走下面任何一条分支。
    // 为什么放在最前面：这个函数读到的同时会把旧键清掉，若某条分支（尤其读库失败那条）
    // 忘了采信，用户的那次微调就凭空丢了 —— 采信点在分支里各写一遍迟早漏一条。
    const legacyZoom = readLegacyCodeFontZoom();
    try {
      const saved = await settingsApi.get(THEME_SETTINGS_KEY);
      // 「库里这一维有没有被显式声明」决定旧读数能不能补位（见 withLegacyCodeFontZoom）
      const savedFromDb = parseThemeConfig(saved);
      if (themeReadback.isStale(mark)) {
        const current = get().config;
        if (savedFromDb) {
          // 库为底、用户改过的那几项为面：顺手把「内存还没初始化就整份落库」时被默认值冲掉的
          // 其余维度修回去（用户只点了深色，不该连带把自己的字号档清成默认）。
          const merged = mergeStaleReadback<ThemeConfig>(
            withLegacyCodeFontZoom(savedFromDb.config, savedFromDb.declaresCodeFontZoom, legacyZoom),
            current,
            themeReadback.dirtyKeys(),
          );
          if (!isSameReadbackByFields(merged, current, THEME_PERSISTED_FIELDS)) {
            set({ config: merged, initialized: true });
            persist(merged);
            return;
          }
        }
        // 库里没有读数 / 合并结果与内存相同：只放行首帧门控，不白写一次库
        set({ initialized: true });
        return;
      }
      if (savedFromDb) {
        set({
          config: withLegacyCodeFontZoom(savedFromDb.config, savedFromDb.declaresCodeFontZoom, legacyZoom),
          initialized: true,
        });
        return;
      }
      const legacy = loadLegacyConfig();
      if (legacy) {
        // 老主题包比 codeFontZoom 这一维早得多，本身不可能声明它 → 旧微调一律补位进来
        const config = withLegacyCodeFontZoom(legacy, false, legacyZoom);
        set({ config, initialized: true });
        persist(config);
        try {
          localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
        } catch {
          /* localStorage 不可用时忽略 */
        }
        return;
      }
      // 库里与老 localStorage 都没有主题读数，但旧落点留着一次代码字号微调：
      // 补上这一维再落库，否则升级当天代码区会凭空回到档位基准（老用户的手感被无声改掉）。
      // 只有这一条分支需要顺手落库 —— 另外几条本来就在写库或本就不该写。
      if (legacyZoom !== null) {
        const seeded = withLegacyCodeFontZoom({ ...DEFAULT_THEME_CONFIG }, false, legacyZoom);
        set({ config: seeded, initialized: true });
        persist(seeded);
        return;
      }
      set({ initialized: true });
    } catch (error) {
      console.error('[ThemeStore] 从设置库加载主题配置失败:', error);
      // 同一条口径：读回失败也不能把用户刚改的那一套回落成默认 / 旧 localStorage 值
      if (themeReadback.isStale(mark)) {
        set({ initialized: true });
        return;
      }
      // 读库失败时旧落点已经被清掉了（见上方 readLegacyCodeFontZoom 的副作用），
      // 这里必须照样采信它，否则那一次微调既不在这份兜底配置里、也不在旧键里 = 凭空丢失。
      set({
        config: withLegacyCodeFontZoom(loadLegacyConfig() ?? { ...DEFAULT_THEME_CONFIG }, false, legacyZoom),
        initialized: true,
      });
    }
  },

  // 跨窗口跟随：与本地状态一致时直接跳过（Tauri 的 emit 会广播回发起窗口自己）。
  // 这里只 set 不 persist：发起方已经落库，本窗口再写一次纯属回声。
  hydrate: (config) => {
    const next = normalizeThemeConfig(config);
    if (isSameThemeConfig(next, get().config)) return;
    set({ config: next });
  },

  setMode: (mode) => {
    const config = { ...get().config, mode };
    set({ config });
    persist(config);
  },

  setPreset: (preset) => {
    const config = { ...get().config, preset };
    set({ config });
    persist(config);
  },

  setCustomPrimary: (color) => {
    const config: ThemeConfig = { ...get().config, customPrimary: color, preset: 'custom' };
    set({ config });
    persist(config);
  },

  setFontSize: (fontSize) => {
    const config = { ...get().config, fontSize };
    set({ config });
    persist(config);
  },

  setBorderRadius: (borderRadius) => {
    const config = { ...get().config, borderRadius };
    set({ config });
    persist(config);
  },

  // 自定义圆角数值：与其余主题项同一条链路 —— 即时生效（AppTheme 重算 shape/通道）
  // + 落设置库 + 跨窗口广播 + 进备份键 + 被 resetConfig 复位（七件套全走既有管道）。
  setBorderRadiusCustom: (px) => {
    const config: ThemeConfig = { ...get().config, borderRadiusCustom: clampRadiusPx(px) };
    set({ config });
    persist(config);
  },

  // 动效偏好与其余主题项同一条链路：即时生效（AppTheme 重算主题）+ 落库 + 跨窗口广播
  setMotion: (motion) => {
    const config: ThemeConfig = { ...get().config, motion };
    set({ config });
    persist(config);
  },

  // 界面字体族与其余主题项同一条链路：即时生效（AppTheme 重算 theme.typography.fontFamily）
  // + 落设置库 + 跨窗口广播，因此重启读回与另一窗口跟随都无需额外接线。
  setUiFont: (uiFont) => {
    const config: ThemeConfig = { ...get().config, uiFont };
    set({ config });
    persist(config);
  },

  // 代码字号微调与其余主题项同一条链路：即时生效（useCodeFont 读到新步数 → Monaco updateOptions）
  // + 落设置库 + 跨窗口广播 + 进设置备份 + 被 resetConfig 复位，因此这四件事都不需要额外接线。
  setCodeFontZoom: (zoom) => {
    const config: ThemeConfig = { ...get().config, codeFontZoom: clampCodeFontZoom(zoom) };
    set({ config });
    persist(config);
  },

  adjustCodeFontZoom: (delta) => {
    // 增量也钳一次：脏增量（NaN / 越界）在这里就变成 0，即「按了没反应」，
    // 而不是把用户的微调凭空清零
    const step = clampCodeFontZoom(delta);
    const config: ThemeConfig = {
      ...get().config,
      codeFontZoom: clampCodeFontZoom((get().config.codeFontZoom ?? CODE_FONT_ZOOM_DEFAULT) + step),
    };
    set({ config });
    persist(config);
  },

  setConfig: (partial) => {
    const config = { ...get().config, ...partial };
    set({ config });
    persist(config);
  },

  resetConfig: () => {
    set({ config: { ...DEFAULT_THEME_CONFIG } });
    persist(DEFAULT_THEME_CONFIG);
  },
}));

/**
 * 读回竞态防护（第三十四轮）。挂在**订阅**上而不是逐个 action 里手写 touch()：
 * 本域有 12 个写入口（setMode / setPreset / setCustomPrimary / setFontSize / setBorderRadius /
 * setBorderRadiusCustom / setMotion / setUiFont / setCodeFontZoom / adjustCodeFontZoom / setConfig / resetConfig，
 * 再加跨窗口 hydrate），漏接一处就还留着一条
 * 「改完被旧值盖回」的路；订阅口径下以后新增的写入口自动被覆盖。
 */
const themeReadback = attachSettingsReadbackGuard(useThemeStore, {
  scope: 'theme',
  select: (s) => s.config,
  fields: THEME_PERSISTED_FIELDS,
});
