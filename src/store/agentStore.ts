import { create } from 'zustand';
import { agentApi } from '../services/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
  toolCalls: ToolCallEvent[];

  /**
   * 待用户确认的高危工具调用（当前为 run_command 的 human-in-the-loop 拦截）。
   * 引擎在即将执行命令前推送审批请求，前端据此弹确认框；用户落定后清空。
   * 仅一条在途审批（一轮内 run_command 串行，不会并发等待多条）。
   */
  pendingToolApproval: {
    runId: string;
    toolCallId: string;
    tool: string;
    command: string;
    cwd: string;
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
  ) => Promise<void>;
  /**
   * 从某条消息起截断当前转录（含该条），返回被截断的第一条消息（供「重试」拿回原始正文）。
   * 面板「重试 / 编辑重发」的公共前置动作：先抹掉旧的那一轮，再重跑，避免会话里留两份同样的请求。
   * 流式期间拒绝执行（正在写库，截断会与落库竞争）。
   */
  truncateMessagesFrom: (messageId: string) => Promise<AiMessage | null>;

  selectAgent: (agentId: string | null) => void;
  selectConversation: (conversationId: string | null) => void;

  /** 请求中断当前流式：置位 interruptRequested，保持并发闸门关闭，直到后端回执才复位 */
  requestInterrupt: () => void;

  /** 落定当前待审批的高危工具调用：approved=true 允许执行，false 拒绝（引擎默认拒绝）。 */
  resolveToolApproval: (approved: boolean) => Promise<void>;
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

  createConversation: async (agentId, title = '新对话') => {
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

  sendMessage: async (conversationId, content, allowedTools?: string[] | null, modelId?: string | null) => {
    const state = get();
    if (state.isStreaming || state.interruptRequested) {
      logger.warn('AgentStore', 'Already streaming / interrupt pending, ignoring message');
      return;
    }

    // run_agent 需要 agentId：优先取会话归属，回退到当前选中的 Agent。
    // 两者都拿不到就直接失败——绝不在这里兜底成某个写死的 Agent。
    const agentId = state.conversations.find((c) => c.id === conversationId)?.agentId ?? state.selectedAgentId;
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

    // 收尾统一走这里：谁先到谁生效（onDone / 命令返回 / catch）。
    // 若收尾时 interruptRequested 仍为真，说明本轮是被用户按停止截断的 → 记账供面板标注「已停止」。
    const settleStream = () => {
      const wasInterrupted = get().interruptRequested;
      set((s) => ({
        isStreaming: false,
        streamingContent: '',
        interruptRequested: false,
        currentRunId: null,
        stoppedConversationId: wasInterrupted ? conversationId : s.stoppedConversationId,
        // 收尾时清掉可能残留的审批弹窗（如用户在审批等待中点了「停止」：后端已按拒绝处理并结束本轮）
        pendingToolApproval: null,
      }));
    };

    // 高危工具审批监听：引擎即将执行 run_command 时推送，前端弹确认框。
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
        },
      });
    });

    try {
      // 前端生成单次运行 id，随 run_agent 下发，供 requestInterrupt 精准取消本次运行
      const runId = globalThis.crypto?.randomUUID?.() ?? `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // 开始流式响应（清掉上一轮的「已停止」标注：新一轮开始，旧回执作废）
      set({
        isStreaming: true,
        streamingContent: '',
        toolCalls: [],
        currentRunId: runId,
        stoppedConversationId: null,
        pendingToolApproval: null,
      });

      await agentApi.runAgent(
        agentId,
        content,
        conversationId,
        // onChunk
        (chunk) => {
          // 已点停止：丢弃在途残余分片，界面立刻停字（对标 VS Code）。
          // 后端取消是「读下一个网络分片前检查」，已在飞行中的那一片仍会到达，这里兜住。
          if (get().interruptRequested) return;
          set((state) => ({ streamingContent: state.streamingContent + chunk }));
        },
        // onToolCall：running / done 两次事件合并成一张卡片
        (toolCall) => {
          set((state) => ({ toolCalls: mergeToolCallEvent(state.toolCalls, toolCall) }));
        },
        // onDone：后端已落库用户消息 + 助手回复，这里从 DB 重新拉齐即可
        async () => {
          await get().loadMessages(conversationId);
          settleStream();
        },
        // onError
        (error) => {
          logger.error('AgentStore', 'runAgent error', { error });
          settleStream();
        },
        // runId：后端取消令牌表的 key
        runId,
        // allowedTools：本次调用的工具白名单（模式切换只影响本次，不污染 Agent 配置）
        allowedTools,
        // modelId：模型选择器覆盖（对标 VS Code），发给 run_agent 覆盖 Agent 默认模型
        modelId,
      );
      // 兜底：事件可能因窗口切换错过，命令返回后再对齐一次
      await get().loadMessages(conversationId);
      settleStream();
      // 清理审批监听器（无论正常结束还是异常，都不留悬挂监听）
      const unlisten = await approvalUnlisten;
      unlisten();
    } catch (error) {
      logger.error('AgentStore', 'sendMessage failed', { error });
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

  resolveToolApproval: async (approved: boolean) => {
    const pending = get().pendingToolApproval;
    if (!pending) return;
    // 先清空，避免重复点击；后端按 runId:toolCallId 精准命中在途审批通道
    set({ pendingToolApproval: null });
    try {
      await agentApi.resolveToolApproval(pending.runId, pending.toolCallId, approved);
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
