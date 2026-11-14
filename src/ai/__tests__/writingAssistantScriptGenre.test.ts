/**
 * ㉑ 剧本在 AI 生成层的锁（2026-11-10）。
 *
 * 这一刀修的是一个成簇的漏口：`writingAssistant.ts` / `writingMaterial.ts` 只有
 * 诗 / 散文 / 小说兜底 三分支，`script` 一路掉进小说 —— 模型收到的是
 * 「你是一位**网文写手**…分成自然段落…800～2000 字」与「请润色下面的**整章小说**」。
 * 那不是叫法不准，是**会让模型把一出戏排成散文段落**。
 *
 * 所以这个文件锁两件事：
 *  1. 剧本每条 prompt 都说戏剧的话（幕场编号 / 角色名起行 / 谁挡着谁）；
 *  2. 小说·散文·诗的关键句**逐字**不变 —— 字符串是从改造前的文件里逐字抄的（不是凭印象），
 *     插值重构（`n.zh`、`extraRuleZh`）最容易偷偷改掉历史文案，这类锁就是为此存在的。
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
// ㉕（轮 32 AI-1-1）：布尔判据塌平成 pack 查表，本文件的「只认 script」改判
// pack 身份 —— 语义等价：真值落自己那一格，脏值 / 空 / undefined 一律落 novel 格。
import { GENRE_PROMPT_PACKS, genrePromptPack } from '../genrePromptPack';
const isScriptGenre = (g?: string) => genrePromptPack(g) === GENRE_PROMPT_PACKS.script;
import {
  buildMaterialAnalysisMessage,
  buildMaterialDraftMessage,
  type MaterialDraftContext,
  type MaterialSourceFile,
} from '../writingMaterial';

// writingMaterial 顶层 import agentStore / agentApi —— 不 mock 会把 Tauri 服务层拖进单测。
// mock 路径从 src/ai/__tests__ 到 src 是两级 ../../（层级错一级会静默失效）。
vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({}),
    { getState: () => ({}), subscribe: () => () => {} },
  ),
}));
vi.mock('../../services/tauri', () => ({ agentApi: { listMessages: vi.fn() } }));

function ctx(partial: Partial<InlineWritingContext> = {}): InlineWritingContext {
  return {
    bookTitle: '测试之书',
    bookDescription: '一个测试用的故事',
    chapterTitle: '第一场',
    chapterText: '林越：你来了。\n（沉默。他摘下帽子。）',
    characterLines: ['林越（主角）：沉默寡言的前刑警。'],
    outlineLines: ['雨夜重逢 → 第一场：林越再遇苏晚'],
    ...partial,
  };
}

const FILES: MaterialSourceFile[] = [{ name: 'a.txt', path: '/tmp/a.txt', excerpt: '资料正文', charCount: 4 }];

function draft(partial: Partial<MaterialDraftContext> = {}): MaterialDraftContext {
  return {
    bookTitle: '测试之书',
    chapterTitle: '第一场',
    chapterText: '林越：你来了。',
    analysis: '资料分析结果',
    ...partial,
  };
}

const INLINE_BUILDERS = [
  ['continue', buildContinueMessage],
  ['polish', buildPolishMessage],
  ['rewrite', buildRewriteMessage],
  ['summarize', buildSummarizeMessage],
  ['review', buildReviewMessage],
] as const;

describe('㉑ isScriptGenre 判据', () => {
  it('只认 script，其余（含脏值 / 空 / undefined）一律 false', () => {
    expect(isScriptGenre('script')).toBe(true);
    for (const g of ['novel', 'essay', 'poetry', '', 'Script', 'script ', null, undefined]) {
      expect(isScriptGenre(g as unknown as string | undefined), `${String(g)} 不该算剧本`).toBe(false);
    }
  });
});

describe('㉑ 剧本：五条内联 prompt', () => {
  afterEach(() => setLang('zh-CN'));

  it('单位标签一律「【当前场次】」，五条都不留「【当前章节】」', () => {
    setLang('zh-CN');
    for (const [name, build] of INLINE_BUILDERS) {
      const msg = build(ctx({ genre: 'script' }));
      expect(msg, `${name} 要说「当前场次」`).toContain('【当前场次】');
      expect(msg, `${name} 不许再说「当前章节」`).not.toContain('【当前章节】');
    }
  });

  it('整篇润色 / 改写 / 总结：不再顶着「小说」，并写死戏剧的不可动项', () => {
    setLang('zh-CN');
    const polish = buildPolishMessage(ctx({ genre: 'script' }));
    expect(polish).not.toContain('小说');
    expect(polish).toContain('这一幕剧本');
    expect(polish).toContain('不得增删幕与场的编号');
    expect(polish).toContain('说出口的话');

    const rewrite = buildRewriteMessage(ctx({ genre: 'script' }));
    expect(rewrite).not.toContain('小说');
    expect(rewrite).toContain('谁要什么、谁挡着');
    expect(rewrite).toContain('不得把对白改成叙述');

    const sum = buildSummarizeMessage(ctx({ genre: 'script' }));
    expect(sum).not.toContain('小说');
    expect(sum).toContain('出场人物');
    expect(sum).toContain('谁挡着');
  });

  it('续写：按对白排法往下写，不套小说的 300～600 字', () => {
    setLang('zh-CN');
    const m = buildContinueMessage(ctx({ genre: 'script' }));
    expect(m).toContain('这一幕剧本');
    expect(m).toContain('角色名起行');
    expect(m).not.toContain('300～600 字');
    expect(m).not.toContain('小说片段');
    const withTarget = buildContinueMessage(ctx({ genre: 'script', targetWords: 500 }));
    expect(withTarget).toContain('约 500 字');
    expect(withTarget).toContain('不要排成散文段落');
  });

  it('审校第 5 条是**体裁豁免**：诗=跨行 / 剧本=台词与括注 / 小说散文没有第 5 条', () => {
    setLang('zh-CN');
    const poem = buildReviewMessage(ctx({ genre: 'poetry' }));
    const script = buildReviewMessage(ctx({ genre: 'script' }));
    const novel = buildReviewMessage(ctx({ genre: 'novel' }));
    const essay = buildReviewMessage(ctx({ genre: 'essay' }));
    expect(poem).toContain('跨行不成句');
    expect(script).not.toContain('跨行不成句');
    expect(script).toContain('舞台指示');
    expect(poem).not.toContain('舞台指示');
    expect(script).toContain('请对下面的剧本文本');
    expect(novel).not.toContain('\n5.');
    expect(essay).not.toContain('\n5.');
  });

  it('英文面同步：剧本说 scene / playwright，不出现 chapter 与 novel 的单位名', () => {
    setLang('en-US');
    const p = buildPolishMessage(ctx({ genre: 'script' }));
    expect(p).toContain('[Current scene]');
    expect(p).not.toContain('[Current Chapter]');
    expect(p.toLowerCase()).not.toContain('polish the chapter below');
    const r = buildReviewMessage(ctx({ genre: 'script' }));
    expect(r).toContain('Proofread the play script text');
    expect(r).toContain('stage direction');
  });
});

describe('㉑ 资料辅助：生稿与分析', () => {
  afterEach(() => setLang('zh-CN'));

  it('剧本生稿：剧作者 + 对白格式 + 一个冲突回合，不再是网文写手的 800～2000 字', () => {
    setLang('zh-CN');
    const m = buildMaterialDraftMessage(draft({ genre: 'script' }));
    expect(m).not.toContain('网文写手');
    expect(m).not.toContain('800～2000');
    expect(m).toContain('你是一位剧作者');
    expect(m).toContain('角色名单独一行');
    expect(m).toContain('【目标场次】');
    expect(m).toContain('【目标场次已有正文】');
    const empty = buildMaterialDraftMessage(draft({ genre: 'script', chapterText: '' }));
    expect(empty).toContain('【目标场次正文】这场还没有正文');
  });

  it('资料分析的落点名词按体裁（未选作品 / 小说 = 原句逐字不变）', () => {
    setLang('zh-CN');
    expect(buildMaterialAnalysisMessage(FILES)).toContain('供后续小说创作使用');
    expect(buildMaterialAnalysisMessage(FILES, 'novel')).toContain('供后续小说创作使用');
    expect(buildMaterialAnalysisMessage(FILES, 'script')).toContain('供后续剧本创作使用');
    expect(buildMaterialAnalysisMessage(FILES, 'poetry')).toContain('供后续诗歌创作使用');
    expect(buildMaterialAnalysisMessage(FILES, 'essay')).toContain('供后续散文创作使用');
    expect(buildMaterialAnalysisMessage(FILES, 'script')).not.toContain('供后续小说创作使用');
    setLang('en-US');
    expect(buildMaterialAnalysisMessage(FILES)).toContain('for later fiction writing');
    expect(buildMaterialAnalysisMessage(FILES)).toContain('directly usable in fiction.');
    expect(buildMaterialAnalysisMessage(FILES, 'script')).toContain('for later scene writing');
    expect(buildMaterialAnalysisMessage(FILES, 'script')).toContain('directly usable in a play.');
  });
});

describe('㉑ 零回归：小说 / 散文 / 诗的关键句逐字未动', () => {
  afterEach(() => setLang('zh-CN'));

  it('小说（含未设置体裁的旧书）五句原文逐字在场', () => {
    setLang('zh-CN');
    // 以下引号内字符串是**改造前文件里的原文**（本轮改造前的 read 输出逐字复制），不是复述。
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

  it('散文与诗各自的句子仍在，且没有被剧本分支插队插掉', () => {
    setLang('zh-CN');
    expect(buildPolishMessage(ctx({ genre: 'essay' }))).toContain('请润色下面这篇散文：');
    expect(buildRewriteMessage(ctx({ genre: 'essay' }))).toContain('请改写下面这篇散文：');
    expect(buildSummarizeMessage(ctx({ genre: 'essay' }))).toContain('请总结这篇散文：');
    expect(buildPolishMessage(ctx({ genre: 'poetry' }))).toContain('请润色下面这首诗：');
    expect(buildRewriteMessage(ctx({ genre: 'poetry' }))).toContain('请改写下面这首诗：');
    expect(buildSummarizeMessage(ctx({ genre: 'poetry' }))).toContain('请总结这首诗：');
    const d = buildMaterialDraftMessage(draft({ genre: 'essay' }));
    expect(d).toContain('你是一位散文作者');
    expect(d).toContain('字数控制在 800～2000 字左右（根据表达需要自然增减）。');
    const p = buildMaterialDraftMessage(draft({ genre: 'poetry' }));
    expect(p).toContain('你是一位诗歌作者');
    expect(p).toContain('5. 写短制：8～30 行左右，依诗意自然增减，不要为凑篇幅铺陈。');
    expect(p).toContain('【目标诗作】');
  });

  it('小说资料生稿：网文写手那句逐字在场（含【目标章信息】的"章信息"形状）', () => {
    setLang('zh-CN');
    const n = buildMaterialDraftMessage(draft());
    expect(n).toContain(
      '你是一位网文写手。请根据下面的【资料分析】与【目标章信息】，为指定章节生成正文草稿。',
    );
    expect(n).toContain('5. 字数控制在 800～2000 字左右（根据情节需要自然增减）。');
    expect(n).toContain('【目标章已有正文】');
    expect(n).toContain('【目标章节】');
    const empty = buildMaterialDraftMessage(draft({ chapterText: '' }));
    expect(empty).toContain('【目标章正文】本章还没有正文，请从开头直接展开。');
  });
});
