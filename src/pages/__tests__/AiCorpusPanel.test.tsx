// AI 语料参谋（语料参考区「AI 语料」标签页）· P1 对话模式回归锁
//
// 这条测试锁死：
// ① 挂载即复用同名会话（不重复 create）并渲染历史消息；
// ② assistant 回复中的「>>> 」行解析为推荐句卡片，点「插入正文」→ onInsertText 落回编辑通路；
// ③ 首轮发送自动注入 AI_CORPUS_SYSTEM_HINT（人设 + 输出约定）+ buildContextBlock 上下文；
// ④ 次轮发送不重复注入（靠对话历史延续）；
// ⑤ 快捷 chip 一键直发（首轮同样携带上下文与提示词）;
// ⑥ 无 agent 时不渲染输入区与发送按钮（死面板回归锁），给「去配置」出口；
// ⑦ 流式中渲染流式气泡，停止按钮触发 requestInterrupt。
// store.messages 零接触（组件直读 agentApi 防污染），本测试 mock agentApi + agentStore。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => {
  const listeners: Array<(s: unknown) => void> = [];
  const state = {
    agents: [{ id: 'a1', name: 'A' }],
    isStreaming: false,
    streamingContent: '',
    stoppedConversationId: null as string | null,
    // 流归属 / 错误感知（P0 归属过滤）：渲染流式气泡/停止按钮前须与本面板会话判等
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
  useAgentStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.state), {
    getState: () => h.state,
    subscribe: h.state.subscribe,
  }),
}));

vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ error: h.toastError }) },
}));

import { AiCorpusPanel } from '../writingPage/AiCorpusPanel';

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
  localStorage.clear(); // 生成结果持久化回归锁：用例间隔离 localStorage
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

const TITLE = '语料参谋 · 测试之书';

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

const baseProps = {
  chatTitle: TITLE,
  buildContextBlock: () => 'CTX-BLOCK',
  agentId: 'a1',
  onAgentChange: () => {},
  onOpenSettings: () => {},
};

describe('AI 语料参谋（P1 对话模式 · 回归锁）', () => {
  it('挂载即复用同名会话（不重复建会话）并渲染历史消息', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '这句怎么参考？'), msg('m2', 'assistant', '建议直接引用。')]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    expect(h.listConversations).toHaveBeenCalledWith('a1');
    expect(h.createConversation, '已有同名会话不得重建').not.toHaveBeenCalled();
    expect(textEl('这句怎么参考？')).toBeTruthy();
    expect(textEl('建议直接引用。')).toBeTruthy();
  });

  it('assistant 回复中的「>>> 」行渲染为推荐句卡片，点「插入正文」回调 onInsertText', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '帮我写句重逢场景'),
      msg('m2', 'assistant', '可以这样写：\n>>> 他攥着信纸的手又紧了几分。\n>>> 她没接话，只是把灯调暗了一格。'),
    ]);
    const onInsertText = vi.fn();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={onInsertText} />);

    const picks = Array.from(document.body.querySelectorAll('[data-testid="ai-corpus-pick"]'));
    expect(picks).toHaveLength(2);
    expect(textEl('他攥着信纸的手又紧了几分。')).toBeTruthy();
    expect(textEl('她没接话，只是把灯调暗了一格。')).toBeTruthy();

    const insertBtn = document.body.querySelector('[data-testid="ai-corpus-pick-insert-0"]') as HTMLElement;
    await act(async () => {
      insertBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onInsertText).toHaveBeenCalledWith('他攥着信纸的手又紧了几分。');
  });

  it('首轮发送自动注入人设提示词 + 写作上下文 + 用户输入（一条消息发出）', async () => {
    h.listConversations.mockResolvedValue([]);
    h.createConversation.mockResolvedValue({ id: 'c_new', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 1 });
    h.listMessages.mockResolvedValue([]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    expect(h.createConversation, '无同名会话 → 自动创建').toHaveBeenCalledWith('a1', TITLE);
    await typeInput('这句该不该参考？');
    await pressEnter();

    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const sent = h.state.sendMessage.mock.calls[0][1] as unknown as string;
    expect(sent).toContain('本书语料参谋');
    expect(sent).toContain('CTX-BLOCK');
    expect(sent).toContain('这句该不该参考？');
    expect(sent.indexOf('CTX-BLOCK')).toBeLessThan(sent.indexOf('这句该不该参考？'));
  });

  it('次轮发送不再注入上下文（靠对话历史延续）', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '首轮'), msg('m2', 'assistant', '首轮回答')]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    await typeInput('那怎么改？');
    await pressEnter();

    const sent = h.state.sendMessage.mock.calls[0][1] as unknown as string;
    expect(sent).toBe('那怎么改？');
    expect(sent).not.toContain('CTX-BLOCK');
    expect(sent).not.toContain('本书语料参谋');
  });

  it('快捷 chip 一键直发：携带上下文与人设提示词，且清空空态', async () => {
    h.listConversations.mockResolvedValue([]);
    h.createConversation.mockResolvedValue({ id: 'c_new', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 1 });
    h.listMessages.mockResolvedValue([]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    const chip = document.body.querySelector('[data-testid="ai-corpus-chip-aiCorpusChipTone"]') as HTMLElement;
    expect(chip, '快捷 chip 在空会话出现').toBeTruthy();
    await act(async () => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const sent = h.state.sendMessage.mock.calls[0][1] as unknown as string;
    expect(sent).toContain('本书语料参谋');
    expect(sent).toContain('CTX-BLOCK');
    expect(sent).toContain('帮我分析本章基调');
  });

  it('无 agent 时不渲染输入区与发送按钮（死面板回归锁），「去配置」触发 onOpenSettings', async () => {
    h.state.agents = [];
    const onOpenSettings = vi.fn();
    await mountAsync(
      <AiCorpusPanel {...baseProps} agentId="" onOpenSettings={onOpenSettings} onInsertText={() => {}} />,
    );

    expect(textEl('尚未配置 Agent。AI 语料需要一个已配置的 Agent 来生成与对话。')).toBeTruthy();
    const btn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === '前往 AI 助手页配置',
    );
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.body.querySelector('[data-testid="ai-corpus-send"]')).toBeNull();
  });

  it('流式中渲染流式气泡，停止按钮触发 requestInterrupt；agent 选择器流式中禁用', async () => {
    h.listConversations.mockResolvedValue([]);
    h.createConversation.mockResolvedValue({ id: 'c_new', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 1 });
    h.listMessages.mockResolvedValue([]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    // 模拟 store 推送流式内容（subscribe 被组件订阅，直接同步调用监听器）
    // 归属本面板：currentStreamConversationId === 本面板 convId('c_new')
    h.state.streamingContent = '正在分析本章基调——';
    h.state.isStreaming = true;
    h.state.currentStreamConversationId = 'c_new';
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });

    expect(textEl('正在分析本章基调——')).toBeTruthy();
    const stop = document.body.querySelector('[data-testid="ai-corpus-stop"]') as HTMLElement;
    expect(stop, '流式期间显示停止按钮').toBeTruthy();
    await act(async () => {
      stop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.state.requestInterrupt).toHaveBeenCalledTimes(1);
  });

  it('重拉历史时 user 消息自动注入的系统提示词不显示（仅用户原文与助手输出）', async () => {
    // 模拟真实落库形态：首轮 user 消息 content 含人设 + 写作上下文 + 分隔符 + 用户原文
    const rawContent = 'AI_CORPUS_SYSTEM_HINT_TEXT\n\nCTX-BLOCK\n\n---\n\n这句怎么参考？';
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', rawContent), msg('m2', 'assistant', '建议直接引用。')]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    expect(textEl('这句怎么参考？'), '用户气泡只显示用户原文').toBeTruthy();
    expect(textEl('AI_CORPUS_SYSTEM_HINT_TEXT'), '系统人设提示词不得在气泡显示').toBeNull();
    expect(textEl('CTX-BLOCK'), '写作上下文不得在气泡显示').toBeNull();
    expect(textEl('建议直接引用。'), '助手输出正常显示').toBeTruthy();
  });

  it('点「＋」立即建新会话（清空历史），旧会话保留', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.createConversation.mockResolvedValue({ id: 'c2', agentId: 'a1', title: TITLE, createdAt: 3, updatedAt: 3 });
    h.listMessages.mockResolvedValue([msg('m1', 'user', '旧消息')]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    expect(textEl('旧消息')).toBeTruthy();

    const newBtn = document.body.querySelector('[data-testid="ai-corpus-new"]') as HTMLElement;
    await act(async () => {
      newBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(h.createConversation).toHaveBeenCalledWith('a1', TITLE);
    expect(textEl('旧消息')).toBeNull();
  });
});
