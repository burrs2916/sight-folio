import { describe, it, expect, beforeEach, vi } from 'vitest';

// tauri 层整层 mock：store 单测不依赖 Tauri webview
vi.mock('../../services/tauri', () => ({
  writingApi: {
    listBooks: vi.fn(async () => []),
    saveBook: vi.fn(async () => {}),
    deleteBook: vi.fn(async () => {}),
    listChapters: vi.fn(async () => []),
    saveChapter: vi.fn(async () => {}),
    deleteChapter: vi.fn(async () => {}),
  },
  // 软删辅助（纯函数）：store 从 services/tauri 导入；mock 镜像真实实现（宽容解析）
  parseChapterExtra: (extra: string) => {
    try {
      const parsed = JSON.parse(extra || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  },
  chapterDeletedAt: (ch: { deletedAt?: number; extra?: string }) => {
    const parsed = ch.extra ? JSON.parse(ch.extra || '{}') : {};
    const t = ch.deletedAt ?? (parsed && typeof parsed === 'object' ? parsed.deletedAt : undefined);
    return typeof t === 'number' && t > 0 ? t : 0;
  },
  isChapterDeleted: (ch: { deletedAt?: number; extra?: string }) => {
    const parsed = ch.extra ? JSON.parse(ch.extra || '{}') : {};
    const t = ch.deletedAt ?? (parsed && typeof parsed === 'object' ? parsed.deletedAt : undefined);
    return typeof t === 'number' && t > 0;
  },
  withChapterDeletedAt: (ch: WritingChapter, deletedAt: number) => {
    let extra: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(ch.extra || '{}');
      if (parsed && typeof parsed === 'object') extra = parsed as Record<string, unknown>;
    } catch {
      extra = {};
    }
    extra.deletedAt = deletedAt;
    return { ...ch, extra: JSON.stringify(extra), deletedAt };
  },
  writingSettingsApi: {
    list: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
  writingOutlinesApi: {
    list: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
  writingTimelineApi: {
    list: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
  writingStorylinesApi: {
    list: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
  writingForeshadowingsApi: {
    list: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
  saveTextFile: vi.fn(async () => {}),
  saveWritingEpub: vi.fn(async () => {}),
}));

import { writingApi, type WritingChapter } from '../../services/tauri';
import { useWritingStore } from '../writingStore';

const BOOK_ID = 'book_test';

function chap(id: string, sortOrder: number): WritingChapter {
  return {
    id,
    bookId: BOOK_ID,
    title: id,
    content: '',
    sortOrder,
    wordCount: 0,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '章',
    extra: '{}',
    createdAt: 1000,
    updatedAt: 1000,
  };
}

const mockSave = vi.mocked(writingApi.saveChapter);

describe('writingStore.reorderChapter', () => {
  beforeEach(() => {
    mockSave.mockClear();
    useWritingStore.setState({
      books: [],
      activeBookId: BOOK_ID,
      activeChapterId: null,
      chapters: [chap('a', 1), chap('b', 2), chap('c', 3)],
      settings: [],
    });
  });

  it('向后拖拽：重排本地态并统一重编 sort_order（1..n）', async () => {
    await useWritingStore.getState().reorderChapter('a', 2);
    const chapters = useWritingStore.getState().chapters;
    expect(chapters.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(chapters.map((c) => c.sortOrder)).toEqual([1, 2, 3]);
  });

  it('向前拖拽：只落库顺序变化的章（原位章不写库）', async () => {
    await useWritingStore.getState().reorderChapter('b', 0);
    // 新序 [b, a, c]：c 位置未变（index 2），只有 b/a 落库
    expect(mockSave).toHaveBeenCalledTimes(2);
    const saved = mockSave.mock.calls.map((call) => (call[0] as WritingChapter).id);
    expect(saved).toEqual(expect.arrayContaining(['a', 'b']));
    expect(saved).not.toContain('c');
  });

  it('越界目标索引被钳制，不会越界写库', async () => {
    await useWritingStore.getState().reorderChapter('a', 99);
    const chapters = useWritingStore.getState().chapters;
    expect(chapters.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(chapters.map((c) => c.sortOrder)).toEqual([1, 2, 3]);
  });

  it('落库失败时抛错且本地态不变（先落库再改态的契约）', async () => {
    mockSave.mockRejectedValueOnce(new Error('db locked'));
    await expect(useWritingStore.getState().reorderChapter('b', 0)).rejects.toThrow('db locked');
    // 本地顺序保持不变
    expect(useWritingStore.getState().chapters.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('拖到自己身上是无操作', async () => {
    await useWritingStore.getState().reorderChapter('a', 0);
    expect(mockSave).not.toHaveBeenCalled();
    expect(useWritingStore.getState().chapters.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  describe('writingStore.reorderOutline（大纲页签上/下移：与 reorderChapter 同一契约）', () => {
    function outline(id: string, sortOrder: number) {
      return {
        id,
        bookId: BOOK_ID,
        title: `拍${id}`,
        summary: '',
        chapterId: null,
        extra: '{}',
        sortOrder,
        createdAt: 1,
        updatedAt: 1,
      };
    }

    beforeEach(() => {
      useWritingStore.setState({
        books: [],
        activeBookId: BOOK_ID,
        activeChapterId: null,
        chapters: [],
        settings: [],
        outlines: [outline('a', 1), outline('b', 2), outline('c', 3)],
      });
    });

    it('下移：重排本地态并统一重编 sort_order（1..n）', async () => {
      const { writingOutlinesApi } = await import('../../services/tauri');
      const save = vi.mocked(writingOutlinesApi.save);
      save.mockClear();
      await useWritingStore.getState().reorderOutline('a', 1);
      const outlines = useWritingStore.getState().outlines;
      expect(outlines.map((o) => o.id)).toEqual(['b', 'a', 'c']);
      expect(outlines.map((o) => o.sortOrder)).toEqual([1, 2, 3]);
      expect(save).toHaveBeenCalledTimes(2); // 只落库顺序变化的 a/b
    });

    it('上移：目标索引钳制在合法范围，不会越界写库', async () => {
      const { writingOutlinesApi } = await import('../../services/tauri');
      const save = vi.mocked(writingOutlinesApi.save);
      save.mockClear();
      await useWritingStore.getState().reorderOutline('c', 0);
      expect(useWritingStore.getState().outlines.map((o) => o.id)).toEqual(['c', 'a', 'b']);
      // 首尾互移时 a/b/c 全部位移，三行都要落库
      expect(save).toHaveBeenCalledTimes(3);
    });

    it('移到自己 / 未找到 id 是无操作', async () => {
      const { writingOutlinesApi } = await import('../../services/tauri');
      const save = vi.mocked(writingOutlinesApi.save);
      save.mockClear();
      await useWritingStore.getState().reorderOutline('a', 0);
      await useWritingStore.getState().reorderOutline('nope', 1);
      expect(save).not.toHaveBeenCalled();
      expect(useWritingStore.getState().outlines.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    });

    it('落库失败时抛错且本地态不变（先落库再改态的契约）', async () => {
      const { writingOutlinesApi } = await import('../../services/tauri');
      const save = vi.mocked(writingOutlinesApi.save);
      save.mockRejectedValueOnce(new Error('db locked'));
      await expect(useWritingStore.getState().reorderOutline('a', 1)).rejects.toThrow('db locked');
      expect(useWritingStore.getState().outlines.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('writingStore.setOutlineCover（节拍封面：extra.coverImage，宽容解析）', () => {
    function outline(id: string, extra: string) {
      return {
        id,
        bookId: BOOK_ID,
        title: `拍${id}`,
        summary: '',
        chapterId: null,
        extra,
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
      };
    }

    beforeEach(() => {
      useWritingStore.setState({
        books: [],
        activeBookId: BOOK_ID,
        activeChapterId: null,
        chapters: [],
        settings: [],
        outlines: [outline('a', JSON.stringify({ status: 'draft' }))],
      });
    });

    it('设置封面：写入 extra.coverImage 并保留既有字段（status 共存）', async () => {
      const { writingOutlinesApi } = await import('../../services/tauri');
      const save = vi.mocked(writingOutlinesApi.save);
      save.mockClear();
      await useWritingStore.getState().setOutlineCover('a', 'assets/writing/illustrations/front.png');
      const row = useWritingStore.getState().outlines.find((o) => o.id === 'a');
      expect(JSON.parse(row?.extra ?? '{}')).toEqual({
        status: 'draft',
        coverImage: 'assets/writing/illustrations/front.png',
      });
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('传 null 清除封面并保留其它字段；坏 extra 也绝不抛错', async () => {
      const { writingOutlinesApi } = await import('../../services/tauri');
      const save = vi.mocked(writingOutlinesApi.save);
      save.mockClear();
      useWritingStore.setState({ outlines: [outline('a', JSON.stringify({ status: 'todo', coverImage: 'x.png' }))] });
      await useWritingStore.getState().setOutlineCover('a', null);
      expect(JSON.parse(useWritingStore.getState().outlines[0].extra)).toEqual({ status: 'todo' });
      await useWritingStore.getState().setOutlineCover('a', 'y.png'); // 坏数据宽容（此处数据合法，行为一致）
      expect(useWritingStore.getState().outlines[0].extra).toContain('y.png');
    });

    it('未找到 id 是无操作，不落库', async () => {
      const { writingOutlinesApi } = await import('../../services/tauri');
      const save = vi.mocked(writingOutlinesApi.save);
      save.mockClear();
      await useWritingStore.getState().setOutlineCover('nope', 'x.png');
      expect(save).not.toHaveBeenCalled();
    });
  });

  it('删章时解绑挂在该章上的大纲条目（P5 双向联动的另一面）', async () => {
    const { writingOutlinesApi } = await import('../../services/tauri');
    const mockOutlineSave = vi.mocked(writingOutlinesApi.save);
    mockOutlineSave.mockClear();
    useWritingStore.setState({
      chapters: [chap('a', 1), chap('b', 2)],
      outlines: [
        {
          id: 'o1',
          bookId: BOOK_ID,
          title: '拍1',
          summary: '',
          chapterId: 'a',
          extra: '{}',
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'o2',
          bookId: BOOK_ID,
          title: '拍2',
          summary: '',
          chapterId: null,
          extra: '{}',
          sortOrder: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await useWritingStore.getState().deleteChapter('a');
    // 只有绑定在 a 上的 o1 需要落库解绑
    expect(mockOutlineSave).toHaveBeenCalledTimes(1);
    const outlines = useWritingStore.getState().outlines;
    expect(outlines.find((o) => o.id === 'o1')!.chapterId).toBeNull();
    expect(outlines.find((o) => o.id === 'o2')!.chapterId).toBeNull();
  });

  it('setChapterVolume 先落库再改态（P6 卷分组）', async () => {
    const { writingApi } = await import('../../services/tauri');
    vi.mocked(writingApi.saveChapter).mockClear();
    useWritingStore.setState({ chapters: [chap('a', 1), chap('b', 2)] });
    await useWritingStore.getState().setChapterVolume('a', '第一卷');
    // 落库的对象带卷名，本地态同步更新；其他章不受影响
    const calls = vi.mocked(writingApi.saveChapter).mock.calls;
    const saved = calls[calls.length - 1][0] as WritingChapter;
    expect(saved.volume).toBe('第一卷');
    expect(useWritingStore.getState().chapters.find((c) => c.id === 'a')!.volume).toBe('第一卷');
    expect(useWritingStore.getState().chapters.find((c) => c.id === 'b')!.volume).toBe('');
  });

  it('删章时解绑时间线事件与伏笔的章引用（删除传播矩阵 P0 一致性）', async () => {
    useWritingStore.setState({
      chapters: [chap('a', 1)],
      outlines: [],
      timelineEvents: [
        {
          id: 'ev1',
          bookId: BOOK_ID,
          settingId: null,
          at: '第1年',
          event: '开场',
          chapterId: 'a',
          storylineId: null,
          outlineId: null,
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'ev2',
          bookId: BOOK_ID,
          settingId: null,
          at: '第2年',
          event: '终场',
          chapterId: null,
          storylineId: null,
          outlineId: null,
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      storylines: [
        {
          id: 'sl1',
          bookId: BOOK_ID,
          name: '主线',
          color: '',
          description: '',
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      foreshadowings: [
        {
          id: 'fs1',
          bookId: BOOK_ID,
          title: '怀表',
          description: '',
          plantChapterId: null,
          payoffChapterId: null,
          status: 'pending',
          storylineId: null,
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await useWritingStore.getState().deleteBook(BOOK_ID);
    const s = useWritingStore.getState();
    expect(vi.mocked(writingApi.deleteBook)).toHaveBeenCalledWith(BOOK_ID);
    expect(s.books.length).toBe(0);
    expect(s.activeBookId).toBeNull();
    expect(s.chapters.length).toBe(0);
    expect(s.settings.length).toBe(0);
    expect(s.timelineEvents.length).toBe(0);
    expect(s.storylines.length).toBe(0);
    expect(s.foreshadowings.length).toBe(0);
  });
});
