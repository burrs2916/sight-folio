import { componentRegistry, lazy } from "./registryCore";

/**
 * 核心符号实体的语言归属（小写 id，对齐 analyzer id base）。
 * 关键语义：Rust / Go 没有 class 概念，必须从 OOP 类语言列表排除，
 * 改由各自 analyzer 注册的 struct/trait/impl（Rust）承载。
 * 若新增语言 analyzer，需同步维护这里，保证图鉴按语言分组正确。
 */
const OOP_CLASS_LANGS = ["typescript", "javascript", "java", "csharp", "kotlin", "swift", "php", "ruby", "python", "cpp"];
const OOP_INTERFACE_LANGS = ["typescript", "javascript", "java", "csharp", "kotlin", "swift", "php", "ruby", "python", "cpp", "go"];

/**
 * 注册项目分析器的核心实体类型
 * 替代 biosphere 的图表/地图/装饰/设备注册
 */
export function registerProjectEntities(): void {
  // ── 文件实体 ──
  componentRegistry.register({
    type: "file",
    name: "entityProj.file.name",
    icon: "description",
    description: "entityProj.file.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 180, height: 60 },
    defaultConfig: {
      filePath: "",
      fileName: "untitled",
      language: "",
      fileSize: 0,
      lineCount: 0,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/FileRenderer").then(m => ({ default: m.FileRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 图片实体 ──
  // 图片资源（png/jpg/svg/ico…）此前被扫描忽略，图鉴与画布均无对应样式。
  // 现在扫描层把图片落库为独立 image 实体（language="image"），这里注册其
  // 类型：专属 ImageIcon + 图片配色，画布走轻量 ImageRenderer（无代码洞察叠层）。
  componentRegistry.register({
    type: "image",
    name: "entityProj.image.name",
    icon: "image",
    description: "entityProj.image.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 180, height: 60 },
    defaultConfig: {
      filePath: "",
      fileName: "图片",
      language: "image",
      fileSize: 0,
      lineCount: 0,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/ImageRenderer").then(m => ({ default: m.ImageRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 资源文件实体 ──
  // 资源文件（字体 ttf/otf/woff…、音视频、压缩包、其它二进制 pdf/wasm…）与图片同级，
  // 扫描层落库为独立 asset 实体（language="asset"）。此前这类文件只被当作泛化 file
  // 卡片呈现（无专属图标/配色/画像），用户点名「ttf 等文件也要被实体识别」。
  componentRegistry.register({
    type: "asset",
    name: "entityProj.asset.name",
    icon: "font_download",
    description: "entityProj.asset.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 180, height: 60 },
    defaultConfig: {
      filePath: "",
      fileName: "资源文件",
      language: "asset",
      fileSize: 0,
      lineCount: 0,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/AssetRenderer").then(m => ({ default: m.AssetRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 文件夹实体 ──
  componentRegistry.register({
    type: "folder",
    name: "entityProj.folder.name",
    icon: "folder",
    description: "entityProj.folder.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 200, height: 80 },
    defaultConfig: {
      path: "",
      name: "untitled",
      childCount: 0,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: true,
    },
    renderer: lazy(() => import("./renderers/FolderRenderer").then(m => ({ default: m.FolderRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 模块实体 ──
  componentRegistry.register({
    type: "module",
    name: "entityProj.module.name",
    icon: "inventory_2",
    description: "entityProj.module.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 220, height: 100 },
    defaultConfig: {
      name: "",
      path: "",
      fileCount: 0,
      description: "",
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/ModuleRenderer").then(m => ({ default: m.ModuleRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 符号实体（类 / 函数 / 接口）──
  // 这三个类型此前只在分析器插件激活时才经 syncEntityTypes 桥接注册，
  // 任何早于激活的写入（画像/同步）都会因「类型未注册」被静默丢弃。
  // 对齐 biosphere 契约：核心实体启动即同步注册，插件桥接只负责补充语言特有类型。
  componentRegistry.register({
    type: "class",
    name: "entityProj.class.name",
    icon: "class",
    description: "entityProj.class.desc",
    category: "project-entity",
    languages: OOP_CLASS_LANGS,
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 200, height: 64 },
    defaultConfig: {
      name: "",
      symbolKind: "class",
      methods: 0,
      complexity: 0,
      refCount: 0,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/ClassRenderer").then(m => ({ default: m.ClassRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  componentRegistry.register({
    type: "function",
    name: "entityProj.function.name",
    icon: "functions",
    description: "entityProj.function.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 200, height: 64 },
    defaultConfig: {
      name: "",
      symbolKind: "function",
      signature: "",
      complexity: 0,
      refCount: 0,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/FunctionRenderer").then(m => ({ default: m.FunctionRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  componentRegistry.register({
    type: "interface",
    name: "entityProj.interface.name",
    icon: "api",
    description: "entityProj.interface.desc",
    category: "project-entity",
    languages: OOP_INTERFACE_LANGS,
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 200, height: 64 },
    defaultConfig: {
      name: "",
      symbolKind: "interface",
      refCount: 0,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/InterfaceRenderer").then(m => ({ default: m.InterfaceRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 依赖关系边（可视化连线） ──
  // 保留一个占位注册，方便后续拖拽"依赖线"到画布做标注
  componentRegistry.register({
    type: "dependency-edge",
    name: "entityProj.dependencyEdge.name",
    icon: "link",
    description: "entityProj.dependencyEdge.desc",
    category: "project-relation",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 100, height: 20 },
    defaultConfig: {
      sourceId: "",
      targetId: "",
      depType: "import", // import | extends | implements | calls
      weight: 1,
    },
    capabilities: {
      resizable: false,
      rotatable: false,
      draggable: true,
      connectable: false,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/DependencyEdgeRenderer").then(m => ({ default: m.DependencyEdgeRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 设计模式命中实体 ──
  // 需求文档「扫描项目要分析…代码的设计模式」的画布落点：
  // 后端识别出的每条模式命中在画布上就是一个这样的节点，
  // 带分类色条 + 置信度环，悬浮可看完整判定依据。
  componentRegistry.register({
    type: "pattern-node",
    name: "entityProj.patternNode.name",
    icon: "auto_awesome_mosaic",
    description: "entityProj.patternNode.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 210, height: 58 },
    defaultConfig: {
      patternId: "",
      patternName: "entityProj.unknownPattern",
      patternCategory: "behavioral",
      symbolName: "",
      filePath: "",
      line: 0,
      confidence: 0.5,
      signals: [],
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: true,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/PatternNodeRenderer").then(m => ({ default: m.PatternNodeRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 架构分层标记 ──
  componentRegistry.register({
    type: "layer-marker",
    name: "entityProj.layerMarker.name",
    icon: "layers",
    description: "entityProj.layerMarker.desc",
    category: "project-relation",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 300, height: 40 },
    defaultConfig: {
      layerName: "entityProj.unnamedLayer",
      layerColor: "#6366f1",
      layerOrder: 0,
    },
    capabilities: {
      resizable: false,
      rotatable: false,
      draggable: true,
      connectable: false,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/LayerMarkerRenderer").then(m => ({ default: m.LayerMarkerRenderer }))),
    dataSchema: { sourceType: "static" },
  });

  // ── 耦合矩形树图单元格 ──
  // 耦合画像（treemap 形态）的承载实体：面积=模块文件数，颜色=耦合 zone。
  // 紧凑色块、无卡片边框，紧密平铺。draggable=false 配合全局禁拖（v2.18）。
  componentRegistry.register({
    type: "treemap-cell",
    name: "entityProj.treemapCell.name",
    icon: "view_module",
    description: "entityProj.treemapCell.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 200, height: 100 },
    defaultConfig: {
      name: "",
      fileCount: 0,
      depCount: 0,
      beDepCount: 0,
      zone: "normal",
    },
    capabilities: {
      resizable: false,
      rotatable: false,
      draggable: false,
      connectable: false,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/TreemapCellRenderer").then(m => ({ default: m.TreemapCellRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });

  // ── 重构四象限背景分区（v2.31 修复） ──
  // v2.29 新增 quadrant-zone-bg 渲染器并接入 SceneEditor 的 RENDERERS 静态表，
  // 却漏在 componentRegistry 注册 —— 导致 addComponentsBulk 因「类型未注册」静默丢弃
  // 全部四象限背景色块（详见 editorStore.addComponentsBulk 的 skippedTypes 守卫）。
  // 后果：散点节点照常渲染，但整张图缺失四象限分区边界，用户无法判断「右上=优先重构」，
  // 视觉可读性崩坏、被误判「不能用」。此处补齐注册，背景区现在能正常落库与渲染。
  componentRegistry.register({
    type: "quadrant-zone-bg",
    name: "entityProj.quadrantZoneBg.name",
    icon: "grid_view",
    description: "entityProj.quadrantZoneBg.desc",
    category: "project-relation",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 590, height: 360 },
    defaultConfig: {
      zoneColor: "#94a3b8",
      zoneKey: "healthy",
    },
    capabilities: {
      resizable: false,
      rotatable: false,
      draggable: false,
      connectable: false,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/QuadrantZoneBgRenderer").then(m => ({ default: m.QuadrantZoneBgRenderer }))),
    dataSchema: { sourceType: "static" },
  });

  // ── 重构四象限坐标轴 + 刻度数值 + 公式（v2.41） ──
  // 与 quadrant-zone-bg 配套：背景分区负责「四象限色块」，本组件负责「十字坐标轴 +
  // 5 档刻度线 + 真实数值 + 轴名 + 秩百分位公式」。二者都 pointer-events:none，
  // 不拦截 file 节点的选中/双击跳源码。quadrant-axis 在 runQuadrantPortrait 里最后放置，
  // 覆盖在 file 节点之上保证刻度数值可读。registered 后才不会被 addComponentsBulk 静默丢弃。
  componentRegistry.register({
    type: "quadrant-axis",
    name: "entityProj.quadrantAxis.name",
    icon: "show_chart",
    description: "entityProj.quadrantAxis.desc",
    category: "project-relation",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 780, height: 720 },
    defaultConfig: {
      xTicks: [],
      yTicks: [],
      xTitle: "",
      yTitle: "",
      formula: "",
    },
    capabilities: {
      resizable: false,
      rotatable: false,
      draggable: false,
      connectable: false,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/QuadrantAxisRenderer").then(m => ({ default: m.QuadrantAxisRenderer }))),
    dataSchema: { sourceType: "static" },
  });

  // ── 基础标注组件（保留自 biosphere，对项目分析也有用） ──
  componentRegistry.register({
    type: "annotation-text",
    name: "entityProj.annotationText.name",
    icon: "text_fields",
    description: "entityProj.annotationText.desc",
    category: "annotation",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 200, height: 60 },
    defaultConfig: {
      content: "标注文本",
      fontSize: 14,
      color: "#374151",
      textAlign: "left",
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: false,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/ProjectAnnotationRenderer").then(m => ({ default: m.ProjectAnnotationRenderer }))),
    dataSchema: { sourceType: "static" },
  });

  // ── 代码块预览 ──
  componentRegistry.register({
    type: "code-preview",
    name: "entityProj.codePreview.name",
    icon: "code",
    description: "entityProj.codePreview.desc",
    category: "project-entity",
    version: "1.0.0",
    builtIn: true,
    enabled: true,
    defaultSize: { width: 400, height: 300 },
    defaultConfig: {
      content: "// 选择文件后显示代码",
      language: "typescript",
      maxLines: 50,
    },
    capabilities: {
      resizable: true,
      rotatable: false,
      draggable: true,
      connectable: false,
      embeddable: false,
    },
    renderer: lazy(() => import("./renderers/CodePreviewRenderer").then(m => ({ default: m.CodePreviewRenderer }))),
    dataSchema: { sourceType: "dynamic" },
  });
}
