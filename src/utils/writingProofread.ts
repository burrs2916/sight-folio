// 校对体检口径（收拢纯函数，禁止在 pane/右栏各写第二份）：
//
// 校对页签 = 全书质量发现清单：**纯本地派生、零新表、零 Rust**，七组维度——
//   章文本（重复标点/三连同字/超长段落/连续空行/引号混用，本地正则，advisory 软提示）
//   章账（空章 / 标记完稿但 0 字）
//   伏笔（跨章预警，isOverdue 复用）
//   时间线（冲突 computeTimelineConflicts 复用 + 待补全草稿汇总）
//   剧情线（未挂线事件汇总 + 空线检测）
//   念头池（未分发念头汇总，beatImported/beatPlantedAsForeshadowing 复用）
//   一致性（跨章人物账本：设定全书未提及 / 卡名重复 / 疑似别名未登记 / 长期缺席）
// 发现是**可行动的**：每行带 target，点行即跳对应章/页签/实体（renderable ≠ useful）。
// 文本检查刻意克制：每章每类最多 1 条汇总行（带计数），不做逐条轰炸；
// 引擎级逐条命中（五类）随汇总行 textHits 携带，正文容器可展开「章内逐条闭环」。
//
// 一致性组的刻意边界（重要）：它只看**写作域自有数据**（章节正文 + 设定卡名与别名），
// 不读扫描层的 metadata.appearances。原因：扫描要作者手点「解析全书」，而体检不该因为
// 「忘了点一个按钮」就漏报。两个口径的分工——
//   writingOutline.chaptersOfSetting = 作者**显式挂载**到节拍的出场（= 计划）；
//   扫描层 metadata.appearances     = 后端落库的提及统计（= 服务画布画像）；
//   本模块 computeSettingAppearances = 就地派生的正文提及（= 服务体检，永远新鲜）。
import type { WritingChapter, WritingForeshadowing, WritingOutline, WritingTimelineEvent } from '../services/tauri';
import { isOverdue } from './writingForeshadowing';
import { computeTimelineConflicts, isComplete } from './writingTimeline';
import { looseBeats } from './writingOutline';
import { beatEventText, beatImported } from './writingTimeline';
import { beatPlantedAsForeshadowing } from './writingInspiration';
// 批次③ T5：错别字/重复用词/敏感词检测复用编辑器实时引擎，全书口径与编辑器口径同一份数据
import { runProofread, type ProofreadIssue } from '../editor/proofread/proofreadEngine';
// type-only：studioBook 不 import 本模块（无运行时环）；仅取值域映射（组→页签 kind）
import type { WritingViewKind } from './studioBook';

/** 轻量剥离 HTML 标签与常见实体 → 纯文本（<p>/<br> 归一为换行，供文本级校对使用）。 */
export function stripHtmlText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\n+$/g, '');
}

export type ProofreadGroup =
  | 'chapter-text'
  | 'chapter-account'
  | 'foreshadow'
  | 'timeline'
  | 'storyline'
  | 'idea'
  | 'consistency';

export type ProofreadTarget =
  | { type: 'chapter'; id: string }
  | { type: 'foreshadowing'; id: string }
  | { type: 'timeline-event'; id: string }
  | { type: 'idea'; id: string }
  /** 直接指向某张设定卡（一致性发现必须可定位到卡，而不是泛泛的「人物页签」） */
  | { type: 'setting'; id: string }
  | { type: 'view'; id: 'timeline' | 'storylines' | 'inspiration' | 'foreshadowing' | 'characters' };

/** 报告级发现条目（全书体检清单的一行；与引擎级 ProofreadIssue 同名不同构的问题已通过
 *  报告级改名 ProofreadFinding 消除——引擎级为文本级逐条问题，本类型为聚合/结构级发现）。 */
export interface ProofreadFinding {
  /** 稳定 key（React key / 跳转定位） */
  key: string;
  group: ProofreadGroup;
  /** i18n 键（writing.proofreadIssue.* 扁平键） */
  messageKey: string;
  args?: Record<string, string | number>;
  /** 跳转目标；无 = 仅计数展示 */
  target?: ProofreadTarget;
  severity?: 'warning' | 'block';
  /**
   * 正文定位锚点（T3：点行跳正文容器后滚动高亮到该文本）。
   * 章文本类聚合行携带**首个命中片段**（stripHtmlText 口径内的原文，可能含全角空格缩进），
   * 由正文编辑器按包含匹配定位；无片段（纯结构类问题）不携带。
   */
  locator?: { anchor: string };
  /**
   * 章文本聚合行携带的引擎级逐条命中（typ/repeat/sensitive/punct/redundant 五类全集）。
   * 空数组不挂（避免无谓引用）；非文本类聚合行不携带。
   * 用途：① 正文容器展开「章内逐条闭环」面板；② 一键修复判定（textHits.some(fix) 派生，
   *   替代对每章再跑 hasAutoFixableHtml 的重复扫描）。
   */
  textHits?: ProofreadIssue[];
}

/** 单章文本级检查（每类最多 1 条汇总行，args 带计数/字数）。 */
export function chapterTextIssues(chapter: WritingChapter): ProofreadFinding[] {
  const issues: ProofreadFinding[] = [];
  // 正文存 HTML（编辑器 getHTML()）；先剥标签/实体得到纯文本，五类+三类统一在同一文本口径下检测
  const text = stripHtmlText(chapter.content ?? '');
  if (!text.trim()) return issues;
  const mk = (messageKey: string, args?: Record<string, string | number>): ProofreadFinding => ({
    key: `${chapter.id}:${messageKey}`,
    group: 'chapter-text',
    messageKey,
    args,
    target: { type: 'chapter', id: chapter.id },
  });
  // 批次③ T5：引擎级五类检测在同一文本口径跑**一次**（聚合行 + textHits + 修复判定共用，
  // 消除 buildProofreadReport 后再 hasAutoFixableHtml 每章重扫的第二遍）
  const engineIssues = runProofread(text);
  const textHits = engineIssues.length > 0 ? engineIssues : undefined;
  // 重复标点：。。！！？？……——（同一标点紧邻出现 ≥2 次）
  const punct = text.match(/([。！？…，、；：])\1{1,}/g);
  if (punct && punct.length > 0) {
    issues.push({ ...mk('RepeatPunct', { n: punct.length }), locator: { anchor: punct[0].slice(0, 6) } });
  }
  // 三连同字：了了了 / 的的的 —— 几乎必是笔误（两连叠词是正常修辞，不报）
  const repeat = text.match(/([\u4e00-\u9fff])\1{2,}/g);
  if (repeat && repeat.length > 0) {
    issues.push({ ...mk('RepeatChar', { n: repeat.length }), locator: { anchor: repeat[0].slice(0, 6) } });
  }
  // 超长段落：单段 > 600 字无分段（阅读负担，advisory）
  const longPara = text.split(/\n/).filter((p) => p.trim().length > 600);
  if (longPara.length > 0) {
    issues.push({
      ...mk('LongParagraph', { n: longPara.length }),
      locator: { anchor: longPara[0].trim().slice(0, 12) },
    });
  }
  // 连续空行：≥3 个换行（含空白行）
  const blanks = text.match(/\n[ \t]*\n[ \t]*\n/g);
  if (blanks && blanks.length > 0) issues.push(mk('BlankLines', { n: blanks.length }));
  // 引号风格混用：弯引号与直引号并存
  if (text.includes('“') && text.includes('"')) issues.push(mk('QuoteMix'));
  // 错别字 / 重复用词 / 敏感词（引擎级逐条聚合为每类 1 条汇总行，逐条挂 textHits）
  const firstOf = (kind: ProofreadIssue['kind']) => engineIssues.find((i) => i.kind === kind);
  const byKind = {
    typo: engineIssues.filter((i) => i.kind === 'typo').length,
    repeat: engineIssues.filter((i) => i.kind === 'repeat').length,
    sensitive: engineIssues.filter((i) => i.kind === 'sensitive').length,
  };
  if (byKind.typo > 0) {
    const hit = firstOf('typo');
    issues.push({
      ...mk('TypoPhrase', { n: byKind.typo }),
      severity: 'warning',
      locator: hit ? { anchor: stripHtmlText(hit.excerpt).slice(0, 16) } : undefined,
    });
  }
  if (byKind.repeat > 0) {
    const hit = firstOf('repeat');
    issues.push({
      ...mk('RepeatPhrase', { n: byKind.repeat }),
      severity: 'warning',
      locator: hit ? { anchor: stripHtmlText(hit.excerpt).slice(0, 16) } : undefined,
    });
  }
  if (byKind.sensitive > 0) {
    const hasBlock = engineIssues.some((i) => i.kind === 'sensitive' && i.severity === 'block');
    const hit = firstOf('sensitive');
    issues.push({
      ...mk('SensitiveWord', { n: byKind.sensitive }),
      severity: hasBlock ? 'block' : 'warning',
      locator: hit ? { anchor: stripHtmlText(hit.excerpt).slice(0, 16) } : undefined,
    });
  }
  // 统一挂 textHits：所有章文本聚合行共享本行引擎全量命中（含 punct/redundant），
  // ① 正文容器可展开「章内逐条闭环」；② 修复判定 = textHits.some(fix)，
  // 与旧的 hasAutoFixableHtml（对整章再跑一遍引擎）完全等价——有内容即有引擎命中全集。
  return textHits ? issues.map((i) => ({ ...i, textHits })) : issues;
}

// ─── 一致性组：跨章人物账本（批次② 增-4）────────────────────────────────
// 就地派生自写作域自有数据，零后端、零迁移、零扫描。

/** 名称归一化：去空白与常见分隔符/括号，用于判定「其实是同一个人」。 */
export function normalizeSettingName(raw: string): string {
  return (raw ?? '')
    .replace(/[\s\u3000·・]/g, '')
    .replace(/[[\]【】()（）《》「」『』、，。．\-—_]/g, '')
    .toLowerCase();
}

/**
 * 设定卡在正文里可能出现的全部写法：卡名 ∪ `extra.aliases`（零迁移，与人设卡同一 extra）。
 * 刻意排除：`subtitle`（「青冥剑宗首席弟子」这类描述语不是称呼）、以及长度 < 2 的词
 * （单字名「墨」「雨」在正文里必然大量误命中）。
 */
export function settingMentionTerms(setting: { name: string; extra: string }): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== 'string') return;
    const s = v.trim();
    if (s.length >= 2 && !out.includes(s)) out.push(s);
  };
  push(setting.name);
  try {
    const parsed = JSON.parse(setting.extra || '{}') as { aliases?: unknown };
    if (Array.isArray(parsed?.aliases)) for (const a of parsed.aliases) push(a);
  } catch {
    // extra 脏数据当「无别名」处理，绝不因脏数据让整份体检渲染崩掉
  }
  return out;
}

/** 游标计数而非正则：设定名可能含正则元字符（「A-01」「B?」）。 */
function countTermHits(text: string, terms: string[]): number {
  let n = 0;
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(term, from);
      if (at < 0) break;
      n += 1;
      from = at + term.length;
    }
  }
  return n;
}

/** 一个设定卡的全书提及账本。 */
export interface SettingAppearance {
  settingId: string;
  name: string;
  terms: string[];
  total: number;
  /** 提及所在章 id，按章序 */
  chapterIds: string[];
  /**
   * 逐章提及次数（只挂命中的章，未命中章不占位）。
   * 出场图谱的热力格直接读它——图谱与体检因此共用同一份计数，不会各说一套。
   */
  countsByChapter: Map<string, number>;
  /** 相邻两次提及之间的最大空档章数 */
  maxGap: number;
  /** 全书（有正文的章里）一次都没出现 */
  neverMentioned: boolean;
}

/**
 * 跨章人物账本：每个设定在正文里被提及几次、出现在哪些章、最长断档多少章。
 * 只统计**有正文的章**——否则「整本还没开始写」会被误判成所有人物集体缺席。
 */
export function computeSettingAppearances(
  chapters: WritingChapter[],
  settings: { id: string; name: string; extra: string }[],
): SettingAppearance[] {
  const corpus = [...chapters]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ id: c.id, text: stripHtmlText(c.content ?? '') }))
    .filter((c) => c.text.trim().length > 0);
  const hasBody = corpus.length > 0;
  return settings.map((s) => {
    const terms = settingMentionTerms(s);
    const presentAt: number[] = [];
    const countsByChapter = new Map<string, number>();
    let total = 0;
    corpus.forEach((c, i) => {
      const hit = countTermHits(c.text, terms);
      if (hit > 0) {
        total += hit;
        presentAt.push(i);
        countsByChapter.set(c.id, hit);
      }
    });
    let maxGap = 0;
    for (let i = 1; i < presentAt.length; i++) maxGap = Math.max(presentAt[i] - presentAt[i - 1] - 1, maxGap);
    return {
      settingId: s.id,
      name: s.name,
      terms,
      total,
      chapterIds: presentAt.map((i) => corpus[i].id),
      countsByChapter,
      maxGap,
      neverMentioned: hasBody && terms.length > 0 && total === 0,
    };
  });
}

/** 长期缺席判定门槛：短书报「断档」纯属噪音，所以同时要求书长。 */
const ABSENCE_GAP_CHAPTERS = 30;
const ABSENCE_MIN_CHAPTERS = 40;

/**
 * 一致性发现：此前完全检不出的一类——人物账本与正文对不上。
 *
 * 四条规则，互斥不重复报：
 * ① 卡名归一化后重名 → `block`（两条卡其实是同一个人，之后怎么写都会精神分裂）；
 * ② 零提及设定 → `warning`（死设定，**不再依赖手点「解析全书」**）；
 * ③ 零提及且与某「有提及」卡构成前缀关系 → 改报「疑似别名/旧称未登记」，
 *    比只说「没出场」更可行动（要么删卡，要么把短名登记进别名）；
 * ④ 提及过但中间断档 ≥ 30 章（且全书 ≥ 40 章）→ `warning`（人物长期失踪）。
 *
 * 刻意**不做编辑距离模糊匹配**：中文名「李明 / 李强」距离同样是 1，但那是两个人。
 * 阈值取小天天报警、取大又检不出，所以只用确定性的归一化重名与前缀两条。
 */
export function consistencyFindings(
  chapters: WritingChapter[],
  settings: { id: string; name: string; extra: string }[],
): ProofreadFinding[] {
  const issues: ProofreadFinding[] = [];
  if (settings.length === 0) return issues;
  const rows = computeSettingAppearances(chapters, settings);

  // ① 归一化重名。target 指向其中一张卡：四条一致性规则统一「点行开卡」，
  // 因为要改的都是卡本身（合并卡 / 登记别名 / 补出场 / 删卡）。
  const byNorm = new Map<string, typeof rows>();
  for (const r of rows) {
    const n = normalizeSettingName(r.name);
    if (!n) continue;
    byNorm.set(n, [...(byNorm.get(n) ?? []), r]);
  }
  for (const [norm, group] of byNorm) {
    if (group.length < 2) continue;
    issues.push({
      key: `cs:dup:${norm}`,
      group: 'consistency',
      messageKey: 'DuplicateSettingName',
      args: { names: Array.from(new Set(group.map((r) => r.name.trim() || '…'))).join(' / '), n: group.length },
      target: { type: 'setting', id: group[0]?.settingId ?? '' },
      severity: 'block',
    });
  }

  // ②③ 零提及：能判定成「疑似别名未登记」的不报泛泛的「没出场」
  const mentioned = rows.filter((r) => r.total > 0);
  for (const r of rows) {
    if (!r.neverMentioned) continue;
    const rn = normalizeSettingName(r.name);
    if (!rn) continue;
    const parent = mentioned.find((m) => {
      const mn = normalizeSettingName(m.name);
      if (!mn) return false;
      return (mn.startsWith(rn) || rn.startsWith(mn)) && Math.min(mn.length, rn.length) >= 2;
    });
    if (parent) {
      issues.push({
        key: `cs:alias:${r.settingId}`,
        group: 'consistency',
        messageKey: 'SuspectedUnregisteredAlias',
        args: { name: r.name.trim() || '…', other: parent.name.trim() || '…' },
        target: { type: 'setting', id: r.settingId },
        severity: 'warning',
      });
    } else {
      issues.push({
        key: `cs:dead:${r.settingId}`,
        group: 'consistency',
        messageKey: 'ZeroMentionSetting',
        args: { name: r.name.trim() || '…' },
        target: { type: 'setting', id: r.settingId },
        severity: 'warning',
      });
    }
  }

  // ④ 长期失踪
  const bodyCount = chapters.filter((c) => stripHtmlText(c.content ?? '').trim().length > 0).length;
  if (bodyCount >= ABSENCE_MIN_CHAPTERS) {
    for (const r of rows) {
      if (r.total === 0 || r.maxGap < ABSENCE_GAP_CHAPTERS) continue;
      issues.push({
        key: `cs:absent:${r.settingId}`,
        group: 'consistency',
        messageKey: 'SettingLongAbsent',
        args: { name: r.name.trim() || '…', gap: r.maxGap },
        target: { type: 'setting', id: r.settingId },
        severity: 'warning',
      });
    }
  }

  return issues;
}

export interface ProofreadReport {
  issues: ProofreadFinding[];
  counts: Record<ProofreadGroup, number>;
}

export const PROOFREAD_GROUPS: ProofreadGroup[] = [
  'chapter-text',
  'chapter-account',
  'foreshadow',
  'timeline',
  'storyline',
  'idea',
  'consistency',
];

/** 全书体检汇总（七组维度；纯派生，零迁移，便于单测）。 */
export function buildProofreadReport(
  chapters: WritingChapter[],
  outlines: WritingOutline[],
  timelineEvents: WritingTimelineEvent[],
  foreshadowings: WritingForeshadowing[],
  storylines: { id: string; name?: string }[] = [],
  /** 设定卡（人物 + 世界观）。不传 = 跳过一致性组（老调用点向后兼容，不会误报） */
  settings: { id: string; name: string; extra: string; kind?: string }[] = [],
): ProofreadReport {
  const issues: ProofreadFinding[] = [];

  // ① 章文本 + ② 章账（逐章）
  for (const c of chapters) {
    issues.push(...chapterTextIssues(c));
    if (!c.content?.trim() && (c.wordCount ?? 0) === 0) {
      issues.push({
        key: `${c.id}:empty`,
        group: 'chapter-account',
        messageKey: 'EmptyChapter',
        args: { title: c.title || '…' },
        target: { type: 'chapter', id: c.id },
        severity: 'warning',
      });
    } else if (c.status === 'finished' && (c.wordCount ?? 0) === 0) {
      issues.push({
        key: `${c.id}:fin0`,
        group: 'chapter-account',
        messageKey: 'FinishedNoWords',
        args: { title: c.title || '…' },
        target: { type: 'chapter', id: c.id },
        severity: 'block',
      });
    }
  }

  // ③ 伏笔：跨章预警逐条（isOverdue 与伏笔页签同一口径）
  for (const f of foreshadowings) {
    if (isOverdue(f, chapters)) {
      issues.push({
        key: `fs:${f.id}`,
        group: 'foreshadow',
        messageKey: 'ForeshadowOverdueRow',
        args: { title: f.title || '…' },
        target: { type: 'foreshadowing', id: f.id },
        severity: 'warning',
      });
    }
  }

  // ④ 时间线：冲突逐行（跳选中事件）+ 待补全草稿汇总行（跳时间线页签）
  const conflictIds = computeTimelineConflicts(timelineEvents, { view: 'book' });
  for (const evId of conflictIds) {
    const ev = timelineEvents.find((e) => e.id === evId);
    issues.push({
      key: `ev:${evId}`,
      group: 'timeline',
      messageKey: 'TimelineConflictRow',
      args: { text: (ev?.event || '').slice(0, 24) || '…' },
      target: { type: 'timeline-event', id: evId },
      severity: 'block',
    });
  }
  const drafts = timelineEvents.filter((e) => !isComplete(e));
  if (drafts.length > 0) {
    issues.push({
      key: 'tl:drafts',
      group: 'timeline',
      messageKey: 'TimelineDraftRow',
      args: { n: drafts.length },
      target: { type: 'view', id: 'timeline' },
      severity: 'warning',
    });
  }

  // ⑤ 剧情线：未挂线事件汇总行
  const unlined = timelineEvents.filter((e) => !e.storylineId);
  if (unlined.length > 0) {
    issues.push({
      key: 'sl:unlined',
      group: 'storyline',
      messageKey: 'StorylineUnlinedRow',
      args: { n: unlined.length },
      target: { type: 'view', id: 'storylines' },
      severity: 'warning',
    });
  }
  // ⑤′ 剧情线：空线（建了线却一个事件都没挂 = 废弃的线头）。
  // 原为 `void storylines` 预留位，此处补上真实线级体检。
  if (storylines.length > 0) {
    const usedLines = new Set(timelineEvents.map((e) => e.storylineId).filter((v): v is string => !!v));
    const emptyLines = storylines.filter((l) => !usedLines.has(l.id));
    if (emptyLines.length === 1) {
      issues.push({
        key: 'sl:empty',
        group: 'storyline',
        messageKey: 'StorylineEmptyOne',
        args: { name: emptyLines[0]?.name?.trim() || '…' },
        target: { type: 'view', id: 'storylines' },
        severity: 'warning',
      });
    } else if (emptyLines.length > 1) {
      issues.push({
        key: 'sl:empty',
        group: 'storyline',
        messageKey: 'StorylineEmptyRow',
        args: { n: emptyLines.length },
        target: { type: 'view', id: 'storylines' },
        severity: 'warning',
      });
    }
  }

  // ⑥ 念头池：未分发念头汇总行（已转时间线/伏笔的不算）
  const loose = looseBeats(outlines);
  const fresh = loose.filter(
    (b) => !beatImported(timelineEvents, beatEventText(b)) && !beatPlantedAsForeshadowing(foreshadowings, b),
  );
  if (fresh.length > 0) {
    issues.push({
      key: 'idea:fresh',
      group: 'idea',
      messageKey: 'IdeaUndispatchedRow',
      args: { n: fresh.length },
      target: fresh.length === 1 && fresh[0] ? { type: 'idea', id: fresh[0].id } : { type: 'view', id: 'inspiration' },
      severity: 'warning',
    });
  }
  // ⑦ 一致性：跨章人物账本（正文提及 vs 设定卡）。传了 settings 才算，老调用点不误报。
  if (settings.length > 0) issues.push(...consistencyFindings(chapters, settings));

  const counts = PROOFREAD_GROUPS.reduce(
    (acc, g) => ({ ...acc, [g]: issues.filter((i) => i.group === g).length }),
    {} as Record<ProofreadGroup, number>,
  );
  return { issues, counts };
}

// ─── 排序与过滤（纯函数，供校对页签左栏浏览用；禁在 pane 重写第二份） ───

export type ProofreadSeverityFilter = 'all' | 'block' | 'warning';
export type ProofreadSortMode = 'default' | 'severity' | 'chapter' | 'type';

/** 严重性数值（0=必须处理 block / 1=建议处理 warning / 2=普通）。 */
export function proofreadSeverityRank(issue: ProofreadFinding): number {
  if (issue.severity === 'block') return 0;
  if (issue.severity === 'warning') return 1;
  return 2;
}

/** severity → 标识色（对标灵感状态 chip 的语义三色：严重红 / 建议琥珀 / 普通灰）。 */
export function proofreadSeverityColor(severity: ProofreadFinding['severity']): string {
  if (severity === 'block') return '#dc2626';
  if (severity === 'warning') return '#b45309';
  return '#94a3b8';
}

/** 按严重性过滤；all 返回原数组（顺序不变）。 */
export function filterProofreadIssues(
  issues: ProofreadFinding[],
  severity: ProofreadSeverityFilter,
): ProofreadFinding[] {
  if (severity === 'all') return issues;
  return issues.filter((i) => i.severity === severity);
}

/** 排序：default 保持派发序；severity 严重在前；chapter 按章序（无 target 章排后）；type 按 messageKey 字典序（同键稳定）。 */
export function sortProofreadIssues(
  issues: ProofreadFinding[],
  mode: ProofreadSortMode,
  chapterOrder: string[] = [],
): ProofreadFinding[] {
  if (mode === 'default') return issues;
  const arr = [...issues];
  if (mode === 'severity') {
    arr.sort((a, b) => proofreadSeverityRank(a) - proofreadSeverityRank(b));
  } else if (mode === 'chapter') {
    const order = new Map(chapterOrder.map((id, idx) => [id, idx]));
    arr.sort((a, b) => {
      const ai =
        a.target?.type === 'chapter' ? (order.get(a.target.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const bi =
        b.target?.type === 'chapter' ? (order.get(b.target.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  } else {
    arr.sort((a, b) => {
      const ka = a.messageKey + ':' + a.key;
      const kb = b.messageKey + ':' + b.key;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }
  return arr;
}

/** 组 → i18n 组名键（group 值带连字符，leaf 键用驼峰）。 */
export function proofreadGroupLabelKey(g: ProofreadGroup): string {
  switch (g) {
    case 'chapter-text':
      return 'writing.proofreadGroup.ChapterText';
    case 'chapter-account':
      return 'writing.proofreadGroup.ChapterAccount';
    case 'foreshadow':
      return 'writing.proofreadGroup.Foreshadow';
    case 'timeline':
      return 'writing.proofreadGroup.Timeline';
    case 'storyline':
      return 'writing.proofreadGroup.Storyline';
    case 'idea':
      return 'writing.proofreadGroup.Idea';
    case 'consistency':
      return 'writing.proofreadGroup.Consistency';
  }
}

/** 组 → 页签去向（无页签的组返回 null = 不可跳）。 */
export function proofreadGroupView(g: ProofreadGroup): WritingViewKind | null {
  switch (g) {
    case 'foreshadow':
      return 'foreshadowing';
    case 'timeline':
      return 'timeline';
    case 'storyline':
      return 'storylines';
    case 'idea':
      return 'inspiration';
    case 'consistency':
      // 一致性发现全部指向设定库（人物/世界观卡）——问题出在卡与正文对不上，改卡在卡那边
      return 'characters';
    default:
      return null;
  }
}
