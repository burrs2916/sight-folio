// 素材库「插入正文」通路回归锁（2026-10-31，第十一轮 批③ · 新需求兑现）
//
// 缺口来源：第十轮发掘——素材卡片此前只有 查看 / 重新分析 / 删除，采到的素材要进正文
// 只能靠手抄；而 WritingPage 侧插入工具链早已就位（MaterialAssistDialog 的 onInsertText
// → 同章 handleInspirationInsert / 跨章 pendingMaterialInsertRef）。本轮补最后一段。
//
// 口径决策：插入内容**由用户选**（素材原文 / AI 创作价值 / AI 建议），不在代码里替他拍板，
// 因为三者都可能是作者真正想要的东西；取不到内容的菜单项禁用，绝不插入空串造空白段落。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

vi.mock('../../../i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'zh-CN',
  L: (zh: string) => zh,
}));

// list 返回值可变：用例按需喂素材
const listState = { rows: [] as unknown[] };
vi.mock('../../../services/writing', () => ({
  externalCapturesApi: {
    list: vi.fn(async () => listState.rows),
    save: vi.fn(),
    delete: vi.fn(),
  },
  parseCaptureAnalysis: (v: string) => (v ? JSON.parse(v) : {}),
  parseCaptureTags: () => [] as string[],
}));
vi.mock('../../../ai/writingCapture', () => ({
  buildCaptureAnalysisMessage: () => '',
  normalizeCaptureAnalysis: (x: unknown) => x,
  runCaptureTask: vi.fn(),
  tryParseCaptureJson: () => null,
}));
const toasts: Array<[string, string]> = [];
vi.mock('../../../store/toastStore', () => ({
  useToastStore: {
    getState: () => ({
      success: (m: string) => toasts.push(['success', m]),
      error: (m: string) => toasts.push(['error', m]),
      warning: (m: string) => toasts.push(['warning', m]),
      info: (m: string) => toasts.push(['info', m]),
    }),
  },
}));

import { buildCaptureInsertText } from '../captureInsert';
import { ExternalCapturePanel } from '../ExternalCapturePanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeCapture = (extractedText: string, analysis: unknown, id = 'c1') =>
  ({
    id,
    title: '素材',
    kind: 'text',
    sourceRaw: '',
    tags: '',
    extractedText,
    analysisJson: JSON.stringify(analysis),
  }) as never;

describe('buildCaptureInsertText 三种口径', () => {
  it('raw = 素材原文（trim 后）', () => {
    expect(buildCaptureInsertText('raw', makeCapture('  原文内容  ', {}), {})).toBe('原文内容');
  });
  it('value = AI 创作价值', () => {
    expect(buildCaptureInsertText('value', makeCapture('raw', {}), { creativeValue: ' 价值 ' })).toBe('价值');
  });
  it('suggestions = 建议逐条成段，空条目被丢弃', () => {
    expect(
      buildCaptureInsertText('suggestions', makeCapture('raw', {}), { suggestions: [' 建议一 ', '', '建议二'] }),
    ).toBe('建议一\n建议二');
  });
  it('三种口径取不到内容时一律返回 null（不产生空白段落）', () => {
    expect(buildCaptureInsertText('raw', makeCapture('   ', {}), {})).toBeNull();
    expect(buildCaptureInsertText('value', makeCapture('raw', {}), { creativeValue: '  ' })).toBeNull();
    expect(buildCaptureInsertText('suggestions', makeCapture('raw', {}), { suggestions: [] })).toBeNull();
    expect(buildCaptureInsertText('suggestions', makeCapture('raw', {}), { suggestions: null })).toBeNull();
  });
});

describe('ExternalCapturePanel 插入入口（真实渲染与点击）', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    listState.rows = [];
    toasts.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function renderPanel(onInsertText?: (t: string) => void) {
    await act(async () => {
      root.render(
        <StrictMode>
          <ExternalCapturePanel
            bookId="b1"
            onOpenCapture={() => {}}
            refreshKey={0}
            agentId=""
            agents={[]}
            onInsertText={onInsertText}
          />
        </StrictMode>,
      );
    });
    await act(async () => {}); // 等 list promise 落地
  }

  // MUI MenuItem 根元素是 li：禁用态落在 Mui-disabled class + aria-disabled，非原生 disabled
  const isDisabled = (el: Element) =>
    el.classList.contains('Mui-disabled') || el.getAttribute('aria-disabled') === 'true';

  const click = async (el: Element | null) => {
    if (!el) throw new Error('元素不存在');
    await act(async () => {
      (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('未传 onInsertText：不渲染插入入口（旧调用方零回归）', async () => {
    listState.rows = [makeCapture('素材原文', { creativeValue: '价值', suggestions: ['建议'] })];
    await renderPanel(undefined);
    expect(document.querySelector('[data-testid="capture-insert-c1"]')).toBeNull();
  });

  it('传入 onInsertText：渲染入口，点开后三个口径齐备且均可用', async () => {
    listState.rows = [makeCapture('素材原文', { creativeValue: '价值', suggestions: ['建议'] })];
    await renderPanel(vi.fn());
    const trigger = document.querySelector('[data-testid="capture-insert-c1"]');
    expect(trigger).not.toBeNull();
    await click(trigger);
    for (const part of ['raw', 'value', 'suggestions']) {
      const item = document.querySelector(`[data-testid="capture-insert-${part}"]`);
      expect(item).not.toBeNull();
      expect(isDisabled(item!)).toBe(false);
    }
  });

  it('点「素材原文」= 插入原文并提示成功', async () => {
    const onInsertText = vi.fn();
    listState.rows = [makeCapture('这是采到的原文', { creativeValue: '价值', suggestions: ['建议'] })];
    await renderPanel(onInsertText);
    await click(document.querySelector('[data-testid="capture-insert-c1"]'));
    await click(document.querySelector('[data-testid="capture-insert-value"]'));
    expect(onInsertText).toHaveBeenCalledWith('价值');
    expect(toasts).toContainEqual(['success', 'writing.captureInserted']);
  });

  it('点「AI 建议」= 多条建议合并为一段插入', async () => {
    const onInsertText = vi.fn();
    listState.rows = [makeCapture('原文', { creativeValue: '价值', suggestions: ['建议一', '建议二'] })];
    await renderPanel(onInsertText);
    await click(document.querySelector('[data-testid="capture-insert-c1"]'));
    await click(document.querySelector('[data-testid="capture-insert-suggestions"]'));
    expect(onInsertText).toHaveBeenCalledWith('建议一\n建议二');
  });

  it('无可插入内容的口径：菜单项禁用，点不到也就不插入', async () => {
    const onInsertText = vi.fn();
    listState.rows = [makeCapture('原文', { creativeValue: '', suggestions: [] })];
    await renderPanel(onInsertText);
    await click(document.querySelector('[data-testid="capture-insert-c1"]'));
    expect(isDisabled(document.querySelector('[data-testid="capture-insert-value"]')!)).toBe(true);
    expect(isDisabled(document.querySelector('[data-testid="capture-insert-suggestions"]')!)).toBe(true);
    // 原文有内容 → 仍可插入
    expect(isDisabled(document.querySelector('[data-testid="capture-insert-raw"]')!)).toBe(false);
  });

  it('穿透点击禁用项也不会插入（MUI 在 disabled 项上直接拦截，handleInsert 不触发）', async () => {
    const onInsertText = vi.fn();
    listState.rows = [makeCapture('原文', { creativeValue: '', suggestions: [] })];
    await renderPanel(onInsertText);
    await click(document.querySelector('[data-testid="capture-insert-c1"]'));
    await click(document.querySelector('[data-testid="capture-insert-value"]'));
    expect(onInsertText).not.toHaveBeenCalled();
    // 无成功提示 = 没有任何东西落进正文
    expect(toasts.some(([k]) => k === 'success')).toBe(false);
  });
});
