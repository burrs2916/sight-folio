/**
 * ㉒ 日记体裁（diary）的单源锁（2026-11-10）。
 *
 * 李先生这一轮的四项决定都在这儿钉住，防止以后有人"顺手按小说改一下"：
 *   结构 年 › 月 › 天（root=天，可写单位，不是容器层）
 *   叫法 天（默认标题「第 N 天」、徽标「天」、句中「日记」、量词「篇」）
 *   关联 藏 世界观 / 剧情线 / 伏笔，**人物与时间线保留**
 *   日期 不加字段 ⇒ 不许有行尾结构徽标
 * 另锁小说/散文/诗/剧本四体裁的既有口径不被这一刀漂动（零回归抽查）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  WRITING_GENRES,
  WRITING_MEDIUMS,
  carrierTermKeys,
  canCreateEntityForGenre,
  characterCardsOptionalForGenre,
  defaultMediumForGenre,
  genreDef,
  hiddenViewKindsForGenre,
  isCollectionGenre,
  kpiLabelKeys,
  mediumDef,
  outlierMeaninglessForGenre,
  shelfFor,
  structureInspectorForGenre,
  unitClassifierKey,
  unitNameKey,
  unitShortKey,
  unitWordKey,
  volumeSummaryKey,
  workbenchCommandSet,
  aiChatEmptyKey,
} from '../writingSchema';
import { defaultLevels, defaultRootKind, suggestedChildKind } from '../writingTree';
import { buildStatsCorpus } from '../writingCorpus';
import { paletteFor } from '../writingPalette';
import { unitTermParams } from '../unitTerms';
import { collectionPaneKeys } from '../../editor/renderers/writingPanes';
import { t, setLang } from '../../i18n';

describe('㉒ 日记体裁开闸', () => {
  afterEach(() => setLang('zh-CN'));

  it('在体裁表里且 ready=true（不再有"建设中"这一档）', () => {
    const d = genreDef('diary');
    expect(d, '日记必须在 WRITING_GENRES 里').toBeTruthy();
    expect(d!.ready, '这一轮 AI 层同步实装，闸口一次开完').toBe(true);
    expect(WRITING_GENRES.map((g) => g.id)).toContain('diary');
    expect(WRITING_GENRES.every((g) => g.ready), '四+1 体裁都该已开闸').toBe(true);
  });

  it('术语四口径分家：默认名 / 徽标 / 句中词 / 量词，且量词不是徽标字', () => {
    setLang('zh-CN');
    expect(unitNameKey('diary')).toBe('writing.newDayName');
    expect(t(unitNameKey('diary'), { n: 1 })).toBe('第 1 天');
    expect(t(unitShortKey('diary'))).toBe('天');
    expect(t(unitWordKey('diary'))).toBe('日记');
    // 「新建一篇日记」而不是「新建一天日记」——⑰ 那次插出「新建一诗」的同一个坑
    expect(t(unitClassifierKey('diary'))).toBe('篇');
    expect(unitTermParams('diary')).toMatchObject({ unit: '日记', unitShort: '篇' });
    expect(t('writing.newChapter', unitTermParams('diary'))).toBe('新建日记');
  });

  it('AI 空态整句换掉：问的是空着的日子，不是伏笔与人设卡', () => {
    setLang('zh-CN');
    expect(aiChatEmptyKey('diary')).toBe('writing.aiChatEmptyDay');
    const line = t(aiChatEmptyKey('diary'));
    expect(line).toContain('哪几天空着');
    expect(line).not.toContain('伏笔');
    expect(line).not.toContain('人设卡');
  });

  it('载体落 collection，但名字是「日记集」而不是「篇目集」', () => {
    setLang('zh-CN');
    expect(defaultMediumForGenre('diary')).toBe('collection');
    expect(mediumDef('collection')!.fits).toContain('diary');
    const k = carrierTermKeys('diary', 'collection');
    expect(k.labelKey).toBe('writing.medium.diaryCollection');
    expect(k.descKey).toBe('writing.medium.diaryCollectionDesc');
    expect(t(k.labelKey)).toBe('日记集');
    expect(t(k.descKey)).toContain('年与月');
    // 散文没被牵连：仍是通用载体名
    expect(carrierTermKeys('essay', 'collection').labelKey).toBe('writing.medium.collection');
  });

  it('页签裁掉什么，创建入口就关什么（一张表两张脸）', () => {
    expect(hiddenViewKindsForGenre('diary')).toEqual(['worldview', 'storylines', 'foreshadowing']);
    expect(canCreateEntityForGenre('diary', 'worldview')).toBe(false);
    expect(canCreateEntityForGenre('diary', 'storyline')).toBe(false);
    expect(canCreateEntityForGenre('diary', 'foreshadowing')).toBe(false);
    // 人物与时间线保留：日记里会反复提到人
    expect(canCreateEntityForGenre('diary', 'character')).toBe(true);
  });

  it('合集型三件套：长短不判离群、人设卡非必需、KPI 不说章/卷/场/首', () => {
    setLang('zh-CN');
    expect(isCollectionGenre('diary')).toBe(true);
    expect(outlierMeaninglessForGenre('diary')).toBe(true);
    expect(characterCardsOptionalForGenre('diary')).toBe(true);
    const k = kpiLabelKeys('diary');
    expect(k).toEqual({
      count: 'writing.dayCount',
      countSub: 'editor.writing.stats.kpiDaysSub',
      group: 'editor.writing.stats.kpiMonths',
      groupSub: 'editor.writing.stats.kpiMonthsSub',
      avg: 'editor.writing.stats.kpiAvgDay',
      avgSub: 'editor.writing.stats.kpiAvgDaySub',
    });
    const rendered = Object.values(k).map((key) => t(key)).join(' / ');
    expect(rendered).toContain('日记天数');
    expect(rendered).toContain('日均字数');
    for (const wrong of ['章节', '章长', '卷数', '幕数', '首数', '场数']) {
      expect(rendered, `日记 KPI 不许说${wrong}`).not.toContain(wrong);
    }
  });

  it('分组摘要那句用「天」量：{volume} · 3 天 · 9 字', () => {
    setLang('zh-CN');
    expect(volumeSummaryKey('diary')).toBe('agent.writing.volumeSummaryDay');
    expect(t(volumeSummaryKey('diary'), { volume: '2026年11月', chapters: 3, words: 9 })).toBe('2026年11月 · 3 天 · 9 字');
  });

  it('没有日期字段 ⇒ 不许有行尾结构徽标（李先生这一轮选"先不加"）', () => {
    expect(structureInspectorForGenre('diary')).toBe('');
    expect(structureInspectorForGenre('poetry')).toBe('poem');
    expect(structureInspectorForGenre('script')).toBe('script');
  });

  it('工作台命令有自己一支，不借小说那六条', () => {
    expect(workbenchCommandSet('diary')).toBe('diary');
    expect(workbenchCommandSet('scribble')).toBe('novel');
    expect(workbenchCommandSet(undefined)).toBe('novel');
  });
});

describe('㉒ 日记的结构层', () => {
  it('root 是可写单位「天」，不是容器层「年」', () => {
    expect(defaultRootKind('diary')).toBe('天');
    // 与 ⑲ 的不变式同一条：顶层永远不能是容器层，否则新书统计算 0
    expect(['卷', '幕', '辑', '年', '月']).not.toContain(defaultRootKind('diary'));
  });

  it('建议链是 年 › 月 › 天，加子级一路顺延到「天」', () => {
    const levels = defaultLevels('diary');
    expect(levels).toEqual(['年', '月', '天']);
    expect(suggestedChildKind('年', 0, levels)).toBe('月');
    expect(suggestedChildKind('月', 1, levels)).toBe('天');
    // 链尾之后不再长出第四层
    expect(suggestedChildKind('天', 2, levels)).toBe('天');
  });
});

describe('㉒ 拖源与两栏措辞（那条真漏口）', () => {
  afterEach(() => setLang('zh-CN'));

  it('右栏创作组件拖源不叫「章节」，叫「日记条目」', () => {
    const { groups } = paletteFor('diary', 'catalog');
    const first = groups[0]!.items[0]!;
    expect(first.labelKey).toBe('writingLeft.tplDiaryDay');
    expect(first.descKey).toBe('editor.writing.palette.descDiary');
    expect(t(first.descKey)).toContain('一篇日记');
  });

  it('合集型两栏拿到日记的三个 key，不回落散文', () => {
    setLang('zh-CN');
    const k = collectionPaneKeys('diary');
    expect(k).toEqual({
      pieces: 'writingLeft.tplDiaryDay',
      piecesEmpty: 'writingDesign.emptyDays',
      ideas: 'writingLeft.tplDiaryMatter',
    });
    expect(t(k.pieces)).toBe('日记条目');
    expect(t(k.ideas)).toBe('当日要点');
    // 散文没被漂动
    expect(collectionPaneKeys('essay').pieces).toBe('writingDesign.pane.pieces');
  });

  it('日记货架：单位是日记条目、人物卡给得出、被裁的世界观不许卖', () => {
    const { templates, fallback } = shelfFor('diary');
    expect(fallback).toBe(false);
    expect(templates[0]).toMatchObject({ type: 'writing-chapter', labelKey: 'writingLeft.tplDiaryDay', genre: 'diary' });
    const types = templates.map((x) => x.type);
    expect(types).toContain('writing-character');
    expect(types).not.toContain('writing-worldview');
    expect(templates.every((x) => x.genre === 'diary'), '货架条目要标明自己属于日记体裁').toBe(true);
  });
});

describe('㉒ 语料量词按体裁', () => {
  afterEach(() => setLang('zh-CN'));

  it('日记统计语料说「日记 / 年月 / 日均」，离群空态写"不适用"', () => {
    const { zh } = buildStatsCorpus('', [], [], null, 'diary');
    expect(zh).toContain('日记 0 · 年月 0');
    expect(zh).toContain('日均 0 字');
    expect(zh).toContain('不适用（日记各天长短悬殊属常态');
    for (const wrong of ['章节', '章均', '卷 0']) {
      expect(zh, `日记语料不许说${wrong}`).not.toContain(wrong);
    }
  });

  it('小说语料逐字不变（新增体裁不许漂动历史口径）', () => {
    const { zh } = buildStatsCorpus('', [], []);
    expect(zh).toContain('章节 0 · 卷 0');
    expect(zh).toContain('章均 0 字');
    expect(zh).toContain('〔体量离群〕无');
  });

  it('英文面：日记是 entries / daily，不出现 chapters 与 volumes', () => {
    setLang('en-US');
    const { en } = buildStatsCorpus('', [], [], null, 'diary');
    expect(en).toContain('0 entries');
    expect(en).not.toContain('chapters');
    expect(en).not.toContain('volumes');
    expect(t(unitWordKey('diary'))).toBe('entry');
    expect(t(carrierTermKeys('diary', 'collection').labelKey)).toBe('Journal');
    expect(t('writing.newDayName', { n: 2 })).toBe('Day 2');
  });
});

describe('㉒ 零回归：其余四体裁没被这一刀漂动', () => {
  afterEach(() => setLang('zh-CN'));

  it('默认名 / 徽标 / KPI / 载体 四体裁原样', () => {
    setLang('zh-CN');
    expect([unitNameKey('novel'), unitNameKey('essay'), unitNameKey('poetry'), unitNameKey('script')]).toEqual([
      'writing.newChapterName',
      'writing.newPieceName',
      'writing.newPoemName',
      'writing.newSceneName',
    ]);
    expect(['novel', 'essay', 'poetry', 'script'].map((g) => t(unitShortKey(g)))).toEqual(['章', '篇', '诗', '场']);
    expect(defaultMediumForGenre('novel')).toBe('serial');
    expect(defaultMediumForGenre('essay')).toBe('collection');
    expect(defaultMediumForGenre('poetry')).toBe('collection');
    expect(defaultMediumForGenre('script')).toBe('standalone');
    expect(kpiLabelKeys('script').count).toBe('writing.sceneCount');
    expect(hiddenViewKindsForGenre('script')).toEqual(['worldview']);
    expect(hiddenViewKindsForGenre('novel')).toEqual([]);
    expect(isCollectionGenre('script')).toBe(false);
    expect(outlierMeaninglessForGenre('script')).toBe(false);
    expect(characterCardsOptionalForGenre('script')).toBe(false);
    expect(volumeSummaryKey('')).toBe('agent.writing.volumeSummary');
    expect(WRITING_MEDIUMS.find((m) => m.id === 'standalone')!.fits).toEqual(['novel', 'script']);
  });
});
