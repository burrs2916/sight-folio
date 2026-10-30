// 滚动位置记忆 hook 回归锁（2026-10-31 第六轮）
// 场景：正文滚动容器随 rightTab==='body' 分支挂载/卸载；同章切「章详情/设定卡」再回来，
// 必须把离开前定格的位置恢复回去（否则长文跳回顶部）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';
import { useEditorScrollMemory } from '../useEditorScrollMemory';

function makeScrollEl(): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollTop', {
    writable: true,
    configurable: true,
    value: 0,
  });
  document.body.appendChild(el);
  return el;
}

describe('useEditorScrollMemory', () => {
  let rafCbs: FrameRequestCallback[] = [];
  beforeEach(() => {
    rafCbs = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function flushRaf() {
    const q = rafCbs;
    rafCbs = [];
    q.forEach((cb) => cb(0));
  }

  it('挂载且无历史值：不跳位；滚动时把最新位置落账到 memory', () => {
    const el = makeScrollEl();
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const memory = new Map<string, number>();
    const { unmount } = renderHook(() =>
      useEditorScrollMemory({ scrollRef: ref, bodyVisible: true, chapterId: 'c1', memory }),
    );
    el.scrollTop = 320;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
      flushRaf();
    });
    expect(memory.get('c1')).toBe(320);
    // 卸载前 cleanup 再定格一次（模拟切走时最终位置）
    act(() => unmount());
    expect(memory.get('c1')).toBe(320);
  });

  it('重新挂载（切回正文）：恢复离开前定格的 scrollTop', () => {
    const el = makeScrollEl();
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const memory = new Map<string, number>([['c1', 800]]);
    renderHook(() =>
      useEditorScrollMemory({ scrollRef: ref, bodyVisible: true, chapterId: 'c1', memory }),
    );
    expect(el.scrollTop).toBe(0); // rAF 前尚未恢复
    act(() => flushRaf());
    expect(el.scrollTop).toBe(800); // rAF 后跳回原位
  });

  it('bodyVisible=false（停在章详情/设定卡）：不挂监听、不记账', () => {
    const el = makeScrollEl();
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const memory = new Map<string, number>();
    const { rerender } = renderHook(
      ({ visible }: { visible: boolean }) =>
        useEditorScrollMemory({ scrollRef: ref, bodyVisible: visible, chapterId: 'c1', memory }),
      { initialProps: { visible: false } },
    );
    el.scrollTop = 500;
    act(() => el.dispatchEvent(new Event('scroll')));
    flushRaf();
    expect(memory.has('c1')).toBe(false);
    rerender({ visible: true });
  });

  it('换章（chapterId 变化）：cleanup 定格旧章位置，effect 用新章已有值恢复', () => {
    const el = makeScrollEl();
    const ref: RefObject<HTMLDivElement | null> = { current: el };
    const memory = new Map<string, number>([['c2', 1200]]);
    const { rerender } = renderHook(
      ({ ch }: { ch: string }) =>
        useEditorScrollMemory({ scrollRef: ref, bodyVisible: true, chapterId: ch, memory }),
      { initialProps: { ch: 'c1' } },
    );
    el.scrollTop = 60;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
      flushRaf();
    });
    expect(memory.get('c1')).toBe(60);
    rerender({ ch: 'c2' }); // 旧章 cleanup 定格 60；新章恢复 1200
    act(() => flushRaf());
    expect(el.scrollTop).toBe(1200);
  });
});
