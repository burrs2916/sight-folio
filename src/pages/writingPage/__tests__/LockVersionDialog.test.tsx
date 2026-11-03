// 「锁定一版」弹窗行为测试（完结作品重设计 · B2）。
//
// 钉的是这条流程上最容易烂掉的几处契约：
// 1. 必须先 flush 未保存改动、再调 lock —— 顺序反了就会锁到半稿（需求 §5.1 第 1 步）；
// 2. 同指纹冲突走「仍然锁定」出口：第一次不带 force，用户确认后的第二次必须带 force=true；
// 3. 普通失败不许伪装成冲突（否则用户被引导去强锁一个根本不存在的出口）；
// 4. 成功要关窗 + toast 附「去成品页」跳转（D8 的闭环出口）；
// 5. 提交中不许重入（连点会锁出两个同内容版本）。
// flush 链走**真实的** useFreshChapters（只 mock 其底层 store 与 tauri 命令出口），不另造假口径。
import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const lockCalls: Array<{ bookId: string; label: string; note: string; isFinal: boolean; force: boolean }> = [];
let lockImpl: (args: (typeof lockCalls)[number]) => Promise<{ seq: number }> = async () => ({ seq: 7 });
const navigateMock = vi.fn();
const showToastMock = vi.fn();

vi.mock('../../../services/workVersion', () => ({
  SAME_CONTENT_ERROR_MARK: 'SAME_CONTENT|',
  workVersionApi: {
    lock: async (bookId: string, label: string, note: string, isFinal: boolean, force = false) => {
      calls.push('lock');
      const args = { bookId, label, note, isFinal, force };
      lockCalls.push(args);
      return lockImpl(args);
    },
  },
}));
vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ showToast: showToastMock }) },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// 真实 useFreshChapters 的底层：flush 成功后交出 store 里的 chapters
vi.mock('../../../store/writingStore', () => ({
  useWritingStore: { getState: () => ({ chapters: [] }) },
}));
// 挡掉 services/tauri 大 barrel 的模块图（本测不触任何 Tauri 命令，只需 useExportActions 可导入）
vi.mock('../../../services/tauri', () => ({
  saveTextFile: vi.fn(),
  saveWritingEpub: vi.fn(),
  saveWritingDocx: vi.fn(),
  saveWritingPdf: vi.fn(),
  backupWritingBook: vi.fn(),
  restoreWritingBook: vi.fn(),
  // B6：刻意不再提供 completedWorksApi mock —— 若导出链误引用旧登记面，
  // import 会得到 undefined 并在调用处炸红，本文件任何一条测都绿不了（反证锁）。
}));
vi.mock('../../../services/asset', () => ({ assetApi: { resolveAssetRef: vi.fn() } }));
vi.mock('../../../services/projectScan', () => ({ projectScanApi: { readFileBytes: vi.fn() } }));
vi.mock('../../../utils/writingOutline', () => ({ parseChapterCover: vi.fn() }));

import { LockVersionDialog } from '../LockVersionDialog';

const flushSave = vi.fn(async () => {
  calls.push('flushSave');
  return true;
});
const flushSettingSave = vi.fn(async () => {
  calls.push('flushSettingSave');
  return true;
});

let host: HTMLDivElement;
let root: Root;

const render = (onClose = () => {}) => {
  act(() =>
    root.render(
      <StrictMode>
        <LockVersionDialog
          open
          onClose={onClose}
          bookId="b1"
          flushSave={flushSave}
          flushSettingSave={flushSettingSave}
        />
      </StrictMode>,
    ),
  );
};
const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const input = (aria: string) => document.body.querySelector(`input[aria-label="${aria}"]`) as HTMLInputElement;

beforeEach(() => {
  calls.length = 0;
  lockCalls.length = 0;
  lockImpl = async () => ({ seq: 7 });
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('LockVersionDialog 流程契约', () => {
  it('先冲未保存改动再锁定，且表单值 trim 后透传', async () => {
    render();
    await typeInto(input('lock-version-label'), '  交稿版  ');
    await typeInto(document.body.querySelector('textarea[aria-label="lock-version-note"]') as HTMLTextAreaElement, '  改了结尾  ');
    await click(button('writing.lockVersionConfirm')!);

    expect(calls.slice(0, 3), '必须先 flush 再 lock，否则锁到半稿').toEqual(['flushSave', 'flushSettingSave', 'lock']);
    expect(lockCalls[0]).toEqual({ bookId: 'b1', label: '交稿版', note: '改了结尾', isFinal: false, force: false });
  });

  it('勾了定稿开关才传 isFinal=true', async () => {
    render();
    const checkbox = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    await click(button('writing.lockVersionConfirm')!);
    expect(lockCalls[0]!.isFinal).toBe(true);
  });

  it('同指纹冲突 → 出冲突提示与「仍然锁定」出口，确认后第二次带 force=true', async () => {
    lockImpl = async () => {
      throw new Error('Validation error: SAME_CONTENT|内容与 v6 完全一致，没有可锁定的变化。');
    };
    render();
    await click(button('writing.lockVersionConfirm')!);

    expect(text()).toContain('writing.lockVersionConflict');
    expect(lockCalls).toHaveLength(1);
    expect(showToastMock).not.toHaveBeenCalled();

    const anyway = button('writing.lockAnyway');
    expect(anyway, '冲突时必须给「仍然锁定」次级出口').toBeTruthy();
    lockImpl = async () => ({ seq: 8 });
    await click(anyway!);

    expect(lockCalls).toHaveLength(2);
    expect(lockCalls[1]!.force, '「仍然锁定」必须走 force 出口').toBe(true);
    expect(lockCalls[1]!.isFinal).toBe(false);
  });

  it('普通失败不许伪装成冲突：报出原因、不给强锁出口', async () => {
    lockImpl = async () => {
      throw new Error('Database error: disk full');
    };
    render();
    await click(button('writing.lockVersionConfirm')!);

    expect(text()).toContain('writing.lockVersionFailed');
    expect(text()).toContain('Database error: disk full'); // 失败原因如实呈现
    expect(text()).not.toContain('writing.lockVersionConflict');
    expect(button('writing.lockAnyway')).toBeFalsy();
  });

  it('成功 → 关窗 + toast 附「去成品页」跳转（info 档，GlobalToast 过滤 success）', async () => {
    const onClose = vi.fn();
    render(onClose);
    await click(button('writing.lockVersionConfirm')!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const [message, severity, , action] = showToastMock.mock.calls[0]!;
    expect(message).toContain('writing.lockVersionDone');
    expect(message).toContain('"seq":7');
    expect(severity).toBe('info');
    expect(action.label).toBe('published.viewWorks');
    action.onClick();
    expect(navigateMock).toHaveBeenCalledWith('/published');
  });

  it('锁定请求挂起中连点「锁定」不重入（防锁出两个同内容版本）', async () => {
    let release: (v: { seq: number }) => void = () => {};
    lockImpl = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    render();
    await click(button('writing.lockVersionConfirm')!);
    expect(lockCalls).toHaveLength(1);
    await click(button('writing.lockVersionConfirm')!);
    expect(lockCalls).toHaveLength(1);
    await act(async () => {
      release({ seq: 1 });
    });
  });
});

describe('锁定入口与词典锁', () => {
  const ROOT = process.cwd();
  const dialogSrc = readFileSync(`${ROOT}/src/pages/writingPage/LockVersionDialog.tsx`, 'utf8');

  it('写作台工具栏挂了「锁定一版」按钮并开弹窗（结构锁：WritingPage 整页太重，不宜渲染测）', () => {
    const pageSrc = readFileSync(`${ROOT}/src/pages/WritingPage.tsx`, 'utf8');
    expect(pageSrc).toContain("aria-label={t('writing.lockVersion')}");
    expect(pageSrc).toContain('setLockVersionOpen(true)');
    expect(pageSrc).toContain('<LockVersionDialog');
    // 入口只读 activeBook.id 与 flush 句柄，不触碰写作逻辑
    expect(pageSrc).toContain("bookId={activeBook?.id ?? ''}");
  });

  it('组件用到的每个 i18n 键都能在双语词典查到', () => {
    const keys = new Set<string>();
    for (const m of dialogSrc.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
    // 工具栏 Tooltip 键在 WritingPage 里用
    keys.add('writing.lockVersion');
    expect(keys.size).toBeGreaterThanOrEqual(10);
    for (const file of ['zh-CN', 'en-US']) {
      const dict = JSON.parse(readFileSync(`${ROOT}/src/i18n/${file}.json`, 'utf8'));
      for (const k of keys) {
        const hit = k.split('.').reduce<Record<string, unknown> | undefined>(
          (o, seg) => (o?.[seg] !== undefined ? (o[seg] as never) : undefined),
          dict as never,
        );
        expect(hit, `${file}.json 缺键 ${k}（界面会显示裸键）`).toBeTruthy();
      }
    }
  });

  it('案文里的 {param} 占位符不能是代码不会传的', () => {
    const zh = JSON.parse(readFileSync(`${ROOT}/src/i18n/zh-CN.json`, 'utf8')).writing;
    for (const m of dialogSrc.matchAll(/\bt\('([a-zA-Z0-9_.]+)'(?:,\s*\{\s*([^}]*?)\s*\})?/g)) {
      const key = m[1]!.split('.')[1]!;
      const passed = (m[2] ?? '').split(',').map((s) => s.trim().split(':')[0]!.trim()).filter(Boolean);
      const entry = zh[key] as string | undefined;
      if (!entry) continue;
      for (const w of [...entry.matchAll(/\{(\w+)\}/g)].map((x) => x[1])) {
        expect(passed, `${key} 案文用了 {${w}} 但代码没传`).toContain(w);
      }
    }
  });
});
