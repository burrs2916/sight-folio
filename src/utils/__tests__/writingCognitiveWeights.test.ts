// 认知权重六维的口径测试（批次③ 增-7）。
//
// 这批要锁的东西很具体：**0 是一个取值，不是"没填"**。
// 原先 UI / 写入 / AI 三处都把 0 当成空处理，作者把某维拖到中间，库里什么都不剩，
// AI 也当这个人物在这一维上从未被设定过。测试直接对着这三层的公共函数打。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COGNITIVE_DIMENSIONS,
  clampCognitiveWeight,
  formatCognitiveDimension,
  formatCognitiveWeightLine,
  setCognitiveDimensions,
  withCognitiveWeight,
} from '../writingCognitiveWeights';
import type { WritingCognitiveWeights } from '../../services/tauri';

const labels = {
  neg: (k: string) => ({ 'writing.cwRational': '理性', 'writing.cwCollective': '集体' })[k] ?? 'N',
  pos: (k: string) => ({ 'writing.cwEmotional': '感性', 'writing.cwIndividual': '个人' })[k] ?? 'P',
  // 模板串：中文「理性/感性均衡」，英文要 "rational/emotional balanced"，语序不同
  balancedPattern: '{neg}/{pos}均衡',
  title: '——决策倾向：',
};

describe('withCognitiveWeight —— 写入语义', () => {
  it('0 是有效取值，必须落库', () => {
    const cw = withCognitiveWeight(undefined, 'rationalVsEmotional', 0);
    expect(cw).toEqual({ rationalVsEmotional: 0 });
    // 关键：不能是 undefined / 不能被 delete，否则"中立"就又被吞回去了
    expect(cw?.rationalVsEmotional).toBe(0);
  });

  it('null 才是"未设置"：删掉该维', () => {
    const before: WritingCognitiveWeights = { rationalVsEmotional: 0, trustVsDoubt: -4 };
    const after = withCognitiveWeight(before, 'rationalVsEmotional', null);
    expect(after).toEqual({ trustVsDoubt: -4 });
    expect('rationalVsEmotional' in (after ?? {})).toBe(false);
  });

  it('删到空时返回 undefined，让上层把整组键清掉', () => {
    expect(withCognitiveWeight({ trustVsDoubt: 3 }, 'trustVsDoubt', null)).toBeUndefined();
  });

  it('不改传入对象（extra 是共享引用，就地改会串状态）', () => {
    const before: WritingCognitiveWeights = { trustVsDoubt: 3 };
    withCognitiveWeight(before, 'rationalVsEmotional', 0);
    expect(before).toEqual({ trustVsDoubt: 3 });
  });

  it('越界夹到 ±10，非有限值按中立处理', () => {
    expect(clampCognitiveWeight(99)).toBe(10);
    expect(clampCognitiveWeight(-99)).toBe(-10);
    expect(clampCognitiveWeight(Number.NaN)).toBe(0);
    expect(withCognitiveWeight(undefined, 'riskVsCaution', 99)?.riskVsCaution).toBe(10);
  });
});

describe('setCognitiveDimensions —— 已设置的判定', () => {
  it('0 算"已设置"，未设置的维度不出现（而不是被当作 0）', () => {
    const list = setCognitiveDimensions({ rationalVsEmotional: 0, trustVsDoubt: -3 });
    expect(list).toEqual([
      { key: 'trustVsDoubt', value: -3 },
      { key: 'rationalVsEmotional', value: 0 },
    ]);
    // 输出顺序跟 COGNITIVE_DIMENSIONS 定义走，而不是写入顺序
    const ordered = setCognitiveDimensions({ riskVsCaution: 1, collectiveVsIndividual: -1 });
    expect(ordered.map((x) => x.key)).toEqual(['collectiveVsIndividual', 'riskVsCaution']);
    expect(setCognitiveDimensions(undefined)).toEqual([]);
  });
});

describe('formatCognitiveDimension / Line —— 展示与喂 AI 的口径', () => {
  it('0 用该维两端的词拼成「理性/感性均衡」，不引入新术语', () => {
    const B = '{neg}/{pos}均衡';
    expect(formatCognitiveDimension(0, '理性', '感性', B)).toBe('理性/感性均衡');
    // 英文模板带空格，证明语序不是硬拼出来的
    expect(formatCognitiveDimension(0, 'Rational', 'Emotional', '{neg}/{pos} balanced')).toBe(
      'Rational/Emotional balanced',
    );
  });

  it('正负各取偏向端并带幅度；未设置输出空串', () => {
    const B = '{neg}/{pos}均衡';
    expect(formatCognitiveDimension(3, '理性', '感性', B)).toBe('感性3');
    expect(formatCognitiveDimension(-2, '理性', '感性', B)).toBe('理性2');
    expect(formatCognitiveDimension(undefined, '理性', '感性', B)).toBe('');
  });

  it('中立维度要真的进到那一行里', () => {
    const line = formatCognitiveWeightLine('沈砚', { rationalVsEmotional: 0 }, labels);
    expect(line).toContain('沈砚');
    // 标题也必须是注入的：这段文案原先硬编码中文在 AI 上下文构造器里
    expect(line).toContain('——决策倾向：');
    expect(line).toContain('理性/感性均衡');
  });

  it('一个维度都没设时返回 null：AI 上下文里不印空标题', () => {
    expect(formatCognitiveWeightLine('沈砚', undefined, labels)).toBeNull();
    expect(formatCognitiveWeightLine('沈砚', {}, labels)).toBeNull();
  });
});

describe('COGNITIVE_DIMENSIONS —— 单一来源', () => {
  it('六维齐备、键不重复、每个 i18n 键都真实存在', () => {
    expect(COGNITIVE_DIMENSIONS).toHaveLength(6);
    const keys = COGNITIVE_DIMENSIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(6);
    const dict = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf8')) as Record<string, Record<string, string>>;
    for (const d of COGNITIVE_DIMENSIONS) {
      for (const k of [d.negKey, d.posKey]) {
        const [ns, name] = k.split('.');
        expect(dict[ns]?.[name], `缺 i18n 键 ${k}`).toBeTruthy();
      }
    }
    expect(dict.writing?.cwBalancedPattern, '缺 writing.cwBalancedPattern').toBeTruthy();
    expect(dict.writing?.cwLineTitle, '缺 writing.cwLineTitle').toBeTruthy();
  });

  /**
   * 旧实现把六个维度词硬编码在 AI 上下文构造器里（`dim(w.trustVsDoubt, '信任', '怀疑')`），
   * 与卡面板的 i18n 取词各写一份。抽成单一口径后，用这条断言挡住"顺手又写回中文常量"。
   * 注释里出现这些字是解释语义，允许——所以先把注释剥掉再查。
   */
  it('utils 代码里不得硬编码维度中文词', () => {
    const code = readFileSync('src/utils/writingCognitiveWeights.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const w of ['集体', '个人', '理想', '现实', '信任', '怀疑', '宿命', '自由', '理性', '感性', '冒险', '谨慎']) {
      expect(code.includes(w), `utils 代码里硬编码了「${w}」，应改为 i18n 键`).toBe(false);
    }
  });
});
