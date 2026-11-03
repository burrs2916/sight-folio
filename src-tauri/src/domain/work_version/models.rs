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
}
