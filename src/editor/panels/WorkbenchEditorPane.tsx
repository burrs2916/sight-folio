/**
 * 工作台「窗格」单元（对标 Zed `Pane`）：每个窗格拥有独立的标签集合、激活标签与编辑器实例。
 *
 * 设计要点（与 Zed 一致）：
 *  - 所有标签动作（关闭/钉住/重排…）作用于「当前激活窗格」；本组件通过根节点 onMouseDown
 *    在进入交互前先把自身设为激活窗格（setActivePane），从而保证动作落到正确的 pane；
 *  - 每个窗格维护自己的 editorHandleRef，并在交互时通过 onActivateEditor 上报给外壳，
 *    供外壳右侧 AI 面板 / 内联对话 / 转到行 操作「聚焦窗格」的编辑器；
 *  - 高亮区间（复杂度热力 / 死代码 / 克隆 / 可定位符号 / 光标符号面包屑）均按本窗格激活文件
 *    从 projectStore 独立推导，保证多窗格互不干扰。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import PushPinIcon from '@mui/icons-material/PushPin';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import FolderIcon from '@mui/icons-material/Folder';
import TerminalIcon from '@mui/icons-material/Terminal';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ImageIcon from '@mui/icons-material/Image';
import DescriptionIcon from '@mui/icons-material/Description';
import { LanguageIcon } from '../../utils/languageIcon';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import { paneScrollBus } from './paneScrollSync';
import { t } from '../../i18n';
import { invoke } from '@tauri-apps/api/core';
import { readLineFromMetadata } from '../utils/sourceNavigate';
import { useProjectStore } from '../../store/projectStore';
import { useCodeWorkbenchStore, registerPaneFocus, unregisterPaneFocus } from '../../store/codeWorkbenchStore';
import { useToastStore } from '../../store/toastStore';
import { useEditorStore } from '../../store/editorStore';
import { useProblemsPanelStore } from '../../store/problemsPanelStore';
import { triggerDiagnosis } from '../../ai/triggerDiagnosis';
import { runPortrait, type PortraitKind } from '../utils/portraits';
import type { WorkbenchTab, SplitDirection, SplitMode, PaneOrientation } from '../../store/codeWorkbenchStore';
import type { ProjectFile, ProjectSymbol, SourceFileContent } from '../../services/tauri';
import { parseFileMetricMeta, projectScanApi } from '../../services/tauri';
import { ccLevel } from './CodeWorkbenchTree';
import { EditorPane } from './CodeWorkbenchEditorPane';
import { MonacoDiffEditor } from './MonacoDiffEditor';
import { WorkbenchMediaPreview, WorkbenchMarkdownPreview } from './WorkbenchPreviewPanes';
import { Breadcrumbs } from './Breadcrumbs';
import type {
  MonacoEditorHandle,
  EditorSelectionInfo,
  HeatRange,
  DeadRange,
  CloneRange,
  CursorStatus,
  EditorInfo,
  MarkerStats,
} from './MonacoCodeEditor';
import type { SourceMark } from '../../store/sourceViewerStore';
import { uiFontSize } from '../../theme/appearanceScales';

interface WorkbenchEditorPaneProps {
  paneId: string;
  /** 本窗格在 multi-pane 布局中的 flex 权重（对标 Zed PaneAxis.flexes）；缺省 1 均分 */
  paneFlex?: number;
  files: ProjectFile[];
  /** 交互时把本窗格编辑器句柄上报给外壳（共享 active editor ref） */
  onActivateEditor: (ref: MonacoEditorHandle | null) => void;
  /** 编辑器内容变更回调（外壳负责收集最新文本 + 自动保存，按激活窗格文件落盘） */
  onChangeCapture: (text: string) => void;
  onAskAi: (sel: EditorSelectionInfo) => void;
  onRequestAiOpen: () => void;
  /** 编辑器内 Ctrl/⌘+I 唤起内联对话（外壳渲染 InlineChat） */
  onOpenInline: () => void;
  splitPane: (direction: SplitDirection, mode: SplitMode) => void;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  paneAxis: PaneOrientation | null;
  activePaneId: string;
  // 标签动作（作用于激活窗格，外壳已保证本 pane 即激活）
  setActive: (fileId: string) => void;
  closeTab: (fileId: string) => void;
  togglePin: (fileId: string) => void;
  closeOthers: (fileId: string) => void;
  closeLeft: (fileId: string) => void;
  closeRight: (fileId: string) => void;
  closeAll: () => void;
  reorderTab: (fromId: string, toIndex: number) => void;
  /** 把标签从当前窗格移动到目标窗格（中心落点→移入） */
  moveTabToPane: (fileId: string, toPaneId: string, toIndex?: number) => void;
  toggleReadOnly: (fileId: string) => void;
  openTab: (
    fileId: string,
    relPath: string,
    name: string,
    language: string | null,
    line?: number | null,
    reason?: string | null,
    marks?: never[],
  ) => void;
  /** 面包屑目录段 / 文件名打开文件（外壳实现，含画布联动） */
  onOpenFile: (fileId: string) => void;
  onToggleOutline: () => void;
  /** 跨窗格拖拽落点：把 fileId 从 fromPaneId 拆分到本窗格(targetPaneId) 的指定方向新窗格 */
  splitPaneWithTab: (fromPaneId: string, fileId: string, targetPaneId: string, direction: SplitDirection) => void;
  /** 设置/清除跨窗格拖拽中的标签 */
  setDraggingTab: (info: { paneId: string; fileId: string } | null) => void;
  /** 设置/清除跨组件拖拽中的「文件树条目」（从文件树拖出时记录 fileId） */
  setDraggingFile: (info: { fileId: string } | null) => void;
  /** 跨组件拖拽落点：把文件树条目 fileId 拆分到本窗格(targetPaneId) 的指定方向新窗格 */
  splitPaneWithFile: (targetPaneId: string, fileId: string, direction: SplitDirection) => void;
  /** 在终端中打开目录（外壳实现：拉起集成终端并 cd） */
  onOpenInTerminal?: (dir: string) => void;
  /** 点击状态栏「行:列」时打开「转到行」面板（对标 Zed CursorPosition 状态栏项可点击） */
  onOpenGotoLine?: () => void;
  /** 点击状态栏书签计数时打开「查看书签」清单（对标 Zed ViewBookmarks 跨文件跳转） */
  onShowBookmarks?: () => void;
  /** 选区变化上报外壳（供右侧 AI 面板 / 内联对话维护上下文芯片） */
  onSelectionChange?: (sel: EditorSelectionInfo | null) => void;
  /** 重命名符号：右键菜单 / F2 触发，由外壳聚合引用并弹出确认（对标 Zed editor::Rename） */
  onRenameSymbol?: (info: { word: string; line: number; column: number }) => void;
  /** 跳转到定义：右键菜单 / Ctrl+单击触发；多定义时由外壳弹候选选择器（对标 Zed navigate_to_hover_links） */
  onGoToDefinition?: (info: { word: string; line: number; column: number }) => void;
  /** 在分屏打开文件（Peek 浮层 / 选择分屏动作复用，对标 Zed split 打开；dir 复用 lastSplitDirRef 会话记忆） */
  openFileInSplit?: (
    fid: string,
    relPath: string,
    name: string,
    language: string | null,
    line: number | null,
    dir?: SplitDirection,
    column?: number | null,
  ) => void;
  /** 光标行回传（供外壳大纲跟随光标高亮） */
  onCursorLineChange?: (line: number) => void;
}

const isTerminalTarget = (e: React.KeyboardEvent | KeyboardEvent): boolean =>
  !!(e.target as HTMLElement | null)?.closest?.('.xterm');

/** 把 SourceFileContent 还原为纯文本（与 WorkbenchPreviewPanes 同源口径：按行 join；二进制 skippedReason 时返回空串） */
function tabTextContent(c: SourceFileContent | null | undefined): string {
  if (!c || c.skippedReason) return '';
  return c.lines.join('\n');
}

/** 跨窗格拖拽拆分落点指示：在窗格对应边画出金色条带 + 方向标签（对标 Zed drop_target） */
function DropEdge({ dir }: { dir: SplitDirection }) {
  const isHoriz = dir === 'left' || dir === 'right';
  const edge: React.CSSProperties = isHoriz
    ? { top: 0, bottom: 0, width: '30%' }
    : { left: 0, right: 0, height: '30%' };
  if (dir === 'left') edge.left = 0;
  else if (dir === 'right') edge.right = 0;
  else if (dir === 'up') edge.top = 0;
  else edge.bottom = 0;
  const labelKey =
    dir === 'left'
      ? 'workbench.drop.splitLeft'
      : dir === 'right'
        ? 'workbench.drop.splitRight'
        : dir === 'up'
          ? 'workbench.drop.splitUp'
          : 'workbench.drop.splitDown';
  const arrow = dir === 'left' ? '←' : dir === 'right' ? '→' : dir === 'up' ? '↑' : '↓';
  return (
    <>
      <Box
        sx={{
          position: 'absolute',
          ...edge,
          bgcolor: 'rgba(239,159,39,0.22)',
          border: '2px solid #EF9F27',
          borderRadius: 1,
          boxShadow: 'inset 0 0 12px rgba(239,159,39,0.35)',
        }}
      />
      <Box
        sx={{
          position: 'relative',
          px: 1.5,
          py: 0.5,
          borderRadius: 1.5,
          bgcolor: 'rgba(15,23,42,0.85)',
          color: '#fff',
          fontSize: uiFontSize(12),
          fontWeight: 600,
          boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
          whiteSpace: 'nowrap',
        }}
      >
        {arrow} {t(labelKey)}
      </Box>
    </>
  );
}

export function WorkbenchEditorPane(props: WorkbenchEditorPaneProps) {
  const {
    paneId,
    paneFlex,
    files,
    onActivateEditor,
    onChangeCapture,
    onAskAi,
    onRequestAiOpen,
    onOpenInline,
    splitPane,
    closePane,
    setActivePane,
    paneAxis,
    activePaneId,
    splitPaneWithTab,
    setDraggingTab,
    setActive,
    closeTab,
    togglePin,
    closeOthers,
    closeLeft,
    closeRight,
    closeAll,
    reorderTab,
    moveTabToPane,
    toggleReadOnly,
    openTab,
    onOpenFile,
    onToggleOutline,
    onOpenInTerminal,
    onSelectionChange,
    onOpenGotoLine,
    onShowBookmarks,
    onRenameSymbol,
    onGoToDefinition,
    openFileInSplit,
    onCursorLineChange,
  } = props;

  const pane = useCodeWorkbenchStore((s) => s.panes[paneId]);
  const diskChanged = useCodeWorkbenchStore((s) => s.diskChanged);
  // 跨窗格拖拽中标签（来源窗格 + fileId），用于判定本窗格是否为合法落点
  const draggingTab = useCodeWorkbenchStore((s) => s.draggingTab);
  // 跨组件拖拽中的「文件树条目」（从工作台文件树拖出），用于把文件开进/拆分进本窗格
  const draggingFile = useCodeWorkbenchStore((s) => s.draggingFile);
  const setDraggingFile = useCodeWorkbenchStore((s) => s.setDraggingFile);
  const splitPaneWithFile = useCodeWorkbenchStore((s) => s.splitPaneWithFile);
  // 窗格同步滚动：开关 + 实时值（通过 ref 供稳定回调读最新值，避免回调随开关频繁重建）
  const syncScroll = useCodeWorkbenchStore((s) => s.syncScroll);
  const toggleSyncScroll = useCodeWorkbenchStore((s) => s.toggleSyncScroll);
  // 对比视图：在激活标签上挂载只读 DiffEditor（对标 Zed DiffEditor 双 buffer 对照）
  const openDiffTab = useCodeWorkbenchStore((s) => s.openDiffTab);
  const syncScrollRef = useRef(syncScroll);
  syncScrollRef.current = syncScroll;
  /** 切标签瞬间编辑器会触发一次 scrollTop=0 的噪声滚动，短暂屏蔽其对外广播，避免把其它窗格误拉到顶部 */
  const tabSwitchGuardRef = useRef(false);
  /** rAF 节流：滚动事件每帧最多广播一次 */
  const scrollRafRef = useRef<number | null>(null);
  // 文件表（落点时按 fileId 反查 relPath/name/language 以开窗）
  const allFiles = useProjectStore((s) => s.files);
  // 本窗格作为落点时的拆分方向（null = 中心→移入；非 null = 边缘→按方向拆分）
  const [dropState, setDropState] = useState<{ dir: SplitDirection | null } | null>(null);
  const tabs = pane?.tabs ?? [];
  const activeFileId = pane?.activeFileId ?? null;
  const activeTab: WorkbenchTab | null = tabs.find((t) => t.fileId === activeFileId) ?? null;
  const isActive = activePaneId === paneId;

  // 当前文件的书签行号集合（对标 Zed BookmarkStore，供编辑器沟槽渲染 + 状态栏计数）。
  // 订阅 store.bookmarks[fileId]，该引用仅在当前文件书签变更时变化，memo 稳定、不引发多余重渲染。
  const tabBookmarks = useCodeWorkbenchStore((s) => (activeTab ? s.bookmarks[activeTab.fileId] : undefined));
  const bookmarkLines = useMemo(() => (tabBookmarks ? tabBookmarks.map((b) => b.line) : []), [tabBookmarks]);
  const toggleBookmark = useCodeWorkbenchStore((s) => s.toggleBookmark);

  // 进入任何交互前先把本窗格设为激活（保证后续标签动作落到正确的 pane）
  const focusPane = useCallback(() => {
    setActivePane(paneId);
    onActivateEditor(editorHandleRef.current);
  }, [paneId, setActivePane, onActivateEditor]);

  // 本窗格编辑器用户滚动 → 按比例 rAF 节流广播到总线（其它窗格据此联动）
  const handleEditorScroll = useCallback(
    (ratio: number) => {
      if (!syncScrollRef.current || tabSwitchGuardRef.current) return;
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        paneScrollBus.publish({ paneId, ratio });
      });
    },
    [paneId],
  );

  // 切标签噪声屏蔽：activeFileId 变化时短暂忽略本窗格的滚动广播（避免误拉其它窗格）
  useEffect(() => {
    tabSwitchGuardRef.current = true;
    const id = window.setTimeout(() => {
      tabSwitchGuardRef.current = false;
    }, 80);
    return () => window.clearTimeout(id);
  }, [activeTab?.fileId]);

  // 订阅总线：收到其它窗格滚动时，按相同比例联动本窗格（echo 由 Monaco 端 suppress 拦截，不会回灌）
  useEffect(() => {
    const unsub = paneScrollBus.subscribe((m) => {
      if (m.paneId === paneId) return;
      if (!syncScrollRef.current) return;
      editorHandleRef.current?.setScrollRatio(m.ratio);
    });
    return unsub;
  }, [paneId]);

  // 跨窗格拖拽落点方向计算（对标 Zed `drag_split_direction` 边缘邻近启发式）：
  // 光标落在窗格某条边带内 → 该方向拆分；落在内部（远离四条边）→ null（移入中心）。
  const computeSplitDir = useCallback((e: React.DragEvent, rect: DOMRect): SplitDirection | null => {
    const w = rect.width;
    const h = rect.height;
    // 边缘判定带宽度：随窗格尺寸自适应，限制在合理范围，避免误触
    const band = Math.min(64, Math.max(28, Math.min(w, h) * 0.16));
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const nearLeft = x < band;
    const nearRight = x > w - band;
    const nearTop = y < band;
    const nearBottom = y > h - band;
    if (!(nearLeft || nearRight || nearTop || nearBottom)) return null;
    const candidates: [SplitDirection, number][] = [
      ['left', x],
      ['right', w - x],
      ['up', y],
      ['down', h - y],
    ];
    candidates.sort((a, b) => a[1] - b[1]);
    return candidates[0][0];
  }, []);

  // 窗格级拖拽落点处理：跨窗格拖拽时把来源标签拆分/移入本窗格
  const handlePaneDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!draggingTab && !draggingFile) return;
      // 标签栏区域（含具体标签）→ 交给标签级精确插入处理，本层只负责编辑区（拆分 / 合并到末位）
      if ((e.target as HTMLElement).closest('[data-wb-tabbar]')) {
        setDropState(null);
        return;
      }
      // 同源窗格 + 悬停在某个标签上 → 交给标签级重排，本层不介入拆分
      if (draggingTab && draggingTab.paneId === paneId && (e.target as HTMLElement).closest('[data-wb-tab]')) {
        setDropState(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      setDropState({ dir: computeSplitDir(e, rect) });
    },
    [draggingTab, draggingFile, paneId, computeSplitDir],
  );

  const handlePaneDrop = useCallback(
    (e: React.DragEvent) => {
      const src = draggingTab;
      const fileSrc = draggingFile;
      setDropState(null);
      if (!src && !fileSrc) return;
      // 标签栏落点（精确插入）由标签级 onDrop 处理（已 stopPropagation），本层跳过避免双触发
      if ((e.target as HTMLElement).closest('[data-wb-tabbar]')) return;
      // 同源窗格 + 落在标签上 → 标签级重排已处理，本层跳过
      if (src && src.paneId === paneId && (e.target as HTMLElement).closest('[data-wb-tab]')) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const dir = computeSplitDir(e, rect);
      if (src) {
        // 跨窗格拖拽标签：边缘→拆分、中心且跨窗格→移入
        if (dir) {
          splitPaneWithTab(src.paneId, src.fileId, paneId, dir);
        } else if (src.paneId !== paneId) {
          moveTabToPane(src.fileId, paneId);
          setDraggingTab(null);
        } else {
          setDraggingTab(null);
        }
        return;
      }
      // 文件树条目拖入：边缘→按方向拆分并以该文件开窗；中心→在本窗格直接打开
      if (fileSrc) {
        if (dir) {
          splitPaneWithFile(paneId, fileSrc.fileId, dir);
        } else {
          const f = allFiles.find((x) => x.id === fileSrc.fileId);
          if (f) {
            setActivePane(paneId);
            openTab(f.id, f.relPath, f.name, f.language);
          }
          setDraggingFile(null);
        }
      }
    },
    [
      draggingTab,
      draggingFile,
      paneId,
      splitPaneWithTab,
      moveTabToPane,
      setDraggingTab,
      splitPaneWithFile,
      setDraggingFile,
      setActivePane,
      openTab,
      allFiles,
      computeSplitDir,
    ],
  );

  const handlePaneDragLeave = useCallback((e: React.DragEvent) => {
    // 仅当真正离开本窗格（而非进入子元素）时清除落点提示
    const related = e.relatedTarget as Node | null;
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDropState(null);
    }
  }, []);

  // 标签拖拽重排（复用外壳既有 store.reorderTab 语义）
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ fileId: string; pos: 'before' | 'after' } | null>(null);
  const [tabMenu, setTabMenu] = useState<{
    anchor: HTMLElement;
    fileId: string;
    index: number;
    pinned: boolean;
    readOnly: boolean;
  } | null>(null);
  // 「与已打开的文件对比…」二级选择器：列出全部已打开标签（排除当前文件、按 fileId 去重）
  const [compareMenu, setCompareMenu] = useState<{ anchor: HTMLElement; fileId: string } | null>(null);

  const editorHandleRef = useRef<MonacoEditorHandle | null>(null);
  // 把本窗格编辑器的聚焦函数注册进 store 的焦点注册表（按 paneId），
  // 供窗格方向/循环导航把 DOM 焦点移交给目标编辑器（对标 Zed activate_pane_in_direction 末尾 focus 编辑器）。
  useEffect(() => {
    registerPaneFocus(paneId, () => editorHandleRef.current?.focus());
    return () => unregisterPaneFocus(paneId);
  }, [paneId]);
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null);
  // 本窗格光标/选区状态（对标 Zed crates/go_to_line/src/cursor_position.rs 的 CursorPosition 状态栏项）
  const [cursorStatus, setCursorStatus] = useState<CursorStatus | null>(null);
  // 诊断计数（状态栏「问题」指示项，对标 Zed 状态栏 Problems）：N 错误 · M 警告，点击跳下一处
  const [markerStats, setMarkerStats] = useState<MarkerStats | null>(null);
  // 本窗格文档信息（行尾符，对标 Zed crates/line_ending_selector 的 LineEndingIndicator 状态栏项）
  const [editorInfo, setEditorInfo] = useState<EditorInfo | null>(null);
  // 列选择模式状态（状态栏指示项，对标 Zed ColumnarSelection 视觉反馈）：开启时显示并一键关闭
  const [columnSelection, setColumnSelection] = useState(false);
  // 编辑器字号（状态栏缩放控件，对标 Zed 字号 ±/重置：常驻可见，− 缩小 / 数字点击重置 / + 放大）
  const [fontSize, setFontSize] = useState(13);
  // 软换行状态（状态栏指示项，对标 Zed 软换行视觉反馈）：开启时显示并一键关闭
  const [wordWrap, setWordWrap] = useState(false);
  const themeMode = useTheme().palette.mode as 'light' | 'dark';

  // 语言显示名（tab.language 可能为 "source.rust" 这类带命名空间 id，取末段并首字母大写）
  const langLabel = useMemo(() => {
    if (!activeTab?.language) return null;
    const raw = activeTab.language.split('/').pop() ?? activeTab.language;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [activeTab?.language]);

  // —— 本窗格独立推导的高亮区间（对标外壳，但从本窗格激活文件计算） ——
  const metrics = useProjectStore((s) => s.metrics);
  const deadSymbols = useProjectStore((s) => s.deadSymbols);
  const clones = useProjectStore((s) => s.clones);
  const symbols = useProjectStore((s) => s.symbols);

  const activeMetric = useMemo(() => {
    if (!activeFileId) return null;
    const list = metrics.filter((m) => m.fileId === activeFileId);
    if (list.length === 0) return null;
    return list.sort((a, b) => b.createdAt - a.createdAt)[0];
  }, [metrics, activeFileId]);

  const heatRanges = useMemo<HeatRange[]>(() => {
    if (!activeMetric) return [];
    const meta = parseFileMetricMeta(activeMetric);
    return (meta.functions || [])
      .filter((f) => f.endLine >= f.line)
      .map((f) => ({
        startLine: f.line,
        endLine: f.endLine,
        cc: f.cc,
        level: ccLevel(f.cc),
        name: f.name,
      }));
  }, [activeMetric]);

  const deadRanges = useMemo<DeadRange[]>(() => {
    if (!activeFileId) return [];
    return deadSymbols
      .filter((d) => d.fileId === activeFileId)
      .map((d) => ({
        startLine: d.lineStart,
        endLine: d.lineEnd,
        name: d.name,
        reason: d.reason,
        confidence: d.confidence,
      }));
  }, [deadSymbols, activeFileId]);

  const cloneRanges = useMemo<CloneRange[]>(() => {
    if (!activeFileId) return [];
    return clones
      .filter((c) => c.fileId === activeFileId)
      .map((c) => ({
        startLine: c.startLine,
        endLine: c.endLine,
        groupId: c.groupId,
        groupSize: c.groupSize,
        cloneType: c.cloneType,
        snippet: c.snippet,
      }));
  }, [clones, activeFileId]);

  // 审查发现 → 编辑器行内洞察标记（对标 Zed crates/diagnostics：项目级发现以
  // 严重程度着色的内联波浪线 + 沟槽图标 + overview 标尺 + 悬停提示，渲染在问题所在行）。
  // 与 heat/dead/clone 一致，从本窗格激活文件独立推导，保证多窗格互不干扰、随 findings 实时刷新。
  const findings = useProjectStore((s) => s.findings);
  // 审查发现严重度筛选 + 内联总开关（与「审查结果」面板共享同一事实来源，双向联动）
  const findingFilter = useEditorStore((s) => s.reviewFindingFilter);

  const severityToMark = (sev: string): SourceMark['severity'] => {
    if (sev === 'critical') return 'error';
    if (sev === 'warning') return 'warning';
    return 'info';
  };

  const findingMarks = useMemo<SourceMark[]>(() => {
    if (!activeFileId || !findingFilter.showInline) return [];
    const sevFilter = findingFilter.severities;
    const out: SourceMark[] = [];
    for (const f of findings) {
      if (f.targetId !== activeFileId) continue;
      // 与「审查结果」面板同口径：severities 为空=全部，否则只渲染被选中的严重度
      if (sevFilter.length > 0 && !sevFilter.includes(f.severity)) continue;
      const line = readLineFromMetadata(f.metadata);
      if (!line || line <= 0) continue;
      out.push({
        line,
        severity: severityToMark(f.severity),
        label: f.message,
        findingId: f.id,
      });
    }
    return out;
  }, [findings, activeFileId, findingFilter.severities, findingFilter.showInline]);

  // 行内审查发现标记（沟槽图标）点击 → 聚焦审查面板 + 弹出行级行动浮层
  // （对标 Zed 诊断 hover 详情，差异化增强：点击即行动，避免「渲染了却没用」的死节点）。
  const [markPopover, setMarkPopover] = useState<{
    anchorEl: HTMLElement | null;
    findingId: string;
  } | null>(null);

  const handleMarkClick = useCallback(
    (findingId: string, anchorEl: HTMLElement | null) => {
      focusPane();
      useEditorStore.getState().focusReviewFinding(findingId);
      setMarkPopover({ anchorEl, findingId });
    },
    [focusPane],
  );

  const markFinding = markPopover ? (findings.find((f) => f.id === markPopover.findingId) ?? null) : null;

  const handleMarkDiagnose = useCallback(() => {
    if (!markFinding) return;
    const file = files.find((x) => x.id === markFinding.targetId);
    const filePath = file?.relPath;
    if (!filePath) {
      useToastStore.getState().showToast(t('panel.review.diagnoseNoFile', { msg: markFinding.message }), 'warning');
      return;
    }
    const line = readLineFromMetadata(markFinding.metadata);
    triggerDiagnosis({
      filePath,
      kind: 'review',
      title: markFinding.ruleId ? markFinding.ruleId.replace(/_/g, ' ') : markFinding.message,
      lineRange: line ? [line, line] : undefined,
      detail: markFinding.message,
    });
    setMarkPopover(null);
  }, [markFinding, files]);

  const handleMarkCopy = useCallback(() => {
    if (markFinding?.message) navigator.clipboard?.writeText(markFinding.message);
    setMarkPopover(null);
  }, [markFinding]);

  const outlineSymbols = useMemo<ProjectSymbol[]>(() => {
    if (!activeFileId) return [];
    return symbols
      .filter((s) => s.fileId === activeFileId)
      .sort((a, b) => a.lineStart - b.lineStart || a.name.localeCompare(b.name));
  }, [symbols, activeFileId]);

  const gotoSymbols = useMemo<string[]>(() => Array.from(new Set(symbols.map((s) => s.name.toLowerCase()))), [symbols]);

  // 面包屑符号链：对标 Zed `breadcrumbs_inner` + `outline_symbols_at_cursor`。
  // Zed 在光标处取「包含光标的所有外层→内层符号」整条链（如 Class › method › block），
  // 而非单个最深层符号；且随 **光标（caret）** 实时更新——即便没有文本选区。
  // 我们此前仅取最深层符号且依赖文本选区（空选区时 selection 为 null），与 Zed 行为偏离。
  // 现改为：以 caret 行（cursorStatus.line，无则回退选区起点）驱动，
  // 用 lineStart/lineEnd 包容关系重建祖先链，outer→inner 排序（等价 Zed 的 outline 链）。
  const caretLine = cursorStatus?.line ?? selection?.startLine ?? null;
  const activeSymbolChain = useMemo<{ name: string; line: number; kind?: string }[]>(() => {
    if (caretLine == null || outlineSymbols.length === 0) return [];
    const chain = outlineSymbols.filter((s) => s.lineStart <= caretLine && s.lineEnd >= caretLine);
    // outer→inner：lineStart 升序（外层先开始）；相等时 lineEnd 降序（外层跨度更大）
    chain.sort((a, b) => a.lineStart - b.lineStart || b.lineEnd - a.lineEnd);
    return chain.map((s) => ({ name: s.name, line: s.lineStart, kind: s.kind }));
  }, [caretLine, outlineSymbols]);

  const handleSetActive = (fileId: string) => {
    focusPane();
    setActive(fileId);
  };
  const handleCloseTab = (fileId: string) => {
    focusPane();
    closeTab(fileId);
  };

  // 面包屑分析动作回调：文件段 → 画像(依赖聚焦此文件 / 复杂度 / 调用图) + AI 诊断；符号段 → AI 诊断。
  // 对标 Zed breadcrumbs「上下文感知动作」——把导航面包屑变成连接「分析能力层」的入口（renderable AND useful）。
  const onAnalyzeFile = useCallback((fileId: string, kind: PortraitKind) => {
    const aid = useProjectStore.getState().activeAnalysisId;
    if (!aid) {
      useToastStore.getState().showToast(t('portrait.msg.noAnalysis'), 'warning');
      return;
    }
    void runPortrait(kind, aid, kind === 'dependency' ? { focusFileId: fileId } : undefined).then((r) => {
      useToastStore.getState().showToast(r.message, r.severity);
    });
  }, []);
  const onDiagnoseFile = useCallback(
    (fileId: string) => {
      const f = allFiles.find((x) => x.id === fileId);
      if (!f) return;
      void triggerDiagnosis({ filePath: f.relPath, kind: 'file', title: f.name });
    },
    [allFiles],
  );
  const onDiagnoseSymbol = useCallback(
    (fileId: string, symbolName: string, line: number) => {
      const f = allFiles.find((x) => x.id === fileId);
      if (!f) return;
      void triggerDiagnosis({
        filePath: f.relPath,
        kind: 'complexity',
        title: symbolName,
        lineRange: [line, line],
      });
    },
    [allFiles],
  );

  // 早退必须放在所有 Hook 之后：pane 从有到无（关掉最后一个标签）时 Hook 数量才保持一致，
  // 否则 React 抛 "Rendered fewer hooks than expected"。守卫后的三个 useCallback 都不读 pane。
  if (!pane) return null;

  // 跨窗格落点整框发光：来源标签来自「其他窗格」且正悬停本窗格时，给本窗格加琥珀金 outline，
  // 使跨窗格目标被整框「瞄准」（与内部 DropEdge/移入徽标浮层叠加，落点更明确）。
  const isCrossPaneTarget = !!dropState && !!draggingTab && draggingTab.paneId !== paneId;

  // 跨窗格拖拽中的来源标签（来自其他窗格）；用于标签级精确插入（对齐 Zed 把标签拖到另一窗格标签条→按 ix 并入）。
  const crossDrag = draggingTab && draggingTab.paneId !== paneId ? draggingTab : null;

  return (
    <Box
      data-pane-id={paneId}
      sx={{
        flex: paneFlex ?? 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderRight: paneAxis === 'row' ? 1 : 0,
        borderBottom: paneAxis === 'col' ? 1 : 0,
        borderColor: 'divider',
        // 激活窗格高亮（键盘导航/点击聚焦后可见，对标 Zed active pane 边框）；拖拽落点高亮优先
        outline: isCrossPaneTarget ? '2px solid #EF9F27' : isActive ? '2px solid' : 'none',
        outlineColor: isCrossPaneTarget ? undefined : 'primary.main',
        outlineOffset: isCrossPaneTarget ? '-2px' : '-2px',
        boxShadow: isCrossPaneTarget
          ? '0 0 0 3px rgba(239,159,39,0.25)'
          : isActive
            ? '0 0 0 2px rgb(var(--template-palette-primary-mainChannel) / 0.18)'
            : 'none',
      }}
      onMouseDown={focusPane}
      onDragOver={handlePaneDragOver}
      onDrop={handlePaneDrop}
      onDragLeave={handlePaneDragLeave}
    >
      {/* 窗格工具条：拆分 / 关闭窗格 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 0.5,
          py: 0.25,
          borderBottom: 1,
          borderColor: 'divider',
          // 激活窗格工具条着色（键盘导航后清晰可辨，对标 Zed active pane 高亮）
          bgcolor: isActive ? 'rgb(var(--template-palette-primary-mainChannel) / 0.10)' : 'background.paper',
          color: isActive ? 'primary.main' : 'inherit',
        }}
      >
        <Tooltip title={t('workbench.pane.splitRight')}>
          <IconButton
            size="small"
            onClick={() => {
              focusPane();
              splitPane('right', 'clone');
            }}
            aria-label={t('workbench.pane.splitRight')}
          >
            <CallSplitIcon sx={{ fontSize: uiFontSize(15), transform: 'rotate(90deg)' }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('workbench.pane.splitDown')}>
          <IconButton
            size="small"
            onClick={() => {
              focusPane();
              splitPane('down', 'clone');
            }}
            aria-label={t('workbench.pane.splitDown')}
          >
            <CallSplitIcon sx={{ fontSize: uiFontSize(15) }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={syncScroll ? t('workbench.pane.syncScrollOn') : t('workbench.pane.syncScrollOff')}>
          <IconButton
            size="small"
            color={syncScroll ? 'primary' : 'default'}
            onClick={() => {
              focusPane();
              toggleSyncScroll();
            }}
            aria-label={syncScroll ? t('workbench.pane.syncScrollOn') : t('workbench.pane.syncScrollOff')}
          >
            <SyncAltIcon sx={{ fontSize: uiFontSize(15) }} />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('workbench.pane.closePane')}>
          <IconButton
            size="small"
            disabled={activePaneId === paneId && false}
            onClick={() => {
              focusPane();
              closePane(paneId);
            }}
            aria-label={t('workbench.pane.closePane')}
          >
            <CloseIcon sx={{ fontSize: uiFontSize(15) }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 标签栏（data-wb-tabbar：跨窗格拖拽时由标签级精确插入接管，窗格级处理器据此跳过） */}
      <Box
        data-wb-tabbar
        onDragOver={(e) => {
          if (e.target !== e.currentTarget) return; // 仅标签条空白区；悬停具体标签交给标签级处理
          const isLocal = !!dragId;
          const isCross = !!draggingTab && draggingTab.paneId !== paneId;
          if (!isLocal && !isCross) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          if (e.target !== e.currentTarget) return;
          const isLocal = !!dragId;
          const isCross = !!draggingTab && draggingTab.paneId !== paneId;
          if (!isLocal && !isCross) return;
          e.preventDefault();
          e.stopPropagation(); // 阻止冒泡到窗格级 onDrop，避免与标签级精确插入双触发
          if (isCross && draggingTab) {
            // 跨窗格拖到标签条空白区 → 并入本窗格末尾（合并到末位，对标 Zed tab_bar_drop_target）
            moveTabToPane(draggingTab.fileId, paneId);
            setDraggingTab(null);
          } else if (isLocal && dragId) {
            reorderTab(dragId, tabs.length);
            setDragId(null);
            setDropPos(null);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflowX: 'auto',
        }}
      >
        {tabs.length === 0 && (
          <Typography variant="caption" color="text.disabled">
            {t('workbench.noActive')}
          </Typography>
        )}
        {tabs.map((tab, index) => {
          const active = tab.fileId === activeFileId;
          const isDragging = dragId === tab.fileId;
          const isLocalDrag = !!dragId && dragId !== tab.fileId;
          const isCrossDrag = !!crossDrag && crossDrag.fileId !== tab.fileId;
          const dropHere =
            (isLocalDrag || isCrossDrag) && dropPos && dropPos.fileId === tab.fileId ? dropPos.pos : null;
          return (
            <Box
              key={tab.fileId}
              draggable
              data-wb-tab
              onClick={() => handleSetActive(tab.fileId)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                focusPane();
                setTabMenu({
                  anchor: e.currentTarget as HTMLElement,
                  fileId: tab.fileId,
                  index,
                  pinned: tab.pinned,
                  readOnly: tab.readOnly,
                });
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  handleCloseTab(tab.fileId);
                }
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.fileId);
                // 品牌化拖影（对标 Zed DragMoveEvent + 自定义 drag preview）：注入深色胶囊+琥珀金描边，
                // 让跟随光标的浮影一眼可辨是「被拖起的标签」，而非浏览器默认灰快照。
                const ghost = document.createElement('div');
                ghost.textContent = tab.name;
                ghost.style.cssText =
                  'position:absolute;top:-1000px;left:-1000px;padding:4px 10px;border-radius:6px;' +
                  'font:600 12px -apple-system,system-ui,sans-serif;background:rgba(15,23,42,0.94);color:#fff;' +
                  'border:1px solid #EF9F27;box-shadow:0 6px 18px rgba(239,159,39,0.45);white-space:nowrap;';
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 16, 14);
                setTimeout(() => document.body.removeChild(ghost), 0);
                setDragId(tab.fileId);
                setDraggingTab({ paneId, fileId: tab.fileId });
              }}
              onDragOver={(e) => {
                const isLocal = !!dragId && dragId !== tab.fileId;
                const isCross = !!crossDrag && crossDrag.fileId !== tab.fileId;
                if (!isLocal && !isCross) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const pos: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                setDropPos({ fileId: tab.fileId, pos });
              }}
              onDragLeave={() => {
                setDropPos((p) => (p && p.fileId === tab.fileId ? null : p));
              }}
              onDrop={(e) => {
                const isLocal = !!dragId && dragId !== tab.fileId;
                const isCross = !!crossDrag && crossDrag.fileId !== tab.fileId;
                if (!isLocal && !isCross) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientX >= rect.left + rect.width / 2;
                const targetIndex = tabs.findIndex((t) => t.fileId === tab.fileId);
                if (targetIndex < 0) {
                  setDragId(null);
                  setDropPos(null);
                  return;
                }
                if (isCross && crossDrag) {
                  // 跨窗格精确插入：把来源标签并入本窗格的指定下标（对齐 Zed move_item 的 destination_index），
                  // 落点取「被悬停标签之前/之后」的 flat 位置（pinned 在前，与 reorderTab 同口径）。
                  const insertFlat = after ? targetIndex + 1 : targetIndex;
                  moveTabToPane(crossDrag.fileId, paneId, insertFlat);
                  setDraggingTab(null);
                } else if (isLocal && dragId) {
                  const fromIdx = tabs.findIndex((t) => t.fileId === dragId);
                  const insertAt = after
                    ? targetIndex < fromIdx
                      ? targetIndex + 1
                      : targetIndex
                    : targetIndex < fromIdx
                      ? targetIndex
                      : targetIndex - 1;
                  reorderTab(dragId, insertAt);
                }
                setDragId(null);
                setDropPos(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropPos(null);
                setDraggingTab(null);
              }}
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.4,
                borderRadius: 1,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                opacity: isDragging ? 0.5 : 1,
                boxShadow: isDragging
                  ? 'inset 0 0 0 1px rgba(239,159,39,0.4)'
                  : dropHere
                    ? 'inset 0 0 0 1px rgba(239,159,39,0.5)'
                    : 'none',
                bgcolor: active ? 'rgba(59,130,246,0.12)' : dropHere ? 'rgba(239,159,39,0.12)' : 'transparent',
                color: active ? 'primary.main' : 'text.secondary',
                borderBottom: active ? '2px solid' : '2px solid transparent',
                borderBottomColor: active ? 'primary.main' : 'transparent',
                '&:hover': { bgcolor: active ? 'rgba(59,130,246,0.18)' : 'action.hover' },
              }}
            >
              {dropHere && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 1,
                    bottom: 1,
                    width: 3,
                    borderRadius: 2,
                    bgcolor: '#EF9F27',
                    boxShadow: '0 0 6px 1px rgba(239,159,39,0.85)',
                    left: dropHere === 'before' ? -1 : undefined,
                    right: dropHere === 'after' ? -1 : undefined,
                    zIndex: 3,
                  }}
                />
              )}
              {tab.pinned && <PushPinIcon sx={{ fontSize: uiFontSize(11), color: 'primary.main', opacity: 0.85 }} />}
              {tab.readOnly && <LockIcon sx={{ fontSize: uiFontSize(11), color: 'text.disabled', opacity: 0.85 }} />}
              {tab.kind === 'image' || tab.kind === 'svg' ? (
                <ImageIcon sx={{ fontSize: uiFontSize(13), color: 'text.secondary' }} />
              ) : tab.kind === 'markdown' ? (
                <DescriptionIcon sx={{ fontSize: uiFontSize(13), color: 'text.secondary' }} />
              ) : (
                <LanguageIcon lang={tab.language} size={13} />
              )}
              <Typography variant="caption" sx={{ fontSize: uiFontSize(11), fontWeight: active ? 600 : 400 }}>
                {tab.name}
              </Typography>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.fileId);
                }}
                sx={{ p: 0.1, ml: 0.3 }}
                aria-label={t('workbench.tabMenu.close')}
              >
                <CloseIcon sx={{ fontSize: uiFontSize(13) }} />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      {/* 标签右键上下文菜单：对标 Zed tab context menu */}
      <Menu
        anchorEl={tabMenu?.anchor}
        open={!!tabMenu}
        onClose={() => setTabMenu(null)}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        {tabMenu &&
          (() => {
            setActivePane(paneId);
            const target = tabMenu;
            const file = files.find((x) => x.id === target.fileId);
            const hasLeftCloseable = tabs.slice(0, target.index).some((t) => !t.pinned);
            const hasRightCloseable = tabs.slice(target.index + 1).some((t) => !t.pinned);
            const parentDir = file?.path
              ? (() => {
                  const sep = file.path.includes('\\') ? '\\' : '/';
                  const i = file.path.lastIndexOf(sep);
                  return i > 0 ? file.path.slice(0, i) : file.path;
                })()
              : '';
            return (
              <>
                <MenuItem
                  onClick={() => {
                    closeTab(target.fileId);
                    setTabMenu(null);
                  }}
                >
                  {t('workbench.tabMenu.close')}
                </MenuItem>
                <MenuItem
                  disabled={tabs.length <= 1}
                  onClick={() => {
                    closeOthers(target.fileId);
                    setTabMenu(null);
                  }}
                >
                  {t('workbench.tabMenu.closeOthers')}
                </MenuItem>
                <Divider />
                <MenuItem
                  disabled={!hasLeftCloseable}
                  onClick={() => {
                    closeLeft(target.fileId);
                    setTabMenu(null);
                  }}
                >
                  {t('workbench.tabMenu.closeLeft')}
                </MenuItem>
                <MenuItem
                  disabled={!hasRightCloseable}
                  onClick={() => {
                    closeRight(target.fileId);
                    setTabMenu(null);
                  }}
                >
                  {t('workbench.tabMenu.closeRight')}
                </MenuItem>
                <MenuItem
                  disabled={tabs.length <= 1}
                  onClick={() => {
                    closeAll();
                    setTabMenu(null);
                  }}
                >
                  {t('workbench.tabMenu.closeAll')}
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    togglePin(target.fileId);
                    setTabMenu(null);
                  }}
                >
                  <PushPinIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  {target.pinned ? t('workbench.tabMenu.unpin') : t('workbench.tabMenu.pin')}
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    const f = files.find((x) => x.id === target.fileId);
                    if (f?.path) navigator.clipboard?.writeText(f.path);
                    setTabMenu(null);
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  {t('workbench.tabMenu.copyPath')}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    const f = files.find((x) => x.id === target.fileId);
                    if (f?.relPath) navigator.clipboard?.writeText(f.relPath);
                    setTabMenu(null);
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  {t('workbench.tabMenu.copyRelativePath')}
                </MenuItem>
                <Divider />
                <MenuItem
                  disabled={!parentDir}
                  onClick={() => {
                    // 复用外壳集成终端：拉起终端并 cd 到文件目录（由外壳提供 sendToActiveTerminal）
                    setTabMenu(null);
                    onOpenInTerminal?.(parentDir);
                  }}
                >
                  <TerminalIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  {t('workbench.tabMenu.openInTerminal')}
                </MenuItem>
                <MenuItem
                  disabled={!file?.path}
                  onClick={() => {
                    if (file?.path) {
                      void invoke('reveal_in_file_manager', { path: file.path }).catch(() => {});
                    }
                    setTabMenu(null);
                  }}
                >
                  <FolderIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  {t('workbench.tabMenu.revealInFileManager')}
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    toggleReadOnly(target.fileId);
                    setTabMenu(null);
                  }}
                >
                  {target.readOnly ? (
                    <LockOpenIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  ) : (
                    <LockIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  )}
                  {target.readOnly ? t('workbench.tabMenu.makeEditable') : t('workbench.tabMenu.makeReadOnly')}
                </MenuItem>
                <Divider />
                {/* 对比视图：对标 Zed DiffEditor 双 buffer 对照（renderable AND useful 的审查能力） */}
                <MenuItem
                  disabled={activeTab?.kind !== 'text'}
                  onClick={async () => {
                    const fid = target.fileId;
                    try {
                      const savedRaw = await projectScanApi.readSourceFile(fid);
                      const savedText = tabTextContent(savedRaw);
                      const live =
                        fid === activeTab?.fileId
                          ? (editorHandleRef.current?.getValue() ?? tabTextContent(activeTab?.content))
                          : tabTextContent(activeTab?.content);
                      openDiffTab(target.fileId, {
                        kind: 'saved',
                        modifiedLabel: `${file?.name ?? fid} — ${t('workbench.diff.working')}`,
                        modifiedText: live,
                        originalLabel: t('workbench.diff.savedOnDisk'),
                        originalText: savedText,
                      });
                    } catch {
                      /* 读盘失败静默放弃，不影响其它菜单项 */
                    }
                    setTabMenu(null);
                  }}
                >
                  <CompareArrowsIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  {t('workbench.diff.compareWithSaved')}
                </MenuItem>
                <MenuItem
                  disabled={activeTab?.kind !== 'text'}
                  onClick={() => {
                    setCompareMenu({ anchor: tabMenu!.anchor, fileId: target.fileId });
                    setTabMenu(null);
                  }}
                >
                  <CompareArrowsIcon sx={{ fontSize: uiFontSize(15), mr: 1 }} />
                  {t('workbench.diff.compareWithOpenTab')}
                </MenuItem>
              </>
            );
          })()}
      </Menu>

      {/* 「与已打开的文件对比…」二级选择器：列出全部已打开标签（排除当前文件、按 fileId 去重） */}
      <Menu
        anchorEl={compareMenu?.anchor}
        open={!!compareMenu}
        onClose={() => setCompareMenu(null)}
        slotProps={{ paper: { sx: { minWidth: 220, maxHeight: 320 } } }}
      >
        {compareMenu &&
          (() => {
            const panes = useCodeWorkbenchStore.getState().panes;
            const all = Object.values(panes).flatMap((p) => p.tabs);
            const seen = new Set<string>();
            const items: typeof all = [];
            for (const tt of all) {
              if (tt.fileId === compareMenu.fileId) continue;
              if (seen.has(tt.fileId)) continue;
              seen.add(tt.fileId);
              items.push(tt);
            }
            if (items.length === 0) {
              return (
                <MenuItem disabled>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('workbench.diff.noOtherTabs')}
                  </Typography>
                </MenuItem>
              );
            }
            return items.map((tt) => (
              <MenuItem
                key={tt.fileId}
                onClick={() => {
                  const src = all.find((x) => x.fileId === compareMenu.fileId);
                  const other = tt;
                  const modifiedText =
                    compareMenu.fileId === activeTab?.fileId
                      ? (editorHandleRef.current?.getValue() ?? tabTextContent(src?.content))
                      : tabTextContent(src?.content);
                  openDiffTab(compareMenu.fileId, {
                    kind: 'file',
                    modifiedLabel: src?.name ?? '',
                    modifiedText,
                    originalLabel: other.name,
                    originalText: tabTextContent(other.content),
                  });
                  setCompareMenu(null);
                }}
              >
                <DescriptionIcon sx={{ fontSize: uiFontSize(15), mr: 1, color: 'text.secondary' }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap variant="body2">
                    {tt.name}
                  </Typography>
                  <Typography noWrap variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {tt.relPath}
                  </Typography>
                </Box>
              </MenuItem>
            ));
          })()}
      </Menu>

      {/* 面包屑：仅当存在目录段或光标符号链时才渲染——否则与标签栏「文件名+语言图标」完全重复
          （根目录裸文件会塌缩成单图标空条），按用户口径不显示该行。 */}
      {activeTab && (activeTab.relPath.includes('/') || activeSymbolChain.length > 0) && (
        <Breadcrumbs
          relPath={activeTab.relPath}
          language={activeTab.language}
          files={files}
          symbols={activeSymbolChain}
          onOpenFile={onOpenFile}
          onToggleOutline={onToggleOutline}
          onRevealLine={(line: number) => editorHandleRef.current?.revealLine(line)}
          onCopyPath={() => {
            if (activeTab.relPath) navigator.clipboard?.writeText(activeTab.relPath);
          }}
          onAnalyzeFile={onAnalyzeFile}
          onDiagnoseFile={onDiagnoseFile}
          onDiagnoseSymbol={onDiagnoseSymbol}
        />
      )}

      {/* 编辑器 */}
      <Box
        sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}
        onKeyDownCapture={(e) => {
          if (isTerminalTarget(e.nativeEvent)) return;
          if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'i' || e.key.toLowerCase() === 'k')) {
            if (activeFileId && activeTab?.kind === 'text') {
              e.preventDefault();
              e.stopPropagation();
              focusPane();
              onOpenInline();
            }
          }
        }}
      >
        {activeFileId && diskChanged.has(activeFileId) && (
          <Alert
            severity="warning"
            sx={{ m: 1, mb: 0 }}
            action={
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    void useCodeWorkbenchStore.getState().reloadTab(activeFileId);
                    useCodeWorkbenchStore.getState().clearDiskChanged(activeFileId);
                  }}
                >
                  {t('workbench.discardMine')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => useCodeWorkbenchStore.getState().clearDiskChanged(activeFileId)}
                >
                  {t('workbench.keepMine')}
                </Button>
              </Box>
            }
          >
            {t('workbench.diskChanged', { file: activeTab?.relPath ?? '' })}
          </Alert>
        )}
        {activeTab ? (
          activeTab.kind === 'image' || activeTab.kind === 'svg' ? (
            <WorkbenchMediaPreview
              fileId={activeTab.fileId}
              name={activeTab.name}
              kind={activeTab.kind}
              themeMode={themeMode}
            />
          ) : activeTab.kind === 'markdown' ? (
            <WorkbenchMarkdownPreview fileId={activeTab.fileId} tab={activeTab} themeMode={themeMode} />
          ) : activeTab.diff ? (
            // 对比视图（只读 DiffEditor）：左 original（磁盘/另一文件）↔ 右 modified（工作缓冲区/当前文件）
            <MonacoDiffEditor tab={activeTab} themeMode={themeMode} />
          ) : (
            <EditorPane
              tab={activeTab}
              themeMode={themeMode}
              heatRanges={heatRanges}
              deadRanges={deadRanges}
              cloneRanges={cloneRanges}
              marks={findingMarks}
              bookmarks={bookmarkLines}
              onToggleBookmark={(line) => activeTab && toggleBookmark(activeTab.fileId, line)}
              onMarkClick={handleMarkClick}
              onAskAi={(sel) => onAskAi(sel)}
              gotoSymbols={gotoSymbols}
              onRequestAiOpen={onRequestAiOpen}
              editorHandleRef={editorHandleRef}
              onSelectionExternal={(sel) => {
                setSelection(sel);
                onSelectionChange?.(sel);
              }}
              onCursorStatusChange={(s) => {
                setCursorStatus(s);
                onCursorLineChange?.(s.line);
              }}
              onEditorInfoChange={(i) => setEditorInfo(i)}
              onMarkerStatsChange={(s) => setMarkerStats(s)}
              onColumnSelectionChange={(on) => setColumnSelection(on)}
              onWordWrapChange={(on) => setWordWrap(on)}
              onFontSizeChange={(size) => setFontSize(size)}
              onChangeCapture={(text) => onChangeCapture(text)}
              onRenameSymbol={onRenameSymbol}
              onGoToDefinition={onGoToDefinition}
              openFileInSplit={openFileInSplit}
              onScroll={handleEditorScroll}
            />
          )
        ) : (
          <Box sx={{ p: 2 }}>
            <Alert severity="info">{t('workbench.noActive')}</Alert>
          </Box>
        )}
        {/* 编辑器状态栏（对标 Zed crates/go_to_line/src/cursor_position.rs 的 CursorPosition 状态栏项）：
            实时显示 行:列 + 选区统计（K 选区, N 行, M 字符），点击「行:列」打开「转到行」面板。 */}
        {activeTab && activeTab.kind === 'text' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              px: 1.5,
              height: 24,
              flexShrink: 0,
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              fontSize: uiFontSize(11),
              color: 'text.secondary',
              userSelect: 'none',
            }}
          >
            {/* 左：文档信息簇（对标 Zed 右侧簇 ActiveBufferLanguage / LineEndingIndicator / ActiveBufferEncoding） */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, overflow: 'hidden' }}>
              {langLabel && (
                <Tooltip title={t('workbench.status.language')}>
                  <Box
                    component="span"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}
                  >
                    <LanguageIcon lang={activeTab.language} size={12} />
                    {langLabel}
                  </Box>
                </Tooltip>
              )}
              {editorInfo && (
                <Tooltip title={t('workbench.status.eolToggleHint')}>
                  <Box
                    component="span"
                    onClick={() => editorHandleRef.current?.toggleEol()}
                    sx={{
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      whiteSpace: 'nowrap',
                      '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                    }}
                  >
                    {editorInfo.eol}
                  </Box>
                </Tooltip>
              )}
              <Tooltip title={t('workbench.status.encodingHint')}>
                <Box component="span" sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  UTF-8
                </Box>
              </Tooltip>
            </Box>
            {/* 右：光标/选区（对标 Zed CursorPosition 状态栏项），点击「行:列」打开「转到行」面板 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
              {/* 「问题」指示项（对标 Zed 状态栏 Problems）：N 错误 · M 警告，点击打开问题面板（聚合所有已打开文件诊断，可逐项跳转） */}
              {markerStats && (markerStats.errors > 0 || markerStats.warnings > 0) && (
                <Tooltip title={t('workbench.status.problemsHint')}>
                  <Box
                    component="span"
                    onClick={() => useProblemsPanelStore.getState().requestOpen()}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.75,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontFamily: 'monospace',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {markerStats.errors > 0 && (
                      <Box
                        component="span"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: 'error.main' }}
                      >
                        <Box component="span" sx={{ fontSize: uiFontSize(9), lineHeight: 1 }}>
                          ●
                        </Box>
                        {markerStats.errors}
                      </Box>
                    )}
                    {markerStats.warnings > 0 && (
                      <Box
                        component="span"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: 'warning.main' }}
                      >
                        <Box component="span" sx={{ fontSize: uiFontSize(9), lineHeight: 1 }}>
                          ●
                        </Box>
                        {markerStats.warnings}
                      </Box>
                    )}
                  </Box>
                </Tooltip>
              )}
              {/* 多光标徽标（对标 Zed 多光标同步输入可视化）：selections>1 时高亮显示「N 光标」，
                  明确告知用户「输入将同步到所有光标」；点击退出多光标（保留主光标，Escape 同源），避免死指示项 */}
              {cursorStatus && cursorStatus.selections > 1 && (
                <Tooltip title={t('workbench.status.multiCursorHint')}>
                  <Box
                    component="span"
                    onClick={() => editorHandleRef.current?.exitMultiCursor()}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.4,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      px: 0.75,
                      py: 0.1,
                      borderRadius: 1,
                      fontSize: uiFontSize(11),
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: 'primary.contrastText',
                      bgcolor: 'primary.main',
                      boxShadow: '0 0 0 1px rgba(239,159,39,0.35)',
                      '&:hover': { filter: 'brightness(1.12)' },
                    }}
                  >
                    {t('workbench.status.multiCursor', { count: cursorStatus.selections })}
                  </Box>
                </Tooltip>
              )}
              {/* 列选择指示（对标 Zed ColumnarSelection 视觉反馈）：开启时显示，点击关闭 */}
              {columnSelection && (
                <Tooltip title={t('workbench.status.columnSelectionHint')}>
                  <Box
                    component="span"
                    onClick={() => editorHandleRef.current?.toggleColumnSelection()}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.4,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      px: 0.75,
                      py: 0.1,
                      borderRadius: 1,
                      fontSize: uiFontSize(11),
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: 'secondary.contrastText',
                      bgcolor: 'secondary.main',
                      '&:hover': { filter: 'brightness(1.12)' },
                    }}
                  >
                    {t('workbench.status.columnSelection')}
                  </Box>
                </Tooltip>
              )}
              {/* 软换行指示（对标 Zed 软换行视觉反馈）：开启时显示，点击关闭（切换为水平滚动） */}
              {wordWrap && (
                <Tooltip title={t('workbench.status.wordWrapHint')}>
                  <Box
                    component="span"
                    onClick={() => editorHandleRef.current?.toggleWordWrap()}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.4,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      px: 0.75,
                      py: 0.1,
                      borderRadius: 1,
                      fontSize: uiFontSize(11),
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: 'success.contrastText',
                      bgcolor: 'success.main',
                      '&:hover': { filter: 'brightness(1.12)' },
                    }}
                  >
                    {t('workbench.status.wordWrap')}
                  </Box>
                </Tooltip>
              )}
              {/* 字号缩放控件（对标 Zed IncreaseBufferFontSize / DecreaseBufferFontSize / ResetBufferFontSize）：
                  状态栏常驻，− 缩小 / 数字点击重置默认 / + 放大；始终可见可操作，避免死控件 */}
              <Tooltip title={t('workbench.status.fontSizeHint')}>
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.25,
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                    fontSize: uiFontSize(11),
                    lineHeight: 1.4,
                    userSelect: 'none',
                  }}
                >
                  <Box
                    component="span"
                    role="button"
                    aria-label={t('workbench.status.decreaseFont')}
                    onClick={() => editorHandleRef.current?.decreaseFont()}
                    sx={{ cursor: 'pointer', px: 0.5, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' } }}
                  >
                    −
                  </Box>
                  <Box
                    component="span"
                    role="button"
                    aria-label={t('workbench.status.resetFont')}
                    onClick={() => editorHandleRef.current?.resetFont()}
                    sx={{
                      cursor: 'pointer',
                      minWidth: 30,
                      textAlign: 'center',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {fontSize}px
                  </Box>
                  <Box
                    component="span"
                    role="button"
                    aria-label={t('workbench.status.increaseFont')}
                    onClick={() => editorHandleRef.current?.increaseFont()}
                    sx={{ cursor: 'pointer', px: 0.5, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' } }}
                  >
                    +
                  </Box>
                </Box>
              </Tooltip>
              {/* 书签计数（对标 Zed BookmarkStore 可见态）：当前文件有书签时显示，点击打开「查看书签」清单 */}
              {bookmarkLines.length > 0 && (
                <Tooltip title={t('workbench.status.bookmarkHint', { count: bookmarkLines.length })}>
                  <Box
                    component="span"
                    onClick={() => onShowBookmarks?.()}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.4,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      px: 0.75,
                      py: 0.1,
                      borderRadius: 1,
                      fontSize: uiFontSize(11),
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: '#3a2a05',
                      bgcolor: '#EF9F27',
                      '&:hover': { filter: 'brightness(1.08)' },
                    }}
                  >
                    <BookmarkIcon sx={{ fontSize: uiFontSize(13) }} />
                    {bookmarkLines.length}
                  </Box>
                </Tooltip>
              )}
              {cursorStatus && (
                <>
                  <Tooltip title={t('workbench.status.cursorHint')}>
                    <Box
                      component="span"
                      onClick={() => onOpenGotoLine?.()}
                      sx={{
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                      }}
                    >
                      {t('workbench.status.cursor', {
                        line: cursorStatus.line,
                        column: cursorStatus.column,
                      })}
                    </Box>
                  </Tooltip>
                  {(() => {
                    const { selectedLines, selectedChars } = cursorStatus;
                    const parts: string[] = [];
                    if (selectedLines > 1) parts.push(t('workbench.status.selLines', { count: selectedLines }));
                    if (selectedChars > 0) parts.push(t('workbench.status.selChars', { count: selectedChars }));
                    return parts.length ? (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ fontSize: uiFontSize(11), whiteSpace: 'nowrap' }}
                      >
                        {' (' + parts.join(', ') + ')'}
                      </Typography>
                    ) : null;
                  })()}
                </>
              )}
            </Box>
          </Box>
        )}
      </Box>
      {/* 行内审查发现标记（沟槽图标）点击后的行级行动浮层：
          聚焦审查面板 + 「AI 诊断此发现 / 复制消息」，直接把内联标记变成可行动入口（避免死节点）。 */}
      <Popover
        open={!!markPopover}
        anchorEl={markPopover?.anchorEl ?? null}
        onClose={() => setMarkPopover(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1, maxWidth: 320 } } }}
      >
        {markFinding && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography
                variant="caption"
                sx={{
                  fontSize: uiFontSize(10),
                  fontWeight: 600,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                {t('workbench.mark.title')}
              </Typography>
              {markFinding.ruleId && (
                <Typography
                  variant="caption"
                  sx={{ fontSize: uiFontSize(9), color: 'text.disabled', fontFamily: 'monospace' }}
                  noWrap
                >
                  {markFinding.ruleId}
                </Typography>
              )}
            </Box>
            <Typography variant="body2" sx={{ fontSize: uiFontSize(12), lineHeight: 1.4 }}>
              {markFinding.message}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
              <Button
                size="small"
                variant="text"
                onClick={handleMarkCopy}
                sx={{ fontSize: uiFontSize(11), textTransform: 'none', minWidth: 0, color: 'text.secondary' }}
                startIcon={<ContentCopyIcon sx={{ fontSize: uiFontSize(14) }} />}
              >
                {t('workbench.mark.copyMsg')}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={handleMarkDiagnose}
                sx={{ fontSize: uiFontSize(11), textTransform: 'none' }}
                startIcon={<AutoFixHighIcon sx={{ fontSize: uiFontSize(14) }} />}
              >
                {t('workbench.mark.diagnose')}
              </Button>
            </Box>
          </Box>
        )}
      </Popover>
      {/* 跨窗格拖拽落点指示层（对标 Zed drag_split_direction）：边缘→按方向拆分、中心→移入。
          绝对定位 + pointer-events:none，不拦截其下标签的原生拖拽事件。 */}
      {dropState && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(239,159,39,0.10)' }} />
          {dropState.dir ? (
            <DropEdge dir={dropState.dir} />
          ) : (
            <Box
              sx={{
                position: 'relative',
                px: 1.5,
                py: 0.5,
                borderRadius: 1.5,
                bgcolor: 'rgba(15,23,42,0.85)',
                color: '#fff',
                fontSize: uiFontSize(12),
                fontWeight: 600,
                boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
                whiteSpace: 'nowrap',
              }}
            >
              {t('workbench.drop.moveToPane')}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
