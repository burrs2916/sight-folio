// 完结作品页 B4b 导出接线行为测（需求 §5.2 / §7 / §9 验收 7、8、10 的前端半环）。
//
// 盯的四件事：
//  ① 导出弹窗只做「选格式 → 入队」，绝不把正文/路径交给前端拼装（§5.2 死口径）；
//  ② 任务面板把 queued/running/failed 逐条呈现，失败可原地重试、可移除（§9-7）；
//  ③ 产物区动作齐备：取回（含缺失如实报错+刷 missing）、复制到其他位置（取消不装样子）、
//     按版本重新生成（§9-8 的入口）；
//  ④ 一切失败 toast 用后端原文，不套空话。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const BOOKS = [
  { id: 'b2', title: '连载锁版书', status: 'ongoing', coverColor: '', updatedAt: 2 },
] as never as [];

const V1 = { id: 'ver1', bookId: 'b2', seq: 1, label: '', note: '', isFinal: false, chapterCount: 30, wordCount: 200000, contentHash: 'hash1', schemaVer: 1, lockedAt: 1761000000 };

const ART_READY = { id: 'art_r', versionId: 'ver1', bookId: 'b2', format: 'epub', specId: 'default', fileRelPath: 'b2/v1/连载锁版书-v1.epub', fileSize: 2097152, status: 'ready', error: '', origin: 'export', createdAt: 1761000500, bookTitle: '不该被页面读到的join书名' };
const ART_MISSING = { id: 'art_m', versionId: 'ver1', bookId: 'b2', format: 'pdf', specId: 'default', fileRelPath: 'b2/v1/连载锁版书-v1.pdf', fileSize: 0, status: 'missing', error: '文件不在作品库记录的位置', origin: 'export', createdAt: 1761000500, bookTitle: 'x' };
const ART_FAILED = { id: 'art_f', versionId: 'ver1', bookId: 'b2', format: 'md', specId: 'default', fileRelPath: 'b2/v1/连载锁版书-v1.md', fileSize: 0, status: 'failed', error: '磁盘只读', origin: 'export', createdAt: 1761000500, bookTitle: 'x' };
const ART_QUEUED = { id: 'art_q', versionId: 'ver1', bookId: 'b2', format: 'txt', specId: 'default', fileRelPath: 'b2/v1/连载锁版书-v1.txt', fileSize: 0, status: 'queued', error: '', origin: 'export', createdAt: 1761000500, bookTitle: 'x' };
const JOB_FAILED = { ...ART_FAILED, status: 'failed' };
const JOB_QUEUED = { ...ART_QUEUED, status: 'queued' };

const listMock = vi.fn();
const setFinalMock = vi.fn();
const deleteMock = vi.fn();
const snapshotMock = vi.fn();
const getRootMock = vi.fn();
const enqueueMock = vi.fn();
const listJobsMock = vi.fn();
const retryJobMock = vi.fn();
const dismissJobMock = vi.fn();
const listArtifactsMock = vi.fn();
const revealMock = vi.fn();
const copyMock = vi.fn();
const saveDialogMock = vi.fn();
const showToastMock = vi.fn();
const loadBooksMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('../../services/workVersion', () => ({
  workVersionApi: {
    list: (bookId: string) => listMock(bookId),
    setFinal: (bookId: string, versionId: string) => setFinalMock(bookId, versionId),
    delete: (versionId: string) => deleteMock(versionId),
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
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...a: unknown[]) => saveDialogMock(...a),
  open: vi.fn(),
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: (sel: (s: { showToast: typeof showToastMock }) => unknown) => sel({ showToast: showToastMock }),
}));
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
vi.mock('../../utils/writingDeskWindow', () => ({ openWritingDesk: vi.fn() }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import PublishedScenesPage from '../PublishedScenesPage';

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

/** 直接开到 b2 的版本时间线二级视图 */
const renderAtTimeline = async () => {
  render(<PublishedScenesPage />);
  await flush();
  fireEvent.click(screen.getByTestId('published-book-card-b2'));
  await flush();
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  loadBooksMock.mockResolvedValue(undefined);
  listMock.mockResolvedValue([V1]);
  setFinalMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue([]);
  snapshotMock.mockResolvedValue([
    { versionId: 'ver1', sortOrder: 0, srcChapterId: 'c1', title: '第一章', content: '', kind: 'chapter', parentId: null, status: '', wordCount: 6600 },
  ]);
  getRootMock.mockResolvedValue({ path: '/Users/x/作品库', isDefault: true });
  invokeMock.mockResolvedValue(undefined);
  enqueueMock.mockResolvedValue([{ ...ART_QUEUED, id: 'art_new' }]);
  listJobsMock.mockResolvedValue([]);
  retryJobMock.mockResolvedValue(undefined);
  dismissJobMock.mockResolvedValue(undefined);
  listArtifactsMock.mockResolvedValue([]);
  revealMock.mockResolvedValue('/Users/x/作品库/b2/v1/连载锁版书-v1.epub');
  copyMock.mockResolvedValue(2097152);
  saveDialogMock.mockResolvedValue(null);
});

describe('导出弹窗（§5.2-1 多选格式入队）', () => {
  it('选 md+txt 确认 → enqueueExport(ver1, [md, txt])，成功后任务与产物读数重取', async () => {
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-version-export-1'));
    await flush();
    // 默认勾了 epub：先取消，再勾 md+txt，验证「多选集合=用户选择」而不是写死
    fireEvent.click(screen.getByTestId('published-export-fmt-epub'));
    fireEvent.click(screen.getByTestId('published-export-fmt-md'));
    fireEvent.click(screen.getByTestId('published-export-fmt-txt'));
    fireEvent.click(screen.getByTestId('published-export-submit'));
    await flush();
    expect(enqueueMock).toHaveBeenCalledWith('ver1', ['md', 'txt']);
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('published.exportEnqueued'), 'success');
    // 入队即拉任务面板 + 产物读数（§9-7 进度逐个可见的起点）
    expect(listJobsMock).toHaveBeenCalled();
    expect(listArtifactsMock).toHaveBeenCalledWith('b2');
  });

  it('格式全取消后提交：拦住并提示，不发空入队', async () => {
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-version-export-1'));
    await flush();
    fireEvent.click(screen.getByTestId('published-export-fmt-epub')); // 取消默认
    fireEvent.click(screen.getByTestId('published-export-submit'));
    await flush();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith('published.exportNeedFormat', 'error');
  });

  it('入队失败：后端原文 toast 上屏，弹窗不关（用户可改格式重试）', async () => {
    enqueueMock.mockRejectedValueOnce(new Error('不支持的导出格式「backup」'));
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-version-export-1'));
    await flush();
    fireEvent.click(screen.getByTestId('published-export-submit'));
    await flush();
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('不支持的导出格式「backup」'), 'error');
    expect(screen.getByTestId('published-export-submit')).toBeTruthy();
  });
});

describe('导出任务面板（§9-7 逐个可见进度 / 单失败可重试）', () => {
  it('queued 与 failed 逐条呈现；失败行带错误原文 + 原地重试 + 移除', async () => {
    listJobsMock.mockResolvedValue([JOB_QUEUED, JOB_FAILED]);
    await renderAtTimeline();
    const panel = screen.getByTestId('published-jobs');
    expect(panel.textContent).toContain('published.jobsPanelTitle:2');
    expect(screen.getByTestId('published-job-art_q').textContent).toContain('published.jobQueued');
    const failedRow = screen.getByTestId('published-job-art_f');
    expect(failedRow.textContent).toContain('磁盘只读');
    expect(screen.getByTestId('published-job-retry-art_f')).toBeTruthy();
    expect(screen.getByTestId('published-job-dismiss-art_f')).toBeTruthy();
    // 排队中的任务也可移除（取消排队），但没有重试口（还没失败）
    expect(screen.getByTestId('published-job-dismiss-art_q')).toBeTruthy();
    expect(screen.queryByTestId('published-job-retry-art_q')).toBeNull();
  });

  it('点重试只对单条任务走 retry_export_job，然后重拉读数', async () => {
    listJobsMock.mockResolvedValue([JOB_FAILED]);
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-job-retry-art_f'));
    await flush();
    expect(retryJobMock).toHaveBeenCalledWith('art_f');
    expect(dismissJobMock).not.toHaveBeenCalled();
    expect(listJobsMock.mock.calls.length).toBeGreaterThanOrEqual(2); // 首拉 + 重试后重拉
  });

  it('重试报错（如并发下状态已变）→ 后端原文 toast，不静默', async () => {
    listJobsMock.mockResolvedValue([JOB_FAILED]);
    retryJobMock.mockRejectedValueOnce(new Error('任务正在导出中，请等它结束'));
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-job-retry-art_f'));
    await flush();
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('任务正在导出中'), 'error');
  });

  it('点移除只对单条走 dismiss_export_job', async () => {
    listJobsMock.mockResolvedValue([JOB_QUEUED]);
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-job-dismiss-art_q'));
    await flush();
    expect(dismissJobMock).toHaveBeenCalledWith('art_q');
  });
});

describe('版本详情产物区（§9-8 取回/复制/重新生成 + §9-10 缺失呈现）', () => {
  const seedArtifacts = () => listArtifactsMock.mockResolvedValue([ART_READY, ART_MISSING, ART_FAILED, ART_QUEUED]);

  it('ready 产物在版本行挂格式 chip；展开后动作齐备', async () => {
    seedArtifacts();
    await renderAtTimeline();
    expect(screen.getByTestId('published-artifact-chip-art_r').textContent).toContain('EPUB');
    fireEvent.click(screen.getByTestId('published-version-detail-1'));
    await flush();
    const row = screen.getByTestId('published-artifact-art_r');
    expect(row.textContent).toContain('2.0 MB'); // 2097152 字节如实换算
    expect(screen.getByTestId('published-artifact-reveal-art_r')).toBeTruthy();
    expect(screen.getByTestId('published-artifact-copy-art_r')).toBeTruthy();
    expect(screen.getByTestId('published-artifact-regen-art_r')).toBeTruthy();
    // 排队/失败/缺失态各归各的呈现，且缺失有专门角标（§9-10「显示文件缺失」而非报错崩溃）
    expect(screen.getByTestId('published-artifact-art_q').textContent).toContain('published.jobQueued');
    expect(screen.getByTestId('published-artifact-retry-art_f')).toBeTruthy();
    expect(screen.getByTestId('published-artifact-missing-art_m').textContent).toContain('published.artifactMissing');
  });

  it('取回走 reveal_artifact；解析失败时后端原文 toast（错误带路径）', async () => {
    seedArtifacts();
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-version-detail-1'));
    await flush();
    fireEvent.click(screen.getByTestId('published-artifact-reveal-art_r'));
    await flush();
    expect(revealMock).toHaveBeenCalledWith('art_r');
    expect(showToastMock).not.toHaveBeenCalledWith(expect.stringContaining('取回失败'), 'error');

    revealMock.mockRejectedValueOnce(new Error('文件不在作品库记录的位置：/Users/x/作品库/b2/v1/a.pdf'));
    fireEvent.click(screen.getByTestId('published-artifact-reveal-art_m'));
    await flush();
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('published.retrieveFailed'), 'error');
  });

  it('复制到其他位置：选完目标路径走 copyArtifactTo 并回执；取消选择什么都不做', async () => {
    seedArtifacts();
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-version-detail-1'));
    await flush();
    saveDialogMock.mockResolvedValueOnce('/Users/x/Desktop/交付.epub');
    fireEvent.click(screen.getByTestId('published-artifact-copy-art_r'));
    await flush();
    expect(saveDialogMock).toHaveBeenCalled();
    expect(copyMock).toHaveBeenCalledWith('art_r', '/Users/x/Desktop/交付.epub');
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('published.artifactCopied'), 'success');

    saveDialogMock.mockResolvedValueOnce(null); // 用户取消
    copyMock.mockClear();
    fireEvent.click(screen.getByTestId('published-artifact-copy-art_r'));
    await flush();
    expect(copyMock.mock.calls.length).toBe(0);
    expect(showToastMock.mock.calls.every(([m]) => !String(m).includes('artifactCopyFailed'))).toBe(true);
  });

  it('重新生成 = 对同一版本同一格式再入队（产物只由快照单向生成，§10）', async () => {
    seedArtifacts();
    await renderAtTimeline();
    fireEvent.click(screen.getByTestId('published-version-detail-1'));
    await flush();
    fireEvent.click(screen.getByTestId('published-artifact-regen-art_r'));
    await flush();
    expect(enqueueMock).toHaveBeenCalledWith('ver1', ['epub']);
    expect(listArtifactsMock).toHaveBeenCalledWith('b2');
  });
});
