/**
 * metricTrend —— 指标时间轴的**唯一**记录与对比入口（模块无关）。
 *
 * 它补上的窟窿
 * ------------
 * 扫描的全部产出都在描述「此刻」，而重扫会覆盖同一批行。于是：
 *   · 人重构了一周，问「到底有没有变好」——没有昨天的数，答不出来；
 *   · Agent 看到「技术债 87 条」，不知道是从 120 降下来还是从 40 涨上去，
 *     只能写出「存在技术债」这种放在任何项目上都成立的废话；
 *   · 而且**不可追补**：没记下来的历史，事后再想要只能重新等它长出来。
 *
 * 职责边界（为什么对比逻辑在这里而不在模块里）
 * --------------------------------------------
 *   模块侧 collectMetrics()  → 只回答「该测什么 / 现在多少 / 哪些维度这次没看到」（模块知识）
 *   本文件                   → 指纹、去重、加载历史、可比性判定、方向判定、结论（通用逻辑）
 *   后端                     → 只存取 JSON，零解析（否则每接一个模块都要改 Rust）
 * 未来画布、报告等模块实现 collectMetrics 即可白拿整条趋势链路。
 *
 * 三个不能让步的判定口径
 * ----------------------
 * ① **盲区不参与对比。** 上次跑了 Git、这次不在 Git 仓库里，churn 从 300 掉到 0——
 *    那不是变好，是这次没看。任一端点维度不可用一律判 incomparable。
 * ② **总量看密度。** 项目长大本身会推高所有「总数类」指标，
 *    只看总量会把正常交付误报成质量恶化。带 basis 的指标一律按密度判方向。
 * ③ **单点如实说「还没有历史」。** 第一次扫描本来就没有昨天，
 *    verdict = insufficient 是诚实结论，不是失败，更不能默认成「flat（没变化）」。
 */
import type {
  AiContextProvider,
  AiMetric,
  AiMetricDelta,
  AiMetricSnapshot,
  AiTrendDirection,
  AiTrendReport,
} from "./contextTypes";
import { L } from "./aiLang";
import { aiContextApi, type AiMetricSnapshotDto } from "../services/tauri";
import { logger } from "../utils/logger";

/**
 * 参与 verdict 判定的最小相对变化（%）。
 *
 * deltas 里每一条都如实列出，一条不漏；但「整体在变好还是变坏」这个总判定
 * 不该被 300 条技术债里的 1 条抖动翻盘——否则用户每次重扫都看到结论在
 * improving / regressing 之间乱跳，这个指标就没人信了。
 * 从 0 变成非 0（pct 为 null）永远算材料性变化：0 → 5 个循环依赖是真事件。
 */
const MATERIAL_PCT = 2;

/** 密度归一的基准：每千个基数单位 */
const DENSITY_SCALE = 1000;

/** 指纹里保留的小数位：避免浮点尾数抖动凭空造出一个新的时间点 */
const FINGERPRINT_PRECISION = 4;

const trendCache = new Map<string, AiTrendReport>();

function cacheKey(moduleId: string, scopeId: string): string {
  return `${scopeId}:${moduleId}`;
}

/** 测试与切换项目时清空，避免跨用例/跨项目串味 */
export function resetMetricTrendCache(moduleId?: string, scopeId?: string): void {
  if (moduleId && scopeId) {
    trendCache.delete(cacheKey(moduleId, scopeId));
    return;
  }
  trendCache.clear();
}

/**
 * 最近一次算出的趋势报告（同步读）。
 *
 * buildPack 是同步的，而历史要查库（异步）。所以链路必须是
 * 「先 await captureMetricSnapshot 刷新缓存 → 再 buildPack 同步读」，
 * 顺序反了 trend 分节就会永远比实际落后一轮。
 */
export function readTrendReport(moduleId: string, scopeId: string): AiTrendReport | null {
  return trendCache.get(cacheKey(moduleId, scopeId)) ?? null;
}

/** FNV-1a 32bit：与项目其余指纹算法同源，稳定、无依赖 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 指标向量指纹：同一组数值必同指纹。
 *
 * 覆盖面也必须进指纹——否则「这次 Git 没跑」与「这次 Git 跑了但 churn 恰好一样」
 * 会被算成同一个点，时间轴上就再也看不出中间断过一次采。
 */
export function fingerprintMetrics(
  metrics: AiMetric[],
  coverage: AiMetricSnapshot["coverage"],
): string {
  const m = [...metrics]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((x) => `${x.key}=${round(x.value, FINGERPRINT_PRECISION)}`)
    .join("|");
  const c = [...coverage]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((x) => `${x.key}:${x.available ? 1 : 0}`)
    .join("|");
  return fnv1a(`${m}#${c}`);
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 库内一行 → 协议形态；JSON 损坏时返回 null（宁可少一个点，也不让整条趋势崩掉） */
export function parseSnapshotRow(dto: AiMetricSnapshotDto): AiMetricSnapshot | null {
  try {
    const metrics = JSON.parse(dto.metricsJson) as AiMetric[];
    if (!Array.isArray(metrics)) return null;
    const coverage = dto.coverageJson
      ? (JSON.parse(dto.coverageJson) as AiMetricSnapshot["coverage"])
      : [];
    return {
      moduleId: dto.moduleId,
      scopeId: dto.scopeId,
      digest: dto.digest,
      triggerKind: dto.triggerKind || undefined,
      takenAt: dto.firstAt * 1000,
      lastAt: dto.lastAt * 1000,
      seenCount: dto.seenCount,
      metrics,
      coverage: Array.isArray(coverage) ? coverage : [],
    };
  } catch {
    return null;
  }
}

function coverageOf(snapshot: AiMetricSnapshot, dimension?: string) {
  if (!dimension) return { available: true, reason: undefined as string | undefined };
  const hit = snapshot.coverage.find((c) => c.key === dimension);
  // 快照里压根没登记这个维度：按不可用处理。
  // 「没登记」与「登记为可用」不能等同——前者说明那次采集根本不知道有这个维度。
  if (!hit) return { available: false, reason: L("该次快照未登记此维度的可用性", "This snapshot did not record this dimension's availability") };
  return { available: hit.available, reason: hit.reason };
}

function density(value: number, basis?: number): number | undefined {
  if (basis === undefined || !Number.isFinite(basis) || basis <= 0) return undefined;
  return round((value * DENSITY_SCALE) / basis, FINGERPRINT_PRECISION);
}

function judge(better: AiMetric["better"], delta: number): AiTrendDirection {
  if (delta === 0) return "flat";
  if (better === "neutral") return "moved";
  if (better === "lower") return delta < 0 ? "improved" : "worsened";
  return delta > 0 ? "improved" : "worsened";
}

/** 单个指标的跨点对比 */
function compareMetric(
  current: AiMetric,
  baseline: AiMetric | undefined,
  currentSnap: AiMetricSnapshot,
  baselineSnap: AiMetricSnapshot,
): AiMetricDelta {
  const base: AiMetricDelta = {
    key: current.key,
    label: current.label,
    unit: current.unit,
    better: current.better,
    from: baseline?.value ?? 0,
    to: current.value,
    delta: 0,
    pct: null,
    direction: "incomparable",
  };

  if (!baseline) {
    // 新指标（能力是后来才加的）。判成 flat 会让用户以为「一直是这个数」，
    // 判成 improved/worsened 更是凭空造结论——只能说不可比。
    return { ...base, from: current.value, reason: L("基线中没有这个指标（该能力是后来才有的）", "This metric is absent from the baseline (the capability was added later)") };
  }

  const curCov = coverageOf(currentSnap, current.dimension);
  const baseCov = coverageOf(baselineSnap, baseline.dimension ?? current.dimension);
  if (!curCov.available || !baseCov.available) {
    const which = !curCov.available && !baseCov.available ? L("两端", "both sides") : !curCov.available ? L("本次", "this round") : L("基线", "baseline");
    const why = (!curCov.available ? curCov.reason : baseCov.reason) ?? L("该维度未运行", "this dimension did not run");
    return {
      ...base,
      reason: L(`${which}该维度不可用（${why}）：数值归零是没看，不是变好`, `${which} dimension unavailable (${why}): a zero value is "not measured", not "improved"`),
    };
  }

  const delta = round(current.value - baseline.value, FINGERPRINT_PRECISION);
  const pct = baseline.value === 0 ? null : round((delta / Math.abs(baseline.value)) * 100, 2);

  const fromDensity = density(baseline.value, baseline.basis);
  const toDensity = density(current.value, current.basis);
  const usableDensity = fromDensity !== undefined && toDensity !== undefined;
  const densityDelta = usableDensity ? round(toDensity - fromDensity, FINGERPRINT_PRECISION) : undefined;

  // 带 basis 的指标按**密度**判方向：项目长大导致的自然增长不算恶化，这是归一化存在的全部意义。
  const judged = judge(current.better, usableDensity ? (densityDelta as number) : delta);

  return {
    ...base,
    delta,
    pct,
    direction: judged,
    fromDensity,
    toDensity,
    densityDelta,
    basisUnit: usableDensity ? current.basisUnit : undefined,
  };
}

export interface TrendCompareOptions {
  /** 基线选谁：上一个点（默认，回答「这次改动带来了什么」）或最早的点（回答「这一阶段整体如何」） */
  baseline?: "previous" | "oldest";
}

/** 材料性：够不够格影响总判定 */
function isMaterial(d: AiMetricDelta): boolean {
  if (d.direction !== "improved" && d.direction !== "worsened") return false;
  if (d.pct === null) return true; // 0 → 非 0，是真事件
  return Math.abs(d.pct) >= MATERIAL_PCT;
}

/**
 * 由时间轴（**由新到旧**）算出趋势报告。纯函数，便于直接测。
 */
export function buildTrendReport(
  moduleId: string,
  scopeId: string,
  snapshots: AiMetricSnapshot[],
  options: TrendCompareOptions = {},
): AiTrendReport {
  const empty: AiTrendReport = {
    moduleId,
    scopeId,
    baseline: null,
    current: null,
    points: snapshots.length,
    spanDays: 0,
    improved: 0,
    worsened: 0,
    flat: 0,
    incomparable: 0,
    deltas: [],
    verdict: "insufficient",
    note: L("还没有可比的历史基线：这是第一次记录，下次扫描起就能给出变化。", "No comparable historical baseline yet: first recording; changes can be reported from the next scan on."),
  };
  if (snapshots.length === 0) {
    return { ...empty, note: L("尚未记录任何指标快照。", "No metric snapshots recorded yet.") };
  }

  const current = snapshots[0];
  if (snapshots.length === 1) {
    return {
      ...empty,
      current: { takenAt: current.takenAt, digest: current.digest, triggerKind: current.triggerKind },
    };
  }

  const baseline = options.baseline === "oldest" ? snapshots[snapshots.length - 1] : snapshots[1];
  const baseMap = new Map(baseline.metrics.map((m) => [m.key, m]));

  const deltas = current.metrics.map((m) => compareMetric(m, baseMap.get(m.key), current, baseline));

  const improved = deltas.filter((d) => d.direction === "improved").length;
  const worsened = deltas.filter((d) => d.direction === "worsened").length;
  const flat = deltas.filter((d) => d.direction === "flat" || d.direction === "moved").length;
  const incomparable = deltas.filter((d) => d.direction === "incomparable").length;

  const materialUp = deltas.filter((d) => d.direction === "improved" && isMaterial(d)).length;
  const materialDown = deltas.filter((d) => d.direction === "worsened" && isMaterial(d)).length;

  let verdict: AiTrendReport["verdict"];
  if (materialUp === 0 && materialDown === 0) verdict = "flat";
  else if (materialDown === 0) verdict = "improving";
  else if (materialUp === 0) verdict = "regressing";
  else verdict = "mixed";

  const spanDays = round((current.takenAt - baseline.takenAt) / 86_400_000, 2);
  const spanText = spanDays >= 1 ? L(`${spanDays} 天`, `${spanDays} days`) : L(`${Math.max(1, Math.round(spanDays * 24 * 60))} 分钟`, `${Math.max(1, Math.round(spanDays * 24 * 60))} minutes`);

  const worst = deltas
    .filter((d) => d.direction === "worsened" && isMaterial(d))
    .sort((a, b) => Math.abs(b.pct ?? 999) - Math.abs(a.pct ?? 999))[0];
  const best = deltas
    .filter((d) => d.direction === "improved" && isMaterial(d))
    .sort((a, b) => Math.abs(b.pct ?? 999) - Math.abs(a.pct ?? 999))[0];

  const parts: string[] = [L(`较上一基线（间隔 ${spanText}）`, `vs. previous baseline (interval ${spanText})`)];
  if (verdict === "flat") parts.push(L("各项指标没有材料性变化", "No material change in any metric"));
  else {
    if (best) parts.push(L(`${best.label}改善 ${fmtPct(best)}`, `${best.label} improved ${fmtPct(best)}`));
    if (worst) parts.push(L(`${worst.label}恶化 ${fmtPct(worst)}`, `${worst.label} worsened ${fmtPct(worst)}`));
  }
  if (incomparable > 0) parts.push(L(`${incomparable} 项因维度盲区不可比（不得当作无变化）`, `${incomparable} item(s) incomparable due to dimension blind spots (must not be read as "no change")`));

  return {
    moduleId,
    scopeId,
    baseline: { takenAt: baseline.takenAt, digest: baseline.digest, triggerKind: baseline.triggerKind },
    current: { takenAt: current.takenAt, digest: current.digest, triggerKind: current.triggerKind },
    points: snapshots.length,
    spanDays,
    improved,
    worsened,
    flat,
    incomparable,
    deltas,
    verdict,
    note: `${parts.join("；")}。`,
  };
}

function fmtPct(d: AiMetricDelta): string {
  if (d.pct === null) return `${d.from} → ${d.to}${d.unit}`;
  return `${Math.abs(d.pct)}%（${d.from} → ${d.to}${d.unit}）`;
}

export interface CaptureOptions {
  /** 触发来源，如 full-scan / incremental */
  triggerKind?: string;
  /** 时间基准（ms），仅测试注入 */
  now?: number;
  /** 取多少个历史点参与对比 */
  limit?: number;
  baseline?: TrendCompareOptions["baseline"];
}

/**
 * 采集一次指标切面、记入时间轴、刷新趋势缓存。
 *
 * 失败一律**吞掉**并返回 null：趋势是增强能力，不能反过来打断扫描收尾。
 * 未实现 collectMetrics 的模块直接静默跳过，整条链路对它不存在。
 */
export async function captureMetricSnapshot(
  provider: AiContextProvider,
  scopeId: string,
  options: CaptureOptions = {},
): Promise<AiTrendReport | null> {
  if (!provider.collectMetrics) return null;

  try {
    const snapshot = provider.collectMetrics(scopeId);
    if (!snapshot || snapshot.metrics.length === 0) return null;

    const digest = snapshot.digest || fingerprintMetrics(snapshot.metrics, snapshot.coverage);
    const takenAt = options.now ?? Date.now();

    const [, isNew] = await aiContextApi.recordMetricSnapshot({
      moduleId: provider.moduleId,
      scopeId,
      digest,
      metricsJson: JSON.stringify(snapshot.metrics),
      coverageJson: JSON.stringify(snapshot.coverage),
      triggerKind: options.triggerKind,
      takenAt: Math.floor(takenAt / 1000),
    });

    const rows = await aiContextApi.listMetricSnapshots(
      provider.moduleId,
      scopeId,
      options.limit ?? 30,
    );
    const timeline = rows
      .map(parseSnapshotRow)
      .filter((s): s is AiMetricSnapshot => s !== null);

    const report = buildTrendReport(provider.moduleId, scopeId, timeline, {
      baseline: options.baseline,
    });
    trendCache.set(cacheKey(provider.moduleId, scopeId), report);

    logger.info("metricTrend", isNew ? "指标出现新的时间点" : "指标未变化，延长当前时间点", {
      moduleId: provider.moduleId,
      scopeId,
      points: report.points,
      verdict: report.verdict,
    });
    return report;
  } catch (err) {
    logger.warn("metricTrend", "指标快照记录失败，本次不影响主流程", {
      moduleId: provider.moduleId,
      scopeId,
      error: err,
    });
    return null;
  }
}

/**
 * 只加载不写入：UI 打开面板时用。
 *
 * 与 captureMetricSnapshot 分开的原因很实际——渲染一个面板不该往时间轴上打点，
 * 否则用户每开一次页面就在历史里留一个伪造的观测。
 */
export async function loadTrendReport(
  moduleId: string,
  scopeId: string,
  options: TrendCompareOptions & { limit?: number } = {},
): Promise<AiTrendReport | null> {
  try {
    const rows = await aiContextApi.listMetricSnapshots(moduleId, scopeId, options.limit ?? 30);
    const timeline = rows.map(parseSnapshotRow).filter((s): s is AiMetricSnapshot => s !== null);
    if (timeline.length === 0) return null;
    const report = buildTrendReport(moduleId, scopeId, timeline, options);
    trendCache.set(cacheKey(moduleId, scopeId), report);
    return report;
  } catch (err) {
    logger.warn("metricTrend", "趋势加载失败", { moduleId, scopeId, error: err });
    return null;
  }
}
