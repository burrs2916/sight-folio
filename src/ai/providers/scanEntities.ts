/**
 * 扫描实体榜单 → 文件级回归（模块侧实现）。
 *
 * 它补的是哪个洞
 * --------------
 * `trend` 已经能回答「项目整体在变好还是变坏」，但它给的是总量：技术债 87 → 94。
 * 拿着这句话，人和 Agent 都做不了任何事——**没有落点**。更糟的是总量会互相抵消：
 * 三个文件被清理干净、一个文件烂了三倍，加总起来风平浪静。
 *
 * 这里回答的是下一个问题：**具体是哪个文件在变坏**。做法是把 riskMatrix 的
 * 全量多维打分榜按时间存起来，逐文件比对上一张榜。
 *
 * 与 riskMatrix / trend 的分工
 * ----------------------------
 *   riskMatrix  —— 此刻谁最危险（截面 · 对象）
 *   trend       —— 整体在往哪走（走势 · 总量）
 *   regression  —— 这一轮谁被改坏了（走势 · 对象）  ← 本文件
 *
 * 三者共用同一次 `computeRiskCorrelation`，**绝不重新打分**：一旦这里另起一套口径，
 * 人看到的焦点榜、AI 看到的风险矩阵、回归里点名的文件就会是三份互相矛盾的名单。
 *
 * 本文件只负责「扫描才知道」的三件事：谁上榜、各维度原始值是多少、哪些维度这次没看到。
 * 指纹 / 去重 / 基线选取 / 可比性 / 方向判定 / 结论全在模块无关的 `entityRegression` 里。
 */
import type {
  AiContextSection,
  AiEntityChange,
  AiEntityDelta,
  AiEntityRecord,
  AiEntityRegressionReport,
  AiEntitySnapshot,
  AiMetricBetter,
} from "../contextTypes";
import { fingerprintEntities, readEntityRegression } from "../entityRegression";
import { computeRiskCorrelation, RISK_DIMENSIONS } from "./riskCorrelation";
import { buildStageCoverage } from "./scanCoverage";
import { cell, makeSection, mdTable, type ScanSnapshot } from "./scanSections";
import { t } from "../../i18n";
import { H, L } from "../aiLang";

/**
 * 榜单容量。
 *
 * 比各分节的 Top-15 明细更宽，是刻意的：榜单是**比对基准**，不是阅读材料。
 * 榜太窄会让边界附近的文件在两轮之间反复进出，制造一堆「新进榜 / 已跌出」的假变化，
 * 真正的恶化被噪音淹没。榜宽一点，边界抖动就落在榜内，变成一次诚实的名次变化。
 */
export const ENTITY_TOP_N = 25;

/** 分节里最多列多少条变化明细 */
const DETAIL_ROWS = 18;

/**
 * 各维度的「方向」与「抖动下限」——这是**模块知识**，不能硬编码进通用回归引擎。
 *
 * 方向为什么不是清一色的 lower
 * ----------------------------
 * 变更频率与被引用面上升，都**不等于**变坏：
 *   · 一个文件这个月被改了 20 次，可能是烂摊子，也可能它正是本季度的主战场；
 *   · 一个工具模块被更多地方引用，是复用在起作用，不是质量在下滑。
 * 把它们标成「越低越好」，等于向团队宣告「少写代码、少复用」才是优秀——
 * 那是最荒谬的一种指标误导（与 metricTrend 把 churnHotspots 判中性是同一条理由）。
 * 它们仍然进榜、进打分（高风险文件确实常常同时高变更、高扇入），
 * 只是**不参与「谁变坏了」的方向判定**。
 *
 * minDelta 为什么必须逐维给
 * -------------------------
 * 技术债 +1 条和圈复杂度 +1 完全不是一个量级的事件。统一阈值会同时制造漏报与噪声：
 * 阈值取小，解析器版本差异带来的 ±1 圈复杂度天天报警；阈值取大，新增的一处 FIXME 永远看不见。
 */
interface EntityDimPolicy {
  better: AiMetricBetter;
  minDelta: number;
}

const DIM_POLICY: Record<string, EntityDimPolicy> = {
  // 圈复杂度 ±1 多半来自解析口径而非真实改动，要 2 起步
  complexity: { better: "lower", minDelta: 2 },
  churn: { better: "neutral", minDelta: 3 },
  fanIn: { better: "neutral", minDelta: 3 },
  // 加权条：critical/error=3、warning=1、info=0.3，下限 1 = 至少动了一条 warning 级
  findings: { better: "lower", minDelta: 1 },
  // 重复按行数计，10 行是「值得抽一个函数」的最小体量
  clones: { better: "lower", minDelta: 10 },
  techDebt: { better: "lower", minDelta: 1 },
  coupling: { better: "lower", minDelta: 1 },
  deadCode: { better: "lower", minDelta: 1 },
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 采集此刻的文件风险榜。
 *
 * previousIds 由公共层从库里取出（上一张榜的文件路径），这里唯一要多做的一件事，
 * 是回答「它们现在还在不在」——只有扫描模块知道自己的实体宇宙（= 当前 files 表）。
 * 这个判断必须发生在采集时：留到读取时再问，回答的是另一个时刻的问题。
 */
export function collectScanEntities(
  s: ScanSnapshot,
  scopeId: string,
  previousIds?: string[],
): AiEntitySnapshot | null {
  const stages = buildStageCoverage(s);
  const result = computeRiskCorrelation(s, stages);
  const stageByKey = new Map(stages.map((st) => [st.key, st]));

  /**
   * 覆盖面按**阶段跑没跑**判，不按「该维度有没有非零取值」判。
   *
   * 这个区别在回归里是生死攸关的：computeRiskCorrelation 会把「全项目零取值」的维度
   * 一并排除出打分（对打分而言合理，它确实贡献不了任何区分度），但如果照搬那个判定当覆盖面，
   * 「全项目技术债被清空」就会变成「技术债维度不可用 → 不可比」——
   * 团队干成了最漂亮的一件事，系统却报「这一项没法比较」。
   *
   * 阶段跑了但一条都没查到，是 empty（查了确实没有），不是 unavailable（没查）。
   * 前者的 0 是结论，后者的 0 是空白。这条区分是本项目 dataQuality 层的老规矩。
   */
  const coverage = RISK_DIMENSIONS.map((d) => {
    const st = stageByKey.get(d.stage);
    const unavailable = st?.quality.status === "unavailable";
    return {
      key: d.key,
      available: !unavailable,
      reason: unavailable
        ? (st?.quality.reason ?? L(
            `${t(st?.labelKey ?? d.labelKey)}阶段未运行`,
            `${t(st?.labelKey ?? d.labelKey)} stage did not run`,
          ))
        : undefined,
    };
  });

  /**
   * 把综合分换算到「覆盖面所声明的基准」上。
   *
   * 通用引擎的契约是「两端覆盖面集合相同 ⟹ 综合分可比」。而 computeRiskCorrelation
   * 的归一分母只含**实际参与打分**的维度——某一维全项目归零时它悄悄退出分母，
   * 于是所有文件的分数同时被抬高，代码一行没动。契约就在这里被打破。
   *
   * 修法不是重新打分（那会让三份榜单口径分家），而是做一次**精确的换算**：
   * 零取值维度对分子的贡献恒为 0，所以「声明基准上的分数」= 现分数 × 打分权重和 / 声明权重和。
   * 这是恒等变换，不改名次、不改共振，只是把分数放回它自称的那把尺子上。
   */
  const availableKeys = new Set(coverage.filter((c) => c.available).map((c) => c.key));
  const declaredWeight = RISK_DIMENSIONS.filter((d) => availableKeys.has(d.key)).reduce(
    (sum, d) => sum + d.weight,
    0,
  );
  const scoringWeight = result.dimensions.reduce((sum, d) => sum + d.weight, 0);
  const rebase = declaredWeight > 0 ? scoringWeight / declaredWeight : 1;

  const entities: AiEntityRecord[] = result.files.slice(0, ENTITY_TOP_N).map((f, i) => {
    const dims: Record<string, number> = {};
    for (const [key, hit] of Object.entries(f.dims)) dims[key] = hit.value;
    return {
      // id 用 files 表的 relPath：file_id 每次扫描都会重生成，拿它当跨快照主键
      // 会让每一轮的每一个文件都被判成「新进榜 + 已删除」。
      id: f.filePath,
      score: round1(f.score * rebase),
      rank: i + 1,
      resonance: f.resonance,
      dims,
      size: f.codeLines,
    };
  });
  if (entities.length === 0) return null;

  const known = new Set(s.files.filter((f) => !f.isDirectory).map((f) => f.relPath));

  return {
    moduleId: "project-scan",
    scopeId,
    digest: fingerprintEntities(entities, coverage),
    takenAt: 0,
    entityLabel: t("regression.entityLabel"),
    entities,
    total: result.scoredFiles,
    // 榜单门槛 = 末位分数。通用层靠它区分「修好了」与「被别人挤下榜」，
    // 没有这个值，任何一次缺席都只能判不可比。
    cutoff: entities[entities.length - 1].score,
    coverage,
    dimensions: RISK_DIMENSIONS.map((d) => ({
      key: d.key,
      label: t(d.labelKey),
      unit: t(d.unitKey),
      weight: d.weight,
      better: DIM_POLICY[d.key]?.better ?? "lower",
      minDelta: DIM_POLICY[d.key]?.minDelta ?? 0,
    })),
    // 铁律③的唯一信息来源：上一张榜里此刻仍然存在的文件。
    // 不在这个名单里的缺席者 = 文件被删，那不叫质量改善。
    survivedIds: (previousIds ?? []).filter((id) => known.has(id)),
  };
}

const VERDICT_LABEL_KEY: Record<AiEntityRegressionReport["verdict"], string> = {
  regressing: "regression.verdict.regressing",
  improving: "regression.verdict.improving",
  mixed: "regression.verdict.mixed",
  flat: "regression.verdict.flat",
  insufficient: "regression.verdict.insufficient",
};

const CHANGE_LABEL_KEY: Record<AiEntityChange, string> = {
  worsened: "regression.change.worsened",
  improved: "regression.change.improved",
  appeared: "regression.change.appeared",
  removed: "regression.change.removed",
  flat: "regression.change.flat",
  incomparable: "regression.change.incomparable",
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 逐维变化串：只列有方向的那几维，最多三项 */
function dimsText(d: AiEntityDelta): string {
  if (d.dims.length === 0) return "";
  return d.dims
    .slice(0, 3)
    .map((x) => {
      const from = x.from === null ? "—" : x.from;
      const to = x.to === null ? "—" : x.to;
      const mark = x.key === d.driver ? "**" : "";
      return `${mark}${x.label}${mark} ${from}→${to}${x.unit}`;
    })
    .join(" · ");
}

function scoreText(d: AiEntityDelta): string {
  if (d.scoreFrom === null && d.scoreTo === null) return L("不可比", "incomparable");
  if (d.scoreFrom === null) return `— → ${d.scoreTo}`;
  if (d.scoreTo === null) return `${d.scoreFrom} → —`;
  return `${d.scoreFrom} → ${d.approx ? "≤" : ""}${d.scoreTo}`;
}

/**
 * 首次建榜时的分节：把刚入库的这张榜原样交出去。
 *
 * 这里绝不能沉默或返回空——「没有历史」必须被显式说成「没有历史」，
 * 否则 Agent 会顺理成章地写出「本轮无文件恶化」，而真相是这段时间根本没被观测过。
 */
function firstBaselineSection(s: ScanSnapshot, scopeId: string): AiContextSection {
  const snap = collectScanEntities(s, scopeId);
  const rows = (snap?.entities ?? [])
    .slice(0, 10)
    .map((e) => [cell(e.id, 70), String(e.rank), String(e.score), String(e.resonance)]);

  const section = makeSection(
    "regression",
    L("文件级回归（对比上一轮榜单）", "File-level Regression (vs. previous board)"),
    1,
    L(
      "首次建立文件榜基线：本轮榜单已入库，下次扫描起即可点名谁在变坏",
      "First-time file board baseline: this round's board is stored; from the next scan on, it can name who is worsening",
    ),
    [
      L(
        "本作用域**尚无可比的历史榜单**——这是第一次记录文件风险榜，或历史被清空过。",
        "This scope has **no comparable historical board yet** — this is the first time the file risk board was recorded, or the history was cleared.",
      ),
      L(
        "下方是本次入库的基线榜单；下一次扫描起，本节会逐文件给出变化方向、主因维度与幅度。",
        "Below is the baseline board stored this time; from the next scan on, this section gives per-file change direction, driver dimension and magnitude.",
      ),
      "",
      ...mdTable(
        H(["文件", "名次", "综合分", "共振维度数"], ["File", "Rank", "Score", "Res. dims"]),
        rows,
      ),
      "",
      L(
        "> 请勿把「无历史」当成「无变化」：现在还没有任何关于「谁在变坏」的结论可下。",
        "> Do not treat \"no history\" as \"no change\": there is not yet any conclusion about \"who is worsening\" to draw.",
      ),
      L(
        "> 需要「此刻谁最危险」请读 `riskMatrix`，需要「整体总量在往哪走」请读 `trend`。",
        "> For \"who is most at risk right now\" read `riskMatrix`; for \"where the overall totals are heading\" read `trend`.",
      ),
    ],
    { verdict: "insufficient", points: 0, boardSize: snap?.entities.length ?? 0 },
  );

  return {
    ...section,
    dataQuality: {
      status: "unavailable",
      observed: 0,
      reason: L("尚未积累第二张榜单，无法给出任何回归结论", "Not enough boards accumulated (need a second one); no regression conclusions can be given"),
      caveat: L("不要据此断言「没有文件在恶化」——这是没有历史，不是没有变化", "Do not assert \"no file is worsening\" — this is no history, not no change"),
    },
  };
}

/**
 * 文件级回归分节。
 *
 * 它回答 riskMatrix 与 trend 都答不了的那个问题：**这一轮改动把哪个文件弄坏了**。
 * 没有它，自动分析每轮都在同一批存量大文件上重复「这个文件很复杂」，
 * 而真正需要立刻处理的「昨天还好好的、今天复杂度翻倍」永远排不上号。
 */
export function buildRegressionSection(s: ScanSnapshot, scopeId: string): AiContextSection {
  const report = readEntityRegression("project-scan", scopeId);
  if (!report || report.verdict === "insufficient" || !report.baseline || !report.current) {
    return firstBaselineSection(s, scopeId);
  }

  const listed = report.entities.slice(0, DETAIL_ROWS);
  const rows = listed.map((d) => [
    t(CHANGE_LABEL_KEY[d.change] ?? d.change),
    cell(d.label, 66),
    scoreText(d),
    L(`${d.rankFrom ?? "—"} → ${d.rankTo ?? "出榜"}`, `${d.rankFrom ?? "—"} → ${d.rankTo ?? "off board"}`),
    `${d.resonanceFrom ?? "—"} → ${d.resonanceTo ?? "—"}`,
    cell(dimsText(d), 90),
    cell(d.reason ?? "", 60),
  ]);

  const spanText =
    report.spanDays >= 1
      ? L(`${report.spanDays} 天`, `${report.spanDays} days`)
      : L(`${Math.max(1, Math.round(report.spanDays * 1440))} 分钟`, `${Math.max(1, Math.round(report.spanDays * 1440))} minutes`);

  const lines: string[] = [
    L(
      `上一榜 **${fmtTime(report.baseline.takenAt)}** → 本轮 **${fmtTime(report.current.takenAt)}**` +
        `（间隔 ${spanText}，库内共 ${report.points} 张榜）。`,
      `Previous board **${fmtTime(report.baseline.takenAt)}** → this round **${fmtTime(report.current.takenAt)}**` +
        ` (interval ${spanText}, ${report.points} boards stored).`,
    ),
    L(
      `**总体判定：${t(VERDICT_LABEL_KEY[report.verdict])}** —— 恶化 ${report.worsened} · 改善 ${report.improved} · ` +
        `新进榜 ${report.appeared} · 已删除 ${report.removed} · 持平 ${report.flat} · 不可比 ${report.incomparable}。`,
      `**Overall verdict: ${t(VERDICT_LABEL_KEY[report.verdict])}** — worsened ${report.worsened} · improved ${report.improved} · ` +
        `appeared ${report.appeared} · removed ${report.removed} · flat ${report.flat} · incomparable ${report.incomparable}.`,
    ),
    "",
    report.note,
    "",
    L(
      "**逐文件变化**（已按恶化 → 新进榜 → 已删除 → 改善排序，持平的不列）",
      "**Per-file changes** (sorted worsened → appeared → removed → improved; flat entries omitted)",
    ),
    ...mdTable(
      H(
        ["变化", "文件", "综合分", "名次", "共振维度数", "逐维变化（**加粗**为主因）", "说明"],
        ["Change", "File", "Score", "Rank", "Res. dims", "Per-dim changes (**bold** = driver)", "Note"],
      ),
      rows,
    ),
  ];

  if (report.entities.length > DETAIL_ROWS) {
    lines.push("", L(
      `_另有 ${report.entities.length - DETAIL_ROWS} 条变化未列出（已按幅度截断）_`,
      `_${report.entities.length - DETAIL_ROWS} more changes omitted (truncated by magnitude)_`,
    ));
  }

  if (report.blindDims.length > 0) {
    lines.push(
      "",
      L(
        "**以下维度只在一端可用，逐维不可比，不得当作「没有变化」：**",
        "**The following dimensions are available on only one side; per-dimension comparison is impossible — do not treat this as \"no change\":**",
      ),
      ...report.blindDims.map((b) =>
        L(`- **${b.label}**：${b.reason ?? "端点维度不可用"}`, `- **${b.label}**: ${b.reason ?? "dimension unavailable at one endpoint"}`),
      ),
    );
  }

  if (!report.scoreComparable) {
    lines.push(
      "",
      L(
        "> ⚠️ 两端**可用维度集合不同**，综合分不可比（打分会在可用维度上做权重归一，" +
          "集合一变每个文件的分数都会动，与代码本身无关）。本轮只逐维比较，请勿引用综合分的升降。",
        "> ⚠️ The **set of available dimensions differs** between the two sides, so composite scores are incomparable (scoring renormalizes weights over available dimensions; " +
          "when the set changes every file's score moves, regardless of the code). This round compares per-dimension only — do not cite composite-score ups and downs.",
      ),
    );
  }

  lines.push(
    "",
    L("> 判读规则：", "> How to read:"),
    L(
      "> · 「新进榜」**不是**恶化——新文件天然从无到有，混进恶化榜会让每次新增功能都刷出一屏假警报；",
      "> · \"Appeared\" is **not** worsening — a new file naturally goes from nothing to something; mixing it into the worsening list would spam false alarms on every new feature;",
    ),
    L(
      "> · 「已删除」**不计入**改善——文件被删掉不叫质量改善，叫代码没了；",
      "> · \"Removed\" does **not** count as improvement — a deleted file is not better quality, the code is simply gone;",
    ),
    L(
      "> · 综合分带 `≤` 的是**推断上界**（文件跌出榜单，只知道它不高于门槛），不是实测值；",
      "> · A composite score with `≤` is an **inferred upper bound** (the file fell off the board; we only know it is not above the cutoff), not a measured value;",
    ),
    L(
      "> · 「变更频率」「被引用面」为中性维度，只参与排位不参与好坏判定——改得勤、被引用多本身不是缺陷；",
      "> · \"Change frequency\" and \"fan-in\" are neutral dimensions: they participate in ranking but not in good/bad judgment — being changed often or referenced widely is not itself a defect;",
    ),
    L(
      "> · 要落到「此刻谁最危险」读 `riskMatrix`，要看「总量在往哪走」读 `trend`；本节只回答「这一轮谁被改坏了」。",
      "> · For \"who is most at risk right now\" read `riskMatrix`; for \"where the totals are heading\" read `trend`; this section only answers \"who got broken this round\".",
    ),
  );

  const worstList = report.entities
    .filter((d) => d.change === "worsened")
    .slice(0, 5)
    .map((d) => ({
      id: d.id,
      driver: d.driver,
      scoreDelta: d.scoreDelta,
      rankFrom: d.rankFrom,
      rankTo: d.rankTo,
    }));

  const headline =
    report.worsened > 0
      ? L(`${report.worsened} 个文件恶化，首位 ${listed[0]?.label ?? "-"}`, `${report.worsened} file(s) worsened, top: ${listed[0]?.label ?? "-"}`)
      : report.improved > 0
        ? L(`无文件恶化，${report.improved} 个改善`, `No file worsened; ${report.improved} improved`)
        : L("榜单无实质变化", "No substantive board change");

  const section = makeSection(
    "regression",
    L("文件级回归（对比上一轮榜单）", "File-level Regression (vs. previous board)"),
    1,
    L(
      `${t(VERDICT_LABEL_KEY[report.verdict])}：${headline}（间隔 ${spanText}）`,
      `${t(VERDICT_LABEL_KEY[report.verdict])}: ${headline} (interval ${spanText})`,
    ),
    lines,
    {
      verdict: report.verdict,
      points: report.points,
      spanDays: report.spanDays,
      baselineAt: report.baseline.takenAt,
      currentAt: report.current.takenAt,
      worsened: report.worsened,
      improved: report.improved,
      appeared: report.appeared,
      removed: report.removed,
      incomparable: report.incomparable,
      scoreComparable: report.scoreComparable,
      comparableDims: report.comparableDims,
      blindDims: report.blindDims.map((b) => b.key),
      topWorsened: worstList,
    },
  );

  return {
    ...section,
    dataQuality: {
      status:
        report.comparableDims.length === 0
          ? "unavailable"
          : report.blindDims.length > 0 || !report.scoreComparable
            ? "partial"
            : "ok",
      observed: report.points,
      covered: report.comparableDims.length,
      expected: report.comparableDims.length + report.blindDims.length,
      reason:
        report.comparableDims.length === 0
          ? L("两端没有共同可用的维度，本轮无法做任何文件级比较", "No common usable dimensions between the two sides; no file-level comparison is possible this round")
          : report.blindDims.length > 0
            ? L(
                `${report.blindDims.length} 个维度只在一端可用：${report.blindDims.map((b) => b.label).join("、")}`,
                `${report.blindDims.length} dimension(s) available on only one side: ${report.blindDims.map((b) => b.label).join(", ")}`,
              )
            : !report.scoreComparable
              ? L("可用维度集合发生变化，综合分不可比", "The set of available dimensions changed; composite scores are incomparable")
              : undefined,
      caveat:
        report.blindDims.length > 0 || !report.scoreComparable
          ? L("不可比维度上的数值变化不得解读为改善或恶化", "Numeric changes on incomparable dimensions must not be read as improvement or worsening")
          : undefined,
    },
  };
}
