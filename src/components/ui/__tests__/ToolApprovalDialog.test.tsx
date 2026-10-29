// 高危工具审批弹窗测试。
//
// 这个文件存在的首要原因是一次真实事故：审批弹窗原先只挂在工作台 AI 面板里，而写作侧的
// AI 助手页同样会下发 write_chapter / update_character_card。引擎发出审批请求后等满 5 分钟
// 无人应答，按「拒绝」收场——功能表现为「AI 说我没批准」，但用户从头到尾没见过弹窗。
// 所以除了行为断言，这里还有两条**源码审计**：挂载位置必须覆盖所有窗口、且全仓只能有一处
// 渲染它（两处同时绑同一个 store 字段会双弹）。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve as resolvePath } from 'node:path';

const resolved: Array<[boolean, boolean]> = [];

const state = {
  pendingToolApproval: null as null | {
    runId: string;
    toolCallId: string;
    tool: string;
    command: string;
    cwd: string;
    summary: string;
    sessionRememberable: boolean;
  },
  resolveToolApproval: async (approved: boolean, rememberSession = false) => {
    resolved.push([approved, rememberSession]);
  },
};

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { ToolApprovalDialog } from '../ToolApprovalDialog';

const ROOT = process.cwd();
const pending = (over: Partial<NonNullable<typeof state.pendingToolApproval>> = {}) => ({
  runId: 'r1',
  toolCallId: 'tc1',
  tool: 'update_character_card',
  command: '',
  cwd: '',
  summary: '修订《沈砚》：描述 → 新增别名「二哥」',
  sessionRememberable: true,
  ...over,
});

describe('ToolApprovalDialog', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = () => {
    act(() => root.render(<StrictMode><ToolApprovalDialog /></StrictMode>));
  };
  /** MUI Dialog 渲染在 body 的 portal 里，host 内查不到 */
  const dialog = () => [...document.querySelectorAll('.MuiDialog-container')].pop() as HTMLElement | undefined;
  const button = (label: string) =>
    [...dialog()!.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));
  const click = async (label: string) => {
    await act(async () => button(label)!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    state.pendingToolApproval = null;
    resolved.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('没有待审批请求时不渲染任何对话框', () => {
    render();
    expect(dialog()).toBeUndefined();
  });

  it('写入类：把摘要原样给作者看，并提供拒绝/允许/允许且记住三个出口', async () => {
    state.pendingToolApproval = pending();
    render();
    expect(dialog()).toBeTruthy();
    expect(dialog()!.textContent).toContain('修订《沈砚》：描述 → 新增别名「二哥」');
    expect(button('workbench.aiApproval.deny')).toBeTruthy();
    expect(button('workbench.aiApproval.allowSession')).toBeTruthy();
  });

  it('非记住型请求不给「本会话不再询问」——否则等于替作者放宽了闸门', async () => {
    state.pendingToolApproval = pending({ sessionRememberable: false });
    render();
    expect(button('workbench.aiApproval.allowSession')).toBeUndefined();
  });

  it('命令类展示 `$ cwd> cmd` 而不展示摘要，避免作者把命令行当成自然语言放过', async () => {
    state.pendingToolApproval = pending({ tool: 'run_command', command: 'rm -rf target', cwd: '/tmp/x' });
    render();
    expect(dialog()!.textContent).toContain('$ /tmp/x> rm -rf target');
    expect(dialog()!.textContent).not.toContain('修订《沈砚》');
  });

  it('点拒绝只回 false，不带记住位', async () => {
    state.pendingToolApproval = pending();
    render();
    await click('workbench.aiApproval.deny');
    expect(resolved).toEqual([[false, false]]);
  });

  it('点「允许且本会话不再询问」必须把记住位传下去', async () => {
    state.pendingToolApproval = pending();
    render();
    await click('workbench.aiApproval.allowSession');
    expect(resolved).toEqual([[true, true]]);
  });
});

describe('词典与挂载位置（源码审计，不经过 mock）', () => {
  const src = readFileSync(resolvePath(process.cwd(), 'src/components/ui/ToolApprovalDialog.tsx'), 'utf8');
  const zh = JSON.parse(readFileSync(resolvePath(ROOT, 'src/i18n/zh-CN.json'), 'utf8'));
  const en = JSON.parse(readFileSync(resolvePath(ROOT, 'src/i18n/en-US.json'), 'utf8'));
  const dig = (o: unknown, key: string) =>
    key.split('.').reduce<unknown>((c, p) => (c && typeof c === 'object' ? (c as Record<string, unknown>)[p] : undefined), o);

  // 这一条是另一次事故的教训：当时凭空写了 common.loading/cancel，6 条 UI 测试因为
  // 把 t() mock 成恒等函数而全绿，界面实际显示的是裸 key。
  it('组件里用到的每个 i18n key 都必须真实存在于双语词典', () => {
    const keys = [...src.matchAll(/\bt\('([\w.]+)'\)/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) {
      expect(typeof dig(zh, k), `zh 缺 ${k}`).toBe('string');
      expect(typeof dig(en, k), `en 缺 ${k}`).toBe('string');
    }
  });

  it('审批弹窗挂在 App 层的每一个窗口分支上', () => {
    const app = readFileSync(resolvePath(ROOT, 'src/App.tsx'), 'utf8');
    const mounts = [...app.matchAll(/<ToolApprovalDialog \/>/g)].length;
    // AppLayout（主窗口 + 写作台独立窗口）与独立工作台窗口各自一份，少一处就会有窗口静默超时
    expect(mounts).toBeGreaterThanOrEqual(2);
  });

  it('全仓只允许一个组件渲染 pendingToolApproval（两处绑定会双弹）', () => {
    const out = execSync(
      "grep -rln 'state.pendingToolApproval\\|s.pendingToolApproval' src --include='*.ts' --include='*.tsx'",
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    const consumers = out.filter(
      (f) => !f.includes('/store/') && !f.includes('__tests__') && !f.includes('__bench__'),
    );
    expect(consumers).toEqual(['src/components/ui/ToolApprovalDialog.tsx']);
  });
});
