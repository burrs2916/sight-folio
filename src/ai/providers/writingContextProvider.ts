import { aiContextRegistry } from '../contextRegistry';
import {
  AI_CONTEXT_SCHEMA_VERSION,
  type AiAnalysisPreset,
  type AiContextPack,
  type AiContextProvider,
  type AiContextSection,
} from '../contextTypes';
import { makeSection } from './scanSections';
import { packWithinBudget } from '../tokenBudget';
import { packDigestFromSections, stampSections } from '../sectionDiff';
import { useWritingStore } from '../../store/writingStore';
import { parseSettingExtra } from '../../services/tauri';
import { L } from '../aiLang';
import { getLang } from '../../i18n';
import { looseBeats } from '../../utils/writingOutline';
import {
  buildTimelineCorpus,
  buildForeshadowingCorpus,
  buildInspirationCorpus,
  buildProofreadCorpus,
  buildRefIndex,
  buildChapterIndexCorpus,
  CHARACTER_PROFILE_FIELDS,
  WORLDBUILDING_PROFILE_FIELDS,
  WORLDBUILDING_TYPE_FIELD,
  corpusBits,
  expandRelations,
} from '../../utils/writingCorpus';

/**
 * 写作域 → AI 上下文供给者（Sight Folio）。
 *
 * 这是「通用 AI 上下文协议」的第三个实现方（project-scan / requirements-spec 之后）。
 * 与前两者同构：模块侧实现 AiContextProvider 并注册，AI 层只按协议消费。
 *
 * 作用域 = bookId（一本书一个作用域）。数据只在「当前激活书」时从 store 同步可取
 * （与 scanContextProvider.snapshotFromStore 同一口径）；未激活时 buildPack 返回 null。
 *
 * 关键约束（沿用项目铁律）：不写死任何 Agent / 模型；预设只描述任务，
 * agentId 由用户在发起时选择（analysisRunner 的必填参数，本模块绝不推断）。
 */
export const WRITING_MODULE_ID = 'writing-book';

const OVERVIEW_KEY = 'book-overview';
const ACTIVE_CHAPTER_KEY = 'active-chapter';
const CHARACTERS_KEY = 'characters';
const WORLDBUILDING_KEY = 'worldbuilding';
// P0-2：写作域五组语料（时间线·剧情线 / 伏笔 / 灵感 / 校对）——复用画布侧右栏
// AI 助手同一批 builder（utils/writingCorpus），口径零第二份；统计不单列（概览已含核心数字）。
const TIMELINE_KEY = 'timeline-storylines';
const FORESHADOWING_KEY = 'foreshadowing';
const INSPIRATION_KEY = 'inspirations';
const PROOFREAD_KEY = 'proofread';

/** 语料 builder 输出（zh/en 双份多行文本）→ 按 UI 语言拆行（makeSection 消费 lines） */
function corpusLines(corpus: { zh: string; en: string }): string[] {
  return (getLang() === 'en-US' ? corpus.en : corpus.zh).split('\n');
}

/** TipTap HTML → 纯文本（Agent 读正文用；富文本标签对 LLM 是噪声） */
function htmlToPlainText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, ' ');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').trim();
}

function sectionQuality(status: 'ok' | 'empty', reason?: string) {
  return { status, reason };
}

const writingContextProvider: AiContextProvider = {
  moduleId: WRITING_MODULE_ID,
  label: L('写作台', 'Writing'),
  description:
    '当前激活书籍的创作上下文：作品概览（卷章结构与字数）、当前选中章节正文、人设卡与世界观设定，以及时间线与剧情线、伏笔、灵感念头池、校对体检五组写作语料。供 Agent 做「像审代码一样审故事」的分析——人设一致性、情节连贯、伏笔回收、节奏审视。',
  isAvailable: (scopeId) => {
    const s = useWritingStore.getState();
    return s.activeBookId === scopeId && s.books.some((b) => b.id === scopeId);
  },

  buildPack: (scopeId, options) => {
    const s = useWritingStore.getState();
    if (s.activeBookId !== scopeId) return null;
    const book = s.books.find((b) => b.id === scopeId);
    if (!book) return null;

    const chapters = s.chapters;
    // bookId 守卫：与 WorkbenchChat 侧过滤口径一致（studio 与 writing 双屏都按当前书取数），
    // 避免 store 残留其他书的 settings 串入 AI 上下文（口径零第二份）。
    const bookSettings = s.settings.filter((x) => x.bookId === scopeId);
    const characters = bookSettings.filter((x) => x.kind === 'character');
    const worldbuilding = bookSettings.filter((x) => x.kind === 'worldbuilding');
    const outlines = s.outlines;
    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const activeChapter = chapters.find((c) => c.id === s.activeChapterId) ?? null;

    // ── 1. 作品概览（含大纲：AI 的情节/节奏审视需要结构规划材料）──
    const chapterTitleById = new Map(chapters.map((c) => [c.id, c.title]));
    const overviewLines: string[] = [`- ${L('书名', 'Title')}：${book.title}`];
    if (book.description) {
      overviewLines.push(`- ${L('简介', 'Description')}：${book.description}`);
    }
    const chapterIndex = buildChapterIndexCorpus(chapters);
    overviewLines.push(
      `- ${L('状态', 'Status')}：${book.status}`,
      `- ${L('章节数', 'Chapters')}：${chapters.length}`,
      `- ${L('总字数', 'Total words')}：${totalWords}`,
      '',
      L('## 章节列表', '## Chapter List'),
      ...(getLang() === 'en-US' ? chapterIndex.en : chapterIndex.zh),
    );
    if (outlines.length > 0) {
      overviewLines.push(
        '',
        L('## 大纲', '## Outline'),
        ...outlines.map((o) => {
          const bound = o.chapterId ? ` → ${chapterTitleById.get(o.chapterId) ?? '?'}` : '';
          const summary = o.summary ? `：${o.summary}` : '';
          return `- ${o.title}${bound}${summary}`;
        }),
      );
    }
    const overview = makeSection(
      OVERVIEW_KEY,
      L('作品概览', 'Book Overview'),
      0,
      L(
        `${book.title}：${chapters.length} 章，共 ${totalWords} 字`,
        `${book.title}: ${chapters.length} chapters, ${totalWords} words`,
      ),
      overviewLines,
      {
        bookId: book.id,
        title: book.title,
        chapterCount: chapters.length,
        totalWords,
        charactersCount: characters.length,
        worldbuildingCount: worldbuilding.length,
        outlineCount: outlines.length,
      },
    );

    // ── 2. 当前章节正文 ──
    let activeChapterSection: AiContextSection;
    if (activeChapter) {
      const text = htmlToPlainText(activeChapter.content || '');
      activeChapterSection = makeSection(
        ACTIVE_CHAPTER_KEY,
        L('当前章节正文', 'Current Chapter Text'),
        1,
        L(`《${activeChapter.title}》（${text.length} 字）`, `"${activeChapter.title}" (${text.length} chars)`),
        [text],
        { chapterId: activeChapter.id, title: activeChapter.title, length: text.length },
      );
    } else {
      activeChapterSection = {
        ...makeSection(
          ACTIVE_CHAPTER_KEY,
          L('当前章节正文', 'Current Chapter Text'),
          1,
          L('当前未选中章节', 'No chapter selected'),
          ['', `_${L('未选中任何章节。', 'No chapter is selected.')}_`],
          { chapterId: null },
        ),
        dataQuality: sectionQuality(
          'empty',
          L('未选中章节，无法对正文下任何结论', 'No chapter selected; no conclusions can be drawn about chapter text'),
        ),
      };
    }

    // ── 3. 人设卡 ──
    let charactersSection: AiContextSection;
    if (characters.length > 0) {
      const charLines: string[] = [];
      let relationsTotal = 0;
      let timelineTotal = 0;
      for (const x of characters) {
        charLines.push(`- **${x.name}**${x.subtitle ? `（${x.subtitle}）` : ''}`);
        if (x.description) charLines.push(`  ${x.description}`);
        const extra = parseSettingExtra(x.extra);
        // 结构化档案字段（与 buildCharactersCorpus 同源同口径：复用共享字段位模板，
        // 防双维护；此处只输出有值字段，description/relations/timeline 明细保留给本分节）
        const p = extra.profile ?? {};
        const profileBits = corpusBits(CHARACTER_PROFILE_FIELDS, (k) => (p as Record<string, string | undefined>)[k]);
        const pickedProfile = getLang() === 'en-US' ? profileBits.en : profileBits.zh;
        if (pickedProfile.length) charLines.push(`  ${pickedProfile.join('；')}`);
        if (extra.relations?.length) {
          relationsTotal += extra.relations.length;
          charLines.push(
            `  ${L('关系', 'Relations')}：${extra.relations.map((r) => `${r.target}(${r.type})`).join('、')}`,
          );
        }
        const settingTimeline = s.timelineEvents.filter((e) => e.settingId === x.id);
        if (settingTimeline.length) {
          timelineTotal += settingTimeline.length;
          for (const ev of settingTimeline) {
            charLines.push(`  - ${ev.at}：${ev.event}`);
          }
        }
      }
      charactersSection = makeSection(
        CHARACTERS_KEY,
        L('人设卡', 'Character Cards'),
        2,
        L(
          `共 ${characters.length} 张人设卡，${relationsTotal} 条关系，${timelineTotal} 条时间线事件`,
          `${characters.length} character cards, ${relationsTotal} relations, ${timelineTotal} timeline events`,
        ),
        charLines,
        {
          count: characters.length,
          names: characters.map((x) => x.name),
          relationsTotal,
          timelineTotal,
        },
      );
    } else {
      charactersSection = {
        ...makeSection(
          CHARACTERS_KEY,
          L('人设卡', 'Character Cards'),
          2,
          L('没有人设卡', 'No character cards'),
          ['', `_${L('本书还没有人设卡。', 'This book has no character cards yet.')}_`],
          { count: 0 },
        ),
        dataQuality: sectionQuality(
          'empty',
          L(
            '没有人设卡，人设一致性检查无从执行——只能审情节与文字，不能审角色',
            'No character cards; consistency checks are impossible — only plot and prose can be reviewed, not characters',
          ),
        ),
      };
    }

    // ── 4. 世界观 ──
    let worldbuildingSection: AiContextSection;
    if (worldbuilding.length > 0) {
      worldbuildingSection = makeSection(
        WORLDBUILDING_KEY,
        L('世界观设定', 'Worldbuilding'),
        3,
        L(`共 ${worldbuilding.length} 条设定`, `${worldbuilding.length} entries`),
        [
          ...worldbuilding.map((x) => {
            const e = parseSettingExtra(x.extra);
            // 结构化世界观字段（与 buildWorldBibleCorpus 同源同口径：
            // 复用共享字段位模板 + 同一份 relations 展开，防双维护）
            const wb = e.worldbuildingProfile ?? {};
            const rels = expandRelations(e.relations);
            const wbBits = corpusBits(WORLDBUILDING_PROFILE_FIELDS, (k) =>
              k === 'relations' ? rels || undefined : (wb as Record<string, string | undefined>)[k],
            );
            const pickedWorld = getLang() === 'en-US' ? wbBits.en : wbBits.zh;
            const typeBit = wb.type
              ? getLang() === 'en-US'
                ? [`${WORLDBUILDING_TYPE_FIELD.en}=${wb.type}`]
                : [`${WORLDBUILDING_TYPE_FIELD.zh}=${wb.type}`]
              : [];
            const bits = [...typeBit, ...pickedWorld];
            const detail = bits.length ? `\n  ${bits.join('；')}` : '';
            return `- **${x.name}**${x.subtitle ? `（${x.subtitle}）` : ''}\n  ${x.description || L('（无描述）', '(no description)')}${detail}`;
          }),
        ],
        { count: worldbuilding.length, names: worldbuilding.map((x) => x.name) },
      );
    } else {
      worldbuildingSection = {
        ...makeSection(
          WORLDBUILDING_KEY,
          L('世界观设定', 'Worldbuilding'),
          3,
          L('没有世界观条目', 'No worldbuilding entries'),
          ['', `_${L('本书还没有世界观设定。', 'This book has no worldbuilding entries yet.')}_`],
          { count: 0 },
        ),
        dataQuality: sectionQuality(
          'empty',
          L(
            '没有世界观设定，设定相关结论请声明盲区',
            'No worldbuilding; declare a blind spot for setting-related conclusions',
          ),
        ),
      };
    }

    // ── 5. 时间线与剧情线（builder 输出自带「暂无」兜底，无需手工空态）──
    // refIndex：把语料中的 #id 关系化引用解析为实体名称（缺失显式标注），
    // 避免模型把悬空引用当有效实体；口径与工作台面板侧一致（buildRefIndex）。
    const refIndex = buildRefIndex(bookSettings, chapters, s.storylines);
    const timelineSection = makeSection(
      TIMELINE_KEY,
      L('时间线与剧情线', 'Timeline & Storylines'),
      4,
      L(
        `${s.timelineEvents.length} 条事件 · ${s.storylines.length} 条剧情线`,
        `${s.timelineEvents.length} events · ${s.storylines.length} storylines`,
      ),
      corpusLines(buildTimelineCorpus(book.id, s.timelineEvents, chapters, s.settings, s.storylines, { refIndex })),
      { eventCount: s.timelineEvents.length, storylineCount: s.storylines.length },
    );

    // ── 6. 伏笔（埋设/回收状态全表）──
    const foreshadowingSection = makeSection(
      FORESHADOWING_KEY,
      L('伏笔', 'Foreshadowing'),
      5,
      L(`${s.foreshadowings.length} 条伏笔`, `${s.foreshadowings.length} items`),
      corpusLines(buildForeshadowingCorpus(book.id, s.foreshadowings, chapters, s.storylines, { refIndex })),
      { count: s.foreshadowings.length },
    );

    // ── 7. 灵感念头池（未落章 loose beats；与编辑面同口径）──
    const looseCount = looseBeats(outlines).length;
    const inspirationSection = makeSection(
      INSPIRATION_KEY,
      L('灵感念头池', 'Inspiration Pool'),
      6,
      L(`${looseCount} 条未落章念头`, `${looseCount} unmounted ideas`),
      corpusLines(buildInspirationCorpus(book.id, outlines, s.timelineEvents, s.foreshadowings)),
      { looseCount },
    );

    // ── 8. 校对体检（六组维度派生报告，与校对面同口径）──
    const proofreadSection = makeSection(
      PROOFREAD_KEY,
      L('校对体检', 'Proofread Report'),
      7,
      L(
        '章文本/章账/伏笔/时间线/剧情线/念头池 六组维度体检',
        'Six-dimension derived report: text, ledger, foreshadowing, timeline, storylines, ideas',
      ),
      corpusLines(buildProofreadCorpus(book.id, chapters, outlines, s.timelineEvents, s.foreshadowings, s.storylines)),
      {},
    );

    const {
      sections: packed,
      truncatedSections,
      tokenEstimate,
    } = packWithinBudget([
      overview,
      activeChapterSection,
      charactersSection,
      worldbuildingSection,
      timelineSection,
      foreshadowingSection,
      inspirationSection,
      proofreadSection,
    ]);
    const now = options?.now ?? Date.now();
    const { sections: stamped, changed, unchanged } = stampSections(packed, options?.previousSections, now);
    const digest = packDigestFromSections(scopeId, AI_CONTEXT_SCHEMA_VERSION, stamped);

    const pack: AiContextPack = {
      moduleId: WRITING_MODULE_ID,
      scopeId,
      scopeLabel: book.title,
      schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
      generatedAt: now,
      sections: stamped,
      tokenEstimate,
      digest,
      truncatedSections,
      changedSections: changed,
      unchangedSections: unchanged,
    };
    return pack;
  },

  presets: [
    {
      key: 'character-consistency',
      title: { 'zh-CN': '人设一致性检查', 'en-US': 'Character Consistency Check' },
      description: {
        'zh-CN': '对照人设卡审查当前章节：角色的言行是否与设定矛盾（性格/口癖/关系/能力）。',
        'en-US':
          'Review the current chapter against character cards: contradictions in personality, speech, relationships, or abilities.',
      },
      prompt: {
        'zh-CN':
          '请对照人设卡逐条检查当前章节正文：哪些角色的言行与设定存在矛盾？按严重程度列出，并给出修改建议。没有人设卡覆盖到的角色请明确指出「设定缺失」，不要凭空推断设定。',
        'en-US':
          "Check the current chapter against the character cards line by line. List contradictions between each character's words/actions and their card, ordered by severity, with concrete revision suggestions. For characters without a card, explicitly say the setting is missing instead of inventing one.",
      },
      sectionKeys: [ACTIVE_CHAPTER_KEY, CHARACTERS_KEY],
      group: 'writing',
    },
    {
      key: 'plot-review',
      title: { 'zh-CN': '情节与节奏审视', 'en-US': 'Plot & Pacing Review' },
      description: {
        'zh-CN': '基于全书结构、当前章节与世界观设定，审视情节连贯性、伏笔回收与叙事节奏。',
        'en-US':
          'Review plot coherence, foreshadowing payoff, and pacing based on the book structure, current chapter, and worldbuilding.',
      },
      prompt: {
        'zh-CN':
          '请基于作品概览（全书章节结构与字数分布）、当前章节正文与世界观设定，审视：1）情节是否连贯、有无断裂或矛盾；2）节奏是否失衡（过长/过短的章节、拖沓或跳跃）；3）世界观设定是否被正文遵守。材料中另附时间线与剧情线、伏笔清单、灵感念头池与校对体检报告——请结合时间线冲突、待补全草稿与伏笔的埋设/回收状态一并审视，指出悬而未收的伏笔。给出具体到章节的修改建议。',
        'en-US':
          'Based on the book overview (chapter structure and word distribution), the current chapter text, and the worldbuilding entries, review: 1) plot coherence and contradictions; 2) pacing problems (chapters too long/short, drag or jump); 3) whether the text respects the established worldbuilding. The materials also include the timeline & storylines, the foreshadowing list, the inspiration pool, and the proofread report — factor in timeline conflicts, incomplete drafts, and planted/unpaid-off foreshadowing, and call out any foreshadowing that was planted but never paid off. Give chapter-specific revision suggestions.',
      },
      group: 'writing',
    },
  ] as AiAnalysisPreset[],
};

aiContextRegistry.register(writingContextProvider);

export { writingContextProvider };
export default writingContextProvider;
