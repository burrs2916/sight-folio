// sight-folio: 校对面板（①一键修复 / ③标点专项 / ④冗余表达）组件回归锁
//   - 带 fix 的条目（typo/punct/redundant）显示一键修复按钮，点击回调 onFix(issue)
//   - 无 fix 的条目（引号/括号配对问题）不显示修复按钮
//   - 类别 chip 计数：typo / repeat / punct / sensitive / redundant 各自独立统计
//   - 空清单显示空态
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { ProofreadPanel } from '../writingPage/ProofreadPanel';
import type { ProofreadIssue } from '../../editor/proofread/proofreadEngine';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS = {
  title: '校对',
  empty: '未发现问题',
  hint: '修改正文后自动复检',
  typo: '疑似错别字',
  repeat: '重复用词',
  sensitive: '敏感词',
  punct: '标点规范',
  redundant: '冗余表达',
  count: '共 {n} 项',
  locate: '定位到正文',
  fix: '一键修复',
};

const ISSUES: ProofreadIssue[] = [
  {
    kind: 'typo',
    start: 4,
    end: 8,
    excerpt: '他行事一诺千斤。',
    suggestion: '应为「一诺千金」',
    fix: '一诺千金',
  },
  {
    kind: 'punct',
    start: 10,
    end: 11,
    excerpt: '他很感动…',
    suggestion: '省略号应使用两个「……」',
    fix: '……',
  },
  {
    kind: 'punct',
    start: 12,
    end: 13,
    excerpt: '他说：“你好。',
    suggestion: '左引号「“」未闭合：缺少对应的右引号「”」',
  },
  {
    kind: 'repeat',
    start: 0,
    end: 6,
    excerpt: '我不信我不信。',
    suggestion: '「我不信」重复出现',
  },
  {
    kind: 'sensitive',
    start: 8,
    end: 11,
    excerpt: '文中提到法轮功。',
    severity: 'block',
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

async function unmount() {
  await act(async () => {
    root!.unmount();
  });
  host?.remove();
  root = null;
  host = null;
}

describe('ProofreadPanel', () => {
  it('渲染 5 类问题，chip 各自计数', async () => {
    await mountAsync(<ProofreadPanel open onClose={() => {}} issues={ISSUES} onLocate={() => {}} labels={LABELS} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('共 5 项');
    expect(body).toContain('疑似错别字 1');
    expect(body).toContain('重复用词 1');
    expect(body).toContain('敏感词 1');
    expect(body).toContain('标点规范 2');
    await unmount();
  });

  it('仅带 fix 的条目（typo / punct 省略号）显示一键修复按钮，点击回调 onFix', async () => {
    const onFix = vi.fn();
    const onLocate = vi.fn();
    await mountAsync(
      <ProofreadPanel open onClose={() => {}} issues={ISSUES} onLocate={onLocate} onFix={onFix} labels={LABELS} />,
    );
    const fixButtons = document.querySelectorAll('[aria-label="一键修复"]');
    expect(fixButtons.length).toBe(2);
    // 点击第一个（typo 一诺千斤）→ 回调带该 issue
    (fixButtons[0] as HTMLButtonElement).click();
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onFix.mock.calls[0][0]).toMatchObject({ kind: 'typo', fix: '一诺千金' });
    await unmount();
  });

  it('无 fix 条目（引号配对）不渲染修复按钮；定位按钮可用', async () => {
    const onLocate = vi.fn();
    await mountAsync(<ProofreadPanel open onClose={() => {}} issues={ISSUES} onLocate={onLocate} labels={LABELS} />);
    // 不含 onFix 时即使有 fix 也不渲染按钮（空态保护）
    expect(document.querySelectorAll('[aria-label="一键修复"]').length).toBe(0);
    expect(document.querySelectorAll('[aria-label="定位到正文"]').length).toBe(5);
    (document.querySelectorAll('[aria-label="定位到正文"]')[2] as HTMLButtonElement).click();
    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(onLocate.mock.calls[0][0]).toMatchObject({ kind: 'punct' });
    await unmount();
  });

  it('空清单显示空态文案', async () => {
    await mountAsync(<ProofreadPanel open onClose={() => {}} issues={[]} onLocate={() => {}} labels={LABELS} />);
    expect(document.body.textContent ?? '').toContain('未发现问题');
    await unmount();
  });

  it('冗余表达条目显示类别 chip 与修复按钮，点击回调 onFix', async () => {
    const rdIssues: ProofreadIssue[] = [
      {
        kind: 'redundant',
        start: 0,
        end: 4,
        excerpt: '他亲眼目睹了全程。',
        suggestion: '「亲眼目睹」语义冗余，可精简为「目睹」',
        fix: '目睹',
      },
    ];
    const onFix = vi.fn();
    await mountAsync(
      <ProofreadPanel open onClose={() => {}} issues={rdIssues} onLocate={() => {}} onFix={onFix} labels={LABELS} />,
    );
    const body = document.body.textContent ?? '';
    expect(body).toContain('冗余表达 1');
    expect(body).toContain('可精简为「目睹」');
    const fixButtons = document.querySelectorAll('[aria-label="一键修复"]');
    expect(fixButtons.length).toBe(1);
    (fixButtons[0] as HTMLButtonElement).click();
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onFix.mock.calls[0][0]).toMatchObject({ kind: 'redundant', fix: '目睹' });
    await unmount();
  });
});
