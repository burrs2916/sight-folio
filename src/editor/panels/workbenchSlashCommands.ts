// project-sight: 工作台斜杠命令（对标 VS Code Copilot Chat 的命令式交互）
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

/** 调用期返回完整命令清单（L() 在每次调用时按当前 UI 语言求值，切换语言即时刷新） */
export function getSlashCommands(): WorkbenchSlashCommand[] {
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

/** 解析行首斜杠命令：命中已注册命令则返回其定义 + 余下参数，否则返回 null（按普通文本发送） */
export const SLASH_CMD_RE = /^\/(\w+)\s*([\s\S]*)$/;

export function parseSlashCommand(text: string): { def: WorkbenchSlashCommand; args: string } | null {
  const m = text.trim().match(SLASH_CMD_RE);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const args = m[2].trim();
  const def = getSlashCommands().find((c) => c.cmd === cmd);
  return def ? { def, args } : null;
}
