import { CV } from "./canvasTheme";

interface QuadrantTick {
  /** 刻度在画布框内的横向/纵向比例（0~1），由 portraits.ts 按节点中心映射计算 */
  frac: number;
  /** 该百分位对应的真实数值文本 */
  label: string;
}

interface QuadrantAxisRendererProps {
  config?: {
    xTicks?: QuadrantTick[];
    yTicks?: QuadrantTick[];
    /** 横轴短名（如「Git 变更频率」），含单位语义 */
    xTitle?: string;
    /** 纵轴短名（如「圈复杂度」） */
    yTitle?: string;
    /** 坐标公式说明（秩百分位），回答「坐标怎么来的」 */
    formula?: string;
    /** 行动指引（如「右上角 = 优先重构」），是象限图最核心的可行动结论 */
    hint?: string;
    [key: string]: unknown;
  };
}

/**
 * 重构四象限画像的「坐标轴 + 刻度数值 + 公式」渲染器（v2.41）。
 *
 * 旧象限只有四块彩色背景 + 节点芯片，**没有任何轴线和刻度**，用户看到底部一行
 * 轴公式文字却无对应坐标/数值，体感「不完整 / 不像象限」。本渲染器一次性画出：
 *   1. 十字坐标轴（落在四象限中线上，与 quadrant-zone-bg 的分区边界严格对齐）；
 *   2. 横/纵各 5 档刻度线 + 真实数值（由 portraits.ts 按百分位取真实度量值）；
 *   3. 轴名（横轴维度 + 纵轴维度）+ 秩百分位公式说明。
 *
 * 被 `place("quadrant-axis", ...)` 作为最后绘制的组件（覆盖在 file 节点之上），
 * 但 `pointer-events:none` —— 永远不拦截点击，file 节点的选中/双击跳源码不受影响。
 */
export function QuadrantAxisRenderer(props: QuadrantAxisRendererProps) {
  const config = props?.config ?? {};
  const xTicks = config.xTicks ?? [];
  const yTicks = config.yTicks ?? [];
  const xTitle = config.xTitle ?? "";
  const yTitle = config.yTitle ?? "";
  const formula = config.formula ?? "";
  const hint = config.hint ?? "";

  const axisColor = "rgba(148,163,184,0.55)"; // 十字坐标轴（比 divider 略强，明确分隔四象限）
  const tickColor = "rgba(148,163,184,0.85)";
  const labelBg = CV.paper;
  const labelColor = CV.text2;
  const titleColor = CV.text;
  const formulaColor = CV.text3;

  const labelBase: React.CSSProperties = {
    position: "absolute",
    background: labelBg,
    color: labelColor,
    fontSize: 9,
    lineHeight: 1.2,
    fontWeight: 600,
    padding: "1px 3px",
    borderRadius: 3,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    boxShadow: `0 0 0 1px ${CV.divider}`,
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        pointerEvents: "none",
        overflow: "visible",
      }}
      aria-hidden
    >
      {/* 十字坐标轴：落在象限中线上，与 quadrant-zone-bg 的分区边界对齐 */}
      <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: axisColor }} />
      <div style={{ position: "absolute", top: "50%", left: 0, height: 1, width: "100%", background: axisColor }} />

      {/* 横轴刻度 + 数值（沿中线向下标注） */}
      {xTicks.map((tk, i) => (
        <div key={`x${i}`}>
          <div
            style={{
              position: "absolute",
              left: `calc(${tk.frac * 100}% - 0.5px)`,
              top: "calc(50% - 4px)",
              width: 1,
              height: 8,
              background: tickColor,
            }}
          />
          <div style={{ ...labelBase, left: `${tk.frac * 100}%`, top: "calc(50% + 7px)", transform: "translateX(-50%)" }}>
            {tk.label}
          </div>
        </div>
      ))}

      {/* 纵轴刻度 + 数值（沿中线向右标注） */}
      {yTicks.map((tk, i) => (
        <div key={`y${i}`}>
          <div
            style={{
              position: "absolute",
              left: "calc(50% - 4px)",
              top: `calc(${tk.frac * 100}% - 0.5px)`,
              width: 8,
              height: 1,
              background: tickColor,
            }}
          />
          <div style={{ ...labelBase, left: "calc(50% + 7px)", top: `${tk.frac * 100}%`, transform: "translateY(-50%)" }}>
            {tk.label}
          </div>
        </div>
      ))}

      {/* 横轴名（底部居中） */}
      {xTitle ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 2,
            transform: "translateX(-50%)",
            color: titleColor,
            fontSize: 10,
            fontWeight: 700,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            textShadow: `0 0 3px ${labelBg}, 0 0 3px ${labelBg}`,
          }}
        >
          {xTitle}
        </div>
      ) : null}

      {/* 纵轴名（左侧居中，竖排） */}
      {yTitle ? (
        <div
          style={{
            position: "absolute",
            left: 4,
            top: "50%",
            transform: "translateY(-50%) rotate(-90deg)",
            transformOrigin: "center",
            color: titleColor,
            fontSize: 10,
            fontWeight: 700,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            textShadow: `0 0 3px ${labelBg}, 0 0 3px ${labelBg}`,
          }}
        >
          {yTitle}
        </div>
      ) : null}

      {/* 坐标公式说明（左上角，回答「坐标怎么来的」） */}
      {formula ? (
        <div
          style={{
            position: "absolute",
            left: 6,
            top: 4,
            maxWidth: "60%",
            color: formulaColor,
            fontSize: 8.5,
            lineHeight: 1.25,
            fontWeight: 500,
            whiteSpace: "normal",
            pointerEvents: "none",
            background: `${labelBg}`,
            padding: "2px 4px",
            borderRadius: 4,
            boxShadow: `0 0 0 1px ${CV.divider}`,
          }}
        >
          {formula}
        </div>
      ) : null}

      {/* 行动指引（右上角，象限图最核心的可行动结论：右上=优先重构） */}
      {hint ? (
        <div
          style={{
            position: "absolute",
            right: 6,
            top: 4,
            maxWidth: "45%",
            textAlign: "right",
            color: "#EF9F27",
            fontSize: 9,
            lineHeight: 1.2,
            fontWeight: 700,
            whiteSpace: "normal",
            pointerEvents: "none",
            background: `${labelBg}`,
            padding: "2px 5px",
            borderRadius: 4,
            boxShadow: `0 0 0 1px ${CV.divider}`,
          }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}
