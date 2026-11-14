// ㉱ E-A′（2026-11-11）：完结作品页的单位词跟着书的体裁走。
//
// 两层各钉各的（AU-7 ⑨：跨层传词必须有真渲染断言兜底）：
//  ① 模板渲染套：i18n 真实模板 × 单位词表 → 最终读数。小说支与改造前的旧串**逐字**钉死；
//  ② 真渲染接线套：mock 的 t 按**真实模板插值**（不是拼参数值 —— 只拼值会被
//     「换键不换值」糊弄，模板与 key 函数都错了还会互相抵消），诗集页面上读到的就是
//     「12首 · 20.0万字」「快照诗作（1）」；旧书（genre 空）逐字零回归。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import zhMessages from '../../i18n/zh-CN.json';
import enMessages from '../../i18n/en-US.json';
import { unitCountKey, unitNameCountKey } from '../../utils/writingSchema';

// ── 共用插值（与 i18next 的 {{var}}→{var} 单花括号语法同形：本页 JSON 用 {var}）─
type Dict = Record<string, unknown>;
const pick = (dict: Dict, keyPath: string): unknown =>
  keyPath.split('.').reduce<unknown>((o, k) => (o as Dict)?.[k], dict);
const interpolate = (tpl: unknown, params: Record<string, string | number>): string =>
  String(tpl).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));

const MESSAGES: { dict: Dict; lang: string } = { dict: zhMessages, lang: 'zh-CN' };
vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    const tpl = pick(MESSAGES.dict, key);
    if (tpl === undefined) return key; // 与现网回落同形：缺键吐 key 本身
    return params ? interpolate(tpl, params as Record<string, string | number>) : String(tpl);
  },
  getLang: () => 'zh-CN',
}));

// ── 页面其余依赖：形状抄 publishedExportFlow.test.tsx 的在册 harness ──
const BOOK_POETRY = { id: 'bp', title: '诗集', genre: 'poetry', status: 'finished', coverColor: '', updatedAt: 2 };
const BOOK_LEGACY = { id: 'bn', title: '旧书', genre: '', status: 'finished', coverColor: '', updatedAt: 2 };
const V1 = {
  id: 'ver1', bookId: 'bp', seq: 1, label: '', note: '', isFinal: false,
  chapterCount: 12, wordCount: 200000, contentHash: 'h', schemaVer: 3, lockedAt: 1761000000,
};

let currentBooks: unknown[] = [BOOK_POETRY];
const snapshotMock = vi.fn();
const loadBooksMock = vi.fn();

vi.mock('../../services/workVersion', () => ({
  workVersionApi: {
    list: () => Promise.resolve([V1]),
    setFinal: vi.fn(),
    delete: vi.fn(),
    snapshot: (versionId: string) => snapshotMock(versionId),
    getLibraryRoot: () => Promise.resolve({ path: '/tmp/works', isDefault: true }),
    enqueueExport: vi.fn(),
    listExportJobs: () => Promise.resolve([]),
    retryExportJob: vi.fn(),
    dismissExportJob: vi.fn(),
    listArtifacts: () => Promise.resolve([]),
    revealArtifact: vi.fn(),
    copyArtifactTo: vi.fn(),
  },
  SAME_CONTENT_ERROR_MARK: 'SAME_CONTENT|',
}));
vi.mock('../../services/core', () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('../../store/toastStore', () => ({
  useToastStore: (sel: (s: { showToast: (m: string, k?: string) => void }) => unknown) =>
    sel({ showToast: () => {} }),
}));
vi.mock('../../store/writingStore', () => {
  const getState = () => ({ books: currentBooks, loadBooks: loadBooksMock });
  const use = (sel: (s: ReturnType<typeof getState>) => unknown) => sel(getState());
  Object.assign(use, { getState });
  return { useWritingStore: use };
});
vi.mock('../../utils/writingDeskWindow', () => ({ openWritingDesk: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import PublishedScenesPage from '../PublishedScenesPage';

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  loadBooksMock.mockResolvedValue(undefined);
  snapshotMock.mockResolvedValue([
    {
      versionId: 'ver1', sortOrder: 0, srcChapterId: 'c1', title: '第 1 首',
      content: '', kind: '首', parentId: null, status: '', wordCount: 60,
    },
  ]);
});

// ══════ ① 模板渲染（不挂页面，逐字钉最终读数）══════
describe('㉱ published 单位词：模板 × 表 → 最终读数', () => {
  const zh = (g: string) => String(pick(zhMessages, unitCountKey(g)));
  const nameZh = (g: string) => String(pick(zhMessages, unitNameCountKey(g)));
  const pluralEn = (g: string) => String(pick(enMessages, unitCountKey(g)));
  const nameEn = (g: string) => String(pick(enMessages, unitNameCountKey(g)));

  it('中文计数行：诗集「首」/剧本「场」/日记「篇」（量词表口径）', () => {
    const tpl = zhMessages.published.chaptersWords;
    expect(interpolate(tpl, { chapters: 12, words: '3.0万字', unit: zh('poetry') })).toBe('12首 · 3.0万字');
    expect(interpolate(tpl, { chapters: 40, words: '6.0万字', unit: zh('script') })).toBe('40场 · 6.0万字');
    expect(interpolate(tpl, { chapters: 365, words: '30.0万字', unit: zh('diary') })).toBe('365篇 · 30.0万字');
  });

  it('中文计数行零回归：小说与旧书逐字 = 改造前旧串（模板旧值「{chapters}章」的渲染形）', () => {
    const out = interpolate(zhMessages.published.chaptersWords, { chapters: 30, words: '20.0万字', unit: zh('') });
    expect(out).toBe('30章 · 20.0万字');
    expect(out).toBe(interpolate('{chapters}章 · {words}', { chapters: 30, words: '20.0万字' }));
  });

  it('英文计数行：复数单位名（poems/entries），小说逐字旧句', () => {
    expect(interpolate(enMessages.published.chaptersWords, { chapters: 12, words: '200.0k words', unit: pluralEn('poetry') })).toBe('12 poems · 200.0k words');
    expect(interpolate(enMessages.published.chaptersWords, { chapters: 365, words: '300.0k words', unit: pluralEn('diary') })).toBe('365 entries · 300.0k words');
    expect(interpolate(enMessages.published.chaptersWords, { chapters: 30, words: '200.0k words', unit: pluralEn('novel') })).toBe('30 chapters · 200.0k words');
  });

  it('快照标题：中文吃双字单位名；英文吃复数 —— 小说两侧逐字 = 旧句', () => {
    expect(interpolate(zhMessages.published.snapshotChapters, { n: 12, unitName: nameZh('poetry') })).toBe('快照诗作（12）');
    expect(interpolate(zhMessages.published.snapshotChapters, { n: 30, unitName: nameZh('') })).toBe('快照章节（30）');
    expect(interpolate(enMessages.published.snapshotChapters, { n: 12, unitName: nameEn('poetry') })).toBe('Snapshot poems (12)');
    expect(interpolate(enMessages.published.snapshotChapters, { n: 30, unitName: nameEn('novel') })).toBe('Snapshot chapters (30)');
  });
});

// ══════ ② 真渲染接线（整页挂载 → 版本行/快照标题读到最终读数）══════
describe('㉱ E-A′ 真渲染：单位词跟着书的体裁走', () => {
  it('诗集：版本行读「12首 · 20.0万字」，展开快照读「快照诗作（1）」', async () => {
    currentBooks = [BOOK_POETRY];
    render(<PublishedScenesPage />);
    await flush();
    fireEvent.click(screen.getByTestId('published-book-card-bp'));
    await flush();
    const row = await screen.findByTestId('published-version-seq-1');
    expect(row.parentElement?.textContent).toContain('12首 · 20.0万字');
    fireEvent.click(screen.getByTestId('published-version-detail-1'));
    await flush();
    expect(await screen.findByText('快照诗作（1）')).toBeTruthy();
  });

  it('旧书（genre 空 = 小说口径）：逐字零回归「12章 · 20.0万字」「快照章节（1）」', async () => {
    currentBooks = [BOOK_LEGACY];
    render(<PublishedScenesPage />);
    await flush();
    fireEvent.click(screen.getByTestId('published-book-card-bn'));
    await flush();
    const row = await screen.findByTestId('published-version-seq-1');
    expect(row.parentElement?.textContent).toContain('12章 · 20.0万字');
    fireEvent.click(screen.getByTestId('published-version-detail-1'));
    await flush();
    expect(await screen.findByText('快照章节（1）')).toBeTruthy();
  });
});
