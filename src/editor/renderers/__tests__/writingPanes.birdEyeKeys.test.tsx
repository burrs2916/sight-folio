// 鸟瞰条重复 key 回归锁（2026-09-14）
//
// 事故：控制台报 `Encountered two children with the same key, '卷 · 卷 2'`（栈顶 BirdEyeBar）。
// 根因：BirdEyeBar 的 bar() 拿**显示文案**（`${kind} · ${title}`）当 React key，
// 而卷名是用户自由起的——树里出现两个同名卷（如都叫「卷 2」）key 就撞了。
// 修法：key 改用节点 id（唯一且稳定），文案只做显示。
//
// 这条测试锁死：两个 kind+title 完全相同的根节点，不得再冒出 duplicate key 告警。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  writing: {
    books: [] as any[],
    chapters: [] as any[],
    outlines: [] as any[],
    settings: [] as any[],
    activeBookId: 'b1' as string | null,
    collapsedNodeIds: [] as string[],
    toggleNodeCollapse: vi.fn(),
    createChapter: vi.fn(async () => null),
    createChildNode: vi.fn(async () => null),
    reparentNode: vi.fn(async () => {}),
    renameNodeKind: vi.fn(async () => {}),
    setChapterStatus: vi.fn(async () => {}),
    renameChapter: vi.fn(async () => {}),
    deleteChapter: vi.fn(async () => {}),
    createOutline: vi.fn(async () => null),
    updateOutline: vi.fn(async () => {}),
    deleteOutline: vi.fn(async () => {}),
    createSetting: vi.fn(async () => null),
    updateSetting: vi.fn(async () => {}),
    deleteSetting: vi.fn(async () => {}),
    // StorylineSection（剧情线实体区）新增订阅 + 动作，mock 须一并供给
    storylines: [] as any[],
    timelineEvents: [] as any[],
    // 伏笔联动：NodeRow 新增 foreshadowings 订阅
    foreshadowings: [] as any[],
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async () => null),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
  },
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));

import { StorylinePane } from '../writingPanes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let errorSpy: ReturnType<typeof vi.spyOn>;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

beforeEach(() => {
  // React 的 duplicate key 告警走 console.error，抓它
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
  errorSpy.mockRestore();
});

const chapter = (id: string, title: string, kind: string, parentId: string | null) => ({
  id,
  bookId: 'b1',
  title,
  content: '',
  sortOrder: 0,
  wordCount: 0,
  status: 'draft',
  volume: '',
  parentId,
  kind,
  createdAt: 0,
  updatedAt: 0,
});

describe('鸟瞰条 · 同名根节点不得撞 key（回归锁）', () => {
  it('两个 kind+title 完全相同的根（卷 · 卷 2 ×2）不产生 duplicate key 告警，且两段都渲染', () => {
    h.writing.chapters = [chapter('v1', '卷 2', '卷', null), chapter('v2', '卷 2', '卷', null)];
    h.writing.outlines = [];
    mount(<StorylinePane accent="#4A338F" bookId="b1" chapters={h.writing.chapters} outlines={h.writing.outlines} settings={[]} />);

    const dup = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('same key') || s.includes('Keys should be unique'));
    expect(dup, `不应有重复 key 告警：${JSON.stringify(dup)}`).toEqual([]);

    // 两个同名卷的进度段都还在（label 相同但 key 不同，谁也不吞谁）
    const labels = Array.from(document.body.querySelectorAll('span')).filter((s) => s.textContent === '卷 · 卷 2');
    expect(labels.length, '两个同名卷各渲染一段进度条').toBe(2);
  });
});
