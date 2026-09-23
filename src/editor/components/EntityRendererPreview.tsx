// sight-folio: 实体渲染器预览（通用组件）
// 用实体自身的渲染器（SVG 矢量）渲染真实外观 —— 与场景画布一致：
// 实体在画布上长什么样，这里就长什么样；config 一变 SVG 跟着变，完全动态。
// 静态映射覆盖核心实体，其余类型通过 rendererCache 动态加载插件渲染器。
import { useEffect, useState, Component, type ReactNode } from "react";
import Box from "@mui/material/Box";
import { FileRenderer } from "../renderers/FileRenderer";
import { FolderRenderer } from "../renderers/FolderRenderer";
import { ModuleRenderer } from "../renderers/ModuleRenderer";
import { ClassRenderer } from "../renderers/ClassRenderer";
import { FunctionRenderer } from "../renderers/FunctionRenderer";
import { InterfaceRenderer } from "../renderers/InterfaceRenderer";
import { DependencyEdgeRenderer } from "../renderers/DependencyEdgeRenderer";
import { LayerMarkerRenderer } from "../renderers/LayerMarkerRenderer";
import { ProjectAnnotationRenderer } from "../renderers/ProjectAnnotationRenderer";
import { CodePreviewRenderer } from "../renderers/CodePreviewRenderer";
import { PatternNodeRenderer } from "../renderers/PatternNodeRenderer";
import { ImageRenderer } from "../renderers/ImageRenderer";
import { AssetRenderer } from "../renderers/AssetRenderer";
import { TreemapCellRenderer } from "../renderers/TreemapCellRenderer";
import { QuadrantAxisRenderer } from "../renderers/QuadrantAxisRenderer";
import {
  WritingChapterRenderer,
  WritingCharacterRenderer,
  WritingOutlineRenderer,
  WritingWorldviewRenderer,
} from "../renderers/WritingEntityRenderer";
import { rendererCache } from "../plugins/PluginLoader";
import { resolveEntityIcon } from "../entityIconMap";

/** 核心实体 → 渲染器静态映射（与场景画布 RENDERERS 一致，含代码符号专属渲染器）
 *
 * Rust 特有类型（crate/struct/trait）映射到形状语义最接近的通用渲染器，
 * 使预览区能体现形状语言差异（layer=层叠/class=三段框/interface=胶囊+lollipop），
 * 而不是全部落到加载失败的 spinner fallback。
 */
const STATIC_RENDERERS: Record<string, React.ComponentType<any>> = {
  file: FileRenderer,
  folder: FolderRenderer,
  module: ModuleRenderer,
  class: ClassRenderer,
  function: FunctionRenderer,
  interface: InterfaceRenderer,
  // ── Rust / 多语言共享类型（无独立渲染器，复用形状近似的通用渲染器）──
  crate: ModuleRenderer,       // 编译单元 → 层叠容器形状
  struct: ClassRenderer,       // 数据聚合 → 三段框（与 class 区分靠颜色+语义标签）
  trait: InterfaceRenderer,    // 行为契约 → 胶囊 + lollipop
  // ── 分析元素 ──
  "dependency-edge": DependencyEdgeRenderer,
  "layer-marker": LayerMarkerRenderer,
  "annotation-text": ProjectAnnotationRenderer,
  "code-preview": CodePreviewRenderer,
  "pattern-node": PatternNodeRenderer,
  // ── 图片资源（内置实体，不在插件 rendererCache 中，必须静态覆盖否则预览卡转圈）──
  image: ImageRenderer,
  // ── 资源文件（字体/媒体/压缩/二进制，与图片同源：必须静态覆盖否则预览卡转圈/落占位）──
  asset: AssetRenderer,
  // ── 耦合矩形树图单元格（treemap 画像承载实体）──
  "treemap-cell": TreemapCellRenderer,
  // ── 重构四象限坐标轴（v2.41）：与画布 RENDERERS 一致，避免预览区落占位 ──
  "quadrant-axis": QuadrantAxisRenderer,
  // ── 写作实体（H1）：与 SceneEditor 画布 RENDERERS 对齐 —— 图鉴预览直接
  //    显示真实写作卡片外观，而不是走 rendererCache 异步加载转圈/落代码形状 ──
  "writing-chapter": WritingChapterRenderer,
  "writing-character": WritingCharacterRenderer,
  "writing-outline": WritingOutlineRenderer,
  "writing-worldview": WritingWorldviewRenderer,
};

interface EntityRendererPreviewProps {
  /** 实体类型（file/module/class…） */
  type: string;
  /**
   * 插件声明的 icon 名。渲染器缺失/崩溃时的占位图标按它解析 ——
   * 此前这里把 type 当 icon 名查表，struct/trait/crate 一律落空退成通用图标，
   * 表现为"实体管理里这几种实体没有图标"。
   */
  icon?: string;
  /** 实体 config（fileName/language/lineCount…） */
  config?: Record<string, unknown>;
  /** 预览容器宽（px） */
  width?: number;
  /** 预览容器高（px） */
  height?: number;
  /** 渲染内容缩放（迷你预览用，如 0.6 缩小展示） */
  scale?: number;
  /** 容器圆角 */
  borderRadius?: number;
  /** 深色展示底（模拟画布视觉），默认 true */
  darkBackground?: boolean;
  /** 渲染器接收的额外 props（如 dependency-edge 的 from/to 坐标） */
  extraProps?: Record<string, unknown>;
}

/** 渲染器崩溃兜底：捕获子渲染器的 render error，显示图标占位 */
class RendererErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function EntityRendererPreview({
  type,
  icon,
  config,
  width = 200,
  height = 90,
  scale = 1,
  borderRadius = 8,
  darkBackground = true,
  extraProps,
}: EntityRendererPreviewProps) {
  const StaticRenderer = STATIC_RENDERERS[type];
  const [DynamicRenderer, setDynamicRenderer] = useState<React.ComponentType<any> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (StaticRenderer) return; // 静态映射已覆盖，无需动态加载
    let cancelled = false;
    setLoadFailed(false);
    rendererCache
      .load(type)
      .then((r) => {
        if (cancelled) return;
        // 关键：不能写 setDynamicRenderer(r) —— r 是函数组件，React 会把它当
        // functional updater 调用 r(prevState)，prevState=null 时渲染器读
        // props.config 直接抛 TypeError（/entities 页白屏根因）。
        // 与 EditorCanvasComponent 的 setRenderer(() => cached) 同一约定。
        setDynamicRenderer(() => r);
        if (!r) setLoadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [type, StaticRenderer]);

  const rawRenderer = StaticRenderer ?? DynamicRenderer;
  // 运行时校验：确保 Renderer 是合法的 React 组件（function），
  // 过滤掉 object / JSX literal / undefined 等非法值，
  // 避免 "React.jsx: type is invalid" 崩溃。
  const Renderer = (rawRenderer && typeof rawRenderer === "function") ? rawRenderer : null;

  return (
    <Box
      sx={{
        width,
        height,
        borderRadius,
        overflow: "hidden",
        flexShrink: 0,
        background: darkBackground
          ? "linear-gradient(180deg, #0d1b2a 0%, #101827 60%, #16202f 100%)"
          : "transparent",
        boxShadow: darkBackground ? "inset 0 0 0 1px rgba(255,255,255,0.08)" : "inset 0 0 0 1px rgba(0,0,0,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      {Renderer ? (
        <RendererErrorBoundary
          fallback={
            <Box sx={{ color: "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.6 }}>
              {resolveEntityIcon(icon, 22, type)}
            </Box>
          }
        >
          <Box
            sx={{
              transform: `scale(${scale})`,
              transformOrigin: "center",
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* 注意：extraProps 先展开、config 最后传 —— 保证调用方即使传了
                extraProps.config 也不会覆盖（config 兜底 {} 始终生效）。 */}
            <Renderer
              {...extraProps}
              config={(config || {}) as any}
              width={width}
              height={height}
            />
          </Box>
        </RendererErrorBoundary>
      ) : loadFailed ? (
        <Box sx={{ color: "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.6 }}>
          {resolveEntityIcon(icon, 22, type)}
        </Box>
      ) : (
        <Box sx={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.5)", animation: "ps-spin 0.8s linear infinite" }}>
          <style>{`@keyframes ps-spin { to { transform: rotate(360deg) } }`}</style>
        </Box>
      )}
    </Box>
  );
}
