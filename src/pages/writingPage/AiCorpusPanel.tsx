// 写作台 AI 语料面板（语料参考区「AI 语料」标签页）
//
// 设计要点（对应「AI 语料标签页功能分析」P0/P1/P2）：
// - 与「语料库」Tab 并列的第二标签页：库里没有现成句子时，由 AI 基于整篇作品 +
//   本章上下文生成参考语料（P2 一键生成），或通过对话给用户参考决策建议（P1 对话参谋）。
// - 双子模式（Segment）：对话（P1）/ 生成（P2）。对话保留输入框与快捷 chip；
//   生成用条数+用途轻参数一键批量产出「>>> 」推荐句卡片，可插入/复制/换一批。
// - 会话策略：per (agentId, 书) 复用同名会话「{chatTitle}」——与 WritingAiChatDialog
//   同一策略（find 同名最新 → 没有才 create；历史消息直读 agentApi.listMessages 存本地，
//   不碰 store.messages，避免与 AI 页互相污染）。
// - 上下文注入：首轮自动拼 AI_CORPUS_SYSTEM_HINT（语料参谋人设 + 「>>> 」推荐句输出约定）
//   + buildContextBlock()（整篇作品 + 当前章节，L() 双语），后续轮次靠对话历史延续；
//   「新会话」清空句柄，下一条消息重建 + 重新注入。
// - 推荐句闭环：AI 回复中「>>> 」开头的行由 extractAiCorpusPicks 解析为推荐句，
//   逐条带「插入」按钮经 onInsertText（复用 handleCorpusInsert）写回编辑器，
//   与语料库 Tab 同一条通路；本组件不碰编辑器。
// - 流式：订阅 store.streamingContent（与内联任务同通道，isStreaming 并发闸门保证唯一流），
//   isStreaming 期间在消息尾渲染流式气泡；停止走 requestInterrupt（全局先例）。
// - 零新增后端：会话、流式、agent 体系全部复用 agentApi / agentStore。
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import { alpha } from '@mui/material/styles';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { agentApi, corpusApi, type AiMessage } from '../../services/tauri';
import { useAgentStore } from '../../store/agentStore';
import { useToastStore } from '../../store/toastStore';
import { shiftEditIndexAfterDelete } from './corpusEditIndex';
import { t } from '../../i18n';
import { logger } from '../../utils/logger';
import {
  AI_CORPUS_SYSTEM_HINT,
  buildCorpusGeneratePrompt,
  buildCorpusEvidenceBlock,
  detectExampleRequest,
  extractAiCorpusPicks,
  sanitizeDisplayMessages,
  type CorpusGeneratePurpose,
} from '../../utils/aiCorpusChat';
import { isConvStale } from './conversationGuard';

export interface AiCorpusPanelProps {
  /** 会话标题（per 书唯一：「语料参谋 · 书名」），与写作台 AI 会话独立、不互相污染 */
  chatTitle: string;
  /** 首轮自动注入的写作上下文（整篇作品 + 当前章节，L() 双语） */
  buildContextBlock: () => string;
  /** 插入正文回调（复用 handleCorpusInsert，闭环与语料库 Tab 一致） */
  onInsertText: (text: string) => void;
  agentId: string;
  onAgentChange: (agentId: string) => void;
  /** 未配置任何 agent 时的「去配置」出口（desk 窗口内走 open-ai-settings 由主窗口接管） */
  onOpenSettings: () => void;
}

/** 预置快捷提问（降低冷启动门槛；点击即发送，首轮自动带整篇+本章上下文） */
const CHIP_KEYS = ['aiCorpusChipReference', 'aiCorpusChipTone', 'aiCorpusChipDraft'] as const;

/** 输入框快捷指令（对齐主流对话工具的 slash command：点击把指令模板填入输入框，可改后发送） */
const CMD_PRESETS: Array<{ labelKey: string; textKey: string }> = [
  { labelKey: 'aiCorpusCmdReference', textKey: 'aiCorpusCmdReferenceText' },
  { labelKey: 'aiCorpusCmdPolish', textKey: 'aiCorpusCmdPolishText' },
  { labelKey: 'aiCorpusCmdTone', textKey: 'aiCorpusCmdToneText' },
  { labelKey: 'aiCorpusCmdPlot', textKey: 'aiCorpusCmdPlotText' },
  { labelKey: 'aiCorpusCmdDialogue', textKey: 'aiCorpusCmdDialogueText' },
  { labelKey: 'aiCorpusCmdDeAIfy', textKey: 'aiCorpusCmdDeAIfyText' },
  { labelKey: 'aiCorpusCmdEmotion', textKey: 'aiCorpusCmdEmotionText' },
];

/** 对话草稿持久化键前缀：实际键为「前缀 + chatTitle」（按书隔离）。
 *  chatTitle 形如「语料参谋 · 书名」，切书时面板不卸载（WritingDrawer 常驻 body 分支），
 *  全局单键会让 A 书未发送的提问原样出现在 B 书输入框——与 genCards 按 chatTitle 隔离同口径。 */
const DRAFT_KEY_PREFIX = 'sight-folio:writing.aiCorpusDraft.';

/** 读取指定书的未发送草稿（存储不可读时按空处理） */
function loadDraft(title: string): string {
  try {
    return localStorage.getItem(DRAFT_KEY_PREFIX + title) ?? '';
  } catch {
    return '';
  }
}

/** 写入/清除指定书的未发送草稿（存储不可写时静默降级为会话内保留） */
function saveDraftFor(title: string, v: string) {
  try {
    if (v.trim()) localStorage.setItem(DRAFT_KEY_PREFIX + title, v);
    else localStorage.removeItem(DRAFT_KEY_PREFIX + title);
  } catch {
    // 忽略存储异常：本次会话内草稿仍在 state
  }
}

/** 生成结果持久化键前缀：「sight-folio:writing.aiCorpusGen.{chatTitle}」——生成结构当前子会话级
 *  volatile state（面板随 corpusTab 切换卸载即丢），落地到 localStorage 防止切走/重挂后丢失；
 *  语义与 DRAFT_KEY 同为「会话状态保留」，不落数据库（与 agent 会话历史解耦，换 agent 不影响）。 */
const GEN_KEY_PREFIX = 'sight-folio:writing.aiCorpusGen.';

interface GenPersistState {
  cards: string[];
  attempted: boolean;
  /** 持久化子模式：重挂载后回到用户离开时的视图（生成模式下才能看到生成结果） */
  mode: SubMode;
  /** 就地编辑中断断点：编辑中切走 tab/重挂载后恢复未保存草稿（idx 越界视为失效丢弃） */
  editing?: { idx: number; draft: string } | null;
}

/** 读取某本书的生成结果持久化（损坏/缺失返回空态，不抛出） */
function loadGenPersist(title: string): GenPersistState | null {
  try {
    const raw = localStorage.getItem(GEN_KEY_PREFIX + title);
    if (!raw) return null;
    const p = JSON.parse(raw) as GenPersistState;
    if (!Array.isArray(p.cards)) return null;
    const cards = p.cards.filter((x) => typeof x === 'string');
    // 编辑断点仅在 idx 指向存在的卡片时有效（卡片被删/换一批后丢弃悬空草稿）
    const e = p.editing;
    const editing =
      e && typeof e.idx === 'number' && e.idx >= 0 && e.idx < cards.length && typeof e.draft === 'string'
        ? { idx: e.idx, draft: e.draft }
        : null;
    return {
      cards,
      attempted: Boolean(p.attempted),
      mode: p.mode === 'generate' ? 'generate' : 'chat',
      editing,
    };
  } catch {
    return null;
  }
}

/** 写入某本书的生成结果持久化（存储不可写时静默降级为会话内保留） */
function saveGenPersist(title: string, p: GenPersistState) {
  try {
    if (p.cards.length === 0 && !p.attempted) localStorage.removeItem(GEN_KEY_PREFIX + title);
    else localStorage.setItem(GEN_KEY_PREFIX + title, JSON.stringify(p));
  } catch {
    // 存储不可写（隐私模式等）：生成结果仅在本次会话内保留
  }
}

/** 子模式：对话（P1）/ 生成（P2） */
type SubMode = 'chat' | 'generate';

/** 生成用途：默认智能 / 对白 / 动作 / 环境 */
const PURPOSE_KEYS: Array<{ value: CorpusGeneratePurpose; labelKey: string }> = [
  { value: 'auto', labelKey: 'aiCorpusPurposeDefault' },
  { value: 'dialogue', labelKey: 'aiCorpusPurposeDialogue' },
  { value: 'action', labelKey: 'aiCorpusPurposeAction' },
  { value: 'scene', labelKey: 'aiCorpusPurposeScene' },
];

export function AiCorpusPanel({
  chatTitle,
  buildContextBlock,
  onInsertText,
  agentId,
  onAgentChange,
  onOpenSettings,
}: AiCorpusPanelProps) {
  const agents = useAgentStore((s) => s.agents);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  // 流归属：streamingContent/isStreaming 是全局状态，同窗口多 AI 入口共享——
  // 只有「最新一轮流式属于本面板会话」时才渲染气泡/停止/错误，防止别处发起的流串台。
  const currentStreamConversationId = useAgentStore((s) => s.currentStreamConversationId);
  const lastStreamError = useAgentStore((s) => s.lastStreamError);
  const stoppedConversationId = useAgentStore((s) => s.stoppedConversationId);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const noAgent = agents.length === 0;
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  // convId 的实时镜像：供 await 之后比对「发起时会话是否已被切走」（见 conversationGuard）。
  // 不能只靠闭包里的 convId——那是发起时的值，需要另一个渠道读「当下」的值。
  const convIdRef = useRef<string | null>(convId);
  useEffect(() => {
    convIdRef.current = convId;
  }, [convId]);
  const [loading, setLoading] = useState(false);
  // 草稿自动保存（对齐主流对话工具：输入内容跨会话/切标签不丢）；按书（chatTitle）隔离，
  // 切书时面板不卸载，必须随 chatTitle 换成目标书自己的草稿——否则 A 书没发完的话出现在 B 书输入框
  const [input, setInput] = useState(() => loadDraft(chatTitle));
  const saveDraft = useCallback(
    (v: string) => saveDraftFor(chatTitle, v),
    [chatTitle],
  );
  const lastDraftTitleRef = useRef<string | null>(chatTitle);
  useEffect(() => {
    if (lastDraftTitleRef.current === chatTitle) return;
    lastDraftTitleRef.current = chatTitle;
    setInput(loadDraft(chatTitle));
    // 切书瞬间即作废旧会话：open effect 异步拉取新书会话期间，convId 若仍留着旧书的值，
    // 用户此刻发送会把「B 书的提问」发进 A 书会话（并显示在 B 书面板上）。
    // 清空后该窗口期 canSend=false（发送按钮禁用），拉回会话后自然恢复。
    convIdRef.current = null;
    setConvId(null);
    setMessages([]);
  }, [chatTitle]);
  /** 快捷指令菜单锚点（点击输入框左侧闪电按钮弹出预设指令） */
  const [cmdAnchor, setCmdAnchor] = useState<HTMLElement | null>(null);
  // 初值直读 store：面板随语料 Tab 切换卸载重挂，生成中重挂时若从 '' 起步，
  // 到下一个 chunk 覆盖前会闪空一下；流结束后 store 侧会清空，残留值被 isOwnStreaming 守卫兜住。
  const [streamText, setStreamText] = useState(() => useAgentStore.getState().streamingContent);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 最近一次本面板发起的请求（对话文本 + 实际发送内容），供错误态「重试」原样重发 */
  const lastSendRef = useRef<{ text: string; content: string } | null>(null);

  // P2 生成子模式状态
  const [subMode, setSubMode] = useState<SubMode>(() => loadGenPersist(chatTitle)?.mode ?? 'chat');
  const [genCount, setGenCount] = useState(3);
  const [genPurpose, setGenPurpose] = useState<CorpusGeneratePurpose>('auto');
  // 生成结果从 localStorage 恢复（面板随 tab 切换卸载，之前生成的卡片不丢）
  const [genCards, setGenCards] = useState<string[]>(() => loadGenPersist(chatTitle)?.cards ?? []);
  const [genAttempted, setGenAttempted] = useState(() => loadGenPersist(chatTitle)?.attempted ?? false);
  // 就地编辑态：editingIdx 指向正在编辑的卡片下标；genEditDraft 为编辑中的草稿文本。
  // 两者随持久化恢复：编辑中途切走 tab（面板卸载）再回来，未保存草稿不丢失
  const [editingIdx, setEditingIdx] = useState<number | null>(() => loadGenPersist(chatTitle)?.editing?.idx ?? null);
  const [genEditDraft, setGenEditDraft] = useState(() => loadGenPersist(chatTitle)?.editing?.draft ?? '');
  // 生成态持久化：chatTitle 变化（切书，面板常驻不卸载）时先用新书已存数据重置内存态，
  // 再于下一轮 effect 落盘——避免旧书的 genCards/subMode 以新书名写入（覆盖新书已有记录）
  const lastPersistTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastPersistTitleRef.current !== chatTitle) {
      // 标题切换（或首次挂载）：从新 chatTitle 恢复生成态，本轮不落盘
      lastPersistTitleRef.current = chatTitle;
      const persisted = loadGenPersist(chatTitle);
      setSubMode(persisted?.mode ?? 'chat');
      setGenCards(persisted?.cards ?? []);
      setGenAttempted(persisted?.attempted ?? false);
      setEditingIdx(persisted?.editing?.idx ?? null);
      setGenEditDraft(persisted?.editing?.draft ?? '');
      return;
    }
    // 常规状态变化：结果/模式/编辑态 → 写回 localStorage（切 tab 卸载前持久化）
    saveGenPersist(chatTitle, {
      cards: genCards,
      attempted: genAttempted,
      mode: subMode,
      editing: editingIdx !== null ? { idx: editingIdx, draft: genEditDraft } : null,
    });
  }, [chatTitle, genCards, genAttempted, subMode, editingIdx, genEditDraft]);

  // 挂载即刷新 agent 列表（新增/改名后回到写作台能拿到最新；失败容忍，store 内已降级）
  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  // 流式预览：面板挂载期间常驻订阅（isStreaming 才渲染气泡，避免残留文本误显）
  useEffect(() => {
    return useAgentStore.subscribe((s) => setStreamText(s.streamingContent));
  }, []);

  // 挂载（或切 agent）→ 复用同名会话；直读 API 存本地，不碰 store.messages
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setLoading(true);
    // 不清 streamText：切 agent/切书时旧流文本由流归属守卫（currentStreamConversationId
    // === convId）天然拦渲染；生成中重挂时保留 store 现值避免闪空（见 streamText 初值）。
    (async () => {
      try {
        const convs = await agentApi.listConversations(agentId);
        const mine = convs.filter((c) => c.title === chatTitle).sort((a, b) => b.updatedAt - a.updatedAt);
        const conv = mine[0] ?? (await agentApi.createConversation(agentId, chatTitle));
        if (cancelled) return;
        setConvId(conv.id);
        const rows = await agentApi.listMessages(conv.id);
        if (cancelled) return;
        // 展示层剥离：user 消息含首轮注入的系统提示词前缀，仅渲染用户原文与助手输出
        setMessages(sanitizeDisplayMessages(rows));
      } catch (e) {
        logger.warn('AiCorpusPanel', 'open failed', { error: e });
        useToastStore.getState().error(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, chatTitle]);

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
  }, [messages, streamText, isStreaming, genCards]);

  /**
   * 发送一条消息（对话提问 / 生成指令共用）：组装 content 并落库、刷新本地消息。
   * @param text 本地气泡展示文本（用户原话或生成指令摘要）
   * @param content 实际发送内容（首轮自动拼接人设 + 写作上下文）
   */
  const sendAndRefresh = useCallback(
    async (text: string, content: string): Promise<AiMessage[] | null> => {
      if (!convId || isStreaming) return null;
      // 发起时捕获会话归属：await 期间可能切书（面板不卸载），结果必须按归属落账
      const ownerConvId = convId;
      lastSendRef.current = { text, content };
      // 本地乐观插入用户消息（显示原文；上下文前缀只在真正发出的消息里）
      setMessages((m) => [
        ...m,
        {
          id: `local_${Date.now()}`,
          conversationId: convId,
          role: 'user',
          content: text,
          toolCalls: null,
          createdAt: Date.now(),
        },
      ]);
      try {
        // 直读 API 建会话不进 store.conversations、写作台窗口不设置 selectedAgentId——
        // 必须显式传 agentId（本面板自己在 props 里持有），否则 store 无法推导 agent 归属会放弃发送
        await useAgentStore.getState().sendMessage(ownerConvId, content, undefined, undefined, agentId);
        const rows = await agentApi.listMessages(ownerConvId);
        // 归属已变（切书 / 新开会话）：A 书的结果绝不写进 B 书面板——交由调用方按 null 收敛，
        // 旧结果不丢（已在 A 书会话历史落库，切回 A 书由 open effect 重新拉取）。
        if (isConvStale(ownerConvId, convIdRef.current)) {
          logger.info('AiCorpusPanel', 'drop stale send result after conversation switch', { ownerConvId });
          return null;
        }
        const filtered = sanitizeDisplayMessages(rows);
        setMessages(filtered);
        setStreamText('');
        return filtered;
      } catch (e) {
        // 同理：切书后旧请求的失败不该在新书面板上弹错误
        if (isConvStale(ownerConvId, convIdRef.current)) {
          logger.warn('AiCorpusPanel', 'send failed on already-switched conversation', { error: e });
          return null;
        }
        logger.warn('AiCorpusPanel', 'send failed', { error: e });
        useToastStore.getState().error(String(e));
        return null;
      }
    },
    [convId, isStreaming, agentId],
  );

  /** 对话模式发送（override 供快捷 chip 直发；不传则取输入框） */
  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || !convId || isStreaming) return;
      setInput('');
      saveDraft('');
      // 首轮（本地无历史）注入人设 + 写作上下文；后续轮次靠对话历史延续
      const base =
        messages.length === 0 ? `${AI_CORPUS_SYSTEM_HINT}\n\n${buildContextBlock()}\n\n---\n\n${text}` : text;
      // C2 找范例：识别「找例句/怎么写/借鉴」类意图 → 先召回库内原文作为证据块附在消息后，
      // 让 AI 优先引用/拆解库内句子并保留出处；检索失败静默降级为普通发送，不阻塞对话。
      let content = base;
      const exampleQuery = detectExampleRequest(text);
      if (exampleQuery) {
        try {
          const res = await corpusApi.search(exampleQuery, null, 8, 0);
          const evidence = buildCorpusEvidenceBlock(res.hits ?? [], exampleQuery);
          if (evidence) content = `${base}\n\n${evidence}`;
        } catch (e) {
          logger.warn('AiCorpusPanel', 'corpus pre-search failed, fall back to plain send', { error: e });
        }
      }
      await sendAndRefresh(text, content);
    },
    [input, convId, isStreaming, messages.length, buildContextBlock, sendAndRefresh, saveDraft],
  );

  /** P2 一键生成语料：条数 + 用途轻参数 → 组装指令发送 → 固化推荐句卡片 */
  const handleGenerate = useCallback(async () => {
    if (!convId || isStreaming) return;
    setGenAttempted(true);
    // 注意：不预先清空 genCards——生成中由 generating 分支渲染流式区、旧卡片自然隐藏；
    // 生成成功才替换为新结果，请求失败/被停止时旧结果保留，避免「换一批」误触清空上一批
    setEditingIdx(null); // 换一批：正在编辑的卡片随旧结果一起失效
    setGenEditDraft('');
    const text = buildCorpusGeneratePrompt({ count: genCount, purpose: genPurpose });
    // 生成请求自包含：每次都带上最新 HINT + 写作上下文 + 生成指令，不依赖会话历史——
    // 避免二轮起上下文过期（当前章正文/人物变动立即生效），生成批次也不会污染后续生成语义。
    const content = `${AI_CORPUS_SYSTEM_HINT}\n\n${buildContextBlock()}\n\n---\n\n${text}`;
    const rows = await sendAndRefresh(text, content);
    if (!rows) return;
    // 若本轮被停止（手动 / 超时兜底）：后端只保留半截回复，不固化为卡片（防止把半句推荐复制进正文）
    if (useAgentStore.getState().stoppedConversationId === convId) return;
    // 生成结果 = 最后一条 assistant 回复中解析出的「>>> 」推荐句
    const lastAssistant = [...rows].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      setGenCards(extractAiCorpusPicks(lastAssistant.content));
    }
  }, [convId, isStreaming, buildContextBlock, genCount, genPurpose, sendAndRefresh]);

  /** 换一批：重新触发一次相同参数的生成请求 */
  const handleRegenerate = useCallback(() => {
    void handleGenerate();
  }, [handleGenerate]);

  /** 复制推荐句到剪贴板（成功后 toast 反馈，失败提示换手动复制） */
  const handleCopy = useCallback(async (picked: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(picked);
        useToastStore.getState().success(t('writing.corpusCopied'));
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch (e) {
      logger.warn('AiCorpusPanel', 'copy failed', { error: e });
      useToastStore.getState().error(t('writing.corpusCopyFail'));
    }
  }, []);

  /** 复制整条消息原文（用户/助手气泡 hover 操作，对齐主流对话工具） */
  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        useToastStore.getState().success(t('writing.corpusCopied'));
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch (e) {
      logger.warn('AiCorpusPanel', 'copy message failed', { error: e });
      useToastStore.getState().error(t('writing.corpusCopyFail'));
    }
  }, []);

  // 新会话：立即建新会话（清空历史，首条消息重新注入上下文）；旧同名会话保留不删（零强制）
  const handleNewChat = useCallback(async () => {
    if (!agentId || isStreaming) return;
    try {
      const conv = await agentApi.createConversation(agentId, chatTitle);
      setConvId(conv.id);
      setMessages([]);
      setStreamText('');
      setGenCards([]);
      setGenAttempted(false);
      setEditingIdx(null);
      setGenEditDraft('');
      saveDraft('');
    } catch (e) {
      useToastStore.getState().error(String(e));
    }
  }, [agentId, chatTitle, isStreaming, saveDraft]);

  const canSend = input.trim().length > 0 && convId !== null && !isStreaming;
  /** 最新一轮流式是否属于本面板（对话/生成共用同一 convId）：驱动气泡、停止按钮与错误反馈 */
  const isOwnStreaming = isStreaming && currentStreamConversationId === convId;
  // 生成中：本子模式的请求仍在流式（借全局 isStreaming + 归属过滤，防别处流串台显示「生成中」）
  const generating = subMode === 'generate' && isOwnStreaming;

  /** 渲染一张推荐句卡片（插入 + 可选复制） */
  const renderPickCard = (picked: string, testidBase: string) => (
    <Box
      key={`${testidBase}-${picked}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        bgcolor: (th) => alpha(th.palette.primary.main, 0.06),
        border: 1,
        borderColor: 'divider',
      }}
      data-testid={`${testidBase}-card`}
    >
      <Typography sx={{ fontSize: 12.5, lineHeight: 1.6, flex: 1, minWidth: 0 }}>{picked}</Typography>
      <Button
        size="small"
        variant="text"
        sx={{ flexShrink: 0, minWidth: 0, px: 0.75, fontSize: 12, textTransform: 'none' }}
        onClick={() => onInsertText(picked)}
        data-testid={`${testidBase}-insert`}
      >
        {t('writing.corpusInsert')}
      </Button>
      <Button
        size="small"
        variant="text"
        sx={{ flexShrink: 0, minWidth: 0, px: 0.75, fontSize: 12, textTransform: 'none', color: 'text.secondary' }}
        onClick={() => void handleCopy(picked)}
        data-testid={`${testidBase}-copy`}
      >
        {t('writing.aiCorpusCopy')}
      </Button>
    </Box>
  );

  /** 开始就地编辑一张生成卡片（编辑态：文本输入 + 保存/取消） */
  const startEditCard = useCallback((i: number, picked: string) => {
    setEditingIdx(i);
    setGenEditDraft(picked);
  }, []);

  /** 保存编辑草稿：非空则写回该卡片（同时经持久化 effect 落地 localStorage） */
  const saveEditCard = useCallback(() => {
    if (editingIdx === null) return;
    const v = genEditDraft.trim();
    if (v) {
      setGenCards((prev) => prev.map((c, j) => (j === editingIdx ? v : c)));
    }
    setEditingIdx(null);
  }, [editingIdx, genEditDraft]);

  /**
   * 删除一张生成卡片（直接从结果集移除并持久化）。
   * 编辑下标必须跟着数组收缩校正：cards 里每张卡都同时挂着「编辑」和「删除」入口，
   * 正在编辑第 2 张时点第 1 张的删除是正常操作；只判 cur===i 归零的话，
   * i 之后的 editingIdx 不会前移——指向越界则保存静默丢失，指向别的卡则把草稿
   * 覆盖到错误卡片上（数据损坏）。
   */
  const deleteCard = useCallback((i: number) => {
    setGenCards((prev) => prev.filter((_, j) => j !== i));
    setEditingIdx((cur) => shiftEditIndexAfterDelete(cur, i));
  }, []);

  /** 渲染一张固化推荐句卡片（插入 + 复制 + 就地编辑/删除；编辑态渲染输入框） */
  const renderGenCard = (picked: string, i: number) => {
    if (editingIdx === i) {
      return (
        <Box
          key={`gen-edit-${i}`}
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: 1, py: 0.5, borderRadius: 1 }}
          data-testid={`ai-corpus-gen-${i}-edit-card`}
        >
          <TextField
            autoFocus
            size="small"
            multiline
            minRows={1}
            maxRows={4}
            value={genEditDraft}
            onChange={(e) => setGenEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              saveEditCard();
            }}
            slotProps={{ input: { sx: { fontSize: 12.5 } } }}
            data-testid={`ai-corpus-gen-${i}-edit-input`}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
            <Button
              size="small"
              variant="text"
              sx={{ minWidth: 0, px: 0.75, fontSize: 12, textTransform: 'none', color: 'text.secondary' }}
              onClick={() => setEditingIdx(null)}
              data-testid={`ai-corpus-gen-${i}-edit-cancel`}
            >
              {t('ui.cancel')}
            </Button>
            <Button
              size="small"
              variant="contained"
              disableElevation
              sx={{ minWidth: 0, px: 1, fontSize: 12, textTransform: 'none' }}
              onClick={saveEditCard}
              data-testid={`ai-corpus-gen-${i}-edit-save`}
            >
              {t('ui.save')}
            </Button>
          </Box>
        </Box>
      );
    }
    return (
      <Box
        key={`gen-${i}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          bgcolor: (th) => alpha(th.palette.primary.main, 0.06),
          border: 1,
          borderColor: 'divider',
        }}
        data-testid={`ai-corpus-gen-${i}-card`}
      >
        <Typography sx={{ fontSize: 12.5, lineHeight: 1.6, flex: 1, minWidth: 0 }}>{picked}</Typography>
        <Button
          size="small"
          variant="text"
          sx={{ flexShrink: 0, minWidth: 0, px: 0.75, fontSize: 12, textTransform: 'none' }}
          onClick={() => onInsertText(picked)}
          data-testid={`ai-corpus-gen-${i}-insert`}
        >
          {t('writing.corpusInsert')}
        </Button>
        <Button
          size="small"
          variant="text"
          sx={{ flexShrink: 0, minWidth: 0, px: 0.75, fontSize: 12, textTransform: 'none', color: 'text.secondary' }}
          onClick={() => void handleCopy(picked)}
          data-testid={`ai-corpus-gen-${i}-copy`}
        >
          {t('writing.aiCorpusCopy')}
        </Button>
        <IconButton
          size="small"
          onClick={() => startEditCard(i, picked)}
          title={t('writing.aiCorpusGenEditHint')}
          aria-label={t('writing.aiCorpusGenEditHint')}
          data-testid={`ai-corpus-gen-${i}-edit`}
          sx={{ flexShrink: 0, p: 0.5, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
        >
          <EditRoundedIcon sx={{ fontSize: 13 }} />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => deleteCard(i)}
          title={t('writing.aiCorpusGenDeleteHint')}
          aria-label={t('writing.aiCorpusGenDeleteHint')}
          data-testid={`ai-corpus-gen-${i}-delete`}
          sx={{ flexShrink: 0, p: 0.5, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
        >
          <DeleteOutlineRoundedIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Box>
    );
  };

  return (
    <Box
      sx={{
        borderLeft: 0,
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        bgcolor: 'background.paper',
      }}
    >
      {/* 标题行：语料参谋 + agent 选择 + 新会话 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <AutoAwesomeRoundedIcon sx={{ fontSize: 15, color: 'primary.main' }} />
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'primary.main', flex: 1, minWidth: 0 }}>
          {t('writing.aiCorpusTitle')}
        </Typography>
        <Select
          size="small"
          value={agentId || ''}
          onChange={(e) => onAgentChange(e.target.value)}
          displayEmpty
          disabled={noAgent || isStreaming}
          sx={{ height: 26, '& .MuiSelect-select': { py: 0, fontSize: 12 } }}
          data-testid="ai-corpus-agent"
        >
          {!agentId && (
            <MenuItem value="" sx={{ fontSize: 12 }}>
              {t('writing.aiAgent')}
            </MenuItem>
          )}
          {agents.map((a) => (
            <MenuItem key={a.id} value={a.id} sx={{ fontSize: 12 }}>
              {a.name}
            </MenuItem>
          ))}
        </Select>
        {!noAgent && (
          <IconButton
            size="small"
            onClick={isStreaming ? undefined : () => void handleNewChat()}
            title={t('writing.aiChatNew')}
            aria-label={t('writing.aiChatNew')}
            data-testid="ai-corpus-new"
            sx={{ flexShrink: 0, color: 'text.secondary' }}
          >
            <AddRoundedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        )}
      </Box>

      {/* 子模式切换（对话 / 生成）；无 agent 时隐藏（空态已引导去配置） */}
      {!noAgent && (
        <Box
          sx={{
            display: 'flex',
            gap: 0.5,
            alignItems: 'center',
            px: 1.5,
            py: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {(
            [
              { mode: 'chat' as SubMode, key: 'aiCorpusSubChat', testid: 'ai-corpus-mode-chat' },
              { mode: 'generate' as SubMode, key: 'aiCorpusSubGenerate', testid: 'ai-corpus-mode-generate' },
            ] as const
          ).map(({ mode, key, testid }) => (
            <Button
              key={mode}
              size="small"
              disabled={isStreaming}
              variant={subMode === mode ? 'contained' : 'text'}
              onClick={() => setSubMode(mode)}
              sx={{
                minWidth: 0,
                px: 1.25,
                py: 0.25,
                fontSize: 12,
                textTransform: 'none',
                color: subMode === mode ? undefined : 'text.secondary',
              }}
              data-testid={testid}
            >
              {t(`writing.${key}`)}
            </Button>
          ))}
        </Box>
      )}

      {/* 流错误 / 停止回执：全局状态里最新一轮流式若属于本面板会话，结束时在此标注
           （错误优先于停止——超时兜底会同时记账 stoppedConversationId + lastStreamError='timeout'） */}
      {!loading && !noAgent && !isStreaming && lastStreamError && currentStreamConversationId === convId && (
        <Box sx={{ px: 1.5, py: 0.75 }}>
          <Alert
            severity="error"
            variant="outlined"
            sx={{ fontSize: 12, '& .MuiAlert-message': { py: 0.25 } }}
            action={
              <Button
                size="small"
                color="error"
                startIcon={<ReplayRoundedIcon sx={{ fontSize: 14 }} />}
                onClick={() => {
                  if (subMode === 'generate') {
                    void handleGenerate();
                  } else if (lastSendRef.current) {
                    void sendAndRefresh(lastSendRef.current.text, lastSendRef.current.content);
                  }
                }}
                data-testid="ai-corpus-error-retry"
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
        <Box sx={{ px: 1.5, py: 0.5 }}>
          <Chip
            size="small"
            icon={<StopRoundedIcon sx={{ fontSize: 12 }} />}
            label={t('writing.aiStopped')}
            color="error"
            variant="outlined"
            sx={{ fontSize: 10.5, height: 20 }}
          />
        </Box>
      )}

      {/* 内容区（按子模式分支渲染） */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={22} />
        </Box>
      ) : noAgent ? (
        // 无 agent：给「去配置」出口，避免死面板（与 WritingAiChatDialog 同款引导）
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, px: 2, py: 5 }}>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center' }}>
            {t('writing.aiCorpusNoAgent')}
          </Typography>
          <Button size="small" variant="outlined" onClick={onOpenSettings}>
            {t('writing.aiGoConfigure')}
          </Button>
        </Box>
      ) : subMode === 'chat' ? (
        // ============ 对话模式（P1）：历史气泡 + 推荐句卡片 + 输入区 ============
        <>
          <Box
            ref={scrollRef}
            onScroll={handleListScroll}
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 1 }}
          >
            {messages.length === 0 && !isStreaming ? (
              // 空会话：引导 + 快捷提问（降低冷启动门槛）
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, px: 1, py: 3 }}>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', lineHeight: 1.7 }}>
                  {t('writing.aiCorpusEmpty')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.75 }}>
                  {CHIP_KEYS.map((k) => (
                    <Button
                      key={k}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 12, textTransform: 'none', px: 1.25 }}
                      onClick={() => void handleSend(t(`writing.${k}`))}
                      data-testid={`ai-corpus-chip-${k}`}
                    >
                      {t(`writing.${k}`)}
                    </Button>
                  ))}
                </Box>
              </Box>
            ) : (
              <>
                {messages.map((m, idx) => {
                  const picks = m.role === 'assistant' ? extractAiCorpusPicks(m.content) : [];
                  return (
                    <Box key={m.id} sx={{ mb: 1 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                          gap: 0.25,
                        }}
                      >
                        {/* 消息操作：复制原文（对齐主流对话工具；用户消息按钮在气泡左侧，助手消息在右侧） */}
                        <IconButton
                          size="small"
                          onClick={() => void handleCopyMessage(m.content)}
                          title={t('writing.aiCorpusCopyMsgTitle')}
                          aria-label={t('writing.aiCorpusCopyMsgTitle')}
                          data-testid={`ai-corpus-msg-copy-${idx}`}
                          sx={{
                            flexShrink: 0,
                            mt: 0.25,
                            p: 0.25,
                            order: m.role === 'user' ? -1 : 2,
                            color: 'text.disabled',
                            opacity: 0.55,
                            '&:hover': { opacity: 1, color: 'text.secondary' },
                          }}
                        >
                          <ContentCopyRoundedIcon sx={{ fontSize: 12.5 }} />
                        </IconButton>
                        <Box
                          sx={{
                            maxWidth: '88%',
                            px: 1.25,
                            py: 0.75,
                            borderRadius: 2,
                            bgcolor: m.role === 'user' ? 'primary.main' : 'action.hover',
                            color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
                            wordBreak: 'break-word',
                          }}
                        >
                          <Typography sx={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                            {m.content}
                          </Typography>
                        </Box>
                      </Box>
                      {/* 推荐句：解析出的「>>> 」行逐条带插入按钮（AI 语料闭环，复用 onInsertText） */}
                      {picks.length > 0 && (
                        <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {picks.map((p, i) => (
                            <Box
                              key={`${m.id}-pick-${i}`}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                px: 1,
                                py: 0.5,
                                borderRadius: 1,
                                bgcolor: (th) => alpha(th.palette.primary.main, 0.06),
                                border: 1,
                                borderColor: 'divider',
                              }}
                              data-testid="ai-corpus-pick"
                            >
                              <Typography sx={{ fontSize: 12.5, lineHeight: 1.6, flex: 1, minWidth: 0 }}>
                                {p}
                              </Typography>
                              <Button
                                size="small"
                                variant="text"
                                sx={{ flexShrink: 0, minWidth: 0, px: 0.75, fontSize: 12, textTransform: 'none' }}
                                onClick={() => onInsertText(p)}
                                data-testid={`ai-corpus-pick-insert-${i}`}
                              >
                                {t('writing.corpusInsert')}
                              </Button>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  );
                })}
                {isOwnStreaming && streamText && (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
                    <Box sx={{ maxWidth: '88%', px: 1.25, py: 0.75, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography sx={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                        {streamText}
                      </Typography>
                    </Box>
                  </Box>
                )}
              </>
            )}
          </Box>

          {/* 底部输入区（无 agent 时隐藏，死面板回归锁） */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              px: 1.5,
              py: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                // 左右按钮（指令/发送/停止）相对输入框始终垂直居中：输入多行或宽度变化导致
                // 换行增高时也不偏移（对齐主流对话工具输入区），禁用 flex-end 贴底避免按钮下沉
                alignItems: 'center',
                flex: 1,
                minWidth: 0,
                gap: 0.5,
                px: 1,
                py: 0.5,
                borderRadius: 2,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                '&:focus-within': {
                  borderColor: 'primary.main',
                },
              }}
            >
              {/* 快捷指令（slash command 简化版）：点击弹出写作常用指令，选择后填入输入框可改后发送 */}
              <IconButton
                size="small"
                onClick={(e) => setCmdAnchor(e.currentTarget)}
                title={t('writing.aiCorpusCmdTitle')}
                aria-label={t('writing.aiCorpusCmdTitle')}
                data-testid="ai-corpus-cmd"
                sx={{ flexShrink: 0, color: 'text.secondary' }}
              >
                <BoltRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <Menu
                anchorEl={cmdAnchor}
                open={Boolean(cmdAnchor)}
                onClose={() => setCmdAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                slotProps={{ paper: { sx: { maxWidth: 260 } } }}
              >
                {CMD_PRESETS.map(({ labelKey, textKey }) => (
                  <MenuItem
                    key={labelKey}
                    sx={{ fontSize: 12.5, py: 0.5 }}
                    onClick={() => {
                      const v = t(`writing.${textKey}`);
                      setInput(v);
                      saveDraft(v);
                      setCmdAnchor(null);
                    }}
                    data-testid={`ai-corpus-cmd-${labelKey}`}
                  >
                    {t(`writing.${labelKey}`)}
                  </MenuItem>
                ))}
              </Menu>
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={1}
                maxRows={6}
                variant="standard"
                placeholder={t('writing.aiCorpusPlaceholder')}
                value={input}
                onChange={(e) => {
                  const v = e.target.value;
                  setInput(v);
                  saveDraft(v);
                }}
                onKeyDown={(e) => {
                  // Enter 发送、Shift+Enter 换行、Cmd/Ctrl+Enter 同样发送（对齐主流对话工具）
                  if (e.key !== 'Enter' || e.shiftKey) return;
                  e.preventDefault();
                  if (canSend) void handleSend();
                }}
                slotProps={{ input: { disableUnderline: true } }}
                sx={{ '& .MuiInputBase-input': { fontSize: 12.5 } }}
              />
              {isOwnStreaming ? (
                <IconButton
                  color="error"
                  onClick={() => useAgentStore.getState().requestInterrupt()}
                  size="small"
                  sx={{ flexShrink: 0 }}
                  data-testid="ai-corpus-stop"
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
                  data-testid="ai-corpus-send"
                  aria-label={t('writing.aiChatSend')}
                >
                  <SendRoundedIcon />
                </IconButton>
              )}
            </Box>
            {/* 输入区辅助行：上下文提示 + 快捷键 + 字数（对齐主流对话工具的信息密度） */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 0.25, pt: 0.5 }}>
              <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{t('writing.aiCorpusInputHint')}</Typography>
              <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                {t('writing.aiCorpusChars', { n: input.length })}
              </Typography>
            </Box>
          </Box>
        </>
      ) : (
        // ============ 生成模式（P2）：轻参数 + 一键生成 + 推荐句卡片流 ============
        <>
          {/* 参数区：条数 + 用途 + 生成/停止 */}
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              px: 1.5,
              py: 0.75,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Select
              size="small"
              value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))}
              disabled={isStreaming}
              sx={{ height: 26, '& .MuiSelect-select': { py: 0, fontSize: 12 } }}
              data-testid="ai-corpus-gen-count"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <MenuItem key={n} value={n} sx={{ fontSize: 12 }}>
                  {n} {t('writing.aiCorpusGenerateCount')}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={genPurpose}
              onChange={(e) => setGenPurpose(e.target.value as CorpusGeneratePurpose)}
              disabled={isStreaming}
              sx={{ height: 26, flex: 1, minWidth: 0, '& .MuiSelect-select': { py: 0, fontSize: 12 } }}
              data-testid="ai-corpus-gen-purpose"
            >
              {PURPOSE_KEYS.map(({ value, labelKey }) => (
                <MenuItem key={value} value={value} sx={{ fontSize: 12 }}>
                  {t(`writing.${labelKey}`)}
                </MenuItem>
              ))}
            </Select>
            {isOwnStreaming ? (
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={() => useAgentStore.getState().requestInterrupt()}
                sx={{ flexShrink: 0, minWidth: 0, px: 1.25, fontSize: 12, textTransform: 'none' }}
                data-testid="ai-corpus-gen-stop"
              >
                {t('writing.aiChatStop')}
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                onClick={() => void handleGenerate()}
                sx={{ flexShrink: 0, minWidth: 0, px: 1.25, fontSize: 12, textTransform: 'none' }}
                data-testid="ai-corpus-generate"
              >
                {t('writing.aiCorpusGenerateBtn')}
              </Button>
            )}
          </Box>

          {/* 结果区：流式中实时渲染生成卡片，完成后固化 + 换一批 */}
          <Box
            ref={scrollRef}
            onScroll={handleListScroll}
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 1 }}
          >
            {generating ? (
              // 生成中：从流式文本实时解析「>>> 」行为卡片（不断追加）
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <CircularProgress size={14} />
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {t('writing.aiCorpusGenerating')}
                  </Typography>
                </Box>
                {(extractAiCorpusPicks(streamText).length > 0 || streamText) && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {extractAiCorpusPicks(streamText).map((p, i) => renderPickCard(p, `ai-corpus-gen-stream-${i}`))}
                    {!extractAiCorpusPicks(streamText).includes(streamText.trim()) && (
                      <Typography
                        sx={{ fontSize: 11.5, color: 'text.disabled', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
                      >
                        {streamText}
                      </Typography>
                    )}
                  </Box>
                )}
              </>
            ) : genCards.length > 0 ? (
              <>
                {/* 固化卡片（插入/复制 + 就地编辑/删除，改动经持久化 effect 落 localStorage） */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {genCards.map((p, i) => renderGenCard(p, i))}
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.25 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleRegenerate}
                    sx={{ fontSize: 12, textTransform: 'none' }}
                    data-testid="ai-corpus-regen"
                  >
                    {t('writing.aiCorpusRegenerate')}
                  </Button>
                </Box>
              </>
            ) : (
              // 空态：未生成过 → 引导；生成过但无结果 → 提示调整
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 1, py: 3 }}>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', lineHeight: 1.7 }}>
                  {genAttempted ? t('writing.aiCorpusGenEmpty') : t('writing.aiCorpusGenHint')}
                </Typography>
              </Box>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
