import { describe, it, expect } from "vitest";
import { groupRefsBySymbol, countRefsForSymbol, refTextSummary } from "../symbolRefs";
import type { ProjectSymbolRef } from "../../../services/tauri";

function makeRef(partial: Partial<ProjectSymbolRef>): ProjectSymbolRef {
  return {
    id: "ref_1",
    analysisId: "a1",
    fromFileId: "f1",
    fromFilePath: "src/a.ts",
    toSymbolId: "sym_foo",
    toFileId: "f2",
    toFilePath: "src/foo.ts",
    symbolName: "Foo",
    refLine: 10,
    refText: "import { Foo } from './foo'",
    kind: "import",
    createdAt: 1,
    ...partial,
  };
}

describe("groupRefsBySymbol", () => {
  it("按 toSymbolId 分组引用点", () => {
    const refs = [
      makeRef({ id: "r1", toSymbolId: "sym_foo", fromFileId: "f1", refLine: 3 }),
      makeRef({ id: "r2", toSymbolId: "sym_foo", fromFileId: "f2", refLine: 7 }),
      makeRef({ id: "r3", toSymbolId: "sym_bar", fromFileId: "f3", refLine: 9 }),
    ];
    const map = groupRefsBySymbol(refs);
    expect(map.get("sym_foo")?.length).toBe(2);
    expect(map.get("sym_bar")?.length).toBe(1);
  });

  it("跳过 toSymbolId 为空的文件级引用", () => {
    const refs = [makeRef({ id: "r1", toSymbolId: null })];
    const map = groupRefsBySymbol(refs);
    expect(map.size).toBe(0);
  });

  it("同一文件同一行同一符号去重", () => {
    const refs = [
      makeRef({ id: "r1", fromFileId: "f1", refLine: 5 }),
      makeRef({ id: "r2", fromFileId: "f1", refLine: 5 }), // 重复
      makeRef({ id: "r3", fromFileId: "f2", refLine: 5 }), // 不同文件
      makeRef({ id: "r4", fromFileId: "f1", refLine: 9 }), // 不同行
    ];
    const map = groupRefsBySymbol(refs);
    expect(map.get("sym_foo")?.length).toBe(3);
  });

  it("countRefsForSymbol 返回去重后的引用数，无引用返回 0", () => {
    const refs = [
      makeRef({ id: "r1", toSymbolId: "sym_foo", fromFileId: "f1", refLine: 3 }),
      makeRef({ id: "r2", toSymbolId: "sym_foo", fromFileId: "f2", refLine: 7 }),
    ];
    const map = groupRefsBySymbol(refs);
    expect(countRefsForSymbol(map, "sym_foo")).toBe(2);
    expect(countRefsForSymbol(map, "sym_missing")).toBe(0);
  });
});

describe("refTextSummary", () => {
  it("长文本截断并追加省略号", () => {
    const long = "a".repeat(100);
    const s = refTextSummary(long);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThan(50);
  });
  it("短文本原样返回", () => {
    expect(refTextSummary("import x")).toBe("import x");
  });
});
