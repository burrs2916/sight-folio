// 「补全草稿事件」工作台测试。
//
// 它是体检报告 `tl:drafts` 汇总行的就地出口。这个组件的价值全在几条约束上，
// 所以这里逐条钉：只列缺字段的、说清缺哪个、没补全不许写库（免得写进半个事件把
// 数据搞得更乱）、失败必须在 originating 行上看得见、补完后报告那行自己消失。
import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const saved: Array<{ id: string; patch: Record<string, unknown> }> = [];
let saveShouldFail = false;

const state = {
  timelineEvents: [] as unknown[],
  updateTimelineEvent: null as unknown as (
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<void>,
};

const runSave = async (id: string, patch: Record<string, unknown>) => {
  if (saveShouldFail) throw new Error('disk full');
  saved.push({ id, patch });
  // 真 store 会换数组引用，这里照做，好让"补完后消失"可观察
  state.timelineEvents = (state.timelineEvents as { id: string }[]).map((e) =>
    e.id === id ? { ...e, ...patch } : e,
  );
};
state.updateTimelineEvent = runSave;

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('../../../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, lang: 'zh-CN' }),
}));
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { TimelineDraftDialog } from '../TimelineDraftDialog';

const ev = (id: string, at: string, event: string) =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at,
    event,
    chapterId: null,
    storylineId: null,
    timeKey: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as never;

let host: HTMLDivElement;
let root: Root;

const render = () => {
  act(() =>
    root.render(
      <StrictMode>
        <TimelineDraftDialog open onClose={() => {}} />
      </StrictMode>,
    ),
  );
};
const text = () => document.body.textContent ?? '';
const saveButtons = () =>
  [...document.body.querySelectorAll('button')].filter((b) =>
    b.textContent?.includes('ui.save'),
  );
const type = async (el: HTMLElement, value: string) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  // 取输入靠 DOM 顺序（组件里「时点」在前、「事件」在后），不依赖 aria-label
  saved.length = 0;
  saveShouldFail = false;
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

/** 按渲染顺序取第 n 行的两个输入（时点在前、描述在后） */
const rowInputs = (n = 0) => {
  const inputs = [...document.body.querySelectorAll('input')] as HTMLInputElement[];
  return { at: inputs[n * 2]!, event: inputs[n * 2 + 1]! };
};

describe('TimelineDraftDialog', () => {
  it('只列缺字段的事件，完整的那条根本不出现', () => {
    state.timelineEvents = [ev('ok', '第1年', '开战'), ev('d1', '', '某事')] as never;
    render();
    expect(text()).toContain('writing.timelineDraftMissingAt');
    expect(text()).not.toContain('writing.timelineDraftMissingEvent');
    // 完整事件不该占工作台的位置：还剩 1 条，不是 2 条
    expect(text()).toContain('writing.timelineDraftRemaining');
    expect(document.body.querySelectorAll('input')).toHaveLength(2);
  });

  it('两个都缺时说明写「都缺」，不假装只缺一个', () => {
    state.timelineEvents = [ev('d1', '', '')] as never;
    render();
    expect(text()).toContain('writing.timelineDraftBoth');
  });

  it('没补全不许保存：只填一个字段时按钮保持禁用（否则会写进半个事件）', async () => {
    state.timelineEvents = [ev('d1', '', '已有描述')] as never;
    render();
    const { at, event } = rowInputs(0);
    const btn0 = saveButtons()[0]!;
    expect(btn0.hasAttribute('disabled')).toBe(true); // 时点还空着

    await type(at, '第5年');
    expect(saveButtons()[0]!.hasAttribute('disabled')).toBe(false);

    // 反过来把时点清空，按钮必须重新禁用（校验看的是当前值，不是"曾经填过"）
    await type(at, '');
    expect(saveButtons()[0]!.hasAttribute('disabled')).toBe(true);
    void event;
  });

  it('保存写入的是 trim 后的两个字段，走的是既有 updateTimelineEvent', async () => {
    state.timelineEvents = [ev('d1', '  ', '  已有描述  ')] as never;
    render();
    const { at } = rowInputs(0);
    await type(at, '  第5年  ');
    await act(async () => {
      saveButtons()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({
      id: 'd1',
      patch: { at: '第5年', event: '已有描述' },
    });
  });

  it('补完后这一行自己消失（工作台与报告同源：都来自 isComplete）', async () => {
    state.timelineEvents = [ev('d1', '', '已有描述')] as never;
    render();
    const { at } = rowInputs(0);
    await type(at, '第5年');
    await act(async () => {
      saveButtons()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(text()).toContain('writing.timelineDraftWorkbenchEmpty');
    expect(document.body.querySelectorAll('input')).toHaveLength(0);
  });

  it('落库失败 → 就地报出原因，不许假装补完', async () => {
    saveShouldFail = true;
    state.timelineEvents = [ev('d1', '', '已有描述')] as never;
    render();
    const { at } = rowInputs(0);
    await type(at, '第5年');
    await act(async () => {
      saveButtons()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(text()).toContain('writing.timelineDraftSaveFailed');
    // 仍然是那条草稿：行没消失、计数没减，作者看得见"还没补上"
    expect(text()).not.toContain('writing.timelineDraftWorkbenchEmpty');
    expect(document.body.querySelectorAll('input')).toHaveLength(2);
  });
});

describe('工作台文案键的词典审计（不经过 mock）', () => {
  const ROOT = process.cwd();
  const src = readFileSync(`${ROOT}/src/pages/writingPage/TimelineDraftDialog.tsx`, 'utf8');

  it('组件用到的每个 writing.* / ui.* 键都能在双语词典查到', () => {
    const keys = new Set<string>();
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThanOrEqual(9);
    for (const file of ['zh-CN', 'en-US']) {
      const dict = JSON.parse(readFileSync(`${ROOT}/src/i18n/${file}.json`, 'utf8'));
      for (const k of keys) {
        const hit = k
          .split('.')
          .reduce<Record<string, unknown> | undefined>(
            (o, seg) => (o?.[seg] !== undefined ? (o[seg] as never) : undefined),
            dict as never,
          );
        expect(hit, `${file}.json 缺键 ${k}（界面会显示裸键）`).toBeTruthy();
      }
    }
  });

  it('文案里的 {param} 占位符不能是代码不会传的', () => {
    // 上一轮就写漏过一次：英文案文里有 {n}，代码却没传 n → 界面照字面显示 "{n}"
    const zh = readFileSync(`${ROOT}/src/i18n/zh-CN.json`, 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'(?:,\s*\{\s*([^}]*?)\s*\})?/g)) {
      const key = m[1];
      const passed = (m[2] ?? '')
        .split(',')
        .map((s) => s.trim().split(':')[0]!.trim())
        .filter(Boolean);
      if (key === 'ui.save' || key === 'ui.close') continue;
      const entry = JSON.parse(zh).writing[key] as string | undefined;
      if (!entry) continue;
      const wanted = [...entry.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
      for (const w of wanted) {
        expect(passed, `${key} 案文用了 {${w}} 但代码没传`).toContain(w);
      }
    }
  });
});
