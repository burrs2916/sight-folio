/**
 * genreSelectionPacks —— 选区三件套（润色 / 改写 / 总结）的体裁单一事实源（A-1）。
 *
 * 背景：整篇（whole）三件套早已住进 `genrePromptPack.polishWhole/rewriteWhole/summarizeWhole`，
 * 但选区（selection）分支还共用一句写死的小说口径「不得改变情节、人物行为、时间线」。
 * 诗集选一段会被建议成"保情节"，剧本会被排成散文——这正是 A-1 报告点的 P0。
 *
 * 设计（与 `buildReviewMessage` 同构，不另起骨架）：
 *  - 选区输出仍走原「只改选中片段 + 前后文作语境 + 无缝拼回」的公共链路，本表只提供
 *    各体裁**不能动的硬边界那句**（整句指令，zh 权威 / en 同义）。
 *  - `Record<GenrePromptVariant, GenreSelectionPack>` 穷尽锁：漏一体裁 = 编译不过。
 *  - novel 三格与改造前 `writingAssistant.ts` 选区文案**逐字相同**（零回归线，golden 快照钉死）。
 *  - 兜底只在 `genreSelectionPack()` 入口一次：未设 / 脏值经 `workbenchCommandSet` 落 novel。
 *
 * 载体口径沿用 `aiLang.L` 惯例：发给模型读的正文走代码内联双语（zh 权威），不进 UI 语言包。
 */
import { workbenchCommandSet } from '../utils/writingSchema';
import type { GenrePromptVariant, PromptPair } from './quickActionPrompts';

/** 一个体裁在选区三件套上的全部说法。 */
export interface GenreSelectionPack {
  /** 选区级润色：只打磨该片段，守住本体裁硬边界，输出可无缝拼回 */
  polish: PromptPair;
  /** 选区级改写：可重构行文骨架，但仍守本体裁硬边界与信息量 */
  rewrite: PromptPair;
  /** 选区级总结：该体裁的片段该端出什么 */
  summarize: PromptPair;
}

export const GENRE_SELECTION_PACKS: Record<GenrePromptVariant, GenreSelectionPack> = {
  novel: {
    // 逐字保持改造前 writingAssistant.ts 选区文案（零回归线，勿改一字）。
    polish: {
      zh: '请只润色下面的【选中片段】：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量。输出必须是润色后的片段本身，能无缝拼回原位：保持与前后文的衔接（人称、时态、语句完整性），不要输出选区之外的内容，不要解释、对照说明或总结。',
      en: 'Polish ONLY the selected excerpt below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information. Output the polished excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text (person, tense, sentence completeness). Do not output anything beyond the excerpt; no explanations or summaries.',
    },
    rewrite: {
      zh: '请改写下面的【选中片段】：在**保留情节、人物行为、时间线与全部信息量**的前提下，重构表达——允许调整句式长短、段落切分、叙事节奏与措辞，让文字更有张力与可读性。**不要**改变任何故事事实，也不要输出选区之外的内容。输出必须是改写后的片段本身，能无缝拼回原位：保持与前后文的衔接（人称、时态、语句完整性）。不要解释、对照说明或总结。',
      en: 'Rewrite ONLY the selected excerpt below: keep **all plot, character actions, timeline, and information**, but restructure the prose — you may adjust sentence length, paragraph breaks, pacing, and wording to make it more vivid and readable. Do **not** change any story facts, and do not output anything beyond the excerpt. Output the rewritten excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text (person, tense, sentence completeness). No explanations, comparisons, or summaries.',
    },
    summarize: {
      zh: '请总结下面的【选中片段】：提炼这一段发生的情节、人物动向与关键信息，按「情节进展 / 关键信息」两部分组织，控制在 200 字以内。只总结选中片段本身，不要补充选段之外的情节，不要评价文笔。',
      en: "Summarize the selected excerpt below: extract what happens in this passage, character developments, and key information, organized into 'Plot progress / Key information', within 200 characters. Summarize only the excerpt itself; do not add events outside it, do not judge the writing.",
    },
  },
  essay: {
    polish: {
      zh: '请只润色下面的【选中散文片段】：提升文字表现力（节奏、语感与余味），但**不得改变作者的立意与所写的人事细节**，不得虚构原文中没有的经历、场景或引语，不得增删段落；保留原有分段。输出必须是润色后的片段本身，能无缝拼回原位：保持与前后文的衔接（人称、时态、语句完整性），不要输出选区之外的内容，不要解释、对照说明或总结。',
      en: 'Polish ONLY the selected essay excerpt below: improve expressiveness (rhythm, cadence and aftertaste) but do **not** change the author’s intent or the people/events described, do not invent experiences, scenes or quotations absent from the original, do not add or cut paragraphs; keep the paragraph structure. Output the polished excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text (person, tense, sentence completeness). Do not output anything beyond the excerpt; no explanations or summaries.',
    },
    rewrite: {
      zh: '请改写下面的【选中散文片段】：在**保留立意、所写的人事细节与全部信息量**的前提下重构表达——允许调整句式长短、行文节奏与措辞，让文字更有韵味与可读性。**不要**虚构原文没有的经历、场景或引语，不要替作者补足他没写的结论；保留原有分段。输出必须是改写后的片段本身，能无缝拼回原位：保持与前后文的衔接（人称、时态、语句完整性）。不要解释、对照说明或总结。',
      en: 'Rewrite ONLY the selected essay excerpt below: keep **the author’s intent, the people/events described and all information**, but restructure the expression — you may adjust sentence length, pacing and wording for more resonance and readability. Do **not** invent experiences, scenes or quotations absent from the original, do not fill in conclusions the author did not write; keep the paragraph structure. Output the rewritten excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text (person, tense, sentence completeness). No explanations, comparisons, or summaries.',
    },
    summarize: {
      zh: '请总结下面的【选中散文片段】：提炼它所写的人、事、景、物与由此生发的感发（要点式），控制在 200 字以内。只总结选中片段本身，不要补充片段之外的经历，不要评价文笔。',
      en: 'Summarize the selected essay excerpt below: extract the people, events, scenes, objects it describes and the reflections it draws from them (bullets), within 200 characters. Summarize only the excerpt itself; do not add experiences outside it, do not judge the writing.',
    },
  },
  poetry: {
    polish: {
      zh: '请只润色下面的【选中诗句片段】：打磨字句（炼字、节奏、意象的准确度），可以缩短句子；但**分行与节次就是诗的本体，一律不许改动**——不许合行、拆行、增删分行，更不许把诗排成散文段落。不得改变所写的对象与情感走向，不得虚构原诗没有的意象，也不要替作者解释这首诗「想表达什么」。输出必须是润色后的片段本身，保留原有分行，能无缝拼回原位：不要输出选区之外的内容，不要解释、对照说明或诗意解读。',
      en: 'Polish ONLY the selected poetic excerpt below: refine diction, rhythm and imagery accuracy, you may shorten lines; but **line breaks and stanza order are the poem itself — never merge, split, add or delete lines, and never reflow the poem into prose**. Do not change the subject or the emotional arc, do not invent imagery, and do not explain what the poem "means". Output the polished excerpt itself, keeping the line breaks, ready to be spliced back seamlessly: do not output anything beyond the excerpt; no explanations or interpretations.',
    },
    rewrite: {
      zh: '请改写下面的【选中诗句片段】：在**保留诗意、所写的意象与全部信息量**的前提下重构——可以换词、调整句长与行的断句位置；但**不得把诗改成散文段落，不得增删分行或节次**，不得补上作者没写的结论或道理，不得虚构原诗没有的意象与引语；保留分行。输出必须是改写后的片段本身，能无缝拼回原位：不要输出选区之外的内容，不要解释或诗意解读。',
      en: 'Rewrite ONLY the selected poetic excerpt below: keep **the poem’s meaning, its imagery and all information**, but restructure the expression — you may swap words and adjust line length and where lines break; but **never turn the poem into prose, never add or delete lines or stanzas**, do not add conclusions the author did not write, do not invent imagery or quotations; keep the line breaks. Output the rewritten excerpt itself, ready to be spliced back seamlessly: do not output anything beyond the excerpt; no explanations or interpretations.',
    },
    summarize: {
      zh: '请总结下面的【选中诗句片段】：列出它用了哪些意象、这些意象指向什么（要点式，不超过 150 字）。**只描述它写了什么，不要替它解释「表达了什么思想感情」**，不要评价好坏，不要引用诗里没有的东西。只总结选中片段本身。',
      en: 'Summarize the selected poetic excerpt below: list the images it uses and what they point to (bullets, under 150 characters). **Only describe what it writes; do not explain what feelings or ideas it "expresses"**, do not judge quality, do not cite anything not in the poem. Summarize only the excerpt itself.',
    },
  },
  script: {
    polish: {
      zh: '请只润色下面的【选中剧本片段】：台词是人物**说出口的话**，不是叙述——只打磨说法（口语节奏、各人的语言习惯、能不能演），但**不得改变谁在说话、说出的事实与事件先后**；不得把台词改成叙述，也不得把括注的舞台指示改成台词；保持角色名起行、台词换行、指示独立成行的排法。输出必须是润色后的片段本身，保留上述排法，能无缝拼回原位：不要输出选区之外的内容，不要解释、对照说明或剧情解读。',
      en: 'Polish ONLY the selected script excerpt below: dialogue is what characters **say aloud**, not narration — refine wording only (spoken rhythm, each voice, actability), but do **not** change who speaks, the stated facts or the event order; do not turn dialogue into narration, nor stage directions in parentheses into dialogue; keep character names starting a line, dialogue line-broken, directions on their own lines. Output the polished excerpt itself, preserving this layout, ready to be spliced back seamlessly: do not output anything beyond the excerpt; no explanations or plot readings.',
    },
    rewrite: {
      zh: '请改写下面的【选中剧本片段】：在**保留人物关系、冲突走向、结果与全部信息量**的前提下重构说法——可以换词、调整台词长短与停顿，让对白更紧、更可演；但**不得改变谁在场、谁要什么、谁挡着、结果如何**，不得把对白改成叙述、也不得把括注的舞台指示改成台词，不得虚构原稿没有的前史、关系或引语；保持角色名起行、台词换行、指示独立成行的排法。输出必须是改写后的片段本身，保留上述排法，能无缝拼回原位：不要输出选区之外的内容，不要解释或剧情解读。',
      en: 'Rewrite ONLY the selected script excerpt below: keep **the character relationships, the conflict arc, the outcome and all information**, but restructure the wording — you may swap words and adjust line length and pauses to make the dialogue tighter and more actable; but **never change who is present, who wants what, who blocks, or the outcome**, do not turn dialogue into narration or stage directions into dialogue, do not invent backstory, relationships or quotations absent from the original; keep character names starting a line, dialogue line-broken, directions on their own lines. Output the rewritten excerpt itself, preserving this layout, ready to be spliced back seamlessly: do not output anything beyond the excerpt; no explanations or plot readings.',
    },
    summarize: {
      zh: '请总结下面的【选中剧本片段】：按出场人物分别列出**各自要什么、谁挡着、片段结束时得到或失去了什么**，再用一行交代场面与主要舞台调度（要点式，控制在 200 字以内）。只总结选中片段本身，不要补充片段之外的情节，不要评价文笔。',
      en: 'Summarize the selected script excerpt below: per character listed, state **what each wants, who blocks them, and what they gain or lose by the end of the excerpt**, then one line on the scene and main stage directions (bullets, within 200 characters). Summarize only the excerpt itself; do not add events outside it, do not judge the writing.',
    },
  },
  diary: {
    polish: {
      zh: '请只润色下面的【选中日记片段】：只打磨字句（去掉重复说法、理顺句子、让当时的语气更准），但**不得改变所记的事实、人物、时间地点与作者当时的判断**；不得补写原文没有的场景、对话或心理活动，也不要把这段改写成文学作品——它首先是写给自己看的记录。输出必须是润色后的片段本身，能无缝拼回原位：保持与前后文的衔接，不要输出选区之外的内容，不要解释或感悟发挥。',
      en: 'Polish ONLY the selected diary excerpt below: refine wording only (remove repetition, straighten sentences, sharpen the voice of the moment), but do **not** change the recorded facts, people, time/place or the author’s judgement at the time; do not add scenes, dialogue or psychology absent from the original, and do not rewrite it into a literary piece — it is first a record to oneself. Output the polished excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text; do not output anything beyond the excerpt; no explanations or reflections.',
    },
    rewrite: {
      zh: '请改写下面的【选中日记片段】：在**保留所记事实、时间地点、涉及的人与当时的判断**的前提下重构说法——可以调句子长短、合并零碎短句、理顺顺序；但**不得增补记忆**（没写的场景、对话、心理、因果都不许出现），不得改成第三人称，不得把口语改成书面腔（原条目本来就书面则照旧）。输出必须是改写后的片段本身，能无缝拼回原位：保持与前后文的衔接，不要输出选区之外的内容，不要解释或感悟发挥。',
      en: 'Rewrite ONLY the selected diary excerpt below: keep **the recorded facts, time/place, the people involved and the judgement of the moment**, but restructure the wording — you may adjust sentence length, merge fragmentary short sentences, and straighten order; but **never add to the memory** (no scenes, dialogue, psychology or causality not already written), do not switch to third person, do not turn the colloquial into a literary register (keep it as-is if the entry was already literary). Output the rewritten excerpt itself, ready to be spliced back seamlessly: keep coherence with the surrounding text; do not output anything beyond the excerpt; no explanations or reflections.',
    },
    summarize: {
      zh: '请总结下面的【选中日记片段】：它记了哪些事、涉及哪些人、作者当时的情绪或判断是什么（要点式，控制在 150 字以内）。**只按原文说，不得补写原文没有的因果与动机**，不要评价文笔，也不要替作者「升华」。只总结选中片段本身。',
      en: 'Summarize the selected diary excerpt below: what events it records, who is involved, and the author’s emotion or judgement at the time (bullets, within 150 characters). **Say only what the text says; do not add causality or motivation not present**, do not judge the writing, and do not "elevate" it for the author. Summarize only the excerpt itself.',
    },
  },
};

/**
 * 取体裁的**选区**提示词包。**唯一的兜底点**：未设置 / 脏值经 `workbenchCommandSet` 落 novel。
 * 调用方拿到 pack 后不许再看 genre 原值。
 */
export function genreSelectionPack(genre?: string | null): GenreSelectionPack {
  return GENRE_SELECTION_PACKS[workbenchCommandSet(genre ?? '')];
}
