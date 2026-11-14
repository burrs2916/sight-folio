// ㉟（AI-4a，2026-11-10 轮 12）
//
// 右栏 AI 面板「起步示例」快捷问句按体裁取。
//
// 病灶（状态文件 §队列 AI-4 + v3 §3）：`WorkbenchAiPanel` 书场景默认四枚快捷问句
// 写死小说口径 —— 诗集作者一开右栏，芯片上写着「读懂本章」「审情节节奏」，点下去
// 发出去的是「伏笔回收」；可诗集在 `hiddenViewKindsForGenre` ⑮-2 就把 foreshadowing
// 裁掉了（页签长不出来），这与 ㉜ 判过的「一边锁门一边发钥匙」同罪。
//
// 判据走 `workbenchCommandSet`（与 ㉝/㉞ 同一把尺）；`GenrePromptVariant` 键集 =
// 该函数值集，编译期穷尽。**prompt 存语言对、取用时才过 `L()`** —— aiLang 头注释
// 的成规：模块级常量里嵌 `L()` 切语言不刷新（历史教训 ×3）。旧表嵌死在模块常量里
// 属存量，随 AI-4b 一起收，本刀不扩面。
//
// **零回归线**：novel 一格 = 改造前 `WorkbenchAiPanel.STARTER_PROMPTS_BOOK` 的
// 逐字复制（labelKey 也原样），未设 / 脏体裁值经 `workbenchCommandSet` 落 novel 格。
//
// 非小说三支的措辞只用本体裁现成名词与 ㉞ DIAGNOSE/COPY 已确立的不可动项
// （诗：分行与节次是本体；剧本：谁要什么、谁挡着、可演性；日记：不替作者编记忆）——
// 测试把「诗的芯片上不许出现 章/情节/伏笔/人设」这类蹭词判据钉死。

import { workbenchCommandSet } from '../utils/writingSchema';
import { L } from './aiLang';
import type { GenrePromptVariant, PromptPair } from './quickActionPrompts';

/** 一枚起步示例（与 `WorkbenchAiPanel` 原数组同形：key / labelKey / prompt） */
export interface BookStarter {
  key: string;
  labelKey: string;
  prompt: string;
}

interface BookStarterSeed {
  key: string;
  labelKey: string;
  prompt: PromptPair;
}

const BOOK_STARTERS: Record<GenrePromptVariant, BookStarterSeed[]> = {
  // novel = 改造前 `STARTER_PROMPTS_BOOK` 逐字（零回归线；测试独立另存原文对锁）
  novel: [
    {
      key: 'explain',
      labelKey: 'workbench.aiStarter.book.explain',
      prompt: {
        zh: '读懂这一章：它在全书里承担什么情节功能、与前后章如何衔接、写得好的地方与可改进点。',
        en: "Help me understand this chapter: what plot function it serves, how it connects to the surrounding chapters, and what works versus what could improve.",
      },
    },
    {
      key: 'improve',
      labelKey: 'workbench.aiStarter.book.improve',
      prompt: {
        zh: '润色当前章节里最薄弱的一段：提升文笔、节奏与可读性，保持人设口吻与全文风格一致。',
        en: "Polish the weakest passage in this chapter: improve prose, pacing and readability while keeping the character's voice and the overall style consistent.",
      },
    },
    {
      key: 'continue',
      labelKey: 'workbench.aiStarter.book.continue',
      prompt: {
        zh: '基于当前章节的结尾与已有设定，续写接下来的情节，保持风格连贯。',
        en: "Continue the story from this chapter's ending and the existing setting, keeping the style coherent.",
      },
    },
    {
      key: 'plot',
      labelKey: 'workbench.aiStarter.book.plot',
      prompt: {
        zh: '审视当前章节的情节连贯性、伏笔回收与叙事节奏，指出断裂或矛盾并给出修改建议。',
        en: "Review this chapter's plot coherence, foreshadowing payoff and pacing; point out breaks or contradictions with revision suggestions.",
      },
    },
  ],
  // 散文：没有情节链与伏笔栏，第四枚换成散文真正会坏的地方（立意贯穿 + 素材真实）。
  essay: [
    {
      key: 'explain',
      labelKey: 'workbench.aiStarter.book.explainPiece',
      prompt: {
        zh: '读懂这一篇：它写了哪些人与事、立意落在哪里、结构与语感如何运作，写得好的地方与可改进点。',
        en: 'Help me understand this piece: what people and events it writes, where its intent lands, how its structure and voice work, and what works versus what could improve.',
      },
    },
    {
      key: 'improve',
      labelKey: 'workbench.aiStarter.book.improve',
      prompt: {
        zh: '润色当前篇目里最薄弱的一段：提升文字表现力与节奏，保持这一篇的立意、语气与全书语感一致。',
        en: 'Polish the weakest passage in this piece: improve expressiveness and rhythm while keeping the piece’s intent, voice and the collection’s diction consistent.',
      },
    },
    {
      key: 'continue',
      labelKey: 'workbench.aiStarter.book.continue',
      prompt: {
        zh: '基于当前篇目的结尾往下写，顺着这一篇的立意与语气走，写到它自然收束为止。',
        en: 'Keep writing from the end of this piece, following its intent and voice until it closes naturally.',
      },
    },
    {
      key: 'plot',
      labelKey: 'workbench.aiStarter.book.plotThesis',
      prompt: {
        zh: '审视这一篇的立意是否从头贯穿到底、所写的人事细节前后是否自洽、有没有为成文而补写出来的经历感，逐条给出修改建议。',
        en: 'Check whether this piece holds its intent from opening to close, whether the people and details it records stay consistent, and whether any passage reads like supplied memory; list findings with fixes.',
      },
    },
  ],
  // 诗歌：第四枚是分行与意象（诗的本体），且自带「凑字数」禁令（㉞ continueTail 同一条）。
  poetry: [
    {
      key: 'explain',
      labelKey: 'workbench.aiStarter.book.explainPoem',
      prompt: {
        zh: '读懂这一首：它写的核心是什么、意象属于哪个感官系统、分行与节奏如何运作，写得好的地方与可改进点。',
        en: 'Help me understand this poem: what its core is, which sensory system its imagery belongs to, how its lineation and rhythm work, and what works versus what could improve.',
      },
    },
    {
      key: 'improve',
      labelKey: 'workbench.aiStarter.book.improve',
      prompt: {
        zh: '润色当前诗作里最弱的一节：只做炼字与节奏微调，不得改动分行、节次与意象系统。',
        en: 'Polish the weakest stanza of this poem with word-level refinement and rhythm tuning only; never change the line breaks, the stanzas or the imagery system.',
      },
    },
    {
      key: 'continue',
      labelKey: 'workbench.aiStarter.book.continue',
      prompt: {
        zh: '接着当前诗作的末尾往下写，保持分行、节奏与意象系统一致；不必凑字数，该收就收。',
        en: 'Continue from the end of this poem, keeping its line breaks, rhythm and imagery consistent; do not pad for length - stop when the poem stops.',
      },
    },
    {
      key: 'plot',
      labelKey: 'workbench.aiStarter.book.plotLineation',
      prompt: {
        zh: '审视这一首的分行与它所标的诗体形式是否自洽、意象是否同属一个系统、有无跨行造成的误读，逐条给出修改建议（自由诗与散文诗不判出格）。',
        en: 'Check whether this poem’s lineation is consistent with the form it claims, whether its imagery belongs to one system, and whether any enjambment misleads; list findings with fixes (free verse and prose poems are not out of form).',
      },
    },
  ],
  // 剧本：第四枚 = 冲突回合 + 可演性（㉞ DIAGNOSE.script 的两维，台词是说出口的话）。
  script: [
    {
      key: 'explain',
      labelKey: 'workbench.aiStarter.book.explainScene',
      prompt: {
        zh: '读懂这一幕场：谁要什么、谁挡着、双方拿什么交换、这场结束时改变了什么，写得好的地方与可改进点。',
        en: 'Help me understand this scene: who wants what, who blocks them, what is traded, what changes by the end of the scene, and what works versus what could improve.',
      },
    },
    {
      key: 'improve',
      labelKey: 'workbench.aiStarter.book.improve',
      prompt: {
        zh: '润色当前场次里最薄弱的一段台词：只打磨说法与对白节奏，不得改变谁在说话、说出的事实与舞台调度。',
        en: 'Polish the weakest dialogue in this scene: refine wording and rhythm only; never change who speaks, what the lines convey, or the staging.',
      },
    },
    {
      key: 'continue',
      labelKey: 'workbench.aiStarter.book.continue',
      prompt: {
        zh: '基于当前场次的结尾续写：保持角色名起行、台词另起一行的排法；本场未结束就续写本场，结束了就另起一场。',
        en: "Continue from the end of this scene in the same format (character name on its own line, dialogue beneath it); stay in the scene until it ends, then open a new one.",
      },
    },
    {
      key: 'plot',
      labelKey: 'workbench.aiStarter.book.plotConflict',
      prompt: {
        zh: '审视这一幕场的冲突回合是否完整、台词是否可演、舞台指示能否执行，指出没有回合的段落与不可演之处并给出修改建议。',
        en: 'Check whether this scene’s conflict turn is complete, whether the lines are playable and the stage directions stageable; flag passages with no turn and anything unperformable, with fixes.',
      },
    },
  ],
  // 日记：第四枚 = 日期自洽 + 事后补记（㉞ DIAGNOSE.diary 的两维；全线禁「替作者编记忆」）。
  diary: [
    {
      key: 'explain',
      labelKey: 'workbench.aiStarter.book.explainDay',
      prompt: {
        zh: '读懂这一天的条目：记了哪些事、涉及哪些人、作者当时的判断是什么，有没有还可以往下写的线索。',
        en: "Help me understand today's entry: what it records, which people it touches, what the author judged at the time, and what threads it could still grow into.",
      },
    },
    {
      key: 'improve',
      labelKey: 'workbench.aiStarter.book.improve',
      prompt: {
        zh: '润色当天条目里表达不顺的地方：只理顺句子、去掉重复说法，不得改变所记事实、时间顺序与当天的语气。',
        en: 'Smooth the awkward wording in today’s entry: fix sentences and remove repetition only; never change the recorded facts, their order, or that day’s voice.',
      },
    },
    {
      key: 'continue',
      labelKey: 'workbench.aiStarter.book.continue',
      prompt: {
        zh: '接着当天条目的末尾往下写，只写当天已知的事与当时的想法，不替作者补记忆、不剧透后来发生的事。',
        en: "Continue from the end of today's entry, writing only what that day knows and thinks - no supplied memory, no hindsight about later events.",
      },
    },
    {
      key: 'plot',
      labelKey: 'workbench.aiStarter.book.plotFacts',
      prompt: {
        zh: '检查这一条日记：日期与内文所述时间是否自洽、所记的人与事同其它条目有无矛盾、有没有像事后补记的句子混在当天原文里；只标出疑问，不替作者断定哪一天是对的。',
        en: "Check this entry: does its date agree with the times named inside it, do its people and events contradict other days, and do any lines read like later addenda mixed into that day's text? Flag questions only - never decide for the author which day was right.",
      },
    },
  ],
};

/** 本支体裁的右栏「起步示例」快捷问句（novel/未设/脏值 = 改造前逐字；取用时才定语种） */
export function bookStartersFor(genre: string | undefined): BookStarter[] {
  return BOOK_STARTERS[workbenchCommandSet(genre)].map((s) => ({
    key: s.key,
    labelKey: s.labelKey,
    prompt: L(s.prompt.zh, s.prompt.en),
  }));
}

/* ── ㉡ AI-4b′（2026-11-10 轮 14）：题材 tab 那张分体裁起步示例表搬进来并按体裁换词 ──────
 *
 * 病灶（状态文件 §队列 AI-4b）：`WorkbenchAiPanel.STARTER_PROMPTS_BOOK_TOPIC` 整表小说口径 ——
 * 五支都可达的八组里，catalog 问「分卷分章」、timeline 问「跨章/某一章」、writing 写「当前章
 * 300-500 字」，对诗集/散文集/日记本全是小说话；**剧本还多一笔**：storylines/foreshadowing 对它
 * 是可见页签（⑮-2 只裁世界观），小说文案却把伏笔回收说成「在后面哪一章」——戏剧里没有章。
 *
 * 同轮收掉两处「模块常量嵌死 `L()`」的存量反例（aiLang 头注释成规的反例，切语言不刷新）：
 * 本模块一律**存语言对、取用时才 `L()`**（㉡ AI-4a 立的规矩，本刀把它推到自己头上：
 * 代码场景表与全书总览问句也一起搬进来换成语言对，面板里不再留嵌死 `L()` 的第二份）。
 *
 * **刀口与记债**：一刀收不完 11 组（轮 12 拆刀时的原话）。轮 14 登记 catalog / timeline / writing
 * 三组，㉢（AI-4b″，轮 15）再登 **stats / overview 两组** × 非小说四支；其余格子暂领 novel 行，
 * **记债清单钉在测试里**（`topicStartersGenre.test.ts` 的 debt 套：可见而未换词的 (体裁, 组)
 * 必须恰好等于登记清单，多一格少一格都红）——剩 AI-4b‴ 一族（characters/proofread/inspiration
 * + 剧本 storylines/foreshadowing）逐轮翻账。worldview 对非小说四支是被裁视图
 * （`hiddenViewKindsForGenre`），落 novel 行也不可见，**不记债**。
 *
 * ㉢ 两组的用词纪律（全部现成口径，零自创）：stats 的分组/单位词 = `bandGroup/bandUnitSize`
 * 槽位那套（分组分布·各篇/各首体量、幕分布·各场体量、年月分布·各天体量，T-F′ 已钉）；
 * 离群那一格按 `outlierMeaninglessForGenre` 分岔——**剧本照判**（场次体量是节奏工具），
 * 散文/诗/日记不判、换成各支判得出的事（同长之下的水与挤 / 标体的句数字数 / 单条密度）；
 * overview 的维度列 = 11 枚页签 − 裁项（与 `bookOverviewPrompt` 那颗按钮**同一张嘴**，测试按
 * 括号里的维度列逐字对锁三张嘴）；book 级词 = `overviewHint` 现成首词（全书/全诗集/全剧/全本）。
 *
 * **零回归线**：novel 十一组 = 改造前 `STARTER_PROMPTS_BOOK_TOPIC` 逐字节搬运（脚本从磁盘程序化
 * 抽取后独立存进测试对锁）；`timeline.fill` 一句五个体裁同文（它不含单位词），共用格由测试锁
 * 「支行 == novel 行逐字」，防将来偷偷漂。
 */

/** 书场景题材 tab 的组名（面板的 `bookTopic` / `localTopic` 与本表共用这一个类型，不留三份联合） */
export type BookTopicKey =
  | 'characters'
  | 'worldview'
  | 'catalog'
  | 'timeline'
  | 'storylines'
  | 'foreshadowing'
  | 'inspiration'
  | 'proofread'
  | 'stats'
  | 'writing'
  | 'overview';

/** novel 行 = 改造前面板 `STARTER_PROMPTS_BOOK_TOPIC` 逐字节搬运（零回归线；标签键一字未动） */
const TOPIC_STARTERS_NOVEL: Record<BookTopicKey, BookStarterSeed[]> = {
  characters: [
    {
      key: 'design',
      labelKey: 'workbench.aiStarter.book.characters.design',
      prompt: {
        zh: '帮我设计一个新人物：给出姓名、外貌、性格、动机、口头禅与一段背景，并说明他在书中承担的角色弧光。',
        en: 'Help me design a new character: name, appearance, personality, motivation, catchphrase and a backstory, plus the character arc they carry in the book.',
      },
    },
    {
      key: 'enrich',
      labelKey: 'workbench.aiStarter.book.characters.enrich',
      prompt: {
        zh: '针对当前人物，补强外貌 / 性格 / 动机 / 口头禅，让人设更立体、前后一致。',
        en: "Enrich the current character's appearance / personality / motivation / catchphrase so the persona is more vivid and consistent.",
      },
    },
    {
      key: 'relations',
      labelKey: 'workbench.aiStarter.book.characters.relations',
      prompt: {
        zh: '梳理当前人物与其它角色的关系网，指出潜在的冲突与羁绊。',
        en: "Map the current character's relationship network with other characters; point out potential conflicts and bonds.",
      },
    },
    {
      key: 'check',
      labelKey: 'workbench.aiStarter.book.characters.check',
      prompt: {
        zh: '对照全书，检查该人物是否出现性格 / 动机矛盾或行为 OOC，逐条列出并给修改建议。',
        en: 'Against the whole book, check the character for personality / motivation contradictions or out-of-character behavior; list them with revision suggestions.',
      },
    },
  ],
  worldview: [
    {
      key: 'build',
      labelKey: 'workbench.aiStarter.book.worldview.build',
      prompt: {
        zh: '帮我设计一个世界观要素（地理 / 历史 / 规则 / 势力），并说明它与情节如何咬合。',
        en: 'Help me design a worldbuilding element (geography / history / rules / faction) and explain how it meshes with the plot.',
      },
    },
    {
      key: 'coherence',
      labelKey: 'workbench.aiStarter.book.worldview.coherence',
      prompt: {
        zh: '检查当前设定的内部逻辑是否自洽，指出漏洞与例外未覆盖处。',
        en: 'Check the current setting for internal logical coherence; point out holes and unhandled exceptions.',
      },
    },
    {
      key: 'factions',
      labelKey: 'workbench.aiStarter.book.worldview.factions',
      prompt: {
        zh: '梳理各势力的权力结构与核心矛盾，说明它们如何推动情节。',
        en: 'Map the power structure and core conflicts of the factions, and how they drive the plot.',
      },
    },
    {
      key: 'archive',
      labelKey: 'workbench.aiStarter.book.worldview.archive',
      prompt: {
        zh: '把下面这段设定整理成结构化档案（类型 / 规则 / 例外 / 关联章节）。',
        en: 'Turn the setting below into a structured profile (type / rules / exceptions / related chapters).',
      },
    },
  ],
  catalog: [
    {
      key: 'structure',
      labelKey: 'workbench.aiStarter.book.catalog.structure',
      prompt: {
        zh: '帮我规划全书的分卷分章结构与时序，给出每卷的叙事目标。',
        en: "Help me plan the book's volume / chapter structure and timeline, with a narrative goal per volume.",
      },
    },
    {
      key: 'check',
      labelKey: 'workbench.aiStarter.book.catalog.check',
      prompt: {
        zh: '审视当前大纲的连贯性、伏笔回收与叙事节奏，指出断裂或拖沓处。',
        en: 'Review the current outline for coherence, foreshadowing payoff and pacing; point out breaks or sagging sections.',
      },
    },
    {
      key: 'hook',
      labelKey: 'workbench.aiStarter.book.catalog.hook',
      prompt: {
        zh: '为章节开头 / 结尾设计钩子，提升留存与翻页欲。',
        en: 'Design hooks for chapter openings / endings to boost retention and page-turn urge.',
      },
    },
  ],
  timeline: [
    {
      key: 'conflict',
      labelKey: 'workbench.aiStarter.book.timeline.conflict',
      prompt: {
        zh: '审查全书时间线：找出同轨时点碰撞与跨章时间倒挂，逐条说明矛盾所在并给修正建议。',
        en: "Review the book's timeline: find same-track when-collisions and cross-chapter inversions, explain each contradiction and suggest fixes.",
      },
    },
    {
      key: 'arrange',
      labelKey: 'workbench.aiStarter.book.timeline.arrange',
      prompt: {
        zh: '为某一章设计时间线事件：此时点该发生什么、由哪些人物/设定参与、与前后章事件如何衔接。',
        en: 'Design timeline events for a chapter: what should happen at this point, which characters/settings take part, and how it links to events in adjacent chapters.',
      },
    },
    {
      key: 'fill',
      labelKey: 'workbench.aiStarter.book.timeline.fill',
      prompt: {
        zh: '针对待补全草稿，逐条给出时点与事件描述的补全建议（尊重我的原文口径，只建议不替我定稿）。',
        en: 'For the drafts to complete, suggest a when and an event description for each (respect my wording; suggest only, never finalise for me).',
      },
    },
    {
      key: 'density',
      labelKey: 'workbench.aiStarter.book.timeline.density',
      prompt: {
        zh: '分析时间线覆盖与节奏：哪些章还没有锚定事件、哪些区段过密或过疏，给出补齐优先级。',
        en: 'Analyse timeline coverage and pacing: which chapters lack anchored events, which stretches are too dense or too sparse, and what to fill first.',
      },
    },
  ],
  storylines: [
    {
      key: 'design',
      labelKey: 'workbench.aiStarter.book.storylines.design',
      prompt: {
        zh: '帮我为这本书设计一条新的剧情线（主线/支线/感情线皆可）：给出线名、一句话定位、起承转合的关键事件与结局走向。',
        en: 'Help me design a new storyline (main / subplot / romance): give it a name, a one-line premise, key events from setup to payoff, and where it ends.',
      },
    },
    {
      key: 'weave',
      labelKey: 'workbench.aiStarter.book.storylines.weave',
      prompt: {
        zh: '对照现有剧情线与时间线事件，检查每条线的推进是否连贯、哪条线太久没有事件、给出穿插节奏建议。',
        en: 'Against the current storylines and timeline events, check whether each line progresses coherently, which line has gone quiet, and suggest interleaving rhythm.',
      },
    },
    {
      key: 'untangle',
      labelKey: 'workbench.aiStarter.book.storylines.untangle',
      prompt: {
        zh: '梳理多条剧情线之间的交叉点与冲突：哪些事件同时推进多条线、哪里会互相抢戏，给出编排建议。',
        en: 'Untangle intersections and conflicts between storylines: which events advance multiple lines at once, where they compete for attention, and how to arrange them.',
      },
    },
    {
      key: 'coverage',
      labelKey: 'workbench.aiStarter.book.storylines.coverage',
      prompt: {
        zh: '分析剧情线挂线情况：未挂线事件应该归入哪条线或需要新线，逐条给建议（只建议不替我定稿）。',
        en: 'Analyse storyline attachment: for unlined events, suggest which line each belongs to or whether a new line is needed (suggest only, never finalise for me).',
      },
    },
  ],
  foreshadowing: [
    {
      key: 'plant',
      labelKey: 'workbench.aiStarter.book.foreshadowing.plant',
      prompt: {
        zh: '为当前章节设计伏笔：给出可埋下的物件/台词/悬念（越轻越好），并说明它适合在后面哪一章、以什么方式回收。',
        en: 'Design foreshadowing for the current chapter: propose a light-weight object / line of dialogue / suspense to plant, and suggest which later chapter should pay it off and how.',
      },
    },
    {
      key: 'check',
      labelKey: 'workbench.aiStarter.book.foreshadowing.check',
      prompt: {
        zh: '审查全书伏笔清单：哪些待回收的伏笔埋得太重或太轻、哪些回收计划跨度太大容易被读者遗忘，逐条给建议。',
        en: "Review the book's foreshadowing list: which pending plants are too heavy or too subtle, which payoff spans are so long readers may forget them; give itemised suggestions.",
      },
    },
    {
      key: 'weave',
      labelKey: 'workbench.aiStarter.book.foreshadowing.weave',
      prompt: {
        zh: '为每条待回收伏笔设计回收场景：在计划回收章如何自然兑现、需要哪些人物在场、与剧情线如何交织（只建议不替我定稿）。',
        en: 'Design payoff scenes for each pending foreshadowing: how to pay it off naturally in the planned chapter, which characters should be present, and how it weaves into the storylines (suggest only, never finalise for me).',
      },
    },
    {
      key: 'abandon',
      labelKey: 'workbench.aiStarter.book.foreshadowing.abandon',
      prompt: {
        zh: '检查已弃置/长期未回收的伏笔：它们是否还值得捡回？给出捡回或正式弃置的建议（弃置不丢人，干净比强行回收更好）。',
        en: 'Review abandoned / long-pending foreshadowing: is each still worth picking up? Recommend picking it back up or abandoning it cleanly (a clean drop beats a forced payoff).',
      },
    },
  ],
  inspiration: [
    {
      key: 'brainstorm',
      labelKey: 'workbench.aiStarter.book.inspiration.brainstorm',
      prompt: {
        zh: '基于全书题材与念头池里已有的念头，脑暴 8-10 个新念头（一句一个），标注每个念头的类型（情节/人物/世界观/桥段），不与已有念头重复。',
        en: "Based on the book's genre and the ideas already in the pool, brainstorm 8-10 new ideas (one line each), tag each with its type (plot / character / worldbuilding / trope), and avoid duplicating existing ones.",
      },
    },
    {
      key: 'triage',
      labelKey: 'workbench.aiStarter.book.inspiration.triage',
      prompt: {
        zh: '审视念头池：哪些念头值得优先发展成时间线事件或伏笔？给出分诊排序（A=马上用 / B=值得养 / C=先放着）与理由。',
        en: 'Review the idea pool: which ideas are worth developing into timeline events or foreshadowing first? Give a triage ranking (A=use now / B=worth nurturing / C=park for later) with reasons.',
      },
    },
    {
      key: 'bridge',
      labelKey: 'workbench.aiStarter.book.inspiration.bridge',
      prompt: {
        zh: '挑一条最有潜力的念头，展开成一组节拍（3-5 拍），并建议它适合挂在哪一章、与现有剧情线如何衔接。',
        en: 'Pick the most promising idea and expand it into a beat sequence (3-5 beats), suggesting which chapter it belongs to and how it ties into the existing storylines.',
      },
    },
    {
      key: 'prune',
      labelKey: 'workbench.aiStarter.book.inspiration.prune',
      prompt: {
        zh: '找出念头池里过期、重复或已被后续设定覆盖的念头，逐条给出删除或合并建议（删除不可怕，池子干净才转得动）。',
        en: 'Find stale, duplicated or superseded ideas in the pool and recommend deleting or merging each (deleting is fine — a clean pool dispatches faster).',
      },
    },
  ],
  proofread: [
    {
      key: 'read',
      labelKey: 'workbench.aiStarter.book.proofread.read',
      prompt: {
        zh: '对照体检报告，按优先级指出最值得先处理的 3 个问题：为什么是它们、处理顺序怎么排、各自一句话修法。',
        en: 'Against the proofread report, name the top 3 issues worth fixing first: why they matter, the order to tackle them, and a one-line fix for each.',
      },
    },
    {
      key: 'punct',
      labelKey: 'workbench.aiStarter.book.proofread.punct',
      prompt: {
        zh: '细读指定章节，找出错别字、标点误用与重复标点，逐条给出原文位置与改法（只指出不直接改稿）。',
        en: 'Read the given chapter closely and list typos, punctuation misuse and repeated punctuation, each with its location and suggested fix (point out only, do not rewrite).',
      },
    },
    {
      key: 'repeat',
      labelKey: 'workbench.aiStarter.book.proofread.repeat',
      prompt: {
        zh: '检查指定章节的重复用词与口头禅式表达：哪些词在短距离内反复出现、哪些描写句式雷同，给出替换建议。',
        en: 'Check the given chapter for repeated wording and catchphrase-style expressions: which words recur within short spans, which descriptive sentences feel duplicated, with replacement suggestions.',
      },
    },
    {
      key: 'flow',
      labelKey: 'workbench.aiStarter.book.proofread.flow',
      prompt: {
        zh: '通读指定章节，检查叙事连贯性：时间跳跃是否交代、人物行为是否合乎动机、前后信息是否矛盾，逐条列出。',
        en: 'Read the given chapter through and check narrative coherence: unexplained time jumps, actions that contradict motivations, internal contradictions — list each one.',
      },
    },
  ],
  stats: [
    {
      key: 'pacing',
      labelKey: 'workbench.aiStarter.book.stats.pacing',
      prompt: {
        zh: '基于写作统计（体量 KPI + 卷分布 + 章节体量），分析全书的叙事节奏：哪些区段偏拖沓或仓促、卷与卷之间的体量配比是否合理，给出调整建议（尊重创作意图，advisory 仅供参考）。',
        en: "Based on the writing stats (KPIs, volume distribution, chapter sizes), analyse the book's pacing: which stretches drag or rush, whether volume proportions are balanced; suggest adjustments (respect my intent, advisory only).",
      },
    },
    {
      key: 'distribution',
      labelKey: 'workbench.aiStarter.book.stats.distribution',
      prompt: {
        zh: '对照卷分布数据，评估各卷的章数/完稿进度/字数是否头重脚轻或失衡，给出后续卷的体量规划建议。',
        en: 'Against the volume distribution, assess whether chapters / finished ratio / word counts per volume are top-heavy or unbalanced; suggest size planning for upcoming volumes.',
      },
    },
    {
      key: 'outliers',
      labelKey: 'workbench.aiStarter.book.stats.outliers',
      prompt: {
        zh: '逐个审视离群章节（超长/偏短）：结合它在全书中的位置判断是刻意的节奏设计还是失控，分别给扩写或拆分/合并或补写的建议。',
        en: 'Review each outlier chapter (long / short) in its book context: is it deliberate pacing or out of control? Suggest expansion / splitting / merging / filling per case.',
      },
    },
    {
      key: 'goal',
      labelKey: 'workbench.aiStarter.book.stats.goal',
      prompt: {
        zh: '基于日更趋势与当前日更目标，评估目标是否现实可持续，给出目标值与写作节奏的调整建议（不催更、不施压）。',
        en: 'Based on the daily trend and current daily goal, assess whether the goal is realistic and sustainable; suggest goal and rhythm adjustments (no nagging, no pressure).',
      },
    },
  ],
  writing: [
    {
      key: 'continue',
      labelKey: 'workbench.aiStarter.book.writing.continue',
      prompt: {
        zh: '续写当前章：从正文结尾自然衔接，保持已有的语气、人称与时态，推进 300-500 字（给出可直接粘贴的正文，不要解释）。',
        en: 'Continue the current chapter from where the prose ends, matching the existing voice, person and tense; advance 300-500 words (give paste-ready prose, no explanations).',
      },
    },
    {
      key: 'polish',
      labelKey: 'workbench.aiStarter.book.writing.polish',
      prompt: {
        zh: '细读当前章正文，按段落指出可打磨处：节奏拖沓、描写空洞、对话生硬、信息重复，每条给出原文与改写示例（只建议不直接改稿）。',
        en: 'Read the current chapter closely and point out per-paragraph improvements: sagging pacing, hollow description, stiff dialogue, repeated information — quote the original and give a rewrite example (suggest only, do not edit directly).',
      },
    },
    {
      key: 'consistency',
      labelKey: 'workbench.aiStarter.book.writing.consistency',
      prompt: {
        zh: '对照前情提要与章节骨架，检查当前章是否与已有情节矛盾（时间线/人物状态/设定），逐条列出矛盾点与修法。',
        en: 'Against the previously-summary and chapter skeleton, check the current chapter for contradictions with existing plot (timeline / character state / settings); list each conflict with a fix.',
      },
    },
    {
      key: 'scene',
      labelKey: 'workbench.aiStarter.book.writing.scene',
      prompt: {
        zh: '为当前章设计下一个场景：给出场景目标、出场人物、开场钩子与结束悬念（贴合已有剧情线与人物动机，只建议不替我定稿）。',
        en: 'Design the next scene for the current chapter: scene goal, cast, opening hook and ending suspense (fit existing storylines and motivations; suggest only, never finalise for me).',
      },
    },
  ],
  overview: [
    {
      key: 'health',
      labelKey: 'workbench.aiStarter.book.overview.health',
      prompt: {
        zh: '给我一份全书健康度体检：① 体量进度与叙事节奏是否健康；② 各维度（人物/世界观/时间线/剧情线/伏笔/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿。',
        en: "Give me a whole-book health check: ① is size/progress/pacing healthy; ② the state of each dimension (characters / worldbuilding / timeline / storylines / foreshadowing / ideas / proofread) and which to prioritise; ③ the 3 most urgent risks, each with a one-line fix. Diagnose only, don't rewrite.",
      },
    },
    {
      key: 'continuity',
      labelKey: 'workbench.aiStarter.book.overview.continuity',
      prompt: {
        zh: '做一份全书叙事连续性审查：① 时间线同轨冲突与跨章时间倒挂；② 伏笔埋设与回收是否对得上、有无长期未回收的悬空伏笔；③ 主要人物是否出现性格/动机矛盾或行为 OOC；④ 各章骨架衔接是否断裂。逐条给出证据（章节/事件）与修法。',
        en: 'Run a whole-book narrative-continuity audit: ① same-track timeline conflicts and cross-chapter inversions; ② foreshadowing plants vs payoffs, any long-unpaid floating plants; ③ main characters with personality/motivation contradictions or OOC behavior; ④ chapter-skeleton hand-offs that break. Cite evidence (chapter/event) and fixes per item.',
      },
    },
    {
      key: 'dimension',
      labelKey: 'workbench.aiStarter.book.overview.dimension',
      prompt: {
        zh: '挑当前最薄弱的一个维度（人物/世界观/时间线/剧情线/伏笔/灵感/校对），结合全书总览数据说明它为什么薄弱、应该先补哪 3 件事、按什么顺序。',
        en: "Pick the weakest dimension right now (characters / worldbuilding / timeline / storylines / foreshadowing / ideas / proofread), explain from the overview data why it's weak, and what 3 things to fix first and in what order.",
      },
    },
    {
      key: 'risk',
      labelKey: 'workbench.aiStarter.book.overview.risk',
      prompt: {
        zh: '把全书总览里的风险预警（时间线冲突 / 跨章伏笔 / 孤立设定 / 未落章节拍 / 校对问题）按「影响 × 紧迫」排个序，给出一张可执行的处置清单（每条：做什么、涉及哪章、预估工作量）。',
        en: "Rank the overview's risk warnings (timeline conflicts / cross-chapter foreshadowing / orphan settings / unanchored beats / proofread issues) by impact × urgency, and give an actionable remediation list (each: what to do, which chapter, rough effort).",
      },
    },
  ],
};

/**
 * 非小说四支的换词条（轮 14 登 ㉡ 点的三组：catalog / timeline / writing；
 * ㉢ AI-4b″ 轮 15 再登 stats / overview 两组）。
 * 槽位 key 与 novel 行**逐位对齐**（同 key 同序）——芯片 key 只做 React key 与槽位身份，
 * 措辞换体不影响槽位；labelKey 只在标签本身带小说词或语义换物时才换新键（测试锁「共用格逐字 ==
 * novel 行」与「换词格 labelKey 必须不同」两侧，防止只换 prompt 不换卡面话）。
 */
const TOPIC_STARTER_OVERRIDES: Partial<Record<GenrePromptVariant, Partial<Record<BookTopicKey, BookStarterSeed[]>>>> = {
  essay: {
    // ㉣ characters（AI-4b‴，2026-11-10 轮 16）：轮 13 `CHARACTER` 五支硬线原样搬进芯片，零自创口径
    // （只依据写过的事迹说话/不得补写记忆、跨篇只摆矛盾不断定、写得准不准像不像本人）。
    // novel 标签「丰满人设/人设体检」带「人设」二字 —— 散文的人物是作者的，不由模型来设，必须换键。
    characters: [
      {
        key: 'design',
        labelKey: 'workbench.aiStarter.book.characters.designPerson',
        prompt: {
          zh: '为一个还没立卡的人物立一张人物卡：汇总各篇与素材里写过他的称谓、关系与事迹；没写过的一律留白，不得替作者补写记忆，素材不足就直说不足。',
          en: "Create a character card for a person who has none yet: gather the names, relations and deeds the pieces and material already record for them; leave what was never written blank - never supply a memory for the author, and say so when the material runs short.",
        },
      },
      {
        key: 'enrich',
        labelKey: 'workbench.aiStarter.book.characters.enrichPortrait',
        prompt: {
          zh: '针对当前人物，看写得准不准、像不像本人、细节站不站得住；补强只依据已写过的素材，不得为增强可读性改动所记的事实，也不得补足作者没写的判断。',
          en: 'For the current person, judge whether the portrait is accurate, recognizable and borne out by details; deepen only from material already written - never alter a recorded fact for readability, and never complete judgements the author left unwritten.',
        },
      },
      {
        key: 'relations',
        labelKey: 'workbench.aiStarter.book.characters.relations',
        prompt: {
          zh: '梳理这个人与其它人的关系：各篇写过的称谓、来往与态度，指出前后对不上的地方；只汇总已写过的，不得补写篇目里没有的关系与羁绊。',
          en: "Map this person's relations as the pieces record them - names, dealings, attitudes - and show where the accounts disagree; report only what was written, inventing no bonds the pieces never mention.",
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.characters.checkCrossPiece',
        prompt: {
          zh: '同一个人跨篇出现时，称谓、关系与所记细节是否前后一致；只把矛盾摆出来，不得断定哪一篇写得对；笔墨与态度的转变写成提问，不替作者下结论。',
          en: "Where the same person appears across pieces, check that names, relations and recorded details agree; lay contradictions out without deciding which piece was right, and phrase shifts of the author's touch as questions, not verdicts.",
        },
      },
    ],
    catalog: [
      {
        key: 'structure',
        labelKey: 'workbench.aiStarter.book.catalog.structure',
        prompt: {
          zh: '帮我规划这本散文集的篇目先后与分组：按情绪起伏与主题呼应排出顺序，说清为什么用这篇开卷、用哪一篇收卷；允许分辑分组，但尊重现有结构，不要直接替我重排。',
          en: 'Help me plan the running order and grouping of this essay collection: sequence the pieces by emotional arc and thematic echoes, explaining why this piece opens the book and how that one closes it; sections are allowed, but respect the existing structure and reorder nothing yourself.',
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.catalog.checkPieces',
        prompt: {
          zh: '审视全书篇目编排：哪些篇实际在说同一件事、题材与经验上有什么空白、篇幅与语调的落差是节奏还是失控，给出 3 个最该先处理的问题（只诊断，不改稿）。',
          en: "Review the collection's sequencing: which pieces are secretly saying the same thing, what subject-matter gaps remain, whether the spread in length and tone is rhythm or drift — the 3 issues to fix first (diagnose only, do not rewrite).",
        },
      },
      {
        key: 'hook',
        labelKey: 'workbench.aiStarter.book.catalog.material',
        prompt: {
          zh: '把现有的念头与素材按题目归拢：每题列出可用细节与待核事实（没根据的标成待核，不当成已知），并指出哪些能并入现有篇目、哪些够独立成篇。',
          en: 'Cluster the existing ideas and material by subject: list the usable details and facts still to verify for each (mark unverified ones as such, never as known), and note which fit into existing pieces versus stand alone.',
        },
      },
    ],
    timeline: [
      {
        key: 'conflict',
        labelKey: 'workbench.aiStarter.book.timeline.conflict',
        prompt: {
          zh: '审查全书时间线：找出各篇之间的时点冲突与前后倒挂的日期，逐条说明矛盾所在并给修正建议（只标疑问，不替我断定哪个日期是对的）。',
          en: "Review the book's timeline: find when-conflicts and inverted dates between pieces, explain each contradiction and suggest fixes (flag questions only — never decide for me which date was right).",
        },
      },
      {
        key: 'arrange',
        labelKey: 'workbench.aiStarter.book.timeline.arrangePiece',
        prompt: {
          zh: '为某一篇设计时间线事件：这个时点该发生什么、哪些人物参与、与前后篇的事件如何衔接；只建议，不替我定稿。',
          en: 'Design timeline events for one piece: what should happen at this point, which people take part, how it links to the events of neighbouring pieces; suggest only, never finalise.',
        },
      },
      {
        key: 'fill',
        labelKey: 'workbench.aiStarter.book.timeline.fill',
        prompt: {
          zh: '针对待补全草稿，逐条给出时点与事件描述的补全建议（尊重我的原文口径，只建议不替我定稿）。',
          en: 'For the drafts to complete, suggest a when and an event description for each (respect my wording; suggest only, never finalise for me).',
        },
      },
      {
        key: 'density',
        labelKey: 'workbench.aiStarter.book.timeline.density',
        prompt: {
          zh: '分析时间线覆盖与节奏：哪些篇还没有锚定的事件、哪些时段过密或过疏，给出补齐的优先级。',
          en: 'Analyse timeline coverage and pacing: which pieces lack anchored events, which stretches are too dense or too sparse, and what to fill first.',
        },
      },
    ],
    // ㉣ inspiration（AI-4b‴）：分诊的落点只问本篇领得到的事（写成一篇/并入现有篇目），
    // 不许对散文集提「伏笔/剧情线」（hiddenViewKindsForGenre 已裁）；novel 标签「桥接成章」带「章」，换键。
    inspiration: [
      {
        key: 'brainstorm',
        labelKey: 'workbench.aiStarter.book.inspiration.brainstorm',
        prompt: {
          zh: '基于全书题材与念头池里已有的念头，脑暴 8-10 个新念头（一句一个），标注每个念头的类型（立意/人事/景物/句子），不与已有念头重复；不得虚构作者没有经历的事。',
          en: "Based on the book's subjects and the ideas already in the pool, brainstorm 8-10 new ideas (one line each), tag each with its type (intent / people and events / scenes / lines) and avoid duplicating existing ones; invent no experience the author never had.",
        },
      },
      {
        key: 'triage',
        labelKey: 'workbench.aiStarter.book.inspiration.triage',
        prompt: {
          zh: '审视念头池：哪些念头值得先写成一篇、哪些适合并进现有篇目？给出分诊排序（A=马上用 / B=值得养 / C=先放着）与理由。',
          en: 'Review the idea pool: which ideas deserve a piece of their own, which should fold into existing pieces? Give a triage ranking (A=use now / B=worth nurturing / C=park for later) with reasons.',
        },
      },
      {
        key: 'bridge',
        labelKey: 'workbench.aiStarter.book.inspiration.bridgePiece',
        prompt: {
          zh: '挑一条最有潜力的念头，展开成一篇的骨架（从哪里入笔、走到哪里收住），并建议它是并进现有篇目还是独立成篇；只搭骨架，不替我写成全文。',
          en: 'Pick the most promising idea and sketch a piece from it (where to enter, where to close), suggesting whether to fold it into an existing piece or let it stand alone; outline only - do not write it out for me.',
        },
      },
      {
        key: 'prune',
        labelKey: 'workbench.aiStarter.book.inspiration.prune',
        prompt: {
          zh: '找出念头池里过期、重复或已被后来的篇目用掉的念头，逐条给出删除或合并建议（删除不可怕，池子干净才转得动）。',
          en: 'Find stale, duplicated or already-used-up ideas in the pool and recommend deleting or merging each (deleting is fine - a clean pool keeps the collection moving).',
        },
      },
    ],
    // ㉣ proofread（AI-4b‴）：read 不含单位词与叙事腔 → 五支同文（逐字 == novel 行，测试锁）；
    // punct/repeat 只换单位词（章→篇）；flow 按散文的连贯说话（由事入景、由景生感），不要求情节链。
    proofread: [
      {
        key: 'read',
        labelKey: 'workbench.aiStarter.book.proofread.read',
        prompt: {
          zh: '对照体检报告，按优先级指出最值得先处理的 3 个问题：为什么是它们、处理顺序怎么排、各自一句话修法。',
          en: 'Against the proofread report, name the top 3 issues worth fixing first: why they matter, the order to tackle them, and a one-line fix for each.',
        },
      },
      {
        key: 'punct',
        labelKey: 'workbench.aiStarter.book.proofread.punct',
        prompt: {
          zh: '细读指定篇目，找出错别字、标点误用与重复标点，逐条给出原文位置与改法（只指出不直接改稿）。',
          en: 'Read the given piece closely and list typos, punctuation misuse and repeated punctuation, each with its location and suggested fix (point out only, do not rewrite).',
        },
      },
      {
        key: 'repeat',
        labelKey: 'workbench.aiStarter.book.proofread.repeat',
        prompt: {
          zh: '检查指定篇目的重复用词与口头禅式表达：哪些词在短距离内反复出现、哪些描写句式雷同，给出替换建议。',
          en: 'Check the given piece for repeated wording and catchphrase-style expressions: which words recur within short spans, which descriptive sentences feel duplicated, with replacement suggestions.',
        },
      },
      {
        key: 'flow',
        labelKey: 'workbench.aiStarter.book.proofread.flow',
        prompt: {
          zh: '通读指定篇目，检查行文连贯：由事入景、由景生感的过渡走不走得住，前后信息与说法是否矛盾，逐条列出；不替作者补足他没写的结论。',
          en: 'Read the given piece through and check its flow: whether the moves from event to scene to feeling carry, whether earlier and later statements contradict each other - list each one; never complete conclusions the author left open.',
        },
      },
    ],
    writing: [
      {
        key: 'continue',
        labelKey: 'workbench.aiStarter.book.writing.continue',
        prompt: {
          zh: '续写当前篇目：从正文结尾自然衔接，顺着这一篇的立意与语气走，写到它自然收束为止（给出可直接粘贴的正文，不要解释）。',
          en: 'Continue the current piece from where the prose ends, following its intent and voice until it closes naturally (give paste-ready prose, no explanations).',
        },
      },
      {
        key: 'polish',
        labelKey: 'workbench.aiStarter.book.writing.polishPiece',
        prompt: {
          zh: '细读当前篇目正文，按段落指出可打磨处：结构松散、描写空洞、立意换手、信息重复，每条给出原文与改写示例（只建议不直接改稿）。',
          en: 'Read the current piece closely and flag improvements paragraph by paragraph: loose structure, hollow description, the intent changing hands, repeated information — quote the original with a rewrite example (suggest only).',
        },
      },
      {
        key: 'consistency',
        labelKey: 'workbench.aiStarter.book.writing.consistencyPiece',
        prompt: {
          zh: '对照本篇的立意与素材卡，检查当前篇目是否与已写素材矛盾（事实、人物、时间），逐条列出矛盾点与修法；不得补写作者没有经历过的细节。',
          en: "Against this piece's intent and material cards, check the current piece for contradictions with recorded material (facts, people, dates); list each with a fix, and never invent details the author did not live through.",
        },
      },
      {
        key: 'scene',
        labelKey: 'workbench.aiStarter.book.writing.endIntent',
        prompt: {
          zh: '看这一篇的结尾：立意是不是被结尾直接说出来、而不是被感受到？给两种让立意「被感受」的收法方向（只建议，不替我定稿）。',
          en: 'Look at this piece’s ending: does it state the intent instead of letting it be felt? Offer two directions that let the intent be felt (suggest only, never finalise).',
        },
      },
    ],
    // ㉢ stats（AI-4b″，2026-11-10 轮 15）：分组/单位词逐字对齐 bandGroup/bandUnitSize 槽位口径
    // （分组分布 / 各篇体量 / 未分组，T-F′ 已钉）。`outlierMeaninglessForGenre` 对合集型**一条不判**
    // ——统计页不渲染离群行，芯片再问「离群章节」就是对着不存在的读数提问（与 ㉜「锁门发钥匙」同罪），
    // 所以离群那一格换成散文真正判得出的事：同长之下的水与挤。goal 不含单位词 → 五支同文（逐字 == novel 行）。
    stats: [
      {
        key: 'pacing',
        labelKey: 'workbench.aiStarter.book.stats.pacing',
        prompt: {
          zh: '基于写作统计（体量 KPI + 分组分布 + 各篇体量），分析全书的结构节奏：哪些区段偏拖沓或仓促、组与组之间的体量配比是否合理，给出调整建议（尊重创作意图，advisory 仅供参考）。',
          en: "Based on the writing stats (KPIs, group distribution, piece sizes), analyse the collection's structural pacing: which stretches drag or rush, whether group proportions are balanced; suggest adjustments (respect my intent, advisory only).",
        },
      },
      {
        key: 'distribution',
        labelKey: 'workbench.aiStarter.book.stats.distribution',
        prompt: {
          zh: '对照分组分布数据，评估各组的篇数/完稿进度/字数是否头重脚轻或失衡，给出后续分组的体量规划建议。',
          en: 'Against the group distribution, assess whether piece counts / finished ratio / word counts per group are top-heavy or unbalanced; suggest size planning for upcoming groups.',
        },
      },
      {
        key: 'outliers',
        labelKey: 'workbench.aiStarter.book.stats.sizeSpread',
        prompt: {
          zh: '对照各篇的体量落差：长短悬殊在散文集里是体裁常态，不当离群问题；只找**同样长度下明显更水或更挤**的篇目，说明它在哪一组，建议收紧还是放开（不替我删篇，也不建议把篇目写长凑均长）。',
          en: 'Compare piece sizes: a wide long/short spread is normal for an essay collection, not an outlier problem; only find pieces that read thinner or more crammed at a similar size, say which group they sit in, and suggest tightening or opening up (never cut a piece for me, never pad one to match the average).',
        },
      },
      {
        key: 'goal',
        labelKey: 'workbench.aiStarter.book.stats.goal',
        prompt: {
          zh: '基于日更趋势与当前日更目标，评估目标是否现实可持续，给出目标值与写作节奏的调整建议（不催更、不施压）。',
          en: 'Based on the daily trend and current daily goal, assess whether the goal is realistic and sustainable; suggest goal and rhythm adjustments (no nagging, no pressure).',
        },
      },
    ],
    // ㉢ overview（AI-4b″）：维度列 = 11 枚页签 − hiddenViewKindsForGenre 裁项（轮 11 同款反查）：
    // 散文裁掉世界观/剧情线/伏笔 → 人物/时间线/灵感/校对。book 级词沿用 overviewHint 现成口径（散文=全书）。
    overview: [
      {
        key: 'health',
        labelKey: 'workbench.aiStarter.book.overview.health',
        prompt: {
          zh: '给我一份全书健康度体检：① 体量进度与结构节奏是否健康；② 各维度（人物/时间线/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿；散文写的是真实的人事，不得替作者补写记忆。',
          en: "Give me a whole-book health check of this essay collection: ① is the size/progress/structural pacing healthy; ② the state of each dimension (people / timeline / ideas / proofread) and which to prioritise; ③ the 3 most urgent risks, each with a one-line fix. Diagnose only, don't rewrite; the people and events are real — never supply memory the author did not record.",
        },
      },
      {
        key: 'continuity',
        labelKey: 'workbench.aiStarter.book.overview.continuity',
        prompt: {
          zh: '做一份全书连续性审查：① 各篇之间时间线时点冲突与前后倒挂；② 同一人事在不同篇目里的记述是否对得上；③ 作者的立场与判断有没有交代不清的跳转；④ 篇目编排的呼应与过渡是否断裂。逐条给出证据（篇目/事件）与修法；只把矛盾摆出来，不替作者补写没发生过的事。',
          en: "Run a whole-book continuity audit: ① when-conflicts and inverted dates between pieces; ② whether the same people and events agree across pieces; ③ unexplained leaps in the author's stance or judgement; ④ broken echoes and hand-offs in the running order. Cite evidence (piece/event) and fixes item by item; lay contradictions out — never fill in what never happened.",
        },
      },
      {
        key: 'dimension',
        labelKey: 'workbench.aiStarter.book.overview.dimension',
        prompt: {
          zh: '挑当前最薄弱的一个维度（人物/时间线/灵感/校对），结合全书总览数据说明它为什么薄弱、应该先补哪 3 件事、按什么顺序；没有成批的人物卡对散文集是体裁常态，不当缺陷。',
          en: 'Pick the weakest dimension right now (people / timeline / ideas / proofread), explain from the overview data why it is weak and what 3 things to fix first, in what order; an essay collection holding no character cards is normal for the form, not a defect.',
        },
      },
      {
        key: 'risk',
        labelKey: 'workbench.aiStarter.book.overview.risk',
        prompt: {
          zh: '把全书总览里的风险预警（立意换轨 / 素材与所记抵牾 / 文风漂移 / 编排断裂 / 校对问题）按「影响 × 紧迫」排个序，给出一张可执行的处置清单（每条：做什么、涉及哪一篇、预估工作量；不替我改写任何一篇）。',
          en: "Rank the overview's risk warnings (the intent changing hands / records contradicting the material / diction drift / broken arrangement / proofread issues) by impact × urgency, and give an actionable remediation list (each: what to do, which piece, rough effort; rewrite nothing yourself).",
        },
      },
    ],
  },
  poetry: {
    // ㉣ characters（AI-4b‴）：轮 13 `CHARACTER`·poetry 五句硬线搬进芯片（诗集没有人物卡是体裁常态、
    // 不建议先建卡；本体是说话的声音；不指认「这人是谁」）。novel 标签「设计新人物/丰满人设/人物关系网/
    // 人设体检」四格全部顶着「设计/人设」的小说腔 → 四格全换键。
    characters: [
      {
        key: 'design',
        labelKey: 'workbench.aiStarter.book.characters.designVoice',
        prompt: {
          zh: '梳理整本诗集里说话的人：每首的抒情者是谁、人称与语气稳不稳，列一张说话者对照；不做动机分析，也不替作者指认这人是谁。',
          en: "Map who speaks across the collection: each poem's speaker, whether person and tone hold steady, in one concordance; no motive analysis, and never tell the author who a person is.",
        },
      },
      {
        key: 'enrich',
        labelKey: 'workbench.aiStarter.book.characters.enrichVoice',
        prompt: {
          zh: '当前这首诗里说话的人：人称、语气与姿态立不立得住；打磨只落在字句上，不得改动分行与节次，也不得把说话的声音等同于作者本人。',
          en: 'The voice of the current poem: does its person, tone and stance hold up? Work on the words only - never touch line breaks or stanzas, and never equate the speaker with the author.',
        },
      },
      {
        key: 'relations',
        labelKey: 'workbench.aiStarter.book.characters.relationsVoice',
        prompt: {
          zh: '诗里出现过的人（赠诗的对象、回忆里的人）跨首的称呼与身份对照：哪里前后不一只摆出来；不得虚构诗里没有写过的人与事。',
          en: "Compare how the people who appear in poems (an addressee, someone remembered) are named and placed across poems; show inconsistencies only - invent no people or events the poems never contain.",
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.characters.checkCrossPoem',
        prompt: {
          zh: '整本对照：各首的声音有没有互相串味、出现人物的称呼是否前后一致、落在人身上的意象立不立得住；诗集没有成批的人物卡是体裁常态，不得建议先建卡。',
          en: 'Across the collection: do the voices bleed into one another, do recurring people keep consistent names, does the imagery laid on a person hold up? A collection without stacks of character cards is normal for the form - never advise making cards first.',
        },
      },
    ],
    catalog: [
      {
        key: 'structure',
        labelKey: 'workbench.aiStarter.book.catalog.structure',
        prompt: {
          zh: '帮我规划这本诗集的分辑与排序：哪些诗该归为一辑、辑内怎么排，说清每一辑承担什么、整本从哪里起、在哪里收；不要直接替我重排。',
          en: 'Help me plan the sections and ordering of this poetry collection: which poems form one section, how they run inside it, what each section carries and where the book starts and ends; reorder nothing yourself.',
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.catalog.checkOrder',
        prompt: {
          zh: '审视整本的编排：哪些诗的意象跨首高度重复、各辑之间的色调起伏是否成立、哪里读起来雷同，给出 3 个最该先处理的编排问题（评编排，不替单首诗下好坏结论）。',
          en: "Review the book's arrangement: which poems repeat the same images across each other, whether the tonal arc between sections holds, where it reads samey — the 3 arrangement issues to fix first (judge the arrangement, not individual poems).",
        },
      },
      {
        key: 'hook',
        labelKey: 'workbench.aiStarter.book.catalog.formDist',
        prompt: {
          zh: '看整本的形式分布：各体几首、未标形式几首、哪几首未标却更像某一体；只建议归标与排序，不动任何一首的分行。',
          en: 'Look at the collection’s form distribution: how many poems per form, how many untagged, which untagged poems look like a particular form; suggest tagging and placement only — touch no poem’s lineation.',
        },
      },
    ],
    timeline: [
      {
        key: 'conflict',
        labelKey: 'workbench.aiStarter.book.timeline.conflict',
        prompt: {
          zh: '审查整本的时间线：找出锚点时点冲突、以及诗内时间与所标时点不自洽的地方，逐条说明矛盾并给修正建议（只标疑问，不替作者断定）。',
          en: "Review the collection's timeline: find anchor-time conflicts and places where a poem's internal time disagrees with its dated note, explaining each and suggesting fixes (flag questions only, never settle them for the author).",
        },
      },
      {
        key: 'arrange',
        labelKey: 'workbench.aiStarter.book.timeline.arrangePoem',
        prompt: {
          zh: '为某一首设计时间线锚点：它应系在哪个时点、牵涉哪些人与事、与前后的诗如何呼应；只建议，不替我定稿。',
          en: 'Design a timeline anchor for one poem: which point it hangs on, which people and events it touches, how it echoes the poems around it; suggest only, never finalise.',
        },
      },
      {
        key: 'fill',
        labelKey: 'workbench.aiStarter.book.timeline.fill',
        prompt: {
          zh: '针对待补全草稿，逐条给出时点与事件描述的补全建议（尊重我的原文口径，只建议不替我定稿）。',
          en: 'For the drafts to complete, suggest a when and an event description for each (respect my wording; suggest only, never finalise for me).',
        },
      },
      {
        key: 'density',
        labelKey: 'workbench.aiStarter.book.timeline.density',
        prompt: {
          zh: '分析时间线覆盖与节奏：哪些诗还没有锚定的事件、哪些时段过密或过疏，给出补齐的优先级。',
          en: 'Analyse timeline coverage and pacing: which poems lack anchored events, which stretches are too dense or too sparse, and what to fill first.',
        },
      },
    ],
    // ㉣ inspiration（AI-4b‴）：念头类型换成诗自己的落点（意象/分行/题目/形式），分诊不许提
    // 「伏笔/剧情线」（对诗集是已裁视图）；novel 标签「桥接成章」带「章」，换键。
    inspiration: [
      {
        key: 'brainstorm',
        labelKey: 'workbench.aiStarter.book.inspiration.brainstorm',
        prompt: {
          zh: '基于全诗集题材与念头池里已有的念头，脑暴 8-10 个新念头（一句一个），标注每个念头的类型（意象/分行/题目/形式），不与已有念头重复。',
          en: "Based on the collection's range and the ideas already in the pool, brainstorm 8-10 new ideas (one line each), tag each with its type (image / lineation / title / form) and avoid duplicating existing ones.",
        },
      },
      {
        key: 'triage',
        labelKey: 'workbench.aiStarter.book.inspiration.triage',
        prompt: {
          zh: '审视念头池：哪些念头值得先写成一首、哪些只是某一首里还缺的一句？给出分诊排序（A=马上用 / B=值得养 / C=先放着）与理由。',
          en: 'Review the idea pool: which ideas deserve a poem of their own, which are just a line one existing poem still needs? Give a triage ranking (A=use now / B=worth nurturing / C=park for later) with reasons.',
        },
      },
      {
        key: 'bridge',
        labelKey: 'workbench.aiStarter.book.inspiration.bridgePoem',
        prompt: {
          zh: '挑一条最有潜力的念头，展开成一首诗的骨架（打算分几节、拟标什么形式、起句与收句的方向）；只搭骨架，不动任何已有诗作的分行。',
          en: 'Pick the most promising idea and frame a poem from it (stanzas planned, form to claim, where the first and last lines might land); frame only - touch no existing poem’s line breaks.',
        },
      },
      {
        key: 'prune',
        labelKey: 'workbench.aiStarter.book.inspiration.prune',
        prompt: {
          zh: '找出念头池里过期、重复或已被某首诗用掉的念头，逐条给出删除或合并建议（删除不可怕，池子干净才转得动）。',
          en: 'Find stale, duplicated or already-used ideas in the pool and recommend deleting or merging each (deleting is fine - a clean pool keeps the collection moving).',
        },
      },
    ],
    // ㉣ proofread（AI-4b‴）：read 五支同文；punct 自带诗的条件（省标点、跨行断点不算病，
    // 与审校第 5 条豁免同一口径，轮 11 立的尺）；repeat 按「有意复现的咏叹不算」判；
    // flow 不许按散文的连贯性判诗的跳跃（分行与省略是手段）。
    proofread: [
      {
        key: 'read',
        labelKey: 'workbench.aiStarter.book.proofread.read',
        prompt: {
          zh: '对照体检报告，按优先级指出最值得先处理的 3 个问题：为什么是它们、处理顺序怎么排、各自一句话修法。',
          en: 'Against the proofread report, name the top 3 issues worth fixing first: why they matter, the order to tackle them, and a one-line fix for each.',
        },
      },
      {
        key: 'punct',
        labelKey: 'workbench.aiStarter.book.proofread.punct',
        prompt: {
          zh: '细读指定诗作，只找真正的错别字与标点误用：诗省标点、标点随跨行走都不算病，不得建议为补标点而改动分行（逐条给位置与改法，只指出不改稿）。',
          en: 'Read the given poem and list only real typos and punctuation misuse: a poem may drop punctuation or let it cross a line break - that is not an error, and never suggest touching line breaks to fix punctuation (point out only, do not rewrite).',
        },
      },
      {
        key: 'repeat',
        labelKey: 'workbench.aiStarter.book.proofread.repeat',
        prompt: {
          zh: '检查指定诗作与本集的重复用词：同一个词、同一组意象、同一种结法在多首里无意识复现的挑出来（有意复现的咏叹不算），给出替换建议。',
          en: 'Check the given poem against the collection for repeated wording: the same word, image cluster or closing gesture recurring unawares across poems (a deliberate refrain does not count), with replacement suggestions.',
        },
      },
      {
        key: 'flow',
        labelKey: 'workbench.aiStarter.book.proofread.flow',
        prompt: {
          zh: '通读指定诗作：节与节的跳跃、意象之间的接续走不走得住；分行与省略是诗的手段，不按散文的连贯性判它断裂，只摆疑问，不替诗总结想表达什么。',
          en: "Read the given poem through: do the leaps between stanzas and the hand-offs between images carry? Line breaks and omissions are the poem's means, not breaks in prose coherence - raise questions only, never summarise what the poem expresses.",
        },
      },
    ],
    writing: [
      {
        key: 'continue',
        labelKey: 'workbench.aiStarter.book.writing.continue',
        prompt: {
          zh: '续写当前诗作：从末尾自然衔接，保持分行、节奏与意象系统与已有诗作一致；不必凑字数，该收就收（给出可直接粘贴的诗句，不要解释）。',
          en: 'Continue the current poem from its tail, keeping the lineation, rhythm and imagery consistent with the existing poems; do not pad for length - stop when the poem stops (paste-ready lines, no explanations).',
        },
      },
      {
        key: 'polish',
        labelKey: 'workbench.aiStarter.book.writing.polishPoem',
        prompt: {
          zh: '细读当前诗作，指出可打磨的字句：哪一行有冗余的字、哪一处断句削弱张力、哪个意象空转，给出原句与调整示例（不动分行与节数，只建议不改稿）。',
          en: 'Read the current poem and flag lines worth polishing: wasted words, breaks that weaken tension, images that spin idle; quote each line with an adjustment example (never move line breaks or stanzas; suggest only).',
        },
      },
      {
        key: 'consistency',
        labelKey: 'workbench.aiStarter.book.writing.consistencyPoem',
        prompt: {
          zh: '检查当前诗作：所用的意象与本集的意象系统是否同调、与其它诗作有无重复或抵牾、所标诗体的特征是否逐行守住（没标就建议归哪一体）；只指出现象，不替诗总结「想表达什么」。',
          en: 'Check the current poem: whether its images stay in key with the collection’s imagery system, repeat or contradict other poems, and whether the form it claims holds line by line (if untagged, suggest one); report findings only — never declare what the poem expresses.',
        },
      },
      {
        key: 'scene',
        labelKey: 'workbench.aiStarter.book.writing.lineReview',
        prompt: {
          zh: '审当前诗作的分行：哪一处断句削弱张力、哪一处断得正好；给出行数相同下的调整方案（挪字、挪词，不增删行）；若确实该合并或拆开，单独说明理由并等我确认。',
          en: 'Audit the poem’s lineation: which break weakens tension and which lands well; propose same-line-count adjustments (move words, not lines); if a merge or split is truly warranted, say why separately and wait for my nod.',
        },
      },
    ],
    // ㉢ stats（AI-4b″）：单位词吃 bandGroup/bandUnitSize 现成口径（分组分布 / 各首体量）。
    // 诗集平铺不假装有卷（P8「辑」未落地，stats 文案不声称它存在）；离群对诗集**一条不判**
    // （outlierMeaninglessForGenre），那一格换成诗集判得出的事：标了某体的诗守不守该体的句数字数。
    stats: [
      {
        key: 'pacing',
        labelKey: 'workbench.aiStarter.book.stats.pacing',
        prompt: {
          zh: '基于写作统计（体量 KPI + 分组分布 + 各首体量），分析全诗集的编排节奏：哪些时段排得密、哪些排得疏，组与组之间的体量配比是否成立，给出调整建议（长短悬殊与自由诗、散文诗都不判出格，advisory 仅供参考）。',
          en: "Based on the writing stats (KPIs, group distribution, poem sizes), analyse the collection's arranging rhythm: which stretches sit dense or sparse, whether the proportion between groups holds; suggest adjustments (length spread, free verse and prose poems are not out of form; advisory only).",
        },
      },
      {
        key: 'distribution',
        labelKey: 'workbench.aiStarter.book.stats.distribution',
        prompt: {
          zh: '对照分组分布数据，评估各组的诗数/完稿进度/体量是否失衡，给出后续分组的体量规划建议（长短悬殊是诗集常态，不判离群；只建议，不替我重排）。',
          en: 'Against the group distribution, assess whether poem counts / finished ratio / sizes per group are unbalanced, and suggest size planning for upcoming groups (a length spread is normal for a collection, not an outlier; suggest only — reorder nothing yourself).',
        },
      },
      {
        key: 'outliers',
        labelKey: 'workbench.aiStarter.book.stats.formSizes',
        prompt: {
          zh: '对照各首体量与所标形式：只查**标了某体**的是否守住该体的句数与字数，逐首给读数；自由诗与散文诗不判出格，首与首的长短悬殊是体裁常态；不得建议把短诗写长，不得改动任何一首的分行与节次。',
          en: "Check each poem's size against the form it is tagged with: only poems with a declared form are checked for line and character counts, poem by poem; free verse and prose poems are not out of form, and a length spread between poems is normal; never suggest making a short poem longer, never touch any poem's line breaks or stanzas.",
        },
      },
      {
        key: 'goal',
        labelKey: 'workbench.aiStarter.book.stats.goal',
        prompt: {
          zh: '基于日更趋势与当前日更目标，评估目标是否现实可持续，给出目标值与写作节奏的调整建议（不催更、不施压）。',
          en: 'Based on the daily trend and current daily goal, assess whether the goal is realistic and sustainable; suggest goal and rhythm adjustments (no nagging, no pressure).',
        },
      },
    ],
    // ㉢ overview（AI-4b″）：诗集裁世界观/剧情线/伏笔 → 维度列 = 人物/时间线/灵感/校对；
    // book 级词沿用 overviewHint 的「全诗集」；硬线沿用 DIAGNOSE/CHARACTER 已立口径（零自创）。
    overview: [
      {
        key: 'health',
        labelKey: 'workbench.aiStarter.book.overview.healthPoem',
        prompt: {
          zh: '给我一份全诗集健康度体检：① 体量进度与编排节奏是否健康；② 各维度（人物/时间线/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿，也不替任何一首诗总结「想表达什么」。',
          en: 'Give me a whole-collection health check: ① is the size/progress/arrangement healthy; ② the state of each dimension (people / timeline / ideas / proofread) and which to prioritise; ③ the 3 most urgent risks, each with a one-line fix. Diagnose only, don\'t rewrite, and never summarise what a poem "means".',
        },
      },
      {
        key: 'continuity',
        labelKey: 'workbench.aiStarter.book.overview.continuity',
        prompt: {
          zh: '做一份全诗集连续性审查：① 时间线锚点时点冲突与诗内时间和所标时点不自洽；② 意象在诗与诗之间的重复与漂移；③ 分行与所标形式是否始终自守（自由诗与散文诗不判出格）；④ 分组与排序的呼应、过渡是否断裂。逐条给出证据（诗作/事件）与修法；不许改动任何一首的分行与节次。',
          en: "Run a whole-collection continuity audit: ① anchor-time conflicts and a poem's internal time disagreeing with its dated note; ② imagery repeating or drifting between poems; ③ whether lineation and the tagged form stayed self-consistent throughout (free verse and prose poems are not out of form); ④ broken echoes and hand-offs in the grouping and order. Cite evidence (poem/event) and fixes; never touch any poem's line breaks or stanzas.",
        },
      },
      {
        key: 'dimension',
        labelKey: 'workbench.aiStarter.book.overview.dimension',
        prompt: {
          zh: '挑当前最薄弱的一个维度（人物/时间线/灵感/校对），结合全诗集总览数据说明它为什么薄弱、应该先补哪 3 件事、按什么顺序；诗集没有成批的人物卡是体裁常态，不是缺陷，不得建议先建卡。',
          en: 'Pick the weakest dimension right now (people / timeline / ideas / proofread), explain from the collection overview why it is weak and what 3 things to fix first, in what order; a poetry collection without stacks of character cards is normal for the form, not a defect — do not suggest making cards first.',
        },
      },
      {
        key: 'risk',
        labelKey: 'workbench.aiStarter.book.overview.risk',
        prompt: {
          zh: '把全诗集总览里的风险预警（时间线冲突 / 跨首意象重复 / 未标形式 / 未锚定事件 / 校对问题）按「影响 × 紧迫」排个序，给出一张可执行的处置清单（每条：做什么、涉及哪一首、预估工作量；不得建议改动分行与节次，不替我重排）。',
          en: "Rank the overview's risk warnings (timeline conflicts / imagery repeated across poems / untagged forms / unanchored events / proofread issues) by impact × urgency, and give an actionable remediation list (each: what to do, which poem, rough effort); never suggest changing line breaks or stanza counts, and reorder nothing yourself.",
        },
      },
    ],
  },
  script: {
    // ㉣ characters（AI-4b‴）：轮 13 `CHARACTER`·script 五句硬线搬进芯片（要什么谁挡着拿什么交换、
    // 遮名辨声、角色表与正文互核、卡上只认作者给过或可证的）。剧本的人物立在台词里：
    // 「丰满人设/人设体检」两键换掉，「设计新人物」换成角色表口径的「设计新角色」。
    characters: [
      {
        key: 'design',
        labelKey: 'workbench.aiStarter.book.characters.designRole',
        prompt: {
          zh: '帮这出戏设计一个新角色：他要什么、谁挡着他、拿什么交换，他的说法跟别人哪里不一样（语汇层级、句子长短），并说明他进场后哪个回合会因此改变；不增删、不重排幕与场的编号。',
          en: 'Design a new role for this play: what they want, who blocks them, what is traded, how their speech differs (vocabulary level, sentence length), and which conflict turn changes once they enter; never add, remove or renumber acts and scenes.',
        },
      },
      {
        key: 'enrich',
        labelKey: 'workbench.aiStarter.book.characters.enrichCast',
        prompt: {
          zh: '针对当前角色，只看台词能不能立住这个人：语汇层级、句子长短、口头禅分不分得清是谁在说；补强只从已写台词与舞台指示里推，不得自行补全经历、关系与动机。',
          en: "For the current role, check whether the dialogue alone makes them stand: vocabulary level, sentence length, catchphrases - is it clear who speaks? Deepen only from written dialogue and stage directions; never complete a backstory, relations or motives yourself.",
        },
      },
      {
        key: 'relations',
        labelKey: 'workbench.aiStarter.book.characters.relations',
        prompt: {
          zh: '梳理角色之间的冲突网：谁和谁要的东西相撞、谁挡着谁、哪对关系在表上立了却没有台词；指出潜在的冲突与羁绊，只按已有的角色表与各场正文来看。',
          en: "Map the web of opposition among the cast: whose wants collide, who blocks whom, which pair sits on the sheet without a line; point out conflicts and bonds, working only from the cast sheet and the written scenes.",
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.characters.checkCast',
        prompt: {
          zh: '核对角色表与各场正文：表里立了人却全程没台词没调度、正文里有戏却没进表，两种都要点名；再遮住角色名读台词，看各人的声音分不分得清；卡上只认作者给过的或台词与舞台指示可证的。',
          en: 'Cross-check the cast sheet against the scenes: listed people without a line or a move, and people with stage business missing from the sheet - name both; then read the lines with names covered to see whether each voice is distinguishable; cards may only carry what the author gave or the text proves.',
        },
      },
    ],
    catalog: [
      {
        key: 'structure',
        labelKey: 'workbench.aiStarter.book.catalog.structure',
        prompt: {
          zh: '帮我核全剧的幕场结构：逐场说出目标、障碍、结果，标出可合并、可删或该补的场，并说明合并会丢掉什么；不增删、不重排现有幕与场的编号，只提方案。',
          en: "Help me audit the play's act/scene structure: each scene's objective, obstacle and outcome; flag mergeable, deletable or missing scenes and say what a merge would cost; never add, remove or renumber acts and scenes — proposals only.",
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.catalog.checkActs',
        prompt: {
          zh: '审视幕场推进：每一幕的转折点在哪、幕末有没有把人逼到必须进下一场、哪一场删掉剧情就会塌，给出 3 个最该先处理的结构问题（只诊断，不改稿）。',
          en: "Review the act/scene engine: each act's turning point, whether the act ends force the next scene, which scene would collapse the plot if cut — the 3 structure issues to fix first (diagnose only).",
        },
      },
      {
        key: 'hook',
        labelKey: 'workbench.aiStarter.book.catalog.addScenes',
        prompt: {
          zh: '基于现有幕场与念头池，给 6-8 个可补的场次：各写清谁与谁、争什么、结束时局面怎么变，并标出应落在第几幕之后；不新建幕、不改编号，只列方案，不写成台本。',
          en: 'From the existing acts/scenes and idea pool, give 6-8 scenes worth adding: each states who with whom, over what, how the situation changes by the end, and where it sits; no new acts, no renumbering, options only — do not write the script.',
        },
      },
    ],
    timeline: [
      {
        key: 'conflict',
        labelKey: 'workbench.aiStarter.book.timeline.conflict',
        prompt: {
          zh: '审查全剧的时间线：找出同轨时点冲突与跨场时间倒挂，逐条说明矛盾所在并给修正建议。',
          en: "Review the play's timeline: find same-track when-collisions and cross-scene inversions, explain each contradiction and suggest fixes.",
        },
      },
      {
        key: 'arrange',
        labelKey: 'workbench.aiStarter.book.timeline.arrangeScene',
        prompt: {
          zh: '为某一场设计时间线事件：此时点该发生什么、哪些角色在场、与前后的场次事件如何衔接；只建议，不替我定稿。',
          en: 'Design timeline events for one scene: what should happen at this point, which characters are present, how it links to the scenes around it; suggest only, never finalise.',
        },
      },
      {
        key: 'fill',
        labelKey: 'workbench.aiStarter.book.timeline.fill',
        prompt: {
          zh: '针对待补全草稿，逐条给出时点与事件描述的补全建议（尊重我的原文口径，只建议不替我定稿）。',
          en: 'For the drafts to complete, suggest a when and an event description for each (respect my wording; suggest only, never finalise for me).',
        },
      },
      {
        key: 'density',
        labelKey: 'workbench.aiStarter.book.timeline.density',
        prompt: {
          zh: '分析时间线覆盖与节奏：哪些场还没有锚定的事件、哪些段落过密或过疏，给出补齐的优先级。',
          en: 'Analyse timeline coverage and pacing: which scenes lack anchored events, which stretches are too dense or too sparse, and what to fill first.',
        },
      },
    ],
    // ㉣ storylines（AI-4b‴）：剧情线在剧本里走的是幕场（hiddenViewKindsForGenre('script') 只裁世界观，
    // 此栏可见）：线的推进按「等不到它的场次」说，交叉按「抢戏」说，挂线落回场次；硬线沿用「不增删、不重排编号」。
    storylines: [
      {
        key: 'design',
        labelKey: 'workbench.aiStarter.book.storylines.design',
        prompt: {
          zh: '帮这出戏设计一条新的线（主线/支线皆可）：给出线名、一句话定位、起承转合各落在哪几场、结局走向；不新建幕、不增删、不重排现有幕与场的编号。',
          en: 'Design a new line for this play (through-line or subplot): a name, a one-line premise, which scenes carry its setup, turn and payoff, and where it ends; no new acts, never add, remove or renumber existing scene numbers.',
        },
      },
      {
        key: 'weave',
        labelKey: 'workbench.aiStarter.book.storylines.weave',
        prompt: {
          zh: '对照各场检查每条线的推进：哪条线太久没等到属于它的场次、哪条线挤在同一段里，给出穿插节奏建议（不增删、不重排幕与场的编号）。',
          en: "Against the scenes, check each line's progress: which line has waited too long for a scene of its own, which crowds one stretch; suggest an interleaving rhythm (never add, remove or renumber acts and scenes).",
        },
      },
      {
        key: 'untangle',
        labelKey: 'workbench.aiStarter.book.storylines.untangle',
        prompt: {
          zh: '梳理多条线的交叉：哪些场同时推进多条线、哪里在互相抢戏、哪里该让一条线单独站一会儿，给出编排建议；只建议，不替我改台本。',
          en: 'Untangle where the lines cross: which scenes carry several at once, where they compete for the stage, where one line should stand alone a while; suggest an arrangement - propose only, rewrite no script.',
        },
      },
      {
        key: 'coverage',
        labelKey: 'workbench.aiStarter.book.storylines.coverage',
        prompt: {
          zh: '分析挂线情况：还没归入任何一条线的事件与节拍，应该并进哪条线、还是值得单开一场，逐条给建议（只建议不替我定稿，不新建幕、不改编号）。',
          en: 'Analyse attachment: for events and beats on no line yet, suggest which line to fold them into or whether a scene of their own is worth it, item by item (suggest only, never finalise; no new acts, no renumbering).',
        },
      },
    ],
    // ㉣ foreshadowing（AI-4b‴）：伏笔在剧本里按幕场走——plant「在后面哪一章」换「哪一场」
    //（轮 12 台账点名的最后一笔）；「读者容易忘」换成「观众」（戏是演给人看的）；abandon 不含单位词 → 共用格逐字 == novel 行。
    foreshadowing: [
      {
        key: 'plant',
        labelKey: 'workbench.aiStarter.book.foreshadowing.plant',
        prompt: {
          zh: '为当前场次设计伏笔：给出可埋下的物件/台词/停顿（越轻越好），并说明它适合在后面哪一场、以什么方式呼应；不增删、不重排幕与场的编号。',
          en: 'Design foreshadowing for the current scene: propose a light prop / line / pause to plant, and say which later scene should answer it and how; never add, remove or renumber acts and scenes.',
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.foreshadowing.check',
        prompt: {
          zh: '审查全剧伏笔清单：哪些待呼应的伏笔埋得太重或太轻、哪些回收跨度太长容易被观众忘掉，逐条给建议。',
          en: "Review the play's foreshadowing list: which pending plants are too heavy or too subtle, which payoff spans are so long the audience may forget them; give itemised suggestions.",
        },
      },
      {
        key: 'weave',
        labelKey: 'workbench.aiStarter.book.foreshadowing.weave',
        prompt: {
          zh: '为每条待呼应的伏笔设计回收场面：在哪一场自然兑现、需要哪些人物同场、与剧情线如何交织（只建议不替我定稿，不替我写成台本）。',
          en: 'Design payoff moments for each pending plant: in which scene it lands naturally, who needs to be on stage, how it weaves into the storylines (suggest only, never finalise for me - do not write the script).',
        },
      },
      {
        key: 'abandon',
        labelKey: 'workbench.aiStarter.book.foreshadowing.abandon',
        prompt: {
          zh: '检查已弃置/长期未回收的伏笔：它们是否还值得捡回？给出捡回或正式弃置的建议（弃置不丢人，干净比强行回收更好）。',
          en: 'Review abandoned / long-pending foreshadowing: is each still worth picking up? Recommend picking it back up or abandoning it cleanly (a clean drop beats a forced payoff).',
        },
      },
    ],
    // ㉣ inspiration（AI-4b‴）：念头类型换成戏剧的落点（冲突回合/人物口吻/场面/台词），分诊问的是
    // 「发展成一个回合还是值得单成一场」；桥接展开的是回合，不是节拍→章。
    inspiration: [
      {
        key: 'brainstorm',
        labelKey: 'workbench.aiStarter.book.inspiration.brainstorm',
        prompt: {
          zh: '基于全剧题材与念头池里已有的念头，脑暴 8-10 个新念头（一句一个），标注每个念头的类型（冲突回合/人物口吻/场面/台词），不与已有念头重复。',
          en: "Based on the play's material and the ideas already in the pool, brainstorm 8-10 new ideas (one line each), tag each with its type (conflict turn / character voice / stage business / dialogue) and avoid duplicating existing ones.",
        },
      },
      {
        key: 'triage',
        labelKey: 'workbench.aiStarter.book.inspiration.triage',
        prompt: {
          zh: '审视念头池：哪些念头值得发展成某场里的一个回合、哪些够格单独成一场？给出分诊排序（A=马上用 / B=值得养 / C=先放着）与理由；成场建议不新建幕、不改编号。',
          en: 'Review the idea pool: which ideas should grow into a turn inside a scene, which earn a scene of their own? Give a triage ranking (A=use now / B=worth nurturing / C=park for later) with reasons; scene proposals add no acts and renumber nothing.',
        },
      },
      {
        key: 'bridge',
        labelKey: 'workbench.aiStarter.book.inspiration.bridgeScene',
        prompt: {
          zh: '挑一条最有潜力的念头，展开成一组冲突回合（3-5 个：谁要什么、谁挡着、拿什么交换、结束时局面怎么变），并建议它适合落进哪一场、还是值不值得单开一场；不替我写成台本。',
          en: 'Pick the most promising idea and expand it into a run of conflict turns (3-5: who wants what, who blocks, what is traded, how the situation changes by the end), suggesting which scene it lands in or whether it earns one; do not write the script for me.',
        },
      },
      {
        key: 'prune',
        labelKey: 'workbench.aiStarter.book.inspiration.prune',
        prompt: {
          zh: '找出念头池里过期、重复或已被现有场次用掉的念头，逐条给出删除或合并建议（删除不可怕，池子干净才转得动）。',
          en: 'Find stale, duplicated or already-used ideas in the pool and recommend deleting or merging each (deleting is fine - a clean pool keeps the play moving).',
        },
      },
    ],
    // ㉣ proofread（AI-4b‴）：read 五支同文；punct 自带剧本豁免（角色名起行、括注指示独立成行是排法不是病，
    // 与审校第 5 条豁免同一口径）；repeat 判的是「台词趋同」（各人越说越像一个人）；flow 按场面衔接说话。
    proofread: [
      {
        key: 'read',
        labelKey: 'workbench.aiStarter.book.proofread.read',
        prompt: {
          zh: '对照体检报告，按优先级指出最值得先处理的 3 个问题：为什么是它们、处理顺序怎么排、各自一句话修法。',
          en: 'Against the proofread report, name the top 3 issues worth fixing first: why they matter, the order to tackle them, and a one-line fix for each.',
        },
      },
      {
        key: 'punct',
        labelKey: 'workbench.aiStarter.book.proofread.punct',
        prompt: {
          zh: '细读指定场次，找出错别字、标点误用与重复标点，逐条给出原文位置与改法；角色名起行、括注指示独立成行是剧本的排法，不得判成标点错误（只指出不直接改稿）。',
          en: 'Read the given scene and list typos, punctuation misuse and repeated punctuation with location and fix; a character name on its own line and bracketed directions are script format, not punctuation errors (point out only, do not rewrite).',
        },
      },
      {
        key: 'repeat',
        labelKey: 'workbench.aiStarter.book.proofread.repeat',
        prompt: {
          zh: '检查指定场次的台词趋同：哪些人越说越像同一个人、哪些词在不同角色口中反复出现，给出按人分开的替换建议（保持各人的口吻，不把所有人改成一种说法）。',
          en: "Check the given scene for converging voices: speakers drifting toward one way of talking, words recurring across different roles; suggest replacements role by role (keep each character's voice - never flatten everyone into one way of speaking).",
        },
      },
      {
        key: 'flow',
        labelKey: 'workbench.aiStarter.book.proofread.flow',
        prompt: {
          zh: '通读指定场次，检查场面衔接：台词接不接得上、事件先后有无矛盾、舞台指示与人物调度对不对得上，逐条列出（不增删、不重排幕与场的编号）。',
          en: 'Read the given scene through for its joins: do the lines answer each other, does the order of events hold, do stage directions match the business on stage - list each item (never add, remove or renumber acts and scenes).',
        },
      },
    ],
    writing: [
      {
        key: 'continue',
        labelKey: 'workbench.aiStarter.book.writing.continue',
        prompt: {
          zh: '续写当前场次：从末尾自然衔接，保持角色名起行、台词另起一行的排法；本场未结束就续写本场，结束了就另起一场（给出可直接粘贴的台本，不要解释）。',
          en: 'Continue the current scene from its tail, keeping the format (character name on its own line, dialogue beneath it); stay in the scene until it ends, then open a new one (paste-ready script, no explanations).',
        },
      },
      {
        key: 'polish',
        labelKey: 'workbench.aiStarter.book.writing.polishScene',
        prompt: {
          zh: '细读当前场次的台词，指出可打磨处：说法生硬、用台词替代表演、长台词不值得它的长度，每条引原句给改写方向（不得改变谁在说话与说出的事实；只建议不改稿）。',
          en: "Read the scene's dialogue and flag polish points: stiff lines, lines that describe instead of act, speeches longer than they earn; quote each line with a direction (never change who speaks or what is conveyed; suggest only).",
        },
      },
      {
        key: 'consistency',
        labelKey: 'workbench.aiStarter.book.writing.consistencyScene',
        prompt: {
          zh: '对照角色表与前场梗概，检查当前场次有无矛盾（谁在场、人物关系、事件推进到哪一步），逐条列出矛盾点与修法。',
          en: 'Against the cast sheet and earlier scene synopses, check this scene for contradictions (who is present, relationships, how far the action has run); list each with a fix.',
        },
      },
      {
        key: 'scene',
        labelKey: 'workbench.aiStarter.book.writing.planScene',
        prompt: {
          zh: '设计下一场：给出这一场的目标、障碍、结果，谁在场、接在当前场次之后放在哪里；不新建幕、不改编号，只建议，不替我写成台本。',
          en: 'Design the next scene: its objective, obstacle and outcome, who is present, where it sits after the current scene; no new acts, no renumbering, propose only — do not write the script.',
        },
      },
    ],
    // ㉢ stats（AI-4b″）：单位词吃 bandGroup/bandUnitSize 现成口径（幕分布 / 各场体量）；book 级词
    // 沿用 statsHint 的「全剧」（progressLabel 轮 13 已立此口径）。**剧本的离群行照判**
    // （outlierMeaninglessForGenre 不含 script：场次体量是节奏工具，判得出来才有信号）——离群那一格不换问事。
    stats: [
      {
        key: 'pacing',
        labelKey: 'workbench.aiStarter.book.stats.pacing',
        prompt: {
          zh: '基于写作统计（体量 KPI + 幕分布 + 各场体量），分析全剧的场面节奏：哪些区段偏拖沓或仓促、幕与幕之间的体量配比是否合理，给出调整建议（场次体量悬殊在剧本里是真信号，advisory 仅供参考）。',
          en: "Based on the writing stats (KPIs, act distribution, scene sizes), analyse the play's scene pacing: which stretches drag or rush, whether proportions between acts are sound; suggest adjustments (a scene's size spread is a real pacing signal in a play; advisory only).",
        },
      },
      {
        key: 'distribution',
        labelKey: 'workbench.aiStarter.book.stats.distribution',
        prompt: {
          zh: '对照幕分布数据，评估各幕的场数/完稿进度/字数是否头重脚轻或失衡，给出后续幕的体量规划建议（不增删、不重排幕与场的编号）。',
          en: 'Against the act distribution, assess whether scene counts / finished ratio / word counts per act are top-heavy or unbalanced; suggest size planning for upcoming acts (never add, remove or renumber acts and scenes).',
        },
      },
      {
        key: 'outliers',
        labelKey: 'workbench.aiStarter.book.stats.outliers',
        prompt: {
          zh: '逐个审视离群场次（超长/偏短）：结合它在剧中的位置判断是刻意的节奏设计还是失控——场次长短本来就是节奏工具，判得出来才有信号；分别给收紧、拆分、合并或补写的建议（不增删、不重排幕与场的编号）。',
          en: 'Review each outlier scene (extra long / short) in its place in the play: deliberate pacing or out of control — scene length is a pacing tool in drama, so the signal is real; suggest tightening, splitting, merging or filling per case (never add, remove or renumber acts and scenes).',
        },
      },
      {
        key: 'goal',
        labelKey: 'workbench.aiStarter.book.stats.goal',
        prompt: {
          zh: '基于日更趋势与当前日更目标，评估目标是否现实可持续，给出目标值与写作节奏的调整建议（不催更、不施压）。',
          en: 'Based on the daily trend and current daily goal, assess whether the goal is realistic and sustainable; suggest goal and rhythm adjustments (no nagging, no pressure).',
        },
      },
    ],
    // ㉢ overview（AI-4b″）：剧本只裁世界观 → 维度列 = 角色表/时间线/剧情线/伏笔/灵感/校对
    // （页签表 + overviewHint 现成口径：「角色清点…伏笔逾期未呼应…剧情线」）；book 级词 = 全剧。
    overview: [
      {
        key: 'health',
        labelKey: 'workbench.aiStarter.book.overview.healthPlay',
        prompt: {
          zh: '给我一份全剧健康度体检：① 体量进度与场面节奏是否健康；② 各维度（角色表/时间线/剧情线/伏笔/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿；不增删、不重排幕与场的编号。',
          en: "Give me a whole-play health check: ① is the size/progress/scene pacing healthy; ② the state of each dimension (cast / timeline / plotlines / foreshadowing / ideas / proofread) and which to prioritise; ③ the 3 most urgent risks, each with a one-line fix. Diagnose only, don't rewrite; never add, remove or renumber acts and scenes.",
        },
      },
      {
        key: 'continuity',
        labelKey: 'workbench.aiStarter.book.overview.continuity',
        prompt: {
          zh: '做一份全剧连续性审查：① 时间线同轨冲突与跨场时间倒挂；② 伏笔埋设与呼应是否对得上、有无长期逾期未呼应的铺垫；③ 各角色有无语言习惯/动机上的自相矛盾——遮住角色名读台词还认不认得出谁在说；④ 幕末钩子与场与场的衔接是否断裂。逐条给出证据（场次/事件）与修法；不增删、不重排幕与场的编号。',
          en: "Run a whole-play continuity audit: ① same-track timeline conflicts and cross-scene inversions; ② foreshadowing plants vs payoffs, anything long overdue; ③ characters contradicting their own speech habits or motivations — read the lines with names covered and see who still speaks; ④ broken act-outs and scene hand-offs. Cite evidence (scene/event) and fixes; never add, remove or renumber acts and scenes.",
        },
      },
      {
        key: 'dimension',
        labelKey: 'workbench.aiStarter.book.overview.dimension',
        prompt: {
          zh: '挑当前最薄弱的一个维度（角色表/时间线/剧情线/伏笔/灵感/校对），结合全剧总览数据说明它为什么薄弱、应该先补哪 3 件事、按什么顺序；不得建议增删、重排幕与场的编号。',
          en: "Pick the weakest dimension right now (cast / timeline / plotlines / foreshadowing / ideas / proofread), explain from the play overview why it is weak and what 3 things to fix first, in what order; never suggest adding, removing or renumbering acts and scenes.",
        },
      },
      {
        key: 'risk',
        labelKey: 'workbench.aiStarter.book.overview.risk',
        prompt: {
          zh: '把全剧总览里的风险预警（时间线冲突 / 伏笔逾期未呼应 / 剧情线断线 / 节拍未落场 / 校对问题）按「影响 × 紧迫」排个序，给出一张可执行的处置清单（每条：做什么、涉及哪一场、预估工作量；如需补场只列方案，不替我写成台本）。',
          en: "Rank the overview's risk warnings (timeline conflicts / foreshadowing past due / broken-off plotlines / unanchored beats / proofread issues) by impact × urgency, and give an actionable remediation list (each: what to do, which scene, rough effort; if a new scene seems needed, list the plan only — do not write the script).",
        },
      },
    ],
  },
  diary: {
    // ㉣ characters（AI-4b‴）：轮 13 `CHARACTER`·diary 硬线原样搬进芯片（只按已记的说、不下心理诊断、
    // 不替作者解释他自己、人只以「那天在场」的身份出现）。novel 标签「丰满人设/人设体检」对日记是冒犯：
    // 人不是被设出来的，是被记下的 —— 换键；design 与散文共用「为人物立卡」（两边都叫立卡/建档）。
    characters: [
      {
        key: 'design',
        labelKey: 'workbench.aiStarter.book.characters.designPerson',
        prompt: {
          zh: '为一个提到多次却还没有建档的人立一张卡：汇总各天写过的称呼与事迹，只当可选建档的提示；不编动机与前史，不得替作者补写那几天发生的事。',
          en: 'Offer a card for a frequently mentioned person who has none: gather the names and deeds the days already record - an optional offer, no invented motives or pasts, never supplying what a day left unrecorded.',
        },
      },
      {
        key: 'enrich',
        labelKey: 'workbench.aiStarter.book.characters.enrichGather',
        prompt: {
          zh: '汇总各天对同一个人写下的话，看已有的记录能拼出多完整的形象；缺的留白，不替作者补写没记的事，也不给人物编造动机与前史。',
          en: "Gather what different days said about the same person and see how complete a figure the record alone makes; leave the gaps blank - invent no motives or pasts, supply nothing the author did not record.",
        },
      },
      {
        key: 'relations',
        labelKey: 'workbench.aiStarter.book.characters.relations',
        prompt: {
          zh: '这本日记里的人彼此怎么称呼、关系随日期有什么变化；只按各天写过的说，有矛盾只摆出来，不得断定哪一天的说法作准。',
          en: "How the people in this journal name each other, and how their relations shift over the dates; report only what the entries say, show contradictions without deciding which day's account was right.",
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.characters.checkCrossDay',
        prompt: {
          zh: '同一个人不同天的称呼与判断是否一致、作者的态度随日期有无转变；把转变写成提问而不是结论，不下心理诊断，也不替作者解释他自己。',
          en: "Check whether each person is named and judged consistently across days, and where the author's attitude turns; phrase the turn as a question, not a verdict - diagnose no one psychologically, and never explain the author to himself.",
        },
      },
    ],
    catalog: [
      {
        key: 'structure',
        labelKey: 'workbench.aiStarter.book.catalog.archivePlan',
        prompt: {
          zh: '给这本日记的归档提建议：按现有年/月层级指出哪里缺一个分组、哪里条目太碎可以并月、哪几段适合单独拿出来回看；不重排、不改日期、不新建或删除条目，只给方案。',
          en: 'Propose filing improvements for this journal: within the existing year/month levels, where a group is missing, where entries are too fragmented to merge by month, which stretches deserve a dedicated reread; never reorder, never change dates, never add or delete entries — proposals only.',
        },
      },
      {
        key: 'check',
        labelKey: 'workbench.aiStarter.book.catalog.checkFiling',
        prompt: {
          zh: '审视整本的年月覆盖：哪几个月完全没有条目、哪些天出现了自相矛盾的记述、哪段空档前后的语气反差最大；只摆事实与提问，不追问为什么没写。',
          en: 'Review the year/month coverage: which months have no entries at all, which days carry contradicting accounts, where a gap’s before/after contrast is sharpest; lay out facts and questions only — never ask why a day was skipped.',
        },
      },
      {
        key: 'hook',
        labelKey: 'workbench.aiStarter.book.catalog.rereads',
        prompt: {
          zh: '挑出 3 个最值得回看的时间段：各说清它前一条最后写了什么、后一条开头写了什么、中间跨了多久，并各配一句当时该问自己的话；不得虚构任何一天的事实。',
          en: 'Pick the 3 stretches most worth rereading: for each, what the last entry before it said, how the first entry after it opens, how long the gap runs — each with one question worth asking then; never invent what happened on a day.',
        },
      },
    ],
    timeline: [
      {
        key: 'conflict',
        labelKey: 'workbench.aiStarter.book.timeline.conflict',
        prompt: {
          zh: '审查这本日记的时间线：找出与条目日期冲突、以及内文所述前后倒挂的地方；只标疑问并列证据，不替作者断定哪一天是对的。',
          en: "Review the journal's timeline: find conflicts with entry dates and inversions inside the texts; flag questions with evidence — never decide for the author which day was right.",
        },
      },
      {
        key: 'arrange',
        labelKey: 'workbench.aiStarter.book.timeline.arrangeDay',
        prompt: {
          zh: '梳理某一天的事件：当天发生的先后、在场的人、哪件值得展开、哪件一笔带过即可；不得替作者补写没记下的事。',
          en: "Sort out one day's events: their order, who was there, which deserve space and which a single line; never supply what the author did not record.",
        },
      },
      {
        key: 'fill',
        labelKey: 'workbench.aiStarter.book.timeline.fill',
        prompt: {
          zh: '针对待补全草稿，逐条给出时点与事件描述的补全建议（尊重我的原文口径，只建议不替我定稿）。',
          en: 'For the drafts to complete, suggest a when and an event description for each (respect my wording; suggest only, never finalise for me).',
        },
      },
      {
        key: 'density',
        labelKey: 'workbench.aiStarter.book.timeline.density',
        prompt: {
          zh: '看整本的书写节奏：哪些时段完全没写、哪些日子写得密、哪些只剩流水账；只摆事实，不评价该不该写。',
          en: "Look at the journal's writing rhythm: which stretches were never written, which days are dense, which read like pure logs; facts only — no verdict on what should have been written.",
        },
      },
    ],
    // ㉣ inspiration（AI-4b‴）：日记的念头只许从已记的事出发（分诊问「哪天没说完」，不追问为什么没写）；
    // novel 标签「桥接成章」带「章」→ 换「接进哪天」。
    inspiration: [
      {
        key: 'brainstorm',
        labelKey: 'workbench.aiStarter.book.inspiration.brainstorm',
        prompt: {
          zh: '基于全本题材与念头池里已有的念头，脑暴 8-10 个还可以往下写的念头（一句一个），只从已记的事出发，标注每个念头的类型（人物/事情/感受），不得虚构那天没记下的经过。',
          en: "Based on the journal's range and the ideas already in the pool, brainstorm 8-10 ideas still worth writing (one line each), starting only from what is already recorded, tagged by type (people / events / feelings); invent nothing a day left out.",
        },
      },
      {
        key: 'triage',
        labelKey: 'workbench.aiStarter.book.inspiration.triage',
        prompt: {
          zh: '审视念头池：哪些念头是某天没说完、可以接回当天条目的？哪些值得留着以后回看？给出分诊排序（A=马上接 / B=值得留 / C=先放着）与理由；不追问为什么当时没写。',
          en: 'Review the idea pool: which ideas finish something a day left unsaid and could rejoin that day’s entry, which deserve a later reread? Give a triage ranking (A=rejoin now / B=worth keeping / C=park for later) with reasons; never ask why a thought went unwritten.',
        },
      },
      {
        key: 'bridge',
        labelKey: 'workbench.aiStarter.book.inspiration.bridgeDay',
        prompt: {
          zh: '挑一条念头，把它说清：它与哪一天的记录相接、还可以展开哪一层；只从已记的事出发，写回条目也只站在那一天的所知与口吻里，不替作者补写没写下的经过。',
          en: "Take one idea and make it clear: which day's record it joins, what layer it could open; start only from what is recorded, and keep any rewritten entry inside that day's knowledge and voice - never supply what was left unwritten.",
        },
      },
      {
        key: 'prune',
        labelKey: 'workbench.aiStarter.book.inspiration.prune',
        prompt: {
          zh: '找出念头池里过期、重复或已经写进条目的念头，逐条给出删除或合并建议（删除不可怕，池子干净才转得动）；没落地不等于作废，拿不准的列成待回看。',
          en: 'Find stale, duplicated or already-written ideas in the pool and recommend deleting or merging each (deleting is fine - a clean pool keeps moving); not-landed is not spent, so list doubtful ones for rereading.',
        },
      },
    ],
    // ㉣ proofread（AI-4b‴）：read 五支同文；punct 自带日记豁免（当天的口语、简称与只有作者懂的说法不算误用）；
    // repeat 把「同一心结跨条目反复」只摆不评（DIAGNOSE·反复与心结同口径）；flow 只查当天自洽，不要求起承转合。
    proofread: [
      {
        key: 'read',
        labelKey: 'workbench.aiStarter.book.proofread.read',
        prompt: {
          zh: '对照体检报告，按优先级指出最值得先处理的 3 个问题：为什么是它们、处理顺序怎么排、各自一句话修法。',
          en: 'Against the proofread report, name the top 3 issues worth fixing first: why they matter, the order to tackle them, and a one-line fix for each.',
        },
      },
      {
        key: 'punct',
        labelKey: 'workbench.aiStarter.book.proofread.punct',
        prompt: {
          zh: '细读指定条目，找出错别字、标点误用与重复标点，逐条给出原文位置与改法；当天的口语、简称与只有作者懂的说法不算误用（只指出不直接改稿）。',
          en: "Read the given entry and list typos, punctuation misuse and repeated punctuation with location and fix; that day's colloquialisms, abbreviations and private shorthand are not errors (point out only, do not rewrite).",
        },
      },
      {
        key: 'repeat',
        labelKey: 'workbench.aiStarter.book.proofread.repeat',
        prompt: {
          zh: '检查指定条目的重复用词：哪些词在短距离内反复出现、哪些说法几乎逐句相同，给出替换建议；同一心结跨条目反复出现只摆出来，不评价口吻。',
          en: 'Check the given entry for repeated wording: which words recur within short spans, which sentences echo one another nearly word for word, with replacement suggestions; a preoccupation recurring across entries is only noted, never judged.',
        },
      },
      {
        key: 'flow',
        labelKey: 'workbench.aiStarter.book.proofread.flow',
        prompt: {
          zh: '通读指定条目，看当天记录前后自洽不自洽：时间、人物、说法有没有互相矛盾；只摆疑问与证据，不要求它起承转合，也不替作者补因果。',
          en: "Read the given entry through for self-consistency: do its times, people and accounts contradict each other? List questions with evidence - demand no arc, and supply no causes the author did not record.",
        },
      },
    ],
    writing: [
      {
        key: 'continue',
        labelKey: 'workbench.aiStarter.book.writing.continue',
        prompt: {
          zh: '续写当天条目：只写当天已知的事与当时的想法，保持当天的口吻；不替作者补记忆、不剧透后来发生的事（给出可直接粘贴的正文，不要解释）。',
          en: "Continue today's entry writing only what that day knows and thinks, in that day's voice; no supplied memory, no hindsight about later events (paste-ready text, no explanations).",
        },
      },
      {
        key: 'polish',
        labelKey: 'workbench.aiStarter.book.writing.polishDay',
        prompt: {
          zh: '理顺当天条目里表达不顺的句子：每条引原句给改后版本；只顺句子、去重复说法，不得改变所记事实、时间顺序与当天的语气。',
          en: 'Smooth the awkward sentences in today’s entry: quote each with a fixed version; tidy wording and remove repetition only — never change the recorded facts, their order, or that day’s voice.',
        },
      },
      {
        key: 'consistency',
        labelKey: 'workbench.aiStarter.book.writing.consistencyDay',
        prompt: {
          zh: '检查当天条目：日期与内文提到的时间是否自洽、所记的人与事与其它条目有无矛盾；只列疑问与证据，不替作者断定哪一天是对的。',
          en: "Check today's entry: does its date agree with the times named inside, and do its people and events contradict other entries? List questions with evidence — never decide for the author.",
        },
      },
      {
        key: 'scene',
        labelKey: 'workbench.aiStarter.book.writing.openQuestions',
        prompt: {
          zh: '看当天条目：有没有该留却没留下的人、事或当时的心情？只提问，不给答案，不替作者编造没写下的经过。',
          en: "Look over today's entry: are there people, events or feelings that should have been recorded but were not? Ask only — do not answer, and never invent what was not written.",
        },
      },
    ],
    // ㉢ stats（AI-4b″）：单位词吃 bandGroup/bandUnitSize 现成口径（年月分布 / 各天体量）；book 级词
    // 沿用 statsHint 的「全本」。日记也是合集型（outlierMeaninglessForGenre 判不判由同一把尺）——
    // 离群那一格换成日记判得出的事：单条密度。全线守住日记铁律：**只摆读数，不评价该不该写**。
    stats: [
      {
        key: 'pacing',
        labelKey: 'workbench.aiStarter.book.stats.pacing',
        prompt: {
          zh: '基于写作统计（体量 KPI + 年月分布 + 各天体量），看全本的书写节奏：哪些时段写得密、哪些时段只剩一句两句；只摆读数与提问，不评价该不该写，也不追问为什么没写。',
          en: "Based on the writing stats (KPIs, year/month distribution, size by day), look at this journal's writing rhythm: which stretches are dense, which days hold just a line or two; lay out readings and questions only — no verdict on what should have been written, no asking why a day was skipped.",
        },
      },
      {
        key: 'distribution',
        labelKey: 'workbench.aiStarter.book.stats.distribution',
        prompt: {
          zh: '对照年月分布数据，看各年月的条数与体量是否疏密悬殊；空着的月份只当事实列出——空着不是缺陷。',
          en: 'Against the year/month distribution, see whether entry counts and sizes are unevenly spread; empty months are listed as fact — an empty month is not a defect.',
        },
      },
      {
        key: 'outliers',
        labelKey: 'workbench.aiStarter.book.stats.entryDensity',
        prompt: {
          zh: '看每天条目的密度：哪几天只有一两句、哪几天记的最细；指出哪里还有素材可写，但只摆读数与提问——不得替作者补写那天没记的事，也不评价该不该写。',
          en: "Look at each day's entry density: which days hold a line or two, which days the most detail; note where material is still waiting to be written, but readings and questions only — never supply what the author did not record, no verdicts on what should have been written.",
        },
      },
      {
        key: 'goal',
        labelKey: 'workbench.aiStarter.book.stats.goal',
        prompt: {
          zh: '基于日更趋势与当前日更目标，评估目标是否现实可持续，给出目标值与写作节奏的调整建议（不催更、不施压）。',
          en: 'Based on the daily trend and current daily goal, assess whether the goal is realistic and sustainable; suggest goal and rhythm adjustments (no nagging, no pressure).',
        },
      },
    ],
    // ㉢ overview（AI-4b″）：日记裁世界观/剧情线/伏笔 → 维度列 = 人物/时间线/灵感/校对；
    // book 级词 = 全本（overviewHint 现成）。风险列全部住在 DIAGNOSE.diary 五维里（时间与事实/
    // 态度变化/后见补写/反复与心结 + 校对），硬线沿用：只摆事实与提问，不替作者断定。
    overview: [
      {
        key: 'health',
        labelKey: 'workbench.aiStarter.book.overview.healthJournal',
        prompt: {
          zh: '给我一份全本健康度体检：① 记录的连续性与体量是否健康；② 各维度（人物/时间线/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只摆事实与提问：不得替作者补写没记下的事，也不得替他解释他自己。',
          en: "Give me a health check of this journal: ① is the continuity and size of the record healthy; ② the state of each dimension (people / timeline / ideas / proofread) and which to prioritise; ③ the 3 most urgent risks, each with a one-line fix. Facts and questions only: never supply what was not recorded, and never explain the author to himself.",
        },
      },
      {
        key: 'continuity',
        labelKey: 'workbench.aiStarter.book.overview.continuity',
        prompt: {
          zh: '做一份全本记录连续性审查：① 条目日期与内文所提时点的冲突、前后倒挂；② 同一人事在不同条目里的记述是否对得上、有无疑似事后补写的句子；③ 作者对同一人的态度随日期有无转变，指出起止并写成提问而不是结论；④ 空档前后是否断层没交代。逐条给出证据（日期/条目）；只摆疑问，不替作者断定哪一天是对的。',
          en: "Run a whole-journal continuity audit: ① entry dates vs times named inside, and inversions; ② whether the same people and events agree across entries, and lines that read like later addenda; ③ the author's attitude toward the same person shifting over dates — give the span, phrase it as a question not a verdict; ④ unexplained breaks around long gaps. Cite evidence (date/entry); never decide for the author which day was right.",
        },
      },
      {
        key: 'dimension',
        labelKey: 'workbench.aiStarter.book.overview.dimension',
        prompt: {
          zh: '挑当前最薄弱的一个维度（人物/时间线/灵感/校对），结合全本总览数据说明它为什么薄弱、应该先补哪 3 件事、按什么顺序；日记里的人以「那天在场」的身份出现，不要求先建档再写，也不得替作者解释他自己。',
          en: "Pick the weakest dimension right now (people / timeline / ideas / proofread), explain from the journal overview why it is weak and what 3 things to fix first, in what order; people appear in a journal as \"present that day\" — no cards required first, and never explain the author to himself.",
        },
      },
      {
        key: 'risk',
        labelKey: 'workbench.aiStarter.book.overview.risk',
        prompt: {
          zh: '把全本总览里的风险预警（日期与内文冲突 / 记述互相矛盾 / 疑似后见补写 / 长期空档 / 校对问题）按「影响 × 紧迫」排个序，给出一张可执行的处置清单（每条：做什么、涉及哪一天、预估工作量；空档只当事实列出，空着不是缺陷）。',
          en: "Rank the overview's risk warnings (date/body-text conflicts / contradicting accounts / suspected later addenda / long gaps / proofread issues) by impact × urgency, and give an actionable list (each: what to do, which day, rough effort; gaps listed as fact — an empty stretch is not a defect).",
        },
      },
    ],
  },
};

/** 本支体裁在题材 tab 上的起步示例（novel/未设/脏值 = 改造前逐字；未登记的组领 novel 行 = 记债在测试） */
export function topicStartersFor(genre: string | null | undefined, topic: BookTopicKey): BookStarter[] {
  const row = TOPIC_STARTER_OVERRIDES[workbenchCommandSet(genre ?? '')]?.[topic] ?? TOPIC_STARTERS_NOVEL[topic];
  return row.map((s) => ({ key: s.key, labelKey: s.labelKey, prompt: L(s.prompt.zh, s.prompt.en) }));
}

/** 代码场景起步示例（㉡ 从面板搬入并改存语言对：旧表嵌死 `L()`，切语言不刷新） */
const CODE_STARTERS: BookStarterSeed[] = [
  {
    key: 'explain',
    labelKey: 'workbench.aiStarter.explain',
    prompt: {
      zh: '解释当前文件的作用、结构与关键逻辑',
      en: "Explain this file's purpose, structure, and key logic",
    },
  },
  {
    key: 'fix',
    labelKey: 'workbench.aiStarter.fix',
    prompt: {
      zh: '修复当前文件里的报错',
      en: 'Fix the errors reported in the current file',
    },
  },
  {
    key: 'refactor',
    labelKey: 'workbench.aiStarter.refactor',
    prompt: {
      zh: '重构当前选中的代码，提升可读性与可维护性',
      en: 'Refactor the selected code to improve readability and maintainability',
    },
  },
  {
    key: 'tests',
    labelKey: 'workbench.aiStarter.tests',
    prompt: {
      zh: '为当前选中的代码编写单元测试',
      en: 'Write unit tests for the selected code',
    },
  },
];

export function codeStarters(): BookStarter[] {
  return CODE_STARTERS.map((s) => ({ key: s.key, labelKey: s.labelKey, prompt: L(s.prompt.zh, s.prompt.en) }));
}

/**
 * 全书总览体检问句（㉡ 从面板搬入并改存语言对，同款 `L()` 存量反例一并收）。
 * ㉢（AI-4b″，2026-11-10 轮 15）按体裁换词收口：它的维度串与 overview 题材组是**同一张嘴**
 * （人物/世界观/…/伏笔那枚维度列），轮 14 台账明写「只收其中一张、漏掉另一张就是账分叉」——
 * 本刀两组 + 这颗按钮同轮翻。维度列判据 = 11 枚页签 − `hiddenViewKindsForGenre` 裁项（轮 11 同款反查，
 * 测试按括号列逐字对锁三张嘴）；book 级词沿用 overviewHint 现成口径（全书/全诗集/全剧/全本）。
 * **零回归线**：novel 一格 = 轮 14 搬表时的逐字节原文（测试独立另存对锁）；未设/脏值经
 * `workbenchCommandSet` 落 novel 格。
 */
const BOOK_OVERVIEW_BY_GENRE: Record<GenrePromptVariant, PromptPair> = {
  novel: {
    zh: '基于上面的全书总览，给我一份全书健康度体检：① 体量进度与叙事节奏是否健康；② 各题材维度（人物/世界观/时间线/剧情线/伏笔/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿。',
    en: "Based on the book overview above, give me a health check: ① is the size/progress/pacing healthy; ② the state of each dimension (characters / worldbuilding / timeline / plotlines / foreshadowing / ideas / proofread) and which to prioritise; ③ list the 3 most urgent risks with a one-line fix each. Diagnose only, don't rewrite.",
  },
  essay: {
    zh: '基于上面的全书总览，给我一份全书健康度体检：① 体量进度与结构节奏是否健康；② 各题材维度（人物/时间线/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿；散文写的是真实的人事，不得替作者补写记忆。',
    en: "Based on the book overview above, give me a health check: ① is the size/progress/structural pacing healthy; ② the state of each dimension (people / timeline / ideas / proofread) and which to prioritise; ③ list the 3 most urgent risks with a one-line fix each. Diagnose only, don't rewrite; the people and events are real — never supply memory the author did not record.",
  },
  poetry: {
    zh: '基于上面的全诗集总览，给我一份全诗集健康度体检：① 体量进度与编排节奏是否健康；② 各题材维度（人物/时间线/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿：诗集没有成批的人物卡是体裁常态，不是缺陷，不得建议先建卡；也不许替任何一首诗总结「想表达什么」。',
    en: "Based on the collection overview above, give me a health check: ① is the size/progress/arrangement healthy; ② the state of each dimension (people / timeline / ideas / proofread) and which to prioritise; ③ list the 3 most urgent risks with a one-line fix each. Diagnose only, don't rewrite; a poetry collection without stacks of character cards is normal for the form, not a defect — do not suggest making cards first, and never summarise what a poem \"means\".",
  },
  script: {
    zh: '基于上面的全剧总览，给我一份全剧健康度体检：① 体量进度与场面节奏是否健康；② 各题材维度（角色表/时间线/剧情线/伏笔/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿；不增删、不重排幕与场的编号。',
    en: "Based on the play overview above, give me a health check: ① is the size/progress/scene pacing healthy; ② the state of each dimension (cast / timeline / plotlines / foreshadowing / ideas / proofread) and which to prioritise; ③ list the 3 most urgent risks with a one-line fix each. Diagnose only, don't rewrite; never add, remove or renumber acts and scenes.",
  },
  diary: {
    zh: '基于上面的全本总览，给我一份全本健康度体检：① 记录的连续性与体量是否健康；② 各题材维度（人物/时间线/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只摆事实与提问：不得替作者补写没记下的事，也不得替他解释他自己。',
    en: "Based on the journal overview above, give me a health check: ① is the continuity and size of the record healthy; ② the state of each dimension (people / timeline / ideas / proofread) and which to prioritise; ③ list the 3 most urgent risks with a one-line fix each. Facts and questions only: never supply what the author did not record, and never explain the author to himself.",
  },
};

export function bookOverviewPrompt(genre: string | null | undefined): string {
  const row = BOOK_OVERVIEW_BY_GENRE[workbenchCommandSet(genre ?? '')];
  return L(row.zh, row.en);
}
