// ㉝（AI-2b，2026-11-10 轮 9）
//
// `/ai` 快捷卡**点下去发出去的那句话**按体裁取。
//
// 病灶（状态文件 §队列 AI-2b）：`AiAgentPage.handleQuickAction` 六个 case 全按小说写 ——
// 诗集作者点「续写」，模型收到的是「请为下面的小说片段续写…300～600 字」。
// ㉜（轮 7）把卡面数量与空态句裁对了，这一刀把「发出去的话」接上同一口径：
// **卡面话（`aiCardDescKey`，i18n）与本模块（prompt，内联双语）用同一批现成体裁名词**，
// 配对着色（测试把两边的词锁在同一条来源键上：aiChatEmpty / volumeSummary / 货架模板名）。
//
// 载体口径沿用 `aiLang.L` 的第五轮惯例：发给模型读的正文走代码内联双语（zh 权威），
// 不挤进 UI 语言包。判据不在这：体裁 → 变体走 `workbenchCommandSet`（writingSchema），
// Record 穷尽 = 编译期锁（这是 `genrePromptPack`（AI-1-1）的第一块地基：先收快捷动作域，
// writingAssistant 的六条链下一刀塌进来，不在本刀顺手扩域）。
//
// **零回归线**：novel 一格是改造前 `AiAgentPage` 逐字复制，测试独立另存一份原文对锁；
// 未设 / 脏体裁值经 `workbenchCommandSet` 落 novel 格 → 与改造前逐字节相同。
// analyze / outline 的指令正文仍在队列 AI-2b′（要连五维模板一起重排，不半改）。

import { workbenchCommandSet } from '../utils/writingSchema';
import { L } from './aiLang';

/** 有独立 prompt 文案的体裁变体（键集 = workbenchCommandSet 的值集，编译期穷尽） */
export type GenrePromptVariant = ReturnType<typeof workbenchCommandSet>;

/** 语言对（与 L() 同载体；调用方 `L(pair.zh, pair.en)`，zh 为权威） */
export interface PromptPair {
  zh: string;
  en: string;
}

/**
 * prompt 上下文块（【当前作品】下方那几行）的单位词表。
 * 中文标签**不随 UI 语言切**——这是改造前现状（英文 prompt 里这几行也是中文），本刀不扩面。
 * 每个词都必须能追溯到现成键：currentUnitLabel ⊂ `writing.aiChatEmpty*` 原句；
 * unitMeasure ⊂ `agent.writing.volumeSummary*`；personaLabel ⊂ `writingLeft.tplCharacter`
 * /剧本用 `writing.script.tabCharacters` 的「角色表」；outlineLabel ⊂ 各体裁货架模板名词。
 *
 * **㉞（AI-2b′）加的四个 en 字段不是扩面，是补第三张嘴**：`MessageView.handleSend` 与
 * 「快捷插入」那三处一直是 `L(中文标签, 英文标签)` 双份（`[Current Chapter]` /
 * `[Character Cards]` / `[Chapter Outline]` / `[Current chapter tail]`），快捷动作那边只吃
 * 中文那份。诗集作者在英文界面发一条普通消息，模型收到的仍是「当前章」那套列名——
 * ⑰-1 那句「首轮消息会自动附带当前诗作…」正是被这张嘴顶着说谎的。英文侧同样每个词有出处：
 * currentUnitEn ⊂ `agent.welcome.continueDesc*` 英文原句（"the current piece / poem / scene"、
 * "today's entry"）；personaEn ⊂ 同处的 "character cards" / `continueDescScript` 的 "cast sheet"；
 * outlineEn ⊂ 同处的 "idea notes" 与 `writingLeft.tplPoemImagery` / `tplSceneBeat` / `tplDiaryMatter`。
 */
export interface PromptTerms {
  /** 【当前X】那一行的 X（含「当前/当天」前缀） */
  currentUnitLabel: string;
  /** 「共 N X，已完稿 M X」的量词 */
  unitMeasure: string;
  /** 角色行组的栏题（【人设卡】那一格） */
  personaLabel: string;
  /** 大纲行组的栏题（【本章大纲】那一格） */
  outlineLabel: string;
  /** 以上三条的英文侧（`[Current Chapter]` / `[Character Cards]` / `[Chapter Outline]`） */
  currentUnitEn: string;
  personaEn: string;
  outlineEn: string;
  /** 「【当前X末尾】」那一行（快捷插入用的整串英文标签，novel = 改造前逐字） */
  tailEn: string;
  /** 「（X id：12）」那一格——写作域工具按 id 取数，栏名必须与上面的单位同名 */
  idLabel: string;
  idEn: string;
  /**
   * ㉟ AI-5（2026-11-10 轮 12）：`buildChatContext`（AI 语料 / 灵感扩写 / 写作 AI 对话
   * 三处共用的自动注入块）的四个栏名。novel 八字段 = 改造前 `useAiActions` 字面量逐字
   * （零回归线）；zh 单位行直接复用 `currentUnitLabel`（novel「当前章节」本就逐字相同），
   * 英文侧因大小写形状不同（块内是句中的 `Current chapter:`）单列 `ctxUnitEn`。
   * 「世界观设定」栏不在此表：非小说四支的 worldview 在 ⑮-2 已裁（建不出条目，
   * 该段对它们恒空），栏名对剧本也仍是「世界观」本义，不是小说专名。
   */
  ctxUnitEn: string;
  skeletonZh: string;
  skeletonEn: string;
  personaBlockZh: string;
  personaBlockEn: string;
  tailBlockZh: string;
  tailBlockEn: string;
  /**
   * ㉠ AI-2b″（2026-11-10 轮 13）：「【X进度】共 N …」那一行的栏名。
   * novel 格 = 改造前四处字面量「全书进度」逐字（零回归线）。剧本领「全剧进度」：
   * 幕场组织起来的是戏不是书 —— 现成口径在 `writing.aiChatEmptyScript`（「角色表与全剧
   * 资料摘要」）、`writing.script.statsHint`（「全剧体量与节奏」）、`analyzeDescScript`
   * （「审视全剧」），不是自创词。散文/诗/日记仍领「全书进度」：轮 11 台账判过「勉强成立」
   * （essay 的 aiChatEmptyPiece 自己就说「全书资料摘要」），无事生非者不登记。
   * **没有 en 字段**：英文侧五支同文 `[Progress] N total, M completed`，本就不含
   * book / play 这类名词，与改造前逐字一致，没有东西可换。
   */
  progressLabel: string;
  /**
   * ㉤ AI-6（2026-11-10 轮 17）：画布排版助手（`canvasAssistant.buildCanvasWritingContext`）四格。
   * 画布侧那截上下文块与本模块的 MessageView 块同形（【作品】行 / 进度行 / 栏题），改造前同样
   * 写死小说字面量。novel 四格 = 改造前 `canvasAssistant` 字面量逐字（零回归线），出处逐格：
   *  - `unitTagZh`：【作品】行里《title》前的单位短语（novel「当前章」逐字）。
   *    essay/poetry/script = 「当前」+ `unitMeasure`（`writing.unitClassifier.*` 那三枚量词）；
   *    diary 取 `currentUnitLabel` 现成句「当天条目」——「当前天」不成话，轮 16 先例「无事生非不登记」反过来就是「不成话不硬拼」。
   *  - `unitTagEn`：它的英文侧（句中小写形——画布同句的英文本来就是句中嵌入）。
   *    novel「current chapter」逐字；四支 ⊂ `agent.welcome.continueDesc*` 英文原句
   *    （"the current piece / poem / scene"、"today's entry"，轮 11 已给 currentUnitEn 锁过同一出处）。
   *  - `outlineBlockZh`：大纲行组的栏题（novel「大纲节拍」逐字）。四支 = 货架 `writing-outline`
   *    模板名现成值（`writingLeft.tplEssayIdea` 构思 / `tplPoemImagery` 意象素材 / `tplSceneBeat` 场次梗概 / `tplDiaryMatter` 当日要点）——
   *    画布上铺的 outline 卡与货架拖出的是同一种实体，两边必须叫同一个名。
   *  - `progressUnitEn`：进度行英文侧的复数量词（novel「chapters」逐字）。
   *    四支 ⊂ `agent.writing.volumeSummary*` 英文侧（pieces / poems / scenes / days）。
   *    中文栏名与量词吃现成的 `progressLabel`/`unitMeasure`（轮 13/9 立的格），不另开格。
   * 【世界观设定】栏题不在本表：worldview 对非小说四支是被裁视图（本轮起连脏数据都不再喂模型，
   * 判据 `hiddenViewKindsForGenre`），且该栏名本义通用不是小说专名 —— 与轮 12 对 personaBlock 的判定同一条。
   */
  unitTagZh: string;
  unitTagEn: string;
  outlineBlockZh: string;
  progressUnitEn: string;
  /**
   * ㉦ AI-6′（2026-11-10 轮 19）：book 级词 —— 「＿＿总览」那一格的主语。
   * 画布的空画布报错要叫出**总览视图在本体裁里的专名**，而这名字早有人定过：
   * `editor.writing.studioPane.overviewHint` 与 `writing.{poetry,script,diary}.overviewHint` 的首词
   * （全书 / 全诗集 / 全剧 / 全本）。本刀只是把现成口径登记成可取用的一格，**零自创词**。
   * 与 `progressLabel` 的分工（别互相借词）：那一格是**进度栏名**，轮 11 判过 essay/poetry/diary
   * 领「全书进度」勉强成立、不另造词；本格指的是一个**有体裁专名的视图**，各按各的现成口径。
   * novel 那格 = 改造前 `canvasAssistant` 字面量逐字（零回归线）；essay 同值（它的 overviewHint
   * 首词本来就是「全书」，轮 15「散文本就叫全书体检 → 键不动」同一判据）。
   * **没有 en 字段**：那条报错的英文侧本就不含 book / collection 这类名词，无物可换。
   */
  bookLevelZh: string;
}

const TERMS: Record<GenrePromptVariant, PromptTerms> = {
  // novel 前四格 = 改造前逐字（零回归线）；后四格 = 改造前 `MessageView` 里的英文原标签逐字
  novel: {
    currentUnitLabel: '当前章节',
    unitMeasure: '章',
    personaLabel: '人设卡',
    outlineLabel: '本章大纲',
    currentUnitEn: 'Current Chapter',
    personaEn: 'Character Cards',
    outlineEn: 'Chapter Outline',
    tailEn: 'Current chapter tail',
    idLabel: '章节 id',
    idEn: 'chapter id',
    // 后八格 = 改造前 `useAiActions.buildChatContext` 的字面量逐字（零回归线）
    ctxUnitEn: 'Current chapter',
    skeletonZh: '全书章节骨架',
    skeletonEn: 'Book chapter skeleton',
    personaBlockZh: '人物档案',
    personaBlockEn: 'Character profiles',
    tailBlockZh: '当前章正文',
    tailBlockEn: 'Current chapter text',
    progressLabel: '全书进度', // = 改造前四处字面量逐字（零回归线）
    // ㉤ 后四格 = 改造前 `canvasAssistant` 字面量逐字（零回归线，轮 17 基线由脚本从改前磁盘态程序化抽出）
    unitTagZh: '当前章',
    unitTagEn: 'current chapter',
    outlineBlockZh: '大纲节拍',
    progressUnitEn: 'chapters',
    bookLevelZh: '全书',
  },
  essay: {
    currentUnitLabel: '当前篇目',
    unitMeasure: '篇',
    personaLabel: '人物卡',
    outlineLabel: '本篇构思',
    currentUnitEn: 'Current Piece',
    personaEn: 'Character Cards',
    outlineEn: 'Idea Notes',
    tailEn: 'Current piece tail',
    idLabel: '篇目 id',
    idEn: 'piece id',
    ctxUnitEn: 'Current piece',
    skeletonZh: '全书篇目骨架',
    skeletonEn: 'Book piece skeleton',
    personaBlockZh: '人物卡',
    personaBlockEn: 'Character cards',
    tailBlockZh: '当前篇正文',
    tailBlockEn: 'Current piece text',
    progressLabel: '全书进度', // essay 的现成口径就说「全书资料摘要」（aiChatEmptyPiece）
    unitTagZh: '当前篇',
    unitTagEn: 'current piece',
    outlineBlockZh: '构思',
    progressUnitEn: 'pieces',
    bookLevelZh: '全书',
  },
  poetry: {
    currentUnitLabel: '当前诗作',
    unitMeasure: '首',
    personaLabel: '人物卡',
    outlineLabel: '本首意象素材',
    currentUnitEn: 'Current Poem',
    personaEn: 'Character Cards',
    outlineEn: 'Imagery Notes',
    tailEn: 'Current poem tail',
    idLabel: '诗作 id',
    idEn: 'poem id',
    ctxUnitEn: 'Current poem',
    skeletonZh: '全本书作骨架',
    skeletonEn: 'Full poem list',
    personaBlockZh: '人物卡',
    personaBlockEn: 'Character cards',
    tailBlockZh: '当前诗作正文',
    tailBlockEn: 'Current poem text',
    progressLabel: '全书进度', // 轮 11 判「勉强成立」，不另造词
    unitTagZh: '当前首',
    unitTagEn: 'current poem',
    outlineBlockZh: '意象素材',
    progressUnitEn: 'poems',
    bookLevelZh: '全诗集',
  },
  script: {
    currentUnitLabel: '当前场次',
    unitMeasure: '场',
    personaLabel: '角色表',
    outlineLabel: '本场梗概',
    currentUnitEn: 'Current Scene',
    personaEn: 'Cast Sheet',
    outlineEn: 'Scene Synopsis',
    tailEn: 'Current scene tail',
    idLabel: '场次 id',
    idEn: 'scene id',
    ctxUnitEn: 'Current scene',
    skeletonZh: '全剧幕场结构',
    skeletonEn: 'Act and scene structure',
    personaBlockZh: '角色表',
    personaBlockEn: 'Cast sheet',
    tailBlockZh: '当前场次正文',
    tailBlockEn: 'Current scene text',
    progressLabel: '全剧进度', // 幕场组织的是戏不是书（口径：aiChatEmptyScript / script.statsHint）
    unitTagZh: '当前场',
    unitTagEn: 'current scene',
    outlineBlockZh: '场次梗概',
    progressUnitEn: 'scenes',
    bookLevelZh: '全剧',
  },
  diary: {
    currentUnitLabel: '当天条目',
    unitMeasure: '天',
    personaLabel: '人物卡',
    outlineLabel: '当日要点',
    currentUnitEn: "Today's Entry",
    personaEn: 'Character Cards',
    outlineEn: 'Day Notes',
    tailEn: "Today's entry tail",
    idLabel: '条目 id',
    idEn: 'entry id',
    ctxUnitEn: "Today's entry",
    skeletonZh: '条目时间线',
    skeletonEn: 'Journal timeline',
    personaBlockZh: '人物卡',
    personaBlockEn: 'Character cards',
    tailBlockZh: '当天正文',
    tailBlockEn: "Today's entry text",
    progressLabel: '全书进度', // 轮 11 判「勉强成立」，不另造词
    unitTagZh: '当天条目',
    unitTagEn: "today's entry",
    outlineBlockZh: '当日要点',
    progressUnitEn: 'days',
    bookLevelZh: '全本',
  },
};

export function quickActionTermsFor(genre: string): PromptTerms {
  return TERMS[workbenchCommandSet(genre)];
}

/** 续写（两句：指令头 + 收尾约束）与润色（整单位润色）的发送文案 */
export interface QuickActionCopy {
  continueIntro: PromptPair;
  continueTail: PromptPair;
  polish: PromptPair;
}

const COPY: Record<GenrePromptVariant, QuickActionCopy> = {
  // novel 三对 = 改造前 `AiAgentPage` :683/:691 的逐字复制（零回归线，测试独立对锁）
  novel: {
    continueIntro: {
      zh: '请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
      en: 'Continue the novel excerpt below. Output the continued prose only: no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    },
    continueTail: {
      zh: '从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。',
      en: 'Seamlessly continue from the tail above for 300-600 words, keeping the same person, tense, and style as the existing text.',
    },
    polish: {
      zh: '请润色下面的整章小说：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量；不得增删情节点；保留原有分段结构。直接输出润色后的全文正文：不要任何解释、对照说明或总结。',
      en: 'Polish the chapter below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information; keep the original paragraph structure. Output the polished full text only: no explanations or summaries.',
    },
  },
  essay: {
    continueIntro: {
      zh: '请为下面的散文片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
      en: 'Continue the essay excerpt below. Output the continued prose only: no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    },
    continueTail: {
      zh: '从上面的末尾无缝接着往下写，顺着这一篇的立意与语气走，写到它自然收束为止。',
      en: 'Keep writing seamlessly from the tail above, following this piece\u2019s theme and voice until it closes naturally.',
    },
    polish: {
      zh: '请润色下面的整篇：提升文字表现力（节奏、画面、语感），但**不得改变**立意、素材事实、叙述顺序与信息量；不得增删内容；保留原有分段结构。直接输出润色后的全文：不要任何解释、对照说明或总结。',
      en: 'Polish the piece below: improve prose quality (rhythm, imagery, diction) but do **not** change the theme, factual material, narrative order, or information; do not add or remove content; keep the original paragraph structure. Output the polished full text only: no explanations or summaries.',
    },
  },
  poetry: {
    continueIntro: {
      zh: '请为下面的诗作续写。直接续写诗句本身：不要任何解释、标题、前言或总结；不要复述已有诗句；不要写「以下是续写」之类的话。',
      en: 'Continue the poem below. Output the continued lines only: no explanations, titles, prefaces, or summaries; do not repeat existing lines.',
    },
    continueTail: {
      zh: '接着上面的末尾往下写，保持分行、节奏与意象系统与已有诗作一致；不必凑字数，该收就收。',
      en: 'Keep writing from the tail above, matching the existing poem\u2019s line breaks, rhythm and imagery; do not pad for length - stop when the poem stops.',
    },
    polish: {
      zh: '请润色下面的整首：只做炼字与节奏微调，但**不得改变**意象系统、分行断点与诗节结构；不得合并或拆散诗节。直接输出润色后的全诗：不要任何解释、对照说明或总结。',
      en: 'Polish the poem below with word-level refinement and rhythm tuning only; do **not** change the imagery system, the line breaks, or the stanza structure - never merge or split stanzas. Output the polished poem only: no explanations or summaries.',
    },
  },
  script: {
    continueIntro: {
      zh: '请为下面的剧本续写。直接续写剧本正文（台词与舞台指示）：不要任何解释、标题、前言或总结；不要复述已有内容。',
      en: 'Continue the script below. Output script text only (dialogue and stage directions): no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    },
    continueTail: {
      zh: '接着上面的末尾往下写，保持人物口吻、对白节奏与舞台指示的行型格式；本场未结束就续写本场，结束了就另起一场。',
      en: 'Continue from the tail above, keeping each character\u2019s voice, the dialogue rhythm and the stage-direction line format; stay in the scene until it ends, then open a new one.',
    },
    polish: {
      zh: '请润色下面的整场：提升台词质感与对白节奏，但**不得改变**情节动作、人物关系、台词信息与舞台调度；保留台词与舞台指示的行型结构。直接输出润色后的全场正文：不要任何解释、对照说明或总结。',
      en: 'Polish the scene below: sharpen dialogue quality and rhythm but do **not** change plot actions, character relations, what the lines convey, or the staging; keep the dialogue / stage-direction line format. Output the polished scene only: no explanations or summaries.',
    },
  },
  diary: {
    continueIntro: {
      zh: '请为下面的日记条目续写。直接续写当天正文：不要任何解释、标题、前言或总结；不要复述已有内容。',
      en: 'Continue the diary entry below. Output the entry\u2019s own text only: no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    },
    continueTail: {
      zh: '接着上面的末尾往下写，保持这一天的口吻与视角，只写当天已知的事，不剧透后来发生的事。',
      en: 'Continue from the tail above in the same day\u2019s voice and viewpoint; write only what that day knows - no hindsight about later events.',
    },
    polish: {
      zh: '请润色下面的当天条目：修正语病、优化句式，但**不得改变**事实记录、时间顺序与情绪基调；不得添加原文没有的事。保留原有分段结构。直接输出润色后的全文：不要任何解释、对照说明或总结。',
      en: 'Polish the diary entry below: fix wording and smooth sentences but do **not** change the recorded facts, their order, or the emotional tone; never add events that are not in the original. Keep the paragraph structure. Output the polished entry only: no explanations or summaries.',
    },
  },
};

export function quickActionCopyFor(genre: string): QuickActionCopy {
  return COPY[workbenchCommandSet(genre)];
}

/* ── ㉞ AI-2b′（2026-11-10 轮 11）：五维诊断与大纲指令按体裁取 ──────────────────
 *
 * 病灶（状态文件 §队列 AI-2b′）：上面 ㉝ 只收了 continue / polish 两对，analyze 的五维模板
 * 与 outline 的五要求正文仍整段写死小说 —— 诗集作者点「五维诊断」，模型收到的是
 * 「维度 1 · 情节破洞」「维度 5 · 伏笔状态」，可伏笔与世界观在 `hiddenViewKindsForGenre` 里
 * ⑮-2 就把诗集 / 散文集 / 日记本裁掉了：**一边不许这栏长出来，一边叫模型去查它**，
 * 与 ㉜ 判过的「一边锁门一边发钥匙」同罪。这一刀把两对收进同一张 Record：五维仍是五维，
 * 但每支问自己那一行事，且维度词不许越过那张页签表（测试拿页签表反查文案）。
 *
 * 组装放在本模块而不是页面里：轮 10 的教训（AU-7 ⑨）是「算好了但没接到行上」——
 * 页面只调一个函数拿一整段成品，测试真调用它取成品串，不给「半接」留缝。
 * novel 五格 = 改造前页面模板字面量的逐字节搬运（组装结果与改造前逐字节相同，测试独立对锁）。
 */

/** 一块诊断维度：标题段 + 正文段（zh 权威；组装时套【维度 N · X】/ [Dimension N · X]） */
export interface DiagnoseDimension {
  title: PromptPair;
  body: PromptPair;
}

/** 五维诊断模板：引子 + 五块维度 + 输出格式与工具纪律（**五维这个数五支都一样**，差的是每支问什么） */
export interface DiagnoseCopy {
  intro: PromptPair;
  dims: DiagnoseDimension[];
  outro: PromptPair;
}

const DIAGNOSE: Record<GenrePromptVariant, DiagnoseCopy> = {
  // novel = 改造前 `AiAgentPage` 那两段模板字面量的逐字节搬运（零回归线；测试独立另存原文对锁）
  novel: {
    intro: { zh: `请按以下五维诊断模板逐维审视本书，并返回结构化报告。`, en: `Please conduct a structured five-dimension writing diagnostic:` },
    dims: [
      { title: { zh: "情节破洞 plotHole", en: "Plot Holes" },
        body: { zh: `- 梳理主线逻辑，检查是否有起因无结果、结果无起因、关键信息前后矛盾、人物动机突变无铺垫。
- 标记：问题简述、涉及章节、严重程度（严重/中等/轻微）、修改建议。`, en: `Review main plot logic for missing causes/results, contradictory info, or unmotivated character turns. Flag each with chapter reference and severity.` } },
      { title: { zh: "人设一致性 characterConsistency", en: "Character Consistency" },
        body: { zh: `- 检查已出场角色在言行、动机、口头禅、关系上的前后一致性。
- 标记：角色名、矛盾章节、与初始人设的差异、修改建议。`, en: `Check whether characters stay consistent in speech, motivation, catchphrase, and relationships across chapters.` } },
      { title: { zh: "叙事节奏 pacing", en: "Pacing" },
        body: { zh: `- 审视各章的「信息密度—情绪起伏—场景切换」节奏，是否出现连续高潮后突然拖慢、或过渡章堆砌说明文。
- 标记：节奏失衡的章节区间、具体症状、修改建议。`, en: `Evaluate chapter-level info-density, emotional arc, and scene transitions for lulls or spikes.` } },
      { title: { zh: "文风漂移 styleDrift", en: "Style Drift" },
        body: { zh: `- 对比开头与最新完稿章节的叙述人称、句式长度、形容词密度、对话风格、幽默/严肃程度，判断是否出现文风突变。
- 标记：漂移方向、典型段落、修改建议。`, en: `Compare narrative voice, sentence length, adjective density, and tone between the opening and the latest completed chapter.` } },
      { title: { zh: "伏笔状态 foreshadowingCheck", en: "Foreshadowing Status" },
        body: { zh: `- 列出全书已埋伏笔及其当前回收状态（待收/已收/可能丢失）；检查是否有伏笔被重复利用或遗漏。
- 标记：伏笔标题、埋设章、计划/实际回收章、状态评估。`, en: `List planted hooks and their payoff state (pending / paid-off / possibly lost).` } },
    ],
    outro: { zh: `输出格式：
1. 先给一页「诊断摘要」：各维度评分（1-10）+ 最优先修复的 3 项。
2. 再逐维展开具体发现，每项含：章节、原文摘要、问题描述、修改建议。
3. 如需查阅其他章节正文或角色卡，可调用 list_chapters、read_chapter、read_character_card。
4. 谈「文风 / 句式 / 用词」时要给出示例，必须先调用 search_corpus 查作者自己的语料库；
   查不到就直说没有，**绝不可自己编一句当作参考示例**。
5. 需要修订人设 / 世界观卡时调用 update_character_card：只传你确实要改的字段（未传的字段保持原样），
   登记别名一律用 add_aliases。卡上的性格、经历、关系**只能写作者给过的、或正文可证的**，
   不得自行补全；该操作需作者审批，作者拒绝后不要重复提交同一改动。`, en: `Output: one-page summary with scores, then chapter-by-chapter findings.
If you need to read other chapter text or character cards, call list_chapters / read_chapter / read_character_card.
When discussing style, phrasing or diction you MUST ground any example in the author's own library via
search_corpus; if nothing matches, say so plainly - never invent example lines.
5. To revise a character / worldview card call update_character_card: pass ONLY the fields you really
mean to change (anything omitted keeps its current value) and always register alternative names via
add_aliases. Never invent traits, backstories or relations - write only what the author supplied or
what the manuscript proves. The author must approve the write; if they decline, do not retry it.` },
  },
  // 散文集：小说的「情节破洞」「伏笔状态」整块撤下 —— essay 在 `hiddenViewKindsForGenre` 里
  // 就被裁掉了 storylines / foreshadowing，一边不长这栏一边叫模型去查它是 ㉜ 判过的自相矛盾。
  // 补上的两维是散文真正会坏的地方：**立意换轨**与**素材真实**（后者防的是模型替作者补经历）。
  essay: {
    intro: { zh: `请按以下五维诊断模板逐维审视这部散文集，并返回结构化报告。`, en: `Please conduct a structured five-dimension diagnostic of this prose collection:` },
    dims: [
      { title: { zh: "立意换轨 thesisDrift", en: "Intent Drift" },
        body: { zh: `- 各篇的立意是否指向同一个问题域；有没有写到一半换了轨、结尾却没把话收回来。
- 标记：篇目、篇内原立意、漂移后的说法、修改建议。`, en: `Check whether each piece keeps to the intent it opens with, or changes track halfway and never closes the thought. Flag the piece and the sentence where it turns.` } },
      { title: { zh: "素材真实 materialTruth", en: "Factual Material" },
        body: { zh: `- 散文写的是真人事：检查所记的人、地、物、引语在全书内是否自相矛盾，有没有为成文而补写出来的经历感。
- 标记：篇目、可疑句、与哪一处相矛盾、修改建议（**只提疑点，不要替作者编一段真的**）。`, en: `Prose records real people and events: weigh the recorded people, places, objects and quotations against one another inside the book, and flag passages that read like supplied memory. Name the piece and the sentence - never invent a substitute memory yourself.` } },
      { title: { zh: "结构节奏 structurePacing", en: "Structure And Pacing" },
        body: { zh: `- 各篇的起笔方式、铺排手法、收尾姿势是否千篇一律（篇篇以景起、篇篇以悟收就是病）；单篇内部的松紧。
- 标记：篇目区间、症状（雷同 / 失衡）、修改建议。`, en: `Look for the same opening move, the same arrangement and the same closing gesture in piece after piece, and for slack or rushed stretches inside one piece. Flag the affected pieces and name the symptom.` } },
      { title: { zh: "文风漂移 voiceDrift", en: "Voice Drift" },
        body: { zh: `- 对比早期与最新完稿篇目的叙述人称、句子长短、形容词密度、口语与书面语域的比例，判断是否换了笔性。
- 标记：漂移方向、典型段落、修改建议。`, en: `Compare narrative person, sentence length, adjective density and the spoken / written balance between the earliest and the latest finished piece, and judge whether the hand has changed. Flag the direction with example paragraphs.` } },
      { title: { zh: "篇目编排 sequencing", en: "Order Of The Whole" },
        body: { zh: `- 全书篇目的先后是否自有其意（时间、主题、情绪的递进）；有无同类题材扎堆、强弱倒置、把最轻的一篇压了尾。
- 标记：建议的编排顺序与理由。**只谈编排，不得改动任何一篇的正文。**`, en: `Judge whether the running order of the collection earns its keep - chronology, subject, emotional build-up - and flag clumped subjects or a strong piece buried mid-book. Propose an order with reasons; do not rewrite any piece.` } },
    ],
    outro: { zh: `输出格式：
1. 先给一页「诊断摘要」：各维度评分（1-10）+ 最优先修复的 3 项。
2. 再逐维展开具体发现，每项含：篇目、原文摘要、问题描述、修改建议。
3. 如需查阅其他篇目正文或人物卡，可调用 list_chapters、read_chapter、read_character_card。
4. 谈「文风 / 句式 / 用词」时要给出示例，必须先调用 search_corpus 查作者自己的语料库；
   查不到就直说没有，**绝不可自己编一句当作参考示例**。
5. 需要修订人物卡时调用 update_character_card：只传你确实要改的字段（未传的字段保持原样），
   登记别名一律用 add_aliases。卡上的性格、经历、关系**只能写作者给过的、或正文可证的**，
   不得自行补全；该操作需作者审批，作者拒绝后不要重复提交同一改动。`, en: `Output format:
1. Open with a one-page diagnostic summary: a score (1-10) per dimension plus the three items to fix first.
2. Then unfold each dimension: for every finding give the piece, a short quotation, the problem, and a suggested fix.
3. To read other pieces or the character cards, call list_chapters / read_chapter / read_character_card.
4. When discussing style, phrasing or diction you MUST ground any example in the author's own library via
   search_corpus; if nothing matches, say so plainly - never invent example lines.
5. To revise a character card call update_character_card: pass ONLY the fields you really mean to change
   (anything omitted keeps its current value) and always register alternative names via add_aliases. Never invent
   traits, backstories or relations - write only what the author supplied or what the manuscript proves. The author
   must approve the write; if they decline, do not retry it.` },
  },
  // 诗集：维度 1 必须是**分行与形式**（诗的本体），且自带「自由诗 / 散文诗不判出格」这一条
  // —— 与 `poetryForms` 的 tone=none 口径同一件事（那边只标注不校验，这里也不许模型去校验）。
  // 「一长三短」明写为体裁常态：`outlierMeaninglessForGenre` 在合集型上判不出信号，prompt 也不许造。
  poetry: {
    intro: { zh: `请按以下五维诊断模板逐维审视这部诗集，并返回结构化报告。`, en: `Please conduct a structured five-dimension diagnostic of this poetry collection:` },
    dims: [
      { title: { zh: "分行与形式 lineationAndForm", en: "Lineation And Form" },
        body: { zh: `- 逐首核对分行、节次与其标定的诗体形式（律绝、词牌、十四行、自由诗…）是否自洽，有无真正出格之处。
- 标记：诗题、所标形式、具体出格处、修改建议。**自由诗与散文诗没有硬约束，一律不判出格。**`, en: `Check each poem's line breaks and stanzas against the form it claims, and flag genuine departures only.
Free verse and prose poems carry no hard constraint - never report them as out of form.` } },
      { title: { zh: "意象系统 imagerySystem", en: "Imagery System" },
        body: { zh: `- 一首之内的意象是否同属一个感官系统（视觉 / 听觉 / 触觉 / 身体），有没有互相拆台或硬接；跨首复现是否有意。
- 标记：诗题、意象、断裂或拆台处、修改建议。`, en: `Within a poem, ask whether the images belong to one sensory system or quietly undercut each other; across the
collection, tell imagery that returns on purpose from imagery that returns by accident.` } },
      { title: { zh: "节奏与长短 rhythmAndLength", en: "Rhythm And Length" },
        body: { zh: `- 各首的建行长短、停顿与跨行的效果、节与节之间的换气；整集连起来读是否还有节拍。
- 标记：诗题、节奏失衡处、修改建议。**一长三短在诗集里是体裁常态，不是缺陷，不要报成问题。**`, en: `Judge line length, caesura and enjambment inside each poem, and the pulse the collection keeps when read
through. A mix of long and short poems is normal for the form - do not report it as a fault.` } },
      { title: { zh: "语汇漂移 dictionDrift", en: "Diction Drift" },
        body: { zh: `- 各首的语汇层级（文言成分 / 白话 / 口语 / 翻译腔）与修辞习惯是否前后一致，有无一首之内雅俗打架。
- 标记：漂移方向、典型句、修改建议。`, en: `Compare the diction level (literary, vernacular, colloquial, translated cadence) and rhetorical habits across
the collection, and flag registers that collide inside a single poem.` } },
      { title: { zh: "重复与自抄 unintendedRepetition", en: "Unintended Repetition" },
        body: { zh: `- 同一句子、同一意象组合、同一种结法在多首里无意识地重复；有意复现的咏叹句不算。
- 标记：涉及各首、重复的片段、修改建议。判「无意」还是「有意」拿不准时写「待作者确认」，不要自行断定。`, en: `Look for the same line, image-cluster or closing gesture recurring across poems without intent; a refrain that
returns deliberately does not count. When intent is unclear, write "author to confirm" instead of deciding for them.` } },
    ],
    outro: { zh: `输出格式：
1. 先给一页「诊断摘要」：各维度评分（1-10）+ 最优先打磨的 3 项。
2. 再逐维展开具体发现，每项含：诗题、原句、问题描述、修改建议。
3. 如需查阅其他诗作正文或人物卡，可调用 list_chapters、read_chapter、read_character_card。
4. 谈「语感 / 用词 / 节奏」时要给出示例，必须先调用 search_corpus 查作者自己的语料库；
   查不到就直说没有，**绝不可自己编一句当作参考示例**。
5. 需要修订人物卡时调用 update_character_card：只传你确实要改的字段（未传的字段保持原样），
   登记别名一律用 add_aliases。卡上的性格、经历、关系**只能写作者给过的、或正文可证的**，
   不得自行补全；该操作需作者审批，作者拒绝后不要重复提交同一改动。`, en: `Output format:
1. Open with a one-page diagnostic summary: a score (1-10) per dimension plus the three items to polish first.
2. Then unfold each dimension: for every finding give the poem, the line, the problem, and a suggested fix.
3. To read other poems or the character cards, call list_chapters / read_chapter / read_character_card.
4. When discussing feel, diction or rhythm you MUST ground any example in the author's own library via
   search_corpus; if nothing matches, say so plainly - never invent example lines.
5. To revise a character card call update_character_card: pass ONLY the fields you really mean to change
   (anything omitted keeps its current value) and always register alternative names via add_aliases. Never invent
   traits, backstories or relations - write only what the author supplied or what the poems prove. The author
   must approve the write; if they decline, do not retry it.` },
  },
  // 剧本：只摘「世界观」一栏（⑮-2），所以**铺垫—呼应这类戏剧本体仍可谈**；节奏那一维
  // 反过来**要求判**——场次体量悬殊在剧本里是真信号（`outlierMeaninglessForGenre` 对 script 为 false）。
  script: {
    intro: { zh: `请按以下五维诊断模板逐维审视这部剧本，并返回结构化报告。`, en: `Please conduct a structured five-dimension diagnostic of this play:` },
    dims: [
      { title: { zh: "冲突回合 conflictTurn", en: "Conflict Turns" },
        body: { zh: `- 逐场核对：谁要什么、谁挡着、拿什么交换、这场结束时得到或失去了什么；有没有只交代信息、没有回合的场。
- 标记：幕场号、双方目标、障碍、结果、修改建议。`, en: `Scene by scene: who wants what, who blocks them, what is traded, what is gained or lost by the end. Flag scenes
that only carry information without a turn.` } },
      { title: { zh: "人物口吻 characterVoices", en: "Character Voices" },
        body: { zh: `- 遮住角色名还能否认出是谁在说话；各人的语汇层级、句子长短、口头禅是否一贯，有无所有人都像作者本人。
- 标记：角色名、串味的台词行、修改建议。`, en: `Cover the character names and ask whether you can still tell who is speaking; check each voice's vocabulary
level, sentence length and catchphrases, and flag anyone who has started sounding like the author.` } },
      { title: { zh: "场面节奏 scenePacing", en: "Scene Pacing" },
        body: { zh: `- 场次长短的分布、静默与爆发的交替、幕内转折的位置；上下半场的重量是否失衡。
- 标记：幕场区间、症状、修改建议。**场次体量悬殊在剧本里是真信号，该判就判。**`, en: `Look at how scene lengths are distributed, how silence and outbreak alternate, and where each act turns. Unlike a
poem collection, an uneven scene length in a play is a real signal - report it.` } },
      { title: { zh: "语域与时代语汇 registerAndPeriodDiction", en: "Register And Period Diction" },
        body: { zh: `- 台词的口语 / 书面程度、时代与地域语汇是否一致，有无古今杂出、现代俚语闯进年代戏。
- 标记：漂移方向、典型句、修改建议。`, en: `Check the spoken / written level of the dialogue and the period and regional vocabulary; flag anachronisms and
registers that collide between characters.` } },
      { title: { zh: "可演性 stageability", en: "Stageability" },
        body: { zh: `- 舞台指示能不能执行（换景时间、道具、音响、上下场路线）；有没有演不出来的心理描写只能靠旁白补。
- 标记：幕场号、不可演之处、可演的改法（台词或调度）。`, en: `Ask whether every stage direction can actually be staged - set-change time, props, sound, entrances and exits -
and flag interior states nobody can act; offer a playable alternative in dialogue or blocking.` } },
    ],
    outro: { zh: `输出格式：
1. 先给一页「诊断摘要」：各维度评分（1-10）+ 最优先修改的 3 项。
2. 再逐维展开具体发现，每项含：幕场号、原文摘要、问题描述、修改建议。
3. 如需查阅其他场次正文或角色表，可调用 list_chapters、read_chapter、read_character_card。
4. 谈「台词说法 / 句式 / 语汇」时要给出示例，必须先调用 search_corpus 查作者自己的语料库；
   查不到就直说没有，**绝不可自己编一句当作参考示例**。
5. 需要修订角色表时调用 update_character_card：只传你确实要改的字段（未传的字段保持原样），
   登记别名一律用 add_aliases。卡上的性格、经历、关系**只能写作者给过的、或正文可证的**，
   不得自行补全；该操作需作者审批，作者拒绝后不要重复提交同一改动。`, en: `Output format:
1. Open with a one-page diagnostic summary: a score (1-10) per dimension plus the three items to fix first.
2. Then unfold each dimension: for every finding give the act and scene, a short quotation, the problem, and a fix.
3. To read other scenes or the character list, call list_chapters / read_chapter / read_character_card.
4. When discussing dialogue, phrasing or diction you MUST ground any example in the author's own library via
   search_corpus; if nothing matches, say so plainly - never invent example lines.
5. To revise the character list call update_character_card: pass ONLY the fields you really mean to change
   (anything omitted keeps its current value) and always register alternative names via add_aliases. Never invent
   traits, backstories or relations - write only what the author supplied or what the script proves. The author
   must approve the write; if they decline, do not retry it.` },
  },
  // 日记：五维全部围着一条铁律转 —— **不得替作者编记忆，也不得替他解释他自己**。
  // 「态度变化」与「后见补写」是日记独有的两道题，小说口径的「情节破洞」对它毫无意义。
  diary: {
    intro: { zh: `请按以下五维诊断模板逐维审视这部日记，并返回结构化报告。`, en: `Please conduct a structured five-dimension diagnostic of this journal:` },
    dims: [
      { title: { zh: "时间与事实 datesAndFacts", en: "Dates And Facts" },
        body: { zh: `- 条目日期与内文所述时间是否自洽；同一个人、同一件事在不同天的说法有无矛盾。
- 标记：日期、两种说法、建议。**只把矛盾摆出来，不得自行断定哪一天是对的。**`, en: `Check each entry's date against the times named inside it, and contradictory accounts of the same person or
event across days. Show the conflict; never decide for the author which day was right.` } },
      { title: { zh: "态度变化 attitudeShift", en: "Shifts In Attitude" },
        body: { zh: `- 对同一个人或同一件事，前后的判断是怎么变的、有无轨迹可循；态度突变之处有没有当天的由头。
- 标记：涉及日期、两次说法、可能的触发点（写成提问，不要写成结论）。`, en: `Trace how the author's judgement of the same person or event shifts across the days, and whether a sudden
reversal has anything in that day to explain it. Phrase any trigger as a question, not a conclusion.` } },
      { title: { zh: "后见补写 retrojection", en: "Hindsight Intrusions" },
        body: { zh: `- 当天的条目里是否混进了后来才知道的结论、评价或事件后续；事后补记与当天原文有没有分开。
- 标记：日期、可疑句、建议（若为事后补记，宜另起一条写，不要改写那一天）。`, en: `Look for conclusions, judgements or later outcomes the author could not have known that day, and for addenda
mixed into the day's own text. Suggest a separate entry rather than rewriting that day.` } },
      { title: { zh: "口吻漂移 voiceDrift", en: "Voice Drift" },
        body: { zh: `- 写给自己看的语气是否逐渐变成给人看的书面腔；省略的主语、只有作者懂的简称是否被改成了通顺的整句。
- 标记：漂移区间、典型句、修改建议。`, en: `Notice when a private voice starts performing for a reader: elided subjects smoothed into full sentences,
private shorthand explained away. Flag the affected stretch with examples.` } },
      { title: { zh: "反复与心结 recurringThreads", en: "Recurring Threads" },
        body: { zh: `- 反复出现的人、地、事与各天里的措辞差异；只描述变化与走向，**不得下心理诊断，不得替作者解释自己**。
- 标记：主题、涉及日期、每次措辞的差异。`, en: `Follow the people, places and subjects that keep returning and how the wording changes each time. Describe the
movement only - do not diagnose the author or explain them to themselves.` } },
    ],
    outro: { zh: `输出格式：
1. 先给一页「诊断摘要」：各维度评分（1-10）+ 最值得回看的 3 处。
2. 再逐维展开具体发现，每项含：日期、原文摘要、问题描述、建议。
3. 如需查阅其他条目正文或人物卡，可调用 list_chapters、read_chapter、read_character_card。
4. 谈「口吻 / 句式 / 用词」时要给出示例，必须先调用 search_corpus 查作者自己的语料库；
   查不到就直说没有，**绝不可自己编一句当作参考示例**。
5. 需要修订人物卡时调用 update_character_card：只传你确实要改的字段（未传的字段保持原样），
   登记别名一律用 add_aliases。卡上的性格、经历、关系**只能写作者给过的、或正文可证的**，
   不得自行补全；该操作需作者审批，作者拒绝后不要重复提交同一改动。`, en: `Output format:
1. Open with a one-page summary: a score (1-10) per dimension plus the three stretches worth re-reading.
2. Then unfold each dimension: for every finding give the date, a short quotation, what it shows, and a suggestion.
3. To read other entries or the character cards, call list_chapters / read_chapter / read_character_card.
4. When discussing voice, phrasing or diction you MUST ground any example in the author's own library via
   search_corpus; if nothing matches, say so plainly - never invent example lines.
5. To revise a character card call update_character_card: pass ONLY the fields you really mean to change
   (anything omitted keeps its current value) and always register alternative names via add_aliases. Never invent
   traits, backstories or relations - write only what the author supplied or what the entries prove. The author
   must approve the write; if they decline, do not retry it.` },
  },
};

/** 本支的五维诊断模板（判据 = `workbenchCommandSet`，未设/脏值落小说格） */
export function quickActionDiagnoseFor(genre: string): DiagnoseCopy {
  return DIAGNOSE[workbenchCommandSet(genre)];
}

/**
 * 组装五维诊断正文。**组装放在本模块而不是页面里**：㉞ 反证的教训是「算好了但没接到行上」
 * —— 页面只调一个函数、拿一整段成品，就没有「拿错一块」的空间；测试也能真调用它取到成品串。
 * novel 的组装结果与改造前页面里那段模板字面量**逐字节相同**（块间 `\n\n`、维度内 `\n`）。
 */
export function buildAnalyzePrompt(genre: string): string {
  const c = quickActionDiagnoseFor(genre);
  const blocks = c.dims.map((d, i) =>
    L(`【维度 ${i + 1} · ${d.title.zh}】\n${d.body.zh}`, `[Dimension ${i + 1} · ${d.title.en}]\n${d.body.en}`),
  );
  return [L(c.intro.zh, c.intro.en), ...blocks, L(c.outro.zh, c.outro.en)].join('\n\n');
}

/** 大纲 / 编排指令（五要求正文；键集同样 = `workbenchCommandSet` 值集，编译期穷尽） */
const OUTLINE: Record<GenrePromptVariant, PromptPair> = {
  // novel = 改造前页面里那一对字符串的逐字搬运（零回归线）
  novel: { zh: `请为当前小说生成或优化章节大纲。\n\n要求：\n1. 梳理已有章节的起承转合，确保情节推进合理\n2. 为未完成的章节提供详细的细纲（含场景、人物、关键对话）\n3. 检查大纲中是否存在节奏失衡、伏笔遗漏或逻辑断层\n4. 保持与前文章节风格一致，避免突兀的题材转换\n5. 以结构化列表形式输出，每章含：标题、核心目标、场景清单、人物出场、情绪基调`, en: `Please generate or optimize the chapter outline for the current novel.\n\nRequirements:\n1. Map the existing chapters' rising action and transitions, ensuring logical plot progression\n2. Provide detailed sub-outlines for unfinished chapters (including scenes, characters, key dialogues)\n3. Check for pacing imbalances, missing foreshadowing, or logical gaps\n4. Maintain consistency with previous chapters' style, avoiding abrupt genre shifts\n5. Output as a structured list: each chapter with title, core objective, scene list, characters present, emotional tone` },
  essay: { zh: `请为当前散文集梳理或优化全书编排。\n\n要求：\n1. 梳理已有篇目的立意线索，看它们是否指向同一个问题域\n2. 为记了构思还没成文的篇目补出细纲（要写的人事物、生发的意思、结构打算）\n3. 检查编排上有没有同类题材扎堆、强弱倒置，以及单篇内部的松弛\n4. 保持各篇已有的语感，不要替作者把口语改成书面腔\n5. 以结构化列表输出，每篇含：标题、立意、素材来源、结构打算、预计篇幅`, en: `Please map or refine the running order of this prose collection.\n\nRequirements:\n1. Trace the intent running through the existing pieces and say whether it is one question or several\n2. Draft a plan for the ideas recorded but not yet written (people and things to write, the thought they open, the shape planned)\n3. Check the order for clumped subjects and buried strong pieces, and slack inside single pieces\n4. Keep each piece's existing voice - never smooth a spoken register into formal prose\n5. Output a structured list: each piece with title, intent, source material, planned shape, expected length` },
  poetry: { zh: `请为当前诗集梳理或优化整本编排。\n\n要求：\n1. 梳理已有诗作的形式分布与意象系统，看整本是否有一条内在的线\n2. 为记了意象还没成文的诗补出细纲（要用的意象、打算标定的形式、分行打算）\n3. 检查重复与自抄：同一句子、同一意象组合、同一种结法在多首里无意识地出现（有意复现的咏叹不算）\n4. 长短悬殊是诗集的常态，不要为了整齐去拉平任何一首\n5. 以结构化列表输出，每首含：诗题、所标形式、意象系统、分行打算、在整本里的位置`, en: `Please map or refine the running order of this poetry collection.\n\nRequirements:\n1. Review the forms and imagery systems already present and say whether the collection has an inner line\n2. Draft a plan for imagery recorded but not yet written (images to use, form to claim, lineation intended)\n3. Check for unintended repetition: the same line, image-cluster or closing gesture across poems (a deliberate refrain does not count)\n4. Long and short poems side by side is normal for the form - never level a poem for the sake of tidiness\n5. Output a structured list: each poem with title, claimed form, imagery system, lineation plan, place in the whole` },
  script: { zh: `请为当前剧本梳理或优化幕场结构。\n\n要求：\n1. 梳理已有场次的冲突回合，看主线是否一场一步往前\n2. 为记了梗概还没写的场补出细纲（谁要什么、谁挡着、拿什么交换、结束时得到或失去什么）\n3. 检查只交代信息没有回合的场、节奏失衡的区间、以及铺垫与呼应的断线\n4. 保持各人已有的台词口吻，不要把所有人物改成同一种说法\n5. 以结构化列表输出，每场含：幕场号、时间与地点、在场人物、冲突回合、结束状态`, en: `Please map or refine the act and scene structure of this play.\n\nRequirements:\n1. Review the conflict turns already written and say whether the through-line moves one scene at a time\n2. Draft a plan for scenes outlined but not yet written (who wants what, who blocks them, what is traded, what is left at the end)\n3. Check for scenes that only carry information, pacing that sags, and set-ups whose payoffs never arrive\n4. Keep each character's existing voice - never flatten everyone into one way of speaking\n5. Output a structured list: each scene with act/scene number, time and place, characters present, conflict turn, closing state` },
  diary: { zh: `请为当前日记梳理条目安排。\n\n硬线（日记的身份就是记录，编一次就废了）：\n1. 只根据已有条目、素材与要点提建议，**不得替作者编造那几天发生了什么**；线索不足就直说线索不足\n2. 梳理时间线：哪些日子记了、记的是什么；空着的日子只当事实列出，空着不是缺陷\n3. 标出前后矛盾的说法与疑似事后补记的句子，但不得自行断定哪一天是对的\n4. 保持各天当天的口吻与视角，建议里不要出现后来才知道的结论\n5. 以结构化列表输出，每条含：日期、当天已记的事、还可以往下写的线索`, en: `Please review the arrangement of this journal.\n\nHard lines (a journal's whole value is that it recorded):\n1. Suggest only from what is already in the entries, notes and day summaries - **never invent what happened on a given day**; if the clues are not enough, say so\n2. Map the timeline: which days are written and about what. List the empty days as fact - an empty day is not a defect\n3. Mark contradictory accounts and lines that read like later addenda, without deciding which day was right\n4. Keep each day's own voice and knowledge; suggest nothing that depends on later events\n5. Output a structured list: each entry with date, what that day already records, what it could still grow into` },
};

/** 组装大纲指令成品（同上：页面只拿整段，不给「半接」留缝） */
export function buildOutlinePrompt(genre: string): string {
  const p = OUTLINE[workbenchCommandSet(genre)];
  return L(p.zh, p.en);
}

/* ── ㉠ AI-2b″（2026-11-10 轮 13）：角色设定诊断指令按体裁取 ──────────────────
 *
 * 病灶（状态文件 §队列 AI-2b″）：character 卡点下去发的那句自 ㉝ 起就整段写死小说 ——
 * 「反派动机不足 / 配角脸谱化 / 成长弧线 / 与主线的关联度」各 ×1，而角色卡对**五种载体都可见**
 * （`aiQuickActionVisible` 没裁 characters，`hiddenViewKindsForGenre` 也没裁）：诗集作者问角色
 * 诊断，模型被要求去找「反派」；日记作者问一句，模型会被要求「为角色设计口头禅」——那是替作者
 * 编人。与 ㉝/㉞ 判过的是同一族：**发出去的话顶着另一种载体的语法**。
 *
 * 四支各问各的（措辞全部取现成口径）：
 *  - 散文写的是**真实的人事**（`writing.essay.*` 与 DIAGNOSE·素材真实 同一条硬线：不得补写记忆）；
 *  - 诗的本体是**说话的声音与意象**（「没有人设卡是体裁常态」= `writingContextProvider:233` 那条）；
 *  - 剧本的角色表是**正式构成**（⑮-2），要什么/谁挡着/结果 与 DIAGNOSE·冲突回合 同一口径；
 *  - 日记里的人以**那天在场**的身份出现（`writingSchema:258` 注释），不下心理诊断、不替作者解释他自己
 *    （DIAGNOSE·反复与心结 同一条线）。
 * novel 格 = 改造前 `AiAgentPage:747` 那一对字面量的逐字节搬运（零回归线，测试独立对锁）。
 */
const CHARACTER: Record<GenrePromptVariant, PromptPair> = {
  novel: {
    zh: '请为当前作品进行角色设定诊断与优化。\n\n要求：\n1. 分析现有角色塑造深度：动机层次、性格多面性、成长弧线\n2. 检查角色关系网的密度与张力，标记冗余或孤立角色\n3. 为角色设计标志性语言风格（口头禅、句式偏好、修辞特征）\n4. 评估角色与主线的关联度，给出「合并/删除/强化」建议\n5. 如有空白领域（反派动机不足、配角脸谱化），提出新角色或深化方案\n6. 输出形式：角色卡表格 + 关系拓扑图（文字版）',
    en: 'Please diagnose and optimize character development for the current work.\n\nRequirements:\n1. Analyze existing character depth: motivation layers, personality facets, growth arcs\n2. Check character relationship network density and tension; flag redundant or isolated characters\n3. Design signature speech patterns (catchphrases, sentence preferences, rhetorical features)\n4. Evaluate character relevance to main plot; suggest merge / remove / strengthen actions\n5. Identify weak areas (e.g., under-motivated antagonist, stereotyped side characters) and propose new or deepened solutions\n6. Output format: character card table + relationship topology (text-based)',
  },
  essay: {
    zh: '请对这部散文集所写的人物做一次诊断。\n\n硬线（散文写的是真实的人事）：\n1. 只依据已有篇目与人物卡里写过的事迹说话，**不得替作者补写记忆**；素材不足就直说不足\n2. 同一个人跨篇出现时，称谓、关系与所记细节是否前后一致；只把矛盾摆出来，不得断定哪一篇写得对\n3. 作者落到各人身上的笔墨与态度随篇有无转变，说出转变起于哪一篇，写成提问而不是结论\n4. 人物在这里量的是**写得准不准、像不像本人、细节站不站得住**；不得为增强可读性改动所记的事实\n5. 不得虚构篇目里没有的经历、对话或心理，也不得替作者补足他没写的判断\n6. 输出形式：人物清单（各出现在哪几篇）＋前后矛盾处＋可回问作者的线索清单',
    en: 'Please diagnose the people written about in this prose collection.\n\nHard lines (prose records real people and events):\n1. Speak only from what the existing pieces and character cards record - **never supply a memory for the author**; if the material is not enough, say so\n2. Where the same person appears across pieces, check names, relations and recorded details for consistency; show contradictions without deciding which piece was right\n3. Trace how the author\'s touch and judgement of each person shift across the pieces and name the piece where it turns - as a question, not a conclusion\n4. What counts here is **whether the portrait is accurate, recognizable and supported by details**; never alter a recorded fact for readability\n5. Never invent experiences, dialogues or thoughts the pieces do not contain, and do not complete judgements the author left unwritten\n6. Output format: a person list (which pieces each appears in) + contradictions + questions worth putting back to the author',
  },
  poetry: {
    zh: '请对这部诗集里出现的人与说话的声音做一次诊断。\n\n要求：\n1. 诗集没有人设卡是体裁常态，不是缺陷：卡为空就只谈诗作本身，**不得建议作者先补卡**\n2. 逐首辨「说话的人」：抒情者的身份、人称与语气是否稳定，有无这一首与那一首的声音互相串味\n3. 诗里出现的人（赠诗的对象、回忆里的人）跨首出现时，称呼与身份是否前后一致；有矛盾只摆出来\n4. 落在人身上的**意象立不立得住**是本裁；不做动机分析，也不要求人物有发展轨迹\n5. 不得虚构诗里没有写过的人与事，不得替作者指认「这人是谁」\n6. 输出形式：各首说话者一览＋出现人物的称呼对照＋可疑处清单',
    en: 'Please diagnose the people and the speaking voices in this poetry collection.\n\nRequirements:\n1. A poetry collection without character cards is normal for the form, not a defect: if the cards are empty, speak only of the poems - **never advise creating cards first**\n2. Poem by poem, identify who is speaking: check whether the speaker\'s identity, person and tone stay stable, and flag voices bleeding into one another\n3. People who appear in poems (the addressee, someone remembered) should keep consistent names and identities across poems; show any conflict\n4. Judge whether the **imagery laid on a person holds up**; do not run motivation analysis or demand a development arc\n5. Never invent people or events the poems do not contain; do not tell the author who a person "really" is\n6. Output format: an overview of each poem\'s speaker + a name concordance of recurring people + a list of doubtful spots',
  },
  script: {
    zh: '请对这个剧本的角色表做一次诊断，并给出优化建议。\n\n要求：\n1. 逐人核对这出戏：他要什么、谁挡着、拿什么交换、结束时得到或失去了什么；只挂名不上场的空人标出来\n2. 遮住角色名读台词：各人的语汇层级、句子长短、口头禅能不能分得清是谁在说话，标记串味之处\n3. 核对角色表与各场正文：表里立了人却全程没台词没调度、正文里有戏却没进表，两种都要点名\n4. 增删合并只以**戏需不需要**为准，并给出合并后哪一个冲突回合会接不上\n5. 卡上的性格、经历、关系只能写作者给过的、或台词与舞台指示可证的，不得自行补全\n6. 输出形式：角色体检表（要什么 / 障碍 / 结果 / 出场场次）＋台词串味处＋关系拓扑图（文字版）',
    en: 'Please diagnose the cast sheet of this play and suggest fixes.\n\nRequirements:\n1. Person by person: what do they want in this play, who blocks them, what is traded, what is gained or lost by the end; flag anyone listed who never comes on stage\n2. Cover the character names and read the dialogue: check that each voice is distinguishable by vocabulary level, sentence length and catchphrases; flag lines that sound alike\n3. Cross-check the cast sheet against the scenes: people listed who never get a line or a move, and people with stage business who are missing from the sheet\n4. Add, merge or cut only what **the play needs**, and name which conflict turn would break if a merge went ahead\n5. Traits, backstories and relations on a card may only come from what the author supplied or what dialogue and stage directions prove - never complete them yourself\n6. Output format: a cast check table (want / obstacle / outcome / scenes) + indistinguishable dialogue + relationship topology (text-based)',
  },
  diary: {
    zh: '请对这本日记里反复出现的人物做一次梳理式诊断。\n\n硬线（日记的身份就是记录，编一次就废了）：\n1. 只依据已有条目与人物卡里写过的事迹说话，**不得替作者补写那几天发生的事**，不得给人物编造动机与前史\n2. 同一个人不同天的称呼与判断是否一致；有矛盾只摆出来，不得断定哪一天的说法作准\n3. 作者对同一个人的态度随日期有无转变，指出起止日期，写成提问而不是结论\n4. 日记里的人是以「那天在场」的身份出现的：不要求先立卡再写，不下心理诊断，**不得替作者解释他自己**\n5. 列出提到次数多却还没有人物卡的人，只当「可选择建档」的提示，不是缺陷清单\n6. 输出形式：人物出现的日期表＋前后态度对照＋待作者确认的疑问清单',
    en: 'Please review the people who recur in this journal.\n\nHard lines (a journal\'s whole value is that it recorded):\n1. Speak only from what the entries and character cards already record - **never invent what happened on a day**, and never fabricate a person\'s motive or past\n2. Check whether the same person is named and judged consistently across days; show conflicts without deciding which day was right\n3. Trace how the author\'s attitude to the same person shifts over the dates, give the start and end dates, and phrase it as a question\n4. People in a journal appear as they were **present that day**: do not ask for cards before writing, do not diagnose anyone psychologically, and never explain the author to himself\n5. List the most-mentioned people who still have no card as an optional offer to create one - not as a defect list\n6. Output format: a date table of appearances + attitude shifts side by side + questions for the author to confirm',
  },
};

/** 组装角色诊断指令成品（同上：页面只拿整段，不给「半接」留缝） */
export function buildCharacterPrompt(genre: string): string {
  const p = CHARACTER[workbenchCommandSet(genre)];
  return L(p.zh, p.en);
}
