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
