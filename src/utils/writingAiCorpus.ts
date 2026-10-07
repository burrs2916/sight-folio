// sight-folio: 书场景 AI 题材语料补充（纯函数、零迁移、单测直跑）
//
// 与 workbenchPanelHooks 里既有的 buildWorldBibleCorpus / buildTimelineCorpus 等同级，
// 但独立成文件以便单测（既有的题材语料函数挤在 22k 行的 hooks 文件里不便测）。
// 收拢口径：人物/大纲/聚焦设定全部从真实 writingStore 数据派生，不重算第二份。
//
// 该文件只依赖 services/tauri 的类型 + parseSettingExtra + utils/writingOutline，单测直接跑。

import type { WritingSetting, WritingChapter, WritingOutline } from '../services/tauri';
import { parseSettingExtra } from '../services/tauri';
import { looseBeats } from './writingOutline';
import { CHARACTER_PROFILE_FIELDS, corpusBits, type RefIndex, resolveRefs } from './writingCorpus';
import { MAX_LOOSE_BEATS } from './writingCorpusBudget';
import { contentChapters, resolveVolumeResolver, volumeNameOf } from './writingStats';

/**
 * 人物题材语料（双语）：把当前书所有人物卡浓缩为「姓名 + 副标题 + 外貌/性格/动机/口头禅/备注」，
 * 让 AI 在「人物」视图每轮都带真实人物档案作答，不再只靠全书总览快照猜。
 * 字段清单复用 writingCorpus 共享表（provider 同源，防双维护）。
 */
export function buildCharactersCorpus(settings: WritingSetting[]): { zh: string; en: string } {
  const chars = settings.filter((s) => s.kind === 'character');
  const rows = chars.map((s) => {
    const p = parseSettingExtra(s.extra).profile ?? {};
    const { zh, en } = corpusBits(CHARACTER_PROFILE_FIELDS, (k) => (p as Record<string, string | undefined>)[k], '—');
    return {
      zh: `- ${s.name}${s.subtitle ? `（${s.subtitle}）` : ''}：${zh.join('；')}`,
      en: `- ${s.name}${s.subtitle ? ` (${s.subtitle})` : ''}: ${en.join('；')}`,
    };
  });
  const sectionZh = rows.length ? rows.map((r) => r.zh).join('\n') : '（暂无人物卡）';
  const sectionEn = rows.length ? rows.map((r) => r.en).join('\n') : '(no characters yet)';
  return { zh: `【人物卡】\n${sectionZh}`, en: `[Characters]\n${sectionEn}` };
}

/**
 * 大纲题材语料（双语）：以「卷 → 章节骨架」呈现全书结构（章名 + 字数 + 状态），
 * 并附「未落章节拍（念头池）」——让 AI 在「大纲」视图带真实结构作答。
 * 卷序按章首现顺序；章节按 sortOrder。
 * opts.chapterLimit（可选）：超过该章节数时截断骨架并附「其余省略」提示，
 * 供写作台首轮注入等 token 敏感场景防膨胀；缺省为全量（工作台行为不变）。
 */
export function buildCatalogCorpus(
  chapters: WritingChapter[],
  outlines: WritingOutline[],
  opts?: { chapterLimit?: number },
): { zh: string; en: string } {
  const limit = opts?.chapterLimit;
  const r = resolveVolumeResolver(chapters);
  const content = contentChapters(r, chapters);
  const volOrder: string[] = [];
  for (const c of content) {
    const v = volumeNameOf(r, c) || '未分卷';
    if (!volOrder.includes(v)) volOrder.push(v);
  }
  const byVol = new Map<string, WritingChapter[]>();
  for (const c of content) {
    const v = volumeNameOf(r, c) || '未分卷';
    if (!byVol.has(v)) byVol.set(v, []);
    byVol.get(v)!.push(c);
  }
  let used = 0;
  let omitted = 0;
  const volLines = volOrder
    .map((v) => {
      const cs = (byVol.get(v) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      let visible = cs;
      if (limit != null) {
        const remain = limit - used;
        if (remain <= 0) {
          omitted += cs.length;
          return null;
        }
        if (cs.length > remain) {
          visible = cs.slice(0, remain);
          omitted += cs.length - remain;
        }
        used += visible.length;
      }
      const chsZh = visible.map((c) => `${c.title}（${c.wordCount}字·${c.status || '草稿'}）`).join('、');
      const chsEn = visible.map((c) => `${c.title} (${c.wordCount}w·${c.status || 'draft'})`).join(', ');
      return { zh: `- ${v}：${chsZh}`, en: `- ${v}: ${chsEn}` };
    })
    .filter((x): x is { zh: string; en: string } => x !== null);
  const omittedZh = omitted > 0 ? `\n… 其余 ${omitted} 章省略` : '';
  const omittedEn = omitted > 0 ? `\n… remaining ${omitted} chapters omitted` : '';
  const volZh = volLines.length ? volLines.map((l) => l.zh).join('\n') + omittedZh : '（暂无章节）';
  const volEn = volLines.length ? volLines.map((l) => l.en).join('\n') + omittedEn : '(no chapters)';

  const loose = looseBeats(outlines);
  const looseLines = loose.slice(0, MAX_LOOSE_BEATS).map((b) => {
    const head = b.title || '（无题）';
    const body = b.summary ? `：${b.summary}` : '';
    return `- ${head}${body}`;
  });
  const looseZh = looseLines.length ? looseLines.join('\n') : '（念头池为空）';
  const looseEn = looseLines.length ? looseLines.join('\n') : '(idea pool empty)';

  return {
    zh: `【大纲骨架】\n${volZh}\n\n【未落章节拍（念头池）】\n${looseZh}`,
    en: `[Outline skeleton]\n${volEn}\n\n[Unanchored beats (idea pool)]\n${looseEn}`,
  };
}

/**
 * 聚焦设定语料（双语）：用户右栏选中某个具体人物/世界观设定（钻入详情）时，
 * 把该设定的完整档案（描述 + 结构化字段 + 关系）灌进上下文，让 AI 围绕这一个设定作答，
 * 而非只拿到名字。与 buildWorldBibleCorpus 同一解析口径（parseSettingExtra）。
 * opts.refIndex（可选）：传入时对关系位展开的 #id 引用做关系化解析（resolveRefs）。
 */
export function buildSettingCorpus(
  setting: WritingSetting,
  opts: { refIndex?: RefIndex } = {},
): { zh: string; en: string } {
  const { refIndex } = opts;
  const resolve = (t: string, lang: 'zh' | 'en') => (refIndex ? resolveRefs(t, refIndex, lang) : t);
  const e = parseSettingExtra(setting.extra);
  const headZh = `【聚焦设定：${setting.name}${setting.subtitle ? `（${setting.subtitle}）` : ''}】`;
  const headEn = `[Focused setting: ${setting.name}${setting.subtitle ? ` (${setting.subtitle})` : ''}]`;
  const descZh = setting.description ? `\n描述：${setting.description}` : '';
  const descEn = setting.description ? `\nDesc: ${setting.description}` : '';

  let bodyZh: string;
  let bodyEn: string;
  if (setting.kind === 'character') {
    const p = e.profile ?? {};
    bodyZh = `类型=人物；外貌=${p.appearance || '—'}；性格=${p.personality || '—'}；动机=${p.motivation || '—'}；口头禅=${p.catchphrase || '—'}；备注=${p.notes || '—'}`;
    bodyEn = `type=character; appearance=${p.appearance || '—'}; personality=${p.personality || '—'}; motivation=${p.motivation || '—'}; catchphrase=${p.catchphrase || '—'}; notes=${p.notes || '—'}`;
  } else {
    const w = e.worldbuildingProfile ?? {};
    bodyZh = `类型=世界观（${w.type || '未分类'}）；规则=${w.rules || '—'}；例外=${w.exceptions || '—'}；关联=${w.linkedTo || '—'}；备注=${w.notes || '—'}`;
    bodyEn = `type=worldbuilding (${w.type || 'uncategorized'}); rules=${w.rules || '—'}; exceptions=${w.exceptions || '—'}; linked=${w.linkedTo || '—'}; notes=${w.notes || '—'}`;
  }
  const rels = (e.relations ?? [])
    .map((r) => (r.targetId ? `#${r.targetId}·${r.type}` : `${r.target}·${r.type}`))
    .filter(Boolean);
  const relZh = rels.length ? `\n关系：${rels.join('、')}` : '';
  const relEn = rels.length ? `\nRelations: ${rels.join(', ')}` : '';

  return {
    zh: resolve(`${headZh}${descZh}\n${bodyZh}${relZh}`, 'zh'),
    en: resolve(`${headEn}${descEn}\n${bodyEn}${relEn}`, 'en'),
  };
}
