/**
 * regressionFocus —— 把「哪个文件刚变坏」接进注意力分配（模块无关）。
 *
 * 它补的是什么
 * ------------
 * 派单台账此前只认三种理由：从没看过（never）、看过但那轮没跑成（failed）、
 * 看过但结论依据的代码变了（recheck）。三者的共同点是——**全都不看变化本身**。
 * 静态共振榜回答的永远是「现在谁最糟」，于是一个长期糟糕、谁也不敢动的巨型文件
 * 会稳定占据榜首，而昨天刚被一次改动从「复杂度 20」推到「复杂度 38」的文件，
 * 因为绝对值还排在二十名开外，一次都不会被点名。
 *
 * 可后者才是最划算的一问：
 *   · 改动是谁引入的还查得到（git 记录就在手边），作者也还记得当时在想什么；
 *   · 劣化幅度是客观量，不依赖模型的主观判断，问题描述天然精确；
 *   · 拖过一两轮，这次劣化就会滚进基线成为「一直如此」，从此再没有任何视图看得见它。
 *
 * 最后一条是本档与其它几档最本质的区别：**回归信号会过期**。
 * never / recheck 漏一轮还在原地等着，回归漏一轮就永久消失了。
 *
 * 销账口径：与复核同构，但必须另起一本账
 * --------------------------------------
 * 「派单即销账」这条总口径不变，问题在于**销的是哪一笔**。
 *   · 用 contextDigest 销 → 改个 README 就让整包指纹翻新，同一次回归被反复点名；
 *   · 用 evidenceDigest 销 → 那是复核的账，一个文件完全可能同时欠复核和欠追责，
 *     共用一列会让两笔账互相冲销（其中一笔永远销不掉，或永远销得掉）。
 * 所以记的是**这次回归本身**的指纹：哪几维、从多少到多少。别的文件怎么变都与它无关；
 * 而本文件继续变坏（68 → 95）就是一次新的回归，理应重新排队。
 *
 * 本文件只认协议里的 AiEntityRegressionReport，不含任何扫描知识：
 * 任何实现了 collectEntitySnapshot 的模块都自动获得同一套回归追责能力。
 */
import type { AiEntityDelta, AiEntityRegressionReport } from "./contextTypes";

/**
 * 榜外劣化文件的注入上限。
 *
 * 焦点目标集是共振榜 Top-15，而实体榜单收 Top-25 —— 中间这段恰恰最需要回归视角：
 * 一个排第 20 名的文件突然劣化 60%，在任何静态明细里都不显眼，只有对比才看得见。
 * 所以允许它们越过目标集直接进队列，但要封顶：一次大重构可能让十几个文件同时变坏，
 * 全部注入会把 never 档挤到几轮之后，而 never 档不会过期、回归档会——
 * 优先让位是对的，无限让位不是。
 */
export const REGRESSION_INJECT_LIMIT = 5;

/** 单个文件的回归信号 */
export interface FileRegressionSignal {
  filePath: string;
  /**
   * 本次回归的指纹（销账依据）：只由「这个文件在哪几维从多少变到多少」决定。
   * 榜单因别的文件重算不会让它变；本文件继续变坏一定会让它变。
   */
  digest: string;
  /** 点名理由，直接拼进派单说明 */
  note: string;
  /** 主因维度的人读名字（面板上单独标一下「主要是哪一维在恶化」） */
  driverLabel?: string;
  /**
   * 排序权重：主因维度的相对劣化幅度（%），跌了 60% 排在跌了 12% 前面。
   *
   * 刻意不用综合分变化量：综合分是分位加权，别的文件动了它就会动，
   * 拿它排序等于让「同批文件的相对位移」决定先看谁。
   */
  weight: number;
  /** 该文件当前的共振维度数与综合分（注入榜外目标时用，避免再查一次榜） */
  resonance: number;
  score: number;
}

export interface RegressionFeedback {
  /**
   * 回归观测是否可用。
   *
   * 不可用（还没有第二个时间点、报告读取失败、模块没实现实体切面）时整条链路静默关闭，
   * 判定结果与本特性上线前**逐字节一致**——观测手段的缺失不该改变既有行为。
   */
  available: boolean;
  byFile: Map<string, FileRegressionSignal>;
}

export function emptyRegressionFeedback(available = false): RegressionFeedback {
  return { available, byFile: new Map() };
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

function num(v: number | null | undefined): string {
  return v === null || v === undefined ? "~" : String(Math.round(v * 10000) / 10000);
}

/**
 * 一次回归的指纹。
 *
 * 只收**恶化**的那几维（按 key 排序，与顺序无关）。改善维度不进指纹是刻意的：
 * 一个文件「复杂度继续涨、同时顺手删了几行重复」时，若把改善也算进去，
 * 指纹会因为无关的好消息而翻新，同一笔恶化被重新点名一次。
 */
export function regressionDigestOf(delta: AiEntityDelta): string {
  const worse = delta.dims
    .filter((d) => d.direction === "worsened")
    .map((d) => `${d.key}:${num(d.from)}>${num(d.to)}`)
    .sort()
    .join("|");
  return fnv1a(`${delta.id}#${worse}`);
}

/** 点名理由：主因维度写清「从多少到多少、涨了百分之几」，其余维度只报个数 */
function describeRegression(delta: AiEntityDelta): { note: string; driverLabel?: string; weight: number } {
  const worse = delta.dims.filter((d) => d.direction === "worsened");
  if (worse.length === 0) {
    // 理论上 worsened 必有恶化维度；真出现就退回一句不撒谎的话，别编造数字
    return { note: "本轮相对上一次扫描变坏", weight: 0 };
  }
  const pctOf = (d: (typeof worse)[number]): number => {
    const from = d.from ?? 0;
    const to = d.to ?? 0;
    if (from === 0) return to === 0 ? 0 : 999;
    return Math.abs(((to - from) / Math.abs(from)) * 100);
  };
  const driver =
    worse.find((d) => d.key === delta.driver) ??
    [...worse].sort((a, b) => pctOf(b) - pctOf(a))[0];
  const pct = Math.round(pctOf(driver));
  const arrow = `${num(driver.from)} → ${num(driver.to)}${driver.unit || ""}`;
  const rest = worse.length > 1 ? `，另有 ${worse.length - 1} 维同时恶化` : "";
  return {
    note: `本轮变坏：${driver.label} ${arrow}${pct >= 999 ? "（从无到有）" : `（+${pct}%）`}${rest}`,
    driverLabel: driver.label,
    weight: pct,
  };
}

/**
 * 回归报告 → 按文件的注意力信号。
 *
 * 只收 worsened。**appeared 刻意不收**：新文件本来就落在 never 档里排队，
 * 把它算成「变坏」会让每次新增功能都刷一屏假警报——与 entityRegression 铁律①同源。
 * removed / improved 更不必说，它们不需要任何人再去看一眼。
 */
export function buildRegressionFeedback(
  report: AiEntityRegressionReport | null | undefined,
): RegressionFeedback {
  // 只有一个时间点时 baseline 为 null：这不是「没有变坏的文件」，而是「还没得比」。
  // 判 available=false，让整条链路退回上线前的行为。
  if (!report || !report.baseline) return emptyRegressionFeedback(false);

  const byFile = new Map<string, FileRegressionSignal>();
  for (const d of report.entities) {
    if (d.change !== "worsened") continue;
    const { note, driverLabel, weight } = describeRegression(d);
    byFile.set(d.id, {
      filePath: d.id,
      digest: regressionDigestOf(d),
      note,
      driverLabel,
      weight,
      resonance: d.resonanceTo ?? 0,
      score: d.scoreTo ?? 0,
    });
  }
  return { available: true, byFile };
}

/**
 * 这个文件还欠一次回归追责吗。
 *
 * 空串（历史行 / 从未记过账）一律判「欠」：宁可多看一次，也好过让一次真实劣化
 * 因为账本上线前的空白而永远无人过问。
 */
export function needsRegressionPatrol(
  signal: FileRegressionSignal | undefined,
  recordedDigest: string | undefined,
): boolean {
  if (!signal) return false;
  return (recordedDigest ?? "") !== signal.digest;
}
