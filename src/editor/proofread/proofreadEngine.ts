// sight-folio: 校对引擎（批次③ T5 / 批次④ T2）
// 纯前端轻量检测：错别字（高频错词短语）、重复用词、敏感词、冗余表达、标点规范。
// 输入：纯文本（从 TipTap editor.getText() 获得）；输出：Issue[] 按位置排序。
// 词库不再直接 import 常量，而是由 `lexiconStore.resolveLexicon()` 给出
// 「内置 ⊕ 作者自定义」的合并结果（合并与排序规则集中在那边，见其注释）。
import type { TypoPhrase } from './typoPhrases';
import type { SensitiveEntry } from './sensitiveWords';
import type { RedundantPhrase } from './redundantPhrases';
import { resolveLexicon, type ResolvedLexicon } from './lexiconStore';

export type IssueKind = 'typo' | 'repeat' | 'sensitive' | 'punct' | 'redundant';

export interface ProofreadIssue {
  kind: IssueKind;
  /** 在纯文本中的起始字符偏移（UTF-16 code units） */
  start: number;
  /** 结束偏移 */
  end: number;
  /** 匹配到的原文片段 */
  excerpt: string;
  /** 建议/提示 */
  suggestion?: string;
  /** typo 专用：可直接替换的修复文本（歧义项如「在/再」不提供，需人工判断） */
  fix?: string;
  /** sensitive 专用 */
  severity?: 'warning' | 'block';
}

/** 主入口：对单章正文执行全部检测，返回按 start 升序、start 相同按优先级（block>warning>typo>punct>repeat）排序的问题列表 */
export function runProofread(text: string, lexicon?: ResolvedLexicon): ProofreadIssue[] {
  const lex = lexicon ?? resolveLexicon();
  const all: ProofreadIssue[] = [
    ...detectTypos(text, lex.typos),
    ...detectRedundancy(text, lex.redundant),
    ...detectRepeats(text),
    ...detectSensitive(text, lex.sensitive),
    ...detectPunctuation(text),
  ];
  all.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const pa = priority(a);
    const pb = priority(b);
    return pb - pa; // 高优先级在前
  });
  // 同区间去重：typo 碎片（含重复助词如「的的」「在在」）与 repeat 可能同时命中同一区间，
  // 保留高优先级那条（typo 带可修复 fix，展示更准），避免一条问题报两条。
  const seen = new Set<string>();
  return all.filter((i) => {
    const key = `${i.start}-${i.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function priority(i: ProofreadIssue): number {
  if (i.kind === 'sensitive' && i.severity === 'block') return 3;
  if (i.kind === 'sensitive') return 2;
  if (i.kind === 'typo') return 1;
  if (i.kind === 'punct') return 1;
  if (i.kind === 'redundant') return 1;
  return 0;
}

/** 冗余表达：基于语义冗余搭配表（短语级），命中即报；fix 为精简词，需人工确认后替换 */
function detectRedundancy(text: string, table: readonly RedundantPhrase[]): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  for (const { wrong, right } of table) {
    let pos = text.indexOf(wrong);
    while (pos !== -1) {
      issues.push({
        kind: 'redundant',
        start: pos,
        end: pos + wrong.length,
        excerpt: text.slice(Math.max(0, pos - 3), Math.min(text.length, pos + wrong.length + 3)),
        suggestion: `「${wrong}」语义冗余，可精简为「${right}」`,
        fix: right,
      });
      pos = text.indexOf(wrong, pos + 1);
    }
  }
  return issues;
}

/** 错别字：基于高频错词短语表（多字词级），命中即报 */
function detectTypos(text: string, table: readonly TypoPhrase[]): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  for (const { wrong, right } of table) {
    let pos = text.indexOf(wrong);
    while (pos !== -1) {
      issues.push({
        kind: 'typo',
        start: pos,
        end: pos + wrong.length,
        excerpt: text.slice(Math.max(0, pos - 3), Math.min(text.length, pos + wrong.length + 3)),
        suggestion: `应为「${right}」`,
        ...(fixTextFromRight(right) !== undefined ? { fix: fixTextFromRight(right) } : {}),
      });
      pos = text.indexOf(wrong, pos + 1);
    }
  }
  return issues;
}

/**
 * 从词表 right 中提取可一键替换的修复文本：
 * - 「莫名其妙（明）」→「莫名其妙」（去掉尾部括号注释）
 * - 「在/再」→ 返回 undefined（多个候选，需人工判断，不能自动替换）
 */
export function fixTextFromRight(right: string): string | undefined {
  const stripped = right.replace(/（[^）]*）$/u, '').trim();
  if (!stripped || stripped.includes('/')) return undefined;
  return stripped;
}

/** 重复用词：滑动窗口检测连续或近连续的 2-6 字重复（间隔 ≤3 字符） */
function detectRepeats(text: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  const maxLen = 6;
  const maxGap = 3;
  const reported = new Set<string>();
  for (let len = 2; len <= maxLen; len++) {
    for (let i = 0; i + len * 2 + maxGap <= text.length; i++) {
      const a = text.slice(i, i + len);
      if (!hasCJK(a)) continue;
      let found = false;
      for (let j = i + len; j <= i + len + maxGap && j + len <= text.length; j++) {
        const b = text.slice(j, j + len);
        if (a === b) {
          const key = `${i}-${len}`;
          if (!reported.has(key)) {
            reported.add(key);
            const start = i;
            const end = j + len;
            issues.push({
              kind: 'repeat',
              start,
              end,
              excerpt: text.slice(Math.max(0, start - 3), Math.min(text.length, end + 3)),
              suggestion: `「${a}」重复出现`,
            });
          }
          found = true;
          break;
        }
      }
      if (found) {
        // 已报告此起始位置，跳到重复结束位置之后继续（避免重叠误报）
        i += len + maxGap;
      }
    }
  }
  return issues;
}

function hasCJK(s: string): boolean {
  return /[\u4e00-\u9fa5]/.test(s);
}

/** 敏感词：按词库逐条 indexOf 扫描 */
function detectSensitive(text: string, table: readonly SensitiveEntry[]): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  for (const { word, level } of table) {
    let pos = text.indexOf(word);
    while (pos !== -1) {
      issues.push({
        kind: 'sensitive',
        start: pos,
        end: pos + word.length,
        excerpt: text.slice(Math.max(0, pos - 3), Math.min(text.length, pos + word.length + 3)),
        severity: level,
      });
      pos = text.indexOf(word, pos + 1);
    }
  }
  return issues;
}

/**
 * 标点专项检测：
 * - 中文引号配对（“ ” / 「 」）：扫描全文维护配对栈，未闭合的左引号与多余的右引号各报一条
 * - 省略号：单个「…」应为「……」；三个中文句号「。。。」应为「……」
 * - 破折号：单个「—」应为「——」（前后均为数字的区间号除外，如「3—5」）
 * 引号问题无法自动补全（不知道补在何处），不提供 fix；省略号/破折号可一键替换。
 */
function detectPunctuation(text: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  const pairs = [
    { open: '\u201c', close: '\u201d', name: '“”' }, // “ ”
    { open: '\u300c', close: '\u300d', name: '「」' }, // 「 」
  ] as const;
  const stack: { open: string; close: string; name: string; pos: number }[] = [];

  // ── 引号配对 ──
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const openPair = pairs.find((p) => p.open === ch);
    if (openPair) {
      stack.push({ ...openPair, pos: i });
      continue;
    }
    const closePair = pairs.find((p) => p.close === ch);
    if (closePair) {
      const top = stack[stack.length - 1];
      if (top && top.close === ch) {
        stack.pop();
      } else {
        // 多余的右引号：栈空或与当前栈顶类型不匹配
        issues.push({
          kind: 'punct',
          start: i,
          end: i + 1,
          excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, i + 4)),
          suggestion: `多余的右引号「${closePair.name}」：没有与之配对的左引号`,
        });
      }
    }
  }
  // 未闭合的左引号：按栈内自底向上报（每个只报一次）
  for (const item of stack) {
    issues.push({
      kind: 'punct',
      start: item.pos,
      end: item.pos + 1,
      excerpt: text.slice(Math.max(0, item.pos - 3), Math.min(text.length, item.pos + 4)),
      suggestion: `左引号「${item.open}」未闭合：缺少对应的右引号「${item.close}」`,
    });
  }

  // ── 省略号：单个 … / 三个 。 ──
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\u2026') {
      // 单个「…」：后面还有「…」（即成对省略号）则跳过
      if (text[i + 1] === '\u2026') {
        // 成对省略号本身不需要修复，但若出现三个及以上连续省略号视为不规范
        if (text[i + 2] === '\u2026') {
          let j = i + 1;
          while (text[j + 1] === '\u2026') j++;
          issues.push({
            kind: 'punct',
            start: i,
            end: j + 1,
            excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, j + 4)),
            suggestion: '省略号应使用两个「……」',
            fix: '……',
          });
          i = j;
        } else {
          i += 1;
        }
      } else {
        issues.push({
          kind: 'punct',
          start: i,
          end: i + 1,
          excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, i + 4)),
          suggestion: '省略号应使用两个「……」',
          fix: '……',
        });
      }
    } else if (ch === '\u3002' && text[i + 1] === '\u3002' && text[i + 2] === '\u3002') {
      // 三个中文句号「。。。」→「……」
      issues.push({
        kind: 'punct',
        start: i,
        end: i + 3,
        excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, i + 6)),
        suggestion: '省略号应使用「……」而非三个句号',
        fix: '……',
      });
      i += 2;
    }
  }

  // ── 破折号：单个 —（区间号不报，如 3—5） ──
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\u2014') continue; // —
    if (text[i + 1] === '\u2014') {
      // 已是「——」成对；若后跟第三个「—」（如 ———）视为不规范
      if (text[i + 2] === '\u2014') {
        let j = i + 1;
        while (text[j + 1] === '\u2014') j++;
        issues.push({
          kind: 'punct',
          start: i,
          end: j + 1,
          excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, j + 4)),
          suggestion: '破折号应使用两个「——」，中间不留空格',
          fix: '——',
        });
        i = j;
      } else {
        i += 1;
      }
      continue;
    }
    // 单个「—」：前后都是数字视为区间号（3—5），不报；否则应为「——」
    const prevIsDigit = i > 0 && /\d/.test(text[i - 1]);
    const nextIsDigit = i < text.length - 1 && /\d/.test(text[i + 1]);
    if (prevIsDigit && nextIsDigit) continue;
    issues.push({
      kind: 'punct',
      start: i,
      end: i + 1,
      excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, i + 4)),
      suggestion: '破折号应使用两个「——」',
      fix: '——',
    });
  }

  // ── 括号配对：（ ）【 】《 》—— 与引号同样的配对栈，未闭合/多余各报一条（无 fix） ──
  const bracketPairs = [
    { open: '\uff08', close: '\uff09', name: '（）' }, // （ ）
    { open: '\u3010', close: '\u3011', name: '【】' }, // 【 】
    { open: '\u300a', close: '\u300b', name: '《》' }, // 《 》
  ] as const;
  const bracketStack: { open: string; close: string; name: string; pos: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const bOpen = bracketPairs.find((p) => p.open === ch);
    if (bOpen) {
      bracketStack.push({ ...bOpen, pos: i });
      continue;
    }
    const bClose = bracketPairs.find((p) => p.close === ch);
    if (bClose) {
      const top = bracketStack[bracketStack.length - 1];
      if (top && top.close === ch) {
        bracketStack.pop();
      } else {
        issues.push({
          kind: 'punct',
          start: i,
          end: i + 1,
          excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, i + 4)),
          suggestion: `多余的右括号「${bClose.name}」：没有与之配对的左括号`,
        });
      }
    }
  }
  for (const item of bracketStack) {
    issues.push({
      kind: 'punct',
      start: item.pos,
      end: item.pos + 1,
      excerpt: text.slice(Math.max(0, item.pos - 3), Math.min(text.length, item.pos + 4)),
      suggestion: `左括号「${item.open}」未闭合：缺少对应的右括号「${item.close}」`,
    });
  }

  // ── 省略号写成 ASCII 点：连续 3 个及以上「.」，前后任一为中文语境 → 应为「……」 ──
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '.') continue;
    let j = i;
    while (text[j + 1] === '.') j++;
    const dotsLen = j - i + 1;
    if (dotsLen < 3) continue;
    const prev = i > 0 ? text[i - 1] : '';
    const next = j + 1 < text.length ? text[j + 1] : '';
    if (!isCjkContextChar(prev) && !isCjkContextChar(next)) continue; // 纯英文语境（代码/URL/句点）不报
    issues.push({
      kind: 'punct',
      start: i,
      end: j + 1,
      excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, j + 4)),
      suggestion: '省略号应使用「……」',
      fix: '……',
    });
    i = j;
  }

  // ── 半角标点混用：中文语境（前后均为中文语境字符）中的半角逗号/句号/分号/冒号/问号/叹号 → 全角 ──
  const halfToFull: Record<string, string> = {
    ',': '\uff0c', // ，
    '.': '\u3002', // 。
    ';': '\uff1b', // ；
    ':': '\uff1a', // ：
    '!': '\uff01', // ！
    '?': '\uff1f', // ？
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const full = halfToFull[ch];
    if (!full) continue;
    // 连续点序列由上面的省略号规则处理（2 个点以下保守不报，避免误伤「..」口语省略）
    if (ch === '.' && (text[i - 1] === '.' || text[i + 1] === '.')) continue;
    const prev = i > 0 ? text[i - 1] : '';
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (!isCjkContextChar(prev) || !isCjkContextChar(next)) continue;
    issues.push({
      kind: 'punct',
      start: i,
      end: i + 1,
      excerpt: text.slice(Math.max(0, i - 3), Math.min(text.length, i + 4)),
      suggestion: `中文语境中的半角「${ch}」应为全角「${full}」`,
      fix: full,
    });
  }

  return issues;
}

/** 中文语境字符：汉字、中文标点或全角符号（用于省略号/半角标点规则的边界判断，保证低误报） */
function isCjkContextChar(ch: string): boolean {
  if (!ch) return false;
  return /[\u3000-\u303f\u4e00-\u9fa5\uff01-\uff5e]/u.test(ch);
}
