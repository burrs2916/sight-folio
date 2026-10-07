// 全书搜索纯函数库（骨架走查 P1-G1 → T3 增强）：跨章正文检索与替换。
// 查找/替换此前只作用于当前章（WritingPage.findMatches），长篇「某句话在哪章」无处可查；
// T3 补齐 正则/区分大小写 双开关与 HTML 安全替换（保留标签结构）。
// 全部为纯函数：不触碰 store、不调用 t()（展示文案由调用方传入）。
import type { WritingChapter } from '../services/tauri';

export type BookSearchSnippet = {
  before: string;
  match: string;
  after: string;
  /** 该匹配在该章所有匹配中的序号（0-based，用于精确替换） */
  occurrence: number;
};

export type BookSearchHit = {
  chapterId: string;
  chapterTitle: string;
  /** 该章命中次数（含未展示片段的） */
  count: number;
  /** 片段预览（默认每章最多 3 条） */
  snippets: BookSearchSnippet[];
};

export type BookSearchOptions = {
  maxSnippetsPerChapter?: number;
  maxContext?: number;
  /** 区分大小写（默认 false，与既有行为一致） */
  caseSensitive?: boolean;
  /** 按正则表达式匹配（表达式非法时搜索返回空、替换原样返回，不抛出） */
  useRegex?: boolean;
};

/** 正则特殊字符转义（字面量查询时使用） */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把用户查询编译为全局匹配正则。
 * - 字面量模式自动转义；正则模式原样使用。
 * - 非法正则返回 null（调用方决定提示或短路），不抛出。
 */
export function compileSearchPattern(
  rawQuery: string,
  opts: { caseSensitive?: boolean; useRegex?: boolean } = {},
): RegExp | null {
  const query = rawQuery.trim();
  if (!query) return null;
  const flags = opts.caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(opts.useRegex ? query : escapeRegExp(query), flags);
  } catch {
    return null;
  }
}

/** 剥 HTML 标签为纯文本：标签位以空格替代（防相邻文字粘连误匹配）、空白折叠并去首尾 */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 轻量 HTML 剥离 → 纯文本并截断（hover 摘要统一口径：伏笔出入章与灵感念头共用，禁第二份） */
export function clipSummary(html: string | undefined | null, maxLen = 80): string {
  if (!html) return '';
  const text = html
    .replace(/<\/?[^>]+\/?>/gi, ' ') // 去除所有 HTML 标签
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/**
 * 全书跨章搜索：子串（大小写不敏感）或正则（带命中开关）。
 * 每章返回命中总数 + 前 N 条片段（默认 3），上下文默认前后各 30 字符。
 * 空查询 / 非法正则返回空数组（调用方据此区分「未搜索」与「无结果」）。
 */
export function searchBookInChapters(
  chapters: Pick<WritingChapter, 'id' | 'title' | 'content'>[],
  rawQuery: string,
  opts: BookSearchOptions = {},
): BookSearchHit[] {
  const re = compileSearchPattern(rawQuery, opts);
  if (!re) return [];
  const maxSnippets = opts.maxSnippetsPerChapter ?? 3;
  const ctx = opts.maxContext ?? 30;
  const hits: BookSearchHit[] = [];
  for (const c of chapters) {
    const text = stripTags(c.content ?? '');
    let count = 0;
    const snippets: BookSearchSnippet[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      count++;
      if (snippets.length < maxSnippets) {
        snippets.push({
          before: text.slice(Math.max(0, m.index - ctx), m.index),
          match: m[0],
          after: text.slice(m.index + m[0].length, m.index + m[0].length + ctx),
          occurrence: count - 1,
        });
      }
      // 防零宽正则（如 ^|$|.*?）死循环
      if (m[0].length === 0) re.lastIndex++;
    }
    if (count > 0) hits.push({ chapterId: c.id, chapterTitle: c.title, count, snippets });
  }
  return hits;
}

/**
 * 在 HTML 文本节点中安全替换 query → replacement，不破坏标签结构。
 * 遵循与搜索一致的 大小写/正则 选项；replacement 一律按字面量处理（不经 $ 展开）。
 * 非法正则 / DOMParser 不可用时：正则模式原样返回，字面量模式走简单字符串替换兜底。
 */
export function replaceTextInHtml(
  html: string,
  query: string,
  replacement: string,
  opts: { caseSensitive?: boolean; useRegex?: boolean } = {},
): string {
  if (!query || !html) return html;
  const compiled = compileSearchPattern(query, opts);
  if (!compiled) return html;
  try {
    // 闭包内 TS 无法完成对局部变量的 null 窄化，用非空别名
    const re: RegExp = compiled;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    function walk(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        // 无匹配时 replace 返回原串；有匹配时用函数回调避免 replacement 中的 $ 被展开
        re.lastIndex = 0;
        node.textContent = text.replace(re, () => replacement);
      } else {
        Array.from(node.childNodes).forEach(walk);
      }
    }
    walk(doc.body);
    return doc.body.innerHTML;
  } catch {
    // Fallback：简单字符串/正则替换（DOMParser 不可用时兜底）
    if (opts.useRegex) {
      try {
        const r = compileSearchPattern(query, opts);
        return r ? html.replace(r, () => replacement) : html;
      } catch {
        return html;
      }
    }
    return html.split(query).join(replacement);
  }
}
