use serde::{Deserialize, Serialize};

/// 语料库域模型（Sight Folio「语料库」功能）。
///
/// 定位：外部参考书籍/文章的本地全文检索库——用户导入优秀作品，
/// 后端把整本切分为句子并建立 FTS5 倒排索引，写作者可按词汇/语句检索参考表达。
/// 与写作域（writing_*）完全隔离：独立 corpus.db，不与 config.db 共表。

/// 语料书（导入一本书 = 一行）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusBook {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub author: String,
    /// 语言标记：zh / en（影响检索提示文案，不影响索引——trigram 双语通用）。
    #[serde(default = "default_language")]
    pub language: String,
    /// 来源格式：txt / epub / docx / fb2 / html / mobi（按扩展名分流所得）。
    #[serde(default = "default_source")]
    pub source: String,
    /// 分类标签（导入后可编辑；检索时与书名/作者一并匹配）。空串 = 未分类。
    #[serde(default)]
    pub category: String,
    /// 导入时的本地源文件路径（重建索引时据此重读原文件；旧数据为空串）。
    #[serde(default)]
    pub source_path: String,
    /// 内容精确指纹：归一化全文的 FNV-1a 128（32 位十六进制）。空串 = 旧数据未计算。
    #[serde(default)]
    pub content_hash: String,
    /// 近似指纹：全书 SimHash 64（i64 位型）。0 = 旧数据未计算。
    #[serde(default)]
    pub simhash: i64,
    /// 全书总字数（中文字符/英文词混合口径，与 pipeline::count_words 一致）。
    #[serde(default)]
    pub word_count: i64,
    /// 句子总数（含章标题行）。
    #[serde(default)]
    pub chunk_count: i64,
    #[serde(default)]
    pub created_at: i64,
}

fn default_language() -> String {
    "zh".to_string()
}

fn default_source() -> String {
    "txt".to_string()
}

fn default_one() -> i64 {
    1
}

/// 语料句（检索单元）。导入管线把整本切分为句序列；章标题行以 kind='chapter' 保留，
/// 检索命中时可回溯「第几章的哪一句」。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusChunk {
    pub id: i64,
    pub book_id: i64,
    /// 全书内顺序号（0 起，含章标题行）。
    pub seq: i64,
    /// chapter = 章标题行；sentence = 正文句。
    pub kind: String,
    pub content: String,
    /// 该句所属章标题（章标题行自身此列为空）。
    #[serde(default)]
    pub chapter_title: String,
}

/// 检索命中（KWIC 展示单元）：句子原文 + 归属上下文。
///
/// 重复句合并在**检索时**进行（非破坏——库里数据一字不删）：同一归一化指纹的句子
/// 只出一条，其余折叠进 `occurrences`，避免同句跨书刷屏。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusSearchHit {
    pub chunk_id: i64,
    pub book_id: i64,
    pub book_title: String,
    pub seq: i64,
    pub kind: String,
    pub chapter_title: String,
    pub content: String,
    /// 该句在**本次检索范围内**的出现次数（按书过滤时即该书内次数）。未合并场景为 1。
    #[serde(default = "default_one")]
    pub occurrence_count: i64,
    /// 该句的出现位置（上限 20 条；`occurrence_count == 1` 时为空）。
    #[serde(default)]
    pub occurrences: Vec<CorpusHitOccurrence>,
}

/// 检索命中里的一条「出现位置」（重复句合并后展开用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusHitOccurrence {
    pub chunk_id: i64,
    pub book_id: i64,
    pub book_title: String,
    pub seq: i64,
    #[serde(default)]
    pub chapter_title: String,
}

/// 检索结果：书命中（书名/作者/分类匹配，置顶展示）+ 句子命中。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusSearchResult {
    /// 书名/作者/分类 LIKE 命中的书（按导入时间倒序，截断上限 10）。
    #[serde(default)]
    pub books: Vec<CorpusBook>,
    /// 正文句子命中（沿用既有排序与重复句合并）。
    pub hits: Vec<CorpusSearchHit>,
}

/// 重建索引的单本结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildItem {
    pub book_id: i64,
    pub title: String,
    /// rebuilt | skipped | failed
    pub status: String,
    /// 跳过/失败原因（rebuilt 时为空）。
    #[serde(default)]
    pub reason: String,
    /// 重建后的句子总数（仅 rebuilt 有值）。
    #[serde(default)]
    pub chunk_count: i64,
}

/// 重建索引汇总（重建后返回给前端展示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildReport {
    pub rebuilt: i64,
    pub skipped: i64,
    pub failed: i64,
    pub items: Vec<RebuildItem>,
}

/// 导入前查重的命中项（提示用，不阻断导入）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateHit {
    /// exact_path（同一文件）| exact_content（去空白全文一致）| similar（高度相似）| same_meta（同名同作者）
    pub kind: String,
    pub book_id: i64,
    pub title: String,
    /// 相似度百分比：exact_* 为 100，similar 由海明距离折算，same_meta 为 0。
    #[serde(default)]
    pub similarity: i64,
    #[serde(default)]
    pub created_at: i64,
}

/// 查重报告里的书本引用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateBookRef {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub chunk_count: i64,
    #[serde(default)]
    pub created_at: i64,
}

/// 一组重复的书。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateBookGroup {
    /// content_hash（内容完全相同）| source_path（同一文件）| simhash（高度相似）
    pub reason: String,
    /// 组内相似度（100 = 内容完全相同）。
    pub similarity: i64,
    pub books: Vec<DuplicateBookRef>,
}

/// 一组跨书重复的句子。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceDupGroup {
    /// 代表句（该指纹的首个出现）。
    pub sample: String,
    /// 出现的不同书本数。
    pub book_count: i64,
    /// 出现总次数（含同书内重复）。
    pub chunk_count: i64,
    /// 涉及的书标题（去重）。
    pub books: Vec<String>,
}

/// 全库查重报告。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReport {
    /// 内容完全相同 / 同一文件的分组。
    pub exact_groups: Vec<DuplicateBookGroup>,
    /// 高度相似的分组。
    pub similar_groups: Vec<DuplicateBookGroup>,
    /// 重复语句组（按出现次数降序，截断 Top N）。
    pub sentence_groups: Vec<SentenceDupGroup>,
    /// 重复语句组总数（可能大于 sentence_groups.len()）。
    pub sentence_group_total: i64,
    /// 参与查重的书总数。
    pub book_total: i64,
}
