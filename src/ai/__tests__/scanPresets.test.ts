/**
 * 扫描模块预设与分节键的一致性校验。
 *
 * 为什么值得单独测：预设里的 sectionKeys 是字符串字面量，写错一个键不会报错，
 * 只会**静默少一节数据**——Agent 照常回答，只是结论少了一整个维度，人几乎发现不了。
 * 这类"沉默的降级"必须靠测试钉住。
 */
import { describe, it, expect } from "vitest";
import { SCAN_SECTION_KEYS, scanAnalysisPresets } from "../providers/scanContextProvider";
import { pickLang } from "../../i18n";

describe("扫描分析预设", () => {
  it("每个预设引用的分节键都必须真实存在", () => {
    for (const preset of scanAnalysisPresets) {
      for (const key of preset.sectionKeys ?? []) {
        expect(
          SCAN_SECTION_KEYS,
          `预设「${preset.key}」引用了不存在的分节键 ${key}`,
        ).toContain(key);
      }
    }
  });

  it("预设 key 唯一（重复会让 UI 选择错乱、自动规则绑到错误任务）", () => {
    const keys = scanAnalysisPresets.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("每个预设都有非空 prompt —— 自动化触发时没有人来补充说明", () => {
    for (const p of scanAnalysisPresets) {
      expect(pickLang(p.prompt).trim().length, `预设「${p.key}」缺少任务描述`).toBeGreaterThan(20);
    }
  });

  it("分节键全集无重复（SECTION_DEFS 里同名键会让后者覆盖前者）", () => {
    expect(new Set(SCAN_SECTION_KEYS).size).toBe(SCAN_SECTION_KEYS.length);
  });

  it("数据流已独立成节，可被预设单独取用（影响面问题不必拉整张调用图）", () => {
    expect(SCAN_SECTION_KEYS).toContain("dataFlow");
  });
});
