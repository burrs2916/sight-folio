/**
 * entityRegression —— 实体（文件）榜单的**唯一**记录与对比入口（模块无关）。
 *
 * 它与 metricTrend 的分工
 * ----------------------
 *   metricTrend   →「项目整体在变好还是变坏」（总量：技术债 87 → 91）
 *   entityRegression →「**哪个文件**在变坏」（对象：payment.ts 复杂度 +38%、扇入 +12）
 *
 * 只有总量时，Agent 能写出的最好结论是「整体略有恶化，建议关注技术债」——
 * 一句放在任何项目上都成立、因而毫无价值的话。落到对象之后才有行动，
 * 也才谈得上注意力分配：「上一轮之后变坏的文件」显然比「一直很大但没人动过的文件」更该先看。
 *
 * 职责边界（与整套 AI 上下文架构保持一致）
 * ----------------------------------------
 *   模块侧 collectEntitySnapshot() → 只回答「榜单是谁 / 各维取值多少 / 哪些维度这次没看到 /
 *                                    上一批实体现在还在不在」（全是模块知识）
 *   本文件                          → 指纹、去重、加载、可比性判定、方向判定、结论（通用逻辑）
 *   后端                            → 只存取 JSON，零解析
 *
 * 四条不能让步的判定口径（每条都对应一种会**说谎**的实现）
 * --------------------------------------------------------
 * ① 新上榜的实体单列 appeared，绝不混进 worsened —— 否则每次新增功能都刷一屏假警报。
 * ② 截断边界不判「已修复」—— 只有旧分数**严格高于当前门槛**时，缺席才是可解释的下降。
 * ③ 实体消失优先判 removed —— 删文件不是质量改善，否则「清理遗留模块」会刷出漂亮曲线。
 * ④ 维度盲区逐维不可比；可用维度集合一变，综合分口径就变了，整体分数不可比。
 *
 * 还有一条藏得更深的
 * ------------------
 * **方向判定必须落在原始维度值上，不能落在综合分上。**
 * 综合分是分位加权，别的文件动了它就会动——一个一行没改的文件也能凭空涨两分。
 * 拿它判「这个文件变坏了」，等于把「同批文件的相对位移」报成「这个文件在恶化」。
 * 综合分只用于排序与展示；「变没变坏」永远看 complexity / churn / 重复行这些客观量。
 */
import type {
  AiContextProvider,
  AiEntityChange,
  AiEntityDelta,
  AiEntityDimDelta,
  AiEntityRecord,
  AiEntityRegressionReport,
  AiEntitySnapshot,
  AiMetricBetter,
  AiTrendDirection,
} from "./contextTypes";
import { L } from "./aiLang";
import { t } from "../i18n";
import { aiContextApi, type AiEntitySnapshotDto } from "../services/tauri";
import { logger } from "../utils/logger";

/** 单维相对变化下限（%）：低于它当抖动，不参与方向判定 */
const DIM_MIN_PCT = 10;

/** 指纹保留小数位：避免浮点尾数抖动凭空造出一个新的时间点 */
const FINGERPRINT_PRECISION = 4;

/** 默认取多少个历史点（回归只对照上一个点，多取几个纯粹为了兜底） */
const DEFAULT_LIMIT = 4;

const reportCache = new Map<string, AiEntityRegressionReport>();

function cacheKey(moduleId: string, scopeId: string): string {
  return `${scopeId}:${moduleId}`;
}

export function resetEntityRegressionCache(moduleId?: string, scopeId?: string): void {
  if (moduleId && scopeId) {
    reportCache.delete(cacheKey(moduleId, scopeId));
    return;
  }
  reportCache.clear();
}

/**
 * 最近一次算出的回归报告（同步读）。
 *
 * 与 readTrendReport 同理：buildPack 是同步的、历史要查库是异步的，
 * 所以链路必须「先 await captureEntitySnapshot 刷新缓存 → 再 buildPack 同步读」。
 */
export function readEntityRegression(
  moduleId: string,
  scopeId: string,
): AiEntityRegressionReport | null {
  return reportCache.get(cacheKey(moduleId, scopeId)) ?? null;
}

/** FNV-1a 32bit：与项目其余指纹算法同源 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function round(value: number, digits = FINGERPRINT_PRECISION): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * 榜单指纹：同一张榜必同指纹。
 *
 * 原始维度值也进指纹（不只是名次和分数）——一个文件复杂度涨了但名次没变，
 * 那是实实在在的变化，不该被合并成「什么都没发生」。
 * 覆盖面同样进指纹，理由与指标快照一致：要能区分「没跑」和「跑了但值一样」。
 */
export function fingerprintEntities(
  entities: AiEntityRecord[],
  coverage: AiEntitySnapshot["coverage"],
): string {
  const e = [...entities]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((x) => {
      const dims = Object.keys(x.dims)
        .sort()
        .map((k) => `${k}=${round(x.dims[k])}`)
        .join(",");
      return `${x.id}@${round(x.score)}{${dims}}`;
    })
    .join("|");
  const c = [...coverage]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((x) => `${x.key}:${x.available ? 1 : 0}`)
    .join("|");
  return fnv1a(`${e}#${c}`);
}

/** 库内一行 → 协议形态；JSON 损坏时返回 null（宁可少一个点，也不让整条链路崩掉） */
export function parseEntitySnapshotRow(dto: AiEntitySnapshotDto): AiEntitySnapshot | null {
  try {
    const entities = JSON.parse(dto.entitiesJson) as AiEntityRecord[];
    if (!Array.isArray(entities)) return null;
    const parseArr = <T,>(raw: string): T[] => {
      if (!raw) return [];
      const v = JSON.parse(raw) as T[];
      return Array.isArray(v) ? v : [];
    };
    return {
      moduleId: dto.moduleId,
      scopeId: dto.scopeId,
      digest: dto.digest,
      triggerKind: dto.triggerKind || undefined,
      takenAt: dto.firstAt * 1000,
      lastAt: dto.lastAt * 1000,
      seenCount: dto.seenCount,
      entityLabel: dto.entityLabel || undefined,
      entities: entities.map((e) => ({ ...e, dims: e.dims ?? {} })),
      total: dto.total ?? entities.length,
      cutoff: dto.cutoff ?? 0,
      coverage: parseArr<AiEntitySnapshot["coverage"][number]>(dto.coverageJson),
      dimensions: parseArr<NonNullable<AiEntitySnapshot["dimensions"]>[number]>(dto.dimensionsJson),
      survivedIds: parseArr<string>(dto.survivedJson),
    };
  } catch {
    return null;
  }
}

/** 该快照里可用的维度集合。未登记 = 不可用（与 metricTrend 同一条口径） */
function availableDims(snapshot: AiEntitySnapshot): Set<string> {
  return new Set(snapshot.coverage.filter((c) => c.available).map((c) => c.key));
}

function judge(better: AiMetricBetter, delta: number): AiTrendDirection {
  if (delta === 0) return "flat";
  if (better === "neutral") return "moved";
  if (better === "lower") return delta < 0 ? "improved" : "worsened";
  return delta > 0 ? "improved" : "worsened";
}

interface DimMeta {
  key: string;
  label: string;
  unit: string;
  better: AiMetricBetter;
  minDelta: number;
}

function dimMetaOf(snapshot: AiEntitySnapshot): Map<string, DimMeta> {
  const map = new Map<string, DimMeta>();
  for (const d of snapshot.dimensions ?? []) {
    map.set(d.key, {
      key: d.key,
      label: d.label || d.key,
      unit: d.unit ?? "",
      better: d.better ?? "lower",
      minDelta: d.minDelta ?? 0,
    });
  }
  return map;
}

/** 单维是否算「真的动了」：绝对下限由模块给，相对下限统一 10%（从 0 起步永远算） */
function dimMaterial(from: number, to: number, meta: DimMeta): boolean {
  const delta = to - from;
  if (delta === 0) return false;
  if (Math.abs(delta) < meta.minDelta) return false;
  if (from === 0 || to === 0) return true;
  return Math.abs((delta / Math.abs(from)) * 100) >= DIM_MIN_PCT;
}

export interface EntityCompareOptions {
  /** 基线选谁：上一个点（默认）或最早的点 */
  baseline?: "previous" | "oldest";
}

interface Bucketed extends AiEntityDelta {
  /** 排序权重：越大越靠前，仅内部使用 */
  _weight: number;
}

const CHANGE_ORDER: Record<AiEntityChange, number> = {
  worsened: 0,
  appeared: 1,
  removed: 2,
  improved: 3,
  incomparable: 4,
  flat: 5,
};

/**
 * 由榜单序列（**由新到旧**）算出回归报告。纯函数，便于直接测。
 */
export function buildEntityRegressionReport(
  moduleId: string,
  scopeId: string,
  snapshots: AiEntitySnapshot[],
  options: EntityCompareOptions = {},
): AiEntityRegressionReport {
  const base: AiEntityRegressionReport = {
    moduleId,
    scopeId,
    entityLabel: snapshots[0]?.entityLabel || t("regression.entityFallback"),
    baseline: null,
    current: null,
    points: snapshots.length,
    spanDays: 0,
    scoreComparable: false,
    comparableDims: [],
    blindDims: [],
    worsened: 0,
    improved: 0,
    appeared: 0,
    removed: 0,
    flat: 0,
    incomparable: 0,
    entities: [],
    verdict: "insufficient",
    note: L("还没有可比的历史榜单：这是第一次记录，下次扫描起就能指出谁在变坏。", "No comparable historical board yet: first recording; from the next scan on it can name who is worsening."),
  };
  if (snapshots.length === 0) {
    return { ...base, note: L("尚未记录任何实体榜单。", "No entity boards recorded yet.") };
  }

  const current = snapshots[0];
  const stamp = (s: AiEntitySnapshot) => ({
    takenAt: s.takenAt,
    digest: s.digest,
    triggerKind: s.triggerKind,
  });
  if (snapshots.length === 1) {
    return { ...base, current: stamp(current) };
  }

  const baseline = options.baseline === "oldest" ? snapshots[snapshots.length - 1] : snapshots[1];

  // ── 可比性：先定口径，再比对象 ──
  const curAvail = availableDims(current);
  const baseAvail = availableDims(baseline);
  const comparableDims = [...curAvail].filter((k) => baseAvail.has(k)).sort();
  const blindKeys = [...new Set([...curAvail, ...baseAvail])].filter(
    (k) => !(curAvail.has(k) && baseAvail.has(k)),
  );
  const meta = dimMetaOf(current);
  const baseMeta = dimMetaOf(baseline);
  const blindDims = blindKeys.map((k) => {
    const m = meta.get(k) ?? baseMeta.get(k);
    const missingAt = curAvail.has(k) ? L("基线", "baseline") : L("本次", "this round");
    return {
      key: k,
      label: m?.label ?? k,
      reason: L(`${missingAt}未运行该维度：数值归零是没看，不是变好`, `${missingAt} did not run this dimension: a zero value is "not measured", not "improved"`),
    };
  });
  // 集合相同才谈得上分数可比：打分要在可用维度上做权重归一，
  // 集合一变每个文件的分数都会动，与代码本身毫无关系。
  const sameSet = curAvail.size === baseAvail.size && comparableDims.length === curAvail.size;
  const scoreComparable = sameSet && comparableDims.length > 0;

  const curMap = new Map(current.entities.map((e) => [e.id, e]));
  const baseMap = new Map(baseline.entities.map((e) => [e.id, e]));

  // ── 存活名单的可信度自检 ──
  // survivedIds 为空但基线里明明有实体还在当前榜上，说明这份名单是假的（老数据 / 模块没填）。
  // 此时宁可判不可比，也不能把「跌出榜单」一律当成「文件被删」。
  const overlap = baseline.entities.filter((e) => curMap.has(e.id)).length;
  const survived = new Set(current.survivedIds ?? []);
  const survivalTrusted = survived.size > 0 || overlap === 0;

  const truncated = current.total > current.entities.length;
  const baselineTruncated = baseline.total > baseline.entities.length;

  const deltas: Bucketed[] = [];

  // ── 情形 A：两端都在榜 ──
  for (const cur of current.entities) {
    const prev = baseMap.get(cur.id);
    if (!prev) continue;
    const dims: AiEntityDimDelta[] = [];
    let worse = 0;
    let better = 0;
    let driver: { key: string; pct: number } | null = null;

    for (const key of comparableDims) {
      const m = meta.get(key) ?? baseMeta.get(key) ?? {
        key,
        label: key,
        unit: "",
        better: "lower" as AiMetricBetter,
        minDelta: 0,
      };
      // 维度可用但实体不在该维度的名单里 = 该维度上确实是 0，不是缺数据
      const from = prev.dims[key] ?? 0;
      const to = cur.dims[key] ?? 0;
      const delta = round(to - from);
      const material = dimMaterial(from, to, m);
      const direction: AiTrendDirection = material ? judge(m.better, delta) : "flat";
      if (direction === "worsened") worse += 1;
      if (direction === "improved") better += 1;
      // 主因维度只在**有方向**的维度里选。中性维度（如变更频率）本身说不出好坏，
      // 让它当主因，下面「有涨有跌按主因判定」那一步就会拿一个无方向的信号去裁决方向，
      // 结果是一个只是「最近改得勤」的文件被判成恶化。
      if (direction === "worsened" || direction === "improved") {
        const pct = from === 0 ? Number.POSITIVE_INFINITY : Math.abs((delta / Math.abs(from)) * 100);
        if (!driver || pct > driver.pct) driver = { key, pct };
      }
      dims.push({
        key,
        label: m.label,
        unit: m.unit,
        from,
        to,
        delta,
        direction,
        better: m.better,
      });
    }

    const scoreDelta = scoreComparable ? round(cur.score - prev.score) : null;
    let change: AiEntityChange;
    let reason: string | undefined;

    if (comparableDims.length === 0) {
      change = "incomparable";
      reason = L("两端没有共同可用的维度，无从比较", "No common usable dimensions between the two sides; nothing to compare");
    } else if (worse > 0 && better === 0) {
      change = "worsened";
    } else if (better > 0 && worse === 0) {
      change = "improved";
    } else if (worse > 0 && better > 0) {
      // 有涨有跌：跟随幅度最大的那一维，而不是跟随综合分——
      // 综合分会被同批文件的相对位移带偏，主因维度才是这个文件自己身上发生的事。
      const d = dims.find((x) => x.key === driver?.key);
      change = d?.direction === "improved" ? "improved" : "worsened";
      reason = L(`${dims.filter((x) => x.direction === "worsened").length} 项恶化、${dims.filter((x) => x.direction === "improved").length} 项改善，按主因维度判定`, `${dims.filter((x) => x.direction === "worsened").length} worsened, ${dims.filter((x) => x.direction === "improved").length} improved — judged by the driver dimension`);
    } else {
      change = "flat";
    }

    deltas.push({
      id: cur.id,
      label: cur.label || cur.id,
      change,
      scoreFrom: scoreComparable ? prev.score : null,
      scoreTo: scoreComparable ? cur.score : null,
      scoreDelta,
      rankFrom: prev.rank,
      rankTo: cur.rank,
      resonanceFrom: prev.resonance,
      resonanceTo: cur.resonance,
      sizeFrom: prev.size,
      sizeTo: cur.size,
      dims: dims.filter((d) => d.direction !== "flat"),
      driver: driver?.key,
      reason,
      _weight: Math.abs(scoreDelta ?? 0) + (driver ? Math.min(driver.pct, 999) / 100 : 0),
    });
  }

  // ── 情形 B：基线在榜、当前不在 ──
  for (const prev of baseline.entities) {
    if (curMap.has(prev.id)) continue;
    let change: AiEntityChange = "incomparable";
    let reason = "";
    let scoreTo: number | null = null;
    let approx = false;

    if (survivalTrusted && !survived.has(prev.id)) {
      // 铁律③：文件没了不叫修好了
      change = "removed";
      reason = L("该实体已不存在（文件被删除或改名）——这不是质量改善", "This entity no longer exists (file deleted or renamed) — this is not quality improvement");
    } else if (!survivalTrusted) {
      reason = L("无法确认该实体是否仍然存在，不判定改善", "Cannot confirm the entity still exists; not judged as improved");
    } else if (!scoreComparable) {
      reason = L("两端可用维度集合不同，榜单门槛不可比", "The available-dimension sets differ; board cutoffs are incomparable");
    } else if (!truncated) {
      // 榜单没被截断 → 它是真的掉出了评分名单
      change = "improved";
      scoreTo = 0;
      approx = true;
      reason = L("已跌出评分名单（本次榜单未截断，说明风险信号归零）", "Fell off the scored list (this board was not truncated, so the risk signal went to zero)");
    } else if (prev.score > current.cutoff) {
      // 铁律②：旧分数高于当前门槛，缺席才是可解释的下降
      change = "improved";
      scoreTo = current.cutoff;
      approx = true;
      reason = L(`按旧分数本应在榜（门槛 ${round(current.cutoff, 1)}），缺席说明分数已降至门槛以下`, `Should still be on the board by the old score (cutoff ${round(current.cutoff, 1)}); absence means the score dropped below the cutoff`);
    } else {
      reason = L(`榜单门槛已升至 ${round(current.cutoff, 1)}，无法区分「修好了」与「被挤下榜」`, `The board cutoff rose to ${round(current.cutoff, 1)}; cannot tell "fixed" from "pushed off the board"`);
    }

    deltas.push({
      id: prev.id,
      label: prev.label || prev.id,
      change,
      scoreFrom: scoreComparable ? prev.score : null,
      scoreTo,
      scoreDelta: scoreComparable && scoreTo !== null ? round(scoreTo - prev.score) : null,
      approx: approx || undefined,
      rankFrom: prev.rank,
      rankTo: null,
      resonanceFrom: prev.resonance,
      resonanceTo: null,
      sizeFrom: prev.size,
      sizeTo: null,
      dims: [],
      reason,
      _weight: prev.score,
    });
  }

  // ── 情形 C：新上榜（铁律①：单列，绝不混进恶化榜）──
  for (const cur of current.entities) {
    if (baseMap.has(cur.id)) continue;
    deltas.push({
      id: cur.id,
      label: cur.label || cur.id,
      change: "appeared",
      scoreFrom: null,
      scoreTo: scoreComparable ? cur.score : null,
      scoreDelta: null,
      rankFrom: null,
      rankTo: cur.rank,
      resonanceFrom: null,
      resonanceTo: cur.resonance,
      sizeFrom: null,
      sizeTo: cur.size,
      dims: comparableDims
        .filter((k) => (cur.dims[k] ?? 0) > 0)
        .map((k) => {
          const m = meta.get(k);
          return {
            key: k,
            label: m?.label ?? k,
            unit: m?.unit ?? "",
            from: null,
            to: cur.dims[k] ?? 0,
            delta: null,
            direction: "incomparable" as AiTrendDirection,
            better: m?.better ?? ("lower" as AiMetricBetter),
          };
        }),
      reason:
        baselineTruncated && cur.score <= baseline.cutoff
          ? L(`上一轮分数低于榜单门槛（${round(baseline.cutoff, 1)}），本轮升上来了`, `Last round scored below the board cutoff (${round(baseline.cutoff, 1)}); now it climbed back`)
          : L("上一轮榜单里没有它（新文件，或风险信号从无到有）", "Not on the last board (new file, or risk signals appeared from nothing)"),
      _weight: cur.score,
    });
  }

  const counts = {
    worsened: deltas.filter((d) => d.change === "worsened").length,
    improved: deltas.filter((d) => d.change === "improved").length,
    appeared: deltas.filter((d) => d.change === "appeared").length,
    removed: deltas.filter((d) => d.change === "removed").length,
    flat: deltas.filter((d) => d.change === "flat").length,
    incomparable: deltas.filter((d) => d.change === "incomparable").length,
  };

  // flat 的实体不进明细（一张榜大半是它们，列出来只会淹没真正的变化），但计数保留
  const listed = deltas
    .filter((d) => d.change !== "flat")
    .sort((a, b) => {
      const o = CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change];
      return o !== 0 ? o : b._weight - a._weight;
    })
    .map(({ _weight: _w, ...rest }) => rest);

  let verdict: AiEntityRegressionReport["verdict"];
  if (counts.worsened === 0 && counts.improved === 0 && counts.appeared === 0 && counts.removed === 0) {
    verdict = "flat";
  } else if (counts.worsened === 0 && counts.improved > 0) verdict = "improving";
  else if (counts.improved === 0 && counts.worsened > 0) verdict = "regressing";
  else if (counts.worsened > 0) verdict = "mixed";
  else verdict = "flat";

  const spanDays = round((current.takenAt - baseline.takenAt) / 86_400_000, 2);
  const spanText =
    spanDays >= 1 ? L(`${spanDays} 天`, `${spanDays} days`) : L(`${Math.max(1, Math.round(spanDays * 24 * 60))} 分钟`, `${Math.max(1, Math.round(spanDays * 24 * 60))} min`);
  const label = current.entityLabel || t("regression.entityFallback");
  const worst = listed.find((d) => d.change === "worsened");

  const parts: string[] = [L(`较上一榜单（间隔 ${spanText}）`, `vs. previous board (interval ${spanText})`)];
  if (counts.worsened > 0) {
    const drv = worst?.dims.find((x) => x.key === worst.driver);
    const detail = drv ? L(`${worst?.label} 的${drv.label} ${drv.from} → ${drv.to}${drv.unit}`, `${worst?.label}'s ${drv.label} ${drv.from} → ${drv.to}${drv.unit}`) : worst?.label;
    parts.push(L(`${counts.worsened} 个${label}变坏（${detail}）`, `${counts.worsened} ${label}(s) worsened (${detail})`));
  }
  if (counts.improved > 0) parts.push(L(`${counts.improved} 个改善`, `${counts.improved} improved`));
  if (counts.appeared > 0) parts.push(L(`${counts.appeared} 个新进榜`, `${counts.appeared} newly on the board`));
  if (counts.removed > 0) parts.push(L(`${counts.removed} 个已删除（不计入改善）`, `${counts.removed} removed (not counted as improvement)`));
  if (counts.worsened === 0 && counts.improved === 0 && counts.appeared === 0 && counts.removed === 0) {
    parts.push(L("榜单没有材料性变化", "No material change on the board"));
  }
  if (!scoreComparable) parts.push(L("可用维度集合发生变化，综合分不可比，只逐维比较", "Available-dimension sets changed; composite scores not comparable — compare per dimension only"));
  if (counts.incomparable > 0) parts.push(L(`${counts.incomparable} 个因盲区或榜单截断不可比`, `${counts.incomparable} not comparable due to blind spots or board truncation`));

  return {
    moduleId,
    scopeId,
    entityLabel: label,
    baseline: stamp(baseline),
    current: stamp(current),
    points: snapshots.length,
    spanDays,
    scoreComparable,
    comparableDims,
    blindDims,
    ...counts,
    entities: listed,
    verdict,
    note: `${parts.join("；")}。`,
  };
}

export interface EntityCaptureOptions extends EntityCompareOptions {
  triggerKind?: string;
  now?: number;
  limit?: number;
}

/**
 * 采集一次实体榜单、记入回归序列、刷新缓存。
 *
 * 采集前会先把**上一个点的榜单 id** 取出来交给模块，让它回答「这些实体现在还在不在」——
 * 只有模块知道自己的实体宇宙（扫描模块 = 当前 files 表）。这一步必须发生在采集时：
 * 留到读取时再问，回答的是另一个时刻的问题，人读视图与 Agent 会看到两份不一致的结论。
 *
 * 失败一律吞掉并返回 null：回归是增强能力，不能反过来打断扫描收尾。
 */
export async function captureEntitySnapshot(
  provider: AiContextProvider,
  scopeId: string,
  options: EntityCaptureOptions = {},
): Promise<AiEntityRegressionReport | null> {
  if (!provider.collectEntitySnapshot) return null;

  try {
    const priorRows = await aiContextApi.listEntitySnapshots(provider.moduleId, scopeId, 1);
    const prior = priorRows[0] ? parseEntitySnapshotRow(priorRows[0]) : null;
    const previousIds = prior ? prior.entities.map((e) => e.id) : [];

    const snapshot = provider.collectEntitySnapshot(scopeId, previousIds);
    if (!snapshot || snapshot.entities.length === 0) return null;

    const digest = snapshot.digest || fingerprintEntities(snapshot.entities, snapshot.coverage);
    const takenAt = options.now ?? Date.now();

    const [, isNew] = await aiContextApi.recordEntitySnapshot({
      moduleId: provider.moduleId,
      scopeId,
      digest,
      entityLabel: snapshot.entityLabel,
      entitiesJson: JSON.stringify(snapshot.entities),
      coverageJson: JSON.stringify(snapshot.coverage),
      dimensionsJson: JSON.stringify(snapshot.dimensions ?? []),
      survivedJson: JSON.stringify(snapshot.survivedIds ?? []),
      total: snapshot.total,
      cutoff: snapshot.cutoff,
      triggerKind: options.triggerKind,
      takenAt: Math.floor(takenAt / 1000),
    });

    const rows = await aiContextApi.listEntitySnapshots(
      provider.moduleId,
      scopeId,
      options.limit ?? DEFAULT_LIMIT,
    );
    const timeline = rows
      .map(parseEntitySnapshotRow)
      .filter((s): s is AiEntitySnapshot => s !== null);

    const report = buildEntityRegressionReport(provider.moduleId, scopeId, timeline, {
      baseline: options.baseline,
    });
    reportCache.set(cacheKey(provider.moduleId, scopeId), report);

    logger.info(
      "entityRegression",
      isNew ? "实体榜单出现新的时间点" : "实体榜单未变化，延长当前时间点",
      {
        moduleId: provider.moduleId,
        scopeId,
        points: report.points,
        verdict: report.verdict,
        worsened: report.worsened,
      },
    );
    return report;
  } catch (err) {
    logger.warn("entityRegression", "实体榜单记录失败，本次不影响主流程", {
      moduleId: provider.moduleId,
      scopeId,
      error: err,
    });
    return null;
  }
}

/**
 * 只加载不写入：UI 打开面板时用。
 * 渲染一个面板不该往回归序列上打点，否则用户每开一次页面就留一个伪造观测。
 */
export async function loadEntityRegression(
  moduleId: string,
  scopeId: string,
  options: EntityCompareOptions & { limit?: number } = {},
): Promise<AiEntityRegressionReport | null> {
  try {
    const rows = await aiContextApi.listEntitySnapshots(moduleId, scopeId, options.limit ?? DEFAULT_LIMIT);
    const timeline = rows
      .map(parseEntitySnapshotRow)
      .filter((s): s is AiEntitySnapshot => s !== null);
    if (timeline.length === 0) return null;
    const report = buildEntityRegressionReport(moduleId, scopeId, timeline, options);
    reportCache.set(cacheKey(moduleId, scopeId), report);
    return report;
  } catch (err) {
    logger.warn("entityRegression", "回归报告加载失败", { moduleId, scopeId, error: err });
    return null;
  }
}
