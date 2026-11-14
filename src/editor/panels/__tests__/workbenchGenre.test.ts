// 工作台 AI 面的体裁适配（⑬ 刀A 命令集 + 刀B ask 人设）。
// 守的是两件事：① 小说口径一个字都不许漂；② 诗集 / 散文集不许再领到小说的命令与"小说家"人设。
import { describe, expect, it } from 'vitest';
import { getSlashCommands, parseSlashCommand } from '../workbenchSlashCommands';
import { modeInstruction } from '../workbenchContext';
import { workbenchCommandSet } from '../../../utils/writingSchema';

const EMPTY_CTX = { activeFile: null, selection: null, diagnostics: [] } as const;
const cmds = (g?: string) => getSlashCommands(true, g).map((c) => c.cmd);

describe('斜杠命令按体裁换集合（刀A）', () => {
  it('判定表：小说 / 未设置 / 脏体裁值 = novel 集，散文 / 诗歌 / 剧本各自一支', () => {
    expect(workbenchCommandSet('novel')).toBe('novel');
    expect(workbenchCommandSet('')).toBe('novel');
    expect(workbenchCommandSet(undefined)).toBe('novel');
    expect(workbenchCommandSet('scribble')).toBe('novel'); // 脏值只许回落，不许猜
    expect(workbenchCommandSet('essay')).toBe('essay');
    expect(workbenchCommandSet('poetry')).toBe('poetry');
    // ⑮-2：剧本 11-09 开闸，之前它借小说那 6 条（对剧本只会喊"伏笔回收"）
    expect(workbenchCommandSet('script')).toBe('script');
    // 日记 2026-11-10 开闸：它有自己一支，不借小说那六条（对日记喊"伏笔回收"是无效问题）
    expect(workbenchCommandSet('diary')).toBe('diary');
  });

  it('小说 6 条命令逐字不变，且不随"没传 genre / 传空 / 脏体裁值"漂动', () => {
    const NOVEL = ['体检', '连续性', '人物', '伏笔', '时间线', '脑暴'];
    expect(cmds()).toEqual(NOVEL);
    for (const g of [undefined, '', 'novel', 'scribble']) expect(cmds(g), String(g)).toEqual(NOVEL);
  });

  it('诗集命令里不许再出现小说专属那四条（⑦ 摘了页签，命令面必须同步封口）', () => {
    const p = cmds('poetry');
    expect(p).toEqual(expect.arrayContaining(['体检', '形式', '意象', '分行']));
    for (const forbidden of ['伏笔', '连续性', '人物', '时间线'])
      expect(p, `诗集不该有「${forbidden}」`).not.toContain(forbidden);
  });

  it('散文集：换成立意 / 结构 / 素材，同样不含伏笔', () => {
    const e = cmds('essay');
    expect(e).toEqual(expect.arrayContaining(['体检', '立意', '结构', '素材']));
    expect(e).not.toContain('伏笔');
    expect(e).not.toContain('连续性');
  });

  it('剧本命令写死底线：不动幕与场的编号、不把对白排成散文段落、只诊断', () => {
    const all = ['体检', '幕场', '对白', '指示', '冲突', '脑暴']
      .map((c) => getSlashCommands(true, 'script').find((x) => x.cmd === c)!.buildText?.('', EMPTY_CTX as never) ?? '')
      .join('\n');
    expect(all).toContain('只诊断');
    expect(all).toContain('编号');
    // 中文侧与英文侧都要有（L() 两侧都写，缺一边就是英文界面下失效）
    expect(all).not.toContain('伏笔回收');
  });

  it('剧本：幕场 / 对白 / 指示 / 冲突一支，不含小说与诗的专属问法', () => {
    const d = cmds('script');
    expect(d).toEqual(expect.arrayContaining(['体检', '幕场', '对白', '指示', '冲突', '脑暴']));
    expect(d.length).toBe(6);
    // 「伏笔/连续性」是连载叙事骨架，「分行/形式」是诗的本体 —— 都不属于剧本命令面
    for (const forbidden of ['伏笔', '连续性', '分行', '形式'])
      expect(d, `剧本不该有「${forbidden}」`).not.toContain(forbidden);
  });

  it('日记：体检 / 空档 / 人物 / 语气 / 归档一支，且写死"不许替作者编记忆"', () => {
    const d = cmds('diary');
    expect(d).toEqual(expect.arrayContaining(['体检', '空档', '人物', '语气', '归档']));
    expect(d.length).toBe(5);
    // 幕场/对白属戏剧，分行/形式属诗，立意属散文，伏笔/连续性属连载叙事 —— 都不该出现在日记命令面
    for (const forbidden of ['幕场', '对白', '指示', '分行', '形式', '立意', '篇序', '伏笔', '连续性'])
      expect(d, `日记不该有「${forbidden}」`).not.toContain(forbidden);
    const all = getSlashCommands(true, 'diary')
      .map((c) => c.buildText?.('', EMPTY_CTX as never) ?? '')
      .join('\n');
    expect(all).toContain('不得虚构任何一天的事实');
    expect(all).toContain('不得改动日期与顺序');
    expect(all).toContain('不得替我补上我不记得的细节');
  });

  it('五套命令都得能用：label / description / buildText 全出得了文案（空参数与带聚焦参数各一次）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary']) {
      for (const c of getSlashCommands(true, g)) {
        expect(c.label(), g + c.cmd).not.toBe('');
        expect(c.description(), g + c.cmd).not.toBe('');
        expect(c.buildText?.('', EMPTY_CTX as never) ?? '', g + c.cmd).not.toBe('');
        expect(c.buildText?.('第三首', EMPTY_CTX as never) ?? '', g + c.cmd).not.toBe('');
      }
    }
  });

  it('代码场景完全不受影响（仍然没有书命令）', () => {
    const code = getSlashCommands(false).map((c) => c.cmd);
    expect(code).toContain('fix');
    expect(code).not.toContain('体检');
  });

  it('诗的命令必须写死"不得把诗排成散文段落 / 不增删节数"这条主权底线', () => {
    const all = getSlashCommands(true, 'poetry')
      .map((c) => c.buildText?.('', EMPTY_CTX as never) ?? '')
      .join('\n');
    expect(all).toContain('散文段落');
    expect(all).toContain('只诊断');
  });
});

describe('ask 人设按体裁（刀B）', () => {
  const ask = (g?: string) => modeInstruction('ask', true, null, g);

  it('小说（含未设置与脏体裁值）与"根本没传体裁"完全同串，且保留原措辞', () => {
    const base = ask();
    expect(base).toContain('小说写作助手');
    expect(base).toContain('人设卡、世界观设定与全书结构');
    // ⑮-2 之前 script 也落在这里（借小说人设）；开闸后它有自己的一支，见下面那条
    for (const g of [undefined, '', 'novel', 'scribble']) expect(ask(g), String(g)).toBe(base);
  });

  it('剧本拿到剧本人设：读角色表与幕场结构，不再自称小说助手', () => {
    const d = ask('script');
    expect(d).toContain('剧本写作助手');
    expect(d).toContain('角色表');
    expect(d).toContain('幕场结构');
    expect(d).not.toContain('小说写作助手');
    expect(d).not.toContain('世界观设定');
  });

  it('日记拿到日记人设：读条目与各天提到的人与地，不再喊"补人设卡/世界观"', () => {
    const d = ask('diary');
    expect(d).toContain('日记写作助手');
    expect(d).toContain('日记条目清单');
    expect(d).toContain('各天提到的人物与地点');
    expect(d).not.toContain('小说写作助手');
    expect(d).not.toContain('世界观设定');
  });

  it('诗集拿到诗歌人设与诗的资料清单，不再自称小说助手', () => {
    const p = ask('poetry');
    expect(p).toContain('诗歌写作助手');
    expect(p).toContain('各首标的形式');
    expect(p).not.toContain('小说');
    expect(p).not.toContain('人设卡');
  });

  it('散文集拿到散文人设与篇目清单', () => {
    const e = ask('essay');
    expect(e).toContain('散文写作助手');
    expect(e).toContain('篇目清单');
    expect(e).not.toContain('小说');
  });

  it('非书场景人设不动（代码分析助手）', () => {
    expect(modeInstruction('ask', false)).toContain('项目代码分析助手');
    expect(modeInstruction('ask', false, null, 'poetry')).toContain('项目代码分析助手');
  });

  it('bookTopic 命中时仍走题材角色（刀B 只动未限定题材那条，不改既有分工）', () => {
    expect(modeInstruction('ask', true, 'characters')).toContain('人物');
    expect(modeInstruction('ask', true, 'characters', 'poetry')).toContain('人物');
  });
});

/**
 * W-0a（2026-11-10 轮 2）：`parseSlashCommand` 以前没有 genre 位，运行时会退到小说那一支，
 * 于是诗/散文/剧本/日记四套共 22 条命令**定义齐全却恒不可达**。这里钉的是「解得开」，
 * 上面几段钉的是「列得出」——两头都锁住，中间那根线才不可能再悄悄断。
 */
describe('斜杠命令按体裁解析（W-0a）', () => {
  const sets = ['novel', 'essay', 'poetry', 'script', 'diary'].map((g) => cmds(g));

  it('五支命令集两两互不相同（W-0a 的可证伪判据：任一体裁退回小说即红）', () => {
    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        expect(sets[j], `${['novel', 'essay', 'poetry', 'script', 'diary'][i]} 与 ${['novel', 'essay', 'poetry', 'script', 'diary'][j]} 不该同一支`).not.toEqual(sets[i]);
      }
    }
  });

  it('体裁自己的命令解得开，并带出参数', () => {
    const p = parseSlashCommand('/形式 第二首', true, 'poetry');
    expect(p?.def.cmd).toBe('形式');
    expect(p?.args).toBe('第二首');
    expect(parseSlashCommand('/空档', true, 'diary')?.def.cmd).toBe('空档');
    expect(parseSlashCommand('/幕场 第二幕', true, 'script')?.def.cmd).toBe('幕场');
    expect(parseSlashCommand('/立意', true, 'essay')?.def.cmd).toBe('立意');
  });

  it('命令面同步封口：诗集解不开「伏笔/连续性」，小说解不开「形式/分行」', () => {
    // ⑦ 早把这些页签从诗集上摘了，命令面必须一起封口，否则留的是绕过口
    for (const g of ['poetry', 'essay', 'script', 'diary']) {
      expect(parseSlashCommand('/伏笔', true, g), `${g} 不该解得开小说的「伏笔」`).toBeNull();
      expect(parseSlashCommand('/连续性', true, g), `${g} 不该解得开小说的「连续性」`).toBeNull();
    }
    expect(parseSlashCommand('/形式', true, 'novel')).toBeNull();
    expect(parseSlashCommand('/分行', true, 'novel')).toBeNull();
    expect(parseSlashCommand('/空档', true, 'novel')).toBeNull();
  });

  it('小说侧逐字零回归：没传体裁 / 传空 / 脏体裁值，仍然解得开原来那 6 条', () => {
    for (const g of [undefined, '', 'novel', 'scribble']) {
      for (const c of ['体检', '连续性', '人物', '伏笔', '时间线', '脑暴']) {
        const hit = parseSlashCommand(`/${c}`, true, g as string | undefined);
        expect(hit, `novel 口径下的「/${c}」必须命中`).not.toBeNull();
        expect(hit?.def.label()).not.toBe('');
      }
    }
  });

  it('代码场景不受 genre 影响（fix 仍解得开，书命令仍解不开）', () => {
    expect(parseSlashCommand('/fix 这行')?.def.cmd).toBe('fix');
    expect(parseSlashCommand('/fix', false, 'poetry')?.def.cmd).toBe('fix');
    expect(parseSlashCommand('/体检', false, 'poetry')).toBeNull();
  });
});

describe('agent 人设按体裁（A-4）', () => {
  const agent = (g?: string) => modeInstruction("agent", true, null, g);

  it('小说（含未设置与脏体裁值）逐字零回归：斜杠原文、措辞不变、不加小说前缀', () => {
    const base = agent();
    // 原文是「（人设卡 / 世界观设定 / 全书结构）」斜杠括号版，与 ask 支顿号版不同，必须原样保留
    expect(base).toContain("你是一个写作代理助手，可跨章节分析与修改。优先用 project_context 读取写作台上下文（人设卡 / 世界观设定 / 全书结构），用 file_read 读取真实正文");
    // 措辞没被 noun 污染（不应变成「小说写作代理助手」）
    expect(base).not.toContain("小说写作代理助手");
    for (const g of [undefined, '', 'novel', 'scribble']) expect(agent(g), String(g)).toBe(base);
  });

  it('诗集领诗的资料清单，不再被要求凑人设卡/世界观', () => {
    const p = agent('poetry');
    expect(p).toContain("诗作清单");
    expect(p).toContain("意象与念头");
    expect(p).not.toContain("人设卡");
    expect(p).not.toContain("世界观");
    expect(p).not.toContain("全书结构");
    // 措辞主体不变，只换对照物
    expect(p).toContain("你是一个写作代理助手，可跨章节分析与修改");
  });

  it('剧本领角色表与幕场结构，不再自称要读世界观', () => {
    const d = agent('script');
    expect(d).toContain("角色表");
    expect(d).toContain("幕场结构");
    expect(d).not.toContain("世界观设定");
    expect(d).not.toContain("人设卡");
  });

  it('日记领条目清单，不再喊「读人设卡 / 世界观」', () => {
    const d = agent('diary');
    expect(d).toContain("日记条目清单");
    expect(d).not.toContain("人设卡");
    expect(d).not.toContain("世界观设定");
  });

  it('散文集领篇目清单与素材', () => {
    const e = agent('essay');
    expect(e).toContain("篇目清单");
    expect(e).not.toContain("人设卡");
  });

  it('非书场景 agent 人设不动（不读写作台上下文，传 poetry 也不变）', () => {
    const code = modeInstruction("agent", false, null, 'poetry');
    expect(code).not.toContain("写作台上下文");
    // 非书场景下 genre 不参与：传 poetry 与不传逐字相同
    expect(code).toBe(modeInstruction("agent", false, null));
  });
});
