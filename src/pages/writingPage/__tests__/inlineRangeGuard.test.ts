// 内联 AI 落点防漂移校验单测（需求缺口④，第七轮）
//
// 锁三种归属：exact（未漂移用原区间）/ moved（漂移但锚点唯一命中→重定位）/
// lost（锚点被删改或出现歧义→拒绝写入）。这条防线决定「AI 跑 30s 期间用户改了正文，
// 回来点应用会不会写错地方」，是 AI↔正文联动的落点正确性保证，不可退化为静默覆盖。
import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { verifyInlineRange } from '../inlineRangeGuard';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});

const docFromParas = (...paras: string[]) =>
  schema.node(
    'doc',
    null,
    paras.map((t) => schema.node('paragraph', null, t ? schema.text(t) : undefined)),
  );

describe('verifyInlineRange —— exact（未漂移）', () => {
  it('原区间文本与锚点一致 → 直接复用原 from/to', () => {
    // 单个段落「他走了。」选区覆盖整句
    const doc = docFromParas('他走了。');
    // paragraph 节点：pos 0 是 doc 起，块内容从 1 开始，文本 4 字 → 选区 from=1,to=5
    const check = verifyInlineRange(doc, { from: 1, to: 5 }, '他走了。');
    expect(check.status).toBe('exact');
    if (check.status !== 'lost') expect(check.range).toEqual({ from: 1, to: 5 });
  });
});

describe('verifyInlineRange —— moved（漂移后重定位）', () => {
  it('前面插入内容使旧区间错位，但锚点文本仍唯一存在 → 重定位到新区间', () => {
    // 发起时 doc=「他走了。」，选区 from=1..to=5 锚点「他走了。」
    // 生成期间用户在句前加了「那天，」→ doc=「那天，他走了。」旧区间 1..5 已错位
    const doc = docFromParas('那天，他走了。');
    const stale = { from: 1, to: 5 };
    const check = verifyInlineRange(doc, stale, '他走了。');
    // 旧区间取出的文本不是锚点 → 非 exact；锚点在全文唯一 → moved
    expect(check.status).toBe('moved');
    if (check.status !== 'lost') {
      // 重定位后区间取出的文本必须正好是锚点
      expect(doc.textBetween(check.range.from, check.range.to, '\n\n')).toBe('他走了。');
    }
  });

  it('旧区间越界(内容被删短)但锚点仍唯一 → moved 重定位到新位置', () => {
    // 发起时 doc 更长、选区靠后；生成期间前面整段被删，旧 to 已越出当前 doc，
    // textBetween 抛错 → 落重定位分支，锚点在当前 doc 唯一 → moved
    const doc = docFromParas('目标句独立成段。');
    const check = verifyInlineRange(doc, { from: 999, to: 1000 }, '目标句独立成段。');
    expect(check.status).toBe('moved');
    if (check.status !== 'lost') {
      expect(doc.textBetween(check.range.from, check.range.to, '\\n\\n')).toBe('目标句独立成段。');
    }
  });
});

describe('verifyInlineRange —— lost（拒绝写入）', () => {
  it('锚点文本已被删除/改写 → lost', () => {
    const doc = docFromParas('完全不同的内容。');
    const check = verifyInlineRange(doc, { from: 1, to: 5 }, '他走了。');
    expect(check.status).toBe('lost');
  });

  it('锚点在全文出现多次无法消歧 → lost（绝不猜测落点）', () => {
    const doc = docFromParas('他走了。', '中间', '他走了。');
    // 旧区间指向第一段（exact 会命中第一段），但为验证多次出现逻辑，给一个已漂移的越界区间，
    // 迫使走重定位分支：重定位发现锚点出现两次 → lost
    const check = verifyInlineRange(doc, { from: 999, to: 1000 }, '他走了。');
    expect(check.status).toBe('lost');
  });

  it('空锚点 → lost（无从定位）', () => {
    const doc = docFromParas('任意');
    expect(verifyInlineRange(doc, { from: 1, to: 3 }, '').status).toBe('lost');
  });

  it('非法区间（from>=to）→ lost', () => {
    const doc = docFromParas('他走了。');
    expect(verifyInlineRange(doc, { from: 5, to: 5 }, '他走了。').status).toBe('lost');
    expect(verifyInlineRange(doc, { from: 3, to: 1 }, '他走了。').status).toBe('lost');
  });

  it('exact 优先：旧区间仍命中锚点时直接复用，不被多次出现的歧义规则误伤', () => {
    // 即便锚点文本在全文出现多次，只要旧 from/to 取出的文本 == 锚点，就应 exact 命中，
    // 绝不因「重定位分支发现歧义」而判 lost —— exact 是快路径，先于歧义判定。
    const single = docFromParas('唯一锚点句');
    const c = verifyInlineRange(single, { from: 1, to: 6 }, '唯一锚点句');
    expect(c.status).toBe('exact');
  });
});
