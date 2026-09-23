import { describe, it, expect, beforeAll } from "vitest";
import { analyzerRegistry } from "../analyzerRegistry";
import { registerDefaultAnalyzers } from "../index";

/**
 * 分析器注册契约（业务收口后）。
 *
 * Sight Folio = 小说写作平台：registerDefaultAnalyzers 只注册 writing-analyzer。
 * 语言分析器（TypeScript/Rust/Python/…）的 manifest 定义保留在源文件中，
 * 但不再随应用注册 —— 与写作业务无关的代码分析能力不进实体图鉴/插件面板
 * （业务收口决策，见 analyzer/index.ts 注释）。
 *
 * 本测试守住两条业务底线：
 * 1. writing-analyzer 必须注册，且 novel/novel-zh/writing 三种语言标记都可匹配；
 * 2. 注册表里不再出现代码语言分析器（防止收口被无意回退）。
 */
describe("分析器注册契约（业务收口）", () => {
  beforeAll(() => {
    registerDefaultAnalyzers();
  });

  it("writing-analyzer 已注册，novel / novel-zh / writing 均可匹配", () => {
    const analyzers = analyzerRegistry.getAllAnalyzers();
    const writing = analyzers.find((a) => a.id === "writing-analyzer");
    expect(writing, "writing-analyzer 必须随应用注册").toBeDefined();
    for (const lang of ["novel", "novel-zh", "writing"]) {
      const matched = analyzers.find((a) => {
        const l = lang.toLowerCase();
        if (a.language.toLowerCase() === l) return true;
        return (a.languageAliases ?? []).some((al) => al.toLowerCase() === l);
      });
      expect(matched, `写作语言标记 "${lang}" 无插件可匹配`).toBeDefined();
    }
  });

  it("注册表中不再出现代码语言分析器（收口不回退）", () => {
    const analyzers = analyzerRegistry.getAllAnalyzers();
    const nonWriting = analyzers.filter((a) => a.id !== "writing-analyzer");
    expect(
      nonWriting.map((a) => a.id),
      "发现代码语言分析器被注册回注册表，违背业务收口决策"
    ).toEqual([]);
  });
});
