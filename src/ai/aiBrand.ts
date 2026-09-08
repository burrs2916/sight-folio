import SmartToyIcon from "@mui/icons-material/SmartToy";

/**
 * AI 唯一视觉标识（G4：让用户明确知道在哪里调用 AI）。
 *
 * 此前 AI 入口图标/颜色不统一（SmartToy / Psychology / AutoAwesome / AutoFixHigh 混用，
 * 主蓝 #2a5688 与靛紫并存），用户难以形成"这就是 AI"的稳定认知。这里集中定义，
 * 所有 AI 入口（顶栏按钮 / 画布 Fab / 文件树入口 / 既有导航项与 tab）统一复用：
 *   - 图标：SmartToyIcon（AI 本体，区别于诊断动作 AutoFixHigh）
 *   - 配色：靛紫渐变 #6366f1 → #8b5cf6（"AI 辅助"语义，区别于主色 brand 蓝）
 *
 * 诊断动作（针对具体问题的"修"）仍用 AutoFixHigh，与"AI 助手"本体区分开。
 */
export const AI_GRADIENT = "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)";
export const AI_COLOR = "#6366f1";
export const AI_COLOR_END = "#8b5cf6";
export const AI_ICON = SmartToyIcon;

/** 常驻 AI 按钮样式（顶栏 pill / 画布圆形 Fab 复用，保证视觉一致） */
export const aiButtonSx = {
  background: AI_GRADIENT,
  color: "#fff",
  border: "none",
  textTransform: "none" as const,
  "&:hover": { background: AI_GRADIENT, filter: "brightness(1.08)" },
};
