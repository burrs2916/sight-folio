// ㉬ 护栏 · 轮 25 AI-8（认书第四例 · 右栏两张卡）：右栏「要素」时间线总览里的剧情线卡、以及右栏
// 「详情」念头分发卡，必须按**调用端递来的本卡/场景书**认书，不再回头吃工作室活跃书。形状沿用轮 24 ㉫
// （ProofreadOverviewCard）与轮 23 ㉪（canvasAssistant）——**判据链零动**：闸口仍只调
// canCreateEntityForGenre、措辞仍只走 surfaceKeyForGenre，本刀只换「书」的来源。
//
// ㉭ 追加 · 轮 26 AI-9（认书第五例）：同一只右栏里的灵感总览卡（InspirationOverviewCard）——
// ㉬ 换了它的兄弟 InspirationDetail 却没换它 = 半张卡换源。本套把它的读侧（跳分发去向的体裁）与
// 写侧（＋记个念头 → createOutline 按 store 活跃书落库）一起收，详见文件末两个 describe。
//
// 分叉可达性（本轮取证，file:line 按磁盘现状）：
// · SceneEditor 右栏的 bookId 由 `activeScene.projectRoot` 现解（SceneEditor.tsx:336-339），同屏
//   TimelineEventDetail(:2066)/StorylineDetail(:2069)/ForeshadowingDetail(:2086) 都吃它，
//   唯独 InspirationDetail 与内嵌的 StorylineOverviewCard 回头读工作室当前书；
// · 写作台 pane 从卡片 config.filePath 解出本卡 bookId（WritingStudioPane:208 → InspirationsPane），
//   而卡片挂载时的扳正 effect 依赖是 [卡 bookId] ⇒ 外部换书不让已挂载的 B 卡重读，两口径可长期分叉。
//
// 零回归线：活跃书 == 本卡书时两条表达式取自同一份 books、命中同一条目 ⇒ 闸口与措辞逐字相同；
// 认不出书 → genre '' → 沿用「未设体裁 = 小说口径」既有回落（hiddenViewKindsForGenre 空 id 返回 []）。
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
    activeBookId: 'bA' as string | null,
    loadTimelineEvents: vi.fn(async () => {}),
    loadChapters: vi.fn(async (_id: string) => {}),
    loadSettings: vi.fn(async () => {}),
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async (_name: string) => ({ id: 'sl_new' })),
    createTimelineEvent: vi.fn(async () => null),
    createForeshadowing: vi.fn(async () => null),
    updateForeshadowing: vi.fn(async () => {}),
    updateOutline: vi.fn(async () => {}),
    deleteOutline: vi.fn(async () => {}),
    setActiveBook: vi.fn(async (_id: string) => {}),
    // ㉭ 灵感总览卡「＋记个念头」：返回实体好让「选中态跟着走」这一格也有观测点。
    createOutline: vi.fn(async (_title: string) => ({ id: 'out_new' })),
  },
  editor: {
    selectStoryline: vi.fn(),
    selectTimelineEvent: vi.fn(),
    selectInspiration: vi.fn(),
    timelineViewMode: 'book',
    setTimelineViewMode: vi.fn(),
  },
  openChapterCarrierView: vi.fn(),
  openTypedCarrierView: vi.fn(),
  openWritingDesk: vi.fn(async () => null),
  confirmDestructive: vi.fn(async () => true),
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../store/editorStore', () => ({
  useEditorStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.editor), {
    getState: () => h.editor,
  }),
}));
vi.mock('../../../store/confirmStore', () => ({ confirmDestructive: h.confirmDestructive }));
// ㉭（轮 26 · AI-9）本套需要写侧扳正助手 ensureWritingBookWired 的**生产真身**（它已上收
// utils/studioBook.ts）⇒ 改局部 mock，只顶掉两张导航表。真身只调 useWritingStore.getState()
// （本套已 mock），所以 setActiveBook 观测点仍是同一枚 spy。不许在测试里另写一份扳正逻辑。
vi.mock('../../../utils/studioBook', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  openChapterCarrierView: h.openChapterCarrierView,
  openTypedCarrierView: h.openTypedCarrierView,
}));
vi.mock('../../../utils/writingDeskWindow', () => ({ openWritingDesk: h.openWritingDesk }));

import { TimelineOverviewPanel } from '../TimelineSidePanels';
import { InspirationDetail, InspirationOverviewCard } from '../InspirationPanels';
import { t } from '../../../i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** A = 小说（工作室旧口径的受害者书）· B = 诗集 · D = 日记集（两支都被裁掉剧情线/伏笔）。 */
const NOVEL = { id: 'bA', title: '长夜行', genre: 'novel' };
const POEM = { id: 'bB', title: '海上有风', genre: 'poetry' };
const DIARY = { id: 'bD', title: '三日风', genre: 'diary' };

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
/** 念头（loose beat）：未落章、有标题 ⇒ 三个分发口的启用条件都成立，观测点只随体裁动。 */
const beat = (bookId: string) => ({
  id: 'o1',
  bookId,
  title: '浪打船舷',
  summary: '',
  chapterId: null,
  extra: '{}',
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});

/** 新建剧情线入口：右栏那枚是 Typography[title]，不是 button —— 按 title 属性取。 */
const createStorylineEntry = (): Element | null =>
  document.body.querySelector(`[title="${t('writing.storylineCreate')}"]`);
/** 分发口按钮（Box component="button"）按文案取。 */
function dispatchBtn(label: string): HTMLElement | null {
  return (
    Array.from(document.body.querySelectorAll<HTMLElement>('button')).find((b) =>
      (b.textContent ?? '').includes(label),
    ) ?? null
  );
}
const bodyText = () => document.body.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  h.writing.books = [NOVEL, POEM, DIARY];
  h.writing.chapters = [chapter('cA1', 'bA', '第一章', 0), chapter('cB1', 'bB', '第一首', 0)];
  h.writing.outlines = [];
  h.writing.settings = [];
  h.writing.storylines = [];
  h.writing.timelineEvents = [];
  h.writing.foreshadowings = [];
  h.writing.activeBookId = 'bA';
});

describe('㉬ StorylineOverviewCard（内嵌于右栏时间线总览）· 认书 = 递来的本卡/场景书', () => {
  it('正向分叉（活跃=小说 A，卡=诗集 B）：新建剧情线入口绝迹（诗集该视图本就被裁）', () => {
    mount(<TimelineOverviewPanel bookId="bB" />);
    expect(createStorylineEntry(), '诗集卡的右栏还在递「新建剧情线」').toBeNull();
  });

  it('反向分叉（活跃=诗集 B，卡=小说 A）：入口在场——专防「门只挡住被裁支」', () => {
    h.writing.activeBookId = 'bB';
    mount(<TimelineOverviewPanel bookId="bA" />);
    expect(createStorylineEntry(), '小说卡被隔壁诗集的体裁闸口误关').toBeTruthy();
  });

  it('日记卡同样收口（diary 也裁剧情线）：证明闸口不是诗歌专属分支', () => {
    mount(<TimelineOverviewPanel bookId="bD" />);
    expect(createStorylineEntry()).toBeNull();
  });

  it('小说同书零回归：入口文案逐字 = 改造前，且真点得到（观测点不是永真空态）', async () => {
    mount(<TimelineOverviewPanel bookId="bA" />);
    const entry = createStorylineEntry();
    expect(entry, '小说右栏的「新建剧情线」不见了').toBeTruthy();
    expect(entry!.textContent).toBe(`＋ ${t('writing.storylineCreate')}`);
    await act(async () => {
      (entry as HTMLElement).click();
    });
    expect(h.writing.createStoryline).toHaveBeenCalledWith(t('writing.storylineDefaultName', { n: 1 }));
  });

  it('认不出的 bookId：落到未设体裁的既有回落（入口在场，不新增第三种口径）', () => {
    mount(<TimelineOverviewPanel bookId="zz" />);
    expect(createStorylineEntry()).toBeTruthy();
  });
});

describe('㉬ InspirationDetail · 分发口与措辞按递来的本卡/场景书', () => {
  it('正向分叉（活跃=小说 A，卡=诗集 B）：转伏笔草稿绝迹，转时间线草稿仍在（时间线对诗集不裁）', () => {
    mount(<InspirationDetail beat={beat('bB')} bookId="bB" />);
    expect(dispatchBtn(t('writing.inspirationToForeshadow')), '诗集念头卡还在递被裁掉的伏笔出口').toBeNull();
    expect(dispatchBtn(t('writing.inspirationToTimeline'))).toBeTruthy();
  });

  it('反向分叉（活跃=诗集 B，卡=小说 A）：转伏笔在场——旧口径在这一格是关错门', () => {
    h.writing.activeBookId = 'bB';
    mount(<InspirationDetail beat={beat('bA')} bookId="bA" />);
    expect(dispatchBtn(t('writing.inspirationToForeshadow')), '小说念头卡被隔壁诗集关了伏笔口').toBeTruthy();
  });

  it('日记卡：挂章措辞印「挂到某天」，不是小说那句（体裁读数跟着书走）', () => {
    mount(<InspirationDetail beat={beat('bD')} bookId="bD" />);
    expect(bodyText()).toContain(t('writing.diary.bindUnit'));
    expect(bodyText(), '日记卡上印的是小说单位词').not.toContain(t('writing.inspirationBindChapter'));
  });

  it('小说同书零回归：伏笔口在场 + 措辞逐字 = 改造前', () => {
    mount(<InspirationDetail beat={beat('bA')} bookId="bA" />);
    expect(dispatchBtn(t('writing.inspirationToForeshadow'))).toBeTruthy();
    expect(bodyText()).toContain(t('writing.inspirationBindChapter'));
    expect(bodyText()).not.toContain(t('writing.diary.bindUnit'));
  });
});

// ─── ㉭ 轮 26 · AI-9（认书第五例）· 右栏「要素」tab 灵感总览卡 ───
// 改造前它两件事吃工作室当前书：① jumpTo 拿隔壁书的体裁开载体视图；②「＋记个念头」走
// createOutline，而它按 store 活跃书落库（writingStore.ts:1252-1254）⇒ 在 B 的画布上记念头，
// 静默建进 A（活跃书为 null 时静默不建）。②是 ㉬ 唯一没碰的写侧形状。
describe('㉭ InspirationOverviewCard · 读侧（跳分发去向的体裁）= 递来的场景书', () => {
  /** 两枚统计行是 Box component="span"（不是 button），按文案取；念头池非空才会渲染出来。 */
  function statSpan(which: 'timeline' | 'foreshadowing'): HTMLElement | null {
    const label = t(which === 'timeline' ? 'writing.inspirationStatTimeline' : 'writing.inspirationStatForeshadow', {
      n: 0,
    });
    return (
      Array.from(document.body.querySelectorAll<HTMLElement>('span')).find((s) => (s.textContent ?? '') === label) ??
      null
    );
  }
  const click = async (el: HTMLElement | Element | null) => {
    expect(el, '观测点没渲染出来').toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
  };

  beforeEach(() => {
    // 轮 26 原注：「念头池按活跃书装载，本刀不动它」——㉮（轮 27 · AI-10）起池子按本卡书过滤，
    // 这条在册残余正是那一刀的队首。夹具改口径：放**属于本卡书**的念头，统计行才渲染得出来；
    // 「池里有谁」由下面 ㉮ 专节锁，本节仍锁「行跳去哪」。
    h.writing.outlines = [beat('bA')];
  });

  it('正向分叉（活跃=小说 A，卡=诗集 B）：去向页签按 B 的体裁开，不再拿 A 的钥匙', async () => {
    h.writing.outlines = [beat('bB')];
    mount(<InspirationOverviewCard bookId="bB" />);
    await click(statSpan('timeline'));
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('poetry', 'timeline');
  });

  it('反向分叉（活跃=诗集 B，卡=小说 A）：拿回小说体裁——专防「门只挡住被裁支」', async () => {
    h.writing.activeBookId = 'bB';
    mount(<InspirationOverviewCard bookId="bA" />);
    await click(statSpan('foreshadowing'));
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('novel', 'foreshadowing');
  });

  it('日记卡（diary）：同样跟着本卡书走，证明不是诗歌专属分支', async () => {
    h.writing.outlines = [beat('bD')];
    mount(<InspirationOverviewCard bookId="bD" />);
    await click(statSpan('timeline'));
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('diary', 'timeline');
  });

  it('零回归·同书：活跃 == 本卡（小说）时去向与改造前逐字同（novel, timeline）', async () => {
    mount(<InspirationOverviewCard bookId="bA" />);
    await click(statSpan('timeline'));
    expect(h.openTypedCarrierView).toHaveBeenCalledTimes(1);
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('novel', 'timeline');
  });

  it('认不出的 bookId：体裁落未设 → 不开视图（沿用既有回落，不新增第三种口径）', async () => {
    h.writing.outlines = [beat('zz')];
    mount(<InspirationOverviewCard bookId="zz" />);
    await click(statSpan('timeline'));
    expect(h.openTypedCarrierView).not.toHaveBeenCalled();
  });
});

// ─── ㉮ 轮 27 · AI-10（认书第六例）· 念头池行表按本卡书过滤 ───
// ㉭ 把这张卡的闸门/去向/写侧收进本卡书后，行表仍吃 store.outlines 整份缓存
// （= 活跃书装载，writingStore.ts:1237-1243）⇒ 分叉态下 B 的卡列着 A 的念头。轮 26 台账把这条
// 在册残余顶到了本队首。零回归线同 ㉫：同书时过滤 = 装载器本就 list(bookId) 的 no-op。
describe('㉮ InspirationOverviewCard · 念头池行表/计数 = 本卡书（分叉宁缺不错）', () => {
  it('分叉（活跃=小说 A，池缓存 = A 的一条念头，卡=诗集 B）：行表空、计数 0、空提示在场', () => {
    h.writing.outlines = [beat('bA')];
    mount(<InspirationOverviewCard bookId="bB" />);
    const body = document.body.textContent ?? '';
    expect(body, '诗集卡还替小说 A 列着念头').not.toContain('浪打船舷');
    expect(body).toContain(`${t('writing.viewKind.inspiration')} · 0`);
    expect(body).toContain(t('writing.inspirationEmptyHint'));
  });

  it('反向（活跃=诗集 B，池缓存 = B 的念头，卡=小说 A）：小说卡不列诗集的念头——专防门只挡被裁支', () => {
    h.writing.activeBookId = 'bB';
    h.writing.outlines = [beat('bB')];
    mount(<InspirationOverviewCard bookId="bA" />);
    expect(document.body.textContent ?? '').not.toContain('浪打船舷');
  });

  it('同书零回归：活跃==本卡（A）时行在场、计数 1——逐字 = 改造前可见性', () => {
    h.writing.outlines = [beat('bA')];
    mount(<InspirationOverviewCard bookId="bA" />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('浪打船舷');
    expect(body).toContain(`${t('writing.viewKind.inspiration')} · 1`);
    expect(body).not.toContain(t('writing.inspirationEmptyHint'));
  });
});

describe('㉭ InspirationOverviewCard · 写侧（＋记个念头）先扳正再落库', () => {
  const createIdeaEntry = (): Element | null => document.body.querySelector(`[title="${t('writingDesign.captureIdea')}"]`);

  beforeEach(() => {
    h.writing.outlines = [beat('bA')];
  });

  it('分叉（活跃=A，卡=B）：扳正早于 createOutline，念头领到标题并进入选中态', async () => {
    const order: number[] = [];
    h.writing.setActiveBook.mockImplementationOnce(async () => {
      order.push(1);
    });
    h.writing.createOutline.mockImplementationOnce(() => {
      order.push(2);
      return Promise.resolve({ id: 'out_new' });
    });
    mount(<InspirationOverviewCard bookId="bB" />);
    await act(async () => {
      (createIdeaEntry() as Element as HTMLElement).click();
    });
    expect(h.writing.setActiveBook).toHaveBeenCalledWith('bB');
    expect(h.writing.createOutline).toHaveBeenCalledWith(t('writingDesign.captureIdea'));
    expect(order, '扳正与落库的顺序漂了（先落库=静默建进隔壁书）').toEqual([1, 2]);
    expect(h.editor.selectInspiration).toHaveBeenCalledWith('out_new');
  });

  it('真链路：扳正把活跃书翻成本卡书后，createOutline 落库才发生 ⇒ 念头住在 B', async () => {
    const landed: string[] = [];
    h.writing.setActiveBook.mockImplementationOnce(async (id: string) => {
      h.writing.activeBookId = id;
    });
    h.writing.createOutline.mockImplementationOnce(async () => {
      landed.push(h.writing.activeBookId ?? '');
      return { id: 'out_new' };
    });
    mount(<InspirationOverviewCard bookId="bB" />);
    await act(async () => {
      (createIdeaEntry() as Element as HTMLElement).click();
    });
    expect(landed, '念头落进了工作室那本书').toEqual(['bB']);
  });

  it('零回归·同书（活跃 == 本卡）：不扳正、直接落库——正常路径一次 setActiveBook 都不许多烧', async () => {
    mount(<InspirationOverviewCard bookId="bA" />);
    await act(async () => {
      (createIdeaEntry() as Element as HTMLElement).click();
    });
    expect(h.writing.setActiveBook).not.toHaveBeenCalled();
    expect(h.writing.createOutline).toHaveBeenCalledWith(t('writingDesign.captureIdea'));
  });

  it('扳不动（接线失败）就不建：宁可不建，不静默建进别人的书', async () => {
    h.writing.setActiveBook.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    mount(<InspirationOverviewCard bookId="bB" />);
    await act(async () => {
      (createIdeaEntry() as Element as HTMLElement).click();
    });
    expect(h.writing.createOutline, '扳正失败还照样落库').not.toHaveBeenCalled();
    expect(h.editor.selectInspiration).not.toHaveBeenCalled();
  });

  it('无卡书（bookId 空串）：不扳正也不建（SceneEditor 非书场景的既有形状）', async () => {
    mount(<InspirationOverviewCard bookId="" />);
    await act(async () => {
      (createIdeaEntry() as Element as HTMLElement).click();
    });
    expect(h.writing.setActiveBook).not.toHaveBeenCalled();
    expect(h.writing.createOutline).not.toHaveBeenCalled();
  });
});

// ─── 接线与绝迹（源码锁）· AU-7 ⑦：不带 include 过滤；⑧：先剥注释再扫，且本套注释不用被禁形状举例 ───
const SRC = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
/** 认书显示读取的病形状：全局书目按工作室当前书命中（装载/扳正守卫用的是 `ws.activeBookId !== …`，不在此列）。 */
const BAD = /b\.id === s\.activeBookId/;

describe('㉬ 接线与绝迹（源码锁）', () => {
  it('两张右栏卡：全文件零「按活跃书认书」显示读取', () => {
    for (const rel of ['editor/panels/TimelineSidePanels.tsx', 'editor/panels/InspirationPanels.tsx']) {
      expect(stripComments(read(rel)), `${rel} 又长回按活跃书认书的显示读取`).not.toMatch(BAD);
    }
  });

  it('父级逐字把书接上：总览卡递本卡/场景书，念头卡两个调用端各递自己的书', () => {
    expect(read('editor/panels/TimelineSidePanels.tsx')).toContain('<StorylineOverviewCard bookId={bookId} />');
    expect(read('editor/SceneEditor.tsx')).toContain('<InspirationDetail beat={selectedInspiration} bookId={activeBookId} />');
    expect(read('editor/renderers/writingPanes.tsx')).toContain('<InspirationDetail key={selected.id} beat={selected} bookId={bookId} />');
  });

  it('判据链零动：两张卡仍然只调现成闸口，没长第二份体裁判断', () => {
    const tl = stripComments(read('editor/panels/TimelineSidePanels.tsx'));
    const ins = stripComments(read('editor/panels/InspirationPanels.tsx'));
    expect(tl).toMatch(/canCreateEntityForGenre\(tlSideGenre, "storyline"\)/);
    expect(ins).toMatch(/canCreateEntityForGenre\(inspGenre, 'foreshadowing'\)/);
    for (const src of [tl, ins]) {
      expect(src).not.toMatch(/genre\s*===\s*'/);
    }
  });
});

// ─── ㉭ 接线与绝迹（源码锁）· 轮 26 · AI-9 ───
describe('㉭ InspirationOverviewCard 接线与绝迹（源码锁）', () => {
  /** 只取总览卡那段函数体：InspirationDetail 里那条装载 guard（ws.activeBookId && …）属数据管道，本轮在册不动。 */
  const overviewCardWindow = () => {
    const src = stripComments(read('editor/panels/InspirationPanels.tsx'));
    const from = 'export function InspirationOverviewCard(';
    const i = src.indexOf(from);
    expect(i, '总览卡函数头找不到').toBeGreaterThanOrEqual(0);
    const j = src.indexOf('const fieldStyle', i);
    expect(j, '总览卡窗口终点找不到').toBeGreaterThanOrEqual(0);
    return src.slice(i, j);
  };

  it('总览卡窗口内零「按工作室当前书」读取，签名收必填 bookId（无默认值·轮 21 先例）', () => {
    const win = overviewCardWindow();
    expect(win, '总览卡又长回读工作室当前书').not.toMatch(/s\.activeBookId/);
    expect(win).toMatch(/export function InspirationOverviewCard\(\{ bookId \}: \{ bookId: string \}\)/);
  });

  it('SceneEditor 逐字把场景书递给总览卡（同屏兄弟卡同一张嘴）', () => {
    expect(read('editor/SceneEditor.tsx')).toContain('<InspirationOverviewCard bookId={activeBookId} />');
  });

  it('写侧扳正接到行上：总览卡窗口内恰好一枚 ensureWritingBookWired(bookId)，且落库在它之后', () => {
    const win = overviewCardWindow();
    expect((win.match(/ensureWritingBookWired\(bookId\)/g) ?? []).length).toBe(1);
    const wired = win.indexOf('ensureWritingBookWired(bookId)');
    const created = win.indexOf('createOutline(');
    expect(wired, '算好了没接到行上（AU-7 ⑨）').toBeGreaterThanOrEqual(0);
    expect(created).toBeGreaterThan(wired);
  });

  it('导航出口判据零动：仍只调现成 openTypedCarrierView(genre, kind)，未设体裁不开视图', () => {
    const win = overviewCardWindow();
    expect(win).toMatch(/if \(genre\) openTypedCarrierView\(genre, kind\)/);
  });
});
