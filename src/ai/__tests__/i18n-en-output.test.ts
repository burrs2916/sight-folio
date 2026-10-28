import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setLang, getLang, resolveFragments, t } from "../../i18n";
import { buildAnalysisMessage } from "../analysisRunner";
import { buildRiskMatrixSection } from "../providers/riskCorrelation";
import { buildCoverageSection } from "../providers/scanCoverage";
import { buildTrendSection } from "../providers/scanTrend";
import { buildRegressionSection } from "../providers/scanEntities";
import { buildEntityRegressionReport } from "../entityRegression";
import { summarizeFlowPortrait } from "../../editor/utils/dataFlowPortrait";
import { patternLabel, QUADRANT_META, QUADRANT_HINT, DUPLICATION_LABELS } from "../../editor/utils/fileInsights";
import type { ScanSnapshot } from "../providers/scanSections";

// 从 analysisRunner.test.ts 复用的快照构造
function makeSnapshot(): ScanSnapshot {
  return {
    analysisId: "test-analysis",
    files: [
      { id: "f1", relPath: "src/hot.ts", isDirectory: false, language: "typescript", lineCount: 120, layerId: "l1" },
      { id: "f2", relPath: "src/a.ts", isDirectory: false, language: "typescript", lineCount: 80, layerId: "l1" },
    ],
    modules: [{ id: "m1", name: "src", layerId: "l1", fileCount: 2, depCount: 0, beDepCount: 0 }],
    layers: [{ id: "l1", name: "App", sortOrder: 0, description: "" }],
    dependencies: [],
    symbols: [],
    symbolRefs: [],
    findings: [],
    techDebt: [],
    clones: [],
    deadSymbols: [],
    gitChurn: [],
    changeCoupling: [],
    metrics: [
      { id: "mt1", fileId: "f1", relPath: "src/hot.ts", codeLines: 120, commentLines: 5, cyclomaticComplexity: 34, maxFunctionCc: 40, maxNesting: 6, complexityLevel: "extreme", hotFunction: "run()", engine: "ast" },
      { id: "mt2", fileId: "f2", relPath: "src/a.ts", codeLines: 80, commentLines: 10, cyclomaticComplexity: 4, maxFunctionCc: 5, maxNesting: 2, complexityLevel: "low", hotFunction: "", engine: "ast" },
    ],
    callEdges: [],
    dataFlowSummary: null,
    patternHits: [],
    fileInsights: {},
  } as unknown as ScanSnapshot;
}

describe("AI 正文语言切换验证（第十二轮）", () => {
  const orig = getLang();
  beforeAll(() => setLang("en-US"));
  afterAll(() => setLang(orig));

  it("buildAnalysisMessage 正文为英文且无中文", () => {
    const preset = {
      key: "test",
      title: { "zh-CN": "全面优化诊断", "en-US": "Holistic Diagnosis" },
      description: { "zh-CN": "", "en-US": "" },
      prompt: { "zh-CN": "请分析", "en-US": "Please analyze" },
      sectionKeys: ["overview"],
    };
    const msg = buildAnalysisMessage({
      preset,
      packId: "p1",
      scopeId: "s1",
      sectionKeys: ["overview"],
      withInsight: true,
      withRecords: true,
      focusTargets: [{ filePath: "src/hot.ts", resonance: 2, state: "never", note: "note", evidenceDigest: "x", regressionDigest: "y" }],
    });
    expect(msg).toContain("Please analyze");
    expect(msg).toContain("Sections recommended for this run");
    expect(msg).toContain("Targets that MUST be covered");
    expect(msg).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("riskMatrix / coverage / regression / trend 分节正文为英文", () => {
    const snap = makeSnapshot();
    const risk = buildRiskMatrixSection(snap).content;
    expect(risk).toContain("Multi-dimensional resonance");
    expect(risk).not.toMatch(/[\u4e00-\u9fff]/);

    const cov = buildCoverageSection(snap).content;
    expect(cov).toContain("Stage inspection");
    expect(cov).not.toMatch(/[\u4e00-\u9fff]/);

    const trend = buildTrendSection(snap, "s1");
    expect(trend.title).toContain("Metric Trends");
    expect(trend.content).not.toMatch(/[\u4e00-\u9fff]/);

    const reg = buildRegressionSection(snap, "s1");
    expect(reg.title).toContain("File-level Regression");
    expect(reg.content).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("RISK_DIMENSIONS label/unit 随语言切换", () => {
    const snap = makeSnapshot();
    const report = buildRiskMatrixSection(snap);
    const facts = report.facts as unknown as {
      dimensions?: Array<{ label: string }>;
      excludedDimensions?: Array<{ label: string }>;
    };
    const labels = [...(facts.dimensions ?? []), ...(facts.excludedDimensions ?? [])].map((d) => d.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => !/[\u4e00-\u9fff]/.test(l))).toBe(true);
  });

  it("resolveFragments 解引用注册数据 key（视图名/图层名/实体类型）", () => {
    expect(resolveFragments("viewTab.defaultView")).toBe("Directory Tree");
    expect(resolveFragments("viewTab.defaultLayer")).toBe("Default Layer");
    // 拼模板的 description：key 片段逐个解引用，非 key 文本（路径等）原样保留
    const tpl = 'analyzer.php.name 提供的「analyzer.php.entity.class.name」实体 · path: src/hot.ts';
    const out = resolveFragments(tpl);
    expect(out).toContain("PHP Analyzer");
    expect(out).toContain("Class");
    expect(out).toContain("src/hot.ts");
    // 用户自定义名（非 key）原样返回
    expect(resolveFragments("我的视图")).toBe("我的视图");
  });

  it("实体回归 / 影响链 / 规则引擎 / 数据流 / 文件洞察正文为英文", () => {
    // 实体回归报告（entityRegression.ts 的 L() 化正文）
    const reg = buildEntityRegressionReport("m1", "s1", []);
    expect(reg.note).toContain("No entity boards recorded yet.");
    expect(reg.note).not.toMatch(/[\u4e00-\u9fff]/);


    // 数据流画像一句话结论（dataFlowPortrait.ts）
    const flow = summarizeFlowPortrait({
      summary: { totalFunctions: 0, sinks: 0, conduits: 0, blockers: 0, truncated: 0, topSink: null },
    } as never);
    expect(flow).toContain("no summary data");
    expect(flow).not.toMatch(/[\u4e00-\u9fff]/);

    // 文件洞察注册数据 key（fileInsights.ts）
    expect(resolveFragments(DUPLICATION_LABELS.extreme)).toBe("Nearly a copy");
    expect(resolveFragments(QUADRANT_META.refactorFirst.label)).toBe("Refactor first");
    expect(resolveFragments(QUADRANT_HINT.healthy)).toContain("Low complexity");
    expect(resolveFragments(patternLabel("singleton"))).toBe("Singleton");

    // 本轮新增 UI 数据 key（第十六轮后半段）：组件分类 / 影响链深度与方向
    // 注：原「图层类型」断言（layerType.tile）已随空间图层 UI 一并退场 —— layerType.*
    // 命名空间在 CAD/地图模块清理中删除，全仓（含 HEAD 之前）零消费点，键已不存在，
    // 故断言随之移除；此处曾自 2026-09-20 起长期以「预存 i18n 缺口」形式污染全量验证。
    expect(resolveFragments("editor.category.custom")).toBe("Custom");
    expect(resolveFragments("impact.depth.hop4")).toBe("4+ hops");
    expect(resolveFragments("impact.side.upstream")).toBe("Affected by me");
    expect(resolveFragments("insight.dup.high")).toBe("Severe");
    expect(resolveFragments("impact.runner.unknown")).toBe("Unknown runner");
  });

  it("旧中文系统名（DB 历史数据）反查翻译，用户自定义中文名保留", () => {
    // 场景视图名：i18n key 化之前存进 DB 的中文文本，加载后渲染侧 resolveFragments 应翻译
    expect(resolveFragments("目录树")).toBe("Directory Tree");
    expect(resolveFragments("目录结构")).toBe("Directory structure");
    expect(resolveFragments("架构总览")).toBe("Architecture overview");
    // 用户自定义中文名（语言包无此值）原样保留
    expect(resolveFragments("我的自定义视图")).toBe("我的自定义视图");
    // 带 key 片段的模板串仍按 key 解引用（不受整段反查干扰）
    const tpl = 'analyzer.php.name 提供的「analyzer.php.entity.class.name」实体';
    const out = resolveFragments(tpl);
    expect(out).toContain("PHP Analyzer");
    expect(out).toContain("Class");
  });

  it("外观预设（appearance.profile.*）key 解引用", () => {
    // 内置预设 name/description 存 key，渲染侧 resolveFragments 随语言切换
    expect(resolveFragments("appearance.profile.office.name")).toBe("Standard Office");
    expect(resolveFragments("appearance.profile.monitor.desc")).toContain("data monitoring");
    expect(resolveFragments("appearance.profile.night.name")).toBe("Night Mode");
    // 用户自定义 profile 名（真实文本，非 key）原样保留
    expect(resolveFragments("我的自定义方案")).toBe("我的自定义方案");
  });

  it("日志卫生 / 注释占比画像 key 解引用（R42）", () => {
    expect(resolveFragments("editorPage.portrait.logging.label")).toBe("Logging hygiene");
    expect(resolveFragments("editorPage.portrait.commentRatio.label")).toBe("Comment ratio");
    expect(t("portrait.metric.logging", { l: 2, s: 1 })).toBe("2 leak(s) · 1 swallowed error(s)");
    expect(t("portrait.metric.commentRatio", { pct: 3, c: 10, t: 300 })).toBe("3% comments · 10/300 lines");
  });
});
