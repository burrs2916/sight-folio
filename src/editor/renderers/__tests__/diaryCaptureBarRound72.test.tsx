// ㉥ M1a（2026-11-11 轮 72 续七班）：日记「此刻记一笔」记录条的真渲染锁。
//
// 真人定的方向：「日记的主要目的是记录：什么事情、几点钟发生、跟什么人物见过面说过话……
// 完了以后通过 AI 直接给它润色。有些人不愿意花太多时间润色它，我们就抓住这个痛点。」
// ⇒ 这条输入栏是日记的**主入口**，它挂了就等于产品方向落地，它坏了整个日记就退回"先写后改"。
//
// 渲染级必须验的四件（源码锁一件都测不到）：
//   ① 只有「一条一天」的载体挂它（判据 = hasTodayEntryMode，其余四体裁这一栏逐字不变）
//   ② 回车/点按钮真的落到 `createTimelineEvent`，且参数形状对（at=HH:mm、event=那句话）
//   ③ 今天还没开条目时，**先建今天条目再挂事件**（记完东西不会变成"未绑条目"的孤儿）
//   ④ 认书闸 `ensureWritingBookWired` 扳不动 ⇒ 一个字都不许多写（AI-12 ④-e 同族：
//      在 B 卡上记的东西静默进 A 书 = 数据事故，比不功能更糟）
// 挂载法沿用本目录 ChapterPicker.tree.test.tsx 的 createRoot + act 口径。
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// 认书助手默认放行（真实现要动 Tauri）；第 ④ 枚用例单独把它改成拒绝。
const wired = vi.fn(async () => true);
vi.mock('../../../utils/studioBook', async (importOriginal) => {
  const real = await (importOriginal as () => Promise<Record<string, unknown>>)();
  return { ...real, ensureWritingBookWired: () => wired() };
});

import { DiaryCaptureBar } from '../writingPanes';
import { useWritingStore } from '../../../store/writingStore';
import { setLang } from '../../../i18n';
import { todayDateKey } from '../../../utils/diaryEntry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  wired.mockClear();
});

const DIARY = { id: 'bD', title: '某本日记', genre: 'diary' };
const NOVEL = { id: 'bN', title: '某本小说', genre: 'novel' };

function seed(opts: {
  genre?: string;
  chapters?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  settings?: Record<string, unknown>[];
} = {}) {
  const book = opts.genre === 'novel' ? NOVEL : DIARY;
  const spyEvent = vi.fn(async (o: Record<string, unknown>) => ({ id: 'evNew', ...(o as object) }));
  const spyChapter = vi.fn(async (title: string) => ({ id: 'chToday', title }));
  useWritingStore.setState({
    books: [book],
    activeBookId: book.id,
    chapters: opts.chapters ?? [],
    timelineEvents: opts.events ?? [],
    settings: opts.settings ?? [{ id: 's1', bookId: book.id, name: '母亲', kind: 'character', extra: '{}' }],
    createTimelineEvent: spyEvent,
    createChapter: spyChapter,
  } as never);
  return { spyEvent, spyChapter, book };
}

const inputs = () => Array.from(host?.querySelectorAll('input') ?? []) as HTMLInputElement[];
const buttonOf = (label: string) =>
  (Array.from(host?.querySelectorAll('button') ?? []) as HTMLButtonElement[]).find((b) => b.textContent?.includes(label));
const text = () => host?.textContent ?? '';

/**
 * React 受控输入的正规打法：**直接 `el.value = x` 会被 React 自己的值追踪吞掉**
 * （它比对内部 tracker 后判定"没变化"，onChange 根本不触发）⇒ 组件 state 还是空串，
 * `submit` 里 `if (!text) return` 当场自杀，看起来就像"按钮坏了"。
 * 必须先调原型上的原生 setter 写值，再派发 input/change。
 */
function type(el: Element | null | undefined, value: string) {
  const node = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('HTMLInputElement.prototype.value 没有 setter');
  act(() => {
    setter.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pick(el: Element | null | undefined, value: string) {
  const node = el as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (!setter) throw new Error('HTMLSelectElement.prototype.value 没有 setter');
  act(() => {
    setter.call(node, value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('㉭ M1a · 日记记录条', () => {
  beforeEach(() => setLang('zh-CN'));

  it('日记书：时刻 / 一句话 / 跟谁 / 记下来 / 当天计数行 全在场', () => {
    seed();
    mount(<DiaryCaptureBar accent="#0ea8a8" bookId="bD" genre="diary" />);
    expect(host?.querySelector('input[type="time"]'), '缺时刻输入').toBeTruthy();
    expect(inputs()[1].placeholder).toContain('发生了什么');
    expect(host?.querySelector('select'), '缺人物下拉').toBeTruthy();
    expect(host?.querySelector('select')?.textContent).toContain('母亲');
    expect(buttonOf('记下来'), '缺提交按钮').toBeTruthy();
    expect(text()).toContain('今天已记 0 条');
  });

  it('一句话点「记下来」→ createTimelineEvent 收到 at=HH:mm + 那句话 + 选中的人', async () => {
    const { spyEvent, spyChapter } = seed();
    mount(<DiaryCaptureBar accent="#0ea8a8" bookId="bD" genre="diary" />);
    type(inputs()[0], '07:10');
    const box = inputs()[1];
    type(box, '陪母亲去医院做检查');
    pick(host?.querySelector('select'), 's1');
    await act(async () => {
      buttonOf('记下来')!.click();
    });
    expect(wired).toHaveBeenCalledTimes(1); // 认书闸必须先过
    expect(spyEvent).toHaveBeenCalledTimes(1);
    const arg = spyEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.at).toBe('07:10');
    expect(arg.event).toBe('陪母亲去医院做检查');
    expect(arg.settingId).toBe('s1');
    expect(arg.storylineId).toBeNull(); // 剧情线永远不许被日记记出来（那栏被裁）
    expect(arg.chapterId).toBe('chToday');
    // 今天原本没条目 ⇒ 必须先建条目，事件才有个"哪天"可挂
    expect(spyChapter).toHaveBeenCalledTimes(1);
  });

  it('回车即入库（记东西不该先找按钮）', async () => {
    const { spyEvent, spyChapter } = seed();
    mount(<DiaryCaptureBar accent="#0ea8a8" bookId="bD" genre="diary" />);
    const box = inputs()[1];
    type(box, '忽然很想去看雪');
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(spyEvent).toHaveBeenCalledTimes(1);
    expect((spyEvent.mock.calls[0][0] as Record<string, unknown>).event).toBe('忽然很想去看雪');
    expect(spyChapter).toHaveBeenCalledTimes(1);
  });

  it('今天条目已存在 → 直接挂上去，不重复开条目', async () => {
    const key = todayDateKey();
    const { spyChapter, spyEvent } = seed({
      chapters: [{ id: 'chExist', bookId: 'bD', title: '已有今天', extra: JSON.stringify({ entryDate: key }) }],
    });
    mount(<DiaryCaptureBar accent="#0ea8a8" bookId="bD" genre="diary" />);
    expect(text()).toContain('今天已记 0 条');
    type(inputs()[1], '第二件事');
    await act(async () => {
      buttonOf('记下来')!.click();
    });
    expect(spyChapter).not.toHaveBeenCalled();
    expect(spyEvent.mock.calls[0][0]).toMatchObject({ chapterId: 'chExist' });
  });

  it('当天已有 2 条 → 计数行报 2（这条读数就是"记了多少"的正反馈）', () => {
    const key = todayDateKey();
    seed({
      chapters: [{ id: 'chExist', bookId: 'bD', title: '今天', extra: JSON.stringify({ entryDate: key }) }],
      events: [
        { id: 'e1', bookId: 'bD', chapterId: 'chExist', at: '07:10', event: '一', sortOrder: 0 },
        { id: 'e2', bookId: 'bD', chapterId: 'chExist', at: '09:00', event: '二', sortOrder: 1 },
      ],
    });
    mount(<DiaryCaptureBar accent="#0ea8a8" bookId="bD" genre="diary" />);
    expect(text()).toContain('今天已记 2 条');
  });

  it('空文本不许提交（按钮禁用 + 回车也拦）', async () => {
    const { spyEvent } = seed();
    mount(<DiaryCaptureBar accent="#0ea8a8" bookId="bD" genre="diary" />);
    const btn = buttonOf('记下来')!;
    expect(btn.disabled, '空文本时按钮该禁用').toBe(true);
    await act(async () => {
      inputs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(spyEvent).not.toHaveBeenCalled();
  });

  it('认书闸扳不动 ⇒ 一个字都不许多写（不许静默建进别的书）', async () => {
    const { spyEvent, spyChapter } = seed();
    wired.mockImplementationOnce(async () => false);
    mount(<DiaryCaptureBar accent="#0ea8a8" bookId="bD" genre="diary" />);
    type(inputs()[1], '记一条');
    await act(async () => {
      buttonOf('记下来')!.click();
    });
    expect(spyChapter).not.toHaveBeenCalled();
    expect(spyEvent).not.toHaveBeenCalled();
  });

  it('零回归线：小说 / 散文 / 诗集 / 剧本 / 未设 —— 这一栏不挂记录条', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', '']) {
      seed({ genre: g });
      mount(<DiaryCaptureBar accent="#000" bookId={g === 'novel' ? 'bN' : 'bD'} genre={g} />);
      expect(text(), `体裁 ${g || '(空)'} 不该出现记录条`).toBe('');
      act(() => root?.unmount());
      root = null;
      host?.remove();
      host = null;
    }
  });
});
