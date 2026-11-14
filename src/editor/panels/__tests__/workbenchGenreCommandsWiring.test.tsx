// W-0a 接线锁（2026-11-10 轮 2）：体裁命令集**从定义到运行时**的那根线。
//
// 为什么光有 workbenchGenre.test.ts 不够：它测的是纯函数 getSlashCommands(true,'poetry')，
// 全绿也能照常漏掉真实断口——本仓已为此付过四次钱（22 条体裁命令、shelfFor/paletteFor、
// WelcomeView 的 genre prop、本刀之前的命令层）。W-0a 的形状正是「定义 100% / 运行时 20%」：
// 菜单那一行只传 isBookScene，诗集作者敲 `/` 永远只能看到小说那 6 条。
//
// 所以这里两层都钉：① 真渲染 WorkbenchInputBar，看菜单**列出来的是哪几条**；
// ② 源码锁住「genre 从 hook 传到 ctx、再传进菜单与 send」这条链，防止后人重构时把 prop 悄悄丢掉。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
// createRoot 走 react-dom 的 client 入口（与 workbenchInputBar.voice.test.tsx 同口径）
import { createRoot, type Root } from 'react-dom/client';
import type { WorkbenchInputBarCtx } from '../workbenchComponents';

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (sel: (s: { interruptRequested: boolean }) => unknown) => sel({ interruptRequested: false }),
    { getState: () => ({ requestInterrupt: vi.fn(), interruptRequested: false }) },
  ),
}));

vi.mock('../speechInput', () => ({
  isSpeechRecognitionSupported: () => false,
  ensureMicPermission: async () => 'denied' as const,
  requestSpeechAuthorization: async () => 'denied' as const,
  createSpeechInput: () => ({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }),
}));

vi.mock('../../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ showToast: vi.fn() }) },
}));

import { WorkbenchInputBar } from '../workbenchComponents';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let anchor: HTMLButtonElement | null = null;

function makeCtx(over: Partial<WorkbenchInputBarCtx> = {}): WorkbenchInputBarCtx {
  return {
    view: 'chat',
    input: '/',
    setInput: vi.fn(),
    editInput: '',
    setEditInput: vi.fn(),
    inputRef: { current: null },
    editInputRef: { current: null },
    submitInput: vi.fn(),
    detectHashMention: vi.fn(),
    detectSlashCommand: vi.fn(),
    setSlashAnchor: vi.fn(),
    setSlashQuery: vi.fn(),
    setSlashTarget: vi.fn(),
    slashAnchor: anchor,
    slashQuery: '',
    slashTarget: 'chat',
    fileDiagnostics: [],
    fixErrors: vi.fn(),
    quickAction: vi.fn(),
    queued: [],
    isBookScene: true,
    agents: [],
    selectedAgentId: null,
    selectAgent: vi.fn(),
    ...over,
  };
}

/** 打开斜杠菜单并读出菜单里实际列出的命令名（菜单文本形如 `/形式 形式核验`） */
async function menuCommands(over: Partial<WorkbenchInputBarCtx> = {}): Promise<string[]> {
  anchor = document.createElement('button');
  document.body.appendChild(anchor);
  host = document.createElement('div');
  document.body.appendChild(host);
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  root = createRoot(host);
  await act(async () => {
    root!.render(<WorkbenchInputBar ctx={makeCtx(over)} selection={null} isStreaming={false} />);
  });
  // 每行第一枚 Typography 才是 `/命令名`（label/description 会拼进 textContent，
  // 用 /^\/(\S+)/ 抓会把「fix修复问题…」整串当成命令名）
  return Array.from(document.querySelectorAll('.MuiMenuItem-root'))
    .map((el) => el.querySelector('.MuiTypography-root')?.textContent ?? '')
    .filter((txt) => txt.startsWith('/'))
    .map((txt) => txt.slice(1));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host = null;
  anchor = null;
  document.body.innerHTML = '';
});

describe('斜杠菜单按体裁出命令（W-0a 运行时）', () => {
  it('诗集：列出自己那支，小说四条一枚都不许出现', async () => {
    const m = await menuCommands({ genre: 'poetry' });
    expect(m).toEqual(expect.arrayContaining(['体检', '形式', '意象', '分行', '节奏', '脑暴']));
    expect(m.length).toBe(6);
    for (const forbidden of ['伏笔', '连续性', '人物', '时间线']) {
      expect(m, `诗集菜单不该出现「${forbidden}」`).not.toContain(forbidden);
    }
  });

  it('散文集 / 剧本 / 日记各自一支（同一行菜单代码，四种结果）', async () => {
    expect(await menuCommands({ genre: 'essay' })).toEqual(expect.arrayContaining(['立意', '结构', '素材']));
    expect(await menuCommands({ genre: 'script' })).toEqual(expect.arrayContaining(['幕场', '对白', '指示', '冲突']));
    expect(await menuCommands({ genre: 'diary' })).toEqual(expect.arrayContaining(['空档', '语气', '归档']));
  });

  it('小说零回归：没设体裁的书（genre 缺省/空串）菜单与改动前逐字同集', async () => {
    const NOVEL = ['体检', '连续性', '人物', '伏笔', '时间线', '脑暴'];
    expect(await menuCommands()).toEqual(NOVEL);
    expect(await menuCommands({ genre: '' })).toEqual(NOVEL);
    expect(await menuCommands({ genre: 'novel' })).toEqual(NOVEL);
    expect(await menuCommands({ genre: 'scribble' })).toEqual(NOVEL); // 脏值只许回落，不许猜
  });

  it('代码场景不受影响（菜单仍是 fix/explain 那一支）', async () => {
    const m = await menuCommands({ isBookScene: false, genre: 'poetry' });
    expect(m).toContain('fix');
    expect(m).not.toContain('体检');
  });
});

describe('W-0a 接线源码锁（genre 不许再半路掉）', () => {
  const read = (rel: string): string => readFileSync(`${process.cwd()}/${rel}`, 'utf8');

  it('菜单渲染处必须带 genre', () => {
    expect(read('src/editor/panels/workbenchComponents.tsx')).toContain('getSlashCommands(ctx.isBookScene, ctx.genre)');
  });

  it('输入条 ctx 必须声明 genre 位', () => {
    expect(read('src/editor/panels/workbenchComponents.tsx')).toMatch(/genre\?:\s*string/);
  });

  it('hook 必须现读书的体裁并把它放进返回的 ctx（单一判据 = resolveBookGenre）', () => {
    const src = read('src/editor/panels/workbenchPanelHooks.ts');
    expect(src).toContain('resolveBookGenre({ bookTitle })');
    expect(src).toContain('genre: bookGenre');
    expect(src).toContain('parseSlashCommand(trimmed, isBookScene, bookGenre)');
  });

  it('面板必须把 hook 的 ctx 透传给输入条（孤儿 prop 是本页四种历史病，禁止再养第五种）', () => {
    expect(read('src/editor/panels/WorkbenchAiPanel.tsx')).toContain('ctx={{ ...ctx, agents, selectedAgentId, selectAgent }}');
  });
});
