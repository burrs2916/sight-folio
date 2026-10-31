// 全局设置抽屉「假保存按钮」回归锁（2026-10-31，第十四轮）
//
// 病灶：所有设置项（颜色模式/主题色/字号/圆角/布局/外观预设）在每个 store action 内
// 即时 persist 落盘，不存在「未保存」状态。但底部原有一颗「✓ 确认设置」按钮，其
// handleSave 仅 setSaved(true) 弹一个假「已保存 ✓」chip、不写任何数据——典型死控件：
// 误导创作者「不点保存就不生效」，并与「重置」并列加重误解。本批移除它，
// 改为「自动保存」诚实提示 + 明确「关闭设置」出口。
//
// 锁：① 不再出现 handleSave / setSaved / settings.confirm / settings.saved；
//     ② 底部出现 autoSaveNote 提示 + settings.close 出口。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(`${process.cwd()}/src/components/layout/SettingsDrawer.tsx`, 'utf8');

describe('设置抽屉无假保存死控件', () => {
  it('不再引用 settings.confirm（确认设置死按钮）', () => {
    expect(SRC).not.toMatch(/settings\.confirm/);
  });
  it('不再引用 settings.saved（假已保存 chip）', () => {
    expect(SRC).not.toMatch(/settings\.saved/);
  });
  it('无 handleSave / setSaved 假保存逻辑', () => {
    expect(SRC).not.toMatch(/handleSave/);
    expect(SRC).not.toMatch(/setSaved/);
  });
  it('底部出现自动保存诚实提示 + 关闭出口', () => {
    expect(SRC).toMatch(/settings\.autoSaveNote/);
    expect(SRC).toMatch(/settings\.close/);
  });
});
