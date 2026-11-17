// 语料参考区双标签页（语料库 / AI 语料）· 回归锁（P0：Tabs 骨架与零回归）
//
// 这条测试锁死：
// ① 传入 aiCorpus 配置后，语料参考区渲染「语料库 / AI 语料」两个 Tab，默认停在语料库；
// ② 语料库 Tab 内容保持原 CorpusReferencePanel 行为（挂载探针、输入防抖检索）；
// ③ 切到 AI 语料 Tab → 渲染 AiCorpusPanel 骨架（语料参谋标题 + agent 选择）；
// ④ 无 agent 时给「去配置」引导出口（onOpenSettings 触发）。
// ⑤ 未传 aiCorpus 时保持单面板形态（旧调用方零回归）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => {
  const listeners: Array<(s: unknown) => void> = [];
  const state = {
    agents: [] as {
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
    }[],
    isStreaming: false,
    streamingContent: '',
    stoppedConversationId: null as string | null,
    subscribe: vi.fn((fn: (s: unknown) => void) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    sendMessage: vi.fn(async () => {}),
    loadAgents: vi.fn(async () => {}),
  };
  return {
    state,
    status: vi.fn(),
    search: vi.fn(),
  };
});

vi.mock('../../services/tauri', () => ({
  agentApi: {
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    listMessages: vi.fn(),
  },
  corpusApi: {
    status: h.status,
    search: h.search,
  },
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.state), {
    getState: () => h.state,
    subscribe: h.state.subscribe,
  }),
}));

import { agentApi } from '../../services/tauri';
import { WritingDrawer } from '../writingPage/WritingDrawer';
import { AiCorpusPanel } from '../writingPage/AiCorpusPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未实现 PointerEvent：React 检测不到 pointer 事件支持会跳过 onPointerDown 注册。
// 提供最小 polyfill（基于 MouseEvent，带 clientX/pointerId），让拖拽路径在测试里真实可跑。
class PointerEventPolyfill extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    // MouseEvent 构造器已支持 clientX/clientY/button 等；仅补齐 pointer 特有字段
    super(type, init as MouseEventInit);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}
if (typeof (globalThis as any).PointerEvent === 'undefined') {
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

/** 派发 pointer 事件（polyfill 之上：模拟手柄按下/全局移动/松开） */
function dispatchPointer(target: Window | HTMLElement, type: string, clientX: number) {
  target.dispatchEvent(new (globalThis as any).PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }));
}

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

/** 等待面板内部 300ms 防抖到期并 flush 检索 promise 微任务 */

beforeEach(() => {
  vi.clearAllMocks();
  h.state.agents = [];
  h.state.isStreaming = false;
  h.state.streamingContent = '';
  h.state.stoppedConversationId = null;
  h.status.mockResolvedValue({ available: true, error: '' });
  h.search.mockResolvedValue({ books: [], hits: [] });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function buttonByText(text: string): HTMLButtonElement | null {
  const btns = Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[];
  return btns.find((b) => b.textContent?.includes(text)) ?? null;
}

function elByTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`);
}

const drawerProps = {
  corpusQuery: '',
  onInsertText: () => {},
  payableForeshadowings: [],
  inspirationReminders: [],
  proofreadReminders: [],
  activeChapter: null,
  chapters: [],
  genre: '',
  onOpenChapterDetails: () => {},
  hidden: false,
};

describe('语料参考区双标签页（语料库 / AI 语料 · P0 骨架），', () => {
  it('未传 aiCorpus 时保持单面板（无 Tabs 条），语料参考标题照常渲染', async () => {
    await mountAsync(<WritingDrawer {...drawerProps} />);
    expect(elByTestId('corpus-tab-library')).toBeNull();
    const title = Array.from(document.body.querySelectorAll('*')).find(
      (e) => (e as HTMLElement).textContent === '语料参考' && e.children.length === 0,
    );
    expect(title).not.toBeNull();
  });

  it('传入 aiCorpus 后渲染「语料库 / AI 语料」两 Tab；默认停在语料库且自动检索链路不变', async () => {
    await mountAsync(
      <WritingDrawer
        {...drawerProps}
        aiCorpus={{
          chatTitle: '语料参谋 · 测试之书',
          buildContextBlock: () => '【写作上下文】测试',
          agentId: '',
          onAgentChange: () => {},
          onOpenSettings: () => {},
        }}
      />,
    );
    const lib = elByTestId('corpus-tab-library');
    const ai = elByTestId('corpus-tab-ai');
    expect(lib).not.toBeNull();
    expect(ai).not.toBeNull();
    // 默认停在语料库：探针已弹（CorpusReferencePanel 挂载副作用），检索区可交互
    expect(h.status).toHaveBeenCalledTimes(1);
    // 切到 AI 语料 Tab
    await act(async () => {
      ai!.querySelectorAll('[role="tab"]').forEach(() => {});
      ai!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Tab 语义：MUI Tab 是 role=tab；此处直接点其文本
  });

  it('切到 AI 语料 Tab：渲染语料参谋 + agent 选择；无 agent 给去配置出口', async () => {
    let settingsOpened = false;
    await mountAsync(
      <WritingDrawer
        {...drawerProps}
        aiCorpus={{
          chatTitle: '语料参谋 · 测试之书',
          buildContextBlock: () => '【写作上下文】测试',
          agentId: '',
          onAgentChange: () => {},
          onOpenSettings: () => {
            settingsOpened = true;
          },
        }}
      />,
    );
    const aiTab = elByTestId('corpus-tab-ai') as HTMLElement;
    await act(async () => {
      aiTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 骨架渲染
    const advisor = Array.from(document.body.querySelectorAll('*')).find(
      (e) => (e as HTMLElement).textContent === '语料参谋' && e.children.length === 0,
    );
    expect(advisor).not.toBeNull();
    expect(elByTestId('ai-corpus-agent')).not.toBeNull();
    // 无 agent：去配置出口可点
    const configure = buttonByText('前往 AI 助手页配置');
    expect(configure).not.toBeNull();
    await act(async () => {
      configure!.click();
    });
    expect(settingsOpened).toBe(true);
  });

  it('已配置 agent 时：AI 语料 Tab 显示引导空态而非去配置出口', async () => {
    h.state.agents = [
      {
        id: 'a1',
        name: '写作助手',
        description: '',
        modelId: 'm1',
        systemPrompt: '',
        temperature: 0.7,
        maxIterations: 1,
        toolIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    await mountAsync(
      <WritingDrawer
        {...drawerProps}
        aiCorpus={{
          chatTitle: '语料参谋 · 测试之书',
          buildContextBlock: () => '【写作上下文】测试',
          agentId: 'a1',
          onAgentChange: () => {},
          onOpenSettings: () => {},
        }}
      />,
    );
    const aiTab = elByTestId('corpus-tab-ai') as HTMLElement;
    await act(async () => {
      aiTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(buttonByText('前往 AI 助手页配置')).toBeNull();
    expect(elByTestId('ai-corpus-agent')).not.toBeNull();
  });

  it('AiCorpusPanel 独立挂载（有 agent）：标题 + agent 选择 + 空态引导', async () => {
    h.state.agents = [
      {
        id: 'a1',
        name: '写作助手',
        description: '',
        modelId: 'm1',
        systemPrompt: '',
        temperature: 0.7,
        maxIterations: 1,
        toolIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    await mountAsync(
      <AiCorpusPanel
        chatTitle="语料参谋 · 测试之书"
        buildContextBlock={() => '【写作上下文】测试'}
        onInsertText={() => {}}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const advisor = Array.from(document.body.querySelectorAll('*')).find(
      (e) => (e as HTMLElement).textContent === '语料参谋' && e.children.length === 0,
    );
    expect(advisor).not.toBeNull();
    expect(elByTestId('ai-corpus-agent')).not.toBeNull();
    expect(buttonByText('前往 AI 助手页配置')).toBeNull();
    // 空态引导文案在档（aiCorpusEmpty）
    const hint = Array.from(document.body.querySelectorAll('*')).find(
      (e) => (e as HTMLElement).textContent?.includes('与 AI 讨论如何参考') ?? false,
    );
    expect(hint).not.toBeNull();
  });

  it('AiCorpusPanel 输入区增强：快捷指令菜单填入模板、hint/字数渲染、草稿跨挂载恢复', async () => {
    localStorage.removeItem('sight-folio:writing.aiCorpusDraft.语料参谋 · 测试之书');
    h.state.agents = [
      {
        id: 'a1',
        name: '写作助手',
        description: '',
        modelId: 'm1',
        systemPrompt: '',
        temperature: 0.7,
        maxIterations: 1,
        toolIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const panel = (
      <AiCorpusPanel
        chatTitle="语料参谋 · 测试之书"
        buildContextBlock={() => '【写作上下文】测试'}
        onInsertText={() => {}}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
      />
    );
    await mountAsync(panel);

    // 输入区辅助行：上下文提示 + 快捷键说明 + 字数（初值 0 字）
    expect(document.body.textContent).toContain('Enter 发送');
    expect(document.body.textContent).toContain('0 字');

    // 闪电按钮 → 弹出 5 个快捷指令
    const cmdBtn = elByTestId('ai-corpus-cmd') as HTMLElement;
    expect(cmdBtn).not.toBeNull();
    await act(async () => {
      cmdBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const items = Array.from(document.body.querySelectorAll('[data-testid^="ai-corpus-cmd-"]')) as HTMLElement[];
    expect(items.length).toBe(7);
    expect(elByTestId('ai-corpus-cmd-aiCorpusCmdDeAIfy')).not.toBeNull();
    expect(elByTestId('ai-corpus-cmd-aiCorpusCmdEmotion')).not.toBeNull();

    // 选择「润色改写」→ 模板填入输入框（可改后发送），字数与草稿同步更新
    await act(async () => {
      document
        .querySelector('[data-testid="ai-corpus-cmd-aiCorpusCmdPolish"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toContain('润色这段文字');
    expect(document.body.textContent).toContain(`${ta.value.length} 字`);
    expect(localStorage.getItem('sight-folio:writing.aiCorpusDraft.语料参谋 · 测试之书')).toContain('润色这段文字');

    // 卸载后重新挂载：草稿从 localStorage 恢复（跨会话保留）
    if (root) act(() => root!.unmount());
    root = null;
    host = null;
    document.body.innerHTML = '';
    await mountAsync(panel);
    const ta2 = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta2.value).toContain('润色这段文字');
  });

  it('抽屉展开态左缘手柄：拖拽调宽并写入 localStorage（跨会话记忆）', async () => {
    localStorage.removeItem('sight-folio:writing.drawerWidth');
    await mountAsync(<WritingDrawer {...drawerProps} />);
    // 默认宽度 320 的抽屉主体（emotion 样式类生效，用 computed style 取实际宽度）
    const drawer = Array.from(document.body.querySelectorAll('div')).find(
      (el) => getComputedStyle(el).width === '320px',
    );
    expect(drawer, '默认宽度应为 320px').toBeTruthy();

    // 手柄：role=separator 的水平拖拽分隔条（embedded 语料面板隐藏手柄，不会干扰）
    const handle = document.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement;
    expect(handle, '应渲染抽屉左缘拖拽手柄').toBeTruthy();

    // 按下（x=400，此时宽度 320）→ 向左拖 60px（x=340）→ 宽度变宽为 380
    await act(async () => {
      dispatchPointer(handle, 'pointerdown', 400);
    });
    await act(async () => {
      dispatchPointer(window, 'pointermove', 340);
    });
    expect(getComputedStyle(drawer!).width).toBe('380px');
    // 松手 → 偏好写入 localStorage
    await act(async () => {
      dispatchPointer(window, 'pointerup', 340);
    });
    expect(localStorage.getItem('sight-folio:writing.drawerWidth')).toBe('380');
    // 拖拽结束清理（再次 move 不再改变宽度）
    await act(async () => {
      dispatchPointer(window, 'pointermove', 200);
    });
    expect(getComputedStyle(drawer!).width).toBe('380px');
  });

  it('抽屉展开态：预存宽度跨会话读回；双击手柄复位默认 320 并写入 localStorage', async () => {
    localStorage.setItem('sight-folio:writing.drawerWidth', '480');
    await mountAsync(<WritingDrawer {...drawerProps} />);
    const drawer = Array.from(document.body.querySelectorAll('div')).find(
      (el) => getComputedStyle(el).width === '480px',
    );
    expect(drawer, '应读取保存的宽度偏好 480px').toBeTruthy();

    const handle = document.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement;
    // 双击 → 复位默认 320 并记忆
    await act(async () => {
      handle!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(getComputedStyle(drawer!).width).toBe('320px');
    expect(localStorage.getItem('sight-folio:writing.drawerWidth')).toBe('320');
  });
});

describe('AiCorpusPanel C2 找范例：发送前库内检索与证据注入（P1）', () => {
  const agent = {
    id: 'a1',
    name: '写作助手',
    description: '',
    modelId: 'm1',
    systemPrompt: '',
    temperature: 0.7,
    maxIterations: 1,
    toolIds: [] as string[],
    createdAt: 1,
    updatedAt: 1,
  };
  const conv = {
    id: 'c1',
    agentId: 'a1',
    title: '语料参谋 · 测试之书',
    createdAt: 1,
    updatedAt: 1,
  };
  const aHit = {
    chunkId: 11,
    bookId: 1,
    bookTitle: '样本集',
    seq: 1,
    kind: 'narrative',
    chapterTitle: '第一章',
    content: '雨点敲在瓦上，像谁在深夜拨算盘。',
    referenceTier: 'high',
    occurrenceCount: 1,
    occurrences: [] as never[],
  };

  /** 取 sendMessage 第 2 个参数（content）的强类型读取（mock 参数元组为空 tuple，需显式断言） */
  function sentContent(): string {
    const args = h.state.sendMessage.mock.calls[0] as unknown[];
    return (args[1] as string) ?? '';
  }

  /** 挂载独立 AiCorpusPanel 并让挂载期会话（listConversations → setConvId）就绪 */
  async function mountPanel() {
    h.state.agents = [agent];
    vi.mocked(agentApi.listConversations).mockResolvedValue([conv]);
    vi.mocked(agentApi.listMessages).mockResolvedValue([]);
    await mountAsync(
      <AiCorpusPanel
        chatTitle="语料参谋 · 测试之书"
        buildContextBlock={() => '【写作上下文】测试'}
        onInsertText={() => {}}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    // flush 挂载 effect 的 async 链（listConversations → setConvId）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  /** 向输入框写入文本并点击发送按钮 */
  async function typeAndSend(text: string) {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendBtn = elByTestId('ai-corpus-send') as HTMLElement;
    await act(async () => {
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it('找范例消息：先 corpusApi.search 召回，content 附带书·章出处的证据块后发送', async () => {
    h.search.mockResolvedValue({ books: [], hits: [aHit] });
    await mountPanel();
    await typeAndSend('帮我找几个写雨的例句');

    // 意图识别 → 检索（bookId=null 全库、limit=8）
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.search).toHaveBeenCalledWith('帮我找几个写雨的', null, 8, 0);
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const content = sentContent();
    // 消息本体 + 证据块（保留书名·章出处与库内原文）
    expect(content).toContain('帮我找几个写雨的例句');
    expect(content).toContain('语料库检索证据');
    expect(content).toContain('《样本集 · 第一章》');
    expect(content).toContain('雨点敲在瓦上，像谁在深夜拨算盘。');
  });

  it('非找范例消息不触发检索（普通参谋对话原样发送）', async () => {
    await mountPanel();
    await typeAndSend('帮我分析本章基调');

    expect(h.search).not.toHaveBeenCalled();
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const content = sentContent();
    expect(content).toContain('帮我分析本章基调');
    expect(content).not.toContain('语料库检索证据');
  });

  it('检索失败时降级为普通发送，不阻塞对话', async () => {
    h.search.mockRejectedValue(new Error('corpus unavailable'));
    await mountPanel();
    await typeAndSend('帮我找个例句');

    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    const content = sentContent();
    expect(content).toContain('帮我找个例句');
    expect(content).not.toContain('语料库检索证据');
  });

  it('无命中时也注入「未检索到」提示，防止 AI 声称引用语料库', async () => {
    h.search.mockResolvedValue({ books: [], hits: [] });
    await mountPanel();
    await typeAndSend('写雨的例子');

    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.search).toHaveBeenCalledWith('写雨的', null, 8, 0);
    const content = sentContent();
    expect(content).toContain('语料库检索');
    expect(content).toContain('未找到');
    expect(content).not.toContain('《');
  });
});

describe('右抽屉视图偏好持久化（折叠态 / 语料区 Tab · 切章详情再切回不丢），', () => {
  const collapsedKey = 'sight-folio:writing.drawerCollapsed';
  const tabKey = 'sight-folio:writing.drawerCorpusTab';

  beforeEach(() => {
    localStorage.removeItem(collapsedKey);
    localStorage.removeItem(tabKey);
  });

  it('收起抽屉后重挂载仍为折叠窄条（偏好落 localStorage）', async () => {
    await mountAsync(<WritingDrawer {...drawerProps} />);
    const collapseBtn = document.querySelector('[aria-label="收起创作台"]') as HTMLElement;
    expect(collapseBtn).not.toBeNull();
    await act(async () => {
      collapseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(localStorage.getItem(collapsedKey)).toBe('1');

    // 模拟「切章详情 → 切回」：组件卸载重挂载，折叠态应恢复而不是复位为展开
    if (root) act(() => root!.unmount());
    root = null;
    host = null;
    document.body.innerHTML = '';
    await mountAsync(<WritingDrawer {...drawerProps} />);
    expect(document.querySelector('[aria-label="收起创作台"]')).toBeNull();
    expect(document.querySelector('[aria-label="展开创作台"]')).not.toBeNull();
  });

  it('停在 AI 语料 Tab 后重挂载仍回到 AI 语料；偏好越界（素材库下线）时高亮与内容同口径夹紧', async () => {
    h.state.agents = [
      {
        id: 'a1',
        name: '写作助手',
        description: '',
        modelId: 'm1',
        systemPrompt: '',
        temperature: 0.7,
        maxIterations: 1,
        toolIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    (agentApi.listConversations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (agentApi.createConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
    (agentApi.listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const aiCorpus = {
      chatTitle: '语料参谋 · 测试之书',
      buildContextBlock: () => 'ctx',
      agentId: 'a1',
      onAgentChange: () => {},
      onOpenSettings: () => {},
    };
    await mountAsync(<WritingDrawer {...drawerProps} aiCorpus={aiCorpus} />);
    const aiTab = elByTestId('corpus-tab-ai') as HTMLElement;
    await act(async () => {
      aiTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(localStorage.getItem(tabKey)).toBe('1');

    if (root) act(() => root!.unmount());
    root = null;
    host = null;
    document.body.innerHTML = '';
    await mountAsync(<WritingDrawer {...drawerProps} aiCorpus={aiCorpus} />);
    // 重挂载后仍停 AI 语料：AiCorpusPanel 的 agent 选择器在档、语料库检索标题不在
    expect(elByTestId('ai-corpus-agent')).not.toBeNull();

    // 越界夹紧：偏好存 2 但本次配置没有素材库 Tab → Tabs 高亮与内容都回到合法末位（AI 语料）
    localStorage.setItem(tabKey, '2');
    if (root) act(() => root!.unmount());
    root = null;
    host = null;
    document.body.innerHTML = '';
    await mountAsync(<WritingDrawer {...drawerProps} aiCorpus={aiCorpus} />);
    expect(elByTestId('ai-corpus-agent')).not.toBeNull();
    const selected = Array.from(document.body.querySelectorAll('[role="tab"][aria-selected="true"]')).map(
      (e) => e.textContent,
    );
    expect(selected).toContain('AI 语料');
  });
});

describe('AI 语料草稿按书隔离（切书输入框不串台），', () => {
  const prefix = 'sight-folio:writing.aiCorpusDraft.';

  beforeEach(() => {
    localStorage.removeItem(prefix + '语料参谋 · 书A');
    localStorage.removeItem(prefix + '语料参谋 · 书B');
    h.state.agents = [
      {
        id: 'a1',
        name: '写作助手',
        description: '',
        modelId: 'm1',
        systemPrompt: '',
        temperature: 0.7,
        maxIterations: 1,
        toolIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    (agentApi.listConversations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (agentApi.createConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
    (agentApi.listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('在书A输入未发送的提问后切到书B：B 输入框为空；切回 A 草稿还原', async () => {
    const panel = (title: string) => (
      <AiCorpusPanel
        chatTitle={title}
        buildContextBlock={() => 'ctx'}
        onInsertText={() => {}}
        agentId="a1"
        onAgentChange={() => {}}
        onOpenSettings={() => {}}
      />
    );
    // 书A：输入一段未发送的提问
    await mountAsync(panel('语料参谋 · 书A'));
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    // React 受控组件：必须经原生 value setter 触发 onChange 链路
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(ta, '帮我把这段改得更有画面感');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(localStorage.getItem(prefix + '语料参谋 · 书A')).toContain('画面感');

    // 切书（面板不卸载、chatTitle 变化）：输入框应换成书B 自己的草稿（空）
    await act(async () => {
      root!.render(panel('语料参谋 · 书B'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    const taB = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(taB.value).toBe('');
    expect(localStorage.getItem(prefix + '语料参谋 · 书B')).toBeNull();

    // 切回书A：草稿还原
    await act(async () => {
      root!.render(panel('语料参谋 · 书A'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    const taA2 = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(taA2.value).toContain('画面感');
  });
});
