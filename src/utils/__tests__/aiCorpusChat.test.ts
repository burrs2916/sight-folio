// sight-folio: AI 语料参谋 · 推荐句解析/提示词约定（P1 对话模式 · 纯函数回归锁）
import { describe, it, expect } from 'vitest';
import {
  corpusSystemHintFor,
  buildCorpusGeneratePrompt,
  buildCorpusEvidenceBlock,
  detectExampleRequest,
  extractAiCorpusPicks,
  sanitizeDisplayMessages,
  stripInjectedSystemPrefix,
  type CorpusGeneratePurpose,
} from '../aiCorpusChat';
import type { CorpusSearchHit } from '../../services/corpus';

// ㉟ AI-5（轮 12）：常量改函数后，本文件原有断言全部跑**小说口径**（未设/空 genre 值）——
// 它们因此同时是 novel 零回归锁（渲染结果与改造前常量逐字同源）。非小说支的锁在
// `src/ai/__tests__/genreFourMouths.test.ts`。
const AI_CORPUS_SYSTEM_HINT = corpusSystemHintFor('');

describe('extractAiCorpusPicks（AI 回复 → 推荐句）', () => {
  it('提取每条 ">>> " 开头的行（去前缀、去首尾空白）', () => {
    const picks = extractAiCorpusPicks(
      [
        '这句参照很合适，建议直接引用：',
        '>>> 他攥着信纸的手又紧了几分。',
        '>>>   屋檐下还挂着去年的风铃。  ',
        '改写会更贴本章情绪：',
        '>>> 她没接话，只是把灯调暗了一格。',
      ].join('\n'),
    );
    expect(picks).toEqual(['他攥着信纸的手又紧了几分。', '屋檐下还挂着去年的风铃。', '她没接话，只是把灯调暗了一格。']);
  });

  it('正文中含 ">>>" 但不在行首的不算推荐句', () => {
    expect(extractAiCorpusPicks('参考这句 →>>> 别把它当推荐句')).toEqual([]);
  });

  it('空内容 / 无前缀行 / 前缀后空句都返回空数组', () => {
    expect(extractAiCorpusPicks('')).toEqual([]);
    expect(extractAiCorpusPicks('只有普通分析文字，没有推荐句。')).toEqual([]);
    expect(extractAiCorpusPicks('>>>')).toEqual([]);
    expect(extractAiCorpusPicks('>>>   ')).toEqual([]);
  });

  it('前缀紧跟多个 > 也识别（容错强度）', () => {
    expect(extractAiCorpusPicks('>>>> 容错一行。')).toEqual(['容错一行。']);
  });
});

describe('AI_CORPUS_SYSTEM_HINT（首轮注入约定）', () => {
  it('含语料参谋人设与 ">>> " 输出格式约定，且与解析规则同源', () => {
    expect(AI_CORPUS_SYSTEM_HINT).toContain('本书语料参谋');
    expect(AI_CORPUS_SYSTEM_HINT).toContain('>>> ');
    expect(AI_CORPUS_SYSTEM_HINT).toContain('可直接插入正文');
  });
});

describe('buildCorpusGeneratePrompt（P2 一键生成指令）', () => {
  const purposes: Array<[CorpusGeneratePurpose, string]> = [
    ['dialogue', '对白'],
    ['action', '动作'],
    ['scene', '环境'],
    ['auto', '择优'],
  ];

  it.each(purposes)('用途 %s 映射进指令（%s）', (purpose, zhFragment) => {
    const prompt = buildCorpusGeneratePrompt({ count: 3, purpose });
    expect(prompt).toContain('3 条');
    expect(prompt).toContain('>>> ');
    expect(prompt).toContain(zhFragment);
  });

  it('条数被钳制在 1-5（越界取边界）', () => {
    expect(buildCorpusGeneratePrompt({ count: 0, purpose: 'auto' })).toContain('1 条');
    expect(buildCorpusGeneratePrompt({ count: 9, purpose: 'auto' })).toContain('5 条');
    expect(buildCorpusGeneratePrompt({ count: 3.8, purpose: 'auto' })).toContain('3 条');
  });

  it('直接要求输出 ">>> " 行、不输出其他内容（与 extractAiCorpusPicks 解析规则衔接）', () => {
    const prompt = buildCorpusGeneratePrompt({ count: 2, purpose: 'dialogue' });
    expect(prompt).toContain('逐条单独成行并');
    expect(prompt).toContain('>>> ');
    expect(prompt).toMatch(/不要输出其他内容/);
  });
});

describe('detectExampleRequest（C2 找范例意图识别）', () => {
  it('识别找例句意图并返回去除意图短语后的检索关键词', () => {
    expect(detectExampleRequest('帮我找几个写雨的例句')).toBe('帮我找几个写雨的');
  });

  it('识别「怎么写/借鉴/仿写」等常见找范例表达（含 chip「这句该怎么参考」）', () => {
    expect(detectExampleRequest('这句该怎么参考？')).toBe('这句该怎么参考？');
    expect(detectExampleRequest('这种氛围怎么写')).toBe('这种氛围');
    expect(detectExampleRequest('能不能借鉴一下离别戏')).toBe('能不能一下离别戏');
    expect(detectExampleRequest('帮我仿写一段开头的场景')).toBe('帮我一段开头的场景');
    expect(detectExampleRequest('有没有类似的环境描写')).toContain('环境描写');
  });

  it('意图短语在句首/句中/句尾都能命中', () => {
    expect(detectExampleRequest('范例：给我一句雨夜的')).toBe('：给我一句雨夜的');
    expect(detectExampleRequest('给我举个例子，雨夜怎么写急促')).toBe('给我，雨夜怎么写急促');
  });

  it('非找范例请求不触发（既有 chip 语义不误伤、普通参谋对话不受扰）', () => {
    expect(detectExampleRequest('')).toBeNull();
    expect(detectExampleRequest('   ')).toBeNull();
    expect(detectExampleRequest('帮我分析本章基调')).toBeNull();
    expect(detectExampleRequest('语料库没匹配到，帮我造两句')).toBeNull();
    expect(detectExampleRequest('这段对白情绪是否到位？')).toBeNull();
    expect(detectExampleRequest('把这段改写得更克制一些')).toBeNull();
  });

  it('去除意图短语后剩余过短时回退使用整句（保证检索关键词非空）', () => {
    expect(detectExampleRequest('例句')).toBe('例句');
    expect(detectExampleRequest('怎么写？')).toBe('怎么写？');
  });
});

describe('buildCorpusEvidenceBlock（C2 库内原文证据块）', () => {
  const hit = (partial: Partial<CorpusSearchHit>): CorpusSearchHit => ({
    chunkId: 1,
    bookId: 1,
    bookTitle: '样本集',
    seq: 1,
    kind: 'narrative',
    chapterTitle: '第一章',
    content: '雨点敲在瓦上，像谁在深夜拨算盘。',
    referenceTier: 'medium',
    occurrenceCount: 1,
    occurrences: [],
    ...partial,
  });

  it('有命中：保留书名·章节出处，含句子原文与引用约束', () => {
    const block = buildCorpusEvidenceBlock([hit({})], '雨');
    expect(block).toContain('【语料库检索证据】');
    expect(block).toContain('《样本集 · 第一章》');
    expect(block).toContain('雨点敲在瓦上，像谁在深夜拨算盘。');
    expect(block).toContain('保留出处');
    expect(block).toContain('雨');
  });

  it('按参考价值分层排序 high > medium > low，最多取前 6 条', () => {
    const make = (i: number, tier: CorpusSearchHit['referenceTier'], text: string): CorpusSearchHit =>
      hit({ chunkId: i, bookId: i, content: text, referenceTier: tier });
    // 8 条：high×3 / medium×2 / low×3 → top6 = high×3 + medium×2 + 第 1 条 low
    const block = buildCorpusEvidenceBlock([
      make(1, 'low', '碎片句一'),
      make(2, 'high', '优质句'),
      make(3, 'medium', '普通句'),
      make(4, 'high', '优质句二'),
      make(5, 'low', '碎片句二'),
      make(6, 'medium', '普通句二'),
      make(7, 'low', '碎片句三'),
      make(8, 'high', '优质句三'),
    ]);
    const idxHigh1 = block.indexOf('优质句');
    const idxHigh2 = block.indexOf('优质句二');
    const idxHigh3 = block.indexOf('优质句三');
    const idxMed1 = block.indexOf('普通句');
    const idxMed2 = block.indexOf('普通句二');
    const idxLow1 = block.indexOf('碎片句一');
    // high 全部排在 medium、low 之前
    expect(idxHigh1).toBeGreaterThan(-1);
    expect(idxHigh1).toBeLessThan(idxMed1);
    expect(idxHigh2).toBeLessThan(idxMed1);
    expect(idxHigh3).toBeLessThan(idxLow1);
    // medium 排在 low 之前；top6 截断：low 只保留第一条
    expect(idxMed1).toBeLessThan(idxLow1);
    expect(idxMed2).toBeLessThan(idxLow1);
    expect(block).not.toContain('碎片句二');
    expect(block).not.toContain('碎片句三');
    // 最多 6 条：10 条 medium 只展示前 6
    const total = buildCorpusEvidenceBlock(Array.from({ length: 10 }, (_, i) => make(i + 1, 'medium', `句${i + 1}`)));
    expect(total).toContain('召回 10 条');
    expect(total).toContain('其中 6 条');
    expect(total).toMatch(/句1[\s\S]*句2[\s\S]*句3[\s\S]*句4[\s\S]*句5[\s\S]*句6/);
    expect(total).not.toContain('句7');
    expect(total).not.toContain('句8');
  });

  it('无命中：告知检索无结果、要求不声称引用语料库原文', () => {
    const block = buildCorpusEvidenceBlock([], '离别');
    expect(block).toContain('语料库检索');
    expect(block).toContain('离别');
    expect(block).toContain('不要声称引用了语料库原文');
    expect(block).not.toContain('《');
  });

  it('单元测试里章节为空时仅保留书名出处（命中行不带「书名 · 章」分隔符）', () => {
    const block = buildCorpusEvidenceBlock([hit({ chapterTitle: '' })]);
    expect(block).toContain('《样本集》');
    expect(block).not.toContain('样本集 ·');
  });
});

describe('stripInjectedSystemPrefix（展示层剥离系统提示词前缀）', () => {
  it('语料参谋首轮形态：剥离人设 + 上下文，只保留用户原文', () => {
    const content = `${AI_CORPUS_SYSTEM_HINT}\n\nCTX-BLOCK\n\n---\n\n这句该不该参考？`;
    expect(stripInjectedSystemPrefix(content)).toBe('这句该不该参考？');
  });

  it('写作台 AI 对话框形态（无 HINT，直接 上下文---原文）同样剥离', () => {
    const content = `CTX-BLOCK\n\n---\n\n帮我分析本章基调`;
    expect(stripInjectedSystemPrefix(content)).toBe('帮我分析本章基调');
  });

  it('后续轮次（无注入、无分隔符）原样返回，不误伤用户自己输入的分隔线', () => {
    expect(stripInjectedSystemPrefix('那怎么改？')).toBe('那怎么改？');
    expect(stripInjectedSystemPrefix('跨章用 --- 分隔')).toBe('跨章用 --- 分隔');
  });

  it('附带 C2 证据块时一并剥离（有命中 / 无命中两种双语形态）', () => {
    const withEvidence = `${AI_CORPUS_SYSTEM_HINT}\n\nCTX\n\n---\n\n给我找写雨的例句\n\n【语料库检索证据】已从语料库召回 2 条\n- 《样本集》雨点敲在瓦上。`;
    expect(stripInjectedSystemPrefix(withEvidence)).toBe('给我找写雨的例句');
    const noHit = `${AI_CORPUS_SYSTEM_HINT}\n\nCTX\n\n---\n\n雨夜怎么写\n\n【语料库检索】已检索语料库，未找到与「雨夜」相关的现成例句。`;
    expect(stripInjectedSystemPrefix(noHit)).toBe('雨夜怎么写');
    const enEvidence = `${AI_CORPUS_SYSTEM_HINT}\n\nCTX\n\n---\n\nrain scene\n\n[Corpus evidence] 2 sentences retrieved`;
    expect(stripInjectedSystemPrefix(enEvidence)).toBe('rain scene');
  });

  it('空串返回空串', () => {
    expect(stripInjectedSystemPrefix('')).toBe('');
  });

  it('assistant 回复（无注入形态）原样不变', () => {
    const reply = '建议直接引用：\n>>> 他攥着信纸的手又紧了几分。';
    expect(stripInjectedSystemPrefix(reply)).toBe(reply);
  });
});

describe('sanitizeDisplayMessages（消息列表展示态）', () => {
  const msg = (id: string, role: 'user' | 'assistant', content: string) => ({
    id,
    conversationId: 'c1',
    role,
    content,
    toolCalls: null,
    createdAt: 1,
  });

  it('只保留 user/assistant，user 首轮含前缀时剥离为原文，assistant 不变、顺序保留', () => {
    const rows = [
      msg('sys', 'system' as never, '系统指引'),
      msg('m1', 'user', `${AI_CORPUS_SYSTEM_HINT}\n\nCTX\n\n---\n\n这句怎么参考？`),
      msg('m2', 'assistant', '建议直接引用。'),
      { ...msg('t1', 'user', '工具回执'), toolCalls: [] },
    ];
    const out = sanitizeDisplayMessages(rows as any);
    expect(out).toHaveLength(3);
    expect(out[0].content).toBe('这句怎么参考？');
    expect(out[1].content).toBe('建议直接引用。');
    expect(out[2].content).toBe('工具回执');
  });
});
