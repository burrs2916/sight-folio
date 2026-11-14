//! 成稿版本用例（完结作品重设计 B1）。
//!
//! 这里是规则所在：内容指纹、序号递增、同指纹拦截、正稿唯一。仓储层
//! （`infrastructure::database::work_version_repository`）只做原子读写，不判业务。
//!
//! 一个刻意的设计：**锁定从库里的落盘态取数，不接受前端把正文传上来**。
//! 前端（B2）的职责是先用既有 getFreshChapters 把未保存改动冲干净，再调本命令。
//! 这样「锁进版本的正文」与「数据库里的正文」恒等，不会出现前端内存态与库态二义性。

/// 导出任务队列（B4）：入队/领取/重试/移除、重启残留改判、并发上限 2 与快照渲染器。
pub mod export_jobs;
/// 作品库根目录（B3）：默认根、读取即建目录、换根校验与落库口径都在子模块。
pub mod library_root;

use crate::application::writing::{chapter_cover_ref, chapter_entry_date, is_chapter_soft_deleted};
use crate::domain::work_version::{VersionAsset, WorkVersion, WorkVersionChapter};
use crate::domain::writing::WritingChapter;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::work_version_repository::WorkVersionRepository;
use crate::infrastructure::database::writing_repository::WritingRepository;
use crate::infrastructure::database::{
    SqliteSettingsRepository, SqliteWorkVersionRepository, SqliteWritingRepository,
};
use std::sync::Arc;

/// 快照内部结构版本。将来正文档格式（TipTap HTML 约定）演进时，读取侧按此分支兼容渲染。
///
/// v1 → v2（2026-11-06）：明细表新增 `cover` 列（章/卷各自的封面相对引用）。
/// **v1 版本如实无图**：那一版锁定时封面没有定格，导出侧不许回读活章节脑补 ——
/// 读取侧按此值分流，产物排版说明要能如实讲清这件事。
///
/// v2 → v3（2026-11-06 R4）：新增 `version_assets` 表，锁定当刻把正文引用到的图片**字节**
/// 一并定格。v1/v2 版本没有定格件，导出回退读活资产（行为如实、可用，但作者删图后
/// 那些旧版本就导不全 —— 所以 UI 该按此值说清"这版锁定时还没定格资产"）。
pub const SNAPSHOT_SCHEMA_VER: i64 = 3;

/// 同指纹拦截错误的机读前缀（B2 前端「仍然锁定」出口据此判冲突，与中文文案解耦）。
pub const SAME_CONTENT_PREFIX: &str = "SAME_CONTENT|";

const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// FNV-1a 64 位。沿用本仓库既有口径（`commands/project_scan.rs`、`domain/corpus/fingerprint.rs`），
/// 不为此新增 sha2 依赖：它只承担「内容变没变」的变更检测，不承担防篡改。
fn fnv1a_64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET_BASIS, |acc, byte| {
        (acc ^ (*byte as u64)).wrapping_mul(FNV_PRIME)
    })
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
        canonical.push('|');
        // 封面进指纹（v2）：换章头图就是换内容 —— 否则「只换封面」会被 SAME_CONTENT
        // 拦成「内容与上一版一致」，作者想为封面单独留一版都锁不出来。
        push_len_prefixed(&mut canonical, &c.cover);
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
            // 封面各自独立（与前端 parseChapterCover 同口径）：只定格本节点自己的
            // extra.coverImage，绝不沿 parent_id 上溯借卷封面（借图 = 同卷千篇一律）。
            cover: chapter_cover_ref(&c.extra).unwrap_or_default(),
            // E-4：日记日期（extra.entryDate）与封面同机制随锁定定格。未标日期/旧版 = 空串，
            // 导出侧如实无日期行（绝不回读活章节脑补一个日期）。
            entry_date: chapter_entry_date(&c.extra).unwrap_or_default(),
        })
        .collect()
}

/// 锁定一版。返回新建的版本头。
/// 按扩展名给 media-type（定格时定死，导出侧不再猜；与 `writing::image_media_type` 同集合）
fn media_type_of(rel: &str) -> String {
    match rel.rsplit('.').next().map(|e| e.to_ascii_lowercase()) {
        Some(e) if e == "png" => "image/png",
        Some(e) if e == "jpg" || e == "jpeg" => "image/jpeg",
        Some(e) if e == "gif" => "image/gif",
        Some(e) if e == "webp" => "image/webp",
        Some(e) if e == "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// 相对引用是否可安全定格：含 `..` 或以 `/` 开头一律拒（定格不许变成读任意文件的口子）。
fn safe_asset_rel(rel: &str) -> bool {
    !rel.is_empty() && !rel.contains("..") && !rel.starts_with('/')
}

/// 单张定格上限（与 `commands/asset.rs` 的读取上限同值，防误把超大文件塞进主库）
const MAX_FREEZE_BYTES: u64 = 64 * 1024 * 1024;

/// 定格版本引用到的全部图片字节。
///
/// 引用来源两处，缺一不可：正文 `<img data-asset="…">` 与**本章/本卷自己的** `cover`
/// （封面各自独立、绝不借图，见 `chapter_cover_ref`）。
///
/// 读不到 / 越界 / 超限 **都不静默跳过，也不卡住锁定**：写一行墓碑（`missing = true`），
/// 让缺陷在导出时以「任务失败 + 点名缺哪个文件」的形式浮出来。
/// 理由是两侧都不能牺牲：作者随手删了一张图不该导致他锁不了版；
/// 但版本也绝不能把"缺图"这件事抹平。
pub fn freeze_assets(version_id: &str, snapshot: &[WorkVersionChapter]) -> Vec<VersionAsset> {
    freeze_assets_in(
        &crate::infrastructure::database::connection::app_data_dir(),
        version_id,
        snapshot,
    )
}

/// 同上，但素材根可注入 —— 单测因此能在临时目录里造真图，
/// **绝不去写用户真实的 app 数据目录**（那才是真的污染数据）。
pub fn freeze_assets_in(
    base: &std::path::Path,
    version_id: &str,
    snapshot: &[WorkVersionChapter],
) -> Vec<VersionAsset> {
    use std::collections::HashSet;

    let mut refs: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for c in snapshot {
        if !c.cover.is_empty() && seen.insert(c.cover.clone()) {
            refs.push(c.cover.clone());
        }
        for rel in crate::application::writing::extract_data_asset_refs(&c.content) {
            if seen.insert(rel.clone()) {
                refs.push(rel);
            }
        }
    }
    // 稳定顺序：定格清单可比对、可复现，测试也不依赖 HashMap 的随机序
    refs.sort();

    refs.into_iter()
        .map(|rel| {
            let media_type = media_type_of(&rel);
            let frozen = if safe_asset_rel(&rel) {
                std::fs::metadata(base.join(&rel))
                    .ok()
                    .filter(|m| m.is_file() && m.len() <= MAX_FREEZE_BYTES)
                    .and_then(|_| std::fs::read(base.join(&rel)).ok())
            } else {
                None
            };
            match frozen {
                Some(bytes) => VersionAsset {
                    version_id: version_id.to_string(),
                    rel_path: rel,
                    media_type,
                    bytes,
                    missing: false,
                },
                None => VersionAsset {
                    version_id: version_id.to_string(),
                    rel_path: rel,
                    media_type,
                    bytes: Vec::new(),
                    missing: true,
                },
            }
        })
        .collect()
}

/// 锁定那一刻定格的**书目元数据**（R2，2026-11-06）。
///
/// 为什么单独一个结构、而不是四个平铺的 &str：`lock_version` 已有五个参数，再加四个
/// 同类型串会让调用点变成"哪个是哪个"的猜谜。结构体强制四个值成组出现。
///
/// 语义：**空 = 作者没录**。导出侧遇空必须留白 —— 不许按锁定日脑补完结日期，
/// 更不许在作者为空时填软件名（那正是本轮要修的 `dc:creator` 那类事实错误）。
#[derive(Debug, Clone, Default)]
pub struct VersionMeta {
    pub author: String,
    pub publisher: String,
    /// 完结/交稿日期：作者手填的展示串。不校验格式、不按 `locked_at` 猜。
    pub completed_at: String,
    pub isbn: String,
}

impl VersionMeta {
    /// 没有版本语义的路径（写作台「另存为」）用它：全空，别造半个空。
    pub fn none() -> Self {
        Self::default()
    }
}

pub fn lock_version(
    book_id: &str,
    label: &str,
    note: &str,
    is_final: bool,
    force: bool,
    meta: &VersionMeta,
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
        author: meta.author.clone(),
        publisher: meta.publisher.clone(),
        completed_at: meta.completed_at.clone(),
        isbn: meta.isbn.clone(),
    };
    // R4（2026-11-06）：锁定即定格。引用背后的字节随版本一起进库，
    // 作者事后删图/换图都不影响这一版重导 —— 否则「不可变版本」是假的。
    let assets = freeze_assets(&version.id, &snapshot);
    version_repo.insert_version(&version, &snapshot, &assets)?;
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

/// 删版本（§5.3）。**默认只断记录**：版本头、章节快照、产物记录同事务抹掉，
/// 磁盘文件原样保留；`delete_files = true` 是用户在二次确认里显式勾选了
/// 「同时删除作品库中的产物文件」，才去作品库根下删文件（§9-12）。
///
/// 返回**操作后磁盘上仍存在**的产物相对路径 —— UI 按它如实提示，不假装删干净。
/// （B1 时只回传路径不删文件，因为当时还没有作品库根；B3 落地后本片补齐。）
pub fn delete_work_version(
    version_id: &str,
    delete_files: bool,
    version_repo: &Arc<SqliteWorkVersionRepository>,
    settings: &SqliteSettingsRepository,
) -> AppResult<Vec<String>> {
    let rel_paths = version_repo.delete_version(version_id)?;
    if !delete_files {
        return Ok(rel_paths);
    }
    Ok(export_jobs::delete_exported_files(settings, &rel_paths))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::work_version::library_root::WORKS_LIBRARY_ROOT_KEY;
    use crate::domain::writing::WritingBook;
    use crate::infrastructure::database::{init_tables, migrate, Database};
    use rusqlite::Connection;
    use std::path::PathBuf;
    use std::sync::Mutex;

    /// 每测一个独立临时作品库根，结束即删（不碰 data/，不依赖 $HOME）。同 B4 口径。
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "sf_b7_{}_{}_{}",
                tag,
                std::process::id(),
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct Harness {
        db: Arc<Database>,
        writing: Arc<SqliteWritingRepository>,
        versions: Arc<SqliteWorkVersionRepository>,
        settings: Arc<SqliteSettingsRepository>,
        root: TempRoot,
    }

    /// 建库走**生产同一套** init_tables + migrate：测试里手抄 schema 会得到假的绿。
    /// 作品库根预置为临时目录 —— 删文件的分支与生产同一个 get_works_library_root。
    fn harness() -> Harness {
        let db = Arc::new(Database(Mutex::new(Connection::open_in_memory().unwrap())));
        {
            let conn = db.0.lock().unwrap();
            init_tables(&conn).unwrap();
            migrate(&conn).unwrap();
        }
        let settings = Arc::new(SqliteSettingsRepository::new(db.clone()));
        let root = TempRoot::new("harness");
        settings
            .set(WORKS_LIBRARY_ROOT_KEY, &root.0.to_string_lossy())
            .unwrap();
        Harness {
            writing: Arc::new(SqliteWritingRepository::new(db.clone())),
            versions: Arc::new(SqliteWorkVersionRepository::new(db.clone())),
            settings,
            root,
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

    fn chapter(
        book_id: &str,
        id: &str,
        title: &str,
        content: &str,
        sort: i64,
        extra: &str,
    ) -> WritingChapter {
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
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "正文一", 1, "{}"))
            .unwrap();
        h.writing
            .save_chapter(&chapter("b1", "c2", "第二章", "正文二", 2, "{}"))
            .unwrap();
        h.writing
            .save_chapter(&chapter(
                "b1",
                "c3",
                "废稿",
                "进回收站了",
                3,
                r#"{"deletedAt":1700000000}"#,
            ))
            .unwrap();

        let v = lock_version(
            "b1",
            "试读版",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        assert_eq!(v.seq, 1);
        assert_eq!(v.chapter_count, 2, "回收站里的章不该被锁进成稿");
        assert_eq!(
            v.word_count, 6,
            "§9-2：版本头字数=未删章节字数之和（与写作台字数栏同源口径），回收站章一个字都不许计"
        );
        let snap = h.versions.list_version_chapters(&v.id).unwrap();
        assert_eq!(snap.len(), 2);
        assert_eq!(
            snap[0].sort_order, 0,
            "快照序号重排为密集序，保证可复现的线性顺序"
        );
        assert!(snap.iter().all(|c| c.src_chapter_id != "c3"));
    }

    #[test]
    fn 内容没变时拒绝锁定_force_可放行() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "正文", 1, "{}"))
            .unwrap();
        lock_version(
            "b1",
            "v1",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        let again = lock_version(
            "b1",
            "v2",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        );
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

        let forced = lock_version(
            "b1",
            "v2",
            "仍然留痕",
            false,
            true,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();
        assert_eq!(forced.seq, 2);
    }

    #[test]
    fn 改过正文后指纹变化_可正常锁新版() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "初稿", 1, "{}"))
            .unwrap();
        let v1 = lock_version(
            "b1",
            "",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "改稿后的正文", 1, "{}"))
            .unwrap();
        let v2 = lock_version(
            "b1",
            "交稿版",
            "",
            true,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        assert_eq!(v2.seq, 2);
        assert_ne!(v1.content_hash, v2.content_hash);
        // 不可变：旧版本读回来仍是锁定那一刻的字
        let old = h.versions.list_version_chapters(&v1.id).unwrap();
        assert_eq!(old[0].content, "初稿");
    }

    #[test]
    fn 日记日期随锁定定格进快照_旧版无日期如实为空() {
        // E-4：日记 entryDate 只活在 writing_chapters.extra，不随锁定定格就永远进不了产物。
        // 走完整 lock→读回链，一次覆盖 build_snapshot 提取 + 仓储 INSERT/SELECT + 迁移列默认值。
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter(
                "b1",
                "c1",
                "今天",
                "正文",
                1,
                r#"{"entryDate":"2026-11-13"}"#,
            ))
            .unwrap();
        h.writing
            .save_chapter(&chapter("b1", "c2", "无日期条目", "正文", 2, "{}"))
            .unwrap();
        let v1 = lock_version(
            "b1",
            "",
            "",
            true,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        let rows = h.versions.list_version_chapters(&v1.id).unwrap();
        let c1 = rows.iter().find(|r| r.src_chapter_id == "c1").unwrap();
        let c2 = rows.iter().find(|r| r.src_chapter_id == "c2").unwrap();
        assert_eq!(
            c1.entry_date, "2026-11-13",
            "带 entryDate 的条目必须随锁定定格"
        );
        assert_eq!(c2.entry_date, "", "未标日期的条目如实为空，绝不编造");
    }

    #[test]
    fn 正稿全书唯一_换正稿不出现两个或零个() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}"))
            .unwrap();
        let v1 = lock_version(
            "b1",
            "",
            "",
            true,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();
        assert_eq!(count_final(&h, "b1"), 1);

        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "b", 1, "{}"))
            .unwrap();
        let v2 = lock_version(
            "b1",
            "",
            "",
            true,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        assert_eq!(
            count_final(&h, "b1"),
            1,
            "换正稿必须原子：不能同时存在两个正稿"
        );
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
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}"))
            .unwrap();
        let v1 = lock_version(
            "b1",
            "",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();

        // b2 名下没有这个版本 —— 宁可报错，也不能静默把 b1 的正稿改掉或什么都不做
        let err = set_final_version("b2", &v1.id, &h.versions);
        assert!(matches!(err, Err(AppError::NotFound(_))), "实际 {err:?}");
        assert_eq!(count_final(&h, "b2"), 0);
    }

    #[test]
    fn 删版本连带抹快照与产物记录并回传相对路径() {
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}"))
            .unwrap();
        let v = lock_version(
            "b1",
            "",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();
        {
            let conn = h.db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO export_artifacts (id, version_id, book_id, format, file_rel_path, created_at)
                 VALUES ('art_1', ?1, 'b1', 'epub', 'b1/v1/测试长篇-v1.epub', 1)",
                [&v.id],
            )
            .unwrap();
        }

        let rel_paths = delete_work_version(&v.id, false, &h.versions, &h.settings).unwrap();

        assert_eq!(rel_paths, vec!["b1/v1/测试长篇-v1.epub".to_string()]);
        assert!(h.versions.list_version_chapters(&v.id).unwrap().is_empty());
        assert!(h.versions.find_version(&v.id).unwrap().is_none());
        let conn = h.db.0.lock().unwrap();
        let left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM export_artifacts WHERE version_id = ?1",
                [&v.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            left, 0,
            "版本没了还留着产物记录，成品页就会出现指向空气的幽灵条目"
        );
    }

    /// 在临时作品库根下摆一个真实的 ready 产物（记录 + 磁盘文件都齐），返回绝对路径。
    fn seed_ready_artifact(h: &Harness, version_id: &str, rel: &str) -> PathBuf {
        let abs = h.root.0.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, b"fake-artifact-bytes").unwrap();
        let conn = h.db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO export_artifacts (id, version_id, book_id, format, status, file_rel_path, file_size, created_at)
             VALUES ('art_1', ?1, 'b1', 'epub', 'ready', ?2, 17, 1)",
            rusqlite::params![version_id, rel],
        )
        .unwrap();
        abs
    }

    #[test]
    fn 删版本未勾选删文件_记录消失但磁盘文件仍在() {
        // §9-12 前半 / §5.3 默认口径：只断记录不动文件
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}"))
            .unwrap();
        let v = lock_version(
            "b1",
            "",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();
        let file = seed_ready_artifact(&h, &v.id, "b1/v1/测试长篇-v1.epub");

        let remaining = delete_work_version(&v.id, false, &h.versions, &h.settings).unwrap();

        assert_eq!(
            remaining,
            vec!["b1/v1/测试长篇-v1.epub".to_string()],
            "未勾选时文件全部保留，返回清单供 UI 如实提示"
        );
        assert!(file.exists(), "§9-12：未勾选 → 磁盘文件必须还在");
        assert!(
            h.versions.find_version(&v.id).unwrap().is_none(),
            "记录本体要消失"
        );
    }

    #[test]
    fn 删版本勾选删文件_记录与磁盘文件都消失() {
        // §9-12 后半：显式勾选「同时删除作品库中的产物文件」→ 两者都消失
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}"))
            .unwrap();
        let v = lock_version(
            "b1",
            "",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();
        let file = seed_ready_artifact(&h, &v.id, "b1/v1/测试长篇-v1.epub");

        let remaining = delete_work_version(&v.id, true, &h.versions, &h.settings).unwrap();

        assert!(
            remaining.is_empty(),
            "勾选即承诺删净，有残留必须回传，实际 {remaining:?}"
        );
        assert!(!file.exists(), "§9-12：勾选 → 磁盘文件与记录一起消失");
        assert!(h.versions.find_version(&v.id).unwrap().is_none());
    }

    #[test]
    fn 勾选删文件但产物早被挪走_记录照删不报错且不谎报残留() {
        // 文件本就不在（missing 态/用户手动清理过）→ NotFound 视为已消失，不该拦住删版本
        let h = harness();
        seed_book(&h, "b1");
        h.writing
            .save_chapter(&chapter("b1", "c1", "第一章", "a", 1, "{}"))
            .unwrap();
        let v = lock_version(
            "b1",
            "",
            "",
            false,
            false,
            &VersionMeta::default(),
            &h.writing,
            &h.versions,
        )
        .unwrap();
        {
            let conn = h.db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO export_artifacts (id, version_id, book_id, format, status, file_rel_path, created_at)
                 VALUES ('art_1', ?1, 'b1', 'epub', 'missing', 'b1/v1/测试长篇-v1.epub', 1)",
                [&v.id],
            )
            .unwrap(); // 只留记录不摆文件
        }

        let remaining = delete_work_version(&v.id, true, &h.versions, &h.settings).unwrap();

        assert!(
            remaining.is_empty(),
            "NotFound 视为已消失，不该冒充删不掉的残留，实际 {remaining:?}"
        );
        assert!(h.versions.find_version(&v.id).unwrap().is_none());
    }

    #[test]
    fn delete_exported_files_拒绝穿越绝对与空路径_绝不碰库根外的文件() {
        // 库里存的是相对路径，但库不是可信边界：`..`/绝对/空路径一律拒拼并计入仍存在
        let h = harness();
        let victim = TempRoot::new("victim");
        std::fs::create_dir_all(victim.0.join("sub")).unwrap();
        let victim_file = victim.0.join("sub/v.txt");
        std::fs::write(&victim_file, b"do-not-touch").unwrap();

        let traversal = format!(
            "../{}/sub/v.txt",
            victim.0.file_name().unwrap().to_string_lossy()
        );
        let remaining = export_jobs::delete_exported_files(
            &h.settings,
            &[traversal.clone(), String::new(), "/etc/passwd".to_string()],
        );

        assert_eq!(
            remaining,
            vec![traversal, String::new(), "/etc/passwd".to_string()],
            "三类危险路径都必须原样回传为「仍存在」，不许静默吞掉"
        );
        assert!(victim_file.exists(), "拒拼即碰不到库外文件");
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
                    cover: String::new(),
                    entry_date: String::new(),
                })
                .collect()
        };
        // 拼接后字符完全相同，但章节切分不同：没有长度前缀就会被算成同一指纹
        let a = content_fingerprint(&mk([("ab", "c"), ("", "")]));
        let b = content_fingerprint(&mk([("a", "bc"), ("", "")]));
        assert_ne!(a, b);
    }

    // ─── R4 定格资产（2026-11-06）───────────────────────────────────

    fn snap_row(id: &str, content: &str, cover: &str) -> WorkVersionChapter {
        WorkVersionChapter {
            version_id: "v1".to_string(),
            sort_order: 0,
            src_chapter_id: id.to_string(),
            title: id.to_string(),
            content: content.to_string(),
            kind: "章".to_string(),
            parent_id: None,
            status: "draft".to_string(),
            word_count: 1,
            cover: cover.to_string(),
            entry_date: String::new(),
        }
    }

    #[test]
    fn 锁定即定格_能读到的收字节读不到的记墓碑() {
        let dir = std::env::temp_dir().join(format!("sf_freeze_{}", uuid::Uuid::new_v4().simple()));
        let img_dir = dir.join("assets/writing/illustrations");
        std::fs::create_dir_all(&img_dir).unwrap();
        let payload = b"\x89PNG fake bytes".to_vec();
        std::fs::write(img_dir.join("ok.png"), &payload).unwrap();

        // 正文引一张存在的图；本章另有一张「锁定当刻就已不存在」的封面
        let snap = vec![snap_row(
            "c1",
            r#"<p>看图</p><img data-asset="assets/writing/illustrations/ok.png" src="asset://x"/>"#,
            "assets/writing/illustrations/gone.png",
        )];
        let assets = freeze_assets_in(&dir, "v1", &snap);

        assert_eq!(assets.len(), 2, "正文图 + 封面图都要收到：{assets:?}");
        let ok = assets
            .iter()
            .find(|a| a.rel_path.ends_with("ok.png"))
            .unwrap();
        assert!(!ok.missing, "读得到就不许记墓碑");
        assert_eq!(ok.bytes, payload, "定格的是锁定当刻的字节");
        assert_eq!(
            ok.media_type, "image/png",
            "media-type 定格时定死，导出侧不再猜"
        );
        let gone = assets
            .iter()
            .find(|a| a.rel_path.ends_with("gone.png"))
            .unwrap();
        assert!(
            gone.missing,
            "读不到要留墓碑，不许静默跳过 —— 静默就是把缺陷藏进数据"
        );
        assert!(gone.bytes.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 越界引用不许被定格_也不许去读盘() {
        let dir =
            std::env::temp_dir().join(format!("sf_freezepad_{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        let snap = vec![snap_row(
            "c1",
            r#"<img data-asset="../../../../etc/passwd"/>"#,
            "",
        )];
        let assets = freeze_assets_in(&dir, "v1", &snap);
        assert_eq!(assets.len(), 1);
        assert!(
            assets[0].missing,
            "`..` 引用一律拒绝，定格不许成为读任意文件的口子"
        );
        assert!(assets[0].bytes.is_empty(), "拒绝就不该读到任何字节");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
