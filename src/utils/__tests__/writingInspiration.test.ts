// 灵感分发口径（utils/writingInspiration）单测：
//   - foreshadowingFromBeat：只搬运不发明内容（有标题=标题+摘要；无标题=摘要升格为标题）
//   - beatPlantedAsForeshadowing：查重口径与转换口径必须全等，空念头不算已转
// 这两条错了会出现「转完伏笔按钮还亮着 → 重复转出双胞胎伏笔」。
import { describe, it, expect } from "vitest";
import { foreshadowingFromBeat, beatPlantedAsForeshadowing } from "../writingInspiration";
import type { WritingForeshadowing } from "../../services/tauri";

const fs = (id: string, title: string, description: string): WritingForeshadowing =>
  ({
    id,
    bookId: "b1",
    title,
    description,
    plantChapterId: null,
    payoffChapterId: null,
    status: "pending",
    storylineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingForeshadowing;

describe("foreshadowingFromBeat", () => {
  it("有标题：标题 + 摘要各自归位", () => {
    expect(foreshadowingFromBeat({ title: "怀表", summary: "第三章出现的怀表" })).toEqual({
      title: "怀表",
      description: "第三章出现的怀表",
    });
  });

  it("无标题：摘要升格为标题，描述留空（不重复堆内容）", () => {
    expect(foreshadowingFromBeat({ title: "", summary: "只有一句话的念头" })).toEqual({
      title: "只有一句话的念头",
      description: "",
    });
  });

  it("空念头：全空", () => {
    expect(foreshadowingFromBeat({})).toEqual({ title: "", description: "" });
  });
});

describe("beatPlantedAsForeshadowing", () => {
  it("转过的念头判 true（title+description 全等口径）", () => {
    const beat = { title: "怀表", summary: "第三章出现的怀表" };
    const draft = foreshadowingFromBeat(beat);
    expect(beatPlantedAsForeshadowing([fs("f1", draft.title, draft.description)], beat)).toBe(true);
  });

  it("没转过的念头判 false", () => {
    const beat = { title: "怀表", summary: "第三章出现的怀表" };
    expect(beatPlantedAsForeshadowing([fs("f1", "别的伏笔", "别的描述")], beat)).toBe(false);
    expect(beatPlantedAsForeshadowing([], beat)).toBe(false);
  });

  it("空念头不算已转（没有内容可转，也就无从查重）", () => {
    expect(beatPlantedAsForeshadowing([fs("f1", "", "")], {})).toBe(false);
  });
});
