/**
 * 项目代码工作台状态（IDE 风格：文件树 + 多标签编辑器）
 *
 * 取代原先的单文件 dialog（SourceViewerDialog）。点击任意「打开源码」入口
 * 不再弹一个孤立的查看器，而是拉起整个项目的工作台：左侧文件树加载全部
 * 已扫描文件（轻量元数据，内容按需懒加载），中间多标签编辑器，焦点定位到
 * 当前跳转的文件与行。符合「比 IDEA 更强的开发平台」定位。
 *
 * 多窗格（multi-pane）模型（2026-08-26 引入，对标 Zed `PaneGroup`）：
 *  - 工作台由若干「窗格(Pane)」组成，每个窗格拥有自己独立的标签集合与激活标签；
 *  - 所有既有动作（openTab/closeTab/...）语义保持不变，但作用于「当前激活窗格」
 *    （与 Zed 一致：操作总落在聚焦的 pane 上）；
 *  - 新增 splitPane / closePane / setActivePane 用于拆分/关闭/切换；
 *  - splitPaneWithTab / setDraggingTab 支撑「跨窗格拖拽标签拆分」（对标 Zed
 *    `drag_split_direction`：拖到目标窗格边缘→按方向拆分、拖到中心→移入该窗格）；
 *  - 布局为递归窗格树 `paneTree`（对标 Zed `PaneGroup.root: Member = Pane | Axis`，
 *    Axis 可嵌套 Axis），支持任意层级嵌套拆分；每个 axis 节点独立持 flex 权重，
 *    `setAxisFlexes` / `resetPaneSizes` 调整/复位尺寸（对标 Zed `PaneAxis.flexes`）。
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { projectScanApi, type SourceFileContent } from '../services/tauri';
import type { SourceMark } from './sourceViewerStore';
import { useProjectStore } from './projectStore';

/** 工作台里一个已打开的文件标签 */
export type WorkbenchTabKind = 'text' | 'image' | 'svg' | 'markdown';

/** 编辑器书签（对标 Zed crates/editor/src/bookmarks.rs 的 BookmarkStore 单条记录）。
 *  - line 为 1 起的行号（对标 Zed 以 buffer anchor 记录，这里用稳定行号即可，重排后由用户重标）；
 *  - label 可选备注（对标 Zed ToggleBookmarkWithLabel 的 label），用于「查看书签」清单区分。 */
export interface WorkbenchBookmark {
  line: number;
  label?: string;
}

/** 由文件名 / 相对路径推断工作台标签的内容类型（对标 Zed 按扩展名分派 ImageViewer / SvgPreview / MarkdownPreview） */
export function detectTabKind(relPath: string, name: string): WorkbenchTabKind {
  const base = (name || relPath || '').toLowerCase();
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'avif', 'tif', 'tiff'].includes(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'markdown';
  return 'text';
}

export interface WorkbenchTab {
  fileId: string;
  relPath: string;
  name: string;
  language: string | null;
  loading: boolean;
  error: string | null;
  content: SourceFileContent | null;
  /** 打开/定位时请求跳转的行（1 起）；null 表示从头显示 */
  focusLine: number | null;
  /** 打开/定位时请求跳转的列（1 起，配合 focusLine 实现「路径:行:列」精确落点）；null 表示从行首 */
  focusColumn: number | null;
  reason: string | null;
  marks: SourceMark[];
  /** 加载序号，丢弃过期响应 */
  seq: number;
  /** 钉住标签：常驻不被「关闭其他/左/右」清除，且排序在前（对标 Zed Pin Tab） */
  pinned: boolean;
  /** 只读标签：编辑器禁止编辑（对标 Zed `Make Tab Read-Only`，写回前保护文件不被误改） */
  readOnly: boolean;
  /** 内容类型：决定工作台用 Monaco 编辑还是图像 / SVG / Markdown 预览渲染（对标 Zed 按扩展名分派预览视图） */
  kind: WorkbenchTabKind;
  /** 对比视图规格（对标 Zed DiffEditor 双 buffer 对照）：存在时该标签渲染只读 DiffEditor 而非普通编辑器。
   *  - kind="saved"：modified=当前工作缓冲区，original=磁盘已保存版本（未保存改动对照，renderable AND useful）；
   *  - kind="file"：modified=当前文件，original=另一已打开文件（跨文件对照，审查重复/相近实现）。
   *  仅持有两段文本快照，不参与布局持久化（snapshotLayout 只存 fileIds），重载后该标签回落为普通文件标签，零回归。 */
  diff?: WorkbenchDiffSpec;
}

/** 对比视图两端文本快照（只读，打开瞬间定格；对标 Zed diff buffer 的 original/modified 两侧） */
export interface WorkbenchDiffSpec {
  kind: 'saved' | 'file';
  /** 修改侧标签（如「file.ts — 工作区」） */
  modifiedLabel: string;
  /** 修改侧文本（当前缓冲区 / 当前文件内容） */
  modifiedText: string;
  /** 原始侧标签（如「磁盘已保存」/「other.ts」） */
  originalLabel: string;
  /** 原始侧文本（磁盘版本 / 另一文件内容） */
  originalText: string;
}

/** 一个独立窗格：拥有自己的标签集合与激活标签（对标 Zed `Pane`） */
export interface WorkbenchPane {
  id: string;
  tabs: WorkbenchTab[];
  activeFileId: string | null;
}

export type SplitDirection = 'left' | 'right' | 'up' | 'down';
export type SplitMode = 'clone' | 'empty' | 'move';

/** 窗格轴朝向（对标 Zed `Axis`：Horizontal=左右并排 / Vertical=上下堆叠）。
 *  用 row/col 而非 horizontal/vertical，与 CSS flexDirection 直接对应。 */
export type PaneOrientation = 'row' | 'col';

/** 递归窗格树节点（对标 Zed `PaneGroup.root: Member` = `Pane | Axis(PaneAxis)`）。
 *  - 叶子 `pane`：仅持 id，标签数据仍存于 `panes` 字典（与 Zed `members` 存 `Entity<Pane>` 同理）；
 *  - 内部 `axis`：持自身轴向 + 子节点数组 + 各子 flex 权重（对标 `PaneAxis { axis, members, flexes }`）。
 *  与 Zed 一致：axis 可嵌套 axis，从而支持任意层级递归拆分（Phase 1 的扁平 paneOrder 仅支持单层拆分）。 */
export type PaneNode =
  | { kind: 'pane'; id: string }
  | { kind: 'axis'; id: string; axis: PaneOrientation; children: PaneNode[]; flexes: number[] };

interface CodeWorkbenchState {
  open: boolean;
  /** 窗格字典：id → 窗格（每个窗格独立维护 tabs / activeFileId） */
  panes: Record<string, WorkbenchPane>;
  /** 递归窗格树（对标 Zed `PaneGroup.root`），决定布局的嵌套结构与各轴 flex 权重。 */
  paneTree: PaneNode;
  /** 当前聚焦窗格（所有动作作用于它，对标 Zed active pane） */
  activePaneId: string;
  /** 拖拽中的标签（跨窗格拖拽拆分用）：记录来源窗格与 fileId，供目标窗格判定落点 */
  draggingTab: { paneId: string; fileId: string } | null;
  /** 跨组件拖拽中的「文件树条目」（从工作台文件树拖出，落点窗格读取后开文件/拆分） */
  draggingFile: { fileId: string } | null;
  /** 检测到「外部/AI 改盘」且用户有未保存改动的文件（fileId 集合），供 UI 提示而非静默覆盖 */
  diskChanged: Set<string>;
  /** 窗格同步滚动（对标 Zed 多窗格同文件对照）：开启后所有窗格按滚动比例联动，
   *  最常用于「拆分同一文件为两个视图」时上下对照滚动（renderable AND useful）。 */
  syncScroll: boolean;
  /** 编辑器书签（对标 Zed BookmarkStore）：按 fileId 分桶，每条记录行号 + 可选备注。
   *  用于沟槽标记 + 「查看书签」清单 + 下一/上一书签导航（renderable AND useful 的可见/可行动态）。
   *  会话级（不随布局持久化），工作台关闭即清空——长期持久化留待续。 */
  bookmarks: Record<string, WorkbenchBookmark[]>;
}

interface CodeWorkbenchActions {
  /** 打开/定位一个文件标签（已加载则仅切换+更新焦点行） */
  openTab: (
    fileId: string,
    relPath: string,
    name: string,
    language: string | null,
    line?: number | null,
    reason?: string | null,
    marks?: SourceMark[],
    focusColumn?: number | null,
  ) => void;
  /** 切换激活标签（作用于当前窗格） */
  setActive: (fileId: string) => void;
  /** 切到当前窗格的下一个标签（到尾回绕，对标 Zed pane::ActivateNextItem） */
  activateNextTab: () => void;
  /** 切到当前窗格的上一个标签（到头回绕，对标 Zed pane::ActivatePreviousItem） */
  activatePrevTab: () => void;
  /** 按索引切到当前窗格的第 idx 个标签（越界忽略，对标 Zed pane::ActivateItem） */
  activateTabByIndex: (idx: number) => void;
  /** 跨窗格切到某已打开文件（定位其所在窗格并激活，对标 Zed buffer_picker 列出全部打开缓冲区） */
  activateBuffer: (fileId: string) => void;
  /** 关闭一个标签（关闭激活标签时回退到相邻标签） */
  closeTab: (fileId: string) => void;
  /** 钉住/取消钉住标签（对标 Zed TogglePinTab） */
  togglePin: (fileId: string) => void;
  /** 切换标签只读态（对标 Zed `Make Tab Read-Only` / `Make Tab Editable`） */
  toggleReadOnly: (fileId: string) => void;
  /** 关闭除 fileId 与已钉住标签外的所有标签（对标 Zed Close Others，保留 pinned） */
  closeOthers: (fileId: string) => void;
  /** 关闭 fileId 左侧的所有未钉住标签（对标 Zed Close Left，保留 pinned） */
  closeLeft: (fileId: string) => void;
  /** 关闭 fileId 右侧的所有未钉住标签（对标 Zed Close Right，保留 pinned） */
  closeRight: (fileId: string) => void;
  /** 关闭全部未钉住标签（对标 Zed Close All，保留 pinned） */
  closeAll: () => void;
  /** 拖拽重排标签（对标 Zed tab drag-reorder）：把 fromId 移动到「移除后数组」的 toIndex 处，
   *  保留 pinned 在前的不变量；落入 pinned 区域则自动钉住、从 pinned 区域拖出则自动取消钉住。 */
  reorderTab: (fromId: string, toIndex: number) => void;
  /** 在当前激活标签内跳到另一行 */
  jumpTo: (line: number, reason?: string | null) => void;
  /** 写回磁盘后同步标签内内存内容（不重读盘，保持编辑器不闪白） */
  setContent: (fileId: string, text: string) => void;
  /** 原地重读某标签的磁盘内容（AI/外部改盘后刷新，不卸载标签、不丢焦点） */
  reloadTab: (fileId: string) => Promise<void>;
  /** 标记某文件被外部改盘且存在未保存改动（UI 提示用户选择，避免静默覆盖） */
  markDiskChanged: (fileId: string) => void;
  /** 清除某文件的「外部改盘」提示态 */
  clearDiskChanged: (fileId: string) => void;
  /** 在指定标签上打开对比视图（只读 DiffEditor；对标 Zed DiffEditor 双 buffer 对照）。
   *  kind="saved"：工作缓冲区 vs 磁盘已保存版本（未保存改动对照）；kind="file"：当前文件 vs 另一已打开文件（跨文件对照）。
   *  跨窗格搜索目标 fileId，并把它所在窗格设为激活，使对比视图立即可见（renderable AND useful）。 */
  openDiffTab: (fileId: string, spec: WorkbenchDiffSpec) => void;
  /** 关闭整个工作台（回到画布） */
  close: () => void;
  // —— 多窗格（multi-pane）动作（对标 Zed PaneGroup） ——
  /** 以指定方向/模式拆分当前激活窗格，新窗格成为激活窗格 */
  splitPane: (direction: SplitDirection, mode: SplitMode) => void;
  /** 关闭一个窗格（至少保留一个；关闭后激活回退到最后一个） */
  closePane: (paneId: string) => void;
  /** 聚焦某个窗格（对标 Zed 点击/切到某 pane） */
  setActivePane: (paneId: string) => void;
  /** 把某标签从当前窗格移动到目标窗格（拖拽标签跨 pane 用，Phase 2 接入；此处提供基础实现） */
  /** 跨窗格移入：fileId 从来源窗格并入 toPaneId；toIndex 省略→末尾追加，传入→精确插入（对标 Zed move_item 的 destination_index） */
  moveTabToPane: (fileId: string, toPaneId: string, toIndex?: number) => void;
  /** 设置/清除跨窗格拖拽中的标签（拖拽起始时记录来源，落点时由目标窗格读取） */
  setDraggingTab: (info: { paneId: string; fileId: string } | null) => void;
  /** 设置/清除跨组件拖拽中的「文件树条目」（从工作台文件树拖出时记录 fileId） */
  setDraggingFile: (info: { fileId: string } | null) => void;
  /** 跨窗格拖拽落点：把 fileId 从 fromPaneId 拆分到 targetPaneId 的指定方向新窗格
   *  （对标 Zed `drag_split_direction`：拖到窗格边缘→按方向拆分、拖到中心→移入）。 */
  splitPaneWithTab: (fromPaneId: string, fileId: string, targetPaneId: string, direction: SplitDirection) => void;
  /** 跨组件拖拽落点：把文件树条目 fileId 拆分到 targetPaneId 的指定方向新窗格
   *  （对标 Zed `Event::SplitEntry`：从项目面板拖文件到窗格边缘→按方向拆分并以该文件开窗）。
   *  与 splitPaneWithTab 的差异：来源不是某个已开标签，而是文件树里的文件，故直接新建窗格承载。 */
  splitPaneWithFile: (targetPaneId: string, fileId: string, direction: SplitDirection) => void;
  /** 调整指定 axis 节点的各子 flex 权重（拖拽分隔条时实时调用；axisId 为轴节点 id） */
  setAxisFlexes: (axisId: string, flexes: number[]) => void;
  /** 复位所有 axis 的 flex 为均分（双击分隔条均分，对标 Zed 双击 handle） */
  resetPaneSizes: () => void;
  /** 清除持久化布局并复位为单窗格空编辑器（对标 Zed 重置工作区布局） */
  resetLayout: () => void;
  /** 开关窗格同步滚动（对标 Zed 多窗格同文件对照滚动） */
  toggleSyncScroll: () => void;
  // —— 窗格键盘导航（对标 Zed ActivatePaneInDirection / ActivateNextPane / SwapPanesInDirection） ——
  /** 按方向把焦点移到几何相邻的窗格（从激活窗格包围盒外扩取像素点，命中相邻窗格） */
  activatePaneInDirection: (direction: SplitDirection) => void;
  /** 循环切换到下一个窗格（对标 Zed `ActivateNextPane`） */
  activateNextPane: () => void;
  /** 循环切换到上一个窗格（对标 Zed `ActivatePrevPane`） */
  activatePrevPane: () => void;
  /** 按方向把当前窗格与相邻窗格交换位置（对标 Zed `SwapPanesInDirection`） */
  swapPanesInDirection: (direction: SplitDirection) => void;
  // —— 编辑器书签（对标 Zed ToggleBookmark / GoToNextBookmark / GoToPreviousBookmark / ViewBookmarks） ——
  /** 切换某文件指定行的书签（已存在则移除，否则新增，对标 Zed toggle_bookmark 幂等语义） */
  toggleBookmark: (fileId: string, line: number) => void;
  /** 设置某书签的备注（对标 Zed ToggleBookmarkWithLabel 的 label） */
  setBookmarkLabel: (fileId: string, line: number, label: string) => void;
  /** 移除某文件指定行的书签 */
  clearBookmark: (fileId: string, line: number) => void;
  /** 取某文件全部书签（升序），供编辑器渲染沟槽标记与下一/上一导航 */
  bookmarksForFile: (fileId: string) => WorkbenchBookmark[];
  /** 当前文件内下一书签（含回绕，对标 Zed GoToNextBookmark）；无书签返回 null */
  gotoNextBookmark: (fileId: string, line: number) => { fileId: string; line: number } | null;
  /** 当前文件内上一书签（含回绕，对标 Zed GoToPreviousBookmark）；无书签返回 null */
  gotoPrevBookmark: (fileId: string, line: number) => { fileId: string; line: number } | null;
  /** 全部书签扁平清单（带文件元信息），供「查看书签」选择器跨文件跳转（对标 Zed ViewBookmarks） */
  getAllBookmarks: () => { fileId: string; name: string; relPath: string; line: number; label?: string }[];
}

export type CodeWorkbenchStore = CodeWorkbenchState & CodeWorkbenchActions;

let _seq = 0;
let _paneSeq = 0;
let _axisSeq = 0;
const newPaneId = () => `p${++_paneSeq}`;

// ── 窗格编辑器焦点注册表（对标 Zed item_focus_handle：导航后把 DOM 焦点移交给目标编辑器）──
// 各 WorkbenchEditorPane 挂载时按 paneId 注册自己的聚焦函数；导航动作切到目标窗格后调用它，
// 使目标编辑器立即获得键盘焦点、可直接键入（Zed activate_pane_in_direction 末尾即 focus 编辑器）。
// 仅当当前焦点已在某 Monaco 编辑器内时才移交，避免从搜索框 / 命令面板等输入框抢走焦点（零回归）。
const paneFocusRegistry = new Map<string, () => void>();

export function registerPaneFocus(paneId: string, fn: () => void) {
  paneFocusRegistry.set(paneId, fn);
}
export function unregisterPaneFocus(paneId: string) {
  paneFocusRegistry.delete(paneId);
}
function focusPaneEditor(paneId: string) {
  if (typeof document === 'undefined') return;
  const fn = paneFocusRegistry.get(paneId);
  if (fn) {
    try {
      fn();
    } catch {
      /* 编辑器尚未就绪时静默降级 */
    }
  }
}
function isEditorFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  return !!el && !!el.closest?.('.monaco-editor');
}

const newAxisId = () => `ax${++_axisSeq}`;

// —— 窗格布局持久化（对标 Zed workspace layout 记忆：拆分布局跨会话保留）——
// 仅持久化「结构 + 每窗格打开了哪些文件(fileId) + 激活窗格」，文件内容按需懒加载；
// 按 activeAnalysisId 分桶，避免不同项目互相串布局。
interface PersistedPaneLayout {
  v: 1;
  tree: PaneNode;
  activePaneId: string;
  panes: Record<string, { fileIds: string[]; activeFileId: string | null }>;
}

const layoutKey = (aid: string | null) => `workbench.layout.${aid ?? 'default'}`;

/** 由当前 store 状态生成可持久化快照（不含文件内容，文件内容按需懒加载） */
function snapshotLayout(s: CodeWorkbenchState): PersistedPaneLayout {
  const panes: PersistedPaneLayout['panes'] = {};
  for (const [id, p] of Object.entries(s.panes)) {
    panes[id] = {
      fileIds: p.tabs.map((t) => t.fileId),
      activeFileId: p.activeFileId,
    };
  }
  return { v: 1, tree: s.paneTree, activePaneId: s.activePaneId, panes };
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;
/** 防抖持久化：结构/内容变化后 400ms 落盘一次，避免拖拽过程高频写 */
function schedulePersist(get: () => CodeWorkbenchStore) {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try {
      const aid = useProjectStore.getState().activeAnalysisId;
      const snap = snapshotLayout(get());
      localStorage.setItem(layoutKey(aid), JSON.stringify(snap));
    } catch {
      /* localStorage 不可用时静默降级，不影响编辑器本身 */
    }
  }, 400);
}

/** 异步懒加载某标签内容（复用 openTab 的读盘口径 + seq 守卫，跨窗格查找对应标签） */
function loadTabContent(fileId: string, seq: number, set: (fn: (s: CodeWorkbenchState) => void) => void) {
  void (async () => {
    // 图片走字节预览，跳过文本读取（read_source_file 对二进制会返回 skippedReason，徒增开销）
    const tab = (() => {
      for (const p of Object.values(useCodeWorkbenchStore.getState().panes)) {
        const t = p.tabs.find((x) => x.fileId === fileId);
        if (t) return t;
      }
      return undefined;
    })();
    if (tab?.kind === 'image') {
      set((s) => {
        for (const p of Object.values(s.panes)) {
          const t = p.tabs.find((x) => x.fileId === fileId);
          if (t && t.seq === seq) {
            t.loading = false;
            t.content = null;
            t.error = null;
          }
        }
      });
      return;
    }
    try {
      const content = await projectScanApi.readSourceFile(fileId);
      set((s) => {
        for (const p of Object.values(s.panes)) {
          const t = p.tabs.find((x) => x.fileId === fileId);
          if (t && t.seq === seq) {
            t.content = content;
            t.loading = false;
            t.error = null;
          }
        }
      });
    } catch (e) {
      set((s) => {
        for (const p of Object.values(s.panes)) {
          const t = p.tabs.find((x) => x.fileId === fileId);
          if (t && t.seq === seq) {
            t.loading = false;
            t.error = e instanceof Error ? e.message : String(e);
          }
        }
      });
    }
  })();
}

/** 把持久化 tree 中引用了已丢弃窗格(id 不在 panes)的节点递归剔除/坍塌 */
function normalizeTreeToPanes(node: PaneNode, panes: Record<string, WorkbenchPane>): PaneNode | null {
  if (node.kind === 'pane') {
    return panes[node.id] ? node : null;
  }
  const children = node.children.map((c) => normalizeTreeToPanes(c, panes)).filter((c): c is PaneNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, flexes: children.map(() => 1) };
}

/** 把持久化布局回填进 draft（仅当存在且至少含一个可解析的文件）。
 *  文件内容置 loading 并异步懒加载；与 openTab 同口径。返回是否成功恢复。 */
function restoreInto(
  s: CodeWorkbenchState,
  _get: () => CodeWorkbenchStore,
  set: (fn: (s: CodeWorkbenchState) => void) => void,
): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(layoutKey(useProjectStore.getState().activeAnalysisId));
  } catch {
    return false;
  }
  if (!raw) return false;
  let parsed: PersistedPaneLayout;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || parsed.v !== 1 || !parsed.tree || !parsed.panes) return false;

  const files = useProjectStore.getState().files;
  const fileMap = new Map(files.map((f) => [f.id, f]));

  // 重建 panes：仅保留存在对应扫描文件的 tab；窗格内文件全部失效 → 丢弃该窗格
  const newPanes: Record<string, WorkbenchPane> = {};
  let validCount = 0;
  for (const [pid, info] of Object.entries(parsed.panes)) {
    const tabs: WorkbenchTab[] = [];
    for (const fid of info.fileIds) {
      const f = fileMap.get(fid);
      if (!f) continue;
      _seq += 1;
      const seq = _seq;
      tabs.push({
        fileId: f.id,
        relPath: f.relPath,
        name: f.name,
        language: f.language,
        kind: detectTabKind(f.relPath, f.name),
        loading: true,
        error: null,
        content: null,
        focusLine: null,
        focusColumn: null,
        reason: null,
        marks: [],
        seq,
        pinned: false,
        readOnly: false,
      });
      loadTabContent(f.id, seq, set);
    }
    if (tabs.length === 0) continue; // 窗格内文件全部失效 → 丢弃该窗格
    const activeFileId =
      info.activeFileId && tabs.some((t) => t.fileId === info.activeFileId) ? info.activeFileId : tabs[0].fileId;
    newPanes[pid] = { id: pid, tabs, activeFileId };
    validCount += 1;
  }
  if (validCount === 0) return false; // 全部失效 → 不恢复，走默认单窗格

  // 修正 paneTree：剔除已丢弃窗格的引用（与 removePaneFromTree 同口径）
  let tree = normalizeTreeToPanes(parsed.tree, newPanes);
  if (!tree) tree = { kind: 'pane', id: Object.keys(newPanes)[0] };
  else if (tree.kind === 'axis' && tree.children.length === 1) tree = tree.children[0];

  s.panes = newPanes;
  s.paneTree = tree;
  s.activePaneId = newPanes[parsed.activePaneId] ? parsed.activePaneId : firstPaneId(tree);

  // 提升序号计数器，避免与持久化 id 碰撞（pN / axN）
  let maxP = 0;
  let maxAx = 0;
  for (const id of Object.keys(newPanes)) {
    const m = id.match(/^p(\d+)$/);
    if (m) maxP = Math.max(maxP, Number(m[1]));
  }
  const walk = (n: PaneNode) => {
    if (n.kind === 'pane') return;
    const m = n.id.match(/^ax(\d+)$/);
    if (m) maxAx = Math.max(maxAx, Number(m[1]));
    n.children.forEach(walk);
  };
  walk(tree);
  _paneSeq = Math.max(_paneSeq, maxP);
  _axisSeq = Math.max(_axisSeq, maxAx);
  return true;
}

/** 取当前激活窗格（不存在时回退到首个，保证永不空引用） */
function activePaneOf(s: CodeWorkbenchState): WorkbenchPane {
  return s.panes[s.activePaneId] ?? s.panes[firstPaneId(s.paneTree)];
}

// —— 递归窗格树纯函数工具（对标 Zed `PaneGroup` / `PaneAxis`）——

/** 方向 → 轴朝向：left/right 并排(row)，up/down 堆叠(col) */
function dirToAxis(d: SplitDirection): PaneOrientation {
  return d === 'left' || d === 'right' ? 'row' : 'col';
}
/** 方向是否「递增侧」：right/down 插到源之后，left/up 插到源之前 */
function isIncreasing(d: SplitDirection): boolean {
  return d === 'right' || d === 'down';
}
/** 收集树中所有叶子窗格 id（顺序即视觉先后） */
export function collectPaneIds(node: PaneNode): string[] {
  return node.kind === 'pane' ? [node.id] : node.children.flatMap(collectPaneIds);
}
/** 树中窗格总数 */
export function countPanes(node: PaneNode): number {
  return node.kind === 'pane' ? 1 : node.children.reduce((n, c) => n + countPanes(c), 0);
}
/** 树中首个窗格 id（根若为轴则取其首个叶子） */
export function firstPaneId(node: PaneNode): string {
  return node.kind === 'pane' ? node.id : firstPaneId(node.children[0]);
}

/** 按方向几何查找相邻窗格（对标 Zed `PaneGroup::find_pane_in_direction`）：
 *  取激活窗格包围盒，朝方向外扩 `PANE_NAV_HITBOX`(4px) 取一点，命中该点的其它窗格即目标。
 *  依赖每个窗格根节点携带 `data-pane-id` 属性（WorkbenchEditorPane 已挂载），用真实屏幕几何判定，
 *  因此可正确处理任意层级的递归窗格树（嵌套 axis 的相邻关系无法从树结构静态推断，必须看渲染几何）。 */
const PANE_NAV_HITBOX = 4;
function findPaneInDirection(activeId: string, dir: SplitDirection): string | null {
  if (typeof document === 'undefined') return null;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-id]'));
  const rects = new Map<string, DOMRect>();
  for (const n of nodes) {
    const id = n.getAttribute('data-pane-id');
    if (id) rects.set(id, n.getBoundingClientRect());
  }
  const active = rects.get(activeId);
  if (!active) return null;
  const cx = active.left + active.width / 2;
  const cy = active.top + active.height / 2;
  let tx = cx;
  let ty = cy;
  switch (dir) {
    case 'left':
      tx = active.left - PANE_NAV_HITBOX;
      break;
    case 'right':
      tx = active.right + PANE_NAV_HITBOX;
      break;
    case 'up':
      ty = active.top - PANE_NAV_HITBOX;
      break;
    case 'down':
      ty = active.bottom + PANE_NAV_HITBOX;
      break;
  }
  // 取包围盒包含该点、且中心最近的窗格（多窗格重叠时选最贴近的，对标 Zed pane_at_pixel_position）
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [id, r] of rects) {
    if (id === activeId) continue;
    if (tx >= r.left && tx <= r.right && ty >= r.top && ty <= r.bottom) {
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
  }
  return best;
}

/** 递归交换树中两个窗格节点的 id（swapPanesInDirection 用；panes 字典按 id 存内容，故交换节点 id 即交换内容所在位置） */
function swapPaneIdsInTree(root: PaneNode, a: string, b: string): PaneNode {
  if (root.kind === 'pane') {
    if (root.id === a) return { ...root, id: b };
    if (root.id === b) return { ...root, id: a };
    return root;
  }
  return {
    ...root,
    children: root.children.map((c) => swapPaneIdsInTree(c, a, b)),
  };
}

/** 将 sourcePaneId 按方向拆分出新窗格 newPane（递归，对标 Zed `PaneAxis::split`）。
 *  - 若源窗格所在父轴朝向与方向一致 → 作为兄弟插入（该轴 flex 复位均分，对标 insert_pane 重置）；
 *  - 否则 → 把源窗格就地包进一个垂直方向的新 axis 子组（对标 wrap）。 */
export function addPaneToTree(root: PaneNode, sourcePaneId: string, newPane: PaneNode, dir: SplitDirection): PaneNode {
  const axis = dirToAxis(dir);
  const inc = isIncreasing(dir);
  // 根即单个窗格：直接包成 axis
  if (root.kind === 'pane') {
    if (root.id === sourcePaneId) {
      return { kind: 'axis', id: newAxisId(), axis, children: [root, newPane], flexes: [1, 1] };
    }
    return root;
  }
  const rec = (node: PaneNode): PaneNode => {
    if (node.kind === 'pane') return node;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.kind === 'pane' && child.id === sourcePaneId) {
        if (node.axis === axis) {
          // 同朝向：插为兄弟，flex 复位均分（与 Zed insert_pane 一致）
          const insertIdx = inc ? i + 1 : i;
          const newChildren = [...node.children];
          newChildren.splice(insertIdx, 0, newPane);
          return { ...node, children: newChildren, flexes: newChildren.map(() => 1) };
        }
        // 异朝向：源窗格就地包进新 axis 子组，父轴 flex 不变
        const wrapped: PaneNode = {
          kind: 'axis',
          id: newAxisId(),
          axis,
          children: [child, newPane],
          flexes: [1, 1],
        };
        const newChildren = [...node.children];
        newChildren[i] = wrapped;
        return { ...node, children: newChildren };
      } else if (child.kind === 'axis') {
        const updated = rec(child);
        if (updated !== child) {
          const newChildren = [...node.children];
          newChildren[i] = updated;
          return { ...node, children: newChildren };
        }
      }
    }
    return node;
  };
  return rec(root);
}

/** 从树中删除某窗格（递归，对标 Zed `PaneAxis::remove`）。
 *  - 某 axis 删除成员后若仅剩 1 个 → 坍塌为那个成员（上提到父轴）；
 *  - 发生变化的 axis 其 flex 复位均分（与 Zed 删除后重置一致）。
 *  仅在确有删除/坍塌发生时改动 flex，避免误清用户自定义尺寸。 */
export function removePaneFromTree(root: PaneNode, paneId: string): PaneNode {
  if (root.kind === 'pane') return root; // 根窗格永不被此路径删除
  let changed = false;
  const newChildren: PaneNode[] = [];
  for (const child of root.children) {
    if (child.kind === 'pane' && child.id === paneId) {
      changed = true;
      continue;
    }
    if (child.kind === 'axis') {
      const updated = removePaneFromTree(child, paneId);
      if (updated !== child) changed = true;
      // 单子轴坍塌：用其唯一成员替换该轴
      if (updated.kind === 'axis' && updated.children.length === 1) {
        newChildren.push(updated.children[0]);
      } else {
        newChildren.push(updated);
      }
    } else {
      newChildren.push(child);
    }
  }
  if (!changed) return root; // 本子树无删除：保留原 flex
  let result: PaneNode = { ...root, children: newChildren, flexes: newChildren.map(() => 1) };
  // 根轴若仅剩 1 个成员，坍塌为那个成员（对标 Zed 根 single pane）
  if (result.kind === 'axis' && result.children.length === 1) {
    result = result.children[0];
  }
  return result;
}

/** 把根轴（或任意轴）调整 flex：仅替换目标 axis 的 flexes，其余结构不变 */
function updateAxisFlexes(node: PaneNode, axisId: string, flexes: number[]): PaneNode {
  if (node.kind === 'pane') return node;
  if (node.id === axisId) return { ...node, flexes };
  const children = node.children.map((c) => (c.kind === 'axis' ? updateAxisFlexes(c, axisId, flexes) : c));
  return { ...node, children };
}

/** 复位全部 axis 的 flex 为均分（双击分隔条） */
function resetAllFlexes(node: PaneNode): PaneNode {
  if (node.kind === 'pane') return node;
  return {
    ...node,
    flexes: node.children.map(() => 1),
    children: node.children.map(resetAllFlexes),
  };
}

export const useCodeWorkbenchStore = create<CodeWorkbenchStore>()(
  immer((set, get) => ({
    open: false,
    panes: { p0: { id: 'p0', tabs: [], activeFileId: null } },
    paneTree: { kind: 'pane', id: 'p0' },
    activePaneId: 'p0',
    draggingTab: null,
    draggingFile: null,
    diskChanged: new Set<string>(),
    syncScroll: false,
    bookmarks: {},

    openTab: (fileId, relPath, name, language, line = null, reason = null, marks = [], focusColumn = null) => {
      // 工作台从关闭态重新打开时，先恢复上次持久化的窗格布局（含各窗格已打开文件），
      // 使精心排布的 multi-pane 跨会话保留（对标 Zed workspace layout 记忆）。
      set((s) => {
        if (!s.open) restoreInto(s, get, set);
      });
      _seq += 1;
      const seq = _seq;
      const pid = get().activePaneId;
      const pane = get().panes[pid];
      if (!pane) return;
      const kind = detectTabKind(relPath, name);
      const existing = pane.tabs.find((t) => t.fileId === fileId);

      // 已打开且内容已加载：仅切换到该 tab 并更新焦点行（不重新读盘、不闪白）
      if (existing && existing.content) {
        set((s) => {
          const p = activePaneOf(s);
          const t = p.tabs.find((x) => x.fileId === fileId)!;
          t.focusLine = line;
          t.focusColumn = focusColumn;
          t.reason = reason;
          t.kind = kind;
          if (marks.length > 0) t.marks = marks;
          t.seq = seq;
          p.activeFileId = fileId;
          s.open = true;
        });
        return;
      }

      set((s) => {
        const p = activePaneOf(s);
        const e = p.tabs.find((x) => x.fileId === fileId);
        if (e) {
          e.loading = true;
          e.error = null;
          e.focusLine = line;
          e.focusColumn = focusColumn;
          e.reason = reason;
          if (marks.length > 0) e.marks = marks;
          e.seq = seq;
        } else {
          p.tabs.push({
            fileId,
            relPath,
            name,
            language,
            kind,
            loading: true,
            error: null,
            content: null,
            focusLine: line,
            focusColumn,
            reason,
            marks,
            seq,
            pinned: false,
            readOnly: false,
          });
        }
        p.activeFileId = fileId;
        s.open = true;
      });

      if (kind === 'image') {
        // 图片不读文本：字节由预览组件按需读取，这里仅标记已加载（避免对二进制调用 read_source_file 徒增开销）
        set((s) => {
          const p = s.panes[s.activePaneId];
          const t = p?.tabs.find((x) => x.fileId === fileId);
          if (t && t.seq === seq) {
            t.loading = false;
            t.content = null;
            t.error = null;
          }
        });
        schedulePersist(get);
        return;
      }
      void (async () => {
        try {
          const content = await projectScanApi.readSourceFile(fileId);
          const cur = get().panes[get().activePaneId]?.tabs.find((t) => t.fileId === fileId);
          if (!cur || cur.seq !== seq) return;
          set((s) => {
            const p = s.panes[s.activePaneId];
            const t = p?.tabs.find((x) => x.fileId === fileId);
            if (t) {
              t.content = content;
              t.loading = false;
              t.error = null;
            }
          });
        } catch (e) {
          const cur = get().panes[get().activePaneId]?.tabs.find((t) => t.fileId === fileId);
          if (!cur || cur.seq !== seq) return;
          set((s) => {
            const p = s.panes[s.activePaneId];
            const t = p?.tabs.find((x) => x.fileId === fileId);
            if (t) {
              t.loading = false;
              t.error = e instanceof Error ? e.message : String(e);
            }
          });
        }
      })();
      schedulePersist(get);
    },

    setActive: (fileId) => {
      set((s) => {
        activePaneOf(s).activeFileId = fileId;
      });
      schedulePersist(get);
    },

    activateNextTab: () => {
      set((s) => {
        const p = activePaneOf(s);
        if (p.tabs.length < 2) return;
        const idx = p.tabs.findIndex((t) => t.fileId === p.activeFileId);
        const next = idx < 0 ? 0 : (idx + 1) % p.tabs.length;
        p.activeFileId = p.tabs[next].fileId;
      });
      schedulePersist(get);
    },

    activatePrevTab: () => {
      set((s) => {
        const p = activePaneOf(s);
        if (p.tabs.length < 2) return;
        const idx = p.tabs.findIndex((t) => t.fileId === p.activeFileId);
        const prev = idx < 0 ? 0 : (idx - 1 + p.tabs.length) % p.tabs.length;
        p.activeFileId = p.tabs[prev].fileId;
      });
      schedulePersist(get);
    },

    activateTabByIndex: (idx) => {
      set((s) => {
        const p = activePaneOf(s);
        if (idx < 0 || idx >= p.tabs.length) return;
        p.activeFileId = p.tabs[idx].fileId;
      });
      schedulePersist(get);
    },

    activateBuffer: (fileId) => {
      set((s) => {
        for (const pid of Object.keys(s.panes)) {
          const p = s.panes[pid];
          if (p.tabs.some((t) => t.fileId === fileId)) {
            s.activePaneId = pid;
            p.activeFileId = fileId;
            break;
          }
        }
      });
      schedulePersist(get);
    },

    closeTab: (fileId) => {
      set((s) => {
        const p = activePaneOf(s);
        const idx = p.tabs.findIndex((t) => t.fileId === fileId);
        if (idx < 0) return;
        p.tabs.splice(idx, 1);
        if (p.activeFileId === fileId) {
          p.activeFileId = p.tabs.length > 0 ? p.tabs[Math.max(0, idx - 1)].fileId : null;
        }
        if (p.tabs.length === 0 && countPanes(s.paneTree) > 1) {
          // 窗格已空且非唯一：自动收起该窗格，避免留一个空编辑器（对标 Zed 关空 pane）
          const emptyId = p.id;
          delete s.panes[emptyId];
          let tree = removePaneFromTree(s.paneTree, emptyId);
          if (tree.kind === 'axis' && tree.children.length === 1) tree = tree.children[0];
          s.paneTree = tree;
          if (s.activePaneId === emptyId) {
            s.activePaneId = firstPaneId(tree);
          }
        }
      });
      schedulePersist(get);
    },

    togglePin: (fileId) =>
      set((s) => {
        const p = activePaneOf(s);
        const t = p.tabs.find((x) => x.fileId === fileId);
        if (!t) return;
        t.pinned = !t.pinned;
        const pinned = p.tabs.filter((x) => x.pinned);
        const unpinned = p.tabs.filter((x) => !x.pinned);
        p.tabs = [...pinned, ...unpinned];
      }),

    toggleReadOnly: (fileId) =>
      set((s) => {
        const p = activePaneOf(s);
        const t = p.tabs.find((x) => x.fileId === fileId);
        if (!t) return;
        t.readOnly = !t.readOnly;
      }),

    closeOthers: (fileId) =>
      set((s) => {
        const p = activePaneOf(s);
        p.tabs = p.tabs.filter((t) => t.fileId === fileId || t.pinned);
        p.activeFileId = fileId;
        if (p.tabs.length === 0) s.open = false;
      }),

    closeLeft: (fileId) =>
      set((s) => {
        const p = activePaneOf(s);
        const targetIdx = p.tabs.findIndex((t) => t.fileId === fileId);
        if (targetIdx < 0) return;
        p.tabs = p.tabs.filter((t, i) => i >= targetIdx || t.pinned);
        if (!p.tabs.some((t) => t.fileId === p.activeFileId)) {
          p.activeFileId = fileId;
        }
        if (p.tabs.length === 0) s.open = false;
      }),

    closeRight: (fileId) =>
      set((s) => {
        const p = activePaneOf(s);
        const targetIdx = p.tabs.findIndex((t) => t.fileId === fileId);
        if (targetIdx < 0) return;
        p.tabs = p.tabs.filter((t, i) => i <= targetIdx || t.pinned);
        if (!p.tabs.some((t) => t.fileId === p.activeFileId)) {
          p.activeFileId = fileId;
        }
        if (p.tabs.length === 0) s.open = false;
      }),

    closeAll: () =>
      set((s) => {
        const p = activePaneOf(s);
        p.tabs = p.tabs.filter((t) => t.pinned);
        if (!p.tabs.some((t) => t.fileId === p.activeFileId)) {
          p.activeFileId = p.tabs.length > 0 ? p.tabs[0].fileId : null;
        }
        if (p.tabs.length === 0) s.open = false;
      }),

    reorderTab: (fromId, toIndex) => {
      set((s) => {
        const p = activePaneOf(s);
        const fromIdx = p.tabs.findIndex((t) => t.fileId === fromId);
        if (fromIdx < 0) return;
        const len = p.tabs.length;
        if (len <= 1) return;
        const to = Math.max(0, Math.min(len, toIndex));
        const pinnedAfter = p.tabs.filter((t) => t.pinned && t.fileId !== fromId);
        const unpinnedAfter = p.tabs.filter((t) => !t.pinned && t.fileId !== fromId);

        let target: 'pinned' | 'unpinned';
        let groupIndex: number;
        if (to <= pinnedAfter.length) {
          target = 'pinned';
          groupIndex = Math.max(0, Math.min(pinnedAfter.length, to));
        } else {
          target = 'unpinned';
          groupIndex = Math.max(0, Math.min(unpinnedAfter.length, to - pinnedAfter.length));
        }

        const moved = p.tabs[fromIdx];
        moved.pinned = target === 'pinned';
        if (target === 'pinned') pinnedAfter.splice(groupIndex, 0, moved);
        else unpinnedAfter.splice(groupIndex, 0, moved);

        p.tabs = [...pinnedAfter, ...unpinnedAfter];
        p.activeFileId = fromId;
      });
      schedulePersist(get);
    },

    jumpTo: (line, reason = null) =>
      set((s) => {
        const p = activePaneOf(s);
        const t = p.tabs.find((x) => x.fileId === p.activeFileId);
        if (t) {
          t.focusLine = line;
          t.reason = reason;
        }
      }),

    setContent: (fileId, text) =>
      set((s) => {
        const p = activePaneOf(s);
        const t = p.tabs.find((x) => x.fileId === fileId);
        if (!t || !t.content) return;
        const lines = text.split('\n');
        t.content = { ...t.content, lines, totalLines: lines.length };
      }),

    reloadTab: async (fileId) => {
      const pid = get().activePaneId;
      const tab = get().panes[pid]?.tabs.find((t) => t.fileId === fileId);
      if (!tab) return;
      try {
        const content = await projectScanApi.readSourceFile(fileId);
        set((s) => {
          const p = s.panes[s.activePaneId];
          const t = p?.tabs.find((x) => x.fileId === fileId);
          if (t) {
            t.content = content;
            t.error = null;
            t.loading = false;
          }
        });
      } catch (e) {
        set((s) => {
          const p = s.panes[s.activePaneId];
          const t = p?.tabs.find((x) => x.fileId === fileId);
          if (t) t.error = e instanceof Error ? e.message : String(e);
        });
      }
    },

    markDiskChanged: (fileId) =>
      set((s) => {
        s.diskChanged.add(fileId);
      }),

    clearDiskChanged: (fileId) =>
      set((s) => {
        s.diskChanged.delete(fileId);
      }),

    openDiffTab: (fileId, spec) =>
      set((s) => {
        // 跨窗格搜索目标 fileId（右键的非激活标签也能正确挂载对比视图），并激活其所在窗格
        for (const p of Object.values(s.panes)) {
          const t = p.tabs.find((x) => x.fileId === fileId);
          if (t) {
            t.diff = spec;
            s.activePaneId = p.id;
            p.activeFileId = fileId;
            break;
          }
        }
      }),

    close: () =>
      set((s) => {
        s.open = false;
      }),

    // —— 多窗格动作 ——
    splitPane: (direction, mode) => {
      set((s) => {
        const src = activePaneOf(s);
        const id = newPaneId();
        let newTabs: WorkbenchTab[];
        let newActive: string | null;
        if (mode === 'clone') {
          // ClonePane：复制当前窗格的全部标签（深拷贝，保证两 pane 独立）
          newTabs = JSON.parse(JSON.stringify(src.tabs));
          newActive = src.activeFileId;
        } else if (mode === 'empty') {
          newTabs = [];
          newActive = null;
        } else {
          // MovePane：把当前激活标签移出到新窗格；源窗格若因此变空则就地收起
          const t = src.tabs.find((x) => x.fileId === src.activeFileId) ?? null;
          newTabs = t ? [t] : [];
          newActive = t?.fileId ?? null;
          src.tabs = src.tabs.filter((x) => x.fileId !== src.activeFileId);
          src.activeFileId = src.tabs.length > 0 ? src.tabs[src.tabs.length - 1].fileId : null;
        }
        s.panes[id] = { id, tabs: newTabs, activeFileId: newActive };
        // 递归拆分：相对当前激活窗格按方向生长（支持嵌套，对标 Zed PaneGroup::split）
        s.paneTree = addPaneToTree(s.paneTree, src.id, { kind: 'pane', id }, direction);
        s.activePaneId = id;
      });
      schedulePersist(get);
    },

    closePane: (paneId) => {
      set((s) => {
        if (countPanes(s.paneTree) <= 1) return; // 至少保留一个窗格
        delete s.panes[paneId];
        let tree = removePaneFromTree(s.paneTree, paneId);
        if (tree.kind === 'axis' && tree.children.length === 1) tree = tree.children[0];
        s.paneTree = tree;
        if (s.activePaneId === paneId) {
          s.activePaneId = firstPaneId(tree);
        }
      });
      schedulePersist(get);
    },

    setActivePane: (paneId) => {
      set((s) => {
        if (s.panes[paneId]) s.activePaneId = paneId;
      });
      schedulePersist(get);
    },

    moveTabToPane: (fileId, toPaneId, toIndex) => {
      set((s) => {
        // 来源窗格优先取拖拽起点记录的 paneId（跨窗格落点时 active 可能已切走），兜底回退激活窗格
        const from = s.panes[s.draggingTab?.paneId ?? ''] ?? activePaneOf(s);
        const to = s.panes[toPaneId];
        if (!to || from.id === to.id) return;
        const idx = from.tabs.findIndex((t) => t.fileId === fileId);
        if (idx < 0) return;
        const [t] = from.tabs.splice(idx, 1);
        if (typeof toIndex === 'number') {
          // 精确插入（对标 Zed handle_tab_drop 的 ix）：flat 顺序 pinned 在前，与 reorderTab 同口径，
          // 落入 pinned 区自动钉住，落入 unpinned 区取消钉住。
          const pinned = to.tabs.filter((x) => x.pinned);
          const unpinned = to.tabs.filter((x) => !x.pinned);
          const clamped = Math.max(0, Math.min(to.tabs.length, toIndex));
          if (clamped <= pinned.length) {
            t.pinned = true;
            pinned.splice(clamped, 0, t);
          } else {
            t.pinned = false;
            unpinned.splice(clamped - pinned.length, 0, t);
          }
          to.tabs = [...pinned, ...unpinned];
        } else {
          to.tabs.push(t);
        }
        to.activeFileId = fileId;
        if (from.tabs.length === 0) {
          delete s.panes[from.id];
          let tree = removePaneFromTree(s.paneTree, from.id);
          if (tree.kind === 'axis' && tree.children.length === 1) tree = tree.children[0];
          s.paneTree = tree;
          if (s.activePaneId === from.id) {
            s.activePaneId = firstPaneId(tree);
          }
        } else if (from.activeFileId === fileId) {
          from.activeFileId = from.tabs[Math.max(0, idx - 1)].fileId;
        }
      });
      schedulePersist(get);
    },

    setDraggingTab: (info) =>
      set((s) => {
        s.draggingTab = info;
      }),

    splitPaneWithTab: (fromPaneId, fileId, targetPaneId, direction) => {
      set((s) => {
        const from = s.panes[fromPaneId];
        const target = s.panes[targetPaneId];
        if (!from || !target) return;
        const idx = from.tabs.findIndex((t) => t.fileId === fileId);
        if (idx < 0) return;
        const [tab] = from.tabs.splice(idx, 1);
        const id = newPaneId();
        s.panes[id] = { id, tabs: [tab], activeFileId: fileId };
        // 递归拆分：相对目标窗格按方向生长新窗格（拖标签到边缘→拆分，对标 Zed drag_split_direction）
        s.paneTree = addPaneToTree(s.paneTree, targetPaneId, { kind: 'pane', id }, direction);
        s.activePaneId = id;
        // 来源窗格因移出而变空：就地收起（与 closeTab/ moveTabToPane 一致）
        if (from.tabs.length === 0) {
          delete s.panes[fromPaneId];
          let tree = removePaneFromTree(s.paneTree, fromPaneId);
          if (tree.kind === 'axis' && tree.children.length === 1) tree = tree.children[0];
          s.paneTree = tree;
          if (s.activePaneId === fromPaneId) s.activePaneId = id;
        } else if (from.activeFileId === fileId) {
          from.activeFileId = from.tabs[Math.max(0, idx - 1)].fileId;
        }
        s.draggingTab = null;
      });
      schedulePersist(get);
    },

    setDraggingFile: (info) =>
      set((s) => {
        s.draggingFile = info;
      }),

    splitPaneWithFile: (targetPaneId, fileId, direction) => {
      set((s) => {
        const target = s.panes[targetPaneId];
        if (!target) return;
        // 同源窗格里已开该文件：直接激活，不重复开窗（对标 Zed 拖到已含此文件的窗格）
        const existing = target.tabs.find((t) => t.fileId === fileId);
        if (existing) {
          target.activeFileId = fileId;
          s.activePaneId = targetPaneId;
          s.draggingFile = null;
          return;
        }
        // 反查文件元数据，构造完整标签（与 openTab 同口径：内容置 loading 异步懒加载）
        const f = useProjectStore.getState().files.find((x) => x.id === fileId);
        if (!f) {
          s.draggingFile = null;
          return;
        }
        const tab: WorkbenchTab = {
          fileId: f.id,
          relPath: f.relPath,
          name: f.name,
          language: f.language,
          kind: detectTabKind(f.relPath, f.name),
          loading: true,
          error: null,
          content: null,
          focusLine: null,
          focusColumn: null,
          reason: null,
          marks: [],
          seq: 0,
          pinned: false,
          readOnly: false,
        };
        const id = newPaneId();
        s.panes[id] = { id, tabs: [tab], activeFileId: fileId };
        // 递归拆分：相对目标窗格按方向生长新窗格（与 splitPaneWithTab 同一棵树、同一生长规则）
        s.paneTree = addPaneToTree(s.paneTree, targetPaneId, { kind: 'pane', id }, direction);
        s.activePaneId = id;
        s.draggingFile = null;
        // 异步懒加载内容（与 openTab 同口径；seq 守卫丢弃过期响应）
        const seq = ++_seq;
        loadTabContent(f.id, seq, set as (fn: (s: CodeWorkbenchState) => void) => void);
      });
      schedulePersist(get);
    },
    setAxisFlexes: (axisId: string, flexes: number[]) => {
      set((s) => {
        s.paneTree = updateAxisFlexes(s.paneTree, axisId, flexes);
      });
      schedulePersist(get);
    },

    resetPaneSizes: () => {
      set((s) => {
        s.paneTree = resetAllFlexes(s.paneTree);
      });
      schedulePersist(get);
    },

    resetLayout: () => {
      // 清掉持久化布局 + 复位为单窗格空编辑器（对标 Zed 重置工作区布局）
      try {
        localStorage.removeItem(layoutKey(useProjectStore.getState().activeAnalysisId));
      } catch {
        /* localStorage 不可用时静默降级 */
      }
      _paneSeq = 0;
      _axisSeq = 0;
      _seq += 1;
      set((s) => {
        s.panes = { p0: { id: 'p0', tabs: [], activeFileId: null } };
        s.paneTree = { kind: 'pane', id: 'p0' };
        s.activePaneId = 'p0';
        s.draggingTab = null;
        s.diskChanged = new Set<string>();
      });
    },

    toggleSyncScroll: () =>
      set((s) => {
        s.syncScroll = !s.syncScroll;
      }),

    activatePaneInDirection: (direction) => {
      const activeId = get().activePaneId;
      const target = findPaneInDirection(activeId, direction);
      if (target && get().panes[target]) {
        set((s) => {
          s.activePaneId = target;
        });
        schedulePersist(get);
        // 导航不仅切激活窗格，还要让目标编辑器立即可键入（对标 Zed activate_pane_in_direction 末尾 focus 编辑器）
        if (isEditorFocused()) focusPaneEditor(target);
      }
    },

    activateNextPane: () => {
      set((s) => {
        const ids = collectPaneIds(s.paneTree);
        if (ids.length <= 1) return;
        const i = ids.indexOf(s.activePaneId);
        s.activePaneId = ids[(i + 1) % ids.length];
      });
      schedulePersist(get);
      if (isEditorFocused()) focusPaneEditor(get().activePaneId);
    },

    activatePrevPane: () => {
      set((s) => {
        const ids = collectPaneIds(s.paneTree);
        if (ids.length <= 1) return;
        const i = ids.indexOf(s.activePaneId);
        s.activePaneId = ids[(i - 1 + ids.length) % ids.length];
      });
      schedulePersist(get);
      if (isEditorFocused()) focusPaneEditor(get().activePaneId);
    },

    swapPanesInDirection: (direction) => {
      const activeId = get().activePaneId;
      const target = findPaneInDirection(activeId, direction);
      if (target && get().panes[target]) {
        set((s) => {
          s.paneTree = swapPaneIdsInTree(s.paneTree, activeId, target);
          // 交换后焦点停留在「原屏幕位置」（即现在承载 target 内容的节点），符合 Zed 交换位置、焦点不随内容跑的直觉
          s.activePaneId = target;
        });
        schedulePersist(get);
        // 交换后把焦点移交给停留在原屏幕位置的编辑器，使其立即可键入
        if (isEditorFocused()) focusPaneEditor(target);
      }
    },

    // —— 编辑器书签（对标 Zed crates/editor/src/bookmarks.rs + project::bookmark_store）——
    toggleBookmark: (fileId, line) =>
      set((s) => {
        const list = s.bookmarks[fileId] ?? [];
        const idx = list.findIndex((b) => b.line === line);
        if (idx >= 0) {
          const next = list.slice();
          next.splice(idx, 1);
          if (next.length === 0) delete s.bookmarks[fileId];
          else s.bookmarks[fileId] = next;
        } else {
          s.bookmarks[fileId] = list.concat({ line }).sort((a, b) => a.line - b.line);
        }
      }),

    setBookmarkLabel: (fileId, line, label) =>
      set((s) => {
        const list = s.bookmarks[fileId];
        if (!list) return;
        const idx = list.findIndex((b) => b.line === line);
        if (idx < 0) return;
        const next = list.slice();
        next[idx] = { ...next[idx], label: label || undefined };
        s.bookmarks[fileId] = next;
      }),

    clearBookmark: (fileId, line) =>
      set((s) => {
        const list = s.bookmarks[fileId];
        if (!list) return;
        const next = list.filter((b) => b.line !== line);
        if (next.length === 0) delete s.bookmarks[fileId];
        else s.bookmarks[fileId] = next;
      }),

    bookmarksForFile: (fileId) => {
      const list = get().bookmarks[fileId];
      return list ? list.slice().sort((a, b) => a.line - b.line) : [];
    },

    gotoNextBookmark: (fileId, line) => {
      const list = get().bookmarks[fileId];
      if (!list || list.length === 0) return null;
      const sorted = list.map((b) => b.line).sort((a, b) => a - b);
      const next = sorted.find((l) => l > line);
      return { fileId, line: next ?? sorted[0] };
    },

    gotoPrevBookmark: (fileId, line) => {
      const list = get().bookmarks[fileId];
      if (!list || list.length === 0) return null;
      const sorted = list.map((b) => b.line).sort((a, b) => a - b);
      const prev = [...sorted].reverse().find((l) => l < line);
      return { fileId, line: prev ?? sorted[sorted.length - 1] };
    },

    getAllBookmarks: () => {
      const s = get();
      return computeAllBookmarks(s.panes, s.bookmarks);
    },
  })),
);

/**
 * 纯函数：从窗格 + 书签状态派生「全部书签扁平清单」（带文件元信息）。
 * 抽离自 getAllBookmarks 本体，供 store 方法与 React 组件共用。
 *
 * 关键：组件侧必须在 useMemo 中调用此函数（由稳定的 panes/bookmarks 引用派生），
 * 绝不能写 `useStore((s) => s.getAllBookmarks())` —— 后者每次 getSnapshot 都返回一个
 * 全新数组引用，触发 zustand v5 useSyncExternalStore 的无限重渲染
 * （"The result of getSnapshot should be cached" → "Maximum update depth exceeded"）。
 */
export function computeAllBookmarks(
  panes: Record<string, WorkbenchPane>,
  bookmarks: Record<string, WorkbenchBookmark[]>,
): { fileId: string; name: string; relPath: string; line: number; label?: string }[] {
  const meta = new Map<string, { name: string; relPath: string }>();
  for (const p of Object.values(panes)) {
    for (const t of p.tabs) {
      if (!meta.has(t.fileId)) meta.set(t.fileId, { name: t.name, relPath: t.relPath });
    }
  }
  const out: { fileId: string; name: string; relPath: string; line: number; label?: string }[] = [];
  for (const [fid, list] of Object.entries(bookmarks)) {
    const m = meta.get(fid);
    for (const b of list) {
      out.push({
        fileId: fid,
        name: m?.name ?? fid,
        relPath: m?.relPath ?? '',
        line: b.line,
        label: b.label,
      });
    }
  }
  out.sort((a, b) => a.fileId.localeCompare(b.fileId) || a.line - b.line);
  return out;
}

/** 便捷函数：非 React 上下文（画布事件、工具函数）中打开工作台并定位文件 */
export function openWorkbenchTab(fileId: string, line?: number | null, reason?: string | null, marks?: SourceMark[]) {
  const f = useProjectStore.getState().files.find((x) => x.id === fileId);
  if (!f) return;
  useCodeWorkbenchStore.getState().openTab(f.id, f.relPath, f.name, f.language, line, reason, marks);
}
