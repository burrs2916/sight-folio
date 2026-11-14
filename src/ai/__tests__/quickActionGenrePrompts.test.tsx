/**
 * ㉝ AI-2b（2026-11-10 轮 9）：`/ai` 快捷卡**点下去发出去的那句话**按体裁接线锁。
 *
 * 病灶（状态文件 §队列 AI-2b，轮 7 用新证据抓出）：`handleQuickAction` 六个 case 的指令
 * 全按小说写 —— 诗集作者点「续写」，模型收到「请为下面的小说片段续写…300～600 字」；
 * 另有五处把体裁的 schema id **原样**插进 prompt，模型读到的是 `poetry` 而不是「诗歌」。
 *
 * 锁的四层（沿用 ㉚/㉛/㉜ 的形状 —— 本仓已为「定义 100% / 运行时 0%」付过四次钱）：
 *   ① 纯函数层：`quickActionTermsFor` / `quickActionCopyFor` / `aiCardDescKey` 的覆盖与回落；
 *   ② 词汇同源层：prompt 的单位词必须住在**同一批现成键**的词表里
 *      （aiChatEmpty / volumeSummary / 货架模板 / tabCharacters），卡面 desc 与发送句配对着色 ——
 *      两边各说各话正是 ㉝ 的头注释判过的那种分叉；
 *   ③ 真渲染层：卡面 desc 在界面上真的按体裁换掉了；
 *   ④ 接线层：`AiAgentPage` 不再自持小说指令、schema id 脏读数绝迹、
 *      `WelcomeView` 不再硬编码两枚已收编的 desc 裸键。
 *
 * 零回归线：novel（含未设 / 脏值）的三对发送文案与四个上下文单位词 = 改造前**逐字**；
 * 小说六张卡的 desc 键与文案逐字不变。
 *
 * 记账（㉞ 轮 11 已清）：本套原先钉着三笔「当前仍回落」的债 —— analyze / outline 的指令正文与
 * 两枚卡面、以及 `MessageView` 那条「同病第三嘴」（schema id 插值 ×2 + 三枚裸单位词）。
 * 队列 AI-2b′ 写明「落地那天连同断言一起清零」，现已改为**绝迹锁**；指令正文与卡面配对的锁
 * 在 `quickActionGenreAnalyze.test.tsx`（那边真调用组装函数取成品串）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { WelcomeView } from '../WelcomeView';
import { quickActionCopyFor, quickActionTermsFor } from '../quickActionPrompts';
import { aiCardDescKey, aiChatEmptyKey } from '../../utils/writingSchema';
import { setLang, t } from '../../i18n';

const NON_NOVEL = ['essay', 'poetry', 'script', 'diary'] as const;
const DIRTY = ['', 'diaryy', 'Novel', 'poetry ', 'mystery'];
const ALL_KINDS = ['continue', 'polish', 'analyze', 'outline', 'character', 'world'] as const;

// ─── 零回归原句（逐字抄自改造前的 AiAgentPage，不用插值拼）───
const ORIG_NOVEL = {
  introZh:
    '请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
  introEn:
    'Continue the novel excerpt below. Output the continued prose only: no explanations, titles, prefaces, or summaries; do not repeat existing text.',
  tailZh: '从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。',
  tailEn:
    'Seamlessly continue from the tail above for 300-600 words, keeping the same person, tense, and style as the existing text.',
  polishZh:
    '请润色下面的整章小说：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量；不得增删情节点；保留原有分段结构。直接输出润色后的全文正文：不要任何解释、对照说明或总结。',
  polishEn:
    'Polish the chapter below: improve prose quality (rhythm, imagery, dialogue) but do **not** change plot, character actions, timeline, or information; keep the original paragraph structure. Output the polished full text only: no explanations or summaries.',
};
const NOVEL_TERMS = {
  currentUnitLabel: '当前章节',
  unitMeasure: '章',
  personaLabel: '人设卡',
  outlineLabel: '本章大纲',
  // ㉞（轮 11）补的四格英文标签 = 改造前 `MessageView` 里的原标签逐字（不是新文案，是搬进来的旧文案）：
  // 「四个单位词」在这把锁之外**只增不减**，novel 侧渲染字节仍与改造前一致。
  currentUnitEn: 'Current Chapter',
  personaEn: 'Character Cards',
  outlineEn: 'Chapter Outline',
  tailEn: 'Current chapter tail',
  idLabel: '章节 id',
  idEn: 'chapter id',
  // ㉟（轮 12 · AI-5 ④）补的八格 = `useAiActions.buildChatContext` 改造前字面量逐字
  // （同一手法：把旧文案搬进表，不是新文案）。表在这把锁之外只增不减，novel 渲染字节不变。
  ctxUnitEn: 'Current chapter',
  skeletonZh: '全书章节骨架',
  skeletonEn: 'Book chapter skeleton',
  personaBlockZh: '人物档案',
  personaBlockEn: 'Character profiles',
  tailBlockZh: '当前章正文',
  tailBlockEn: 'Current chapter text',
  // ㊱（轮 13 · AI-2b″）补的一格 = `AiAgentPage` 四处进度行改造前字面量逐字（同一手法：
  // 旧文案搬进表，不是新文案）。表在这把锁之外只增不减，novel 渲染字节不变。
  progressLabel: '全书进度',
  // ㉤（轮 17 · AI-6）补的四格 = `canvasAssistant` 改造前字面量逐字（轮 12/13 同一手法：加格不削断言）。
  // 基线四串的取法见 canvasAssistantGenre.test.ts 头注；旧文案搬进表，不是新文案。
  unitTagZh: '当前章',
  unitTagEn: 'current chapter',
  outlineBlockZh: '大纲节拍',
  progressUnitEn: 'chapters',
  // ㉦（轮 19 · AI-6′）补的一格 = `canvasAssistant` 空画布报错里改造前那枚 book 级词逐字
  // （轮 12/13/17 同一手法：旧文案搬进表，加格不削断言；四支的取值与 overviewHint 首词的配对锁在 canvasAssistantGenre.test.ts）。
  bookLevelZh: '全书',
};

// 四支的「单位词现成来源」对照表（② 层用）：键 = 该词唯一的出处
const SUMMARY_KEY: Record<string, string> = {
  essay: 'agent.writing.volumeSummaryPiece',
  poetry: 'agent.writing.volumeSummaryPoem',
  script: 'agent.writing.volumeSummaryScene',
  diary: 'agent.writing.volumeSummaryDay',
};

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

// ─── ① 纯函数层 ───
describe('㉝ quickActionTermsFor / quickActionCopyFor · 纯函数层', () => {
  it('novel 与未设/脏体裁值：三对发送文案 + 四个单位词逐字 = 改造前', () => {
    for (const g of ['novel', ...DIRTY]) {
      const copy = quickActionCopyFor(g);
      const terms = quickActionTermsFor(g);
      expect(copy.continueIntro, `genre=${JSON.stringify(g)} 续写指令头变了`).toEqual({
        zh: ORIG_NOVEL.introZh,
        en: ORIG_NOVEL.introEn,
      });
      expect(copy.continueTail).toEqual({ zh: ORIG_NOVEL.tailZh, en: ORIG_NOVEL.tailEn });
      expect(copy.polish).toEqual({ zh: ORIG_NOVEL.polishZh, en: ORIG_NOVEL.polishEn });
      expect(terms).toEqual(NOVEL_TERMS);
    }
  });

  it('四支非小说各领一套：zh 三句互不相同、也不含小说那句', () => {
    const seen = new Map<string, string>();
    for (const g of NON_NOVEL) {
      const c = quickActionCopyFor(g);
      expect(c.continueIntro.zh).not.toBe(ORIG_NOVEL.introZh);
      expect(c.polish.zh).not.toBe(ORIG_NOVEL.polishZh);
      seen.set(g, [c.continueIntro.zh, c.continueTail.zh, c.polish.zh].join('\u0000'));
    }
    expect(new Set(seen.values()).size, '四支共用一套 = 覆盖没生效').toBe(4);
  });

  it('非小说的 zh 不许出现「小说 / 章」，诗散剧日另禁「篇」；en 不许 novel / chapter / fiction', () => {
    const extra: Record<string, string[]> = { poetry: ['篇'], script: ['篇'], diary: ['篇'] };
    for (const g of NON_NOVEL) {
      const c = quickActionCopyFor(g);
      for (const s of [c.continueIntro.zh, c.continueTail.zh, c.polish.zh]) {
        for (const bad of ['小说', '章', ...(extra[g] ?? [])]) {
          expect(s, `${g} 的发送句不许说「${bad}」`).not.toContain(bad);
        }
      }
      const ens = [c.continueIntro.en, c.continueTail.en, c.polish.en].join(' ').toLowerCase();
      for (const bad of ['novel', 'chapter', 'fiction']) {
        expect(ens, `${g} 的英文发送句不许说 ${bad}`).not.toContain(bad);
      }
    }
  });

  it('每支的发送句说的是自己那件事（语义点名，不只查禁词）', () => {
    const must: Record<string, RegExp> = {
      essay: /立意/,
      poetry: /意象|分行/,
      script: /台词|舞台指示/,
      diary: /当天/,
    };
    for (const g of NON_NOVEL) {
      const c = quickActionCopyFor(g);
      expect([c.continueTail.zh, c.polish.zh].join(' '), `${g} 没领到本体裁的语义`).toMatch(must[g]);
    }
  });
});

// ─── ② 词汇同源层 ───
describe('㉝ 词汇同源 · prompt 与卡面 desc 的词必须住同一批现成键里', () => {
  it('currentUnitLabel ⊂ ⑰-1 的 aiChatEmpty 原句（与空态那嘴同一个词）', () => {
    setLang('zh-CN');
    for (const g of NON_NOVEL) {
      const line = t(aiChatEmptyKey(g));
      expect(line, `${g} 的空态句里没有「${quickActionTermsFor(g).currentUnitLabel}」`).toContain(
        quickActionTermsFor(g).currentUnitLabel,
      );
    }
  });

  it('unitMeasure ⊂ volumeSummary 量词（统计早就这么数，发送句不许另造）', () => {
    setLang('zh-CN');
    for (const g of NON_NOVEL) {
      expect(t(SUMMARY_KEY[g]), `${g} 的量词不在现成统计串里`).toContain(quickActionTermsFor(g).unitMeasure);
    }
  });

  it('personaLabel：剧本吃 tabCharacters 的「角色表」，其余三支吃货架模板的「人物卡」', () => {
    setLang('zh-CN');
    expect(quickActionTermsFor('script').personaLabel).toBe(t('writing.script.tabCharacters'));
    expect(t('writing.aiChatEmptyScript')).toContain(quickActionTermsFor('script').personaLabel);
    for (const g of ['essay', 'poetry', 'diary']) {
      expect(quickActionTermsFor(g).personaLabel).toBe(t('writingLeft.tplCharacter'));
    }
  });

  it('outlineLabel ⊂ 各支货架模板的名词（日记整词相等，其余含干词）', () => {
    setLang('zh-CN');
    expect(quickActionTermsFor('diary').outlineLabel).toBe(t('writingLeft.tplDiaryMatter'));
    expect(quickActionTermsFor('essay').outlineLabel).toContain(t('writingLeft.tplEssayIdea'));
    expect(quickActionTermsFor('poetry').outlineLabel).toContain(t('writingLeft.tplPoemImagery'));
    expect(quickActionTermsFor('script').outlineLabel).toContain(t('writingLeft.tplSceneBeat').replace('场次', ''));
  });

  it('aiCardDescKey：小说/未设/脏值 = 回落原键逐字；四支的 continue/polish 各领自己的键', () => {
    for (const g of ['novel', ...DIRTY]) {
      for (const kind of ALL_KINDS) {
        expect(aiCardDescKey(g, kind), `${g}/${kind} 的回落键变了`).toBe(`agent.welcome.${kind}Desc`);
      }
    }
    const leaf: Record<string, string> = { essay: 'Piece', poetry: 'Poem', script: 'Script', diary: 'Day' };
    for (const g of NON_NOVEL) {
      expect(aiCardDescKey(g, 'continue')).toBe(`agent.welcome.continueDesc${leaf[g]}`);
      expect(aiCardDescKey(g, 'polish')).toBe(`agent.welcome.polishDesc${leaf[g]}`);
      // ㉞（轮 11 · AI-2b′ 落地）：analyze / outline 的卡面与五维模板、大纲指令正文同轮换词。
      // 上面那条「不该提前换键」的记债锁到此清零 —— 现在反过来要求它**必须**跟着换（记债已还）。
      for (const kind of ['analyze', 'outline'] as const) {
        expect(aiCardDescKey(g, kind), `${g}/${kind} 的卡面没跟上指令`).toBe(`agent.welcome.${kind}Desc${leaf[g]}`);
      }
      // character / world 的本句不含正文单位词（角色五支都成立；world 卡非小说不出现）→ 仍旧键
      for (const kind of ['character', 'world'] as const) {
        expect(aiCardDescKey(g, kind), `${g}/${kind} 无事生非换了键`).toBe(`agent.welcome.${kind}Desc`);
      }
    }
  });

  it('八枚新 desc 双语穷尽；zh 不说小说口径、带本体裁的单位词；en 不说 novel/chapter', () => {
    const zhCat = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
    const enCat = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
    const cjk = /[\u4e00-\u9fff]/;
    const leaf: Record<string, string> = { essay: 'Piece', poetry: 'Poem', script: 'Script', diary: 'Day' };
    for (const g of NON_NOVEL) {
      const terms = quickActionTermsFor(g);
      for (const act2 of ['continue', 'polish'] as const) {
        const key = `agent.welcome.${act2}Desc${leaf[g]}`;
        const leafName = key.split('.').pop() as string;
        const z = zhCat.agent.welcome[leafName];
        const e = enCat.agent.welcome[leafName];
        expect(typeof z, `zh 缺 ${key}`).toBe('string');
        expect(typeof e, `en 缺 ${key}`).toBe('string');
        expect(z).toMatch(cjk);
        expect(e).not.toMatch(cjk);
        for (const bad of ['小说', '章']) {
          expect(z, `${key} 不许出现「${bad}」`).not.toContain(bad);
        }
        const low = e.toLowerCase();
        for (const bad of ['novel', 'chapter']) {
          expect(low, `${key} 的英文不许说 ${bad}`).not.toContain(bad);
        }
        // 卡面话必须认得自己的单位（含 currentUnitLabel 全文或量词本身）
        expect(z, `${key} 没带本体裁的单位词`).toMatch(
          new RegExp(`${terms.currentUnitLabel}|${terms.unitMeasure}`),
        );
      }
    }
  });
});

// ─── ③ 真渲染层 ───
describe('㉝ WelcomeView · 卡面 desc 真的按体裁换了', () => {
  it('诗集：续写/润色两枚领到诗那句，小说那两句不再出现', async () => {
    setLang('zh-CN');
    await mount(<WelcomeView currentBook={{ title: '诗集', genre: 'poetry' }} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain(t('agent.welcome.continueDescPoem'));
    expect(text).toContain(t('agent.welcome.polishDescPoem'));
    expect(text, '诗集卡面仍顶小说的续写句').not.toContain(t('agent.welcome.continueDesc'));
    expect(text, '诗集卡面仍顶小说的润色句').not.toContain(t('agent.welcome.polishDesc'));
  });

  it('小说 / 无书 / 未设 / 脏值：六张卡的 desc 与改造前逐字相同', async () => {
    setLang('zh-CN');
    for (const g of [undefined, null, '', 'novel', 'diaryy'] as (string | null | undefined)[]) {
      const book = g === undefined ? null : { title: '旧书', genre: g };
      await mount(<WelcomeView currentBook={book} />);
      const text = document.body.textContent ?? '';
      expect(text, `genre=${JSON.stringify(g)} 小说续写句丢了`).toContain(t('agent.welcome.continueDesc'));
      expect(text).toContain(t('agent.welcome.polishDesc'));
    }
  });

  it('四支的「五维诊断 / 大纲」两枚**已跟着指令换词**（㉞ 还清了 ㉝ 记的那笔债）', async () => {
    setLang('zh-CN');
    for (const g of NON_NOVEL) {
      await mount(<WelcomeView currentBook={{ title: '书', genre: g }} />);
      const text = document.body.textContent ?? '';
      expect(text, `${g} 的 analyze 卡面还顶着小说那句`).not.toContain(t('agent.welcome.analyzeDesc'));
      expect(text, `${g} 的 outline 卡面还顶着小说那句`).not.toContain(t('agent.welcome.outlineDesc'));
    }
    // 逐枚点名（不只查「不等于」）：两枚各领自己的键，缺一个就红
    for (const [g, leaf] of [['essay', 'Piece'], ['poetry', 'Poem'], ['script', 'Script'], ['diary', 'Day']] as const) {
      await mount(<WelcomeView currentBook={{ title: '书', genre: g }} />);
      const text = document.body.textContent ?? '';
      expect(text, `${g} 的 analyze 卡面没换成自己那句`).toContain(t(`agent.welcome.analyzeDesc${leaf}`));
      expect(text, `${g} 的 outline 卡面没换成自己那句`).toContain(t(`agent.welcome.outlineDesc${leaf}`));
    }
  });
});

// ─── ④ 接线层 ───
describe('㉝ 接线层 · 脏读数绝迹 + 真源只剩一份', () => {
  const page = readFileSync('src/pages/AiAgentPage.tsx', 'utf-8');
  const welcome = readFileSync('src/ai/WelcomeView.tsx', 'utf-8');
  // 锁的范围 = handleQuickAction 函数体。㉝ 那一轮文件里还有第二处同病注入（MessageView 的
  // handleSend：aiChatEmpty 承诺「首轮消息会自动附带当前篇目…」却被它顶着说谎），轮 9 实测在册、
  // 划进 AI-2b′；㉞ 已把那张嘴一并收进 TERMS/genreTag，所以分段锁留下（它守的是快捷动作这段），
  // 全文件级绝迹锁另起两条 —— 分段与全文件都要有，只留一边就又会漏。
  const fnStart = page.indexOf('const handleQuickAction');
  const fnEnd = page.indexOf('const currentAgent');

  it('函数边界自锁（锚点漂了这条先红，别拿错区间取证）', () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
  });

  const fn = () => page.slice(fnStart, fnEnd);

  it('handleQuickAction 真的读体裁：terms/copy/genreTag 三个解析器都在生产位上', () => {
    expect(fn()).toContain('quickActionTermsFor(currentBook.genre)');
    expect(fn()).toContain('quickActionCopyFor(currentBook.genre)');
    expect(fn()).toContain('genreTagLabelKey(currentBook.genre)');
    expect(fn()).toContain('L(copy.continueIntro.zh, copy.continueIntro.en)');
    expect(fn()).toContain('L(copy.polish.zh, copy.polish.en)');
  });

  it('schema id 脏读数全文件绝迹（㉝ 记的「残余 = 2」已由 ㉞ 清零）', () => {
    const interp = (s: string) => (s.match(/\$\{currentBook\.genre\}/g) ?? []).length;
    expect(interp(fn()), '快捷动作里又长回原样插值了').toBe(0);
    // ㉝ 那一轮这里是 2（MessageView 注入的 zh + en 两行），轮 11 的 AI-2b′ 把它接到 genreTag 上 → 绝迹
    expect(interp(page), 'schema id 原样插回 prompt 了').toBe(0);
    expect(page).not.toMatch(/genre\s*===\s*'/);
    expect(page).not.toMatch(/genre\s*!==\s*'/);
  });

  it('小说的三句指令已从页面搬进 quickActionPrompts（不许留第二份真源）', () => {
    expect(fn()).not.toContain(ORIG_NOVEL.introZh);
    expect(fn()).not.toContain(ORIG_NOVEL.tailZh);
    expect(fn()).not.toContain(ORIG_NOVEL.polishZh);
    const pack = readFileSync('src/ai/quickActionPrompts.ts', 'utf-8');
    expect(pack).toContain(ORIG_NOVEL.introZh);
    expect(pack).toContain(ORIG_NOVEL.polishZh);
  });

  it('ctx 单位词裸字面全文件绝迹（㉝ 记的「数量 = 5」已由 ㉞ 清零）', () => {
    for (const bare of ['【当前章节】', '【人设卡】', '【本章大纲】', '章，已完稿']) {
      expect(fn(), `快捷动作还留着裸字面「${bare}」`).not.toContain(bare);
    }
    // handleSend 与「快捷插入」那三枚同族裸字面（㉝ 记在册、㉞ 一并收进 TERMS）→ 现在全文件一个不剩
    expect((page.match(/【当前章节】|【人设卡】|【本章大纲】/g) ?? []).length, '裸单位词又长回来了').toBe(0);
    // ㉞ 收尾补的那一格：栏名与单位名同源，改造前是「章节 id / chapter id」两枚裸字面
    expect(page, 'id 栏名又写死成章节了').not.toContain('（章节 id：');
    expect(page).not.toContain('(chapter id: ');
  });

  it('WelcomeView 吃解析器，两枚已收编的裸键绝迹', () => {
    expect(welcome).toContain("t(aiCardDescKey(genre, 'continue'))");
    expect(welcome).toContain("t(aiCardDescKey(genre, 'polish'))");
    expect(welcome).not.toContain("'agent.welcome.continueDesc'");
    expect(welcome).not.toContain("'agent.welcome.polishDesc'");
  });
});
