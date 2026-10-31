// 拖拽全局副作用守卫 · 回归锁（2026-10-31，第十一轮）
//
// 事故：左栏 / 右抽屉 / 语料面板三处宽度手柄都在 pointerdown 写
// document.body.style.userSelect='none'，只在 pointerup/cancel/双击复位。三处组件
// 都挂在 rightTab==='body' 分支内——**按住手柄拖动中途**切到「章详情 / 设定卡」
// （左栏章节树点击、快捷键等入口不需要先松手）→ 组件立即卸载，window 上的
// pointerup 监听随 cleanup 摘掉，永远等不到复位 → body 残留 userSelect:none，
// 切回正文后整页文字无法选中（选区 / 双击选词 / 复制全失效）。
//
// 修法：三处统一走 useDragBodyGuard —— begin 记录接管前原值并置 none，
// release 还原；卸载（cleanup）时若会话未正常结束同样还原。
// 断言分两层：① hook 自身行为（含宿主原值保留）；② 三处组件不再裸写 body 样式。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDragBodyGuard } from '../../../hooks/useDragBodyGuard';

// React 18 createRoot 需要在 act 环境下工作
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mountHook(): { begin: () => void; release: () => void; calls: { ref: number } } {
  const calls = { ref: 0 };
  let api = { begin: () => {}, release: () => {} };
  function Probe() {
    const guard = useDragBodyGuard();
    api = guard;
    calls.ref += 1;
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<Probe />);
  });
  return { ...api, calls };
}

function unmount() {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
}

beforeEach(() => {
  document.body.style.userSelect = '';
});
afterEach(() => {
  unmount();
  document.body.style.userSelect = '';
});

describe('useDragBodyGuard 行为', () => {
  it('begin 置 none、release 还原为空', () => {
    const g = mountHook();
    g.begin();
    expect(document.body.style.userSelect).toBe('none');
    g.release();
    expect(document.body.style.userSelect).toBe('');
  });

  it('拖拽中途卸载（拿不到 pointerup）必须还原 body 样式', () => {
    const g = mountHook();
    g.begin();
    expect(document.body.style.userSelect).toBe('none');
    unmount();
    expect(document.body.style.userSelect).toBe('');
  });

  it('宿主本来设有 userSelect 时，还原回原值而不是硬写空', () => {
    document.body.style.userSelect = 'text';
    const g = mountHook();
    g.begin();
    expect(document.body.style.userSelect).toBe('none');
    unmount();
    expect(document.body.style.userSelect).toBe('text');
  });

  it('begin/release 幂等：重复 begin 不丢失原始值，多余 release 不误改', () => {
    const g = mountHook();
    g.begin();
    g.begin(); // 第二次 begin 不应把「none」当成原值记下来
    g.release();
    expect(document.body.style.userSelect).toBe('');
    g.release(); // 多余 release 不改状态
    expect(document.body.style.userSelect).toBe('');
  });
});

describe('三处宽度手柄统一走守卫（不再裸写 body 样式）', () => {
  const files = [
    'src/pages/WritingPage.tsx',
    'src/pages/writingPage/WritingDrawer.tsx',
    'src/pages/writingPage/CorpusReferencePanel.tsx',
  ];
  it.each(files)('%s 不含 document.body.style.userSelect 裸写', (rel) => {
    const src = readFileSync(`${process.cwd()}/${rel}`, 'utf8');
    expect(src).not.toMatch(/document\.body\.style\.userSelect\s*=/);
  });
  it.each(files)('%s 已接入 useDragBodyGuard', (rel) => {
    const src = readFileSync(`${process.cwd()}/${rel}`, 'utf8');
    expect(src).toMatch(/useDragBodyGuard\(\)/);
    expect(src).toMatch(/beginBodyDrag\(\)/);
    expect(src).toMatch(/releaseBodyDrag\(\)/);
  });
});
