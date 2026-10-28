/**
 * writingCorpusBudget.ts —— 语料生产预算的单一真源（single source of truth）
 *
 * 目的：把散落在语料 builder / 组装点里的截断上限（魔法数字）集中到这里，
 * 让「哪些语料片段各留多少」的决策可读、可调、可测试，且各端（写作台 / 工作台 /
 * provider）使用同一套常量，避免同一口径出现第二份实现。
 *
 * 分组说明：
 * - 语料片段上限：builder 在产出某一语料片段时的条目/字数截断（如伏笔冲突至多列 8 条）。
 * - 写作台聊天端注入（CHAT_*）：WritingPage 对话面板首轮自动注入场景的 token 保护参数。
 *
 * 维护铁律：新增语料片段时若需要截断上限，先在这里加常量并复用；
 * 不得在 builder/组装点内另写裸数字。
 */

// ─── 语料片段上限（builder 内截断）───

/** 校对体检：时间线冲突事件至多列出的条数 */
export const MAX_CONFLICT_TEXTS = 8;

/** 校对体检：带文本问题的章节至多列出的条数 */
export const MAX_TEXT_ISSUE_CHAPTERS = 12;

/** 写作统计：体量离群章至多列出的条数 */
export const MAX_OUTLIER_ROWS = 10;

/** 正文写作：章节骨架至多列出的章数（防超长书撑爆上下文） */
export const MAX_SKELETON_CHAPTERS = 120;

/** 正文写作：当前章之前取几章作为前情提要 */
export const MANUSCRIPT_PREV_COUNT = 2;

/** 正文写作：前情提要每章截取的尾部字数 */
export const MANUSCRIPT_TAIL_CHARS = 400;

/** 大纲题材：念头池（未落章节拍）至多列出的条数 */
export const MAX_LOOSE_BEATS = 30;

// ─── 写作台聊天端首轮注入（WritingPage buildChatContext）───

/** 聊天上下文：当前章正文只取末尾多少字 */
export const CHAT_CONTEXT_TAIL_CHARS = 2000;

/** 聊天上下文：人物档案至多注入的张数 */
export const MAX_CHAT_CHAR_PROFILES = 40;

/** 聊天上下文：世界观设定至多注入的条数 */
export const MAX_CHAT_WORLDBUILDING_ENTRIES = 40;

/** 聊天上下文：全书章节骨架至多注入的章数（与工作台 catalog 同一 builder） */
export const CHAT_CATALOG_CHAPTER_LIMIT = 60;

/** 写作台聊天端注入参数集合（便于一次过目/调整该端的 token 策略） */
export const CHAT_CONTEXT_PROFILE = {
  tailChars: CHAT_CONTEXT_TAIL_CHARS,
  charProfiles: MAX_CHAT_CHAR_PROFILES,
  worldbuildingEntries: MAX_CHAT_WORLDBUILDING_ENTRIES,
  catalogChapterLimit: CHAT_CATALOG_CHAPTER_LIMIT,
} as const;

// ─── 文风指纹（P0）：writingStyleFingerprint 取样与输出预算 ───

/** 文风指纹：参与统计的章节数（按 sortOrder 取前 N 章） */
export const STYLE_FINGERPRINT_MAX_CHAPTERS = 8;

/** 文风指纹：统计样本总字符预算（防超长书撑爆统计与注入上下文） */
export const STYLE_FINGERPRINT_MAX_CHARS = 20000;

/** 文风指纹：高频词输出条数上限（中文/英文各 N 条） */
export const STYLE_FINGERPRINT_TOP_WORDS = 15;

/** 文风指纹：样本不足该字数时判定无可画像风格（返回空，调用方不注入） */
export const STYLE_FINGERPRINT_MIN_CHARS = 200;
