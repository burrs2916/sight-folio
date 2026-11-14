// sight-folio: 工作台斜杠命令（对标 VS Code Copilot Chat 的命令式交互）
//
// 设计原则：斜杠命令是「动作」，不是「模板预填」。
//  - 输入 /fix → 自动吃当前文件真实诊断、强制 edit 模式、用 apply_change 真实改盘。
//  - 命令决定模式与上下文（selection 内联还是由 send 注入），而非让用户自己配。
//  - 命令清单用 getter 返回（L() 在调用期求值），避免模块级 const 固化语言（历史 i18n 教训 ×3）。
//
// 与既有架构的关系：
//  - buildText 产出的正文交给 WorkbenchAiPanel.send，send 仍按模式下发工具白名单 + 自动注入
//    当前文件/选区/附件/画布作用域/实时诊断——命令只负责「意图 → 正文 + 强制模式」。

import { L } from "../../ai/aiLang";
import { workbenchCommandSet } from "../../utils/writingSchema";
import type { WorkbenchMode } from "./workbenchContext";
import type { EditorSelectionInfo } from "./MonacoCodeEditor";
import type { EditorDiagnostic } from "../../store/editorDiagnosticsStore";

export interface SlashCommandContext {
  activeFile: { relPath: string; language: string | null } | null;
  selection: EditorSelectionInfo | null;
  diagnostics: EditorDiagnostic[];
}

export interface WorkbenchSlashCommand {
  cmd: string;
  /** 调用期求值（i18n 安全） */
  label: () => string;
  description: () => string;
  /** 该命令强制的模式（覆盖面板当前模式，并驱动对应的单次工具白名单） */
  mode: WorkbenchMode;
  /** 命令正文自己内联了选区代码时，send 不再二次注入选区（避免模型看到两份重复代码） */
  embedSelection?: boolean;
  /** 把「用户键入的 /cmd 之后的文本」+ 上下文折叠成发给模型的提示词 */
  buildText: (args: string, ctx: SlashCommandContext) => string;
}

const refOf = (ctx: SlashCommandContext, sel: EditorSelectionInfo): string =>
  sel ? `${ctx.activeFile!.relPath}:${sel.startLine}-${sel.endLine}` : ctx.activeFile!.relPath;

/** 调用期返回完整命令清单（L() 在每次调用时按当前 UI 语言求值，切换语言即时刷新）。
 *  书场景（novel-zh）与代码场景返回不同清单：书场景没有「当前文件 / 诊断」，代码命令（fix/explain/…）
 *  无意义，换成写作域命令（全书体检 / 连续性审查 / 人物 / 伏笔 / 时间线 / 脑暴），直接吃注入的全书语料与题材语料。 */
export function getSlashCommands(isBookScene?: boolean, genre?: string): WorkbenchSlashCommand[] {
  // 写作域命令（书场景专用）：仅诊断、不直接改稿（mode=ask），尊重创作者主权（advisory 软提示）。
  const bookCommands: WorkbenchSlashCommand[] = [
    {
      cmd: "体检",
      label: () => L("全书体检", "Health check"),
      description: () => L("基于全书总览快照，整体评估健康度与风险优先级", "Assess whole-book health and risk priority from the overview snapshot"),
      mode: "ask",
      buildText: (args) => {
        const focus = args ? L(`额外关注：${args}`, `Focus: ${args}`) : "";
        return L(
          `基于上面的全书总览，给我一份全书健康度体检${focus ? "（" + focus + "）" : ""}：① 体量进度与叙事节奏是否健康；② 各维度（人物/世界观/时间线/剧情线/伏笔/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿。`,
          `Based on the book overview above, give me a health check${focus ? " (" + focus + ")" : ""}: ① is size/progress/pacing healthy; ② the state of each dimension and which to prioritise; ③ the 3 most urgent risks, each with a one-line fix. Diagnose only, don't rewrite.`,
        );
      },
    },
    {
      cmd: "连续性",
      label: () => L("连续性审查", "Continuity audit"),
      description: () => L("跨章审查时间线冲突、伏笔回收与人物一致性", "Audit cross-chapter timeline conflicts, foreshadowing payoff and character consistency"),
      mode: "ask",
      buildText: (args) => {
        const focus = args ? L(`额外关注：${args}`, `Focus: ${args}`) : "";
        return L(
          `做一份全书叙事连续性审查${focus ? "（" + focus + "）" : ""}：① 时间线同轨冲突与跨章时间倒挂；② 伏笔埋设与回收是否对得上、有无长期未回收的悬空伏笔；③ 主要人物是否出现性格/动机矛盾或行为 OOC；④ 各章骨架衔接是否断裂。逐条给出证据（章节/事件）与修法；需要细节时用 file_read 对照真实正文。`,
          `Run a whole-book narrative-continuity audit${focus ? " (" + focus + ")" : ""}: ① same-track timeline conflicts and cross-chapter inversions; ② foreshadowing plants vs payoffs, any long-unpaid floating plants; ③ character personality/motivation contradictions or OOC; ④ chapter-skeleton hand-offs that break. Cite evidence (chapter/event) and fixes; use file_read for specifics.`,
        );
      },
    },
    {
      cmd: "人物",
      label: () => L("人物关系", "Characters"),
      description: () => L("梳理人物关系网、冲突与一致性问题", "Map character relationships, conflicts and consistency issues"),
      mode: "ask",
      buildText: (args) => {
        const focus = args ? L(`重点关注：${args}`, `Focus: ${args}`) : "";
        return L(
          `基于上面注入的人设卡与全书总览，梳理本书的人物关系网${focus ? "（" + focus + "）" : ""}：① 每位主要角色的动机、羁绊与潜在冲突；② 是否出现性格/动机矛盾或行为 OOC；③ 给出 2-3 处可强化的人物弧光建议。先读已有角色再给建议，不要凭空捏造人设；需要细节时用 file_read 对照真实正文。`,
          `From the injected character cards and book overview, map the relationship network${focus ? " (" + focus + ")" : ""}: ① each main character's motivation, bonds and potential conflicts; ② any personality/motivation contradictions or OOC; ③ 2-3 suggestions to strengthen character arcs. Read existing characters first; use file_read for specifics.`,
        );
      },
    },
    {
      cmd: "伏笔",
      label: () => L("伏笔回收", "Foreshadowing"),
      description: () => L("审查伏笔埋设与回收，规划回收场景", "Review foreshadowing plants and payoffs, plan payoff scenes"),
      mode: "ask",
      buildText: (args) => {
        const focus = args ? L(`重点关注：${args}`, `Focus: ${args}`) : "";
        return L(
          `基于上面注入的伏笔档案与全书总览，审查本书伏笔${focus ? "（" + focus + "）" : ""}：① 哪些待回收伏笔埋得太重或太轻、哪些跨度太大易被遗忘；② 为每条待回收伏笔设计回收场景（在计划回收章如何自然兑现、需要哪些人物在场、与剧情线如何交织）；③ 已弃置/长期未回收的伏笔是否值得捡回。只建议不替我定稿；需要细节时用 file_read 对照真实正文。`,
          `From the injected foreshadowing dossier and book overview, review the book's foreshadowing${focus ? " (" + focus + ")" : ""}: ① which pending plants are too heavy/subtle or span too long; ② design a payoff scene for each pending plant (how to pay it off naturally, who must be present, how it weaves into storylines); ③ whether abandoned/long-pending plants are worth reviving. Suggest only; use file_read for specifics.`,
        );
      },
    },
    {
      cmd: "时间线",
      label: () => L("时间线体检", "Timeline"),
      description: () => L("审查时间线同轨冲突与覆盖缺口", "Audit timeline same-track conflicts and coverage gaps"),
      mode: "ask",
      buildText: (args) => {
        const focus = args ? L(`重点关注：${args}`, `Focus: ${args}`) : "";
        return L(
          `基于上面注入的时间线档案与全书总览，审查本书时间线${focus ? "（" + focus + "）" : ""}：① 同轨时点碰撞与跨章时间倒挂，逐条说明矛盾与修法；② 覆盖缺口——哪些章还没有锚定事件、哪些区段过密或过疏，给出补齐优先级。时点是你的原文自由文本，不要强行换算成日期；需要细节时用 file_read 对照真实正文。`,
          `From the injected timeline dossier and book overview, audit the book's timeline${focus ? " (" + focus + ")" : ""}: ① same-track when-collisions and cross-chapter inversions, each with a fix; ② coverage gaps — chapters lacking anchored events, stretches too dense/sparse, and what to fill first. Treat "when" as your verbatim text; don't force dates; use file_read for specifics.`,
        );
      },
    },
    {
      cmd: "脑暴",
      label: () => L("灵感脑暴", "Brainstorm"),
      description: () => L("基于全书题材与念头池脑暴新念头", "Brainstorm new ideas from the book's genre and idea pool"),
      mode: "ask",
      buildText: (args) => {
        const focus = args ? L(`主题约束：${args}`, `Constraint: ${args}`) : "";
        return L(
          `基于上面注入的念头池与全书总览，脑暴 8-10 个新念头（一句一个）${focus ? "（" + focus + "）" : ""}，标注每个的类型（情节/人物/世界观/桥段），不与已有念头重复，尊重本书题材与已有念头的语气。只列念头不要展开成章节。`,
          `From the injected idea pool and book overview, brainstorm 8-10 new ideas (one line each)${focus ? " (" + focus + ")" : ""}, tag each by type (plot/character/worldbuilding/trope), avoid duplicating existing ideas, and respect the book's genre and the tone of existing ideas. List ideas only, don't expand into chapters.`,
        );
      },
    },
  ];
  // 体裁决定命令集（⑬ 刀A）：小说拿到的是下面这 6 条**原对象**，逐字未动。
  if (isBookScene) return bookCommandsFor(workbenchCommandSet(genre), bookCommands);
  return [
    {
      cmd: "fix",
      label: () => L("修复问题", "Fix"),
      description: () => L("吃当前文件真实诊断，直接改盘修掉错误", "Consume the file's real diagnostics and fix them in place"),
      mode: "edit",
      buildText: (args, ctx) => {
        if (!ctx.activeFile) return L("请先打开一个文件，再使用 /fix。", "Open a file before using /fix.");
        const ref = ctx.activeFile.relPath;
        // 无额外描述时，直接吃当前诊断（VS Code 式「修复此错误」）
        if (!args && ctx.diagnostics.length > 0) {
          const list = ctx.diagnostics
            .map((d) => `- L${d.startLine}: ${d.message}${d.source ? ` (${d.source}${d.code ? " " + d.code : ""})` : ""}`)
            .join("\n");
          return L(
            `当前文件 ${ref} 存在以下诊断问题，请逐一修复，给出最小改动（优先用 apply_change 工具直接改文件）：\n\n${list}\n\n先通过 project_context / file_read 读取真实的当前代码，确认每处上下文后再修改，不要凭空猜测。`,
            `The file ${ref} currently has these diagnostics. Fix each with a minimal change (prefer the apply_change tool to edit the file directly):\n\n${list}\n\nFirst read the real current code via project_context / file_read to confirm the context of each before editing; do not guess.`,
          );
        }
        const focus = args
          ? L(`请修复下面的问题：${args}`, `Fix the following issue: ${args}`)
          : L("请修复当前文件中的问题，给出最小改动。", "Fix the issues in the current file with minimal changes.");
        return L(
          `${focus}\n\n先通过 project_context / file_read 读取真实的当前代码，确认上下文后再修改，不要凭空猜测。`,
          `${focus}\n\nFirst read the real current code via project_context / file_read to confirm the context, then edit; do not guess.`,
        );
      },
    },
    {
      cmd: "explain",
      label: () => L("解释", "Explain"),
      description: () => L("解释选中或当前文件的代码逻辑", "Explain the selected or current file's logic"),
      mode: "ask",
      embedSelection: true,
      buildText: (args, ctx) => {
        if (!ctx.activeFile) return L("请先打开一个文件，再使用 /explain。", "Open a file before using /explain.");
        const lang = ctx.activeFile.language ?? "";
        if (ctx.selection) {
          const ref = refOf(ctx, ctx.selection);
          const focus = args ? L(`重点关注：${args}`, `Focus: ${args}`) : "";
          return L(
            `请解释下面选中的代码，并说明它的作用、潜在问题与改进点${focus ? "（" + focus + "）" : ""}：\n\n【${ref}】\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
            `Explain the selected code and point out its purpose, issues and improvements${focus ? " (" + focus + ")" : ""}:\n\n[${ref}]\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
          );
        }
        const focus = args ? L(`，重点关注：${args}`, `, focusing on: ${args}`) : "";
        return L(
          `请解释文件 ${ctx.activeFile.relPath} 的整体结构、关键逻辑、依赖关系与潜在问题${focus}。`,
          `Explain the overall structure, key logic, dependencies and potential issues of ${ctx.activeFile.relPath}${focus}.`,
        );
      },
    },
    {
      cmd: "tests",
      label: () => L("生成测试", "Tests"),
      description: () => L("为选中或当前文件生成单元测试", "Generate unit tests for the selection or file"),
      mode: "ask",
      embedSelection: true,
      buildText: (args, ctx) => {
        if (!ctx.activeFile) return L("请先打开一个文件，再使用 /tests。", "Open a file before using /tests.");
        const lang = ctx.activeFile.language ?? "";
        if (ctx.selection) {
          const ref = refOf(ctx, ctx.selection);
          const focus = args ? L(`（重点覆盖：${args}）`, ` (focus on: ${args})`) : "";
          return L(
            `请为下面选中的代码编写单元测试，覆盖关键函数/分支与边界情况${focus}：\n\n【${ref}】\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
            `Write unit tests for the selected code covering key functions/branches and edge cases${focus}:\n\n[${ref}]\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
          );
        }
        const focus = args ? L(`，重点覆盖：${args}`, `, focusing on: ${args}`) : "";
        return L(
          `请为文件 ${ctx.activeFile.relPath} 编写单元测试，覆盖关键函数/分支与边界情况${focus}。`,
          `Write unit tests for ${ctx.activeFile.relPath} covering key functions/branches and edge cases${focus}.`,
        );
      },
    },
    {
      cmd: "review",
      label: () => L("审查", "Review"),
      description: () => L("审查代码并引用 file:line 证据", "Review code, citing file:line evidence"),
      mode: "ask",
      embedSelection: true,
      buildText: (args, ctx) => {
        if (!ctx.activeFile) return L("请先打开一个文件，再使用 /review。", "Open a file before using /review.");
        const lang = ctx.activeFile.language ?? "";
        if (ctx.selection) {
          const ref = refOf(ctx, ctx.selection);
          const focus = args ? L(`（额外关注：${args}）`, ` (also check: ${args})`) : "";
          return L(
            `请审查下面选中的代码，指出 bug、坏味道、安全隐患，并引用「file:line」证据${focus}：\n\n【${ref}】\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
            `Review the selected code for bugs, smells and security risks, citing concrete "file:line" evidence${focus}:\n\n[${ref}]\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
          );
        }
        const focus = args ? L(`，额外关注：${args}`, `, also check: ${args}`) : "";
        return L(
          `请审查文件 ${ctx.activeFile.relPath}，指出 bug、坏味道、安全隐患并引用「file:line」证据${focus}。`,
          `Review ${ctx.activeFile.relPath}, citing concrete "file:line" evidence for bugs/smells/risks${focus}.`,
        );
      },
    },
    {
      cmd: "doc",
      label: () => L("生成文档", "Document"),
      description: () => L("为选中或当前代码生成文档注释并写入", "Generate doc comments for the selection/file and write them"),
      mode: "edit",
      embedSelection: true,
      buildText: (args, ctx) => {
        if (!ctx.activeFile) return L("请先打开一个文件，再使用 /doc。", "Open a file before using /doc.");
        const lang = ctx.activeFile.language ?? "";
        if (ctx.selection) {
          const ref = refOf(ctx, ctx.selection);
          return L(
            `请为下面选中的代码生成清晰、准确的文档注释（JSDoc / docstring，贴合该语言惯例），保持风格一致，优先用 apply_change 工具直接写入文件（只新增注释，不改逻辑）：\n\n【${ref}】\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
            `Write clear, accurate documentation comments (JSDoc / docstring, following the language's conventions) for the selected code, keep the style consistent, and prefer the apply_change tool to write them into the file directly (add comments only, do not change logic):\n\n[${ref}]\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
          );
        }
        return L(
          `请为文件 ${ctx.activeFile.relPath} 中缺失或简略的导出符号、类型与函数补全文档注释（JSDoc / docstring），保持风格一致，优先用 apply_change 工具直接写入文件。`,
          `Add documentation comments (JSDoc / docstring) to the under-documented exported symbols, types and functions in ${ctx.activeFile.relPath}, keep the style consistent, and prefer the apply_change tool to write them in directly.`,
        );
      },
    },
    {
      cmd: "generate",
      label: () => L("生成代码", "Generate"),
      description: () => L("按描述生成/补全代码并写入当前文件", "Generate/complete code from a description and write it"),
      mode: "edit",
      embedSelection: true,
      buildText: (args, ctx) => {
        if (!ctx.activeFile) return L("请先打开一个文件，再使用 /generate。", "Open a file before using /generate.");
        const lang = ctx.activeFile.language ?? "";
        const desc = args || L("请描述你想生成或补全的代码（包括语言、功能与约束）。", "Describe the code you want to generate or complete (language, behavior and constraints).");
        if (ctx.selection) {
          const ref = refOf(ctx, ctx.selection);
          return L(
            `请根据下面的描述生成/补全代码，优先用 apply_change 工具写入当前文件 ${ctx.activeFile.relPath}：\n\n描述：${desc}\n\n参考选中代码（${ref}）：\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
            `Generate or complete code per the description below, and prefer the apply_change tool to write it into the current file ${ctx.activeFile.relPath}:\n\nDescription: ${desc}\n\nReference selection (${ref}):\n\`\`\`${lang}\n${ctx.selection.text}\n\`\`\``,
          );
        }
        return L(
          `请根据下面的描述生成/补全代码，优先用 apply_change 工具写入文件 ${ctx.activeFile.relPath}：\n\n描述：${desc}`,
          `Generate or complete code per the description below, and prefer the apply_change tool to write it into ${ctx.activeFile.relPath}:\n\nDescription: ${desc}`,
        );
      },
    },
  ];
}

/** 解析行首斜杠命令：命中已注册命令则返回其定义 + 余下参数，否则返回 null（按普通文本发送）。
 *  命令名支持中英（\w 覆盖 ASCII，\u4e00-\u9fa5 覆盖常用汉字），故中文命令（如 /连续性）也能识别。 */
export const SLASH_CMD_RE = /^\/([\w\u4e00-\u9fa5]+)\s*([\s\S]*)$/;

export function parseSlashCommand(text: string, isBookScene?: boolean, genre?: string): { def: WorkbenchSlashCommand; args: string } | null {
  const m = text.trim().match(SLASH_CMD_RE);
  if (!m) return null;
  const cmd = m[1];
  const args = m[2].trim();
  // genre 必须与菜单渲染同源：菜单按体裁列出了 /形式，这里却查小说那一支的话，
  // 作者选中后按下发送只会得到「当普通文本发出去」（W-0a，2026-11-10）。
  const def = getSlashCommands(isBookScene, genre).find((c) => c.cmd === cmd);
  return def ? { def, args } : null;
}

/**
 * 散文集 / 诗集的工作台命令集（⑬ 分析文档刀 A，2026-11-09）。
 *
 * 为什么必须换集合而不是换个措辞：小说那 6 条里有 4 条问的是**这本书里没有的东西**——
 * `/连续性`（时间线冲突·伏笔回收·人物 OOC）、`/人物`、`/伏笔`、`/时间线`。
 * ⑦ 已经把 世界观/剧情线/伏笔 从页签上摘掉，命令面却还在原地喊，等于留了个绕过口：
 * 面板找不到了，一敲命令照样产出一堆对诗集无用的"回收场景设计"。
 *
 * 两套都保持同一个主权口径：`mode: 'ask'` —— **只诊断、只建议，不替作者定稿、不改盘**。
 */
const focusOf = (args?: string): { zh: string; en: string } => {
  const a = args?.trim();
  return { zh: a ? `（聚焦：${a}）` : '', en: a ? ` (focus: ${a})` : '' };
};

const POETRY_BOOK_COMMANDS: WorkbenchSlashCommand[] = [
  {
    cmd: "体检",
    label: () => L("诗集体检", "Collection health"),
    description: () => L("按形式统计全诗集：各体几首、几处出格、意象是否重复到发腻", "Count poems by form: how many per form, which are off-form, whether images repeat"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `基于上面注入的全书总览与篇目清单，给这本诗集做一次体检${f.zh}：① 按**形式**统计（各体几首、未标形式几首）；② 哪些首标了形式却与句数/每句字数不符；③ 跨首反复出现的意象与空转意象（写了却不承担意思）；④ 列出 3 个最该先处理的，各配一句话处置建议。只诊断，不要替我改诗。`,
        `From the injected overview and piece list, give this poetry collection a check-up${f.en}: ① count poems **by form** (how many per form, how many untagged); ② which poems are tagged with a form yet break its line-count or per-line measure; ③ images that repeat across poems and idle images that carry nothing; ④ the 3 most urgent items, each with a one-line action. Diagnose only — do not rewrite my poems.`,
      );
    },
  },
  {
    cmd: "形式",
    label: () => L("形式核验", "Form audit"),
    description: () => L("逐首核句数与每句字数，指出出格在第几行，并建议往哪一体收", "Audit lines and per-line measure poem by poem, point out offending lines, suggest a form to tighten toward"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `逐首核验形式${f.zh}：先说这首标的是哪一体（没标就建议该归哪一体），再按"几句 / 每句几字"逐行核，指出第几句出格、差几个字；最后给**不破坏原分行**的收法（改字不改行，或说明为何应改标成另一体）。需要原文时用 file_read 读该首，不要凭总览猜。绝不把诗排成散文段落。`,
        `Audit the form poem by poem${f.en}: first state which form it is tagged as (or which it should be), then check it line by line on "how many lines / characters per line", naming which line breaks it and by how much; finally give a tightening that **does not destroy the existing lineation** (change words, not line breaks — or argue it should be re-tagged). Use file_read for the actual text; never guess from the overview. Never reflow a poem into prose paragraphs.`,
      );
    },
  },
  {
    cmd: "意象",
    label: () => L("意象谱", "Image map"),
    description: () => L("抽出各首的意象与其指向，标出重复、互相抵消与空转", "Extract each poem's images and what they point to; flag repeats, mutual cancellations and idle ones"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `做一份意象谱${f.zh}：逐首列出主要意象 → 它承担什么意思，然后指出①跨首高度重复的意象（同质感写腻了）②同一首里互相抵消的意象③只装饰、不承担意思的空转意象。只描述与提议，不替我下结论说"这首诗表达了什么思想感情"。`,
        `Build an image map${f.en}: poem by poem, list the main images → what each carries, then flag ① images repeated across poems (same texture worn out) ② images inside one poem that cancel each other ③ purely decorative images that carry nothing. Describe and propose only — never declare "this poem expresses the feeling of…".`,
      );
    },
  },
  {
    cmd: "分行",
    label: () => L("分行与断句", "Lineation"),
    description: () => L("只看断句的位置与跨行张力，给不改分行数的建议", "Look only at where lines break and the tension across them; suggest without changing the line count"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `审这首的分行${f.zh}：① 哪一处断句削弱了张力、哪一处断得正好；② 给出**同样行数**下的调整方案（挪字、挪词，不增删行）；③ 若确实该合并或拆开，单独说明理由并等我点头。硬要求：不得把诗重排成散文段落，不得增删节数。`,
        `Review the lineation${f.en}: ① which break weakens the tension and which lands well; ② propose adjustments that keep **the same number of lines** (move words, not lines); ③ if a merge or split is truly warranted, say so separately and wait for my nod. Hard limits: never reflow the poem into prose paragraphs, never add or remove stanzas.`,
      );
    },
  },
  {
    cmd: "节奏",
    label: () => L("节奏与跨行", "Rhythm"),
    description: () => L("行长短起伏与跨行节奏（音节只作估算提示，不当判据）", "Line-length variation and enjambment rhythm (syllables are an estimate, never a verdict)"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `看这本（首）的节奏${f.zh}：行的长短起伏是否有意涵（还是随手断的）、跨行处是否制造了二次读法、哪一段过匀以至于平。英文诗的音节数**只能估算**，请标成"约"，不要当硬性格律结论下。只建议，不改我的分行。`,
        `Look at the rhythm${f.en}: does the variation in line length mean something (or is it arbitrary), do the enjambments create a second reading, where does it go flat from being too even. For English poems the syllable count is **an estimate** — write it as "≈" and never present it as a hard metrical verdict. Suggest only; do not change my line breaks.`,
      );
    },
  },
  {
    cmd: "脑暴",
    label: () => L("诗题脑暴", "Poem seeds"),
    description: () => L("从念头池与已有诗意象出发，给可写的题目与意象种子", "Seed writeable subjects and images from the idea pool and existing poems"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `基于注入的念头池与已有诗集，给 8-10 个**诗的种子**${f.zh}：一行一个，每个给「题目 + 一两个可用意象 + 建议形式（自由诗/五绝/十四行…）」；不与已有首重复，尊重这本的语感。只列种子，不要替我写成诗，也不要解释每个的寓意。`,
        `From the idea pool and the existing poems, give 8-10 **poem seeds**${f.en}: one per line, each as "subject + one or two usable images + a suggested form (free verse / five-character quatrain / sonnet…)"; do not repeat existing poems, respect this collection's voice. Seeds only — do not write the poems for me and do not explain each one's moral.`,
      );
    },
  },
];

const ESSAY_BOOK_COMMANDS: WorkbenchSlashCommand[] = [
  {
    cmd: "体检",
    label: () => L("文集体检", "Collection health"),
    description: () => L("按篇核立意与编排：有无互相重复、有无漏掉整块经验", "Audit essays by intent and sequencing: overlaps and blind spots"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `基于注入的全书总览与篇目清单，给这本散文集做体检${f.zh}：① 各篇立意一句话概括，哪些实际在说同一件事；② 题材与经验上的空白；③ 篇幅与语调的落差是节奏还是失控；④ 3 个最该先处理的问题，各配一句话建议。只诊断，不改稿。`,
        `From the injected overview and piece list, check this essay collection${f.en}: ① one-line statement of each essay's intent, and which are secretly saying the same thing; ② blank spots in subject and experience; ③ whether the spread in length and tone is rhythm or drift; ④ the 3 most urgent issues, each with a one-line action. Diagnose only, do not rewrite.`,
      );
    },
  },
  {
    cmd: "立意",
    label: () => L("立意核", "Intent check"),
    description: () => L("逐篇看立意是否清晰、是否被结尾说明文", "Check each essay's intent and whether the ending over-explains it"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `逐篇核立意${f.zh}：这首在说什么、靠什么承载（经验/物象/思辨），有没有在中途换手；尤其指出**结尾把立意说出来代替了它该被感受**的篇目。需要原文用 file_read，别凭摘要判。只提议，不替我定稿。`,
        `Check the intent essay by essay${f.en}: what each is about and what carries it (experience / object / reflection), whether it changes hands midway; call out especially the pieces whose **ending states the intent instead of letting it be felt**. Use file_read for the real text; never judge from a summary. Propose only.`,
      );
    },
  },
  {
    cmd: "结构",
    label: () => L("篇序编排", "Sequencing"),
    description: () => L("集级顺序：情绪起伏、主题呼应、开卷与收卷", "Book-level order: emotional arc, thematic echoes, opening and closing pieces"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `给整本的**篇序**提方案${f.zh}：按情绪起伏、主题呼应、时间或地域线索给一个排序，说清为什么这样开卷、怎么收卷；允许分辑/分组但尊重作者现有结构，别强推。只给方案与理由，不要直接改章节顺序。`,
        `Propose a **running order** for the whole book${f.en}: ordered by emotional arc, thematic echoes or a temporal/geographic thread, explaining why this piece opens and how that one closes; grouping into sections is allowed but respect the author's existing structure. Give the order and reasons only — do not reorder anything.`,
      );
    },
  },
  {
    cmd: "素材",
    label: () => L("素材归集", "Material"),
    description: () => L("把念头池归成可写的题目与可用细节", "Turn the idea pool into writeable subjects and usable details"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `把注入的念头池/素材归拢${f.zh}：按题目聚类，每题列可用细节与待核事实（没根据的标成待核，不得当成已知），并标出能并入现有篇目的与够独立成篇的。不要替我写成稿。`,
        `Consolidate the injected ideas and material${f.en}: cluster by subject, list usable details and facts still to verify (mark unverified ones as such, never as known), and note which fit into existing pieces versus stand alone. Do not draft the essays for me.`,
      );
    },
  },
  {
    cmd: "脑暴",
    label: () => L("题目脑暴", "Essay seeds"),
    description: () => L("给 8-10 个可写的题目与切口", "Give 8-10 writeable subjects and angles"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `基于念头池与已有篇目，给 8-10 个**散文题目**${f.zh}：一行一个，每个配一句切口（从哪个细节入），不与已有篇目重复，尊重这本的语调。只列题目，不要展开成稿。`,
        `From the idea pool and existing pieces, give 8-10 **essay subjects**${f.en}: one per line, each with a one-line angle (which detail to enter from), no repeats of existing pieces, respecting this book's voice. Subjects only — do not expand them.`,
      );
    },
  },
];

/**
 * 剧本的书级命令（⑮-2，2026-11-09）。
 *
 * 戏剧的可诊断项和小说/散文/诗都不一样，硬套会得到无效建议：
 * 小说问"伏笔回收"，散文问"立意"，诗问"分行与形式"，而剧本要问的是
 * **每一场谁要什么、谁挡着、结果如何**（贯穿动作），以及**每个人说话像不像他自己**
 * （对白可辨性）与**这段舞台指示能不能在台上演出来**（可演性）。
 * 全部 mode:'ask' 只诊断；并写死底线：不改幕与场的编号与层级、不把对白排成散文段落、
 * 不替作者把结局或台词写完。
 */
const SCRIPT_BOOK_COMMANDS: WorkbenchSlashCommand[] = [
  {
    cmd: "体检",
    label: () => L("全剧体检", "Play health"),
    description: () => L("幕场结构、贯穿动作、对白可辨性一次过一遍", "One pass over act/scene structure, the through-line, and distinct dialogue"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `基于注入的全书总览与幕场清单，给这本剧本做体检${f.zh}：① 每一幕的转折点在哪、幕末有没有把人逼到必须进下一场；② 每一场是否改变了局面（删掉它剧情会不会塌）；③ 贯穿动作是否清楚（主角要什么、什么在挡、递进到哪一步）；④ 哪些角色的台词互相能替换（对白不可辨）；⑤ 3 个最该先处理的问题，各配一句话建议。**只诊断，不改稿，不替你重写台词**。`,
        `From the injected overview and act/scene list, check this play${f.en}: ① each act's turning point and whether the act ends forcing the next; ② whether every scene changes the situation (would the plot survive deleting it); ③ is the through-line clear (what the protagonist wants, what blocks it, how it escalates); ④ which characters' lines are interchangeable; ⑤ the 3 most urgent issues, each with a one-line action. **Diagnose only — do not rewrite the dialogue.**`,
      );
    },
  },
  {
    cmd: "幕场",
    label: () => L("幕场结构", "Act & scene"),
    description: () => L("逐场核必要性与可合并项，尊重现有幕场编号", "Audit each scene's necessity and merge candidates, keeping the author's numbering"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `逐场核结构${f.zh}：这一场的目标、障碍、结果各是什么；标出可合并、可删或该补的场，并说明合并后丢掉什么。**不得增删或重排现有幕与场的编号**，需要改动只提方案。用 file_read 看原文，别凭梗概判。`,
        `Audit the structure scene by scene${f.en}: each scene's objective, obstacle and outcome; flag mergeable, deletable or missing scenes and say what a merge would cost. **Never add, delete or renumber acts and scenes** — propose only. Use file_read for the real text, never a synopsis.`,
      );
    },
  },
  {
    cmd: "对白",
    label: () => L("对白核", "Dialogue check"),
    description: () => L("遮住角色名还能不能认出是谁在说", "Could you still tell who speaks with the names hidden"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `核对白${f.zh}：① 遮住角色名逐句判"这句话属于谁"，指出串味的行；② 哪些台词在**替代表演**（把动作或心理说出来了）；③ 哪些是说明书式台词（向观众解释本来该被看见的事）；④ 长台词是否有必要。**只指出问题行并给方向，不要替我写出替换台词。**`,
        `Check the dialogue${f.en}: ① hide the character names and decide whose line each is, flag the ones that all taste the same; ② lines that **describe instead of act** (spoken action or psychology); ③ expository lines explaining what should be visible; ④ whether long speeches earn their length. **Point at the lines and the direction only — do not write my replacement lines.**`,
      );
    },
  },
  {
    cmd: "指示",
    label: () => L("舞台指示核", "Stage directions"),
    description: () => L("只留演得出来的：位置、动作、上下场、音效", "Keep only what can be staged: position, action, entrances, sound"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `核舞台指示${f.zh}：标出**演不出来**的写法（心理描述、不可见的回忆、作者评论），逐条给可演化的方向（换成动作/停顿/物件/上下场/灯光音响）；另核上下场是否连贯、有没有写了台词却没人离场。不改正文，只列清单。`,
        `Audit the stage directions${f.en}: flag anything **unperformable** (psychology, invisible memory, authorial comment) and give a stageable direction per item (action, pause, object, entrance/exit, light and sound); also check entrances and exits stay consistent and that no speaker is left on stage unaccounted for. List findings; do not edit the text.`,
      );
    },
  },
  {
    cmd: "冲突",
    label: () => L("冲突递进", "Conflict"),
    description: () => L("每场是否有对抗，阻碍是否递进", "Whether each scene has opposition and whether obstacles escalate"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `核冲突${f.zh}：按场列出「谁 vs 谁 / 什么」、双方各要什么、这一场之后障碍是否**递进**；标出连续无对抗的场与阻碍不升级的段落。结论要能指向具体场号，别只说"节奏偏慢"。只诊断。`,
        `Audit conflict${f.en}: per scene list "who against whom / what", what each side wants, and whether obstacles **escalate** after the scene; flag runs of scenes without opposition and anywhere the obstacle never grows. Every finding must name a scene, not just say "the pace sags". Diagnose only.`,
      );
    },
  },
  {
    cmd: "脑暴",
    label: () => L("场次脑暴", "Scene seeds"),
    description: () => L("给 6-8 个可补的场次与切口", "Give 6-8 scenes worth adding and how to enter them"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `基于已有幕场与念头池，给 6-8 个**可补的场次**${f.zh}：一行一个，各写清「谁与谁、争什么、这一场结束时局面怎么变」，并标出它应该落在第几幕之后（不新建幕、不改编号）。只列方案，不要写成台本。`,
        `From the existing acts/scenes and idea pool, give 6-8 **scenes worth adding**${f.en}: one per line, each stating "who with whom, over what, how the situation has changed when it ends", and where it would sit (no new acts, no renumbering). Options only — do not write the script.`,
      );
    },
  },
];

/**
 * 日记的书级命令（2026-11-10）。
 *
 * 日记能诊断的东西和另外三个都不一样：小说问伏笔回收、散文问立意、诗问分行、剧本问冲突回合，
 * 而日记的价值在**前后对照** —— 同一个人反复出现时有没有变化、空掉的那段在前后各写了什么、
 * 某天只剩流水账而没有任何感受。它最怕的是模型**替作者编记忆**，所以每条都写死：
 * 不许虚构那天的事实、不许改动日期与条目顺序、只提问与诊断。
 */
const DIARY_BOOK_COMMANDS: WorkbenchSlashCommand[] = [
  {
    cmd: "体检",
    label: () => L("整本日记体检", "Journal health"),
    description: () => L("空档、流水账化、反复出现却没写过的人", "Gaps, days that are only logs, and recurring people never actually written"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `基于注入的条目清单与全书总览，给这本日记做体检${f.zh}：① 只列事实、没有任何感受或细节的条目占多大比例，举三例；② 反复出现却始终没有一句原话或一个具体场景的人物；③ 前后自相矛盾的记述（同一天两种说法）；④ 3 个最值得回看的时间段，各配一句"该问自己什么"。**只诊断与提问，不得虚构任何一天的事实，不得改动日期与顺序。**`,
        `From the injected entry list and book overview, check this journal${f.en}: ① what share of entries are pure events with no feeling or detail, with three examples; ② people who recur but never got a single line of speech or a concrete scene; ③ accounts of the same day that contradict each other; ④ the three stretches most worth rereading, each with one question to ask yourself. **Diagnose and ask only — never invent what happened on a day, never change dates or order.**`,
      );
    },
  },
  {
    cmd: "空档",
    label: () => L("空档与断点", "Gaps"),
    description: () => L("找出空白段与前后反差，不追问原因", "Find the blank stretches and the contrast around them, without asking why"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `找出这本日记里的**空白段**${f.zh}：每段列出它前面最后一条写了什么、后面第一条写了什么、中间跨了多久，并指出语气/处境上最大的那个落差。**不评价该不该写、不追问为什么不写**；只把落差摆出来，最多各给一个可以被作者自己忽略的提问。`,
        `Find the **blank stretches** in this journal${f.en}: for each one, what the last entry before it said, what the first entry after it says, how long the gap is, and the sharpest contrast in tone or situation. **Do not judge whether it should have been written or ask why it was skipped** — lay out the contrast, and at most one question the author may have skipped.`,
      );
    },
  },
  {
    cmd: "人物",
    label: () => L("反复出现的人", "Recurring people"),
    description: () => L("同一个人跨时间的变化轨迹", "How the same person changes across time"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `按人梳理这本日记${f.zh}：挑出被写得最多的几个人，每人给一条时间线（哪几天写到、各写了什么事实、作者当时怎么说他），并指出**前后态度变化的那一条**。原文不够就用 file_read 读条目，**不得替我补上我不记得的细节。**`,
        `Go through this journal person by person${f.en}: pick the most-written people and give one timeline each (which days they appear, what facts are recorded, how the author described them then), and name **the entry where the attitude turns**. Use file_read for the real entries; **do not fill in details I do not remember.**`,
      );
    },
  },
  {
    cmd: "语气",
    label: () => L("语气与流水账", "Voice check"),
    description: () => L("哪些条目只剩记事、看不到当时的人", "Which entries are pure logs with no one visible in them"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `逐条看语气${f.zh}：标出**只剩事件、看不到当时的人**的条目（全是"做了什么"、没有一个具体细节或一句当时想说的话），并说明它是真的空还是当时的克制——**不要把每条都建议"写长一点"**。只指出条目与缺口，不替我重写。`,
        `Check the voice entry by entry${f.en}: flag the ones that are **only events with no person visible** (all "what was done", not one concrete detail or one thought from the moment), and say whether it is truly empty or deliberate restraint — **do not recommend making every entry longer**. Name the entries and the gap; do not rewrite them for me.`,
      );
    },
  },
  {
    cmd: "归档",
    label: () => L("归月建议", "Filing"),
    description: () => L("年月分组与回看顺序，尊重现有层级", "Year/month grouping and reading order, keeping the existing structure"),
    mode: "ask",
    buildText: (args) => {
      const f = focusOf(args);
      return L(
        `给这本日记的**归档**提建议${f.zh}：按现有的年/月层级指出哪里缺一个分组、哪里条目太碎可以并月、哪几段适合单独拿出来回看（并说明为什么）。**不得重排、不得改日期、不得新建或删除条目**，只给方案。`,
        `Propose **filing** improvements for this journal${f.en}: within the existing year/month levels, where a group is missing, where entries are too fragmented to merge by month, and which stretches deserve a dedicated reread (with a reason). **Never reorder, never change dates, never add or delete entries** — proposals only.`,
      );
    },
  },
];

function bookCommandsFor(set: 'novel' | 'essay' | 'poetry' | 'script' | 'diary', novelCommands: WorkbenchSlashCommand[]): WorkbenchSlashCommand[] {
  if (set === 'essay') return ESSAY_BOOK_COMMANDS;
  if (set === 'poetry') return POETRY_BOOK_COMMANDS;
  if (set === 'script') return SCRIPT_BOOK_COMMANDS;
  if (set === 'diary') return DIARY_BOOK_COMMANDS;
  return novelCommands;
}
