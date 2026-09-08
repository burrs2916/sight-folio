import { getLang } from "../i18n";

/**
 * AI 上下文/提示词正文的「语言对」选择器。
 *
 * 与 UI 文案的区别：这些是**发给 AI 读的内容**（分节正文、操作指令、段落说明），
 * 长度大、含 markdown 与动态模板变量，塞进 JSON 语言包会变成转义地狱，
 * 故按第五轮确立的惯例以「代码内联双语」承载：中文分支保持原样（测试断言以 zh 为权威），
 * 英文分支随 UI 语言切换。凡模块级常量里含 t()/L() 的一律改为存 key 或 getter，
 * 否则切换语言后不刷新（历史教训 ×3）。
 */

/** 按当前 UI 语言挑选段落/单句（zh 原文保持不变，en 为翻译） */
export function L(zh: string, en: string): string {
  return getLang() === "en-US" ? en : zh;
}

/** 按当前 UI 语言挑选表格表头 */
export function H(zh: string[], en: string[]): string[] {
  return getLang() === "en-US" ? en : zh;
}
