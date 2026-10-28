// sight-folio: 轻量、零依赖、XSS 安全的 Markdown 渲染（专供 AI 消息）
//
// 设计取舍：
// - 为什么不用现成库（react-markdown / marked）？工作台侧栏要保持轻量，且这些库默认走
//   dangerouslySetInnerHTML 有 XSS 面。这里手写解析、全部输出 React 元素，绝不 innerHTML。
// - 语法高亮：聊天区用等宽 <pre>（避免把 Monaco 拖进侧栏包）；diff 预览才用真 Monaco（on-demand 懒加载）。
// - 代码块支持 ```语言 path:行号 头部，解析出 path/line 供「插入光标」/「应用到文件」使用。

import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import NorthWestIcon from '@mui/icons-material/NorthWest';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import { t } from '../../i18n';
import { highlightCode } from './codeHighlight';

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

type Node = { type: 'code'; meta: CodeBlockMeta } | { type: 'text'; value: string };

const FENCE_RE = /^```(\w*)\s*(.*)$/;
// 支持 `path`、`path:起始行`、`path:起始行-结束行` 三种头部（结束行缺失=单行插入）
const PATH_LINE_RE = /^(\S+?)(?::(\d+)(?:-(\d+))?)?$/;

/** 把消息正文拆成 文本 / 代码块 交替节点 */
export function parseBlocks(content: string): Node[] {
  const nodes: Node[] = [];
  const lines = content.split('\n');
  let i = 0;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) {
      nodes.push({ type: 'text', value: buf.join('\n') });
      buf = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) {
      flush();
      const lang = fence[1] || '';
      const suffix = fence[2]?.trim() || '';
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
      nodes.push({ type: 'code', meta: { lang, path, line: lineNo, endLine: endLineNo, code: code.join('\n') } });
    } else {
      buf.push(line);
      i++;
    }
  }
  flush();
  return nodes;
}

/** 围栏闭合行 */
const FENCE_CLOSE_RE = /^```\s*$/;

/**
 * 流式输出的稳定前缀切分（思路对齐 openclaw 的 splitStableStreamingMarkdown）：
 * - stable：已稳定的前缀——空行结尾的段落、已闭合的代码围栏属于稳定内容，可安全按普通 Markdown 解析；
 * - tail：不稳定尾部——未以空行收束的段落 / 未闭合的代码围栏，渲染时按字面处理，避免闪烁与「吞内容」；
 * - openFence：tail 是否处于未闭合代码围栏内（此时 tail 整段按等宽字面渲染，不解析，也不吞围栏后的内容）。
 */
export function splitStreamingMarkdown(content: string): { stable: string; tail: string; openFence: boolean } {
  if (!content) return { stable: '', tail: '', openFence: false };
  const lines = content.split('\n');
  let boundary = 0; // 最后一个稳定边界（字符偏移）
  let offset = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = offset + line.length + (i < lines.length - 1 ? 1 : 0);
    if (inFence) {
      if (FENCE_CLOSE_RE.test(line)) {
        inFence = false;
        boundary = lineEnd; // 闭合围栏后立即稳定
      }
    } else if (FENCE_RE.test(line)) {
      inFence = true; // 围栏开启：未闭合前不再推进 boundary
    } else if (line.trim() === '') {
      boundary = lineEnd; // 空行 = 段落边界，稳定
    }
    offset = lineEnd;
  }
  return { stable: content.slice(0, boundary), tail: content.slice(boundary), openFence: inFence };
}

/**
 * 流式尾部行内标记修补（对标 openclaw 的 repairStreamingMarkdownTail / remend）：
 * 流式中「**加粗中」「*斜体中* 未写」「`code中」这类未闭合标记若原样渲染，
 * 用户会看到裸奔的星号/反引号（视觉闪烁、观感差）。这里按 CommonMark 的
 * flanking 规则近似判定哪些标记处于「已开启未关闭」状态，在 tail 末尾补全
 * 闭合符，再交给 renderText/renderInline 渲染——开启中的样式实时生效，
 * 等下方文本继续输出后自然闭合，观感平滑。
 *
 * 只处理本渲染器支持的 strong（**）、em（*）、行内 code（`）三类；
 * 乘号/幂/路径中的星号（`2 * 3 = 6`、`a**b`）因 flanking 不成立不会误补。
 */
export function repairStreamingTailInline(tail: string): string {
  if (!tail) return tail;
  const stack: ('code' | 'strong' | 'em')[] = [];
  const has = (tag: 'code' | 'strong' | 'em') => stack.includes(tag);
  const spliceTag = (tag: 'code' | 'strong' | 'em') => {
    const idx = stack.indexOf(tag);
    if (idx >= 0) stack.splice(idx, 1);
  };
  const pushTag = (tag: 'code' | 'strong' | 'em') => {
    if (!has(tag)) stack.push(tag);
  };
  for (let i = 0; i < tail.length; i++) {
    const ch = tail[i];
    if (ch === '`') {
      // ``` 围栏在这里不应出现（openFence 分支单独处理），但避免把连续反引号误判为行内 code
      let run = 1;
      while (i + run < tail.length && tail[i + run] === '`') run++;
      if (run >= 3) {
        i += run - 1;
        continue;
      }
      const opened = has('code');
      if (opened) spliceTag('code');
      else pushTag('code');
    } else if (ch === '*') {
      let run = 1;
      while (i + run < tail.length && tail[i + run] === '*') run++;
      // *** 不被本渲染器支持，跳过以免误判；行内 code 内的星号不参与判定
      if (run >= 3 || has('code')) {
        i += run - 1;
        continue;
      }
      const tag = run >= 2 ? 'strong' : 'em';
      const prev = i > 0 ? tail[i - 1] : undefined;
      const next = i + run < tail.length ? tail[i + run] : undefined;
      // CommonMark flanking 近似：开启需行首/空白后紧跟非空白；其余情形视为潜在闭合
      const looksOpen =
        (prev === undefined || /\s/.test(prev)) && next !== undefined && next !== '*' && !/\s/.test(next);
      if (looksOpen) {
        if (has(tag)) spliceTag(tag);
        else pushTag(tag);
      } else if (has(tag)) {
        spliceTag(tag);
      }
      i += run - 1;
    }
  }
  let repaired = tail;
  // 按开启顺序逆序补全（LIFO），使嵌套标记先关内层；相邻闭合符间补空格，
  // 避免 `*` + `**` 粘连成渲染器不支持的 `***`（嵌套场景至少保住内层可渲染）
  for (let k = stack.length - 1; k >= 0; k--) {
    const closer = stack[k] === 'code' ? '`' : stack[k] === 'strong' ? '**' : '*';
    if (/[*`]$/.test(repaired) && /^[*`]/.test(closer)) repaired += ' ';
    repaired += closer;
  }
  return repaired;
}

/** 内联格式：解析 `code` / **bold** / *italic* 为 React 节点（无 innerHTML） */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
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
            px: 0.5,
            py: 0.1,
            borderRadius: 0.5,
            bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
          }}
        >
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
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
        <Typography
          key={key}
          variant="caption"
          sx={{
            display: 'block',
            fontWeight: 700,
            fontSize: 12 + (4 - level) * 0.5,
            mt: 0.5,
            mb: 0.25,
            color: 'text.primary',
          }}
        >
          {renderInline(h[2], key)}
        </Typography>
      );
    }
    // 列表
    const listItems = trimmed.split('\n').filter((l) => /^(\s*[-*]\s+|\s*\d+\.\s+)/.test(l));
    if (listItems.length > 0 && listItems.length === trimmed.split('\n').length) {
      return (
        <Box key={key} component="ul" sx={{ pl: 2.5, my: 0.25, listStyleType: 'disc' }}>
          {listItems.map((li, lii) => {
            const content = li.replace(/^(\s*[-*]\s+|\s*\d+\.\s+)/, '');
            return (
              <li key={`${key}-li${lii}`}>
                <Typography
                  variant="caption"
                  component="span"
                  sx={{
                    display: 'block',
                    fontSize: 11.5,
                    lineHeight: 1.5,
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
    // 普通段落
    return (
      <Typography
        key={key}
        variant="caption"
        component="p"
        sx={{
          display: 'block',
          fontSize: 11.5,
          lineHeight: 1.55,
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

export interface MarkdownViewProps {
  content: string;
  /** 代码块「插入光标」回调（仅 edit/agent 模式且编辑器可用时启用） */
  onCodeInsert?: (meta: CodeBlockMeta) => void;
  /** 代码块「应用到文件」回调（diff 预览） */
  onCodeApply?: (meta: CodeBlockMeta) => void;
  /** 是否启用插入/应用按钮 */
  canApply?: boolean;
  /** 流式增量模式：稳定前缀增量渲染（历史代码块不再全量重新高亮）、未闭合围栏/尾段按字面渲染 */
  streaming?: boolean;
}

function CodeBlockCard({
  meta,
  onCodeInsert,
  onCodeApply,
  canApply,
}: { meta: CodeBlockMeta } & Pick<MarkdownViewProps, 'onCodeInsert' | 'onCodeApply' | 'canApply'>) {
  const dark = useTheme().palette.mode === 'dark';
  const [copied, setCopied] = React.useState(false);
  // 语法高亮（对标 VS Code Copilot Chat 代码块）：零依赖、零 innerHTML。
  // 仅当内容变化/主题切换时重算，避免复制按钮状态变更触发整块重 token 化。
  const highlighted = React.useMemo(
    () => highlightCode(meta.code, meta.lang || 'plaintext', dark),
    [meta.code, meta.lang, dark],
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
    ? `${meta.path}${meta.line ? ':' + meta.line + (meta.endLine ? '-' + meta.endLine : '') : ''}`
    : null;
  // 应用落点透明化：让用户在点击「应用到文件」前就看清这段代码会被写到哪（VS Code 式）。
  // 代码块头没声明 path 时，一律落到「当前打开的文件」——与 onCodeApply 的解析口径一致。
  const applyTarget = meta.path ?? t('workbench.aiCode.currentFile');
  return (
    <Box
      sx={{
        my: 0.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: (th) => (th.palette.mode === 'dark' ? '#0d1117' : '#f6f8fa'),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.4,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontSize: 9.5,
            fontWeight: 600,
            color: 'text.secondary',
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {meta.lang || 'code'}
          {target ? ` · ${target}` : ''}
        </Typography>
        {canApply && (
          <Typography
            variant="caption"
            sx={{
              fontSize: 9.5,
              color: 'text.secondary',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            → {applyTarget}
          </Typography>
        )}
        {canApply && onCodeInsert && (
          <Tooltip title={t('workbench.aiCode.insert')}>
            <IconButton
              size="small"
              sx={{ p: 0.25 }}
              onClick={() => onCodeInsert?.(meta)}
              aria-label={t('workbench.aiCode.insert')}
            >
              <NorthWestIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {canApply && onCodeApply && (
          <Tooltip title={t('workbench.aiCode.apply')}>
            <IconButton
              size="small"
              sx={{ p: 0.25 }}
              onClick={() => onCodeApply?.(meta)}
              aria-label={t('workbench.aiCode.apply')}
            >
              <FileUploadIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={copied ? t('workbench.aiCode.copied') : t('workbench.aiCode.copy')}>
          <IconButton
            size="small"
            sx={{ p: 0.25 }}
            onClick={copy}
            aria-label={copied ? t('workbench.aiCode.copied') : t('workbench.aiCode.copy')}
          >
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          fontSize: 11,
          lineHeight: 1.45,
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

/** 将正文解析为 React 节点（key 从 keyBase 起递增，供增量缓存合并时保证 key 唯一） */
function buildNodes(props: MarkdownViewProps, content: string, keyBase: number): React.ReactNode[] {
  return parseBlocks(content).map((n, idx) => {
    const key = keyBase + idx;
    return n.type === 'code' ? (
      <CodeBlockCard
        key={key}
        meta={n.meta}
        onCodeInsert={props.onCodeInsert}
        onCodeApply={props.onCodeApply}
        canApply={props.canApply}
      />
    ) : (
      <React.Fragment key={key}>{renderText(n.value, `n${key}`)}</React.Fragment>
    );
  });
}

// 流式增量缓存：key = 已渲染的稳定前缀文本（确定性纯函数缓存，跨组件实例/重渲染安全）。
// 只保留最近 STREAMING_CACHE_LIMIT 条，防止长时间流式内存膨胀（对齐 openclaw 的 STREAMING_CACHE_LIMIT）。
const STREAMING_CACHE_LIMIT = 8;
const streamingStableCache = new Map<string, React.ReactNode[]>();

/**
 * 渲染流式稳定前缀：命中最长已渲染前缀时增量追加（历史节点引用不变 → CodeBlockCard 的
 * useMemo 高亮不重算、整棵树不重建）；前缀断裂（服务端重置/回退）时全量重建。
 */
function renderStreamingStable(props: MarkdownViewProps, stable: string): React.ReactNode[] {
  if (!stable) return [];
  let best: { key: string; nodes: React.ReactNode[] } | null = null;
  for (const [key, nodes] of streamingStableCache) {
    if (key.length === 0) continue;
    if (best && key.length <= best.key.length) continue;
    if (stable.startsWith(key)) best = { key, nodes };
  }
  let nodes: React.ReactNode[];
  if (best) {
    // 增量：只解析新增片段
    const added = stable.slice(best.key.length);
    const addedNodes = added ? buildNodes(props, added, best.nodes.length) : [];
    nodes = [...best.nodes, ...addedNodes];
  } else {
    nodes = buildNodes(props, stable, 0);
  }
  streamingStableCache.set(stable, nodes);
  if (streamingStableCache.size > STREAMING_CACHE_LIMIT) {
    const oldest = streamingStableCache.keys().next().value;
    if (oldest !== undefined) streamingStableCache.delete(oldest);
  }
  return nodes;
}

/** 流式增量渲染：稳定前缀缓存复用（新增 chunk 只解析增量，历史代码块不重新高亮）；尾部按字面渲染 */
function StreamingMarkdown(props: MarkdownViewProps) {
  const { content } = props;
  const { stable, tail, openFence } = React.useMemo(() => splitStreamingMarkdown(content), [content]);
  const stableNodes = React.useMemo(
    () => renderStreamingStable(props, stable),
    // props 其余字段（content）不参与缓存键：内容变化由 stable 驱动，回调变化才重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stable, props.onCodeInsert, props.onCodeApply, props.canApply],
  );
  const tailNode = React.useMemo(() => {
    if (!tail) return null;
    if (openFence) {
      // 未闭合代码围栏：去掉围栏头行，按等宽字面渲染，不吞围栏后的内容；生成的代码实时可见
      const body = tail.replace(/^```[^\n]*\n?/, '');
      return (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1,
            fontSize: 11,
            lineHeight: 1.45,
            fontFamily: 'monospace',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'text.primary',
            bgcolor: (th) => (th.palette.mode === 'dark' ? '#0d1117' : '#f6f8fa'),
          }}
        >
          {body}
        </Box>
      );
    }
    // 未空行收束的尾段：先修补未闭合的行内标记（对标 openclaw remend，避免星号/反引号闪烁），
    // 再按段落字面渲染（内联标记未闭合时原样显示，不闪烁）
    return <Box sx={{ fontSize: 11.5 }}>{renderText(repairStreamingTailInline(tail), 'tail')}</Box>;
  }, [tail, openFence]);

  return (
    <Box sx={{ fontSize: 11.5 }}>
      {stableNodes}
      {tailNode}
    </Box>
  );
}

/** 静态模式（非流式）：每次 content 变化全量解析（历史消息/终稿） */
function StaticMarkdown({ content, onCodeInsert, onCodeApply, canApply }: MarkdownViewProps) {
  const nodes = React.useMemo(() => parseBlocks(content), [content]);
  return (
    <Box sx={{ fontSize: 11.5 }}>
      {nodes.map((n, idx) =>
        n.type === 'code' ? (
          <CodeBlockCard
            key={idx}
            meta={n.meta}
            onCodeInsert={onCodeInsert}
            onCodeApply={onCodeApply}
            canApply={canApply}
          />
        ) : (
          <React.Fragment key={idx}>{renderText(n.value, `n${idx}`)}</React.Fragment>
        ),
      )}
    </Box>
  );
}

export function MarkdownView(props: MarkdownViewProps) {
  if (props.streaming) return <StreamingMarkdown {...props} />;
  return <StaticMarkdown {...props} />;
}
