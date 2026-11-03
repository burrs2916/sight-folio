// 「作品信息」对话框锁（2026-11-03 插单七）。
//
// 起因：插单 6 把状态做成「可点 chip + 菜单」，李先生当场驳回——悬浮到连载中上面再去改，
// 谁知道？谁都不知道该怎么改，还得到处找。教训记死：**可点性藏在样式里 = 没有入口**，
// 入口必须自己写着它干什么。这轮因此补常驻文字按钮 + 对话框，状态放最上面、
// 每态带一句人话说明（不靠人猜「暂停更新」与「已弃坑」差在哪）。
//
// 钉四件事：四态与说明都在 / 未改动不许提交（免得冒出「点了没反应」的新误解）/
// 提交走唯一 setter 且落归一后的规范码 / 三处明示入口不许哪天缩回隐藏手势。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const h = vi.hoisted(() => ({
  setBookMeta: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock('../../store/writingStore', () => ({
  useWritingStore: (sel: (s: unknown) => unknown) => sel({ setBookMeta: h.setBookMeta }),
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: (sel: (s: unknown) => unknown) => sel({ showToast: h.showToast }),
}));

import { BookInfoDialog } from '../BookInfoDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bookOf = (over: Record<string, unknown> = {}) =>
  ({
    id: 'b1',
    title: '长夜',
    description: '',
    genre: 'novel',
    medium: 'serial',
    status: 'draft',
    coverColor: '#4A338F',
    dailyGoal: 0,
    extra: '',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as never;

let root: Root | null = null;

function mount(ui: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

const actions = () => Array.from(document.querySelectorAll('.MuiDialogActions-root button')) as HTMLButtonElement[];
const confirmBtn = () => actions().slice(-1)[0];
const card = (id: string) => document.querySelector(`[data-testid="book-info-status-${id}"]`) as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('作品信息对话框（插单七 · 明示入口）', () => {
  it('四态卡片 + 每态一句说明都渲染，且标题就是「作品信息」', () => {
    mount(<BookInfoDialog book={bookOf()} onClose={() => {}} />);
    const body = document.body;
    expect(body.textContent).toContain('作品信息');
    for (const [id, label, desc] of [
      ['ongoing', '连载中', '还在写'],
      ['finished', '已完结', '正文已全部写完'],
      ['hiatus', '暂停更新', '暂时停下'],
      ['abandoned', '已弃坑', '不写了'],
    ]) {
      expect(card(id), `缺状态卡：${id}`).not.toBeNull();
      const text = card(id)!.textContent ?? '';
      expect(text, `${id} 缺标签`).toContain(label);
      expect(text, `${id} 缺说明`).toContain(desc);
    }
  });

  it('旧值 draft 打开即视为「连载中」：没有任何改动 → 确认按钮禁用（不误报"改了没反应"）', () => {
    mount(<BookInfoDialog book={bookOf({ status: 'draft' })} onClose={() => {}} />);
    expect(confirmBtn()?.disabled).toBe(true);
    expect(h.setBookMeta).not.toHaveBeenCalled();
  });

  it('点「已完结」→ 确认解禁 → 提交落规范码 finished，并带上体裁载体', async () => {
    const onClose = vi.fn();
    mount(<BookInfoDialog book={bookOf({ status: 'draft' })} onClose={onClose} />);
    act(() => card('finished')!.click());
    expect(confirmBtn()?.disabled).toBe(false);
    // 落库是 promise，成功 toast / onClose 都在微任务里 —— 不 await 会变成 act 警告 + 漏断言
    await act(async () => {
      confirmBtn()!.click();
    });
    expect(h.showToast).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(h.setBookMeta).toHaveBeenCalledTimes(1);
    const call = h.setBookMeta.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[0]).toBe('b1');
    expect(call[1]).toEqual({ status: 'finished', genre: 'novel', medium: 'serial' });
  });

  it('三处明示入口都在源码面上（书架常驻按钮 / 写作台 / 工作台顶栏），不许缩回隐藏手势', () => {
    for (const rel of ['pages/BookshelfPage.tsx', 'pages/WritingPage.tsx', 'pages/SceneEditorPage.tsx']) {
      const text = readFileSync(join(SRC_DIR, rel), 'utf8');
      expect(text, `${rel} 缺「作品信息」文字入口`).toContain("t('writing.bookInfo.title')");
      expect(text, `${rel} 未挂 BookInfoDialog`).toMatch(/BookInfoDialog/);
    }
  });
});
