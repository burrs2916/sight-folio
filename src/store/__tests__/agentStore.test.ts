// agentStore · sendMessage 流式状态机回归锁（P0 流式归属 / P1 超时兜底 / 错误感知 / 停止标注）
//
// 锁死的行为：
// ① 发起流式时置位 currentStreamConversationId（流归属）+ streamLastChunkAt + 清 lastStreamError；
// ② onChunk 攒批到 streamBuf，STREAM_FLUSH_MS 窗口后 flush 进 streamingContent 并刷新最后活跃时间戳；
// ③ onDone / onError 统一 settle：isStreaming 复位、currentStreamConversationId 保留
//    （流结束后 UI 仍要靠它判断错误/停止回执归属）、lastStreamError 保留给 UI 渲染；
// ④ 空闲超时 watchdog：超过 STREAM_IDLE_TIMEOUT_MS 无 chunk → lastStreamError='timeout' +
//    requestInterrupt（走标准取消）；STREAM_FORCE_SETTLE_MS 后端仍不回执 → forceSettle 强制解锁并发闸门；
// ⑤ 被停止（interruptRequested）的轮次 settle 时记账 stoppedConversationId；
// ⑥ 新一轮发起清掉上一轮停止标注与错误。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAgentStore, STREAM_IDLE_TIMEOUT_MS, STREAM_FORCE_SETTLE_MS, STREAM_FLUSH_MS } from '../../store/agentStore';

type RunAgentArgs = [
  agentId: string,
  content: string,
  conversationId: string,
  onChunk: (chunk: string) => void,
  onToolCall: (toolCall: unknown) => void,
  onDone: () => Promise<void>,
  onError: (error: string) => void,
  runId: string,
  allowedTools?: string[] | null,
  modelId?: string | null,
];

type RunAgentImpl = (...args: RunAgentArgs) => Promise<void>;

interface RunAgentCallbacks {
  onChunk: (chunk: string) => void;
  onToolCall: (toolCall: unknown) => void;
  onDone: () => Promise<void>;
  onError: (error: string) => void;
  runId: string;
}

const h = vi.hoisted(() => {
  const callbacks: Partial<RunAgentCallbacks> = {};
  const state = {
    runAgent: vi.fn<RunAgentImpl>(
      (_agentId, _content, _conversationId, onChunk, onToolCall, onDone, onError, runId) => {
        callbacks.onChunk = onChunk;
        callbacks.onToolCall = onToolCall;
        callbacks.onDone = onDone;
        callbacks.onError = onError;
        callbacks.runId = runId;
        return new Promise<void>(() => {});
      },
    ),
    cancelAgentRun: vi.fn(async () => {}),
    listMessages: vi.fn(async () => []),
  };
  return { state, callbacks };
});

vi.mock('../../services/tauri', () => ({
  agentApi: {
    listAgents: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    listMessages: h.state.listMessages,
    runAgent: h.state.runAgent,
    cancelAgentRun: h.state.cancelAgentRun,
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const resetStore = () =>
  useAgentStore.setState({
    messages: [],
    isStreaming: false,
    streamingContent: '',
    interruptRequested: false,
    currentRunId: null,
    stoppedConversationId: null,
    currentStreamConversationId: null,
    lastStreamError: null,
    streamLastChunkAt: null,
    toolCalls: [],
    pendingToolApproval: null,
    selectedAgentId: 'a1',
    conversations: [{ id: 'c1', agentId: 'a1', title: 't', createdAt: 1, updatedAt: 1 }],
  });

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  h.state.runAgent.mockClear();
  h.state.cancelAgentRun.mockClear();
  h.state.listMessages.mockClear();
  h.state.listMessages.mockResolvedValue([]);
  h.callbacks.onChunk = undefined;
  h.callbacks.onToolCall = undefined;
  h.callbacks.onDone = undefined;
  h.callbacks.onError = undefined;
  h.callbacks.runId = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

/** 触发后端完成回执（onDone → loadMessages → settleStream） */
async function fireDone() {
  h.callbacks.onChunk?.('>>> 一句。');
  await h.callbacks.onDone?.();
  await vi.advanceTimersByTimeAsync(0);
}

describe('agentStore · sendMessage 流式状态机', () => {
  it('发起流式：置位流归属与最后活跃时间戳，清旧错误；正常完成 settle 后归属保留、isStreaming 复位', async () => {
    // 上一轮遗留的错误回执：新一轮发起时应被清掉
    useAgentStore.setState({ lastStreamError: 'old-error', stoppedConversationId: 'c1' });

    void useAgentStore.getState().sendMessage('c1', '请生成');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.runAgent).toHaveBeenCalledWith(
      'a1',
      '请生成',
      'c1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(String),
      undefined,
      undefined,
    );

    // 流进行中：归属 + 活跃时间戳已置位，旧错误已清
    let s = useAgentStore.getState();
    expect(s.isStreaming).toBe(true);
    expect(s.currentStreamConversationId).toBe('c1');
    expect(s.streamLastChunkAt).not.toBeNull();
    expect(s.lastStreamError).toBeNull();
    expect(s.stoppedConversationId).toBeNull();

    // 模拟后端完成回执：onDone → loadMessages → settleStream
    await fireDone();
    s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.streamingContent).toBe(''); // settle 清空流式内容
    expect(s.currentStreamConversationId).toBe('c1'); // 归属保留：UI 靠它判错误/停止回执归属
    expect(s.lastStreamError).toBeNull();
    expect(s.stoppedConversationId).toBeNull();
  });

  it('onError：错误截断入账 lastStreamError，settle 复位；归属保留供 UI 渲染错误气泡', async () => {
    void useAgentStore.getState().sendMessage('c1', '请生成');
    await vi.advanceTimersByTimeAsync(0);

    h.callbacks.onError?.('provider 500');
    await vi.advanceTimersByTimeAsync(0);

    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.lastStreamError).toBe('provider 500');
    expect(s.currentStreamConversationId).toBe('c1');
  });

  it('空闲超时 watchdog：无 chunk 超过阈值 → 记 lastStreamError=timeout 并走 requestInterrupt；后端仍不回执则 forceSettle 强制收尾解锁闸门', async () => {
    // runAgent 永不回执（默认悬挂 promise）：模拟 provider/后端卡死
    void useAgentStore.getState().sendMessage('c1', '请生成');
    await vi.advanceTimersByTimeAsync(0);
    expect(useAgentStore.getState().isStreaming).toBe(true);

    // 未超时阶段：watchdog 巡检不应动作
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS - 10_000);
    await vi.advanceTimersByTimeAsync(5_000);
    let s = useAgentStore.getState();
    expect(s.isStreaming).toBe(true);
    expect(s.lastStreamError).toBeNull();
    expect(s.interruptRequested).toBe(false);

    // 越过空闲阈值：判定卡死 → 记 timeout + 触发标准取消
    await vi.advanceTimersByTimeAsync(10_000);
    s = useAgentStore.getState();
    expect(s.lastStreamError).toBe('timeout');
    expect(s.interruptRequested).toBe(true);
    expect(h.state.cancelAgentRun).toHaveBeenCalledWith(h.callbacks.runId);
    // 仍未收尾（后端不回执）：全局闸门保持关闭，防并发写
    expect(s.isStreaming).toBe(true);

    // forceSettle 兜底：强制收尾，解锁并发闸门；停止标记应记账（被截断）
    await vi.advanceTimersByTimeAsync(STREAM_FORCE_SETTLE_MS + 1_000);
    s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.interruptRequested).toBe(false);
    // 超时强制收尾属于「非自然结束」：记账停止标注，UI 可说明
    expect(s.stoppedConversationId).toBe('c1');
    expect(s.lastStreamError).toBe('timeout'); // 错误回执保留
  });

  it('流中有活跃 chunk 时不判超时（时间戳持续刷新）；用户停止后 settle 记账 stoppedConversationId', async () => {
    void useAgentStore.getState().sendMessage('c1', '请生成');
    await vi.advanceTimersByTimeAsync(0);

    // 每 60s 来一个 chunk：持续刷新时间戳，永不触发空闲超时
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      h.callbacks.onChunk?.(`chunk-${i}`);
      // 攒批 flush 语义：需越过 STREAM_FLUSH_MS 窗口后内容才写入 streamingContent
      await vi.advanceTimersByTimeAsync(STREAM_FLUSH_MS + 1);
      expect(useAgentStore.getState().streamingContent).toContain(`chunk-${i}`);
      expect(useAgentStore.getState().lastStreamError).toBeNull();
    }

    // 用户按停止：置中断请求（模拟 requestInterrupt），后端随后回执 → settle 记账停止标注
    useAgentStore.getState().requestInterrupt();
    expect(useAgentStore.getState().interruptRequested).toBe(true);
    await h.callbacks.onDone?.();
    await vi.advanceTimersByTimeAsync(0);

    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.stoppedConversationId).toBe('c1');
    expect(s.lastStreamError).toBeNull();
  });

  it('新一轮发起清掉上一轮停止标注（旧回执作废）', async () => {
    useAgentStore.setState({ stoppedConversationId: 'c1', currentStreamConversationId: 'c1' });

    void useAgentStore.getState().sendMessage('c1', '再来一轮');
    await vi.advanceTimersByTimeAsync(0);
    const s = useAgentStore.getState();
    expect(s.isStreaming).toBe(true);
    expect(s.stoppedConversationId).toBeNull(); // 停止标注清零
    expect(s.currentStreamConversationId).toBe('c1');
  });

  it('面板场景：store 无该会话且未选中 agent 时，显式传入 agentId 仍可发送（写作台直读 API 面板的回归锁）', async () => {
    // 写作台（desk 窗口）的 AiCorpusPanel / WritingAiChatDialog：直读 agentApi 建会话，
    // store.conversations 为空、selectedAgentId 也为 null——没有显式 agentId 时 sendMessage 只能放弃
    useAgentStore.setState({ conversations: [], selectedAgentId: null });

    void useAgentStore.getState().sendMessage('conv-x', '请生成', null, null, 'agent-explicit');
    await vi.advanceTimersByTimeAsync(0);

    // 未 abort：runAgent 收到了显式 agentId
    expect(useAgentStore.getState().isStreaming).toBe(true);
    expect(h.state.runAgent).toHaveBeenCalledWith(
      'agent-explicit',
      '请生成',
      'conv-x',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(String),
      null,
      null,
    );
  });

  it('agentId 解析优先级：显式传入 > 会话归属 > 当前选中 agent', async () => {
    // 会话归属为 a-from-conversation、选中为 a-selected，显式传 a-explicit 应胜出
    useAgentStore.setState({
      conversations: [{ id: 'c1', agentId: 'a-from-conversation', title: 't', createdAt: 1, updatedAt: 1 }],
      selectedAgentId: 'a-selected',
    });
    void useAgentStore.getState().sendMessage('c1', '请生成', null, null, 'a-explicit');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.runAgent).toHaveBeenCalledWith(
      'a-explicit',
      '请生成',
      'c1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(String),
      null,
      null,
    );
  });
});
