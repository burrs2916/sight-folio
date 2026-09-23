use crate::domain::corpus::{
    fingerprint, CorpusBook, CorpusChunk, CorpusHitOccurrence, CorpusSearchHit, SentenceDupGroup,
};use crate::error::{AppError, AppResult};
use crate::infrastructure::database::CorpusDatabase;
use rusqlite::params;

/// 语料库仓储（Sight Folio「语料库」）。
///
/// 铁律：row mapper 一律按列名读取（row.get("col")），禁用位置索引。
/// 检索双通道：查询 ≥3 字符走 FTS5 MATCH（trigram + BM25 排序），
/// <3 字符（中文双字词居多）走 LIKE 回退（trigram 表对 LIKE 亦有索引加速，2 字退化为顺序扫，本地量级可接受）。
pub trait CorpusRepository: Send + Sync {
    /// 导入一本书：事务内插 book + 全部 chunks（FTS 触发器自动建倒排）。返回书籍行。
    /// `source_path` 记录源文件路径，供后续「重建索引」重读原文。
    fn import_book(
        &self,
        title: &str,
        author: &str,
        language: &str,
        source: &str,
        source_path: &str,
        chunks: &[(String, String, String)], // (kind, content, chapter_title)
    ) -> AppResult<CorpusBook>;
    fn list_books(&self) -> AppResult<Vec<CorpusBook>>;
    /// 读取单本书（重建索引时据 source / source_path 重读原文件）。
    fn get_book(&self, id: i64) -> AppResult<CorpusBook>;
    /// 编辑元数据（书名/作者/语言/分类）。**专用 UPDATE 只碰这四列**——绝不整行覆写，
    /// 不碰指纹/统计/来源列（与 rename_writing_chapter 同款纪律）。
    fn update_book_meta(
        &self,
        id: i64,
        title: &str,
        author: &str,
        language: &str,
        category: &str,
    ) -> AppResult<CorpusBook>;
    /// 书名/作者/分类 LIKE 检索（书量级为几十本，顺序扫 <1ms，无需倒排）。
    /// `query` 由调用方传入**已转义**的 LIKE 模式（与句子分支同口径）。
    fn search_books(&self, like_pattern: &str, limit: i64) -> AppResult<Vec<CorpusBook>>;
    /// 用新切分的 chunks 整体替换某本书的索引（事务：删旧 chunks→插新→更新统计）。
    /// 旧 chunks 删除由 FTS 触发器同步清倒排，不会残留孤儿索引。
    fn replace_book_chunks(
        &self,
        book_id: i64,
        source: &str,
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
    })
}

/// corpus_books 读取列（按列名，禁位置索引）。
const BOOK_COLS: &str = "id, title, author, language, source, category, source_path, content_hash, \
                         simhash, word_count, chunk_count, created_at";

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
fn book_fingerprints(chunks: &[(String, String, String)]) -> (String, i64) {
    let mut full = String::new();
    for (_, content, _) in chunks {
        full.push_str(content);
        full.push('\n');
    }
    (
        fingerprint::content_fingerprint(&full),
        fingerprint::simhash64(&full),
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
/// 逐句写入归一化指纹，供「重复语句」统计。
fn insert_chunks(
    tx: &rusqlite::Transaction<'_>,
    book_id: i64,
    chunks: &[(String, String, String)],
) -> AppResult<()> {
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
    }
    Ok(())
}

impl CorpusRepository for SqliteCorpusRepository {
    fn import_book(
        &self,
        title: &str,
        author: &str,
        language: &str,
        source: &str,
        source_path: &str,
        chunks: &[(String, String, String)],
    ) -> AppResult<CorpusBook> {
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now().timestamp();
        let (content_hash, simhash) = book_fingerprints(chunks);
        let word_count = total_words(chunks);
        tx.execute(
            "INSERT INTO corpus_books
                (title, author, language, source, source_path, content_hash, simhash, word_count, chunk_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                title,
                author,
                language,
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
        insert_chunks(&tx, book_id, chunks)?;
        tx.commit()?;
        Ok(CorpusBook {
            id: book_id,
            title: title.to_string(),
            author: author.to_string(),
            language: language.to_string(),
            source: source.to_string(),
            // 导入时尚无分类，默认未分类（导入后可在书卡编辑）
            category: String::new(),
            source_path: source_path.to_string(),
            content_hash,
            simhash,
            word_count,
            chunk_count: chunks.len() as i64,
            created_at: now,
        })
    }

    fn list_books(&self) -> AppResult<Vec<CorpusBook>> {
        let conn = self.db.0.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {BOOK_COLS} FROM corpus_books ORDER BY created_at DESC, id DESC"
        ))?;
        let rows = stmt
            .query_map([], row_to_book)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn get_book(&self, id: i64) -> AppResult<CorpusBook> {
        let conn = self.db.0.lock().unwrap();
        conn.query_row(
            &format!("SELECT {BOOK_COLS} FROM corpus_books WHERE id = ?1"),
            params![id],
            row_to_book,
        )
        .map_err(|e| AppError::Database(e.to_string()))
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
        let n = {
            let conn = self.db.0.lock().unwrap();
            conn.execute(
                "UPDATE corpus_books
                 SET title = ?2, author = ?3, language = ?4, category = ?5
                 WHERE id = ?1",
                params![id, title, author.trim(), language, category.trim()],
            )?
        };
        if n == 0 {
            return Err(AppError::NotFound(format!("corpus book {id} not found")));
        }
        // 注意：锁已先行释放（guard 在块尾 drop），此处再取锁读回全行，避免同线程重入死锁
        self.get_book(id)
    }

    fn search_books(&self, like_pattern: &str, limit: i64) -> AppResult<Vec<CorpusBook>> {
        let conn = self.db.0.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {BOOK_COLS} FROM corpus_books
             WHERE title LIKE ?1 ESCAPE '\\'
                OR author LIKE ?1 ESCAPE '\\'
                OR category LIKE ?1 ESCAPE '\\'
             ORDER BY created_at DESC, id DESC
             LIMIT ?2"
        ))?;
        let rows = stmt
            .query_map(params![like_pattern, limit], row_to_book)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn replace_book_chunks(
        &self,
        book_id: i64,
        source: &str,
        chunks: &[(String, String, String)],
    ) -> AppResult<()> {
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        // 删旧 chunks（触发器同步清 FTS 倒排）→ 插新 → 刷新统计/来源/指纹
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
        tx.commit()?;
        Ok(())
    }

    fn delete_book(&self, id: i64) -> AppResult<()> {
        let conn = self.db.0.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        // 显式删 chunks（触发器同步清 FTS 倒排），再删书行
        tx.execute("DELETE FROM corpus_chunks WHERE book_id = ?1", params![id])?;
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
        repo.import_book("测试书", "作者甲", "zh", "txt", "/tmp/测试书.txt", &parsed)
            .expect("import ok")
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

    /// 按书过滤：只返回指定书的命中。
    #[test]
    fn search_filters_by_book() {
        let repo = make_repo();
        let b1 = import_sample(&repo);
        let other: Vec<(String, String, String)> = parse_text(" completely unrelated prose about rivers.")
            .into_iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let b2 = repo.import_book("第二本", "乙", "en", "txt", "", &other).unwrap();
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
        repo.replace_book_chunks(book.id, "epub", &parsed).unwrap();
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
            .import_book("同内容另存", "作者甲", "zh", "epub", "/tmp/b.epub", &parsed)
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
        repo.replace_book_chunks(book.id, "txt", &parsed).unwrap();
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
            repo.import_book(title, "", "zh", "txt", "", &chunks).unwrap()
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
        let shared = "孤独是宿命。";
        let mk = |title: &str, extra: &str| {
            let text = format!("第一章\n\n{shared}\n\n{extra}");
            let parsed: Vec<(String, String, String)> = parse_text(&text)
                .iter()
                .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
                .collect();
            repo.import_book(title, "", "zh", "txt", "", &parsed).unwrap()
        };
        mk("甲书", "山风很大。");
        mk("乙书", "星空之下。");
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
        let shared = "山风很大。";
        let mk = |title: &str, extra: &str| {
            repo.import_book(
                title,
                "",
                "zh",
                "txt",
                "",
                &tuples(&format!("第一章\n\n{shared}\n\n{extra}")),
            )
            .unwrap()
        };
        mk("甲书", "独自前行。");
        mk("乙书", "星空之下。");

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
        let shared = "孤独是宿命。";
        let ba = repo
            .import_book(
                "甲书",
                "",
                "zh",
                "txt",
                "",
                &tuples(&format!("第一章\n\n{shared}\n\n中段。\n\n{shared}")),
            )
            .unwrap();
        repo.import_book("乙书", "", "zh", "txt", "", &tuples(&format!("第一章\n\n{shared}")))
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
            repo.import_book(t, "", "zh", "txt", "", &tuples("第一章\n\n正文一句。"))
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

    /// 书名/作者/分类 LIKE 检索（转义模式由调用方传入，与句子分支同口径）。
    #[test]
    fn search_books_matches_title_author_category() {
        let repo = make_repo();
        import_sample(&repo);
        repo.update_book_meta(1, "测试书", "作者甲", "zh", "武侠玄幻")
            .unwrap();
        // 按分类命中
        let books = repo.search_books("%玄幻%", 10).unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].id, 1);
        assert_eq!(books[0].category, "武侠玄幻");
        // 按书名命中；无命中返回空；limit 生效
        assert_eq!(repo.search_books("%测试书%", 10).unwrap().len(), 1);
        assert!(repo.search_books("%不存在的书%", 10).unwrap().is_empty());
        assert!(repo.search_books("%测试%", 0).unwrap().is_empty());
    }
}
