// AI 语料参谋 · 会话归属守卫回归锁（第十二轮批①，2026-10-31）
//
// 事故场景：在 A 书面板点「生成语料」，请求飞行中切到 B 书（面板不卸载）——
// 旧实现里 A 书的请求照常 resolve，返回的 A 书消息被 setMessages 灌进 B 书面板，
// A 书推荐句被 setGenCards 写入并立即以 **B 书的键** 持久化：
//   ① B 书已有的生成结果被覆盖（数据损坏）；
//   ② B 书面板上展示的推荐句全部来自 A 书上下文（语义污染）；
//   ③ B 书对话历史被 A 书消息替换显示。
// 修法：sendAndRefresh 发起时捕获 ownerConvId，resolve 后用 isConvStale 与当前
// convId 比对——归属已变即作废返回 null（不 setMessages/不 setGenCards/不写 B 键）。
// 配套：chatTitle 切换 effect 立即作废旧 convId（消除「B 书面板挂 A 书会话发送」
// 的窗口期——期间发送按钮禁用）。旧请求本身不取消：结果仍在 A 书会话历史里，
// 切回 A 书由 open effect 重新拉取，零数据丢失。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isConvStale } from '../writingPage/conversationGuard';

const h = vi.hoisted(() => {
  const listeners: Array<(s: unknown) => void> = [];
  const state = {
    agents: [{ id: 'a1', name: 'A' }],
    isStreaming: false,
    streamingContent: '',
    stoppedConversationId: null as string | null,
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
    loadAgents: vi.fn(async () => {}),
    requestInterrupt: vi.fn(),
  };
  return {
    state,
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    listMessages: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
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

vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ success: h.toastSuccess, error: h.toastError }) },
}));

import { AiCorpusPanel } from '../writingPage/AiCorpusPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const TITLE_A = '语料参谋 · 书A';
const TITLE_B = '语料参谋 · 书B';
const CONV_A = 'conv_a';
const CONV_B = 'conv_b';

const msg = (conversationId: string, role: 'user' | 'assistant', content: string) => ({
  id: `m_${Math.random().toString(36).slice(2)}`,
  conversationId,
  role,
  content,
  toolCalls: null,
  createdAt: 1,
});

/** React 受控输入：直接改 .value 会被 value tracker 吞掉 onChange，必须走原生 setter */
function typeInto(el: HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mountAsync(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

async function rerenderAsync(ui: React.ReactElement) {
  await act(async () => {
    root!.render(ui);
  });
}

async function click(testid: string) {
  const el = document.body.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
  expect(el, `missing [data-testid="${testid}"]`).toBeTruthy();
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.state.agents = [{ id: 'a1', name: 'A' }];
  h.state.isStreaming = false;
  h.state.streamingContent = '';
  h.state.stoppedConversationId = null;
  h.state.currentStreamConversationId = null;
  h.state.lastStreamError = null;
  // 用例可能替换为手动延迟实现，每例恢复默认（否则后续用例 await 永不 resolve）
  h.state.sendMessage = vi.fn(async (_convId: string, _content: string) => {});
  // 每本书各自的会话；消息按 convId 分流
  h.listConversations.mockResolvedValue([]);
  h.createConversation.mockImplementation((_agentId: string, title: string) =>
    Promise.resolve({
      id: title === TITLE_A ? CONV_A : CONV_B,
      agentId: 'a1',
      title,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  h.listMessages.mockImplementation((convId: string) => Promise.resolve(convId === CONV_A ? [] : []));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

describe('isConvStale 归属判定', () => {
  it('同会话不过期；会话被切走（含 null 空窗）即过期', () => {
    expect(isConvStale('c1', 'c1')).toBe(false);
    expect(isConvStale('c1', 'c2')).toBe(true);
    expect(isConvStale('c1', null)).toBe(true);
    expect(isConvStale(null, null)).toBe(false);
  });
});

describe('AI 语料参谋 · 生成飞行中切书（数据污染回归锁）', () => {
  it('A 书生成请求飞行中切到 B 书：A 的结果不灌进 B 面板、不以 B 的键持久化', async () => {
    // 让 sendMessage 手动延迟 resolve，模拟「请求飞行中」
    let resolveSend!: () => void;
    h.state.sendMessage = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSend = res;
        }),
    );

    await mountAsync(
      <AiCorpusPanel
        chatTitle={TITLE_A}
        buildContextBlock={() => 'CTX-A'}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
        onInsertText={() => {}}
      />,
    );
    await click('ai-corpus-mode-generate');
    await click('ai-corpus-generate');

    // 飞行中切书（面板不卸载，chatTitle 变）
    h.listMessages.mockImplementation((convId: string) =>
      Promise.resolve(convId === CONV_B ? [msg(CONV_B, 'assistant', 'B 书自己的历史回复')] : []),
    );
    await rerenderAsync(
      <AiCorpusPanel
        chatTitle={TITLE_B}
        buildContextBlock={() => 'CTX-B'}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
        onInsertText={() => {}}
      />,
    );

    // A 书的请求此刻才完成：返回带推荐句的 A 消息
    h.listMessages.mockImplementation((convId: string) =>
      Promise.resolve(
        convId === CONV_A
          ? [msg(CONV_A, 'user', '请直接生成 3 条……'), msg(CONV_A, 'assistant', '>>> 来自 A 书的推荐句。')]
          : [msg(CONV_B, 'assistant', 'B 书自己的历史回复')],
      ),
    );
    await act(async () => {
      resolveSend();
    });

    // ① B 书面板上没有 A 书的推荐句卡片
    const cards = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(cards).toHaveLength(0);
    // ② B 书的持久化键未被写入 A 的结果
    const persistedB = localStorage.getItem('sight-folio:writing.aiCorpusGen.' + TITLE_B);
    expect(persistedB === null || JSON.parse(persistedB).cards.length === 0).toBe(true);
    // ③ 面板展示的会话归 B（对话模式历史可见）
    await click('ai-corpus-mode-chat');
    const chatText = document.body.textContent ?? '';
    expect(chatText).toContain('B 书自己的历史回复');
    expect(chatText).not.toContain('来自 A 书的推荐句');
  });

  it('切书瞬间旧 convId 作废：新书会话拉取完成前不可发送，就位后消息落进新书会话', async () => {
    await mountAsync(
      <AiCorpusPanel
        chatTitle={TITLE_A}
        buildContextBlock={() => 'CTX-A'}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
        onInsertText={() => {}}
      />,
    );
    // A 书面板输入内容（使 canSend 只剩会话因素）
    const input = document.body.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      typeInto(input, '准备发送的话');
    });

    // 让 B 会话的拉取挂起（模拟慢加载窗口期）
    let resolveList!: (v: unknown[]) => void;
    h.listConversations.mockImplementation(() => new Promise((res) => { resolveList = res; }));
    await rerenderAsync(
      <AiCorpusPanel
        chatTitle={TITLE_B}
        buildContextBlock={() => 'CTX-B'}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
        onInsertText={() => {}}
      />,
    );

    // 窗口期：旧会话已作废 → 无法发送（按钮禁用或面板在会话加载中不渲染输入区；
    // 两种形态都不存在「点一下把话发进 A 会话」的可能）
    const sendBtn = document.body.querySelector('[data-testid="ai-corpus-send"]');
    if (sendBtn) {
      const btnEl = (sendBtn.closest('button') ?? sendBtn) as HTMLElement;
      expect(btnEl.hasAttribute('disabled') || btnEl.getAttribute('aria-disabled') === 'true').toBe(true);
    }

    // B 会话就位后重新输入并发送：消息必须落进 **B 书自己的会话**（而不是残留的 A 会话）。
    // 切书后草稿按书隔离（B 无草稿 → 输入清空，属正确行为），需重新输入。
    resolveList([{ id: CONV_B, agentId: 'a1', title: TITLE_B, createdAt: 1, updatedAt: 1 }]);
    h.listMessages.mockImplementation((_convId: string) => Promise.resolve([]));
    await act(async () => {});
    const input2 = document.body.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      typeInto(input2, 'B 书的新问题');
    });
    await click('ai-corpus-send');
    expect(h.state.sendMessage).toHaveBeenCalled();
    expect(h.state.sendMessage.mock.calls[0][0]).toBe(CONV_B);
    expect(h.state.sendMessage.mock.calls[0][1]).toContain('B 书的新问题');
  });

  it('零回归：不切书的正常生成结果照常固化（与既有 Generate 锁互补）', async () => {
    await mountAsync(
      <AiCorpusPanel
        chatTitle={TITLE_A}
        buildContextBlock={() => 'CTX-A'}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
        onInsertText={() => {}}
      />,
    );
    h.listMessages.mockImplementation((convId: string) =>
      Promise.resolve(convId === CONV_A ? [msg(CONV_A, 'assistant', '>>> 正常结果句。')] : []),
    );
    await click('ai-corpus-mode-generate');
    await click('ai-corpus-generate');
    const cards = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('正常结果句');
  });
});
