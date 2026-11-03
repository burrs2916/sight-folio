use crate::error::AppError;
use crate::infrastructure::SqliteSettingsRepository;
use tauri::State;

pub struct SettingsState {
    pub repository: SqliteSettingsRepository,
}

#[tauri::command]
pub fn get_setting(
    state: State<'_, SettingsState>,
    key: String,
) -> Result<Option<String>, AppError> {
    state.repository.get(&key)
}

#[tauri::command]
pub fn set_setting(
    state: State<'_, SettingsState>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    state.repository.set(&key, &value)
}

#[tauri::command]
pub fn delete_setting(state: State<'_, SettingsState>, key: String) -> Result<(), AppError> {
    state.repository.delete(&key)
}

/// 设置库的真实落点与持久化状态（第二十三轮）。
///
/// 为什么要单独给界面读这一份：前端那套自检（`settingsHealthStore`）只能从行为反推
/// 「这次改动大概没跨启动留住」，而进程内部才知道数据库究竟开在哪个文件、有没有退到内存库。
/// 设置抽屉里「设置存在哪儿」这句话由这里给出，用户换设备 / 排查时也能直接按路径找到文件。
#[derive(serde::Serialize)]
pub struct DatabaseStatus {
    /// false = 退回内存库：本次启动写进去的东西关掉进程即清空
    pub persistent: bool,
    /// 实际文件路径；内存库时为 `(memory)`
    pub location: String,
}

#[tauri::command]
pub fn get_database_status() -> DatabaseStatus {
    let (persistent, location) = crate::infrastructure::database::connection::database_status();
    DatabaseStatus {
        persistent,
        location,
    }
}
