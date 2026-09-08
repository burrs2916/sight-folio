import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "../../store/projectStore";
import { scanContextProvider } from "../providers/scanContextProvider";
import { toStampMap } from "../sectionDiff";
import type { AiContextPack } from "../contextTypes";

/**
 * 扫描供给者的分节级增量——端到端的行为约束。
 *
 * 这里守的是整条增量链最容易悄悄失效的一环：
 * 只要 buildPack 在数据没变时产生了不同的指纹（比如把 Date.now() 混进内容、
 * 或用了遍历顺序不稳定的聚合），写库就会每次全量重写、Agent 每轮全量重读，
 * 而功能测试全都照样通过——没人会发现，只有 token 账单知道。
 */

const ANALYSIS_ID = "analysis-incr-test";

/** 装载一份最小但完整的扫描快照到 store */
function loadSnapshot(overrides: Record<string, unknown> = {}) {
  useProjectStore.setState({
    activeAnalysisId: ANALYSIS_ID,
    files: [
      {
        id: "f1",
        analysisId: ANALYSIS_ID,
        relPath: "src/app/main.ts",
        isDirectory: false,
        language: "typescript",
        lineCount: 120,
        sizeBytes: 3200,
      },
      {
        id: "d1",
        analysisId: ANALYSIS_ID,
        relPath: "src/app",
        isDirectory: true,
        language: null,
        lineCount: 0,
        sizeBytes: 0,
      },
    ],
    modules: [],
    dependencies: [],
    layers: [],
    findings: [],
    symbols: [],
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
    watchProjectRoot: "/tmp/demo-project",
    ...overrides,
  } as never);
}

function build(previous?: AiContextPack, now = 1_000): AiContextPack {
  const pack = scanContextProvider.buildPack(ANALYSIS_ID, {
    previousSections: previous ? toStampMap(previous.sections) : undefined,
    now,
  });
  if (!pack) throw new Error("buildPack 返回 null：store 快照未正确装载");
  return pack;
}

describe("扫描上下文 · 分节级增量", () => {
  beforeEach(() => loadSnapshot());

  it("首次构建：全部分节判为变化，且都带上非空指纹", () => {
    const pack = build();
    expect(pack.sections.length).toBeGreaterThan(5);
    expect(pack.changedSections).toEqual(pack.sections.map((s) => s.key));
    expect(pack.unchangedSections).toEqual([]);
    expect(pack.sections.every((s) => s.digest.length > 0)).toBe(true);
    expect(pack.sections.every((s) => s.updatedAt === 1_000)).toBe(true);
  });

  it("数据未变时重建：零变化分节，包指纹保持稳定", () => {
    const first = build(undefined, 1_000);
    const second = build(first, 2_000);

    expect(second.changedSections).toEqual([]);
    expect(second.unchangedSections.length).toBe(second.sections.length);
    // 包指纹必须与上次完全一致，否则「digest 相同就跳过」这条捷径永远命中不了
    expect(second.digest).toBe(first.digest);
    // 每节 updatedAt 都停在首次时间：这是 Agent 判断新鲜度的唯一依据
    expect(second.sections.every((s) => s.updatedAt === 1_000)).toBe(true);
  });

  it("只改一处数据：只有受影响的分节被判为变化，其余原样复用", () => {
    const first = build(undefined, 1_000);

    loadSnapshot({
      techDebt: [
        {
          id: "td1",
          analysisId: ANALYSIS_ID,
          fileId: "f1",
          filePath: "src/app/main.ts",
          line: 42,
          marker: "TODO",
          severity: "medium",
          content: "handle edge case",
        },
      ],
    });
    const second = build(first, 2_000);

    // 技术债这一节必然变；概览含技术债计数，跟着变也是对的
    expect(second.changedSections).toContain("techDebt");
    // 但绝大多数分节不该被牵连
    expect(second.unchangedSections.length).toBeGreaterThan(second.changedSections.length);
    for (const key of ["architecture", "callGraph", "symbols", "clones", "deadCode"]) {
      expect(second.unchangedSections, `分节 ${key} 不该被技术债变更牵连`).toContain(key);
    }
    // 未变分节保留旧时间戳，变化分节盖新时间戳
    const debt = second.sections.find((s) => s.key === "techDebt")!;
    const arch = second.sections.find((s) => s.key === "architecture")!;
    expect(debt.updatedAt).toBe(2_000);
    expect(arch.updatedAt).toBe(1_000);
    expect(second.digest).not.toBe(first.digest);
  });

  it("按预设裁剪分节时，被保留分节的指纹与全量构建一致", () => {
    const full = build(undefined, 1_000);
    const partial = scanContextProvider.buildPack(ANALYSIS_ID, {
      sectionKeys: ["overview", "techDebt"],
      now: 1_000,
    })!;

    expect(partial.sections.map((s) => s.key).sort()).toEqual(["overview", "techDebt"]);
    for (const s of partial.sections) {
      const same = full.sections.find((f) => f.key === s.key)!;
      expect(s.digest, `分节 ${s.key} 在裁剪构建下指纹漂移了`).toBe(same.digest);
    }
  });

  it("token 预算导致正文降级时，指纹必须跟着变（否则库里会留下与指纹不符的陈旧正文）", () => {
    const full = build(undefined, 1_000);
    const squeezed = scanContextProvider.buildPack(ANALYSIS_ID, {
      tokenBudget: 30,
      now: 1_000,
    })!;

    expect(squeezed.truncatedSections.length).toBeGreaterThan(0);
    const key = squeezed.truncatedSections[0];
    const before = full.sections.find((s) => s.key === key)!;
    const after = squeezed.sections.find((s) => s.key === key)!;
    expect(after.digest).not.toBe(before.digest);
  });
});
