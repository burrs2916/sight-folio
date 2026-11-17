// 字数口径的**唯一真源**（P0-1，2026-11-14）
//
// 为什么单开这一层：项目里同时存在两把尺子 ——
//   ① 正文统计（写作台底栏 / 书架「N 字」/ 章节 word_count）用「去空白后的字符数」，
//      **标点算字**（`他走了。` = 4），这是网文平台与稿费口径；
//   ② 格律与台词（五言、莎翁体、剧本台词长度）用「只数文字与数字」，**标点不算**
//      （`五言` 就是五个字，不是七个字符）。
// 两把尺子本身都对，错的是它们以前被分别实现了好几份（chapterAutoFix / writingImport /
// WritingChapterEditor / editorUtils 各写一遍字符串正则）。同书两个数对不上、改一处漏一处，
// 根因都是"同一件事没有同一个函数"。这里收成一处，调用点只准转调，不准再写第二份。
//
// 命名即口径，读代码的人不必点进来猜：
//   countManuscriptChars —— 稿件**字符**数：去空白、含标点。用于一切"这本书多少字"。
//   countWrittenUnits    —— 实际**书写单位**：仅文字与数字，不含标点/符号。用于格律与台词。
//
// 本模块保持零依赖（不 import 任何东西）：它是被别处依赖的底座，
// 一旦它反过来 import writingProofread 之类，就会绕出环。HTML → 文本的剥离交给调用方
// （用 `stripHtmlText` 后再进来），保证"剥标签"只有一份实现。

/** 稿件字符数：除掉一切空白（含全角空格与换行）后的长度，**标点算一个字**。 */
export function countManuscriptChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** 书写单位数：只数文字与数字，**标点、符号、空白都不算**（五言=5，台词同理）。 */
export function countWrittenUnits(text: string): number {
  return Array.from(text).filter((ch) => !/[\s\p{P}\p{S}]/u.test(ch)).length;
}
