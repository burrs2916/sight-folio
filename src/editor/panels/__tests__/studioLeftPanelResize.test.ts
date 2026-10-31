// 工作室左栏可拖宽 + 持久化 · 回归锁（2026-10-31，第十四轮批⑤）
//
// 病灶（可用缺陷）：左栏固定 PANEL_WIDTH=200 不可拖——目录树「书名 · 章名」长标题
// 被截断，与写作台左栏（180~420 可拖 + 持久化）不对称。
// 修法：宽度上提给 SceneEditor 接管（ComponentCenterPanel 接 width/resizing props），
// 手柄在左栏右缘（向右拖变宽，与右栏手柄镜像）；拖拽走与右栏同一套范式——
// useEffect(leftDragging) 挂 window 监听 + useDragBodyGuard(独立实例) + cleanup
// 还原 cursor + 松手落盘 localStorage + 双击复位；拖宽期间抑制 width 过渡（跟手）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const EDITOR = readFileSync(`${process.cwd()}/src/editor/SceneEditor.tsx`, 'utf8');
const PANEL = readFileSync(`${process.cwd()}/src/editor/panels/ComponentCenterPanel.tsx`, 'utf8');

describe('左栏可拖宽接线', () => {
  it('常量与 clamp 区间（180~420，与写作台同量级）', () => {
    expect(EDITOR).toMatch(/STUDIO_LEFT_MIN = 180/);
    expect(EDITOR).toMatch(/STUDIO_LEFT_MAX = 420/);
    expect(EDITOR).toMatch(/raw >= STUDIO_LEFT_MIN && raw <= STUDIO_LEFT_MAX/);
  });
  it('宽度落 localStorage（读+写接线齐备）', () => {
    expect(EDITOR).toMatch(/STUDIO_LEFT_WIDTH_KEY = 'sight-folio:studio\.leftPanelWidth'/);
    expect(EDITOR).toMatch(/localStorage\.setItem\(STUDIO_LEFT_WIDTH_KEY/);
    expect(EDITOR).toMatch(/localStorage\.getItem\(STUDIO_LEFT_WIDTH_KEY\)/);
  });
  it('拖拽监听由 useEffect(leftDragging) 驱动并在 cleanup 摘除', () => {
    expect(EDITOR).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*if \(!leftDragging\) return;/);
    expect(EDITOR).toMatch(/if \(leftDragging\) return;\n\s*try \{\n\s*localStorage\.setItem\(STUDIO_LEFT_WIDTH_KEY/);
  });
  it('左栏使用独立守卫实例（与右栏并发互不干扰）', () => {
    expect(EDITOR).toMatch(/beginLeftBodyDrag, release: releaseLeftBodyDrag \} = useDragBodyGuard\(\)/);
    expect(EDITOR).toMatch(/beginLeftBodyDrag\(\)/);
    expect(EDITOR).toMatch(/releaseLeftBodyDrag\(\)/);
  });
  it('手柄挂 onMouseDown + 双击复位', () => {
    expect(EDITOR).toMatch(/onMouseDown=\{startLeftResize\}/);
    expect(EDITOR).toMatch(/onDoubleClick=\{onLeftResizeReset\}/);
  });
  it('面板接 width/resizing props，拖拽中抑制过渡', () => {
    expect(PANEL).toMatch(/width = PANEL_WIDTH/);
    expect(PANEL).toMatch(/resizing = false/);
    expect(PANEL).toMatch(/transition: resizing \? 'none' : 'width 0\.2s/);
  });
  it('手柄仅在展开态渲染（折叠态 40px 无可调意义）', () => {
    expect(EDITOR).toMatch(/leftPanelOpen && \(\n\s+<Box\n\s+onMouseDown=\{startLeftResize\}/);
  });
});
