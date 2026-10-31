// 工作室（SceneEditor）右栏拖宽 + 三栏布局持久化 · 回归锁（2026-10-31，第十四轮）
//
// 病灶：旧 startRightResize 在 mousedown 里 imperative addEventListener('mousemove/mouseup')，
// 只在 onUp 里 remove + 复位 body.cursor/userSelect。拖到**中途**收起右栏 / 切场景 / 切书时
// 手柄随 rightPanelOpen 分支卸载，imperative 监听与 body 样式脱管 → cursor 卡 col-resize、
// userSelect:none 残留（整页文字选不中）+ window 监听泄漏。这正是第十一轮写作台同型病灶
// 在工作室的复现（写作台三处手柄已统一走 useDragBodyGuard，唯独工作室漏网）。
//
// 修法：body.userSelect 交给 useDragBodyGuard（卸载兜底还原）；window 监听改由
// useEffect(rightDragging) 挂载并在 cleanup 摘除 + 还原 cursor（prevCursor 保留宿主原值）；
// 右栏宽 / 右栏折叠 / 左栏折叠三态落 localStorage（与写作台同范式，工作区重启不丢）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(`${process.cwd()}/src/editor/SceneEditor.tsx`, 'utf8');

describe('工作室右栏拖宽守卫', () => {
  it('不再裸写 document.body.style.userSelect', () => {
    expect(SRC).not.toMatch(/document\.body\.style\.userSelect\s*=/);
  });
  it('已接入 useDragBodyGuard（begin/release 成对）', () => {
    expect(SRC).toMatch(/useDragBodyGuard\(\)/);
    expect(SRC).toMatch(/beginBodyDrag\(\)/);
    expect(SRC).toMatch(/releaseBodyDrag\(\)/);
  });
  it('window 监听在 effect cleanup 里成对摘除（mousemove + mouseup）', () => {
    expect(SRC).toMatch(/window\.addEventListener\('mousemove'/);
    expect(SRC).toMatch(/window\.addEventListener\('mouseup'/);
    expect(SRC).toMatch(/window\.removeEventListener\('mousemove'/);
    expect(SRC).toMatch(/window\.removeEventListener\('mouseup'/);
  });
  it('拖拽监听由 useEffect(rightDragging) 驱动，卸载即随 cleanup 摘除', () => {
    expect(SRC).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*if \(!rightDragging\) return;/);
  });
  it('cursor 复位保留宿主原值（不硬写空字符串）', () => {
    expect(SRC).toMatch(/const prevCursor = document\.body\.style\.cursor;/);
    expect(SRC).toMatch(/document\.body\.style\.cursor = prevCursor;/);
  });
  it('双击手柄复位宽度为默认值', () => {
    expect(SRC).toMatch(/onDoubleClick=\{onRightResizeReset\}/);
  });
});

describe('工作室三栏布局持久化', () => {
  it('右栏宽度落 localStorage（读 + 写接线齐备）', () => {
    expect(SRC).toMatch(/STUDIO_RIGHT_WIDTH_KEY = 'sight-folio:studio\.rightPanelWidth'/);
    expect(SRC).toMatch(/localStorage\.setItem\(STUDIO_RIGHT_WIDTH_KEY/);
    expect(SRC).toMatch(/localStorage\.getItem\(STUDIO_RIGHT_WIDTH_KEY\)/);
  });
  it('右栏折叠态落 localStorage', () => {
    expect(SRC).toMatch(/STUDIO_RIGHT_OPEN_KEY = 'sight-folio:studio\.rightPanelOpen'/);
    expect(SRC).toMatch(/localStorage\.setItem\(STUDIO_RIGHT_OPEN_KEY/);
  });
  it('左栏折叠态落 localStorage', () => {
    expect(SRC).toMatch(/STUDIO_LEFT_OPEN_KEY = 'sight-folio:studio\.leftPanelOpen'/);
    expect(SRC).toMatch(/localStorage\.setItem\(STUDIO_LEFT_OPEN_KEY/);
  });
  it('右栏宽度读取带 clamp（越界回 null 走默认，不接受脏值）', () => {
    expect(SRC).toMatch(/raw >= STUDIO_RIGHT_MIN && raw <= STUDIO_RIGHT_MAX/);
  });
});
