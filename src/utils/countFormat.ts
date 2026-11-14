// 窄栏里的数字该怎么写（纯函数，零 React、零 DOM）。
//
// 为什么要有这个文件（2026-11-08 李先生：书体量一大，洞察卡就局促、布局被打乱）：
// 数字是**不可折行**的内容。`1,234,567` 这种长度在「一行三格」的 KPI 里，
// 会把 grid 轨道的最小宽度顶开 —— 而洞察卡所在容器的外层是 `overflowX: hidden`，
// 顶开的结果不是换行，是**被裁掉**：字数看不见，卡片还歪了。
// 所以规则只有一条：**装得下就写准数，装不下就写紧凑形态，并且把准数留在 title 里**。
// 绝不为了"看起来整齐"提前丢精度 —— 短数字（3,600）必须还是 3,600。
import { getLang, type Lang } from '../i18n';

/** 一个 KPI 格子大概能放几个字符（含千分位逗号）。超过它就走紧凑形态。 */
export const WIDE_COUNT_CHARS = 7;

export interface CountText {
  /** 显示形态：普通分组数字（如 `3,600`）或紧凑形态（如 `123.5万` / `1.2M`） */
  text: string;
  /** 变成紧凑形态时，精确值的分组写法（放 title 用）；没变就是 null */
  exact: string | null;
}

function localeOf(lang: Lang): string {
  return lang === 'zh-CN' ? 'zh-CN' : 'en-US';
}

/**
 * 按格子宽度预算决定数字写法。
 * Intl 不可用或不支持 `notation:'compact'`（老运行时）时**退回分组写法**，
 * 宁可能挤一点，也不许显示成 `undefined` / `NaN`。
 */
export function cellCount(n: number, lang: Lang = getLang()): CountText {
  const safe = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  const locale = localeOf(lang);
  let exact = String(safe);
  try {
    exact = safe.toLocaleString(locale);
  } catch {
    exact = String(safe);
  }
  if (exact.length <= WIDE_COUNT_CHARS) return { text: exact, exact: null };
  try {
    const text = new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(safe);
    // 万一这个 locale 不支持紧凑（原样返回长串），就别假装缩短了
    if (text.length >= exact.length) return { text: exact, exact: null };
    return { text, exact };
  } catch {
    return { text: exact, exact: null };
  }
}
