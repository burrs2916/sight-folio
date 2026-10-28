import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import logger from '../utils/logger';
import { t } from '../i18n';
import type {
  SceneComponent,
  LayerNode,
  ViewportState,
  SelectionState,
  HistoryEntry,
  Point,
  Transform,
  CanvasBackground,
} from '../types/editor';
import { createDefaultAnalysisComponent, createDefaultLayer, getLayerDescendants } from '../types/editor';
import { componentRegistry } from '../editor/registry';
// type-only：writingProofread 不依赖 store（仅 services/tauri + proofreadEngine + utils），
// 此处只取三个浏览态类型，避免任何循环依赖
import type { ProofreadGroup, ProofreadSeverityFilter, ProofreadSortMode } from '../utils/writingProofread';
// type-only：引擎级逐条命中随正文定位请求携带（正文容器「章内逐条闭环」面板用），无运行时耦合
import type { ProofreadIssue } from '../editor/proofread/proofreadEngine';

interface DirtyState {
  isDirty: boolean;
  markDirty: () => void;
  markClean: () => void;
}

export const useDirtyStore = create<DirtyState>()((set) => ({
  isDirty: false,
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),
}));

export type EditorTool = 'select' | 'pan' | 'zoom-in' | 'zoom-out';

export type AdaptationType = 'scale' | 'full-x' | 'full-y' | 'full-screen' | 'none';
export type CanvasOrientation = 'landscape' | 'portrait';

export interface CanvasGridConfig {
  visible: boolean;
  size: number;
  snapToGrid: boolean;
  dragStep: number;
  resizeStep: number;
  minorColor: string;
  majorColor: string;
  opacity: number;
  brightness: number;
}

export interface CanvasRulerConfig {
  visible: boolean;
}

export type GuideLineStyle = 'solid' | 'dashed' | 'dotted';

export type GuideLinePreset = 'center' | 'edges' | 'center-edges' | 'custom';

export interface CanvasGuideConfig {
  visible: boolean;
  color: string;
  opacity: number;
  lineWidth: number;
  lineStyle: GuideLineStyle;
  preset: GuideLinePreset;
  customVertical: number[];
  customHorizontal: number[];
  snapToGuide: boolean;
  snapToElement: boolean;
  snapThreshold: number;
  draggable: boolean;
  showLabel: boolean;
}

export interface CanvasConfig {
  width: number;
  height: number;
  orientation: CanvasOrientation;
  adaptationType: AdaptationType;
  lockAspectRatio: boolean;
  background: CanvasBackground;
  grid: CanvasGridConfig;
  ruler: CanvasRulerConfig;
  guide: CanvasGuideConfig;
  viewport: {
    minScale: number;
    maxScale: number;
    zoomStep: number;
  };
}

export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  width: 1920,
  height: 1080,
  orientation: 'landscape',
  adaptationType: 'scale',
  lockAspectRatio: false,
  background: {
    type: 'solid',
    color: '#ffffff',
    gradient: {
      direction: 'to-bottom',
      colors: ['#1a1a2e', '#16213e'],
    },
    imageUrl: '',
    imageFit: 'cover',
    videoUrl: '',
    videoAutoplay: false,
    videoMuted: true,
    videoLoop: true,
  },
  grid: {
    visible: true,
    size: 20,
    snapToGrid: false,
    dragStep: 1,
    resizeStep: 1,
    minorColor: '',
    majorColor: '',
    opacity: 1,
    brightness: 1,
  },
  ruler: {
    visible: true,
  },
  guide: {
    visible: true,
    color: '#ff3b30',
    opacity: 0.6,
    lineWidth: 1,
    lineStyle: 'dashed',
    preset: 'center',
    customVertical: [],
    customHorizontal: [],
    snapToGuide: true,
    snapToElement: true,
    snapThreshold: 5,
    draggable: false,
    showLabel: false,
  },
  viewport: {
    minScale: 0.1,
    maxScale: 5,
    zoomStep: 0.15,
  },
};

/**
 * 视角模板应用选项（需求文档 §4.5 ViewTemplate → 新建视图）。
 * 由分析器插件的 ViewTemplateRegistration 映射而来：
 *   defaultLayers（图层名/颜色）→ 新视图的 LayerNode[]（首层为默认层）
 *   layout（缩放/平移/网格）→ viewport.scale/offset + canvasConfig.grid.visible
 */
export interface ViewTemplateOptions {
  /** 模板默认图层（LayerDef → LayerNode），空/缺省时回退为"默认图层" */
  layers?: { name: string; color?: string }[];
  /** 模板画布布局预设（缩放、平移、网格） */
  layout?: { scale?: number; panX?: number; panY?: number; grid?: boolean };
  /**
   * 写作嵌套 Tab（G2）元信息：题材分组 + 类型化单例标记。
   * 只加不改：缺省时两个字段均不写入（undefined），旧调用零影响。
   */
  meta?: {
    carrierType?: string;
    kind?:
      | 'catalog'
      | 'characters'
      | 'worldview'
      | 'timeline'
      | 'storylines'
      | 'foreshadowing'
      | 'inspiration'
      | 'proofread'
      | 'stats'
      | 'writing'
      | 'overview';
  };
}

/**
 * 批量添加实体的输入描述（同步到画布 / 画像重建专用）。
 *
 * 为什么需要批量：此前「同步到画布」对每个文件单独调一次 addComponent，
 * 而 addComponent 内部每次都 pushHistory → structuredClone(全部组件数组)，
 * 500 个文件就是 O(N²) 次深拷贝，正是「同步卡死/卡顿」的根因。
 * 批量入口把这些合并成 一次 store 更新 + 一条历史记录。
 */
export interface BulkComponentInput {
  type: string;
  name: string;
  config?: Record<string, unknown>;
  x: number;
  y: number;
  width?: number;
  height?: number;
  layerId?: string;
  /**
   * 锁定实体：禁用拖动/缩放（仍可选中查看）。目录结构画像的实体是「观察结果」
   * 而非自由画布对象，默认视图下不允许用户把它们拖乱 ——「默认编辑页面实体不准拖动」。
   * 单条传 true 即可，无需整批统一。
   */
  locked?: boolean;
}

export interface EditorState {
  components: SceneComponent[];
  layers: LayerNode[];
  viewport: ViewportState;
  selection: SelectionState;
  /**
   * sight-folio 写作台：人物/世界观设定项的右栏选中态。
   * 与画布选择（selection.selectedIds）解耦——人物设定不走画布卡实体，
   * 而是由 CastPane 的「查看要素」按钮显式驱动；二者互斥（画布选中即清空本项）。
   */
  selectedSettingId: string | null;
  /**
   * sight-folio 写作台：时间线事件的右栏选中态。
   * 与画布选择（selection.selectedIds）及全部右栏选中态（selectedSettingId / selectedStorylineId /
   * selectedForeshadowingId / selectedInspirationId / selectedChapterId）六者互斥——
   * 任一被显式选中即清空其余五项，保证右栏只聚焦一个编辑目标。
   */
  selectedTimelineEventId: string | null;
  /** 选中剧情线（多线叙事实体）：与事件/设定/伏笔/灵感/大纲/画布选中互斥，右栏详情 tab 编辑线实体 */
  selectedStorylineId: string | null;
  /** 选中伏笔（「埋设 → 回收」承诺）：与事件/设定/剧情线/灵感/大纲/画布选中互斥，右栏详情 tab 编辑伏笔 */
  selectedForeshadowingId: string | null;
  /** 选中灵感念头（未落章 beat）：与事件/设定/剧情线/伏笔/大纲/画布选中互斥，右栏详情 tab 编辑分发 */
  selectedInspirationId: string | null;
  /** 大纲选中章（书场景大纲视图 StorylinePane 点章行锚点）：与画布/设定/事件/剧情线/伏笔/灵感
   * 六者互斥 —— 点章行 → 右栏「详情」tab 展示该章详情卡（封面可设/换/清除 + 章信息）。 */
  selectedChapterId: string | null;
  /** 校对定位请求（章检视器→校对页签联动）：非空表示外部请求打开校对页签并高亮该发现行；
   * 值 = ProofreadIssue.key（如 "ch1:TypoPhrase"），由 ProofreadPane 消费后由消费方清空（无互斥语义）。 */
  proofreadFocusKey: string | null;
  /** 设置校对定位请求（章检视器点击发现行时调用）；null = 清除。 */
  setProofreadFocusKey: (key: string | null) => void;
  /** 统计定位请求（章检视器→统计页签联动）：非空表示外部请求打开统计页签并滚动定位到该章体量行；
   * 值 = chapter.id，由 StatsPane 消费后由消费方清空。 */
  statsFocusChapterId: string | null;
  /** 设置统计定位请求（章检视器点击统计区时调用）；null = 清除。 */
  setStatsFocusChapterId: (id: string | null) => void;
  /** T3 校对行→正文定位请求（校对页签→正文容器联动）：非空表示校对页签点章行请求打开正文容器
   * 并滚动高亮到该文本片段（聚合行定位口径 = 章内首个命中片段，粗定位）；
   * textHits = 该章引擎级逐条命中（聚合行携带，正文容器据此展开「章内逐条闭环」面板）；
   * 由 WritingDocsRenderer 转发给章编辑器，编辑器定位完成后消费清空。 */
  proofreadJumpAnchor: { chapterId: string; anchor: string; textHits?: ProofreadIssue[] } | null;
  /** 设置/清除校对行→正文定位请求。 */
  setProofreadJumpAnchor: (anchor: { chapterId: string; anchor: string; textHits?: ProofreadIssue[] } | null) => void;
  /** T3 返回校对上下文（正文容器→校对页签回迁）：非空表示当前正文容器视图是从校对页签跳转而来；
   * 值 = 校对页签离开时的 组筛选/严重性过滤/排序/列表滚动位置，供「返回校对」入口切回后恢复；由 ProofreadPane 消费清空。 */
  proofreadReturnCtx: {
    group: ProofreadGroup;
    sev: ProofreadSeverityFilter;
    sort: ProofreadSortMode;
    scrollTop: number;
  } | null;
  /** 设置/清除返回校对上下文。 */
  setProofreadReturnCtx: (
    ctx: {
      group: ProofreadGroup;
      sev: ProofreadSeverityFilter;
      sort: ProofreadSortMode;
      scrollTop: number;
    } | null,
  ) => void;
  /**
   * sight-folio 写作台：时间线 pane 的子视图口径（book=全书轴按设定分轨 / chapter=按章轴分轨）。
   * 放 store 而非 pane 本地 state：右栏总览卡的冲突行点选时需要切换口径
   * （跨章倒挂只在按章轴可见），主 pane 与右栏必须共享同一份。
   */
  timelineViewMode: 'book' | 'chapter' | 'storyline';
  /** v2.14 目录树符号展开的文件 id 集合（代码结构画像：双击文件展开/收起符号） */
  expandedSymFiles: Set<string>;
  activeTool: EditorTool;
  /** v2.17 依赖画像布局模式：force=力导向聚簇 / layered=拓扑分层（入口→底座） */
  depLayoutMode: 'force' | 'layered';
  /** v2.17 依赖画像筛选镜：all=不过滤 / cycles=只看循环依赖 / crossModule=只看跨模块边 */
  depFilter: 'all' | 'cycles' | 'crossModule';
  /** v2.17 依赖画像焦点文件：非空=树驱动焦点子图模式（以该文件为焦点重绘 1 跳依赖网），null=全局总览（top-90） */
  depFocusFileId: string | null;
  /**
   * v2.18 变更耦合筛选镜（前端切片，对标 depFilter 形态；不影响布局）
   * - all        ：全部共变对（含 hidden / structural / 跨模块 / 同模块）
   * - hidden     ：仅无静态依赖却总一起改的隐性耦合
   * - highRisk   ：riskLevel 为 high / extreme 的对（最该处理的）
   * - crossModule：跨顶层模块的对（架构边界被绕过）
   */
  couplingFilter: 'all' | 'hidden' | 'highRisk' | 'crossModule';
  /**
   * v2.18 变更耦合时间窗（天）。
   * - null = 全量（与后端默认一致）
   * - 切换时触发 `analyze_change_coupling(sinceDays)` 真重扫并落库，
   *   因此本字段是会话级（与 dep 系列同 store，但语义是「重扫窗口」而不是视图切片）。
   *   历史语义靠 DB 落库真值保证，不靠前端切片伪造。
   */
  couplingWindowDays: number | null;
  /**
   * v2.18 变更耦合焦点文件：与 depFocusFileId 对标——非空=树驱动焦点子图模式
   * （以该文件为中心取其全部 couplingPartner 1-跳邻居图，不含伙伴间横向边）。
   * 本字段由本轮 B1 提前把 state 位占好，B3 详细实施消费侧。
   */
  couplingFocusFileId: string | null;
  /**
   * v2.28 重构四象限聚焦象限：非空=用户点击了画布上的象限区域标签（layer-marker），
   * 该象限文件集合高亮、其余淡化（复用 relatedFileIds 淡化机制），回答「先重构谁」。
   * 再次点击同一象限或点「象限复位」即清空回全局视图。
   */
  quadrantFocusZone: 'refactorFirst' | 'legacyStable' | 'activeSimple' | 'healthy' | null;
  /**
   * v2.18 变更耦合布局模式（与 depLayoutMode 同形态，但语义对齐「时间维度耦合」）：
   * - force   ：力导向自然聚团（耦合伙伴数做 weight）—— 默认，与现状一致
   * - cluster ：按顶层目录硬分区（topDirOf）+ 模块簇染色（MODULE_PALETTE），
   *             让"命运共同体"的真实模块边界视觉化；跨模块边额外加粗
   */
  couplingLayoutMode: 'force' | 'cluster';
  activeLayerId: string | null;
  /** 当前正在被拖动的实体类型（保留接口兼容） */
  draggedComponentType: string | null;
  canvasConfig: CanvasConfig;
  containerSize: { width: number; height: number };
  history: HistoryEntry[];
  historyIndex: number;
  maxHistory: number;
  clipboard: SceneComponent[];
  eventBindings: any[];
  previewMode: boolean;
  views: import('../types/scene').AnalysisView[];
  activeViewId: string;
  globalComponents: SceneComponent[];
  /** 左侧面板/文件树发起的画布定位请求（{ id, ts }），画布监听到后居中该组件 */
  focusRequest: { id: string; ts: number } | null;
  /**
   * 工作台编辑器内联审查发现标记点击后，请求「审查结果」面板聚焦并高亮某条发现。
   * 与 focusRequest 同款瞬时请求模式：只递增值、不承载业务数据，ReviewFindingsPanel 监听后
   * 展开对应严重度分组、滚动卡片入视并闪高亮，把编辑器内联标记与侧栏审查面板打通。
   */
  reviewFindingFocus: { id: string; ts: number } | null;
  /**
   * 审查发现「严重度筛选 + 内联标记总开关」，单一事实来源。
   * 同时驱动「审查结果」面板列表（severities 为空=全部）与工作台编辑器内联标记
   * （WorkbenchEditorPane 据此同口径过滤；showInline=false 时编辑器不渲染任何内联标记）。
   * 把面板原先的局部 filterSeverity 上提到 store，打通「侧栏/面板筛选 ⇄ 编辑器内联」双向联动
   * （对标 Zed crates/diagnostics 的 severity 过滤，并做差异化增强：联动内联标记 + 总开关降噪）。
   */
  reviewFindingFilter: { severities: string[]; showInline: boolean };
  /**
   * 从画布徽标 / 审查卡片 / 右键菜单发起「AI 诊断」后，请求编辑器右侧栏切到
   * AI Agent 面板（tab 5）。与 focusRequest 同款瞬时请求模式：只递增值、不承载
   * 业务数据，SceneEditor 监听它去 setRightTab(5)。
   */
  aiPanelRequest: number;
  /**
   * 「适应视口」请求：同步到画布/画像重建后由页面发起，画布自动缩放到内容全览。
   * `ids` 可选 —— 带 ids 时只适配这批实体（R32：左侧面板搜索命中 → 画布聚焦命中集合），
   * 不带则适配全部实体（原「一键俯瞰」行为，向后兼容）。
   */
  fitRequest: { ts: number; ids?: string[] } | null;
  /**
   * 画布整体载入序号：loadSceneWithViews / clearScene / switchView 每次自增。
   * ProjectCanvas 监听它来应用持久化视口（或内容全览 fit）——
   * 此前 draft.viewport 载入后无人消费，画布永远停在 scale=1 左上角。
   */
  viewportLoadSeq: number;
  /** 目录树视图是否显示文件叶子（双击下钻的子树视图始终显示文件，不依赖此项） */
  directoryShowFiles: boolean;
  /** 目录树视图搜索关键词（空=不过滤） */
  directorySearch: string;
  /** 目录树视图排序方式：size=规模 / name=名称 / path=路径 */
  directorySort: 'size' | 'name' | 'path';
  /**
   * 图片详情弹窗状态（画布双击 / 目录树双击 / 画像面板「查看大图」共享触发）。
   * 此前该状态只活在 SceneEditor 局部，目录树与画像面板无法复用同一个弹窗；
   * 提到 store 后三处统一调 openImagePreview，弹窗在 SceneEditor 单例渲染，零重复。
   */
  imagePreview: import('../editor/panels/ImagePreviewDialog').ImagePreviewData | null;
}

export interface EditorActions {
  addComponent: (type: string, layerId?: string, position?: Partial<Point>) => SceneComponent | null;
  /** 批量添加实体：一次 store 更新 + 一条历史，避免 O(N²) 深拷贝卡顿（同步到画布/画像重建） */
  addComponentsBulk: (items: BulkComponentInput[]) => string[];
  /** 批量覆写实体 name/config/尺寸：一次 store 更新，不进历史（画像数据海量） */
  updateComponentsConfig: (
    entries: { id: string; name?: string; config?: Record<string, unknown>; width?: number; height?: number }[],
  ) => void;
  removeComponent: (id: string) => void;
  /**
   * 批量移除实体：一次 store 更新 + 一条历史。
   * 逐个 removeComponent 会对每个 id 做一次 pushHistory 深拷贝（O(N²)），
   * 折叠模块子图动辄几十上百个实体，必须走批量。
   */
  removeComponentsBulk: (ids: readonly string[]) => number;
  updateComponent: (id: string, updates: Partial<SceneComponent>) => void;
  updateComponentTransform: (id: string, transform: Partial<Transform>) => void;
  updateComponentConfig: (id: string, config: Record<string, unknown>) => void;
  /** P3 业务→画布回流：按业务 id（chapterId/settingId）反查所有视图中的写作卡，回写名称/配置。
   *  面向业务层自动保存调用：不推历史（自动行为不该刷爆撤销栈）、跨全部视图匹配，只 markDirty。 */
  syncWritingEntityCards: (
    bizKey: 'chapterId' | 'settingId',
    bizId: string,
    patch: { name?: string; configPatch?: Record<string, unknown> },
  ) => void;
  batchUpdateComponent: (
    id: string,
    updates: { config?: Record<string, unknown>; transform?: Partial<Transform> },
  ) => void;
  moveComponentToLayer: (id: string, layerId: string) => void;
  reorderComponent: (id: string, zIndex: number) => void;
  duplicateComponent: (id: string) => SceneComponent | null;
  getComponentsByLayer: (layerId: string) => SceneComponent[];
  getComponent: (id: string) => SceneComponent | undefined;

  addLayer: (name?: string, parentId?: string | null) => LayerNode;
  addLayerGroup: (name?: string, parentId?: string | null) => LayerNode;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<LayerNode>) => void;
  moveLayerToParent: (id: string, parentId: string | null, order?: number) => void;
  reorderLayer: (id: string, order: number) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  toggleLayerExpanded: (id: string) => void;
  getLayer: (id: string) => LayerNode | undefined;
  getRootLayers: () => LayerNode[];
  getLayerTree: () => LayerNode[];

  // 事件绑定（sight-folio 暂未启用，预留接口）
  addEventBinding: (binding: any) => void;
  removeEventBinding: (id: string) => void;
  updateEventBinding: (id: string, updates: any) => void;

  selectComponent: (id: string, multi?: boolean) => void;
  deselectAll: () => void;
  selectAll: () => void;
  setHoveredComponent: (id: string | null) => void;
  getSelectedComponents: () => SceneComponent[];
  /** sight-folio 写作台：显式驱动右栏选中某个写作设定项（人物/世界观）；null=取消 */
  selectSetting: (id: string | null) => void;
  /** sight-folio 写作台：显式驱动右栏选中某个时间线事件进行编辑；null=取消 */
  selectTimelineEvent: (id: string | null) => void;
  /** 选中剧情线（右栏详情编辑线实体）；null = 清除 */
  selectStoryline: (id: string | null) => void;
  /** 选中伏笔（右栏详情编辑伏笔）；null = 清除 */
  selectForeshadowing: (id: string | null) => void;
  /** 选中灵感念头（右栏详情编辑分发）；null = 清除 */
  selectInspiration: (id: string | null) => void;
  /** 选中大纲章（书场景大纲视图点章行锚点，右栏详情卡展示）；null = 清除 */
  selectChapter: (id: string | null) => void;
  /** sight-folio 写作台：切换时间线 pane 的子视图口径（book=全书轴 / chapter=按章轴 / storyline=按剧情线）；主 pane 与右栏总览共享 */
  setTimelineViewMode: (mode: 'book' | 'chapter' | 'storyline') => void;

  setViewport: (viewport: Partial<ViewportState>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  resetViewport: (containerWidth?: number, containerHeight?: number) => void;
  setContainerSize: (width: number, height: number) => void;
  panTo: (x: number, y: number) => void;

  setActiveTool: (tool: EditorTool) => void;
  setDraggedComponentType: (type: string | null) => void;
  setActiveLayer: (layerId: string | null) => void;
  setCanvasConfig: (updates: Partial<CanvasConfig>) => void;
  setCanvasSize: (width: number, height: number) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushHistory: (type: HistoryEntry['type']) => void;
  /** 批量挂起：期间 addComponent/addComponentsBulk 不逐条记历史，endBatch 统一提交一条（根治 O(N²) 克隆卡死） */
  beginBatch: () => void;
  endBatch: () => void;

  copySelected: () => void;
  pasteClipboard: () => void;

  loadScene: (components: SceneComponent[], layers: LayerNode[]) => void;
  loadSceneWithViews: (
    views: import('../types/scene').AnalysisView[],
    globalComponents: SceneComponent[],
    activeViewId: string,
  ) => void;
  exportScene: () => { components: SceneComponent[]; layers: LayerNode[] };
  exportSceneWithViews: () => {
    views: import('../types/scene').AnalysisView[];
    globalComponents: SceneComponent[];
    activeViewId: string;
  };
  clearScene: () => void;
  setPreviewMode: (preview: boolean) => void;

  addView: (name: string, template?: ViewTemplateOptions) => string;
  removeView: (viewId: string, opts?: { allowEmpty?: boolean }) => void;
  switchView: (viewId: string) => void;
  /**
   * 确保「结构/default 视图」存在并返回其 id。
   * 「同步到画布」始终把项目结构树画进这个固定视图，绝不误清用户正在看的画像视图；
   * 若该视图已被用户删除，则按初始结构重建（id 固定为 default，保证幂等）。
   */
  ensureStructureView: () => string;
  renameView: (viewId: string, name: string) => void;
  getActiveView: () => import('../types/scene').AnalysisView | undefined;
  /** 定位到画布中的某个组件：选中 + 发出居中请求（供左侧面板/文件树联动） */
  focusComponent: (id: string) => void;
  /** 请求「审查结果」面板聚焦并高亮某条审查发现（供编辑器内联标记点击联动） */
  focusReviewFinding: (id: string) => void;
  /** 设置审查发现严重度筛选（空数组=显示全部），同时驱动面板列表与编辑器内联标记 */
  setFindingSeverities: (severities: string[]) => void;
  /** 设置是否在工作台编辑器内渲染内联审查标记（总开关，降噪用） */
  setFindingShowInline: (show: boolean) => void;
  /** 请求编辑器右侧栏切到 AI Agent 面板（供「从分析点发起 AI 诊断」联动） */
  requestAiPanel: () => void;
  /**
   * 批量选中实体（一次 store 更新）。
   * 供「搜索命中 → 画布高亮 N 项」使用：循环调用 selectComponent 会产生 N 次
   * immer 深拷贝，几百条时明显掉帧，这里一次写入。
   */
  selectComponents: (ids: string[]) => void;
  /**
   * 画布「适应视口」：同步到画布/画像重建后调用，画布自动缩放平移至内容全览。
   * 传 ids 则只适配这批实体（搜索命中聚焦）。
   */
  requestFit: (ids?: string[]) => void;
  /** v2.17 设置依赖画像布局模式（会话态，重跑依赖画像生效） */
  setDepLayoutMode: (mode: 'force' | 'layered') => void;
  /** v2.17 设置依赖画像筛选镜（会话态，仅影响画布淡化，不重排布局） */
  setDepFilter: (f: 'all' | 'cycles' | 'crossModule') => void;
  /** v2.17 设置依赖画像焦点文件（会话态，非空=焦点子图模式，重跑依赖画像生效） */
  setDepFocusFileId: (id: string | null) => void;
  /** v2.18 设置变更耦合筛选镜（会话态，仅前端切片） */
  setCouplingFilter: (f: 'all' | 'hidden' | 'highRisk' | 'crossModule') => void;
  /** v2.18 设置变更耦合时间窗（会话态，UI 切时窗会触发后端真重扫） */
  setCouplingWindowDays: (d: number | null) => void;
  /** v2.18 设置变更耦合焦点文件（会话态，B3 焦点子图消费） */
  setCouplingFocusFileId: (id: string | null) => void;
  /** v2.28 设置重构四象限聚焦象限（会话态，象限区域标签单击消费） */
  setQuadrantFocusZone: (zone: 'refactorFirst' | 'legacyStable' | 'activeSimple' | 'healthy' | null) => void;
  /** v2.18 设置变更耦合布局模式（force=力导向 / cluster=按模块硬分区+模块簇染色） */
  setCouplingLayoutMode: (mode: 'force' | 'cluster') => void;
  /** v2.14 展开/收起某文件的符号卡（目录树符号展开） */
  toggleSymbolFile: (fileId: string) => void;
  /** 切换目录树是否显示文件叶子 */
  setDirectoryShowFiles: (v: boolean) => void;
  /** 设置目录树搜索关键词 */
  setDirectorySearch: (v: string) => void;
  /** 设置目录树排序方式 */
  setDirectorySort: (v: 'size' | 'name' | 'path') => void;
  /** 打开图片详情弹窗（data 内含 absPath 等；画布/目录树/画像面板共用） */
  openImagePreview: (data: import('../editor/panels/ImagePreviewDialog').ImagePreviewData) => void;
  /** 关闭图片详情弹窗 */
  closeImagePreview: () => void;
}

const DEFAULT_VIEWPORT: ViewportState = {
  scale: 1,
  offset: { x: 0, y: 0 },
};

function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

let _configHistoryTimer: ReturnType<typeof setTimeout> | null = null;
let _transformHistoryTimer: ReturnType<typeof setTimeout> | null = null;
const TRANSFORM_HISTORY_DELAY = 400;
/** focusRequest.ts 自增计数器（保证严格单调递增） */
let _focusSeq = 0;
/** fitRequest.ts 自增计数器（与 focusRequest 同理） */
let _fitSeq = 0;

// 批量操作历史挂起：期间 addComponent/addComponentsBulk 不逐条克隆 components，endBatch 统一提交一条快照
let _batchDepth = 0;
let _batchBeforeComponents: SceneComponent[] | null = null;
let _batchBeforeLayers: LayerNode[] | null = null;
let _batchBeforeCanvas: CanvasConfig | null = null;

export type EditorStore = EditorState & EditorActions;

export const useEditorStore = create<EditorStore>()(
  immer((set, get) => ({
    components: [] as SceneComponent[],
    layers: [] as LayerNode[],
    viewport: { ...DEFAULT_VIEWPORT },
    selection: { selectedIds: [] as string[], hoveredId: null as string | null, isMultiSelect: false },
    selectedSettingId: null as string | null,
    // 时间线事件右栏选中态（与 selectedSettingId、画布选择三者互斥）
    selectedTimelineEventId: null as string | null,
    selectedStorylineId: null as string | null,
    selectedForeshadowingId: null as string | null,
    selectedInspirationId: null as string | null,
    selectedChapterId: null as string | null,
    proofreadFocusKey: null as string | null,
    statsFocusChapterId: null as string | null,
    proofreadJumpAnchor: null as { chapterId: string; anchor: string; textHits?: ProofreadIssue[] } | null,
    proofreadReturnCtx: null as {
      group: ProofreadGroup;
      sev: ProofreadSeverityFilter;
      sort: ProofreadSortMode;
      scrollTop: number;
    } | null,
    // 时间线 pane 子视图口径（主 pane 与右栏总览共享，默认全书轴）
    timelineViewMode: 'book' as 'book' | 'chapter' | 'storyline',
    // v2.14 目录树符号展开：双击文件展开/收起其符号卡（代码结构画像）
    expandedSymFiles: new Set<string>(),
    activeTool: 'select' as EditorTool,
    // v2.17 依赖画像布局模式（默认力导向聚簇，分层模式可在工具条切换）
    depLayoutMode: 'force' as 'force' | 'layered',
    // v2.17 依赖画像筛选镜（默认不过滤；切换即生效，不改布局）
    depFilter: 'all' as 'all' | 'cycles' | 'crossModule',
    // v2.17 依赖画像焦点文件（默认 null=全局总览；树点文件→焦点子图）
    depFocusFileId: null as string | null,
    // v2.18 变更耦合三件套：filter/windowDays/focusFileId（与 dep 三件套同位置同形态）
    couplingFilter: 'all' as 'all' | 'hidden' | 'highRisk' | 'crossModule',
    couplingWindowDays: null as number | null,
    couplingFocusFileId: null as string | null,
    couplingLayoutMode: 'force' as 'force' | 'cluster',
    // v2.28 重构四象限聚焦象限（null=全局视图）
    quadrantFocusZone: null as 'refactorFirst' | 'legacyStable' | 'activeSimple' | 'healthy' | null,
    activeLayerId: null as string | null,
    draggedComponentType: null as string | null,
    canvasConfig: { ...DEFAULT_CANVAS_CONFIG },
    containerSize: { width: 0, height: 0 },
    history: [] as HistoryEntry[],
    historyIndex: -1,
    maxHistory: 50,
    clipboard: [] as SceneComponent[],
    eventBindings: [] as any[],
    previewMode: false,
    views: [
      {
        id: 'default',
        name: 'viewTab.defaultView',
        components: [],
        layers: [],
        canvasConfig: deepClone(DEFAULT_CANVAS_CONFIG),
        viewport: deepClone(DEFAULT_VIEWPORT),
        eventBindings: [],
      },
    ],
    activeViewId: 'default',
    globalComponents: [],
    focusRequest: null,
    reviewFindingFocus: null,
    reviewFindingFilter: { severities: [], showInline: true },
    aiPanelRequest: 0,
    fitRequest: null,
    viewportLoadSeq: 0,
    directoryShowFiles: false,
    directorySearch: '',
    directorySort: 'size',
    imagePreview: null,

    addComponent: (type, layerId, position) => {
      const definition = componentRegistry.get(type);
      if (!definition) {
        // 不再静默丢弃：未注册类型直接告警（对齐 biosphere「未知组件可见」契约），
        // 此前这是符号实体/新类型写入后画布空白却无任何日志的根因之一。
        logger.warn('EditorStore', 'addComponent skipped: type NOT registered', {
          type,
          registeredTypes: componentRegistry.getAll().map((d) => d.type),
        });
        return null;
      }

      const state = get();
      let targetLayerId: string | undefined = layerId;

      if (!targetLayerId) {
        targetLayerId = state.activeLayerId || undefined;
      }

      if (targetLayerId) {
        const targetLayer = state.layers.find((l) => l.id === targetLayerId);
        if (targetLayer?.type === 'group') {
          const firstChildLayer = state.layers.find((l) => l.type === 'layer' && l.parentId === targetLayerId);
          if (firstChildLayer) {
            targetLayerId = firstChildLayer.id;
          } else {
            targetLayerId = state.layers.find((l) => l.type === 'layer')?.id;
          }
        }
      }

      if (!targetLayerId && state.layers.length > 0) {
        targetLayerId = state.layers.find((l) => l.type === 'layer')?.id;
      }

      // 绝不静默：无图层 return null 曾是「拖入创建没反应」的静默失败点之一
      //（对比 addComponentsBulk :577 有自动补层兜底，这里先补告警，兜底后续对齐）
      if (!targetLayerId) {
        logger.warn('EditorStore', 'addComponent skipped: no layer available', { type });
        return null;
      }

      const component = createDefaultAnalysisComponent(definition, targetLayerId, position);

      get().pushHistory('add');

      set((draft: EditorState) => {
        const maxZ = draft.components
          .filter((c: SceneComponent) => c.layerId === targetLayerId)
          .reduce((max: number, c: SceneComponent) => Math.max(max, c.zIndex), 0);
        component.zIndex = maxZ + 1;
        draft.components.push(component);
        draft.selection.selectedIds = [component.id];
        useDirtyStore.getState().markDirty();
      });

      return component;
    },

    addComponentsBulk: (items) => {
      const state = get();
      let targetLayerId = state.activeLayerId || undefined;
      if (!targetLayerId && state.layers.length > 0) {
        targetLayerId = state.layers.find((l) => l.type === 'layer')?.id;
      }
      // 兜底：无图层时自动补一个默认图层，而不是静默失败 ——
      // 「同步到画布」曾因此返回空数组但页面仍提示成功（画布空白），是用户反馈的根因之一。
      if (!targetLayerId) {
        const fallbackLayer = createDefaultLayer('viewTab.defaultLayer', 'layer', null, true);
        set((draft: EditorState) => {
          draft.layers = [fallbackLayer];
          draft.activeLayerId = fallbackLayer.id;
        });
        targetLayerId = fallbackLayer.id;
      }

      const ids: string[] = [];
      const created: SceneComponent[] = [];
      const skippedTypes = new Map<string, number>();
      for (const item of items) {
        const definition = componentRegistry.get(item.type);
        if (!definition) {
          // 不再静默丢弃：聚合记录，循环结束后一次性告警
          skippedTypes.set(item.type, (skippedTypes.get(item.type) ?? 0) + 1);
          continue;
        }
        const layerId = item.layerId || targetLayerId;
        const comp = createDefaultAnalysisComponent(definition, layerId as string, { x: item.x, y: item.y });
        if (item.width !== undefined) comp.transform.width = item.width;
        if (item.height !== undefined) comp.transform.height = item.height;
        if (item.name) comp.name = item.name;
        if (item.config) comp.config = { ...comp.config, ...item.config };
        if (item.locked) comp.locked = true;
        ids.push(comp.id);
        created.push(comp);
      }
      if (skippedTypes.size > 0) {
        logger.warn('EditorStore', 'addComponentsBulk skipped unregistered types', {
          skipped: Object.fromEntries(skippedTypes),
          createdCount: created.length,
          registeredTypes: componentRegistry.getAll().map((d) => d.type),
        });
      }
      if (created.length === 0) return ids;

      // 批量操作只记一条历史（快照发生在 set 之前，数组尚小，无 O(N²)）
      get().pushHistory('add');
      set((draft: EditorState) => {
        const maxZ = draft.components.reduce((max, c) => Math.max(max, c.zIndex), 0);
        created.forEach((c, i) => {
          c.zIndex = maxZ + i + 1;
        });
        draft.components.push(...created);
        draft.selection.selectedIds = [];
        useDirtyStore.getState().markDirty();
      });
      return ids;
    },

    updateComponentsConfig: (entries) => {
      if (entries.length === 0) return;
      set((draft: EditorState) => {
        const byId = new Map(entries.map((e) => [e.id, e]));
        for (const c of draft.components) {
          const e = byId.get(c.id);
          if (!e) continue;
          if (e.name !== undefined) c.name = e.name;
          if (e.config) c.config = { ...c.config, ...e.config };
          if (e.width !== undefined) c.transform.width = e.width;
          if (e.height !== undefined) c.transform.height = e.height;
        }
        useDirtyStore.getState().markDirty();
      });
      // 批量画像数据不进历史：逐实体快照无意义，且会再次放大克隆开销
    },

    removeComponent: (id) => {
      get().pushHistory('delete');
      set((draft: EditorState) => {
        draft.components = draft.components.filter((c: SceneComponent) => c.id !== id);
        draft.selection.selectedIds = draft.selection.selectedIds.filter((sid: string) => sid !== id);
        useDirtyStore.getState().markDirty();
      });
    },

    removeComponentsBulk: (ids) => {
      if (ids.length === 0) return 0;
      const idSet = new Set(ids);
      const before = get().components.length;
      get().pushHistory('delete');
      set((draft: EditorState) => {
        draft.components = draft.components.filter((c: SceneComponent) => !idSet.has(c.id));
        draft.selection.selectedIds = draft.selection.selectedIds.filter((sid: string) => !idSet.has(sid));
        useDirtyStore.getState().markDirty();
      });
      return before - get().components.length;
    },

    updateComponent: (id, updates) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const idx = draft.components.findIndex((c: SceneComponent) => c.id === id);
        if (idx !== -1) {
          Object.assign(draft.components[idx], updates);
          useDirtyStore.getState().markDirty();
        }
      });
    },

    updateComponentTransform: (id, transform) => {
      set((draft: EditorState) => {
        const comp = draft.components.find((c: SceneComponent) => c.id === id);
        if (comp) {
          Object.assign(comp.transform, transform);
          useDirtyStore.getState().markDirty();
        }
      });
      if (_transformHistoryTimer) clearTimeout(_transformHistoryTimer);
      _transformHistoryTimer = setTimeout(() => {
        get().pushHistory('update');
        _transformHistoryTimer = null;
      }, TRANSFORM_HISTORY_DELAY);
    },

    updateComponentConfig: (id, config) => {
      set((draft: EditorState) => {
        const comp = draft.components.find((c: SceneComponent) => c.id === id);
        if (comp) {
          comp.config = { ...comp.config, ...config };
          useDirtyStore.getState().markDirty();
        }
      });
      if (_configHistoryTimer) clearTimeout(_configHistoryTimer);
      _configHistoryTimer = setTimeout(() => {
        get().pushHistory('update');
        _configHistoryTimer = null;
      }, 300);
    },

    syncWritingEntityCards: (bizKey, bizId, patch) => {
      set((draft: EditorState) => {
        let touched = false;
        const apply = (comps: SceneComponent[]) => {
          for (const comp of comps) {
            const cfg = comp.config as Record<string, unknown> | undefined;
            if (!cfg || cfg[bizKey] !== bizId) continue;
            if (patch.name !== undefined && comp.name !== patch.name) {
              comp.name = patch.name;
              touched = true;
            }
            if (patch.configPatch) {
              const merged = { ...cfg, ...patch.configPatch };
              if (JSON.stringify(merged) !== JSON.stringify(cfg)) {
                comp.config = merged;
                touched = true;
              }
            }
          }
        };
        // 跨全部视图匹配：写作卡可能摆在任何视图里，不能只刷激活视图
        for (const v of draft.views) apply(v.components ?? []);
        // 激活视图的 components 数组可能与 views 里的引用不同（loadScene 路径），兜底再刷
        apply(draft.components);
        if (touched) useDirtyStore.getState().markDirty();
      });
    },

    batchUpdateComponent: (id, updates) => {
      set((draft: EditorState) => {
        const comp = draft.components.find((c: SceneComponent) => c.id === id);
        if (!comp) return;
        if (updates.config) {
          comp.config = { ...comp.config, ...updates.config };
        }
        if (updates.transform) {
          Object.assign(comp.transform, updates.transform);
        }
        useDirtyStore.getState().markDirty();
      });
      if (_configHistoryTimer) clearTimeout(_configHistoryTimer);
      _configHistoryTimer = setTimeout(() => {
        get().pushHistory('update');
        _configHistoryTimer = null;
      }, 300);
    },

    moveComponentToLayer: (id, layerId) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const comp = draft.components.find((c: SceneComponent) => c.id === id);
        if (comp) {
          comp.layerId = layerId;
          useDirtyStore.getState().markDirty();
        }
      });
    },

    reorderComponent: (id, zIndex) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const comp = draft.components.find((c: SceneComponent) => c.id === id);
        if (comp) {
          comp.zIndex = zIndex;
          useDirtyStore.getState().markDirty();
        }
      });
    },

    duplicateComponent: (id) => {
      const state = get();
      const comp = state.components.find((c: SceneComponent) => c.id === id);
      if (!comp) return null;

      const newComp: SceneComponent = {
        ...JSON.parse(JSON.stringify(comp)),
        id: `comp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        name: `${comp.name} ${t('editor.copySuffix')}`,
        transform: {
          ...comp.transform,
          x: comp.transform.x + 20,
          y: comp.transform.y + 20,
        },
      };

      get().pushHistory('add');

      set((draft: EditorState) => {
        draft.components.push(newComp);
        draft.selection.selectedIds = [newComp.id];
        useDirtyStore.getState().markDirty();
      });

      return newComp;
    },

    getComponentsByLayer: (layerId) => {
      const state = get();
      const descendantIds = getLayerDescendants(state.layers, layerId);
      return state.components.filter((c: SceneComponent) => descendantIds.includes(c.layerId));
    },

    getComponent: (id) => {
      return get().components.find((c: SceneComponent) => c.id === id);
    },

    addLayer: (name, parentId = null) => {
      const layer = createDefaultLayer(name, 'layer', parentId);
      get().pushHistory('add');
      set((draft: EditorState) => {
        const siblings = parentId
          ? draft.layers.filter((l: LayerNode) => l.parentId === parentId)
          : draft.layers.filter((l: LayerNode) => l.parentId === null);
        layer.order = siblings.length;
        draft.layers.push(layer);
        if (parentId) {
          const parent = draft.layers.find((l: LayerNode) => l.id === parentId);
          if (parent) {
            parent.children.push(layer.id);
          }
        }
        useDirtyStore.getState().markDirty();
      });
      return layer;
    },

    addLayerGroup: (name, parentId = null) => {
      const layer = createDefaultLayer(name, 'group', parentId);
      get().pushHistory('add');
      set((draft: EditorState) => {
        const siblings = parentId
          ? draft.layers.filter((l: LayerNode) => l.parentId === parentId)
          : draft.layers.filter((l: LayerNode) => l.parentId === null);
        layer.order = siblings.length;
        draft.layers.push(layer);
        if (parentId) {
          const parent = draft.layers.find((l: LayerNode) => l.id === parentId);
          if (parent) {
            parent.children.push(layer.id);
          }
        }
        useDirtyStore.getState().markDirty();
      });
      return layer;
    },

    removeLayer: (id) => {
      get().pushHistory('delete');
      set((draft: EditorState) => {
        const layer = draft.layers.find((l: LayerNode) => l.id === id);
        if (layer?.isDefault) return;

        const descendantIds = getLayerDescendants(draft.layers, id);
        draft.components = draft.components.filter((c: SceneComponent) => !descendantIds.includes(c.layerId));
        const parent = draft.layers.find((l: LayerNode) => l.children.includes(id));
        if (parent) {
          parent.children = parent.children.filter((cid: string) => cid !== id);
        }
        draft.layers = draft.layers.filter((l: LayerNode) => !descendantIds.includes(l.id));

        if (draft.activeLayerId === id) {
          const defaultLayer = draft.layers.find((l: LayerNode) => l.isDefault);
          draft.activeLayerId = defaultLayer?.id || null;
        }

        useDirtyStore.getState().markDirty();
      });
    },

    updateLayer: (id, updates) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const idx = draft.layers.findIndex((l: LayerNode) => l.id === id);
        if (idx !== -1) {
          Object.assign(draft.layers[idx], updates);
          useDirtyStore.getState().markDirty();
        }
      });
    },

    moveLayerToParent: (id, parentId, order) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const layer = draft.layers.find((l: LayerNode) => l.id === id);
        if (!layer) return;

        const oldParent = draft.layers.find((l: LayerNode) => l.children.includes(id));
        if (oldParent) {
          oldParent.children = oldParent.children.filter((cid: string) => cid !== id);
        }

        layer.parentId = parentId;
        if (parentId) {
          const newParent = draft.layers.find((l: LayerNode) => l.id === parentId);
          if (newParent) {
            newParent.children.push(id);
            newParent.children.sort((a: string, b: string) => {
              const childA = draft.layers.find((l: LayerNode) => l.id === a);
              const childB = draft.layers.find((l: LayerNode) => l.id === b);
              return (childA?.order ?? 0) - (childB?.order ?? 0);
            });
          }
        }

        if (order !== undefined) {
          layer.order = order;
        } else {
          const siblings = parentId
            ? draft.layers.filter((l: LayerNode) => l.parentId === parentId)
            : draft.layers.filter((l: LayerNode) => l.parentId === null);
          layer.order = siblings.length - 1;
        }

        useDirtyStore.getState().markDirty();
      });
    },

    reorderLayer: (id, order) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const layer = draft.layers.find((l: LayerNode) => l.id === id);
        if (layer) {
          layer.order = order;
          useDirtyStore.getState().markDirty();
        }
      });
    },

    toggleLayerVisibility: (id) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const layer = draft.layers.find((l: LayerNode) => l.id === id);
        if (layer) {
          const newVisible = !layer.visible;
          layer.visible = newVisible;
          if (layer.type === 'group') {
            const descendantIds = getLayerDescendants(draft.layers, id);
            for (const did of descendantIds) {
              if (did === id) continue;
              const child = draft.layers.find((l: LayerNode) => l.id === did);
              if (child) child.visible = newVisible;
            }
          }
          useDirtyStore.getState().markDirty();
        }
      });
    },

    toggleLayerLock: (id) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const layer = draft.layers.find((l: LayerNode) => l.id === id);
        if (layer) {
          const newLocked = !layer.locked;
          layer.locked = newLocked;
          if (layer.type === 'group') {
            const descendantIds = getLayerDescendants(draft.layers, id);
            for (const did of descendantIds) {
              if (did === id) continue;
              const child = draft.layers.find((l: LayerNode) => l.id === did);
              if (child) child.locked = newLocked;
            }
          }
          useDirtyStore.getState().markDirty();
        }
      });
    },

    toggleLayerExpanded: (id) => {
      set((draft: EditorState) => {
        const layer = draft.layers.find((l: LayerNode) => l.id === id);
        if (layer) {
          layer.expanded = !layer.expanded;
        }
      });
    },

    getLayer: (id) => {
      return get().layers.find((l: LayerNode) => l.id === id);
    },

    getRootLayers: () => {
      return get()
        .layers.filter((l: LayerNode) => l.parentId === null)
        .sort((a: LayerNode, b: LayerNode) => a.order - b.order);
    },

    getLayerTree: () => {
      return get().layers;
    },

    addEventBinding: (binding: any) => {
      set((draft: EditorState) => {
        const existing = draft.eventBindings.findIndex((b: any) => b.id === binding.id);
        if (existing === -1) {
          draft.eventBindings.push({ ...binding, enabled: binding.enabled !== false });
        } else {
          draft.eventBindings[existing] = { ...draft.eventBindings[existing], ...binding };
        }
      });
      logger.info('EditorStore', 'Event binding added', { eventId: binding.id, sourceEvent: binding.sourceEvent });
    },

    removeEventBinding: (id: string) => {
      set((draft: EditorState) => {
        const idx = draft.eventBindings.findIndex((b: any) => b.id === id);
        if (idx !== -1) {
          draft.eventBindings.splice(idx, 1);
        }
      });
    },

    updateEventBinding: (id: string, updates: any) => {
      set((draft: EditorState) => {
        const binding = draft.eventBindings.find((b: any) => b.id === id);
        if (binding) {
          Object.assign(binding, updates);
        }
      });
    },

    selectComponent: (id, multi = false) => {
      set((draft: EditorState) => {
        if (multi) {
          const idx = draft.selection.selectedIds.indexOf(id);
          if (idx !== -1) {
            draft.selection.selectedIds.splice(idx, 1);
          } else {
            draft.selection.selectedIds.push(id);
          }
          draft.selection.isMultiSelect = true;
        } else {
          draft.selection.selectedIds = [id];
          draft.selection.isMultiSelect = false;
        }
        // 与写作设定项选中互斥：画布选中即清空右栏设定选中态
        draft.selectedSettingId = null;
        // 与时间线事件选中互斥：画布选中即清空右栏时间线事件选中态
        draft.selectedTimelineEventId = null;
        // 与剧情线选中互斥
        draft.selectedStorylineId = null;
        // 与伏笔选中互斥
        draft.selectedForeshadowingId = null;
        // 与灵感念头选中互斥
        draft.selectedInspirationId = null;
        // 与大纲章选中互斥
        draft.selectedChapterId = null;
      });
    },

    deselectAll: () => {
      set((draft: EditorState) => {
        draft.selection.selectedIds = [];
        draft.selection.isMultiSelect = false;
      });
    },

    selectAll: () => {
      set((draft: EditorState) => {
        draft.selection.selectedIds = draft.components.map((c: SceneComponent) => c.id);
        draft.selection.isMultiSelect = true;
      });
    },

    setHoveredComponent: (id) => {
      logger.debug('EditorStore', 'setHoveredComponent', { id });
      set((draft: EditorState) => {
        draft.selection.hoveredId = id;
      });
    },

    selectSetting: (id) => {
      set((draft: EditorState) => {
        // 与画布选择互斥：选中设定项时清空画布选中，反之亦然由 selectComponent 负责
        draft.selectedSettingId = id;
        // 与时间线事件选中互斥：选中设定项时清空时间线事件选中态
        draft.selectedTimelineEventId = null;
        // 与剧情线选中互斥
        draft.selectedStorylineId = null;
        // 与伏笔选中互斥
        draft.selectedForeshadowingId = null;
        // 与灵感念头选中互斥
        draft.selectedInspirationId = null;
        // 与大纲章选中互斥
        draft.selectedChapterId = null;
        if (id) {
          draft.selection.selectedIds = [];
          draft.selection.isMultiSelect = false;
        }
      });
    },

    selectTimelineEvent: (id) => {
      set((draft: EditorState) => {
        // 与画布选择、写作设定选中互斥：选中时间线事件即清空二者
        draft.selectedTimelineEventId = id;
        draft.selectedSettingId = null;
        draft.selectedStorylineId = null;
        draft.selectedForeshadowingId = null;
        draft.selectedInspirationId = null;
        draft.selectedChapterId = null;
        if (id) {
          draft.selection.selectedIds = [];
          draft.selection.isMultiSelect = false;
        }
      });
    },

    selectStoryline: (id) => {
      set((draft: EditorState) => {
        // 与事件/设定/画布选中互斥：选中剧情线即清空三者
        draft.selectedStorylineId = id;
        draft.selectedTimelineEventId = null;
        draft.selectedSettingId = null;
        draft.selectedForeshadowingId = null;
        draft.selectedInspirationId = null;
        draft.selectedChapterId = null;
        if (id) {
          draft.selection.selectedIds = [];
          draft.selection.isMultiSelect = false;
        }
      });
    },

    selectForeshadowing: (id) => {
      set((draft: EditorState) => {
        // 与事件/设定/剧情线/灵感/画布选中互斥：选中伏笔即清空五者
        draft.selectedForeshadowingId = id;
        draft.selectedStorylineId = null;
        draft.selectedTimelineEventId = null;
        draft.selectedSettingId = null;
        draft.selectedInspirationId = null;
        draft.selectedChapterId = null;
        if (id) {
          draft.selection.selectedIds = [];
          draft.selection.isMultiSelect = false;
        }
      });
    },

    selectInspiration: (id) => {
      set((draft: EditorState) => {
        // 与事件/设定/剧情线/伏笔/画布选中互斥：选中灵感念头即清空其余
        draft.selectedInspirationId = id;
        draft.selectedTimelineEventId = null;
        draft.selectedSettingId = null;
        draft.selectedStorylineId = null;
        draft.selectedForeshadowingId = null;
        draft.selectedChapterId = null;
        if (id) {
          draft.selection.selectedIds = [];
          draft.selection.isMultiSelect = false;
        }
      });
    },

    selectChapter: (id) => {
      set((draft: EditorState) => {
        // 与画布选择、设定/事件/剧情线/伏笔/灵感选中互斥：选中大纲章即清空其余
        draft.selectedChapterId = id;
        draft.selectedSettingId = null;
        draft.selectedTimelineEventId = null;
        draft.selectedStorylineId = null;
        draft.selectedForeshadowingId = null;
        draft.selectedInspirationId = null;
        if (id) {
          draft.selection.selectedIds = [];
          draft.selection.isMultiSelect = false;
        }
      });
    },

    setTimelineViewMode: (mode) => {
      set((draft: EditorState) => {
        draft.timelineViewMode = mode;
      });
    },

    setProofreadFocusKey: (key) => {
      set((draft: EditorState) => {
        draft.proofreadFocusKey = key;
        // 校对定位与伏笔/灵感/事件等右栏选中互斥：聚焦发现行时不应残留其他选中态
        if (key) {
          draft.selectedForeshadowingId = null;
          draft.selectedInspirationId = null;
          draft.selectedTimelineEventId = null;
          draft.selectedChapterId = null;
          draft.selectedSettingId = null;
          draft.selectedStorylineId = null;
        }
      });
    },

    setStatsFocusChapterId: (id) => {
      set((draft: EditorState) => {
        draft.statsFocusChapterId = id;
        if (id) {
          draft.selectedForeshadowingId = null;
          draft.selectedInspirationId = null;
          draft.selectedTimelineEventId = null;
          draft.selectedChapterId = null;
          draft.selectedSettingId = null;
          draft.selectedStorylineId = null;
          draft.proofreadFocusKey = null;
        }
      });
    },

    setProofreadJumpAnchor: (anchor) => {
      set((draft: EditorState) => {
        draft.proofreadJumpAnchor = anchor;
      });
    },

    setProofreadReturnCtx: (ctx) => {
      set((draft: EditorState) => {
        draft.proofreadReturnCtx = ctx;
      });
    },

    getSelectedComponents: () => {
      const state = get();
      return state.components.filter((c: SceneComponent) => state.selection.selectedIds.includes(c.id));
    },

    setViewport: (viewport) => {
      set((draft: EditorState) => {
        Object.assign(draft.viewport, viewport);
      });
    },

    zoomIn: () => {
      set((draft: EditorState) => {
        const oldScale = draft.viewport.scale;
        const newScale = Math.min(
          oldScale + draft.canvasConfig.viewport.zoomStep,
          draft.canvasConfig.viewport.maxScale,
        );
        const roundedScale = Math.round(newScale * 100) / 100;
        const centerX = (draft.canvasConfig.width * oldScale) / 2 + draft.viewport.offset.x;
        const centerY = (draft.canvasConfig.height * oldScale) / 2 + draft.viewport.offset.y;
        draft.viewport.offset.x = centerX - (draft.canvasConfig.width * roundedScale) / 2;
        draft.viewport.offset.y = centerY - (draft.canvasConfig.height * roundedScale) / 2;
        draft.viewport.scale = roundedScale;
      });
    },

    zoomOut: () => {
      set((draft: EditorState) => {
        const oldScale = draft.viewport.scale;
        const newScale = Math.max(
          oldScale - draft.canvasConfig.viewport.zoomStep,
          draft.canvasConfig.viewport.minScale,
        );
        const roundedScale = Math.round(newScale * 100) / 100;
        const centerX = (draft.canvasConfig.width * oldScale) / 2 + draft.viewport.offset.x;
        const centerY = (draft.canvasConfig.height * oldScale) / 2 + draft.viewport.offset.y;
        draft.viewport.offset.x = centerX - (draft.canvasConfig.width * roundedScale) / 2;
        draft.viewport.offset.y = centerY - (draft.canvasConfig.height * roundedScale) / 2;
        draft.viewport.scale = roundedScale;
      });
    },

    zoomToFit: () => {
      set((draft: EditorState) => {
        draft.viewport.scale = 1;
        draft.viewport.offset = { x: 0, y: 0 };
      });
    },

    resetViewport: (containerWidth?, containerHeight?) => {
      const cc = get().canvasConfig;
      const cs = get().containerSize;
      const cW = containerWidth || cs.width;
      const cH = containerHeight || cs.height;
      if (cW && cH) {
        // 简单适配：根据画布与容器比例计算 scale
        const scale = Math.min(cW / cc.width, cH / cc.height);
        set((draft: EditorState) => {
          draft.viewport = {
            scale,
            offset: {
              x: (cW - cc.width * scale) / 2,
              y: (cH - cc.height * scale) / 2,
            },
          };
        });
      } else {
        set((draft: EditorState) => {
          draft.viewport = { ...DEFAULT_VIEWPORT };
        });
      }
    },

    setContainerSize: (width, height) => {
      set((draft: EditorState) => {
        draft.containerSize = { width, height };
      });
    },

    panTo: (x, y) => {
      set((draft: EditorState) => {
        draft.viewport.offset = { x, y };
      });
    },

    setActiveTool: (tool) => {
      set((draft: EditorState) => {
        draft.activeTool = tool;
      });
    },

    setDraggedComponentType: (type) => {
      set((draft: EditorState) => {
        draft.draggedComponentType = type;
      });
    },

    setActiveLayer: (layerId) => {
      set((draft: EditorState) => {
        draft.activeLayerId = layerId;
      });
    },

    setCanvasConfig: (updates) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        const merged = { ...DEFAULT_CANVAS_CONFIG, ...draft.canvasConfig, ...updates };
        merged.background = {
          ...DEFAULT_CANVAS_CONFIG.background,
          ...draft.canvasConfig.background,
          ...updates.background,
        };
        if (updates.background?.gradient || draft.canvasConfig.background?.gradient) {
          merged.background.gradient = {
            ...DEFAULT_CANVAS_CONFIG.background.gradient,
            ...draft.canvasConfig.background.gradient,
            ...updates.background?.gradient,
          };
        }
        merged.grid = { ...DEFAULT_CANVAS_CONFIG.grid, ...draft.canvasConfig.grid, ...updates.grid };
        merged.ruler = { ...DEFAULT_CANVAS_CONFIG.ruler, ...draft.canvasConfig.ruler, ...updates.ruler };
        merged.guide = { ...DEFAULT_CANVAS_CONFIG.guide, ...draft.canvasConfig.guide, ...updates.guide };
        merged.viewport = { ...DEFAULT_CANVAS_CONFIG.viewport, ...draft.canvasConfig.viewport, ...updates.viewport };
        draft.canvasConfig = merged;
        useDirtyStore.getState().markDirty();
      });
    },

    setCanvasSize: (width, height) => {
      get().pushHistory('update');
      set((draft: EditorState) => {
        draft.canvasConfig.width = width;
        draft.canvasConfig.height = height;
        draft.canvasConfig.orientation = width >= height ? 'landscape' : 'portrait';
        const maxDim = Math.max(width, height);
        let recommendedMaxScale = 5;
        if (maxDim > 10000) recommendedMaxScale = 10;
        else if (maxDim > 5000) recommendedMaxScale = 8;
        if (
          draft.canvasConfig.viewport.maxScale === DEFAULT_CANVAS_CONFIG.viewport.maxScale ||
          draft.canvasConfig.viewport.maxScale < recommendedMaxScale
        ) {
          draft.canvasConfig.viewport.maxScale = recommendedMaxScale;
        }
        for (const comp of draft.components) {
          const compRight = comp.transform.x + (comp.transform.width || 0);
          const compBottom = comp.transform.y + (comp.transform.height || 0);
          if (compRight > width) {
            comp.transform.x = Math.max(0, width - (comp.transform.width || 0));
          }
          if (compBottom > height) {
            comp.transform.y = Math.max(0, height - (comp.transform.height || 0));
          }
        }
        useDirtyStore.getState().markDirty();
      });
    },

    undo: () => {
      const state = get();
      if (state.historyIndex < 0) return;
      const entry = state.history[state.historyIndex];
      if (!entry) return;

      const currentComponents = JSON.parse(JSON.stringify(state.components));
      const currentLayers = JSON.parse(JSON.stringify(state.layers)) as LayerNode[];
      const currentCanvasConfig = JSON.parse(JSON.stringify(state.canvasConfig)) as CanvasConfig;

      set((draft: EditorState) => {
        draft.history[draft.historyIndex].after = currentComponents;
        draft.history[draft.historyIndex].layersAfter = currentLayers;
        draft.history[draft.historyIndex].canvasConfigAfter = currentCanvasConfig;

        draft.components = JSON.parse(JSON.stringify(entry.before));
        if (entry.layersBefore) {
          draft.layers = JSON.parse(JSON.stringify(entry.layersBefore));
        }
        if (entry.canvasConfigBefore) {
          draft.canvasConfig = JSON.parse(JSON.stringify(entry.canvasConfigBefore));
        }
        draft.historyIndex = draft.historyIndex - 1;
        useDirtyStore.getState().markDirty();
        const validIds = new Set(draft.components.map((c: SceneComponent) => c.id));
        draft.selection.selectedIds = draft.selection.selectedIds.filter((id: string) => validIds.has(id));
      });
    },

    redo: () => {
      const state = get();
      const newIndex = state.historyIndex + 1;
      if (newIndex >= state.history.length) return;
      const entry = state.history[newIndex];
      if (!entry) return;
      set((draft: EditorState) => {
        draft.components = JSON.parse(JSON.stringify(entry.after));
        if (entry.layersAfter) {
          draft.layers = JSON.parse(JSON.stringify(entry.layersAfter));
        }
        if (entry.canvasConfigAfter) {
          draft.canvasConfig = JSON.parse(JSON.stringify(entry.canvasConfigAfter));
        }
        draft.historyIndex = newIndex;
        useDirtyStore.getState().markDirty();
        const validIds = new Set(draft.components.map((c: SceneComponent) => c.id));
        draft.selection.selectedIds = draft.selection.selectedIds.filter((id: string) => validIds.has(id));
      });
    },

    canUndo: () => get().historyIndex >= 0,
    canRedo: () => {
      const state = get();
      return state.historyIndex < state.history.length - 1;
    },

    beginBatch: () => {
      _batchDepth++;
      if (_batchDepth === 1) {
        const s = get();
        _batchBeforeComponents = structuredClone(s.components);
        _batchBeforeLayers = structuredClone(s.layers);
        _batchBeforeCanvas = structuredClone(s.canvasConfig);
      }
    },

    endBatch: () => {
      if (_batchDepth <= 0) {
        _batchDepth = 0;
        return;
      }
      _batchDepth--;
      if (_batchDepth > 0) return;
      const s = get();
      const entry: HistoryEntry = {
        id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        timestamp: Date.now(),
        type: 'batch',
        before: _batchBeforeComponents ?? structuredClone(s.components),
        after: structuredClone(s.components),
        layersBefore: _batchBeforeLayers ?? structuredClone(s.layers),
        layersAfter: structuredClone(s.layers),
        canvasConfigBefore: _batchBeforeCanvas ?? structuredClone(s.canvasConfig),
        canvasConfigAfter: structuredClone(s.canvasConfig),
      };
      const newIndex = s.historyIndex + 1;
      const truncated = s.history.slice(0, newIndex);
      truncated.push(entry);
      if (truncated.length > s.maxHistory) truncated.shift();
      set((draft: EditorState) => {
        draft.history = truncated;
        draft.historyIndex = draft.history.length - 1;
      });
      _batchBeforeComponents = null;
      _batchBeforeLayers = null;
      _batchBeforeCanvas = null;
    },

    pushHistory: (type) => {
      if (_batchDepth > 0) return;
      const state = get();
      const snapshot = structuredClone(state.components);
      const layersSnapshot = structuredClone(state.layers) as LayerNode[];
      const canvasConfigSnapshot = structuredClone(state.canvasConfig) as CanvasConfig;
      const entry: HistoryEntry = {
        id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        timestamp: Date.now(),
        type,
        before: snapshot,
        after: snapshot,
        layersBefore: layersSnapshot,
        layersAfter: layersSnapshot,
        canvasConfigBefore: canvasConfigSnapshot,
        canvasConfigAfter: canvasConfigSnapshot,
      };
      const newIndex = state.historyIndex + 1;
      const truncated = state.history.slice(0, newIndex);
      truncated.push(entry);
      if (truncated.length > state.maxHistory) {
        truncated.shift();
      }
      set((draft: EditorState) => {
        draft.history = truncated;
        draft.historyIndex = draft.history.length - 1;
      });
    },

    copySelected: () => {
      const state = get();
      const selected = state.components.filter((c: SceneComponent) => state.selection.selectedIds.includes(c.id));
      set((draft: EditorState) => {
        draft.clipboard = JSON.parse(JSON.stringify(selected));
      });
    },

    pasteClipboard: () => {
      const state = get();
      if (state.clipboard.length === 0) return;

      const pasted: SceneComponent[] = state.clipboard.map((comp: SceneComponent) => ({
        ...JSON.parse(JSON.stringify(comp)),
        id: `comp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        name: `${comp.name} ${t('editor.copySuffix')}`,
        transform: {
          ...comp.transform,
          x: comp.transform.x + 20,
          y: comp.transform.y + 20,
        },
      }));

      get().pushHistory('add');

      set((draft: EditorState) => {
        draft.components.push(...pasted);
        draft.selection.selectedIds = pasted.map((c: SceneComponent) => c.id);
        useDirtyStore.getState().markDirty();
      });
    },

    loadScene: (components, layers) => {
      logger.warn('EditorStore', 'loadScene called, clearing selection', { componentCount: components.length });
      set((draft: EditorState) => {
        const layerIds = new Set(layers.map((l) => l.id));
        const validComponents = components.filter((c) => layerIds.has(c.layerId));
        draft.components = validComponents;
        draft.layers = layers;
        draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
        draft.history = [];
        draft.historyIndex = -1;
        useDirtyStore.getState().markClean();
        draft.eventBindings = [];
        draft.canvasConfig = deepClone(DEFAULT_CANVAS_CONFIG);
        draft.viewport = deepClone(DEFAULT_VIEWPORT);
        draft.views = [
          {
            id: 'default',
            name: 'viewTab.defaultView',
            components: validComponents,
            layers,
            canvasConfig: deepClone(DEFAULT_CANVAS_CONFIG),
            viewport: deepClone(DEFAULT_VIEWPORT),
            eventBindings: [],
          },
        ];
        draft.activeViewId = 'default';
        draft.globalComponents = [];

        const defaultLayer = layers.find((l) => l.isDefault);
        if (defaultLayer) {
          draft.activeLayerId = defaultLayer.id;
        } else if (layers.length > 0) {
          draft.activeLayerId = layers[0].id;
        } else {
          draft.activeLayerId = null;
        }
      });
    },

    exportScene: () => {
      const state = get();
      return {
        components: JSON.parse(JSON.stringify(state.components)),
        layers: JSON.parse(JSON.stringify(state.layers)),
      };
    },

    clearScene: () => {
      logger.warn('EditorStore', 'clearScene called, clearing selection');
      set((draft: EditorState) => {
        const defaultLayer = createDefaultLayer('viewTab.defaultLayer', 'layer', null, true);
        draft.components = [];
        draft.layers = [defaultLayer];
        draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
        draft.activeLayerId = defaultLayer.id;
        useDirtyStore.getState().markClean();
        draft.eventBindings = [];
        draft.canvasConfig = deepClone(DEFAULT_CANVAS_CONFIG);
        draft.viewport = deepClone(DEFAULT_VIEWPORT);
        draft.previewMode = false;
        draft.views = [
          {
            id: 'default',
            name: 'viewTab.defaultView',
            components: [],
            layers: [defaultLayer],
            canvasConfig: deepClone(DEFAULT_CANVAS_CONFIG),
            viewport: deepClone(DEFAULT_VIEWPORT),
            eventBindings: [],
          },
        ];
        draft.activeViewId = 'default';
        draft.globalComponents = [];
        draft.focusRequest = null;
        draft.fitRequest = null;
        draft.viewportLoadSeq = (draft.viewportLoadSeq ?? 0) + 1;
      });
    },

    setPreviewMode: (preview) => {
      if (preview) logger.warn('EditorStore', 'setPreviewMode(true) called, clearing selection');
      set((draft: EditorState) => {
        draft.previewMode = preview;
        if (preview) {
          draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
        }
      });
    },

    loadSceneWithViews: (views, globalComponents, activeViewId) => {
      logger.info('EditorStore', 'loadSceneWithViews called', {
        viewsCount: views.length,
        globalComponentsCount: globalComponents.length,
        activeViewId,
      });
      set((draft: EditorState) => {
        draft.views = views;
        draft.globalComponents = globalComponents;
        draft.activeViewId = activeViewId;
        const activeView = views.find((v) => v.id === activeViewId) || views[0];
        if (activeView) {
          draft.components = activeView.components;
          draft.layers = activeView.layers;
          draft.canvasConfig = activeView.canvasConfig
            ? deepClone(activeView.canvasConfig)
            : { ...DEFAULT_CANVAS_CONFIG };
          draft.viewport = activeView.viewport ? deepClone(activeView.viewport) : { ...DEFAULT_VIEWPORT };
          draft.eventBindings = activeView.eventBindings ? deepClone(activeView.eventBindings) : [];
          // 🔍 DIAGNOSTIC: 输出每个组件的类型信息
          logger.info('EditorStore', 'Active view components loaded', {
            viewId: activeView.id,
            viewName: activeView.name,
            componentsCount: activeView.components.length,
            savedViewport: activeView.viewport,
            sampleEntityTransforms: activeView.components.slice(0, 5).map((c) => ({
              id: c.id,
              type: c.type,
              name: c.name,
              transform: c.transform,
            })),
          });
        } else {
          draft.components = [];
          draft.layers = [];
          draft.canvasConfig = deepClone(DEFAULT_CANVAS_CONFIG);
          draft.viewport = deepClone(DEFAULT_VIEWPORT);
          draft.eventBindings = [];
        }
        draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
        draft.history = [];
        draft.historyIndex = -1;
        draft.viewportLoadSeq = (draft.viewportLoadSeq ?? 0) + 1;
        useDirtyStore.getState().markClean();
        const defaultLayer = draft.layers.find((l) => l.isDefault);
        draft.activeLayerId = defaultLayer?.id || (draft.layers.length > 0 ? draft.layers[0].id : null);
      });
    },

    exportSceneWithViews: () => {
      const state = get();
      const views = state.views.map((v) => {
        if (v.id === state.activeViewId) {
          return {
            ...v,
            components: deepClone(state.components),
            layers: deepClone(state.layers),
            canvasConfig: deepClone(state.canvasConfig),
            viewport: deepClone(state.viewport),
            eventBindings: deepClone(state.eventBindings),
          };
        }
        return {
          ...v,
          components: v.components ? deepClone(v.components) : [],
          layers: v.layers ? deepClone(v.layers) : [],
          eventBindings: v.eventBindings ? deepClone(v.eventBindings) : [],
        };
      });
      return { views, globalComponents: state.globalComponents, activeViewId: state.activeViewId };
    },

    addView: (name, template) => {
      set((draft: EditorState) => {
        const currentView = draft.views.find((v) => v.id === draft.activeViewId);
        if (currentView) {
          currentView.components = draft.components;
          currentView.layers = draft.layers;
          currentView.canvasConfig = draft.canvasConfig;
          currentView.viewport = draft.viewport;
          currentView.eventBindings = draft.eventBindings;
        }
        const viewId = `view-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        // 视角模板 → 新建视图（§4.5）：defaultLayers 转 LayerNode 数组（首层为默认层，
        // 便于 activeLayerId 定位）；layout 应用到 viewport 缩放/平移 + 画布网格可见性。
        // 未提供模板时保持原行为：单个"默认图层" + 沿用当前画布配置。
        const templateLayers = template?.layers?.length
          ? template.layers.map((l, i) => ({
              ...createDefaultLayer(l.name, 'layer', null, i === 0),
              color: l.color,
              order: i,
            }))
          : null;
        const layers = templateLayers ?? [createDefaultLayer('viewTab.defaultLayer', 'layer', null, true)];
        const newViewport: ViewportState = template?.layout
          ? {
              scale: template.layout.scale ?? DEFAULT_VIEWPORT.scale,
              offset: {
                x: template.layout.panX ?? DEFAULT_VIEWPORT.offset.x,
                y: template.layout.panY ?? DEFAULT_VIEWPORT.offset.y,
              },
            }
          : draft.viewport;
        const newCanvasConfig: CanvasConfig =
          template?.layout && template.layout.grid !== undefined
            ? { ...draft.canvasConfig, grid: { ...draft.canvasConfig.grid, visible: template.layout.grid } }
            : draft.canvasConfig;
        draft.views.push({
          id: viewId,
          name,
          components: [],
          layers,
          canvasConfig: newCanvasConfig,
          viewport: newViewport,
          eventBindings: [],
          carrierType: template?.meta?.carrierType,
          kind: template?.meta?.kind,
        });
        draft.activeViewId = viewId;
        draft.components = [];
        draft.layers = layers;
        draft.canvasConfig = newCanvasConfig;
        draft.viewport = newViewport;
        draft.eventBindings = [];
        draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
        draft.history = [];
        draft.historyIndex = -1;
        draft.activeLayerId = layers[0].id;
        useDirtyStore.getState().markDirty();
      });
      return get().activeViewId;
    },

    removeView: (viewId, opts) => {
      set((draft: EditorState) => {
        // 默认保留最后一只视图（代码场景删光会悬空）；书场景传 allowEmpty——
        // 2026-09-19 拍板：书场景 L2 页签全部可删，删光 = 回到「拖载体入画布」空态。
        if (draft.views.length <= 1 && !opts?.allowEmpty) return;
        const idx = draft.views.findIndex((v) => v.id === viewId);
        if (idx === -1) return;
        if (draft.activeViewId === viewId) {
          draft.views.splice(idx, 1);
          if (draft.views.length === 0) {
            // 删光分支：清空画布状态回空态引导。activeViewId 保留悬空 id
            // （场景级状态，画布/右栏均按可选链容忍），下次建视图由 switchView 校正。
            draft.components = [];
            draft.layers = [];
            draft.canvasConfig = { ...DEFAULT_CANVAS_CONFIG };
            draft.viewport = { ...DEFAULT_VIEWPORT };
            draft.eventBindings = [];
            draft.activeLayerId = null;
            draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
          } else {
            const nextView = draft.views[Math.min(idx, draft.views.length - 1)];
            draft.activeViewId = nextView.id;
            draft.components = nextView.components || [];
            draft.layers = nextView.layers || [];
            draft.canvasConfig = nextView.canvasConfig ? { ...nextView.canvasConfig } : { ...DEFAULT_CANVAS_CONFIG };
            draft.viewport = nextView.viewport
              ? { ...nextView.viewport, offset: { ...nextView.viewport.offset } }
              : { ...DEFAULT_VIEWPORT };
            draft.eventBindings = nextView.eventBindings ? [...nextView.eventBindings] : [];
            draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
            const defaultLayer = draft.layers.find((l) => l.isDefault);
            draft.activeLayerId = defaultLayer?.id || (draft.layers.length > 0 ? draft.layers[0].id : null);
          }
        } else {
          const activeView = draft.views.find((v) => v.id === draft.activeViewId);
          if (activeView) {
            activeView.components = draft.components;
            activeView.layers = draft.layers;
            activeView.canvasConfig = draft.canvasConfig;
            activeView.viewport = draft.viewport;
            activeView.eventBindings = draft.eventBindings;
          }
          draft.views.splice(idx, 1);
        }
        useDirtyStore.getState().markDirty();
      });
    },

    switchView: (viewId) => {
      const prevViewId = get().activeViewId;
      set((draft: EditorState) => {
        const currentView = draft.views.find((v) => v.id === draft.activeViewId);
        if (currentView) {
          currentView.components = draft.components;
          currentView.layers = draft.layers;
          currentView.canvasConfig = { ...draft.canvasConfig };
        }
        const targetView = draft.views.find((v) => v.id === viewId);
        if (!targetView) return;
        draft.activeViewId = viewId;
        draft.components = targetView.components || [];
        draft.layers = targetView.layers || [];
        if (targetView.canvasConfig) {
          draft.canvasConfig = { ...targetView.canvasConfig };
        }
        // 每个视图有自己的持久化视口：切换时恢复（此前被忽略，切视图后视口错位）。
        // 注意：此处不能用 structuredClone —— immer producer 内 targetView.viewport 是
        // draft 代理，Node 的结构化克隆会抛 DataCloneError；用展开拷贝（同 removeView）。
        draft.viewport = targetView.viewport
          ? { ...targetView.viewport, offset: { ...targetView.viewport.offset } }
          : { ...DEFAULT_VIEWPORT, offset: { ...DEFAULT_VIEWPORT.offset } };
        draft.viewportLoadSeq = (draft.viewportLoadSeq ?? 0) + 1;
        draft.selection = { selectedIds: [], hoveredId: null, isMultiSelect: false };
        draft.history = [];
        draft.historyIndex = -1;
        const defaultLayer = draft.layers.find((l) => l.isDefault);
        draft.activeLayerId = defaultLayer?.id || (draft.layers.length > 0 ? draft.layers[0].id : null);
      });
      logger.info('EditorStore', 'switchView', {
        from: prevViewId,
        to: viewId,
        newViewport: get().viewport,
        newCanvasConfig: { width: get().canvasConfig.width, height: get().canvasConfig.height },
        componentCount: get().components.length,
      });
    },

    ensureStructureView: () => {
      const existing = get().views.find((v) => v.id === 'default');
      if (existing) return 'default';
      // 结构视图被用户删了：按初始结构重建，id 固定为 default（幂等，
      // 下次同步仍命中同一视图而不是又开一个空白视图）。
      set((draft: EditorState) => {
        const layer = createDefaultLayer('viewTab.defaultLayer', 'layer', null, true);
        draft.views.push({
          id: 'default',
          name: 'viewTab.defaultView',
          components: [],
          layers: [layer],
          canvasConfig: deepClone(DEFAULT_CANVAS_CONFIG),
          viewport: deepClone(DEFAULT_VIEWPORT),
          eventBindings: [],
        });
        useDirtyStore.getState().markDirty();
      });
      return 'default';
    },

    renameView: (viewId, name) => {
      if (viewId === 'default') return; // 默认视图（目录树）名称不可编辑
      set((draft: EditorState) => {
        const view = draft.views.find((v) => v.id === viewId);
        if (view) {
          view.name = name;
          useDirtyStore.getState().markDirty();
        }
      });
    },

    getActiveView: () => {
      const state = get();
      return state.views.find((v) => v.id === state.activeViewId);
    },

    focusComponent: (id) => {
      // ts 用自增计数器保证严格单调（Date.now() 同毫秒会重复，导致画布跳过居中）
      _focusSeq += 1;
      set((draft: EditorState) => {
        draft.selection.selectedIds = [id];
        draft.selection.isMultiSelect = false;
        draft.focusRequest = { id, ts: _focusSeq };
      });
    },

    focusReviewFinding: (id) => {
      // 复用 _focusSeq 自增计数器保证严格单调，连续点击同一条发现也能重复触发聚焦/闪高亮
      _focusSeq += 1;
      set((draft: EditorState) => {
        draft.reviewFindingFocus = { id, ts: _focusSeq };
      });
    },

    setFindingSeverities: (severities) =>
      set((s) => {
        s.reviewFindingFilter.severities = severities;
      }),

    setFindingShowInline: (show) =>
      set((s) => {
        s.reviewFindingFilter.showInline = show;
      }),

    requestAiPanel: () => {
      set((draft: EditorState) => {
        draft.aiPanelRequest = (draft.aiPanelRequest || 0) + 1;
      });
    },

    selectComponents: (ids) => {
      set((draft: EditorState) => {
        // 只保留仍存在的实体 id，避免搜索结果里混入已被删除的实体
        const valid = new Set(draft.components.map((c: SceneComponent) => c.id));
        const next = ids.filter((id) => valid.has(id));
        draft.selection.selectedIds = next;
        draft.selection.isMultiSelect = next.length > 1;
      });
    },

    setDepLayoutMode: (mode) => {
      set((draft: EditorState) => {
        draft.depLayoutMode = mode;
      });
    },
    setDepFilter: (f) => {
      set((draft: EditorState) => {
        draft.depFilter = f;
      });
    },
    setDepFocusFileId: (id) => {
      set((draft: EditorState) => {
        draft.depFocusFileId = id;
      });
    },
    setCouplingFilter: (f) => {
      set((draft: EditorState) => {
        draft.couplingFilter = f;
      });
    },
    /**
     * 切换时间窗：先落 store，再触发后端真重扫并落库 + 重画当前变更耦合视图。
     * 抽出为独立 action 而非 setter 里直接 invoke，是为了遵守「数据 ↔ 视图」单向流
     * （store 永远只改本 store 字段；副作用副作用应在外层 handler 调用），避免在
     * setter 里隐藏 invoke 副作用增加调试复杂度。
     */
    setCouplingWindowDays: (d) => {
      set((draft: EditorState) => {
        draft.couplingWindowDays = d;
      });
    },
    setCouplingFocusFileId: (id) => {
      set((draft: EditorState) => {
        draft.couplingFocusFileId = id;
      });
    },
    setQuadrantFocusZone: (zone) => {
      set((draft: EditorState) => {
        draft.quadrantFocusZone = zone;
      });
    },
    setCouplingLayoutMode: (mode) => {
      set((draft: EditorState) => {
        draft.couplingLayoutMode = mode;
      });
    },
    requestFit: (ids) => {
      _fitSeq += 1;
      set((draft: EditorState) => {
        draft.fitRequest = ids && ids.length > 0 ? { ts: _fitSeq, ids: [...ids] } : { ts: _fitSeq };
      });
    },

    toggleSymbolFile: (fileId) => {
      set((draft: EditorState) => {
        if (draft.expandedSymFiles.has(fileId)) draft.expandedSymFiles.delete(fileId);
        else draft.expandedSymFiles.add(fileId);
      });
    },

    setDirectoryShowFiles: (v) => {
      set((draft: EditorState) => {
        draft.directoryShowFiles = v;
      });
    },
    setDirectorySearch: (v) => {
      set((draft: EditorState) => {
        draft.directorySearch = v;
      });
    },
    setDirectorySort: (v) => {
      set((draft: EditorState) => {
        draft.directorySort = v;
      });
    },
    openImagePreview: (data) => set({ imagePreview: data }),
    closeImagePreview: () => set({ imagePreview: null }),
  })),
);

// 开发模式暴露到 window，方便 Console 调试
if (typeof window !== 'undefined') {
  (window as any).__editorStore = useEditorStore;
}
