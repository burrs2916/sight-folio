// sight-folio: AI 对话页专用的轻量 Markdown 渲染（14px 字号，适配聊天气泡）
//
// 与工作台侧栏 aiMarkdown.tsx 同源约束（零依赖、零 innerHTML、XSS 安全）：
// - 复用 aiMarkdown 的 parseBlocks（代码块/文本切分）与 codeHighlight 的 highlightCode（语法高亮），
//   只在此处提供对话页所需的字号与气泡化样式，避免把侧栏的 insert/apply 工作台能力带进来。
// - 生成流式渲染：代码块随内容增量重 token，React 元素输出，无 innerHTML。

import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTheme } from '@mui/material/styles';
import { parseBlocks } from '../../editor/panels/aiMarkdown';
import { highlightCode } from '../../editor/panels/codeHighlight';
import { t } from '../../i18n';

/** 内联格式：解析 `code` / **bold** / *italic* / [text](url) 为 React 节点（无 innerHTML） */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]\n]+\]\([^)\s]+\))/g;
  const parts = text.split(re);
  return parts.map((part, idx) => {
    if (!part) return null;
    const key = `${keyBase}-${idx}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <Box
          component="code"
          key={key}
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.92em',
            px: 0.4,
            py: 0.1,
            borderRadius: 0.5,
            bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'),
          }}
        >
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return <em key={key}>{renderInline(part.slice(1, -1), key)}</em>;
    }
    const link = part.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
    if (link) {
      // 仅允许 http/https 协议，阻断 javascript: 等危险链接
      const url = link[2];
      if (/^https?:\/\//i.test(url)) {
        return (
          <Box
            component="a"
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: 'primary.main', textDecoration: 'underline' }}
          >
            {link[1]}
          </Box>
        );
      }
      return (
        <React.Fragment key={key}>
          {link[1]}（{url}）
        </React.Fragment>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

/** 渲染一段纯文本（支持标题 / 列表 / 引用 / 段落 / 内联），字号适配对话页 ≈14px */
function renderText(value: string, keyBase: string): React.ReactNode {
  const blocks = value.split(/\n{2,}/);
  return blocks.map((blk, bi) => {
    const key = `${keyBase}-t${bi}`;
    const trimmed = blk.trim();
    if (!trimmed) return null;
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      return (
        <Typography
          key={key}
          sx={{
            display: 'block',
            fontWeight: 700,
            fontSize: 14 + (4 - level) * 1.5,
            mt: 0.75,
            mb: 0.25,
            color: 'text.primary',
            lineHeight: 1.5,
          }}
        >
          {renderInline(h[2], key)}
        </Typography>
      );
    }
    const lines = trimmed.split('\n');
    const listItems = lines.filter((l) => /^(\s*[-*]\s+|\s*\d+\.\s+)/.test(l));
    if (listItems.length > 0 && listItems.length === lines.length) {
      return (
        <Box key={key} component="ul" sx={{ pl: 2.5, my: 0.5, m: 0, listStyleType: 'disc' }}>
          {listItems.map((li, lii) => {
            const content = li.replace(/^(\s*[-*]\s+|\s*\d+\.\s+)/, '');
            return (
              <li key={`${key}-li${lii}`}>
                <Typography
                  component="span"
                  sx={{
                    display: 'block',
                    fontSize: 14,
                    lineHeight: 1.65,
                    color: 'text.primary',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {renderInline(content, `${key}-li${lii}`)}
                </Typography>
              </li>
            );
          })}
        </Box>
      );
    }
    const quote = lines.every((l) => /^\s*>\s?/.test(l));
    if (quote) {
      const content = lines.map((l) => l.replace(/^\s*>\s?/, '')).join('\n');
      return (
        <Box
          key={key}
          sx={{
            my: 0.5,
            pl: 1.25,
            borderLeft: 3,
            borderColor: 'primary.light',
            color: 'text.secondary',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <Typography sx={{ display: 'block', fontSize: 14, lineHeight: 1.65, color: 'text.secondary' }}>
            {renderInline(content, key)}
          </Typography>
        </Box>
      );
    }
    return (
      <Typography
        key={key}
        component="p"
        sx={{
          display: 'block',
          fontSize: 14,
          lineHeight: 1.65,
          color: 'text.primary',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          my: 0.25,
        }}
      >
        {renderInline(trimmed, key)}
      </Typography>
    );
  });
}

/** 代码块卡片：语言标签 + 复制按钮 + 语法高亮（零 innerHTML） */
function ChatCodeBlock({ lang, code }: { lang: string; code: string }) {
  const dark = useTheme().palette.mode === 'dark';
  const [copied, setCopied] = React.useState(false);
  const highlighted = React.useMemo(() => highlightCode(code, lang, dark), [code, lang, dark]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };
  return (
    <Box
      sx={{
        my: 0.75,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(13,17,23,0.6)' : 'rgba(246,248,250,0.8)'),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1.25,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
        }}
      >
        <Typography
          sx={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: 0.3,
          }}
        >
          {lang || 'code'}
        </Typography>
        <Tooltip title={copied ? t('agent.chat.copied') : t('agent.chat.copy')}>
          <IconButton
            size="small"
            sx={{ p: 0.25 }}
            onClick={copy}
            aria-label={copied ? t('agent.chat.copied') : t('agent.chat.copy')}
          >
            <ContentCopyIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          px: 1.5,
          py: 1.25,
          fontSize: 12.5,
          lineHeight: 1.55,
          fontFamily: 'monospace',
          overflowX: 'auto',
          whiteSpace: 'pre',
          color: 'text.primary',
        }}
      >
        {highlighted}
      </Box>
    </Box>
  );
}

export interface ChatMarkdownProps {
  content: string;
}

/** 对话页 Markdown 渲染入口：切分代码块 + 文本区 */
export function ChatMarkdown({ content }: ChatMarkdownProps) {
  const nodes = React.useMemo(() => parseBlocks(content), [content]);
  return (
    <Box sx={{ fontSize: 14, minWidth: 0 }}>
      {nodes.map((n, idx) =>
        n.type === 'code' ? (
          <ChatCodeBlock key={idx} lang={n.meta.lang} code={n.meta.code} />
        ) : (
          <React.Fragment key={idx}>{renderText(n.value, `n${idx}`)}</React.Fragment>
        ),
      )}
    </Box>
  );
}

export default ChatMarkdown;
