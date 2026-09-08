import { describe, it, expect } from "vitest";
import {
  buildInsightReport,
  buildQualityDisclosure,
  stabilityOf,
  insightKindLabel,
  type ReportInsightInput,
} from "../insightReport";
import type { AiContextQualityReport } from "../contextTypes";

const KNOWN = [
  "src/services/userService.ts",
  "src/services/orderService.ts",
  "src/utils/format.ts",
  "src/editor/canvas/ProjectCanvas.tsx",
];

function ins(over: Partial<ReportInsightInput>): ReportInsightInput {
  return {
    id: over.id ?? "i1",
    title: over.title ?? "标题",
    body: over.body ?? "正文",
    kind: over.kind ?? "finding",
    severity: over.severity ?? "medium",
    refs: over.refs ?? [],
    agentId: over.agentId,
    seenCount: over.seenCount,
    firstSeen: over.firstSeen,
    lastSeen: over.lastSeen,
    status: over.status,
    resolvedReason: over.resolvedReason,
    resolvedBy: over.resolvedBy,
  };
}

describe("buildInsightReport 基础汇总", () => {
  it("没有洞察时返回 null —— 报告不该出现一个空章节", () => {
    expect(buildInsightReport([])).toBeNull();
    expect(buildInsightReport(undefined)).toBeNull();
  });

  it("按严重度分组计数，critical + high 计入待办", () => {
    const out = buildInsightReport([
      ins({ id: "a", severity: "critical" }),
      ins({ id: "b", severity: "high" }),
      ins({ id: "c", severity: "low" }),
      ins({ id: "d", severity: "随便写的" }),
    ])!;
    expect(out.total).toBe(4);
    expect(out.bySeverity.critical).toBe(1);
    expect(out.bySeverity.high).toBe(1);
    expect(out.bySeverity.low).toBe(1);
    // 无法识别的严重度归一为 info，而不是丢弃
    expect(out.bySeverity.info).toBe(1);
    expect(out.actionable).toBe(2);
  });

  it("排序与面板同源：严重度优先，同级按确认次数降序", () => {
    const out = buildInsightReport([
      ins({ id: "low", severity: "low", seenCount: 9 }),
      ins({ id: "hi-1", severity: "high", seenCount: 1 }),
      ins({ id: "hi-5", severity: "high", seenCount: 5 }),
      ins({ id: "crit", severity: "critical", seenCount: 1 }),
    ])!;
    expect(out.items.map((i) => i.id)).toEqual(["crit", "hi-5", "hi-1", "low"]);
  });

  it("稳定性分档并统计新增/复现", () => {
    expect(stabilityOf(undefined)).toBe("new");
    expect(stabilityOf(2)).toBe("reconfirmed");
    expect(stabilityOf(7)).toBe("stable");

    const out = buildInsightReport([
      ins({ id: "a", seenCount: 1 }),
      ins({ id: "b", seenCount: 4 }),
      ins({ id: "c", seenCount: 2 }),
    ])!;
    expect(out.newCount).toBe(1);
    expect(out.stableCount).toBe(2);
  });

  it("记录参与产出结论的 Agent —— 证明结论来自用户配置的 Agent", () => {
    const out = buildInsightReport([
      ins({ id: "a", agentId: "agent-x" }),
      ins({ id: "b", agentId: "agent-x" }),
      ins({ id: "c", agentId: "agent-y" }),
      ins({ id: "d" }),
    ])!;
    expect(out.agents.sort()).toEqual(["agent-x", "agent-y"]);
    expect(out.items.find((i) => i.id === "d")!.agentId).toBeNull();
  });

  it("kind 有中文标签，未知 kind 原样保留而不是丢掉", () => {
    expect(insightKindLabel("recommendation")).toBe("建议");
    expect(insightKindLabel("weird-kind")).toBe("weird-kind");
    expect(insightKindLabel("")).toBe("结论");
  });
});

describe("证据核验：抵御幻觉引用", () => {
  it("命中真实文件的引用标为已核实，并拆出行号", () => {
    const out = buildInsightReport(
      [ins({ refs: ["src/services/userService.ts:120"] })],
      { knownPaths: KNOWN },
    )!;
    const ref = out.items[0].refs[0];
    expect(ref.verified).toBe(true);
    expect(ref.path).toBe("src/services/userService.ts");
    expect(ref.line).toBe(120);
    expect(out.unverifiedRefs).toEqual([]);
  });

  it("项目里不存在的路径标为无法核实，且原文保留供人判断", () => {
    const out = buildInsightReport(
      [ins({ refs: ["src/services/GhostService.ts:12"] })],
      { knownPaths: KNOWN },
    )!;
    expect(out.items[0].refs[0].verified).toBe(false);
    expect(out.items[0].unverifiedCount).toBe(1);
    expect(out.unverifiedRefs).toEqual(["src/services/GhostService.ts:12"]);
  });

  it("只写文件名时，仅在项目内唯一才回退命中", () => {
    const out = buildInsightReport([ins({ refs: ["format.ts"] })], {
      knownPaths: KNOWN,
    })!;
    expect(out.items[0].refs[0].verified).toBe(true);
    expect(out.items[0].refs[0].path).toBe("src/utils/format.ts");

    const dup = buildInsightReport([ins({ refs: ["index.ts"] })], {
      knownPaths: ["a/index.ts", "b/index.ts"],
    })!;
    // 同名多处时不猜：标为无法核实好过挂到无辜文件上
    expect(dup.items[0].refs[0].verified).toBe(false);
  });

  it("点名目录也算有效证据", () => {
    const out = buildInsightReport([ins({ refs: ["src/services"] })], {
      knownPaths: KNOWN,
    })!;
    expect(out.items[0].refs[0].verified).toBe(true);
  });

  it("未提供已知路径时不做核验，也不把所有证据判成可疑", () => {
    const out = buildInsightReport([ins({ refs: ["whatever/x.ts:3"] })])!;
    expect(out.items[0].refs[0].verified).toBe(true);
    expect(out.unverifiedRefs).toEqual([]);
  });
});

describe("热点路径聚合", () => {
  it("按被点名次数排序，取最高严重度", () => {
    const out = buildInsightReport(
      [
        ins({ id: "a", severity: "low", refs: ["src/services/userService.ts:1"] }),
        ins({ id: "b", severity: "critical", refs: ["src/services/userService.ts:9"] }),
        ins({ id: "c", severity: "medium", refs: ["src/utils/format.ts"] }),
      ],
      { knownPaths: KNOWN },
    )!;
    expect(out.hotPaths[0]).toMatchObject({
      path: "src/services/userService.ts",
      count: 2,
      severity: "critical",
    });
    expect(out.hotPaths[1].path).toBe("src/utils/format.ts");
  });

  it("同一条洞察多次点名同一文件只记一次，防单条结论刷榜", () => {
    const out = buildInsightReport(
      [
        ins({
          id: "a",
          refs: [
            "src/services/userService.ts:1",
            "src/services/userService.ts:2",
            "src/services/userService.ts:3",
          ],
        }),
      ],
      { knownPaths: KNOWN },
    )!;
    expect(out.hotPaths[0].count).toBe(1);
  });

  it("无法核实的引用不进热点榜", () => {
    const out = buildInsightReport([ins({ refs: ["ghost/x.ts:1"] })], {
      knownPaths: KNOWN,
    })!;
    expect(out.hotPaths).toEqual([]);
  });
});

describe("生命周期收口：resolved 不再计入待办", () => {
  it("resolved 结论不参与 total / bySeverity / actionable / 热点，但进 resolvedItems", () => {
    const out = buildInsightReport([
      ins({ id: "open-1", severity: "high", refs: ["src/services/userService.ts"], status: "open" }),
      ins({ id: "res-1", severity: "critical", refs: ["src/services/orderService.ts"], status: "resolved", resolvedReason: "已重构拆分", resolvedBy: "user" }),
      ins({ id: "res-2", severity: "low", status: "resolved" }),
    ], { knownPaths: KNOWN })!;

    // 主体只含 open
    expect(out.total).toBe(1);
    expect(out.items.map((i) => i.id)).toEqual(["open-1"]);
    expect(out.bySeverity.critical).toBe(0);
    expect(out.bySeverity.high).toBe(1);
    expect(out.actionable).toBe(1);
    expect(out.hotPaths.map((h) => h.path)).toEqual(["src/services/userService.ts"]);

    // resolved 单独成节
    expect(out.resolvedCount).toBe(2);
    expect(out.resolvedItems.map((i) => i.id)).toEqual(["res-1", "res-2"]);
    const res1 = out.resolvedItems.find((i) => i.id === "res-1")!;
    expect(res1.resolvedReason).toBe("已重构拆分");
    expect(res1.resolvedBy).toBe("user");
    // resolved 的引用不污染 unverifiedRefs
    expect(out.unverifiedRefs).toEqual([]);
  });

  it("无 status 字段（旧数据/测试夹具）一律按 open 处理", () => {
    const out = buildInsightReport([
      ins({ id: "a", severity: "high" }),
      ins({ id: "b", severity: "medium", status: "open" }),
    ])!;
    expect(out.total).toBe(2);
    expect(out.resolvedCount).toBe(0);
  });

  it("全是 resolved 时 total 为 0 但 resolvedItems 非空", () => {
    const out = buildInsightReport([
      ins({ id: "r1", severity: "critical", status: "resolved", resolvedReason: "已修复" }),
    ])!;
    expect(out).not.toBeNull();
    expect(out!.total).toBe(0);
    expect(out!.actionable).toBe(0);
    expect(out!.resolvedCount).toBe(1);
    expect(out!.resolvedItems[0].resolvedReason).toBe("已修复");
  });
});

describe("可信度声明", () => {
  const report: AiContextQualityReport = {
    moduleId: "project-scan",
    scopeId: "an-1",
    overall: "unavailable",
    dimensions: [
      { key: "files", label: "文件枚举", observed: 120, quality: { status: "ok", observed: 120 } },
      {
        key: "deps",
        label: "依赖检测",
        observed: 0,
        quality: { status: "unavailable", observed: 0, reason: "未执行依赖阶段", caveat: "不得断言无循环依赖" },
      },
      {
        key: "dataFlow",
        label: "数据流",
        observed: 30,
        quality: { status: "partial", observed: 30, covered: 30, expected: 120 },
      },
    ],
  };

  it("空报告返回 null", () => {
    expect(buildQualityDisclosure(null)).toBeNull();
    expect(
      buildQualityDisclosure({ moduleId: "m", scopeId: "s", overall: "ok", dimensions: [] }),
    ).toBeNull();
  });

  it("盲区与部分覆盖分别列出，并给出可直接印进报告的一句话", () => {
    const d = buildQualityDisclosure(report)!;
    expect(d.blindSpots).toEqual(["依赖检测"]);
    expect(d.partial).toEqual(["数据流"]);
    expect(d.overallLabel).toBe("不可用");
    expect(d.statement).toContain("没查到");
  });

  it("覆盖率换算成百分比，禁令原样带出", () => {
    const d = buildQualityDisclosure(report)!;
    const flow = d.rows.find((r) => r.label === "数据流")!;
    expect(flow.ratio).toBe(25);
    const deps = d.rows.find((r) => r.label === "依赖检测")!;
    expect(deps.caveat).toBe("不得断言无循环依赖");
    expect(deps.reason).toBe("未执行依赖阶段");
  });
});
