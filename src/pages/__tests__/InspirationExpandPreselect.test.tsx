// 灵感扩写面板 · 跨视图预选回归锁（O7 扩写闭环 L2 接入）
//
// 场景：L2 灵感卡「AI 扩写」→ openWritingDesk({ bookId, inspirationId }) → 写作台
// focus 携带 inspirationId → WritingPage 打开本面板并把 initialBeatId 传给面板。
// 本测试锁死面板侧契约：
// ① 打开且指定 initialBeatId 且念头池就绪 → 选中覆盖为指定念头（而非默认第一条）；
// ② 预选生效即回调 onInitialBeatConsumed 一次（父级据此清空，避免重开残留）；
// ③ 未指定 initialBeatId → 沿用默认首条，且不触发回调。
// 面板其余逻辑（会话复用/流式/版本解析）已由既有 O7 覆盖，本测试零重复。
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
    listConversations: vi.fn(async () => []),
    createConversation: vi.fn(async () => ({ id: 'c1', title: '', createdAt: 1, updatedAt: 1 })),
    listMessages: vi.fn(async () => []),
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

import { InspirationExpandPanel } from '../writingPage/InspirationExpandPanel';

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
  h.state.isStreaming = false;
  h.state.streamingContent = '';
  h.state.stoppedConversationId = null;
  h.state.currentStreamConversationId = null;
  h.state.lastStreamError = null;
  h.listConversations.mockResolvedValue([]);
  h.createConversation.mockResolvedValue({ id: 'c1', title: '', createdAt: 1, updatedAt: 1 });
  h.listMessages.mockResolvedValue([]);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

const beat = (id: string, title: string) => ({
  id,
  bookId: 'b1',
  title,
  summary: '',
  chapterId: null,
  extra: '{}',
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});

const baseProps = {
  beats: [],
  settings: [],
  chatTitle: '灵感扩写 · 测试之书',
  buildContextBlock: () => 'CTX',
  onInsertText: () => {},
  onClose: () => {},
  agentId: 'a1',
  onAgentChange: () => {},
  onOpenSettings: () => {},
};

/** 找标题为 title 的念头行（data-testid=inspiration-expand-beat） */
function beatRow(title: string): HTMLElement | null {
  const rows = Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="inspiration-expand-beat"]'));
  return rows.find((r) => (r.textContent ?? '').includes(title)) ?? null;
}

describe('灵感扩写面板 · 跨视图预选（initialBeatId）', () => {
  it('打开且指定 initialBeatId 且池就绪 → 选中覆盖为指定念头并回调一次', async () => {
    const consumed = vi.fn();
    await mountAsync(
      <InspirationExpandPanel
        {...baseProps}
        beats={[beat('b-first', '默认第一条'), beat('b-target', '预选目标')]}
        initialBeatId="b-target"
        onInitialBeatConsumed={consumed}
        open
      />,
    );
    // 预选覆盖：目标行应带选中底色（bgcolor 非透明），默认首条不带
    const target = beatRow('预选目标');
    const first = beatRow('默认第一条');
    expect(target, '目标念头行未渲染').toBeTruthy();
    expect(first, '默认首条行未渲染').toBeTruthy();
    // 面板默认选中走 bgcolor alpha(primary)；选中行有背景，未选中行透明
    const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(bg(target!), '预选目标应被选中').not.toBe('rgba(0, 0, 0, 0)');
    expect(bg(first!), '默认首条应未被选中').toBe('rgba(0, 0, 0, 0)');
    // 预选生效回调恰好一次（消费即清空，防重开残留）
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it('未指定 initialBeatId → 默认选中第一条，不触发预选回调', async () => {
    const consumed = vi.fn();
    await mountAsync(
      <InspirationExpandPanel
        {...baseProps}
        beats={[beat('b-first', '默认第一条'), beat('b-target', '预选目标')]}
        onInitialBeatConsumed={consumed}
        open
      />,
    );
    const first = beatRow('默认第一条');
    expect(first, '默认首条行未渲染').toBeTruthy();
    const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(bg(first!), '默认首条应被选中').not.toBe('rgba(0, 0, 0, 0)');
    expect(consumed).not.toHaveBeenCalled();
  });

  it('initialBeatId 指向池中不存在的 id → 不硬选也不回调（静默回退默认首条）', async () => {
    const consumed = vi.fn();
    await mountAsync(
      <InspirationExpandPanel
        {...baseProps}
        beats={[beat('b-first', '默认第一条'), beat('b-target', '预选目标')]}
        initialBeatId="b-ghost"
        onInitialBeatConsumed={consumed}
        open
      />,
    );
    const first = beatRow('默认第一条');
    expect(first, '默认首条行未渲染').toBeTruthy();
    const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(bg(first!), '应回退默认首条').not.toBe('rgba(0, 0, 0, 0)');
    expect(consumed).not.toHaveBeenCalled();
  });
});
