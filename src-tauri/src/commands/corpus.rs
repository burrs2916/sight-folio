use crate::domain::corpus::{
    fingerprint, schema, CorpusBook, CorpusSearchResult, CorpusStorageReport, DuplicateBookGroup,
    DuplicateBookRef, DuplicateHit, DuplicateReport, RebuildItem, RebuildReport,
};
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::corpus_repository::CorpusRepository;
use crate::infrastructure::database::SqliteCorpusRepository;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::{Emitter, State};
use zip::ZipArchive;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use mobi::headers::Encryption;
use mobi::Mobi;

/// 语料库命令（Sight Folio「语料库」）：导入 / 列表 / 检索 / 编辑 / 删除 / 状态探针。
///
/// 导入格式按扩展名分流：
/// - txt / text / md → 纯文本（UTF-8 优先、GBK/GB18030 自动回退）
/// - epub           → zip 解包 + 读 OPF spine 顺序 + XHTML 去标签
/// - docx           → zip 解包 + 读 word/document.xml 的 <w:t> 文本块（按 <w:p> 分段）
/// - fb2            → FictionBook 2.0 纯 XML，按块元素收集文本（跳过 description/binary/style）
/// - html / htm     → 容错剥离标签 + 反转义常见 HTML 实体（零依赖）
/// - mobi / azw3    → Kindle 格式，经 `mobi` crate 解析（No/PalmDOC/HUFF）；带 DRM 的文件不支持
///
/// 可用性（B2 降级）：语料库是可选功能，corpus.db 初始化失败**不得** abort 整个应用——
/// setup 改为注册 [`CorpusState::unavailable`]，各命令统一返回明确错误，
/// 前端经 `corpus_status` 探测后显示「语料库不可用」。
///
/// 线程模型：导入 / 重建 / 删除 / 导入前查重都是秒级阻塞工作（FTS 建索引 / 触发器清理），
/// 一律经 `spawn_blocking` 跑在阻塞线程池——同步命令默认在**主线程**执行会冻结整个窗口。

/// 语料库运行时状态：把「初始化失败」从 panic 降级为可查询的不可用状态。
///
/// 背景：`CorpusDatabase::new()` 曾用 `.expect()` 在 `setup()` 里 panic → 跨 ObjC 边界
/// `panic_cannot_unwind` → 应用启动即 SIGABRT。
#[derive(Clone)]
pub struct CorpusState {
    repo: Option<Arc<SqliteCorpusRepository>>,
    /// 初始化失败原因（就绪时为 None）。
    error: Option<String>,
    /// 维护操作互斥锁（P1-4 并发互斥）：导入 / 重建 / 删除 / 空间回收共用一把锁，
    /// 任一操作进行中时其它维护命令立即返回明确错误，避免并发写索引/删库造成的竞争。
    /// 互斥放在命令入口（而非 SQLite 层）：SQLite 已有连接级串行化，业务互斥需要的是
    /// 「整个读文件→抽取→切分→入库」事务不被并发打断。
    /// 锁内同时记录持有者（操作名 + 开始时间），供错误信息与 `corpus_maintenance_status`
    /// 查询——让用户知道是哪个维护操作在跑、已运行多久，而不是只能看到一句晦涩英文。
    maintenance_holder: Arc<Mutex<Option<MaintenanceHolder>>>,
    /// 导入前查重指纹缓存（P2-1）：以 (source_path, size, mtime) 为键缓存最近一次抽取的指纹，
    /// 命中直接走比对，避免换文件/重复选择时全量重抽；mtime 变化自动失效。
    /// 单槽即可——查重是「当前选中文件」的即时校验，旧文件指纹无保留价值。
    fingerprint_cache: Arc<Mutex<Option<FingerprintCacheEntry>>>,
}

/// 查重指纹缓存条目：键 = 文件身份三元组，值 = 抽取指纹（同 `compute_file_fingerprint` 语义，
/// 计算失败为 None 同样缓存，避免对同一坏文件反复重抽）。
struct FingerprintCacheEntry {
    path: String,
    len: u64,
    modified: SystemTime,
    fp: Option<(String, i64)>,
}

/// 维护互斥守卫：`try_begin_maintenance` 成功拿到锁后返回本守卫，
/// Drop 时自动复位 in-flight 标志（含持有者记录），保证任何提前返回路径都能释放锁。
#[derive(Debug)]
struct MaintenanceGuard(Arc<Mutex<Option<MaintenanceHolder>>>);
impl Drop for MaintenanceGuard {
    fn drop(&mut self) {
        if let Ok(mut holder) = self.0.lock() {
            *holder = None;
        }
    }
}

/// 当前维护操作持有者（互斥锁被占用时记录）：操作名 + 开始时间。
/// 用于错误信息（“是哪个操作在跑、跑了多久”）与 `corpus_maintenance_status` 查询。
#[derive(Debug)]
struct MaintenanceHolder {
    op: &'static str,
    started_at: SystemTime,
}

impl CorpusState {
    /// 就绪：仓储可用。
    pub fn ready(repo: Arc<SqliteCorpusRepository>) -> Self {
        Self {
            repo: Some(repo),
            error: None,
            maintenance_holder: Arc::new(Mutex::new(None)),
            fingerprint_cache: Arc::new(Mutex::new(None)),
        }
    }
    /// 不可用：记录失败原因（供命令层错误与前端展示）。
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            repo: None,
            error: Some(reason.into()),
            maintenance_holder: Arc::new(Mutex::new(None)),
            fingerprint_cache: Arc::new(Mutex::new(None)),
        }
    }
    pub fn is_available(&self) -> bool {
        self.repo.is_some()
    }
    /// 不可用原因文案；就绪状态返回空串（`corpus_status` 仅在不可用时展示）。
    pub fn unavailable_message(&self) -> String {
        match &self.error {
            Some(e) => format!("corpus library unavailable: {e}"),
            None => String::new(),
        }
    }
    /// 取仓储；未就绪时返回统一可读错误。
    pub fn repo(&self) -> AppResult<&Arc<SqliteCorpusRepository>> {
        self.repo.as_ref().ok_or_else(|| {
            // 兜底：error 缺失也给得出可读错误，不会出现空文案
            AppError::Internal(match &self.error {
                Some(e) => format!("corpus library unavailable: {e}"),
                None => "corpus library unavailable".to_string(),
            })
        })
    }
    /// 尝试获取维护互斥（导入 / 重建 / 删除 / 压缩互斥）。
    /// `op` 为发起方操作名（import / rebuild / delete / optimize），占用成功后写入持有者记录。
    /// 已有维护操作进行中时返回明确错误，并指明是哪个操作、已运行多久（P1-4 并发互斥）。
    pub fn try_begin_maintenance(&self, op: &'static str) -> AppResult<MaintenanceGuard> {
        let mut holder = self.maintenance_holder.lock().map_err(|e| {
            AppError::Internal(format!("maintenance lock poisoned: {e}"))
        })?;
        if holder.is_some() {
            let (holder_op, elapsed) = holder
                .as_ref()
                .map(|h| {
                    let secs = h.started_at.elapsed().map(|d| d.as_secs()).unwrap_or(0);
                    (h.op, secs)
                })
                .unwrap_or(("maintenance", 0));
            return Err(AppError::Validation(format!(
                "another corpus maintenance operation ({holder_op}) is in progress, started {elapsed}s ago (import / rebuild / delete / optimize are mutually exclusive); retry after it finishes"
            )));
        }
        *holder = Some(MaintenanceHolder {
            op,
            started_at: SystemTime::now(),
        });
        Ok(MaintenanceGuard(self.maintenance_holder.clone()))
    }
}

/// 语料库可用性（前端据此决定是否显示「不可用」横幅并禁用入口）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct CorpusStatus {
    pub available: bool,
    /// 不可用原因（可用时为空串）。
    pub error: String,
}

/// 维护操作当前状态（前端轮询/加载时对账用）：空闲时 busy=false, 其余字段为 null。
#[derive(Debug, Clone, serde::Serialize)]
pub struct CorpusMaintenanceStatus {
    pub busy: bool,
    /// 占用维护入口的操作名（import / rebuild / delete / optimize，空闲为 null）。
    pub op: Option<String>,
    /// 占用开始时间（unix 秒，空闲为 null）。
    pub started_at: Option<u64>,
    /// 已运行秒数（空闲为 null）。
    pub elapsed_secs: Option<u64>,
}

#[tauri::command]
pub fn corpus_maintenance_status(state: State<'_, CorpusState>) -> CorpusMaintenanceStatus {
    let holder = state.maintenance_holder.lock().ok();
    match holder.as_ref().and_then(|h| h.as_ref()) {
        Some(h) => {
            let started = h
                .started_at
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let elapsed = h.started_at.elapsed().map(|d| d.as_secs()).unwrap_or(0);
            CorpusMaintenanceStatus {
                busy: true,
                op: Some(h.op.to_string()),
                started_at: Some(started),
                elapsed_secs: Some(elapsed),
            }
        }
        None => CorpusMaintenanceStatus {
            busy: false,
            op: None,
            started_at: None,
            elapsed_secs: None,
        },
    }
}

#[tauri::command]
pub fn corpus_status(state: State<'_, CorpusState>) -> CorpusStatus {
    CorpusStatus {
        available: state.is_available(),
        error: if state.is_available() {
            String::new()
        } else {
            state.unavailable_message()
        },
    }
}

/// 检索置顶返回的书命中上限。书量级小，FTS 命中后按导入时间倒序截断即可。
const BOOK_MATCH_LIMIT: i64 = 10;

#[tauri::command]
pub fn list_corpus_books(
    state: State<'_, CorpusState>,
) -> AppResult<Vec<CorpusBook>> {
    state.repo()?.list_books()
}

#[tauri::command]
pub async fn delete_corpus_book(
    book_id: i64,
    state: State<'_, CorpusState>,
) -> AppResult<()> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // P1-4 并发互斥：删除与导入/重建/压缩互斥
        let _guard = state.try_begin_maintenance("delete")?;
        let repo = state.repo()?;
        repo.delete_book(book_id)
    })
    .await
    .map_err(|e| AppError::Internal(format!("delete task failed: {e}")))?
}

#[tauri::command]
pub fn update_corpus_book(
    book_id: i64,
    title: String,
    author: String,
    language: String,
    category: String,
    tags: Vec<String>,
    state: State<'_, CorpusState>,
) -> AppResult<CorpusBook> {
    // 枚举白名单校验：分类 / 标签超集值直接拒绝（枚举值即存储值，不静默改写）。
    schema::validate_category(&category)?;
    schema::validate_tags(&tags)?;
    let category = schema::merge_category_tags(&category, &tags);
    state.repo()?.update_book_meta(book_id, &title, &author, &language, &category)
}

/// 标签体系（P0-3）：以多标签集合幂等替换某书标签（先清后插，trim 去空去重）。
/// 双写同步：category 列回写为顿号连接串，保证旧检索 LIKE / 旧前端展示路径仍能命中。
#[tauri::command]
pub fn set_corpus_book_tags(
    book_id: i64,
    tags: Vec<String>,
    state: State<'_, CorpusState>,
) -> AppResult<CorpusBook> {
    // 标签白名单校验：超集值直接拒绝（枚举值即存储值，不静默改写）。
    schema::validate_tags(&tags)?;
    state.repo()?.set_book_tags(book_id, &tags)
}

/// 标签体系（P0-3）：按标签精确筛选书籍（书量级几十本，EXISTS 无倒排依赖）。
#[tauri::command]
pub fn search_corpus_books_by_tag(
    tag: String,
    state: State<'_, CorpusState>,
) -> AppResult<Vec<CorpusBook>> {
    state.repo()?.search_books_by_tag(&tag)
}

/// 标签维护（P2-2）：全库重命名标签 from → to。事务内原子完成：
/// 先以 INSERT OR IGNORE 把新标签写入受影响书（与既有 to 自然归并去重），
/// 再删除旧标签，最后同步受影响书 category 镜像。返回受影响书数。
#[tauri::command]
pub fn rename_corpus_tag(
    from: String,
    to: String,
    state: State<'_, CorpusState>,
) -> AppResult<i64> {
    // 标签白名单校验：from/to 均须为枚举值（维护命令同样不接受自定义标签）。
    schema::validate_tags(std::slice::from_ref(&from))?;
    schema::validate_tags(std::slice::from_ref(&to))?;
    state.repo()?.rename_tag(&from, &to)
}

/// 标签维护（P2-2）：多个源标签归并到目标标签（重复标签去重收敛）。
/// 事务内为每本书 INSERT OR IGNORE 目标 + DELETE 全部源标签，并同步 category 镜像。
/// 返回受影响书数。
#[tauri::command]
pub fn merge_corpus_tags(
    sources: Vec<String>,
    into: String,
    state: State<'_, CorpusState>,
) -> AppResult<i64> {
    // 标签白名单校验：sources 与 into 均须为枚举值（归并不得引入自定义标签）。
    schema::validate_tags(&sources)?;
    schema::validate_tags(std::slice::from_ref(&into))?;
    state.repo()?.merge_tags(&sources, &into)
}

/// 标签维护（P2-2）：解除所有书的指定标签并同步 category 镜像；标签不存在时幂等返回 0。
#[tauri::command]
pub fn delete_corpus_tag(
    tag: String,
    state: State<'_, CorpusState>,
) -> AppResult<i64> {
    state.repo()?.delete_tag(&tag)
}

/// 标签维护（P2-2）：全库标签书目计数列表（计数降序、同计数按标签名升序），
/// 供前端标签筛选栏展示各标签书目数与超限折叠。
#[tauri::command]
pub fn list_corpus_tag_counts(
    state: State<'_, CorpusState>,
) -> AppResult<Vec<(String, i64)>> {
    state.repo()?.list_tag_counts()
}

#[tauri::command]
pub fn search_corpus(
    query: String,
    book_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    state: State<'_, CorpusState>,
) -> AppResult<CorpusSearchResult> {
    let repo = state.repo()?;
    let q = query.trim();
    if q.is_empty() {
        return Ok(CorpusSearchResult { books: Vec::new(), hits: Vec::new() });
    }
    // 书命中：repo 内部 ≥3 字符走书 FTS、<3 字符 LIKE 回退（转义/短语包装在实现内完成）
    let books = repo.search_books(q, BOOK_MATCH_LIMIT)?;
    let hits = repo.search(
        &query,
        book_id,
        limit.unwrap_or(30).clamp(1, 200),
        offset.unwrap_or(0).max(0),
    )?;
    Ok(CorpusSearchResult { books, hits })
}

/// 导入本地书籍：读文件 → 按扩展名分流解码/抽取 → 切分 → 建索引。返回新书籍行（含统计）。
/// `category` 为导入分类（单选，可空）：空串 = 未分类；`tags` 为多选标签（0~N 项，
/// 必须命中统一枚举）。命令层做白名单校验后合并为顿号串传入仓储层（双写路径不变）。
#[tauri::command]
pub async fn import_corpus_file(
    file_path: String,
    title: String,
    author: String,
    language: String,
    category: String,
    tags: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, CorpusState>,
) -> AppResult<CorpusBook> {
    // 枚举白名单校验：分类 / 标签超集值直接拒绝（枚举值即存储值，不静默改写）。
    schema::validate_category(&category)?;
    schema::validate_tags(&tags)?;
    let category = schema::merge_category_tags(&category, &tags);
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // P1-4 并发互斥：导入与重建/删除/压缩互斥
        let _guard = state.try_begin_maintenance("import")?;
        import_blocking(&state, file_path, title, author, language, category, &app)
    })
    .await
    .map_err(|e| AppError::Internal(format!("import task failed: {e}")))?
}

/// 导入文件大小上限（字节）。超限直接拒绝，避免超大文件拖垮整条导入管线。
/// 报告建议值 200MB；纯文本语料正常远小于此，epub/docx 也在该量级内。
const MAX_IMPORT_FILE_BYTES: u64 = 200 * 1024 * 1024;

/// zip 单条目解压字节上限：防御 zip bomb（压缩比极端的畸形/恶意档案让解压内存失控）。
/// 正文每章/每 XML 64MB 已远超语料实际需要。
const MAX_ZIP_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
/// epub 全书累计解压字节上限：防多章节合计膨胀。
const MAX_ZIP_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

/// 导入阻塞体（跑在阻塞线程池）：读文件 → 抽取 → 切分 → 入库。
/// 进度透出：经 `corpus-import-progress` 事件下发阶段（reading/extracting/parsing/indexing/done）
/// 与 percent（0→100），FTS 建索引阶段按 chunk 逐句上报；前端据此渲染导入进度。
fn import_blocking(
    state: &CorpusState,
    file_path: String,
    title: String,
    author: String,
    language: String,
    category: String,
    app: &tauri::AppHandle,
) -> AppResult<CorpusBook> {
    let repo = state.repo()?;
    // 书名 fallback 提前结算：emit 闭包此后只借用 title，不再与后续 move 冲突
    let fallback_title = Path::new(&file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let title = if title.trim().is_empty() { fallback_title } else { title };
    let emit_phase = |phase: &str, percent: u32, done: Option<usize>, total: Option<usize>| {
        let mut payload = serde_json::json!({
            "phase": phase,
            "percent": percent,
            "title": title,
        });
        if let Some(d) = done {
            payload["done"] = serde_json::json!(d);
        }
        if let Some(t) = total {
            payload["total"] = serde_json::json!(t);
        }
        let _ = app.emit("corpus-import-progress", payload);
    };
    emit_phase("reading", 5, None, None);
    // P1-2 导入防护：文件大小上限。读取前先 stat，避免把超大文件整体读进内存。
    let meta = std::fs::metadata(&file_path)
        .map_err(|e| AppError::Internal(format!("stat file failed: {e}")))?;
    if meta.len() > MAX_IMPORT_FILE_BYTES {
        return Err(AppError::Validation(format!(
            "file too large: {len} bytes (limit {limit} bytes)",
            len = meta.len(),
            limit = MAX_IMPORT_FILE_BYTES,
        )));
    }
    let bytes = std::fs::read(&file_path)
        .map_err(|e| AppError::Internal(format!("read file failed: {e}")))?;
    emit_phase("extracting", 25, None, None);
    let (text, source) = extract_text_by_path(&file_path, &bytes)?;
    // 抽取已产出独立的 String：此刻释放原始文件字节，
    // 降低「大文件读入(≤200MB) + 抽取正文 + 切分」全阶段的内存峰值。
    drop(bytes);
    emit_phase("parsing", 50, None, None);
    let chunks = crate::domain::corpus::pipeline::parse_text(&text);
    if chunks.is_empty() {
        return Err(AppError::Validation(
            "no indexable content found in file".to_string(),
        ));
    }
    let parsed = to_chunk_tuples(chunks);
    let total_chunks = parsed.len();
    // 记录 source_path + 归档抽取后的全文镜像：重建索引优先用镜像，源文件移动/删除仍可重建。
    // 旧数据（无镜像）回退读外部源文件；镜像与源文件都在时以镜像为准（消除孤儿书风险）。
    emit_phase("indexing", 55, Some(0), Some(total_chunks));
    let mut progress = |done: usize, total: usize| {
        // FTS 建索引是耗时主体：55% → 95% 按 chunk 平滑推进
        let percent = 55 + (done as u64 * 40 / total.max(1) as u64) as u32;
        emit_phase("indexing", percent.min(95), Some(done), Some(total_chunks));
    };
    let book = repo.import_book_with_progress(
        &title,
        &author,
        &language,
        &category,
        source,
        &file_path,
        &text,
        &parsed,
        Some(&mut progress),
    )?;
    emit_phase("done", 100, Some(total_chunks), Some(total_chunks));
    Ok(book)
}

/// 按扩展名分流抽取纯文本，返回 (正文, 来源格式标签)。导入与重建索引共用同一分流。
fn extract_text_by_path(file_path: &str, bytes: &[u8]) -> AppResult<(String, &'static str)> {
    Ok(match ext_of(file_path).as_deref() {
        Some("epub") => (extract_epub_text(bytes)?, "epub"),
        Some("docx") => (extract_docx_text(bytes)?, "docx"),
        Some("fb2") => (extract_fb2_text(bytes)?, "fb2"),
        Some("html") | Some("htm") => (extract_html_text(bytes)?, "html"),
        Some("mobi") | Some("azw3") => (extract_mobi_text(bytes)?, "mobi"),
        // 纯文本白名单：txt / text / md 显式走解码；未知扩展名不再静默落 txt（P1-2）
        Some("txt") | Some("text") | Some("md") => (decode_text(bytes)?, "txt"),
        other => {
            return Err(AppError::Validation(format!(
                "unsupported file format: {ext} (supported: txt, md, epub, docx, fb2, html, mobi, azw3)",
                ext = other.unwrap_or("(none)")
            )));
        }
    })
}

/// 切分结果 → 仓储层入参元组 (kind, content, chapter_title)。
fn to_chunk_tuples(
    chunks: Vec<crate::domain::corpus::pipeline::ParsedChunk>,
) -> Vec<(String, String, String)> {
    chunks
        .into_iter()
        .map(|c| (c.kind.to_string(), c.content, c.chapter_title))
        .collect()
}

/// 重建索引：对已导入的书重读源文件 → 重抽取 → 重新切分 → 整体替换索引。
///
/// 前提：导入时记录了源文件路径（source_path）。无路径或文件缺失的书记为 skipped，
/// 抽取/切分失败记为 failed——**不清空**该书已有索引（避免"重建失败反把数据搞没"）。
/// `book_id` 为空时重建全部书。
/// 进度透出（P1-3）：逐本完成即经 `corpus-rebuild-progress` 事件下发（current/total/title/status），
/// 前端按事件更新进度条与 per-book 结果矩阵；命令返回 [`RebuildReport.items`] 兜底全量明细。
#[tauri::command]
pub async fn rebuild_corpus_index(
    book_id: Option<i64>,
    app: tauri::AppHandle,
    state: State<'_, CorpusState>,
) -> AppResult<RebuildReport> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // P1-4 并发互斥：重建与导入/删除/压缩互斥
        let _guard = state.try_begin_maintenance("rebuild")?;
        rebuild_blocking(&state, book_id, &app)
    })
    .await
    .map_err(|e| AppError::Internal(format!("rebuild task failed: {e}")))?
}

/// 重建阻塞体（跑在阻塞线程池）。逐本完成后 emit 进度事件。
fn rebuild_blocking(
    state: &CorpusState,
    book_id: Option<i64>,
    app: &tauri::AppHandle,
) -> AppResult<RebuildReport> {
    let repo = state.repo()?;
    let targets: Vec<CorpusBook> = match book_id {
        Some(id) => vec![repo.get_book(id)?],
        None => repo.list_books()?,
    };
    let total = targets.len();
    let mut report = RebuildReport {
        rebuilt: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        items: Vec::new(),
    };
    for book in &targets {
        let mut item = RebuildItem {
            book_id: book.id,
            title: book.title.clone(),
            status: "rebuilt".to_string(),
            reason: String::new(),
            chunk_count: 0,
        };
        match rebuild_one(repo, book) {
            Ok(RebuildOutcome::Rebuilt(n)) => {
                item.chunk_count = n;
                report.rebuilt += 1;
            }
            Ok(RebuildOutcome::Unchanged) => {
                item.status = "unchanged".to_string();
                item.reason = "content unchanged; index kept as-is".to_string();
                report.unchanged += 1;
            }
            Err((status, reason)) => {
                item.status = status;
                item.reason = reason;
                if item.status == "skipped" {
                    report.skipped += 1;
                } else {
                    report.failed += 1;
                }
            }
        }
        let done = report.rebuilt + report.unchanged + report.skipped + report.failed;
        report.items.push(item);
        // P1-3 进度事件：current 为已处理完的本数（含本次），前端据此渲染进度条
        let _ = app.emit(
            "corpus-rebuild-progress",
            serde_json::json!({
                "current": done,
                "total": total,
                "title": book.title,
                "status": report.items.last().map(|i| i.status.as_str()).unwrap_or(""),
                "bookId": book.id,
            }),
        );
    }
    Ok(report)
}

/// 单本重建结果：`Rebuilt(n)`（整体替换完成，n = 新句子数）/ `Unchanged`（内容未变，跳过整个 replace）。
#[derive(Debug)]
enum RebuildOutcome {
    Rebuilt(i64),
    Unchanged,
}

/// 单本重建。三级回退（P0-1 维护优化）：
/// ① **库内全文镜像**（导入时归档，优先）：直接重切分，不依赖原文件——
///    源文件被移动/删除后仍可重建，从根本上消除"孤儿书"；
/// ② 无镜像（旧数据）→ 读外部源文件重抽取；
/// ③ 源文件也不可用 → skipped（不动既有索引）。
/// Err((status, reason))：status ∈ {"skipped", "failed"}。
fn rebuild_one(
    repo: &SqliteCorpusRepository,
    book: &CorpusBook,
) -> Result<RebuildOutcome, (String, String)> {
    // ① 镜像优先：抽取后的全文已在库内，直接重切分
    let mirrored = repo
        .get_book_source(book.id)
        .map_err(|e| ("failed".to_string(), e.to_string()))?;
    if let Some(src) = mirrored {
        return resegment_and_replace(repo, book.id, &book.content_hash, &src.source, &src.raw_text);
    }
    // ② 无镜像（旧数据）：回退读外部源文件
    if book.source_path.trim().is_empty() {
        return Err((
            "skipped".to_string(),
            "no source path recorded for this book".to_string(),
        ));
    }
    let bytes = std::fs::read(&book.source_path).map_err(|e| {
        (
            "skipped".to_string(),
            format!("source file unavailable: {e}"),
        )
    })?;
    let (text, source) =
        extract_text_by_path(&book.source_path, &bytes).map_err(|e| ("failed".to_string(), e.to_string()))?;
    resegment_and_replace(repo, book.id, &book.content_hash, source, &text)
}

/// 用抽取后的全文重新切分并整体替换索引，同时刷新归档镜像。
///
/// 增量重建（P2-5）：切分完成后先用 [`corpus_repository::book_fingerprints`] 与库内 `content_hash` 比对——
/// 一致说明重切分结果与落库索引同源，跳过整个 replace（DELETE/INSERT chunks、刷新统计/指纹/镜像全免），
/// 返回 [`RebuildOutcome::Unchanged`]；`content_hash` 为空（旧数据）时不比对，保守整体重建。
fn resegment_and_replace(
    repo: &SqliteCorpusRepository,
    book_id: i64,
    content_hash: &str,
    source: &str,
    text: &str,
) -> Result<RebuildOutcome, (String, String)> {
    let chunks = crate::domain::corpus::pipeline::parse_text(text);
    if chunks.is_empty() {
        return Err((
            "failed".to_string(),
            "no indexable content found".to_string(),
        ));
    }
    let parsed = to_chunk_tuples(chunks);
    // 增量重建：重切分结果指纹与库内 content_hash 一致 → 内容未变，跳过整个 replace
    if !content_hash.is_empty() {
        let (hash_now, _) =
            crate::infrastructure::database::corpus_repository::book_fingerprints(&parsed);
        if hash_now == content_hash {
            return Ok(RebuildOutcome::Unchanged);
        }
    }
    let n = parsed.len() as i64;
    repo.replace_book_chunks(book_id, source, text, &parsed)
        .map_err(|e| ("failed".to_string(), e.to_string()))?;
    Ok(RebuildOutcome::Rebuilt(n))
}

/// 元数据规范化（书名/作者）：去空白 + 小写，用于「同名同作者」弱信号比对。
fn normalize_meta(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// 两个源路径是否指向同一文件（按存储值去空白比较；不做符号链接/相对路径归一）。
fn same_path(a: &str, b: &str) -> bool {
    a.trim() == b.trim()
}

/// 查重命中分级权重（强信号在前），同时兼容导入命中（exact_*）与报告分组（*_hash/*_path）的命名。
fn dup_rank(kind: &str) -> u8 {
    match kind {
        "exact_path" | "source_path" => 0,
        "exact_content" | "content_hash" => 1,
        "similar" | "simhash" => 2,
        _ => 3,
    }
}

/// 导入前查重：算待导入文件的内容指纹 / SimHash，与库内已导入的书比对。
///
/// **只提示，不阻断**（用户可强制导入）。文件不可读或抽取失败时降级为「同路径 + 同名同作者」核对。
/// 命中分级：`exact_path`（同一文件）> `exact_content`（去空白全文一致，同书不同格式）
/// > `similar`（SimHash 近似，带相似度%）> `same_meta`（同名同作者）。
#[tauri::command]
pub async fn check_corpus_duplicate(
    file_path: String,
    title: String,
    author: String,
    state: State<'_, CorpusState>,
) -> AppResult<Vec<DuplicateHit>> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        check_duplicate_blocking(&state, file_path, title, author)
    })
    .await
    .map_err(|e| AppError::Internal(format!("duplicate check task failed: {e}")))?
}

/// 导入前查重阻塞体（跑在阻塞线程池）：要读文件 + 全文抽取 + 算指纹，秒级工作。
fn check_duplicate_blocking(
    state: &CorpusState,
    file_path: String,
    title: String,
    author: String,
) -> AppResult<Vec<DuplicateHit>> {
    let repo = state.repo()?;
    let books = repo.list_books()?;
    // P2-1：指纹缓存感知——同路径同大小同 mtime 不重抽，直接复用上次抽取结果。
    let fp = compute_file_fingerprint_cached(state, &file_path);
    Ok(duplicate_hits(&books, &file_path, &title, &author, fp))
}

/// 读文件 → 抽取 → 计算指纹；任一步失败返回 None（降级为弱信号比对）。
fn compute_file_fingerprint(file_path: &str) -> Option<(String, i64)> {
    let bytes = std::fs::read(file_path).ok()?;
    let (text, _) = extract_text_by_path(file_path, &bytes).ok()?;
    Some((
        fingerprint::content_fingerprint(&text),
        fingerprint::simhash64(&text),
    ))
}

/// 导入前查重指纹的缓存感知入口（P2-1）：
/// 以 (path, size, mtime) 为键——同路径同大小同修改时间直接复用缓存，避免换文件/重复选择时
/// 全量重抽；mtime/size 变化自动失效。缓存单槽：只服务「当前选中文件」的即时查重。
fn compute_file_fingerprint_cached(
    state: &CorpusState,
    file_path: &str,
) -> Option<(String, i64)> {
    // ① 读键信息（len/mtime）与缓存；锁异常时按旧路径直接计算（不阻断功能）。
    let Ok(cache) = state.fingerprint_cache.lock() else {
        return compute_file_fingerprint(file_path);
    };
    let len = std::fs::metadata(file_path).map(|m| m.len()).ok();
    let modified = std::fs::metadata(file_path).and_then(|m| m.modified()).ok();
    // ② 命中：同路径 + 同大小 + 同 mtime → 复用，不重抽。
    let (Some(len), Some(modified)) = (len, modified) else {
        drop(cache);
        return compute_file_fingerprint(file_path);
    };
    if let Some(entry) = cache.as_ref() {
        if entry.path == file_path && entry.len == len && entry.modified == modified {
            return entry.fp.clone();
        }
    }
    // ③ 未命中：释放锁再计算（避免计算期间长时间持锁），随后写回。
    drop(cache);
    let fp = compute_file_fingerprint(file_path);
    if let Ok(mut cache) = state.fingerprint_cache.lock() {
        *cache = Some(FingerprintCacheEntry {
            path: file_path.to_string(),
            len,
            modified,
            fp: fp.clone(),
        });
    }
    fp
}

/// 查重比对核心（纯函数，便于测试）：每本书只取**最强**的一级命中。
fn duplicate_hits(
    books: &[CorpusBook],
    file_path: &str,
    title: &str,
    author: &str,
    fp: Option<(String, i64)>,
) -> Vec<DuplicateHit> {
    let want_title = normalize_meta(title);
    let want_author = normalize_meta(author);

    let mut hits: Vec<DuplicateHit> = Vec::new();
    for b in books {
        let path_hit = !b.source_path.is_empty() && same_path(&b.source_path, file_path);
        let content_hit = matches!(&fp, Some((h, _)) if !b.content_hash.is_empty() && *h == b.content_hash);
        let sim_dist = match (&fp, b.simhash) {
            (Some((_, s)), sb) if sb != 0 => Some(fingerprint::hamming64(*s, sb)),
            _ => None,
        };
        let sim_hit = sim_dist.is_some_and(|d| d <= fingerprint::SIMHASH_NEAR_DUP_MAX_DISTANCE);
        let meta_hit = !want_title.is_empty()
            && want_title == normalize_meta(&b.title)
            && want_author == normalize_meta(&b.author);

        let (kind, similarity) = if path_hit {
            ("exact_path", 100)
        } else if content_hit {
            ("exact_content", 100)
        } else if sim_hit {
            let s = fp.as_ref().map(|(_, s)| *s).unwrap_or(0);
            ("similar", fingerprint::similarity_percent(s, b.simhash))
        } else if meta_hit {
            ("same_meta", 0)
        } else {
            continue;
        };
        hits.push(DuplicateHit {
            kind: kind.to_string(),
            book_id: b.id,
            title: b.title.clone(),
            similarity,
            created_at: b.created_at,
        });
    }
    hits.sort_by_key(|h| (dup_rank(&h.kind), h.book_id));
    hits
}

/// 把一组书转成报告分组条目（组内按 id 排序，保证输出稳定）。
fn make_group(reason: &str, similarity: i64, books: &[&CorpusBook]) -> DuplicateBookGroup {
    let mut refs: Vec<DuplicateBookRef> = books
        .iter()
        .map(|b| DuplicateBookRef {
            id: b.id,
            title: b.title.clone(),
            author: b.author.clone(),
            chunk_count: b.chunk_count,
            created_at: b.created_at,
        })
        .collect();
    refs.sort_by_key(|r| r.id);
    DuplicateBookGroup {
        reason: reason.to_string(),
        similarity,
        books: refs,
    }
}

/// 全库查重（维护用，只读）：书本级分组 + 重复语句组 Top 50。
#[tauri::command]
pub fn scan_corpus_duplicates(
    state: State<'_, CorpusState>,
) -> AppResult<DuplicateReport> {
    let repo = state.repo()?;
    let books = repo.list_books()?;
    let (exact_groups, similar_groups) = scan_book_duplicates(&books);
    let (sentence_groups, sentence_group_total) = repo.sentence_dup_groups(50)?;
    Ok(DuplicateReport {
        exact_groups,
        similar_groups,
        sentence_groups,
        sentence_group_total,
        book_total: books.len() as i64,
    })
}

/// 空间回收（P0 迁移）：FTS5 rebuild + VACUUM，回收删除残留的倒排与文件空洞。
///
/// 维护用命令：旧库升级前没有 FTS 触发器，删除后倒排残留不回收（实测 50MB 级），
/// 单纯 VACUUM 压不掉索引段内部残留。本命令两步走（rebuild → VACUUM）把空间
/// 还给文件，返回前后体积与 FTS 行数供前端展示。幂等，可随时重复执行。
#[tauri::command]
pub fn optimize_corpus_storage(state: State<'_, CorpusState>) -> AppResult<CorpusStorageReport> {
    // P1-4 并发互斥：压缩与导入/重建/删除互斥（VACUUM 期间写会话会阻塞/竞争）
    let _guard = state.try_begin_maintenance("optimize")?;
    state.repo()?.optimize_storage()
}

/// 书本级查重核心（纯函数，便于测试）：返回 (精确组, 近似组)。
///
/// ① 内容指纹相同 → 精确组；② 同源文件 → 精确组；③ SimHash 近邻 → 近似组。
/// 已在精确组里的书不再参与近似分组（避免同一本书被列两次）。
fn scan_book_duplicates(
    books: &[CorpusBook],
) -> (Vec<DuplicateBookGroup>, Vec<DuplicateBookGroup>) {
    let mut exact_groups: Vec<DuplicateBookGroup> = Vec::new();
    let mut exact_idx: Vec<usize> = Vec::new();

    // ① 内容指纹相同
    {
        let mut by_hash: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, b) in books.iter().enumerate() {
            if !b.content_hash.is_empty() {
                by_hash.entry(b.content_hash.as_str()).or_default().push(i);
            }
        }
        for idxs in by_hash.values() {
            if idxs.len() > 1 {
                exact_idx.extend(idxs.iter().copied());
                let refs: Vec<&CorpusBook> = idxs.iter().map(|&i| &books[i]).collect();
                exact_groups.push(make_group("content_hash", 100, &refs));
            }
        }
    }
    // ② 同一源文件
    {
        let mut by_path: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, b) in books.iter().enumerate() {
            if !b.source_path.is_empty() {
                by_path.entry(b.source_path.as_str()).or_default().push(i);
            }
        }
        for idxs in by_path.values() {
            if idxs.len() > 1 {
                let refs: Vec<&CorpusBook> = idxs.iter().map(|&i| &books[i]).collect();
                exact_groups.push(make_group("source_path", 100, &refs));
            }
        }
    }
    exact_groups.sort_by_key(|g| (dup_rank(&g.reason), g.books.first().map(|b| b.id).unwrap_or(0)));

    // ③ SimHash 近邻（贪心聚类；精确组内的书跳过）
    let mut similar_groups: Vec<DuplicateBookGroup> = Vec::new();
    {
        let mut skip = vec![false; books.len()];
        for &i in &exact_idx {
            skip[i] = true;
        }
        for i in 0..books.len() {
            if skip[i] || books[i].simhash == 0 {
                continue;
            }
            let mut g = vec![i];
            skip[i] = true;
            for j in (i + 1)..books.len() {
                if skip[j] || books[j].simhash == 0 {
                    continue;
                }
                if fingerprint::hamming64(books[i].simhash, books[j].simhash)
                    <= fingerprint::SIMHASH_NEAR_DUP_MAX_DISTANCE
                {
                    g.push(j);
                    skip[j] = true;
                }
            }
            if g.len() > 1 {
                let min_sim = g[1..]
                    .iter()
                    .map(|&j| fingerprint::similarity_percent(books[i].simhash, books[j].simhash))
                    .min()
                    .unwrap_or(100);
                let refs: Vec<&CorpusBook> = g.iter().map(|&i| &books[i]).collect();
                similar_groups.push(make_group("simhash", min_sim, &refs));
            }
        }
        similar_groups.sort_by_key(|gr| gr.books.first().map(|b| b.id).unwrap_or(0));
    }

    (exact_groups, similar_groups)
}

/// 小写扩展名（无扩展名返回 None）。
fn ext_of(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
}

/// 文本解码：UTF-8 有效则直接用；否则回退 GBK（GB18030 超集，覆盖绝大多数中文 txt）。
/// P1-2 导入防护：GBK 解码仍报错时，若 lossy 替换字符（U+FFFD）占比过高，
/// 判定为「不可解码」返回 Validation 错误，而非静默产出乱码索引。
fn decode_text(bytes: &[u8]) -> AppResult<String> {
    match std::str::from_utf8(bytes) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => {
            use encoding_rs::Encoding;
            let (decoded, _, had_errors) = Encoding::for_label(b"gbk")
                .unwrap_or(encoding_rs::UTF_8)
                .decode(bytes);
            if had_errors {
                let lossy = String::from_utf8_lossy(bytes);
                let total = lossy.chars().count();
                let replaced = lossy.chars().filter(|&c| c == '\u{FFFD}').count();
                if total > 0 && replaced * 100 / total > 10 {
                    return Err(AppError::Validation(
                        "file content is not decodable as text (neither UTF-8 nor GBK); maybe binary or corrupted".to_string(),
                    ));
                }
                Ok(lossy.to_string())
            } else {
                Ok(decoded.to_string())
            }
        }
    }
}

/// 从 zip 中按名读取为字符串。
/// 泛型 `Z`：借用 `&[u8]`（导入路径避免 `bytes.to_vec()` 整文件拷贝）或自有 `Vec<u8>`（测试夹具）皆可。
/// 返回值：`Ok(None)` = 条目不存在/读取失败（保持旧语义，非 UTF-8 正文跳过）；
/// `Err(Validation)` = 条目解压超过 `max_bytes`（zip bomb 防护，明显报错而非静默跳过）。
fn read_zip_str<Z: Read + std::io::Seek>(
    zip: &mut ZipArchive<Z>,
    name: &str,
    max_bytes: u64,
) -> AppResult<Option<String>> {
    let Ok(mut f) = zip.by_name(name) else {
        return Ok(None);
    };
    // 预检未压缩大小：zip 元数据即可判断，避免先分配再超限
    if f.size() > max_bytes {
        return Err(AppError::Validation(format!(
            "zip entry `{name}` expands to {size} bytes (limit {limit} bytes)",
            size = f.size(),
            limit = max_bytes,
        )));
    }
    let mut s = String::new();
    // take(max+1) 兜底：即使 size 元数据被伪造，读取也会被截断在限内
    let Ok(n) = f.take(max_bytes + 1).read_to_string(&mut s) else {
        return Ok(None);
    };
    if n as u64 > max_bytes {
        return Err(AppError::Validation(format!(
            "zip entry `{name}` exceeded {max_bytes} bytes while reading"
        )));
    }
    Ok(Some(s))
}

/// 抽取 epub 正文：按阅读顺序排列，章节清晰。
fn extract_epub_text(bytes: &[u8]) -> AppResult<String> {
    let mut zip = ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| AppError::Validation(format!("epub open failed: {e}")))?;
    // 1. META-INF/container.xml → OPF 路径
    let container = read_zip_str(&mut zip, "META-INF/container.xml", MAX_ZIP_ENTRY_BYTES)?
        .ok_or_else(|| AppError::Validation("epub missing META-INF/container.xml".into()))?;
    let opf_path = parse_rootfile_path(&container)
        .ok_or_else(|| AppError::Validation("epub: cannot locate OPF path".into()))?;
    // 2. OPF → spine 顺序的 href 列表
    let opf = read_zip_str(&mut zip, &opf_path, MAX_ZIP_ENTRY_BYTES)?
        .ok_or_else(|| AppError::Validation(format!("epub missing OPF: {opf_path}")))?;
    let opf_dir = opf_path.rfind('/').map(|i| &opf_path[..=i]).unwrap_or("");
    let hrefs = parse_spine_hrefs(&opf);
    // 3. 按阅读顺序抽取每个 XHTML 正文（去标签）
    let mut out = String::new();
    let mut total_expanded: u64 = 0;
    for href in hrefs {
        let full = resolve_href(opf_dir, &href);
        let Some(xml) = read_zip_str(&mut zip, &full, MAX_ZIP_ENTRY_BYTES)? else {
            continue;
        };
        // zip bomb 防护：全书解压累计上限
        total_expanded += xml.len() as u64;
        if total_expanded > MAX_ZIP_TOTAL_BYTES {
            return Err(AppError::Validation(format!(
                "epub total expanded size exceeds {MAX_ZIP_TOTAL_BYTES} bytes"
            )));
        }
        // 块感知剥离：<h1>/<p> 等块级标签边界补换行，使 epub 章标题可被识别
        out.push_str(&html_to_text(&xml));
        out.push('\n');
    }
    if out.trim().is_empty() {
        return Err(AppError::Validation("epub: no extractable text found".into()));
    }
    Ok(out)
}

/// 抽取 docx 正文：读 word/document.xml，按段落（<w:p>）分段，收集 <w:t> 文本块。
fn extract_docx_text(bytes: &[u8]) -> AppResult<String> {
    let mut zip = ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| AppError::Validation(format!("docx open failed: {e}")))?;
    let xml = read_zip_str(&mut zip, "word/document.xml", MAX_ZIP_ENTRY_BYTES)?
        .ok_or_else(|| AppError::Validation("docx missing word/document.xml".into()))?;
    let mut reader = Reader::from_str(&xml);
    let mut out = String::new();
    let mut in_t = false;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if e.name().as_ref() == b"w:t" {
                    in_t = true;
                }
            }
            Ok(Event::End(e)) => {
                match e.name().as_ref() {
                    b"w:t" => in_t = false,
                    b"w:p" => out.push('\n'),
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if in_t {
                    if let Ok(t) = e.unescape() {
                        out.push_str(&t);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(AppError::Validation(format!("docx parse error: {e}"))),
            _ => {}
        }
        buf.clear();
    }
    if out.trim().is_empty() {
        return Err(AppError::Validation("docx: no extractable text found".into()));
    }
    Ok(out)
}

/// 抽取 FB2（FictionBook 2.0）正文：纯 XML，按块元素收集文本。
/// 跳过 <description>（元数据）、<binary>（内嵌图片 base64）、<style>/<stylesheet>，避免噪声与超大 base64。
fn extract_fb2_text(bytes: &[u8]) -> AppResult<String> {
    let xml = decode_text(bytes)?;
    let mut reader = Reader::from_str(&xml);
    let mut out = String::new();
    let mut skip_depth: usize = 0; // 处于需跳过的元素内
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if is_fb2_skip(local_name(e.name().as_ref())) {
                    skip_depth += 1;
                }
            }
            Ok(Event::End(e)) => {
                let nm = e.name().as_ref().to_vec();
                let name = local_name(&nm);
                if is_fb2_skip(name) {
                    skip_depth = skip_depth.saturating_sub(1);
                } else if is_fb2_block(name) {
                    out.push('\n');
                }
            }
            Ok(Event::Text(e)) => {
                if skip_depth == 0 {
                    if let Ok(t) = e.unescape() {
                        out.push_str(&t);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break, // 宽松：遇坏标签即停止，保留已抽取内容
            _ => {}
        }
        buf.clear();
    }
    let text = out.trim().to_string();
    if text.is_empty() {
        return Err(AppError::Validation("fb2: no extractable text found".into()));
    }
    Ok(text)
}

/// FB2 需整体跳过的元素（元数据 / 图片 / 样式）。
fn is_fb2_skip(name: &[u8]) -> bool {
    matches!(
        name,
        b"description" | b"binary" | b"style" | b"stylesheet" | b"image"
    )
}

/// FB2 块级元素：结束标签后补换行，保留段落/章节结构。
fn is_fb2_block(name: &[u8]) -> bool {
    matches!(
        name,
        b"p"
            | b"title"
            | b"subtitle"
            | b"text-author"
            | b"epigraph"
            | b"cite"
            | b"stanza"
            | b"v"
            | b"section"
            | b"empty-line"
            | b"poem"
            | b"th"
            | b"td"
            | b"tr"
            | b"li"
    )
}

/// 抽取 HTML/HTM 正文：容错剥离标签 + 反转义常见 HTML 实体。零依赖。
fn extract_html_text(bytes: &[u8]) -> AppResult<String> {
    let text = html_to_text(&decode_text(bytes)?);
    if text.trim().is_empty() {
        return Err(AppError::Validation("html: no extractable text found".into()));
    }
    Ok(text)
}

/// 抽取 MOBI/AZW3（Kindle）正文：经 `mobi` crate 解析（No/PalmDOC/HUFF 压缩），
/// 正文本身是 HTML 片段，复用 HTML 剥离。带 DRM 的文件无法解析，明确报错。
fn extract_mobi_text(bytes: &[u8]) -> AppResult<String> {
    let m = Mobi::new(bytes.to_vec())
        .map_err(|e| AppError::Validation(format!("mobi open failed: {e}")))?;
    if !matches!(m.encryption(), Encryption::No) {
        return Err(AppError::Validation(
            "mobi: DRM-encrypted file is not supported (convert to EPUB first)".into(),
        ));
    }
    let raw = m
        .content_as_string()
        .map_err(|e| AppError::Validation(format!("mobi decode failed: {e}")))?;
    let text = html_to_text(&raw);
    if text.trim().is_empty() {
        return Err(AppError::Validation("mobi: no extractable text found".into()));
    }
    Ok(text)
}

/// 块级标签（HTML/XHTML）：边界插入换行，保住段落/标题结构，使章标题可被识别。
fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div"
            | "br"
            | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
            | "li" | "ul" | "ol" | "dl" | "dt" | "dd"
            | "tr" | "td" | "th" | "table" | "thead" | "tbody" | "caption"
            | "section" | "article" | "aside" | "nav" | "main"
            | "header" | "footer" | "blockquote" | "pre" | "hr"
            | "figure" | "figcaption" | "details" | "summary" | "form" | "fieldset"
            | "title" | "address" | "body" | "html"
    )
}

/// 容错 HTML/XHTML → 纯文本（零依赖）：
/// - 丢弃 `<script>`/`<style>`/`<head>` 与注释 `<!-- -->` 整块；
/// - **块级标签边界补换行**（保住段落/标题结构）；**行内标签不补空格**（避免中文子串被空格割裂）；
/// - 最后反转义 HTML 实体。epub / HTML / mobi 正文共用此路径。
fn html_to_text(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    let mut skip_depth: usize = 0;
    while i < bytes.len() {
        if bytes[i] != b'<' {
            let next = raw[i..].find('<').map(|p| i + p).unwrap_or(bytes.len());
            if skip_depth == 0 {
                out.push_str(&raw[i..next]);
            }
            i = next;
            continue;
        }
        // 注释整体丢弃
        if raw[i..].starts_with("<!--") {
            i = match raw[i + 4..].find("-->") {
                Some(p) => i + 4 + p + 3,
                None => bytes.len(),
            };
            continue;
        }
        // 定位标签结束 '>' 并解析标签名
        let mut k = i + 1;
        while k < bytes.len() && bytes[k] != b'>' {
            k += 1;
        }
        let inner = &raw[i + 1..k.min(bytes.len())];
        let self_closed = inner.trim_end().ends_with('/');
        let is_close = inner.trim_start().starts_with('/');
        let name: String = inner
            .trim_start()
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>()
            .to_ascii_lowercase();
        let skip_block = matches!(name.as_str(), "script" | "style" | "head");
        if skip_block {
            if is_close {
                skip_depth = skip_depth.saturating_sub(1);
            } else if !self_closed {
                skip_depth += 1;
            }
        } else if skip_depth == 0 && is_block_tag(&name) && !out.ends_with('\n') {
            // 块级标签起始/结束处补换行（去重连续换行）
            out.push('\n');
        }
        i = if k < bytes.len() { k + 1 } else { bytes.len() };
    }
    decode_html_entities(&out)
}

/// 反转义 HTML 实体：命名实体（常见集合）+ 数字实体（&#nnn; / &#xhhh;）。
fn decode_html_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let chars: Vec<char> = s.chars().collect();
    while i < chars.len() {
        if chars[i] == '&' {
            if let Some((decoded, len)) = match_html_entity(&chars[i..]) {
                out.push_str(&decoded);
                i += len;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 从以 '&' 起始的字符切片匹配一个实体，返回 (解码文本, 消费长度)。
fn match_html_entity(chars: &[char]) -> Option<(String, usize)> {
    // chars[0] == '&'
    let semi = chars.iter().position(|&c| c == ';')?;
    let token: String = chars[1..semi].iter().collect();
    if let Some(c) = named_entity(&token) {
        return Some((c.to_string(), semi + 1));
    }
    if token.starts_with('#') {
        let cp = if token.starts_with("#x") || token.starts_with("#X") {
            u32::from_str_radix(&token[2..], 16).ok()
        } else {
            token[1..].parse::<u32>().ok()
        };
        if let Some(cp) = cp {
            if let Some(c) = char::from_u32(cp) {
                return Some((c.to_string(), semi + 1));
            }
        }
    }
    None
}

/// 常见 HTML 命名实体 → 字符。覆盖排版/标点/符号类，足够语料抽取使用。
fn named_entity(token: &str) -> Option<char> {
    Some(match token {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{00a0}',
        "mdash" => '—',
        "ndash" => '–',
        "hellip" => '…',
        "laquo" => '«',
        "raquo" => '»',
        "middot" => '·',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "bull" => '•',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "deg" => '°',
        "plusmn" => '±',
        "times" => '×',
        "divide" => '÷',
        "section" => '§',
        "para" => '¶',
        "ensp" => '\u{2002}',
        "emsp" => '\u{2003}',
        "thinsp" => '\u{2009}',
        "euro" => '€',
        "pound" => '£',
        "cent" => '¢',
        "yen" => '¥',
        "alpha" => 'α',
        "beta" => 'β',
        "gamma" => 'γ',
        "delta" => 'δ',
        "pi" => 'π',
        "sigma" => 'σ',
        "omega" => 'ω',
        "infin" => '∞',
        "ne" => '≠',
        "le" => '≤',
        "ge" => '≥',
        "larr" => '←',
        "rarr" => '→',
        "uarr" => '↑',
        "darr" => '↓',
        "harr" => '↔',
        "spades" => '♠',
        "clubs" => '♣',
        "hearts" => '♥',
        "diams" => '♦',
        _ => return None,
    })
}

/// 取元素本地名（去掉命名空间前缀 `ns:`），使带/不带前缀的 FB2 都能匹配。
fn local_name(name: &[u8]) -> &[u8] {
    match name.iter().rposition(|&b| b == b':') {
        Some(pos) => &name[pos + 1..],
        None => name,
    }
}

/// 解析 container.xml 的 <rootfile full-path="...">。
fn parse_rootfile_path(container: &str) -> Option<String> {
    let mut reader = Reader::from_str(container);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if e.name().as_ref() == b"rootfile" {
                    for a in e.attributes().flatten() {
                        if a.key.as_ref() == b"full-path" {
                            return a.unescape_value().ok().map(|c| c.to_string());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

/// 解析 OPF：manifest(id→href) + spine(有序 idref)，返回按阅读顺序排列的 href。
fn parse_spine_hrefs(opf: &str) -> Vec<String> {
    let mut reader = Reader::from_str(opf);
    let mut manifest: HashMap<String, String> = HashMap::new();
    let mut spine: Vec<String> = Vec::new();
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                match e.name().as_ref() {
                    b"item" => {
                        let mut id = String::new();
                        let mut href = String::new();
                        for a in e.attributes().flatten() {
                            match a.key.as_ref() {
                                b"id" => id = a.unescape_value().map(|c| c.to_string()).unwrap_or_default(),
                                b"href" => href = a.unescape_value().map(|c| c.to_string()).unwrap_or_default(),
                                _ => {}
                            }
                        }
                        if !href.is_empty() {
                            manifest.insert(id, href);
                        }
                    }
                    b"itemref" => {
                        for a in e.attributes().flatten() {
                            if a.key.as_ref() == b"idref" {
                                spine.push(a.unescape_value().map(|c| c.to_string()).unwrap_or_default());
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    spine.into_iter().filter_map(|idref| manifest.get(&idref).cloned()).collect()
}

/// 相对 OPF 目录解析 href（处理绝对路径与百分号编码）。
fn resolve_href(opf_dir: &str, href: &str) -> String {
    let href = percent_decode(href);
    if href.starts_with('/') {
        href.trim_start_matches('/').to_string()
    } else {
        format!("{opf_dir}{href}")
    }
}

/// 最小百分号解码（%XX → 字节），用于 epub href 里的 %20 等。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{ZipWriter, write::FileOptions};

    #[test]
    fn decode_utf8_and_gbk() {
        let utf8 = "山风很大。".as_bytes().to_vec();
        assert_eq!(decode_text(&utf8).unwrap(), "山风很大。");
        let gbk = encoding_rs::GBK.encode("孤独是宿命").0.to_vec();
        assert_eq!(decode_text(&gbk).unwrap(), "孤独是宿命");
    }

    #[test]
    fn decode_rejects_undecodable_bytes() {
        // 0xFF 既非 UTF-8 也非 GBK 的合法字节：lossy 后 U+FFFD 占比超阈值 → Validation 错误
        let junk = vec![0xFFu8; 64];
        let err = decode_text(&junk).unwrap_err();
        assert!(err.to_string().contains("not decodable"));
    }

    #[test]
    fn maintenance_lock_serializes_operations() {
        use crate::infrastructure::database::CorpusDatabase;
        let repo = Arc::new(SqliteCorpusRepository::new(Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        )));
        let state = CorpusState::ready(repo);
        let g1 = state.try_begin_maintenance("rebuild").unwrap();
        // 第二次获取必须失败（互斥生效），且错误信息带持有者操作名
        let err = state.try_begin_maintenance("import").unwrap_err();
        assert!(err.to_string().contains("rebuild"), "error should name holder: {err}");
        drop(g1);
        // 释放后可再次获取
        let g2 = state.try_begin_maintenance("delete").unwrap();
        drop(g2);
        assert!(state.try_begin_maintenance("optimize").is_ok());
    }

    #[test]
    fn maintenance_status_reports_holder_and_resets_after_release() {
        use crate::infrastructure::database::CorpusDatabase;
        let repo = Arc::new(SqliteCorpusRepository::new(Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        )));
        let state = CorpusState::ready(repo);
        // 空闲态：锁内无持有者，busy=false
        {
            let holder = state.maintenance_holder.lock().unwrap();
            assert!(holder.is_none(), "idle state must have no holder");
        }
        // 占用态：持有者操作名写入
        let guard = state.try_begin_maintenance("import").unwrap();
        {
            let holder = state.maintenance_holder.lock().unwrap();
            let h = holder.as_ref().expect("holder recorded while busy");
            assert_eq!(h.op, "import");
            assert!(h.started_at > SystemTime::UNIX_EPOCH);
        }
        // 查看错误信息明确点出持有者与已运行秒数
        let err = state.try_begin_maintenance("delete").unwrap_err();
        assert!(err.to_string().contains("import"), "error should name holder: {err}");
        assert!(err.to_string().contains("s ago"), "error should include elapsed: {err}");
        // 释放后复位为空闲
        drop(guard);
        let holder = state.maintenance_holder.lock().unwrap();
        assert!(holder.is_none(), "holder cleared after guard release");
    }

    #[test]
    fn fingerprint_cache_hits_on_unchanged_file() {
        use crate::infrastructure::database::CorpusDatabase;
        use std::time::{Duration, SystemTime};
        let dir = std::env::temp_dir().join("sight_folio_corpus_cache_test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("unchanged.txt");
        std::fs::write(&path, "第一章\n\n山风很大。他回头看了一眼。\n\n孤独是宿命。").unwrap();
        let repo = Arc::new(SqliteCorpusRepository::new(Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        )));
        let state = CorpusState::ready(repo);
        let p = path.to_str().unwrap();
        // 首次：未命中缓存 → 计算并写回
        let fp1 = compute_file_fingerprint_cached(&state, p).unwrap();
        assert_eq!(fp1, compute_file_fingerprint(p).unwrap());
        // 命中路径可直接观测缓存状态：entry 已记录键与指纹
        let entry = state.fingerprint_cache.lock().unwrap();
        let e = entry.as_ref().expect("cache written after first call");
        assert_eq!(e.path, p);
        assert_eq!(e.len, std::fs::metadata(p).unwrap().len());
        assert!(e.modified > SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        drop(entry);
        // 同文件再次调用 → 命中缓存，结果与首次一致
        let fp2 = compute_file_fingerprint_cached(&state, p).unwrap();
        assert_eq!(fp1, fp2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fingerprint_cache_invalidates_on_file_change() {
        use crate::infrastructure::database::CorpusDatabase;
        let dir = std::env::temp_dir().join("sight_folio_corpus_cache_test2");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("changing.txt");
        std::fs::write(&path, "版本一：山风很大。").unwrap();
        // 记录写入时刻：确保改写后 mtime 必然前进（macOS 高精度，睡眠 20ms 足够区分）。
        std::thread::sleep(std::time::Duration::from_millis(20));
        let repo = Arc::new(SqliteCorpusRepository::new(Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        )));
        let state = CorpusState::ready(repo);
        let p = path.to_str().unwrap();
        let fp1 = compute_file_fingerprint_cached(&state, p).unwrap();
        assert!(state.fingerprint_cache.lock().unwrap().is_some());
        // 改写内容（大小、mtime 均变化）：旧缓存必须失效
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(
            &path,
            "版本二：这是完全不同的第二版内容，孤独是宿命。山风很大，但他坚定地回头。",
        )
        .unwrap();
        let fp2 = compute_file_fingerprint_cached(&state, p).unwrap();
        assert_ne!(fp1, fp2, "stale fingerprint must be invalidated after file change");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unsupported_extension_rejected() {
        let err = extract_text_by_path("/tmp/book.xyz", b"hello").unwrap_err();
        assert!(err.to_string().contains("unsupported file format"));
    }

    /// 在内存构造一个最小 zip（用于 epub/docx 测试夹具）。
    fn build_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut z = ZipWriter::new(Cursor::new(Vec::<u8>::new()));
        let opts: FileOptions<'_, ()> = FileOptions::default();
        for (name, content) in entries {
            z.start_file(*name, opts).unwrap();
            z.write_all(content.as_bytes()).unwrap();
        }
        let cursor = z.finish().unwrap();
        cursor.into_inner()
    }

    #[test]
    fn read_zip_str_rejects_oversized_entry() {
        // 200KB 条目（压缩后远小于此）：max_bytes=100 时必须拒绝而非静默截断
        let big = "a".repeat(200 * 1024);
        let bytes = build_zip(&[("big.txt", &big)]);
        let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let err = read_zip_str(&mut zip, "big.txt", 100).unwrap_err();
        assert!(
            err.to_string().contains("expands to"),
            "expected size pre-check rejection, got: {err}"
        );
        // 正常条目按限通过、缺失条目为 Ok(None)
        let bytes2 = build_zip(&[("ok.txt", "山风很大。")]);
        let mut zip2 = ZipArchive::new(Cursor::new(bytes2)).unwrap();
        assert_eq!(read_zip_str(&mut zip2, "ok.txt", 100).unwrap().as_deref(), Some("山风很大。"));
        assert!(read_zip_str(&mut zip2, "missing.txt", 100).unwrap().is_none());
    }

    #[test]
    fn extract_epub_keeps_reading_order() {
        let container = r#"<?xml version="1.0"?><container><rootfile full-path="OEBPS/content.opf"/></container>"#;
        let opf = r#"<?xml version="1.0"?><package><manifest>
            <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
            <item id="c2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine>
            <itemref idref="c1"/><itemref idref="c2"/>
        </spine></package>"#;
        let c1 = r#"<html><body><p>第一章：孤独是宿命。</p></body></html>"#;
        let c2 = r#"<html><body><p>第二章：山风很大。</p></body></html>"#;
        let bytes = build_zip(&[
            ("META-INF/container.xml", container),
            ("OEBPS/content.opf", opf),
            ("OEBPS/chap1.xhtml", c1),
            ("OEBPS/chap2.xhtml", c2),
        ]);
        let text = extract_epub_text(&bytes).unwrap();
        assert!(text.contains("孤独是宿命"));
        assert!(text.contains("山风很大"));
        // 阅读顺序：第一章应在第二章之前
        assert!(text.find("孤独是宿命").unwrap() < text.find("山风很大").unwrap());
    }

    #[test]
    fn extract_docx_collects_runs_by_paragraph() {
        let doc = r#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
            <w:p><w:r><w:t>第一行文字。</w:t></w:r></w:p>
            <w:p><w:r><w:t>第二行文字。</w:t></w:r></w:p>
        </w:body></w:document>"#;
        let bytes = build_zip(&[("word/document.xml", doc)]);
        let text = extract_docx_text(&bytes).unwrap();
        assert!(text.contains("第一行文字。"));
        assert!(text.contains("第二行文字。"));
        assert!(text.find("第一行文字。").unwrap() < text.find("第二行文字。").unwrap());
    }

    #[test]
    fn extract_fb2_collects_sections_in_order() {
        let fb2 = r#"<?xml version="1.0" encoding="UTF-8"?>
        <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
          <description><title-info><book-title>测试书</book-title></title-info></description>
          <body>
            <section><title><p>第一章</p></title><p>孤独是宿命。</p><p>山风很大。</p></section>
            <section><title><p>第二章</p></title><p>星空之下。</p></section>
          </body>
        </FictionBook>"#;
        let text = extract_fb2_text(fb2.as_bytes()).unwrap();
        assert!(text.contains("孤独是宿命"));
        assert!(text.contains("山风很大"));
        assert!(text.contains("星空之下"));
        // 阅读顺序：第一章内容在第二章之前
        assert!(text.find("山风很大").unwrap() < text.find("星空之下").unwrap());
        // description 内元数据（book-title）应被跳过，不进正文
        assert!(!text.contains("测试书"));
    }

    #[test]
    fn extract_fb2_skips_binary_base64() {
        // <binary> 内是大量 base64，必须跳过，否则污染语料
        let fb2 = r#"<FictionBook><body><section><p>正文内容。</p></section>
        <binary content-type="image/png">iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC</binary>
        </body></FictionBook>"#;
        let text = extract_fb2_text(fb2.as_bytes()).unwrap();
        assert!(text.contains("正文内容"));
        assert!(!text.contains("iVBORw0KGgo"));
    }

    #[test]
    fn extract_html_strips_tags_and_entities() {
        let html = r#"<html><head><title>忽略</title><style>.x{}</style></head>
        <body><h1>第一章&nbsp;开始</h1>
        <p>孤独是宿命&mdash;山风很大。</p>
        <script>var x = "ignore";</script>
        <p>星空之下&#9733;</p></body></html>"#;
        let text = extract_html_text(html.as_bytes()).unwrap();
        assert!(text.contains("第一章"));
        assert!(text.contains("开始"));
        assert!(text.contains("孤独是宿命"));
        assert!(text.contains("山风很大"));
        assert!(text.contains("星空之下"));
        assert!(text.contains('—')); // &mdash;
        assert!(text.contains('★')); // &#9733;
        assert!(!text.contains("ignore")); // script 块已丢弃
        assert!(!text.contains("忽略")); // head 块已丢弃
    }

    #[test]
    fn extract_html_handles_malformed_and_unclosed() {
        // 不规范 HTML：未闭合标签、裸 <br>、属性含 '>'
        let html = r#"<div class="a>b">第一段<p>第二段<br>第三段<img src="x">尾段"#;
        let text = extract_html_text(html.as_bytes()).unwrap();
        assert!(text.contains("第一段"));
        assert!(text.contains("第二段"));
        assert!(text.contains("第三段"));
        assert!(text.contains("尾段"));
    }

    #[test]
    fn extract_mobi_rejects_non_mobi_bytes() {
        // 非 MOBI 数据必须返回 Err 而非 panic：坏输入不能拖垮导入命令
        assert!(extract_mobi_text(b"not a real mobi file at all").is_err());
    }

    #[test]
    fn extract_mobi_rejects_empty() {
        assert!(extract_mobi_text(&[]).is_err());
    }

    #[test]
    fn extract_epub_keeps_block_structure_for_chapter_detection() {
        // 压缩型 XHTML（单行）：块级标签必须补换行，否则 <h1> 与正文粘连、整章被当标题
        let container = r#"<?xml version="1.0"?><container><rootfile full-path="OEBPS/content.opf"/></container>"#;
        let opf = r#"<?xml version="1.0"?><package><manifest>
            <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine><itemref idref="c1"/></spine></package>"#;
        let c1 = r#"<html><body><h1>第一章 出山</h1><p>山风很大。他回头看了一眼。</p></body></html>"#;
        let bytes = build_zip(&[
            ("META-INF/container.xml", container),
            ("OEBPS/content.opf", opf),
            ("OEBPS/chap1.xhtml", c1),
        ]);
        let text = extract_epub_text(&bytes).unwrap();
        let chunks = crate::domain::corpus::pipeline::parse_text(&text);
        let headings: Vec<_> = chunks.iter().filter(|c| c.kind == "chapter").collect();
        assert_eq!(headings.len(), 1);
        assert_eq!(headings[0].content, "第一章 出山");
        // 正文切成完整单元并归属该章，而不是粘成一个大标题
        assert!(chunks
            .iter()
            .any(|c| c.kind == "sentence" && c.content == "山风很大。他回头看了一眼。"));
        assert!(chunks
            .iter()
            .filter(|c| c.kind == "sentence")
            .all(|c| c.chapter_title == "第一章 出山"));
    }

    #[test]
    fn html_inline_tags_do_not_insert_spaces() {
        // 行内标签（<em>）不得插空格破坏中文子串；块级标签应分段
        let html = "<p>他<em>回头</em>看了一眼。</p><p>山风很大。</p>";
        let text = extract_html_text(html.as_bytes()).unwrap();
        assert!(text.contains("他回头看了一眼。"));
        assert!(!text.contains("他 回头"));
        assert!(text.contains('\n'));
    }

    /// 重建索引：读源文件 → 重抽取 → 重新切分 → 替换索引（无空行章标题应被正确识章）。
    #[test]
    fn rebuild_one_rereads_source_and_resegments() {
        use crate::infrastructure::database::{corpus_repository::CorpusRepository, CorpusDatabase};
        let repo = SqliteCorpusRepository::new(std::sync::Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        ));
        let dir = std::env::temp_dir().join(format!("sf_corpus_rebuild_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("book.txt");
        // 无空行分隔的章标题：旧切分会漏章，新切分须识别
        std::fs::write(&path, "第一章 出山\n山风很大。\n第二章 入世\n老者说。").unwrap();
        let path_str = path.to_string_lossy().to_string();
        // 以空 chunks 导入（模拟"索引已陈旧"），rebuild 后应切出章 + 句
        // 镜像为抽取后的全文：rebuild 走镜像重切分，不依赖源文件此刻是否还在
        let book = repo
            .import_book("临时书", "", "zh", "", "txt", &path_str, "第一章 出山\n山风很大。\n第二章 入世\n老者说。", &[])
            .unwrap();
        assert_eq!(book.chunk_count, 0);
        let n = expect_rebuilt(rebuild_one(&repo, &book));
        assert!(n >= 4, "expected chapter+sentence chunks, got {n}");
        let after = repo.get_book(book.id).unwrap();
        assert_eq!(after.chunk_count, n);
        assert_eq!(after.source, "txt");
        // 章标题正确识别并归属（旧行切分会把第二章并入正文且误挂第一章）
        let hits = repo.search("老者说", None, 20, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chapter_title, "第二章 入世");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 重建索引的跳过/失败分类（三级回退）：
    /// ① 有镜像（导入即归档）→ 即使源文件不存在也 rebuilt（P0-1 核心：消除孤儿书）；
    /// ② 无镜像（旧数据）且无路径/文件缺失 → skipped；③ 不 panic、不动既有索引。
    #[test]
    fn rebuild_one_uses_mirror_fallback_to_external_then_skip() {
        use crate::infrastructure::database::{corpus_repository::CorpusRepository, CorpusDatabase};
        let repo = SqliteCorpusRepository::new(std::sync::Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        ));
        // ① 有镜像 + 源文件不存在 → rebuilt（镜像兜底，不 panic、不清空既有索引）
        let missing = repo
            .import_book(
                "已丢失",
                "",
                "zh",
                "",
                "txt",
                "/tmp/definitely_missing_book_xyz.txt",
                "第一章\n\n山风很大。他回头看了一眼。",
                &[],
            )
            .unwrap();
        let n = expect_rebuilt(rebuild_one(&repo, &missing));
        assert!(n >= 2, "mirror must resegment, got {n}");
        let after = repo.get_book(missing.id).unwrap();
        assert_eq!(after.chunk_count, n);
        assert!(!repo.search("山风很大", None, 20, 0).unwrap().is_empty());
        // ② 无镜像（旧数据，P0-1 之前导入的行没有归档表记录）且无 source_path → skipped
        let legacy_db = std::sync::Arc::new(CorpusDatabase::open_in_memory().unwrap());
        {
            let conn = legacy_db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO corpus_books (id, title, source_path) VALUES (1, '旧库无路径', '')",
                [],
            )
            .unwrap();
        }
        let legacy_repo = SqliteCorpusRepository::new(legacy_db);
        let legacy_book = legacy_repo.get_book(1).unwrap();
        assert_eq!(rebuild_one(&legacy_repo, &legacy_book).unwrap_err().0, "skipped");
        // ③ 无镜像（旧数据）且路径记录在但文件已不在 → skipped（不误判 failed、不清索引）
        let legacy_db2 = std::sync::Arc::new(CorpusDatabase::open_in_memory().unwrap());
        {
            let conn = legacy_db2.0.lock().unwrap();
            conn.execute(
                "INSERT INTO corpus_books (id, title, source_path)
                 VALUES (2, '旧库丢失', '/tmp/definitely_missing_book_xyz.txt')",
                [],
            )
            .unwrap();
        }
        let legacy_repo2 = SqliteCorpusRepository::new(legacy_db2);
        let legacy_book2 = legacy_repo2.get_book(2).unwrap();
        assert_eq!(rebuild_one(&legacy_repo2, &legacy_book2).unwrap_err().0, "skipped");
    }

    /// 断言单本重建为「整体替换」，返回新句子数（增量重建后结果为 [`RebuildOutcome`]）。
    fn expect_rebuilt(outcome: Result<RebuildOutcome, (String, String)>) -> i64 {
        match outcome {
            Ok(RebuildOutcome::Rebuilt(n)) => n,
            Ok(RebuildOutcome::Unchanged) => panic!("expected rebuilt, got unchanged"),
            Err((status, reason)) => panic!("expected rebuilt, got {status}: {reason}"),
        }
    }

    /// 增量重建（P2-5）——内容未变跳过：正常导入（chunks 与镜像同源）后重建，
    /// 重切分结果与库内 content_hash 一致 → `unchanged`，索引/指纹/镜像均不重写，检索仍可用。
    #[test]
    fn rebuild_one_skips_when_content_unchanged() {
        use crate::domain::corpus::pipeline::parse_text;
        use crate::infrastructure::database::{corpus_repository::CorpusRepository, CorpusDatabase};
        let repo = SqliteCorpusRepository::new(std::sync::Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        ));
        let text = "第一章 出山\n山风很大。他回头看了一眼。\n第二章 入世\n老者说。";
        let parsed: Vec<(String, String, String)> = parse_text(text)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        assert!(!parsed.is_empty());
        let book = repo
            .import_book("静书", "", "zh", "", "txt", "", text, &parsed)
            .unwrap();
        let before = repo.get_book(book.id).unwrap();
        // 内容未变：重建应跳过整个 replace
        match rebuild_one(&repo, &repo.get_book(book.id).unwrap()) {
            Ok(RebuildOutcome::Unchanged) => {}
            other => panic!("unchanged book must be skipped, got {other:?}"),
        }
        let after = repo.get_book(book.id).unwrap();
        assert_eq!(after.content_hash, before.content_hash, "指纹不应被刷新");
        assert_eq!(after.chunk_count, before.chunk_count, "索引不应被重写");
        let src = repo.get_book_source(book.id).unwrap().unwrap();
        assert_eq!(src.raw_text, text, "镜像不应被改写");
        assert!(
            !repo.search("山风很大", None, 20, 0).unwrap().is_empty(),
            "既有索引仍可检索"
        );
    }

    /// 增量重建——内容变更需整体替换：旧数据（无镜像）且外部源文件内容已改，
    /// 重切分指纹与库内 content_hash 不一致 → `rebuilt`，索引按新文本重建、指纹刷新。
    #[test]
    fn rebuild_one_rebuilds_when_external_source_changed() {
        use crate::domain::corpus::pipeline::parse_text;
        use crate::infrastructure::database::{
            corpus_repository::{book_fingerprints, CorpusRepository},
            CorpusDatabase,
        };
        let db = std::sync::Arc::new(CorpusDatabase::open_in_memory().unwrap());
        let repo = SqliteCorpusRepository::new(db.clone());
        let dir = std::env::temp_dir().join(format!("sf_corpus_changed_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("changed.txt");
        let text_a = "第一章 出山\n山风很大。\n第二章 入世\n老者说。";
        std::fs::write(&path, text_a).unwrap();
        let parsed_a: Vec<(String, String, String)> = parse_text(text_a)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let hash_a = book_fingerprints(&parsed_a).0;
        // 无镜像的旧数据：只有 source_path + 指纹记录，没有 corpus_book_sources 行
        {
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO corpus_books (id, title, source_path, content_hash, simhash, chunk_count)
                 VALUES (1, '变书', ?1, ?2, 0, 3)",
                rusqlite::params![path.to_string_lossy().to_string(), hash_a],
            )
            .unwrap();
        }
        // 外部源文件内容已改（文本 B 比 A 多两句）
        let text_b = "第一章 出山\n山风很大。他回头看了一眼。\n第二章 入世\n老者说。停步。";
        std::fs::write(&path, text_b).unwrap();
        let n = expect_rebuilt(rebuild_one(&repo, &repo.get_book(1).unwrap()));
        assert!(n >= 2, "变更书应按新文本重建，got {n}");
        let after = repo.get_book(1).unwrap();
        assert_eq!(after.chunk_count, n);
        assert_ne!(after.content_hash, hash_a, "指纹应按新文本刷新");
        assert!(
            !repo.search("停步", None, 20, 0).unwrap().is_empty(),
            "新文本已可检索"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 增量重建——旧数据无指纹（content_hash 为空）不比对，保守整体重建并回填指纹。
    #[test]
    fn rebuild_one_rebuilds_when_content_hash_missing() {
        use crate::domain::corpus::pipeline::parse_text;
        use crate::infrastructure::database::{corpus_repository::CorpusRepository, CorpusDatabase};
        let db = std::sync::Arc::new(CorpusDatabase::open_in_memory().unwrap());
        let repo = SqliteCorpusRepository::new(db.clone());
        let text = "第一章 出山\n山风很大。";
        let parsed: Vec<(String, String, String)> = parse_text(text)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let book = repo
            .import_book("旧号", "", "zh", "", "txt", "", text, &parsed)
            .unwrap();
        assert!(!repo.get_book(book.id).unwrap().content_hash.is_empty());
        // 置空指纹（模拟 P0-1 之前落库的行未计算指纹）
        {
            let conn = db.0.lock().unwrap();
            conn.execute(
                "UPDATE corpus_books SET content_hash = '' WHERE id = ?1",
                [book.id],
            )
            .unwrap();
        }
        let n = expect_rebuilt(rebuild_one(&repo, &repo.get_book(book.id).unwrap()));
        assert!(n >= 2, "空指纹不跳过，应整体重建，got {n}");
        let after = repo.get_book(book.id).unwrap();
        assert!(!after.content_hash.is_empty(), "重建后应回填内容指纹");
    }

    /// 构造测试用 CorpusBook（simhash 传 0 表示"未计算"）。
    fn book(id: i64, title: &str, author: &str, path: &str, hash: &str, sim: i64) -> CorpusBook {
        CorpusBook {
            id,
            title: title.to_string(),
            author: author.to_string(),
            language: "zh".to_string(),
            source: "txt".to_string(),
            category: String::new(),
            tags: Vec::new(),
            source_path: path.to_string(),
            content_hash: hash.to_string(),
            simhash: sim,
            word_count: 0,
            chunk_count: 0,
            created_at: 0,
        }
    }

    /// 导入前查重：每本书只取最强一级（路径 > 内容 > 近似 > 同名同作者）。
    #[test]
    fn duplicate_hits_take_strongest_signal() {
        // simhash 全为 0（未计算）→ 不产生近似命中，隔离出路径/内容/元数据三路
        let books = vec![
            book(1, "甲书", "作者甲", "/tmp/a.txt", "hashA", 0),
            book(2, "乙书", "作者乙", "/tmp/b.txt", "hashB", 0),
            book(3, "丙书", "作者丙", "/tmp/c.txt", "hashC", 0),
        ];
        // 同一路径 → exact_path
        let hits = duplicate_hits(&books, "/tmp/a.txt", "", "", Some(("hashZ".into(), 0)));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "exact_path");
        assert_eq!(hits[0].book_id, 1);
        assert_eq!(hits[0].similarity, 100);
        // 同内容指纹 → exact_content
        let hits = duplicate_hits(&books, "/tmp/none.txt", "", "", Some(("hashB".into(), 0)));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "exact_content");
        assert_eq!(hits[0].book_id, 2);
        // 指纹缺失（文件读不到）→ 降级为同名同作者
        let hits = duplicate_hits(&books, "/tmp/none.txt", "丙书", "作者丙", None);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "same_meta");
        assert_eq!(hits[0].book_id, 3);
        // 全不命中
        assert!(duplicate_hits(&books, "/tmp/none.txt", "无书名", "无作者", None).is_empty());
        // 空书名不做元数据比对（避免把"未填标题"当成同名）
        assert!(duplicate_hits(&books, "/tmp/none.txt", "", "", None).is_empty());
    }

    /// 导入前查重：SimHash 近似命中，按 book_id 稳定排序。
    #[test]
    fn duplicate_hits_flag_similar_and_sort() {
        let same = 0x2a2a_2a2a_2a2a_2a2ai64;
        let books = vec![
            book(1, "原本", "", "/p1", "h1", same),
            book(2, "另存", "", "/p2", "h2", same),
        ];
        let hits = duplicate_hits(&books, "/tmp/none", "", "", Some(("hX".into(), same)));
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.kind == "similar"));
        assert!(hits.iter().all(|h| h.similarity == 100));
        assert_eq!(hits[0].book_id, 1);
        assert_eq!(hits[1].book_id, 2);
    }

    /// 全库查重：内容指纹组 / 同源文件组 / SimHash 近似组，且精确组内的书不重复进近似组。
    #[test]
    fn scan_book_duplicates_groups_by_reason() {
        let books = vec![
            book(1, "甲", "", "/same.txt", "HASH_X", 0x2a2a_2a2a_2a2a_2a2a),
            book(2, "甲副本", "", "/other.txt", "HASH_X", 0x2a2a_2a2a_2a2a_2a2a),
            book(3, "同路径", "", "/same.txt", "HASH_Y", 0x5a5a_5a5a_5a5a_5a5a),
            book(4, "近邻A", "", "/n1", "HA", 0x0f0f_0f0f_0f0f_0f0f),
            book(5, "近邻B", "", "/n2", "HB", 0x0f0f_0f0f_0f0f_0f0f),
        ];
        let (exact, similar) = scan_book_duplicates(&books);
        assert_eq!(exact.len(), 2);
        let by_hash = exact.iter().find(|g| g.reason == "content_hash").unwrap();
        assert_eq!(by_hash.similarity, 100);
        assert_eq!(
            by_hash.books.iter().map(|b| b.id).collect::<Vec<_>>(),
            vec![1, 2]
        );
        let by_path = exact.iter().find(|g| g.reason == "source_path").unwrap();
        assert_eq!(
            by_path.books.iter().map(|b| b.id).collect::<Vec<_>>(),
            vec![1, 3]
        );
        // 近似组只含 4、5（1、2 已被精确组占用）
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].reason, "simhash");
        assert_eq!(
            similar[0].books.iter().map(|b| b.id).collect::<Vec<_>>(),
            vec![4, 5]
        );
        assert_eq!(similar[0].similarity, 100);
    }

    /// 全库查重：内容指纹相同 → 精确分组；归一化忽略空白与换行差异。
    #[test]
    fn scan_book_duplicates_is_whitespace_insensitive() {
        use crate::domain::corpus::fingerprint;
        let t1 = "山风很大。\n他回头看了一眼。";
        let t2 = "山风很大。他回头   看了一眼。";
        let h = fingerprint::content_fingerprint(t1);
        assert_eq!(h, fingerprint::content_fingerprint(t2));
        let books = vec![
            book(1, "正本", "", "/x", &h, 0),
            book(2, "异版", "", "/y", &h, 0),
        ];
        let (exact, _) = scan_book_duplicates(&books);
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].reason, "content_hash");
    }

    /// B2 降级：CorpusState 不可用时 repo() 返回带原因的统一错误；就绪时正常可用。
    #[test]
    fn corpus_state_degrades_with_reason() {
        let bad = CorpusState::unavailable("disk I/O error");
        assert!(!bad.is_available());
        // repo() 的 Ok 型（&Arc<repo>）未实现 Debug，用 match 取错而非 unwrap_err
        let err = match bad.repo() {
            Err(e) => e.to_string(),
            Ok(_) => panic!("unavailable state must not yield a repo"),
        };
        assert!(err.contains("corpus library unavailable"), "got: {err}");
        assert!(err.contains("disk I/O error"), "got: {err}");

        let ok = CorpusState::ready(Arc::new(SqliteCorpusRepository::new(Arc::new(
            crate::infrastructure::database::CorpusDatabase::open_in_memory().unwrap(),
        ))));
        assert!(ok.is_available());
        assert_eq!(ok.unavailable_message(), "");
        assert!(ok.repo().is_ok());
    }

    /// P2-4 端到端维护冒烟：真实临时文件走通「导入 → 单本重建 → 全库扫描查重 → 删除」全链路。
    /// 断言数据层每一步的实质效果：镜像归档、陈旧索引重建恢复、content_hash 精确分组、删除级联清索引。
    #[test]
    fn maintenance_smoke_import_rebuild_scan_delete() {
        use crate::domain::corpus::pipeline::parse_text;
        use crate::infrastructure::database::{
            corpus_repository::CorpusRepository, CorpusDatabase,
        };
        let repo = SqliteCorpusRepository::new(std::sync::Arc::new(
            CorpusDatabase::open_in_memory().unwrap(),
        ));
        let dir = std::env::temp_dir().join(format!("sf_corpus_smoke_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file_a = dir.join("正本.txt");
        let file_b = dir.join("副本.txt");
        let text = "第一章 出山\n\n山风很大。他回头看见了孤独的山谷！\n\n第二章 入世\n\n孤独是宿命……";
        std::fs::write(&file_a, text).unwrap();
        std::fs::write(&file_b, text).unwrap();
        let path_a = file_a.to_string_lossy().to_string();
        let path_b = file_b.to_string_lossy().to_string();

        // ① 导入（读真实文件 → 抽取 → 切分 → 入库 + 镜像归档）
        let (raw_a, src_a) = extract_text_by_path(&path_a, &std::fs::read(&file_a).unwrap()).unwrap();
        let parsed_a: Vec<(String, String, String)> = parse_text(&raw_a)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        assert!(!parsed_a.is_empty());
        let book_a = repo
            .import_book("正本", "作者", "zh", "", src_a, &path_a, &raw_a, &parsed_a)
            .unwrap();
        assert!(repo.get_book_source(book_a.id).unwrap().is_some(), "镜像已归档");
        assert!(!repo.search("山风很大", None, 20, 0).unwrap().is_empty());

        // ② 单本重建：先以空 chunks 模拟陈旧索引，rebuild 后恢复章句切分
        repo.replace_book_chunks(book_a.id, src_a, &raw_a, &[])
            .unwrap();
        assert_eq!(repo.get_book(book_a.id).unwrap().chunk_count, 0);
        let n = expect_rebuilt(rebuild_one(&repo, &repo.get_book(book_a.id).unwrap()));
        assert!(n >= 4, "重建后应有章+句，got {n}");
        assert_eq!(repo.get_book(book_a.id).unwrap().chunk_count, n);

        // ③ 全库查重：单本无重复；两次导入同内容后出现 content_hash 精确组
        let (exact, _) = scan_book_duplicates(&repo.list_books().unwrap());
        assert!(exact.is_empty(), "单本不应有重复组");
        let (raw_b, src_b) = extract_text_by_path(&path_b, &std::fs::read(&file_b).unwrap()).unwrap();
        let parsed_b: Vec<(String, String, String)> = parse_text(&raw_b)
            .iter()
            .map(|c| (c.kind.to_string(), c.content.clone(), c.chapter_title.clone()))
            .collect();
        let book_b = repo
            .import_book("副本", "作者", "zh", "", src_b, &path_b, &raw_b, &parsed_b)
            .unwrap();
        let (exact2, _) = scan_book_duplicates(&repo.list_books().unwrap());
        assert_eq!(exact2.len(), 1);
        assert_eq!(exact2[0].reason, "content_hash");

        // ④ 删除副本：索引/镜像级联清除，查重组消失，只剩正本
        repo.delete_book(book_b.id).unwrap();
        let (exact3, _) = scan_book_duplicates(&repo.list_books().unwrap());
        assert!(exact3.is_empty());
        let remaining = repo.list_books().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, book_a.id);
        assert!(repo.get_book_source(book_b.id).unwrap().is_none(), "副本镜像已随书删除");
        let _ = std::fs::remove_dir_all(&dir);
    }

}
