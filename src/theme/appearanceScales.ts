// 外观档位的单一真源（第十八轮）：字号 / 圆角 / 内容留白 / 顶栏高度 / 侧栏宽度。
//
// 为什么单独一个模块：设置抽屉里每个档位都要「看得见效果」，而档位 → 具体数值的换算此前
// 散落在三处（AppTheme 的 FONT_SIZE_MAP / BORDER_RADIUS_MAP、App.tsx 的 contentPaddingMap、
// SideMenu 的 DRAWER_WIDTH 常量）。散落的直接后果是「设置项改了但界面纹丝不动」——
// 典型病灶：
//  ① AppTheme 只写 typography.fontSize（unitless），而 themePrimitives 的全部 variant 用
//     pxToRem() 定死 rem，切「字体大小」只有零星按钮变，正文/标题不变；
//  ② SideMenu 用常量 240/64，layoutStore.sidebarWidth 全项目零消费，「标准」与「宽屏」渲染相同。
// 现在档位定义与 CSS 变量名都只在这里出现，主题、面板预览、静态 CSS 三处同源。
import type { BorderRadius, FontSize, MotionPreference, UiFontFamily } from '../store/themeStore';
// 系统档字体栈只在 themePrimitives 里写一次（那是改版前的历史取值），这里引用而非复制一份：
// 两份字面量迟早漂移成「抽屉显示跟随系统、实际注入另一串」。
import { UI_FONT_STACK_SYSTEM } from './themePrimitives';
import type { ContentPadding, ContentWidth, NavbarStyle } from '../store/layoutStore';

/** 界面基准字号（px）：medium 为设计基准 14，其余档位按此比例缩放全部 variant */
export const FONT_SIZE_BASE: Record<FontSize, number> = {
  small: 13,
  medium: 14,
  large: 16,
};

/** 字号档位 → variant 缩放系数（以 medium 为 1，等比缩放 h1…caption，避免只改按钮不改正文） */
export const FONT_SIZE_SCALE: Record<FontSize, number> = {
  small: FONT_SIZE_BASE.small / FONT_SIZE_BASE.medium,
  medium: 1,
  large: FONT_SIZE_BASE.large / FONT_SIZE_BASE.medium,
};

/**
 * 圆角档位 → 基准半径（px），即注入 `theme.shape.borderRadius` 的那一个数
 * （唯一注入点是 theme/AppTheme.tsx）。
 *
 * 第二十二轮删掉了此前并列的 BORDER_RADIUS_TOKENS 五级 token 表：它的注释承诺
 * 「静态 CSS 用 var(--app-radius-md) 即可跟随」，而这条变量通道**从未存在**
 * （appearanceCssVars 刻意不注入同名圆角变量，见文件底部注释），全项目也只有设置抽屉
 * 画预览读它 —— 于是「有一整套圆角体系」只是看起来有，正是本仓一直在清的「只存不读」。
 *
 * 想跟随档位的两条正确写法（第三十一轮按实测更正口径）：
 *  ① MUI 组件里用乘数 `borderRadius: 1`（= shape 基准，随档位缩放）；
 *  ② 非 MUI / 静态渲染区用本模块注入的 **`var(--app-radius-base)`**（见 appearanceCssVars，
 *    由 AppTheme 逐项 setProperty 写进 documentElement 内联样式，不依赖 MUI 内部实现）。
 * 另注：`var(--template-shape-borderRadius)` 在本仓**同样是活的** —— AppTheme 配了
 * `cssVariables.cssVarPrefix: 'template'`，MUI v9 的 CssBaseline 实测在 `:root` 注入
 * `--template-shape-borderRadius:<档位px>`（锁见 radiusChannelRound31 渲染探针）。
 * 16:54 审计判它「不存在」是对默认前缀 `--mui-` 做的实验 + 源码 grep（变量名由前缀在
 * 运行时拼接，源码里 grep 不到属正常），前提有误。但新代码仍统一用 ②：那条通道姓 MUI，
 * 前缀一改或 CssBaseline 一撤就全体断供，本仓自己的变量没有这种耦合。
 */
export const BORDER_RADIUS_BASE: Record<'none' | 'small' | 'medium', number> = {
  none: 0,
  small: 2,
  medium: 6,
};

/**
 * 「自定义」圆角档的可取范围（2026-11-03 李先生档位改版）：
 * 撤掉「大圆(12) / 全圆(20)」两个固定档后由自定义数值承接 ——
 * max=20 恰好是旧「全圆」基准，老用户想要的圆度一个都不丢；min=0 与「直角」重合
 * 也允许（自定义就是一条自由数值轨）。step=1 整数像素。
 * BORDER_RADIUS_BASE 从此只有三档查表值；custom 档没有固定值，
 * 生效半径一律走 radiusBasePx()，任何消费点都不许再自己 `BORDER_RADIUS_BASE[tier]`。
 */
export const RADIUS_CUSTOM_RANGE = { min: 0, max: 20, step: 1, default: 6 } as const;

/** 自定义圆角数值归一（与 clampCodeFontZoom 同口径）：只认有限数，小数四舍五入，越界钳制，脏值回落缺省 */
export function clampRadiusPx(value: unknown): number {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return RADIUS_CUSTOM_RANGE.default;
  return Math.min(RADIUS_CUSTOM_RANGE.max, Math.max(RADIUS_CUSTOM_RANGE.min, Math.round(n)));
}

/**
 * 多行输入框（multiline/textarea）圆角上限（px）—— 2026-11-03 李先生报修。
 *
 * 病灶：输入框圆角 = 档位 × 1.67，「全圆」档到达 33.4px。单行输入没有症状
 * （浏览器把圆角钳到半高、光标在竖向中央，弧线在光标处水平侵入仅 ~2.7px）；
 * 多行输入首行从 padding-top 8.5px 起笔，33.4px 圆在该高度的水平侵入 ≈11px，
 * 叠加 1.75px 聚焦描边与 4px 聚焦环 ⇒ 光标和首字符正好压在弧线上。
 *
 * 上限取 20 = large 档的输入框实际半径（12×1.67≈20.04）：large 档观感不变，
 * 「全圆」只让单行输入/按钮/Chip 保持胶囊，多行框钳回 20px，光标净空 ~10px。
 * 消费点唯一：customizations.ts 的 MuiInputBase `&.MuiInputBase-multiline`。
 */
export const MULTILINE_INPUT_RADIUS_MAX = 20;

/**
 * 生效基准半径的唯一口径：固定档查表；custom 档读用户数值（钳制后）。
 * AppTheme（theme.shape.borderRadius）、appearanceCssVars（--app-radius-base）、
 * 设置抽屉预览全部走这里 —— 谁再手写 `BORDER_RADIUS_BASE[tier]` 就是分叉真源。
 */
export function radiusBasePx(config: { borderRadius: BorderRadius; borderRadiusCustom?: number }): number {
  if (config.borderRadius === 'custom') return clampRadiusPx(config.borderRadiusCustom);
  return BORDER_RADIUS_BASE[config.borderRadius as 'none' | 'small' | 'medium'] ?? BORDER_RADIUS_BASE.medium;
}

/** 内容留白档位 → 主内容区 padding（px） */
export const CONTENT_PADDING_PX: Record<ContentPadding, string> = {
  none: '0px',
  small: '8px',
  medium: '24px',
  large: '40px',
};

/** 顶栏样式档位 → 高度（px）：slim 收掉副标题与搜索框，把竖向空间还给正文 */
export const NAVBAR_HEIGHT_PX: Record<NavbarStyle, number> = {
  standard: 60,
  slim: 44,
};

/**
 * 内容区宽度档位 → 主内容壳 max-width（第二十一轮）。
 * default 档就是此前 App.tsx 里硬编码的 1700px，选它 = 观感与升级前完全一致；
 * full = 不限宽（配合「内容留白」自行控制边缘）。
 */
export const CONTENT_MAX_WIDTH_PX: Record<ContentWidth, string> = {
  narrow: '1200px',
  default: '1700px',
  wide: '2100px',
  full: 'none',
};

/** 内容宽度档位顺序（抽屉按此渲染按钮组，也是合法值唯一来源） */
export const CONTENT_WIDTH_OPTIONS: ContentWidth[] = ['narrow', 'default', 'wide', 'full'];

/** 档位 → 合法值收敛：脏值 / 未声明回落缺省档（'default'），绝不把 undefined 带进渲染层 */
export function resolveContentMaxWidth(width?: ContentWidth): string {
  return CONTENT_MAX_WIDTH_PX[width as ContentWidth] ?? CONTENT_MAX_WIDTH_PX.default;
}

/**
 * 「减少动效」时要压缩的声明（第二十一轮）。
 * 只压时长、不改终态：动画仍会走到结束值，滚动改回即时跳转 —— 与操作系统
 * prefers-reduced-motion 的既有兜底同一口径，两处共用这一份，避免行为漂移。
 */
export const REDUCED_MOTION_DECLARATIONS = {
  animationDuration: '0.01ms !important',
  animationIterationCount: '1 !important',
  transitionDuration: '0.01ms !important',
  scrollBehavior: 'auto !important',
} as const;

/** 应用这条声明的选择器（全局：MUI 过渡、静态 CSS、非 MUI 渲染区一并收口） */
export const REDUCED_MOTION_SELECTOR = '*, *::before, *::after';

/**
 * 动效档位 → JS 滚动行为（第二十六轮新增的**第二条**消费通道）。
 *
 * 为什么 CSS 那一份不够：`scroll-behavior: auto !important` 只能压住「没显式指定行为」的滚动，
 * 而代码里 `el.scrollIntoView({ behavior: 'smooth' })` 是**显式 smooth**，优先级高于 CSS ——
 * 于是「减少动效」开着，项目树定位、校对结论跳转、AI 对话滚底仍然一路平滑滑行。
 * 结论：动效偏好必须在 JS 侧也读一次，不能只靠样式表。
 *
 * 唯一换算点（消费点见 hooks/useReducedMotion.ts）；各调用处不许再各写一份三元。
 */
export function scrollBehaviorForMotion(reduced: boolean): ScrollBehavior {
  return reduced ? 'auto' : 'smooth';
}

/** 供 i18n / 抽屉标注用的档位全集（顺序即展示顺序） */
export const MOTION_OPTIONS: MotionPreference[] = ['auto', 'reduce'];

/** 侧栏宽度可调范围（px）；折叠宽度固定 64（图标栏，不参与调节） */
export const SIDEBAR_WIDTH_RANGE = { min: 180, max: 360, step: 8 } as const;
export const SIDEBAR_COLLAPSED_WIDTH = 64;

/** 侧栏宽度兜底（脏值/缺字段时用） */
export const SIDEBAR_WIDTH_DEFAULT = 240;

/** 把任意读数收敛到合法侧栏宽度（折叠态固定用 COLLAPSED，不参与 clamp） */
export function clampSidebarWidth(width: unknown): number {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= 0) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_RANGE.max, Math.max(SIDEBAR_WIDTH_RANGE.min, Math.round(n)));
}

/**
 * 非 MUI 渲染区的字号基准（第二十四轮）：Monaco / xterm 拿不到 MUI theme，也不认 CSS 变量，
 * 只吃一个数字。此前这几处各自写死（编辑器 13、diff 13、行内 diff 12、终端 12、紧凑 11），
 * 于是「设置 → 字体大小」对代码工作台与终端**完全不生效** —— 正是本仓反复在清的那类
 * 「档位只存不读」。基准值与硬编码时代一致，medium 档用户观感不变。
 */
export const CODE_FONT_BASE = {
  /** 代码编辑器主体 */
  editor: 13,
  /** 差异对照（双栏） */
  diff: 13,
  /** 面板里的行内 diff / AI 建议对照 */
  inlineDiff: 12,
  /** 集成终端 */
  terminal: 12,
  /** 窄面板里的紧凑代码预览 */
  compact: 11,
} as const;

export type CodeFontRole = keyof typeof CODE_FONT_BASE;

/** 代码区字号可读区间：缩太小没意义，放太大一屏装不下代码 */
const CODE_FONT_MIN = 10;
const CODE_FONT_MAX = 22;

/**
 * 档位 → 代码区实际字号：按界面字号系数等比缩放并取整。
 * 单一换算入口（消费点见 hooks/useCodeFont.ts），各编辑器不许再各写一份系数。
 * ⚠ 这里**不含**用户的手动微调 —— 微调是叠在档位之上的第二层，见 applyCodeFontZoom。
 */
export function codeFontSize(role: CodeFontRole, fontSize: FontSize): number {
  const base = CODE_FONT_BASE[role] ?? CODE_FONT_BASE.editor;
  const scale = FONT_SIZE_SCALE[fontSize] ?? 1;
  return Math.min(CODE_FONT_MAX, Math.max(CODE_FONT_MIN, Math.round(base * scale)));
}

/** 代码区行高与字号的固定间距（此前 Monaco 写死「字号 + 7」，两处各写一份迟早漂移） */
const CODE_FONT_LINE_GAP = 7;

/**
 * 代码字号微调步数（第三十六轮）：状态栏与设置抽屉的 ± 动的都是**叠在档位基准上的相对步数**，
 * 不是绝对像素。存绝对像素正是第二十四轮的病灶 —— 档位一变，绝对值就把档位盖过去，
 * 用户看到的现象又是「切字体大小对代码区没反应」。
 *
 * 区间沿用第二十四轮在 MonacoCodeEditor 里定的 -6 ~ +12：够日常微调，又不至于把界面字号档位盖过去。
 * 落点从 localStorage（`ps.editor.fontZoom`）换成设置库 theme 域，见 store/themeStore.ts：
 * localStorage 那一份不在设置备份的 7 个键里、不参与「恢复默认」、不跨窗口跟随，写失败还是空 catch。
 */
export const CODE_FONT_ZOOM_MIN = -6;
export const CODE_FONT_ZOOM_MAX = 12;
export const CODE_FONT_ZOOM_DEFAULT = 0;
/** 微调后最终像素的安全区间（对标 Zed Increase/DecreaseBufferFontSize 的 [6,100]） */
const CODE_FONT_PX_MIN = 6;
const CODE_FONT_PX_MAX = 100;

/**
 * 把任意读数收敛成合法步数：脏值 / 未声明 / 非整数一律回落缺省档或就近取整后钳制。
 * 归一化与消费侧共用这一把尺，避免「抽屉能把步数调出区间、渲染层照着画」的假生效。
 */
export function clampCodeFontZoom(zoom: unknown): number {
  const n = Number(zoom);
  if (!Number.isFinite(n)) return CODE_FONT_ZOOM_DEFAULT;
  return Math.min(CODE_FONT_ZOOM_MAX, Math.max(CODE_FONT_ZOOM_MIN, Math.round(n)));
}

/** 微调后的最终像素兜底区间（步数已钳过一次，这里防「档位本身很大 + 正步数」冲出可读区） */
function clampCodeFontPx(px: number): number {
  if (!Number.isFinite(px)) return CODE_FONT_BASE.editor;
  return Math.min(CODE_FONT_PX_MAX, Math.max(CODE_FONT_PX_MIN, Math.round(px)));
}

/**
 * 档位基准 + 用户步数 → 代码区实际字号（第三十六轮，唯一换算入口）。
 * 消费点：hooks/useCodeFont.ts（Monaco / xterm / 行内 diff 全部经它取数）与设置抽屉那条读数，
 * 两处同源，于是「抽屉里写着 15px」与「编辑器真画 15px」不可能分家。
 */
export function applyCodeFontZoom(basePx: number, zoom?: unknown): number {
  return clampCodeFontPx(basePx + clampCodeFontZoom(zoom ?? CODE_FONT_ZOOM_DEFAULT));
}

/** 档位 + 步数一步到位（给「不经过 hook 的同步读数」用，如设置抽屉的预览标注） */
export function codeFontSizeWithZoom(role: CodeFontRole, fontSize: FontSize, zoom?: unknown): number {
  return applyCodeFontZoom(codeFontSize(role, fontSize), zoom);
}

/**
 * 代码区行高：跟随字号一起缩放。
 * 病灶口径：Monaco 此前同时写死 fontSize:13 + lineHeight:20，只放大字号不放大行高，
 * large 档会得到「字挤在一起」的代码页 —— 观感比不生效更糟。
 */
export function codeLineHeight(role: CodeFontRole, fontSize: FontSize): number {
  return codeFontSize(role, fontSize) + CODE_FONT_LINE_GAP;
}

/** 微调后的行高：与 applyCodeFontZoom 同一个间距常量，别在调用处再各写一份 +7 */
export function applyCodeFontLineHeight(px: number): number {
  return px + CODE_FONT_LINE_GAP;
}

/**
 * 旧落点的绝对像素 → 相对步数（第三十六轮一次性迁移用）。
 * 早期版本存的是「编辑器绝对字号」，直接采信会在档位之上再叠一层旧值，用户切档位就又看不见生效；
 * 这里按 medium 档的编辑器基准折算成步数，与第二十四轮 Monaco 里的折算口径一字不差。
 */
export function codeFontZoomFromAbsolutePx(px: unknown): number {
  const n = Number(px);
  if (!Number.isFinite(n)) return CODE_FONT_ZOOM_DEFAULT;
  return clampCodeFontZoom(n - CODE_FONT_BASE.editor);
}

/**
 * 按系数等比缩放 typography 的全部 variant。
 * MUI variant 的字号是 rem 字符串（pxToRem 以 htmlFontSize=16 折算），只改
 * `typography.fontSize` 不会影响它们 —— 所以这里逐个 variant 乘系数，让「字体大小」
 * 对标题、正文、辅助文字整体生效。
 */
export function scaleTypography<T extends Record<string, unknown>>(variants: T, factor: number): T {
  if (factor === 1) return variants;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return Object.fromEntries(
    Object.entries(variants).map(([key, value]) => {
      if (!value || typeof value !== 'object' || !('fontSize' in value)) return [key, value];
      const variant = value as { fontSize?: string | number };
      const { fontSize } = variant;
      if (typeof fontSize === 'string' && fontSize.endsWith('rem')) {
        return [key, { ...variant, fontSize: `${round(parseFloat(fontSize) * factor)}rem` }];
      }
      if (typeof fontSize === 'number') {
        return [key, { ...variant, fontSize: round(fontSize * factor) }];
      }
      return [key, value];
    }),
  ) as T;
}

/**
 * 界面字体档位 → CSS 字体栈（第二十三轮新增设置项，消费点 theme/AppTheme.tsx）。
 *
 * 为什么值得单独一项设置：写作工具的字族审美是创作者自己的事，此前 UI 字体写死在
 * themePrimitives 里，只能改代码；而「正文默认排版」那套字体只管写作台纸面，管不到界面。
 * 四档刻意两两差异明显（衬线 / 现代无衬线 / 等宽 vs 系统字），避免「切了看不出」的老病灶；
 * system 档复用 themePrimitives 的历史取值，升级当天老用户观感不变。
 */
export const UI_FONT_STACKS: Record<UiFontFamily, string> = {
  system: UI_FONT_STACK_SYSTEM,
  sans: "Inter, 'Avenir Next', 'Helvetica Neue', Helvetica, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
  serif: "'Songti SC', 'Source Han Serif SC', 'Noto Serif CJK SC', 'Times New Roman', serif",
  mono: "'SF Mono', Menlo, Monaco, 'Cascadia Mono', 'Courier New', monospace",
};

/** 界面字体档位顺序（= 抽屉展示顺序，也是 themeStore 归一化用的合法值唯一来源） */
export const UI_FONT_OPTIONS: UiFontFamily[] = ['system', 'sans', 'serif', 'mono'];

/** 档位 → 字体栈：脏值 / 未声明回落 system（= 升级前的历史取值，老用户观感不变） */
export function resolveUiFontStack(font?: UiFontFamily): string {
  return UI_FONT_STACKS[font as UiFontFamily] ?? UI_FONT_STACK_SYSTEM;
}

/**
 * 界面文字字号（第二十六轮）：把「设置 → 字体大小」的档位系数乘到**硬编码 px** 上。
 *
 * 病灶：AppTheme 只缩放 MUI 的 variant（`scaleTypography` 处理 h1…caption 的 rem），
 * 而组件里凡是自己写 `sx={{ fontSize: 12 }}` 的文字**不走 variant** —— 实测界面 chrome
 * （设置抽屉 / 顶栏 / 侧栏菜单 / 备份区 / 健康自检条）有 80 多处这种裸 px，
 * 于是「字体大小切到『大』」在这些区域几乎看不出来，用户读到的就是「设置没生效」。
 *
 * 口径：走 `--app-font-scale`（AppTheme 已按档位写进 :root），与静态 CSS、代码区字号同源；
 * medium 档系数为 1 → 计算结果与改前逐像素一致，老用户观感不变。
 * 刻意留在原地的例外：画布（canvasEntity / 实体渲染器）里的字号**不套本函数** —— 画布有自己的
 * 缩放（zoom/pan）且受「画布零 Emotion」性能约定约束，套上会变成「界面字号 × 画布缩放」两份系数。
 */
export function uiFontSize(px: number): string {
  return `calc(${px}px * var(--app-font-scale, 1))`;
}

/** rem 版换算：组件里以 rem 写死的字号同样要跟随档位（不改变 rem 基准，只乘系数） */
export function uiFontSizeRem(rem: number): string {
  return `calc(${rem}rem * var(--app-font-scale, 1))`;
}

/**
 * 外观档位 → 要写进 documentElement 的 CSS 变量。
 * 只放**真的有人读**的项（第二十六轮把两条都接通了；第三十一轮补圆角通道）：
 *  · `--app-font-scale` —— canvasEntity.css 的 `.ps-workbench` 兜底 + uiFontSize()/uiFontSizeRem()
 *    生成的全部界面字号；
 *  · `--app-font-size-base` —— 同一条 CSS 规则里作为「没有排版通道时」的字号基准。
 *    它在第二十五轮之前是注入了没人读的死变量，本轮起才有消费者。
 *  · `--app-radius-base` —— 圆角档位的基准半径（第三十一轮）。此前这条通道**刻意缺席**，
 *    理由写的是「MUI 已注入 --template-shape-borderRadius，别造同名不同源的变量」。
 *    该理由的前提被第三十一轮实测推翻了一半：那条变量确实存在（cssVarPrefix 配的是
 *    'template'），但它姓 MUI —— 前缀一改 / CssBaseline 一撤就全体断供，且源码 grep
 *    不到变量名导致两轮审计各说各话。本仓的非 MUI 渲染区从此只认这一个入口：
 *    消费点见 SettingsDrawer 原生 color 色卡；静态 CSS / 内联 style 新增圆角一律
 *    `var(--app-radius-base, 6px)`（兜底值 = medium 档，与主题默认一致）。
 * 脏档位口径与字号一致：未声明 / 非法值回落 medium，绝不把 undefined 带进 :root。
 */
export function appearanceCssVars(config: {
  fontSize: FontSize;
  borderRadius?: BorderRadius;
  borderRadiusCustom?: number;
}): Record<string, string> {
  return {
    '--app-font-scale': String(round3(FONT_SIZE_SCALE[config.fontSize] ?? 1)),
    '--app-font-size-base': `${FONT_SIZE_BASE[config.fontSize] ?? 14}px`,
    '--app-radius-base': `${radiusBasePx({ borderRadius: config.borderRadius ?? 'medium', borderRadiusCustom: config.borderRadiusCustom })}px`,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
