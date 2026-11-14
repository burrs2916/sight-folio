/**
 * writingMaterial —— 资料辅助创作（M1）的无头执行器。
 *
 * 流程链路：选资料目录 → 读取文本文件（.txt/.md 等）→ AI 分析资料
 * → 选目标作品/章 → AI 生成正文草稿 → 回填编辑器。
 *
 * 与 writingAssistant 内联任务同一执行流水（runAgentTextTask）：
 *   1. Agent 绝不写死：agentId 必填且必须存在；
 *   2. 结果可感知：await sendMessage 结束后从后端重新拉取该会话消息；
 *   3. 模块无关：本文件不懂 TipTap、不懂 store 细节，只收纯文本上下文。
 */
import { useAgentStore } from '../store/agentStore';
import { agentApi } from '../services/tauri';
import { L } from './aiLang';
import { getLang, t } from '../i18n';
import { runAgentTextTask } from './writingAssistant';
import { genrePromptPack } from './genrePromptPack';

/** 目录内一份资料文件（已截断的省流视图） */
export interface MaterialSourceFile {
  /** 文件名（含扩展名） */
  name: string;
  /** 绝对路径 */
  path: string;
  /** 截断后的文本内容（用于 prompt） */
  excerpt: string;
  /** 原始字数（用于 UI 展示） */
  charCount: number;
}

/** 资料分析 → 草稿生成的上下文 */
export interface MaterialDraftContext {
  /** 作品标题 */
  bookTitle: string;
  /**
   * 作品体裁（genre id）。体裁在这里改变三件事：**谁在写**（小说=网文写手 / 散文=散文作者 /
   * 诗=诗歌作者 / 剧本=剧作者）、**排成什么形状**（分行 / 对白格式 / 自然段）、**多长算正常**
   * （诗 8～30 行、剧本一个冲突回合、日记不铺陈、小说 800～2000 字）。
   * 日记还多一条硬线：**只许整理资料里已写明的事实，不足就说资料不足**，不许凭空生成一天的经历。
   * 空 = 沿用小说口径（旧书零回归）。
   */
  genre?: string;
  /** 章节标题 */
  chapterTitle: string;
  /** 目标章已有正文（纯文本，用于衔接；可为空串） */
  chapterText: string;
  /** 资料分析结果（上一步 AI 输出） */
  analysis: string;
  /** 用户补充的生成指令（可选） */
  directive?: string;
}

/** 组装「资料分析」消息：目录内文件内容内嵌进 prompt，让 AI 提炼可用素材 */
export function buildMaterialAnalysisMessage(files: MaterialSourceFile[], genre?: string): string {
  // 落点名词查表（AI-1-1 ㉕）。只换名词，不换那六条分析维度 —— 诗的素材真正该问的是
  // 意象与情绪、不是世界观与情节，那是 S21 的欠账（6 条 × 4 体裁 × 2 语言），不混进这一刀。
  const n = genrePromptPack(genre).material.digestNoun;
  const fileBlocks = files
    .map((f, i) => `${L(`【资料 ${i + 1}】${f.name}`, `[Source ${i + 1}] ${f.name}`)}\n${f.excerpt}`)
    .join('\n\n');
  return (
    L(
      '你是一位资深的编辑和资料分析师。下面是从创作者的资料目录中读取的若干文本资料。请分析这些资料，输出一份结构化的「资料分析」，供后续' +
        n.zh +
        '创作使用。\n' +
        '分析请覆盖以下几点（按需取用，不必每条都写满）：\n' +
        '1. 资料主题与核心信息：每份资料讲了什么，相互之间有什么关联；\n' +
        '2. 可用的世界观/背景设定：时代、地点、规则、组织、行业等；\n' +
        '3. 可用的角色素材：人物身份、性格、关系、动机；\n' +
        '4. 可用的情节/事件素材：冲突、转折、可供改编的桥段；\n' +
        '5. 细节质感：可以点缀正文的器物、习俗、术语、氛围描写；\n' +
        '6. 创作建议：这些资料适合写成什么样的故事，怎么用最出效果。\n' +
        '请用简洁的分点输出，不要复述原文，聚焦可以直接被' + n.zh + '使用的信息。',
      'You are a senior editor and research analyst. Below are text files read from a creator\'s material directory. Analyze these materials and produce a structured "material digest" for later ' +
        n.enWrite +
        ' writing.\n' +
        'Cover these points as applicable (not every point needs to be fully written):\n' +
        '1. Theme & core info: what each source is about and how they relate;\n' +
        '2. Usable worldbuilding/settings: era, places, rules, organizations, industries;\n' +
        '3. Usable character material: identity, personality, relationships, motivation;\n' +
        '4. Usable plot/event material: conflicts, turns, adaptable episodes;\n' +
        '5. Sensory details: objects, customs, terms, atmosphere that can enrich prose;\n' +
        '6. Writing suggestions: what kind of story suits these materials and how to use them best.\n' +
        'Output concise bullet points; do not restate the source text; focus on information directly usable in ' + n.enFocus + '.',
    ) + `\n\n${fileBlocks}\n\n${langNote()}`
  );
}

/** 组装「生成正文草稿」消息：资料分析 + 目标章上下文注入 */
export function buildMaterialDraftMessage(ctx: MaterialDraftContext): string {
  const tail = ctx.chapterText.trim();
  // 体裁差异全部住 pack.material（AI-1-1 ㉕）：**谁在写**（draftPrompt）、**排成什么形状**
  // （draftPrompt 的行型条）、**多长算正常**（draftPrompt 的体量条）、正文单位的名词
  // （draftTailLabel / draftTailEmpty / draftTargetLabel）。小说一格与改造前逐字相同。
  const pack = genrePromptPack(ctx.genre).material;
  const tailBlock = tail
    ? `${L(pack.draftTailLabel.zh, pack.draftTailLabel.en)}${tailOf(ctx.chapterText, 2500)}`
    : L(pack.draftTailEmpty.zh, pack.draftTailEmpty.en);
  const directiveLine = ctx.directive?.trim() ? `\n${L('【用户补充要求】', '')}${ctx.directive.trim()}` : '';
  // 体裁真正改变的是三件事：**谁在写**、**排成什么形状**、**多长算正常**——三件全部
  // 住 pack.material.draftPrompt（AI-1-1 ㉕）。小说一格是 HEAD 原文逐字抄回（不是插值
  // 拼出来的），散文沿用上一刀的措辞；拼插值看似省两行，实际会悄悄改掉历史文案
  // （'目标章信息' ≠ '目标章节信息' 就是这次撞出来的）。资料生稿把诗当 800～2000 字
  // 的网文段落生成，是 2026-11-09 审计 §1 第 11 条——它现在是表里的一格，不再是一条链。
  const zhPrompt = pack.draftPrompt.zh;
  const enPrompt = pack.draftPrompt.en;
  return (
    L(zhPrompt, enPrompt) +
    `\n\n${L('【资料分析】\n', '[Material digest]\n')}${ctx.analysis}` +
    `\n\n${L('【目标作品】', '[Target book] ')}${ctx.bookTitle}` +
    `\n${L(pack.draftTargetLabel.zh, pack.draftTargetLabel.en)}${ctx.chapterTitle}` +
    `\n\n${tailBlock}${directiveLine}\n\n${langNote()}`
  );
}

/** 执行一次资料辅助任务（分析或生成），复用 runAgentTextTask 流水线 */
export async function runMaterialTask(opts: {
  agentId: string;
  title: string;
  message: string;
  onDelta?: (full: string) => void;
}): Promise<{ text: string; conversationId: string; interrupted?: boolean }> {
  return runAgentTextTask({
    agentId: opts.agentId,
    title: opts.title,
    message: opts.message,
    onDelta: opts.onDelta,
  });
}

/** 取文本尾部（与 writingAssistant.tailOf 同语义，避免跨模块 import 私有符号） */
function tailOf(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `…${text.slice(-maxChars)}`;
}

function langNote(): string {
  return getLang() === 'en-US' ? t('ai.respondEn') : t('ai.respondZh');
}

/** 供 UI 在打开对话框时校验 agent 是否可用 */
export function assertMaterialAgent(agentId: string): void {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error('指定的 Agent 不存在（可能已被删除），请重新选择');
  }
  if (state.isStreaming) {
    throw new Error('上一次对话仍在进行中，请稍后再试');
  }
}

/** 供 UI 在结束对话后重新拉最新消息（与 runAgentTextTask 内部同源，单独暴露用于恢复会话状态） */
export async function fetchLastAssistantText(conversationId: string): Promise<string> {
  const messages = await agentApi.listMessages(conversationId);
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim().length > 0);
  return last?.content.trim() ?? '';
}
