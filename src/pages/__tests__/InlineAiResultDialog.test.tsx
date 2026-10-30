// 逐句审校结果对话框 · 逐条确认应用（T3 回归锁）
//
// 这条测试锁死：
// ① review 有条目时逐条渲染（第 N 句 / 问题 / 原句 / 建议 /「应用此句」按钮）；
// ② 点击「应用此句」只调 onApplyReviewEntry 且按钮进入「已应用」禁用态（绝无静默改写）；
// ③ review 无条目（如「未发现明显语法问题」）退回纯文本预览；
// ④ 非 review 类型保持原预览 + 整体应用按钮，review 不显示整体应用按钮。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { setLang } from '../../i18n';
import { InlineAiResultDialog, type InlineAiResult } from '../writingPage/InlineAiResultDialog';
import type { ReviewEntry } from '../../ai/writingAssistant';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mountAsync(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

const reviewEntries: ReviewEntry[] = [
  { index: 1, original: '他是我的一个朋友。', issue: '成分赘余', suggestion: '他是我朋友。' },
  { index: 2, original: '他再次复发。', issue: '冗余表达', suggestion: '他复发了。' },
];

function reviewResult(over: Partial<InlineAiResult> = {}): InlineAiResult {
  return { kind: 'review', text: '第1句|他是我的一个朋友。|成分赘余|他是我朋友。', ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  setLang('zh-CN');
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

describe('InlineAiResultDialog（T3 逐条审校应用）', () => {
  it('review 有条目：逐条渲染第 N 句/问题/原句/建议与「应用此句」按钮', async () => {
    await mountAsync(
      <InlineAiResultDialog
        result={reviewResult({
          text: '第1句|他是我的一个朋友。|成分赘余|他是我朋友。\n第2句|他再次复发。|冗余表达|他复发了。',
        })}
        onClose={() => {}}
        onApply={() => {}}
        onApplyReviewEntry={() => {}}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('第 1 句');
    expect(text).toContain('成分赘余');
    expect(text).toContain('他是我的一个朋友。');
    expect(text).toContain('他是我朋友。');
    expect(text).toContain('第 2 句');
    expect(text).toContain('冗余表达');
    expect(text).toContain('他再次复发。');
    expect(text).toContain('他复发了。');
    // 每条都有「应用此句」
    const appliers = Array.from(document.body.querySelectorAll<HTMLElement>('button')).filter(
      (b) => b.textContent === '应用此句',
    );
    expect(appliers).toHaveLength(2);
    // review 不显示整体应用按钮（applyToChapter / insertToChapter）
    const allButtons = Array.from(document.body.querySelectorAll<HTMLElement>('button')).map((b) => b.textContent);
    expect(allButtons.some((bt) => bt && /\b(应用|插入)\b/.test(bt) && bt !== '应用此句')).toBe(false);
  });

  it('点击「应用此句」：仅回调该条 entry 且按钮进入「已应用」禁用态', async () => {
    const onApplyReviewEntry = vi.fn();
    await mountAsync(
      <InlineAiResultDialog
        result={reviewResult({
          text: '第1句|他是我的一个朋友。|成分赘余|他是我朋友。\n第2句|他再次复发。|冗余表达|他复发了。',
        })}
        onClose={() => {}}
        onApply={() => {}}
        onApplyReviewEntry={onApplyReviewEntry}
      />,
    );
    const appliers = Array.from(document.body.querySelectorAll<HTMLElement>('button')).filter(
      (b) => b.textContent === '应用此句',
    );
    expect(appliers).toHaveLength(2);
    await act(async () => {
      appliers[0].click();
    });
    expect(onApplyReviewEntry).toHaveBeenCalledTimes(1);
    expect(onApplyReviewEntry).toHaveBeenCalledWith(reviewEntries[0]);
    // 第一条变为「已应用」且禁用；第二条仍可应用
    const after = Array.from(document.body.querySelectorAll<HTMLElement>('button'));
    const applied = after.find((b) => b.textContent === '已应用');
    expect(applied).toBeTruthy();
    expect((applied as HTMLButtonElement).disabled).toBe(true);
    const remain = after.filter((b) => b.textContent === '应用此句');
    expect(remain).toHaveLength(1);
  });

  it('重复点击同一句不会重复触发回调（已有应用态短路）', async () => {
    const onApplyReviewEntry = vi.fn();
    await mountAsync(
      <InlineAiResultDialog
        result={reviewResult({ text: '第1句|他是我的一个朋友。|成分赘余|他是我朋友。' })}
        onClose={() => {}}
        onApply={() => {}}
        onApplyReviewEntry={onApplyReviewEntry}
      />,
    );
    const one = Array.from(document.body.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent === '应用此句',
    )!;
    await act(async () => {
      one.click();
      one.click();
    });
    expect(onApplyReviewEntry).toHaveBeenCalledTimes(1);
  });

  it('review 无条目（如「未发现明显语法问题」）：退回纯文本预览且无应用按钮', async () => {
    await mountAsync(
      <InlineAiResultDialog
        result={reviewResult({ text: '未发现明显语法问题。' })}
        onClose={() => {}}
        onApply={() => {}}
        onApplyReviewEntry={() => {}}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('未发现明显语法问题。');
    const buttons = Array.from(document.body.querySelectorAll<HTMLElement>('button')).map((b) => b.textContent);
    expect(buttons.some((bt) => bt === '应用此句')).toBe(false);
  });

  it('非 review 类型：不渲染逐条列表，保持整体应用按钮（onApply）', async () => {
    const onApply = vi.fn();
    await mountAsync(
      <InlineAiResultDialog
        result={{ kind: 'polish', text: '润色后的句子。', selectionChars: 6 }}
        onClose={() => {}}
        onApply={onApply}
        onApplyReviewEntry={() => {}}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('润色后的句子。');
    // 选区替换提示
    expect(text).toContain('替换');
    const apply = Array.from(document.body.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent === '应用到章节',
    );
    expect(apply).toBeTruthy();
    await act(async () => {
      apply!.click();
    });
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('润色无选区（整章替换）：显示「将替换整章」警示且不显示选区字数提示', async () => {
    await mountAsync(
      <InlineAiResultDialog
        result={{ kind: 'polish', text: '润色后的整章正文。' }}
        onClose={() => {}}
        onApply={() => {}}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('将替换整章正文');
    expect(text).not.toContain('将替换选中的');
  });

  it('润色有选区：显示选区字数提示，不显示整章替换警示', async () => {
    await mountAsync(
      <InlineAiResultDialog
        result={{ kind: 'polish', text: '润色后的句子。', selectionChars: 8 }}
        onClose={() => {}}
        onApply={() => {}}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('将替换选中的 8 字');
    expect(text).not.toContain('将替换整章正文');
  });

  it('未提供 onApplyReviewEntry 时按钮不渲染，审校保持只读', async () => {
    await mountAsync(
      <InlineAiResultDialog
        result={reviewResult({ text: '第1句|他是我的一个朋友。|成分赘余|他是我朋友。' })}
        onClose={() => {}}
        onApply={() => {}}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('他是我的一个朋友。');
    const buttons = Array.from(document.body.querySelectorAll<HTMLElement>('button')).map((b) => b.textContent);
    expect(buttons.some((bt) => bt === '应用此句')).toBe(false);
  });
});
