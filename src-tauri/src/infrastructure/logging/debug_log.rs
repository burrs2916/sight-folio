//! 进程级共享 `debug.log` 诊断日志（商城发布兼容性准备）。
//!
//! 设计对标参考实现（biosphere-terminal-app 的 infra/logging/debug_log.rs）：
//! `debug.log` 是一个**独立于业务日志管线**的纯文本诊断文件——启动横幅、Rust panic、
//! 前端 JS 错误（经 `append_debug_log` 命令桥接）全部追加到同一个文件。
//! 本地测试版（免安装 portable）把 exe 放在任何目录双击运行，出错时用户只需把
//! **exe 同级目录的 debug.log** 发回来即可定位问题。
//!
//! 多路径写入策略：
//! - **exe 同级目录**：本地测试版的主位置（用户要求的「同级目录下 debug.log」）。
//!   MSI 安装版装进 Program Files 后该目录通常只读——写入失败被静默忽略，由下一级兜底。
//! - **系统应用数据目录**（Windows: `%LOCALAPPDATA%\com.sight.folio`）：安装版的主位置，
//!   永远可写。
//! - **当前工作目录**（裸 `debug.log`）：前两级都不可用时的最后兜底，保证日志不丢。
//!
//! 文件上限 5 MB，超限原地截断，防止单次会话无限膨胀；单条 payload 8 KB 截断，
//! 防止一条大输出把整个会话的日志挤掉。所有写入 best-effort——日志故障绝不影响业务。

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

/// debug.log 大小上限：超限就地截断（单次会话内防无限膨胀）。
pub const DEBUG_LOG_MAX_SIZE: u64 = 5 * 1024 * 1024;

/// 单条 payload 上限（按字符数计）：一条超大输出不允许挤占整个会话的日志空间。
const MAX_DETAIL_LEN: usize = 8192;

type DebugLogPaths = Arc<Vec<PathBuf>>;

static PATHS: OnceLock<DebugLogPaths> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);

/// 注册进程全局的 debug.log 路径集（仅在 `run()` 早期调用一次；重复调用被忽略）。
pub fn init_paths(paths: DebugLogPaths) {
    let _ = PATHS.set(paths);
}

/// 追加一行到单个文件。Best-effort：目录创建 / 截断失败都忽略，绝不向上抛错。
pub fn write_line(path: &std::path::Path, message: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 超限就地截断（truncate 打开再关闭），防止单次会话日志无限膨胀。
    if let Ok(metadata) = std::fs::metadata(path) {
        if metadata.len() >= DEBUG_LOG_MAX_SIZE {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(path);
        }
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{message}")
}

/// 追加到所有已注册的 debug.log 位置。
pub fn write(message: &str) {
    match PATHS.get() {
        Some(paths) => {
            for path in paths.iter() {
                let _ = write_line(path, message);
            }
        }
        None => {
            // init_paths 之前调用（理论上只在极早期启动阶段）：debug 构建打印到 stderr
            // 便于开发期发现；release 构建静默丢弃。
            #[cfg(debug_assertions)]
            eprintln!("[debug_log:uninitialized] {message}");
            #[cfg(not(debug_assertions))]
            let _ = message;
        }
    }
}

/// 单调递增序号：前端与后端条目交织在同一文件，秒级时间戳排不出先后，序号给出全序。
pub fn next_seq() -> u64 {
    SEQ.fetch_add(1, Ordering::Relaxed)
}

/// 把换行/制表压平成一行：多行输出会破坏 `grep` / `tail -f` 这类按行读取的工具。
pub fn one_line(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

/// 超长 payload 截断，并保留总长度信息——让读者能区分「输出为空」和「输出被省略」。
/// 按**字符**截断（非字节）：中文/emoji 多字节字符按字节切会 panic。
pub fn clamp(value: &str, max: usize) -> String {
    let total = value.chars().count();
    if total <= max {
        return value.to_string();
    }
    let head: String = value.chars().take(max).collect();
    format!("{head}…<截断，共 {total} 字符>")
}

/// 结构化单条日志：
/// `#000123 12:34:56.789 LEVEL [tag] | message`——序号定全序、时刻定位、tag 可 grep。
pub fn log(level: &str, tag: &str, message: &str) {
    let seq = next_seq();
    let time = chrono::Local::now().format("%H:%M:%S%.3f");
    write(&format!(
        "#{seq:06} {time} {level:<5} [{tag}] | {}",
        one_line(&clamp(message, MAX_DETAIL_LEN))
    ));
}

/// 启动横幅：版本 / 构建档 / 操作系统——排查「哪个版本出的问题」的第一行依据。
pub fn boot_banner() {
    let profile = if cfg!(debug_assertions) {
        "debug(dev)"
    } else {
        "release"
    };
    info(
        "boot",
        &format!(
            "Sight Folio v{} 启动 profile={profile} os={}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS
        ),
    );
}

pub fn info(tag: &str, message: &str) {
    log("INFO", tag, message);
}

pub fn warn(tag: &str, message: &str) {
    log("WARN", tag, message);
}

pub fn error(tag: &str, message: &str) {
    log("ERROR", tag, message);
}

/// 安装 panic 钩子：任何线程 panic 都把消息与位置写进 debug.log。
/// 子线程 panic（如导出队列）默认只打到 stderr，打包版（windows_subsystem=windows）
/// 连 stderr 都没有——debug.log 是唯一的现场留痕。
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        error("panic", &format!("{info}"));
    }));
}

/// 系统应用数据目录（identifier `com.sight.folio`，与 tauri.conf.json 一致）。
/// 不引新依赖（dirs-next 已被 RustSec 标记 unmaintained），按平台从环境变量解析。
pub fn os_app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|d| PathBuf::from(d).join("com.sight.folio"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library/Application Support/com.sight.folio"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| PathBuf::from(h).join(".local/share"))
            })
            .map(|d| d.join("com.sight.folio"))
    }
}

/// 解析默认的 debug.log 路径集（优先级 = 写入顺序）：
/// exe 同级 → 系统数据目录 → 当前工作目录。
pub fn resolve_default_paths() -> DebugLogPaths {
    let mut paths: Vec<PathBuf> = Vec::new();

    // 1) exe 同级目录：本地测试版的主诊断位置（用户核心诉求）。
    //    MSI 安装版装进 Program Files 后只读——写入失败被 write_line 静默忽略，
    //    由第 2 级兜底，不会产生副作用。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("debug.log"));
        }
    }

    // 2) 系统应用数据目录：安装版的主位置，永远可写。
    if let Some(data_dir) = os_app_data_dir() {
        paths.push(data_dir.join("debug.log"));
    }

    // 3) 当前工作目录：极端环境（两级都不可用）的最后兜底。
    if paths.is_empty() {
        paths.push(PathBuf::from("debug.log"));
    }

    Arc::new(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_line_escapes_control_characters() {
        assert_eq!(one_line("a\nb\tc\rd"), "a\\nb\\tc\\rd");
    }

    #[test]
    fn clamp_marks_truncation_and_keeps_total_length() {
        let long = "x".repeat(MAX_DETAIL_LEN + 10);
        let clamped = clamp(&long, MAX_DETAIL_LEN);
        assert!(clamped.contains("截断"));
        assert!(clamped.contains(&(MAX_DETAIL_LEN + 10).to_string()));
    }

    #[test]
    fn clamp_never_splits_a_multibyte_char() {
        let value = "中文输出内容";
        let clamped = clamp(value, 2);
        assert!(clamped.starts_with("中文"));
        assert!(clamped.contains("共 6 字符"));
    }

    #[test]
    fn clamp_leaves_short_payloads_untouched() {
        assert_eq!(clamp("short", MAX_DETAIL_LEN), "short");
    }

    #[test]
    fn seq_is_monotonic() {
        let a = next_seq();
        let b = next_seq();
        assert!(b > a);
    }

    #[test]
    fn entry_is_one_greppable_line() {
        // 多行 detail 必须被压平：debug.log 按行 grep/tail，一条事件不允许裂成多行。
        let msg = one_line(&clamp("line1\nline2", MAX_DETAIL_LEN));
        assert!(!msg.contains('\n'));
        assert!(msg.contains("\\n"));
    }
}
