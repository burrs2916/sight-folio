// sight-folio: 项目分析 / 场景编辑 类型定义
// 保留 biosphere 场景编辑完整模型（Scene*，来自参考实现），并叠加项目扫描/审查字段（Analysis*）。
// 场景编辑功能与分析器能力在此共存：Scene* 供恢复出来的编辑器模块使用，Analysis* 供分析器前端使用。

import type { CRSType, SpatialBoundingBox, CameraConfig, SpatialSourceConfig } from "./spatial";
import type { SceneComponent, LayerNode, EventBinding, ViewportState } from "./editor";
import { t } from '../i18n';

// ============ 场景编辑模型（Scene，来自参考实现 biosphere-spatialdata-system）============

export type SceneStatus = "draft" | "published" | "archived";

export interface SceneCategory {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  parentId?: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SceneView {
  id: string;
  name: string;
  icon?: string;
  components: SceneComponent[];
  layers: LayerNode[];
  canvasConfig?: import("../store/editorStore").CanvasConfig;
  viewport?: ViewportState;
  eventBindings?: EventBinding[];
  /**
   * 写作嵌套 Tab（G2）：题材标记（novel/essay/...），L1 顶级 Tab 的分组键。
   * 缺省 = 归「总览」组（含 default 结构视图与历史遗留载体视图）。
   * 可选字段：JSON 落库自动兼容旧场景，零迁移。
   */
  carrierType?: string;
  /**
   * 写作类型化视图：L2 固定语义视图的单例标记，由调用方保证唯一。
   *   - "catalog"       大纲视图（章节按卷/序排布）
   *   - "characters"    人物/角色设定视图
   *   - "worldview"     世界观视图（worldbuilding 设定卡网格）
   *   - "timeline"      时间线视图（设定卡 timeline 事件按序铺开）
   *   - "storylines"    剧情线视图（主线/支线/感情线推进，二期随线索数据模型）
   *   - "foreshadowing" 伏笔视图（埋设→回收映射，二期随线索数据模型）
   *   - "inspiration"   灵感视图（便签/素材箱）
   *   - "proofread"     校对视图（文本检查发现清单）
   *   - "stats"         统计视图（字数/状态/进度指标）
   *   - "writing"       正文容器视图（内部挂卷/章节文档页签）
   *   - "overview"      全书总览视图（跨维度统一仪表盘，L2 第一公民页签，
   *                     由 openTypedCarrierView 创建，BookOverviewPanel 渲染）
   * 缺省 = 自由视图（「＋」自建或载体落卡）。
   */
  kind?:
    | "catalog"
    | "characters"
    | "worldview"
    | "timeline"
    | "storylines"
    | "foreshadowing"
    | "inspiration"
    | "proofread"
    | "stats"
    | "writing"
    | "overview";
}

export interface SceneLayer {
  id: string;
  name: string;
  type: SceneLayerType;
  dimension: "2d" | "3d";
  source: SpatialSourceConfig;
  visible: boolean;
  zIndex: number;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  style?: SceneLayerStyle;
  metadata?: Record<string, unknown>;
}

export type SceneLayerType =
  // ─── 空间图层（biosphere 继承）───
  | "tile"
  | "vector"
  | "geojson"
  | "cad"
  | "image"
  | "3d-model"
  // ─── 数据覆盖图层（biosphere 继承）───
  | "devices"
  | "topology"
  | "heatmap"
  // ─── 部件覆盖图层（biosphere 继承）───
  | "chart"
  | "metric"
  | "table"
  | "text"
  | "video"
  // ─── 项目分析图层（sight-folio 新增）───
  | "files"
  | "modules"
  | "dependencies"
  | "annotations";

export type SpatialLayerType = "tile" | "vector" | "geojson" | "cad" | "image" | "3d-model";
export type DataOverlayLayerType = "devices" | "topology" | "heatmap";
export type WidgetOverlayLayerType = "chart" | "metric" | "table" | "text" | "video";
export type ProjectAnalysisLayerType = "files" | "modules" | "dependencies" | "annotations";

export const SPATIAL_LAYER_TYPES: SpatialLayerType[] = ["tile", "vector", "geojson", "cad", "image", "3d-model"];
export const DATA_OVERLAY_LAYER_TYPES: DataOverlayLayerType[] = ["devices", "topology", "heatmap"];
export const WIDGET_OVERLAY_LAYER_TYPES: WidgetOverlayLayerType[] = ["chart", "metric", "table", "text", "video"];
export const PROJECT_ANALYSIS_LAYER_TYPES: ProjectAnalysisLayerType[] = ["files", "modules", "dependencies", "annotations"];

export function isSpatialLayer(type: SceneLayerType): type is SpatialLayerType {
  return SPATIAL_LAYER_TYPES.includes(type as SpatialLayerType);
}
export function isDataOverlayLayer(type: SceneLayerType): type is DataOverlayLayerType {
  return DATA_OVERLAY_LAYER_TYPES.includes(type as DataOverlayLayerType);
}
export function isWidgetOverlayLayer(type: SceneLayerType): type is WidgetOverlayLayerType {
  return WIDGET_OVERLAY_LAYER_TYPES.includes(type as WidgetOverlayLayerType);
}
export function isProjectAnalysisLayer(type: SceneLayerType): type is ProjectAnalysisLayerType {
  return PROJECT_ANALYSIS_LAYER_TYPES.includes(type as ProjectAnalysisLayerType);
}

export interface SceneLayerStyle {
  color?: string;
  opacity?: number;
  lineWidth?: number;
  fill?: boolean;
  icon?: string;
  fontSize?: number;
  fontWeight?: string;
}

export interface SceneBinding {
  id: string;
  componentId: string;
  dataSource: string;
  metricName: string;
  adapterType?: string;
  dataSourceConfig?: Record<string, unknown>;
  transform?: SceneTransformConfig;
  refreshInterval?: number;
  action?: "set" | "update" | "append" | "highlight" | "hide" | "show" | "remove" | "navigate" | "custom";
}

export interface SceneVariable {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'date' | 'datetime';
  defaultValue: unknown;
  currentValue?: unknown;
  options?: Array<{ label: string; value: unknown }>;
  description?: string;
  scope?: 'scene' | 'global';
}

export interface SceneTransformConfig {
  type: "map" | "filter" | "aggregate" | "custom";
  expression?: string;
  function?: string;
}

export interface LayoutItem {
  componentId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  locked?: boolean;
}

export interface RuntimeState {
  sceneId: string;
  timestamp: string;
  values: Map<string, unknown>;
  status: "active" | "paused" | "error";
}

export interface SceneConfig {
  coordinateSystem: CRSType;
  bounds?: SpatialBoundingBox;
  camera?: CameraConfig;
}

export interface SceneEvent {
  type: "click" | "hover" | "select" | "update" | "move" | "zoom" | "measure";
  layerId: string;
  featureId?: string;
  data?: unknown;
  timestamp: string;
}

/** 目录结构画像视图态：随场景持久化，重载分析后恢复，不再回默认 */
export interface DirectoryViewState {
  sort: "size" | "name" | "path";
  search: string;
  showFiles: boolean;
}

export interface SceneDSL {
  id: string;
  name: string;
  description?: string;

  coordinateSystem: CRSType;
  camera: CameraConfig;
  bounds?: SpatialBoundingBox;

  layers: SceneLayer[];
  bindings: SceneBinding[];
  variables?: SceneVariable[];
  viewportSyncRules?: import("../editor/spatial/ViewportSyncService").ViewportSyncRule[];
  layout: LayoutItem[];

  globalComponents?: SceneComponent[];
  views?: SceneView[];
  activeViewId?: string;
  /** 目录结构画像视图态（排序/搜索/显隐文件），随场景落库，重载恢复 */
  directoryView?: DirectoryViewState;

  editorComponents?: SceneComponent[];
  editorLayers?: LayerNode[];
  canvasConfig?: import("../store/editorStore").CanvasConfig;

  categoryId?: string;
  tags: string[];
  thumbnail?: string;

  status: SceneStatus;
  publishedAt?: number;

  metadata: Record<string, unknown>;

  createdAt: number;
  updatedAt: number;
}

export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  preview?: string;
  defaults: Partial<SceneDSL>;
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: "blank",
    name: "空白分析",
    description: "从零开始创建分析",
    icon: "note_add",
    defaults: {},
  },
];

export function createDefaultSceneLayer(partial?: Partial<SceneLayer>): SceneLayer {
  return {
    id: `layer_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name: t("scene.newLayer"),
    type: "tile",
    dimension: "2d",
    source: {
      type: "tile",
      urlTemplate: "",
      minZoom: 0,
      maxZoom: 18,
    },
    visible: true,
    zIndex: 0,
    opacity: 1,
    ...partial,
  };
}

export function createDefaultScene(partial?: Partial<SceneDSL>): SceneDSL {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `scene_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name: t("scene.unnamedAnalysis"),
    coordinateSystem: "EPSG:3857",
    camera: {
      center: { x: 0, y: 0 },
      zoom: 1,
      bearing: 0,
      pitch: 0,
    },
    bindings: [],
    layout: [],
    tags: [],
    status: "draft",
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...partial,
    // 确保至少有一个默认图层（editorStore addComponent 要求）
    layers:
      partial?.layers && partial.layers.length > 0
        ? partial.layers
        : [createDefaultSceneLayer({ name: t("scene.defaultLayer"), zIndex: 0, metadata: { isDefault: "true" } })],
  };
}

export function createSceneFromTemplate(template: SceneTemplate, partial?: Partial<SceneDSL>): SceneDSL {
  return createDefaultScene({
    ...template.defaults,
    name: template.name,
    ...partial,
  });
}

// ============ 项目分析模型（Analysis，叠加扫描/审查字段）============

export type AnalysisStatus = SceneStatus;

export interface AnalysisCategory extends SceneCategory {}

export interface AnalysisView extends Omit<SceneView, "eventBindings"> {
  eventBindings?: any[];
}

export interface AnalyzerFields {
  /// 项目扫描根路径
  projectRoot: string;
  // 扫描状态字段
  scanStatus: "pending" | "scanning" | "ready" | "failed";
  scanProgress: number;
  lastScannedAt?: number;
  totalFiles: number;
  totalLines: number;
  primaryLanguage?: string;
}

export interface AnalysisDSL extends SceneDSL, AnalyzerFields {}

export interface AnalysisTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaults: Partial<AnalysisDSL>;
}

export const ANALYSIS_TEMPLATES: AnalysisTemplate[] = [
  {
    id: "blank",
    name: "空白分析",
    description: "从零开始创建项目分析",
    icon: "note_add",
    defaults: {},
  },
  {
    id: "scan-project",
    name: "扫描项目",
    description: "选择项目根目录并执行扫描",
    icon: "search",
    defaults: {
      tags: ["扫描"],
    },
  },
  {
    id: "review-existing",
    name: "审查现有",
    description: "对已有分析结果执行审查规则",
    icon: "rule",
    defaults: {
      tags: ["审查"],
    },
  },
];

export function createDefaultAnalysis(partial?: Partial<AnalysisDSL>): AnalysisDSL {
  const now = Math.floor(Date.now() / 1000);
  const base = createDefaultScene();
  return {
    ...base,
    projectRoot: "",
    tags: base.tags,
    status: "draft",
    metadata: base.metadata,
    scanStatus: "pending",
    scanProgress: 0,
    totalFiles: 0,
    totalLines: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function createAnalysisFromTemplate(template: AnalysisTemplate, partial?: Partial<AnalysisDSL>): AnalysisDSL {
  return createDefaultAnalysis({
    ...template.defaults,
    name: template.name,
    ...partial,
  });
}
