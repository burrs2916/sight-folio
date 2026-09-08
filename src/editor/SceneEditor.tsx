// project-sight: 项目分析画布（带左面板 + 右侧 Tabs 面板 + 画布缩放平移 + 上下文菜单）
import { useEffect, useMemo, useState, useCallback, useRef, memo, type ChangeEvent } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Fab from "@mui/material/Fab";
import Divider from "@mui/material/Divider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Skeleton from "@mui/material/Skeleton";
import LinearProgress from "@mui/material/LinearProgress";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import CodeIcon from "@mui/icons-material/Code";
import SchemaOutlinedIcon from "@mui/icons-material/SchemaOutlined";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RuleIcon from "@mui/icons-material/Rule";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import SaveIcon from "@mui/icons-material/Save";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import LayersIcon from "@mui/icons-material/Layers";
import SettingsIcon from "@mui/icons-material/Settings";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import WidgetsIcon from "@mui/icons-material/Widgets";
import HubIcon from "@mui/icons-material/Hub";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import TerminalIcon from "@mui/icons-material/Terminal";
import BuildIcon from "@mui/icons-material/Build";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import SearchIcon from "@mui/icons-material/Search";
import SortIcon from "@mui/icons-material/Sort";
import ClearIcon from "@mui/icons-material/Clear";
import { useEditorStore } from "../store/editorStore";
import { useDirtyStore } from "../store/editorStore";
import { useSceneStore } from "../store/sceneStore";
import { useProjectStore } from "../store/projectStore";
import { FileRenderer } from "./renderers/FileRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { AssetRenderer } from "./renderers/AssetRenderer";
import { ImagePreviewDialog } from "./panels/ImagePreviewDialog";
import { getCachedProjectRoot, buildImagePreviewData } from "./utils/imageAsset";
import { FolderRenderer } from "./renderers/FolderRenderer";
import { ModuleRenderer } from "./renderers/ModuleRenderer";
import { ClassRenderer } from "./renderers/ClassRenderer";
import { FunctionRenderer } from "./renderers/FunctionRenderer";
import { InterfaceRenderer } from "./renderers/InterfaceRenderer";
import { DependencyEdgeRenderer } from "./renderers/DependencyEdgeRenderer";
import { LayerMarkerRenderer } from "./renderers/LayerMarkerRenderer";
import { ProjectAnnotationRenderer } from "./renderers/ProjectAnnotationRenderer";
import { CodePreviewRenderer } from "./renderers/CodePreviewRenderer";
import { PatternNodeRenderer } from "./renderers/PatternNodeRenderer";
import { TreemapCellRenderer } from "./renderers/TreemapCellRenderer";
import { QuadrantZoneBgRenderer } from "./renderers/QuadrantZoneBgRenderer";
import { QuadrantAxisRenderer } from "./renderers/QuadrantAxisRenderer";
import { EntityInfoPanel } from "./panels/EntityInfoPanel";
import { EntityPortraitPanel } from "./panels/EntityPortraitPanel";
import { ReviewFindingsPanel } from "./panels/ReviewFindingsPanel";
import { ComponentCenterPanel } from "./panels/ComponentCenterPanel";
import { ArchitectureHealthPanel } from "./panels/ArchitectureHealthPanel";
import { ImpactAnalysisPanel } from "./panels/ImpactAnalysisPanel";
import { WorkbenchAiPanel } from "./panels/WorkbenchAiPanel";
import type { MonacoEditorHandle } from "./panels/MonacoCodeEditor";
import { useInsightOverlaySync } from "../ai/useInsightOverlaySync";
import { useVerifyOverlayListener } from "./useVerifyOverlaySync";
import { useImpactOverlayListener } from "./useImpactOverlaySync";
import { triggerDiagnosis } from "../ai/triggerDiagnosis";
import { aiButtonSx, AI_COLOR } from "../ai/aiBrand";
import { SceneTabBar } from "./components/SceneTabBar";
import { EditorContextMenu } from "./components/EditorContextMenu";
import { PluginSelector } from "./components/PluginSelector";
import { componentRegistry } from "./registry";
import { computeVisibleEntityIds } from "./utils/viewportCulling";
import { lodForScale, type CanvasLod } from "./utils/lod";
import { CV, SHADOW_1 } from "./renderers/canvasTheme";
import "./renderers/canvasEntity.css";
import { useCanvasResize } from "./hooks/useViewport";
import { useCanvasPanZoom } from "./hooks/useCanvasPanZoom";
import { isDrillableModule, toggleModuleDrill } from "./utils/drillActions";
import { contentBounds, fitViewport, transformCss, backgroundCss } from "./utils/panZoom";
import CanvasMinimap from "./panels/CanvasMinimap";
import { PortraitLegend } from "./panels/PortraitLegend";
import { buildCallIndex } from "./utils/impactGraph";
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
  CHAIN_SIDE_LABEL,
  type ChainSide,
} from "./utils/impactChain";
import { useToastStore } from "../store/toastStore";
import { useActiveAnalyzer, useActiveAnalyzerIds, activateAnalyzerForLanguage, syncPluginRulesToBackend } from "./analyzer";
import { navigateToSource, navigateToSourceByPath } from "./utils/sourceNavigate";
import { openDirectorySubtree, rerenderDirectoryTree, runPortrait, expandCallChain } from "./utils/portraits";
import { highlightInCanvasByText } from "./utils/canvasLink";
import { sortComponentsEdgesFirst } from "./utils/canvasOrder";
import { topDirOf } from "./utils/architectureMetrics";
import logger from "../utils/logger";
import type { SceneComponent } from "../types/editor";
import type { ProjectFile } from "../services/tauri";
import { spawnCodeWorkbench } from "../services/tauri";
import { t, resolveFragments } from "../i18n";

const RENDERERS: Record<string, any> = {
  file: FileRenderer,
  folder: FolderRenderer,
  module: ModuleRenderer,
  class: ClassRenderer,
  function: FunctionRenderer,
  interface: InterfaceRenderer,
  "dependency-edge": DependencyEdgeRenderer,
  "layer-marker": LayerMarkerRenderer,
  "annotation-text": ProjectAnnotationRenderer,
  "code-preview": CodePreviewRenderer,
  "pattern-node": PatternNodeRenderer,
  // 耦合矩形树图单元格：treemap 画像承载实体，紧凑色块 + 白边分隔 + 占比
  "treemap-cell": TreemapCellRenderer,
  // 图片实体：此前漏注册 → 落进 UnknownTypeFallback 红框，目录树里的图片毫无画像。
  // 现在直接渲染真实图片缩略图（ImageRenderer 内部按 projectRoot 取 asset URL）。
  image: ImageRenderer,
  // 重构四象限背景分区（v2.29）：半透明色区，pointer-events:none，命中测试让给上方 file 节点
  "quadrant-zone-bg": QuadrantZoneBgRenderer,
  // 重构四象限坐标轴 + 刻度数值 + 公式（v2.41）：十字轴落在象限中线上，pointer-events:none，
  // 覆盖在 file 节点之上保证刻度可读；必须进本静态表，否则落 UnknownTypeFallback 红框、坐标轴不画。
  "quadrant-axis": QuadrantAxisRenderer,
  // 资源文件实体（字体/媒体/压缩/二进制）：与 image 同源缺陷 —— 此前只注册进
  // plugin rendererCache 却漏掉本静态表 → 画布上 asset 实体全部落进红框兜底。
  // 现在同样走专属 AssetRenderer（格式感知图标 + 体积画像，零代码洞察叠层）。
  asset: AssetRenderer,
};

/**
 * 未映射类型的可见兜底（对齐 biosphere FallbackRenderer 契约）。
 * 此前 RENDERERS 查不到直接 return null —— 实体存在却凭空隐形，
 * 既无日志也无占位，是「渲染不出来」类问题最难排查的形态。
 * 现在红虚线框 + 类型名当场暴露缺口：补渲染器或补注册即可。
 */
function UnknownTypeFallback({ type }: { type: string }) {
  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        border: "1.5px dashed",
        borderColor: "error.main",
        borderRadius: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 0.75,
        backgroundColor: (t: any) => (t.palette.mode === "dark" ? "rgba(211,47,47,0.08)" : "rgba(211,47,47,0.04)"),
      }}
    >
      <Typography variant="caption" sx={{ color: "error.main", fontSize: 10, textAlign: "center", wordBreak: "break-all" }}>
        {t("editor.unknownEntityType", { type })}
      </Typography>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 画布实体节点（业务联动 + 性能）
//
// 性能：这是「卡顿」的关键修复。此前 components.map 里内联渲染每个实体，
// 任何一次 store 更新（选中/拖动/平移/缩放）都会把几百个实体全部重渲染，
// 同步几百个文件后画布帧率掉到个位数。
// 现在每个实体是一个 React.memo 节点 —— 组件对象（immer 复用未改对象）与
// 选中态/强调态不变时直接跳过渲染，平移缩放只动 CSS transform，接近 60fps。
//
// 联动：选中一个文件实体后，画布会高亮它的依赖/被依赖邻居、点亮相关依赖线，
// 淡化无关实体 —— 这就是「画布实体与业务数据联动」的视觉表达；
// 双击文件实体直接打开源码（沟槽自动标记问题行）。
// ─────────────────────────────────────────────────────────────────────────────

type CanvasEmphasis = "self" | "related" | "edge" | "dim" | "normal";

/** 从实体 config 解析关联的项目文件 id（同步落库时写入 fileId，旧实体按 filePath 兜底） */
function compFileId(comp: SceneComponent, fileByPath: Map<string, ProjectFile>): string | null {
  const cfg = (comp.config ?? {}) as Record<string, unknown>;
  const fid = cfg.fileId;
  if (typeof fid === "string" && fid) return fid;
  const path = cfg.filePath;
  if (typeof path === "string" && path) return fileByPath.get(path)?.id ?? null;
  return null;
}

// 调用链画像：记录已展开（多跳下钻）的符号 → 其增量创建的组件 id，
// 再次单击同一符号时据此收起（removeComponentsBulk）。会话态，不进 store。
const expandedCallChains = new Map<string, string[]>();

const CanvasEntityNode = memo(function CanvasEntityNode({
  comp,
  isSelected,
  emphasis,
  layerColor,
  chainDepth,
  chainSide,
  lod,
  onSelect,
  onDragStart,
  drillState,
  onToggleDrill,
  onEdgeClick,
}: {
  comp: SceneComponent;
  isSelected: boolean;
  emphasis: CanvasEmphasis;
  layerColor: string;
  /** 画布 LOD 档位：缩小后省略徽标/文字，节点数从 ~23 降到 ~2（见 utils/lod.ts） */
  lod: CanvasLod;
  /** 影响链跳数（null = 未启用/未命中）；1 跳最亮，越深越淡 */
  chainDepth: number | null;
  /** 影响链方向：upstream=会被我波及 / downstream=我所依赖 / both=环 */
  chainSide: ChainSide | null;
  onSelect: (id: string, multi?: boolean) => void;
  onDragStart: (e: React.MouseEvent, comp: SceneComponent) => void;
  /** null = 不可下钻；true = 已展开；false = 可展开 */
  drillState: boolean | null;
  onToggleDrill: (comp: SceneComponent) => void;
  /** 依赖边被点击（透明命中路径）：选中两端节点 + 展示符号；仅依赖画像的边会下发 */
  onEdgeClick?: (comp: SceneComponent) => void;
}) {
  const Renderer = RENDERERS[comp.type] ?? UnknownTypeFallback;
  const isEdge = comp.type === "dependency-edge";
  // 重构四象限背景分区（v2.29）：与边同权处理——命中测试 none（在渲染器内已设）、
  // 不可拖拽、不进入选中/聚焦逻辑，纯装饰层。
  const isQuadrantBg = comp.type === "quadrant-zone-bg";
  // 缩小档位下角标只剩几像素，画了也看不清，却每个都是一个 DOM 节点 —— 全览
  // 时几百实体乘以三四个角标就是几千个白花花的节点。LOD 一并把它们剪掉。
  const showAdornments = lod === "full";
  // 下钻子图外框：纯装饰，不能吃掉框内文件实体的点击/拖拽
  const isDrillFrame = !!(comp.config as any)?.drillFrame;

  // 影响链命中：按方向取色、按跳数取强度（1 跳最实，3 跳最虚）
  const chainStyle =
    chainDepth !== null && chainDepth > 0 && chainSide
      ? { color: CHAIN_SIDE_COLOR[chainSide], strength: chainDepthStyle(chainDepth).opacity }
      : null;

  // 选中文件实体时：无关联的实体/连线淡化（连线更淡），关联子图保持高亮
  // 影响链启用时，命中节点的整体不透明度也随跳数衰减 —— 远端影响本就更弱
  const opacity =
    emphasis === "dim"
      ? isEdge
        ? 0.12
        : 0.32
      : chainStyle && emphasis !== "self"
        ? 0.45 + chainStyle.strength * 0.55
        : 1;

  // 描边优先级：选中 > 影响链梯度（方向色 + 跳数强度）> 依赖邻居 > 无。
  // 写成 CSS 变量而非 outline 本身，否则 inline 会盖掉 :hover（见 canvasEntity.css）。
  const outlineVar = isSelected
    ? `2px solid ${CV.primary}`
    : emphasis === "related"
      ? chainStyle
        ? `${chainDepth === 1 ? 2 : 1.5}px solid ${chainStyle.color}`
        : `1.5px solid ${CV.primaryLight}`
      : undefined;
  // 影响链 1 跳额外加一圈柔光，让「直接受影响」在一屏里跳出来
  const glow = chainStyle && chainDepth === 1 && !isSelected ? `0 0 0 3px ${chainStyle.color}22` : undefined;
  // 关联邻居时把卡片边框也染成链路色（描边在外、边框在内，双层更醒目）
  const borderColor = layerColor
    ? `${layerColor}44`
    : emphasis === "related" && chainStyle
      ? chainStyle.color
      : undefined;

  // 单击/双击分流（与项目树目录行同约定「单击展开，双击定位」）：
  // - 可下钻实体（目录/模块）单点延迟 180ms 执行展开/收起，让双击优先取消，
  //   避免双击时先触发的单点把已展开子图误折叠；
  // - 不可下钻实体（文件/图片/符号等）单点立即选中，无展开/定位冲突；
  // - 双击统一只做「定位到左侧目录树节点」（selectComponent 选中 → 反向联动滚动+高亮），
  //   不打开源码、不居中画布视口，纯粹把对应节点呈现在文件树里让用户找到。
  const singleTimer = useRef<number | null>(null);
  const lastClick = useRef<{ id: string; t: number } | null>(null);

  // treemap-cell 是紧凑铺满色块（squarify 布局），自身渲染器已画 zone 底色+白边+选中，
  // 不需要 shell 外壳的透明底/边框/蓝边 outline —— 否则 canvasEntity.css 按
  // --ps-outline 画的选中蓝边会破坏紧凑色块视觉，与图鉴预览（同渲染器）不一致。
  const isTreemap = comp.type === "treemap-cell";
  const shell: React.CSSProperties & Record<string, string | number | undefined> = {
    left: comp.transform.x,
    top: comp.transform.y,
    width: comp.transform.width,
    height: comp.transform.height,
    cursor: isEdge || isQuadrantBg ? "default" : "pointer",
    opacity,
    zIndex: emphasis === "self" ? 3 : emphasis === "related" ? 2 : isDrillFrame ? 0 : 1,
    // 分层背景色。原实现按明暗主题取 22/18 两档 alpha，差异 4/255 肉眼不可辨，
    // 换成固定 20 以摆脱 JS 侧 theme 访问（每实体一次调色板查表的代价没必要付）。
    backgroundColor: isTreemap ? "transparent" : layerColor ? `${layerColor}20` : "transparent",
    border: isTreemap ? "none" : borderColor ? `1px solid ${borderColor}` : "none",
    boxShadow: isTreemap ? undefined : glow,
    "--ps-outline": isTreemap ? undefined : outlineVar,
    "--ps-outline-hover": isTreemap ? undefined : isSelected ? `2px solid ${CV.primary}` : undefined,
    // 边的 shell 整包围盒吃掉点击 → 命中下层的实体卡片，
    // 「依赖关系把实体遮住选不上」的根因。边内部 SVG 路径 stroke 仍捕获事件
    // （pointer-events 仅影响命中测试，不阻断事件冒泡），故边上仍可点选连线。
    pointerEvents: isEdge || isQuadrantBg ? "none" : "auto",
  };

  return (
    <div
      className={
        isDrillFrame
          ? "ps-entity ps-entity--frame"
          : isTreemap
            ? "ps-entity ps-entity--treemap"
            : isSelected
              ? "ps-entity ps-entity--selected"
              : "ps-entity"
      }
      data-component-id={comp.id}
      onClick={(e) => {
        e.stopPropagation();
        const cfg0 = (comp.config ?? {}) as Record<string, unknown>;
        // v2.28 重构四象限聚焦：点击象限区域标签（layer-marker + quadrantZone）即高亮该象限
        // 全部文件、淡化其余（再次点击同一象限=复位）。不进入双击/选中逻辑，标签不可拖拽。
        if (comp.type === "layer-marker" && typeof cfg0.quadrantZone === "string") {
          const zone = cfg0.quadrantZone as "refactorFirst" | "legacyStable" | "activeSimple" | "healthy";
          const cur = useEditorStore.getState().quadrantFocusZone;
          useEditorStore.getState().setQuadrantFocusZone(cur === zone ? null : zone);
          useToastStore.getState().showToast(
            cur === zone
              ? t("editor.quadFocusReset")
              : t("editor.quadFocus", { zone: t(`insight.quad.${zone}`) }),
            "info"
          );
          return;
        }
        const now = Date.now();
        const last = lastClick.current;
        // 双击 = 定位到目录树节点（手动判定，不依赖原生 dblclick）：
        // 原生 dblclick 在「拖拽 mousedown 的 preventDefault + 单点 180ms 延迟」组合下
        // 常被吞掉 → 双击退化成两次单点 → 文件夹退化到 openDirectorySubtree（无子节点
        // 时静默 no-op，观感就是「双击文件夹没反应」）。改在 click 内按 300ms 同实体
        // 二次点击判定双击，确保双击一定定位到文件树节点，覆盖 folder/模块/文件/图片/符号/未知。
        if (last && last.id === comp.id && now - last.t < 300) {
          lastClick.current = null;
          if (singleTimer.current) {
            window.clearTimeout(singleTimer.current);
            singleTimer.current = null;
          }
          const cfg = (comp.config ?? {}) as Record<string, unknown>;
          if ((cfg.portraitMode === "moduleGraph" || cfg.portraitMode === "architecture" || cfg.portraitMode === "layering" || comp.type === "treemap-cell") && typeof cfg.moduleName === "string") {
            // v2.4 模块图节点双击：下钻该模块的目录子树视图（宏观→微观完整链路）
            const analysisId = useSceneStore.getState().activeSceneId;
            if (analysisId) {
              void openDirectorySubtree(cfg.moduleName as string, analysisId).then((res) =>
                useToastStore.getState().showToast(res.message, res.severity)
              );
            }
          } else if (cfg.expandableFile === true && typeof cfg.symbolDrillFile === "string") {
            // v2.14 目录树符号展开：双击文件展开/收起其符号卡（代码结构画像）
            const analysisId = useSceneStore.getState().activeSceneId;
            useEditorStore.getState().toggleSymbolFile(cfg.symbolDrillFile as string);
            if (analysisId) {
              void runPortrait("symbols", analysisId).then((res) =>
                useToastStore.getState().showToast(res.message, res.severity)
              );
            }
          } else if (cfg.portraitMode === "symbols" && typeof cfg.fileId === "string") {
            // v2.3 符号双击：直接打开代码工作台定位定义行（一步到位，不绕文件树）
            const fid = cfg.fileId as string;
            const line = typeof cfg.lineStart === "number" ? (cfg.lineStart as number) : null;
            const kind = typeof cfg.symbolKind === "string" ? (cfg.symbolKind as string) : "symbol";
            const res = navigateToSource(
              fid,
              line,
              t("panel.menu.toastOpenSymbol", { name: comp.name, kind })
            );
            if (!res.opened) useToastStore.getState().showToast(res.message, "warning");
          } else if (cfg.portraitMode === "dependency" && typeof cfg.fileId === "string") {
            // v2.17 依赖画像文件节点双击：直接拉起代码工作台定位到该文件，
            // 与 symbols 画像双击开源码一致（依赖节点也带 fileId）。单点仍只做
            // 选中+就地高亮（保留全图），双击才跳源码，避免误触。
            const fid = cfg.fileId as string;
            const line = typeof cfg.lineStart === "number" ? (cfg.lineStart as number) : null;
            const res = navigateToSource(fid, line);
            if (!res.opened) useToastStore.getState().showToast(res.message, "warning");
            else useToastStore.getState().showToast(res.message, "success");
          } else if (cfg.portraitMode === "patterns" && (typeof cfg.fileId === "string" || typeof cfg.filePath === "string")) {
            // v2.20 设计模式节点双击：跳到命中符号所在的源码行（与 symbols/dependency 同款行动力）。
            // 单点仍只做选中+就地高亮（保留全图），双击才跳源码，避免误触。
            const fid = typeof cfg.fileId === "string" ? (cfg.fileId as string) : null;
            const fpath = typeof cfg.filePath === "string" ? (cfg.filePath as string) : null;
            const line = typeof cfg.line === "number" ? (cfg.line as number) : null;
            const reason = t("panel.menu.toastOpenSymbol", { name: comp.name, kind: t("entityProj.patternNode.name") });
            const res =
              fid !== null
                ? navigateToSource(fid, line, reason)
                : fpath !== null
                  ? navigateToSourceByPath(fpath, line, reason)
                  : { opened: false, focusedCanvas: false, message: t("editor.patternNoFile") };
            if (!res.opened) useToastStore.getState().showToast(res.message, "warning");
            else useToastStore.getState().showToast(res.message, "success");
          } else if (typeof cfg.fileId === "string" || typeof cfg.filePath === "string") {
            // v2.19 通用兜底：任何带 fileId/filePath 的实体（网格类/象限/影响链/函数热点/数据流/
            // 架构·分层文件节点…）双击即跳源码——把"看得到问题文件"直接变成"摸得着去修"。
            // 复用 symbols/dependency 同款 navigateToSource，非侵入；上方分支已 return，不重复触发。
            const line =
              typeof cfg.lineStart === "number"
                ? (cfg.lineStart as number)
                : typeof cfg.line === "number"
                  ? (cfg.line as number)
                  : null;
            const reason = t("panel.menu.toastOpenEntity", { name: comp.name });
            const res =
              typeof cfg.fileId === "string"
                ? navigateToSource(cfg.fileId as string, line, reason)
                : navigateToSourceByPath(cfg.filePath as string, line, reason);
            if (!res.opened) useToastStore.getState().showToast(res.message, "warning");
            else useToastStore.getState().showToast(res.message, "success");
          } else {
            useEditorStore.getState().selectComponent(comp.id, false);
          }
          return;
        }
        lastClick.current = { id: comp.id, t: now };
        // 单击 = 展开（与项目树「单击展开」同约定）：
        // - 可下钻模块：延迟 180ms 执行 drill 展开/收起 + 选中；
        // - 文件夹：延迟 180ms 打开其目录子树视图（openDirectorySubtree = 展开看内容）；
        // - 调用链画像的符号节点：单击沿调用图多跳展开（A→B→C→D），再次单击收起；
        // - 其余（文件/图片/符号等）：单点即选中，无需延迟。
        // 延迟在上面的双击分支被取消，故双击只走定位、不会误折叠/重复打开。

        // 调用链画像 function 节点：单击多跳展开 / 收起（双击仍走下方通用兜底跳源码）
        const callGraphCfg = (comp.config ?? {}) as Record<string, unknown>;
        if (callGraphCfg.portraitMode === "callGraph" && comp.type === "function") {
          if (singleTimer.current) window.clearTimeout(singleTimer.current);
          singleTimer.current = window.setTimeout(() => {
            singleTimer.current = null;
            const symId = (callGraphCfg.symbolId as string) ?? null;
            if (!symId) {
              onSelect(comp.id, false);
              return;
            }
            const existing = expandedCallChains.get(symId);
            const analysisId = useSceneStore.getState().activeSceneId;
            if (existing) {
              // 收起：移除增量创建的组件
              useEditorStore.getState().removeComponentsBulk(existing);
              expandedCallChains.delete(symId);
              useToastStore.getState().showToast(
                t("editor.callChainCollapsed", { name: comp.name }),
                "info"
              );
            } else if (analysisId) {
              // 展开：从节点当前坐标向右下增量追加多跳邻居
              const ox = comp.transform.x;
              const oy = comp.transform.y;
              const res = expandCallChain(analysisId, symId, { x: ox, y: oy }, 2);
              if (res.count > 0) {
                const ids = [...res.nodeIds, ...res.edgeIds];
                expandedCallChains.set(symId, ids);
                useToastStore.getState().showToast(
                  t("editor.callChainExpanded", { name: comp.name, n: res.count }),
                  "success"
                );
              } else {
                useToastStore.getState().showToast(
                  t("editor.callChainNoMore", { name: comp.name }),
                  "info"
                );
              }
            }
            onSelect(comp.id, false);
          }, 180);
          return;
        }

        if (drillState !== null || comp.type === "folder") {
          if (singleTimer.current) window.clearTimeout(singleTimer.current);
          singleTimer.current = window.setTimeout(() => {
            singleTimer.current = null;
            if (drillState !== null) {
              onToggleDrill(comp);
            } else if (comp.type === "folder" && (comp.config as any)?.portraitMode !== "symbols") {
              // 代码结构画像（v2.14 目录树）里目录树已全量绘制，单击不再展开子树
              const dirPath =
                typeof (comp.config as any)?.dirPath === "string" ? (comp.config as any).dirPath : "";
              const analysisId = useSceneStore.getState().activeSceneId;
              if (analysisId && dirPath) {
                void openDirectorySubtree(dirPath, analysisId).then((res) =>
                  useToastStore.getState().showToast(res.message, res.severity)
                );
              }
            }
            onSelect(comp.id, false);
          }, 180);
          return;
        }
        onSelect(comp.id, false);
      }}
      onMouseDown={(e) => onDragStart(e, comp)}
      style={shell}
    >
      {/* 分层颜色标记（左上角小圆点） */}
      {showAdornments && layerColor && (
        <div
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: layerColor,
            zIndex: 1,
          }}
        />
      )}
      {/* 影响链跳数徽标：一眼读出「这个文件离我几跳、是我影响它还是它被我依赖」。
          只在非连线实体上出现，避免把依赖线也糊上标签。 */}
      {showAdornments && chainStyle && !isEdge && chainDepth !== null && chainDepth > 0 && (
        <div
          title={t("editor.chainJump", { label: t("editor.chainSide." + chainSide!), depth: chainDepth })}
          style={{
            position: "absolute",
            bottom: -7,
            left: -7,
            minWidth: 14,
            height: 14,
            padding: "0 2px",
            boxSizing: "border-box",
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 700,
            lineHeight: 1,
            color: "#fff",
            backgroundColor: chainStyle.color,
            boxShadow: SHADOW_1,
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          {chainSide === "upstream" ? "↑" : chainSide === "downstream" ? "↓" : "↕"}
          {chainDepth}
        </div>
      )}
      {/* 模块下钻角标：点开 = 在右侧展开该模块的内部文件子图，再点 = 折叠。
          这是「实体不只是画像，能真正走进业务」的入口。 */}
      {showAdornments && drillState !== null && (
        <div
          className="ps-drill"
          role="button"
          title={drillState ? t("editor.drillFold") : t("editor.drillExpand")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDrill(comp);
          }}
          style={{ backgroundColor: drillState ? CV.warning : CV.primary, boxShadow: SHADOW_1 }}
        >
          {drillState ? "−" : "+"}
        </div>
      )}
      <Renderer
        type={comp.type}
        config={comp.config}
        componentId={comp.id}
        width={comp.transform.width}
        height={comp.transform.height}
        editorSelected={isSelected}
        lod={lod}
        onEdgeClick={onEdgeClick ? () => onEdgeClick(comp) : undefined}
      />
    </div>
  );
});

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
/**
 * 虚拟化缓冲。视口 state 是节流提交的（手势期间最多滞后 commitIntervalMs），
 * 缓冲要覆盖这段时间内可能划过的距离，否则快速平移时边缘会闪白。
 */
const CULL_PADDING = 700;

// 画布加载态骨架屏：扫描中 / 同步中显示占位结构 + 实时进度，替代静态空状态文案
function CanvasLoadingSkeleton({
  mode,
  stage,
  percent,
  scanned,
  total,
}: {
  mode: "scan" | "sync";
  stage?: string | null;
  percent?: number;
  scanned?: number;
  total?: number;
}) {
  const determinate = mode === "scan" && typeof total === "number" && total > 0;
  const pct = determinate && typeof percent === "number" ? percent : 0;
  return (
    <Box sx={{ width: "min(440px, 84%)", display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center" }}>
      {/* 模拟即将出现的目录树结构网格 */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5, width: "100%" }}>
        <Skeleton variant="rounded" width="100%" height={56} sx={{ gridColumn: "span 3", borderRadius: 2 }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            variant="rounded"
            width="100%"
            height={44}
            sx={{ borderRadius: 2, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "text.primary" }}>
        {mode === "scan" ? t("editor.scanningTitle") : t("editor.syncingTitle")}
      </Typography>
      {mode === "scan" && stage && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t("editor.scanStage", { stage })}
        </Typography>
      )}
      {determinate ? (
        <>
          <LinearProgress variant="determinate" value={pct} sx={{ width: "100%", borderRadius: 1, height: 6 }} />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {t("editor.scanProgress", { scanned: scanned ?? 0, total: total ?? 0, pct: Math.round(pct) })}
          </Typography>
        </>
      ) : (
        <LinearProgress variant="indeterminate" sx={{ width: "100%", borderRadius: 1, height: 6 }} />
      )}
    </Box>
  );
}

function ProjectCanvas({ onSyncToCanvas, syncing }: { onSyncToCanvas?: () => void; syncing?: boolean }) {
  const components = useEditorStore((s) => s.components);
  const selectComponent = useEditorStore((s) => s.selectComponent);
  const addComponent = useEditorStore((s) => s.addComponent);
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

  /**
   * 影响链传播跳数：0 = 关闭（回到单跳邻接的旧行为），1/2/3 = 多跳传播。
   * 默认 2 —— 1 跳等价于旧行为，3 跳在中型仓库已经开始出现「点亮半个项目」的噪声。
   */
  const [chainDepth, setChainDepth] = useState<number>(2);
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
    logger.throttled("canvas.viewportLoad", "ProjectCanvas", "viewportLoadSeq fired", () => ({
      seq: viewportLoadSeq,
      viewport: { scale: vp.scale, offset: vp.offset },
      isDefault,
      componentsCount: st.components.length,
      canvasSize,
      action: st.components.length > 0 && isDefault ? "requestFit" : "applySavedViewport",
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
      logger.throttled("canvas.cullNotReady", "ProjectCanvas", "visibleEntityIds: canvas not ready", () => ({
        canvasSize,
        componentsCount: components.length,
      }));
      return null;
    }
    const ids = computeVisibleEntityIds(
      components,
      { scale, offset: panOffset },
      { width: canvasSize.width, height: canvasSize.height },
      { padding: CULL_PADDING, selectedIds, hoveredId: null }
    );
    // 这条日志每帧都会走到（平移/缩放都会重算 memo）。thunk 形态保证被限流时
    // 连 `Array.from(ids)` 都不执行 —— 否则 500 实体每帧白分配一个 500 长数组。
    logger.throttled("canvas.cull", "ProjectCanvas", "visibleEntityIds computed", () => ({
      viewport: { scale, offset: panOffset },
      canvasSize,
      totalComponents: components.length,
      visibleCount: ids.size,
    }));
    // 安全兜底：如果视口裁剪后一个实体都看不到（但画布有实体），说明视口位置错误，
    // 返回 null 回退为全量渲染，确保用户至少能看到实体（即使位置不对）
    if (ids.size === 0 && components.length > 0) {
      logger.throttled(
        "canvas.cullEmpty",
        "ProjectCanvas",
        "visibleEntityIds: all entities culled, falling back to render all",
        () => ({
          viewport: { scale, offset: panOffset },
          canvasSize,
          totalComponents: components.length,
        }),
        5000
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

  /**
   * v2.17 依赖边点击：选中该边的两端节点（多选取并集），并 toast 该边引用的具体符号名。
   * 边 shell 是 pointer-events:none，只有 DependencyEdgeRenderer 内的透明命中路径
   * （visiblePainted）能捕获点击，故不会抢节点的选中；空白处仍穿透到下层实体。
   * 端点节点若不在当前画布（top-90 采样外）→ 回退到焦点子图，保证能给完整视图。
   */
  const handleEdgeClick = useCallback((comp: SceneComponent) => {
    const cfg = (comp.config ?? {}) as Record<string, unknown>;
    const from = typeof cfg.fromFileId === "string" ? (cfg.fromFileId as string) : null;
    const to = typeof cfg.toFileId === "string" ? (cfg.toFileId as string) : null;
    if (!from || !to) return;
    const ed = useEditorStore.getState();
    const fromComp = ed.components.find((c) => (c.config as any)?.fileId === from);
    const toComp = ed.components.find((c) => (c.config as any)?.fileId === to);
    const ids = [fromComp?.id, toComp?.id].filter((v): v is string => typeof v === "string");
    if (ids.length > 0) {
      ed.selectComponent(ids[0], false);
      for (const id of ids.slice(1)) ed.selectComponent(id, true);
    }
    const symbolNames = Array.isArray(cfg.symbolNames) ? (cfg.symbolNames as string[]) : [];
    const symbols = symbolNames.length > 0 ? `（引用：${symbolNames.slice(0, 4).join(", ")}${symbolNames.length > 4 ? ` +${symbolNames.length - 4}` : ""}）` : "";
    const files = useProjectStore.getState().files;
    const nameOf = (id: string) => files.find((f) => f.id === id)?.name ?? id;
    useToastStore.getState().showToast(
      t("editor.depEdgeClick", { from: nameOf(from), to: nameOf(to), symbols }),
      "info"
    );
  }, [t]);

  // ─── 拖放状态 ───
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number } | null>(null);

  // ─── 联动索引（useMemo 缓存，避免每次渲染重建）───
  // 1) 分层颜色：id → color（替代渲染时逐实体 find）
  const layerColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const pl of projectLayers) m.set(pl.id, pl.color || "");
    return m;
  }, [projectLayers]);

  // 1b) 小地图「分层配色」取色器：实体 → 架构分层色（无分层归属时返回 undefined）
  const minimapLayerColorOf = useCallback(
    (c: SceneComponent) => layerColorById.get((c.config as any)?.projectLayerId) || undefined,
    [layerColorById]
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
  const flowGate = useMemo(
    () => (dataFlowFacts.length > 0 ? buildFlowGate(dataFlowFacts) : null),
    [dataFlowFacts]
  );

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
    if (selectedComp.type !== "module" && selectedComp.type !== "treemap-cell") return null;
    const cfg = (selectedComp.config ?? {}) as Record<string, unknown>;
    const n = typeof cfg.moduleName === "string" ? cfg.moduleName : typeof cfg.name === "string" ? cfg.name : null;
    return n || (moduleFileIdsByName.has(selectedComp.name) ? selectedComp.name : null);
  }, [selectedComp, moduleFileIdsByName]);

  /** 选中实体若是符号实体（代码结构画像）→ 符号 id（config.symbolId + portraitMode=symbols） */
  const selectedSymbolId = useMemo(() => {
    if (!selectedComp) return null;
    const cfg = (selectedComp.config ?? {}) as Record<string, unknown>;
    if (cfg.portraitMode !== "symbols") return null;
    return typeof cfg.symbolId === "string" ? cfg.symbolId : null;
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
    return chain.source === "none" ? null : chain;
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
    [impactChain, relPathById]
  );

  /** 把任意文本写入剪贴板（CI 通道 / 命令 / 清单通用，带 toast 反馈） */
  const copyText = useCallback((text: string, okMsg: string, fallbackMsg: string) => {
    const toast = useToastStore.getState();
    try {
      const p = navigator.clipboard?.writeText(text);
      if (p) p.then(() => toast.showToast(okMsg, "success"), () => toast.showToast(fallbackMsg, "info"));
      else toast.showToast(fallbackMsg, "info");
    } catch {
      toast.showToast(fallbackMsg, "info");
    }
  }, []);

  /** TIA 报告 → 可运行命令计划（按运行器分组；纯函数，零 store 依赖） */
  const testCommandPlan = useMemo(
    () => (testImpact && testImpact.tests.length > 0 ? buildTestCommands(testImpact) : null),
    [testImpact]
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
        if (c.type === "file" && (c.config as any)?.portraitMode === "quadrant" && (c.config as any)?.quadrant === quadZone) {
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
  }, [selectedFileId, selectedModuleName, adjacency, moduleFileIdsByName, impactChain, chainView, components, quadZoneFocus]);

  // v2.29 象限区实时文件计数：从当前画布组件里统计「象限画像文件节点」落点，
  // 让四个象限标签直接显示「该象限 N 个文件」，分布一眼可见（无需依赖 toast 文案）。
  // 仅统计 portraitMode==="quadrant" 的 file 节点，避免其它画像实体干扰计数。
  const quadrantZoneCounts = useMemo(() => {
    const counts: Record<string, number> = { refactorFirst: 0, legacyStable: 0, activeSimple: 0, healthy: 0 };
    for (const c of components) {
      if (c.type !== "file") continue;
      const cfg = (c.config ?? {}) as Record<string, unknown>;
      if (cfg.portraitMode !== "quadrant") continue;
      const z = cfg.quadrant;
      if (typeof z === "string" && z in counts) counts[z] += 1;
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
    if (depFilter === "all") return null;
    const isDepView = components.some((c) => (c.config as any)?.portraitMode === "dependency");
    if (!isDepView) return null;
    const fileToComp = new Map<string, string>();
    for (const [cid, fid] of fileIdByCompId) fileToComp.set(fid, cid);
    const active = new Set<string>();
    if (depFilter === "cycles") {
      for (const c of components) {
        const cfg = (c.config ?? {}) as any;
        if (c.type === "dependency-edge") {
          if (cfg.inCycle === true || cfg.isCircular === true) active.add(c.id);
        } else if (cfg.inCycle === true) {
          active.add(c.id);
        }
      }
    } else {
      // crossModule：跨模块边 + 两端节点
      for (const c of components) {
        if (c.type !== "dependency-edge") continue;
        const cfg = (c.config ?? {}) as any;
        if (cfg.crossModule === true) {
          active.add(c.id);
          const from = typeof cfg.fromFileId === "string" ? cfg.fromFileId : null;
          const to = typeof cfg.toFileId === "string" ? cfg.toFileId : null;
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
      useToastStore.getState().showToast(t("editor.depFilterEmpty"), "info");
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
      if (typeof owner === "string" && owner) s.add(owner);
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
      console.error("[drill] toggle failed", e);
      useToastStore.getState().showToast(t("editor.drillFail"), "error");
    } finally {
      drillBusyRef.current = false;
    }
  }, []);

  // ─── 实体拖拽移动（biosphere 核心交互 A.3：单击选中 / 拖拽移动）───
  // memo 节点 + 只更新 transform，拖动帧只重渲染被拖实体，其余实体跳过。
  const updateComponentTransform = useEditorStore((s) => s.updateComponentTransform);
  const dragStateRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleNodeDragStart = useCallback((e: React.MouseEvent, comp: SceneComponent) => {
    if (e.button !== 0) return;
    // 连线 / 分层标记 / 象限背景区不可拖拽（象限背景纯装饰，pointer-events 已在 shell 层 none）
    if (comp.type === "dependency-edge" || comp.type === "layer-marker" || comp.type === "quadrant-zone-bg") return;
    // 默认目录树视图：实体由画像引擎自动布局（含树形引导线），
    // 手动拖动会破坏缩进结构与父子连线，故禁止任何实体在此视图拖动
    if (useEditorStore.getState().activeViewId === "default") return;
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
  }, [selectComponent]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      // 用 live 视口的 scale（state 是节流的，拖实体时若刚缩放过会算错位移）
      const s = viewportRef.current.scale;
      const x = Math.max(0, st.origX + (e.clientX - st.startX) / s);
      const y = Math.max(0, st.origY + (e.clientY - st.startY) / s);
      updateComponentTransform(st.id, { x, y });
    };
    const onUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateComponentTransform, viewportRef]);

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
      logger.throttled("canvas.fitSkipEmpty", "ProjectCanvas", "fit effect skipped: no canvas or no components", () => ({
        hasCanvas: !!el,
        componentsCount: components.length,
        fitRequestTs: fitRequest?.ts,
      }));
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      logger.throttled("canvas.fitSkipZero", "ProjectCanvas", "fit effect skipped: canvas size zero", () => ({
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
    const bounds = contentBounds(targets.length > 0 ? targets : components);
    const next = fitViewport(bounds, { width: rect.width, height: rect.height }, ZOOM_LIMITS);
    logger.throttled(
      "canvas.fit",
      "ProjectCanvas",
      "fit effect computed viewport",
      () => ({
        fitRequestTs: fitRequest.ts,
        targetCount: targets.length,
        bounds,
        containerSize: { width: rect.width, height: rect.height },
        computedViewport: next,
      }),
      1000
    );
    if (next) setViewportAnimated(next);
  }, [fitRequest, components, setViewportAnimated, ZOOM_LIMITS, canvasSize.width, canvasSize.height]);

  // 打开上下文菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // 查找点击的目标组件
      const target = (e.target as HTMLElement).closest("[data-component-id]");
      const componentId = target
        ? target.getAttribute("data-component-id")
        : null;

      setContextMenu(
        contextMenu === null
          ? { mouseX: e.clientX, mouseY: e.clientY, componentId }
          : null
      );
    },
    [contextMenu]
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ─── 拖放处理 ───
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDragOver) setIsDragOver(true);

    // 更新拖放预览位置（用 live 视口换算，平移中也准）
    setDragPreview(clientToCanvas(e.clientX, e.clientY));
  }, [isDragOver, clientToCanvas]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 仅在真正离开画布时清除（避免子元素冒泡干扰）
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setDragPreview(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDragPreview(null);

    const entityType = e.dataTransfer.getData("application/x-project-entity");
    if (!entityType) return;

    const pt = clientToCanvas(e.clientX, e.clientY);

    // 默认位置：实体大小 140x60，居中于鼠标位置
    const defaultSize = componentRegistry.get(entityType)?.defaultSize || { width: 140, height: 60 };
    const posX = Math.max(0, pt.x - defaultSize.width / 2);
    const posY = Math.max(0, pt.y - defaultSize.height / 2);

    addComponent(entityType, undefined, { x: posX, y: posY });
  }, [clientToCanvas, addComponent]);

  return (
    <Box
      sx={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖放预览 */}
      {isDragOver && dragPreview && (
        <Box
          sx={{
            position: "absolute",
            left: dragPreview.x * scale + panOffset.x,
            top: dragPreview.y * scale + panOffset.y,
            width: 140,
            height: 60,
            border: "2px dashed",
            borderColor: "primary.main",
            borderRadius: 1,
            backgroundColor: (t) =>
              t.palette.mode === "dark" ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.08)",
            zIndex: 20,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography variant="caption" sx={{ color: "primary.main", fontSize: 10 }}>
            {t("editor.placeEntity")}
          </Typography>
        </Box>
      )}

      {/* ─── 影响链控制器（左上角浮层）───────────────────────────────────────
          「选中一个文件，画布告诉我改它会炸到谁」—— 这是画布从「静态画像」
          走向「可交互的分析工具」的关键一步。跳数点击循环：1 → 2 → 3 → 关。 */}
      <Box
        sx={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 11,
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          alignItems: "flex-start",
          maxWidth: 320,
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            pointerEvents: "auto",
            backgroundColor: (t) =>
              t.palette.mode === "dark" ? "rgba(30, 30, 40, 0.85)" : "rgba(255, 255, 255, 0.88)",
            backdropFilter: "blur(8px)",
            borderRadius: 1.5,
            border: 1,
            borderColor: "divider",
            px: 0.75,
            py: 0.4,
          }}
        >
          <HubIcon sx={{ fontSize: 13, color: chainDepth > 0 ? "primary.main" : "text.disabled" }} />
          <Typography
            variant="caption"
            onClick={() => setChainDepth((d) => (d >= 3 ? 0 : d + 1))}
            title={t("editor.chainDepthTip")}
            sx={{
              cursor: "pointer",
              fontSize: 10,
              lineHeight: 1,
              whiteSpace: "nowrap",
              color: chainDepth > 0 ? "text.primary" : "text.disabled",
              "&:hover": { color: "primary.main" },
            }}
          >
            {chainDepth > 0 ? t("editor.chainOn", { depth: chainDepth }) : t("editor.chainOff")}
          </Typography>
          {impactChain && (
            <>
              <Box sx={{ width: 1, height: 12, borderRight: 1, borderColor: "divider", mx: 0.25 }} />
              <Chip
                size="small"
                label={impactChain.source === "callGraph" ? t("editor.impactSymbol") : t("editor.impactFile")}
                title={
                  impactChain.source === "callGraph"
                    ? t("editor.impactSymbolTip")
                    : t("editor.impactFileTip")
                }
                sx={{
                  height: 15,
                  fontSize: 9,
                  "& .MuiChip-label": { px: 0.5 },
                  bgcolor: impactChain.source === "callGraph" ? "success.main" : "warning.main",
                  color: "#fff",
                }}
              />
              {/* 数据流剪枝：调用可达 → 数据可达的精度提升，只在真的剪掉东西时才提示 */}
              {impactChain.pruned > 0 && (
                <Chip
                  size="small"
                  label={t("editor.prunedLabel", { n: impactChain.pruned })}
                  title={t("editor.prunedTip", { n: impactChain.pruned })}
                  sx={{
                    height: 15,
                    fontSize: 9,
                    "& .MuiChip-label": { px: 0.5 },
                    bgcolor: "info.main",
                    color: "#fff",
                  }}
                />
              )}
            </>
          )}
        </Box>

        {/* 影响链图例 + 结论：只在真正命中时出现，不占空画布 */}
        {impactChain && impactChain.counts.totalFiles > 0 && (
          <Box
            sx={{
              pointerEvents: "auto",
              backgroundColor: (t) =>
                t.palette.mode === "dark" ? "rgba(30, 30, 40, 0.85)" : "rgba(255, 255, 255, 0.88)",
              backdropFilter: "blur(8px)",
              borderRadius: 1.5,
              border: 1,
              borderColor: "divider",
              px: 0.9,
              py: 0.5,
              display: "flex",
              flexDirection: "column",
              gap: 0.4,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {(["upstream", "downstream", "both"] as ChainSide[]).map((side) => {
                const n =
                  side === "upstream"
                    ? impactChain.counts.upstreamFiles
                    : side === "downstream"
                      ? impactChain.counts.downstreamFiles
                      : 0;
                if (side === "both" && !impactChain.files.size) return null;
                if (side !== "both" && n === 0) return null;
                if (side === "both") return null;
                return (
                  <Box key={side} sx={{ display: "flex", alignItems: "center", gap: 0.35 }}>
                    <Box
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        backgroundColor: CHAIN_SIDE_COLOR[side],
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="caption" sx={{ fontSize: 9.5, lineHeight: 1, color: "text.secondary" }}>
                      {t("editor.chainSide." + side)} {n}
                    </Typography>
                  </Box>
                );
              })}
              {/* 跳数梯度条：与实体描边强度同一口径 */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, ml: 0.25 }}>
                {[1, 2, 3].slice(0, chainDepth).map((d) => (
                  <Box
                    key={d}
                    title={t("editor.chainJumpShort", { d })}
                    sx={{
                      width: 10,
                      height: 4,
                      borderRadius: 0.5,
                      backgroundColor: "text.secondary",
                      opacity: chainDepthStyle(d).opacity,
                    }}
                  />
                ))}
              </Box>
            </Box>
            <Typography
              variant="caption"
              sx={{ fontSize: 9.5, lineHeight: 1.35, color: "text.secondary", maxWidth: 300 }}
            >
              {summarizeChain(impactChain)}
            </Typography>
            {/* 测试影响分析：把影响面直接翻译成「该跑哪些测试」，点击展开可运行命令 / CI 片段 */}
            {testImpact && (
              <Chip
                size="small"
                icon={<ScienceOutlinedIcon sx={{ fontSize: 11 }} />}
                label={
                  testImpact.tests.length > 0
                    ? t("editor.testImpactLabel", { n: testImpact.tests.length })
                    : t("editor.noTestCoverage")
                }
                onClick={(e) => {
                  if (testImpact.tests.length === 0) {
                    useToastStore.getState().showToast(summarizeTestImpact(testImpact), "warning");
                    return;
                  }
                  setTiaAnchor(e.currentTarget);
                }}
                title={
                  testImpact.tests.length > 0
                    ? testImpact.tests.map((tst) => t("editor.testItem", { depth: tst.depth, path: tst.relPath })).join("\n")
                    : t("editor.testImpactTip")
                }
                sx={{
                  height: 17,
                  fontSize: 9,
                  alignSelf: "flex-start",
                  cursor: "pointer",
                  "& .MuiChip-label": { px: 0.6 },
                  "& .MuiChip-icon": { ml: 0.5, mr: -0.3 },
                  bgcolor: testImpact.tests.length > 0 ? "info.main" : "error.main",
                  color: "#fff",
                  "&:hover": { opacity: 0.85 },
                }}
              />
            )}
            <Popover
              open={tiaOpen}
              anchorEl={tiaAnchor}
              onClose={() => setTiaAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              transformOrigin={{ vertical: "top", horizontal: "left" }}
            >
              <Box sx={{ width: 440, maxHeight: 460, overflow: "auto", p: 1.5 }}>
                {!testImpact || testImpact.tests.length === 0 ? (
                  <Alert severity="warning" sx={{ fontSize: 12 }}>
                    {t("editor.tiaAlert")}
                  </Alert>
                ) : (
                  <>
                    <Typography variant="subtitle2" sx={{ fontSize: 12, mb: 0.75 }}>
                      {t("editor.tiaTitle", { n: testImpact.tests.length })}
                    </Typography>
                    {testCommandPlan?.groups.map((g) => (
                      <Box key={g.runner} sx={{ mb: 1 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            mb: 0.25,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ fontSize: 10.5, fontWeight: 600, color: "text.secondary" }}
                          >
                            {resolveFragments(g.label)} · {g.tests.length}
                          </Typography>
                          <Button
                            size="small"
                            startIcon={<ContentCopyIcon sx={{ fontSize: 12 }} />}
                            onClick={() =>
                              copyText(g.command, t("editor.copyCmdOk", { label: g.label }), t("editor.copyCmdFail", { label: g.label }))
                            }
                            sx={{ minWidth: 0, fontSize: 10, py: 0.2, lineHeight: 1 }}
                          >
                            {t("editor.copy")}
                          </Button>
                        </Box>
                        <Box
                          component="pre"
                          sx={{
                            m: 0,
                            p: 0.75,
                            fontSize: 10.5,
                            lineHeight: 1.4,
                            bgcolor: "action.hover",
                            borderRadius: 1,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                            fontFamily: "monospace",
                          }}
                        >
                          {g.command}
                        </Box>
                      </Box>
                    ))}
                    <Divider sx={{ my: 1 }} />
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<ContentCopyIcon sx={{ fontSize: 13 }} />}
                        onClick={() =>
                          copyText(
                            testCommandPlan!.allCommandsText,
                            t("editor.copyAllOk"),
                            t("editor.copyFail")
                          )
                        }
                      >
                        {t("editor.allCommands")}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<TerminalIcon sx={{ fontSize: 13 }} />}
                        onClick={() =>
                          copyText(
                            buildCIPipelineScript(testImpact),
                            t("editor.ciScriptOk"),
                            t("editor.copyFail")
                          )
                        }
                      >
                        {t("editor.ciScript")}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<BuildIcon sx={{ fontSize: 13 }} />}
                        onClick={() =>
                          copyText(
                            buildGitHubActionStep(testImpact),
                            t("editor.ghActionsOk"),
                            t("editor.copyFail")
                          )
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

      {/* 缩放控制器（底部居中，与 biosphere 一致） */}
      <Box
        sx={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          backgroundColor: (t) =>
            t.palette.mode === "dark" ? "rgba(30, 30, 40, 0.85)" : "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(8px)",
          borderRadius: 1.5,
          border: 1,
          borderColor: "divider",
          px: 1,
          py: 0.5,
        }}
      >
        <Typography
          variant="caption"
          onClick={() => zoomByStep(-1)}
          sx={{ cursor: "pointer", px: 0.5, fontSize: 14, lineHeight: 1, color: "text.secondary", "&:hover": { color: "text.primary" } }}
        >
          −
        </Typography>
        <Chip
          label={`${Math.round(scale * 100)}%`}
          size="small"
          variant="outlined"
          onClick={handleResetView}
          sx={{ height: 20, fontSize: 10, cursor: "pointer" }}
        />
        {/* LOD 模式提示：全览时实体会降级成简卡/色块，这是刻意的性能取舍，
            不加提示历史上被反复误读成「实体没渲染出来」。 */}
        {lod !== "full" && (
          <span
            title={
              lod === "compact"
                ? t("editor.lodCompactTip")
                : t("editor.lodBlockTip")
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              height: 20,
              padding: "0 6px",
              borderRadius: 10,
              fontSize: 10,
              lineHeight: 1,
              cursor: "help",
              whiteSpace: "nowrap",
              color: lod === "compact" ? CV.primary : CV.warning,
              backgroundColor: lod === "compact" ? CV.infoSoft : CV.warningSoft,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                backgroundColor: "currentColor",
              }}
            />
            {lod === "compact" ? t("editor.lodCompact") : t("editor.lodBlock")}
          </span>
        )}
        <Typography
          variant="caption"
          onClick={() => zoomByStep(1)}
          sx={{ cursor: "pointer", px: 0.5, fontSize: 14, lineHeight: 1, color: "text.secondary", "&:hover": { color: "text.primary" } }}
        >
          +
        </Typography>
        <Box sx={{ width: 1, height: 14, mx: 0.25, borderRight: 1, borderColor: "divider" }} />
        <Typography
          variant="caption"
          onClick={handleResetView}
          sx={{ cursor: "pointer", px: 0.5, fontSize: 10, lineHeight: 1, color: "text.secondary", "&:hover": { color: "text.primary" }, whiteSpace: "nowrap" }}
        >
          1:1
        </Typography>
        <Typography
          variant="caption"
          onClick={() => {
            useEditorStore.getState().requestFit();
          }}
          sx={{ cursor: "pointer", px: 0.5, fontSize: 10, lineHeight: 1, color: "text.secondary", "&:hover": { color: "text.primary" }, whiteSpace: "nowrap" }}
        >
          {t("editor.fit")}
        </Typography>
      </Box>

      {/* AI 入口：画布右下角悬浮按钮（常驻可见，统一靛紫 AI 视觉） */}
      <Box
        sx={{
          position: "absolute",
          bottom: 16,
          right: 16,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
        }}
      >
        <Fab
          size="medium"
          aria-label={t("aiPanel.openAssistant")}
          onClick={(e) => setAiMenuAnchor(e.currentTarget)}
          sx={{ ...aiButtonSx, boxShadow: 3 }}
        >
          <SmartToyIcon />
        </Fab>
        <Menu
          anchorEl={aiMenuAnchor}
          open={!!aiMenuAnchor}
          onClose={() => setAiMenuAnchor(null)}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        >
          <MenuItem
            disabled={!selectedFileForAi}
            onClick={() => {
              if (selectedFileForAi) {
                triggerDiagnosis({
                  filePath: selectedFileForAi,
                  kind: "file",
                  title: t("aiPanel.diagnoseSelected"),
                });
              }
              setAiMenuAnchor(null);
            }}
          >
            <ListItemIcon sx={{ color: AI_COLOR, minWidth: 28 }}>
              <AutoFixHighIcon sx={{ fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText
              primary={t("aiPanel.diagnoseSelected")}
              secondary={selectedFileForAi ? null : t("aiPanel.diagnoseSelectedHint")}
              sx={{ "& .MuiListItemText-primary": { fontSize: 13 }, "& .MuiListItemText-secondary": { fontSize: 10 } }}
            />
          </MenuItem>
          <MenuItem
            onClick={() => {
              useEditorStore.getState().requestAiPanel();
              setAiMenuAnchor(null);
            }}
          >
            <ListItemIcon sx={{ color: AI_COLOR, minWidth: 28 }}>
              <SmartToyIcon sx={{ fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText primary={t("aiPanel.openAssistant")} sx={{ "& .MuiListItemText-primary": { fontSize: 13 } }} />
          </MenuItem>
        </Menu>
      </Box>

      {/* 画布视口 */}
      <Box
        ref={canvasRef}
        onMouseDown={panHandlers.onMouseDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => {
          // 只在点击空白区域时取消选中
          if (e.target === e.currentTarget) deselectAll();
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          overflow: "hidden",
          position: "relative",
          cursor: isPanning ? "grabbing" : "grab",
          backgroundColor: (t) =>
            t.palette.mode === "dark" ? "rgba(20, 20, 28, 1)" : "rgba(248, 250, 252, 1)",
          backgroundImage: (t) =>
            t.palette.mode === "dark"
              ? "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)"
              : "linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)",
          // 初值由 sx 提供；后续由 useCanvasPanZoom 直写 DOM（rAF），不走 React
          ...backgroundCss(viewport),
          outline: isDragOver ? "2px solid" : "none",
          outlineColor: "primary.main",
          outlineOffset: -2,
        }}
      >
        {/* 变换容器：transform 由 useCanvasPanZoom 直写 DOM，React 只给初值 */}
        <Box
          ref={contentRef}
          sx={{
            transform: transformCss(viewport),
            transformOrigin: "0 0",
            position: "absolute",
            left: 0,
            top: 0,
            willChange: "transform",
            pointerEvents: isPanning ? "none" : "auto",
          }}
        >
          {/* 视口虚拟化：只渲染视口内实体（大项目数百实体时平移缩放不掉帧）；
              选中实体无条件渲染，fit 全览时全部可见 → 自然全量渲染。
              displayComponents 已把 dependency-edge 放到最前，避免边遮实体。
              （兜底：边 shell 已 pointer-events:none，不会真拦截实体点击） */}
          {displayComponents.map((comp) => {
            const isSelected = selectedIdSet.has(comp.id);

            // 强调态计算（纯 O(1) 查表，不逐实体遍历依赖）
            // v2.21 叠加语义：筛选镜是「范围裁剪」，选中高亮是「重点强调」，二者叠加而非互斥。
            //   - 选中(self) 最高优先；
            //   - 筛选镜生效且本实体不在命中集 → 直接淡化（最外层裁剪）；
            //   - 通过筛选的实体，再叠加选中高亮（related/edge）；
            //   - 通过筛选但不在 related 集合：筛选生效时保持 normal（不被淡化），
            //     仅选中高亮生效时（无筛选）才 dim（即「只看某文件邻居」的预期）。
            let emphasis: CanvasEmphasis = "normal";
            // 重构四象限背景分区（v2.29）：纯装饰层，永不参与选中/聚焦淡化，
            // 始终满透明度显示（淡化逻辑对背景无意义，且会削弱分区可读性）。
            if (comp.type === "quadrant-zone-bg") {
              return (
                <CanvasEntityNode
                  key={comp.id}
                  comp={comp}
                  isSelected={false}
                  emphasis={"normal"}
                  layerColor={""}
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
              emphasis = "self";
            } else if (filterActive && !depActiveIds!.has(comp.id)) {
              // 依赖画像筛选镜：未命中的实体整体淡化（边 0.12 / 节点 0.32）
              emphasis = "dim";
            } else if (relatedFileIds || relatedModuleNames || relatedSymbolIds) {
              const cfg = (comp.config ?? {}) as Record<string, unknown>;
              // 筛选生效时通过筛选但不在 related → 正常显示；仅高亮生效时 → 淡化其余
              const dimElse = filterActive ? "normal" : "dim";
              if (comp.type === "dependency-edge") {
                // 依赖连线：文件级（fromFileId/toFileId）或模块级（fromMod/toMod）命中关联子图即点亮
                const from = typeof cfg.fromFileId === "string" ? cfg.fromFileId : null;
                const to = typeof cfg.toFileId === "string" ? cfg.toFileId : null;
                const fileHit = from && to && relatedFileIds?.has(from) && relatedFileIds?.has(to);
                const fromMod = typeof cfg.fromMod === "string" ? cfg.fromMod : null;
                const toMod = typeof cfg.toMod === "string" ? cfg.toMod : null;
                const modHit =
                  !!relatedModuleNames &&
                  !!fromMod &&
                  !!toMod &&
                  relatedModuleNames.has(fromMod) &&
                  relatedModuleNames.has(toMod);
                emphasis = fileHit || modHit ? "edge" : dimElse;
              } else if (comp.type === "module" && !(comp.config as any)?.symbolKind) {
                // 模块实体：自身属于关联模块集合（选中模块自身/邻居/文件所属模块）即点亮
                const modName =
                  typeof cfg.moduleName === "string" ? cfg.moduleName : typeof cfg.name === "string" ? cfg.name : comp.name;
                emphasis = !!relatedModuleNames && relatedModuleNames.has(modName) ? "related" : dimElse;
              } else if (
                cfg.portraitMode === "symbols" &&
                typeof cfg.symbolId === "string" &&
                relatedSymbolIds
              ) {
                // 符号实体（代码结构画像）：命中符号级调用邻居才点亮
                emphasis = relatedSymbolIds.has(cfg.symbolId) ? "related" : dimElse;
              } else {
                const fid = fileIdByCompId.get(comp.id);
                emphasis = fid && relatedFileIds?.has(fid) ? "related" : dimElse;
              }
            }

            const layerColor = layerColorById.get((comp.config as any)?.projectLayerId) || "";

            // v2.29 象限区标签：把实时文件计数注入 subtitle（「该象限 N 个文件」），
            // 让四象限分布一眼可见；非象限标签保持原 config。
            let renderComp = comp;
            if (comp.type === "layer-marker") {
              const qz = (comp.config as Record<string, unknown>)?.quadrantZone;
              if (typeof qz === "string" && qz in quadrantZoneCounts) {
                const n = quadrantZoneCounts[qz];
                renderComp = {
                  ...comp,
                  config: { ...(comp.config as Record<string, unknown>), subtitle: t("editor.quadZoneCount", { n }) },
                };
              }
            }

            // 影响链梯度：非连线实体按其关联文件在链上的跳数着色
            let chainDepthOf: number | null = null;
            let chainSideOf: ChainSide | null = null;
            if (impactChain && emphasis !== "dim" && comp.type !== "dependency-edge") {
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
                onEdgeClick={comp.type === "dependency-edge" ? handleEdgeClick : undefined}
              />
            );
          })}
        </Box>

        {/* 画布为空提示：覆盖整个画布视口并真正居中（与缩放/平移 transform 解耦，
            从变换容器移出，避免随画布原点偏移导致提示贴在左上角） */}
        {components.length === 0 && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              color: "text.secondary",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            {scanning || syncing ? (
              <CanvasLoadingSkeleton
                mode={scanning ? "scan" : "sync"}
                stage={scanStage}
                percent={scanPercent}
                scanned={scanScanned}
                total={scanTotal}
              />
            ) : (
              <>
                <AccountTreeIcon sx={{ fontSize: 48, opacity: 0.2 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "text.primary" }}>
                  {t("editor.emptyTitle")}
                </Typography>
                <Typography variant="caption" sx={{ maxWidth: 320 }}>
                  {projectFiles.length > 0
                    ? t("editor.emptySyncedHint")
                    : t("editor.emptyUnsyncedHint")}
                </Typography>
                {projectFiles.length > 0 && onSyncToCanvas && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<HubIcon />}
                    onClick={() => onSyncToCanvas()}
                    sx={{ pointerEvents: "auto", mt: 1 }}
                  >
                    {t("editor.syncNow")}
                  </Button>
                )}
              </>
            )}
          </Box>
        )}

      </Box>

      {/* 小地图：全局俯瞰 + 风险热区（视口虚拟化之后唯一的「统筹全局」手段） */}
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

export function SceneEditor({ onOpenLayersDialog, onSyncToCanvas, syncing }: { onOpenLayersDialog?: () => void; onSyncToCanvas?: () => void; syncing?: boolean }) {
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
      useToastStore.getState().showToast(
        synced ? t("editor.searchNoMatch", { q }) : t("editor.searchUnsynced"),
        "warning"
      );
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
    setDirSearchInput("");
    if (dirSearchTimer.current) window.clearTimeout(dirSearchTimer.current);
    void applyDirSearch("");
  };

  // ─── 代码结构画像内搜索（v2.3）：仅符号画像视图激活时显示。
  const symViewLabel = t("editorPage.portrait.symbols.label");
  const symViewName = activeViewName ?? "";
  const isSymbolView =
    symViewName === symViewLabel || symViewName.startsWith(`${symViewLabel} `);
  // v2.17 依赖画像视图：布局模式切换（聚簇/分层）只在此视图出现
  const depViewLabel = t("editorPage.portrait.dependency.label");
  const depViewName = activeViewName ?? "";
  const isDepView =
    depViewName === depViewLabel || depViewName.startsWith(`${depViewLabel} `);
  const depLayoutMode = useEditorStore((s2) => s2.depLayoutMode);
  const depFilter = useEditorStore((s2) => s2.depFilter);
  const depFocusFileId = useEditorStore((s2) => s2.depFocusFileId);
  const depFocusFile = useProjectStore((s) => s.files.find((f) => f.id === depFocusFileId));
  // v2.28 重构四象限聚焦象限（会话态）：非空=用户点击了画布象限标签，该象限文件高亮、其余淡化
  const quadrantFocusZone = useEditorStore((s2) => s2.quadrantFocusZone);
  // v2.17 依赖画像布局模式切换：聚簇 ↔ 分层，切换后重跑依赖画像（保留当前焦点高亮）
  const switchDepLayout = useCallback((mode: "force" | "layered") => {
    useEditorStore.getState().setDepLayoutMode(mode);
    const sid = useSceneStore.getState().activeSceneId;
    if (sid) {
      const focus = useEditorStore.getState().depFocusFileId ?? undefined;
      void runPortrait("dependency", sid, focus ? { focusFileId: focus } : undefined).then((res) =>
        useToastStore.getState().showToast(res.message, res.severity)
      );
    }
  }, []);
  // v2.17 依赖画像焦点复位：返回 top-90 全局总览（清空焦点文件）
  const resetDepFocus = useCallback(() => {
    const sid = useSceneStore.getState().activeSceneId;
    useEditorStore.getState().setDepFocusFileId(null);
    if (sid) {
      void runPortrait("dependency", sid).then((res) =>
        useToastStore.getState().showToast(res.message, res.severity)
      );
    }
  }, []);
  const DIR_SORT_ORDER = ["size", "name", "path"] as const;
  const DIR_SORT_LABEL: Record<string, string> = {
    size: t("editor.dirSortSize"),
    name: t("editor.dirSortName"),
    path: t("editor.dirSortPath"),
  };
  // 目录排序视图的 name 存 **key**（而非 t() 译文），使「查找/复用/判断」与语言无关；
  // tab 标签渲染侧用 resolveFragments 解引用显示当前语言。
  const DIR_SORT_VIEW_KEY = "editor.dirSortView";
  const DIR_SORT_VIEW_NAME = t("editor.dirSortView");
  /** 取或建「目录排序」专用视图：复用同名视图，绝不覆盖默认目录树视图 */
  const getOrCreateDirSortView = (): string => {
    const editor = useEditorStore.getState();
    // 兼容 key 与历史版本存的中文译文（语言切换前创建的旧视图）
    const existing = editor.views.find(
      (v) => v.name === DIR_SORT_VIEW_KEY || v.name === DIR_SORT_VIEW_NAME,
    );
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
    activeViewId === "default" ||
    activeViewName === DIR_SORT_VIEW_KEY ||
    activeViewName === DIR_SORT_VIEW_NAME;
  const cycleDirSort = async () => {
    const st = useEditorStore.getState();
    const cur = st.directorySort;
    const next = DIR_SORT_ORDER[(DIR_SORT_ORDER.indexOf(cur) + 1) % DIR_SORT_ORDER.length];
    st.setDirectorySort(next);
    switchToDirSortView();
    const sid = useSceneStore.getState().activeSceneId;
    if (sid) {
      const out = await rerenderDirectoryTree(sid);
      useToastStore.getState().showToast(
        out.ok ? t("editor.dirSortToast", { label: DIR_SORT_LABEL[next] }) : out.message,
        out.ok ? "success" : "warning"
      );
    }
  };
  const activeScene = useMemo(
    () => scenes.find((s) => s.id === activeSceneId) ?? null,
    [scenes, activeSceneId]
  );

  // ───────────────────── v2.18 变更耦合工具栏三件套 ─────────────────────
  // 与 v2.17 依赖画像工具栏同形态（filter / window / focus），但语义对齐到「时间维度耦合」：
  // - filter   ：前端切片（不动 DB），瞬间重画
  // - window   ：UI 切时窗会触发 store.analyzeChangeCoupling 真重扫 → 入库 → 重画
  // - focus    ：树驱动 1-跳子图（B3 详细实施，B1 先把 state 位与 UI 占位占好）
  const couplingViewLabel = t("editorPage.portrait.changeCoupling.label");
  const couplingViewName = activeViewName ?? "";
  const isCouplingView =
    couplingViewName === couplingViewLabel ||
    couplingViewName.startsWith(`${couplingViewLabel} `);
  const couplingFilter = useEditorStore((s2) => s2.couplingFilter);
  const couplingWindowDays = useEditorStore((s2) => s2.couplingWindowDays);
  const couplingFocusFileId = useEditorStore((s2) => s2.couplingFocusFileId);
  const couplingLayoutMode = useEditorStore((s2) => s2.couplingLayoutMode);
  const couplingFocusFile = useProjectStore((s) =>
    s.files.find((f) => f.id === couplingFocusFileId)
  );

  /** v2.18 切 layout：force ↔ cluster（前端切片，瞬间重画，不动 DB） */
  const handleCouplingLayout = useCallback(
    (mode: "force" | "cluster") => {
      useEditorStore.getState().setCouplingLayoutMode(mode);
      const sid = useSceneStore.getState().activeSceneId;
      if (sid) {
        void runPortrait("changeCoupling", sid).then((res) =>
          useToastStore.getState().showToast(res.message, res.severity)
        );
      }
    },
    []
  );

  /** 切 filter：纯前端切片，store 落字段 + 立刻重画当前耦合视图（不动 DB） */
  const handleCouplingFilter = useCallback(
    (f: "all" | "hidden" | "highRisk" | "crossModule") => {
      useEditorStore.getState().setCouplingFilter(f);
      const sid = useSceneStore.getState().activeSceneId;
      if (sid) {
        void runPortrait("changeCoupling", sid).then((res) =>
          useToastStore.getState().showToast(res.message, res.severity)
        );
      }
    },
    []
  );

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
      const projectRoot = activeScene?.projectRoot ?? "";
      if (!projectRoot) {
        // 罕见：scene 还没有 projectRoot（新建 scene 未扫描过）。静默返回即可，
        // 工具栏仍可见方便后续 retry；切时窗是最直接的「先扫描」触发器
        return;
      }
      void (async () => {
        try {
          // v2.18 默认值修复：让 null（=点「全量」按钮）= 真全量透传到后端；
          // 之前 ?? 365 把 null 偷偷变 365 天窗口。现在 store + wrapper 都 `?? null`，三层一致。
          await useProjectStore.getState().analyzeChangeCoupling(
            sid,
            projectRoot,
            days
          );
          const out = await runPortrait("changeCoupling", sid);
          useToastStore.getState().showToast(out.message, out.severity);
        } catch (e) {
          useToastStore.getState().showToast(String(e), "warning");
        }
      })();
    },
    [activeScene]
  );

  /** 焦点复位（B3 详细实施，B1 仅占位） */
  const resetCouplingFocus = useCallback(() => {
    const sid = useSceneStore.getState().activeSceneId;
    useEditorStore.getState().setCouplingFocusFileId(null);
    if (sid) {
      void runPortrait("changeCoupling", sid).then((res) =>
        useToastStore.getState().showToast(res.message, res.severity)
      );
    }
  }, []);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const removeComponent = useEditorStore((s) => s.removeComponent);
  const selectedIds = useEditorStore((s) => s.selection.selectedIds);
  const selectedComponent = useMemo(() => {
    const sid = selectedIds[0];
    if (!sid) return null;
    const comp = useEditorStore.getState().components.find((c) => c.id === sid);
    return comp ? { id: comp.id, type: comp.type, name: comp.name, config: comp.config } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);
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
  // AI 助手并入右侧 tab 体系（第 6 个 tab），与代码工作台 dock 的「AI 助手」tab 一致；
  // 不再另开独立浮层，避免分析器页面右侧同时出现「分析 tab 面板 + AI 浮层」两个面板。
  const AI_TAB = 5;
  // 「从分析点发起 AI 诊断」/「打开助手」→ 切到右侧 AI tab（而非弹出独立右栏）。
  useEffect(() => {
    if (aiPanelRequest > 0) {
      setRightTab(AI_TAB);
      setRightPanelOpen(true);
    }
  }, [aiPanelRequest]);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  // ─── 右侧面板可拖拽宽度（v2.5）───
  // null = 未自定义（按 tab 给默认：AI 400 / 其他 300）；拖拽后记住自定义值，
  // 切换 tab 不重置。clamp 240~720 防拖到不可用。
  const [rightPanelWidth, setRightPanelWidth] = useState<number | null>(null);
  const currentRightWidth = rightPanelWidth ?? (rightTab === AI_TAB ? 400 : 300);
  const startRightResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = currentRightWidth;
    const onMove = (ev: MouseEvent) => {
      const w = startW + (startX - ev.clientX); // 手柄在右栏左侧：往左拖变宽
      setRightPanelWidth(Math.min(720, Math.max(240, Math.round(w))));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

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
  // 左面板展开/收起（默认展开，与 biosphere 一致）
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);

  // 审查统计
  const findingsCount = findings.length;
  const criticalCount = findings.filter((f) => f.severity === "critical").length;

  const publishScene = useSceneStore((s) => s.publishScene);
  const activeSceneStatus = activeScene?.status;
  const showToast = useToastStore((s) => s.showToast);
  const activeAnalyzer = useActiveAnalyzer();
  const activeAnalyzerIds = useActiveAnalyzerIds();
  const extraAnalyzerCount = Math.max(0, activeAnalyzerIds.length - 1);

  // ─── 键盘快捷键 ───
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        e.preventDefault();
        selectedIds.forEach((id) => removeComponent(id));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, removeComponent, selectedIds]);

  // ─── 导出分析报告（HTML / JSON / SVG 格式选择，需求 §7.3 报告导出器）───
  const [exportAnchor, setExportAnchor] = useState<null | HTMLElement>(null);
  const handleExport = useCallback(
    async (format: "html" | "json" | "svg") => {
      if (!activeSceneId) return;
      setExportAnchor(null);
      try {
        await publishScene(activeSceneId, format);
        showToast(
          format === "json"
            ? t("editor.exportJsonOk")
            : format === "svg"
              ? t("editor.exportSvgOk")
              : t("editor.exportOk"),
          "success"
        );
      } catch {
        showToast(t("editor.exportFail"), "error");
      }
    },
    [activeSceneId, publishScene, showToast]
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
      showToast(t("editor.savedOk"), "success");
    } catch (e) {
      console.error("[SceneEditor] save failed", e);
      showToast(t("editor.saveFail"), "error");
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
          console.error("[SceneEditor] autosave failed, keep dirty for retry", e);
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
      logger.info("ProjectCanvas", "reload: no activeSceneId, clearing scene");
      clearScene();
      return;
    }

    const scene = useSceneStore.getState().scenes.find((s) => s.id === activeSceneId) ?? null;
    if (!scene) {
      logger.info("ProjectCanvas", "reload: scene not found, clearing", { activeSceneId });
      clearScene();
      return;
    }

    logger.info("ProjectCanvas", "reload: loading scene", {
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
      logger.info("ProjectCanvas", "reload: scene has no views, clearing");
      clearScene();
    }

    // 恢复目录画像视图态（排序/搜索/显隐文件），重载分析后不再回默认
    const dv = scene.directoryView;
    if (dv) {
      const st = useEditorStore.getState();
      if (dv.sort) st.setDirectorySort(dv.sort);
      if (typeof dv.search === "string") st.setDirectorySearch(dv.search);
      if (typeof dv.showFiles === "boolean") st.setDirectoryShowFiles(dv.showFiles);
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
    const isDefault = next.sort === "size" && next.search === "" && next.showFiles === false;
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
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Typography variant="body1" color="text.secondary">
          {t("editor.noAnalysis")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* 顶部工具栏（单行 36px，与 biosphere 一致） */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
          backgroundColor: (t) =>
            t.palette.mode === "dark" ? "rgba(18, 18, 24, 0.95)" : "rgba(255, 255, 255, 0.95)",
          gap: 0.5,
          height: 36,
          position: "relative",
          zIndex: 100,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
          <Tooltip title={t("editor.undo")}>
            <span>
              <IconButton size="small" onClick={undo} disabled={!canUndoVal} sx={{ opacity: canUndoVal ? 1 : 0.35 }}>
                <UndoIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t("editor.redo")}>
            <span>
              <IconButton size="small" onClick={redo} disabled={!canRedoVal} sx={{ opacity: canRedoVal ? 1 : 0.35 }}>
                <RedoIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t("editor.save")}>
            <IconButton size="small" onClick={handleManualSave} color={isDirty ? "primary" : "default"}>
              <SaveIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />

        <PluginSelector />

        {/* v2.17 依赖画像布局模式：力导向聚簇 / 拓扑分层（入口→底座） */}
        {isDepView && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={depLayoutMode}
              onChange={(_e, v) => {
                if (v === "layered" || v === "force") switchDepLayout(v);
              }}
              sx={{ "& .MuiToggleButton-root": { height: 26, fontSize: 11, px: 1, textTransform: "none" } }}
            >
              <ToggleButton value="force">{t("editor.depLayoutForce")}</ToggleButton>
              <ToggleButton value="layered">{t("editor.depLayoutLayered")}</ToggleButton>
            </ToggleButtonGroup>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
            {/* v2.17 依赖画像筛选镜：全部 / 仅循环依赖 / 仅跨模块边（淡化其余实体） */}
            <ToggleButtonGroup
              size="small"
              exclusive
              value={depFilter}
              onChange={(_e, v) => {
                if (v === "all" || v === "cycles" || v === "crossModule") {
                  useEditorStore.getState().setDepFilter(v);
                }
              }}
              sx={{ "& .MuiToggleButton-root": { height: 26, fontSize: 11, px: 1, textTransform: "none" } }}
            >
              <ToggleButton value="all">{t("editor.depFilterAll")}</ToggleButton>
              <ToggleButton value="cycles">{t("editor.depFilterCycles")}</ToggleButton>
              <ToggleButton value="crossModule">{t("editor.depFilterCross")}</ToggleButton>
            </ToggleButtonGroup>
            {/* v2.17 焦点高亮指示 + 复位：点左侧项目树任意文件在全局依赖图中高亮其邻域后，
                这里显示当前焦点文件并提供「返回总览」入口（清空焦点、回到纯 top-90 全局图） */}
            {depFocusFileId && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
                <Box
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    height: 26,
                    px: 1,
                    borderRadius: 1,
                    bgcolor: "action.selected",
                    fontSize: 11,
                    maxWidth: 200,
                  }}
                >
                  <span style={{ color: "var(--mui-palette-primary-main)", fontWeight: 700 }}>
                    {t("editor.depFocusActive")}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--mui-palette-text-secondary, #64748b)",
                    }}
                  >
                    {depFocusFile?.name ?? ""}
                  </span>
                </Box>
                <Tooltip title={t("editor.depFocusResetTip")}>
                  <Button
                    size="small"
                    variant="text"
                    color="primary"
                    onClick={resetDepFocus}
                    sx={{ height: 26, fontSize: 11, textTransform: "none", minWidth: 0, px: 1 }}
                  >
                    {t("editor.depOverview")}
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
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    height: 26,
                    px: 1,
                    borderRadius: 1,
                    bgcolor: "action.selected",
                    fontSize: 11,
                    maxWidth: 200,
                  }}
                >
                  <span style={{ color: "var(--mui-palette-primary-main)", fontWeight: 700 }}>
                    {t("editor.quadFocusActive")}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--mui-palette-text-secondary, #64748b)",
                    }}
                  >
                    {t(`insight.quad.${quadrantFocusZone}`)}
                  </span>
                </Box>
                <Tooltip title={t("editor.quadFocusResetTip")}>
                  <Button
                    size="small"
                    variant="text"
                    color="primary"
                    onClick={() => useEditorStore.getState().setQuadrantFocusZone(null)}
                    sx={{ height: 26, fontSize: 11, textTransform: "none", minWidth: 0, px: 1 }}
                  >
                    {t("editor.quadOverview")}
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
              sx={{ "& .MuiToggleButton-root": { height: 26, fontSize: 11, px: 1, textTransform: "none" } }}
            >
              <ToggleButton value="all">{t("editor.couplingFilterAll")}</ToggleButton>
              <ToggleButton value="hidden">{t("editor.couplingFilterHidden")}</ToggleButton>
              <ToggleButton value="highRisk">{t("editor.couplingFilterHighRisk")}</ToggleButton>
              <ToggleButton value="crossModule">{t("editor.couplingFilterCrossModule")}</ToggleButton>
            </ToggleButtonGroup>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={couplingWindowDays === null ? "all" : String(couplingWindowDays)}
              onChange={(_e, v) =>
                v !== null && v !== undefined && handleCouplingWindow(v === "all" ? null : Number(v))
              }
              sx={{ "& .MuiToggleButton-root": { height: 26, fontSize: 11, px: 1, textTransform: "none" } }}
            >
              <ToggleButton value="all">{t("editor.couplingWindowAll")}</ToggleButton>
              <ToggleButton value="90">{t("editor.couplingWindowM3")}</ToggleButton>
              <ToggleButton value="180">{t("editor.couplingWindowM6")}</ToggleButton>
              <ToggleButton value="365">{t("editor.couplingWindowY1")}</ToggleButton>
            </ToggleButtonGroup>
            {/* v2.18 layout 双模式：force=力导向 / cluster=按顶层目录硬分区+模块簇染色+跨模块边加粗 */}
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={couplingLayoutMode}
              onChange={(_e, v) => v && handleCouplingLayout(v)}
              sx={{ "& .MuiToggleButton-root": { height: 26, fontSize: 11, px: 1, textTransform: "none" } }}
            >
              <ToggleButton value="force">{t("editor.couplingLayoutForce")}</ToggleButton>
              <ToggleButton value="cluster">{t("editor.couplingLayoutCluster")}</ToggleButton>
            </ToggleButtonGroup>
            {/* 焦点占位：B1 不消费 focusFileId（本轮过滤逻辑不画子图），仅显示焦点文件 + 复位入口，
                让 store 字段 + UI 形态从一开始就与依赖画像对标，B3 直接接子图逻辑。 */}
            {couplingFocusFileId && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
                <Box
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    height: 26,
                    px: 1,
                    borderRadius: 1,
                    bgcolor: "action.selected",
                    fontSize: 11,
                    maxWidth: 200,
                  }}
                >
                  <span style={{ color: "var(--mui-palette-primary-main)", fontWeight: 700 }}>
                    {t("editor.couplingFocusActive")}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--mui-palette-text-secondary, #64748b)",
                    }}
                  >
                    {couplingFocusFile?.name ?? ""}
                  </span>
                </Box>
                <Tooltip title={t("editor.couplingFocusResetTip")}>
                  <Button
                    size="small"
                    variant="text"
                    color="primary"
                    onClick={resetCouplingFocus}
                    sx={{ height: 26, fontSize: 11, textTransform: "none", minWidth: 0, px: 1 }}
                  >
                    {t("editor.couplingOverview")}
                  </Button>
                </Tooltip>
              </>
            )}
          </>
        )}

        {isDirectoryView && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 20 }} />
            <Tooltip title={directoryShowFiles ? t("editor.hideFiles") : t("editor.showFiles")}>
              <IconButton
                size="small"
                color={directoryShowFiles ? "primary" : "default"}
                onClick={async () => {
                  const st = useEditorStore.getState();
                  const next = !st.directoryShowFiles;
                  st.setDirectoryShowFiles(next);
                  switchToDirSortView();
                  const sid = useSceneStore.getState().activeSceneId;
                  if (sid) {
                    const out = await rerenderDirectoryTree(sid);
                    useToastStore.getState().showToast(
                      out.ok
                        ? next
                          ? t("editor.filesShown")
                          : t("editor.filesHidden")
                        : out.message,
                      out.ok ? "success" : "warning"
                    );
                  }
                }}
                sx={{ backgroundColor: directoryShowFiles ? "action.selected" : "transparent" }}
              >
                <DescriptionOutlinedIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>

            <Tooltip title={t("editor.searchDirTip")}>
              <TextField
                size="small"
                value={dirSearchInput}
                onChange={onDirSearchChange}
                placeholder={t("editor.searchDirPlaceholder")}
                sx={{ width: 150, "& .MuiInputBase-root": { height: 28, fontSize: 12 } }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start" sx={{ mr: 0.25 }}>
                        <SearchIcon sx={{ fontSize: 14 }} />
                      </InputAdornment>
                    ),
                    endAdornment: dirSearchInput ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={clearDirSearch} sx={{ p: 0.25 }}>
                          <ClearIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
              />
            </Tooltip>

            <Tooltip title={t("editor.sortDimTip", { label: DIR_SORT_LABEL[directorySort] })}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <IconButton size="small" onClick={cycleDirSort} color="default">
                  <SortIcon sx={{ fontSize: 15 }} />
                </IconButton>
                <span
                  onClick={cycleDirSort}
                  style={{
                    fontSize: 12,
                    color: "var(--mui-palette-text-secondary, #64748b)",
                    cursor: "pointer",
                    userSelect: "none",
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

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
          <Tooltip title={leftPanelOpen ? t("editor.collapseLeft") : t("editor.expandLeft")}>
            <IconButton
              size="small"
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              sx={{
                backgroundColor: leftPanelOpen ? "action.selected" : "transparent",
              }}
            >
              <WidgetsIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={activeSceneStatus === "published" ? t("editor.published") : t("editor.exportReport")}>
            <span>
              <IconButton
                size="small"
                onClick={(e) => setExportAnchor(e.currentTarget)}
                color={activeSceneStatus === "published" ? "success" : "default"}
                disabled={activeSceneStatus === "published"}
                sx={{ opacity: activeSceneStatus === "published" ? 0.5 : 1 }}
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
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <MenuItem dense onClick={() => handleExport("html")}>
              <ListItemIcon><DescriptionOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary={t("editor.htmlReport")} secondary={t("editor.htmlReportDesc")} />
            </MenuItem>
            <MenuItem dense onClick={() => handleExport("json")}>
              <ListItemIcon><CodeIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary={t("editor.jsonReport")} secondary={t("editor.jsonReportDesc")} />
            </MenuItem>
            <MenuItem dense onClick={() => handleExport("svg")}>
              <ListItemIcon><SchemaOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary={t("editor.svgReport")} secondary={t("editor.svgReportDesc")} />
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      {/* 编辑区：左侧实体面板 + 中间画布 + 右侧属性面板 + 最右收起条 */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {/* 左侧实体/文件树面板（折叠交互与 biosphere 一致：260 → 40 动画） */}
        <ComponentCenterPanel
          collapsed={!leftPanelOpen}
          onToggle={() => setLeftPanelOpen(!leftPanelOpen)}
        />

        {/* 中间列：视图标签栏 + 画布 */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          <SceneTabBar />
          <Box sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ProjectCanvas onSyncToCanvas={onSyncToCanvas} syncing={syncing} />
          </Box>
        </Box>

        {/* 右侧面板（Tabs：详情 / 审查 / 分层 / 事件） */}
        {rightPanelOpen && (
        <>
        {/* 拖拽调宽手柄（v2.5）：独立元素在右栏左侧，mousedown 不冒泡到画布 pan */}
        <Box
          onMouseDown={startRightResize}
          title={t("editor.resizePanel")}
          sx={{
            width: 5,
            flexShrink: 0,
            cursor: "col-resize",
            borderLeft: 1,
            borderColor: "divider",
            "&:hover": { backgroundColor: "action.hover" },
            "&:active": { backgroundColor: "primary.light" },
          }}
        />
        <Box
          sx={{
            width: currentRightWidth,
            flexShrink: 0,
            borderLeft: 1,
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            backgroundColor: (t) =>
              t.palette.mode === "dark" ? "rgba(14, 14, 20, 0.92)" : "rgba(248, 248, 252, 0.95)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* 顶部：分析名称 + 语言 + 未保存 + 导出状态（与 biosphere 名称条一致） */}
          {activeScene && (
            <Box
              sx={{
                px: 1.5,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                gap: 1,
                flexShrink: 0,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: "text.primary",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
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
                      ? t("editor.pluginMain", {
                          name: activeAnalyzer.name,
                          version: activeAnalyzer.version,
                          count: extraAnalyzerCount,
                        })
                      : t("editor.pluginAnalyzer", {
                          name: activeAnalyzer.name,
                          version: activeAnalyzer.version,
                        })
                  }
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        bgcolor: (() => {
                          switch (activeAnalyzer.language.toLowerCase()) {
                            case "typescript": return "#3178c6";
                            case "rust": return "#dea584";
                            case "python": return "#3776ab";
                            default: return "#64748b";
                          }
                        })(),
                      }}
                    />
                    <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
                      {activeAnalyzer.language}
                      {extraAnalyzerCount > 0 ? ` +${extraAnalyzerCount}` : ""}
                    </Typography>
                  </Box>
                </Tooltip>
              )}
              {isDirty && (
                <Tooltip title={t("editor.unsaved")}>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bgcolor: "warning.main",
                      flexShrink: 0,
                    }}
                  />
                </Tooltip>
              )}
              <Chip
                label={activeSceneStatus === "published" ? t("editor.published") : t("editor.notExported")}
                size="small"
                color={activeSceneStatus === "published" ? "success" : "default"}
                variant="outlined"
                sx={{ height: 20, fontSize: "0.65rem", flexShrink: 0 }}
              />
            </Box>
          )}
          <Tabs
            value={rightTab}
            onChange={(_e, v) => setRightTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              minHeight: 36,
              borderBottom: 1,
              borderColor: "divider",
              "& .MuiTab-root": {
                minHeight: 36,
                py: 0.5,
                fontSize: 10,
                textTransform: "none",
              },
              "& .MuiTabs-scrollButtons": {
                width: 20,
                "&.Mui-disabled": { opacity: 0.3 },
              },
            }}
          >
            <Tab
              icon={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}
              iconPosition="start"
              label={t("editor.tabDetails")}
            />
            <Tab
              icon={
                <Box sx={{ position: "relative", display: "inline-flex" }}>
                  <RuleIcon sx={{ fontSize: 14 }} />
                  {criticalCount > 0 && (
                    <Box
                      sx={{
                        position: "absolute",
                        top: -2,
                        right: -4,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "error.main",
                        border: "1px solid",
                        borderColor: "background.paper",
                      }}
                    />
                  )}
                </Box>
              }
              iconPosition="start"
              label={`${t("editor.tabReview")}${findingsCount > 0 ? ` (${findingsCount})` : ""}`}
            />
            <Tab
              icon={<LayersIcon sx={{ fontSize: 14 }} />}
              iconPosition="start"
              label={`${t("editor.tabLayers")}${projectLayers.length > 0 ? ` (${projectLayers.length})` : ""}`}
            />
            <Tab
              icon={<MonitorHeartIcon sx={{ fontSize: 14 }} />}
              iconPosition="start"
              label={t("editor.tabHealth")}
            />
            <Tab
              icon={<HubIcon sx={{ fontSize: 14 }} />}
              iconPosition="start"
              label={t("editor.tabImpact")}
            />
            <Tab
              icon={<SmartToyIcon sx={{ fontSize: 14 }} />}
              iconPosition="start"
              label={t("editor.tabAi")}
            />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {rightTab === 0 && <EntityPortraitPanel entity={selectedComponent} />}
            {rightTab === 1 && <ReviewFindingsPanel />}
            {rightTab === 2 && (
              <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {t("editor.layerTitle")}
                </Typography>
                {projectLayers.length === 0 ? (
                  <Box sx={{ textAlign: "center", py: 3, color: "text.secondary" }}>
                    <LayersIcon sx={{ fontSize: 36, opacity: 0.2, mb: 1 }} />
                    <Typography variant="caption" sx={{ display: "block" }}>
                      {t("editor.noLayers")}
                    </Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                    {projectLayers.map((pl: any) => {
                      const fileCount = projectFiles.filter(
                        (f: any) => !f.isDirectory && f.layerId === pl.id
                      ).length;
                      return (
                        <Box
                          key={pl.id}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            px: 1,
                            py: 0.75,
                            borderRadius: 1,
                            border: 1,
                            borderColor: "divider",
                            bgcolor: "action.hover",
                          }}
                        >
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              backgroundColor: pl.color || "#94A3B8",
                              flexShrink: 0,
                            }}
                          />
                          <Typography variant="body2" sx={{ flex: 1, fontSize: 12 }}>
                            {pl.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t("editor.fileCount", { n: fileCount })}
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
                  sx={{ mt: 1, textTransform: "none", fontSize: 11 }}
                >
                  {t("editor.manageLayers")}
                </Button>
              </Box>
            )}
            {rightTab === 3 && <ArchitectureHealthPanel />}
            {rightTab === 4 && <ImpactAnalysisPanel entity={selectedComponent} />}
            {rightTab === AI_TAB && (
              <WorkbenchAiPanel
                activeFile={mainAiFile}
                selection={null}
                editorRef={aiEditorRef}
                onClose={() => setRightPanelOpen(false)}
                onOpenPath={(relPath, line) => {
                  const f = projectFiles.find((x) => x.relPath === relPath);
                  if (f) {
                    void spawnCodeWorkbench(f.id, line ?? null, useProjectStore.getState().activeAnalysisId);
                  } else {
                    useToastStore.getState().showToast(t("workbench.aiOpenPath.notFound", { path: relPath }), "info");
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
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            borderLeft: 1,
            borderColor: "divider",
            backgroundColor: (t) =>
              t.palette.mode === "dark" ? "rgba(18, 18, 24, 0.4)" : "rgba(250, 250, 252, 0.6)",
            "&:hover": {
              backgroundColor: (t) =>
                t.palette.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            },
          }}
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
        >
          {rightPanelOpen ? (
            <ChevronRightIcon sx={{ fontSize: 14 }} />
          ) : (
            <ChevronLeftIcon sx={{ fontSize: 14 }} />
          )}
        </Box>
      </Box>

      {/* 底部状态栏（需求 §5.1）：语言 / 实体 / 规则违规 / 扫描结果，统筹全局速览 */}
      <Box
        sx={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 1.5,
          py: 0.4,
          borderTop: 1,
          borderColor: "divider",
          backgroundColor: (t) =>
            t.palette.mode === "dark" ? "rgba(18, 18, 24, 0.6)" : "rgba(248, 250, 252, 0.7)",
          fontSize: 10,
          color: "text.secondary",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
          <CodeIcon sx={{ fontSize: 11, color: "primary.main", flexShrink: 0 }} />
          <Typography variant="caption" sx={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis" }}>
            {t("editor.statusLang", { lang: activeAnalyzer?.language ?? "—" })}
            {extraAnalyzerCount > 0 ? ` +${extraAnalyzerCount}` : ""}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <WidgetsIcon sx={{ fontSize: 11, color: "primary.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10 }}>
            {t("editor.statusEntities", { n: componentCount })}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <RuleIcon sx={{ fontSize: 11, color: criticalCount > 0 ? "error.main" : "primary.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10 }}>
            {t("editor.statusViolations", { n: findingsCount })}
            {criticalCount > 0 ? t("editor.statusCritical", { n: criticalCount }) : ""}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <SchemaOutlinedIcon sx={{ fontSize: 11, color: "primary.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10 }}>
            {t("editor.statusModules", {
              m: projectModules.length,
              f: projectFiles.filter((f: any) => !f.isDirectory).length,
            })}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <LayersIcon sx={{ fontSize: 11, color: "primary.main" }} />
          <Typography variant="caption" sx={{ fontSize: 10 }}>
            {t("editor.statusLayers", { n: projectLayers.length })}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {componentCount > 0 && (
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.disabled" }}>
            {t("editor.statusHint")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
