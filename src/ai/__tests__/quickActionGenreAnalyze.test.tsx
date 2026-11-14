/**
 * ㉞ AI-2b′（2026-11-10 轮 11）：`/ai` 的**五维诊断与大纲指令**按体裁接线锁。
 *
 * 病灶（状态文件 §队列 AI-2b′，轮 9 用新证据抓出）：㉝ 只收了 continue / polish 两对，
 * analyze 的五维模板与 outline 的五要求正文仍整段写死小说。诗集作者点「五维诊断」，模型收到
 * 「维度 1 · 情节破洞」「维度 5 · 伏笔状态」—— 而 `hiddenViewKindsForGenre` ⑮-2 就把
 * storylines / foreshadowing / worldview 从诗集裁掉了：**一边不许这栏长出来，一边叫模型去查它**。
 * 同一条队列还点名了第三张嘴：`MessageView.handleSend` 的常规注入（schema id 原样插值 ×2 +
 * 【当前章节】/【人设卡】/【本章大纲】裸字面 + 「章，已完稿」）与快捷插入那三枚。
 *
 * 锁的四层（沿用 ㉜/㉝ 两轮的形状）：
 *   ① 真调用层：`buildAnalyzePrompt` / `buildOutlinePrompt` 的**成品串**（不是源码 grep）——
 *      轮 10 的 AU-7 ⑨ 判过：跨层传词只钉定义行会放过「算好了但没接到行上」；
 *   ② 同源层：维度不许越过页签表（`hiddenViewKindsForGenre` 反查文案）+ 卡面 desc 的五个维度名
 *      必须与 DIAGNOSE 的标题逐字相等 + prompt 的单位词必须住在现成键里；
 *   ③ 真渲染层：`WelcomeView` 两枚卡面真的换词（把 ㉝ 埋的记债锁翻成绝迹锁）；
 *   ④ 接线层：页面在生产位调两个组装函数，旧小说模板与裸字面绝迹。
 *
 * 零回归线：novel（含未设 / 空 / 脏体裁值）的**组装结果与改造前逐字节相同**，基线四串是从改造前
 * 磁盘文件里程序化取出的（不是凭印象手抄），en 侧同样对锁。
 */
import { describe, it, expect, afterEach } from 'vitest';
const BASE_ANALYZE_ZH = `请按以下五维诊断模板逐维审视本书，并返回结构化报告。

【维度 1 · 情节破洞 plotHole】
- 梳理主线逻辑，检查是否有起因无结果、结果无起因、关键信息前后矛盾、人物动机突变无铺垫。
- 标记：问题简述、涉及章节、严重程度（严重/中等/轻微）、修改建议。

【维度 2 · 人设一致性 characterConsistency】
- 检查已出场角色在言行、动机、口头禅、关系上的前后一致性。
- 标记：角色名、矛盾章节、与初始人设的差异、修改建议。

【维度 3 · 叙事节奏 pacing】
- 审视各章的「信息密度—情绪起伏—场景切换」节奏，是否出现连续高潮后突然拖慢、或过渡章堆砌说明文。
- 标记：节奏失衡的章节区间、具体症状、修改建议。

【维度 4 · 文风漂移 styleDrift】
- 对比开头与最新完稿章节的叙述人称、句式长度、形容词密度、对话风格、幽默/严肃程度，判断是否出现文风突变。
- 标记：漂移方向、典型段落、修改建议。

【维度 5 · 伏笔状态 foreshadowingCheck】
- 列出全书已埋伏笔及其当前回收状态（待收/已收/可能丢失）；检查是否有伏笔被重复利用或遗漏。
- 标记：伏笔标题、埋设章、计划/实际回收章、状态评估。

输出格式：
1. 先给一页「诊断摘要」：各维度评分（1-10）+ 最优先修复的 3 项。
2. 再逐维展开具体发现，每项含：章节、原文摘要、问题描述、修改建议。
3. 如需查阅其他章节正文或角色卡，可调用 list_chapters、read_chapter、read_character_card。
4. 谈「文风 / 句式 / 用词」时要给出示例，必须先调用 search_corpus 查作者自己的语料库；
   查不到就直说没有，**绝不可自己编一句当作参考示例**。
5. 需要修订人设 / 世界观卡时调用 update_character_card：只传你确实要改的字段（未传的字段保持原样），
   登记别名一律用 add_aliases。卡上的性格、经历、关系**只能写作者给过的、或正文可证的**，
   不得自行补全；该操作需作者审批，作者拒绝后不要重复提交同一改动。`;
const BASE_ANALYZE_EN = `Please conduct a structured five-dimension writing diagnostic:

[Dimension 1 · Plot Holes]
Review main plot logic for missing causes/results, contradictory info, or unmotivated character turns. Flag each with chapter reference and severity.

[Dimension 2 · Character Consistency]
Check whether characters stay consistent in speech, motivation, catchphrase, and relationships across chapters.

[Dimension 3 · Pacing]
Evaluate chapter-level info-density, emotional arc, and scene transitions for lulls or spikes.

[Dimension 4 · Style Drift]
Compare narrative voice, sentence length, adjective density, and tone between the opening and the latest completed chapter.

[Dimension 5 · Foreshadowing Status]
List planted hooks and their payoff state (pending / paid-off / possibly lost).

Output: one-page summary with scores, then chapter-by-chapter findings.
If you need to read other chapter text or character cards, call list_chapters / read_chapter / read_character_card.
When discussing style, phrasing or diction you MUST ground any example in the author's own library via
search_corpus; if nothing matches, say so plainly - never invent example lines.
5. To revise a character / worldview card call update_character_card: pass ONLY the fields you really
mean to change (anything omitted keeps its current value) and always register alternative names via
add_aliases. Never invent traits, backstories or relations - write only what the author supplied or
what the manuscript proves. The author must approve the write; if they decline, do not retry it.`;
const BASE_OUTLINE_ZH = `请为当前小说生成或优化章节大纲。

要求：
1. 梳理已有章节的起承转合，确保情节推进合理
2. 为未完成的章节提供详细的细纲（含场景、人物、关键对话）
3. 检查大纲中是否存在节奏失衡、伏笔遗漏或逻辑断层
4. 保持与前文章节风格一致，避免突兀的题材转换
5. 以结构化列表形式输出，每章含：标题、核心目标、场景清单、人物出场、情绪基调`;
const BASE_OUTLINE_EN = `Please generate or optimize the chapter outline for the current novel.

Requirements:
1. Map the existing chapters' rising action and transitions, ensuring logical plot progression
2. Provide detailed sub-outlines for unfinished chapters (including scenes, characters, key dialogues)
3. Check for pacing imbalances, missing foreshadowing, or logical gaps
4. Maintain consistency with previous chapters' style, avoiding abrupt genre shifts
5. Output as a structured list: each chapter with title, core objective, scene list, characters present, emotional tone`;

import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { WelcomeView } from '../WelcomeView';
import {
  buildAnalyzePrompt,
  buildOutlinePrompt,
  quickActionDiagnoseFor,
  quickActionTermsFor,
} from '../quickActionPrompts';
import { aiCardDescKey, hiddenViewKindsForGenre } from '../../utils/writingSchema';
import { setLang, t } from '../../i18n';

const NON_NOVEL = ['essay', 'poetry', 'script', 'diary'] as const;
const DIRTY = ['', 'poerty', 'Novel', 'script ', 'diarrry'];

/** 写作域工具名是 **API 契约**，不许因为里面有「章 / chapter」就当小说口径删掉 */
const TOOL_NAMES = /list_chapters|read_chapter|read_character_card|search_corpus|update_character_card|add_aliases/g;
const deinstrumented = (s: string) => s.replace(TOOL_NAMES, '');

let root: Root | null = null;
const mount = async (ui: ReactElement) => {
  if (root) act(() => root!.unmount());
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
};
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  setLang('zh-CN');
});

// ─── ① 真调用层：组装出来的成品串 ───
describe('㉞ buildAnalyzePrompt / buildOutlinePrompt · 成品串', () => {
  it('novel 与未设/脏体裁值：五维诊断与大纲指令 = 改造前逐字节（中英各一对）', () => {
    setLang('zh-CN');
    for (const g of ['novel', ...DIRTY]) {
      expect(buildAnalyzePrompt(g), `genre=${JSON.stringify(g)} 的五维模板变了`).toBe(BASE_ANALYZE_ZH);
      expect(buildOutlinePrompt(g), `genre=${String(g)} 的大纲指令变了`).toBe(BASE_OUTLINE_ZH);
    }
    setLang('en-US');
    for (const g of ['novel', ...DIRTY]) {
      expect(buildAnalyzePrompt(g), '英文侧五维模板变了').toBe(BASE_ANALYZE_EN);
      expect(buildOutlinePrompt(g), '英文侧大纲指令变了').toBe(BASE_OUTLINE_EN);
    }
  });

  it('五维这个数五支都一样（引子写着「五维」，维度数就必须是 5）', () => {
    for (const g of ['novel', ...NON_NOVEL]) {
      const c = quickActionDiagnoseFor(g);
      expect(c.dims.length, `${g} 的维度数不是 5`).toBe(5);
      expect(c.dims.every((d) => d.title.zh && d.title.en && d.body.zh && d.body.en), `${g} 有维度是空的`).toBe(true);
    }
  });

  it('四支各领一套：zh 五维标题两两不同，且都不是小说那五维', () => {
    setLang('zh-CN');
    const novelTitles = quickActionDiagnoseFor('novel').dims.map((d) => d.title.zh);
    const seen = new Set<string>();
    for (const g of NON_NOVEL) {
      const ts = quickActionDiagnoseFor(g).dims.map((d) => d.title.zh);
      expect(new Set(ts).size, `${g} 有重复维度`).toBe(5);
      expect(ts, `${g} 仍领小说那五维`).not.toEqual(novelTitles);
      seen.add(ts.join('\u0000') + buildOutlinePrompt(g));
    }
    expect(seen.size, '四支共用一套 = 覆盖没生效').toBe(4);
  });

  it('四支的成品串不说小说话：zh 无「小说 / 章」、诗散剧日另禁「篇」；en 无 novel / chapter / fiction', () => {
    setLang('zh-CN');
    const extra: Record<string, string[]> = { poetry: ['篇'], script: ['篇'], diary: ['篇'] };
    for (const g of NON_NOVEL) {
      for (const out of [buildAnalyzePrompt(g), buildOutlinePrompt(g)]) {
        for (const bad of ['小说', '章', '连载', ...(extra[g] ?? [])]) {
          expect(out, `${g} 的成品串里出现「${bad}」`).not.toContain(bad);
        }
      }
    }
    setLang('en-US');
    for (const g of NON_NOVEL) {
      const low = deinstrumented([buildAnalyzePrompt(g), buildOutlinePrompt(g)].join(' ')).toLowerCase();
      for (const bad of ['novel', 'chapter', 'fiction']) {
        expect(low, `${g} 的英文成品串里出现 ${bad}`).not.toContain(bad);
      }
    }
  });

  it('每支的维度问的是本体裁那一行事（语义点名，不只查禁词）', () => {
    setLang('zh-CN');
    const must: Record<string, RegExp> = {
      essay: /立意/,
      poetry: /分行/,
      script: /冲突回合/,
      diary: /态度变化/,
    };
    for (const g of NON_NOVEL) {
      const titles = quickActionDiagnoseFor(g).dims.map((d) => d.title.zh).join(' ');
      expect(titles, `${g} 的五维没领到本体裁那件事`).toMatch(must[g]);
    }
  });
});

// ─── ② 同源层 ───
describe('㉞ 同源 · 维度不许越过页签表，卡面与指令同词', () => {
  // 页签表是判据，文案是下游：这一组断言的作用是让「日后有人把伏笔/世界观写回文案」当场变红
  const FORBIDDEN: Record<string, string[]> = {
    worldview: ['世界观', '世界规则', '设定卡'],
    storylines: ['剧情线'],
    foreshadowing: ['伏笔'],
  };
  it('被 hiddenViewKindsForGenre 裁掉的栏，一个字都不许出现在诊断模板里', () => {
    setLang('zh-CN');
    for (const g of ['novel', ...NON_NOVEL]) {
      const hidden = hiddenViewKindsForGenre(g);
      const out = buildAnalyzePrompt(g);
      for (const kind of Object.keys(FORBIDDEN)) {
        if (!hidden.includes(kind)) continue;
        for (const word of FORBIDDEN[kind]) {
          expect(out, `${g} 的 ${kind} 栏已被裁，模板里却还写着「${word}」`).not.toContain(word);
        }
      }
    }
  });

  it('反向锁：小说没裁这几栏，所以三张嘴全在（判据不是「非小说就删词」）', () => {
    setLang('zh-CN');
    const out = buildAnalyzePrompt('novel');
    expect(out).toContain('伏笔');
    expect(out).toContain('世界观');
  });

  it('卡面 desc 里的五个维度名 = DIAGNOSE 的标题逐字（两边各说各话就是 ㉝ 判过的分叉）', () => {
    setLang('zh-CN');
    for (const g of NON_NOVEL) {
      const desc = t(aiCardDescKey(g, 'analyze'));
      for (const d of quickActionDiagnoseFor(g).dims) {
        expect(desc, `${g} 的卡面漏了维度「${d.title.zh}」`).toContain(d.title.zh.split(' ')[0]);
      }
    }
  });

  it('aiCardDescKey：四支的 analyze / outline 各领新键；小说/未设/脏值仍回落原键逐字', () => {
    for (const g of ['novel', ...DIRTY]) {
      for (const kind of ['continue', 'polish', 'analyze', 'outline', 'character', 'world']) {
        expect(aiCardDescKey(g, kind), `${g}/${kind} 的回落键变了`).toBe(`agent.welcome.${kind}Desc`);
      }
    }
    const leaf: Record<string, string> = { essay: 'Piece', poetry: 'Poem', script: 'Script', diary: 'Day' };
    for (const g of NON_NOVEL) {
      expect(aiCardDescKey(g, 'analyze')).toBe(`agent.welcome.analyzeDesc${leaf[g]}`);
      expect(aiCardDescKey(g, 'outline')).toBe(`agent.welcome.outlineDesc${leaf[g]}`);
    }
  });

  it('八枚新 desc 双语穷尽；zh 不说小说口径并带本体裁单位词；en 不说 novel / chapter', () => {
    const zhCat = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
    const enCat = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
    const cjk = /[\u4e00-\u9fff]/;
    const leaf: Record<string, string> = { essay: 'Piece', poetry: 'Poem', script: 'Script', diary: 'Day' };
    const unit: Record<string, RegExp> = { essay: /篇/, poetry: /诗|首/, script: /场|幕/, diary: /天|条目/ };
    for (const g of NON_NOVEL) {
      for (const kind of ['analyze', 'outline'] as const) {
        const key = `agent.welcome.${kind}Desc${leaf[g]}`;
        const leafName = key.split('.').pop() as string;
        const z = zhCat.agent.welcome[leafName];
        const e = enCat.agent.welcome[leafName];
        expect(typeof z, `zh 缺 ${key}`).toBe('string');
        expect(typeof e, `en 缺 ${key}`).toBe('string');
        expect(z).toMatch(cjk);
        expect(e).not.toMatch(cjk);
        for (const bad of ['小说', '章']) expect(z, `${key} 不许出现「${bad}」`).not.toContain(bad);
        if (g !== 'essay') expect(z, `${key} 不许蹭散文的「篇」`).not.toContain('篇');
        const low = e.toLowerCase();
        for (const bad of ['novel', 'chapter']) expect(low, `${key} 的英文不许说 ${bad}`).not.toContain(bad);
        expect(z, `${key} 没带本体裁的单位词`).toMatch(unit[g]);
      }
    }
  });

  it('prompt 上下文那四枚英文标签有出处：⊂ continueDesc* 英文原句与货架模板英文名', () => {
    const enCat = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
    const cont = (g: string) => enCat.agent.welcome[`continueDesc${g}`].toLowerCase();
    expect(cont('Piece')).toContain(quickActionTermsFor('essay').currentUnitEn.toLowerCase());
    expect(cont('Poem')).toContain(quickActionTermsFor('poetry').currentUnitEn.toLowerCase());
    expect(cont('Script')).toContain(quickActionTermsFor('script').currentUnitEn.toLowerCase());
    expect(enCat.agent.welcome.continueDescDay.toLowerCase()).toContain("today's entry");
    expect(quickActionTermsFor('diary').currentUnitEn.toLowerCase()).toBe("today's entry");
    expect(cont('Script')).toContain(quickActionTermsFor('script').personaEn.toLowerCase());
    expect(cont('Piece')).toContain(quickActionTermsFor('essay').outlineEn.toLowerCase());
    expect(enCat.writingLeft.tplDiaryMatter.toLowerCase()).toContain(quickActionTermsFor('diary').outlineEn.toLowerCase());
    expect(enCat.writingLeft.tplSceneBeat.toLowerCase()).toContain(quickActionTermsFor('script').outlineEn.toLowerCase());
    // tailEn = 「整串英文标签」，novel 那格必须与改造前逐字（快捷插入用的就是它）
    expect(quickActionTermsFor('novel').tailEn).toBe('Current chapter tail');
    expect(quickActionTermsFor('novel').currentUnitEn).toBe('Current Chapter');
    expect(quickActionTermsFor('novel').personaEn).toBe('Character Cards');
    expect(quickActionTermsFor('novel').outlineEn).toBe('Chapter Outline');
    expect(quickActionTermsFor('novel').idLabel).toBe('章节 id');
    expect(quickActionTermsFor('novel').idEn).toBe('chapter id');
  });
  it('id 栏名与单位名同源（【当前诗作】下面不许再写「章节 id」）', () => {
    for (const g of ['novel', ...NON_NOVEL]) {
      const terms = quickActionTermsFor(g);
      // 「当天条目」也带前缀（日记的量词前缀是「当天」不是「当前」）—— 前缀一律剥掉再比名词
      const noun = terms.currentUnitLabel.replace(/^当[前天]/, '');
      expect(terms.idLabel, `${g} 的 id 栏名与单位名分叉了`).toBe(`${noun} id`);
    }
  });
});

// ─── ③ 真渲染层 ───
describe('㉞ WelcomeView · 五维诊断与大纲两枚卡面真的换了词', () => {
  it('四支各领自己的两句，小说那两句不再出现在卡面上', async () => {
    setLang('zh-CN');
    for (const g of NON_NOVEL) {
      await mount(<WelcomeView currentBook={{ title: '书', genre: g }} />);
      const text = document.body.textContent ?? '';
      expect(text, `${g} 的 analyze 卡面没换词`).toContain(t(`agent.welcome.analyzeDesc${g === 'essay' ? 'Piece' : g === 'poetry' ? 'Poem' : g === 'script' ? 'Script' : 'Day'}`));
      expect(text, `${g} 的 outline 卡面没换词`).toContain(t(`agent.welcome.outlineDesc${g === 'essay' ? 'Piece' : g === 'poetry' ? 'Poem' : g === 'script' ? 'Script' : 'Day'}`));
      expect(text, `${g} 卡面仍顶小说的五维句`).not.toContain(t('agent.welcome.analyzeDesc'));
      expect(text, `${g} 卡面仍顶小说的大纲句`).not.toContain(t('agent.welcome.outlineDesc'));
    }
  });

  it('小说 / 无书 / 未设 / 脏值：两枚卡面与改造前逐字相同', async () => {
    setLang('zh-CN');
    for (const g of [undefined, null, '', 'novel', 'poerty'] as (string | null | undefined)[]) {
      const book = g === undefined ? null : { title: '旧书', genre: g };
      await mount(<WelcomeView currentBook={book} />);
      const text = document.body.textContent ?? '';
      expect(text, `genre=${JSON.stringify(g)} 的小说 analyze 卡面句丢了`).toContain(t('agent.welcome.analyzeDesc'));
      expect(text).toContain(t('agent.welcome.outlineDesc'));
    }
  });
});

// ─── ④ 接线层 ───
describe('㉞ 接线层 · 页面只拿成品串，旧小说模板与裸字面绝迹', () => {
  const page = readFileSync('src/pages/AiAgentPage.tsx', 'utf-8');

  it('两个组装函数都在生产位上吃体裁', () => {
    expect(page).toContain('buildAnalyzePrompt(currentBook.genre)');
    expect(page).toContain('buildOutlinePrompt(currentBook.genre)');
  });

  it('五维模板与大纲正文已从页面搬进模块（不许留第二份真源）', () => {
    expect(page).not.toContain('请为当前小说生成或优化章节大纲');
    expect(page).not.toContain('请按以下五维诊断模板逐维审视本书');
    expect(page).not.toContain('【维度 1 · 情节破洞 plotHole】');
    const pack = readFileSync('src/ai/quickActionPrompts.ts', 'utf-8');
    expect(pack).toContain('情节破洞 plotHole');
    expect(pack).toContain('请为当前小说生成或优化章节大纲');
  });

  it('第三张嘴清了账：全文件 schema-id 插值 = 0、ctx 裸单位词 = 0', () => {
    expect((page.match(/\$\{currentBook\.genre\}/g) ?? []).length, 'schema id 又原样插进 prompt 了').toBe(0);
    expect((page.match(/【当前章节】|【人设卡】|【本章大纲】/g) ?? []).length, 'ctx 裸单位词又长回来了').toBe(0);
    expect(page).not.toContain('章，已完稿');
    expect(page).not.toContain('[Current Chapter]');
    expect(page).not.toContain('[Character Cards]');
    expect(page).not.toContain('[Chapter Outline]');
    expect(page).not.toContain('【当前章节末尾】');
  });

  it('页面零体裁字面判断（判据只准住在 writingSchema）', () => {
    expect(page).not.toMatch(/genre\s*===\s*'/);
    expect(page).not.toMatch(/genre\s*!==\s*'/);
  });
});
