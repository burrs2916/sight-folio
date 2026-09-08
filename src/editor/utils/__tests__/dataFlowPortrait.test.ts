import { describe, it, expect } from "vitest";
import {
  buildFlowPortrait,
  roleOf,
  allocateQuota,
  summarizeFlowPortrait,
  FLOW_ROLE_ORDER,
  FLOW_PORTRAIT_LIMIT,
} from "../dataFlowPortrait";
import type { DataFlowFact } from "../../../services/tauri";

interface FactOpts {
  params?: string;
  toReturn?: string;
  propagates?: boolean;
  sinks?: string[];
  callFlows?: unknown[];
  line?: number;
}

function fact(fileId: string, fn: string, o: FactOpts = {}): DataFlowFact {
  return {
    id: `${fileId}::${fn}`,
    analysisId: "a1",
    fileId,
    filePath: `${fileId}.ts`,
    functionName: fn,
    lineNo: o.line ?? 1,
    params: o.params ?? "",
    paramToReturn: o.toReturn ?? "",
    propagates: o.propagates ?? false,
    returnsCallResult: false,
    callFlows: JSON.stringify(o.callFlows ?? []),
    sinks: JSON.stringify(o.sinks ?? []),
    createdAt: 0,
  };
}

describe("roleOf", () => {
  it("写外部状态 → 汇点（优先级高于透传）", () => {
    expect(roleOf(fact("f", "save", { propagates: true, sinks: ["this.cache"] }))).toBe("sink");
  });

  it("输入直达输出 → 透传", () => {
    expect(roleOf(fact("f", "map", { propagates: true, params: "x", toReturn: "x" }))).toBe("conduit");
  });

  it("吃进去不吐出来 → 阻断", () => {
    expect(roleOf(fact("f", "assertOk", { propagates: false, params: "x" }))).toBe("blocker");
  });
});

describe("buildFlowPortrait 三区布局", () => {
  const facts = [
    fact("f-a", "writeLog", { sinks: ["console"], params: "msg" }),
    fact("f-a", "setCache", { sinks: ["this.cache", "GLOBAL"], params: "k,v" }),
    fact("f-b", "normalize", { propagates: true, params: "x", toReturn: "x" }),
    fact("f-b", "pick", { propagates: true, params: "o,k", toReturn: "o" }),
    fact("f-c", "assertShape", { propagates: false, params: "v" }),
  ];

  it("按角色分三区，区头带真实计数", () => {
    const l = buildFlowPortrait(facts);
    expect(l.zones.map((z) => z.role)).toEqual(FLOW_ROLE_ORDER);
    const byRole = Object.fromEntries(l.zones.map((z) => [z.role, z.count]));
    expect(byRole.sink).toBe(2);
    expect(byRole.conduit).toBe(2);
    expect(byRole.blocker).toBe(1);
    expect(l.summary.totalFunctions).toBe(5);
  });

  it("区内按权重降序：写入点多的汇点排前面", () => {
    const l = buildFlowPortrait(facts);
    const sinks = l.nodes.filter((n) => n.role === "sink");
    expect(sinks[0].name).toBe("setCache"); // 2 个写入点 > 1 个
  });

  it("三区横向不重叠（x 区间互斥）", () => {
    const l = buildFlowPortrait(facts, { cols: 2, colW: 100, zoneGap: 50 });
    const maxX = (role: string) =>
      Math.max(...l.nodes.filter((n) => n.role === role).map((n) => n.x));
    const minX = (role: string) =>
      Math.min(...l.nodes.filter((n) => n.role === role).map((n) => n.x));
    expect(maxX("sink")).toBeLessThan(minX("conduit"));
    expect(maxX("conduit")).toBeLessThan(minX("blocker"));
  });

  it("区内按 cols 换行", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      fact("f-x", `fn${i}`, { propagates: true, params: "x", toReturn: "x" })
    );
    const l = buildFlowPortrait(many, { cols: 2, rowH: 60, top: 100 });
    const ys = l.nodes.map((n) => n.y);
    expect(ys).toEqual([100, 100, 160, 160, 220]);
  });

  it("签名把数据流方向写进卡片", () => {
    const l = buildFlowPortrait(facts);
    const norm = l.nodes.find((n) => n.name === "normalize")!;
    expect(norm.signature).toBe("normalize(x) → return(x)");
    const log = l.nodes.find((n) => n.name === "writeLog")!;
    expect(log.signature).toBe("writeLog(msg) → console");
    const assertNode = l.nodes.find((n) => n.name === "assertShape")!;
    expect(assertNode.signature).toContain("⊣"); // 阻断标记
  });

  it("阻断节点给出「影响链在此终止」的人话解释", () => {
    const l = buildFlowPortrait(facts);
    const b = l.nodes.find((n) => n.role === "blocker")!;
    expect(b.reasons.join()).toContain("影响链在此终止");
  });

  it("统计写得最多的目标", () => {
    const l = buildFlowPortrait([
      fact("f", "a", { sinks: ["GLOBAL"] }),
      fact("f", "b", { sinks: ["GLOBAL"] }),
      fact("f", "c", { sinks: ["this.x"] }),
    ]);
    expect(l.summary.topSink).toEqual({ target: "GLOBAL", count: 2 });
  });

  it("阻断占比用于判断剪枝收益", () => {
    const l = buildFlowPortrait([
      fact("f", "a", { propagates: false }),
      fact("f", "b", { propagates: false }),
      fact("f", "c", { propagates: true, params: "x", toReturn: "x" }),
      fact("f", "d", { propagates: true, params: "x", toReturn: "x" }),
    ]);
    expect(l.summary.blockRatio).toBe(0.5);
  });

  it("空输入不炸，summary 全零", () => {
    const l = buildFlowPortrait([]);
    expect(l.nodes).toEqual([]);
    expect(l.summary.totalFunctions).toBe(0);
    expect(l.summary.blockRatio).toBe(0);
    expect(l.summary.topSink).toBeNull();
  });

  it("脏 JSON 不让整张图挂掉", () => {
    const dirty: DataFlowFact = { ...fact("f", "weird"), sinks: "{not json", callFlows: "???" };
    const l = buildFlowPortrait([dirty]);
    expect(l.nodes).toHaveLength(1);
    expect(l.nodes[0].role).toBe("blocker");
    expect(l.nodes[0].sinks).toEqual([]);
  });

  it("callFlows 是对象数组时也能数出条数", () => {
    const f = fact("f", "forward", {
      propagates: true,
      params: "x",
      toReturn: "x",
      callFlows: [{ callee: "g", argIndex: 0 }, { callee: "h", argIndex: 1 }],
    });
    const l = buildFlowPortrait([f]);
    expect(l.nodes[0].callFlowCount).toBe(2);
    expect(l.nodes[0].reasons.join()).toContain("2 处下游调用");
  });

  it("无函数名的脏记录被丢弃", () => {
    const l = buildFlowPortrait([{ ...fact("f", "ok"), functionName: "" }, fact("f", "ok")]);
    expect(l.nodes).toHaveLength(1);
  });
});

describe("allocateQuota 按区配额", () => {
  it("总量不超限时全量放行", () => {
    expect(allocateQuota([3, 4, 5], 100)).toEqual([3, 4, 5]);
  });

  it("超限时先均分，余额让给还有剩余的区", () => {
    // limit=9，均分 base=3 → [3,3,3]，无余额
    expect(allocateQuota([100, 100, 100], 9)).toEqual([3, 3, 3]);
  });

  it("小区吃不满时余额顺延给大区（不浪费配额）", () => {
    // sizes=[1, 100, 100], limit=9 → base=3，sink 只有 1 → 余 2 给后面
    const q = allocateQuota([1, 100, 100], 9);
    expect(q[0]).toBe(1);
    expect(q.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it("汇点区不会被透传区挤没（这是配额制的存在理由）", () => {
    // 全局按权重砍的话 500 个 conduit 会把 20 个 sink 全挤掉；
    // 配额制先保底 base=10，blocker 区为空腾出的 10 个名额再顺延给 sink → sink 全进。
    const sinks = Array.from({ length: 20 }, (_, i) => fact("f", `s${i}`, { sinks: ["G"] }));
    const conduits = Array.from({ length: 500 }, (_, i) =>
      fact("f", `c${i}`, { propagates: true, params: "x", toReturn: "x" })
    );
    const l = buildFlowPortrait([...conduits, ...sinks], { limit: 30 });
    expect(l.nodes.filter((n) => n.role === "sink").length).toBe(20);
    expect(l.nodes.filter((n) => n.role === "conduit").length).toBe(10);
    expect(l.nodes.length).toBe(30);
    expect(l.summary.truncated).toBe(490);
  });

  it("三区都超额时严格均分，谁也不许多吃", () => {
    const mk = (n: number, o: FactOpts) =>
      Array.from({ length: n }, (_, i) => fact("f", `${JSON.stringify(o).length}-${i}`, o));
    const l = buildFlowPortrait(
      [
        ...mk(50, { sinks: ["G"] }),
        ...mk(50, { propagates: true, params: "x", toReturn: "x" }),
        ...mk(50, { propagates: false, params: "x" }),
      ],
      { limit: 30 }
    );
    for (const role of FLOW_ROLE_ORDER) {
      expect(l.nodes.filter((n) => n.role === role).length).toBe(10);
    }
  });

  it("空数组返回空", () => {
    expect(allocateQuota([], 10)).toEqual([]);
  });
});

describe("summarizeFlowPortrait", () => {
  it("无数据时给出明确提示", () => {
    expect(summarizeFlowPortrait(buildFlowPortrait([]))).toContain("暂无摘要数据");
  });

  it("有数据时一句话讲清三区分布", () => {
    const txt = summarizeFlowPortrait(
      buildFlowPortrait([
        fact("f", "a", { sinks: ["console"] }),
        fact("f", "b", { propagates: true, params: "x", toReturn: "x" }),
        fact("f", "c", { propagates: false }),
      ])
    );
    expect(txt).toContain("3 个函数摘要");
    expect(txt).toContain("汇点 1");
    expect(txt).toContain("透传 1");
    expect(txt).toContain("阻断 1");
    expect(txt).toContain("console");
  });

  it("默认上限是一屏可读量级", () => {
    expect(FLOW_PORTRAIT_LIMIT).toBeGreaterThan(60);
    expect(FLOW_PORTRAIT_LIMIT).toBeLessThanOrEqual(300);
  });
});
