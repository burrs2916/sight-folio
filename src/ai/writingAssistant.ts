/**
 * writingAssistant —— 写作页内联 AI（续写 / 润色 / 改写 / 总结）的无头执行器（P7）。
 *
 * 与 analysisRunner 的区别：分析走「上下文落库 + project_context 工具按需取数」，
 * 而内联任务的材料就是当前章节文本本身，**直接内嵌进 prompt**——
 * 这样任意已配置 Agent（无论启没启用工具）都能干这活，接入面最小。
 *
 * 三条铁律沿用：
 *   1. Agent 绝不写死：agentId 必填且必须存在；
 *   2. 结果可感知：await sendMessage 结束后从后端**重新拉取**该会话消息，
 *      不读 UI 的选中态（用户此刻可能停在别的会话上）；
 *   3. 模块无关：本文件不懂 TipTap、不懂 store 细节，只收纯文本上下文。
 */
import { useAgentStore } from '../store/agentStore';
import { agentApi } from '../services/tauri';
import { L } from './aiLang';
import { getLang, t } from '../i18n';

export type InlineWritingKind = 'continue' | 'polish' | 'rewrite' | 'summarize' | 'review';

export class WritingAssistantError extends Error {
  constructor(
    message: string,
    /** 机器可读：busy / agent-missing / no-output / send-failed */
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'WritingAssistantError';
  }
}

/** 润色风格档位（P8）；default = 不附加风格要求 */
export type PolishStyle = 'default' | 'refine' | 'vivid' | 'plain';

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
  /** 文风一致性开关：开启且 styleFingerprint 非空时，向生成类任务注入文风指纹引导 */
  styleConsistency?: boolean;
  /** 文风指纹（T9 提取、按当前 UI 语言选好的单语文本；由调用方计算传入，本模块只收纯文本） */
  styleFingerprint?: string;
  /** 每张人设卡的认知权重摘要行（由调用方从 extra.profile.cognitiveWeights 格式化后传入）。
   * 非空时，在生成类任务的 prompt 中追加角色决策倾向指引。 */
  characterCognitiveWeights?: string[];
}

/** 续写只喂尾部，控制 token：末尾 TAIL_CHARS 字符足够接住文风与情节 */
export const TAIL_CHARS = 3000;

export function tailOf(text: string, chars = TAIL_CHARS): string {
  if (text.length <= chars) return text;
  return `…${text.slice(-chars)}`;
}

/** 输出语言跟随 UI 语言 */
function langNote(): string {
  return getLang() === 'en-US' ? t('ai.respondEn') : t('ai.respondZh');
}

/**
 * 文风一致性引导块（P0 文风引擎 prompt 注入）：
 * 开关开启且指纹可用时，为生成类任务（续写/润色/改写）追加「贴近既有文风画像」的约束；
 * 否则返回空串（零行为变化，兼容未传指纹的调用方）。
 */
function styleRequirementBlock(ctx: InlineWritingContext): string {
  const fp = ctx.styleFingerprint?.trim();
  if (ctx.styleConsistency !== true || !fp) return '';
  return (
    `\n\n` +
    L(
      `【文风要求】请让本次输出严格贴近以下统计画像中的句式节奏、段落密度、对话占比、标点与用词倾向，保持作者既有的语言风格；不要滑向通用、机械的表达。`,
      "[Style requirement] Match the sentence rhythm, paragraph density, dialogue ratio, punctuation, and word preference in the statistical profile below, keeping the author's existing voice; do not drift into generic, mechanical prose.",
    ) +
    `\n${fp}`
  );
}

/**
 * 认知权重引导块（T12 P1 角色决策引擎）：
 * 人设卡存在认知权重时，为生成类任务追加角色决策倾向指引，影响 AI 续写时角色的行为选择；
 * 零行为变化：无权重时返回空串。
 */
function cognitiveWeightsBlock(ctx: InlineWritingContext): string {
  if (!ctx.characterCognitiveWeights?.length) return '';
  return (
    `\n\n` +
    L(
      `【角色决策倾向】以下人物在关键情境中的认知权重如下，续写/润色/改写时请让他们的抉择、反应与行为体现这些倾向，不要只贴标签式描述：`,
      "[Character decision tendencies] The cognitive weights below guide each character's choices under pressure. Let their reactions, trade-offs and actions embody these tendencies; do not merely label them.",
    ) +
    `\n${ctx.characterCognitiveWeights.join('\n')}`
  );
}

/** 组装「续写」消息：只输出正文，禁解释、禁复述原文 */
export function buildContinueMessage(ctx: InlineWritingContext): string {
  const characterBlock = ctx.characterLines.length
    ? `${L('【人设卡】', '[Character Cards]')}\n${ctx.characterLines.join('\n')}`
    : L(
        '【人设卡】本作品还没有人设卡。请只依据下文已有内容推断人物，不要凭空设定新的人物关系。',
        '[Character Cards] None yet. Infer characters only from the text below; do not invent new relationships.',
      );
  const outlineBlock = ctx.outlineLines.length
    ? `\n\n${L('【大纲】', '[Outline]')}\n${ctx.outlineLines.join('\n')}`
    : '';
  const directiveBlock = ctx.directive?.trim()
    ? `\n\n${L('【走向要求】', '[Direction]')}\n${ctx.directive.trim()}\n${L('把以上要求融入续写内容本身；不要在输出里复述或解释这些要求。', 'Weave these requirements into the prose itself; do not restate or explain them in the output.')}`
    : '';
  const wordsLine =
    ctx.targetWords && ctx.targetWords > 0
      ? L(
          `从上面的末尾无缝接着往下写约 ${ctx.targetWords} 字，保持人称、时态、文风与已有内容一致。`,
          `Seamlessly continue from the tail above for about ${ctx.targetWords} words, keeping the same person, tense, and style as the existing text.`,
        )
      : L(
          '从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。',
          'Seamlessly continue from the tail above for 300-600 words, keeping the same person, tense, and style as the existing text.',
        );
  return (
    L(
      '请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
      'Continue the novel excerpt below. Output the continued prose only: no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    ) +
    `\n\n` +
    L(
      `【作品】${ctx.bookTitle}${ctx.bookDescription ? `：${ctx.bookDescription}` : ''}`,
      `[Book] ${ctx.bookTitle}${ctx.bookDescription ? `: ${ctx.bookDescription}` : ''}`,
    ) +
    `\n` +
    L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
    `\n\n` +
    characterBlock +
    outlineBlock +
    directiveBlock +
    styleRequirementBlock(ctx) +
    cognitiveWeightsBlock(ctx) +
    `\n\n` +
    L('【已有正文（末尾）】\n', '[Existing text (tail)]\n') +
    tailOf(ctx.chapterText) +
    `\n\n` +
    wordsLine +
    `\n\n${langNote()}`
  );
}

/** 润色风格档位 → 追加的风格要求行；default = 不附加 */
const POLISH_STYLE_LINES: Record<Exclude<PolishStyle, 'default'>, string> = {
  refine: L(
    '风格要求：精炼紧凑——删除冗余、缩短长句，字数可以明显少于原文，但不得丢失任何情节信息。',
    'Style: lean and tight — cut redundancy, shorten sentences; output may be notably shorter but must not lose any plot information.',
  ),
  vivid: L(
    '风格要求：文笔华美——强化意象与画面感，但不许堆砌辞藻到伤害可读性。',
    'Style: rich and literary — strengthen imagery, but never pile up rhetoric at the cost of readability.',
  ),
  plain: L(
    '风格要求：平实口语——贴近日常说话的质感，去掉文艺腔与书面腔。',
    'Style: plain and colloquial — close to everyday speech, drop the literary register.',
  ),
};

/** 选区级润色：前后文各取多少字符作语境（控制 token，语境够定位即可） */
export const POLISH_CONTEXT_CHARS = 500;

/** 组装「润色」消息：有选中文本 = 只润色该片段（输出可无缝拼回原文）；否则整章改写 */
export function buildPolishMessage(ctx: InlineWritingContext): string {
  const styleLine = ctx.style && ctx.style !== 'default' ? `\n${POLISH_STYLE_LINES[ctx.style]}` : '';

  // ── 选区级润色：只改选中文本，前后文仅作语境 ──
  if (ctx.selectionText && ctx.selectionText.trim().length > 0) {
    const contextBlock =
      ctx.beforeText || ctx.afterText
        ? `\n\n` +
          (ctx.beforeText
            ? L(`【选区前文（结尾）】\n${ctx.beforeText}\n`, `[Before selection (tail)]\n${ctx.beforeText}\n`)
            : '') +
          (ctx.afterText
            ? L(`【选区后文（开头）】\n${ctx.afterText}`, `[After selection (head)]\n${ctx.afterText}`)
            : '')
        : '';
    return (
      L(
        '请只润色下面的【选中片段】：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量。输出必须是润色后的片段本身，能无缝拼回原位：保持与前后文的衔接（人称、时态、语句完整性），不要输出选区之外的内容，不要解释、对照说明或总结。',
        'Polish ONLY the selected excerpt below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information. Output the polished excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text (person, tense, sentence completeness). Do not output anything beyond the excerpt; no explanations or summaries.',
      ) +
      styleLine +
      styleRequirementBlock(ctx) +
      cognitiveWeightsBlock(ctx) +
      `\n\n` +
      L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
      `\n` +
      L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
      (ctx.characterLines.length
        ? `\n\n${L('【人设卡】', '[Character Cards]')}\n${ctx.characterLines.join('\n')}`
        : '') +
      contextBlock +
      `\n\n` +
      L('【选中片段】\n', '[Selected excerpt]\n') +
      ctx.selectionText +
      `\n\n${langNote()}`
    );
  }

  // ── 整章润色（原行为）──
  return (
    L(
      '请润色下面的整章小说：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量；不得增删情节点；保留原有分段结构。直接输出润色后的全文正文：不要任何解释、对照说明或总结。',
      'Polish the chapter below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information; keep the original paragraph structure. Output the polished full text only: no explanations or summaries.',
    ) +
    styleLine +
    styleRequirementBlock(ctx) +
    cognitiveWeightsBlock(ctx) +
    `\n\n` +
    L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
    `\n` +
    L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
    (ctx.characterLines.length ? `\n\n${L('【人设卡】', '[Character Cards]')}\n${ctx.characterLines.join('\n')}` : '') +
    `\n\n` +
    L('【原文】\n', '[Original]\n') +
    ctx.chapterText +
    `\n\n${langNote()}`
  );
}

export function buildInlineMessage(kind: InlineWritingKind, ctx: InlineWritingContext): string {
  switch (kind) {
    case 'continue':
      return buildContinueMessage(ctx);
    case 'rewrite':
      return buildRewriteMessage(ctx);
    case 'summarize':
      return buildSummarizeMessage(ctx);
    case 'review':
      return buildReviewMessage(ctx);
    default:
      return buildPolishMessage(ctx);
  }
}

/**
 * 组装「改写」消息：与润色的区别是允许调整叙事节奏/句式结构（可改变行文骨架），
 * 但仍不得改变情节、人物行为、时间线与信息量。有选中文本 = 只改写该片段；否则整章改写。
 * 结果与润色走同一回写链路（选区替换 / 整章替换）。
 */
export function buildRewriteMessage(ctx: InlineWritingContext): string {
  const styleLine = ctx.style && ctx.style !== 'default' ? `\n${POLISH_STYLE_LINES[ctx.style]}` : '';

  if (ctx.selectionText && ctx.selectionText.trim().length > 0) {
    const contextBlock =
      ctx.beforeText || ctx.afterText
        ? `\n\n` +
          (ctx.beforeText
            ? L(`【选区前文（结尾）】\n${ctx.beforeText}\n`, `[Before selection (tail)]\n${ctx.beforeText}\n`)
            : '') +
          (ctx.afterText
            ? L(`【选区后文（开头）】\n${ctx.afterText}`, `[After selection (head)]\n${ctx.afterText}`)
            : '')
        : '';
    return (
      L(
        '请改写下面的【选中片段】：在**保留情节、人物行为、时间线与全部信息量**的前提下，重构表达——允许调整句式长短、段落切分、叙事节奏与措辞，让文字更有张力与可读性。**不要**改变任何故事事实，也不要输出选区之外的内容。输出必须是改写后的片段本身，能无缝拼回原位：保持与前后文的衔接（人称、时态、语句完整性）。不要解释、对照说明或总结。',
        'Rewrite ONLY the selected excerpt below: keep **all plot, character actions, timeline, and information**, but restructure the prose — you may adjust sentence length, paragraph breaks, pacing, and wording to make it more vivid and readable. Do **not** change any story facts, and do not output anything beyond the excerpt. Output the rewritten excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text (person, tense, sentence completeness). No explanations, comparisons, or summaries.',
      ) +
      styleLine +
      styleRequirementBlock(ctx) +
      cognitiveWeightsBlock(ctx) +
      `\n\n` +
      L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
      `\n` +
      L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
      (ctx.characterLines.length
        ? `\n\n${L('【人设卡】', '[Character Cards]')}\n${ctx.characterLines.join('\n')}`
        : '') +
      contextBlock +
      `\n\n` +
      L('【选中片段】\n', '[Selected excerpt]\n') +
      ctx.selectionText +
      `\n\n${langNote()}`
    );
  }

  return (
    L(
      '请改写下面的整章小说：在**保留情节、人物行为、时间线与全部信息量**的前提下，重构表达——允许调整句式长短、段落切分、叙事节奏与措辞，让文字更有张力与可读性。**不要**增删故事事实；保留原有分段结构。直接输出改写后的全文正文：不要任何解释、对照说明或总结。',
      'Rewrite the chapter below: keep **all plot, character actions, timeline, and information**, but restructure the prose — you may adjust sentence length, paragraph breaks, pacing, and wording to make it more vivid and readable. Do **not** add or remove story facts; keep the original paragraph structure. Output the rewritten full text only: no explanations, comparisons, or summaries.',
    ) +
    styleLine +
    styleRequirementBlock(ctx) +
    cognitiveWeightsBlock(ctx) +
    `\n\n` +
    L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
    `\n` +
    L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
    (ctx.characterLines.length ? `\n\n${L('【人设卡】', '[Character Cards]')}\n${ctx.characterLines.join('\n')}` : '') +
    `\n\n` +
    L('【原文】\n', '[Original]\n') +
    ctx.chapterText +
    `\n\n${langNote()}`
  );
}

/** 总结输出宽度的上限（字符）；前端预览区可滚动 */
export const SUMMARIZE_CHARS = 600;

/**
 * 组装「总结」消息：提取选中片段（或整章）的情节要点与推进信息。
 * 结果只用于预览/参考，不直接回写正文。
 */
export function buildSummarizeMessage(ctx: InlineWritingContext): string {
  if (ctx.selectionText && ctx.selectionText.trim().length > 0) {
    return (
      L(
        '请总结下面的【选中片段】：提炼这一段发生的情节、人物动向与关键信息，按「情节进展 / 关键信息」两部分组织，控制在 200 字以内。只总结选中片段本身，不要补充选段之外的情节，不要评价文笔。',
        "Summarize the selected excerpt below: extract what happens in this passage, character developments, and key information, organized into 'Plot progress / Key information', within 200 characters. Summarize only the excerpt itself; do not add events outside it, do not judge the writing.",
      ) +
      `\n\n` +
      L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
      `\n` +
      L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
      `\n\n` +
      L('【选中片段】\n', '[Selected excerpt]\n') +
      ctx.selectionText +
      `\n\n${langNote()}`
    );
  }
  return (
    L(
      '请总结本章小说：提炼本章发生的情节、人物动向与关键推进（每小节要点式列出），控制在 400 字以内。只总结本章内容，不要补充本章之外的情节，不要评价文笔。',
      'Summarize this chapter: list what happens, character developments, and key plot progress (bullet-style), within 400 characters. Cover only this chapter; do not add events outside it, do not judge the writing.',
    ) +
    `\n\n` +
    L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
    `\n` +
    L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
    `\n\n` +
    L('【原文】\n', '[Original]\n') +
    ctx.chapterText +
    `\n\n${langNote()}`
  );
}

/**
 * 组装「逐句审校」消息：逐句检查语法与病句，输出问题清单（原句 + 问题类型 + 修改建议），
 * 不修改正文、不评价文风/情节。有选中文本 = 只审校该片段；否则审校整章。
 * 结果只用于预览查看（与总结同级），不提供一键回写。
 */
export function buildReviewMessage(ctx: InlineWritingContext): string {
  const targetBlock = ctx.selectionText && ctx.selectionText.trim().length > 0 ? ctx.selectionText : ctx.chapterText;
  const targetLabel =
    ctx.selectionText && ctx.selectionText.trim().length > 0
      ? L('【选中片段】\n', '[Selected excerpt]\n')
      : L('【原文】\n', '[Original]\n');
  return (
    L(
      '请对下面的小说文本做逐句语法审校（病句检查）：\n' +
        '1. 按句子逐句检查，**只列出存在问题的句子**；无问题的句子不要列出；\n' +
        '2. 每条输出一行，用竖线 | 分隔四个字段：第N句|原句|问题类型|修改建议。原句必须是正文中的原文（可带上半句便于定位，但不得改写或省略）；问题类型从（成分残缺 / 搭配不当 / 语序不当 / 成分赘余 / 句式杂糅 / 关联词不当 / 指代不明）中选择；修改建议是可直接替换整句原句的修改后句子，不加引号和解释。示例：\n第1句|他是我的一个朋友。|成分赘余|他是我朋友。\n' +
        '3. 全文均无问题时，只输出一句「未发现明显语法问题」；\n' +
        '4. 只检查语法正确性与句子通顺度，**不要**评价文风、节奏、情节，也不要修改正文本身。',
      'Proofread the novel text below sentence by sentence (grammar correction):\n' +
        '1. Check sentence by sentence; list **only sentences with problems**, skip correct ones;\n' +
        '2. Output each entry on one line with four pipe-separated fields: SentenceN|original|issue type|suggested rewrite. The original must be verbatim from the text (you may include the leading clause for locating, but do not rephrase or trim it); pick the issue type from (missing component / improper collocation / wrong word order / redundancy / mixed sentence pattern / conjunction misuse / unclear reference); the suggested rewrite must be a ready-to-replace whole sentence without quotes or extra text. Example:\nSentence 1|他是我的一个朋友。|成分赘余|他是我朋友。\n' +
        '3. If everything is fine, output only "No obvious grammar issues found";\n' +
        '4. Check grammatical correctness and fluency only — do **not** judge style, pacing, or plot, and do not modify the text.',
    ) +
    `\n\n` +
    L(`【作品】${ctx.bookTitle}`, `[Book] ${ctx.bookTitle}`) +
    `\n` +
    L(`【当前章节】${ctx.chapterTitle}`, `[Current Chapter] ${ctx.chapterTitle}`) +
    `\n\n` +
    targetLabel +
    targetBlock +
    `\n\n${langNote()}`
  );
}

/** 逐句审校解析结果：一条可逐条确认应用的病句条目 */
export interface ReviewEntry {
  /** 模型标注的句号（第 N 句），仅用于展示 */
  index: number;
  /** 正文中的原文句（可含定位上下文），用于在正文精确查找 */
  original: string;
  /** 问题类型（成分残缺等），未给出时为空串 */
  issue: string;
  /** 可直接替换整句原句的修改后句子 */
  suggestion: string;
}

/** 审校 prompt 中固定的问题类型词：二段条目若第二段是其中之一，即为「无修改建议」的缺字段行，不可安全应用 */
const REVIEW_ISSUE_TYPES = new Set(['成分残缺', '搭配不当', '语序不当', '冗余', '句式杂糅', '关联词不当', '指代不明']);

/**
 * 解析「逐句审校」输出为可逐条应用的条目列表。
 * 主格式：每行 `第N句|原句|问题类型|修改建议`（| 或 ｜ 皆可，连接符可为冒号）；
 * 兼容缺问题类型的 3 段（第N句|原句|修改建议）。
 * 无有效条目的行（自由文本、「未发现明显语法问题」等）直接跳过；
 * 解析不确定时宁丢不猜，避免把非结构化文本误当替换对（防错改）。
 */
export function parseReviewEntries(text: string): ReviewEntry[] {
  const entries: ReviewEntry[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^第\s*(\d+)\s*句\s*([|｜：:])\s*(.+)$/);
    if (!head) continue;
    const index = Number(head[1]);
    const parts = head[3].split(/[|｜]/).map((s) => s.trim());
    let original = '';
    let issue = '';
    let suggestion = '';
    if (parts.length === 3) {
      [original, issue, suggestion] = parts;
    } else if (parts.length === 2) {
      // 二段可能是「原句|建议」也可能是缺建议的「原句|问题类型」：
      // 第二段命中问题类型词（无法给出可替换句）时不可安全应用，宁丢不猜。
      if (REVIEW_ISSUE_TYPES.has(parts[1])) continue;
      [original, suggestion] = parts;
    } else {
      continue;
    }
    original = original.trim();
    suggestion = suggestion.trim();
    if (!original || !suggestion) continue;
    const key = `${index}|${original}|${suggestion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ index, original, issue, suggestion });
  }
  return entries;
}

/**
 * 设定卡补全的上下文（全部纯文本，由调用方从 settingDraft 提取）。
 * missingKeys = 需要补全的字段英文键（如 appearance/personality/type/rules）。
 */
export type SettingCardKind = 'character' | 'worldbuilding';

export interface SettingCompletionContext {
  kind: SettingCardKind;
  /** 设定卡名称（人物名 / 世界观条目名） */
  settingName: string;
  subtitle: string;
  description: string;
  /** 已有字段值（键 → 内容；空串 = 未填） */
  existing: Record<string, string>;
  /** 需要补全的字段英文键 */
  missingKeys: string[];
}

/** 组装「设定卡补全」消息：让模型基于已有内容补缺失字段，只输出 JSON 对象 */
export function buildSettingCompletionMessage(ctx: SettingCompletionContext): string {
  const existingBlock = Object.entries(ctx.existing)
    .map(([k, v]) => `- ${k}：${v.trim() || L('（空）', '(empty)')}`)
    .join('\n');
  const kindLabel =
    ctx.kind === 'character' ? L('人物设定卡', 'Character Card') : L('世界观设定卡', 'Worldbuilding Card');
  return (
    L(
      '请根据下面的设定卡已有内容，补全缺失字段。每个字段给出贴合该卡内容的中文建议（每项 20～80 字，具体、可写作时直接使用），并与已有内容保持一致，不得自相矛盾。',
      'Complete the missing fields for the setting card below. Give a fitting Chinese suggestion for each field (20-80 characters each, concrete and directly usable while writing), consistent with existing content and free of contradictions.',
    ) +
    `\n\n` +
    L(
      `【设定卡】${kindLabel}：${ctx.settingName}${ctx.subtitle ? `（${ctx.subtitle}）` : ''}`,
      `[Card] ${kindLabel}: ${ctx.settingName}${ctx.subtitle ? ` (${ctx.subtitle})` : ''}`,
    ) +
    (ctx.description ? `\n${L(`【简介】${ctx.description}`, `[Summary] ${ctx.description}`)}` : '') +
    `\n\n` +
    L('【已有字段】\n', '[Existing fields]\n') +
    existingBlock +
    `\n\n` +
    L(`【请补全】${ctx.missingKeys.join(', ')}`, `[Complete] ${ctx.missingKeys.join(', ')}`) +
    `\n\n` +
    L(
      '只输出一个 JSON 对象：键为上述字段的英文键，值为补全内容；不要输出任何解释、前言、markdown 代码块或多余文字。',
      'Output only one JSON object: keys are the English field keys above, values are the completion content; no explanations, prefaces, markdown fences, or extra text.',
    ) +
    `\n\n${langNote()}`
  );
}

/** 宽容解析模型输出的 JSON（兼容多余的围栏/前后缀）：返回非空字段建议 */
export function parseSettingCompletion(text: string, allowedKeys: string[]): { key: string; value: string }[] {
  const tryJson = (s: string): Record<string, unknown> | null => {
    try {
      const o = JSON.parse(s);
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  // 优先整段解析；失败则剥离 ```json ``` 围栏后取第一个 {…} 片段
  let obj = tryJson(text.trim());
  if (!obj) {
    const fenced = text.replace(/```(?:json)?/gi, '').trim();
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      obj = tryJson(fenced.slice(start, end + 1));
    }
  }
  if (!obj) return [];
  return allowedKeys
    .filter((k) => typeof obj?.[k] === 'string' && (obj[k] as string).trim().length > 0)
    .map((k) => ({ key: k, value: (obj[k] as string).trim() }));
}

/**
 * 执行一次纯文本 AI 任务（会话 → 等流结束 → 后端拉回执），
 * 内联写作（续写/润色/改写/总结）、设定卡补全与资料辅助创作共用同一执行流水。
 */
export async function runAgentTextTask(opts: {
  agentId: string;
  title: string;
  message: string;
  onDelta?: (full: string) => void;
}): Promise<{ text: string; conversationId: string; interrupted?: boolean }> {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === opts.agentId);
  if (!agent) {
    throw new WritingAssistantError('指定的 Agent 不存在（可能已被删除），请重新选择', 'agent-missing');
  }
  if (state.isStreaming) {
    throw new WritingAssistantError('上一次对话仍在进行中，请稍后再试', 'busy');
  }

  const conv = await state.createConversation(opts.agentId, opts.title);
  const unsubscribe = opts.onDelta
    ? useAgentStore.subscribe((s) => {
        opts.onDelta!(s.streamingContent);
      })
    : null;
  let interrupted = false;
  try {
    await state.sendMessage(conv.id, opts.message);
  } catch (e) {
    throw new WritingAssistantError((e as Error)?.message ?? String(e), 'send-failed');
  } finally {
    if (unsubscribe) unsubscribe();
  }

  const after = useAgentStore.getState();
  if (after.stoppedConversationId === conv.id) {
    interrupted = true;
  }
  if (interrupted) {
    return { text: '', conversationId: conv.id, interrupted: true };
  }

  const messages = await agentApi.listMessages(conv.id);
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim().length > 0);
  if (!lastAssistant) {
    throw new WritingAssistantError('对话已结束，但没有拿到可用的正文输出', 'no-output');
  }
  return { text: lastAssistant.content.trim(), conversationId: conv.id };
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
  const kindTitle: Record<InlineWritingKind, string> = {
    continue: L('续写', 'Continue'),
    polish: L('润色', 'Polish'),
    rewrite: L('改写', 'Rewrite'),
    summarize: L('总结', 'Summarize'),
    review: L('逐句审校', 'Sentence Review'),
  };
  return runAgentTextTask({
    agentId: opts.agentId,
    title: `${kindTitle[opts.kind]} · ${opts.ctx.chapterTitle}`,
    message: buildInlineMessage(opts.kind, opts.ctx),
    onDelta: opts.onDelta,
  });
}

/** 执行一次设定卡补全任务，返回模型输出的 JSON 文本（由 parseSettingCompletion 解析） */
export async function runSettingCompletionTask(opts: {
  agentId: string;
  ctx: SettingCompletionContext;
  onDelta?: (full: string) => void;
}): Promise<{ text: string; conversationId: string; interrupted?: boolean }> {
  return runAgentTextTask({
    agentId: opts.agentId,
    title: `${L('设定卡补全', 'Card Completion')} · ${opts.ctx.settingName}`,
    message: buildSettingCompletionMessage(opts.ctx),
    onDelta: opts.onDelta,
  });
}

/** 纯文本 → 段落 HTML（插入 TipTap 用）；连续空行分段，段内换行保留为 <br> */
export function textToParagraphHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
