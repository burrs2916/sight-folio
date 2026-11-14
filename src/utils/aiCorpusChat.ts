// sight-folio: AI 语料参谋（P1 对话式参考 / P2 一键生成）· 纯函数与提示词约定
//
// 职责边界：
// - 与 agent 会话/流式、UI 无耦合，单测直跑（不 mock 任何模块）。
// - corpusSystemHintFor：首轮注入的「语料参谋」人设（按体裁，㉟ AI-5）+ 推荐句输出格式约定
//   （格式约定与 extractAiCorpusPicks 的解析规则必须同步维护，改一边必须改另一边）。
// - extractAiCorpusPicks：从 AI 回复中提取「>>> 行」作为可直接插入正文的推荐句。
// - buildCorpusGeneratePrompt：P2 一键生成的指令构造（条数 + 用途 + 体裁轻参数，双语）。
import { L } from '../ai/aiLang';
import { workbenchCommandSet } from './writingSchema';
import type { CorpusSearchHit } from '../services/corpus';
import type { AiMessage } from '../services/tauri';

/**
 * 语料参谋人设段（㉟ AI-5，2026-11-10 轮 12）：按体裁说各体裁的话。
 *
 * 病灶（状态文件 §队列 AI-5）：这段写死「结构/人物/世界观/风格」与「当前章节」——
 * 诗集没有世界观栏（⑮-2 裁掉的页签），诗的单位也不是章。novel 一格 = 改造前逐字
 * （零回归线）；其余四支只换「结合什么 + 单位名」，**输出格式契约与人味约束原样共用**
 * （那两段与 `extractAiCorpusPicks` 的解析规则锁死，改一边必须改另一边，不许随体裁漂移）。
 */
const CORPUS_PERSONA: Record<'novel' | 'essay' | 'poetry' | 'script' | 'diary', string> = {
  novel: '你现在的身份是「本书语料参谋」。请结合整篇作品（结构/人物/世界观/风格）与当前章节上下文作答，给出明确建议：这句是否可参考、参考哪句、直接引用还是改写、是否建议由你重写一段。',
  essay: '你现在的身份是「本散文集语料参谋」。请结合整部散文集（篇目编排、各篇立意与素材、语感）与当前篇目上下文作答，给出明确建议：这句是否可参考、参考哪句、直接引用还是改写、是否建议由你重写一段。',
  poetry: '你现在的身份是「本诗集语料参谋」。请结合整部诗集（分行与形式、意象系统、节奏与语感）与当前诗作上下文作答，给出明确建议：这句是否可参考、参考哪句、直接引用还是改写、是否建议由你重写一节（按分行，不要排成散文段落）。',
  script: '你现在的身份是「本剧本语料参谋」。请结合整部剧本（幕场结构、人物与冲突、台词与舞台指示）与当前场次上下文作答，给出明确建议：这句台词是否可参考、参考哪句、直接引用还是改写、是否建议由你重写一段对白（角色名起行、台词另起一行）。',
  diary: '你现在的身份是「本日记语料参谋」。请结合这部日记（条目时间线、各天提到的人与事、当天的语气）与当天条目上下文作答，给出明确建议：这句是否可参考、参考哪句、直接引用还是改写；**不得替作者补写那天没记的事**。',
};

/** 首轮注入的语料参谋系统提示（人设按体裁；配合 buildChatContext 的整篇+本单位素材） */
export function corpusSystemHintFor(genre: string): string {
  return `${CORPUS_PERSONA[workbenchCommandSet(genre)]}

本消息后的对话需求都属于语料参考决策。每当你给出「可直接插入正文的句子」时，请将每个句子单独成行，并以 ">>> " 开头（例如：>>> 他攥着信纸的手又紧了几分。）。这些行会被前端解析为可一键插入的推荐句；非推荐句正文一律不要使用 ">>> " 前缀。

写作人味约束（对你所有回答与推荐句生效，目标是避免让用户感到"AI 味/情感空洞"）：
1. 避免机械感：句子长短交替，允许口语化的断点与不完美；
2. 禁用模板套话：不使用"首先/其次/最后""值得注意的是""总而言之""不是……而是……"等连接套路；
3. 具体优先：用可感细节（动作、感官、具体物件）代替抽象评价，不得用空泛形容词堆叠情感；
4. 情节大于铺陈：关键情节要有实质推进，不得靠堆砌心理与环境描写凑篇幅；
5. 给立场：明确倾向与判断，不回避表态，不用含糊词语填充。`;
}

/** 从 AI 回复中提取推荐句（每条以 ">>> " 开头单独成行）；无推荐句返回空数组 */
export function extractAiCorpusPicks(text: string): string[] {
  if (!text) return [];
  const picks: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('>>>')) continue;
    const rest = line.replace(/^>>>+\s*/, '').trim();
    if (rest) picks.push(rest);
  }
  return picks;
}

/** 一键生成的「用途」轻参数（dialogue=对白 / action=动作 / scene=环境；auto=智能默认） */
export type CorpusGeneratePurpose = 'dialogue' | 'action' | 'scene' | 'auto';

/** 用途在指令里的中文描述（发给 AI 的语气词） */
const PURPOSE_ZH: Record<CorpusGeneratePurpose, string> = {
  dialogue: '以对白为主',
  action: '以动作描写为主',
  scene: '以环境描写为主',
  auto: '由你按当前场景择优（对白/动作/环境不限）',
};

/** 用途在指令里的英文描述 */
const PURPOSE_EN: Record<CorpusGeneratePurpose, string> = {
  dialogue: 'dialogue-focused',
  action: 'action-description-focused',
  scene: 'environment-description-focused',
  auto: 'pick the best fit for the scene (dialogue/action/scenery)',
};

/** 一键生成指令里的单位口径（㉟ AI-5：novel = 改造前逐字「当前章节 / current chapter」） */
const GEN_UNIT_ZH: Record<'novel' | 'essay' | 'poetry' | 'script' | 'diary', string> = {
  novel: '当前章节',
  essay: '当前篇目',
  poetry: '当前诗作',
  script: '当前场次',
  diary: '当天条目',
};
const GEN_UNIT_EN: Record<'novel' | 'essay' | 'poetry' | 'script' | 'diary', string> = {
  novel: 'current chapter',
  essay: 'current piece',
  poetry: 'current poem',
  script: 'current scene',
  diary: "today's entry",
};

/**
 * 构造「一键生成语料」指令（P2）。
 * 要求 AI 直接输出 count 条「>>> 」推荐句，不做过程解释；配合 corpusSystemHintFor 使用。
 */
export function buildCorpusGeneratePrompt(opts: {
  count: number;
  purpose: CorpusGeneratePurpose;
  /** 作品体裁（空/未设/脏值 = 小说口径，改造前逐字零回归） */
  genre?: string;
}): string {
  const count = Math.min(5, Math.max(1, Math.floor(opts.count)));
  const variant = workbenchCommandSet(opts.genre);
  return L(
    `请直接生成 ${count} 条可用于${GEN_UNIT_ZH[variant]}的参考句（${PURPOSE_ZH[opts.purpose]}，风格贴合本书），逐条单独成行并以 ">>> " 开头，不要输出其他内容。`,
    `Please directly generate ${count} reference sentences usable in the ${GEN_UNIT_EN[variant]} (${PURPOSE_EN[opts.purpose]}, matching the book style), one per line each starting with ">>> ", and output nothing else.`,
  );
}

// ─── C2 找范例：对话前置检索（意图识别 + 库内原文证据块） ───
// 设计：
// - detectExampleRequest：识别「找范例/例句/怎么写/借鉴」类意图并返回用于检索的关键词，
//   非找范例请求返回 null（发送链路完全不触发检索，不打扰普通参谋对话）。
// - buildCorpusEvidenceBlock：把 corpusApi.search 召回的 CorpusSearchHit 拼成
//   「库内原文证据块」附在用户消息之后——AI 优先引用/拆解库内句子并保留出处，
//   无命中时明确告知 AI「不要凭空编造语料库引用」，避免幻觉出处。

/**
 * 找范例意图词（匹配即视为请求库内范例参考；双语少量覆盖）。
 * 刻意不放「参考」裸词：洗稿「参考这本书的风格」等整体参考请求不算找例句，
 * 避免误伤普通参谋对话；组合式表达（怎么参考/参考句式/这句该怎么参考）已单独覆盖。
 */
const EXAMPLE_INTENT_RE =
  /(范文|范例|例句|示例|样例|例子|参考句式|参考句子|这句该怎么参考|怎么参考|怎么写|如何写|怎么描写|如何描写|怎么表达|如何表达|借鉴|模仿|仿写|照(着|这)(写|样)|像(这样|这么)(写|表达)|类似的(句子|写法|描写|表达|句式)?|有没有类似|举例|举个例子|有没有例子|example|examples)/;

/**
 * 判定文本是否为「找范例」类请求；命中返回去除意图短语后的检索关键词（非空），
 * 未命中或不适用返回 null。
 * @example detectExampleRequest('帮我找几个写雨的例句') // → '帮我找几个写雨'
 * @example detectExampleRequest('帮我分析本章基调') // → null（不打扰既有 chip 语义）
 */
export function detectExampleRequest(text: string): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const m = t.match(EXAMPLE_INTENT_RE);
  if (!m) return null;
  // 去掉意图短语后剩余文本即检索主题（「帮我找几个写雨的例句」→「帮我找几个写雨」）
  const rest = t
    .replace(m[0], '')
    .replace(/^[，,。.!！？?、；;\s]+|[，,。.!！？?、；;\s]+$/g, '')
    .trim();
  return rest.length >= 2 ? rest : t;
}

/** 证据块内单条命中的展示格式（保留书名·章节出处，供 AI 引用时追溯） */
function formatHitLine(hit: CorpusSearchHit): string {
  const source = hit.chapterTitle ? `《${hit.bookTitle} · ${hit.chapterTitle}》` : `《${hit.bookTitle}》`;
  return `- ${source} ${hit.content}`;
}

// ─── 展示链路剥离：系统提示词（自动注入前缀）不出现在用户看到的对话气泡/复制内容里 ───
// 设计：
// - 首轮注入会把人设 + 写作上下文 + "---" 分隔符整体拼进 user 消息 content 并落库，
//   重拉历史后直接渲染 content 会把系统提示词显示给用户。此处提供纯函数还原用户原文，
//   仅供 UI 展示与复制；发送给模型的内容（完整 content）不受影响。
// - 剥离依靠固定分隔符 "\n\n---\n\n" 定位注入前缀（HINT/ctx 的内容是动态的，不能做前缀匹配），
//   再剔除 C2 找范例时附加在用户原文之后的库内原文证据块（双语两种形态）。

/**
 * 从落库用户消息 content 中剥离自动注入的系统提示词前缀与证据块，还原用户手动输入的原文。
 * 注入形态（首轮）：
 *   AiCorpusPanel:      {HINT}\n\n{ctx}\n\n---\n\n{text}          （可选追加 \n\n{evidence}）
 *   WritingAiChatDialog: {ctx}\n\n---\n\n{text}
 * 后续轮次（无注入）：{text} → 原样返回（不含分隔符，不误伤）。
 */
export function stripInjectedSystemPrefix(content: string): string {
  if (!content) return content;
  const sep = '\n\n---\n\n';
  const idx = content.lastIndexOf(sep);
  if (idx === -1) return content;
  let visible = content.slice(idx + sep.length);
  // 剥离 C2 证据块（双语；「有命中」/「无命中」两种开头一次性匹配）
  visible = visible
    .replace(/\n\n【语料库检索(?:证据)?】[\s\S]*$/u, '')
    .replace(/\n\n\[Corpus (?:evidence|search)\][\s\S]*$/u, '');
  return visible;
}

/** 把落库消息列表转为展示态：仅保留 user/assistant，并剥离 user 消息中的系统提示词前缀 */
export function sanitizeDisplayMessages(rows: AiMessage[]): AiMessage[] {
  return rows
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => (m.role === 'user' ? { ...m, content: stripInjectedSystemPrefix(m.content) } : m));
}

/**
 * 构造「库内原文证据块」（双语框架 + 原文句子），追加到用户消息之后供 AI 参考。
 * - 有命中：按参考价值分层排序（high > medium > low）取前 6 条，要求 AI 优先引用/拆解并保留出处；
 * - 无命中：明确告知本次检索无结果，要求 AI 直接作答、不得声称引用语料库原文（防幻觉出处）。
 */
export function buildCorpusEvidenceBlock(hits: CorpusSearchHit[], query?: string): string {
  if (!hits || hits.length === 0) {
    return L(
      `【语料库检索】已检索语料库，未找到与「${query ?? ''}」直接相关的现成例句。请基于你的写作知识直接作答；不要声称引用了语料库原文。`,
      `[Corpus search] No existing sentences in the corpus matched "${query ?? ''}". Answer from your own writing knowledge; do not claim to quote corpus text.`,
    );
  }
  const tierOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...hits].sort(
    (a, b) => (tierOrder[a.referenceTier ?? 'medium'] ?? 1) - (tierOrder[b.referenceTier ?? 'medium'] ?? 1),
  );
  const top = sorted.slice(0, 6);
  const lines = top.map(formatHitLine).join('\n');
  return L(
    `【语料库检索证据】已从语料库召回 ${hits.length} 条与本次请求相关的现成例句，下列按参考价值排序展示其中 ${top.length} 条。请优先基于这些库内原文作答：可直接引用合适的句子，或拆解其手法（节奏/用词/视角/细节）后改写；引用时须保留出处（书名·章节）。若都不适用，请明确说明，不要凭空编造「范例」。\n\n${lines}`,
    `[Corpus evidence] ${hits.length} existing sentences were retrieved from the corpus (top ${top.length} by reference value below). Prefer answering from this library text: quote a fitting sentence directly, or dissect its craft (rhythm / wording / point of view / detail) and rewrite. Always keep the source (book · chapter) when quoting. If none fits, say so explicitly instead of fabricating an "example".\n\n${lines}`,
  );
}
