// 人物出场图谱 · 数据源改造回归锁（批次② 第二部分）
//
// 改造前图谱读扫描产物（project_files 的 writing:// 虚拟行 + metadata.appearances +
// findings 的 writing-dead-setting），后果是**作者没点「解析全书」就是一张白图**。
// 现在全部就地派生自写作域（writingStore.chapters/settings），因此这里最要紧的一条是：
// 只灌写作域数据、完全不碰 projectStore，矩阵也必须出得来。
//
// 另外锁一个真出过的 bug：表头按热度排序，单元格必须按**同一顺序**取数，
// 否则名字和数字会错列。用 DOM 顺序做位置断言，而不是按 id 查（按 id 查永远对得上，抓不到错位）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => ({ openWritingDesk: vi.fn() }));
vi.mock('../../utils/writingDeskWindow', () => ({ openWritingDesk: h.openWritingDesk }));

import WritingAppearanceMatrix from '../WritingAppearanceMatrix';
import { useWritingStore } from '../../store/writingStore';
import { setLang } from '../../i18n';
import type { WritingChapter, WritingSetting } from '../../services/tauri';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK = 'book_matrix';

const chapter = (id: string, content: string, sortOrder: number): WritingChapter =>
  ({
    id,
    bookId: BOOK,
    title: `第${sortOrder + 1}章`,
    content,
    sortOrder,
    wordCount: content.length,
    status: 'draft',
    volume: '',
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

const setting = (id: string, name: string, extra = '{}'): WritingSetting =>
  ({
    id,
    bookId: BOOK,
    kind: 'character',
    name,
    subtitle: '',
    description: '',
    extra,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingSetting;

let root: Root | null = null;

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<WritingAppearanceMatrix />);
  });
}

/** 表头顺序（DOM 序，即热度排序结果） */
const headerOrder = () =>
  Array.from(document.body.querySelectorAll('[data-testid^="appearance-col-"]')).map((el) =>
    (el.getAttribute('data-testid') ?? '').replace('appearance-col-', ''),
  );

/** 某一章各格的内容，按 DOM 序（应与表头同序） */
const cellsOf = (chapterId: string) =>
  Array.from(
    document.body.querySelectorAll(`[data-testid^="appearance-cell-${chapterId}-"]`),
  ).map((el) => el.textContent?.trim() ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  setLang('zh-CN');
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('WritingAppearanceMatrix · 写作域派生', () => {
  it('完全不碰扫描层也能出矩阵（改造前必须先生成扫描产物）', async () => {
    useWritingStore.setState({
      activeBookId: BOOK,
      chapters: [chapter('c1', '沈砚推门进来，雨声涌了进来。', 0), chapter('c2', '沈砚与青冥剑宗对峙。', 1)],
      settings: [setting('s1', '沈砚'), setting('s2', '青冥剑宗')],
    });

    await mount();

    const text = document.body.textContent ?? '';
    expect(text).toContain('人物出场图谱');
    expect(headerOrder()).toHaveLength(2);
    // 沈砚 total=2 排在前，青冥剑宗 total=1 排在后
    expect(headerOrder()).toEqual(['s1', 's2']);
    expect(cellsOf('c1')).toEqual(['1', '']);
    expect(cellsOf('c2')).toEqual(['1', '1']);
  });

  it('表头与单元格必须同序取数（错列过一次：表头排序、格子按原数组遍历）', async () => {
    useWritingStore.setState({
      activeBookId: BOOK,
      // 数组顺序刻意与热度顺序相反：cold 先入列，但热度低
      // （单字名不参与提及统计，所以一律用双字）
      chapters: [chapter('c1', '阿丙阿丙阿丙', 0), chapter('c2', '阿甲阿甲阿甲阿甲阿甲', 1)],
      settings: [setting('cold', '阿丙'), setting('hot', '阿甲')],
    });

    await mount();

    const headers = headerOrder();
    expect(headers[0]).toBe('hot'); // 热度 5 > 3
    // c1 只有 cold 出现 3 次：位置必须落在 cold 那一列（第二列）
    expect(cellsOf('c1')).toEqual(['', '3']);
    expect(cellsOf('c2')).toEqual(['5', '']);
  });

  it('零提及的设定卡照样成为一列（此前要靠扫描写 findings 才显形）', async () => {
    useWritingStore.setState({
      activeBookId: BOOK,
      chapters: [chapter('c1', 'only 沈砚 showed up', 0)],
      settings: [setting('s1', '沈砚'), setting('s2', '从未出场')],
    });

    await mount();

    expect(headerOrder()).toContain('s2');
    expect(cellsOf('c1')).toEqual(['1', '']);
  });

  it('别名计入出场统计（零迁移，读 extra.aliases）', async () => {
    useWritingStore.setState({
      activeBookId: BOOK,
      chapters: [chapter('c1', '沈公子来了，又是沈公子。', 0)],
      settings: [setting('s1', '沈砚', '{"aliases":["沈公子"]}')],
    });

    await mount();

    expect(cellsOf('c1')).toEqual(['2']);
  });

  it('没有章节与没有设定卡是两件事，文案必须分开', async () => {
    useWritingStore.setState({ activeBookId: BOOK, chapters: [], settings: [setting('s1', '沈砚')] });
    await mount();
    expect(document.body.textContent).toContain('还没有章节正文');

    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    useWritingStore.setState({ activeBookId: BOOK, chapters: [chapter('c1', '正文', 0)], settings: [] });
    await mount();
    expect(document.body.textContent).toContain('还没有设定卡');
  });

  it('点章节名跳写作台该章正文（不跳代码工作台）', async () => {
    useWritingStore.setState({
      activeBookId: BOOK,
      chapters: [chapter('c1', '沈砚在。', 0)],
      settings: [setting('s1', '沈砚')],
    });
    h.openWritingDesk.mockResolvedValue(undefined);

    await mount();

    const rowLabel = document.body.querySelector('[data-testid^="appearance-cell-c1-"]') as HTMLElement | null;
    expect(rowLabel).toBeTruthy();
    await act(async () => {
      rowLabel!.click();
    });
    expect(h.openWritingDesk).toHaveBeenCalledWith({ bookId: BOOK, chapterId: 'c1' });
  });
});
