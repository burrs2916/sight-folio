// 写作台灵感/快速笔记面板 · 回归锁（T4）
//
// 这条测试锁死：
// ① 打开即按 bookId 拉取笔记列表，渲染内容/章节 chip/标签；
// ② 草稿模式（速记）自动进入新建态，保存时按活动章绑定、逐字落库（tags/pin 规范化）；
// ③ 删除即调 delete 并从列表移除；
// ④ 标签 chip 过滤列表。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  deleteNote: vi.fn(),
}));

vi.mock('../../services/writing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/writing')>();
  return {
    ...actual,
    writingNotesApi: {
      list: h.list,
      save: h.save,
      delete: h.deleteNote,
    },
  };
});

import { WritingNotesDialog } from '../WritingNotesDialog';
import type { WritingNote } from '../../services/writing';

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

const note = (over: Partial<WritingNote>): WritingNote => ({
  id: 'note_1',
  bookId: 'book_1',
  chapterId: 'ch_1',
  content: '反派在雨夜出场',
  tags: JSON.stringify(['人物', '转折']),
  pin: 0,
  createdAt: 1700000000,
  updatedAt: 1700000000,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function mount(opts?: { draft?: string; chapterId?: string }) {
  return mountAsync(
    <WritingNotesDialog
      open
      onClose={() => {}}
      bookId="book_1"
      chapters={[
        { id: 'ch_1', title: '第一章 雨夜' },
        { id: 'ch_2', title: '第二章 追猎' },
      ]}
      activeChapterId={opts?.chapterId ?? 'ch_1'}
      onGotoChapter={() => {}}
      draftContent={opts?.draft}
      onClearDraft={() => {}}
    />,
  );
}

describe('WritingNotesDialog（T4 灵感/快速笔记）', () => {
  it('打开即拉取该书笔记，渲染内容、章节 chip 与标签', async () => {
    h.list.mockResolvedValue([
      note({ id: 'note_1', content: '反派在雨夜出场', chapterId: 'ch_1', tags: JSON.stringify(['人物']) }),
      note({ id: 'note_2', content: '反转：主角其实是双胞胎', chapterId: '', tags: '[]' }),
    ]);
    await mount();
    expect(h.list).toHaveBeenCalledWith('book_1');
    const text = document.body.textContent ?? '';
    expect(text).toContain('反派在雨夜出场');
    expect(text).toContain('第一章 雨夜');
    expect(text).toContain('反转：主角其实是双胞胎');
    expect(text).toContain('人物');
    // 无章节绑定的笔记不渲染章节 chip
    expect((document.body.textContent ?? '').includes('第二章 追猎')).toBe(false);
  });

  it('草稿模式自动进入新建态，保存按活动章绑定并规范化 tags/pin', async () => {
    h.list.mockResolvedValue([]);
    await mount({ draft: '冒出的新点子', chapterId: 'ch_2' });
    const input = document.querySelector('[data-testid="note-content-input"]') as HTMLTextAreaElement;
    expect(input.value).toBe('冒出的新点子');
    const saveBtn = document.querySelector('[data-testid="note-save"]') as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    const arg = (h.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as WritingNote;
    expect(arg.id).toMatch(/^note_/);
    expect(arg.bookId).toBe('book_1');
    expect(arg.chapterId).toBe('ch_2');
    expect(arg.content).toBe('冒出的新点子');
    expect(arg.tags).toBe('[]');
    expect(arg.pin).toBe(0);
    expect(arg.createdAt).toBeGreaterThan(0);
    expect(arg.updatedAt).toBeGreaterThan(0);
    // 保存后列表新增该条
    expect(document.body.textContent).toContain('冒出的新点子');
  });

  it('删除笔记：调 delete 并从列表移除', async () => {
    h.list.mockResolvedValue([note({ id: 'note_1', content: '要删的笔记' })]);
    await mount();
    expect(document.body.textContent).toContain('要删的笔记');
    await act(async () => {
      (document.querySelector('[data-testid="note-delete"]') as HTMLButtonElement).click();
    });
    expect(h.deleteNote).toHaveBeenCalledWith('note_1');
    expect(document.body.textContent).not.toContain('要删的笔记');
  });

  it('点击标签 chip 过滤列表，再点全部恢复', async () => {
    h.list.mockResolvedValue([
      note({ id: 'note_1', content: 'A 人物灵感', tags: JSON.stringify(['人物']) }),
      note({ id: 'note_2', content: 'B 剧情灵感', tags: JSON.stringify(['剧情']) }),
    ]);
    await mount();
    const text = () => document.body.textContent ?? '';
    expect(text()).toContain('A 人物灵感');
    expect(text()).toContain('B 剧情灵感');
    const personChip = Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"]')).find(
      (b) => b.textContent === '人物',
    );
    await act(async () => {
      personChip!.click();
    });
    expect(text()).toContain('A 人物灵感');
    expect(text()).not.toContain('B 剧情灵感');
    const allChip = Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"]')).find(
      (b) => b.textContent === '全部',
    );
    await act(async () => {
      allChip!.click();
    });
    expect(text()).toContain('B 剧情灵感');
  });
});
