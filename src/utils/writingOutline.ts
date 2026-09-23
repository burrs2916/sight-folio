// 大纲（节拍）与章节的对应口径 —— 抽出为纯函数，供右栏「要素」检视器与测试共用
//
// 为什么值得单独抽：口径一旦两处不一致，写作台（/writing）和工作室右栏就会显示
// 同一章的不同大纲，而它们读的是同一张 writing_outlines 表 —— 这种不一致最难查。
// 写作台的口径是 `outlines.find(o => o.chapterId === chapter.id)`，这里保持一致。

import type { WritingChapter, WritingOutline, WritingSetting, WritingRelation, WritingSettingExtra } from "../services/tauri";
import { parseSettingExtra } from "../services/tauri";

/**
 * 设定项「完整性」判定（零迁移，纯函数，可测）。
 *
 * 与「设定完整性」三支（左栏概览/待补全筛选、编辑器内联标记、右栏名册提示）共用同一判据，
 * 避免三处各写一份导致口径漂移。判定规则：
 *   - worldbuilding：缺 `worldbuildingProfile.type` 或 `rules`(trim 空) → 待补全；
 *   - character   ：缺 `profile.appearance` / `personality` / `motivation`(任一 trim 空) → 待补全。
 * 返回缺失字段对应的 i18n 键（含命名空间），渲染层用 t() 取本地化标签拼接。
 */
export interface SettingCompleteness {
  /** 是否完整（无缺失必填项） */
  complete: boolean;
  /** 缺失字段对应的 i18n 键（如 "writing.wbType" / "writing.appearance"） */
  missingKeys: string[];
}

interface RequiredField {
  i18nKey: string;
  isEmpty: (p: Record<string, unknown> | undefined) => boolean;
}

const WB_REQUIRED: Record<string, RequiredField> = {
  type: { i18nKey: "writing.wbType", isEmpty: (p) => !(p && typeof p.type === "string" && p.type.length > 0) },
  rules: { i18nKey: "writing.wbRules", isEmpty: (p) => !(p && typeof p.rules === "string" && p.rules.trim().length > 0) },
};
const CHAR_REQUIRED: Record<string, RequiredField> = {
  appearance: { i18nKey: "writing.appearance", isEmpty: (p) => !(p && typeof p.appearance === "string" && p.appearance.trim().length > 0) },
  personality: { i18nKey: "writing.personality", isEmpty: (p) => !(p && typeof p.personality === "string" && p.personality.trim().length > 0) },
  motivation: { i18nKey: "writing.motivation", isEmpty: (p) => !(p && typeof p.motivation === "string" && p.motivation.trim().length > 0) },
};

export function settingCompleteness(kind: "character" | "worldbuilding", extra: string | WritingSettingExtra): SettingCompleteness {
  const parsed = typeof extra === "string" ? parseSettingExtra(extra) : extra;
  const profile = (kind === "worldbuilding" ? parsed.worldbuildingProfile : parsed.profile) as Record<string, unknown> | undefined;
  const required = kind === "worldbuilding" ? WB_REQUIRED : CHAR_REQUIRED;
  const missingKeys = Object.values(required).filter((f) => f.isEmpty(profile)).map((f) => f.i18nKey);
  return { complete: missingKeys.length === 0, missingKeys };
}

/**
 * 本章对应的节拍。**一章只取一条**（写作台同口径）。
 * 历史数据里同一章被多条节拍绑定时，取 sortOrder 最小的那条（创建顺序即展示顺序），
 * 保证确定性 —— 不随数组顺序抖动。
 */
export function beatForChapter(outlines: WritingOutline[], chapterId: string): WritingOutline | null {
  if (!chapterId) return null;
  let best: WritingOutline | null = null;
  for (const o of outlines) {
    if (o.chapterId !== chapterId) continue;
    if (!best || o.sortOrder < best.sortOrder) best = o;
  }
  return best;
}

/** 待落章的节拍（chapterId 为 null）= 大纲里"先规划、还没写到"的部分，按 sortOrder 排 */
export function looseBeats(outlines: WritingOutline[]): WritingOutline[] {
  return outlines.filter((o) => !o.chapterId).sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface VolumeAccount {
  rows: WritingChapter[];
  words: number;
  finished: number;
}

/** 卷的结构账：卷名 → 章列表 / 总字数 / 已完稿数。'' 卷名 = 未分卷。 */
export function volumeAccount(chapters: WritingChapter[], volume: string): VolumeAccount {
  const rows = chapters.filter((c) => (c.volume || "") === volume);
  return {
    rows,
    words: rows.reduce((n, c) => n + (c.wordCount || 0), 0),
    finished: rows.filter((c) => c.status === "finished").length,
  };
}

// ─── 节拍挂载（extra JSON）与「要素」检视口径 ───
// 右栏「要素」与编辑区必须读同一份解析结果：这里的 parseBeatExtra 是**全项目唯一入口**
// （writingPanes 已从本文件导入并再导出，禁止在别处再写一份宽容解析）。

export interface BeatExtra {
  cast?: string[];
  scenes?: string[];
  status?: string;
}

/** 节拍 extra 的宽容解析：非对象 / 坏 JSON 一律当空挂载，绝不抛错 */
export function parseBeatExtra(extra: string): BeatExtra {
  try {
    const o = JSON.parse(extra);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as BeatExtra) : {};
  } catch {
    return {};
  }
}

function idsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}

/**
 * 节拍挂载 toggle 的**唯一写口径**（灵感工作台与大纲 BeatRow 共用，禁写第二份）：
 * 输入旧 extra JSON，返回挂载/取消挂载后的新 extra JSON（不落库，调用方走 updateOutline）。
 */
export function toggleBeatMount(extra: string, key: "cast" | "scenes", settingId: string): string {
  if (!settingId) return extra;
  const ex = parseBeatExtra(extra);
  const cur = idsOf(ex[key]);
  const next = cur.includes(settingId) ? cur.filter((x) => x !== settingId) : [...cur, settingId];
  return JSON.stringify({ ...ex, [key]: next });
}

/**
 * 与某设定相关的念头（联动派生·零模型）：未落章节拍（念头池）中，
 * extra.cast / extra.scenes 挂载了该设定的——人物/世界观右栏「相关念头」据此派生，
 * 与灵感页签同一份数据口径，谁挂了都算数。
 */
export function ideasOfSetting(outlines: WritingOutline[], settingId: string): WritingOutline[] {
  if (!settingId) return [];
  return looseBeats(outlines).filter((o) => {
    const ex = parseBeatExtra(o.extra);
    return idsOf(ex.cast).includes(settingId) || idsOf(ex.scenes).includes(settingId);
  });
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** 该章挂的节拍（可能多条；与 beatForChapter 的"一章取一条"口径不同，这里是全部） */
function beatsOfChapter(outlines: WritingOutline[], chapterId: string): WritingOutline[] {
  if (!chapterId) return [];
  return outlines.filter((o) => o.chapterId === chapterId);
}

/** 本章全部节拍挂载的出场人物 id（去重保序；面板据此列名字） */
export function castOfChapter(outlines: WritingOutline[], chapterId: string): string[] {
  return uniq(beatsOfChapter(outlines, chapterId).flatMap((o) => idsOf(parseBeatExtra(o.extra).cast)));
}

/** 本章全部节拍挂载的关联场景 id */
export function scenesOfChapter(outlines: WritingOutline[], chapterId: string): string[] {
  return uniq(beatsOfChapter(outlines, chapterId).flatMap((o) => idsOf(parseBeatExtra(o.extra).scenes)));
}

/**
 * 某设定被哪些章挂载（人物读 cast / 场景读 scenes，由 kind 决定）。
 * 这是「人物出现在哪些章」的**真数据**口径 —— 与扫描层 metadata.appearances 无关。
 * 返回按 sortOrder 排的章列表。
 */
export function chaptersOfSetting(
  outlines: WritingOutline[],
  chapters: WritingChapter[],
  settingId: string,
  kind: "character" | "worldbuilding"
): WritingChapter[] {
  if (!settingId) return [];
  const field = kind === "character" ? "cast" : "scenes";
  const hit = new Set<string>();
  for (const o of outlines) {
    if (!o.chapterId) continue;
    if (idsOf(parseBeatExtra(o.extra)[field]).includes(settingId)) hit.add(o.chapterId);
  }
  return chapters.filter((c) => hit.has(c.id)).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 反向视图：找出所有"引用了 targetId 的设定"。
 * 关系（relations）存在每个设定自己的 extra.relations 里（targetId 连 id，与自由文本 target 并存）。
 * 供世界观/人物设定在右栏「要素」看到"哪些人物/设定连着我"——让世界能装下自己的人物。
 * 零迁移：只读 extra.relations，不写。
 */
export function relatedSettingsOf(
  settings: WritingSetting[],
  targetId: string
): { setting: WritingSetting; relationType: string }[] {
  if (!targetId) return [];
  const out: { setting: WritingSetting; relationType: string }[] = [];
  for (const s of settings) {
    if (s.id === targetId) continue;
    const extra = parseSettingExtra(s.extra);
    const rel = (extra.relations ?? []).find((r: WritingRelation) => r.targetId === targetId);
    if (rel) out.push({ setting: s, relationType: rel.type ?? "" });
  }
  return out;
}

/** 章在结构树里的路径：根 → 自身（含各级 kind/title）。防环 + 断链兜底，找不到返回 [] */
export function chapterPath(chapters: WritingChapter[], chapterId: string): WritingChapter[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const path: WritingChapter[] = [];
  const seen = new Set<string>();
  let cur = byId.get(chapterId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    const parentId = cur.parentId;
    cur = parentId ? byId.get(parentId) : undefined;
  }
  return path;
}

export interface SettingUsage {
  attached: string[];
  orphan: string[];
}

/** 要素清点：被任意一条节拍挂载过的设定 id = attached；其余 = orphan（全书分支用） */
export function settingUsage(outlines: WritingOutline[], settings: { id: string }[]): SettingUsage {
  const used = new Set<string>();
  for (const o of outlines) {
    const ex = parseBeatExtra(o.extra);
    for (const id of [...idsOf(ex.cast), ...idsOf(ex.scenes)]) used.add(id);
  }
  const attached: string[] = [];
  const orphan: string[] = [];
  for (const s of settings) (used.has(s.id) ? attached : orphan).push(s.id);
  return { attached, orphan };
}

/**
 * 「章 ↔ 设定」双向绑定的**唯一写入口**。
 * 在指定章的节拍上挂载（或取消挂载）一个设定：人物走 cast、场景走 scenes。
 * 若该章还没有节拍，先建一条（标题取 fallbackTitle 兜底），再写挂载。
 * 章检视器（WritingInspectorPanel）与人物 tab（CastPane）都走这里，
 * 杜绝「建 beat + 改 extra」逻辑在两处各写一份后漂移。
 */
export interface ChapterBindStore {
  outlines: WritingOutline[];
  createOutline: (title: string) => Promise<WritingOutline | null>;
  updateOutline: (
    outlineId: string,
    patch: Partial<Pick<WritingOutline, "title" | "summary" | "chapterId" | "extra">>
  ) => Promise<void>;
}

export async function toggleSettingOnChapter(
  store: ChapterBindStore,
  chapterId: string,
  key: "cast" | "scenes",
  settingId: string,
  fallbackTitle: string
): Promise<void> {
  if (!chapterId || !settingId) return;
  let beat = beatForChapter(store.outlines, chapterId);
  if (!beat) {
    const created = await store.createOutline(fallbackTitle);
    if (!created) return;
    await store.updateOutline(created.id, { chapterId });
    beat = { ...created, chapterId };
  }
  const ex = parseBeatExtra(beat.extra);
  const cur = Array.isArray(ex[key]) ? (ex[key] as string[]) : [];
  const next = cur.includes(settingId) ? cur.filter((x) => x !== settingId) : [...cur, settingId];
  await store.updateOutline(beat.id, { extra: JSON.stringify({ ...ex, [key]: next }) });
}

export interface VolumeBeatAccount {
  /** 本卷所有章挂的节拍数 */
  beats: number;
  /** 其中已写（extra.status === "written"）的节拍数 */
  written: number;
  /** 本卷各章节拍挂过的设定 id（去重） */
  settingIds: string[];
}

/** 卷的节拍账：本卷章数 / 节拍数 / 已写节拍 / 挂过的设定 */
export function volumeBeatAccount(
  outlines: WritingOutline[],
  chapters: WritingChapter[],
  volume: string
): VolumeBeatAccount {
  const rows = chapters.filter((c) => (c.volume || "") === volume);
  let beats = 0;
  let written = 0;
  const settingIds = new Set<string>();
  for (const c of rows) {
    for (const o of beatsOfChapter(outlines, c.id)) {
      beats += 1;
      const ex = parseBeatExtra(o.extra);
      if ((ex.status ?? "todo") === "written") written += 1;
      for (const id of [...idsOf(ex.cast), ...idsOf(ex.scenes)]) settingIds.add(id);
    }
  }
  return { beats, written, settingIds: [...settingIds] };
}

// ─── 树口径的卷账（2026-09-14 方案 A）：卷/章关系的事实源是 parent_id 树，
// 旧 volume 串口径（上面两个函数）只作后兼容保留 —— 两套模型零同步，弹窗/检视器一律走树。 ───

/**
 * 某节点子树里的**叶章 id**（无子级的内容行）。
 * 容器节点（部/卷/篇……）是结构不是内容，不计章数/字数；根自身是叶则返回它自己。
 * 防环：parentId 成环时 seen 兜底，不死循环。
 */
export function subtreeLeafIds(chapters: WritingChapter[], rootId: string): string[] {
  if (!rootId) return [];
  const childrenOf = new Map<string, string[]>();
  for (const c of chapters) {
    const p = c.parentId || "";
    const arr = childrenOf.get(p);
    if (arr) arr.push(c.id);
    else childrenOf.set(p, [c.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      out.push(id);
      return;
    }
    kids.forEach(walk);
  };
  walk(rootId);
  return out;
}

/** 树口径的卷账：以某节点为根的子树叶章统计（章列表 / 总字数 / 已完稿数） */
export function subtreeAccount(chapters: WritingChapter[], rootId: string): VolumeAccount {
  const leafIds = new Set(subtreeLeafIds(chapters, rootId));
  const rows = chapters.filter((c) => leafIds.has(c.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    rows,
    words: rows.reduce((n, c) => n + (c.wordCount || 0), 0),
    finished: rows.filter((c) => c.status === "finished").length,
  };
}

/** 树口径的节拍账：子树叶章挂的节拍数 / 已写数 / 挂过的设定 id（去重） */
export function subtreeBeatAccount(
  outlines: WritingOutline[],
  chapters: WritingChapter[],
  rootId: string
): VolumeBeatAccount {
  const leafIds = new Set(subtreeLeafIds(chapters, rootId));
  let beats = 0;
  let written = 0;
  const settingIds = new Set<string>();
  for (const o of outlines) {
    if (!o.chapterId || !leafIds.has(o.chapterId)) continue;
    beats += 1;
    const ex = parseBeatExtra(o.extra);
    if ((ex.status ?? "todo") === "written") written += 1;
    for (const id of [...idsOf(ex.cast), ...idsOf(ex.scenes)]) settingIds.add(id);
  }
  return { beats, written, settingIds: [...settingIds] };
}
