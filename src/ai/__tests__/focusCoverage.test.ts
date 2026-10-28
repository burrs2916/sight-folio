/**
 * 焦点目标 × 洞察覆盖。
 *
 * 这层交叉存在的唯一理由：让「扫描点名的头号目标」与「AI 已给出的结论」在同一行上对账，
 * 从而把「自动化一直在跑、但从没跑到最该看的文件上」这件事暴露出来。
 * 因此用例重点全在**口径**上——按什么严重度算覆盖、点名哪一个空白目标。
 */
import { describe, it, expect } from "vitest";
import { summarizeFocusCoverage } from "../focusCoverage";
import { buildInsightMarks, type InsightLike, type InsightMark } from "../insightOverlay";

const target = (filePath: string, resonance: number) => ({ filePath, resonance });

const insight = (
  id: string,
  severity: string,
  refs: string[],
  status?: string,
): InsightLike => ({ id, title: `结论 ${id}`, severity, refs, status });

const marksOf = (insights: InsightLike[], paths: string[]): Record<string, InsightMark> =>
  buildInsightMarks(insights, paths, { minSeverity: "info" }).files;

describe("summarizeFocusCoverage：共振榜与洞察对账", () => {
  it("覆盖数 / 空白数分开计，并点名名次最靠前的空白目标", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const marks = marksOf([insight("i1", "high", ["src/b.ts:12"])], paths);

    const r = summarizeFocusCoverage(
      [target("src/a.ts", 4), target("src/b.ts", 3), target("src/c.ts", 2)],
      marks,
    );

    expect(r.covered).toBe(1);
    expect(r.blank).toBe(2);
    // a 排在 c 前面，提示语只该点名 a
    expect(r.topBlankPath).toBe("src/a.ts");
    expect(r.topBlankResonance).toBe(4);
  });

  it("低严重度结论也算覆盖——用画布阈值（medium）来算会把「AI 看过判定为 low」错报成无人分析", () => {
    const paths = ["src/a.ts"];
    const lowOnly = [insight("i1", "low", ["src/a.ts"])];

    // 正确口径：info 级
    const r = summarizeFocusCoverage([target("src/a.ts", 3)], marksOf(lowOnly, paths));
    expect(r.covered).toBe(1);
    expect(r.blank).toBe(0);

    // 反例存档：若误用画布默认阈值，同一份数据会得出「无人分析」
    const canvasMarks = buildInsightMarks(lowOnly, paths).files;
    expect(summarizeFocusCoverage([target("src/a.ts", 3)], canvasMarks).blank).toBe(1);
  });

  it("已收口的结论不算现存覆盖——与画布语义一致，文案才敢说「暂无 AI 结论」", () => {
    const paths = ["src/a.ts"];
    const marks = marksOf([insight("i1", "critical", ["src/a.ts"], "resolved")], paths);
    const r = summarizeFocusCoverage([target("src/a.ts", 4)], marks);
    expect(r.covered).toBe(0);
    expect(r.topBlankPath).toBe("src/a.ts");
  });

  it("引用写成绝对路径 / 带行号也要认——对齐规则复用 insightOverlay，不另起一套", () => {
    const paths = ["src/deep/a.ts"];
    const marks = marksOf(
      [insight("i1", "medium", ["/Users/x/proj/src/deep/a.ts:40"])],
      paths,
    );
    expect(summarizeFocusCoverage([target("src/deep/a.ts", 2)], marks).covered).toBe(1);
  });

  it("空榜单不炸，且不会凭空点名任何文件", () => {
    const r = summarizeFocusCoverage([], {});
    expect(r.covered).toBe(0);
    expect(r.blank).toBe(0);
    expect(r.topBlankPath).toBeUndefined();
    expect(r.topBlankResonance).toBe(0);
  });

  it("全部已覆盖时不给出空白提示——没有盲区就不该制造焦虑", () => {
    const paths = ["src/a.ts", "src/b.ts"];
    const marks = marksOf(
      [insight("i1", "high", ["src/a.ts"]), insight("i2", "info", ["src/b.ts"])],
      paths,
    );
    const r = summarizeFocusCoverage([target("src/a.ts", 3), target("src/b.ts", 2)], marks);
    expect(r.covered).toBe(2);
    expect(r.blank).toBe(0);
    expect(r.topBlankPath).toBeUndefined();
  });
});
