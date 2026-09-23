use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: String,
    pub mime_type: String,
    pub thumbnail: Option<String>,
}

fn mime_from_ext(path: &str) -> &str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".ai") {
        "application/adobe-illustrator"
    } else if lower.ends_with(".eps") {
        "application/postscript"
    } else if lower.ends_with(".psd") {
        "image/vnd.adobe.photoshop"
    } else if lower.ends_with(".tiff") || lower.ends_with(".tif") {
        "image/tiff"
    } else if lower.ends_with(".avif") {
        "image/avif"
    } else if lower.ends_with(".heic") {
        "image/heic"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".ogg") {
        "video/ogg"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".avi") {
        "video/x-msvideo"
    } else {
        "application/octet-stream"
    }
}

fn get_project_root() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let mut dir = exe_dir.parent().ok_or("Failed to get exe directory")?;

    while dir.parent().is_some() {
        if dir.join("package.json").exists() || dir.join("Cargo.toml").exists() {
            return Ok(dir.to_path_buf());
        }
        dir = dir.parent().unwrap();
    }

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?;
    Ok(cwd)
}

fn get_assets_dir(category: &str, subcategory: &str) -> Result<PathBuf, String> {
    // 方案 2（2026-09-14 用户拍板）：素材归数据域 —— 与 config.db / scan_snapshots 同基座
    // （app_data_dir，dev = workspace/data）。此前落 src-tauri/assets 的两宗罪：
    // ① tauri dev watcher 盯着 src-tauri，上传封面即触发热重建（用户感知为「闪退」）；
    // ② 用户私人图片混进源码树且未被 gitignore，污染仓库。
    let assets_dir = crate::infrastructure::database::connection::app_data_dir()
        .join("assets")
        .join(category)
        .join(subcategory);
    fs::create_dir_all(&assets_dir).map_err(|e| format!("Failed to create assets dir: {}", e))?;
    Ok(assets_dir)
}

#[tauri::command]
pub fn read_file_as_data_url(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let bytes =
        fs::read(path).map_err(|e| format!("Failed to read file '{}': {}", file_path, e))?;

    let mime = mime_from_ext(&file_path);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn get_project_assets_dir(category: String, subcategory: String) -> Result<String, String> {
    let dir = get_assets_dir(&category, &subcategory)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_assets(category: String, subcategory: String) -> Result<Vec<AssetInfo>, String> {
    let assets_dir = get_assets_dir(&category, &subcategory)?;

    if !assets_dir.exists() {
        return Ok(vec![]);
    }

    let mut assets = Vec::new();

    let entries =
        fs::read_dir(&assets_dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let metadata =
            fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let modified = metadata
            .modified()
            .map(|t| {
                let datetime: chrono::DateTime<chrono::Local> = t.into();
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_default();

        let mime_str = file_name.clone();
        let mime = mime_from_ext(&mime_str);

        let thumbnail = None;

        assets.push(AssetInfo {
            name: file_name,
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
            modified,
            mime_type: mime.to_string(),
            thumbnail,
        });
    }

    assets.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(assets)
}

#[tauri::command]
pub fn save_asset(
    category: String,
    subcategory: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<AssetInfo, String> {
    let assets_dir = get_assets_dir(&category, &subcategory)?;

    let timestamp = chrono::Utc::now().timestamp_millis();
    let unique_name = format!("{}_{}", timestamp, file_name);
    let file_path = assets_dir.join(&unique_name);

    fs::write(&file_path, &data).map_err(|e| format!("Failed to write file: {}", e))?;

    let metadata =
        fs::metadata(&file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    let modified = metadata
        .modified()
        .map(|t| {
            let datetime: chrono::DateTime<chrono::Local> = t.into();
            datetime.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_default();

    let mime_str = unique_name.clone();
    let mime = mime_from_ext(&mime_str);

    Ok(AssetInfo {
        name: unique_name,
        path: file_path.to_string_lossy().to_string(),
        size: metadata.len(),
        modified,
        mime_type: mime.to_string(),
        thumbnail: None,
    })
}

#[tauri::command]
pub fn delete_asset(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub fn get_asset_thumbnail(file_path: String, max_size: u32) -> Result<String, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let mime = mime_from_ext(&file_path);

    if !mime.starts_with("image/") {
        return Err(format!("Not an image file: {}", mime));
    }

    let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let data_url = format!("data:{};base64,{}", mime, b64);

    if max_size > 0 {
        let estimated_size = (b64.len() as f64 * 0.75) as u64;
        if estimated_size > (max_size as u64) * 1024 {
            return Ok(data_url);
        }
    }

    Ok(data_url)
}

#[tauri::command]
pub fn save_background_asset(
    _app: tauri::AppHandle,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let result = save_asset(
        "backgrounds".to_string(),
        "images".to_string(),
        file_name,
        data,
    )?;
    Ok(result.path)
}

#[tauri::command]
pub fn rename_asset(file_path: String, new_name: String) -> Result<String, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let parent = path.parent().ok_or("Failed to get parent directory")?;

    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("File already exists: {}", new_name));
    }

    fs::rename(&path, &new_path).map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

fn get_thumbnails_dir() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
    let mut dir = exe_dir.parent().ok_or("Failed to get exe directory")?;

    while dir.parent().is_some() {
        if dir.join("package.json").exists() {
            let thumb_dir = dir.join("public").join("thumbnails");
            fs::create_dir_all(&thumb_dir).map_err(|e| format!("Failed to create thumbnails dir: {}", e))?;
            return Ok(thumb_dir);
        }
        dir = dir.parent().unwrap();
    }

    let project_root = get_project_root()?;
    let dir = project_root.join("public").join("thumbnails");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create thumbnails dir: {}", e))?;
    Ok(dir)
}

#[tauri::command]
pub fn save_thumbnail(component_type: String, data_url: String) -> Result<String, String> {
    let data_url = data_url.trim();

    let b64_data = if let Some(idx) = data_url.find(",") {
        &data_url[idx + 1..]
    } else {
        return Err("Invalid data URL format".to_string());
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let dir = get_thumbnails_dir()?;
    let safe_type = component_type.replace(":", "__");
    let file_name = format!("{}.png", safe_type);
    let file_path = dir.join(&file_name);

    fs::write(&file_path, &bytes).map_err(|e| format!("Failed to write thumbnail: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn check_thumbnails_exist(types: Vec<String>) -> Result<Vec<bool>, String> {
    let dir = get_thumbnails_dir()?;
    let results: Vec<bool> = types
        .iter()
        .map(|t| dir.join(format!("{}.png", t.replace(":", "__"))).exists())
        .collect();
    Ok(results)
}

/// 把正文 HTML 里存的相对引用 `assets/<cat>/<sub>/<name>` 解析为磁盘绝对路径。
///
/// 仅做「app_data_dir 基座 + 相对拼接」，并对 `..` / 绝对路径做拒入，
/// 杜绝路径穿越。插画落库基座已迁到 app_data_dir（方案 2），故相对引用
/// 一定落在数据域内，导出打包 / 渲染期定位都走它，不依赖机器绝对路径。
#[tauri::command]
pub fn resolve_asset_ref(rel: String) -> Result<String, String> {
    if rel.contains("..") || rel.starts_with('/') {
        return Err(format!("invalid asset ref: {}", rel));
    }
    let base = crate::infrastructure::database::connection::app_data_dir();
    let path = base.join(&rel);
    Ok(path.to_string_lossy().to_string())
}

// ─── 通用文件读取（图片/资源加载的统一入口）─────────────────────────────
// 此前图片经 convertFileSrc + asset 协议（scope 只含 $HOME/$APPDATA/$RESOURCE）加载，
// 项目放在外置卷（/Volumes/...）等 $HOME 之外的路径时被 scope 拒绝 → 图片无法加载。
// 该命令返回原始字节（tauri::ipc::Response），前端 invoke 直接拿 ArrayBuffer →
// blob URL，任何操作系统 / 任何项目路径都可用，不再受 asset 协议 scope 约束。

/// 单文件读取上限：64MB（图片/字体等资源场景足够，防大文件一次性撑爆内存）。
const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;

/// 读取任意文件字节。返回 `tauri::ipc::Response`（原始二进制，前端拿到 ArrayBuffer）。
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let p = std::path::Path::new(&path);
    let meta = std::fs::metadata(p).map_err(|e| format!("metadata failed: {e}"))?;
    if !meta.is_file() {
        return Err(format!("not a file: {path}"));
    }
    if meta.len() > MAX_ASSET_BYTES {
        return Err(format!("file too large: {} bytes (max {MAX_ASSET_BYTES})", meta.len()));
    }
    let bytes = tokio::fs::read(p).await.map_err(|e| format!("read failed: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}
