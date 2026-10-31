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
import { useAgentStore } from '../store/agentStore';
import { useWritingStore } from '../store/writingStore';
import { agentApi } from '../services/tauri';
import { useEditorStore } from '../store/editorStore';
import { L } from './aiLang';
import { getLang } from '../i18n';

// ─── 操作协议 ───────────────────────────────────────────────

export type CanvasAiOp =
  | { op: 'move'; id: string; x: number; y: number }
  | { op: 'resize'; id: string; width: number; height: number }
  | { op: 'rename'; id: string; name: string }
  | { op: 'set_text'; id: string; text: string }
  | { op: 'remove'; id: string }
  | {
      op: 'add';
      type: string;
      name: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      text?: string;
    }
  | {
      op: 'arrange_grid';
      ids: string[];
      startX?: number;
      startY?: number;
      columns?: number;
      cellWidth?: number;
      cellHeight?: number;
      gapX?: number;
      gapY?: number;
    };

/**
 * AI 可以新增的实体类型（白名单：全是写作语义卡，杜绝 AI 造图片路径/代码实体）。
 * 2026-10-31 第十四轮补 writing-worldview：世界观与人物、大纲同为写作台 L2 三大
 * 设定支柱（characters/worldview/catalog），此前唯独 AI 加不了世界观卡 —— 用户让
 * 画布 AI「把主要世界观设定也铺几张卡」会静默失败（normalizeOp 白名单校验丢弃）。
 * writing-worldview 已在 writingAnalyzer manifest 注册，addComponent 正规落地。
 */
export const AI_ADDABLE_TYPES = ['writing-character', 'writing-worldview', 'writing-outline', 'annotation-text'] as const;

/**
 * 各可新增/改写文字时**真正被渲染器读到的主字段**（与 writingAnalyzer manifest
 * properties + WritingPropertyPanel primary 字段同一口径）：
 *   character / worldview 的主字段是 name，outline 是 title，便签是 text。
 * 旧实现把 set_text/add text 一律落到 `title`（无则 `text`），对 character/worldview
 * 落到无人读的 config.text → 文字静默不显示（确定的 bug）。按类型对齐主字段。
 */
function primaryTextKey(type: string): string {
  switch (type) {
    case 'writing-character':
    case 'writing-worldview':
      return 'name';
    case 'writing-outline':
      return 'title';
    default:
      return 'text';
  }
}

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
    // 主字段优先级补 name：character/worldview 卡的名字在 config.name，旧提取漏了
    // name，喂给 AI 的人物/世界观卡「文字」恒为（无），add/rename 贴合度打折。
    const text =
      [cfg.title, cfg.name, cfg.text, cfg.fileName].filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )[0] ?? '';
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

// ─── 写作上下文（H3 缺口②：AI 面板挂写作语境）────────────────

/**
 * 从 writingStore 提取当前活跃书的写作语境，组装为纯文本注入 prompt。
 * 让 add/set_text/rename 类操作贴合作品语境（画布对象多数是章节/人物/大纲卡）。
 * 无活跃书时返回 null：画布 AI 保持「有上下文则用、没有也能干排版」的宽容语义。
 */
export function buildCanvasWritingContext(): string | null {
  const ws = useWritingStore.getState();
  const book = ws.books.find((b) => b.id === ws.activeBookId);
  if (!book) return null;
  const chapter = ws.chapters.find((c) => c.id === ws.activeChapterId);
  const chars = ws.settings
    .filter((s) => s.kind === 'character')
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.name}${c.subtitle ? `（${c.subtitle}）` : ''}${c.description ? `：${c.description.slice(0, 80)}` : ''}`,
    );
  const outlines = ws.outlines.slice(0, 10).map((o) => `- ${o.title}${o.summary ? `：${o.summary.slice(0, 60)}` : ''}`);
  // 第十四轮：补【世界观设定】段——本批次刚把 writing-worldview 加进 AI 可新增白名单，
  // 但若上下文不含书里已有世界观，AI「能加世界观卡」却无据可依，只会凭空造卡、与既有
  // 人物/大纲口径打架。settings 里世界观是 kind==='worldbuilding'，与人物档案同构注入。
  const worldviews = ws.settings
    .filter((s) => s.kind === 'worldbuilding')
    .slice(0, 8)
    .map(
      (w) =>
        `- ${w.name}${w.subtitle ? `（${w.subtitle}）` : ''}${w.description ? `：${w.description.slice(0, 80)}` : ''}`,
    );
  const completed = ws.chapters.filter((c) => c.status === 'completed').length;
  const parts: string[] = [];
  parts.push(
    L(
      `【作品】《${book.title}》${book.genre ? `（${book.genre}）` : ''}${chapter ? ` · 当前章《${chapter.title}》` : ''}`,
      `[Book] "${book.title}"${book.genre ? ` (${book.genre})` : ''}${chapter ? ` · current chapter "${chapter.title}"` : ''}`,
    ),
  );
  if (ws.chapters.length > 0) {
    parts.push(
      L(
        `【全书进度】共 ${ws.chapters.length} 章，已完稿 ${completed} 章`,
        `[Progress] ${ws.chapters.length} chapters total, ${completed} completed`,
      ),
    );
  }
  if (chars.length) {
    parts.push(
      L(`【人物档案】\n${chars.join('\n')}`, `[Characters]\n${chars.map((c) => c.replace(/^-\s*/, '')).join('\n')}`),
    );
  }
  if (outlines.length) {
    parts.push(
      L(`【大纲节拍】\n${outlines.join('\n')}`, `[Outline]\n${outlines.map((o) => o.replace(/^-\s*/, '')).join('\n')}`),
    );
  }
  if (worldviews.length) {
    parts.push(
      L(
        `【世界观设定】\n${worldviews.join('\n')}`,
        `[Worldbuilding]\n${worldviews.map((w) => w.replace(/^-\s*/, '')).join('\n')}`,
      ),
    );
  }
  return parts.join('\n');
}

// ─── Prompt 组装 ────────────────────────────────────────────

function langNote(): string {
  return getLang() === 'en-US' ? 'Respond in English.' : '用中文。';
}

export function buildCanvasOpsMessage(
  snapshot: CanvasSnapshotItem[],
  instruction: string,
  writingContext?: string | null,
): string {
  const list = snapshot
    .map(
      (s) =>
        `- id=${s.id} | type=${s.type} | 名称=${s.name} | 文字=${s.text || '（无）'} | 位置=(${s.x},${s.y}) | 大小=${s.width}×${s.height}`,
    )
    .join('\n');
  return [
    L(
      '你是小说创作工作台的画布排版助手。根据用户指令，输出一组对画布实体的结构化操作。',
      "You are the canvas layout assistant of a novel-writing studio. Output a set of structured canvas operations per the user's instruction.",
    ),
    '',
    L('【可用操作（严格按此 JSON Schema）】', '[Operations (strict JSON schema)]'),
    `[
  {"op":"move","id":"<清单中的id>","x":<数字>,"y":<数字>},
  {"op":"resize","id":"<id>","width":<数字>,"height":<数字>},
  {"op":"rename","id":"<id>","name":"<新名称>"},
  {"op":"set_text","id":"<id>","text":"<新文字>"},
  {"op":"remove","id":"<id>"},
  {"op":"add","type":"${AI_ADDABLE_TYPES.join("|")}","name":"<名称>","x":<数字>,"y":<数字>,"width":<可选>,"height":<可选>,"text":"<可选>"},
  {"op":"arrange_grid","ids":["<id>",...],"startX":<可选>,"startY":<可选>,"columns":<可选>,"cellWidth":<可选>,"cellHeight":<可选>,"gapX":<可选>,"gapY":<可选>}
]`,
    '',
    L('【硬性规则】', '[Hard rules]'),
    L(
      `1. 只输出一个 JSON 数组，不要任何解释、前后缀或代码围栏；2. move/resize/rename/set_text/remove 的 id 必须来自下方清单；3. 新增实体的 type 只能取白名单里的值（${AI_ADDABLE_TYPES.join("、")}）；4. 坐标是画布逻辑坐标（原点左上，向右下为正）；5. 排版类指令优先用 arrange_grid；6. 不确定的操作宁可不输出，绝不要臆造；7. 新增/改名/改文字时，内容优先贴合下方写作背景中的书名、角色、世界观与大纲设定。`,
      `1. Output ONLY one JSON array: no explanations, prefixes, or code fences; 2. move/resize/rename/set_text/remove ids must come from the list below; 3. add.type must be one of the whitelisted values (${AI_ADDABLE_TYPES.join(", ")}); 4. Coordinates are canvas logical coords (origin top-left); 5. Prefer arrange_grid for layout instructions; 6. When unsure, omit — never fabricate; 7. For add/rename/set_text, prefer content that fits the writing context below (book title, characters, worldbuilding, outline).`,
    ),
    '',
    L('【当前画布实体清单】', '[Current canvas entities]'),
    list || L('（空画布）', '(empty canvas)'),
    '',
    ...(writingContext ? [L('【写作背景】', '[Writing context]'), writingContext, ''] : []),
    L(`【用户指令】${instruction}`, `[User instruction] ${instruction}`),
    '',
    langNote(),
  ].join('\n');
}

// ─── 回复解析 ───────────────────────────────────────────────

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** 校验并归一单个 op；非法返回 null（宁跳过不猜测） */
function normalizeOp(raw: unknown): CanvasAiOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = asNonEmptyString(o.id);
  switch (o.op) {
    case 'move': {
      const x = asFiniteNumber(o.x);
      const y = asFiniteNumber(o.y);
      return id && x !== null && y !== null ? { op: 'move', id, x, y } : null;
    }
    case 'resize': {
      const w = asFiniteNumber(o.width);
      const h = asFiniteNumber(o.height);
      return id && w !== null && h !== null && w > 20 && h > 20
        ? { op: 'resize', id, width: Math.min(w, 2000), height: Math.min(h, 2000) }
        : null;
    }
    case 'rename': {
      const name = asNonEmptyString(o.name);
      return id && name ? { op: 'rename', id, name: name.slice(0, 80) } : null;
    }
    case 'set_text': {
      const text = asNonEmptyString(o.text);
      return id && text ? { op: 'set_text', id, text: text.slice(0, 500) } : null;
    }
    case 'remove':
      return id ? { op: 'remove', id } : null;
    case 'add': {
      const type = asNonEmptyString(o.type);
      const name = asNonEmptyString(o.name);
      const x = asFiniteNumber(o.x);
      const y = asFiniteNumber(o.y);
      if (!type || !name || x === null || y === null) return null;
      if (!(AI_ADDABLE_TYPES as readonly string[]).includes(type)) return null;
      const out: CanvasAiOp = { op: 'add', type, name: name.slice(0, 80), x, y };
      const w = asFiniteNumber(o.width);
      const h = asFiniteNumber(o.height);
      if (w !== null && w > 20) out.width = Math.min(w, 1200);
      if (h !== null && h > 20) out.height = Math.min(h, 1200);
      const text = asNonEmptyString(o.text);
      if (text) out.text = text.slice(0, 500);
      return out;
    }
    case 'arrange_grid': {
      if (!Array.isArray(o.ids)) return null;
      const ids = o.ids.filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (ids.length === 0) return null;
      return {
        op: 'arrange_grid',
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
export function parseCanvasOps(reply: string): { ops: CanvasAiOp[]; dropped: number; parseError: string | null } {
  if (!reply || reply.trim().length === 0) {
    return { ops: [], dropped: 0, parseError: 'empty' };
  }
  let jsonText: string | null = null;
  const fence = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    jsonText = fence[1];
  } else {
    const start = reply.indexOf('[');
    const end = reply.lastIndexOf(']');
    if (start !== -1 && end > start) jsonText = reply.slice(start, end + 1);
  }
  if (!jsonText) return { ops: [], dropped: 0, parseError: 'no-array' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ops: [], dropped: 0, parseError: 'invalid-json' };
  }
  if (!Array.isArray(parsed)) return { ops: [], dropped: 0, parseError: 'not-array' };
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
        case 'move':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.updateComponentTransform(op.id, { x: op.x, y: op.y });
          applied += 1;
          break;
        case 'resize':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.updateComponentTransform(op.id, { width: op.width, height: op.height });
          applied += 1;
          break;
        case 'rename':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.updateComponent(op.id, { name: op.name });
          applied += 1;
          break;
        case 'set_text': {
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          const comp = s.components.find((c) => c.id === op.id)!;
          const cfg = { ...(comp.config ?? {}) } as Record<string, unknown>;
          // 按实体类型落**主字段**（name/title/text），与渲染器读取口径一致：
          // 旧逻辑 title 优先否则 text，对 character/worldview（主字段 name）落到
          // 无人渲染的 config.text → set_text 静默失效。
          const key = primaryTextKey(comp.type);
          cfg[key] = op.text;
          s.updateComponentConfig(op.id, cfg);
          applied += 1;
          break;
        }
        case 'remove':
          if (!stillKnown(op.id)) {
            skipped += 1;
            break;
          }
          s.removeComponent(op.id);
          applied += 1;
          break;
        case 'add': {
          const created = s.addComponent(op.type, undefined, { x: op.x, y: op.y });
          if (!created) {
            skipped += 1;
            break;
          }
          const patch: Record<string, unknown> = { name: op.name };
          useEditorStore.getState().updateComponent(created.id, patch as any);
          if (op.width || op.height) {
            const w = op.width ?? created.transform.width;
            const h = op.height ?? created.transform.height;
            useEditorStore.getState().updateComponentTransform(created.id, { width: w, height: h });
          }
          if (op.text) {
            // character/worldview→name，outline→title，便签→text
            const cfgKey = primaryTextKey(op.type);
            useEditorStore.getState().updateComponentConfig(created.id, { [cfgKey]: op.text });
          }
          applied += 1;
          break;
        }
        case 'arrange_grid': {
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
    this.name = 'CanvasAssistantError';
  }
}

export async function runCanvasAssistantTask(opts: {
  agentId: string;
  instruction: string;
}): Promise<{ ops: CanvasAiOp[]; dropped: number; conversationId: string }> {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === opts.agentId);
  if (!agent) {
    throw new CanvasAssistantError(
      L('指定的 Agent 不存在，请重新选择', 'Selected agent not found, please re-pick'),
      'agent-missing',
    );
  }
  if (state.isStreaming) {
    throw new CanvasAssistantError(L('上一次对话仍在进行中，请稍后再试', 'Previous request still streaming'), 'busy');
  }

  const snapshot = captureCanvasSnapshot();
  if (snapshot.length === 0 && !/add|新增|插入/i.test(opts.instruction)) {
    throw new CanvasAssistantError(L('画布是空的，先生成全书总览或插入实体', 'Canvas is empty'), 'no-output');
  }

  const conv = await state.createConversation(opts.agentId, L('画布优化', 'Canvas polish'));
  try {
    await state.sendMessage(conv.id, buildCanvasOpsMessage(snapshot, opts.instruction, buildCanvasWritingContext()));
  } catch (e) {
    throw new CanvasAssistantError((e as Error)?.message ?? String(e), 'send-failed');
  }

  const messages = await agentApi.listMessages(conv.id);
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim().length > 0);
  if (!lastAssistant) {
    throw new CanvasAssistantError(L('对话已结束，但没有拿到可用输出', 'No output'), 'no-output');
  }
  const { ops, dropped, parseError } = parseCanvasOps(lastAssistant.content);
  if (parseError || ops.length === 0) {
    throw new CanvasAssistantError(
      L('AI 没有返回可执行的操作，换个说法再试一次', 'AI returned no actionable operations'),
      'parse',
    );
  }
  return { ops, dropped, conversationId: conv.id };
}
