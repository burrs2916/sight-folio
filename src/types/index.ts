// project-sight: 统一类型导出
export type {
  AnalysisDSL,
  AnalysisStatus,
  AnalysisCategory,
  AnalysisView,
  AnalysisTemplate,
} from "./scene";

export {
  ANALYSIS_TEMPLATES,
  createDefaultAnalysis,
  createAnalysisFromTemplate,
} from "./scene";

export type {
  ComponentCapabilities,
  Point,
  Size,
  Transform,
  ComponentRendererProps,
  RendererLoader,
  RendererDescriptor,
  SceneComponent,
  ComponentDefinition,
  ConfigField,
  LayerNode,
  ViewportState,
  SelectionState,
  HistoryEntry,
  EventDefinition,
  ActionDefinition,
  DataSchema,
  CanvasBackground,
} from "./editor";

export {
  createDefaultTransform,
  createDefaultAnalysisComponent,
  createDefaultLayer,
  flattenLayerTree,
  getLayerDescendants,
} from "./editor";
