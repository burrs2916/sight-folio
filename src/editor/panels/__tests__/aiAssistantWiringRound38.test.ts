// aiAssistantWiringRound38.test.ts —— 阶段 B 批次 1「接线三刀」回归锁（2026-11-02 第三十八轮）。
//
// 锁四件事：
//   刀① writingContextProvider / requirementsSpecProvider 把 options.tokenBudget 真的传给
//      packWithinBudget —— 不传第二参会走 no-budget 分支原样返回（tokenBudget.ts），
//      「消费方按预算取数」整条链路静默失效。行为断言 + 源码接线断言双保险。
//   刀② buildManuscriptCorpus 当前章长度闸：超 CHAPTER_TAIL_CHARS 只注入结尾并显式标注；
//      TAIL_CHARS 对外别名与真源同值（口径零第二份）。
//   刀③ buildFollowups 无正文兜底分流：hasManuscriptText=false 不再推「润色/续写/对照上面
//      正文」系追问，改推「动笔构思」；调用方（useWorkbenchChat followups memo）必须传判据。
//   hasChapterManuscript 判据本体（与语料空态同口径）。
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { writingContextProvider } from '../../../ai/providers/writingContextProvider';
import requirementsSpecProvider from '../../../ai/providers/requirementsSpecProvider';
import { useWritingStore } from '../../../store/writingStore';
import { useRequirementsStore } from '../../../store/requirementsStore';
import { buildManuscriptCorpus, hasChapterManuscript } from '../../../utils/writingCorpus';
import { CHAPTER_TAIL_CHARS } from '../../../utils/writingCorpusBudget';
import { TAIL_CHARS } from '../../../ai/writingAssistant';
import { buildFollowups } from '../workbenchPanelHooks';
import type { WritingBook, WritingChapter, WritingSetting } from '../../../services/tauri';

const SRC = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf-8');
/** 否定式判据先剥注释再匹配（轮次任务书陷阱清单⑥） */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BOOK_ID = 'book_r38';

function makeBook(): WritingBook {
  return {
    id: BOOK_ID,
    title: '接线测试书',
    description: '阶段B批次1',
    genre: '',
    medium: '',
    status: 'draft',
    coverColor: '#4A338F',
    dailyGoal: 0,
    extra: '{}',
    createdAt: 1000,
    updatedAt: 2000,
  };
}

function makeChapter(partial: Partial<WritingChapter>): WritingChapter {
  return {
    id: 'chap_r38',
    bookId: BOOK_ID,
    title: '第一章',
    content: '<p>正文若干。</p>',
    sortOrder: 1,
    wordCount: 4,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '章',
    extra: '{}',
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  } as WritingChapter;
}

function makeSetting(i: number): WritingSetting {
  return {
    id: `set_${i}`,
    bookId: BOOK_ID,
    kind: 'character',
    name: `角色${i}`,
    subtitle: '',
    description: '沉默寡言的前刑警，怕水，夜里睡不着会去天台坐着数灯。',
    extra: '{}',
    sortOrder: i,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

// ─── 刀①：token 预算透传 ───

describe('刀① packWithinBudget 预算透传（writing 域）', () => {
  beforeEach(() => {
    useWritingStore.setState({
      books: [makeBook()],
      activeBookId: BOOK_ID,
      activeChapterId: 'chap_r38',
      chapters: [makeChapter({})],
      settings: Array.from({ length: 40 }, (_, i) => makeSetting(i)),
      activeSettingId: null,
      timelineEvents: [],
    });
  });

  it('不传预算：不裁剪，分节正文保持全量（落库全集口径不受影响）', () => {
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    expect(pack.truncatedSections).toEqual([]);
    expect(pack.sections).toHaveLength(8);
    const chars = pack.sections.find((s) => s.key === 'characters')!;
    expect(chars.content).toContain('沉默寡言的前刑警');
  });

  it('传小预算：超预算分节降级为摘要并登记 truncatedSections', () => {
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000, tokenBudget: 60 })!;
    expect(pack.truncatedSections).toContain('characters');
    const chars = pack.sections.find((s) => s.key === 'characters')!;
    // 降级 = 摘要 + 「预算未展开」指引，不是丢弃（Agent 至少知道这一维度存在、可用工具取）
    expect(chars.content).toContain('正文因 token 预算未展开');
    expect(chars.content).not.toContain('夜里睡不着会去天台坐着数灯');
    expect(pack.sections).toHaveLength(8);
  });

  it('传预算后包体积估算显著小于全量构建（预算真的在管账）', () => {
    const full = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const budgeted = writingContextProvider.buildPack(BOOK_ID, { now: 5000, tokenBudget: 60 })!;
    expect(budgeted.tokenEstimate).toBeLessThan(full.tokenEstimate);
  });
});

describe('刀① packWithinBudget 预算透传（requirements-spec 域）', () => {
  const SCOPE = 'proj_r38';
  const CONTENT =
    '客户要求导出功能：' + '支持按月份区间导出订单明细，含运费与优惠字段，格式为 UTF-8 的 CSV。'.repeat(8);

  beforeEach(() => {
    useRequirementsStore.setState({ baselines: { [SCOPE]: { content: CONTENT, updatedAt: 1000 } } });
  });

  it('不传预算：基线全文注入', () => {
    const pack = requirementsSpecProvider.buildPack(SCOPE, { now: 5000 })!;
    expect(pack.truncatedSections).toEqual([]);
    expect(pack.sections[0].content).toContain('UTF-8 的 CSV');
  });

  it('传小预算：基线降级为摘要并给出按需取数指引', () => {
    const pack = requirementsSpecProvider.buildPack(SCOPE, { now: 5000, tokenBudget: 20 })!;
    expect(pack.truncatedSections).toContain('requirements-spec');
    expect(pack.sections[0].content).toContain('正文因 token 预算未展开');
    expect(pack.sections[0].content).toContain('project_context');
  });
});

describe('刀① 接线源码锁（防静默改回单参调用）', () => {
  it('两个 provider 的 packWithinBudget 都带 options?.tokenBudget 第二参', () => {
    // ㉲ 注（轮 33 · AI-3）：writing 侧第一参从字面数组换成先按体裁裁段的 `packSections`（轮 38 锁的是
    // 「预算必须透传」，不是「数组必须就地摆」——轮 26 换写法先例，牙不减）。
    // 单参调用回潮（no-budget 分支静默失效）依旧红：第二参缺席 = 不匹配。
    for (const p of ['ai/providers/writingContextProvider.ts', 'ai/providers/requirementsSpecProvider.ts']) {
      const src = stripComments(read(p));
      expect(src, p).toMatch(
        /packWithinBudget\(\s*(\[[\s\S]*?\]|packSections)\s*,\s*options\?\.tokenBudget\s*,?\s*\)/,
      );
    }
  });

  it('followups 调用点必须把 hasManuscriptText 传给 buildFollowups', () => {
    const src = stripComments(read('editor/panels/workbenchPanelHooks.ts'));
    const call = src.match(/return buildFollowups\(\{[\s\S]*?\}\);/);
    expect(call, 'buildFollowups 调用点').not.toBeNull();
    expect(call![0]).toContain('hasManuscriptText');
  });
});

// ─── 刀②：当前章全文注入长度闸 ───

describe('刀② buildManuscriptCorpus 当前章长度闸（TAIL_CHARS 口径）', () => {
  const tailOfPlain = (s: string) => s.replace(/<[^>]+>/g, '');

  it('TAIL_CHARS 对外别名 == writingCorpusBudget 真源（口径零第二份）', () => {
    expect(TAIL_CHARS).toBe(CHAPTER_TAIL_CHARS);
    // 真源之外的分身数字清零：writingAssistant 不许再写死 3000
    expect(stripComments(read('ai/writingAssistant.ts'))).not.toMatch(/TAIL_CHARS\s*=\s*3000/);
  });

  it('超长章：只注入结尾 CHAPTER_TAIL_CHARS 字符，头行显式标注（中英同步）', () => {
    const long = '甲'.repeat(1500) + '乙'.repeat(CHAPTER_TAIL_CHARS + 1);
    const { zh, en } = buildManuscriptCorpus('测试书', [makeChapter({ content: long, wordCount: 4501 })], 'chap_r38');
    expect(zh).toContain('超长，仅注入结尾部分');
    expect(en).toContain('tail only, length-capped');
    expect(zh).toContain(`…${long.slice(-CHAPTER_TAIL_CHARS)}`);
    expect(zh).not.toContain(long); // 原文整体不许再出现
    expect(tailOfPlain(zh).length).toBeLessThan(long.length);
  });

  it('未超限（含恰好等于上限）：全文注入、不加标注', () => {
    const exact = '甲'.repeat(CHAPTER_TAIL_CHARS);
    const { zh } = buildManuscriptCorpus('测试书', [makeChapter({ content: exact })], 'chap_r38');
    expect(zh).toContain(exact);
    expect(zh).not.toContain('超长');
    const short = '<p>短正文。</p>';
    const r = buildManuscriptCorpus('测试书', [makeChapter({ content: short })], 'chap_r38');
    expect(r.zh).toContain('短正文。');
    expect(r.zh).not.toContain('超长');
  });

  it('空章/无激活章路径零回归', () => {
    const empty = buildManuscriptCorpus('测试书', [makeChapter({ content: '<p></p>' })], 'chap_r38');
    expect(empty.zh).toContain('本章正文为空——新章起步');
    expect(empty.zh).not.toContain('超长');
    const none = buildManuscriptCorpus('测试书', [makeChapter({})], null);
    expect(none.zh).toContain('当前无激活章节');
  });
});

// ─── 刀③：兜底追问「本视图无正文」判据 ───

describe('刀③ hasChapterManuscript 判据', () => {
  it('激活章缺失/纯标签/纯空白 = 无正文；有文字 = 有正文', () => {
    expect(hasChapterManuscript([], null)).toBe(false);
    expect(hasChapterManuscript([makeChapter({})], 'missing')).toBe(false);
    expect(hasChapterManuscript([makeChapter({ content: '<p></p><p></p>' })], 'chap_r38')).toBe(false);
    expect(hasChapterManuscript([makeChapter({ content: '<p>   </p>' })], 'chap_r38')).toBe(false);
    expect(hasChapterManuscript([makeChapter({ content: '<p>开头一句。</p>' })], 'chap_r38')).toBe(true);
  });
});

describe('刀③ buildFollowups 无正文兜底分流', () => {
  const base = { hasActiveFile: false, producedCode: false, hasDiagnostics: false, hasScope: false };
  const keys = (list: ReturnType<typeof buildFollowups>) => list.map((x) => x.key);

  it('writing + 无正文：改推动笔构思，绝不推「润色/对照/续写上面这段正文」', () => {
    const out = buildFollowups({ ...base, isBookScene: true, bookTopic: 'writing', hasManuscriptText: false });
    expect(keys(out)).toEqual(['draftOpen', 'chapterBeats']);
    expect(keys(out)).not.toContain('improve');
    expect(keys(out)).not.toContain('consistency');
    expect(keys(out)).not.toContain('continue');
    for (const item of out) {
      expect(item.labelKey.startsWith('workbench.aiFollowup.book.')).toBe(true);
      expect(item.prompt.length).toBeGreaterThan(10);
    }
  });

  it('writing + 有正文：保持通用写作向 3 条（零回归）', () => {
    const out = buildFollowups({ ...base, isBookScene: true, bookTopic: 'writing', hasManuscriptText: true });
    expect(keys(out)).toEqual(['improve', 'consistency', 'continue']);
  });

  it('调用方没给判据（undefined）：保持原行为，不摆烂兜底', () => {
    const out = buildFollowups({ ...base, isBookScene: true, bookTopic: 'writing' });
    expect(keys(out)).toEqual(['improve', 'consistency', 'continue']);
  });

  it('专属题材分支不受判据影响（stats/overview 原样）', () => {
    expect(keys(buildFollowups({ ...base, isBookScene: true, bookTopic: 'stats', hasManuscriptText: false }))).toEqual([
      'statsGoal',
      'statsPlan',
      'statsBlocker',
    ]);
    expect(
      keys(buildFollowups({ ...base, isBookScene: true, bookTopic: 'overview', hasManuscriptText: false })),
    ).toHaveLength(4);
  });

  it('代码场景：判据缺省也不引入书向追问', () => {
    const out = buildFollowups({ ...base, hasActiveFile: true, producedCode: true, hasManuscriptText: false });
    expect(keys(out)).not.toContain('draftOpen');
    expect(keys(out)).not.toContain('improve');
  });
});
