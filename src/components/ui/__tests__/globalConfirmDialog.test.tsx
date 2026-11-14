// 全局确认弹窗的形状锁（2026-11-04 删除铁律：后果要**逐条**看得见，动作用动词 + error 色）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import GlobalConfirmDialog from '../GlobalConfirmDialog';
import { confirmDestructive, useConfirmStore } from '../../../store/confirmStore';

vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params
      ? `${key}:${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}`
      : key,
}));

describe('GlobalConfirmDialog', () => {
  beforeEach(() => {
    useConfirmStore.setState({ pending: null });
  });
  afterEach(cleanup);

  it('没有待确认项时不渲染内容', () => {
    render(<GlobalConfirmDialog />);
    expect(screen.queryByTestId('global-confirm-ok')).toBeNull();
  });

  it('后果逐条上屏，标题与按钮都在', () => {
    confirmDestructive({
      title: '删除图层「正文层」？',
      impact: ['该层及其子层上的 7 个组件一并删除。', '可用「撤销」（Ctrl+Z）恢复。'],
      confirmLabel: '删除图层',
      cancelLabel: '取消',
      onConfirm: vi.fn(),
    });
    render(<GlobalConfirmDialog />);
    const lines = screen.getAllByTestId('global-confirm-impact').map((el) => el.textContent);
    expect(lines).toEqual(['· 该层及其子层上的 7 个组件一并删除。', '· 可用「撤销」（Ctrl+Z）恢复。']);
    expect(screen.getByText('删除图层「正文层」？')).toBeTruthy();
  });

  it('点确认才执行；点取消只关窗', () => {
    const onConfirm = vi.fn();
    confirmDestructive({
      title: '清空全部 12 条搜索历史？',
      impact: ['只清搜索记录，不动正文。'],
      confirmLabel: '清空历史',
      cancelLabel: '取消',
      onConfirm,
    });
    render(<GlobalConfirmDialog />);
    fireEvent.click(screen.getByText('取消'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().pending).toBeNull();

    act(() => {
      confirmDestructive({
        title: '清空全部 12 条搜索历史？',
        impact: ['只清搜索记录，不动正文。'],
        confirmLabel: '清空历史',
        cancelLabel: '取消',
        onConfirm,
      });
    });
    fireEvent.click(screen.getByTestId('global-confirm-ok'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useConfirmStore.getState().pending).toBeNull();
  });
});
