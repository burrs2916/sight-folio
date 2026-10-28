use crate::error::AppResult;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// 文件变更事件（发送到前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub analysis_id: String,
    pub path: String,
    pub kind: String,
    pub timestamp: i64,
}

/// 单个监视任务（只存 watcher handle 和 running flag，rx 已被线程消费）
struct WatchJob {
    _watcher: Option<RecommendedWatcher>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
    running: Arc<AtomicBool>,
}

/// 文件监视器状态管理
pub struct FileWatcherState {
    jobs: Mutex<HashMap<String, WatchJob>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

/// 开始监视某个分析的 project_root
#[tauri::command]
pub fn start_watching(
    analysis_id: String,
    project_root: String,
    state: tauri::State<'_, FileWatcherState>,
    app: AppHandle,
) -> AppResult<String> {
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|e| crate::error::AppError::Internal(format!("监视任务表锁定失败: {e}")))?;

    // 如果已有监视任务，先停止
    if let Some(existing) = jobs.remove(&analysis_id) {
        stop_job(existing);
    }

    let root = PathBuf::from(&project_root);
    if !root.exists() || !root.is_dir() {
        return Err(crate::error::AppError::Internal(format!(
            "目录不存在: {}",
            project_root
        )));
    }

    // 创建 notify 通道
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let aid = analysis_id.clone();
    let app_clone = app.clone();

    // 创建文件监视器
    let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
        Ok(w) => w,
        Err(e) => {
            return Err(crate::error::AppError::Internal(format!(
                "创建文件监视器失败: {}",
                e
            )));
        }
    };

    // 开始递归监视
    if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
        return Err(crate::error::AppError::Internal(format!(
            "开始监视失败: {}",
            e
        )));
    }

    // 后台线程处理文件变更事件（接收 rx）
    let handle = std::thread::spawn(move || {
        let debounce_ms = 300u64;
        let mut last_event_time: HashMap<PathBuf, i64> = HashMap::new();
        let mut pending_events: Vec<FileChangeEvent> = Vec::new();

        loop {
            if !running_clone.load(Ordering::Relaxed) {
                break;
            }

            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(Ok(event)) => {
                    let now = chrono::Utc::now().timestamp_millis();

                    for path in &event.paths {
                        if is_watch_excluded(path) {
                            continue;
                        }

                        let kind = match &event.kind {
                            EventKind::Create(_) => "created",
                            EventKind::Modify(_) => "modified",
                            EventKind::Remove(_) => "removed",
                            _ => continue,
                        };

                        let last = last_event_time.get(path).copied().unwrap_or(0);
                        if now - last < debounce_ms as i64 {
                            continue;
                        }
                        last_event_time.insert(path.clone(), now);

                        pending_events.push(FileChangeEvent {
                            analysis_id: aid.clone(),
                            path: path.to_string_lossy().to_string(),
                            kind: kind.to_string(),
                            timestamp: now,
                        });
                    }
                }
                Ok(Err(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if !pending_events.is_empty() {
                let batch: Vec<FileChangeEvent> = pending_events.drain(..).collect();
                let _ = app_clone.emit("file-changes", &batch);
            }
        }

        let _ = app_clone.emit(
            "watching-stopped",
            &serde_json::json!({ "analysisId": aid }),
        );
    });

    jobs.insert(
        analysis_id.clone(),
        WatchJob {
            _watcher: Some(watcher),
            thread_handle: Some(handle),
            running,
        },
    );

    Ok(analysis_id)
}

/// 停止监视某个分析
#[tauri::command]
pub fn stop_watching(
    analysis_id: String,
    state: tauri::State<'_, FileWatcherState>,
) -> AppResult<()> {
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|e| crate::error::AppError::Internal(format!("监视任务表锁定失败: {e}")))?;
    if let Some(job) = jobs.remove(&analysis_id) {
        stop_job(job);
    }
    Ok(())
}

/// 获取监视状态
#[tauri::command]
pub fn get_watch_status(
    analysis_id: String,
    state: tauri::State<'_, FileWatcherState>,
) -> AppResult<bool> {
    let jobs = state
        .jobs
        .lock()
        .map_err(|e| crate::error::AppError::Internal(format!("监视任务表锁定失败: {e}")))?;
    Ok(jobs.contains_key(&analysis_id))
}

/// 停止单个监视任务
fn stop_job(job: WatchJob) {
    job.running.store(false, Ordering::Relaxed);
    // watcher drop → 通道自动断开 → 线程循环退出
    drop(job._watcher);
    if let Some(handle) = job.thread_handle {
        let _ = handle.join();
    }
}

/// 判断文件路径是否应该被排除监视
fn is_watch_excluded(path: &PathBuf) -> bool {
    let excludes = [
        "node_modules",
        ".git",
        ".svn",
        "target",
        "dist",
        "build",
        "__pycache__",
        ".DS_Store",
    ];
    for comp in path.components() {
        if let std::path::Component::Normal(name) = comp {
            if let Some(s) = name.to_str() {
                if excludes.iter().any(|e| e.eq_ignore_ascii_case(s)) {
                    return true;
                }
            }
        }
    }
    false
}
