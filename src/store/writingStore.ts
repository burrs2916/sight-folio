import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
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
import { useEditorStore } from './editorStore';
import { logger } from '../utils/logger';
import { buildTree, defaultLevels, findNodeInForest } from '../utils/writingTree';
import { WINDOW_DAYS } from '../utils/writingStats';

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
  renameChapter: (chapterId: string, title: string) => Promise<void>;
  deleteChapter: (chapterId: string) => Promise<void>;
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

  /** 时间线事件（D）：全书级实体，独立于设定卡 extra.timeline */
  loadTimelineEvents: () => Promise<void>;
  createTimelineEvent: (opts: {
    settingId?: string | null;
    at?: string;
    event?: string;
    chapterId?: string | null;
    storylineId?: string | null;
  }) => Promise<WritingTimelineEvent | null>;
  updateTimelineEvent: (
    eventId: string,
    patch: Partial<
      Pick<WritingTimelineEvent, 'at' | 'event' | 'chapterId' | 'settingId' | 'sortOrder' | 'storylineId'>
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
  /** 体裁/载体编辑（P1 创作体系）：先落库再改态。 */
  setBookMeta: (bookId: string, patch: { genre?: string; medium?: string }) => Promise<void>;
  /** 日更目标（P6）：字数/天，0 = 未设。 */
  setDailyGoal: (bookId: string, dailyGoal: number) => Promise<void>;
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
    settings: [],
    settingsLoading: false,
    activeSettingId: null,
    outlines: [],
    timelineEvents: [],
    storylines: [],
    foreshadowings: [],
    dailyStats: [],
    collapsedNodeIds: [],

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
        const chapters = await writingApi.listChapters(bookId);
        set((s) => {
          // 只在仍是当前激活书时写入，防止快速切书竞态覆盖
          if (s.activeBookId === bookId) s.chapters = chapters;
        });
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
      const target = newParentId ?? null;
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
      const nextOrder = chapters.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
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
      await writingApi.deleteChapter(chapterId);
      set((s) => {
        for (const ch of lifted) {
          const r = s.chapters.find((x) => x.id === ch.id);
          if (r) {
            r.parentId = ch.parentId;
            r.updatedAt = ch.updatedAt;
          }
        }
        s.chapters = s.chapters.filter((c) => c.id !== chapterId);
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
      });
      // P3 业务→画布回流：设定改名刷到画布卡（comp.name + config.name）
      useEditorStore.getState().syncWritingEntityCards('settingId', settingId, {
        name: updated.name,
        configPatch: { name: updated.name },
      });
    },

    deleteSetting: async (settingId: string) => {
      await writingSettingsApi.delete(settingId);
      set((s) => {
        s.settings = s.settings.filter((x) => x.id !== settingId);
        if (s.activeSettingId === settingId) s.activeSettingId = null;
        // 删除传播矩阵（P0 一致性，与后端 delete_setting 同语义）：
        // 删设定不删事件——时间线事件保留，仅就地解绑回「书级事件」。
        for (const ev of s.timelineEvents) {
          if (ev.settingId === settingId) ev.settingId = null;
        }
      });
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
    },

    deleteOutline: async (outlineId: string) => {
      await writingOutlinesApi.delete(outlineId);
      set((s) => {
        s.outlines = s.outlines.filter((o) => o.id !== outlineId);
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
