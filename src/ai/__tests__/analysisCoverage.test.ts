/**
 * 分析维度覆盖台账的判定测试。
 *
 * 这张台账唯一不能出错的地方是**绿灯的含义**：绿灯必须意味着「这个方面真的被分析过，
 * 且结论仍然对得上当前数据」。一旦绿灯说谎，用户会以为项目的某个方面已经审过了，
 * 从此再也不会去看——比没有台账更危险。下面每条用例都在钉这件事。
 */
import { describe, it, expect } from "vitest";
import {
  buildAnalysisCoverage,
  pickNextPreset,
  summarizeCoverage,
  DEFAULT_STALE_AFTER_HOURS,
} from "../analysisCoverage";
import type { AiAnalysisPreset } from "../contextTypes";
import type { AiAutoAnalysisRun } from "../../services/tauri";

const NOW = 1_700_000_000;

const presets: AiAnalysisPreset[] = [
  { key: "arch", title: { "zh-CN": "架构健康度", "en-US": "Architecture Health" }, description: { "zh-CN": "分层与耦合", "en-US": "Layers and coupling" }, prompt: { "zh-CN": "p1", "en-US": "p1" }, sectionKeys: ["a"] },
  { key: "debt", title: { "zh-CN": "技术债清偿", "en-US": "Tech Debt Payoff" }, description: { "zh-CN": "债务清单", "en-US": "Debt list" }, prompt: { "zh-CN": "p2", "en-US": "p2" }, sectionKeys: ["b"] },
  { key: "hot", title: { "zh-CN": "风险热点攻坚", "en-US": "Risk Hotspot Push" }, description: { "zh-CN": "热点", "en-US": "Hotspots" }, prompt: { "zh-CN": "p3", "en-US": "p3" }, sectionKeys: ["c"] },
];

function run(over: Partial<AiAutoAnalysisRun> = {}): AiAutoAnalysisRun {
  return {
    id: `arun_${Math.random().toString(36).slice(2)}`,
    ruleId: "rule1",
    moduleId: "project-scan",
    scopeId: "analysis1",
    agentId: "agent_user_picked",
    presetKey: "arch",
    packId: "analysis1:project-scan",
    conversationId: "conv1",
    triggerKind: "full-scan",
    status: "triggered",
    detail: "",
    contextDigest: "digest-A",
    createdAt: NOW - 600,
    ...over,
  };
}

describe("buildAnalysisCoverage", () => {
  it("没有任何记录时全部标为「从未分析」", () => {
    const rows = buildAnalysisCoverage(presets, [], { currentDigest: "digest-A", nowSec: NOW });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === "never")).toBe(true);
    expect(rows[0].lastRunAt).toBeNull();
  });

  it("指纹一致时判为新鲜——数据没变就不该重烧 token", () => {
    const rows = buildAnalysisCoverage(presets, [run()], {
      currentDigest: "digest-A",
      nowSec: NOW,
    });
    expect(rows.find((r) => r.presetKey === "arch")?.state).toBe("fresh");
  });

  it("指纹变了判为「结论过期」，即便刚刚才分析过", () => {
    const rows = buildAnalysisCoverage(presets, [run({ createdAt: NOW - 5 })], {
      currentDigest: "digest-B",
      nowSec: NOW,
    });
    const arch = rows.find((r) => r.presetKey === "arch")!;
    expect(arch.state).toBe("stale-data");
    expect(arch.detail).toContain("数据已更新");
  });

  it("指纹未变但超过时间阈值时降级为「待复看」，强度低于数据过期", () => {
    const rows = buildAnalysisCoverage(
      presets,
      [run({ createdAt: NOW - (DEFAULT_STALE_AFTER_HOURS + 1) * 3600 })],
      { currentDigest: "digest-A", nowSec: NOW },
    );
    expect(rows.find((r) => r.presetKey === "arch")?.state).toBe("stale-time");
  });

  it("staleAfterHours<=0 时关闭时间兜底：数据没变就永远算新鲜", () => {
    const rows = buildAnalysisCoverage(presets, [run({ createdAt: NOW - 999 * 3600 })], {
      currentDigest: "digest-A",
      nowSec: NOW,
      staleAfterHours: 0,
    });
    expect(rows.find((r) => r.presetKey === "arch")?.state).toBe("fresh");
  });

  it("历史记录没有指纹时不冒充「已过期」——否则台账上线第一天全是红灯噪音", () => {
    const rows = buildAnalysisCoverage(presets, [run({ contextDigest: "" })], {
      currentDigest: "digest-B",
      nowSec: NOW,
    });
    const arch = rows.find((r) => r.presetKey === "arch")!;
    expect(arch.state).toBe("fresh");
    expect(arch.detail).toContain("无法判断");
  });

  it("skipped / failed 不算覆盖：绿灯必须意味着真的分析过", () => {
    const rows = buildAnalysisCoverage(
      presets,
      [run({ status: "skipped" }), run({ status: "failed", createdAt: NOW - 10 })],
      { currentDigest: "digest-A", nowSec: NOW },
    );
    expect(rows.find((r) => r.presetKey === "arch")?.state).toBe("never");
  });

  it("同一维度多条记录时取最近一次的指纹", () => {
    const rows = buildAnalysisCoverage(
      presets,
      [
        run({ createdAt: NOW - 7200, contextDigest: "old" }),
        run({ createdAt: NOW - 60, contextDigest: "digest-A" }),
      ],
      { currentDigest: "digest-A", nowSec: NOW },
    );
    const arch = rows.find((r) => r.presetKey === "arch")!;
    expect(arch.lastDigest).toBe("digest-A");
    expect(arch.state).toBe("fresh");
  });

  it("带回会话 id，用户能点回去看当时的分析原文", () => {
    const rows = buildAnalysisCoverage(presets, [run({ conversationId: "conv_x" })], {
      nowSec: NOW,
    });
    expect(rows.find((r) => r.presetKey === "arch")?.lastConversationId).toBe("conv_x");
  });
});

describe("pickNextPreset", () => {
  it("优先补「从未分析」的维度", () => {
    const rows = buildAnalysisCoverage(presets, [run({ presetKey: "arch" })], {
      currentDigest: "digest-A",
      nowSec: NOW,
    });
    expect(pickNextPreset(rows)?.presetKey).toBe("debt");
  });

  it("全都分析过时优先挑「数据已变」的，而不是只是久了的", () => {
    const rows = buildAnalysisCoverage(
      presets,
      [
        run({ presetKey: "arch", contextDigest: "old", createdAt: NOW - 60 }),
        run({
          presetKey: "debt",
          contextDigest: "digest-A",
          createdAt: NOW - (DEFAULT_STALE_AFTER_HOURS + 2) * 3600,
        }),
        run({ presetKey: "hot", contextDigest: "digest-A", createdAt: NOW - 30 }),
      ],
      { currentDigest: "digest-A", nowSec: NOW },
    );
    expect(pickNextPreset(rows)?.presetKey).toBe("arch");
  });

  it("同档内取最久没跑的那个——这才叫轮转，而不是卡在同一个维度上", () => {
    const rows = buildAnalysisCoverage(
      presets,
      [
        run({ presetKey: "arch", contextDigest: "old", createdAt: NOW - 60 }),
        run({ presetKey: "debt", contextDigest: "old", createdAt: NOW - 7200 }),
        run({ presetKey: "hot", contextDigest: "digest-A", createdAt: NOW - 30 }),
      ],
      { currentDigest: "digest-A", nowSec: NOW },
    );
    expect(pickNextPreset(rows)?.presetKey).toBe("debt");
  });

  it("全部新鲜时返回 undefined，让调用方明确决定这轮不跑", () => {
    const rows = buildAnalysisCoverage(
      presets,
      presets.map((p) => run({ presetKey: p.key, contextDigest: "digest-A", createdAt: NOW - 30 })),
      { currentDigest: "digest-A", nowSec: NOW },
    );
    expect(pickNextPreset(rows)).toBeUndefined();
    expect(pickNextPreset(rows, { includeFresh: true })?.presetKey).toBeDefined();
  });

  it("includeFresh 时挑最久没看的，避免每轮都复看同一个", () => {
    const rows = buildAnalysisCoverage(
      presets,
      [
        run({ presetKey: "arch", contextDigest: "digest-A", createdAt: NOW - 100 }),
        run({ presetKey: "debt", contextDigest: "digest-A", createdAt: NOW - 900 }),
        run({ presetKey: "hot", contextDigest: "digest-A", createdAt: NOW - 30 }),
      ],
      { currentDigest: "digest-A", nowSec: NOW },
    );
    expect(pickNextPreset(rows, { includeFresh: true })?.presetKey).toBe("debt");
  });

  it("空台账（模块没定义预设）返回 undefined，不应抛错", () => {
    expect(pickNextPreset([])).toBeUndefined();
  });
});

describe("summarizeCoverage", () => {
  it("统计三态与新鲜占比", () => {
    const rows = buildAnalysisCoverage(
      presets,
      [
        run({ presetKey: "arch", contextDigest: "digest-A", createdAt: NOW - 30 }),
        run({ presetKey: "debt", contextDigest: "old", createdAt: NOW - 30 }),
      ],
      { currentDigest: "digest-A", nowSec: NOW },
    );
    const s = summarizeCoverage(rows);
    expect(s).toMatchObject({ total: 3, fresh: 1, stale: 1, never: 1 });
    expect(s.freshRatio).toBeCloseTo(33.3, 1);
  });

  it("没有任何预设时不除零", () => {
    expect(summarizeCoverage([])).toMatchObject({ total: 0, freshRatio: 0 });
  });
});
