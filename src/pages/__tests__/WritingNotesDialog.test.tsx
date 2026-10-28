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
import type { WritingNote, WritingChapter } from '../../services/writing';
import { buildTree, treeRowIndent } from '../../utils/writingTree';

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

/** 构造完整 WritingChapter（mock 用，树形下拉需要 parentId/sortOrder/kind） */
function ch(id: string, title: string, parentId: string | null = null, sortOrder = 0): WritingChapter {
  return {
    id,
    bookId: 'book_1',
    title,
    content: '',
    sortOrder,
    wordCount: 0,
    status: '',
    volume: '',
    parentId,
    kind: parentId ? '章' : '卷',
    extra: '',
    createdAt: 0,
    updatedAt: 0,
  };
}

function mount(opts?: { draft?: string; chapterId?: string }) {
  return mountAsync(
    <WritingNotesDialog
      open
      onClose={() => {}}
      bookId="book_1"
      chapters={[ch('ch_1', '第一章 雨夜'), ch('ch_2', '第二章 追猎')]}
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
    // 无章节绑定的笔记不渲染章节 chip（「第二章 追猎」只会出现在筛选下拉 option 中，不是可点 chip）
    const ch2Chips = Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"]')).filter(
      (b) => b.textContent === '第二章 追猎',
    );
    expect(ch2Chips).toHaveLength(0);
    // note_1 绑定 ch_1，正文中渲染可点章节 chip
    const ch1Chips = Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"]')).filter(
      (b) => b.textContent === '第一章 雨夜',
    );
    expect(ch1Chips.length).toBeGreaterThan(0);
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

  it('删除笔记：先出现二次确认，确认后才调 delete 并移除', async () => {
    h.list.mockResolvedValue([note({ id: 'note_1', content: '要删的笔记' })]);
    await mount();
    expect(document.body.textContent).toContain('要删的笔记');
    // 第一次点击只进入确认态，不立即删除
    await act(async () => {
      (document.querySelector('[data-testid="note-delete"]') as HTMLButtonElement).click();
    });
    expect(h.deleteNote).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="note-delete-confirm"]')).not.toBeNull();
    // 确认后删除
    await act(async () => {
      (document.querySelector('[data-testid="note-delete-confirm"]') as HTMLButtonElement).click();
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

  it('搜索框按内容/标签过滤，无匹配时显示空态文案', async () => {
    h.list.mockResolvedValue([
      note({ id: 'note_1', content: '反派在雨夜出场', tags: JSON.stringify(['人物']) }),
      note({ id: 'note_2', content: '双胞胎反转', tags: JSON.stringify(['剧情']) }),
    ]);
    await mount();
    const text = () => document.body.textContent ?? '';
    expect(text()).toContain('反派在雨夜出场');
    // 按标签关键词命中（React 受控组件需用原生 setter 触发 onChange）
    const search = document.querySelector('[data-testid="note-search-input"]') as HTMLInputElement;
    const setSearchValue = (v: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, v);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      setSearchValue('剧情');
    });
    expect(text()).not.toContain('反派在雨夜出场');
    expect(text()).toContain('双胞胎反转');
    // 无匹配
    await act(async () => {
      setSearchValue('不存在的关键词');
    });
    expect(text()).toContain('没有匹配的笔记');
  });

  it('章节筛选下拉：全部/未绑定/指定章（非 native 树形菜单）', async () => {
    h.list.mockResolvedValue([
      note({ id: 'note_1', content: 'Ch1 笔记', chapterId: 'ch_1' }),
      note({ id: 'note_2', content: 'Ch2 笔记', chapterId: 'ch_2' }),
      note({ id: 'note_3', content: '无绑定笔记', chapterId: '' }),
    ]);
    await mount();
    const text = () => document.body.textContent ?? '';
    expect(text()).toContain('Ch1 笔记');
    expect(text()).toContain('Ch2 笔记');
    // 展开筛选下拉（MUI 非 native：mousedown 到显示区打开菜单，选项在 body portal 中）
    const openMenu = async () => {
      await act(async () => {
        const hidden = document.querySelector('[data-testid="note-filter-chapter"]') as HTMLElement;
        const root = hidden.closest('.MuiInputBase-root') as HTMLElement;
        const display = root.querySelector('.MuiSelect-select') as HTMLElement;
        display.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
    };
    const pickOption = async (label: string) => {
      await act(async () => {
        const opt = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
          (o) => o.textContent?.trim() === label,
        );
        expect(opt).toBeTruthy();
        opt!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    };
    // 指定章 ch_2
    await openMenu();
    await pickOption('第二章 追猎');
    expect(text()).toContain('Ch2 笔记');
    expect(text()).not.toContain('Ch1 笔记');
    expect(text()).not.toContain('无绑定笔记');
    // 未绑定
    await openMenu();
    await pickOption('未绑定章节');
    expect(text()).toContain('无绑定笔记');
    expect(text()).not.toContain('Ch1 笔记');
    // 全部恢复
    await openMenu();
    await pickOption('全部章节');
    expect(text()).toContain('Ch1 笔记');
    expect(text()).toContain('Ch2 笔记');
  });

  it('章节下拉按树层级渲染（筛选 + 编辑绑定共用 treeRowIndent 缩进）', async () => {
    h.list.mockResolvedValue([]);
    await mountAsync(
      <WritingNotesDialog
        open
        onClose={() => {}}
        bookId="book_1"
        chapters={[ch('v1', '第一卷 序曲'), ch('v1c1', '第一章 雨夜', 'v1'), ch('v1c2', '第二章 追猎', 'v1')]}
        activeChapterId="v1c1"
        onGotoChapter={() => {}}
        onClearDraft={() => {}}
      />,
    );
    // 进入新建态打开编辑绑定下拉
    await act(async () => {
      (document.querySelector('[data-testid="note-new"]') as HTMLButtonElement).click();
    });
    const openSelect = async (testId: string) => {
      await act(async () => {
        const hidden = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
        const root = hidden.closest('.MuiInputBase-root') as HTMLElement;
        const display = root.querySelector('.MuiSelect-select') as HTMLElement;
        display.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
    };
    // 编辑绑定下拉：按树展开，子章缩进 = treeRowIndent(depth)
    await openSelect('note-chapter-select');
    const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
    const v1 = options.find((o) => o.textContent?.trim() === '第一卷 序曲');
    const c1 = options.find((o) => o.textContent?.trim() === '第一章 雨夜');
    const c2 = options.find((o) => o.textContent?.trim() === '第二章 追猎');
    expect(v1).toBeTruthy();
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();
    expect(window.getComputedStyle(v1!).paddingLeft).toBe(treeRowIndent(0));
    expect(window.getComputedStyle(c1!).paddingLeft).toBe(treeRowIndent(1));
    expect(window.getComputedStyle(c2!).paddingLeft).toBe(treeRowIndent(1));
    // 树结构正确（buildTree：子章挂在卷下）
    const tree = buildTree([ch('v1', '第一卷 序曲'), ch('v1c1', '第一章 雨夜', 'v1'), ch('v1c2', '第二章 追猎', 'v1')]);
    expect(tree[0].children).toHaveLength(2);
    // 选中子章：绑定写入 + 回显
    await act(async () => {
      c1!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const bindDisplay = (
      (document.querySelector('[data-testid="note-chapter-select"]') as HTMLElement).closest(
        '.MuiInputBase-root',
      ) as HTMLElement
    ).querySelector('.MuiSelect-select') as HTMLElement;
    expect(bindDisplay.textContent).toContain('第一章 雨夜');
  });

  it('列表快捷置顶：直接切换 pin 并落库', async () => {
    h.list.mockResolvedValue([note({ id: 'note_1', content: '置顶我', pin: 0 })]);
    await mount();
    await act(async () => {
      (document.querySelector('[data-testid="note-pin"]') as HTMLButtonElement).click();
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    const arg = (h.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as WritingNote;
    expect(arg.id).toBe('note_1');
    expect(arg.pin).toBe(1);
  });

  it('保存并继续：入库后保持新建态、清空内容，可连续速记', async () => {
    h.list.mockResolvedValue([]);
    await mount({ draft: '第一条灵感', chapterId: 'ch_1' });
    const saveBtn = document.querySelector('[data-testid="note-save-continue"]') as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    // 仍在编辑态（新建态），内容已清空
    const input = document.querySelector('[data-testid="note-content-input"]') as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
  });

  it('列表显示相对时间而非完整时间戳', async () => {
    const now = Math.floor(Date.now() / 1000);
    h.list.mockResolvedValue([note({ id: 'note_1', content: '时间显示', updatedAt: now - 60 })]);
    await mount();
    const text = document.body.textContent ?? '';
    expect(text).toContain('分钟前');
    expect(text).toContain('时间显示');
  });
});
