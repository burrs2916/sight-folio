/**
 * writingCapture —— 外部素材采集（Phase 1）的无头执行器。
 *
 * 流程链路：输入一段外部素材（图片提取文本 / 全文 / 记事本片段 / 链接摘要）
 * → AI 分析出结构化结果（人生轨迹时间线 / 人物画像 / 创作价值 / 落地建议）
 * → 前端回填 analysis_json 持久化，供素材库展示与写作台取用。
 *
 * 与 writingMaterial 同一执行流水（runAgentTextTask）：
 *   1. Agent 绝不写死：agentId 必填且必须存在；
 *   2. 结果可感知：await sendMessage 结束后从后端重新拉取该会话消息；
 *   3. 模块无关：本文件不懂 store 细节，只收纯文本上下文。
 */
import { useAgentStore } from '../store/agentStore';
import { agentApi } from '../services/tauri';
import { L } from './aiLang';
import { getLang, t } from '../i18n';
import { runAgentTextTask } from './writingAssistant';
import type { ExternalCaptureAnalysis, ExternalCaptureKind } from '../services/writing';

/** 素材分析输入上下文 */
export interface CaptureAnalysisContext {
  /** 素材类型：image / text / note / link */
  kind: ExternalCaptureKind;
  /** 素材标题（用户可编辑；空串时用默认占位） */
  title: string;
  /** 原始内容（图片为路径或提取文本、链接为 URL 等，展示给 AI 作背景） */
  sourceRaw: string;
  /** 实际被分析的文本：OCR 提取 / 全文 / 记事本内容 / 链接正文摘要 */
  extractedText: string;
  /** 用户补充说明（可选）：想要这段素材以什么方式进入作品 */
  directive?: string;
}

const KIND_LABEL_ZH: Record<ExternalCaptureKind, string> = {
  image: '图片',
  text: '文本',
  note: '记事本片段',
  link: '链接',
};

const KIND_LABEL_EN: Record<ExternalCaptureKind, string> = {
  image: 'image',
  text: 'text',
  note: 'note snippet',
  link: 'link',
};

/** 组装「外部素材分析」消息：素材文本内嵌进 prompt，AI 输出结构化 JSON */
export function buildCaptureAnalysisMessage(ctx: CaptureAnalysisContext): string {
  const kindLabel = L(KIND_LABEL_ZH[ctx.kind], KIND_LABEL_EN[ctx.kind]);
  const srcBlock = ctx.sourceRaw.trim() ? `${L('【原始素材】\n', '[Raw source]\n')}${ctx.sourceRaw.trim()}` : '';
  const textBlock = `${L('【待分析文本】\n', '[Text to analyze]\n')}${ctx.extractedText.trim()}`;
  const directiveLine = ctx.directive?.trim() ? `\n${L('【用户补充要求】', '')}${ctx.directive.trim()}` : '';
  return (
    L(
      '你是一位资深的故事编辑。下面是一份创作者收集的外部素材（类型：' +
        kindLabel +
        '）。请分析这份素材，输出严格 JSON 对象（不要输出 JSON 之外任何文字、不要用 markdown 代码块包裹），字段如下：\n' +
        '{\n' +
        '  "timeline": [\n' +
        '    { "at": "素材中出现的时间点/阶段（如「2024 年春」「第 3 年」「婚后」；无明确时间用「早期/中期/后期」），", "event": "该时间点发生的事件/状态" }\n' +
        '  ],\n' +
        '  "profile": {\n' +
        '    "appearance": "素材中浮现的人物外貌（无则省略该字段）",\n' +
        '    "personality": "素材中浮现的人物性格（无则省略该字段）",\n' +
        '    "motivation": "素材中浮现的人物动机（无则省略该字段）"\n' +
        '  },\n' +
        '  "creativeValue": "这段素材为什么值得写进故事（1-2 句）",\n' +
        '  "suggestions": ["落地建议 1：如何把素材变成情节/场景/设定", "落地建议 2：…"]\n' +
        '}\n' +
        '要求：\n' +
        '1. timeline 用 2-5 条概括素材的时间脉络，若素材本身无时间跨度，列出「现状 → 发展」即可；\n' +
        '2. profile 只写素材里真正出现的，不要虚构；\n' +
        '3. suggestions 给 2-4 条具体、可执行的做法；\n' +
        '4. 不要复述原文，聚焦可以被小说直接使用的信息。',
      'You are a senior story editor. Below is an external source collected by a creator (type: ' +
        kindLabel +
        '). Analyze it and output a strict JSON object (no text outside the JSON, no markdown code fences), with this shape:\n' +
        '{\n' +
        '  "timeline": [\n' +
        '    { "at": "a time point/phase in the source (e.g. \\"spring 2024\\", \\"year 3\\", \\"after marriage\\"; fall back to early/mid/late if unclear)", "event": "what happened / the state at that point" }\n' +
        '  ],\n' +
        '  "profile": {\n' +
        '    "appearance": "appearance of a person emerging from the source (omit if none)",\n' +
        '    "personality": "personality traits emerging from the source (omit if none)",\n' +
        '    "motivation": "motivation emerging from the source (omit if none)"\n' +
        '  },\n' +
        '  "creativeValue": "why this material is worth putting into a story (1-2 sentences)",\n' +
        '  "suggestions": ["concrete suggestion 1: how to turn it into plot/scene/setting", "suggestion 2: ..."]\n' +
        '}\n' +
        'Requirements:\n' +
        '1. timeline: 2-5 entries summarizing the time arc; if there is no time span, list "current state -> development";\n' +
        '2. profile: only what truly appears in the source, do not fabricate;\n' +
        '3. suggestions: 2-4 concrete, actionable ideas;\n' +
        '4. Do not restate the source; focus on information directly usable in fiction.',
    ) + `\n\n${srcBlock ? `${srcBlock}\n\n` : ''}${textBlock}${directiveLine}\n\n${langNote()}`
  );
}

/** 执行一次素材分析任务，复用 runAgentTextTask 流水线 */
export async function runCaptureTask(opts: {
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

/** 供 UI 在打开对话框时校验 agent 是否可用（与 writingMaterial.assertMaterialAgent 同语义） */
export function assertCaptureAgent(agentId: string): void {
  const state = useAgentStore.getState();
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error('指定的 Agent 不存在（可能已被删除），请重新选择');
  }
  if (state.isStreaming) {
    throw new Error('上一次对话仍在进行中，请稍后再试');
  }
}

/** 供 UI 在结束对话后重新拉最新消息（与 runAgentTextTask 内部同源） */
export async function fetchCaptureLastText(conversationId: string): Promise<string> {
  const messages = await agentApi.listMessages(conversationId);
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim().length > 0);
  return last?.content.trim() ?? '';
}

/** 从模型输出中剥离可能的 markdown 代码块围栏，尝试解析 JSON；解析失败返回 null。 */
export function tryParseCaptureJson(text: string): Record<string, unknown> | null {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function langNote(): string {
  return getLang() === 'en-US' ? t('ai.respondEn') : t('ai.respondZh');
}

/**
 * 把 AI 输出的松散 JSON 规范化成结构化分析结果（timeline/profile/creativeValue/suggestions）。
 * 面板「重新分析」与采集对话框共用同一口径：字段缺失/类型不符一律降级为 undefined，绝不抛错。
 */
export function normalizeCaptureAnalysis(parsed: Record<string, unknown>): ExternalCaptureAnalysis {
  return {
    timeline: Array.isArray(parsed.timeline)
      ? (parsed.timeline as ExternalCaptureAnalysis['timeline'])
      : undefined,
    profile:
      parsed.profile && typeof parsed.profile === 'object'
        ? (parsed.profile as ExternalCaptureAnalysis['profile'])
        : undefined,
    creativeValue: typeof parsed.creativeValue === 'string' ? parsed.creativeValue : undefined,
    suggestions: Array.isArray(parsed.suggestions) ? (parsed.suggestions as string[]) : undefined,
  };
}
