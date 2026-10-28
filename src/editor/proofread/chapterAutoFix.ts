// 章节级自动修复（工作室校对「一键修复」，T2）
//
// 安全边界：只替换 proofreadEngine.runProofread 明确携带 fix 的逐处条目——
//   错别字（唯一候选「悬梁刺骨→悬梁刺股」等）、冗余精简、省略号/破折号/半角标点规范。
// 无 fix 的问题（敏感词、引号/括号配对、重复用词、「在/再」类歧义错词）一律不自动改动，
// 保留人工判断（写作台检测面板同样原则：只给可安全替换的条目提供一键修复）。
//
// 实现：在 DOM 文本节点级别的原地替换（runProofread 的跨段检测如引号配对无 fix，不受段边界影响；
// 需要 fix 的规则全部为段内局部词/标点，逐节点检测偏移天然有效），保留全部标签与内联格式。
import { runProofread } from './proofreadEngine';
import { stripHtmlText } from '../../utils/writingProofread';

/** 纯文本（stripHtmlText 口径）中是否存在可一键自动修复项 */
export function hasAutoFixableInText(text: string): boolean {
  return runProofread(text).some((i) => !!i.fix);
}

/** 章节 HTML 中是否存在可一键自动修复项 */
export function hasAutoFixableHtml(html: string): boolean {
  return hasAutoFixableInText(stripHtmlText(html));
}

/** 章节 HTML 的纯文本字数（与写作台 countWords 同口径：去空白后的字符数） */
export function wordCountOfHtml(html: string): number {
  return stripHtmlText(html).replace(/\s/g, '').length;
}

/**
 * 对章节 HTML 执行可自动修复项的全量替换（逐文本节点原地替换，保留标签/格式）。
 * 返回修复后 HTML 与替换条数；无可修复项时原样返回（fixedCount=0）。
 * 一次通过、不做二次重扫：自动修复不引入新错误（fix 均为规范文本）。
 */
export function applyAutoFixesHtml(html: string): { html: string; fixedCount: number } {
  if (typeof DOMParser === 'undefined') {
    throw new Error('applyAutoFixesHtml requires DOMParser (browser/jsdom)');
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  // 先收集再改写：遍历中修改 textNode.data 会破坏 TreeWalker 游标
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === Node.TEXT_NODE && n.textContent) textNodes.push(n as Text);
  }
  let fixedCount = 0;
  for (const node of textNodes) {
    const text = node.data;
    if (!text) continue;
    const fixable = runProofread(text).filter((i) => i.fix);
    if (fixable.length === 0) continue;
    // 从后往前替换，偏移互不干扰；runProofread 已按 start-end 去重
    let out = text;
    const sorted = [...fixable].sort((a, b) => b.start - a.start);
    for (const iss of sorted) {
      out = out.slice(0, iss.start) + (iss.fix as string) + out.slice(iss.end);
    }
    node.data = out;
    fixedCount += sorted.length;
  }
  return { html: doc.body.innerHTML, fixedCount };
}
