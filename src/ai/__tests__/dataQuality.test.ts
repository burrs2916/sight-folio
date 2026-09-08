import { describe, it, expect, beforeEach } from "vitest";
import {
  applyQuality,
  classifyQuality,
  coverageRatio,
  isConclusive,
  qualityNotice,
  worstStatus,
} from "../dataQuality";
import { buildStageCoverage, sectionQualityMap, buildCoverageSection } from "../providers/scanCoverage";
import type { ScanSnapshot } from "../providers/scanSections";
import type { AiContextSection } from "../contextTypes";
import { useProjectStore } from "../../store/projectStore";
import { scanContextProvider } from "../providers/scanContextProvider";

/**
 * 数据可信度 —— 守的是 AI 代码分析里最贵的一类错误：**把盲区读成健康**。
 *
 * 「未发现循环依赖」这句话有两种来源：分析器跑完确实没有（结论），
 * 或该语言没有 import 解析器（盲区）。二者在正文里长得一模一样，
 * Agent 分辨不出，就会给出「架构很干净」这种基于缺失数据的断言。
 * 下面每条用例都对应一种「0 条」的真实语义，判错任何一条都会让这个保护失效。
 */

// ── 判定层：0 条到底意味着什么 ──

describe("classifyQuality：区分「查过了没有」与「根本没查」", () => {
  it("跑过分析、结果为 0 —— 这是真结论，保持可信", () => {
    // 技术债/重复代码这类纯文本匹配对所有语言都能跑，0 条就是真的没有
    const q = classifyQuality({ observed: 0, zeroMeans: "finding" });
    expect(q.status).toBe("ok");
    expect(isConclusive(q)).toBe(true);
  });

  it("维度没跑成、结果为 0 —— 这是盲区，禁止下结论", () => {
    const q = classifyQuality({
      observed: 0,
      zeroMeans: "unavailable",
      reason: "该语言无 import 解析器",
      caveat: "不要据此断言无循环依赖",
    });
    expect(q.status).toBe("unavailable");
    expect(isConclusive(q)).toBe(false);
    expect(q.caveat).toContain("循环依赖");
  });

  it("分析可用但项目里没有可分析对象 —— 既不是问题也不是结论", () => {
    expect(classifyQuality({ observed: 0, zeroMeans: "empty" }).status).toBe("empty");
  });

  it("有数据但只覆盖了一部分对象 —— 降级为部分覆盖", () => {
    const q = classifyQuality({ observed: 12, covered: 30, expected: 100 });
    expect(q.status).toBe("partial");
    expect(coverageRatio(q)).toBe(30);
  });

  it("覆盖满额不降级；无覆盖面信息时不臆造覆盖率", () => {
    expect(classifyQuality({ observed: 5, covered: 40, expected: 40 }).status).toBe("ok");
    expect(coverageRatio(classifyQuality({ observed: 5 }))).toBeNull();
  });
});

describe("worstStatus：整包取最差的那一个", () => {
  it("一个盲区就足以把整包判为不可用", () => {
    expect(
      worstStatus([{ status: "ok" }, { status: "partial" }, { status: "unavailable" }]),
    ).toBe("unavailable");
  });

  it("未声明可信度按可信处理（兼容历史数据与未接入模块）", () => {
    expect(worstStatus([undefined, { status: "ok" }])).toBe("ok");
  });
});

// ── 渲染层：提示语必须进正文，否则长上下文里拦不住 ──

describe("qualityNotice / applyQuality", () => {
  const base: AiContextSection = {
    key: "architecture",
    title: "架构",
    priority: 2,
    summary: "s",
    content: "未发现循环依赖 —— 依赖方向健康",
    tokenEstimate: 20,
    digest: "d0",
    updatedAt: 1_000,
  };

  it("可信分节不为「我很可信」花 token", () => {
    expect(qualityNotice({ status: "ok" })).toBeNull();
    const out = applyQuality(base, { status: "ok" });
    expect(out.content).toBe(base.content);
    expect(out.dataQuality?.status).toBe("ok");
  });

  it("盲区分节把警告插到正文最前面，和结论同处一段", () => {
    // 只放结构化字段不够：正文会被整段塞进对话，模型只会记住正文那句肯定句
    const out = applyQuality(base, {
      status: "unavailable",
      observed: 0,
      reason: "该语言无 import 解析器",
      caveat: "不要据此断言无循环依赖",
    });
    expect(out.content.startsWith("⚠️ **数据不可用**")).toBe(true);
    expect(out.content).toContain("import 解析器");
    expect(out.content).toContain("请勿据此断言");
    expect(out.content).toContain("未发现循环依赖"); // 原文不丢
  });

  it("正文变长后 token 估算同步重算，预算裁剪才不会算错账", () => {
    const out = applyQuality(base, { status: "partial", covered: 3, expected: 10, reason: "r" });
    expect(out.tokenEstimate).toBeGreaterThan(base.tokenEstimate);
    expect(out.content).toContain("覆盖 3/10，30%");
  });

  it("未给可信度时原样返回，不污染既有分节", () => {
    expect(applyQuality(base, undefined)).toBe(base);
  });
});

// ── 阶段体检：扫描快照 → 逐阶段诊断 ──

function snapshot(over: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    analysisId: "a1",
    projectRoot: "/tmp/p",
    files: [],
    modules: [],
    dependencies: [],
    layers: [],
    findings: [],
    symbols: [],
    symbolRefs: [],
    patternHits: [],
    metrics: [],
    techDebt: [],
    clones: [],
    deadSymbols: [],
    gitChurn: [],
    callEdges: [],
    callGraphSummary: null,
    changeCoupling: [],
    dataFlowSummary: null,
    ...over,
  } as ScanSnapshot;
}

function file(relPath: string, language: string) {
  return {
    id: `f-${relPath}`,
    analysisId: "a1",
    relPath,
    isDirectory: false,
    language,
    lineCount: 100,
    sizeBytes: 2000,
  } as unknown as ScanSnapshot["files"][number];
}

function symbol(name: string) {
  return {
    id: `s-${name}`,
    analysisId: "a1",
    fileId: "f1",
    filePath: "a.go",
    name,
    kind: "function",
    lineStart: 1,
    lineEnd: 9,
    signature: "",
    doc: null,
    modifiers: "",
    patterns: "",
    metadata: "",
    createdAt: 0,
  } as ScanSnapshot["symbols"][number];
}

/** 典型盲区项目：解析出了符号，但依赖/引用/Git 全空（语言分析器缺位 + 非 Git 仓库） */
const blindSpotProject = () =>
  snapshot({
    files: [file("a.go", "go"), file("b.go", "go"), file("c.go", "go"), file("d.go", "go")],
    symbols: [symbol("Foo"), symbol("Bar")],
  });

describe("buildStageCoverage：把「没数据」诚实标出来", () => {
  it("有符号却 0 依赖边 = 解析器缺位，不是零耦合", () => {
    const deps = buildStageCoverage(blindSpotProject()).find((s) => s.key === "deps")!;
    expect(deps.quality.status).toBe("unavailable");
    expect(deps.quality.caveat).toContain("不要据此断言");
    expect(deps.feeds).toContain("architecture");
  });

  it("非 Git 项目：历史与变更耦合双双判盲区", () => {
    const stages = buildStageCoverage(blindSpotProject());
    expect(stages.find((s) => s.key === "git")!.quality.status).toBe("unavailable");
    // 变更耦合完全建立在 Git 历史上：没有历史不是「没耦合」，而是「看不见」
    expect(stages.find((s) => s.key === "changeCoupling")!.quality.status).toBe("unavailable");
  });

  it("无符号引用时死代码结论不成立", () => {
    const dead = buildStageCoverage(blindSpotProject()).find((s) => s.key === "deadCode")!;
    expect(dead.quality.status).toBe("unavailable");
  });

  it("规则审查 0 命中是真结论，不能跟盲区混为一谈", () => {
    const review = buildStageCoverage(blindSpotProject()).find((s) => s.key === "review")!;
    expect(review.quality.status).toBe("ok");
  });

  it("数据流按受支持语言算覆盖率（Go 项目全员不支持）", () => {
    const df = buildStageCoverage(blindSpotProject()).find((s) => s.key === "dataFlow")!;
    expect(df.quality.status).toBe("unavailable");
    expect(df.quality.reason).toContain("TS/JS/Rust/Python");
  });

  it("数据齐备的 TS 项目不会被误判成盲区", () => {
    const healthy = snapshot({
      files: [file("a.ts", "typescript"), file("b.ts", "typescript")],
      symbols: [symbol("Foo")],
      symbolRefs: [{ id: "r1" } as ScanSnapshot["symbolRefs"][number]],
      dependencies: [{ id: "d1" } as ScanSnapshot["dependencies"][number]],
      gitChurn: [{ filePath: "a.ts" } as ScanSnapshot["gitChurn"][number]],
      metrics: [
        { filePath: "a.ts" } as ScanSnapshot["metrics"][number],
        { filePath: "b.ts" } as ScanSnapshot["metrics"][number],
      ],
      callEdges: [{ id: "c1" } as ScanSnapshot["callEdges"][number]],
      dataFlowSummary: { functions: 4, analyzedFiles: 2 } as ScanSnapshot["dataFlowSummary"],
    });
    const stages = buildStageCoverage(healthy);
    const blind = stages.filter((s) => s.quality.status === "unavailable");
    expect(blind).toHaveLength(0);
  });
});

describe("sectionQualityMap：主来源定调，辅来源缺失只降一级", () => {
  it("热点分节：度量可用但 Git 缺失 → 部分覆盖，而不是整节作废", () => {
    // 若辅来源的不可用直接传染成 unavailable，Agent 会连能用的复杂度排序也一起放弃
    const s = snapshot({
      files: [file("a.go", "go")],
      symbols: [symbol("Foo")],
      metrics: [{ filePath: "a.go" } as ScanSnapshot["metrics"][number]],
    });
    const map = sectionQualityMap(buildStageCoverage(s));
    expect(map.hotspots.status).toBe("partial");
    expect(map.hotspots.reason).toContain("Git");
  });

  it("架构分节继承依赖阶段的盲区判定", () => {
    const map = sectionQualityMap(buildStageCoverage(blindSpotProject()));
    expect(map.architecture.status).toBe("unavailable");
  });
});

describe("sectionQualityMap：被截断的分节给出下钻指路（省 token 不丢全量口径）", () => {
  // 分节正文只放 Top-N，Agent 看不到第 N+1 条。drilldown 把「这一节的全量记录在哪」
  // 指出来，模型才能去 scan_records 核实「全项目共有多少处」，而不是拿头部样本当全集。

  it("技术债分节记录数超过明细上限 → 标 truncated + 指路 scan_records/techDebt", () => {
    const td = Array.from(
      { length: 482 },
      (_, i) => ({ id: `t${i}` }),
    ) as unknown as ScanSnapshot["techDebt"];
    const map = sectionQualityMap(buildStageCoverage(snapshot({ techDebt: td })));
    expect(map.techDebt.truncated).toBe(true);
    expect(map.techDebt.drilldown).toEqual({
      tool: "scan_records",
      dataset: "techDebt",
      total: 482,
    });
    // total 必须等于原始记录数，不能是明细里的 Top-N（否则去下钻会对不上账）
    expect(map.techDebt.drilldown?.total).toBe(td.length);
  });

  it("技术债记录数未超明细上限 → 不指路（正文即全部，指路反而误导）", () => {
    const td = Array.from(
      { length: 8 },
      (_, i) => ({ id: `t${i}` }),
    ) as unknown as ScanSnapshot["techDebt"];
    const map = sectionQualityMap(buildStageCoverage(snapshot({ techDebt: td })));
    expect(map.techDebt.drilldown).toBeUndefined();
    expect(map.techDebt.truncated).toBeFalsy();
  });

  it("审查分节即便命中数很多也不指路（review 不在下钻清单内）", () => {
    // review / architecture / symbols / deadCode / patterns 的原始数据由 review_explain /
    // symbol_lookup / impact_assess 提供，指向 scan_records 会给出两套口径，
    // 所以宁可空着也不指错路。
    const f = Array.from(
      { length: 50 },
      (_, i) => ({ id: `f${i}` }),
    ) as unknown as ScanSnapshot["findings"];
    const map = sectionQualityMap(buildStageCoverage(snapshot({ findings: f })));
    expect(map.review.drilldown).toBeUndefined();
  });

  it("overview 分节按文件数指路到 dataset=files", () => {
    const files = Array.from({ length: 24 }, (_, i) => file(`a${i}.ts`, "typescript"));
    const map = sectionQualityMap(buildStageCoverage(snapshot({ files })));
    expect(map.overview.truncated).toBe(true);
    expect(map.overview.drilldown?.tool).toBe("scan_records");
    expect(map.overview.drilldown?.dataset).toBe("files");
    expect(map.overview.drilldown?.total).toBe(24);
  });
});

describe("buildCoverageSection：整包体检报告", () => {
  it("盲区项目：列出阶段表与「明确不能下的结论」清单", () => {
    const sec = buildCoverageSection(blindSpotProject());
    expect(sec.key).toBe("coverage");
    expect(sec.priority).toBe(0); // 与 overview 同级，永不被预算裁掉
    expect(sec.content).toContain("以下结论明确不能下");
    expect((sec.facts as { blindStages: string[] }).blindStages).toContain("deps");
  });

  it("无盲区时给出正面结论，不制造无谓焦虑", () => {
    const sec = buildCoverageSection(
      snapshot({
        files: [file("a.ts", "typescript")],
        symbols: [symbol("Foo")],
        symbolRefs: [{ id: "r1" } as ScanSnapshot["symbolRefs"][number]],
        dependencies: [{ id: "d1" } as ScanSnapshot["dependencies"][number]],
        gitChurn: [{ filePath: "a.ts" } as ScanSnapshot["gitChurn"][number]],
        metrics: [{ filePath: "a.ts" } as ScanSnapshot["metrics"][number]],
        callEdges: [{ id: "c1" } as ScanSnapshot["callEdges"][number]],
        dataFlowSummary: { functions: 2, analyzedFiles: 1 } as ScanSnapshot["dataFlowSummary"],
      }),
    );
    expect(sec.content).toContain("无数据盲区");
  });
});

// ── 端到端：供给者产出的包必须带可信度 ──

describe("scanContextProvider 端到端：可信度贯通到包", () => {
  const ANALYSIS_ID = "analysis-quality-e2e";

  beforeEach(() => {
    useProjectStore.setState({
      activeAnalysisId: ANALYSIS_ID,
      files: [file("a.go", "go"), file("b.go", "go"), file("c.go", "go"), file("d.go", "go")],
      modules: [],
      dependencies: [],
      layers: [],
      findings: [],
      symbols: [symbol("Foo")],
      symbolRefs: [],
      patternHits: [],
      metrics: [],
      techDebt: [],
      clones: [],
      deadSymbols: [],
      gitChurn: [],
      callEdges: [],
      callGraphSummary: null,
      changeCoupling: [],
      dataFlowSummary: null,
      watchProjectRoot: "/tmp/demo-go",
    } as never);
  });

  it("每个分节都带 dataQuality，coverage 节排在最前", () => {
    const pack = scanContextProvider.buildPack(ANALYSIS_ID, { now: 1_000 });
    expect(pack).toBeTruthy();
    const sections = pack!.sections;
    expect(sections.every((s) => !!s.dataQuality)).toBe(true);
    expect(sections[0].key).toBe("coverage");
  });

  it("架构节的肯定句被警告覆盖，Agent 不会把盲区读成健康", () => {
    const pack = scanContextProvider.buildPack(ANALYSIS_ID, { now: 1_000 })!;
    const arch = pack.sections.find((s) => s.key === "architecture")!;
    expect(arch.dataQuality?.status).toBe("unavailable");
    expect(arch.content).toContain("数据不可用");
  });

  it("describeQuality 给人看的那份体检：与包里的判定同源", () => {
    const report = scanContextProvider.describeQuality!(ANALYSIS_ID)!;
    expect(report.moduleId).toBe("project-scan");
    expect(report.overall).toBe("unavailable");
    const deps = report.dimensions.find((d) => d.key === "deps")!;
    expect(deps.quality.status).toBe("unavailable");
    expect(deps.label).toBe("依赖检测");
  });

  it("describeQuality 只在 store 装载了目标分析时给结论，不猜", () => {
    expect(scanContextProvider.describeQuality!("some-other-analysis")).toBeNull();
  });
});
