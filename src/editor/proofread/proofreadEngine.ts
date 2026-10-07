// sight-folio: 校对引擎（批次③ T5）
// 纯前端轻量检测：错别字（高频错词短语）、重复用词、敏感词。
// 输入：纯文本（从 TipTap editor.getText() 获得）；输出：Issue[] 按位置排序。
import { TYPO_PHRASES } from './typoPhrases';
import { SENSITIVE_WORDS_SORTED } from './sensitiveWords';

export type IssueKind = 'typo' | 'repeat' | 'sensitive';

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
  /** sensitive 专用 */
  severity?: 'warning' | 'block';
}

/** 主入口：对单章正文执行全部检测，返回按 start 升序、start 相同按优先级（block>warning>typo>repeat）排序的问题列表 */
export function runProofread(text: string): ProofreadIssue[] {
  const all: ProofreadIssue[] = [...detectTypos(text), ...detectRepeats(text), ...detectSensitive(text)];
  all.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const pa = priority(a);
    const pb = priority(b);
    return pb - pa; // 高优先级在前
  });
  return all;
}

function priority(i: ProofreadIssue): number {
  if (i.kind === 'sensitive' && i.severity === 'block') return 3;
  if (i.kind === 'sensitive') return 2;
  if (i.kind === 'typo') return 1;
  return 0;
}

/** 错别字：基于高频错词短语表（多字词级），命中即报 */
function detectTypos(text: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  for (const { wrong, right } of TYPO_PHRASES) {
    let pos = text.indexOf(wrong);
    while (pos !== -1) {
      issues.push({
        kind: 'typo',
        start: pos,
        end: pos + wrong.length,
        excerpt: text.slice(Math.max(0, pos - 3), Math.min(text.length, pos + wrong.length + 3)),
        suggestion: `应为「${right}」`,
      });
      pos = text.indexOf(wrong, pos + 1);
    }
  }
  return issues;
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
function detectSensitive(text: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  for (const { word, level } of SENSITIVE_WORDS_SORTED) {
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
