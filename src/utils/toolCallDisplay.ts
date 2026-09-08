import type { ToolCallEvent } from "../services/tauri";
import { t } from "../i18n";

/**
 * 工具调用事件的展示辅助。
 *
 * 后端对同一次调用会推两次事件：status="running"（带 arguments）与
 * status="done"|"error"（带 result）。UI 需要把两次合并成一张卡片，
 * 并且 arguments 是任意 JSON（不是字符串），直接渲染会变成 "[object Object]"。
 */

/** 把任意形态的工具入参渲染成可读文本；空值返回空串（调用方据此决定是否显示） */
export function formatToolArguments(args: unknown): string {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") return args;
  try {
    const text = JSON.stringify(args, null, 2);
    return text === "{}" || text === "null" ? "" : text;
  } catch {
    return String(args);
  }
}

/** 状态徽标文案 */
export function toolStatusLabel(status: ToolCallEvent["status"]): string {
  switch (status) {
    case "running":
      return t("agent.tool.running");
    case "done":
      return t("agent.tool.done");
    case "error":
      return t("agent.tool.error");
    case "denied":
      return t("agent.tool.denied");
    default:
      return status;
  }
}

/** 状态徽标配色（MUI palette key） */
export function toolStatusColor(
  status: ToolCallEvent["status"],
): "default" | "success" | "error" {
  if (status === "done") return "success";
  if (status === "error" || status === "denied") return "error";
  return "default";
}

/**
 * 把新到达的工具事件合并进已有列表：
 * 同名工具的最后一条 running 记录会被 done/error 就地更新（保留 arguments），
 * 找不到配对才追加新卡片。避免一次调用出现两张卡。
 */
export function mergeToolCallEvent(
  list: ToolCallEvent[],
  incoming: ToolCallEvent,
): ToolCallEvent[] {
  if (incoming.status === "running") return [...list, incoming];

  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].toolName === incoming.toolName && list[i].status === "running") {
      const next = [...list];
      next[i] = {
        ...list[i],
        // 收尾事件的 arguments 为空，保留 running 时记录的入参
        result: incoming.result,
        success: incoming.success,
        status: incoming.status,
      };
      return next;
    }
  }
  return [...list, incoming];
}
