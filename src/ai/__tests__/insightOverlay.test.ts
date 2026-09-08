/**
 * insightOverlay 单测 —— 把 AI 结论对齐到画布实体的那一层。
 *
 * 这层最容易出的错不是"没标出来"，而是"标错了"：模型写的引用格式五花八门，
 * 稍微宽松一点就会把 `index.ts` 标到错误的那一个上。用户照着角标去改一个
 * 根本没问题的文件之后，就不会再信任这个角标了。所以歧义场景是这里的重点。
 */
import { describe, it, expect } from "vitest";
import {
  buildInsightMarks,
  insightsForPath,
  normalizeRefPath,
  normalizeSeverity,
  resolveMarkedPaths,
  type InsightLike,
} from "../insightOverlay";

const KNOWN = [
  "src/store/projectStore.ts",
  "src/ai/insightOverlay.ts",
  "src/ai/AiInsightsPanel.tsx",
  "src/editor/renderers/FileRenderer.tsx",
  "src/utils/index.ts",
  "src/editor/index.ts",
  "README.md",
];

function ins(over: Partial<InsightLike> & { id: string }): InsightLike {
  return { title: "t-" + over.id, severity: "high", refs: [], ...over };
}

describe("normalizeRefPath", () => {
  it("拆出行号并保留纯路径", () => {
    expect(normalizeRefPath("src/a.ts:120")).toEqual({ path: "src/a.ts", line: 120 });
  });

  it("没有行号时 line 为 null", () => {
    expect(normalizeRefPath("src/a.ts")).toEqual({ path: "src/a.ts", line: null });
  });

  it("反斜杠统一成正斜杠", () => {
    expect(normalizeRefPath("src\\store\\a.ts:9").path).toBe("src/store/a.ts");
  });

  it("剥掉 ./ 前缀与重复斜杠", () => {
    expect(normalizeRefPath("././src//a.ts").path).toBe("src/a.ts");
  });

  it("目录引用的尾部斜杠被去掉，与不带斜杠的写法等价", () => {
    expect(normalizeRefPath("src/ai/").path).toBe("src/ai");
  });

  it("Windows 盘符不会被误认成行号", () => {
    // 冒号后是 "\x\a.ts" 而不是数字，因此整串都是路径
    expect(normalizeRefPath("C:\\x\\a.ts").line).toBeNull();
  });
});

describe("normalizeSeverity", () => {
  it("认识常见别名，未知值退回 info", () => {
    expect(normalizeSeverity("BLOCKER")).toBe("critical");
    expect(normalizeSeverity("major")).toBe("high");
    expect(normalizeSeverity("minor")).toBe("low");
    expect(normalizeSeverity("🤷")).toBe("info");
    expect(normalizeSeverity(null)).toBe("info");
  });
});

describe("buildInsightMarks 路径对齐", () => {
  it("精确相对路径直接命中", () => {
    const marks = buildInsightMarks([ins({ id: "1", refs: ["src/ai/insightOverlay.ts:10"] })], KNOWN);
    expect(marks.files["src/ai/insightOverlay.ts"]).toBeDefined();
    expect(marks.unresolved).toHaveLength(0);
  });

  it("绝对路径按后缀对齐到相对路径", () => {
    const marks = buildInsightMarks(
      [ins({ id: "1", refs: ["/Users/me/proj/src/ai/insightOverlay.ts:10"] })],
      KNOWN,
    );
    expect(marks.files["src/ai/insightOverlay.ts"]?.count).toBe(1);
  });

  it("截断路径（只给文件名）在全局唯一时也能对齐", () => {
    const marks = buildInsightMarks([ins({ id: "1", refs: ["FileRenderer.tsx"] })], KNOWN);
    expect(marks.files["src/editor/renderers/FileRenderer.tsx"]).toBeDefined();
  });

  it("同名文件有多个时一律不标，并计入 unresolved（宁可不标，绝不标错）", () => {
    const marks = buildInsightMarks([ins({ id: "1", refs: ["index.ts"] })], KNOWN);
    expect(Object.keys(marks.files)).toHaveLength(0);
    expect(marks.unresolved).toContain("index.ts");
  });

  it("直接点名目录时标在目录上，不虚报文件数", () => {
    const marks = buildInsightMarks([ins({ id: "1", refs: ["src/ai/"] })], KNOWN);
    expect(marks.dirs["src/ai"]?.count).toBe(1);
    expect(marks.dirs["src/ai"]?.fileCount).toBe(0);
    expect(Object.keys(marks.files)).toHaveLength(0);
  });

  it("完全对不上的引用进 unresolved 而不是被静默吞掉", () => {
    const marks = buildInsightMarks([ins({ id: "1", refs: ["不存在的/文件.ts:3"] })], KNOWN);
    expect(marks.unresolved).toHaveLength(1);
  });
});

describe("buildInsightMarks 聚合语义", () => {
  it("同一条洞察引用同文件多行只算一条", () => {
    const marks = buildInsightMarks(
      [ins({ id: "1", refs: ["src/utils/index.ts:1", "src/utils/index.ts:2", "src/utils/index.ts:3"] })],
      KNOWN,
    );
    expect(marks.files["src/utils/index.ts"].count).toBe(1);
  });

  it("多条洞察命中同文件时取最高严重度", () => {
    const marks = buildInsightMarks(
      [
        ins({ id: "1", severity: "medium", refs: ["README.md"] }),
        ins({ id: "2", severity: "critical", refs: ["README.md"] }),
        ins({ id: "3", severity: "high", refs: ["README.md"] }),
      ],
      KNOWN,
    );
    expect(marks.files["README.md"].severity).toBe("critical");
    expect(marks.files["README.md"].count).toBe(3);
  });

  it("tooltip 标题按严重度取前三条", () => {
    const marks = buildInsightMarks(
      [
        ins({ id: "1", severity: "low", title: "低", refs: ["README.md"] }),
        ins({ id: "2", severity: "critical", title: "严重", refs: ["README.md"] }),
        ins({ id: "3", severity: "medium", title: "中", refs: ["README.md"] }),
        ins({ id: "4", severity: "high", title: "高", refs: ["README.md"] }),
      ],
      KNOWN,
      { minSeverity: "info" },
    );
    expect(marks.files["README.md"].titles).toEqual(["严重", "高", "中"]);
  });

  it("向上冒泡到每一层祖先目录，子树严重度取最高", () => {
    const marks = buildInsightMarks(
      [ins({ id: "1", severity: "critical", refs: ["src/editor/renderers/FileRenderer.tsx"] })],
      KNOWN,
    );
    expect(marks.dirs["src/editor/renderers"].severity).toBe("critical");
    expect(marks.dirs["src/editor"].severity).toBe("critical");
    expect(marks.dirs["src"].severity).toBe("critical");
    expect(marks.dirs["src"].fileCount).toBe(1);
  });

  it("目录聚合按文件去重计数，同目录两个文件算两个", () => {
    const marks = buildInsightMarks(
      [
        ins({ id: "1", refs: ["src/ai/insightOverlay.ts"] }),
        ins({ id: "2", refs: ["src/ai/AiInsightsPanel.tsx"] }),
      ],
      KNOWN,
    );
    expect(marks.dirs["src/ai"].count).toBe(2);
    expect(marks.dirs["src/ai"].fileCount).toBe(2);
  });

  it("低于阈值的洞察不上画布（默认 medium）", () => {
    const marks = buildInsightMarks(
      [
        ins({ id: "1", severity: "info", refs: ["README.md"] }),
        ins({ id: "2", severity: "low", refs: ["README.md"] }),
      ],
      KNOWN,
    );
    expect(marks.files["README.md"]).toBeUndefined();
  });

  it("阈值可调，收紧到 high 时 medium 也被挡掉", () => {
    const rows = [ins({ id: "1", severity: "medium", refs: ["README.md"] })];
    expect(buildInsightMarks(rows, KNOWN, { minSeverity: "medium" }).files["README.md"]).toBeDefined();
    expect(buildInsightMarks(rows, KNOWN, { minSeverity: "high" }).files["README.md"]).toBeUndefined();
  });

  it("没有 refs 的洞察不产生任何标记（综述类结论不该点亮某个文件）", () => {
    const marks = buildInsightMarks([ins({ id: "1", severity: "critical", refs: [] })], KNOWN);
    expect(Object.keys(marks.files)).toHaveLength(0);
    expect(Object.keys(marks.dirs)).toHaveLength(0);
  });

  it("空输入不炸", () => {
    expect(buildInsightMarks([], []).files).toEqual({});
  });
});

describe("resolveMarkedPaths", () => {
  it("与角标同源：面板能点亮的正是画布上带标记的那些", () => {
    const refs = ["/abs/src/ai/insightOverlay.ts:3", "src/ai/", "index.ts"];
    const { files, dirs } = resolveMarkedPaths(refs, KNOWN);
    expect(files).toEqual(["src/ai/insightOverlay.ts"]);
    expect(dirs).toEqual(["src/ai"]);
    // 歧义的 index.ts 两边都不认，保持一致
    expect(files).not.toContain("src/utils/index.ts");
  });
});

describe("insightsForPath", () => {
  const rows = [
    ins({ id: "1", refs: ["src/ai/insightOverlay.ts:10"] }),
    ins({ id: "2", refs: ["src/ai/AiInsightsPanel.tsx"] }),
    ins({ id: "3", refs: ["README.md"] }),
  ];

  it("文件维度精确反查", () => {
    expect(insightsForPath(rows, "src/ai/insightOverlay.ts", KNOWN).map((i) => i.id)).toEqual(["1"]);
  });

  it("目录维度连带子树内的洞察", () => {
    expect(insightsForPath(rows, "src/ai", KNOWN).map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("无关路径返回空", () => {
    expect(insightsForPath(rows, "src/store/projectStore.ts", KNOWN)).toHaveLength(0);
  });
});
