// 章节快照重命名 · 落库回归锁（批次① 接断线）
//
// 背景：`rename_writing_chapter_snapshot` 后端命令此前根本不存在，对话框 catch 后静默把
// 名字写进 localStorage 并在渲染时合并回来 —— 用户以为改好了，换设备/清缓存即丢。
// 后端现已实现（UPDATE name 单列），这条测试锁死三件事：
// ① 重命名走后端命令，成功后列表显示新名；
// ② 后端失败 → 回滚乐观更新 + 明确提示，且**绝不降级写 localStorage**（防这条退路回潮）；
// ③ 列表拉取失败显示错误 + 重试，不伪装成「还没有快照」。
//
// 注意：MUI Dialog 经 Portal 渲染到 document.body，断言一律查 document.body。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  rename: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../services/tauri', () => ({
  writingSnapshotsApi: { list: h.list, rename: h.rename },
}));

vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ showToast: h.showToast }) },
}));

import { ChapterSnapshotsDialog } from '../ChapterSnapshotsDialog';
import { setLang } from '../../i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function snap(id: string, name?: string) {
  return {
    id,
    chapterId: 'ch1',
    bookId: 'b1',
    content: `<p>${id}</p>`,
    wordCount: 1200,
    origin: 'manual',
    createdAt: 1_700_000_000,
    ...(name ? { name } : {}),
  };
}

async function mount(ui?: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      ui ?? (
        <ChapterSnapshotsDialog
          open
          onClose={() => {}}
          chapterId="ch1"
          currentContent="<p>current</p>"
          currentWordCount={999}
          onManualSnapshot={async () => {}}
          onRestore={() => {}}
        />
      ),
    );
  });
}

const text = () => document.body.textContent ?? '';

/** 进入首行编辑态 → 写入新值 → 回车提交 */
async function commitRename(value: string) {
  const editBtn = document.body.querySelector('button[aria-label="重命名"]') as HTMLButtonElement | null;
  expect(editBtn, '快照行应渲染重命名按钮').toBeTruthy();
  await act(async () => {
    editBtn!.click();
  });
  const input = document.body.querySelector('input') as HTMLInputElement | null;
  expect(input, '点击后应进入编辑态').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input!, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setLang('zh-CN');
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('ChapterSnapshotsDialog · 重命名落库', () => {
  it('重命名调用后端命令并显示新名，且不写 localStorage', async () => {
    h.list.mockResolvedValue([snap('snap_1'), snap('snap_2')]);
    h.rename.mockResolvedValue(undefined);

    await mount();
    expect(h.list).toHaveBeenCalledWith('ch1');

    await commitRename('定稿前');

    expect(h.rename).toHaveBeenCalledWith('snap_1', '定稿前');
    expect(text()).toContain('定稿前');
    // 关键回归锁：绝不再走 localStorage 退路
    expect(localStorage.getItem('sf_snapshot_names')).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('后端失败时回滚乐观更新并明确提示，不静默落 localStorage', async () => {
    h.list.mockResolvedValue([snap('snap_1', '旧名'), snap('snap_2')]);
    h.rename.mockRejectedValue(new Error('snapshot snap_1 not found'));

    await mount();
    expect(text()).toContain('旧名');

    await commitRename('新名');

    expect(h.rename).toHaveBeenCalledWith('snap_1', '新名');
    expect(text()).toContain('旧名');
    expect(text()).not.toContain('新名');
    expect(h.showToast).toHaveBeenCalled();
    const [msg, severity] = h.showToast.mock.calls[0];
    expect(severity).toBe('error');
    expect(String(msg)).toContain('snapshot snap_1 not found');
    expect(localStorage.getItem('sf_snapshot_names')).toBeNull();
  });

  it('列表拉取失败显示错误与重试，而不是伪装成「还没有快照」', async () => {
    h.list.mockRejectedValue(new Error('db busy'));

    await mount();

    expect(text()).toContain('没能取到快照列表');
    expect(text()).toContain('db busy');
    expect(text()).not.toContain('还没有快照');
    expect(text()).toContain('重试');
    expect(h.showToast.mock.calls.some((c) => c[1] === 'error')).toBe(true);
  });

  it('真正没有快照时才显示空态文案', async () => {
    h.list.mockResolvedValue([]);

    await mount();

    expect(text()).toContain('还没有快照');
    expect(text()).not.toContain('重试');
  });
});
