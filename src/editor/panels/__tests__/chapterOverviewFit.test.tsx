// 九维章统筹面板滚动语义回归锁（2026-10-31，第五轮布局修复）
//
// 事故：用户反馈「切到章详情布局就混乱」。上轮把 details 分支外层改成单一滚动容器，
// 但漏掉了被塞进该容器里的 ChapterOverviewPanel——它根节点写死
// `overflowY:'auto' + height:'100%'`（那是为「正文页签」300px 固定侧栏 + overflow:hidden 父
// 设计的自滚动语义）。在章详情的单一滚动流里，这套 height:100%/内层滚动既无确定父高、
// 又与外层滚动区双重争高 → 短窗口下卡被裁、下方章详情内容挤成窄条。
// 修法：面板根样式按挂载场景可配置：
//   - fit='fill'（默认，正文页签零回归）：自带 overflowY:auto + height:100%。
//   - fit='content'（章详情单一滚动流）：随内容自然展开，不带内层滚动/100%高。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  writing: {
    books: [{ id: 'b1', title: '长夜', genre: 'novel' }],
    chapters: [
      { id: 'c1', bookId: 'b1', title: '第一章', status: 'draft', wordCount: 1200, volumeId: '', extra: '' },
    ] as any[],
    outlines: [] as any[],
    settings: [] as any[],
    timelineEvents: [] as any[],
    foreshadowings: [] as any[],
    storylines: [] as any[],
    setChapterStoryline: vi.fn(),
  },
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));

import { ChapterOverviewPanel } from '../ChapterOverviewPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function rootNode(): HTMLElement {
  const el = document.querySelector('[data-testid="chapter-overview-root"]') as HTMLElement | null;
  expect(el, '根节点应带 data-testid 锚点').toBeTruthy();
  return el!;
}

describe('ChapterOverviewPanel fit：滚动语义按挂载场景分叉', () => {
  it('fit=fill（默认）：根节点自带内层滚动 overflowY:auto（正文页签固定侧栏零回归）', () => {
    mount(<ChapterOverviewPanel bookId="b1" chapterId="c1" />);
    expect(window.getComputedStyle(rootNode()).overflowY, '默认应自滚动').toBe('auto');
  });

  it('fit=content：根节点不得自带内层滚动（避免与外层单一滚动区双重争高）', () => {
    mount(<ChapterOverviewPanel bookId="b1" chapterId="c1" fit="content" />);
    expect(window.getComputedStyle(rootNode()).overflowY, 'content 流不应有内层滚动条').not.toBe('auto');
  });
});
