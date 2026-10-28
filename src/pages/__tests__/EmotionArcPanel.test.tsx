// sight-folio: A3 情感弧线分析面板 · 组件回归锁
// ① 段落列表渲染情感强度与主导情绪标签；② 平淡区/断层徽标可见；
// ③ 点击段落行回调 onLocate（携带 start/end 偏移）；④ 空段显示空态。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { EmotionArcPanel } from '../writingPage/EmotionArcPanel';
import type { EmotionArcSegment } from '../../utils/emotionArc';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS = {
  title: '情感弧线分析',
  empty: '本章暂无情感波动可分析',
  hint: '按段落给出情感强度与主导情绪',
  flat: '平淡区',
  breakpoint: '断层',
  flatCount: '平淡 {n}',
  breakCount: '断层 {n}',
  locate: '定位到正文',
};

const EMOTION_LABELS = {
  joy: '喜悦',
  sadness: '悲伤',
  fear: '恐惧',
  anger: '愤怒',
  love: '依恋',
  calm: '释然',
  tension: '焦灼',
  none: '无情绪',
} as const;

const SEGMENTS: EmotionArcSegment[] = [
  { index: 0, text: '他走进房间。', start: 0, end: 6, emotion: 'none', intensity: 1, flat: true, breakpoint: false },
  {
    index: 1,
    text: '她忽然害怕得发抖。',
    start: 7,
    end: 15,
    emotion: 'fear',
    intensity: 4,
    flat: false,
    breakpoint: false,
  },
  {
    index: 2,
    text: '他开心得跳起来。',
    start: 16,
    end: 24,
    emotion: 'joy',
    intensity: 4,
    flat: false,
    breakpoint: true,
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

describe('情感弧线分析面板（A3）', () => {
  it('渲染段落列表：情绪标签 + 强度 + 平淡/断层徽标', async () => {
    await mountAsync(
      <EmotionArcPanel
        open
        onClose={() => {}}
        segments={SEGMENTS}
        onLocate={() => {}}
        labels={LABELS}
        emotionLabels={EMOTION_LABELS}
      />,
    );
    const rows = Array.from(document.body.querySelectorAll('[data-testid="emotion-arc-seg"]'));
    expect(rows).toHaveLength(3);
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('恐惧');
    expect(bodyText).toContain('喜悦');
    expect(bodyText).toContain(LABELS.flat);
    expect(bodyText).toContain(LABELS.breakpoint);
    // 汇总 chips
    expect(bodyText).toContain('平淡 1');
    expect(bodyText).toContain('断层 1');
  });

  it('点击段落行以该段 start/end 回调 onLocate', async () => {
    const onLocate = vi.fn();
    await mountAsync(
      <EmotionArcPanel
        open
        onClose={() => {}}
        segments={SEGMENTS}
        onLocate={onLocate}
        labels={LABELS}
        emotionLabels={EMOTION_LABELS}
      />,
    );
    const rows = Array.from(document.body.querySelectorAll('[data-testid="emotion-arc-seg"]'));
    expect(rows).toHaveLength(3);
    await act(async () => {
      rows[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(onLocate.mock.calls[0][0]).toMatchObject({ start: 16, end: 24, emotion: 'joy' });
  });

  it('空段（无正文）显示空态而不崩溃', async () => {
    await mountAsync(
      <EmotionArcPanel
        open
        onClose={() => {}}
        segments={[]}
        onLocate={() => {}}
        labels={LABELS}
        emotionLabels={EMOTION_LABELS}
      />,
    );
    expect(document.body.textContent).toContain(LABELS.empty);
    expect(document.body.querySelector('[data-testid="emotion-arc-seg"]')).toBeNull();
  });
});
