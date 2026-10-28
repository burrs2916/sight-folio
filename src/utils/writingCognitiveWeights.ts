// 认知权重（人设卡的六维决策倾向）的**单一口径**。
//
// 为什么单独抽出来：这块语义原先散在三处，而且三处都在悄悄丢掉同一个取值——
// 1. 卡面板滑块的 onChange 把 0 转成 null；
// 2. 写入函数 `value !== 0 才存，否则 delete`；
// 3. 喂 AI 的格式化 `n !== 0 才输出`。
// 于是「中立」这个明明有信息量的取值（他在理性↔感性上不偏不倚，是长篇人设里常见且
// 重要的设定），在库里不存在、在 AI 上下文里也不存在，而滑块停在 0 还会让作者以为记上了。
//
// 现在只有一份定义：**null = 未设置（删除该维）；0 = 中立（照常保留并告知 AI）**。
// 维度清单也在这里，UI 与 AI 共用——此前 UI 走 i18n 取词、AI 那边却硬编码中文词，
// 两份清单各自漂移只是时间问题。
import type { WritingCognitiveWeights } from '../services/tauri';

export type CognitiveWeightField = keyof WritingCognitiveWeights;

export interface CognitiveDimension {
  key: CognitiveWeightField;
  /** 负向端的 i18n 键（如"集体""理性"） */
  negKey: string;
  /** 正向端的 i18n 键（如"个人""感性"） */
  posKey: string;
}

/**
 * 六维定义。**UI 与 AI 上下文都从这里取**，不要再各写一份字面量数组。
 * 顺序即界面展示顺序。
 */
export const COGNITIVE_DIMENSIONS: readonly CognitiveDimension[] = [
  { key: 'collectiveVsIndividual', negKey: 'writing.cwCollective', posKey: 'writing.cwIndividual' },
  { key: 'idealVsRealistic', negKey: 'writing.cwIdeal', posKey: 'writing.cwRealistic' },
  { key: 'trustVsDoubt', negKey: 'writing.cwTrust', posKey: 'writing.cwDoubt' },
  { key: 'fateVsFreedom', negKey: 'writing.cwFate', posKey: 'writing.cwFreedom' },
  { key: 'rationalVsEmotional', negKey: 'writing.cwRational', posKey: 'writing.cwEmotional' },
  { key: 'riskVsCaution', negKey: 'writing.cwRisk', posKey: 'writing.cwCaution' },
];

const DIM_BY_KEY = new Map<CognitiveWeightField, CognitiveDimension>(
  COGNITIVE_DIMENSIONS.map((d) => [d.key, d]),
);

/** 与滑块 min/max 对齐；越界值一律夹住，避免手改 JSON 造出 ±100 这种畸形设定 */
export const COGNITIVE_WEIGHT_MIN = -10;
export const COGNITIVE_WEIGHT_MAX = 10;

export function clampCognitiveWeight(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(COGNITIVE_WEIGHT_MIN, Math.min(COGNITIVE_WEIGHT_MAX, Math.trunc(n)));
}

/**
 * 写入一个维度的值。返回**新的**权重对象；整组为空时返回 `undefined`，
 * 由调用方决定把 `profile.cognitiveWeights` 这个键整个删掉（保持 extra 干净）。
 *
 * `null` 与 `0` 含义不同，这是本文件存在的全部理由：
 * - `null` → 未设置：删掉该维，AI 不会替作者猜；
 * - `0` → 中立：保留下来，并作为"这一维他确实不偏"告诉 AI。
 */
export function withCognitiveWeight(
  current: WritingCognitiveWeights | undefined,
  field: CognitiveWeightField,
  value: number | null,
): WritingCognitiveWeights | undefined {
  const next: WritingCognitiveWeights = { ...(current ?? {}) };
  if (value === null) {
    delete next[field];
  } else {
    next[field] = clampCognitiveWeight(value);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** 已设置的维度（含 0）。未设置的维度不会出现，而不是被当成 0。 */
export function setCognitiveDimensions(
  cw: WritingCognitiveWeights | undefined,
): Array<{ key: CognitiveWeightField; value: number }> {
  if (!cw) return [];
  return COGNITIVE_DIMENSIONS.map((d) => ({ key: d.key, value: cw[d.key] })).filter(
    (x): x is { key: CognitiveWeightField; value: number } => typeof x.value === 'number',
  );
}

/**
 * 单个维度的展示词。
 * - `undefined` → `''`（没设过，不参与展示，调用方 filter 掉）；
 * - `0` → 「理性/感性均衡」：用该维**两端已有的词**拼，不引入新术语；
 * - 其余 → 「感性3」（偏向端 + 幅度）。
 *
 * 「均衡」这一支交给模板串（`writing.cwBalancedPattern`）而不是在这里拼，因为中英文语序
 * 不同：中文是「理性/感性均衡」，英文要 "rational/emotional balanced"（带空格）。
 * 硬拼会把英文写成 `rational/emotionalbalanced`。
 *
 * 三个词都由调用方传入已翻译的文本，本函数不碰 i18n。
 */
export function formatCognitiveDimension(
  value: number | undefined,
  negLabel: string,
  posLabel: string,
  balancedPattern: string,
): string {
  if (value === undefined) return '';
  if (value === 0) {
    return balancedPattern.replace('{neg}', negLabel).replace('{pos}', posLabel);
  }
  return `${value > 0 ? posLabel : negLabel}${Math.abs(value)}`;
}

/**
 * 一行的完整决策倾向；一个维度都没设时返回 null（调用方据此整段省略，不印空标题）。
 * `title` 由调用方传入（如 `writing.cwLineTitle`）——这段文案原先硬编码在 AI 上下文构造器里，
 * 等于是把中文写死进了 prompt 组装路径。
 */
export function formatCognitiveWeightLine(
  characterName: string,
  cw: WritingCognitiveWeights | undefined,
  labels: {
    neg: (key: string) => string;
    pos: (key: string) => string;
    balancedPattern: string;
    title: string;
  },
): string | null {
  const parts = setCognitiveDimensions(cw)
    .map(({ key, value }) => {
      const dim = DIM_BY_KEY.get(key);
      if (!dim) return '';
      return formatCognitiveDimension(
        value,
        labels.neg(dim.negKey),
        labels.pos(dim.posKey),
        labels.balancedPattern,
      );
    })
    .filter(Boolean);
  return parts.length ? `  ${characterName}${labels.title}${parts.join(' / ')}` : null;
}
