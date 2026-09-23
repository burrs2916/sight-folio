// sight-folio: 实体渲染器的 LOD 降级卡片（R37 卡顿攻坚）
//
// 所有项目实体（module / class / function / interface / folder …）在缩小档位
// 下的形态是同一套：`compact` = 色条 + 名字 + 可选风险点，`block` = 纯色块。
// 抽成一个函数，好处不只是省代码 —— 更重要的是**保证换档时视觉语言一致**：
// 用户缩小画布时，不该出现「模块变成了色块、类却还画着两行字」这种参差。
//
// 用法：在渲染器最前面加一行
//   const stub = lodStub(lod, { name, accent });
//   if (stub) return stub;
// `full` 档返回 null，渲染器照常走原有完整分支。

import type { CanvasLod } from "../utils/lod";
import { BODY_STYLE, CV, TITLE_BOLD_STYLE, dotStyle, shellStyle, stripeStyle } from "./canvasTheme";

export interface LodStubOptions {
  /** 实体名（compact 档唯一保留的文字） */
  name: string;
  /** 主色：色条颜色，block 档的底色也由它派生 */
  accent: string;
  /** 卡片底色（缺省用 paper） */
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  /** 原生 title 提示（缺省用 name） */
  title?: string;
  /** compact 档右上角风险点颜色；null/省略则不画 */
  riskColor?: string | null;
  opacity?: number;
  /**
   * 第二行小字（R39）：路径/指标行。画布全览时实体的完整信息大多靠这行
   * 辨认 —— 「哪个目录哪个文件」。compact 档高度允许两行文字。
   */
  subtitle?: string;
}

/**
 * 按 LOD 档位返回降级卡片；`full` 档返回 null（调用方继续画完整卡片）。
 */
export function lodStub(lod: CanvasLod | undefined, opts: LodStubOptions) {
  if (lod === undefined || lod === "full") return null;

  const title = opts.title ?? opts.name;

  // block 档：卡片实际高度常常只剩 8~12px，任何文字都会糊成灰条。
  // 退化成色块反而更有效 —— 全览时用户找的是「哪一片颜色不对」。
  // R39：底色 0.27 → 0.40 透明度加深，边框也更实 —— 用户反馈色块「太虚」。
  if (lod === "block") {
    return (
      <div
        title={title}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          borderRadius: 2,
          border: `${opts.borderWidth ?? 1.5}px ${opts.borderStyle ?? "solid"} ${opts.borderColor ?? opts.accent}`,
          background: `${opts.accent}66`,
          opacity: opts.opacity,
        }}
      />
    );
  }

  return (
    <div
      title={title}
      style={shellStyle({
        background: opts.background ?? CV.paper,
        borderColor: opts.borderColor ?? opts.accent,
        borderWidth: opts.borderWidth,
        borderStyle: opts.borderStyle,
        opacity: opts.opacity,
      })}
    >
      <div style={stripeStyle(opts.accent, 1)} />
      <div style={BODY_STYLE}>
        <div style={TITLE_BOLD_STYLE}>{opts.name}</div>
        {opts.subtitle && (
          <div
            style={{
              fontSize: 9,
              lineHeight: 1.3,
              color: CV.text2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}
          >
            {opts.subtitle}
          </div>
        )}
      </div>
      {opts.riskColor && <div style={dotStyle(opts.riskColor, { top: 3, right: 3 })} />}
    </div>
  );
}
