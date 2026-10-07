use crate::domain::corpus::{
    fingerprint, CorpusBook, CorpusBookSource, CorpusChunk, CorpusHitOccurrence,
    CorpusSearchHit, CorpusStorageReport, SentenceDupGroup,
};use crate::error::{AppError, AppResult};
use crate::infrastructure::database::CorpusDatabase;
use rusqlite::params;

/// 语料库仓储（Sight Folio「语料库」）。
///
/// 铁律：row mapper 一律按列名读取（row.get("col")），禁用位置索引。
/// 检索双通道：查询 ≥3 字符走 FTS5 MATCH（trigram + BM25 排序），
/// <3 字符（中文双字词居多）走 LIKE 回退（trigram 表对 LIKE 亦有索引加速，2 字退化为顺序扫，本地量级可接受）。
pub trait CorpusRepository: Send + Sync {
    /// 导入一本书：事务内插 book + 全文镜像 + 全部 chunks（FTS 触发器自动建倒排）。返回书籍行。
    /// `source_path` 记录源文件路径，`raw_text` 归档**抽取后的全文**——重建索引优先用镜像，
    /// 源文件移动/删除不丢可重建性（镜像 → 外部文件 → skipped 三级回退）。
    /// `category` 与编辑路径同口径：单值或分隔串切分为多标签写入 `corpus_book_tags`，
    /// `category` 镜像列回写为顿号连接串（FTS 触发器随 INSERT 自动索引，导入即检索可命中）。
    #[allow(clippy::too_many_arguments)]
    fn import_book(
        &self,
        title: &str,
        author: &str,
        language: &str,
        category: &str,
        source: &str,
        source_path: &str,
        raw_text: &str,
        chunks: &[(String, String, String)], // (kind, content, chapter_title)
    ) -> AppResult<CorpusBook>;
    fn list_books(&self) -> AppResult<Vec<CorpusBook>>;
    /// 读取单本书（重建索引时据 source / source_path 重读原文件）。
    fn get_book(&self, id: i64) -> AppResult<CorpusBook>;
    /// 读取入库归档的全文镜像（旧数据无镜像返回 None → 命令层回退读外部源文件）。
    fn get_book_source(&self, id: i64) -> AppResult<Option<CorpusBookSource>>;
    /// 编辑元数据（书名/作者/语言/分类）。**专用 UPDATE 只碰这四列**——绝不整行覆写，
    /// 不碰指纹/统计/来源列（与 rename_writing_chapter 同款纪律）。
    /// P0-3 双写同步：`category` 切分（`, 、 ; /` 等分隔符）后写入标签表，
    /// 标签表是标注真源；本方法保留旧单值语义（旧前端传单个分类仍生效）。
    fn update_book_meta(
        &self,
        id: i64,
        title: &str,
        author: &str,
        language: &str,
        category: &str,
    ) -> AppResult<CorpusBook>;
    /// 书名/作者/分类检索：≥3 字符走 corpus_books_fts（trigram 子串命中，替代旧 `%q%` LIKE 全表扫），
    /// <3 字符（中文双字词居多）回退 LIKE（与句子分支同口径）；标签经 category 镜像与标签串双通道命中。
    /// `query` 传入**原始查询词**（不做通配符转义，转义与 FTS 短语包装在实现内完成）。
    fn search_books(&self, query: &str, limit: i64) -> AppResult<Vec<CorpusBook>>;
    /// 标签体系（P0-3）：保存某书的全部标签（幂等替换：先清后插，trim 去空去重）。
    /// 双写同步：category 列回写为顿号连接的标签串，保证旧检索 LIKE / 旧前端展示路径仍可命中。
    /// 返回更新后的书（含 tags 装配）。
    fn set_book_tags(&self, id: i64, tags: &[String]) -> AppResult<CorpusBook>;
    /// 按标签精确筛选书籍（书量级几十本，EXISTS 子查询 + 无需倒排）。
    fn search_books_by_tag(&self, tag: &str) -> AppResult<Vec<CorpusBook>>;
    /// 标签维护（P2-2）：把旧标签整体改名为新标签。事务内更新 `corpus_book_tags`
    /// 并同步受影响书的 category 镜像（顿号连接串）。`to` 已存在时自动归并（去重）。
    /// 返回受影响的书数量。
    fn rename_tag(&self, from: &str, to: &str) -> AppResult<i64>;
    /// 标签维护（P2-2）：把一个或多个标签归并到目标标签（事务内归并去重 + 同步 category 镜像）。
    /// `sources` 中已等于 `into` 的项自动跳过。返回受影响的书数量。
    fn merge_tags(&self, sources: &[String], into: &str) -> AppResult<i64>;
    /// 标签维护（P2-2）：删除某标签，解除所有书该标签（事务内 + 同步 category 镜像）。
    /// 返回受影响的书数量（0 = 无书使用该标签，属幂等成功）。
    fn delete_tag(&self, tag: &str) -> AppResult<i64>;
    /// 全库标签书目计数（P2-2 前端筛选栏展示）：标签 + 拥有该标签的书数，按计数降序、标签名升序。
    fn list_tag_counts(&self) -> AppResult<Vec<(String, i64)>>;
    /// 用新切分的 chunks 整体替换某本书的索引（事务：删旧 chunks→插新→更新统计→刷新镜像）。
    /// 旧 chunks 删除由 FTS 触发器同步清倒排，不会残留孤儿索引。
    fn replace_book_chunks(
        &self,
        book_id: i64,
        source: &str,
        raw_text: &str,
        chunks: &[(String, String, String)],
    ) -> AppResult<()>;
    fn delete_book(&self, id: i64) -> AppResult<()>;
    /// 检索：≥3 字符走 FTS5 MATCH（BM25 排序），<3 字符走 LIKE 回退。
    /// **重复句在检索时合并**（非破坏，库里不删行）：同 `norm_hash` 的句子只出一条代表 +
    /// `occurrence_count` / `occurrences`；`book_id` 为 `Some` 时统计范围限该书 → 不做跨书合并。
    /// 注：合并会缩减条数，`limit` 指「合并后条数」（内部按 `MERGE_OVERFETCH` 倍多取原始命中），
    /// `offset` 仅对未合并的原始命中流有意义。
    fn search(
        &self,
        query: &str,
        book_id: Option<i64>,
        limit: i64,
        offset: i64,
    ) -> AppResult<Vec<CorpusSearchHit>>;
    /// 重复语句组（仅 kind='sentence'）：按归一化指纹分组，返回出现次数 > 1 的组
    /// （按出现次数降序，截断 Top-N）与**组总数**（组总数可能大于返回条数）。
    fn sentence_dup_groups(&self, limit: i64) -> AppResult<(Vec<SentenceDupGroup>, i64)>;

    /// 空间回收（P0 迁移）：`wal_checkpoint(TRUNCATE)` → FTS5 rebuild → `VACUUM`。
    ///
    /// 为什么需要 rebuild + VACUUM 两步（缺一不可）：
    /// - 升级前的旧库没有 FTS 触发器，删除只清了业务表，倒排残留全在 corpus_fts_data
    ///   （实测 50MB 级）；`VACUUM` 只把 freelist 页还给文件，压不掉索引段内部残留；
    /// - `INSERT INTO corpus_fts(corpus_fts) VALUES('rebuild')` 按 content 表重建倒排，
    ///   把残留清零；随后 `VACUUM` 才能把释放的页真正从文件里回收。
    /// 幂等：无残留时 rebuild 为空操作、VACUUM 无页可收，可随时重复执行。
    /// 铁律：只重建倒排 + 压缩文件，不 DROP 表、不改动业务数据。
    fn optimize_storage(&self) -> AppResult<CorpusStorageReport>;
}

pub struct SqliteCorpusRepository {
    db: std::sync::Arc<CorpusDatabase>,
}

impl Clone for SqliteCorpusRepository {
    fn clone(&self) -> Self {
        Self { db: self.db.clone() }
    }
}

impl SqliteCorpusRepository {
    pub fn new(db: std::sync::Arc<CorpusDatabase>) -> Self {
        Self { db }
    }

    /// 幂等替换某书全部标签：先清后插（trim 去空去重已由调用方 normalize）。
    /// 调用方必须已持有锁且书存在（UPDATE 校验过 n>0）。
    fn sync_tags_inner(&self, book_id: i64, tags: &[String]) -> AppResult<()> {
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM corpus_book_tags WHERE book_id = ?1", params![book_id])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO corpus_book_tags (book_id, tag) VALUES (?1, ?2)",
            )?;
            for tag in tags {
                stmt.execute(params![book_id, tag])?;
            }
            drop(stmt);
        }
        tx.commit()?;
        Ok(())
    }

    /// 以标签表真源重算受影响书的 category 镜像（顿号连接串；空标签 → 空串）。
    /// 供 rename/merge/delete 标签维护在事务内同步双写镜像（P2-2）。
    fn refresh_category_mirror(
        &self,
        tx: &rusqlite::Transaction,
        book_ids: &[i64],
    ) -> AppResult<()> {
        let mut sel = tx.prepare(
            "SELECT tag FROM corpus_book_tags WHERE book_id = ?1 ORDER BY tag",
        )?;
        let mut upd = tx.prepare(
            "UPDATE corpus_books SET category = ?2 WHERE id = ?1",
        )?;
        for book_id in book_ids {
            let tags: Vec<String> = sel
                .query_map(params![book_id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            upd.execute(params![book_id, join_tags(&tags)])?;
        }
        Ok(())
    }
}

fn row_to_book(row: &rusqlite::Row) -> rusqlite::Result<CorpusBook> {
    Ok(CorpusBook {
        id: row.get("id")?,
        title: row.get("title")?,
        author: row.get("author")?,
        language: row.get("language")?,
        source: row.get("source")?,
        category: row.get("category")?,
        source_path: row.get("source_path")?,
        content_hash: row.get("content_hash")?,
        simhash: row.get("simhash")?,
        word_count: row.get("word_count")?,
        chunk_count: row.get("chunk_count")?,
        created_at: row.get("created_at")?,
        // 标签由调用方装配（attach_tags_one / load_tags_map），行读取时留空
        tags: Vec::new(),
    })
}

/// corpus_books 读取列（按列名，禁位置索引）。
const BOOK_COLS: &str = "id, title, author, language, source, category, source_path, content_hash, \
                         simhash, word_count, chunk_count, created_at";

/// 标签分隔符：逗号 / 中文逗号 / 顿号 / 分号 / 中文分号 / 斜杠。
/// P0-3：旧路径 `update_book_meta(category)` 传入的单值或分隔串统一切分为多标签写入标签表。
/// 返回 trim 后非空列表（保序不去重；去重由 `normalize_tags` 统一处理）。
fn split_tags(input: &str) -> Vec<String> {
    input
        .split([',', '，', '、', ';', '；', '/'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 对标签列表做规范化：trim、去空（含仅空白）、去重（保序）。
fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    tags.iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .filter(|t| seen.insert(t.clone()))
        .collect()
}

/// category 列镜像：标签的「顿号连接」串（空 = 未分类）。保证旧检索 LIKE / 旧前端展示可命中。
fn join_tags(tags: &[String]) -> String {
    tags.join("、")
}

/// 装配单本书的标签：真源表优先；表为空但有 category 镜像时回退为单个标签（兼容 P0-3 前旧数据）。
/// `attach_tags_map` 拿到的全量 map 传入可避免重复查询；None 时按 book_id 单查。
fn attach_tags_one(
    conn: &rusqlite::Connection,
    book: &mut CorpusBook,
    map: Option<&std::collections::HashMap<i64, Vec<String>>>,
) -> rusqlite::Result<()> {
    let tags = match map {
        Some(m) => m.get(&book.id).cloned().unwrap_or_default(),
        None => {
            let mut stmt = conn.prepare(
                "SELECT tag FROM corpus_book_tags WHERE book_id = ?1 ORDER BY tag",
            )?;
            let tags = stmt
                .query_map(params![book.id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            tags
        }
    };
    book.tags = if tags.is_empty() && !book.category.is_empty() {
        vec![book.category.clone()]
    } else {
        tags
    };
    Ok(())
}

/// 一次查询全表标签，按 book_id 聚合（书量级几十本，避免 list/search 场景 N+1）。
fn load_tags_map(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<std::collections::HashMap<i64, Vec<String>>> {
    let mut stmt = conn.prepare("SELECT book_id, tag FROM corpus_book_tags")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut map: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    for row in rows {
        let (book_id, tag) = row?;
        map.entry(book_id).or_default().push(tag);
    }
    Ok(map)
}

const CHUNK_COLS: &str = "id, book_id, seq, kind, content, chapter_title";

/// 重复句出现位置的列举上限（前端展开用；总数另由 `occurrence_count` 给出）。
const OCCURRENCE_LIST_LIMIT: i64 = 20;
/// 合并会缩减结果条数，故按此倍数多取原始命中，尽量凑满 `limit` 条。
const MERGE_OVERFETCH: i64 = 4;

/// 检索命中 + 归一化指纹（合并重复句用；指纹为内部量，不外发）。
struct RawHit {
    hit: CorpusSearchHit,
    norm_hash: i64,
}

fn row_to_raw_hit(row: &rusqlite::Row) -> rusqlite::Result<RawHit> {
    Ok(RawHit {
        norm_hash: row.get("norm_hash")?,
        hit: CorpusSearchHit {
            chunk_id: row.get("chunk_id")?,
            book_id: row.get("book_id")?,
            book_title: row.get("book_title")?,
            seq: row.get("seq")?,
            kind: row.get("kind")?,
            chapter_title: row.get("chapter_title")?,
            content: row.get("content")?,
            occurrence_count: 1,
            occurrences: Vec::new(),
        },
    })
}

/// 检索时合并重复句（**非破坏**：库里不删任何行，只改结果形态）。
///
/// 归并键 = 归一化指纹 `norm_hash`。仅 `kind='sentence'` 且指纹非 0 的行参与
/// （章标题行、旧数据默认值不合并）；同指纹只出**排序最前**的一条作代表，
/// 其出现次数/位置按**当前检索范围**统计（`book_id` 为 `Some` 时只算该书 → 天然不做跨书合并）。
fn merge_duplicate_hits(
    conn: &rusqlite::Connection,
    rows: Vec<RawHit>,
    book_id: Option<i64>,
    limit: i64,
) -> AppResult<Vec<CorpusSearchHit>> {
    let mut out: Vec<CorpusSearchHit> = Vec::new();
    let mut seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for raw in rows {
        if out.len() as i64 >= limit {
            break;
        }
        let RawHit { hit, norm_hash } = raw;
        if hit.kind != "sentence" || norm_hash == 0 {
            out.push(hit);
            continue;
        }
        if !seen.insert(norm_hash) {
            continue; // 该指纹已出过代表条，折叠掉
        }
        let mut hit = hit;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM corpus_chunks
             WHERE norm_hash = ?1 AND kind = 'sentence' AND (?2 IS NULL OR book_id = ?2)",
            params![norm_hash, book_id],
            |r| r.get(0),
        )?;
        hit.occurrence_count = count;
        if count > 1 {
            let mut stmt = conn.prepare(
                "SELECT c.id AS chunk_id, c.book_id AS book_id, b.title AS book_title,
                        c.seq AS seq, c.chapter_title AS chapter_title
                 FROM corpus_chunks c
                 JOIN corpus_books b ON b.id = c.book_id
                 WHERE c.norm_hash = ?1 AND c.kind = 'sentence' AND (?2 IS NULL OR c.book_id = ?2)
                 ORDER BY c.book_id, c.seq
                 LIMIT ?3",
            )?;
            hit.occurrences = stmt
                .query_map(params![norm_hash, book_id, OCCURRENCE_LIST_LIMIT], |row| {
                    Ok(CorpusHitOccurrence {
                        chunk_id: row.get("chunk_id")?,
                        book_id: row.get("book_id")?,
                        book_title: row.get("book_title")?,
                        seq: row.get("seq")?,
                        chapter_title: row.get("chapter_title")?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
        }
        out.push(hit);
    }
    Ok(out)
}

/// 全书指纹 → (内容精确指纹, SimHash)。
///
/// 从 chunks 统一计算，保证指纹与落库内容一致——「重建索引」换 chunks 时指纹自动刷新，不会漂移。
/// 归一化会去掉所有空白，故这里补的分隔换行不影响结果（等价于原始抽取文本）。
/// pub(crate)：命令层「增量重建」调用本函数比对「重切分结果 vs 库内 content_hash」，一致则跳过整体替换。
pub(crate) fn book_fingerprints(chunks: &[(String, String, String)]) -> (String, i64) {
    // 拼接全书内容（分隔换行去空白后不影响归一化结果，语义与 raw_text 一致）
    let full_len: usize = chunks.iter().map(|(_, c, _)| c.len()).sum();
    let mut full = String::with_capacity(full_len + chunks.len());
    for (_, content, _) in chunks {
        full.push_str(content);
        full.push('\n');
    }
    // 一次归一化，内容指纹与 SimHash 共用（大书导入时避免全文被扫描 2 次 + 两份全文级中间串）
    let norm = fingerprint::normalize_for_hash(&full);
    (
        fingerprint::content_fingerprint_normalized(&norm),
        fingerprint::simhash64_normalized(&norm),
    )
}

/// 全书总字数（与 `pipeline::count_words` 同口径）。
fn total_words(chunks: &[(String, String, String)]) -> i64 {
    chunks
        .iter()
        .map(|(_, content, _)| crate::domain::corpus::pipeline::count_words(content))
        .sum()
}

/// 批量插入某本书的 chunks（调用方保证在事务内；FTS 触发器随之建倒排）。
/// 逐句写入归一化指纹，供「重复语句」统计。无进度回调用途。
fn insert_chunks(
    tx: &rusqlite::Transaction<'_>,
    book_id: i64,
    chunks: &[(String, String, String)],
) -> AppResult<()> {
    insert_chunks_with_progress(tx, book_id, chunks, &mut |_, _| {})
}

/// 带进度回调的逐句插入：`progress(done, total)` 每写一句回调一次（回调廉价、是否节流由调用方定），
/// 用于导入进度事件透出。
fn insert_chunks_with_progress(
    tx: &rusqlite::Transaction<'_>,
    book_id: i64,
    chunks: &[(String, String, String)],
    progress: &mut dyn FnMut(usize, usize),
) -> AppResult<()> {
    let total = chunks.len();
    let mut stmt = tx.prepare(
        "INSERT INTO corpus_chunks (book_id, seq, kind, content, chapter_title, norm_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for (i, (kind, content, chapter_title)) in chunks.iter().enumerate() {
        stmt.execute(params![
            book_id,
            i as i64,
            kind,
            content,
            chapter_title,
            fingerprint::chunk_fingerprint(content)
        ])?;
        progress(i + 1, total);
    }
    Ok(())
}

impl SqliteCorpusRepository {
    /// 带进度回调的导入：`progress(done, total)`（已写 chunk 数 / 总 chunk 数）
    /// 在 FTS 建索引阶段（耗时主体）逐句回调，供命令层透出导入进度事件；None 时与
    /// [`CorpusRepository::import_book`] 完全等价（同一事务、同一写序、同一指纹/镜像双写）。
    pub fn import_book_with_progress(
        &self,
        title: &str,
        author: &str,
        language: &str,
        category: &str,
        source: &str,
        source_path: &str,
        raw_text: &str,
        chunks: &[(String, String, String)],
        mut progress: Option<&mut dyn FnMut(usize, usize)>,
    ) -> AppResult<CorpusBook> {
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now().timestamp();
        // 导入即分类（与编辑口径一致）：分隔串 → 多标签（真源表）→ category 镜像列（顿号串）。
        // FTS 触发器（title/author/category 三列）随 INSERT 自动索引，导入后检索/过滤立即命中。
        let tags = normalize_tags(&split_tags(category));
        let joined = join_tags(&tags);
        let (content_hash, simhash) = book_fingerprints(chunks);
        let word_count = total_words(chunks);
        tx.execute(
            "INSERT INTO corpus_books
                (title, author, language, category, source, source_path, content_hash, simhash, word_count, chunk_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                title,
                author,
                language,
                joined,
                source,
                source_path,
                content_hash,
                simhash,
                word_count,
                chunks.len() as i64,
                now
            ],
        )?;
        let book_id = tx.last_insert_rowid();
        // 标签真源表：与 INSERT 同一事务内用同一连接直接插入（禁调自带锁/独立事务的 sync_tags_inner）
        if !tags.is_empty() {
            let mut stmt = tx.prepare(
                "INSERT INTO corpus_book_tags (book_id, tag) VALUES (?1, ?2)",
            )?;
            for tag in &tags {
                stmt.execute(params![book_id, tag])?;
            }
            drop(stmt);
        }
        // 归档抽取后的全文镜像（P0-1）：重建索引优先用镜像，不依赖外部源文件仍在
        tx.execute(
            "INSERT INTO corpus_book_sources (book_id, source, raw_text, stored_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![book_id, source, raw_text, now],
        )?;
        let mut noop = |_: usize, _: usize| {};
        insert_chunks_with_progress(
            &tx,
            book_id,
            chunks,
            progress.as_deref_mut().unwrap_or(&mut noop),
        )?;
        tx.commit()?;
        Ok(CorpusBook {
            id: book_id,
            title: title.to_string(),
            author: author.to_string(),
            language: language.to_string(),
            source: source.to_string(),
            // 导入分类已生效：category 列为顿号串，tags 为切分后的多标签（与编辑路径读回一致）
            category: joined,
            tags,
            source_path: source_path.to_string(),
            content_hash,
            simhash,
            word_count,
            chunk_count: chunks.len() as i64,
            created_at: now,
        })
    }
}

impl CorpusRepository for SqliteCorpusRepository {
    fn import_book(
        &self,
        title: &str,
        author: &str,
        language: &str,
        category: &str,
        source: &str,
        source_path: &str,
        raw_text: &str,
        chunks: &[(String, String, String)],
    ) -> AppResult<CorpusBook> {
        // 无进度回调的常规导入：行为与既有实现完全一致（委托下放，测试与旧调用路径不受影响）
        self.import_book_with_progress(
            title,
            author,
            language,
            category,
            source,
            source_path,
            raw_text,
            chunks,
            None,
        )
    }

    fn list_books(&self) -> AppResult<Vec<CorpusBook>> {
        let conn = self.db.0.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {BOOK_COLS} FROM corpus_books ORDER BY created_at DESC, id DESC"
        ))?;
        let mut rows = stmt
            .query_map([], row_to_book)?
            .collect::<Result<Vec<_>, _>>()?;
        // 批量装配标签（一次查询全表标签，避免 N+1）
        let map = load_tags_map(&conn)?;
        for book in &mut rows {
            attach_tags_one(&conn, book, Some(&map))?;
        }
        Ok(rows)
    }

    fn get_book(&self, id: i64) -> AppResult<CorpusBook> {
        let conn = self.db.0.lock().unwrap();
        let mut book = conn
            .query_row(
                &format!("SELECT {BOOK_COLS} FROM corpus_books WHERE id = ?1"),
                params![id],
                row_to_book,
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        attach_tags_one(&conn, &mut book, None)?;
        Ok(book)
    }

    fn get_book_source(&self, id: i64) -> AppResult<Option<CorpusBookSource>> {
        let conn = self.db.0.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT book_id, source, raw_text, stored_at
             FROM corpus_book_sources WHERE book_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(CorpusBookSource {
                book_id: row.get("book_id")?,
                source: row.get("source")?,
                raw_text: row.get("raw_text")?,
                stored_at: row.get("stored_at")?,
            })
        })?;
        match rows.next() {
            Some(Ok(src)) => Ok(Some(src)),
            Some(Err(e)) => Err(AppError::Database(e.to_string())),
            None => Ok(None), // 旧数据无镜像 → 命令层回退读外部源文件
        }
    }

    fn update_book_meta(
        &self,
        id: i64,
        title: &str,
        author: &str,
        language: &str,
        category: &str,
    ) -> AppResult<CorpusBook> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::Validation("book title must not be empty".into()));
        }
        // P0-3 双写同步：category 可传单值或分隔串，切分为多标签写入标签表，
        // category 列回写为顿号连接串（保证旧检索 LIKE / 旧前端展示仍命中）
        let tags = normalize_tags(&split_tags(category));
        let joined = join_tags(&tags);
        let n = {
            let conn = self.db.0.lock().unwrap();
            conn.execute(
                "UPDATE corpus_books
                 SET title = ?2, author = ?3, language = ?4, category = ?5
                 WHERE id = ?1",
                params![id, title, author.trim(), language, joined],
            )?
        };
        if n == 0 {
            return Err(AppError::NotFound(format!("corpus book {id} not found")));
        }
        self.sync_tags_inner(id, &tags)?;
        // 注意：锁已先行释放，此处再取锁读回全行，避免同线程重入死锁
        self.get_book(id)
    }

    fn search_books(&self, query: &str, limit: i64) -> AppResult<Vec<CorpusBook>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.db.0.lock().unwrap();
        let mut rows: Vec<CorpusBook> = Vec::new();
        if q.chars().count() >= 3 {
            // ≥3 字符：书 FTS5 MATCH（trigram 子串，覆盖 title/author/category；与句子分支同口径转义）。
            // 排序保持「最新导入优先」（与旧 LIKE 分支一致）；FTS 仅作候选集，不按 rank 重排。
            let phrase = format!("\"{}\"", q.replace('"', "\"\""));
            let mut stmt = conn.prepare(&format!(
                "SELECT {BOOK_COLS} FROM corpus_books
                 WHERE id IN (SELECT rowid FROM corpus_books_fts WHERE corpus_books_fts MATCH ?1)
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?2"
            ))?;
            rows = stmt
                .query_map(params![phrase, limit], row_to_book)?
                .collect::<Result<Vec<_>, _>>()?;
            drop(stmt);
        } else {
            // <3 字符：LIKE 回退（trigram 无法对 <3 字符建索引词；ESCAPE 转义 % _ \）
            let like = format!(
                "%{}%",
                q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
            );
            let mut stmt = conn.prepare(&format!(
                "SELECT {BOOK_COLS} FROM corpus_books
                 WHERE title LIKE ?1 ESCAPE '\\'
                    OR author LIKE ?1 ESCAPE '\\'
                    OR category LIKE ?1 ESCAPE '\\'
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?2"
            ))?;
            rows = stmt
                .query_map(params![like, limit], row_to_book)?
                .collect::<Result<Vec<_>, _>>()?;
            drop(stmt);
        }
        let map = load_tags_map(&conn)?;
        for book in &mut rows {
            attach_tags_one(&conn, book, Some(&map))?;
        }
        Ok(rows)
    }

    fn set_book_tags(&self, id: i64, tags: &[String]) -> AppResult<CorpusBook> {
        let tags = normalize_tags(tags);
        let joined = join_tags(&tags);
        let n = {
            let conn = self.db.0.lock().unwrap();
            conn.execute(
                "UPDATE corpus_books SET category = ?2 WHERE id = ?1",
                params![id, joined],
            )?
        };
        if n == 0 {
            return Err(AppError::NotFound(format!("corpus book {id} not found")));
        }
        self.sync_tags_inner(id, &tags)?;
        self.get_book(id)
    }

    fn search_books_by_tag(&self, tag: &str) -> AppResult<Vec<CorpusBook>> {
        let tag = tag.trim();
        if tag.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.db.0.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {BOOK_COLS} FROM corpus_books
             WHERE EXISTS (
                 SELECT 1 FROM corpus_book_tags t
                 WHERE t.book_id = corpus_books.id AND t.tag = ?1
             )
             ORDER BY created_at DESC, id DESC"
        ))?;
        let rows = stmt
            .query_map(params![tag], row_to_book)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        let map = load_tags_map(&conn)?;
        let mut rows = rows;
        for book in &mut rows {
            attach_tags_one(&conn, book, Some(&map))?;
        }
        Ok(rows)
    }

    /// 标签重命名（P2-2）：`from` → `to` 全库替换。事务内先把新标签写进受影响书（不存在才插，
    /// 与已有 `to` 标签自然归并去重），再删旧标签，最后同步 category 镜像。
    /// `to` 为空或与 `from` 相同视为无操作。返回受影响书数。
    fn rename_tag(&self, from: &str, to: &str) -> AppResult<i64> {
        let from = from.trim();
        let to = to.trim();
        if from.is_empty() || to.is_empty() || from == to {
            return Ok(0);
        }
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        // 受影响书目：当前带旧标签的书（去重）
        let affected: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT DISTINCT book_id FROM corpus_book_tags WHERE tag = ?1",
            )?;
            let rows = stmt
                .query_map(params![from], |r| r.get::<_, i64>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if affected.is_empty() {
            return Ok(0);
        }
        // ① 旧标签批量换成新标签；目标标签已存在时 INSERT 冲突，需按书两段处理：
        //    先插新（OR IGNORE 去重已有 to），再删旧。
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO corpus_book_tags (book_id, tag) VALUES (?1, ?2)",
        )?;
        for book_id in &affected {
            stmt.execute(params![book_id, to])?;
        }
        drop(stmt);
        tx.execute(
            "DELETE FROM corpus_book_tags WHERE tag = ?1",
            params![from],
        )?;
        // ② 同步受影响书 category 镜像（以标签表为真源重算顿号连接串）
        self.refresh_category_mirror(&tx, &affected)?;
        tx.commit()?;
        Ok(affected.len() as i64)
    }

    /// 标签合并（P2-2）：多个源标签归并到目标标签。事务内重复「INSERT OR IGNORE 目标 + DELETE 源」，
    /// 同一本书同时带源与目标标签时去重收敛为单条目标标签；同步 category 镜像。返回受影响书数。
    fn merge_tags(&self, sources: &[String], into: &str) -> AppResult<i64> {
        let into = into.trim();
        let sources: Vec<String> = normalize_tags(sources)
            .into_iter()
            .filter(|s| s != into)
            .collect();
        if into.is_empty() || sources.is_empty() {
            return Ok(0);
        }
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let placeholders = vec!["?"; sources.len()].join(", ");
        // 受影响书目：带任一源标签的书
        let sql = format!(
            "SELECT DISTINCT book_id FROM corpus_book_tags WHERE tag IN ({placeholders})"
        );
        let affected: Vec<i64> = {
            let mut stmt = tx.prepare(&sql)?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(sources.iter()), |r| {
                    r.get::<_, i64>(0)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if affected.is_empty() {
            return Ok(0);
        }
        // 归并：不影响目标标签所在书（OR IGNORE），源标签逐书删除
        {
            let mut ins = tx.prepare(
                "INSERT OR IGNORE INTO corpus_book_tags (book_id, tag) VALUES (?1, ?2)",
            )?;
            for book_id in &affected {
                ins.execute(params![book_id, into])?;
            }
        }
        tx.execute(
            &format!(
                "DELETE FROM corpus_book_tags WHERE tag IN ({placeholders})"
            ),
            rusqlite::params_from_iter(sources.iter()),
        )?;
        self.refresh_category_mirror(&tx, &affected)?;
        tx.commit()?;
        Ok(affected.len() as i64)
    }

    /// 标签删除（P2-2）：解除所有书的该标签并同步 category 镜像；标签不存在时为幂等成功（返回 0）。
    fn delete_tag(&self, tag: &str) -> AppResult<i64> {
        let tag = tag.trim();
        if tag.is_empty() {
            return Ok(0);
        }
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let affected: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT DISTINCT book_id FROM corpus_book_tags WHERE tag = ?1",
            )?;
            let rows = stmt
                .query_map(params![tag], |r| r.get::<_, i64>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if affected.is_empty() {
            return Ok(0);
        }
        tx.execute(
            "DELETE FROM corpus_book_tags WHERE tag = ?1",
            params![tag],
        )?;
        self.refresh_category_mirror(&tx, &affected)?;
        tx.commit()?;
        Ok(affected.len() as i64)
    }

    /// 全库标签书目计数（P2-2）：计数降序、同计数按标签名升序；标签为空串不出现（表内无空标签）。
    fn list_tag_counts(&self) -> AppResult<Vec<(String, i64)>> {
        let conn = self.db.0.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT tag, COUNT(book_id) AS n FROM corpus_book_tags
             GROUP BY tag ORDER BY n DESC, tag ASC",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn replace_book_chunks(
        &self,
        book_id: i64,
        source: &str,
        raw_text: &str,
        chunks: &[(String, String, String)],
    ) -> AppResult<()> {
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        // 删旧 chunks（触发器同步清 FTS 倒排）→ 插新 → 刷新统计/来源/指纹 → 刷新镜像
        tx.execute(
            "DELETE FROM corpus_chunks WHERE book_id = ?1",
            params![book_id],
        )?;
        insert_chunks(&tx, book_id, chunks)?;
        let (content_hash, simhash) = book_fingerprints(chunks);
        let word_count = total_words(chunks);
        tx.execute(
            "UPDATE corpus_books
             SET source = ?2, content_hash = ?3, simhash = ?4, word_count = ?5, chunk_count = ?6
             WHERE id = ?1",
            params![
                book_id,
                source,
                content_hash,
                simhash,
                word_count,
                chunks.len() as i64
            ],
        )?;
        // 重建后镜像以新抽取文本为准（旧数据无镜像行则补插）
        let _ = tx.execute(
            "INSERT INTO corpus_book_sources (book_id, source, raw_text, stored_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(book_id) DO UPDATE SET source = excluded.source,
                                                raw_text = excluded.raw_text,
                                                stored_at = excluded.stored_at",
            params![book_id, source, raw_text, chrono::Utc::now().timestamp()],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn delete_book(&self, id: i64) -> AppResult<()> {
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        // 显式删 chunks（触发器同步清 FTS 倒排）、标签、镜像，再删书行
        tx.execute("DELETE FROM corpus_chunks WHERE book_id = ?1", params![id])?;
        tx.execute(
            "DELETE FROM corpus_book_sources WHERE book_id = ?1",
            params![id],
        )?;
        tx.execute("DELETE FROM corpus_book_tags WHERE book_id = ?1", params![id])?;
        tx.execute("DELETE FROM corpus_books WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    fn search(
        &self,
        query: &str,
        book_id: Option<i64>,
        limit: i64,
        offset: i64,
    ) -> AppResult<Vec<CorpusSearchHit>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.db.0.lock().unwrap();
        // 重复句合并会缩减结果条数 → 原始命中按 MERGE_OVERFETCH 倍多取，再截到 limit
        let fetch = limit.saturating_mul(MERGE_OVERFETCH).clamp(1, 2000);
        // ≥3 字符：FTS5 MATCH（trigram 支持短语子串）+ BM25 排序
        if q.chars().count() >= 3 {
            // MATCH 查询需按 FTS 语法转义（双引号包裹短语，内嵌引号翻倍）
            let phrase = format!("\"{}\"", q.replace('"', "\"\""));
            let rows: Vec<RawHit> = {
                let mut stmt = conn.prepare(
                    "SELECT c.id AS chunk_id, c.book_id AS book_id, b.title AS book_title,
                            c.seq AS seq, c.kind AS kind, c.chapter_title AS chapter_title,
                            c.content AS content, c.norm_hash AS norm_hash
                     FROM (SELECT rowid, rank FROM corpus_fts WHERE corpus_fts MATCH ?1) f
                     JOIN corpus_chunks c ON c.id = f.rowid
                     JOIN corpus_books b ON b.id = c.book_id
                     WHERE (?2 IS NULL OR c.book_id = ?2)
                     ORDER BY f.rank
                     LIMIT ?3 OFFSET ?4",
                )?;
                let hits: Vec<RawHit> = stmt
                    .query_map(params![phrase, book_id, fetch, offset], row_to_raw_hit)?
                    .collect::<Result<Vec<_>, _>>()?;
                hits
            };
            return merge_duplicate_hits(&conn, rows, book_id, limit);
        }
        // <3 字符：LIKE 回退（ESCAPE 转义 % _ \）
        let like = format!(
            "%{}%",
            q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        );
        let rows: Vec<RawHit> = {
            let mut stmt = conn.prepare(
                "SELECT c.id AS chunk_id, c.book_id AS book_id, b.title AS book_title,
                        c.seq AS seq, c.kind AS kind, c.chapter_title AS chapter_title,
                        c.content AS content, c.norm_hash AS norm_hash
                 FROM corpus_chunks c
                 JOIN corpus_books b ON b.id = c.book_id
                 WHERE c.content LIKE ?1 ESCAPE '\\' AND (?2 IS NULL OR c.book_id = ?2)
                 ORDER BY c.book_id, c.seq
                 LIMIT ?3 OFFSET ?4",
            )?;
            let hits: Vec<RawHit> = stmt
                .query_map(params![like, book_id, fetch, offset], row_to_raw_hit)?
                .collect::<Result<Vec<_>, _>>()?;
            hits
        };
        merge_duplicate_hits(&conn, rows, book_id, limit)
    }

    fn sentence_dup_groups(&self, limit: i64) -> AppResult<(Vec<SentenceDupGroup>, i64)> {
        // 非正文噪声（独立拟声/语气句、纯省略号、作者更新注、站点水印）在 Rust 侧整组过滤：
        // 这些句子天然以超高次数霸占报告前列，把真正值得注意的重复淹没。
        // 组数可能很大 → 最多扫描 MAX_GROUP_SCAN 组（触顶时 total 为下界）。
        const MAX_GROUP_SCAN: i64 = 20_000;
        let conn = self.db.0.lock().unwrap();
        // norm_hash <> 0：排除旧数据/未计算行的默认值，避免它们被误聚成一组
        let mut stmt = conn.prepare(
            "SELECT norm_hash AS h, COUNT(*) AS n, COUNT(DISTINCT book_id) AS bk, MIN(content) AS sample
             FROM corpus_chunks
             WHERE kind = 'sentence' AND norm_hash <> 0
             GROUP BY norm_hash
             HAVING COUNT(*) > 1
             ORDER BY n DESC, h ASC
             LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![MAX_GROUP_SCAN], |row| {
                Ok((
                    row.get::<_, i64>("h")?,
                    row.get::<_, i64>("n")?,
                    row.get::<_, i64>("bk")?,
                    row.get::<_, String>("sample")?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut total = 0i64;
        let mut groups: Vec<SentenceDupGroup> = Vec::new();
        for (hash, n, bk, sample) in rows {
            if crate::domain::corpus::pipeline::is_noise_text(&sample) {
                continue;
            }
            total += 1;
            if total > limit {
                continue; // 已凑满 limit：只累计总数，不再查组内书名
            }
            let mut bstmt = conn.prepare(
                "SELECT DISTINCT b.title AS title
                 FROM corpus_chunks c
                 JOIN corpus_books b ON b.id = c.book_id
                 WHERE c.norm_hash = ?1 AND c.kind = 'sentence'
                 ORDER BY b.title
                 LIMIT 8",
            )?;
            let books = bstmt
                .query_map(params![hash], |r| r.get::<_, String>("title"))?
                .collect::<Result<Vec<_>, _>>()?;
            groups.push(SentenceDupGroup {
                sample,
                book_count: bk,
                chunk_count: n,
                books,
            });
        }
        Ok((groups, total))
    }

    fn optimize_storage(&self) -> AppResult<CorpusStorageReport> {
        let conn = self.db.0.lock().unwrap();
        // ① 先合并 WAL：让 page_count × page_size 与实际文件字节一致（报告口径）
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        let page_size: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0))?;
        let page_count_before: i64 =
            conn.query_row("PRAGMA page_count", [], |r| r.get(0))?;
        let fts_rows_before: i64 = conn.query_row(
            "SELECT COUNT(*) FROM corpus_fts_data",
            [],
            |r| r.get(0),
        )?;
        let size_before = page_count_before.saturating_mul(page_size);

        // ② FTS5 rebuild：按 content 表重建倒排，清掉升级前旧库遗留的索引残留
        //（external content 模式：触发器只维护增量，历史残留必须整体重建才可回收）
        conn.execute_batch("INSERT INTO corpus_fts(corpus_fts) VALUES('rebuild');")?;

        // ③ VACUUM：把释放的页真的还回文件（freelist → 文件变小）
        conn.execute_batch("VACUUM;")?;

        let page_count_after: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0))?;
        let fts_rows_after: i64 =
            conn.query_row("SELECT COUNT(*) FROM corpus_fts_data", [], |r| r.get(0))?;
        let size_after = page_count_after.saturating_mul(page_size);
        Ok(CorpusStorageReport {
            size_before,
            size_after,
            reclaimed_bytes: size_before.saturating_sub(size_after),
            fts_rows_before,
            fts_rows_after,
        })
    }
}

/// chunk 行读取（按列名），供测试断言用。
pub fn read_chunk(conn: &rusqlite::Connection, id: i64) -> AppResult<CorpusChunk> {
    conn.query_row(
        &format!("SELECT {CHUNK_COLS} FROM corpus_chunks WHERE id = ?1"),
        params![id],
        |row| {
            Ok(CorpusChunk {
                id: row.get("id")?,
                book_id: row.get("book_id")?,
                seq: row.get("seq")?,
                kind: row.get("kind")?,
                content: row.get("content")?,
                chapter_title: row.get("chapter_title")?,
            })
        },
    )
    .map_err(|e| AppError::Database(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::corpus::pipeline::parse_text;

    fn make_repo() -> SqliteCorpusRepository {
        SqliteCorpusRepository::new(std::sync::Arc::new(
            CorpusDatabase::open_in_memory().expect("in-memory corpus db"),
        ))
    }

    fn import_sample(repo: &SqliteCorpusRepository) -> CorpusBook {
        let chunks = parse_text("第一章 出山\n\n山风很大。他回头看见了孤独的山谷！\n\n第二章 入世\n\n孤独是宿命……");
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        repo.import_book(
            "测试书",
            "作者甲",
            "zh",
            "",
            "txt",
            "/tmp/测试书.txt",
            "第一章 出山\n\n山风很大。他回头看见了孤独的山谷！\n\n第二章 入世\n\n孤独是宿命……",
            &parsed,
        )
        .expect("import ok")
    }

    /// 镜像归档：导入即写入全文镜像，重建时读回（源文件不在也能重建）；格式标签正确。
    #[test]
    fn import_stores_and_reads_raw_text_mirror() {
        let repo = make_repo();
        let raw = "第一章 出山\n\n山风很大。他回头看见了孤独的山谷！\n\n第二章 入世\n\n孤独是宿命……";
        let chunks = parse_text(raw);
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let book = repo
            .import_book("镜像书", "作者甲", "zh", "", "epub", "/tmp/镜像书.epub", raw, &parsed)
            .unwrap();
        let src = repo.get_book_source(book.id).unwrap().expect("mirror exists");
        assert_eq!(src.raw_text, raw);
        assert_eq!(src.source, "epub");
        // 不存在的书 → None（而非 Err）
        assert!(repo.get_book_source(99999).unwrap().is_none());
    }

    /// 进度回调：with_progress 与普通 import_book 产物逐字段一致（仅有无回调差异），
    /// 且回调按句严格递增上报（done = 1..n，total 恒定），供导入进度事件可靠透出。
    #[test]
    fn import_book_with_progress_matches_plain_and_reports_each_chunk() {
        let repo = make_repo();
        let raw = "第一章 出山\n\n山风很大。他回头看见了孤独的山谷！\n\n第二章 入世\n\n孤独是宿命……";
        let parsed: Vec<(String, String, String)> = parse_text(raw)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let n = parsed.len();
        assert!(n >= 2);

        let mut done_seq: Vec<usize> = Vec::new();
        let mut totals: Vec<usize> = Vec::new();
        let book_p = repo
            .import_book_with_progress(
                "进度书",
                "作者甲",
                "zh",
                "",
                "txt",
                "/tmp/进度书.txt",
                raw,
                &parsed,
                Some(&mut |done, total| {
                    done_seq.push(done);
                    totals.push(total);
                }),
            )
            .unwrap();
        assert_eq!(done_seq.len(), n, "回调次数 = chunk 数");
        assert_eq!(done_seq, (1..=n).collect::<Vec<_>>(), "done 从 1..n 严格递增");
        assert!(totals.iter().all(|&t| t == n), "total 恒定为 {n}");

        // 产物与普通 import_book 完全一致：同一批 chunk 流下仅回调有无之分
        let book_plain = repo
            .import_book("普通书", "作者甲", "zh", "", "txt", "/tmp/普通书.txt", raw, &parsed)
            .unwrap();
        assert_eq!(book_p.content_hash, book_plain.content_hash);
        assert_eq!(book_p.simhash, book_plain.simhash);
        assert_eq!(book_p.word_count, book_plain.word_count);
        assert_eq!(book_p.chunk_count, book_plain.chunk_count);
    }

    /// 导入即分类（P0-3 双写一致）：category 分隔串 → 标签真源表 + category 镜像列（顿号串），
    /// 同一事务写入；返回的 CorpusBook 同时携带镜像串与切分后的多标签；检索/按标签过滤立即命中。
    #[test]
    fn import_book_categorizes_and_double_writes_tags() {
        let repo = make_repo();
        let raw = "第一章 出山\n\n山风很大。他回头看见了孤独的山谷！";
        let parsed: Vec<(String, String, String)> = parse_text(raw)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        // 分隔串入参（兼容编辑路径习惯：顿号 / 英文逗号）
        let book = repo
            .import_book("分类书", "作者戊", "zh", "玄幻、热血 、热血", "txt", "/tmp/分类书.txt", raw, &parsed)
            .unwrap();
        // 返回体：镜像列为顿号串，tags 为 trim 去重后（保序，与 set_book_tags 返回语义一致）
        assert_eq!(book.category, "玄幻、热血");
        assert_eq!(book.tags, vec!["玄幻".to_string(), "热血".to_string()]);
        // 读回一致：get_book 按 ORDER BY tag 字典序装配真源表（集合一致即可）
        let readback = repo.get_book(book.id).unwrap();
        assert_eq!(readback.category, "玄幻、热血");
        let mut read_tags = readback.tags.clone();
        read_tags.sort();
        assert_eq!(read_tags, vec!["热血".to_string(), "玄幻".to_string()]);
        // 检索命中分类（书级 FTS 含 category 列，≥3 字符走 trigram）
        assert!(repo.search_books("玄幻", 10).unwrap().iter().any(|b| b.id == book.id));
        // 按标签精确过滤命中
        assert!(repo.search_books_by_tag("热血").unwrap().iter().any(|b| b.id == book.id));
        // 目录书照旧可读
        assert_eq!(repo.list_books().unwrap().len(), 1);
        // 空分类 → 未分类（镜像空串、标签空）
        let bare = repo
            .import_book("无分类书", "作者己", "zh", "", "txt", "", raw, &parsed)
            .unwrap();
        assert_eq!(bare.category, "");
        assert!(bare.tags.is_empty());
        assert!(repo.search_books_by_tag("玄幻").unwrap().iter().all(|b| b.id != bare.id));
    }

    /// 重建索引刷新镜像：replace 后读回的是新抽取文本（旧镜像被覆盖，不累积）。
    #[test]
    fn replace_book_chunks_refreshes_mirror() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let old = repo.get_book_source(book.id).unwrap().unwrap().raw_text;
        assert!(old.contains("孤独的山谷"));
        let raw2 = "第三章 重建\n\n崭新的句子出现了。";
        let parsed: Vec<(String, String, String)> = parse_text(raw2)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        repo.replace_book_chunks(book.id, "txt", raw2, &parsed).unwrap();
        let new_src = repo.get_book_source(book.id).unwrap().unwrap();
        assert_eq!(new_src.raw_text, raw2);
        assert_eq!(new_src.source, "txt");
    }

    /// 删除书级联清镜像：get_book_source 返回 None，不残留孤儿镜像行。
    #[test]
    fn delete_book_removes_mirror() {
        let repo = make_repo();
        let book = import_sample(&repo);
        assert!(repo.get_book_source(book.id).unwrap().is_some());
        repo.delete_book(book.id).unwrap();
        assert!(repo.get_book_source(book.id).unwrap().is_none());
        let conn = repo.db.0.lock().unwrap();
        let leftover: i64 = conn
            .query_row("SELECT COUNT(*) FROM corpus_book_sources", [], |r| r.get(0))
            .unwrap();
        assert_eq!(leftover, 0, "no orphan mirror rows after delete");
    }

    /// FTS5/trigram 可用性 + 导入→检索 roundtrip（≥3 字查询走 MATCH）。
    #[test]
    fn import_then_search_match() {
        let repo = make_repo();
        let book = import_sample(&repo);
        assert_eq!(book.chunk_count, 4); // 2 章标题 + 2 句（短句「山风很大。」已并入后句）
        let hits = repo.search("孤独", None, 20, 0).expect("search ok");
        // 2 字查询走 LIKE 回退，但两个命中都应找到
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.book_title == "测试书"));
        // ≥3 字走 MATCH：命中「看见了孤独的山谷」
        let hits3 = repo.search("孤独的山谷", None, 20, 0).expect("search ok");
        assert_eq!(hits3.len(), 1);
        assert!(hits3[0].content.contains("孤独的山谷"));
        assert_eq!(hits3[0].chapter_title, "第一章 出山");
    }

    /// 导入期过滤 roundtrip：有效字符 <MIN_INDEX_CHARS 的孤立短句
/// （“嗯。”“走吧。”类 1–2 字碎片，无后续句可并）在 parse_text 阶段即被
/// Low 过滤不入库，搜索侧无需额外过滤即无法命中；正常完整句不受影响。
    #[test]
    fn short_fragments_not_indexed_after_import() {
        let repo = make_repo();
        // “走吧。”“嗯。”位于文末且无法与后续句合并（孤立碎片）→ 应被过滤；
        // 完整句与章标题保留
        let raw = "第一章 出山\n\n山风很大。他回头看见了孤独的山谷！\n\n走吧。\n\n嗯。";
        let chunks = parse_text(raw);
        // 孤立 1–2 字短句在导入阶段被过滤，不产生 chunk
        assert!(
            !chunks.iter().any(|c| c.content == "嗯。" || c.content == "走吧。"),
            "got: {chunks:?}"
        );
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let book = repo
            .import_book("短句书", "作者甲", "zh", "", "txt", "/tmp/短句书.txt", raw, &parsed)
            .unwrap();
        // 全书仅 1 个章标题 + 1 个完整句（“走吧。”“嗯。”已被滤除）
        assert_eq!(book.chunk_count, 2, "got: {book:?}");
        // 短句在库中检索不到（<3 字查询走 LIKE 回退，库中无此内容）
        let hits_tone = repo.search("嗯", None, 20, 0).expect("search ok");
        assert_eq!(hits_tone.len(), 0, "got: {hits_tone:?}");
        let hits_short = repo.search("走吧", None, 20, 0).expect("search ok");
        assert_eq!(hits_short.len(), 0, "got: {hits_short:?}");
        // 正常完整句仍然可检索
        let hits_full = repo.search("孤独的山谷", None, 20, 0).expect("search ok");
        assert_eq!(hits_full.len(), 1, "got: {hits_full:?}");
    }

    /// 导入期过滤 roundtrip：多字感叹词独立行（“我的天！”“老天爷！”）不与正文
    /// 合并（EOF 孤立）时判 Low 不入库；感叹词+正文合并的完整单元正常保留可检索。
    #[test]
    fn pure_exclamations_not_indexed_after_import() {
        let repo = make_repo();
        // “我的天！”“哎呀妈呀！”位于文末且无后续正文可并 → 纯感叹判 Low 应被过滤；
        // “我的天！”+正文合并单元保留
        let raw =
            "第一章 出山\n\n山风很大。他回头看见了孤独的山谷！\n\n“我的天！”\n\n哎呀妈呀！";
        let chunks = parse_text(raw);
        // 独立感叹词行在导入阶段被过滤，不产生 chunk
        assert!(
            !chunks
                .iter()
                .any(|c| c.content == "“我的天！”" || c.content == "哎呀妈呀！"),
            "got: {chunks:?}"
        );
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let book = repo
            .import_book("感叹词书", "作者乙", "zh", "", "txt", "/tmp/感叹词书.txt", raw, &parsed)
            .unwrap();
        // 全书 1 个章标题 + 1 个完整句（独立感叹词已滤除）
        assert_eq!(book.chunk_count, 2, "got: {book:?}");
        // 感叹词在库中检索不到
        let hits_excl = repo.search("我的天", None, 20, 0).expect("search ok");
        assert_eq!(hits_excl.len(), 0, "got: {hits_excl:?}");
        // 正常完整句仍然可检索
        let hits_full = repo.search("孤独的山谷", None, 20, 0).expect("search ok");
        assert_eq!(hits_full.len(), 1, "got: {hits_full:?}");
    }

    /// 导入期 roundtrip：感叹词行并入正文的完整单元（“我的天！”+正文）
    /// 正常入库并可检索，不因纯感叹判定被误伤。
    #[test]
    fn exclamation_merged_with_body_is_indexed() {
        let repo = make_repo();
        let raw = "第一章 出山\n\n“我的天！”\n他猛地睁开眼，看见漫天飞雪。";
        let chunks = parse_text(raw);
        assert!(
            chunks
                .iter()
                .any(|c| c.content.contains("“我的天！”他猛地睁开眼")),
            "got: {chunks:?}"
        );
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let book = repo
            .import_book("感叹词合并书", "作者丙", "zh", "", "txt", "/tmp/感叹词合并书.txt", raw, &parsed)
            .unwrap();
        assert_eq!(book.chunk_count, 2, "got: {book:?}");
        let hits = repo.search("漫天飞雪", None, 20, 0).expect("search ok");
        assert_eq!(hits.len(), 1, "got: {hits:?}");
    }

    /// 导入期 roundtrip：章标题混挂【作者注（“第三百零八章 过于简单的第二轮【…】”）
    /// 剥离尾注后按净标题入库；独立求票注行按噪声过滤；正文句正常可检索。
    #[test]
    fn heading_with_author_note_and_vote_noise_filtered() {
        let repo = make_repo();
        let raw = "第一章 出山\n\n山风很大，他回头看见了孤独的山谷。\n\n第二百二十七章 异火的吞噬，启动！\n\n求保底月票！\n\n老者说。";
        let chunks = parse_text(raw);
        // 剥离作者注的净标题入库，且正文短句并入完整句
        let titles: Vec<String> = chunks
            .iter()
            .filter(|c| c.kind == "chapter")
            .map(|c| c.content.clone())
            .collect();
        assert_eq!(titles, vec!["第一章 出山", "第二百二十七章 异火的吞噬，启动！"], "got: {titles:?}");
        // 独立求票行不产生任何 chunk
        assert!(
            !chunks.iter().any(|c| c.content.contains("月票")),
            "got: {chunks:?}"
        );
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let book = repo
            .import_book(
                "标题注书",
                "作者丁",
                "zh",
                "",
                "txt",
                "/tmp/标题注书.txt",
                raw,
                &parsed,
            )
            .unwrap();
        // 2 个章标题 + 2 个正文句（求票注已滤除；「老者说。」有效字符 3 保留）
        assert_eq!(book.chunk_count, 4, "got: {book:?}");
        // 剥离注后标题可检索；带感叹号的真实标题可检索
        let hits_t = repo.search("异火的吞噬", None, 20, 0).expect("search ok");
        assert_eq!(hits_t.len(), 1, "got: {hits_t:?}");
        // 正文句归属净标题所在章节
        let hits_body = repo.search("孤独的山谷", None, 20, 0).expect("search ok");
        assert_eq!(hits_body.len(), 1, "got: {hits_body:?}");
        // 求票注行检索不到（未入库）
        let hits_vote = repo.search("月票", None, 20, 0).expect("search ok");
        assert_eq!(hits_vote.len(), 0, "got: {hits_vote:?}");
    }

    /// 按书过滤：只返回指定书的命中。
    #[test]
    fn search_filters_by_book() {
        let repo = make_repo();
        let b1 = import_sample(&repo);
        let other: Vec<(String, String, String)> = parse_text(" completely unrelated prose about rivers.")
            .into_iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let b2 = repo
            .import_book(
                "第二本",
                "乙",
                "en",
                "",
                "txt",
                "",
                " completely unrelated prose about rivers.",
                &other,
            )
            .unwrap();
        let hits = repo.search("孤独", Some(b1.id), 20, 0).unwrap();
        assert!(hits.iter().all(|h| h.book_id == b1.id));
        assert!(repo.search("rivers", Some(b2.id), 20, 0).unwrap().len() >= 1);
        assert!(repo.search("rivers", Some(b1.id), 20, 0).unwrap().is_empty());
    }

    /// 删除级联：书删后 chunks 清空、FTS 倒排同步清理（再查无命中）。
    #[test]
    fn delete_book_cascades_and_clears_fts() {
        let repo = make_repo();
        let book = import_sample(&repo);
        assert!(!repo.search("孤独", None, 20, 0).unwrap().is_empty());
        repo.delete_book(book.id).unwrap();
        assert!(repo.list_books().unwrap().is_empty());
        assert!(repo.search("孤独", None, 20, 0).unwrap().is_empty());
        assert!(repo.search("山谷", None, 20, 0).unwrap().is_empty());
        // 直查两表零残留（不留脏数据：chunks 行与 books 行都必须为 0）
        let conn = repo.db.0.lock().unwrap();
        let chunks_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM corpus_chunks", [], |r| r.get(0))
            .unwrap();
        let books_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM corpus_books", [], |r| r.get(0))
            .unwrap();
        assert_eq!((chunks_left, books_left), (0, 0));
    }

    /// 空查询/空白查询返回空集不报错；MATCH 语法特殊字符（双引号）不 panic。
    #[test]
    fn search_edge_cases() {
        let repo = make_repo();
        import_sample(&repo);
        assert!(repo.search("", None, 20, 0).unwrap().is_empty());
        assert!(repo.search("   ", None, 20, 0).unwrap().is_empty());
        // 双引号转义路径（走 MATCH 分支）
        let _ = repo.search("孤\"独", None, 20, 0).unwrap();
    }

    /// get_book 读回 source_path（重建索引据此重读原文件）。
    #[test]
    fn get_book_returns_source_path() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let fetched = repo.get_book(book.id).unwrap();
        assert_eq!(fetched.source_path, "/tmp/测试书.txt");
        assert_eq!(fetched.title, "测试书");
        assert!(repo.get_book(99999).is_err());
    }

    /// 重建索引：replace_book_chunks 整体换索引，旧倒排清除、新倒排生效、统计更新。
    #[test]
    fn replace_book_chunks_swaps_index_and_clears_fts() {
        let repo = make_repo();
        let book = import_sample(&repo);
        assert!(!repo.search("孤独", None, 20, 0).unwrap().is_empty());
        let new_chunks = parse_text("第三章 重建\n\n崭新的句子出现了。");
        let parsed: Vec<(String, String, String)> = new_chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        repo.replace_book_chunks(book.id, "epub", "第三章 重建\n\n崭新的句子出现了。", &parsed)
            .unwrap();
        let after = repo.get_book(book.id).unwrap();
        assert_eq!(after.source, "epub");
        assert_eq!(after.chunk_count, parsed.len() as i64);
        assert!(after.word_count > 0);
        // 旧词不再命中（旧 chunks 已删且倒排已清），新词可命中
        assert!(repo.search("孤独", None, 20, 0).unwrap().is_empty());
        let hits = repo.search("崭新的句子", None, 20, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chapter_title, "第三章 重建");
    }

    /// 导入即计算指纹：内容指纹 32 位十六进制、SimHash 非零；同内容（含空白差异）指纹一致。
    #[test]
    fn import_computes_stable_fingerprints() {
        let repo = make_repo();
        let a = import_sample(&repo);
        assert_eq!(a.content_hash.len(), 32);
        assert_ne!(a.simhash, 0);
        // 同内容、更多空白（不同格式/换行）→ 归一化后一致
        let chunks = parse_text(
            "第一章  出山\n\n\n山风很大。他回头看见了孤独的山谷！\n\n第二章 入世\n\n孤独是宿命……",
        );
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let b = repo
            .import_book(
                "同内容另存",
                "作者甲",
                "zh",
                "",
                "epub",
                "/tmp/b.epub",
                "第一章  出山\n\n\n山风很大。他回头看见了孤独的山谷！\n\n第二章 入世\n\n孤独是宿命……",
                &parsed,
            )
            .unwrap();
        assert_eq!(a.content_hash, b.content_hash);
        assert_eq!(a.simhash, b.simhash);
        // 读回一致（落库字段正确）
        assert_eq!(repo.get_book(a.id).unwrap().content_hash, a.content_hash);
    }

    /// 重建索引会刷新指纹（chunks 变了 → 指纹随之变）。
    #[test]
    fn replace_book_chunks_refreshes_fingerprints() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let before = repo.get_book(book.id).unwrap().content_hash;
        let chunks = parse_text("完全不同的另一本书的内容，讲的是深海与星辰。");
        let parsed: Vec<(String, String, String)> = chunks
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        repo.replace_book_chunks(book.id, "txt", "完全不同的另一本书的内容，讲的是深海与星辰。", &parsed)
            .unwrap();
        let after = repo.get_book(book.id).unwrap().content_hash;
        assert_ne!(before, after);
        assert_eq!(after.len(), 32);
    }

    /// 查重报告过滤：拟声/省略号/作者注组被整组排除，真实重复句保留（total 同步排除）。
    #[test]
    fn sentence_dup_groups_exclude_noise() {
        let repo = make_repo();
        let rep = |c: &str| ("sentence".to_string(), c.to_string(), String::new());
        let mk = |title: &str, chunks: Vec<(String, String, String)>| {
            let raw: String = chunks
                .iter()
                .map(|(_, c, _)| c.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            repo.import_book(title, "", "zh", "", "txt", "", &raw, &chunks).unwrap()
        };
        mk(
            "甲书",
            vec![
                rep("“嘭！”"),
                rep("药老笑道。"),
                rep("药老笑道。"),
                rep("……"),
                rep("(第一更!"),
            ],
        );
        mk("乙书", vec![rep("“嘭！”"), rep("药老笑道。")]);
        let (groups, total) = repo.sentence_dup_groups(10).unwrap();
        // 噪声组（“嘭！”×2）被整组排除；「……」「(第一更!」各仅 1 次本就不成组
        assert_eq!(total, 1);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].sample, "药老笑道。");
        assert_eq!(groups[0].chunk_count, 3);
        assert_eq!(groups[0].book_count, 2);
        assert_eq!(groups[0].books.len(), 2);
    }

    /// 重复语句组：跨书同句聚为一组；章标题（kind='chapter'）不计入；旧数据 norm_hash=0 被排除。
    #[test]
    fn sentence_dup_groups_aggregate_cross_book() {
        let repo = make_repo();
        // 共享句须 ≥ MIN_MERGED_CHARS（8 字符）：短句会并入相邻句，不再独立成句
        let shared = "孤独是宿命，无人能解。";
        let mk = |title: &str, extra: &str| {
            let text = format!("第一章\n\n{shared}\n\n{extra}");
            let parsed: Vec<(String, String, String)> = parse_text(&text)
                .iter()
                .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
                .collect();
            repo.import_book(title, "", "zh", "", "txt", "", &text, &parsed).unwrap()
        };
        mk("甲书", "山风很大，他回头望了一眼。");
        mk("乙书", "星空之下，万籁俱寂。");
        let (groups, total) = repo.sentence_dup_groups(10).unwrap();
        // 两本书的章标题都叫「第一章」，但 kind='chapter' 已被过滤，不构成重复
        assert_eq!(total, 1);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].sample, shared);
        assert_eq!(groups[0].chunk_count, 2);
        assert_eq!(groups[0].book_count, 2);
        assert_eq!(groups[0].books.len(), 2);
    }

    /// 把若干句文本切成导入元组（测试辅助）。
    fn tuples(text: &str) -> Vec<(String, String, String)> {
        parse_text(text)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect()
    }

    /// 检索时合并跨书重复句（非破坏）：同句只出 1 条 + 出现次数/位置。
    #[test]
    fn search_merges_duplicate_sentences_across_books() {
        let repo = make_repo();
        // 共享句须 ≥ MIN_MERGED_CHARS（8 字符）：短句会并入相邻句，不再独立成句
        let shared = "山风很大，他回头望了一眼。";
        let mk = |title: &str, extra: &str| {
            let text = format!("第一章\n\n{shared}\n\n{extra}");
            repo.import_book(title, "", "zh", "", "txt", "", &text, &tuples(&text))
                .unwrap()
        };
        mk("甲书", "独自前行，一路无人作伴。");
        mk("乙书", "星空之下，万籁俱寂。");

        let hits = repo.search("山风很大", None, 20, 0).unwrap();
        assert_eq!(hits.len(), 1, "同句跨书应合并为 1 条代表");
        assert_eq!(hits[0].occurrence_count, 2);
        assert_eq!(hits[0].occurrences.len(), 2);
        let books: Vec<&str> = hits[0]
            .occurrences
            .iter()
            .map(|o| o.book_title.as_str())
            .collect();
        assert!(books.contains(&"甲书") && books.contains(&"乙书"));
        assert!(hits[0].content.contains("山风很大"));
    }

    /// 合并的统计范围跟随 `book_id` 过滤 → 不把其它书的出现算进来（不做跨书合并）。
    #[test]
    fn search_merge_respects_book_filter() {
        let repo = make_repo();
        // 共享句须 ≥ MIN_MERGED_CHARS（8 字符）：短句会并入相邻句，不再独立成句；
        // 「中段」同理需为完整句，避免作为短句粘到下一处 shared 上
        let shared = "孤独是宿命，无人能解。";
        let ba_text = format!("第一章\n\n{shared}\n\n中段，他顿了顿身形。\n\n{shared}");
        let ba = repo
            .import_book("甲书", "", "zh", "", "txt", "", &ba_text, &tuples(&ba_text))
            .unwrap();
        let bb_text = format!("第一章\n\n{shared}");
        repo.import_book("乙书", "", "zh", "", "txt", "", &bb_text, &tuples(&bb_text))
            .unwrap();

        // 全局：同句共 3 次 → 1 条
        let all = repo.search("孤独是宿命", None, 20, 0).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].occurrence_count, 3);
        assert_eq!(all[0].occurrences.len(), 3);

        // 按书过滤：只数该书内 2 次；出现位置全在该书
        let one = repo.search("孤独是宿命", Some(ba.id), 20, 0).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].occurrence_count, 2);
        assert!(one[0].occurrences.iter().all(|o| o.book_id == ba.id));
    }

    /// 章标题（kind='chapter'）不参与合并 —— 合并只针对正文句。
    #[test]
    fn search_does_not_merge_chapter_titles() {
        let repo = make_repo();
        for t in ["甲书", "乙书"] {
            repo.import_book(t, "", "zh", "", "txt", "", "第一章\n\n正文一句。", &tuples("第一章\n\n正文一句。"))
                .unwrap();
        }
        let hits = repo.search("第一章", None, 20, 0).unwrap();
        assert_eq!(hits.len(), 2, "章标题不应被合并");
        assert!(hits
            .iter()
            .all(|h| h.kind == "chapter" && h.occurrence_count == 1 && h.occurrences.is_empty()));
    }

    /// 唯一句：count = 1、occurrences 为空（LIKE 短查询路径同样适用）。
    #[test]
    fn search_unique_sentence_has_single_occurrence() {
        let repo = make_repo();
        import_sample(&repo);
        let hits = repo.search("山谷", None, 20, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].occurrence_count, 1);
        assert!(hits[0].occurrences.is_empty());
    }

    /// 元数据编辑：只碰 title/author/language/category 四列，指纹/统计/来源不动；空书名拒绝。
    #[test]
    fn update_book_meta_touches_meta_columns_only() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let before_hash = book.content_hash.clone();
        let updated = repo
            .update_book_meta(book.id, "新书名", "作者乙", "en", "玄幻")
            .unwrap();
        assert_eq!(updated.title, "新书名");
        assert_eq!(updated.author, "作者乙");
        assert_eq!(updated.language, "en");
        assert_eq!(updated.category, "玄幻");
        assert_eq!(updated.content_hash, before_hash);
        assert_eq!(updated.chunk_count, book.chunk_count);
        assert_eq!(updated.source_path, "/tmp/测试书.txt");
        // 首尾空白被裁剪
        let trimmed = repo
            .update_book_meta(book.id, "  空白裁剪  ", "", "", " ")
            .unwrap();
        assert_eq!(trimmed.title, "空白裁剪");
        assert_eq!(trimmed.category, "");
        // 空书名拒绝；不存在的书报 NotFound
        assert!(repo.update_book_meta(book.id, "   ", "", "", "").is_err());
        assert!(repo.update_book_meta(9999, "x", "", "", "").is_err());
    }

    /// 书名/作者/分类检索（≥3 字符走书 FTS，<3 字符 LIKE 回退，与句子分支同口径）。
    #[test]
    fn search_books_matches_title_author_category() {
        let repo = make_repo();
        import_sample(&repo);
        repo.update_book_meta(1, "测试书", "作者甲", "zh", "武侠玄幻")
            .unwrap();
        // 按分类命中（4 字符 → FTS）
        let books = repo.search_books("玄幻", 10).unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].id, 1);
        assert_eq!(books[0].category, "武侠玄幻");
        // 按书名命中；无命中返回空；limit 生效
        assert_eq!(repo.search_books("测试书", 10).unwrap().len(), 1);
        assert!(repo.search_books("不存在的书", 10).unwrap().is_empty());
        assert!(repo.search_books("测试", 0).unwrap().is_empty());
    }

    /// 书 FTS 主路径（≥3 字符）：书名/作者命中、更新元数据后新值可查旧值消失、删除后索引清除。
    #[test]
    fn book_fts_reindexes_on_meta_change_and_clears_on_delete() {
        let repo = make_repo();
        let book = import_sample(&repo);
        // 书名命中（FTS 由导入触发器写入）
        let hit = repo.search_books("测试书", 10).unwrap();
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].id, book.id);
        // 作者命中（author 列也进 FTS）
        let by_author = repo.search_books("作者甲", 10).unwrap();
        assert_eq!(by_author.len(), 1);
        // 改名后：新书名可查、旧书名不再命中（UPDATE 触发器重建倒排）
        let renamed = repo.update_book_meta(book.id, "全新书名", "作者乙", "zh", "").unwrap();
        assert_eq!(renamed.title, "全新书名");
        assert!(repo.search_books("测试书", 10).unwrap().is_empty());
        let by_new = repo.search_books("全新书名", 10).unwrap();
        assert_eq!(by_new.len(), 1);
        assert_eq!(by_new[0].title, "全新书名");
        // 删除后：索引同步清除（DELETE 触发器）
        repo.delete_book(book.id).unwrap();
        assert!(repo.search_books("全新书名", 10).unwrap().is_empty());
    }

    // ─── P0-3 标签体系 ───

    /// set_book_tags：多标签幂等替换（先清后插），category 列回写顿号连接串。
    #[test]
    fn set_book_tags_replaces_tags_and_syncs_category() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let updated = repo
            .set_book_tags(book.id, &["唯物".into(), " 悬疑 ".into(), "".into()])
            .unwrap();
        assert_eq!(updated.tags, vec!["唯物", "悬疑"]);
        assert_eq!(updated.category, "唯物、悬疑"); // 双写同步：category 列 = 顿号连接
        // 幂等替换：再设不同集合，旧标签被清掉
        let replaced = repo.set_book_tags(book.id, &["科幻".into()]).unwrap();
        assert_eq!(replaced.tags, vec!["科幻"]);
        assert_eq!(replaced.category, "科幻");
        // 空集合 = 清空标签
        let cleared = repo.set_book_tags(book.id, &[]).unwrap();
        assert!(cleared.tags.is_empty());
        assert_eq!(cleared.category, "");
        // 不存在的书报 NotFound
        assert!(repo.set_book_tags(9999, &["x".into()]).is_err());
    }

    /// update_book_meta 经由 category 分隔串双写同步标签表（旧前端单值路径兼容）。
    #[test]
    fn update_book_meta_splits_category_into_tags() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let updated = repo
            .update_book_meta(book.id, "测试书", "作者甲", "zh", "悬疑、推理,本格")
            .unwrap();
        assert_eq!(updated.tags, vec!["悬疑", "推理", "本格"]);
        assert_eq!(updated.category, "悬疑、推理、本格");
        // 单值也成立（P0-3 前旧前端行为不变）
        let single = repo.update_book_meta(book.id, "测试书", "作者甲", "zh", "玄幻").unwrap();
        assert_eq!(single.tags, vec!["玄幻"]);
        assert_eq!(single.category, "玄幻");
    }

    /// 读路径装配：import 后 tags 为空；list/get/search 均返回已装配 tags。
    #[test]
    fn read_paths_attach_tags() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let tagged = repo.set_book_tags(book.id, &["悬疑".into(), "推理".into()]).unwrap();
        let via_get = repo.get_book(book.id).unwrap();
        assert_eq!(via_get.tags, tagged.tags);
        let via_list = repo.list_books().unwrap();
        assert_eq!(via_list[0].tags, vec!["悬疑", "推理"]);
        let via_search = repo.search_books("测试", 10).unwrap();
        assert_eq!(via_search[0].tags, vec!["悬疑", "推理"]);
    }

    /// 标签双通道检索：≥3 字符标签经 category 镜像走书 FTS 命中，<3 字符 LIKE 回退命中。
    /// category 列镜像（顿号连接串）保证单独标签词也能被子串命中。
    #[test]
    fn search_books_matches_tag_table() {
        let repo = make_repo();
        let book = import_sample(&repo);
        repo.set_book_tags(book.id, &["悬疑".into(), "硬核推理".into()]).unwrap();
        // ≥3 字符标签：书 FTS 命中（category 镜像 = "悬疑、硬核推理"）
        let hit = repo.search_books("硬核推理", 10).unwrap();
        assert!(!hit.is_empty());
        assert_eq!(hit[0].id, book.id);
        // <3 字符标签：LIKE 回退命中 category 镜像（顿号连接串含该标签）
        let via_mirror = repo.search_books("悬疑", 10).unwrap();
        assert_eq!(via_mirror.len(), 1);
        // 标签专用字段值（category 镜像之外的第二通道）：书名/作者/分类均不含该词时，
        // 镜像中仍含标签全文，故命中依旧成立（双通道归一到镜像）
        let author_hit = repo.search_books("作者甲", 10).unwrap();
        assert_eq!(author_hit.len(), 1);
    }

    /// search_books_by_tag：按标签精确筛选多本书；空标签返回空。
    #[test]
    fn search_books_by_tag_filters_exactly() {
        let repo = make_repo();
        let book = import_sample(&repo);
        let second = import_sample(&repo);
        repo.set_book_tags(book.id, &["悬疑".into()]).unwrap();
        repo.set_book_tags(second.id, &["悬疑".into(), "推理".into()]).unwrap();
        let hit = repo.search_books_by_tag("悬疑").unwrap();
        assert_eq!(hit.len(), 2);
        assert!(hit.iter().all(|b| b.tags.contains(&"悬疑".to_string())));
        let precise = repo.search_books_by_tag("推理").unwrap();
        assert_eq!(precise.len(), 1);
        assert_eq!(precise[0].id, second.id);
        // 无命中的标签与空串
        assert!(repo.search_books_by_tag("不存在的标签").unwrap().is_empty());
        assert!(repo.search_books_by_tag("  ").unwrap().is_empty());
    }

    /// 删除书级联清标签行：删除后 tag 表无残留，list 不再出现该书。
    #[test]
    fn delete_book_cascades_tags() {
        let repo = make_repo();
        let book = import_sample(&repo);
        repo.set_book_tags(book.id, &["悬疑".into()]).unwrap();
        repo.delete_book(book.id).unwrap();
        assert!(repo.get_book(book.id).is_err());
        assert!(repo.search_books_by_tag("悬疑").unwrap().is_empty());
        // 复用 id 缺省断言列表为空（无残留标签行）
        assert!(repo.list_books().unwrap().is_empty());
    }

    /// 旧数据兼容：只有 category 列、无标签表的书（直接插 corpus_books 行模拟），
    /// 读路径 tags 回退为 [category]，不报错。
    #[test]
    fn legacy_category_without_tags_reads_as_single_tag() {
        let legacy_db = std::sync::Arc::new(CorpusDatabase::open_in_memory().unwrap());
        {
            let conn = legacy_db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO corpus_books (id, title, category) VALUES (7, '旧书', '散文')",
                [],
            )
            .unwrap();
        }
        let repo = SqliteCorpusRepository::new(legacy_db);
        let book = repo.get_book(7).unwrap();
        assert_eq!(book.category, "散文");
        assert_eq!(book.tags, vec!["散文"]);
    }

    // ─── P2-2 标签维护：rename / merge / delete / list_tag_counts ───

    /// rename：全库替换标签并同步 category 镜像；重命名为已存在标签时按书归并去重。
    #[test]
    fn rename_tag_replaces_all_and_merges_existing() {
        let repo = make_repo();
        let a = import_sample(&repo);
        let b = import_sample(&repo);
        repo.set_book_tags(a.id, &["悬疑".into(), "推理".into()]).unwrap();
        repo.set_book_tags(b.id, &["悬疑".into()]).unwrap();
        // 悬疑 → 推理：a 归并去重为「推理」，b 变为「推理」
        let affected = repo.rename_tag("悬疑", "推理").unwrap();
        assert_eq!(affected, 2);
        let ta = repo.get_book(a.id).unwrap();
        let tb = repo.get_book(b.id).unwrap();
        assert_eq!(ta.tags, vec!["推理"]);
        assert_eq!(ta.category, "推理"); // 镜像同步
        assert_eq!(tb.tags, vec!["推理"]);
        assert_eq!(tb.category, "推理");
        // 旧标签无残留、新标签可检索
        assert!(repo.search_books_by_tag("悬疑").unwrap().is_empty());
        assert_eq!(repo.search_books_by_tag("推理").unwrap().len(), 2);
        // 空/相同目标为无操作
        assert_eq!(repo.rename_tag("推理", "推理").unwrap(), 0);
        assert_eq!(repo.rename_tag("推理", "  ").unwrap(), 0);
    }

    /// rename：from 不存在时幂等返回 0，不动任何数据。
    #[test]
    fn rename_tag_unknown_is_noop() {
        let repo = make_repo();
        let book = import_sample(&repo);
        repo.set_book_tags(book.id, &["悬疑".into()]).unwrap();
        assert_eq!(repo.rename_tag("不存在", "新标签").unwrap(), 0);
        assert_eq!(repo.get_book(book.id).unwrap().tags, vec!["悬疑"]);
    }

    /// merge：多源标签归并到目标，同一本书带源和目标时收敛为单条目标标签；同步镜像。
    #[test]
    fn merge_tags_consolidates_and_dedupes() {
        let repo = make_repo();
        let a = import_sample(&repo);
        let b = import_sample(&repo);
        let c = import_sample(&repo);
        repo.set_book_tags(a.id, &["玄幻".into(), "推理".into()]).unwrap();
        repo.set_book_tags(b.id, &["悬疑".into()]).unwrap();
        repo.set_book_tags(c.id, &["科幻".into(), "悬疑".into()]).unwrap();
        // 玄幻 + 科幻 + 悬疑 → 推理（a 已有推理去重；b、c 直接改名）
        let affected = repo
            .merge_tags(
                &["玄幻".into(), "科幻".into(), "悬疑".into()],
                "推理",
            )
            .unwrap();
        assert_eq!(affected, 3);
        let ta = repo.get_book(a.id).unwrap();
        let tb = repo.get_book(b.id).unwrap();
        let tc = repo.get_book(c.id).unwrap();
        assert_eq!(ta.tags, vec!["推理"]);
        assert_eq!(ta.category, "推理");
        assert_eq!(tb.tags, vec!["推理"]);
        assert_eq!(tb.category, "推理");
        assert_eq!(tc.tags, vec!["推理"]);
        assert_eq!(tc.category, "推理");
        // 源标签全部清除，目标计数 3
        for src in ["玄幻", "科幻", "悬疑"] {
            assert!(repo.search_books_by_tag(src).unwrap().is_empty());
        }
        assert_eq!(repo.search_books_by_tag("推理").unwrap().len(), 3);
        // 目标存在于源列表中的无操作/空源无操作
        assert_eq!(repo.merge_tags(&["推理".into()], "推理").unwrap(), 0);
        assert_eq!(repo.merge_tags(&[], "推理").unwrap(), 0);
    }

    /// delete：解除所有书该标签并同步镜像；空标签/不存在标签幂等返回 0。
    #[test]
    fn delete_tag_removes_and_is_idempotent() {
        let repo = make_repo();
        let a = import_sample(&repo);
        let b = import_sample(&repo);
        repo.set_book_tags(a.id, &["悬疑".into(), "推理".into()]).unwrap();
        repo.set_book_tags(b.id, &["悬疑".into()]).unwrap();
        assert_eq!(repo.delete_tag("悬疑").unwrap(), 2);
        let ta = repo.get_book(a.id).unwrap();
        let tb = repo.get_book(b.id).unwrap();
        assert_eq!(ta.tags, vec!["推理"]);
        assert_eq!(ta.category, "推理");
        assert!(tb.tags.is_empty());
        assert_eq!(tb.category, ""); // 镜像同步为无标签
        assert!(repo.search_books_by_tag("悬疑").unwrap().is_empty());
        // 幂等：再删同标签 / 空标签均为 0
        assert_eq!(repo.delete_tag("悬疑").unwrap(), 0);
        assert_eq!(repo.delete_tag("  ").unwrap(), 0);
    }

    /// list_tag_counts：计数降序、同计数按标签名升序；仅统计真实标签表。
    #[test]
    fn list_tag_counts_sorted_by_popularity_then_name() {
        let repo = make_repo();
        let a = import_sample(&repo);
        let b = import_sample(&repo);
        let c = import_sample(&repo);
        repo.set_book_tags(a.id, &["悬疑".into(), "推理".into()]).unwrap();
        repo.set_book_tags(b.id, &["悬疑".into()]).unwrap();
        repo.set_book_tags(c.id, &["悬疑".into(), "新科幻".into()]).unwrap();
        let counts = repo.list_tag_counts().unwrap();
        let pairs: Vec<(String, i64)> = counts;
        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[0], ("悬疑".to_string(), 3));
        // 其余两个计数相同 → 按标签名 UTF-8 升序（推理 < 新科幻）
        assert_eq!(pairs[1], ("推理".to_string(), 1));
        assert_eq!(pairs[2], ("新科幻".to_string(), 1));
        // 清空后计数表为空
        repo.delete_tag("悬疑").unwrap();
        assert_eq!(repo.list_tag_counts().unwrap().len(), 2);
    }
}
