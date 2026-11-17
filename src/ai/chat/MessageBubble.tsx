// sight-folio: AI 对话页消息气泡（用户 / 助手）
//
// 从 AiAgentPage 内联实现提取为独立组件，并升级：
// - 助手消息正文走 ChatMarkdown（代码块高亮 + 复制 + 标题/列表/引用/链接）
// - 用户消息保持纯文本渲染，气泡视觉与助手一致
// - 支持流式光标（isStreaming 且内容在更新时显示 ▍ 光标）
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { uiFontSize } from '../../theme/appearanceScales';
import { ChatMarkdown } from './ChatMarkdown';
import { ToolCallCard } from './ToolCallCard';
import type { ToolCallEvent } from '../../services/tauri';

/** 消息入场动画：淡入 + 微上移 */
const entranceSx = {
  '@keyframes msgEnter': {
    from: { opacity: 0, transform: 'translateY(8px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  animation: 'msgEnter 0.35s ease-out',
};

export interface MessageBubbleProps {
  /** 消息角色：user / assistant */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** 消息正文 */
  content: string;
  /** 创建时间戳（ms） */
  createdAt?: number;
  /** 是否为流式输出中的增量内容（显示光标） */
  isStreaming?: boolean;
  /** 消息携带的工具调用（JSON 字符串，如 AiMessage.toolCalls） */
  toolCalls?: string | null;
}

/** 流式光标：随内容渲染在末尾的短暂闪烁块 */
function StreamCursor() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 15,
        verticalAlign: 'text-bottom',
        ml: 0.5,
        borderRadius: 1,
        bgcolor: 'primary.main',
        animation: 'chatCursorBlink 1s step-end infinite',
        '@keyframes chatCursorBlink': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0 } },
      }}
    />
  );
}

/**
 * 单条消息气泡。
 * - 用户消息右侧主色气泡；助手消息左侧浅色气泡，正文 Markdown 渲染。
 * - 消息携带工具调用时，在正文上方渲染工具卡片列表。
 * - 空内容（纯工具调用）不渲染正文气泡，只保留工具卡与时间戳。
 */
export function MessageBubble({ role, content, createdAt, isStreaming, toolCalls }: MessageBubbleProps) {
  const isUser = role === 'user';
  const hasBody = Boolean(content && content.trim());

  let parsedToolCalls: ToolCallEvent[] | null = null;
  if (toolCalls) {
    try {
      const parsed = JSON.parse(toolCalls);
      parsedToolCalls = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // 容错：无法解析的工具调用串忽略
    }
  }

  return (
    <Box
      sx={{
        mb: 1.5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        maxWidth: 900,
        mx: 'auto',
        width: '100%',
        ...entranceSx,
      }}
    >
      {parsedToolCalls?.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
      {hasBody && (
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderRadius: 2.5,
            bgcolor: isUser ? 'primary.main' : 'background.paper',
            color: isUser ? 'primary.contrastText' : 'text.primary',
            border: isUser ? 'none' : 1,
            borderColor: 'divider',
            maxWidth: '88%',
            minWidth: 80,
            boxShadow: isUser ? '0 2px 8px rgb(var(--template-palette-primary-mainChannel) / 0.2)' : 'none',
            overflowWrap: 'break-word',
          }}
        >
          {isUser ? (
            <Typography
              sx={{ fontSize: uiFontSize(14), lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {content}
            </Typography>
          ) : (
            <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
              <ChatMarkdown content={content} streaming={isStreaming} />
              {isStreaming && <StreamCursor key="cursor" />}
            </Box>
          )}
        </Box>
      )}
      {createdAt ? (
        <Typography variant="caption" sx={{ fontSize: uiFontSize(11), color: 'text.disabled', mt: 0.5, px: 1 }}>
          {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Typography>
      ) : null}
    </Box>
  );
}

export default MessageBubble;
