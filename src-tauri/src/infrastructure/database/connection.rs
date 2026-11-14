use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

pub struct Database(pub Mutex<Connection>);

/// 本次运行真正使用的数据库路径（内存库时为 `(memory)`）。
/// 用 OnceLock 而不是让调用方层层传参：这是一次性事实（启动时定死，之后不再变），
/// 而设置抽屉要在任意时刻读到它，好把「设置到底存在哪儿」说清楚。
static DB_LOCATION: OnceLock<String> = OnceLock::new();
/// 数据库是否真的落在文件上。false = 退回了内存库，关掉进程即清空 ——
/// 这正是「设置改完关掉软件就没了」的物理成因，必须能被界面读到。
static DB_PERSISTENT: AtomicBool = AtomicBool::new(false);

/// (是否持久化, 实际落点)。前端设置抽屉据此说实话，而不是只会说一句「已自动保存」。
pub fn database_status() -> (bool, String) {
    (
        DB_PERSISTENT.load(Ordering::Relaxed),
        DB_LOCATION
            .get()
            .cloned()
            .unwrap_or_else(|| "(not-initialized)".to_string()),
    )
}

fn record_location(path: &str, persistent: bool) {
    let _ = DB_LOCATION.set(path.to_string());
    DB_PERSISTENT.store(persistent, Ordering::Relaxed);
}

impl Database {
    /// 打开应用主库（config.db：书稿 / 设定 / 分析结果 / 外观设置全在这里）。
    ///
    /// 第二十三轮改口径：**不再一进失败通道就静默退回内存库**。
    /// 病灶（用户报「设置改完关掉软件再打开就没了」的直接成因）：生产包里 config.db 落在
    /// 可执行文件同级目录，从只读 DMG 启动、被移走的 .app、或每次换路径的构建产物启动时，
    /// `Connection::open` 会失败；此前这一步直接 `open_in_memory()`，于是前端每次
    /// `set_setting` 都「成功」，落盘状态一路显示「已自动保存」，关掉进程却全部蒸发 ——
    /// 而且没有任何一处界面说得清这件事发生过。
    ///
    /// 第二十八轮改口径（15:51 审计 §2.2 的 P0）：**生产主路径反转到系统用户数据目录**。
    /// 第 23 轮补的是「open 失败别静默退内存库」，但漏了另一支：`.app` 放在桌面 / 下载 /
    /// 构建输出目录时 `Contents/MacOS/` 通常是**可写的**，open 成功，库就静静地待在 app 包里 ——
    /// 重新构建换产物、把 .app 拖去 /Applications、从 DMG 双击、换机器，每一种都是另一个空库，
    /// 界面一路「已自动保存」，关掉全蒸发。所以：
    ///  ① 生产主档 = 操作系统给用户数据准备的可写目录（macOS `~/Library/Application Support/<id>`，
    ///     由 Tauri path resolver 给出，路径与安装位置解绑）；老落点「exe 同级」降级为
    ///     兼容档 + 迁移源（见 `legacy_migration_plan`：老库存在而稳定位置没有 → 整体搬一次）；
    ///  ② 开发环境维持项目 `data/`（对着仓库看库是开发刚需，且该路径由 CARGO_MANIFEST_DIR 钉死，
    ///     不存在「跟着安装位置漂」的问题）；
    ///  ③ 两档都打不开才退内存库，eprintln + `persistent=false` 交给界面（`database_status` /
    ///     前端 settingsHealthStore）—— 第 23 轮这一支原样保留，PRAGMA 那套不动。
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, rusqlite::Error> {
        let mut last_error: Option<rusqlite::Error> = None;

        // 生产老库一次性迁移：必须在候选链打开任何库之前做，避免两边同时被打开。
        if let Some((from, to)) =
            legacy_migration_plan(os_data_dir(app_handle).as_deref(), &exe_legacy_db())
        {
            match migrate_legacy_db(&from, &to) {
                Ok(copied) => eprintln!(
                    "[sight-folio] 设置库已从老落点迁移到稳定位置：{} → {}（复制 {} 个文件，原件保留）",
                    from.display(),
                    to.display(),
                    copied
                ),
                Err(e) => eprintln!(
                    "[sight-folio] 设置库迁移失败（{e}），将继续按候选链打开；老库不会被破坏，可下次再迁"
                ),
            }
        }

        for path in Self::candidate_paths(app_handle) {
            if let Some(parent) = path.parent() {
                // 目录建不出来不在此处判定：紧接着的 open 会给出真正的错误
                let _ = std::fs::create_dir_all(parent);
            }
            match Connection::open(&path) {
                Ok(mut conn) => {
                    match Self::apply_pragmas(&mut conn) {
                        Ok(()) => {
                            record_location(&path.display().to_string(), true);
                            return Ok(Database(Mutex::new(conn)));
                        }
                        // PRAGMA 失败说明这条连接不可用（例如目录不可写导致 WAL 建不出来），
                        // 继续试下一档，而不是拿着一个半残的连接往下跑。
                        Err(e) => {
                            eprintln!(
                                "[sight-folio] 数据库 {} 设置 PRAGMA 失败，换下一个位置: {e}",
                                path.display()
                            );
                            last_error = Some(e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[sight-folio] 打开数据库 {} 失败，尝试下一个位置: {e}",
                        path.display()
                    );
                    last_error = Some(e);
                }
            }
        }

        // 到这一步就是真的没地方可写了。仍然退回内存库（不能让应用起不来），
        // 但这一次不静默：日志 + 界面读数（settingsHealthStore 会显示「设置库没跨启动留住数据」）。
        eprintln!(
            "[sight-folio] 所有数据目录都不可用，退回内存库：本次启动的设置与数据不会留存（最后错误: {:?}）",
            last_error.map(|e| e.to_string())
        );
        let mut conn = Connection::open_in_memory()?;
        Self::apply_pragmas(&mut conn)?;
        record_location("(memory)", false);
        Ok(Database(Mutex::new(conn)))
    }

    /// 候选路径（按优先级，去重）。
    ///
    /// 生产：① 系统用户数据目录（稳定，与安装位置无关）→ ② exe 同级（老落点兜底：
    /// resolver 异常、或稳定目录不可写时至少还能沿用旧行为）。
    /// 开发：① 项目 `data/` → ② 系统用户数据目录（第 23 轮就有的救场档，顺序不变）。
    /// 纯路径决策拆在 `candidate_paths_for` 里，便于脱离 AppHandle 做单测。
    fn candidate_paths(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
        // prefer_stable 由 cfg 决定而不是藏进纯函数：cargo test 永远跑在 debug 断言下，
        // 分支写死在函数里就测不到生产顺序（生产顺序正是本轮改的东西）。
        candidate_paths_for(
            os_data_dir(app_handle).as_deref(),
            &app_data_dir(),
            !cfg!(debug_assertions),
        )
    }

    /// 连接级性能/健壮性 PRAGMA（幂等，每次打开都设置一遍）。
    ///
    /// - `journal_mode=WAL`：写不阻塞读，且提交只写 WAL 而非整库回滚段；
    /// - `synchronous=NORMAL`：WAL 下仅在 checkpoint 时 fsync（应用崩溃不损坏，仅 OS/断电可能丢最后事务——
    ///   对本地分析工具可接受，且用户随时可重扫）；
    /// - `busy_timeout=5000`：分析时前端并发查询遇到写锁时等待而非立即 BUSY 报错；
    /// - `cache_size=-8000`：8MB 页缓存，提升扫描期缓冲命中率。
    fn apply_pragmas(conn: &mut Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA cache_size=-8000;",
        )?;
        Ok(())
    }
}

/// 操作系统为「这个应用的用户数据」准备的稳定目录（macOS `~/Library/Application Support/<id>` 等）。
///
/// 走 Tauri 的 path resolver 而不是自己拼环境变量：identifier、各平台约定、沙盒差异
/// 都由框架口径统一给出，自己拼出来的路径与前端 `tauri:path` 插件看到的可能不是同一个地方。
/// 第二十八轮起这是**生产主落点**（不再是第 23 轮的救场退路）：路径与 .app 安装位置解绑，
/// 换构建产物 / 挪 .app / 从 DMG 直启都不换库。取不到（非桌面环境 / resolver 异常）返回 None，
/// 候选链自动降级到 exe 同级老落点，不影响启动。
fn os_data_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app_handle.path().app_data_dir().ok()
}

/// 老落点（第 27 轮及以前的生产库位置）：可执行文件同级的 config.db。
/// 第二十八轮起降级为「兼容档 + 迁移源」，不再是主路径。
fn exe_legacy_db() -> PathBuf {
    let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    exe_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("config.db")
}

/// 候选路径决策（纯函数，脱离 AppHandle 才能单测）。
///
/// - `prefer_stable = true`（生产）：① 系统用户数据目录 → ② `dev_or_exe_dir`（exe 同级老落点）；
/// - `prefer_stable = false`（开发）：① 项目 `data/` → ② 系统用户数据目录（第 23 轮的救场档）；
/// - `os_dir` 为 None（resolver 异常）：只剩一档 —— 与第 23 轮行为一致；
/// - 两档指向同一文件：只留一条（去重锁的就是「同一档被打开两次 / 读数二义」）。
fn candidate_paths_for(
    os_dir: Option<&std::path::Path>,
    dev_or_exe_dir: &std::path::Path,
    prefer_stable: bool,
) -> Vec<PathBuf> {
    let base = dev_or_exe_dir.join("config.db");
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut push_unique = |paths: &mut Vec<PathBuf>, p: PathBuf| {
        if !paths.contains(&p) {
            paths.push(p);
        }
    };
    let stable = os_dir.map(|os| os.join("config.db"));
    match (prefer_stable, stable) {
        (true, Some(stable_db)) => {
            push_unique(&mut paths, stable_db);
            push_unique(&mut paths, base);
        }
        (true, None) | (false, None) => {
            push_unique(&mut paths, base);
        }
        (false, Some(stable_db)) => {
            push_unique(&mut paths, base);
            push_unique(&mut paths, stable_db);
        }
    }
    paths
}

/// 老库迁移决策（纯函数）：什么情况下要把 exe 同级的老 config.db 搬到稳定目录。
///
/// 只在「稳定目录没有库、老落点有库、且两边不是同一个文件」时迁移一次。
/// 稳定目录已有库 = 迁移早就做过（或用户手动放过库），再动就是盖掉现用数据，绝对不行。
fn legacy_migration_plan(
    os_dir: Option<&std::path::Path>,
    legacy_db: &std::path::Path,
) -> Option<(PathBuf, PathBuf)> {
    let stable = os_dir?.join("config.db");
    if stable == legacy_db || !legacy_db.exists() || stable.exists() {
        return None;
    }
    Some((legacy_db.to_path_buf(), stable))
}

/// 执行老库迁移：把 config.db 及其 WAL 邻档复制到稳定目录，**原件保留**。
///
/// 为什么复制而不是移动：移动会把用户唯一的数据副本押在「这次复制成功」上；
/// 复制失败时老库毫发无损（下次启动还会再尝试），成功了老库也只是变成一份自然归档。
/// `-wal` 要一起拷：未 checkpoint 的最新事务就在 WAL 里，只拷主库文件等于丢掉最近的设置改动。
/// `-shm` 不拷（瞬时索引，SQLite 会自己重建）。
fn migrate_legacy_db(from: &std::path::Path, to: &std::path::Path) -> Result<usize, String> {
    // 主库是迁移的前提：**先确认它存在**再碰邻档。反过来的后果由回归测试抓过 ——
    // 一个「只有孤儿 -wal 没有主库」的残缺老落点，会被拷成「只有 -wal 的半个目标库」，
    // 下一档候选再把它当现用数据打开，比不迁移糟得多。
    if !from.exists() {
        return Err(format!("老落点上找不到 config.db: {}", from.display()));
    }
    let to_dir = to.parent().ok_or_else(|| "目标目录不可解析".to_string())?;
    std::fs::create_dir_all(to_dir).map_err(|e| format!("创建目标目录失败: {e}"))?;
    let mut copied = 0usize;
    for suffix in ["", "-wal"] {
        let side = sibling(from, suffix);
        if side.exists() {
            let dest = sibling(to, suffix);
            std::fs::copy(&side, &dest)
                .map_err(|e| format!("复制 {} 失败: {e}", side.display()))?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// `db` 的 WAL 邻档路径：config.db → config.db-wal / config.db-shm。
fn sibling(db: &std::path::Path, suffix: &str) -> PathBuf {
    let mut p = db.as_os_str().to_os_string();
    p.push(suffix);
    PathBuf::from(p)
}

/// 应用数据目录：本地缓存与兼容档库落点的统一入口。
///
/// - 开发环境：项目根目录下的 `data/`
/// - 生产环境：可执行文件同级目录
///
/// **第二十八轮起，生产环境的主库（config.db）不再以这里为主落点** ——
/// 它跟着 .app 走，换构建产物 / 挪安装位置就是另一个空库（「设置重启就没了」的 P0 成因）。
/// 现在主库走 `os_data_dir`（稳定用户数据目录），这里在生产侧只剩兼容档与缓存用途
/// （corpus.db、asset 缓存等仍以这里为落点，丢了可重建，不影响设置持久性）。
///
/// 目录不存在时尝试创建；创建失败不 panic，由调用方各自兜底
/// （第二十三轮：Database 侧已补上「这里不可写就换系统用户数据目录」的退路）。
pub fn app_data_dir() -> PathBuf {
    let dir = if cfg!(debug_assertions) {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = project_root
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        project_root.join("data")
    } else {
        let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
        exe_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .to_path_buf()
    };
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// 每次调用给一个全新的临时目录（测试并行跑，目录不许复用）。
    fn temp_case(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "sight-folio-db-loc-{tag}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("临时目录应可创建");
        dir
    }

    // ── candidate_paths_for：顺序与去重 ────────────────────────────────────

    #[test]
    fn prod_prefers_stable_dir_with_exe_dir_as_fallback() {
        let os = Path::new("/Users/tester/Library/Application Support/com.sight.folio");
        let exe = Path::new("/Applications/Sight Folio.app/Contents/MacOS");
        let paths = candidate_paths_for(Some(os), exe, true);
        assert_eq!(paths, vec![os.join("config.db"), exe.join("config.db")]);
    }

    #[test]
    fn dev_prefers_project_data_dir_with_stable_dir_second() {
        let os = Path::new("/Users/tester/Library/Application Support/com.sight.folio");
        let project = Path::new("/repo/data");
        let paths = candidate_paths_for(Some(os), project, false);
        assert_eq!(paths, vec![project.join("config.db"), os.join("config.db")]);
    }

    #[test]
    fn resolver_failure_leaves_single_candidate_instead_of_erroring() {
        let exe = Path::new("/Applications/Sight Folio.app/Contents/MacOS");
        let paths = candidate_paths_for(None, exe, true);
        assert_eq!(paths, vec![exe.join("config.db")]);
    }

    #[test]
    fn duplicate_candidates_are_collapsed() {
        let same = Path::new("/somewhere");
        assert_eq!(candidate_paths_for(Some(same), same, true).len(), 1);
        assert_eq!(candidate_paths_for(Some(same), same, false).len(), 1);
    }

    // ── legacy_migration_plan：什么时候许搬、什么时候绝不许动 ────────────────

    #[test]
    fn migrates_only_when_stable_missing_and_legacy_present() {
        let root = temp_case("plan");
        let legacy = root.join("legacy").join("config.db");
        std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        std::fs::write(&legacy, b"db").unwrap();
        let stable_dir = root.join("stable");
        std::fs::create_dir_all(&stable_dir).unwrap();

        let plan = legacy_migration_plan(Some(&stable_dir), &legacy);
        assert_eq!(plan, Some((legacy.clone(), stable_dir.join("config.db"))));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn never_overwrites_existing_stable_db() {
        let root = temp_case("plan-occupied");
        let legacy = root.join("legacy.db");
        std::fs::write(&legacy, b"old").unwrap();
        let stable_dir = root.join("stable");
        std::fs::create_dir_all(&stable_dir).unwrap();
        std::fs::write(stable_dir.join("config.db"), b"current").unwrap();

        assert!(legacy_migration_plan(Some(&stable_dir), &legacy).is_none());
        // 现库内容一字未动
        assert_eq!(
            std::fs::read_to_string(stable_dir.join("config.db")).unwrap(),
            "current"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skips_migration_when_legacy_absent_same_file_or_no_os_dir() {
        let root = temp_case("plan-absent");
        let stable_dir = root.join("stable");
        std::fs::create_dir_all(&stable_dir).unwrap();
        assert!(legacy_migration_plan(Some(&stable_dir), &root.join("nope.db")).is_none());
        assert!(legacy_migration_plan(Some(&stable_dir), &stable_dir.join("config.db")).is_none());
        assert!(legacy_migration_plan(None, &root.join("config.db")).is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    // ── migrate_legacy_db：复制语义（原件保留、WAL 同行、无主库不算成功） ─────

    #[test]
    fn copies_main_db_and_wal_keeping_originals() {
        let root = temp_case("migrate");
        let from_dir = root.join("exe");
        let to_dir = root.join("stable");
        std::fs::create_dir_all(&from_dir).unwrap();
        std::fs::write(from_dir.join("config.db"), b"main").unwrap();
        std::fs::write(from_dir.join("config.db-wal"), b"wal").unwrap();
        std::fs::write(from_dir.join("config.db-shm"), b"shm").unwrap();

        let copied =
            migrate_legacy_db(&from_dir.join("config.db"), &to_dir.join("config.db")).unwrap();
        // -shm 刻意不拷：只数主库 + wal
        assert_eq!(copied, 2);
        assert_eq!(
            std::fs::read_to_string(to_dir.join("config.db")).unwrap(),
            "main"
        );
        assert_eq!(
            std::fs::read_to_string(to_dir.join("config.db-wal")).unwrap(),
            "wal"
        );
        assert!(!to_dir.join("config.db-shm").exists());
        // 原件保留：迁移失败可重来，成功也只是自然归档
        assert!(from_dir.join("config.db").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fails_when_no_main_db_instead_of_leaving_half_a_target() {
        let root = temp_case("migrate-empty");
        let from_dir = root.join("exe");
        let to_dir = root.join("stable");
        std::fs::create_dir_all(&from_dir).unwrap();
        std::fs::write(from_dir.join("config.db-wal"), b"orphan-wal").unwrap();

        let err =
            migrate_legacy_db(&from_dir.join("config.db"), &to_dir.join("config.db")).unwrap_err();
        assert!(err.contains("config.db"));
        // 孤儿 WAL 不会被单独搬走
        assert!(!to_dir.join("config.db-wal").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sibling_appends_sidecar_suffix() {
        let db = Path::new("/data/config.db");
        assert_eq!(sibling(db, ""), db.to_path_buf());
        assert_eq!(sibling(db, "-wal").to_str().unwrap(), "/data/config.db-wal");
    }
}
