// sight-folio: 工作台 AI 上下文协议（对标 VS Code Copilot Chat 的隐式上下文）
//
// 根因：原工作台把分析页的通用 Agent 对话框塞进侧栏，AI 完全不知道用户在看哪个文件、
// 选了哪段代码。本协议把「当前文件 / 选区 / 显式附件」标准化为可注入 prompt 的上下文，
// 每次发消息时自动拼进正文，不再依赖「用户恰好点了某个快捷 chip」。
//
// 铁律（沿用项目扫描台账规矩）：路径一律取自 files 表的 relPath，否则后端守门拒收。

import { L } from "../../ai/aiLang";
import type { EditorSelectionInfo } from "./MonacoCodeEditor";
import type { WritingSetting } from "../../services/tauri";

/** 对话模式：决定给模型的指令前缀，并驱动单次工具白名单（WORKBENCH_MODE_TOOLS → run_agent 的 allowed_tools） */
export type WorkbenchMode = "ask" | "edit" | "agent";

export const WORKBENCH_MODES: WorkbenchMode[] = ["ask", "edit", "agent"];

// 工作区与终端能力默认始终可用：导入项目即默认可用项目自身工作区（无需手动切 @workspace participant）；
// 终端（run_command）默认授权给新助手。因此不再有互斥的 participant 切换，
// 终端区块按「当前助手是否具备 run_command 且处于 agent 模式」派生。

/**
 * 各模式允许下发给模型的工具（单次调用白名单，与 Agent 配置取交集；null = 不限制）。
 *
 * - ask / edit：只读 + 分析类工具。改动一律由前端以 diff 预览后落盘（见 WorkbenchAiPanel），
 *   绝不让模型直接调用写盘工具，避免「说改就改磁盘」。
 * - agent：放开全部（含 apply_change，若 Agent 配置已授权），由改动评审条守门。
 *
 * 注意：工具名必须与后端 `create_project_sight_tools` 注册的 id 逐字一致（大小写不敏感匹配）。
 */
export const WORKBENCH_MODE_TOOLS: Record<WorkbenchMode, string[] | null> = {
  ask: ["file_read", "code_search", "symbol_lookup", "project_context", "scan_records"],
  edit: [
    "file_read",
    "code_search",
    "symbol_lookup",
    "project_context",
    "scan_records",
    "review_explain",
    "impact_assess",
    // 工具驱动的改动：本模式的「改动」走 apply_change 锚点补丁（登记进 ai_code_changes 台账，
    // 用户在面板「改动」视图逐条保留/撤销），这正是 VS Code Copilot Edits 的工作方式。
    // 与 Agent 配置取交集——若 Agent 未授权写盘，模型拿不到该工具，自动退回 markdown 兜底，零回归。
    "apply_change",
  ],
  agent: null,
};

/** 用户显式附加的上下文（#file / #symbol） */
export interface ContextAttachment {
  kind: "file" | "symbol";
  /** 展示名（文件名 / 符号名） */
  label: string;
  /** 相对路径（必须来自 files 表，否则后端守门拒收） */
  refPath: string;
  /** 符号名（kind==="symbol" 时） */
  symbolName?: string;
  /** 行号（symbol 定位用） */
  line?: number;
}

/** 当前文件的扫描事实摘要（差异化：第一轮对话就带着事实进去，无需现场读盘） */
export interface WorkbenchContextFacts {
  cc?: number;
  debt?: number;
  deadCount?: number;
  cloneGroups?: number;
  referencedBy?: number;
  /** 该文件当前「未修复」审查发现数（仅作用域块使用，强化「AI 认知画布」的分析事实） */
  findings?: number;
}

/** 工作区概览事实：由前端从 files 表聚合，让模型一上来就了解项目轮廓。工作区区块默认始终注入（项目自身目录默认可用）。 */
export interface WorkspaceFacts {
  fileCount: number;
  /** 语言分布（按文件数降序），截断到 top-8 */
  languages: { name: string; count: number }[];
  /** 顶层目录分布（按文件数降序），截断到 top-8 */
  topDirs: { path: string; count: number }[];
}

export interface WorkbenchContext {
  activeFile: {
    fileId: string;
    relPath: string;
    language: string | null;
    name: string;
    totalLines?: number;
  } | null;
  selection: EditorSelectionInfo | null;
  attachments: ContextAttachment[];
  mode: WorkbenchMode;
  facts: WorkbenchContextFacts | null;
  /**
   * 画布作用域（VS Code 没有的维度）：用户在画布上正聚焦的实体。
   * 与 activeFile 可能不同——用户常「编辑器改 X、画布看 Y」。AI 作答时
   * 以作用域优先，带着该实体的分析事实（复杂度/死代码/克隆/审查发现）作答。
   * null/undefined = 画布未聚焦任何文件型实体（如内联聊天场景不构造作用域）。
   */
  scope?: WorkbenchContextScope | null;
  /** 工作区概览事实：项目自身目录默认就在上下文里，故工作区区块始终注入（无需用户手动切 @workspace participant）。前端从 files 表聚合。 */
  workspace?: WorkspaceFacts;
  /** 当前助手是否具备 run_command 能力（决定 [Terminal] 区块是否注入）。由前端从当前助手的 toolIds 派生。 */
  hasRunCommand?: boolean;
  /** 当前文件的实时诊断（VS Code 式「修复此错误」的数据源）：让模型在每次对话都带着真实语法/类型错误作答，而非只看扫描台账。 */
  diagnostics?: WorkbenchContextDiagnostic[];
  /** 书场景下，AI 角色随左栏题材 tab 切换：characters=人物 / worldview=世界观 / catalog=大纲 / timeline=时间线 / overview=全书统筹。null/undefined=未限定题材（沿用通用写作人设）。 */
  bookTopic?: "characters" | "worldview" | "catalog" | "timeline" | "storylines" | "foreshadowing" | "inspiration" | "proofread" | "stats" | "writing" | "overview" | null;
  /** 当前书名（书场景注入，让 AI 知道在写哪本书）。 */
  bookTitle?: string | null;
  /** 当前选中的具体设定项（人物/世界观卡），钻入详情时带上，让 AI 聚焦这一个。setting = 完整档案（正文/结构化字段/关系），不只是名字。 */
  focusSetting?: { name: string; kind: "character" | "worldbuilding"; setting?: WritingSetting | null } | null;
  /** 题材语料（双语）：worldview=设定库；timeline=时间线档案；overview=全书跨维度总览。每轮消息都带上真实数据，避免模型凭空猜测；其它题材为 null。 */
  bookSettingCorpus?: { zh: string; en: string } | null;
  /** 聚焦设定语料（双语）：右栏选中某个具体人物/世界观设定（钻入详情）时注入，带该设定完整档案。 */
  focusSettingCorpus?: { zh: string; en: string } | null;
  /** 全书跨维度总览语料（与右栏《全书总览》同一口径，单一事实来源）。对所有书题材注入，让 AI 始终带全书快照作答。 */
  bookOverviewCorpus?: { zh: string; en: string } | null;
}

/** 画布作用域：标签 + 该实体的扫描事实（对标 VS Code 没有的「AI 认知画布」） */
export interface WorkbenchContextScope {
  label: string;
  relPath: string;
  facts: WorkbenchContextFacts;
  /**
   * 作用域级影响面（比 VS Code 更强）：聚焦该实体后，按调用图反向闭包算出的
   * 「改它会波及哪些文件」。让 AI 在重构/改动时带着爆炸半径作答，而非只看单文件。
   * 纯前端由 projectStore.callEdges 计算，可选以兼容不构造作用域的调用方（InlineChat）。
   */
  impact?: { relPath: string }[];
}

/** 当前文件的实时诊断（VS Code 式「修复此错误」的数据源，取自 Monaco 内置语法/类型标记） */
export interface WorkbenchContextDiagnostic {
  message: string;
  severity: "error" | "warning";
  /** 起始行（1 起） */
  line: number;
  code?: string;
  source?: string;
}

/** 书场景下，AI 角色随左栏题材 tab 切换（人物设计 / 世界观设计 / 大纲设计 / 时间线助手 / 全书统筹）——辅助创作者做该题材的设计。 */
export function bookTopicRoleInstruction(mode: WorkbenchMode, bookTopic: "characters" | "worldview" | "catalog" | "timeline" | "storylines" | "foreshadowing" | "inspiration" | "proofread" | "stats" | "writing" | "overview"): string {
  const topicLabel = bookTopic === "characters" ? L("人物", "character") : bookTopic === "worldview" ? L("世界观", "worldbuilding") : bookTopic === "catalog" ? L("大纲", "outline") : bookTopic === "storylines" ? L("剧情线", "storyline") : bookTopic === "foreshadowing" ? L("伏笔", "foreshadowing") : bookTopic === "inspiration" ? L("灵感", "idea") : bookTopic === "proofread" ? L("校对", "proofread") : bookTopic === "stats" ? L("统计", "stats") : bookTopic === "writing" ? L("正文写作", "manuscript") : bookTopic === "overview" ? L("全书统筹", "whole-book strategist") : L("时间线", "timeline");
  switch (mode) {
    case "ask":
      return L(
        `你是一个${topicLabel}设计助手。只回答、分析、给${topicLabel}设计建议，不要修改任何文件，也不要输出代码补丁。可以对照人设卡 / 世界观设定 / 全书结构给出建议，并优先围绕用户当前正在设计的${topicLabel}内容。`,
        `You are a ${topicLabel} design assistant. Only answer, analyze and give ${topicLabel} design suggestions. Do NOT modify any file and do NOT propose code patches. Reference character cards / worldbuilding / the book structure, and focus on the ${topicLabel} content the user is currently designing.`,
      );
    case "edit":
      return L(
        `你是一个${topicLabel}设计编辑助手。优先用 apply_change 工具直接修改正文或设定：给 file_path（章节相对路径）+ old_text（从 file_read 原文逐字复制的待替换片段，必须全文唯一）+ new_text。改动会登记进「改动」台账，用户在面板里逐条「保留 / 撤销」。重点围绕用户当前正在设计的${topicLabel}内容（人物塑造 / 设定自洽 / 情节结构）给出可落地的修改。`,
        `You are a ${topicLabel} design editor. PREFER the apply_change tool to edit prose or settings: pass file_path (chapter-relative), old_text (the exact snippet to replace, copied verbatim from file_read, must be unique), and new_text. Each change is recorded in the change ledger; the user reviews and Keeps or Undoes them. Focus on the ${topicLabel} content the user is designing (characterization / setting coherence / plot structure) and give actionable edits.`,
      );
    case "agent":
      return L(
        `你是一个${topicLabel}设计代理助手，可跨章节分析与修改。优先用 project_context 读取写作台上下文（人设卡 / 世界观设定 / 全书结构），用 file_read 读取真实正文，不要凭空猜测。重点围绕用户当前正在设计的${topicLabel}内容给出分析与修改。`,
        `You are an agentic ${topicLabel} design assistant that can analyze and edit across chapters. PREFER project_context to read the writing-desk context (character cards / worldbuilding / book structure), and file_read to read the real prose; never guess. Focus on the ${topicLabel} content the user is designing.`,
      );
  }
}

/** 各模式的系统/指令前缀（双语，随 UI 语言切换）。
 *  isBookScene=true 时切换为「小说写作助手」人设，不出现代码分析/构建/lint 等术语；
 *  进一步：bookTopic 命中（人物/世界观/大纲）时切换为对应题材的「设计助手」人设，随左栏 tab 切换。 */
export function modeInstruction(mode: WorkbenchMode, isBookScene = false, bookTopic?: "characters" | "worldview" | "catalog" | "timeline" | "storylines" | "foreshadowing" | "inspiration" | "proofread" | "stats" | "writing" | "overview" | null): string {
  if (isBookScene && bookTopic) return bookTopicRoleInstruction(mode, bookTopic);
  if (isBookScene) {
    switch (mode) {
      case "ask":
        return L(
          "你是一个小说写作助手。只回答、分析、给写作建议，不要修改任何文件，也不要输出代码补丁。可以对照人设卡、世界观设定与全书结构给出建议。",
          "You are a fiction-writing assistant. Only answer, analyze and give writing suggestions. Do NOT modify any file and do NOT propose code patches. You may reference character cards, worldbuilding and the book structure.",
        );
      case "edit":
        return L(
          "你是一个写作编辑助手。优先用 apply_change 工具直接修改正文：给 file_path（章节相对路径）+ old_text（从 file_read 原文逐字复制的待替换片段，必须全文唯一，不唯一就多带几行上下文）+ new_text（替换内容，留空即删除）。改动会登记进「改动」台账，用户在面板里逐条「保留 / 撤销」——改完自查返回的行号与上下文预览，确认改在了预期位置。\n" +
            "涉及多个章节就逐个调用 apply_change。绝不要输出整章全文（优先锚点补丁）。\n" +
            "只有当确实无法调用写盘工具时（无写权限），才退而用文本块给出改动让用户手动应用：替换某段用 ```语言 path:起始行-结束行，插入用 ```语言 path:行号，针对用户选区用 ```语言（无 path）。path 必须是章节相对路径，只给变动的行。",
          "You are a writing editor. PREFER the apply_change tool to edit the prose directly: pass file_path (chapter-relative), old_text (the exact snippet to replace, copied verbatim from file_read, must be unique — include surrounding lines if not), and new_text (replacement; empty string deletes it). Each change is recorded in the change ledger; the user reviews and Keeps or Undoes them per chapter in the panel. After editing, check the returned line range and context preview to confirm the edit landed where intended.\n" +
            "Edit multiple chapters with one apply_change call each. Never emit the whole chapter (prefer anchored patches).\n" +
            "ONLY if you genuinely cannot call the write tool (no write permission), fall back to presenting the edit as a text block for manual apply: replace with ```lang path:startLine-endLine, insert with ```lang path:line, or for the user's selection use ```lang (no path). path must be the chapter-relative path; give only the changed lines.",
        );
      case "agent":
        return L(
          "你是一个写作代理助手，可跨章节分析与修改。优先用 project_context 读取写作台上下文（人设卡 / 世界观设定 / 全书结构），用 file_read 读取真实正文，不要凭空猜测。改动用文本块给出，由用户确认后应用：替换用 ```语言 path:起始行-结束行，插入用 ```语言 path:行号，针对用户选区则 ```语言（无 path）。",
          "You are an agentic writing assistant that can analyze and edit across chapters. PREFER project_context to read the writing-desk context (character cards / worldbuilding / book structure), and file_read to read the real prose; never guess. Present edits as text blocks for the user to review and apply: replace with ```lang path:startLine-endLine, insert with ```lang path:line, or for the user's selection use ```lang (no path).",
        );
    }
  }
  switch (mode) {
    case "ask":
      return L(
        "你是一个项目代码分析助手。只回答、解释、分析，不要修改任何文件，也不要提出代码补丁。",
        "You are a code-analysis assistant. Only answer, explain and analyze. Do NOT modify any file and do NOT propose code patches.",
      );
    case "edit":
      return L(
        "你是一个编辑助手。优先用 apply_change 工具直接修改文件：给 file_path（项目相对路径）+ old_text（从 file_read 原文逐字复制的待替换片段，必须全文唯一，不唯一就多带几行上下文）+ new_text（替换内容，留空即删除）。改动会登记进「改动」台账，用户在面板里逐条「保留 / 撤销」——你改完应自查返回的行号与上下文预览，确认改在了预期位置。\n" +
          "涉及多个文件就逐个调用 apply_change。绝不要输出整文件全文（小文件整写用 content 兜底，但优先锚点补丁）。\n" +
          "只有当确实无法调用写盘工具时（无写权限），才退而用代码块给出补丁让用户手动应用：替换某段用 ```语言 path:起始行-结束行，插入用 ```语言 path:行号，针对用户选区用 ```语言（无 path）。path 必须是项目相对路径，只给变动的行。",
        "You are an editing assistant. PREFER the apply_change tool to edit files directly: pass file_path (project-relative), old_text (the exact snippet to replace, copied verbatim from file_read, must be unique — include surrounding lines if not), and new_text (replacement; empty string deletes it). Each change is recorded in the change ledger; the user reviews and Keeps or Undoes them per file in the panel. After editing, check the returned line range and context preview to confirm the edit landed where intended.\n" +
          "Edit multiple files with one apply_change call each. Never emit the whole file (whole-file rewrite via the content param is only a fallback; prefer anchored patches).\n" +
          "ONLY if you genuinely cannot call the write tool (no write permission), fall back to presenting patches as code blocks for manual apply: replace with ```lang path:startLine-endLine, insert with ```lang path:line, or for the user's selection use ```lang (no path). path must be the project-relative path; give only the changed lines.",
      );
    case "agent":
      return L(
        "你是一个代理助手，可跨文件分析与修改。若助手已授权 run_command 工具，你可运行终端命令（构建/测试/ lint / 格式化）来验证改动是否真的通过，再据此迭代；命令必须在项目目录内、避免 sudo 与管道给 shell。改动用代码块给出，由用户确认后应用：替换用 ```语言 path:起始行-结束行，插入用 ```语言 path:行号，针对用户选区则 ```语言（无 path）。优先用 project_context / scan_records 读取真实代码与扫描事实，不要凭空猜测。",
        "You are an agentic assistant that can analyze and edit across files. If the run_command tool is granted, run terminal commands (build/test/lint/format) to verify your edits actually pass, then iterate; commands must stay inside the project directory and avoid sudo or pipe-to-shell. Present edits as code blocks for the user to review and apply: replace with ```lang path:startLine-endLine, insert with ```lang path:line, or for the user's selection use ```lang (no path). Prefer project_context / scan_records to read the real code and scan facts; never guess.",
      );
  }
}

/**
 * 把当前上下文格式化为一段注入 prompt 正文的「上下文」区块。
 * 位置：放在用户问题之后、模型作答之前；事实只放摘要，细节让模型用 scan_records 下钻。
 */
export function buildContextBlock(ctx: WorkbenchContext, isBookScene = false): string {
  const lines: string[] = [];
  // 书场景：把当前书 + 题材 + 聚焦设定灌进上下文，让 AI 自动带上业务背景（与右栏要素/详情两栏口径一致）。
  if (isBookScene && (ctx.bookTitle || ctx.bookTopic || ctx.focusSetting)) {
    const topicLabel =
      ctx.bookTopic === "characters" ? L("人物", "characters")
        : ctx.bookTopic === "worldview" ? L("世界观", "worldbuilding")
        :       ctx.bookTopic === "catalog" ? L("大纲", "outline")
        : ctx.bookTopic === "timeline" ? L("时间线", "timeline")
        : ctx.bookTopic === "storylines" ? L("剧情线", "storylines")
        : ctx.bookTopic === "foreshadowing" ? L("伏笔", "foreshadowing")
        : ctx.bookTopic === "inspiration" ? L("灵感", "ideas")
        : ctx.bookTopic === "proofread" ? L("校对", "proofread")
        : ctx.bookTopic === "stats" ? L("统计", "stats")
        : ctx.bookTopic === "writing" ? L("正文写作", "manuscript")
        : ctx.bookTopic === "overview" ? L("全书总览", "whole-book overview")
        : null;
    const parts: string[] = [];
    if (ctx.bookTitle) parts.push(L(`书《${ctx.bookTitle}》`, `book "${ctx.bookTitle}"`));
    if (topicLabel) parts.push(L(`当前题材：${topicLabel}`, `current topic: ${topicLabel}`));
    if (ctx.focusSetting) {
      parts.push(
        L(
          `聚焦：${ctx.focusSetting.name}（${ctx.focusSetting.kind === "character" ? "人物" : "世界观"}）`,
          `focus: ${ctx.focusSetting.name} (${ctx.focusSetting.kind === "character" ? "character" : "worldbuilding"})`,
        ),
      );
    }
    if (parts.length > 0) lines.push(L(`- 创作上下文：${parts.join(" · ")}`, `- Creative context: ${parts.join(" · ")}`));
  }
  // 题材语料：世界观=设定库、时间线=时间线档案，直接灌进上下文，AI 每轮都带真实数据作答。
  // characters=人物卡、catalog=大纲骨架、writing=正文语料 等同理（补齐此前零语料视图）。
  if ((ctx.bookTopic === "worldview" || ctx.bookTopic === "timeline" || ctx.bookTopic === "storylines" || ctx.bookTopic === "foreshadowing" || ctx.bookTopic === "inspiration" || ctx.bookTopic === "proofread" || ctx.bookTopic === "stats" || ctx.bookTopic === "writing" || ctx.bookTopic === "characters" || ctx.bookTopic === "catalog") && ctx.bookSettingCorpus) {
    lines.push(L(ctx.bookSettingCorpus.zh, ctx.bookSettingCorpus.en));
  }
  // 全书总览语料：对所有书题材注入（含 characters/catalog 等当前无题材语料的视图），
  // 让 AI 始终带全书跨维度快照，避免「只见一隅不知全貌」。
  if (isBookScene && ctx.bookOverviewCorpus) {
    lines.push(L(ctx.bookOverviewCorpus.zh, ctx.bookOverviewCorpus.en));
  }
  // 聚焦设定语料：右栏钻入某个具体人物/世界观设定时，把该设定完整档案灌进上下文，
  // 让 AI 围绕这一个设定作答（排在全书总览之后，最具体者最后，语义优先级最高）。
  if (isBookScene && ctx.focusSettingCorpus) {
    lines.push(L(ctx.focusSettingCorpus.zh, ctx.focusSettingCorpus.en));
  }
  if (ctx.activeFile) {
    const f = ctx.activeFile;
    const loc = f.totalLines ? L(`（${f.language ?? "未知"}，${f.totalLines} 行）`, `(${f.language ?? "unknown"}, ${f.totalLines} lines)`) : `（${f.language ?? "未知"}）`;
    lines.push(L(`- 当前文件：${f.relPath} ${loc}`, `- Active file: ${f.relPath} ${loc}`));
  }
  if (ctx.selection?.text) {
    const s = ctx.selection;
    const ref = `${ctx.activeFile?.relPath ?? "?"}:${s.startLine}-${s.endLine}`;
    lines.push(L(`- 选区：${ref}`, `- Selection: ${ref}`));
    lines.push("```" + (ctx.activeFile?.language ?? "") + "\n" + s.text + "\n```");
  }
  for (const a of ctx.attachments) {
    if (a.kind === "file") {
      lines.push(L(`- 附件文件：${a.refPath}`, `- Attached file: ${a.refPath}`));
    } else {
      const at = a.line ? `${a.refPath}:${a.line}` : a.refPath;
      lines.push(L(`- 附件符号：${a.symbolName}（${at}）`, `- Attached symbol: ${a.symbolName} (${at})`));
    }
  }
  const facts = ctx.facts;
  if (facts && (facts.cc != null || facts.debt != null || facts.deadCount != null || facts.cloneGroups != null || facts.referencedBy != null)) {
    const parts: string[] = [];
    if (facts.cc != null) parts.push(L(`复杂度 ${facts.cc}`, `complexity ${facts.cc}`));
    if (facts.debt != null) parts.push(L(`技术债 ${facts.debt}`, `tech-debt ${facts.debt}`));
    if (facts.deadCount != null) parts.push(L(`死代码 ${facts.deadCount}`, `dead code ${facts.deadCount}`));
    if (facts.cloneGroups != null) parts.push(L(`克隆组 ${facts.cloneGroups}`, `clone groups ${facts.cloneGroups}`));
    if (facts.referencedBy != null) parts.push(L(`被引 ${facts.referencedBy}`, `referenced by ${facts.referencedBy}`));
    lines.push(L(`- 本文件扫描事实：${parts.join(" · ")}`, `- Scan facts of this file: ${parts.join(" · ")}`));
  }
  if (lines.length === 0) return "";
  if (isBookScene) {
    // 世界观题材：设定库已内联进 [上下文]，无需再让模型去 project_context 重读世界观；只提示可用 file_read 对照真实正文。
    const footerZh =
      ctx.bookTopic === "worldview"
        ? "上面的[上下文]已包含当前书的「世界观设定库」（世界观设定 + 人物卡 + 关系），直接基于它作答；如需对照真实正文，用 file_read 读取对应章节，不要凭空猜测。\n"
        : ctx.bookTopic === "timeline" || ctx.bookTopic === "storylines"
        ? "上面的[上下文]已包含当前书的「时间线档案」（章节骨架 + 剧情线 + 事件全表 + 冲突 + 待补全草稿），直接基于它作答；时点以作者原文为准（自由文本，混合尺度是正当创作，不要强行换算成日期）；如需对照真实正文，用 file_read 读取对应章节，不要凭空猜测。\n"
        : ctx.bookTopic === "foreshadowing"
        ? "上面的[上下文]已包含当前书的「伏笔档案」（埋设/回收承诺 + 状态 + 跨章预警），直接基于它作答；预警仅为规划提示；如需对照真实正文，用 file_read 读取对应章节，不要凭空猜测。\n"
        : ctx.bookTopic === "inspiration"
        ? "上面的[上下文]已包含当前书的「灵感念头池」（未落章节拍 + 分发状态），直接基于它作答；标记〔已入…〕的念头不要重复建议，脑暴时尊重已有念头的语气与题材；如需对照真实正文，用 file_read 读取对应章节，不要凭空猜测。\n"
        : ctx.bookTopic === "proofread"
        ? "上面的[上下文]已包含当前书的「校对体检报告」（章文本/章账/伏笔/时间线/剧情线/念头池六组发现），直接基于它作答；体检是本地派生软提示，错别字与连贯性等语义层问题请用 file_read 逐章细读后再下结论，不要凭空猜测。\n"
        : ctx.bookTopic === "stats"
        ? "上面的[上下文]已包含当前书的「写作统计」（体量 KPI + 卷分布 + 章节体量离群），直接基于它作答；离群与节奏建议是 advisory 软提示，尊重创作者意图，不要催更施压，不要凭空猜测。\n"
        : ctx.bookTopic === "writing"
        ? "上面的[上下文]已包含当前书的「正文写作语料」（章节骨架 + 当前章全文 + 前情提要），直接基于它作答；续写衔接上文语气与节奏，改写建议给理由不整章重写，不要凭空猜测。\n"
        : ctx.bookTopic === "characters"
        ? "上面的[上下文]已包含当前书的「人物卡」（姓名 + 副标题 + 外貌/性格/动机/口头禅 + 关系），直接基于它作答；先读这些已有角色再给设计建议，不要凭空捏造人设；如需对照真实正文，用 file_read 读取对应章节。\n"
        : ctx.bookTopic === "catalog"
        ? "上面的[上下文]已包含当前书的「大纲骨架」（卷 → 章节结构 + 字数 + 状态 + 未落章节拍），直接基于它作答；规划分卷分章或节拍时以此为准，不要凭空编造章节；如需对照真实正文，用 file_read 读取对应章节。\n"
        : ctx.bookTopic === "overview"
        ? "上面的[上下文]已包含当前书的「全书总览」跨维度快照（体量 KPI + 人物 / 世界观 / 时间线 / 剧情线 / 伏笔 / 灵感 / 校对 / 日更趋势 + 风险预警）。你是本书的全书统筹助手：据此整体评估健康度、风险优先级与叙事连续性（时间线冲突 / 跨章伏笔 / 孤立设定 / 未落章节拍 / 校对问题），并给出可执行处置建议；需要具体章节细节时用 file_read 对照真实正文后再下结论，不要凭空猜测。\n"
        : "先通过 project_context 读取写作台上下文（人设卡 / 世界观设定 / 全书结构），用 file_read 读取真实正文，不要凭空猜测。\n";
    const footerEn =
      ctx.bookTopic === "worldview"
        ? "The [Context] above already contains the book's worldbuilding bible (worldbuilding + character cards + relations); answer directly from it. To cross-check the real prose, read the relevant chapter via file_read. Do not guess.\n"
        : ctx.bookTopic === "timeline" || ctx.bookTopic === "storylines"
        ? "The [Context] above already contains the book's timeline dossier (chapter skeleton + storylines + full event list + conflicts + drafts); answer directly from it. Treat the \"when\" values as the author's verbatim text (free-form; mixed scales are legitimate creative choices — do not force-convert them into dates). To cross-check the real prose, read the relevant chapter via file_read. Do not guess.\n"
        : ctx.bookTopic === "foreshadowing"
        ? "The [Context] above already contains the book's foreshadowing dossier (plant/payoff promises + status + overdue warnings); answer directly from it. Warnings are planning hints. To cross-check the real prose, read the relevant chapter via file_read. Do not guess.\n"
        : ctx.bookTopic === "inspiration"
        ? "The [Context] above already contains the book's idea pool (unanchored beats + dispatch state); answer directly from it. Do not re-suggest ideas already marked [in …], and respect the tone and genre of existing ideas. To cross-check the real prose, read the relevant chapter via file_read. Do not guess.\n"
        : ctx.bookTopic === "proofread"
        ? "The [Context] above already contains the book's proofread report (findings across chapter text / chapter account / foreshadowing / timeline / storylines / idea pool); answer directly from it. Findings are locally derived soft hints; for typos and coherence read the chapters via file_read before concluding. Do not guess.\n"
        : ctx.bookTopic === "stats"
        ? "The [Context] above already contains the book's writing stats (size KPIs + volume distribution + chapter-size outliers); answer directly from it. Outlier and pacing suggestions are advisory soft hints — respect the creator's intent, never nag about quotas. Do not guess.\n"
        : ctx.bookTopic === "writing"
        ? "The [Context] above already contains the book's manuscript corpus (chapter skeleton + current chapter full text + previously-summary); answer directly from it. Continue in the existing voice and pacing; give reasons for revision suggestions instead of rewriting whole chapters. Do not guess.\n"
        : ctx.bookTopic === "characters"
        ? "The [Context] above already contains the book's character cards (name + subtitle + appearance/personality/motivation/catchphrase + relations); answer directly from it. Read these existing characters before suggesting design changes — do not invent personas from nothing. To cross-check the real prose, read the relevant chapter via file_read. Do not guess.\n"
        : ctx.bookTopic === "catalog"
        ? "The [Context] above already contains the book's outline skeleton (volumes → chapter structure + word counts + status + unanchored beats); answer directly from it. Plan volumes/chapters/beats against it — do not invent chapters. To cross-check the real prose, read the relevant chapter via file_read. Do not guess.\n"
        : ctx.bookTopic === "overview"
        ? "The [Context] above already contains the book's [Book Overview] cross-dimension snapshot (size KPIs + characters / worldbuilding / timeline / storylines / foreshadowing / ideas / proofread / daily trend + risk warnings). You are the book's whole-book strategist: assess overall health, risk priority and narrative continuity (timeline conflicts / cross-chapter foreshadowing / orphan settings / unanchored beats / proofread issues) and give actionable fixes. For chapter-level specifics, read the real prose via file_read before concluding. Do not guess.\n"
        : "First read the writing-desk context (character cards / worldbuilding / book structure) via project_context, and the real prose via file_read. Do not guess.\n";
    const overviewNoteZh = ctx.bookOverviewCorpus ? "（需要时也可据上面的「全书总览」跨维度快照，整体评估本书健康度与风险。）" : "";
    const overviewNoteEn = ctx.bookOverviewCorpus ? " (When useful, also reason about the book's overall health and risks from the [Book Overview] cross-dimension snapshot above.)" : "";
    return L(
      "[上下文]\n" + lines.join("\n") + "\n\n" + footerZh + overviewNoteZh,
      "[Context]\n" + lines.join("\n") + "\n\n" + footerEn + overviewNoteEn,
    );
  }
  return L(
        "[上下文]\n" + lines.join("\n") + "\n\n先通过 project_context / scan_records 读取真实代码与扫描台账，不要凭空猜测。\n",
        "[Context]\n" + lines.join("\n") + "\n\nFirst read the real code and scan facts via project_context / scan_records. Do not guess.\n",
      );
}

/** 把画布作用域（含分析事实）格式化为一段注入 prompt 的「作用域」区块（VS Code 没有的能力） */
export function buildScopeBlock(scope: WorkbenchContextScope | null | undefined, isBookScene = false): string {
  if (!scope) return "";
  const f = scope.facts;
  const parts: string[] = [];
  if (f.cc != null) parts.push(L(`复杂度 ${f.cc}`, `complexity ${f.cc}`));
  if (f.deadCount != null) parts.push(L(`死代码 ${f.deadCount}`, `dead code ${f.deadCount}`));
  if (f.cloneGroups != null) parts.push(L(`克隆组 ${f.cloneGroups}`, `clone groups ${f.cloneGroups}`));
  if (f.findings != null) parts.push(L(`审查发现 ${f.findings}`, `review findings ${f.findings}`));
  const factLine = parts.length > 0 ? L(`（分析事实：${parts.join(" · ")}）`, `(scan facts: ${parts.join(" · ")})`) : "";
  // 作用域级影响面：把「改这个实体会波及哪些文件」直接喂给模型，让它带着爆炸半径作答。
  const impactLine =
    scope.impact && scope.impact.length > 0
      ? L(
          `（影响面：${scope.impact.length} 个文件可能受波及：${scope.impact.slice(0, 12).map((f) => f.relPath).join("、")}${scope.impact.length > 12 ? "…" : ""}）`,
          `(impact surface: changes may ripple to ${scope.impact.length} files: ${scope.impact.slice(0, 12).map((f) => f.relPath).join(", ")}${scope.impact.length > 12 ? "…" : ""})`,
        )
      : "";
  return isBookScene
    ? L(
        `[创作作用域]\n- 用户正在画布上查看实体「${scope.label}」（${scope.relPath}）${factLine ? " " + factLine : ""}${impactLine ? " " + impactLine : ""}\n- 请以此作用域为优先作答背景：涉及该角色 / 章节的情节、人设或设定时，先依据上面的创作上下文判断，而不是只看编辑器当前打开的文件。\n`,
        `[Creative scope]\n- The user is currently viewing entity "${scope.label}" (${scope.relPath}) on the canvas${factLine ? " " + factLine : ""}${impactLine ? " " + impactLine : ""}\n- Treat this scope as the priority context: when discussing plot, character or setting related to it, reason from the creative context above rather than only the file open in the editor.\n`,
      )
    : L(
        `[画布作用域]\n- 用户正在画布上查看实体「${scope.label}」（${scope.relPath}）${factLine ? " " + factLine : ""}${impactLine ? " " + impactLine : ""}\n- 请以此作用域为优先作答背景：涉及该实体相关逻辑、改动影响或重构时，先依据上面的分析事实判断，而不是只看编辑器当前打开的文件。\n`,
        `[Canvas scope]\n- The user is currently viewing entity "${scope.label}" (${scope.relPath}) on the canvas${factLine ? " " + factLine : ""}${impactLine ? " " + impactLine : ""}\n- Treat this scope as the priority context: when discussing logic, change impact or refactoring related to it, reason from the scan facts above rather than only the file open in the editor.\n`,
      );
}

/** 工作区区块（对标 VS Code 的 @workspace）：告诉模型它拥有整个工作区的访问权限，用 workspace 级工具主动跨文件调查。
 *  项目自身目录默认就在上下文里（导入项目即默认可用），故该区块始终注入，无需用户手动切 @workspace participant。
 *  复用后端既有的 code_search / project_context / scan_records / symbol_lookup / file_read（均为跨文件/跨项目规模，零后端改动）。 */
export function buildParticipantBlock(workspace?: WorkspaceFacts, isBookScene = false): string {
  const parts: string[] = [];
  if (workspace && workspace.fileCount > 0) {
    const langLine =
      workspace.languages.length > 0
        ? L(
            `语言分布：${workspace.languages.map((l) => `${l.name} ${l.count}`).join("、")}`,
            `Languages: ${workspace.languages.map((l) => `${l.name} ${l.count}`).join(", ")}`,
          )
        : "";
    const dirLine =
      workspace.topDirs.length > 0
        ? L(
            `主要目录：${workspace.topDirs.map((d) => `${d.path} (${d.count})`).join("、")}`,
            `Top directories: ${workspace.topDirs.map((d) => `${d.path} (${d.count})`).join(", ")}`,
          )
        : "";
    parts.push(
      L(
        `- 工作区概览：${workspace.fileCount} 个文件${langLine ? "，" + langLine : ""}`,
        `- Workspace overview: ${workspace.fileCount} files${langLine ? ", " + langLine : ""}`,
      ),
    );
    if (dirLine) parts.push(dirLine);
  }
  parts.push(
    isBookScene
      ? L(
          "- 你拥有整本书的访问权限：用 project_context（写作台上下文：人设卡 / 世界观设定 / 全书结构）/ file_read（读取真实正文）/ 主动调查相关章节，必要时读取多个章节再作答。引用具体章节与行号作为证据，不要只停留在当前打开的章节。",
          "- You have access to the whole book: use project_context (writing-desk context: character cards / worldbuilding / book structure) / file_read (read the real prose) to actively investigate relevant chapters, reading multiple chapters if needed. Cite specific chapters and line numbers as evidence and do not limit yourself to the open chapter.",
        )
      : L(
          "- 你拥有整个工作区的访问权限：用 code_search（跨文件检索）/ project_context（项目结构与扫描台账）/ scan_records（Top-N 下钻）/ symbol_lookup / file_read 主动调查相关文件，必要时读取多个文件再作答。回答中引用「file:line」证据，不要只停留在当前打开的文件。",
          "- You have access to the whole workspace: use code_search (cross-file search) / project_context (project structure & scan facts) / scan_records (Top-N drill-down) / symbol_lookup / file_read to actively investigate relevant files, reading multiple files if needed. Cite \"file:line\" evidence and do not limit yourself to the open file.",
        ),
  );
  return L("[Workspace]\n" + parts.join("\n") + "\n", "[Workspace]\n" + parts.join("\n") + "\n");
}

/** 终端区块（对标传统 IDE 的终端 participant）：当助手具备 run_command 能力（且处于 agent 模式，run_command 才在工具白名单内）时，
 *  告诉模型主动运行构建 / 测试 / lint 等命令验证改动，并把命令与输出（含退出码）完整展示在对话里，
 *  让用户像在 IDE 的 Agent 模式一样当场看到验证结果。若助手未启用 run_command，则不注入本区块（模型不会假装能跑）。 */
export function buildTerminalParticipantBlock(hasRunCommand: boolean): string {
  if (!hasRunCommand) return "";
  const parts = [
    L(
      "- 你拥有终端能力（run_command 工具，若已授权）。遇到需要验证的改动，主动运行对应命令（如 build / test / lint / format），并把「命令 + 输出 + 退出码」完整展示给我，让我在对话里就能看到验证结果。命令必须在项目目录内、避免 sudo 与管道给 shell（pipe-to-shell RCE），超时上限由运行时控制。",
      "- You have terminal access (the run_command tool, if granted). When a change needs verification, proactively run the relevant command (build / test / lint / format) and show me the full \"command + output + exit code\" so I can see the verification right in the chat. Commands must stay inside the project directory and avoid sudo or pipe-to-shell (pipe-to-shell RCE); a runtime-enforced timeout applies.",
    ),
    L(
      "- 若你实际拿不到 run_command 工具（调用被拒或不存在），不要假装执行：明确告诉我「请在助手设置里启用 run_command 后重试」，并给出我可以手动运行的命令。",
      "- If you genuinely cannot access run_command (the call is refused or the tool is absent), do NOT pretend to run it: tell me explicitly to \"enable run_command in the agent settings and retry\", and give me the command I can run manually.",
    ),
  ];
  return L("[Terminal]\n" + parts.join("\n") + "\n", "[Terminal]\n" + parts.join("\n") + "\n");
}

/** 把当前文件的实时诊断格式化为一段注入 prompt 的「诊断」区块（VS Code 式「修复此错误」：模型始终知道活代码的真实报错） */
export function buildDiagnosticsBlock(diags?: WorkbenchContextDiagnostic[] | null, isBookScene = false): string {
  if (!diags || diags.length === 0) return "";
  const lines = diags.map((d) =>
    L(
      `- L${d.line} [${d.severity === "error" ? "错误" : "警告"}${d.source ? ` · ${d.source}${d.code ? " " + d.code : ""}` : ""}] ${d.message}`,
      `- L${d.line} [${d.severity === "error" ? "error" : "warning"}${d.source ? ` · ${d.source}${d.code ? " " + d.code : ""}` : ""}] ${d.message}`,
    ),
  );
  return isBookScene
    ? L(
        "[当前章节批注]\n" + lines.join("\n") + "\n\n优先处理「错误」级批注；修改前先通过 file_read 读取真实正文确认上下文，不要凭空猜测。\n",
        "[Current chapter annotations]\n" + lines.join("\n") + "\n\nAddress error-level annotations first; read the real prose via file_read before editing, do not guess.\n",
      )
    : L(
        "[当前文件诊断]\n" + lines.join("\n") + "\n\n优先修复「错误」级诊断；修改前先通过 file_read / project_context 读取真实代码确认上下文，不要凭空猜测。\n",
        "[Current file diagnostics]\n" + lines.join("\n") + "\n\nFix error-level diagnostics first; read the real code via file_read / project_context before editing, do not guess.\n",
      );
}

/** 组装最终发给模型的用户消息 */
export function buildUserMessage(ctx: WorkbenchContext, userText: string, isBookScene = false): string {
  const ctxBlock = buildContextBlock(ctx, isBookScene);
  const scopeBlock = buildScopeBlock(ctx.scope, isBookScene);
  const participantBlock = buildParticipantBlock(ctx.workspace, isBookScene);
  const terminalBlock = buildTerminalParticipantBlock(!!ctx.hasRunCommand && ctx.mode === "agent" && !isBookScene);
  const diagBlock = buildDiagnosticsBlock(ctx.diagnostics, isBookScene);
  const head = modeInstruction(ctx.mode, isBookScene, ctx.bookTopic);
  return [head, "", participantBlock, terminalBlock, userText, "", ctxBlock, scopeBlock, diagBlock].filter(Boolean).join("\n").trim() + "\n";
}

// ─── 用户消息的「人读视图」（与上面的组装器成对，改了组装格式必须同步改这里）───

/** 尾部区块的起始标记（这些区块一律排在用户问题**之后**，故命中即可截断） */
const TAIL_MARKERS = ["[上下文]", "[Context]", "[画布作用域]", "[Canvas scope]"];
/** 模式指令的开头签名（双语）：用来判定首段是不是机器指令，而不是用户自己打的字 */
const MODE_HEAD_SIGNATURES = ["你是一个", "You are a"];

/** 区块标记 → 气泡上显示的徽标文案键（i18n `workbench.aiUserMsg.tag*`） */
export type UserMessageTag = "mode" | "workspace" | "terminal" | "context" | "scope";

export interface UserMessageView {
  /** 用户真正键入的问题；提取不确定时退回完整原文（永不丢内容） */
  text: string;
  /** 被折叠掉的区块，按出现顺序（气泡上显示为小徽标，让用户知道这轮带了什么上下文） */
  tags: UserMessageTag[];
  /** 是否确实折叠了包装（false = 原文没有包装，气泡按原样显示，等同旧行为） */
  wrapped: boolean;
}

/**
 * 把「发给模型的完整提示词」还原成「用户看到的那句话」。
 *
 * 为什么需要：`buildUserMessage` 会把模式指令（edit 模式光指令就 ~500 字）、[Workspace] 概览、
 * [上下文]、[画布作用域] 全部拼进用户消息，而落库与转录渲染用的都是这一份完整正文 ——
 * 结果用户自己那句「解释这个函数」每轮都被埋在一大坨机器提示词里，转录基本没法读。
 * VS Code 的做法是：气泡里只显示你打的那句话，上下文另作小附件芯片展示。本函数即此视图层。
 *
 * 稳健性优先：解析基于本文件自己的拼装顺序（head → 空行 → [Workspace] → 问题 → 空行 → 尾部区块），
 * 任何一步对不上就整体退回原文（`wrapped: false`），最坏情况等于改动前的行为，绝不吞用户内容。
 */
export function extractUserMessageView(raw: string): UserMessageView {
  const fallback: UserMessageView = { text: raw, tags: [], wrapped: false };
  if (!raw) return fallback;

  const lines = raw.split("\n");
  const tags: UserMessageTag[] = [];
  let start = 0;
  let end = lines.length;

  // 1) 模式指令：首行以双语签名开头才算，取到第一个空行为止（指令内部不含空行）
  if (MODE_HEAD_SIGNATURES.some((sig) => lines[0]?.startsWith(sig))) {
    let i = 0;
    while (i < lines.length && lines[i].trim() !== "") i += 1;
    start = i + 1;
    tags.push("mode");
  }

  // 2) [Workspace] / [Terminal] 区块：紧随其后，可能连续出现（工作区默认注入；助手具备 run_command 时终端也注入）。
  //    逐个消费所有连续的头部区块，各自登记徽标。
  while (start < lines.length && lines[start].trim() === "") start += 1;
  while (start < lines.length) {
    const headMarker = lines[start]?.trim();
    if (headMarker === "[Workspace]" || headMarker === "[Terminal]") {
      let i = start;
      while (i < lines.length && lines[i].trim() !== "") i += 1;
      start = i + 1;
      tags.push(headMarker === "[Terminal]" ? "terminal" : "workspace");
      while (start < lines.length && lines[start].trim() === "") start += 1;
    } else {
      break;
    }
  }

  // 3) 尾部区块：从第一个命中的标记处截断（[上下文] 必在 [画布作用域] 之前，但只需最靠前那个）
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (TAIL_MARKERS.includes(line)) {
      end = i;
      break;
    }
  }
  // 尾部两种区块各自登记徽标（截断点之后的原文里找，顺序即拼装顺序）
  const tail = lines.slice(end).map((l) => l.trim());
  if (tail.includes("[上下文]") || tail.includes("[Context]")) tags.push("context");
  if (tail.includes("[画布作用域]") || tail.includes("[Canvas scope]")) tags.push("scope");

  const text = lines.slice(start, end).join("\n").trim();
  // 什么都没折叠 → 保持原样；折叠后为空（异常提示词）→ 退回原文，绝不显示空气泡
  if (tags.length === 0) return fallback;
  if (!text) return fallback;
  return { text, tags, wrapped: true };
}
