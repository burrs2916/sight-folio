// sight-folio: 纯文本偏移 ↔ 编辑器 doc position 映射（批次③ T5）
// 与 TipTap editor.getText()（默认 blockSeparator '\n\n'）保持同一展平规则，
// 以便 runProofread 在 getText() 上得到的 start/end 能精确映射回 ProseMirror position。
import type { Node as PMNode } from '@tiptap/pm/model';

export interface TextIndex {
  text: string;
  /** 每个字符（含 '\n\n' 分隔符）对应的 doc position；分隔符位置仅用于占位，不参与定位 */
  pos: number[];
}

/** 把 doc 按 getText() 规则展平为字符索引，同时记录每个字符的 doc position */
export function buildTextIndex(doc: PMNode): TextIndex {
  const chars: string[] = [];
  const pos: number[] = [];
  let separated = true;
  const push = (ch: string, p: number) => {
    chars.push(ch);
    pos.push(p);
  };
  doc.nodesBetween(0, doc.content.size, (node, nodePos) => {
    if (node.isText && node.text) {
      const t = node.text;
      for (let i = 0; i < t.length; i++) push(t[i], nodePos + i);
      separated = false;
      return false;
    }
    if (node.isLeaf) {
      // leafText 未配置（与 editor.getText() 默认一致）：不产生字符，但重置 separated 语义未变
      separated = false;
      return false;
    }
    if (!separated && node.isBlock) {
      push('\n', nodePos);
      push('\n', nodePos);
      separated = true;
    }
    return true;
  });
  return { text: chars.join(''), pos };
}

/** 把文本区间 [start, end)（getText() 下标）映射为 doc selection 区间；越界或跨分隔符时尽量收敛 */
export function textRangeToPos(index: TextIndex, start: number, end: number): { from: number; to: number } | null {
  if (start < 0 || end > index.text.length || start >= end) return null;
  const from = index.pos[start];
  // to：end-1 是最后一个选中字符；+1 使其右开区间覆盖到该字符末尾
  const lastPos = index.pos[end - 1];
  const to = lastPos + 1;
  if (from === undefined || lastPos === undefined) return null;
  return { from, to };
}

/**
 * 把 doc position（光标/选区锚点）映射回 getText() 文本偏移。
 * 语义：该 doc pos 之前（左侧）的展平字符数，即 lowerBound(pos, docPos)。
 * 供「插入前后两次 buildTextIndex」用：
 * 插入前光标文本偏移 start = docPosToTextOffset(before, from)，
 * 插入后 end = start + (after.text.length - before.text.length)。
 */
export function docPosToTextOffset(index: TextIndex, docPos: number): number {
  const a = index.pos;
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < docPos) lo = mid + 1;
    else hi = mid;
  }
  // 段落边界（块起点）特判：buildTextIndex 将 '\n\n' 分隔符成对记录在块 pos 上，
  // 光标停在段首时分隔符左侧字符全部位于光标左，需跳过整组分隔符位（lowerBound 会把它们算进右侧）。
  // 例：'abc\ndef' 光标停第二段首（docPos=块起点），文本偏移应为 5（'abc'+2 分隔符）而非 3。
  if (a[lo] === docPos && a[lo + 1] === docPos) return lo + 2;
  return lo;
}
