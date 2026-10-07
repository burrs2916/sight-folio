// 章节编辑器文本工具：字数统计 / 章节内查找替换
import type { MatchRange } from './types';

import { type Editor } from '@tiptap/react';

export function chapterWordCount(editor: Editor): number {
  // 中文按字符数计（不含空白），与网文平台口径一致
  return editor.getText().replace(/\s/g, '').length;
}

export function findMatches(editor: Editor, query: string): MatchRange[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: MatchRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const text = node.text.toLowerCase();
      let idx = text.indexOf(q);
      while (idx >= 0) {
        out.push({ from: pos + idx, to: pos + idx + q.length });
        idx = text.indexOf(q, idx + 1);
      }
    }
    return true;
  });
  return out;
}

export function replaceAllMatches(editor: Editor, query: string, replacement: string): number {
  const ranges = findMatches(editor, query);
  if (!ranges.length) return 0;
  const tr = editor.state.tr;
  for (const r of [...ranges].reverse()) {
    tr.insertText(replacement, r.from, r.to);
  }
  editor.view.dispatch(tr);
  return ranges.length;
}

/** 从 HTML 文本计算字数（与 TipTap chapterWordCount 口径一致） */
export function chapterWordCountFromHtml(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  return text.length;
}
