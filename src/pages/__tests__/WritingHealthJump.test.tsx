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

const state = {
  chapters: [] as unknown[],
  outlines: [] as unknown[],
  timelineEvents: [] as unknown[],
  foreshadowings: [] as unknown[],
  storylines: [] as unknown[],
  settings: [] as unknown[],
  books: [{ id: 'b1', title: '长夜将尽', genre: 'serial' }] as unknown[],
  activeBookId: 'b1',
};

vi.mock('../../store/writingStore', () => ({
  useWritingStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('../../utils/writingDeskJump', () => ({
  dispatchChapterJump: (p: unknown) => dispatched.push(p),
}));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ success: vi.fn(), error: vi.fn() }) },
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

describe('写作台体检报告跳转', () => {
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
  const row = (key: string) => document.querySelector(`[data-testid="health-row-${key}"]`) as HTMLElement;
  const click = async (key: string) => {
    await act(async () => row(key).dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    dispatched.length = 0;
    jumps.length = 0;
    openedSettings.length = 0;
    closed = 0;
    state.chapters = [ch('c1', { content: '', wordCount: 0 })];
    state.outlines = [];
    state.timelineEvents = [ev('e1', null, 'c1'), ev('e2', 'sl1', null), ev('e3', 'sl1', null)];
    state.foreshadowings = [];
    state.storylines = [{ id: 'sl1', name: '南疆线' }];
    state.settings = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
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

describe('体检文案键的词典审计（不经过 mock）', () => {
  const ROOT = process.cwd();
  const src = readFileSync(`${ROOT}/src/utils/writingProofread.ts`, 'utf8');
  const dig = (o: unknown, key: string) =>
    key.split('.').reduce<unknown>((c, p) => (c && typeof c === 'object' ? (c as Record<string, unknown>)[p] : undefined), o);

  // 另一轮事故的教训：t() 被 mock 成恒等函数时，凭空写的键 6 条 UI 测试全绿，
  // 界面上显示的却是裸 key。所以键的存在性必须绕过 mock 直接查词典。
  it('引擎里每个 messageKey 都能在双语词典查到文案', () => {
    const keys = [...new Set([...src.matchAll(/messageKey:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]))];
    // 门槛只要「正则真的抓到了东西」即可：少于这个数说明写法变了、审计已经空转
    expect(keys.length).toBeGreaterThanOrEqual(15);
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
