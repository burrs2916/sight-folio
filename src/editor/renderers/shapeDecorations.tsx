// sight-folio: 实体类型形状装饰层（R 形状语言）
//
// 与 shellStyle 配合：shellStyle 给类型专属圆角，本组件再叠加 silhouette 细节
// （折角 / 标签 / 层叠 / 分隔线 / lollipop）。全部用绝对定位 div + inline style，
// 画在卡片内边界内（不触发 shellStyle 的 overflow:hidden 裁切），零 emotion、
// 零额外重渲染 —— 与 R37 零 Emotion 高性能基线一致。
//
// 所有装饰都 pointerEvents:none，不拦截卡片上的点击（双击定位 / 角标点击等）。
import type { EntityShape } from "./canvasTheme";

/** 画布底色 CSS 变量（明暗主题自动跟随），折角用它与背景同色模拟"翻折" */
const CANVAS_BG = "var(--template-palette-background-default, #ffffff)";

export function ShapeDecorations({ shape, color }: { shape: EntityShape; color: string }) {
  if (shape === "file") {
    // 右上折角（dog-ear）：用背景色三角盖住一角，读作文档翻折
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 0,
          height: 0,
          borderStyle: "solid",
          borderWidth: "0 15px 15px 0",
          borderColor: `transparent ${CANVAS_BG} transparent transparent`,
          pointerEvents: "none",
        }}
      />
    );
  }
  if (shape === "folder") {
    // 顶部标签：容器语义
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 9,
          width: 42,
          height: 8,
          borderRadius: "5px 5px 0 0",
          background: color,
          opacity: 0.85,
          pointerEvents: "none",
        }}
      />
    );
  }
  if (shape === "module") {
    // 背后错位描边：层叠语义（聚合多个文件）
    return (
      <div
        style={{
          position: "absolute",
          right: 5,
          bottom: 5,
          left: 5,
          top: 5,
          borderRadius: 9,
          border: `1px solid ${color}55`,
          opacity: 0.55,
          pointerEvents: "none",
        }}
      />
    );
  }
  if (shape === "class") {
    // 两段横向分隔线：UML 类名/属性/方法三区
    return (
      <>
        <div style={{ position: "absolute", left: 0, right: 0, top: "38%", height: 1, background: `${color}55`, pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: "70%", height: 1, background: `${color}55`, pointerEvents: "none" }} />
      </>
    );
  }
  if (shape === "interface") {
    // 左侧 lollipop：圆点 + 引线（UML 接口符号）
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 5,
            top: "50%",
            width: 15,
            height: 15,
            marginTop: -7.5,
            borderRadius: "50%",
            border: `2px solid ${color}`,
            background: "var(--template-palette-background-paper, #ffffff)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "absolute", left: 19, top: "50%", width: 7, height: 2, marginTop: -1, background: color, pointerEvents: "none" }} />
      </>
    );
  }
  // function = 全胶囊（仅靠 shellStyle 的 999px 圆角实现），无需额外装饰
  return null;
}
