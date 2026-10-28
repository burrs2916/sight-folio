// sight-folio: 技术债量化评分单测（techDebtScore.ts）
import { describe, it, expect } from "vitest";
import type { TechDebtItem } from "../../../services/tauri";
import { summarizeTechDebt, formatDebtHours, hoursOf } from "../techDebtScore";

const debt = (
  id: string,
  fileId: string,
  filePath: string,
  marker: string,
  severity: string
): TechDebtItem => ({
  id,
  analysisId: "a1",
  fileId,
  filePath,
  lineNo: 1,
  marker,
  severity,
  snippet: "x",
  createdAt: 0,
});

describe("summarizeTechDebt", () => {
  it("按严重度折算工时：critical=2h / warning=0.5h / info=0.1h", () => {
    const s = summarizeTechDebt([
      debt("d1", "f1", "a.ts", "FIXME", "critical"),
      debt("d2", "f1", "a.ts", "TODO", "warning"),
      debt("d3", "f2", "b.ts", "OPTIMIZE", "info"),
    ]);
    expect(s.count).toBe(3);
    expect(s.hours).toBe(2.6); // 2 + 0.5 + 0.1
    expect(s.bySeverity).toEqual({ critical: 1, warning: 1, info: 1 });
    expect(s.byMarker).toEqual({ FIXME: 1, TODO: 1, OPTIMIZE: 1 });
  });

  it("Top 文件按工时降序，聚合同一文件的标记", () => {
    const s = summarizeTechDebt([
      debt("d1", "f1", "a.ts", "FIXME", "critical"),
      debt("d2", "f1", "a.ts", "FIXME", "critical"),
      debt("d3", "f2", "b.ts", "TODO", "warning"),
    ], 5);
    expect(s.topFiles).toHaveLength(2);
    expect(s.topFiles[0].filePath).toBe("a.ts");
    expect(s.topFiles[0].count).toBe(2);
    expect(s.topFiles[0].hours).toBe(4);
  });

  it("空清单 → 0 计数无异常", () => {
    const s = summarizeTechDebt([]);
    expect(s.count).toBe(0);
    expect(s.hours).toBe(0);
    expect(s.topFiles).toEqual([]);
  });

  it("后端未标严重度时按 warning 兜底", () => {
    expect(hoursOf({ severity: "" })).toBe(0.5);
    expect(hoursOf({ severity: "critical" })).toBe(2);
  });
});

describe("formatDebtHours", () => {
  it("人时/人日换算", () => {
    expect(formatDebtHours(0)).toBe("无");
    expect(formatDebtHours(2.6)).toBe("约 2.6 人时");
    expect(formatDebtHours(16)).toBe("约 2 人日");
  });
});
