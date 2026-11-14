// ㉫ 护栏 · 轮 24 AI-7（认书第三例）：写作工作室渲染器卡与右栏校对总览卡必须按「本卡所属的书」认书，
// 不再吃工作室活跃书。形状沿用轮 23 ㉪ 换源案 + 本仓两处在册自保口径（BookMetaPanel:140-141
// 「按本卡 bookId 直查…杜绝工作室活跃书与 store chapters 跨书错位」、ArchitectureLayersPanel:651 同一理由）。
//
// 分叉可达性（本轮取证，file:line 按磁盘现状）：
// · 写作台书切换器 MenuItem（WritingPage.tsx:2457）与跳转聚焦（:799）都只翻工作室当前书；
// · 卡片挂载时的扳正 effect 依赖是 [卡 bookId]（WritingDesignView.tsx:46-53 / WritingStudioPane.tsx:105-112），
//   外部换书不会让它重跑 ⇒ 已挂载的 B 卡领到 A 书的单位词、书名与落书。
// · 写侧同病：createChapter / createStoryline 按 store 活跃书落库（writingStore.ts:625/1478），
//   在 B 卡上点「新增」会把章节/剧情线静默建进 A ——「库里长毛」形状，故写动作先扳正再落。
//
// 零回归线：正常路径（活跃书 == 本卡书）下 store 各集合本就按本卡书装载（loaders 全部 list(bookId)
// 且 set 前核对活跃书），按本卡 bookId 反查与过滤是 no-op —— novel 同书用例逐字钉死。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  writing: {
    books: [] as any[],
    chapters: [] as any[],
    outlines: [] as any[],
    settings: [] as any[],
    storylines: [] as any[],
    foreshadowings: [] as any[],
    timelineEvents: [] as any[],
    collapsedNodeIds: [] as string[],
    activeBookId: 'bA' as string | null,
    toggleNodeCollapse: vi.fn((_id: string) => {}),
    createChapter: vi.fn(async () => null),
    createChildNode: vi.fn(async (_p: string, _k: string, _t: string) => null),
    reparentNode: vi.fn(async () => {}),
    renameNodeKind: vi.fn(async () => {}),
    setChapterStatus: vi.fn(async () => {}),
    renameChapter: vi.fn(async () => {}),
    deleteChapter: vi.fn(async () => {}),
    createOutline: vi.fn(async () => null),
    updateOutline: vi.fn(async () => {}),
    deleteOutline: vi.fn(async () => {}),
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async (_name: string) => ({ id: 'sl_new' })),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
    createTimelineEvent: vi.fn(async () => null),
    setActiveBook: vi.fn(async (_bookId: string) => {}),
  },
  openChapterCarrierView: vi.fn(),
  openTypedCarrierView: vi.fn(),
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
// ㉭（轮 26 · AI-9）ensureWritingBookWired 整段上收 utils/studioBook.ts（右栏灵感总览卡也要同一道闸）。
// 本套因此改成**局部 mock**：只顶掉两张 open* 导航表，写侧扳正走生产真身 —— 真身内部只调
// useWritingStore.getState()（本套已 mock），于是 setActiveBook 的观测点仍是同一枚 spy。
// 不许改回「在测试里另写一份扳正逻辑」：那是同一概念的第二把尺子，生产改了它不会红。
vi.mock('../../../utils/studioBook', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  openChapterCarrierView: h.openChapterCarrierView,
  openTypedCarrierView: h.openTypedCarrierView,
}));

import { PiecesPane, StorylinePane, StorylinesPane, InspirationsPane, IdeasPane, ProofreadPane } from '../writingPanes';
import { ProofreadOverviewCard } from '../../panels/ProofreadPanels';
import { useEditorStore } from '../../../store/editorStore';
import { t } from '../../../i18n';
import { proofreadGroupLabelKey, PROOFREAD_GROUPS } from '../../../utils/writingProofread';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => {
    root!.render(ui);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** 小说 A：工作室当前活跃的旧口径受害者书；诗歌 B：卡片真正所属的书。 */
const NOVEL = { id: 'bA', title: '长夜行', genre: 'novel' };
// ㉬ N-21（轮 72 续五班）改注：B 卡原本体裁写 `poetry`，并在它身上挂一条逾期伏笔（`fsB`）。
// 那是个**不可能态**——`hiddenViewKindsForGenre` 里诗集与散文、日记一样藏 `foreshadowing`，
// `canCreateEntityForGenre` 同表闸死创建入口，App 已造不出「诗集的伏笔」。本文件的主题是
// **认书 = 本卡 bookId、不许跨书报数**，与体裁无关，故把 B 换成**保留伏笔栏的剧本**（剧本只藏世界观）：
// 跨书判别力一点不丢，而状态变成 App 真能造出来的。变量名 `POEM` 沿用不改（改名要动 30+ 处，
// 与本刀无关），读的时候当「B 卡」看。书内节点标题「第 N 首」是 fixture 字面量，不参与体裁判定。
const POEM = { id: 'bB', title: '海上有风', genre: 'script' };

const chapter = (id: string, bookId: string, title: string, sortOrder = 0) => ({
  id,
  bookId,
  title,
  content: '',
  sortOrder,
  wordCount: 0,
  status: 'draft',
  volume: '',
  parentId: null,
  kind: '章',
  createdAt: 0,
  updatedAt: 0,
});
const foreshadow = (id: string, bookId: string, plant: string, payoff: string) => ({
  id,
  bookId,
  title: `伏笔-${id}`,
  description: '',
  plantChapterId: plant,
  payoffChapterId: payoff,
  status: 'pending',
  storylineId: null,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});

function inputOf(title: string): HTMLInputElement | null {
  return (
    Array.from(document.body.querySelectorAll<HTMLInputElement>('input')).find((i) => i.value === title) ?? null
  );
}
function buttonOfText(text: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) ?? null;
}
function buttonByTitle(title: string): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
}
/** 先扳正后落书的顺序证据：setActiveBook(card) 必须早于该写动作。 */
function ensuredBefore(bookId: string, write: ReturnType<typeof vi.fn>) {
  const wire = h.writing.setActiveBook.mock.calls.findIndex((c) => c[0] === bookId);
  expect(wire, `写动作前必须先按本卡书「${bookId}」扳正工作室接线`).toBeGreaterThanOrEqual(0);
  expect(h.writing.setActiveBook.mock.invocationCallOrder[wire]).toBeLessThanOrEqual(
    write.mock.invocationCallOrder[0],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.writing.books = [NOVEL, POEM];
  // cA1 带三连同字正文（RepeatChar 判据 writingProofread.ts:133，不依赖引擎词典）：
  // 这是「体检输入按本卡书过滤」里 chapters 那扇门的观测点 —— 没它，摘掉过滤在本套里无人变红
  // （轮 24 反证 F 第一次没牙，教训 = AU-7 ⑨ 的测试侧同族）。
  h.writing.chapters = [
    { ...chapter('cA1', 'bA', '第一章', 0), content: '夜风了了了地吹' },
    chapter('cB1', 'bB', '第一首', 0),
    chapter('cB2', 'bB', '第二首', 1),
  ];
  h.writing.outlines = [];
  h.writing.settings = [];
  h.writing.storylines = [];
  h.writing.timelineEvents = [];
  // A、B 各有且只有一条「逾期未回收」伏笔：回收锚点排在埋设之前（isOverdue 判据）。
  // fsA2 是反证 F2 的专用观测点（轮 24：两扇门互相拦截，单摘伏笔门在普通数据下无泄漏）：
  // 它的锚点**伸进 B 书的章**（跨书脏锚），正常代码被 foreshadowings 的 bookId 过滤挡住不计逾期；
  // 摘掉那扇门它就借 B 自己的章节清单变逾期混进计数 —— 单门单牙。
  h.writing.foreshadowings = [
    foreshadow('fsA', 'bA', 'cA1', 'cA1'),
    foreshadow('fsA2', 'bA', 'cB1', 'cB1'),
    foreshadow('fsB', 'bB', 'cB2', 'cB1'),
  ];
  h.writing.activeBookId = 'bA';
});

describe('㉫ StorylinePane · 认书 = 本卡 bookId（卡体自保，不吃工作室活跃书）', () => {
  const pane = (cardBookId: string) => (
    <StorylinePane accent="#4A338F" bookId={cardBookId} chapters={h.writing.chapters} outlines={[]} settings={[]} />
  );

  it('跨书卡（诗集 B 挂在活跃小说 A 的工作室里）：他书行绝迹、本书行在场、栏头计数 = 本书', () => {
    mount(pane('bB'));
    expect(inputOf('第一章'), '诗集卡上渲染出了小说的章行').toBeNull();
    expect(inputOf('第一首'), '本卡书的行没渲染出来').toBeTruthy();
    expect(inputOf('第二首')).toBeTruthy();
  });

  it('「加节点」：层级词跟本卡体裁（B 卡 = 剧本 ⇒ 幕），且先扳正本卡书再建（写不落错书）', async () => {
    mount(pane('bB'));
    const btn = buttonOfText(t('writingDesign.addNode'));
    expect(btn, '栏头「加节点」按钮没渲染').toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    ensuredBefore('bB', h.writing.createChapter);
    expect(h.writing.createChapter).toHaveBeenCalledWith('幕 3');
  });

  it('双击行开写作视图：章节 id / 书名前缀 / 体裁 / bookId 四实参全按本卡书', async () => {
    mount(pane('bB'));
    await act(async () => {
      inputOf('第一首')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(h.openChapterCarrierView).toHaveBeenCalledWith('cB1', '海上有风 · 第一首', 'script', 'bB');
  });

  it('剧情线实体区「新建线」落本卡书（StorylineSection 孤儿 prop 死透）', async () => {
    mount(pane('bB'));
    const btn = buttonByTitle(t('writing.storylineCreate'));
    expect(btn, '剧情线区「新建线」按钮没渲染').toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    ensuredBefore('bB', h.writing.createStoryline);
    expect(h.writing.createStoryline).toHaveBeenCalledWith(t('writing.storylineDefaultName', { n: 1 }));
  });

  it('小说同书零回归：双击实参与「加节点」命名 = 改造前形状，同书不触发扳正', async () => {
    mount(pane('bA'));
    await act(async () => {
      inputOf('第一章')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(h.openChapterCarrierView).toHaveBeenCalledWith('cA1', '长夜行 · 第一章', 'novel', 'bA');
    const btn = buttonOfText(t('writingDesign.addNode'))!;
    await act(async () => {
      btn.click();
    });
    expect(h.writing.createChapter).toHaveBeenCalledWith('卷 2');
    expect(h.writing.setActiveBook, '活跃书就是本卡书，不许多写一次接线').not.toHaveBeenCalled();
  });
});

describe('㉫ PiecesPane · 认书 = 本卡 bookId', () => {
  const pane = (cardBookId: string) => <PiecesPane accent="#0ea5e9" bookId={cardBookId} chapters={h.writing.chapters} />;

  it('跨书卡：他书篇目绝迹，栏头计数 = 本书篇目数', () => {
    mount(pane('bB'));
    const body = document.body.textContent ?? '';
    expect(body, '诗集卡的篇目栏里混进了小说的章').not.toContain('第一章');
    expect(body).toContain('第一首');
    expect(body).toContain('第二首');
  });

  it('「＋新增」：命名按本卡体裁（B 卡 = 剧本 ⇒ 第 n 场），且先扳正本卡书再建', async () => {
    mount(pane('bB'));
    const btn = buttonOfText(t('writingDesign.add'));
    expect(btn, '篇目栏「新增」按钮没渲染').toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    ensuredBefore('bB', h.writing.createChapter);
    expect(h.writing.createChapter).toHaveBeenCalledWith('第 3 场');
  });

  it('点行开写作视图：四实参按本卡书（书名前缀 = 本卡书名，不是活跃书的）', async () => {
    mount(pane('bB'));
    const row = Array.from(document.body.querySelectorAll<HTMLElement>('span')).find((s) => s.textContent === '第一首');
    expect(row, '诗集篇目行没渲染').toBeTruthy();
    await act(async () => {
      row!.click();
    });
    expect(h.openChapterCarrierView).toHaveBeenCalledWith('cB1', '海上有风 · 第一首', 'script', 'bB');
  });

  it('小说同书零回归：store 按活跃书装载（真实路径只含本卡书），新增命名逐字 = 改造前', async () => {
    // 真库里 loadChapters 只装活跃书 —— 同书口径下夹具就该只有 A 的两章。
    // 改造前：count = chapters.length + 1 = 3；改造后：count = 过滤后 length + 1 = 3。逐字同。
    h.writing.chapters = [chapter('cA1', 'bA', '第一章', 0), chapter('cA2', 'bA', '第二章', 1)];
    mount(pane('bA'));
    const btn = buttonOfText(t('writingDesign.add'))!;
    await act(async () => {
      btn.click();
    });
    expect(h.writing.createChapter).toHaveBeenCalledWith('第 3 章');
    expect(h.writing.setActiveBook).not.toHaveBeenCalled();
  });

  it('防御线：bookId 空串（卡未绑书）——渲染不崩、新增不落任何书（宁缺不错）', async () => {
    mount(pane(''));
    const btn = buttonOfText(t('writingDesign.add'));
    if (btn) {
      await act(async () => {
        btn.click();
      });
    }
    expect(h.writing.setActiveBook).not.toHaveBeenCalled();
    expect(h.writing.createChapter).not.toHaveBeenCalled();
  });
});

describe('㉫ ProofreadOverviewCard（右栏「要素」卡）· 认书 = 场景/本卡 bookId', () => {
  const foreshadowRow = (): HTMLElement | null => {
    const label = t(proofreadGroupLabelKey('foreshadow'));
    return (
      Array.from(document.body.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent === `${label}1`) ?? null
    );
  };

  it('计数只算本卡书：A/B 各有一条逾期伏笔，挂在诗集 B 的卡上总计数 = 1', () => {
    mount(<ProofreadOverviewCard bookId="bB" />);
    const body = document.body.textContent ?? '';
    expect(body, '体检计数把别本书的发现也算进来了').toContain('· 1');
    expect(body).not.toContain('· 2');
  });

  it('跳转端的是本卡体裁（poetry），不是工作室活跃书（novel）', async () => {
    mount(<ProofreadOverviewCard bookId="bB" />);
    const row = foreshadowRow();
    expect(row, '伏笔组行没渲染出可点的 1 计数').toBeTruthy();
    await act(async () => {
      row!.click();
    });
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('script', 'foreshadowing');
  });

  it('小说同书零回归：跳转实参 = novel 口径（改造前逐字）', async () => {
    mount(<ProofreadOverviewCard bookId="bA" />);
    const row = foreshadowRow();
    expect(row).toBeTruthy();
    await act(async () => {
      row!.click();
    });
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('novel', 'foreshadowing');
  });

  it('认不出的 bookId：空态 + 一个数都不报、点了不跳（宁缺不错）', async () => {
    mount(<ProofreadOverviewCard bookId="zz" />);
    expect(document.body.textContent ?? '').toContain(t('writing.proofreadPaneEmpty'));
    const label = t(proofreadGroupLabelKey('foreshadow'));
    const row = Array.from
      ? Array.from(document.body.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent === `${label}0`)
      : null;
    if (row) {
      await act(async () => {
        row.click();
      });
    }
    expect(h.openTypedCarrierView).not.toHaveBeenCalled();
  });
});

// ─── 接线与绝迹源码锁（AU-7 ⑦：不带 include 过滤、以磁盘现状为准；⑧：注释先剥掉再扫）───
const SRC = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

describe('㉫ 接线与绝迹（源码锁）', () => {
  it('writingPanes.tsx：两个 pane 的窗口内不再读工作室活跃书；写侧扳正助手就位', () => {
    const raw = read('editor/renderers/writingPanes.tsx');
    const src = stripComments(raw);
    const win = (from: string, to: string) => {
      const i = src.indexOf(from);
      expect(i, `锚点「${from}」没找到`).toBeGreaterThanOrEqual(0);
      const j = src.indexOf(to, i + from.length);
      expect(j, `窗口终点「${to}」没找到`).toBeGreaterThanOrEqual(0);
      return src.slice(i, j);
    };
    expect(win('export function StorylinePane(', 'export function PiecesPane(')).not.toMatch(/s\.activeBookId/);
    expect(win('export function PiecesPane(', 'export function IdeasPane(')).not.toMatch(/s\.activeBookId/);
    expect(src, '剧情线实体区的孤儿 prop 又活了').not.toMatch(/_bookId/);
    // ㉭ 口径迁移（轮 26 · AI-9；原锁 = 「1 处定义 + 3 处消费 = 4」）：定义整段上收
    // utils/studioBook.ts，本文件只剩 1 处 import + 3 处消费（StorylinePane 加节点 /
    // StorylineSection 新建线 / PiecesPane 新增）。锁的牙不变：消费点少一枚照样红，
    // 而定义若被搬回本文件（= 全仓长出第二处定义）也被下面那条绝迹锁抓住。
    // ㉮ 换数（轮 27 · AI-10）：3 → 5 枚——灵感 pane 速记落书 + 素材栏新增各接同一道闸。
    // 这是计数口径随消费点等比更新，不是削牙：少一枚照样红，多一枚（另写一份扳正）被
    // 「定义不回 rendering 层」与两条窗口锁一起拦。
    // AI-12 换数（轮 30）：5 → 8 枚——伏笔「新建」落书 + 时间线「新建事件」落书 + 时间线
    // 「新建剧情线」落书，三处写侧各接同一道闸（同族一轮清空，不是一处一轮）。
    expect(src, '写侧扳正定义又长回 rendering 层').not.toMatch(/function\s+ensureWritingBookWired/);
    // ㉭ 换数（轮 72 续七班 · M1a）：8 → 9 枚——日记「此刻记一笔」提交是一个**新写点**
    // （要先扳正"记的这条进哪本书"再落库）。同族口径：一条 = 一次调用，注释里一律不写
    // `ensureWritingBookWired(bookId)` 这个字面量 —— 本班就是被自己注释里的它顶高了计数，
    // 「计数含注释」是本仓在册读数病，牙留着，写法改了。
    expect((src.match(/ensureWritingBookWired\(bookId\)/g) ?? []).length).toBe(9);
    // 定义全仓恰好一枚，且住在「书 × 工作室接线」的共同家（panels 反向 import renderers 的循环因此不成立）
    expect((stripComments(read('utils/studioBook.ts')).match(/export async function ensureWritingBookWired/g) ?? []).length).toBe(1);
  });

  it('ProofreadPanels.tsx：全文件零工作室活跃书读取', () => {
    expect(stripComments(read('editor/panels/ProofreadPanels.tsx'))).not.toMatch(/activeBookId/);
  });

  it('两个父级把本卡 bookId 逐字接到两张卡；SceneEditor 把场景书接进右栏卡', () => {
    for (const rel of ['editor/renderers/WritingDesignView.tsx', 'editor/renderers/WritingStudioPane.tsx']) {
      const src = read(rel);
      for (const card of ['PiecesPane', 'StorylinePane']) {
        const m = src.match(new RegExp(`<${card}[\\s\\S]{0,320}?/>`));
        expect(m, `${rel} 没找到 <${card} 卡`).toBeTruthy();
        expect(m![0], `${rel} 的 <${card} 没接本卡 bookId`).toContain('bookId={bookId}');
      }
    }
    expect(read('editor/SceneEditor.tsx')).toContain('<ProofreadOverviewCard bookId={activeBookId} />');
  });
});

// ─── ㉬ 轮 25 AI-8 · 认书第四例第一处：StorylinesPane 卡头书名。这张卡比本轮另两处更薄——
// 本卡 bookId 早就是它的 prop（WritingStudioPane:208 递的），只是那一行回头读了工作室当前书。
describe('㉬ StorylinesPane · 卡头书名 = 本卡 bookId（prop 在手边却回头读工作室当前书）', () => {
  const pane = (cardBookId: string) => <StorylinesPane accent="#4A338F" bookId={cardBookId} />;

  it('正向分叉（活跃=小说 A，卡=诗集 B）：卡头印本卡书名，他书书名绝迹', () => {
    mount(pane('bB'));
    const body = document.body.textContent ?? '';
    expect(body, '诗集剧情线卡头印的是工作室那本书').toContain('海上有风');
    expect(body).not.toContain('长夜行');
  });

  it('反向分叉（活跃=诗集 B，卡=小说 A）：印小说名——旧口径两个方向都会印错', () => {
    h.writing.activeBookId = 'bB';
    mount(pane('bA'));
    const body = document.body.textContent ?? '';
    expect(body).toContain('长夜行');
    expect(body).not.toContain('海上有风');
  });

  it('小说同书零回归：卡头书名逐字 = 改造前', () => {
    mount(pane('bA'));
    expect(document.body.textContent ?? '').toContain('长夜行');
  });

  it('bookId 空串（卡未绑书）：渲染不崩、一本书名都不印（宁缺不错）', () => {
    mount(pane(''));
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('长夜行');
    expect(body).not.toContain('海上有风');
  });
});

describe('㉬ 接线与绝迹（源码锁 · 轮 25）', () => {
  it('StorylinesPane 窗口内不再按工作室当前书认书；两个调用端把本卡/场景书逐字接上', () => {
    const src = stripComments(read('editor/renderers/writingPanes.tsx'));
    const i = src.indexOf('export function StorylinesPane(');
    expect(i, '锚点 StorylinesPane 没找到').toBeGreaterThanOrEqual(0);
    const j = src.indexOf('export function ForeshadowingsPane(', i);
    expect(j, '窗口终点 ForeshadowingsPane 没找到').toBeGreaterThanOrEqual(0);
    const win = src.slice(i, j);
    expect(win, '剧情线管理卡又回头读工作室当前书').not.toMatch(/b\.id === s\.activeBookId/);
    expect(win).toContain('b.id === bookId');
    expect(read('editor/renderers/WritingStudioPane.tsx')).toContain(
      '<StorylinesPane accent={accent} bookId={bookId} />',
    );
  });
});

// ─── ㉮ 轮 27 · AI-10（认书第六例）· 念头池的两张卡面嘴：灵感 pane + 合集素材栏 ───
// 改造前两处都吃 store.outlines 原样缓存（= 工作室活跃书装载，writingStore.ts:1237-1243）：
// InspirationsPane 的 bookId 早就是必填 prop（WritingStudioPane:214）却只用在栏尾书名一行，
// 行表 / 计数 / 选中态 / 落书四张嘴全在隔壁书上；IdeasPane 干脆没有 bookId——两个宿主
// （WritingStudioPane / WritingDesignView）都递 store 原样清单，与 ㉫ 栏头注释「卡内认书
// 只准吃这个 bookId」对不上。零回归线同 ㉫：同书 = 装载器本就 list(bookId) 的 no-op。
/** 念头（loose beat）：chapterId=null ⇒ 池的两种视图都看得见；bookId 决定它进哪张卡。 */
const beat = (id: string, bookId: string, title: string) => ({
  id,
  bookId,
  title,
  summary: '',
  chapterId: null,
  extra: '{}',
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});

describe('㉮ InspirationsPane · 念头池行表/计数/选中/落书 = 本卡 bookId', () => {
  const pane = (cardBookId: string) => <InspirationsPane accent="#4A338F" bookId={cardBookId} />;
  const rowOf = (title: string): HTMLButtonElement | null =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes(title),
    ) ?? null;
  const captureInput = () =>
    Array.from(document.body.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.placeholder === t('writing.inspirationCapturePh'),
    ) ?? null;
  /** React 受控 input 的合法写值路径（原生 setter + input 事件），不许直接赋 .value。 */
  const typeCapture = (el: HTMLInputElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  beforeEach(() => {
    // 真 editorStore：选中态是全局的，用例之间必须清干净，不许把 A 卡的选中带进 B 卡用例。
    useEditorStore.getState().selectInspiration(null);
    h.writing.outlines = [beat('oA', 'bA', '长夜念头'), beat('oB', 'bB', '浪打船舷')];
  });

  it('正向分叉（活跃=小说 A，卡=诗集 B，池缓存含两书行）：只列 B 的念头，A 的绝迹', () => {
    mount(pane('bB'));
    expect(rowOf('浪打船舷'), '本卡书的念头行没了（过滤过头）').toBeTruthy();
    expect(rowOf('长夜念头'), '诗集 pane 还替小说 A 列着念头').toBeNull();
    expect(document.body.textContent ?? '').not.toContain(t('writing.inspirationEmptyHint'));
  });

  it('反向分叉（活跃=诗集 B，卡=小说 A）：行表 = 小说 A 的念头——专防「门只挡住被裁支」', () => {
    h.writing.activeBookId = 'bB';
    mount(pane('bA'));
    expect(rowOf('长夜念头'), '小说卡被隔壁诗集误关在空池里').toBeTruthy();
    expect(rowOf('浪打船舷')).toBeNull();
  });

  it('分叉 + 陈旧选中：选中的是 A 的念头，B 卡右侧编辑卡不隔书开（宁缺不错）', () => {
    act(() => useEditorStore.getState().selectInspiration('oA'));
    mount(pane('bB'));
    expect(document.body.textContent ?? '').toContain(t('writing.inspirationPaneEditHint'));
  });

  it('同书零回归（读侧）：活跃==本卡（A）时行表与选中卡照旧——逐字 = 改造前可见性', () => {
    h.writing.outlines = [beat('oA', 'bA', '长夜念头')];
    act(() => useEditorStore.getState().selectInspiration('oA'));
    mount(pane('bA'));
    expect(rowOf('长夜念头')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toContain(t('writing.inspirationPaneEditHint'));
  });

  it('速记落书写侧：先扳正本卡书（B）再 createOutline，顺序与实参都有账', async () => {
    mount(pane('bB'));
    const input = captureInput();
    expect(input, '零阻力速记输入没渲染').toBeTruthy();
    typeCapture(input!, '新的念头');
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    ensuredBefore('bB', h.writing.createOutline);
    expect(h.writing.createOutline).toHaveBeenCalledWith('新的念头');
  });

  it('写侧扳不动（接线 reject）：不落库——速记内容留在输入框，宁可不建', async () => {
    h.writing.setActiveBook.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    mount(pane('bB'));
    const input = captureInput()!;
    typeCapture(input, '不该落库的念头');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(h.writing.createOutline, '扳正失败还照样落库（静默建进隔壁书）').not.toHaveBeenCalled();
    expect(input.value, '扳不动时不该把作者写的字清掉').toBe('不该落库的念头');
  });

  it('同书零回归（写侧）：活跃==本卡，回车一枪 setActiveBook 都不许多烧', async () => {
    mount(pane('bA'));
    const input = captureInput()!;
    typeCapture(input, '同书念头');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(h.writing.setActiveBook).not.toHaveBeenCalled();
    expect(h.writing.createOutline).toHaveBeenCalledWith('同书念头');
  });
});

describe('㉮ IdeasPane · 素材栏认书 = 本卡 bookId（必填 prop，无默认值）', () => {
  const two = [beat('iA', 'bA', '立意A'), beat('iB', 'bB', '意象B')];
  const pane = (cardBookId: string) => <IdeasPane accent="#0ea5e9" bookId={cardBookId} outlines={two} />;

  it('跨书卡（诗集 B）：只渲染本书素材行，小说 A 的行绝迹', () => {
    mount(pane('bB'));
    expect(inputOf('意象B'), '本卡书素材行没了').toBeTruthy();
    expect(inputOf('立意A'), '素材栏混进了小说 A 的立意').toBeNull();
  });

  it('反向分叉（小说卡 A）：A 的行在场、B 的行绝迹——不是只挡被裁支', () => {
    h.writing.activeBookId = 'bB';
    mount(pane('bA'));
    expect(inputOf('立意A')).toBeTruthy();
    expect(inputOf('意象B')).toBeNull();
  });

  it('「＋加素材」先扳正本卡书再落库，序号只数本书', async () => {
    mount(pane('bB'));
    const btn = buttonOfText(t('writingDesign.addIdea'));
    expect(btn, '素材栏新增按钮没渲染').toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    ensuredBefore('bB', h.writing.createOutline);
    expect(h.writing.createOutline).toHaveBeenCalledWith(t('writingDesign.ideaN', { n: 2 }));
  });

  it('同书零回归（写侧）：不扳正、直接落，命名公式逐字 = 改造前', async () => {
    mount(<IdeasPane accent="#4A338F" bookId="bA" outlines={[beat('iA', 'bA', '立意A')]} />);
    const btn = buttonOfText(t('writingDesign.addIdea'))!;
    await act(async () => {
      btn.click();
    });
    expect(h.writing.setActiveBook).not.toHaveBeenCalled();
    expect(h.writing.createOutline).toHaveBeenCalledWith(t('writingDesign.ideaN', { n: 2 }));
  });

  it('防御线：bookId 空串（卡未绑书）——行表全空、不扳正也不落任何书', async () => {
    mount(pane(''));
    expect(inputOf('立意A')).toBeNull();
    expect(inputOf('意象B')).toBeNull();
    const btn = buttonOfText(t('writingDesign.addIdea'));
    if (btn) {
      await act(async () => {
        btn.click();
      });
    }
    expect(h.writing.setActiveBook).not.toHaveBeenCalled();
    expect(h.writing.createOutline).not.toHaveBeenCalled();
  });
});

// ─── ㉮ 接线与绝迹（源码锁 · 轮 27）───
describe('㉮ 接线与绝迹（源码锁 · 轮 27 · AI-10）', () => {
  const src = () => stripComments(read('editor/renderers/writingPanes.tsx'));
  const win = (from: string, to: string) => {
    const s = src();
    const i = s.indexOf(from);
    expect(i, `锚点「${from}」没找到`).toBeGreaterThanOrEqual(0);
    const j = s.indexOf(to, i + from.length);
    expect(j, `窗口终点「${to}」没找到`).toBeGreaterThanOrEqual(0);
    return s.slice(i, j);
  };

  it('InspirationsPane 窗口：池只经 bookOutlines 一张嘴喂，速记落书先扳正', () => {
    const w = win('export function InspirationsPane(', 'export function ProofreadPane(');
    expect(w, '池子没按本卡书过滤').toContain('outlines.filter((o) => o.bookId === bookId)');
    expect(w.match(/for \(const o of outlines\)/), '行表还绕过过滤吃整份缓存').toBeNull();
    expect(w.match(/count=\{outlines\.length\}/), '栏头计数又吃回整份缓存').toBeNull();
    expect(w).toContain('count={bookOutlines.length}');
    const wired = w.indexOf('ensureWritingBookWired(bookId)');
    const created = w.indexOf('createOutline(text)');
    expect(wired, '速记落书没接扳正（AU-7 ⑨）').toBeGreaterThanOrEqual(0);
    expect(created).toBeGreaterThan(wired);
  });

  it('IdeasPane 窗口：bookId 必填无默认值，池过滤 + 新增扳正都在行上', () => {
    const s = src();
    const i = s.indexOf('export function IdeasPane(');
    expect(i, '锚点 IdeasPane 没找到').toBeGreaterThanOrEqual(0);
    const j = s.indexOf('export function', i + 'export function IdeasPane('.length);
    expect(j, 'IdeasPane 后面找不到下一个导出').toBeGreaterThanOrEqual(0);
    const w = s.slice(i, j);
    expect(w).toContain('bookId: string;');
    // 默认值只可能长在解构段里（形参 `{ accent, bookId, ... }`）；整窗扫 `bookId\s*=`
    // 会误中 `o.bookId === bookId` 的判据本体（AU-7 ⑧ 的镜像：锁咬到被禁形状之外的现网）。
    const sig = w.slice(0, w.indexOf('}: {'));
    expect(sig.match(/bookId\s*=[^=]/), '必填 prop 又偷给了默认值').toBeNull();
    expect(w).toContain('o.bookId === bookId');
    const wired = w.indexOf('ensureWritingBookWired(bookId)');
    const created = w.indexOf('createOutline(');
    expect(wired).toBeGreaterThanOrEqual(0);
    expect(created).toBeGreaterThan(wired);
  });

  it('两个宿主把本卡书逐字递给素材栏（L2 编辑面与设计卡同一张嘴）', () => {
    for (const rel of ['editor/renderers/WritingStudioPane.tsx', 'editor/renderers/WritingDesignView.tsx']) {
      expect(read(rel), `${rel} 的 IdeasPane 没接本卡 bookId`).toContain(
        '<IdeasPane accent={accent} bookId={bookId} outlines={outlines} labelKey={paneKeys.ideas} />',
      );
    }
  });
});

// ─── ㉯ 轮 28 · AI-11（认书第七例）· L2 校对 pane 六组体检输入 = 本卡书 ───
// 病灶（轮 27 在册）：ProofreadPane 的 bookId 过去只用来反查体裁，喂 buildProofreadReport 的
// chapters/outlines/timelineEvents/foreshadowings/storylines/settings 六组全是 store 整份缓存 ⇒
// 分叉态下诗集 B 的卡报小说 A 的发现。它与 ㉫ 的右栏 ProofreadOverviewCard 是同名两张嘴，那张六组
// 已滤、这张没有。**六扇门同轮关**（半接 = 半真报告，AU-7 ⑨ 的 pane 版），牙按「单门单牙」排：
// 每组夹具在只摘它自己那扇门时必须泄漏（fsA2 跨书脏锚是轮 24 在册的伏笔单门观测点）。
const outline = (id: string, bookId: string) => ({
  id,
  bookId,
  title: `念头-${id}`,
  summary: '',
  chapterId: null,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});
const tlEvent = (id: string, bookId: string, event: string, at: string) => ({
  id,
  bookId,
  event,
  at,
  settingId: null,
  chapterId: null,
  storylineId: null,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});
const storyLine = (id: string, bookId: string) => ({
  id,
  bookId,
  name: `线-${id}`,
  color: '',
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});
const setCard = (id: string, bookId: string, name: string) => ({
  id,
  bookId,
  name,
  extra: '',
  kind: 'character',
  createdAt: 0,
  updatedAt: 0,
});

describe('㉯ ProofreadPane · 六组体检输入 = 本卡 bookId（六门同轮关，报数与跳转都不许跨书）', () => {
  beforeEach(() => {
    // A 侧每组各留一枚可数的发现：章病(cA1 三连同字)/逾期伏笔(fsA)/待补全草稿(evA2)/
    // 未挂线事件 + 空线(slA)/未分发念头(ideaA)/零提及设定卡(林越)。
    // 观测点彼此独立：摘任何一扇门，对应那一格的计数就从 0/本书值 漂出去（反证 B–G 逐扇收牙）。
    h.writing.outlines = [outline('ideaA', 'bA'), outline('ideaB', 'bB')];
    h.writing.timelineEvents = [tlEvent('evA1', 'bA', '事件-甲', '第1天'), tlEvent('evA2', 'bA', '草稿-乙', '')];
    h.writing.storylines = [storyLine('slA', 'bA')];
    h.writing.settings = [setCard('stA', 'bA', '林越')];
  });

  const groupBtns = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.title === t('writing.proofreadGroupSwitch'),
    );
  /** 六组导航按钮按 PROOFREAD_GROUPS 序渲染，textContent = 组名 + 计数（与 ㉫ 右栏卡同一读法）。 */
  function groupCounts(): number[] {
    const btns = groupBtns();
    expect(btns.length, '六组导航没渲染齐').toBe(PROOFREAD_GROUPS.length);
    return PROOFREAD_GROUPS.map((g, i) => {
      const label = t(proofreadGroupLabelKey(g));
      const text = btns[i].textContent ?? '';
      expect(text.startsWith(label), `第 ${i} 枚组按钮文案不对`).toBe(true);
      return Number(text.slice(label.length));
    });
  }
  async function switchGroup(idx: number) {
    await act(async () => {
      groupBtns()[idx].click();
    });
  }

  it('分叉（活跃=小说 A，卡=诗集 B）：六组计数只报 B 自己的（fs 1 + idea 1，A 的四组全关在门外）', () => {
    mount(<ProofreadPane accent="#0ea10a" bookId="bB" />);
    expect(groupCounts()).toEqual([0, 1, 0, 0, 1, 0]);
  });

  it('分叉（B 卡）行面：伏笔组只有 fsB，念头行只数 B 的一枚（A 的发现一行都不许上屏）', async () => {
    mount(<ProofreadPane accent="#0ea10a" bookId="bB" />);
    await switchGroup(1); // foreshadow
    let body = document.body.textContent ?? '';
    expect(body).toContain('伏笔-fsB');
    expect(body, '他书的逾期伏笔混进来了').not.toContain('伏笔-fsA');
    await switchGroup(4); // idea
    body = document.body.textContent ?? '';
    expect(body).toContain(t('writing.proofreadIssue.IdeaUndispatchedRow', { n: 1 }));
    expect(body, '念头汇总行把 A 的池子也数进去了').not.toContain(t('writing.proofreadIssue.IdeaUndispatchedRow', { n: 2 }));
  });

  it('反向分叉（活跃=诗集 B，卡=小说 A）：A 的六组全数在场、fsB 不计——专防「门只挡住被裁支」', () => {
    h.writing.activeBookId = 'bB';
    mount(<ProofreadPane accent="#0ea10a" bookId="bA" />);
    // fsA2（跨书脏锚）在 A 卡下锚点章 cB1 被 chapters 门滤掉 ⇒ isOverdue 无从判起，不计（宁缺）。
    // 章文本组 = 2 枚：三连同字（RepeatChar，writingProofread.ts:133）+ 引擎重复词聚合行
    // （RepeatPhrase，:165 分支）——同一章的两类判据，实测读数，非泄漏。
    expect(groupCounts()).toEqual([2, 1, 1, 2, 1, 1]);
  });

  it('锚点语义（取证 b）：B 卡念头行点下去——poetry 体裁 + 选中 ideaB，落点就在本卡池里', async () => {
    mount(<ProofreadPane accent="#0ea10a" bookId="bB" />);
    await switchGroup(4); // idea
    const row = document.getElementById('proofread-row-idea:fresh');
    expect(row, 'B 卡的念头行没渲染').toBeTruthy();
    await act(async () => {
      (row!.querySelector('button') as HTMLButtonElement).click();
    });
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('script', 'inspiration');
    expect(useEditorStore.getState().selectedInspirationId).toBe('ideaB');
  });

  it('同书零回归（活跃==本卡，缓存只含 A——装载器的真实形状）：六组计数逐字 = 改造前', () => {
    h.writing.chapters = [{ ...chapter('cA1', 'bA', '第一章', 0), content: '夜风了了了地吹' }];
    h.writing.foreshadowings = [foreshadow('fsA', 'bA', 'cA1', 'cA1')];
    h.writing.outlines = [outline('ideaA', 'bA')];
    h.writing.timelineEvents = [tlEvent('evA1', 'bA', '事件-甲', '第1天'), tlEvent('evA2', 'bA', '草稿-乙', '')];
    h.writing.storylines = [storyLine('slA', 'bA')];
    h.writing.settings = [setCard('stA', 'bA', '林越')];
    h.writing.activeBookId = 'bA';
    mount(<ProofreadPane accent="#1d4ed8" bookId="bA" />);
    // 章文本组 2 枚与反向用例同一读法（RepeatChar + RepeatPhrase 聚合行，改造前口径原样）。
    expect(groupCounts()).toEqual([2, 1, 1, 2, 1, 1]);
  });

  it('宁缺不错：认不出的 bookId 一个数都不报、空态在场、点了不跳', async () => {
    mount(<ProofreadPane accent="#0ea10a" bookId="zz" />);
    expect(groupCounts()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(document.body.textContent ?? '').toContain(t('writing.proofreadPaneEmpty'));
    await switchGroup(1);
    expect(h.openTypedCarrierView).not.toHaveBeenCalled();
  });
});

// ─── ㉯ 接线与绝迹（源码锁 · 轮 28 · AI-11）───
describe('㉯ 接线与绝迹（源码锁 · 轮 28 · AI-11）', () => {
  it('ProofreadPane 窗口：六组输入逐枚按本卡过滤、deps 带 bookId、裸六参整传绝迹', () => {
    const s = stripComments(read('editor/renderers/writingPanes.tsx'));
    const from = 'export function ProofreadPane(';
    const to = 'export function StatsPane(';
    const i = s.indexOf(from);
    expect(i, '锚点 ProofreadPane 没找到').toBeGreaterThanOrEqual(0);
    const j = s.indexOf(to, i + from.length);
    expect(j, '窗口终点 StatsPane 没找到').toBeGreaterThanOrEqual(0);
    const w = s.slice(i, j);
    expect((w.match(/\.filter\(\(\w\) => \w\.bookId === bookId\)/g) ?? []).length, '六扇门少一扇都不算关').toBe(6);
    expect(w.match(/buildProofreadReport\(\s*chapters,/), '裸六参整传活回来了（半真报告的母体）').toBeNull();
    // ㉬ N-21：deps 除 bookId 还必须带 genre（切书不重跑接线 = 半真报告母体，体裁漏带同理）
    expect(w).toContain('settings, bookId, genre]');
    expect(w, '窗口里又长出工作室活跃书读取').not.toMatch(/s\.activeBookId/);
  });
});
