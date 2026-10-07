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
//
// 念头轻量状态维度（草稿 / 已完善 / 已分发，纯派生零模型）也收在这里：
// 给作者一个「还需要加工吗」的快速答案——灵感页签列表、总览卡、详情卡共用，
// 禁第二份判定。
import type { WritingForeshadowing, WritingTimelineEvent } from '../services/tauri';
import { beatEventText, beatImported } from './writingTimeline';

/** 念头轻量状态：draft 草稿（只有一句话，还需加工）→ refined 已完善（可分发）→ dispatched 已分发（已入时间线/伏笔） */
export type InspirationState = 'draft' | 'refined' | 'dispatched';

/** 「已完善」阈值：展开内容至少这么长（字符）才算加工过，避免把一句话误判为已完善 */
export const MIN_REFINED_SUMMARY_LENGTH = 12;

export const INSPIRATION_STATES: InspirationState[] = ['draft', 'refined', 'dispatched'];

/**
 * 念头状态唯一判定口径（禁第二份）：
 * - dispatched：已入时间线或已入伏笔（含其一即算，去向优先级最高）；
 * - refined：未分发，但有实质展开内容（summary ≥ 12 字符）；
 * - draft：其余（只有一句话标题/摘要，还需加工）。
 */
export function inspirationStateOf(
  beat: { title?: string; summary?: string },
  timelineEvents: WritingTimelineEvent[],
  foreshadowings: WritingForeshadowing[],
): InspirationState {
  if (beatImported(timelineEvents, beatEventText(beat)) || beatPlantedAsForeshadowing(foreshadowings, beat)) {
    return 'dispatched';
  }
  const summary = (beat.summary ?? '').trim();
  return summary.length >= MIN_REFINED_SUMMARY_LENGTH ? 'refined' : 'draft';
}

/** 念头状态主题色（与节拍进度状态同色系：草稿琥珀 / 已完善绿 / 已分发灰） */
export function inspirationStateColor(state: InspirationState): string {
  return state === 'refined' ? '#639922' : state === 'dispatched' ? '#888780' : '#BA7517';
}

/** 念头 → 伏笔草稿口径：有标题=标题+摘要；无标题=摘要升格为标题（描述留空，不重复堆内容）。 */
export function foreshadowingFromBeat(beat: { title?: string; summary?: string }): {
  title: string;
  description: string;
} {
  const title = beat.title?.trim() ?? '';
  const summary = beat.summary?.trim() ?? '';
  return title ? { title, description: summary } : { title: summary, description: '' };
}

/** 该念头是否已转成伏笔（查重口径：title+description 与草稿口径全等；空念头不算已转）。 */
export function beatPlantedAsForeshadowing(
  foreshadowings: WritingForeshadowing[],
  beat: { title?: string; summary?: string },
): boolean {
  const draft = foreshadowingFromBeat(beat);
  if (!draft.title && !draft.description) return false;
  return foreshadowings.some(
    (f) => (f.title ?? '').trim() === draft.title && (f.description ?? '').trim() === draft.description,
  );
}
