// 写作台体检报告的跳转接线。
//
// 这个面板此前有个隐蔽的功能洞：只有「章节」「设定卡」两类发现可点，其余（伏笔 / 时间线
// 事件 / 念头 / 剧情线）整行不可点，鼠标悬上去只写「请到画布中处理」。可作者绝大多数时间
// 就在写作台这个窗口，体检报告于是退化成「只能看、不能修」。跳转协议（writingDeskJump）
// 本来就支持跨窗口精确联动，这里钉住三件事：有目标就能点、载荷带对 id、别把就地打开的
// 两类也推给跨窗口协议。
import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatched: unknown[] = [];
const jumps: string[] = [];
const openedSettings: string[] = [];
let closed = 0;

// 就地重排要用到的外部件：toast 与章选择器。选择器换成桩件，好直接断言"给了哪些候选章"
const toastSuccess = vi.fn();
const toastError = vi.fn();

const state = {
  chapters: [] as unknown[],
  outlines: [] as unknown[],
  timelineEvents: [] as unknown[],
  foreshadowings: [] as unknown[],
  storylines: [] as unknown[],
  settings: [] as unknown[],
  books: [{ id: 'b1', title: '长夜将尽', genre: 'serial' }] as unknown[],
  activeBookId: 'b1',
  // 槽位先占住，紧接着被下面的替身覆盖；替身会真的改写 state.foreshadowings，
  // 好让「修好后这一行从报告里消失」可被观察
  updateForeshadowing: null as unknown as (
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<void>,
};

const updateForeshadowing = vi.fn(async (id: string, patch: Record<string, unknown>) => {
  state.foreshadowings = (state.foreshadowings as { id: string }[]).map((f) =>
    f.id === id ? { ...f, ...patch } : f,
  );
});
state.updateForeshadowing = updateForeshadowing;
vi.mock('../../store/writingStore', () => ({
  useWritingStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}));
vi.mock('../../utils/writingDeskJump', () => ({
  dispatchChapterJump: (p: unknown) => dispatched.push(p),
}));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ success: toastSuccess, error: toastError }) },
}));
vi.mock('../../editor/renderers/ChapterPicker', () => ({
  default: ({ chapters, onSelect }: { chapters: { id: string }[]; onSelect: (id: string) => void }) => (
    <div data-testid="payoff-picker">
      {chapters.map((c) => (
        <button key={c.id} data-testid={`payoff-pick-${c.id}`} onClick={() => onSelect(c.id)}>
          {c.id}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../../services/writing', () => ({ saveTextFile: vi.fn() }));
vi.mock('../../utils/writingHealthReport', () => ({
  buildHealthReportHtml: vi.fn(),
  buildHealthReportMarkdown: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));

import { WritingHealthDialog } from '../writingPage/WritingHealthDialog';

const ch = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    bookId: 'b1',
    title: id,
    content: '正文',
    sortOrder: 0,
    wordCount: 100,
    status: 'draft',
    volume: '',
    kind: '章',
    extra: '{}',
    storylineId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as never;

const ev = (id: string, storylineId: string | null, chapterId: string | null) =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at: `日-${id}`,
    event: `事件 ${id}`,
    chapterId,
    storylineId,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as never;

// 挂载脚手架提到模块级：两个 describe 共用同一个弹窗渲染入口
let host: HTMLDivElement;
let root: Root;

const render = () => {
  act(() =>
    root.render(
      <StrictMode>
        <WritingHealthDialog
          open
          onClose={() => {
            closed += 1;
          }}
          onJumpChapter={(id) => jumps.push(id)}
          onOpenSetting={(id) => openedSettings.push(id)}
        />
      </StrictMode>,
    ),
  );
};
/** 点某个 testid（data-testid 里带冒号，只能走属性选择器）。缺元素时报出 testid，
 *  比 "cannot read dispatchEvent of null" 好定位。 */
const tap = async (testid: string) => {
  const el = document.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`找不到元素 ${testid}`);
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const row = (key: string) => document.querySelector(`[data-testid="health-row-${key}"]`) as HTMLElement;
const click = (key: string) => tap(`health-row-${key}`);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  dispatched.length = 0;
  jumps.length = 0;
  openedSettings.length = 0;
  closed = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('写作台体检报告跳转', () => {
  beforeEach(() => {
    state.chapters = [ch('c1', { content: '', wordCount: 0 })];
    state.outlines = [];
    state.timelineEvents = [ev('e1', null, 'c1'), ev('e2', 'sl1', null), ev('e3', 'sl1', null)];
    state.foreshadowings = [];
    state.storylines = [{ id: 'sl1', name: '南疆线' }];
    state.settings = [];
  });

  it('章节类：就地跳章，不走跨窗口协议', async () => {
    render();
    expect(row('c1:empty')).toBeTruthy();
    await click('c1:empty');
    expect(jumps).toEqual(['c1']);
    expect(dispatched).toEqual([]);
    expect(closed).toBe(1);
  });

  it('剧情线类：带着线 id 跳剧情线页签（这是本次新增的目标类型）', async () => {
    render();
    expect(row('sl:sl1:unanchored')).toBeTruthy();
    await click('sl:sl1:unanchored');
    expect(dispatched).toEqual([{ genre: 'serial', kind: 'storylines', storylineId: 'sl1' }]);
    expect(jumps).toEqual([]);
  });

  it('页签类（未挂线事件汇总）：只开页签，不乱设选中', async () => {
    render();
    await click('sl:unlined');
    expect(dispatched).toEqual([{ genre: 'serial', kind: 'storylines' }]);
  });

  it('有目标的行一律可点——曾经整行不可点是这次要修的洞', () => {
    render();
    for (const key of ['c1:empty', 'sl:sl1:unanchored', 'sl:unlined']) {
      expect(row(key)?.getAttribute('data-jumpable'), key).toBe('1');
    }
  });
});

describe('报告内就地重排回收章', () => {
  const fs = (id: string, plantChapterId: string | null, payoffChapterId: string | null) =>
    ({
      id,
      bookId: 'b1',
      title: `伏笔 ${id}`,
      description: '',
      plantChapterId,
      payoffChapterId,
      status: 'pending',
      storylineId: null,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    }) as never;

  /** 逾期 = 回收章排在埋设章同一章或更早（isOverdue 口径）：埋 c2 / 收 c1 */
  const seedOverdue = () => {
    state.chapters = [
      ch('c1', { sortOrder: 0 }),
      ch('c2', { sortOrder: 1 }),
      ch('c3', { sortOrder: 2 }),
    ];
    state.foreshadowings = [fs('f1', 'c2', 'c1')];
  };

  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    updateForeshadowing.mockClear();
    updateForeshadowing.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      state.foreshadowings = (state.foreshadowings as { id: string }[]).map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      );
    });
    seedOverdue();
  });

  const openDialog = async () => {
    render();
    await act(async () =>
      document
        .querySelector('[data-testid="health-reschedule-fs:f1"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
  };

  it('逾期行带就地修复入口', () => {
    render();
    expect(document.querySelector('[data-testid="health-reschedule-fs:f1"]')).toBeTruthy();
  });

  it('候选章只给埋设章之后的：非法的旧值与埋设章本身都不出现在选择器里', async () => {
    await openDialog();
    expect(document.querySelector('[data-testid="payoff-picker"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="payoff-pick-c3"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="payoff-pick-c1"]')).toBeNull();
    expect(document.querySelector('[data-testid="payoff-pick-c2"]')).toBeNull();
  });

  it('选中候选章 → 按 id 落库 + 成功提示 + 关框', async () => {
    await openDialog();
    await act(async () =>
      document
        .querySelector('[data-testid="payoff-pick-c3"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(updateForeshadowing).toHaveBeenCalledWith('f1', { payoffChapterId: 'c3' });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="payoff-picker"]')).toBeNull();
  });

  it('落库后不必手动刷新：store 一变，这条发现自己从报告里消失', async () => {
    await openDialog();
    await act(async () =>
      document
        .querySelector('[data-testid="payoff-pick-c3"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    render(); // 真 store 会推新引用触发重渲染；替身只能手动作一次
    expect(document.querySelector('[data-testid="health-reschedule-fs:f1"]')).toBeNull();
  });

  it('落库抛错：只给失败提示，框保持打开（不许假装已经改好）', async () => {
    updateForeshadowing.mockImplementation(async () => {
      throw new Error('disk full');
    });
    await openDialog();
    await act(async () =>
      document
        .querySelector('[data-testid="payoff-pick-c3"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="payoff-picker"]')).toBeTruthy();
  });

  it('store 静默 no-op（实体已被删）也算失败：回读核对拦住假成功', async () => {
    updateForeshadowing.mockImplementation(async () => undefined);
    await openDialog();
    // 让回读找不到这条：模拟作者点开的瞬间别处把它删了
    const saved = state.foreshadowings;
    state.foreshadowings = [];
    await act(async () =>
      document
        .querySelector('[data-testid="payoff-pick-c3"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    state.foreshadowings = saved;
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('埋设章已是最后一章：不摆空选择器，直说没有合法去处', async () => {
    state.foreshadowings = [fs('f9', 'c3', 'c1')];
    render();
    await act(async () =>
      document
        .querySelector('[data-testid="health-reschedule-fs:f9"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(document.querySelector('[data-testid="payoff-picker"]')).toBeNull();
    expect(document.body.textContent).toContain('writing.healthRescheduleNoCandidate');
  });

  it('修复入口不连带触发整行跳转（否则框刚开就被 act 关掉）', async () => {
    render();
    await act(async () =>
      document
        .querySelector('[data-testid="health-reschedule-fs:f1"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(dispatched).toEqual([]);
    expect(jumps).toEqual([]);
    expect(closed).toBe(0);
  });
});

describe('体检文案键的词典审计（不经过 mock）', () => {
  const ROOT = process.cwd();
  const src = readFileSync(`${ROOT}/src/utils/writingProofread.ts`, 'utf8');
  const dig = (o: unknown, key: string) =>
    key.split('.').reduce<unknown>((c, p) => (c && typeof c === 'object' ? (c as Record<string, unknown>)[p] : undefined), o);

  // 另一轮事故的教训：t() 被 mock 成恒等函数时，凭空写的键 6 条 UI 测试全绿，
  // 界面上显示的却是裸 key。所以键的存在性必须绕过 mock 直接查词典。
  it('引擎里每个 messageKey 都能在双语词典查到文案', () => {
    // 逐行取 messageKey，把该行所有字符串字面量都算进来：写成三元式
    // `messageKey: cond ? 'A' : 'B'` 后，只认 `messageKey: 'X'` 的正则会让两个键
    // 同时悄悄脱离审计（本门槛曾以 15→14 抓到过一次）。
    const keys = new Set<string>();
    for (const line of src.split('\n')) {
      const i = line.indexOf('messageKey:');
      if (i < 0) continue;
      // 只取 `?` 之后的字面量：`messageKey: x.kind === 'reversed' ? 'A' : 'B'` 里
      // 'reversed' 是比较用的字符串，不是文案键（收紧前审计会把它误当键报缺）
      const afterTernary = line.slice(i);
      const q = afterTernary.indexOf('?');
      const tail = q >= 0 ? afterTernary.slice(q + 1) : afterTernary;
      for (const m of tail.matchAll(/'([A-Za-z0-9_]+)'/g)) keys.add(m[1]);
    }
    // 门槛只要「正则真的抓到了东西」即可：少于这个数说明写法变了、审计已经空转
    expect(keys.size).toBeGreaterThanOrEqual(16);
    for (const file of ['zh-CN', 'en-US']) {
      const dict = JSON.parse(readFileSync(`${ROOT}/src/i18n/${file}.json`, 'utf8'));
      for (const k of keys) {
        expect(typeof dig(dict, `writing.proofreadIssue.${k}`), `${file} 缺 writing.proofreadIssue.${k}`).toBe(
          'string',
        );
      }
    }
  });
});

describe('体检面板自有文案的词典审计（不经过 mock）', () => {
  const ROOT = process.cwd();
  const dig = (o: unknown, key: string) =>
    key.split('.').reduce<unknown>((c, p) => (c && typeof c === 'object' ? (c as Record<string, unknown>)[p] : undefined), o);

  // 上面那条审计只管引擎 messageKey；面板自己的 t('writing.x') / t('ui.x') 同样会写错，
  // 而本文件的 i18n 是恒等 mock，键写错时组件测试一点反应都没有。
  it('面板里每个字面量 t() 键都能在双语词典查到文案', () => {
    const src = readFileSync(`${ROOT}/src/pages/writingPage/WritingHealthDialog.tsx`, 'utf8');
    const keys = [...new Set([...src.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)].map((m) => m[1]))];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const file of ['zh-CN', 'en-US']) {
      const dict = JSON.parse(readFileSync(`${ROOT}/src/i18n/${file}.json`, 'utf8'));
      for (const k of keys) {
        expect(typeof dig(dict, k), `${file} 缺 ${k}`).toBe('string');
      }
    }
  });
});
