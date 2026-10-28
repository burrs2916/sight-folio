// 写作台语料自动检索：从编辑器取「正在输入的词/短语」作为检索关键词
//
// 语义：以光标为界取其**之前**部分的文本，先按中文/英文标点与空白切段，
// 取**最后一段**（正在写的一句话/词，前文不参与检索）——避免把整段前文
// 当作 FTS 短语精确匹配（语料短句几乎不存在连续 N 字相同的子串，必然 0 命中）。
// 末段再截尾部 MAX_CORPUS_QUERY_CHARS 个字符作为 query：中文无分词，
// 最近几个字即「正在打的词/短语」；经真实语料（斗破全集）实测，短语
// 超过 4-6 字后 FTS trigram 几乎必然 0 命中（用户写的是新句子，不会原样
// 出现在语料中），词级 2-4 字命中率最高；2 字及以内由后端 LIKE 回退命中。
// 若末段本身是重复串（如「谢谢谢谢谢谢」），收敛为重复单元「谢谢」，
// 避免整串仍 0 命中。
// 光标位于块首（无前文）时回退为整块文本尾部，保证空段起始处输入也有参照。
import type { Editor } from '@tiptap/react';

export const MAX_CORPUS_QUERY_CHARS = 4;

/** 中文/英文标点与空白：写作中常见的分句/分隔符，用于切出「正在写的最后一段」 */
const SEGMENT_SPLIT_RE = /[。．，、；：？！,.;:!?…—\s\n]+/;

/**
 * 若 s 由某个短单元重复构成（重复≥2 次，尾部残余≤1 字符），返回该单元；
 * 用于把「谢谢谢谢谢谢…」「哈哈哈」这类重复输入收敛为原子词，
 * 让查询词回到语料中真实存在的形态（LIKE 子串可命中）。
 */
function findRepeatUnit(s: string): string | null {
  const n = s.length;
  if (n < 4) return null;
  for (let p = 2; p <= n / 2; p++) {
    const unit = s.slice(0, p);
    const repeats = Math.floor(n / p);
    if (repeats >= 2 && unit.repeat(repeats) === s.slice(0, p * repeats) && n - p * repeats <= 1) {
      return unit;
    }
  }
  return null;
}

export function extractCorpusQuery(editor: Editor): string {
  const { doc, selection } = editor.state;
  const from = selection.from;
  const $pos = doc.resolve(from);
  const blockStart = $pos.start($pos.depth);
  let text = doc.textBetween(blockStart, from, ' ', '\n').trim();
  if (!text) {
    const blockEnd = $pos.end($pos.depth);
    text = doc.textBetween(blockStart, blockEnd, ' ', '\n').trim();
  }
  // 取最后一个标点/空白后的段落（"正在写的句子/词"）；末段为空（如刚打完标点）
  // 时回退到整段，取尾部即最近的内容，保证输入间隙仍有参照。
  const segments = text.split(SEGMENT_SPLIT_RE).filter(Boolean);
  const last = segments.length > 0 ? segments[segments.length - 1] : text;
  const unit = findRepeatUnit(last);
  if (unit) return unit.slice(-MAX_CORPUS_QUERY_CHARS);
  return last.slice(-MAX_CORPUS_QUERY_CHARS);
}
