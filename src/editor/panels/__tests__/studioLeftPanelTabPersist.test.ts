// 工作室左栏 Tab 选中态持久化 · 回归锁（2026-10-31，第十四轮）
//
// 病灶：左栏「元素 / 目录树」tab 是组件局部 state——创作者常停在「目录树」做章节定位，
// 每次重开工作室回到「元素」拖拽货架。与批②右栏宽/折叠态同主题（三栏布局记忆）：
// tab 选中态也落 localStorage；非法值（代码场景残留 layers/plugins/files）由既有
// 兑底 effect 收敛，且兑底改走 selectTab（写盘），避免「显示 entities / 落盘 layers」不一致。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(`${process.cwd()}/src/editor/panels/ComponentCenterPanel.tsx`, 'utf8');

describe('工作室左栏 Tab 持久化', () => {
  it('定义 localStorage 键（与工作室三栏布局同前缀）', () => {
    expect(SRC).toMatch(/LEFT_TAB_KEY = 'sight-folio:studio\.leftPanelTab'/);
  });
  it('初始值从 localStorage 读取', () => {
    expect(SRC).toMatch(/useState<LeftPanelTab>\(readSavedLeftPanelTab\)/);
  });
  it('读取带白名单校验（脏值回 entities）', () => {
    expect(SRC).toMatch(/includes\(raw\)/);
  });
  it('onChange 与兑底都走 selectTab（写盘，显示与落盘一致）', () => {
    expect(SRC).toMatch(/onChange=\{\(_, v\) => selectTab\(v as LeftPanelTab\)\}/);
    // 兑底 effect 内不再裸 setTab
    expect(SRC).toMatch(/files'\)\) selectTab\('entities'\)/);
    expect(SRC).not.toMatch(/setTab\('entities'\)/);
  });
});
