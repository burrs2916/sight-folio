import type { AiContextSection, AiSectionStamp } from "./contextTypes";
import { digestOf } from "./tokenBudget";

/**
 * 分节级增量：上下文包的「差分引擎」。
 *
 * 为什么需要它
 * ------------
 * 项目扫描是持续发生的：改一个文件就触发一次增量重扫，一天可能几十上百次。
 * 但一次文件改动通常只会撼动 12 个分节里的一两个（改注释只动技术债、加一个 import 只动依赖）。
 * 在此之前，整个上下文包是「一个原子」：
 *   - 只要有一处变化，12 个分节全部重写进库（大项目单次几十 KB 的无谓 IO）；
 *   - 更要命的是 Agent 侧——它无从得知哪一节变了，每轮分析只能把全部分节重读一遍，
 *     而重读未变化的内容是纯粹的 token 浪费，还会稀释真正的增量信号。
 *
 * 这里把「原子」拆到分节粒度：每节各自算指纹，未变的节继承旧的 updatedAt。
 * 于是写库只写变化节，Agent 也能用 `since` 只取变化节，形成真正的增量分析。
 *
 * 本模块刻意**不含任何模块知识**（不认识扫描、画布、报告），
 * 任何实现 AiContextProvider 的模块直接复用即可，这是「未来接入其他模块零改动」的一部分。
 */

/** 分节指纹：只认 key + 正文。标题/摘要属展示层，抖动不该判定为内容变化 */
export function sectionDigest(section: Pick<AiContextSection, "key" | "content">): string {
  return digestOf(`${section.key}\u0000${section.content}`);
}

/** 从已打戳的分节取出戳表，供下一轮构建比对 */
export function toStampMap(sections: AiContextSection[]): Record<string, AiSectionStamp> {
  const out: Record<string, AiSectionStamp> = {};
  for (const s of sections) {
    out[s.key] = { digest: s.digest, updatedAt: s.updatedAt };
  }
  return out;
}

export interface StampResult {
  /** 已填好 digest / updatedAt 的分节（顺序与入参一致） */
  sections: AiContextSection[];
  /** 内容变化或新增的分节键 */
  changed: string[];
  /** 内容未变化的分节键 */
  unchanged: string[];
}

/**
 * 给一批分节打戳并算出变更集。
 *
 * updatedAt 语义是「内容最后一次变化的时间」，不是「最后一次重建的时间」——
 * 这是整个增量机制的支点：未变化的分节必须继承旧值，否则每轮重扫全部刷新，
 * Agent 侧 `since` 过滤就永远命中全部，增量退化为全量。
 *
 * @param previous 上一轮的戳表；不传（或某键缺失）即视为新增
 * @param now      变化分节的 updatedAt 取值
 */
export function stampSections(
  sections: AiContextSection[],
  previous?: Record<string, AiSectionStamp>,
  now: number = Date.now(),
): StampResult {
  const changed: string[] = [];
  const unchanged: string[] = [];

  const stamped = sections.map((section) => {
    const digest = sectionDigest(section);
    const prev = previous?.[section.key];
    // prev.digest 为空串时一律判为变化：空指纹意味着上一轮没走差分（或来自旧版本
    // schema 的历史数据），此时宁可多写一次，也不能把陈旧内容当成「已是最新」。
    const same = !!prev && !!prev.digest && prev.digest === digest;
    if (same) {
      unchanged.push(section.key);
      return { ...section, digest, updatedAt: prev.updatedAt || now };
    }
    changed.push(section.key);
    return { ...section, digest, updatedAt: now };
  });

  return { sections: stamped, changed, unchanged };
}

/**
 * 包级指纹：由各分节指纹按 key 排序后组合。
 *
 * 排序是必要的——分节构建顺序若因预设裁剪而改变，不应被误判成内容变化。
 *
 * **派生分节（derived）一律排除。** 包指纹的唯一职责是回答「客观数据变了没有」，
 * 而派生分节的内容由 AI 自己的产出决定。把它算进去，「分析 → 指纹变 → 再分析」
 * 就成了一个自我供能的死循环，且账面上全绿无从察觉。
 * 详见 contextTypes 里 AiContextSection.derived 的说明。
 */
export function packDigestFromSections(
  scopeId: string,
  schemaVersion: number,
  sections: AiContextSection[],
): string {
  const parts = sections
    .filter((s) => !s.derived)
    .map((s) => `${s.key}:${s.digest}`)
    .sort()
    .join("|");
  return digestOf(`${scopeId}|${schemaVersion}|${parts}`);
}

/** 持久化策略 */
export type PersistMode =
  /** 一个分节都没变：跳过写库 */
  | "skip"
  /** 只重写变化的分节 */
  | "partial"
  /** 整包重写（首次 / 协议升版 / 分节集合变化 / 变化面过大） */
  | "full";

export interface PersistDecisionInput {
  /** 本次变化的分节键 */
  changed: string[];
  /** 本次包内全部分节键 */
  allKeys: string[];
  /** 库里已有的分节键；未知（未水合）传 null */
  knownKeys: string[] | null;
  /** 库里已有包的协议版本；未知传 null */
  knownSchemaVersion: number | null;
  /** 当前协议版本 */
  schemaVersion: number;
  /**
   * 变化占比超过该阈值就整包重写：部分写要逐节 upsert，
   * 变化面大时一次性重写反而更省事，也顺带清掉可能的脏节。
   */
  fullRewriteRatio?: number;
}

/**
 * 决定这次该怎么写库。
 *
 * 判定顺序是有讲究的：先排除「库里状态不可信」的情况（未水合 / 版本不符 / 分节集合变了），
 * 这些场景下即便 changed 为空也必须整包重写，否则会把库里的残缺状态永久固化下来。
 */
export function decidePersistMode(input: PersistDecisionInput): PersistMode {
  const { changed, allKeys, knownKeys, knownSchemaVersion, schemaVersion } = input;
  const ratio = input.fullRewriteRatio ?? 0.6;

  // 库里状态未知：不能假设它与本次一致
  if (!knownKeys) return "full";
  // 协议升版：新旧字段不得混存
  if (knownSchemaVersion !== schemaVersion) return "full";

  // 分节集合发生增删（预设裁剪、新增维度、旧节下线）→ 部分写会留下孤儿节
  const known = new Set(knownKeys);
  const current = new Set(allKeys);
  if (known.size !== current.size || allKeys.some((k) => !known.has(k))) return "full";

  if (changed.length === 0) return "skip";
  if (allKeys.length > 0 && changed.length / allKeys.length >= ratio) return "full";
  return "partial";
}
