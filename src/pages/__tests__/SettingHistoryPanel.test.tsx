// 设定卡「修改历史」面板测试（批次③ 增-3 收口）。
//
// 重点不是"能不能点开"，而是三条会让作者丢内容的性质：
//  1. 恢复之前必须先把编辑框里未落库的按键 flush 掉（顺序错了就丢输入或被 pending 盖回）
//  2. 「没有记录」与「读取失败」必须是两种界面（后者说"没有"是在骗作者）
//  3. 失败要留在原地并可见，绝不让界面看起来恢复成功了
import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = { list: vi.fn(), restore: vi.fn() };
const toasts: Array<{ kind: string; msg: string }> = [];

vi.mock('../../services/tauri', () => ({
  writingSettingRevisionsApi: {
    list: (...a: unknown[]) => api.list(...a),
    restore: (...a: unknown[]) => api.restore(...a),
  },
}));
vi.mock('../../i18n', () => ({
  default: () => ({ t: (key: string) => key }),
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: {
    getState: () => ({
      success: (msg: string) => toasts.push({ kind: 'success', msg }),
      error: (msg: string) => toasts.push({ kind: 'error', msg }),
    }),
  },
}));

import { SettingHistoryPanel } from '../writingPage/SettingHistoryPanel';
import type { WritingSetting, WritingSettingRevision } from '../../services/tauri';

const card = (over: Partial<WritingSetting> = {}): WritingSetting =>
  ({
    id: 's1',
    bookId: 'b1',
    kind: 'character',
    name: '沈砚',
    subtitle: '',
    description: '',
    extra: '{}',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as WritingSetting;

const rev = (over: Partial<WritingSettingRevision> = {}): WritingSettingRevision =>
  ({
    id: 'r1',
    settingId: 's1',
    bookId: 'b1',
    name: '旧的卡名',
    subtitle: '旧身份',
    description: '被 AI 替换掉的旧描述',
    extra: '{}',
    origin: 'ai',
    createdAt: 1_700_000_000,
    ...over,
  }) as WritingSettingRevision;

describe('SettingHistoryPanel', () => {
  let host: HTMLDivElement;
  let root: Root;
  let restored: WritingSetting[];
  let order: string[];
  let beforeRestore: () => Promise<void>;

  const render = (setting: WritingSetting) => {
    act(() => root.render(
      <StrictMode>
        <SettingHistoryPanel setting={setting} onBeforeRestore={beforeRestore} onRestored={(s) => restored.push(s)} />
      </StrictMode>,
    ));
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    api.list.mockReset();
    api.restore.mockReset();
    toasts.length = 0;
    restored = [];
    order = [];
    beforeRestore = async () => { order.push('before'); };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const header = () => host.querySelector('[aria-expanded]') as HTMLElement;
  /** MUI Dialog 渲染在 body 的 portal 里，host 内查不到——确认/取消必须去那儿找 */
  const dialog = () => [...document.querySelectorAll('.MuiDialog-container')].pop() as HTMLElement;
  const dialogButton = (label: string) =>
    [...dialog().querySelectorAll('button')].find((b) => (b.textContent || '').includes(label))!;
  const expand = async () => {
    await act(async () => header().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  it('展开前不查库：卡编辑面板常开，历史很少看，不该每次都打一遍', async () => {
    api.list.mockResolvedValue([]);
    render(card());
    expect(api.list).not.toHaveBeenCalled();
    await expand();
    expect(api.list).toHaveBeenCalledWith('s1', 50);
  });

  it('列出被替换掉的旧值与来源，作者靠它判断是不是这一版', async () => {
    api.list.mockResolvedValue([rev(), rev({ id: 'r2', origin: 'restore', description: '恢复前顶掉的描述' })]);
    render(card());
    await expand();
    const text = host.textContent || '';
    expect(text).toContain('被 AI 替换掉的旧描述');
    expect(text).toContain('恢复前顶掉的描述');
    expect(text).toContain('旧的卡名');
    // 两种来源要分得开：作者得知道这条是 AI 改的还是自己恢复时产生的
    expect(text).toContain('writing.settingHistoryOriginAi');
    expect(text).toContain('writing.settingHistoryOriginRestore');
  });

  it('「没有记录」与「读取失败」是两种界面，失败不能伪装成空', async () => {
    api.list.mockResolvedValue([]);
    render(card());
    await expand();
    expect(host.textContent).toContain('writing.settingHistoryEmpty');

    // 换卡＝重建：外层契约是 key={setting.id}，测试用新 root 模拟同样的效果
    act(() => root.unmount());
    root = createRoot(host);
    api.list.mockReset();
    api.list.mockRejectedValue(new Error('db locked'));
    render(card({ id: 's2' }));
    await expand();
    const text = host.textContent || '';
    expect(text).toContain('writing.settingHistoryLoadFailed');
    expect(text).not.toContain('writing.settingHistoryEmpty');
    // 失败要能重试
    expect(text).toContain('ui.retry');
  });

  it('恢复先落库编辑框内容、再调接口；顺序颠倒就会丢作者刚敲的字', async () => {
    api.list.mockResolvedValue([rev()]);
    api.restore.mockImplementation(async () => { order.push('restore'); return card({ description: '旧描述' }); });
    render(card());
    await expand();

    const restoreBtn = [...host.querySelectorAll('button')]
      .find((b) => (b.textContent || '').includes('writing.settingHistoryRestore'))!;
    // 第一击只弹确认，不直接改数据
    await act(async () => { restoreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(api.restore).not.toHaveBeenCalled();

    await act(async () => {
      dialogButton('writing.settingHistoryRestore').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(order).toEqual(['before', 'restore']);
    expect(api.restore).toHaveBeenCalledWith('s1', 'r1');
    expect(restored).toHaveLength(1);
    expect(restored[0].description).toBe('旧描述');
    expect(toasts.some((x) => x.kind === 'success')).toBe(true);
  });

  it('恢复失败：报错可见、不回调 onRestored、界面不假装成功', async () => {
    api.list.mockResolvedValue([rev()]);
    api.restore.mockRejectedValue(new Error('设定卡不存在'));
    render(card());
    await expand();

    const btn = [...host.querySelectorAll('button')]
      .find((b) => (b.textContent || '').includes('writing.settingHistoryRestore'))!;
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {
      dialogButton('writing.settingHistoryRestore').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(toasts.some((x) => x.kind === 'error' && x.msg.includes('设定卡不存在'))).toBe(true);
    expect(restored).toHaveLength(0);
  });

  it('取消确认弹窗时不得产生任何写入', async () => {
    api.list.mockResolvedValue([rev()]);
    render(card());
    await expand();
    const btn = [...host.querySelectorAll('button')]
      .find((b) => (b.textContent || '').includes('writing.settingHistoryRestore'))!;
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {
      dialogButton('ui.cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(api.restore).not.toHaveBeenCalled();
    // beforeRestore 是普通 async 函数（非 spy），不能对它断言 toHaveBeenCalled；
    // "有没有执行过任何一步"由下面的 order 覆盖。
    expect(order).toEqual([]);
  });

  /**
   * 上面的用例把 t() mock 成了恒等函数，因此只能断言 key、看不见"漏翻译"。
   * 这条不经过 mock：直接把面板源码里用到的键，对两份词典各核一遍。
   * （本轮就是这样抓到我在面板里引用了三个并不存在的 common.* 键。）
   */
  it('面板用到的文案键必须在中英文词典里都存在', () => {
    // vitest 下 import.meta.url 不是 file: scheme，readFileSync 会直接拒；用项目根拼路径
    const src = readFileSync('src/pages/writingPage/SettingHistoryPanel.tsx', 'utf8');
    const used = [...src.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const loc of ['zh-CN', 'en-US']) {
      const dict: unknown = JSON.parse(readFileSync(`src/i18n/${loc}.json`, 'utf8'));
      const has = (key: string) =>
        key
          .split('.')
          .reduce<unknown>(
            (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
            dict,
          ) !== undefined;
      expect(used.filter((k) => !has(k)), `${loc} 缺键`).toEqual([]);
    }
  });
});
