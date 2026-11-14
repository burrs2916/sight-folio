// 剧本结构与对白校验的锁（⑯-1）
//
// 这些 fixture 是照真实台本形态写的：中文一行式「角色名：台词」+ 括号舞台指示 +
// 「第 X 幕 / 第 X 场」；英文全大写说话人 + (Enter …) + ACT / SCENE。
// 关键守的是三件事：**别把台词行认成标题**、**别把叙述段硬猜成对白**、
// **估算类读数（长台词）不与硬事实同色**。
import { describe, it, expect } from 'vitest';
import {
  analyzeScriptStructure,
  scriptStructureTone,
  scriptStructureBadge,
  scriptStructureCorpusLines,
  MONOLOGUE_UNITS_ZH,
} from '../scriptStructure';
import { t, setLang } from '../../i18n';

const P = (s: string) => `<p>${s}</p>`;
const ZH_SCRIPT = [
  P('第一幕'),
  P('鲁贵公馆的客厅'),
  P('（黄昏。雷雨未完。四凤立在窗前。）'),
  P('第 1 场'),
  P('四凤：老爷还没回来。'),
  P('鲁贵：他今天在矿上。'),
  P('（外头雷声。）'),
  P('第 2 场'),
  P('蘩漪：你叫我做什么？'),
].join('');

describe('analyzeScriptStructure · 中文台本', () => {
  it('幕 / 场 / 对白 / 舞台指示 各归各位', () => {
    const s = analyzeScriptStructure(ZH_SCRIPT);
    expect(s.acts).toBe(1);
    expect(s.scenes).toBe(2);
    expect(s.dialogueLines).toBe(3);
    expect(s.directionLines).toBe(2);
    expect(s.speakers.map((x) => x.name).sort()).toEqual(['蘩漪', '四凤', '鲁贵'].sort());
    expect(s.cjk).toBe(true);
  });

  it('分场账按场切：第 2 场只有一句台词', () => {
    const s = analyzeScriptStructure(ZH_SCRIPT);
    expect(s.sceneDialogueLines).toEqual([2, 1]);
    expect(s.silentScenes).toEqual([]);
  });

  it('台词语里的「第 3 场」不该被当成场标题（标题必须整行只有它）', () => {
    const s = analyzeScriptStructure(P('第 1 场') + P('四凤：他们约我在第 3 场见面。'));
    expect(s.scenes).toBe(1);
    expect(s.dialogueLines).toBe(1);
    expect(s.proseBlocks).toBe(0);
  });

  it('括号整块 = 舞台指示，不算对白', () => {
    const s = analyzeScriptStructure(P('（雷声大作。）') + P('四凤：啊！'));
    expect(s.directionLines).toBe(1);
    expect(s.dialogueLines).toBe(1);
    expect(s.speakers.map((x) => x.name)).toEqual(['四凤']);
  });

  // 轮 4 · W-0c（2026-11-10）：以下两条在改 eslint error 之前**一条都没有**。
  // 没有它们，「删掉字符类里的 `[`」这种破坏是无声的 —— 这正是本仓反复付钱的
  // 「定义层钉了锁、判据本身没人测」形状，所以先补锁再收 lint。
  it('ASCII 方括号 [ … ] 整块同样算舞台指示（不许被摘成散文段）', () => {
    const s = analyzeScriptStructure(P('[雷声大作。]') + P('四凤：啊！'));
    expect(s.directionLines).toBe(1);
    expect(s.proseBlocks).toBe(0);
  });

  it('幕标后用全角空格接说明（「第三幕\\u3000风雪夜」）仍判为幕，不当叙述段', () => {
    // 全角空格是中文台本的真实输入形状，必须留在判据口径内；
    // 源码里写 \\u3000 转义而不是裸字符，是为了不踩 no-irregular-whitespace。
    const s = analyzeScriptStructure(P('第三幕\u3000风雪夜') + P('四凤：老爷还没回来。'));
    expect(s.acts).toBe(1);
    expect(s.narrativeBlocks).toBe(0);
    expect(s.dialogueLines).toBe(1);
  });

  // 轮 4 遗留的一半（状态文件 §轮 4「不新开刀」那条）：幕标那半已钉，场标这半补上。
  // SCENE_INLINE_ZH 与 ACT_INLINE_ZH 是两条正则，改了任何一条另一条不会红 —— 必须各测各的。
  it('场标后用全角空格接说明（「第三场\\\\u3000雨夜」）仍判为场，不当叙述段', () => {
    const s = analyzeScriptStructure(P('第三场\u3000雨夜') + P('四凤：老爷还没回来。'));
    expect(s.scenes).toBe(1);
    expect(s.narrativeBlocks).toBe(0);
    expect(s.dialogueLines).toBe(1);
  });

  it('空场要被抓出来', () => {
    const s = analyzeScriptStructure(P('第 1 场') + P('四凤：我在。') + P('第 2 场') + P('（沉默。）'));
    expect(s.silentScenes).toEqual([2]);
    expect(scriptStructureTone(s)).toBe('warn');
  });
});

describe('analyzeScriptStructure · 英文台本', () => {
  const EN = [
    '<p>ACT I</p>',
    '<p>SCENE 1. Elsinore. A platform.</p>',
    '<p>(Enter BERNARDO and FRANCISCO, armed.)</p>',
    '<p>BERNARDO: Who is there?</p>',
    '<p>FRANCISCO: Nay, answer me.</p>',
    '<p>SCENE 2. The court.</p>',
    '<p>HAMLET: To be, or not to be.</p>',
  ].join('');

  it('ACT / SCENE / 全大写说话人都认', () => {
    const s = analyzeScriptStructure(EN);
    expect(s.acts).toBe(1);
    expect(s.scenes).toBe(2);
    expect(s.dialogueLines).toBe(3);
    expect(s.speakers.map((x) => x.name).sort()).toEqual(['BERNARDO', 'FRANCISCO', 'HAMLET']);
    expect(s.cjk).toBe(false);
  });

  it('括号入场提示算舞台指示，不当成说话人', () => {
    const s = analyzeScriptStructure(EN);
    expect(s.directionLines).toBe(1);
    expect(s.speakers.some((x) => x.name.includes('('))).toBe(false);
  });
});

describe('布景行不是缺陷（⑯-1 第一版的假阳性，被这条拦住）', () => {
  it('短布景行「鲁贵公馆的客厅」只进未归类，不进叙述段 → 整本仍是 ok', () => {
    const s = analyzeScriptStructure(ZH_SCRIPT);
    expect(s.proseBlocks).toBe(1);
    expect(s.narrativeBlocks).toBe(0);
    expect(scriptStructureTone(s)).toBe('ok');
  });

  it('整段小说写法才算叙述段 → warn（与布景行分得开）', () => {
    const s = analyzeScriptStructure(
      P('第一幕') + P('第 1 场') + P('四凤：我在。') +
        P('黄昏时分，客厅里很暗，窗外的梧桐被风吹得乱响，她一直站在那里等着老爷回来。'),
    );
    expect(s.proseBlocks).toBe(1);
    expect(s.narrativeBlocks).toBe(1);
    expect(scriptStructureTone(s)).toBe('warn');
  });

  it('英文侧同口径：短地点行不算叙述段，长叙述算', () => {
    const short = analyzeScriptStructure('<p>ACT I</p><p>Elsinore. A platform.</p><p>BERNARDO: Who is there?</p>');
    expect(short.narrativeBlocks).toBe(0);
    const long = analyzeScriptStructure(
      '<p>ACT I</p><p>' +
        'It is a cold night at Elsinore and the wind comes off the sea and the guards stand waiting ' +
        'for the ghost while the court sleeps behind them.</p><p>BERNARDO: Who is there?</p>',
    );
    expect(long.narrativeBlocks).toBe(1);
  });
});

describe('色调与读数：硬事实与估算必须分家', () => {
  it('空正文 → empty（不谎报"没结构"）', () => {
    const s = analyzeScriptStructure('');
    expect(s.blocks.length).toBe(0);
    expect(scriptStructureTone(s)).toBe('empty');
  });

  it('没有幕场标题 → no-heading（硬事实，一眼可验）', () => {
    const s = analyzeScriptStructure(P('四凤：我在。') + P('鲁贵：我知道。'));
    expect(s.hasHeadings).toBe(false);
    expect(scriptStructureTone(s)).toBe('no-heading');
  });

  it('整本没有「角色：」形式 → prose-risk（台本被写成散文段落）', () => {
    const s = analyzeScriptStructure(P('第一幕') + P('黄昏时分，客厅里很暗，四凤站在窗前等着。'));
    expect(s.dialogueLines).toBe(0);
    expect(s.proseBlocks).toBeGreaterThan(0);
    expect(scriptStructureTone(s)).toBe('prose-risk');
  });

  it('长台词只进 monologues（advisory），不改色调成红', () => {
    const long = '我'.repeat(MONOLOGUE_UNITS_ZH + 10);
    const s = analyzeScriptStructure(P('第一幕') + P('第 1 场') + P(`蘩漪：${long}`));
    expect(s.monologues.length).toBe(1);
    expect(s.monologues[0].speaker).toBe('蘩漪');
    expect(scriptStructureTone(s)).toBe('ok');
  });

  it('角色表核人：说了话却没建档的名字要报出来', () => {
    const s = analyzeScriptStructure(P('第 1 场') + P('四凤：我在。') + P('路人甲：借过。'), ['四凤']);
    expect(s.unknownSpeakers).toEqual(['路人甲']);
    expect(scriptStructureTone(s)).toBe('warn');
  });
});

describe('纯文本兜底与读数出口', () => {
  it('不是 HTML 的手粘贴草稿照样解析（按空行分块）', () => {
    const plain = '第一幕\n\n第 1 场\n\n四凤：我在。\n\n鲁贵：我知道。';
    const s = analyzeScriptStructure(plain);
    expect(s.acts).toBe(1);
    expect(s.scenes).toBe(1);
    expect(s.dialogueLines).toBe(2);
  });

  it('徽标 key 在两个语言里都翻得出来，且不渲染裸 key', () => {
    const cases = [
      analyzeScriptStructure(''),
      analyzeScriptStructure(P('四凤：我在。')),
      analyzeScriptStructure(P('第一幕') + P('第 1 场') + P('四凤：我在。')),
      analyzeScriptStructure(P('第一幕') + P('客厅很暗。')),
    ];
    for (const lang of ['zh-CN', 'en-US'] as const) {
      setLang(lang);
      for (const c of cases) {
        const b = scriptStructureBadge(c);
        expect(t(b.key, b.params), `${lang}/${b.key}`).not.toBe(b.key);
        expect(t(b.key, b.params)).not.toBe('');
      }
    }
    setLang('zh-CN');
  });

  it('语料读数：数字来自实测，含幕/场/对白三个词，且不做评价性断言', () => {
    const s = analyzeScriptStructure(ZH_SCRIPT);
    const { zh, en } = scriptStructureCorpusLines(s);
    expect(zh[0]).toContain('幕 1');
    expect(zh[0]).toContain('场 2');
    expect(zh[0]).toContain('对白 3 行');
    expect(en[0]).toContain('acts 1');
    expect(en[0]).toContain('scenes 2');
    for (const line of [...zh, ...en]) {
      expect(line).not.toMatch(/建议|应该|最好|should|suggest/i);
    }
  });

  it('空正文不产出任何语料行（不许给模型一句废话）', () => {
    const { zh, en } = scriptStructureCorpusLines(analyzeScriptStructure(''));
    expect(zh).toEqual([]);
    expect(en).toEqual([]);
  });
});
