import type { Lang } from '../i18n';

// 语料库大数友好格式化：中文语境 ≥1 万自动折算「万」单位，避免 5109253 这类
// 裸数字在详情/书卡上难以直读；英文语境保持千分位（5,109,253）。
//
// 约定：返回值是「数字 + 单位」的纯字符串（如 "510.9万"、"10万"、"5,109"），
// 由调用方拼进既有 i18n 模板（{n} 字 / {n} words），不复写语言包格式。
export function formatBigCount(n: number, lang: Lang): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (lang === 'zh-CN' && n >= 10000) {
    const wan = n / 10000;
    // 保留 1 位小数；10.0 → "10"，510.9 → "510.9"
    const v = Math.round(wan * 10) / 10;
    return `${v}万`;
  }
  return n.toLocaleString('en-US');
}

// 平均句长（字/句）：chunkCount 为句子级 chunk 数，>0 时才有意义；
// 返回四舍五入后的整数，chunkCount <= 0 返回 null（调用方决定是否展示）。
export function avgSentenceLen(wordCount: number, chunkCount: number): number | null {
  if (!Number.isFinite(wordCount) || !Number.isFinite(chunkCount) || chunkCount <= 0) return null;
  return Math.round(wordCount / chunkCount);
}
