use serde::{Deserialize, Serialize};

/// 作品（Sight Folio 写作域）
///
/// 一本书 = 一个独立的创作项目，对应 writing_books 表一行。
/// status: draft（写作中）/ finished（完本）/ archived（归档）
/// ID / 时间戳由前端生成后整对象落库（INSERT OR REPLACE），后端不做构造。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingBook {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub genre: String,
    /// 载体：serial（连载）/ standalone（单本）/ collection（篇目集）。
    /// 体裁×载体共同决定元素体系与布局；缺省空串 = 未指定（旧书兼容，按小说·连载渲染）。
    #[serde(default)]
    pub medium: String,
    pub status: String,
    pub cover_color: String,
    /// 日更目标（字数/天，0 = 未设）。写作统计面板展示今日进度用。
    #[serde(default)]
    pub daily_goal: i64,
    /// extra JSON 透传：全书目标（targetWords 目标总字数 / targetChapters 目标章节数 /
    /// deadline 截止日期 Unix 秒，0 = 未设）。加字段零迁移范式（与 settings/outlines 一致）。
    #[serde(default)]
    pub extra: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 创作设定（人设卡 / 世界观条目）
///
/// kind: "character"（人设卡）| "worldbuilding"（世界观条目）。
/// subtitle 对人设卡存「身份/角色」、对世界观存「分类」；extra 为 JSON 透传
/// （关系 / 时间线等扩展字段走这里，后续加字段零迁移）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingSetting {
    pub id: String,
    pub book_id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub extra: String,
    #[serde(default)]
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 每日写作快照（写作统计用）
///
/// day 为本地日期 YYYY-MM-DD；word_count 为该日结束时全书总字数。
/// 日更量 = 相邻两日差值，由前端计算（后端不存增量，删章后口径不乱）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingDailyStat {
    pub day: String,
    pub word_count: i64,
}

/// 章节（写作基本单元）
///
/// content 存 TipTap 富文本 HTML；word_count 由前端保存时计算好写入
/// （中文字数按字符数计，后端不做分词）。sort_order 由前端在
/// 新建/移动章节后统一重排并写回，后端只按它排序读取。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingChapter {
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub content: String,
    pub sort_order: i64,
    pub word_count: i64,
    pub status: String,
    /// 卷/分组名（'' = 未分卷）。纯展示分组，不影响 sort_order 全序。
    /// 旧模型遗留字段；新结构树由 parent_id + kind 表达，volume 仅作后兼容保留。
    #[serde(default)]
    pub volume: String,
    /// 结构树父节点 id（NULL / '' = 根）。创作者自定义的任意层级都由它串成树。
    #[serde(default)]
    pub parent_id: Option<String>,
    /// 层级名（创作者自填：部/卷/章/节/幕/场/回/篇…，系统不预定义、不强制一致）。
    #[serde(default)]
    pub kind: String,
    /// 章头图等 P2 扩展存这里（JSON 透传，加字段零迁移）。
    /// 章头图引用存 `coverImage`：`assets/writing/illustrations/<name>`（与正文插图同一相对引用模型）。
    #[serde(default)]
    pub extra: String,
    /// 章节所属剧情线（主剧情线）：规划归属，与事件级 storyline_id 互补。
    /// 事件可挂不同线，但章本身有且仅有一条主归属线（NULL = 未规划）。
    #[serde(default)]
    pub storyline_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 章节版本快照（批次④）：切章/手动时对正文做的一次存档。
///
/// origin: auto（切章时内容有变化自动存）/ manual（用户手动存）。
/// 每章只保留最近 N 份（仓储层事务内裁剪），防长篇写作把库撑爆。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingChapterSnapshot {
    pub id: String,
    pub chapter_id: String,
    pub book_id: String,
    pub content: String,
    pub word_count: i64,
    #[serde(default = "default_snapshot_origin")]
    pub origin: String,
    pub created_at: i64,
}

fn default_snapshot_origin() -> String {
    "auto".to_string()
}

/// 章内批注/便签（批次② T4）：正文选区上的批注内容，独立表持久化。
///
/// 正文 HTML 只存 `<span data-annotation-id>` 引用，批注正文（text）与选区
/// 文本快照（excerpt）都存这里——不污染正文字符流、字数统计与导出文本。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingAnnotation {
    pub id: String,
    pub chapter_id: String,
    pub book_id: String,
    pub text: String,
    #[serde(default)]
    pub excerpt: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 灵感/快速笔记（T4）：全局级、跨章、作者心流暂存。
/// chapter_id 可空（'' = 未分类/全书级）；tags 为 JSON 数组串（前端管）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingNote {
    pub id: String,
    pub book_id: String,
    #[serde(default)]
    pub chapter_id: String,
    pub content: String,
    #[serde(default)]
    pub tags: String,
    #[serde(default)]
    pub pin: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 大纲节点（结构规划，与章节可双向关联）
///
/// chapter_id 可空绑定：非 NULL 表示该节拍已落到对应章节——大纲条目点击跳章节、
/// 章节行显示节拍标记。summary 为节拍梗概（AI 上下文的大纲材料）。
/// 绑定关系无外键：删章时由前端负责把绑定该章的大纲条目解绑（置 NULL）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingOutline {
    pub id: String,
    pub book_id: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub extra: String,
    #[serde(default)]
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 时间线事件（全书级实体，Sight Folio D）
///
/// 事件既可以是某一设定的时间线（setting_id 绑定该设定），也可以是纯书级事件
/// （setting_id 为 NULL）。at/event 为时间线锚点与事件描述；chapter_id 可选绑定章节
/// （双击时间线事件卡优先跳该章）。旧版时间线落在设定卡 extra.timeline，已由 migration
/// 按确定性 ID 灌入本表（零丢失、幂等）；落库由前端持有完整对象 INSERT OR REPLACE。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingTimelineEvent {
    pub id: String,
    pub book_id: String,
    /// 绑定设定（NULL = 纯书级事件，时间线视图落在「全书」轨）。
    #[serde(default)]
    pub setting_id: Option<String>,
    pub at: String,
    pub event: String,
    #[serde(default)]
    pub chapter_id: Option<String>,
    /// 所属剧情线（NULL = 未挂线）：多线叙事维度，与 setting_id（谁）/chapter_id（在哪）正交。
    #[serde(default)]
    pub storyline_id: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 剧情线（多线叙事的「线」实体）：主线 / 支线 / 感情线…每条线有自己的配色与事件链。
/// 事件通过 writing_timeline_events.storyline_id 挂线；删线不删事件（只置 NULL，零强制）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingStoryline {
    pub id: String,
    pub book_id: String,
    pub name: String,
    /// 轨道配色（hex，如 "#ec4899"），空串 = 前端按 id 哈希兜底。
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 伏笔（「埋设 → 回收」的叙事承诺）：在某章埋下物件/台词/悬念，计划在后面的某章回收。
/// 状态三态 pending/paidoff/abandoned（待回收/已回收/已弃置）；埋设章建议必填、回收章可空（还没想好收在哪）。
/// 可选挂剧情线（storyline_id，删线置 NULL 零强制）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingForeshadowing {
    pub id: String,
    pub book_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// 埋设章（这条伏笔在哪一章出现）。
    #[serde(default)]
    pub plant_chapter_id: Option<String>,
    /// 计划回收章（可空 = 还没想好收在哪）。
    #[serde(default)]
    pub payoff_chapter_id: Option<String>,
    /// pending | paidoff | abandoned
    #[serde(default = "default_foreshadow_status")]
    pub status: String,
    #[serde(default)]
    pub storyline_id: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_foreshadow_status() -> String {
    "pending".to_string()
}

/// 完结作品记录（写作台导出/备份成功后落库一条，供「完结作品」页统一管理）。
///
/// format: epub | pdf | docx | html | md | txt | backup
/// file_path 为用户选定的导出路径（不改写原文）；file_size 为用户可见规格。
/// 只存元数据、不持有源文件（原生导出写盘即完成）；删除记录不删除源文件。
/// id / created_at 由前端生成后整对象落库（INSERT OR REPLACE），后端不做构造。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedWork {
    pub id: String,
    pub book_id: String,
    pub book_title: String,
    /// epub | pdf | docx | html | md | txt | backup
    #[serde(default)]
    pub format: String,
    /// 导出产物的绝对路径
    #[serde(default)]
    pub file_path: String,
    /// 产物字节数（导出成功后由命令层 stat 回填，前端不负责计算）
    #[serde(default)]
    pub file_size: i64,
    /// 源文件是否存在（列表加载时由命令层顺带检测并回写）。true = 用户已移动/删除源文件。
    #[serde(default)]
    pub is_file_missing: bool,
    #[serde(default)]
    pub word_count: i64,
    #[serde(default)]
    pub chapter_count: i64,
    /// 导出完成时间（Unix 秒）
    pub created_at: i64,
}
