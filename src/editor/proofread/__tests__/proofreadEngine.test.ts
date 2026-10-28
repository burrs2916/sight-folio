// 批次③ T5：编辑器实时校对引擎单测
//   - runProofread 三类检测（typo / repeat / sensitive）与排序/空文本
//   - buildTextIndex + textRangeToPos 与 getText() 规则的一致性（定位自洽）
import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { runProofread, fixTextFromRight } from '../proofreadEngine';
import { buildTextIndex, textRangeToPos, docPosToTextOffset } from '../locate';

// 最小 schema：doc → 多个 paragraph → text（与 TipTap 默认 blockSeparator='\n\n' 的展平规则一致）
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});

/** 用 schema 直接构造 doc，避免依赖 DOM（node 环境可跑） */
const docFromParas = (...paras: string[]) =>
  schema.node(
    'doc',
    null,
    paras.map((t) => schema.node('paragraph', null, schema.text(t))),
  );

describe('runProofread —— 三类检测', () => {
  it('错别字短语命中（typoPhrases 表）', () => {
    const issues = runProofread('他行事一诺千斤，从不作假。');
    const typo = issues.filter((i) => i.kind === 'typo');
    expect(typo.length).toBeGreaterThan(0);
    expect(typo[0]).toMatchObject({ kind: 'typo' });
    expect(typo[0].suggestion).toBeTruthy();
  });

  it('typo 透传可替换 fix；歧义短语（含 / 候选）不提供 fix', () => {
    // 「一诺千斤」→「一诺千金」可确定替换
    const issues = runProofread('他行事一诺千斤。');
    const fixable = issues.filter((i) => i.kind === 'typo' && i.fix);
    expect(fixable.length).toBeGreaterThan(0);
    expect(fixable[0].fix).toBe('一诺千金');
    // 「在在」right 为「在/再」，存在歧义 → 不提供 fix（防静默改错）
    const ambiguous = runProofread('他在在门口站着。').filter((i) => i.kind === 'typo');
    expect(ambiguous.length).toBeGreaterThan(0);
    for (const a of ambiguous) {
      expect(a.fix).toBeUndefined();
    }
  });

  it('fixTextFromRight 清洗字段：去尾部括号注释，斜杠候选返回 undefined', () => {
    expect(fixTextFromRight('莫名其妙（明）')).toBe('莫名其妙');
    expect(fixTextFromRight('悬梁刺股')).toBe('悬梁刺股');
    expect(fixTextFromRight('在/再')).toBeUndefined();
    expect(fixTextFromRight('他/她/它')).toBeUndefined();
    expect(fixTextFromRight('做/作')).toBeUndefined();
  });

  it('正确成语不误报', () => {
    expect(runProofread('他行事一诺千金，从不作假。')).toEqual([]);
  });

  it('重复用词命中（相邻/近邻重复）', () => {
    const issues = runProofread('我不信我不信，这不可能。');
    const rep = issues.filter((i) => i.kind === 'repeat');
    expect(rep.length).toBeGreaterThan(0);
    expect(rep[0].excerpt).toContain('我不信');
  });

  it('敏感词分级命中（warning / block）', () => {
    const issues = runProofread('文中提到法轮功相关内容。');
    const sn = issues.filter((i) => i.kind === 'sensitive');
    expect(sn.length).toBeGreaterThan(0);
    expect(sn[0].severity).toBe('block');
  });

  it('空文本返回 []', () => {
    expect(runProofread('')).toEqual([]);
    expect(runProofread('   \n  ')).toEqual([]);
  });

  it('结果按 start 升序；同 start 优先 block>warning>typo>repeat', () => {
    const issues = runProofread('我不信我不信，法轮功一诺千金');
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i].start).toBeGreaterThanOrEqual(issues[i - 1].start);
    }
    const order: Record<string, number> = { block: 3, warning: 2, typo: 1, repeat: 0 };
    const rank = (i: (typeof issues)[number]) =>
      i.kind === 'sensitive' ? order[i.severity ?? 'warning'] : order[i.kind];
    for (let i = 1; i < issues.length; i++) {
      if (issues[i].start === issues[i - 1].start) {
        expect(rank(issues[i - 1])).toBeGreaterThanOrEqual(rank(issues[i]));
      }
    }
  });
});

describe('runProofread —— 标点专项检测（punct）', () => {
  it('未闭合左引号报 punct（无 fix）', () => {
    const issues = runProofread('他说：“你好。');
    const punct = issues.filter((i) => i.kind === 'punct');
    expect(punct.length).toBe(1);
    expect(punct[0].suggestion).toContain('未闭合');
    expect(punct[0].fix).toBeUndefined();
  });

  it('多余右引号报 punct（无 fix）', () => {
    const issues = runProofread('他说：你好。”');
    const punct = issues.filter((i) => i.kind === 'punct');
    expect(punct.length).toBe(1);
    expect(punct[0].suggestion).toContain('多余的右引号');
    expect(punct[0].fix).toBeUndefined();
  });

  it('「」与“”配对闭合不报；正确文本无 punct', () => {
    expect(runProofread('他说：“你好。”然后又说：「再见」。')).toEqual([]);
  });

  it('单个省略号 … 报 punct 并提供 fix ……', () => {
    const issues = runProofread('他很感动…');
    const punct = issues.filter((i) => i.kind === 'punct');
    expect(punct.length).toBe(1);
    expect(punct[0].fix).toBe('……');
  });

  it('三个句号 。。。 报 punct 并提供 fix ……', () => {
    const issues = runProofread('他很感动。。。');
    const punct = issues.filter((i) => i.kind === 'punct');
    expect(punct.length).toBe(1);
    expect(punct[0].fix).toBe('……');
  });

  it('成对省略号 …… 不报；超过三个连续 … 报规范修复', () => {
    expect(runProofread('他很感动……')).toEqual([]);
    const issues = runProofread('他很感动………');
    const punct = issues.filter((i) => i.kind === 'punct');
    expect(punct.length).toBe(1);
    expect(punct[0].fix).toBe('……');
  });

  it('单个破折号 — 报 punct 并提供 fix ——；数字区间 3—5 豁免不报', () => {
    const dash = runProofread('这是一束光—照进来。').filter((i) => i.kind === 'punct');
    expect(dash.length).toBe(1);
    expect(dash[0].fix).toBe('——');
    expect(runProofread('第3—5集。')).toEqual([]);
  });

  it('成对破折号 —— 不报；连续三个以上 — 报规范修复', () => {
    expect(runProofread('他愣住了——门开了。')).toEqual([]);
    const issues = runProofread('他愣住了———门开了。');
    const punct = issues.filter((i) => i.kind === 'punct');
    expect(punct.length).toBe(1);
    expect(punct[0].fix).toBe('——');
  });
});

describe('runProofread —— typo 与 repeat 同区间去重', () => {
  it('「的的」重叠加词碎片只报一次 typo（带 fix），不双报 repeat', () => {
    const issues = runProofread('他的的包很重。');
    const samePos = issues.filter((i) => i.start === 1 && i.end === 3);
    expect(samePos.length).toBe(1);
    expect(samePos[0].kind).toBe('typo');
    expect(samePos[0].fix).toBe('的');
  });
});

describe('runProofread —— 错别字词表扩充（第二批 76 条）', () => {
  it('新增成语级错词逐一命中并给出确定 fix', () => {
    const cases: Array<[string, string]> = [
      ['他礼上往来十分频繁。', '礼尚往来'],
      ['她做事雷励风行。', '雷厉风行'],
      ['消息很快传开，声名雀起。', '声名鹊起'],
      ['他自名得意地笑了。', '自鸣得意'],
      ['这让全场观众目瞪口呆。', '目瞪口呆'], // 对照组：正词不误报由下面各条覆盖
    ];
    for (const [text, expectFix] of cases) {
      if (expectFix === '目瞪口呆') {
        expect(runProofread(text)).toEqual([]);
        continue;
      }
      const typo = runProofread(text).filter((i) => i.kind === 'typo' && i.fix === expectFix);
      expect(typo.length).toBeGreaterThan(0);
    }
  });

  it('新增单字级错词（震撼/装帧/资讯）命中并给 fix；正确写法不误报', () => {
    const wrongCases: Array<[string, string]> = [
      ['这消息让人十分震憾。', '震撼'],
      ['这份文档的装桢很讲究。', '装帧'],
      ['他提供了一条有用的咨讯。', '资讯'],
    ];
    for (const [text, expectFix] of wrongCases) {
      const typo = runProofread(text).filter((i) => i.kind === 'typo' && i.fix === expectFix);
      expect(typo.length).toBeGreaterThan(0);
    }
    expect(runProofread('这消息让人十分震撼。')).toEqual([]);
    expect(runProofread('这份文档的装帧很讲究。')).toEqual([]);
  });

  it('送分条目不误报：常规成语短语不产生 typo 结果', () => {
    // 「觉得」「人们」等高频正常词不在词表，检测应为空（或仅无 typo）
    const issues = runProofread('他觉得这次必须认真对待，大家都看着他。').filter((i) => i.kind === 'typo');
    expect(issues).toEqual([]);
  });
});

describe('buildTextIndex / textRangeToPos —— getText 规则一致性', () => {
  it('多段落 doc 展平后与 getText() 偏移一致', () => {
    const doc = docFromParas('第一段abc', '第二段');
    const idx = buildTextIndex(doc);
    expect(idx.text).toBe('第一段abc\n\n第二段');
    // runProofread 在 idx.text 上得到 start/end → textRangeToPos → doc.textBetween 必须还原原文
    const start = idx.text.indexOf('第二');
    const range = textRangeToPos(idx, start, start + 2);
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('第二');
    // 闭环：整段定位的 range 应覆盖 doc 内全部文本（textBetween 不含 getText 虚构的 \n\n，故期望值为拼接文本）
    const whole = textRangeToPos(idx, 0, idx.text.length);
    expect(whole).not.toBeNull();
    expect(doc.textBetween(whole!.from, whole!.to)).toBe('第一段abc第二段');
  });

  it('跨段定位包含 \\n\\n 分隔符位置', () => {
    const doc = docFromParas('abcd', 'efgh');
    const idx = buildTextIndex(doc);
    expect(idx.text).toBe('abcd\n\nefgh');
    const start = idx.text.indexOf('efg');
    const range = textRangeToPos(idx, start, start + 3);
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('efg');
  });

  it('区间越界或空区间返回 null', () => {
    const doc = docFromParas('hello');
    const idx = buildTextIndex(doc);
    expect(idx.text).toBe('hello');
    expect(textRangeToPos(idx, -5, 100)).toBeNull();
    expect(textRangeToPos(idx, 2, 2)).toBeNull();
    expect(textRangeToPos(idx, 3, 1)).toBeNull();
  });
});

describe('runProofread —— 冗余表达检测（redundant，批次④ T2）', () => {
  it('语义冗余短语命中 kind=redundant 并给出精简 fix', () => {
    const cases: Array<[string, string]> = [
      ['大军凯旋而归，百姓夹道欢迎。', '凯旋'],
      ['我亲眼目睹了整个过程。', '目睹'],
      ['他大声呐喊，为队友鼓劲。', '呐喊'],
      ['他的旧疾再次复发。', '复发'],
      ['双方共同协商后达成一致。', '协商'],
      ['这一顽疾终于被彻底根治。', '根治'],
    ];
    for (const [text, expectFix] of cases) {
      const rd = runProofread(text).filter((i) => i.kind === 'redundant' && i.fix === expectFix);
      expect(rd.length, text).toBeGreaterThan(0);
    }
  });

  it('同义冗余（胜利凯旋）同样命中', () => {
    const rd = runProofread('我们胜利凯旋归来。').filter((i) => i.kind === 'redundant');
    // 「胜利凯旋」命中一条（fix=凯旋）；其子串「凯旋而归」因没有连写不重复报
    expect(rd.some((i) => i.fix === '凯旋')).toBe(true);
  });

  it('精简词单独出现不误报；正常文本 zero redundant', () => {
    expect(runProofread('他凯旋了。')).toEqual([]);
    expect(runProofread('我目睹了全过程。')).toEqual([]);
    expect(runProofread('双方协商后达成一致。')).toEqual([]);
    expect(runProofread('病根已经根治。')).toEqual([]);
    const all = runProofread('他凯旋了。我们协商后解决了问题。');
    expect(all.filter((i) => i.kind === 'redundant')).toEqual([]);
  });
});

describe('runProofread —— 标点扩展（批次④ T2）', () => {
  it('未闭合左括号（（【《）报 punct（无 fix）', () => {
    const issues = runProofread('他（昨天还没说完。').filter((i) => i.kind === 'punct');
    expect(issues.length).toBe(1);
    expect(issues[0].suggestion).toContain('未闭合');
    expect(issues[0].fix).toBeUndefined();
  });

  it('多余右括号报 punct（无 fix）', () => {
    const issues = runProofread('他说完了。）').filter((i) => i.kind === 'punct');
    expect(issues.length).toBe(1);
    expect(issues[0].suggestion).toContain('多余的右括号');
    expect(issues[0].fix).toBeUndefined();
  });

  it('成对括号（、【】、《》）不报 punct', () => {
    expect(runProofread('他（昨天）说完了【重点】并读了《红楼梦》。')).toEqual([]);
  });

  it('ASCII 三点省略号（中文语境）报 punct 并提供 fix ……', () => {
    const issues = runProofread('他说...然后走了。').filter((i) => i.kind === 'punct');
    expect(issues.length).toBe(1);
    expect(issues[0].fix).toBe('……');
  });

  it('英文语境中的点序列（代码/版本号/URL）不误报', () => {
    expect(runProofread('使用 npm install ... 安装依赖')).toEqual([]);
    expect(runProofread('版本 v1.2.3 已发布')).toEqual([]);
  });

  it('中文语境中的半角标点（，。；：！？）报 punct 并给全角 fix', () => {
    const text = '他说,今天去吗?很好!等等';
    const puncts = runProofread(text).filter((i) => i.kind === 'punct');
    expect(puncts.length).toBe(3);
    expect(puncts.map((p) => p.fix)).toEqual(['，', '？', '！']);
  });

  it('半角标点两侧非中文语境（数字/英文/空格等）不误报', () => {
    expect(runProofread('3.14 与 1,000 无关')).toEqual([]);
    expect(runProofread('He said: ok, fine!')).toEqual([]);
    expect(runProofread('版本 v2.0 发布了')).toEqual([]);
  });
});

describe('docPosToTextOffset —— 光标 doc pos 逆映射到文本偏移（lowerBound）', () => {
  it('doc 起点返回 0', () => {
    const doc = docFromParas('hi');
    const idx = buildTextIndex(doc);
    expect(docPosToTextOffset(idx, 0)).toBe(0);
  });

  it('跨段定位闭环：textRangeToPos(docPosToTextOffset(from)) 还原光标', () => {
    const doc = docFromParas('第一段', '第二段');
    const idx = buildTextIndex(doc);
    // '第一段'（3 字符 pos 1-3）→ 分隔符（pos 5,5）→ 第二段 '第'=6, '二'=7, '段'=8
    // 光标停在 '二' 前（docPos=7）：左侧展平字符 = '第一段' + 2 分隔符 + '第' = 6
    const dPos = doc.content.child(0).nodeSize + 2; // 第二段 '二' 的 doc pos
    const off = docPosToTextOffset(idx, dPos);
    expect(off).toBe(6);
    const range = textRangeToPos(idx, off, off + 2);
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('二段');
  });
});
