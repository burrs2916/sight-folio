import { describe, it, expect, beforeAll } from "vitest";
import { analyzerRegistry } from "../analyzerRegistry";
import { registerDefaultAnalyzers } from "../index";

/**
 * 前后端语言覆盖一致性测试（R45 插件化后补强）。
 *
 * 后端 ParserRegistry（src-tauri/src/parser/）detect_language 能输出的语言 id，
 * 前端 analyzerRegistry 必须都能匹配到插件（manifest.language 或 languageAliases），
 * 否则出现「后端识别了语言、前端激活不了插件」的脱节（历史：svelte 缺口）。
 *
 * 后端语言集合与 parser 能力矩阵的对应关系见：
 * docs/解析器插件架构与新增语言指南.md「已支持的解析器清单」。
 */
describe("前后端语言覆盖一致性（R45）", () => {
  // 后端 ParserRegistry detect 输出的全部语言 id（含细分：javascript/kotlin/cpp 等）
  const BACKEND_LANGUAGES = [
    "typescript",
    "javascript",
    "vue",
    "rust",
    "python",
    "go",
    "java",
    "kotlin",
    "c",
    "cpp",
    "csharp",
    "php",
    "ruby",
    "swift",
    "svelte",
  ];

  beforeAll(() => {
    registerDefaultAnalyzers();
  });

  it("后端能识别的每种语言，前端都有插件可匹配", () => {
    const analyzers = analyzerRegistry.getAllAnalyzers();
    for (const lang of BACKEND_LANGUAGES) {
      const matched = analyzers.find((a) => {
        const l = lang.toLowerCase();
        if (a.language.toLowerCase() === l) return true;
        return (a.languageAliases ?? []).some((al) => al.toLowerCase() === l);
      });
      expect(matched, `后端语言 "${lang}" 在前端无插件可匹配`).toBeDefined();
    }
  });

  it("前端插件语言都能被后端识别（反向：无孤儿插件）", () => {
    const analyzers = analyzerRegistry.getAllAnalyzers();
    for (const a of analyzers) {
      const langs = [a.language, ...(a.languageAliases ?? [])].map((l) =>
        l.toLowerCase().replace(/\//g, "").replace("#", "sharp")
      );
      // c/c++ 归一为 cpp，c# 归一为 csharp
      const normalized = langs.map((l) =>
        l === "c/c++" ? "cpp" : l === "c#" ? "csharp" : l
      );
      const hit = normalized.some((l) => BACKEND_LANGUAGES.includes(l));
      expect(hit, `前端插件 "${a.id}" 的语言不在后端识别范围内`).toBe(true);
    }
  });
});
