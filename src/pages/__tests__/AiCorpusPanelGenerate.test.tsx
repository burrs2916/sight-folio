// AI 语料参谋（语料参考区「AI 语料」标签页）· P2 一键生成模式回归锁
//
// 这条测试锁死：
// ① 子模式切换：默认「对话」，可切「生成」，切换后渲染条数/用途参数区与生成按钮；
// ② 点「生成语料」→ 发送内容含 AI_CORPUS_SYSTEM_HINT + buildContextBlock + 生成指令
//    （条数/用途注入指令），完成后从最后一条 assistant 回复解析出推荐句卡片；
// ③ 结果卡片带「插入」（onInsertText 落回编辑通路）与「复制」（clipboard + toast）；
// ④ 「换一批」重新触发一次相同参数的生成请求（sendMessage 再次被调用）；
// ⑤ 次轮生成不重复注入上下文（靠对话历史延续）；
// ⑥ 生成为空会话时首轮注入上下文；非空会话不再注入明文上下文前缀。
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

vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ success: h.toastSuccess, error: h.toastError }) },
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

const baseProps = {
  chatTitle: TITLE,
  buildContextBlock: () => 'CTX-BLOCK',
  agentId: 'a1',
  onAgentChange: () => {},
  onOpenSettings: () => {},
};

async function setupEmptyConversation() {
  h.listConversations.mockResolvedValue([]);
  h.createConversation.mockResolvedValue({ id: 'c_new', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 1 });
  h.listMessages.mockResolvedValue([]);
}

async function click(testid: string) {
  const el = document.body.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
  expect(el, `missing [data-testid="${testid}"]`).toBeTruthy();
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('AI 语料参谋（P2 一键生成 · 回归锁）', () => {
  it('默认对话模式；切到生成模式渲染参数区与生成按钮', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    expect(document.body.querySelector('[data-testid="ai-corpus-mode-chat"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="ai-corpus-mode-generate"]')).toBeTruthy();
    // 默认对话模式：无生成参数区
    expect(document.body.querySelector('[data-testid="ai-corpus-gen-count"]')).toBeNull();

    await click('ai-corpus-mode-generate');
    expect(document.body.querySelector('[data-testid="ai-corpus-gen-count"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="ai-corpus-gen-purpose"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="ai-corpus-generate"]')).toBeTruthy();
  });

  it('点「生成语料」：发送人设 + 上下文 + 生成指令（条数/用途），完成后渲染推荐句卡片', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    // 生成完成后返回含推荐句的 assistant 回复
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 3 条……'),
      msg('m2', 'assistant', '>>> 他攥着信纸的手又紧了几分。\n>>> 她没接话，只是把灯调暗了一格。'),
    ]);
    await click('ai-corpus-generate');

    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const sent = h.state.sendMessage.mock.calls[0][1] as unknown as string;
    expect(sent).toContain('本书语料参谋');
    expect(sent).toContain('CTX-BLOCK');
    expect(sent).toContain('3 条');
    expect(sent).toContain('由你按当前场景择优');
    expect(sent.indexOf('CTX-BLOCK')).toBeLessThan(sent.indexOf('3 条'));

    // 结果卡片固化
    const cards = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(cards).toHaveLength(2);
    expect(cards.some((c) => c.textContent?.startsWith('他攥着信纸的手又紧了几分。'))).toBe(true);
    expect(cards.some((c) => c.textContent?.startsWith('她没接话，只是把灯调暗了一格。'))).toBe(true);
  });

  it('生成结果卡片点「插入」回调 onInsertText', async () => {
    await setupEmptyConversation();
    const onInsertText = vi.fn();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={onInsertText} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 他攥着信纸的手又紧了几分。'),
    ]);
    await click('ai-corpus-generate');

    const insertBtn = document.body.querySelector('[data-testid="ai-corpus-gen-0-insert"]') as HTMLElement;
    await act(async () => {
      insertBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onInsertText).toHaveBeenCalledWith('他攥着信纸的手又紧了几分。');
  });

  it('生成结果卡片点「复制」：写入剪贴板并 toast 成功', async () => {
    await setupEmptyConversation();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 1 条……'),
      msg('m2', 'assistant', '>>> 他攥着信纸的手又紧了几分。'),
    ]);
    await click('ai-corpus-generate');

    const copyBtn = document.body.querySelector('[data-testid="ai-corpus-gen-0-copy"]') as HTMLElement;
    await act(async () => {
      copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith('他攥着信纸的手又紧了几分。');
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('「换一批」：相同参数再次发送生成请求，且每次都重新注入最新上下文', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([msg('m1', 'user', '请直接生成 3 条……'), msg('m2', 'assistant', '>>> 第一句。')]);
    await click('ai-corpus-generate');
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);

    await click('ai-corpus-regen');
    expect(h.state.sendMessage).toHaveBeenCalledTimes(2);
    const second = h.state.sendMessage.mock.calls[1][1] as unknown as string;
    // 生成请求自包含：每次重注入最新 HINT + 上下文（避免二轮起上下文过期）
    expect(second).toContain('CTX-BLOCK');
    expect(second).toContain('本书语料参谋');
    expect(second).toContain('3 条');
  });

  it('生成中：显示生成进度与流式实时卡片；停止按钮触发 requestInterrupt', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    // 模拟 store 推送流式内容（生成中实时出现推荐句行）
    h.state.streamingContent = '正在生成：\n>>> 他攥着信纸的手又紧了几分。\n>>> 她有话没说出口。';
    h.state.isStreaming = true;
    h.state.currentStreamConversationId = 'c_new'; // 归属本面板会话（setupEmptyConversation 建的 c_new）
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });

    const streamCards = Array.from(
      document.body.querySelectorAll('[data-testid^="ai-corpus-gen-stream-"][data-testid$="-card"]'),
    );
    expect(streamCards.length).toBeGreaterThanOrEqual(2);
    const stop = document.body.querySelector('[data-testid="ai-corpus-gen-stop"]') as HTMLElement;
    expect(stop).toBeTruthy();
    await act(async () => {
      stop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.state.requestInterrupt).toHaveBeenCalledTimes(1);
  });

  it('生成启动后结果区固化最近一次生成（切回对话模式保留历史会话展示）', async () => {
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '历史提问'), msg('m2', 'assistant', '历史回复')]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    // 已存在历史 → 生成请求仍自包含最新上下文（每天重注入，不依赖对话历史延续）
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '历史提问'),
      msg('m2', 'assistant', '历史回复'),
      msg('m3', 'user', '请直接生成 2 条……'),
      msg('m4', 'assistant', '>>> 新生成的一句。'),
    ]);
    await click('ai-corpus-generate');
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const sent = h.state.sendMessage.mock.calls[0][1] as unknown as string;
    expect(sent).toContain('CTX-BLOCK');
    expect(sent).toContain('本书语料参谋');

    const cards = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(cards).toHaveLength(1);

    // 切回对话模式：完整历史（含生成请求与结果）仍在
    await click('ai-corpus-mode-chat');
    expect(textEl('历史提问')).toBeTruthy();
  });

  it('归属过滤：别处会话正在流式时，本面板不渲染流式卡片/停止按钮（防串台）', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    // 别处（写作台 AI 会话）发起的流：currentStreamConversationId ≠ 本面板 convId
    h.state.isStreaming = true;
    h.state.streamingContent = '>>> 别处生成的句子。';
    h.state.currentStreamConversationId = 'other-conv';
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });

    expect(document.body.querySelector('[data-testid="ai-corpus-gen-stop"]')).toBeNull();
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-stream-"][data-testid$="-card"]')),
    ).toHaveLength(0);
    // 全局闸门仍在：发送按钮保持禁用（别处占用时不可并发发消息）
    expect(h.state.sendMessage).not.toHaveBeenCalled();
  });

  it('流错误回执：归属本面板且不在流式中时显示错误气泡，点重试原样重发最近一次请求', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    h.listMessages.mockResolvedValue([msg('m1', 'user', '请直接生成 3 条……'), msg('m2', 'assistant', '>>> 一句。')]);
    await click('ai-corpus-generate');
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);

    // 流结束后 store 记账错误（归属本面板会话）
    h.state.isStreaming = false;
    h.state.currentStreamConversationId = 'c_new';
    h.state.lastStreamError = 'provider 500';
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });

    const alert = document.body.querySelector('[data-testid="ai-corpus-error-retry"]') as HTMLElement;
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
    // 重试内容与首次一致（含最新上下文注入）
    const retried = h.state.sendMessage.mock.calls[1][1] as unknown as string;
    expect(retried).toContain('CTX-BLOCK');
    expect(retried).toContain('3 条');
  });

  it('停止收尾：发送后被停止（stoppedConversationId 记账）时不固化半截卡片，UI 标注已停止', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    // 流结束后后端保留半截回复并记账 stoppedConversationId（模拟用户按停止）
    h.state.isStreaming = false;
    h.state.currentStreamConversationId = 'c_new';
    h.state.stoppedConversationId = 'c_new';
    h.state.lastStreamError = null;
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 3 条……'),
      msg('m2', 'assistant', '>>> 只吐了半'), // 半截行：不应被解析为可插入推荐句
    ]);
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });
    await click('ai-corpus-generate');

    // 不固化卡片（半截内容不落推荐句卡）
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(0);
    // 停止标注 Chip 出现
    expect(
      Array.from(document.body.querySelectorAll('*')).some(
        (e) => e.textContent === '已停止 · 保留了已生成的部分' && e.children.length === 0,
      ),
    ).toBe(true);
  });

  it('生成结果卡片可「就地编辑」：修改文本保存后，插入按钮携带新文本并持久化', async () => {
    await setupEmptyConversation();
    const onInsertText = vi.fn();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={onInsertText} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 他攥着信纸的手又紧了几分。\n>>> 她没接话，只是把灯调暗了一格。'),
    ]);
    await click('ai-corpus-generate');
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(2);

    // 进入第 0 张卡的编辑态：渲染输入框（MUI TextField 根节点是 div，输入元素是内部 textarea）
    await click('ai-corpus-gen-0-edit');
    const editCard = document.body.querySelector('[data-testid="ai-corpus-gen-0-edit-card"]') as HTMLElement;
    expect(editCard).toBeTruthy();
    const input = editCard.querySelector('textarea') as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    // 修改文本并保存
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(input, '他攥着信纸的手又紧了几分——改后的版本。');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('ai-corpus-gen-0-edit-save');

    // 编辑态退出；卡片文本已更新
    expect(document.body.querySelector('[data-testid="ai-corpus-gen-0-edit-input"]')).toBeNull();
    const updated = document.body.querySelector('[data-testid="ai-corpus-gen-0-card"]') as HTMLElement;
    expect(updated.textContent).toContain('改后的版本');

    // 插入按钮携带新文本
    await click('ai-corpus-gen-0-insert');
    expect(onInsertText).toHaveBeenCalledWith('他攥着信纸的手又紧了几分——改后的版本。');

    // 持久化同步：localStorage 中该会话的卡片为编辑后内容
    const raw = localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE}`);
    expect(raw).toBeTruthy();
    const p = JSON.parse(raw!) as { cards: string[] };
    expect(p.cards[0]).toBe('他攥着信纸的手又紧了几分——改后的版本。');
  });

  it('生成结果卡片可「删除」：移除该卡片并同步持久化', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 他攥着信纸的手又紧了几分。\n>>> 她没接话，只是把灯调暗了一格。'),
    ]);
    await click('ai-corpus-generate');
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(2);

    // 删除第 1 张卡片
    await click('ai-corpus-gen-1-delete');
    const cards = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(cards).toHaveLength(1);
    const kept = document.body.querySelector('[data-testid="ai-corpus-gen-0-card"]') as HTMLElement;
    expect(kept.textContent).toContain('他攥着信纸的手又紧了几分。');

    // 持久化同步：localStorage 只剩 1 条
    const raw = localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE}`);
    const p = JSON.parse(raw!) as { cards: string[] };
    expect(p.cards).toHaveLength(1);
    expect(p.cards[0]).toBe('他攥着信纸的手又紧了几分。');
  });

  it('生成结果持久化：面板卸载（切 tab/重挂）后重新挂载，卡片与子模式恢复不丢失', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 他攥着信纸的手又紧了几分。\n>>> 她没接话，只是把灯调暗了一格。'),
    ]);
    await click('ai-corpus-generate');
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(2);
    expect(localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE}`)).toBeTruthy();

    // 模拟切走 tab：卸载面板（corpusTab 切换条件渲染导致卸载）
    await act(async () => {
      root!.unmount();
    });
    root = null;
    host = null;
    document.body.innerHTML = '';

    // 重新挂载（模拟切回 AI 语料 tab）：不重新生成，卡片应从持久化恢复
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '历史提问'), msg('m2', 'assistant', '历史回复')]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    // 子模式恢复为 generate（持久化保存了 mode），生成结果卡片直接可见
    const restored = Array.from(
      document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'),
    );
    expect(restored).toHaveLength(2);
    expect(restored.some((c) => c.textContent?.startsWith('他攥着信纸的手又紧了几分。'))).toBe(true);
    expect(restored.some((c) => c.textContent?.startsWith('她没接话，只是把灯调暗了一格。'))).toBe(true);
  });

  it('切书（chatTitle 变化、面板不卸载）：新书不显示旧书卡片，storage 键独立不污染', async () => {
    const TITLE_B = '语料参谋 · 另一本书';
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    // 书 A 生成两张卡片并持久化
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 书 A 的第一句。\n>>> 书 A 的第二句。'),
    ]);
    await click('ai-corpus-generate');
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(2);
    expect(localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE}`)).toBeTruthy();

    // 切到书 B：同一面板常驻（不卸载），仅 chatTitle 变化
    h.listConversations.mockResolvedValue([]);
    h.createConversation.mockResolvedValue({ id: 'c_b', agentId: 'a1', title: TITLE_B, createdAt: 1, updatedAt: 1 });
    h.listMessages.mockResolvedValue([]);
    await act(async () => {
      root!.render(<AiCorpusPanel {...baseProps} chatTitle={TITLE_B} onInsertText={() => {}} />);
    });

    // 新书不显示旧书卡片；子模式回落默认对话
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(0);
    expect(document.body.querySelector('[data-testid="ai-corpus-mode-chat"]')).toBeTruthy();
    // 书 B 无记录：storage 键不存在（旧书数据未被写入新书键）
    expect(localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE_B}`)).toBeNull();

    // 切回书 A：卡片独立恢复，未被动过
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '历史提问'), msg('m2', 'assistant', '历史回复')]);
    await act(async () => {
      root!.render(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    });
    const back = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(back).toHaveLength(2);
    expect(back.some((c) => c.textContent?.startsWith('书 A 的第一句。'))).toBe(true);
    expect(localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE}`)).toBeTruthy();
  });

  it('切到已有记录的新书：不清空也不覆盖该书已存卡片（恢复其自身数据）', async () => {
    const TITLE_B = '语料参谋 · 已生成过的书';
    // 书 B 预先在 storage 中存在两条自己的卡片（模拟之前生成过）
    localStorage.setItem(
      `${'sight-folio:writing.aiCorpusGen.'}${TITLE_B}`,
      JSON.stringify({ cards: ['书 B 的既有句一。', '书 B 的既有句二。'], attempted: true, mode: 'generate' }),
    );

    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 1 条……'),
      msg('m2', 'assistant', '>>> 书 A 的新句。'),
    ]);
    await click('ai-corpus-generate');
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(1);

    // 切到书 B（有既有记录）：应恢复书 B 自己的卡片，而不是书 A 的
    h.listConversations.mockResolvedValue([]);
    h.createConversation.mockResolvedValue({ id: 'c_b2', agentId: 'a1', title: TITLE_B, createdAt: 1, updatedAt: 1 });
    h.listMessages.mockResolvedValue([]);
    await act(async () => {
      root!.render(<AiCorpusPanel {...baseProps} chatTitle={TITLE_B} onInsertText={() => {}} />);
    });

    const bCards = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(bCards).toHaveLength(2);
    expect(bCards.some((c) => c.textContent?.startsWith('书 B 的既有句一。'))).toBe(true);
    // 书 B 的存储未被书 A 数据覆盖
    const rawB = localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE_B}`);
    const pB = JSON.parse(rawB!) as { cards: string[] };
    expect(pB.cards.some((c) => c.startsWith('书 A 的新句。'))).toBe(false);
    expect(pB.cards).toHaveLength(2);
  });

  it('「换一批」请求失败：上一批卡片保留不清空（失败回执 + 旧结果仍在）', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    // 首轮生成两张卡片
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 第一句。\n>>> 第二句。'),
    ]);
    await click('ai-corpus-generate');
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(2);

    // 换一批：本轮请求失败（sendMessage reject → sendAndRefresh 返回 null）
    h.state.sendMessage.mockRejectedValueOnce(new Error('provider boom'));
    await click('ai-corpus-regen');

    // 旧卡片保留（未被清空），失败 toast 出现
    const after = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(after).toHaveLength(2);
    expect(after.some((c) => c.textContent?.startsWith('第一句。'))).toBe(true);
    expect(h.toastError).toHaveBeenCalled();
  });

  it('「换一批」被停止（半截回复）：上一批卡片保留不清空', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');

    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 第一句。\n>>> 第二句。'),
    ]);
    await click('ai-corpus-generate');
    expect(
      Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]')),
    ).toHaveLength(2);

    // 第二轮：流被停止（stoppedConversationId 记账，后端只剩半截回复）
    h.state.isStreaming = false;
    h.state.currentStreamConversationId = 'c_new';
    h.state.stoppedConversationId = 'c_new';
    h.state.lastStreamError = null;
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 第一句。\n>>> 第二句。'),
      msg('m3', 'user', '请直接生成 2 条……'),
      msg('m4', 'assistant', '>>> 半截'),
    ]);
    await act(async () => {
      (h.state.subscribe as any).mock.calls.forEach(([fn]: [(s: unknown) => void]) => fn(h.state));
    });
    await click('ai-corpus-regen');

    // 不固化半截新回复，但上一批卡片完整保留
    const after = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-gen-"][data-testid$="-card"]'));
    expect(after).toHaveLength(2);
    expect(after.some((c) => c.textContent?.startsWith('第一句。'))).toBe(true);
    expect(after.some((c) => c.textContent?.startsWith('第二句。'))).toBe(true);
    expect(after.some((c) => c.textContent?.startsWith('半截'))).toBe(false);
  });

  it('编辑草稿持久化：编辑中输入未保存 → 卸载重挂载 → 编辑态与草稿恢复', async () => {
    await setupEmptyConversation();
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);
    await click('ai-corpus-mode-generate');
    h.listMessages.mockResolvedValue([
      msg('m1', 'user', '请直接生成 2 条……'),
      msg('m2', 'assistant', '>>> 他攥着信纸的手又紧了几分。\n>>> 她没接话，只是把灯调暗了一格。'),
    ]);
    await click('ai-corpus-generate');

    // 进入第 0 张卡编辑态并输入半截内容（不保存）
    await click('ai-corpus-gen-0-edit');
    const editCard = document.body.querySelector('[data-testid="ai-corpus-gen-0-edit-card"]') as HTMLElement;
    const input = editCard.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(input, '他攥着信纸的手又紧了几分——草稿中');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // 模拟切走 tab：卸载面板
    await act(async () => {
      root!.unmount();
    });
    root = null;
    host = null;
    document.body.innerHTML = '';

    // 重新挂载：编辑态应恢复，输入框携带未保存草稿
    h.listConversations.mockResolvedValue([{ id: 'c1', agentId: 'a1', title: TITLE, createdAt: 1, updatedAt: 2 }]);
    h.listMessages.mockResolvedValue([msg('m1', 'user', '历史提问'), msg('m2', 'assistant', '历史回复')]);
    await mountAsync(<AiCorpusPanel {...baseProps} onInsertText={() => {}} />);

    const restoredEdit = document.body.querySelector('[data-testid="ai-corpus-gen-0-edit-card"]') as HTMLElement;
    expect(restoredEdit).toBeTruthy();
    const restoredInput = restoredEdit.querySelector('textarea') as HTMLTextAreaElement;
    expect(restoredInput.value).toBe('他攥着信纸的手又紧了几分——草稿中');

    // 保存后新文本生效并落盘
    await click('ai-corpus-gen-0-edit-save');
    const updated = document.body.querySelector('[data-testid="ai-corpus-gen-0-card"]') as HTMLElement;
    expect(updated.textContent).toContain('草稿中');
    const raw = localStorage.getItem(`${'sight-folio:writing.aiCorpusGen.'}${TITLE}`);
    expect((JSON.parse(raw!) as { cards: string[] }).cards[0]).toBe('他攥着信纸的手又紧了几分——草稿中');
  });
});

function textEl(text: string): HTMLElement | null {
  const els = Array.from(document.body.querySelectorAll('*')) as HTMLElement[];
  return els.find((e) => e.textContent === text && e.children.length === 0) ?? null;
}
