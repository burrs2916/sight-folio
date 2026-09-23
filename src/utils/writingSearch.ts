// 全书搜索纯函数库（骨架走查 P1-G1）：跨章正文检索。
// 查找/替换此前只作用于当前章（WritingPage.findMatches），长篇「某句话在哪章」无处可查。
// 全部为纯函数：不触碰 store、不调用 t()（展示文案由调用方传入）。
import type { WritingChapter } from '../services/tauri';

export type BookSearchSnippet = {
  before: string;
  match: string;
  after: string;
};

export type BookSearchHit = {
  chapterId: string;
  chapterTitle: string;
  /** 该章命中次数（含未展示片段的） */
  count: number;
  /** 片段预览（默认每章最多 3 条） */
  snippets: BookSearchSnippet[];
};

/** 剥 HTML 标签为纯文本：标签位以空格替代（防相邻文字粘连误匹配）、空白折叠并去首尾 */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 全书跨章搜索：大小写不敏感的子串匹配（中文场景等价于精确匹配）。
 * 每章返回命中总数 + 前 N 条片段（默认 3），上下文默认前后各 30 字符。
 * 空查询返回空数组（调用方据此区分「未搜索」与「无结果」）。
 */
export function searchBookInChapters(
  chapters: Pick<WritingChapter, 'id' | 'title' | 'content'>[],
  rawQuery: string,
  opts: { maxSnippetsPerChapter?: number; maxContext?: number } = {},
): BookSearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const maxSnippets = opts.maxSnippetsPerChapter ?? 3;
  const ctx = opts.maxContext ?? 30;
  const hits: BookSearchHit[] = [];
  for (const c of chapters) {
    const text = stripTags(c.content ?? '');
    const lower = text.toLowerCase();
    let count = 0;
    const snippets: BookSearchSnippet[] = [];
    let idx = lower.indexOf(query);
    while (idx >= 0) {
      count++;
      if (snippets.length < maxSnippets) {
        snippets.push({
          before: text.slice(Math.max(0, idx - ctx), idx),
          match: text.slice(idx, idx + query.length),
          after: text.slice(idx + query.length, idx + query.length + ctx),
        });
      }
      idx = lower.indexOf(query, idx + query.length);
    }
    if (count > 0) hits.push({ chapterId: c.id, chapterTitle: c.title, count, snippets });
  }
  return hits;
}
