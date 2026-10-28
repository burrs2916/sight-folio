// sight-folio: B3 Show-not-Tell 顾问面板 · 组件回归锁
// ① 直述句卡片渲染：情绪分类标签 + 改写方向 + 示范改写；
// ② 点击「召回库内示范句」以情绪词检索语料库并渲染出处卡片（经 filterReferenceHits 过滤）；
// ③ 无命中显示"库内暂无可用示范句"；④ 点击卡片回调 onLocate。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => {
  return {
    search: vi.fn(),
  };
});

vi.mock('../../services/corpus', () => ({
  corpusApi: {
    search: h.search,
  },
}));

import { ShowTellPanel } from '../writingPage/ShowTellPanel';
import type { ShowTellIssue } from '../../utils/showTell';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS = {
  title: 'Show-not-Tell 顾问',
  empty: '没有需要提示的情绪直述句',
  hint: '短句直接贴情绪标签会被识别',
  told: '直述',
  directions: '改写方向',
  rewriteExample: '示范改写',
  recall: '召回库内示范句',
  recalling: '召回中…',
  recalled: '库内示范句',
  noRecall: '库内暂无可用示范句',
  locate: '定位到正文',
  count: '共 {n} 项',
};

const KIND_LABELS = {
  joy: '正面情绪',
  sadness: '悲伤',
  fear: '恐惧',
  anger: '愤怒',
  love: '依恋',
  calm: '释然',
  tension: '焦灼',
  general: '抽象标签',
} as const;

const ISSUES: ShowTellIssue[] = [
  {
    start: 0,
    end: 6,
    excerpt: '她很难过。',
    emotionWord: '难过',
    emotionKind: 'sadness',
    short: '「难过」是抽象情绪标签',
    directions: ['写动作细节：垂头、抠衣角', '写生理反应：眼眶发烫'],
    rewriteExample: '他垂下头，指尖慢慢攥紧衣角。',
  },
  {
    start: 7,
    end: 13,
    excerpt: '他很愤怒。',
    emotionWord: '愤怒',
    emotionKind: 'anger',
    short: '「愤怒」是抽象情绪标签',
    directions: ['写身体的克制：攥拳又松开'],
    rewriteExample: '他攥紧拳头又松开，一个字也没说。',
  },
];

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
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

describe('Show-not-Tell 顾问面板（B3）', () => {
  it('渲染直述句卡片：情绪标签 + 方向 + 示范改写', async () => {
    await mountAsync(
      <ShowTellPanel
        open
        onClose={() => {}}
        issues={ISSUES}
        onLocate={() => {}}
        onRecall={async () => []}
        labels={LABELS}
        kindLabels={KIND_LABELS}
      />,
    );
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('她很难过。');
    expect(bodyText).toContain('悲伤');
    expect(bodyText).toContain('写动作细节：垂头、抠衣角');
    expect(bodyText).toContain('他垂下头，指尖慢慢攥紧衣角。');
    expect(bodyText).toContain(LABELS.count.replace('{n}', '2'));
  });

  it('点击卡片以该句偏移回调 onLocate', async () => {
    const onLocate = vi.fn();
    await mountAsync(
      <ShowTellPanel
        open
        onClose={() => {}}
        issues={ISSUES}
        onLocate={onLocate}
        onRecall={async () => []}
        labels={LABELS}
        kindLabels={KIND_LABELS}
      />,
    );
    const cards = Array.from(document.body.querySelectorAll('[data-testid="showtell-card"]'));
    expect(cards).toHaveLength(2);
    await act(async () => {
      cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(onLocate.mock.calls[0][0]).toMatchObject({ start: 0, end: 6, emotionWord: '难过' });
  });

  it('召回库内示范句：以情绪词检索，渲染出处卡片；命中为空给出降级文案', async () => {
    h.search
      .mockResolvedValueOnce({
        books: [],
        hits: [
          {
            chunkId: 1,
            bookId: 1,
            bookTitle: '样本集',
            seq: 1,
            kind: 'text',
            chapterTitle: '第一章',
            content: '他垂下头，指尖慢慢攥紧衣角。',
            referenceTier: 'high',
            analysis: { charCount: 16, tokenCount: 3 },
            occurrenceCount: 1,
            occurrences: [],
          },
        ],
        total: 1,
      })
      .mockResolvedValue({ books: [], hits: [], total: 0 });
    await mountAsync(
      <ShowTellPanel
        open
        onClose={() => {}}
        issues={ISSUES}
        onLocate={() => {}}
        onRecall={async (iss) => {
          const res = await h.search(iss.emotionWord, null, 10, 0);
          return res.hits.map((x: any) => ({ book: x.bookTitle, chapter: x.chapterTitle, content: x.content }));
        }}
        labels={LABELS}
        kindLabels={KIND_LABELS}
      />,
    );

    // 第一条召回：命中 → 渲染出处卡片
    const recallBtns = Array.from(document.body.querySelectorAll('button[aria-label="召回库内示范句"]'));
    await act(async () => {
      recallBtns[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(h.search).toHaveBeenNthCalledWith(1, '难过', null, 10, 0);
    expect(document.body.textContent).toContain('样本集 · 第一章');

    // 第二条召回：无命中 → 降级文案
    const recallBtns2 = Array.from(document.body.querySelectorAll('button[aria-label="召回库内示范句"]'));
    await act(async () => {
      recallBtns2[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(document.body.textContent).toContain(LABELS.noRecall);
  });

  it('空问题列表显示空态', async () => {
    await mountAsync(
      <ShowTellPanel
        open
        onClose={() => {}}
        issues={[]}
        onLocate={() => {}}
        onRecall={async () => []}
        labels={LABELS}
        kindLabels={KIND_LABELS}
      />,
    );
    expect(document.body.textContent).toContain(LABELS.empty);
    expect(document.body.querySelector('[data-testid="showtell-card"]')).toBeNull();
  });
});
