// sight-folio: C3 写法对照工作台 · 纯函数（对照句筛选 + 本地节奏差异拆解）
//
// 职责边界：
// - 与 agent 会话/流式、UI 无耦合，单测直跑（不 mock 任何模块）。
// - filterReferenceHits：把 corpusApi.search 召回的命中过滤为「可参考对照句」：
//   剔除碎片句（referenceTier=low），按参考价值排序（high > medium > null）取前 6 条。
// - compareCraft：源句（编辑器选中/问题句）与库内对照句的本地可算差异——
//   字符规模与节奏对比（后端 analysis.charCount 口径：汉字/标点计 1，连续 ASCII 词计 1）。
//   视角/细节密度等需语义判断的维度不在此模块伪造，交由 LLM 改写请求承担。
import type { CorpusSearchHit } from '../services/corpus';

/** 对照句展示上限 */
export const CRAFT_REFERENCE_LIMIT = 6;

const TIER_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * 过滤并排序对照句：剔除碎片句（low），high > medium > null 排序，截断取前 limit 条。
 * 返回新的数组，不修改入参。
 */
export function filterReferenceHits(hits: CorpusSearchHit[], limit = CRAFT_REFERENCE_LIMIT): CorpusSearchHit[] {
  if (!hits || hits.length === 0) return [];
  return [...hits]
    .filter((h) => h.referenceTier !== 'low')
    .sort((a, b) => (TIER_ORDER[a.referenceTier ?? 'medium'] ?? 1) - (TIER_ORDER[b.referenceTier ?? 'medium'] ?? 1))
    .slice(0, Math.max(1, limit));
}

/** 源句的简易字符计数（与后端 charCount 口径对齐：汉字/标点计 1，连续 ASCII 词计 1）。 */
export function countSourceChars(text: string): number {
  const t = (text ?? '').trim();
  if (!t) return 0;
  // 连续 ASCII 词（含数字/下划线）折叠为单个占位字符，与后端 charCount 逐词计 1 的口径对齐；
  // 词内/词间空白不计（汉字/标点计 1）
  return t.replace(/[A-Za-z0-9_]+/g, '_').replace(/\s+/g, '').length;
}

/** 本地节奏差异拆解结果 */
export interface CraftComparison {
  /** 源句字符数（简易计数） */
  sourceChars: number;
  /** 对照句字符数（后端统计；旧服务端无 analysis 时回退为本地计数） */
  candidateChars: number;
  /** 差异（candidate - source） */
  charDelta: number;
  /** 相对源句的比例（百分数，四舍五入；源句为空时为 0） */
  ratio: number;
  /** 节奏标签：longer（对照句明显更长）/ shorter（明显更短）/ similar（相当） */
  tempo: 'longer' | 'shorter' | 'similar';
}

/** 阈值：±20% 内视为节奏相当 */
const SIMILAR_THRESHOLD = 0.2;

/**
 * 源句 vs 库内对照句的本地节奏对比：
 * 基于字符规模差异给出 longer / shorter / similar 标签与比例，供对照卡片徽标展示。
 */
export function compareCraft(source: string, hit: CorpusSearchHit): CraftComparison {
  const sourceChars = countSourceChars(source);
  const candidateChars = hit.analysis?.charCount ?? countSourceChars(hit.content);
  const charDelta = candidateChars - sourceChars;
  const ratio = sourceChars > 0 ? Math.round((charDelta / sourceChars) * 100) : 0;
  const tempo: CraftComparison['tempo'] =
    sourceChars === 0
      ? 'similar'
      : Math.abs(charDelta) / sourceChars > SIMILAR_THRESHOLD
        ? charDelta > 0
          ? 'longer'
          : 'shorter'
        : 'similar';
  return { sourceChars, candidateChars, charDelta, ratio, tempo };
}
