// 完结作品页 B5a 行为测（需求 §7 / §9 验收 1 / R1）。
//
// 与结构锁（PublishedFinishedBooksLink.test.ts）的分工：结构锁管「依赖不回流」，
// 本测管「用户点得到」——已标完结无版本的书成卡、点卡进时间线、设/换定稿走后端、
// 删除必须过二次确认、快照详情按需加载、作品库读数失败如实上屏。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const BOOKS = [
  { id: 'b1', title: '已完结无版的书', status: 'finished', coverColor: '#123456', updatedAt: 1 },
  { id: 'b2', title: '连载中已锁版的书', status: 'ongoing', coverColor: '', updatedAt: 2 },
  { id: 'b3', title: '连载中没锁版', status: 'ongoing', coverColor: '', updatedAt: 3 },
] as never as [];

const V3 = { id: 'ver3', bookId: 'b2', seq: 3, label: '交稿版', note: '补了三章', isFinal: true, chapterCount: 40, wordCount: 300000, contentHash: 'hash3', schemaVer: 1, lockedAt: 1762000000 };
const V1 = { id: 'ver1', bookId: 'b2', seq: 1, label: '', note: '', isFinal: false, chapterCount: 30, wordCount: 200000, contentHash: 'hash1', schemaVer: 1, lockedAt: 1761000000 };

const listMock = vi.fn();
const setFinalMock = vi.fn();
const deleteMock = vi.fn();
const snapshotMock = vi.fn();
const getRootMock = vi.fn();
const openDeskMock = vi.fn();
const invokeMock = vi.fn();
const showToastMock = vi.fn();
const loadBooksMock = vi.fn();

vi.mock('../../services/workVersion', () => ({
  workVersionApi: {
    list: (bookId: string) => listMock(bookId),
    setFinal: (bookId: string, versionId: string) => setFinalMock(bookId, versionId),
    delete: (versionId: string) => deleteMock(versionId),
    snapshot: (versionId: string) => snapshotMock(versionId),
    getLibraryRoot: () => getRootMock(),
  },
  SAME_CONTENT_ERROR_MARK: 'SAME_CONTENT|',
}));
vi.mock('../../services/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('../../store/toastStore', () => ({
  useToastStore: (sel: (s: { showToast: typeof showToastMock }) => unknown) => sel({ showToast: showToastMock }),
}));
// 工厂里不许在模块初始化期摸顶层常量（vi.mock 会提升，BOOKS 还在 TDZ）：全部 call-time 取
vi.mock('../../store/writingStore', () => {
  const getState = () => ({ books: BOOKS, loadBooks: loadBooksMock });
  const use = (sel: (s: ReturnType<typeof getState>) => unknown) => sel(getState());
  Object.assign(use, { getState });
  return { useWritingStore: use };
});
vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
  getLang: () => 'zh-CN',
}));
vi.mock('../../utils/writingDeskWindow', () => ({ openWritingDesk: (o: unknown) => openDeskMock(o) }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import PublishedScenesPage from '../PublishedScenesPage';

/** 页面挂载走宏任务 + 多级 await（loadBooks → list → setState），给足拍子 */
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

const renderPage = async () => {
  render(<PublishedScenesPage />);
  await flush();
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  loadBooksMock.mockResolvedValue(undefined);
  listMock.mockImplementation(async (bookId: string) => (bookId === 'b2' ? [V3, V1] : []));
  setFinalMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue([]);
  snapshotMock.mockResolvedValue([
    { versionId: 'ver1', sortOrder: 0, srcChapterId: 'c1', title: '第一章', content: '', kind: 'chapter', parentId: null, status: '', wordCount: 6600 },
  ]);
  getRootMock.mockResolvedValue({ path: '/Users/x/Documents/SightFolio 作品库', isDefault: true });
  openDeskMock.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue(undefined);
});

describe('一级：书卡片（R1 / §9 验收 1）', () => {
  it('已标完结、0 版本的书成卡可见，并给「去写作台锁定一版」出口', async () => {
    await renderPage();
    const card = screen.getByTestId('published-book-card-b1');
    expect(card.textContent).toContain('published.noVersionYet');
    fireEvent.click(screen.getByTestId('published-card-lock-b1'));
    expect(openDeskMock).toHaveBeenCalledWith({ bookId: 'b1' });
  });

  it('未完结且没锁过版的书不出现（页面不是书架）', async () => {
    await renderPage();
    expect(screen.queryByTestId('published-book-card-b3')).toBeNull();
  });

  it('连载中但已锁版本的书同样成卡：显示最新 vN、定稿标记与版本数', async () => {
    await renderPage();
    const card = screen.getByTestId('published-book-card-b2');
    expect(card.textContent).toContain('published.latestVersionN:3');
    expect(card.textContent).toContain('published.finalTag');
    expect(card.textContent).toContain('published.versionCountN:2');
  });

  it('书名从书目现取：改名后刷新即刻换新名（不存副本，§9 验收 9 的前端口径）', async () => {
    await renderPage();
    expect(screen.getByTestId('published-book-card-b2').textContent).toContain('连载中已锁版的书');
    (BOOKS as Array<{ title: string }>)[1].title = '改名的书';
    // 走页面自己的刷新入口重读，而不是伪造第二次挂载
    fireEvent.click(screen.getByTestId('published-refresh'));
    await flush();
    expect(screen.getByTestId('published-book-card-b2').textContent).toContain('改名的书');
    (BOOKS as Array<{ title: string }>)[1].title = '连载中已锁版的书'; // 复位，别污染其他用例
  });
});

describe('二级：版本时间线', () => {
  it('点卡进时间线：v3 标当前定稿，v1 给「设为定稿」；导出钮 disabled', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b2'));
    await flush();
    expect(screen.getByTestId('published-version-3').textContent).toContain('published.alreadyFinal');
    expect(screen.getByTestId('published-version-setfinal-1')).toBeTruthy();
    expect((screen.getByTestId('published-version-export-3') as HTMLButtonElement).disabled).toBe(true);
  });

  it('设为定稿走后端并刷回读数（同书至多一个定稿由后端事务保证，D6）', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b2'));
    await flush();
    fireEvent.click(screen.getByTestId('published-version-setfinal-1'));
    await flush();
    expect(setFinalMock).toHaveBeenCalledWith('b2', 'ver1');
    expect(listMock).toHaveBeenCalledWith('b2');
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('published.setFinalDone'), 'success');
  });

  it('删除版本必须经二次确认弹窗，确认后走后端并刷新', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b2'));
    await flush();
    fireEvent.click(screen.getByTestId('published-version-delete-3'));
    expect(deleteMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('published-delete-confirm'));
    await flush();
    expect(deleteMock).toHaveBeenCalledWith('ver3');
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('published.versionDeleted'), 'success');
  });

  it('展开详情按需拉快照并渲染章节标题与字数', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b2'));
    await flush();
    expect(snapshotMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('published-version-detail-1'));
    await flush();
    expect(snapshotMock).toHaveBeenCalledWith('ver1');
    expect(screen.getByText('第一章')).toBeTruthy();
    expect(screen.getByText('published.fingerprintLabel:hash1')).toBeTruthy();
  });

  it('0 版本的书点进时间线：给空态与锁定出口（不白屏）', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b1'));
    await flush();
    expect(screen.getByTestId('published-l2-lock')).toBeTruthy();
  });
});

describe('作品库根指示（B3 读数进成品页，失败如实上屏）', () => {
  it('读取成功：根路径上屏，点打开走 reveal_in_file_manager', async () => {
    await renderPage();
    expect(screen.getByTestId('published-root-chip').textContent).toContain('/Users/x/Documents/SightFolio 作品库');
    fireEvent.click(screen.getByTestId('published-root-open'));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith('reveal_in_file_manager', { path: '/Users/x/Documents/SightFolio 作品库' });
  });

  it('读取失败：错误原文上屏，不画任何备用路径（§4 禁静默降级）', async () => {
    getRootMock.mockRejectedValueOnce(new Error('无法创建作品库目录 /x：Permission denied'));
    await renderPage();
    expect(screen.getByTestId('published-root-error').textContent).toContain('Permission denied');
    expect(screen.queryByTestId('published-root-chip')).toBeNull();
  });
});
