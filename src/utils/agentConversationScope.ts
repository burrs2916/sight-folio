// AI 会话的「归属哪本书」判定（2026-11-04 全仓删除账 ③d）。
//
// 现状口径（先承认事实，再定规则）：`ai_conversations` 表里**没有任何归属列**
// （只有 id / agent_id / title / created_at / updated_at，见 ai_repository.rs:72-78），
// 书名只存在于标题文本里。全仓四处建会话的写法是一致的 `{用途} · {书名}[ › {章名}]`
// （AI 助手页、写作台「写作台 · 书名」、语料参谋「语料参谋 · 书名」、灵感展开面板）。
//
// 旧实现用 `title.includes(bookTitle)` 猜归属，两类错法都真实存在：
//  · **误删**：《长夜》会把《长夜难明》的会话一起删掉（子串命中）；
//  · **漏删**：书名改过之后，旧书名下的会话永远匹配不上。
// 本片把「猜」升级成**按分隔符切段后精确比对**，误删这一类从根上消掉；
// 漏删那一类消不掉（数据里就没有这条线索），所以由确认弹窗把**将删清单原样列出来**，
// 让用户看见边界，而不是删完才发现少删/多删。真正的解法是给会话加 scope 列，见审计 ③d-2。

/** 会话标题的段分隔符（与四处建会话的写法一致，改这里必须同步那四处）。 */
export const TITLE_SEGMENT_SEP = ' · ';
/** 书名之后的章名分隔符：`新对话 · 长夜 › 第一章`。 */
export const TITLE_CHAPTER_SEP = ' › ';

/** 标题里的某一段**正好等于**书名，或以「书名 › 」开头（带章名后缀）。 */
export function conversationBelongsToBook(title: string, bookTitle: string): boolean {
  if (!bookTitle) return false;
  return title
    .split(TITLE_SEGMENT_SEP)
    .some((segment) => segment === bookTitle || segment.startsWith(bookTitle + TITLE_CHAPTER_SEP));
}

/** 属于这本书的会话，保持传入顺序（侧栏用的就是可见顺序）。 */
export function bookScopedConversations<T extends { id: string; title: string }>(
  conversations: T[],
  bookTitle: string | null | undefined,
): T[] {
  if (!bookTitle) return [];
  return conversations.filter((c) => conversationBelongsToBook(c.title, bookTitle));
}

/**
 * 确认弹窗用的将删清单文本：最多列 5 条，超出折叠成「…等 N 个」。
 * 列出来是刻意的——归属只能靠标题猜，那就必须让用户看见这次到底动了哪几个。
 */
export function describeConversationTitles(titles: string[], max = 5): string {
  if (titles.length === 0) return '';
  const head = titles.slice(0, max).join('、');
  return titles.length > max ? `${head}…等 ${titles.length} 个` : head;
}
