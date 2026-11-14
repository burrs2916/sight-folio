// 右栏「统计总览卡」的读数口径必须跟着体裁走（⑭ 刀C 收口时发现的漏接，2026-11-09）
//
// 为什么单独钉这一条：⑨ 把 chapterOutlier 改成吃 genre、⑭ 把 kpiLabelKeys 接到三个面之后，
// 这张卡（StatsOverviewCard）仍是 `buildChapterWordRows(bookChapters)` + 写死的「章节数/卷数/平均章长」。
// 结果是同一个诗集在统计页签里叫「诗作 / 首均」，滚到右栏又变回「章节数 / 章均」，
// 而且底栏提醒条与这张卡都会给每首诗贴「超长/偏短」—— 诗集长短悬殊本是体裁常态。
// 组件级才拦得住这种漏接：单测 buildChapterWordRows 传不传 genre 都过。
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWritingStore } from '../../../store/writingStore';
import { StatsOverviewCard } from '../StatsPanels';
import type { WritingBook, WritingChapter } from '../../../services/writing';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function renderCard(bookId: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<StatsOverviewCard bookId={bookId} />);
  });
}

const book = (genre: string): WritingBook => ({
  id: 'b1',
  title: '测试书',
  description: null,
  genre,
  medium: genre === 'novel' ? 'serial' : 'collection',
  status: 'active',
  coverColor: '#4f46e5',
  dailyGoal: 0,
  extra: '{}',
  createdAt: 1700000000,
  updatedAt: 1700000000,
});

/** 体量极端悬殊：3000 字 vs 三首几十字 —— 小说口径必判离群，诗集/散文集口径应一条不判 */
const chapter = (id: string, wordCount: number, sortOrder: number): WritingChapter => ({
  id,
  bookId: 'b1',
  title: `单元 ${sortOrder}`,
  content: '<p>正文</p>',
  sortOrder,
  wordCount,
  status: 'draft',
  volume: '',
  parentId: null,
  kind: 'chapter',
  storylineId: null,
  extra: '{}',
  createdAt: 1700000000,
  updatedAt: 1700000000,
});

const rows = [chapter('c1', 3000, 1), chapter('c2', 40, 2), chapter('c3', 55, 3), chapter('c4', 60, 4)];

const seed = (genre: string) =>
  useWritingStore.setState({ books: [book(genre)], chapters: rows, settings: [] } as never);

const text = () => host!.textContent ?? '';

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe('StatsOverviewCard 读数按体裁', () => {
  it('小说：仍是「章节数 / 平均章长」，体量悬殊照判离群（零回归）', async () => {
    seed('novel');
    await renderCard('b1');
    expect(text()).toContain('章节数');
    expect(text()).toContain('平均章长');
    expect(text()).toContain('离群章节');
    expect(text()).toContain('超长');
  });

  it('未设置体裁的旧书 = 小说口径，一字不变', async () => {
    seed('');
    await renderCard('b1');
    expect(text()).toContain('章节数');
    expect(text()).toContain('离群章节');
  });

  it('诗集：名词换成「首数 / 首均字数」，且一条离群都不给', async () => {
    seed('poetry');
    await renderCard('b1');
    const s = text();
    expect(s).toContain('首数');
    expect(s).toContain('首均字数');
    expect(s).toContain('分组数');
    // 小说量纲一个都不许残留（「章均」是⑭语料那侧的教训：空态行也会泄漏）
    expect(s).not.toContain('章节数');
    expect(s).not.toContain('平均章长');
    expect(s).not.toContain('离群章节');
    expect(s).not.toContain('超长');
  });

  it('散文集：换成「篇数 / 平均篇长」，同样不判离群', async () => {
    seed('essay');
    await renderCard('b1');
    const s = text();
    expect(s).toContain('篇数');
    expect(s).toContain('平均篇长');
    expect(s).not.toContain('章节数');
    expect(s).not.toContain('离群章节');
  });

  it('体裁取不到（书还没加载）→ 退回小说口径，不崩不空白', async () => {
    useWritingStore.setState({ books: [], chapters: rows, settings: [] } as never);
    await renderCard('b1');
    expect(text()).toContain('总字数');
    expect(text()).toContain('章节数');
  });
});
