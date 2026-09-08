import type { AiContextSection, AiSectionDataQuality } from "../contextTypes";
import { classifyQuality, coverageRatio, DATA_QUALITY_LABEL_KEY, worstStatus } from "../dataQuality";
import { makeSection, mdTable, cell, type ScanSnapshot } from "./scanSections";
import { t } from "../../i18n";
import { H, L } from "../aiLang";

/**
 * 扫描覆盖度体检 —— 把「这次扫描到底看清了什么、哪里是盲区」讲给 AI 听。
 *
 * 起因
 * ----
 * 扫描分节此前一律以「肯定句」输出结论：「无循环依赖 —— 依赖方向健康」「重复片段 0 处」。
 * 但这些句子有两种完全不同的来源：
 *   ① 分析器跑完了，确实没有 → 是结论；
 *   ② 该语言没有分析器 / 项目不在 Git 仓库 / 阶段没跑 → 是盲区。
 * Agent 无法从正文里分辨二者，于是会把盲区当成健康，给出「架构很干净」这类**基于缺失数据的错误结论**——
 * 这是 AI 代码分析里最贵、也最难被发现的一类错误（人也一样会被骗）。
 *
 * 做法
 * ----
 * 以扫描阶段为单位做一次体检：每个阶段观测到多少条记录、覆盖了多少对象、
 * 「0 条」在该阶段意味着什么，然后把结论映射到它供养的分节上。
 * 于是每个分节都带上 dataQuality，Agent 在 outline 阶段（几十 token）就能看清：
 *   - 哪些节可信、值得花 token 读；
 *   - 哪些节是盲区、读了也没用（顺带省下这部分 token）；
 *   - 哪些结论明确不能下（caveat）。
 */

/** 阶段 → 供养的分节。一个阶段可以供养多节，一节也可以由多个阶段供养 */
export interface ScanStageCoverage {
  key: string;
  /** 阶段名语言包键（coverage.stage.<key>），消费点 t() 取当前语言 */
  labelKey: string;
  /** 该阶段观测到的记录数 */
  observed: number;
  quality: AiSectionDataQuality;
  /** 该阶段供养的分节键 */
  feeds: string[];
}

/** 分节的数据来源：主来源决定可信度，辅来源缺失只降级为「部分覆盖」 */
const SECTION_SOURCES: Record<string, { primary: string; aux?: string[] }> = {
  coverage: { primary: "enumerate" },
  overview: { primary: "enumerate" },
  // 风险矩阵是多源交叉：主来源只能是文件枚举（有文件才谈得上打分），
  // 其余八个维度全是辅来源——任何一个盲区都只把它降级为「部分覆盖」，
  // 绝不能因为项目没有 Git 就把整节判死：剩下七个维度的交叉照样成立，
  // 而它自己的正文里已经逐条列出了被排除的维度。
  riskMatrix: {
    primary: "enumerate",
    aux: ["metrics", "git", "symbolRefs", "review", "clones", "techDebt", "changeCoupling", "deadCode"],
  },
  architecture: { primary: "deps", aux: ["structure"] },
  hotspots: { primary: "metrics", aux: ["git"] },
  review: { primary: "review" },
  coupling: { primary: "changeCoupling", aux: ["git"] },
  techDebt: { primary: "techDebt" },
  clones: { primary: "clones" },
  deadCode: { primary: "deadCode", aux: ["symbolRefs"] },
  callGraph: { primary: "callGraph" },
  dataFlow: { primary: "dataFlow" },
  patterns: { primary: "patterns" },
  symbols: { primary: "structure" },
  // 注释卫生：注释率来自 metrics，公开符号 doc 来自 structure——任一盲区降级为部分覆盖
  commentHealth: { primary: "metrics", aux: ["structure"] },
  // 需求语义：入口点/公开契约来自符号（structure），模块职责依赖模块依赖度（deps）
  requirements: { primary: "structure", aux: ["deps"] },
};

/**
 * 分节 → 原始记录数据集。
 *
 * 分节正文只放 Top-N 明细，Agent 看不到第 N+1 条。补救办法是让它去查原始记录，
 * 前提是它知道「这一节背后的全量数据叫什么」。这个对应关系是**扫描模块的知识**
 * （只有扫描才知道 techDebt 分节背后是 project_tech_debt 表），
 * 所以声明在这里，由协议的 dataQuality.drilldown 透传给 AI 层与后端 —— 它们都不认识具体模块。
 *
 * 刻意不收录 review / architecture / symbols / deadCode / patterns：
 * 它们的原始数据由 review_explain / symbol_lookup / impact_assess 提供更贴合的语义，
 * 指向 scan_records 反而会给出两套口径。宁可不指路，也不指错路。
 */
const SECTION_DRILLDOWN: Record<string, string> = {
  overview: "files",
  hotspots: "metrics",
  coupling: "changeCoupling",
  techDebt: "techDebt",
  clones: "clones",
  callGraph: "callEdges",
  dataFlow: "dataFlow",
};

/** 提供全量下钻的工具名（与后端 scan_records.rs 的 AgentTool::name 一致） */
const DRILLDOWN_TOOL = "scan_records";

/**
 * 超过这个条数，分节正文就一定是截断的。
 *
 * 取各 builder 里最小的那档（TOP_N_SMALL=10）而不是 TOP_N=15：宁可多提示一次
 * 「这是摘录」，也不能在真的截断了的时候沉默——沉默会让 Agent 拿样本当全集。
 */
const TRUNCATION_THRESHOLD = 10;

/** 数据流分析当前支持的语言（与后端 dataflow.rs 的 has_dataflow() 对齐） */
const DATAFLOW_LANGS = ["typescript", "javascript", "tsx", "jsx", "rust", "python"];

/**
 * 逐阶段体检。
 *
 * 每个阶段的 `zeroMeans` 是这里最关键的判断，它直接决定 Agent 敢不敢下结论：
 * 「技术债 0 处」是真结论（扫描器对所有语言都能跑），
 * 「调用边 0 条」在有符号的项目里几乎一定是盲区（该语言没有调用解析）。
 */
export function buildStageCoverage(s: ScanSnapshot): ScanStageCoverage[] {
  const codeFiles = s.files.filter((f) => !f.isDirectory);
  const fileCount = codeFiles.length;
  const hasSymbols = s.symbols.length > 0;
  const hasGit = s.gitChurn.length > 0;

  const dfLangFiles = codeFiles.filter((f) =>
    DATAFLOW_LANGS.includes((f.language ?? "").toLowerCase()),
  ).length;

  const stages: ScanStageCoverage[] = [];

  stages.push({
    key: "enumerate",
    labelKey: "coverage.stage.enumerate",
    observed: fileCount,
    feeds: ["overview", "coverage", "riskMatrix"],
    quality: classifyQuality({
      observed: fileCount,
      zeroMeans: "unavailable",
      reason:
        fileCount === 0
          ? L("未枚举到任何代码文件：扫描可能未完成或全部文件被排除规则过滤", "No code files enumerated: the scan may be incomplete, or all files were filtered by exclusion rules")
          : undefined,
    }),
  });

  stages.push({
    key: "structure",
    labelKey: "coverage.stage.structure",
    observed: s.symbols.length,
    feeds: ["symbols", "architecture", "patterns"],
    quality: classifyQuality({
      observed: s.symbols.length,
      zeroMeans: "unavailable",
      reason: hasSymbols
        ? undefined
        : L("结构分析未产出任何符号：多为该语言没有 AST 分析器，或结构阶段未执行", "Structure analysis produced no symbols: usually the language has no AST analyzer, or the structure stage did not run"),
      caveat: hasSymbols ? undefined : L("不要据此断言项目「没有类/函数抽象」", "Do not assert the project \"has no class/function abstractions\" based on this"),
    }),
  });

  stages.push({
    key: "deps",
    labelKey: "coverage.stage.deps",
    observed: s.dependencies.length,
    feeds: ["architecture"],
    quality: classifyQuality({
      observed: s.dependencies.length,
      // 一个有多份源码、又解析出了符号的项目却 0 条依赖边，几乎一定是解析器缺位而非真的零耦合
      zeroMeans: fileCount > 3 && hasSymbols ? "unavailable" : "empty",
      reason:
        s.dependencies.length === 0
          ? L("未检出任何依赖边：多为该语言缺少 import/include 解析器，而非项目真的没有模块间引用", "No dependency edges detected: usually the language lacks an import/include parser, not that the project really has no inter-module references")
          : undefined,
      caveat:
        s.dependencies.length === 0
          ? L("不要据此断言「无循环依赖」或「模块解耦良好」——这是盲区，不是结论", "Do not assert \"no circular dependencies\" or \"well-decoupled modules\" based on this — it is a blind spot, not a conclusion")
          : undefined,
    }),
  });

  stages.push({
    key: "symbolRefs",
    labelKey: "coverage.stage.symbolRefs",
    observed: s.symbolRefs.length,
    feeds: ["deadCode", "riskMatrix"],
    quality: classifyQuality({
      observed: s.symbolRefs.length,
      zeroMeans: hasSymbols ? "unavailable" : "empty",
      reason:
        s.symbolRefs.length === 0
          ? L("未建立符号引用关系：零引用判定失去依据，死代码结论不成立", "Symbol reference relations were not built: zero-reference judgments lose their basis and dead-code conclusions do not hold")
          : undefined,
    }),
  });

  stages.push({
    key: "review",
    labelKey: "coverage.stage.review",
    observed: s.findings.length,
    feeds: ["review", "riskMatrix"],
    // 规则引擎对所有语言都会跑，0 条命中是真结论
    quality: classifyQuality({ observed: s.findings.length, zeroMeans: "finding" }),
  });

  stages.push({
    key: "callGraph",
    labelKey: "coverage.stage.callGraph",
    observed: s.callEdges.length,
    feeds: ["callGraph"],
    quality: classifyQuality({
      observed: s.callEdges.length,
      zeroMeans: hasSymbols ? "unavailable" : "empty",
      reason:
        s.callEdges.length === 0
          ? L("未产出调用边：该语言暂无调用解析，或调用图阶段未执行", "No call edges produced: the language has no call resolution yet, or the call-graph stage did not run")
          : undefined,
      caveat: s.callEdges.length === 0 ? L("不要据此评估「改动影响面很小」", "Do not estimate \"small change blast radius\" based on this") : undefined,
    }),
  });

  stages.push({
    key: "dataFlow",
    labelKey: "coverage.stage.dataFlow",
    observed: s.dataFlowSummary?.functions ?? 0,
    feeds: ["dataFlow"],
    quality: classifyQuality({
      observed: s.dataFlowSummary?.functions ?? 0,
      zeroMeans: "unavailable",
      covered: s.dataFlowSummary?.analyzedFiles,
      expected: dfLangFiles > 0 ? dfLangFiles : fileCount,
      reason: s.dataFlowSummary
        ? L(
            `数据流仅支持 TS/JS/Rust/Python，本项目 ${dfLangFiles}/${fileCount} 个文件属受支持语言`,
            `Data flow supports only TS/JS/Rust/Python; ${dfLangFiles}/${fileCount} files in this project are in supported languages`,
          )
        : L("数据流阶段未产出结果：该语言不支持（仅 TS/JS/Rust/Python）或阶段未执行", "Data-flow stage produced nothing: the language is unsupported (only TS/JS/Rust/Python) or the stage did not run"),
    }),
  });

  stages.push({
    key: "metrics",
    labelKey: "coverage.stage.metrics",
    observed: s.metrics.length,
    feeds: ["hotspots", "riskMatrix"],
    quality: classifyQuality({
      observed: s.metrics.length,
      zeroMeans: "unavailable",
      covered: s.metrics.length,
      expected: fileCount,
      reason:
        s.metrics.length === 0
          ? L("未产出任何文件度量：度量阶段未执行", "No file metrics produced: the metrics stage did not run")
          : s.metrics.length < fileCount
            ? L("部分文件未被度量（通常是二进制/超大文件或不支持的语言被跳过）", "Some files were not measured (usually binaries, oversized files, or unsupported languages were skipped)")
            : undefined,
    }),
  });

  stages.push({
    key: "techDebt",
    labelKey: "coverage.stage.techDebt",
    observed: s.techDebt.length,
    feeds: ["techDebt", "riskMatrix"],
    // 标记扫描是纯文本匹配，任何语言都能跑，0 条即真的没有
    quality: classifyQuality({ observed: s.techDebt.length, zeroMeans: "finding" }),
  });

  stages.push({
    key: "clones",
    labelKey: "coverage.stage.clones",
    observed: s.clones.length,
    feeds: ["clones", "riskMatrix"],
    quality: classifyQuality({ observed: s.clones.length, zeroMeans: "finding" }),
  });

  stages.push({
    key: "git",
    labelKey: "coverage.stage.git",
    observed: s.gitChurn.length,
    feeds: ["hotspots", "coupling", "riskMatrix"],
    quality: classifyQuality({
      observed: s.gitChurn.length,
      zeroMeans: "unavailable",
      reason: hasGit ? undefined : L("项目不在 Git 仓库内，或仓库无提交历史：变更频率维度缺失", "The project is not in a Git repository, or the repo has no commit history: the churn dimension is missing"),
      caveat: hasGit ? undefined : L("不要据此判断「这些代码很少改动」", "Do not judge \"these files rarely change\" based on this"),
    }),
  });

  stages.push({
    key: "changeCoupling",
    labelKey: "coverage.stage.changeCoupling",
    observed: s.changeCoupling.length,
    feeds: ["coupling", "riskMatrix"],
    quality: classifyQuality({
      observed: s.changeCoupling.length,
      // 变更耦合完全建立在 Git 历史上：没有历史就不是「没耦合」，而是「看不见」
      zeroMeans: hasGit ? "finding" : "unavailable",
      reason: hasGit ? undefined : L("变更耦合依赖 Git 提交历史，当前项目无历史可用", "Change coupling depends on Git commit history; the current project has no history available"),
      caveat: hasGit ? undefined : L("不要据此断言「模块之间没有隐性耦合」", "Do not assert \"no hidden coupling between modules\" based on this"),
    }),
  });

  stages.push({
    key: "deadCode",
    labelKey: "coverage.stage.deadCode",
    observed: s.deadSymbols.length,
    feeds: ["deadCode", "riskMatrix"],
    quality: classifyQuality({
      observed: s.deadSymbols.length,
      zeroMeans: s.symbolRefs.length > 0 ? "finding" : "unavailable",
      reason:
        s.symbolRefs.length > 0
          ? undefined
          : L("死代码判定依赖符号引用关系，当前无引用数据可用", "Dead-code detection depends on symbol reference relations; no reference data is currently available"),
    }),
  });

  stages.push({
    key: "patterns",
    labelKey: "coverage.stage.patterns",
    observed: s.patternHits.length,
    feeds: ["patterns"],
    quality: classifyQuality({
      observed: s.patternHits.length,
      zeroMeans: hasSymbols ? "finding" : "unavailable",
      reason: hasSymbols ? undefined : L("模式识别建立在符号之上，当前无符号数据", "Pattern recognition builds on symbols; no symbol data is currently available"),
      caveat: L("模式识别为启发式推断，命中与否都不构成事实", "Pattern recognition is a heuristic inference; a hit or miss does not constitute a fact"),
    }),
  });

  return stages;
}

/**
 * 阶段体检 → 分节可信度。
 *
 * 规则：主来源定调，辅来源缺失只降一级。
 * 例如热点分节的主来源是文件度量（有就能排复杂度），Git 只是辅来源；
 * 若把辅来源的不可用直接传染成 unavailable，Agent 就会连能用的复杂度排序也一起放弃——
 * 那是另一种形式的信息损失。
 */
export function sectionQualityMap(
  stages: ScanStageCoverage[],
): Record<string, AiSectionDataQuality> {
  const byKey = new Map(stages.map((st) => [st.key, st]));
  const out: Record<string, AiSectionDataQuality> = {};

  for (const [sectionKey, src] of Object.entries(SECTION_SOURCES)) {
    const primary = byKey.get(src.primary);
    if (!primary) continue;
    let q: AiSectionDataQuality = { ...primary.quality };

    const brokenAux = (src.aux ?? [])
      .map((k) => byKey.get(k))
      .filter((st): st is ScanStageCoverage => !!st)
      .filter((st) => st.quality.status === "unavailable" || st.quality.status === "empty");

    if (brokenAux.length > 0 && (q.status === "ok" || q.status === "partial")) {
      const names = brokenAux.map((st) => t(st.labelKey)).join("、");
      const reasons = brokenAux
        .map((st) => st.quality.reason)
        .filter((r): r is string => !!r)
        .join("；");
      q = {
        ...q,
        status: "partial",
        reason: L(
          [q.reason, `辅助维度「${names}」不可用${reasons ? `（${reasons}）` : ""}`]
            .filter(Boolean)
            .join("；"),
          [q.reason, `auxiliary dimension "${names}" unavailable${reasons ? ` (${reasons})` : ""}`]
            .filter(Boolean)
            .join("; "),
        ),
        caveat:
          q.caveat ??
          brokenAux.map((st) => st.quality.caveat).find((c): c is string => !!c),
      };
    }

    // 指路只在两个条件同时成立时才给：这一节确实被截断了（记录数超过明细上限），
    // 且它背后有一张能全量下钻的原始表。给一个没数据的维度指路，
    // 只会诱导 Agent 去查一张空表，白花一次工具调用。
    const dataset = SECTION_DRILLDOWN[sectionKey];
    if (dataset && primary.observed > TRUNCATION_THRESHOLD) {
      q = {
        ...q,
        truncated: true,
        drilldown: { tool: DRILLDOWN_TOOL, dataset, total: primary.observed },
      };
    }

    out[sectionKey] = q;
  }
  return out;
}

/**
 * 覆盖度分节：整包的「体检报告」，priority 0（与 overview 同级，永远不会被预算裁掉）。
 * Agent 读这一节的成本只有几百 token，却能避免一整轮基于盲区的错误推理。
 */
export function buildCoverageSection(s: ScanSnapshot): AiContextSection {
  const stages = buildStageCoverage(s);
  const overall = worstStatus(stages.map((st) => st.quality));

  const blind = stages.filter((st) => st.quality.status === "unavailable");
  const partial = stages.filter((st) => st.quality.status === "partial");

  const rows = stages.map((st) => {
    const ratio = coverageRatio(st.quality);
    return [
      t(st.labelKey),
      t(DATA_QUALITY_LABEL_KEY[st.quality.status]),
      String(st.observed),
      ratio !== null ? `${ratio}%` : "-",
      cell(st.quality.reason, 60) || "-",
      st.feeds.join(" / "),
    ];
  });

  const caveats = stages
    .filter((st) => st.quality.status !== "ok" && st.quality.caveat)
    .map((st) => L(`- **${t(st.labelKey)}**：${st.quality.caveat}`, `- **${t(st.labelKey)}**: ${st.quality.caveat}`));

  const lines = [
    L(
      `本次扫描共 ${stages.length} 个分析阶段，整体可信度：**${t(DATA_QUALITY_LABEL_KEY[overall])}**。` +
        `盲区 ${blind.length} 个 · 部分覆盖 ${partial.length} 个。`,
      `This scan has ${stages.length} analysis stages; overall trustworthiness: **${t(DATA_QUALITY_LABEL_KEY[overall])}**. ` +
        `Blind spots: ${blind.length} · partial coverage: ${partial.length}.`,
    ),
    "",
    L("**阶段体检**", "**Stage inspection**"),
    ...mdTable(
      H(["阶段", "状态", "记录数", "覆盖率", "说明", "供养分节"], ["Stage", "Status", "Records", "Coverage", "Note", "Feeds"]),
      rows,
    ),
    "",
    caveats.length
      ? L("**以下结论明确不能下（数据缺失，不是「没问题」）**", "**The following conclusions must NOT be drawn (missing data, not \"no problem\")**")
      : L("**无数据盲区，各分节结论均可直接采信。**", "**No blind spots; all section conclusions can be trusted directly.**"),
    ...caveats,
    "",
    L(
      "> 判读规则：`不可用` = 该维度没跑成，正文里的「0 条 / 未发现」是盲区而非结论，读它也是浪费 token；",
      "> How to read: `unavailable` = the dimension did not run; \"0 items / none found\" in the body is a blind spot, not a conclusion — reading it wastes tokens;",
    ),
    L(
      "> `部分覆盖` = 结论只在覆盖范围内成立，超出范围要显式声明未知；`可信` = 可以直接下结论。",
      "> `partial` = conclusions hold only within the covered scope; beyond it, state unknown explicitly; `ok` = conclusions can be drawn directly.",
    ),
    L(
      "> 全文索引（code_search 工具的底座）不产出统计数据，故不在上表；它的可用性以工具实际返回为准。",
      "> Full-text index (the base of the code_search tool) produces no statistics, so it is not listed; its availability follows what the tool actually returns.",
    ),
  ];

  return makeSection(
    "coverage",
    L("扫描覆盖度与数据可信度", "Scan Coverage & Data Trustworthiness"),
    0,
    L(
      `整体 ${t(DATA_QUALITY_LABEL_KEY[overall])}：${stages.length} 阶段中盲区 ${blind.length} · 部分覆盖 ${partial.length}`,
      `Overall ${t(DATA_QUALITY_LABEL_KEY[overall])}: ${stages.length} stages — ${blind.length} blind · ${partial.length} partial`,
    ),
    lines,
    {
      overall,
      stageCount: stages.length,
      blindStages: blind.map((st) => st.key),
      partialStages: partial.map((st) => st.key),
      stages: stages.map((st) => ({
        key: st.key,
        status: st.quality.status,
        observed: st.observed,
        feeds: st.feeds,
      })),
    },
  );
}
