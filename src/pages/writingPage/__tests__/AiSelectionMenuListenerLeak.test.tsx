// 选区 AI 菜单事件监听泄漏回归锁（第十三轮批④）
//
// 病灶：blur 的注册与注销各写了一个新建箭头函数——off 传入的引用与 on 不同，
// 永远注销不掉。effect 每次重跑（editor 重建/严格模式双挂载）都再 on 一个 blur，
// 监听器随时间累积；旧闭包里的 setPos 会在卸载后的组件上被调用（React 警告 +
// 未来若加副作用即事故）。修复=blur 与其余事件同一命名引用。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({ t: (k: string) => k }));

import { AiSelectionMenu } from '../AiSelectionMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 最小假编辑器：记录每个事件的监听器数量，支持 emit 驱动 computePos */
function fakeEditor() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const ed = {
    isFocused: true,
    state: { selection: { empty: false, from: 5, to: 10 } },
    view: {
      coordsAtPos: (pos: number) => ({ top: 100 + pos, bottom: 120 + pos, left: 50 + pos, right: 60 + pos }),
    },
    on(name: string, fn: (...a: unknown[]) => void) {
      const arr = handlers.get(name) ?? [];
      arr.push(fn);
      handlers.set(name, arr);
    },
    off(name: string, fn: (...a: unknown[]) => void) {
      const arr = handlers.get(name) ?? [];
      handlers.set(
        name,
        arr.filter((x) => x !== fn),
      );
    },
    emit(name: string) {
      for (const fn of [...(handlers.get(name) ?? [])]) fn({ editor: ed });
    },
    count: (name: string) => (handlers.get(name) ?? []).length,
  };
  return ed as typeof ed & { count: (n: string) => number };
}

let host: HTMLDivElement;
afterEach(() => {
  host?.remove();
});

describe('AiSelectionMenu 卸载后不残留任何事件监听', () => {
  it('blur 注销引用与注册一致：卸载后 blur 监听数归零', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const ed = fakeEditor();
    const scroll = { current: null };
    const root = createRoot(host);
    act(() => {
      root.render(
        <StrictMode>
          <AiSelectionMenu editor={ed as never} scrollRef={scroll as never} onPick={() => {}} />
        </StrictMode>,
      );
    });
    // 触发一次选区更新让菜单真正渲染（pos 非空）
    act(() => ed.emit('selectionUpdate'));
    expect(ed.count('selectionUpdate')).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(ed.count('blur')).toBe(0);
    expect(ed.count('selectionUpdate')).toBe(0);
    expect(ed.count('transaction')).toBe(0);
    expect(ed.count('focus')).toBe(0);
  });
});
