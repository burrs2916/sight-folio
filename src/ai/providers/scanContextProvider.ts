import { aiContextRegistry } from "../contextRegistry";
import {
  AI_CONTEXT_SCHEMA_VERSION,
  type AiAnalysisPreset,
  type AiContextPack,
  type AiContextProvider,
  type AiContextSection,
} from "../contextTypes";
import { packWithinBudget } from "../tokenBudget";
import { packDigestFromSections, stampSections } from "../sectionDiff";
import { useProjectStore } from "../../store/projectStore";
import {
  buildArchitectureSection,
  buildCallGraphSection,
  buildCloneSection,
  buildCommentHealthSection,
  buildCouplingSection,
  buildDataFlowSection,
  buildDeadCodeSection,
  buildHotspotSection,
  buildOverviewSection,
  buildPatternSection,
  buildReviewSection,
  buildSymbolSection,
  buildTechDebtSection,
  buildRequirementsSection,
} from "./scanSectionBuilders";
import { buildCoverageSection, buildStageCoverage, sectionQualityMap } from "./scanCoverage";
import { buildRiskMatrixSection, buildScanFocusReport } from "./riskCorrelation";
import { buildTrendSection, collectScanMetrics } from "./scanTrend";
import { buildRegressionSection, collectScanEntities } from "./scanEntities";
import { applyQuality, worstStatus } from "../dataQuality";
import { t } from "../../i18n";
import type { ScanSnapshot } from "./scanSections";

/** 需求与演进组的预设 key —— 与 ScanAnalysisLauncher 的分组渲染共用。新增需求类预设时在此登记 */
const REQUIREMENTS_PRESET_KEYS = ["requirements-inference", "evolution-guidance", "next-step-catalyst", "requirements-capture"];

/**
 * 项目扫描 → AI 上下文供给者。
 *
 * 这是「通用 AI 上下文协议」的第一个（也是当前唯一的）实现方。它把 store 里
 * 14 阶段扫描的产物压缩成 AI 友好的分节包，注册到 aiContextRegistry。
 * AI 层与 UI 只按协议消费，**不感知扫描细节**；将来画布 / 报告等模块接入时，
 * 各自实现 AiContextProvider 即可，这里零改动。
 *
 * 关键约束（来自用户）：AI Agent 用「已配置的」——本文件绝不写死任何 agent / 模型 / prompt 选择。
 * presets 只描述「这类数据适合问什么」+ 任务指令 + 需要哪些分节，具体用哪个 Agent 永远由用户在 UI 选择。
 */

/** 从 store 取当前分析的全量扫描快照。仅当 store 当前装载的正是 scopeId 才取数。 */
function snapshotFromStore(analysisId: string): ScanSnapshot | null {
  const s = useProjectStore.getState();
  if (s.activeAnalysisId !== analysisId) return null;
  return {
    files: s.files,
    modules: s.modules,
    dependencies: s.dependencies,
    layers: s.layers,
    findings: s.findings,
    symbols: s.symbols,
    symbolRefs: s.symbolRefs,
    patternHits: s.patternHits,
    metrics: s.metrics,
    techDebt: s.techDebt,
    clones: s.clones,
    deadSymbols: s.deadSymbols,
    gitChurn: s.gitChurn,
    callEdges: s.callEdges,
    callGraphSummary: s.callGraphSummary,
    changeCoupling: s.changeCoupling,
    dataFlowSummary: s.dataFlowSummary,
  };
}

/**
 * 推导作用域展示名：优先用监视中的项目根目录名，否则从首个代码文件的相对路径
 * 反向取顶层目录名，再不行退化为 analysisId。作用域名只用于展示，不影响数据。
 */
function deriveScopeLabel(analysisId: string): string {
  const s = useProjectStore.getState();
  const root = s.watchProjectRoot;
  if (root) {
    const base = root.replace(/[/\\]+$/g, "").split(/[/\\]/).pop();
    if (base) return base;
  }
  const first = s.files.find((f) => !f.isDirectory);
  if (first) {
    const dir = first.relPath.split("/").slice(0, -1).join("/");
    const top = dir.split("/")[0];
    if (top) return top;
  }
  return analysisId;
}

/**
 * 分节定义：key 与 build 一一对应，便于按 sectionKeys 精准取用。
 *
 * build 收 scopeId 是为 trend 开的口子——它要读的是「这个作用域的历史」，
 * 而历史不在 ScanSnapshot 里（快照只描述此刻）。其余构建器忽略第二个参数即可。
 */
const SECTION_DEFS: Array<{
  key: string;
  build: (s: ScanSnapshot, scopeId: string) => AiContextSection;
}> = [
  // coverage 排在最前：Agent 读任何结论之前，先知道哪些维度是盲区
  { key: "coverage", build: buildCoverageSection },
  { key: "overview", build: buildOverviewSection },
  // riskMatrix 紧随其后：它是「该从哪下手」的直接答案，且读它就不必再逐节交叉，
  // 是整包里 token 性价比最高的一节，不能被排在容易被预算降级的位置。
  // 显式丢掉第二个参数：buildRiskMatrixSection 的第二位是可选的 stages（复用体检结果），
  // 直接挂上去会被 scopeId 顶进那个位置，静默把字符串当成阶段数组。
  { key: "riskMatrix", build: (s) => buildRiskMatrixSection(s) },
  // trend 与 riskMatrix 同级：前者答「在变好还是变坏」，后者答「从哪下手」，
  // 二者合起来才构成一句有价值的结论——只有截面没有走势，任何数字都无法判断严重性。
  { key: "trend", build: buildTrendSection },
  // regression 紧跟 trend：trend 说「技术债从 87 涨到 94」，regression 说「是这三个文件干的」。
  // 只有前者没有后者，Agent 唯一能写出的结论是「技术债在上升，建议关注」——
  // 一句放在任何项目上都成立、因而没人会照着做任何事的话。
  { key: "regression", build: buildRegressionSection },
  { key: "architecture", build: buildArchitectureSection },
  { key: "hotspots", build: buildHotspotSection },
  { key: "review", build: buildReviewSection },
  { key: "coupling", build: buildCouplingSection },
  { key: "techDebt", build: buildTechDebtSection },
  { key: "clones", build: buildCloneSection },
  { key: "deadCode", build: buildDeadCodeSection },
  { key: "callGraph", build: buildCallGraphSection },
  { key: "dataFlow", build: buildDataFlowSection },
  { key: "patterns", build: buildPatternSection },
  { key: "symbols", build: buildSymbolSection },
  // 注释卫生：紧随 symbols —— 它把「注释缺失/无文档」聚合给 Agent，
  // 与 riskMatrix 的复杂度交叉后能指出「复杂但没注释」的最该补注释的位置。
  { key: "commentHealth", build: buildCommentHealthSection },
  // 需求语义：反推业务需求的关键一层——入口点/公开契约/模块职责。
  // 排在靠后但优先级 8（与 commentHealth 同级），让需求类预设能拿到它而不挤掉 coverage/riskMatrix。
  { key: "requirements", build: buildRequirementsSection },
];

/** 分节键全集：UI 与测试据此校验预设引用的 key 是否有效（防手滑写错键静默丢分节） */
export const SCAN_SECTION_KEYS = SECTION_DEFS.map((d) => d.key);

/**
 * 分析预设：只描述「任务 + 需要哪些分节」，不绑定任何 Agent / 模型。
 * UI 据此渲染「一键分析」按钮，用户点选后用自己当前配置的 Agent 执行。
 */
export const scanAnalysisPresets: AiAnalysisPreset[] = [
  {
    key: "holistic-optimization",
    title: { "zh-CN": "全面优化诊断", "en-US": "Holistic Optimization Diagnosis" },
    description: {
      "zh-CN": "综合架构、复杂度、审查、技术债、重复、死代码、耦合等全部维度，给出整体优化路线图与优先级。",
      "en-US":
        "Synthesize architecture, complexity, review, tech debt, duplication, dead code and coupling into an overall optimization roadmap with priorities.",
    },
    prompt: {
      "zh-CN":
        "你是一名资深代码架构顾问。请基于提供的「项目扫描上下文」，对这份代码做一次全面的优化诊断：\n" +
        "1) 先概述项目整体健康度（规模、语言、架构分层、审查发现密度），读 `trend` 判断这些数字是在变好还是变坏" +
        "（同一个「技术债 87 处」，从 120 降下来和从 40 涨上去是完全相反的两件事），" +
        "再读 `riskMatrix` 的「维度共现」判断本项目的系统性病灶类型；\n" +
        "2) 指出 3-5 个最值得投入的改进方向，按「收益 / 风险 / 工作量」排序，每个方向给出具体落点（文件:行号）与预期收益；" +
        "落点优先取自 `riskMatrix` 的多维共振榜——单维排名靠前但只有一维报警的目标，通常性价比低于四维共振的目标；\n" +
        "3) 输出一份分阶段优化路线图（先止血、再重构、后演进）。\n" +
        "所有结论必须基于上下文中的事实与 Top-N 明细，不要臆测。需要细节时用工具按需取，不要全文检索。",
      "en-US":
        "You are a senior code architecture advisor. Based on the provided 'project scan context', perform a holistic optimization diagnosis:\n" +
        "1) First summarize the project's overall health (scale, languages, architectural layering, review-finding density); read `trend` to judge whether these numbers are improving or regressing " +
        "(the same '87 tech-debt items' means the opposite depending on whether it dropped from 120 or rose from 40), " +
        "then read `riskMatrix`'s 'dimension co-occurrence' to identify the systemic ailment type of this project;\n" +
        "2) Point out 3-5 improvement directions most worth investing in, ranked by 'benefit / risk / effort', each with a concrete landing point (file:line) and expected benefit; " +
        "prefer the multi-dimensional resonance ranking from `riskMatrix` — a target high on only one dimension is usually lower ROI than one resonating on four;\n" +
        "3) Output a phased optimization roadmap (stop the bleeding first, then refactor, then evolve).\n" +
        "All conclusions must be grounded in the facts and Top-N details in the context; do not speculate. When you need details, fetch them on demand via tools; do not full-text search.",
    },
  },
  {
    key: "refactor-priority",
    title: { "zh-CN": "重构优先级", "en-US": "Refactor Priority" },
    description: {
      "zh-CN": "聚焦复杂度热点、审查发现、隐性耦合、技术债、重复与死代码，排出最该重构的目标清单。",
      "en-US":
        "Focus on complexity hotspots, review findings, hidden coupling, tech debt, duplication and dead code; rank the targets most worth refactoring.",
    },
    prompt: {
      "zh-CN":
        "你是一名重构专家。请基于提供的扫描上下文，排出「最该重构」的目标清单：\n" +
        "1) 以 `riskMatrix`（跨维度全量共振）为锚确定目标顺序——它已在全量数据上把复杂度/变更/扇入/审查/重复/技术债/隐性耦合/死代码交叉过，" +
        "共振维度数越高越该先动；需要某一维的明细时再去取对应分节，不要逐节自己求交集（各节都是 Top-N 截断，交集会漏掉真正的第一名）；\n" +
        "2) 每个目标给出：位置（文件:行号）、问题本质、建议的重构手法、预计影响面（影响链可能波及的范围）；\n" +
        "3) 标注哪些目标改动风险高（枢纽函数 / 透传污染 / 隐性耦合），需要配套测试或渐进式迁移。\n" +
        "务必引用上下文里的具体数据，不要泛泛而谈。",
      "en-US":
        "You are a refactoring expert. Based on the scan context, rank the targets 'most worth refactoring':\n" +
        "1) Anchor the order on `riskMatrix` (full-data cross-dimension resonance) — it has already crossed complexity/change/fan-in/review/duplication/tech-debt/hidden-coupling/dead-code over the full dataset; " +
        "the more resonant dimensions, the higher the priority; when you need a dimension's details, fetch that section, do not compute intersections yourself (each section is Top-N truncated, and intersection would miss the real #1);\n" +
        "2) For each target give: location (file:line), the essence of the problem, the suggested refactoring technique, and the estimated blast radius (how far the impact chain may reach);\n" +
        "3) Flag high-risk targets (hub functions / transitive pollution / hidden coupling) that need accompanying tests or incremental migration.\n" +
        "Cite specific data from the context; do not speak in generalities.",
    },
    // 「预计影响面」这条要求依赖数据流的透传/阻断判定，故纳入 dataFlow
    sectionKeys: [
      "coverage",
      "overview",
      "riskMatrix",
      "hotspots",
      "review",
      "coupling",
      "techDebt",
      "clones",
      "deadCode",
      "dataFlow",
      "commentHealth",
    ],
  },
  {
    key: "architecture-health",
    title: { "zh-CN": "架构健康度", "en-US": "Architecture Health" },
    description: {
      "zh-CN": "审视分层合理性、依赖方向、循环依赖、隐性耦合与调用枢纽，评估架构是否撑得住演进。",
      "en-US":
        "Examine layering soundness, dependency direction, circular dependencies, hidden coupling and caller hubs; assess whether the architecture can sustain evolution.",
    },
    prompt: {
      "zh-CN":
        "你是一名软件架构师。请基于扫描上下文评估这份项目的架构健康度：\n" +
        "1) 分层是否清晰（依赖是否自上而下、有无反向依赖）；\n" +
        "2) 循环依赖与**隐性耦合**（无静态依赖却总一起改）是否在侵蚀模块边界；\n" +
        "3) 调用图中是否存在过度中心化的枢纽函数，其变更风险是否被低估；\n" +
        "4) 给出 2-3 条能显著降低耦合、提升可演进性的具体建议（含落点）。\n" +
        "结论须基于上下文数据，区分「事实」与「推断」。",
      "en-US":
        "You are a software architect. Based on the scan context, assess this project's architectural health:\n" +
        "1) Is the layering clear (do dependencies flow top-down, any reverse dependencies);\n" +
        "2) Are circular dependencies and **hidden coupling** (no static dependency yet always changed together) eroding module boundaries;\n" +
        "3) Is there an over-centralized hub function in the call graph whose change risk is underestimated;\n" +
        "4) Give 2-3 concrete suggestions that significantly reduce coupling and improve evolvability (with landing points).\n" +
        "Conclusions must be grounded in context data; distinguish 'fact' from 'inference'.",
    },
    sectionKeys: [
      "coverage",
      "overview",
      "architecture",
      "coupling",
      "callGraph",
      "dataFlow",
      "patterns",
    ],
  },
  {
    key: "tech-debt-cleanup",
    title: { "zh-CN": "技术债清偿", "en-US": "Tech Debt Paydown" },
    description: {
      "zh-CN": "清点技术债标记、重复片段、死代码与高危审查项，安排可安全清偿的清单。",
      "en-US":
        "Inventory tech-debt markers, duplicate fragments, dead code and high-risk findings; schedule a safe paydown list.",
    },
    prompt: {
      "zh-CN":
        "你是一名技术债治理专家。请基于扫描上下文制定技术债清偿计划：\n" +
        "1) 分类统计技术债（TODO/FIXME/HACK 等）与 critical 级标记，按文件聚合给出「最该先清」的清单；\n" +
        "2) 识别可安全删除的死代码候选（优先 internal 可见性、高置信度），并提示 exported 符号删除前需确认对外契约；\n" +
        "3) 标注高收益重复代码组（行数 × 实例数），给出抽公共函数 / 模板的重构方向；\n" +
        "4) 估算清偿工作量（按标记严重度折算），给出可并行的清偿批次。\n" +
        "所有条目带上精确位置（文件:行号）。",
      "en-US":
        "You are a tech-debt governance expert. Based on the scan context, plan tech-debt paydown:\n" +
        "1) Categorize and count tech debt (TODO/FIXME/HACK etc.) and critical-level markers; aggregate by file to give the 'pay first' list;\n" +
        "2) Identify safely deletable dead-code candidates (prefer internal visibility, high confidence), and warn that exported symbols need contract confirmation before deletion;\n" +
        "3) Flag high-yield duplicate code groups (lines × instances) and propose extracting shared functions / templates;\n" +
        "4) Estimate paydown effort (by marker severity) and propose parallelizable paydown batches.\n" +
        "Attach a precise location (file:line) to every item.",
    },
    sectionKeys: ["coverage", "riskMatrix", "techDebt", "clones", "deadCode", "review"],
  },
  {
    key: "hotspot-deepdive",
    title: { "zh-CN": "风险热点攻坚", "en-US": "Risk Hotspot Deep Dive" },
    description: {
      "zh-CN": "锁定复杂度×变更频率最高的文件，结合审查与调用影响面，给出单点攻坚方案。",
      "en-US":
        "Pin down the files with highest complexity × change frequency; combine review and call-graph impact to give a point-by-point plan.",
    },
    prompt: {
      "zh-CN":
        "你是一名性能与可维护性攻坚专家。请聚焦扫描上下文中的风险热点：\n" +
        "1) 先看 `riskMatrix` 的多维共振榜与「维度共现」——共现最多的那对维度就是本项目的系统性病灶，" +
        "再结合 `hotspots` 的复杂度明细，说明这些文件为何「既难改又常改」；\n" +
        "2) 对每个热点，结合审查发现与调用图影响面，给出可分步执行的拆解方案（提取函数、降低嵌套、拆分超大函数等）；\n" +
        "3) 提示哪些热点处于变更污染透传链上，改动需同步评估下游影响。\n" +
        "方案要具体到函数/行号级别，可直接落地。",
      "en-US":
        "You are a performance and maintainability specialist. Focus on the risk hotspots in the scan context:\n" +
        "1) First read `riskMatrix`'s multi-dimensional resonance ranking and 'dimension co-occurrence' — the most co-occurring pair is the project's systemic ailment; " +
        "combined with `hotspots`' complexity details, explain why these files are 'both hard to change and frequently changed';\n" +
        "2) For each hotspot, combine review findings and call-graph impact to give a stepwise decomposition plan (extract functions, reduce nesting, split oversized functions);\n" +
        "3) Flag hotspots sitting on a transitive-change-pollution chain — changes there must also assess downstream impact.\n" +
        "Be specific to function/line level so it can be acted on directly.",
    },
    sectionKeys: ["coverage", "riskMatrix", "hotspots", "review", "callGraph", "dataFlow"],
  },
  {
    // 这一维是**自动化轮转专属**的：其余预设都在问「现在有什么问题」，
    // 只有它在问「相比上次发生了什么」。没有它，自动分析每轮都会把同一批
    // 存量问题重新描述一遍，越跑越像复读机，用户很快就不看了。
    key: "trend-review",
    title: { "zh-CN": "走势复盘", "en-US": "Trend Retrospective" },
    description: {
      "zh-CN": "对比历史基线，判断项目在变好还是变坏，定位本轮新增的恶化点并追责到具体文件。",
      "en-US":
        "Compare against the historical baseline to judge whether the project is improving or regressing; locate newly-worsened spots and attribute them to specific files.",
    },
    prompt: {
      "zh-CN":
        "你是一名负责代码质量走势的技术负责人。请基于扫描上下文做一次**变化复盘**，而不是重述现状：\n" +
        "1) 先读 `trend`：逐项说明哪些指标改善、哪些恶化，重点解释**恶化幅度最大**的那两项意味着什么；\n" +
        "2) `trend` 中标为「不可比」的项，必须原样声明为未知，**不得**把数值归零解读为改善——那是该维度这次没跑；\n" +
        "3) 把恶化落到人身上能改的地方：结合 `riskMatrix` 共振榜与 `hotspots`，指出最可能造成本轮恶化的 2-3 个文件（给文件:行号），" +
        "并说明判断依据（哪一维在恶化、该文件在该维的名次）；\n" +
        "4) 给出下一轮扫描前应当完成的、可验证的 3 条动作，每条都要写清「做完之后 trend 里的哪个指标应当变成什么样」。\n" +
        "如果 `trend` 显示尚无可比历史，直接如实说明「本次仅建立基线」，不要编造走势。",
      "en-US":
        "You are a tech lead responsible for code-quality trends. Based on the scan context, do a **change retrospective**, not a restatement of status:\n" +
        "1) Read `trend` first: explain item by item which metrics improved and which regressed, focusing on what the **largest regression magnitude** means;\n" +
        "2) Items marked 'incomparable' in `trend` must be declared unknown verbatim — **do not** read a zeroed value as improvement (that dimension simply didn't run this time);\n" +
        "3) Attribute regressions to where a human can act: combine `riskMatrix`'s resonance ranking and `hotspots` to point out the 2-3 files most likely causing this round's regression (file:line), " +
        "and state the basis (which dimension is worsening, the file's rank in that dimension);\n" +
        "4) Give 3 verifiable actions to complete before the next scan, each stating 'after this, which metric in trend should become what'.\n" +
        "If `trend` shows no comparable history yet, honestly state 'this run only establishes a baseline'; do not fabricate a trend.",
    },
    sectionKeys: ["coverage", "trend", "regression", "riskMatrix", "hotspots", "techDebt"],
  },
  {
    // 与 trend-review 的差别值得写清楚，否则轮转会退化成同一维度问两遍：
    // trend-review 问「总量在往哪走」，这一维问「**这一轮改动把哪个文件弄坏了**」。
    // 总量是会互相抵消的——三个文件清理干净、一个文件烂了三倍，加总起来风平浪静，
    // 而那个烂掉的文件正是唯一需要今天就处理的东西。
    key: "regression-review",
    title: { "zh-CN": "回归追责", "en-US": "Regression Attribution" },
    description: {
      "zh-CN": "逐文件对比上一轮风险榜，点名本轮被改坏的具体文件、主因维度与幅度，给出立刻可做的收口动作。",
      "en-US":
        "Compare each file against the previous risk ranking; name the specific files broken this round, their primary dimension and magnitude, and give immediate remediation actions.",
    },
    prompt: {
      "zh-CN":
        "你是一名负责守住代码质量底线的评审者。请只针对**本轮发生的变化**作答，不要重述存量问题：\n" +
        "1) 读 `regression`：逐条说明被判为「恶化」的文件——它在哪一维恶化（主因维度）、幅度多大、名次升了多少；\n" +
        "2) 严格遵守本节的判读规则：「新进榜」不是恶化，「已删除」不计入改善，带 `≤` 的分数是推断上界不是实测值，" +
        "「变更频率 / 被引用面」是中性维度不构成恶化证据；标为不可比的项一律如实声明为未知，**不得**把数值归零解读为改善；\n" +
        "3) 对每个恶化文件，结合 `riskMatrix` 中它的多维处境，判断这次恶化是「孤立的一次劣化」还是「本来就危险的文件又被加了一刀」——" +
        "后者要显著提高优先级；\n" +
        "4) 给出 2-3 条本周就能完成的收口动作，每条写清「做完之后下一轮 `regression` 里这个文件应当出现什么变化」；\n" +
        "5) 如果本轮确实没有文件恶化，直接说明这一点并指出改善了哪些——不要为了凑结论去把持平的文件说成有问题。\n" +
        "所有点名都必须带上下文里出现过的真实文件路径，不得自行拼造。",
      "en-US":
        "You are a reviewer guarding the code-quality baseline. Answer only for **changes that happened this round**; do not restate existing problems:\n" +
        "1) Read `regression`: explain each file judged 'worsened' — which dimension worsened (primary), by how much, and how many ranks it rose;\n" +
        "2) Strictly follow this section's interpretation rules: 'newly entered ranking' is NOT a worsening, 'deleted' does not count as improvement, a score with `≤` is an inferred upper bound not a measured value, " +
        "'change frequency / reference surface' are neutral dimensions and do not constitute worsening evidence; items marked incomparable must be declared unknown verbatim — **do not** read a zeroed value as improvement;\n" +
        "3) For each worsened file, combine its multi-dimensional standing in `riskMatrix` to judge whether this regression is 'an isolated one-off' or 'an already-dangerous file kicked once more' — " +
        "raise priority for the latter;\n" +
        "4) Give 2-3 remediation actions completable this week, each stating 'after this, what change should appear for this file in next round's `regression`';\n" +
        "5) If truly no file worsened this round, say so directly and point out what improved — do not dress up flat files as problems to fill a conclusion.\n" +
        "Every named file must carry a real path that appeared in the context; do not fabricate.",
    },
    sectionKeys: ["coverage", "regression", "riskMatrix", "trend"],
  },
  // ──────────────────────────────────────────────────────────────
  // 以下三个预设构成「需求分析」能力组：从代码反推需求 / 给出演进方向 / 给出可立即执行的引导。
  // 它们与上方「问题诊断」组不同——后者回答「现在有什么问题」，前者回答
  // 「这系统该做什么 / 下一步往哪走 / 此刻该动手什么」。
  // 全部复用现有分节与运行闭环（launchModuleAnalysis 自动注入工具/写回/语言指令），无需任何 UI 改动。
  // 入口自动出现在 ScanAnalysisLauncher（手动）与 AutoAnalysisPanel（自动编排），见 provider.presets 消费处。
  // ──────────────────────────────────────────────────────────────
  {
    key: "requirements-inference",
    title: { "zh-CN": "需求反推", "en-US": "Requirements Inference" },
    description: {
      "zh-CN":
        "从模块划分、公开接口、类名/函数名与设计模式反推系统应满足的业务需求与功能域，严格区分事实与推断。",
      "en-US":
        "Reverse-engineer the business requirements and functional domains this system fulfills from its module decomposition, public interfaces, class/function names and design patterns; strictly separate fact from inference.",
    },
    prompt: {
      "zh-CN":
        "你是一名资深需求工程顾问。请基于提供的「项目扫描上下文」，从代码**反推**这个系统应满足的业务需求：\n" +
        "1) 先读 `overview` 了解规模、语言与顶层结构；再读 `architecture`（分层 / 模块 / 耦合）与 `symbols`（代表符号名）" +
        "把握系统骨架；`patterns` 的设计模式命中能提示系统解决了哪类典型问题；`callGraph` 的枢纽函数往往是核心能力的落点。\n" +
        "2) 输出：\n" +
        "  a) **核心业务域**：按模块 / 职责聚类，推断系统被组织成在解决哪几类问题（每域一句话职责 + 支撑它的模块/符号）；\n" +
        "  b) **对外能力 / 契约**：对外暴露的接口、CLI / 入口点、公开 API（从公开符号与入口点推断）；\n" +
        "  c) **功能清单**：从命名 + 设计模式反推出的具体特性（每条标注映射到哪些文件:行号的证据）；\n" +
        "  d) **反推置信度**：本项目命名越规范，推断越可靠；若命名混乱或大量缩写，必须明确声明推断不可靠。\n" +
        "3) 严格区分「事实」（代码里确实存在的模块名 / 接口 / 符号）与「推断」（从这些事实推测的业务意图），后者一律加「推测：」前缀。\n" +
        "4) 指出代码**暗示但似乎缺失**的能力（反推的需求无对应代码覆盖），作为潜在需求缺口。\n" +
        "所有结论必须基于上下文事实，需要细节时用工具按需取，不要臆测。",
      "en-US":
        "You are a senior requirements-engineering consultant. Based on the 'project scan context', **reverse-engineer** the business requirements this system fulfills:\n" +
        "1) First read `overview` for scale, languages and top-level structure; then `architecture` (layers / modules / coupling) and `symbols` (representative names) to grasp the skeleton; " +
        "design-pattern hits in `patterns` hint at the class of problem solved; hub functions in `callGraph` are usually where core capability lands.\n" +
        "2) Output:\n" +
        "  a) **Core business domains**: cluster by module / responsibility and infer which classes of problems the system is organized to solve (one-line responsibility + the modules/symbols backing it for each);\n" +
        "  b) **External capabilities / contracts**: exposed interfaces, CLI / entry points, public APIs (inferred from public symbols and entry points);\n" +
        "  c) **Feature list**: concrete features reverse-engineered from names + patterns (each tagged with the file:line evidence it maps to);\n" +
        "  d) **Inference confidence**: the more conventional the naming, the more reliable the inference; if naming is chaotic or heavily abbreviated, you MUST state the inference is unreliable.\n" +
        "3) Strictly separate 'fact' (module/interface/symbol names that actually exist in code) from 'inference' (business intent guessed from those facts), prefixing the latter with 'Inferred:'.\n" +
        "4) Point out capabilities the code **implies but seems to lack** (reverse-engineered needs with no covering code) as potential requirement gaps.\n" +
        "All conclusions must be grounded in context facts; fetch details on demand via tools; do not speculate.",
    },
    sectionKeys: ["coverage", "overview", "architecture", "symbols", "patterns", "callGraph", "requirements"],
  },
  {
    key: "evolution-guidance",
    title: { "zh-CN": "演进推进", "en-US": "Evolution Guidance" },
    description: {
      "zh-CN": "基于健康度与走势，给出分阶段演进路线图与优先级，回答「下一步该往哪走、为什么」。",
      "en-US":
        "Based on health and trend, give a phased evolution roadmap with priorities; answer 'where to go next, and why'.",
    },
    prompt: {
      "zh-CN":
        "你是一名技术战略顾问。请基于扫描上下文，为这份项目规划**演进路线**，而不是重述现状问题：\n" +
        "1) 读 `trend`：判断各项指标在变好还是变坏（同一个「技术债 87」从 120 降和从 40 涨是完全相反的两条路），不可比的项原样声明为未知；\n" +
        "2) 读 `riskMatrix` 的「维度共现」找出本项目的系统性病灶类型——它是演进方向的头号依据；\n" +
        "3) 读 `regression` 找出本轮被改坏的文件，`techDebt` 量化清偿负担，`architecture` 评估分层是否撑得住后续演进；\n" +
        "4) 输出**分阶段演进路线图**：\n" +
        "  阶段一（止血）：先消除正在恶化 / 高风险的根因（带文件:行号 + 预期收益 + 工作量）；\n" +
        "  阶段二（重构）：针对系统性病灶做结构性改善；\n" +
        "  阶段三（演进）：在健康基座上可新增的能力方向（呼应 `requirements-inference` 的需求缺口）。\n" +
        "区分「事实」与「推断」，所有落点引用上下文里的真实文件:行号。",
      "en-US":
        "You are a technology strategy advisor. Based on the scan context, plan the **evolution path** of this project, not a restatement of current problems:\n" +
        "1) Read `trend`: judge whether each metric is improving or regressing (the same '87 tech-debt' means opposite things dropping from 120 vs rising from 40); declare incomparable items unknown verbatim;\n" +
        "2) Read `riskMatrix`'s 'dimension co-occurrence' to find this project's systemic ailment type — it is the #1 basis for evolution direction;\n" +
        "3) Read `regression` for files broken this round, `techDebt` to quantify paydown burden, `architecture` to assess whether layering can sustain further evolution;\n" +
        "4) Output a **phased evolution roadmap**:\n" +
        "  Phase 1 (stop the bleeding): first eliminate the root causes that are actively worsening / high-risk (with file:line + expected benefit + effort);\n" +
        "  Phase 2 (refactor): structural improvement targeting the systemic ailment;\n" +
        "  Phase 3 (evolve): capability directions to add on a healthy base (echoing requirement gaps from `requirements-inference`).\n" +
        "Separate 'fact' from 'inference'; cite real file:line evidence from the context.",
    },
    sectionKeys: ["coverage", "riskMatrix", "trend", "regression", "techDebt", "architecture", "requirements"],
  },
  {
    key: "next-step-catalyst",
    title: { "zh-CN": "行动引导", "en-US": "Next-Step Catalyst" },
    description: {
      "zh-CN": "基于盲区与高风险点，给出此刻就能执行的 3-5 个具体动作，每条带文件:行号与预期收益。",
      "en-US":
        "Based on blind spots and high-risk points, give 3-5 concrete actions executable right now, each with file:line and expected benefit.",
    },
    prompt: {
      "zh-CN":
        "你是一名带人干活的资深工程师。请基于扫描上下文，给出**此刻就能动手**的行动清单，而不是泛泛的方向：\n" +
        "1) 先读 `coverage` 看清哪些维度是盲区——对盲区**不得**下结论，只能声明「该维度未扫描，无法判断」；\n" +
        "2) 从 `hotspots`（复杂度 × 变更）、`deadCode`（可删候选）、`clones`（重复）、`review`（审查发现）、`commentHealth`（文档缺口）中，各挑出最该立刻处理的目标；\n" +
        "3) 给出 **3-5 个立即可执行动作**，每个必须包含：\n" +
        "  - 具体位置（文件:行号，取自上下文真实路径）；\n" +
        "  - 动作内容（一句话，如「抽取 X 与 Y 的公共函数」「删除未引用的 Z」「给公开 API A 补文档」）；\n" +
        "  - 预期收益（降低了什么风险 / 省下多少维护成本）；\n" +
        "  - 工作量估计（S/M/L）。\n" +
        "4) 按「收益 / 风险 / 工作量」排序，把「高收益 + 低风险 + 小工作量」的放最前。\n" +
        "所有条目引用上下文里的真实位置，不得自行拼造路径。",
      "en-US":
        "You are a senior engineer who gets things done. Based on the scan context, give an action list **executable right now**, not vague direction:\n" +
        "1) First read `coverage` to see which dimensions are blind spots — for those, **do not** conclude, only state 'this dimension was not scanned, cannot judge';\n" +
        "2) From `hotspots` (complexity × churn), `deadCode` (deletion candidates), `clones` (duplication), `review` (findings), `commentHealth` (doc gaps), pick the most urgent targets each;\n" +
        "3) Give **3-5 immediately executable actions**, each must include:\n" +
        "  - Concrete location (file:line, copied from real context paths);\n" +
        "  - The action (one line, e.g. 'extract shared function from X and Y', 'delete unreferenced Z', 'add docs to public API A');\n" +
        "  - Expected benefit (what risk lowered / maintenance cost saved);\n" +
        "  - Effort estimate (S/M/L).\n" +
        "4) Rank by 'benefit / risk / effort', putting 'high-benefit + low-risk + small-effort' first.\n" +
        "Cite real locations from the context; do not fabricate paths.",
    },
    sectionKeys: ["coverage", "hotspots", "deadCode", "clones", "review", "commentHealth"],
  },
  {
    // 正向「需求采集对照」：把客户登记的需求基线（requirements-spec）与代码反推的
    // 公开语义面（requirements）逐条比对、标出缺口。注意 requirements-spec 落在独立包
    // `<scopeId>:requirements-spec` 里，而本预设挂在扫描供给者上（启动提示只指向扫描包），
    // 故在指令里显式让 Agent 用推导出的 pack_id 去取客户基线，保证「想做」一侧真正送达。
    key: "requirements-capture",
    title: { "zh-CN": "需求采集对照", "en-US": "Requirements Capture & Reconcile" },
    description: {
      "zh-CN":
        "将客户登记的需求基线与代码反推的公开语义面逐条对照，标出「客户要求但代码未见对应入口/公开契约/模块」的需求缺口，并给出落地建议。严格区分事实与推断。",
      "en-US":
        "Reconcile the customer-stated requirements baseline against the code-reverse-engineered public surface; flag gaps where a stated need has no corresponding entry point / public contract / module, and suggest how to close them. Strictly separate fact from inference.",
    },
    prompt: {
      "zh-CN":
        "你是一名需求工程顾问。请基于提供的「项目扫描上下文」，把**客户登记的需求基线**与**代码实际承诺的语义面**逐条对照：\n" +
        "1) 取客户基线：本次分析的 scope 即 scan 包 id 中 `:` 之前的部分（记为 `<scopeId>`）。客户基线存于独立包 `<scopeId>:requirements-spec`，用 `project_context(action=\"section\", pack_id=\"<scopeId>:requirements-spec\", section_keys=[\"requirements-spec\"])` 取回全文；若客户尚未登记基线，先说明「暂无需求基线，请先在右侧面板需求分析模式保存」，再基于 `requirements` 反推。\n" +
        "2) 读 `requirements`（公开契约 / 入口点 / 模块职责）判断每条**功能需求**是否已有对应的入口、公开 API 或模块支撑。\n" +
        "3) 输出：\n" +
        "  a) **已覆盖**：客户要求 X → 代码落在 `path:line`（附证据）；\n" +
        "  b) **缺口**：客户要求 Y，但 `requirements` 里未见对应入口/契约（注明「尚未实现」还是「可能藏在未命名模块，需进一步核实」）；\n" +
        "  c) **溢出**：代码提供了客户未提及的能力（隐性需求或过度设计）；\n" +
        "  d) **落地建议**：对缺口给出最小可行落地路径（指向真实文件:行号）。\n" +
        "所有结论必须基于上下文事实，需要细节时用工具按需取，不得臆测；事实与推断一律分开标注。",
      "en-US":
        "You are a requirements-engineering consultant. Reconcile the **customer-stated requirements baseline** against the **code's actual promised surface**:\n" +
        "1) Fetch the baseline: the scope of this analysis is the part before `:` in the scan pack id (call it `<scopeId>`). The customer baseline lives in a separate pack `<scopeId>:requirements-spec`; retrieve it with `project_context(action=\"section\", pack_id=\"<scopeId>:requirements-spec\", section_keys=[\"requirements-spec\"])`. If no baseline is registered, state 'no requirements baseline yet — save one in the Requirements panel first', then reason from `requirements` alone.\n" +
        "2) Read `requirements` (public contracts / entry points / module responsibilities) to judge whether each **functional requirement** has a supporting entry point, public API or module.\n" +
        "3) Output:\n" +
        "  a) **Covered**: customer asks X → code lands at `path:line` (with evidence);\n" +
        "  b) **Gap**: customer asks Y but no corresponding entry/contract appears in `requirements` (state 'not implemented' or 'may hide in an unnamed module, needs verification');\n" +
        "  c) **Overflow**: capabilities the code provides that the customer didn't mention (latent need or over-engineering);\n" +
        "  d) **Next step**: minimal viable path to close each gap (point to real file:line).\n" +
        "Ground every conclusion in context facts; fetch details on demand; never speculate; separate fact from inference.",
    },
    sectionKeys: ["requirements"],
    group: "requirements",
  },
];

const scanContextProvider: AiContextProvider = {
  moduleId: "project-scan",
  label: "项目扫描",
  description:
    "将 14 阶段项目扫描产物（文件/依赖/架构/代码结构/符号引用/调用图/数据流/度量/技术债/重复/热点/变更耦合/死代码/审查）压缩为 AI 友好的分节上下文：每节带结论摘要、Top-N 明细（含文件:行号）、结构化 facts，并支持按 token 预算裁剪，供 Agent 按需取用以节省 token。",
  isAvailable: (scopeId) => {
    const s = useProjectStore.getState();
    return s.activeAnalysisId === scopeId && s.files.some((f) => !f.isDirectory);
  },
  buildPack: (scopeId, options) => {
    const snap = snapshotFromStore(scopeId);
    if (!snap) return null;

    // 按需只构建指定分节（Task #6 工具按 sectionKeys 取时走这条）
    const defs = options?.sectionKeys?.length
      ? SECTION_DEFS.filter((d) => options.sectionKeys!.includes(d.key))
      : SECTION_DEFS;

    // 先做覆盖度体检，再给每个分节贴上可信度。
    // 顺序很关键：可信度必须在装箱之前贴好——盲区分节的正文会因此多出一行警示，
    // 而 token 预算要按「加了警示之后」的真实体积来装，否则预算会算漏。
    const quality = sectionQualityMap(buildStageCoverage(snap));
    const sections = defs.map((d) => applyQuality(d.build(snap, scopeId), quality[d.key]));

    const { sections: packed, truncatedSections, tokenEstimate } = packWithinBudget(
      sections,
      options?.tokenBudget,
    );

    // 打戳必须在装箱**之后**：预算裁剪会把正文降级为摘要，指纹要描述
    // 「最终落库的内容」，否则换一个 token 预算重建时内容变了指纹却没变，
    // 增量写库会跳过它，库里就留下与指纹不符的陈旧正文。
    const now = options?.now ?? Date.now();
    const { sections: stamped, changed, unchanged } = stampSections(
      packed,
      options?.previousSections,
      now,
    );

    // 包级指纹由各分节指纹组合：与分节口径天然一致，
    // 不会出现「某节变了但包指纹没变」这种让增量彻底失效的错位。
    const digest = packDigestFromSections(scopeId, AI_CONTEXT_SCHEMA_VERSION, stamped);

    const pack: AiContextPack = {
      moduleId: "project-scan",
      scopeId,
      scopeLabel: deriveScopeLabel(scopeId),
      schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
      generatedAt: now,
      sections: stamped,
      tokenEstimate,
      digest,
      truncatedSections,
      changedSections: changed,
      unchangedSections: unchanged,
    };
    return pack;
  },
  /**
   * 只做阶段计数与判定，不拼正文——UI 可以放心在每次渲染里调用。
   * 人在点「开始深度分析」之前就该看到这次扫描的盲区在哪，
   * 否则 Agent 说「架构健康」时，人没有任何依据去质疑它。
   */
  describeQuality: (scopeId) => {
    const snap = snapshotFromStore(scopeId);
    if (!snap) return null;
    const stages = buildStageCoverage(snap);
    return {
      moduleId: "project-scan",
      scopeId,
      overall: worstStatus(stages.map((st) => st.quality)),
      dimensions: stages.map((st) => ({
        key: st.key,
        label: t(st.labelKey),
        observed: st.observed,
        quality: st.quality,
      })),
    };
  },
  /**
   * 只算「该从哪下手」的多维共振榜，不拼正文——UI 可以放心在每次渲染调用。
   * 与 describeQuality 同构：复用 computeRiskCorrelation 的全量交叉，让人在发起分析之前
   * 就看到扫描给出的头号重构目标（与 AI 看到的 riskMatrix 同源同口径）。
   */
  describeFocus: (scopeId) => {
    const snap = snapshotFromStore(scopeId);
    if (!snap) return null;
    return buildScanFocusReport(snap, scopeId, deriveScopeLabel(scopeId));
  },
  /**
   * 只报「此刻各项指标是多少、哪些维度没看到」，不做任何比较——
   * 比较是 metricTrend 的活，写在这里就等于把通用逻辑复制进模块，
   * 下一个接入的模块又得抄一遍。
   */
  collectMetrics: (scopeId) => {
    const snap = snapshotFromStore(scopeId);
    if (!snap) return null;
    return collectScanMetrics(snap, scopeId);
  },
  /**
   * 只报「此刻这张文件风险榜长什么样」，不做任何比对——
   * 比对、可比性、方向判定全在模块无关的 entityRegression 层。
   *
   * previousIds 是上一张榜的文件路径，模块唯一要多答的一件事是「它们现在还在不在」，
   * 因为只有扫描知道自己的实体宇宙就是当前 files 表。
   */
  collectEntitySnapshot: (scopeId, previousIds) => {
    const snap = snapshotFromStore(scopeId);
    if (!snap) return null;
    return collectScanEntities(snap, scopeId, previousIds);
  },
  presets: scanAnalysisPresets.map((p) => ({
    ...p,
    group: REQUIREMENTS_PRESET_KEYS.includes(p.key) ? "requirements" : "diagnose",
  })),
};

aiContextRegistry.register(scanContextProvider);

export { scanContextProvider };
export default scanContextProvider;
