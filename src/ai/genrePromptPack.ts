/**
 * genrePromptPack —— 提示词层的体裁单一事实源（AI-1-1，轮 32 ㉕）。
 *
 * 病灶（v3 §3 / 提示词按题材分层方案 §0-§2）：判据真源早在 `writingSchema` 建齐，
 * 提示词层却自己写了 4 个布尔 + 同一套 if 链在 6 处各抄一遍。链条漏一支不报错、
 * 静默掉进小说兜底——剧本 2026-11-09 开闸时真掉过（模型收到「你是**网文写手**…800～2000 字」，
 * 会把一出戏排成散文段落）。这是本仓第一病灶「真源分身」在提示词层的形态。
 *
 * 本表的三条纪律（每条堵一次已经付过学费的错）：
 *  ① **穷尽**：`Record<GenrePromptVariant, GenrePromptPack>` 漏一体裁 = 编译不过，
 *     「补一支 if」从纪律变成机制；
 *  ② **表内不判定**：本文件内不许出现 `genre === 'poetry'` 这类字面判断——表键就是体裁，
 *     判据归 `writingSchema.workbenchCommandSet`（含未设/脏值 → novel 的唯一兜底）；
 *     槽位只回答「这个体裁**怎么说**」；
 *  ③ **兜底只在入口一次**：`genrePromptPack()` 之外不许再写 `?? 小说` 二重兜底。
 *
 * AI-1-1 是**结构塌平**：五套内容照抄现状文案（含在册欠账——essay 的续写指令头今天
 * 领的还是小说那句「请为下面的小说片段续写」，A-3 在册，刀 2 补语义时只改这张表的
 * essay 格，调用点零改动）。novel 全槽 = 改造前逐字（零回归线，golden 快照 + 本文件
 * 测试的独立对锁双保险）。
 *
 * 载体口径沿用 `aiLang.L` 惯例：发给模型读的正文走代码内联双语（zh 权威），不进 UI 语言包。
 * 快捷动作域（`/ai` 六卡点下去发的那句话）的既有表在 `quickActionPrompts.ts`，
 * 那是本表的前一块地基（㉝ 注释自认）；两表分工：那边管 /ai 卡，本表管写作台内联
 * （writingAssistant / writingMaterial）与工作台书场景快捷动作（workbench 节，P14）。
 */
import { workbenchCommandSet } from '../utils/writingSchema';
import type { GenrePromptVariant, PromptPair } from './quickActionPrompts';

/** 续写体量行：给了目标字数 / 没给 两种形状（novel 与 essay 今天共用同一对，见上注）。 */
export interface ContinueWordsPack {
  withTarget: (targetWords: number) => PromptPair;
  plain: PromptPair;
}

/** 资料辅助创作（素材库）的体裁判据位（writingMaterial 两条链的全部变化点）。 */
export interface MaterialPromptPack {
  /** 资料分析「给谁用」的落点名词（只换名词，六条维度是 S21 欠账不在本刀） */
  digestNoun: { zh: string; enWrite: string; enFocus: string };
  /** 生稿：已有正文时那一行标签（含换行，逐字现状） */
  draftTailLabel: PromptPair;
  /** 生稿：没有正文时的空态整句（逐字现状） */
  draftTailEmpty: PromptPair;
  /** 生稿：目标单位那一行标签 */
  draftTargetLabel: PromptPair;
  /** 生稿：完整指令正文（谁在写 × 排成什么形状 × 多长算正常） */
  draftPrompt: PromptPair;
}

/**
 * 工作台书场景快捷动作（P14，轮 32）。chip 的**标签**走 i18n 槽位（`SurfaceSlot:
 * 'chipUnderstand'`），这里放的是**点下去发出去的那句话**——与㊽「入口该不该亮」同一族，
 * 那一轮管亮不亮，本刀管说的话别顶着「章节 / 人设卡与世界观设定」的小说腔。
 * novel 五槽 = `workbenchPanelHooks.quickAction` 改造前逐字（零回归线）。
 */
export interface WorkbenchActionPack {
  /** book-understand：读懂当前正文单位 */
  understand: (unitRef: string) => PromptPair;
  /** book-consistency：单位内一致性审查（对照物按体裁换：世界观只有小说有） */
  consistency: (unitRef: string) => PromptPair;
  /** book-plot：情节/呼应连贯（入口已按 storylines 可见性裁亮；剧本保留「情节/伏笔」现名——轮 30 在册决定） */
  plot: PromptPair;
  /** book-explain-sel：选区解释的引导句（正文块由调用方拼在后面） */
  explainSel: PromptPair;
  /** book-polish：选区润色的引导句（同上） */
  polishSel: PromptPair;
}

/**
 * 写作台 ask 支的身份槽（AI-1-3，轮 32 ㉕ 续）——真源换自 `workbenchContext.personaWords`，
 * 四支判据 + 小说兜底整条搬进表，**文案逐字未动**。refs 是这一族里唯一真正的口径槽：
 * 世界观只有小说有、剧本要读角色表与幕场结构、日记要读条目本身。让诗集模型去找
 * 「人设卡 / 世界观设定」，它只会回一句「建议先补人设卡」——那句对写诗的人完全无效。
 */
export interface PersonaPack {
  /** 「你是一个{X}写作助手」的载体名词（en 侧接 `-writing assistant`） */
  noun: PromptPair;
  /** 「可以对照{X}给出建议」的对照物（换成该体裁真正具备的那几样） */
  refs: PromptPair;
  /**
   * agent 支（写作代理助手）专用对照物。与 `refs` 分开的原因：agent 指令原文用**斜杠括号版**
   * 「（人设卡 / 世界观设定 / 全书结构）」，与 ask 支的**顿号版**标点不同（表注释 A-4 点名警告：
   * 一处词表套两支会偷改小说原文）。novel 逐字保持斜杠原文（零回归），其余体裁填本体裁对照物。
   */
  agentRefs: PromptPair;
}

/**
 * ㉴（轮 35 · AU-1）自动化项键 —— 值 = 写作台模块（`writing-book`）的 presets key。
 *
 * 这个并集就是「可被自动编排调度的条目」本体。新增预设若忘了在这里登记，
 * 编译不会拦（preset 的 key 只是 string），所以配了「自动化项 ↔ 预设表」一致性测试
 * 当牙——与「页签表 ↔ 创建闸口同源」「提示词槽位 ↔ 穷尽 Record」同一族护栏。
 */
export type AutomationItemKey =
  | 'character-consistency'
  | 'plot-review'
  | 'emotional-intensity'
  | 'ai-flavor'
  | 'pacing-tension'
  | 'logical-continuity';

/**
 * ㉴ 自动化层白名单槽（v3 §6-A / 提示词按题材分层 §3 刀 4）。
 *
 * 粒度是**整卡**：meaningless = 本体裁的自动轮转不取它；规则若点名锁到它，
 * 编排按 reason=genre-irrelevant 记一笔「按体裁跳过」——表外项不跑**并且要说**
 * （静默少跑=失败，本仓口径：不解释的省略会被当成坏了）。
 * 每一格的裁剪理由都派生自 writingSchema 的既有判据（hiddenViewKindsForGenre /
 * outlierMeaninglessForGenre / characterCardsOptionalForGenre）——判据仍归 schema，
 * 本槽只申报「这个体裁的自动化该跑哪几卡」；表与判据漂开由推导锁测试拦。
 */
export interface GenreAutomationPack {
  /** 本体裁仍适用的自动分析项（自动轮转的取项池） */
  meaningful: AutomationItemKey[];
  /** 本体裁不适用的项：不跑，并且要说 */
  meaningless: AutomationItemKey[];
}

/** 一个体裁在提示词层的全部说法（写作台五动作 + 素材两动作 + 工作台五动作 + ask 身份 + 自动化白名单）。 */
export interface GenrePromptPack {
  /** 【当前X】那一行的前缀（zh 含括钩；en 含尾随空格），调用方拼 chapterTitle */
  unitLabel: PromptPair;
  /** 续写指令头 */
  continueHead: PromptPair;
  continueWords: ContinueWordsPack;
  /** 整篇润色 */
  polishWhole: PromptPair;
  /** 整篇改写 */
  rewriteWhole: PromptPair;
  /** 整篇总结 */
  summarizeWhole: PromptPair;
  /** 逐句审校：正文单位名词（「请对下面的{X}文本做逐句语法审校」） */
  reviewUnitNoun: PromptPair;
  /** 逐句审校：第 5 条体裁豁免（novel/essay 今天没有第 5 条 = 空串） */
  reviewExemptRule: PromptPair;
  material: MaterialPromptPack;
  workbench: WorkbenchActionPack;
  /** 写作台 ask 支「你是谁 / 能对照什么」（原 personaWords，逐字搬运） */
  persona: PersonaPack;
  /** ㉴ 自动化层整卡白名单（AU-1：表外项不跑且要说） */
  automation: GenreAutomationPack;
}

export const GENRE_PROMPT_PACKS: Record<GenrePromptVariant, GenrePromptPack> = {
  novel: {
    // ㉴ AU-1：小说全跑——它今天就是自动化口径的基准，其余四支都是从它分叉出去的。
    automation: {
      meaningful: ['character-consistency', 'plot-review', 'emotional-intensity', 'ai-flavor', 'pacing-tension', 'logical-continuity'],
      meaningless: [],
    },
    persona: {
      noun: { zh: '小说', en: 'fiction' },
      refs: { zh: '人设卡、世界观设定与全书结构', en: 'character cards, worldbuilding and the book structure' },
      agentRefs: { zh: '人设卡 / 世界观设定 / 全书结构', en: 'character cards / worldbuilding / book structure' },
    },
    unitLabel: { zh: '【当前章节】', en: '[Current Chapter] ' },
    continueHead: {
      zh: '请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
      en: 'Continue the novel excerpt below. Output the continued prose only: no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    },
    continueWords: {
      withTarget: (n) => ({
        zh: `从上面的末尾无缝接着往下写约 ${n} 字，保持人称、时态、文风与已有内容一致。`,
        en: `Seamlessly continue from the tail above for about ${n} words, keeping the same person, tense, and style as the existing text.`,
      }),
      plain: {
        zh: '从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。',
        en: 'Seamlessly continue from the tail above for 300-600 words, keeping the same person, tense, and style as the existing text.',
      },
    },
    polishWhole: {
      zh: '请润色下面的整章小说：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量；不得增删情节点；保留原有分段结构。直接输出润色后的全文正文：不要任何解释、对照说明或总结。',
      en: 'Polish the chapter below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information; keep the original paragraph structure. Output the polished full text only: no explanations or summaries.',
    },
    rewriteWhole: {
      zh: '请改写下面的整章小说：在**保留情节、人物行为、时间线与全部信息量**的前提下，重构表达——允许调整句式长短、段落切分、叙事节奏与措辞，让文字更有张力与可读性。**不要**增删故事事实；保留原有分段结构。直接输出改写后的全文正文：不要任何解释、对照说明或总结。',
      en: 'Rewrite the chapter below: keep **all plot, character actions, timeline, and information**, but restructure the prose — you may adjust sentence length, paragraph breaks, pacing, and wording to make it more vivid and readable. Do **not** add or remove story facts; keep the original paragraph structure. Output the rewritten full text only: no explanations, comparisons, or summaries.',
    },
    summarizeWhole: {
      zh: '请总结本章小说：提炼本章发生的情节、人物动向与关键推进（每小节要点式列出），控制在 400 字以内。只总结本章内容，不要补充本章之外的情节，不要评价文笔。',
      en: 'Summarize this chapter: list what happens, character developments, and key plot progress (bullet-style), within 400 characters. Cover only this chapter; do not add events outside it, do not judge the writing.',
    },
    reviewUnitNoun: { zh: '小说', en: 'novel' },
    reviewExemptRule: { zh: '', en: '' },
    material: {
      digestNoun: { zh: '小说', enWrite: 'fiction', enFocus: 'fiction' },
      draftTailLabel: { zh: '【目标章已有正文】\n', en: '[Existing chapter text]\n' },
      draftTailEmpty: {
        zh: '【目标章正文】本章还没有正文，请从开头直接展开。',
        en: '[Chapter text] This chapter has no content yet; start from the beginning.',
      },
      draftTargetLabel: { zh: '【目标章节】', en: '[Target chapter] ' },
      draftPrompt: {
        zh:
          '你是一位网文写手。请根据下面的【资料分析】与【目标章信息】，为指定章节生成正文草稿。\n' +
          '要求：\n' +
          '1. 直接输出正文本身，不要输出标题、解释、前言或结尾说明；\n' +
          '2. 与已有正文的文风、视角、人称保持一致，自然衔接，不要重复已有内容；\n' +
          '3. 充分使用资料分析中的素材，但不要生硬堆砌术语；\n' +
          '4. 分成自然段落，单段不要太长；\n' +
          '5. 字数控制在 800～2000 字左右（根据情节需要自然增减）。',
        en:
          'You are an online-fiction writer. Based on the [material digest] and [target chapter info] below, write the draft of the target chapter.\n' +
          'Requirements:\n' +
          '1. Output only the prose itself; no titles, explanations, preambles or closing notes;\n' +
          '2. Keep consistent voice, POV and tone with existing text; continue naturally without repeating it;\n' +
          '3. Use the digest material substantially, but do not stuff in jargon mechanically;\n' +
          '4. Write in natural paragraphs, avoiding overly long ones;\n' +
          '5. Aim for around 800–2000 characters (adjust naturally to the plot).',
      },
    },
    workbench: {
      understand: (p) => ({
        zh: `请读懂章节 ${p}：它在全书里承担什么情节功能、与前后章怎么衔接、写得好的地方与可改进点分别是什么。`,
        en: `Help me understand chapter ${p}: what plot function it serves in the book, how it connects to the surrounding chapters, and what works versus what could improve.`,
      }),
      consistency: (p) => ({
        zh: `请对照人设卡与世界观设定，审查章节 ${p} 是否出现人设 / 设定矛盾，逐条列出并给出修改建议。没有人设卡覆盖的角色请明确声明「设定缺失」。`,
        en: `Against the character cards and worldbuilding, review ${p} for character / setting contradictions; list them with revision suggestions. For characters without a card, explicitly say the setting is missing.`,
      }),
      plot: {
        zh: '请基于作品概览（全书章节结构与字数分布）、当前章节正文与世界观设定，审视情节连贯性、伏笔回收与叙事节奏，给出具体到章节的修改建议。',
        en: 'Based on the book overview (chapter structure and word distribution), the current chapter text and the worldbuilding, review plot coherence, foreshadowing payoff and pacing, with chapter-specific revision suggestions.',
      },
      explainSel: {
        zh: '请解释下面这段正文在情节推进、人设塑造与主题上的作用，并指出可改进处：',
        en: 'Explain what this passage does for plot progression, character and theme, and point out improvements:',
      },
      polishSel: {
        zh: '请润色下面这段正文：提升文笔、节奏与可读性，保持人设口吻与全文风格一致，只改必要处：',
        en: "Polish this passage: improve prose, pacing and readability while keeping the character's voice and overall style consistent; change only what's needed:",
      },
    },
  },

  essay: {
    // ㉴ AU-1：四卡表外——世界观/剧情线/伏笔三栏整裁（hiddenViewKinds 同一张表），「情节与节奏」
    // 「逻辑连续性」两卡的对照物对散文集不存在；人设卡非必需（§4.2「缺失不算缺陷」）；
    // 篇与篇长短悬殊是体裁常态（outlierMeaninglessForGenre），拿字数分布当节奏曲线只会满屏假信号。
    // 留下的两卡对象都是正文本体：情感浓度（一篇一个气口）与 AI 味（风格一致）。
    automation: {
      meaningful: ['emotional-intensity', 'ai-flavor'],
      meaningless: ['character-consistency', 'plot-review', 'pacing-tension', 'logical-continuity'],
    },
    persona: {
      noun: { zh: '散文', en: 'prose essay' },
      refs: { zh: '篇目清单、各篇立意与素材、全书编排', en: "the piece list, each piece's intent and material, and the book's sequencing" },
      agentRefs: { zh: '篇目清单、各篇立意与素材、全书编排', en: "the piece list, each piece's intent and material, and the book's sequencing" },
    },
    unitLabel: { zh: '【当前篇目】', en: '[Current piece] ' },
    // 在册欠账 A-3（轮 32 原样保号）：essay 的续写指令头今天领的是小说那句「请为下面的小说片段续写」，
    // 逐字节塌平不许顺手改语义；刀 2 修 A-3 时只改这两格。
    continueHead: {
      zh: '请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
      en: 'Continue the novel excerpt below. Output the continued prose only: no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    },
    continueWords: {
      withTarget: (n) => ({
        zh: `从上面的末尾无缝接着往下写约 ${n} 字，保持人称、时态、文风与已有内容一致。`,
        en: `Seamlessly continue from the tail above for about ${n} words, keeping the same person, tense, and style as the existing text.`,
      }),
      plain: {
        zh: '从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。',
        en: 'Seamlessly continue from the tail above for 300-600 words, keeping the same person, tense, and style as the existing text.',
      },
    },
    polishWhole: {
      zh: '请润色下面这篇散文：提升文字表现力（节奏、画面、语感与余味），但**不得改变**作者的立意与所写的人事细节，不得虚构原文中没有的经历或场景，不得增删段落；保留原有分段结构。直接输出润色后的全文正文：不要任何解释、对照说明或总结。',
      en: "Polish this prose essay below: improve the writing (rhythm, imagery, voice, aftertaste) but do **not** change the author's intent or the people, events and details as written, do not invent experiences or scenes absent from the original, and do not add or remove paragraphs; keep the original paragraph structure. Output the polished full text only: no explanations or summaries.",
    },
    rewriteWhole: {
      zh: '请改写下面这篇散文：在**保留立意、所写的人事细节与全部信息量**的前提下重构表达——允许调整句式长短、段落切分、行文节奏与措辞，让文字更有韵味与可读性。**不要**虚构原文没有的经历、场景或引语，不要替作者补足他没写的结论；保留原有分段结构。直接输出改写后的全文正文：不要任何解释、对照说明或总结。',
      en: "Rewrite this prose essay below: keep **the author's intent, the people, events and details as written, and all information**, but restructure the expression — you may adjust sentence length, paragraph breaks, pacing and wording to make it more resonant and readable. Do **not** invent experiences, scenes or quotations absent from the original, and do not draw conclusions the author left open; keep the original paragraph structure. Output the rewritten full text only: no explanations, comparisons, or summaries.",
    },
    summarizeWhole: {
      zh: '请总结这篇散文：提炼它所写的人、事、景、物与由此生发的感发（每小节要点式列出），控制在 400 字以内。只总结本篇内容，不要补充本篇之外的经历，不要评价文笔。',
      en: 'Summarize this prose essay: list the people, events, scenes and objects it writes about, and the reflections they lead to (bullet-style), within 400 characters. Cover only this piece; do not add experiences outside it, do not judge the writing.',
    },
    reviewUnitNoun: { zh: '散文', en: 'prose essay' },
    reviewExemptRule: { zh: '', en: '' },
    material: {
      digestNoun: { zh: '散文', enWrite: 'prose essay', enFocus: 'prose essays' },
      draftTailLabel: { zh: '【目标章已有正文】\n', en: '[Existing chapter text]\n' },
      draftTailEmpty: {
        zh: '【目标章正文】本章还没有正文，请从开头直接展开。',
        en: '[Chapter text] This chapter has no content yet; start from the beginning.',
      },
      draftTargetLabel: { zh: '【目标章节】', en: '[Target chapter] ' },
      draftPrompt: {
        zh:
          '你是一位散文作者。请根据下面的【资料分析】与【目标章信息】，为指定章节生成正文草稿。\n' +
          '要求：\n' +
          '1. 直接输出正文本身，不要输出标题、解释、前言或结尾说明；\n' +
          '2. 与已有正文的文风、视角、人称保持一致，自然衔接，不要重复已有内容；\n' +
          '3. 充分使用资料分析中的素材，但不要生硬堆砌术语；\n' +
          '4. 分成自然段落，单段不要太长；\n' +
          '5. 字数控制在 800～2000 字左右（根据表达需要自然增减）。',
        en:
          'You are a prose essayist. Based on the [material digest] and [target chapter info] below, write the draft of the target chapter.\n' +
          'Requirements:\n' +
          '1. Output only the prose itself; no titles, explanations, preambles or closing notes;\n' +
          '2. Keep consistent voice, POV and tone with existing text; continue naturally without repeating it;\n' +
          '3. Use the digest material substantially, but do not stuff in jargon mechanically;\n' +
          '4. Write in natural paragraphs, avoiding overly long ones;\n' +
          '5. Aim for around 800–2000 characters (adjust naturally to the essay\'s own movement of thought).',
      },
    },
    workbench: {
      understand: (p) => ({
        zh: `请读懂这篇 ${p}：它在全集里承担什么位置、与前后各篇怎么编排呼应，写得好的地方与可改进点分别是什么。`,
        en: `Help me understand the piece ${p}: what place it holds in the collection, how it echoes or contrasts with the pieces around it, and what works versus what could improve.`,
      }),
      consistency: (p) => ({
        zh: `请对照人物卡与本篇素材，检查这篇 ${p} 所写的人事细节、时间地点与说法是否前后矛盾，逐条列出并给出修改建议。素材没有覆盖的内容请明确声明「素材缺失」，不要替作者补写经历。`,
        en: `Against the character cards and this piece's material, review the piece ${p} for contradictions in people, events, details, times, places or wording; list them with revision suggestions. Where material is missing, say "material missing" — do not invent experiences.`,
      }),
      plot: {
        zh: '请基于全书总览（篇目结构与字数分布）、当前篇正文与素材库，审视立意是否换轨、篇序编排与详略节奏，给出具体到篇目的修改建议。',
        en: 'Based on the book overview (piece structure and word distribution), the current piece and the material library, review whether the theme drifts mid-course, the sequencing and pacing, with piece-specific revision suggestions.',
      },
      explainSel: {
        zh: '请解释下面这段文字在立意展开、笔调与主题上的作用，并指出可改进处：',
        en: 'Explain what this passage does for the essay\'s theme, tone and subject, and point out improvements:',
      },
      polishSel: {
        zh: '请润色下面这段文字：提升文笔、节奏与可读性，保持本篇立意与语气一致，只改必要处：',
        en: 'Polish this passage: improve prose, pacing and readability while keeping this piece\'s intent and voice consistent; change only what\'s needed:',
      },
    },
  },

  poetry: {
    // ㉴ AU-1：四卡表外，与散文同形——§4.3 默认不喂人设卡与时间线、伏笔/剧情线/世界观三栏整裁、
    // 长短诗互邻是体裁常态（体量离群无意义）。情感浓度与 AI 味两卡对诗尤其值钱：
    // 意象与节奏本就在它们的镜头范围内（§4.3 审校镜头）。
    automation: {
      meaningful: ['emotional-intensity', 'ai-flavor'],
      meaningless: ['character-consistency', 'plot-review', 'pacing-tension', 'logical-continuity'],
    },
    persona: {
      noun: { zh: '诗歌', en: 'poetry' },
      refs: { zh: '诗作清单、各首标的形式、意象与念头', en: "the poem list, each poem's tagged form, and its imagery and seeds" },
      agentRefs: { zh: '诗作清单、各首标的形式、意象与念头', en: "the poem list, each poem's tagged form, and its imagery and seeds" },
    },
    unitLabel: { zh: '【当前诗作】', en: '[Current poem] ' },
    continueHead: {
      zh: '请接着下面这首诗往下写。直接续写诗句本身：保持分行，不要任何解释、标题、前言、总结，也不要解读这首诗的寓意；不要复述已有诗句；不要写「以下是续写」之类的话。',
      en: 'Continue the poem below. Output the continued lines only: keep it lineated; no explanations, titles, prefaces, or summaries, and do not interpret the poem; do not repeat existing lines.',
    },
    continueWords: {
      withTarget: (n) => ({
        zh: `接着这首诗往下写约 ${n} 字，仍按原来的分行与节次排布，不要排成散文段落。`,
        en: `Continue this poem for about ${n} characters, keeping its lineation and stanza pattern; do not set it as prose paragraphs.`,
      }),
      plain: {
        zh: '接着这首诗往下写 1～2 节，保持原有语气与分行节奏，不要排成散文段落，也不要解释这首诗在写什么。',
        en: 'Continue this poem by 1–2 more stanzas, keeping its voice and line rhythm; do not reflow it into prose paragraphs, and do not explain what the poem is about.',
      },
    },
    polishWhole: {
      zh: '请润色下面这首诗：**分行与节次就是诗的本体，一律不许改动** —— 不许合行、拆行、增删分行，更不许把诗排成散文段落；在此前提下打磨字句（炼字、节奏、意象的准确度），可以缩短句子；不得改变所写的对象与情感走向，不得虚构原诗没有的意象，不得替作者解释这首诗"想表达什么"。直接输出润色后的全诗：不要任何解释、对照说明或诗意解读。',
      en: 'Polish this poem below: **its line breaks and stanza grouping are the poem itself — never change them**; do not merge, split, add or remove lines, and never reflow the poem into prose paragraphs. Within that, refine wording, rhythm and the precision of its images (shorter lines are fine); do not change what the poem is about or its emotional direction, do not invent images absent from it, and do not explain what the poem "means". Output the polished poem only: no explanations, comparisons, or interpretation.',
    },
    rewriteWhole: {
      zh: '请改写下面这首诗：在**保留诗意、所写的意象与全部信息量**的前提下重构表达 —— 可以换词、调整句长与行的断句位置、重排节内顺序，但**不得**把诗改成散文段落，不得增删节数，不得补上作者没写的结论或道理，不得虚构原诗没有的意象与引语；保留分行。直接输出改写后的全诗：不要任何解释、对照说明或诗意解读。',
      en: 'Rewrite this poem below: keep **its intent, its images and all of its information**, but restructure the expression — you may change wording, line length and where lines break, and reorder lines within a stanza, but **do not** turn it into prose, do not add or remove stanzas, do not supply a conclusion or moral the author left unwritten, and do not invent images or quotations absent from it. Keep it lineated. Output the rewritten poem only: no explanations, comparisons, or interpretation.',
    },
    summarizeWhole: {
      zh: '请总结这首诗：列出它用了哪些意象、这些意象指向什么（要点式，不超过 200 字）。**只描述它写了什么，不要替它解释"表达了什么思想感情"**，不要评价好坏，不要引用诗里没有的东西。',
      en: 'Summarize this poem: list the images it uses and what they point to (bullet-style, within 200 characters). **Describe only what it writes — do not explain what "thoughts and feelings it expresses"**, do not judge its quality, do not cite anything not in the poem.',
    },
    reviewUnitNoun: { zh: '诗歌', en: 'poem' },
    reviewExemptRule: {
      zh: '\n5. 诗可以跨行不成句（一行不必是完整句子，标点常刻意省略，语序也常倒装）：**不要**把跨行、省标点、倒装判为病句，只判真正的语法错误；',
      en: '\n5. A poem may break lines mid-sentence (a line need not be a full clause, punctuation is often deliberate, word order may be inverted): do **not** flag line breaks, omitted punctuation, or inversion as errors — flag only real grammar mistakes;',
    },
    material: {
      digestNoun: { zh: '诗歌', enWrite: 'poetry', enFocus: 'poems' },
      draftTailLabel: { zh: '【目标诗作已有正文】\n', en: '[Existing poem text]\n' },
      draftTailEmpty: {
        zh: '【目标诗作正文】这首诗还没有正文，请从开头直接展开。',
        en: '[Poem text] This poem has no content yet; start from the beginning.',
      },
      draftTargetLabel: { zh: '【目标诗作】', en: '[Target poem] ' },
      draftPrompt: {
        zh:
          '你是一位诗歌作者。请根据下面的【资料分析】与【目标诗作信息】，为指定诗作生成正文草稿。\n' +
          '要求：\n' +
          '1. 直接输出正文本身，不要输出标题、解释、前言或结尾说明；\n' +
          '2. 与已有正文的文风、视角、人称保持一致，自然衔接，不要重复已有内容；\n' +
          '3. 充分使用资料分析中的素材，但不要生硬堆砌术语；\n' +
          '4. 按分行写，节与节之间空一行；**不要**排成散文段落；\n' +
          '5. 写短制：8～30 行左右，依诗意自然增减，不要为凑篇幅铺陈。',
        en:
          'You are a poet. Based on the [material digest] and [target poem info] below, write the draft of the target poem.\n' +
          'Requirements:\n' +
          '1. Output only the prose itself; no titles, explanations, preambles or closing notes;\n' +
          '2. Keep consistent voice, POV and tone with existing text; continue naturally without repeating it;\n' +
          '3. Use the digest material substantially, but do not stuff in jargon mechanically;\n' +
          '4. Write in lines, with a blank line between stanzas; do **not** set it as prose paragraphs;\n' +
          '5. Keep it short: about 8–30 lines, growing or shrinking with the poem itself; do not pad for length.',
      },
    },
    workbench: {
      understand: (p) => ({
        zh: `请读懂这首诗 ${p}：它在整本诗集里承担什么位置、与前后诗作怎么编排呼应，写得好的地方与可改进点分别是什么。`,
        en: `Help me understand the poem ${p}: what place it holds in the collection, how it is sequenced with the poems around it, and what works versus what could improve.`,
      }),
      consistency: (p) => ({
        zh: `请对照本诗已登记的意象、用词与语气素材，检查这首诗 ${p} 是否出现前后不一致，逐条列出并给出修改建议。不要臆测诗里没写的寓意；素材未覆盖处请明确声明「素材缺失」。`,
        en: `Against this poem's recorded imagery, diction and tone notes, review the poem ${p} for internal inconsistencies; list them with revision suggestions. Do not speculate about meanings the poem does not write; where material is missing, say "material missing".`,
      }),
      plot: {
        zh: '请基于全诗集总览（诗作结构与字数分布）、当前诗作正文与意象素材，审视意象系统的呼应与节奏起伏，给出具体到诗作的修改建议。',
        en: 'Based on the collection overview (poem structure and word distribution), the current poem and its imagery notes, review how the imagery system echoes across poems and how the rhythm rises and falls, with poem-specific revision suggestions.',
      },
      explainSel: {
        zh: '请解释下面这几行在诗意推进、意象与语气上的作用，并指出可改进处；只谈文本写得出的东西，不要替诗做寓意总结：',
        en: 'Explain what these lines do for the poem\'s movement, imagery and tone, and point out improvements; speak only of what the text writes — do not summarize an allegory for the poem:',
      },
      polishSel: {
        zh: '请润色下面这几行：只炼字与节奏，保持分行与节次不变，只改必要处：',
        en: 'Polish these lines: refine wording and rhythm only, keep the line breaks and stanza grouping unchanged, change only what\'s needed:',
      },
    },
  },

  script: {
    // ㉴ AU-1：整卡级全跑——角色表 / 剧情线 / 伏笔 / 幕场时序都是戏剧本体（⑮-2 只裁了世界观，
    // 就是 hiddenViewKindsForGenre 那张表），六卡的对照物在剧本里都真实存在。
    // §4.4 那句「跳伏笔回收与时间线冲突」是卡内**条目级**排除，归预设 prompt 正文那条线
    //（AI-5d-② / AI-15·P16 在册等拍）；本槽只表达「整卡跑不跑」这一档调度粒度，不另造第三档。
    automation: {
      meaningful: ['character-consistency', 'plot-review', 'emotional-intensity', 'ai-flavor', 'pacing-tension', 'logical-continuity'],
      meaningless: [],
    },
    persona: {
      noun: { zh: '剧本', en: 'playwriting' },
      refs: { zh: '角色表、幕场结构与各场梗概、对白与舞台指示', en: 'the character list, the act/scene structure and scene synopses, dialogue and stage directions' },
      agentRefs: { zh: '角色表、幕场结构与各场梗概、对白与舞台指示', en: 'the character list, the act/scene structure and scene synopses, dialogue and stage directions' },
    },
    unitLabel: { zh: '【当前场次】', en: '[Current scene] ' },
    continueHead: {
      zh: '请接着下面这一幕剧本往下写。直接续写剧本本身：保持角色名起行、台词另起一行的排法；不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
      en: 'Continue the scene below. Output the script itself only: keep character names on their own lines with speech beneath; no explanations, titles, prefaces, or summaries; do not repeat existing text.',
    },
    continueWords: {
      withTarget: (n) => ({
        zh: `接着这一幕往下写约 ${n} 字，仍按原来的排法（角色名起行、台词另起一行、舞台指示用括注独立成行），不要排成散文段落。`,
        en: `Continue this scene for about ${n} characters, keeping the layout (character name on its own line, speech beneath it, stage directions bracketed on their own lines); do not set it as prose paragraphs.`,
      }),
      plain: {
        zh: '接着这一幕往下写，把当前这个冲突回合推进一步或写出转折：仍按对白排法，不要让一个人连着说太长，也不要替人物解释这场戏在讲什么。',
        en: 'Continue this scene, advancing the current round of conflict or turning it: keep the dialogue layout, do not let one character speak at length, and do not have the characters explain the scene.',
      },
    },
    polishWhole: {
      zh: '请润色下面这一幕剧本：台词是人物**说出口的话**，不是叙述 —— 只打磨说法（口语节奏、各人的语言习惯、能不能演），**不得改变**谁在说话、说出的事实与事件先后；不得增删幕与场的编号；不得把台词改成叙述，也不得把括注的舞台指示改成台词；保持角色名起行、台词换行、指示独立成行的排法。直接输出润色后的全场：不要任何解释、对照说明或剧情解读。',
      en: 'Polish the scene below: dialogue is what characters **say aloud**, not narration — refine the wording only (spoken rhythm, each character\u2019s verbal habits, playability), but do **not** change who speaks, the facts spoken, or the order of events; do not add or remove act or scene numbers; do not turn dialogue into narration or bracketed stage directions into speech; keep character names on their own lines, speech beneath, and directions on their own lines. Output the polished scene only: no explanations, comparisons, or interpretation.',
    },
    rewriteWhole: {
      zh: '请改写下面这一幕剧本：在**保留人物关系、冲突走向、结果与全部信息量**的前提下重构说法 —— 可以换词、调整台词长短与停顿，让对白更紧、更可演；但**不得**改变谁在场、谁要什么、谁挡着、结果如何；不得增删幕与场的编号；不得把对白改成叙述、也不得把括注的舞台指示改成台词；不得虚构原稿没有的前史、关系或引语。保持角色名起行、台词换行、指示独立成行的排法。直接输出改写后的全场：不要任何解释、对照说明或剧情解读。',
      en: 'Rewrite the scene below: keep **the character relationships, the direction of the conflict, its outcome and all information**, but restructure the wording — you may change diction, line lengths and pauses to tighten the dialogue and make it more playable; do **not** change who is present, who wants what, who blocks it, or how it ends; do not add or remove act or scene numbers; do not turn dialogue into narration or bracketed directions into speech; do not invent backstory, relationships or quotations absent from the draft. Keep character names on their own lines, speech beneath, directions on their own lines. Output the rewritten scene only: no explanations, comparisons, or interpretation.',
    },
    summarizeWhole: {
      zh: '请总结这一幕剧本：按出场人物分别列出**各自要什么、谁挡着、本场结束时得到或失去了什么**，再用一行交代时间、地点与主要舞台调度（要点式，控制在 400 字以内）。只总结本场内容，不要补充本场之外的情节，不要评价文笔。',
      en: 'Summarize this scene: for each character on stage list **what they want, who blocks them, and what they gain or lose by the end of the scene**, then one line for time, place and the main stage business (bullet-style, within 400 characters). Cover only this scene; do not add events outside it, do not judge the writing.',
    },
    reviewUnitNoun: { zh: '剧本', en: 'play script' },
    reviewExemptRule: {
      zh: '\n5. 剧本有它自己的排法：角色名通常单独成行，台词可以省主语、可以不是完整句子，括注的舞台指示（如「（沉默。他摘下帽子。）」）常独立成行、可以没有谓语：**不要**把这些判为病句，只判真正的语法错误；',
      en: '\n5. A script has its own layout: a character name usually stands on its own line, a speech may drop the subject or be an incomplete clause, and a bracketed stage direction (e.g. "(Silence. He takes off his hat.)") often stands alone without a finite verb: do **not** flag these as errors — flag only real grammar mistakes;',
    },
    material: {
      digestNoun: { zh: '剧本', enWrite: 'scene', enFocus: 'a play' },
      draftTailLabel: { zh: '【目标场次已有正文】\n', en: '[Existing scene text]\n' },
      draftTailEmpty: {
        zh: '【目标场次正文】这场还没有正文，请从开头直接展开。',
        en: '[Scene text] This scene has no content yet; start from the beginning.',
      },
      draftTargetLabel: { zh: '【目标场次】', en: '[Target scene] ' },
      draftPrompt: {
        zh:
          '你是一位剧作者。请根据下面的【资料分析】与【目标场次信息】，为指定场次生成正文草稿。\n' +
          '要求：\n' +
          '1. 直接输出正文本身，不要输出标题、解释、前言或结尾说明；\n' +
          '2. 与已有正文的人物语气、关系与口径保持一致，自然衔接，不要重复已有内容；\n' +
          '3. 充分使用资料分析中的素材，但不要生硬堆砌术语，更不要让人物上台解释资料；\n' +
          '4. 按剧本格式写：**角色名单独一行、台词另起一行**，舞台调度与音效用括注独立成行；**不要**排成散文段落，也不要增删幕与场的编号；\n' +
          '5. 一场戏写一个冲突回合：谁要什么、谁挡着、结果如何；台词长短随人物处境变化，不要为凑字数铺陈。',
        en:
          'You are a playwright. Based on the [material digest] and [target scene info] below, write the draft of the target scene.\n' +
          'Requirements:\n' +
          '1. Output only the script itself; no titles, explanations, preambles or closing notes;\n' +
          '2. Keep the existing character voices, relationships and register; continue naturally without repeating what is already written;\n' +
          '3. Use the digest material substantially, but do not stuff in jargon, and never let a character explain the source material on stage;\n' +
          '4. Write in script format: **character name on its own line, speech beneath it**, stage business and sound cues bracketed on their own lines; do **not** set it as prose paragraphs, and do not add or remove act or scene numbers;\n' +
          '5. One scene, one round of conflict: who wants what, who blocks it, what results; vary line lengths with what each character has at stake, do not pad for length.',
      },
    },
    workbench: {
      understand: (p) => ({
        zh: `请读懂这场 ${p}：它在全剧里承担什么冲突功能、与前后场怎么衔接，写得好的地方与可改进点分别是什么。`,
        en: `Help me understand the scene ${p}: what conflict function it serves in the play, how it connects to the surrounding scenes, and what works versus what could improve.`,
      }),
      consistency: (p) => ({
        zh: `请对照角色表，审查本场 ${p} 是否出现人物口径 / 事件前后矛盾（谁在说话、台词内容、场序编号），逐条列出并给出修改建议。角色表没有覆盖的角色请明确声明「设定缺失」。`,
        en: `Against the cast sheet, review the scene ${p} for contradictions in character voice or events (who speaks, what the lines say, scene numbering); list them with revision suggestions. For characters absent from the cast sheet, explicitly say the setting is missing.`,
      }),
      // 剧本保留「情节 / 伏笔」现名（轮 30 在册决定：剧情线/伏笔不改，换了等于替用户重命名功能）。
      plot: {
        zh: '请基于作品概览（全剧幕场结构与字数分布）、当前场次正文与角色表，审视情节连贯性、伏笔回收与叙事节奏，给出具体到场次的修改建议。',
        en: 'Based on the book overview (act and scene structure and word distribution), the current scene text and the cast sheet, review plot coherence, foreshadowing payoff and pacing, with scene-specific revision suggestions.',
      },
      explainSel: {
        zh: '请解释这段台词与舞台指示在本场冲突推进、人物刻画与主题上的作用，并指出可改进处：',
        en: 'Explain what this dialogue and stage business does for the scene\'s conflict, character and theme, and point out improvements:',
      },
      polishSel: {
        zh: '请润色这段台词与指示：提升口语节奏与可演性，保持人物口吻、台词归属与行型格式，只改必要处：',
        en: 'Polish this dialogue and direction: improve spoken rhythm and playability while keeping each character\'s voice, line attribution and the line-type format; change only what\'s needed:',
      },
    },
  },

  diary: {
    // ㉴ AU-1：四卡表外——§4.5「不校情节完整度」（碎片条目不是缺陷）、不喂人设卡与剧情线、
    // 伏笔/剧情线/世界观三栏整裁；一天的多少不等质量（体量离群无意义）。
    // 日记自己的自动化视角（空档断点 / 前后对照）走体裁命令集与校对体检，不借小说口径的卡。
    // 保留：语气流水账恰是 AI 味的对侧，情感浓度是「当天的记录」的天然维度。
    automation: {
      meaningful: ['emotional-intensity', 'ai-flavor'],
      meaningless: ['character-consistency', 'plot-review', 'pacing-tension', 'logical-continuity'],
    },
    persona: {
      noun: { zh: '日记', en: 'journal' },
      refs: { zh: '日记条目清单、各天提到的人物与地点、时间线与念头', en: 'the entry list, the people and places each day mentions, and the timeline and notes' },
      agentRefs: { zh: '日记条目清单、各天提到的人物与地点、时间线与念头', en: 'the entry list, the people and places each day mentions, and the timeline and notes' },
    },
    unitLabel: { zh: '【当前条目】', en: '[Current entry] ' },
    continueHead: {
      zh: '请接着这条日记往下写。直接往下写当天的内容本身：不要任何解释、标题、前言或总结；不要复述已有内容；**不要替作者编造那天发生的事**。',
      en: 'Continue the journal entry below. Write on with the day\'s own content: no explanations, titles, prefaces or summaries; do not repeat existing text; **do not invent things that did not happen that day**.',
    },
    continueWords: {
      withTarget: (n) => ({
        zh: `接着这条日记往下写约 ${n} 字，仍写当天的事与当时的想法，**不要替作者补写原文里没有的经过**。`,
        en: `Continue this journal entry for about ${n} characters, staying with what happened that day and what the author thought then; **do not add events the author did not record**.`,
      }),
      plain: {
        zh: '接着这条日记往下写 1～3 句，把当天没说完的那层意思说完即可；不要为凑字数铺陈，不要替作者补记忆，也不要总结全文。',
        en: "Continue this journal entry by just 1–3 more sentences, finishing the thought the day left off; do not pad for length, do not fill in the author's memory, and do not wrap the entry up.",
      },
    },
    polishWhole: {
      zh: '请润色这条日记：只打磨字句（去掉重复说法、理顺句子、让当时的语气更准），**不得改变所记的事实、人物、时间地点与作者当时的判断**；不得补写原文没有的场景、对话或心理活动，不得增删段落；也不要把它改写成文学作品 —— 它首先是写给自己看的记录。直接输出润色后的全文：不要任何解释、对照说明或感悟发挥。',
      en: 'Polish this journal entry: refine the wording only (remove repetition, straighten sentences, make the voice of the moment more accurate), but do **not** change the facts recorded, the people, the time and place, or what the author thought then; do not add scenes, dialogue or inner states absent from it, do not add or remove paragraphs, and do not turn it into a literary piece — it is first a record written for the author. Output the polished text only: no explanations, comparisons, or reflections.',
    },
    rewriteWhole: {
      zh: '请改写这条日记：在**保留所记事实、时间地点、涉及的人与当时的判断**的前提下重构说法 —— 可以调句子长短、合并零碎短句、理顺顺序；但**不得**增补记忆（没写的场景、对话、心理、因果都不许出现），不得改成第三人称，不得把口语改成书面腔（原条目本来就书面则照旧）。直接输出改写后的全文：不要任何解释、对照说明或感悟发挥。',
      en: 'Rewrite this journal entry: keep **the facts recorded, the time and place, the people involved and the judgment made at the time**, but restructure the wording — you may vary sentence lengths, merge fragmentary lines, and straighten the order; do **not** add to the memory (no unrecorded scenes, dialogue, inner states or causes), do not switch to the third person, and do not polish spoken wording into formal prose unless the entry was already formal. Output the rewritten text only: no explanations, comparisons, or reflections.',
    },
    summarizeWhole: {
      zh: '请总结这条日记：它写的是哪天、记了哪些事、涉及哪些人、作者当时的情绪或判断是什么（要点式，控制在 200 字以内）。只按原文说，**不得补写原文没有的因果与动机**，不要评价文笔，也不要替作者"升华"。',
      en: "Summarize this journal entry: which day it writes, what events it records, who appears, and what the author felt or decided at the time (bullet-style, within 200 characters). Say only what is there — **do not supply causes or motives the entry does not state**, do not judge the writing, and do not uplift the author's meaning.",
    },
    reviewUnitNoun: { zh: '日记', en: 'journal entry' },
    reviewExemptRule: {
      zh: '\n5. 日记是写给自己的：常省主语、口语化、用只有作者懂的简称与名字，也可能一句话自成一节：**不要**把这些判为病句，只判真正的语法错误；',
      en: '\n5. A journal entry is written for the author: it may drop subjects, stay colloquial, use private abbreviations and bare names, and a single sentence may stand as its own paragraph: do **not** flag these as errors — flag only real grammar mistakes;',
    },
    material: {
      digestNoun: { zh: '日记', enWrite: 'journal', enFocus: 'a journal entry' },
      draftTailLabel: { zh: '【该条目已有正文】\n', en: '[Existing entry text]\n' },
      draftTailEmpty: {
        zh: '【该条目正文】这条还没有正文。请只依据【资料分析】里已经写明的内容整理，缺的就留空，不要凭空写出一天的经历。',
        en: "[Entry text] This entry has no content yet. Organize only what the [material digest] already states; leave the rest absent and never invent a day's events.",
      },
      draftTargetLabel: { zh: '【该条目】', en: '[Target entry] ' },
      draftPrompt: {
        zh:
          '你是一位替作者整理日记条目的人。请把下面的【资料分析】与【该条目信息】整理成一条日记草稿。\n' +
          '硬线（日记的身份就是记录，编造一次就废了）：\n' +
          '1. 只使用资料里**已经写明的事实与作者自己的记录**；不得虚构那天的经历、对话、心理活动或因果；\n' +
          '2. 资料不足以支撑一条日记时，直接输出「资料不足：缺 ___」，不要用文字填空；\n' +
          '3. 按自然段写，3～8 句，短，不铺陈、不总结升华；\n' +
          '4. 保留作者的说话方式（口语就保持口语），不要改成书面腔，不要改成第三人称；\n' +
          '5. 直接输出条目正文，不要标题、解释、前言或结尾说明。',
        en:
          "You organize a journal entry on the author's behalf. Turn the [material digest] and [target entry info] below into one journal entry.\n" +
          'Hard lines (a journal\'s whole value is that it is a record — one invented detail ruins it):\n' +
          '1. Use only facts and first-person notes **already stated in the digest**; never invent that day\'s events, dialogue, inner states or causes;\n' +
          '2. If the material cannot support an entry, output exactly "Insufficient material: missing ___" instead of filling the gap;\n' +
          '3. Write in natural paragraphs, 3-8 sentences, short; no padding, no wrap-up or uplift;\n' +
          "4. Keep the author's way of speaking (stays colloquial if the notes are); do not formalize it, do not switch to third person;\n" +
          '5. Output only the entry text; no titles, explanations, preambles or closing notes.',
      },
    },
    workbench: {
      understand: (p) => ({
        zh: `请读懂这一天的条目 ${p}：它在全本日记里记了什么节点、与前后条目怎么呼应，写得好的地方与可改进点分别是什么。**只依据原文说，不要替作者补充那天没写的事**。`,
        en: `Help me understand the entry ${p}: what point in the journal it marks, how it echoes other entries, and what works versus what could improve. **Say only what the entry states; do not fill in what the author did not write that day.**`,
      }),
      consistency: (p) => ({
        zh: `请对照人物卡与前后条目，检查这一天的记录 ${p} 在所记事实、人名与说法上是否前后矛盾，逐条列出并给出修改建议。**不得为弥合矛盾而增补原文没有的事**；无法核对处请明确声明「记录缺失」。`,
        en: `Against the character cards and neighboring entries, check the entry ${p} for contradictions in recorded facts, names or wording; list them with revision suggestions. **Never bridge a contradiction by inventing what is not in the text**; where it cannot be verified, say "record missing".`,
      }),
      plot: {
        zh: '请基于全本日记总览（条目结构与字数分布）、当天正文与人物卡，审视前后条目的连续与空档节奏，给出具体到条目的修改建议。',
        en: 'Based on the journal overview (entry structure and word distribution), today\'s text and the character cards, review continuity and gaps between entries, with entry-specific revision suggestions.',
      },
      explainSel: {
        zh: '请解释下面这段记录在当时的事件、情绪与前后文里的作用，并指出可改进处；不得补充原文没有的经过：',
        en: 'Explain what this record does among the day\'s events, feelings and surrounding entries, and point out improvements; do not add anything the record does not state:',
      },
      polishSel: {
        zh: '请润色下面这段记录：理顺字句、去掉重复，保持当天的事实与口吻不变、不补写，只改必要处：',
        en: 'Polish this record: straighten the wording and remove repetition while keeping the day\'s facts and voice unchanged — add nothing; change only what\'s needed:',
      },
    },
  },
};

/**
 * 取体裁的提示词包。**唯一的兜底点**：未设置 / 脏值经 `workbenchCommandSet` 落 novel，
 * 与历史行为逐字等价（P1 在册口径）。调用方拿到 pack 后不许再看 genre 原值。
 */
export function genrePromptPack(genre?: string | null): GenrePromptPack {
  return GENRE_PROMPT_PACKS[workbenchCommandSet(genre ?? '')];
}
