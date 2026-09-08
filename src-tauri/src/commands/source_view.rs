//! 源码查看命令：把画布实体 / 符号 / 审查发现「跳回代码本身」
//!
//! 对应需求文档 §2 概念映射表 EventBinding 一行：
//! 「事件绑定（点击实体跳转到对应代码行、悬停显示详情面板）」。
//! 此前三个 analyzer 插件都声明了 navigate-to-source / open-file 事件处理器，
//! 但没有任何一端能真正读到源码 —— 分析器看得见结构、看不见代码，
//! 用户在画布上发现「这个文件圈复杂度 42」之后无路可走。本命令补上最后一跳。
//!
//! 安全边界（重要）：只接受 file_id，不接受任意路径。
//! 路径一律从 project_files 表反查，即「只有被扫描过的文件才可读」，
//! 前端无法借这个命令读取项目之外的任何文件。

use crate::error::{AppError, AppResult};
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::SqliteProjectFileRepository;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

/// 单个源码文件的内容载荷（前端源码查看器渲染用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFileContent {
    pub file_id: String,
    pub path: String,
    pub rel_path: String,
    pub name: String,
    pub language: String,
    /// 按行切好的内容（前端直接映射行号，避免再切一次）
    pub lines: Vec<String>,
    pub total_lines: usize,
    /// 文件过大被截断时为 true，此时 lines 只含前 MAX_LINES 行
    pub truncated: bool,
    /// 二进制或非 UTF-8 文件无法展示时的原因说明
    pub skipped_reason: Option<String>,
}

/// 单文件最大展示行数：超过则截断，避免一次塞 10 万行进渲染层卡死界面
const MAX_LINES: usize = 6000;
/// 单文件最大字节数（2MB）：超过直接拒绝读取
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// 读取某个已扫描文件的源码内容
///
/// 只按 file_id 查表取路径，杜绝任意路径读取。
#[tauri::command]
pub fn read_source_file(
    file_id: String,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
) -> AppResult<SourceFileContent> {
    let file = file_repo
        .get(&file_id)?
        .ok_or_else(|| AppError::NotFound(format!("文件不存在或未被扫描: {}", file_id)))?;

    if file.is_directory {
        return Err(AppError::Validation("目标是目录，无法查看源码".into()));
    }

    let language = file.language.clone().unwrap_or_default();
    let base = SourceFileContent {
        file_id: file.id.clone(),
        path: file.path.clone(),
        rel_path: file.rel_path.clone(),
        name: file.name.clone(),
        language,
        lines: Vec::new(),
        total_lines: 0,
        truncated: false,
        skipped_reason: None,
    };

    // 体积闸门：先看元数据再决定要不要读进内存
    if let Ok(meta) = std::fs::metadata(&file.path) {
        if meta.len() > MAX_BYTES {
            return Ok(SourceFileContent {
                skipped_reason: Some(format!(
                    "文件过大（{:.1} MB），超过 2 MB 展示上限",
                    meta.len() as f64 / 1024.0 / 1024.0
                )),
                ..base
            });
        }
    }

    let content = match std::fs::read_to_string(&file.path) {
        Ok(c) => c,
        Err(e) => {
            // 二进制文件 / 编码非 UTF-8 / 文件已被删除，都走这里，返回原因而不是报错
            return Ok(SourceFileContent {
                skipped_reason: Some(format!("无法以文本方式读取：{}", e)),
                ..base
            });
        }
    };

    let all: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let total_lines = all.len();
    let truncated = total_lines > MAX_LINES;
    let lines = if truncated {
        all.into_iter().take(MAX_LINES).collect()
    } else {
        all
    };

    Ok(SourceFileContent {
        lines,
        total_lines,
        truncated,
        ..base
    })
}
