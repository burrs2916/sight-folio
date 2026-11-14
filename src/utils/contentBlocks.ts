// 正文块的公共口径：HTML → 块 / 行、字数、语种判定（⑯-1，2026-11-09）
//
// 为什么单开这一层：这三件事**不属于任何体裁**，但诗与剧本都要用。
// 以前它们住在 `poetryForms` 里，于是"剧本要数对白多长"就得再写一份标点正则 ——
// 两份「什么算一个字」迟早漂移（诗歌的「言」与剧本的台词长度本来就是同一把尺子）。
//
// 迁移方式：**逐字搬**，`poetryForms` 改为转调本模块。
// 判断这次搬迁没改行为的证据 = `poetryForms.test.ts` 那 38 条全绿（含那条
// 「莎翁体 4+4+4+2 不能被读成一坨 14 行」的分节锁）。
import { stripHtmlText } from './writingProofread';

/**
 * 正文 HTML → 块。**必须直接解析 HTML，不能吃 `stripHtmlText` 的输出**：
 * 那个函数把 `</p>` 与 `<br>` **一律**归一成 `\n`（它是给纯文本校对用的），
 * 于是"换节 / 换段"与"换行"在文本里长得一模一样 —— 拿它分块，莎翁体的
 * 4+4+4+2 会被读成一坨 14 行，剧本的「一段台本」也会被读成一整块台词。
 * Tiptap 的实际形态是「一块 = 一个 <p>，块内一行 = 一个 <br>」，就按这个解析。
 */
const BLOCK_RE = /<(p|div|blockquote|h[1-6])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

function toLines(inner: string): string[] {
  return inner
    .split(/<br\s*\/?>/i)
    .map((l) => stripHtmlText(l).trim())
    .filter((l) => l.length > 0);
}

/** 正文 → 块数组（每块是若干非空行）。非 HTML 的纯文本草稿按空行分块兜底。 */
export function htmlContentBlocks(content: string): string[][] {
  const html = content || '';
  const fromBlocks: string[][] = [];
  for (const m of Array.from(html.matchAll(BLOCK_RE))) {
    const lines = toLines(m[2] ?? '');
    if (lines.length > 0) fromBlocks.push(lines);
  }
  if (fromBlocks.length > 0) return fromBlocks;
  const plain = stripHtmlText(html)
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length > 0);
  const lines = plain.flat();
  return lines.length > 0 ? plain : [];
}

/** 一个「字」的口径：只数文字与数字，**标点与符号不算**（五言的五是五个字，不是五个字符；台词长度同理） */
export function countWrittenUnits(text: string): number {
  return Array.from(text).filter((ch) => !/[\s\p{P}\p{S}]/u.test(ch)).length;
}

/** 一个「词」的口径（英文剧本的台词长度按词数，不按字符数） */
export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
}

/** 含 CJK 字符（判语种用；只看有没有汉字，不看比例） */
export function hasCjkText(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}
