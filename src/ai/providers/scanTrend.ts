/**
 * 扫描指标 → 时间轴（模块侧实现）。
 *
 * 分工
 * ----
 * 本文件只回答三个**扫描才知道**的问题：该测哪些数、现在各是多少、这次哪些维度没看到。
 * 指纹、去重、加载历史、可比性判定、方向判定、结论全在模块无关的 `metricTrend` 里。
 *
 * 为什么不把「多维共振文件数」这种复合指标放进来
 * ----------------------------------------------
 * 它是最抓人的一个数字（「你有 12 个雷区」），但它的口径会随可用维度**静默漂移**：
 * 这次 Git 没跑，参与交叉的维度从 8 个变成 7 个，共振阈值同样是 2 维，
 * 算出来的雷区自然变少——于是趋势会报「雷区减少 40%」，而实际上一个都没修。
 * 一个指标只要它的分母会悄悄变，就不该进时间轴。这与整层「盲区不参与对比」是同一条原则，
 * 只是这次的正确做法是**根本不收**，而不是收了再标不可比。
 */
import type { AiContextSection, AiMetric, AiMetricSnapshot } from "../contextTypes";
import { readTrendReport } from "../metricTrend";
import type { AiTrendReport } from "../contextTypes";
import { makeSection, mdTable, type ScanSnapshot } from "./scanSections";
import { buildStageCoverage } from "./scanCoverage";
import { t } from "../../i18n";
import { H, L } from "../aiLang";

/** 高复杂度判定档位（与后端 complexity_level 口径一致） */
const HOT_COMPLEXITY = new Set(["high", "extreme"]);
/** 高危变更耦合档位 */
const HOT_RISK = new Set(["high", "extreme"]);
/** 视为「严重」的审查等级 */
const CRITICAL_SEVERITY = new Set(["error", "critical", "blocker"]);

function round(v: number, digits = 2): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * 提取本次扫描的指标切面。
 *
 * 每个指标都必须回答两个问题，否则不许进这张表：
 *   · 它依赖哪个阶段（dimension）—— 阶段是盲区时这一项自动不可比；
 *   · 它该不该按规模归一（basis）—— 「总数类」不归一就会把项目长大读成质量恶化。
 */
export function collectScanMetrics(s: ScanSnapshot, scopeId: string): AiMetricSnapshot {
  const codeFiles = s.files.filter((f) => !f.isDirectory);
  const fileCount = codeFiles.length;
  const codeLines = s.metrics.reduce((sum, m) => sum + (m.codeLines || 0), 0);
  const commentLines = s.metrics.reduce((sum, m) => sum + (m.commentLines || 0), 0);

  const cc = s.metrics.map((m) => m.cyclomaticComplexity || 0);
  const avgCc = cc.length ? cc.reduce((a, b) => a + b, 0) / cc.length : 0;
  const maxCc = cc.length ? Math.max(...cc) : 0;
  const hotFiles = s.metrics.filter((m) => HOT_COMPLEXITY.has((m.complexityLevel || "").toLowerCase())).length;

  const critical = s.findings.filter((f) => CRITICAL_SEVERITY.has((f.severity || "").toLowerCase())).length;
  // 重复按**行数**计量：重复"条数"会被大量 3 行小片段稀释，
  // 而真正值得抽取的是那几段几十行的复制粘贴。
  const cloneLines = s.clones.reduce((sum, c) => sum + (c.lineCount || 0), 0);
  const hiddenCoupling = s.changeCoupling.filter(
    (c) => c.couplingKind === "hidden" && HOT_RISK.has((c.riskLevel || "").toLowerCase()),
  ).length;
  const churnHotspots = s.gitChurn.filter((g) => HOT_RISK.has((g.hotspotLevel || "").toLowerCase())).length;

  // 密度基数为 0 时不给 basis：0 基数算出来的密度是 Infinity，
  // 那会让一次空扫描把所有指标都判成灾难性恶化。
  const lineBasis = codeLines > 0 ? codeLines : undefined;
  const fileBasis = fileCount > 0 ? fileCount : undefined;

  const metrics: AiMetric[] = [
    {
      key: "files",
      label: t("trend.metric.files"),
      value: fileCount,
      unit: t("trend.metric.unit.files"),
      better: "neutral",
    },
    {
      key: "codeLines",
      label: t("trend.metric.codeLines"),
      value: codeLines,
      unit: t("trend.metric.unit.codeLines"),
      better: "neutral",
      dimension: "metrics",
    },
    {
      key: "avgComplexity",
      label: t("trend.metric.avgComplexity"),
      value: round(avgCc),
      unit: "",
      better: "lower",
      dimension: "metrics",
    },
    {
      key: "maxComplexity",
      label: t("trend.metric.maxComplexity"),
      value: maxCc,
      unit: "",
      better: "lower",
      dimension: "metrics",
    },
    {
      key: "highComplexityFiles",
      label: t("trend.metric.highComplexityFiles"),
      value: hotFiles,
      unit: t("trend.metric.unit.files"),
      better: "lower",
      dimension: "metrics",
      basis: fileBasis,
      basisUnit: t("trend.metric.basis.perKFiles"),
    },
    {
      key: "commentRatio",
      label: t("trend.metric.commentRatio"),
      value: codeLines + commentLines > 0 ? round((commentLines / (codeLines + commentLines)) * 100) : 0,
      unit: "%",
      better: "higher",
      dimension: "metrics",
    },
    {
      key: "findings",
      label: t("trend.metric.findings"),
      value: s.findings.length,
      unit: t("trend.metric.unit.findings"),
      better: "lower",
      dimension: "review",
      basis: lineBasis,
      basisUnit: t("trend.metric.basis.perKLine"),
    },
    {
      key: "criticalFindings",
      label: t("trend.metric.criticalFindings"),
      value: critical,
      unit: t("trend.metric.unit.findings"),
      better: "lower",
      dimension: "review",
      basis: lineBasis,
      basisUnit: t("trend.metric.basis.perKLine"),
    },
    {
      key: "techDebt",
      label: t("trend.metric.techDebt"),
      value: s.techDebt.length,
      unit: t("trend.metric.unit.techDebt"),
      better: "lower",
      dimension: "techDebt",
      basis: lineBasis,
      basisUnit: t("trend.metric.basis.perKLine"),
    },
    {
      key: "cloneLines",
      label: t("trend.metric.cloneLines"),
      value: cloneLines,
      unit: t("trend.metric.unit.codeLines"),
      better: "lower",
      dimension: "clones",
      basis: lineBasis,
      basisUnit: t("trend.metric.basis.perKLine"),
    },
    {
      key: "deadSymbols",
      label: t("trend.metric.deadSymbols"),
      value: s.deadSymbols.length,
      unit: t("trend.metric.unit.deadSymbols"),
      better: "lower",
      dimension: "deadCode",
      basis: lineBasis,
      basisUnit: t("trend.metric.basis.perKLine"),
    },
    {
      key: "hiddenCoupling",
      label: t("trend.metric.hiddenCoupling"),
      value: hiddenCoupling,
      unit: t("trend.metric.unit.hiddenCoupling"),
      better: "lower",
      dimension: "changeCoupling",
      basis: fileBasis,
      basisUnit: t("trend.metric.basis.perKFiles"),
    },
    {
      // 变更热点判「中性」是刻意的：文件改得勤既可能是烂摊子，也可能只是正在交付的主战场。
      // 把它标成「越少越好」，等于鼓励团队少写代码——那是最荒谬的一种指标误导。
      key: "churnHotspots",
      label: t("trend.metric.churnHotspots"),
      value: churnHotspots,
      unit: t("trend.metric.unit.files"),
      better: "neutral",
      dimension: "git",
    },
  ];

  // 可用性直接复用覆盖度体检：与 coverage 分节、riskMatrix 盲区判定同一个口径。
  // 单独再写一份判定是这层最容易埋雷的地方——两处口径一旦漂移，
  // 趋势会说「维度可用」而覆盖度说「盲区」，用户不知道该信哪个。
  const coverage = buildStageCoverage(s).map((st) => ({
    key: st.key,
    available: st.quality.status !== "unavailable",
    reason: st.quality.status === "unavailable" ? st.quality.reason : undefined,
  }));

  return {
    moduleId: "project-scan",
    scopeId,
    digest: "",
    takenAt: 0,
    metrics,
    coverage,
  };
}

const VERDICT_LABEL_KEY: Record<AiTrendReport["verdict"], string> = {
  improving: "trend.verdict.improving",
  regressing: "trend.verdict.regressing",
  mixed: "trend.verdict.mixed",
  flat: "trend.verdict.flat",
  insufficient: "trend.verdict.insufficient",
};

const DIRECTION_LABEL_KEY: Record<string, string> = {
  improved: "trend.direction.improved",
  worsened: "trend.direction.worsened",
  flat: "trend.direction.flat",
  moved: "trend.direction.moved",
  incomparable: "trend.direction.incomparable",
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 趋势分节。
 *
 * 它回答的是别的分节都答不了的那个问题：**这些数是在变好还是变坏**。
 * 没有它，Agent 拿到「技术债 87 处」只能写出「存在技术债」——
 * 一句放在任何项目上都成立、因而毫无价值的结论。
 */
export function buildTrendSection(s: ScanSnapshot, scopeId: string): AiContextSection {
  const report = readTrendReport("project-scan", scopeId);
  const current = collectScanMetrics(s, scopeId);

  if (!report || report.verdict === "insufficient" || !report.baseline) {
    const rows = current.metrics.map((m) => [m.label, `${m.value}${m.unit}`]);
    const section = makeSection(
      "trend",
      L("指标趋势（对比历史基线）", "Metric Trends (vs. historical baseline)"),
      1,
      L(
        "首次建立基线：本次数值已入库，下次扫描起即可给出变化",
        "First-time baseline: this round's values are stored; changes can be reported from the next scan on",
      ),
      [
        L(
          "本项目**尚无可比的历史基线**——这是第一次记录指标切面，或历史被清空过。",
          "This project has **no comparable historical baseline yet** — this is the first metric snapshot, or the history was cleared.",
        ),
        L(
          "下方是本次入库的基线数值；下一次扫描起，本节会给出每一项的变化方向与幅度。",
          "Below are the baseline values stored this time; from the next scan on, this section reports each item's direction and magnitude of change.",
        ),
        "",
        ...mdTable(H(["指标", "当前值"], ["Metric", "Current"]), rows),
        "",
        L(
          "> 请勿把「无历史」当成「无变化」：现在还没有任何关于走势的结论可下。",
          "> Do not treat \"no history\" as \"no change\": there is not yet any conclusion about trends to draw.",
        ),
      ],
      { verdict: "insufficient", points: report?.points ?? 0, metrics: current.metrics },
    );
    // 「还没有历史」是 unavailable 而不是 empty：empty 意味着「查了，确实没有」，
    // 会让 Agent 得出「这段时间没有变化」——而真相是这段时间根本没被观测过。
    return {
      ...section,
      dataQuality: {
        status: "unavailable",
        observed: 0,
        reason: L("尚未积累第二个时间点，无法给出任何走势结论", "Not enough time points (need a second one); no trend conclusions can be given"),
        caveat: L("不要据此断言「指标稳定 / 没有恶化」——这是没有历史，不是没有变化", "Do not assert \"metrics are stable / not worsening\" — this is no history, not no change"),
      },
    };
  }

  const rows = report.deltas.map((d) => {
    const arrow = d.direction === "incomparable" ? "—" : d.delta > 0 ? "↑" : d.delta < 0 ? "↓" : "=";
    const change =
      d.direction === "incomparable"
        ? L("不可比", "incomparable")
        : `${arrow} ${Math.abs(d.delta)}${d.pct !== null ? `（${d.pct > 0 ? "+" : ""}${d.pct}%）` : ""}`;
    const densityCol =
      d.fromDensity !== undefined && d.toDensity !== undefined
        ? `${d.fromDensity} → ${d.toDensity}（${d.basisUnit ?? ""}）`
        : "-";
    return [
      d.label,
      `${d.from}${d.unit}`,
      `${d.to}${d.unit}`,
      change,
      densityCol,
      t(DIRECTION_LABEL_KEY[d.direction] ?? d.direction),
      d.reason ?? "",
    ];
  });

  const blind = report.deltas.filter((d) => d.direction === "incomparable");

  const lines = [
    L(
      `基线 **${fmtTime(report.baseline.takenAt)}** → 当前 **${fmtTime(report.current!.takenAt)}**` +
        `（间隔 ${report.spanDays >= 1 ? `${report.spanDays} 天` : `${Math.max(1, Math.round(report.spanDays * 1440))} 分钟`}，` +
        `库内共 ${report.points} 个时间点）。`,
      `Baseline **${fmtTime(report.baseline.takenAt)}** → current **${fmtTime(report.current!.takenAt)}**` +
        ` (interval ${report.spanDays >= 1 ? `${report.spanDays} days` : `${Math.max(1, Math.round(report.spanDays * 1440))} minutes`}, ` +
        `${report.points} time points stored).`,
    ),
    L(
      `**总体判定：${t(VERDICT_LABEL_KEY[report.verdict])}** —— 改善 ${report.improved} 项 · 恶化 ${report.worsened} 项 · ` +
        `持平 ${report.flat} 项 · 不可比 ${report.incomparable} 项。`,
      `**Overall verdict: ${t(VERDICT_LABEL_KEY[report.verdict])}** — improved ${report.improved} · worsened ${report.worsened} · ` +
        `flat ${report.flat} · incomparable ${report.incomparable}.`,
    ),
    "",
    L("**逐项变化**", "**Per-metric changes**"),
    ...mdTable(
      H(
        ["指标", "基线", "当前", "变化", "密度（基线→当前）", "判定", "备注"],
        ["Metric", "Baseline", "Current", "Change", "Density (baseline→current)", "Verdict", "Note"],
      ),
      rows,
    ),
    "",
    blind.length
      ? L(
          "**以下项不可比，不得当作「没有变化」：**\n" +
            blind.map((d) => `- **${d.label}**：${d.reason ?? "端点维度不可用"}`).join("\n"),
          "**The following items are incomparable — do not treat them as \"no change\":**\n" +
            blind.map((d) => `- **${d.label}**: ${d.reason ?? "dimension unavailable at one endpoint"}`).join("\n"),
        )
      : L("**所有指标均可比。**", "**All metrics are comparable.**"),
    "",
    L(
      "> 判读规则：带密度列的指标以**密度**判方向（项目长大导致的总量自然增长不算恶化）；",
      "> How to read: metrics with a density column are judged by **density** (natural growth from a larger project is not worsening);",
    ),
    L(
      "> 「不可比」= 基线或本次该维度是盲区，数值归零是「没看」而不是「变好」；",
      "> \"Incomparable\" = the dimension was a blind spot in the baseline or this round; a zero value is \"not measured\", not \"improved\";",
    ),
    L(
      "> 总体判定只采纳变化幅度 ≥2% 或从 0 变为非 0 的项，避免单条抖动翻盘，但逐项表如实列出全部变化。",
      "> The overall verdict only counts items with a change ≥2% or from 0 to non-zero, to avoid single-item jitter flipping the result; the per-item table still lists every change faithfully.",
    ),
  ];

  const comparable = report.deltas.length - blind.length;
  const section = makeSection(
    "trend",
    L("指标趋势（对比历史基线）", "Metric Trends (vs. historical baseline)"),
    1,
    L(
      `${t(VERDICT_LABEL_KEY[report.verdict])}：改善 ${report.improved} · 恶化 ${report.worsened} · 不可比 ${report.incomparable}（跨 ${report.spanDays} 天）`,
      `${t(VERDICT_LABEL_KEY[report.verdict])}: improved ${report.improved} · worsened ${report.worsened} · incomparable ${report.incomparable} (over ${report.spanDays} days)`,
    ),
    lines,
    {
      verdict: report.verdict,
      points: report.points,
      spanDays: report.spanDays,
      baselineAt: report.baseline.takenAt,
      currentAt: report.current!.takenAt,
      improved: report.improved,
      worsened: report.worsened,
      incomparable: report.incomparable,
      deltas: report.deltas.map((d) => ({
        key: d.key,
        from: d.from,
        to: d.to,
        delta: d.delta,
        pct: d.pct,
        direction: d.direction,
      })),
    },
  );

  return {
    ...section,
    dataQuality: {
      status: comparable === 0 ? "unavailable" : blind.length > 0 ? "partial" : "ok",
      observed: report.points,
      covered: comparable,
      expected: report.deltas.length,
      reason:
        blind.length > 0
          ? L(`${blind.length} 项因端点维度盲区不可比：${blind.map((d) => d.label).join("、")}`, `${blind.length} item(s) incomparable due to endpoint blind spots: ${blind.map((d) => d.label).join(", ")}`)
          : undefined,
      caveat: blind.length > 0 ? L("不可比项的数值变化不得解读为改善或恶化", "Numerical changes of incomparable items must not be read as improvement or worsening") : undefined,
    },
  };
}
