// 操作系统级辅助命令（对标 Zed tab context menu 的 `Reveal in File Manager`）。
// 仅依赖标准库 std::process，不引入新 crate / 新前端依赖。

use std::path::Path;
use std::process::Command;

/// 在系统文件管理器中定位并高亮指定文件 / 目录（对标 Zed `Reveal in File Manager`）。
///
/// - macOS：`open -R <path>`（在 Finder 中选中并高亮）
/// - Windows：`explorer /select,"<path>"`
/// - Linux：`xdg-open <parent>`（打开所在目录）
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    let p = Path::new(trimmed);
    if !p.exists() {
        return Err(format!("path does not exist: {trimmed}"));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(p)
            .spawn()
            .map_err(|e| format!("[reveal] spawn open failed: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,\"{}\"", p.display()))
            .spawn()
            .map_err(|e| format!("[reveal] spawn explorer failed: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = p.parent().unwrap_or(p);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("[reveal] spawn xdg-open failed: {e}"))?;
    }

    Ok(())
}
