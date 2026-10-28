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
export function buildMaterialAnalysisMessage(files: MaterialSourceFile[]): string {
  const fileBlocks = files
    .map((f, i) => `${L(`【资料 ${i + 1}】${f.name}`, `[Source ${i + 1}] ${f.name}`)}\n${f.excerpt}`)
    .join('\n\n');
  return (
    L(
      '你是一位资深的编辑和资料分析师。下面是从创作者的资料目录中读取的若干文本资料。请分析这些资料，输出一份结构化的「资料分析」，供后续小说创作使用。\n' +
        '分析请覆盖以下几点（按需取用，不必每条都写满）：\n' +
        '1. 资料主题与核心信息：每份资料讲了什么，相互之间有什么关联；\n' +
        '2. 可用的世界观/背景设定：时代、地点、规则、组织、行业等；\n' +
        '3. 可用的角色素材：人物身份、性格、关系、动机；\n' +
        '4. 可用的情节/事件素材：冲突、转折、可供改编的桥段；\n' +
        '5. 细节质感：可以点缀正文的器物、习俗、术语、氛围描写；\n' +
        '6. 创作建议：这些资料适合写成什么样的故事，怎么用最出效果。\n' +
        '请用简洁的分点输出，不要复述原文，聚焦可以直接被小说使用的信息。',
      'You are a senior editor and research analyst. Below are text files read from a creator\'s material directory. Analyze these materials and produce a structured "material digest" for later fiction writing.\n' +
        'Cover these points as applicable (not every point needs to be fully written):\n' +
        '1. Theme & core info: what each source is about and how they relate;\n' +
        '2. Usable worldbuilding/settings: era, places, rules, organizations, industries;\n' +
        '3. Usable character material: identity, personality, relationships, motivation;\n' +
        '4. Usable plot/event material: conflicts, turns, adaptable episodes;\n' +
        '5. Sensory details: objects, customs, terms, atmosphere that can enrich prose;\n' +
        '6. Writing suggestions: what kind of story suits these materials and how to use them best.\n' +
        'Output concise bullet points; do not restate the source text; focus on information directly usable in fiction.',
    ) + `\n\n${fileBlocks}\n\n${langNote()}`
  );
}

/** 组装「生成正文草稿」消息：资料分析 + 目标章上下文注入 */
export function buildMaterialDraftMessage(ctx: MaterialDraftContext): string {
  const tail = ctx.chapterText.trim();
  const tailBlock = tail
    ? `${L('【目标章已有正文】\n', '[Existing chapter text]\n')}${tailOf(ctx.chapterText, 2500)}`
    : L(
        '【目标章正文】本章还没有正文，请从开头直接展开。',
        '[Chapter text] This chapter has no content yet; start from the beginning.',
      );
  const directiveLine = ctx.directive?.trim() ? `\n${L('【用户补充要求】', '')}${ctx.directive.trim()}` : '';
  return (
    L(
      '你是一位网文写手。请根据下面的【资料分析】与【目标章信息】，为指定章节生成正文草稿。\n' +
        '要求：\n' +
        '1. 直接输出正文本身，不要输出标题、解释、前言或结尾说明；\n' +
        '2. 与已有正文的文风、视角、人称保持一致，自然衔接，不要重复已有内容；\n' +
        '3. 充分使用资料分析中的素材，但不要生硬堆砌术语；\n' +
        '4. 分成自然段落，单段不要太长；\n' +
        '5. 字数控制在 800～2000 字左右（根据情节需要自然增减）。',
      'You are an online-fiction writer. Based on the [material digest] and [target chapter info] below, write the draft of the target chapter.\n' +
        'Requirements:\n' +
        '1. Output only the prose itself; no titles, explanations, preambles or closing notes;\n' +
        '2. Keep consistent voice, POV and tone with existing text; continue naturally without repeating it;\n' +
        '3. Use the digest material substantially, but do not stuff in jargon mechanically;\n' +
        '4. Write in natural paragraphs, avoiding overly long ones;\n' +
        '5. Aim for around 800–2000 characters (adjust naturally to the plot).',
    ) +
    `\n\n${L('【资料分析】\n', '[Material digest]\n')}${ctx.analysis}` +
    `\n\n${L('【目标作品】', '[Target book] ')}${ctx.bookTitle}` +
    `\n${L('【目标章节】', '[Target chapter] ')}${ctx.chapterTitle}` +
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
