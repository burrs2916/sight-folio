// sight-folio: 项目分析画布（带左面板 + 右侧 Tabs 面板 + 画布缩放平移 + 上下文菜单）
// 书场景底部状态栏（写作域速览）图标（2026-09-19 改造）
// 载体工作台实体注册（side-effect：写入组件注册表，须在 analyzer 桥接前生效）
// 载体工作台（writing-workbench）之外的两种**铺满画布**的写作卡也必须进本静态表 ——
// 画布节点只查 RENDERERS，从不查 componentRegistry / plugin rendererCache，
// 漏了就是 UnknownTypeFallback 红框（与 asset / image 当初漏注册是同一个坑）。
// 注：WritingRightPanel 的四个面板（人物/设定/关系/大纲）已从右栏撤除 —— 它们把 L2 的
// 题材分类又铺了一遍（人物/大纲与 L2 完全重复，设定=世界观换名，关系是人物画布的同源列表）。
// 面板文件**保留在盘上**，未提交前不删源码（铁律）；卷部管理唯一入口已挪到「要素」栏底部。
// WritingPalettePanel（拖拽调色板）同样已下线：把「创建动作」包装成「摆放动作」对写作是伪需求，
// 文件保留待拍板是否清理。
// 2026-09-12 方向纠正：**内容编辑面是编辑区**。L2 题材视图（大纲/人物设定/世界观）改铺
// writing-studio-pane 可编辑编辑面（studioBook.reconcileStudioPaneView），右栏退为只读检查器。

import { useEffect, useMemo, useState, useCallback, useRef, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CodeIcon from '@mui/icons-material/Code';
import SchemaOutlinedIcon from '@mui/icons-material/SchemaOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RuleIcon from '@mui/icons-material/Rule';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import SaveIcon from '@mui/icons-material/Save';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import LayersIcon from '@mui/icons-material/Layers';
import SettingsIcon from '@mui/icons-material/Settings';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import WidgetsIcon from '@mui/icons-material/Widgets';
import HubIcon from '@mui/icons-material/Hub';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SearchIcon from '@mui/icons-material/Search';
import SortIcon from '@mui/icons-material/Sort';
import ClearIcon from '@mui/icons-material/Clear';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import SubjectIcon from '@mui/icons-material/Subject';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import TimelineIcon from '@mui/icons-material/Timeline';
import PushPinIcon from '@mui/icons-material/PushPin';
import { useEditorStore } from '../store/editorStore';
import { useDirtyStore } from '../store/editorStore';
import { useSceneStore } from '../store/sceneStore';
import { useWritingStore } from '../store/writingStore';
import { useProjectStore } from '../store/projectStore';
import { EntityPortraitPanel } from './panels/EntityPortraitPanel';
import { ReviewFindingsPanel } from './panels/ReviewFindingsPanel';
import { ComponentCenterPanel } from './panels/ComponentCenterPanel';
import { ArchitectureHealthPanel } from './panels/ArchitectureHealthPanel';
import { ImpactAnalysisPanel } from './panels/ImpactAnalysisPanel';
import { WorkbenchAiPanel } from './panels/WorkbenchAiPanel';
import type { MonacoEditorHandle } from './panels/MonacoCodeEditor';
import { useInsightOverlaySync } from '../ai/useInsightOverlaySync';
import { useVerifyOverlayListener } from './useVerifyOverlaySync';
import { useImpactOverlayListener } from './useImpactOverlaySync';
import { SceneTabBar } from './components/SceneTabBar';
import { useToastStore } from '../store/toastStore';
import {
  useActiveAnalyzer,
  useActiveAnalyzerIds,
  activateAnalyzerForLanguage,
  syncPluginRulesToBackend,
} from './analyzer';
import { rerenderDirectoryTree, runPortrait } from './utils/portraits';
import { highlightInCanvasByText } from './utils/canvasLink';
import logger from '../utils/logger';
import { openChapterCarrierView, openTypedCarrierView } from '../utils/studioBook';
import { useDragBodyGuard } from '../hooks/useDragBodyGuard';
import { hasWritingCanvasCard } from '../utils/writingPaneSeed';
import { spawnCodeWorkbench } from '../services/tauri';
import { t } from '../i18n';
import { WritingPropertyPanel } from './panels/WritingPropertyPanel';
import { BookMetaPanel } from './panels/BookMetaPanel';
import { ChapterMetaPanel } from './panels/ChapterMetaPanel';
import { TimelineOverviewPanel, TimelineEventDetail, StorylineDetail } from './panels/TimelineSidePanels';
import { ForeshadowingOverviewCard, ForeshadowingDetail } from './panels/ForeshadowingPanels';
import { InspirationOverviewCard, InspirationDetail } from './panels/InspirationPanels';
import { ProofreadOverviewCard } from './panels/ProofreadPanels';
import { StatsOverviewCard } from './panels/StatsPanels';
import { WritingDocsDetailCard } from './panels/WritingDocsDetailCard';
import { clampRightTab } from '../utils/rightTabClamp';
import {
  WritingInspectorPanel,
  WritingSettingDetail,
  WritingSettingContextPanel,
  WorldviewOverview,
} from './panels/WritingInspectorPanel';
import './registerWritingWorkbench';
import './renderers/canvasEntity.css';
import { ProjectCanvas } from './sceneEditor/projectCanvas';

// ─── 工作室三栏工作区布局持久化（第十四轮）───
// 右栏宽 240~720（clamp 与写作台同量级）、默认 300；折叠态布尔。键与写作台命名同前缀。
// 此前工作室右栏宽度 / 左右栏折叠全是组件局部 state（无 localStorage）：创作者把右栏拖到
// 合适宽度、收起左栏腾出画布，**重启 / 切场景即丢**，与写作台早已记忆工作区布局不一致。
// 现补齐——三处（右栏宽/右栏折叠/左栏折叠）跨会话记忆，工作区即开即用。
const STUDIO_RIGHT_MIN = 240;
const STUDIO_RIGHT_MAX = 720;
const STUDIO_RIGHT_DEFAULT = 300;
const STUDIO_RIGHT_WIDTH_KEY = 'sight-folio:studio.rightPanelWidth';
const STUDIO_RIGHT_OPEN_KEY = 'sight-folio:studio.rightPanelOpen';
const STUDIO_LEFT_OPEN_KEY = 'sight-folio:studio.leftPanelOpen';
// 左栏可拖宽（与右栏对称）：旧固定 200px 时目录树「书名 · 章名」长标题被截断。
const STUDIO_LEFT_MIN = 180;
const STUDIO_LEFT_MAX = 420;
const STUDIO_LEFT_DEFAULT = 200;
const STUDIO_LEFT_WIDTH_KEY = 'sight-folio:studio.leftPanelWidth';

function readSavedStudioLeftPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(STUDIO_LEFT_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= STUDIO_LEFT_MIN && raw <= STUDIO_LEFT_MAX) {
      return Math.round(raw);
    }
  } catch {
    // 忽略
  }
  return STUDIO_LEFT_DEFAULT;
}

function readSavedStudioRightPanelWidth(): number | null {
  try {
    const raw = Number(localStorage.getItem(STUDIO_RIGHT_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= STUDIO_RIGHT_MIN && raw <= STUDIO_RIGHT_MAX) {
      return Math.round(raw);
    }
  } catch {
    // 忽略
  }
  return null;
}

function readSavedStudioFlag(key: string, dft: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // 忽略
  }
  return dft;
}

function readSavedStudioRightPanelOpen(): boolean {
  return readSavedStudioFlag(STUDIO_RIGHT_OPEN_KEY, true);
}
function readSavedStudioLeftPanelOpen(): boolean {
  return readSavedStudioFlag(STUDIO_LEFT_OPEN_KEY, true);
}

export function SceneEditor({
  onOpenLayersDialog,
  onSyncToCanvas,
  syncing,
  onReparseBook,
  onOpenCanvasAi,
}: {
  onOpenLayersDialog?: () => void;
  onSyncToCanvas?: () => void;
  syncing?: boolean;
  onReparseBook?: () => void;
  onOpenCanvasAi?: () => void;
}) {
  const activeSceneId = useSceneStore((s) => s.activeSceneId);
  const scenes = useSceneStore((s) => s.scenes);
  const findings = useProjectStore((s) => s.findings);
  const projectLayers = useProjectStore((s) => s.layers);
  const projectFiles = useProjectStore((s) => s.files);
  const projectModules = useProjectStore((s) => s.modules);
  // AI 洞察 → 画布角标的数据同步。挂在编辑器本体而不是右侧 AI 面板里：
  // 那个面板要切到第 6 个 tab 才挂载，而角标必须默认可见 —— 否则用户不点开
  // 那个 tab，画布上就永远看不到 Agent 已经指出来的问题。
  useInsightOverlaySync();
  // 验证结论投射：AI 面板（含验证闭环）在代码工作台窗口，画布在主窗口，
  // 用 Tauri 全局事件把「AI 改动即时效应」实时投到画布文件卡角标。
  useVerifyOverlayListener();
  // 影响面（爆炸半径）投射：AI 面板算出「改此焦点会波及哪些文件」后，经 Tauri 全局事件
  // 把 relPath 集合投到画布文件卡高亮——这是 VS Code 没有的「改动影响面」可视化。
  useImpactOverlayListener();
  // 底部状态栏「实体数」：订阅 components 长度（画布实体数量随同步/画像变化）
  const componentCount = useEditorStore((s) => s.components.length);
  const activeViewId = useEditorStore((s) => s.activeViewId);
  const activeViewName = useEditorStore((s) => s.views.find((v) => v.id === s.activeViewId)?.name);
  // 右栏「要素」检查器按当前 L2 决定给哪个编辑区出口（大纲/人物设定/世界观）。
  // 原始值选择器，不引入额外渲染抖动。
  const activeViewKind = useEditorStore((s) => s.views.find((v) => v.id === s.activeViewId)?.kind);
  // 空态引导（V4）：书场景且画布上还没有任何载体时，隐藏 Tab 栏 + 居中引导。
  // 「载体」不只有 writing-workbench：L2 题材编辑面（writing-studio-pane）与正文容器
  // （writing-docs）同样是铺满画布的内容卡。只判 workbench 会让空态引导叠在编辑面之上
  // （点开「大纲」页签却提示「拖入载体，开始创作」）。
  const hasCarrier = useEditorStore((s) => s.views.some((v) => hasWritingCanvasCard(v.components)));
  const directoryShowFiles = useEditorStore((s) => s.directoryShowFiles);
  const directorySort = useEditorStore((s) => s.directorySort);
  const directorySearch = useEditorStore((s) => s.directorySearch);
  // 目录树内搜索：本地受控输入 + 防抖 350ms 重渲染（避免每次按键全量重画）
  const [dirSearchInput, setDirSearchInput] = useState(() => useEditorStore.getState().directorySearch);
  const dirSearchTimer = useRef<number | null>(null);
  const applyDirSearch = useCallback(async (v: string) => {
    const st = useEditorStore.getState();
    st.setDirectorySearch(v);
    switchToDirSortView();
    const sid = useSceneStore.getState().activeSceneId;
    if (sid) await rerenderDirectoryTree(sid);
    // ─── 目录树搜索 → 画布联动（与 ComponentCenterPanel 搜索框选同源）───
    // 左侧目录树搜 "auth"，右侧画布同步点亮所有名字/路径含 auth 的实体并框进视野，
    // 面板与画布共享同一份分析数据，而不是各看各的。
    const q = v.trim();
    if (!q) {
      // 清空搜索：还原画布全览（不残留选中高亮）
      useEditorStore.getState().requestFit();
      return;
    }
    const n = highlightInCanvasByText(q);
    if (n === 0) {
      const synced = useEditorStore.getState().components.length > 0;
      useToastStore
        .getState()
        .showToast(synced ? t('editor.searchNoMatch', { q }) : t('editor.searchUnsynced'), 'warning');
    }
    // 命中 > 0 时静默高亮（连续输入避免 toast 刷屏，画布高亮已是反馈）
  }, []);
  const onDirSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDirSearchInput(v);
    if (dirSearchTimer.current) window.clearTimeout(dirSearchTimer.current);
    dirSearchTimer.current = window.setTimeout(() => {
      void applyDirSearch(v);
    }, 350);
  };
  const clearDirSearch = () => {
    setDirSearchInput('');
    if (dirSearchTimer.current) window.clearTimeout(dirSearchTimer.current);
    void applyDirSearch('');
  };

  // v2.17 依赖画像视图：布局模式切换（聚簇/分层）只在此视图出现
  const depViewLabel = t('editorPage.portrait.dependency.label');
  const depViewName = activeViewName ?? '';
  const isDepView = depViewName === depViewLabel || depViewName.startsWith(`${depViewLabel} `);
  const depLayoutMode = useEditorStore((s2) => s2.depLayoutMode);
  const depFilter = useEditorStore((s2) => s2.depFilter);
  const depFocusFileId = useEditorStore((s2) => s2.depFocusFileId);
  const depFocusFile = useProjectStore((s) => s.files.find((f) => f.id === depFocusFileId));
  // v2.28 重构四象限聚焦象限（会话态）：非空=用户点击了画布象限标签，该象限文件高亮、其余淡化
  const quadrantFocusZone = useEditorStore((s2) => s2.quadrantFocusZone);
  // v2.17 依赖画像布局模式切换：聚簇 ↔ 分层，切换后重跑依赖画像（保留当前焦点高亮）
  const switchDepLayout = useCallback((mode: 'force' | 'layered') => {
    useEditorStore.getState().setDepLayoutMode(mode);
    const sid = useSceneStore.getState().activeSceneId;
    if (sid) {
      const focus = useEditorStore.getState().depFocusFileId ?? undefined;
      void runPortrait('dependency', sid, focus ? { focusFileId: focus } : undefined).then((res) =>
        useToastStore.getState().showToast(res.message, res.severity),
      );
    }
  }, []);
  // v2.17 依赖画像焦点复位：返回 top-90 全局总览（清空焦点文件）
  const resetDepFocus = useCallback(() => {
    const sid = useSceneStore.getState().activeSceneId;
    useEditorStore.getState().setDepFocusFileId(null);
    if (sid) {
      void runPortrait('dependency', sid).then((res) => useToastStore.getState().showToast(res.message, res.severity));
    }
  }, []);
  const DIR_SORT_ORDER = ['size', 'name', 'path'] as const;
  const DIR_SORT_LABEL: Record<string, string> = {
    size: t('editor.dirSortSize'),
    name: t('editor.dirSortName'),
    path: t('editor.dirSortPath'),
  };
  // 目录排序视图的 name 存 **key**（而非 t() 译文），使「查找/复用/判断」与语言无关；
  // tab 标签渲染侧用 resolveFragments 解引用显示当前语言。
  const DIR_SORT_VIEW_KEY = 'editor.dirSortView';
  const DIR_SORT_VIEW_NAME = t('editor.dirSortView');
  /** 取或建「目录排序」专用视图：复用同名视图，绝不覆盖默认目录树视图 */
  const getOrCreateDirSortView = (): string => {
    const editor = useEditorStore.getState();
    // 兼容 key 与历史版本存的中文译文（语言切换前创建的旧视图）
    const existing = editor.views.find((v) => v.name === DIR_SORT_VIEW_KEY || v.name === DIR_SORT_VIEW_NAME);
    if (existing) return existing.id;
    return editor.addView(DIR_SORT_VIEW_KEY);
  };
  /** 切到「目录排序」视图（无则创建），让排序/搜索/显隐文件结果渲染到独立视图 */
  const switchToDirSortView = () => {
    const id = getOrCreateDirSortView();
    const st = useEditorStore.getState();
    if (st.activeViewId !== id) st.switchView(id);
  };
  /** 当前是否处于目录类视图（默认目录树 或 独立排序视图）—— 决定目录工具栏可见性 */
  const isDirectoryView =
    activeViewId === 'default' || activeViewName === DIR_SORT_VIEW_KEY || activeViewName === DIR_SORT_VIEW_NAME;
  const cycleDirSort = async () => {
    const st = useEditorStore.getState();
    const cur = st.directorySort;
    const next = DIR_SORT_ORDER[(DIR_SORT_ORDER.indexOf(cur) + 1) % DIR_SORT_ORDER.length];
    st.setDirectorySort(next);
    switchToDirSortView();
    const sid = useSceneStore.getState().activeSceneId;
    if (sid) {
      const out = await rerenderDirectoryTree(sid);
      useToastStore
        .getState()
        .showToast(
          out.ok ? t('editor.dirSortToast', { label: DIR_SORT_LABEL[next] }) : out.message,
          out.ok ? 'success' : 'warning',
        );
    }
  };
  const activeScene = useMemo(() => scenes.find((s) => s.id === activeSceneId) ?? null, [scenes, activeSceneId]);
  // 书场景（novel-zh）→ 右栏整体切到写作向 Tabs（要素 / 属性 / AI），代码向 Tabs 不渲染
  const isBookScene = activeScene?.primaryLanguage === 'novel-zh';
  // 右栏「要素」检视器要读书的业务数据（章节/节拍/设定）→ 从场景 projectRoot 取 bookId。
  // 必须是渲染期可响应的派生值（parseBookIdFromScene 是命令式取 store，不进渲染依赖）。
  const activeBookId = useMemo(() => {
    const root = activeScene?.projectRoot ?? '';
    return root.startsWith('writing://') ? root.replace(/^writing:\/\//, '').replace(/\/+$/, '') : '';
  }, [activeScene?.projectRoot]);

  // ───────────────────── v2.18 变更耦合工具栏三件套 ─────────────────────
  // 与 v2.17 依赖画像工具栏同形态（filter / window / focus），但语义对齐到「时间维度耦合」：
  // - filter   ：前端切片（不动 DB），瞬间重画
  // - window   ：UI 切时窗会触发 store.analyzeChangeCoupling 真重扫 → 入库 → 重画
  // - focus    ：树驱动 1-跳子图（B3 详细实施，B1 先把 state 位与 UI 占位占好）
  const couplingViewLabel = t('editorPage.portrait.changeCoupling.label');
  const couplingViewName = activeViewName ?? '';
  const isCouplingView = couplingViewName === couplingViewLabel || couplingViewName.startsWith(`${couplingViewLabel} `);
  const couplingFilter = useEditorStore((s2) => s2.couplingFilter);
  const couplingWindowDays = useEditorStore((s2) => s2.couplingWindowDays);
  const couplingFocusFileId = useEditorStore((s2) => s2.couplingFocusFileId);
  const couplingLayoutMode = useEditorStore((s2) => s2.couplingLayoutMode);
  const couplingFocusFile = useProjectStore((s) => s.files.find((f) => f.id === couplingFocusFileId));

  /** v2.18 切 layout：force ↔ cluster（前端切片，瞬间重画，不动 DB） */
  const handleCouplingLayout = useCallback((mode: 'force' | 'cluster') => {
    useEditorStore.getState().setCouplingLayoutMode(mode);
    const sid = useSceneStore.getState().activeSceneId;
    if (sid) {
      void runPortrait('changeCoupling', sid).then((res) =>
        useToastStore.getState().showToast(res.message, res.severity),
      );
    }
  }, []);

  /** 切 filter：纯前端切片，store 落字段 + 立刻重画当前耦合视图（不动 DB） */
  const handleCouplingFilter = useCallback((f: 'all' | 'hidden' | 'highRisk' | 'crossModule') => {
    useEditorStore.getState().setCouplingFilter(f);
    const sid = useSceneStore.getState().activeSceneId;
    if (sid) {
      void runPortrait('changeCoupling', sid).then((res) =>
        useToastStore.getState().showToast(res.message, res.severity),
      );
    }
  }, []);

  /**
   * 切时窗：UI 切 → 调 store.analyzeChangeCoupling 真重扫 → 入库 → 重画当前耦合视图。
   * 之所以必须真重扫而不是前端切片：
   * - 时窗本质是 git 历史窗口（`git log --since=N days ago`），后端按过滤后的提交列表重算共变
   * - 前端拿到的是"已落库的 pairs"，没办法从"全量 pairs"还原出"近 90 天的 pairs"（lastCoChangeAt
   *   只是「最后一次共变时间」，不是「每次共变时间」）
   * - 由 store action 一站式处理 invoke + setStore + runPortrait，避免 SceneEditor 持有 projectRoot 副本
   * 「全量」=不传 sinceDays，落到 store/wrapper 默认 365 天窗口。
   *   历史遗留：当前 store default `?? 365`，意味着「全量」按钮实际为 365 天窗口。
   *   这是与后端契约现状的非侵入妥协；切到真全量需另起一轮改 store/wrapper 默认值（涉及分析流水线默认行为）。
   */
  const handleCouplingWindow = useCallback(
    (days: number | null) => {
      useEditorStore.getState().setCouplingWindowDays(days);
      const sid = useSceneStore.getState().activeSceneId;
      if (!sid) return;
      const projectRoot = activeScene?.projectRoot ?? '';
      if (!projectRoot) {
        // 罕见：scene 还没有 projectRoot（新建 scene 未扫描过）。静默返回即可，
        // 工具栏仍可见方便后续 retry；切时窗是最直接的「先扫描」触发器
        return;
      }
      void (async () => {
        try {
          // v2.18 默认值修复：让 null（=点「全量」按钮）= 真全量透传到后端；
          // 之前 ?? 365 把 null 偷偷变 365 天窗口。现在 store + wrapper 都 `?? null`，三层一致。
          await useProjectStore.getState().analyzeChangeCoupling(sid, projectRoot, days);
          const out = await runPortrait('changeCoupling', sid);
          useToastStore.getState().showToast(out.message, out.severity);
        } catch (e) {
          useToastStore.getState().showToast(String(e), 'warning');
        }
      })();
    },
    [activeScene],
  );

  /** 焦点复位（B3 详细实施，B1 仅占位） */
  const resetCouplingFocus = useCallback(() => {
    const sid = useSceneStore.getState().activeSceneId;
    useEditorStore.getState().setCouplingFocusFileId(null);
    if (sid) {
      void runPortrait('changeCoupling', sid).then((res) =>
        useToastStore.getState().showToast(res.message, res.severity),
      );
    }
  }, []);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const removeComponent = useEditorStore((s) => s.removeComponent);
  const selectedIds = useEditorStore((s) => s.selection.selectedIds);
  const selectedSettingId = useEditorStore((s) => s.selectedSettingId);
  const writingSettings = useWritingStore((s) => s.settings);
  const writingBooks = useWritingStore((s) => s.books);
  const selectedComponent = useMemo(() => {
    const sid = selectedIds[0];
    if (!sid) return null;
    const comp = useEditorStore.getState().components.find((c) => c.id === sid);
    return comp ? { id: comp.id, type: comp.type, name: comp.name, config: comp.config } : null;
  }, [selectedIds]);
  // 写作设定项选中（人物/世界观，由 CastPane「查看要素」驱动，与画布选择互斥）
  const selectedSetting = useMemo(() => {
    if (!selectedSettingId) return null;
    return writingSettings.find((s) => s.id === selectedSettingId) ?? null;
  }, [selectedSettingId, writingSettings]);
  // 时间线事件选中（时间线视图，由 EventChip / 右栏总览卡驱动；三者互斥见 selectTimelineEvent）
  const selectedTimelineEventId = useEditorStore((s) => s.selectedTimelineEventId);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const selectedTimelineEvent = useMemo(() => {
    if (!selectedTimelineEventId) return null;
    return timelineEvents.find((e) => e.id === selectedTimelineEventId) ?? null;
  }, [selectedTimelineEventId, timelineEvents]);
  const storylines = useWritingStore((s) => s.storylines);
  const selectedStorylineId = useEditorStore((s) => s.selectedStorylineId);
  const selectedStoryline = useMemo(() => {
    if (!selectedStorylineId) return null;
    return storylines.find((sl) => sl.id === selectedStorylineId) ?? null;
  }, [selectedStorylineId, storylines]);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  // 底部状态栏（书场景=写作域速览，2026-09-19 拍板改造）：章节/总字数/伏笔待回收。
  // 数据全在 writingStore 域（books/chapters/storylines/foreshadowings），零新读盘。
  const writingChapters = useWritingStore((s) => s.chapters);
  const totalWords = useMemo(() => writingChapters.reduce((a, c) => a + (c.wordCount || 0), 0), [writingChapters]);
  const pendingForeshadowCount = useMemo(
    () => foreshadowings.filter((f) => f.status === 'pending').length,
    [foreshadowings],
  );
  const selectedForeshadowingId = useEditorStore((s) => s.selectedForeshadowingId);
  const selectedForeshadowing = useMemo(() => {
    if (!selectedForeshadowingId) return null;
    return foreshadowings.find((f) => f.id === selectedForeshadowingId) ?? null;
  }, [selectedForeshadowingId, foreshadowings]);
  const outlines = useWritingStore((s) => s.outlines);
  const selectedInspirationId = useEditorStore((s) => s.selectedInspirationId);
  const selectedInspiration = useMemo(() => {
    if (!selectedInspirationId) return null;
    return outlines.find((o) => o.id === selectedInspirationId) ?? null;
  }, [selectedInspirationId, outlines]);
  // 大纲章选中（大纲视图 NodeRow 点章节行驱动；与画布/设定/事件/剧情线/伏笔/灵感互斥，
  // 右栏「属性」tab 展示该章详情卡，形态同书封面卡）
  const selectedChapterId = useEditorStore((s) => s.selectedChapterId);
  const selectedChapter = useMemo(() => {
    if (!selectedChapterId) return null;
    return writingChapters.find((c) => c.id === selectedChapterId) ?? null;
  }, [selectedChapterId, writingChapters]);
  // AI 助手随左栏题材 tab 切换角色：把当前书 + 题材 + 选中设定项灌给 AI 面板（书场景才有意义）
  const aiBookTopic:
    | 'characters'
    | 'worldview'
    | 'catalog'
    | 'timeline'
    | 'storylines'
    | 'foreshadowing'
    | 'inspiration'
    | 'proofread'
    | 'stats'
    | 'writing'
    | 'overview'
    | null = isBookScene
    ? activeViewKind === 'characters'
      ? 'characters'
      : activeViewKind === 'worldview'
        ? 'worldview'
        : activeViewKind === 'catalog'
          ? 'catalog'
          : activeViewKind === 'timeline'
            ? 'timeline'
            : activeViewKind === 'storylines'
              ? 'storylines'
              : activeViewKind === 'foreshadowing'
                ? 'foreshadowing'
                : activeViewKind === 'inspiration'
                  ? 'inspiration'
                  : activeViewKind === 'proofread'
                    ? 'proofread'
                    : activeViewKind === 'stats'
                      ? 'stats'
                      : activeViewKind === 'writing'
                        ? 'writing'
                        : activeViewKind === 'overview'
                          ? 'overview'
                          : null
    : null;
  const aiBookTitle = isBookScene ? (writingBooks.find((b) => b.id === activeBookId)?.title ?? null) : null;
  const aiFocusSetting =
    isBookScene && selectedSetting
      ? {
          name: selectedSetting.name,
          kind: selectedSetting.kind as 'character' | 'worldbuilding',
          setting: selectedSetting,
        }
      : null;
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLen = useEditorStore((s) => s.history.length);
  const canUndoVal = historyIndex >= 0;
  const canRedoVal = historyIndex < historyLen - 1;
  const loadSceneWithViews = useEditorStore((s) => s.loadSceneWithViews);
  const clearScene = useEditorStore((s) => s.clearScene);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);

  // 右侧面板 tab 切换
  const aiPanelRequest = useEditorStore((s) => s.aiPanelRequest);
  const [rightTab, setRightTab] = useState(0);
  // AI 助手并入右侧 tab 体系，与代码工作台 dock 的「AI 助手」tab 一致；
  // 不再另开独立浮层，避免分析器页面右侧同时出现「分析 tab 面板 + AI 浮层」两个面板。
  // 书场景右栏已收敛为 3 栏：组件 / 属性 / AI（人物·设定·关系·大纲四栏撤除，它们把 L2 的
  // 题材分类又铺了一遍）；代码场景维持 6 栏。两侧栏序各自连续，不在同一套索引里混。
  const AI_TAB = isBookScene ? 2 : 5;
  // 渲染期夹紧：跨场景类型切换（本组件不重挂载）的第一帧，value 必须命中存在的子 Tab，
  // 否则 MUI 报 invalid value、指示条乱跑、内容栏空白一帧（复位 effect 只归一状态救不了那帧）。
  const safeRightTab = clampRightTab(rightTab, isBookScene);
  // 场景类型切换 → 右栏回第一栏。两侧栏数与语义都不同（代码场景第 3 栏是「分层」，
  // 书场景第 3 栏是 AI），沿用旧索引会落到语义不相干的栏位甚至渲染出空面板（静默空白）。
  useEffect(() => {
    setRightTab(0);
  }, [isBookScene]);
  // 「从分析点发起 AI 诊断」/「打开助手」→ 切到右侧 AI tab（而非弹出独立右栏）。
  useEffect(() => {
    if (aiPanelRequest > 0) {
      setRightTab(AI_TAB);
      setRightPanelOpen(true);
    }
  }, [aiPanelRequest]);
  // 右栏联动（书场景）：在画布上选中任意实体 → 自动切到「属性/详情」栏（第 2 栏）。
  // 第 1 栏「组件」是拖源，拖出落卡后会立刻选中新卡；不联动的话「选不中、改不了」的
  // 观感会回来。只在**当前停在组件栏**时切，用户手动停在别的栏位时不抢。
  // ⚠ 第十四轮修正旧条件 `type.startsWith('writing-')`：书场景画布不只有写作卡——
  // 插画链路（H2：素材库选图）会在画布落 image 实体。旧条件对 image 直接早退不切栏，
  // 而「要素」栏对非写作实体渲染的是 WritingInspectorPanel（读章/人物/设定，对插画全是
  // 空字段）——用户选中一张插画后右栏停在无关的全书要素概览、看不到插画画像；
  // 真正渲染插画（预览 / 替换图源 / 尺寸）的 EntityPortraitPanel 在「详情」栏 fallback。
  // 放宽为「任意选中实体都切详情栏」：写作实体行为不变（原本就 0→1），
  // 仅补上 image/asset 等实体 → 详情栏（EntityPortraitPanel），断链就此接通。
  useEffect(() => {
    if (!isBookScene) return;
    if (!selectedComponent) return;
    setRightTab((cur) => (cur === 0 ? 1 : cur));
  }, [isBookScene, selectedComponent?.id, selectedComponent?.type]);
  // 写作设定项选中（人物/世界观，由 CastPane「查看详情」驱动）→ 切到「详情」栏（第 2 栏）
  // 让其叙事性描述面板可见；与画布选中互斥，二者不会同时成立。
  useEffect(() => {
    if (!isBookScene) return;
    if (!selectedSetting) return;
    setRightTab(1);
  }, [isBookScene, selectedSetting?.id]);
  // 切书（L1 页签）→ 清空写作设定项选中态，避免跨书残留幽灵选中。
  useEffect(() => {
    if (selectedSettingId) {
      useEditorStore.getState().selectSetting(null);
    }
    // 时间线事件选中同理：切书即清，避免跨书残留
    if (useEditorStore.getState().selectedTimelineEventId) {
      useEditorStore.getState().selectTimelineEvent(null);
    }
    // 剧情线选中同理：切书即清
    if (useEditorStore.getState().selectedStorylineId) {
      useEditorStore.getState().selectStoryline(null);
    }
    // 伏笔选中同理：切书即清
    if (useEditorStore.getState().selectedForeshadowingId) {
      useEditorStore.getState().selectForeshadowing(null);
    }
    // 灵感念头选中同理：切书即清
    if (useEditorStore.getState().selectedInspirationId) {
      useEditorStore.getState().selectInspiration(null);
    }
    // 大纲章选中同理：切书即清
    if (useEditorStore.getState().selectedChapterId) {
      useEditorStore.getState().selectChapter(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBookId]);
  // 书场景初始化默认视图（2026-09-19 拍板）：工作室打开/切书默认指向「大纲」页签。
  // 约束：①没有作品（activeBookId 为空）不建任何作品级页签——中间区域只有 L1 顶级
  // 页签 + 画布「拖载体入画布」提示，拖载体建书后才出现对应 tabs；
  // ②每本书只初始化一次（ref 按书 id 记账）——用户删光 L2 页签后不复活。
  const bookViewsReady = useEditorStore((s) => s.views.length > 0);
  const catalogInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isBookScene || !bookViewsReady || !activeBookId) return;
    if (catalogInitRef.current === activeBookId) return;
    catalogInitRef.current = activeBookId;
    const es = useEditorStore.getState();
    const hit = es.views.find((v) => v.kind === 'catalog');
    if (hit) {
      if (es.activeViewId !== hit.id) es.switchView(hit.id);
      return;
    }
    const genre = useWritingStore.getState().books.find((b) => b.id === activeBookId)?.genre ?? '';
    openTypedCarrierView(genre, 'catalog');
  }, [isBookScene, activeBookId, bookViewsReady]);
  // 左栏题材 tab 联动（Direction A+）：切到「人物 / 世界观」题材视图时，右栏自动落回
  // 「要素 / 人物」tab（第 1 栏），让两侧同步进入人物模式。同时清掉可能残留的其它类别
  // 选中，避免右栏标签（人物/设定）与当前题材模式不一致（例如带着一个角色误显示成「设定」）。
  // 切到其它题材视图（大纲等）不强制切栏，但同样清残留选中，保持右栏与模式一致。
  useEffect(() => {
    if (!isBookScene) return;
    if (selectedSettingId) useEditorStore.getState().selectSetting(null);
    // 时间线事件选中：**离开**时间线视图才清残留（离场清空）；切入时间线视图不清——
    // 章右栏「本章时间线」行是先选中再跳视图，此处清了会把跳转带过来的选中打掉。
    if (activeViewKind !== 'timeline' && useEditorStore.getState().selectedTimelineEventId) {
      useEditorStore.getState().selectTimelineEvent(null);
    }
    // 剧情线选中：同样仅离场清（切入时间线视图不清——主线栏点线名是先选中再跳）
    if (activeViewKind !== 'timeline' && useEditorStore.getState().selectedStorylineId) {
      useEditorStore.getState().selectStoryline(null);
    }
    // 伏笔选中：仅离开伏笔视图才清（切入伏笔视图不清——章右栏行是先选中再跳）
    if (activeViewKind !== 'foreshadowing' && useEditorStore.getState().selectedForeshadowingId) {
      useEditorStore.getState().selectForeshadowing(null);
    }
    // 灵感念头选中：仅离开灵感视图才清（切入灵感视图不清——总览卡点行是先选中再看详情）
    if (activeViewKind !== 'inspiration' && useEditorStore.getState().selectedInspirationId) {
      useEditorStore.getState().selectInspiration(null);
    }
    // 大纲章选中：仅离开大纲视图才清（切入大纲视图不清——点章节行即锚点，右栏要保留）
    if (activeViewKind !== 'catalog' && useEditorStore.getState().selectedChapterId) {
      useEditorStore.getState().selectChapter(null);
    }
    if (activeViewKind === 'characters' || activeViewKind === 'worldview') {
      setRightTab(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBookScene, activeViewKind]);
  // 选中时间线事件 → 切到「详情」栏（第 2 栏）让其编辑器可见（与设定选中同构）
  useEffect(() => {
    if (!isBookScene) return;
    if (selectedTimelineEventId) setRightTab(1);
  }, [isBookScene, selectedTimelineEventId]);
  // 选中剧情线 → 右栏详情（线实体编辑器）
  useEffect(() => {
    if (!isBookScene) return;
    if (selectedStorylineId) setRightTab(1);
  }, [isBookScene, selectedStorylineId]);
  // 选中伏笔 → 右栏详情（伏笔编辑器）
  useEffect(() => {
    if (!isBookScene) return;
    if (selectedForeshadowingId) setRightTab(1);
  }, [isBookScene, selectedForeshadowingId]);
  // 选中灵感念头 / 大纲章 → 右栏详情（编辑与分发器 / 章详情卡：封面可设换/清除 + 章信息，锚点即选中）。
  // 两类选中互斥（selectInspiration / selectChapter 各自清对方），同 effect 处理不新增 set-state-in-effect 告警。
  useEffect(() => {
    if (!isBookScene) return;
    if (selectedInspirationId || selectedChapterId) setRightTab(1);
  }, [isBookScene, selectedInspirationId, selectedChapterId]);
  // 右栏折叠态跨会话记忆（与宽度同一口径）：创作者把右栏收起获得更大画布，
  // 此前每次重开工作室又自动展开，得重新点一次收起条。
  const [rightPanelOpen, setRightPanelOpen] = useState(readSavedStudioRightPanelOpen);
  // ─── 右侧面板可拖拽宽度（v2.5 / 第十四轮持久化 + 守卫）───
  // null = 未自定义（统一默认 300）；拖拽后记住自定义值，切换 tab 不重置、也不因 tab 变宽，
  // 保持右栏风格一致（此前 AI tab 特殊给 400，切到 AI 时右栏会跳宽，破坏一致性）。clamp 240~720 防拖到不可用。
  // 拖拽宽度落 localStorage：与写作台左栏/抽屉同一范式，创作者调好的工作区布局重启不丢。
  const [rightPanelWidth, setRightPanelWidth] = useState<number | null>(readSavedStudioRightPanelWidth);
  const currentRightWidth = rightPanelWidth ?? STUDIO_RIGHT_DEFAULT;
  // 拖拽会话用 ref 记账 + state 触发 effect 挂 window 监听（与写作台左栏同范式）：
  // 旧实现 imperative 在 mousedown 里 addEventListener、只在 onUp 里 remove + 复位 body 样式——
  // **拖到中途**收起右栏 / 切场景 / 切书时手柄随分支卸载，imperative 监听与 body 样式脱管，
  // cursor/userSelect 卡死、整页文字选不中（第十一轮写作台同型病灶在工作室复现）。
  // 改由 useEffect(rightDragging) 统一挂载/摘除 window 监听 + 收尾还原，卸载即 cleanup，绝无残留。
  const rightDragStartRef = useRef<{ x: number; w: number } | null>(null);
  const [rightDragging, setRightDragging] = useState(false);
  const { begin: beginBodyDrag, release: releaseBodyDrag } = useDragBodyGuard();
  const startRightResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rightDragStartRef.current = { x: e.clientX, w: currentRightWidth };
    setRightDragging(true);
    beginBodyDrag();
  }, [currentRightWidth, beginBodyDrag]);
  useEffect(() => {
    if (!rightDragging) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const s = rightDragStartRef.current;
      if (!s) return;
      const w = s.w + (s.x - ev.clientX); // 手柄在右栏左侧：往左拖变宽
      setRightPanelWidth(Math.min(STUDIO_RIGHT_MAX, Math.max(STUDIO_RIGHT_MIN, Math.round(w))));
    };
    const onUp = () => {
      rightDragStartRef.current = null;
      setRightDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      releaseBodyDrag();
    };
  }, [rightDragging, releaseBodyDrag]);
  // 拖宽结束后落盘（拖拽期间每帧写 localStorage 会抖动，松手即 end 时一次性写）；
  // 复位（双击）走同一路径：rightDragging 转 false 且宽度已变即写当前值。
  useEffect(() => {
    if (rightDragging) return;
    if (rightPanelWidth == null) return;
    try {
      localStorage.setItem(STUDIO_RIGHT_WIDTH_KEY, String(rightPanelWidth));
    } catch {
      // 存储不可写（隐私模式等）：本次会话内宽度仍生效，不再重试
    }
  }, [rightDragging, rightPanelWidth]);
  const persistRightPanelOpen = useCallback((open: boolean) => {
    setRightPanelOpen(open);
    try {
      localStorage.setItem(STUDIO_RIGHT_OPEN_KEY, open ? '1' : '0');
    } catch {
      // 忽略
    }
  }, []);
  /** 双击手柄：宽度一键复位为默认值（误拖后快速回到原始布局），并记忆偏好 */
  const onRightResizeReset = useCallback(() => {
    rightDragStartRef.current = null;
    setRightDragging(false);
    setRightPanelWidth(STUDIO_RIGHT_DEFAULT);
    try {
      localStorage.setItem(STUDIO_RIGHT_WIDTH_KEY, String(STUDIO_RIGHT_DEFAULT));
    } catch {
      // 忽略
    }
  }, []);

  // 主窗口 AI 面板的「当前文件」：取自选中的画布实体背后的源文件（路径来自 files 表，后端守门才收）。
  // 与 ProjectCanvas 内的 selectedFileForAi 同源（都从 editorStore 的选中实体反查），但各自订阅，互不依赖。
  // 没有选中实体时为 null —— 此时 AI 面板仍可自由对话，只是没有文件/选区上下文芯片。
  const aiSelectedFilePath = useEditorStore((s) => {
    const id = s.selection.selectedIds[0];
    if (!id) return null;
    const comp = s.components.find((c) => c.id === id);
    return (comp?.config?.filePath as string | undefined) ?? null;
  });
  const mainAiFile = useMemo<{
    fileId: string;
    relPath: string;
    language: string | null;
    name: string;
    totalLines?: number;
  } | null>(() => {
    if (!aiSelectedFilePath) return null;
    const f = projectFiles.find((x) => x.relPath === aiSelectedFilePath);
    if (!f) return null;
    return { fileId: f.id, relPath: f.relPath, language: f.language, name: f.name, totalLines: f.lineCount };
  }, [aiSelectedFilePath, projectFiles]);
  // 主窗口没有实时 Monaco 编辑器；传空 ref，WorkbenchAiPanel 会自动从磁盘读原文来 apply（见面板内磁盘兜底）。
  const aiEditorRef = useRef<MonacoEditorHandle | null>(null);
  // 左面板展开/收起（默认展开，与 biosphere 一致）；折叠态跨会话记忆（与右栏同口径）
  const [leftPanelOpen, setLeftPanelOpen] = useState(readSavedStudioLeftPanelOpen);
  const persistLeftPanelOpen = useCallback((open: boolean) => {
    setLeftPanelOpen(open);
    try {
      localStorage.setItem(STUDIO_LEFT_OPEN_KEY, open ? '1' : '0');
    } catch {
      // 忽略
    }
  }, []);
  const toggleLeftPanel = useCallback(() => {
    persistLeftPanelOpen(!leftPanelOpen);
  }, [leftPanelOpen, persistLeftPanelOpen]);
  // ─── 左栏可拖拽宽度（第十四轮，与右栏对称）───
  // 手柄在左栏右缘：向右拖 = 变宽；双击复位；跨会话记忆。
  // 独立 guard 实例（与右栏各一份，并发拖拽互不干扰）。
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(readSavedStudioLeftPanelWidth);
  const leftDragStartRef = useRef<{ x: number; w: number } | null>(null);
  const [leftDragging, setLeftDragging] = useState(false);
  const { begin: beginLeftBodyDrag, release: releaseLeftBodyDrag } = useDragBodyGuard();
  const startLeftResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      leftDragStartRef.current = { x: e.clientX, w: leftPanelWidth };
      setLeftDragging(true);
      beginLeftBodyDrag();
    },
    [leftPanelWidth, beginLeftBodyDrag],
  );
  useEffect(() => {
    if (!leftDragging) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const s = leftDragStartRef.current;
      if (!s) return;
      const w = s.w + (ev.clientX - s.x); // 手柄在左栏右缘：往右拖变宽
      setLeftPanelWidth(Math.min(STUDIO_LEFT_MAX, Math.max(STUDIO_LEFT_MIN, Math.round(w))));
    };
    const onUp = () => {
      leftDragStartRef.current = null;
      setLeftDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      releaseLeftBodyDrag();
    };
  }, [leftDragging, releaseLeftBodyDrag]);
  // 拖宽结束后落盘（拖拽期间不逐帧写，避免 localStorage 抖动）
  useEffect(() => {
    if (leftDragging) return;
    try {
      localStorage.setItem(STUDIO_LEFT_WIDTH_KEY, String(leftPanelWidth));
    } catch {
      // 存储不可写：本次会话内宽度仍生效
    }
  }, [leftDragging, leftPanelWidth]);
  /** 双击手柄：宽度一键复位为默认值（误拖后快速回到原始布局），并记忆偏好 */
  const onLeftResizeReset = useCallback(() => {
    leftDragStartRef.current = null;
    setLeftDragging(false);
    setLeftPanelWidth(STUDIO_LEFT_DEFAULT);
    try {
      localStorage.setItem(STUDIO_LEFT_WIDTH_KEY, String(STUDIO_LEFT_DEFAULT));
    } catch {
      // 忽略
    }
  }, []);

  // 审查统计
  const findingsCount = findings.length;
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;

  const publishScene = useSceneStore((s) => s.publishScene);
  const activeSceneStatus = activeScene?.status;
  const showToast = useToastStore((s) => s.showToast);
  const activeAnalyzer = useActiveAnalyzer();
  const activeAnalyzerIds = useActiveAnalyzerIds();
  const extraAnalyzerCount = Math.max(0, activeAnalyzerIds.length - 1);

  // ─── 键盘快捷键 ───
  // 编辑态整体让位给当前编辑器（与 SceneTabBar L2 键盘切换同一守卫口径）：
  // 画布章节纸面卡(WritingChapterEditor/TipTap)的正文编辑是 contentEditable，
  // 旧守卫只挡 INPUT/TEXTAREA/SELECT，漏了 contentEditable —— 用户在画布卡里
  // 敲退格删字时，若该卡正处于选中态，会被下面的 Backspace 分支 removeComponent
  // **整卡删除**（数据损坏级）；Ctrl+Z 同理被画布 undo 劫持、撤销不了正文。
  // target 自身或任意祖先带 contenteditable 都视为编辑态（兼容 jsdom 与真实 DOM）。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable ||
        Boolean(el.closest?.('[contenteditable]'))
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        selectedIds.forEach((id) => removeComponent(id));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, removeComponent, selectedIds]);

  // ─── 导出分析报告（HTML / JSON / SVG 格式选择，需求 §7.3 报告导出器）───
  const [exportAnchor, setExportAnchor] = useState<null | HTMLElement>(null);
  const handleExport = useCallback(
    async (format: 'html' | 'json' | 'svg') => {
      if (!activeSceneId) return;
      setExportAnchor(null);
      try {
        await publishScene(activeSceneId, format);
        showToast(
          format === 'json'
            ? t('editor.exportJsonOk')
            : format === 'svg'
              ? t('editor.exportSvgOk')
              : t('editor.exportOk'),
          'success',
        );
      } catch {
        showToast(t('editor.exportFail'), 'error');
      }
    },
    [activeSceneId, publishScene, showToast],
  );

  // ─── 手动保存（工具栏保存按钮）───
  const isDirty = useDirtyStore((s) => s.isDirty);
  const markClean = useDirtyStore((s) => s.markClean);
  const handleManualSave = useCallback(async () => {
    if (!activeSceneId) return;
    try {
      const { views, globalComponents, activeViewId } = useEditorStore.getState().exportSceneWithViews();
      await useSceneStore.getState().updateScene(activeSceneId, { views, globalComponents, activeViewId } as any);
      markClean();
      showToast(t('editor.savedOk'), 'success');
    } catch (e) {
      console.error('[SceneEditor] save failed', e);
      showToast(t('editor.saveFail'), 'error');
    }
  }, [activeSceneId, markClean, showToast]);

  // ─── 自动保存（1秒防抖） ───
  // 两处加固：
  // 1. 保存成功才 markClean —— 此前 fire-and-forget 立即标净，API 失败后
  //    脏标已清、不会重试，画布内容就此丢失。
  // 2. 切换场景/卸载时冲刷 pending 保存 —— 此前直接 clearTimeout，
  //    最后 1 秒内的编辑（含刚同步的实体）被丢弃。
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!isDirty || !activeSceneId) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const doSave = () => {
      pendingSaveRef.current = null;
      saveTimeoutRef.current = null;
      const sceneId = activeSceneId;
      const { views, globalComponents, activeViewId } = useEditorStore.getState().exportSceneWithViews();
      useSceneStore
        .getState()
        .updateScene(sceneId, { views, globalComponents, activeViewId } as any)
        .then(() => markClean())
        .catch((e) => {
          // 保持脏标：后续编辑触发的下一轮自动保存 / 手动保存会重试
          console.error('[SceneEditor] autosave failed, keep dirty for retry', e);
        });
    };
    pendingSaveRef.current = doSave;
    saveTimeoutRef.current = setTimeout(doSave, 1000);
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      // 防抖窗口内离开（切换场景/卸载）：立即冲刷，不丢最后 1 秒的编辑。
      // 保存成功后 markClean 触发的清理不会走到这里（doSave 已清空 pendingSaveRef）。
      if (pendingSaveRef.current) pendingSaveRef.current();
    };
  }, [isDirty, activeSceneId, markClean]);

  // ─── 场景切换才重载画布（只依赖 activeSceneId）───
  // 竞态修复：此前依赖 activeScene 对象身份 —— updateScene 每次自动保存都
  // scenes.map 产生新对象 → 本 effect 重跑 → 用持久化快照整体覆盖内存画布。
  // 危险窗口：1s 防抖内 loadScenes 拉回旧快照、或保存失败回滚，刚同步/画像
  // 出来的未落库实体被整体抹掉（观感即「实体渲染不出来」）。
  // 现在编辑器是打开中场景的唯一权威：自动保存乐观更新、列表刷新、改名、发布
  // 等身份变化一律不碰画布，只有真正切换场景才重载。
  useEffect(() => {
    if (!activeSceneId) {
      logger.info('ProjectCanvas', 'reload: no activeSceneId, clearing scene');
      clearScene();
      return;
    }

    const scene = useSceneStore.getState().scenes.find((s) => s.id === activeSceneId) ?? null;
    if (!scene) {
      logger.info('ProjectCanvas', 'reload: scene not found, clearing', { activeSceneId });
      clearScene();
      return;
    }

    logger.info('ProjectCanvas', 'reload: loading scene', {
      activeSceneId,
      sceneName: scene.name,
      viewsCount: scene.views?.length ?? 0,
      globalComponentsCount: scene.globalComponents?.length ?? 0,
      activeViewId: scene.activeViewId,
    });

    if (scene.views && scene.views.length > 0) {
      const activeVId = scene.activeViewId || scene.views[0].id;
      loadSceneWithViews(scene.views, scene.globalComponents || [], activeVId);
      const v = scene.views.find((v) => v.id === activeVId);
      const def = v?.layers.find((l: any) => l.isDefault);
      if (def) setActiveLayer(def.id);
    } else {
      logger.info('ProjectCanvas', 'reload: scene has no views, clearing');
      clearScene();
    }

    // 恢复目录画像视图态（排序/搜索/显隐文件），重载分析后不再回默认
    const dv = scene.directoryView;
    if (dv) {
      const st = useEditorStore.getState();
      if (dv.sort) st.setDirectorySort(dv.sort);
      if (typeof dv.search === 'string') st.setDirectorySearch(dv.search);
      if (typeof dv.showFiles === 'boolean') st.setDirectoryShowFiles(dv.showFiles);
    }
  }, [activeSceneId, loadSceneWithViews, clearScene, setActiveLayer]);

  // ─── 目录画像视图态持久化：三态变化后防抖写回场景，随分析落库 ───
  const dirViewPersistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!activeSceneId) return;
    const scene = useSceneStore.getState().scenes.find((s) => s.id === activeSceneId);
    const next = { sort: directorySort, search: directorySearch, showFiles: directoryShowFiles };
    // 与已落库一致则跳过：避免加载时回灌触发冗余写
    const cur = scene?.directoryView;
    if (cur && cur.sort === next.sort && cur.search === next.search && cur.showFiles === next.showFiles) return;
    // 场景从未记录过目录态且当前就是默认值：无需落库
    const isDefault = next.sort === 'size' && next.search === '' && next.showFiles === false;
    if (!cur && isDefault) return;
    if (dirViewPersistTimer.current) window.clearTimeout(dirViewPersistTimer.current);
    dirViewPersistTimer.current = window.setTimeout(() => {
      useSceneStore.getState().updateScene(activeSceneId, { directoryView: next });
    }, 400);
    return () => {
      if (dirViewPersistTimer.current) window.clearTimeout(dirViewPersistTimer.current);
    };
  }, [directorySort, directorySearch, directoryShowFiles, activeSceneId]);

  // ─── 打开分析时按项目主语言自动激活分析器插件（无需手动选择）───
  // 同时把插件声明的规则同步到后端规则引擎（§4.2 RuleRegistry ↔ 引擎 深度联动）
  useEffect(() => {
    if (activeScene?.primaryLanguage) {
      activateAnalyzerForLanguage(activeScene.primaryLanguage);
      syncPluginRulesToBackend(activeScene.primaryLanguage).then((added) => {
        if (added > 0) {
          // 新增了规则，刷新规则列表让 UI（审查结果面板等）感知
          useProjectStore.getState().loadRules();
        }
      });
    }
  }, [activeScene?.primaryLanguage]);

  if (!activeSceneId) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <Typography variant="body1" color="text.secondary">
          {t('editor.noAnalysis')}
        </Typography>
      </Box>
    );
  }

  // ─── P0 合并顶部行（书场景专用）─────────────────────────────────
  // 书场景顶部此前是「作品头 + 36px 全宽顶栏 + L1 30px + L2 34px」三层半：
  // 36px 顶栏在书场景只渲染 undo/redo/save + 左栏开关 + 导出，中间大片空白，
  // 整行是纯浪费 —— 把动作组下沉到 L2 行右侧插槽（SceneTabBar bookToolbar），
  // 36px 全宽顶栏在书场景整行隐藏，画布多出一行。非书场景动作留在原顶栏。
  // 与 SceneTabBar 共用 isBookScene 同一判定（primaryLanguage === 'novel-zh'），
  // 保证「书场景必走插槽、代码场景必走原顶栏」，两个场景互不串线。
  const bookToolbarActions = isBookScene ? (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        flexShrink: 0,
        px: 0.5,
        borderLeft: 1,
        borderColor: 'divider',
        ml: 0.5,
      }}
    >
      <Tooltip title={t('editor.undo')}>
        <span>
          <IconButton
            size="small"
            onClick={undo}
            disabled={!canUndoVal}
            sx={{ opacity: canUndoVal ? 1 : 0.35 }}
            aria-label={t('editor.undo')}
          >
            <UndoIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('editor.redo')}>
        <span>
          <IconButton
            size="small"
            onClick={redo}
            disabled={!canRedoVal}
            sx={{ opacity: canRedoVal ? 1 : 0.35 }}
            aria-label={t('editor.redo')}
          >
            <RedoIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('editor.save')}>
        <IconButton
          size="small"
          onClick={handleManualSave}
          color={isDirty ? 'primary' : 'default'}
          aria-label={t('editor.save')}
        >
          <SaveIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 18 }} />
      <Tooltip title={leftPanelOpen ? t('editor.collapseLeft') : t('editor.expandLeft')}>
        <IconButton
          size="small"
          onClick={toggleLeftPanel}
          sx={{
            backgroundColor: leftPanelOpen ? 'action.selected' : 'transparent',
          }}
          aria-label={leftPanelOpen ? t('editor.collapseLeft') : t('editor.expandLeft')}
        >
          <WidgetsIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={activeSceneStatus === 'published' ? t('editor.published') : t('editor.exportReport')}>
        <span>
          <IconButton
            size="small"
            onClick={(e) => setExportAnchor(e.currentTarget)}
            color={activeSceneStatus === 'published' ? 'success' : 'default'}
            disabled={activeSceneStatus === 'published'}
            sx={{ opacity: activeSceneStatus === 'published' ? 0.5 : 1 }}
            aria-label={activeSceneStatus === 'published' ? t('editor.published') : t('editor.exportReport')}
          >
            <FileDownloadIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </span>
      </Tooltip>
      {/* 导出格式选择菜单（锚定上面的导出按钮，语义与代码场景顶栏同一套） */}
      <Menu
        anchorEl={exportAnchor}
        open={Boolean(exportAnchor)}
        onClose={() => setExportAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem dense onClick={() => handleExport('html')}>
          <ListItemIcon>
            <DescriptionOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('editor.htmlReport')} secondary={t('editor.htmlReportDesc')} />
        </MenuItem>
        <MenuItem dense onClick={() => handleExport('json')}>
          <ListItemIcon>
            <CodeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('editor.jsonReport')} secondary={t('editor.jsonReportDesc')} />
        </MenuItem>
        <MenuItem dense onClick={() => handleExport('svg')}>
          <ListItemIcon>
            <SchemaOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('editor.svgReport')} secondary={t('editor.svgReportDesc')} />
        </MenuItem>
      </Menu>
    </Box>
  ) : null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* 顶部工具栏（单行 36px，与 biosphere 一致）。
          书场景整行隐藏（P0 合并顶部行）：动作组已下沉 L2 行右侧 bookToolbarActions，
          这里只剩代码场景才用的依赖/耦合/目录控件 —— 书场景 render 它们全是空块。 */}
      {!isBookScene && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            flexShrink: 0,
            borderBottom: 1,
            borderColor: 'divider',
            backgroundColor: (t) =>
              t.palette.mode === 'dark' ? 'rgba(18, 18, 24, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            gap: 0.5,
            height: 36,
            position: 'relative',
            zIndex: 100,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Tooltip title={t('editor.undo')}>
              <span>
                <IconButton
                  size="small"
                  onClick={undo}
                  disabled={!canUndoVal}
                  sx={{ opacity: canUndoVal ? 1 : 0.35 }}
                  aria-label={t('editor.undo')}
                >
                  <UndoIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('editor.redo')}>
              <span>
                <IconButton
                  size="small"
                  onClick={redo}
                  disabled={!canRedoVal}
                  sx={{ opacity: canRedoVal ? 1 : 0.35 }}
                  aria-label={t('editor.redo')}
                >
                  <RedoIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('editor.save')}>
              <IconButton
                size="small"
                onClick={handleManualSave}
                color={isDirty ? 'primary' : 'default'}
                aria-label={t('editor.save')}
              >
                <SaveIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {/* 分析器插件切换器（PluginSelector）已随代码分析收口移除：
            唯一分析器是 writing-analyzer，「多语言切换 + 语言聚焦」无对象可切，
            顶栏只剩误导性说明文案 */}

          {/* v2.17 依赖画像布局模式：力导向聚簇 / 拓扑分层（入口→底座） */}
          {isDepView && (
            <>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={depLayoutMode}
                onChange={(_e, v) => {
                  if (v === 'layered' || v === 'force') switchDepLayout(v);
                }}
                sx={{ '& .MuiToggleButton-root': { height: 26, fontSize: 11, px: 1, textTransform: 'none' } }}
              >
                <ToggleButton value="force">{t('editor.depLayoutForce')}</ToggleButton>
                <ToggleButton value="layered">{t('editor.depLayoutLayered')}</ToggleButton>
              </ToggleButtonGroup>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
              {/* v2.17 依赖画像筛选镜：全部 / 仅循环依赖 / 仅跨模块边（淡化其余实体） */}
              <ToggleButtonGroup
                size="small"
                exclusive
                value={depFilter}
                onChange={(_e, v) => {
                  if (v === 'all' || v === 'cycles' || v === 'crossModule') {
                    useEditorStore.getState().setDepFilter(v);
                  }
                }}
                sx={{ '& .MuiToggleButton-root': { height: 26, fontSize: 11, px: 1, textTransform: 'none' } }}
              >
                <ToggleButton value="all">{t('editor.depFilterAll')}</ToggleButton>
                <ToggleButton value="cycles">{t('editor.depFilterCycles')}</ToggleButton>
                <ToggleButton value="crossModule">{t('editor.depFilterCross')}</ToggleButton>
              </ToggleButtonGroup>
              {/* v2.17 焦点高亮指示 + 复位：点左侧项目树任意文件在全局依赖图中高亮其邻域后，
                这里显示当前焦点文件并提供「返回总览」入口（清空焦点、回到纯 top-90 全局图） */}
              {depFocusFileId && (
                <>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      height: 26,
                      px: 1,
                      borderRadius: 1,
                      bgcolor: 'action.selected',
                      fontSize: 11,
                      maxWidth: 200,
                    }}
                  >
                    <span style={{ color: 'var(--mui-palette-primary-main)', fontWeight: 700 }}>
                      {t('editor.depFocusActive')}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'var(--mui-palette-text-secondary, #64748b)',
                      }}
                    >
                      {depFocusFile?.name ?? ''}
                    </span>
                  </Box>
                  <Tooltip title={t('editor.depFocusResetTip')}>
                    <Button
                      size="small"
                      variant="text"
                      color="primary"
                      onClick={resetDepFocus}
                      sx={{ height: 26, fontSize: 11, textTransform: 'none', minWidth: 0, px: 1 }}
                    >
                      {t('editor.depOverview')}
                    </Button>
                  </Tooltip>
                </>
              )}

              {/* v2.28 重构四象限聚焦指示 + 复位：点击画布象限标签高亮该象限文件后，
                这里显示当前聚焦象限并提供「象限复位」入口（清空聚焦、回到全局散点图） */}
              {quadrantFocusZone && (
                <>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      height: 26,
                      px: 1,
                      borderRadius: 1,
                      bgcolor: 'action.selected',
                      fontSize: 11,
                      maxWidth: 200,
                    }}
                  >
                    <span style={{ color: 'var(--mui-palette-primary-main)', fontWeight: 700 }}>
                      {t('editor.quadFocusActive')}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'var(--mui-palette-text-secondary, #64748b)',
                      }}
                    >
                      {t(`insight.quad.${quadrantFocusZone}`)}
                    </span>
                  </Box>
                  <Tooltip title={t('editor.quadFocusResetTip')}>
                    <Button
                      size="small"
                      variant="text"
                      color="primary"
                      onClick={() => useEditorStore.getState().setQuadrantFocusZone(null)}
                      sx={{ height: 26, fontSize: 11, textTransform: 'none', minWidth: 0, px: 1 }}
                    >
                      {t('editor.quadOverview')}
                    </Button>
                  </Tooltip>
                </>
              )}
            </>
          )}

          {/* v2.18 变更耦合工具栏：filter / timeWindow / focus 占位——与 v2.17 依赖工具栏同形态，
            但语义对齐「时间维度耦合」：filter 走前端切片、window 走真重扫入 DB、focus 留待 B3 */}
          {isCouplingView && (
            <>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={couplingFilter}
                onChange={(_e, v) => v && handleCouplingFilter(v)}
                sx={{ '& .MuiToggleButton-root': { height: 26, fontSize: 11, px: 1, textTransform: 'none' } }}
              >
                <ToggleButton value="all">{t('editor.couplingFilterAll')}</ToggleButton>
                <ToggleButton value="hidden">{t('editor.couplingFilterHidden')}</ToggleButton>
                <ToggleButton value="highRisk">{t('editor.couplingFilterHighRisk')}</ToggleButton>
                <ToggleButton value="crossModule">{t('editor.couplingFilterCrossModule')}</ToggleButton>
              </ToggleButtonGroup>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={couplingWindowDays === null ? 'all' : String(couplingWindowDays)}
                onChange={(_e, v) =>
                  v !== null && v !== undefined && handleCouplingWindow(v === 'all' ? null : Number(v))
                }
                sx={{ '& .MuiToggleButton-root': { height: 26, fontSize: 11, px: 1, textTransform: 'none' } }}
              >
                <ToggleButton value="all">{t('editor.couplingWindowAll')}</ToggleButton>
                <ToggleButton value="90">{t('editor.couplingWindowM3')}</ToggleButton>
                <ToggleButton value="180">{t('editor.couplingWindowM6')}</ToggleButton>
                <ToggleButton value="365">{t('editor.couplingWindowY1')}</ToggleButton>
              </ToggleButtonGroup>
              {/* v2.18 layout 双模式：force=力导向 / cluster=按顶层目录硬分区+模块簇染色+跨模块边加粗 */}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={couplingLayoutMode}
                onChange={(_e, v) => v && handleCouplingLayout(v)}
                sx={{ '& .MuiToggleButton-root': { height: 26, fontSize: 11, px: 1, textTransform: 'none' } }}
              >
                <ToggleButton value="force">{t('editor.couplingLayoutForce')}</ToggleButton>
                <ToggleButton value="cluster">{t('editor.couplingLayoutCluster')}</ToggleButton>
              </ToggleButtonGroup>
              {/* 焦点占位：B1 不消费 focusFileId（本轮过滤逻辑不画子图），仅显示焦点文件 + 复位入口，
                让 store 字段 + UI 形态从一开始就与依赖画像对标，B3 直接接子图逻辑。 */}
              {couplingFocusFileId && (
                <>
                  <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      height: 26,
                      px: 1,
                      borderRadius: 1,
                      bgcolor: 'action.selected',
                      fontSize: 11,
                      maxWidth: 200,
                    }}
                  >
                    <span style={{ color: 'var(--mui-palette-primary-main)', fontWeight: 700 }}>
                      {t('editor.couplingFocusActive')}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'var(--mui-palette-text-secondary, #64748b)',
                      }}
                    >
                      {couplingFocusFile?.name ?? ''}
                    </span>
                  </Box>
                  <Tooltip title={t('editor.couplingFocusResetTip')}>
                    <Button
                      size="small"
                      variant="text"
                      color="primary"
                      onClick={resetCouplingFocus}
                      sx={{ height: 26, fontSize: 11, textTransform: 'none', minWidth: 0, px: 1 }}
                    >
                      {t('editor.couplingOverview')}
                    </Button>
                  </Tooltip>
                </>
              )}
            </>
          )}

          {isDirectoryView && (
            <>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
              <Tooltip title={directoryShowFiles ? t('editor.hideFiles') : t('editor.showFiles')}>
                <IconButton
                  size="small"
                  color={directoryShowFiles ? 'primary' : 'default'}
                  onClick={async () => {
                    const st = useEditorStore.getState();
                    const next = !st.directoryShowFiles;
                    st.setDirectoryShowFiles(next);
                    switchToDirSortView();
                    const sid = useSceneStore.getState().activeSceneId;
                    if (sid) {
                      const out = await rerenderDirectoryTree(sid);
                      useToastStore
                        .getState()
                        .showToast(
                          out.ok ? (next ? t('editor.filesShown') : t('editor.filesHidden')) : out.message,
                          out.ok ? 'success' : 'warning',
                        );
                    }
                  }}
                  sx={{ backgroundColor: directoryShowFiles ? 'action.selected' : 'transparent' }}
                  aria-label={directoryShowFiles ? t('editor.hideFiles') : t('editor.showFiles')}
                >
                  <DescriptionOutlinedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>

              <Tooltip title={t('editor.searchDirTip')}>
                <TextField
                  size="small"
                  value={dirSearchInput}
                  onChange={onDirSearchChange}
                  placeholder={t('editor.searchDirPlaceholder')}
                  sx={{ width: 150, '& .MuiInputBase-root': { height: 28, fontSize: 12 } }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start" sx={{ mr: 0.25 }}>
                          <SearchIcon sx={{ fontSize: 14 }} />
                        </InputAdornment>
                      ),
                      endAdornment: dirSearchInput ? (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            onClick={clearDirSearch}
                            sx={{ p: 0.25 }}
                            aria-label={t('leftPanel.clearSearch')}
                          >
                            <ClearIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                        </InputAdornment>
                      ) : undefined,
                    },
                  }}
                />
              </Tooltip>

              <Tooltip title={t('editor.sortDimTip', { label: DIR_SORT_LABEL[directorySort] })}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <IconButton
                    size="small"
                    onClick={cycleDirSort}
                    color="default"
                    aria-label={t('editor.sortDimTip', { label: DIR_SORT_LABEL[directorySort] })}
                  >
                    <SortIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                  <span
                    onClick={cycleDirSort}
                    style={{
                      fontSize: 12,
                      color: 'var(--mui-palette-text-secondary, #64748b)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      minWidth: 28,
                      fontWeight: 500,
                    }}
                  >
                    {DIR_SORT_LABEL[directorySort]}
                  </span>
                </span>
              </Tooltip>
            </>
          )}

          <Box sx={{ flex: 1 }} />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Tooltip title={leftPanelOpen ? t('editor.collapseLeft') : t('editor.expandLeft')}>
              <IconButton
                size="small"
                onClick={toggleLeftPanel}
                sx={{
                  backgroundColor: leftPanelOpen ? 'action.selected' : 'transparent',
                }}
                aria-label={leftPanelOpen ? t('editor.collapseLeft') : t('editor.expandLeft')}
              >
                <WidgetsIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={activeSceneStatus === 'published' ? t('editor.published') : t('editor.exportReport')}>
              <span>
                <IconButton
                  size="small"
                  onClick={(e) => setExportAnchor(e.currentTarget)}
                  color={activeSceneStatus === 'published' ? 'success' : 'default'}
                  disabled={activeSceneStatus === 'published'}
                  sx={{ opacity: activeSceneStatus === 'published' ? 0.5 : 1 }}
                  aria-label={activeSceneStatus === 'published' ? t('editor.published') : t('editor.exportReport')}
                >
                  <FileDownloadIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
            {/* 导出格式选择菜单 */}
            <Menu
              anchorEl={exportAnchor}
              open={Boolean(exportAnchor)}
              onClose={() => setExportAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem dense onClick={() => handleExport('html')}>
                <ListItemIcon>
                  <DescriptionOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={t('editor.htmlReport')} secondary={t('editor.htmlReportDesc')} />
              </MenuItem>
              <MenuItem dense onClick={() => handleExport('json')}>
                <ListItemIcon>
                  <CodeIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={t('editor.jsonReport')} secondary={t('editor.jsonReportDesc')} />
              </MenuItem>
              <MenuItem dense onClick={() => handleExport('svg')}>
                <ListItemIcon>
                  <SchemaOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={t('editor.svgReport')} secondary={t('editor.svgReportDesc')} />
              </MenuItem>
            </Menu>
          </Box>
        </Box>
      )}

      {/* 编辑区：左侧实体面板 + 中间画布 + 右侧属性面板 + 最右收起条 */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        {/* 左侧实体/文件树面板（折叠交互与 biosphere 一致：自定义宽 → 40 动画）；
            右缘拖宽手柄与右栏同范式（useEffect 挂监听 + 守卫 + 持久化 + 双击复位）。 */}
        <ComponentCenterPanel collapsed={!leftPanelOpen} onToggle={toggleLeftPanel} width={leftPanelWidth} resizing={leftDragging} />
        {leftPanelOpen && (
          <Box
            onMouseDown={startLeftResize}
            onDoubleClick={onLeftResizeReset}
            title={t('editor.resizePanel')}
            sx={{
              width: 5,
              flexShrink: 0,
              ml: -1, // 盖回面板 1px borderRight，避免面板线+手柄线双框
              cursor: 'col-resize',
              zIndex: 2,
              '&:hover': { backgroundColor: 'action.hover' },
              '&:active': { backgroundColor: 'primary.light' },
            }}
          />
        )}

        {/* 中间列：视图标签栏 + 画布（核心交互：拖动编辑永不下线。
            书场景的载体工作台以**画布实体**形态存在（writing-workbench），不替换画布） */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
          <SceneTabBar bookToolbar={bookToolbarActions} />
          <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ProjectCanvas onSyncToCanvas={onSyncToCanvas} syncing={syncing} />
            {/* 空态引导（V4）：书场景无任何载体视图时居中提示；pointer-events:none
                不拦截拖放，左栏载体可照常拖入。首个载体落下 hasCarrier 变 true 即消失。 */}
            {isBookScene && !hasCarrier && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1.25,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  textAlign: 'center',
                  px: 3,
                }}
              >
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: 2.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(139,92,246,0.10)',
                    border: '1.5px dashed rgba(139,92,246,0.5)',
                    color: '#8b5cf6',
                    fontSize: 26,
                    fontWeight: 700,
                  }}
                >
                  ✎
                </Box>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}>
                  {t('writingWorkbench.emptyCanvasHint')}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', maxWidth: 340, lineHeight: 1.6 }}>
                  {t('writingWorkbench.emptyCanvasSub')}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* 右侧面板（Tabs：详情 / 审查 / 分层 / 事件） */}
        {rightPanelOpen && (
          <>
            {/* 拖拽调宽手柄（v2.5）：独立元素在右栏左侧，mousedown 不冒泡到画布 pan */}
            <Box
              onMouseDown={startRightResize}
              onDoubleClick={onRightResizeReset}
              title={t('editor.resizePanel')}
              sx={{
                width: 5,
                flexShrink: 0,
                cursor: 'col-resize',
                borderLeft: 1,
                borderColor: 'divider',
                '&:hover': { backgroundColor: 'action.hover' },
                '&:active': { backgroundColor: 'primary.light' },
              }}
            />
            <Box
              sx={{
                width: currentRightWidth,
                flexShrink: 0,
                // 右栏宽度本就无过渡（瞬间跟手），拖宽体验与左栏 resizing 抑制后的效果一致。
                borderLeft: 1,
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: 'hidden',
                backgroundColor: (t) =>
                  t.palette.mode === 'dark' ? 'rgba(14, 14, 20, 0.92)' : 'rgba(248, 248, 252, 0.95)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {/* 顶部：分析名称 + 语言 + 未保存 + 导出状态（与 biosphere 名称条一致） */}
              {activeScene && (
                <Box
                  sx={{
                    px: 1.5,
                    py: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    flexShrink: 0,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: 'text.primary',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                      minWidth: 0,
                    }}
                    title={activeScene.name}
                  >
                    {activeScene.name}
                  </Typography>
                  {activeAnalyzer && (
                    <Tooltip
                      title={
                        extraAnalyzerCount > 0
                          ? t('editor.pluginMain', {
                              name: activeAnalyzer.name,
                              version: activeAnalyzer.version,
                              count: extraAnalyzerCount,
                            })
                          : t('editor.pluginAnalyzer', {
                              name: activeAnalyzer.name,
                              version: activeAnalyzer.version,
                            })
                      }
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                        <Box
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            bgcolor: (() => {
                              switch (activeAnalyzer.language.toLowerCase()) {
                                case 'typescript':
                                  return '#3178c6';
                                case 'rust':
                                  return '#dea584';
                                case 'python':
                                  return '#3776ab';
                                default:
                                  return '#64748b';
                              }
                            })(),
                          }}
                        />
                        <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                          {activeAnalyzer.language}
                          {extraAnalyzerCount > 0 ? ` +${extraAnalyzerCount}` : ''}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )}
                  {isDirty && (
                    <Tooltip title={t('editor.unsaved')}>
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: 'warning.main',
                          flexShrink: 0,
                        }}
                      />
                    </Tooltip>
                  )}
                  <Chip
                    label={activeSceneStatus === 'published' ? t('editor.published') : t('editor.notExported')}
                    size="small"
                    color={activeSceneStatus === 'published' ? 'success' : 'default'}
                    variant="outlined"
                    sx={{ height: 20, fontSize: '0.65rem', flexShrink: 0 }}
                  />
                </Box>
              )}
              <Tabs
                value={safeRightTab}
                onChange={(_e, v) => setRightTab(v)}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{
                  minHeight: 36,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '& .MuiTab-root': {
                    minHeight: 36,
                    py: 0.5,
                    fontSize: 10,
                    textTransform: 'none',
                  },
                  '& .MuiTabs-scrollButtons': {
                    width: 20,
                    '&.Mui-disabled': { opacity: 0.3 },
                  },
                }}
              >
                {/* Tab 子项必须是数组、不能包 Fragment：MUI v9 Tabs 用 React.Children.toArray
                处理 children，toArray 不解包 Fragment → 注入 selected/onChange/value 落在
                Fragment 头上被无视，Tab 们拿不到 → 选中态永空、点击无 onChange（切换无效）。
                开发模式控制台会报 "MUI: The Tabs component doesn't accept a Fragment as a child."。
                同时 Tab 显式 value（v9 对 undefined value 的子项按 toArray 索引兜底，显式更稳）。 */}
                {isBookScene
                  ? [
                      /* 书场景右栏 = 组件（拖源，随当前 L2 变化） / 属性（选中项） / AI。
                  原本的人物·设定·关系·大纲四栏已撤：它们就是 L2 那套题材分类的第二遍，
                  内容由画布与组件栏承担，不再在右栏重复陈列。 */
                      <Tab
                        key="inspector"
                        value={0}
                        icon={<WidgetsIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={
                          selectedSetting
                            ? selectedSetting.kind === 'character'
                              ? t('editor.writing.inspector.tabCharacter')
                              : t('editor.writing.inspector.tabSetting')
                            : activeViewKind === 'characters'
                              ? t('editor.writing.inspector.tabCharacter')
                              : activeViewKind === 'worldview'
                                ? t('editor.writing.inspector.tabSetting')
                                : activeViewKind === 'timeline'
                                  ? t('writing.timelineOverview')
                                  : activeViewKind === 'storylines'
                                    ? t('writing.storylineOverview')
                                    : activeViewKind === 'foreshadowing'
                                      ? t('writing.foreshadowOverview')
                                      : activeViewKind === 'inspiration'
                                        ? t('writing.inspirationOverview')
                                        : activeViewKind === 'proofread'
                                          ? t('writing.proofreadOverview')
                                          : activeViewKind === 'stats'
                                            ? t('writing.statsOverview')
                                            : activeViewKind === 'writing'
                                              ? t('writing.chapterContextTitle')
                                              : t('editor.writing.inspector.tab')
                        }
                      />,
                      <Tab
                        key="details"
                        value={1}
                        icon={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={t('editor.tabDetails')}
                      />,
                      <Tab
                        key="ai"
                        value={2}
                        icon={<SmartToyIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={t('editor.tabAi')}
                      />,
                    ]
                  : [
                      <Tab
                        key="details"
                        value={0}
                        icon={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={t('editor.tabDetails')}
                      />,
                      <Tab
                        key="review"
                        value={1}
                        icon={
                          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                            <RuleIcon sx={{ fontSize: 14 }} />
                            {criticalCount > 0 && (
                              <Box
                                sx={{
                                  position: 'absolute',
                                  top: -2,
                                  right: -4,
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  bgcolor: 'error.main',
                                  border: '1px solid',
                                  borderColor: 'background.paper',
                                }}
                              />
                            )}
                          </Box>
                        }
                        iconPosition="start"
                        label={`${t('editor.tabReview')}${findingsCount > 0 ? ` (${findingsCount})` : ''}`}
                      />,
                      <Tab
                        key="layers"
                        value={2}
                        icon={<LayersIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={`${t('editor.tabLayers')}${projectLayers.length > 0 ? ` (${projectLayers.length})` : ''}`}
                      />,
                      <Tab
                        key="health"
                        value={3}
                        icon={<MonitorHeartIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={t('editor.tabHealth')}
                      />,
                      <Tab
                        key="impact"
                        value={4}
                        icon={<HubIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={t('editor.tabImpact')}
                      />,
                      <Tab
                        key="ai"
                        value={5}
                        icon={<SmartToyIcon sx={{ fontSize: 14 }} />}
                        iconPosition="start"
                        label={t('editor.tabAi')}
                      />,
                    ]}
              </Tabs>
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* 书场景第 1 栏：要素检查器 —— 读**选中项**的要素 + 给一个到编辑区的出口
                （章 → 章要素/本章大纲；卷头 → 卷账；人物/世界观卡 → 设定要素；无选中 → 全书）。
                内容编辑在编辑区（L2 题材编辑面 / 载体卡），这里只读，不做第二个编辑器。 */}
                {isBookScene &&
                  safeRightTab === 0 &&
                  (activeViewKind === 'timeline' || activeViewKind === 'storylines' ? (
                    /* 时间线/剧情线视图：要素栏=时间线总览卡（事件数/完整·待补全/覆盖/冲突 + 剧情线挂线卡，可点选进详情） */
                    <TimelineOverviewPanel bookId={activeBookId} />
                  ) : activeViewKind === 'foreshadowing' ? (
                    /* 伏笔视图：要素栏=伏笔总览卡（三态统计/跨章预警/可点行进详情） */
                    <ForeshadowingOverviewCard />
                  ) : activeViewKind === 'inspiration' ? (
                    /* 灵感视图：要素栏=灵感总览卡（分发统计/念头可点行进详情） */
                    <InspirationOverviewCard />
                  ) : activeViewKind === 'proofread' ? (
                    /* 校对视图：要素栏=体检统计卡（六组计数，有页签去向的组行可点直达） */
                    <ProofreadOverviewCard />
                  ) : activeViewKind === 'stats' ? (
                    /* 统计视图：要素栏=体量总览卡（KPI 网格 + 离群章可点跳章） */
                    <StatsOverviewCard
                      bookId={activeBookId}
                      onJumpChapter={(chId, chTitle) => {
                        const g = writingBooks.find((b) => b.id === activeBookId)?.genre ?? '';
                        openChapterCarrierView(chId, chTitle, g, activeBookId);
                      }}
                    />
                  ) : (
                    <WritingInspectorPanel
                      kind={activeViewKind}
                      bookId={activeBookId}
                      entity={selectedComponent}
                      selectedSetting={selectedSetting}
                      onManageVolumes={onOpenLayersDialog}
                    />
                  ))}
                {/* 书场景：写作实体走属性编辑面板（P1），无选中显示书属性卡（封面，2026-09-14），
                其余（代码实体/插画等）维持画像面板。书场景前面多了「要素」栏 → 属性栏位右移一栏。 */}
                {safeRightTab === (isBookScene ? 1 : 0) &&
                  (isBookScene && (activeViewKind === 'timeline' || activeViewKind === 'storylines') ? (
                    selectedTimelineEvent ? (
                      /* 时间线视图：详情栏=选中事件完整编辑器（at/event/绑章/来源/跳转/删除） */
                      <TimelineEventDetail event={selectedTimelineEvent} bookId={activeBookId} />
                    ) : selectedStoryline ? (
                      /* 时间线视图：选中剧情线 → 线实体编辑器（名/色板/描述/线内事件/删线） */
                      <StorylineDetail storyline={selectedStoryline} bookId={activeBookId} />
                    ) : (
                      <Box
                        sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {t(
                            activeViewKind === 'storylines'
                              ? 'writing.storylineDetailEmpty'
                              : 'writing.timelineDetailEmpty',
                          )}
                        </Typography>
                      </Box>
                    )
                  ) : isBookScene && activeViewKind === 'foreshadowing' ? (
                    selectedForeshadowing ? (
                      /* 伏笔视图：详情栏=选中伏笔完整编辑器（标题/描述/埋设/回收/状态/挂线/预警/删除） */
                      <ForeshadowingDetail item={selectedForeshadowing} bookId={activeBookId} />
                    ) : (
                      <Box
                        sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {t('writing.foreshadowDetailEmpty')}
                        </Typography>
                      </Box>
                    )
                  ) : isBookScene && activeViewKind === 'inspiration' ? (
                    selectedInspiration ? (
                      /* 灵感视图：详情栏=选中念头编辑与分发器（转时间线/挂章/转伏笔/删除） */
                      <InspirationDetail beat={selectedInspiration} />
                    ) : (
                      <Box
                        sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {t('writing.inspirationDetailEmpty')}
                        </Typography>
                      </Box>
                    )
                  ) : isBookScene && activeViewKind === 'proofread' ? (
                    /* 校对视图：详情栏无编辑器语义——发现即点即跳（清单在编辑区页签内） */
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('writing.proofreadDetailEmpty')}
                      </Typography>
                    </Box>
                  ) : isBookScene && activeViewKind === 'stats' ? (
                    /* 统计视图：详情栏无选中语义——总览在要素栏，编辑面在画布页签 */
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <Typography variant="caption" color="text.secondary">
                        {t('writing.statsDetailEmpty')}
                      </Typography>
                    </Box>
                  ) : isBookScene && selectedStoryline ? (
                    /* 选中剧情线（非时间线视图残留态）：线实体编辑器照常可用 */
                    <StorylineDetail storyline={selectedStoryline} bookId={activeBookId} />
                  ) : isBookScene && selectedSetting ? (
                    <WritingSettingDetail setting={selectedSetting} bookId={activeBookId} />
                  ) : isBookScene && activeViewKind === 'writing' ? (
                    /* 正文视图：详情栏=正文信息卡（激活章的正文档案，只读；编辑收敛写作台独立窗口） */
                    <WritingDocsDetailCard bookId={activeBookId} />
                  ) : isBookScene && selectedComponent?.type.startsWith('writing-') ? (
                    <WritingPropertyPanel entity={selectedComponent} />
                  ) : isBookScene && !selectedComponent && activeViewKind === 'characters' ? (
                    <WritingSettingContextPanel kind="character" bookId={activeBookId} />
                  ) : isBookScene && !selectedComponent && activeViewKind === 'worldview' ? (
                    <WorldviewOverview bookId={activeBookId} />
                  ) : isBookScene && activeViewKind === 'catalog' && selectedChapter ? (
                    /* 大纲视图：点章节行锚点 → 章详情卡（章信息直接展示，不弹窗、无封面缩略图） */
                    <ChapterMetaPanel chapterId={selectedChapter.id} bookId={activeBookId} />
                  ) : isBookScene && !selectedComponent ? (
                    <BookMetaPanel bookId={activeBookId} onReparse={onReparseBook} />
                  ) : (
                    <EntityPortraitPanel entity={selectedComponent} />
                  ))}
                {!isBookScene && (
                  <>
                    {safeRightTab === 1 && <ReviewFindingsPanel />}
                    {safeRightTab === 2 && (
                      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}
                        >
                          {t('editor.layerTitle')}
                        </Typography>
                        {projectLayers.length === 0 ? (
                          <Box sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                            <LayersIcon sx={{ fontSize: 36, opacity: 0.2, mb: 1 }} />
                            <Typography variant="caption" sx={{ display: 'block' }}>
                              {t('editor.noLayers')}
                            </Typography>
                          </Box>
                        ) : (
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                            {projectLayers.map((pl: any) => {
                              const fileCount = projectFiles.filter(
                                (f: any) => !f.isDirectory && f.layerId === pl.id,
                              ).length;
                              return (
                                <Box
                                  key={pl.id}
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    px: 1,
                                    py: 0.75,
                                    borderRadius: 1,
                                    border: 1,
                                    borderColor: 'divider',
                                    bgcolor: 'action.hover',
                                  }}
                                >
                                  <Box
                                    sx={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: '50%',
                                      backgroundColor: pl.color || '#94A3B8',
                                      flexShrink: 0,
                                    }}
                                  />
                                  <Typography variant="body2" sx={{ flex: 1, fontSize: 12 }}>
                                    {pl.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {t('editor.fileCount', { n: fileCount })}
                                  </Typography>
                                </Box>
                              );
                            })}
                          </Box>
                        )}
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<SettingsIcon sx={{ fontSize: 12 }} />}
                          onClick={onOpenLayersDialog}
                          sx={{ mt: 1, textTransform: 'none', fontSize: 11 }}
                        >
                          {t('editor.manageLayers')}
                        </Button>
                      </Box>
                    )}
                    {safeRightTab === 3 && <ArchitectureHealthPanel />}
                    {safeRightTab === 4 && <ImpactAnalysisPanel entity={selectedComponent} />}
                  </>
                )}
                {safeRightTab === AI_TAB && (
                  <WorkbenchAiPanel
                    activeFile={mainAiFile}
                    selection={null}
                    editorRef={aiEditorRef}
                    onClose={() => persistRightPanelOpen(false)}
                    isBookScene={isBookScene}
                    bookTopic={aiBookTopic}
                    bookTitle={aiBookTitle}
                    focusSetting={aiFocusSetting}
                    onOpenCanvasAi={onOpenCanvasAi}
                    onOpenPath={(relPath, line) => {
                      const f = projectFiles.find((x) => x.relPath === relPath);
                      if (f) {
                        void spawnCodeWorkbench(f.id, line ?? null, useProjectStore.getState().activeAnalysisId);
                      } else {
                        useToastStore
                          .getState()
                          .showToast(t('workbench.aiOpenPath.notFound', { path: relPath }), 'info');
                      }
                    }}
                  />
                )}
              </Box>
            </Box>
          </>
        )}

        {/* 最右收起条（始终显示，与 biosphere 一致） */}
        <Box
          sx={{
            width: 24,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderLeft: 1,
            borderColor: 'divider',
            backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(18, 18, 24, 0.4)' : 'rgba(250, 250, 252, 0.6)'),
            '&:hover': {
              backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
            },
          }}
          onClick={() => persistRightPanelOpen(!rightPanelOpen)}
        >
          {rightPanelOpen ? <ChevronRightIcon sx={{ fontSize: 14 }} /> : <ChevronLeftIcon sx={{ fontSize: 14 }} />}
        </Box>
      </Box>

      {/* 底部状态栏：书场景=写作域速览（书/章节/总字数/剧情线/伏笔待回收，2026-09-19 拍板
          改造——代码分析遗留元素不再出现在书场景）；非书场景保留原代码统计（遗留代码场景仍可用） */}
      <Box
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.5,
          py: 0.4,
          borderTop: 1,
          borderColor: 'divider',
          backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(18, 18, 24, 0.6)' : 'rgba(248, 250, 252, 0.7)'),
          fontSize: 10,
          color: 'text.secondary',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {isBookScene ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <MenuBookRoundedIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusBooks', { n: writingBooks.length })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SubjectIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusChapters', { n: writingChapters.length })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <EditNoteOutlinedIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('writing.words', { n: totalWords })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TimelineIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusStorylines', { n: storylines.length })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <PushPinIcon sx={{ fontSize: 11, color: pendingForeshadowCount > 0 ? 'warning.main' : 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusForeshadowPending', { n: pendingForeshadowCount })}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
              {t('editor.statusWritingHint')}
            </Typography>
          </>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <CodeIcon sx={{ fontSize: 11, color: 'primary.main', flexShrink: 0 }} />
              <Typography variant="caption" sx={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t('editor.statusLang', { lang: activeAnalyzer?.language ?? '—' })}
                {extraAnalyzerCount > 0 ? ` +${extraAnalyzerCount}` : ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <WidgetsIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusEntities', { n: componentCount })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <RuleIcon sx={{ fontSize: 11, color: criticalCount > 0 ? 'error.main' : 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusViolations', { n: findingsCount })}
                {criticalCount > 0 ? t('editor.statusCritical', { n: criticalCount }) : ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SchemaOutlinedIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusModules', {
                  m: projectModules.length,
                  f: projectFiles.filter((f: any) => !f.isDirectory).length,
                })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LayersIcon sx={{ fontSize: 11, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                {t('editor.statusLayers', { n: projectLayers.length })}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            {componentCount > 0 && (
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
                {t('editor.statusHint')}
              </Typography>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
