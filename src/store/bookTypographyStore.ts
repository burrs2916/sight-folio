// 书级正文排版覆盖（第三十轮 P1 新增设置域）
//
// 病灶（也是用户点名的两件事的直接成因）：写作台「排版」面板调出来的 per-book 排版此前
// 逐本写浏览器 localStorage（`sight-folio.typography.<bookId>`），它**不在**外观/设置域那套
// 「设置库 KV + 可信层 + 跨窗口广播 + 备份」的链路里，于是：
//  ① 关掉软件 / 清 webview 数据 / 换设备 → 单独调过的排版凭空消失（第 28 轮 P0 同型落点问题）；
//  ② 设置抽屉「导出备份」只有 6 个键，这份排版从来不在里面 —— 备份假装完整；
//  ③ 主窗口调完，已开着的写作台独立窗口不跟随，要重开窗口才生效；
//  ④ 写失败只有一句 console，界面上照旧显示「自动保存」。
//
// 本轮把它按第 25 轮立的「新增设置域 6 件套」补齐：
//  落库 scope `typographyBooks` / init 读回 / 跨窗口 hydrate / 抽屉入口 / 真实消费点
//  （utils/typography.loadTypography，两套渲染器共用）/ 进设置备份键。
//
// 读数口径：`overrides[bookId]` 只存**这本书真的单独调过的字段**（见 utils/typography
// 的 normalizeBookOverride 注释）。没调过的字段继续跟随「设置 → 正文默认排版」。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { broadcastAppearanceChange } from '../services/appearanceSync';
import { persistSettings } from './settingsSyncStore';
// 读回迟到竞态防护（第三十四轮）：口径与为什么需要它见 settingsReadbackGuard.ts 文件头
import { attachSettingsReadbackGuard, mergeStaleReadback, isSameReadbackByFields } from './settingsReadbackGuard';
import {
  collectLegacyBookTypographyOverrides,
  clearLegacyBookTypographyOverrides,
  normalizeBookOverride,
  setBookTypographyOverrides,
} from '../utils/typography';
import type { BookTypography } from '../utils/typography';

/** 书级排版的持久化键（一张表装下所有书，与 appearance_profiles 同一口径：不按书拆键） */
export const BOOK_TYPOGRAPHY_SETTINGS_KEY = 'writing_typography_books';

/** 库里存的信封结构：加 version 是为了以后加维度时读回侧能分辨老格式（本轮为 v1） */
export interface PersistedBookTypographyOverrides {
  version: number;
  overrides: Record<string, Partial<BookTypography>>;
}

/** 书级覆盖表（bookId → 该书单独调过的那几项） */
export type BookTypographyOverrides = Record<string, Partial<BookTypography>>;

/**
 * 把「设置库读数 / 广播读数 / 备份读数」三种来源收敛成同一张表。
 * 广播与备份恢复传来的是裸表，库里的读数带 version 信封 —— 两种都认，
 * 但都以「字段级归一化」为准：任何一条来源里混进脏值都只丢那一个字段。
 */
function parseOverrides(raw: unknown): BookTypographyOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const candidate = raw as Partial<PersistedBookTypographyOverrides> & BookTypographyOverrides;
  const table =
    candidate.overrides && typeof candidate.overrides === 'object'
      ? (candidate.overrides as BookTypographyOverrides)
      : (candidate as BookTypographyOverrides);
  const out: BookTypographyOverrides = {};
  for (const [bookId, value] of Object.entries(table ?? {})) {
    const normalized = normalizeBookOverride(value);
    if (Object.keys(normalized).length > 0) out[bookId] = normalized;
  }
  return out;
}

interface BookTypographyState {
  overrides: BookTypographyOverrides;
  initialized: boolean;

  init: () => Promise<void>;
  /** 写作台排版面板的写入口：只把**本次改动的那几项**记到这本书名下 */
  patchBookTypography: (bookId: string | null, patch: Partial<BookTypography>) => void;
  /** 单项跟随全局默认（排版面板「恢复跟随」用） */
  clearBookTypography: (bookId: string | null) => void;
  /**
   * 只收回这本书的**指定几项**，其余单独调过的项保持不变（第三十二轮，收第 31 轮待办 7②）。
   * 病灶：此前只有「整本收回」一个粒度，用户只想让字号回到跟随默认、行距保留自己调的那档，
   * 唯一出口却是把整本书的排版全冲掉 —— 粒度比需求粗，读起来仍是「设置不顺手」。
   * 收完最后一项时整条删除，不留空对象（否则抽屉会数出「N 本书单独调过」而其实一项都没调）。
   */
  clearBookTypographyFields: (bookId: string | null, fields: (keyof BookTypography)[]) => void;
  /** 全部书都回到「跟随全局默认」（设置抽屉里的批量出口，调用方负责二次确认） */
  clearAllBookTypography: () => void;
  /**
   * 跨窗口跟随 / 备份恢复：只改内存与渲染层读数，绝不回写设置库（避免回声）。
   * 传裸表（广播）或带 version 的信封（备份）都认。
   */
  hydrate: (payload: unknown) => void;
  /** 测试用：把内存清到「本次启动还没读回」的形态 */
  reset: () => void;
}

/**
 * 唯一的落地动作：改内存 → 推给渲染层同步读数 → 广播 + 落库。
 * 顺序与其余外观域一致（先让本窗口立刻生效，再谈持久化），可信层负责把写库失败如实显示出来。
 */
function _apply(next: BookTypographyOverrides): void {
  setBookTypographyOverrides(next);
  broadcastAppearanceChange('typographyBooks', next);
  const payload: PersistedBookTypographyOverrides = { version: 1, overrides: next };
  persistSettings('typographyBooks', BOOK_TYPOGRAPHY_SETTINGS_KEY, JSON.stringify(payload));
}

export const useBookTypographyStore = create<BookTypographyState>((set, get) => ({
  overrides: {},
  initialized: false,

  // 启动读回：设置库为准；库里没有这一键时把历史 localStorage 逐本排版迁进来（一次性，迁完即清）。
  // 迁移分支刻意放在「库里没键」里，而不是每次启动都合并：设置库是唯一真源之后，
  // 用户在写作台清掉的覆盖不该被旧 localStorage 又复活一次。
  init: async () => {
    // 第三十四轮：写作台排版面板在首帧门控超时后就能调，用户「只把这本书字号调大 1px」之后
    // 迟到的库读数会把整张覆盖表换掉 —— 他那本书的单独排版当场消失，而且他下一次再调时
    // 落的是「旧表 + 这一本」，等于在库里也没了。合并粒度 = 一本一书（脏键就是 bookId）。
    const mark = bookTypographyReadback.capture();
    try {
      const saved = await settingsApi.get(BOOK_TYPOGRAPHY_SETTINGS_KEY);
      if (bookTypographyReadback.isStale(mark)) {
        const current = get().overrides;
        // 库里没有这一键时以老 localStorage 为底：迁移照做，但用户刚改的那几本永远在面上
        const base = saved ? parseOverrides(JSON.parse(saved)) : collectLegacyBookTypographyOverrides();
        const merged = mergeStaleReadback<Record<string, Partial<BookTypography>>>(
          base as Record<string, Partial<BookTypography>>,
          current as Record<string, Partial<BookTypography>>,
          bookTypographyReadback.dirtyKeys(),
        );
        if (!isSameReadbackByFields(merged, current)) {
          set({ overrides: merged, initialized: true });
          setBookTypographyOverrides(merged);
          _apply(merged);
        } else {
          set({ initialized: true });
        }
        clearLegacyBookTypographyOverrides();
        return;
      }
      if (saved) {
        const overrides = parseOverrides(JSON.parse(saved));
        set({ overrides, initialized: true });
        setBookTypographyOverrides(overrides);
        // 库里已有真源 → 旧键只是残留，清掉即可（不合并，见上方注释）
        clearLegacyBookTypographyOverrides();
        return;
      }
      const migrated = collectLegacyBookTypographyOverrides();
      set({ overrides: migrated, initialized: true });
      setBookTypographyOverrides(migrated);
      if (Object.keys(migrated).length > 0) {
        // 迁移写入走可信层：万一这一步没落库，抽屉的健康条与「保存失败」提示仍会说实话，
        // 而不是像旧口径那样让排版继续躺在会被清掉的 webview 存储里。
        _apply(migrated);
      }
      clearLegacyBookTypographyOverrides();
    } catch (error) {
      console.error('[BookTypographyStore] 从设置库加载书级排版失败:', error);
      set({ initialized: true });
    }
  },

  patchBookTypography: (bookId, patch) => {
    if (!bookId) return;
    const normalized = normalizeBookOverride(patch);
    if (Object.keys(normalized).length === 0) return;
    const current = get().overrides[bookId] ?? {};
    const merged = { ...current, ...normalized };
    const overrides = { ...get().overrides, [bookId]: merged };
    set({ overrides });
    _apply(overrides);
  },

  clearBookTypography: (bookId) => {
    if (!bookId || !(bookId in get().overrides)) return;
    const overrides = { ...get().overrides };
    delete overrides[bookId];
    set({ overrides });
    _apply(overrides);
  },

  clearBookTypographyFields: (bookId, fields) => {
    if (!bookId || fields.length === 0) return;
    const current = get().overrides[bookId];
    if (!current) return;
    const next = { ...current };
    for (const field of fields) delete next[field];
    const overrides = { ...get().overrides };
    // 收回最后一项 → 连这条记录一起删掉：留一个 {} 会让「几本书单独调过」虚高一本
    if (Object.keys(next).length === 0) delete overrides[bookId];
    else overrides[bookId] = next;
    set({ overrides });
    _apply(overrides);
  },

  clearAllBookTypography: () => {
    if (Object.keys(get().overrides).length === 0) return;
    set({ overrides: {} });
    _apply({});
  },

  hydrate: (payload) => {
    const overrides = parseOverrides(payload);
    if (JSON.stringify(overrides) === JSON.stringify(get().overrides)) return;
    set({ overrides });
    // 回声只推渲染层读数：不再落库、不再广播（发起方已经做过一次）
    setBookTypographyOverrides(overrides);
  },

  reset: () => {
    set({ overrides: {}, initialized: false });
    setBookTypographyOverrides({});
  },
}));

/**
 * 读回竞态防护（第三十四轮）。`fields: null` = 按「两侧键集并集」逐键比：
 * 这张表的键就是 bookId，是运行时数据，写死清单等于要求用户每新建一本书就改一次代码。
 */
const bookTypographyReadback = attachSettingsReadbackGuard(useBookTypographyStore, {
  scope: 'typographyBooks',
  select: (s) => s.overrides,
  fields: null,
});
