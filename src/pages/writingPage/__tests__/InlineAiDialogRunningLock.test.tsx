// 内联 AI「运行中锁定参数」回归锁（2026-10-31，第十一轮 批②）
//
// 事故：handleRunInline 在**发起那一刻**用闭包捕获 inlineKind / inlineAgentId /
// inlineWords / inlineDirective / inlineStyle，之后请求与最终结果一律按这套发起值执行；
// 但对话框里的模式、Agent、字数、走向、风格档在生成期间仍是可点的——用户点了「总结」，
// UI 立刻显示选中「总结」，而实际仍在跑「润色」。生成结束后拿到的仍是**润色结果**，
// 结果窗按 kind=polish 给出「应用到正文」按钮 → 用户以为刚才是只读预览（总结不写正文），
// 点下去却把整段替换进了正文。作者本意有迹可循：同框的文风一致性开关早已写了
// disabled={running}，只有其余控件漏了锁。
//
// 修法：running 期间锁死全部影响本次生成语义的控件（模式 / Agent / 字数 / 走向 / 风格档），
// 并在流式预览区明示「本次结果按发起时的设置生成，如需改设置请先停止生成」。
// 不改任何生成与应用逻辑（铁律①：无选区 polish=整章替换仍是正确预期）。
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params && 'n' in params ? `${key}:${params.n}` : key,
  getLang: () => 'zh-CN',
}));

import type { InlineWritingKind, PolishStyle } from '../../../ai/writingAssistant';
import { InlineAiDialog } from '../InlineAiDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AGENTS = [
  { id: 'a1', name: 'Agent One' },
  { id: 'a2', name: 'Agent Two' },
] as never;

const baseProps = {
  open: true,
  onClose: () => {},
  kind: 'polish' as InlineWritingKind,
  onKindChange: () => {},
  selChars: 0,
  agents: AGENTS,
  agentId: 'a1',
  onAgentChange: () => {},
  onGoSettings: () => {},
  words: '500',
  onWordsChange: () => {},
  directive: '往紧张方向走',
  onDirectiveChange: () => {},
  style: 'refine' as PolishStyle,
  onStyleChange: () => {},
  styleConsistency: true,
  onStyleConsistencyChange: () => {},
  styleFingerprintAvailable: true,
  running: false,
  streamText: '生成中的文本……',
  streamPreviewRef: { current: null },
  onStop: () => {},
  onRun: () => {},
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

// MUI Dialog 经 portal 渲染到 document.body
function render(props: Partial<typeof baseProps> = {}) {
  act(() => {
    root.render(
      <StrictMode>
        <InlineAiDialog {...baseProps} {...props} />
      </StrictMode>,
    );
  });
  return document.body;
}

/** 取所有单选项（模式 + Agent + 风格档混在一起，用 aria-label 值域区分） */
const radios = (scope: HTMLElement) =>
  Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
const inputs = (scope: HTMLElement) => Array.from(scope.querySelectorAll<HTMLInputElement>('input'));

describe('running=true：影响本次生成语义的控件全部锁定', () => {
  it('模式 / Agent / 风格档 radio 一律 disabled（无一个漏锁）', () => {
    const scope = render({ kind: 'polish', running: true });
    const list = radios(scope);
    // 5 个模式 + 2 个 Agent + 4 个风格档 = 11
    expect(list.length).toBe(11);
    expect(list.filter((r) => r.disabled).length).toBe(list.length);
  });

  it('字数与走向输入框 disabled', () => {
    const scope = render({ kind: 'continue', running: true });
    const texts = inputs(scope).filter((i) => i.type === 'text' || i.type === 'number');
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((i) => i.disabled)).toBe(true);
  });

  it('锁定提示可见，告诉用户结果按发起设置生成', () => {
    const scope = render({ running: true });
    expect(scope.textContent).toContain('writing.inlineLockedHint');
  });
});

describe('running=false：控件保持可用（零回归）', () => {
  it('模式 / Agent / 风格档 radio 可点', () => {
    const scope = render({ kind: 'rewrite', running: false });
    const list = radios(scope);
    expect(list.length).toBe(11);
    expect(list.some((r) => r.disabled)).toBe(false);
  });

  it('字数与走向输入框可编辑', () => {
    const scope = render({ kind: 'continue', running: false });
    const texts = inputs(scope).filter((i) => i.type === 'text' || i.type === 'number');
    expect(texts.every((i) => !i.disabled)).toBe(true);
  });

  it('未运行时不显示锁定提示（不占空间、不误导）', () => {
    const scope = render({ running: false });
    expect(scope.textContent).not.toContain('writing.inlineLockedHint');
  });
});

describe('模式/风格清单收敛为常量表（漏一项就是漏锁）', () => {
  it('五个模式标签与四个风格标签都按清单渲染出来', () => {
    const scope = render({ running: false });
    const labels = Array.from(scope.querySelectorAll('label')).map((l) => l.textContent);
    for (const k of ['continue', 'polish', 'rewrite', 'summarize', 'review']) {
      expect(labels).toContain(`writing.inline${k[0].toUpperCase()}${k.slice(1)}`);
    }
    for (const s of ['default', 'refine', 'vivid', 'plain']) {
      expect(labels).toContain(`writing.style${s[0].toUpperCase()}${s.slice(1)}`);
    }
  });
});
