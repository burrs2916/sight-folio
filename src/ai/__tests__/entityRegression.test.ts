/**
 * 实体回归的判定口径。
 *
 * 这一层最贵的错误全是「看起来很正常的假话」：
 *   · 删掉一个遗留模块 → 榜单少了一行 → 报「已修复」，改善曲线一片绿；
 *   · 新增一个大文件挤上榜 → 把别人挤下去 → 报「一批文件被治愈」；
 *   · 这次没跑 Git → churn 归零 → 报「变更热度大幅下降」；
 *   · 别的文件恶化让分位重排 → 一行没改的文件也「变坏了」。
 * 四句话都长得像真结论，人和 Agent 都不会怀疑。下面逐条钉死。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AiContextProvider, AiEntityRecord, AiEntitySnapshot } from "../contextTypes";

const recordEntitySnapshot = vi.fn(async (_i: any) => ["esnap_1", true] as [string, boolean]);
const listEntitySnapshots = vi.fn(async (_m: string, _s: string, _l?: number) => [] as any[]);

vi.mock("../../services/tauri", () => ({
  aiContextApi: {
    recordEntitySnapshot: (i: any) => recordEntitySnapshot(i),
    listEntitySnapshots: (m: string, s: string, l?: number) => listEntitySnapshots(m, s, l),
  },
}));

const {
  buildEntityRegressionReport,
  fingerprintEntities,
  captureEntitySnapshot,
  loadEntityRegression,
  readEntityRegression,
  resetEntityRegressionCache,
  parseEntitySnapshotRow,
} = await import("../entityRegression");

const MODULE = "test-module";
const SCOPE = "analysis-reg";
const HOUR = 3_600_000;

const DIMS = [
  { key: "complexity", label: "复杂度", unit: "", better: "lower" as const, minDelta: 2 },
  { key: "churn", label: "变更热度", unit: "次", better: "lower" as const },
  { key: "clone", label: "重复行", unit: "行", better: "lower" as const },
];

function ent(
  id: string,
  score: number,
  dims: Record<string, number>,
  over: Partial<AiEntityRecord> = {},
): AiEntityRecord {
  return { id, score, rank: 1, resonance: 1, dims, ...over };
}

function board(
  takenAt: number,
  entities: AiEntityRecord[],
  over: Partial<AiEntitySnapshot> = {},
): AiEntitySnapshot {
  const coverage =
    over.coverage ?? DIMS.map((d) => ({ key: d.key, available: true }));
  return {
    moduleId: MODULE,
    scopeId: SCOPE,
    digest: fingerprintEntities(entities, coverage),
    takenAt,
    entityLabel: "文件",
    entities: entities.map((e, i) => ({ ...e, rank: i + 1 })),
    total: entities.length,
    cutoff: entities.length ? entities[entities.length - 1].score : 0,
    coverage,
    dimensions: DIMS,
    survivedIds: over.survivedIds,
    ...over,
  };
}

function report(snapshots: AiEntitySnapshot[]) {
  return buildEntityRegressionReport(MODULE, SCOPE, snapshots);
}

beforeEach(() => {
  resetEntityRegressionCache();
  recordEntitySnapshot.mockClear();
  listEntitySnapshots.mockClear();
  listEntitySnapshots.mockResolvedValue([]);
});

describe("铁律①：新上榜单列 appeared，不混进恶化榜", () => {
  it("新文件不算变坏", () => {
    const before = board(0, [ent("src/a.ts", 60, { complexity: 30 })]);
    const after = board(HOUR, [
      ent("src/a.ts", 60, { complexity: 30 }),
      ent("src/new.ts", 55, { complexity: 28 }),
    ]);
    const r = report([after, before]);
    expect(r.appeared).toBe(1);
    expect(r.worsened).toBe(0);
    expect(r.entities.find((e) => e.id === "src/new.ts")?.change).toBe("appeared");
  });

  it("只有新增时 verdict 不判 regressing", () => {
    const before = board(0, [ent("src/a.ts", 60, { complexity: 30 })]);
    const after = board(HOUR, [
      ent("src/a.ts", 60, { complexity: 30 }),
      ent("src/new.ts", 90, { complexity: 80 }),
    ]);
    expect(report([after, before]).verdict).not.toBe("regressing");
  });
});

describe("铁律②：截断边界不判「已修复」", () => {
  const prev = board(0, [
    ent("src/a.ts", 80, { complexity: 40 }),
    ent("src/b.ts", 50, { complexity: 25 }),
  ]);

  it("旧分数高于当前门槛，缺席才算真的降下来了", () => {
    // 当前榜被截断（total 远大于榜长），门槛 60；b 旧分 50 < 60 → 不可判
    const cur = board(HOUR, [ent("src/a.ts", 80, { complexity: 40 }), ent("src/c.ts", 60, { complexity: 30 })], {
      total: 200,
      survivedIds: ["src/a.ts", "src/b.ts"],
    });
    const b = report([cur, prev]).entities.find((e) => e.id === "src/b.ts");
    expect(b?.change).toBe("incomparable");
    expect(b?.reason).toContain("门槛");
  });

  it("旧分数低于门槛时判不可比，绝不报改善", () => {
    const cur = board(HOUR, [ent("src/x.ts", 95, { complexity: 60 }), ent("src/y.ts", 90, { complexity: 55 })], {
      total: 500,
      survivedIds: ["src/a.ts", "src/b.ts"],
    });
    const r = report([cur, prev]);
    // a 旧分 80 > 门槛 90？不 —— 门槛是 90，80 < 90，所以不可比
    expect(r.entities.find((e) => e.id === "src/a.ts")?.change).toBe("incomparable");
    expect(r.improved).toBe(0);
  });

  it("旧分数确实高于门槛时给出改善，但必须标注为推断上界", () => {
    const cur = board(HOUR, [ent("src/c.ts", 30, { complexity: 15 })], {
      total: 200,
      survivedIds: ["src/a.ts", "src/b.ts"],
    });
    const a = report([cur, prev]).entities.find((e) => e.id === "src/a.ts");
    expect(a?.change).toBe("improved");
    expect(a?.approx).toBe(true);
    expect(a?.scoreTo).toBe(30);
  });

  it("榜单没被截断时，掉出名单就是真的没有风险信号了", () => {
    const cur = board(HOUR, [ent("src/b.ts", 50, { complexity: 25 })], {
      survivedIds: ["src/a.ts", "src/b.ts"],
    });
    const a = report([cur, prev]).entities.find((e) => e.id === "src/a.ts");
    expect(a?.change).toBe("improved");
    expect(a?.scoreTo).toBe(0);
  });
});

describe("铁律③：实体消失判 removed，不判 improved", () => {
  it("文件被删不计入改善", () => {
    const prev = board(0, [
      ent("src/legacy.ts", 90, { complexity: 70 }),
      ent("src/a.ts", 40, { complexity: 20 }),
    ]);
    const cur = board(HOUR, [ent("src/a.ts", 40, { complexity: 20 })], {
      survivedIds: ["src/a.ts"], // legacy 不在存活名单里
    });
    const r = report([cur, prev]);
    const legacy = r.entities.find((e) => e.id === "src/legacy.ts");
    expect(legacy?.change).toBe("removed");
    expect(r.improved).toBe(0);
    expect(r.removed).toBe(1);
    expect(r.note).toContain("不计入改善");
  });

  it("存活名单明显失真时宁可判不可比", () => {
    // survivedIds 为空，但基线里的 a 明明还在当前榜上 —— 这份名单是假的
    const prev = board(0, [ent("src/a.ts", 60, { complexity: 30 }), ent("src/b.ts", 50, { complexity: 25 })]);
    const cur = board(HOUR, [ent("src/a.ts", 60, { complexity: 30 })], { survivedIds: [] });
    const b = report([cur, prev]).entities.find((e) => e.id === "src/b.ts");
    expect(b?.change).toBe("incomparable");
    expect(b?.reason).toContain("是否仍然存在");
  });
});

describe("铁律④：维度盲区逐维不可比，口径变化时整体分数不可比", () => {
  it("Git 这次没跑，churn 归零不算改善", () => {
    const cov = (git: boolean) => [
      { key: "complexity", available: true },
      { key: "churn", available: git },
      { key: "clone", available: true },
    ];
    const prev = board(0, [ent("src/a.ts", 70, { complexity: 30, churn: 40, clone: 0 })], {
      coverage: cov(true),
    });
    const cur = board(HOUR, [ent("src/a.ts", 55, { complexity: 30, churn: 0, clone: 0 })], {
      coverage: cov(false),
    });
    const r = report([cur, prev]);
    expect(r.comparableDims).not.toContain("churn");
    expect(r.blindDims.map((b) => b.key)).toContain("churn");
    expect(r.improved).toBe(0);
    // churn 归零被整维排除，剩下的维度一动没动 → 判持平（flat 不进明细）
    expect(r.flat).toBe(1);
    expect(r.entities).toEqual([]);
  });

  it("可用维度集合变了，综合分整体不可比", () => {
    const prev = board(0, [ent("src/a.ts", 70, { complexity: 30 })], {
      coverage: [
        { key: "complexity", available: true },
        { key: "churn", available: true },
      ],
    });
    const cur = board(HOUR, [ent("src/a.ts", 40, { complexity: 60 })], {
      coverage: [{ key: "complexity", available: true }],
    });
    const r = report([cur, prev]);
    expect(r.scoreComparable).toBe(false);
    expect(r.note).toContain("综合分不可比");
    const a = r.entities.find((e) => e.id === "src/a.ts");
    // 逐维仍然可比：复杂度确实翻了一倍，该说；但综合分一律不给
    expect(a?.change).toBe("worsened");
    expect(a?.scoreFrom).toBeNull();
    expect(a?.scoreDelta).toBeNull();
  });

  it("完全没有共同可用维度时整体判不可比", () => {
    const prev = board(0, [ent("src/a.ts", 70, { churn: 40 })], {
      coverage: [{ key: "churn", available: true }],
    });
    const cur = board(HOUR, [ent("src/a.ts", 70, { complexity: 40 })], {
      coverage: [{ key: "complexity", available: true }],
    });
    const r = report([cur, prev]);
    expect(r.comparableDims).toEqual([]);
    expect(r.entities.find((e) => e.id === "src/a.ts")?.change).toBe("incomparable");
  });
});

describe("方向判定落在原始维度值上，不落在综合分上", () => {
  it("综合分涨了但各维度一行没改，判 flat 而不是 worsened", () => {
    // 分位打分对「别的文件动了」很敏感：a 自身没变，分数却从 40 涨到 62。
    // 拿分数判方向，这里就会凭空报出一个「恶化」。
    const prev = board(0, [ent("src/a.ts", 40, { complexity: 20, churn: 5, clone: 0 })]);
    const cur = board(HOUR, [ent("src/a.ts", 62, { complexity: 20, churn: 5, clone: 0 })]);
    const r = report([cur, prev]);
    expect(r.worsened).toBe(0);
    expect(r.flat).toBe(1);
  });

  it("维度真的涨了才算变坏，并给出主因", () => {
    const prev = board(0, [ent("src/a.ts", 40, { complexity: 20, churn: 50, clone: 10 })]);
    const cur = board(HOUR, [ent("src/a.ts", 41, { complexity: 44, churn: 51, clone: 10 })]);
    const a = report([cur, prev]).entities.find((e) => e.id === "src/a.ts");
    expect(a?.change).toBe("worsened");
    expect(a?.driver).toBe("complexity");
    expect(a?.dims.find((d) => d.key === "complexity")?.direction).toBe("worsened");
    // churn 只动了 2%，属于抖动，不该出现在明细里
    expect(a?.dims.some((d) => d.key === "churn")).toBe(false);
  });

  it("模块给的绝对下限能挡住小幅抖动", () => {
    // complexity 的 minDelta = 2，20 → 21 只是抖动
    const prev = board(0, [ent("src/a.ts", 40, { complexity: 20 })]);
    const cur = board(HOUR, [ent("src/a.ts", 40, { complexity: 21 })]);
    const r = report([cur, prev]);
    expect(r.worsened).toBe(0);
    expect(r.flat).toBe(1);
  });

  it("有涨有跌时跟随主因维度", () => {
    const prev = board(0, [ent("src/a.ts", 40, { complexity: 100, clone: 10 })]);
    const cur = board(HOUR, [ent("src/a.ts", 40, { complexity: 80, clone: 200 })]);
    const a = report([cur, prev]).entities.find((e) => e.id === "src/a.ts");
    expect(a?.driver).toBe("clone");
    expect(a?.change).toBe("worsened");
    expect(a?.reason).toContain("主因维度");
  });
});

describe("诚实的兜底", () => {
  it("只有一个点时如实说还没有历史，不判 flat", () => {
    const r = report([board(0, [ent("src/a.ts", 40, { complexity: 20 })])]);
    expect(r.verdict).toBe("insufficient");
    expect(r.baseline).toBeNull();
    expect(r.note).toContain("第一次记录");
  });

  it("一个点都没有时也不崩", () => {
    const r = report([]);
    expect(r.verdict).toBe("insufficient");
    expect(r.entities).toEqual([]);
  });

  it("flat 实体不进明细但计入统计", () => {
    const prev = board(0, [ent("src/a.ts", 40, { complexity: 20 }), ent("src/b.ts", 30, { complexity: 15 })]);
    const cur = board(HOUR, [ent("src/a.ts", 40, { complexity: 20 }), ent("src/b.ts", 30, { complexity: 15 })]);
    const r = report([cur, prev]);
    expect(r.flat).toBe(2);
    expect(r.entities).toEqual([]);
    expect(r.verdict).toBe("flat");
  });

  it("恶化排在新增与改善之前", () => {
    const prev = board(0, [
      ent("src/w.ts", 50, { complexity: 20 }),
      ent("src/i.ts", 50, { complexity: 40 }),
    ]);
    const cur = board(HOUR, [
      ent("src/w.ts", 50, { complexity: 60 }),
      ent("src/i.ts", 50, { complexity: 10 }),
      ent("src/n.ts", 50, { complexity: 30 }),
    ]);
    expect(report([cur, prev]).entities.map((e) => e.change)).toEqual([
      "worsened",
      "appeared",
      "improved",
    ]);
  });
});

describe("指纹", () => {
  it("原始维度值变了就是新的点，哪怕分数与名次没动", () => {
    const cov = [{ key: "complexity", available: true }];
    const a = fingerprintEntities([ent("src/a.ts", 50, { complexity: 20 })], cov);
    const b = fingerprintEntities([ent("src/a.ts", 50, { complexity: 33 })], cov);
    expect(a).not.toBe(b);
  });

  it("覆盖面变了也是新的点：要能区分「没跑」和「跑了但一样」", () => {
    const e = [ent("src/a.ts", 50, { complexity: 20 })];
    const a = fingerprintEntities(e, [{ key: "git", available: true }]);
    const b = fingerprintEntities(e, [{ key: "git", available: false }]);
    expect(a).not.toBe(b);
  });

  it("顺序无关", () => {
    const cov = [{ key: "complexity", available: true }];
    const x = ent("src/x.ts", 50, { complexity: 20 });
    const y = ent("src/y.ts", 40, { complexity: 10 });
    expect(fingerprintEntities([x, y], cov)).toBe(fingerprintEntities([y, x], cov));
  });
});

describe("采集链路", () => {
  const provider = {
    moduleId: MODULE,
    label: "测试模块",
    description: "",
    isAvailable: () => true,
    buildPack: () => null,
  } as unknown as AiContextProvider;

  it("采集前把上一批实体 id 交给模块，让它回答「还在不在」", async () => {
    const prior = board(0, [ent("src/a.ts", 60, { complexity: 30 })]);
    listEntitySnapshots.mockResolvedValue([
      {
        id: "e0",
        moduleId: MODULE,
        scopeId: SCOPE,
        digest: prior.digest,
        triggerKind: "full-scan",
        entityLabel: "文件",
        entitiesJson: JSON.stringify(prior.entities),
        coverageJson: JSON.stringify(prior.coverage),
        dimensionsJson: JSON.stringify(DIMS),
        survivedJson: "[]",
        total: 1,
        cutoff: 60,
        firstAt: 0,
        lastAt: 0,
        seenCount: 1,
      },
    ]);
    const collect = vi.fn((_s: string, previousIds?: string[]) =>
      board(HOUR, [ent("src/a.ts", 70, { complexity: 50 })], {
        survivedIds: previousIds,
      }),
    );
    await captureEntitySnapshot({ ...provider, collectEntitySnapshot: collect }, SCOPE);
    expect(collect).toHaveBeenCalledWith(SCOPE, ["src/a.ts"]);
    expect(recordEntitySnapshot).toHaveBeenCalledTimes(1);
    expect(recordEntitySnapshot.mock.calls[0][0].survivedJson).toBe('["src/a.ts"]');
  });

  it("模块没实现钩子时整条链路静默关闭", async () => {
    expect(await captureEntitySnapshot(provider, SCOPE)).toBeNull();
    expect(recordEntitySnapshot).not.toHaveBeenCalled();
  });

  it("落库失败不影响主流程", async () => {
    recordEntitySnapshot.mockRejectedValueOnce(new Error("db down"));
    const collect = () => board(HOUR, [ent("src/a.ts", 70, { complexity: 50 })]);
    expect(
      await captureEntitySnapshot({ ...provider, collectEntitySnapshot: collect }, SCOPE),
    ).toBeNull();
  });

  it("只读加载不写库", async () => {
    listEntitySnapshots.mockResolvedValue([]);
    expect(await loadEntityRegression(MODULE, SCOPE)).toBeNull();
    expect(recordEntitySnapshot).not.toHaveBeenCalled();
  });

  it("缓存供同步的 buildPack 读取", async () => {
    expect(readEntityRegression(MODULE, SCOPE)).toBeNull();
    const collect = () => board(HOUR, [ent("src/a.ts", 70, { complexity: 50 })]);
    await captureEntitySnapshot({ ...provider, collectEntitySnapshot: collect }, SCOPE);
    expect(readEntityRegression(MODULE, SCOPE)).not.toBeNull();
  });
});

describe("库行解析", () => {
  it("损坏的 JSON 返回 null 而不是抛异常", () => {
    expect(
      parseEntitySnapshotRow({ entitiesJson: "{oops", moduleId: MODULE } as any),
    ).toBeNull();
  });

  it("截断边界字段完整还原", () => {
    const s = parseEntitySnapshotRow({
      id: "e1",
      moduleId: MODULE,
      scopeId: SCOPE,
      digest: "d",
      triggerKind: "",
      entityLabel: "文件",
      entitiesJson: JSON.stringify([ent("src/a.ts", 50, { complexity: 20 })]),
      coverageJson: "[]",
      dimensionsJson: JSON.stringify(DIMS),
      survivedJson: '["src/a.ts"]',
      total: 137,
      cutoff: 42.5,
      firstAt: 10,
      lastAt: 20,
      seenCount: 3,
    } as any);
    expect(s?.total).toBe(137);
    expect(s?.cutoff).toBe(42.5);
    expect(s?.survivedIds).toEqual(["src/a.ts"]);
    expect(s?.takenAt).toBe(10_000);
  });
});
