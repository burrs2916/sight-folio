// sight-folio: 书场景「题材语料」构建器（双语，纯函数、零迁移、单测直跑）。
//
// 从 workbenchPanelHooks 独立成文件（原 8 个语料构建器挤在 UI hooks 文件里不便测，
// 且 AI 域 writingContextProvider 需跨层 import 该 UI 文件——耦合坏味道）。
// 收拢口径：全部从真实数据派生（章节/设定/剧情线/伏笔/大纲/时间线），不重算第二份；
// AI 域与 UI 面板共用这一份实现，口径零第二份。
//
// 依赖面：services/tauri 类型 + parseSettingExtra + utils/writingTimeline /
// writingForeshadowing / writingOutline / writingInspiration / writingProofread /
// writingStats，全部为纯函数与类型，无 React/store 依赖，单测直接跑。

import type {
  WritingSetting,
  WritingTimelineEvent,
  WritingStoryline,
  WritingForeshadowing,
  WritingOutline,
  WritingChapter,
  WritingRelation,
} from '../services/tauri';
import { parseSettingExtra } from '../services/tauri';
import { isComplete, computeTimelineConflicts, beatEventText, beatImported } from './writingTimeline';
import { isOverdue } from './writingForeshadowing';
import { looseBeats } from './writingOutline';
import { beatPlantedAsForeshadowing } from './writingInspiration';
import { buildProofreadReport, chapterTextIssues } from './writingProofread';
import { genreDef, viewKindVisibleForGenre, writesByDateForGenre } from './writingSchema';
import { computeDiaryRhythm, diaryRecords } from './diaryMetrics';
import {
  computeWritingKpis,
  buildVolumeRows,
  buildChapterWordRows,
  resolveVolumeResolver,
  contentChapters,
  volumeNameOf,
} from './writingStats';
import {
  MAX_CONFLICT_TEXTS,
  MAX_TEXT_ISSUE_CHAPTERS,
  MAX_OUTLIER_ROWS,
  MAX_SKELETON_CHAPTERS,
  MANUSCRIPT_PREV_COUNT,
  MANUSCRIPT_TAIL_CHARS,
  CHAPTER_TAIL_CHARS,
} from './writingCorpusBudget';

// ─── 共享字段位模板表（builder 与 provider 同源，防双维护） ───
// 人物/世界观的结构化档案字段清单只有这一份：UI 侧语料 builder（本文件 + writingAiCorpus）
// 与 AI 域 writingContextProvider 都按同一张表 + 同一个展开函数生成「标签=值」位，
// 增改字段只动这一处；差异仅是紧凑行（占位符全量输出）与详情行（只输出有值）两种形态。

export interface CorpusFieldDef {
  /** profile / worldbuildingProfile 对象中的键 */
  key: string;
  zh: string;
  en: string;
  /** 可选值包装（如 relations 包成 [x]） */
  wrap?: (v: string) => string;
}

/** 人物档案结构化字段：外貌/性格/动机/口头禅/备注 */
export const CHARACTER_PROFILE_FIELDS: readonly CorpusFieldDef[] = [
  { key: 'appearance', zh: '外貌', en: 'appearance' },
  { key: 'personality', zh: '性格', en: 'personality' },
  { key: 'motivation', zh: '动机', en: 'motivation' },
  { key: 'catchphrase', zh: '口头禅', en: 'catchphrase' },
  { key: 'notes', zh: '备注', en: 'notes' },
];

/** 世界观类型字段（builder 放名称括号中的分类 / provider 放详情位首位，故单独列出） */
export const WORLDBUILDING_TYPE_FIELD: CorpusFieldDef = { key: 'type', zh: '类型', en: 'type' };

/** 世界观行内结构化字段：规则/例外/关联/关系/备注（type 由调用方按形态摆放） */
export const WORLDBUILDING_PROFILE_FIELDS: readonly CorpusFieldDef[] = [
  { key: 'rules', zh: '规则', en: 'rules' },
  { key: 'exceptions', zh: '例外', en: 'exceptions' },
  { key: 'linkedTo', zh: '关联', en: 'linked' },
  { key: 'relations', zh: '关系', en: 'relations', wrap: (v) => `[${v}]` },
  { key: 'notes', zh: '备注', en: 'notes' },
];

/** 关系展开：#targetId 优先（#id）→ 自由文本 target → type；空值过滤；「、」连接 */
export function expandRelations(relations: WritingRelation[] | undefined): string {
  return (relations ?? [])
    .map((r) => (r.targetId ? `#${r.targetId}` : '') || r.target || r.type || '')
    .filter(Boolean)
    .join('、');
}

/** 关系化引用解析索引：实体 id → 真实名称（设定/章节/剧情线均可纳入） */
export type RefIndex = ReadonlyMap<string, string>;

/**
 * 收集语料引用索引：把当前书的设定（人物/世界观）、章节、剧情线的 id→名称
 * 汇总成一张表，供 resolveRefs 把语料中的 #id 引用解析为可读名称。
 * 引用常见形态：`#c-1`（设定）、`#chap_a`（章节）、`#L1`（剧情线）。
 */
export function buildRefIndex(
  settings: WritingSetting[],
  chapters: WritingChapter[] = [],
  storylines: WritingStoryline[] = [],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of settings) m.set(s.id, s.name || s.id);
  for (const c of chapters) m.set(c.id, c.title || c.id);
  for (const sl of storylines) m.set(sl.id, sl.name || sl.id);
  return m;
}

/**
 * 关系化引用解析（双语标注）：把文本中形如 `#<id>` 的引用解析为「名称(#id)」，
 * 让模型既能读懂引用指向哪条实体，又保留原 id 作锚点；索引中不存在的 id
 * 显式标注「（引用缺失）」，防止模型把悬空引用当成有效实体。
 * 规则：id 以小写/大写字母开头（如 #c-1、#chap_a、#L1），排除 #hex 颜色误伤；
 * 索引为空或文本无引用时原样返回（幂等、零副作用）。
 */
// 形如 #f59e0b / #abc 的 CSS 颜色字面量不视为引用（3 或 6 位 hex）
const HEX_COLOR_RE = /^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export function resolveRefs(text: string, refIndex: RefIndex, lang: 'zh' | 'en' = 'zh'): string {
  if (!text || refIndex.size === 0) return text;
  const missing = lang === 'en' ? ' (missing ref)' : '（引用缺失）';
  return text.replace(/#([a-zA-Z][a-zA-Z0-9_-]*)/g, (raw, id: string) => {
    if (HEX_COLOR_RE.test(id)) return raw; // #hex 颜色原样保留
    const name = refIndex.get(id);
    if (name === undefined) return `${raw}${missing}`;
    return `${name}(${raw})`;
  });
}

/**
 * 按字段表生成「标签=值」位（双语）。
 * placeholder 传 '—' 时全字段输出（无值取占位，builder 紧凑行用）；
 * 不传时只输出有值位（provider 详情行用）。
 */
export function corpusBits(
  fields: readonly CorpusFieldDef[],
  getValue: (key: string) => string | undefined,
  placeholder?: string,
): { zh: string[]; en: string[] } {
  const zh: string[] = [];
  const en: string[] = [];
  for (const f of fields) {
    const v = getValue(f.key) || (placeholder !== undefined ? placeholder : undefined);
    if (v === undefined) continue;
    const rendered = f.wrap ? f.wrap(v) : v;
    zh.push(`${f.zh}=${rendered}`);
    en.push(`${f.en}=${rendered}`);
  }
  return { zh, en };
}

/**
 * 全书「世界观设定库」语料（双语）。汇集当前书的世界观设定
 * （类型/规则/例外/关联/关系/备注）与人物卡概要，供多处复用：
 * ① 普通世界观消息自动注入（面板侧经 ctx.bookSettingCorpus 透传）；
 * ② 全书设定一致性审查提示词（buildWorldConsistencyPrompt）；
 * ③ 写作台对话首轮自动注入（opts.includeCharacters=false 只取世界观段，
 *    避免与 buildCharactersCorpus 的人物档案重复——后者字段更全）。
 * 关系（relations）逐条展开为「#targetId / 名称 / 类型」，便于模型核对自洽性。
 * opts.refIndex（可选）：传入当前书 id→名称 索引时，对关系位展开的 #id 引用
 * 做关系化解析（resolveRefs），缺失引用显式标注；不传则保留 #id 原样（兼容旧断言）。
 */
export function buildWorldBibleCorpus(
  settings: WritingSetting[],
  opts: { includeCharacters?: boolean; refIndex?: RefIndex } = {},
): { zh: string; en: string } {
  const { includeCharacters = true } = opts;
  const worlds = settings.filter((s) => s.kind === 'worldbuilding');
  const chars = includeCharacters ? settings.filter((s) => s.kind === 'character') : [];
  // 人物卡概要段沿用既有 4 字段口径（不含口头禅，保持较紧凑）；字段定义仍来自共享表。
  const charSummaryFields = CHARACTER_PROFILE_FIELDS.filter((f) => f.key !== 'catchphrase');
  const worldRows = worlds.map((s) => {
    const e = parseSettingExtra(s.extra);
    const wb = e.worldbuildingProfile ?? {};
    const rels = expandRelations(e.relations);
    const wbBits = corpusBits(
      WORLDBUILDING_PROFILE_FIELDS,
      (k) => (k === 'relations' ? rels || undefined : (wb as Record<string, string | undefined>)[k]),
      '—',
    );
    return {
      zh: `- ${s.name}（${wb.type || '未分类'}）：${wbBits.zh.join('；')}`,
      en: `- ${s.name} (${wb.type || 'uncategorized'}): ${wbBits.en.join('；')}`,
    };
  });
  const charRows = chars.map((s) => {
    const p = parseSettingExtra(s.extra).profile ?? {};
    const charBits = corpusBits(charSummaryFields, (k) => (p as Record<string, string | undefined>)[k], '—');
    return {
      zh: `- ${s.name}：${charBits.zh.join('；')}`,
      en: `- ${s.name}: ${charBits.en.join('；')}`,
    };
  });
  const worldSectionZh = worldRows.length ? worldRows.map((r) => r.zh).join('\n') : '（暂无世界观设定）';
  const worldSectionEn = worldRows.length ? worldRows.map((r) => r.en).join('\n') : '(no worldbuilding yet)';
  const charSectionZh = charRows.length ? charRows.map((r) => r.zh).join('\n') : '（暂无人物卡）';
  const charSectionEn = charRows.length ? charRows.map((r) => r.en).join('\n') : '(no characters yet)';
  const charsBlockZh = includeCharacters ? `\n\n【人物】\n${charSectionZh}` : '';
  const charsBlockEn = includeCharacters ? `\n\n[Characters]\n${charSectionEn}` : '';
  const baseZh = `【世界观设定】\n${worldSectionZh}${charsBlockZh}`;
  const baseEn = `[Worldbuilding]\n${worldSectionEn}${charsBlockEn}`;
  const { refIndex } = opts;
  return {
    zh: refIndex ? resolveRefs(baseZh, refIndex, 'zh') : baseZh,
    en: refIndex ? resolveRefs(baseEn, refIndex, 'en') : baseEn,
  };
}

/**
 * 全书「时间线档案」语料（双语）。汇集当前书的章节骨架 + 剧情线结构（线名 +
 * 挂线事件摘要 + 未挂线清单）+ 时间线事件全表
 * （时点=作者原文自由文本，不换算不推导）+ 冲突清单 + 待补全草稿，供时间线题材的 AI 消息
 * 自动注入（面板侧经 ctx.bookSettingCorpus 透传）。冲突口径与右栏总览卡一致
 * （book+chapter 两视图并集，复用 utils/writingTimeline 同一份算法，禁再写第二份）。
 * opts.refIndex（可选）：传入时对事件文本中的 #id 引用做关系化解析（resolveRefs）。
 */
export function buildTimelineCorpus(
  bookId: string | null,
  events: WritingTimelineEvent[],
  chapters: WritingChapter[],
  settings: WritingSetting[],
  storylines: WritingStoryline[] = [],
  opts: { refIndex?: RefIndex; genre?: string } = {},
): { zh: string; en: string } {
  // ㉧ AI-5c：这张档案里的「章」全部是**替这本书宣布层级形状**的词，
  // 诗集收到「章节骨架 / 绑章」就会以为自己是本没分卷的短篇集（⑭ 刀C 判过的同一个病）。
  // 判据（哪些事件算未绑、冲突怎么并集）一格未动，本轮只换措辞，词全取 CORPUS_NOUNS。
  const nouns = corpusNounsFor(opts.genre ?? '');
  const coll = new Intl.Collator('zh', { numeric: true });
  const chapterName = (id: string | null | undefined): { zh: string; en: string } => {
    const c = id ? chapters.find((x) => x.id === id) : null;
    if (!c) return { zh: `未绑${nouns.zh.line}`, en: 'unbound' };
    const t = c.title || '未命名';
    return { zh: t, en: t };
  };
  const settingName = (id: string | null | undefined): string => {
    if (!id) return '全书级';
    return settings.find((s) => s.id === id)?.name || '未命名';
  };
  const settingNameEn = (id: string | null | undefined): string => {
    if (!id) return 'book-level';
    return settings.find((s) => s.id === id)?.name || 'unnamed';
  };

  // 章节骨架（阅读顺序 = sortOrder）
  const skeleton = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const skelZh = skeleton.length
    ? skeleton.map((c, i) => `${i + 1}. ${c.title || '未命名'}${c.kind ? `（${c.kind}）` : ''}`).join(' ')
    : `（暂无${nouns.zh.unit}）`;
  const skelEn = skeleton.length
    ? skeleton.map((c, i) => `${i + 1}. ${c.title || 'untitled'}${c.kind ? ` (${c.kind})` : ''}`).join(' ')
    : `(no ${nouns.en.unit} yet)`;

  // 事件全表：完整事件按 at 排序；待补全草稿单列
  const complete = events.filter(isComplete).sort((a, b) => coll.compare(a.at?.trim() || '', b.at?.trim() || ''));
  const drafts = events.filter((e) => !isComplete(e));
  const eventRows = complete.map((e) => {
    const src = `来源：${settingName(e.settingId)}`;
    const srcEn = `source: ${settingNameEn(e.settingId)}`;
    const ch = e.chapterId ? `；绑${nouns.zh.line}：${chapterName(e.chapterId).zh}` : '';
    const chEn = e.chapterId ? `; ${nouns.en.unitOne}: ${chapterName(e.chapterId).en}` : '';
    return {
      zh: `- [${e.at}] ${e.event}（${src}${ch}）`,
      en: `- [${e.at}] ${e.event} (${srcEn}${chEn})`,
    };
  });
  const draftRows = drafts.map((e) => {
    const has = e.event || e.at;
    return {
      zh: `- ${has ? `[${e.at ?? '无时点'}] ${e.event ?? '无描述'}` : '空草稿'}（来源：${settingName(e.settingId)}）`,
      en: `- ${has ? `[${e.at ?? 'no when'}] ${e.event ?? 'no description'}` : 'empty draft'} (source: ${settingNameEn(e.settingId)})`,
    };
  });
  const evZh = eventRows.length ? eventRows.map((r) => r.zh).join('\n') : '（暂无时间线事件）';
  const evEn = eventRows.length ? eventRows.map((r) => r.en).join('\n') : '(no timeline events yet)';
  const draftZh = draftRows.length ? draftRows.map((r) => r.zh).join('\n') : '（无待补全草稿）';
  const draftEn = draftRows.length ? draftRows.map((r) => r.en).join('\n') : '(no drafts to complete)';

  // 冲突清单：与右栏总览卡同口径（两视图并集）
  const conflictIds = new Set([
    ...computeTimelineConflicts(events, { view: 'book' }),
    ...computeTimelineConflicts(events, {
      view: 'chapter',
      chapters: [...chapters].sort((a, b) => a.sortOrder - b.sortOrder),
    }),
  ]);
  const conflictEvents = events.filter((e) => conflictIds.has(e.id));
  const conflictZh = conflictEvents.length
    ? conflictEvents
        .map(
          (e) =>
              `- [${e.at}] ${e.event}（${e.chapterId ? `${nouns.zh.line}：${chapterName(e.chapterId).zh}` : `来源：${settingName(e.settingId)}`}）`,
        )
        .join('\n')
    : '（未检出冲突）';
  const conflictEn = conflictEvents.length
    ? conflictEvents
        .map(
          (e) =>
              `- [${e.at}] ${e.event} (${e.chapterId ? `${nouns.en.unitOne}: ${chapterName(e.chapterId).en}` : `source: ${settingNameEn(e.settingId)}`})`,
        )
        .join('\n')
    : '(no conflicts detected)';

  // 剧情线结构：每条线名 + 挂线事件摘要 + 未挂线清单（advisory 口径，与右栏总览卡一致）
  const lineRows = storylines.map((sl) => {
    const evs = complete.filter((e) => e.storylineId === sl.id);
    const summary = evs.length ? evs.map((e) => `[${e.at}] ${e.event}`).join('；') : null;
    return {
      sl,
      count: evs.length,
      zh: `- ${sl.name}（${evs.length} 条事件）${summary ? `：${summary}` : '：尚无挂线事件'}`,
      en: `- ${sl.name} (${evs.length} events)${summary ? `: ${summary}` : ': no attached events yet'}`,
    };
  });
  const unlined = complete.filter((e) => !e.storylineId);
  const lineZh = lineRows.length
    ? lineRows.map((r) => r.zh).join('\n') +
      (unlined.length
        ? `\n- 未挂线事件（${unlined.length} 条）：${unlined.map((e) => `[${e.at}] ${e.event}`).join('；')}`
        : '')
    : '（暂无剧情线）';
  const lineEn = lineRows.length
    ? lineRows.map((r) => r.en).join('\n') +
      (unlined.length
        ? `\n- unlined events (${unlined.length}): ${unlined.map((e) => `[${e.at}] ${e.event}`).join('; ')}`
        : '')
    : '(no storylines yet)';

  // ㉲ AI-3（轮 33 · 注入层裁段）：剧情线段与页签/入口同一张表判 —— 被裁体裁且本书从未建过剧情线时，
  // 这一段不再端给模型（诗集不该收到一条「【剧情线（0 条）】」替它宣布栏目存在）；被裁体裁**已建过**
  // 剧情线（存量数据）照旧在段，页签侧「数据不因裁页签而隐身」的护栏在注入层同样成立。
  // 段在场时 baseZh/baseEn 与改造前逐字节相同（小说 / 剧本 / 存量路径 = 零回归线）。
  const storylinesPruned = storylines.length === 0 && !viewKindVisibleForGenre(opts.genre ?? '', 'storylines');
  const storylineBlockZh = storylinesPruned ? '' : `\n\n【剧情线（${storylines.length} 条）】\n${lineZh}`;
  const storylineBlockEn = storylinesPruned ? '' : `\n\n[Storylines (${storylines.length})]\n${lineEn}`;
  const baseZh = `【时间线档案】\n【${nouns.zh.unit}骨架】${skelZh}${storylineBlockZh}\n\n【事件全表（${complete.length} 条）】\n${evZh}\n\n【时间线冲突（${conflictEvents.length}，规划提示非硬错误）】\n${conflictZh}\n\n【待补全草稿（${drafts.length}）】\n${draftZh}`;
  const baseEn = `[Timeline]\n[${capEn(nouns.en.unitOne)} skeleton] ${skelEn}${storylineBlockEn}\n\n[Events (${complete.length})]\n${evEn}\n\n[Timeline conflicts (${conflictEvents.length}, planning hints, not hard errors)]\n${conflictEn}\n\n[Drafts to complete (${drafts.length})]\n${draftEn}`;
  const { refIndex } = opts;
  return {
    zh: refIndex ? resolveRefs(baseZh, refIndex, 'zh') : baseZh,
    en: refIndex ? resolveRefs(baseEn, refIndex, 'en') : baseEn,
  };
}

/**
 * 全书「伏笔档案」语料（双语）：三态清单（标题/状态/埋设章/计划回收章/挂线）
 * + 跨章预警（回收点已到/已过仍待回收）+ 未挂线计数，供伏笔题材的 AI 消息自动注入。
 * opts.refIndex（可选）：传入时对伏笔描述中的 #id 引用做关系化解析（resolveRefs）。
 */
export function buildForeshadowingCorpus(
  bookId: string | null,
  foreshadowings: WritingForeshadowing[],
  chapters: WritingChapter[],
  storylines: WritingStoryline[] = [],
  opts: { refIndex?: RefIndex } = {},
): { zh: string; en: string } {
  const chName = (id: string | null | undefined): string => {
    if (!id) return '未锚定';
    return chapters.find((c) => c.id === id)?.title || '未命名';
  };
  const chNameEn = (id: string | null | undefined): string => {
    if (!id) return 'unanchored';
    return chapters.find((c) => c.id === id)?.title || 'untitled';
  };
  const statusZh = (s: string): string => (s === 'pending' ? '待回收' : s === 'paidoff' ? '已回收' : '已弃置');
  const statusEn = (s: string): string => (s === 'pending' ? 'pending' : s === 'paidoff' ? 'paid off' : 'abandoned');

  const rows = foreshadowings.map((f) => {
    const overdue = isOverdue(f, chapters);
    const line = f.storylineId ? (storylines.find((sl) => sl.id === f.storylineId)?.name ?? '') : '';
    const zh =
      `- [${statusZh(f.status)}] ${f.title || '未命名'}（埋设：${chName(f.plantChapterId)}；计划回收：${chName(f.payoffChapterId)}）` +
      (line ? `〔挂线：${line}〕` : '') +
      (overdue ? ' ⚠ 回收点已过仍未回收' : '') +
      (f.description ? `—— ${f.description}` : '');
    const en =
      `- [${statusEn(f.status)}] ${f.title || 'unnamed'} (planted: ${chNameEn(f.plantChapterId)}; planned payoff: ${chNameEn(f.payoffChapterId)})` +
      (line ? ` [line: ${line}]` : '') +
      (overdue ? ' ⚠ payoff point passed but still pending' : '') +
      (f.description ? ` — ${f.description}` : '');
    return { zh, en };
  });
  const pending = foreshadowings.filter((f) => f.status === 'pending').length;
  const overdue = foreshadowings.filter((f) => isOverdue(f, chapters)).length;
  const rowsZh = rows.length ? rows.map((r) => r.zh).join('\n') : '（暂无伏笔）';
  const rowsEn = rows.length ? rows.map((r) => r.en).join('\n') : '(no foreshadowing yet)';
  const baseZh = `【伏笔档案】共 ${foreshadowings.length} 条（待回收 ${pending}，跨章预警 ${overdue}）\n${rowsZh}\n（伏笔=作者手填的「埋设→回收」承诺，预警仅为规划提示非硬错误）`;
  const baseEn = `[Foreshadowing] ${foreshadowings.length} total (${pending} pending, ${overdue} overdue warnings)\n${rowsEn}\n(Foreshadowing = the author's hand-written plant/payoff promises; warnings are planning hints, not hard errors)`;
  const { refIndex } = opts;
  return {
    zh: refIndex ? resolveRefs(baseZh, refIndex, 'zh') : baseZh,
    en: refIndex ? resolveRefs(baseEn, refIndex, 'en') : baseEn,
  };
}

/**
 * 全书「灵感念头池」语料（双语）：未落章 beat（loose beats）清单
 * （标题/摘要/分发状态：已入时间线 / 已入伏笔）+ 未分发计数，供灵感题材的 AI 消息自动注入。
 * 口径与编辑面/右栏同一份：looseBeats（writingOutline）+ beatImported（writingTimeline）
 * + beatPlantedAsForeshadowing（writingInspiration），禁止第二套。
 */
export function buildInspirationCorpus(
  bookId: string | null,
  outlines: WritingOutline[],
  timelineEvents: WritingTimelineEvent[],
  foreshadowings: WritingForeshadowing[] = [],
  genre = '',
): { zh: string; en: string } {
  void bookId; // 与 buildForeshadowingCorpus 同签名惯例：调用方已按书过滤
  // ㉧ AI-5c：这节语料里「未落章节拍 / 挂章」两次替四种载体宣布它有「章」这个落点。
  const nouns = corpusNounsFor(genre);
  const loose = looseBeats(outlines);
  const rows = loose.map((b) => {
    const inTimeline = beatImported(timelineEvents, beatEventText(b));
    const inForeshadow = beatPlantedAsForeshadowing(foreshadowings, b);
    const marksZh = (inTimeline ? '〔已入时间线〕' : '') + (inForeshadow ? '〔已入伏笔〕' : '');
    const marksEn = (inTimeline ? ' [in timeline]' : '') + (inForeshadow ? ' [in foreshadowing]' : '');
    const zh = `- ${b.title || '未命名念头'}${marksZh}` + (b.summary ? `—— ${b.summary}` : '');
    const en = `- ${b.title || 'untitled idea'}${marksEn}` + (b.summary ? ` — ${b.summary}` : '');
    return { zh, en };
  });
  const dispatched = rows.filter((_, i) => {
    const b = loose[i];
    return beatImported(timelineEvents, beatEventText(b)) || beatPlantedAsForeshadowing(foreshadowings, b);
  }).length;
  const rowsZh = rows.length ? rows.map((r) => r.zh).join('\n') : '（念头池为空）';
  const rowsEn = rows.length ? rows.map((r) => r.en).join('\n') : '(idea pool is empty)';
  return {
    zh: `【灵感念头池】共 ${loose.length} 条（未分发 ${rows.length - dispatched}）\n${rowsZh}\n（念头=作者手记的灵感收件箱=${nouns.zh.unanchored}，脑暴时尊重已有念头的语气与题材；分发去向：挂${nouns.zh.line}/转时间线/转伏笔，标记〔已入…〕的不要重复建议）`,
    en: `[Idea pool] ${loose.length} total (${rows.length - dispatched} undispatched)\n${rowsEn}\n(Ideas = the author's hand-captured inbox = unanchored beats; respect the tone and genre of existing ideas; dispatch = bind to ${nouns.en.bindTo} / timeline draft / foreshadowing draft; do not re-suggest ideas already marked [in …])`,
  };
}

/**
 * 全书「校对体检」语料（双语）：复用 buildProofreadReport 全部发现，
 * 输出分组计数 + 关键明细（预警伏笔/冲突事件/文本问题章）。
 * 供校对题材的 AI 消息自动注入。语义层检查（错别字/连贯性）明确交给 AI 在对话里做。
 */
export function buildProofreadCorpus(
  bookId: string | null,
  chapters: WritingChapter[],
  outlines: WritingOutline[],
  timelineEvents: WritingTimelineEvent[],
  foreshadowings: WritingForeshadowing[],
  storylines: WritingStoryline[] = [],
  /** 设定卡：传入才会带上一致性组（人物账本 vs 正文）。缺省跳过，向后兼容。 */
  settings: { id: string; name: string; extra: string }[] = [],
  /** ㉬ N-21：体裁。缺省 '' = 六组全跑（旧调用点逐字等价）；日记这类藏了栏的体裁会裁掉对应组，
   *  否则我们等于在语料里催模型「帮这本日记回收伏笔」——那栏系统根本不让他建。 */
  genre = '',
): { zh: string; en: string } {
  void bookId; // 与其他 corpus 同签名惯例：调用方已按书过滤
  const report = buildProofreadReport(chapters, outlines, timelineEvents, foreshadowings, storylines, settings, genre);
  const total = report.issues.length;

  const overdueZh = foreshadowings.filter((f) => isOverdue(f, chapters)).map((f) => f.title || '未命名');
  const overdueEn = [...overdueZh];
  const conflictTexts = [...computeTimelineConflicts(timelineEvents, { view: 'book' })]
    .map((id) => timelineEvents.find((e) => e.id === id)?.event || '')
    .filter(Boolean)
    .slice(0, MAX_CONFLICT_TEXTS);
  const drafts = timelineEvents.filter((e) => !isComplete(e)).length;
  const unlined = timelineEvents.filter((e) => !e.storylineId).length;
  const loose = looseBeats(outlines);
  const fresh = loose.filter(
    (b) => !beatImported(timelineEvents, beatEventText(b)) && !beatPlantedAsForeshadowing(foreshadowings, b),
  ).length;
  const textIssuesZh = chapters
    .map((c) => ({ title: c.title || '未命名', issues: chapterTextIssues(c, genre) }))
    .filter((x) => x.issues.length > 0)
    .slice(0, MAX_TEXT_ISSUE_CHAPTERS);

  const linesZh: string[] = [`【校对体检】共 ${total} 项发现`];
  if (textIssuesZh.length > 0) {
    linesZh.push(`〔章文本〕` + textIssuesZh.map((x) => `《${x.title}》(${x.issues.length} 项)`).join('、'));
  }
  if (overdueZh.length > 0) linesZh.push(`〔伏笔〕回收点已过仍未回收：${overdueZh.join('、')}`);
  if (conflictTexts.length > 0) linesZh.push(`〔时间线〕冲突事件：${conflictTexts.join('；')}`);
  if (drafts > 0) linesZh.push(`〔时间线〕待补全草稿 ${drafts} 条`);
  if (unlined > 0) linesZh.push(`〔剧情线〕未挂线事件 ${unlined} 条`);
  if (fresh > 0) linesZh.push(`〔念头池〕未分发念头 ${fresh} 条`);
  if (total === 0) linesZh.push('（体检全绿：暂无本地可派生的发现）');
  linesZh.push(
    '（校对=本地派生软提示，advisory 不强制；错别字/重复用词/连贯性等语义层问题请用 file_read 逐章细读后在回答里指出）',
  );

  const linesEn: string[] = [`[Proofread] ${total} findings`];
  if (textIssuesZh.length > 0) {
    linesEn.push(`[Chapter text] ` + textIssuesZh.map((x) => `"${x.title}" (${x.issues.length})`).join(', '));
  }
  if (overdueEn.length > 0) linesEn.push(`[Foreshadowing] payoff overdue: ${overdueEn.join(', ')}`);
  if (conflictTexts.length > 0) linesEn.push(`[Timeline] conflicting events: ${conflictTexts.join('; ')}`);
  if (drafts > 0) linesEn.push(`[Timeline] ${drafts} draft(s) to complete`);
  if (unlined > 0) linesEn.push(`[Storylines] ${unlined} unlined event(s)`);
  if (fresh > 0) linesEn.push(`[Idea pool] ${fresh} undispatched idea(s)`);
  if (total === 0) linesEn.push('(All green: no locally derivable findings)');
  linesEn.push(
    '(Proofread = local derived soft hints, advisory only; for typos / repeated wording / coherence, read chapters via file_read and point them out in your answer)',
  );

  return { zh: linesZh.join('\n'), en: linesEn.join('\n') };
}

/**
 * 全书「写作统计」语料（双语）：复用 utils/writingStats 的 KPI/卷分布/
 * 章节体量口径，输出体量 KPI + 卷分布 + 离群章（advisory）+ 节奏提示，供统计题材的
 * AI 消息自动注入。日更趋势（Rust 快照）不进语料——异步数据由页签面直接呈现。
 */
/**
 * 语料里三个量词按体裁换（⑭ 分析文档刀C）。对一本诗集说「章节 8 · 卷 0 · 章均 23 字」，
 * 模型会把它当成「一本没分卷的短篇集」按小说方式铺承接；散文集同理。
 * 判据只有 isCollectionGenre 一份，这里只放**双语措辞** —— writingSchema 的铁律是
 * 「只存 i18n key、不存成品文案」，而语料是中英两份内联串（不是 i18n），住不进那张表。
 *
 * ㉥ AI-5b 补的 `groupCol`（只加在 en 侧）：那是**索引表的分组列名**。zh 侧单复同形，列名直接吃
 * `group` 就是对的；en 侧的 `group` 是复数口径（统计行「N …」那种用法），表头要单数，两者不是
 * 同一个词形。所以这里只补 en 那一格，**不再开第二张量词表**，也不让渲染层自己写字面量。
 * novel 那格 = 改造前索引表表头逐字（零回归线）。
 *
 * ㉧ AI-5c（2026-11-10 轮 20）再补三格，形状与上面同一判据「现成格能推出来的不加，推不出的才登记」：
 * - `zh.unanchored`：念头池那节的名字。novel 是 `未落章节拍`，**不能由 line 推**（`未落章` ≠ 现文），
 *   四支换成不含「章」的说法。en 侧那节题改造前就是 `Unanchored beats`，无单位词可换 → **不加 en 格**。
 * - `en.unitOne`：单数可数形（`; chapter: ` / `## Chapter List` / `[Chapter skeleton]` 要吃它）。
 *   `en.unit` 是复数口径、`en.avg` 是定语口径（diary 那格是形容词 daily），三者不是同一个词形。
 *   zh 侧单复同形，一律由现成 `line` 推（绑章/挂章），**不加 zh 格**。
 * - `en.bindTo`：带冠词的形状（`a chapter` … diary 是 `an entry`）。冠词随首音变，机械拼 `a ` 会写出
 *   `a entry`，所以整枚登记；zh 侧同样由 `line` 推。
 * novel 三格 = 改造前逐字（零回归线）。
 */
const CORPUS_NOUNS = {
  novel: {
    zh: { unit: '章节', group: '卷', avg: '章均', ungrouped: '未分卷', line: '章', unanchored: '未落章节拍', outlierNone: '无（各章体量均在章均常规区间）' },
    en: { unit: 'chapters', group: 'volumes', groupCol: 'Volume', unitOne: 'chapter', bindTo: 'a chapter', avg: 'chapter', ungrouped: 'no volume', outlierNone: 'none (chapter sizes within normal range)' },
  },
  // 合集型（散文 / 诗歌）：**离群行永远会打印**，所以空态措辞也必须按体裁 ——
  // 对诗集说「无（各章体量均在章均常规区间）」等于替它宣布了一个它根本没有的量纲。
  essay: {
    zh: { unit: '篇目', group: '分组', avg: '篇均', ungrouped: '未分组', line: '篇', unanchored: '未落篇目', outlierNone: '不适用（合集型长短差异属体裁常态，不按均值判离群）' },
    en: { unit: 'pieces', group: 'groups', groupCol: 'Group', unitOne: 'piece', bindTo: 'a piece', avg: 'piece', ungrouped: 'ungrouped', outlierNone: 'not applicable (length variation is normal for a collection)' },
  },
  poetry: {
    zh: { unit: '诗作', group: '分组', avg: '首均', ungrouped: '未分组', line: '首', unanchored: '未落诗作', outlierNone: '不适用（诗集长短悬殊是常态，不按均值判离群）' },
    en: { unit: 'poems', group: 'groups', groupCol: 'Group', unitOne: 'poem', bindTo: 'a poem', avg: 'poem', ungrouped: 'ungrouped', outlierNone: 'not applicable (poem lengths legitimately vary)' },
  },
  // 剧本（⑮-2）：层级是**幕 › 场**，所以分组词必须是「幕」而不是通用的「分组」；
  // 而且它**不是**合集型 —— 场次体量是节奏工具，离群行照判，空态因此写「无（…）」不是「不适用」。
  script: {
    zh: { unit: '场次', group: '幕', avg: '场均', ungrouped: '未分幕', line: '场', unanchored: '未落场次', outlierNone: '无（各场体量均在场均常规区间）' },
    en: { unit: 'scenes', group: 'acts', groupCol: 'Act', unitOne: 'scene', bindTo: 'a scene', avg: 'scene', ungrouped: 'unplaced', outlierNone: 'none (scene sizes within normal range)' },
  },
  // 日记（2026-11-10）：分组是**年与月**，既不是卷也不是幕；它是合集型 —— 某天写两千字、
  // 某天只写一行，是日记的常态而非缺陷，所以离群空态写「不适用」而不是「无（…常规区间）」。
  diary: {
    zh: { unit: '日记', group: '年月', avg: '日均', ungrouped: '未归年月', line: '天', unanchored: '未落日记', outlierNone: '不适用（日记各天长短悬殊属常态，不按均值判离群）' },
    en: { unit: 'entries', group: 'year/month', groupCol: 'Year/month', unitOne: 'entry', bindTo: 'an entry', avg: 'daily', ungrouped: 'unfiled', outlierNone: 'not applicable (daily lengths legitimately vary)' },
  },
} as const;

/** 一张表五个体裁的形状（导出给 corpusNounsFor 的返回位，别让调用方自己写 (typeof X)[keyof typeof X]） */
export type CorpusNouns = (typeof CORPUS_NOUNS)[keyof typeof CORPUS_NOUNS];

/**
 * en 语料在**行标签 / 表头 / 节题**位置要首字母大写（`Chapters`、`Chapter List`、`Chapter skeleton`）。
 *
 * 为什么是机械大写而不是再登记一格：大写是正字法，不是另一个词 —— 五支的 `cap(unit)` 与
 * `cap(unitOne)` 逐字等于改造前那三枚裸字面（由 `corpusGenreUnitWords` 套锁死），
 * 再加 `unitCap`/`unitOneCap` 两格就是让同一个词在同一张表里存三种写法，迟早漂。
 */
export function capEn(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * 取本体裁的语料量词表（⑭ 刀C 的判据收口，㉞ T-F″ 起为**唯一入口**）。
 *
 * 为什么单独导出：`buildStatsCorpus` 之外还有 `buildCatalogCorpus`（大纲骨架）要说
 * 「无组那一组」叫什么。两处各写一遍下标式取表迟早漂——
 * 本仓为「同一件事两张表」付过 N 次钱（见 writingSchema `canCreateEntityForGenre` 头注释）。
 * 回落口径与全仓一致：未设置 / 未登记 / 脏值 = 小说，逐字零回归。
 */
export function corpusNounsFor(genre = ''): CorpusNouns {
  return CORPUS_NOUNS[(genreDef(genre)?.id as keyof typeof CORPUS_NOUNS) ?? 'novel'] ?? CORPUS_NOUNS.novel;
}

export function buildStatsCorpus(
  bookTitle: string | null,
  chapters: WritingChapter[],
  settings: WritingSetting[],
  goalLine?: { zh: string; en: string } | null,
  genre = '',
): { zh: string; en: string } {
  const kpis = computeWritingKpis(chapters, settings);
  const volRows = buildVolumeRows(chapters);
  const chRows = buildChapterWordRows(chapters, genre);
  const outliers = chRows.filter((r) => r.outlier !== null);
  const titleZh = bookTitle ? `《${bookTitle}》` : '';
  const titleEn = bookTitle ? `"${bookTitle}"` : '';
  // 量词按体裁（⑭ 刀C）：对诗集说「章节 / 卷 / 章均」，模型会按「没分卷的短篇集」去铺承接
  // 判定走 genreDef（不在语料层写 genre 字面量）；未设置 / 未开闸体裁 = 小说口径，逐字不变
  const u = corpusNounsFor(genre);

  const linesZh: string[] = [
    `【写作统计】${titleZh}总字数 ${kpis.totalWords.toLocaleString()} · ${u.zh.unit} ${kpis.chapterCount} · ${u.zh.group} ${kpis.volumeCount} · 设定条目 ${kpis.settingCount} · ${u.zh.avg} ${kpis.avgWords} 字`,
  ];
  if (volRows.length > 0) {
    linesZh.push(
      `〔卷分布〕` +
        volRows
          .map((v) => `${v.volume || u.zh.ungrouped}：${v.chapters} ${u.zh.line} ${v.finished} 完稿 ${v.words.toLocaleString()} 字`)
          .join('；'),
    );
  }
  // ㉖ 日记专属：把「连续 / 空档 / 未标日期」算准了再交给模型。
  // 书级命令「空档」要求模型回答「中间跨了多久」（workbenchSlashCommands.ts:566-576），
  // 而它此前拿到的条目清单**没有日期列**（见 ㉖ 取证 1）⇒ 它只能凭「第 N 天」这种序号猜。
  // 这些数字现在是本地派生的事实，模型不必也不许自己发明日期。
  if (writesByDateForGenre(genre)) {
    const rhythm = computeDiaryRhythm(chapters);
    if (rhythm.distinctDates > 0) {
      const gapZh = rhythm.gaps.map((g) => `${g.from}~${g.to} ${g.days} 天`).join('、');
      linesZh.push(
        `〔记录节奏〕连续 ${rhythm.currentStreak} 天（最长 ${rhythm.longestStreak} 天）· 共记 ${rhythm.distinctDates} 天` +
          ` · 最后一条 ${rhythm.lastDate} · 首末之间空 ${rhythm.gapDays} 天` +
          (gapZh ? `（${gapZh}）` : '') +
          (rhythm.duplicates.length > 0 ? ` · ${rhythm.duplicates.length} 天写了不止一条` : '') +
          (rhythm.undatedCount > 0
            ? ` · 另有 ${rhythm.undatedCount} 条未标日期，未计入以上节奏`
            : ' · 全部条目均已标日期'),
      );
    } else {
      linesZh.push(`〔记录节奏〕暂无带日期的条目，连续与空档**不可推断**，不要凭条目序号猜日期`);
    }
  }
  if (outliers.length > 0) {
    linesZh.push(
      `〔体量离群〕` +
        outliers
          .slice(0, MAX_OUTLIER_ROWS)
          .map((r) => `《${r.title}》${r.outlier === 'long' ? '超长' : '偏短'} ${r.words.toLocaleString()} 字`)
          .join('、') +
        '（advisory 仅供参考，可能是刻意的节奏设计）',
    );
  } else {
    linesZh.push(`〔体量离群〕${u.zh.outlierNone}`);
  }
  linesZh.push('（统计=本地派生软提示；节奏与体量建议尊重创作者意图，advisory 不强制）');

  const linesEn: string[] = [
    `[Writing stats] ${titleEn} total ${kpis.totalWords.toLocaleString()} words · ${kpis.chapterCount} ${u.en.unit} · ${kpis.volumeCount} ${u.en.group} · ${kpis.settingCount} setting entries · avg ${kpis.avgWords} words/${u.en.avg}`,
  ];
  if (volRows.length > 0) {
    linesEn.push(
      `[Volume distribution] ` +
        volRows
          .map(
            (v) =>
              `${v.volume || 'unfiled'}: ${v.chapters} ch, ${v.finished} finished, ${v.words.toLocaleString()} words`,
          )
          .join('; '),
    );
  }
  if (writesByDateForGenre(genre)) {
    const rhythm = computeDiaryRhythm(chapters);
    if (rhythm.distinctDates > 0) {
      const gapEn = rhythm.gaps.map((g) => `${g.from}~${g.to} ${g.days}d`).join(', ');
      linesEn.push(
        `[Journal rhythm] ${rhythm.currentStreak}-day streak (longest ${rhythm.longestStreak}) · ${rhythm.distinctDates} days recorded` +
          ` · last entry ${rhythm.lastDate} · ${rhythm.gapDays} blank days between first and last` +
          (gapEn ? ` (${gapEn})` : '') +
          (rhythm.duplicates.length > 0 ? ` · ${rhythm.duplicates.length} days carry more than one entry` : '') +
          (rhythm.undatedCount > 0
            ? ` · ${rhythm.undatedCount} undated entries stay out of these numbers`
            : ' · every entry is dated'),
      );
    } else {
      linesEn.push(`[Journal rhythm] no dated entries yet — streaks and gaps are **not inferable**; never guess dates from entry order`);
    }
  }
  if (outliers.length > 0) {
    linesEn.push(
      `[Outliers] ` +
        outliers
          .slice(0, MAX_OUTLIER_ROWS)
          .map((r) => `"${r.title}" ${r.outlier === 'long' ? 'long' : 'short'} ${r.words.toLocaleString()} words`)
          .join(', ') +
        ' (advisory only; may be deliberate pacing)',
    );
  } else {
    linesEn.push(`[Outliers] ${u.en.outlierNone}`);
  }
  linesEn.push("(Stats = local derived soft hints; respect the creator's intent, advisory only)");

  if (goalLine) {
    // 全书目标与进度：紧跟标题后置顶，让 AI 先看到创作者立的里程碑再给体量建议
    linesZh.splice(1, 0, goalLine.zh);
    linesEn.splice(1, 0, goalLine.en);
  }

  return { zh: linesZh.join('\n'), en: linesEn.join('\n') };
}

/** 把章节 content（TipTap HTML）拍平成纯文本段落（语料注入用，标签噪声不进模型上下文）
 *  文风指纹引擎（writingStyleFingerprint）复用同一实现，保证「注入样本」与「统计样本」口径一致。 */
export function stripChapterHtml(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 正文写作语料（双语）：当前激活章正文（超 CHAPTER_TAIL_CHARS 只注入结尾并显式标注）
 * + 前情提要（前 2 章各尾部 400 字）+ 全书章节骨架。供「写作」题材（正文视图）的
 * AI 消息自动注入——续写/修改建议都要有当前章正文与前后文才能作答。无激活章时只给骨架。
 */
export function buildManuscriptCorpus(
  bookTitle: string | null,
  chapters: WritingChapter[],
  activeChapterId: string | null,
): { zh: string; en: string } {
  const sorted = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = activeChapterId ? sorted.findIndex((c) => c.id === activeChapterId) : -1;
  const current = idx >= 0 ? sorted[idx] : null;
  const titleZh = bookTitle ? `《${bookTitle}》` : '';
  const titleEn = bookTitle ? `"${bookTitle}"` : '';

  // 章节骨架（限 120 章，防超长书撑爆上下文）
  const skeletonZh = sorted
    .slice(0, MAX_SKELETON_CHAPTERS)
    .map(
      (c, i) =>
        `${i + 1}. ${c.title || '未命名'} · ${(c.wordCount || 0).toLocaleString()} 字${c.status === 'finished' ? ' · 完稿' : ''}`,
    );
  const skeletonEn = sorted
    .slice(0, MAX_SKELETON_CHAPTERS)
    .map(
      (c, i) =>
        `${i + 1}. ${c.title || 'untitled'} · ${(c.wordCount || 0).toLocaleString()} words${c.status === 'finished' ? ' · finished' : ''}`,
    );

  // 前情提要：当前章之前 2 章，各取尾部 400 字
  const prevZh: string[] = [];
  const prevEn: string[] = [];
  if (idx > 0) {
    for (const c of sorted.slice(Math.max(0, idx - MANUSCRIPT_PREV_COUNT), idx)) {
      const text = stripChapterHtml(c.content ?? '');
      if (!text) continue;
      prevZh.push(`〔${c.title || '未命名'} 尾段〕…${text.slice(-MANUSCRIPT_TAIL_CHARS)}`);
      prevEn.push(`[${c.title || 'untitled'} ending] …${text.slice(-MANUSCRIPT_TAIL_CHARS)}`);
    }
  }

  // 长度闸（第三十八轮批次1刀②）：超长章全文直接注入会整窗撑爆——本语料每轮拼进 user
  // 消息，3 万字章 ≈ 3 万+ token 起步。口径复用内联续写的 TAIL_CHARS（真源
  // writingCorpusBudget.CHAPTER_TAIL_CHARS，双语同一份判定，只算一次）：超上限只注入结尾，
  // 并在头行显式标注，防模型把尾段当整章、或把「字数」读成注入内容的体积。
  const currentText = current ? stripChapterHtml(current.content ?? '') : '';
  const currentOverCap = currentText.length > CHAPTER_TAIL_CHARS;
  const currentBody = currentOverCap ? `…${currentText.slice(-CHAPTER_TAIL_CHARS)}` : currentText;

  const linesZh: string[] = [`【正文写作】${titleZh}共 ${sorted.length} 章`];
  linesZh.push('〔章节骨架〕');
  linesZh.push(...skeletonZh);
  if (current) {
    linesZh.push(
      `〔当前章〕${current.title || '未命名'}（${(current.wordCount || 0).toLocaleString()} 字${
        currentOverCap ? ' · 超长，仅注入结尾部分' : ''
      }）`,
    );
    if (currentText) linesZh.push(currentBody);
    else linesZh.push('（本章正文为空——新章起步）');
    if (prevZh.length > 0) {
      linesZh.push('〔前情提要〕');
      linesZh.push(...prevZh);
    }
  } else {
    linesZh.push('（当前无激活章节——正文页签未打开章节，按骨架作答即可）');
  }
  linesZh.push('（续写时衔接上文语气与叙事节奏；尊重已有情节，改写建议说清理由，不要整章重写）');

  const linesEn: string[] = [`[Manuscript] ${titleEn} ${sorted.length} chapters`];
  linesEn.push('[Chapter skeleton]');
  linesEn.push(...skeletonEn);
  if (current) {
    linesEn.push(
      `[Current chapter] ${current.title || 'untitled'} (${(current.wordCount || 0).toLocaleString()} words${
        currentOverCap ? ' · tail only, length-capped' : ''
      })`,
    );
    if (currentText) linesEn.push(currentBody);
    else linesEn.push('(This chapter is empty — fresh start)');
    if (prevEn.length > 0) {
      linesEn.push('[Previously]');
      linesEn.push(...prevEn);
    }
  } else {
    linesEn.push('(No active chapter — manuscript tab has no chapter open; answer from the skeleton)');
  }
  linesEn.push(
    'When continuing, match the voice and pacing above; respect existing plot; give reasons for revision suggestions instead of rewriting whole chapters.',
  );

  return { zh: linesZh.join('\n'), en: linesEn.join('\n') };
}

/**
 * 正文视图此刻是否有可用正文（第三十八轮批次1刀③：兜底追问分流的判据）。
 * 与 buildManuscriptCorpus「本章正文为空——新章起步」同一判定源：HTML 拍平后非空才算有，
 * 空标签/纯空白不算——防止追问说「润色上面这段正文」而视图里根本没有正文。
 */
export function hasChapterManuscript(chapters: WritingChapter[], activeChapterId: string | null): boolean {
  const current = activeChapterId ? (chapters.find((c) => c.id === activeChapterId) ?? null) : null;
  return !!current && stripChapterHtml(current.content ?? '').trim().length > 0;
}

/**
 * 全书世界观/人物设定一致性审查提示词（双语）。复用 buildWorldBibleCorpus 汇集设定语料，
 * 让 AI 核对：人物能力是否违反核心规则、与例外是否冲突、relations 是否自洽、
 * rules 与 exceptions 是否内部矛盾。纯函数、零迁移，便于单测。
 */
export function buildWorldConsistencyPrompt(bookTitle: string, settings: WritingSetting[]): { zh: string; en: string } {
  const corpus = buildWorldBibleCorpus(settings);
  const zh =
    `请作为严谨的「世界观/设定一致性审查」助手，审查小说《${bookTitle}》的设定资料，` +
    `找出人物与世界观设定之间的冲突或矛盾。重点关注：\n` +
    `1. 人物能力/属性是否违反世界观的「核心规则」；\n` +
    `2. 是否存在与「例外/破例」相冲突的设定；\n` +
    `3. 关联关系（relations）是否自洽、是否指向不存在的条目；\n` +
    `4. 同一世界观设定内部 rules 与 exceptions 是否互相矛盾。\n\n` +
    `要求：逐条列出发现的冲突，指明涉及的人物/设定名称与具体字段；若未发现明显冲突，` +
    `也请说明你核对了哪些维度、结论是什么。若没有任何设定资料，请直接说明「暂无设定资料」。\n\n` +
    corpus.zh;
  const en =
    `Act as a rigorous worldbuilding/setting consistency reviewer. Examine the setting material of the novel "${bookTitle}" ` +
    `and find conflicts or contradictions between characters and worldbuilding. Focus on:\n` +
    `1. whether character abilities/traits violate the world's "core rules";\n` +
    `2. whether any setting contradicts its own "exceptions";\n` +
    `3. whether relations are self-consistent and point to existing entries;\n` +
    `4. whether a worldbuilding entry's rules and exceptions contradict each other.\n\n` +
    `List each conflict with the involved character/setting names and specific fields; if none, ` +
    `state what you checked and the conclusion. If there is no setting material at all, say "no setting material".\n\n` +
    corpus.en;
  return { zh, en };
}

/**
 * 章节索引表语料（双语，md 表格行数组）——「分组 → 正文单位」结构一览，供作品概览等
 * 需要全书章节结构的场景注入。
 *
 * 与 mdTable（ai/providers/scanSections）形态一致但自含渲染：本函数在 utils 层，
 * 不允许反向依赖 ai 层工具；空章节时返回「无数据」提示行而不是空表。
 * 已分组的书带分组列，未分组省略（与 provider 既有 hasVolumes 判定口径一致）。
 * genre（㉥ AI-5b）：那一列的**列名**按载体取 —— 改造前恒写小说那一支，于是诗集/剧本/日记本
 * 收到这张表，就等于本仓亲口向模型宣布「你有一个卷层」，模型会按「没分卷的书」去铺承接。
 * 列名只是措辞，判据（有没有这一列、列里装什么）一律不动。
 */
export function buildChapterIndexCorpus(chapters: WritingChapter[], genre = ''): { zh: string[]; en: string[] } {
  const r = resolveVolumeResolver(chapters);
  const content = contentChapters(r, chapters);
  const sorted = [...content].sort((a, b) => a.sortOrder - b.sortOrder);
  const hasVolumes = sorted.some((c) => volumeNameOf(r, c));
  // ㉖ 日期列**按数据判、不按体裁字面量判**：没有任何条目带 entryDate（= 现在全部非日记书）
  // 这张表与改造前逐字节相同；日记则多一列，模型才答得出「空档」命令要的「跨了多久」。
  const dateOf = new Map<string, string>(diaryRecords(chapters).dated.map((x) => [x.chapterId, x.date]));
  const hasDates = sorted.some((c) => dateOf.has(c.id));
  // 列名走那张唯一的量词表（zh 单复同形吃 group，en 吃 groupCol；novel 两支 = 改造前逐字）
  const nouns = corpusNounsFor(genre);
  const headersZh = ['序号', ...(hasVolumes ? [nouns.zh.group] : []), ...(hasDates ? ['日期'] : []), '标题', '字数', '状态'];
  const headersEn = ['#', ...(hasVolumes ? [nouns.en.groupCol] : []), ...(hasDates ? ['Date'] : []), 'Title', 'Words', 'Status'];
  const emptyZh = ['_无数据_'];
  const emptyEn = ['_no data_'];
  if (sorted.length === 0) return { zh: emptyZh, en: emptyEn };

  const zhRows = sorted.map((c, i) => [
    String(i + 1),
    ...(hasVolumes ? [volumeNameOf(r, c) || '-'] : []),
    ...(hasDates ? [dateOf.get(c.id) ?? '-'] : []),
    c.title,
    String(c.wordCount),
    c.status,
  ]);
  const enRows = zhRows; // 内容不含语言特定词（标题/卷/字数/状态均为数据本身）
  const render = (headers: string[], rows: string[][]) => [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
  return { zh: render(headersZh, zhRows), en: render(headersEn, enRows) };
}
