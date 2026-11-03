// 章节选择器树形缩进锁（2026-10-12）
//
// ChapterPicker 是 灵感挂章 / CastPane 绑定 / 时间线绑章 / 伏笔埋设·回收 共用的章节选择器，
// 树形口径与写作台章节树 / 笔记下拉统一：buildTree（按 sortOrder 升序）+ treeRowIndent(depth)。
// 本测试锁的是**代码本身**的渲染契约，防止以后把树形缩进改坏还查不出来：
//   ① depth=0 行 padding-left = 8px（INDENT_BASE）
//   ② depth=1 行 padding-left = 28px（INDENT_BASE + INDENT_STEP）
//   ③ 无关键字时展示完整树（不再截断前 8 条，滚动容器兜底）
//   ④ 搜索过滤命中仍保留真实层级 depth 缩进
//   ⑤ 点行（onMouseDown）→ onSelect 回调携带选中章节 id（选中/写入链路不因树形化改变）
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

import ChapterPicker from '../ChapterPicker';
import type { WritingChapter } from '../../../services/writing';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

const chapter = (id: string, title: string, kind: string, parentId: string | null, sortOrder = 0): WritingChapter => ({
  id,
  bookId: 'b1',
  title,
  content: '',
  sortOrder,
  wordCount: 0,
  status: 'draft',
  volume: '',
  parentId,
  kind,
  extra: '',
  createdAt: 0,
  updatedAt: 0,
});

/** 点开下拉后，用标题找行 button（padding-left 就在这层） */
function rowOf(title: string): HTMLButtonElement | null {
  const rows = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
  return rows.find((b) => (b.textContent ?? '').includes(title)) ?? null;
}

describe('ChapterPicker · 章节选择器按树形展开（灵感挂章/时间线/伏笔/CastPane 共用）', () => {
  it('depth=0（根）行 padding-left = 8px —— 基准位', () => {
    const chapters = [chapter('v1', '卷 1', '卷', null, 0), chapter('c1', '章 1', '章', 'v1', 0)];
    mount(<ChapterPicker chapters={chapters} onSelect={vi.fn()} />);
    // 触发下拉展开（输入框聚焦触发 open；无 value 时 placeholder 显示「绑定章节」）
    act(() => {
      // React 18 的 onFocus 走 focusin 委托：focus 事件不冒泡，须派发 focusin 才能展开下拉
      document.body.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const row = rowOf('卷 1');
    expect(row, '卷 1 行没渲染出来').toBeTruthy();
    expect(row!.style.paddingLeft, `根行缩进应为 8px（实际="${row!.style.paddingLeft}"）`).toBe('8px');
  });

  it('depth=1（子级）行 padding-left = 28px —— 缩进的本体就是这条 padding', () => {
    const chapters = [chapter('v1', '卷 1', '卷', null, 0), chapter('c1', '章 1', '章', 'v1', 0)];
    mount(<ChapterPicker chapters={chapters} onSelect={vi.fn()} />);
    act(() => {
      // React 18 的 onFocus 走 focusin 委托：focus 事件不冒泡，须派发 focusin 才能展开下拉
      document.body.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const row = rowOf('章 1');
    expect(row, '章 1 行没渲染出来').toBeTruthy();
    expect(row!.style.paddingLeft, `子级行缩进应为 28px（实际="${row!.style.paddingLeft}"）`).toBe('28px');
  });

  it('三级树 depth=2 行 padding-left = 48px，层级逐级 +20px', () => {
    const chapters = [
      chapter('v1', '卷 1', '卷', null, 0),
      chapter('c1', '章 1', '章', 'v1', 0),
      chapter('s1', '节 1', '节', 'c1', 0),
    ];
    mount(<ChapterPicker chapters={chapters} onSelect={vi.fn()} />);
    act(() => {
      // React 18 的 onFocus 走 focusin 委托：focus 事件不冒泡，须派发 focusin 才能展开下拉
      document.body.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const sRow = rowOf('节 1');
    expect(sRow, '节 1 行没渲染出来').toBeTruthy();
    expect(sRow!.style.paddingLeft).toBe('48px');
    const cRow = rowOf('章 1')!;
    expect(cRow.style.paddingLeft).toBe('28px');
    const vRow = rowOf('卷 1')!;
    expect(vRow.style.paddingLeft).toBe('8px');
  });

  it('无关键字时展示完整树（12 条不再截断：9 条同层 + 1 子级全部可选）', () => {
    const chapters = Array.from({ length: 10 }, (_, i) => chapter(`c${i}`, `章 ${i + 1}`, '章', null, i));
    chapters.push(chapter('sub', '章 11（挂卷下）', '章', 'c0', 0));
    mount(<ChapterPicker chapters={chapters} onSelect={vi.fn()} />);
    act(() => {
      // React 18 的 onFocus 走 focusin 委托：focus 事件不冒泡，须派发 focusin 才能展开下拉
      document.body.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const rows = Array.from(document.body.querySelectorAll('button')).filter((b) =>
      (b.textContent ?? '').includes('章 '),
    );
    // 原有的 MAX_DROPDOWN_ITEMS=8 截断已移除；扁平时 10 条 + 子级 1 条 = 11 行全部可见
    expect(rows.length, `应展示完整树（11 行），实际 ${rows.length} 行`).toBe(11);
    const subRow = rowOf('章 11（挂卷下）');
    expect(subRow!.style.paddingLeft, '挂卷下的行应缩进 28px').toBe('28px');
  });

  it('搜索过滤命中仍保留真实层级 depth 缩进', () => {
    const chapters = [
      chapter('v1', '第一卷', '卷', null, 0),
      chapter('c1', '第一章：启程', '章', 'v1', 0),
      chapter('c2', '第二章：抵达', '章', 'v1', 1),
    ];
    mount(<ChapterPicker chapters={chapters} onSelect={vi.fn()} />);
    act(() => {
      // React 18 的 onFocus 走 focusin 委托：focus 事件不冒泡，须派发 focusin 才能展开下拉
      document.body.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const input = document.body.querySelector('input')!;
    act(() => {
      // jsdom 直接赋 value 不会通知 React 受控输入追踪器，须经原生 setter
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '第一章');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const hit = rowOf('第一章：启程');
    expect(hit, '搜索命中行没渲染出来').toBeTruthy();
    expect(hit!.style.paddingLeft, '过滤后仍按真实层级缩进').toBe('28px');
    expect(rowOf('第二章：抵达'), '未命中行不应出现').toBeNull();
  });

  it('点行（onMouseDown）→ onSelect 回调携带选中章节 id，选中链路不因树形化改变', () => {
    const chapters = [chapter('v1', '卷 1', '卷', null, 0), chapter('c1', '章 1', '章', 'v1', 0)];
    const onSelect = vi.fn();
    mount(<ChapterPicker chapters={chapters} onSelect={onSelect} />);
    act(() => {
      // React 18 的 onFocus 走 focusin 委托：focus 事件不冒泡，须派发 focusin 才能展开下拉
      document.body.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const row = rowOf('章 1')!;
    act(() => {
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0], 'onSelect 应收到章 1 的 id').toBe('c1');
    // 选中后选择器收起（open=false → 下拉行消失）
    expect(rowOf('章 1'), '选中后下拉应收起').toBeNull();
  });

  it('选中的章节回显在输入框 placeholder（value 回显链路不因树形化改变）', () => {
    const chapters = [chapter('v1', '卷 1', '卷', null, 0), chapter('c1', '章 1', '章', 'v1', 0)];
    mount(<ChapterPicker chapters={chapters} onSelect={vi.fn()} value="c1" />);
    const input = document.body.querySelector('input')!;
    expect(input.placeholder, '已绑定章应回显章标题').toBe('章 1');
  });
});
