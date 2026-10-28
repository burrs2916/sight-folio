import { CV } from "./canvasTheme";

interface QuadrantZoneBgRendererProps {
  config?: {
    /** 象限配色（QUADRANT_META 的 color，#RRGGBB） */
    zoneColor?: string;
    zoneKey?: string;
    [key: string]: unknown;
  };
}

/**
 * 重构四象限画像的底层背景分区（v2.29）。
 *
 * 散点图若无分区边界，用户无法一眼判断「右上角=优先重构」。此渲染器在四个象限
 * 各铺一块半透明色区，让「高复杂×高变更」等分区肉眼可辨，直接回答「先重构谁」。
 *
 * 命中测试：pointer-events:none —— 背景区永远不拦截点击，file 节点在上方照常可选中/
 * 双击跳源码，象限聚焦由 layer-marker 标签触发（见 SceneEditor.tsx onClick 分支）。
 */
export function QuadrantZoneBgRenderer(props: QuadrantZoneBgRendererProps) {
  const config = props?.config ?? {};
  const color = config.zoneColor || "#94a3b8";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        background: `${color}14`,
        border: `1px solid ${color}40`,
        borderRadius: 6,
        pointerEvents: "none",
      }}
      aria-hidden
    >
      <span style={{ display: "none" }}>{config.zoneKey ?? ""}</span>
      {/* 纯背景装饰，无内容；CV 仅用于保持与画布其他渲染器一致的变量引用风格 */}
      <span style={{ display: "none" }}>{CV.divider}</span>
    </div>
  );
}
