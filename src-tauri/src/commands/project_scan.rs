use crate::commands::logger::LoggerState;
use crate::domain::project_files::ProjectFile;
use crate::domain::scan_jobs::ScanJob;
use crate::error::{AppError, AppResult};
use crate::infrastructure::database::analysis_repository::AnalysisRepository;
use crate::infrastructure::database::project_dependency_repository::ProjectDependencyRepository;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_layer_repository::ProjectLayerRepository;
use crate::infrastructure::database::project_module_repository::ProjectModuleRepository;
use crate::infrastructure::database::review_finding_repository::ReviewFindingRepository;
use crate::infrastructure::database::review_rule_repository::ReviewRuleRepository;
use crate::infrastructure::database::scan_job_repository::ScanJobRepository;
use crate::infrastructure::database::{
    SqliteAnalysisRepository, SqliteProjectDependencyRepository, SqliteProjectFileRepository,
    SqliteProjectLayerRepository, SqliteProjectModuleRepository, SqliteReviewFindingRepository,
    SqliteReviewRuleRepository, SqliteScanJobRepository,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// 跨阶段共享的文件内容缓存：消除每个分析阶段独立 `read_to_string` 的重复磁盘 I/O。
///
/// 键 = `path#content_hash`：
/// - 同一文件在一次扫描内（以及后续重扫内容未变时）只从磁盘读取一次；
/// - 内容变化时哈希不同 → 键失效自动重新读取，保证正确性（不存在陈旧缓存风险）；
/// - 无 `content_hash` 的文件（超大文件等保守路径）不缓存，直接读。
///
/// 命中时返回零拷贝的 `Arc<str>`（仅原子引用计数 +1），下游以 `&str` 读取零成本兼容，
/// 规避数万文件 × 16 阶段反复深拷贝整文件内容的内存与锁竞争开销。
/// 设容量上限（`MAX_ENTRIES`）防止跨项目扫描无限增长。
pub struct ScanContentCache {
    inner: Mutex<std::collections::HashMap<String, Arc<str>>>,
}

const SCAN_CONTENT_CACHE_MAX: usize = 60_000;

impl ScanContentCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// 取文件内容：命中缓存返回零拷贝的 `Arc<str>`（仅原子引用计数 +1）；
    /// 未命中从磁盘读取并写入缓存，同样以 `Arc<str>` 形式返回。
    ///
    /// 下游所有消费点仅以 `&str` 方式读取（`.lines()` / `&content` / 正则等），
    /// `Arc<str>` 通过 `Deref<Target = str>` 零成本兼容，无需逐阶段深拷贝整文件内容——
    /// 这是大仓（数万文件 × 16 阶段）扫描的内存与锁竞争关键优化。
    pub fn read(&self, file: &ProjectFile) -> Option<Arc<str>> {
        let hash = file.content_hash.as_deref().unwrap_or("");
        if !hash.is_empty() {
            let key = format!("{}#{}", file.path, hash);
            if let Ok(g) = self.inner.lock() {
                if let Some(c) = g.get(&key) {
                    return Some(Arc::clone(c));
                }
            }
            return match std::fs::read_to_string(&file.path) {
                Ok(s) => {
                    let arc: Arc<str> = Arc::from(s.as_str());
                    if let Ok(mut g) = self.inner.lock() {
                        if g.len() < SCAN_CONTENT_CACHE_MAX {
                            g.insert(key, Arc::clone(&arc));
                        }
                    }
                    Some(arc)
                }
                Err(e) => {
                    eprintln!("[ScanContentCache] read {} failed: {}", file.path, e);
                    None
                }
            };
        }
        std::fs::read_to_string(&file.path).ok().map(Arc::from)
    }

    /// 清空缓存（扫描开始时调用，把内存控制在单次扫描工作集内）。
    pub fn clear(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.clear();
        }
    }
}

/// 默认排除的目录（项目扫描时跳过）
///
/// 两层防线：① 若项目根目录存在 `.gitignore`，ignore crate 会按它过滤
/// （require_git(false)：非 git 仓库目录下 `.gitignore` 同样生效）—— 那是
/// 项目作者自己声明的「与业务无关」清单，比任何内置表都准；
/// ② 下表是**兜底**：即使没有 `.gitignore`，这些目录也绝不该进画像
/// （node_modules 几万文件、target 编译产物、.git 历史），否则树直接爆炸。
const DEFAULT_EXCLUDES: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".cache",
    ".parcel-cache",
    "coverage",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    "env",
    ".idea",
    ".vscode",
    ".DS_Store",
    "logs",
    // R40：常见「与业务无关」目录（生成代码 / 第三方 / 测试夹具 / 补丁）
    "vendor",
    "third_party",
    "thirdparty",
    "patches",
    "gen",
    ".storybook",
    "fixtures",
    "__fixtures__",
    "testdata",
    "mock_data",
];

/// 非代码资源文件扩展名（默认不建画像；可在扫描设置里关闭）。
/// 字体 / 媒体 / 压缩包 / 二进制 / 文档 —— 对代码分析零信息量，
/// 但 public/ 或 assets/ 下几百个 woff 会让目录树和画像凭空膨胀。
///
/// 注意：**图片已从忽略名单移除**——图片是项目里真实存在的资源（图标/插画/截图），
/// 用户需要在实体图鉴与画布上识别并看到它们，故始终纳入枚举，落库为 `image` 实体
/// （不进入结构/依赖/调用分析，仅枚举 + 计数 + 体积统计）。
const IGNORED_FILE_EXTS: &[&str] = &[
    // 字体
    "woff", "woff2", "ttf", "otf", "eot", // 媒体
    "mp4", "mp3", "wav", "webm", "avi", "mov", "mkv", "flac", "ogg", // 压缩包
    "zip", "gz", "tar", "7z", "rar", "xz", "bz2", "zst", // 二进制 / 编译产物
    "exe", "dll", "so", "dylib", "o", "a", "lib", "rlib", "rmeta", "bin", "wasm", "class", "jar",
    "dmg", "pkg", "msi", "apk", "ipa", "war", "deb", "rpm", // 文档 / 数据
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "db", "sqlite", "sqlite3",
];

/// 锁文件 / 生成文件（精确名，不建画像）
const IGNORED_FILE_NAMES: &[&str] = &[
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "bun.lock",
    "Cargo.lock",
    "go.sum",
    "composer.lock",
    "Gemfile.lock",
    "poetry.lock",
    "Pipfile.lock",
    "flake.lock",
];

/// 生成文件后缀（*.min.js / *.min.css / *.map —— 压缩产物与 sourcemap）
fn has_ignored_suffix(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".min.js") || lower.ends_with(".min.css") || lower.ends_with(".map")
}

/// 判断是否为非代码资源文件（默认不建画像；扫描设置里可整体关闭）
fn is_ignored_file(path: &Path, exclude_resources: bool) -> bool {
    if !exclude_resources {
        return false;
    }
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if IGNORED_FILE_NAMES
            .iter()
            .any(|e| e.eq_ignore_ascii_case(name))
        {
            return true;
        }
        if has_ignored_suffix(name) {
            return true;
        }
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if IGNORED_FILE_EXTS
                .iter()
                .any(|e| e.eq_ignore_ascii_case(ext))
            {
                return true;
            }
        }
    }
    false
}

/// 根据扩展名识别编程语言
/// 语言检测：代码语言由 ParserRegistry 驱动（R45 插件化，单一事实源）；
/// 非代码语言（配置/数据/文档）用兜底扩展名表。
pub fn detect_language(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    // 1) 先问解析器注册表（代码语言）
    if let Some(lang) = crate::parser::registry().detect_language(&ext) {
        return Some(lang.to_string());
    }
    // 2) 非代码语言兜底表（不参与结构/依赖/调用分析，仅枚举与行数统计）
    Some(
        match ext.as_str() {
            "html" | "htm" => "html",
            "css" | "scss" | "sass" | "less" => "css",
            "json" | "jsonc" => "json",
            "md" | "mdx" => "markdown",
            "yml" | "yaml" => "yaml",
            "toml" => "toml",
            "xml" => "xml",
            "sh" | "bash" | "zsh" => "shell",
            "sql" => "sql",
            "lua" => "lua",
            "dart" => "dart",
            // 图片资源：纳入枚举，落库为 image 实体（不进结构/依赖分析）
            // 与前端 fileKind.ts 的 IMAGE_EXTENSIONS 保持一致（icon 一类用户明确点名）
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico" | "bmp" | "tiff" | "tif"
            | "avif" | "heic" | "heif" | "jxl" | "apng" | "jfif" | "jpe" | "icns" | "cur" => {
                "image"
            }
            // 资源文件（字体/媒体/压缩包/其它二进制）：纳入枚举，落库为 asset 实体
            // （不进结构/依赖/调用分析，仅枚举与体积统计；与 image 同级的一等资源实体）
            "ttf" | "otf" | "woff" | "woff2" | "eot" => "asset", // 字体
            "mp4" | "webm" | "mov" | "avi" | "mkv" | "mp3" | "wav" | "flac" | "ogg" | "aac"
            | "m4a" | "mid" | "midi" => "asset", // 音视频
            "zip" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "7z" | "rar" => "asset", // 压缩包
            "pdf" | "wasm" | "bin" | "dat" | "dll" | "so" | "dylib" | "exe" | "o" | "a"
            | "class" | "jar" | "pak" => "asset", // 其它二进制
            _ => return None,
        }
        .to_string(),
    )
}

/// 快速统计文件行数（按 '\n' 切分；大文件不读全文，限前 1MB）
fn count_lines(path: &Path) -> i64 {
    use std::io::{BufRead, BufReader};
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return 0,
    };
    // 大于 1MB 的文件只读前 1MB 来估算
    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => return 0,
    };
    if metadata.len() > 1024 * 1024 {
        // 取 1MB 估算
        let file = std::fs::File::open(path).ok();
        if let Some(f) = file {
            use std::io::Read;
            let mut handle = f.take(1024 * 1024);
            let mut buf = Vec::new();
            if handle.read_to_end(&mut buf).is_ok() {
                let lines = buf.iter().filter(|&&b| b == b'\n').count() as i64;
                // 按比例放大估算
                return (lines as f64 * (metadata.len() as f64 / 1024.0 / 1024.0)) as i64;
            }
        }
        return 0;
    }
    let reader = BufReader::new(file);
    reader.lines().count() as i64
}

/// 计算文件内容哈希（FNV-1a 64 位，十六进制字符串）。
///
/// 用于「增量扫描」：比较本次与上次扫描的内容指纹，报告哪些文件变更 / 未变，
/// 并为未来「跳过未变更文件的深度重分析」打基础。流式读取（64KB 缓冲，
/// 上限 32MB），避免大文件一次性读入内存撑爆扫描进程。
fn compute_file_hash(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher: u64 = 0xcbf29ce484222325; // FNV-1a 偏移基值
    const PRIME: u64 = 0x100000001b3;
    let mut buf = [0u8; 65536];
    let mut total: usize = 0;
    loop {
        let n = match f.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => return None,
        };
        for &b in &buf[..n] {
            hasher ^= b as u64;
            hasher = hasher.wrapping_mul(PRIME);
        }
        total += n;
        if total >= 32 * 1024 * 1024 {
            break;
        }
    }
    Some(format!("{:016x}", hasher))
}

/// 判断路径是否在排除列表内（内置默认表 + 用户在扫描设置里手动勾选的目录）
fn is_excluded(path: &Path, extra_dirs: &std::collections::HashSet<String>) -> bool {
    for comp in path.components() {
        if let std::path::Component::Normal(name) = comp {
            if let Some(s) = name.to_str() {
                if DEFAULT_EXCLUDES.iter().any(|e| e.eq_ignore_ascii_case(s))
                    || extra_dirs.iter().any(|e| e.eq_ignore_ascii_case(s))
                {
                    return true;
                }
            }
        }
    }
    false
}

fn log_op(logger_state: &State<'_, LoggerState>, level: &str, msg: &str) {
    if let Ok(dir) = logger_state.log_dir.lock() {
        let entry = crate::commands::logger::LogEntry {
            level: level.to_string(),
            module: "ProjectScan".to_string(),
            message: msg.to_string(),
            data: None,
            timestamp: None,
        };
        let _ = crate::commands::logger::write_log(&dir, &entry);
    }
}

/// 深度分析（tree-sitter）支持的语言集合（R45 起由 ParserRegistry 能力矩阵驱动：
/// 所有声明 `capabilities.ast == true` 的 parser 及其别名都算深度支持）。
/// 用于扫描覆盖报告统计「有多少文件拿不到深度度量/克隆/技术债」。
/// 不再维护硬编码列表——新增语言 parser 时自动纳入。
fn deep_supported_languages() -> std::collections::HashSet<String> {
    let r = crate::parser::registry();
    let mut out = std::collections::HashSet::new();
    for lang in r.language_ids() {
        if let Some(caps) = r.capabilities_of(lang) {
            if caps.ast {
                // 主 id + 别名（javascript/kotlin/cpp 等）都算深度支持
                out.insert(lang.to_string());
                if let Some(p) = r.get(lang) {
                    for a in p.aliases() {
                        out.insert(a.to_string());
                    }
                }
            }
        }
    }
    out
}

/// 扫描进度事件（前端实时进度条 / 阶段指示用）
///
/// stage: 当前阶段标识（enumerate / structure / symbol / metrics / techDebt / clones / review / done / cancelled）
/// stage_index / total_stages: 统一七阶段编排的序号（scan_project 只负责 enumerate=1）
/// percent: 当前阶段内进度（0-100）
fn emit_scan_progress(
    app: &AppHandle,
    stage: &str,
    stage_index: i64,
    total_stages: i64,
    percent: i64,
    scanned: i64,
    total: i64,
    message: &str,
) {
    let _ = app.emit(
        "scan-progress",
        serde_json::json!({
            "stage": stage,
            "stageIndex": stage_index,
            "totalStages": total_stages,
            "percent": percent,
            "scanned": scanned,
            "total": total,
            "message": message,
        }),
    );
}

/// 统一扫描阶段模型（2026-08-06 重新梳理）
///
/// `projectStore.scan()` 实际串行跑 14 个阶段（枚举 → 依赖 → 审查 → 结构 →
/// 符号引用 → 调用图 → 数据流 → 度量 → 技术债 → 克隆 → Git 热点 → 变更耦合 →
/// 死代码 → 代码索引）。此前只有 5 个阶段（结构/度量/技术债/克隆/审查）向后端
/// 发了 scan-progress，且编号沿用旧的"七阶段"模型（structure=2/metrics=4/…），
/// 与真实顺序错位；其余 9 个阶段完全静默，导致进度条在调用图 / 数据流 / Git /
/// 变更耦合 / 死代码 / 索引等重活阶段长时间卡住，用户以为卡死。
///
/// 这里用单一枚举做唯一真相源：每个阶段命令只声明 `ScanStage::Xxx`，
/// `emit_stage_progress` 统一换算 `stageIndex + totalStages`，杜绝散落的魔数。
#[derive(Clone, Copy, Debug)]
pub enum ScanStage {
    Enumerate = 1,
    Deps = 2,
    Review = 3,
    Structure = 4,
    SymbolRefs = 5,
    CallGraph = 6,
    DataFlow = 7,
    Metrics = 8,
    TechDebt = 9,
    Clones = 10,
    Git = 11,
    ChangeCoupling = 12,
    DeadCode = 13,
    Index = 14,
}

/// 真实阶段总数（与 projectStore.scan() 的串行管道一一对应）
pub const SCAN_TOTAL_STAGES: i64 = 14;

/// 阶段标识 → 前端展示用字符串（与枚举判别式一一对应）
fn scan_stage_label(stage: ScanStage) -> &'static str {
    match stage {
        ScanStage::Enumerate => "enumerate",
        ScanStage::Deps => "deps",
        ScanStage::Review => "review",
        ScanStage::Structure => "structure",
        ScanStage::SymbolRefs => "symbolRefs",
        ScanStage::CallGraph => "callGraph",
        ScanStage::DataFlow => "dataFlow",
        ScanStage::Metrics => "metrics",
        ScanStage::TechDebt => "techDebt",
        ScanStage::Clones => "clones",
        ScanStage::Git => "git",
        ScanStage::ChangeCoupling => "changeCoupling",
        ScanStage::DeadCode => "deadCode",
        ScanStage::Index => "index",
    }
}

/// 语义化阶段进度发射（推荐所有扫描阶段统一走这里，不要再手填 stageIndex/totalStages）
pub fn emit_stage_progress(
    app: &AppHandle,
    stage: ScanStage,
    percent: i64,
    scanned: i64,
    total: i64,
    message: &str,
) {
    emit_scan_progress(
        app,
        scan_stage_label(stage),
        stage as i64,
        SCAN_TOTAL_STAGES,
        percent,
        scanned,
        total,
        message,
    );
}

/// 扫描覆盖报告事件（扫描结束时发出，暴露语言盲区与已排除目录）
fn emit_scan_coverage(
    app: &AppHandle,
    files: i64,
    lines: i64,
    lang_count: &std::collections::HashMap<String, i64>,
    changed: i64,
    unchanged: i64,
) {
    let supported = deep_supported_languages();
    let deep_unsupported: i64 = lang_count
        .iter()
        .filter(|(l, _)| !supported.contains(*l))
        .map(|(_, c)| *c)
        .sum();
    let _ = app.emit(
        "scan-coverage",
        serde_json::json!({
            "files": files,
            "lines": lines,
            "languages": lang_count
                .iter()
                .map(|(l, c)| serde_json::json!({ "language": l, "count": c }))
                .collect::<Vec<_>>(),
            "deepUnsupported": deep_unsupported,
            "excludedDirs": DEFAULT_EXCLUDES.len(),
            "changed": changed,
            "unchanged": unchanged,
        }),
    );
}

/// 检测项目根目录是否存在 `.gitignore`（前端据此提示：有 → 按它过滤；
/// 无 → 全部渲染并建议配置 gitignore / 用扫描设置手动过滤）
#[tauri::command]
pub fn check_gitignore(project_root: String) -> bool {
    PathBuf::from(&project_root).join(".gitignore").exists()
}

/// 扫描新鲜度体检：对比「上次扫描的枚举快照」与「当前磁盘真实文件树」，
/// 判断分析数据是否已经过时（stale）。
///
/// 这是「用户问扫描数据对不对 / AI 拿到的数据是否最新」的唯一可量化答案：
/// 不重新跑任何深度分析，只按与 `scan_project` **完全相同**的过滤规则
/// （ignore::WalkBuilder 的 gitignore + DEFAULT_EXCLUDES + is_excluded + is_ignored_file）
/// 走一遍目录，做集合差与 mtime 比对，返回：
/// - `added`：扫描之后**新增**的文件（如项目长出新目录 `server/` 后端）；
/// - `removed`：扫描之后被删除的文件；
/// - `modified`：磁盘 mtime 晚于上次扫描基线（`analyses.last_scanned_at`）的文件；
/// - `stale`：上述任一非空即为过时。
///
/// 前端据此在打开分析 / 启动 AI 分析前给出「数据可能不是最新」横幅与一键重扫入口，
/// 既让用户随时知道数据对不对，也避免 AI 静默跑在过时快照上。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFreshness {
    /// 是否存在新增/删除/修改（任何一项非空即 true）
    pub stale: bool,
    /// 上次扫描完成时间（analyses.last_scanned_at），无则 null
    pub last_scanned_at: Option<i64>,
    /// 上次扫描枚举到的文件数（不含目录）
    pub scanned_file_count: i64,
    /// 当前磁盘枚举到的文件数（不含目录，同过滤规则）
    pub current_file_count: i64,
    /// 扫描后新增的文件相对路径（截断到前 500 条，真实总数见 added_count）
    pub added: Vec<String>,
    /// 扫描后删除的文件相对路径
    pub removed: Vec<String>,
    /// 扫描后改动（mtime 晚于基线）的文件相对路径
    pub modified: Vec<String>,
    /// added 真实总数（added 可能被截断）
    pub added_count: i64,
    /// removed 真实总数
    pub removed_count: i64,
    /// modified 真实总数
    pub modified_count: i64,
}

/// 单条样本上限，避免超大仓库下 IPC 负载爆炸（总数仍如实返回 *_count）
const FRESHNESS_SAMPLE_CAP: usize = 500;

#[tauri::command]
pub fn check_scan_freshness(
    analysis_id: String,
    project_root: String,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    analysis_repo: State<'_, Arc<SqliteAnalysisRepository>>,
    exclude_dirs: Option<Vec<String>>,
    exclude_resources: Option<bool>,
) -> AppResult<ScanFreshness> {
    let root = PathBuf::from(&project_root);
    if !root.exists() {
        return Err(AppError::Internal(format!("路径不存在: {}", project_root)));
    }

    let extra_dirs: std::collections::HashSet<String> = exclude_dirs
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .collect();
    let exclude_resources = exclude_resources.unwrap_or(true);

    // 1) 上次扫描的枚举快照（rel_path -> 是否存在即可，目录不计）
    let stored = file_repo.list_by_analysis(&analysis_id).unwrap_or_default();
    let mut stored_rel: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut scanned_file_count = 0i64;
    for f in &stored {
        if f.is_directory {
            continue;
        }
        scanned_file_count += 1;
        stored_rel.insert(f.rel_path.trim_start_matches('/').to_string());
    }

    // 2) 上次扫描完成时间作为「改动」判定的统一基线
    let last_scanned_at = analysis_repo
        .get_analysis_by_id(&analysis_id)
        .ok()
        .flatten()
        .and_then(|a| a.last_scanned_at);
    let baseline = last_scanned_at.unwrap_or(0);

    // 3) 当前磁盘文件树：与 scan_project 完全一致的过滤规则
    let walker = ignore::WalkBuilder::new(&root)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .ignore(false)
        .hidden(false)
        .require_git(false)
        .filter_entry(move |e| !is_excluded(e.path(), &extra_dirs))
        .build();

    let mut current: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut added_all: Vec<String> = Vec::new();
    let mut modified_all: Vec<String> = Vec::new();
    for entry in walker.filter_map(|e| e.ok()) {
        let p = entry.into_path();
        if p == root || p.is_dir() {
            continue;
        }
        if is_ignored_file(&p, exclude_resources) {
            continue;
        }
        let rel = p
            .strip_prefix(&root)
            .unwrap_or(&p)
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_string();
        if rel.is_empty() {
            continue;
        }
        current.insert(rel.clone());
        // 改动判定：磁盘 mtime 晚于扫描基线
        let mtime = std::fs::metadata(&p)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        if stored_rel.contains(&rel) {
            if baseline > 0 && mtime > baseline {
                modified_all.push(rel);
            }
        } else {
            added_all.push(rel);
        }
    }

    // 4) 移除：库里有、磁盘没有
    let removed_all: Vec<String> = stored_rel.difference(&current).cloned().collect();

    let stale = !(added_all.is_empty() && removed_all.is_empty() && modified_all.is_empty());

    // 截断样本，保留真实总数
    let added = added_all
        .iter()
        .take(FRESHNESS_SAMPLE_CAP)
        .cloned()
        .collect();
    let removed = removed_all
        .iter()
        .take(FRESHNESS_SAMPLE_CAP)
        .cloned()
        .collect();
    let modified = modified_all
        .iter()
        .take(FRESHNESS_SAMPLE_CAP)
        .cloned()
        .collect();

    Ok(ScanFreshness {
        stale,
        last_scanned_at,
        scanned_file_count,
        current_file_count: current.len() as i64,
        added,
        removed,
        modified,
        added_count: added_all.len() as i64,
        removed_count: removed_all.len() as i64,
        modified_count: modified_all.len() as i64,
    })
}

/// 同步执行项目扫描（CLI/UI 直接调用）
///
/// 返回 (scan_job_id, file_count)
/// - `exclude_dirs`：用户在扫描设置里手动勾选的额外排除目录（合并进内置默认表）
/// - `exclude_resources`：是否排除非代码资源文件（图片/字体/媒体/二进制/锁文件，默认 true）
/// - 若项目根存在 `.gitignore`，按其规则过滤（require_git(false)，非 git 仓库同样生效）
#[tauri::command(async)]
pub fn scan_project(
    analysis_id: String,
    project_root: String,
    app: AppHandle,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    analysis_repo: State<'_, Arc<SqliteAnalysisRepository>>,
    job_repo: State<'_, Arc<SqliteScanJobRepository>>,
    layer_repo: State<'_, Arc<SqliteProjectLayerRepository>>,
    logger_state: State<'_, LoggerState>,
    cancel: State<'_, AnalysisCancelState>,
    cache: State<'_, ScanContentCache>,
    exclude_dirs: Option<Vec<String>>,
    exclude_resources: Option<bool>,
) -> AppResult<ScanJob> {
    // 扫描开始清缓存：内存控制在本次扫描工作集内（重扫内容未变时仍会重新命中）
    cache.clear();
    log_op(
        &logger_state,
        "info",
        &format!("开始扫描: analysis={}, root={}", analysis_id, project_root),
    );

    let root = PathBuf::from(&project_root);
    if !root.exists() {
        return Err(AppError::Internal(format!("路径不存在: {}", project_root)));
    }
    if !root.is_dir() {
        return Err(AppError::Internal(format!("不是目录: {}", project_root)));
    }

    // 复位深度分析取消标志（避免上次取消残留影响本次扫描）
    analysis_cancel_set(&cancel, &analysis_id, false);

    let extra_dirs: std::collections::HashSet<String> = exclude_dirs
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .collect();
    let exclude_resources = exclude_resources.unwrap_or(true);
    if !extra_dirs.is_empty() {
        let joined = extra_dirs.iter().cloned().collect::<Vec<_>>().join(", ");
        log_op(&logger_state, "info", &format!("额外排除目录: {}", joined));
    }
    let has_gitignore = root.join(".gitignore").exists();
    log_op(
        &logger_state,
        "info",
        &format!(
            "gitignore: {}（{}）",
            root.join(".gitignore").display(),
            if has_gitignore {
                "已检测到，按其规则过滤"
            } else {
                "未检测到，使用内置默认排除；可在扫描设置里手动过滤"
            }
        ),
    );

    // 1. 创建 scan_job
    let mut job = ScanJob {
        analysis_id: analysis_id.clone(),
        status: "running".to_string(),
        started_at: Some(chrono::Utc::now().timestamp()),
        ..Default::default()
    };
    job_repo.save(&job)?;
    let job_id = job.id.clone();

    // 2. 清空旧扫描结果（先记录上次扫描的内容哈希，供增量对比）
    let previous_hashes: std::collections::HashMap<String, String> = file_repo
        .list_by_analysis(&analysis_id)
        .ok()
        .map(|fs| {
            fs.into_iter()
                .filter(|f| !f.is_directory)
                .filter_map(|f| f.content_hash.map(|h| (f.rel_path, h)))
                .collect()
        })
        .unwrap_or_default();
    file_repo.delete_by_analysis(&analysis_id)?;

    // 2b. 把上一轮文件指纹快照落盘（data/scan_snapshots/{analysis_id}.json），
    //     供后续增量重扫（get_scan_delta）判定哪些文件真正变更、可跳过深度重分析。
    //     这是「增量重扫」的唯一真相源，不改动任何枚举 / 分层 / id 生成逻辑。
    //
    //     刻意不写进 analysis.metadata：大仓库快照可达数 MB，塞进随处读取的
    //     metadata 列会拖慢每一次 analysis 读取；快照本质是缓存，丢了只是退化为全量。
    write_scan_snapshot(&analysis_id, &previous_hashes);

    // 3. 第一遍：枚举所有文件 + 目录，统计总数
    //    ignore crate 的 WalkBuilder：git_ignore(true) 按 .gitignore 过滤
    //    （require_git(false)：目录不在 git 仓库内也认根目录的 .gitignore），
    //    git_global(false) 不读用户全局 ignore（行为可预期），
    //    hidden(false) 保留点开头文件（.github/.gitlab 对分析有意义）。
    let walker = ignore::WalkBuilder::new(&root)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .ignore(false)
        .hidden(false)
        .require_git(false)
        // 注意：filter_entry 是 WalkBuilder 的方法（过滤目录会剪掉整个子树），
        // 不是 Walk 的方法 —— 目录级排除在这里做
        .filter_entry(move |e| !is_excluded(e.path(), &extra_dirs))
        .build();
    // 文件级排除（非代码资源）在收集时做：跳过文件本身，不影响其父目录
    let entries: Vec<PathBuf> = walker
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        .filter(|p| p != &root && !(p.is_file() && is_ignored_file(p, exclude_resources)))
        .collect();

    job.total_files = entries.len() as i64;
    job_repo.save(&job)?;

    // 3b. 预扫描：收集顶层目录名，并准备「目录名 → layer id」映射（用于自动分层）
    let mut top_level_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in &entries {
        if e == &root {
            continue;
        }
        let rel = e
            .strip_prefix(&root)
            .unwrap_or(e)
            .to_string_lossy()
            .replace('\\', "/");
        if rel == "." {
            continue;
        }
        if e.is_dir() && !rel.contains('/') {
            top_level_dirs.insert(rel);
        }
    }
    let mut layer_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // 4. 第二遍：建立父子关系，先建目录（parent_id = 自身父目录）
    let root_id = format!("dir_root_{}", analysis_id);

    // 4a. 先创建根目录节点
    let root_node = ProjectFile {
        id: root_id.clone(),
        analysis_id: analysis_id.clone(),
        path: root.to_string_lossy().to_string(),
        rel_path: ".".to_string(),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| project_root.clone()),
        extension: None,
        language: None,
        size: 0,
        line_count: 0,
        content_hash: None,
        parent_id: None,
        is_directory: true,
        layer_id: None,
        x: 0.0,
        y: 0.0,
        width: 200.0,
        height: 48.0,
        metadata: "{}".to_string(),
        scanned_at: chrono::Utc::now().timestamp(),
    };
    let mut batch = vec![root_node];

    // 4b. 路径 → id 映射（用于父级查找）
    let mut path_to_id: std::collections::HashMap<PathBuf, String> =
        std::collections::HashMap::new();
    path_to_id.insert(root.clone(), root_id.clone());

    // 5. 遍历所有 entry，建立父子关系
    let mut total_lines: i64 = 0;
    let mut lang_count: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    let mut scanned: i64 = 0;
    let mut cancelled = false;
    // 增量扫描计数：文件总数 / 内容未变 / 与上次扫描命中的文件数
    let mut file_count: i64 = 0;
    let mut unchanged: i64 = 0;
    let mut prev_matched: i64 = 0;

    for entry in &entries {
        if entry == &root {
            continue;
        }
        scanned += 1;

        let is_dir = entry.is_dir();
        let parent_path = entry.parent().unwrap_or(&root).to_path_buf();
        let parent_id = path_to_id
            .get(&parent_path)
            .cloned()
            .unwrap_or_else(|| root_id.clone());

        let rel_path = entry
            .strip_prefix(&root)
            .unwrap_or(entry)
            .to_string_lossy()
            .replace('\\', "/");

        let name = entry
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let extension = entry
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase());

        let language = if !is_dir {
            detect_language(entry)
        } else {
            None
        };

        let (size, line_count) = if !is_dir {
            let metadata = std::fs::metadata(entry).ok();
            let size = metadata.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            // 图片/资源是二进制，count_lines 按 '\n' 统计出的"行数"无意义，直接置 0
            let lc = if matches!(language.as_deref(), Some("image" | "asset")) {
                0
            } else {
                count_lines(entry)
            };
            (size, lc)
        } else {
            (0, 0)
        };

        // 增量扫描：计算内容哈希并与上次扫描对比
        let content_hash = if !is_dir {
            file_count += 1;
            let h = compute_file_hash(entry);
            if let Some(ref hash) = h {
                if previous_hashes.contains_key(&rel_path) {
                    prev_matched += 1;
                    if previous_hashes.get(&rel_path) == Some(hash) {
                        unchanged += 1;
                    }
                }
            }
            h
        } else {
            None
        };

        if let Some(ref lang) = language {
            *lang_count.entry(lang.clone()).or_insert(0) += 1;
        }
        total_lines += line_count;

        let id = if is_dir {
            format!("dir_{}", uuid::Uuid::new_v4().to_string().replace("-", ""))
        } else {
            format!("file_{}", uuid::Uuid::new_v4().to_string().replace("-", ""))
        };

        path_to_id.insert(entry.clone(), id.clone());

        // 计算所属架构分层（仅当文件位于已识别的顶层目录下）
        let layer_id = if !is_dir {
            let top = rel_path.split('/').next().unwrap_or(&rel_path);
            if top_level_dirs.contains(top) {
                Some(
                    layer_ids
                        .entry(top.to_string())
                        .or_insert_with(|| {
                            format!(
                                "layer_{}",
                                uuid::Uuid::new_v4().to_string().replace("-", "")
                            )
                        })
                        .clone(),
                )
            } else {
                None
            }
        } else {
            None
        };

        batch.push(ProjectFile {
            id,
            analysis_id: analysis_id.clone(),
            path: entry.to_string_lossy().to_string(),
            rel_path,
            name,
            extension,
            language,
            size,
            line_count,
            content_hash,
            parent_id: Some(parent_id),
            is_directory: is_dir,
            layer_id: layer_id.clone(),
            x: 0.0,
            y: 0.0,
            width: if is_dir { 200.0 } else { 160.0 },
            height: if is_dir { 48.0 } else { 48.0 },
            metadata: "{}".to_string(),
            scanned_at: chrono::Utc::now().timestamp(),
        });

        // 每 500 个 entry 批量入库一次 + 更新进度
        if batch.len() >= 500 {
            file_repo.save_batch(&batch)?;
            batch.clear();
            job.files_scanned = scanned;
            job.progress = ((scanned as f64 / job.total_files.max(1) as f64) * 100.0) as i64;
            job_repo.save(&job)?;

            // 实时进度事件（前端进度条 / 阶段指示）
            emit_stage_progress(
                &app,
                ScanStage::Enumerate,
                job.progress,
                scanned,
                job.total_files,
                "正在枚举文件…",
            );

            // 取消检查：cancel_scan_job 会把 ScanJob.status 翻成 cancelled，
            // 这里每批读一次 DB 状态，命中即中断遍历（此前取消形同虚设）。
            // 同时兼容前端 cancel_analysis 置位的共享取消标志。
            let job_cancelled = job_repo
                .get(&job_id)
                .ok()
                .flatten()
                .map(|j| j.status == "cancelled")
                .unwrap_or(false);
            if job_cancelled || analysis_cancelled(&cancel, &analysis_id) {
                cancelled = true;
                break;
            }
        }
    }

    // 6. 入库剩余
    if !batch.is_empty() {
        file_repo.save_batch(&batch)?;
    }

    // 6b. 取消提前收尾：已入库的部分文件保留，标记 job 为 cancelled 并发覆盖报告
    if cancelled {
        job.status = "cancelled".to_string();
        job.progress = ((scanned as f64 / job.total_files.max(1) as f64) * 100.0) as i64;
        job.files_scanned = scanned;
        job.finished_at = Some(chrono::Utc::now().timestamp());
        job_repo.save(&job)?;
        emit_scan_coverage(
            &app,
            scanned,
            total_lines,
            &lang_count,
            file_count + previous_hashes.len() as i64 - prev_matched - unchanged,
            unchanged,
        );
        emit_scan_progress(
            &app,
            "cancelled",
            SCAN_TOTAL_STAGES,
            SCAN_TOTAL_STAGES,
            job.progress,
            scanned,
            job.total_files,
            "扫描已取消",
        );
        log_op(
            &logger_state,
            "warn",
            &format!(
                "扫描被取消：已处理 {} / {} 个 entry",
                scanned, job.total_files
            ),
        );
        return Ok(job);
    }

    // 7. 更新 analyses 表的统计字段
    if let Ok(Some(mut analysis)) = analysis_repo.get_analysis_by_id(&analysis_id) {
        analysis.scan_status = "ready".to_string();
        analysis.scan_progress = 100;
        analysis.last_scanned_at = Some(chrono::Utc::now().timestamp());
        analysis.total_files = scanned;
        analysis.total_lines = total_lines;
        analysis.primary_language = lang_count
            .iter()
            .max_by_key(|(_, c)| *c)
            .map(|(lang, _)| lang.clone());
        let _ = analysis_repo.save_analysis(&analysis);
    }

    // 7b. 自动生成架构分层（依据扫描到的顶层目录，按名称排序后赋予顺序与配色）
    {
        let layer_palette = [
            "#6366F1", "#10B981", "#F59E0B", "#EC4899", "#06B6D4", "#8B5CF6", "#EF4444", "#14B8A6",
        ];
        let mut sorted: Vec<(&String, &String)> = layer_ids.iter().collect();
        sorted.sort_by(|a, b| a.0.cmp(b.0));
        let now = chrono::Utc::now().timestamp();
        let mut layer_list: Vec<ProjectLayer> = Vec::new();
        for (idx, (dir_name, lid)) in sorted.iter().enumerate() {
            let dir_ref: &String = dir_name;
            let lid_ref: &String = lid;
            layer_list.push(ProjectLayer {
                id: lid_ref.clone(),
                analysis_id: analysis_id.clone(),
                name: dir_ref.clone(),
                color: layer_palette[idx % layer_palette.len()].to_string(),
                sort_order: idx as i64,
                y_position: 80.0 + idx as f64 * 140.0,
                description: Some(format!("由目录 `{}` 自动识别的架构分层", dir_ref)),
                rule_pattern: Some(format!("{}/*", dir_ref)),
                metadata: "{}".to_string(),
                created_at: now,
                updated_at: now,
            });
        }
        if !layer_list.is_empty() {
            let _ = layer_repo.delete_by_analysis(&analysis_id);
            for l in &layer_list {
                let _ = layer_repo.save(l);
            }
            log_op(
                &logger_state,
                "info",
                &format!("自动生成 {} 个架构分层", layer_list.len()),
            );
        }
    }

    // 8. 标记 job 完成
    job.status = "done".to_string();
    job.progress = 100;
    job.files_scanned = scanned;
    job.finished_at = Some(chrono::Utc::now().timestamp());
    job_repo.save(&job)?;

    // 扫描覆盖报告（暴露语言盲区 / 已排除目录），供前端展示「我扫了什么、漏了什么」
    emit_scan_coverage(
        &app,
        scanned,
        total_lines,
        &lang_count,
        file_count + previous_hashes.len() as i64 - prev_matched - unchanged,
        unchanged,
    );
    emit_scan_progress(
        &app,
        "done",
        SCAN_TOTAL_STAGES,
        SCAN_TOTAL_STAGES,
        100,
        scanned,
        job.total_files,
        "文件枚举完成",
    );

    log_op(
        &logger_state,
        "info",
        &format!(
            "扫描完成: {} 个 entry，总行数 {}, 主要语言 {:?}",
            scanned, total_lines, job_id
        ),
    );

    Ok(job)
}

/// 将扫描结果同步到画布（生成网格布局并按目录分组写入 analysis.editor_components）
#[tauri::command(async)]
pub fn sync_files_to_canvas(
    analysis_id: String,
    project_root: String,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    analysis_repo: State<'_, Arc<SqliteAnalysisRepository>>,
) -> AppResult<()> {
    let files = file_repo.list_by_analysis(&analysis_id)?;

    // 按顶层目录分组（排除目录本身）
    let mut groups: std::collections::HashMap<String, Vec<ProjectFile>> =
        std::collections::HashMap::new();
    for f in &files {
        if f.is_directory {
            continue;
        }
        let top_dir = f.rel_path.split('/').next().unwrap_or("root");
        groups
            .entry(top_dir.to_string())
            .or_default()
            .push(f.clone());
    }

    // 网格布局参数
    let cols = 8i64;
    let col_w = 180.0;
    let row_h = 70.0;
    let header_h = 40.0;

    // 构建画布组件 JSON 数组
    #[derive(serde::Serialize)]
    struct CanvasComponent {
        id: String,
        name: String,
        #[serde(rename = "type")]
        comp_type: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        config: serde_json::Value,
        parent_id: Option<String>,
    }

    let mut canvas_components: Vec<CanvasComponent> = Vec::new();

    let mut group_index = 0i64;
    let mut dirs_sorted: Vec<(&String, &Vec<ProjectFile>)> = groups.iter().collect();
    dirs_sorted.sort_by(|a, b| a.0.cmp(b.0));

    for (dir_name, dir_files) in dirs_sorted {
        // 目录标题节点
        let dir_id = format!(
            "canvas_dir_{}",
            uuid::Uuid::new_v4().to_string().replace("-", "")
        );
        let group_y = 40.0
            + group_index as f64
                * (header_h + row_h * ((dir_files.len() as f64 / cols as f64).ceil()) + 60.0);

        canvas_components.push(CanvasComponent {
            id: dir_id.clone(),
            name: dir_name.clone(),
            comp_type: "folder".to_string(),
            x: 40.0,
            y: group_y,
            width: 200.0,
            height: header_h,
            config: serde_json::json!({ "isGroupHeader": true, "fileCount": dir_files.len() }),
            parent_id: None,
        });

        // 文件节点
        for (i, file) in dir_files.iter().enumerate() {
            let col = i as i64 % cols;
            let row = i as i64 / cols;
            let fx = 40.0 + col as f64 * col_w;
            let fy = group_y + header_h + row as f64 * row_h;

            let rel_path = std::path::Path::new(&file.path)
                .strip_prefix(&project_root)
                .unwrap_or(std::path::Path::new(&file.path))
                .to_string_lossy()
                .replace('\\', "/");

            canvas_components.push(CanvasComponent {
                id: format!(
                    "canvas_file_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                name: file.name.clone(),
                // 图片/资源落库为独立 image/asset 实体（图鉴/画布一等公民），其余仍是 file
                comp_type: match file.language.as_deref() {
                    Some(lang @ ("image" | "asset")) => lang.to_string(),
                    _ => "file".to_string(),
                },
                x: fx,
                y: fy,
                width: 160.0,
                height: 48.0,
                config: serde_json::json!({
                    "fileName": file.name,
                    "language": file.language,
                    "fileSize": file.size,
                    "lineCount": file.line_count,
                    "filePath": rel_path,
                    "extension": file.extension,
                }),
                parent_id: Some(dir_id.clone()),
            });
        }
        group_index += 1;
    }

    // 序列化为 JSON 并写入 analysis
    let components_json = serde_json::to_string(&canvas_components)
        .map_err(|e| AppError::Internal(format!("序列化画布组件失败: {}", e)))?;

    if let Ok(Some(mut analysis)) = analysis_repo.get_analysis_by_id(&analysis_id) {
        analysis.editor_components = Some(components_json);
        analysis.updated_at = chrono::Utc::now().timestamp();
        analysis_repo.save_analysis(&analysis)?;
    }

    Ok(())
}

/// 读取目录内容（供前端 ProjectDirAdapter 使用）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
    extension: Option<String>,
}

#[tauri::command(async)]
pub fn read_directory(path: String) -> AppResult<Vec<DirEntry>> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(AppError::Internal(format!("不是目录: {}", path)));
    }

    let mut entries = Vec::new();
    let read_dir =
        std::fs::read_dir(dir).map_err(|e| AppError::Internal(format!("读取目录失败: {}", e)))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| AppError::Internal(format!("读取目录项失败: {}", e)))?;
        let metadata = entry.metadata().ok();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let extension = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase());

        entries.push(DirEntry {
            name,
            path: full_path,
            is_directory: is_dir,
            size,
            extension,
        });
    }

    // 排序：目录在前，然后按名称排序
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(entries)
}

/// 获取 Git 仓库信息（供前端 GitRepoAdapter 使用）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    url: String,
    branch: Option<String>,
    last_commit: Option<String>,
    last_commit_message: Option<String>,
    is_repo: bool,
}

/// 规范化并校验项目目录：必须存在、是目录、绝对路径。
/// 外部命令（git 等）的 cwd 一律经此校验，杜绝相对路径与不存在路径直接进入子进程。
fn canonical_dir(path: &str) -> AppResult<std::path::PathBuf> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(crate::error::AppError::Internal(format!(
            "路径必须是绝对路径: {path}"
        )));
    }
    let canonical = p.canonicalize().map_err(|e| {
        crate::error::AppError::Internal(format!("路径不存在或无法访问: {path} ({e})"))
    })?;
    if !canonical.is_dir() {
        return Err(crate::error::AppError::Internal(format!(
            "路径不是目录: {path}"
        )));
    }
    Ok(canonical)
}

#[tauri::command(async)]
pub fn get_git_repo_info(path: String) -> AppResult<GitRepoInfo> {
    use std::process::Command;

    let root = canonical_dir(&path)?;
    let git_dir = root.join(".git");
    if !git_dir.exists() {
        return Ok(GitRepoInfo {
            url: path,
            branch: None,
            last_commit: None,
            last_commit_message: None,
            is_repo: false,
        });
    }
    let root_str = root.to_string_lossy().to_string();

    let branch = Command::new("git")
        .args(["-C", &root_str, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    let last_commit = Command::new("git")
        .args(["-C", &root_str, "rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    let last_commit_message = Command::new("git")
        .args(["-C", &root_str, "log", "-1", "--format=%s"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    Ok(GitRepoInfo {
        url: path,
        branch,
        last_commit,
        last_commit_message,
        is_repo: true,
    })
}

/// 取消正在运行的扫描任务（当前实现只更新状态）
#[tauri::command]
pub fn cancel_scan_job(
    job_id: String,
    job_repo: State<'_, Arc<SqliteScanJobRepository>>,
) -> AppResult<()> {
    if let Some(mut job) = job_repo.get(&job_id)? {
        job.status = "cancelled".to_string();
        job.finished_at = Some(chrono::Utc::now().timestamp());
        job_repo.save(&job)?;
    }
    Ok(())
}

/// 跨命令的分析取消标志。
///
/// 深度分析（结构/符号/度量/技术债/克隆/审查）在 `scan_project` 返回后才独立运行，
/// 彼时枚举阶段的 ScanJob 已是 `done`，无法复用其状态做取消。这里用一份按
/// analysis_id 索引的 `AtomicBool` 作为共享取消信号：前端 `cancel_analysis` 置位，
/// 各深度分析器在循环里读它，命中即中断。枚举阶段仍走 `cancel_scan_job`（job 状态），
/// 前端取消按钮同时调两者，覆盖整条流水线。
#[derive(Default, Clone)]
pub struct AnalysisCancelState(
    pub  std::sync::Arc<
        std::sync::Mutex<std::collections::HashMap<String, std::sync::atomic::AtomicBool>>,
    >,
);

pub fn analysis_cancel_set(state: &AnalysisCancelState, analysis_id: &str, val: bool) {
    let mut m = state.0.lock().unwrap();
    m.entry(analysis_id.to_string())
        .or_insert_with(|| std::sync::atomic::AtomicBool::new(false))
        .store(val, std::sync::atomic::Ordering::Relaxed);
}

pub fn analysis_cancelled(state: &AnalysisCancelState, analysis_id: &str) -> bool {
    state
        .0
        .lock()
        .unwrap()
        .get(analysis_id)
        .map(|f| f.load(std::sync::atomic::Ordering::Relaxed))
        .unwrap_or(false)
}

/// 设置/清除某个分析的深度分析取消标志（供前端取消按钮调用）
#[tauri::command]
pub fn cancel_analysis(
    analysis_id: String,
    cancel: State<'_, AnalysisCancelState>,
) -> AppResult<()> {
    analysis_cancel_set(&cancel, &analysis_id, true);
    Ok(())
}

/// 复位某个分析的取消标志（新扫描开始时调用，避免上次取消残留）
#[tauri::command]
pub fn reset_analysis_cancel(
    analysis_id: String,
    cancel: State<'_, AnalysisCancelState>,
) -> AppResult<()> {
    analysis_cancel_set(&cancel, &analysis_id, false);
    Ok(())
}

/// 获取某个 analysis 的最新扫描任务状态
#[tauri::command]
pub fn get_latest_scan_job(
    analysis_id: String,
    job_repo: State<'_, Arc<SqliteScanJobRepository>>,
) -> AppResult<Option<ScanJob>> {
    job_repo.latest_for_analysis(&analysis_id)
}

/// 扫描指纹快照文件路径：`<data_dir>/scan_snapshots/{analysis_id}.json`
fn scan_snapshot_path(analysis_id: &str) -> std::path::PathBuf {
    let dir = crate::infrastructure::database::connection::app_data_dir().join("scan_snapshots");
    let _ = std::fs::create_dir_all(&dir);
    // analysis_id 是内部生成的 uuid 风格 id，这里再做一次保守清洗，杜绝路径穿越
    let safe: String = analysis_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    dir.join(format!("{}.json", safe))
}

/// 写入上一轮扫描的 rel_path → content_hash 快照（失败静默：缓存丢失只退化为全量）
fn write_scan_snapshot(analysis_id: &str, hashes: &std::collections::HashMap<String, String>) {
    if let Ok(json) = serde_json::to_string(hashes) {
        let _ = std::fs::write(scan_snapshot_path(analysis_id), json);
    }
}

/// 纯函数：对比基线指纹与当前文件表，算出「内容变更 / 新增」的 rel_path。
///
/// 抽成纯函数是为了可断言测试——增量的正确性全押在这段比较上，
/// 判错一个文件就意味着画像里挂着过期数据，必须有测试兜底。
fn compute_changed_paths(
    prev: &std::collections::HashMap<String, String>,
    files: &[crate::domain::project_files::ProjectFile],
) -> Vec<String> {
    files
        .iter()
        .filter(|f| !f.is_directory)
        .filter(|f| match &f.content_hash {
            // 哈希缺失（超大文件跳过计算）时保守判定为已变更
            Some(h) => prev.get(&f.rel_path) != Some(h),
            None => true,
        })
        .map(|f| f.rel_path.clone())
        .collect()
}

/// 增量重扫：对比上一轮指纹快照与当前文件指纹，返回「内容变更 / 新增」的文件 rel_path。
///
/// 返回语义（`Option` 的两态是关键，不能退化成空数组）：
/// - `None`  —— **无基线**（首轮扫描 / 快照缺失）→ 各深度阶段全量重算。
/// - `Some(vec)` —— 有基线，vec 即变更文件；**`Some(空)` 表示「一个文件都没变」**，
///   这恰恰是增量收益最大的场景（重复扫描同一份代码），必须与 `None` 区分开。
///
/// 删除的文件**不返回**：增量阶段靠「携带未变更文件旧行 + 仅重算变更文件」自然清理，
/// 已删文件不在当前 file 表里，重映射时直接丢弃，不会留下悬挂行。
///
/// 返回值直接作为各 file_id-only 深度阶段（data_flow / metrics / tech_debt / index）
/// 的 `changed_rel_paths` 入参。
#[tauri::command]
pub fn get_scan_delta(
    analysis_id: String,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
) -> AppResult<Option<Vec<String>>> {
    let prev: std::collections::HashMap<String, String> =
        match std::fs::read_to_string(scan_snapshot_path(&analysis_id))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            Some(m) => m,
            None => return Ok(None),
        };
    if prev.is_empty() {
        return Ok(None);
    }
    let files = file_repo.list_by_analysis(&analysis_id)?;
    Ok(Some(compute_changed_paths(&prev, &files)))
}

// ─── 查询命令（前端 list_* 调用） ───

use crate::domain::project_dependencies::ProjectDependency;
use crate::domain::project_layers::ProjectLayer;
use crate::domain::project_modules::ProjectModule;
use crate::domain::review_findings::ReviewFinding;
use crate::domain::review_rules::ReviewRule;

#[tauri::command(async)]
pub fn list_project_files(
    analysis_id: String,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
) -> AppResult<Vec<ProjectFile>> {
    file_repo.list_by_analysis(&analysis_id)
}

#[tauri::command]
pub fn list_project_modules(
    analysis_id: String,
    repo: State<'_, Arc<SqliteProjectModuleRepository>>,
) -> AppResult<Vec<ProjectModule>> {
    repo.list_by_analysis(&analysis_id)
}

#[tauri::command(async)]
pub fn list_project_dependencies(
    analysis_id: String,
    repo: State<'_, Arc<SqliteProjectDependencyRepository>>,
) -> AppResult<Vec<ProjectDependency>> {
    repo.list_by_analysis(&analysis_id)
}

#[tauri::command]
pub fn list_project_layers(
    analysis_id: String,
    repo: State<'_, Arc<SqliteProjectLayerRepository>>,
) -> AppResult<Vec<ProjectLayer>> {
    repo.list_by_analysis(&analysis_id)
}

#[tauri::command]
pub fn list_review_rules(
    repo: State<'_, Arc<SqliteReviewRuleRepository>>,
) -> AppResult<Vec<ReviewRule>> {
    repo.list_all()
}

#[tauri::command(async)]
pub fn list_review_findings(
    analysis_id: String,
    repo: State<'_, Arc<SqliteReviewFindingRepository>>,
) -> AppResult<Vec<ReviewFinding>> {
    repo.list_by_analysis(&analysis_id)
}

#[tauri::command]
pub fn count_findings_by_severity(
    analysis_id: String,
    repo: State<'_, Arc<SqliteReviewFindingRepository>>,
) -> AppResult<std::collections::HashMap<String, i64>> {
    repo.count_by_severity(&analysis_id)
}

// ─── 架构分层 CRUD ───

#[tauri::command]
pub fn save_project_layer(
    layer: ProjectLayer,
    repo: State<'_, Arc<SqliteProjectLayerRepository>>,
) -> AppResult<()> {
    repo.save(&layer)
}

#[tauri::command]
pub fn delete_project_layer(
    id: String,
    repo: State<'_, Arc<SqliteProjectLayerRepository>>,
) -> AppResult<()> {
    repo.delete(&id)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn collect_files(root: &Path, extra: &[&str], exclude_resources: bool) -> Vec<String> {
        let extra_set: std::collections::HashSet<String> =
            extra.iter().map(|s| s.to_string()).collect();
        let walker = ignore::WalkBuilder::new(root)
            .follow_links(false)
            .git_ignore(true)
            .git_global(false)
            .git_exclude(false)
            .ignore(false)
            .hidden(false)
            .require_git(false)
            .filter_entry(move |e| !is_excluded(e.path(), &extra_set))
            .build();
        walker
            .filter_map(|e| e.ok())
            .map(|e| e.into_path())
            .filter(|p| p != root && !(p.is_file() && is_ignored_file(p, exclude_resources)))
            .map(|p| {
                p.strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect()
    }

    #[test]
    fn gitignore_rules_are_applied() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("generated")).unwrap();
        fs::write(dir.path().join(".gitignore"), "generated/\n*.log\n").unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.path().join("generated/out.rs"), "pub fn out() {}\n").unwrap();
        fs::write(dir.path().join("debug.log"), "noise\n").unwrap();

        let files = collect_files(dir.path(), &[], true);
        assert!(
            files.contains(&"src/main.rs".to_string()),
            "业务文件应保留: {files:?}"
        );
        assert!(
            !files.iter().any(|f| f.starts_with("generated")),
            "gitignore 的 generated/ 应被过滤: {files:?}"
        );
        assert!(
            !files.iter().any(|f| f.ends_with(".log")),
            "gitignore 的 *.log 应被过滤: {files:?}"
        );
    }

    #[test]
    fn resource_files_skipped_by_default() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("public")).unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("public/logo.png"), "png").unwrap();
        fs::write(dir.path().join("public/app.svg"), "svg").unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.path().join("package-lock.json"), "{}").unwrap();
        fs::write(dir.path().join("dist.min.js"), "min").unwrap();

        let files = collect_files(dir.path(), &[], true);
        assert!(files.contains(&"src/main.rs".to_string()));
        // 图片是画布/image 实体的一等公民：即使开启资源排除也始终纳入枚举
        // （detect_language 判为 image，落库为 image 实体，见 canvas 落库逻辑）；
        // 而字体/媒体/压缩包等仍在 IGNORED_FILE_EXTS，默认不进画像。
        assert!(
            files.iter().any(|f| f.ends_with(".png")),
            "图片不应被资源排除过滤: {files:?}"
        );
        assert!(
            files.iter().any(|f| f.ends_with(".svg")),
            "svg 图标不应被资源排除过滤: {files:?}"
        );
        assert!(
            !files
                .iter()
                .any(|f| f.ends_with("package-lock.json") || f.ends_with(".min.js")),
            "锁文件与压缩产物默认不进画像: {files:?}"
        );

        // 关闭资源排除后，锁文件也恢复纳入
        let all = collect_files(dir.path(), &[], false);
        assert!(all.iter().any(|f| f.ends_with(".png")));
        assert!(all.iter().any(|f| f.ends_with("package-lock.json")));
    }

    #[test]
    fn manual_exclude_dirs_merge_with_defaults() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("legacy")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.path().join("legacy/old.rs"), "fn old() {}\n").unwrap();
        fs::write(dir.path().join("node_modules/pkg/index.js"), "x").unwrap();

        let files = collect_files(dir.path(), &["legacy"], true);
        assert!(files.contains(&"src/main.rs".to_string()));
        assert!(
            !files.iter().any(|f| f.starts_with("legacy")),
            "手动排除目录应生效: {files:?}"
        );
        assert!(
            !files.iter().any(|f| f.starts_with("node_modules")),
            "内置默认排除仍生效: {files:?}"
        );
    }

    #[test]
    fn file_hash_is_stable_and_content_sensitive() {
        let dir = TempDir::new().unwrap();
        let a = dir.path().join("a.rs");
        let b = dir.path().join("b.rs");
        fs::write(&a, "fn same() {}\n").unwrap();
        fs::write(&b, "fn same() {}\n").unwrap();
        // 相同内容 → 相同哈希（增量扫描据此判定「未变更」）
        assert_eq!(compute_file_hash(&a), compute_file_hash(&b));
        // 不同内容 → 不同哈希
        fs::write(&b, "fn different() {}\n").unwrap();
        assert_ne!(compute_file_hash(&a), compute_file_hash(&b));
        // 不存在的文件 → None
        assert_eq!(compute_file_hash(&dir.path().join("missing.rs")), None);
    }

    // ─── 增量重扫：差异计算 ───

    fn mk_file(
        rel: &str,
        hash: Option<&str>,
        is_dir: bool,
    ) -> crate::domain::project_files::ProjectFile {
        crate::domain::project_files::ProjectFile {
            id: format!("f_{rel}"),
            analysis_id: "a1".into(),
            path: format!("/root/{rel}"),
            rel_path: rel.into(),
            name: rel.rsplit('/').next().unwrap_or(rel).into(),
            extension: None,
            language: None,
            size: 0,
            line_count: 0,
            content_hash: hash.map(|h| h.to_string()),
            parent_id: None,
            is_directory: is_dir,
            layer_id: None,
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            metadata: "{}".into(),
            scanned_at: 0,
        }
    }

    #[test]
    fn scan_delta_reports_only_changed_and_added_files() {
        let prev: std::collections::HashMap<String, String> = [
            ("src/a.rs".to_string(), "h1".to_string()),
            ("src/b.rs".to_string(), "h2".to_string()),
            ("src/gone.rs".to_string(), "h3".to_string()),
        ]
        .into_iter()
        .collect();

        let files = vec![
            mk_file("src", None, true),                 // 目录：永不参与
            mk_file("src/a.rs", Some("h1"), false),     // 未变更
            mk_file("src/b.rs", Some("h2-new"), false), // 内容变更
            mk_file("src/c.rs", Some("h4"), false),     // 新增
        ];

        let mut changed = compute_changed_paths(&prev, &files);
        changed.sort();
        assert_eq!(
            changed,
            vec!["src/b.rs".to_string(), "src/c.rs".to_string()]
        );
        // 已删除的 src/gone.rs 不出现在结果里：它不在当前文件表，
        // 携带旧行时按 rel_path 重映射会直接丢弃，不会留下悬挂引用
        assert!(!changed.iter().any(|p| p == "src/gone.rs"));
    }

    #[test]
    fn scan_delta_is_empty_when_nothing_changed() {
        let prev: std::collections::HashMap<String, String> =
            [("src/a.rs".to_string(), "h1".to_string())]
                .into_iter()
                .collect();
        let files = vec![mk_file("src/a.rs", Some("h1"), false)];
        // 零变更 → 空向量。调用方必须把它当作「有基线的增量」而非「无基线的全量」，
        // 这是重复扫描同一份代码时收益最大的场景。
        assert!(compute_changed_paths(&prev, &files).is_empty());
    }

    #[test]
    fn scan_delta_treats_missing_hash_as_changed() {
        let prev: std::collections::HashMap<String, String> =
            [("big.bin".to_string(), "h1".to_string())]
                .into_iter()
                .collect();
        // 超大文件跳过哈希计算 → content_hash 为 None → 保守判定为变更，宁可重算不可漏算
        let files = vec![mk_file("big.bin", None, false)];
        assert_eq!(
            compute_changed_paths(&prev, &files),
            vec!["big.bin".to_string()]
        );
    }

    #[test]
    fn snapshot_path_is_sanitized_and_roundtrips() {
        // analysis_id 里的路径分隔符必须被清洗掉，杜绝写到数据目录之外
        let p = scan_snapshot_path("../../etc/passwd");
        assert!(p.ends_with("etcpasswd.json"), "未清洗的快照路径: {p:?}");

        let id = "test_snapshot_roundtrip";
        let mut hashes = std::collections::HashMap::new();
        hashes.insert("src/a.rs".to_string(), "h1".to_string());
        write_scan_snapshot(id, &hashes);
        let raw = fs::read_to_string(scan_snapshot_path(id)).expect("快照应已落盘");
        let back: std::collections::HashMap<String, String> =
            serde_json::from_str(&raw).expect("快照应能按对象反序列化回来");
        assert_eq!(back, hashes);
        let _ = fs::remove_file(scan_snapshot_path(id));
    }
}
