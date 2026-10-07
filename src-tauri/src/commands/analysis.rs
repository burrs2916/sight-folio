use crate::commands::logger::LoggerState;
use crate::domain::analysis::{Analysis, AnalysisCategory};
use crate::error::AppError;
use crate::infrastructure::database::analysis_repository::AnalysisRepository;
use crate::infrastructure::SqliteAnalysisRepository;
use tauri::State;

pub struct AnalysisState {
    pub repository: SqliteAnalysisRepository,
}

fn log_scene_op(logger_state: &State<'_, LoggerState>, level: &str, module: &str, message: &str) {
    if let Ok(log_dir) = logger_state.log_dir.lock() {
        let entry = crate::commands::logger::LogEntry {
            level: level.to_string(),
            module: module.to_string(),
            message: message.to_string(),
            data: None,
            timestamp: None,
        };
        let _ = crate::commands::logger::write_log(&log_dir, &entry);
    }
}

#[tauri::command]
pub fn get_all_analyses(state: State<'_, AnalysisState>) -> Result<Vec<Analysis>, AppError> {
    state.repository.get_all_analyses()
}

#[tauri::command]
pub fn get_analysis(
    state: State<'_, AnalysisState>,
    id: String,
) -> Result<Option<Analysis>, AppError> {
    state.repository.get_analysis_by_id(&id)
}

#[tauri::command]
pub fn get_analyses_by_category(
    state: State<'_, AnalysisState>,
    category_id: String,
) -> Result<Vec<Analysis>, AppError> {
    state.repository.get_analyses_by_category(&category_id)
}

#[tauri::command]
pub fn create_analysis(
    state: State<'_, AnalysisState>,
    logger_state: State<'_, LoggerState>,
    analysis: Analysis,
) -> Result<(), AppError> {
    log_scene_op(
        &logger_state,
        "info",
        "AnalysisCommand",
        &format!(
            "Creating analysis: id={}, name={}, root={}",
            analysis.id, analysis.name, analysis.project_root
        ),
    );
    let result = state.repository.save_analysis(&analysis);
    match &result {
        Ok(()) => log_scene_op(
            &logger_state,
            "info",
            "AnalysisCommand",
            &format!("Analysis created: id={}", analysis.id),
        ),
        Err(e) => log_scene_op(
            &logger_state,
            "error",
            "AnalysisCommand",
            &format!("Failed to create analysis: id={}, error={}", analysis.id, e),
        ),
    }
    result
}

#[tauri::command]
pub fn update_analysis(
    state: State<'_, AnalysisState>,
    logger_state: State<'_, LoggerState>,
    analysis: Analysis,
) -> Result<(), AppError> {
    log_scene_op(
        &logger_state,
        "info",
        "AnalysisCommand",
        &format!(
            "Updating analysis: id={}, name={}, root={}",
            analysis.id, analysis.name, analysis.project_root
        ),
    );
    let result = state.repository.save_analysis(&analysis);
    match &result {
        Ok(()) => log_scene_op(
            &logger_state,
            "info",
            "AnalysisCommand",
            &format!("Analysis updated: id={}", analysis.id),
        ),
        Err(e) => log_scene_op(
            &logger_state,
            "error",
            "AnalysisCommand",
            &format!("Failed to update analysis: id={}, error={}", analysis.id, e),
        ),
    }
    result
}

#[tauri::command]
pub fn delete_analysis(
    state: State<'_, AnalysisState>,
    logger_state: State<'_, LoggerState>,
    id: String,
) -> Result<(), AppError> {
    log_scene_op(
        &logger_state,
        "info",
        "AnalysisCommand",
        &format!("Deleting analysis: id={}", id),
    );
    let result = state.repository.delete_analysis(&id);
    match &result {
        Ok(()) => log_scene_op(
            &logger_state,
            "info",
            "AnalysisCommand",
            &format!("Analysis deleted: id={}", id),
        ),
        Err(e) => log_scene_op(
            &logger_state,
            "error",
            "AnalysisCommand",
            &format!("Failed to delete analysis: id={}, error={}", id, e),
        ),
    }
    result
}

#[tauri::command]
pub fn get_all_analysis_categories(
    state: State<'_, AnalysisState>,
) -> Result<Vec<AnalysisCategory>, AppError> {
    state.repository.get_all_analysis_categories()
}

#[tauri::command]
pub fn get_analysis_category(
    state: State<'_, AnalysisState>,
    id: String,
) -> Result<Option<AnalysisCategory>, AppError> {
    state.repository.get_analysis_category_by_id(&id)
}

#[tauri::command]
pub fn save_analysis_category(
    state: State<'_, AnalysisState>,
    category: AnalysisCategory,
) -> Result<(), AppError> {
    state.repository.save_analysis_category(&category)
}

#[tauri::command]
pub fn delete_analysis_category(
    state: State<'_, AnalysisState>,
    id: String,
) -> Result<(), AppError> {
    state.repository.delete_analysis_category(&id)
}

/// 保存扫描排除配置到 analyses.metadata（R40）。
///
/// 只更新 metadata 里的 `scanExcludes`（手动排除目录）与 `excludeResources`
/// （是否排除非代码资源文件）两个键，其它字段不动 —— 避免走全量 update_analysis
/// 时把内存里可能过期的 views/editorComponents 一起写回。
#[tauri::command]
pub fn save_scan_excludes(
    state: State<'_, AnalysisState>,
    logger_state: State<'_, LoggerState>,
    analysis_id: String,
    exclude_dirs: Vec<String>,
    exclude_resources: bool,
) -> Result<(), AppError> {
    // 读旧 metadata，合并后写回（不覆盖其它键）
    let mut metadata = state
        .repository
        .get_analysis_by_id(&analysis_id)?
        .map(|a| {
            serde_json::from_str::<serde_json::Value>(&a.metadata)
                .unwrap_or(serde_json::Value::Object(Default::default()))
        })
        .unwrap_or_else(|| serde_json::Value::Object(Default::default()));

    if let serde_json::Value::Object(ref mut map) = metadata {
        map.insert(
            "scanExcludes".to_string(),
            serde_json::Value::Array(
                exclude_dirs
                    .iter()
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| serde_json::Value::String(s.trim().to_string()))
                    .collect(),
            ),
        );
        map.insert(
            "excludeResources".to_string(),
            serde_json::Value::Bool(exclude_resources),
        );
    }

    state
        .repository
        .update_metadata(&analysis_id, &metadata.to_string())?;
    log_scene_op(
        &logger_state,
        "info",
        "AnalysisCommand",
        &format!(
            "Scan excludes saved: id={}, dirs={:?}, resources={}",
            analysis_id, exclude_dirs, exclude_resources
        ),
    );
    Ok(())
}
