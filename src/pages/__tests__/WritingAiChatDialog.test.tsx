// 写作台 AI 对话面板 · 回归锁（D：对话式 AI）
//
// 这条测试锁死：
// ① 打开即复用同名会话（不重复 createConversation）并渲染历史消息（user/assistant 气泡）；
// ② 首轮发送自动注入写作上下文（上下文前缀 + 用户输入，一条消息发出）；
// ③ 次轮发送不重复注入（靠对话历史延续）。
// store.messages 零接触（组件直读 agentApi 防污染），本测试 mock agentApi + agentStore。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => {
  const listeners: Array<(s: unknown) => void> = [];
  const state = {
    agents: [{ id: 'a1', name: 'A' }],
    isStreaming: false,
    streamingContent: '',
    stoppedConversationId: null as string | null,
    // 流归属 / 错误感知：驱动 isOwnStreaming 与错误气泡（归属过滤回归锁）
    currentStreamConversationId: null as string | null,
    lastStreamError: null as string | null,
    subscribe: vi.fn((fn: (s: unknown) => void) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    sendMessage: vi.fn(async (_convId: string, _content: string) => {}),
  };
  return {
    state,
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    listMessages: vi.fn(),
  };
});

vi.mock('../../services/tauri', () => ({
  agentApi: {
    listConversations: h.listConversations,
    createConversation: h.createConversation,
    listMessages: h.listMessages,
  },
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (sel: (s: unknown) => unknown) => {
      // 订阅 store：测试里手动变更 h.state 并派发 subscribe 时强制组件重渲染
      const [, force] = useReducer((x: number) => x + 1, 0);
      useEffect(() => {
        const unsub = h.state.subscribe(() => force());
        return unsub;
      }, []);
      return sel(h.state);
    },
    {
      getState: () => h.state,
      subscribe: h.state.subscribe,
    },
  ),
}));

import { WritingAiChatDialog } from '../WritingAiChatDialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mountAsync(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.agents = [{ id: 'a1', name: 'A' }];
  h.state.isStreaming = false;
  h.state.streamingContent = '';
  h.state.stoppedConversationId = null;
  h.state.currentStreamConversationId = null;
  h.state.lastStreamError = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

const TITLE = '写作台 AI · 测试之书';

const msg = (id: string, role: 'user' | 'assistant', content: string) => ({
  id,
  conversationId: 'c1',
  role,
  content,
  toolCalls: null,
  createdAt: 1,
});

function textEl(text: string): HTMLElement | null {
  const els = Array.from(document.body.querySelectorAll('*')) as HTMLElement[];
  return els.find((e) => e.textContent === text && e.children.length === 0) ?? null;
}

/** 受控 textarea 设值（native setter 触发 React onChange；包 act 避免 act 外更新警告） */
async function typeInput(text: string) {
  const el = document.querySelector('textarea') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressEnter() {
  const el = document.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('写作台 AI 对话面板（D · 回归锁）', () => {
  it('打开即复用同名会话（不重复建会话）并渲染历史消息', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '这段节奏行不行？'), msg('m2', 'assistant', '整体偏拖。')]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX'}
        agentId="a1"
        onAgentChange={() => {}}
      />,
    );

    expect(h.listConversations).toHaveBeenCalledWith('a1');
    expect(h.createConversation, '已有同名会话不得重建').not.toHaveBeenCalled();
    expect(textEl('这段节奏行不行？')).toBeTruthy();
    expect(textEl('整体偏拖。')).toBeTruthy();
  });

  it('首轮发送自动注入写作上下文（前缀 + 用户输入一条消息发出）', async () => {
    h.listConversations.mockResolvedValue([]);
    h.createConversation.mockResolvedValue({ id: 'c_new', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 1 });
    h.listMessages.mockResolvedValue([]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX-BLOCK'}
        agentId="a1"
        onAgentChange={() => {}}
      />,
    );

    expect(h.createConversation, '无同名会话 → 自动创建').toHaveBeenCalledWith('a1', TITLE);
    await typeInput('这个伏笔行不行？');
    await pressEnter();

    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const sent = h.state.sendMessage.mock.calls[0][1];
    expect(sent).toContain('CTX-BLOCK');
    expect(sent).toContain('这个伏笔行不行？');
    expect(sent.indexOf('CTX-BLOCK')).toBeLessThan(sent.indexOf('这个伏笔行不行？'));
  });

  it('次轮发送不再注入上下文（靠对话历史延续）', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '首轮'), msg('m2', 'assistant', '首轮回答')]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX-BLOCK'}
        agentId="a1"
        onAgentChange={() => {}}
      />,
    );

    await typeInput('那怎么改？');
    await pressEnter();

    const sent = h.state.sendMessage.mock.calls[0][1];
    expect(sent).toBe('那怎么改？');
    expect(sent).not.toContain('CTX-BLOCK');
  });

  it('无 agent 时显示引导空态，「去配置」触发 onOpenSettings（死面板回归锁）', async () => {
    h.state.agents = [];
    const onOpenSettings = vi.fn();
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX'}
        agentId=""
        onAgentChange={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(textEl('尚未配置 Agent。AI 审视需要一个已配置的 Agent 来执行。')).toBeTruthy();
    const btn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === '前往 AI 助手页配置',
    );
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // 死面板回归锁：无 agent 时不渲染输入框与发送按钮
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('点「＋」立即建新会话（不再要求二次点「开始新会话」），旧会话保留', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.createConversation.mockResolvedValue({ id: 'c2', agentId: 'a1', title: TITLE, createdAt: 3, updatedAt: 3 });
    h.listMessages.mockResolvedValue([msg('m1', 'user', '旧消息')]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX'}
        agentId="a1"
        onAgentChange={() => {}}
      />,
    );
    expect(textEl('旧消息')).toBeTruthy();

    const newBtn = document.body.querySelector('[data-testid="ai-chat-new"]') as HTMLElement;
    await act(async () => {
      newBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(h.createConversation).toHaveBeenCalledWith('a1', TITLE);
    expect(textEl('旧消息')).toBeNull();
  });

  it('归属过滤：别处会话正在流式时，本对话框不渲染流式气泡/停止按钮（防串台）', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '这段节奏行不行？'), msg('m2', 'assistant', '整体偏拖。')]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX'}
        agentId="a1"
        onAgentChange={() => {}}
      />,
    );

    // 别处面板发起的流：currentStreamConversationId ≠ 本对话框 convId('c1')
    h.state.isStreaming = true;
    h.state.streamingContent = '>>> 别处生成的句子。';
    h.state.currentStreamConversationId = 'other-conv';
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });

    expect(textEl('>>> 别处生成的句子。')).toBeNull();
    expect(document.body.querySelector('[data-testid="ai-chat-stop"]')).toBeNull();
    // 全局闸门仍在：发送按钮保持禁用（别处占用时不可并发发消息）
    const sendBtn = document.body.querySelector('[data-testid="ai-chat-send"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('流错误回执：归属本对话框且不在流式中时显示错误气泡，点重试原样重发最近一次请求', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '首轮'), msg('m2', 'assistant', '首轮回答')]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX'}
        agentId="a1"
        onAgentChange={() => {}}
      />,
    );

    await typeInput('怎么改？');
    await pressEnter();
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);

    // 流结束后 store 记账错误（归属本对话框会话 c1）
    h.state.isStreaming = false;
    h.state.currentStreamConversationId = 'c1';
    h.state.lastStreamError = 'provider 500';
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });

    const alert = document.body.querySelector('[data-testid="ai-chat-error-retry"]') as HTMLElement;
    expect(alert).toBeTruthy();
    expect(
      Array.from(document.body.querySelectorAll('*')).some(
        (e) => e.textContent === 'provider 500' && e.children.length === 0,
      ),
    ).toBe(true);

    await act(async () => {
      alert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.state.sendMessage).toHaveBeenCalledTimes(2);
    expect(h.state.sendMessage.mock.calls[1][1]).toBe(h.state.sendMessage.mock.calls[0][1]);
  });

  it('C3 预填：initialMessage 在会话就绪后自动作为一条用户消息发送（首轮含上下文，仅一次）', async () => {
    h.listConversations.mockResolvedValue([]);
    h.createConversation.mockResolvedValue({ id: 'c_pre', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 1 });
    h.listMessages.mockResolvedValue([]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX-BLOCK'}
        agentId="a1"
        onAgentChange={() => {}}
        initialMessage="请对照语料库句子改写我的原句"
      />,
    );

    // 会话建立（createConversation）后 initialMessage 自动发送：首轮注入上下文前缀
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const sent = h.state.sendMessage.mock.calls[0][1];
    expect(sent).toContain('CTX-BLOCK');
    expect(sent).toContain('请对照语料库句子改写我的原句');
    expect(sent.indexOf('CTX-BLOCK')).toBeLessThan(sent.indexOf('请对照语料库句子改写我的原句'));
    // 同一内容不因后续重渲染/依赖抖动重复发送
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('C3 预填：会话未就绪时不发送，就绪后再补发（不丢改写请求）', async () => {
    // convId 迟迟未建立：initialMessage 已就绪但 conv 异步未返回——先渲染一次
    let resolveConv!: (v: unknown) => void;
    h.listConversations.mockReturnValue(new Promise((resolve) => (resolveConv = resolve)));
    h.listMessages.mockResolvedValue([]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX-BLOCK'}
        agentId="a1"
        onAgentChange={() => {}}
        initialMessage="改写请求"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // conv 未就绪：不发
    expect(h.state.sendMessage).toHaveBeenCalledTimes(0);

    // conv 就绪（同名会话存在）：补发 1 次
    await act(async () => {
      resolveConv([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
      await Promise.resolve();
    });
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.state.sendMessage.mock.calls[0][1]).toContain('改写请求');
  });

  it('停止标注：本对话框会话被停止时显示「已停止」Chip，错误优先于停止', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '首轮'), msg('m2', 'assistant', '首轮回答')]);
    await mountAsync(
      <WritingAiChatDialog
        open
        onClose={() => {}}
        chatTitle={TITLE}
        buildContextBlock={() => 'CTX'}
        agentId="a1"
        onAgentChange={() => {}}
      />,
    );

    h.state.isStreaming = false;
    h.state.currentStreamConversationId = 'c1';
    h.state.stoppedConversationId = 'c1';
    h.state.lastStreamError = null;
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });

    expect(textEl('已停止 · 保留了已生成的部分')).toBeTruthy();
    // 错误优先于停止：同帧记 error 时错误气泡替换停止 Chip
    h.state.lastStreamError = 'provider 500';
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });
    expect(textEl('已停止 · 保留了已生成的部分')).toBeNull();
    expect(document.body.querySelector('[data-testid="ai-chat-error-retry"]')).toBeTruthy();
  });
});
