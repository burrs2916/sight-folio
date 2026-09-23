// sight-folio: 轻量、零依赖、XSS 安全的 Markdown 渲染（专供 AI 消息）
//
// 设计取舍：
// - 为什么不用现成库（react-markdown / marked）？工作台侧栏要保持轻量，且这些库默认走
//   dangerouslySetInnerHTML 有 XSS 面。这里手写解析、全部输出 React 元素，绝不 innerHTML。
// - 语法高亮：聊天区用等宽 <pre>（避免把 Monaco 拖进侧栏包）；diff 预览才用真 Monaco（on-demand 懒加载）。
// - 代码块支持 ```语言 path:行号 头部，解析出 path/line 供「插入光标」/「应用到文件」使用。

import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import NorthWestIcon from "@mui/icons-material/NorthWest";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import { t } from "../../i18n";
import { highlightCode } from "./codeHighlight";

export interface CodeBlockMeta {
  lang: string;
  /** 头部解析出的目标路径（相对路径），可能为空 */
  path?: string;
  /** 头部解析出的起始行（1 起，替换区段起点 / 插入位置） */
  line?: number;
  /** 头部解析出的结束行（1 起，含）：与 line 一起构成「替换闭区间」；缺失表示单行插入 */
  endLine?: number;
  code: string;
}

type Node =
  | { type: "code"; meta: CodeBlockMeta }
  | { type: "text"; value: string };

const FENCE_RE = /^```(\w*)\s*(.*)$/;
// 支持 `path`、`path:起始行`、`path:起始行-结束行` 三种头部（结束行缺失=单行插入）
const PATH_LINE_RE = /^(\S+?)(?::(\d+)(?:-(\d+))?)?$/;

/** 把消息正文拆成 文本 / 代码块 交替节点 */
export function parseBlocks(content: string): Node[] {
  const nodes: Node[] = [];
  const lines = content.split("\n");
  let i = 0;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) {
      nodes.push({ type: "text", value: buf.join("\n") });
      buf = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) {
      flush();
      const lang = fence[1] || "";
      const suffix = fence[2]?.trim() || "";
      let path: string | undefined;
      let lineNo: number | undefined;
      let endLineNo: number | undefined;
      if (suffix) {
        const m = suffix.match(PATH_LINE_RE);
        if (m) {
          path = m[1];
          if (m[2]) lineNo = Number(m[2]);
          if (m[3]) endLineNo = Number(m[3]);
        } else {
          path = suffix;
        }
      }
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      nodes.push({ type: "code", meta: { lang, path, line: lineNo, endLine: endLineNo, code: code.join("\n") } });
    } else {
      buf.push(line);
      i++;
    }
  }
  flush();
  return nodes;
}

/** 内联格式：解析 `code` / **bold** / *italic* 为 React 节点（无 innerHTML） */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(re);
  return parts.map((part, idx) => {
    if (!part) return null;
    const key = `${keyBase}-${idx}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <Box component="code" key={key} sx={{ fontFamily: "monospace", fontSize: "0.92em", px: 0.5, py: 0.1, borderRadius: 0.5, bgcolor: (th) => (th.palette.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)") }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

/** 渲染一段纯文本（支持标题 / 列表 / 段落 / 内联） */
function renderText(value: string, keyBase: string): React.ReactNode {
  const blocks = value.split(/\n{2,}/);
  return blocks.map((blk, bi) => {
    const key = `${keyBase}-t${bi}`;
    const trimmed = blk.trim();
    if (!trimmed) return null;
    // 标题
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      return (
        <Typography key={key} variant="caption" sx={{ display: "block", fontWeight: 700, fontSize: 12 + (4 - level) * 0.5, mt: 0.5, mb: 0.25, color: "text.primary" }}>
          {renderInline(h[2], key)}
        </Typography>
      );
    }
    // 列表
    const listItems = trimmed.split("\n").filter((l) => /^(\s*[-*]\s+|\s*\d+\.\s+)/.test(l));
    if (listItems.length > 0 && listItems.length === trimmed.split("\n").length) {
      return (
        <Box key={key} component="ul" sx={{ pl: 2.5, my: 0.25, listStyleType: "disc" }}>
          {listItems.map((li, lii) => {
            const content = li.replace(/^(\s*[-*]\s+|\s*\d+\.\s+)/, "");
            return (
              <li key={`${key}-li${lii}`}>
                <Typography variant="caption" component="span" sx={{ display: "block", fontSize: 11.5, lineHeight: 1.5, color: "text.primary", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {renderInline(content, `${key}-li${lii}`)}
                </Typography>
              </li>
            );
          })}
        </Box>
      );
    }
    // 普通段落
    return (
      <Typography key={key} variant="caption" component="p" sx={{ display: "block", fontSize: 11.5, lineHeight: 1.55, color: "text.primary", whiteSpace: "pre-wrap", wordBreak: "break-word", my: 0.25 }}>
        {renderInline(trimmed, key)}
      </Typography>
    );
  });
}

export interface MarkdownViewProps {
  content: string;
  /** 代码块「插入光标」回调（仅 edit/agent 模式且编辑器可用时启用） */
  onCodeInsert?: (meta: CodeBlockMeta) => void;
  /** 代码块「应用到文件」回调（diff 预览） */
  onCodeApply?: (meta: CodeBlockMeta) => void;
  /** 是否启用插入/应用按钮 */
  canApply?: boolean;
}

function CodeBlockCard({ meta, onCodeInsert, onCodeApply, canApply }: { meta: CodeBlockMeta } & Pick<MarkdownViewProps, "onCodeInsert" | "onCodeApply" | "canApply">) {
  const dark = useTheme().palette.mode === "dark";
  const [copied, setCopied] = React.useState(false);
  // 语法高亮（对标 VS Code Copilot Chat 代码块）：零依赖、零 innerHTML。
  // 仅当内容变化/主题切换时重算，避免复制按钮状态变更触发整块重 token 化。
  const highlighted = React.useMemo(
    () => highlightCode(meta.code, meta.lang || "plaintext", dark),
    [meta.code, meta.lang, dark]
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meta.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };
  const target = meta.path
    ? `${meta.path}${meta.line ? ":" + meta.line + (meta.endLine ? "-" + meta.endLine : "") : ""}`
    : null;
  // 应用落点透明化：让用户在点击「应用到文件」前就看清这段代码会被写到哪（VS Code 式）。
  // 代码块头没声明 path 时，一律落到「当前打开的文件」——与 onCodeApply 的解析口径一致。
  const applyTarget = meta.path ?? t("workbench.aiCode.currentFile");
  return (
    <Box sx={{ my: 0.5, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: (th) => (th.palette.mode === "dark" ? "#0d1117" : "#f6f8fa") }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.4, borderBottom: 1, borderColor: "divider", bgcolor: (th) => (th.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)") }}>
        <Typography variant="caption" sx={{ fontSize: 9.5, fontWeight: 600, color: "text.secondary", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {meta.lang || "code"}{target ? ` · ${target}` : ""}
        </Typography>
        {canApply && (
          <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            → {applyTarget}
          </Typography>
        )}
        {canApply && onCodeInsert && (
          <Tooltip title={t("workbench.aiCode.insert")}>
            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onCodeInsert?.(meta)}>
              <NorthWestIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {canApply && onCodeApply && (
          <Tooltip title={t("workbench.aiCode.apply")}>
            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onCodeApply?.(meta)}>
              <FileUploadIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={copied ? t("workbench.aiCode.copied") : t("workbench.aiCode.copy")}>
          <IconButton size="small" sx={{ p: 0.25 }} onClick={copy}>
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box component="pre" sx={{ m: 0, p: 1, fontSize: 11, lineHeight: 1.45, fontFamily: "monospace", overflowX: "auto", whiteSpace: "pre", color: "text.primary" }}>
        {highlighted}
      </Box>
    </Box>
  );
}

export function MarkdownView({ content, onCodeInsert, onCodeApply, canApply }: MarkdownViewProps) {
  const nodes = React.useMemo(() => parseBlocks(content), [content]);
  return (
    <Box sx={{ fontSize: 11.5 }}>
      {nodes.map((n, idx) =>
        n.type === "code" ? (
          <CodeBlockCard key={idx} meta={n.meta} onCodeInsert={onCodeInsert} onCodeApply={onCodeApply} canApply={canApply} />
        ) : (
          <React.Fragment key={idx}>{renderText(n.value, `n${idx}`)}</React.Fragment>
        )
      )}
    </Box>
  );
}
