// 旧「完结作品登记链」退役行为测（完结作品重设计 · B6a，需求 §6 / §2 / §9-11）。
//
// 钉住三条可证伪的行为契约：
// 1. 写作台「另存为」式导出成功后**不再有任何登记写库**（旧 save_completed_work 链清零）；
//    登记面误引用会因 mock 缺口直接炸红（barrel mock 里刻意不提供 completedWorksApi）。
// 2. 备份成功回执是普通 info toast，**不带「查看完结作品」跳转**（备份已移出作品体系，
//    成品页里没有它 —— UI 不撒谎）。
// 3. 徽标 ExportCountBadge 的数据源是 workVersionApi.exportCount（后端按 export_artifacts
//    的 ready 产物计数）：有数才渲染、0 不渲染、失败静默。
import { StrictMode, useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const showToastMock = vi.fn();
const infoMock = vi.fn();
const successMock = vi.fn();
const errorMock = vi.fn();
const saveDialogMock = vi.fn();
const openDialogMock = vi.fn();
const saveTextFileMock = vi.fn();
const backupWritingBookMock = vi.fn();
const exportCountMock = vi.fn();

vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../store/toastStore', () => ({
  useToastStore: {
    getState: () => ({ showToast: showToastMock, info: infoMock, success: successMock, error: errorMock }),
  },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../store/writingStore', () => ({
  useWritingStore: { getState: () => ({ chapters: [] }) },
}));
// 导出动作的 Tauri 出口：只给「现役」能力。旧登记面 completedWorksApi 刻意缺席 ——
// 任何误引用都会 TypeError 并被 handler 的 catch 吞成 error toast，下面的正向断言随即断掉。
vi.mock('../../../services/tauri', () => ({
  saveTextFile: (...args: unknown[]) => saveTextFileMock(...args),
  saveWritingEpub: vi.fn(),
  saveWritingDocx: vi.fn(),
  saveWritingPdf: vi.fn(),
  backupWritingBook: (...args: unknown[]) => backupWritingBookMock(...args),
  restoreWritingBook: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => saveDialogMock(...args),
  open: (...args: unknown[]) => openDialogMock(...args),
}));
vi.mock('../../../services/asset', () => ({ assetApi: { resolveAssetRef: vi.fn() } }));
vi.mock('../../../services/projectScan', () => ({ projectScanApi: { readFileBytes: vi.fn() } }));
vi.mock('../../../utils/writingOutline', () => ({ parseChapterCover: vi.fn() }));
vi.mock('../turndown', () => ({ turndown: { turndown: (h: string) => h } }));
vi.mock('../../../services/workVersion', () => ({
  workVersionApi: {
    exportCount: (...args: unknown[]) => exportCountMock(...args),
  },
  SAME_CONTENT_ERROR_MARK: 'SAME_CONTENT|',
}));

import { useExportActions } from '../useExportActions';
import { ExportCountBadge } from '../ExportCountBadge';

const ACTIVE_BOOK = { id: 'b1', title: '长夜', description: null };

type Actions = ReturnType<typeof useExportActions>;

/** 把 hook 结果经 effect 写进用例持有的 ref（lint immutability 的官方指引路径）。 */
function Probe({ exposeRef }: { exposeRef: { current: Actions | null } }) {
  const actions = useExportActions(
    ACTIVE_BOOK,
    vi.fn(async () => true),
    vi.fn(async () => true),
    vi.fn(async () => {}),
  );
  useEffect(() => {
    exposeRef.current = actions;
  }, [actions, exposeRef]);
  return null;
}

const makeRef = (): { current: Actions | null } => ({ current: null });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('写作台导出/备份与旧登记表彻底切割（需求 §6 / §9-11）', () => {
  it('备份成功：backup_writing_book 落盘后只给普通 info 回执，不挂「查看完结作品」跳转', async () => {
    saveDialogMock.mockResolvedValueOnce('/tmp/长夜_backup.db');
    backupWritingBookMock.mockResolvedValue(undefined);
    const exposeRef = makeRef();
    act(() => root.render(<StrictMode><Probe exposeRef={exposeRef} /></StrictMode>));

    await act(async () => {
      await exposeRef.current!.handleBackupBook();
    });

    expect(backupWritingBookMock).toHaveBeenCalledWith('/tmp/长夜_backup.db');
    expect(infoMock).toHaveBeenCalledWith('writing.backupExported:{"path":"/tmp/长夜_backup.db"}');
    // 成功路径绝不走 showExportToast（它带跳转 action，会指向没有备份文件的成品页）
    expect(showToastMock).not.toHaveBeenCalled();
    // 也不许有失败 toast（误引用已退役登记面会掉进这个 catch）
    expect(errorMock).not.toHaveBeenCalled();
  });

  it('备份弹窗取消（未选路径）：不落盘、不弹任何回执', async () => {
    saveDialogMock.mockResolvedValueOnce(null);
    const exposeRef = makeRef();
    act(() => root.render(<StrictMode><Probe exposeRef={exposeRef} /></StrictMode>));

    await act(async () => {
      await exposeRef.current!.handleBackupBook();
    });

    expect(backupWritingBookMock).not.toHaveBeenCalled();
    expect(infoMock).not.toHaveBeenCalled();
  });

  it('Markdown 导出成功：写盘 + 带跳转的导出 toast 走 showToast，全程零登记写库', async () => {
    saveDialogMock.mockResolvedValueOnce('/tmp/长夜.md');
    saveTextFileMock.mockResolvedValue(undefined);
    const exposeRef = makeRef();
    act(() => root.render(<StrictMode><Probe exposeRef={exposeRef} /></StrictMode>));

    await act(async () => {
      await exposeRef.current!.handleExportMarkdown();
    });

    expect(saveTextFileMock).toHaveBeenCalledWith('/tmp/长夜.md', expect.stringContaining('# 长夜'));
    // 成功回执 = showExportToast 的 info + 「查看完结作品」action（六格式导出仍导向成品页）
    expect(showToastMock).toHaveBeenCalledWith(
      'writing.exported:{"path":"/tmp/长夜.md"}',
      'info',
      6000,
      { label: 'published.viewWorks', onClick: expect.any(Function) },
    );
    expect(errorMock).not.toHaveBeenCalled();
  });
});

describe('ExportCountBadge 数据源切到 export_artifacts 计数（需求 §6）', () => {
  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('有 ready 产物：按 (bookId, format) 查询并渲染「已有 n 个」', async () => {
    // 用持久实现而非 Once：StrictMode 双挂载会把 Once 队列耗干（第二次 effect 拿 undefined）
    exportCountMock.mockResolvedValue(3);
    act(() => root.render(<StrictMode><ExportCountBadge bookId="b9" format="epub" /></StrictMode>));
    await flushEffects();

    expect(exportCountMock).toHaveBeenCalledWith('b9', 'epub');
    expect(document.body.textContent).toContain('writing.exportedCount:{"n":3}');
  });

  it('计数为 0：徽标不渲染（没导出过就不占位）', async () => {
    exportCountMock.mockResolvedValue(0);
    act(() => root.render(<StrictMode><ExportCountBadge bookId="b9" format="pdf" /></StrictMode>));
    await flushEffects();

    expect(document.body.textContent).toBe('');
  });

  it('查询失败：静默隐藏，不抛不叫（计数是增益信息）', async () => {
    exportCountMock.mockRejectedValue(new Error('boom'));
    act(() => root.render(<StrictMode><ExportCountBadge bookId="b9" format="epub" /></StrictMode>));
    await flushEffects();

    expect(document.body.textContent).toBe('');
  });
});
