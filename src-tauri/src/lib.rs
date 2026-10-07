mod application;
mod commands;
mod domain;
mod error;
mod infrastructure;
mod parser;
mod plugins;

use application::{
    DeleteGroupUseCase, DeleteIconUseCase, GetAllGroupsUseCase, GetAllIconsUseCase,
    GetGroupUseCase, GetIconUseCase, GetIconsByGroupUseCase, SaveGroupUseCase, SaveIconUseCase,
};
use application::{
    DeletePresetConfigUseCase, GetConfigUseCase, GetPresetConfigUseCase, ResetConfigUseCase,
    SavePresetConfigUseCase, UpdateConfigUseCase,
};
use commands::{
    init_logger_state, AuthState, ComponentPluginState, CorpusState, DatasourceState, IconsState,
    AnalysisState, SettingsState, FileWatcherState,
    TerminalManager,
};
use infrastructure::database::{init_tables, migrate};
use infrastructure::{
    Database, SqliteAuthRepository, SqliteDatasourceRepository, SqliteIconRepository,
    SqliteAnalysisRepository, SqliteSettingsRepository,
    SqliteProjectFileRepository, SqliteProjectModuleRepository, SqliteProjectDependencyRepository,
    SqliteProjectLayerRepository, SqliteReviewRuleRepository, SqliteReviewFindingRepository,
    SqliteScanJobRepository, SqliteProjectSymbolRepository, SqliteProjectSymbolRefRepository,
    SqliteProjectFileMetricRepository, SqliteProjectTechDebtRepository,
    SqliteProjectCodeIndexRepository, SqliteProjectGitChurnRepository,
    SqliteProjectCallEdgeRepository, SqliteProjectCodeCloneRepository,
    SqliteProjectChangeCouplingRepository, SqliteProjectDataFlowRepository,
    SqliteWritingRepository, CorpusDatabase, SqliteCorpusRepository,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// 拉起独立原生「代码工作台」窗口。
///
/// - 若 `code-workbench` 窗口已存在：聚焦它并 emit 打开事件（携带文件/行/分析），
///   前端监听后 openWorkbenchTab —— 避免重复创建、复用单例（IDE 风格）。
/// - 否则用 WebviewWindowBuilder 创建新系统窗口，初始 URL 带 `workbench=1` query
///   （前端 App 顶层据此渲染 CodeWorkbenchStandalone 而非主布局），并附带
///   fileId / line / analysisId 供新窗口自举加载项目与定位焦点文件。
#[tauri::command]
async fn spawn_code_workbench(
    app: tauri::AppHandle,
    file_id: String,
    line: Option<u32>,
    analysis_id: Option<String>,
) -> Result<(), String> {
    const LABEL: &str = "code-workbench";
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.emit(
            "code-workbench-open",
            serde_json::json!({
                "fileId": file_id,
                "line": line,
                "analysisId": analysis_id,
            }),
        );
        let _ = win.set_focus();
        return Ok(());
    }
    let query = format!(
        "workbench=1&fileId={}&line={}&analysisId={}",
        file_id,
        line.unwrap_or(0),
        analysis_id.unwrap_or_default()
    );
    let url = if let Some(dev) = app.config().build.dev_url.clone() {
        let base = dev.to_string().trim_end_matches('/').to_string();
        WebviewUrl::External(
            url::Url::parse(&format!("{}/?{}", base, query)).map_err(|e| e.to_string())?,
        )
    } else {
        WebviewUrl::App(PathBuf::from(format!("index.html?{}", query)))
    };
    WebviewWindowBuilder::new(&app, LABEL, url)
        .title("Sight Folio — 创作工作台")
        .inner_size(1280.0, 860.0)
        .min_inner_size(820.0, 600.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let db = Database::new(app.handle()).expect("Failed to initialize database");

            {
                let conn = db.0.lock().unwrap();
                init_tables(&conn).expect("Failed to initialize tables");
                migrate(&conn).expect("Failed to migrate database");
            }

            let db_arc = Arc::new(db);

            let auth_repo = SqliteAuthRepository::new(db_arc.clone());
            let settings_repo = SqliteSettingsRepository::new(db_arc.clone());
            let icon_repo = SqliteIconRepository::new(db_arc.clone());
            let datasource_repo = SqliteDatasourceRepository::new(db_arc.clone());
            let analysis_repo = Arc::new(SqliteAnalysisRepository::new(db_arc.clone()));

            // ─── sight-folio 7 个核心 repository ───
            let project_file_repo = Arc::new(SqliteProjectFileRepository::new(db_arc.clone()));
            let project_module_repo = Arc::new(SqliteProjectModuleRepository::new(db_arc.clone()));
            let project_dependency_repo = Arc::new(SqliteProjectDependencyRepository::new(db_arc.clone()));
            let project_layer_repo = Arc::new(SqliteProjectLayerRepository::new(db_arc.clone()));
            let review_rule_repo = Arc::new(SqliteReviewRuleRepository::new(db_arc.clone()));
            let review_finding_repo = Arc::new(SqliteReviewFindingRepository::new(db_arc.clone()));
            let scan_job_repo = Arc::new(SqliteScanJobRepository::new(db_arc.clone()));
            let project_symbol_repo = Arc::new(SqliteProjectSymbolRepository::new(db_arc.clone()));
            let project_symbol_ref_repo = Arc::new(SqliteProjectSymbolRefRepository::new(db_arc.clone()));
            let project_file_metric_repo = Arc::new(SqliteProjectFileMetricRepository::new(db_arc.clone()));
            let project_tech_debt_repo = Arc::new(SqliteProjectTechDebtRepository::new(db_arc.clone()));
            let project_code_index_repo = Arc::new(SqliteProjectCodeIndexRepository::new(db_arc.clone()));
            let project_git_churn_repo = Arc::new(SqliteProjectGitChurnRepository::new(db_arc.clone()));
            let project_call_edge_repo = Arc::new(SqliteProjectCallEdgeRepository::new(db_arc.clone()));
            let project_code_clone_repo = Arc::new(SqliteProjectCodeCloneRepository::new(db_arc.clone()));
            let project_change_coupling_repo =
                Arc::new(SqliteProjectChangeCouplingRepository::new(db_arc.clone()));
            let project_data_flow_repo =
                Arc::new(SqliteProjectDataFlowRepository::new(db_arc.clone()));
            // ─── 写作域 repository（Sight Folio）───
            let writing_repo = Arc::new(SqliteWritingRepository::new(db_arc.clone()));

            // ─── 语料库（独立 corpus.db，与业务库隔离）───
            // B2 降级：语料库是可选功能，初始化失败**不得** abort 整个应用——
            // 记录原因并注册 unavailable 状态，corpus 命令统一返回明确错误，
            // 前端经 corpus_status 探测后显示「语料库不可用」。
            // （历史教训：这里的 `.expect()` 曾因 schema 升级失败让应用启动即 SIGABRT。）
            let corpus_state = match CorpusDatabase::new() {
                Ok(corpus_db) => CorpusState::ready(Arc::new(SqliteCorpusRepository::new(Arc::new(
                    corpus_db,
                )))),
                Err(e) => {
                    eprintln!("[sight-folio] corpus database unavailable, degrading: {e}");
                    CorpusState::unavailable(e.to_string())
                }
            };

            let auth_state = AuthState {
                get_config_use_case: GetConfigUseCase::new(auth_repo.clone()),
                update_config_use_case: UpdateConfigUseCase::new(auth_repo.clone()),
                reset_config_use_case: ResetConfigUseCase::new(auth_repo.clone()),
                get_preset_config_use_case: GetPresetConfigUseCase::new(auth_repo.clone()),
                save_preset_config_use_case: SavePresetConfigUseCase::new(auth_repo.clone()),
                delete_preset_config_use_case: DeletePresetConfigUseCase::new(auth_repo),
            };

            let settings_state = SettingsState {
                repository: settings_repo,
            };

            let icons_state = IconsState {
                get_all_groups_use_case: GetAllGroupsUseCase::new(icon_repo.clone()),
                get_group_use_case: GetGroupUseCase::new(icon_repo.clone()),
                save_group_use_case: SaveGroupUseCase::new(icon_repo.clone()),
                delete_group_use_case: DeleteGroupUseCase::new(icon_repo.clone()),
                get_all_icons_use_case: GetAllIconsUseCase::new(icon_repo.clone()),
                get_icons_by_group_use_case: GetIconsByGroupUseCase::new(icon_repo.clone()),
                get_icon_use_case: GetIconUseCase::new(icon_repo.clone()),
                save_icon_use_case: SaveIconUseCase::new(icon_repo.clone()),
                delete_icon_use_case: DeleteIconUseCase::new(icon_repo),
            };

            let datasource_state = DatasourceState {
                repository: datasource_repo,
            };

            let analysis_state = AnalysisState {
                repository: (*analysis_repo).clone(),
            };

            let component_plugin_state = ComponentPluginState { db: db_arc.clone() };

            let logger_state = init_logger_state();

            app.manage(auth_state);
            app.manage(settings_state);
            app.manage(icons_state);
            app.manage(datasource_state);
            app.manage(analysis_state);
            app.manage(component_plugin_state);
            // AI Agent 命令（save_provider / list_providers / save_agent …）依赖 State<'_, Arc<Database>>，必须注册
            app.manage(db_arc.clone());
            app.manage(logger_state);
            app.manage(crate::commands::project_scan::AnalysisCancelState::default());
            // 文件内容读一次共享缓存（消除各分析阶段重复 read_to_string 的磁盘 I/O）
            app.manage(crate::commands::project_scan::ScanContentCache::new());

            // sight-folio 核心 repository
            app.manage(project_file_repo);
            app.manage(project_module_repo);
            app.manage(project_dependency_repo);
            app.manage(project_layer_repo);
            app.manage(review_rule_repo);
            app.manage(review_finding_repo);
            app.manage(scan_job_repo);
            app.manage(project_symbol_repo);
            app.manage(project_symbol_ref_repo);
            app.manage(project_file_metric_repo);
            app.manage(project_tech_debt_repo);
            app.manage(project_code_index_repo);
            app.manage(project_git_churn_repo);
            app.manage(project_call_edge_repo);
            app.manage(project_code_clone_repo);
            app.manage(project_change_coupling_repo);
            app.manage(project_data_flow_repo);
            app.manage(analysis_repo.clone());
            app.manage(writing_repo);
            app.manage(corpus_state);

            // 文件监视器状态
            app.manage(FileWatcherState::new());

            // 代码工作台集成终端会话表
            app.manage(TerminalManager::new());

            let window = app.get_webview_window("main").unwrap();
            window.set_title("Sight Folio")?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_auth_config,
            commands::update_auth_config,
            commands::reset_auth_config,
            commands::get_preset_config,
            commands::save_preset_config,
            commands::delete_preset_config,
            commands::get_setting,
            commands::set_setting,
            commands::delete_setting,
            commands::get_all_groups,
            commands::get_group,
            commands::save_group,
            commands::delete_group,
            commands::get_all_icons,
            commands::get_icons_by_group,
            commands::get_icon,
            commands::save_icon,
            commands::delete_icon,
            commands::upload_icon,
            commands::get_icon_file_url,
            commands::get_icon_file_urls,
            commands::get_all_datasources,
            commands::get_datasource,
            commands::save_datasource,
            commands::delete_datasource,
            commands::db_test_connection,
            commands::db_execute_query,
            commands::get_all_analyses,
            commands::get_analysis,
            commands::get_analyses_by_category,
            commands::create_analysis,
            commands::update_analysis,
            commands::delete_analysis,
            commands::get_all_analysis_categories,
            commands::get_analysis_category,
            commands::save_analysis_category,
            commands::delete_analysis_category,
            commands::write_log_entry,
            commands::write_log_batch,
            commands::get_log_dir_path,
            commands::read_file_as_data_url,
            commands::save_background_asset,
            commands::get_project_assets_dir,
            commands::list_assets,
            commands::save_asset,
            commands::delete_asset,
            commands::get_asset_thumbnail,
            commands::rename_asset,
            commands::get_all_component_plugins,
            commands::get_enabled_component_plugins,
            commands::get_component_plugin_by_type,
            commands::create_component_plugin,
            commands::update_component_plugin,
            commands::delete_component_plugin,
            commands::toggle_component_plugin,
            commands::get_component_categories,
            commands::create_component_category,
            commands::update_component_category,
            commands::delete_component_category,
            commands::move_plugin_to_category,
            commands::save_thumbnail,
            commands::check_thumbnails_exist,
            commands::read_file_bytes,
            commands::resolve_asset_ref,
            // ─── sight-folio 扫描与审查 ───
            commands::scan_project,
            commands::check_scan_freshness,
            commands::check_gitignore,
            commands::save_scan_excludes,
            commands::cancel_scan_job,
            commands::cancel_analysis,
            commands::reset_analysis_cancel,
            commands::get_latest_scan_job,
            commands::get_scan_delta,
            commands::list_project_files,
            commands::list_project_modules,
            commands::list_project_dependencies,
            commands::list_project_layers,
            commands::list_review_rules,
            commands::list_review_findings,
            commands::count_findings_by_severity,
            // 审查执行 + 依赖检测
            commands::run_review_rules,
            commands::sync_analyzer_rules,
            commands::detect_dependencies,
            // 解析器能力查询（R45 前后端能力联动）
            commands::list_parser_capabilities,
            commands::parser_capability_for,
            // 代码写回（R46 P1：AI 改代码的前提）
            commands::write_file,
            // AI 改动评审台账（R47 P2-A：先落盘、再评审，逐条可撤销）
            commands::list_code_changes,
            commands::count_pending_code_changes,
            commands::keep_code_change,
            commands::revert_code_change,
            commands::revert_code_changes_by_conversation,
            // 架构分层 CRUD
            commands::save_project_layer,
            commands::delete_project_layer,
            commands::sync_files_to_canvas,
            // 目录与 Git 工具命令
            commands::read_directory,
            commands::get_git_repo_info,
            // 文件变更监视
            commands::start_watching,
            commands::stop_watching,
            commands::get_watch_status,
            // ─── 代码结构索引与设计模式 ───
            commands::analyze_code_structure,
            commands::list_project_symbols,
            commands::count_symbols_by_kind,
            commands::list_design_patterns,
            commands::redetect_design_patterns,
            // ─── 符号级引用分析 + 符号索引搜索 ───
            commands::analyze_symbol_references,
            commands::list_symbol_refs,
            commands::search_project_symbols,
            // ─── 文件度量分析（复杂度热力图）───
            commands::analyze_file_metrics,
            commands::list_file_metrics,
            // ─── 技术债扫描（TODO/FIXME/HACK 等）───
            commands::scan_tech_debt,
            commands::list_tech_debt,
            // ─── 代码全文索引（search_code_content）───
            commands::index_code_content,
            commands::search_code_content,
            commands::count_code_index,
            // ─── 死代码检测（零引用符号）───
            commands::detect_dead_symbols,
            commands::list_dead_symbols,
            // ─── Git 变更热点（churn vs complexity）───
            commands::is_git_repo,
            commands::analyze_git_history,
            commands::list_git_churn,
            // ─── 函数调用图（影响面分析）───
            commands::analyze_call_graph,
            commands::list_call_edges,
            commands::query_call_reachability,
            // ─── 源码查看（画布实体 → 代码行的最后一跳）───
            commands::read_source_file,
            // ─── 代码克隆检测（重复率，winnowing 指纹）───
            commands::detect_code_clones,
            commands::list_code_clones,
            // ─── 变更耦合（时间维度：总是一起改的文件对 / 隐性架构耦合）───
            commands::analyze_change_coupling,
            commands::list_change_coupling,
            commands::analyze_data_flow,
            commands::list_data_flow,
            // ─── AI Agent 系统 ───
            commands::list_providers,
            commands::save_provider,
            commands::delete_provider,
            commands::list_endpoints,
            commands::list_endpoints_by_provider,
            commands::save_endpoint,
            commands::delete_endpoint,
            commands::list_models,
            commands::list_models_by_endpoint,
            commands::save_model,
            commands::delete_model,
            commands::test_endpoint_connection,
            commands::test_model_chat,
            commands::list_agents,
            commands::save_agent,
            commands::delete_agent,
            commands::list_conversations,
            commands::create_conversation,
            commands::delete_conversation,
            commands::list_messages,
            commands::save_message,
            commands::delete_messages,
            commands::run_agent,
            commands::cancel_agent_run,
            commands::resolve_tool_approval,
            // ─── AI 上下文包持久化 ───
            commands::save_ai_context_pack,
            // 分节级增量：只重写变化的分节 + 轻量取戳（无正文）用于水合
            commands::save_ai_context_sections,
            commands::list_ai_context_section_stamps,
            commands::list_ai_context_packs,
            commands::get_ai_context_pack,
            commands::get_ai_context_section,
            commands::delete_ai_context_pack,
            commands::save_ai_insight,
            commands::list_ai_insights,
            commands::resolve_ai_insight,
            commands::verify_diagnosis_insights,
            // ─── 自动分析编排（上下文更新后自动交给用户选定的 Agent）───
            commands::list_ai_auto_analysis_rules,
            commands::save_ai_auto_analysis_rule,
            commands::delete_ai_auto_analysis_rule,
            commands::mark_ai_auto_analysis_run,
            commands::record_ai_auto_analysis_run,
            commands::list_ai_auto_analysis_runs,
            commands::list_ai_analysis_coverage,
            commands::finish_ai_auto_analysis_run,
            commands::list_ai_auto_analysis_latest_per_rule,
            commands::reap_stale_analysis_runs,
            // ─── 焦点目标巡查派单（轮转在「补维度」之外也「补文件」）───
            commands::record_ai_focus_assignments,
            commands::list_ai_focus_assignments,
            commands::settle_ai_focus_assignments,
            // ─── 指标快照基线（模块无关：后端只存取，指标由模块自己算）───
            commands::record_ai_metric_snapshot,
            commands::list_ai_metric_snapshots,
            // ─── 实体回归基线（总量之外再答「哪个文件在变坏」）───
            commands::record_ai_entity_snapshot,
            commands::list_ai_entity_snapshots,
            spawn_code_workbench,
            // ─── 代码工作台集成终端（IDE 标准可交互 shell）───
            commands::spawn_terminal,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_kill,
            commands::terminal_replay,
            // ─── 操作系统级辅助命令（Reveal in File Manager 等）───
            commands::reveal_in_file_manager,
            // ─── ACP Host WebSocket 桥（P0.1）：外部 ACP Agent 经 ws 驱动本工作台 ───
            commands::start_acp_ws_server,
            commands::send_acp_ws,
            commands::stop_acp_ws_server,
            // ─── 写作域（Sight Folio）：书籍与章节 CRUD ───
            commands::list_writing_books,
            commands::save_writing_book,
            commands::delete_writing_book,
            commands::list_writing_chapters,
            commands::save_writing_chapter,
            commands::rename_writing_chapter,
            commands::save_writing_chapter_content,
            commands::save_writing_chapter_snapshot,
            commands::list_writing_chapter_snapshots,
            commands::delete_writing_chapter,
            commands::list_corpus_books,
            commands::import_corpus_file,
            commands::delete_corpus_book,
            commands::update_corpus_book,
            commands::set_corpus_book_tags,
            commands::search_corpus_books_by_tag,
            commands::rename_corpus_tag,
            commands::merge_corpus_tags,
            commands::delete_corpus_tag,
            commands::list_corpus_tag_counts,
            commands::search_corpus,
            commands::corpus_status,
            commands::corpus_maintenance_status,
            commands::rebuild_corpus_index,
            commands::check_corpus_duplicate,
            commands::scan_corpus_duplicates,
            commands::optimize_corpus_storage,
            // ─── 写作域 P1：创作设定库（人设卡/世界观）+ 导出写盘 ───
            commands::list_writing_settings,
            commands::save_writing_setting,
            commands::delete_writing_setting,
            commands::save_text_file,
            // ─── 写作域 P4：写作统计 ───
            commands::list_writing_daily_stats,
            // ─── 写作域 P5：大纲 + EPUB 导出 ───
            commands::list_writing_outlines,
            commands::save_writing_outline,
            commands::delete_writing_outline,
            commands::list_writing_timeline_events,
            commands::save_writing_timeline_event,
            commands::delete_writing_timeline_event,
            commands::list_writing_storylines,
            commands::save_writing_storyline,
            commands::delete_writing_storyline,
            commands::list_writing_foreshadowings,
            commands::save_writing_foreshadowing,
            commands::delete_writing_foreshadowing,
            commands::list_writing_annotations,
            commands::save_writing_annotation,
            commands::delete_writing_annotation,
            commands::list_writing_notes,
            commands::save_writing_note,
            commands::delete_writing_note,
            commands::save_writing_epub,
            commands::save_writing_docx,
            commands::save_writing_pdf,
            commands::backup_writing_book,
            commands::restore_writing_book,
            commands::scan_writing_book,
            commands::import_writing_book,
            // ─── 写作域 Phase 2：完结作品记录（导出/备份 → completed_works） ───
            commands::list_completed_works,
            commands::save_completed_work,
            commands::delete_completed_work,
            commands::move_completed_work,
            commands::import_completed_works,
            commands::query_completed_work_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
