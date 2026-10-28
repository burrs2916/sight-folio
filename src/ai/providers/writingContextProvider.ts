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
        '章文本/章账/伏笔/时间线/剧情线/念头池/一致性 七组维度体检',
        'Seven-dimension derived report: text, ledger, foreshadowing, timeline, storylines, ideas, consistency',
      ),
      corpusLines(
        buildProofreadCorpus(book.id, chapters, outlines, s.timelineEvents, s.foreshadowings, s.storylines, s.settings),
      ),
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
    // ── P1·A1 审校预设扩展：情感浓度 / AI 味 / 节奏张力 / 逻辑连续性（写作方案 A1）──
    // 四个预设共用同一产出协议：给 1-5 分档、引原文证据句、给可执行的提升方向，
    // 结论经 launchModuleAnalysis 流入既有「历史审阅结论」闭环（WritingInsightsDialog）。
    {
      key: 'emotional-intensity',
      title: { 'zh-CN': '情感浓度审校', 'en-US': 'Emotional Intensity Review' },
      description: {
        'zh-CN': '对当前章节逐段评估情感强度（1-5 分），给出证据句与提升方向，标出情绪直述或情感空转。',
        'en-US':
          'Score emotional intensity per passage (1-5), with quoted evidence and ways to deepen it; flag told emotions and emotionally empty stretches.',
      },
      prompt: {
        'zh-CN':
          '请对当前章节正文做情感浓度审校：1）按情节段落给出情感强度 1-5 分与主导情绪（如恐惧/依恋/愤怒/释然）；2）每段引用原文最短 1 句做证据，不得脱离原文空谈；3）给出该段提升情感浓度的 1-2 条具体方向（选词、动作细节、感官意象、独白或留白）；4）标出「情绪直述」（直接写情绪名词而缺少可感的描写）与「情感空转」（段落较长但情绪没有推进）的句子，并按出现位置列出。评分标准：5 分=情绪有层次且能被读者感知，3 分=情绪明确但表现单一，1 分=情绪缺失或与情节不匹配。',
        'en-US':
          'Review the emotional intensity of the current chapter: 1) score each story beat 1-5 for emotional intensity and name its dominant emotion (fear, attachment, anger, relief, etc.); 2) quote at least one sentence per beat as evidence — never opine without the text; 3) give 1-2 concrete ways to deepen each beat (word choice, action detail, sensory imagery, internal monologue, or restraint); 4) flag "told emotions" (naming an emotion instead of making it felt) and "emotionally empty stretches" (long passages without emotional movement), listed by location. Scoring: 5 = layered and perceptible emotion, 3 = clear but one-note emotion, 1 = missing or mismatched emotion.',
      },
      sectionKeys: [ACTIVE_CHAPTER_KEY],
      group: 'writing',
    },
    {
      key: 'ai-flavor',
      title: { 'zh-CN': 'AI 味审校', 'en-US': 'AI-Flavor Review' },
      description: {
        'zh-CN': '识别模板套话、节奏单调、长句堆叠与情绪直述等 AI 腔，逐句定位并给去 AI 味改写方向。',
        'en-US':
          'Detect template phrases, flat rhythm, run-on sentences and told emotions; locate each and suggest how to de-AI the prose.',
      },
      prompt: {
        'zh-CN':
          '请对当前章节正文做「去 AI 味」审校，重点检查四类问题：1）模板套话——「仿佛/宛如/犹如/不禁/仿佛整个世界」「这不仅仅…更是…」「在我们内心深处」等万能连词与陈词；2）节奏单调——句子长度几乎一致、缺少长短句交替；3）长句堆叠——连续多句用「，」串接的排比式长句；4）情绪直述——直接写「悲伤/愤怒/感动」而缺少可感的行为与意象。对每处问题：引用原文句子、说明问题类型、给出 1 句去 AI 味改写示例（用具体细节和感官描写替代抽象概括，让情节推进而非停留在氛围铺陈）。句式要有变化的整体建议放在末尾。',
        'en-US':
          'Audit the current chapter for AI-flavored prose. Check four problem classes: 1) template fillers — stock connectives and clichés like "as if", "not merely... but also", "deep down"; 2) flat rhythm — sentence lengths barely vary, no alternation of long and short; 3) run-on stacking — several consecutive long sentences chained by commas; 4) told emotions — naming "sadness/anger/touch" instead of making it felt through behavior and imagery. For each find: quote the sentence, name the problem class, and give one de-AI rewrite example that replaces abstraction with concrete detail and sensory imagery and moves the plot forward rather than lingering on atmosphere. End with overall advice on varying sentence rhythm.',
      },
      sectionKeys: [ACTIVE_CHAPTER_KEY],
      group: 'writing',
    },
    {
      key: 'pacing-tension',
      title: { 'zh-CN': '节奏与张力审校', 'en-US': 'Pacing & Tension Review' },
      description: {
        'zh-CN': '分析章节内的叙事节奏峰谷与张力曲线：铺垫是否过长、高潮是否到位、紧张段落密度是否失衡。',
        'en-US':
          'Analyze the pacing curve and tension build inside the chapter: overlong setup, under-powered climax, or uneven density in tense scenes.',
      },
      prompt: {
        'zh-CN':
          '请对当前章节做节奏与张力审校：1）按情节推进划分场景，标注每个场景的张力值（1-5 分）与类型（铺垫/冲突/反转/收束）；2）绘制章节张力走势：连续多个低张力场景是否构成拖沓、多个高张力场景是否缺少喘息；3）检查高潮段落是否「到不到位」——冲突解决的篇幅与铺垫是否匹配、是否用行动而非解释收束；4）对照作品概览中的全书章节字数分布，指出本章相对前后的节奏位置（升/降/平台期）与失衡点；5）对失衡处给出具体收缩或扩充方向（砍掉哪类过渡、在何处提前埋冲突、高潮处增加什么细节）。',
        'en-US':
          "Review the pacing and tension of the current chapter: 1) divide it into scenes by plot movement, rating each scene's tension (1-5) and type (setup / conflict / reversal / resolution); 2) sketch the tension curve — do several low-tension scenes in a row drag? do high-tension scenes lack breathing room?; 3) check whether the climax lands — is its length proportional to the setup, and is it resolved through action rather than explanation?; 4) compare against the per-chapter word distribution in the book overview and state this chapter's position on the arc (rise / plateau / fall) and why it works or not; 5) suggest concrete cuts or expansions per weak spot (which transitions to trim, where to plant conflict earlier, which details the climax lacks).",
      },
      sectionKeys: [ACTIVE_CHAPTER_KEY, OVERVIEW_KEY],
      group: 'writing',
    },
    {
      key: 'logical-continuity',
      title: { 'zh-CN': '逻辑连续性审校', 'en-US': 'Logical Continuity Review' },
      description: {
        'zh-CN': '检查场景衔接、时间线、角色动机与设定一致性：前一秒还在某处的角色为何下一秒出现在别处。',
        'en-US':
          'Check scene transitions, timeline consistency, character motivation and setting adherence: how did the character get from there to here?',
      },
      prompt: {
        'zh-CN':
          '请对当前章节做逻辑连续性审校：1）场景衔接——相邻场景之间时间/地点/视角是否交代清楚，是否存在「瞬移」或读者无法推导的跳变；2）时间线——章节内部时间流逝是否自洽，与材料中的时间线事件是否冲突（人物年龄、季节、事件先后）；3）角色动机——言行是否与人设卡一致、动机是否可被前文情节支撑，临时让角色「为情节服务」的违和处；4）设定遵守——正文是否违背世界观规则或例外条款；5）伏笔衔接——本章新增伏笔是否入账、本章对旧伏笔的暗示是否与埋设一致（材料含伏笔清单）。每项给出原文证据与修正建议；材料无法覆盖的判断明确声明盲区，不要编造。',
        'en-US':
          'Audit the current chapter for logical continuity: 1) scene transitions — are time, place, and point of view between adjacent scenes clear, with no unexplained teleportation or un-derivable jumps?; 2) timeline — is the elapsed time internally consistent and consistent with the timeline events (ages, seasons, event order)?; 3) character motivation — do words and actions match the character cards, and is motivation supported by earlier plot, flagging moments where a character is bent to serve the plot?; 4) setting adherence — does the text violate established worldbuilding rules or exceptions?; 5) foreshadowing handoff — are new plants properly noted and do hints to old plants stay consistent with the planted records (a foreshadowing list is provided). Give quoted evidence and fixes per item; declare a blind spot for anything the materials cannot cover instead of inventing it.',
      },
      sectionKeys: [ACTIVE_CHAPTER_KEY, CHARACTERS_KEY, TIMELINE_KEY, FORESHADOWING_KEY],
      group: 'writing',
    },
  ] as AiAnalysisPreset[],
};

aiContextRegistry.register(writingContextProvider);

export { writingContextProvider };
export default writingContextProvider;
