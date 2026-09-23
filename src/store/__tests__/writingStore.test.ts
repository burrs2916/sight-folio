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
          sortOrder: 2,
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
          plantChapterId: 'a',
          payoffChapterId: 'a',
          status: 'pending',
          storylineId: null,
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'fs2',
          bookId: BOOK_ID,
          title: '无关联',
          description: '',
          plantChapterId: null,
          payoffChapterId: null,
          status: 'pending',
          storylineId: null,
          sortOrder: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await useWritingStore.getState().deleteChapter('a');
    const s = useWritingStore.getState();
    // 引用解绑：事件与伏笔的章引用全部回到 null
    expect(s.timelineEvents.find((e) => e.id === 'ev1')!.chapterId).toBeNull();
    expect(s.foreshadowings.find((f) => f.id === 'fs1')!.plantChapterId).toBeNull();
    expect(s.foreshadowings.find((f) => f.id === 'fs1')!.payoffChapterId).toBeNull();
    // 内容保留（零强制）：事件与伏笔都还在，未绑定项不受影响
    expect(s.timelineEvents.length).toBe(2);
    expect(s.foreshadowings.length).toBe(2);
    expect(s.timelineEvents.find((e) => e.id === 'ev2')!.chapterId).toBeNull();
  });

  it('删设定时解绑时间线事件的设定引用，事件保留（删除传播矩阵 P0 一致性）', async () => {
    const { writingSettingsApi } = await import('../../services/tauri');
    vi.mocked(writingSettingsApi.delete).mockClear();
    useWritingStore.setState({
      settings: [
        {
          id: 'set1',
          bookId: BOOK_ID,
          kind: 'character',
          name: '阿强',
          subtitle: '',
          description: '',
          extra: '{}',
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeSettingId: 'set1',
      timelineEvents: [
        {
          id: 'ev1',
          bookId: BOOK_ID,
          settingId: 'set1',
          at: '第1年',
          event: '出场',
          chapterId: null,
          storylineId: null,
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'ev2',
          bookId: BOOK_ID,
          settingId: null,
          at: '第2年',
          event: '书级',
          chapterId: null,
          storylineId: null,
          sortOrder: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await useWritingStore.getState().deleteSetting('set1');
    const s = useWritingStore.getState();
    expect(vi.mocked(writingSettingsApi.delete)).toHaveBeenCalledWith('set1');
    expect(s.settings.length).toBe(0);
    expect(s.activeSettingId).toBeNull();
    // 事件保留，挂卡事件回到「书级」
    expect(s.timelineEvents.length).toBe(2);
    expect(s.timelineEvents.find((e) => e.id === 'ev1')!.settingId).toBeNull();
  });

  it('删当前书时清空全部子域内存态（删除传播矩阵 P0 一致性）', async () => {
    const { writingApi } = await import('../../services/tauri');
    vi.mocked(writingApi.deleteBook).mockClear();
    useWritingStore.setState({
      books: [
        {
          id: BOOK_ID,
          title: '长夜',
          description: null,
          genre: 'novel',
          medium: 'serial',
          status: 'draft',
          coverColor: '#4A338F',
          dailyGoal: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeBookId: BOOK_ID,
      activeChapterId: 'a',
      chapters: [chap('a', 1)],
      settings: [
        {
          id: 'set1',
          bookId: BOOK_ID,
          kind: 'character',
          name: '阿强',
          subtitle: '',
          description: '',
          extra: '{}',
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      outlines: [],
      timelineEvents: [
        {
          id: 'ev1',
          bookId: BOOK_ID,
          settingId: null,
          at: '第1年',
          event: '开场',
          chapterId: null,
          storylineId: null,
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
