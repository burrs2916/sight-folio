import { invoke } from './core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ─── AI Agent 系统 ───
export interface AiProvider {
  id: string;
  name: string;
  apiKey: string;
  color: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiEndpoint {
  id: string;
  providerId: string;
  name: string;
  apiType: string;
  baseUrl: string;
  authType: string;
  customAuthHeader: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiModel {
  id: string;
  name: string;
  refKey: string;
  endpointId: string;
  reasoning: boolean;
  inputTypes: string[];
  contextWindow: number;
  maxTokens: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiAgent {
  id: string;
  name: string;
  description: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  maxIterations: number;
  toolIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AiConversation {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls: string | null;
  createdAt: number;
}

/**
 * 单次工具调用的一次状态推送。
 * 后端 engine.rs::ToolCallEvent 序列化后嵌在 `agent-tool-call` 事件的 `toolCall` 字段里，
 * 同一次调用会推两次：status="running"（arguments 有值、result 为 null）
 * 与 status="done"|"error"（result 有值、arguments 为 null）。
 */
export interface ToolCallEvent {
  toolName: string;
  arguments: unknown;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done' | 'error' | 'denied';
}

/** `agent-tool-call` 事件的完整 payload（工具事件被包了一层） */
export interface AgentToolCallEvent {
  conversationId: string;
  toolCall: ToolCallEvent;
}

/** `agent-tool-approval` 事件的 payload：引擎即将执行高危工具（run_command / 写入类）前推送，等用户确认 */
export interface AgentToolApprovalEvent {
  conversationId: string;
  runId: string;
  toolCallId: string;
  tool: string;
  /** 仅 run_command 填写 */
  command: string;
  /** 仅 run_command 填写 */
  cwd: string;
  /** 面向创作者的操作摘要（写入类工具没有 command，用 summary 展示） */
  summary?: string;
  /** true = 写入类低危工具，弹窗提供「本会话不再询问」选项 */
  sessionRememberable?: boolean;
}

export interface AgentChunkEvent {
  conversationId: string;
  chunk: string;
}

export interface AgentDoneEvent {
  conversationId: string;
  response: string;
}

export interface AgentErrorEvent {
  conversationId: string;
  error: string;
}

export const agentApi = {
  // Provider CRUD
  async listProviders(): Promise<AiProvider[]> {
    return invoke('list_providers');
  },
  async saveProvider(provider: AiProvider): Promise<void> {
    return invoke('save_provider', { provider });
  },
  async deleteProvider(id: string): Promise<void> {
    return invoke('delete_provider', { id });
  },

  // Endpoint CRUD
  async listEndpoints(): Promise<AiEndpoint[]> {
    return invoke('list_endpoints');
  },
  async listEndpointsByProvider(providerId: string): Promise<AiEndpoint[]> {
    return invoke('list_endpoints_by_provider', { providerId });
  },
  async saveEndpoint(endpoint: AiEndpoint): Promise<void> {
    return invoke('save_endpoint', { endpoint });
  },
  async deleteEndpoint(id: string): Promise<void> {
    return invoke('delete_endpoint', { id });
  },
  async testEndpointConnection(endpointId: string): Promise<string> {
    return invoke('test_endpoint_connection', { endpointId });
  },

  // Model CRUD
  async listModels(): Promise<AiModel[]> {
    return invoke('list_models');
  },
  async listModelsByEndpoint(endpointId: string): Promise<AiModel[]> {
    return invoke('list_models_by_endpoint', { endpointId });
  },
  async saveModel(model: AiModel): Promise<void> {
    return invoke('save_model', { model });
  },
  async deleteModel(id: string): Promise<void> {
    return invoke('delete_model', { id });
  },
  async testModelChat(modelId: string): Promise<string> {
    return invoke('test_model_chat', { modelId });
  },

  // Agent CRUD
  async listAgents(): Promise<AiAgent[]> {
    return invoke('list_agents');
  },
  async saveAgent(agent: AiAgent): Promise<void> {
    return invoke('save_agent', { agent });
  },
  async deleteAgent(id: string): Promise<void> {
    return invoke('delete_agent', { id });
  },

  // Conversation CRUD
  async listConversations(agentId: string): Promise<AiConversation[]> {
    return invoke('list_conversations', { agentId });
  },
  async createConversation(agentId: string, title: string): Promise<AiConversation> {
    return invoke('create_conversation', { agentId, title });
  },
  async deleteConversation(id: string): Promise<void> {
    return invoke('delete_conversation', { id });
  },

  // Message CRUD
  async listMessages(conversationId: string): Promise<AiMessage[]> {
    return invoke('list_messages', { conversationId });
  },
  async saveMessage(message: AiMessage): Promise<void> {
    return invoke('save_message', { message });
  },
  /**
   * 批量删除消息（按 id）。
   *
   * 面板「重试 / 编辑重发」用：两者都要先抹掉旧的那一轮再重跑，否则同一次请求会在会话里
   * 留两份，下一轮模型看到的是重复对话。只按显式 id 删（不按时间戳），避免同毫秒的相邻行被误连坐。
   */
  async deleteMessages(ids: string[]): Promise<number> {
    return invoke('delete_messages', { ids });
  },

  /**
   * 运行 Agent（流式 + 工具调用）。
   *
   * 参数名必须与后端 `run_agent(agent_id, message, conversation_id)` 逐字对齐：
   * Tauri 按 camelCase 键名映射 snake_case 形参，少一个必填形参就是运行时 400。
   * 事件字段同理 —— 后端 emit 的是 `chunk` / `response` / `toolCall`（嵌套一层），
   * 不是 `content` / `fullContent` / 扁平工具字段。
   */
  async runAgent(
    agentId: string,
    message: string,
    conversationId: string,
    onChunk?: (chunk: string) => void,
    onToolCall?: (toolCall: ToolCallEvent) => void,
    onDone?: (fullContent: string) => void,
    onError?: (error: string) => void,
    /** 前端下发的单次运行 id，用于 cancel_agent_run 精准取消（坐标系与后端取消令牌表一致） */
    runId?: string,
    /** 单次调用工具白名单（与 Agent 配置取交集；省略=不限制） */
    allowedTools?: string[] | null,
    /** 模型覆盖（对标 VS Code 的模型选择器）：显式选了某模型则覆盖 Agent 配置绑定的模型；省略=跟随 Agent 默认 */
    modelId?: string | null,
  ): Promise<string> {
    // 监听流式事件
    const unlisteners: Promise<UnlistenFn>[] = [];

    if (onChunk) {
      unlisteners.push(
        listen<AgentChunkEvent>('agent-chunk', (event) => {
          if (event.payload.conversationId === conversationId) {
            onChunk(event.payload.chunk);
          }
        }),
      );
    }

    if (onToolCall) {
      unlisteners.push(
        listen<AgentToolCallEvent>('agent-tool-call', (event) => {
          if (event.payload.conversationId === conversationId) {
            onToolCall(event.payload.toolCall);
          }
        }),
      );
    }

    if (onDone) {
      unlisteners.push(
        listen<AgentDoneEvent>('agent-done', (event) => {
          if (event.payload.conversationId === conversationId) {
            onDone(event.payload.response);
          }
        }),
      );
    }

    if (onError) {
      unlisteners.push(
        listen<AgentErrorEvent>('agent-error', (event) => {
          if (event.payload.conversationId === conversationId) {
            onError(event.payload.error);
          }
        }),
      );
    }

    try {
      return await invoke<string>('run_agent', {
        agentId,
        message,
        conversationId,
        allowedTools: allowedTools ?? null,
        runId: runId ?? null,
        modelId: modelId ?? null,
      });
    } finally {
      // 清理所有监听器
      const unlistenFns = await Promise.all(unlisteners);
      unlistenFns.forEach((fn) => fn());
    }
  },

  /**
   * 取消一次正在运行的 `run_agent`（按前端下发的 runId 精准命中单次运行）。
   * 幂等：未知 / 已结束的 runId 也返回成功，可重复点击停止。
   */
  async cancelAgentRun(runId: string): Promise<void> {
    await invoke('cancel_agent_run', { runId });
  },

  /**
   * 落定一次待审批的高危工具调用（human-in-the-loop 确认）。
   * `rememberSession`：写入类低危工具勾选「本会话不再询问」时传 true。
   * 引擎在审批闸门里 await 此结果；超时 / 取消一律按拒绝处理。
   */
  async resolveToolApproval(
    runId: string,
    toolCallId: string,
    approved: boolean,
    rememberSession = false,
  ): Promise<boolean> {
    return invoke<boolean>('resolve_tool_approval', {
      runId,
      toolCallId,
      approved,
      remember: rememberSession,
    });
  },
};
