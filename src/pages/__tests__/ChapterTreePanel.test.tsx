// 写作台左栏「章节」tab 树形渲染 ChapterTreePanel · 回归锁（2026-09-22）
//
// 背景：左栏此前是扁平列表 + 遗留 volume 分组头；本次改为按 writing_chapters.parentId
// 的**父子关系缩进**的树（镜像工作室「作品目录树」的行结构）。这条测试锁死六件事：
// ① 导出物必须是 memo 包裹（与 ChapterListPanel 同因：自动保存每 800ms 翻转顶层 state）；
// ② 树形几何：按 depth 画祖先引导线 + 末端 elbow（深一层多两条线）；容器给「N 章」、叶给字数；
// ③ 折叠：折叠态由 props 驱动（与大纲视图共用 store 那份）→ 收起时整棵子树不渲染；
//    点折叠尖角只 toggleNodeCollapse、**不**误触切章（stopPropagation）；
// ④ 点行 = setActiveChapter + 清设定选中（与改动前的扁平列表逐字一致）；
//    批量模式点行 = 切换选中 updater（不切章）；
// ⑤ 行尾动作：＋子级（createChildNode，层级名按体裁顺延）/ 移卷 / 改名 / 删除走 openDialog，
//    且 stopPropagation 不误触切章；
// ⑥ 双通道拖拽：⠿ 手柄拖动 → reparentNode（挂为其子级）；行身拖动 → reorderChapter（移到该行之前）；
//    检索保留祖先链（命中的孙节点 → 父节点也渲染）；volume 分组头只在**无层级**的旧模型书出现。
// ⑦ 同级上/下移手势：↑ = 移到前兄弟扁平位（它之前）；↓ = 移到后兄弟扁平位（它之后，
//    reorderChapter 重排在移除后进行，插入点恰在其后一格）；首/末兄弟不渲染对应按钮；
//    检索/多选期手势消失；点击不误触切章。
//
// 组件是纯 props 驱动（不碰 writingStore / Tauri），本测试零 mock。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

import { ChapterTreePanel } from '../ChapterTreePanel';
import type { ChapterTreePanelProps } from '../ChapterTreePanel';
import type { WritingChapter } from '../../services/tauri';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function chapter(id: string, title: string, over: Partial<WritingChapter> = {}): WritingChapter {
  return {
    id,
    bookId: 'b1',
    title,
    content: '',
    sortOrder: 0,
    wordCount: 0,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '章',
    extra: '',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/** 两个根（卷一 / 卷二）+ 卷一下一个章；sortOrder 决定同级顺序（buildTree 依它排序） */
const BOOK: WritingChapter[] = [
  chapter('v1', '卷一', { kind: '卷', sortOrder: 1 }),
  chapter('c1', '第一章', { parentId: 'v1', sortOrder: 2, wordCount: 1200 }),
  chapter('c2', '第二章', { parentId: 'v1', sortOrder: 3 }),
  chapter('v2', '卷二', { kind: '卷', sortOrder: 4 }),
];

const FLAT_INDEX = new Map([
  ['v1', 0],
  ['c1', 1],
  ['c2', 2],
  ['v2', 3],
]);

function baseProps(over: Partial<ChapterTreePanelProps> = {}): ChapterTreePanelProps {
  const chapters = over.chapters ?? BOOK;
  return {
    chapters,
    visibleChapters: chapters,
    chapterIndexById: FLAT_INDEX,
    activeChapterId: null,
    chapterQuery: '',
    chapterSearchQuery: '',
    selectionMode: false,
    selectedChapterIds: [],
    setSelectedChapterIds: vi.fn(),
    setActiveSetting: vi.fn(),
    setActiveChapter: vi.fn(),
    dragChapterIdRef: { current: null },
    flushSave: vi.fn(async () => {}),
    setDropIndex: vi.fn(),
    reorderChapter: vi.fn(async () => {}),
    reparentNode: vi.fn(async () => {}),
    dropIndex: null,
    openDialog: vi.fn(),
    outlines: [],
    genre: 'novel',
    collapsedNodeIds: [],
    toggleNodeCollapse: vi.fn(),
    createChildNode: vi.fn(async () => null),
    ...over,
  };
}

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-testid="chapter-row-${id}"]`);
  expect(el, `章行 ${id} 应渲染`).toBeTruthy();
  return el as HTMLElement;
}

function maybeRow(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="chapter-row-${id}"]`);
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 树形几何：行容器里除本行外的直接子元素 = 祖先引导线 + 末端 elbow 的条数 */
function guideCount(id: string): number {
  const wrapper = row(id).parentElement as HTMLElement;
  return wrapper.querySelectorAll(':scope > *').length - 1;
}

/** jsdom 没有 DataTransfer：造一个带动态 types 的替身（拖拽分流全靠 types） */
function makeDT(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    effectAllowed: '',
    dropEffect: '',
    get types() {
      return Array.from(store.keys());
    },
    setData(k: string, v: string) {
      store.set(k, v);
    },
    getData(k: string) {
      return store.get(k) ?? '';
    },
    clearData() {
      store.clear();
    },
  };
}

async function fireDrag(el: HTMLElement, type: string, dt: ReturnType<typeof makeDT>) {
  await act(async () => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    el.dispatchEvent(ev);
  });
}

describe('写作台左栏章节树 ChapterTreePanel（树形化 · 回归锁）', () => {
  it('导出物必须是 memo 包裹（自动保存每 800ms 翻转顶层 state，隔离不能退化）', () => {
    expect((ChapterTreePanel as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('按 parentId 缩进：子级多画祖先引导线 + elbow；容器给「N 章」、叶给字数', () => {
    mount(<ChapterTreePanel {...baseProps()} />);

    for (const id of ['v1', 'c1', 'c2', 'v2']) row(id);
    // 根节点（depth 0）无引导线；子级（depth 1）多两条：竖线 + 末端 elbow
    expect(guideCount('v1'), '根节点不应画引导线').toBe(0);
    expect(guideCount('c1'), '子级应画「竖线 + elbow」两条').toBe(2);
    // 容器给子树章数（树口径：容器不算内容，只数叶章），叶给自身字数
    expect(row('v1').textContent).toContain('2 章');
    expect(row('c1').textContent).toContain('1200 字');
    // 卷二无子级 → 不该出现「N 章」
    expect(row('v2').textContent).not.toContain('章');
  });

  it('折叠：收起时整棵子树不渲染，点折叠尖角只 toggle、不误触切章', async () => {
    const props = baseProps({ collapsedNodeIds: ['v1'] });
    mount(<ChapterTreePanel {...props} />);

    row('v1');
    expect(maybeRow('c1'), '收起时子级不应渲染').toBeNull();

    // 展开：点 v1 行内的折叠尖角（已有子级才画）
    const chevron = row('v1').querySelector('[data-testid="ExpandMoreIcon"]') as HTMLElement;
    expect(chevron, '收起态应画展开箭头').toBeTruthy();
    await click(chevron);
    expect(props.toggleNodeCollapse).toHaveBeenCalledWith('v1');
    expect(props.setActiveChapter, '点尖角不应切章').not.toHaveBeenCalled();
  });

  it('点行 = 切章并清设定选中；批量模式点行 = 切换选中 updater（不切章）', async () => {
    const props = baseProps();
    mount(<ChapterTreePanel {...props} />);
    await click(row('c2'));
    expect(props.setActiveChapter).toHaveBeenCalledWith('c2');
    expect(props.setActiveSetting).toHaveBeenCalledWith(null);

    const setSelectedChapterIds = vi.fn();
    const batch = baseProps({ selectionMode: true, selectedChapterIds: [], setSelectedChapterIds });
    if (root) act(() => root!.unmount());
    document.body.innerHTML = '';
    mount(<ChapterTreePanel {...batch} />);
    await click(row('c1'));
    expect(batch.setActiveChapter).not.toHaveBeenCalled();
    expect(setSelectedChapterIds).toHaveBeenCalledTimes(1);
    const updater = setSelectedChapterIds.mock.calls[0][0] as (ids: string[]) => string[];
    expect(updater([])).toEqual(['c1']);
    expect(updater(['c1'])).toEqual([]);
  });

  it('行尾动作：＋子级按体裁顺延层级名，移卷/改名/删除走 openDialog，均不误触切章', async () => {
    const props = baseProps();
    mount(<ChapterTreePanel {...props} />);

    const btns = Array.from(row('v1').querySelectorAll('button'));
    // v1 是首个根：无「上移」、有「下移」→ 下移 / ＋子级 / 移卷 / 改名 / 删除 共五个动作
    expect(btns.length, '应有 下移 / ＋子级 / 移卷 / 改名 / 删除 五个动作').toBe(5);

    // 卷（depth 0，novel → 默认层级 卷/章）→ 子级应为「章」；默认名 = 已有子级数 + 1（卷一下已有两个章 → 章 3）
    await click(btns[1]);
    expect(props.createChildNode).toHaveBeenCalledWith('v1', '章', '章 3');
    await click(btns[2]);
    expect(props.openDialog).toHaveBeenCalledWith({ kind: 'move-volume', chapterId: 'v1' }, '');
    await click(btns[3]);
    expect(props.openDialog).toHaveBeenCalledWith({ kind: 'rename-chapter', chapterId: 'v1' }, '卷一');
    await click(btns[4]);
    expect(props.openDialog).toHaveBeenCalledWith({ kind: 'delete-chapter', chapterId: 'v1' });
    expect(props.setActiveChapter).not.toHaveBeenCalled();
  });

  it('同级上/下移：↑ 移到前兄弟之前、↓ 移到后兄弟之后；首/末兄弟无对应按钮；检索期消失', async () => {
    const props = baseProps();
    mount(<ChapterTreePanel {...props} />);

    const btnsOf = (id: string) => Array.from(row(id).querySelectorAll('button'));
    // v1 首根（无上移）；v2 末根（无下移）→ 各 5 个动作
    expect(btnsOf('v2').length).toBe(5);
    // v1 下移 → 后兄弟 v2 的扁平位 3（重排在移除后进行，插入点恰在其后一格）
    await click(btnsOf('v1')[0]);
    expect(props.reorderChapter).toHaveBeenCalledWith('v1', 3);
    // v2 上移 → 前兄弟 v1 的扁平位 0（移到它之前）
    await click(btnsOf('v2')[0]);
    expect(props.reorderChapter).toHaveBeenCalledWith('v2', 0);
    // c1（兄弟 c1→c2）：下移 → c2 的扁平位 2；c2：上移 → c1 的扁平位 1
    await click(btnsOf('c1')[0]);
    expect(props.reorderChapter).toHaveBeenCalledWith('c1', 2);
    await click(btnsOf('c2')[0]);
    expect(props.reorderChapter).toHaveBeenCalledWith('c2', 1);
    expect(props.setActiveChapter, '点移动按钮不应误触切章').not.toHaveBeenCalled();

    // 检索期手势消失（与拖拽同口径）：只剩 ＋子级 / 移卷 / 改名 / 删除
    if (root) act(() => root!.unmount());
    document.body.innerHTML = '';
    mount(
      <ChapterTreePanel
        {...baseProps({ chapterQuery: '第一章', chapterSearchQuery: '第一章', visibleChapters: [BOOK[1]] })}
      />,
    );
    expect(Array.from(row('c1').querySelectorAll('button')).length, '检索期不显示上/下移').toBe(4);
  });

  it('双通道拖拽：⠿ 手柄 → reparentNode（挂为其子级）；行身 → reorderChapter（移到该行之前）', async () => {
    const props = baseProps();
    mount(<ChapterTreePanel {...props} />);

    // 手柄通道：手柄是行内更深的 draggable，其 dragstart 先写入 NEST MIME
    const handle = row('c2').querySelector('span[draggable="true"]') as HTMLElement;
    expect(handle, '行首应有 ⠿ 拖拽手柄').toBeTruthy();
    expect(handle.getAttribute('title')).toBeTruthy();
    const nestDT = makeDT();
    await fireDrag(handle, 'dragstart', nestDT);
    await fireDrag(row('v2'), 'drop', nestDT);
    expect(props.reparentNode).toHaveBeenCalledWith('c2', 'v2');
    expect(props.reorderChapter, '手柄拖动不应触发重排').not.toHaveBeenCalled();

    // 行身通道：不带 NEST MIME → 走既有的「移到该行之前」，入参是扁平下标
    const bodyDT = makeDT();
    await fireDrag(row('c2'), 'dragstart', bodyDT);
    expect(bodyDT.types, '行身拖动不应写 NEST MIME').not.toContain('application/x-chapter-nest');
    await fireDrag(row('c1'), 'drop', bodyDT);
    expect(props.reorderChapter).toHaveBeenCalledWith('c2', 1);
    expect(props.flushSave, '拖动前应先 flush 未保存正文').toHaveBeenCalled();
  });

  it('检索保留祖先链：命中的孙节点会让父容器一起渲染；无命中 → 空态且零行', () => {
    mount(
      <ChapterTreePanel
        {...baseProps({
          chapterQuery: '第一章',
          chapterSearchQuery: '第一章',
          visibleChapters: [BOOK[1]],
        })}
      />,
    );
    row('v1'); // 命中项的父容器：保留
    row('c1'); // 命中项
    expect(maybeRow('c2'), '未命中的兄弟不应渲染').toBeNull();
    expect(maybeRow('v2'), '未命中的其它根不应渲染').toBeNull();

    if (root) act(() => root!.unmount());
    document.body.innerHTML = '';
    mount(
      <ChapterTreePanel
        {...baseProps({ chapterQuery: '不存在', chapterSearchQuery: '不存在', visibleChapters: [] })}
      />,
    );
    expect(document.querySelector('[data-testid^="chapter-row-"]')).toBeNull();
    expect((document.body.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('volume 分组头只对「无 parentId 层级」的旧模型书出现（旧书零变化，新树不混入遗留字段）', () => {
    // 旧模型书：全部是根 + 有 volume 字符串 → 与改动前的扁平列表同款分组头
    const legacy = [
      chapter('a', '章 一', { volume: '卷一' }),
      chapter('b', '章 二', { volume: '卷一' }),
      chapter('c', '章 三', { volume: '卷二' }),
    ];
    mount(<ChapterTreePanel {...baseProps({ chapters: legacy })} />);
    expect(document.body.textContent).toContain('卷一');
    expect(document.body.textContent).toContain('卷二');

    if (root) act(() => root!.unmount());
    document.body.innerHTML = '';
    // 有层级的新模型书：即使某些行带 volume，也不再渲染分组头（由 parentId + kind 表达结构）
    const withTree = BOOK.map((c) => (c.id === 'c1' ? { ...c, volume: '遗留卷名' } : c));
    mount(<ChapterTreePanel {...baseProps({ chapters: withTree })} />);
    expect(document.body.textContent).not.toContain('遗留卷名');
    // 但「移卷」能力仍在：行尾动作照旧（c1 有后兄弟 → 多一个「下移」= 5 个）
    expect(Array.from(row('c1').querySelectorAll('button')).length).toBe(5);
  });
});
