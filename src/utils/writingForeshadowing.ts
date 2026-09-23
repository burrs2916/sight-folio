// 伏笔纯函数库：页签编辑面、右栏总览/编辑卡、章右栏区块共用同一套口径，避免分裂。
// 全部为纯函数：不触碰 store、不调用 t()（展示文案由调用方传入 labels）。
import type { WritingChapter, WritingForeshadowing, WritingOutline } from "../services/tauri";
import { castOfChapter } from "./writingOutline";

/** 伏笔状态三态 */
export type ForeshadowStatus = "pending" | "paidoff" | "abandoned";

export const FORESHADOW_STATUSES: ForeshadowStatus[] = ["pending", "paidoff", "abandoned"];

export function isForeshadowStatus(v: string): v is ForeshadowStatus {
  return (FORESHADOW_STATUSES as string[]).includes(v);
}

/** 状态展示序：待回收在前（创作者最关心），已回收次之，已弃置殿后。 */
export function foreshadowStatusOrder(status: string): number {
  return status === "pending" ? 0 : status === "paidoff" ? 1 : 2;
}

/** 状态 → 色点（待回收琥珀、已回收绿、已弃置灰；字面量色值，不走 CV 拼 alpha）。 */
export function foreshadowStatusColor(status: string): string {
  return status === "pending" ? "#b45309" : status === "paidoff" ? "#2e7d32" : "#9e9e9e";
}

/** 状态标签键映射（i18n writing.foreshadowStatus.*） */
export function foreshadowStatusLabelKey(status: string): string {
  return status === "pending" ? "writing.foreshadowStatusPending" : status === "paidoff" ? "writing.foreshadowStatusPaidoff" : "writing.foreshadowStatusAbandoned";
}

/** 列表排序：状态序（待回收前）→ 章序（埋设章在前）→ 创建序。 */
export function sortForeshadowings(
  items: WritingForeshadowing[],
  chapters: WritingChapter[]
): WritingForeshadowing[] {
  const chapterOrder = new Map(chapters.map((c) => [c.id, c.sortOrder] as const));
  return [...items].sort((a, b) => {
    const so = foreshadowStatusOrder(a.status) - foreshadowStatusOrder(b.status);
    if (so !== 0) return so;
    const co =
      (a.plantChapterId ? chapterOrder.get(a.plantChapterId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER) -
      (b.plantChapterId ? chapterOrder.get(b.plantChapterId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
    if (co !== 0) return co;
    return a.createdAt - b.createdAt;
  });
}

/**
 * 跨章预警（advisory 软提示，不强制）：伏笔仍 pending，但「计划回收章」的排序
 * 已经早于「最新埋设章」——即正文已写到回收点之后还没收，创作者该回头看一眼了。
 * 回收章未锚定（null）不预警（还没想好收在哪是正当状态）。
 */
export function isOverdue(
  item: WritingForeshadowing,
  chapters: WritingChapter[]
): boolean {
  if (item.status !== "pending" || !item.payoffChapterId || !item.plantChapterId) return false;
  const order = new Map(chapters.map((c) => [c.id, c.sortOrder] as const));
  const plant = order.get(item.plantChapterId);
  const payoff = order.get(item.payoffChapterId);
  if (plant === undefined || payoff === undefined) return false;
  return payoff <= plant;
}

/** 章右栏「本章伏笔」：埋设于本章（在任何状态都算——已回收也该回看当初怎么埋的）。 */
export function foreshadowingsPlantedIn(
  items: WritingForeshadowing[],
  chapterId: string
): WritingForeshadowing[] {
  return items.filter((f) => f.plantChapterId === chapterId);
}

/** 章右栏「本章伏笔」：计划回收于本章（pending 的回收预告 + 已回收的兑现记录）。 */
export function foreshadowingsPayableIn(
  items: WritingForeshadowing[],
  chapterId: string
): WritingForeshadowing[] {
  return items.filter((f) => f.payoffChapterId === chapterId);
}

/**
 * 伏笔 P2 · 牵涉人物（2026-09-19，零模型派生）：
 * 伏笔的 plant/payoff 两章出场节拍 cast 的并集（按章出场派生，advisory 展示——
 * 表述「牵涉/可能相关」而非「精确关联」，显式关联等 extra 列方案另行拍板）。
 * 口径复用 writingOutline.castOfChapter（与编辑区/写作台/章统筹同一份，禁第二份）；
 * 只保留真实存在的设定（防孤儿 id），名字缺失回退 id。
 */
export function foreshadowingCastOf(
  fs: Pick<WritingForeshadowing, "plantChapterId" | "payoffChapterId">,
  outlines: WritingOutline[],
  settings: { id: string; name: string | null }[]
): { id: string; name: string }[] {
  const ids = new Set<string>();
  for (const chId of [fs.plantChapterId, fs.payoffChapterId]) {
    if (!chId) continue;
    for (const id of castOfChapter(outlines, chId)) ids.add(id);
  }
  return [...ids]
    .map((id) => {
      const s = settings.find((x) => x.id === id);
      return s ? { id, name: s.name || id } : null;
    })
    .filter((x): x is { id: string; name: string } => x !== null);
}

/**
 * 伏笔 P2 · 人物右栏「相关伏笔」（反向派生，2026-09-21）：
 * 反查所有 plant/payoff 两章出场 cast 含该设定的伏笔——与 foreshadowingCastOf
 * 正向同一份口径（同一函数反查），双向闭环；advisory 语义同正向（出场即相关），
 * 显式关联等模型方案另行拍板。调用方负责排序展示。
 */
export function relatedForeshadowings(
  settingId: string,
  items: WritingForeshadowing[],
  outlines: WritingOutline[],
  settings: { id: string; name: string | null }[],
): WritingForeshadowing[] {
  return items.filter((f) =>
    foreshadowingCastOf(f, outlines, settings).some((c) => c.id === settingId),
  );
}

/**
 * 剧情 P2-A · 本线伏笔（2026-09-21）：挂线 filter——删线置 NULL 语义下，
 * 留存的自然全是显式挂线。骨架互联审计补缺：伏笔挂了线，线的三个视角
 * （详情卡/叙事/矩阵）此前全看不见。调用方负责排序展示。
 */
export function foreshadowingsOfLine(
  storylineId: string,
  items: WritingForeshadowing[],
): WritingForeshadowing[] {
  return items.filter((f) => f.storylineId === storylineId);
}
