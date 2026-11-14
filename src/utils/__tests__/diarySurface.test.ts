/**
 * ㉓-1 / ㉓-2 日记界面槽位与入口护栏的锁（2026-11-10）。
 *
 * 两件东西在这儿钉住：
 *  1. **槽位表回落**：没登记的体裁必须拿到改造前那一条键（零回归是机制保证的，不是祈祷）；
 *     日记的覆盖键**占位符形状必须和默认键一致** —— 形状不一致时界面会直接印出 `{chapters}`，
 *     这类错在双语+插值的组合里最容易发生（㉑ 那次 `{unitShort}` 插出「新建一诗」是同一家族）。
 *  2. **入口护栏的位置**：`openTypedCarrierView` 必须先放行已存在的视图、再拦新建。
 *     位置写反就等于把用户已有的数据藏起来 —— 那是 ⑳ 明令禁止的事，比不修更坏。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { surfaceKeyForGenre, surfaceDefaultKey, type SurfaceSlot } from '../writingSchema';
import { formatBookGoalCorpus } from '../writingStats';
import { t, setLang } from '../../i18n';

const SLOTS: SurfaceSlot[] = [
  'tabUnit', 'childCount', 'bandGroup', 'bandUnitSize', 'bandUncategorized', 'statsEmpty',
  'unitProgress', 'materialTarget', 'materialInsert', 'paneLabel', 'paneHint', 'peopleGroup',
  // ㉗ 名词补齐：目标卡三句 + 当前读数 + 分组/结构/挂单元
  'unitTargetLabel', 'unitTargetUnset', 'currentTally', 'volumeStructButton',
  'unitListInGroup', 'volumeGapNote', 'groupListTitle', 'groupHint', 'groupEmpty',
  'bindUnit', 'bindHint', 'volumeStructEmpty', 'volumeStructTip', 'volumeStructStat',
  // ㉙ 书内视角二十条（节题与空态）
  'unitOutline', 'unitCast', 'unitScenes', 'appearUnits', 'relatedUnits', 'unitUnattached',
  'unitContextTitle', 'unitForeshadowTitle', 'unitForeshadowEmpty', 'unitForeshadowPayHere',
  'unitStorylinesTitle', 'unitStorylinesEmpty', 'unitTimelineTitle', 'unitTimelineEmpty',
  'plantedHere', 'payableHere', 'mainStorylineTitle', 'unitNoOutline', 'unitBeatsEmpty', 'openUnitInDesk',
  // ㉚ 页签两枚 + 单位详情 + 载体卡副标（T-A / T-E）
  'tabCatalog', 'tabCharacters', 'unitDetail', 'designHint',
  // ㉢ N-20（轮 72 · 李先生真人指出「日记的时间线不是按日记走的」）：时间线那一栏的八格
  'tlAxisUnit', 'tlBindUnit', 'tlUnbound', 'tlJumpUnit',
  'tlAtPlaceholder', 'tlAtFieldHint', 'tlConflictHint', 'tlEmptyHint',
];

/**

 * `paneHint` 在列：散文/诗的 L2 大纲栏铺的是「篇目 + 素材」「诗作 + 意象」两栏，
 * 提示语再说「写每一章要发生什么：加节拍」就是叫错功能（不是叫错单位名那么简单）。
 * ㉜ 三枚统计带槽位在列（T-F′）：轮 6 抓到诗集统计页仍印「卷分布 / 未分卷」——
 * 这两格自 ㉓-1 起就只有日记登记，散文/诗/剧本不是「不该登记」，是**从没接上**。
 */


/** ㉙ 这二十条的默认键 = 改造前那六个文件实际在用的原句（接线完整性锁逐条扫这些键名） */
const UNIT_SIDE_DEFAULTS = [
  'editor.writing.inspector.beat', 'editor.writing.inspector.cast', 'editor.writing.inspector.scenes',
  'editor.writing.inspector.appearChapters', 'editor.writing.inspector.relatedChapters',
  'editor.writing.inspector.notAttached', 'writing.chapterContextTitle', 'writing.chapterForeshadowTitle',
  'writing.chapterForeshadowEmpty', 'writing.chapterForeshadowPayHere', 'writing.chapterLinesTitle',
  'writing.chapterLinesEmpty', 'writing.chapterTimelineTitle', 'writing.chapterTimelineEmpty',
  'writing.foreshadowPlantedHere', 'writing.foreshadowPayableHere', 'writing.storylineMainTitle',
  'editor.writing.inspector.unplanned', 'writing.chapterBeatsEmpty', 'writing.annotationRefsOpen',
];

/** 与 UNIT_SIDE_DEFAULTS **同序**的槽位名（㉙-2：这三体裁只登记这二十条，其余仍回落） */
const UNIT_SIDE_SLOTS = [
  'unitOutline', 'unitCast', 'unitScenes', 'appearUnits', 'relatedUnits', 'unitUnattached',
  'unitContextTitle', 'unitForeshadowTitle', 'unitForeshadowEmpty', 'unitForeshadowPayHere',
  'unitStorylinesTitle', 'unitStorylinesEmpty', 'unitTimelineTitle', 'unitTimelineEmpty',
  'plantedHere', 'payableHere', 'mainStorylineTitle', 'unitNoOutline', 'unitBeatsEmpty', 'openUnitInDesk',
] as const satisfies readonly SurfaceSlot[];

/**
 * 除书内视角二十条外，三体裁（essay/poetry/script）**另外允许登记**的槽：L2 页签名 + pane 文案
 * + ㉜ 三枚统计带（T-F′）+ 洼地②六枚统计读数槽。这三组都不是「不该登记」，是历史上只给了
 * 日记、其余体裁从没接上（接上之前它们在统计页/页签说「章」）。
 */
const REGISTERED_FOR_ALL_READY_GENRES = [
  'tabCatalog', 'tabCharacters', 'unitDetail', 'designHint', 'paneHint', 'paneLabel',
  'bandGroup', 'bandUnitSize', 'bandUncategorized',
  'tabUnit', 'statsEmpty', 'unitProgress', 'unitTargetLabel', 'unitTargetUnset', 'currentTally',
  'statusTodo', 'statusDraft', 'statusFinished',
] as const satisfies readonly SurfaceSlot[];

const zhJson = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
const enJson = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));

describe('㉓-1 界面槽位表', () => {
  afterEach(() => setLang('zh-CN'));

  it('回落半边：小说 / 空 / 脏值 × 58 槽位全部拿原键；另三体裁只放行登记过的 35 条', () => {
    for (const genre of ['novel', '', 'diaryy', 'Novel']) {
      for (const slot of SLOTS) {
        expect(surfaceKeyForGenre(genre, slot), `${genre || '(空)'} / ${slot}`).toBe(surfaceDefaultKey(slot));
      }
    }

    // 另三体裁各有现键，顺手登记等于改掉它们本来正确的句子。
    const registered = [...UNIT_SIDE_SLOTS, ...REGISTERED_FOR_ALL_READY_GENRES] as readonly string[];
    for (const genre of ['essay', 'poetry', 'script']) {
      for (const slot of SLOTS) {
        if (registered.includes(slot)) {
          expect(surfaceKeyForGenre(genre, slot), `${genre} / ${slot}`).toBe(`writing.${genre}.${slot}`);
        } else {
          expect(surfaceKeyForGenre(genre, slot), `${genre} / ${slot}`).toBe(surfaceDefaultKey(slot));
        }
      }
    }
  });

  it('㉙-2 三体裁各说自己的话：不许蹭别的体裁的正文单位词', () => {
    setLang('zh-CN');
    const OWN: Record<string, string[]> = { essay: ['篇', '篇目'], poetry: ['诗', '首'], script: ['场', '场次'] };
    const FOREIGN: Record<string, string[]> = {
      essay: ['章', '诗', '幕', '这天', '日记'],
      poetry: ['章', '篇', '幕', '这天', '日记'],
      script: ['章', '篇', '诗', '这天', '日记'],
    };
    for (const genre of ['essay', 'poetry', 'script']) {
      const rendered = UNIT_SIDE_SLOTS.map((slot) => t(surfaceKeyForGenre(genre, slot))).join(' / ');
      // 「场景」是设定卡的实体名，不是正文单位词 ⇒ 先摘掉再扫（㉗ 那次被「编辑」误伤过，
      // 摘的是这一个词，不是整条判据）。
      const scanned = rendered.replace(/场景/g, '');
      for (const bad of FOREIGN[genre]) {
        expect(scanned, `${genre} 的界面不许说「${bad}」`).not.toContain(bad);
      }
      for (const own of OWN[genre]) {
        expect(rendered, `${genre} 至少要说自己的「${own}」`).toContain(own);
      }
    }
  });

  it('㉙-2 三体裁 60 条键双语齐备且各归各的语言（缺一条就印裸 key）', () => {
    const cjk = /[\u4e00-\u9fff]/;
    for (const genre of ['essay', 'poetry', 'script']) {
      for (const slot of UNIT_SIDE_SLOTS) {
        const zh = zhJson.writing[genre]?.[slot];
        const en = enJson.writing[genre]?.[slot];
        expect(typeof zh, `zh 缺 writing.${genre}.${slot}`).toBe('string');
        expect(typeof en, `en 缺 writing.${genre}.${slot}`).toBe('string');
        expect(zh, `${genre}.${slot} 中文侧不许是英文`).toMatch(cjk);
        expect(en, `${genre}.${slot} 英文侧不许夹汉字`).not.toMatch(cjk);
      }
    }
  });

  it('默认键清单逐条钉死：改错一条就是改了小说的界面', () => {
    // 默认键本身就是改造前那批键（改错一条就会红）
    expect(SLOTS.map(surfaceDefaultKey)).toEqual([
      'writing.tabChapters',
      'writingTree.chapterCount',
      'writing.statsBandVolume',
      'writing.statsBandChapterSize',
      'writing.statsUncategorized',
      'writing.statsPaneEmpty',
      'writing.bookChapterProgress',
      'writing.materialTargetChapter',
      'writing.materialInsert',
      'writing.viewKind.catalog',
      'editor.writing.studioPane.storylineHint',
      'writing.characters',
      // ㉗ 新增 11 条：回落键 = 改造前那五个面实际在用的原键（写错一条就是改了小说的文案）
      'writing.bookTargetChapters',
      'writing.bookChapterUnset',
      'studio.bookMeta.currentTally',
      'panel.layers.bookTitle',
      'editor.writing.inspector.chapterList',
      'editor.writing.inspector.volumeGap',
      'writing.volumeOverviewList',
      'writing.volumeOverviewHint',
      'writing.volumeOverviewEmpty',
      'writing.inspirationBindChapter',
      'writing.inspirationBindHint',
      'panel.layers.bookEmpty',
      'panel.layers.bookTip',
      'panel.layers.bookVolumeStat',
      // ㉙ 二十条：展开同一份常量，免得"默认键清单"在这份测试里被抄第三遍
      ...UNIT_SIDE_DEFAULTS,
      // ㉚ 四条：回落键 = 改造前页签 / 详情标题 / 载体卡副标实际在用的原句
      'writing.viewKind.catalog',
      'writing.viewKind.characters',
      'writing.tabChapterDetails',
      'writingDesign.hint',
      // ㉢ N-20 八条：时间线那一栏的默认键 = 改造前那七句原键 + 轴名（写错一条就是改了小说的界面）
      'writing.timelineViewChapter', 'writing.timelineChapter', 'writing.timelineUnbound',
      'writing.timelineJumpChapter', 'writing.timelineAtPh', 'writing.timelineAtHint',
      'writing.timelineConflictHint', 'writing.timelineEmptyHint',
    ]);
  });

  it('日记全部槽位都有覆盖键，且中文读数不再说「章 / 卷 / 辑」', () => {
    setLang('zh-CN');
    for (const slot of SLOTS) {
      expect(surfaceKeyForGenre('diary', slot), slot).toMatch(/^writing\.diary\./);
    }
    const rendered = SLOTS.map((slot) => t(surfaceKeyForGenre('diary', slot))).join(' / ');
    // 唯一例外处理：「场景」是设定卡的一种实体名，不是正文单位词，先摘掉再扫。
    // ㉗ 那次这条黑名单把「编辑区」的「辑」抓出来过 —— 当时改的是文案，今天也一样：
    // 摘的是这一个词，不是整条判据。
    const scanned = rendered.replace(/场景/g, '');
    for (const wrong of ['章', '卷', '幕', '场', '辑']) {
      expect(scanned, `日记界面不许说${wrong}`).not.toContain(wrong);
    }
    expect(t(surfaceKeyForGenre('diary', 'childCount'), { n: 12 })).toBe('12 天');
    expect(t(surfaceKeyForGenre('diary', 'unitProgress'), { chapters: 12, target: 365 })).toBe('已写 12 / 目标 365 天');
    expect(t(surfaceKeyForGenre('diary', 'materialInsert'))).toBe('插入到目标条目');
    expect(t(surfaceKeyForGenre('diary', 'paneLabel'))).toContain('年月');
    // ㉗ 五个面各自的中文读数
    expect(t(surfaceKeyForGenre('diary', 'unitTargetLabel'))).toBe('日记天数');
    expect(t(surfaceKeyForGenre('diary', 'unitTargetUnset'))).toBe('还未设定记录天数目标');
    expect(t(surfaceKeyForGenre('diary', 'currentTally'), { chapters: 12, words: '3,400' })).toBe('当前 12 天 · 3,400 字');
    expect(t(surfaceKeyForGenre('diary', 'volumeStructButton'))).toBe('年月结构');
    expect(t(surfaceKeyForGenre('diary', 'unitListInGroup'))).toBe('日记条目');
    // ㉖ 兑现了这句话里的欠条：读数已经存在，所以文案改为指向统计面板（不许再声称"待建立"）
    expect(t(surfaceKeyForGenre('diary', 'volumeGapNote'))).toContain('统计面板');
    expect(t(surfaceKeyForGenre('diary', 'volumeGapNote'))).not.toContain('下一版');
    expect(t(surfaceKeyForGenre('diary', 'groupListTitle'))).toBe('包含的条目');
    expect(t(surfaceKeyForGenre('diary', 'groupHint'), { kind: '月' })).toContain('月只用来归拢条目');
    expect(t(surfaceKeyForGenre('diary', 'groupEmpty'), { kind: '年' })).toContain('这个年下面还没有日记');
    expect(t(surfaceKeyForGenre('diary', 'bindUnit'))).toBe('挂到某天（转正）');
    expect(t(surfaceKeyForGenre('diary', 'volumeStructEmpty'))).toBe('这本日记还没有条目');
    // 「编辑区」的「辑」会被下面那条黑名单抓出来，所以这句换了写法（守卫不许为文案让路）
    expect(t(surfaceKeyForGenre('diary', 'volumeStructTip'))).toContain('年与月是组');
    expect(t(surfaceKeyForGenre('diary', 'volumeStructStat'), { chapters: 3, words: '1,200', finished: 1 })).toBe('3 天 · 1,200 字 · 完稿 1');
    // 小说侧同族三句逐字不变（对话框一族）
    expect(t(surfaceDefaultKey('volumeStructEmpty'))).toBe('这本书还没有任何章节');
    expect(t(surfaceDefaultKey('volumeStructStat'), { chapters: 3, words: '1,200', finished: 1 })).toBe('3 章 · 1,200 字 · 完稿 1');
    // ㉙ 书内视角：日记说「这天」，小说逐字仍说「本章」
    expect(t(surfaceKeyForGenre('diary', 'unitOutline'))).toBe('这天的大纲');
    expect(t(surfaceDefaultKey('unitOutline'))).toBe('本章大纲');
    expect(t(surfaceKeyForGenre('diary', 'relatedUnits'))).toBe('关联条目');
    expect(t(surfaceDefaultKey('relatedUnits'))).toBe('关联章节');
    expect(t(surfaceKeyForGenre('diary', 'unitUnattached'))).toBe('还没有挂到任何条目');
    expect(t(surfaceDefaultKey('unitUnattached'))).toBe('还没有挂到任何章');
    expect(t(surfaceKeyForGenre('diary', 'unitContextTitle'))).toBe('这天');
    expect(t(surfaceDefaultKey('unitContextTitle'))).toBe('本章');
    expect(t(surfaceKeyForGenre('diary', 'openUnitInDesk'))).toBe('在写作台打开这天');
    expect(t(surfaceDefaultKey('openUnitInDesk'))).toBe('在写作台打开该章');
    expect(t(surfaceKeyForGenre('diary', 'plantedHere'))).toBe('这天埋设');
    expect(t(surfaceDefaultKey('plantedHere'))).toBe('本章埋设');
    // 小说侧同一批槽位逐字仍是原句（零回归，中文）
    setLang('zh-CN');
    expect(t(surfaceDefaultKey('unitTargetLabel'))).toBe('章节数');
    expect(t(surfaceDefaultKey('currentTally'), { chapters: 12, words: '3,400' })).toBe('当前 12 章 · 3,400 字');
    expect(t(surfaceDefaultKey('volumeStructButton'))).toBe('卷部结构');
    expect(t(surfaceDefaultKey('unitListInGroup'))).toBe('本卷章节');
    expect(t(surfaceDefaultKey('bindUnit'))).toBe('挂到章（转正）');
  });

  it('占位符形状与默认键逐槽位一致（不一致界面会印出 {xxx}）', () => {
    const ph = (key: string) => (key.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    for (const slot of SLOTS) {
      expect(ph(t(surfaceKeyForGenre('diary', slot))), `${slot} 的占位符形状`)
        .toBe(ph(t(surfaceDefaultKey(slot))));
    }
  });

  it('双语齐全：writing.diary 的键在中英文两份里一一对应（禁只加中文）', () => {
    expect(Object.keys(zhJson.writing.diary).sort()).toEqual(Object.keys(enJson.writing.diary).sort());
    // 锁的是「11 个槽位都登记了键」，不是「diary 块恰好 11 个键」——
    // ㉕ 又往里加了 todayTip/todayTitle/... 五个日期键，写成精确条数会把无关的 additions 判成红。
    // 按**真实键路径**校验，而不是"槽位名 == 键名"：tabUnit 这个槽位对应的键叫 tabEntries，
    // 名字本来就不必相同；要验的是「解析出来的键在中英文两份里都存在且是字符串」。
    for (const json of [zhJson, enJson]) {
      for (const slot of SLOTS) {
        const key = surfaceKeyForGenre('diary', slot);
        expect(key.startsWith('writing.diary.'), `${slot} 应落在 writing.diary 下`).toBe(true);
        const leaf = key.slice('writing.diary.'.length);
        expect(typeof json.writing.diary[leaf], `缺键 ${key}`).toBe('string');
      }
    }
    setLang('en-US');
    for (const slot of SLOTS) {
      expect(t(surfaceKeyForGenre('diary', slot)), `英文缺 ${slot} 的译文`).not.toBe(surfaceKeyForGenre('diary', slot));
    }
    expect(t(surfaceKeyForGenre('diary', 'bandUnitSize'))).toBe('Size by day');
  });
});

describe('㉓-1 目标语料的量词（A9）', () => {
  const goal = { targetWords: 0, targetChapters: 365, deadline: 0 };
  const day = new Date('2026-11-10T12:00:00+08:00');

  it('日记说「天 / days」', () => {
    const r = formatBookGoalCorpus(goal, 0, 12, day, undefined, 'diary');
    expect(r?.zh).toContain('目标 365 天：已写 12 天');
    expect(r?.zh).not.toContain('章');
    expect(r?.en).toContain('days target 365: 12 written');
    expect(r?.en).not.toContain('chapters target');
  });

  it('其余体裁本轮逐字仍说「章」（散文/诗/剧本的同一条漏口记 S7，不在半行里改出两套口径）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', '']) {
      const r = formatBookGoalCorpus(goal, 0, 12, day, undefined, g);
      expect(r?.zh, g).toContain('目标 365 章：已写 12 章');
      expect(r?.en, g).toContain('chapters target 365: 12 written');
    }
    // 不传 genre 的老调用方也照旧
    expect(formatBookGoalCorpus(goal, 0, 12, day)?.zh).toContain('目标 365 章：已写 12 章');
  });
});

describe('㉓-2 视图入口的中心护栏', () => {
  const src = readFileSync('src/utils/studioBook.ts', 'utf-8');
  const body = src.slice(src.indexOf('export function openTypedCarrierView'));

  it('护栏在函数体里，且判据是 hiddenViewKindsForGenre（不另立一张表）', () => {
    expect(body).toContain('if (hiddenViewKindsForGenre(genre).includes(kind)) return;');
  });

  it('位置正确：先放行已有视图（hit 分支），再拦新建 —— 顺序写反就是藏数据', () => {
    const hit = body.indexOf('if (hit) {');
    const guard = body.indexOf('hiddenViewKindsForGenre(genre).includes(kind)');
    const add = body.indexOf('es.addView(');
    expect(hit).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(hit);
    expect(add).toBeGreaterThan(guard);
  });
});

describe('㉑-1 顺手修掉的那条全局显示缺陷（A1）', () => {
  const src = readFileSync('src/pages/WritingPage.tsx', 'utf-8');

  it('不再有裸的 t("writing.newChapter")（键值是「新建{unit}」，不传参就印字面量）', () => {
    expect(src).not.toContain(`t('writing.newChapter')`);
    expect(src).toContain(`t('writing.newChapter', unitTermParams(`);
  });
});

describe('㉗ 名词补齐：五个面必须真的接上槽位（源码位置锁）', () => {
  const read = (p: string) => readFileSync(p, 'utf-8');

  it('左栏目录树：两处「N 章」走 childCount，旧字面量归零', () => {
    const src = read('src/editor/panels/WritingTreeTab.tsx');
    expect(src.match(/surfaceKeyForGenre\(genre, 'childCount'\)/g)?.length).toBe(2);
    expect(src).not.toContain("t('writingTree.chapterCount'");
  });

  it('归类节点概览：收 genre 参数，四句读数全走槽位', () => {
    const src = read('src/pages/VolumeOverviewPanel.tsx');
    expect(src).toContain('genre?: string');
    expect(src).toContain("surfaceKeyForGenre(genre, 'childCount')");
    expect(src).toContain("surfaceKeyForGenre(genre, 'groupListTitle')");
    expect(src).toContain("surfaceKeyForGenre(genre, 'groupHint')");
    expect(src).toContain("surfaceKeyForGenre(genre, 'groupEmpty')");
    for (const dead of ["'writingTree.chapterCount'", "'writing.volumeOverviewList'", "'writing.volumeOverviewHint'", "'writing.volumeOverviewEmpty'"]) {
      expect(src, `概览里不该再留硬键 ${dead}`).not.toContain(`t(${dead}`);
    }
    // 调用点要把体裁传进去，否则参数只是个装饰
    expect(read('src/pages/WritingPage.tsx')).toContain('<VolumeOverviewPanel\n            node={activeChapter}\n            chapters={chapters}\n            genre={genre}');
  });

  it('书属性卡与统计弹窗共用那两个键：两个面都接槽位（漏一个就是半截话）', () => {
    const meta = read('src/editor/panels/BookMetaPanel.tsx');
    const stats = read('src/pages/WritingStatsDialog.tsx');
    for (const [src, name] of [[meta, 'BookMetaPanel'], [stats, 'WritingStatsDialog']] as const) {
      expect(src, `${name} 缺 unitTargetLabel`).toContain("'unitTargetLabel'");
      expect(src, `${name} 缺 unitTargetUnset`).toContain("'unitTargetUnset'");
      expect(src, `${name} 还在硬写章节数`).not.toContain("t('writing.bookTargetChapters')");
      expect(src, `${name} 还在硬写章节目标未设`).not.toContain("t('writing.bookChapterUnset')");
    }
    expect(meta).toContain("surfaceKeyForGenre(book.genre, 'unitProgress')");
    expect(meta).toContain("surfaceKeyForGenre(book.genre, 'currentTally')");
    expect(meta).not.toContain("t('writing.bookChapterProgress'");
    expect(meta).not.toContain("t('studio.bookMeta.currentTally'");
  });

  it('右栏：卷部结构按钮 / 本卷章节 / 卷纲欠账句三处走槽位', () => {
    const src = read('src/editor/panels/WritingInspectorPanel.tsx');
    expect(src).toContain("surfaceKeyForGenre(genre, 'volumeStructButton')");
    expect(src).toContain("surfaceKeyForGenre(genre, 'unitListInGroup')");
    expect(src).toContain("surfaceKeyForGenre(genre, 'volumeGapNote')");
    for (const dead of ["t('panel.layers.bookTitle')", "t('editor.writing.inspector.chapterList')", "t('editor.writing.inspector.volumeGap')"]) {
      expect(src, `右栏不该再硬写 ${dead}`).not.toContain(dead);
    }
  });

  it('卷部管理对话框一族：标题 + 空态 + 说明 + 组头账，四句同一个体裁口径', () => {
    const src = read('src/editor/panels/ArchitectureLayersPanel.tsx');
    // 标题用的体裁变量必须在**外层对话框**里取（isBookScene 那一层），不是只在 BookVolumeView 里
    expect(src).toContain('const structGenre = useWritingStore(');
    expect(src).toContain('t(surfaceKeyForGenre(structGenre, "volumeStructButton"))');
    expect(src).toContain('surfaceKeyForGenre(genre, "volumeStructEmpty")');
    expect(src).toContain('surfaceKeyForGenre(genre, "volumeStructTip")');
    expect(src).toContain('surfaceKeyForGenre(genre, "volumeStructStat")');
    for (const dead of ['t("panel.layers.bookTitle")', 't("panel.layers.bookEmpty")', 't("panel.layers.bookTip")', 't("panel.layers.bookVolumeStat"']) {
      expect(src, `对话框不该再硬写 ${dead}`).not.toContain(dead);
    }
    // 代码场景那一支一个字没动（它走 panel.layers.title）
    expect(src).toContain('t("panel.layers.title")');
  });

  it('灵感分发「挂到某单元」走槽位（体裁变量用本组件已有的 inspGenre）', () => {
    const src = read('src/editor/panels/InspirationPanels.tsx');
    expect(src).toContain("surfaceKeyForGenre(inspGenre, 'bindUnit')");
    expect(src).toContain("surfaceKeyForGenre(inspGenre, 'bindHint')");
    expect(src).not.toContain("t('writing.inspirationBindChapter')");
    expect(src).not.toContain("t('writing.inspirationBindHint')");
  });
});

describe('㉗ 顺出来的真缺陷：writing.volumeOverview* 七条中英写反（已互换）', () => {
  afterEach(() => setLang('zh-CN'));
  const cjk = /[\u4e00-\u9fff]/;
  const keys = Object.keys(zhJson.writing).filter((k) => k.startsWith('volumeOverview'));

  it('这一族键全在（少一条说明有人改一半）', () => {
    expect(keys.sort()).toEqual([
      'volumeOverviewEmpty', 'volumeOverviewFinished', 'volumeOverviewHint', 'volumeOverviewKindFallback',
      'volumeOverviewList', 'volumeOverviewReadonly', 'volumeOverviewTitle', 'volumeOverviewUntitled',
    ]);
  });

  it('中文侧含汉字、英文侧不含汉字：逐条双向校验（原来七条填反了文件）', () => {
    for (const k of keys) {
      expect((zhJson.writing as Record<string, string>)[k], `zh-CN ${k}`).toMatch(cjk);
      expect((enJson.writing as Record<string, string>)[k], `en-US ${k}`).not.toMatch(cjk);
    }
  });

  it('中文界面在归类节点上看到的是中文', () => {
    setLang('zh-CN');
    expect(t('writing.volumeOverviewList')).toBe('包含的章');
    expect(t('writing.volumeOverviewReadonly')).toContain('只读');
    expect(t('writing.volumeOverviewFinished', { n: 1 })).toBe('已完稿 1');
    setLang('en-US');
    expect(t('writing.volumeOverviewList')).toBe('Chapters inside');
    expect(t('writing.volumeOverviewFinished', { n: 1 })).toBe('Finished 1');
  });
});

describe('㉙ 接线完整性：这二十句不许再以裸调用出现在界面上', () => {
  const files = [
    'src/editor/panels/WritingInspectorPanel.tsx',
    'src/pages/ChapterDetailsPanel.tsx',
    'src/editor/panels/ChapterOverviewPanel.tsx',
    'src/editor/renderers/writingPanes.tsx',
    'src/pages/WritingPage.tsx',
    'src/editor/SceneEditor.tsx',
  ];

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) return ['__tests__', '__bench__', 'node_modules'].includes(e.name) ? [] : walk(p);
      return p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
    });

  it('六个界面文件里都不再出现旧键（含三元式里当值用那种写法，㉙ 就是靠它才发现漏口）', () => {
    for (const p of files) {
      const src = readFileSync(p, 'utf-8');
      for (const key of UNIT_SIDE_DEFAULTS) {
        expect(src, `${p} 还在把 ${key} 当字面量用`).not.toContain(`'${key}'`);
      }
    }
  });

  it('全库范围：这二十个键名只许住在 writingSchema 的回落表里', () => {
    for (const p of walk('src')) {
      if (p.endsWith('utils/writingSchema.ts')) continue;
      const src = readFileSync(p, 'utf-8');
      for (const key of UNIT_SIDE_DEFAULTS) {
        expect(src, `${p} 仍引用已收编的 ${key}`).not.toContain(`'${key}'`);
      }
    }
  });

  it('六个文件都真的接上了（防止只剩一个文件接线、其余照旧说「章」）', () => {
    for (const p of files) {
      const n = (readFileSync(p, 'utf-8').match(/surfaceKeyForGenre\(/g) ?? []).length;
      expect(n, `${p} 一处都没接`).toBeGreaterThan(0);
    }
  });

  it('被迁走的那个键没有变成没人用的孤儿（㉖ 定过：不留有译文没用户的键）', () => {
    expect(zhJson.writing.statsChapters).toBeUndefined();
    expect(enJson.writing.statsChapters).toBeUndefined();
    // 顶替它的槽位默认键仍在，且两语言同形（小说读数一个字节没变）
    expect(zhJson.writingTree.chapterCount).toBe('{n} 章');
    expect(enJson.writingTree.chapterCount).toBe('{n} chapters');
    // report 命名空间下那个同名键是另一句话，没被顺手删掉
    expect(zhJson.report.book.statsChapters).toBe('章节');
  });
});
