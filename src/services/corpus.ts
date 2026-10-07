import { invoke } from './core';

// ─── 语料库（Sight Folio「语料库」）：外部参考书籍导入 + FTS5 全文检索 ───

/** 语料书（对应 Rust domain/corpus CorpusBook） */
export interface CorpusBook {
  id: number;
  title: string;
  author: string;
  language: string;
  source: string;
  /** 分类标签（导入后可编辑；检索时与书名/作者一并匹配）。空串 = 未分类。
   *  P0-3 起标签真源为后端 corpus_book_tags 表（多值），本字段为「顿号连接」镜像（兼容展示/检索）。
   *  旧数据（仅有单值 category）读路径已把 category 归并进 tags，前端展示一律用 tags。 */
  category: string;
  /** 多值标签（P0-3）：一书可打多标签；空数组 = 未打标签 */
  tags: string[];
  /** 导入时的源文件路径（重建索引据此重读原文件；旧数据为空串） */
  sourcePath: string;
  wordCount: number;
  chunkCount: number;
  createdAt: number;
}

/** 语料库检索结果：书命中（书名/作者/分类匹配，置顶展示）+ 句子命中 */
export interface CorpusSearchResult {
  books: CorpusBook[];
  hits: CorpusSearchHit[];
}

/** 语料库可用性（对应 Rust CorpusStatus）：corpus.db 初始化失败时降级为不可用 */
export interface CorpusStatus {
  available: boolean;
  /** 不可用原因（可用时为空串） */
  error: string;
}

/** 检索命中的一条「出现位置」（重复句合并后展开用） */
export interface CorpusHitOccurrence {
  chunkId: number;
  bookId: number;
  bookTitle: string;
  seq: number;
  chapterTitle: string;
}

/** 检索命中（句子级 KWIC：句子原文 + 书/章归属）。
 *  重复句在**检索时**合并（非破坏，库里不删行）：同句只出一条代表 +
 *  occurrenceCount / occurrences；按书过滤时统计范围限该书（不做跨书合并）。 */
export interface CorpusSearchHit {
  chunkId: number;
  bookId: number;
  bookTitle: string;
  seq: number;
  kind: string;
  chapterTitle: string;
  content: string;
  /** 该句在本次检索范围内的出现次数（未合并场景为 1） */
  occurrenceCount: number;
  /** 该句的出现位置（上限 20；occurrenceCount === 1 时为空） */
  occurrences: CorpusHitOccurrence[];
}

/** 重建索引的单本结果（对应 Rust RebuildItem） */
export interface RebuildItem {
  bookId: number;
  title: string;
  /** rebuilt | unchanged（内容未变跳过）| skipped（无源）| failed */
  status: string;
  /** 跳过/失败原因（rebuilt/unchanged 时为空） */
  reason: string;
  /** 重建后的句子总数（仅 rebuilt 有值） */
  chunkCount: number;
}

/** 重建索引汇总（对应 Rust RebuildReport） */
export interface RebuildReport {
  rebuilt: number;
  /** 内容未变、跳过整体替换的书数（增量重建） */
  unchanged: number;
  skipped: number;
  failed: number;
  items: RebuildItem[];
}

/** 导入前查重的命中项（对应 Rust DuplicateHit）；只提示不阻断 */
export interface DuplicateHit {
  /** exact_path（同一文件）| exact_content（去空白全文一致）| similar（高度相似）| same_meta（同名同作者） */
  kind: string;
  bookId: number;
  title: string;
  /** 相似度百分比（exact_* 为 100，same_meta 为 0） */
  similarity: number;
  createdAt: number;
}

/** 查重报告中的书本引用 */
export interface DuplicateBookRef {
  id: number;
  title: string;
  author: string;
  chunkCount: number;
  createdAt: number;
}

/** 一组重复的书 */
export interface DuplicateBookGroup {
  /** content_hash（内容完全相同）| source_path（同一文件）| simhash（高度相似） */
  reason: string;
  similarity: number;
  books: DuplicateBookRef[];
}

/** 一组跨书重复的句子 */
export interface SentenceDupGroup {
  sample: string;
  bookCount: number;
  chunkCount: number;
  books: string[];
}

/** 全库查重报告（对应 Rust DuplicateReport） */
export interface DuplicateReport {
  exactGroups: DuplicateBookGroup[];
  similarGroups: DuplicateBookGroup[];
  sentenceGroups: SentenceDupGroup[];
  /** 重复语句组总数（≥ sentenceGroups.length） */
  sentenceGroupTotal: number;
  bookTotal: number;
}

/** 维护操作互斥状态（对应 Rust CorpusMaintenanceStatus，P1-4 并发互斥）：
 *  导入/重建/删除/压缩四类维护操作互斥占用，busy=true 时返回占用操作与时长，
 *  供页面挂载对账恢复丢失的前端 busy 态。空闲时其余字段为 null。 */
export interface CorpusMaintenanceStatus {
  busy: boolean;
  /** 占用维护入口的操作名（import / rebuild / delete / optimize，空闲为 null） */
  op: string | null;
  /** 占用开始时间（unix 秒，空闲为 null） */
  started_at: number | null;
  /** 已运行秒数（空闲为 null） */
  elapsed_secs: number | null;
}

/** 存储空间回收报告（对应 Rust CorpusStorageReport，P0 迁移）：
 *  旧库升级前没有 FTS 触发器，删除后倒排残留不回收（实测 50MB 级）；
 *  维护命令 optimize_corpus_storage 做 FTS5 rebuild + VACUUM，
 *  返回前后体积与 FTS 行数供界面展示。 */
export interface CorpusStorageReport {
  /** 回收前数据库逻辑体积（字节） */
  sizeBefore: number;
  /** 回收后数据库逻辑体积（字节） */
  sizeAfter: number;
  /** 回收的字节数（sizeBefore - sizeAfter） */
  reclaimedBytes: number;
  /** 回收前 FTS5 倒排残留行数（corpus_fts_data） */
  ftsRowsBefore: number;
  /** 回收后 FTS5 倒排行数 */
  ftsRowsAfter: number;
}

/** 语料库 API：检索 ≥3 字符走 FTS5 MATCH（BM25 排序），<3 字符自动 LIKE 回退（后端分流） */
export const corpusApi = {
  /** 可用性探针：不可用时前端显示横幅并禁用导入/重建/检索入口 */
  status: (): Promise<CorpusStatus> => invoke('corpus_status'),
  listBooks: (): Promise<CorpusBook[]> => invoke('list_corpus_books'),
  /** 导入作品：category 为单选分类（可空 = 未分类），tags 为统一枚举多选标签（0~N 项） */
  importFile: (
    filePath: string,
    title: string,
    author: string,
    language: string,
    category: string,
    tags: string[],
  ): Promise<CorpusBook> => invoke('import_corpus_file', { filePath, title, author, language, category, tags }),
  deleteBook: (bookId: number): Promise<void> => invoke('delete_corpus_book', { bookId }),
  /** 编辑元数据：书名/作者/语言/分类 + 标签（专用 UPDATE；后端白名单校验后合并顿号串双写入库） */
  updateBook: (
    bookId: number,
    title: string,
    author: string,
    language: string,
    category: string,
    tags: string[],
  ): Promise<CorpusBook> => invoke('update_corpus_book', { bookId, title, author, language, category, tags }),
  /** 标签体系（P0-3）：以多标签集合幂等替换某书的标签（后端 trim 去空去重） */
  setBookTags: (bookId: number, tags: string[]): Promise<CorpusBook> =>
    invoke('set_corpus_book_tags', { bookId, tags }),
  /** 标签体系（P0-3）：按标签精确筛选书 */
  searchBooksByTag: (tag: string): Promise<CorpusBook[]> => invoke('search_corpus_books_by_tag', { tag }),
  /** 标签维护（P2-2）：全库重命名标签 from → to（归并去重 + 同步 category 镜像），返回受影响书数 */
  renameTag: (from: string, to: string): Promise<number> => invoke('rename_corpus_tag', { from, to }),
  /** 标签维护（P2-2）：多个源标签归并到目标标签（去重收敛），返回受影响书数 */
  mergeTags: (sources: string[], into: string): Promise<number> => invoke('merge_corpus_tags', { sources, into }),
  /** 标签维护（P2-2）：解除所有书该标签并同步镜像；标签不存在幂等返回 0 */
  deleteTag: (tag: string): Promise<number> => invoke('delete_corpus_tag', { tag }),
  /** 标签维护（P2-2）：全库标签书目计数列表（计数降序），供标签栏超限折叠展示 */
  listTagCounts: (): Promise<Array<[string, number]>> => invoke('list_corpus_tag_counts'),
  search: (query: string, bookId: number | null, limit = 30, offset = 0): Promise<CorpusSearchResult> =>
    invoke('search_corpus', { query, bookId, limit, offset }),
  /** 重建索引：重读源文件并重新切分（bookId 省略则重建全部作品） */
  rebuild: (bookId: number | null = null): Promise<RebuildReport> => invoke('rebuild_corpus_index', { bookId }),
  /** 导入前查重：提示已存在的相同/近似作品（不阻断导入） */
  checkDuplicate: (filePath: string, title: string, author: string): Promise<DuplicateHit[]> =>
    invoke('check_corpus_duplicate', { filePath, title, author }),
  /** 全库查重报告（维护用，只读） */
  scanDuplicates: (): Promise<DuplicateReport> => invoke('scan_corpus_duplicates'),
  /** 空间回收（P0 迁移）：FTS5 rebuild + VACUUM，回收删除残留的倒排与文件空洞。
   *  幂等可重复执行；返回前后体积与 FTS 行数供界面展示。 */
  optimizeStorage: (): Promise<CorpusStorageReport> => invoke('optimize_corpus_storage'),
  /** 维护互斥状态查询（P1-4）：busy=true 时返回占用操作与已运行时长。
   *  页面挂载/重挂载时对账用，恢复组件卸载期间丢掉的 busy 态，避免重复入口撞后端锁。 */
  maintenanceStatus: (): Promise<CorpusMaintenanceStatus> => invoke('corpus_maintenance_status'),
};
