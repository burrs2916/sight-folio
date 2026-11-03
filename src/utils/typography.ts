// 写作台正文排版档位（P3）：字段定义 + 取值优先级 + 渲染层换算。
//
// 落点口径（第三十轮 P1 改这条链路）：书级覆盖**不再**逐本写 localStorage，而是整张表
// 写应用设置库 KV（`store/bookTypographyStore.ts`，键 writing_typography_books），与主题 /
// 布局 / 正文默认排版 / 写作偏好同一套持久化。旧口径的病灶正是用户点名的两件事：
//  ① 「关掉软件设置就不在了」—— localStorage 属于 webview 存储，清 webview 数据 / 换机 /
//     第 28 轮那条内存库退路都不覆盖它，它也没有可信层（写失败静默）；
//  ② 「设置功能不完整」—— 书级覆盖不进设置备份（导出看起来是一套，实际缺这一域）、
//     不跨窗口广播（主窗口调完，开着的写作台仍是旧值）。
// 本模块只保留「渲染路径同步可读」的模块级读数：loadTypography() 在编辑器渲染路径上是
// 同步调用的，不能在那里等 IPC，所以两份读数都由 store 单向推进来。

export type PaperTone = 'default' | 'sepia' | 'green';

/** 正文字体 key：设置面板按此展示，编辑器按 FONT_FAMILY_STACKS 渲染 */
export type FontFamilyKey = 'system' | 'song' | 'kai' | 'hei' | 'fangsong' | 'yahei';

/** 英文字体 key：可单独设置，与中文字体分离组合（美观优先，兼顾系统可用性） */
export type LatinFontFamilyKey =
  | 'system'
  | 'georgia'
  | 'times'
  | 'garamond'
  | 'playfair'
  | 'lora'
  | 'inter'
  | 'helvetica'
  | 'sf'
  | 'roboto'
  | 'lato'
  | 'montserrat'
  | 'consolas'
  | 'courier'
  | 'jetbrains';

/** 英文字体分组：衬线（正文感）/ 无衬线（现代感）/ 等宽（代码感） */
export type LatinFontGroup = 'serif' | 'sans' | 'mono';

export interface BookTypography {
  /** 正文字号 px（14–22） */
  fontSize: number;
  /** 正文字体（写作常用中文排版字体，按 key 映射到 font-family） */
  fontFamily: FontFamilyKey;
  /** 西文字体（与中文分离设置：衬线/无衬线/等宽三组，体现英文排版美观与丰富度） */
  latinFontFamily: LatinFontFamilyKey;
  /** 行距（1.6 / 1.9 / 2.2） */
  lineHeight: number;
  /** 段间距 em（0 / 0.5 / 1 / 1.5） */
  paraSpacing: number;
  /** 首行缩进 2em（中文出版惯例） */
  indent: boolean;
  /** 正文页宽 px（620 / 760 / 900） */
  pageWidth: number;
  /** 纸色：跟随主题 / 米黄 / 护眼绿 */
  paper: PaperTone;
}

/** 中文字体选项：key → 展示名与 CSS 字体栈（含西文/系统回退，保证缺字体时优雅回落） */
export const FONT_FAMILY_OPTIONS: ReadonlyArray<{ key: FontFamilyKey; label: string; stack: string }> = [
  { key: 'system', label: '跟随系统', stack: '' },
  { key: 'song', label: '宋体', stack: "'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif" },
  { key: 'kai', label: '楷体', stack: "'Kaiti SC', 'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif" },
  { key: 'hei', label: '黑体', stack: "'Heiti SC', 'SimHei', 'Noto Sans CJK SC', sans-serif" },
  { key: 'fangsong', label: '仿宋', stack: "'FangSong', 'STFangsong', 'Noto Serif CJK SC', serif" },
  { key: 'yahei', label: '微软雅黑', stack: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif" },
];

/**
 * 英文字体选项：key → 展示名与 CSS 字体栈。
 * 分组 serif（衬线·正文感）/ sans（无衬线·现代感）/ mono（等宽·代码感）。
 * 栈刻意**不含末尾通用族**（serif/sans-serif/monospace）：
 * 由 resolveBodyFont 与中文字体栈拼接后统一收尾，避免出现两段通用族。
 */
export const LATIN_FONT_OPTIONS: ReadonlyArray<{
  key: LatinFontFamilyKey;
  label: string;
  group: LatinFontGroup;
  stack: string;
}> = [
  // 衬线：经典正文 / 报刊 / 复古
  { key: 'georgia', label: 'Georgia', group: 'serif', stack: "'Georgia', 'Times New Roman'" },
  { key: 'times', label: 'Times New Roman', group: 'serif', stack: "'Times New Roman', 'Times'" },
  { key: 'garamond', label: 'Garamond', group: 'serif', stack: "'Garamond', 'EB Garamond', 'ITC Garamond'" },
  { key: 'playfair', label: 'Playfair Display', group: 'serif', stack: "'Playfair Display', 'Georgia'" },
  { key: 'lora', label: 'Lora', group: 'serif', stack: "'Lora', 'Georgia', 'Times New Roman'" },
  // 无衬线：现代 / 屏幕阅读 / 品牌感
  { key: 'inter', label: 'Inter', group: 'sans', stack: "'Inter', 'Helvetica Neue', 'Arial'" },
  { key: 'helvetica', label: 'Helvetica Neue', group: 'sans', stack: "'Helvetica Neue', 'Helvetica', 'Arial'" },
  { key: 'sf', label: 'SF Pro', group: 'sans', stack: "'SF Pro Text', -apple-system, 'Segoe UI'" },
  { key: 'roboto', label: 'Roboto', group: 'sans', stack: "'Roboto', 'Segoe UI', 'Arial'" },
  { key: 'lato', label: 'Lato', group: 'sans', stack: "'Lato', 'Helvetica Neue', 'Arial'" },
  { key: 'montserrat', label: 'Montserrat', group: 'sans', stack: "'Montserrat', 'Segoe UI', 'Arial'" },
  // 等宽：代码 / 技术文档 / 强调
  { key: 'consolas', label: 'Consolas', group: 'mono', stack: "'Consolas', 'SF Mono', 'Menlo'" },
  { key: 'courier', label: 'Courier New', group: 'mono', stack: "'Courier New', 'Courier', 'Menlo'" },
  { key: 'jetbrains', label: 'JetBrains Mono', group: 'mono', stack: "'JetBrains Mono', 'Fira Code', 'Menlo'" },
];

/** 按 key 取 CSS font-family（system 用空串跟随系统字族） */
export function fontFamilyStack(key: FontFamilyKey): string {
  return FONT_FAMILY_OPTIONS.find((o) => o.key === key)?.stack ?? '';
}

/** 按 key 取英文字体栈（system 返回空串） */
export function latinFontStack(key: LatinFontFamilyKey): string {
  return LATIN_FONT_OPTIONS.find((o) => o.key === key)?.stack ?? '';
}

/** 系统缺省中文回退栈：英文字体单独设置、中文跟随系统时兜底（与 editorSx 原 fallback 一致） */
const CJK_FALLBACK_STACK = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";

/**
 * 组合正文 font-family：西文栈在前 + 中文栈在后，按各字体族的字形覆盖分工渲染。
 * - 全跟随系统 → ''（调用方自行回退到系统栈）；
 * - 仅中文 → 直接返回中文栈；
 * - 仅英文 → 西文栈 + 中文回退栈（中文仍由系统衬线兜底，不丢中文渲染）；
 * - 两者都有 → `latin, cjk`（西文字形走西文栈，中文走中文栈）。
 */
export function resolveBodyFont(latinKey: LatinFontFamilyKey, cjkKey: FontFamilyKey): string {
  const latin = latinFontStack(latinKey);
  const cjk = fontFamilyStack(cjkKey);
  if (!latin && !cjk) return '';
  if (!latin) return cjk;
  if (!cjk) return `${latin}, ${CJK_FALLBACK_STACK}`;
  return `${latin}, ${cjk}`;
}

/** 工具栏字号快捷档位（px）：写作常用档，精细调整仍可走排版面板 slider（14–22 连续） */
export const FONT_SIZE_PRESETS: ReadonlyArray<number> = [14, 15, 16, 18, 20, 22];

export const DEFAULT_TYPOGRAPHY: BookTypography = {
  fontSize: 16,
  fontFamily: 'system',
  latinFontFamily: 'system',
  lineHeight: 1.9,
  paraSpacing: 0.5,
  indent: false,
  pageWidth: 760,
  paper: 'default',
};

/**
 * 历史遗留前缀（第三十轮 P1 之前，书级排版逐本存 localStorage）。
 * 现在只服务「一次性迁移 + 迁移后清理」，渲染路径不再读它。
 */
export const LEGACY_BOOK_TYPOGRAPHY_PREFIX = 'sight-folio.typography.';

// ─── 全局默认排版（第十八轮新增设置项）─────────────────────────────────────────
// 设置抽屉里的「正文默认排版」写入应用设置库（typographyDefaultsStore），这里只保留一份
// 模块级读数：loadTypography 在编辑器渲染路径上是**同步**调用的，不能在那等 IPC。
// 优先级：书级覆盖（设置库） > 全局默认（设置库） > 内置默认 DEFAULT_TYPOGRAPHY。
let globalDefaults: BookTypography = { ...DEFAULT_TYPOGRAPHY };

/** 由 typographyDefaultsStore 在 init / 改档时单向推入（不进 store 是为了让本模块保持零依赖） */
export function setGlobalTypographyDefaults(config: BookTypography): void {
  globalDefaults = { ...config };
}

/** 当前全局默认排版（面板展示「恢复默认」的目标值） */
export function getGlobalTypographyDefaults(): BookTypography {
  return { ...globalDefaults };
}

// ─── 书级覆盖（第三十轮 P1：落点从 localStorage 换到设置库）────────────────────
/**
 * 读数口径：每本书只存**它真的调过的那几个字段**（Partial），没调过的字段继续跟随全局默认。
 *
 * 为什么不做「整本快照」：写作台排版面板一次只改一个字段，旧实现却把「合并后的整套」写回
 * localStorage —— 于是「只把这本书字号调大 1px」会让它从此再不受「正文默认排版」影响，
 * 用户在抽屉里改字号/行距对那本书毫无反应，读起来还是「设置没生效」。按字段沉淀之后，
 * 「这本书单独管字号、其余跟随默认」这类真实意图才能被存住，`bodyTypographyHint` 那句
 * 「写作台里调过的以该书为准」也才与实际行为一致。
 */
let bookOverrides: Record<string, Partial<BookTypography>> = {};

const FONT_SIZE_RANGE = { min: 14, max: 22 } as const;
const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.6 } as const;
const PARA_SPACING_RANGE = { min: 0, max: 2 } as const;
const PAGE_WIDTH_OPTIONS = [620, 760, 900] as const;

function clamp(value: number, min: number, max: number): number {
  // NaN 兜到区间下界：脏数据（手改设置库 / 旧版本字段）最多让排版回到最小档，
  // 不能把 NaN 传进 fontSize / lineHeight，否则整篇正文按浏览器默认渲染、行距塌陷。
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 收敛一份书级覆盖：数字越界即夹紧（与旧实现同口径），枚举档位外的脏值**整字段丢掉**
 * （丢掉等于「这一项没单独调过」，该字段自然回到全局默认 —— 比硬塞一个缺省值更诚实，
 * 也不会因为一处脏数据把整本书的排版打回内置默认）。
 */
export function normalizeBookOverride(raw: unknown): Partial<BookTypography> {
  const p = (raw ?? {}) as Partial<BookTypography>;
  const out: Partial<BookTypography> = {};
  if (p.fontSize !== undefined && Number.isFinite(Number(p.fontSize))) {
    out.fontSize = clamp(Number(p.fontSize), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
  }
  if (p.lineHeight !== undefined && Number.isFinite(Number(p.lineHeight))) {
    out.lineHeight = clamp(Number(p.lineHeight), LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max);
  }
  // 段距 0 是合法档位（段间不留空），所以不能走「0 视为没设过」的读法
  if (p.paraSpacing !== undefined && Number.isFinite(Number(p.paraSpacing))) {
    out.paraSpacing = clamp(Number(p.paraSpacing), PARA_SPACING_RANGE.min, PARA_SPACING_RANGE.max);
  }
  if (FONT_FAMILY_OPTIONS.some((o) => o.key === p.fontFamily)) {
    out.fontFamily = p.fontFamily as FontFamilyKey;
  }
  if (p.latinFontFamily === 'system' || LATIN_FONT_OPTIONS.some((o) => o.key === p.latinFontFamily)) {
    out.latinFontFamily = p.latinFontFamily as LatinFontFamilyKey;
  }
  if (typeof p.indent === 'boolean') out.indent = p.indent;
  if (PAGE_WIDTH_OPTIONS.includes(p.pageWidth as (typeof PAGE_WIDTH_OPTIONS)[number])) {
    out.pageWidth = p.pageWidth as number;
  }
  if (p.paper === 'default' || p.paper === 'sepia' || p.paper === 'green') out.paper = p.paper;
  return out;
}

/**
 * 由 bookTypographyStore 在 init / 改档 / 跨窗口 hydrate 时单向推入。
 * 进来即再收敛一遍：本模块是渲染路径上的同步读取点，宁可在这里把脏值挡掉，
 * 也不让「谁调了这个函数」成为正确性的前提。
 */
export function setBookTypographyOverrides(map: Record<string, unknown> | null | undefined): void {
  const next: Record<string, Partial<BookTypography>> = {};
  for (const [bookId, raw] of Object.entries(map ?? {})) {
    const normalized = normalizeBookOverride(raw);
    // 空覆盖不落表：那本书就是「跟随全局默认」，留一个空对象只会让界面误标「已单独调过」
    if (Object.keys(normalized).length > 0) next[bookId] = normalized;
  }
  bookOverrides = next;
}

/** 当前书级覆盖表（面板展示「哪几本书单独调过」用） */
export function getBookTypographyOverrides(): Record<string, Partial<BookTypography>> {
  return { ...bookOverrides };
}

/** 某本书单独调过哪几项（排版面板 / 设置抽屉的「本书已单独设置」标记与计数用） */
export function bookOverrideFields(bookId: string | null | undefined): (keyof BookTypography)[] {
  if (!bookId) return [];
  return Object.keys(bookOverrides[bookId] ?? {}) as (keyof BookTypography)[];
}

/** 读某本书的排版：书级覆盖 > 全局默认；脏值逐项回落，绝不因脏数据炸掉编辑器 */
export function loadTypography(bookId: string | null): BookTypography {
  const base = globalDefaults;
  if (!bookId) return { ...base };
  const override = bookOverrides[bookId];
  return override ? { ...base, ...override } : { ...base };
}

/**
 * 一次性迁移：读回历史 localStorage 里的逐本书级排版（第三十轮 P1）。
 * 旧实现写的是「整套快照」，所以这里逐本原样收下来（由调用方写进设置库），
 * 迁移当天每本书的观感与迁移前逐字段一致；随后 `clearLegacyBookTypographyOverrides()` 清干净，
 * 不留第二条真源。localStorage 不可用（非浏览器环境）时返回空表，不影响启动。
 */
export function collectLegacyBookTypographyOverrides(): Record<string, Partial<BookTypography>> {
  const out: Record<string, Partial<BookTypography>> = {};
  if (typeof localStorage === 'undefined') return out;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LEGACY_BOOK_TYPOGRAPHY_PREFIX)) continue;
    const bookId = key.slice(LEGACY_BOOK_TYPOGRAPHY_PREFIX.length);
    if (!bookId) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const normalized = normalizeBookOverride(JSON.parse(raw) as Partial<BookTypography>);
      if (Object.keys(normalized).length > 0) out[bookId] = normalized;
    } catch {
      // 一本的脏 JSON 只作废这一本的迁移，不能连带丢掉其它书的排版（更不能卡住启动）
      continue;
    }
  }
  return out;
}

/** 迁移完成后清掉历史逐本书的 localStorage 键（同 themeStore 清 LEGACY_THEME_STORAGE_KEY 的口径） */
export function clearLegacyBookTypographyOverrides(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_BOOK_TYPOGRAPHY_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* 清不掉也不影响新链路（渲染路径已不再读这里） */
  }
}

/**
 * 画布章节编辑器的排版通道（第二十六轮新增设置项消费点）。
 *
 * 病灶：「正文默认排版」此前只有**写作台**读得到 —— 那条链路是
 * `buildEditorBodySx(typo, dark)`（Emotion 生成 sx）。而工作室画布里的章节卡正文
 * 走的是 `canvasEntity.css` 的 `.ps-workbench .ProseMirror`（画布零 Emotion 约定，
 * 见 `editor/renderers/canvasTheme.ts` 文件头），字号/行高/段距全是静态 CSS 的写死值。
 * 于是同一份正文在两套渲染器下观感不一致，且用户在抽屉里改「正文默认排版」时画布
 * **完全不反应** —— 正是本仓反复在清的「设置只存不读」。
 *
 * 通道口径：组件把这份档位算成 CSS 自定义属性写在 `.ps-workbench` 容器上，
 * 静态 CSS 用 `var()` 读 —— 既守住「画布不碰 Emotion / 不碰 theme 对象」的性能约定，
 * 又让档位有唯一一处换算（本函数），两套渲染器不会各算一份。
 */
export const BODY_TYPOGRAPHY_CSS_VARS = {
  fontSize: '--ps-body-font-size',
  lineHeight: '--ps-body-line-height',
  paraSpacing: '--ps-body-para-spacing',
  fontFamily: '--ps-body-font-family',
  textIndent: '--ps-body-text-indent',
  pageWidth: '--ps-body-page-width',
  paper: '--ps-body-paper',
} as const;

/**
 * MUI 默认 spacing 单位（px）。写作台的段距走的是 `my: typo.paraSpacing`，
 * 即 paraSpacing × 8px；画布侧要与之同口径，否则「段间距」这一档在两边不是一回事
 * （静态 CSS 里此前写死 `margin: 0.6em` 就是各算一份的结果）。
 */
export const MUI_SPACING_UNIT = 8;

/**
 * 档位 → 画布可消费的 CSS 变量。
 * 字族与纸色刻意**可以缺席**：`system` 字族 = 跟随界面字族（不注入即 inherit），
 * `paper = 'default'` = 跟随主题纸面（不注入即透明），两种情况都不该硬塞一个值进去。
 */
export function bodyTypographyCssVars(typo: BookTypography, dark: boolean): Record<string, string> {
  const vars: Record<string, string> = {
    [BODY_TYPOGRAPHY_CSS_VARS.fontSize]: `${typo.fontSize}px`,
    [BODY_TYPOGRAPHY_CSS_VARS.lineHeight]: String(typo.lineHeight),
    [BODY_TYPOGRAPHY_CSS_VARS.paraSpacing]: `${Math.round(typo.paraSpacing * MUI_SPACING_UNIT * 100) / 100}px`,
    [BODY_TYPOGRAPHY_CSS_VARS.textIndent]: typo.indent ? '2em' : '0px',
    [BODY_TYPOGRAPHY_CSS_VARS.pageWidth]: `${typo.pageWidth}px`,
  };
  const family = resolveBodyFont(typo.latinFontFamily, typo.fontFamily);
  if (family) vars[BODY_TYPOGRAPHY_CSS_VARS.fontFamily] = family;
  const paper = paperBackground(typo.paper, dark);
  if (paper) vars[BODY_TYPOGRAPHY_CSS_VARS.paper] = paper;
  return vars;
}

/** 纸色底：明暗主题各配一组（暗色下用低亮度暖/绿色调，避免刺眼白底） */
export function paperBackground(paper: PaperTone, dark: boolean): string | undefined {
  switch (paper) {
    case 'sepia':
      return dark ? '#2b261d' : '#f7efe0';
    case 'green':
      return dark ? '#1f2a20' : '#e6efe2';
    default:
      return undefined;
  }
}
