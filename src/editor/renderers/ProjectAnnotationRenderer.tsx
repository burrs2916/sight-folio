import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { t } from "../../i18n";

interface ProjectAnnotationRendererProps {
  config?: {
    content?: string;
    fontSize?: number;
    color?: string;
    /** "frame" = 带边框的分组容器（模块下钻子图外框），默认为纯文本标注 */
    variant?: string;
    title?: string;
    text?: string;
    [key: string]: unknown;
  };
}

/**
 * 标注实体。两种形态：
 * - 默认：纯文字标注（沿用 biosphere 行为）
 * - variant="frame"：分组容器 —— 虚线圆角框 + 顶部标题条，用于模块下钻子图的
 *   外框，让「这一坨实体属于同一个模块」在画布上一眼可辨。
 *
 * config 必须有默认值：画布 / 实体管理预览 / 画像面板多条路径共用渲染器，
 * 任何一路传空都不能崩（项目级约定）。
 */
export function ProjectAnnotationRenderer(props: ProjectAnnotationRendererProps) {
  const _config = props?.config;
  const config = _config ?? {};
  if (config.variant === "frame") {
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          borderRadius: 1.5,
          border: "1.5px dashed",
          borderColor: "primary.main",
          backgroundColor: (t) =>
            t.palette.mode === "dark" ? "rgb(var(--template-palette-primary-mainChannel) / 0.06)" : "rgb(var(--template-palette-primary-mainChannel) / 0.04)",
          boxSizing: "border-box",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.75,
            px: 1,
            py: 0.25,
            m: 0.5,
            borderRadius: 1,
            backgroundColor: "primary.main",
            color: "primary.contrastText",
            maxWidth: "calc(100% - 8px)",
          }}
        >
          <Typography
            variant="caption"
            sx={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {config.text || config.title || config.content || t("editor.annotationGroup")}
          </Typography>
        </Box>
      </Box>
    );
  }

  // 预览区安全兜底：config 为空时展示示例标注（避免全黑空壳）
  const displayText = config.content || config.text || "";
  const isDemo = !displayText;

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        px: 1.5,
        py: 0.75,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        overflow: "hidden",
        // 演示模式：左侧引用线 + 浅底，一眼看出是"标注"
        borderLeft: isDemo ? "3px solid" : "none",
        borderColor: isDemo ? "warning.main" : "transparent",
        bgcolor: isDemo ? "rgba(234,179,8,0.08)" : "transparent",
      }}
    >
      {isDemo && (
        <Box
          component="span"
          sx={{
            width: 18,
            height: 14,
            borderRadius: 1,
            border: "1.5px dashed",
            borderColor: "warning.main",
            flexShrink: 0,
          }}
        />
      )}
      <Typography
        variant="body2"
        sx={{
          fontSize: config.fontSize || (isDemo ? 13 : 14),
          color: config.color || (isDemo ? "text.primary" : "text.primary"),
          fontWeight: isDemo ? 500 : 400,
          opacity: isDemo ? 0.8 : 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {isDemo ? t("editor.annotationDemo") : displayText}
      </Typography>
    </Box>
  );
}
