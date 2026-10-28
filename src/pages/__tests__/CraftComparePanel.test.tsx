// sight-folio: C3 写法对照工作台 · 组件回归锁
// ① 「召回对照句」以源句走 corpusApi.search(query, null, 20, 0)；
// ② 命中渲染对照卡片（出处 + 节奏徽标），勾选后交 AI 改写（onRequestRewrite 带 original + references）；
// ③ 无命中显示空态且改写按钮禁用。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => {
  return {
    search: vi.fn(),
  };
});

vi.mock('../../services/tauri', () => ({
  corpusApi: {
    search: h.search,
  },
}));

import { CraftComparePanel, type CraftReference } from '../writingPage/CraftComparePanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS = {
  title: '写法对照工作台',
  hint: '输入或选中平淡句',
  source: '源句',
  recall: '召回对照句',
  recalling: '召回中…',
  empty: '未找到可对照的优质句',
  tempoLonger: '句更长',
  tempoShorter: '句更短',
  tempoSimilar: '节奏相当',
  original: '源句',
  reference: '已选对照',
  rewrite: '请 AI 对照改写',
};

/** 受控源句的宿主组件（模拟父层持有 source state） */
function Harness({
  initial = '我的平淡原句，不知道怎么写。',
  onRewrite,
}: {
  initial?: string;
  onRewrite: (p: { original: string; references: CraftReference[] }) => void;
}) {
  const [src, setSrc] = useState(initial);
  return (
    <CraftComparePanel
      open
      onClose={() => {}}
      source={src}
      onSourceChange={setSrc}
      onRequestRewrite={onRewrite}
      labels={LABELS}
    />
  );
}

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

/** flush 检索的 promise 微任务 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function clickTextBtn(testId: string) {
  const el = document.body.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

describe('写法对照工作台（C3）', () => {
  it('点击「召回对照句」以源句检索语料库，渲染对照卡片并支持勾选交 AI 改写', async () => {
    h.search.mockResolvedValue({
      books: [],
      hits: [
        {
          chunkId: 1,
          bookId: 1,
          bookTitle: '样本集',
          seq: 1,
          kind: 'text',
          chapterTitle: '第一章',
          content: '风把雨丝斜着送过来，敲在窗上，像有人叩门。',
          referenceTier: 'high',
          analysis: { charCount: 24, tokenCount: 4 },
          occurrenceCount: 1,
          occurrences: [],
        },
        {
          chunkId: 2,
          bookId: 1,
          bookTitle: '样本集',
          seq: 2,
          kind: 'text',
          chapterTitle: '第二章',
          content: '他很平静。',
          referenceTier: 'low',
          analysis: { charCount: 5, tokenCount: 2 },
          occurrenceCount: 1,
          occurrences: [],
        },
      ],
      total: 2,
    });
    const onRewrite = vi.fn();
    await mountAsync(<Harness onRewrite={onRewrite} />);

    await clickTextBtn('craft-compare-recall');

    await flush();
    // 检索参数：源句原文、不限书、limit 20、offset 0
    expect(h.search).toHaveBeenCalledWith('我的平淡原句，不知道怎么写。', null, 20, 0);
    // low 碎片句被 filterReferenceHits 剔除，只渲染 1 张对照卡片
    const cards = Array.from(document.body.querySelectorAll('[data-testid="craft-compare-card"]'));
    expect(cards).toHaveLength(1);
    const cardText = cards[0].textContent ?? '';
    expect(cardText).toContain('样本集 · 第一章');
    expect(cardText).toContain('风把雨丝斜着送过来');

    // 未勾选时改写按钮禁用
    const rewriteBtn = document.body.querySelector('[data-testid="craft-compare-rewrite"]') as HTMLButtonElement;
    expect(rewriteBtn.disabled).toBe(true);

    // 勾选卡片 → 改写按钮可用 → 点改写 → onRequestRewrite 收到 original + references
    await act(async () => {
      cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(rewriteBtn.disabled).toBe(false);

    await clickTextBtn('craft-compare-rewrite');
    expect(onRewrite).toHaveBeenCalledTimes(1);
    const payload = onRewrite.mock.calls[0][0];
    expect(payload.original).toBe('我的平淡原句，不知道怎么写。');
    expect(payload.references).toEqual([
      { book: '样本集', chapter: '第一章', content: '风把雨丝斜着送过来，敲在窗上，像有人叩门。' },
    ]);
  });

  it('无命中时显示空态，改写按钮保持禁用', async () => {
    h.search.mockResolvedValue({ books: [], hits: [], total: 0 });
    await mountAsync(<Harness onRewrite={() => {}} />);

    await clickTextBtn('craft-compare-recall');
    await flush();

    expect(document.body.textContent).toContain(LABELS.empty);
    expect(document.body.querySelector('[data-testid="craft-compare-card"]')).toBeNull();
    const rewriteBtn = document.body.querySelector('[data-testid="craft-compare-rewrite"]') as HTMLButtonElement;
    expect(rewriteBtn.disabled).toBe(true);
  });

  it('检索失败时给出空态（不崩溃），改写按钮禁用', async () => {
    h.search.mockRejectedValue(new Error('corpus boom'));
    await mountAsync(<Harness onRewrite={() => {}} />);

    await clickTextBtn('craft-compare-recall');
    await flush();

    expect(document.body.textContent).toContain(LABELS.empty);
    const rewriteBtn = document.body.querySelector('[data-testid="craft-compare-rewrite"]') as HTMLButtonElement;
    expect(rewriteBtn.disabled).toBe(true);
  });
});
