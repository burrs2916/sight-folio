import { describe, it, expect } from "vitest";
import { buildContextBlock } from "../workbenchContext";
import type { WorkbenchContext } from "../workbenchContext";

// 注：buildContextBlock 的提示词走 L(zh,en)，按当前 UI 语言二选一返回；
// 故断言一律用语种无关子串（project_context / file_read）区分分支，避免绑定某语言。

describe("buildContextBlock · 书场景 footer 收敛（世界观不再冗余重读）", () => {
  it("worldview 题材：footer 不出现 project_context 重读指令，仅提示 file_read 对照正文", () => {
    const ctx: WorkbenchContext = {
      activeFile: null,
      selection: null,
      mode: "ask",
      facts: null,
      attachments: [],
      bookTopic: "worldview",
      bookTitle: "夜之编年",
      bookSettingCorpus: { zh: "【世界观设定】\n- 魔法（magic）：规则=—", en: "[Worldbuilding]\n- Magic (magic): rules=—" },
    };
    const out = buildContextBlock(ctx, true);
    expect(out).toContain("file_read");
    expect(out).not.toContain("project_context");
  });

  it("人物题材：footer 不出现 project_context 重读指令（人物卡已随 bookSettingCorpus 内联），仅提示 file_read 对照正文", () => {
    const ctx: WorkbenchContext = {
      activeFile: null,
      selection: null,
      mode: "ask",
      facts: null,
      attachments: [],
      bookTopic: "characters",
      bookTitle: "夜之编年",
      bookSettingCorpus: { zh: "【人物卡】\n- 林夜（linye）：副标题=—", en: "[Character cards]\n- Lin Ye (linye): subtitle=—" },
    };
    const out = buildContextBlock(ctx, true);
    expect(out).toContain("file_read");
    expect(out).not.toContain("project_context");
  });

  it("非书场景（代码场景）：footer 仍提示 project_context / scan_records", () => {
    const ctx: WorkbenchContext = {
      activeFile: { fileId: "f1", relPath: "a.ts", language: "ts", name: "a.ts" },
      selection: null,
      mode: "ask",
      facts: null,
      attachments: [],
    };
    const out = buildContextBlock(ctx, false);
    expect(out).toContain("project_context");
  });
});
