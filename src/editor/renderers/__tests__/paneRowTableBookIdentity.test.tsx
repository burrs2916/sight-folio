// AI-12 护栏 · 轮 30（认书同族四张嘴：写作台行表 / 计数 / 命名 / 落书）
//
// 病灶不是「没算」，是「算好了没接到行上」（AU-7 ⑨ 的形状）：认书族前几刀把 bookId 接进了
// 卡头书名与新增命名，**行表本体与栏头计数照旧渲染工作室活跃书的缓存**。分叉真实可达
// （写作台书切换器只翻 activeBookId，卡片挂载时的扳正 effect 依赖是 [卡 bookId]），于是
// 诗集卡的剧情线栏头印「5」、下面只列 2 行；小说的伏笔躺在诗集卡上；诗集的轴上给小说的线挂线。
//
// 四张嘴 = 四个 describe，每张嘴各有一个**只有它自己能让它变红**的观测点（轮 24 反证 F2 的教训：
// 两扇门互相拦截 ≠ 每扇门各自有牙）：
//   ①-a 行表本体   → 他书线名绝迹 / 本卡线名在场
//   ①-b 行尾事件数 → 跨书脏事件（bookId=他书、storylineId=本卡线）不得计进本卡行的「N 个事件」
//   ②   栏头计数   → PaneHeader 的数字与本卡行数相等（不吃缓存总数）
//   ③   伏笔三嘴   → 行表 + 两处计数 + 默认名「伏笔 2」（不是缓存算出的「伏笔 3」）+ 写侧扳正顺序
//   ④   时间线四嘴 → 主轨事件卡按 data-ev-id 点名 / 同轨时点碰撞不得由他书事件造出假橙标 /
//                    剧情线轴轨名 / 建线默认名 + 扳正顺序 / 「挂线」选择器在他书有线本卡无线时不出现
//
// 零回归线：活跃书 == 本卡书时，store 各集合本就按本卡书装载（loaders 全部 list(bookId) 且 set
// 前核对活跃书），按本卡 bookId 反查与过滤是 no-op —— 同书用例逐字钉死。
// 装载 guard（三张卡各自的 useEffect 按 activeBookId 补齐）本轮**不动**，也不在本套里锁它。
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
    loadStorylines: vi.fn(async () => {}),
    loadForeshadowings: vi.fn(async () => {}),
    loadTimelineEvents: vi.fn(async () => {}),
    loadSettings: vi.fn(async () => {}),
    loadChapters: vi.fn(async (_bookId?: string) => {}),
    createStoryline: vi.fn(async (_name: string) => ({ id: 'sl_new' })),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
    createForeshadowing: vi.fn(async (_name: string) => ({ id: 'fs_new' })),
    updateForeshadowing: vi.fn(async () => {}),
    deleteForeshadowing: vi.fn(async () => {}),
    createTimelineEvent: vi.fn(async (_p: unknown) => ({ id: 'ev_new' })),
    updateTimelineEvent: vi.fn(async () => {}),
    deleteTimelineEvent: vi.fn(async () => {}),
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
// 写侧扳正走**生产真身**（只在测试里顶掉两张导航表）：另写一份扳正逻辑 = 同一概念第二把尺子，
// 生产改了它不会红。真身内部只调 useWritingStore.getState()，本套已 mock，观测点仍是 setActiveBook spy。
vi.mock('../../../utils/studioBook', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  openChapterCarrierView: h.openChapterCarrierView,
  openTypedCarrierView: h.openTypedCarrierView,
}));

import { ForeshadowingsPane, StorylinesPane, TimelinePane } from '../writingPanes';
import { useEditorStore } from '../../../store/editorStore';
import { t } from '../../../i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

let root: Root | null = null;
function mount(ui: ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => {
    root!.render(ui);
  });
}
/** 换书重挂：unmount 后的 root 不能复用（React 19 直接抛「Cannot update an unmounted root」）。 */
function remount(ui: ReactElement) {
  if (root) act(() => root!.unmount());
  root = null;
  mount(ui);
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

const texts = () => Array.from(document.body.querySelectorAll('span,button,div')).map((n) => n.textContent ?? '');
// 轨名/线名有两种落点：普通节点走文本，可编辑的轨道名走 <input value>（TimelinePane:4245）。
const has = (s: string) =>
  texts().some((x) => x === s) || Array.from(document.body.querySelectorAll('input')).some((i) => i.value === s);
const buttonByTitle = (title: string) => document.body.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
/** PaneHeader / 小节头都是「标签 span + 数字 span」的相邻兄弟结构。 */
function countByLabel(label: string): (string | null)[] {
  return Array.from(document.body.querySelectorAll('span'))
    .filter((s) => s.textContent === label)
    .map((s) => s.nextElementSibling?.textContent ?? null);
}
/** 先扳正后落书的顺序证据：setActiveBook(card) 必须早于该写动作。 */
function ensuredBefore(bookId: string, write: ReturnType<typeof vi.fn>) {
  const wire = h.writing.setActiveBook.mock.calls.findIndex((c) => c[0] === bookId);
  expect(wire, `写动作前必须先按本卡书「${bookId}」扳正工作室接线`).toBeGreaterThanOrEqual(0);
  expect(h.writing.setActiveBook.mock.invocationCallOrder[wire]).toBeLessThanOrEqual(
    write.mock.invocationCallOrder[0],
  );
}

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
const line = (id: string, bookId: string, name: string) => ({
  id,
  bookId,
  name,
  color: '',
  description: '',
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});
const foreshadow = (id: string, bookId: string, title: string) => ({
  id,
  bookId,
  title,
  description: '',
  plantChapterId: null,
  payoffChapterId: null,
  status: 'pending',
  storylineId: null,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});
const ev = (id: string, bookId: string, at: string, event: string, extra: Record<string, unknown> = {}) => ({
  id,
  bookId,
  settingId: null,
  at,
  timeKey: null,
  event,
  chapterId: null,
  storylineId: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

// 小说 A = 工作室当前活跃书（旧口径的受害者来源）；诗歌 B = 卡片真正所属的书。
const NOVEL_A = { id: 'bA', title: '长夜行', genre: 'novel' };
const POEM_B = { id: 'bB', title: '海上有风', genre: 'poetry' };
// 小说 C：时间线卡的宿主。建线入口只对**允许剧情线的体裁**敞开（⑲ 闸口），
// 所以那几枚用例必须拿「另一本小说」当本卡书，分叉照造、体裁闸不误伤。
const NOVEL_C = { id: 'bC', title: '潮汐志', genre: 'novel' };

beforeEach(() => {
  vi.clearAllMocks();
  h.writing.books = [NOVEL_A, POEM_B, NOVEL_C];
  h.writing.chapters = [chapter('cA1', 'bA', '第一章'), chapter('cB1', 'bB', '第一首'), chapter('cB2', 'bB', '第二首')];
  h.writing.outlines = [];
  h.writing.settings = [];
  h.writing.storylines = [];
  h.writing.foreshadowings = [];
  h.writing.timelineEvents = [];
  h.writing.activeBookId = 'bA';
  const es = useEditorStore.getState();
  es.selectStoryline(null);
  es.selectForeshadowing(null);
  es.selectTimelineEvent(null);
  es.setTimelineViewMode('book');
});

// ───────────────────────── ①② 剧情线卡：行表本体 + 行尾事件数 + 栏头计数 ─────────────────────────

describe('AI-12 ①② StorylinesPane · 行表/计数按本卡书（含跨书脏事件的行尾计数）', () => {
  const pane = (cardBookId: string) => <StorylinesPane accent="#4A338F" bookId={cardBookId} />;

  beforeEach(() => {
    h.writing.storylines = [line('slA1', 'bA', '长夜主线'), line('slB1', 'bB', '海上主线')];
    // evX 是**跨书脏事件**：bookId 指向小说 A，storylineId 却挂着诗集 B 的线。
    // 它是 ①-b 唯一的牙 —— 只摘掉事件那道门时，「海上主线」行会印成「2 个事件」。
    h.writing.timelineEvents = [
      ev('evB1', 'bB', '第三年', '诗集事件', { storylineId: 'slB1' }),
      ev('evX', 'bA', '第五年', '跨书脏事件', { storylineId: 'slB1' }),
      ev('evA1', 'bA', '第一夜', '小说事件', { storylineId: 'slA1' }),
    ];
  });

  it('①-a 行表本体：他书线名绝迹、本卡线名在场（摘掉 lines 那道门当场红）', () => {
    mount(pane('bB'));
    expect(has('长夜主线'), '诗集卡的行表里渲染出了小说的线').toBe(false);
    expect(has('海上主线'), '本卡书的线没渲染出来').toBe(true);
  });

  it('①-b 行尾事件数：跨书脏事件不得计进本卡行（观测点不是永真空态）', () => {
    mount(pane('bB'));
    const one = t('editor.writing.timelineEventCount', { n: 1 });
    const two = t('editor.writing.timelineEventCount', { n: 2 });
    expect(has(one), `本卡线应计 1 个事件（「${one}」没渲染）`).toBe(true);
    expect(has(two), `他书事件被计进了本卡线（出现了「${two}」）`).toBe(false);
  });

  it('② 栏头计数与本卡行数同源：印「1」不印缓存的「2」', () => {
    mount(pane('bB'));
    const counts = countByLabel(t('writing.viewKind.storylines'));
    expect(counts.length, '栏头计数 span 没找到').toBeGreaterThanOrEqual(1);
    for (const c of counts) expect(c, '栏头/小节计数还在吃整份活跃书缓存').toBe('1');
  });

  it('零回归：活跃书 == 本卡书时逐字不变（同书是 no-op，不是把功能关掉）', () => {
    mount(pane('bA'));
    expect(has('长夜主线')).toBe(true);
    expect(has('海上主线'), '同书路径下本卡就是 A，B 的线同样不该出现').toBe(false);
    expect(countByLabel(t('writing.viewKind.storylines'))[0]).toBe('1');
  });
});

// ────────────────────────── ③ 伏笔卡：行表 + 两处计数 + 默认名 + 写侧落书 ──────────────────────────

describe('AI-12 ③ ForeshadowingsPane · 行表/计数/默认名/落书四嘴按本卡书', () => {
  const pane = (cardBookId: string) => <ForeshadowingsPane accent="#4A338F" bookId={cardBookId} />;

  beforeEach(() => {
    h.writing.foreshadowings = [foreshadow('fsA1', 'bA', '伏笔-小说'), foreshadow('fsB1', 'bB', '伏笔-诗集')];
  });

  it('行表：他书伏笔绝迹、本卡伏笔在场', () => {
    mount(pane('bB'));
    expect(has('伏笔-小说'), '诗集卡上列出了小说的伏笔').toBe(false);
    expect(has('伏笔-诗集')).toBe(true);
  });

  it('两处计数（PaneHeader + 小节头）都收口：出现任何一个「2」即红', () => {
    mount(pane('bB'));
    const counts = countByLabel(t('writing.viewKind.foreshadowing'));
    expect(counts.length, '计数 span 没找到').toBeGreaterThanOrEqual(1);
    for (const c of counts) expect(c, '有一处计数没跟着行表换源').toBe('1');
  });

  it('「记一条伏笔」：默认名按本卡数（伏笔 2，不是缓存算出的伏笔 3），且先扳正本卡书再落库', async () => {
    mount(pane('bB'));
    const btn = buttonByTitle(t('writing.foreshadowCreate'));
    expect(btn, '「记一条伏笔」按钮没渲染').toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    expect(h.writing.createForeshadowing).toHaveBeenCalledTimes(1);
    const name = h.writing.createForeshadowing.mock.calls[0][0];
    expect(name).toBe(t('writing.foreshadowDefaultName', { n: 2 }));
    expect(name, '默认名吃的是活跃书缓存的条数').not.toBe(t('writing.foreshadowDefaultName', { n: 3 }));
    ensuredBefore('bB', h.writing.createForeshadowing);
  });

  it('零回归：同书卡逐字不变（活跃 A 看 A 的伏笔，计数 1）', () => {
    mount(pane('bA'));
    expect(has('伏笔-小说')).toBe(true);
    expect(has('伏笔-诗集')).toBe(false);
    expect(countByLabel(t('writing.viewKind.foreshadowing'))[0]).toBe('1');
  });

  // 反证 M8/M9 第一次没牙补上的观测点（轮 24 F2 的测试侧同族）：本卡书**零伏笔**、缓存里躺着
  // 别书两条时，旧口径会把「空态提示」咽下去、把「排序开关」亮出来 —— 这两件事只有这两扇门
  // 自己能变红，前面所有用例里两条门与行表门互相拦截，摘掉谁都没人红。
  it('本卡零伏笔：空态提示在场、排序开关缺席（宁缺不错，不是把功能关掉）', () => {
    mount(pane('bC'));
    expect(document.body.textContent ?? '').toContain(t('writing.foreshadowEmptyHint'));
    expect(has(t('writing.foreshadowSortStatus')), '缓存里有别书伏笔就给空卡亮出排序开关').toBe(false);
    expect(has(t('writing.foreshadowSortPayoff'))).toBe(false);
    expect(countByLabel(t('writing.viewKind.foreshadowing')).length).toBeGreaterThanOrEqual(1);
    for (const c of countByLabel(t('writing.viewKind.foreshadowing'))) expect(c).toBe('0');
  });
});

// ───────────────────────── ④ 时间线卡：主轨事件 / 假冲突 / 轨道 / 建线 / 挂线 ─────────────────────────

describe('AI-12 ④ TimelinePane · 轴上四嘴 + 写侧两嘴按本卡书', () => {
  const pane = (cardBookId: string) => <TimelinePane accent="#4A338F" bookId={cardBookId} />;
  const chip = (id: string) => document.body.querySelector(`[data-ev-id="${id}"]`);
  const warnOf = (id: string) =>
    document.body.querySelector(`[data-ev-id="${id}"] [title="${t('writing.timelineConflictHint')}"]`);

  beforeEach(() => {
    h.writing.chapters = [chapter('cA1', 'bA', '第一章'), chapter('cC1', 'bC', '第一章')];
    h.writing.storylines = [line('slA', 'bA', '长夜主线'), line('slC', 'bC', '潮汐主线')];
    // 三条事件同挂「全书级」轨（settingId=null）、同 at=第三年：
    // · 本卡 bC 只该看见 evC ⇒ 单条不成碰撞 ⇒ 没有橙标（④-c 的牙：他书事件能凭空造出假冲突）
    // · 换成 bA 卡则 evA/evA2 真碰撞 ⇒ 橙标在场（正向对照，防「永真空态」把 absence 测成假绿）
    h.writing.timelineEvents = [
      ev('evC', 'bC', '第三年', '潮汐事件'),
      ev('evA', 'bA', '第三年', '长夜事件'),
      ev('evA2', 'bA', '第三年', '长夜事件二'),
    ];
  });

  it('④-a 主轨事件：他书事件卡不上本卡画布，本卡事件在场', () => {
    mount(pane('bC'));
    expect(chip('evA'), '小说 A 的事件排进了小说 C 的轴').toBeNull();
    expect(chip('evA2')).toBeNull();
    expect(chip('evC'), '本卡书的事件没渲染').toBeTruthy();
  });

  it('④-c 冲突计算：假冲突不出现（正向对照证明这枚观测点有牙）', () => {
    mount(pane('bC'));
    expect(warnOf('evC'), '他书同轨同时点的事件给本卡事件扣了个假冲突').toBeNull();
    remount(pane('bA'));
    expect(warnOf('evA'), '本卡两条同时点事件本该报碰撞 —— 观测点若恒为 null，这条 absence 是假绿').toBeTruthy();
  });

  it('④-b 剧情线轴：他书轨道绝迹、本卡轨道在场', () => {
    mount(pane('bC'));
    act(() => {
      useEditorStore.getState().setTimelineViewMode('storyline');
    });
    // 正向对照：先证明「本卡有线的轨」这套渲染真的会出字（否则 absence 是假绿）
    expect(has('潮汐主线'), '本卡的轨在剧情线轴上没铺出来 —— 观测点本身失效').toBe(true);
    expect(has('长夜主线'), '剧情线轴上铺了别书的轨').toBe(false);
    expect(has('潮汐主线'), '本卡的轨没铺出来').toBe(true);
  });

  it('④-d 新建剧情线：默认名按本卡数（剧情线 2），且先扳正本卡书再落库', async () => {
    mount(pane('bC'));
    act(() => {
      useEditorStore.getState().setTimelineViewMode('storyline');
    });
    const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === `＋ ${t('writing.storylineCreate')}`,
    );
    expect(btn, '小说卡的「＋新建剧情线」没渲染（体裁闸或口径按钮出问题）').toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    expect(h.writing.createStoryline).toHaveBeenCalledTimes(1);
    const name = h.writing.createStoryline.mock.calls[0][0];
    expect(name).toBe(t('writing.storylineDefaultName', { n: 2 }));
    expect(name, '默认名吃的是活跃书缓存的条数').not.toBe(t('writing.storylineDefaultName', { n: 3 }));
    ensuredBefore('bC', h.writing.createStoryline);
  });

  it('④-e 新建事件：扳不动就不建，扳正必须早于落库', async () => {
    mount(pane('bC'));
    const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === `＋ ${t('writing.timelineCreateEvent')}`,
    );
    expect(btn, '「＋新建事件」没渲染').toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    expect(h.writing.createTimelineEvent).toHaveBeenCalledTimes(1);
    ensuredBefore('bC', h.writing.createTimelineEvent);
  });

  it('④-f「挂线」选择器：本卡无线就不出现（不吃他书的线做候选），同书卡正向对照仍在', () => {
    h.writing.storylines = [line('slA', 'bA', '长夜主线')];
    mount(pane('bC'));
    expect(
      document.body.querySelector(`input[placeholder="${t('writing.storylineUnlined')}"]`),
      '本卡没有一条线，却把小说 A 的线端成了挂线候选',
    ).toBeNull();
    remount(pane('bA'));
    expect(
      document.body.querySelector(`input[placeholder="${t('writing.storylineUnlined')}"]`),
      '同书路径把挂线选择器一起关掉了 = 减法做过头',
    ).toBeTruthy();
  });
});

// ─────────────────────────────── 源码锁：绝迹 + 接线（防「下一轮又长回嘴」）───────────────────────────────

describe('AI-12 源码锁 · writingPanes.tsx 四张嘴的绝迹面', () => {
  const src = stripComments(read('editor/renderers/writingPanes.tsx'));
  const win = (from: string, to: string) => {
    const i = src.indexOf(from);
    expect(i, `锚点「${from}」没找到`).toBeGreaterThanOrEqual(0);
    const j = src.indexOf(to, i + from.length);
    expect(j, `窗口终点「${to}」没找到`).toBeGreaterThanOrEqual(0);
    return src.slice(i, j);
  };

  it('事件区行表不再渲染未过滤集合（认书那一刀的残余封死）', () => {
    const w = win('function StorylineSection(', 'export function StorylinePane(');
    expect(w, '行表又改回渲染整份 storylines 缓存').not.toMatch(/\{storylines\.(map|length)/);
  });

  it('伏笔卡的排序/计数/默认名全部换源', () => {
    const w = win('export function ForeshadowingsPane(', 'export function InspirationsPane(');
    expect(w, '行表排序吃回缓存').not.toMatch(/sortForeshadowings(ByPayoff)?\(foreshadowings,/);
    expect(w, '计数吃回缓存').not.toMatch(/\{?count=\{foreshadowings\.length\}|marginBottom: foreshadowings\.length/);
  });

  it('时间线卡四嘴 + 挂线选择器换源（同一道闸的调用点一枚不少）', () => {
    const w = win('export function TimelinePane(', 'function EventChip(');
    expect(w, '主轨/冲突吃回缓存').not.toMatch(/of timelineEvents\)|computeTimelineConflicts\(timelineEvents/);
    expect(w, '轨道与建线命名吃回缓存').not.toMatch(/storylines\.map\(\(sl\)|n: storylines\.length/);
    expect(w, '装载 guard 被顺手改动了').toMatch(/if \(ws\.storylines\.length === 0\) void ws\.loadStorylines\(\)/);
    for (const k of ['bookEvents', 'bookStorylines', 'handleCreateStoryline']) {
      expect(w, `时间线卡里「${k}」没接上`).toContain(k);
    }
  });

  it('EventChip 四处调用点统一递本卡线清单（挂线候选不再来自缓存）', () => {
    expect((src.match(/storylines=\{bookStorylines\}/g) ?? []).length).toBe(4);
    expect(src, '还有一处把整份缓存递给「挂线」选择器').not.toMatch(/storylines=\{storylines\}/);
  });
});
