import { create } from 'zustand';
import { agentApi } from '../services/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { t } from '../i18n';
import type {
  AiProvider,
  AiEndpoint,
  AiModel,
  AiAgent,
  AiConversation,
  AiMessage,
  ToolCallEvent,
  AgentToolApprovalEvent,
} from '../services/tauri';
import { logger } from '../utils/logger';
import { mergeToolCallEvent } from '../utils/toolCallDisplay';

/** 流式空闲超时（ms）：超过该时长未收到任何 chunk，判定 provider/网络/后端卡死 */
export const STREAM_IDLE_TIMEOUT_MS = 90_000;
/** 判超时后仍收不到后端回执时的强制收尾等待（ms），防止 isStreaming 永久锁死全局闸门 */
export const STREAM_FORCE_SETTLE_MS = 15_000;
/**
 * 流式 chunk 合并 flush 窗口（ms）：onChunk 高频到达（SSE 常为 10-50ms 一片）时，
 * 攒批量再一次性 set streamingContent，把「每片一次 store 广播 + 全串拼接 O(n²)」
 * 压成「每 ~48ms 一次」，大幅降低所有订阅端（工作台/写作台/InlineChat/报告面板）的重渲染频率。
 * 对标 VS Code 流式渲染的 rAF 批处理：合并高频小片、保留文字流动感。
 */
export const STREAM_FLUSH_MS = 48;

interface AgentState {
  // 数据列表
  providers: AiProvider[];
  endpoints: AiEndpoint[];
  models: AiModel[];
  agents: AiAgent[];
  conversations: AiConversation[];
  messages: AiMessage[];

  // 当前选中
  selectedAgentId: string | null;
  selectedConversationId: string | null;

  // 流式状态
  streamingContent: string;
  isStreaming: boolean;
  /**
   * 已请求中断：前端在这里保留「停止已按下」态，让并发闸门（isStreaming）在后端真正回执前
   * 保持关闭，避免二次并发写同一会话。真取消已由后端 cancel_agent_run 落地（P2.3）。
   */
  interruptRequested: boolean;
  /** 当前流式的运行 id（前端生成、随 run_agent 下发，用于 requestInterrupt 精准取消单次运行） */
  currentRunId: string | null;
  /**
   * 上一轮被用户主动停止的会话 id（否则为 null）。
   * 停止后后端保留「已吐出的部分回答」并照常落库，若不给回执，用户无法区分
   * 「AI 自己答完了」还是「我按停止截断的」——面板据此在末条消息下标注「已停止」。
   */
  stoppedConversationId: string | null;
  /**
   * 当前流式所属会话 id（sendMessage 发起时置位、settle 时清空）。
   * streamingContent / isStreaming 是全局状态，多个消费端面板（工作台 AI、AI 页、
   * 写作台语料参谋、写作台 AI 对话框）共享同一 store——若没有归属字段，
   * 任意一端发起流式时，其余打开中的面板会把同一段文本渲染进自己的会话气泡（串台）。
   * 消费端渲染流式气泡前必须与本值判等。
   */
  currentStreamConversationId: string | null;
  /**
   * 最近一轮流式的错误信息（settle 后保留，供 UI 渲染错误气泡；新一轮发起时清除）。
   * 哨兵值 'timeout'：watchdog 判定流空闲超时后置位，UI 显示本地化文案而非原始错误文本。
   */
  lastStreamError: string | null;
  /** 流式最后活跃时间戳（发起时与每次 chunk 到达时刷新），供 watchdog 判定空闲超时 */
  streamLastChunkAt: number | null;
  toolCalls: ToolCallEvent[];

  /**
   * 待用户确认的高危工具调用（human-in-the-loop 拦截：run_command 逐条确认，
   * 写入类工具可会话级记住）。引擎在即将执行前推送审批请求，前端据此弹确认框；
   * 用户落定后清空。仅一条在途审批（一轮内工具串行执行，不会并发等待多条）。
   */
  pendingToolApproval: {
    runId: string;
    toolCallId: string;
    tool: string;
    command: string;
    cwd: string;
    /** 面向创作者的操作摘要（写入类工具没有 command，用 summary 展示） */
    summary: string;
    /** true = 写入类低危工具，弹窗提供「本会话不再询问」选项 */
    sessionRememberable: boolean;
  } | null;

  // 加载状态
  loading: {
    providers: boolean;
    endpoints: boolean;
    models: boolean;
    agents: boolean;
    conversations: boolean;
    messages: boolean;
  };

  // Actions
  loadProviders: () => Promise<void>;
  saveProvider: (provider: AiProvider) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;

  loadEndpoints: (providerId?: string) => Promise<void>;
  saveEndpoint: (endpoint: AiEndpoint) => Promise<void>;
  deleteEndpoint: (id: string) => Promise<void>;
  testEndpointConnection: (endpointId: string) => Promise<string>;

  loadModels: (endpointId?: string) => Promise<void>;
  saveModel: (model: AiModel) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  testModelChat: (modelId: string) => Promise<string>;

  loadAgents: () => Promise<void>;
  saveAgent: (agent: AiAgent) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  loadConversations: (agentId: string) => Promise<void>;
  createConversation: (agentId: string, title?: string) => Promise<AiConversation>;
  deleteConversation: (id: string) => Promise<void>;

  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    content: string,
    allowedTools?: string[] | null,
    modelId?: string | null,
    /**
     * 显式指定本次运行使用的 agent。
     * 直读 API 建会话的面板（写作台 AiCorpusPanel / WritingAiChatDialog）不会进入
     * store.conversations，且写作台窗口下 selectedAgentId 未设置——没有这个参数时
     * agentId 无法推导，sendMessage 只能放弃发送。传入后优先级最高。
     */
    agentId?: string | null,
  ) => Promise<void>;
  /**
   * 从某条消息起截断当前转录（含该条），返回被截断的第一条消息（供「重试」拿回原始正文）。
   * 面板「重试 / 编辑重发」的公共前置动作：先抹掉旧的那一轮，再重跑，避免会话里留两份同样的请求。
   * 流式期间拒绝执行（正在写库，截断会与落库竞争）。
   */
  truncateMessagesFrom: (messageId: string) => Promise<AiMessage | null>;

  /**
   * 删除**单条**消息（仅该条，其后对话原样保留），返回是否真正删除。
   * 与 truncateMessagesFrom 语义不同、各管各的：那个是「撤掉这一轮重来」（重试/编辑重发的前置），
   * 这个是「转录清理」（抹掉一条误发/无用的消息，不回滚后面的对话）。
   * 删用户消息时配对的助手回复会留下（它由原始请求生成、已落库）——清理语义下这是预期行为，
   * 想连回复一起撤就用 truncateMessagesFrom。流式期间拒绝执行（后端正在写库，删除会与落库竞争）。
   */
  deleteMessage: (messageId: string) => Promise<boolean>;

  selectAgent: (agentId: string | null) => void;
  selectConversation: (conversationId: string | null) => void;

  /** 请求中断当前流式：置位 interruptRequested，保持并发闸门关闭，直到后端回执才复位 */
  requestInterrupt: () => void;

  /** 落定当前待审批的高危工具调用：approved=true 允许执行，false 拒绝（引擎默认拒绝）。 */
  resolveToolApproval: (approved: boolean, rememberSession?: boolean) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  providers: [],
  endpoints: [],
  models: [],
  agents: [],
  conversations: [],
  messages: [],

  selectedAgentId: null,
  selectedConversationId: null,

  streamingContent: '',
  isStreaming: false,
  interruptRequested: false,
  currentRunId: null,
  stoppedConversationId: null,
  currentStreamConversationId: null,
  lastStreamError: null,
  streamLastChunkAt: null,
  toolCalls: [],
  pendingToolApproval: null,

  loading: {
    providers: false,
    endpoints: false,
    models: false,
    agents: false,
    conversations: false,
    messages: false,
  },

  // Provider actions
  loadProviders: async () => {
    set((state) => ({ loading: { ...state.loading, providers: true } }));
    try {
      const providers = await agentApi.listProviders();
      set({ providers });
    } catch (error) {
      logger.error('AgentStore', 'loadProviders failed', { error });
    } finally {
      set((state) => ({ loading: { ...state.loading, providers: false } }));
    }
  },

  saveProvider: async (provider) => {
    try {
      await agentApi.saveProvider(provider);
      await get().loadProviders();
    } catch (error) {
      logger.error('AgentStore', 'saveProvider failed', { error });
      throw error;
    }
  },

  deleteProvider: async (id) => {
    try {
      await agentApi.deleteProvider(id);
      await get().loadProviders();
    } catch (error) {
      logger.error('AgentStore', 'deleteProvider failed', { error });
      throw error;
    }
  },

  // Endpoint actions
  loadEndpoints: async (providerId) => {
    set((state) => ({ loading: { ...state.loading, endpoints: true } }));
    try {
      const endpoints = providerId
        ? await agentApi.listEndpointsByProvider(providerId)
        : await agentApi.listEndpoints();
      set({ endpoints });
    } catch (error) {
      logger.error('AgentStore', 'loadEndpoints failed', { error });
    } finally {
      set((state) => ({ loading: { ...state.loading, endpoints: false } }));
    }
  },

  saveEndpoint: async (endpoint) => {
    try {
      await agentApi.saveEndpoint(endpoint);
      await get().loadEndpoints();
    } catch (error) {
      logger.error('AgentStore', 'saveEndpoint failed', { error });
      throw error;
    }
  },

  deleteEndpoint: async (id) => {
    try {
      await agentApi.deleteEndpoint(id);
      await get().loadEndpoints();
    } catch (error) {
      logger.error('AgentStore', 'deleteEndpoint failed', { error });
      throw error;
    }
  },

  testEndpointConnection: async (endpointId) => {
    try {
      return await agentApi.testEndpointConnection(endpointId);
    } catch (error) {
      logger.error('AgentStore', 'testEndpointConnection failed', { error });
      throw error;
    }
  },

  // Model actions
  loadModels: async (endpointId) => {
    set((state) => ({ loading: { ...state.loading, models: true } }));
    try {
      const models = endpointId ? await agentApi.listModelsByEndpoint(endpointId) : await agentApi.listModels();
      set({ models });
    } catch (error) {
      logger.error('AgentStore', 'loadModels failed', { error });
    } finally {
      set((state) => ({ loading: { ...state.loading, models: false } }));
    }
  },

  saveModel: async (model) => {
    try {
      await agentApi.saveModel(model);
      await get().loadModels();
    } catch (error) {
      logger.error('AgentStore', 'saveModel failed', { error });
      throw error;
    }
  },

  deleteModel: async (id) => {
    try {
      await agentApi.deleteModel(id);
      await get().loadModels();
    } catch (error) {
      logger.error('AgentStore', 'deleteModel failed', { error });
      throw error;
    }
  },

  testModelChat: async (modelId) => {
    try {
      return await agentApi.testModelChat(modelId);
    } catch (error) {
      logger.error('AgentStore', 'testModelChat failed', { error });
      throw error;
    }
  },

  // Agent actions
  loadAgents: async () => {
    set((state) => ({ loading: { ...state.loading, agents: true } }));
    try {
      const agents = await agentApi.listAgents();
      set({ agents });
    } catch (error) {
      logger.error('AgentStore', 'loadAgents failed', { error });
    } finally {
      set((state) => ({ loading: { ...state.loading, agents: false } }));
    }
  },

  saveAgent: async (agent) => {
    try {
      await agentApi.saveAgent(agent);
      await get().loadAgents();
    } catch (error) {
      logger.error('AgentStore', 'saveAgent failed', { error });
      throw error;
    }
  },

  deleteAgent: async (id) => {
    try {
      await agentApi.deleteAgent(id);
      await get().loadAgents();
    } catch (error) {
      logger.error('AgentStore', 'deleteAgent failed', { error });
      throw error;
    }
  },

  // Conversation actions
  loadConversations: async (agentId) => {
    set((state) => ({ loading: { ...state.loading, conversations: true } }));
    try {
      const conversations = await agentApi.listConversations(agentId);
      set({ conversations });
    } catch (error) {
      logger.error('AgentStore', 'loadConversations failed', { error });
    } finally {
      set((state) => ({ loading: { ...state.loading, conversations: false } }));
    }
  },

  createConversation: async (agentId, title = t('agent.newChat')) => {
    try {
      const conversation = await agentApi.createConversation(agentId, title);
      await get().loadConversations(agentId);
      return conversation;
    } catch (error) {
      logger.error('AgentStore', 'createConversation failed', { error });
      throw error;
    }
  },

  deleteConversation: async (id) => {
    try {
      await agentApi.deleteConversation(id);
      const { selectedAgentId, selectedConversationId } = get();
      if (selectedAgentId) {
        await get().loadConversations(selectedAgentId);
      }
      // 如果删除的是当前选中的对话，自动回到欢迎视图（首页）
      if (selectedConversationId === id) {
        get().selectConversation(null);
      }
    } catch (error) {
      logger.error('AgentStore', 'deleteConversation failed', { error });
      throw error;
    }
  },

  // Message actions
  loadMessages: async (conversationId) => {
    set((state) => ({ loading: { ...state.loading, messages: true } }));
    try {
      const messages = await agentApi.listMessages(conversationId);
      set({ messages });
    } catch (error) {
      logger.error('AgentStore', 'loadMessages failed', { error });
    } finally {
      set((state) => ({ loading: { ...state.loading, messages: false } }));
    }
  },

  truncateMessagesFrom: async (messageId) => {
    const state = get();
    if (state.isStreaming || state.interruptRequested) {
      logger.warn('AgentStore', 'truncateMessagesFrom ignored while streaming');
      return null;
    }
    const idx = state.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return null;
    const dropped = state.messages.slice(idx);
    const first = dropped[0];
    // 乐观渲染的本地消息（local_ 前缀）还没落库，不必也不能拿去删——传了只是空转
    const persistedIds = dropped.map((m) => m.id).filter((id) => !id.startsWith('local_'));
    try {
      if (persistedIds.length > 0) await agentApi.deleteMessages(persistedIds);
    } catch (error) {
      // 删库失败就不能改本地视图：否则界面少了几条、库里还在，重开会话又冒出来
      logger.error('AgentStore', 'truncateMessagesFrom failed', { error });
      throw error;
    }
    set((s) => ({ messages: s.messages.slice(0, idx) }));
    return first ?? null;
  },

  deleteMessage: async (messageId) => {
    const state = get();
    if (state.isStreaming || state.interruptRequested) {
      logger.warn('AgentStore', 'deleteMessage ignored while streaming');
      return false;
    }
    const idx = state.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return false;
    // 乐观渲染的本地消息（local_ 前缀）还没落库，只从界面摘掉即可（也是发送失败后残留气泡的清理通道）
    if (!messageId.startsWith('local_')) {
      try {
        await agentApi.deleteMessages([messageId]);
      } catch (error) {
        // 删库失败就不能改本地视图：否则界面少一条、库里还在，重开会话又冒出来
        logger.error('AgentStore', 'deleteMessage failed', { error });
        throw error;
      }
    }
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    return true;
  },

  sendMessage: async (
    conversationId,
    content,
    allowedTools?: string[] | null,
    modelId?: string | null,
    explicitAgentId?: string | null,
  ) => {
    const state = get();
    if (state.isStreaming || state.interruptRequested) {
      logger.warn('AgentStore', 'Already streaming / interrupt pending, ignoring message');
      return;
    }

    // run_agent 需要 agentId，解析优先级：显式传入 > 会话归属 > 当前选中的 Agent。
    // 直读 API 建会话的面板（写作台语料参谋 / 写作台 AI 对话框）不经过 store.conversations，
    // 也没有设置 selectedAgentId——必须由调用端显式传 agentId，否则这里只能放弃发送。
    const agentId =
      explicitAgentId ?? state.conversations.find((c) => c.id === conversationId)?.agentId ?? state.selectedAgentId;
    if (!agentId) {
      logger.error('AgentStore', 'sendMessage aborted: 无法确定 agentId', { conversationId });
      return;
    }

    // 乐观渲染用户消息（落库由后端 run_agent 统一负责，前端再存一份会重复）
    const optimisticUserMessage: AiMessage = {
      id: `local_${Date.now()}`,
      conversationId,
      role: 'user',
      content,
      toolCalls: null,
      createdAt: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, optimisticUserMessage] }));

    // 收尾统一走这里：谁先到谁生效（onDone / 命令返回 / catch / 超时强制收尾）。
    // once 语义：同一轮的多条收尾路径几乎总会先后到达（onDone 与命令返回兜底必有一次重叠），
    // 只有第一条真正执行，其余直接返回——否则后到的收尾会清掉可能已被新一轮接管的
    // 流式状态（isStreaming / currentRunId / pendingToolApproval），产生跨轮串扰。
    // 若收尾时 interruptRequested 仍为真，说明本轮是被用户按停止截断的 → 记账供面板标注「已停止」。
    let settled = false;
    const settleStream = () => {
      if (settled) return;
      settled = true;
      if (watchdog) {
        clearInterval(watchdog);
        watchdog = null;
      }
      if (forceSettleTimer) {
        clearTimeout(forceSettleTimer);
        forceSettleTimer = null;
      }
      // 丢弃仍卡在 flush 窗口内的残余分片：权威全文由 loadMessages 从库里拉齐
      // （onDone / 命令返回兜底路径），被停止截断的残余也不应再写入界面。
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      streamBuf = '';
      const wasInterrupted = get().interruptRequested;
      set((s) => ({
        isStreaming: false,
        streamingContent: '',
        interruptRequested: false,
        currentRunId: null,
        // currentStreamConversationId 保留到下一轮发起再覆盖：流结束后 UI 仍要靠它判断
        // 本条「错误气泡 / 已停止」标注属于哪个会话（isStreaming=false 时不会误渲染流式内容）。
        streamLastChunkAt: null,
        stoppedConversationId: wasInterrupted ? conversationId : s.stoppedConversationId,
        // lastStreamError 不清空：settle 后保留给 UI 渲染错误气泡，下一轮发起时再清。
        // 收尾时清掉可能残留的审批弹窗（如用户在审批等待中点了「停止」：后端已按拒绝处理并结束本轮）
        pendingToolApproval: null,
      }));
    };

    // 卡死 watchdog：provider 半开 / 网络断 / 后端挂起时 onDone 永远不来，
    // isStreaming 会一直为 true 锁死全部 AI 入口——用「最后 chunk 时间」判定空闲超时，
    // 超时先调用 requestInterrupt 走标准取消（保留已吐出的部分回答），
    // 后端仍不回执的话再由 forceSettleTimer 强制收尾解锁并发闸门。
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let forceSettleTimer: ReturnType<typeof setTimeout> | null = null;

    // ---- streamingContent 合并 flush（对标 VS Code rAF 批处理）----
    // onChunk 高频到达时只追加到缓冲区，flushTimer 按 STREAM_FLUSH_MS 窗口统一 set 一次：
    // ① 全串拼接频率从「每片一次 O(n)」降到「每窗口一次」，长流式下避免 O(n²) 卡顿；
    // ② store 广播与所有订阅端重渲染从「每片一次」降到「每秒 ~20 次」，文字仍逐字流动。
    // streamLastChunkAt 也随 flush 更新：watchdog 巡检 5s / 超时阈值 90s，48ms 窗口偏差可忽略。
    let streamBuf = '';
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushStream = () => {
      streamFlushTimer = null;
      if (!streamBuf || settled) return;
      // 已按停止：残余片不写入，界面立刻停字（对标 VS Code「停止即冻结」）
      if (get().interruptRequested) {
        streamBuf = '';
        return;
      }
      const buf = streamBuf;
      streamBuf = '';
      set((state) => ({
        streamingContent: state.streamingContent + buf,
        streamLastChunkAt: Date.now(),
      }));
    };

    // 高危工具审批监听：引擎即将执行 run_command / 写入类工具时推送，前端弹确认框。
    // 仅在本轮运行期间有效，结束时务必反注册，避免泄漏监听器。
    // 声明在 try 之外，catch 中也能反注册，防止异常路径悬挂监听。
    const approvalUnlisten: Promise<UnlistenFn> = listen<AgentToolApprovalEvent>('agent-tool-approval', (event) => {
      if (event.payload.conversationId !== conversationId) return;
      set({
        pendingToolApproval: {
          runId: event.payload.runId,
          toolCallId: event.payload.toolCallId,
          tool: event.payload.tool,
          command: event.payload.command,
          cwd: event.payload.cwd,
          summary: event.payload.summary ?? '',
          sessionRememberable: event.payload.sessionRememberable ?? false,
        },
      });
    });

    try {
      // 前端生成单次运行 id，随 run_agent 下发，供 requestInterrupt 精准取消本次运行
      const runId = globalThis.crypto?.randomUUID?.() ?? `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // 开始流式响应（清掉上一轮的「已停止」标注与错误：新一轮开始，旧回执作废）
      set({
        isStreaming: true,
        streamingContent: '',
        toolCalls: [],
        currentRunId: runId,
        stoppedConversationId: null,
        currentStreamConversationId: conversationId,
        lastStreamError: null,
        streamLastChunkAt: Date.now(),
        pendingToolApproval: null,
      });

      // 启动空闲超时 watchdog：固定间隔巡检，只在流仍活跃且超时时动作
      watchdog = setInterval(() => {
        const current = get();
        if (!current.isStreaming) {
          if (watchdog) clearInterval(watchdog);
          watchdog = null;
          return;
        }
        const lastActive = current.streamLastChunkAt ?? Date.now();
        if (Date.now() - lastActive <= STREAM_IDLE_TIMEOUT_MS) return;
        // 判定卡死：先记账（哨兵 'timeout'，UI 据此显示本地化文案），再走标准取消
        set({ lastStreamError: 'timeout' });
        get().requestInterrupt();
        if (!forceSettleTimer) {
          forceSettleTimer = setTimeout(() => {
            if (get().isStreaming) settleStream();
          }, STREAM_FORCE_SETTLE_MS);
        }
      }, 5000);

      await agentApi.runAgent(
        agentId,
        content,
        conversationId,
        // onChunk
        (chunk) => {
          // 已点停止 / 已收尾：丢弃在途残余分片，界面立刻停字（对标 VS Code）。
          // 后端取消是「读下一个网络分片前检查」，已在飞行中的那一片仍会到达，这里兜住；
          // settled 兜住「收尾后才抵达的迟到分片」，避免它们复活已清空的流式状态。
          if (settled || get().interruptRequested) return;
          // 高频分片只攒缓冲，flushStream 按 STREAM_FLUSH_MS 窗口统一 set 一次，
          // 避免每个 chunk 做一次全串拼接（长流式 O(n²)）与一次 store 广播（全端重渲染）。
          streamBuf += chunk;
          if (!streamFlushTimer) {
            streamFlushTimer = setTimeout(flushStream, STREAM_FLUSH_MS);
          }
        },
        // onToolCall：running / done 两次事件合并成一张卡片
        (toolCall) => {
          set((state) => ({ toolCalls: mergeToolCallEvent(state.toolCalls, toolCall) }));
        },
        // onDone：后端已落库用户消息 + 助手回复，这里从 DB 重新拉齐即可
        async () => {
          try {
            // 仅当本轮仍持有流式槽位（currentRunId === runId）时才刷新：
            // 若命令返回兜底已收尾且新一轮已接管（currentRunId 变了），
            // 旧快照 set 进 messages 会覆盖新一轮的乐观消息，跳过更安全。
            if (get().currentRunId === runId) {
              await get().loadMessages(conversationId);
            }
          } catch (e) {
            // 拉齐失败不阻断收尾：否则 isStreaming 会一直挂到 watchdog 超时才解锁
            logger.warn('AgentStore', 'onDone loadMessages failed', { error: e });
          } finally {
            settleStream();
          }
        },
        // onError
        (error) => {
          logger.error('AgentStore', 'runAgent error', { error });
          // 错误只记文本不记原始对象（避免把密钥/超长文本塞进 UI 状态），截断到可展示长度
          set({ lastStreamError: error.slice(0, 500) || 'unknown' });
          settleStream();
        },
        // runId：后端取消令牌表的 key
        runId,
        // allowedTools：本次调用的工具白名单（模式切换只影响本次，不污染 Agent 配置）
        allowedTools,
        // modelId：模型选择器覆盖（对标 VS Code），发给 run_agent 覆盖 Agent 默认模型
        modelId,
      );
      // 兜底：事件可能因窗口切换错过，命令返回后再对齐一次；
      // onDone 已先行收尾时跳过重复刷新（settle 的 once 语义也会拦截重复收尾）
      if (!settled) {
        try {
          await get().loadMessages(conversationId);
        } catch (e) {
          // 拉齐失败不应伪装成运行失败（否则成功的一轮会冒出错误气泡），只记日志
          logger.warn('AgentStore', 'post-run loadMessages failed', { error: e });
        }
      }
      settleStream();
      // 清理审批监听器（无论正常结束还是异常，都不留悬挂监听）
      const unlisten = await approvalUnlisten;
      unlisten();
    } catch (error) {
      logger.error('AgentStore', 'sendMessage failed', { error });
      // 仅当本轮尚未收尾时才入账：若运行已成功收尾、只是清理动作（如反注册监听）抛错，
      // 不应给成功的一轮补一条错误气泡
      if (!settled) {
        // 命令级失败同样入账（如后端不可达），UI 能显示失败原因而非只看到「流没了」
        const text = error instanceof Error ? error.message : typeof error === 'string' ? error : 'send failed';
        set({ lastStreamError: text.slice(0, 500) || 'unknown' });
      }
      settleStream();
      // 异常路径同样反注册审批监听器，防止悬挂监听泄漏
      try {
        const unlisten = await approvalUnlisten;
        unlisten();
      } catch (e) {
        logger.warn('AgentStore', 'cleanup approval listener failed', { error: e });
      }
    }
  },

  resolveToolApproval: async (approved: boolean, rememberSession = false) => {
    const pending = get().pendingToolApproval;
    if (!pending) return;
    // 先清空，避免重复点击；后端按 runId:toolCallId 精准命中在途审批通道
    set({ pendingToolApproval: null });
    try {
      await agentApi.resolveToolApproval(pending.runId, pending.toolCallId, approved, rememberSession);
    } catch (e) {
      logger.error('AgentStore', 'resolveToolApproval failed', { error: e });
    }
  },

  // Selection actions
  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId, selectedConversationId: null, messages: [] });
  },

  selectConversation: (conversationId) => {
    if (conversationId) {
      // 先清空旧消息并置位加载态，再加载新消息，避免旧消息残留
      set({ selectedConversationId: conversationId, messages: [] });
      get().loadMessages(conversationId);
    } else {
      set({ selectedConversationId: null, messages: [] });
    }
  },

  requestInterrupt: () => {
    // 1) 真正触发后端取消：按当前运行 id 置位取消令牌，引擎在下一轮迭代前停下（P2.3）。
    const runId = get().currentRunId;
    if (runId) {
      agentApi.cancelAgentRun(runId).catch((e) => logger.warn('AgentStore', 'cancelAgentRun failed', { error: e }));
    }
    // 2) 仅置位中断请求：不清除 isStreaming，保证并发闸门在后端回执前一直关闭，
    // 防止「点停止 → isStreaming 变 false → 用户再发一条 → 两轮并发写同一会话」。
    set({ interruptRequested: true });
  },
}));
