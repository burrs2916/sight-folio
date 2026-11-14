/**
 * ㉕（轮 32 · AI-1-1 + P14）genrePromptPack 的护栏测试。
 *
 * 四条锁，各对应一条已经付过学费的病灶：
 *  ① 穷尽与唯一兜底：五格齐、未设/脏值只塌进 novel 一格（入口一次，调用侧无二重兜底）；
 *  ② novel 独立对锁：表里的小说串与改造前原文**逐字节**相同——本文件里的对照串是从
 *     改造前磁盘态**独立另抄**的一份（不是从表里复制），两边漂一个字就红；
 *  ③ 体裁契约（P14）：诗集拿不到「章节/情节功能」、剧本的一致性不再对照已裁的「世界观」、
 *     日记的每一支都带着「不增补」硬线；
 *  ④ 源码接线锁：塌平不许倒退——四条布尔判据不许在 writingAssistant/writingMaterial
 *     复活，pack 表内不许出现 `genre ===` 字面判断，chip 与 quickAction 不许绕开表自拼句子。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENRE_PROMPT_PACKS, genrePromptPack } from '../genrePromptPack';
import { surfaceKeyForGenre } from '../../utils/writingSchema';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* ── ① 穷尽与唯一兜底 ─────────────────────────────────────────────────────── */
describe('㉕ pack 穷尽与唯一兜底', () => {
  it('五体裁格齐全，一格不落（Record 穷尽的运行时对照）', () => {
    expect(Object.keys(GENRE_PROMPT_PACKS).sort()).toEqual(['diary', 'essay', 'novel', 'poetry', 'script']);
    for (const [genre, pack] of Object.entries(GENRE_PROMPT_PACKS)) {
      // 每格必须把全部变化点都填上：塌平不许留 undefined 槽给调用侧写 ?? 二重兜底
      const pairs = [
        pack.unitLabel,
        pack.continueHead,
        pack.continueWords.plain,
        pack.continueWords.withTarget(500),
        pack.polishWhole,
        pack.rewriteWhole,
        pack.summarizeWhole,
        pack.reviewUnitNoun,
        pack.material.draftTailLabel,
        pack.material.draftTailEmpty,
        pack.material.draftTargetLabel,
        pack.material.draftPrompt,
        pack.workbench.understand('x.md'),
        pack.workbench.consistency('x.md'),
        pack.workbench.plot,
        pack.workbench.explainSel,
        pack.workbench.polishSel,
        pack.persona.noun,
        pack.persona.refs,
      ];
      for (const slot of pairs) {
        expect(typeof slot.zh, `${genre} 缺 zh`).toBe('string');
        expect(typeof slot.en, `${genre} 缺 en`).toBe('string');
      }
      // 除审校豁免条（novel/essay 合法为空串 = 今天没有第 5 条）外，其余槽不许空文本；
      // 豁免条也要求 zh/en 同空同非空（一侧漏写=静默半条豁免，正是要拦的形状）
      for (const slot of pairs) {
        expect(slot.zh.length > 0, `${genre} 出现空 zh 槽`).toBe(true);
        expect(slot.en.length > 0, `${genre} 出现空 en 槽`).toBe(true);
      }
      expect((pack.reviewExemptRule.zh === '') === (pack.reviewExemptRule.en === ''), `${genre} 豁免条两侧不同空`).toBe(true);
      expect(pack.material.digestNoun.zh.length).toBeGreaterThan(0);
    }
  });

  it('未设 / 空 / 脏值一律落 novel 格（兜底只在入口一次）', () => {
    for (const g of [undefined, null, '', 'Diary', 'poem', 'diary ', 'essay2', '未知体裁']) {
      expect(genrePromptPack(g as string | null | undefined), `${String(g)} 不该开新格`).toBe(GENRE_PROMPT_PACKS.novel);
    }
    expect(genrePromptPack('diary')).toBe(GENRE_PROMPT_PACKS.diary);
    expect(genrePromptPack('poetry')).toBe(GENRE_PROMPT_PACKS.poetry);
  });
});

/* ── ② novel 独立对锁（对照串从改造前磁盘态独立另抄）────────────────────── */
describe('㉕ novel 逐字节零回归（独立对锁）', () => {
  const p = GENRE_PROMPT_PACKS.novel;

  it('unitLabel / continueHead / continueWords 与改造前逐字相同', () => {
    expect(p.unitLabel.zh).toBe('【当前章节】');
    expect(p.unitLabel.en).toBe('[Current Chapter] ');
    expect(p.continueHead.zh).toBe(
      '请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
    );
    expect(p.continueWords.withTarget(1200).zh).toBe(
      '从上面的末尾无缝接着往下写约 1200 字，保持人称、时态、文风与已有内容一致。',
    );
    expect(p.continueWords.plain.zh).toBe(
      '从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。',
    );
  });

  it('整篇润色/改写/总结 三句主干与改造前逐字相同', () => {
    expect(p.polishWhole.zh.startsWith('请润色下面的整章小说：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量；不得增删情节点；')).toBe(true);
    expect(p.rewriteWhole.zh.startsWith('请改写下面的整章小说：在**保留情节、人物行为、时间线与全部信息量**的前提下，重构表达')).toBe(true);
    expect(p.summarizeWhole.zh).toBe(
      '请总结本章小说：提炼本章发生的情节、人物动向与关键推进（每小节要点式列出），控制在 400 字以内。只总结本章内容，不要补充本章之外的情节，不要评价文笔。',
    );
  });

  it('素材两动作与改造前逐字相同', () => {
    expect(p.material.digestNoun).toEqual({ zh: '小说', enWrite: 'fiction', enFocus: 'fiction' });
    expect(p.material.draftTailLabel.zh).toBe('【目标章已有正文】\n');
    expect(p.material.draftTailEmpty.zh).toBe('【目标章正文】本章还没有正文，请从开头直接展开。');
    expect(p.material.draftTargetLabel.zh).toBe('【目标章节】');
    expect(p.material.draftPrompt.zh.startsWith('你是一位网文写手。请根据下面的【资料分析】与【目标章信息】，为指定章节生成正文草稿。')).toBe(true);
    expect(p.material.draftPrompt.zh.endsWith('字数控制在 800～2000 字左右（根据情节需要自然增减）。')).toBe(true);
  });

  it('工作台五支 book-* 动作（P14 的 novel 侧）与改造前逐字相同', () => {
    expect(p.workbench.understand('ch/a.md').zh).toBe(
      '请读懂章节 ch/a.md：它在全书里承担什么情节功能、与前后章怎么衔接、写得好的地方与可改进点分别是什么。',
    );
    expect(p.workbench.consistency('ch/a.md').zh).toBe(
      '请对照人设卡与世界观设定，审查章节 ch/a.md 是否出现人设 / 设定矛盾，逐条列出并给出修改建议。没有人设卡覆盖的角色请明确声明「设定缺失」。',
    );
    expect(p.workbench.plot.zh).toBe(
      '请基于作品概览（全书章节结构与字数分布）、当前章节正文与世界观设定，审视情节连贯性、伏笔回收与叙事节奏，给出具体到章节的修改建议。',
    );
    expect(p.workbench.explainSel.zh).toBe('请解释下面这段正文在情节推进、人设塑造与主题上的作用，并指出可改进处：');
    expect(p.workbench.polishSel.zh).toBe('请润色下面这段正文：提升文笔、节奏与可读性，保持人设口吻与全文风格一致，只改必要处：');
    // 改造前英文侧同锁（novel 的 en 串是 `AiAgentPage`/`workbenchPanelHooks` 逐字复制）
    expect(p.workbench.understand('ch/a.md').en).toBe(
      'Help me understand chapter ch/a.md: what plot function it serves in the book, how it connects to the surrounding chapters, and what works versus what could improve.',
    );
    expect(p.workbench.plot.en).toBe(
      'Based on the book overview (chapter structure and word distribution), the current chapter text and the worldbuilding, review plot coherence, foreshadowing payoff and pacing, with chapter-specific revision suggestions.',
    );
  });

  it('ask 人设两槽 = personaWords 改造前逐字（AI-1-3 搬表零文案，小说侧不许漂一个字）', () => {
    expect(p.persona.noun).toEqual({ zh: '小说', en: 'fiction' });
    expect(p.persona.refs).toEqual({
      zh: '人设卡、世界观设定与全书结构',
      en: 'character cards, worldbuilding and the book structure',
    });
  });
});

/* ── ③ 体裁契约（P14 + 塌平语义保号）────────────────────────────────────── */
describe('㉕ 体裁契约：非小说四支不说小说话', () => {
  it('诗：单位「首」，保分行；读解与润色都不许把诗排成散文', () => {
    const p = GENRE_PROMPT_PACKS.poetry;
    expect(p.unitLabel.zh).toBe('【当前诗作】');
    expect(p.polishWhole.zh).toContain('分行与节次就是诗的本体');
    expect(p.workbench.understand('x').zh).toContain('这首诗');
    expect(p.workbench.understand('x').zh).not.toContain('章节');
    expect(p.workbench.explainSel.zh).toContain('不要替诗做寓意总结');
    expect(p.workbench.polishSel.zh).toContain('保持分行与节次不变');
  });

  it('剧本：单位「场」，一致性对照角色表；世界观那栏已裁，不许再对照它', () => {
    const p = GENRE_PROMPT_PACKS.script;
    expect(p.unitLabel.zh).toBe('【当前场次】');
    expect(p.workbench.consistency('s.md').zh).toContain('角色表');
    expect(p.workbench.consistency('s.md').zh).not.toContain('世界观');
    // 轮 30 在册决定：剧本保留「情节/伏笔」现名，plot 一支不换成自造词
    expect(p.workbench.plot.zh).toContain('伏笔回收');
    expect(p.workbench.plot.zh).toContain('场次');
    expect(p.workbench.polishSel.zh).toContain('台词归属');
  });

  it('日记：每一支都带「不增补」硬线，单位是「天/条目」', () => {
    const p = GENRE_PROMPT_PACKS.diary;
    expect(p.unitLabel.zh).toBe('【当前条目】');
    expect(p.continueHead.zh).toContain('不要替作者编造那天发生的事');
    expect(p.workbench.understand('d.md').zh).toContain('不要替作者补充那天没写的事');
    expect(p.workbench.consistency('d.md').zh).toContain('不得为弥合矛盾而增补原文没有的事');
    expect(p.material.draftPrompt.zh).toContain('资料不足：缺 ___');
  });

  it('散文：立意与人事细节是硬边界；续写头的 A-3 欠账在册（领小说句是现状，刀 2 修表不修链）', () => {
    const p = GENRE_PROMPT_PACKS.essay;
    expect(p.unitLabel.zh).toBe('【当前篇目】');
    expect(p.polishWhole.zh).toContain('作者的立意与所写的人事细节');
    expect(p.continueHead.zh).toBe(GENRE_PROMPT_PACKS.novel.continueHead.zh); // A-3 在册保号
    expect(p.workbench.consistency('e.md').zh).toContain('素材缺失');
    expect(p.workbench.consistency('e.md').zh).not.toContain('世界观');
  });

  it('chip 槽位：非小说四支换单位词，小说与旧书回落原键', () => {
    expect(surfaceKeyForGenre('essay', 'chipUnderstand')).toBe('workbench.aiUnderstandPiece');
    expect(surfaceKeyForGenre('poetry', 'chipUnderstand')).toBe('workbench.aiUnderstandPoem');
    expect(surfaceKeyForGenre('script', 'chipUnderstand')).toBe('workbench.aiUnderstandScene');
    expect(surfaceKeyForGenre('diary', 'chipUnderstand')).toBe('workbench.aiUnderstandEntry');
    for (const g of ['novel', '', 'unset-ish']) {
      expect(surfaceKeyForGenre(g, 'chipUnderstand')).toBe('workbench.aiUnderstandChapter');
    }
  });

  it('chip 四新键在 i18n 双包同名存在，zh/en 读数各就各位', () => {
    const zhW = (JSON.parse(read('src/i18n/zh-CN.json')) as { workbench: Record<string, string> }).workbench;
    const enW = (JSON.parse(read('src/i18n/en-US.json')) as { workbench: Record<string, string> }).workbench;
    const pairs: [string, string, string][] = [
      ['aiUnderstandPiece', '读懂这篇', 'Understand piece'],
      ['aiUnderstandPoem', '读懂这首', 'Understand poem'],
      ['aiUnderstandScene', '读懂这场', 'Understand scene'],
      ['aiUnderstandEntry', '读懂这天', 'Understand entry'],
    ];
    for (const [k, z, e] of pairs) {
      expect(zhW[k], `zh 缺键 ${k}`).toBe(z);
      expect(enW[k], `en 缺键 ${k}`).toBe(e);
    }
  });
});

/* ── ③b ask 人设按体裁（AI-1-3：persona 进表后的口径锁）───────────────────── */
describe('㉕ ask 人设：非小说四支不再被要求去看自己没有的东西', () => {
  it('小说侧仍对照「人设卡、世界观设定」（这条是双向锁的正面：撤了它说明表被写坏）', () => {
    expect(GENRE_PROMPT_PACKS.novel.persona.refs.zh).toContain('世界观设定');
  });
  it('四支各自的名词与对照物都换成体裁自己的，且一律不出现「世界观」', () => {
    const expectNoun: Record<string, string> = { poetry: '诗歌', essay: '散文', script: '剧本', diary: '日记' };
    for (const [g, noun] of Object.entries(expectNoun)) {
      const pn = genrePromptPack(g).persona;
      expect(pn.noun.zh, `${g} 人设名词错`).toBe(noun);
      expect(pn.refs.zh.includes('世界观'), `${g} 仍在对照世界观设定`).toBe(false);
      expect(pn.refs.en.toLowerCase().includes('worldbuilding'), `${g} en 仍在对照 worldbuilding`).toBe(false);
    }
    // 剧本读角色表与幕场、日记读条目本身——各自的真源不能互相顶替
    expect(genrePromptPack('script').persona.refs.zh).toContain('幕场结构');
    expect(genrePromptPack('diary').persona.refs.zh).toContain('日记条目清单');
    expect(genrePromptPack('poetry').persona.refs.zh).toContain('诗作清单');
    expect(genrePromptPack('essay').persona.refs.zh).toContain('篇目清单');
  });
  it('五支人设两两不同（漏一格会静默掉进小说兜底，正是本刀要灭的形状）', () => {
    const zs = ['novel', 'essay', 'poetry', 'script', 'diary'].map((g) => genrePromptPack(g).persona.refs.zh);
    expect(new Set(zs).size).toBe(5);
  });
});

/* ── ④ 源码接线锁：塌平不许倒退 ─────────────────────────────────────────── */
describe('㉕ 源码接线锁', () => {
  const wa = read('src/ai/writingAssistant.ts');
  const wm = read('src/ai/writingMaterial.ts');
  const packSrc = read('src/ai/genrePromptPack.ts');
  // 判据布尔不许在塌平过的两个模块复活（注释里提及历史不算：剥注释后再查）
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const b of ['isEssayGenre', 'isPoetryGenre', 'isScriptGenre', 'isDiaryGenre']) {
    expect(strip(wa).includes(b), `writingAssistant 复活判据 ${b}`).toBe(false);
    expect(strip(wm).includes(b), `writingMaterial 复活判据 ${b}`).toBe(false);
  }
  it('pack 表内不写体裁判据（判据归 writingSchema，表只放措辞）', () => {
    expect(/genre\s*===/.test(strip(packSrc))).toBe(false);
    expect(packSrc).toContain('workbenchCommandSet');
  });
  it('塌平入口在场：两个模块查表而不是各自兜底', () => {
    expect(wa).toContain('genrePromptPack(ctx.genre)');
    expect(wm).toContain('genrePromptPack(genre)');
    expect(wm).toContain('genrePromptPack(ctx.genre)');
    // 二重兜底禁：塌平后的模块里不许再出现「?? 小说」式的句子
    expect(strip(wa).includes('?? 小说')).toBe(false);
  });
  it('P14 接线在位：chip 走槽位表、quickAction 走 pack，不许绕表自拼', () => {
    const wc = read('src/editor/panels/workbenchComponents.tsx');
    const hooks = read('src/editor/panels/workbenchPanelHooks.ts');
    expect(wc).toContain("surfaceKeyForGenre(ctx.genre ?? '', 'chipUnderstand')");
    expect(wc).not.toContain("t('workbench.aiUnderstandChapter')");
    expect(hooks).toContain("genrePromptPack(wbGenre).workbench");
    // 书场景的「章节」措辞只能来自表：调用点自拼的五句原文必须已删干净
    for (const probe of ['请读懂章节 ', '请对照人设卡与世界观设定，审查章节 ', '请基于作品概览（全书章节结构与字数分布）']) {
      expect(hooks.includes(probe), `quickAction 仍在自拼：${probe}`).toBe(false);
    }
  });
  it('AI-1-3 塌平不许倒退：workbenchContext 的人设判据已交表，自己不再判体裁', () => {
    const wctx = read('src/editor/panels/workbenchContext.ts');
    // 原 personaWords 的四支 if + 小说兜底必须整条消失（注释里提历史不算：剥注释后再查）
    expect(strip(wctx).includes('personaWords'), 'personaWords 未删除').toBe(false);
    expect(/===\s*["'](poetry|essay|script|diary|novel)["']/.test(strip(wctx)), 'workbenchContext 复活体裁字面判据').toBe(false);
    expect(wctx).toContain('genrePromptPack(genre).persona');
  });
});
