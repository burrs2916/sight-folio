// W-0b + T-D 接线锁（2026-11-10 轮 3）：体裁 → 设计卡 / L2 编辑面的 pane 集与主色。
//
// 这一刀修的是两个「定义层早就对、渲染层没吃」的洞：
//  ① WritingDesignView 的 genreReady 手写三支（isCollection || novel || ''），而
//     writingSchema 里 script/diary 早在 2026-11-09 / 11-10 就 ready:true
//     → 剧本作者点开载体卡正中「建设中」，体裁开闸开了两天，卡内还是空壳。
//  ② WritingStudioPane 的 `isEssay = genre === 'essay'` → 诗集 / 日记本领到小说的
//     「主线」叙事 pane（节题还写着「写每一章要发生什么」）。
// 两处各自还叠了第二份判据（合集型用 isCollectionGenre、实装用字面量、主色用三元），
// 本文件把三者一起钉回 writingSchema：判据只准有一份，改表即改行为。
//
// 形状与轮 2 的 workbenchGenreCommandsWiring.test.tsx 一致：**真渲染**看长出的 pane，
// 而不是只测纯函数——纯函数全绿正是这些洞能活到今天的原因。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    timelineEvents: [] as any[],
    foreshadowings: [] as any[],
    activeBookId: 'b1' as string | null,
    collapsedNodeIds: [] as string[],
    toggleNodeCollapse: vi.fn(),
    loadStorylines: vi.fn(async () => {}),
    loadForeshadowings: vi.fn(async () => {}),
    loadBooks: vi.fn(async () => {}),
    setActiveBook: vi.fn(async () => {}),
    createChapter: vi.fn(async () => null),
    createChildNode: vi.fn(async () => null),
    reparentNode: vi.fn(async () => {}),
    renameNodeKind: vi.fn(async () => {}),
    setChapterStatus: vi.fn(async () => {}),
    renameChapter: vi.fn(async () => {}),
    deleteChapter: vi.fn(async () => {}),
    createOutline: vi.fn(async () => null),
    updateOutline: vi.fn(async () => {}),
    deleteOutline: vi.fn(async () => {}),
    createSetting: vi.fn(async () => null),
    updateSetting: vi.fn(async () => {}),
    deleteSetting: vi.fn(async () => {}),
    createStoryline: vi.fn(async () => null),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
  },
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));

import { WritingDesignView } from '../WritingDesignView';
import { WritingStudioPane } from '../WritingStudioPane';
import { accentForGenre } from '../writingPanes';
import { isGenreReady } from '../../../utils/writingSchema';
import { t } from '../../../i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let errorSpy: ReturnType<typeof vi.spyOn>;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  h.writing.books = [{ id: 'b1', title: '测试书', genre: '', subtitle: '', cover: '' }];
  h.writing.chapters = [];
  h.writing.outlines = [];
  h.writing.settings = [];
  h.writing.activeBookId = 'b1';
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
  errorSpy.mockRestore();
});

function setGenre(genre: string) {
  h.writing.books = [{ id: 'b1', title: '测试书', genre, subtitle: '', cover: '' }];
}

const filePath = 'writing://b1/carrier';
const designView = (genre: string) => {
  setGenre(genre);
  mount(<WritingDesignView config={{ filePath, genre }} mode="edit" componentId="c1" />);
  return document.body.textContent ?? '';
};
const studioPane = (genre: string) => {
  setGenre(genre);
  mount(<WritingStudioPane config={{ filePath, pane: 'storyline' }} mode="edit" componentId="c2" />);
  return document.body.textContent ?? '';
};

const COMING_SOON = t('writing.genre.comingSoon');
const P_STORYLINE = t('writingDesign.pane.storyline'); // 主线
// 空态行是**每栏独有**的串，用它当「这一栏在不在」的锚点：
// 直接找「场景」二字会被卡顶副标（writingDesign.hint「人物 / 主线 / 场景…」）污染 ——
// 那条副标对诗集/剧本/日记一字未改，本身已是措辞层的欠账，记进状态文件排队。
const EMPTY_SCENES = t('writingDesign.emptyScenes');
const EMPTY_CHARACTERS = t('writingDesign.emptyCharacters');
const EMPTY_OUTLINE = t('writingDesign.emptyOutlineTree');

// ───────── 区域三 / W-0b：载体设计卡不再吃手写判据 ─────────
describe('W-0b 设计卡实装判据 = genreDef().ready', () => {
  it('剧本脱离「建设中」：卡内长出结构树与角色表', () => {
    const txt = designView('script');
    expect(txt).not.toContain(COMING_SOON);
    expect(txt).toContain(EMPTY_OUTLINE); // 主线/结构栏在场
    expect(txt).toContain(EMPTY_CHARACTERS); // 角色表在场
  });

  it('剧本不领「场景」栏：worldbuilding 对剧本是被裁视图，藏视图必须同时关入口', () => {
    // 判据与 hiddenViewKindsForGenre('script') 同源（canCreateEntityForGenre）。
    // 挂一栏「+ 新建」出去的数据，L2 里没有页签能看见 —— 那是「藏视图不藏入口」的倒装版。
    const txt = designView('script');
    expect(txt).not.toContain(EMPTY_SCENES);
    expect(txt).toContain(EMPTY_CHARACTERS);
  });

  it('小说零回归：主线 + 人物 + 场景 三栏一个不少，且无「建设中」', () => {
    const txt = designView('novel');
    expect(txt).not.toContain(COMING_SOON);
    expect(txt).toContain(EMPTY_OUTLINE);
    expect(txt).toContain(EMPTY_CHARACTERS);
    expect(txt).toContain(EMPTY_SCENES);
  });

  it('未设体裁 / 脏体裁值 = 小说口径（旧书零回归，不落到「建设中」）', () => {
    for (const g of ['', 'novel-x', 'unknown']) {
      const txt = designView(g);
      const tag = `genre=${JSON.stringify(g)}`;
      expect(txt, tag).not.toContain(COMING_SOON);
      expect(txt, tag).toContain(EMPTY_SCENES);
    }
  });

  it('合集型三支照旧两栏，措辞各说各话（篇目 / 诗作+意象素材 / 日记条目+当日要点）', () => {
    const essay = designView('essay');
    expect(essay).toContain(t('writingDesign.pane.pieces'));
    expect(essay).toContain(t('writingDesign.pane.ideas'));
    const poetry = designView('poetry');
    expect(poetry).toContain(t('writingLeft.tplPoem'));
    expect(poetry).toContain(t('writingLeft.tplPoemImagery'));
    const diary = designView('diary');
    expect(diary).toContain(t('writingLeft.tplDiaryDay'));
    expect(diary).toContain(t('writingLeft.tplDiaryMatter'));
  });
});

// ───────── 区域三 / T-D：L2 编辑面的 pane 口径与设计卡收口 ─────────
describe('T-D L2 编辑面按体裁分叉', () => {
  it('诗集 / 日记本不再吃小说「主线」pane，改领自己的两栏', () => {
    const poetry = studioPane('poetry');
    expect(poetry).not.toContain(P_STORYLINE);
    expect(poetry).toContain(t('writingLeft.tplPoem'));
    expect(poetry).toContain(t('writingLeft.tplPoemImagery'));

    const diary = studioPane('diary');
    expect(diary).not.toContain(P_STORYLINE);
    expect(diary).toContain(t('writingLeft.tplDiaryDay'));
    expect(diary).toContain(t('writingLeft.tplDiaryMatter'));
  });

  it('散文零回归：两栏措辞与改造前同一把（篇目 / 立意 · 素材）', () => {
    const essay = studioPane('essay');
    expect(essay).toContain(t('writingDesign.pane.pieces'));
    expect(essay).toContain(t('writingDesign.pane.ideas'));
    expect(essay).not.toContain(P_STORYLINE);
  });

  it('小说零回归：仍是「主线」pane', () => {
    for (const g of ['', 'novel']) {
      const txt = studioPane(g);
      expect(txt, `genre=${JSON.stringify(g)}`).toContain(P_STORYLINE);
    }
  });
});

// ───────── 主色：体裁色只有一份，取自 writingSchema 申报值 ─────────
describe('T-D accentForGenre', () => {
  it('剧本 / 日记取 schema 申报色，不再回落小说墨紫', () => {
    expect(accentForGenre('script')).not.toBe(accentForGenre('novel'));
    expect(accentForGenre('diary')).not.toBe(accentForGenre('novel'));
    expect(accentForGenre('script')).toBe('#047857');
    expect(accentForGenre('diary')).toBe('#9d174d');
  });

  it('小说（含空/脏值）逐字零回归；散文历史色值与诗歌申报色不受本刀影响', () => {
    expect(accentForGenre('novel')).toBe('#4A338F');
    expect(accentForGenre('')).toBe('#4A338F');
    expect(accentForGenre('zzz')).toBe('#4A338F');
    expect(accentForGenre('essay')).toBe('#0ea5e9');
    expect(accentForGenre('poetry')).toBe('#875b1c');
  });
});

// ───────── 判据真源：isGenreReady 与 WRITING_GENRES.ready 不许漂 ─────────
describe('isGenreReady', () => {
  it('五体裁全 ready（任何一枚被关掉，卡内立刻该说「建设中」）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary']) {
      expect(isGenreReady(g), g).toBe(true);
    }
  });

  it('未登记 / 空串按小说口径 = ready', () => {
    expect(isGenreReady('')).toBe(true);
    expect(isGenreReady('whatever')).toBe(true);
  });
});
