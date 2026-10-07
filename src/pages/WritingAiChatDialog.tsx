// 写作台 AI 对话面板（D：对话式 AI，修复 P1-5「自由问答无处安放」）
//
// 设计要点：
// - 会话策略：per (agentId, 书) 复用同名会话「{chatTitle}」——打开时 listConversations 找同名
//   最新会话，没有才 createConversation；历史消息直读 agentApi.listMessages 存本地 state，
//   **完全不碰 store.messages**（避免与 AI 页当前会话互相污染；写作台独立窗口/store 双场景都安全）。
// - 上下文注入：会话首轮（本地无历史）发送时自动把 buildContextBlock() 的写作上下文
//   （书名/当前章尾部正文/人物档案语料）拼在用户输入前；后续轮次靠对话历史延续。
//   「新会话」按钮清空本地会话句柄，下一条消息触发重建 + 重新注入。
// - 流式：订阅 store.streamingContent（与内联任务同通道，isStreaming 并发闸门保证唯一流），
//   isStreaming 期间在消息尾渲染流式气泡；停止走 requestInterrupt（全局先例）。
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { agentApi, type AiMessage } from '../services/tauri';
import { useAgentStore } from '../store/agentStore';
import { useToastStore } from '../store/toastStore';
import { t } from '../i18n';
import { logger } from '../utils/logger';

export interface WritingAiChatDialogProps {
  open: boolean;
  onClose: () => void;
  /** 会话标题（per 书唯一：「写作台 · 书名」），用于复用历史会话 */
  chatTitle: string;
  /** 首轮发送时自动注入的写作上下文（WritingPage 构建，L() 双语） */
  buildContextBlock: () => string;
  agentId: string;
  onAgentChange: (agentId: string) => void;
  /** 未配置任何 agent 时的「去配置」出口（desk 窗口内走 open-ai-settings 事件由主窗口接管） */
  onOpenSettings?: () => void;
}

const CHAT_MAX_HEIGHT = 460;

export function WritingAiChatDialog({
  open,
  onClose,
  chatTitle,
  buildContextBlock,
  agentId,
  onAgentChange,
  onOpenSettings,
}: WritingAiChatDialogProps) {
  const agents = useAgentStore((s) => s.agents);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const noAgent = agents.length === 0;
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 流式预览：open 期间常驻订阅（isStreaming 才渲染气泡，避免残留文本误显）
  useEffect(() => {
    if (!open) return;
    return useAgentStore.subscribe((s) => setStreamText(s.streamingContent));
  }, [open]);

  // 打开（或切 agent）→ 复用同名会话；直读 API 存本地，不碰 store.messages
  useEffect(() => {
    if (!open || !agentId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const convs = await agentApi.listConversations(agentId);
        const mine = convs
          .filter((c) => c.title === chatTitle)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const conv = mine[0] ?? (await agentApi.createConversation(agentId, chatTitle));
        if (cancelled) return;
        setConvId(conv.id);
        const rows = await agentApi.listMessages(conv.id);
        if (cancelled) return;
        setMessages(rows.filter((m) => m.role === 'user' || m.role === 'assistant'));
      } catch (e) {
        logger.warn('WritingPage', 'chat open failed', { error: e });
        useToastStore.getState().error(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, agentId, chatTitle]);

  // 新内容到达自动滚底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamText, isStreaming]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !convId || isStreaming) return;
    setInput('');
    // 本地乐观插入用户消息（显示原始输入；上下文前缀只在真正发出的消息里）
    setMessages((m) => [
      ...m,
      { id: `local_${Date.now()}`, conversationId: convId, role: 'user', content: text, toolCalls: null, createdAt: Date.now() },
    ]);
    try {
      // 首轮（无历史）自动注入写作上下文；后续轮次靠对话历史延续
      const content = messages.length === 0 ? `${buildContextBlock()}\n\n---\n\n${text}` : text;
      await useAgentStore.getState().sendMessage(convId, content);
      const after = useAgentStore.getState();
      if (after.stoppedConversationId === convId) {
        setStreamText('');
        const rows = await agentApi.listMessages(convId);
        setMessages(rows.filter((m) => m.role === 'user' || m.role === 'assistant'));
        return;
      }
      const rows = await agentApi.listMessages(convId);
      setMessages(rows.filter((m) => m.role === 'user' || m.role === 'assistant'));
      setStreamText('');
    } catch (e) {
      logger.warn('WritingPage', 'chat send failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, [input, convId, isStreaming, messages.length, buildContextBlock]);

  const handleCreateNew = useCallback(async () => {
    if (!agentId) return;
    try {
      const conv = await agentApi.createConversation(agentId, chatTitle);
      setConvId(conv.id);
      setMessages([]);
      setStreamText('');
    } catch (e) {
      useToastStore.getState().error(String(e));
    }
  }, [agentId, chatTitle]);

  // 新会话：立即建新会话（清空历史，首条消息重新注入上下文）；旧同名会话保留不删（零强制）
  const handleNewChat = useCallback(() => {
    void handleCreateNew();
  }, [handleCreateNew]);

  const canSend = input.trim().length > 0 && convId !== null && !isStreaming;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}>
        <Typography component="span" sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t('writing.aiChatTitle')}
        </Typography>
        <Select
          size="small"
          value={agentId || ''}
          onChange={(e) => onAgentChange(e.target.value)}
          sx={{ fontSize: 12.5, '& .MuiSelect-select': { py: 0.5, fontSize: 12.5 } }}
          disabled={isStreaming}
        >
          {agents.map((a) => (
            <MenuItem key={a.id} value={a.id} sx={{ fontSize: 12.5 }}>
              {a.name}
            </MenuItem>
          ))}
        </Select>
        <IconButton size="small" onClick={isStreaming ? undefined : handleNewChat} title={t('writing.aiChatNew')} data-testid="ai-chat-new" aria-label={t('writing.aiChatNew')}>
          <AddRoundedIcon sx={{ fontSize: 17 }} />
        </IconButton>
        <IconButton size="small" onClick={onClose} aria-label={t("writing.aiChatClose")}>
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        <Box ref={scrollRef} sx={{ height: CHAT_MAX_HEIGHT, overflowY: 'auto', px: 2, py: 1.5 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : noAgent ? (
            // 边界缺口修复：无 agent 时原先是死面板（输入/建会话全无响应）——给引导出口
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 6 }}>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{t('writing.aiNoAgent')}</Typography>
              <Button size="small" variant="outlined" onClick={onOpenSettings}>
                {t('writing.aiGoConfigure')}
              </Button>
            </Box>
          ) : messages.length === 0 && !isStreaming ? (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', py: 6 }}>
              {t('writing.aiChatEmpty')}
            </Typography>
          ) : (
            <>
              {messages.map((m) => (
                <Box key={m.id} sx={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', mb: 1 }}>
                  <Box
                    sx={{
                      maxWidth: '86%',
                      px: 1.25,
                      py: 0.75,
                      borderRadius: 2,
                      bgcolor: m.role === 'user' ? 'primary.main' : 'action.hover',
                      color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
                    }}
                  >
                    <Typography sx={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
                  </Box>
                </Box>
              ))}
              {isStreaming && streamText && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
                  <Box sx={{ maxWidth: '86%', px: 1.25, py: 0.75, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{streamText}</Typography>
                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>
        {!noAgent && (
          <Box sx={{ display: 'flex', gap: 1, px: 2, pb: 1.5, pt: 0.5, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={1}
            maxRows={4}
            placeholder={t('writing.aiChatPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter 发送 / Shift+Enter 换行（聊天惯例）
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) void handleSend();
              }
            }}
            sx={{ '& .MuiInputBase-input': { fontSize: 13 } }}
          />
          {isStreaming ? (
            <IconButton color="error" onClick={() => useAgentStore.getState().requestInterrupt()} size="small" sx={{ flexShrink: 0 }} data-testid="ai-chat-stop" aria-label={t("writing.aiChatStop")}>
              <StopRoundedIcon />
            </IconButton>
          ) : (
            <IconButton color="primary" disabled={!canSend} onClick={() => void handleSend()} size="small" sx={{ flexShrink: 0 }} data-testid="ai-chat-send" aria-label={t("writing.aiChatSend")}>
              <SendRoundedIcon />
            </IconButton>
          )}
        </Box>
        )}
        {convId === null && !loading && !noAgent && (
          <Box sx={{ px: 2, pb: 1.5 }}>
            <Button size="small" variant="outlined" fullWidth onClick={() => void handleCreateNew()}>
              {t('writing.aiChatStart')}
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
