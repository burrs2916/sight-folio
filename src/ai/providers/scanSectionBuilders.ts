import type { AiContextSection } from "../contextTypes";
import {
  cell,
  countBy,
  formatCounts,
  makeSection,
  mdTable,
  type ScanSnapshot,
} from "./scanSections";
import { getLang, t } from "../../i18n";
import { H, L } from "../aiLang";
// P2 对照块：单向读 requirements 模块的需求基线（无环：requirementsStore 不反向依赖 scan）。
import { useRequirementsStore } from "../../store/requirementsStore";

const TOP_N = 15;
const TOP_N_SMALL = 10;

/** 扫描上下文各分节标题：跟随 UI 语言（中文 / 英文），让 Agent 读到的是本地化标题 */
const SECTION_TITLES: Record<string, { "zh-CN": string; "en-US": string }> = {
  overview: { "zh-CN": "项目概览", "en-US": "Project Overview" },
  architecture: { "zh-CN": "架构与依赖", "en-US": "Architecture & Dependencies" },
  hotspots: { "zh-CN": "复杂度与变更热点", "en-US": "Complexity & Churn Hotspots" },
  review: { "zh-CN": "静态审查发现", "en-US": "Static Review Findings" },
  coupling: { "zh-CN": "变更耦合（隐性架构耦合）", "en-US": "Change Coupling (hidden architecture coupling)" },
  techDebt: { "zh-CN": "技术债标记", "en-US": "Tech Debt Markers" },
  clones: { "zh-CN": "重复代码", "en-US": "Duplicated Code" },
  deadCode: { "zh-CN": "死代码候选", "en-US": "Dead Code Candidates" },
  callGraph: { "zh-CN": "调用图", "en-US": "Call Graph" },
  dataFlow: { "zh-CN": "数据流与影响链", "en-US": "Data Flow & Impact" },
  patterns: { "zh-CN": "设计模式", "en-US": "Design Patterns" },
  symbols: { "zh-CN": "符号索引", "en-US": "Symbol Index" },
  commentHealth: { "zh-CN": "注释卫生", "en-US": "Comment Health" },
  requirements: { "zh-CN": "需求语义（入口·契约·职责）", "en-US": "Requirement Semantics (entry · contract · duty)" },
};
function sectionTitle(key: keyof typeof SECTION_TITLES): string {
  return SECTION_TITLES[key][getLang()];
}
/** 扫描上下文分节内联说明：跟随 UI 语言 */
function scanHint(key: "symbolLookup"): string {
  return t(`ai.scanHint.${key}`);
}

/** 14 个扫描阶段的中文 / 英文名称（用于概览分节，跟随 UI 语言） */
const DIMENSIONS: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": "文件枚举 / 依赖检测 / 规则审查 / 代码结构 / 符号引用 / 调用图 / 数据流 / 文件度量 / 技术债 / 重复代码 / Git 热点 / 变更耦合 / 死代码 / 全文索引",
  "en-US":
    "File enumeration / Dependency detection / Rule review / Code structure / Symbol references / Call graph / Data flow / File metrics / Tech debt / Duplicated code / Git hotspots / Change coupling / Dead code / Full-text index",
};

/** 1. 项目概览 —— 规模、语言构成、分析覆盖度 */
export function buildOverviewSection(s: ScanSnapshot): AiContextSection {
  const codeFiles = s.files.filter((f) => !f.isDirectory);
  const totalLines = codeFiles.reduce((sum, f) => sum + (f.lineCount || 0), 0);
  const byLang = countBy(codeFiles, (f) => f.language);
  const langEntries = Object.entries(byLang).sort((a, b) => b[1] - a[1]);
  const severity = countBy(s.findings, (f) => f.severity);
  const dirs = s.files.length - codeFiles.length;

  const lines = [
    L(
      `- 文件 ${codeFiles.length} 个，代码行 ${totalLines.toLocaleString("en-US")} 行，目录 ${dirs} 个`,
      `- ${codeFiles.length} files, ${totalLines.toLocaleString("en-US")} lines of code, ${dirs} directories`,
    ),
    L(`- 语言构成：${formatCounts(byLang)}`, `- Languages: ${formatCounts(byLang)}`),
    L(
      `- 语义模块 ${s.modules.length} 个 · 架构分层 ${s.layers.length} 层 · 依赖边 ${s.dependencies.length} 条`,
      `- Semantic modules: ${s.modules.length} · Architecture layers: ${s.layers.length} · Dependency edges: ${s.dependencies.length}`,
    ),
    L(
      `- 符号 ${s.symbols.length} 个 · 调用边 ${s.callEdges.length} 条 · 审查发现 ${s.findings.length} 条（${formatCounts(severity)}）`,
      `- Symbols: ${s.symbols.length} · Call edges: ${s.callEdges.length} · Review findings: ${s.findings.length} (${formatCounts(severity)})`,
    ),
    L(
      `- 技术债标记 ${s.techDebt.length} · 重复片段 ${s.clones.length} · 死代码候选 ${s.deadSymbols.length} · 变更耦合对 ${s.changeCoupling.length}`,
      `- Tech-debt markers: ${s.techDebt.length} · Duplicated fragments: ${s.clones.length} · Dead-code candidates: ${s.deadSymbols.length} · Change-coupling pairs: ${s.changeCoupling.length}`,
    ),
    "",
    L("**分析维度**：" + DIMENSIONS[getLang()], "**Analysis dimensions**: " + DIMENSIONS[getLang()]),
    "",
    L(
      "> 上述维度**并非在每个项目上都成立**（语言不支持、无 Git 历史、阶段未执行都会造成盲区）。",
      "> The above dimensions are **not all applicable to every project** (unsupported language, no Git history, or unexecuted stages all create blind spots).",
    ),
    L(
      "> 下结论前请先读 `coverage` 分节：那里逐阶段标明了哪些数据可信、哪些是盲区、哪些结论明确不能下。",
      "> Before drawing conclusions, read the `coverage` section first: it marks stage-by-stage which data is trustworthy, which is a blind spot, and which conclusions must not be drawn.",
    ),
  ];

  return makeSection(
    "overview",
    sectionTitle("overview"),
    0,
    L(
      `${codeFiles.length} 个文件 / ${totalLines.toLocaleString("en-US")} 行，主要语言 ${langEntries[0]?.[0] ?? "未知"}`,
      `${codeFiles.length} files / ${totalLines.toLocaleString("en-US")} lines, main language ${langEntries[0]?.[0] ?? "unknown"}`,
    ),
    lines,
    {
      fileCount: codeFiles.length,
      totalLines,
      languages: byLang,
      moduleCount: s.modules.length,
      layerCount: s.layers.length,
      dependencyCount: s.dependencies.length,
      symbolCount: s.symbols.length,
      findingCount: s.findings.length,
      findingsBySeverity: severity,
    },
  );
}

/** 2. 架构：模块、分层、依赖方向与循环 */
export function buildArchitectureSection(s: ScanSnapshot): AiContextSection {
  const circular = s.dependencies.filter((d) => d.isCircular);
  const byKind = countBy(s.dependencies, (d) => d.kind);

  const layerRows = [...s.layers]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => {
      const fileCount = s.files.filter((f) => f.layerId === l.id).length;
      const moduleCount = s.modules.filter((m) => m.layerId === l.id).length;
      return [l.name, String(l.sortOrder), String(moduleCount), String(fileCount), cell(l.description, 40)];
    });

  const moduleRows = [...s.modules]
    .sort((a, b) => b.depCount + b.beDepCount - (a.depCount + a.beDepCount))
    .slice(0, TOP_N)
    .map((m) => [
      m.name,
      s.layers.find((l) => l.id === m.layerId)?.name ?? "-",
      String(m.fileCount),
      String(m.depCount),
      String(m.beDepCount),
    ]);

  // 循环依赖按「参与文件」聚合，避免同一个环被逐边重复列出
  const cycleFiles = new Map<string, number>();
  for (const d of circular) {
    const from = s.files.find((f) => f.id === d.fromId)?.relPath ?? d.fromId;
    cycleFiles.set(from, (cycleFiles.get(from) ?? 0) + 1);
  }
  const cycleRows = [...cycleFiles.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_SMALL)
    .map(([path, count]) => [cell(path, 70), String(count)]);

  const lines = [
    L(
      `依赖 ${s.dependencies.length} 条（${formatCounts(byKind)}），其中循环依赖 ${circular.length} 条。`,
      `Dependencies: ${s.dependencies.length} (${formatCounts(byKind)}), of which ${circular.length} are circular.`,
    ),
    "",
    L("**架构分层**", "**Architecture layers**"),
    ...mdTable(H(["分层", "序", "模块数", "文件数", "说明"], ["Layer", "Order", "Modules", "Files", "Description"]), layerRows),
    "",
    L(`**耦合最重的模块（Top ${moduleRows.length}）**`, `**Most tightly coupled modules (Top ${moduleRows.length})**`),
    ...mdTable(
      H(["模块", "所属层", "文件数", "出度", "入度"], ["Module", "Layer", "Files", "Out-deg", "In-deg"]),
      moduleRows,
    ),
    "",
    // 「0 条依赖边」与「有依赖边但无环」是两回事：前者多半是解析器缺位（盲区），
    // 说成「依赖方向健康」就是把盲区包装成结论，Agent 会照单全收。
    circular.length
      ? L(`**循环依赖参与文件（Top ${cycleRows.length}）**`, `**Files participating in circular dependencies (Top ${cycleRows.length})**`)
      : s.dependencies.length > 0
        ? L(
            "**无循环依赖** —— 在已检出的依赖边范围内，依赖方向健康。",
            "**No circular dependencies** — within the detected dependency edges, the dependency direction is healthy.",
          )
        : L(
            "**未检出任何依赖边** —— 这不等于「没有耦合」，先看 `coverage` 分节确认依赖分析是否可用。",
            "**No dependency edges detected** — this does NOT mean \"no coupling\"; read the `coverage` section first to confirm dependency analysis is available.",
          ),
    ...(circular.length ? mdTable(H(["文件", "参与环边数"], ["File", "Cycles"]), cycleRows) : []),
  ];

  return makeSection(
    "architecture",
    sectionTitle("architecture"),
    1,
    L(
      `${s.layers.length} 层 / ${s.modules.length} 模块 / ${s.dependencies.length} 依赖边，循环依赖 ${circular.length} 条`,
      `${s.layers.length} layers / ${s.modules.length} modules / ${s.dependencies.length} dependency edges, ${circular.length} circular`,
    ),
    lines,
    {
      layers: s.layers.map((l) => ({ name: l.name, sortOrder: l.sortOrder })),
      dependencyKinds: byKind,
      circularCount: circular.length,
    },
  );
}

/**
 * 3. 风险热点 —— 复杂度 × 变更频率的交叉排序。
 * 单看复杂度会把「复杂但稳定」的老代码排在前面（改它性价比最低）；
 * 单看 churn 会把配置文件排上来。两者相乘才是真正该重构的地方。
 */
export function buildHotspotSection(s: ScanSnapshot): AiContextSection {
  const churnByPath = new Map(s.gitChurn.map((g) => [g.filePath, g]));

  const scored = s.metrics
    .map((m) => {
      const churn = churnByPath.get(m.filePath);
      const commits = churn?.commitCount ?? 0;
      // 复杂度取「单函数最高 CC」优先（比文件总 CC 更能指认难维护点），回退到文件 CC
      const complexity = m.maxFunctionCc > 0 ? m.maxFunctionCc : m.cyclomaticComplexity;
      // log 抑制提交数长尾，避免一个高频小文件霸榜
      const risk = complexity * Math.log2(commits + 2);
      return { m, churn, complexity, commits, risk };
    })
    .sort((a, b) => b.risk - a.risk)
    .slice(0, TOP_N);

  const rows = scored.map(({ m, complexity, commits }) => [
    cell(m.filePath, 60),
    String(m.codeLines),
    String(complexity),
    m.complexityLevel,
    String(m.maxNesting || "-"),
    m.hotFunction ? cell(m.hotFunction, 24) : "-",
    commits ? String(commits) : "-",
    m.engine,
  ]);

  const levels = countBy(s.metrics, (m) => m.complexityLevel);
  const astCount = s.metrics.filter((m) => m.engine === "ast").length;

  const lines = [
    L(
      `度量文件 ${s.metrics.length} 个（AST 精确 ${astCount} / 启发式估算 ${s.metrics.length - astCount}），复杂度分布：${formatCounts(levels)}。`,
      `Measured files: ${s.metrics.length} (AST-precise ${astCount} / heuristic estimate ${s.metrics.length - astCount}); complexity distribution: ${formatCounts(levels)}.`,
    ),
    "",
    L(
      `**重构优先级 Top ${rows.length}**（排序 = 复杂度 × log2(提交数+2)，兼顾「难改」与「常改」）`,
      `**Refactor priority Top ${rows.length}** (rank = complexity × log2(commits+2), balancing "hard to change" with "often changed")`,
    ),
    ...mdTable(
      H(
        ["文件", "代码行", "复杂度", "等级", "最大嵌套", "最复杂函数", "提交数", "引擎"],
        ["File", "Code lines", "Complexity", "Level", "Max nesting", "Hottest fn", "Commits", "Engine"],
      ),
      rows,
    ),
    "",
    L(
      "> `引擎=heuristic` 表示该语言暂无 AST 解析，复杂度为行级关键字估算，判断时请打折。",
      "> `engine=heuristic` means the language has no AST parser yet; complexity is a line-level keyword estimate, so discount it when judging.",
    ),
  ];

  return makeSection(
    "hotspots",
    sectionTitle("hotspots"),
    2,
    L(
      `${s.metrics.length} 个文件已度量，最高风险：${scored[0] ? cell(scored[0].m.filePath, 50) : "无"}`,
      `${s.metrics.length} files measured, highest risk: ${scored[0] ? cell(scored[0].m.filePath, 50) : "none"}`,
    ),
    lines,
    {
      complexityLevels: levels,
      topRisks: scored.slice(0, TOP_N_SMALL).map(({ m, complexity, commits }) => ({
        filePath: m.filePath,
        codeLines: m.codeLines,
        complexity,
        commits,
        hotFunction: m.hotFunction || null,
      })),
    },
  );
}

/** 4. 审查发现：按规则与严重度聚合 + 高危样例 */
export function buildReviewSection(s: ScanSnapshot): AiContextSection {
  const bySeverity = countBy(s.findings, (f) => f.severity);
  const byRule = countBy(s.findings, (f) => f.ruleId ?? "unknown");

  const pathOf = (targetId: string) =>
    s.files.find((f) => f.id === targetId)?.relPath ??
    s.symbols.find((sym) => sym.id === targetId)?.filePath ??
    targetId;

  const order: Record<string, number> = { critical: 0, error: 0, warning: 1, info: 2, hint: 3 };
  const samples = [...s.findings]
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    .slice(0, TOP_N)
    .map((f) => [
      f.severity,
      cell(pathOf(f.targetId), 50),
      cell(f.message, 70),
      cell(f.suggestion, 50) || "-",
    ]);

  const ruleRows = Object.entries(byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_SMALL)
    .map(([rule, count]) => {
      const name = s.findings.find((f) => f.ruleId === rule)?.message ?? "";
      return [cell(rule, 40), String(count), cell(name, 50)];
    });

  const lines = [
    L(`审查发现 ${s.findings.length} 条：${formatCounts(bySeverity)}。`, `Review findings: ${s.findings.length} (${formatCounts(bySeverity)}).`),
    "",
    L(`**触发最多的规则（Top ${ruleRows.length}）**`, `**Most-triggered rules (Top ${ruleRows.length})**`),
    ...mdTable(H(["规则", "命中数", "典型消息"], ["Rule", "Hits", "Typical message"]), ruleRows),
    "",
    L(`**高严重度样例（Top ${samples.length}）**`, `**High-severity samples (Top ${samples.length})**`),
    ...mdTable(H(["严重度", "位置", "问题", "建议"], ["Severity", "Location", "Issue", "Suggestion"]), samples),
  ];

  return makeSection(
    "review",
    sectionTitle("review"),
    3,
    L(`${s.findings.length} 条发现（${formatCounts(bySeverity, 4)}）`, `${s.findings.length} findings (${formatCounts(bySeverity, 4)})`),
    lines,
    { bySeverity, byRule },
  );
}

/** 5. 变更耦合：版本历史里「总是一起改」的文件对，隐性架构耦合的直接证据 */
export function buildCouplingSection(s: ScanSnapshot): AiContextSection {
  const hidden = s.changeCoupling.filter((c) => c.couplingKind === "hidden");
  const rows = [...s.changeCoupling]
    .sort((a, b) => b.degree - a.degree || b.coChanges - a.coChanges)
    .slice(0, TOP_N)
    .map((c) => [
      cell(c.fileAPath, 42),
      cell(c.fileBPath, 42),
      String(c.coChanges),
      c.degree.toFixed(2),
      c.jaccard.toFixed(2),
      c.couplingKind === "hidden" ? L("隐性", "Hidden") : L("结构", "Structural"),
      c.crossModule ? L("跨模块", "Cross-module") : L("同模块", "Intra-module"),
      c.riskLevel,
    ]);

  const lines = [
    L(
      `变更耦合对 ${s.changeCoupling.length} 组，其中**隐性耦合 ${hidden.length} 组**（总是一起改但没有静态依赖）。`,
      `Change-coupling pairs: ${s.changeCoupling.length}, of which **${hidden.length} are hidden coupling** (always changed together but with no static dependency).`,
    ),
    "",
    L(`**耦合度 Top ${rows.length}**`, `**Coupling degree Top ${rows.length}**`),
    ...mdTable(
      H(
        ["文件 A", "文件 B", "共改次数", "耦合度", "Jaccard", "类型", "跨度", "风险"],
        ["File A", "File B", "Co-changes", "Coupling", "Jaccard", "Type", "Span", "Risk"],
      ),
      rows,
    ),
    "",
    L(
      "> 隐性 + 跨模块 = 最值得关注：说明模块边界没兜住真实的变更单元，通常是接口抽象缺失或职责放错了位置。",
      "> Hidden + cross-module = most worth attention: it means the module boundary doesn't contain the real unit of change, usually a missing interface abstraction or misplaced responsibility.",
    ),
  ];

  return makeSection(
    "coupling",
    sectionTitle("coupling"),
    4,
    L(`${s.changeCoupling.length} 组耦合，隐性 ${hidden.length} 组`, `${s.changeCoupling.length} pairs, ${hidden.length} hidden`),
    lines,
    {
      total: s.changeCoupling.length,
      hidden: hidden.length,
      crossModuleHidden: hidden.filter((c) => c.crossModule).length,
    },
  );
}

/** 6. 技术债标记 */
export function buildTechDebtSection(s: ScanSnapshot): AiContextSection {
  const byMarker = countBy(s.techDebt, (t) => t.marker);
  const bySeverity = countBy(s.techDebt, (t) => t.severity);
  const byFile = countBy(s.techDebt, (t) => t.filePath);

  const fileRows = Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_SMALL)
    .map(([path, count]) => [cell(path, 65), String(count)]);

  const critical = s.techDebt
    .filter((t) => t.severity === "critical")
    .slice(0, TOP_N_SMALL)
    .map((t) => [`${cell(t.filePath, 45)}:${t.lineNo}`, t.marker, cell(t.snippet, 70)]);

  const lines = [
    L(
      `技术债标记 ${s.techDebt.length} 处：${formatCounts(byMarker)}（严重度 ${formatCounts(bySeverity)}）。`,
      `Tech-debt markers: ${s.techDebt.length} (${formatCounts(byMarker)}; severity ${formatCounts(bySeverity)}).`,
    ),
    "",
    L(`**标记最密集的文件（Top ${fileRows.length}）**`, `**Most marker-dense files (Top ${fileRows.length})**`),
    ...mdTable(H(["文件", "标记数"], ["File", "Markers"]), fileRows),
    "",
    critical.length
      ? L(`**critical 级标记（Top ${critical.length}）**`, `**critical-level markers (Top ${critical.length})**`)
      : L("**无 critical 级标记。**", "**No critical-level markers.**"),
    ...(critical.length ? mdTable(H(["位置", "类型", "原文"], ["Location", "Type", "Snippet"]), critical) : []),
  ];

  return makeSection(
    "techDebt",
    sectionTitle("techDebt"),
    5,
    L(`${s.techDebt.length} 处标记（${formatCounts(byMarker, 4)}）`, `${s.techDebt.length} markers (${formatCounts(byMarker, 4)})`),
    lines,
    { byMarker, bySeverity },
  );
}

/** 7. 重复代码 */
export function buildCloneSection(s: ScanSnapshot): AiContextSection {
  const groups = new Map<string, typeof s.clones>();
  for (const c of s.clones) {
    const list = groups.get(c.groupId) ?? [];
    list.push(c);
    groups.set(c.groupId, list);
  }

  const dupLines = s.clones.reduce((sum, c) => sum + c.lineCount, 0);
  const byType = countBy(s.clones, (c) => c.cloneType);

  const rows = [...groups.entries()]
    .sort((a, b) => b[1][0].lineCount * b[1].length - a[1][0].lineCount * a[1].length)
    .slice(0, TOP_N_SMALL)
    .map(([, instances]) => {
      const first = instances[0];
      const where = instances
        .slice(0, 3)
        .map((i) => `${cell(i.filePath, 34)}:${i.startLine}`)
        .join("<br/>");
      return [
        String(instances.length),
        String(first.lineCount),
        first.cloneType === "type2" ? L("参数化", "Parametric") : L("逐字", "Verbatim"),
        first.language,
        where + (instances.length > 3 ? `<br/>${L(`另 ${instances.length - 3} 处`, `plus ${instances.length - 3} more`)}` : ""),
        cell(first.snippet, 50),
      ];
    });

  const lines = [
    L(
      `重复片段 ${s.clones.length} 处，归为 ${groups.size} 个克隆组，涉及重复代码约 ${dupLines} 行（${formatCounts(byType)}）。`,
      `Duplicated fragments: ${s.clones.length}, grouped into ${groups.size} clone groups, about ${dupLines} duplicated lines (${formatCounts(byType)}).`,
    ),
    "",
    L(
      `**收益最高的克隆组（Top ${rows.length}，按 行数 × 实例数 排序）**`,
      `**Highest-payoff clone groups (Top ${rows.length}, ranked by lines × instances)**`,
    ),
    ...mdTable(
      H(["实例数", "行数", "类型", "语言", "位置", "首行"], ["Instances", "Lines", "Type", "Lang", "Location", "First line"]),
      rows,
    ),
  ];

  return makeSection(
    "clones",
    sectionTitle("clones"),
    6,
    L(`${groups.size} 个克隆组 / ${s.clones.length} 处实例 / 约 ${dupLines} 行`, `${groups.size} clone groups / ${s.clones.length} instances / ~${dupLines} lines`),
    lines,
    { groupCount: groups.size, instanceCount: s.clones.length, duplicatedLines: dupLines, byType },
  );
}

/** 8. 死代码候选 */
export function buildDeadCodeSection(s: ScanSnapshot): AiContextSection {
  const byConfidence = countBy(s.deadSymbols, (d) => d.confidence);
  const byKind = countBy(s.deadSymbols, (d) => d.kind);

  const rows = [...s.deadSymbols]
    .sort((a, b) => {
      const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9);
    })
    .slice(0, TOP_N)
    .map((d) => [
      cell(d.name, 30),
      d.kind,
      d.visibility,
      d.confidence,
      `${cell(d.filePath, 45)}:${d.lineStart}`,
      cell(d.reason, 40),
    ]);

  const lines = [
    L(
      `零引用符号 ${s.deadSymbols.length} 个（置信度 ${formatCounts(byConfidence)}；类型 ${formatCounts(byKind)}）。`,
      `Zero-reference symbols: ${s.deadSymbols.length} (confidence ${formatCounts(byConfidence)}; kind ${formatCounts(byKind)}).`,
    ),
    "",
    L(`**清理候选（Top ${rows.length}，高置信度优先）**`, `**Cleanup candidates (Top ${rows.length}, high confidence first)**`),
    ...mdTable(
      H(["符号", "类型", "可见性", "置信度", "位置", "判定依据"], ["Symbol", "Kind", "Visibility", "Confidence", "Location", "Basis"]),
      rows,
    ),
    "",
    L(
      "> `visibility=exported` 的符号可能被外部消费方引用，删除前需确认对外契约；`internal` 的可直接清理。",
      "> Symbols with `visibility=exported` may be referenced by external consumers — confirm the public contract before deleting; `internal` ones can be cleaned up directly.",
    ),
  ];

  return makeSection(
    "deadCode",
    sectionTitle("deadCode"),
    7,
    L(`${s.deadSymbols.length} 个零引用符号（高置信 ${byConfidence.high ?? 0} 个）`, `${s.deadSymbols.length} zero-reference symbols (${byConfidence.high ?? 0} high-confidence)`),
    lines,
    { total: s.deadSymbols.length, byConfidence, byKind },
  );
}

/** 9. 调用图：影响面推理的骨架（数据流已独立成节，见 dataFlow） */
export function buildCallGraphSection(s: ScanSnapshot): AiContextSection {
  const cg = s.callGraphSummary;

  const callerRows = (cg?.topCallers ?? [])
    .slice(0, TOP_N_SMALL)
    .map((h) => [cell(h.name, 34), cell(h.filePath, 45), String(h.count)]);
  const calleeRows = (cg?.topCallees ?? [])
    .slice(0, TOP_N_SMALL)
    .map((h) => [cell(h.name, 34), cell(h.filePath, 45), String(h.count)]);

  const lines = [
    L(
      cg
        ? `调用边 ${cg.totalEdges} 条（跨文件 ${cg.crossFileEdges} 条），涉及函数 ${cg.functions} 个。`
        : "调用图未生成。",
      cg
        ? `Call edges: ${cg.totalEdges} (cross-file ${cg.crossFileEdges}), covering ${cg.functions} functions.`
        : "Call graph not generated.",
    ),
    "",
    L(
      `**被调用最多的函数（枢纽，改动风险最高）Top ${calleeRows.length}**`,
      `**Most-called functions (hubs, highest change risk) Top ${calleeRows.length}**`,
    ),
    ...mdTable(H(["函数", "文件", "被调次数"], ["Function", "File", "Calls"]), calleeRows),
    "",
    L(
      `**调用他人最多的函数（编排者）Top ${callerRows.length}**`,
      `**Functions calling others most (orchestrators) Top ${callerRows.length}**`,
    ),
    ...mdTable(H(["函数", "文件", "调用次数"], ["Function", "File", "Invokes"]), callerRows),
    "",
    L(
      "> 枢纽函数被调次数越高，改动的爆炸半径越大；要精确评估某次改动的影响面，用 impact_assess 工具。",
      "> The more a hub function is called, the larger the blast radius of a change; use the impact_assess tool to precisely assess the impact of a change.",
    ),
    L(
      "> 污染是否会越过某个函数继续外溢，见「数据流」分节（dataFlow）。",
      "> Whether contamination spreads past a function, see the \"Data Flow\" section (dataFlow).",
    ),
  ];

  return makeSection(
    "callGraph",
    sectionTitle("callGraph"),
    8,
    L(cg ? `${cg.totalEdges} 条调用边 / ${cg.functions} 个函数` : "调用图未生成", cg ? `${cg.totalEdges} call edges / ${cg.functions} functions` : "Call graph not generated"),
    lines,
    {
      totalEdges: cg?.totalEdges ?? 0,
      crossFileEdges: cg?.crossFileEdges ?? 0,
      functions: cg?.functions ?? 0,
    },
  );
}

/**
 * 12. 数据流（def-use / 影响链 / 透传污染）。
 *
 * 为什么独立成节：数据流是 14 阶段扫描里少数能回答「改这里会波及到哪」的能力，
 * 此前它只是 callGraph 分节里的一行摘要，Agent 既取不到 sink 明细，也无法单独按需加载。
 * 独立后：① 影响面类问题可只取本节，省掉整张调用图的 token；② 结构化 facts 里带上
 * 透传比例，Agent 不必从自然语言回读数字。
 */
export function buildDataFlowSection(s: ScanSnapshot): AiContextSection {
  const df = s.dataFlowSummary;

  if (!df) {
    return makeSection(
      "dataFlow",
      sectionTitle("dataFlow"),
      8,
      L("数据流未分析（该语言暂不支持或阶段未执行）", "Data flow not analyzed (language unsupported or stage not executed)"),
      [
        L("数据流阶段未产出结果。", "The data-flow stage produced no result."),
        "",
        L(
          "> 数据流分析目前覆盖 TypeScript / JavaScript / Rust / Python；其他语言的项目本节为空属正常。",
          "> Data-flow analysis currently covers TypeScript / JavaScript / Rust / Python; for projects in other languages this section being empty is normal.",
        ),
        L(
          "> 影响面评估可退化为使用调用图（callGraph 分节）与 impact_assess 工具。",
          "> Impact assessment can fall back to the call graph (callGraph section) and the impact_assess tool.",
        ),
      ],
      { analyzed: false },
    );
  }

  // 透传比例：越高说明污染越容易穿透整个系统，改动的爆炸半径越难收敛
  const propagateRatio = df.functions > 0 ? df.propagating / df.functions : 0;
  const sinkRows = (df.topSinks ?? [])
    .slice(0, TOP_N_SMALL)
    .map((h) => [
      cell(h.functionName, 34),
      `${cell(h.filePath, 45)}:${h.lineNo}`,
      String(h.count),
      cell(h.detail, 50),
    ]);

  const lines = [
    L(
      `数据流分析覆盖 ${df.analyzedFiles} 个文件 / ${df.functions} 个函数，追踪参数流 ${df.paramFlows} 条。`,
      `Data-flow analysis covers ${df.analyzedFiles} files / ${df.functions} functions, tracking ${df.paramFlows} parameter flows.`,
    ),
    L(
      `其中**透传函数 ${df.propagating} 个（${(propagateRatio * 100).toFixed(1)}%）· 阻断函数 ${df.blocking} 个**，` +
        `写外部状态（sink）的函数 ${df.sinkFunctions} 个。`,
      `Of these **${df.propagating} propagating functions (${(propagateRatio * 100).toFixed(1)}%) · ${df.blocking} blocking functions**, ` +
        `${df.sinkFunctions} functions write external state (sink).`,
    ),
    "",
    L(
      `**写外部状态最多的函数（副作用汇聚点）Top ${sinkRows.length}**`,
      `**Functions writing external state most (side-effect hubs) Top ${sinkRows.length}**`,
    ),
    ...mdTable(H(["函数", "位置", "写入次数", "写入目标"], ["Function", "Location", "Writes", "Write target"]), sinkRows),
    "",
    L(
      "> 「透传」= 入参会流向返回值或外部状态，污染放行；「阻断」= 污染在此终止，是影响链剪枝的边界。",
      "> \"Propagating\" = input flows to the return value or external state, letting contamination through; \"blocking\" = contamination stops here, the boundary for pruning the impact chain.",
    ),
    L(
      "> 透传比例偏高意味着改动影响难以局部化，通常提示缺少防腐层或纯函数边界。",
      "> A high propagating ratio means change impact is hard to localize, usually indicating a missing anti-corruption layer or pure-function boundary.",
    ),
    L(
      "> sink 函数是副作用集中地，既是测试重点，也是并发/一致性问题的高发区。",
      "> sink functions are where side effects concentrate — both a testing focus and a hotspot for concurrency/consistency issues.",
    ),
  ];

  return makeSection(
    "dataFlow",
    sectionTitle("dataFlow"),
    8,
    L(
      `${df.functions} 个函数：透传 ${df.propagating} / 阻断 ${df.blocking}，sink ${df.sinkFunctions}`,
      `${df.functions} functions: ${df.propagating} propagating / ${df.blocking} blocking, sink ${df.sinkFunctions}`,
    ),
    lines,
    {
      analyzed: true,
      analyzedFiles: df.analyzedFiles,
      functions: df.functions,
      propagating: df.propagating,
      blocking: df.blocking,
      propagateRatio: Number(propagateRatio.toFixed(4)),
      sinkFunctions: df.sinkFunctions,
      paramFlows: df.paramFlows,
    },
  );
}

/** 10. 设计模式命中（启发式，带置信度） */
export function buildPatternSection(s: ScanSnapshot): AiContextSection {
  const hits = s.patternHits.filter((p) => p.confidence >= 0.6);
  const byPattern = countBy(hits, (p) => p.name);
  const byCategory = countBy(hits, (p) => p.category);

  const rows = [...hits]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, TOP_N_SMALL)
    .map((p) => [
      p.name,
      p.category,
      cell(p.symbolName, 28),
      `${cell(p.filePath, 40)}:${p.line}`,
      p.confidence.toFixed(2),
      cell(p.signals.join("; "), 50),
    ]);

  const lines = [
    L(
      `设计模式命中 ${hits.length} 处（置信度 ≥ 0.6）：${formatCounts(byPattern)}；分类 ${formatCounts(byCategory)}。`,
      `Design-pattern hits: ${hits.length} (confidence ≥ 0.6): ${formatCounts(byPattern)}; categories ${formatCounts(byCategory)}.`,
    ),
    "",
    L(`**高置信命中 Top ${rows.length}**`, `**High-confidence hits Top ${rows.length}**`),
    ...mdTable(
      H(["模式", "分类", "符号", "位置", "置信度", "判定依据"], ["Pattern", "Category", "Symbol", "Location", "Confidence", "Basis"]),
      rows,
    ),
    "",
    L(
      "> 模式识别是启发式推断而非事实，判定依据已随行给出，请据此自行验证再下结论。",
      "> Pattern recognition is a heuristic inference, not a fact; the basis is given per row — please verify it yourself before drawing conclusions.",
    ),
  ];

  return makeSection(
    "patterns",
    sectionTitle("patterns"),
    9,
    L(`${hits.length} 处高置信命中`, `${hits.length} high-confidence hits`),
    lines,
    { byPattern, byCategory, total: hits.length },
  );
}

/** 11. 关键符号索引：让 Agent 知道「有哪些东西」，不必先全文搜索 */
export function buildSymbolSection(s: ScanSnapshot): AiContextSection {
  const byKind = countBy(s.symbols, (sym) => sym.kind);

  // 按文件聚合，挑符号最密集的文件列出其代表符号 —— 这是项目的骨架
  const byFile = new Map<string, typeof s.symbols>();
  for (const sym of s.symbols) {
    const list = byFile.get(sym.filePath) ?? [];
    list.push(sym);
    byFile.set(sym.filePath, list);
  }

  const rows = [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TOP_N)
    .map(([path, syms]) => {
      const names = syms
        .slice(0, 8)
        .map((x) => `${x.name}(${x.kind})`)
        .join(", ");
      return [
        cell(path, 55),
        String(syms.length),
        cell(names + (syms.length > 8 ? L(` …另 ${syms.length - 8} 个`, ` …plus ${syms.length - 8} more`) : ""), 90),
      ];
    });

  const lines = [
    L(
      `符号 ${s.symbols.length} 个，分布在 ${byFile.size} 个文件：${formatCounts(byKind)}。`,
      `Symbols: ${s.symbols.length}, across ${byFile.size} files: ${formatCounts(byKind)}.`,
    ),
    "",
    L(`**符号最密集的文件（Top ${rows.length}）**`, `**Most symbol-dense files (Top ${rows.length})**`),
    ...mdTable(H(["文件", "符号数", "代表符号"], ["File", "Symbols", "Representative"]), rows),
    "",
    scanHint("symbolLookup"),
  ];

  return makeSection(
    "symbols",
    sectionTitle("symbols"),
    10,
    L(`${s.symbols.length} 个符号 / ${byFile.size} 个文件`, `${s.symbols.length} symbols / ${byFile.size} files`),
    lines,
    { total: s.symbols.length, byKind, fileCount: byFile.size },
  );
}

/**
 * 注释卫生：注释率分布 + 低注释文件 + 公开符号无 doc + 复杂但缺注释的交叉。
 *
 * 数据全部来自既有扫描结果（metrics.commentLines / symbols.doc），零额外扫描成本。
 * 目的：让 Agent 在分析里把「注释」当成一等公民——写改进建议时能指出
 * 「哪个文件注释缺失、哪些公开 API 无文档、哪些复杂代码最该补注释」。
 * 注释缺失本身不是 bug，但与高复杂度/公开 API 叠加就是实打实的可维护性风险。
 */
export function buildCommentHealthSection(s: ScanSnapshot): AiContextSection {
  // 1) 注释率分布：按文件算 commentLines/(codeLines+commentLines)
  const ratios = s.metrics
    .filter((m) => m.codeLines + m.commentLines > 0)
    .map((m) => ({ fileId: m.fileId, filePath: m.filePath, ratio: m.commentLines / (m.codeLines + m.commentLines), cc: m.cyclomaticComplexity, complexityLevel: m.complexityLevel }));
  const totalFiles = ratios.length;
  const lowCount = ratios.filter((r) => r.ratio < 0.05).length;
  const midCount = ratios.filter((r) => r.ratio >= 0.05 && r.ratio < 0.15).length;
  const healthyCount = ratios.filter((r) => r.ratio >= 0.15).length;

  // 2) 最低注释率文件 Top（带复杂度：低注释 + 高复杂度 = 最该补注释）
  const lowRows = [...ratios]
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, TOP_N_SMALL)
    .map((r) => [
      cell(r.filePath, 50),
      `${Math.round(r.ratio * 100)}%`,
      String(r.cc),
      r.complexityLevel,
    ]);

  // 3) 公开/导出符号无 doc 的文件 Top（docsCoverage 的 AI 侧视角）
  const undocByFile = new Map<string, { total: number; undoc: number; path: string }>();
  for (const sym of s.symbols) {
    if (!/(?:export|public)/i.test(sym.modifiers || "")) continue;
    const e = undocByFile.get(sym.filePath) ?? { total: 0, undoc: 0, path: sym.filePath };
    e.total += 1;
    if (!sym.doc) e.undoc += 1;
    undocByFile.set(sym.filePath, e);
  }
  const undocRows = [...undocByFile.values()]
    .filter((e) => e.undoc > 0)
    .sort((a, b) => b.undoc - a.undoc || b.total - a.total)
    .slice(0, TOP_N_SMALL)
    .map((e) => [cell(e.path, 55), String(e.total), String(e.undoc), `${Math.round((e.undoc / e.total) * 100)}%`]);

  const undocLines: string[] = undocRows.length
    ? [
        L(`**公开/导出符号无文档的文件 Top ${undocRows.length}**（API 对外契约缺说明）`, `**Files with undocumented public/exported symbols Top ${undocRows.length}** (external API contract lacks docs)`),
        ...mdTable(H(["文件", "符号数", "无 doc", "无 doc 比例"], ["File", "Symbols", "No doc", "No-doc ratio"]), undocRows),
      ]
    : [L("**所有公开/导出符号均有文档。**", "**All public/exported symbols are documented.**")];

  const lines: string[] = [
    L(
      `注释覆盖 ${totalFiles} 个文件：健康（≥15%）${healthyCount} · 偏少（5~15%）${midCount} · 几乎无注释（<5%）${lowCount}。`,
      `Comment coverage across ${totalFiles} files: healthy (≥15%) ${healthyCount} · sparse (5–15%) ${midCount} · almost none (<5%) ${lowCount}.`,
    ),
    "",
    L(`**注释最少的文件 Top ${lowRows.length}**（注释率 / 圈复杂度 / 等级——低注释+高复杂度最该补）`, `**Lowest comment ratio Top ${lowRows.length}** (ratio / cyclomatic complexity / level — low comments + high CC needs docs most)`),
    ...mdTable(H(["文件", "注释率", "CC", "等级"], ["File", "Ratio", "CC", "Level"]), lowRows),
    "",
    ...undocLines,
  ];

  return makeSection(
    "commentHealth",
    sectionTitle("commentHealth"),
    8,
    L(`注释率 健康 ${healthyCount} / 偏少 ${midCount} / 缺失 ${lowCount}`, `Comments: healthy ${healthyCount} / sparse ${midCount} / missing ${lowCount}`),
    lines,
    { totalFiles, healthyCount, midCount, lowCount, undocFiles: undocRows.length },
  );
}

/**
 * N. 需求语义：入口点 / 公开契约 / 模块职责。
 *
 * 反推业务需求的关键一层：从「代码长什么样」推「系统该做什么」需要三类语义聚合——
 * 入口点（系统从哪启动）、公开契约（系统对外承诺什么能力）、模块职责（各模块在架构里的角色）。
 * 全部从既有扫描数据确定性聚合，零额外扫描成本。聚合属启发式（尤其入口点/公开性），
 * 故正文末尾声明「非事实，请结合符号引用与调用图自行验证」，与 patterns/commentHealth 同风格。
 */
export function buildRequirementsSection(s: ScanSnapshot, analysisId?: string): AiContextSection {
  // 1) 入口点：程序入口 main + 顶层启动/路由函数（命名惯例启发式）
  const entryPoints = s.symbols.filter(
    (sym) =>
      sym.kind === "function" &&
      /^(main|run|start|bootstrap|serve|handler|main_|app|setup)$/i.test(sym.name),
  );
  const entryRows = entryPoints
    .slice(0, TOP_N_SMALL)
    .map((sym) => [
      sym.name,
      sym.kind,
      cell(sym.filePath, 46),
      String(sym.lineStart),
      cell((sym.modifiers || "").trim() || "—", 16),
    ]);

  // 2) 公开契约：modifiers 含 export/pub/public（Go 靠首字母大写启发）
  const isPublic = (sym: (typeof s.symbols)[number]) => {
    const m = sym.modifiers || "";
    if (/(?:export|pub|public)/i.test(m)) return true;
    if (sym.filePath.endsWith(".go")) return /^[A-Z]/.test(sym.name);
    return false;
  };
  const publicSyms = s.symbols.filter(isPublic);
  const publicByKind = countBy(publicSyms, (x) => x.kind);
  const pubByFile = new Map<string, (typeof s.symbols)[number][]>();
  for (const sym of publicSyms) {
    const list = pubByFile.get(sym.filePath) ?? [];
    list.push(sym);
    pubByFile.set(sym.filePath, list);
  }
  const pubRows = [...pubByFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TOP_N)
    .map(([path, syms]) => {
      const names = syms
        .slice(0, 8)
        .map((x) => `${x.name}${x.doc ? "" : "‼"}`)
        .join(", ");
      return [
        cell(path, 50),
        String(syms.length),
        cell(
          names + (syms.length > 8 ? L(` …另 ${syms.length - 8} 个`, ` …plus ${syms.length - 8} more`) : ""),
          92,
        ),
      ];
    });

  // 3) 模块职责：按被依赖度找核心稳定层（被依赖越多=越靠近内核）
  const modules = [...s.modules].sort((a, b) => b.beDepCount - a.beDepCount);
  const modRows = modules.slice(0, TOP_N).map((mod) => [
    mod.name,
    mod.layerId ?? "—",
    String(mod.fileCount),
    String(mod.depCount),
    String(mod.beDepCount),
  ]);

  const lines: string[] = [
    L(
      `**公开契约**：${publicSyms.length} 个公开符号，分布 ${pubByFile.size} 个文件。这是系统对外承诺的能力边界；‼ 标记=公开但无文档（契约风险）。`,
      `**Public surface**: ${publicSyms.length} public symbols across ${pubByFile.size} files — the system's externally promised capability boundary; ‼ = public but undocumented (contract risk).`,
    ),
    ...mdTable(
      H(["文件", "公开数", "代表符号（‼=无文档）"], ["File", "Public", "Representative (‼=undoc)"]),
      pubRows,
    ),
    "",
    L(
      `**入口点**：${entryPoints.length} 个（程序入口 main / 顶层启动·路由函数）。`,
      `**Entry points**: ${entryPoints.length} (program entry main / top-level bootstrap·route functions).`,
    ),
    ...mdTable(
      H(["名称", "类型", "文件", "行", "修饰符"], ["Name", "Kind", "File", "Line", "Modifiers"]),
      entryRows,
    ),
    "",
    L(
      `**模块职责**（按被依赖度排序，被依赖越多=越靠近核心稳定层）：${modules.length} 个模块。`,
      `**Module responsibilities** (sorted by dependents; more dependents = closer to core stable layer): ${modules.length} modules.`,
    ),
    ...mdTable(H(["模块", "层", "文件", "出边", "入边"], ["Module", "Layer", "Files", "Out", "In"]), modRows),
    "",
    L(
      "> 入口点与公开性为启发式聚合（非事实）：入口点按命名惯例识别，公开性按修饰符 / Go 首字母大写推断。请结合符号引用与调用图自行验证后再下结论。",
      "> Entry points and publicity are heuristic aggregates (not facts): entry points by naming convention, publicity by modifiers / Go capitalization. Verify against symbol refs and call graph before concluding.",
    ),
  ];

  // 4) 陈述需求 vs 代码语义面对照（P2）：若客户已登记需求基线，把它作为「想做」一侧的
  //    锚点挂到代码语义面末尾，引导 Agent / 用户逐条比对缺口。只做诚实锚定与指引，
  //    不做不可靠的自动映射（自由文本↔代码符号的精确对齐留给 `requirements-capture` 预设）。
  if (analysisId) {
    const baseline = useRequirementsStore.getState().getBaseline(analysisId);
    if (baseline && baseline.content.trim().length > 0) {
      const firstLine = baseline.content
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      lines.push(
        "",
        "---",
        "",
        L(
          "**陈述需求 vs 代码语义面对照**",
          "**Stated Requirements vs Code Surface**",
        ),
        L(
          `客户已登记需求基线（requirements-spec，更新于 ${new Date(baseline.updatedAt).toLocaleString()}，约 ${baseline.content.length} 字）。`,
          `The customer has registered a requirements baseline (requirements-spec, updated ${new Date(baseline.updatedAt).toLocaleString()}, ~${baseline.content.length} chars).`,
        ),
      );
      if (firstLine) {
        lines.push(
          L(
            `> 客户开篇陈述：「${firstLine.slice(0, 120)}」`,
            `> Customer's opening statement: "${firstLine.slice(0, 120)}"`,
          ),
        );
      }
      lines.push(
        L(
          "本节的公开契约 / 入口点 / 模块职责是代码**实际承诺**的语义面。要判断「某条需求是否已落地」，请用 `requirements-capture` 预设（或向 Agent 提问），它会结合 requirements-spec 与本节逐条比对并标出缺口。",
          "The public contracts / entry points / module responsibilities above are the code's **actually-promised** surface. To judge whether a requirement is implemented, use the `requirements-capture` preset (or ask the Agent); it reconciles requirements-spec against this section and flags gaps.",
        ),
      );
    }
  }

  return makeSection(
    "requirements",
    sectionTitle("requirements"),
    8,
    L(
      `公开契约 ${publicSyms.length} · 入口点 ${entryPoints.length} · 模块 ${modules.length}`,
      `public ${publicSyms.length} · entry ${entryPoints.length} · modules ${modules.length}`,
    ),
    lines,
    { publicCount: publicSyms.length, entryCount: entryPoints.length, moduleCount: modules.length, publicByKind },
  );
}