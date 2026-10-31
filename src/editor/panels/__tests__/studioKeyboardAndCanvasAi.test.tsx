// 工作室（SceneEditor）键盘守卫 + 画布 AI 入口接线 · 回归锁（2026-10-31，第十四轮）
//
// B1 数据损坏级：全局 keydown 的 Delete/Backspace 分支删「选中实体」，旧守卫只挡
//   INPUT/TEXTAREA/SELECT，漏了 contentEditable。画布章节纸面卡（WritingChapterEditor /
//   TipTap）的正文编辑是 contentEditable —— 用户在卡里敲退格删字时，若该卡正处于选中态，
//   会被 removeComponent **整卡删除**；Ctrl+Z 同理被画布 undo 劫持、撤销不了正文。
//   同仓库 SceneTabBar L2 键盘切换早已补 `isContentEditable || closest('[contenteditable]')`
//   守卫，两处口径必须一致。
//
// B2 功能断链级：方案 A 把「AI 优化画布」从顶栏迁入右栏 AI 面板常驻按钮
//   （WorkbenchAiPanel `isBookScene && onOpenCanvasAi` 才渲染）。但 SceneEditor 曾把收到的
//   prop 改名成 `onOpenCanvasAi: _onOpenCanvasAi`（下划线 = 弃用），渲染 WorkbenchAiPanel 时
//   根本没往下传 → 工作室书场景该入口永不显示，迁移的最后一公里断裂。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(`${process.cwd()}/src/editor/SceneEditor.tsx`, 'utf8');

describe('工作室键盘编辑态守卫（B1）', () => {
  it('全局 keydown 守卫识别 contentEditable（自身或祖先）', () => {
    expect(SRC).toMatch(/el\.isContentEditable/);
    expect(SRC).toMatch(/closest\?\.\('\[contenteditable\]'\)/);
  });
  it('守卫在 Delete/Backspace 删实体分支之前 return（编辑态整体让位）', () => {
    const guardIdx = SRC.search(/el\.isContentEditable/);
    const delIdx = SRC.search(/'Delete' \|\| e\.key === 'Backspace'/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(delIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(delIdx);
  });
  it('INPUT/TEXTAREA/SELECT 守卫仍保留（不回归）', () => {
    expect(SRC).toMatch(/tag === 'INPUT'/);
    expect(SRC).toMatch(/tag === 'TEXTAREA'/);
  });
});

describe('工作室画布 AI 入口接线（B2）', () => {
  it('onOpenCanvasAi prop 不再被改名下划线弃用', () => {
    expect(SRC).not.toMatch(/onOpenCanvasAi:\s*_onOpenCanvasAi/);
  });
  it('onOpenCanvasAi 透传给 WorkbenchAiPanel（AI 面板常驻入口可达）', () => {
    expect(SRC).toMatch(/onOpenCanvasAi=\{onOpenCanvasAi\}/);
  });
});
