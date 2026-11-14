use serde::{Deserialize, Serialize};

/// 成稿版本（不可变快照头）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkVersion {
    pub id: String,
    pub book_id: String,
    pub seq: i64,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub is_final: bool,
    #[serde(default)]
    pub chapter_count: i64,
    #[serde(default)]
    pub word_count: i64,
    pub content_hash: String,
    #[serde(default = "default_schema_ver")]
    pub schema_ver: i64,
    pub locked_at: i64,
    /// 书目元数据（R2，2026-11-06）：**随版本定格** —— 一次锁定就是"一个版次"的存档，
    /// 作者名 / 出版社 / 交稿日期 / ISBN 都是**那一版**的书目事实（再版换社、改名都可能不同）。
    /// 空串一律表示"当年没录"，导出侧必须留白，不许编一个作者名或日期出来。
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub publisher: String,
    /// 完结/交稿日期：作者手填的展示串（如 `2026-11-06`）。不做日期校验、不按锁定日猜。
    #[serde(default)]
    pub completed_at: String,
    #[serde(default)]
    pub isbn: String,
}

fn default_schema_ver() -> i64 {
    1
}

/// 成稿版本的内容副本（章节快照）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkVersionChapter {
    pub version_id: String,
    pub sort_order: i64,
    #[serde(default)]
    pub src_chapter_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub word_count: i64,
    /// 章/卷各自的封面相对引用（锁定当刻从 `writing_chapters.extra.coverImage` 定格）。
    ///
    /// 为什么进快照而不是导出时现读：导出的取数死口径是「只吃 work_version_chapters」，
    /// 回读活章节等于允许「产物里的图 ≠ 锁定当版的图」。封面各自独立、绝不向上借用
    /// （见前端 `utils/writingOutline.ts` 2026-09-29 定稿），故容器（卷/篇）与内容章
    /// 都只带自己这一张，无则空串。
    #[serde(default)]
    pub cover: String,
    /// 日记条目日期（锁定当刻从 `writing_chapters.extra.entryDate` 定格，形如 'YYYY-MM-DD'）。
    ///
    /// 为什么进快照（E-4）：同封面——导出死口径是「只吃 work_version_chapters」，日记的
    /// `entryDate` 只活在 `writing_chapters.extra` 里，不随锁定定格就永远进不了产物，
    /// 导出时回读活章节又被明令禁止（脑补）。旧版未定格或本就未标日期的条目 = 空串，
    /// 导出侧如实无日期行，绝不拿它编一个日期出来（口径同 `author/isbn` 空串）。
    #[serde(default)]
    pub entry_date: String,
}

/// 导出产物记录
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtifact {
    pub id: String,
    pub version_id: String,
    pub book_id: String,
    pub format: String,
    #[serde(default = "default_spec_id")]
    pub spec_id: String,
    pub file_rel_path: String,
    #[serde(default)]
    pub file_size: i64,
    #[serde(default = "default_artifact_status")]
    pub status: String,
    #[serde(default)]
    pub error: String,
    #[serde(default = "default_artifact_origin")]
    pub origin: String,
    pub created_at: i64,
}

fn default_spec_id() -> String {
    "default".to_string()
}

/// 成品页产物视图：产物记录全部字段 + **join `writing_books` 现取的书名**。
///
/// 需求 §3 的红线「书名不冗余」在读取侧的落点：库里没有 book_title 列，
/// 界面拿到的书名只可能来自 `writing_books.title` 的实时 join，改名即刻生效。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactView {
    #[serde(flatten)]
    pub artifact: ExportArtifact,
    pub book_title: String,
}

fn default_artifact_status() -> String {
    "ready".to_string()
}

fn default_artifact_origin() -> String {
    "export".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_work_version_serde_roundtrip() {
        let v = WorkVersion {
            id: "ver_1".to_string(),
            book_id: "book_1".to_string(),
            seq: 1,
            label: "交稿版".to_string(),
            note: "修复第一章错别字".to_string(),
            is_final: true,
            chapter_count: 10,
            word_count: 35000,
            content_hash: "sha256_hash_abc".to_string(),
            schema_ver: 1,
            locked_at: 1730600000,
            author: "某某".to_string(),
            publisher: "某出版社".to_string(),
            completed_at: "2026-11-06".to_string(),
            isbn: "978-7-000-00000-0".to_string(),
        };
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains("\"isFinal\":true"));
        assert!(json.contains("\"chapterCount\":10"));
        assert!(json.contains("\"wordCount\":35000"));
        assert!(json.contains("\"contentHash\":\"sha256_hash_abc\""));

        let de: WorkVersion = serde_json::from_str(&json).unwrap();
        assert_eq!(de, v);
    }

    #[test]
    fn test_work_version_chapter_serde_roundtrip() {
        let c = WorkVersionChapter {
            version_id: "ver_1".to_string(),
            sort_order: 1,
            src_chapter_id: "chap_101".to_string(),
            title: "第一章 风起".to_string(),
            content: "<p>起风了</p>".to_string(),
            kind: "章".to_string(),
            parent_id: Some("vol_1".to_string()),
            status: "finished".to_string(),
            word_count: 3500,
            cover: "assets/writing/illustrations/ch101.png".to_string(),
            entry_date: String::new(),
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"srcChapterId\":\"chap_101\""));
        assert!(json.contains("\"parentId\":\"vol_1\""));

        let de: WorkVersionChapter = serde_json::from_str(&json).unwrap();
        assert_eq!(de, c);
    }

    #[test]
    fn test_export_artifact_serde_roundtrip() {
        let a = ExportArtifact {
            id: "art_1".to_string(),
            version_id: "ver_1".to_string(),
            book_id: "book_1".to_string(),
            format: "epub".to_string(),
            spec_id: "default".to_string(),
            file_rel_path: "book_1/v1/书名-v1.epub".to_string(),
            file_size: 102400,
            status: "ready".to_string(),
            error: "".to_string(),
            origin: "export".to_string(),
            created_at: 1730601000,
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"fileRelPath\":\"book_1/v1/书名-v1.epub\""));
        assert!(json.contains("\"fileSize\":102400"));

        let de: ExportArtifact = serde_json::from_str(&json).unwrap();
        assert_eq!(de, a);
    }

    #[test]
    fn test_artifact_view_flattens_artifact_and_carries_join_title() {
        let view = ArtifactView {
            artifact: ExportArtifact {
                id: "art_1".to_string(),
                version_id: "ver_1".to_string(),
                book_id: "book_1".to_string(),
                format: "epub".to_string(),
                spec_id: "default".to_string(),
                file_rel_path: "book_1/v1/书名-v1.epub".to_string(),
                file_size: 1024,
                status: "ready".to_string(),
                error: String::new(),
                origin: "export".to_string(),
                created_at: 1730601000,
            },
            book_title: "改过的新书名".to_string(),
        };
        let json = serde_json::to_string(&view).unwrap();
        // flatten：产物字段直接铺平，前端不必再解一层嵌套
        assert!(json.contains("\"bookTitle\":\"改过的新书名\""));
        assert!(json.contains("\"fileRelPath\":\"book_1/v1/书名-v1.epub\""));
        assert!(!json.contains("\"artifact\":"));
    }
}

/// 版本定格资产（R4，2026-11-06）：锁定当刻从素材库读到的图片字节。
///
/// 为什么需要它：正文与封面存的都是**相对引用**（`assets/writing/illustrations/x.png`），
/// 作者事后删图或换图，旧版本再导出就会缺图 / 图文错位 —— 那"不可变版本"是假的。
/// 定格 = 把引用背后的字节一起锁进库，产物只认定格件。
///
/// `missing = true` 是墓碑行：锁定当刻该图就不存在。不许静默跳过（那是把缺陷藏进数据），
/// 也不许因此卡住作者的锁定；缺图在**导出**时以任务失败 + 点名的形式浮出来。
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub struct VersionAsset {
    pub version_id: String,
    /// 相对引用（与正文 `data-asset` / `cover` 里那个串逐字相同，是主键的一部分）
    pub rel_path: String,
    /// 如 `image/png`（定格当刻按扩展名判定，导出侧不再猜）
    pub media_type: String,
    /// 图片字节；`missing` 时为空
    pub bytes: Vec<u8>,
    pub missing: bool,
}
