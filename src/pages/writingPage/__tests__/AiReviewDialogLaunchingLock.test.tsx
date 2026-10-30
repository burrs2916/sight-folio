// AI 审视对话框「发射中锁定」回归锁（2026-10-31，第十一轮 批②）
//
// 与内联 AI 同一病灶、同一口径：handleLaunchAi 用发起时的 aiPresetKey + aiAgentId 派发任务，
// 发射期间这两个 RadioGroup 仍可点 → UI 显示改成预设 B / Agent B，实际派发的仍是预设 A / Agent A，
// 用户对着错位的选择等结论。launching 期间一律禁用。
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'zh-CN',
  pickLang: (v: { zh?: string; en?: string }) => v?.zh ?? '',
}));

import { AiReviewDialog } from '../AiReviewDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRESETS = [
  { key: 'pace', title: { zh: '节奏' }, description: { zh: '整体节奏' } },
  { key: 'logic', title: { zh: '逻辑' }, description: { zh: '设定自洽' } },
] as never;
const AGENTS = [{ id: 'a1', name: 'One' }, { id: 'a2', name: 'Two' }] as never;

const baseProps = {
  open: true,
  onClose: () => {},
  presetKey: 'pace',
  onPresetChange: () => {},
  writingPresets: PRESETS,
  agentId: 'a1',
  onAgentChange: () => {},
  agents: AGENTS,
  onGoSettings: () => {},
  onLaunch: () => {},
  launching: false,
  bookAvailable: true,
  onViewInsights: () => {},
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Partial<typeof baseProps>) {
  act(() => {
    root.render(
      <StrictMode>
        <AiReviewDialog {...baseProps} {...props} />
      </StrictMode>,
    );
  });
  // 预设 2 + Agent 2 = 4
  return Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
}

describe('AiReviewDialog 发射中锁定', () => {
  it('launching=true：预设与 Agent 全部禁用', () => {
    const list = render({ launching: true });
    expect(list.length).toBe(4);
    expect(list.every((r) => r.disabled)).toBe(true);
  });

  it('launching=false：全部可选（零回归）', () => {
    const list = render({ launching: false });
    expect(list.length).toBe(4);
    expect(list.some((r) => r.disabled)).toBe(false);
  });
});
