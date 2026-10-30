// 素材库「插入正文」的内容组装（纯函数，独立成模块便于单测与热更新边界干净）
//
// 背景：素材库面板此前只有 采集 / 重新分析 / 删除，采到的素材要进正文只能手抄——
// 而 WritingPage 侧插入工具链早已就位（MaterialAssistDialog 的 onInsertText →
// 同章 handleInspirationInsert / 跨章 pendingMaterialInsertRef）。本模块负责补齐
// 最后一段「素材 → 待插入文本」的口径转换。
//
// 口径由**用户在卡片菜单上选**，不在代码里替他拍板：原文、AI 创作价值、AI 建议
// 三者都可能是作者真正想写进正文的东西。取不到内容一律返回 null，
// 由调用方禁用对应菜单项——绝不插入空串在正文里造空白段落。
import type { ExternalCapture } from '../../services/writing';

/** 插入正文的内容口径：素材原文 / AI 创作价值 / AI 建议列表 */
export type CaptureInsertPart = 'raw' | 'value' | 'suggestions';

/** 卡片分析产物中与插入口径相关的字段（parseCaptureAnalysis 的返回子集） */
export interface CaptureInsertAnalysis {
  creativeValue?: string;
  suggestions?: string[] | null;
}

export function buildCaptureInsertText(
  part: CaptureInsertPart,
  capture: Pick<ExternalCapture, 'extractedText'>,
  analysis: CaptureInsertAnalysis,
): string | null {
  if (part === 'raw') {
    const text = capture.extractedText.trim();
    return text || null;
  }
  if (part === 'value') {
    const text = (analysis.creativeValue ?? '').trim();
    return text || null;
  }
  const lines = (analysis.suggestions ?? []).map((s) => s.trim()).filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : null;
}
