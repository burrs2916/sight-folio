// TXT 批量导入纯函数库（骨架走查 P2-G3）：存量文本迁入——粘贴正文 → 分章 → 段落转 HTML。
// 全部为纯函数：不触碰 store、不调用 t()（标题兜底文案由调用方传入）。

/** 章标题行识别：第X章/节/回/卷/部、序章/楔子/引子/尾声/番外N、Chapter N。 */
const CHAPTER_TITLE_RE =
  /^\s*(第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章节回卷部篇]|序章|序言|楔子|引子|尾声|终章|番外([一二三四五六七八九十0-9]+)?|Chapter\s+\d+)\s*.*/i;

/** 标题行排除：含句读标点的行是正文句（「他翻到第一章之外，停了。」不该误切） */
const TITLE_PUNCT_RE = /[，。！？；、…—）」』"']/;

export type ParsedChapter = {
  title: string;
  body: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 正文字数（去空白）；与字数统计口径一致（content 纯文本长度）。 */
export function countChapterWords(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/** 正文段落 → <p> HTML：换行切段、HTML 转义；空段跳过。 */
export function textToChapterHtml(body: string): string {
  return body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');
}

/**
 * 粘贴正文 → 分章。
 * 规则：
 * ① 扫描章标题行（CHAPTER_TITLE_RE，且行内无句读标点）——命中 **≥2** 个才按标题切
 *   （正文里偶然出现「第3章」字样不至误切），标题取该行前 40 字；
 *   首个标题之前若有实质内容，并入第一章 body 之前（零丢弃）。
 * ② 无足够标题行 → 按空行大块切：每块首行（截 20 字）做标题、其余为 body；
 *   整篇只有一段时整篇为单章（title 用 fallbackTitle，body=全文）。
 */
export function splitChaptersFromText(raw: string, fallbackTitle: string): ParsedChapter[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n');

  const marks: { line: number; title: string }[] = [];
  lines.forEach((ln, i) => {
    if (CHAPTER_TITLE_RE.test(ln) && !TITLE_PUNCT_RE.test(ln)) marks.push({ line: i, title: ln.trim().slice(0, 40) });
  });

  if (marks.length >= 2) {
    const pre = lines.slice(0, marks[0].line).join('\n').trim();
    const out: ParsedChapter[] = [];
    for (let m = 0; m < marks.length; m++) {
      const start = marks[m].line + 1;
      const end = m + 1 < marks.length ? marks[m + 1].line : lines.length;
      let body = lines.slice(start, end).join('\n').trim();
      if (m === 0 && pre) body = `${pre}\n\n${body}`;
      out.push({ title: marks[m].title, body });
    }
    return out;
  }

  // 无标题路径：空行大块切
  const blocks = text
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return [];
  if (blocks.length === 1) {
    return [{ title: fallbackTitle, body: blocks[0] }];
  }
  return blocks.map((b, i) => {
    const [first, ...rest] = b.split('\n');
    const title = (first || '').trim().slice(0, 20) || `${fallbackTitle} ${i + 1}`;
    const body = rest.length > 0 ? rest.join('\n').trim() : b;
    return { title, body };
  });
}
