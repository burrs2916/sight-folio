use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database(pub Mutex<Connection>);

impl Database {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, rusqlite::Error> {
        let mut conn = match Self::open_file_database(app_handle) {
            Ok(conn) => conn,
            Err(_e) => Connection::open_in_memory()?,
        };
        // 写入性能关键配置：WAL 日志 + 降 fsync。
        // 扫描阶段各 repository 的 save_batch 已包事务，但默认 synchronous=FULL + 回滚日志
        // 会让每次事务提交都 fsync——数千条 INSERT 提交即数千次 fsync。
        // WAL + NORMAL 把 fsync 收敛到 checkpoint，提速一个数量级。
        Self::apply_pragmas(&mut conn)?;
        Ok(Database(Mutex::new(conn)))
    }

    fn open_file_database(_app_handle: &tauri::AppHandle) -> Result<Connection, rusqlite::Error> {
        Connection::open(app_data_dir().join("config.db"))
    }

    /// 连接级性能/健壮性 PRAGMA（幂等，每次打开都设置一遍）。
    ///
    /// - `journal_mode=WAL`：写不阻塞读，且提交只写 WAL 而非整库回滚段；
    /// - `synchronous=NORMAL`：WAL 下仅在 checkpoint 时 fsync（应用崩溃不损坏，仅 OS/断电可能丢最后事务——
    ///   对本地分析工具可接受，且用户随时可重扫）；
    /// - `busy_timeout=5000`：分析时前端并发查询遇到写锁时等待而非立即 BUSY 报错；
    /// - `cache_size=-8000`：8MB 页缓存，提升扫描期缓冲命中率。
    fn apply_pragmas(conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA cache_size=-8000;",
        )?;
        Ok(())
    }
}

/// 应用数据目录：数据库与各类本地缓存（扫描哈希快照等）的统一落点。
///
/// - 开发环境：项目根目录下的 `data/`
/// - 生产环境：可执行文件同级目录
///
/// 目录不存在时尝试创建；创建失败不 panic，由调用方各自兜底。
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
