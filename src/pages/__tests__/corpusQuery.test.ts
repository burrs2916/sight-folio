// 语料自动检索查询词提取 · 回归锁
//
// 背景：曾把「光标前整段文本（最多 30 字符）」当作 FTS 短语精确匹配，
// 导致写作时几乎永远 0 命中（语料短句不存在连续 N 字相同子串）。
// 修复后按标点/空白切段取**最后一段**再截尾 MAX_CORPUS_QUERY_CHARS 字符，
// 让查询词贴近「正在输入的词/短语」；真实语料实测短语超过 4-6 字即基本
// 0 命中，故 MAX 取 4（词级），2 字及以内回到后端 LIKE 子串命中；
// 纯重复串（「谢谢谢谢」等）收敛为重复单元（「谢谢」）再交给后端。
import { describe, it, expect } from 'vitest';
import { extractCorpusQuery, MAX_CORPUS_QUERY_CHARS } from '../writingPage/corpusQuery';
import type { Editor } from '@tiptap/react';

/** 构造一个最小可用的 editor 假对象：只暴露 extractCorpusQuery 依赖的 state 形状 */
function makeEditor(
  blockTextBeforeCursor: string,
  opts: { blockTextAfterCursor?: string; blockStart?: number } = {},
): Editor {
  const before = blockTextBeforeCursor;
  const after = opts.blockTextAfterCursor ?? '';
  const blockStart = opts.blockStart ?? 0;
  const from = blockStart + before.length;
  return {
    state: {
      from,
      selection: { from },
      doc: {
        resolve: (pos: number) => ({
          start: () => blockStart,
          end: () => blockStart + before.length + after.length,
          depth: Math.max(pos > blockStart ? 1 : 0, 0),
        }),
        textBetween: (a: number, b: number) => {
          const full = before + after;
          const start = Math.max(0, Math.min(a - blockStart, full.length));
          const end = Math.max(start, Math.min(b - blockStart, full.length));
          return full.slice(start, end);
        },
      },
    },
  } as unknown as Editor;
}

describe('extractCorpusQuery', () => {
  it('取光标前最后一个标点后的段落，而非整段前文', () => {
    // 前文有句号：应取「孤独的山谷」之后，再截尾到词级长度
    const editor = makeEditor('他回头看见了。孤独的山谷');
    expect(extractCorpusQuery(editor)).toBe('独的山谷');
  });

  it('整段无标点时取整段尾部的最后几个字（正在输入的词/短语）', () => {
    const editor = makeEditor('他回头看见了孤独的山谷');
    expect(extractCorpusQuery(editor)).toBe('独的山谷');
  });

  it('超过 MAX_CORPUS_QUERY_CHARS 时截尾固定长度', () => {
    const long = '萧炎偏头对着彩鳞沉声道，这片神秘的世界并不是他们所能揣测的';
    const editor = makeEditor(long);
    const q = extractCorpusQuery(editor);
    expect(q.length).toBeLessThanOrEqual(MAX_CORPUS_QUERY_CHARS);
    expect(q).toBe(long.slice(-MAX_CORPUS_QUERY_CHARS));
  });

  it('2 字及以内的短词原样返回（后端走 LIKE 子串命中）', () => {
    expect(extractCorpusQuery(makeEditor('谢谢'))).toBe('谢谢');
  });

  it('光标在块首/空块时回退为整块尾部', () => {
    // 无前文 + 块内有内容：取块内全部再截尾
    const editor = makeEditor('', { blockTextAfterCursor: '山风很大', blockStart: 0 });
    expect(extractCorpusQuery(editor)).toBe('山风很大');
  });

  it('英文/中文标点与空白均视为分隔', () => {
    expect(extractCorpusQuery(makeEditor('Hello world. lonely valley'))).toBe('lley');
    expect(extractCorpusQuery(makeEditor('他说，这是最好的时代'))).toBe('好的时代');
  });

  it('光标紧跟标点时取标点前的末段再截尾（输入间隙保持参照）', () => {
    const editor = makeEditor('孤独是宿命。');
    const q = extractCorpusQuery(editor);
    // 末段为标点前的「孤独是宿命」，截尾后为词级长度，仍然有参照
    expect(q.length).toBeGreaterThan(0);
    expect(q).toBe('独是宿命');
  });

  it('纯重复串收敛为重复单元（避免一整串 0 命中）', () => {
    expect(extractCorpusQuery(makeEditor('谢谢谢谢谢谢'))).toBe('谢谢');
    expect(extractCorpusQuery(makeEditor('哈哈哈哈哈'))).toBe('哈哈');
    expect(extractCorpusQuery(makeEditor('萧炎萧炎萧炎'))).toBe('萧炎');
  });

  it('重复串带少量残余时仍收敛为重复单元', () => {
    // 「谢谢×N + 先」：整段由周期「谢谢」重复构成，末尾残余 1 字，仍收敛
    expect(extractCorpusQuery(makeEditor('谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢谢先'))).toBe('谢谢');
  });
});
