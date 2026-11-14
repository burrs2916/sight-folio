/**
 * ㉒ 日记在 AI 生成层的锁（2026-11-10）。
 *
 * 21 号那一刀刚把剧本从「网文写手」里捞出来，同一层紧接着又只给了它三分支的旧结构 ——
 * 所以日记开闸这一轮**不留 AI 层**，一次配齐并当场钉住。
 *
 * 日记在 prompt 层只有一条命门：**模型不许替作者编记忆**。
 * 小说那句"不得改变情节、人物行为、时间线"对日记没有约束力 —— 日记里没有情节，只有那天。
 * 所以这里既锁"说了日记的话"，也锁"没漂动另外四个体裁"。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setLang } from '../../i18n';
import {
  buildContinueMessage,
  buildPolishMessage,
  buildRewriteMessage,
  buildSummarizeMessage,
  buildReviewMessage,
  type InlineWritingContext,
} from '../writingAssistant';
// ㉕（轮 32 AI-1-1）：布尔判据塌平成 pack 查表，本文件的「只认 diary」改判
// pack 身份 —— 语义等价：真值落自己那一格，脏值 / 空 / undefined 一律落 novel 格。
import { GENRE_PROMPT_PACKS, genrePromptPack } from '../genrePromptPack';
const isDiaryGenre = (g?: string) => genrePromptPack(g) === GENRE_PROMPT_PACKS.diary;
import {
  buildMaterialAnalysisMessage,
  buildMaterialDraftMessage,
  type MaterialDraftContext,
  type MaterialSourceFile,
} from '../writingMaterial';

// writingMaterial 顶层 import agentStore / agentApi：不 mock 会把 Tauri 服务层拖进单测。
vi.mock('../../store/agentStore', () => ({
  useAgentStore: () => ({}),
}));
vi.mock('../../services/tauri', () => ({ agentApi: { listMessages: vi.fn() } }));

function ctx(partial: Partial<InlineWritingContext> = {}): InlineWritingContext {
  return {
    bookTitle: '这些年',
    bookDescription: '随手记的日记',
    chapterTitle: '第 1 天',
    chapterText: '今天雨很大，母亲走的时候没说句话。',
    characterLines: ['母亲：七十二岁，不肯住城里的房子。'],
    outlineLines: [],
    ...partial,
  };
}

const FILES: MaterialSourceFile[] = [{ name: 'a.txt', path: '/tmp/a.txt', excerpt: '资料正文', charCount: 4 }];

function draft(partial: Partial<MaterialDraftContext> = {}): MaterialDraftContext {
  return { bookTitle: '这些年', chapterTitle: '第 1 天', chapterText: '今天雨很大。', analysis: '资料分析结果', ...partial };
}

const INLINE_BUILDERS = [
  ['continue', buildContinueMessage],
  ['polish', buildPolishMessage],
  ['rewrite', buildRewriteMessage],
  ['summarize', buildSummarizeMessage],
  ['review', buildReviewMessage],
] as const;

describe('㉒ isDiaryGenre 判据', () => {
  it('只认 diary，其余（含脏值 / 空 / undefined）一律 false', () => {
    expect(isDiaryGenre('diary')).toBe(true);
    for (const g of ['novel', 'essay', 'poetry', 'script', '', 'Diary', 'diary ', null, undefined]) {
      expect(isDiaryGenre(g as unknown as string | undefined), `${String(g)} 不该算日记`).toBe(false);
    }
  });
});

describe('㉒ 日记：五条内联 prompt', () => {
  afterEach(() => setLang('zh-CN'));

  it('单位标签一律「【当前条目】」，五条都不留「【当前章节】」', () => {
    setLang('zh-CN');
    for (const [name, build] of INLINE_BUILDERS) {
      const msg = build(ctx({ genre: 'diary' }));
      expect(msg, `${name} 要说「当前条目」`).toContain('【当前条目】');
      expect(msg, `${name} 不许再说「当前章节」`).not.toContain('【当前章节】');
    }
  });

  it('四条硬线都在：不编记忆、不补场景、不升华、不套小说的 300～600 字', () => {
    setLang('zh-CN');
    const cont = buildContinueMessage(ctx({ genre: 'diary' }));
    expect(cont).toContain('这条日记');
    expect(cont).toContain('不要替作者编造那天发生的事');
    expect(cont).not.toContain('300～600 字');
    expect(cont).not.toContain('小说片段');

    const polish = buildPolishMessage(ctx({ genre: 'diary' }));
    expect(polish).not.toContain('小说');
    expect(polish).toContain('这条日记');
    expect(polish).toContain('不得补写原文没有的场景');
    expect(polish).toContain('写给自己看的记录');

    const rewrite = buildRewriteMessage(ctx({ genre: 'diary' }));
    expect(rewrite).not.toContain('小说');
    expect(rewrite).toContain('增补记忆');

    const sum = buildSummarizeMessage(ctx({ genre: 'diary' }));
    expect(sum).not.toContain('小说');
    expect(sum).toContain('不得补写原文没有的因果');

    const withTarget = buildContinueMessage(ctx({ genre: 'diary', targetWords: 200 }));
    expect(withTarget).toContain('约 200 字');
  });

  it('审校：名词是日记，第 5 条豁免"省主语 / 口语 / 私人简称"，且不与诗、剧本串味', () => {
    setLang('zh-CN');
    const diary = buildReviewMessage(ctx({ genre: 'diary' }));
    expect(diary).toContain('请对下面的日记文本做逐句语法审校');
    expect(diary).toContain('日记是写给自己的');
    expect(diary).toContain('只有作者懂的简称');
    const poem = buildReviewMessage(ctx({ genre: 'poetry' }));
    const script = buildReviewMessage(ctx({ genre: 'script' }));
    const novel = buildReviewMessage(ctx({ genre: 'novel' }));
    expect(poem).not.toContain('只有作者懂的简称');
    expect(script).not.toContain('只有作者懂的简称');
    expect(diary).not.toContain('跨行不成句');
    expect(diary).not.toContain('舞台指示');
    expect(novel).not.toContain('\n5.');
  });

  it('英文面同步：entry / journal，不留 chapter 单位名', () => {
    setLang('en-US');
    const p = buildPolishMessage(ctx({ genre: 'diary' }));
    expect(p).toContain('[Current entry]');
    expect(p).not.toContain('[Current Chapter]');
    expect(p.toLowerCase()).not.toContain('polish the chapter below');
    const r = buildReviewMessage(ctx({ genre: 'diary' }));
    expect(r).toContain('Proofread the journal entry text');
    expect(r).toContain('private abbreviations');
  });
});

describe('㉒ 资料辅助：日记不许被"生成"出来', () => {
  afterEach(() => setLang('zh-CN'));

  it('日记生稿是"整理"不是"写"：只许用已写明的事实，不足要说资料不足', () => {
    setLang('zh-CN');
    const m = buildMaterialDraftMessage(draft({ genre: 'diary' }));
    expect(m).not.toContain('网文写手');
    expect(m).not.toContain('800～2000');
    expect(m).toContain('替作者整理日记条目的人');
    expect(m).toContain('资料不足');
    expect(m).toContain('【该条目】');
    expect(m).toContain('【该条目已有正文】');
    const empty = buildMaterialDraftMessage(draft({ genre: 'diary', chapterText: '' }));
    expect(empty).toContain('这条还没有正文');
    expect(empty).toContain('不要凭空写出一天的经历');
  });

  it('资料分析的落点名词跟着体裁走', () => {
    setLang('zh-CN');
    expect(buildMaterialAnalysisMessage(FILES, 'diary')).toContain('供后续日记创作使用');
    expect(buildMaterialAnalysisMessage(FILES, 'diary')).toContain('聚焦可以直接被日记使用的信息');
    setLang('en-US');
    expect(buildMaterialAnalysisMessage(FILES, 'diary')).toContain('for later journal writing');
    expect(buildMaterialAnalysisMessage(FILES, 'diary')).toContain('directly usable in a journal entry.');
  });
});

describe('㉒ 零回归：小说 / 散文 / 诗 / 剧本的关键句逐字在场', () => {
  afterEach(() => setLang('zh-CN'));

  it('小说五句（含未设置体裁的旧书）', () => {
    setLang('zh-CN');
    expect(buildContinueMessage(ctx())).toContain(
      '请为下面的小说片段续写。直接续写正文本身：不要任何解释、标题、前言或总结；不要复述已有内容；不要写「以下是续写」之类的话。',
    );
    expect(buildContinueMessage(ctx())).toContain(
      '从上面的末尾无缝接着往下写 300～600 字，保持人称、时态、文风与已有内容一致。',
    );
    expect(buildPolishMessage(ctx())).toContain(
      '请润色下面的整章小说：提升文字表现力（节奏、画面、对话质感），但**不得改变**情节、人物行为、时间线与信息量；不得增删情节点；保留原有分段结构。直接输出润色后的全文正文：不要任何解释、对照说明或总结。',
    );
    expect(buildRewriteMessage(ctx())).toContain(
      '请改写下面的整章小说：在**保留情节、人物行为、时间线与全部信息量**的前提下，重构表达——允许调整句式长短、段落切分、叙事节奏与措辞，让文字更有张力与可读性。**不要**增删故事事实；保留原有分段结构。直接输出改写后的全文正文：不要任何解释、对照说明或总结。',
    );
    expect(buildSummarizeMessage(ctx())).toContain(
      '请总结本章小说：提炼本章发生的情节、人物动向与关键推进（每小节要点式列出），控制在 400 字以内。只总结本章内容，不要补充本章之外的情节，不要评价文笔。',
    );
    expect(buildReviewMessage(ctx())).toContain('请对下面的小说文本做逐句语法审校');
    expect(buildReviewMessage(ctx({ genre: '' }))).toContain('请对下面的小说文本做逐句语法审校');
  });

  it('剧本（㉑ 刚补的那一支）没被日记插队插掉', () => {
    setLang('zh-CN');
    const s = buildPolishMessage(ctx({ genre: 'script' }));
    expect(s).toContain('这一幕剧本');
    expect(s).toContain('不得增删幕与场的编号');
    expect(buildSummarizeMessage(ctx({ genre: 'script' }))).toContain('出场人物');
    expect(buildMaterialDraftMessage(draft({ genre: 'script' }))).toContain('你是一位剧作者');
    expect(buildMaterialAnalysisMessage(FILES, 'script')).toContain('供后续剧本创作使用');
  });

  it('散文与诗各自的句子仍在', () => {
    setLang('zh-CN');
    expect(buildPolishMessage(ctx({ genre: 'essay' }))).toContain('请润色下面这篇散文：');
    expect(buildSummarizeMessage(ctx({ genre: 'essay' }))).toContain('请总结这篇散文：');
    expect(buildPolishMessage(ctx({ genre: 'poetry' }))).toContain('请润色下面这首诗：');
    expect(buildRewriteMessage(ctx({ genre: 'poetry' }))).toContain('请改写下面这首诗：');
    const d = buildMaterialDraftMessage(draft({ genre: 'poetry' }));
    expect(d).toContain('你是一位诗歌作者');
    expect(d).toContain('5. 写短制：8～30 行左右，依诗意自然增减，不要为凑篇幅铺陈。');
    expect(d).toContain('【目标诗作已有正文】');
  });

  it('小说资料生稿逐字在场（含「网文写手」与 800～2000 字那句）', () => {
    setLang('zh-CN');
    const n = buildMaterialDraftMessage(draft());
    expect(n).toContain('你是一位网文写手。请根据下面的【资料分析】与【目标章信息】，为指定章节生成正文草稿。');
    expect(n).toContain('5. 字数控制在 800～2000 字左右（根据情节需要自然增减）。');
    expect(n).toContain('【目标章已有正文】');
    expect(n).toContain('【目标章节】');
  });
});
