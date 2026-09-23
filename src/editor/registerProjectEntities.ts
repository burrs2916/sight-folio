import { componentRegistry, lazy } from "./registryCore";

/**
 * 注册内置通用实体类型（Sight Folio = 小说写作平台）。
 *
 * 业务收口：只注册写作业务需要的通用实体 —— file / folder / image / asset /
 * annotation-text（画布标注）。代码分析专属类型（module/class/function/interface/
 * dependency-edge/layer-marker/pattern-node/treemap-cell/quadrant-zone-bg/
 * quadrant-axis/code-preview）不再注册，与写作业务无关；
 * 渲染器源码保留在 renderers/ 下，需要恢复代码分析时把对应 register 块加回。
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

}
