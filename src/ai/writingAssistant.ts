/**
 * writingAssistant —— 写作页内联 AI（续写 / 润色）的无头执行器（P7）。
 *
 * 与 analysisRunner 的区别：分析走「上下文落库 + project_context 工具按需取数」，
 * 而内联续写/润色的材料就是当前章节文本本身，**直接内嵌进 prompt**——
 * 这样任意已配置 Agent（无论启没启用工具）都能干这活，接入面最小。
 *
 * 三条铁律沿用：
 *   1. Agent 绝不写死：agentId 必填且必须存在；
 *   2. 结果可感知：await sendMessage 结束后从后端**重新拉取**该会话消息，
 *      不读 UI 的选中态（用户此刻可能停在别的会话上）；
 *   3. 模块无关：本文件不懂 TipTap、不懂 store 细节，只收纯文本上下文。
 */
import { useAgentStore } from "../store/agentStore";
import { agentApi } from "../services/tauri";
import { L } from "./aiLang";
import { getLang, t } from "../i18n";

export type InlineWritingKind = "continue" | "polish";

export class WritingAssistantError extends Error {
  constructor(
    message: string,
    /** 机器可读：busy / agent-missing / no-output / send-failed */
    public readonly reason: string,
  ) {
    super(message);
    this.name = "WritingAssistantError";
  }
}

/** 润色风格档位（P8）；default = 不附加风格要求 */
export type PolishStyle = "default" | "refine" | "vivid" | "plain";

/** 内联写作的上下文（全部纯文本，由调用方从 store/editor 提取） */
export interface InlineWritingContext {
  bookTitle: string;
  bookDescription: string | null;
  chapterTitle: string;
  /** 当前章节全文（纯文本） */
  chapterText: string;
  /** 人设卡（含关系/时间线摘要行；空数组 = 用户还没建卡，prompt 里如实声明盲区） */
  characterLines: string[];
  /** 大纲节拍（含落章指向；空数组 = 尚无大纲） */
  outlineLines: string[];
  /** 续写：目标字数（字/段）；缺省 = 300～600 字 */
  targetWords?: number;
  /** 续写：走向指令（用户对情节走向的要求）；缺省 = 不附加 */
  directive?: string;
  /** 润色：风格档位；缺省 = 不附加 */
  style?: PolishStyle;
  /** 润色：选中文本（非空 = 选区级润色，只改这段）；缺省 = 整章润色 */
  selectionText?: string;
  /** 润色：选区前文（语境用，截尾若干字符）；仅选区级润色时附带 */
  beforeText?: string;
  /** 润色：选区后文（语境用，截头若干字符）；仅选区级润色时附带 */
  afterText?: string;
}

/** 续写只喂尾部，控制 token：末尾 TAIL_CHARS 字符足够接住文风与情节 */
export const TAIL_CHARS = 3000;

export function tailOf(text: string, chars = TAIL_CHARS): string {
  if (text.length <= chars) return text;
  return `…${text.slice(-chars)}`;
}

/** 输出语言跟随 UI 语言 */
function langNote(): string {
  return getLang() === "en-US" ? t("ai.respondEn") : t("ai.respondZh");
}

/** 组装「续写」消息：只输出正文，禁解释、禁复述原文 */
export function buildContinueMessage(ctx: InlineWritingContext): string {
  const characterBlock = ctx.characterLines.length
    ? `${L("【人设卡】", "[Character Cards]")}\n${ctx.characterLines.join("\n")}`
    : L(
        "【人设卡】本作品还没有人设卡。请只依据下文已有内容推断人物，不要凭空设定新的人物关系。",
        "[Character Cards] None yet. Infer characters only from the text below; do not invent new relationships.",
      );
  const outlineBlock = ctx.outlineLines.length
    ? `\n\n${L("【大纲】", "[Outline]")}\n${ctx.outlineLines.join("\n")}`
    : "";
  const directiveBlock = ctx.directive?.trim()
    ? `\n\n${L("【走向要求】", "[Direction]")}\n${ctx.directive.trim()}\n${L("把以上要求融入续写内容本身；不要在输出里复述或解释这些要求。", "Weave these requirements into the prose itself; do not restate or explain them in the output.")}`
    : "";
  const wordsLine = ctx.targetWords && ctx.targetWords > 0
    ? L(
        `从上面的末尾无缝接着往下写约 ${ctx.targetWords} 字，保持人称、时态、文风与已有内容一致。`,
        `Seamlessly continue from the tail above for about ${ctx.targetWords} words, keeping the same person, tense, and style as the existing text.`,
      )
    : L(
        "从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。",
        "Seamlessly continue from the tail above for 300-600 words, keeping the same person, tense, and style as the existing text.",
      );
  return (
    L(
      "请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。",
      "Continue the novel excerpt below. Output the continued prose only: no explanations, titles, prefaces, or summaries; do not repeat existing text.",
    ) +
    `\n\n` +
    L(
      `【作品】${ctx.bookTitle}${ctx.bookDescription ? `：${ctx.bookDescription}` : ""}`,
      `[Book] ${ctx.bookTitle}${ctx.bookDescription ? `: ${ctx.bookDescription}` : ""}`,
    ) +
    `\n` +
    L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
    `\n\n` +
    characterBlock +
    outlineBlock +
    directiveBlock +
    `\n\n` +
    L("【已有正文（末尾）】\n", "[Existing text (tail)]\n") +
    tailOf(ctx.chapterText) +
    `\n\n` +
    wordsLine +
    `\n\n${langNote()}`
  );
}

/** 润色风格档位 → 追加的风格要求行；default = 不附加 */
const POLISH_STYLE_LINES: Record<Exclude<PolishStyle, "default">, string> = {
  refine: L(
    "风格要求：精炼紧凑——删除冗余、缩短长句，字数可以明显少于原文，但不得丢失任何情节信息。",
    "Style: lean and tight — cut redundancy, shorten sentences; output may be notably shorter but must not lose any plot information.",
  ),
  vivid: L(
    "风格要求：文笔华美——强化意象与画面感，但不许堆砌辞藻到伤害可读性。",
    "Style: rich and literary — strengthen imagery, but never pile up rhetoric at the cost of readability.",
  ),
  plain: L(
    "风格要求：平实口语——贴近日常说话的质感，去掉文艺腔与书面腔。",
    "Style: plain and colloquial — close to everyday speech, drop the literary register.",
  ),
};

/** 选区级润色：前后文各取多少字符作语境（控制 token，语境够定位即可） */
export const POLISH_CONTEXT_CHARS = 500;

/** 组装「润色」消息：有选中文本 = 只润色该片段（输出可无缝拼回原文）；否则整章改写 */
export function buildPolishMessage(ctx: InlineWritingContext): string {
  const styleLine = ctx.style && ctx.style !== "default" ? `\n${POLISH_STYLE_LINES[ctx.style]}` : "";

  // ── 选区级润色：只改选中文本，前后文仅作语境 ──
  if (ctx.selectionText && ctx.selectionText.trim().length > 0) {
    const contextBlock =
      ctx.beforeText || ctx.afterText
        ? `\n\n` +
          (ctx.beforeText
            ? L(`【选区前文（结尾）】\n${ctx.beforeText}\n`, `[Before selection (tail)]\n${ctx.beforeText}\n`)
            : "") +
          (ctx.afterText
            ? L(`【选区后文（开头）】\n${ctx.afterText}`, `[After selection (head)]\n${ctx.afterText}`)
            : "")
        : "";
    return (
      L(
        "请只润色下面的【选中片段】：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量。输出必须是润色后的片段本身，能无缝拼回原位：保持与前后文的衔接（人称、时态、语句完整性），不要输出选区之外的内容，不要解释、对照说明或总结。",
        "Polish ONLY the selected excerpt below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information. Output the polished excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text (person, tense, sentence completeness). Do not output anything beyond the excerpt; no explanations or summaries.",
      ) +
      styleLine +
      `\n\n` +
      L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
      `\n` +
      L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
      (ctx.characterLines.length
        ? `\n\n${L("【人设卡】", "[Character Cards]")}\n${ctx.characterLines.join("\n")}`
        : "") +
      contextBlock +
      `\n\n` +
      L("【选中片段】\n", "[Selected excerpt]\n") +
      ctx.selectionText +
      `\n\n${langNote()}`
    );
  }

  // ── 整章润色（原行为）──
  return (
    L(
      "请润色下面的整章小说：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量；不得增删情节点；保留原有分段结构。直接输出润色后的全文正文：不要任何解释、对照说明或总结。",
      "Polish the chapter below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information; keep the original paragraph structure. Output the polished full text only: no explanations or summaries.",
    ) +
    styleLine +
    `\n\n` +
    L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
    `\n` +
    L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
    (ctx.characterLines.length
      ? `\n\n${L("【人设卡】", "[Character Cards]")}\n${ctx.characterLines.join("\n")}`
      : "") +
    `\n\n` +
    L("【原文】\n", "[Original]\n") +
    ctx.chapterText +
    `\n\n${langNote()}`
  );
}

export function buildInlineMessage(kind: InlineWritingKind, ctx: InlineWritingContext): string {
  return kind === "continue" ? buildContinueMessage(ctx) : buildPolishMessage(ctx);
}

/**
 * 执行一次内联写作任务，返回助手的最终文本回复。
 *
 * 流程：开会话（不切前台）→ sendMessage 等流结束 → 从后端拉该会话消息
 * → 取最后一条非空 assistant 回复。用户此刻在 AI 页选中哪个会话都不影响取数。
 *
 * C 流式预览：onDelta 提供时订阅 agentStore 的 streamingContent（全局唯一流——
 * isStreaming 并发闸门保证内联任务运行期间不存在第二个流）转发全量预览文本；
 * 最终正文仍以后端落库消息为准。用户中断（requestInterrupt）→ 返回
 * interrupted=true 而非抛错，由 UI 决定安静收场。
 */
export async function runInlineWritingTask(opts: {
  agentId: string;
  kind: InlineWritingKind;
  ctx: InlineWritingContext;
  /** 流式预览回调：每次收到当前全量预览文本（append-only） */
  onDelta?: (full: string) => void;
}): Promise<{ text: string; conversationId: string; interrupted?: boolean }> {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === opts.agentId);
  if (!agent) {
    throw new WritingAssistantError("指定的 Agent 不存在（可能已被删除），请重新选择", "agent-missing");
  }
  if (state.isStreaming) {
    throw new WritingAssistantError("上一次对话仍在进行中，请稍后再试", "busy");
  }

  const conv = await state.createConversation(
    opts.agentId,
    `${opts.kind === "continue" ? L("续写", "Continue") : L("润色", "Polish")} · ${opts.ctx.chapterTitle}`,
  );
  // 订阅全局 streamingContent 作流式预览；sendMessage 结束（含取消）后必须退订。
  // 注意：subscribe 是 zustand store 实例方法（useAgentStore.subscribe），不在 state 上。
  const unsubscribe = opts.onDelta
    ? useAgentStore.subscribe((s) => {
        opts.onDelta!(s.streamingContent);
      })
    : null;
  // 不 selectConversation：不抢 AI 助手页的当前视图
  let interrupted = false;
  try {
    await state.sendMessage(conv.id, buildInlineMessage(opts.kind, opts.ctx));
  } catch (e) {
    throw new WritingAssistantError(
      (e as Error)?.message ?? String(e),
      "send-failed",
    );
  } finally {
    if (unsubscribe) unsubscribe();
  }

  // 用户中断：后端不落助手消息（或落了半截），如实返回 interrupted，由 UI 安静收场
  const after = useAgentStore.getState();
  if (after.stoppedConversationId === conv.id) {
    interrupted = true;
  }
  if (interrupted) {
    return { text: "", conversationId: conv.id, interrupted: true };
  }

  // 从后端重拉（而非读 store 的 messages 选中态），口径唯一
  const messages = await agentApi.listMessages(conv.id);
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.trim().length > 0);
  if (!lastAssistant) {
    throw new WritingAssistantError("对话已结束，但没有拿到可用的正文输出", "no-output");
  }
  return { text: lastAssistant.content.trim(), conversationId: conv.id };
}

/** 纯文本 → 段落 HTML（插入 TipTap 用）；连续空行分段，段内换行保留为 <br> */
export function textToParagraphHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
