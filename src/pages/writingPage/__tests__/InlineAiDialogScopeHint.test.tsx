// 内联 AI 对话框「作用范围」提示测试（需求缺口③，2026-10-31 第七轮续）
//
// 锁的是文案澄清，不是行为：改写/润色在无选区时走「整章处理」（buildPolishMessage 的刻意
// 设计——见铁律①：无选区 polish=整章替换 setContent 是正确预期，绝不改 append）。旧版只在
// 有选区时提示，无选区时一片空白，用户易误以为仍只改当前段，结果整章被替换才发现。
// 这里钉两条可见性：无选区→整章警示可见；有选区→选区提示可见。行为一字未动。
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params && 'n' in params ? `${key}:${params.n}` : key,
  getLang: () => 'zh-CN',
}));

import type { InlineWritingKind } from '../../../ai/writingAssistant';
import { InlineAiDialog } from '../InlineAiDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  open: true,
  onClose: () => {},
  onKindChange: () => {},
  agents: [],
  agentId: '',
  onAgentChange: () => {},
  onGoSettings: () => {},
  words: '',
  onWordsChange: () => {},
  directive: '',
  onDirectiveChange: () => {},
  style: 'default' as const,
  onStyleChange: () => {},
  styleConsistency: false,
  onStyleConsistencyChange: () => {},
  styleFingerprintAvailable: false,
  running: false,
  streamText: '',
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

// MUI Dialog 经 portal 渲染到 document.body（非 host 内），断言统一查 document.body；
// afterEach 卸载 root 时 MUI 同步清掉 portal 节点，用例之间不残留。
const render = (props: { kind: InlineWritingKind; selChars: number }) =>
  act(() => {
    root.render(
      <StrictMode>
        <InlineAiDialog {...baseProps} {...props} />
      </StrictMode>,
    );
  });

describe('InlineAiDialog 作用范围提示', () => {
  it('润色 + 无选区 → 展示整章处理警示（发起前就看得见）', () => {
    render({ kind: 'polish', selChars: 0 });
    expect(document.body.textContent).toContain('writing.inlineWholeChapterHint');
    expect(document.body.textContent).not.toContain('writing.inlineSelectionHint');
  });

  it('润色 + 有选区 → 展示选区提示，不出整章警示', () => {
    render({ kind: 'polish', selChars: 12 });
    expect(document.body.textContent).toContain('writing.inlineSelectionHint:12');
    expect(document.body.textContent).not.toContain('writing.inlineWholeChapterHint');
  });

  it('改写 · 无选区 → 整章警示', () => {
    render({ kind: 'rewrite', selChars: 0 });
    expect(document.body.textContent).toContain('writing.inlineWholeChapterHint');
  });

  it('改写 · 有选区 → 选区提示', () => {
    render({ kind: 'rewrite', selChars: 5 });
    expect(document.body.textContent).toContain('writing.inlineSelectionHint:5');
  });

  it('续写不受影响：既不整章警示也无选区提示（作用范围文案仅 polish/rewrite）', () => {
    render({ kind: 'continue', selChars: 0 });
    expect(document.body.textContent).not.toContain('writing.inlineWholeChapterHint');
    expect(document.body.textContent).not.toContain('writing.inlineSelectionHint');
  });
});
