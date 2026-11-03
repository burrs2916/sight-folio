import SmartToyIcon from '@mui/icons-material/SmartToy';

/**
 * AI 唯一视觉标识（G4：让用户明确知道在哪里调用 AI）。
 *
 * 此前 AI 入口图标/颜色不统一（SmartToy / Psychology / AutoAwesome / AutoFixHigh 混用，
 * 主蓝 #2a5688 与靛紫并存），用户难以形成"这就是 AI"的稳定认知。这里集中定义，
 * 所有 AI 入口（顶栏按钮 / 画布 Fab / 文件树入口 / 既有导航项与 tab）统一复用：
 *   - 图标：SmartToyIcon（AI 本体，区别于诊断动作 AutoFixHigh）
 *   - 配色：靛紫渐变 #4f46e5 → #7c3aed（"AI 辅助"语义，区别于主色 brand 蓝；
 *     较原 #6366f1 → #8b5cf6 整体加深一档，保证按钮白字 ≥4.5:1）
 *
 * 诊断动作（针对具体问题的"修"）仍用 AutoFixHigh，与"AI 助手"本体区分开。
 *
 * 归属：这组颜色是**语义 / 品牌标识**，刻意不随外观预设（主题皮肤）联动 ——
 * 换皮肤时 AI 入口必须仍是同一抹靛紫，否则用户"在哪调用 AI"的稳定认知会被打断。
 * 因此禁止把本文件的常量替换成 var(--template-palette-primary-*)。
 */
export const AI_GRADIENT = 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)';
/** 暗色模式下的 AI 渐变（主色提亮一档，保证暗背景下文字可读） */
export const AI_GRADIENT_DARK = 'linear-gradient(135deg, #818cf8, #a78bfa)';
export const AI_COLOR = '#6366f1';
export const AI_COLOR_END = '#8b5cf6';
export const AI_ICON = SmartToyIcon;

/** 常驻 AI 按钮样式（顶栏 pill / 画布圆形 Fab 复用，保证视觉一致） */
export const aiButtonSx = {
  background: AI_GRADIENT,
  color: '#fff',
  border: 'none',
  textTransform: 'none' as const,
  '&:hover': { background: AI_GRADIENT, filter: 'brightness(1.08)' },
};
