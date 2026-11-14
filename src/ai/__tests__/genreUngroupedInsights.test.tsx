/**
 * ㉞ T-F″（2026-11-10 轮 10）· 真渲染层：/ai 空态《当前书籍洞察》的卷分布 chip，
 * 「无组那一组」必须按载体叫名。
 *
 * 为什么单独开一个真渲染文件（纯函数 + 源码锁那一套在 genreUngroupedSurface.test.ts）：
 * 反证 D 实测**没牙**——把 `const volName = v.volume || ungroupedLabel` 改成
 * `const volName = v.volume`，源码锁仍全绿（它只查定义行在不在）。这正是本仓
 * `statsOverviewGenre.test.tsx` 头注释判过的形状：「算好了但没接到行上」，
 * 只有组件级真渲染拦得住。教训第三次付钱，这次当场补。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWritingStore } from '../../store/writingStore';
import { WritingBookInsights } from '../WritingBookInsights';
import type { WritingBook, WritingChapter } from '../../services/writing';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
async function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}
const noopLoad = () => Promise.resolve();

const mkBook = (genre: string): WritingBook =>
  ({
    id: 'b1',
    title: '长夜',
    description: null,
    genre,
    medium: genre === 'novel' || genre === '' ? 'serial' : 'collection',
    status: 'ongoing',
    coverColor: '#4f46e5',
    dailyGoal: 0,
    extra: '{}',
    createdAt: 1700000000,
    updatedAt: 1700002000,
  }) as WritingBook;

/** 一本「无组」的书：单条正文单位，volume 空串、无 parentId（遗留扁平口径 → 归无组） */
const mkChapter = (volume: string): WritingChapter =>
  ({
    id: 'c1',
    bookId: 'b1',
    title: '第一章',
    content: '<p>正文</p>',
    sortOrder: 1,
    wordCount: 1200,
    status: 'draft',
    volume,
    parentId: null,
    kind: 'chapter',
    storylineId: null,
    extra: '{}',
    createdAt: 1700000000,
    updatedAt: 1700000000,
  }) as WritingChapter;

function seed(genre: string, volume = '') {
  useWritingStore.setState({
    books: [mkBook(genre)],
    chapters: [mkChapter(volume)],
    settings: [],
    outlines: [],
    timelineEvents: [],
    storylines: [],
    foreshadowings: [],
    dailyStats: [],
    activeBookId: 'b1',
    activeChapterId: null,
    booksLoading: false,
    chaptersLoading: false,
    settingsLoading: false,
    outlinesLoading: false,
    timelineLoading: false,
    storylineLoading: false,
    foreshadowingLoading: false,
    loadBooks: vi.fn(noopLoad),
    loadChapters: vi.fn(noopLoad),
    loadSettings: vi.fn(noopLoad),
    loadOutlines: vi.fn(noopLoad),
    loadTimelineEvents: vi.fn(noopLoad),
    loadStorylines: vi.fn(noopLoad),
    loadForeshadowings: vi.fn(noopLoad),
  } as never);
}

const bodyText = () => document.body.textContent ?? '';

describe('㉞ T-F″ · 洞察卡卷分布 chip 的兜底组名按载体（真渲染）', () => {
  it('诗集：无组那一颗说「未分组 · N 首」，一个「卷」字都不许有', async () => {
    seed('poetry');
    await mount(<WritingBookInsights />);
    expect(bodyText()).toContain('未分组 · 1 首');
    expect(bodyText()).not.toContain('未分卷');
  });

  it('散文集「未分组 · N 篇」/ 剧本「未分幕 · N 场」/ 日记「未归年月 · N 天」', async () => {
    const cases: [string, string][] = [
      ['essay', '未分组 · 1 篇'],
      ['script', '未分幕 · 1 场'],
      ['diary', '未归年月 · 1 天'],
    ];
    for (const [genre, want] of cases) {
      seed(genre);
      await mount(<WritingBookInsights />);
      expect(bodyText(), `${genre} 的兜底组名`).toContain(want);
      expect(bodyText(), `${genre} 还顶着小说的「卷」`).not.toContain('未分卷');
    }
  });

  it('小说与未设体裁的旧书：逐字「未分卷 · N 章」（零回归，含脏值）', async () => {
    for (const genre of ['novel', '', 'diaryy']) {
      seed(genre);
      await mount(<WritingBookInsights />);
      expect(bodyText(), `${genre || '(空)'} 的小说原句`).toContain('未分卷 · 1 章');
    }
  });

  it('作者起了组名 → 原样显示，兜底词不得覆盖（体裁措辞只兜「无组」那一组）', async () => {
    seed('poetry', '上辑');
    await mount(<WritingBookInsights />);
    expect(bodyText()).toContain('上辑 · 1 首');
    expect(bodyText()).not.toContain('未分组');
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});
