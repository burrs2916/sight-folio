// sight-folio: 语料命中句手法拆解（写作方案 C1）回归锁
//
// 锁定：① 手法标签按词库/节奏/情感规则命中；② 情感直述（情绪词无细节）与以行写情（情绪词+细节）判定；
// ③ 节奏四档判定边界；④ 模板与仿写示范按组合选取且稳定非空。
import { describe, it, expect } from 'vitest';
import { analyzeCraft } from '../craftTags';

describe('analyzeCraft（语法手法拆解 · C1）', () => {
  it('感官+动作细节句：命中 sensory/action，情感逻辑为 none，模板为动作细节骨架', () => {
    const r = analyzeCraft('他停住脚步，望向窗外起伏的暮色。');
    expect(r.tags).toContain('sensory');
    expect(r.tags).toContain('action');
    expect(r.emotionLogic).toBe('none');
    expect(r.rhythm).toBe('mixed');
    expect(r.template).toContain('动作');
    expect(r.imitation.length).toBeGreaterThan(0);
    // 用词亮点按类别收集
    const action = r.diction.find((d) => d.kind === 'action');
    expect(action?.words.length).toBeGreaterThan(0);
    const sensory = r.diction.find((d) => d.kind === 'sensory');
    expect(sensory?.words).toContain('望');
  });

  it('情绪直述短句（无细节支撑）：判 told，模板给「把情绪名词换成行为」，且带 emotion-told 标签', () => {
    const r = analyzeCraft('她很伤心。');
    expect(r.tags).toContain('emotion-told');
    expect(r.emotionLogic).toBe('told');
    expect(r.template).toContain('行为');
    expect(r.diction.some((d) => d.kind === 'emotion')).toBe(true);
  });

  it('情绪词 + 细节：判 shown（以行写情），含 emotion-shown 标签', () => {
    const r = analyzeCraft('他攥紧茶杯，指节发白，心里却难过得说不出话。');
    expect(r.emotionLogic).toBe('shown');
    expect(r.tags).toContain('emotion-shown');
    expect(r.tags).not.toContain('emotion-told');
    expect(r.tags).toContain('action');
  });

  it('比喻句：命中 metaphor，模板为「本体像喻体」骨架', () => {
    const r = analyzeCraft('夜色像潮水一样漫过窗台。');
    expect(r.tags).toContain('metaphor');
    expect(r.template).toContain('本体');
    expect(r.template).toContain('喻体');
  });

  it('节奏边界：短句(<=10字)判 short-beat；超长句(>=34字)判 long-spread；不带节奏标签时中间句 steady', () => {
    expect(analyzeCraft('雨来了。').rhythm).toBe('short-beat');
    const long = '他沿着河边走了很久，看着水面泛起的每一圈涟漪，想着白天那句话的分量，直到天黑透了才往回走。';
    expect(analyzeCraft(long).rhythm).toBe('long-spread');
    expect(analyzeCraft('他把湿漉漉的伞靠在墙边。').rhythm).toBe('steady');
    expect(analyzeCraft('雨来了。').tags).toContain('short-beat');
  });

  it('对话句（含引号）：命中 dialogue，模板为「对白+动作」骨架', () => {
    const r = analyzeCraft('“真的吗？”她低下头，睫毛轻轻一颤。');
    expect(r.tags).toContain('dialogue');
    expect(r.template).toContain('对白');
  });

  it('空标签兜底：无明显手法词句 tags 可为空，但模板与仿写始终非空', () => {
    // 中长名词罗列、无感官/动作/情绪/引号/比喻 → 无标签（UI 不展示手法入口）
    const r = analyzeCraft('第 3 号卷宗登记在册，等待归档。');
    expect(r.tags).toHaveLength(0);
    expect(r.template.length).toBeGreaterThan(0);
    expect(r.imitation.length).toBeGreaterThan(0);
  });
});
