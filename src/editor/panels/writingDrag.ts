// 写作拖拽协议（右栏「创作组件」面板 / 左栏载体库共用，抽出避免两处各写一份）
//
// 载荷两条 MIME（SceneEditor.handleDrop 消费）：
//   application/x-project-entity      → 组件类型，落点据此决定建什么
//   application/x-project-entity-data → JSON {name, config}
//     - config.__blank === true → 落点先走 createBlankWritingEntity **真建档**
//       （章节/人物/世界观；失败降级为壳卡并 toast，绝不静默）
//     - payload 缺失/损坏 → 按旧链路只建类型壳，零回归
//
// ghost 自绘：浏览器默认 ghost 是半透明小块，从侧栏拖出时看不清在拖什么。
// setDragImage 要求元素在 DOM 里：dragstart 同步设置后下一帧移除。

import logger from "../../utils/logger";

export function writeEntityDragPayload(
  e: React.DragEvent,
  type: string,
  name: string,
  config: Record<string, unknown>
) {
  e.dataTransfer.setData("application/x-project-entity", type);
  e.dataTransfer.setData("application/x-project-entity-data", JSON.stringify({ name, config }));
  e.dataTransfer.effectAllowed = "copy";
  logger.info("writingDrag", "Drag start", { type });
}

export function setDragGhost(e: React.DragEvent, label: string, color: string) {
  try {
    const ghost = document.createElement("div");
    ghost.textContent = label;
    ghost.style.cssText = [
      "position:fixed",
      "top:-200px",
      "left:-200px",
      "padding:6px 14px",
      "border-radius:8px",
      `background:${color}22`,
      `border:1.5px solid ${color}`,
      "color:#1e293b",
      "font-size:13px",
      "font-weight:600",
      "box-shadow:0 4px 12px rgba(0,0,0,0.18)",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    window.setTimeout(() => ghost.remove(), 0);
  } catch {
    // setDragImage 个别环境不支持：降级浏览器默认 ghost，不阻塞拖拽
  }
}
