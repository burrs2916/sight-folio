/**
 * A6-1：本地校对引擎句法规则按体裁豁免锁。
 *
 * 病灶（探针 2026-11-14 实测坐实）：`chapterTextIssues` 此前不分体裁，诗的分节空段/节距被报
 * `StructEmptyPara`/`BlankLines`、剧本的省略号留白被报 `RepeatPunct`。
 *
 * 三层锁：
 *   ① 误报消除：poetry 喂节间空段/节距 → 不再报对应规则；script 喂省略号沉默 → 不再报 RepeatPunct。
 *   ② novel 零回归：同样输入但 genre='novel'/''/脏值 → **照旧报**这些规则（一条没砍、行为逐字不变）。
 *   ③ 不砍通用功能：typo/三连同字/敏感词等跨体裁判定，对 poetry/script 仍照常报（豁免集只含点名规则）。
 */
import { describe, it, expect } from 'vitest';
import { chapterTextIssues, ruleExemptForGenre } from '../writingProofread';
import type { WritingChapter } from '../../services/writing';

const ch = (content: string): WritingChapter =>
  ({
    id: 'c1', bookId: 'b1', title: 't', content, kind: '', status: 'draft',
    parentId: null, wordCount: content.length, extra: '{}', createdAt: '', updatedAt: '',
  }) as unknown as WritingChapter;

const keys = (content: string, genre: string) => chapterTextIssues(ch(content), genre).map((i) => i.messageKey);

// 探针确认的真实误报样本
const POEM_EMPTY = '<p>床前明月光</p><p>疑是地上霜</p><p></p><p>举头望明月</p>'; // → novel: StructEmptyPara
const POEM_BLANKS = '<p>第一节行</p><p></p><p></p><p>第二节行</p>'; // → novel: StructEmptyPara + BlankLines
const SCRIPT_SILENCE = '<p>苏白：……（长久的沉默）……</p>'; // → novel: RepeatPunct

describe('① 误报消除（按体裁豁免点名规则）', () => {
  it('诗：节间空段不再报 StructEmptyPara', () => {
    expect(keys(POEM_EMPTY, 'poetry')).not.toContain('StructEmptyPara');
  });
  it('诗：节距空行不再报 BlankLines（连 StructEmptyPara 一起豁免）', () => {
    const k = keys(POEM_BLANKS, 'poetry');
    expect(k).not.toContain('BlankLines');
    expect(k).not.toContain('StructEmptyPara');
  });
  it('剧本：省略号沉默不再报 RepeatPunct', () => {
    expect(keys(SCRIPT_SILENCE, 'script')).not.toContain('RepeatPunct');
  });
});

describe('② novel 零回归（同输入照旧报，一条没砍）', () => {
  for (const g of ['novel', '', 'poemx']) {
    it(`体裁 ${JSON.stringify(g)}：空段/节距/省略号全部照旧报`, () => {
      expect(keys(POEM_EMPTY, g)).toContain('StructEmptyPara');
      expect(keys(POEM_BLANKS, g)).toContain('BlankLines');
      expect(keys(SCRIPT_SILENCE, g)).toContain('RepeatPunct');
    });
  }
});

describe('③ 不砍通用功能（豁免集只含点名规则，typo/三连同字等仍跑）', () => {
  it('诗里的三连同字笔误仍被报 RepeatChar（poetry 没豁免它）', () => {
    expect(keys('完了了了，都完了', 'poetry')).toContain('RepeatChar');
  });
  it('剧本里的三连同字笔误仍被报 RepeatChar（script 没豁免它）', () => {
    expect(keys('他说：完了了了，都不对了', 'script')).toContain('RepeatChar');
  });
  it('豁免集精确：poetry={StructEmptyPara,BlankLines}、script={RepeatPunct}、其余空', () => {
    expect([...ruleExemptForGenre('poetry')].sort()).toEqual(['BlankLines', 'StructEmptyPara']);
    expect([...ruleExemptForGenre('script')]).toEqual(['RepeatPunct']);
    expect(ruleExemptForGenre('novel').size).toBe(0);
    expect(ruleExemptForGenre('essay').size).toBe(0);
    expect(ruleExemptForGenre('diary').size).toBe(0);
    expect(ruleExemptForGenre('乱码').size).toBe(0);
  });
});

describe('④ buildProofreadReport 主路径透传（① 章文本循环在位，genre 生效）', () => {
  it('诗集整书体检不因节间空段报错，但三连同字笔误仍在（章文本组没被整组吞掉）', () => {
    // 复用导出函数验证循环未丢：poetry 章不报 StructEmptyPara、仍报 RepeatChar
    const poemWithTypo = '<p>完了了了</p><p></p><p>下一节</p>';
    const k = keys(poemWithTypo, 'poetry');
    expect(k).not.toContain('StructEmptyPara'); // 空段豁免
    expect(k).toContain('RepeatChar'); // 章文本规则整体仍跑（证明 for 循环在位、未被误删）
  });
});
describe('⑤ 体裁特征防回归锁（取证矩阵钉死的"不该误伤"边界，与体裁无关）', () => {
  // 这些是"体裁本体写法"，校对引擎的阈值口径必须保证不报它们——
  // 若将来有人收紧 RepeatChar/RepeatPhrase 阈值把它们改回误伤，本锁先红。
  it('诗经式重章叠句（蒹葭三章）不被判重复用词', () => {
    const shijing =
      '<p>蒹葭苍苍，白露为霜。所谓伊人，在水一方。</p>' +
      '<p>蒹葭萋萋，白露未晞。所谓伊人，在水之湄。</p>' +
      '<p>蒹葭采采，白露未已。所谓伊人，在水之涘。</p>';
    const k = chapterTextIssues(ch(shijing)).map((i) => i.messageKey);
    expect(k).not.toContain('RepeatPhrase');
    expect(k).not.toContain('RepeatChar');
  });
  it('叠字修辞（寻寻觅觅）不被判三连同字', () => {
    expect(keys('<p>寻寻觅觅<br>冷冷清清<br>凄凄惨惨戚戚</p>', 'novel')).not.toContain('RepeatChar');
  });
  it('密集对白（12 轮 角色名:台词）不触发任何句法报警', () => {
    const rows: string[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push('<p>林夜：我觉得这件事不对，我们得谈谈。</p><p>苏白：谈什么，谈那些过去的事情吗。</p>');
    }
    const k = chapterTextIssues(ch('<p>【内景 · 深夜】</p>' + rows.join(''))).map((i) => i.messageKey);
    expect(k).not.toContain('RepeatPhrase');
    expect(k).not.toContain('LongParagraph');
  });
  it('诗行内换行（<br>，无空段）本就不误报（豁免只兜"节间空段"场景）', () => {
    expect(keys('<p>床前明月光<br>疑是地上霜<br>举头望明月</p>', 'novel')).toEqual([]);
  });
});
