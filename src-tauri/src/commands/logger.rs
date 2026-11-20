use chrono::Local;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::infrastructure::logging::debug_log;

pub struct LoggerState {
    pub log_dir: Mutex<PathBuf>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub level: String,
    pub module: String,
    pub message: String,
    pub data: Option<serde_json::Value>,
    pub timestamp: Option<u64>,
}

/// 应用日志目录（app-*.log 业务日志，区别于 debug.log 诊断日志）。
///
/// ⚠️ 发布兼容性：这里**不能**无条件用 `CARGO_MANIFEST_DIR`（编译期常量）。
/// 它指向的是**编译机器**上的项目路径——打包成 MSI/portable 发到用户机器后，
/// 该路径不存在（或更糟：恰好存在但不可写），`write_log` 会静默失败，
/// 前端所有日志在发布版里全部丢失（这正是商城发布前必须修的兼容性 bug）。
///
/// 策略：
/// - dev 构建（`cargo tauri dev`）：沿用项目 `logs/`——开发机上路径必然有效。
/// - 打包版（release/portable/安装版）：写系统应用数据目录
///   （Windows: `%LOCALAPPDATA%\com.sight.folio\logs`），永远可写。
fn get_log_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = project_root
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        return project_root.join("logs");
    }
    debug_log::os_app_data_dir()
        .map(|d| d.join("logs"))
        .unwrap_or_else(|| {
            // 数据目录都解析不到（环境变量被清空的极端环境）：退回进程工作目录。
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("logs")
        })
}

fn ensure_log_dir(log_dir: &PathBuf) -> Result<(), String> {
    if !log_dir.exists() {
        fs::create_dir_all(log_dir).map_err(|e| format!("Failed to create log dir: {}", e))?;
    }
    Ok(())
}

fn format_timestamp(ts: Option<u64>) -> String {
    if let Some(millis) = ts {
        chrono::DateTime::from_timestamp_millis(millis as i64)
            .map(|dt| dt.format("%Y-%m-%d %H:%M:%S%.3f").to_string())
            .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string())
    } else {
        Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
    }
}

pub fn write_log(log_dir: &PathBuf, entry: &LogEntry) -> Result<(), String> {
    ensure_log_dir(log_dir)?;

    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let level = entry.level.to_lowercase();

    let log_file = log_dir.join(format!("app-{}-{}.log", date_str, level));

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let timestamp = format_timestamp(entry.timestamp);
    let data_str = entry
        .data
        .as_ref()
        .map(|d| format!(" | data: {}", d))
        .unwrap_or_default();

    let line = format!(
        "[{}] [{}] [{}] {}{}\n",
        timestamp,
        entry.level.to_uppercase(),
        entry.module,
        entry.message,
        data_str
    );

    file.write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write log: {}", e))?;

    // error 级别镜像一份到 debug.log：前端报错时用户只需要发一个 debug.log 文件，
    // 不必逐个翻按日期分片、按级别拆分的 app-*.log。
    if entry.level.eq_ignore_ascii_case("error") {
        debug_log::error(
            "logger",
            &format!("{} | {}{}", entry.module, entry.message, data_str),
        );
    }

    Ok(())
}

#[tauri::command]
pub fn write_log_entry(entry: LogEntry, state: State<'_, LoggerState>) -> Result<(), String> {
    let log_dir = state.log_dir.lock().map_err(|e| e.to_string())?;
    write_log(&log_dir, &entry)
}

#[tauri::command]
pub fn write_log_batch(
    entries: Vec<LogEntry>,
    state: State<'_, LoggerState>,
) -> Result<(), String> {
    let log_dir = state.log_dir.lock().map_err(|e| e.to_string())?;
    for entry in &entries {
        write_log(&log_dir, entry)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_log_dir_path(state: State<'_, LoggerState>) -> Result<String, String> {
    let log_dir = state.log_dir.lock().map_err(|e| e.to_string())?;
    Ok(log_dir.to_string_lossy().to_string())
}

/// 前端诊断日志桥接：把 WebView 侧的全局错误（window.onerror / unhandledrejection）
/// 追加到与 Rust 端同一个 `debug.log`，形成一条从前端到后端可串联的完整时间线。
/// Best-effort 且永不失败——日志链路故障不允许反过来打断业务调用。
#[tauri::command]
pub fn append_debug_log(level: String, tag: String, message: String) {
    let level = match level.to_lowercase().as_str() {
        "error" => "ERROR",
        "warn" | "warning" => "WARN",
        _ => "INFO",
    };
    // tag 只允许有限的合理字符，防止前端把它当格式串注入乱七八糟的内容。
    let tag: String = tag
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(32)
        .collect();
    debug_log::log(level, &tag, &message);
}

pub fn init_logger_state() -> LoggerState {
    let log_dir = get_log_dir();
    let _ = ensure_log_dir(&log_dir);

    let boot_log = log_dir.join(format!("app-{}-info.log", Local::now().format("%Y-%m-%d")));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&boot_log) {
        let _ = writeln!(
            file,
            "[{}] [INFO] [system] Application starting, log dir: {}",
            Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            log_dir.display()
        );
    }

    LoggerState {
        log_dir: Mutex::new(log_dir),
    }
}
