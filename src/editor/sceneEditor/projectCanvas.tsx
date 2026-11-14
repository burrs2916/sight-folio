// 项目画布主体：缩放平移 / 虚拟化 / 实体渲染 / 拖放 / 影响链联动 / 书场景
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Fab from '@mui/material/Fab';
import Divider from '@mui/material/Divider';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import HubIcon from '@mui/icons-material/Hub';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TerminalIcon from '@mui/icons-material/Terminal';
import BuildIcon from '@mui/icons-material/Build';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { useProjectStore } from '../../store/projectStore';
import { ImagePreviewDialog } from '../panels/ImagePreviewDialog';
import { triggerDiagnosis } from '../../ai/triggerDiagnosis';
import { aiButtonSx, AI_COLOR } from '../../ai/aiBrand';
import { EditorContextMenu } from '../components/EditorContextMenu';
import { componentRegistry } from '../registry';
import { computeVisibleEntityIds } from '../utils/viewportCulling';
import { lodForScale, type CanvasLod } from '../utils/lod';
import { CV } from '../renderers/canvasTheme';
import { useCanvasResize } from '../hooks/useViewport';
import { useCanvasPanZoom } from '../hooks/useCanvasPanZoom';
import { isDrillableModule, toggleModuleDrill } from '../utils/drillActions';
import { contentBounds, fitViewport, transformCss, backgroundCss } from '../utils/panZoom';
import CanvasMinimap from '../panels/CanvasMinimap';
import { PortraitLegend } from '../panels/PortraitLegend';
import { buildCallIndex } from '../utils/impactGraph';
import {
  buildFileDepIndex,
  buildFlowGate,
  buildImpactChain,
  chainLookup,
  chainDepthStyle,
  summarizeChain,
  symbolsByFileFrom,
  testImpactOf,
  summarizeTestImpact,
  buildTestCommands,
  buildCIPipelineScript,
  buildGitHubActionStep,
  CHAIN_SIDE_COLOR,
  type ChainSide,
} from '../utils/impactChain';
import { useToastStore } from '../../store/toastStore';
import { sortComponentsEdgesFirst } from '../utils/canvasOrder';
import { topDirOf } from '../utils/architectureMetrics';
import logger from '../../utils/logger';
import { viewKindLabelKey } from '../../utils/writingSchema';
import {
  createBlankWritingEntity,
  createBookFromCarrierDrop,
  openChapterCarrierView,
  ensureCarrierContainer,
  parseBookIdFromScene,
} from '../../utils/studioBook';
import {
  WRITING_SURFACE_ATTR,
  findFullBleedCard,
  isFullCanvasWritingCard,
  shouldYieldToNativeContextMenu,
} from '../../utils/writingPaneSeed';
import type { SceneComponent } from '../../types/editor';
import type { ProjectFile } from '../../services/tauri';
import { t, resolveFragments } from '../../i18n';
import { RENDERERS, UnknownTypeFallback } from './renderers';
import { ZOOM_STEP, MIN_ZOOM, MAX_ZOOM, CULL_PADDING } from './constants';
import { compFileId, dedupViewName, dropOpensCurrentBookView } from './utils';
import { CanvasLoadingSkeleton } from './loading';
import { AlignToolbar } from './alignToolbar';
import { CanvasEntityNode } from './canvasEntityNode';
import type { CanvasEmphasis } from './types';
import { uiFontSize } from '../../theme/appearanceScales';

export function ProjectCanvas({ onSyncToCanvas, syncing }: { onSyncToCanvas?: () => void; syncing?: boolean }) {
  const components = useEditorStore((s) => s.components);
  const selectComponent = useEditorStore((s) => s.selectComponent);
  const addComponent = useEditorStore((s) => s.addComponent);
  const updateComponent = useEditorStore((s) => s.updateComponent);
  const updateComponentConfig = useEditorStore((s) => s.updateComponentConfig);
  // 载体视图（V4）：拖载体 = 视图内容已有则新开视图承载；落位后清选择避免全幅选中描边
  // （deselectAll 复用上方既有选择器、updateComponentTransform 复用下方拖拽段既有选择器，勿重复声明）
  const addView = useEditorStore((s) => s.addView);
  const selectedIds = useEditorStore((s) => s.selection.selectedIds);
  const deselectAll = useEditorStore((s) => s.deselectAll);
  const focusRequest = useEditorStore((s) => s.focusRequest);
  const fitRequest = useEditorStore((s) => s.fitRequest);
  const projectLayers = useProjectStore((s) => s.layers);
  // ─── 业务联动数据：文件级依赖（选中实体 → 高亮依赖邻居）───
  const dependencies = useProjectStore((s) => s.dependencies);
  const projectFiles = useProjectStore((s) => s.files);
  const projectModules = useProjectStore((s) => s.modules);
  // ─── 加载态：扫描中 / 同步中驱动骨架屏 ───
  const scanning = useProjectStore((s) => s.scanning);
  const scanStage = useProjectStore((s) => s.scanStage);
  const scanPercent = useProjectStore((s) => s.scanPercent);
  const scanScanned = useProjectStore((s) => s.scanScanned);
  const scanTotal = useProjectStore((s) => s.scanTotal);
  // ─── 影响链数据：符号级调用边（精确通道），缺席时自动降级为文件级依赖 ───
  const callEdges = useProjectStore((s) => s.callEdges);
  // ─── 数据流摘要：给影响链装「闸门」，把调用可达收敛成数据可达 ───
  const dataFlowFacts = useProjectStore((s) => s.dataFlow);
  // v2.17 依赖画像筛选镜：all=不过滤 / cycles=仅循环依赖 / crossModule=仅跨模块边
  const depFilter = useEditorStore((s) => s.depFilter);
  // 时间线画布实时刷新（P2）：timelineEvents 引用变化且当前激活视图是 timeline 时，
  // 自动重铺板（见下方 useEffect）。reseed 只动 editor store，不会反向改 timelineEvents → 无循环。
  // ─── 书场景（写作）判定：画布上的**分析器仪表**不在写作场景出现 ───
  // 口径与 SceneTabBar / PortraitLegend / 右栏 / ComponentCenterPanel 完全一致：
  // activeScene.primaryLanguage === "novel-zh"，全项目只有这一个信号源。
  // 取值型选择器（返回 boolean）→ 只在真正切换场景时重渲染。
  const isBookScene = useSceneStore(
    (s) => s.scenes.find((sc) => sc.id === s.activeSceneId)?.primaryLanguage === 'novel-zh',
  );

  /**
   * 影响链传播跳数：0 = 关闭（回到单跳邻接的旧行为），1/2/3 = 多跳传播。
   * 默认 2 —— 1 跳等价于旧行为，3 跳在中型仓库已经开始出现「点亮半个项目」的噪声。
   *
   * 书场景（写作）强制 0：影响链问的是「改这个文件会炸到谁」，是纯代码分析语汇，
   * 小说创作里没有对应物（用户点名「影响链 · 3 跳 我们不需要」）。
   * **不是只藏那个按钮**：只藏控制器的话，选中卡片仍会按跳数着色、挂「↑2」角标，
   * 分析器语汇照样漏在写作台上；这里把值打成 0，BFS 直接不跑（buildImpactChain
   * 在 depth<1 时提前返回 null），图例 / TIA 弹层 / 跳数角标随之全空。
   * 用「派生」而非改 state：切回代码场景时用户原来的跳数选择原样还在。
   */
  const [chainDepthRaw, setChainDepth] = useState<number>(2);
  const chainDepth = isBookScene ? 0 : chainDepthRaw;
  // 画布右下角 AI 悬浮入口：取当前选中文件实体的路径（供「诊断选中文件」菜单项）
  const selectedFileForAi = useEditorStore((s) => {
    const id = s.selection.selectedIds[0];
    if (!id) return null;
    const comp = s.components.find((c) => c.id === id);
    const fp = comp?.config?.filePath as string | undefined;
    return fp ?? null;
  });
  const [aiMenuAnchor, setAiMenuAnchor] = useState<null | HTMLElement>(null);

  // ─── 上下文菜单状态 ───
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    componentId: string | null;
  } | null>(null);

  // ─── 缩放 / 平移（脱离 React 渲染循环，见 useCanvasPanZoom 注释）───
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // 视口容器尺寸（虚拟化裁剪基准；ResizeObserver 首帧后才非 0，未就绪时回退全量渲染）
  const canvasSize = useCanvasResize(canvasRef);
  const ZOOM_LIMITS = useMemo(() => ({ min: MIN_ZOOM, max: MAX_ZOOM }), []);
  const {
    viewport,
    viewportRef,
    isPanning,
    setViewport,
    setViewportAnimated,
    zoomByStep,
    resetViewport: handleResetView,
    clientToCanvas,
    handlers: panHandlers,
  } = useCanvasPanZoom({ containerRef: canvasRef, contentRef, limits: ZOOM_LIMITS, zoomStep: ZOOM_STEP });
  const scale = viewport.scale;
  const panOffset = viewport.offset;

  // ─── H6 框选：左键在画布空白处拖拽 → 矩形选实体（代码/书场景共用同一画布，零回归）───
  // 平移手势只吃中键/右键（useCanvasPanZoom panButtons=[1,2]），左键空白处完全空闲，
  // 框选用标准 UX：拖拽画矩形，松手按画布坐标 AABB 交集多选实体。
  // 覆盖层 mousemove 直写 DOM style（与 panZoom 同一哲学），不进 React 渲染循环。
  const boxOverlayRef = useRef<HTMLDivElement>(null);
  const boxDragRef = useRef<{ startX: number; startY: number; additive: boolean; moved: boolean } | null>(null);
  // 框选松手后的 click 会落在画布空白 → 既有 onClick 会 deselectAll 把框选结果清掉，须抑制一次
  const boxSuppressClickRef = useRef(false);

  const handleBoxSelectStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // 实体上的按下交给实体自己的单击/拖拽逻辑；画布内按钮/输入框不参与框选
    if (target && (target.closest('.ps-entity') || target.closest("button, a, input, textarea, [role='button']")))
      return;
    e.preventDefault(); // 拖拽期间避免原生文本选中
    boxDragRef.current = { startX: e.clientX, startY: e.clientY, additive: e.shiftKey, moved: false };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const bs = boxDragRef.current;
      const ov = boxOverlayRef.current;
      const el = canvasRef.current;
      if (!bs || !ov || !el) return;
      if (Math.abs(e.clientX - bs.startX) > 3 || Math.abs(e.clientY - bs.startY) > 3) bs.moved = true;
      if (!bs.moved) return;
      const rect = el.getBoundingClientRect();
      const x1 = Math.max(rect.left, Math.min(bs.startX, e.clientX));
      const y1 = Math.max(rect.top, Math.min(bs.startY, e.clientY));
      const x2 = Math.min(rect.right, Math.max(bs.startX, e.clientX));
      const y2 = Math.min(rect.bottom, Math.max(bs.startY, e.clientY));
      ov.style.display = 'block';
      ov.style.left = `${x1 - rect.left}px`;
      ov.style.top = `${y1 - rect.top}px`;
      ov.style.width = `${x2 - x1}px`;
      ov.style.height = `${y2 - y1}px`;
    };
    const onUp = (e: MouseEvent) => {
      const bs = boxDragRef.current;
      boxDragRef.current = null;
      const ov = boxOverlayRef.current;
      if (ov) ov.style.display = 'none';
      if (!bs || !bs.moved) return; // 原地点击 → 落回既有 onClick（空白点击取消选中）
      boxSuppressClickRef.current = true;
      const a = clientToCanvas(bs.startX, bs.startY);
      const b = clientToCanvas(e.clientX, e.clientY);
      const minX = Math.min(a.x, b.x),
        maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y),
        maxY = Math.max(a.y, b.y);
      const hits = useEditorStore.getState().components.filter((c) => {
        if (!c.visible) return false;
        // 与 CanvasEntityNode 同口径：边/象限底/下钻框是装饰或独立交互，不进框选
        if (c.type === 'dependency-edge' || c.type === 'quadrant-zone-bg') return false;
        // 铺满画布的容器卡（正文容器 / 题材编辑面）整卡拦截指针事件、点选不到，
        // 但框选按几何命中 —— 不排除的话一次框选就能把它选中并拖走/删掉。
        if (isFullCanvasWritingCard(c.type)) return false;
        if ((c.config as any)?.drillFrame) return false;
        const t2 = c.transform;
        return t2.x < maxX && t2.x + t2.width > minX && t2.y < maxY && t2.y + t2.height > minY;
      });
      const ed = useEditorStore.getState();
      if (!bs.additive) ed.deselectAll();
      for (const h of hits) ed.selectComponent(h.id, true);
      // 联动绝不静默 no-op：0 命中给提示，多选给计数
      const toast = useToastStore.getState();
      if (hits.length === 0) toast.showToast(t('editor.boxSelectEmpty'), 'info');
      else if (hits.length > 1) toast.showToast(t('editor.boxSelectDone', { n: hits.length }), 'success');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clientToCanvas, t]);

  // ─── 画布截图导出 PNG（低频操作，动态 import 不进主包；捕获 canvasRef 容器，
  //     工具条/小地图是其兄弟节点，天然不入图）───
  const [exportingPng, setExportingPng] = useState(false);
  const handleExportPng = useCallback(async () => {
    const el = canvasRef.current;
    if (!el || exportingPng) return;
    setExportingPng(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(el, { pixelRatio: 2 });
      const ss = useSceneStore.getState();
      const sceneName = ss.scenes.find((s) => s.id === ss.activeSceneId)?.name;
      const a = document.createElement('a');
      a.download = `${sceneName || 'canvas'}-canvas.png`;
      a.href = dataUrl;
      a.click();
      useToastStore.getState().showToast(t('editor.pngExportOk'), 'success');
    } catch (err) {
      logger.warn('ProjectCanvas', 'png export failed', { err: String(err) });
      useToastStore.getState().showToast(t('editor.pngExportFail'), 'error');
    } finally {
      setExportingPng(false);
    }
  }, [exportingPng, t]);

  // ─── LOD 档位（R37：全览时虚拟化失效的补位手段）──────────────────────
  // 视口虚拟化只在「实体在视口外」时省事，而用户最常用的「适应画布」恰恰把
  // 所有实体塞进视口 —— 一个都剪不掉，几百张完整卡片同时在册，这是最卡的一刻。
  // LOD 换个维度省：缩得越小画得越糙（此时徽标本来也被压到不可读）。
  // prevLodRef 提供迟滞，避免用户在阈值附近滚滚轮就触发全画布重挂载。
  const prevLodRef = useRef<CanvasLod | undefined>(undefined);
  const lod = useMemo(() => {
    const next = lodForScale(scale, prevLodRef.current);
    prevLodRef.current = next;
    return next;
  }, [scale]);

  // ─── 视口权威闭环（此前完全断裂：持久化视口无人消费，本地视口无人持久化）───
  // 载入侧：场景/视图载入（viewportLoadSeq 自增）时应用持久化视口；
  // 持久化视口仍是默认值（scale=1、offset=0,0）且有实体时，自动内容全览 ——
  // 对齐 biosphere「挂载即自适应视口」契约。此前画布永远停在左上角，
  // 内容包围盒超出屏幕时观感就是「实体没有渲染出来」。
  const viewportLoadSeq = useEditorStore((s) => s.viewportLoadSeq);
  useEffect(() => {
    const st = useEditorStore.getState();
    const vp = st.viewport;
    const isDefault = vp.scale === 1 && vp.offset.x === 0 && vp.offset.y === 0;
    logger.throttled('canvas.viewportLoad', 'ProjectCanvas', 'viewportLoadSeq fired', () => ({
      seq: viewportLoadSeq,
      viewport: { scale: vp.scale, offset: vp.offset },
      isDefault,
      componentsCount: st.components.length,
      canvasSize,
      action: st.components.length > 0 && isDefault ? 'requestFit' : 'applySavedViewport',
    }));
    if (st.components.length > 0 && isDefault) {
      // fit 令牌可延迟消费（实体稍后就绪也会补做），这里放心发起
      st.requestFit();
    } else {
      setViewport({ scale: vp.scale, offset: { x: vp.offset.x, y: vp.offset.y } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportLoadSeq]);

  // 回写侧：本地视口（fit/平移/缩放结果）防抖 600ms 写回 store，
  // 随 exportSceneWithViews 持久化；不标脏 —— 视口搭下一次内容保存的便车，
  // 纯视口变化不触发保存（未持久化时下次打开自动 fit，体验无损）。
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = useEditorStore.getState().viewport;
      if (cur.scale !== viewport.scale || cur.offset.x !== viewport.offset.x || cur.offset.y !== viewport.offset.y) {
        useEditorStore.getState().setViewport({
          scale: viewport.scale,
          offset: { x: viewport.offset.x, y: viewport.offset.y },
        });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [viewport]);

  // ─── 画布实体视口虚拟化（根治大项目卡顿）────────────────────────────
  // 同步到画布后有数百实体，全量挂载/渲染（含平移缩放时的协调）是卡顿根因。
  // 按 viewport(scale+panOffset) 把实体画布坐标投影到屏幕坐标，只渲染视口内
  // （含 300px 缓冲）实体；选中实体无条件渲染（交互必须保持可见）。
  // 容器未就绪（尺寸 0）或全览（fit 后缩得很小）时自然回退为全量渲染。
  const visibleEntityIds = useMemo(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
      logger.throttled('canvas.cullNotReady', 'ProjectCanvas', 'visibleEntityIds: canvas not ready', () => ({
        canvasSize,
        componentsCount: components.length,
      }));
      return null;
    }
    const ids = computeVisibleEntityIds(
      components,
      { scale, offset: panOffset },
      { width: canvasSize.width, height: canvasSize.height },
      { padding: CULL_PADDING, selectedIds, hoveredId: null },
    );
    // 这条日志每帧都会走到（平移/缩放都会重算 memo）。thunk 形态保证被限流时
    // 连 `Array.from(ids)` 都不执行 —— 否则 500 实体每帧白分配一个 500 长数组。
    logger.throttled('canvas.cull', 'ProjectCanvas', 'visibleEntityIds computed', () => ({
      viewport: { scale, offset: panOffset },
      canvasSize,
      totalComponents: components.length,
      visibleCount: ids.size,
    }));
    // 安全兜底：如果视口裁剪后一个实体都看不到（但画布有实体），说明视口位置错误，
    // 返回 null 回退为全量渲染，确保用户至少能看到实体（即使位置不对）
    if (ids.size === 0 && components.length > 0) {
      logger.throttled(
        'canvas.cullEmpty',
        'ProjectCanvas',
        'visibleEntityIds: all entities culled, falling back to render all',
        () => ({
          viewport: { scale, offset: panOffset },
          canvasSize,
          totalComponents: components.length,
        }),
        5000,
      );
      return null;
    }
    return ids;
  }, [components, scale, panOffset, canvasSize.width, canvasSize.height, selectedIds]);

  // ─── 渲染顺序：依赖边先于实体 ───
  // 「依赖关系把实体遮住无法选中」的兜底（即便边 shell 已 pointer-events:none，
  // 视觉上也要让实体覆盖边的线段，避免边画在实体卡片上像穿模）。纯函数独立在
  // utils/canvasOrder.ts —— 上一次单数组分桶在 edges/非边交替时会互相覆盖
  // （[F1 F2 E1 E2] → [E1 E2]，F1/F2 永久丢失），由该模块的回归测试钉死。
  const displayComponents = useMemo(
    () => sortComponentsEdgesFirst(components, visibleEntityIds),
    [components, visibleEntityIds],
  );

  // ─── 铺满画布的写作容器卡（正文容器 / 题材编辑面）→ 视口贴面渲染 ───────────
  // 它们不是「画布上的一个对象」，而是**整块画布本身**（用户拍板：
  // 「大纲中间的编辑区要覆盖整个画布，中间不要留背景」）。
  //
  // 为什么不能继续当普通实体：实体活在 transform 层里，随视口缩放平移 ——
  // 一张 1920×1080 的编辑面经「适应画布」（padding 80 + 居中）后只剩 0.46 倍，
  // 实测四周留白 左80/右80/上131/下131 px，pane 里 11px 的字被压成 5px。
  // 贴面渲染（position:absolute inset:0，不吃缩放平移）后：编辑区等于整个视口，
  // 1:1 像素、随窗口自适应、不裁切、零底纹。
  //
  // 层序刻意让贴面在下（zIndex 1）、变换层在上 —— 用户拖进画布的实体卡照常
  // 可见可拖，绝不因为编辑区铺满而被盖住（「静默丢内容」是最不能接受的失败模式）。
  const fullBleedComp = useMemo(() => {
    const bleed = components.filter((c) => isFullCanvasWritingCard(c.type));
    // 一个视图只该有一张铺满卡（正文容器 _或_ 题材编辑面）。真出现第二张
    // （历史事故 / 异常恢复 / 换视图失败），只渲染第一张 —— 但**必须留痕**：
    // 静默少渲染一张卡比报错更难查。题材编辑面的这类重复由
    // studioBook.reconcileStudioPaneView 幂等清场（见 duplicateStudioPaneIds）。
    if (bleed.length > 1) {
      logger.throttled(
        'canvas.bleedDuplicated',
        'SceneEditor',
        'multiple full-bleed writing cards in one view',
        () => ({
          viewId: useEditorStore.getState().activeViewId,
          types: bleed.map((c) => c.type),
          rendered: bleed[0].type,
        }),
      );
    }
    return findFullBleedCard(components);
  }, [components]);
  const FullBleedRenderer = fullBleedComp ? (RENDERERS[fullBleedComp.type] ?? UnknownTypeFallback) : null;
  // ─── 画布仪表（小地图 / 底部缩放条）是否还有意义 ──────────────────────────
  // 判定：视图里除了铺满画布的编辑面，还有真正的画布对象吗？
  // 没有 → 视口不再映射到用户看到的画面：缩放/适应/1:1 按下去画面纹丝不动
  // （用户原话「大纲视图下这个不需要」），小地图点哪都只移动看不见的层，
  // 而它们都固定吸附画布边缘、会压在编辑区上 → 一律不出。
  // 落过实体卡的视图照常给（那时缩放/导航是真的有用）。
  const hasCanvasObjects = useMemo(
    () => !fullBleedComp || components.some((c) => !isFullCanvasWritingCard(c.type)),
    [components, fullBleedComp],
  );

  /**
   * v2.17 依赖边点击：选中该边的两端节点（多选取并集），并 toast 该边引用的具体符号名。
   * 边 shell 是 pointer-events:none，只有 DependencyEdgeRenderer 内的透明命中路径
   * （visiblePainted）能捕获点击，故不会抢节点的选中；空白处仍穿透到下层实体。
   * 端点节点若不在当前画布（top-90 采样外）→ 回退到焦点子图，保证能给完整视图。
   */
  const handleEdgeClick = useCallback(
    (comp: SceneComponent) => {
      const cfg = (comp.config ?? {}) as Record<string, unknown>;
      const from = typeof cfg.fromFileId === 'string' ? (cfg.fromFileId as string) : null;
      const to = typeof cfg.toFileId === 'string' ? (cfg.toFileId as string) : null;
      if (!from || !to) return;
      const ed = useEditorStore.getState();
      const fromComp = ed.components.find((c) => (c.config as any)?.fileId === from);
      const toComp = ed.components.find((c) => (c.config as any)?.fileId === to);
      const ids = [fromComp?.id, toComp?.id].filter((v): v is string => typeof v === 'string');
      if (ids.length > 0) {
        ed.selectComponent(ids[0], false);
        for (const id of ids.slice(1)) ed.selectComponent(id, true);
      }
      const symbolNames = Array.isArray(cfg.symbolNames) ? (cfg.symbolNames as string[]) : [];
      const symbols =
        symbolNames.length > 0
          ? `（引用：${symbolNames.slice(0, 4).join(', ')}${symbolNames.length > 4 ? ` +${symbolNames.length - 4}` : ''}）`
          : '';
      const files = useProjectStore.getState().files;
      const nameOf = (id: string) => files.find((f) => f.id === id)?.name ?? id;
      useToastStore
        .getState()
        .showToast(t('editor.depEdgeClick', { from: nameOf(from), to: nameOf(to), symbols }), 'info');
    },
    [t],
  );

  // ─── 拖放状态 ───
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number } | null>(null);

  // ─── 联动索引（useMemo 缓存，避免每次渲染重建）───
  // 1) 分层颜色：id → color（替代渲染时逐实体 find）
  const layerColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const pl of projectLayers) m.set(pl.id, pl.color || '');
    return m;
  }, [projectLayers]);

  // 1b) 小地图「分层配色」取色器：实体 → 架构分层色（无分层归属时返回 undefined）
  const minimapLayerColorOf = useCallback(
    (c: SceneComponent) => layerColorById.get((c.config as any)?.projectLayerId) || undefined,
    [layerColorById],
  );

  // 2) relPath → ProjectFile（旧画布实体没有 fileId 时兜底匹配）
  const fileByPath = useMemo(() => {
    const m = new Map<string, ProjectFile>();
    for (const f of projectFiles) {
      if (f.isDirectory) continue;
      m.set(f.relPath, f);
    }
    return m;
  }, [projectFiles]);

  // 3) 画布实体 → 项目文件 id（组件数组或文件列表变化时重建）
  const fileIdByCompId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of components) {
      const id = compFileId(c, fileByPath);
      if (id) m.set(c.id, id);
    }
    return m;
  }, [components, fileByPath]);

  // 4) 文件依赖邻接表（双向：from↔to 互为邻居）
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const d of dependencies) {
      if (!d.fromId || !d.toId || d.fromId === d.toId) continue;
      if (!m.has(d.fromId)) m.set(d.fromId, new Set());
      if (!m.has(d.toId)) m.set(d.toId, new Set());
      m.get(d.fromId)!.add(d.toId);
      m.get(d.toId)!.add(d.fromId);
    }
    return m;
  }, [dependencies]);

  // 4d) 影响链索引（一次构建，选中变化时只做 BFS，不重扫全表）
  //     符号级：project_call_edges → 正反向邻接；文件级：project_dependencies → 有向邻接。
  const callIndex = useMemo(() => (callEdges.length > 0 ? buildCallIndex(callEdges) : null), [callEdges]);
  const symbolsByFile = useMemo(() => (callIndex ? symbolsByFileFrom(callIndex) : null), [callIndex]);
  const fileDepIndex = useMemo(() => buildFileDepIndex(dependencies), [dependencies]);
  /**
   * 数据流闸门：只在有摘要时构建。没扫过数据流 → null → 影响链行为与 R34 完全一致，
   * 老数据库打开旧分析不会因为缺表/缺列而行为突变。
   */
  const flowGate = useMemo(() => (dataFlowFacts.length > 0 ? buildFlowGate(dataFlowFacts) : null), [dataFlowFacts]);

  // ─── 模块级联动索引（模块实体 ↔ 文件子图，口径与 ModuleRenderer/SVG 报告一致）───
  // 4a) 模块名 → 模块内文件 id 集合（顶层目录口径；从文件直接构建，modules 为空也能联动）
  const moduleFileIdsByName = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const mod of projectModules) if (!m.has(mod.name)) m.set(mod.name, new Set<string>());
    for (const f of projectFiles) {
      if (f.isDirectory) continue;
      const top = topDirOf(f.relPath);
      let set = m.get(top);
      if (!set) {
        set = new Set<string>();
        m.set(top, set);
      }
      set.add(f.id);
    }
    return m;
  }, [projectModules, projectFiles]);

  // 4b) 文件 id → 模块名（反向映射，选中文件时高亮其所属模块实体）
  const fileToModuleName = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of projectFiles) {
      if (f.isDirectory) continue;
      m.set(f.id, topDirOf(f.relPath));
    }
    return m;
  }, [projectFiles]);

  // 4c) 模块级邻接表（模块名 ↔ 模块名，跨模块依赖边聚合；从文件拓扑自动补种子）
  const moduleAdjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const mod of projectModules) if (!m.has(mod.name)) m.set(mod.name, new Set<string>());
    for (const f of projectFiles) {
      if (f.isDirectory) continue;
      const top = topDirOf(f.relPath);
      if (!m.has(top)) m.set(top, new Set<string>());
    }
    for (const d of dependencies) {
      const from = fileToModuleName.get(d.fromId);
      const to = fileToModuleName.get(d.toId);
      if (!from || !to || from === to) continue;
      if (!m.has(from)) m.set(from, new Set());
      if (!m.has(to)) m.set(to, new Set());
      m.get(from)!.add(to);
      m.get(to)!.add(from);
    }
    return m;
  }, [dependencies, fileToModuleName, projectModules, projectFiles]);

  // 5) 当前选中实体 → 关联子图（文件实体：自身 + 依赖/被依赖邻居；模块实体：模块内全部文件 + 模块邻居）
  const selectedCompId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedComp = useMemo(() => {
    if (!selectedCompId) return null;
    return components.find((c) => c.id === selectedCompId) ?? null;
  }, [selectedCompId, components]);

  const selectedFileId = useMemo(() => {
    if (!selectedCompId) return null;
    return fileIdByCompId.get(selectedCompId) ?? null;
  }, [selectedCompId, fileIdByCompId]);

  /** 选中实体若是模块实体 / 矩形树图 cell → 模块名（config.moduleName/name 兜底）
   *  v2.18 耦合矩形树图联动：单击 treemap-cell 即高亮该模块全部相关实体（relatedModuleNames 已支持 module 级）。 */
  const selectedModuleName = useMemo(() => {
    if (!selectedComp) return null;
    if (selectedComp.type !== 'module' && selectedComp.type !== 'treemap-cell') return null;
    const cfg = (selectedComp.config ?? {}) as Record<string, unknown>;
    const n = typeof cfg.moduleName === 'string' ? cfg.moduleName : typeof cfg.name === 'string' ? cfg.name : null;
    return n || (moduleFileIdsByName.has(selectedComp.name) ? selectedComp.name : null);
  }, [selectedComp, moduleFileIdsByName]);

  /** 选中实体若是符号实体（代码结构画像）→ 符号 id（config.symbolId + portraitMode=symbols） */
  const selectedSymbolId = useMemo(() => {
    if (!selectedComp) return null;
    const cfg = (selectedComp.config ?? {}) as Record<string, unknown>;
    if (cfg.portraitMode !== 'symbols') return null;
    return typeof cfg.symbolId === 'string' ? cfg.symbolId : null;
  }, [selectedComp]);

  /** 选中文件实体 → 其所属模块名（文件↔模块联动反向高亮） */
  const selectedFileModuleName = useMemo(() => {
    if (!selectedFileId) return null;
    return fileToModuleName.get(selectedFileId) ?? null;
  }, [selectedFileId, fileToModuleName]);

  /**
   * ─── 影响链传播（本轮核心：把「谁挨着我」升级成「改了我会传多远」）───
   *
   * 根集合：选中文件 → 它自己；选中模块 → 模块内全部文件（多源 BFS）。
   * 通道由 buildImpactChain 自动挑：调用图里有该文件的符号就走符号级，否则退文件级。
   */
  const chainRootFileIds = useMemo(() => {
    if (selectedFileId) return [selectedFileId];
    if (selectedModuleName) {
      const modFiles = moduleFileIdsByName.get(selectedModuleName);
      if (modFiles && modFiles.size > 0) return [...modFiles];
    }
    return [];
  }, [selectedFileId, selectedModuleName, moduleFileIdsByName]);

  const impactChain = useMemo(() => {
    if (chainDepth < 1 || chainRootFileIds.length === 0) return null;
    const chain = buildImpactChain({
      rootFileIds: chainRootFileIds,
      maxDepth: chainDepth,
      callIndex,
      fileDepIndex,
      symbolsByFile,
      flowGate,
    });
    return chain.source === 'none' ? null : chain;
  }, [chainDepth, chainRootFileIds, callIndex, fileDepIndex, symbolsByFile, flowGate]);

  const chainView = useMemo(() => chainLookup(impactChain), [impactChain]);

  /**
   * 测试影响分析（TIA）：影响链算出「会波及谁」之后，直接回答「该跑哪些测试」。
   * 这是把分析结论落到工程动作上的最后一公里 —— CI 里只跑这批用例即可覆盖本次改动。
   */
  const relPathById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of projectFiles) if (!f.isDirectory) m.set(f.id, f.relPath);
    return m;
  }, [projectFiles]);

  const testImpact = useMemo(
    () => (impactChain ? testImpactOf(impactChain, (id) => relPathById.get(id)) : null),
    [impactChain, relPathById],
  );

  /** 把任意文本写入剪贴板（CI 通道 / 命令 / 清单通用，带 toast 反馈） */
  const copyText = useCallback((text: string, okMsg: string, fallbackMsg: string) => {
    const toast = useToastStore.getState();
    try {
      const p = navigator.clipboard?.writeText(text);
      if (p)
        p.then(
          () => toast.showToast(okMsg, 'success'),
          () => toast.showToast(fallbackMsg, 'info'),
        );
      else toast.showToast(fallbackMsg, 'info');
    } catch {
      toast.showToast(fallbackMsg, 'info');
    }
  }, []);

  /** TIA 报告 → 可运行命令计划（按运行器分组；纯函数，零 store 依赖） */
  const testCommandPlan = useMemo(
    () => (testImpact && testImpact.tests.length > 0 ? buildTestCommands(testImpact) : null),
    [testImpact],
  );

  /** 影响链浮层里的 TIA 详情弹层锚点 */
  const [tiaAnchor, setTiaAnchor] = useState<HTMLElement | null>(null);
  const tiaOpen = Boolean(tiaAnchor);

  // v2.29 直接订阅象限聚焦态（本函数作用域内订阅，确保 useMemo 依赖其变化重算）。
  // 此前用 useEditorStore.getState() 非响应式读取 → 点击象限标签后 relatedFileIds 不刷新 → 聚焦高亮静默失效。
  const quadZoneFocus = useEditorStore((s2) => s2.quadrantFocusZone);
  const relatedFileIds = useMemo(() => {
    // v2.28 重构四象限聚焦：选中某一象限 → 该象限全部文件 id 集合即关联集，
    // 渲染侧按 existing relatedFileIds 逻辑高亮命中、淡化其余（回答「先重构谁」）。
    // 与 selectedFileId/selectedModuleName 正交：聚焦象限时单独生效，不叠加其它高亮。
    // 注意：必须读订阅态 quadZoneFocus（而非 useEditorStore.getState()），否则
    // quadrantFocusZone 变化不会触发本 memo 重算 → 点击象限标签后高亮/淡化永远不刷新（静默死功能）。
    const quadZone = quadZoneFocus;
    if (quadZone) {
      const set = new Set<string>();
      for (const c of components) {
        if (
          c.type === 'file' &&
          (c.config as any)?.portraitMode === 'quadrant' &&
          (c.config as any)?.quadrant === quadZone
        ) {
          set.add(c.id);
        }
      }
      return set.size > 0 ? set : null;
    }
    if (!selectedFileId && !selectedModuleName) return null;
    // 影响链启用且有结果 → 关联子图 = 整条传播链（含根），旧的单跳邻接是它的子集
    if (impactChain && chainView.size > 0) {
      const set = new Set(chainView.fileIds);
      if (selectedModuleName) {
        // 模块实体：模块内文件始终算「自己人」，即便它们没参与调用图
        const modFiles = moduleFileIdsByName.get(selectedModuleName);
        if (modFiles) for (const id of modFiles) set.add(id);
      }
      return set;
    }
    const set = new Set<string>();
    if (selectedFileId) {
      set.add(selectedFileId);
      const nb = adjacency.get(selectedFileId);
      if (nb) for (const id of nb) set.add(id);
    } else if (selectedModuleName) {
      // 模块实体：模块内全部文件即「关联子图」
      const modFiles = moduleFileIdsByName.get(selectedModuleName);
      if (modFiles) for (const id of modFiles) set.add(id);
    }
    return set;
  }, [
    selectedFileId,
    selectedModuleName,
    adjacency,
    moduleFileIdsByName,
    impactChain,
    chainView,
    components,
    quadZoneFocus,
  ]);

  // v2.29 象限区实时文件计数：从当前画布组件里统计「象限画像文件节点」落点，
  // 让四个象限标签直接显示「该象限 N 个文件」，分布一眼可见（无需依赖 toast 文案）。
  // 仅统计 portraitMode==="quadrant" 的 file 节点，避免其它画像实体干扰计数。
  const quadrantZoneCounts = useMemo(() => {
    const counts: Record<string, number> = { refactorFirst: 0, legacyStable: 0, activeSimple: 0, healthy: 0 };
    for (const c of components) {
      if (c.type !== 'file') continue;
      const cfg = (c.config ?? {}) as Record<string, unknown>;
      if (cfg.portraitMode !== 'quadrant') continue;
      const z = cfg.quadrant;
      if (typeof z === 'string' && z in counts) counts[z] += 1;
    }
    return counts;
  }, [components]);

  /** 与选中实体相关的模块名集合（选中模块 → 自身+模块邻居；选中文件 → 所属模块） */
  const relatedModuleNames = useMemo(() => {
    if (selectedModuleName) {
      const set = new Set<string>([selectedModuleName]);
      const nb = moduleAdjacency.get(selectedModuleName);
      if (nb) for (const n of nb) set.add(n);
      return set;
    }
    if (selectedFileModuleName) {
      // 文件选中 → 其所属模块实体反向点亮（文件↔模块联动）
      return new Set<string>([selectedFileModuleName]);
    }
    return null;
  }, [selectedModuleName, selectedFileModuleName, moduleAdjacency]);

  /**
   * 符号级调用邻居（代码结构画像 v2.1）：选中符号实体 → 画布上
   * 「调用它 / 它调用」的符号同时点亮。与文件级 relatedFileIds 正交：
   * 符号实体也带 fileId，文件级联动照旧工作，两者叠加不冲突。
   * 返回 null 表示没有邻居（叶子符号）——此时不淡化其它符号。
   */
  const relatedSymbolIds = useMemo(() => {
    if (!selectedSymbolId) return null;
    const set = new Set<string>();
    for (const e of callEdges) {
      if (e.callerSymbolId === selectedSymbolId) {
        if (e.calleeSymbolId) set.add(e.calleeSymbolId);
      } else if (e.calleeSymbolId === selectedSymbolId) {
        if (e.callerSymbolId) set.add(e.callerSymbolId);
      }
    }
    return set.size > 0 ? set : null;
  }, [selectedSymbolId, callEdges]);

  // 6) 选中 id 集合（map 内 O(1) 判断，避免每次渲染对每实体跑 includes）
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /**
   * v2.17 依赖画像筛选镜 → 命中实体集合（用于淡化其余实体）。
   * - cycles：节点 config.inCycle 或边 config.inCycle/isCircular 命中即保留；
   * - crossModule：config.crossModule 的边 + 其两端节点保留；
   * 仅在依赖画像视图内生效（按 portraitMode==="dependency" 判定，不依赖 i18n 视图名），
   * 避免切换其它画像后残留筛选镜误淡化。返回 null 表示「不过滤」。
   */
  const depActiveIds = useMemo(() => {
    if (depFilter === 'all') return null;
    const isDepView = components.some((c) => (c.config as any)?.portraitMode === 'dependency');
    if (!isDepView) return null;
    const fileToComp = new Map<string, string>();
    for (const [cid, fid] of fileIdByCompId) fileToComp.set(fid, cid);
    const active = new Set<string>();
    if (depFilter === 'cycles') {
      for (const c of components) {
        const cfg = (c.config ?? {}) as any;
        if (c.type === 'dependency-edge') {
          if (cfg.inCycle === true || cfg.isCircular === true) active.add(c.id);
        } else if (cfg.inCycle === true) {
          active.add(c.id);
        }
      }
    } else {
      // crossModule：跨模块边 + 两端节点
      for (const c of components) {
        if (c.type !== 'dependency-edge') continue;
        const cfg = (c.config ?? {}) as any;
        if (cfg.crossModule === true) {
          active.add(c.id);
          const from = typeof cfg.fromFileId === 'string' ? cfg.fromFileId : null;
          const to = typeof cfg.toFileId === 'string' ? cfg.toFileId : null;
          if (from) {
            const id = fileToComp.get(from);
            if (id) active.add(id);
          }
          if (to) {
            const id = fileToComp.get(to);
            if (id) active.add(id);
          }
        }
      }
    }
    return active;
  }, [depFilter, components, fileIdByCompId]);

  // v2.21 依赖画像筛选镜命中为空 → 提示（避免静默全 dim 让用户以为「图没了」）。
  // 仅在「筛选生效且命中集为空」的瞬间弹一次，避免每次渲染重复弹。
  const prevDepFilterEmpty = useRef(false);
  useEffect(() => {
    const isEmpty = depActiveIds != null && depActiveIds.size === 0;
    if (isEmpty && !prevDepFilterEmpty.current) {
      useToastStore.getState().showToast(t('editor.depFilterEmpty'), 'info');
    }
    prevDepFilterEmpty.current = isEmpty;
  }, [depActiveIds, depFilter]);

  // 7b) 图片详情弹窗状态（画布双击 / 目录树双击 / 画像面板「查看大图」统一从 editorStore 取）
  const imagePreview = useEditorStore((s) => s.imagePreview);
  const closeImagePreview = useEditorStore((s) => s.closeImagePreview);

  // ─── 模块下钻：模块实体 → 展开内部文件子图（业务联动的"走进去"）───
  // drillOwnerId 索引：哪些模块实体当前处于展开态（角标显示 − 而不是 +）
  const expandedOwnerIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of components) {
      const owner = (c.config as any)?.drillOwnerId;
      if (typeof owner === 'string' && owner) s.add(owner);
    }
    return s;
  }, [components]);

  const drillBusyRef = useRef(false);
  const handleToggleDrill = useCallback(async (comp: SceneComponent) => {
    if (drillBusyRef.current) return;
    drillBusyRef.current = true;
    try {
      const analysisId = useSceneStore.getState().activeSceneId;
      const res = await toggleModuleDrill(comp, analysisId);
      useToastStore.getState().showToast(res.message, res.severity);
    } catch (e) {
      console.error('[drill] toggle failed', e);
      useToastStore.getState().showToast(t('editor.drillFail'), 'error');
    } finally {
      drillBusyRef.current = false;
    }
  }, []);

  // ─── 实体拖拽移动（biosphere 核心交互 A.3：单击选中 / 拖拽移动）───
  // memo 节点 + 只更新 transform，拖动帧只重渲染被拖实体，其余实体跳过。
  const updateComponentTransform = useEditorStore((s) => s.updateComponentTransform);
  const dragStateRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  // P2 网格吸附：写作实体/便签按 10px 栅格取整，代码实体不吸附（零回归）
  const WRITING_SNAP = 10;
  const WRITING_SNAP_TYPES = useMemo(
    () =>
      new Set([
        'writing-chapter',
        'writing-character',
        'writing-outline',
        'writing-worldview',
        'writing-workbench',
        'annotation-text',
      ]),
    [],
  );
  const handleNodeDragStart = useCallback(
    (e: React.MouseEvent, comp: SceneComponent) => {
      if (e.button !== 0) return;
      // 连线 / 分层标记 / 象限背景区不可拖拽（象限背景纯装饰，pointer-events 已在 shell 层 none）
      if (comp.type === 'dependency-edge' || comp.type === 'layer-marker' || comp.type === 'quadrant-zone-bg') return;
      // 默认目录树视图：代码场景实体由画像引擎自动布局（含树形引导线），
      // 手动拖动会破坏缩进结构与父子连线，故禁止拖动。
      // 书场景（novel-zh）例外：画布是自由排版板（全书总览卡 + 拖入元素），
      // 没有树形引导线，「拖入元素后编版」正是它的核心交互 —— default 视图也必须可拖。
      const ss = useSceneStore.getState();
      const isBookScene = ss.scenes.find((sc) => sc.id === ss.activeSceneId)?.primaryLanguage === 'novel-zh';
      const activeViewId = useEditorStore.getState().activeViewId;
      // DIAGNOSTIC：拖不动的排查锚点 2/2 —— mousedown 是否到达壳层、被哪个守卫拦下。
      // 上游锚点 1/2 在渲染器（WritingDesignView.paneMouseDown 分流）。
      logger.info('SceneEditor', 'DIAGNOSTIC entity mousedown reached shell', {
        type: comp.type,
        id: comp.id,
        activeViewId,
        isBookScene,
      });
      if (activeViewId === 'default' && !isBookScene) return;
      e.preventDefault();
      e.stopPropagation();
      // 拖拽即选中（与 biosphere 单击选中/拖拽移动一致）
      selectComponent(comp.id, false);
      dragStateRef.current = {
        id: comp.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: comp.transform.x,
        origY: comp.transform.y,
      };
    },
    [selectComponent],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      // 用 live 视口的 scale（state 是节流的，拖实体时若刚缩放过会算错位移）
      const s = viewportRef.current.scale;
      let x = Math.max(0, st.origX + (e.clientX - st.startX) / s);
      let y = Math.max(0, st.origY + (e.clientY - st.startY) / s);
      // P2 网格吸附：写作实体/便签按 10px 栅格取整（分镜排版对齐），
      // 代码实体不吸附（保护既有画像布局习惯，零回归）
      const live = useEditorStore.getState().components.find((c) => c.id === st.id);
      if (live && WRITING_SNAP_TYPES.has(live.type)) {
        x = Math.round(x / WRITING_SNAP) * WRITING_SNAP;
        y = Math.round(y / WRITING_SNAP) * WRITING_SNAP;
      }
      updateComponentTransform(st.id, { x, y });
    };
    const onUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [updateComponentTransform, viewportRef]);

  // ─── V4 拍板：载体 = 铺满画布的载体视图，拖动/缩放均无意义，实体缩放手柄已移除 ───

  // ─── 左侧面板/文件树定位联动：监听 focusRequest 居中组件 ───
  const prevFocusTs = useRef(0);
  useEffect(() => {
    if (!focusRequest || focusRequest.ts === prevFocusTs.current) return;
    prevFocusTs.current = focusRequest.ts;
    const comp = components.find((c) => c.id === focusRequest.id);
    if (!comp || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const s = viewportRef.current.scale;
    const cx = comp.transform.x + (comp.transform.width || 0) / 2;
    const cy = comp.transform.y + (comp.transform.height || 0) / 2;
    // 居中：offset = 视口中心 - 组件中心 * scale（平滑滑入，而非瞬移）
    setViewportAnimated({ scale: s, offset: { x: rect.width / 2 - cx * s, y: rect.height / 2 - cy * s } });
  }, [focusRequest, components, setViewportAnimated, viewportRef]);

  // ─── 画布统筹全局：监听 fitRequest 自动适配视口（同步到画布/画像重建后）───
  // 计算全部实体包围盒 → 缩放/平移使内容全览，等效「一键俯瞰整个项目结构」
  //
  // 令牌消费时机（竞态修复）：只有 fit 真正执行才推进 prevFitTs。
  // 此前先推进令牌再检查前置条件 —— fitRequest 到达时若画布恰好为空
  // （同步「清空→重建」间隙 / 场景重载竞态 / 容器尺寸为 0），令牌被静默
  // 吞掉且永不重试，画布停在错误视口，观感就是「实体渲染不出来」。
  // 现在令牌保留，实体/容器就绪后本 effect 依依赖变化自动重跑补做。
  const prevFitTs = useRef(0);
  useEffect(() => {
    if (!fitRequest || fitRequest.ts === prevFitTs.current) return;
    const el = canvasRef.current;
    if (!el || components.length === 0) {
      logger.throttled(
        'canvas.fitSkipEmpty',
        'ProjectCanvas',
        'fit effect skipped: no canvas or no components',
        () => ({
          hasCanvas: !!el,
          componentsCount: components.length,
          fitRequestTs: fitRequest?.ts,
        }),
      );
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      logger.throttled('canvas.fitSkipZero', 'ProjectCanvas', 'fit effect skipped: canvas size zero', () => ({
        rectWidth: rect.width,
        rectHeight: rect.height,
        canvasSize,
      }));
      return;
    }
    prevFitTs.current = fitRequest.ts;
    // fitRequest.ids 存在时只适配这批实体（R32：左侧面板搜索命中 → 只把命中集合框进视野），
    // 命中实体一个都不在画布上时回退全览，绝不把视口移到空白处
    const targets =
      fitRequest.ids && fitRequest.ids.length > 0
        ? components.filter((c) => fitRequest.ids!.includes(c.id))
        : components;
    // 铺满画布的写作容器卡已经不在画布坐标系里（视口贴面渲染，见 fullBleedComp）——
    // 把它算进包围盒，会让「适应画布」按 1920×1080 缩到 0.46 倍并把视口挪到居中，
    // 同视图里新落的实体卡跟着变成蚂蚁。全部被过滤掉（视图里只有编辑面）时不 fit：
    // 画布上确实没有可框的东西，编辑面本就铺满视口 —— 是「无事可做」，不是静默 no-op。
    const canvasTargets = targets.filter((c) => !isFullCanvasWritingCard(c.type));
    const bounds = contentBounds(canvasTargets);
    const next =
      canvasTargets.length > 0 ? fitViewport(bounds, { width: rect.width, height: rect.height }, ZOOM_LIMITS) : null;
    logger.throttled(
      'canvas.fit',
      'ProjectCanvas',
      'fit effect computed viewport',
      () => ({
        fitRequestTs: fitRequest.ts,
        targetCount: canvasTargets.length,
        skippedFullBleed: targets.length - canvasTargets.length,
        bounds,
        containerSize: { width: rect.width, height: rect.height },
        computedViewport: next,
      }),
      1000,
    );
    if (next) setViewportAnimated(next);
  }, [fitRequest, components, setViewportAnimated, ZOOM_LIMITS, canvasSize.width, canvasSize.height]);

  // 打开上下文菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // 铺满画布的写作编辑区（贴面层）**不是画布实体**，而载体卡**里面**的正文也一样：
      // 文书编辑区的右键属于写作 —— 正文（TipTap）的剪切 / 复制 / 粘贴 / 拼写、大纲
      // 输入框的拼写检查都要原生菜单。而画布实体菜单对贴面层 9 项里 7 项是静默 no-op
      // （贴面层不走变换层 → 层级/锁定/隐藏都动不了；复制出的第二张被 findFullBleedCard
      // 忽略），只有「删除」有反应 —— 反应是编辑区整块消失。
      // 所以这里**直接放行：既不弹菜单，也不 preventDefault**，让事件冒泡到原生菜单。
      // 判定收在 shouldYieldToNativeContextMenu（贴面层标记 + 书场景可编辑区），
      // 代码场景两个条件都命中不了 → 行为一行未动。
      if (shouldYieldToNativeContextMenu(e.target as HTMLElement, isBookScene)) return;
      e.preventDefault();
      // 查找点击的目标组件
      const target = (e.target as HTMLElement).closest('[data-component-id]');
      const componentId = target ? target.getAttribute('data-component-id') : null;

      setContextMenu(contextMenu === null ? { mouseX: e.clientX, mouseY: e.clientY, componentId } : null);
    },
    [contextMenu, isBookScene],
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ─── 拖放处理 ───
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragOver) {
        // DIAGNOSTIC：首次进入画布的 dragover（拖拽信号已建立，画布可接收 drop）
        logger.info('SceneEditor', 'DragOver first hit on canvas', {
          types: e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [],
        });
        setIsDragOver(true);
      }

      // 更新拖放预览位置（用 live 视口换算，平移中也准）
      setDragPreview(clientToCanvas(e.clientX, e.clientY));
    },
    [isDragOver, clientToCanvas],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 仅在真正离开画布时清除（避免子元素冒泡干扰）
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setDragPreview(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      setDragPreview(null);

      // ─── DIAGNOSTIC（对标 biosphere EditorCanvas Drop 入口日志）：
      // 拖入创建曾「拖了没反应」且零日志黑盒，这里把 drop 收到的全部信号打出来
      logger.info('SceneEditor', 'Drop event triggered', {
        hasDataTransfer: !!e.dataTransfer,
        allDataTypes: e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [],
      });

      const entityType = e.dataTransfer.getData('application/x-project-entity');
      if (!entityType) {
        // 绝不静默：drop 收到但拿不到实体类型信号（WKWebView 自定义 MIME 偶发 quirk）
        logger.warn('SceneEditor', 'Drop without entity type signal', {
          types: e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [],
        });
        useToastStore.getState().showToast(t('editor.dropNoSignal'), 'warning');
        return;
      }

      // 可选业务 payload（P0 拖入通路）：左栏写作实体行拖出时附带 name/config，
      // 拖进去的卡直接绑定真实业务数据（人物名/戏份/主出场章），不再是空壳。
      // payload 缺失或损坏时按旧链路处理（只建类型壳），零回归。
      let payload: { name?: string; config?: Record<string, unknown> } = {};
      const raw = e.dataTransfer.getData('application/x-project-entity-data');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { name?: unknown; config?: unknown };
          if (typeof parsed.name === 'string') payload.name = parsed.name;
          if (parsed.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config)) {
            payload.config = parsed.config as Record<string, unknown>;
          }
        } catch {
          /* payload 损坏：忽略，类型本身仍可拖入 */
        }
      }

      // 坐标在 await 前取死（事件对象异步后不可依赖）
      const pt = clientToCanvas(e.clientX, e.clientY);
      // 默认位置：实体大小 140x60，居中于鼠标位置
      const defaultSize = componentRegistry.get(entityType)?.defaultSize || { width: 140, height: 60 };
      const posX = Math.max(0, pt.x - defaultSize.width / 2);
      const posY = Math.max(0, pt.y - defaultSize.height / 2);

      const finishDrop = () => {
        // ─── 载体视图：题材拖入 → **新建一本作品**（L1 多一个页签）+ 落该体裁的大纲编辑视图；
        // 章节拖入 → 当前作品容器内 L3 页签（幂等，按 chapterId 命中）。
        // 无题材的遗留 payload 保留旧「铺满设计卡视图」链路，零回归。 ───
        if (entityType === 'writing-workbench') {
          const cfgRaw = payload.config as Record<string, unknown> | undefined;
          const dropGenre = typeof cfgRaw?.genre === 'string' ? cfgRaw.genre : '';
          const dropChapterId = typeof cfgRaw?.chapterId === 'string' ? cfgRaw.chapterId : '';
          if (dropChapterId) {
            // 章节拖入 → 容器视图 L3 页签（章节已存在，跳过建档）
            openChapterCarrierView(dropChapterId, payload.name || '', dropGenre, parseBookIdFromScene());
            useToastStore
              .getState()
              .showToast(t('editor.carrierViewSwitched', { name: payload.name || dropChapterId }), 'info');
            return;
          }
          if (dropGenre) {
            // 【语义变更 2026-09-12】拖载体 = **新建一本作品**，不再「命中同题材视图就复用」。
            // L1 从「题材分组」改成「作品页签」后，题材只有固定四项，复用会让
            // 「再拖一次小说」永远表现为无反应；用户预期是「再拖小说 = 新建一本书 = 新建一个 L1」。
            // 建书与「L1 ＋」用同一条链路（createBookAutoNamed），两个入口语义一致。
            // 【2026-09-21 修订】空书画布例外：拖载体 = 打开当前书的大纲编辑视图 ——
            // 「拖入载体」空态引导邀请的就是开始创作**当前书**，此时再建一本毫无道理。
            if (dropOpensCurrentBookView(isBookScene, dropGenre)) {
              useToastStore
                .getState()
                // 视图名按体裁（㉛ T-F）：拖「剧本」进空书，toast 不该报「已切换到大纲」
                .showToast(t('editor.carrierViewSwitched', { name: t(viewKindLabelKey(dropGenre, 'catalog')) }), 'info');
              return;
            }
            void createBookFromCarrierDrop(dropGenre)
              .then((b) => {
                useToastStore.getState().showToast(t('studio.createdInStudio', { title: b.title }), 'success');
              })
              .catch((err) => {
                logger.warn('SceneEditor', 'carrier drop → create book failed', { dropGenre, error: String(err) });
                useToastStore.getState().showToast(t('viewTab.bookOpFail'), 'error');
              });
            return;
          }
          // 无题材（遗留/未知 payload）：旧「铺满设计卡视图」链路原样保留
          const rect = canvasRef.current?.getBoundingClientRect();
          const tl = clientToCanvas(rect?.left ?? 0, rect?.top ?? 0);
          const br = clientToCanvas(rect?.right ?? 800, rect?.bottom ?? 600);
          const pos = { x: Math.round(tl.x), y: Math.round(tl.y) };
          const size = {
            width: Math.max(320, Math.round(br.x - tl.x)),
            height: Math.max(240, Math.round(br.y - tl.y)),
          };
          const viewName = dedupViewName(payload.name || t('writingDesign.designView'));
          addView(viewName, { meta: { carrierType: dropGenre || undefined } });
          const comp = addComponent(entityType, undefined, pos);
          if (!comp) {
            logger.warn('SceneEditor', 'Drop create failed: addComponent returned null', {
              entityType,
              layerCount: useEditorStore.getState().layers.length,
              registered: !!componentRegistry.get(entityType),
            });
            useToastStore.getState().showToast(t('editor.dropCreateFail', { type: entityType }), 'error');
            return;
          }
          updateComponentTransform(comp.id, { ...pos, ...size });
          if (payload.name) updateComponent(comp.id, { name: payload.name });
          const cfg = payload.config;
          if (cfg) {
            const rest = { ...(cfg as Record<string, unknown>) };
            delete rest.__blank;
            if (Object.keys(rest).length > 0) updateComponentConfig(comp.id, rest);
          }
          deselectAll();
          logger.info('SceneEditor', 'Carrier view drop ok', {
            compId: comp.id,
            size,
            viewName,
            carrierType: dropGenre || undefined,
            withPayload: Object.keys(payload).length > 0,
          });
          return;
        }

        const comp = addComponent(entityType, undefined, { x: posX, y: posY });
        if (!comp) {
          // 绝不静默：addComponent 失败（类型未注册/无图层）必须让用户知道
          logger.warn('SceneEditor', 'Drop create failed: addComponent returned null', {
            entityType,
            layerCount: useEditorStore.getState().layers.length,
            registered: !!componentRegistry.get(entityType),
          });
          useToastStore.getState().showToast(t('editor.dropCreateFail', { type: entityType }), 'error');
          return;
        }

        // 业务绑定：name 走 updateComponent，config 走 merge 式 updateComponentConfig
        const cfg = payload.config;
        if (payload.name) updateComponent(comp.id, { name: payload.name });
        if (cfg) {
          const rest = { ...(cfg as Record<string, unknown>) };
          delete rest.__blank;
          if (Object.keys(rest).length > 0) updateComponentConfig(comp.id, rest);
        }
        logger.info('SceneEditor', 'Drop create ok', {
          entityType,
          compId: comp.id,
          withPayload: Object.keys(payload).length > 0,
        });
      };

      // G3 前置拦截（必须在 __blank 建档流程之前——createBlankWritingEntity 会覆写
      // payload 丢掉 chapterId）：writing-workbench 的题材/章节拖入走容器视图链路。
      if (entityType === 'writing-workbench') {
        const preCfg = payload.config as Record<string, unknown> | undefined;
        const preGenre = preCfg && typeof preCfg.genre === 'string' ? preCfg.genre : '';
        if (preCfg && typeof preCfg.chapterId === 'string' && preCfg.chapterId) {
          // 章节拖入 → 容器视图 L3 页签（章节已存在，跳过建档）
          openChapterCarrierView(preCfg.chapterId, payload.name || '', preGenre, parseBookIdFromScene());
          useToastStore
            .getState()
            .showToast(t('editor.carrierViewSwitched', { name: payload.name || preCfg.chapterId }), 'info');
          return;
        }
        if (preCfg && preCfg.__blank === true) {
          // 题材载体拖入 = **新建一本作品**（2026-09-12 语义变更，与 finishDrop 的题材分支、
          // 与 SceneTabBar 的 L1「＋」共用 createBookFromCarrierDrop 一条链路）。
          // 【2026-09-21 修订】空书画布例外：打开当前书的大纲编辑视图，不新建
          // （同 finishDrop 题材分支，见 dropOpensCurrentBookView）。
          if (preGenre) {
            if (dropOpensCurrentBookView(isBookScene, preGenre)) {
              useToastStore
                .getState()
                // 同上：blank 载体走的是这条通路，两处必须同一个解析器（㉛ T-F）
                .showToast(t('editor.carrierViewSwitched', { name: t(viewKindLabelKey(preGenre, 'catalog')) }), 'info');
              return;
            }
            void createBookFromCarrierDrop(preGenre)
              .then((b) => {
                useToastStore.getState().showToast(t('studio.createdInStudio', { title: b.title }), 'success');
              })
              .catch((err) => {
                logger.warn('SceneEditor', 'blank carrier drop → create book failed', {
                  preGenre,
                  error: String(err),
                });
                useToastStore.getState().showToast(t('viewTab.bookOpFail'), 'error');
              });
          } else {
            // 无体裁的 __blank（异常/外部 payload）：保持旧链路，但必须留痕 ——
            // 这种 payload 建出的视图没有 carrierType，会被遗留清理 effect 回收成静默空白。
            logger.warn('SceneEditor', 'blank carrier payload without genre', { entityType });
            const { docsCompId } = ensureCarrierContainer('', parseBookIdFromScene());
            if (!docsCompId) {
              useToastStore.getState().showToast(t('editor.dropCreateFail', { type: 'writing-docs' }), 'error');
            } else {
              useToastStore
                .getState()
                .showToast(t('editor.carrierViewCreated', { name: t('writing.viewKind.writing') }), 'success');
            }
          }
          return;
        }
        // 非 __blank 的 writing-workbench payload（遗留/外部拖入）：走 finishDrop 旧链路
      }

      // 业务闭环（IA 收口 P3）：货架 blank 模板落画布时**真建档**再落卡 ——
      // 章节 createChapter（确定性绑定 wfile_{id}）、人物/世界观 createSetting。
      // 建档失败（非书场景/写库异常）降级为普通空壳卡，绝不静默且不阻塞拖放。
      if (payload.config && (payload.config as Record<string, unknown>).__blank === true) {
        const genreHint =
          typeof (payload.config as Record<string, unknown>).genre === 'string'
            ? ((payload.config as Record<string, unknown>).genre as string)
            : '';
        const chapterIdHint =
          typeof (payload.config as Record<string, unknown>).chapterId === 'string'
            ? ((payload.config as Record<string, unknown>).chapterId as string)
            : '';
        void createBlankWritingEntity(entityType, genreHint, chapterIdHint)
          .then((bound) => {
            if (bound) {
              payload = { name: bound.name, config: bound.config };
              useToastStore.getState().showToast(t('editor.blankEntityBound', { name: bound.name }), 'success');
            } else {
              delete (payload.config as Record<string, unknown>).__blank;
              // 联动不静默：非书场景降级为属性卡（体裁/默认字段已 merge 上卡），明示未建档
              useToastStore.getState().showToast(t('editor.blankShellCard', { type: entityType }), 'info');
            }
          })
          .catch((err) => {
            logger.warn('SceneEditor', 'blank entity bind failed, falling back to shell card', {
              entityType,
              error: String(err),
            });
            delete (payload.config as Record<string, unknown>).__blank;
            useToastStore.getState().showToast(t('editor.blankEntityBindFail', { type: entityType }), 'warning');
          })
          .finally(finishDrop);
        return;
      }

      finishDrop();
    },
    [
      clientToCanvas,
      addComponent,
      updateComponent,
      updateComponentConfig,
      addView,
      deselectAll,
      updateComponentTransform,
    ],
  );

  return (
    <Box
      sx={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖放预览 */}
      {isDragOver && dragPreview && (
        <Box
          sx={{
            position: 'absolute',
            left: dragPreview.x * scale + panOffset.x,
            top: dragPreview.y * scale + panOffset.y,
            width: 140,
            height: 60,
            border: '2px dashed',
            borderColor: 'primary.main',
            borderRadius: 1,
            backgroundColor: (t) =>
              t.palette.mode === 'dark'
                ? 'rgb(var(--template-palette-primary-mainChannel) / 0.12)'
                : 'rgb(var(--template-palette-primary-mainChannel) / 0.08)',
            zIndex: 20,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="caption" sx={{ color: 'primary.main', fontSize: uiFontSize(10) }}>
            {t('editor.placeEntity')}
          </Typography>
        </Box>
      )}

      {/* ─── 影响链控制器（左上角浮层）───────────────────────────────────────
          「选中一个文件，画布告诉我改它会炸到谁」—— 这是画布从「静态画像」
          走向「可交互的分析工具」的关键一步。跳数点击循环：1 → 2 → 3 → 关。

          书场景（写作）不出：这是代码分析语汇，小说创作里没有对应物
          （用户点名「影响链 · 3 跳，我们不需要」）。整条链在书场景已被
          chainDepth=0 强制关闭，所以图例 / TIA 弹层 / 跳数角标自然全空 ——
          这里只需把控制器本体摘掉。外层定位 Box 保留（空容器，pointerEvents:none，
          零视觉影响），代码场景的结构一行未动。 */}
      <Box
        sx={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 11,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          alignItems: 'flex-start',
          maxWidth: 320,
          pointerEvents: 'none',
        }}
      >
        {!isBookScene && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              pointerEvents: 'auto',
              backgroundColor: 'rgb(var(--template-palette-background-paperChannel) / 0.88)',
              backdropFilter: 'blur(8px)',
              borderRadius: 1.5,
              border: 1,
              borderColor: 'divider',
              px: 0.75,
              py: 0.4,
            }}
          >
            <HubIcon sx={{ fontSize: uiFontSize(13), color: chainDepth > 0 ? 'primary.main' : 'text.disabled' }} />
            <Typography
              variant="caption"
              onClick={() => setChainDepth((d) => (d >= 3 ? 0 : d + 1))}
              title={t('editor.chainDepthTip')}
              sx={{
                cursor: 'pointer',
                fontSize: uiFontSize(10),
                lineHeight: 1,
                whiteSpace: 'nowrap',
                color: chainDepth > 0 ? 'text.primary' : 'text.disabled',
                '&:hover': { color: 'primary.main' },
              }}
            >
              {chainDepth > 0 ? t('editor.chainOn', { depth: chainDepth }) : t('editor.chainOff')}
            </Typography>
            {impactChain && (
              <>
                <Box sx={{ width: 1, height: 12, borderRight: 1, borderColor: 'divider', mx: 0.25 }} />
                <Chip
                  size="small"
                  label={impactChain.source === 'callGraph' ? t('editor.impactSymbol') : t('editor.impactFile')}
                  title={impactChain.source === 'callGraph' ? t('editor.impactSymbolTip') : t('editor.impactFileTip')}
                  sx={{
                    height: 15,
                    fontSize: uiFontSize(9),
                    '& .MuiChip-label': { px: 0.5 },
                    bgcolor: impactChain.source === 'callGraph' ? 'success.main' : 'warning.main',
                    color: '#fff',
                  }}
                />
                {/* 数据流剪枝：调用可达 → 数据可达的精度提升，只在真的剪掉东西时才提示 */}
                {impactChain.pruned > 0 && (
                  <Chip
                    size="small"
                    label={t('editor.prunedLabel', { n: impactChain.pruned })}
                    title={t('editor.prunedTip', { n: impactChain.pruned })}
                    sx={{
                      height: 15,
                      fontSize: uiFontSize(9),
                      '& .MuiChip-label': { px: 0.5 },
                      bgcolor: 'info.main',
                      color: '#fff',
                    }}
                  />
                )}
              </>
            )}
          </Box>
        )}

        {/* 影响链图例 + 结论：只在真正命中时出现，不占空画布
            （书场景下 impactChain 恒为 null —— chainDepth 被强制 0，这一支自然不渲染） */}
        {impactChain && impactChain.counts.totalFiles > 0 && (
          <Box
            sx={{
              pointerEvents: 'auto',
              backgroundColor: 'rgb(var(--template-palette-background-paperChannel) / 0.88)',
              backdropFilter: 'blur(8px)',
              borderRadius: 1.5,
              border: 1,
              borderColor: 'divider',
              px: 0.9,
              py: 0.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.4,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {(['upstream', 'downstream', 'both'] as ChainSide[]).map((side) => {
                const n =
                  side === 'upstream'
                    ? impactChain.counts.upstreamFiles
                    : side === 'downstream'
                      ? impactChain.counts.downstreamFiles
                      : 0;
                if (side === 'both' && !impactChain.files.size) return null;
                if (side !== 'both' && n === 0) return null;
                if (side === 'both') return null;
                return (
                  <Box key={side} sx={{ display: 'flex', alignItems: 'center', gap: 0.35 }}>
                    <Box
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        backgroundColor: CHAIN_SIDE_COLOR[side],
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{ fontSize: uiFontSize(9.5), lineHeight: 1, color: 'text.secondary' }}
                    >
                      {t('editor.chainSide.' + side)} {n}
                    </Typography>
                  </Box>
                );
              })}
              {/* 跳数梯度条：与实体描边强度同一口径 */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 0.25 }}>
                {[1, 2, 3].slice(0, chainDepth).map((d) => (
                  <Box
                    key={d}
                    title={t('editor.chainJumpShort', { d })}
                    sx={{
                      width: 10,
                      height: 4,
                      borderRadius: 0.5,
                      backgroundColor: 'text.secondary',
                      opacity: chainDepthStyle(d).opacity,
                    }}
                  />
                ))}
              </Box>
            </Box>
            <Typography
              variant="caption"
              sx={{ fontSize: uiFontSize(9.5), lineHeight: 1.35, color: 'text.secondary', maxWidth: 300 }}
            >
              {summarizeChain(impactChain)}
            </Typography>
            {/* 测试影响分析：把影响面直接翻译成「该跑哪些测试」，点击展开可运行命令 / CI 片段 */}
            {testImpact && (
              <Chip
                size="small"
                icon={<ScienceOutlinedIcon sx={{ fontSize: uiFontSize(11) }} />}
                label={
                  testImpact.tests.length > 0
                    ? t('editor.testImpactLabel', { n: testImpact.tests.length })
                    : t('editor.noTestCoverage')
                }
                onClick={(e) => {
                  if (testImpact.tests.length === 0) {
                    useToastStore.getState().showToast(summarizeTestImpact(testImpact), 'warning');
                    return;
                  }
                  setTiaAnchor(e.currentTarget);
                }}
                title={
                  testImpact.tests.length > 0
                    ? testImpact.tests
                        .map((tst) => t('editor.testItem', { depth: tst.depth, path: tst.relPath }))
                        .join('\n')
                    : t('editor.testImpactTip')
                }
                sx={{
                  height: 17,
                  fontSize: uiFontSize(9),
                  alignSelf: 'flex-start',
                  cursor: 'pointer',
                  '& .MuiChip-label': { px: 0.6 },
                  '& .MuiChip-icon': { ml: 0.5, mr: -0.3 },
                  bgcolor: testImpact.tests.length > 0 ? 'info.main' : 'error.main',
                  color: '#fff',
                  '&:hover': { opacity: 0.85 },
                }}
              />
            )}
            <Popover
              open={tiaOpen}
              anchorEl={tiaAnchor}
              onClose={() => setTiaAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
              <Box sx={{ width: 440, maxHeight: 460, overflow: 'auto', p: 1.5 }}>
                {!testImpact || testImpact.tests.length === 0 ? (
                  <Alert severity="warning" sx={{ fontSize: uiFontSize(12) }}>
                    {t('editor.tiaAlert')}
                  </Alert>
                ) : (
                  <>
                    <Typography variant="subtitle2" sx={{ fontSize: uiFontSize(12), mb: 0.75 }}>
                      {t('editor.tiaTitle', { n: testImpact.tests.length })}
                    </Typography>
                    {testCommandPlan?.groups.map((g) => (
                      <Box key={g.runner} sx={{ mb: 1 }}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            mb: 0.25,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ fontSize: uiFontSize(10.5), fontWeight: 600, color: 'text.secondary' }}
                          >
                            {resolveFragments(g.label)} · {g.tests.length}
                          </Typography>
                          <Button
                            size="small"
                            startIcon={<ContentCopyIcon sx={{ fontSize: uiFontSize(12) }} />}
                            onClick={() =>
                              copyText(
                                g.command,
                                t('editor.copyCmdOk', { label: g.label }),
                                t('editor.copyCmdFail', { label: g.label }),
                              )
                            }
                            sx={{ minWidth: 0, fontSize: uiFontSize(10), py: 0.2, lineHeight: 1 }}
                          >
                            {t('editor.copy')}
                          </Button>
                        </Box>
                        <Box
                          component="pre"
                          sx={{
                            m: 0,
                            p: 0.75,
                            fontSize: uiFontSize(10.5),
                            lineHeight: 1.4,
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            fontFamily: 'monospace',
                          }}
                        >
                          {g.command}
                        </Box>
                      </Box>
                    ))}
                    <Divider sx={{ my: 1 }} />
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<ContentCopyIcon sx={{ fontSize: uiFontSize(13) }} />}
                        onClick={() =>
                          copyText(testCommandPlan!.allCommandsText, t('editor.copyAllOk'), t('editor.copyFail'))
                        }
                      >
                        {t('editor.allCommands')}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<TerminalIcon sx={{ fontSize: uiFontSize(13) }} />}
                        onClick={() =>
                          copyText(buildCIPipelineScript(testImpact), t('editor.ciScriptOk'), t('editor.copyFail'))
                        }
                      >
                        {t('editor.ciScript')}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<BuildIcon sx={{ fontSize: uiFontSize(13) }} />}
                        onClick={() =>
                          copyText(buildGitHubActionStep(testImpact), t('editor.ghActionsOk'), t('editor.copyFail'))
                        }
                      >
                        GitHub Actions
                      </Button>
                    </Stack>
                  </>
                )}
              </Box>
            </Popover>
          </Box>
        )}
      </Box>

      {/* P2 多选对齐/分布工具条：≥2 个选中实体时浮现 */}
      <AlignToolbar selectedIds={selectedIds} />

      {/* 缩放控制器（底部居中，与 biosphere 一致）
          书场景的编辑视图不给：编辑面铺满画布后视口不再映射到所见画面，
          「− 100% + / 1:1 / 适应 / 导出 PNG」全是按下去画面纹丝不动、
          或把编辑区截成图的按钮。这一条底部横槽留给**编辑区自己的状态栏**
          （大纲：节拍账/未落章/卷；正文：字数/保存态）—— 见 hasCanvasObjects。 */}
      {hasCanvasObjects && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            backgroundColor: 'rgb(var(--template-palette-background-paperChannel) / 0.88)',
            backdropFilter: 'blur(8px)',
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
            px: 1,
            py: 0.5,
          }}
        >
          <Typography
            variant="caption"
            onClick={() => zoomByStep(-1)}
            sx={{
              cursor: 'pointer',
              px: 0.5,
              fontSize: uiFontSize(14),
              lineHeight: 1,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            −
          </Typography>
          <Chip
            label={`${Math.round(scale * 100)}%`}
            size="small"
            variant="outlined"
            onClick={handleResetView}
            sx={{ height: 20, fontSize: uiFontSize(10), cursor: 'pointer' }}
          />
          {/* LOD 模式提示：全览时实体会降级成简卡/色块，这是刻意的性能取舍，
            不加提示历史上被反复误读成「实体没渲染出来」。 */}
          {lod !== 'full' && (
            <span
              title={lod === 'compact' ? t('editor.lodCompactTip') : t('editor.lodBlockTip')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                height: 20,
                padding: '0 6px',
                borderRadius: 10,
                fontSize: uiFontSize(10),
                lineHeight: 1,
                cursor: 'help',
                whiteSpace: 'nowrap',
                color: lod === 'compact' ? CV.primary : CV.warning,
                backgroundColor: lod === 'compact' ? CV.infoSoft : CV.warningSoft,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  backgroundColor: 'currentColor',
                }}
              />
              {lod === 'compact' ? t('editor.lodCompact') : t('editor.lodBlock')}
            </span>
          )}
          <Typography
            variant="caption"
            onClick={() => zoomByStep(1)}
            sx={{
              cursor: 'pointer',
              px: 0.5,
              fontSize: uiFontSize(14),
              lineHeight: 1,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            +
          </Typography>
          <Box sx={{ width: 1, height: 14, mx: 0.25, borderRight: 1, borderColor: 'divider' }} />
          <Typography
            variant="caption"
            onClick={handleResetView}
            sx={{
              cursor: 'pointer',
              px: 0.5,
              fontSize: uiFontSize(10),
              lineHeight: 1,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
              whiteSpace: 'nowrap',
            }}
          >
            1:1
          </Typography>
          <Typography
            variant="caption"
            onClick={() => {
              useEditorStore.getState().requestFit();
            }}
            sx={{
              cursor: 'pointer',
              px: 0.5,
              fontSize: uiFontSize(10),
              lineHeight: 1,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
              whiteSpace: 'nowrap',
            }}
          >
            {t('editor.fit')}
          </Typography>
          <Box sx={{ width: 1, height: 14, mx: 0.25, borderRight: 1, borderColor: 'divider' }} />
          <Typography
            variant="caption"
            onClick={() => void handleExportPng()}
            sx={{
              cursor: exportingPng ? 'wait' : 'pointer',
              px: 0.5,
              fontSize: uiFontSize(10),
              lineHeight: 1,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
              whiteSpace: 'nowrap',
            }}
          >
            {t('editor.exportPng')}
          </Typography>
        </Box>
      )}

      {/* AI 入口：画布右下角悬浮按钮（常驻可见，统一靛紫 AI 视觉） */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
        }}
      >
        <Fab
          size="medium"
          aria-label={t('aiPanel.openAssistant')}
          onClick={(e) => setAiMenuAnchor(e.currentTarget)}
          sx={{ ...aiButtonSx, boxShadow: 3 }}
        >
          <SmartToyIcon />
        </Fab>
        <Menu
          anchorEl={aiMenuAnchor}
          open={!!aiMenuAnchor}
          onClose={() => setAiMenuAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          <MenuItem
            disabled={!selectedFileForAi}
            onClick={() => {
              if (selectedFileForAi) {
                triggerDiagnosis({
                  filePath: selectedFileForAi,
                  kind: 'file',
                  title: t('aiPanel.diagnoseSelected'),
                });
              }
              setAiMenuAnchor(null);
            }}
          >
            <ListItemIcon sx={{ color: AI_COLOR, minWidth: 28 }}>
              <AutoFixHighIcon sx={{ fontSize: uiFontSize(18) }} />
            </ListItemIcon>
            <ListItemText
              primary={t('aiPanel.diagnoseSelected')}
              secondary={selectedFileForAi ? null : t('aiPanel.diagnoseSelectedHint')}
              sx={{
                '& .MuiListItemText-primary': { fontSize: uiFontSize(13) },
                '& .MuiListItemText-secondary': { fontSize: uiFontSize(10) },
              }}
            />
          </MenuItem>
          <MenuItem
            onClick={() => {
              useEditorStore.getState().requestAiPanel();
              setAiMenuAnchor(null);
            }}
          >
            <ListItemIcon sx={{ color: AI_COLOR, minWidth: 28 }}>
              <SmartToyIcon sx={{ fontSize: uiFontSize(18) }} />
            </ListItemIcon>
            <ListItemText
              primary={t('aiPanel.openAssistant')}
              sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}
            />
          </MenuItem>
        </Menu>
      </Box>

      {/* 画布视口 */}
      <Box
        ref={canvasRef}
        onMouseDown={(e) => {
          // 中/右键平移（panButtons=[1,2]）与左键框选互斥，两路都从这里进
          panHandlers.onMouseDown(e);
          handleBoxSelectStart(e);
        }}
        onContextMenu={handleContextMenu}
        onClick={(e) => {
          // H6：框选松手后的 click 不算「空白点击」，否则会把刚选中的实体清掉
          if (boxSuppressClickRef.current) {
            boxSuppressClickRef.current = false;
            return;
          }
          // 只在点击空白区域时取消选中
          if (e.target === e.currentTarget) deselectAll();
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
          cursor: isPanning ? 'grabbing' : 'grab',
          backgroundColor: 'rgb(var(--template-palette-background-paperChannel))',
          backgroundImage: (t) =>
            t.palette.mode === 'dark'
              ? 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)'
              : 'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
          // 初值由 sx 提供；后续由 useCanvasPanZoom 直写 DOM（rAF），不走 React
          ...backgroundCss(viewport),
          outline: isDragOver ? '2px solid' : 'none',
          outlineColor: 'primary.main',
          outlineOffset: -2,
        }}
      >
        {/* ─── 贴面层：铺满画布的写作编辑区（正文容器 / 题材编辑面）──────────
            inset:0 撑满整个画布视口，1:1 像素、不吃缩放平移 ——
            「编辑区覆盖整个画布，中间不留背景」就是这一层（见 fullBleedComp 的注释）。
            刻意排在变换层**之前**：变换层在上，用户拖进画布的实体卡照常可见可拖。
            cursor 复位为 default：画布视口是 grab，编辑面上不该出现抓手。
            **刻意不带 `data-component-id`**：那是「我是画布上的一个实体」的身份牌，
            挂上就会被右键菜单/定位/框选整套实体语义接走 —— 右键编辑区会弹出针对这张
            看不见、搬不动的满屏卡的画布菜单（9 项 7 项静默 no-op，「删除」能让编辑区
            消失），正文的剪切/复制/粘贴还被一并拦掉。它只拿 data-writing-surface，
            收到这个标记的右键一律放行原生菜单（见 handleContextMenu）。 */}
        {fullBleedComp && FullBleedRenderer && (
          <Box
            key={fullBleedComp.id}
            {...{ [WRITING_SURFACE_ATTR]: '1' }}
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              overflow: 'hidden',
              cursor: 'default',
              backgroundColor: (t) => t.palette.background.paper,
            }}
          >
            <FullBleedRenderer
              type={fullBleedComp.type}
              config={fullBleedComp.config}
              componentId={fullBleedComp.id}
              width={canvasSize.width}
              height={canvasSize.height}
              editorSelected={false}
              lod="full"
            />
          </Box>
        )}

        {/* 变换容器：transform 由 useCanvasPanZoom 直写 DOM，React 只给初值 */}
        <Box
          ref={contentRef}
          sx={{
            transform: transformCss(viewport),
            transformOrigin: '0 0',
            position: 'absolute',
            left: 0,
            top: 0,
            willChange: 'transform',
            pointerEvents: isPanning ? 'none' : 'auto',
            // 贴面层存在时抬到其上：拖进画布/落在画布上的实体卡（含下钻框、标注）
            // 必须盖住铺满的编辑面，否则落卡即「看不见」= 静默丢内容。
            zIndex: fullBleedComp ? 2 : undefined,
          }}
        >
          {/* 视口虚拟化：只渲染视口内实体（大项目数百实体时平移缩放不掉帧）；
              选中实体无条件渲染，fit 全览时全部可见 → 自然全量渲染。
              displayComponents 已把 dependency-edge 放到最前，避免边遮实体。
              （兜底：边 shell 已 pointer-events:none，不会真拦截实体点击） */}
          {displayComponents.map((comp) => {
            // 铺满画布的写作容器卡由上方贴面层渲染（全视口 1:1），
            // 这里一律跳过 —— 否则同一张编辑面会被渲染两次：贴面层一份（正确），
            // 变换层再按 0.46 倍缩一份（就是用户看到的「浮在中间的小卡」）。
            // 重复残留（历史事故：同一视图叠了两张）也在此一并跳过，由
            // studioBook.reconcileStudioPaneView 幂等清场，绝不静默留双份 DOM。
            if (isFullCanvasWritingCard(comp.type)) return null;
            const isSelected = selectedIdSet.has(comp.id);

            // 强调态计算（纯 O(1) 查表，不逐实体遍历依赖）
            // v2.21 叠加语义：筛选镜是「范围裁剪」，选中高亮是「重点强调」，二者叠加而非互斥。
            //   - 选中(self) 最高优先；
            //   - 筛选镜生效且本实体不在命中集 → 直接淡化（最外层裁剪）；
            //   - 通过筛选的实体，再叠加选中高亮（related/edge）；
            //   - 通过筛选但不在 related 集合：筛选生效时保持 normal（不被淡化），
            //     仅选中高亮生效时（无筛选）才 dim（即「只看某文件邻居」的预期）。
            let emphasis: CanvasEmphasis = 'normal';
            // 重构四象限背景分区（v2.29）：纯装饰层，永不参与选中/聚焦淡化，
            // 始终满透明度显示（淡化逻辑对背景无意义，且会削弱分区可读性）。
            if (comp.type === 'quadrant-zone-bg') {
              return (
                <CanvasEntityNode
                  key={comp.id}
                  comp={comp}
                  isSelected={false}
                  emphasis={'normal'}
                  layerColor={''}
                  chainDepth={null}
                  chainSide={null}
                  lod={lod}
                  onSelect={selectComponent}
                  onDragStart={handleNodeDragStart}
                  drillState={null}
                  onToggleDrill={handleToggleDrill}
                  onEdgeClick={undefined}
                />
              );
            }
            const filterActive = depActiveIds != null;
            if (isSelected) {
              emphasis = 'self';
            } else if (filterActive && !depActiveIds!.has(comp.id)) {
              // 依赖画像筛选镜：未命中的实体整体淡化（边 0.12 / 节点 0.32）
              emphasis = 'dim';
            } else if (relatedFileIds || relatedModuleNames || relatedSymbolIds) {
              const cfg = (comp.config ?? {}) as Record<string, unknown>;
              // 筛选生效时通过筛选但不在 related → 正常显示；仅高亮生效时 → 淡化其余
              const dimElse = filterActive ? 'normal' : 'dim';
              if (comp.type === 'dependency-edge') {
                // 依赖连线：文件级（fromFileId/toFileId）或模块级（fromMod/toMod）命中关联子图即点亮
                const from = typeof cfg.fromFileId === 'string' ? cfg.fromFileId : null;
                const to = typeof cfg.toFileId === 'string' ? cfg.toFileId : null;
                const fileHit = from && to && relatedFileIds?.has(from) && relatedFileIds?.has(to);
                const fromMod = typeof cfg.fromMod === 'string' ? cfg.fromMod : null;
                const toMod = typeof cfg.toMod === 'string' ? cfg.toMod : null;
                const modHit =
                  !!relatedModuleNames &&
                  !!fromMod &&
                  !!toMod &&
                  relatedModuleNames.has(fromMod) &&
                  relatedModuleNames.has(toMod);
                emphasis = fileHit || modHit ? 'edge' : dimElse;
              } else if (comp.type === 'module' && !(comp.config as any)?.symbolKind) {
                // 模块实体：自身属于关联模块集合（选中模块自身/邻居/文件所属模块）即点亮
                const modName =
                  typeof cfg.moduleName === 'string'
                    ? cfg.moduleName
                    : typeof cfg.name === 'string'
                      ? cfg.name
                      : comp.name;
                emphasis = !!relatedModuleNames && relatedModuleNames.has(modName) ? 'related' : dimElse;
              } else if (cfg.portraitMode === 'symbols' && typeof cfg.symbolId === 'string' && relatedSymbolIds) {
                // 符号实体（代码结构画像）：命中符号级调用邻居才点亮
                emphasis = relatedSymbolIds.has(cfg.symbolId) ? 'related' : dimElse;
              } else {
                const fid = fileIdByCompId.get(comp.id);
                emphasis = fid && relatedFileIds?.has(fid) ? 'related' : dimElse;
              }
            }

            const layerColor = layerColorById.get((comp.config as any)?.projectLayerId) || '';

            // v2.29 象限区标签：把实时文件计数注入 subtitle（「该象限 N 个文件」），
            // 让四象限分布一眼可见；非象限标签保持原 config。
            let renderComp = comp;
            if (comp.type === 'layer-marker') {
              const qz = (comp.config as Record<string, unknown>)?.quadrantZone;
              if (typeof qz === 'string' && qz in quadrantZoneCounts) {
                const n = quadrantZoneCounts[qz];
                renderComp = {
                  ...comp,
                  config: { ...(comp.config as Record<string, unknown>), subtitle: t('editor.quadZoneCount', { n }) },
                };
              }
            }

            // 影响链梯度：非连线实体按其关联文件在链上的跳数着色
            let chainDepthOf: number | null = null;
            let chainSideOf: ChainSide | null = null;
            if (impactChain && emphasis !== 'dim' && comp.type !== 'dependency-edge') {
              const fid = fileIdByCompId.get(comp.id);
              if (fid) {
                chainDepthOf = chainView.depthOf(fid);
                chainSideOf = chainView.sideOf(fid);
              }
            }

            return (
              <CanvasEntityNode
                key={comp.id}
                comp={renderComp}
                isSelected={isSelected}
                emphasis={emphasis}
                layerColor={layerColor}
                chainDepth={chainDepthOf}
                chainSide={chainSideOf}
                lod={lod}
                onSelect={selectComponent}
                onDragStart={handleNodeDragStart}
                drillState={isDrillableModule(comp) ? expandedOwnerIds.has(comp.id) : null}
                onToggleDrill={handleToggleDrill}
                onEdgeClick={comp.type === 'dependency-edge' ? handleEdgeClick : undefined}
              />
            );
          })}

          {/* V4 拍板：载体铺满画布成「载体视图」，缩放手柄随实体缩放一起移除 */}
        </Box>

        {/* H6 框选矩形覆盖层：mousemove 直写 style，不进 React 渲染循环 */}
        <div
          ref={boxOverlayRef}
          style={{
            display: 'none',
            position: 'absolute',
            border: `1px solid ${CV.primary}`,
            background: `${CV.primary}1f`,
            borderRadius: 2,
            pointerEvents: 'none',
            zIndex: 40,
          }}
        />

        {/* 画布为空提示：覆盖整个画布视口并真正居中（与缩放/平移 transform 解耦，
            从变换容器移出，避免随画布原点偏移导致提示贴在左上角）。
            【书场景排除】代码空态（AccountTreeIcon/「立即同步到画布」）是代码项目语义，
            书场景有自己的「拖入载体」引导（外层 V4 覆盖层）。此前新书总被自动铺
            全书总览板兜住（components>0），2026-09-21 停用自动铺板后此空态在书场景
            露出 —— 按 isBookScene 排除；扫描/同步骨架屏两种场景都要保留。 */}
        {components.length === 0 && (!isBookScene || scanning || syncing) && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              color: 'text.secondary',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {scanning || syncing ? (
              <CanvasLoadingSkeleton
                mode={scanning ? 'scan' : 'sync'}
                stage={scanStage}
                percent={scanPercent}
                scanned={scanScanned}
                total={scanTotal}
              />
            ) : (
              <>
                <AccountTreeIcon sx={{ fontSize: uiFontSize(48), opacity: 0.2 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  {t('editor.emptyTitle')}
                </Typography>
                <Typography variant="caption" sx={{ maxWidth: 320 }}>
                  {projectFiles.length > 0 ? t('editor.emptySyncedHint') : t('editor.emptyUnsyncedHint')}
                </Typography>
                {projectFiles.length > 0 && onSyncToCanvas && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<HubIcon />}
                    onClick={() => onSyncToCanvas()}
                    sx={{ pointerEvents: 'auto', mt: 1 }}
                  >
                    {t('editor.syncNow')}
                  </Button>
                )}
              </>
            )}
          </Box>
        )}
      </Box>

      {/* 小地图：全局俯瞰 + 风险热区（视口虚拟化之后唯一的「统筹全局」手段）
          编辑面铺满的视图里不给（见 hasCanvasObjects）：没有可导航的对象，
          它只会压在编辑区右下角。 */}
      {hasCanvasObjects && (
        <CanvasMinimap
          components={components}
          selectedIds={selectedIds}
          viewport={viewport}
          viewportRef={viewportRef}
          canvasSize={canvasSize}
          isPanning={isPanning}
          onNavigate={setViewport}
          layerColorOf={minimapLayerColorOf}
        />
      )}
      {/* 画像图例（v2.5）：横带/徽标/连线语义说明 */}
      <PortraitLegend />

      {/* 上下文菜单 */}
      <EditorContextMenu
        position={contextMenu ? { mouseX: contextMenu.mouseX, mouseY: contextMenu.mouseY } : null}
        componentId={contextMenu?.componentId ?? null}
        onClose={handleCloseContextMenu}
      />

      {/* 图片实体双击 → 放大详情弹窗 */}
      <ImagePreviewDialog open={!!imagePreview} data={imagePreview} onClose={closeImagePreview} />
    </Box>
  );
}
