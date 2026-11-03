// 第二十八轮 · 打字机滚动居中算法的几何口径锁（第 27 轮待办 1 的 ④）
//
// utils/typewriterScroll 是第 27 轮从 WritingPage 抽出来的「唯一执行体」，写作台与画布章节
// 编辑器共用。它此前一条测试都没有 —— 而它的每条「不滚」规则都是有理由的：
//  ① 有选区不滚：选中一段 ≠ 写到这里，跳中点会打断拖拽；
//  ② 距中线不足 1/4 视高不滚：避免每敲一个字视口都微幅跳动；
//  ③ 超出阈值才滚，且一次滚到位（块中心 = 视口中线）；
//  ④ 显式 scrollEl 优先：写作台的滚动发生在外层 div，画布则是 editor.view.dom 本身。
// 这些规则一旦被「顺手优化」掉，两个消费点会同时坏，所以锁几何而不是锁文案。
import { describe, it, expect } from 'vitest';
import type { Editor } from '@tiptap/react';
import { centerCaretInViewport } from '../typewriterScroll';

interface FakeBlock {
  /** 块顶相对视口顶 */
  top: number;
  height: number;
}

/**
 * 造一个最小可用的假编辑器：jsdom 没有布局，几何全部由这里显式给出。
 * scrollTop 用自有存储（jsdom 的 setter 不产生真实滚动语义，不能当断言依据）。
 */
function fakeEditor(block: FakeBlock | null, opts?: { empty?: boolean; viewHeight?: number; scrollEl?: HTMLElement }) {
  const viewHeight = opts?.viewHeight ?? 400;
  const dom = document.createElement('div');

  const container = opts?.scrollEl ?? dom;
  // scrollTop 用自有存储（jsdom 不产生真实滚动语义），并让块的 rect 随滚动位移 ——
  // 与真实浏览器一致：容器滚过 S 之后，块的可视顶边是 blockTop - S。
  // 静态 rect 会让「滚后再调用不叠加」的断言失真（第二次仍算出同一个偏移）。
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => (container as unknown as { __st: number }).__st ?? 0,
    set(v: number) {
      (container as unknown as { __st: number }).__st = v;
    },
  });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: viewHeight });
  container.getBoundingClientRect = () => ({ top: 0, height: viewHeight }) as DOMRect;

  let blockEl: HTMLElement | null = null;
  if (block) {
    blockEl = document.createElement('p');
    blockEl.getBoundingClientRect = () => ({ top: block.top - container.scrollTop, height: block.height }) as DOMRect;
    container.appendChild(blockEl);
  }

  const editor = {
    state: { selection: { empty: opts?.empty ?? true, from: 5 } },
    view: {
      dom,
      domAtPos: () => ({ node: blockEl ?? dom }),
    },
  } as unknown as Editor;

  return { editor, container };
}

describe('centerCaretInViewport · 几何口径', () => {
  it('有选区（empty=false）一律不滚 —— 选中一段不是「写到这里」', () => {
    const h = fakeEditor({ top: 350, height: 20 }, { empty: false });
    centerCaretInViewport(h.editor);
    expect(h.container.scrollTop).toBe(0);
  });

  it('块中心离中线不足 1/4 视高时不滚（每敲一字都微跳等于没设置）', () => {
    // viewH=400：中线 200、阈值 100。块 top=150,h=20 → 中心 160、偏 -40 → 不滚
    const h = fakeEditor({ top: 150, height: 20 });
    centerCaretInViewport(h.editor);
    expect(h.container.scrollTop).toBe(0);
    // 越过阈值：top=305,h=20 → offset = 305 + 10 - 200 = 115 > 100 → 滚
    const h2 = fakeEditor({ top: 305, height: 20 });
    centerCaretInViewport(h2.editor);
    expect(h2.container.scrollTop).toBe(115);
  });

  it('超出阈值一次滚到位；滚到位后再触发不叠加（rect 随滚动位移，与真实浏览器一致）', () => {
    const h = fakeEditor({ top: 350, height: 20 });
    centerCaretInViewport(h.editor);
    // offset = 350 + 10 - 200 = 160
    expect(h.container.scrollTop).toBe(160);
    // 此时块的可视顶 = 350-160=190，中心 200 = 中线 → 偏移 0，不该再动
    centerCaretInViewport(h.editor);
    expect(h.container.scrollTop).toBe(160);
  });

  it('上方太远同样滚（负方向），口径对称', () => {
    // 块 top=-300,h=20 → offset = -300 + 10 - 200 = -490
    const h = fakeEditor({ top: -300, height: 20 });
    centerCaretInViewport(h.editor);
    expect(h.container.scrollTop).toBe(-490);
  });

  it('显式 scrollEl 才是滚动发生的地方：写作台滚外层 div，而不是 ProseMirror 自己', () => {
    const scrollEl = document.createElement('div');
    const h = fakeEditor({ top: 350, height: 20 }, { scrollEl });
    centerCaretInViewport(h.editor, scrollEl);
    expect(scrollEl.scrollTop).toBe(160);
  });

  it('视窗高度为 0（藏在折叠面板里的编辑器）不滚、不 NaN', () => {
    const h = fakeEditor({ top: 350, height: 20 }, { viewHeight: 0 });
    centerCaretInViewport(h.editor);
    expect(h.container.scrollTop).toBe(0);
  });

  it('光标位置解析不到块级元素（domAtPos 直接落在容器上）不滚也不抛错', () => {
    const h = fakeEditor(null);
    expect(() => centerCaretInViewport(h.editor)).not.toThrow();
    expect(h.container.scrollTop).toBe(0);
  });
});
