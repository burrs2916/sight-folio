// ㉡ topicStartersGenre.test.ts —— AI-4b′（2026-11-10 轮 14）：题材 tab 起步示例按体裁。
//
// 钉六件事（护栏口径沿用 ㉟ starterGenrePrompts 套：面板重渲染无既有先例，接线走源码锁，
// 牙齿由轮内反证给——AU-7 ⑨ 说清了为什么这里不硬造真渲染）：
//  1. novel 十一组 43 枚 prompt/labelKey 逐字 = 改造前 `STARTER_PROMPTS_BOOK_TOPIC`
//     （原文对由脚本从改前磁盘文件程序化取出、独立存进本文件，不是凭印象）；
//  2. 每支每组的槽位 key 序列与 novel 逐位相同（芯片 key 是槽位身份，不是措辞）；
//  3. 已登记八组（catalog/timeline/writing/stats/overview/characters/inspiration/proofread）× 非小说四支：
//     不领 novel 行 + 蹭词扫描 + 本体词在场（㉣ 起剧本另加 storylines/foreshadowing 两组单测）；
//     `timeline.fill` 五支同文（它不含单位词）——共用格逐字 == novel 行，防漂；
//  4. 记债账：可见而未换词的 (支, 组) 恰好 = 登记清单（22 格）；worldview 对四支是被裁视图，
//     落 novel 行不可见，**不记债**（测试拿 hiddenViewKindsForGenre 反查，不留口头保证）；
//  5. 代码场景四枚与全书总览问句 = 搬走前逐字（搬表 + 语言对化不许改一个字）；
//  6. 接线与旧表绝迹 + 新标签键双语穷尽/零孤儿 + 本模块常量零嵌 `L()`（aiLang 成规）。
//
// ㉢（AI-4b″，2026-11-10 轮 15）再登两组：**stats + overview × 非小说四支**，并按体裁翻
//   `bookOverviewPrompt(genre)`。队列钉死的同轮义务：overview 组的维度串与全书总览那颗按钮是
//   **同一张嘴**（轮 14 台账原话「只收其中一张、漏掉另一张就是账分叉」）——本套按「维度列
//   三张嘴逐字对锁」替这条口头纪律长牙。DEBT 同轮翻账：22 格划掉 8 格（stats/overview × 四支）
//   → 14 格，多一格少一格都红。判据全程现成：分组/单位词吃 `bandGroup/bandUnitSize/bandUncategorized`
//   槽位口径，离群行按 `outlierMeaninglessForGenre` 分岔（剧本照判，合集型不判），
//   维度列按 `hiddenViewKindsForGenre` 反查（轮 11 同款）。
//
// ㉣（AI-4b‴，2026-11-10 轮 16）登最后一批：**characters / proofread / inspiration × 四支
//   + 剧本 storylines / foreshadowing**。characters 的口径逐句搬轮 13 `CHARACTER` 五支表（零自创：
//   诗「说话的人/不建议先建卡」、日记「那天在场/不下心理诊断/不替作者解释他自己」、
//   散文「只按写过的事迹说/不得补写记忆」、剧本「要什么谁挡着/遮名辨声/卡上只认可证的」）；
//   伏笔 plant 对剧本说「在后面哪一场」（轮 12 台账点名的最后一笔）。novel 标签带「人设/成章」
//   的格按支换键；**不含单位词的格走共用同文**（proofread.read × 四支、foreshadowing.abandon）
//   —— 共用格逐字 == novel 行由测试锁死，防「顺手改」。翻账：DEBT 14 → **0**，本套自此债账
//   翻成**绝迹锁**：derived 只要恢复一格（登记行漂回 novel 行）就红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { topicStartersFor, codeStarters, bookOverviewPrompt, type BookTopicKey } from '../starterPrompts';
import { hiddenViewKindsForGenre } from '../../utils/writingSchema';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MODULE_SRC = read('src/ai/starterPrompts.ts');

const TOPICS = ['characters','worldview','catalog','timeline','storylines','foreshadowing','inspiration','proofread','stats','writing','overview'] as const;
const VARIANTS = ['novel','essay','poetry','script','diary'] as const;
/** 已换词的组（轮 14 三组 + ㉢ 本轮两组；其余组在记债账里） */
const DONE = ['catalog','timeline','writing','stats','overview'] as const;

// ── 改造前 `STARTER_PROMPTS_BOOK_TOPIC` 原文（脚本程序化抽取，逐字独立另存 = 零回归对锁） ──
const NOVEL_ORIGINAL: Record<BookTopicKey, Array<[string, string, string, string]>> = {
  characters: [
    ['design', 'workbench.aiStarter.book.characters.design', '帮我设计一个新人物：给出姓名、外貌、性格、动机、口头禅与一段背景，并说明他在书中承担的角色弧光。', 'Help me design a new character: name, appearance, personality, motivation, catchphrase and a backstory, plus the character arc they carry in the book.'],
    ['enrich', 'workbench.aiStarter.book.characters.enrich', '针对当前人物，补强外貌 / 性格 / 动机 / 口头禅，让人设更立体、前后一致。', "Enrich the current character's appearance / personality / motivation / catchphrase so the persona is more vivid and consistent."],
    ['relations', 'workbench.aiStarter.book.characters.relations', '梳理当前人物与其它角色的关系网，指出潜在的冲突与羁绊。', "Map the current character's relationship network with other characters; point out potential conflicts and bonds."],
    ['check', 'workbench.aiStarter.book.characters.check', '对照全书，检查该人物是否出现性格 / 动机矛盾或行为 OOC，逐条列出并给修改建议。', 'Against the whole book, check the character for personality / motivation contradictions or out-of-character behavior; list them with revision suggestions.'],
  ],
  worldview: [
    ['build', 'workbench.aiStarter.book.worldview.build', '帮我设计一个世界观要素（地理 / 历史 / 规则 / 势力），并说明它与情节如何咬合。', 'Help me design a worldbuilding element (geography / history / rules / faction) and explain how it meshes with the plot.'],
    ['coherence', 'workbench.aiStarter.book.worldview.coherence', '检查当前设定的内部逻辑是否自洽，指出漏洞与例外未覆盖处。', 'Check the current setting for internal logical coherence; point out holes and unhandled exceptions.'],
    ['factions', 'workbench.aiStarter.book.worldview.factions', '梳理各势力的权力结构与核心矛盾，说明它们如何推动情节。', 'Map the power structure and core conflicts of the factions, and how they drive the plot.'],
    ['archive', 'workbench.aiStarter.book.worldview.archive', '把下面这段设定整理成结构化档案（类型 / 规则 / 例外 / 关联章节）。', 'Turn the setting below into a structured profile (type / rules / exceptions / related chapters).'],
  ],
  catalog: [
    ['structure', 'workbench.aiStarter.book.catalog.structure', '帮我规划全书的分卷分章结构与时序，给出每卷的叙事目标。', "Help me plan the book's volume / chapter structure and timeline, with a narrative goal per volume."],
    ['check', 'workbench.aiStarter.book.catalog.check', '审视当前大纲的连贯性、伏笔回收与叙事节奏，指出断裂或拖沓处。', 'Review the current outline for coherence, foreshadowing payoff and pacing; point out breaks or sagging sections.'],
    ['hook', 'workbench.aiStarter.book.catalog.hook', '为章节开头 / 结尾设计钩子，提升留存与翻页欲。', 'Design hooks for chapter openings / endings to boost retention and page-turn urge.'],
  ],
  timeline: [
    ['conflict', 'workbench.aiStarter.book.timeline.conflict', '审查全书时间线：找出同轨时点碰撞与跨章时间倒挂，逐条说明矛盾所在并给修正建议。', "Review the book's timeline: find same-track when-collisions and cross-chapter inversions, explain each contradiction and suggest fixes."],
    ['arrange', 'workbench.aiStarter.book.timeline.arrange', '为某一章设计时间线事件：此时点该发生什么、由哪些人物/设定参与、与前后章事件如何衔接。', 'Design timeline events for a chapter: what should happen at this point, which characters/settings take part, and how it links to events in adjacent chapters.'],
    ['fill', 'workbench.aiStarter.book.timeline.fill', '针对待补全草稿，逐条给出时点与事件描述的补全建议（尊重我的原文口径，只建议不替我定稿）。', 'For the drafts to complete, suggest a when and an event description for each (respect my wording; suggest only, never finalise for me).'],
    ['density', 'workbench.aiStarter.book.timeline.density', '分析时间线覆盖与节奏：哪些章还没有锚定事件、哪些区段过密或过疏，给出补齐优先级。', 'Analyse timeline coverage and pacing: which chapters lack anchored events, which stretches are too dense or too sparse, and what to fill first.'],
  ],
  storylines: [
    ['design', 'workbench.aiStarter.book.storylines.design', '帮我为这本书设计一条新的剧情线（主线/支线/感情线皆可）：给出线名、一句话定位、起承转合的关键事件与结局走向。', 'Help me design a new storyline (main / subplot / romance): give it a name, a one-line premise, key events from setup to payoff, and where it ends.'],
    ['weave', 'workbench.aiStarter.book.storylines.weave', '对照现有剧情线与时间线事件，检查每条线的推进是否连贯、哪条线太久没有事件、给出穿插节奏建议。', 'Against the current storylines and timeline events, check whether each line progresses coherently, which line has gone quiet, and suggest interleaving rhythm.'],
    ['untangle', 'workbench.aiStarter.book.storylines.untangle', '梳理多条剧情线之间的交叉点与冲突：哪些事件同时推进多条线、哪里会互相抢戏，给出编排建议。', 'Untangle intersections and conflicts between storylines: which events advance multiple lines at once, where they compete for attention, and how to arrange them.'],
    ['coverage', 'workbench.aiStarter.book.storylines.coverage', '分析剧情线挂线情况：未挂线事件应该归入哪条线或需要新线，逐条给建议（只建议不替我定稿）。', 'Analyse storyline attachment: for unlined events, suggest which line each belongs to or whether a new line is needed (suggest only, never finalise for me).'],
  ],
  foreshadowing: [
    ['plant', 'workbench.aiStarter.book.foreshadowing.plant', '为当前章节设计伏笔：给出可埋下的物件/台词/悬念（越轻越好），并说明它适合在后面哪一章、以什么方式回收。', 'Design foreshadowing for the current chapter: propose a light-weight object / line of dialogue / suspense to plant, and suggest which later chapter should pay it off and how.'],
    ['check', 'workbench.aiStarter.book.foreshadowing.check', '审查全书伏笔清单：哪些待回收的伏笔埋得太重或太轻、哪些回收计划跨度太大容易被读者遗忘，逐条给建议。', "Review the book's foreshadowing list: which pending plants are too heavy or too subtle, which payoff spans are so long readers may forget them; give itemised suggestions."],
    ['weave', 'workbench.aiStarter.book.foreshadowing.weave', '为每条待回收伏笔设计回收场景：在计划回收章如何自然兑现、需要哪些人物在场、与剧情线如何交织（只建议不替我定稿）。', 'Design payoff scenes for each pending foreshadowing: how to pay it off naturally in the planned chapter, which characters should be present, and how it weaves into the storylines (suggest only, never finalise for me).'],
    ['abandon', 'workbench.aiStarter.book.foreshadowing.abandon', '检查已弃置/长期未回收的伏笔：它们是否还值得捡回？给出捡回或正式弃置的建议（弃置不丢人，干净比强行回收更好）。', 'Review abandoned / long-pending foreshadowing: is each still worth picking up? Recommend picking it back up or abandoning it cleanly (a clean drop beats a forced payoff).'],
  ],
  inspiration: [
    ['brainstorm', 'workbench.aiStarter.book.inspiration.brainstorm', '基于全书题材与念头池里已有的念头，脑暴 8-10 个新念头（一句一个），标注每个念头的类型（情节/人物/世界观/桥段），不与已有念头重复。', "Based on the book's genre and the ideas already in the pool, brainstorm 8-10 new ideas (one line each), tag each with its type (plot / character / worldbuilding / trope), and avoid duplicating existing ones."],
    ['triage', 'workbench.aiStarter.book.inspiration.triage', '审视念头池：哪些念头值得优先发展成时间线事件或伏笔？给出分诊排序（A=马上用 / B=值得养 / C=先放着）与理由。', 'Review the idea pool: which ideas are worth developing into timeline events or foreshadowing first? Give a triage ranking (A=use now / B=worth nurturing / C=park for later) with reasons.'],
    ['bridge', 'workbench.aiStarter.book.inspiration.bridge', '挑一条最有潜力的念头，展开成一组节拍（3-5 拍），并建议它适合挂在哪一章、与现有剧情线如何衔接。', 'Pick the most promising idea and expand it into a beat sequence (3-5 beats), suggesting which chapter it belongs to and how it ties into the existing storylines.'],
    ['prune', 'workbench.aiStarter.book.inspiration.prune', '找出念头池里过期、重复或已被后续设定覆盖的念头，逐条给出删除或合并建议（删除不可怕，池子干净才转得动）。', 'Find stale, duplicated or superseded ideas in the pool and recommend deleting or merging each (deleting is fine — a clean pool dispatches faster).'],
  ],
  proofread: [
    ['read', 'workbench.aiStarter.book.proofread.read', '对照体检报告，按优先级指出最值得先处理的 3 个问题：为什么是它们、处理顺序怎么排、各自一句话修法。', 'Against the proofread report, name the top 3 issues worth fixing first: why they matter, the order to tackle them, and a one-line fix for each.'],
    ['punct', 'workbench.aiStarter.book.proofread.punct', '细读指定章节，找出错别字、标点误用与重复标点，逐条给出原文位置与改法（只指出不直接改稿）。', 'Read the given chapter closely and list typos, punctuation misuse and repeated punctuation, each with its location and suggested fix (point out only, do not rewrite).'],
    ['repeat', 'workbench.aiStarter.book.proofread.repeat', '检查指定章节的重复用词与口头禅式表达：哪些词在短距离内反复出现、哪些描写句式雷同，给出替换建议。', 'Check the given chapter for repeated wording and catchphrase-style expressions: which words recur within short spans, which descriptive sentences feel duplicated, with replacement suggestions.'],
    ['flow', 'workbench.aiStarter.book.proofread.flow', '通读指定章节，检查叙事连贯性：时间跳跃是否交代、人物行为是否合乎动机、前后信息是否矛盾，逐条列出。', 'Read the given chapter through and check narrative coherence: unexplained time jumps, actions that contradict motivations, internal contradictions — list each one.'],
  ],
  stats: [
    ['pacing', 'workbench.aiStarter.book.stats.pacing', '基于写作统计（体量 KPI + 卷分布 + 章节体量），分析全书的叙事节奏：哪些区段偏拖沓或仓促、卷与卷之间的体量配比是否合理，给出调整建议（尊重创作意图，advisory 仅供参考）。', "Based on the writing stats (KPIs, volume distribution, chapter sizes), analyse the book's pacing: which stretches drag or rush, whether volume proportions are balanced; suggest adjustments (respect my intent, advisory only)."],
    ['distribution', 'workbench.aiStarter.book.stats.distribution', '对照卷分布数据，评估各卷的章数/完稿进度/字数是否头重脚轻或失衡，给出后续卷的体量规划建议。', 'Against the volume distribution, assess whether chapters / finished ratio / word counts per volume are top-heavy or unbalanced; suggest size planning for upcoming volumes.'],
    ['outliers', 'workbench.aiStarter.book.stats.outliers', '逐个审视离群章节（超长/偏短）：结合它在全书中的位置判断是刻意的节奏设计还是失控，分别给扩写或拆分/合并或补写的建议。', 'Review each outlier chapter (long / short) in its book context: is it deliberate pacing or out of control? Suggest expansion / splitting / merging / filling per case.'],
    ['goal', 'workbench.aiStarter.book.stats.goal', '基于日更趋势与当前日更目标，评估目标是否现实可持续，给出目标值与写作节奏的调整建议（不催更、不施压）。', 'Based on the daily trend and current daily goal, assess whether the goal is realistic and sustainable; suggest goal and rhythm adjustments (no nagging, no pressure).'],
  ],
  writing: [
    ['continue', 'workbench.aiStarter.book.writing.continue', '续写当前章：从正文结尾自然衔接，保持已有的语气、人称与时态，推进 300-500 字（给出可直接粘贴的正文，不要解释）。', 'Continue the current chapter from where the prose ends, matching the existing voice, person and tense; advance 300-500 words (give paste-ready prose, no explanations).'],
    ['polish', 'workbench.aiStarter.book.writing.polish', '细读当前章正文，按段落指出可打磨处：节奏拖沓、描写空洞、对话生硬、信息重复，每条给出原文与改写示例（只建议不直接改稿）。', 'Read the current chapter closely and point out per-paragraph improvements: sagging pacing, hollow description, stiff dialogue, repeated information — quote the original and give a rewrite example (suggest only, do not edit directly).'],
    ['consistency', 'workbench.aiStarter.book.writing.consistency', '对照前情提要与章节骨架，检查当前章是否与已有情节矛盾（时间线/人物状态/设定），逐条列出矛盾点与修法。', 'Against the previously-summary and chapter skeleton, check the current chapter for contradictions with existing plot (timeline / character state / settings); list each conflict with a fix.'],
    ['scene', 'workbench.aiStarter.book.writing.scene', '为当前章设计下一个场景：给出场景目标、出场人物、开场钩子与结束悬念（贴合已有剧情线与人物动机，只建议不替我定稿）。', 'Design the next scene for the current chapter: scene goal, cast, opening hook and ending suspense (fit existing storylines and motivations; suggest only, never finalise for me).'],
  ],
  overview: [
    ['health', 'workbench.aiStarter.book.overview.health', '给我一份全书健康度体检：① 体量进度与叙事节奏是否健康；② 各维度（人物/世界观/时间线/剧情线/伏笔/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿。', "Give me a whole-book health check: ① is size/progress/pacing healthy; ② the state of each dimension (characters / worldbuilding / timeline / storylines / foreshadowing / ideas / proofread) and which to prioritise; ③ the 3 most urgent risks, each with a one-line fix. Diagnose only, don't rewrite."],
    ['continuity', 'workbench.aiStarter.book.overview.continuity', '做一份全书叙事连续性审查：① 时间线同轨冲突与跨章时间倒挂；② 伏笔埋设与回收是否对得上、有无长期未回收的悬空伏笔；③ 主要人物是否出现性格/动机矛盾或行为 OOC；④ 各章骨架衔接是否断裂。逐条给出证据（章节/事件）与修法。', 'Run a whole-book narrative-continuity audit: ① same-track timeline conflicts and cross-chapter inversions; ② foreshadowing plants vs payoffs, any long-unpaid floating plants; ③ main characters with personality/motivation contradictions or OOC behavior; ④ chapter-skeleton hand-offs that break. Cite evidence (chapter/event) and fixes per item.'],
    ['dimension', 'workbench.aiStarter.book.overview.dimension', '挑当前最薄弱的一个维度（人物/世界观/时间线/剧情线/伏笔/灵感/校对），结合全书总览数据说明它为什么薄弱、应该先补哪 3 件事、按什么顺序。', "Pick the weakest dimension right now (characters / worldbuilding / timeline / storylines / foreshadowing / ideas / proofread), explain from the overview data why it's weak, and what 3 things to fix first and in what order."],
    ['risk', 'workbench.aiStarter.book.overview.risk', '把全书总览里的风险预警（时间线冲突 / 跨章伏笔 / 孤立设定 / 未落章节拍 / 校对问题）按「影响 × 紧迫」排个序，给出一张可执行的处置清单（每条：做什么、涉及哪章、预估工作量）。', "Rank the overview's risk warnings (timeline conflicts / cross-chapter foreshadowing / orphan settings / unanchored beats / proofread issues) by impact × urgency, and give an actionable remediation list (each: what to do, which chapter, rough effort)."],
  ],
};

// ── 代码场景四枚 + 全书总览问句的改前原文（同为程序化抽取） ──
const CODE_ORIGINAL: Array<[string, string, string, string]> = [
  ['explain', 'workbench.aiStarter.explain', '解释当前文件的作用、结构与关键逻辑', "Explain this file's purpose, structure, and key logic"],
  ['fix', 'workbench.aiStarter.fix', '修复当前文件里的报错', 'Fix the errors reported in the current file'],
  ['refactor', 'workbench.aiStarter.refactor', '重构当前选中的代码，提升可读性与可维护性', 'Refactor the selected code to improve readability and maintainability'],
  ['tests', 'workbench.aiStarter.tests', '为当前选中的代码编写单元测试', 'Write unit tests for the selected code'],
];
const BOOK_OVERVIEW_ORIGINAL_ZH = '基于上面的全书总览，给我一份全书健康度体检：① 体量进度与叙事节奏是否健康；② 各题材维度（人物/世界观/时间线/剧情线/伏笔/灵感/校对）分别处于什么状态、最该优先补哪一块；③ 列出 3 个最值得立刻处理的风险点，每条给一句话处置建议。只诊断不直接改稿。';
const BOOK_OVERVIEW_ORIGINAL_EN = "Based on the book overview above, give me a health check: ① is the size/progress/pacing healthy; ② the state of each dimension (characters / worldbuilding / timeline / plotlines / foreshadowing / ideas / proofread) and which to prioritise; ③ list the 3 most urgent risks with a one-line fix each. Diagnose only, don't rewrite.";

const zhJoin = (v: string, topics: readonly string[]) =>
  topics.flatMap((tp) => topicStartersFor(v, tp as BookTopicKey).map((s) => s.prompt)).join('\n');

describe('㉡ AI-4b′：形状穷尽（槽位序列五支逐位相同）', () => {
  for (const tp of TOPICS) {
    it(`${tp}：各支槽位 key 序列 == novel`, () => {
      const base = topicStartersFor('novel', tp);
      for (const v of VARIANTS) {
        const row = topicStartersFor(v, tp);
        expect(row.map((s) => s.key), `${v}/${tp}`).toEqual(base.map((s) => s.key));
        for (const s of row) expect(s.labelKey, `${v}/${tp}/${s.key}`).toMatch(/^workbench\.aiStarter\.book\./);
      }
    });
  }
  it('未设 / 空 / 脏体裁值 = novel 行逐字节回落（判据 = workbenchCommandSet）', () => {
    for (const tp of TOPICS) {
      const novel = topicStartersFor('novel', tp);
      for (const g of [undefined, null, '', 'novel', 'zzz', 'DIARY'] as Array<string | null | undefined>) {
        expect(topicStartersFor(g as string, tp), `${tp}/${String(g)}`).toEqual(novel);
      }
    }
  });
});

describe('㉡ AI-4b′：novel 十一组逐字零回归（改前原文对锁）', () => {
  for (const tp of TOPICS) {
    it(`${tp}：43 枚中的本组 key/labelKey/prompt(zh) 逐字，en 在模块源逐字在场`, () => {
      const row = topicStartersFor('novel', tp);
      const orig = NOVEL_ORIGINAL[tp];
      expect(row.map((s) => s.key)).toEqual(orig.map(([k]) => k));
      expect(row.map((s) => s.labelKey)).toEqual(orig.map(([, lk]) => lk));
      orig.forEach(([k, , zh, en], i) => {
        expect(row[i].prompt, `${tp}/${k} zh`).toBe(zh);
        expect(MODULE_SRC, `${tp}/${k} en 逐字`).toContain(en);
      });
    });
  }
});

describe('㉡ AI-4b′ + ㉢ AI-4b″ + ㉣ AI-4b‴：已登记的八组 × 非小说四支（换词 + 蹭词 + 本体词）', () => {
  for (const v of ['essay', 'poetry', 'script', 'diary'] as const) {
    for (const tp of DONE) {
      it(`${v}/${tp}：不领 novel 行（至少一枚不同；共用格逐字锁在下一套）`, () => {
        const row = topicStartersFor(v, tp).map((s) => s.prompt);
        const novel = topicStartersFor('novel', tp).map((s) => s.prompt);
        expect(row.join('\u0000'), `${v}/${tp}`).not.toEqual(novel.join('\u0000'));
      });
    }
  }
  it('诗集八组：无 章/小说/情节/伏笔/人设/一幕，且「分行」「分辑」在场', () => {
    const zh = zhJoin('poetry', DONE);
    for (const bad of ['章节', '小说', '情节', '伏笔', '人设', '一幕']) expect(zh, `诗领到「${bad}」`).not.toContain(bad);
    expect(zh).toContain('分行');
    expect(zh).toContain('分辑');
  });
  it('散文集八组：无 章/诗/幕/伏笔/人设，且「立意」「篇目」在场', () => {
    const zh = zhJoin('essay', DONE);
    for (const bad of ['章节', '小说', '一首', '幕', '伏笔', '人设']) expect(zh, `散文领到「${bad}」`).not.toContain(bad);
    expect(zh).toContain('立意');
    expect(zh).toContain('篇目');
  });
  it('剧本八组：无 章/小说/意象/诗，且「台词」「幕」在场', () => {
    const zh = zhJoin('script', DONE);
    for (const bad of ['章节', '小说', '意象', '诗']) expect(zh, `剧本领到「${bad}」`).not.toContain(bad);
    expect(zh).toContain('台词');
    expect(zh).toContain('幕');
  });
  it('日记本八组：无 章/小说/情节/伏笔/人设，且「当天」「不替作者」在场', () => {
    const zh = zhJoin('diary', DONE);
    for (const bad of ['章节', '小说', '情节', '伏笔', '人设']) expect(zh, `日记领到「${bad}」`).not.toContain(bad);
    expect(zh).toContain('当天');
    expect(zh).toContain('不替作者');
  });
});

describe('㉡ AI-4b′ + ㉢ AI-4b″：共用格不漂 + 换标签的格不许顶着小说标签', () => {
  for (const v of ['essay', 'poetry', 'script', 'diary']) {
    it(`${v} 的 timeline.fill 逐字 = novel 行（它不含单位词，五支同文）`, () => {
      const row = topicStartersFor(v, 'timeline').find((s) => s.key === 'fill');
      const novel = topicStartersFor('novel', 'timeline').find((s) => s.key === 'fill');
      expect(row).toEqual(novel);
    });
    it(`${v} 的 stats.goal 逐字 = novel 行（㉢：日更目标不含单位词，五支同文）`, () => {
      const row = topicStartersFor(v, 'stats').find((s) => s.key === 'goal');
      const novel = topicStartersFor('novel', 'stats').find((s) => s.key === 'goal');
      expect(row).toEqual(novel);
    });
    it(`${v}：novel 标签带单位词的格（排章事件/本章打磨）必须换键`, () => {
      const byKey = (tp: BookTopicKey, k: string) => topicStartersFor(v, tp).find((s) => s.key === k)!.labelKey;
      expect(byKey('timeline', 'arrange'), `${v} arrange 仍顶着「排章事件」`).not.toBe(NOVEL_ORIGINAL.timeline[1][1]);
      expect(byKey('writing', 'polish'), `${v} polish 仍顶着「本章打磨」`).not.toBe(NOVEL_ORIGINAL.writing[1][1]);
    });
    it(`${v}：stats.outliers 按 outlierMeaninglessForGenre 分岔——剧本留着，合集型必须换键`, () => {
      const lk = topicStartersFor(v, 'stats').find((s) => s.key === 'outliers')!.labelKey;
      if (v === 'script') {
        // 剧本离群行照判（场次体量是节奏工具）：标签不换才是诚实
        expect(lk).toBe(NOVEL_ORIGINAL.stats[2][1]);
      } else {
        expect(lk, `${v} 的离群格仍顶着「离群诊断」（统计页对它一条不判）`).not.toBe(NOVEL_ORIGINAL.stats[2][1]);
      }
    });
    it(`${v}：overview.health 的 book 级词换书才换键（散文叫全书，顶着的就还是它）`, () => {
      const lk = topicStartersFor(v, 'overview').find((s) => s.key === 'health')!.labelKey;
      if (v === 'essay') {
        expect(lk).toBe(NOVEL_ORIGINAL.overview[0][1]);
      } else {
        expect(lk, `${v} 的体检格仍顶着「全书体检」`).not.toBe(NOVEL_ORIGINAL.overview[0][1]);
      }
    });
  }
});

describe('㉡ AI-4b′ + ㉢ AI-4b″ + ㉣ AI-4b‴：记债账（可见而未换词的格子必须为零）', () => {
  // 轮 12 拆刀原话「一刀收不完 11 组」。轮 14 登三组、㉢ 登两组、㉣ 再登三组（剧本另加 storylines/foreshadowing
  // 两组）→ 十组登记齐；第十一组 worldview 对四支是被裁视图（下面用 hiddenViewKindsForGenre 反查），
  // 落 novel 行不可见。债账从本刀起**翻成绝迹锁**：derived 再出现任意一格 = 某登记行悄悄漂回 novel 行。
  // 翻账纪律按队列走完：22 → 14 → **0**，多一格少一格都红。
  const DEBT: string[] = [];
  it('derived == 登记清单（0 格 —— ㉣ 清账：14 格 = characters/proofread/inspiration × 四支 + 剧本两组）', () => {
    const derived: string[] = [];
    for (const v of ['essay', 'poetry', 'script', 'diary']) {
      const hidden = hiddenViewKindsForGenre(v);
      for (const tp of TOPICS) {
        if (hidden.includes(tp)) continue;
        if (JSON.stringify(topicStartersFor(v, tp)) === JSON.stringify(topicStartersFor('novel', tp))) derived.push(`${v}/${tp}`);
      }
    }
    expect([...derived].sort()).toEqual([...DEBT].sort());
    expect(DEBT).toHaveLength(0);
  });
  it('worldview 对四支是被裁视图（不记债的前提成立；判据只查页签表，不留口头保证）', () => {
    for (const v of ['essay', 'poetry', 'diary']) {
      const hidden = hiddenViewKindsForGenre(v);
      expect(hidden, v).toContain('worldview');
      expect(hidden, v).toContain('storylines');
      expect(hidden, v).toContain('foreshadowing');
    }
    expect(hiddenViewKindsForGenre('script')).toEqual(['worldview']);
  });
  it('已登记的八组不许出现在债账里（㉣ 落地后由 derived 绝迹锁接管，漂回即红）', () => {
    for (const v of ['essay', 'poetry', 'script', 'diary']) for (const tp of DONE) expect(DEBT, `${v}/${tp}`).not.toContain(`${v}/${tp}`);
  });
});

describe('㉡ AI-4b′：代码场景四枚 + 全书总览问句 = 搬走前逐字', () => {
  it('codeStarters() 四枚 key/labelKey/prompt(zh) 逐字，en 在模块源逐字在场', () => {
    const row = codeStarters();
    expect(row.map((s) => s.key)).toEqual(CODE_ORIGINAL.map(([k]) => k));
    expect(row.map((s) => s.labelKey)).toEqual(CODE_ORIGINAL.map(([, lk]) => lk));
    CODE_ORIGINAL.forEach(([k, , zh, en], i) => {
      expect(row[i].prompt, `code/${k}`).toBe(zh);
      expect(MODULE_SRC, `code/${k} en`).toContain(en);
    });
  });
  it('全书总览问句：novel（含未设/空/脏值）逐字 = 改造前', () => {
    // 轮 14 的「五支都领这一句」记债锁按队列预告翻面：novel 格逐字不动，四支从本刀起各领各的。
    for (const g of [undefined, null, '', 'novel', 'zzz', 'DIARY'] as Array<string | null | undefined>) {
      expect(bookOverviewPrompt(g as string | null | undefined), `novel/${String(g)}`).toBe(BOOK_OVERVIEW_ORIGINAL_ZH);
    }
    expect(MODULE_SRC).toContain(BOOK_OVERVIEW_ORIGINAL_EN);
  });
  it('四支各领各句：书级词 = overviewHint 现成首词，且不许再领小说那句', () => {
    const book = (g: string) => bookOverviewPrompt(g);
    for (const v of ['essay', 'poetry', 'script', 'diary']) expect(book(v), v).not.toBe(BOOK_OVERVIEW_ORIGINAL_ZH);
    expect(book('essay')).toContain('基于上面的全书总览'); // 散文的书级词本就是「全书」
    expect(book('poetry')).toContain('基于上面的全诗集总览');
    expect(book('script')).toContain('基于上面的全剧总览');
    expect(book('diary')).toContain('基于上面的全本总览');
  });
});

describe('㉡ AI-4b′：接线与旧表绝迹（源码锁）', () => {
  const panel = read('src/editor/panels/WorkbenchAiPanel.tsx');
  it("面板吃 topicStartersFor(genre ?? '', resolvedTopic) / codeStarters() / bookOverviewPrompt(genre ?? '')", () => {
    expect(panel).toMatch(/topicStartersFor\(genre \?\? '', resolvedTopic\)/);
    expect(panel).toMatch(/: codeStarters\(\)/);
    // ㉢ 接线翻面：那颗按钮本刀起吃体裁。裸调用（=「算了 genre 但没接上」形状，AU-7 ⑨）绝迹。
    expect(panel).toContain("void send(bookOverviewPrompt(genre ?? ''));");
    expect(panel).not.toContain('void send(bookOverviewPrompt());');
  });
  it('三张旧表在面板里绝迹（不留第二份真源；轮 5/6/12 删表手法第四次）', () => {
    expect(panel).not.toMatch(/const STARTER_PROMPTS/);
    expect(panel).not.toContain('STARTER_PROMPTS_BOOK_TOPIC');
    expect(panel).not.toContain('BOOK_OVERVIEW_PROMPT');
  });
  it('bookTopic/localTopic 的类型收进 BookTopicKey（联合不再抄三遍）', () => {
    expect(panel).toContain('bookTopic?: BookTopicKey | null;');
    expect(panel).toContain('useState<BookTopicKey | null>(null)');
    expect(panel).not.toMatch(/\| 'foreshadowing'/);
  });
  it('本模块常量零嵌 `L()`（aiLang 成规：存语言对，取用时才定语种）', () => {
    expect(MODULE_SRC).not.toMatch(/\nconst [A-Z_]+ = L\(/);
  });
});

describe('㉡ AI-4b′：新标签键双语穷尽 + 零孤儿（裸键事故防线）', () => {
  const zh = JSON.parse(read('src/i18n/zh-CN.json'));
  const en = JSON.parse(read('src/i18n/en-US.json'));
  const at = (d: unknown, path: string) => path.split('.').reduce<Record<string, unknown>>((c, k) => c?.[k] as Record<string, unknown>, d as Record<string, unknown>);
  const used = [...MODULE_SRC.matchAll(/workbench\.aiStarter\.book\.[A-Za-z.]+/g)].map((m) => m[0]);
  it.each([...new Set(used)])('%s 双语都能解析', (path) => {
    expect(at(zh, path), `${path} zh`).toBeTruthy();
    expect(at(en, path), `${path} en`).toBeTruthy();
  });
  it('i18n 里十一组的标签键全部被模块消费（零孤儿；㉣ 起从已登记五组扩到全表）', () => {
    for (const tp of TOPICS) {
      const grp = at(zh, `workbench.aiStarter.book.${tp}`) as Record<string, unknown>;
      for (const k of Object.keys(grp)) {
        expect(used, `${tp}.${k} 无消费点（孤儿键）`).toContain(`workbench.aiStarter.book.${tp}.${k}`);
      }
    }
  });
});

// ── ㉢ AI-4b″（2026-11-10 轮 15）：stats + overview 两组的判据锁 ─────────────────────
describe('㉢ AI-4b″：overview 三张嘴维度列同一源（health 芯片 / dimension 芯片 / 体检按钮）', () => {
  // 队列钉死的账分叉防线：轮 14 台账明写「overview 组维度串与全书总览那颗按钮共用维度列，
  // 只收一张漏一张 = 账分叉」。这条锁让「两张嘴漂开」当场红，不靠轮间口头接力。
  const dimsIn = (s: string) => (s.match(/维度（([^）]+)）/g) ?? []);
  for (const v of ['novel', 'essay', 'poetry', 'script', 'diary']) {
    it(`${v}：health 与 dimension 的维度列 == bookOverviewPrompt 的维度列`, () => {
      const health = dimsIn(topicStartersFor(v, 'overview').find((s) => s.key === 'health')!.prompt);
      const dimension = dimsIn(topicStartersFor(v, 'overview').find((s) => s.key === 'dimension')!.prompt);
      const button = dimsIn(bookOverviewPrompt(v));
      expect(health.length, `${v} health 维度列应恰有一枚`).toBe(1);
      expect(dimension, `${v} dimension 维度列`).toEqual(health);
      expect(button, `${v} 体检按钮维度列`).toEqual(health);
    });
  }
  it('维度列判据 = 页签表反查：被裁栏的词不许进该支两组，可见栏的词不许被删过头', () => {
    for (const v of ['essay', 'poetry', 'script', 'diary']) {
      const hidden = hiddenViewKindsForGenre(v);
      const zh = zhJoin(v, ['stats', 'overview']);
      if (hidden.includes('worldview')) {
        expect(zh, `${v} 领到世界观`).not.toContain('世界观');
        expect(zh, `${v} 领到世界规则`).not.toContain('世界规则');
      }
      if (hidden.includes('storylines')) expect(zh, `${v} 领到剧情线`).not.toContain('剧情线');
      if (hidden.includes('foreshadowing')) expect(zh, `${v} 领到伏笔`).not.toContain('伏笔');
      // 反方向（过度删除也是分叉）：剧本看得见剧情线/伏笔，它的维度列必须带着这两个词
      if (!hidden.includes('storylines')) expect(zh, `${v} 被删掉了可见栏「剧情线」`).toContain('剧情线');
      if (!hidden.includes('foreshadowing')) expect(zh, `${v} 被删掉了可见栏「伏笔」`).toContain('伏笔');
    }
  });
});

describe('㉢ AI-4b″：stats 两组的分组/单位词吃 band 槽位现成口径 + 本体词在场', () => {
  it('散文集 stats：分组分布 + 各篇体量（不是卷分布/章节体量），书级词 = 全书', () => {
    const zh = zhJoin('essay', ['stats']);
    expect(zh).toContain('分组分布');
    expect(zh).toContain('各篇体量');
    expect(zh).toContain('全书');
    expect(zh).not.toContain('卷分布');
    expect(zh).not.toContain('章节体量');
  });
  it('诗集 stats：分组分布 + 各首体量，书级词 = 全诗集（不假装有卷、不先声称有辑）', () => {
    const zh = zhJoin('poetry', ['stats']);
    expect(zh).toContain('分组分布');
    expect(zh).toContain('各首体量');
    expect(zh).toContain('全诗集');
    expect(zh).not.toContain('卷');
  });
  it('剧本 stats：幕分布 + 各场体量，书级词 = 全剧且一个「全书」都不许有（轮 13 progressLabel 同口径）', () => {
    const zh = zhJoin('script', ['stats']);
    expect(zh).toContain('幕分布');
    expect(zh).toContain('各场体量');
    expect(zh).toContain('全剧');
    expect(zh).not.toContain('全书');
  });
  it('日记本 stats：年月分布 + 各天体量，书级词 = 全本，全线守住「不评价该不该写」', () => {
    const zh = zhJoin('diary', ['stats']);
    expect(zh).toContain('年月分布');
    expect(zh).toContain('各天体量');
    expect(zh).toContain('全本');
    expect(zh).toContain('不评价该不该写');
  });
  it('离群格按 outlierMeaninglessForGenre 分岔：剧本领「离群场次」真问题，合集型三支不许叫模型去审离群', () => {
    expect(topicStartersFor('script', 'stats').find((s) => s.key === 'outliers')!.prompt).toContain('离群场次');
    // 合集型的格子里「离群」只许以**否定式硬线**在场（「不当离群问题/不判离群」——拦着模型自己漂回去），
    // 不许出现 novel 那句的正面问法「审视离群」：统计页对它们一条不判，芯片不许对着不存在的读数提问。
    const REPLACER: Record<string, string> = { essay: '同样长度下', poetry: '标了某体', diary: '密度' };
    for (const v of ['essay', 'poetry', 'diary']) {
      const p = topicStartersFor(v, 'stats').find((s) => s.key === 'outliers')!.prompt;
      expect(p, `${v} 仍叫模型去审「离群」`).not.toMatch(/审视离群|逐个审视离群/);
      expect(p, `${v} 的离群格没换上本体裁的判事`).toContain(REPLACER[v]);
    }
  });
});

// ── ㉣ AI-4b‴（2026-11-10 轮 16）：characters/proofread/inspiration × 四支 + 剧本 storylines/foreshadowing ──
describe('㉣ AI-4b‴：characters/inspiration 的换标签格逐格钉死（没换的格不许偷偷漂）', () => {
  const base = 'workbench.aiStarter.book.';
  const lk = (v: string, tp: BookTopicKey, k: string) => topicStartersFor(v, tp).find((s) => s.key === k)!.labelKey;
  it('novel 五组标签逐字在场（designPerson/designVoice/designRole/relationsVoice/enrich*/check* 全部是**加键**，不是改键）', () => {
    expect(topicStartersFor('novel', 'characters').map((s) => s.labelKey)).toEqual(
      ['characters.design', 'characters.enrich', 'characters.relations', 'characters.check'].map((x) => base + x));
    expect(topicStartersFor('novel', 'inspiration').map((s) => s.labelKey)).toEqual(
      ['inspiration.brainstorm', 'inspiration.triage', 'inspiration.bridge', 'inspiration.prune'].map((x) => base + x));
  });
  it('带「人设/成章」的格四支全换键；四支的 proofread 四格标签一格未换', () => {
    for (const v of ['essay', 'poetry', 'script', 'diary']) {
      for (const [tp, k] of [['characters', 'enrich'], ['characters', 'check'], ['inspiration', 'bridge']] as const) {
        expect(lk(v, tp, k), `${v}/${tp}.${k} 仍顶着 novel 标签`).not.toBe(base + `${tp}.${k}`);
      }
      expect(topicStartersFor(v, 'proofread').map((s) => s.labelKey)).toEqual(
        topicStartersFor('novel', 'proofread').map((s) => s.labelKey));
    }
  });
  it('design/relations 的换键只发生在判据点名到的支：其余支仍顶原键（多换=过度改写，少换=漏口）', () => {
    for (const v of ['essay', 'poetry', 'script', 'diary']) expect(lk(v, 'characters', 'design')).not.toBe(base + 'characters.design');
    for (const v of ['essay', 'script', 'diary']) expect(lk(v, 'characters', 'relations'), `${v} relations 多换了`).toBe(base + 'characters.relations');
    expect(lk('poetry', 'characters', 'relations'), '诗的关系格没换成出现人物对照').toBe(base + 'characters.relationsVoice');
  });
  it('剧本 storylines/foreshadowing 八格标签一格不换（novel 标签本来就不带单位词，换它=无事生非）', () => {
    for (const tp of ['storylines', 'foreshadowing'] as const) {
      expect(topicStartersFor('script', tp).map((s) => s.labelKey)).toEqual(topicStartersFor('novel', tp).map((s) => s.labelKey));
    }
  });
});

describe('㉣ AI-4b‴：共用格同文 + 剧本两组（plant「哪一场」= 轮 12 台账最后一笔）', () => {
  it('proofread.read 五支同文（不含单位词与叙事腔，逐字 == novel 行）', () => {
    const novel = topicStartersFor('novel', 'proofread').find((s) => s.key === 'read')!;
    for (const v of ['essay', 'poetry', 'script', 'diary']) {
      expect(topicStartersFor(v, 'proofread').find((s) => s.key === 'read'), v).toEqual(novel);
    }
  });
  it('剧本 foreshadowing.abandon 逐字 == novel 行（弃置不丢人——与单位无关，五支同文）', () => {
    expect(topicStartersFor('script', 'foreshadowing').find((s) => s.key === 'abandon'))
      .toEqual(topicStartersFor('novel', 'foreshadowing').find((s) => s.key === 'abandon'));
  });
  it('剧本两组不领 novel 行；plant 说「在后面哪一场」，一个「章」字不许有', () => {
    for (const tp of ['storylines', 'foreshadowing'] as const) {
      expect(JSON.stringify(topicStartersFor('script', tp)), tp).not.toEqual(JSON.stringify(topicStartersFor('novel', tp)));
    }
    const plant = topicStartersFor('script', 'foreshadowing').find((s) => s.key === 'plant')!.prompt;
    expect(plant).toContain('哪一场');
    expect(plant).not.toContain('哪一章');
  });
});

describe('㉣ AI-4b‴：五支硬线各回各的芯片（判据逐字搬轮 13 `CHARACTER` + DIAGNOSE 已立口径）', () => {
  it('四支 × 三组逐格带本体裁硬线（一格掉线即红）', () => {
    const HARDLINES: Record<'essay' | 'poetry' | 'script' | 'diary', [BookTopicKey, string, string][]> = {
      essay: [
        ['characters', 'design', '人物卡'], ['characters', 'design', '不得替作者补写记忆'],
        ['characters', 'enrich', '像不像本人'], ['characters', 'check', '不得断定哪一篇写得对'],
        ['inspiration', 'brainstorm', '立意/人事/景物/句子'], ['inspiration', 'triage', '并进现有篇目'],
        ['inspiration', 'bridge', '独立成篇'], ['inspiration', 'prune', '被后来的篇目用掉'],
        ['proofread', 'punct', '指定篇目'], ['proofread', 'repeat', '指定篇目'],
        ['proofread', 'flow', '由事入景'], ['proofread', 'flow', '不替作者补足他没写的结论'],
      ],
      poetry: [
        ['characters', 'design', '说话的人'], ['characters', 'design', '不替作者指认'],
        ['characters', 'enrich', '分行与节次'], ['characters', 'check', '不得建议先建卡'],
        ['characters', 'relations', '赠诗的对象'],
        ['inspiration', 'brainstorm', '意象/分行/题目/形式'], ['inspiration', 'triage', '写成一首'],
        ['inspiration', 'bridge', '拟标什么形式'], ['inspiration', 'prune', '被某首诗用掉'],
        ['proofread', 'punct', '省标点'], ['proofread', 'repeat', '咏叹不算'],
        ['proofread', 'flow', '不按散文的连贯性'], ['proofread', 'flow', '不替诗总结'],
      ],
      script: [
        ['characters', 'design', '谁挡着'], ['characters', 'enrich', '台词'],
        ['characters', 'check', '遮住角色名'], ['characters', 'relations', '谁挡着谁'],
        ['inspiration', 'brainstorm', '冲突回合/人物口吻/场面/台词'], ['inspiration', 'triage', '单独成一场'],
        ['inspiration', 'bridge', '冲突回合'], ['inspiration', 'prune', '被现有场次用掉'],
        ['proofread', 'punct', '括注指示独立成行'], ['proofread', 'repeat', '越说越像同一个人'],
        ['proofread', 'flow', '场面衔接'],
        ['storylines', 'weave', '太久没等到属于它的场次'], ['storylines', 'coverage', '单开一场'],
        ['foreshadowing', 'plant', '哪一场'], ['foreshadowing', 'check', '观众'],
        ['foreshadowing', 'weave', '哪些人物同场'],
      ],
      diary: [
        ['characters', 'design', '可选建档'], ['characters', 'design', '不得替作者补写'],
        ['characters', 'enrich', '不替作者补写'], ['characters', 'check', '不下心理诊断'],
        ['characters', 'check', '不替作者解释他自己'],
        ['inspiration', 'brainstorm', '只从已记的事出发'], ['inspiration', 'triage', '不追问为什么当时没写'],
        ['inspiration', 'bridge', '哪一天'], ['inspiration', 'prune', '没落地不等于作废'],
        ['proofread', 'punct', '只有作者懂的说法不算误用'], ['proofread', 'repeat', '同一心结跨条目反复出现只摆出来'],
        ['proofread', 'flow', '不要求它起承转合'], ['proofread', 'flow', '不替作者补因果'],
      ],
    };
    for (const v of ['essay', 'poetry', 'script', 'diary'] as const) {
      for (const [tp, k, needle] of HARDLINES[v]) {
        const p = topicStartersFor(v, tp).find((s) => s.key === k)!.prompt;
        expect(p, `${v}/${tp}.${k} 丢了硬线「${needle}」`).toContain(needle);
      }
    }
  });
  it('三组全线守铁律：被裁栏的词与异裁量词一格不许有（蹭词扫描的组级补充）', () => {
    for (const v of ['essay', 'poetry', 'script', 'diary'] as const) {
      const zh = zhJoin(v, ['characters', 'inspiration', 'proofread']);
      if (v === 'poetry') for (const bad of ['幕', '角色表']) expect(zh, `诗领到「${bad}」`).not.toContain(bad);
      if (v === 'essay') for (const bad of ['幕', '角色表', '一首']) expect(zh, `散文领到「${bad}」`).not.toContain(bad);
      if (v === 'script') for (const bad of ['一首', '篇目']) expect(zh, `剧本领到「${bad}」`).not.toContain(bad);
      if (v === 'diary') for (const bad of ['幕', '角色表', '一首', '篇', '首']) expect(zh, `日记领到「${bad}」`).not.toContain(bad);
      for (const tp of ['characters', 'inspiration', 'proofread'] as const) {
        expect(JSON.stringify(topicStartersFor(v, tp)), `${v}/${tp} 漂回 novel 行`).not.toEqual(JSON.stringify(topicStartersFor('novel', tp)));
      }
    }
  });
});

