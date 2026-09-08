/**
 * insightFeedback —— 「AI 自己的结论回流成下一轮注意力」的纯函数回归测试。
 *
 * 这套判定守的是两类相反的错误，两类都很贵、都不报错：
 *   · **不收敛**——Agent 复核后判定「结论仍成立」于是什么都没写，若用「洞察有没有更新」
 *     当销账依据，这个文件会被每一轮重新点名，无限烧钱且账面全绿；
 *   · **假阴性**——读库失败被当成「没有结论」，待复核的文件被静默降级成「从未分析过」，
 *     反而排到更后面，一条过期结论从此永远挂在面板上误导人。
 *
 * 另有一条独立的死循环要守：账本是 derived 分节，绝不能进包指纹。
 */
import { describe, it, expect } from "vitest";
import {
  buildInsightFeedback,
  buildInsightLedgerSection,
  emptyInsightFeedback,
  needsRecheck,
  refPath,
  INSIGHT_LEDGER_KEY,
} from "../insightFeedback";
import { packDigestFromSections, sectionDigest } from "../sectionDiff";
import type { AiInsightDto } from "../../services/tauri";

function insight(over: Partial<AiInsightDto> = {}): AiInsightDto {
  return {
    id: "ins_1",
    packId: "scope:mod",
    analysisId: "scope",
    agentId: null,
    kind: "risk",
    title: "循环依赖",
    body: "…",
    severity: "high",
    refs: ["src/a.ts:10"],
    status: "open",
    lastSeen: 1000,
    changedRefs: [],
    missingRefs: [],
    evidenceDigest: "e1",
    ...over,
  };
}

describe("refPath · 与后端 normalize_ref_path 同口径", () => {
  it("剥掉结尾行号与行号区间", () => {
    expect(refPath("src/a.ts:10")).toBe("src/a.ts");
    expect(refPath("src/a.ts:10-20")).toBe("src/a.ts");
    expect(refPath("./src/a.ts")).toBe("src/a.ts");
  });

  it("不误伤路径中间的冒号（Windows 盘符 / URL 形态）", () => {
    expect(refPath("C:/proj/a.ts")).toBe("C:/proj/a.ts");
  });
});

describe("buildInsightFeedback · 四个信号的判定", () => {
  it("证据已变 → recheck（最高优先级，哪怕同一文件还有别的正常结论）", () => {
    const fb = buildInsightFeedback([
      insight({ id: "a", changedRefs: ["src/a.ts:10"] }),
      insight({ id: "b", title: "上帝类" }),
    ]);
    const sig = fb.byFile.get("src/a.ts")!;
    expect(sig.signal).toBe("recheck");
    expect(sig.openCount).toBe(2);
    expect(sig.staleCount).toBe(1);
  });

  it("证据文件已不存在 → orphaned（优先于 confirmed，但不该动用点名名额）", () => {
    const fb = buildInsightFeedback([insight({ missingRefs: ["src/a.ts"] })]);
    expect(fb.byFile.get("src/a.ts")!.signal).toBe("orphaned");
  });

  it("有 open 结论且证据未变 → confirmed", () => {
    expect(buildInsightFeedback([insight()]).byFile.get("src/a.ts")!.signal).toBe("confirmed");
  });

  it("只剩已收口结论 → settled（降权，但仍留在榜上）", () => {
    const fb = buildInsightFeedback([insight({ status: "resolved" })]);
    const sig = fb.byFile.get("src/a.ts")!;
    expect(sig.signal).toBe("settled");
    // 关键：它**没有**从 byFile 里消失。永久排除等于让模型的一次误判获得终身豁免权
    expect(fb.byFile.has("src/a.ts")).toBe(true);
  });

  it("已收口结论的证据变化不把文件拉回复核队列——那事已经交代过了", () => {
    const fb = buildInsightFeedback([
      insight({ status: "resolved", changedRefs: ["src/a.ts:10"] }),
    ]);
    expect(fb.byFile.get("src/a.ts")!.signal).toBe("settled");
    expect(fb.summary.recheckFiles).toBe(0);
  });

  it("无 refs 的结论（unanchored）计入总数但不归档到任何文件", () => {
    const fb = buildInsightFeedback([insight({ refs: [] })]);
    expect(fb.summary.insights).toBe(1);
    expect(fb.byFile.size).toBe(0);
  });

  it("一条结论引用多个文件时，每个文件各自成信号", () => {
    const fb = buildInsightFeedback([
      insight({ refs: ["src/a.ts:1", "src/b.ts:2"], changedRefs: ["src/b.ts:2"] }),
    ]);
    expect(fb.byFile.get("src/a.ts")!.signal).toBe("confirmed");
    expect(fb.byFile.get("src/b.ts")!.signal).toBe("recheck");
  });

  it("待复核队列按严重度排序：已知 critical 比已知 low 更该先看", () => {
    const fb = buildInsightFeedback([
      insight({ id: "l", refs: ["low.ts:1"], severity: "low", changedRefs: ["low.ts:1"] }),
      insight({ id: "c", refs: ["crit.ts:1"], severity: "critical", changedRefs: ["crit.ts:1"] }),
    ]);
    expect(fb.recheck.map((r) => r.filePath)).toEqual(["crit.ts", "low.ts"]);
  });

  it("空列表 available=true，读库失败 available=false —— 两者绝不能混为一谈", () => {
    expect(buildInsightFeedback([]).available).toBe(true);
    expect(buildInsightFeedback(null, { available: false }).available).toBe(false);
    expect(emptyInsightFeedback(false).available).toBe(false);
  });

  it("证据指纹与查询顺序无关（否则同一状态会算出两个指纹，复核永不收敛）", () => {
    const a = insight({ id: "1", evidenceDigest: "x" });
    const b = insight({ id: "2", evidenceDigest: "y" });
    const f1 = buildInsightFeedback([a, b]).byFile.get("src/a.ts")!.evidenceDigest;
    const f2 = buildInsightFeedback([b, a]).byFile.get("src/a.ts")!.evidenceDigest;
    expect(f1).toBe(f2);
  });
});

/**
 * 收敛性：这是本特性最容易写错、也最贵的一处。
 *
 * 「派单即销账」在 focusPatrol 里是靠指纹记账实现的；复核这一档如果改用
 * 「洞察有没有被更新」判断，Agent 复核后什么都不写时就会被永久重复点名。
 */
describe("needsRecheck · 复核必须能收敛", () => {
  const sig = (over: Record<string, unknown> = {}) =>
    ({
      filePath: "src/a.ts",
      signal: "recheck",
      openCount: 1,
      staleCount: 1,
      orphanCount: 0,
      resolvedCount: 0,
      maxSeverity: "high",
      lastSeenAt: 1,
      headline: "",
      evidenceDigest: "E1",
      note: "",
      ...over,
    }) as never;

  it("非 recheck 信号一律不派复核单", () => {
    expect(needsRecheck(sig({ signal: "confirmed" }), "")).toBe(false);
    expect(needsRecheck(undefined, "")).toBe(false);
  });

  it("从未记账过 → 欠一次（宁可多看一次，也不让过期结论永远挂着）", () => {
    expect(needsRecheck(sig(), "")).toBe(true);
    expect(needsRecheck(sig(), null)).toBe(true);
  });

  it("已为这次证据变化派过单 → 不再重派（Agent 什么都没写也算办过）", () => {
    expect(needsRecheck(sig(), "E1")).toBe(false);
  });

  it("派单之后证据又变了 → 重新排队（一次派单不等于终身免检）", () => {
    expect(needsRecheck(sig({ evidenceDigest: "E2" }), "E1")).toBe(true);
  });
});

describe("buildInsightLedgerSection · 派生分节", () => {
  it("标记 derived，且不进包指纹——否则「存一条结论」会自我触发下一轮分析", () => {
    const empty = buildInsightLedgerSection(emptyInsightFeedback(true));
    const withData = buildInsightLedgerSection(
      buildInsightFeedback([insight({ changedRefs: ["src/a.ts:10"] })]),
    );
    expect(withData.derived).toBe(true);

    // 两份内容确实不同（否则下面的断言是空过）
    expect(sectionDigest(empty)).not.toBe(sectionDigest(withData));

    const other = { key: "overview", content: "x", digest: "d-overview" } as never;
    const stamp = (s: typeof empty) => ({ ...s, digest: sectionDigest(s) });
    expect(packDigestFromSections("scope", 1, [other, stamp(empty)])).toBe(
      packDigestFromSections("scope", 1, [other, stamp(withData)]),
    );
  });

  it("待复核文件写进正文，Agent 不必先拉全量历史就知道该处理谁", () => {
    const s = buildInsightLedgerSection(
      buildInsightFeedback([insight({ changedRefs: ["src/a.ts:10"] })]),
    );
    expect(s.key).toBe(INSIGHT_LEDGER_KEY);
    expect(s.content).toContain("src/a.ts");
    expect(s.facts?.recheckPaths).toEqual(["src/a.ts"]);
  });

  it("「一条都没有」标 empty 并明说不等于没问题；读库失败标 unavailable", () => {
    const none = buildInsightLedgerSection(emptyInsightFeedback(true));
    expect(none.dataQuality?.status).toBe("empty");
    expect(none.dataQuality?.caveat).toContain("不等于");

    const broken = buildInsightLedgerSection(emptyInsightFeedback(false));
    expect(broken.dataQuality?.status).toBe("unavailable");
    // 这条最要紧：缺失会被 Agent 读成「以前没分析过」，比读取失败本身更糟
    expect(broken.content).toContain("不要据此判断");
  });

  it("已确认待办明确劝阻重复保存——重复结论是这条链路上最常见的浪费", () => {
    const s = buildInsightLedgerSection(buildInsightFeedback([insight()]));
    expect(s.content).toContain("不要重复保存");
  });
});
