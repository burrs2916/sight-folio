import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { emit } from '@tauri-apps/api/event';
import {
  writingApi,
  writingOutlinesApi,
  writingSettingsApi,
  writingStorylinesApi,
  writingForeshadowingsApi,
  writingTimelineApi,
  writingStatsApi,
  type WritingBook,
  type WritingChapter,
  type WritingDailyStat,
  type WritingForeshadowing,
  type WritingOutline,
  type WritingSetting,
  type WritingSettingKind,
  type WritingStoryline,
  type WritingTimelineEvent,
} from '../services/tauri';
import { isChapterDeleted, chapterDeletedAt, withChapterDeletedAt } from '../services/tauri';
import { parseSettingExtra, serializeBookGoal, type WritingBookGoal } from '../services/writing';
import { parseBeatExtra } from '../utils/writingOutline';
import { useEditorStore } from './editorStore';
import { logger } from '../utils/logger';
import { buildTree, defaultLevels, findNodeInForest } from '../utils/writingTree';
import { WINDOW_DAYS } from '../utils/writingStats';

/**
 * 跨窗口正文同步事件：写作台（独立 webview/store）落库成功后广播，
 * 主窗口正文页借此把该章 content/wordCount 就地并入自己的 store 实例，
 * 不需要（也不应该）整表 reload 就能读到写作台刚写入的正文。
 */
export const WRITING_CONTENT_SAVED_EVENT = 'writing-content-saved';

export interface WritingContentSavedPayload {
  bookId: string;
  chapterId: string;
  content: string;
  wordCount: number;
}

/**
 * 写作域 store（Sight Folio）
 *
 * 结构：books（书架）+ chaptersByBook（按书缓存的章节列表）。
 * 书是常驻数据；章节列表在选中书时按需加载并缓存，删书时随缓存一并清除。
 * 所有写操作先落库成功再更新本地态，失败只打日志并抛给调用方（UI 弹 toast）。
 *
 * P1 扩展：settings（当前书的创作设定，人设卡/世界观共用列表，按 kind 区分）。
 */
interface WritingState {
  books: WritingBook[];
  booksLoading: boolean;
  activeBookId: string | null;
  activeChapterId: string | null;
  /** 当前激活书的章节列表（P0 单书缓存即可；P1 多书切换时按 bookId 缓存） */
  chapters: WritingChapter[];
  chaptersLoading: boolean;
  /** 当前激活书的创作设定（character + worldbuilding 混存，UI 按 kind 分组） */
  settings: WritingSetting[];
  settingsLoading: boolean;
  activeSettingId: string | null;
  /** 当前激活书的大纲（P5，按 sort_order 排列；创建顺序即展示顺序） */
  outlines: WritingOutline[];
  /** 当前激活书的时间线事件（D，全书级实体；按 setting_id 分组铺轨，null = 全书级事件） */
  timelineEvents: WritingTimelineEvent[];
  /** 当前激活书的剧情线（多线叙事实体；事件通过 storylineId 挂线） */
  storylines: WritingStoryline[];
  /** 当前激活书的伏笔（「埋设 → 回收」承诺；status 三态 pending/paidoff/abandoned） */
  foreshadowings: WritingForeshadowing[];
  /**
   * 当前激活书的日更快照（Rust 落库：当日全书总字数）。总览仪表盘与 AI 全书语料
   * 共用这一份（单一来源），由 setActiveBook 加载，避免各自重复 fetch。
   */
  dailyStats: WritingDailyStat[];
  /**
   * 回收站（软删）：当前激活书的已删章节（随时间倒序；extra.deletedAt = 删除时间）。
   * 章树/章列表/大纲关联/排序等消费方一律只看 chapters，这里只服务回收站面板。
   */
  deletedChapters: WritingChapter[];

  loadBooks: () => Promise<void>;
  createBook: (title: string, genre?: string, medium?: string) => Promise<WritingBook>;
  renameBook: (bookId: string, title: string) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  setActiveBook: (bookId: string | null) => Promise<void>;

  loadChapters: (bookId: string) => Promise<void>;
  createChapter: (title: string) => Promise<WritingChapter | null>;
  /** 结构树：在 parentId 下建一个子节点（kind 由调用方按默认层级给）。 */
  createChildNode: (parentId: string, kind: string, title: string) => Promise<WritingChapter | null>;
  /** 结构树：把 nodeId 重新挂到 newParentId 下（newParentId=null 提回根）。防环：不能挂进自己的子树。 */
  reparentNode: (nodeId: string, newParentId: string | null) => Promise<void>;
  /** 结构树：行内改层级名（部/卷/章/节/幕/场…，创作者自填）。 */
  renameNodeKind: (nodeId: string, kind: string) => Promise<void>;
  /** 结构树：循环节点状态（待写→草稿→已完→待写），给概览进度账。 */
  setChapterStatus: (nodeId: string, status: string) => Promise<void>;
  /** G1 章→线直连：章节挂线/解绑（storyline-only 落库，不整行覆写；null = 去线）。 */
  setChapterStoryline: (chapterId: string, storylineId: string | null) => Promise<void>;
  renameChapter: (chapterId: string, title: string) => Promise<void>;
  /** 软删（2026-09-29）：写 extra.deletedAt 落库，章移入回收站（deletedChapters）；只有回收站的「永久删除」才真删。 */
  deleteChapter: (chapterId: string) => Promise<void>;
  /** 回收站：把软删章恢复到活跃列表——父级存活则回原挂载点与 sortOrder 位置，否则提为根（防「恢复却不可见」）。 */
  restoreChapter: (chapterId: string) => Promise<void>;
  /** 回收站：永久删除（后端 delete_writing_chapter，级联解绑），同时从回收站清单移除。不可恢复。 */
  permanentlyDeleteChapter: (chapterId: string) => Promise<void>;
  setActiveChapter: (chapterId: string | null) => void;
  /**
   * 拖拽排序：把 chapterId 移动到 toIndex（0 起）。重排后统一重编 sort_order，
   * 只把**实际发生变化的章**写回落库（INSERT OR REPLACE 全行写）。
   * UI 侧应在拖拽开始前 flush 未保存的正文，避免旧内容覆盖新输入。
   */
  reorderChapter: (chapterId: string, toIndex: number) => Promise<void>;
  /**
   * 保存章节正文（防抖自动保存的落点）。
   * 就地更新 chapters 里的 content/wordCount/updatedAt，不切换选中。
   */
  saveChapterContent: (chapterId: string, content: string, wordCount: number) => Promise<void>;

  /**
   * 跨窗口正文同步（读侧接收端）：写作台落库后广播 content-saved 事件，
   * 主窗口/其它窗口就地合并该章的 content/wordCount/updatedAt，避免整表 reload。
   * 幂等：仅当该章已在「当前激活书」的 chapters 缓存中才更新；未加载则忽略，
   * 等下次 loadChapters 自然拿到全量最新值。
   */
  applyExternalChapterContent: (payload: WritingContentSavedPayload) => void;

  loadSettings: () => Promise<void>;
  createSetting: (kind: WritingSettingKind, name: string) => Promise<WritingSetting | null>;
  updateSetting: (
    settingId: string,
    patch: Partial<Pick<WritingSetting, 'name' | 'subtitle' | 'description' | 'extra'>>,
  ) => Promise<void>;
  deleteSetting: (settingId: string) => Promise<void>;
  setActiveSetting: (settingId: string | null) => void;

  loadOutlines: () => Promise<void>;
  createOutline: (title: string) => Promise<WritingOutline | null>;
  updateOutline: (
    outlineId: string,
    patch: Partial<Pick<WritingOutline, 'title' | 'summary' | 'chapterId' | 'extra'>>,
  ) => Promise<void>;
  deleteOutline: (outlineId: string) => Promise<void>;
  /**
   * 节拍封面（extra.coverImage，零迁移）：assetRef 传 null 即清除。
   * 宽容解析坏 extra（绝不会因脏数据抛错），与 setChapterCover 同一处理范式。
   */
  setOutlineCover: (outlineId: string, assetRef: string | null) => Promise<void>;
  /**
   * 大纲排序：把 outlineId 移动到 toIndex（0 起）。重排后统一重编 sort_order（1..n），
   * 只把**实际发生变化的大纲**写回落库（与 reorderChapter 同一模式）。
   */
  reorderOutline: (outlineId: string, toIndex: number) => Promise<void>;

  /** 时间线事件（D）：全书级实体，独立于设定卡 extra.timeline */
  loadTimelineEvents: () => Promise<void>;
  createTimelineEvent: (opts: {
    chapterId?: string | null;
    settingId?: string | null;
    storylineId?: string | null;
    outlineId?: string | null;
    at?: string;
    event?: string;
  }) => Promise<WritingTimelineEvent | null>;
  updateTimelineEvent: (
    eventId: string,
    patch: Partial<
      Pick<
        WritingTimelineEvent,
        'at' | 'event' | 'chapterId' | 'settingId' | 'sortOrder' | 'storylineId' | 'timeKey'
      >
    >,
  ) => Promise<void>;
  deleteTimelineEvent: (eventId: string) => Promise<void>;

  /** 剧情线（多线叙事实体）：删线不删事件（前端就地置 NULL，与后端语义一致） */
  loadStorylines: () => Promise<void>;
  /** name 由 UI 层传入（默认名走 i18n；store 不依赖 i18n） */
  createStoryline: (name: string) => Promise<WritingStoryline | null>;
  updateStoryline: (
    storylineId: string,
    patch: Partial<Pick<WritingStoryline, 'name' | 'color' | 'description' | 'sortOrder'>>,
  ) => Promise<void>;
  deleteStoryline: (storylineId: string) => Promise<void>;

  loadForeshadowings: () => Promise<void>;
  createForeshadowing: (title: string) => Promise<WritingForeshadowing | null>;
  updateForeshadowing: (
    foreshadowingId: string,
    patch: Partial<
      Pick<
        WritingForeshadowing,
        'title' | 'description' | 'plantChapterId' | 'payoffChapterId' | 'status' | 'storylineId' | 'sortOrder'
      >
    >,
  ) => Promise<void>;
  deleteForeshadowing: (foreshadowingId: string) => Promise<void>;

  /** 卷分组（P6）：'' = 未分卷。纯展示分组，不改 sort_order。 */
  setChapterVolume: (chapterId: string, volume: string) => Promise<void>;
  /**
   * 章头图（批次 2）：把素材相对引用写入该章 extra.coverImage。
   * assetRef 为 null = 移除章头图（删 key，不是写空串）。
   * 只改 extra 一字段，其余（content/title/结构）原样保留——与 saveChapterContent 互斥不互相覆盖。
   */
  setChapterCover: (chapterId: string, assetRef: string | null) => Promise<void>;
  /** 结构树折叠：收起/展开节点的子级。纯内存浏览态（不落库，重启回全展开）；
      放 store 而非组件态，是为了载体卡与 L2 题材编辑面共用同一份折叠状态。 */
  collapsedNodeIds: string[];
  toggleNodeCollapse: (nodeId: string) => void;
  /**
   * 倒排索引（T9）：人物 → 出场章节（characterId → chapterId[]）。
   * 由 load/loadSettings/loadOutlines 批量重建，由 updateOutline/updateSetting 增量维护。
   * 前端按需取用，不持久化（内存派生态）。
   */
  characterChapterIndex: Map<string, Set<string>>;
  /**
   * 倒排索引（T9）：章节 → 出场人物（chapterId → characterId[]）。
   * 与 characterChapterIndex 互为逆映射，同维护策略。
   */
  chapterCharacterIndex: Map<string, Set<string>>;
  /**
   * 倒排索引（T9）：设定 → 被哪些设定引用（settingId → settingId[]）。
   * 由 extra.relations.targetId 反向推导，随 loadSettings/updateSetting 重建/维护。
   */
  settingInboundIndex: Map<string, Set<string>>;
  /** 重建所有倒排索引（批量刷新后调用） */
  _rebuildIndices: () => void;
  /** 体裁/载体编辑（P1 创作体系）：先落库再改态。 */
  setBookMeta: (bookId: string, patch: { genre?: string; medium?: string }) => Promise<void>;
  /** 日更目标（P6）：字数/天，0 = 未设。 */
  setDailyGoal: (bookId: string, dailyGoal: number) => Promise<void>;
  /** 全书写作目标（T2）：合并进 book.extra JSON 透传（保留未知字段）。 */
  setBookGoal: (bookId: string, goal: WritingBookGoal) => Promise<void>;
  /** 日更快照（P6）：Rust 落库的「当日全书总字数」，差分出每日新增。总览/AI 语料共用。 */
  loadDailyStats: (bookId: string) => Promise<void>;
}

export const useWritingStore = create<WritingState>()(
  immer((set, get) => ({
    books: [],
    booksLoading: false,
    activeBookId: null,
    activeChapterId: null,
    chapters: [],
    chaptersLoading: false,
    deletedChapters: [],
    settings: [],
    settingsLoading: false,
    activeSettingId: null,
    outlines: [],
    timelineEvents: [],
    storylines: [],
    foreshadowings: [],
    dailyStats: [],
    collapsedNodeIds: [],
    characterChapterIndex: new Map(),
    chapterCharacterIndex: new Map(),
    settingInboundIndex: new Map(),

    _rebuildIndices: () =>
      set((s) => {
        s.characterChapterIndex = new Map();
        s.chapterCharacterIndex = new Map();
        s.settingInboundIndex = new Map();
        const idsOf = (v: unknown): string[] =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
        for (const o of s.outlines) {
          if (!o.chapterId) continue;
          const extra = parseBeatExtra(o.extra);
          // cast → character → characterChapterIndex + chapterCharacterIndex
          for (const cid of idsOf(extra.cast)) {
            const cs = s.characterChapterIndex.get(cid);
            if (cs) cs.add(o.chapterId);
            else s.characterChapterIndex.set(cid, new Set([o.chapterId]));
            const cc = s.chapterCharacterIndex.get(o.chapterId);
            if (cc) cc.add(cid);
            else s.chapterCharacterIndex.set(o.chapterId, new Set([cid]));
          }
          // scenes → worldbuilding → chapterCharacterIndex (同结构，key 区分在 settingId)
          for (const sid of idsOf(extra.scenes)) {
            const cs = s.characterChapterIndex.get(sid);
            if (cs) cs.add(o.chapterId);
            else s.characterChapterIndex.set(sid, new Set([o.chapterId]));
            const cc = s.chapterCharacterIndex.get(o.chapterId);
            if (cc) cc.add(sid);
            else s.chapterCharacterIndex.set(o.chapterId, new Set([sid]));
          }
        }
        for (const st of s.settings) {
          const extra = parseSettingExtra(st.extra);
          for (const r of extra.relations ?? []) {
            if (!r.targetId) continue;
            const ins = s.settingInboundIndex.get(r.targetId);
            if (ins) ins.add(st.id);
            else s.settingInboundIndex.set(r.targetId, new Set([st.id]));
          }
        }
      }),

    toggleNodeCollapse: (nodeId) =>
      set((s) => {
        const i = s.collapsedNodeIds.indexOf(nodeId);
        if (i >= 0) s.collapsedNodeIds.splice(i, 1);
        else s.collapsedNodeIds.push(nodeId);
      }),

    loadBooks: async () => {
      set((s) => {
        s.booksLoading = true;
      });
      try {
        const books = await writingApi.listBooks();
        set((s) => {
          s.books = books;
        });
      } catch (e) {
        logger.warn('writingStore', 'loadBooks failed', { error: e });
        throw e;
      } finally {
        set((s) => {
          s.booksLoading = false;
        });
      }
    },

    createBook: async (title: string, genre = '', medium = '') => {
      const now = Math.floor(Date.now() / 1000);
      const book: WritingBook = {
        id: `book_${crypto.randomUUID().replace(/-/g, '')}`,
        title,
        description: null,
        genre,
        medium,
        status: 'draft',
        coverColor: '#4A338F',
        dailyGoal: 0,
        extra: '{}',
        createdAt: now,
        updatedAt: now,
      };
      await writingApi.saveBook(book);
      set((s) => {
        s.books.unshift(book);
      });
      return book;
    },

    /** 体裁/载体编辑（P1 创作体系）：先落库再改态。 */
    setBookMeta: async (bookId: string, patch: { genre?: string; medium?: string }) => {
      const book = get().books.find((b) => b.id === bookId);
      if (!book) return;
      const updated: WritingBook = {
        ...book,
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingApi.saveBook(updated);
      set((s) => {
        const row = s.books.find((b) => b.id === bookId);
        if (row) {
          row.genre = updated.genre;
          row.medium = updated.medium;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    renameBook: async (bookId: string, title: string) => {
      const book = get().books.find((b) => b.id === bookId);
      if (!book) return;
      const updated: WritingBook = { ...book, title, updatedAt: Math.floor(Date.now() / 1000) };
      await writingApi.saveBook(updated);
      set((s) => {
        const row = s.books.find((b) => b.id === bookId);
        if (row) {
          row.title = title;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    deleteBook: async (bookId: string) => {
      await writingApi.deleteBook(bookId);
      set((s) => {
        s.books = s.books.filter((b) => b.id !== bookId);
        if (s.activeBookId === bookId) {
          // 删除传播矩阵（P0 一致性）：删书清掉当前书的内存态全部子域，
          // 与后端级联删库同语义——不清理会让残留数据在 UI 上继续可见。
          s.activeBookId = null;
          s.activeChapterId = null;
          s.chapters = [];
          s.deletedChapters = [];
          s.settings = [];
          s.activeSettingId = null;
          s.outlines = [];
          s.timelineEvents = [];
          s.storylines = [];
          s.foreshadowings = [];
        }
      });
    },

    setActiveBook: async (bookId: string | null) => {
      set((s) => {
        s.activeBookId = bookId;
        s.activeChapterId = null;
        s.chapters = [];
        s.deletedChapters = [];
        s.settings = [];
        s.activeSettingId = null;
        s.outlines = [];
        s.timelineEvents = [];
        s.storylines = [];
        s.foreshadowings = [];
        s.dailyStats = [];
      });
      if (bookId) {
        await Promise.all([
          get().loadChapters(bookId),
          get().loadSettings(),
          get().loadOutlines(),
          get().loadTimelineEvents(),
          get().loadStorylines(),
          get().loadForeshadowings(),
          get().loadDailyStats(bookId),
        ]);
      }
    },

    loadChapters: async (bookId: string) => {
      set((s) => {
        s.chaptersLoading = true;
      });
      try {
        const all = await writingApi.listChapters(bookId);
        set((s) => {
          // 只在仍是当前激活书时写入，防止快速切书竞态覆盖
          if (s.activeBookId !== bookId) return;
          // 软删拆分（2026-09-29）：chapters 只含活跃章，deletedChapters 收软删章——
          // 消费方（树/列表/大纲关联/排序）零改动即自动过滤回收站条目。
          s.chapters = [];
          s.deletedChapters = [];
          for (const c of all) {
            // 统一 parentId：旧模型可能残留 ''，和 buildTree 的 normParent('')='' 混用会导致
            // reparentNode 的 siblings 过滤口径不一致，进而 sortOrder 冲突、同级排序错乱。
            const cleaned: WritingChapter = c.parentId === '' ? { ...c, parentId: null } : c;
            if (isChapterDeleted(cleaned)) s.deletedChapters.push({ ...cleaned, deletedAt: chapterDeletedAt(cleaned) });
            else s.chapters.push(cleaned);
          }
          // 与 deleteChapter 的 unshift 语义一致：新删的排前面
          s.deletedChapters.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
        });
        get()._rebuildIndices();
      } catch (e) {
        logger.warn('writingStore', 'loadChapters failed', { error: e });
        throw e;
      } finally {
        set((s) => {
          s.chaptersLoading = false;
        });
      }
    },

    createChapter: async (title: string) => {
      const { activeBookId, chapters, books } = get();
      if (!activeBookId) return null;
      const now = Math.floor(Date.now() / 1000);
      const nextOrder = chapters.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
      // 顶层节点：kind 取该体裁的默认根层级（novel→卷，essay/poetry/script→篇）。
      // 这是「零配置起步」：作者点一下就得到合理命名的顶层，随后可任意改名/越级。
      const genre = books.find((b) => b.id === activeBookId)?.genre ?? '';
      const rootKind = defaultLevels(genre)[0] ?? '章';
      const chapter: WritingChapter = {
        id: `chap_${crypto.randomUUID().replace(/-/g, '')}`,
        bookId: activeBookId,
        title,
        content: '',
        sortOrder: nextOrder,
        wordCount: 0,
        status: 'draft',
        volume: '',
        parentId: null,
        kind: rootKind,
        extra: '{}',
        createdAt: now,
        updatedAt: now,
      };
      await writingApi.saveChapter(chapter);
      set((s) => {
        s.chapters.push(chapter);
      });
      return chapter;
    },

    createChildNode: async (parentId: string, kind: string, title: string) => {
      const { activeBookId, chapters } = get();
      if (!activeBookId) return null;
      const now = Math.floor(Date.now() / 1000);
      // 全局最大 sort_order + 1：子节点按 sort_order 在同父兄弟里排最后，避免位置错乱。
      const nextOrder = chapters.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
      const chapter: WritingChapter = {
        id: `chap_${crypto.randomUUID().replace(/-/g, '')}`,
        bookId: activeBookId,
        title,
        content: '',
        sortOrder: nextOrder,
        wordCount: 0,
        status: 'draft',
        volume: '',
        parentId,
        kind,
        extra: '{}',
        createdAt: now,
        updatedAt: now,
      };
      await writingApi.saveChapter(chapter);
      set((s) => {
        s.chapters.push(chapter);
      });
      return chapter;
    },

    reparentNode: async (nodeId: string, newParentId: string | null) => {
      const { chapters } = get();
      const node = chapters.find((c) => c.id === nodeId);
      if (!node) return;
      // 统一 parentId 口径：空字符串视为 null，与 buildTree 的 normParent 一致
      const target = newParentId && newParentId.length > 0 ? newParentId : null;
      if ((node.parentId ?? null) === target) return; // 无变化
      // 防环：目标不能是自己或自己的后代
      if (target) {
        const forest = buildTree(chapters);
        const sub = findNodeInForest(forest, nodeId);
        const tgt = findNodeInForest(forest, target);
        if (!tgt) return;
        const desc = new Set<string>();
        const walk = (n: (typeof forest)[number]) => {
          desc.add(n.node.id);
          n.children.forEach(walk);
        };
        if (sub) walk(sub);
        if (desc.has(target)) return; // 会成环，拒绝
      }
      const now = Math.floor(Date.now() / 1000);
      // 取同父节点下子节点的最大 sortOrder，+1 后挂在末尾——避免跨父级 sortOrder 冲突导致顺序错乱
      // 兼容旧数据 parentId='' 与 null 混用：和 buildTree 的 normParent 口径一致
      const siblings = chapters.filter((c) => {
        const cp = c.parentId ?? null;
        return cp === target || (cp === '' && target === null) || (cp === null && target === '');
      });
      const nextOrder = siblings.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
      const updated: WritingChapter = { ...node, parentId: target, sortOrder: nextOrder, updatedAt: now };
      await writingApi.saveChapter(updated);
      set((s) => {
        const row = s.chapters.find((c) => c.id === nodeId);
        if (row) {
          row.parentId = target;
          row.sortOrder = nextOrder;
          row.updatedAt = now;
        }
      });
    },

    renameNodeKind: async (nodeId: string, kind: string) => {
      const node = get().chapters.find((c) => c.id === nodeId);
      if (!node) return;
      const updated: WritingChapter = { ...node, kind, updatedAt: Math.floor(Date.now() / 1000) };
      await writingApi.saveChapter(updated);
      set((s) => {
        const row = s.chapters.find((c) => c.id === nodeId);
        if (row) {
          row.kind = kind;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    setChapterStatus: async (nodeId: string, status: string) => {
      const node = get().chapters.find((c) => c.id === nodeId);
      if (!node) return;
      const updated: WritingChapter = { ...node, status, updatedAt: Math.floor(Date.now() / 1000) };
      await writingApi.saveChapter(updated);
      set((s) => {
        const row = s.chapters.find((c) => c.id === nodeId);
        if (row) {
          row.status = status;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    setChapterStoryline: async (chapterId: string, storylineId: string | null) => {
      const chapter = get().chapters.find((c) => c.id === chapterId);
      if (!chapter) return;
      if ((chapter.storylineId ?? null) === storylineId) return;
      // storyline-only 落库：绝不整行覆写（与 renameChapter 同防回滚原则）。
      await writingApi.setChapterStoryline(chapterId, storylineId);
      const now = Math.floor(Date.now() / 1000);
      set((s) => {
        const row = s.chapters.find((c) => c.id === chapterId);
        if (row) {
          row.storylineId = storylineId;
          row.updatedAt = now;
        }
      });
    },

    renameChapter: async (chapterId: string, title: string) => {
      const chapter = get().chapters.find((c) => c.id === chapterId);
      if (!chapter) return;
      if (chapter.title === title) return;
      // title-only 落库：绝不把内存里的整章对象（含 content）INSERT OR REPLACE 回去——
      // 自动保存与改名并发时，旧 content 会覆盖新输入（「一键出多字」的库侧根因）。
      await writingApi.renameChapter(chapterId, title);
      const now = Math.floor(Date.now() / 1000);
      set((s) => {
        const row = s.chapters.find((c) => c.id === chapterId);
        if (row) {
          row.title = title;
          row.updatedAt = now;
        }
      });
      // P3 业务→画布回流：章节改名刷到画布卡（comp.name + config.title）
      useEditorStore.getState().syncWritingEntityCards('chapterId', chapterId, {
        name: title,
        configPatch: { title },
      });
    },

    deleteChapter: async (chapterId: string) => {
      const { chapters, outlines } = get();
      const node = chapters.find((c) => c.id === chapterId);
      if (!node) return;
      const now = Math.floor(Date.now() / 1000);
      // 结构树：删除一个节点时，把它的直接子节点「上提」到被删节点的父级（或根），
      // 绝不级联删除——避免误删整棵子树造成内容丢失，也避免留下孤儿 parent_id。
      const forest = buildTree(chapters);
      const tn = findNodeInForest(forest, chapterId);
      const children = tn ? tn.children.map((c) => c.node) : [];
      const liftedParent = node.parentId ?? null;
      const lifted = children.map((ch) => ({ ...ch, parentId: liftedParent, updatedAt: now }));
      await Promise.all(lifted.map((ch) => writingApi.saveChapter(ch)));
      // 双向联动的另一面：解绑挂在该章上的大纲条目（先落库再改态）
      const bound = outlines.filter((o) => o.chapterId === chapterId);
      await Promise.all(bound.map((o) => writingOutlinesApi.save({ ...o, chapterId: null, updatedAt: now })));
      // 软删（2026-09-29）：不真删——把 deletedAt 写进 extra JSON 落库（零迁移，
      // 内容/子级上提等全部保留），章从活跃列表移入回收站；真删只发生在回收站「永久删除」。
      await writingApi.saveChapter(withChapterDeletedAt({ ...node, updatedAt: now }, now));
      set((s) => {
        for (const ch of lifted) {
          const r = s.chapters.find((x) => x.id === ch.id);
          if (r) {
            r.parentId = ch.parentId;
            r.updatedAt = ch.updatedAt;
          }
        }
        const removed = s.chapters.find((c) => c.id === chapterId);
        s.chapters = s.chapters.filter((c) => c.id !== chapterId);
        if (removed) s.deletedChapters.unshift({ ...removed, deletedAt: now, updatedAt: now });
        if (s.activeChapterId === chapterId) s.activeChapterId = null;
        for (const o of s.outlines) {
          if (o.chapterId === chapterId) o.chapterId = null;
        }
        // 删除传播矩阵（P0 一致性，与后端 delete_chapter 同语义）：
        // 删章不删内容——时间线事件/伏笔保留，仅就地解绑指向本章的引用。
        for (const ev of s.timelineEvents) {
          if (ev.chapterId === chapterId) ev.chapterId = null;
        }
        for (const f of s.foreshadowings) {
          if (f.plantChapterId === chapterId) f.plantChapterId = null;
          if (f.payoffChapterId === chapterId) f.payoffChapterId = null;
        }
      });
    },

    restoreChapter: async (chapterId: string) => {
      const { chapters, deletedChapters } = get();
      const node = deletedChapters.find((c) => c.id === chapterId);
      if (!node) return;
      const now = Math.floor(Date.now() / 1000);
      // 父级仍在活跃树里则保持原挂载；父级已不存在（也被软删/真删）就提为根——
      // buildTree 对孤儿节点会直接丢弃，不提根会出现「恢复却看不见」的陷阱。
      const parentAlive = node.parentId != null && chapters.some((c) => c.id === node.parentId);
      const restored = withChapterDeletedAt(
        { ...node, parentId: parentAlive ? node.parentId : null, updatedAt: now },
        0,
      );
      // 按原 sortOrder 归位：与活跃章混排后取「第一个 sortOrder 更大」的位置插入
      // （同序按 createdAt 稳定兜底），再从 1 起统一重编整书 sort_order——
      // 只落库次序真的变了的行（与 reorderChapter 同一模式）。
      const arr = [...chapters, restored].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
      );
      const renumbered = arr.map((c, i) => ({ ...c, sortOrder: i + 1 }));
      const changed = renumbered.filter(
        (c, i) => c.id === chapterId || arr[i].id !== c.id || arr[i].sortOrder !== c.sortOrder,
      );
      try {
        await Promise.all(changed.map((c) => writingApi.saveChapter(c)));
      } catch (e) {
        logger.warn('writingStore', 'restoreChapter persist failed', { error: e });
        throw e;
      }
      set((s) => {
        s.deletedChapters = s.deletedChapters.filter((c) => c.id !== chapterId);
        const changedIds = new Set(changed.map((c) => c.id));
        s.chapters = renumbered.map((c) => {
          if (c.id === chapterId) return { ...c, deletedAt: 0 };
          return changedIds.has(c.id) ? { ...c, updatedAt: now } : c;
        });
      });
    },

    permanentlyDeleteChapter: async (chapterId: string) => {
      const node = get().deletedChapters.find((c) => c.id === chapterId);
      if (!node) return;
      // 真删：后端 delete_writing_chapter（事务内删行 + 级联解绑引用）
      await writingApi.deleteChapter(chapterId);
      set((s) => {
        s.deletedChapters = s.deletedChapters.filter((c) => c.id !== chapterId);
      });
    },

    setActiveChapter: (chapterId: string | null) => {
      set((s) => {
        s.activeChapterId = chapterId;
      });
    },

    reorderChapter: async (chapterId: string, toIndex: number) => {
      const { chapters } = get();
      const from = chapters.findIndex((c) => c.id === chapterId);
      if (from < 0) return;
      const target = Math.max(0, Math.min(toIndex, chapters.length - 1));
      if (target === from) return;
      // 本地重排 + 统一重编 sort_order（1..n）
      const arr = [...chapters];
      const [moved] = arr.splice(from, 1);
      arr.splice(target, 0, moved);
      const now = Math.floor(Date.now() / 1000);
      const reordered = arr.map((c, i) => ({ ...c, sortOrder: i + 1 }));
      // 只落库顺序真的变了的那几行（按位置比对 id；位置变了 sort_order 必变），
      // 减少无谓写库
      const changed = reordered.filter((c, i) => c.id !== chapters[i].id);
      try {
        await Promise.all(changed.map((c) => writingApi.saveChapter({ ...c, updatedAt: now })));
      } catch (e) {
        logger.warn('writingStore', 'reorderChapter persist failed', { error: e });
        throw e;
      }
      set((s) => {
        s.chapters = reordered.map((c) => (changed.some((x) => x.id === c.id) ? { ...c, updatedAt: now } : c));
      });
    },

    saveChapterContent: async (chapterId: string, content: string, wordCount: number) => {
      const chapter = get().chapters.find((c) => c.id === chapterId);
      if (!chapter) return;
      // content-only 落库：绝不把内存里的整章对象 INSERT OR REPLACE 回去——
      // title/kind/status 等字段由各自专用命令维护，这里只碰正文三件（防并发回滚）。
      await writingApi.saveChapterContent(chapterId, content, wordCount);
      const now = Math.floor(Date.now() / 1000);
      set((s) => {
        const row = s.chapters.find((c) => c.id === chapterId);
        if (row) {
          row.content = content;
          row.wordCount = wordCount;
          row.updatedAt = now;
        }
      });
      // P3 业务→画布回流：字数落库后刷到所有视图里绑定该章的画布卡
      useEditorStore.getState().syncWritingEntityCards('chapterId', chapterId, {
        configPatch: { wordCount },
      });
      // 跨窗口正文同步：写作台是独立 webview/store 实例，落库成功后广播事件，
      // 主窗口正文页借此把 content 就地并入自己的 store（见 applyExternalChapterContent）。
      void emit(WRITING_CONTENT_SAVED_EVENT, {
        bookId: chapter.bookId,
        chapterId,
        content,
        wordCount,
      } satisfies WritingContentSavedPayload).catch((e) => {
        logger.warn('writingStore', 'emit content-saved failed', { error: e });
      });
    },

    applyExternalChapterContent: (payload) => {
      const { bookId, chapterId, content, wordCount } = payload;
      // 只更新「当前激活书」的章节行：未加载该书的窗口跳过（下次 loadChapters 全量兜底）
      if (get().activeBookId !== bookId) return;
      const now = Math.floor(Date.now() / 1000);
      set((s) => {
        const row = s.chapters.find((c) => c.id === chapterId);
        if (row) {
          row.content = content;
          row.wordCount = wordCount;
          row.updatedAt = now;
        }
      });
    },

    loadSettings: async () => {
      const bookId = get().activeBookId;
      if (!bookId) return;
      set((s) => {
        s.settingsLoading = true;
      });
      try {
        // kind 两类并行拉取，合并后按 kind + sort_order 排序（UI 分组渲染）
        const [characters, worldbuilding] = await Promise.all([
          writingSettingsApi.list(bookId, 'character'),
          writingSettingsApi.list(bookId, 'worldbuilding'),
        ]);
        set((s) => {
          if (s.activeBookId === bookId) {
            s.settings = [...characters, ...worldbuilding];
          }
        });
        get()._rebuildIndices();
      } catch (e) {
        logger.warn('writingStore', 'loadSettings failed', { error: e });
        throw e;
      } finally {
        set((s) => {
          s.settingsLoading = false;
        });
      }
    },

    createSetting: async (kind: WritingSettingKind, name: string) => {
      const { activeBookId, settings } = get();
      if (!activeBookId) return null;
      const now = Math.floor(Date.now() / 1000);
      const nextOrder = settings.filter((x) => x.kind === kind).reduce((max, x) => Math.max(max, x.sortOrder), 0) + 1;
      const setting: WritingSetting = {
        id: `set_${crypto.randomUUID().replace(/-/g, '')}`,
        bookId: activeBookId,
        kind,
        name,
        subtitle: '',
        description: '',
        extra: '{}',
        sortOrder: nextOrder,
        createdAt: now,
        updatedAt: now,
      };
      await writingSettingsApi.save(setting);
      set((s) => {
        s.settings.push(setting);
      });
      return setting;
    },

    updateSetting: async (
      settingId: string,
      patch: Partial<Pick<WritingSetting, 'name' | 'subtitle' | 'description' | 'extra'>>,
    ) => {
      const setting = get().settings.find((x) => x.id === settingId);
      if (!setting) return;
      const oldExtra = setting.extra;
      const updated: WritingSetting = {
        ...setting,
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingSettingsApi.save(updated);
      set((s) => {
        const row = s.settings.find((x) => x.id === settingId);
        if (row) {
          row.name = updated.name;
          row.subtitle = updated.subtitle;
          row.description = updated.description;
          row.extra = updated.extra;
          row.updatedAt = updated.updatedAt;
        }
        // T9：增量维护 settingInboundIndex（old → new 的 relations 差异）
        const oldR = parseSettingExtra(oldExtra).relations ?? [];
        const newR = parseSettingExtra(updated.extra).relations ?? [];
        const oldTargets = new Set(oldR.map((r) => r.targetId).filter(Boolean) as string[]);
        const newTargets = new Set(newR.map((r) => r.targetId).filter(Boolean) as string[]);
        for (const tid of oldTargets) {
          if (newTargets.has(tid)) continue;
          const ins = s.settingInboundIndex.get(tid);
          if (ins) {
            ins.delete(settingId);
            if (ins.size === 0) s.settingInboundIndex.delete(tid);
          }
        }
        for (const tid of newTargets) {
          if (oldTargets.has(tid)) continue;
          const ins = s.settingInboundIndex.get(tid);
          if (ins) ins.add(settingId);
          else s.settingInboundIndex.set(tid, new Set([settingId]));
        }
      });
      // P3 业务→画布回流：设定改名刷到画布卡（comp.name + config.name）
      useEditorStore.getState().syncWritingEntityCards('settingId', settingId, {
        name: updated.name,
        configPatch: { name: updated.name },
      });
    },

    deleteSetting: async (settingId: string) => {
      await writingSettingsApi.delete(settingId);
      // A1：逆向引用清理（P0 一致性，与后端 delete_setting 同语义）——
      // 删设定后，同书其余设定 extra.relations 里指向被删 id 的关系行一并移除。
      // 只有成功落库的行才同步进内存；个别失败仅告警，不阻断主删除（reload 后按库复原）。
      const affected = get().settings.filter((s) => {
        if (s.id === settingId) return false;
        return (parseSettingExtra(s.extra).relations ?? []).some((r) => r.targetId === settingId);
      });
      const synced: WritingSetting[] = [];
      for (const row of affected) {
        const extra = parseSettingExtra(row.extra);
        const rels = (extra.relations ?? []).filter((r) => r.targetId !== settingId);
        const next: WritingSetting = {
          ...row,
          extra: JSON.stringify({ ...extra, relations: rels.length > 0 ? rels : undefined }),
          updatedAt: Math.floor(Date.now() / 1000),
        };
        try {
          await writingSettingsApi.save(next);
          synced.push(next);
        } catch (e) {
          logger.warn('writingStore', 'deleteSetting cleanup relations failed', {
            settingId,
            refId: row.id,
            error: e,
          });
        }
      }
      set((s) => {
        s.settings = s.settings.filter((x) => x.id !== settingId);
        if (s.activeSettingId === settingId) s.activeSettingId = null;
        // 删除传播矩阵（P0 一致性，与后端 delete_setting 同语义）：
        // 删设定不删事件——时间线事件保留，仅就地解绑回「书级事件」。
        for (const ev of s.timelineEvents) {
          if (ev.settingId === settingId) ev.settingId = null;
        }
        // A1：被清理的逆向引用行同步进内存（与落库同 extra）。
        for (const row of synced) {
          const mem = s.settings.find((x) => x.id === row.id);
          if (mem) {
            mem.extra = row.extra;
            mem.updatedAt = row.updatedAt;
          }
        }
      });
      get()._rebuildIndices();
    },

    setActiveSetting: (settingId: string | null) => {
      set((s) => {
        s.activeSettingId = settingId;
      });
    },

    // ─── 大纲（P5） ───

    loadOutlines: async () => {
      const bookId = get().activeBookId;
      if (!bookId) return;
      try {
        const outlines = await writingOutlinesApi.list(bookId);
        set((s) => {
          if (s.activeBookId === bookId) s.outlines = outlines;
        });
        get()._rebuildIndices();
      } catch (e) {
        logger.warn('writingStore', 'loadOutlines failed', { error: e });
        throw e;
      }
    },

    createOutline: async (title: string) => {
      const { activeBookId, outlines } = get();
      if (!activeBookId) return null;
      const now = Math.floor(Date.now() / 1000);
      const outline: WritingOutline = {
        id: `out_${crypto.randomUUID().replace(/-/g, '')}`,
        bookId: activeBookId,
        title,
        summary: '',
        chapterId: null,
        extra: '{}',
        sortOrder: outlines.reduce((max, o) => Math.max(max, o.sortOrder), 0) + 1,
        createdAt: now,
        updatedAt: now,
      };
      await writingOutlinesApi.save(outline);
      set((s) => {
        s.outlines.push(outline);
      });
      return outline;
    },

    updateOutline: async (
      outlineId: string,
      patch: Partial<Pick<WritingOutline, 'title' | 'summary' | 'chapterId' | 'extra'>>,
    ) => {
      const outline = get().outlines.find((o) => o.id === outlineId);
      if (!outline) return;
      const updated: WritingOutline = {
        ...outline,
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingOutlinesApi.save(updated);
      set((s) => {
        const row = s.outlines.find((o) => o.id === outlineId);
        if (row) {
          row.title = updated.title;
          row.summary = updated.summary;
          row.chapterId = updated.chapterId;
          row.extra = updated.extra;
          row.updatedAt = updated.updatedAt;
        }
      });
      // 骨架关联同步（写作台→时间线）：outline.summary 变更时，自动同步到关联的 timelineEvent.event
      if (patch.summary !== undefined && patch.summary !== outline.summary) {
        const linkedEvent = get().timelineEvents.find((ev) => ev.outlineId === outlineId);
        if (linkedEvent) {
          void get().updateTimelineEvent(linkedEvent.id, { event: patch.summary });
        }
      }
      get()._rebuildIndices();
    },

    deleteOutline: async (outlineId: string) => {
      await writingOutlinesApi.delete(outlineId);
      set((s) => {
        s.outlines = s.outlines.filter((o) => o.id !== outlineId);
      });
      get()._rebuildIndices();
    },

    setOutlineCover: async (outlineId: string, assetRef: string | null) => {
      const outline = get().outlines.find((o) => o.id === outlineId);
      if (!outline) return;
      // 安全解析 extra：坏数据/空串一律当空对象，绝不因脏数据抛错（与 setChapterCover 同口径）
      let extraObj: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(outline.extra || '{}');
        if (parsed && typeof parsed === 'object') extraObj = parsed as Record<string, unknown>;
      } catch {
        extraObj = {};
      }
      if (assetRef) extraObj.coverImage = assetRef;
      else delete extraObj.coverImage;
      const nextExtra = JSON.stringify(extraObj);
      const updated: WritingOutline = {
        ...outline,
        extra: nextExtra,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingOutlinesApi.save(updated);
      set((s) => {
        const row = s.outlines.find((o) => o.id === outlineId);
        if (row) {
          row.extra = nextExtra;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    reorderOutline: async (outlineId: string, toIndex: number) => {
      const { outlines } = get();
      const from = outlines.findIndex((o) => o.id === outlineId);
      if (from < 0) return;
      const target = Math.max(0, Math.min(toIndex, outlines.length - 1));
      if (target === from) return;
      // 本地重排 + 统一重编 sort_order（1..n）
      const arr = [...outlines];
      const [moved] = arr.splice(from, 1);
      arr.splice(target, 0, moved);
      const now = Math.floor(Date.now() / 1000);
      const reordered = arr.map((o, i) => ({ ...o, sortOrder: i + 1 }));
      // 只落库顺序真的变了的那几行（按位置比对 id；位置变了 sort_order 必变）
      const changed = reordered.filter((o, i) => o.id !== outlines[i].id);
      try {
        await Promise.all(changed.map((o) => writingOutlinesApi.save({ ...o, updatedAt: now })));
      } catch (e) {
        logger.warn('writingStore', 'reorderOutline persist failed', { error: e });
        throw e;
      }
      set((s) => {
        s.outlines = reordered.map((o) => (changed.some((x) => x.id === o.id) ? { ...o, updatedAt: now } : o));
      });
    },

    // ─── 时间线事件（D） ───

    loadTimelineEvents: async () => {
      const bookId = get().activeBookId;
      if (!bookId) return;
      try {
        const events = await writingTimelineApi.list(bookId);
        set((s) => {
          if (s.activeBookId === bookId) s.timelineEvents = events;
        });
      } catch (e) {
        logger.warn('writingStore', 'loadTimelineEvents failed', { error: e });
        throw e;
      }
    },

    createTimelineEvent: async (opts) => {
      const { activeBookId, timelineEvents } = get();
      if (!activeBookId) return null;
      const now = Math.floor(Date.now() / 1000);
      const event: WritingTimelineEvent = {
        id: `ev_${crypto.randomUUID().replace(/-/g, '')}`,
        bookId: activeBookId,
        settingId: opts.settingId ?? null,
        at: opts.at ?? '',
        event: opts.event ?? '',
        chapterId: opts.chapterId ?? null,
        storylineId: opts.storylineId ?? null,
        outlineId: opts.outlineId ?? null,
        timeKey: null,
        sortOrder: timelineEvents.reduce((max, ev) => Math.max(max, ev.sortOrder), 0) + 1,
        createdAt: now,
        updatedAt: now,
      };
      await writingTimelineApi.save(event);
      set((s) => {
        s.timelineEvents.push(event);
      });
      return event;
    },

    updateTimelineEvent: async (eventId, patch) => {
      const event = get().timelineEvents.find((ev) => ev.id === eventId);
      if (!event) return;
      const updated: WritingTimelineEvent = {
        ...event,
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingTimelineApi.save(updated);
      set((s) => {
        const row = s.timelineEvents.find((ev) => ev.id === eventId);
        if (row) {
          row.at = updated.at;
          row.event = updated.event;
          row.chapterId = updated.chapterId;
          row.settingId = updated.settingId;
          row.storylineId = updated.storylineId;
          row.outlineId = updated.outlineId;
          row.sortOrder = updated.sortOrder;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    deleteTimelineEvent: async (eventId) => {
      await writingTimelineApi.delete(eventId);
      set((s) => {
        s.timelineEvents = s.timelineEvents.filter((ev) => ev.id !== eventId);
      });
    },

    loadStorylines: async () => {
      const bookId = get().activeBookId;
      if (!bookId) return;
      try {
        const storylines = await writingStorylinesApi.list(bookId);
        set((s) => {
          if (s.activeBookId === bookId) s.storylines = storylines;
        });
      } catch (e) {
        logger.warn('writingStore', 'loadStorylines failed', { error: e });
        throw e;
      }
    },

    createStoryline: async (name) => {
      const { activeBookId, storylines } = get();
      if (!activeBookId) return null;
      const now = Math.floor(Date.now() / 1000);
      const storyline: WritingStoryline = {
        id: `sl_${crypto.randomUUID().replace(/-/g, '')}`,
        bookId: activeBookId,
        name,
        color: '',
        description: '',
        sortOrder: storylines.reduce((max, sl) => Math.max(max, sl.sortOrder), 0) + 1,
        createdAt: now,
        updatedAt: now,
      };
      await writingStorylinesApi.save(storyline);
      set((s) => {
        s.storylines.push(storyline);
      });
      return storyline;
    },

    updateStoryline: async (storylineId, patch) => {
      const storyline = get().storylines.find((sl) => sl.id === storylineId);
      if (!storyline) return;
      const updated: WritingStoryline = {
        ...storyline,
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingStorylinesApi.save(updated);
      set((s) => {
        const row = s.storylines.find((sl) => sl.id === storylineId);
        if (row) {
          row.name = updated.name;
          row.color = updated.color;
          row.description = updated.description;
          row.sortOrder = updated.sortOrder;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    deleteStoryline: async (storylineId) => {
      await writingStorylinesApi.delete(storylineId);
      set((s) => {
        s.storylines = s.storylines.filter((sl) => sl.id !== storylineId);
        // 删线不删事件（与后端 delete_storyline 同语义）：挂线事件就地回到「未挂线」
        for (const ev of s.timelineEvents) {
          if (ev.storylineId === storylineId) ev.storylineId = null;
        }
        // 删线不删伏笔（后端同语义）：挂线伏笔就地回到「未挂线」
        for (const fs of s.foreshadowings) {
          if (fs.storylineId === storylineId) fs.storylineId = null;
        }
      });
    },

    // ─── 伏笔（「埋设 → 回收」承诺） ───

    loadForeshadowings: async () => {
      const { activeBookId } = get();
      if (!activeBookId) return;
      try {
        const items = await writingForeshadowingsApi.list(activeBookId);
        set((s) => {
          s.foreshadowings = items;
        });
      } catch (e) {
        logger.warn('writingStore', 'loadForeshadowings failed', { error: e });
        throw e;
      }
    },

    createForeshadowing: async (title) => {
      const { activeBookId, foreshadowings } = get();
      if (!activeBookId) return null;
      const now = Math.floor(Date.now() / 1000);
      const item: WritingForeshadowing = {
        id: `fs_${crypto.randomUUID().replace(/-/g, '')}`,
        bookId: activeBookId,
        title,
        description: '',
        plantChapterId: null,
        payoffChapterId: null,
        status: 'pending',
        storylineId: null,
        sortOrder: foreshadowings.reduce((max, f) => Math.max(max, f.sortOrder), 0) + 1,
        createdAt: now,
        updatedAt: now,
      };
      await writingForeshadowingsApi.save(item);
      set((s) => {
        s.foreshadowings.push(item);
      });
      return item;
    },

    updateForeshadowing: async (foreshadowingId, patch) => {
      const item = get().foreshadowings.find((f) => f.id === foreshadowingId);
      if (!item) return;
      const updated: WritingForeshadowing = {
        ...item,
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingForeshadowingsApi.save(updated);
      set((s) => {
        const row = s.foreshadowings.find((f) => f.id === foreshadowingId);
        if (row) {
          row.title = updated.title;
          row.description = updated.description;
          row.plantChapterId = updated.plantChapterId;
          row.payoffChapterId = updated.payoffChapterId;
          row.status = updated.status;
          row.storylineId = updated.storylineId;
          row.sortOrder = updated.sortOrder;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    deleteForeshadowing: async (foreshadowingId) => {
      await writingForeshadowingsApi.delete(foreshadowingId);
      set((s) => {
        s.foreshadowings = s.foreshadowings.filter((f) => f.id !== foreshadowingId);
      });
    },

    // ─── 卷分组 / 写作目标（P6） ───

    setChapterVolume: async (chapterId: string, volume: string) => {
      const chapter = get().chapters.find((c) => c.id === chapterId);
      if (!chapter) return;
      const updated: WritingChapter = {
        ...chapter,
        volume,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingApi.saveChapter(updated);
      set((s) => {
        const row = s.chapters.find((c) => c.id === chapterId);
        if (row) {
          row.volume = volume;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    setChapterCover: async (chapterId: string, assetRef: string | null) => {
      const chapter = get().chapters.find((c) => c.id === chapterId);
      if (!chapter) return;
      // 安全解析 extra：坏数据/空串一律当空对象，绝不让人设卡因脏数据渲染崩（与 parseSettingExtra 同口径）
      let extraObj: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(chapter.extra || '{}');
        if (parsed && typeof parsed === 'object') extraObj = parsed as Record<string, unknown>;
      } catch {
        extraObj = {};
      }
      if (assetRef) extraObj.coverImage = assetRef;
      else delete extraObj.coverImage;
      const nextExtra = JSON.stringify(extraObj);
      const updated: WritingChapter = {
        ...chapter,
        extra: nextExtra,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingApi.saveChapter(updated);
      set((s) => {
        const row = s.chapters.find((c) => c.id === chapterId);
        if (row) {
          row.extra = nextExtra;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    setDailyGoal: async (bookId: string, dailyGoal: number) => {
      const book = get().books.find((b) => b.id === bookId);
      if (!book) return;
      const updated: WritingBook = { ...book, dailyGoal, updatedAt: Math.floor(Date.now() / 1000) };
      await writingApi.saveBook(updated);
      set((s) => {
        const row = s.books.find((b) => b.id === bookId);
        if (row) {
          row.dailyGoal = dailyGoal;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    setBookGoal: async (bookId: string, goal: WritingBookGoal) => {
      const book = get().books.find((b) => b.id === bookId);
      if (!book) return;
      const updated: WritingBook = {
        ...book,
        extra: serializeBookGoal(book.extra, goal),
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await writingApi.saveBook(updated);
      set((s) => {
        const row = s.books.find((b) => b.id === bookId);
        if (row) {
          row.extra = updated.extra;
          row.updatedAt = updated.updatedAt;
        }
      });
    },

    loadDailyStats: async (bookId: string) => {
      try {
        const rows = await writingStatsApi.listDailyStats(bookId, WINDOW_DAYS + 1);
        set((s) => {
          if (s.activeBookId === bookId) s.dailyStats = rows;
        });
      } catch (e) {
        logger.warn('writingStore', 'loadDailyStats failed', { bookId, error: e });
      }
    },
  })),
);
