/**
 * contextPersist —— 模块上下文包的**唯一**落库入口。
 *
 * 为什么必须收成一个入口
 * ----------------------
 * 在此之前有两个地方会写同一个 pack_id（`{scopeId}:{moduleId}`）：
 *   · projectStore.persistScanContext —— 扫描收尾，写**全集**分节，走分节级增量；
 *   · analysisRunner.launchModuleAnalysis —— 发起分析，按预设裁剪后写**子集**分节。
 *
 * 后者是一颗哑弹。后端 `save_pack` 的语义是「先 DELETE 该包全部分节，再插入传入的分节」，
 * 于是「用技术债预设分析一次」＝ 把库里其余分节全部删掉：
 *   ① 持久化的上下文从完整变成残缺，别的维度再想取就没有了；
 *   ② projectStore 内存里的分节戳仍然记着那些分节「已存在且未变」，
 *      下次增量重扫算出 changed 为空 → 走 partial 或 skip → **被删掉的分节永远补不回来**，
 *      除非重启应用或整包重扫。数据在用户毫无察觉的情况下越用越少。
 *   ③ 包指纹变成「子集的指纹」，而覆盖台账要拿它跟当前上下文指纹比对，
 *      不同预设各自留下不同口径的指纹，比出来的「结论是否过期」全是噪音。
 *
 * 所以这里把三件事一次性收口：
 *   **落库的永远是全集**（省 token 靠的是「Agent 只取需要的分节」，不是「库里只存一部分」）、
 *   **分节戳缓存全局共享**（谁写库都更新同一份，不会互相欺骗）、
 *   **写库方式统一由 decidePersistMode 决策**（skip / partial / full）。
 *
 * 模块无关：本文件只认 AiContextProvider 协议，没有任何扫描知识。
 * 未来画布、报告等模块接入时，实现 provider 即可直接继承整套增量与一致性保证。
 */
import type { AiContextPack, AiContextProvider, AiSectionStamp } from "./contextTypes";
import { AI_CONTEXT_SCHEMA_VERSION } from "./contextTypes";
import { decidePersistMode, sectionDigest, toStampMap, type PersistMode } from "./sectionDiff";
import { buildInsightLedgerSection, loadInsightFeedback } from "./insightFeedback";
import { aiContextApi } from "../services/tauri";
import { logger } from "../utils/logger";

/** 库内包 id 的唯一算法，必须与后端 `format!("{}:{}", scope_id, module_id)` 保持一致 */
export function contextPackId(moduleId: string, scopeId: string): string {
  return `${scopeId}:${moduleId}`;
}

/**
 * 上次落库的分节戳（key → {digest, updatedAt}）。
 * `null` = 已确认库里没有历史包；`undefined`（键不存在）= 尚未水合，需要先查一次库。
 * 这两者必须分开：把「没查过」当成「没有」会让应用每次重启后整包重写，
 * 所有分节的 updatedAt 一起刷新，Agent 侧「只读变化节」的增量随之失效。
 */
const stampCache = new Map<string, Record<string, AiSectionStamp> | null>();
/** 上次落库时库内的分节键集合与协议版本：判定能否安全走部分写 */
const metaCache = new Map<string, { keys: string[]; schemaVersion: number }>();
/** 上次成功落库的包指纹：给调用方做「内容没变就别再触发下游」的判断 */
const digestCache = new Map<string, string>();

/** 测试与「重新装载项目」时清空缓存，避免跨用例/跨项目串味 */
export function resetContextPersistCache(packId?: string): void {
  if (packId) {
    stampCache.delete(packId);
    metaCache.delete(packId);
    digestCache.delete(packId);
    return;
  }
  stampCache.clear();
  metaCache.clear();
  digestCache.clear();
}

/** 最近一次落库的包指纹（未落过库返回 undefined） */
export function lastPersistedDigest(moduleId: string, scopeId: string): string | undefined {
  return digestCache.get(contextPackId(moduleId, scopeId));
}

/**
 * 水合历史分节戳：优先内存，缺失时查库（只取戳，不取正文，很轻）。
 * 查库失败**不抛**——退化为「无历史」，最坏结果是整包重写一次，功能仍然正确。
 */
async function hydrateStamps(packId: string): Promise<Record<string, AiSectionStamp> | null> {
  const cached = stampCache.get(packId);
  if (cached !== undefined) return cached;

  try {
    const stamps = await aiContextApi.listAiContextSectionStamps(packId);
    const hydrated = stamps.length
      ? Object.fromEntries(stamps.map((s) => [s.sectionKey, { digest: s.digest, updatedAt: s.updatedAt }]))
      : null;
    stampCache.set(packId, hydrated);
    if (hydrated) {
      metaCache.set(packId, {
        keys: stamps.map((s) => s.sectionKey),
        // 旧版本包的分节没有指纹：标成 -1，下一步会因协议版本不符判为整包重写
        schemaVersion: stamps.every((s) => s.digest) ? AI_CONTEXT_SCHEMA_VERSION : -1,
      });
    }
    return hydrated;
  } catch (err) {
    logger.warn("contextPersist", "分节戳水合失败，本次退化为整包重写", { packId, error: err });
    stampCache.set(packId, null);
    return null;
  }
}

/**
 * 把「AI 结论账本」挂进包里 —— 这是回流闭环在持久化侧的落点。
 *
 * 为什么放在这里，而不是让每个模块自己实现
 * ----------------------------------------
 * 账本的原料（ai_insights）是按 scopeId 归档的**通用**沉淀，与模块无关：
 * 画布、报告将来接入时，它们的结论同样躺在这张表里。放在这个唯一落库入口，
 * 任何模块实现 provider 的那一刻就自动继承了「Agent 能看见自己上几轮说过什么」，
 * 一行都不用改——这正是整套协议分层想要的效果。
 *
 * 三个必须守住的点
 * ----------------
 * ① **derived 分节不进包指纹**（在 packDigestFromSections 里排除），所以这里
 *    **不重算 pack.digest**：重算不仅多余，还会把「存了一条洞察」变成「数据变了」，
 *    进而形成分析→存洞察→指纹变→再分析的自激循环。
 * ② **必须计入 allKeys 与分节戳**。漏掉的话，库里存在这个键而本次 allKeys 没有，
 *    decidePersistMode 每轮都会因「分节集合不一致」判定整包重写，
 *    所有分节的 updatedAt 被一起刷新，Agent 侧 `since` 增量彻底失效。
 * ③ **读库失败不阻断**：账本是增强能力。失败时 loadInsightFeedback 返回
 *    available:false，分节照挂但明确写着「读取失败」——绝不能让它缺席，
 *    缺席会被 Agent 读成「此前没有分析过」，比读取失败更糟。
 */
async function attachInsightLedger(
  pack: AiContextPack,
  scopeId: string,
  previous: Record<string, AiSectionStamp> | null,
  now: number,
): Promise<void> {
  const feedback = await loadInsightFeedback(scopeId);
  const section = buildInsightLedgerSection(feedback);

  const digest = sectionDigest(section);
  const prev = previous?.[section.key];
  const same = !!prev && !!prev.digest && prev.digest === digest;
  section.digest = digest;
  section.updatedAt = same ? prev.updatedAt || now : now;

  pack.sections.push(section);
  pack.tokenEstimate += section.tokenEstimate;
  if (!same) pack.changedSections.push(section.key);
}

export interface PersistContextResult {
  packId: string;
  /** 本次构建出的**全集**包 */
  pack: AiContextPack;
  mode: PersistMode;
  /** 与上次落库相比，内容是否有实质变化（mode === "skip" 时为 false） */
  changed: boolean;
}

export interface PersistContextOptions {
  /** 构建时间戳，测试可注入 */
  now?: number;
  /**
   * 强制整包重写。仅用于「怀疑库内被外部改动过」的修复场景；
   * 常规路径不要开——它会把所有分节 updatedAt 一起刷新，抹掉增量信号。
   */
  forceFull?: boolean;
}

/**
 * 构建并持久化某模块在某作用域下的**完整**上下文包。
 *
 * 返回的 pack 一定是全集（不接受 sectionKeys 裁剪参数——这是刻意的：
 * 裁剪只应发生在「告诉 Agent 读哪几节」这一步，绝不能发生在落库这一步）。
 *
 * 失败会抛出，由调用方决定是否吞掉。扫描收尾与自动编排都应当吞——
 * 上下文持久化是增强能力，不能反过来打断主流程。
 */
export async function persistModuleContext(
  provider: AiContextProvider,
  scopeId: string,
  options: PersistContextOptions = {},
): Promise<PersistContextResult | null> {
  const packId = contextPackId(provider.moduleId, scopeId);
  const previous = await hydrateStamps(packId);

  const pack = provider.buildPack(scopeId, {
    previousSections: previous ?? undefined,
    now: options.now,
  });
  if (!pack) return null;

  // 挂账本必须在 allKeys / decidePersistMode **之前**：它是包的正式成员，
  // 只是不参与指纹。晚一步就会变成「库里有、本次没有」的孤儿键。
  // 整段吞异常：结论回流是增强能力，不能反过来打断上下文持久化本身。
  try {
    await attachInsightLedger(pack, scopeId, previous, options.now ?? Date.now());
  } catch (err) {
    logger.warn("contextPersist", "结论账本挂载失败（不影响本次落库）", { packId, error: err });
  }

  const allKeys = pack.sections.map((s) => s.key);
  const meta = metaCache.get(packId);
  const mode: PersistMode = options.forceFull
    ? "full"
    : decidePersistMode({
        changed: pack.changedSections,
        allKeys,
        knownKeys: previous ? (meta?.keys ?? Object.keys(previous)) : null,
        knownSchemaVersion: previous ? (meta?.schemaVersion ?? -1) : null,
        schemaVersion: pack.schemaVersion,
      });

  if (mode === "partial") {
    const written = await aiContextApi.saveAiContextSections(pack, pack.changedSections);
    logger.info("contextPersist", "上下文包增量更新", {
      packId,
      written,
      total: allKeys.length,
      changed: pack.changedSections,
    });
  } else if (mode === "full") {
    await aiContextApi.saveAiContextPack(pack);
    logger.info("contextPersist", "上下文包整包落库", {
      packId,
      sections: pack.sections.length,
      tokenEstimate: pack.tokenEstimate,
      truncated: pack.truncatedSections.length,
    });
  }

  if (mode !== "skip") {
    digestCache.set(packId, pack.digest);
    stampCache.set(packId, toStampMap(pack.sections));
    metaCache.set(packId, { keys: allKeys, schemaVersion: pack.schemaVersion });
  }

  return { packId, pack, mode, changed: mode !== "skip" };
}
