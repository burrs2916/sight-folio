//! 成稿版本用例（完结作品重设计 B1）。
//!
//! 这里是规则所在：内容指纹、序号递增、同指纹拦截、正稿唯一。仓储层
//! （`infrastructure::database::work_version_repository`）只做原子读写，不判业务。
//!
//! 一个刻意的设计：**锁定从库里的落盘态取数，不接受前端把正文传上来**。
//! 前端（B2）的职责是先用既有 getFreshChapters 把未保存改动冲干净，再调本命令。
//! 这样「锁进版本的正文」与「数据库里的正文」恒等，不会出现前端内存态与库态二义性。

/// 作品库根目录（B3）：默认根、读取即建目录、换根校验与落库口径都在子模块。
pub mod library_root;

use crate::application::writing::is_chapter_soft_deleted;
use crate::domain::writing::WritingChapter;
use crate::domain::work_version::{WorkVersion, WorkVersionChapter};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::work_version_repository::WorkVersionRepository;
use crate::infrastructure::database::writing_repository::WritingRepository;
use crate::infrastructure::database::{SqliteWorkVersionRepository, SqliteWritingRepository};
use std::sync::Arc;

/// 快照内部结构版本。将来正文档格式（TipTap HTML 约定）演进时，读取侧按此分支兼容渲染。
pub const SNAPSHOT_SCHEMA_VER: i64 = 1;

/// 同指纹拦截错误的机读前缀（B2 前端「仍然锁定」出口据此判冲突，与中文文案解耦）。
pub const SAME_CONTENT_PREFIX: &str = "SAME_CONTENT|";

const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// FNV-1a 64 位。沿用本仓库既有口径（`commands/project_scan.rs`、`domain/corpus/fingerprint.rs`），
/// 不为此新增 sha2 依赖：它只承担「内容变没变」的变更检测，不承担防篡改。
fn fnv1a_64(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .fold(FNV_OFFSET_BASIS, |acc, byte| (acc ^ (*byte as u64)).wrapping_mul(FNV_PRIME))
}

/// 写入一段「长度:内容」的定界文本。定界是必须的：裸拼接会让「标题 ab + 正文 c」与
/// 「标题 a + 正文 bc」得到同一串，两次内容不同的锁定被判成同指纹。
fn push_len_prefixed(out: &mut String, value: &str) {
    out.push_str(&value.len().to_string());
    out.push(':');
    out.push_str(value);
}

/// 快照内容指纹（16 位十六进制）。
pub fn content_fingerprint(chapters: &[WorkVersionChapter]) -> String {
    let mut canonical = String::new();
    for c in chapters {
        push_len_prefixed(&mut canonical, &c.title);
        canonical.push('|');
        push_len_prefixed(&mut canonical, &c.content);
        canonical.push('|');
        push_len_prefixed(&mut canonical, &c.kind);
        canonical.push('|');
        push_len_prefixed(&mut canonical, c.parent_id.as_deref().unwrap_or(""));
        canonical.push('|');
        push_len_prefixed(&mut canonical, &c.status);
        canonical.push('\n');
    }
    format!("{:016x}", fnv1a_64(canonical.as_bytes()))
}

/// 由当前落盘章节构造快照：**排除回收站软删章**。
///
/// 口径复用 `application::writing::is_chapter_soft_deleted`（软删时间戳藏在 extra.deletedAt，
/// 表上无列，`list_chapters` 不做过滤），与扫描/统计侧同一个判据，避免各处各抄一份。
/// `sort_order` 重排为密集序号：原值可能稀疏或重复，快照要的是可复现的线性顺序。
pub fn build_snapshot(chapters: &[WritingChapter]) -> Vec<WorkVersionChapter> {
    chapters
        .iter()
        .filter(|c| !is_chapter_soft_deleted(&c.extra))
        .enumerate()
        .map(|(idx, c)| WorkVersionChapter {
            // 版本 id 由 lock_version 统一回填（同一批共享一个版本）
            version_id: String::new(),
            sort_order: idx as i64,
            src_chapter_id: c.id.clone(),
            title: c.title.clone(),
            content: c.content.clone(),
            kind: c.kind.clone(),
            // 空串归一成 None：结构树根在库里就是 NULL，别让 '' 与 NULL 两种写法并存
            parent_id: c.parent_id.clone().filter(|p| !p.is_empty()),
            status: c.status.clone(),
            word_count: c.word_count,
        })
        .collect()
}

/// 锁定一版。返回新建的版本头。
pub fn lock_version(
    book_id: &str,
    label: &str,
    note: &str,
    is_final: bool,
    force: bool,
    writing_repo: &Arc<SqliteWritingRepository>,
    version_repo: &Arc<SqliteWorkVersionRepository>,
) -> AppResult<WorkVersion> {
    let chapters = writing_repo.list_chapters(book_id)?;
    let mut snapshot = build_snapshot(&chapters);
    if snapshot.is_empty() {
        return Err(AppError::Validation(
            "这本书没有可锁定的章节（正文为空，或全部在回收站）".to_string(),
        ));
    }

    let hash = content_fingerprint(&snapshot);
    if !force {
        if let Some(latest) = version_repo.latest_version(book_id)? {
            if latest.content_hash == hash {
                // SAME_CONTENT| 前缀是给前端机读的（B2「仍然锁定」出口据此区分本冲突
                // 与普通失败）；中文部分是给人读的。前端不许按中文字面判断。
                return Err(AppError::Validation(format!(
                    "{SAME_CONTENT_PREFIX}内容与 v{} 完全一致，没有可锁定的变化。确实要再留一版，请勾选「仍然锁定」。",
                    latest.seq
                )));
            }
        }
    }

    let seq = version_repo.max_seq(book_id)? + 1;
    let version_id = format!("ver_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
    for chapter in snapshot.iter_mut() {
        chapter.version_id = version_id.clone();
    }
    let word_count = snapshot.iter().map(|c| c.word_count).sum();

    let version = WorkVersion {
        id: version_id,
        book_id: book_id.to_string(),
        seq,
        label: label.to_string(),
        note: note.to_string(),
        is_final,
        chapter_count: snapshot.len() as i64,
        word_count,
        content_hash: hash,
        schema_ver: SNAPSHOT_SCHEMA_VER,
        locked_at: chrono::Utc::now().timestamp(),
    };
    version_repo.insert_version(&version, &snapshot)?;
    Ok(version)
}

/// 换正稿（全书唯一，库上另有部分唯一索引兜底）。
pub fn set_final_version(
    book_id: &str,
    version_id: &str,
    version_repo: &Arc<SqliteWorkVersionRepository>,
) -> AppResult<()> {
    version_repo.set_final_version(book_id, version_id)
}

/// 删版本，返回被连带抹掉的产物相对路径（磁盘文件删不删由上层按用户勾选决定）。
pub fn delete_work_version(
    version_id: &str,
    version_repo: &Arc<SqliteWorkVersionRepository>,
) -> AppResult<Vec<String>> {
    version_repo.delete_version(version_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::writing::WritingBook;
    use crate::infrastructure::database::{init_tables, migrate, Database};
    use rusqlite::Connection;
    use std::sync::Mutex;

    struct Harness {
        db: Arc<Database>,
        writing: Arc<SqliteWritingRepository>,
        versions: Arc<SqliteWorkVersionRepository>,
    }

    /// 建库走**生产同一套** init_tables + migrate：测试里手抄 schema 会得到假的绿。
    fn harness() -> Harness {
        let db = Arc::new(Database(Mutex::new(Connection::open_in_memory().unwrap())));
        {
            let conn = db.0.lock().unwrap();
            init_tables(&conn).unwrap();
            migrate(&conn).unwrap();
        }
        Harness {
            writing: Arc::new(SqliteWritingRepository::new(db.clone())),
            versions: Arc::new(SqliteWorkVersionRepository::new(db.clone())),
            db,
        }
    }

    fn seed_book(h: &Harness, id: &str) {
        h.writing
            .save_book(&WritingBook {
                id: id.to_string(),
                title: "测试长篇".to_string(),
                description: None,
                genre: String::new(),
                medium: String::new(),
                status: "ongoing".to_string(),
                cover_color: "#4A338F".to_string(),
                daily_goal: 0,
                extra: "{}".to_string(),
                created_at: 1,
                updated_at: 1,
            })
            .unwrap();
    }

    fn chapter(book_id: &str, id: &str, title: &str, content: &str, sort: i64, extra: &str) -> WritingChapter {
        WritingChapter {
            id: id.to_string(),
            book_id: book_id.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            sort_order: sort,
            word_count: content.chars().count() as i64,
            status: "finished".to_string(),
            volume: String::new(),
            parent_id: None,
            kind: "章".to_string(),
            extra: extra.to_string(),
            storyline_id: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn count_final(h: &Harness, book_id: &str) -> i64 {
        let conn = h.db.0.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM work_versions WHERE book_id = ?1 AND is_final = 1",
            [book_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn 锁定一版_序号从零起步且回收站章节不进快照() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing.save_chapter(&chapter("b1", "c1", "第一章", "正文一", 1, "{}")).unwrap();
        h.writing.save_chapter(&chapter("b1", "c2", "第二章", "正文二", 2, "{}")).unwrap();
        h.writing
            .save_chapter(&chapter("b1", "c3", "废稿", "进回收站了", 3, r#"{"deletedAt":1700000000}"#))
            .unwrap();

        let v = lock_version("b1", "试读版", "", false, false, &h.writing, &h.versions).unwrap();

        assert_eq!(v.seq, 1);
        assert_eq!(v.chapter_count, 2, "回收站里的章不该被锁进成稿");
        let snap = h.versions.list_version_chapters(&v.id).unwrap();
        assert_eq!(snap.len(), 2);
        assert_eq!(snap[0].sort_order, 0, "快照序号重排为密集序，保证可复现的线性顺序");
        assert!(snap.iter().all(|c| c.src_chapter_id != "c3"));
    }

    #[test]
    fn 内容没变时拒绝锁定_force_可放行() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing.save_chapter(&chapter("b1", "c1", "第一章", "正文", 1, "{}")).unwrap();
        lock_version("b1", "v1", "", false, false, &h.writing, &h.versions).unwrap();

        let again = lock_version("b1", "v2", "", false, false, &h.writing, &h.versions);
        match again {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("完全一致"), "提示要点明是哪一版：{msg}");
                assert!(
                    msg.contains(SAME_CONTENT_PREFIX),
                    "前端靠机读前缀判冲突，消息必须带 {SAME_CONTENT_PREFIX}：{msg}"
                );
            }
            other => panic!("同内容重复锁定应被拦下，实际 {other:?}"),
        }

        let forced = lock_version("b1", "v2", "仍然留痕", false, true, &h.writing, &h.versions).unwrap();
        assert_eq!(forced.seq, 2);
    }

    #[test]
    fn 改过正文后指纹变化_可正常锁新版() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing.save_chapter(&chapter("b1", "c1", "第一章", "初稿", 1, "{}")).unwrap();
        let v1 = lock_version("b1", "", "", false, false, &h.writing, &h.versions).unwrap();

        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "改稿后的正文", 1, "{}"))
            .unwrap();
        let v2 = lock_version("b1", "交稿版", "", true, false, &h.writing, &h.versions).unwrap();

        assert_eq!(v2.seq, 2);
        assert_ne!(v1.content_hash, v2.content_hash);
        // 不可变：旧版本读回来仍是锁定那一刻的字
        let old = h.versions.list_version_chapters(&v1.id).unwrap();
        assert_eq!(old[0].content, "初稿");
    }

    #[test]
    fn 正稿全书唯一_换正稿不出现两个或零个() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing.save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}")).unwrap();
        let v1 = lock_version("b1", "", "", true, false, &h.writing, &h.versions).unwrap();
        assert_eq!(count_final(&h, "b1"), 1);

        h.writing.save_chapter(&chapter("b1", "c1", "第一章", "b", 1, "{}")).unwrap();
        let v2 = lock_version("b1", "", "", true, false, &h.writing, &h.versions).unwrap();

        assert_eq!(count_final(&h, "b1"), 1, "换正稿必须原子：不能同时存在两个正稿");
        let versions = h.versions.list_versions("b1").unwrap();
        let final_one = versions.iter().find(|v| v.is_final).unwrap();
        assert_eq!(final_one.id, v2.id);
        assert!(!versions.iter().find(|v| v.id == v1.id).unwrap().is_final);
    }

    #[test]
    fn 换正稿拒绝跨书指派() {
        let h = harness();
        seed_book(&h, "b1");
        seed_book(&h, "b2");
        h.writing.save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}")).unwrap();
        let v1 = lock_version("b1", "", "", false, false, &h.writing, &h.versions).unwrap();

        // b2 名下没有这个版本 —— 宁可报错，也不能静默把 b1 的正稿改掉或什么都不做
        let err = set_final_version("b2", &v1.id, &h.versions);
        assert!(matches!(err, Err(AppError::NotFound(_))), "实际 {err:?}");
        assert_eq!(count_final(&h, "b2"), 0);
    }

    #[test]
    fn 删版本连带抹快照与产物记录并回传相对路径() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing.save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}")).unwrap();
        let v = lock_version("b1", "", "", false, false, &h.writing, &h.versions).unwrap();
        {
            let conn = h.db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO export_artifacts (id, version_id, book_id, format, file_rel_path, created_at)
                 VALUES ('art_1', ?1, 'b1', 'epub', 'b1/v1/测试长篇-v1.epub', 1)",
                [&v.id],
            )
            .unwrap();
        }

        let rel_paths = delete_work_version(&v.id, &h.versions).unwrap();

        assert_eq!(rel_paths, vec!["b1/v1/测试长篇-v1.epub".to_string()]);
        assert!(h.versions.list_version_chapters(&v.id).unwrap().is_empty());
        assert!(h.versions.find_version(&v.id).unwrap().is_none());
        let conn = h.db.0.lock().unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM export_artifacts WHERE version_id = ?1", [&v.id], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "版本没了还留着产物记录，成品页就会出现指向空气的幽灵条目");
    }

    #[test]
    fn 指纹对边界漂移敏感_不靠长度前缀就会误判无变化() {
        let mk = |pairs: [(&str, &str); 2]| -> Vec<WorkVersionChapter> {
            pairs
                .iter()
                .enumerate()
                .map(|(idx, (title, content))| WorkVersionChapter {
                    version_id: "v".to_string(),
                    sort_order: idx as i64,
                    src_chapter_id: format!("c{idx}"),
                    title: title.to_string(),
                    content: content.to_string(),
                    kind: String::new(),
                    parent_id: None,
                    status: String::new(),
                    word_count: 0,
                })
                .collect()
        };
        // 拼接后字符完全相同，但章节切分不同：没有长度前缀就会被算成同一指纹
        let a = content_fingerprint(&mk([("ab", "c"), ("", "")]));
        let b = content_fingerprint(&mk([("a", "bc"), ("", "")]));
        assert_ne!(a, b);
    }
}
