// 画布静态渲染器表 + 未映射类型兜底
// 画布节点只查 RENDERERS，漏了就是 UnknownTypeFallback 红框（对齐 biosphere FallbackRenderer 契约）
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {FileRenderer} from "../renderers/FileRenderer";
import {ImageRenderer} from "../renderers/ImageRenderer";
import {AssetRenderer} from "../renderers/AssetRenderer";
import {FolderRenderer} from "../renderers/FolderRenderer";
import {ModuleRenderer} from "../renderers/ModuleRenderer";
import {ClassRenderer} from "../renderers/ClassRenderer";
import {FunctionRenderer} from "../renderers/FunctionRenderer";
import {InterfaceRenderer} from "../renderers/InterfaceRenderer";
import {DependencyEdgeRenderer} from "../renderers/DependencyEdgeRenderer";
import {LayerMarkerRenderer} from "../renderers/LayerMarkerRenderer";
import {ProjectAnnotationRenderer} from "../renderers/ProjectAnnotationRenderer";
import {CodePreviewRenderer} from "../renderers/CodePreviewRenderer";
import {PatternNodeRenderer} from "../renderers/PatternNodeRenderer";
import {TreemapCellRenderer} from "../renderers/TreemapCellRenderer";
import {QuadrantZoneBgRenderer} from "../renderers/QuadrantZoneBgRenderer";
import {QuadrantAxisRenderer} from "../renderers/QuadrantAxisRenderer";
import {WritingChapterRenderer, WritingCharacterRenderer, WritingOutlineRenderer, WritingWorldviewRenderer} from "../renderers/WritingEntityRenderer";
import {WritingWorkbenchRenderer} from "../renderers/WritingWorkbenchRenderer";
import {WritingDocsRenderer} from "../renderers/WritingDocsRenderer";
import {WritingStudioPane} from "../renderers/WritingStudioPane";
import {t} from "../../i18n";

export const RENDERERS: Record<string, any> = {
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
  // 写作实体（H1 全书总览板）：章节/人物/卷头/世界观。书=场景后画布会真实
  // 摆这些实体，缺了落红框兜底。
  "writing-chapter": WritingChapterRenderer,
  "writing-character": WritingCharacterRenderer,
  "writing-outline": WritingOutlineRenderer,
  "writing-worldview": WritingWorldviewRenderer,
  // 载体工作台（工作室重构 P1）：拖「载体」落下的大尺寸可编辑纸面卡
  "writing-workbench": WritingWorkbenchRenderer,
  // 正文容器（G3）：L3 卷/章节文档页签 + 正文编辑区，铺满画布的固定卡。
  // 此前**漏在本静态表**里 → 该卡一直落 UnknownTypeFallback 红框，
  // 「正文视图里没有编辑区」的真因就在这（与 asset 漏注册同一形态）。
  "writing-docs": WritingDocsRenderer,
  // L2 题材编辑面（2026-09-12）：大纲 / 人物设定 / 世界观视图里的铺满编辑面，
  // 就地读写 writing_chapters / writing_outlines / writing_settings。
  "writing-studio-pane": WritingStudioPane,
};

/**
 * 未映射类型的可见兜底（对齐 biosphere FallbackRenderer 契约）。
 * 此前 RENDERERS 查不到直接 return null —— 实体存在却凭空隐形，
 * 既无日志也无占位，是「渲染不出来」类问题最难排查的形态。
 * 现在红虚线框 + 类型名当场暴露缺口：补渲染器或补注册即可。
 */
export function UnknownTypeFallback({ type }: { type: string }) {
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
