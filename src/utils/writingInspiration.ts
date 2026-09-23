// 灵感分发口径（收拢纯函数，禁止在 pane/右栏各写第二份）：
//
// 灵感念头 = 未落章的 beat（loose beats，utils/writingOutline.looseBeats）——
// **不建独立表**：大纲页签「记个念头」/ 散文 IdeasPane / 灵感页签三处同池，
// inbox 不分裂；挂章（updateOutline chapterId）即自然转正离开念头池。
//
// 这里收拢的是「念头 → 分发目标」的转换与查重口径：
//   → 时间线草稿：beatEventText / beatImported（utils/writingTimeline，直接复用）
//   → 伏笔草稿：foreshadowingFromBeat / beatPlantedAsForeshadowing（本文件）
//   → 挂章：updateOutline({ chapterId })（无需标记，离开池即事实）
// 转换原则与 beatEventText 相同：**只搬运不发明内容**。
import type { WritingForeshadowing } from "../services/tauri";

/** 念头 → 伏笔草稿口径：有标题=标题+摘要；无标题=摘要升格为标题（描述留空，不重复堆内容）。 */
export function foreshadowingFromBeat(beat: { title?: string; summary?: string }): { title: string; description: string } {
  const title = beat.title?.trim() ?? "";
  const summary = beat.summary?.trim() ?? "";
  return title ? { title, description: summary } : { title: summary, description: "" };
}

/** 该念头是否已转成伏笔（查重口径：title+description 与草稿口径全等；空念头不算已转）。 */
export function beatPlantedAsForeshadowing(
  foreshadowings: WritingForeshadowing[],
  beat: { title?: string; summary?: string },
): boolean {
  const draft = foreshadowingFromBeat(beat);
  if (!draft.title && !draft.description) return false;
  return foreshadowings.some(
    (f) => (f.title ?? "").trim() === draft.title && (f.description ?? "").trim() === draft.description,
  );
}
