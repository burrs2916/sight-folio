use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 语料库独立数据库（corpus.db）。
///
/// 与 config.db 隔离的理由：语料索引体积可能远大于业务库（每本书数万句 + trigram 倒排），
/// 独立文件让备份/清理/整库重建互不拖累。PRAGMA 与 Database 保持同一口径。
pub struct CorpusDatabase(pub Mutex<Connection>);

impl CorpusDatabase {
    pub fn new() -> Result<Self, rusqlite::Error> {
        Self::open_at(Self::db_path())
    }

    /// 指定路径打开（测试与迁移工具用）：PRAGMA + init_schema 与 `new` 完全一致，
    /// 唯一差异是数据库文件位置——便于对旧库副本（如升级前快照）预演升级与回收。
    pub fn open_at(path: impl AsRef<Path>) -> Result<Self, rusqlite::Error> {
        let mut conn = Connection::open(path)?;
        Self::apply_pragmas(&mut conn)?;
        Self::init_schema(&conn)?;
        Ok(CorpusDatabase(Mutex::new(conn)))
    }

    /// 测试/降级用：内存库（schema 相同，FTS5 可用性随库验证）。
    pub fn open_in_memory() -> Result<Self, rusqlite::Error> {
        let mut conn = Connection::open_in_memory()?;
        Self::apply_pragmas(&mut conn)?;
        Self::init_schema(&conn)?;
        Ok(CorpusDatabase(Mutex::new(conn)))
    }

    fn db_path() -> PathBuf {
        // 与 Database::app_data_dir 同落点（data/ 下），避免重复实现——直接复用。
        super::connection::app_data_dir().join("corpus.db")
    }

    fn apply_pragmas(conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             -- 页缓存 64MB（-KiB）：单书导入可一次承载数万句 + trigram 倒排，
             -- 避免大书入库时频繁页交换。WAL 下写事务受益明显，代价是常驻内存上限提升。
             PRAGMA cache_size=-65536;",
        )?;
        Ok(())
    }

    /// 建表（幂等，只 CREATE——migration 铁律）。
    ///
    /// FTS5 采用 external content（content='corpus_chunks'）+ 触发器同步：
    /// 索引不重复存正文，删句/改句由触发器自动维护倒排。
    /// tokenizer 用 trigram：中英双语子串检索（搜「孤独」命中「孤独感」），无需分词器。
    fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
        // 书 FTS 表是否已存在：新建时才需回填存量书行（rebuild 从 content 表重建，成本与书量级正比）。
        let books_fts_exists: bool = {
            let mut stmt = conn.prepare(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='corpus_books_fts'",
            )?;
            let n: i64 = stmt.query_row([], |r| r.get(0))?;
            n > 0
        };
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS corpus_books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL DEFAULT '',
                language TEXT NOT NULL DEFAULT 'zh',
                source TEXT NOT NULL DEFAULT 'txt',
                source_path TEXT NOT NULL DEFAULT '',
                content_hash TEXT NOT NULL DEFAULT '',
                simhash INTEGER NOT NULL DEFAULT 0,
                word_count INTEGER NOT NULL DEFAULT 0,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS corpus_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL REFERENCES corpus_books(id) ON DELETE CASCADE,
                seq INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'sentence',
                content TEXT NOT NULL,
                chapter_title TEXT NOT NULL DEFAULT '',
                norm_hash INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_corpus_chunks_book ON corpus_chunks(book_id, seq);
            CREATE TABLE IF NOT EXISTS corpus_book_sources (
                book_id INTEGER PRIMARY KEY REFERENCES corpus_books(id) ON DELETE CASCADE,
                source TEXT NOT NULL DEFAULT 'txt',
                raw_text TEXT NOT NULL,
                stored_at INTEGER NOT NULL DEFAULT 0
            );
            -- 标签体系（P0-3）：一书可打多标签，一对多；与 corpus_books.category 单值列兼容——
            -- category 列保留（检索 LIKE 仍可命中旧值），标签写读走本表，读时标签表优先。
            CREATE TABLE IF NOT EXISTS corpus_book_tags (
                book_id INTEGER NOT NULL REFERENCES corpus_books(id) ON DELETE CASCADE,
                tag TEXT NOT NULL,
                PRIMARY KEY (book_id, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_corpus_book_tags_tag ON corpus_book_tags(tag);
            CREATE VIRTUAL TABLE IF NOT EXISTS corpus_fts USING fts5(
                content,
                content='corpus_chunks',
                content_rowid='id',
                tokenize='trigram'
            );
            CREATE TRIGGER IF NOT EXISTS corpus_chunks_ai AFTER INSERT ON corpus_chunks BEGIN
                INSERT INTO corpus_fts(rowid, content) VALUES (new.id, new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS corpus_chunks_ad AFTER DELETE ON corpus_chunks BEGIN
                INSERT INTO corpus_fts(corpus_fts, rowid, content) VALUES ('delete', old.id, old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS corpus_chunks_au AFTER UPDATE OF content ON corpus_chunks BEGIN
                INSERT INTO corpus_fts(corpus_fts, rowid, content) VALUES ('delete', old.id, old.content);
                INSERT INTO corpus_fts(rowid, content) VALUES (new.id, new.content);
            END;
            -- 书检索 FTS（P3：书量增长后避免书名/作者/分类 LIKE 全表扫）。
            -- trigram 与句子分支同 tokenizer：≥3 字符子串检索，与 old `%q%` LIKE 子串命中口径一致，
            -- <3 字符仍走 LIKE 回退（trigram 对 2 字符无法建索引词）。
            -- 触发器与存量回填排在下部 ALTER 之后（category 是后加列，触发器引用 new/old.category）。
            CREATE VIRTUAL TABLE IF NOT EXISTS corpus_books_fts USING fts5(
                title, author, category,
                content='corpus_books',
                content_rowid='id',
                tokenize='trigram'
            );",
        )?;
        // 旧库升级：新增列（只 ALTER 不 DROP）。新库建表已含这些列，
        // ALTER 报 duplicate column 属预期，`let _ =` 吞掉。
        for stmt in [
            // 重建索引需重读原文件
            "ALTER TABLE corpus_books ADD COLUMN source_path TEXT NOT NULL DEFAULT ''",
            // 查重指纹：内容精确指纹 + SimHash 近似指纹
            "ALTER TABLE corpus_books ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE corpus_books ADD COLUMN simhash INTEGER NOT NULL DEFAULT 0",
            // 语句级去重：句子归一化指纹（+ 索引，供 group by / 计数）
            "ALTER TABLE corpus_chunks ADD COLUMN norm_hash INTEGER NOT NULL DEFAULT 0",
            // 分类标签（导入后可编辑；检索时与书名/作者一并匹配）
            "ALTER TABLE corpus_books ADD COLUMN category TEXT NOT NULL DEFAULT ''",
        ] {
            let _ = conn.execute(stmt, []);
        }
        // ⚠️ 不变量：**引用「后加列」的语句（尤其 CREATE INDEX）绝不能放进上面的
        // execute_batch**。老库上 `CREATE TABLE IF NOT EXISTS` 是空操作，此刻新列尚不
        // 存在，批次会整体报 `no such column` → init_schema 返回 Err → setup
        // `.expect()` panic → 跨 ObjC 边界 abort（应用启动即崩）。所有依赖后加列的
        // 对象都必须排在这组 ALTER **之后**。
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_corpus_chunks_norm ON corpus_chunks(norm_hash)",
            [],
        );
        // 书 FTS 触发器（引用 category 列，故排 ALTER 之后。「只 CREATE」铁律：IF NOT EXISTS 幂等）。
        // external content 表由触发器同步增删改；存量书行在表首次创建时用 rebuild 一次性回填。
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS corpus_books_fts_ai AFTER INSERT ON corpus_books BEGIN
                INSERT INTO corpus_books_fts(rowid, title, author, category)
                VALUES (new.id, new.title, new.author, new.category);
            END;
            CREATE TRIGGER IF NOT EXISTS corpus_books_fts_ad AFTER DELETE ON corpus_books BEGIN
                INSERT INTO corpus_books_fts(corpus_books_fts, rowid, title, author, category)
                VALUES ('delete', old.id, old.title, old.author, old.category);
            END;
            CREATE TRIGGER IF NOT EXISTS corpus_books_fts_au AFTER UPDATE OF title, author, category ON corpus_books BEGIN
                INSERT INTO corpus_books_fts(corpus_books_fts, rowid, title, author, category)
                VALUES ('delete', old.id, old.title, old.author, old.category);
                INSERT INTO corpus_books_fts(rowid, title, author, category)
                VALUES (new.id, new.title, new.author, new.category);
            END;",
        )?;
        if !books_fts_exists {
            // 首次建表：把既有书行一次性灌入书 FTS（external content 的 'rebuild' 会重读 content 表）。
            conn.execute("INSERT INTO corpus_books_fts(corpus_books_fts) VALUES ('rebuild')", [])?;
        }
        Ok(())
    }
}

impl Default for CorpusDatabase {
    fn default() -> Self {
        Self::new().expect("Failed to initialize corpus database")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 旧版 schema 建表（当时全部列，不含后续 ALTER 新增列）。
    fn create_legacy_schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE corpus_books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL DEFAULT '',
                language TEXT NOT NULL DEFAULT 'zh',
                source TEXT NOT NULL DEFAULT 'txt',
                word_count INTEGER NOT NULL DEFAULT 0,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE corpus_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL REFERENCES corpus_books(id) ON DELETE CASCADE,
                seq INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'sentence',
                content TEXT NOT NULL,
                chapter_title TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX idx_corpus_chunks_book ON corpus_chunks(book_id, seq);",
        )
        .unwrap();
    }

    fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        let names = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        names.iter().any(|n| n == column)
    }

    /// 回归（曾导致应用**启动即崩溃**）：老 corpus.db 升级到当前 schema 必须成功。
    ///
    /// 旧 bug：`CREATE INDEX ... ON corpus_chunks(norm_hash)` 与建表**同批**执行；
    /// 老库上 `CREATE TABLE IF NOT EXISTS` 是空操作、`norm_hash` 此刻不存在 →
    /// 批次整体报 `no such column: norm_hash` → init_schema 返回 Err →
    /// lib.rs setup 的 `.expect()` panic → 跨 ObjC 边界 `panic_cannot_unwind` → abort。
    #[test]
    fn init_schema_upgrades_legacy_db_without_new_columns() {
        let conn = Connection::open_in_memory().unwrap();
        create_legacy_schema(&conn);
        // 前提成立：老库确实没有新列
        assert!(!has_column(&conn, "corpus_chunks", "norm_hash"));
        assert!(!has_column(&conn, "corpus_books", "source_path"));
        assert!(!has_column(&conn, "corpus_books", "content_hash"));
        assert!(!has_column(&conn, "corpus_books", "simhash"));

        // 升级必须成功（旧实现此处返回 Err，进而启动崩溃）
        CorpusDatabase::init_schema(&conn).expect("legacy db upgrade must not fail");

        // 新列补齐
        for (t, c) in [
            ("corpus_chunks", "norm_hash"),
            ("corpus_books", "source_path"),
            ("corpus_books", "content_hash"),
            ("corpus_books", "simhash"),
        ] {
            assert!(has_column(&conn, t, c), "{t}.{c} should exist after upgrade");
        }
        // 新列可写（触发器/FTS 链路未被破坏；rusqlite bundled 默认 foreign_keys=ON，先插书行）
        conn.execute("INSERT INTO corpus_books (id, title) VALUES (1, 'legacy')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO corpus_chunks (book_id, seq, kind, content, chapter_title, norm_hash)
             VALUES (1, 0, 'sentence', 'x', '', 42)",
            [],
        )
        .unwrap();

        // 依赖新列的索引已建立
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_corpus_chunks_norm'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "idx_corpus_chunks_norm should exist after upgrade");
        // 书 FTS 表（external content）与三触发器升级后存在，引用 category 的触发器不失败
        let fts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='corpus_books_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts, 1, "corpus_books_fts should exist after upgrade");
        let trigs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='trigger' AND name LIKE 'corpus_books_fts_%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(trigs, 3, "book fts triggers should exist after upgrade");
    }

    /// 幂等：新库上重复 init_schema 不报错、不重复建对象。
    #[test]
    fn init_schema_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        CorpusDatabase::init_schema(&conn).expect("first init ok");
        CorpusDatabase::init_schema(&conn).expect("second init ok");
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_corpus_chunks_norm'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "index should not be duplicated");
    }
}
