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
// B4b 导出接线新增的读数/动作面（默认空态，不影响 B5a 既有用例的断言）
const enqueueMock = vi.fn();
const listJobsMock = vi.fn();
const retryJobMock = vi.fn();
const dismissJobMock = vi.fn();
const listArtifactsMock = vi.fn();
const revealMock = vi.fn();
const copyMock = vi.fn();

vi.mock('../../services/workVersion', () => ({
  workVersionApi: {
    list: (bookId: string) => listMock(bookId),
    setFinal: (bookId: string, versionId: string) => setFinalMock(bookId, versionId),
    delete: (versionId: string, deleteFiles: boolean) => deleteMock(versionId, deleteFiles),
    snapshot: (versionId: string) => snapshotMock(versionId),
    getLibraryRoot: () => getRootMock(),
    enqueueExport: (versionId: string, formats: string[]) => enqueueMock(versionId, formats),
    listExportJobs: () => listJobsMock(),
    retryExportJob: (jobId: string) => retryJobMock(jobId),
    dismissExportJob: (jobId: string) => dismissJobMock(jobId),
    listArtifacts: (bookId?: string) => listArtifactsMock(bookId),
    revealArtifact: (artifactId: string) => revealMock(artifactId),
    copyArtifactTo: (artifactId: string, destPath: string) => copyMock(artifactId, destPath),
  },
  SAME_CONTENT_ERROR_MARK: 'SAME_CONTENT|',
}));
vi.mock('../../services/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
// 页面（B4b）引了目录选择器：jsdom 里必须 mock 掉插件本体，「取消选择」用 null 表达
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn().mockResolvedValue(null),
  open: vi.fn().mockResolvedValue(null),
}));
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
  enqueueMock.mockResolvedValue([]);
  listJobsMock.mockResolvedValue([]);
  retryJobMock.mockResolvedValue(undefined);
  dismissJobMock.mockResolvedValue(undefined);
  listArtifactsMock.mockResolvedValue([]);
  revealMock.mockResolvedValue('/Users/x/作品库/b2/v1/书-v1.epub');
  copyMock.mockResolvedValue(2048);
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

  it('搜索与名称排序同样现取书名：改名后新名可搜到、旧名搜不到、排序位次跟变（§9-9）', async () => {
    localStorage.removeItem('published-search-query'); // 初值从 localStorage 读，先清残留
    await renderPage();
    // 两本书都临时改成拉丁开头书名：排序断言只依赖「Alpha < Zeta」的普适拉丁序，
    // 不赌本环境 ICU 的拼音细则与汉拉脚本序（实测汉字与拉丁的相对序随 ICU 版本而变）
    const titles = BOOKS as Array<{ title: string }>;
    titles[1].title = 'Alpha乙';
    titles[0].title = 'Zeta甲';
    fireEvent.click(screen.getByTestId('published-refresh'));
    await flush();
    const search = screen.getByPlaceholderText('published.searchPlaceholder');
    fireEvent.change(search, { target: { value: 'alpha' } });
    expect(screen.queryByTestId('published-book-card-b2')).toBeTruthy();
    expect(screen.queryByTestId('published-book-card-b1')).toBeNull();
    // 旧名不再命中 —— 证明过滤读的是 join 来的现名，不是任何缓存副本
    fireEvent.change(search, { target: { value: '连载中已锁版的书' } });
    expect(screen.queryByTestId('published-book-card-b2')).toBeNull();
    fireEvent.change(search, { target: { value: '已完结无版的书' } });
    expect(screen.queryByTestId('published-book-card-b1')).toBeNull();
    // 清空搜索 → 切「按名称」排序：Alpha 在前
    // （未开菜单时 published.sortRecent 只存在于展示层 div[role=combobox]：mouseDown 开菜单，点条目落值）
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.mouseDown(screen.getByText('published.sortRecent'));
    fireEvent.click(await screen.findByText('published.sortName'));
    await flush();
    const order = screen.getAllByTestId(/^published-book-card-/).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['published-book-card-b2', 'published-book-card-b1']);
    titles[1].title = '连载中已锁版的书'; // 复位，别污染其他用例
    titles[0].title = '已完结无版的书';
    localStorage.removeItem('published-search-query');
  });
});

describe('二级：版本时间线', () => {
  it('点卡进时间线：v3 标当前定稿，v1 给「设为定稿」；导出钮已接线（点开快照导出弹窗）', async () => {
    // 改判说明（红线 3）：B5a 此条钉的是「导出钮 disabled 占位」（当时流水线未建，UI 不许撒谎）。
    // B4b 就是接线这批 —— 占位断言按产品改判翻转为「可点且点开的是入队弹窗」。
    // 覆盖面没有弱化：disabled 语义由 PublishedFinishedBooksLink 结构锁继续反向盯（不许回流）。
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b2'));
    await flush();
    expect(screen.getByTestId('published-version-3').textContent).toContain('published.alreadyFinal');
    expect(screen.getByTestId('published-version-setfinal-1')).toBeTruthy();
    const exportBtn = screen.getByTestId('published-version-export-3') as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
    fireEvent.click(exportBtn);
    await flush();
    expect(screen.getByTestId('published-export-submit')).toBeTruthy();
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

  it('删除版本必须经二次确认弹窗；无 ready 产物时不给删文件勾选，deleteFiles 恒为 false', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b2'));
    await flush();
    fireEvent.click(screen.getByTestId('published-version-delete-3'));
    expect(deleteMock).not.toHaveBeenCalled();
    // §9-12/§5.3：没有可删的物理产物就不该给勾（默认只断记录不动文件）
    expect(screen.queryByTestId('published-delete-files-checkbox')).toBeNull();
    fireEvent.click(screen.getByTestId('published-delete-confirm'));
    await flush();
    expect(deleteMock).toHaveBeenCalledWith('ver3', false);
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('published.versionDeleted'), 'success');
  });

  it('版本有 ready 产物时给「同时删除产物文件」勾选：默认不勾传 false，勾上才传 true（§9-12）', async () => {
    listArtifactsMock.mockResolvedValue([
      {
        id: 'art_1', versionId: 'ver3', bookId: 'b2', format: 'epub', specId: 'default',
        fileRelPath: 'b2/v3/书-v3.epub', fileSize: 2048, status: 'ready', error: '', origin: 'export', createdAt: 1,
        bookTitle: '连载中已锁版的书',
      },
    ]);
    await renderPage();
    fireEvent.click(screen.getByTestId('published-book-card-b2'));
    await flush();
    fireEvent.click(screen.getByTestId('published-version-delete-3'));
    const checkbox = screen.getByTestId('published-delete-files-checkbox');
    expect(checkbox.textContent).toContain('published.deleteFilesWithVersion:1');
    // 默认不勾 —— 「显式勾选」是本条验收的全部重量，默认值必须落在只断记录一侧
    fireEvent.click(screen.getByTestId('published-delete-confirm'));
    await flush();
    expect(deleteMock).toHaveBeenCalledWith('ver3', false);

    // 二次打开重新归零后勾选 → deleteFiles=true 上送
    fireEvent.click(screen.getByTestId('published-version-delete-3'));
    const box = screen.getByTestId('published-delete-files-checkbox').querySelector('input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByTestId('published-delete-confirm'));
    await flush();
    expect(deleteMock).toHaveBeenLastCalledWith('ver3', true);
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
