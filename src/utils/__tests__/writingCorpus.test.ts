// 题材语料构建器（utils/writingCorpus）单测：
// 覆盖从 workbenchPanelHooks 独立出来的 7 个语料函数（worldBible 已有 workbenchWorldBible.test.ts）：
//   - buildTimelineCorpus / buildForeshadowingCorpus / buildInspirationCorpus
//   - buildProofreadCorpus / buildStatsCorpus / buildManuscriptCorpus / buildWorldConsistencyPrompt
// 守的是「AI 域与 UI 面板共用同一份语料、口径不叉」这条契约。
import { describe, it, expect } from 'vitest';
import {
  buildTimelineCorpus,
  buildForeshadowingCorpus,
  buildInspirationCorpus,
  buildProofreadCorpus,
  buildStatsCorpus,
  buildManuscriptCorpus,
  buildWorldConsistencyPrompt,
  buildWorldBibleCorpus,
  buildChapterIndexCorpus,
  resolveRefs,
  buildRefIndex,
  CHARACTER_PROFILE_FIELDS,
  WORLDBUILDING_PROFILE_FIELDS,
  WORLDBUILDING_TYPE_FIELD,
  corpusBits,
  expandRelations,
} from '../writingCorpus';
import type {
  WritingSetting,
  WritingChapter,
  WritingTimelineEvent,
  WritingStoryline,
  WritingForeshadowing,
  WritingOutline,
} from '../../services/tauri';

// ─── 构造器（对齐现有测试惯例：最小合法记录 + 未用字段回填） ───

function ch(id: string, sortOrder = 0, over: Partial<WritingChapter> = {}): WritingChapter {
  return {
    id,
    bookId: 'b1',
    title: `第${id}章`,
    content: '',
    sortOrder,
    wordCount: 0,
    status: 'draft',
    volume: '',
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function ev(id: string, at: string, over: Partial<WritingTimelineEvent> = {}): WritingTimelineEvent {
  return {
    id,
    bookId: 'b1',
    settingId: null,
    at,
    // 默认没填可排序时点；要测倒挂的用例自己 over.timeKey 覆盖
    timeKey: null,
    event: `事件 ${id}`,
    chapterId: null,
    storylineId: null,
    outlineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function sl(id: string, name: string): WritingStoryline {
  return {
    id,
    bookId: 'b1',
    name,
    color: '#000',
    description: '',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fs(id: string, over: Partial<WritingForeshadowing> = {}): WritingForeshadowing {
  return {
    id,
    bookId: 'b1',
    title: `伏笔 ${id}`,
    description: '',
    plantChapterId: null,
    payoffChapterId: null,
    status: 'pending',
    storylineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function setting(id: string, name: string, extra = '{}', kind: WritingSetting['kind'] = 'character'): WritingSetting {
  return {
    id,
    bookId: 'b1',
    kind,
    name,
    subtitle: '',
    description: '',
    extra,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function beat(id: string, title: string, chapterId: string | null, summary = ''): WritingOutline {
  return {
    id,
    bookId: 'b1',
    title,
    summary,
    chapterId,
    extra: '{}',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ─── buildTimelineCorpus ───

describe('buildTimelineCorpus —— 时间线档案语料', () => {
  it('章节骨架按 sortOrder 展开、事件全表按 at 排序、双语对称', () => {
    const chapters = [ch('c1', 1, { title: '第一章' }), ch('c2', 0, { title: '第二章' })];
    const events = [ev('e2', '第2年', { chapterId: 'c2' }), ev('e1', '第1年', { chapterId: 'c1', settingId: 's1' })];
    const { zh, en } = buildTimelineCorpus(
      'b1',
      events,
      chapters,
      [setting('s1', '主角', '{"profile":{"appearance":"金发"}}')],
      [],
    );
    // 骨架：sortOrder 0 在前
    expect(zh).toContain('【章节骨架】1. 第二章（章） 2. 第一章（章）');
    expect(zh).toContain('[第1年] 事件 e1（来源：主角；绑章：第一章）');
    expect(zh).toContain('[第2年] 事件 e2（来源：全书级；绑章：第二章）');
    expect(en).toContain('[Chapter skeleton]');
    expect(en).toContain('source: 主角');
  });

  it('事件 at 缺失视为待补全草稿，单列且不抛错', () => {
    const { zh } = buildTimelineCorpus('b1', [ev('e1', '', { at: '', event: '' })], [], [], []);
    expect(zh).toContain('空草稿');
    expect(zh).toContain('（暂无时间线事件）');
  });

  it('剧情线挂线事件数与未挂线清单，双语对称', () => {
    const storylines = [sl('L1', '男主线'), sl('L2', '女主线')];
    const events = [
      ev('e1', '第1年', { storylineId: 'L1' }),
      ev('e2', '第2年', { storylineId: 'L1' }),
      ev('e3', '第3年', { storylineId: null }),
    ];
    const { zh, en } = buildTimelineCorpus('b1', events, [], [], storylines);
    expect(zh).toContain('男主线（2 条事件）');
    expect(zh).toContain('女主线（0 条事件）');
    expect(zh).toContain('未挂线事件（1 条）');
    expect(en).toContain('(2 events)');
  });
});

// ─── buildForeshadowingCorpus ───

describe('buildForeshadowingCorpus —— 伏笔档案语料', () => {
  it('三态（待回收/已回收/已弃置）+ 埋设回收章名 + 挂线名', () => {
    const chapters = [ch('c1', 0, { title: '第一章' }), ch('c2', 1, { title: '第二章' })];
    const fss = [
      fs('f1', { title: '怀表', status: 'pending', plantChapterId: 'c1', payoffChapterId: 'c2', storylineId: 'L1' }),
      fs('f2', { status: 'paidoff', plantChapterId: 'c1', payoffChapterId: 'c2' }),
      fs('f3', { status: 'abandoned', plantChapterId: 'c1', payoffChapterId: 'c2' }),
    ];
    const { zh, en } = buildForeshadowingCorpus('b1', fss, chapters, [sl('L1', '主线')]);
    expect(zh).toContain('[待回收] 怀表（埋设：第一章；计划回收：第二章）〔挂线：主线〕');
    expect(zh).toContain('[已回收] 伏笔 f2');
    expect(zh).toContain('[已弃置] 伏笔 f3');
    expect(en).toContain('[pending]');
    expect(en).toContain('[paid off]');
    expect(en).toContain('[abandoned]');
    expect(en).toContain('[line: 主线]');
  });

  it('回收点已过（payoff 章先于 plant 章）触发跨章预警', () => {
    const chapters = [ch('c1', 1, { title: '第一章' }), ch('c2', 0, { title: '第二章' })];
    const fss = [fs('f1', { title: '怀表', plantChapterId: 'c1', payoffChapterId: 'c2' })];
    const { zh, en } = buildForeshadowingCorpus('b1', fss, chapters, []);
    expect(zh).toContain('⚠ 回收点已过仍未回收');
    expect(en).toContain('⚠ payoff point passed but still pending');
  });

  it('空态：无伏笔时给中文/英文占位', () => {
    const { zh, en } = buildForeshadowingCorpus('b1', [], [], []);
    expect(zh).toContain('（暂无伏笔）');
    expect(en).toContain('(no foreshadowing yet)');
  });
});

// ─── buildInspirationCorpus ───

describe('buildInspirationCorpus —— 灵感念头池语料', () => {
  it('松散念头（未落章）列出，已入时间线/已入伏笔打标，双语对称', () => {
    const outlines = [
      beat('b1', '怀表', null, '第三章出现的怀表'),
      beat('b2', '已入线念头', null),
      beat('b3', '已落章', 'c1'), // 非松散
    ];
    const timelineEvents = [ev('e1', '第1年', { event: '已入线念头' })];
    const fss = [fs('f1', { title: '怀表', description: '第三章出现的怀表' })];
    const { zh, en } = buildInspirationCorpus('b1', outlines, timelineEvents, fss);
    expect(zh).toContain('第三章出现的怀表');
    expect(zh).toContain('〔已入时间线〕');
    expect(zh).toContain('〔已入伏笔〕');
    expect(zh).toContain('共 2 条'); // 只有未落章的 2 条
    expect(en).toContain('[in timeline]');
    expect(en).toContain('[in foreshadowing]');
  });

  it('空态：念头池为空', () => {
    const { zh, en } = buildInspirationCorpus('b1', [], [], []);
    expect(zh).toContain('（念头池为空）');
    expect(en).toContain('(idea pool is empty)');
  });
});

// ─── buildProofreadCorpus ───

describe('buildProofreadCorpus —— 校对体检语料', () => {
  it('空章 / 完稿 0 字 / 回收预警 / 冲突事件 / 草稿 / 未挂线 / 未分发念头分组输出', () => {
    const chapters = [
      ch('c1', 0, { title: '空章', content: '', wordCount: 0 }),
      ch('c2', 1, { title: '完稿零字', wordCount: 0, status: 'finished' }),
      ch('c3', 2, { title: '正常章', content: '他好。。然后走了', wordCount: 10 }), // 重复标点
    ];
    const outlines = [beat('o1', '未分发念头', null)];
    const timelineEvents = [
      ev('e1', '第1年', { event: '撞车一' }),
      ev('e2', '第1年', { event: '撞车二' }), // 同 at → book 视图冲突
      ev('e3', '第2年', { at: '', event: '' }), // 草稿
    ];
    const fss = [
      fs('f1', { title: '怀表', plantChapterId: 'c3', payoffChapterId: 'c1', status: 'pending' }), // payoff(0) < plant(2) → overdue
    ];
    const { zh } = buildProofreadCorpus('b1', chapters, outlines, timelineEvents, fss, []);
    expect(zh).toContain('〔章账〕空章：空章');
    expect(zh).toContain('〔章账〕标记完稿但 0 字：完稿零字');
    expect(zh).toContain('〔伏笔〕回收点已过仍未回收：怀表');
    expect(zh).toContain('〔时间线〕冲突事件：撞车一；撞车二');
    expect(zh).toContain('〔时间线〕待补全草稿 1 条');
    expect(zh).toContain('〔念头池〕未分发念头 1 条');
    expect(zh).toContain('《正常章》(1 项)');
  });

  it('全绿空态：无发现时给全绿提示，双语对称', () => {
    const chapters = [ch('c1', 0, { content: '正文', wordCount: 100 })];
    const { zh, en } = buildProofreadCorpus('b1', chapters, [], [], [], []);
    expect(zh).toContain('（体检全绿：暂无本地可派生的发现）');
    expect(en).toContain('(All green: no locally derivable findings)');
  });
});

// ─── buildStatsCorpus ───

describe('buildStatsCorpus —— 写作统计语料', () => {
  it('KPI / 卷分布 / 离群章（超长、偏短）双语输出', () => {
    const chapters = [
      ch('c1', 0, { title: '短章', wordCount: 1, volume: '卷一' }),
      ch('c2', 1, { title: '长章', wordCount: 40, volume: '卷一' }),
      ch('c3', 2, { title: '常态章', wordCount: 10, volume: '卷二' }),
    ];
    const { zh, en } = buildStatsCorpus('测试书', chapters, [setting('s1', '主角')]);
    // totalWords=51, chapters=3, volumes=2, settings=1, avg=17 → 短章(<5.1) short；长章(>34) long
    expect(zh).toContain('《测试书》总字数 51');
    expect(zh).toContain('章节 3 · 卷 2 · 设定条目 1 · 章均 17 字');
    expect(zh).toContain('〔体量离群〕《短章》偏短 1 字、《长章》超长 40 字');
    expect(en).toContain('"测试书" total 51 words');
  });

  it('无离群 / 空书不抛错', () => {
    const { zh, en } = buildStatsCorpus('', [], []);
    expect(zh).toContain('〔体量离群〕无');
    expect(en).toContain('[Outliers] none');
  });
});

// ─── buildManuscriptCorpus ───

describe('buildManuscriptCorpus —— 正文写作语料', () => {
  it('骨架 + 当前章正文（HTML 拍平）+ 前情提要（前 2 章尾部 400 字）', () => {
    const chapters = [
      ch('c1', 0, { title: '第一章', content: '<p>开头</p><p>中段</p>' }),
      ch('c2', 1, { title: '第二章', content: '<p>前情正文</p>' }),
      ch('c3', 2, { title: '第三章', content: '<p>当前正文</p>', wordCount: 5 }),
    ];
    const { zh, en } = buildManuscriptCorpus('测试书', chapters, 'c3');
    expect(zh).toContain('《测试书》共 3 章');
    expect(zh).toContain('1. 第一章 · 0 字');
    expect(zh).toContain('〔当前章〕第三章（5 字）');
    expect(zh).toContain('当前正文');
    expect(zh).toContain('〔前情提要〕');
    expect(zh).toContain('〔第二章 尾段〕…前情正文');
    expect(en).toContain('[Current chapter]');
  });

  it('无激活章：只给骨架占位；空章起步占位', () => {
    const chapters = [ch('c1', 0, { title: '第一章' })];
    const { zh } = buildManuscriptCorpus('测试书', chapters, null);
    expect(zh).toContain('（当前无激活章节——正文页签未打开章节，按骨架作答即可）');
    const { zh: zh2 } = buildManuscriptCorpus('测试书', chapters, 'c1');
    expect(zh2).toContain('（本章正文为空——新章起步）');
  });
});

// ─── buildWorldConsistencyPrompt ───

describe('buildWorldConsistencyPrompt —— 一致性审查提示词', () => {
  it('含书名与世界观语料、双语对称', () => {
    const settings = [
      setting(
        's1',
        '魔法体系',
        JSON.stringify({ worldbuildingProfile: { type: 'magic', rules: '需消耗魔力' } }),
        'worldbuilding',
      ),
    ];
    const { zh, en } = buildWorldConsistencyPrompt('测试书', settings);
    expect(zh).toContain('审查小说《测试书》的设定资料');
    expect(zh).toContain('魔法体系（magic）');
    expect(en).toContain('Examine the setting material of the novel "测试书"');
  });

  it('无设定资料时明确告知', () => {
    const { zh } = buildWorldConsistencyPrompt('测试书', []);
    expect(zh).toContain('（暂无世界观设定）');
    expect(zh).toContain('（暂无人物卡）');
  });
});

// ─── 共享字段位模板表（builder 与 provider 同源） ───

describe('共享字段位模板与关系展开（CHARACTER_PROFILE_FIELDS / WORLDBUILDING_PROFILE_FIELDS / corpusBits / expandRelations）', () => {
  it('人物字段表：含完整 5 字段且双语标签齐全', () => {
    expect(CHARACTER_PROFILE_FIELDS.map((f) => f.key)).toEqual([
      'appearance',
      'personality',
      'motivation',
      'catchphrase',
      'notes',
    ]);
    expect(CHARACTER_PROFILE_FIELDS.map((f) => f.zh)).toEqual(['外貌', '性格', '动机', '口头禅', '备注']);
    expect(CHARACTER_PROFILE_FIELDS.map((f) => f.en)).toEqual([
      'appearance',
      'personality',
      'motivation',
      'catchphrase',
      'notes',
    ]);
  });

  it('世界观字段表：行内 5 字段（规则/例外/关联/关系/备注）且关系位带方括号包装', () => {
    expect(WORLDBUILDING_PROFILE_FIELDS.map((f) => f.key)).toEqual([
      'rules',
      'exceptions',
      'linkedTo',
      'relations',
      'notes',
    ]);
    const relationsField = WORLDBUILDING_PROFILE_FIELDS.find((f) => f.key === 'relations')!;
    expect(relationsField.wrap?.('帝国')).toBe('[帝国]');
    // 类型字段单独定义供调用方按形态摆放
    expect(WORLDBUILDING_TYPE_FIELD).toEqual({ key: 'type', zh: '类型', en: 'type' });
  });

  it('corpusBits 占位模式下全字段输出（无值取占位），有值模式只输出有值位', () => {
    const profile: Record<string, string | undefined> = { appearance: '金发', notes: '失忆' };
    const { zh, en } = corpusBits(CHARACTER_PROFILE_FIELDS, (k) => profile[k], '—');
    expect(zh).toEqual(['外貌=金发', '性格=—', '动机=—', '口头禅=—', '备注=失忆']);
    expect(en).toEqual(['appearance=金发', 'personality=—', 'motivation=—', 'catchphrase=—', 'notes=失忆']);
    const hasOnly = corpusBits(CHARACTER_PROFILE_FIELDS, (k) => profile[k]);
    expect(hasOnly.zh).toEqual(['外貌=金发', '备注=失忆']);
    expect(hasOnly.en).toEqual(['appearance=金发', 'notes=失忆']);
  });

  it('corpusBits 处理 relations 虚拟字段：有值时经 wrap 输出，无值在有值模式下跳过', () => {
    const wb: Record<string, string | undefined> = { rules: '需消耗魔力' };
    const withRels = corpusBits(WORLDBUILDING_PROFILE_FIELDS, (k) => (k === 'relations' ? '帝国、邻国' : wb[k]));
    expect(withRels.zh).toEqual(['规则=需消耗魔力', '关系=[帝国、邻国]']);
    const noRels = corpusBits(WORLDBUILDING_PROFILE_FIELDS, (k) => (k === 'relations' ? undefined : wb[k]));
    expect(noRels.zh).toEqual(['规则=需消耗魔力']);
  });

  it('expandRelations：#targetId 优先、target/type 兜底、空值过滤、顿号连接', () => {
    expect(expandRelations([{ targetId: 'c-1', target: '帝国', type: '故土' }])).toBe('#c-1');
    expect(expandRelations([{ target: '帝国', type: '故土' }])).toBe('帝国');
    expect(
      expandRelations([
        { targetId: 'c-1', target: '帝国', type: '故土' },
        { target: '林越', type: '盟约' },
      ]),
    ).toBe('#c-1、林越');
    expect(expandRelations([])).toBe('');
    expect(expandRelations(undefined)).toBe('');
  });
});

// ─── resolveRefs / buildRefIndex（关系化引用解析）───

describe('resolveRefs —— 关系化引用解析', () => {
  const refIndex = new Map([
    ['s1', '魔法体系'],
    ['chap_a', '第一章'],
    ['L1', '复仇线'],
  ]);

  it('存在的 #id 解析为「名称(#id)」保留锚点', () => {
    expect(resolveRefs('事件涉及 #s1 的规则', refIndex, 'zh')).toBe('事件涉及 魔法体系(#s1) 的规则');
    expect(resolveRefs('see #chap_a planting', refIndex, 'en')).toBe('see 第一章(#chap_a) planting');
  });

  it('缺失引用显式标注（zh/en 双语分别标注）', () => {
    expect(resolveRefs('引用 #gone 失效', refIndex, 'zh')).toBe('引用 #gone（引用缺失） 失效');
    expect(resolveRefs('ref #gone broken', refIndex, 'en')).toBe('ref #gone (missing ref) broken');
  });

  it('空索引 / 空文本 / 无引用时原样返回（幂等）', () => {
    expect(resolveRefs('plain text no refs', new Map(), 'zh')).toBe('plain text no refs');
    expect(resolveRefs('', refIndex, 'zh')).toBe('');
    expect(resolveRefs('无 # 引用', refIndex, 'zh')).toBe('无 # 引用');
  });

  it('忽略 #hex 颜色等非引用形态（锚点规则：id 必须以字母开头）', () => {
    expect(resolveRefs('颜色 #f59e0b 与 #1 数字', refIndex, 'zh')).toBe('颜色 #f59e0b 与 #1 数字');
  });

  it('buildRefIndex 汇集设定/章节/剧情线 id→名称，缺失名回退 id 本身', () => {
    const idx = buildRefIndex([setting('c-1', '帝国')], [ch('chap_a', 0, { title: '第一章' })], [sl('L1', '复仇线')]);
    expect(idx.get('c-1')).toBe('帝国');
    expect(idx.get('chap_a')).toBe('第一章');
    expect(idx.get('L1')).toBe('复仇线');
    const emptyName = buildRefIndex([setting('x1', '')]);
    expect(emptyName.get('x1')).toBe('x1');
  });
});

// ─── resolveRefs 接入语料 builder ───

describe('resolveRefs 接入语料 builder（设定/时间线/伏笔）', () => {
  const refIndex = new Map([
    ['s1', '魔法体系'],
    ['c-1', '帝国'],
  ]);

  it('buildWorldBibleCorpus 传入 refIndex 时关系位 #id 解析为名称（zh/en 双语）', () => {
    const settings = [
      setting(
        's1',
        '魔法体系',
        JSON.stringify({ worldbuildingProfile: { type: 'magic', rules: '需消耗魔力' } }),
        'worldbuilding',
      ),
      setting(
        'c-1',
        '帝国',
        JSON.stringify({
          worldbuildingProfile: { type: 'nation', rules: '强盛' },
          relations: [{ targetId: 's1' }, { target: '林越', type: '盟约' }],
        }),
        'worldbuilding',
      ),
    ];
    const resolved = buildWorldBibleCorpus(settings, { refIndex });
    expect(resolved.zh).toContain('魔法体系（magic）');
    // targetId 引用 #s1 → 魔法体系(#s1)；自由文本 target 保持原样
    expect(resolved.zh).toContain('关系=[魔法体系(#s1)、林越]');
    expect(resolved.en).toContain('relations=[魔法体系(#s1)、林越]');
    // 不传 refIndex 保持 #id 原样（旧断言兼容）
    const raw = buildWorldBibleCorpus(settings);
    expect(raw.zh).toContain('关系=[#s1、林越]');
  });

  it('buildTimelineCorpus 传入 refIndex 时事件/来源中的 #id 解析为名称，缺失标注', () => {
    const chapters = [ch('c1', 0, { title: '第一章' })];
    const events = [ev('e1', '第1年', { event: '与 #s1 冲突', settingId: 'c-1' })];
    const settings = [setting('c-1', '帝国', '{}', 'worldbuilding')];
    const { zh } = buildTimelineCorpus('b1', events, chapters, settings, [], { refIndex });
    expect(zh).toContain('与 魔法体系(#s1) 冲突');
    expect(zh).toContain('来源：帝国'); // settingId 已由 builder 解析为名称
    const { zh: raw } = buildTimelineCorpus('b1', events, chapters, settings, []);
    expect(raw).toContain('与 #s1 冲突');
  });

  it('buildForeshadowingCorpus 传入 refIndex 时描述中的 #id 解析为名称，缺失标注', () => {
    const fss = [fs('f1', { title: '怀表', description: '关联 #gone 的实体' })];
    const { zh } = buildForeshadowingCorpus('b1', fss, [], [], { refIndex });
    expect(zh).toContain('#gone（引用缺失）');
    const { en } = buildForeshadowingCorpus('b1', fss, [], [], { refIndex });
    expect(en).toContain('#gone (missing ref)');
  });
});

// ─── buildChapterIndexCorpus（章节索引表）───

describe('buildChapterIndexCorpus —— 卷章索引表', () => {
  it('未分卷：四列表头 + 行渲染 + 表头分隔线', () => {
    const chapters = [
      ch('c2', 1, { title: '第二章', wordCount: 500, status: 'draft' }),
      ch('c1', 0, { title: '第一章', wordCount: 300, status: 'finished' }),
    ];
    const { zh } = buildChapterIndexCorpus(chapters);
    expect(zh[0]).toBe('| 序号 | 标题 | 字数 | 状态 |');
    expect(zh[1]).toBe('| --- | --- | --- | --- |');
    // 按 sortOrder 排序：第一章在前
    expect(zh[2]).toBe('| 1 | 第一章 | 300 | finished |');
    expect(zh[3]).toBe('| 2 | 第二章 | 500 | draft |');
    // en 表头
    const { en } = buildChapterIndexCorpus(chapters);
    expect(en[0]).toBe('| # | Title | Words | Status |');
  });

  it('已分卷：五列表头，空卷显示 -', () => {
    const chapters = [
      ch('c1', 0, { title: '第一章', volume: '卷一', wordCount: 100, status: 'draft' }),
      ch('c2', 1, { title: '第二章', volume: '', wordCount: 200, status: 'draft' }),
    ];
    const { zh } = buildChapterIndexCorpus(chapters);
    expect(zh[0]).toBe('| 序号 | 卷 | 标题 | 字数 | 状态 |');
    expect(zh[2]).toBe('| 1 | 卷一 | 第一章 | 100 | draft |');
    expect(zh[3]).toBe('| 2 | - | 第二章 | 200 | draft |');
  });

  it('空章节：返回无数据提示行而不是空表', () => {
    const { zh } = buildChapterIndexCorpus([]);
    expect(zh).toEqual(['_无数据_']);
    const { en } = buildChapterIndexCorpus([]);
    expect(en).toEqual(['_no data_']);
  });
});
