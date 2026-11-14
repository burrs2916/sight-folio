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
// - 渲染（第 40 轮批次 3）：助手回复走 aiMarkdown.MarkdownView（标题/列表/代码块/内联标记 +
//   流式尾修补），fontSize=13 保持对话弹窗正文视觉不回归；用户消息保持纯文本 pre-wrap
//   （用户输入不跑 Markdown，防 * _ ` 被误解析）。字号全走 uiFontSize() 吃字体档位。
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
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import { agentApi, type AiMessage } from '../services/tauri';
import { useAgentStore } from '../store/agentStore';
import { useWritingStore } from '../store/writingStore';
import { aiChatEmptyKey } from '../utils/writingSchema';
import { useToastStore } from '../store/toastStore';
import { t } from '../i18n';
import { logger } from '../utils/logger';
import { sanitizeDisplayMessages } from '../utils/aiCorpusChat';
import { uiFontSize } from '../theme/appearanceScales';
import { MarkdownView } from '../editor/panels/aiMarkdown';

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
  /** C3：外部预填消息——打开后自动作为一条用户消息发送（仅当值变化时触发一次，成功后消费） */
  initialMessage?: string;
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
  initialMessage,
}: WritingAiChatDialogProps) {
  // 空态那句按**当前体裁**整句换（⑰-1）：对诗人问「想聊哪条伏笔线」是废话。
  // 取原始字符串订阅（genre 是 string，不会引起额外重渲染）。
  const chatGenre = useWritingStore((s) => s.books.find((b) => b.id === s.activeBookId)?.genre ?? '');
  const agents = useAgentStore((s) => s.agents);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  // 流归属：streamingContent/isStreaming 是全局状态，同窗口多 AI 入口共享——
  // 只有「最新一轮流式属于本面板会话」时才渲染气泡/停止/错误，防止别处发起的流串台。
  const currentStreamConversationId = useAgentStore((s) => s.currentStreamConversationId);
  const lastStreamError = useAgentStore((s) => s.lastStreamError);
  const stoppedConversationId = useAgentStore((s) => s.stoppedConversationId);
  const noAgent = agents.length === 0;
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 最近一次本面板发起的请求（用户原文 + 实际发送内容），供错误态「重试」原样重发 */
  const lastSendRef = useRef<{ text: string; content: string } | null>(null);

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
        const mine = convs.filter((c) => c.title === chatTitle).sort((a, b) => b.updatedAt - a.updatedAt);
        const conv = mine[0] ?? (await agentApi.createConversation(agentId, chatTitle));
        if (cancelled) return;
        setConvId(conv.id);
        const rows = await agentApi.listMessages(conv.id);
        if (cancelled) return;
        // 展示层剥离：user 消息含首轮注入的写作上下文前缀，仅渲染用户原文与助手输出
        setMessages(sanitizeDisplayMessages(rows));
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

  // 新内容到达自动滚底（智能：仅近底时跟随，用户上翻阅读不被拉回；60ms 防抖）
  const isNearBottomRef = useRef(true);
  const scrollTimerRef = useRef<number | null>(null);
  const handleListScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const el = scrollRef.current;
      if (el && isNearBottomRef.current) el.scrollTop = el.scrollHeight;
    }, 60);
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [messages, streamText, isStreaming]);

  /** 发送一条用户消息：乐观插入 + 首轮注入上下文 + sendMessage + 刷新历史（输入框写入由调用方负责） */
  const sendText = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || !convId || isStreaming) return;
      // 本地乐观插入用户消息（显示原始输入；上下文前缀只在真正发出的消息里）
      setMessages((m) => [
        ...m,
        {
          id: `local_${Date.now()}`,
          conversationId: convId,
          role: 'user',
          content: trimmed,
          toolCalls: null,
          createdAt: Date.now(),
        },
      ]);
      try {
        // 首轮（无历史）自动注入写作上下文；后续轮次靠对话历史延续
        const content = messages.length === 0 ? `${buildContextBlock()}\n\n---\n\n${trimmed}` : trimmed;
        lastSendRef.current = { text: trimmed, content };
        // 直读 API 建会话不进 store.conversations、写作台窗口不设置 selectedAgentId——
        // 必须显式传 agentId（本对话框自己在 props 里持有），否则 store 无法推导 agent 归属会放弃发送
        await useAgentStore.getState().sendMessage(convId, content, undefined, undefined, agentId);
        const after = useAgentStore.getState();
        if (after.stoppedConversationId === convId) {
          setStreamText('');
          const rows = await agentApi.listMessages(convId);
          setMessages(sanitizeDisplayMessages(rows));
          return;
        }
        const rows = await agentApi.listMessages(convId);
        setMessages(sanitizeDisplayMessages(rows));
        setStreamText('');
      } catch (e) {
        logger.warn('WritingPage', 'chat send failed', { error: e });
        useToastStore.getState().error(String(e));
      }
    },
    [convId, isStreaming, messages.length, buildContextBlock, agentId],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !convId || isStreaming) return;
    setInput('');
    await sendText(text);
  }, [input, convId, isStreaming, sendText]);

  // C3 外部预填：initialMessage 值变化且会话就绪时自动发送一次（sentInitialRef 防对相同内容重复发）。
  // 会话未就绪（convId 未建立/在流式中）时不消费，等依赖变化后重试；发送成功才记入 sentInitialRef。
  const sentInitialRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (!initialMessage || initialMessage === sentInitialRef.current) return;
    if (!convId || isStreaming) return;
    sentInitialRef.current = initialMessage;
    void sendText(initialMessage);
  }, [open, initialMessage, convId, isStreaming, sendText]);

  // 错误态「重试」：原样重发最近一次内容（首轮含上下文注入；不重复乐观插入）
  const retryLastTurn = useCallback(async () => {
    if (!lastSendRef.current || !convId || isStreaming) return;
    try {
      // 重试同样显式传 agentId（见 handleSend 注释：直读 API 面板不能依赖 store 推导）
      await useAgentStore.getState().sendMessage(convId, lastSendRef.current.content, undefined, undefined, agentId);
      const after = useAgentStore.getState();
      if (after.stoppedConversationId === convId) {
        setStreamText('');
        return;
      }
      const rows = await agentApi.listMessages(convId);
      setMessages(sanitizeDisplayMessages(rows));
      setStreamText('');
    } catch (e) {
      logger.warn('WritingPage', 'chat retry failed', { error: e });
      useToastStore.getState().error(String(e));
    }
  }, [convId, isStreaming, agentId]);

  // 本面板会话「正在进行中的流」：全局闸门外再加归属校验，防止别处流串台
  const isOwnStreaming = isStreaming && currentStreamConversationId === convId;

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
        <Typography component="span" sx={{ fontSize: uiFontSize(15), fontWeight: 700, flex: 1 }}>
          {t('writing.aiChatTitle')}
        </Typography>
        <Select
          size="small"
          value={agentId || ''}
          onChange={(e) => onAgentChange(e.target.value)}
          sx={{ fontSize: uiFontSize(12.5), '& .MuiSelect-select': { py: 0.5, fontSize: uiFontSize(12.5) } }}
          disabled={isStreaming}
        >
          {agents.map((a) => (
            <MenuItem key={a.id} value={a.id} sx={{ fontSize: uiFontSize(12.5) }}>
              {a.name}
            </MenuItem>
          ))}
        </Select>
        <IconButton
          size="small"
          onClick={isStreaming ? undefined : handleNewChat}
          title={t('writing.aiChatNew')}
          data-testid="ai-chat-new"
          aria-label={t('writing.aiChatNew')}
        >
          <AddRoundedIcon sx={{ fontSize: uiFontSize(17) }} />
        </IconButton>
        <IconButton size="small" onClick={onClose} aria-label={t('writing.aiChatClose')}>
          <CloseRoundedIcon sx={{ fontSize: uiFontSize(18) }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          ref={scrollRef}
          onScroll={handleListScroll}
          sx={{ height: CHAT_MAX_HEIGHT, overflowY: 'auto', px: 2, py: 1.5 }}
        >
          {/* 流错误 / 停止回执（本面板会话专属；错误优先于停止） */}
          {!loading && !noAgent && !isStreaming && lastStreamError && currentStreamConversationId === convId && (
            <Box sx={{ mb: 1 }}>
              <Alert
                severity="error"
                variant="outlined"
                sx={{ fontSize: uiFontSize(12), '& .MuiAlert-message': { py: 0.25 } }}
                action={
                  <Button
                    size="small"
                    color="error"
                    startIcon={<ReplayRoundedIcon sx={{ fontSize: uiFontSize(14) }} />}
                    onClick={() => void retryLastTurn()}
                    data-testid="ai-chat-error-retry"
                  >
                    {t('ui.retry')}
                  </Button>
                }
              >
                {lastStreamError === 'timeout' ? t('writing.aiTimeout') : lastStreamError}
              </Alert>
            </Box>
          )}
          {!loading && !noAgent && !isStreaming && !lastStreamError && stoppedConversationId === convId && (
            <Box sx={{ mb: 1 }}>
              <Chip
                size="small"
                icon={<StopRoundedIcon sx={{ fontSize: uiFontSize(12) }} />}
                label={t('writing.aiStopped')}
                color="error"
                variant="outlined"
                sx={{ fontSize: uiFontSize(10.5), height: 20 }}
              />
            </Box>
          )}
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : noAgent ? (
            // 边界缺口修复：无 agent 时原先是死面板（输入/建会话全无响应）——给引导出口
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 6 }}>
              <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                {t('writing.aiNoAgent')}
              </Typography>
              <Button size="small" variant="outlined" onClick={onOpenSettings}>
                {t('writing.aiGoConfigure')}
              </Button>
            </Box>
          ) : messages.length === 0 && !isStreaming ? (
            <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary', textAlign: 'center', py: 6 }}>
              {t(aiChatEmptyKey(chatGenre))}
            </Typography>
          ) : (
            <>
              {messages.map((m) => (
                <Box
                  key={m.id}
                  sx={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', mb: 1 }}
                >
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
                    {m.role === 'user' ? (
                      <Typography sx={{ fontSize: uiFontSize(13), lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                        {m.content}
                      </Typography>
                    ) : (
                      <MarkdownView content={m.content} fontSize={13} />
                    )}
                  </Box>
                </Box>
              ))}
              {isOwnStreaming && streamText && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
                  <Box sx={{ maxWidth: '86%', px: 1.25, py: 0.75, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <MarkdownView content={streamText} fontSize={13} canApply={false} streaming />
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
              sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(13) } }}
            />
            {isOwnStreaming ? (
              <IconButton
                color="error"
                onClick={() => useAgentStore.getState().requestInterrupt()}
                size="small"
                sx={{ flexShrink: 0 }}
                data-testid="ai-chat-stop"
                aria-label={t('writing.aiChatStop')}
              >
                <StopRoundedIcon />
              </IconButton>
            ) : (
              <IconButton
                color="primary"
                disabled={!canSend}
                onClick={() => void handleSend()}
                size="small"
                sx={{ flexShrink: 0 }}
                data-testid="ai-chat-send"
                aria-label={t('writing.aiChatSend')}
              >
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
