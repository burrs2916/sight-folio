import { invoke } from './core';

// ─── 写作域（Sight Folio）：书籍与章节 ───

export interface WritingBook {
  id: string;
  title: string;
  description: string | null;
  genre: string;
  /** 载体：serial（连载）/ standalone（单本）/ collection（篇目集）。'' = 未指定（旧书兼容） */
  medium: string;
  status: string;
  coverColor: string;
  /** 日更目标（字数/天，0 = 未设）。P6 写作目标。 */
  dailyGoal: number;
  /** extra JSON 透传：全书目标（targetWords / targetChapters / deadline，见 WritingBookGoal）。 */
  extra: string;
  createdAt: number;
  updatedAt: number;
}

/** 全书写作目标（T2）：存 WritingBook.extra JSON，未设字段为 0/undefined。 */
export interface WritingBookGoal {
  /** 目标总字数（0 = 未设） */
  targetWords: number;
  /** 目标章节数（0 = 未设） */
  targetChapters: number;
  /** 截止日期（Unix 秒，0 = 未设） */
  deadline: number;
}

/** 解析 WritingBook.extra → 全书目标（容忍空串/坏 JSON，静默回退空目标）。 */
export function parseBookGoal(extra: string | null | undefined): WritingBookGoal {
  if (!extra) return { targetWords: 0, targetChapters: 0, deadline: 0 };
  try {
    const raw = JSON.parse(extra) as Partial<WritingBookGoal>;
    return {
      targetWords: typeof raw.targetWords === 'number' && raw.targetWords > 0 ? raw.targetWords : 0,
      targetChapters: typeof raw.targetChapters === 'number' && raw.targetChapters > 0 ? raw.targetChapters : 0,
      deadline: typeof raw.deadline === 'number' && raw.deadline > 0 ? raw.deadline : 0,
    };
  } catch {
    return { targetWords: 0, targetChapters: 0, deadline: 0 };
  }
}

/** 合并全书目标进 extra JSON（保留未知字段，加字段零迁移）。 */
export function serializeBookGoal(base: string | null | undefined, goal: WritingBookGoal): string {
  let prev: Record<string, unknown> = {};
  if (base) {
    try {
      const parsed = JSON.parse(base) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') prev = parsed;
    } catch {
      prev = {};
    }
  }
  return JSON.stringify({ ...prev, ...goal });
}

export interface WritingChapter {
  id: string;
  bookId: string;
  title: string;
  content: string;
  sortOrder: number;
  wordCount: number;
  status: string;
  /** 卷/分组名（'' = 未分卷）。旧模型遗留字段；新结构树由 parentId + kind 表达。 */
  volume: string;
  /** 结构树父节点 id（null = 根）。创作者自定义的任意层级都由它串成树。 */
  parentId?: string | null;
  /** 层级名（创作者自填：部/卷/章/节/幕/场/回/篇…，系统不预定义）。 */
  kind: string;
  /** 章节主剧情线 id（null/undefined = 未挂线）。与事件级挂线互补：章级是规划归属。 */
  storylineId?: string | null;
  /** 章头图等 P2 扩展（JSON 透传）。章头图引用存 `coverImage`：相对引用 `assets/writing/illustrations/<name>` */
  extra: string;
  /**
   * 回收站软删时间戳（Unix 秒；0/undefined = 未删除）。
   * 内存访问器：真正持久化落在 extra.deletedAt（零迁移，不改表），读写经 withChapterDeletedAt 同步。
   */
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export const writingApi = {
  async listBooks(): Promise<WritingBook[]> {
    return invoke<WritingBook[]>('list_writing_books');
  },

  async saveBook(book: WritingBook): Promise<void> {
    return invoke('save_writing_book', { book });
  },

  async deleteBook(bookId: string): Promise<void> {
    return invoke('delete_writing_book', { bookId });
  },

  async listChapters(bookId: string): Promise<WritingChapter[]> {
    return invoke<WritingChapter[]>('list_writing_chapters', { bookId });
  },

  async saveChapter(chapter: WritingChapter): Promise<void> {
    return invoke('save_writing_chapter', { chapter });
  },

  /** 改名 title-only：只更新 title 列，不整行覆写 content（防旧正文回滚）。 */
  async renameChapter(chapterId: string, title: string): Promise<void> {
    return invoke('rename_writing_chapter', { chapterId, title });
  },

  /** 正文保存 content-only：只更新 content/word_count（自动保存高频通道，防字段回滚）。 */
  async saveChapterContent(chapterId: string, content: string, wordCount: number): Promise<void> {
    return invoke('save_writing_chapter_content', { chapterId, content, wordCount });
  },

  /** 章节挂线/解绑 storyline-only：只更新 storyline_id（防整行覆写回滚，与 rename/saveContent 同原则）。 */
  async setChapterStoryline(chapterId: string, storylineId: string | null): Promise<void> {
    return invoke('set_writing_chapter_storyline', { chapterId, storylineId });
  },

  async deleteChapter(chapterId: string): Promise<void> {
    return invoke('delete_writing_chapter', { chapterId });
  },
};

// ─── 章节回收站（软删）：deletedAt 落 extra JSON，零迁移 ───
// 为什么放 extra 而不是加列：writing_chapters.extra 是后端预留的 JSON 透传字段
// （注释「加字段零迁移」）；save_chapter 走 INSERT OR REPLACE 且显式含 extra 列、
// serde 对未知顶层字段宽容——写 extra.deletedAt 不改表、不动 Rust，风险最低。

interface ChapterExtra {
  /** 回收站软删时间戳（Unix 秒；缺省 = 未删除） */
  deletedAt?: number;
  /** 章头图等既有扩展字段原样保留 */
  [key: string]: unknown;
}

/** 解析章 extra JSON；坏数据/空串一律当空对象，绝不因脏数据崩渲染（与 parseSettingExtra 同口径） */
export function parseChapterExtra(extra: string): ChapterExtra {
  try {
    const parsed = JSON.parse(extra || '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as ChapterExtra) : {};
  } catch {
    return {};
  }
}

/** 软删时间戳；未删返回 0。优先读内存访问字段（store 已填充），否则回退解析 extra。 */
export function chapterDeletedAt(ch: WritingChapter): number {
  const t = ch.deletedAt ?? parseChapterExtra(ch.extra).deletedAt;
  return typeof t === 'number' && t > 0 ? t : 0;
}

/** 章是否已软删（extra.deletedAt 为真数 > 0） */
export function isChapterDeleted(ch: WritingChapter): boolean {
  return chapterDeletedAt(ch) > 0;
}

/** 返回 deletedAt 已更新的新章对象：写回 extra.deletedAt 并同步访问字段（不原地改、不丢既有 extra 键）。 */
export function withChapterDeletedAt(ch: WritingChapter, deletedAt: number): WritingChapter {
  const extra = { ...parseChapterExtra(ch.extra), deletedAt };
  return { ...ch, extra: JSON.stringify(extra), deletedAt };
}

// ─── 章节版本快照（批次④）：切章自动存 + 手动存，每章保留最近 20 份 ───

export interface WritingChapterSnapshot {
  id: string;
  chapterId: string;
  bookId: string;
  content: string;
  wordCount: number;
  /** auto（切章自动存）/ manual（手动存） */
  origin: string;
  createdAt: number;
  /** 自定义名称（用户重命名），null/undefined 表示未命名 */
  name?: string | null;
}

export const writingSnapshotsApi = {
  async list(chapterId: string): Promise<WritingChapterSnapshot[]> {
    return invoke<WritingChapterSnapshot[]>('list_writing_chapter_snapshots', { chapterId });
  },

  async save(snapshot: WritingChapterSnapshot): Promise<void> {
    return invoke('save_writing_chapter_snapshot', { snapshot });
  },

  /** 重命名快照（优先后端 API；后端未实现时调用方自行回退到 localStorage） */
  async rename(snapshotId: string, name: string | null): Promise<void> {
    return invoke('rename_writing_chapter_snapshot', { snapshotId, name });
  },
};

// ─── 写作域 P1：创作设定库（人设卡 / 世界观）+ 导出写盘 ───

export type WritingSettingKind = 'character' | 'worldbuilding';

export interface WritingSetting {
  id: string;
  bookId: string;
  kind: WritingSettingKind;
  name: string;
  subtitle: string;
  description: string;
  extra: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export const writingSettingsApi = {
  async list(bookId: string, kind: WritingSettingKind): Promise<WritingSetting[]> {
    return invoke<WritingSetting[]>('list_writing_settings', { bookId, kind });
  },

  async save(setting: WritingSetting): Promise<void> {
    return invoke('save_writing_setting', { setting });
  },

  async delete(settingId: string): Promise<void> {
    return invoke('delete_writing_setting', { settingId });
  },
};

/** 把文本写到用户经对话框选定的路径（配合 plugin-dialog 的 save()）。 */
export async function saveTextFile(path: string, contents: string): Promise<void> {
  return invoke('save_text_file', { path, contents });
}

// ─── 写作域 P4：写作统计 + 设定卡结构化扩展 ───

export interface WritingDailyStat {
  day: string;
  wordCount: number;
}

export const writingStatsApi = {
  /** 最近 N 天的每日全书总字数快照（缺记录的日期由调用方补零）。 */
  async listDailyStats(bookId: string, days = 30): Promise<WritingDailyStat[]> {
    return invoke<WritingDailyStat[]>('list_writing_daily_stats', { bookId, days });
  },
};

/** 设定卡 extra JSON 的结构化字段（P1 预留的透传空间，从这里开始消费）。 */
export interface WritingRelation {
  /** 关联设定 id（连 id，新增；与自由文本 target 并存，target 作为展示名） */
  targetId?: string;
  /** 展示名（自由文本，兼容旧数据；连 id 时自动同步为被关联设定名） */
  target: string;
  type: string;
}

/**
 * 全书级时间线事件实体（D）：独立表 writing_timeline_events，独立于设定卡 extra.timeline。
 * setting_id 可空（null = 纯书级事件，不挂在某个设定上）；createdAt/updatedAt 为 Unix 秒。
 */
export interface WritingTimelineEvent {
  id: string;
  bookId: string;
  settingId: string | null;
  /** 时间点标签，自由文本（「第3年」「2024」「第12章」等），仅作展示与数字序排序 */
  at: string;
  /** 事件描述 */
  event: string;
  /** 绑定章节（可选，null = 未绑章）：双击优先跳该章 */
  chapterId: string | null;
  /** 所属剧情线（可选，null = 未挂线）：多线叙事维度，与 settingId/chapterId 正交 */
  storylineId: string | null;
  /** 关联大纲 beat（可选，null = 自由创建）：建立时间线事件与大纲节拍的骨架关联，用于双向同步 */
  outlineId: string | null;
  /** 轨道内排序（同 at 时的稳定序） */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 剧情线（多线叙事实体）：事件通过 storylineId 挂线；删线不删事件（后端置 NULL） */
export interface WritingStoryline {
  id: string;
  bookId: string;
  name: string;
  /** 轨道配色（hex），空串 = 前端按 id 哈希兜底 */
  color: string;
  description: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface WritingSettingProfile {
  /** 外貌 */
  appearance?: string;
  /** 性格 */
  personality?: string;
  /** 动机 */
  motivation?: string;
  /** 口头禅 */
  catchphrase?: string;
  /** 笔记 */
  notes?: string;
}

/** 世界观档案（结构化字段，零迁移，落 extra.worldbuildingProfile，与人物 profile 并列） */
export interface WritingWorldbuildingProfile {
  /** 类型 / 分类，如 地理 / 种族 / 魔法体系 / 社会制度 */
  type?: string;
  /** 核心规则 */
  rules?: string;
  /** 例外 / 破例 */
  exceptions?: string;
  /** 关联条目（人物 / 其他设定，自由文本） */
  linkedTo?: string;
  /** 笔记 */
  notes?: string;
}

/** 世界观子类型枚举（受控 Select 与左栏筛选共用，单一事实源；落 worldbuildingProfile.type，零迁移） */
export const WORLDBUILDING_TYPE_KEYS = ['location', 'faction', 'magic', 'history', 'item', 'culture', 'other'] as const;
export type WorldbuildingType = (typeof WORLDBUILDING_TYPE_KEYS)[number];

export interface WritingSettingExtra {
  relations?: WritingRelation[];
  /** 人设档案（结构化字段，零迁移，落 extra JSON） */
  profile?: WritingSettingProfile;
  /** 世界观档案（结构化字段，零迁移，落 extra JSON，与人物 profile 并列） */
  worldbuildingProfile?: WritingWorldbuildingProfile;
  [key: string]: unknown;
}

/** 解析 extra JSON；坏数据一律当空对象，绝不让人设卡因脏数据渲染崩 */
export function parseSettingExtra(extra: string): WritingSettingExtra {
  try {
    const parsed = JSON.parse(extra);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// ─── 写作域 P5：大纲（与章节可双向关联） ───

export interface WritingOutline {
  id: string;
  bookId: string;
  title: string;
  summary: string;
  /** 绑定章节 id；null = 该节拍尚未落章 */
  chapterId: string | null;
  /** JSON 透传（设计视图节拍挂载：{ cast: settingId[], scenes: settingId[] }）；旧数据缺省 "{}" */
  extra: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export const writingOutlinesApi = {
  async list(bookId: string): Promise<WritingOutline[]> {
    return invoke<WritingOutline[]>('list_writing_outlines', { bookId });
  },

  async save(outline: WritingOutline): Promise<void> {
    return invoke('save_writing_outline', { outline });
  },

  async delete(outlineId: string): Promise<void> {
    return invoke('delete_writing_outline', { outlineId });
  },
};

/** 时间线事件（D）：独立表 writing_timeline_events，settingId 可空（null = 全书级） */
export const writingTimelineApi = {
  async list(bookId: string): Promise<WritingTimelineEvent[]> {
    return invoke<WritingTimelineEvent[]>('list_writing_timeline_events', { bookId });
  },

  async save(event: WritingTimelineEvent): Promise<void> {
    return invoke('save_writing_timeline_event', { event });
  },

  async delete(eventId: string): Promise<void> {
    return invoke('delete_writing_timeline_event', { eventId });
  },
};

export const writingStorylinesApi = {
  async list(bookId: string): Promise<WritingStoryline[]> {
    return invoke<WritingStoryline[]>('list_writing_storylines', { bookId });
  },

  async save(storyline: WritingStoryline): Promise<void> {
    return invoke('save_writing_storyline', { storyline });
  },

  async delete(storylineId: string): Promise<void> {
    return invoke('delete_writing_storyline', { storylineId });
  },
};

/** 伏笔（「埋设 → 回收」承诺）：status 三态 pending/paidoff/abandoned；回收章可空。 */
export interface WritingForeshadowing {
  id: string;
  bookId: string;
  title: string;
  description: string;
  /** 埋设章 */
  plantChapterId: string | null;
  /** 计划回收章（可空 = 还没想好收在哪） */
  payoffChapterId: string | null;
  /** pending | paidoff | abandoned */
  status: string;
  /** 可选挂剧情线（删线置 NULL 零强制） */
  storylineId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export const writingForeshadowingsApi = {
  async list(bookId: string): Promise<WritingForeshadowing[]> {
    return invoke<WritingForeshadowing[]>('list_writing_foreshadowings', { bookId });
  },

  async save(item: WritingForeshadowing): Promise<void> {
    return invoke('save_writing_foreshadowing', { item });
  },

  async delete(foreshadowingId: string): Promise<void> {
    return invoke('delete_writing_foreshadowing', { foreshadowingId });
  },
};

// ─── 章内批注（批次② T4）：内容独立表持久化，正文只存引用 id ───

export interface WritingAnnotation {
  id: string;
  chapterId: string;
  bookId: string;
  /** 批注内容（便签正文），与正文字符流完全隔离。 */
  text: string;
  /** 被批注选区的文本快照（展示用，不用于定位——定位靠正文 data-annotation-id）。 */
  excerpt: string;
  createdAt: number;
  updatedAt: number;
}

export const writingAnnotationsApi = {
  async list(chapterId: string): Promise<WritingAnnotation[]> {
    return invoke<WritingAnnotation[]>('list_writing_annotations', { chapterId });
  },

  async save(item: WritingAnnotation): Promise<void> {
    return invoke('save_writing_annotation', { item });
  },

  async delete(annotationId: string): Promise<void> {
    return invoke('delete_writing_annotation', { annotationId });
  },
};

/** EPUB 导出载荷（章节顺序 = 传参顺序 = spine 顺序） */
export interface EpubChapterInput {
  title: string;
  content: string;
  /** 章头图相对引用（批次 2 存于章 extra.coverImage）；无则省略（创作者主权） */
  cover?: string | null;
}

export async function saveWritingEpub(
  title: string,
  description: string | null,
  chapters: EpubChapterInput[],
  path: string,
): Promise<void> {
  return invoke('save_writing_epub', { title, description, chapters, path });
}

// ─── DOCX / PDF 导出（T7）：后端原生离线生成 ───

export async function saveWritingDocx(
  title: string,
  description: string | null,
  chapters: EpubChapterInput[],
  path: string,
): Promise<void> {
  return invoke('save_writing_docx', { title, description, chapters, path });
}

export async function saveWritingPdf(
  title: string,
  description: string | null,
  chapters: EpubChapterInput[],
  path: string,
): Promise<void> {
  return invoke('save_writing_pdf', { title, description, chapters, path });
}

// ─── 全书备份与恢复（T7） ───

export async function backupWritingBook(path: string): Promise<void> {
  return invoke('backup_writing_book', { path });
}

export async function restoreWritingBook(path: string): Promise<void> {
  return invoke('restore_writing_book', { path });
}

// ─── 写作扫描（F1 分析器融合）：书 → analyses，章节 → project_files ───

export interface WritingScanSummary {
  analysisId: string;
  fileCount: number;
  totalWords: number;
  /** 写作发现条数（死设定 + 未落地节拍），已落 review_findings */
  findingCount: number;
}

export interface WritingImportSummary {
  bookId: string;
  title: string;
  chapterCount: number;
  totalWords: number;
  /** 章节切分策略：heading（按标题行）/ single（全书单章） */
  strategy: 'heading' | 'single';
}

export const writingScanApi = {
  scanBook: (bookId: string): Promise<WritingScanSummary> => invoke('scan_writing_book', { bookId }),
  /** 导入 txt/md 作品：按章节标题行切分入库（工作室「导入作品」入口） */
  importBook: (filePath: string): Promise<WritingImportSummary> => invoke('import_writing_book', { filePath }),
};

// ─── 完结作品记录（Phase 2）：写作台导出/备份成功后落库，页面统一管理 ───

/** 导出产物格式：epub | pdf | docx | html | md | txt | backup（与后端 CompletedWork.format 对齐） */
export type CompletedWorkFormat = 'epub' | 'pdf' | 'docx' | 'html' | 'md' | 'txt' | 'backup';

export interface CompletedWork {
  id: string;
  bookId: string;
  bookTitle: string;
  format: CompletedWorkFormat;
  filePath: string;
  fileSize: number;
  /** 源文件是否已丢失（用户移动/删除后列表加载时后端顺带检测回写）。 */
  isFileMissing?: boolean;
  wordCount: number;
  chapterCount: number;
  createdAt: number;
}

export const completedWorksApi = {
  async list(): Promise<CompletedWork[]> {
    return invoke<CompletedWork[]>('list_completed_works');
  },

  /** 保存一条完结作品记录；file_size 由后端 stat file_path 回填，前端不传也可。 */
  async save(work: CompletedWork): Promise<void> {
    return invoke('save_completed_work', { work });
  },

  /** 移除记录（只删记录，不动源文件）。 */
  async delete(id: string): Promise<void> {
    return invoke('delete_completed_work', { id });
  },

  /** 改名/改目录（重新定位）：后端物理移动源文件并更新记录 file_path。 */
  async move(id: string, newPath: string): Promise<void> {
    return invoke('move_completed_work', { id, newPath });
  },

  /** 导入磁盘上已存在的导出文件为记录（按 file_path 去重）。返回 [imported, skipped]。 */
  async importWorks(bookId: string, bookTitle: string, filePaths: string[]): Promise<[number, number]> {
    return invoke<[number, number]>('import_completed_works', {
      bookId,
      bookTitle,
      filePaths,
    });
  },

  /** 统计某书某格式的完结作品数量（format 空串 = 该书全部格式）。写作台「已有 n 个 PDF」数据源。 */
  async count(bookId: string, format: string): Promise<number> {
    return invoke<number>('query_completed_work_count', { bookId, format });
  },
};

// ─── 灵感/快速笔记（T4）：全局级、跨章、作者心流暂存 ───

export interface WritingNote {
  id: string;
  bookId: string;
  chapterId: string;
  content: string;
  /** JSON 数组串（["tag1","tag2"]），前端自行解析。 */
  tags: string;
  /** 置顶标记（0=普通，1=置顶）。 */
  pin: number;
  createdAt: number;
  updatedAt: number;
}

export const writingNotesApi = {
  async list(bookId: string): Promise<WritingNote[]> {
    return invoke<WritingNote[]>('list_writing_notes', { bookId });
  },

  async save(item: WritingNote): Promise<void> {
    return invoke('save_writing_note', { item });
  },

  async delete(noteId: string): Promise<void> {
    return invoke('delete_writing_note', { noteId });
  },
};

/** 生成笔记 id（语义前缀 note_ + uuid）。 */
export function newNoteId(): string {
  return `note_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** 生成完结作品记录 id（语义前缀 cw_ + uuid）。 */
export function newCompletedWorkId(): string {
  return `cw_${crypto.randomUUID().replace(/-/g, '')}`;
}
