//! 作品库根目录（完结作品重设计 B3，需求 §4 + D4/D7）。
//!
//! 这里定的是**一个目录的规矩**：所有导出产物落在 `<根>/<bookId>/v<seq>/` 之下，
//! 库里只存相对路径（`file_rel_path`），换机器 / 换根只需在这里重定位一次。
//!
//! 三条不可退让的口径：
//!  ① 默认根 = `<home>/Documents/SightFolio 作品库`（D7）。用户没设置过就是它。
//!  ② 读取即确保目录可用：**不存在则创建；创建失败必须把错误原样抛给 UI**。
//!     绝不静默降级回「另存为」——那正是本期要推翻的旧行为（缺陷 3），
//!     一次静默降级就会让「产物必在作品库内」（§9 验收 8）从根上失效。
//!  ③ 换根只在**目录创建成功之后**才落设置库。反过来（先落库再建目录失败）会留下
//!     一个「下次启动仍然失败」的死根，界面连回到旧值的机会都没有。

use crate::error::{AppError, AppResult};
use crate::infrastructure::database::SqliteSettingsRepository;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 设置库键（`user_settings` 表）。未设置 / 空串 = 使用默认根。
pub const WORKS_LIBRARY_ROOT_KEY: &str = "works_library_root";

/// 默认根的最后一段目录名（D7 定档文案，界面展示与拼路径共用这一份）。
pub const DEFAULT_ROOT_FOLDER: &str = "SightFolio 作品库";

/// 作品库根读数：界面直接展示这一份，不再自己拼默认值（两处口径迟早漂移）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksLibraryRootInfo {
    /// 绝对路径
    pub path: String,
    /// true = 用户没有设置过（或设的就是默认值），当前生效的是默认根
    pub is_default: bool,
}

/// 默认根 = `<home>/Documents/SightFolio 作品库`。
/// home 由调用方给出（生产走 [`home_dir`]，测试注入临时目录，不改全局环境变量）。
pub fn default_root_in(home: &Path) -> PathBuf {
    home.join("Documents").join(DEFAULT_ROOT_FOLDER)
}

/// 取用户主目录：`$HOME`（类 Unix）→ `$USERPROFILE`（Windows）。
/// 两个都拿不到就如实报错 —— 没有主目录就拼不出默认根，硬猜一个反而是坑。
fn home_dir() -> AppResult<PathBuf> {
    for var in ["HOME", "USERPROFILE"] {
        if let Ok(v) = std::env::var(var) {
            if !v.trim().is_empty() {
                return Ok(PathBuf::from(v));
            }
        }
    }
    Err(AppError::Internal(
        "无法确定用户主目录（HOME/USERPROFILE 均为空），作品库默认根无从拼起".to_string(),
    ))
}

/// 确保目录存在；失败时错误里带上**具体路径与系统原因**。
/// 已存在但不是目录，同样算失败（作品库根指向文件属于环境被改坏，必须暴露）。
fn ensure_directory(path: &Path) -> AppResult<()> {
    std::fs::create_dir_all(path).map_err(|e| {
        AppError::Internal(format!(
            "无法创建作品库目录 {}：{}",
            path.display(),
            e
        ))
    })
}

/// 设置库里存的自定义根（去空白后判空；空串视同未设置，回默认根）。
fn configured_root(settings: &SqliteSettingsRepository) -> AppResult<Option<PathBuf>> {
    Ok(settings
        .get(WORKS_LIBRARY_ROOT_KEY)?
        .map(|v: String| v.trim().to_string())
        .filter(|v: &String| !v.is_empty())
        .map(PathBuf::from))
}

/// 读作品库根并确保可用（Tauri 命令入口，见 `commands::get_works_library_root`）。
pub fn get_works_library_root(settings: &SqliteSettingsRepository) -> AppResult<WorksLibraryRootInfo> {
    get_works_library_root_with_home(settings, &home_dir()?)
}

/// 同上，但 home 由调用方注入 —— 单测不许改全局环境变量（并行下会互踩）。
pub fn get_works_library_root_with_home(
    settings: &SqliteSettingsRepository,
    home: &Path,
) -> AppResult<WorksLibraryRootInfo> {
    let (path, is_default) = match configured_root(settings)? {
        Some(p) => (p, false),
        None => (default_root_in(home), true),
    };
    ensure_directory(&path)?;
    Ok(WorksLibraryRootInfo {
        path: path.to_string_lossy().into_owned(),
        is_default,
    })
}

/// 换根（Tauri 命令入口，见 `commands::set_works_library_root`）。
///
/// 与 §4 的口径一致：**只改配置值，不搬文件**。旧产物在新根下解析不到，
/// 由 B5 的成品页按 `missing` 语义显示，不在这里装模作样地搬迁。
pub fn set_works_library_root(
    settings: &SqliteSettingsRepository,
    raw_path: &str,
) -> AppResult<WorksLibraryRootInfo> {
    set_works_library_root_with_home(settings, raw_path, &home_dir()?)
}

/// 同上，但 home 由调用方注入（单测不许改全局环境变量，并行下会互踩）。
pub fn set_works_library_root_with_home(
    settings: &SqliteSettingsRepository,
    raw_path: &str,
    home: &Path,
) -> AppResult<WorksLibraryRootInfo> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("作品库目录不能为空".to_string()));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::Validation(format!(
            "作品库目录必须是绝对路径：{trimmed}"
        )));
    }
    // 先建目录再落库：创建失败时旧设置值保持不动（口径 ③），
    // 错误原样上抛，由界面如实展示 —— 这里没有「退回另存为」这一支。
    ensure_directory(&path)?;
    let stored = path.to_string_lossy().into_owned();
    settings.set(WORKS_LIBRARY_ROOT_KEY, &stored)?;

    // 设的值恰好等于默认根时标成 is_default：界面不必区分「没设过」与「设回默认」。
    let is_default = path == default_root_in(home);
    Ok(WorksLibraryRootInfo {
        path: stored,
        is_default,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::{init_tables, migrate, Database};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    /// 走**生产同一套** init_tables + migrate 建库：手抄 user_settings schema 会得到假的绿。
    fn settings_repo() -> Arc<SqliteSettingsRepository> {
        let db = Arc::new(Database(Mutex::new(Connection::open_in_memory().unwrap())));
        {
            let conn = db.0.lock().unwrap();
            init_tables(&conn).unwrap();
            migrate(&conn).unwrap();
        }
        Arc::new(SqliteSettingsRepository::new(db))
    }

    /// 每个用例一个独立的临时家目录，结束即删（不碰 data/，不依赖 $HOME）。
    struct TempHome(PathBuf);

    impl TempHome {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "sf_wroot_{}_{}_{}",
                tag,
                std::process::id(),
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn 默认根拼在家目录的_文档_下() {
        let home = Path::new("/home/tester");
        assert_eq!(
            default_root_in(home),
            PathBuf::from("/home/tester/Documents/SightFolio 作品库")
        );
    }

    #[test]
    fn 未设置时读取返回默认根并当场创建目录() {
        let settings = settings_repo();
        let home = TempHome::new("default");
        let info = get_works_library_root_with_home(&settings, &home.0).unwrap();

        assert!(info.is_default, "没设置过时必须如实标默认根");
        assert_eq!(info.path, default_root_in(&home.0).to_string_lossy());
        assert!(
            std::fs::metadata(&info.path).map(|m| m.is_dir()).unwrap_or(false),
            "§4：默认根不存在则创建，读取成功就必须已经可用"
        );
    }

    #[test]
    fn 自定义根优先于默认且跨读取保持() {
        let settings = settings_repo();
        let home = TempHome::new("custom");
        let custom = home.0.join("外置盘/作品库");

        let set_info = set_works_library_root_with_home(&settings, &custom.to_string_lossy(), &home.0).unwrap();
        assert!(!set_info.is_default);

        let got = get_works_library_root_with_home(&settings, &home.0).unwrap();
        assert_eq!(got.path, custom.to_string_lossy());
        assert!(!got.is_default, "设置了自定义根就不该再显示成默认位置");
        assert!(std::fs::metadata(&got.path).unwrap().is_dir());
    }

    #[test]
    fn 创建失败时如实报错且不写入设置库() {
        let settings = settings_repo();
        let home = TempHome::new("fail");
        // 拿一个真实存在的**文件**当父目录：create_dir_all 必失败，模拟只读盘/权限异常
        let blocker = home.0.join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        let bad = blocker.join("作品库");

        let err = set_works_library_root_with_home(&settings, &bad.to_string_lossy(), &home.0);
        match err {
            Err(AppError::Internal(msg)) => {
                let bad_str = bad.to_string_lossy().to_string();
                assert!(msg.contains(&bad_str), "错误必须带具体路径：{msg}");
            }
            other => panic!("建目录失败要原样上抛，实际 {other:?}"),
        }
        assert!(
            settings.get(WORKS_LIBRARY_ROOT_KEY).unwrap().is_none(),
            "创建失败还落库 = 留下一个下次启动继续失败的死根"
        );
    }

    #[test]
    fn 空与相对路径被拒绝() {
        let settings = settings_repo();
        let home = TempHome::new("reject");
        assert!(matches!(
            set_works_library_root_with_home(&settings, "   ", &home.0),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            set_works_library_root_with_home(&settings, "Documents/作品库", &home.0),
            Err(AppError::Validation(msg)) if msg.contains("绝对路径")
        ));
        assert!(settings.get(WORKS_LIBRARY_ROOT_KEY).unwrap().is_none());
        assert!(
            !home.0.join("Documents/作品库").exists(),
            "被拒绝的路径不许有任何落盘副作用"
        );
    }

    #[test]
    fn 设置值带首尾空白_读取时归一且不误判成默认() {
        let settings = settings_repo();
        let home = TempHome::new("trim");
        let custom = home.0.join("libs root");
        settings
            .set(WORKS_LIBRARY_ROOT_KEY, &format!("  {}  ", custom.to_string_lossy()))
            .unwrap();

        let got = get_works_library_root_with_home(&settings, &home.0).unwrap();
        assert_eq!(got.path, custom.to_string_lossy());
        assert!(!got.is_default);
    }

    #[test]
    fn 根目录指向已有文件时读取也报错() {
        let settings = settings_repo();
        let home = TempHome::new("file-as-root");
        let blocker = home.0.join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        settings.set(WORKS_LIBRARY_ROOT_KEY, &blocker.to_string_lossy()).unwrap();

        let err = get_works_library_root_with_home(&settings, &home.0);
        assert!(
            matches!(err, Err(AppError::Internal(_))),
            "作品库根被人换成文件属于环境坏掉，必须暴露而不是装作可用：{err:?}"
        );
    }

    #[test]
    fn 设成默认路径时标记回默认根() {
        let settings = settings_repo();
        let home = TempHome::new("back-to-default");
        let default = default_root_in(&home.0);

        let info = set_works_library_root_with_home(&settings, &default.to_string_lossy(), &home.0).unwrap();

        assert!(info.is_default, "设回默认值就该显示成默认位置，界面不必区分两种来源");
        assert_eq!(info.path, default.to_string_lossy());
    }
}
