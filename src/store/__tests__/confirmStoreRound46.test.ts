// 全局危险动作确认的行为锁（2026-11-04 李先生删除铁律：删除前必须确认 + 讲清后果）。
//
// 钉死的契约：
// 1. 用户没点确认，onConfirm **一次都不许执行**；取消只关窗；
// 2. 点了确认执行且**只执行一次**；先清态再回调，所以 onConfirm 里再发新请求必须能成功；
// 3. 同时只允许一张确认卡：后来的**丢弃**而非排队（排队＝答完一张又一张，弹到麻木）；
// 4. 后果清单为空属违规：仍然要弹（不能顺手吞掉确认），但必须留下 warn 痕迹；
// 5. 三个已整改入口必须继续走本出口，不许回退成一点即删（源码扫描锁）。
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirmDestructive, useConfirmStore } from '../confirmStore';

const warnSpy = vi.hoisted(() => vi.fn());
vi.mock('../../utils/logger', () => ({ logger: { warn: warnSpy, error: warnSpy, info: warnSpy } }));

const base = {
  title: '删除全部 3 条草稿？',
  impact: ['它们从时间线画布与右栏列表一起消失。', '这条路径没有撤销栈。'],
  confirmLabel: '全部删除草稿',
  cancelLabel: '取消',
};

describe('confirmStore（删除的唯一确认出口）', () => {
  beforeEach(() => {
    useConfirmStore.setState({ pending: null });
    warnSpy.mockClear();
  });

  it('只发起不确认 = 一次都不执行', () => {
    const onConfirm = vi.fn();
    confirmDestructive({ ...base, onConfirm });
    expect(useConfirmStore.getState().pending).not.toBeNull();
    useConfirmStore.getState().settle(false);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it('确认才执行，且只执行一次', () => {
    const onConfirm = vi.fn();
    confirmDestructive({ ...base, onConfirm });
    useConfirmStore.getState().settle(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // 已经关掉的确认卡不能被再 settle 一次（否则同一次删除跑两遍）
    useConfirmStore.getState().settle(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('先清态再回调：onConfirm 里再发一次确认要能弹出来', () => {
    const next = vi.fn();
    confirmDestructive({
      ...base,
      onConfirm: () => confirmDestructive({ ...base, onConfirm: next }),
    });
    useConfirmStore.getState().settle(true);
    expect(useConfirmStore.getState().pending).not.toBeNull();
    useConfirmStore.getState().settle(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('一次只允许一张卡：第二张丢弃而不是排队', () => {
    const a = vi.fn();
    const b = vi.fn();
    confirmDestructive({ ...base, title: '第一张', onConfirm: a });
    confirmDestructive({ ...base, title: '第二张', onConfirm: b });
    expect(useConfirmStore.getState().pending?.title).toBe('第一张');
    useConfirmStore.getState().settle(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it('后果清单为空仍然弹，但必须留 warn 痕迹（不许悄悄放行也不许吞掉确认）', () => {
    const onConfirm = vi.fn();
    confirmDestructive({ ...base, impact: [], onConfirm });
    expect(warnSpy).toHaveBeenCalled();
    expect(useConfirmStore.getState().pending).not.toBeNull();
  });

  it('源码扫描锁：三个已整改入口必须继续走 confirmDestructive', () => {
    const sites = [
      'src/editor/renderers/writingPanes.tsx',
      'src/pages/WritingBookSearchDialog.tsx',
      'src/editor/panels/CanvasLayerPanel.tsx',
    ];
    for (const rel of sites) {
      const src = readFileSync(`${process.cwd()}/${rel}`, 'utf8');
      expect(src, `${rel} 必须引用全局确认出口`).toContain('confirmDestructive');
    }
  });
});
