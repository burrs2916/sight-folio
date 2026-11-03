// 写作偏好（第二十四轮新增设置域）
//
// 为什么单独一个域，而不是塞进 theme / layout：
// 这三项管的都不是「界面长什么样」，而是「写作台怎么替创作者干活」——专注模式、打字机滚动、
// 自动保存节奏。它们与外观档位的生效路径不同（消费点在 WritingPage / WritingChapterEditor），
// 混进 theme 会让「点外观预设顺手改掉创作习惯」的旧病灶复发。
//
// 此前这三处都是代码里的写死值或组件私有 state：
//  ① 专注模式是 WritingPage 的 useState('normal') —— 今天开禅模式写作，明天重启又回到普通态，
//     用户口中的「设置不记住」正是这一类；
//  ② 打字机滚动只在禅模式里生效（`if (focusMode !== 'zen') return`），想要「任何时候光标都居中」
//     的人只能去开禅模式，而禅模式会连带收起左右栏；
//  ③ 正文自动保存固定 800ms 防抖（SAVE_DEBOUNCE_MS），网不稳 / 库慢时没有「更保守」可选，
//     追求即时入库的人也调不紧。
//
// 持久化口径与外观域完全一致：写应用设置库（键 WRITING_PREFS_SETTINGS_KEY），走可信层
// persistSettings（失败自动重试 + 状态可读），落库的同一处广播跨窗口跟随，启动 init() 读回。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { broadcastAppearanceChange } from '../services/appearanceSync';
import { persistSettings } from './settingsSyncStore';
// 读回迟到竞态防护（第三十四轮）：口径与为什么需要它见 settingsReadbackGuard.ts 文件头
import { attachSettingsReadbackGuard, mergeStaleReadback, isSameReadbackByFields } from './settingsReadbackGuard';

/** 写作台专注模式档位（与 WritingPage 的三态一一对应） */
export type DeskFocusMode = 'normal' | 'focus' | 'zen';
/**
 * 打字机滚动（光标所在段自动滚到视窗中部）的生效范围：
 * - off：不自动滚（有人就要自己握着滚动条）
 * - zen：只在禅模式里滚（第二十四轮之前的唯一行为，作为默认档老用户观感不变）
 * - always：任何模式都滚（不牺牲左右栏，只想要光标居中的创作者不必再开禅模式）
 */
export type TypewriterScroll = 'off' | 'zen' | 'always';
/** 正文自动保存节奏（对应防抖毫秒数，见 SAVE_CADENCE_MS） */
export type SaveCadence = 'fast' | 'standard' | 'steady';

export interface WritingPrefs {
  focusMode: DeskFocusMode;
  typewriterScroll: TypewriterScroll;
  saveCadence: SaveCadence;
}

/** 写作偏好的专用持久化键（写入应用设置库，重启由 init 读回） */
export const WRITING_PREFS_SETTINGS_KEY = 'writing_prefs';
/** 本域真正落库的字段清单（第三十四轮，给读回竞态防护用） */
const WRITING_PREFS_PERSISTED_FIELDS = ['focusMode', 'typewriterScroll', 'saveCadence'] as const;

/**
 * 节奏档位 → 防抖毫秒数（单一真源）。
 * standard 就是此前写死的 800ms：默认档 = 升级前的行为，没人会被这次改动打到。
 */
export const SAVE_CADENCE_MS: Record<SaveCadence, number> = {
  fast: 400,
  standard: 800,
  steady: 1500,
};

/** 档位顺序（= 抽屉展示顺序，也是归一化用的合法值唯一来源） */
export const FOCUS_MODE_OPTIONS: DeskFocusMode[] = ['normal', 'focus', 'zen'];
export const TYPEWRITER_OPTIONS: TypewriterScroll[] = ['off', 'zen', 'always'];
export const SAVE_CADENCE_OPTIONS: SaveCadence[] = ['fast', 'standard', 'steady'];

const DEFAULT_WRITING_PREFS: WritingPrefs = {
  focusMode: 'normal',
  typewriterScroll: 'zen',
  saveCadence: 'standard',
};

function pick<T extends string>(value: unknown, options: T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/**
 * 归一化：脏值 / 缺字段一律回落缺省档（与 themeStore.normalizeThemeConfig 同一口径）。
 * 目的是绝不让 undefined 或档位外的字符串走到消费点 —— 那正是「设置了但没生效」的成因之一。
 */
export function normalizeWritingPrefs(parsed: Partial<WritingPrefs> | null | undefined): WritingPrefs {
  const merged = { ...DEFAULT_WRITING_PREFS, ...(parsed ?? {}) };
  return {
    focusMode: pick(merged.focusMode, FOCUS_MODE_OPTIONS, DEFAULT_WRITING_PREFS.focusMode),
    typewriterScroll: pick(merged.typewriterScroll, TYPEWRITER_OPTIONS, DEFAULT_WRITING_PREFS.typewriterScroll),
    saveCadence: pick(merged.saveCadence, SAVE_CADENCE_OPTIONS, DEFAULT_WRITING_PREFS.saveCadence),
  };
}

/** 生效值相同（逐字段比，不比对象引用）：hydrate 与「无谓写盘」判定共用 */
export function isSameWritingPrefs(a: WritingPrefs, b: WritingPrefs): boolean {
  return a.focusMode === b.focusMode && a.typewriterScroll === b.typewriterScroll && a.saveCadence === b.saveCadence;
}

/** 是否仍是默认写作偏好（第二十六轮，给设置抽屉章节的「已微调」标记用） */
export function isWritingPrefsDefault(config: WritingPrefs): boolean {
  return isSameWritingPrefs(normalizeWritingPrefs(config), DEFAULT_WRITING_PREFS);
}

/** 当前节奏档位的防抖毫秒数（消费点：WritingPage / WritingChapterEditor 的排程处） */
export function saveDebounceMs(cadence: SaveCadence): number {
  return SAVE_CADENCE_MS[cadence] ?? SAVE_CADENCE_MS.standard;
}

/**
 * 打字机滚动此刻是否该执行（纯函数，供编辑器回调与回归锁共用）。
 * 抽出来的理由：这条判断此前直接写死在 onSelectionUpdate 里（只认 zen），
 * 档位化之后如果各消费点各写一份 if，行为迟早漂移。
 */
export function shouldCenterCaret(rule: TypewriterScroll, focusMode: DeskFocusMode): boolean {
  if (rule === 'off') return false;
  if (rule === 'always') return true;
  return focusMode === 'zen';
}

/** 工具栏/命令面板的循环顺序：普通 → 专注 → 禅 → 普通 */
export function nextDeskFocusMode(current: DeskFocusMode): DeskFocusMode {
  if (current === 'normal') return 'focus';
  if (current === 'focus') return 'zen';
  return 'normal';
}

function persist(config: WritingPrefs): void {
  // 先广播再落库：另一窗口立刻跟随同一套偏好；落库失败只是重启回到旧值，
  // 不该让正在写作的另一边继续用旧节奏（与 themeStore.persist 同一口径）。
  broadcastAppearanceChange('writing', config);
  persistSettings('writing', WRITING_PREFS_SETTINGS_KEY, JSON.stringify(config));
}

interface WritingPrefsState {
  config: WritingPrefs;
  initialized: boolean;

  init: () => Promise<void>;
  setFocusMode: (mode: DeskFocusMode) => void;
  setTypewriterScroll: (rule: TypewriterScroll) => void;
  setSaveCadence: (cadence: SaveCadence) => void;
  setConfig: (partial: Partial<WritingPrefs>) => void;
  /** 跨窗口跟随：只改内存，绝不回写设置库（来源已是另一窗口的落盘动作） */
  hydrate: (config: Partial<WritingPrefs> | null | undefined) => void;
  /** 恢复默认（设置抽屉「恢复默认」按钮带上本域） */
  reset: () => void;
}

export const useWritingPrefsStore = create<WritingPrefsState>((set, get) => ({
  config: { ...DEFAULT_WRITING_PREFS },
  initialized: false,

  init: async () => {
    // 第三十四轮：这一域的迟到读回比主题更容易吃掉了事 —— 消费点（写作台排程 / 画布回调）
    // 是「现取」（第 25 轮口径），内存被盖回旧档后连一次重渲染都不会发生，用户完全看不见。
    const mark = writingPrefsReadback.capture();
    try {
      const saved = await settingsApi.get(WRITING_PREFS_SETTINGS_KEY);
      if (writingPrefsReadback.isStale(mark)) {
        const current = get().config;
        if (saved) {
          const merged = mergeStaleReadback<WritingPrefs>(
            normalizeWritingPrefs(JSON.parse(saved) as Partial<WritingPrefs>),
            current,
            writingPrefsReadback.dirtyKeys(),
          );
          if (!isSameReadbackByFields(merged, current, WRITING_PREFS_PERSISTED_FIELDS)) {
            set({ config: merged, initialized: true });
            persist(merged);
            return;
          }
        }
        // 库里还没有这一键：绝不走下面那条「首次使用写缺省档」的分支 ——
        // 那会把用户刚刚自己选好的档位当成空库覆盖掉，比读数回退更严重。
        set({ initialized: true });
        return;
      }
      if (saved) {
        set({ config: normalizeWritingPrefs(JSON.parse(saved) as Partial<WritingPrefs>), initialized: true });
        return;
      }
      // 首次使用：把缺省档写进设置库，让「有默认值」这件事本身也对账可见（与 languageStore 同口径），
      // 之后所有窗口读到的都是同一份读数。
      set({ initialized: true });
      persist(get().config);
    } catch (error) {
      console.error('[WritingPrefsStore] 从设置库加载写作偏好失败:', error);
      // 同一条口径：读回失败也不能把用户刚选的档位回落成缺省
      if (writingPrefsReadback.isStale(mark)) {
        set({ initialized: true });
        return;
      }
      set({ config: { ...DEFAULT_WRITING_PREFS }, initialized: true });
    }
  },

  setFocusMode: (mode) => {
    const config = { ...get().config, focusMode: pick(mode, FOCUS_MODE_OPTIONS, get().config.focusMode) };
    if (isSameWritingPrefs(config, get().config)) return;
    set({ config });
    persist(config);
  },

  setTypewriterScroll: (rule) => {
    const config = {
      ...get().config,
      typewriterScroll: pick(rule, TYPEWRITER_OPTIONS, get().config.typewriterScroll),
    };
    if (isSameWritingPrefs(config, get().config)) return;
    set({ config });
    persist(config);
  },

  setSaveCadence: (cadence) => {
    const config = { ...get().config, saveCadence: pick(cadence, SAVE_CADENCE_OPTIONS, get().config.saveCadence) };
    if (isSameWritingPrefs(config, get().config)) return;
    set({ config });
    persist(config);
  },

  setConfig: (partial) => {
    const config = normalizeWritingPrefs({ ...get().config, ...partial });
    if (isSameWritingPrefs(config, get().config)) return;
    set({ config });
    persist(config);
  },

  hydrate: (partial) => {
    if (!partial) return;
    const next = normalizeWritingPrefs({ ...get().config, ...partial });
    if (isSameWritingPrefs(next, get().config)) return;
    set({ config: next });
  },

  reset: () => {
    const config = { ...DEFAULT_WRITING_PREFS };
    set({ config });
    persist(config);
  },
}));

export { DEFAULT_WRITING_PREFS };

/** 读回竞态防护（第三十四轮）：订阅口径，一处覆盖 setFocusMode / setTypewriterScroll / setSaveCadence / setConfig / hydrate / reset */
const writingPrefsReadback = attachSettingsReadbackGuard(useWritingPrefsStore, {
  scope: 'writing',
  select: (s) => s.config,
  fields: WRITING_PREFS_PERSISTED_FIELDS,
});
