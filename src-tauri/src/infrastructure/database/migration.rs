use rusqlite::Connection;

pub fn init_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS icon_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            parent_id TEXT,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS system_icons (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            file_path TEXT NOT NULL,
            file_type TEXT NOT NULL,
            group_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS data_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'filesystem',
            description TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            config TEXT NOT NULL DEFAULT '{}',
            strategy TEXT NOT NULL DEFAULT '{}',
            linked_entities TEXT NOT NULL DEFAULT '[]',
            sync_status TEXT NOT NULL DEFAULT 'idle',
            last_sync_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS analysis_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT,
            color TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            parent_id TEXT,
            description TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS analyses (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            project_root TEXT NOT NULL DEFAULT '',
            category_id TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            thumbnail TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            metadata TEXT NOT NULL DEFAULT '{}',
            editor_components TEXT,
            editor_layers TEXT,
            canvas_config TEXT,
            global_components TEXT,
            views TEXT,
            active_view_id TEXT,
            viewport_sync_rules TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS component_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT,
            color TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            parent_id TEXT,
            description TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS component_plugins (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            version TEXT NOT NULL DEFAULT '1.0.0',
            description TEXT,
            icon TEXT,
            category TEXT NOT NULL DEFAULT 'custom',
            default_size TEXT NOT NULL DEFAULT '{}',
            default_config TEXT NOT NULL DEFAULT '{}',
            capabilities TEXT NOT NULL DEFAULT '{}',
            config_schema TEXT NOT NULL DEFAULT '[]',
            events TEXT NOT NULL DEFAULT '[]',
            actions TEXT NOT NULL DEFAULT '[]',
            data_schema TEXT,
            renderer_entry TEXT,
            renderer_format TEXT NOT NULL DEFAULT 'module',
            dependencies TEXT NOT NULL DEFAULT '[]',
            permissions TEXT NOT NULL DEFAULT '[]',
            author TEXT,
            homepage TEXT,
            thumbnail TEXT,
            built_in INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            installed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS deleted_category_ids (
            id TEXT NOT NULL,
            source_table TEXT NOT NULL,
            deleted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (id, source_table)
        )",
        [],
    )?;

    // ─── 核心业务表：扫描结果 + 架构分层 + 审查规则 ───

    // 1. project_files — 扫描得到的文件清单
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_files (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            path TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            name TEXT NOT NULL,
            extension TEXT,
            language TEXT,
            size INTEGER NOT NULL DEFAULT 0,
            line_count INTEGER NOT NULL DEFAULT 0,
            content_hash TEXT,
            parent_id TEXT,
            is_directory INTEGER NOT NULL DEFAULT 0,
            layer_id TEXT,
            x REAL NOT NULL DEFAULT 0,
            y REAL NOT NULL DEFAULT 0,
            width REAL NOT NULL DEFAULT 160,
            height REAL NOT NULL DEFAULT 48,
            metadata TEXT NOT NULL DEFAULT '{}',
            scanned_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_files_analysis ON project_files(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_files_parent ON project_files(parent_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_files_language ON project_files(language)",
        [],
    )?;

    // 2. project_modules — 语义模块（聚合文件）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_modules (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            layer_id TEXT,
            file_count INTEGER NOT NULL DEFAULT 0,
            dep_count INTEGER NOT NULL DEFAULT 0,
            be_dep_count INTEGER NOT NULL DEFAULT 0,
            x REAL NOT NULL DEFAULT 0,
            y REAL NOT NULL DEFAULT 0,
            width REAL NOT NULL DEFAULT 200,
            height REAL NOT NULL DEFAULT 80,
            color TEXT NOT NULL DEFAULT '#4F46E5',
            sort_order_via_layer INTEGER,
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_modules_analysis ON project_modules(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_modules_layer ON project_modules(layer_id)",
        [],
    )?;

    // 3. project_dependencies — 依赖关系
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_dependencies (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            from_id TEXT NOT NULL,
            from_type TEXT NOT NULL DEFAULT 'file',
            to_id TEXT NOT NULL,
            to_type TEXT NOT NULL DEFAULT 'file',
            kind TEXT NOT NULL DEFAULT 'import',
            line_no INTEGER,
            is_circular INTEGER NOT NULL DEFAULT 0,
            weight INTEGER NOT NULL DEFAULT 1,
            metadata TEXT NOT NULL DEFAULT '{}',
            detected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_deps_analysis ON project_dependencies(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_deps_from ON project_dependencies(from_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_deps_to ON project_dependencies(to_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_deps_circular ON project_dependencies(is_circular)",
        [],
    )?;

    // 4. project_layers — 架构分层定义
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_layers (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#94A3B8',
            sort_order INTEGER NOT NULL DEFAULT 0,
            y_position REAL NOT NULL DEFAULT 0,
            description TEXT,
            rule_pattern TEXT,
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_layers_analysis ON project_layers(analysis_id)",
        [],
    )?;

    // 5. review_rules — 审查规则定义
    conn.execute(
        "CREATE TABLE IF NOT EXISTS review_rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            rule_type TEXT NOT NULL DEFAULT 'pattern',
            target_type TEXT NOT NULL DEFAULT 'file',
            rule_body TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'warning',
            enabled INTEGER NOT NULL DEFAULT 1,
            scope TEXT NOT NULL DEFAULT 'all',
            builtin INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_rules_target ON review_rules(target_type)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_rules_enabled ON review_rules(enabled)",
        [],
    )?;

    // 6. review_findings — 审查结果
    conn.execute(
        "CREATE TABLE IF NOT EXISTS review_findings (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            rule_id TEXT,
            target_id TEXT NOT NULL,
            target_type TEXT NOT NULL DEFAULT 'file',
            severity TEXT NOT NULL DEFAULT 'warning',
            message TEXT NOT NULL,
            suggestion TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            found_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            fixed_at INTEGER,
            metadata TEXT NOT NULL DEFAULT '{}'
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_findings_analysis ON review_findings(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_findings_rule ON review_findings(rule_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_findings_target ON review_findings(target_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_findings_status ON review_findings(status)",
        [],
    )?;

    // 7. project_symbols — 代码结构索引（类/函数/接口等符号 + 设计模式）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_symbols (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'symbol',
            line_start INTEGER NOT NULL DEFAULT 0,
            line_end INTEGER NOT NULL DEFAULT 0,
            signature TEXT NOT NULL DEFAULT '',
            doc TEXT,
            modifiers TEXT NOT NULL DEFAULT '',
            patterns TEXT NOT NULL DEFAULT '[]',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_symbols_analysis ON project_symbols(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_symbols_file ON project_symbols(file_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_symbols_kind ON project_symbols(kind)",
        [],
    )?;

    // 8. scan_jobs — 异步扫描任务状态
    conn.execute(
        "CREATE TABLE IF NOT EXISTS scan_jobs (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            progress INTEGER NOT NULL DEFAULT 0,
            files_scanned INTEGER NOT NULL DEFAULT 0,
            total_files INTEGER NOT NULL DEFAULT 0,
            started_at INTEGER,
            finished_at INTEGER,
            error TEXT,
            config TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_jobs_analysis ON scan_jobs(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status)",
        [],
    )?;

    // 9. project_symbol_refs — 符号级引用索引（谁引用了哪个符号、在哪一行）
    //    对应需求「代码之间的引用」：import/use/from 语句解析出的具体符号引用点，
    //    from_file 引用方文件 → to_symbol 被引用符号（to_symbol_id 命中符号表；未命中为文件级引用）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_symbol_refs (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            from_file_id TEXT NOT NULL,
            from_file_path TEXT NOT NULL,
            to_symbol_id TEXT,
            to_file_id TEXT NOT NULL,
            to_file_path TEXT NOT NULL,
            symbol_name TEXT NOT NULL,
            ref_line INTEGER NOT NULL DEFAULT 0,
            ref_text TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'import',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_symbol_refs_analysis ON project_symbol_refs(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_symbol_refs_to_symbol ON project_symbol_refs(to_symbol_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_symbol_refs_name ON project_symbol_refs(symbol_name)",
        [],
    )?;

    // 10. project_file_metrics — 文件级度量（行数/注释/圈复杂度，供复杂度热力图）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_file_metrics (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            total_lines INTEGER NOT NULL DEFAULT 0,
            code_lines INTEGER NOT NULL DEFAULT 0,
            comment_lines INTEGER NOT NULL DEFAULT 0,
            blank_lines INTEGER NOT NULL DEFAULT 0,
            cyclomatic_complexity INTEGER NOT NULL DEFAULT 1,
            complexity_level TEXT NOT NULL DEFAULT 'low',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            engine TEXT NOT NULL DEFAULT 'heuristic',
            max_nesting INTEGER NOT NULL DEFAULT 0,
            function_count INTEGER NOT NULL DEFAULT 0,
            max_function_cc INTEGER NOT NULL DEFAULT 0,
            hot_function TEXT NOT NULL DEFAULT '',
            magic_number_count INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;
    // 旧库升级：AST 级度量新增列（只 ALTER 不 DROP，符合铁律）。
    // 新库建表已含这些列，ALTER 报 duplicate column 是预期的，`let _ =` 吞掉。
    for stmt in [
        "ALTER TABLE project_file_metrics ADD COLUMN engine TEXT NOT NULL DEFAULT 'heuristic'",
        "ALTER TABLE project_file_metrics ADD COLUMN max_nesting INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE project_file_metrics ADD COLUMN function_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE project_file_metrics ADD COLUMN max_function_cc INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE project_file_metrics ADD COLUMN hot_function TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE project_file_metrics ADD COLUMN magic_number_count INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = conn.execute(stmt, []);
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_file_metrics_analysis ON project_file_metrics(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_file_metrics_file ON project_file_metrics(file_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_file_metrics_cc ON project_file_metrics(cyclomatic_complexity)",
        [],
    )?;

    // 11. project_tech_debt — 技术债标记（TODO/FIXME/HACK/XXX/OPTIMIZE/DEPRECATED）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_tech_debt (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            line_no INTEGER NOT NULL DEFAULT 0,
            marker TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            snippet TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tech_debt_analysis ON project_tech_debt(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tech_debt_severity ON project_tech_debt(severity)",
        [],
    )?;

    // 12. project_code_index — 代码全文索引（search_code_content 检索）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_code_index (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            line_no INTEGER NOT NULL DEFAULT 0,
            content TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_code_index_analysis ON project_code_index(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_code_index_file ON project_code_index(file_id)",
        [],
    )?;

    // 13. project_git_churn — git 变更热点（演进分析：哪些文件在快速变坏）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_git_churn (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_id TEXT NOT NULL DEFAULT '',
            file_path TEXT NOT NULL,
            commit_count INTEGER NOT NULL DEFAULT 0,
            added_lines INTEGER NOT NULL DEFAULT 0,
            deleted_lines INTEGER NOT NULL DEFAULT 0,
            author_count INTEGER NOT NULL DEFAULT 0,
            last_commit_at INTEGER NOT NULL DEFAULT 0,
            first_commit_at INTEGER NOT NULL DEFAULT 0,
            churn_score INTEGER NOT NULL DEFAULT 0,
            hotspot_level TEXT NOT NULL DEFAULT 'low',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_git_churn_analysis ON project_git_churn(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_git_churn_score ON project_git_churn(churn_score)",
        [],
    )?;

    // 14. project_call_edges — 函数调用图（过程间分析 / 变更影响分析）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_call_edges (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            caller_symbol_id TEXT NOT NULL,
            caller_name TEXT NOT NULL,
            caller_file_id TEXT NOT NULL DEFAULT '',
            caller_file_path TEXT NOT NULL DEFAULT '',
            callee_symbol_id TEXT NOT NULL DEFAULT '',
            callee_name TEXT NOT NULL,
            callee_file_id TEXT NOT NULL DEFAULT '',
            callee_file_path TEXT NOT NULL DEFAULT '',
            line_no INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL DEFAULT 'internal',
            callee_receiver TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_call_edges_analysis ON project_call_edges(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_call_edges_caller ON project_call_edges(caller_symbol_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_call_edges_callee ON project_call_edges(callee_symbol_id)",
        [],
    )?;
    // 旧库升级：新增 callee_receiver 列（只 ALTER 不 DROP，符合铁律）。
    // 新库建表已含该列，ALTER 报 duplicate column 是预期的，`let _ =` 吞掉。
    let _ = conn.execute(
        "ALTER TABLE project_call_edges ADD COLUMN callee_receiver TEXT NOT NULL DEFAULT ''",
        [],
    );
    // 旧库升级：新增 receiver_target 列（被调方解析到的接收者声明类型名）。
    // 同上，只 ALTER 不 DROP，符合铁律；duplicate column 预期内吞掉。
    let _ = conn.execute(
        "ALTER TABLE project_call_edges ADD COLUMN receiver_target TEXT NOT NULL DEFAULT ''",
        [],
    );

    // 15. project_code_clones — 代码克隆（重复代码）检测结果
    //     同一 group_id 的多行记录代表「同一段代码的多个出现位置」。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_code_clones (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            group_id TEXT NOT NULL,
            file_id TEXT NOT NULL DEFAULT '',
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL DEFAULT 0,
            end_line INTEGER NOT NULL DEFAULT 0,
            line_count INTEGER NOT NULL DEFAULT 0,
            group_size INTEGER NOT NULL DEFAULT 0,
            snippet TEXT NOT NULL DEFAULT '',
            language TEXT NOT NULL DEFAULT '',
            clone_type TEXT NOT NULL DEFAULT 'type1',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    // 旧库升级：Type-2 参数化克隆需要 clone_type 列（只 ALTER 不 DROP，符合铁律）。
    // 新库建表已含该列，ALTER 会报 duplicate column —— 用 `let _ =` 吞掉是预期行为。
    let _ = conn.execute(
        "ALTER TABLE project_code_clones ADD COLUMN clone_type TEXT NOT NULL DEFAULT 'type1'",
        [],
    );
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_code_clones_analysis ON project_code_clones(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_code_clones_group ON project_code_clones(group_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_code_clones_file ON project_code_clones(file_id)",
        [],
    )?;

    // 16. project_code_fts — 代码全文检索（FTS5 虚拟表）
    //
    //     此前 search_code_content 走 `content LIKE '%kw%'` 全表扫描：
    //     无法分词、无相关度排序、大项目下线性劣化。升级为 FTS5 倒排索引后
    //     支持 bm25 相关度排序与 snippet 高亮。
    //
    //     采用「独立内容表」而非 external-content：project_code_index 仍是
    //     唯一事实源（既有代码不变），FTS 表在索引阶段同步写入，
    //     检索失败时命令层自动回退 LIKE，保证 FTS5 不可用环境仍能工作。
    //
    //     注意：unicode61 分词器对中文按字切分，配合 `remove_diacritics` 关闭，
    //     并把常见代码分隔符纳入 tokenchars，避免 `foo_bar` 被拆碎。
    let fts_ok = conn
        .execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS project_code_fts USING fts5(
                entry_id UNINDEXED,
                analysis_id UNINDEXED,
                file_id UNINDEXED,
                file_path,
                line_no UNINDEXED,
                content,
                created_at UNINDEXED,
                tokenize = \"unicode61 remove_diacritics 0 tokenchars '_$'\"
            );",
        )
        .is_ok();
    if !fts_ok {
        eprintln!("[migration] FTS5 不可用，代码检索将回退到 LIKE 模式");
    }

    // 17. project_change_coupling — 变更耦合（隐性架构耦合：总是一起改的文件对）
    //
    //     依赖分析回答「谁 import 谁」（显性耦合），本表回答「谁总和谁一起改」
    //     （时间维度的耦合）。无静态依赖却高共变的文件对 = 隐性耦合，
    //     是任何静态分析工具都发现不了、却最容易埋雷的架构问题。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_change_coupling (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_a_id TEXT NOT NULL DEFAULT '',
            file_a_path TEXT NOT NULL,
            file_b_id TEXT NOT NULL DEFAULT '',
            file_b_path TEXT NOT NULL,
            co_changes INTEGER NOT NULL DEFAULT 0,
            commits_a INTEGER NOT NULL DEFAULT 0,
            commits_b INTEGER NOT NULL DEFAULT 0,
            degree REAL NOT NULL DEFAULT 0,
            jaccard REAL NOT NULL DEFAULT 0,
            is_structural INTEGER NOT NULL DEFAULT 0,
            cross_module INTEGER NOT NULL DEFAULT 0,
            coupling_kind TEXT NOT NULL DEFAULT 'structural',
            risk_level TEXT NOT NULL DEFAULT 'low',
            last_co_change_at INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_change_coupling_analysis ON project_change_coupling(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_change_coupling_degree ON project_change_coupling(degree)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_change_coupling_kind ON project_change_coupling(coupling_kind)",
        [],
    )?;

    // 18. project_data_flow — 函数级 def-use 数据流摘要（过程间传播的「函数摘要」层）
    //
    //     调用边说「A 调了 B」，本表说「B 会不会把收到的数据再传出去」。
    //     只有透传函数（param→return 或 return call()）才让污染继续向上游扩散，
    //     非透传函数（只打日志/只落库）是污染终点 —— 影响链据此剪枝，
    //     把「调用可达」收窄成「数据可达」，这是过程间分析的精度分水岭。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_data_flow (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_id TEXT NOT NULL DEFAULT '',
            file_path TEXT NOT NULL DEFAULT '',
            function_name TEXT NOT NULL DEFAULT '',
            line_no INTEGER NOT NULL DEFAULT 0,
            params TEXT NOT NULL DEFAULT '',
            param_to_return TEXT NOT NULL DEFAULT '',
            propagates INTEGER NOT NULL DEFAULT 1,
            returns_call_result INTEGER NOT NULL DEFAULT 0,
            call_flows TEXT NOT NULL DEFAULT '[]',
            sinks TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_data_flow_analysis ON project_data_flow(analysis_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_data_flow_file ON project_data_flow(file_id)",
        [],
    )?;

    // ─── AI Agent 系统：6 张表 ───

    // 19. ai_providers — LLM 提供商（OpenAI/Anthropic/自定义）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    // ai_providers：旧字段 logo → color（守卫式重命名，绝不 DROP）
    let provider_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(ai_providers)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if provider_columns.is_empty() || !provider_columns.contains(&"color".to_string()) {
        if !provider_columns.is_empty() && provider_columns.contains(&"logo".to_string()) {
            conn.execute("ALTER TABLE ai_providers RENAME COLUMN logo TO color", [])?;
        } else {
            conn.execute(
                "ALTER TABLE ai_providers ADD COLUMN color TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }
    }

    // 20. ai_endpoints — API 端点配置
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_endpoints (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            name TEXT NOT NULL,
            api_type TEXT NOT NULL DEFAULT 'openai-completions',
            base_url TEXT NOT NULL,
            auth_type TEXT NOT NULL DEFAULT 'bearer',
            custom_auth_header TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_endpoints_provider ON ai_endpoints(provider_id)",
        [],
    )?;

    // 21. ai_models — 模型配置
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            ref_key TEXT NOT NULL,
            endpoint_id TEXT NOT NULL,
            reasoning INTEGER NOT NULL DEFAULT 0,
            input_types TEXT NOT NULL DEFAULT '[]',
            context_window INTEGER NOT NULL DEFAULT 4096,
            max_tokens INTEGER NOT NULL DEFAULT 4096,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (endpoint_id) REFERENCES ai_endpoints(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_models_endpoint ON ai_models(endpoint_id)",
        [],
    )?;

    // 22. ai_agents — AI 助手配置
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            model_id TEXT NOT NULL,
            system_prompt TEXT NOT NULL DEFAULT '',
            temperature REAL NOT NULL DEFAULT 0.7,
            max_iterations INTEGER NOT NULL DEFAULT 10,
            tool_ids TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_agents_model ON ai_agents(model_id)",
        [],
    )?;

    // 23. ai_conversations — 对话会话
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_conversations (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '新对话',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_conversations_agent ON ai_conversations(agent_id)",
        [],
    )?;

    // 24. ai_messages — 对话消息
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            tool_calls TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id)",
        [],
    )?;

    // ─── AI 上下文持久化：扫描/画布/报告等模块把分析产物压缩为 AI 友好的分节包，落库供 Agent 按需取用（省 token）───

    // 25. ai_context_packs — 上下文包元信息（按 scope+module 唯一，重存即覆盖）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_context_packs (
            id TEXT PRIMARY KEY,
            scope_id TEXT NOT NULL,
            module_id TEXT NOT NULL,
            scope_label TEXT NOT NULL DEFAULT '',
            schema_version INTEGER NOT NULL DEFAULT 1,
            generated_at INTEGER NOT NULL DEFAULT 0,
            token_estimate INTEGER NOT NULL DEFAULT 0,
            digest TEXT NOT NULL DEFAULT '',
            truncated_sections TEXT NOT NULL DEFAULT '[]',
            section_keys TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_context_packs_scope ON ai_context_packs(scope_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_context_packs_module ON ai_context_packs(module_id)",
        [],
    )?;

    // 26. ai_context_sections — 包内单个分节（content + facts，供 Agent 按需取单节省 token）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_context_sections (
            id TEXT PRIMARY KEY,
            pack_id TEXT NOT NULL,
            section_key TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            token_estimate INTEGER NOT NULL DEFAULT 0,
            priority INTEGER NOT NULL DEFAULT 0,
            facts_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (pack_id) REFERENCES ai_context_packs(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_context_sections_pack ON ai_context_sections(pack_id)",
        [],
    )?;

    // 26b. 分节级增量字段（追加列，绝不 DROP 旧列；已存在则静默跳过）。
    // digest    = 分节内容指纹；
    // updated_at = 内容「最后一次真正变化」的时刻（不是最后一次重建的时刻）。
    // 有了这两列，重扫后只重写变化的分节，Agent 也能用 since 只取变化节做增量分析。
    // 历史行两列为 ''/0：读侧一律当作「已变化」，宁可多写多读一次，也不把陈旧内容当最新。
    for col in [
        "ALTER TABLE ai_context_sections ADD COLUMN digest TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ai_context_sections ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        // data_quality_json = 该分节的数据可信度（status / reason / 覆盖率 / 明确禁止下的结论）。
        // 没有它，Agent 无法区分「分析跑完确实没问题」与「这一维度压根没数据」，
        // 会把盲区当成健康——这是 AI 代码分析里最贵、也最难被发现的一类错误。
        // 历史行为 '{}'：读侧按「未声明 = 可信」处理，与旧行为保持一致。
        "ALTER TABLE ai_context_sections ADD COLUMN data_quality_json TEXT NOT NULL DEFAULT '{}'",
    ] {
        let _ = conn.execute(col, []);
    }

    // 27. ai_insights — Agent 基于上下文包产出的洞察（沉淀到分析，与某次 pack 关联；供 UI 展示）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_insights (
            id TEXT PRIMARY KEY,
            pack_id TEXT,
            analysis_id TEXT NOT NULL DEFAULT '',
            agent_id TEXT,
            kind TEXT NOT NULL DEFAULT 'note',
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            severity TEXT NOT NULL DEFAULT 'info',
            refs TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_insights_analysis ON ai_insights(analysis_id)",
        [],
    )?;

    // 27b. 洞察去重字段（润色，绝不 DROP 旧列，已存在的列静默跳过）。
    // 同一次分析下「同标题 + 同类别 + 同严重度」视为同一结论，重复 save 只累加 seen_count
    // 而非新建行——否则每次分析都给同一建议（既烧 token 又让沉淀噪声爆炸）。
    for col in [
        "ALTER TABLE ai_insights ADD COLUMN fingerprint TEXT",
        "ALTER TABLE ai_insights ADD COLUMN seen_count INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE ai_insights ADD COLUMN first_seen INTEGER",
        "ALTER TABLE ai_insights ADD COLUMN last_seen INTEGER",
        // 证据快照：结论产出当时，被 refs 点名的文件各自是什么内容（rel_path + content_hash）。
        // 有了它，下一轮扫描才能回答「这条结论所依据的代码还是不是当初那份」——
        // 否则沉淀只会单调增长：改完的问题继续挂着，Agent 每轮都要重读一遍已经不成立的结论。
        "ALTER TABLE ai_insights ADD COLUMN evidence_json TEXT",
        // 结论生命周期的终点。时效判定能看出「证据变了」，但复核确认「已经修好了」
        // 之后若没有收口动作，结论就永远堆在面板与复核队列里——判得越准，噪音反而越大。
        "ALTER TABLE ai_insights ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
        "ALTER TABLE ai_insights ADD COLUMN resolved_at INTEGER",
        // 关闭必须留下理由与关闭者：无理由的关闭等同于把问题扫到地毯下面
        "ALTER TABLE ai_insights ADD COLUMN resolved_reason TEXT",
        "ALTER TABLE ai_insights ADD COLUMN resolved_by TEXT",
    ] {
        let _ = conn.execute(col, []);
    }

    // 27c. 诊断关联字段（G4 回扫验证闭环）：把「诊断会话」与「它产出的洞察」绑起来。
    // diagnosis_id 来自 triggerDiagnosis 建的会话 id（Agent save 时透传）；source_kind
    // 标记这条洞察最初针对哪类分析点（syntax/review/complexity…），verify 据此选判定逻辑。
    for col in [
        "ALTER TABLE ai_insights ADD COLUMN diagnosis_id TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ai_insights ADD COLUMN source_kind TEXT NOT NULL DEFAULT ''",
    ] {
        let _ = conn.execute(col, []);
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_insights_fingerprint ON ai_insights(fingerprint)",
        [],
    )
    .ok();

    // ─── 自动分析编排：让「分析发生」不再依赖人点按钮 ───
    //
    // 设计要点（模块无关，未来任意模块复用）：
    //   · module_id 决定这条规则监听哪个模块的上下文产出（当前唯一供给者是 project-scan）；
    //   · scope_id 为 NULL 表示「该模块下所有作用域通用」，填值则只对某个分析生效；
    //   · agent_id 是用户在 UI 选定的**已配置 Agent**，绝不由代码写死；
    //   · trigger / cooldown / skip_if_unchanged 三者共同防止 watch 增量重扫把 Agent 打爆。

    // 28. ai_auto_analysis_rules — 「上下文更新后自动让谁、用什么预设去分析」
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_auto_analysis_rules (
            id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1,
            module_id TEXT NOT NULL DEFAULT 'project-scan',
            scope_id TEXT,
            agent_id TEXT NOT NULL,
            preset_key TEXT NOT NULL DEFAULT '',
            trigger_on TEXT NOT NULL DEFAULT 'full-scan',
            cooldown_minutes INTEGER NOT NULL DEFAULT 30,
            skip_if_unchanged INTEGER NOT NULL DEFAULT 1,
            last_run_at INTEGER NOT NULL DEFAULT 0,
            last_digest TEXT NOT NULL DEFAULT '',
            last_conversation_id TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_auto_rules_module ON ai_auto_analysis_rules(module_id)",
        [],
    )?;

    // 29. ai_auto_analysis_runs — 每次自动触发/跳过的审计轨迹。
    // 记录 skipped 而不仅是 triggered：用户能看清「为什么这次没跑」（冷却中 / 内容没变 / Agent 缺工具），
    // 否则自动化会变成难以排查的黑箱。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_auto_analysis_runs (
            id TEXT PRIMARY KEY,
            rule_id TEXT NOT NULL,
            module_id TEXT NOT NULL DEFAULT '',
            scope_id TEXT NOT NULL DEFAULT '',
            agent_id TEXT NOT NULL DEFAULT '',
            preset_key TEXT NOT NULL DEFAULT '',
            pack_id TEXT,
            conversation_id TEXT,
            trigger_kind TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'triggered',
            detail TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_auto_runs_rule ON ai_auto_analysis_runs(rule_id)",
        [],
    )?;
    // 幂等追加：这一轮分析基于的上下文内容指纹。
    // 没有它就无法回答「某个维度上次分析之后，数据是不是又变了」——
    // 而这正是「哪些方面的结论已经过期、该补一轮」的唯一硬判据（时间只能说明久，不能说明变）。
    let _ = conn.execute(
        "ALTER TABLE ai_auto_analysis_runs ADD COLUMN context_digest TEXT NOT NULL DEFAULT ''",
        [],
    );
    // 幂等追加（自动化连续性）：
    //
    // · reason —— 机器可读的判定原因（cooling / busy / unchanged / ok / rotate-gap …）。
    //   detail 是给人看的中文句子，靠它做「这次是不是因为可恢复原因被跳过」的判断
    //   等于用自然语言当协议，改一个字补跑就失灵。补跑判定必须有机器可读依据。
    //
    // · outcome —— 发起之后到底怎么样了：pending（消息已发出，还在跑）/ completed（有结论产出）
    //   / no-output（跑完了但一条结论都没沉淀）/ error（对话失败）。
    //   在此之前 status='triggered' 只代表「消息发出去了」，而覆盖台账把 triggered
    //   当作「这个维度已经被分析过」。于是模型报错、网络中断、Agent 答非所问的轮次
    //   一律显示绿灯 —— 与「绿灯必须意味着真的分析过」这条铁律同源的第二种失真。
    //
    // · insight_count / finished_at —— 回执的量化结果与落点时间。
    for sql in [
        "ALTER TABLE ai_auto_analysis_runs ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ai_auto_analysis_runs ADD COLUMN outcome TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ai_auto_analysis_runs ADD COLUMN insight_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE ai_auto_analysis_runs ADD COLUMN finished_at INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = conn.execute(sql, []);
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_auto_runs_created ON ai_auto_analysis_runs(created_at)",
        [],
    )?;

    // 30. ai_focus_assignments — 「哪个文件在哪一轮被点名交给 Agent 巡查过」。
    //
    // 为什么必须落库而不是靠洞察反推
    // ------------------------------
    // 轮转此前只补「维度」（换个问题问），从不管「文件」。于是共振榜上那些
    // 「每一维都排第 20 名」的多维共振文件，可以一轮又一轮地无人问津 ——
    // 每次分析都是同一批显眼的大文件被反复解读，最该看的那个始终空白。
    //
    // 想让编排「补文件」，就必须回答「这个文件到底派过单没有」。
    // 唯一看起来现成的答案是 ai_insights：有结论 = 看过。但它是错的 ——
    // Agent 认真读完判定「没问题」时不会写洞察，于是这个文件永远显示未覆盖，
    // 每一轮都被重新点名，变成一个永不收敛、持续烧 token 的循环。
    //
    // 所以销账口径是**派单即销账**：点名过就记一笔，之后除非数据变了（context_digest 变）
    // 才重新排队。这既能保证「每个高共振目标迟早都被看一遍」，又天然收敛。
    //
    // 只存每个文件的最近一次派单（主键去重、次数累加）：历史轨迹已经在
    // ai_auto_analysis_runs 里，这张表要回答的只是「还欠谁一次巡查」。
    // assign_count 保留是为了让人看见「点名 3 次仍无结论」这种异常。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_focus_assignments (
            module_id TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            run_id TEXT NOT NULL DEFAULT '',
            preset_key TEXT NOT NULL DEFAULT '',
            context_digest TEXT NOT NULL DEFAULT '',
            resonance INTEGER NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            assign_count INTEGER NOT NULL DEFAULT 1,
            assigned_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (module_id, scope_id, file_path)
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_focus_assign_scope \
         ON ai_focus_assignments(module_id, scope_id)",
        [],
    )?;
    // 30b. 派单核销回执（追加列，已存在则静默跳过）。
    //
    // 「派单即销账」解决了「判定没问题不写洞察 → 永远重复点名」的不收敛循环，
    // 但它顺手制造了反向的洞：**发起了、对话却失败**的那一轮同样销了账。
    // 规则会被补跑调度重新排队，可焦点台账读库时这些文件已是「已巡查」，
    // 于是不会再被点名 —— 一次网络抖动就能让共振榜第一名**永久**沉默，
    // 而且账面上一切正常（有派单记录、有轨迹、outcome=error 挂在另一张表上）。
    //
    // outcome 就是这批派单的核销状态：''=已发出待回执，其余同轨迹表口径。
    // 只有 error 会让派单作废重新排队；no-output 不作废（用户的 Agent 若没被授权
    // 洞察工具，本来就不会有结论沉淀，按未落实处理会变成另一个不收敛的循环）。
    // 历史行为 ''：读侧当作「已落实」，与本列上线前的行为保持一致。
    //
    // 30c. evidence_digest —— 派单时该文件「证据现状」的指纹，用于**复核派单**的收敛。
    //
    // 复核档（这个文件已有 AI 结论，之后代码又改了）是本表要回答的第二个问题。
    // 它同样不能靠「洞察有没有更新」来销账：Agent 认真复核后若判定「结论仍然成立、
    // 无需改动」，它不会写任何东西（洞察工具本就在劝阻重复保存稳定结论），
    // 于是这个文件会被每一轮重新点名 —— 上一段所说的不收敛循环，换个地方原样复发。
    //
    // 所以派单时把当下的证据现状指纹一并记下，只有证据**再次**变化才重新排队。
    // 判据落在客观代码上，不落在模型愿不愿意写字上。
    // 历史行/空串 = 从未记账，读侧按「还欠一次复核」处理（宁可多看一次，
    // 也不能让一条过期结论永远挂着误导后续每一轮）。
    //
    // 30d. regression_digest —— 派单时该文件「本轮变坏了什么」的指纹，用于**回归追责派单**的收敛。
    //
    // 第三个问题：这个文件相对上一次扫描明显变坏了（复杂度 42 → 68、重复行 +180）。
    // 它与前两档都不同 —— 静态榜单只看得见「现在多糟」，看不见「刚刚变糟」；
    // 而恰恰是后者最该立刻看：改动是谁引入的还查得到，作者也还记得当时在想什么。
    //
    // 为什么不能复用 context_digest 销账：整包指纹会因为任何一处无关改动（改个 README）
    // 而翻新，于是同一次回归会被反复点名；也不能复用 evidence_digest —— 那是复核档的账，
    // 两者会互相把对方的账冲掉（一个文件完全可能既欠复核又刚变坏）。
    //
    // 记的是**该文件这次回归本身**的指纹（哪几维、从多少到多少），所以：
    //   · 榜单因别的文件变化而重算 → 本文件的回归指纹不变 → 不重复点名；
    //   · 本文件继续变坏（68 → 95）→ 指纹变化 → 这是一次新的回归，重新排队。
    // 历史行/空串 = 从未记账，读侧按「欠一次追责」处理。
    for col in [
        "ALTER TABLE ai_focus_assignments ADD COLUMN outcome TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ai_focus_assignments ADD COLUMN evidence_digest TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ai_focus_assignments ADD COLUMN regression_digest TEXT NOT NULL DEFAULT ''",
    ] {
        let _ = conn.execute(col, []);
    }

    // 31. ai_metric_snapshots — 指标随时间的历史基线。
    //
    // 为什么这张表非建不可，而且越晚建亏得越多
    // ----------------------------------------
    // 所有扫描共用同一个 analysis_id，每次重扫都**覆盖**同一批行。于是整套系统
    // 只有「此刻长什么样」，没有任何「上周长什么样」。可「优化项目」这件事本身
    // 就是一个时间过程 —— 复杂度是涨了还是降了、技术债是在还还是在借、
    // 上一轮 AI 提的问题落地之后指标动了没有 —— 这些问题现在一个都答不上来。
    // 更要命的是：这类数据**无法事后补算**。今天没存，昨天的形态就永远消失了。
    //
    // 三条设计口径
    // ------------
    // 1. **只存聚合指标，不存明细**。明细在各维度表里，快照要回答的是「方向」，
    //    存明细会让这张表随扫描次数线性膨胀，而多出来的行一次都不会被读。
    // 2. **按指标指纹去重，但只跟最近一条比**。文件监视触发的增量重扫可以一天几十次，
    //    每次插一行会让时间轴被噪声淹没，几小时就把有意义的历史挤出保留窗口；
    //    指标没变就只累加 seen_count 并刷新 last_at —— 「持续保持」也是一种信息。
    //    但去重**不能**跟历史全体比对：A→B→A 这种回归（改坏了又改回来）会被合并到
    //    最早那条 A 上，时间轴于是谎报「B 之后什么都没发生」，而这恰恰是最该被看见的一次反复。
    // 3. **必须同时存本次的维度可用性**（coverage_json）。上一次跑了 Git、这一次没跑，
    //    churn 归零绝不是「变好了」。趋势场景里这就是 clean/blind 的等价物，
    //    也是最贵的一类失真：它会让 AI 一本正经地宣布「本周变更耦合大幅改善」。
    //
    // 模块无关：module_id 进主键口径，将来画布/报告模块存自己的指标，这张表零改动。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_metric_snapshots (
            id TEXT PRIMARY KEY,
            module_id TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            digest TEXT NOT NULL,
            trigger_kind TEXT NOT NULL DEFAULT '',
            metrics_json TEXT NOT NULL,
            coverage_json TEXT NOT NULL DEFAULT '[]',
            first_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            last_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            seen_count INTEGER NOT NULL DEFAULT 1
        )",
        [],
    )?;
    // 时间轴按 first_at 排（一段「持续保持」应当落在它**开始**的位置，
    // 而不是随每次重扫往前跳）；rowid 兜底同秒写入的稳定顺序。
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_metric_snap_scope \
         ON ai_metric_snapshots(module_id, scope_id, first_at DESC)",
        [],
    )?;

    // 32. ai_entity_snapshots — 实体（文件）榜单随时间的历史基线。
    //
    // 与 31 的分工：31 存**总量**（技术债 87 条），32 存**对象**（这 87 条长在谁身上）。
    // 只有总量时，AI 能写出的最好结论是「整体略有恶化，建议关注技术债」——
    // 一句放在任何项目上都成立、因而毫无价值的话。落到对象之后才有行动：
    // 「payment.ts 在复杂度与扇入两条线上同时恶化，且它上周刚被改过」。
    //
    // 三个字段值得单独解释，它们各自堵掉一种会说谎的实现
    // --------------------------------------------------
    // · total + cutoff：榜单只存 Top-N。某个文件这次不在榜上，可能是修好了，
    //   也可能只是被别人挤下去了。没有门槛分数，二者无法区分，
    //   而默认判成「修好了」会让每次新增一个烂文件都顺带宣布一批文件被治愈。
    // · survived_json：上一批榜单实体里此刻仍然存在的 id。文件被删掉不是质量改善，
    //   是代码没了。没有这个字段，「删掉遗留模块」会刷出一条漂亮的改善曲线。
    //   它必须在**采集时**算好落库——留到读取时再问模块，回答的是另一个时刻的问题，
    //   人读视图与 Agent 看到的结论会不一致。
    // · coverage_json：与 31 同一条理由。可用维度集合变了，综合分的权重归一口径就变了，
    //   每个文件的分数都会动，却与代码毫无关系。
    //
    // 保留量比 31 小一个量级：每行是一整张榜单（几十个实体 × 多维取值），
    // 而回归只对照上一个点，囤几百张历史榜单是纯粹的空间浪费。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_entity_snapshots (
            id TEXT PRIMARY KEY,
            module_id TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            digest TEXT NOT NULL,
            trigger_kind TEXT NOT NULL DEFAULT '',
            entity_label TEXT NOT NULL DEFAULT '',
            entities_json TEXT NOT NULL,
            coverage_json TEXT NOT NULL DEFAULT '[]',
            dimensions_json TEXT NOT NULL DEFAULT '[]',
            survived_json TEXT NOT NULL DEFAULT '[]',
            total INTEGER NOT NULL DEFAULT 0,
            cutoff REAL NOT NULL DEFAULT 0,
            first_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            last_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            seen_count INTEGER NOT NULL DEFAULT 1
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_entity_snap_scope \
         ON ai_entity_snapshots(module_id, scope_id, first_at DESC)",
        [],
    )?;

    // 33. ai_code_changes — AI 改动台账（R47 P2-A）。
    //
    // 为什么改动必须有台账，而不是只留一个 `.bak`
    // ------------------------------------------
    // `.bak` 是覆盖式的：AI 连续改同一个文件三次，前两次的原始版本就永久消失了，
    // 而「连续改三次」恰恰是 Agent 模式最常见的形态（改完自查、再改一处）。
    // 更要紧的是，`.bak` 只回答「上一版长什么样」，不回答用户唯一关心的问题：
    // **刚才那一轮 AI 到底动了哪几个文件、每处为什么动、我要不要留下它**。
    //
    // 三个字段各自堵掉一种会让「撤销」变成新事故的实现
    // ----------------------------------------------
    // · before_content：改动前全文快照。撤销的第一选择是整文回写——只有在磁盘内容
    //   仍等于我们写下的那一份时才安全（见 after_hash）。快照可能为 NULL（超大文件
    //   不留快照），此时只能走片段级反向补丁，UI 需要据此提示能力差异。
    // · after_hash：写盘后的内容指纹。缺了它，撤销就成了「拿旧快照盖掉当前文件」——
    //   用户在 AI 改完之后自己又编辑过，一次撤销会把他的手工修改一起吞掉。
    //   指纹不符时降级为反向补丁（只换回这一处），换不回来就拒绝并让用户手动处理。
    // · old_text/new_text：锚点片段。它是片段级撤销的唯一依据，也是评审视图里
    //   「这次改了什么」的最小可读单位（整文 diff 在 800 行文件上没人看得下去）。
    //
    // status 语义刻意区分 pending / kept：AI 自己写盘的改动进 pending（等人过目），
    // 用户在面板上点「应用」的改动直接 kept（他本人就是决策者，不该再排队要求自己审自己）。
    // 两者都可 revert——已确认不等于不能反悔。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_code_changes (
            id TEXT PRIMARY KEY,
            analysis_id TEXT NOT NULL,
            file_id TEXT NOT NULL DEFAULT '',
            rel_path TEXT NOT NULL,
            abs_path TEXT NOT NULL DEFAULT '',
            mode TEXT NOT NULL DEFAULT 'patch',
            origin TEXT NOT NULL DEFAULT 'agent',
            reason TEXT NOT NULL DEFAULT '',
            old_text TEXT NOT NULL DEFAULT '',
            new_text TEXT NOT NULL DEFAULT '',
            before_content TEXT,
            after_hash TEXT NOT NULL DEFAULT '',
            before_lines INTEGER NOT NULL DEFAULT 0,
            after_lines INTEGER NOT NULL DEFAULT 0,
            delta_lines INTEGER NOT NULL DEFAULT 0,
            start_line INTEGER NOT NULL DEFAULT 0,
            end_line INTEGER NOT NULL DEFAULT 0,
            approx INTEGER NOT NULL DEFAULT 0,
            conversation_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            resolved_at INTEGER
        )",
        [],
    )?;
    // 评审视图按「最近一轮」倒序读，且要能只看某个分析的待审项
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_code_changes_scope \
         ON ai_code_changes(analysis_id, created_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_code_changes_status \
         ON ai_code_changes(analysis_id, status, created_at DESC)",
        [],
    )?;

    // ─── 写作域（Sight Folio）：书籍 + 章节 ───
    // 纯新增，不影响既有分析器表。书 = 一个创作项目；章 = 写作基本单元，
    // content 存 TipTap HTML。sort_order 由前端维护（插入/拖拽后重排写回）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            genre TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            cover_color TEXT NOT NULL DEFAULT '#4A338F',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_chapters (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            word_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            parent_id TEXT,
            kind TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writing_chapters_book \
         ON writing_chapters(book_id, sort_order)",
        [],
    )?;
    // 创作设定库：kind = character（人设卡）| worldbuilding（世界观）。
    // subtitle 对人设卡存「身份/角色」、对世界观存「分类（地点/组织/物品…）」；
    // extra 为 JSON 透传字段（关系/时间线等 P2 扩展走这里，加字段零迁移）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_settings (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            extra TEXT NOT NULL DEFAULT '{}',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writing_settings_book \
         ON writing_settings(book_id, kind, sort_order)",
        [],
    )?;
    // 写作统计：每日一个快照点（save_chapter 时自动 upsert 当天快照），
    // day 为本地日期 YYYY-MM-DD；word_count 为该日结束时全书总字数，
    // 日更量 = 相邻两日差值（前端计算）。历史不可追补，所以从第一天就开始记。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_daily_stats (
            book_id TEXT NOT NULL,
            day TEXT NOT NULL,
            word_count INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (book_id, day)
        )",
        [],
    )?;
    // 大纲：与章节可双向关联的结构规划。chapter_id 可空绑定（NULL=未落章），
    // 无外键（删章解绑由前端负责）；删书时级联清理。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_outlines (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            chapter_id TEXT,
            extra TEXT NOT NULL DEFAULT '{}',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writing_outlines_book \
         ON writing_outlines(book_id, sort_order)",
        [],
    )?;
    // 时间线事件（D）：全书级实体，独立于设定卡 extra.timeline。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_timeline_events (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            setting_id TEXT,
            at TEXT NOT NULL DEFAULT '',
            event TEXT NOT NULL DEFAULT '',
            chapter_id TEXT,
            storyline_id TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writing_timeline_events_book \
         ON writing_timeline_events(book_id, setting_id)",
        [],
    )?;
    // 剧情线（多线叙事实体）：事件通过 storyline_id 挂线（见上方 timeline 表）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_storylines (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writing_storylines_book \
         ON writing_storylines(book_id, sort_order)",
        [],
    )?;
    // 旧库升级：时间线事件加 storyline_id 列（只 ALTER 不 DROP；新库建表已含，PRAGMA 检查幂等）。
    let event_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(writing_timeline_events)")?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !event_cols.is_empty() && !event_cols.contains(&"storyline_id".to_string()) {
        conn.execute(
            "ALTER TABLE writing_timeline_events ADD COLUMN storyline_id TEXT",
            [],
        )?;
    }
    // 伏笔（「埋设 → 回收」承诺）：status 三态 pending/paidoff/abandoned；回收章可空。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_foreshadowings (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            plant_chapter_id TEXT,
            payoff_chapter_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            storyline_id TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writing_foreshadowings_book \
         ON writing_foreshadowings(book_id, sort_order)",
        [],
    )?;
    // 章节版本快照（批次④）：切章/手动时对正文存档，origin = auto | manual。
    // 每章只保留最近 N 份（仓储层 save_chapter_snapshot 事务内裁剪）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS writing_chapter_snapshots (
            id TEXT PRIMARY KEY,
            chapter_id TEXT NOT NULL,
            book_id TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            word_count INTEGER NOT NULL DEFAULT 0,
            origin TEXT NOT NULL DEFAULT 'auto',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_writing_chapter_snapshots_chapter \
         ON writing_chapter_snapshots(chapter_id, created_at)",
        [],
    )?;
    // P6：章节卷分组（volume='' = 未分卷）与书级日更目标。幂等 ALTER（migrate 每次启动都会跑）。
    let chapter_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(writing_chapters)")?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !chapter_cols.is_empty() && !chapter_cols.contains(&"volume".to_string()) {
        conn.execute(
            "ALTER TABLE writing_chapters ADD COLUMN volume TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    // 章头图等 P2 扩展走 extra JSON 透传（与 settings/outlines 同范式，加字段零迁移）。
    // 幂等 ALTER；旧库建表无此列，新库建表已有（init_tables 同步见 commands/writing.rs 导入样板）。
    if !chapter_cols.is_empty() && !chapter_cols.contains(&"extra".to_string()) {
        conn.execute(
            "ALTER TABLE writing_chapters ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'",
            [],
        )?;
    }

    let book_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(writing_books)")?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !book_cols.is_empty() && !book_cols.contains(&"daily_goal".to_string()) {
        conn.execute(
            "ALTER TABLE writing_books ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    // P1 体裁×载体：载体列（serial 连载 / standalone 单本 / collection 篇目集）。
    // 幂等 ALTER（migrate 每次启动都会跑）；体裁列 genre 建表即有，无需补。
    if !book_cols.is_empty() && !book_cols.contains(&"medium".to_string()) {
        conn.execute(
            "ALTER TABLE writing_books ADD COLUMN medium TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    // 设计视图节拍挂载：outline.extra JSON 透传（出场人物/场景 id 集合）。
    // 幂等 ALTER；旧库建表时无此列，新库建表即有。
    let outline_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(writing_outlines)")?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !outline_cols.is_empty() && !outline_cols.contains(&"extra".to_string()) {
        conn.execute(
            "ALTER TABLE writing_outlines ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'",
            [],
        )?;
    }

    // ─── auth 域表（fork 遗留缺口：auth_repository 引用 auth_config / auth_config_presets，
    //     但 init_tables 从未建表 → "no such table: auth_config"）───
    // 列结构对齐 auth_repository.rs 的 SELECT/UPDATE；默认值取 AuthConfig::default()。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS auth_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            preset TEXT NOT NULL DEFAULT 'custom',
            base_url TEXT NOT NULL DEFAULT '',
            auth_params TEXT NOT NULL DEFAULT '[]',
            endpoints TEXT NOT NULL DEFAULT '[]',
            header_config TEXT NOT NULL DEFAULT '[]',
            user_display_config TEXT NOT NULL DEFAULT '[]',
            timeout INTEGER NOT NULL DEFAULT 10000,
            token_storage TEXT NOT NULL DEFAULT 'localStorage',
            token_key TEXT NOT NULL DEFAULT 'auth_token',
            token_header TEXT NOT NULL DEFAULT 'Authorization',
            token_prefix TEXT NOT NULL DEFAULT 'Bearer ',
            refresh_enabled INTEGER NOT NULL DEFAULT 1,
            refresh_threshold INTEGER NOT NULL DEFAULT 300,
            login_redirect_path TEXT NOT NULL DEFAULT '/login',
            login_redirect_param TEXT NOT NULL DEFAULT 'redirect',
            login_auto_redirect INTEGER NOT NULL DEFAULT 1,
            whitelist TEXT NOT NULL DEFAULT '[\"/login\",\"/public/*\"]',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;
    // update_config/reset_config 都是 UPDATE ... WHERE id = 1，必须有种子行。
    conn.execute("INSERT OR IGNORE INTO auth_config (id) VALUES (1)", [])?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS auth_config_presets (
            preset TEXT PRIMARY KEY,
            config TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )",
        [],
    )?;

    // ─── 内置 4 个默认审查规则 ───
    seed_default_review_rules(conn)?;
    // ─── 语言专属内置审查规则（§4.2 RuleRegistry ↔ 引擎：按语言分发的种子规则）───
    seed_language_review_rules(conn)?;

    seed_analysis_categories(conn)?;
    seed_component_categories(conn)?;
    seed_project_plugins(conn)?;

    Ok(())
}

pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let icon_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(system_icons)")?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !icon_columns.is_empty()
        && icon_columns.contains(&"category".to_string())
        && !icon_columns.contains(&"group_id".to_string())
    {
        conn.execute(
            "ALTER TABLE system_icons ADD COLUMN group_id TEXT NOT NULL DEFAULT 'default'",
            [],
        )?;
        conn.execute("UPDATE system_icons SET group_id = category", [])?;
        conn.execute(
            "INSERT OR IGNORE INTO icon_groups (id, name, updated_at) VALUES ('default', '默认分组', strftime('%s', 'now'))",
            [],
        )?;
    }

    let group_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(icon_groups)")?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !group_columns.is_empty() && !group_columns.contains(&"parent_id".to_string()) {
        conn.execute("ALTER TABLE icon_groups ADD COLUMN parent_id TEXT", [])?;
    }

    // ─── 结构树（parent_id + kind）：旧书 volume 串 → 卷父节点 ───
    // 创作者自定义任意层级（部/卷/章/节/幕/场…），底层只是一张带 parent_id 的节点表。
    // 幂等 ALTER（migrate 每次启动都跑）；新库建表即有这两列，旧库补 ALTER。
    let ch_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(writing_chapters)")?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !ch_cols.is_empty() && !ch_cols.contains(&"parent_id".to_string()) {
        conn.execute("ALTER TABLE writing_chapters ADD COLUMN parent_id TEXT", [])?;
    }
    if !ch_cols.is_empty() && !ch_cols.contains(&"kind".to_string()) {
        conn.execute("ALTER TABLE writing_chapters ADD COLUMN kind TEXT NOT NULL DEFAULT ''", [])?;
    }
    // 回填：parent_id 仍为 NULL 且带了旧 volume 的章，按 volume 归并成 卷 父节点后 reparent。
    // 幂等：只动 parent_id IS NULL 的行；首跑后这些章已挂到 卷 下，后续启动不再触发。
    let legacy_books: Vec<String> = conn
        .prepare("SELECT DISTINCT book_id FROM writing_chapters WHERE parent_id IS NULL AND volume != ''")?
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    for book_id in legacy_books {
        let vols: Vec<(String, i64)> = conn
            .prepare(
                "SELECT DISTINCT volume, MIN(sort_order) FROM writing_chapters \
                 WHERE book_id = ?1 AND parent_id IS NULL AND volume != '' GROUP BY volume",
            )?
            .query_map([&book_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        for (vol, min_so) in vols {
            let vol_id = format!("vol_{}_{}", book_id, vol);
            conn.execute(
                "INSERT OR IGNORE INTO writing_chapters \
                 (id, book_id, title, sort_order, kind, parent_id) VALUES (?1,?2,?3,?4,'卷',NULL)",
                rusqlite::params![vol_id, book_id, vol, min_so],
            )?;
            conn.execute(
                "UPDATE writing_chapters SET parent_id = ?1, kind = '章' \
                 WHERE book_id = ?2 AND parent_id IS NULL AND volume = ?3",
                rusqlite::params![vol_id, book_id, vol],
            )?;
        }
        // 剩余：父为 NULL 且 volume 为空 的旧章 → 标记为根级 章（kind 默认空时补 '章'）
        conn.execute(
            "UPDATE writing_chapters SET kind = '章' \
             WHERE book_id = ?1 AND parent_id IS NULL AND (kind = '' OR kind IS NULL)",
            rusqlite::params![book_id],
        )?;
    }

    let ds_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(data_sources)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    // ─── 旧字段迁移：从 connection → config，bound_components → linked_entities ───
    if ds_columns.is_empty() || !ds_columns.contains(&"config".to_string()) {
        if !ds_columns.is_empty() && ds_columns.contains(&"connection".to_string()) {
            conn.execute("ALTER TABLE data_sources RENAME COLUMN connection TO config", [])?;
        } else {
            conn.execute(
                "ALTER TABLE data_sources ADD COLUMN config TEXT NOT NULL DEFAULT '{}'",
                [],
            )?;
        }
    }

    if ds_columns.is_empty() || !ds_columns.contains(&"linked_entities".to_string()) {
        if !ds_columns.is_empty() && ds_columns.contains(&"bound_components".to_string()) {
            conn.execute("ALTER TABLE data_sources RENAME COLUMN bound_components TO linked_entities", [])?;
        } else {
            conn.execute(
                "ALTER TABLE data_sources ADD COLUMN linked_entities TEXT NOT NULL DEFAULT '[]'",
                [],
            )?;
        }
    }

    if ds_columns.is_empty() || !ds_columns.contains(&"sync_status".to_string()) {
        conn.execute(
            "ALTER TABLE data_sources ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'idle'",
            [],
        )?;
    }

    if ds_columns.is_empty() || !ds_columns.contains(&"last_sync_at".to_string()) {
        conn.execute("ALTER TABLE data_sources ADD COLUMN last_sync_at INTEGER", [])?;
    }

    // fork 遗留失配修复：datasource repository 的 SELECT/INSERT 引用 response_mapping / test_apis
    // （均为 Vec<T> 的 JSON 序列化），但 data_sources 建表从未包含这两列 → 旧库上
    // "no such column: response_mapping"。幂等 ALTER（migrate 每次启动都会跑）。
    if !ds_columns.is_empty() && !ds_columns.contains(&"response_mapping".to_string()) {
        conn.execute(
            "ALTER TABLE data_sources ADD COLUMN response_mapping TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }
    if !ds_columns.is_empty() && !ds_columns.contains(&"test_apis".to_string()) {
        conn.execute(
            "ALTER TABLE data_sources ADD COLUMN test_apis TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }

    // ─── component_plugins 字段清理 ───
    let cp_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(component_plugins)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cp_columns.is_empty() && cp_columns.contains(&"renderer_type".to_string()) {
        // 修复：此前误将 renderer_format 改名为 renderer_type，但种子插入 / 模型 / 仓库仍使用
        // renderer_format（与 CREATE TABLE 一致），导致 init_tables 种子插入报
        // “no column named renderer_format”。这里回退为 renderer_format 以自修复。
        conn.execute(
            "ALTER TABLE component_plugins RENAME COLUMN renderer_type TO renderer_format",
            [],
        )?;
    }

    let analysis_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(analyses)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !analysis_columns.is_empty() && !analysis_columns.contains(&"project_root".to_string()) {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN project_root TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"scan_status".to_string()) {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'pending'",
            [],
        )?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"scan_progress".to_string()) {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN scan_progress INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"last_scanned_at".to_string()) {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN last_scanned_at INTEGER",
            [],
        )?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"total_files".to_string()) {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN total_files INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"total_lines".to_string()) {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN total_lines INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"primary_language".to_string()) {
        conn.execute(
            "ALTER TABLE analyses ADD COLUMN primary_language TEXT",
            [],
        )?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"editor_components".to_string()) {
        conn.execute("ALTER TABLE analyses ADD COLUMN editor_components TEXT", [])?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"editor_layers".to_string()) {
        conn.execute("ALTER TABLE analyses ADD COLUMN editor_layers TEXT", [])?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"canvas_config".to_string()) {
        if !analysis_columns.is_empty() && analysis_columns.contains(&"canvas_size".to_string()) {
            conn.execute(
                "ALTER TABLE analyses RENAME COLUMN canvas_size TO canvas_config",
                [],
            )?;
        } else {
            conn.execute("ALTER TABLE analyses ADD COLUMN canvas_config TEXT", [])?;
        }
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"global_components".to_string()) {
        conn.execute("ALTER TABLE analyses ADD COLUMN global_components TEXT", [])?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"views".to_string()) {
        conn.execute("ALTER TABLE analyses ADD COLUMN views TEXT", [])?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"active_view_id".to_string()) {
        conn.execute("ALTER TABLE analyses ADD COLUMN active_view_id TEXT", [])?;
    }

    if analysis_columns.is_empty() || !analysis_columns.contains(&"viewport_sync_rules".to_string()) {
        conn.execute("ALTER TABLE analyses ADD COLUMN viewport_sync_rules TEXT", [])?;
    }

    {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM component_categories WHERE id = 'ccat_decoration_title'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            let now = chrono::Utc::now().timestamp();
            conn.execute(
                "INSERT OR IGNORE INTO component_categories (id, name, icon, color, sort_order, parent_id, description, created_at, updated_at)
                 VALUES ('ccat_decoration_title', '标题栏', 'title', '#4DD0E1', 5, NULL, '数据大屏标题栏组件', ?1, ?1)",
                rusqlite::params![now],
            )?;
            conn.execute(
                "UPDATE component_categories SET sort_order = 6 WHERE id = 'ccat_custom' AND sort_order = 5",
                [],
            )?;
        }
    }

    {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM component_categories WHERE id = 'ccat_datav'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            let now = chrono::Utc::now().timestamp();
            conn.execute(
                "INSERT OR IGNORE INTO component_categories (id, name, icon, color, sort_order, parent_id, description, created_at, updated_at)
                 VALUES ('ccat_datav', 'DataV组件', 'data_object', '#7C4DFF', 6, NULL, 'DataV大屏装饰与边框组件', ?1, ?1)",
                rusqlite::params![now],
            )?;
            conn.execute(
                "UPDATE component_categories SET sort_order = 7 WHERE id = 'ccat_custom' AND sort_order <= 6",
                [],
            )?;
        }
    }

    // 扁平化：移除二级分组的 parent_id，让所有分组都在同一层级
    {
        conn.execute(
            "UPDATE component_categories SET parent_id = NULL WHERE parent_id IS NOT NULL",
            [],
        )?;
    }

    // 增量：合并旧的三个喷雾分组到"降尘喷雾"
    {
        let now = chrono::Utc::now().timestamp();
        // 确保"降尘喷雾"分组存在
        conn.execute(
            "INSERT OR IGNORE INTO analysis_categories (id, name, icon, color, sort_order, description, created_at, updated_at)
             VALUES ('cat_spray_dedust', '降尘喷雾', 'water_drop', '#56D0E3', 0, '喷雾降尘系统监控场景', ?1, ?1)",
            rusqlite::params![now],
        )?;
        // 把旧分组下的场景迁移到"降尘喷雾"
        let old_cats = ["cat_spray_tunnel", "cat_spray_bridge", "cat_spray_mining"];
        for old_id in &old_cats {
            conn.execute(
                "UPDATE analyses SET category_id = 'cat_spray_dedust' WHERE category_id = ?1",
                rusqlite::params![old_id],
            )?;
            conn.execute(
                "DELETE FROM analysis_categories WHERE id = ?1",
                rusqlite::params![old_id],
            )?;
        }
    }

    // ─── project_modules 补列：sort_order_via_layer（语义模块按层排序，建表时漏加）───
    let pm_columns: Vec<String> = conn
        .prepare("PRAGMA table_info(project_modules)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !pm_columns.is_empty() && !pm_columns.contains(&"sort_order_via_layer".to_string()) {
        conn.execute(
            "ALTER TABLE project_modules ADD COLUMN sort_order_via_layer INTEGER",
            [],
        )?;
    }

    // 数据迁移（D）：旧版落在设定卡 extra.timeline 的事件按确定性 ID 灌入本表（零丢失、幂等）。
    // 必须在 migrate 里（每次启动跑），而非 init_tables（建表），否则旧数据的 timeline 不会被迁移。
    // INSERT OR IGNORE（ID = ev_{settingId}_{index}）保证重启不重复；剥离 extra.timeline
    // 后该设定不再被上述 SELECT 命中，删空事件也不会"重启复活"（尊重创作者删除）。
    // 纯 SQL JSON1，单独容错：extra 偶发非法 JSON 不应拖垮整次 migrate。
    let tl_import = "
        INSERT OR IGNORE INTO writing_timeline_events
            (id, book_id, setting_id, at, event, chapter_id, sort_order, created_at, updated_at)
        SELECT
            'ev_' || s.id || '_' || j.key,
            s.book_id,
            s.id,
            COALESCE(json_extract(j.value, '$.at'), ''),
            COALESCE(json_extract(j.value, '$.event'), ''),
            NULLIF(json_extract(j.value, '$.chapterId'), ''),
            CAST(j.key AS INTEGER),
            strftime('%s', 'now'),
            strftime('%s', 'now')
        FROM writing_settings s, json_each(s.extra, '$.timeline') j
        WHERE json_array_length(s.extra, '$.timeline') > 0
          AND COALESCE(json_extract(j.value, '$.event'), '') <> ''
    ";
    if let Err(e) = conn.execute(tl_import, []) {
        eprintln!("[migration] timeline_events import skipped: {e}");
    }
    let tl_strip = "UPDATE writing_settings \
        SET extra = json_remove(extra, '$.timeline') \
        WHERE json_array_length(extra, '$.timeline') > 0";
    if let Err(e) = conn.execute(tl_strip, []) {
        eprintln!("[migration] timeline_events extra strip skipped: {e}");
    }

    Ok(())
}

fn seed_component_categories(conn: &Connection) -> Result<(), rusqlite::Error> {
    // 读取用户已删除的分组 id，seed 时跳过
    let mut deleted_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT id FROM deleted_category_ids")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for row in rows {
            if let Ok(id) = row {
                deleted_ids.insert(id);
            }
        }
    }

    let now = chrono::Utc::now().timestamp();
    let seeds: Vec<(&str, &str, &str, &str, i32, Option<&str>, &str)> = vec![
        (
            "ccat_basic",
            "基础组件",
            "palette",
            "#4FC3F7",
            0,
            None,
            "文本、图片、形状等基础组件",
        ),
        (
            "ccat_basic_text",
            "文本类",
            "text_fields",
            "#4FC3F7",
            1,
            None,
            "文本相关组件",
        ),
        (
            "ccat_basic_shape",
            "图形类",
            "crop_square",
            "#4FC3F7",
            2,
            None,
            "图形和形状组件",
        ),
        (
            "ccat_chart",
            "图表组件",
            "bar_chart",
            "#FF8A65",
            3,
            None,
            "数据可视化图表组件",
        ),
        (
            "ccat_chart_data",
            "数据图表",
            "bar_chart",
            "#FF8A65",
            4,
            None,
            "数据可视化图表",
        ),
        (
            "ccat_chart_metric",
            "指标卡片",
            "speed",
            "#FF8A65",
            5,
            None,
            "指标展示卡片",
        ),
        (
            "ccat_map",
            "地图组件",
            "map",
            "#81C784",
            6,
            None,
            "2D/3D 地图组件",
        ),
        (
            "ccat_media",
            "媒体组件",
            "videocam",
            "#BA68C8",
            7,
            None,
            "视频、音频等媒体组件",
        ),
        (
            "ccat_decoration",
            "装饰组件",
            "auto_awesome",
            "#FFD54F",
            8,
            None,
            "装饰性组件",
        ),
        (
            "ccat_decoration_title",
            "标题栏",
            "title",
            "#4DD0E1",
            9,
            None,
            "数据大屏标题栏组件",
        ),
        (
            "ccat_datav",
            "DataV组件",
            "data_object",
            "#7C4DFF",
            10,
            None,
            "DataV大屏装饰与边框组件",
        ),
    ];

    for (id, name, icon, color, sort_order, parent_id, description) in &seeds {
        // 跳过用户已删除的分组
        if deleted_ids.contains(*id) {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO component_categories (id, name, icon, color, sort_order, parent_id, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            rusqlite::params![id, name, icon, color, sort_order, parent_id, description, now],
        )?;
    }

    Ok(())
}

/// 初始化 7 个项目实体内建 plugin
///
/// sight-folio 把 biosphere 的 100+ 图表/装饰/设备渲染器压缩为 7 个核心项目实体：
///   - file: 文件节点
///   - folder: 文件夹节点
///   - module: 模块节点（语义聚合：相关文件组）
///   - dependency-edge: 依赖边
///   - layer-marker: 架构分层标记
///   - annotation: 自由标注文本
///   - code-preview: 代码预览
///
/// 内建 plugin（built_in=1）由系统自动安装，不允许用户卸载，只能修改默认配置。
fn seed_project_plugins(conn: &Connection) -> Result<(), rusqlite::Error> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM component_plugins WHERE built_in = 1",
        [],
        |row| row.get(0),
    )?;
    if count > 0 {
        return Ok(());
    }

    let now = chrono::Utc::now().timestamp();

    // 通用 schema：每个实体都有一个 config_schema (JSON 数组) 描述可配置字段
    let size_schema = r##"[{"id":"width","key":"width","label":"宽度","type":"number","default":160,"min":40,"max":800},{"id":"height","key":"height","label":"高度","type":"number","default":60,"min":20,"max":400}]"##;
    let pos_schema = r##"[{"id":"x","key":"x","label":"X 坐标","type":"number","default":0},{"id":"y","key":"y","label":"Y 坐标","type":"number","default":0}]"##;
    let style_schema = r##"[{"id":"color","key":"color","label":"主题色","type":"color","default":"#4F46E5"},{"id":"showLabel","key":"showLabel","label":"显示标签","type":"boolean","default":true}]"##;

    // 通用 capabilities：每个实体都支持选中、移动、编辑、删除
    let caps = r##"{"selectable":true,"movable":true,"editable":true,"deletable":true,"resizable":false,"connectable":false}"##;

    // 1. file - 文件节点
    conn.execute(
        "INSERT OR IGNORE INTO component_plugins
         (id, type, name, version, description, icon, category, default_size, default_config, capabilities, config_schema, events, actions, data_schema, renderer_entry, renderer_format, dependencies, permissions, built_in, enabled, installed_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            "plugin_file",
            "project:file",
            "文件",
            "1.0.0",
            "项目源文件节点，显示文件路径、大小、行数、语言",
            "icon_file",
            "entity",
            r##"{"width":160,"height":48}"##,
            r##"{"showSize":true,"showLang":true,"colorByLang":true}"##,
            caps,
            format!("[{},{},{}]", pos_schema, size_schema, style_schema),
            r##"[{"id":"on_click","label":"点击"},{"id":"on_double_click","label":"双击打开"},{"id":"on_drag","label":"拖拽到画布"}]"##,
            r##"[{"id":"open_in_editor","label":"在编辑器打开"},{"id":"copy_path","label":"复制路径"},{"id":"show_dependencies","label":"显示依赖"}]"##,
            r##"{"fields":[{"key":"path","type":"string","required":true},{"key":"language","type":"string"},{"key":"size","type":"number"},{"key":"lines","type":"number"}]}"##,
            "FileRenderer",
            "module",
            "[]",
            "[]",
            1,
            1,
            now,
            now,
        ],
    )?;

    // 2. folder - 文件夹节点
    conn.execute(
        "INSERT OR IGNORE INTO component_plugins
         (id, type, name, version, description, icon, category, default_size, default_config, capabilities, config_schema, events, actions, data_schema, renderer_entry, renderer_format, dependencies, permissions, built_in, enabled, installed_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            "plugin_folder",
            "project:folder",
            "文件夹",
            "1.0.0",
            "目录容器节点，可嵌套",
            "icon_folder",
            "entity",
            r##"{"width":180,"height":48}"##,
            r##"{"expanded":true,"showFileCount":true}"##,
            caps,
            format!("[{},{},{}]", pos_schema, size_schema, style_schema),
            r##"[{"id":"on_click","label":"点击"},{"id":"on_toggle","label":"展开/折叠"}]"##,
            r##"[{"id":"scan","label":"扫描内容"},{"id":"refresh","label":"刷新"}]"##,
            r##"{"fields":[{"key":"path","type":"string","required":true},{"key":"fileCount","type":"number"}]}"##,
            "FolderRenderer",
            "module",
            "[]",
            "[]",
            1,
            1,
            now,
            now,
        ],
    )?;

    // 3. module - 模块节点
    conn.execute(
        "INSERT OR IGNORE INTO component_plugins
         (id, type, name, version, description, icon, category, default_size, default_config, capabilities, config_schema, events, actions, data_schema, renderer_entry, renderer_format, dependencies, permissions, built_in, enabled, installed_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            "plugin_module",
            "project:module",
            "模块",
            "1.0.0",
            "语义模块节点：聚合相关文件，含依赖统计",
            "icon_module",
            "entity",
            r##"{"width":200,"height":80}"##,
            r##"{"showDeps":true,"colorByLayer":true}"##,
            caps,
            format!("[{},{},{}]", pos_schema, size_schema, style_schema),
            r##"[{"id":"on_click","label":"点击"},{"id":"on_drag","label":"拖拽"}]"##,
            r##"[{"id":"show_dependencies","label":"显示依赖"},{"id":"analyze","label":"分析模块"}]"##,
            r##"{"fields":[{"key":"name","type":"string","required":true},{"key":"layer","type":"string"},{"key":"depCount","type":"number"},{"key":"beDepCount","type":"number"}]}"##,
            "ModuleRenderer",
            "module",
            "[]",
            "[]",
            1,
            1,
            now,
            now,
        ],
    )?;

    // 4. dependency-edge - 依赖边
    conn.execute(
        "INSERT OR IGNORE INTO component_plugins
         (id, type, name, version, description, icon, category, default_size, default_config, capabilities, config_schema, events, actions, data_schema, renderer_entry, renderer_format, dependencies, permissions, built_in, enabled, installed_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            "plugin_dependency_edge",
            "project:dependency-edge",
            "依赖边",
            "1.0.0",
            "连接两个实体的依赖关系（指向被依赖方）",
            "icon_link",
            "relation",
            r##"{"width":2,"height":2}"##,
            r##"{"arrowEnd":true,"dashed":false,"colorByType":true}"##,
            r##"{"selectable":true,"movable":false,"editable":true,"deletable":true,"connectable":false}"##,
            r##"[{"id":"from","key":"from","label":"来源实体","type":"entity-ref","required":true},{"id":"to","key":"to","label":"目标实体","type":"entity-ref","required":true},{"id":"kind","key":"kind","label":"依赖类型","type":"select","options":["import","require","call","reference"],"default":"import"}]"##,
            r##"[{"id":"on_click","label":"点击"}]"##,
            r##"[{"id":"trace","label":"追溯依赖链"}]"##,
            r##"{"fields":[{"key":"from","type":"string","required":true},{"key":"to","type":"string","required":true},{"key":"kind","type":"string"}]}"##,
            "DependencyEdgeRenderer",
            "module",
            "[]",
            "[]",
            1,
            1,
            now,
            now,
        ],
    )?;

    // 5. layer-marker - 架构分层标记
    conn.execute(
        "INSERT OR IGNORE INTO component_plugins
         (id, type, name, version, description, icon, category, default_size, default_config, capabilities, config_schema, events, actions, data_schema, renderer_entry, renderer_format, dependencies, permissions, built_in, enabled, installed_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            "plugin_layer_marker",
            "project:layer-marker",
            "架构分层",
            "1.0.0",
            "架构层标记（表现层/业务层/数据层），用于把模块归类",
            "icon_layer",
            "structure",
            r##"{"width":1200,"height":60}"##,
            r##"{"layerName":"未命名层","color":"#94A3B8"}"##,
            r##"{"selectable":true,"movable":true,"editable":true,"deletable":true,"resizable":true}"##,
            r##"[{"id":"layerName","key":"layerName","label":"层名","type":"string","required":true},{"id":"color","key":"color","label":"标识色","type":"color","default":"#94A3B8"},{"id":"order","key":"order","label":"层级顺序","type":"number","default":0}]"##,
            r##"[{"id":"on_drag","label":"拖入模块到本层"}]"##,
            r##"[{"id":"assign_modules","label":"归入模块"}]"##,
            r##"{"fields":[{"key":"layerName","type":"string","required":true}]}"##,
            "LayerMarkerRenderer",
            "module",
            "[]",
            "[]",
            1,
            1,
            now,
            now,
        ],
    )?;

    // 6. annotation - 标注文本
    conn.execute(
        "INSERT OR IGNORE INTO component_plugins
         (id, type, name, version, description, icon, category, default_size, default_config, capabilities, config_schema, events, actions, data_schema, renderer_entry, renderer_format, dependencies, permissions, built_in, enabled, installed_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            "plugin_annotation",
            "project:annotation",
            "注释",
            "1.0.0",
            "自由文本注释，用于标记架构意图或审查意见",
            "icon_note",
            "structure",
            r##"{"width":200,"height":80}"##,
            r##"{"text":"请输入注释...","fontSize":14,"color":"#1E293B"}"##,
            caps,
            format!("[{},{},{{\"id\":\"text\",\"key\":\"text\",\"label\":\"文本\",\"type\":\"textarea\",\"required\":true}}]", pos_schema, style_schema),
            r##"[{"id":"on_edit","label":"编辑"}]"##,
            r##"[]"##,
            r##"null"##,
            "ProjectAnnotationRenderer",
            "module",
            "[]",
            "[]",
            1,
            1,
            now,
            now,
        ],
    )?;

    // 7. code-preview - 代码预览
    conn.execute(
        "INSERT OR IGNORE INTO component_plugins
         (id, type, name, version, description, icon, category, default_size, default_config, capabilities, config_schema, events, actions, data_schema, renderer_entry, renderer_format, dependencies, permissions, built_in, enabled, installed_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            "plugin_code_preview",
            "project:code-preview",
            "代码预览",
            "1.0.0",
            "在画布上展示指定文件的代码片段（带语法高亮）",
            "icon_code",
            "entity",
            r##"{"width":480,"height":320}"##,
            r##"{"showLineNumbers":true,"maxLines":200,"theme":"github-light"}"##,
            format!("{{{},{}}}", caps, r##""resizable":true"##),
            format!("[{},{{\"id\":\"fileRef\",\"key\":\"fileRef\",\"label\":\"引用文件\",\"type\":\"entity-ref\",\"required\":true,\"refType\":\"project:file\"}},{{\"id\":\"startLine\",\"key\":\"startLine\",\"label\":\"起始行\",\"type\":\"number\",\"default\":1}},{{\"id\":\"endLine\",\"key\":\"endLine\",\"label\":\"结束行\",\"type\":\"number\",\"default\":50}}]", pos_schema),
            r##"[{"id":"on_drag","label":"拖拽"}]"##,
            r##"[{"id":"open_full","label":"打开完整文件"}]"##,
            r##"{"fields":[{"key":"fileRef","type":"string","required":true}]}"##,
            "CodePreviewRenderer",
            "module",
            "[]",
            "[]",
            1,
            1,
            now,
            now,
        ],
    )?;

    Ok(())
}

/// 初始化 4 个内建审查规则
///
/// - no_circular_deps: 检测循环依赖（critical）
/// - file_size_limit: 单文件超过 800 行警告
/// - layer_violation: 检查模块是否归类到架构分层
/// - dead_code_detect: 标记未被引用的模块（warning）
fn seed_default_review_rules(conn: &Connection) -> Result<(), rusqlite::Error> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM review_rules WHERE builtin = 1", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let now = chrono::Utc::now().timestamp();

    let rules = vec![
        (
            "rule_no_circular_deps",
            "禁止循环依赖",
            "检测模块之间是否存在循环依赖（A→B→A）",
            "graph",
            "module",
            r##"{"algorithm":"tarjan_scc","min_cycle_length":2}"##,
            "critical",
        ),
        (
            "rule_file_size_limit",
            "单文件过大",
            "单文件超过 800 行可能导致可维护性问题",
            "metric",
            "file",
            r##"{"metric":"line_count","op":">","threshold":800}"##,
            "warning",
        ),
        (
            "rule_layer_violation",
            "未归入分层",
            "模块/文件应当归入某个架构分层（表现层/业务层/数据层等）",
            "metadata",
            "module",
            r##"{"required_field":"layer_id","error_if_null":true}"##,
            "info",
        ),
        (
            "rule_dead_code_detect",
            "死代码检测",
            "未被任何其他模块依赖的文件可能为死代码",
            "graph",
            "file",
            r##"{"algorithm":"in_degree_zero","min_lines":10}"##,
            "warning",
        ),
        (
            "rule_user_facing_message",
            "对外错误消息友好性",
            "用户可见的错误消息应为非空、参数化、可操作的文案；空消息/硬编码中文/泛化占位（error/failed）均不友好",
            "friendly",
            "file",
            r##"{"min_hits":1}"##,
            "warning",
        ),
    ];

    for (id, name, desc, rule_type, target_type, body, severity) in rules {
        conn.execute(
            "INSERT OR IGNORE INTO review_rules
             (id, name, description, rule_type, target_type, rule_body, severity, enabled, scope, builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 'all', 1, ?8, ?8)",
            rusqlite::params![id, name, desc, rule_type, target_type, body, severity, now],
        )?;
    }

    Ok(())
}

/// 初始化语言专属内置审查规则（§4.2 RuleRegistry ↔ 引擎 深度联动）
///
/// 规则 id 与前端分析器插件在 RuleRegistry 中声明的 id 对齐
/// （rs-unsafe / py-import-cycle / ts-complexity 等），因此：
/// - 前端 `sync_analyzer_rules` 下发时发现同 id 已存在 → 跳过，保留本处可执行种子版本；
/// - scope 为具体语言（rust/python/typescript），`run_review_rules` 按分析语言分发。
///
/// 逐条 INSERT OR IGNORE，天然幂等（不覆盖用户对 enabled 的修改）。
fn seed_language_review_rules(conn: &Connection) -> Result<(), rusqlite::Error> {
    let now = chrono::Utc::now().timestamp();

    let rules = vec![
        // ─── Rust（rust-analyzer 插件，scope=rust）───
        (
            "rs-unsafe",
            "unsafe 代码检测",
            "检测函数/模块中的 unsafe 代码块，评估内存安全风险",
            "unsafe",
            "file",
            r##"{"keywords":["unsafe"],"min_hits":1}"##,
            "critical",
            "rust",
        ),
        (
            "rs-complexity",
            "圈复杂度检测",
            "函数圈复杂度超过阈值时告警（行数代理：单文件超过 500 行）",
            "metric",
            "file",
            r##"{"metric":"line_count","op":">","threshold":500}"##,
            "warning",
            "rust",
        ),
        (
            "rs-layering",
            "分层违规检测",
            "检测未归入架构分层的 Rust 文件（跨层引用风险）",
            "metadata",
            "file",
            r##"{"required_field":"layer_id","error_if_null":true}"##,
            "critical",
            "rust",
        ),
        (
            "rs-unused",
            "未使用代码检测",
            "检测声明但从未被引用的模块/文件（入度为零的死代码）",
            "graph",
            "file",
            r##"{"algorithm":"in_degree_zero","min_lines":10}"##,
            "info",
            "rust",
        ),
        // ─── Python（python-analyzer 插件，scope=python）───
        (
            "py-import-cycle",
            "循环导入检测",
            "检测模块间的循环 import（import cycle）",
            "graph",
            "module",
            r##"{"algorithm":"circular","min_cycle_length":2}"##,
            "critical",
            "python",
        ),
        (
            "py-complexity",
            "圈复杂度检测",
            "函数/方法的圈复杂度超过阈值时告警（行数代理：单文件超过 400 行）",
            "metric",
            "file",
            r##"{"metric":"line_count","op":">","threshold":400}"##,
            "warning",
            "python",
        ),
        (
            "py-layering",
            "分层违规检测",
            "检测未归入架构分层的 Python 文件",
            "metadata",
            "file",
            r##"{"required_field":"layer_id","error_if_null":true}"##,
            "critical",
            "python",
        ),
        (
            "py-unused-import",
            "未使用导入检测",
            "检测已导入但从未被引用的模块（入度为零的死代码）",
            "graph",
            "file",
            r##"{"algorithm":"in_degree_zero","min_lines":10}"##,
            "info",
            "python",
        ),
        // ─── TypeScript（typescript-analyzer 插件，scope=typescript）───
        (
            "ts-complexity",
            "圈复杂度检测",
            "函数圈复杂度超过阈值时告警（行数代理：单文件超过 400 行）",
            "metric",
            "file",
            r##"{"metric":"line_count","op":">","threshold":400}"##,
            "warning",
            "typescript",
        ),
        (
            "ts-layering",
            "分层违规检测",
            "检测未归入架构分层的 TypeScript 文件",
            "metadata",
            "file",
            r##"{"required_field":"layer_id","error_if_null":true}"##,
            "critical",
            "typescript",
        ),
        (
            "ts-unused",
            "未使用导出检测",
            "检测未被引用的导出（入度为零的死代码）",
            "graph",
            "file",
            r##"{"algorithm":"in_degree_zero","min_lines":10}"##,
            "info",
            "typescript",
        ),
        // ─── 符号级死代码（跨语言通用，detect_dead_symbols 命令执行）───
        (
            "rule_dead_symbol",
            "死符号检测",
            "定义后从未被任何文件引用的函数/类/接口/结构体/特征（符号级死代码）",
            "graph",
            "symbol",
            r##"{"algorithm":"symbol_ref_zero","kinds":["function","class","interface","struct","trait","enum"]}"##,
            "warning",
            "all",
        ),
    ];

    for (id, name, desc, rule_type, target_type, body, severity, scope) in rules {
        conn.execute(
            "INSERT OR IGNORE INTO review_rules
             (id, name, description, rule_type, target_type, rule_body, severity, enabled, scope, builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, 1, ?9, ?9)",
            rusqlite::params![id, name, desc, rule_type, target_type, body, severity, scope, now],
        )?;
    }

    Ok(())
}

fn seed_analysis_categories(conn: &Connection) -> Result<(), rusqlite::Error> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM analysis_categories", [], |row| {
        row.get(0)
    })?;

    if count > 0 {
        return Ok(());
    }

    let now = chrono::Utc::now().timestamp();
    let seeds = vec![
        (
            "cat_default",
            "默认分组",
            "folder",
            "#757575",
            -1,
            "未分类的项目分析",
        ),
        (
            "cat_architecture",
            "架构分析",
            "layers",
            "#6366F1",
            0,
            "项目架构与分层分析",
        ),
        (
            "cat_dependency",
            "依赖分析",
            "lan",
            "#22C55E",
            1,
            "模块依赖与耦合度分析",
        ),
        (
            "cat_quality",
            "质量审查",
            "bug_report",
            "#EF4444",
            2,
            "代码质量与潜在问题审查",
        ),
        (
            "cat_tech_debt",
            "技术债务",
            "refresh",
            "#F59E0B",
            3,
            "技术债务与重构建议",
        ),
        (
            "cat_performance",
            "性能分析",
            "speed",
            "#3B82F6",
            4,
            "性能瓶颈与优化建议",
        ),
    ];

    for (id, name, icon, color, sort_order, description) in seeds {
        conn.execute(
            "INSERT OR IGNORE INTO analysis_categories (id, name, icon, color, sort_order, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            rusqlite::params![id, name, icon, color, sort_order, description, now],
        )?;
    }

    Ok(())
}

