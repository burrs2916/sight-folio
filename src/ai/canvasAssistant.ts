// canvasAssistant —— 工作室画布 AI 助手（H3「AI 修改优化画布」）。
//
// 与 writingAssistant 同款无头执行器模式：开会话（不抢 AI 页前台）→ sendMessage
// → 拉取最终回复。区别在于输出契约：AI 不直接改画布，而是返回**结构化操作数组
// （CanvasAiOp）**，由前端解析 → 用户预览确认 → 走 editorStore 正规 API 应用。
//
// 三条铁律：
//   1. AI 永远拿不到画布写通道（无后端 ai_edit 工具），越权操作天然不可能；
//   2. 一切修改必须先预览、经用户点击「应用」才生效（平台不擅自改用户的作品）；
//   3. 应用前自动快照，一键「撤销本次」恢复 —— 不依赖 editorStore 历史，
//      ops 多步应用后仍能一步回到应用前状态。
import { useAgentStore } from "../store/agentStore";
import { agentApi } from "../services/tauri";
import { useEditorStore } from "../store/editorStore";
import { L } from "./aiLang";
import { getLang } from "../i18n";

// ─── 操作协议 ───────────────────────────────────────────────

export type CanvasAiOp =
  | { op: "move"; id: string; x: number; y: number }
  | { op: "resize"; id: string; width: number; height: number }
  | { op: "rename"; id: string; name: string }
  | { op: "set_text"; id: string; text: string }
  | { op: "remove"; id: string }
  | {
      op: "add";
      type: string;
      name: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      text?: string;
    }
  | {
      op: "arrange_grid";
      ids: string[];
      startX?: number;
      startY?: number;
      columns?: number;
      cellWidth?: number;
      cellHeight?: number;
      gapX?: number;
      gapY?: number;
    };

/** AI 可以新增的实体类型（白名单：全是写作语义卡，杜绝 AI 造图片路径/代码实体） */
export const AI_ADDABLE_TYPES = ["writing-character", "writing-outline", "annotation-text"] as const;

const MAX_OPS = 60;

// ─── 画布快照（喂给 AI 的清单）──────────────────────────────

export interface CanvasSnapshotItem {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 卡片主要显示文字（title/text/fileName 的第一个非空者） */
  text: string;
}

export function captureCanvasSnapshot(): CanvasSnapshotItem[] {
  return useEditorStore.getState().components.map((c) => {
    const cfg = (c.config ?? {}) as Record<string, unknown>;
    const text = [cfg.title, cfg.text, cfg.fileName]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)[0] ?? "";
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      x: Math.round(c.transform.x),
      y: Math.round(c.transform.y),
      width: Math.round(c.transform.width),
      height: Math.round(c.transform.height),
      text: text.slice(0, 60),
    };
  });
}

// ─── Prompt 组装 ────────────────────────────────────────────

function langNote(): string {
  return getLang() === "en-US" ? "Respond in English." : "用中文。";
}

export function buildCanvasOpsMessage(snapshot: CanvasSnapshotItem[], instruction: string): string {
  const list = snapshot
    .map(
      (s) =>
        `- id=${s.id} | type=${s.type} | 名称=${s.name} | 文字=${s.text || "（无）"} | 位置=(${s.x},${s.y}) | 大小=${s.width}×${s.height}`
    )
    .join("\n");
  return [
    L(
      "你是小说创作工作台的画布排版助手。根据用户指令，输出一组对画布实体的结构化操作。",
      "You are the canvas layout assistant of a novel-writing studio. Output a set of structured canvas operations per the user's instruction.",
    ),
    "",
    L("【可用操作（严格按此 JSON Schema）】", "[Operations (strict JSON schema)]"),
    `[
  {"op":"move","id":"<清单中的id>","x":<数字>,"y":<数字>},
  {"op":"resize","id":"<id>","width":<数字>,"height":<数字>},
  {"op":"rename","id":"<id>","name":"<新名称>"},
  {"op":"set_text","id":"<id>","text":"<新文字>"},
  {"op":"remove","id":"<id>"},
  {"op":"add","type":"writing-character|writing-outline|annotation-text","name":"<名称>","x":<数字>,"y":<数字>,"width":<可选>,"height":<可选>,"text":"<可选>"},
  {"op":"arrange_grid","ids":["<id>",...],"startX":<可选>,"startY":<可选>,"columns":<可选>,"cellWidth":<可选>,"cellHeight":<可选>,"gapX":<可选>,"gapY":<可选>}
]`,
    "",
    L("【硬性规则】", "[Hard rules]"),
    L(
      "1. 只输出一个 JSON 数组，不要任何解释、前后缀或代码围栏；2. move/resize/rename/set_text/remove 的 id 必须来自下方清单；3. 新增实体的 type 只能取白名单里的三个值；4. 坐标是画布逻辑坐标（原点左上，向右下为正）；5. 排版类指令优先用 arrange_grid；6. 不确定的操作宁可不输出，绝不要臆造。",
      "1. Output ONLY one JSON array: no explanations, prefixes, or code fences; 2. move/resize/rename/set_text/remove ids must come from the list below; 3. add.type must be one of the three whitelisted values; 4. Coordinates are canvas logical coords (origin top-left); 5. Prefer arrange_grid for layout instructions; 6. When unsure, omit — never fabricate.",
    ),
    "",
    L("【当前画布实体清单】", "[Current canvas entities]"),
    list || L("（空画布）", "(empty canvas)"),
    "",
    L(`【用户指令】${instruction}`, `[User instruction] ${instruction}`),
    "",
    langNote(),
  ].join("\n");
}

// ─── 回复解析 ───────────────────────────────────────────────

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** 校验并归一单个 op；非法返回 null（宁跳过不猜测） */
function normalizeOp(raw: unknown): CanvasAiOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asNonEmptyString(o.id);
  switch (o.op) {
    case "move": {
      const x = asFiniteNumber(o.x);
      const y = asFiniteNumber(o.y);
      return id && x !== null && y !== null ? { op: "move", id, x, y } : null;
    }
    case "resize": {
      const w = asFiniteNumber(o.width);
      const h = asFiniteNumber(o.height);
      return id && w !== null && h !== null && w > 20 && h > 20
        ? { op: "resize", id, width: Math.min(w, 2000), height: Math.min(h, 2000) }
        : null;
    }
    case "rename": {
      const name = asNonEmptyString(o.name);
      return id && name ? { op: "rename", id, name: name.slice(0, 80) } : null;
    }
    case "set_text": {
      const text = asNonEmptyString(o.text);
      return id && text ? { op: "set_text", id, text: text.slice(0, 500) } : null;
    }
    case "remove":
      return id ? { op: "remove", id } : null;
    case "add": {
      const type = asNonEmptyString(o.type);
      const name = asNonEmptyString(o.name);
      const x = asFiniteNumber(o.x);
      const y = asFiniteNumber(o.y);
      if (!type || !name || x === null || y === null) return null;
      if (!(AI_ADDABLE_TYPES as readonly string[]).includes(type)) return null;
      const out: CanvasAiOp = { op: "add", type, name: name.slice(0, 80), x, y };
      const w = asFiniteNumber(o.width);
      const h = asFiniteNumber(o.height);
      if (w !== null && w > 20) out.width = Math.min(w, 1200);
      if (h !== null && h > 20) out.height = Math.min(h, 1200);
      const text = asNonEmptyString(o.text);
      if (text) out.text = text.slice(0, 500);
      return out;
    }
    case "arrange_grid": {
      if (!Array.isArray(o.ids)) return null;
      const ids = o.ids.filter((v): v is string => typeof v === "string" && v.length > 0);
      if (ids.length === 0) return null;
      return {
        op: "arrange_grid",
        ids: ids.slice(0, 200),
        startX: asFiniteNumber(o.startX) ?? 0,
        startY: asFiniteNumber(o.startY) ?? 0,
        columns: Math.max(1, Math.min(asFiniteNumber(o.columns) ?? 4, 12)),
        cellWidth: Math.max(60, asFiniteNumber(o.cellWidth) ?? 240),
        cellHeight: Math.max(40, asFiniteNumber(o.cellHeight) ?? 80),
        gapX: Math.max(0, asFiniteNumber(o.gapX) ?? 20),
        gapY: Math.max(0, asFiniteNumber(o.gapY) ?? 20),
      };
    }
    default:
      return null;
  }
}

/** 从 AI 回复里提取 JSON 数组并归一；返回 ops 与被丢弃的条数 */
export function parseCanvasOps(
  reply: string
): { ops: CanvasAiOp[]; dropped: number; parseError: string | null } {
  if (!reply || reply.trim().length === 0) {
    return { ops: [], dropped: 0, parseError: "empty" };
  }
  let jsonText: string | null = null;
  const fence = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    jsonText = fence[1];
  } else {
    const start = reply.indexOf("[");
    const end = reply.lastIndexOf("]");
    if (start !== -1 && end > start) jsonText = reply.slice(start, end + 1);
  }
  if (!jsonText) return { ops: [], dropped: 0, parseError: "no-array" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ops: [], dropped: 0, parseError: "invalid-json" };
  }
  if (!Array.isArray(parsed)) return { ops: [], dropped: 0, parseError: "not-array" };
  const ops: CanvasAiOp[] = [];
  let dropped = 0;
  for (const raw of parsed) {
    const op = normalizeOp(raw);
    if (op) ops.push(op);
    else dropped += 1;
    if (ops.length >= MAX_OPS) break;
  }
  return { ops, dropped, parseError: null };
}

// ─── 应用（走 editorStore 正规 API，一次批量提交历史）────────

export interface CanvasApplyResult {
  applied: number;
  skipped: number;
}

export function applyCanvasOps(ops: CanvasAiOp[]): CanvasApplyResult {
  const ed = useEditorStore.getState();
  const known = new Set(ed.components.map((c) => c.id));
  let applied = 0;
  let skipped = 0;
  const live = () => useEditorStore.getState();

  // 应用前冻结一份现有 id 集，AI 引用不存在/已删 id 的操作记 skipped
  const stillKnown = (id: string) => live().components.some((c) => c.id === id) && known.has(id);

  ed.beginBatch();
  try {
    for (const op of ops) {
      const s = live();
      switch (op.op) {
        case "move":
          if (!stillKnown(op.id)) { skipped += 1; break; }
          s.updateComponentTransform(op.id, { x: op.x, y: op.y });
          applied += 1;
          break;
        case "resize":
          if (!stillKnown(op.id)) { skipped += 1; break; }
          s.updateComponentTransform(op.id, { width: op.width, height: op.height });
          applied += 1;
          break;
        case "rename":
          if (!stillKnown(op.id)) { skipped += 1; break; }
          s.updateComponent(op.id, { name: op.name });
          applied += 1;
          break;
        case "set_text": {
          if (!stillKnown(op.id)) { skipped += 1; break; }
          const comp = s.components.find((c) => c.id === op.id)!;
          const cfg = { ...(comp.config ?? {}) } as Record<string, unknown>;
          const key = typeof cfg.title === "string" ? "title" : "text";
          cfg[key] = op.text;
          s.updateComponentConfig(op.id, cfg);
          applied += 1;
          break;
        }
        case "remove":
          if (!stillKnown(op.id)) { skipped += 1; break; }
          s.removeComponent(op.id);
          applied += 1;
          break;
        case "add": {
          const created = s.addComponent(op.type, undefined, { x: op.x, y: op.y });
          if (!created) { skipped += 1; break; }
          const patch: Record<string, unknown> = { name: op.name };
          useEditorStore.getState().updateComponent(created.id, patch as any);
          if (op.width || op.height) {
            const w = op.width ?? created.transform.width;
            const h = op.height ?? created.transform.height;
            useEditorStore.getState().updateComponentTransform(created.id, { width: w, height: h });
          }
          if (op.text) {
            const cfgKey = op.type === "annotation-text" ? "text" : "title";
            useEditorStore.getState().updateComponentConfig(created.id, { [cfgKey]: op.text });
          }
          applied += 1;
          break;
        }
        case "arrange_grid": {
          let placed = 0;
          const cols = op.columns ?? 4;
          const cw = op.cellWidth ?? 240;
          const ch = op.cellHeight ?? 80;
          const gx = op.gapX ?? 20;
          const gy = op.gapY ?? 20;
          for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            if (!stillKnown(id)) continue;
            const col = i % cols;
            const row = Math.floor(i / cols);
            live().updateComponentTransform(id, {
              x: (op.startX ?? 0) + col * (cw + gx),
              y: (op.startY ?? 0) + row * (ch + gy),
            });
            placed += 1;
          }
          if (placed > 0) applied += 1;
          else skipped += 1;
          break;
        }
        default:
          skipped += 1;
      }
    }
  } finally {
    ed.endBatch();
  }
  return { applied, skipped };
}

// ─── 无头执行器（与 writingAssistant 同款流程）──────────────

export class CanvasAssistantError extends Error {
  constructor(
    message: string,
    /** 机器可读：agent-missing / busy / send-failed / no-output / parse */
    public readonly reason: string,
  ) {
    super(message);
    this.name = "CanvasAssistantError";
  }
}

export async function runCanvasAssistantTask(opts: {
  agentId: string;
  instruction: string;
}): Promise<{ ops: CanvasAiOp[]; dropped: number; conversationId: string }> {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === opts.agentId);
  if (!agent) {
    throw new CanvasAssistantError(L("指定的 Agent 不存在，请重新选择", "Selected agent not found, please re-pick"), "agent-missing");
  }
  if (state.isStreaming) {
    throw new CanvasAssistantError(L("上一次对话仍在进行中，请稍后再试", "Previous request still streaming"), "busy");
  }

  const snapshot = captureCanvasSnapshot();
  if (snapshot.length === 0 && !/add|新增|插入/i.test(opts.instruction)) {
    throw new CanvasAssistantError(L("画布是空的，先生成全书总览或插入实体", "Canvas is empty"), "no-output");
  }

  const conv = await state.createConversation(opts.agentId, L("画布优化", "Canvas polish"));
  try {
    await state.sendMessage(conv.id, buildCanvasOpsMessage(snapshot, opts.instruction));
  } catch (e) {
    throw new CanvasAssistantError((e as Error)?.message ?? String(e), "send-failed");
  }

  const messages = await agentApi.listMessages(conv.id);
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.trim().length > 0);
  if (!lastAssistant) {
    throw new CanvasAssistantError(L("对话已结束，但没有拿到可用输出", "No output"), "no-output");
  }
  const { ops, dropped, parseError } = parseCanvasOps(lastAssistant.content);
  if (parseError || ops.length === 0) {
    throw new CanvasAssistantError(
      L("AI 没有返回可执行的操作，换个说法再试一次", "AI returned no actionable operations"),
      "parse",
    );
  }
  return { ops, dropped, conversationId: conv.id };
}
