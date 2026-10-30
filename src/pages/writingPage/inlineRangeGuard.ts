// 内联 AI 落点防漂移校验（需求缺口④，2026-10-31 第七轮）
//
// 病灶：润色/改写带选区时，inlineSelectionRef 存的是「发起生成那一刻」的 doc 位置
// （from/to）。内联 AI 一跑 30s+，期间用户继续在编辑器里改字——选区前后插入、删改都会
// 让旧 from/to 漂移。点「应用」时若仍按旧区间写，会把 AI 文本替换到错误区间（同章内不
// 会崩，但落点非预期；若旧区间已被删短，insertContentAt 还可能整块误吞相邻内容）。
//
// 修法口径与「逐句审校逐条应用」一致：应用前用发起时记下的选区文本做锚点重定位。
// - exact：当前 doc 在该 from/to 上的文本与锚点一致 → 用原区间（零回归路径）；
// - moved：原区间已漂移，但锚点文本在全文唯一命中 → 重定位到新区间；
// - lost：锚点文本已不存在（被删/被改），或出现多次无法消歧 → 调用方须拒绝写入并提示。
//
// 绝不静默往过期区间里写——这是 AI↔正文联动的最后一道落点防线。
import type { Node as PMNode } from '@tiptap/pm/model';
import { buildTextIndex, textRangeToPos } from '../../editor/proofread/locate';

export type InlineRangeCheck =
  | { status: 'exact'; range: { from: number; to: number } }
  | { status: 'moved'; range: { from: number; to: number } }
  | { status: 'lost' };

/**
 * @param doc 当前编辑器文档（应用那一刻的实时状态）
 * @param range 发起生成时记录的选区 doc 位置
 * @param anchorText 发起生成时记录的选区文本（锚点）
 */
export function verifyInlineRange(
  doc: PMNode,
  range: { from: number; to: number },
  anchorText: string,
): InlineRangeCheck {
  if (!anchorText) return { status: 'lost' };
  if (range.from < 0 || range.from >= range.to) return { status: 'lost' };
  // 原区间未漂移：按旧 from/to 取出的文本仍是锚点原文 → 直接用，零回归
  try {
    // blockSeparator 与捕获口径（buildInlineContext 用 '\n\n'）保持一致
    if (range.to <= doc.content.size + 1 && doc.textBetween(range.from, range.to, '\n\n') === anchorText) {
      return { status: 'exact', range };
    }
  } catch {
    // from/to 已越出当前 doc 合法边界（内容被删短）→ 落到重定位分支
  }
  // 漂移：按锚点文本在全文重定位。锚点出现 >1 次时无法消歧，判 lost 让用户重新框选，
  // 不猜测落点——宁可拒绝，不可误写。
  const index = buildTextIndex(doc);
  const first = index.text.indexOf(anchorText);
  if (first < 0) return { status: 'lost' };
  if (index.text.indexOf(anchorText, first + 1) >= 0) return { status: 'lost' };
  const relocated = textRangeToPos(index, first, first + anchorText.length);
  if (!relocated) return { status: 'lost' };
  return { status: 'moved', range: relocated };
}
