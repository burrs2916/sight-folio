import { describe, it, expect } from "vitest";
import { buildWorldBibleCorpus } from "../workbenchPanelHooks";
import type { WritingSetting } from "../../../services/tauri";

/** 构造最小合法 WritingSetting（仅 buildWorldBibleCorpus 用到的字段需真实，其余回填）。 */
function makeSetting(p: { kind: WritingSetting["kind"]; name: string; extra: string; id?: string }): WritingSetting {
  return {
    id: p.id ?? "s1",
    bookId: "b1",
    kind: p.kind,
    name: p.name,
    subtitle: "",
    description: "",
    extra: p.extra,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

const MAGIC_EXTRA = JSON.stringify({
  worldbuildingProfile: {
    type: "magic",
    rules: "需消耗魔力",
    exceptions: "神器免耗",
    linkedTo: "古老遗迹",
    notes: "源自星海",
  },
  relations: [{ targetId: "c-1" }, { target: "帝国" }],
});

const HERO_EXTRA = JSON.stringify({
  profile: {
    appearance: "金发",
    personality: "果敢",
    motivation: "复仇",
    notes: "失忆",
  },
});

describe("buildWorldBibleCorpus · 世界观设定库语料", () => {
  it("展开世界观设定（类型/规则/例外/关联/关系/备注）与人物卡，且双语", () => {
    const settings: WritingSetting[] = [
      makeSetting({ kind: "worldbuilding", name: "魔法体系", extra: MAGIC_EXTRA }),
      makeSetting({ kind: "character", name: "艾琳", extra: HERO_EXTRA }),
    ];
    const { zh, en } = buildWorldBibleCorpus(settings);

    // 世界观段（zh）
    expect(zh).toContain("【世界观设定】");
    expect(zh).toContain("魔法体系（magic）");
    expect(zh).toContain("规则=需消耗魔力");
    expect(zh).toContain("例外=神器免耗");
    expect(zh).toContain("关联=古老遗迹");
    expect(zh).toContain("关系=[#c-1、帝国]");
    expect(zh).toContain("备注=源自星海");
    // 人物段（zh）
    expect(zh).toContain("【人物】");
    expect(zh).toContain("艾琳：外貌=金发；性格=果敢；动机=复仇；备注=失忆");

    // 双语标签（en）：名称保持原文（数据语言无关），仅类型枚举与字段标签英文化
    expect(en).toContain("[Worldbuilding]");
    expect(en).toContain("(magic)");
    expect(en).toContain("rules=需消耗魔力");
    expect(en).toContain("relations=[#c-1、帝国]");
    expect(en).toContain("[Characters]");
  });

  it("无世界观设定时给出中文占位、英文占位", () => {
    const settings: WritingSetting[] = [makeSetting({ kind: "character", name: "艾琳", extra: HERO_EXTRA })];
    const { zh, en } = buildWorldBibleCorpus(settings);
    expect(zh).toContain("（暂无世界观设定）");
    expect(en).toContain("(no worldbuilding yet)");
  });

  it("无人物卡时给出中文占位、英文占位", () => {
    const settings: WritingSetting[] = [makeSetting({ kind: "worldbuilding", name: "魔法体系", extra: MAGIC_EXTRA })];
    const { zh, en } = buildWorldBibleCorpus(settings);
    expect(zh).toContain("（暂无人物卡）");
    expect(en).toContain("(no characters yet)");
  });

  it("relations 仅含 targetId / 仅含自由文本 target 时都能展开", () => {
    const onlyId = makeSetting({
      kind: "worldbuilding",
      name: "遗迹",
      extra: JSON.stringify({ worldbuildingProfile: { type: "location" }, relations: [{ targetId: "x9" }] }),
    });
    const onlyText = makeSetting({
      kind: "worldbuilding",
      name: "势力",
      extra: JSON.stringify({ worldbuildingProfile: { type: "faction" }, relations: [{ target: "邻国" }] }),
    });
    const { zh } = buildWorldBibleCorpus([onlyId, onlyText]);
    expect(zh).toContain("关系=[#x9]");
    expect(zh).toContain("关系=[邻国]");
  });

  it("extra 解析失败时退化为空 profile，不抛错", () => {
    const broken = makeSetting({ kind: "worldbuilding", name: "坏数据", extra: "{ 这不是合法 json" });
    const { zh } = buildWorldBibleCorpus([broken]);
    expect(zh).toContain("坏数据");
    expect(zh).toContain("规则=—");
  });
});
