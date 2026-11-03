// 写作正文「默认排版」偏好（第十八轮新增设置项）
//
// 为什么需要它：正文排版此前只有**书级**设置（写作台「排版」面板 → localStorage 按书 id 存），
// 全局没有一处能一次调好「我习惯的字号 / 行距 / 字体 / 页宽」。结果是每开一本新书都要重调一遍，
// 设置抽屉里也完全没有排版入口 —— 用户点名的「设置功能不完整」。
//
// 优先级口径（自上而下）：**书级覆盖 > 本处全局默认 > 内置默认 DEFAULT_TYPOGRAPHY**。
// 落点仍走应用设置库 KV（键 WRITING_TYPOGRAPHY_SETTINGS_KEY），与主题 / 布局同一套持久化，
// 重启由 init() 读回，做到「设置完成后关闭软件再打开仍然是那套排版」。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { broadcastAppearanceChange } from '../services/appearanceSync';
import { persistSettings } from './settingsSyncStore';
import { DEFAULT_TYPOGRAPHY, setGlobalTypographyDefaults } from '../utils/typography';
import type { BookTypography, FontFamilyKey, LatinFontFamilyKey, PaperTone } from '../utils/typography';
import { FONT_FAMILY_OPTIONS, LATIN_FONT_OPTIONS } from '../utils/typography';
// 读回迟到竞态防护（第三十四轮）：口径与为什么需要它见 settingsReadbackGuard.ts 文件头
import { attachSettingsReadbackGuard, mergeStaleReadback, isSameReadbackByFields } from './settingsReadbackGuard';

/** 正文排版配置的专用持久化键（写入应用设置库，重启由 init 读回）。 */
export const WRITING_TYPOGRAPHY_SETTINGS_KEY = 'writing_typography';
/** 本域真正落库的字段清单（第三十四轮，给读回竞态防护用）；与 BookTypography 逐字段对齐 */
const TYPOGRAPHY_PERSISTED_FIELDS = [
  'fontSize',
  'lineHeight',
  'paraSpacing',
  'fontFamily',
  'latinFontFamily',
  'indent',
  'pageWidth',
  'paper',
] as const;

const FONT_SIZE_RANGE = { min: 14, max: 22 } as const;
const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.6 } as const;
const PARA_SPACING_RANGE = { min: 0, max: 2 } as const;
const PAGE_WIDTH_OPTIONS = [620, 760, 900] as const;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 与默认值合并并逐项校验：脏值 / 缺字段一律回落，绝不把编辑器渲染成不可读排版 */
function normalizeConfig(parsed: Partial<BookTypography> | null | undefined): BookTypography {
  const p = parsed ?? {};
  return {
    fontSize: clamp(p.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, DEFAULT_TYPOGRAPHY.fontSize),
    lineHeight: clamp(p.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max, DEFAULT_TYPOGRAPHY.lineHeight),
    // 段距 0 是合法档位（段间不留空），所以不走「0 视为缺省」的读法，直接按区间收敛
    paraSpacing: clamp(p.paraSpacing, PARA_SPACING_RANGE.min, PARA_SPACING_RANGE.max, DEFAULT_TYPOGRAPHY.paraSpacing),
    fontFamily: FONT_FAMILY_OPTIONS.some((o) => o.key === p.fontFamily)
      ? (p.fontFamily as FontFamilyKey)
      : DEFAULT_TYPOGRAPHY.fontFamily,
    latinFontFamily:
      p.latinFontFamily === 'system' || LATIN_FONT_OPTIONS.some((o) => o.key === p.latinFontFamily)
        ? (p.latinFontFamily as LatinFontFamilyKey)
        : DEFAULT_TYPOGRAPHY.latinFontFamily,
    indent: p.indent === true,
    pageWidth: PAGE_WIDTH_OPTIONS.includes(p.pageWidth as (typeof PAGE_WIDTH_OPTIONS)[number])
      ? (p.pageWidth as number)
      : DEFAULT_TYPOGRAPHY.pageWidth,
    paper: p.paper === 'sepia' || p.paper === 'green' ? (p.paper as PaperTone) : DEFAULT_TYPOGRAPHY.paper,
  };
}

/**
 * 是否仍是内置默认排版（第二十六轮，给设置抽屉「正文默认排版」章节的「已微调」标记用）。
 * 逐字段比而不是 JSON.stringify：normalizeConfig 出来的键序稳定，但「未声明字段」补出来的
 * 缺省值与内置默认本就是同一生效读数，字符串比较会把没改过的人标成微调。
 */
export function isTypographyDefault(config: BookTypography): boolean {
  return (
    config.fontSize === DEFAULT_TYPOGRAPHY.fontSize &&
    config.lineHeight === DEFAULT_TYPOGRAPHY.lineHeight &&
    config.paraSpacing === DEFAULT_TYPOGRAPHY.paraSpacing &&
    config.fontFamily === DEFAULT_TYPOGRAPHY.fontFamily &&
    config.latinFontFamily === DEFAULT_TYPOGRAPHY.latinFontFamily &&
    config.indent === DEFAULT_TYPOGRAPHY.indent &&
    config.pageWidth === DEFAULT_TYPOGRAPHY.pageWidth &&
    config.paper === DEFAULT_TYPOGRAPHY.paper
  );
}

interface TypographyDefaultsState {
  config: BookTypography;
  initialized: boolean;

  init: () => Promise<void>;
  setConfig: (partial: Partial<BookTypography>) => void;
  /** 跨窗口跟随：只改内存并同步 utils/typography 的模块级读数，绝不回写设置库 */
  hydrate: (config: Partial<BookTypography> | null | undefined) => void;
  reset: () => void;
}

function _persist(config: BookTypography): void {
  // 同步喂给 utils/typography 的模块级默认值：loadTypography() 是同步读的（编辑器渲染路径上），
  // 不能在那里等 IPC，所以「当前全局默认」由 store 单向推过去。
  setGlobalTypographyDefaults(config);
  // 写作台是独立窗口，排版改在这里、看在那边：广播让已开着的写作台即时跟随
  broadcastAppearanceChange('typography', config);
  // 第二十轮：统一可信层，写库失败会被记录并在抽屉里如实显示
  persistSettings('typography', WRITING_TYPOGRAPHY_SETTINGS_KEY, JSON.stringify(config));
}

export const useTypographyDefaultsStore = create<TypographyDefaultsState>((set, get) => ({
  config: { ...DEFAULT_TYPOGRAPHY },
  initialized: false,

  init: async () => {
    // 第三十四轮：抽屉里的排版滑杆与写作台在首帧门控超时后就已经能操作，迟到的库读数
    // 整份盖回来会把用户刚调的那一项吞掉。合并时**必须连同 utils/typography 的模块级读数
    // 一起推**：loadTypography() 是编辑器渲染路径上同步读的，只改 store 就是「读数与观感分家」。
    const mark = typographyReadback.capture();
    const adoptMerged = (merged: BookTypography) => {
      set({ config: merged, initialized: true });
      setGlobalTypographyDefaults(merged);
      _persist(merged);
    };
    try {
      const saved = await settingsApi.get(WRITING_TYPOGRAPHY_SETTINGS_KEY);
      if (typographyReadback.isStale(mark)) {
        const current = get().config;
        if (saved) {
          const merged = mergeStaleReadback<BookTypography>(
            normalizeConfig(JSON.parse(saved) as Partial<BookTypography>),
            current,
            typographyReadback.dirtyKeys(),
          );
          if (!isSameReadbackByFields(merged, current, TYPOGRAPHY_PERSISTED_FIELDS)) adoptMerged(merged);
          else set({ initialized: true });
        } else {
          set({ initialized: true });
        }
        return;
      }
      const config = saved ? normalizeConfig(JSON.parse(saved) as Partial<BookTypography>) : { ...DEFAULT_TYPOGRAPHY };
      set({ config, initialized: true });
      setGlobalTypographyDefaults(config);
    } catch (error) {
      console.error('[TypographyDefaultsStore] 从设置库加载正文默认排版失败:', error);
      // 同一条口径：读回失败也不能把用户刚调的排版回落成内置默认
      if (typographyReadback.isStale(mark)) {
        set({ initialized: true });
        return;
      }
      set({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
      setGlobalTypographyDefaults(DEFAULT_TYPOGRAPHY);
    }
  },

  setConfig: (partial) => {
    const config = normalizeConfig({ ...get().config, ...partial });
    set({ config });
    _persist(config);
  },

  // 跨窗口跟随：normalizeConfig 收敛脏值后与本地一致就跳过（emit 会广播回发起窗口自己）；
  // 走 setGlobalTypographyDefaults 而不走 _persist —— 回声不该再落一次库、再广播一次。
  hydrate: (config) => {
    if (!config) return;
    const next = normalizeConfig({ ...get().config, ...config });
    if (JSON.stringify(next) === JSON.stringify(get().config)) return;
    set({ config: next });
    setGlobalTypographyDefaults(next);
  },

  reset: () => {
    set({ config: { ...DEFAULT_TYPOGRAPHY } });
    _persist(DEFAULT_TYPOGRAPHY);
  },
}));

export { PAGE_WIDTH_OPTIONS };

/**
 * 读回竞态防护（第三十四轮）：订阅口径，一处覆盖 setConfig / hydrate / reset 三个写入口。
 * 必须挂在模块级 store 上（不是组件里），否则每个窗口各挂一份、读数就分了家。
 */
const typographyReadback = attachSettingsReadbackGuard(useTypographyDefaultsStore, {
  scope: 'typography',
  select: (s) => s.config,
  fields: TYPOGRAPHY_PERSISTED_FIELDS,
});
