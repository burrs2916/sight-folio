/**
 * ㉥ AI-5b（2026-11-10 轮 18）：语料层最后三处「小说单位词」裸字面接上载体
 *
 * 病灶（轮 10 交账时用新证据抓出，轮 17 仍在册；与 ㉞ T-F″ 同一把尺子）：
 *   ① `writingAiCorpus.ts` buildCatalogCorpus —— 「整本还空着」那句写死小说量词的中文成品文案，
 *      且同一枚中文同时喂 zh 与 en 两份语料（㉞ 已为组名修过一次，这两句当时漏网）；
 *   ② 同函数截断那句 —— 一部一首没读完的诗集收到「其余 N 章省略」；
 *   ③ `writingCorpus.ts` buildChapterIndexCorpus —— 注入给模型的索引表**分组列名**恒写小说那一支
 *      （唯一生产消费点 = `writingContextProvider.ts` 的作品概览段）。诗集/剧本/日记本收到这张表，
 *      就等于本仓亲口向它宣布「你有一个卷层」，模型会按「没分卷的书」去铺承接（⑭ 刀C 判过同一个病）。
 *
 * 措辞一条都不新造：全部走 `CORPUS_NOUNS`（⑭ 刀C 入库、㉞ T-F″ 起为唯一入口）。
 * en 侧新增的那一格 `groupCol` 只是「同一张嘴的单数形」，zh 侧单复同形、直接吃现成的 group，
 * 因此**没有第二份量词表**（本文件第 4 条锁把这条边钉死）。
 *
 * 三层锁沿用 ㉞ / ㉡ / ㉣ 的形状：
 *   ① 纯函数层：新格五支在册 + 小说/空/脏值/未传参逐字回落；
 *   ② 真调用层：两个函数各体裁的实际输出对账（含「英文语料不夹汉字」「未分组的书整列消失」）；
 *   ③ 接线层：genre 真的从调用点传下来（AU-7 ⑨：算好了没接到行上 = 白算）+ 裸字面绝迹 +
 *      三个生产文件零体裁字面判断。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import {
  buildChapterIndexCorpus,
  buildInspirationCorpus,
  buildTimelineCorpus,
  capEn,
  corpusNounsFor,
} from '../writingCorpus';
import { buildCatalogCorpus } from '../writingAiCorpus';
import { WRITING_GENRES } from '../writingSchema';
import { useWritingStore } from '../../store/writingStore';
import { writingContextProvider } from '../../ai/providers/writingContextProvider';
import { setLang } from '../../i18n';
import type {
  WritingChapter,
  WritingOutline,
  WritingSetting,
  WritingTimelineEvent,
} from '../../services/tauri';

const cjk = /[\u4e00-\u9fff]/;
const GENRES = ['novel', 'essay', 'poetry', 'script', 'diary'];
/** 未登记 / 空串 / 脏值 / 未传参 —— 四种回落入口（零回归的机制面） */
const FALLBACKS = [undefined, '', 'novel', 'diaryy', 'Novel', 'script '] as const;

/** 剥注释后再扫（AU-7 ⑧：禁令型源码锁会拦在自己写的注释里，本轮提前防住） */
const code = (f: string) =>
  readFileSync(f, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ch = (id: string, volume = '', over: Partial<WritingChapter> = {}): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: id,
    content: '正文',
    sortOrder: 1,
    wordCount: 100,
    status: 'draft',
    volume,
    parentId: null,
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as never;

describe('㉥ 纯函数层 · 分组列名的词表', () => {
  it('新格 groupCol 五支全在册，未登记 / 空 / 脏值 / 未传参逐字回落小说那格', () => {
    for (const g of GENRES) {
      expect(corpusNounsFor(g).en.groupCol, `${g} 的英文列名没登记`).toBeTruthy();
    }
    for (const g of FALLBACKS) {
      expect(corpusNounsFor(g as string).en.groupCol, String(g)).toBe('Volume');
    }
  });

  it('五支英文列名逐字对账（novel 那格 = 改造前表头逐字，零回归线）', () => {
    expect(corpusNounsFor('novel').en.groupCol).toBe('Volume');
    expect(corpusNounsFor('essay').en.groupCol).toBe('Group');
    expect(corpusNounsFor('poetry').en.groupCol).toBe('Group');
    expect(corpusNounsFor('script').en.groupCol).toBe('Act');
    expect(corpusNounsFor('diary').en.groupCol).toBe('Year/month');
    for (const g of GENRES) {
      expect(corpusNounsFor(g).en.groupCol, `${g} 的列名夹了汉字`).not.toMatch(cjk);
    }
  });

  it('列名与 group 是同一张嘴的两个形：en 取单数、zh 单复同形（不许另造第三个词）', () => {
    for (const g of GENRES) {
      const n = corpusNounsFor(g);
      expect(n.en.group.toLowerCase(), `${g} 的列名与分组词分了家`).toContain(n.en.groupCol.toLowerCase());
    }
    // zh 侧**没有**新格：列名就是 group（五支逐字取自现成表，本仓不留第二份）
    expect(corpusNounsFor('novel').zh.group).toBe('卷');
    expect(corpusNounsFor('essay').zh.group).toBe('分组');
    expect(corpusNounsFor('poetry').zh.group).toBe('分组');
    expect(corpusNounsFor('script').zh.group).toBe('幕');
    expect(corpusNounsFor('diary').zh.group).toBe('年月');
  });

  it('schema 在册体裁全覆盖（漏一支 = 该支领到小说列名而无人报错）', () => {
    for (const g of WRITING_GENRES) {
      const n = corpusNounsFor(g.id);
      expect(n.en.groupCol, `${g.id} 未在词表登记`).toBeTruthy();
      expect(n.zh.group, `${g.id} 的中文分组词为空`).toBeTruthy();
    }
  });
});

describe('㉥ 真调用层 · buildCatalogCorpus 的空骨架句', () => {
  const UNIT_ZH: Record<string, string> = {
    novel: '（暂无章节）',
    essay: '（暂无篇目）',
    poetry: '（暂无诗作）',
    script: '（暂无场次）',
    diary: '（暂无日记）',
  };
  const UNIT_EN: Record<string, string> = {
    novel: '(no chapters)',
    essay: '(no pieces)',
    poetry: '(no poems)',
    script: '(no scenes)',
    diary: '(no entries)',
  };

  it('五支各说自己的量词，且骨架段除小说外都不许出现「章」', () => {
    for (const g of GENRES) {
      const c = buildCatalogCorpus([], [], { genre: g });
      expect(c.zh, `${g} 的空骨架那句`).toContain(UNIT_ZH[g]);
      expect(c.en, `${g} 的空骨架英文那句`).toContain(UNIT_EN[g]);
    }
    // ㉧ 轮 20 起这条从「只查骨架段」翻成**整段绝迹锁**：念头池那节标题曾自带「章」字（在册残余），
    // AI-5c 已把它接进词表 ⇒ 现在整份骨架语料都不许再说章。收紧不是削弱（AU-7 铁律）。
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      expect(buildCatalogCorpus([], [], { genre: g }).zh, `${g} 的骨架语料还在说章`).not.toContain('章');
    }
  });

  it('零回归：未传 opts / 空 / 脏体裁 = 改造前两句逐字', () => {
    for (const opts of [undefined, {}, { genre: '' }, { genre: 'noval' }, { genre: 'novel' }]) {
      const c = buildCatalogCorpus([], [], opts);
      expect(c.zh, JSON.stringify(opts)).toContain('（暂无章节）');
      expect(c.en, JSON.stringify(opts)).toContain('(no chapters)');
    }
  });

  it('英文侧任何体裁都不夹汉字（改造前那枚中文成品文案同时喂两份语料）', () => {
    for (const g of [undefined, ...GENRES]) {
      const en = buildCatalogCorpus([], [], { genre: g as string }).en;
      expect(en, `${String(g)} 的英文骨架夹了汉字`).not.toMatch(cjk);
    }
  });
});

describe('㉥ 真调用层 · buildCatalogCorpus 的截断句', () => {
  const LINE_ZH: Record<string, string> = {
    novel: '其余 2 章省略',
    essay: '其余 2 篇省略',
    poetry: '其余 2 首省略',
    script: '其余 2 场省略',
    diary: '其余 2 天省略',
  };
  const LINE_EN: Record<string, string> = {
    novel: 'remaining 2 chapters omitted',
    essay: 'remaining 2 pieces omitted',
    poetry: 'remaining 2 poems omitted',
    script: 'remaining 2 scenes omitted',
    diary: 'remaining 2 entries omitted',
  };
  const three = [ch('c1', ''), ch('c2', ''), ch('c3', '')];

  it('配额照旧（可见 1 + 省略 2），只有量词跟着载体走', () => {
    for (const g of GENRES) {
      const c = buildCatalogCorpus(three, [], { chapterLimit: 1, genre: g });
      expect(c.zh, `${g} 的截断句`).toContain(LINE_ZH[g]);
      expect(c.en, `${g} 的英文截断句`).toContain(LINE_EN[g]);
      expect(c.zh, `${g} 可见那一首没进表`).toContain('c1（');
      expect(c.zh, `${g} 超配额的首仍被列出`).not.toContain('c3（');
    }
  });

  it('零回归：不传 genre 的旧调用形态，截断句逐字 = 改造前', () => {
    const c = buildCatalogCorpus(three, [], { chapterLimit: 1 });
    expect(c.zh).toContain('其余 2 章省略');
    expect(c.en).toContain('remaining 2 chapters omitted');
  });
});

describe('㉥ 真调用层 · buildChapterIndexCorpus 的分组列名', () => {
  const grouped = [ch('c1', '甲组', { sortOrder: 0 }), ch('c2', '', { sortOrder: 1 })];

  it('已分组的书：表头那一列按载体叫各支的名字（zh + en 逐字）', () => {
    const ZH: Record<string, string> = {
      novel: '| 序号 | 卷 | 标题 | 字数 | 状态 |',
      essay: '| 序号 | 分组 | 标题 | 字数 | 状态 |',
      poetry: '| 序号 | 分组 | 标题 | 字数 | 状态 |',
      script: '| 序号 | 幕 | 标题 | 字数 | 状态 |',
      diary: '| 序号 | 年月 | 标题 | 字数 | 状态 |',
    };
    const EN: Record<string, string> = {
      novel: '| # | Volume | Title | Words | Status |',
      essay: '| # | Group | Title | Words | Status |',
      poetry: '| # | Group | Title | Words | Status |',
      script: '| # | Act | Title | Words | Status |',
      diary: '| # | Year/month | Title | Words | Status |',
    };
    for (const g of GENRES) {
      expect(buildChapterIndexCorpus(grouped, g).zh[0], `${g} 的中文表头`).toBe(ZH[g]);
      expect(buildChapterIndexCorpus(grouped, g).en[0], `${g} 的英文表头`).toBe(EN[g]);
    }
  });

  it('零回归：未传参 / 空 / 脏体裁的表头逐字 = 改造前那两枚', () => {
    for (const g of [undefined, '', 'novel', 'diaryy', 'Novel']) {
      expect(buildChapterIndexCorpus(grouped, g as string).zh[0]).toBe('| 序号 | 卷 | 标题 | 字数 | 状态 |');
      expect(buildChapterIndexCorpus(grouped, g as string).en[0]).toBe('| # | Volume | Title | Words | Status |');
    }
  });

  it('未分组的书：五支都不长出这一列（判据未动，只换了措辞）', () => {
    const plain = [ch('c1', ''), ch('c2', '')];
    for (const g of GENRES) {
      const { zh, en } = buildChapterIndexCorpus(plain, g);
      expect(zh[0], `${g} 无分组却印出分组列`).toBe('| 序号 | 标题 | 字数 | 状态 |');
      expect(en[0], `${g} 英文同病`).toBe('| # | Title | Words | Status |');
    }
  });

  it('日记的日期列与分组列共存时列序不变（㉖ 那把尺子未被本轮挤歪）', () => {
    const dated = [
      ch('d1', '2026年11月', { extra: JSON.stringify({ entryDate: '2026-11-08' }) }),
      ch('d2', '2026年11月', { extra: JSON.stringify({ entryDate: '2026-11-09' }) }),
    ];
    expect(buildChapterIndexCorpus(dated, 'diary').zh[0]).toBe('| 序号 | 年月 | 日期 | 标题 | 字数 | 状态 |');
    expect(buildChapterIndexCorpus(dated, 'diary').en[0]).toBe('| # | Year/month | Date | Title | Words | Status |');
    expect(buildChapterIndexCorpus(dated, 'diary').zh.join('\n')).toContain('| 2026-11-08 |');
  });

  it('作者自起的组名原样进表，不被列名口径改写（列名是措辞，格子里是数据）', () => {
    const { zh } = buildChapterIndexCorpus([ch('c1', '上辑', { sortOrder: 0 }), ch('c2', '下辑', { sortOrder: 1 })], 'poetry');
    expect(zh[1]).toBe('| --- | --- | --- | --- | --- |');
    expect(zh[2]).toContain('| 上辑 |');
    expect(zh[3]).toContain('| 下辑 |');
  });

  it('空表仍是无数据提示行（本轮只碰表头，不许碰空态）', () => {
    for (const g of [undefined, ...GENRES]) {
      expect(buildChapterIndexCorpus([], g as string)).toEqual({ zh: ['_无数据_'], en: ['_no data_'] });
    }
  });
});

describe('㉥ 接线层 · genre 真的传到了行上 + 裸字面绝迹', () => {
  const PROVIDER = 'src/ai/providers/writingContextProvider.ts';

  it('索引表全仓只有一个生产调用点，且实参里带着这本书的体裁', () => {
    const src = code(PROVIDER);
    const idx = src.indexOf('buildChapterIndexCorpus(');
    expect(idx, '生产件没找到调用点').toBeGreaterThan(-1);
    expect(src.indexOf('buildChapterIndexCorpus(', idx + 1), '冒出第二个调用点，需逐点核对').toBe(-1);
    const argsWindow = src.slice(idx, src.indexOf('\n', src.indexOf(')', idx)));
    expect(argsWindow, '算了 genre 却没接到行上（AU-7 ⑨）').toMatch(/genre/);
  });

  it('新格有生产消费点（不是又一张只被测试吃的表）', () => {
    const src = code('src/utils/writingCorpus.ts');
    expect(src).toMatch(/headersEn[\s\S]{0,120}nouns\.en\.groupCol/);
    expect(src).toMatch(/headersZh[\s\S]{0,120}nouns\.zh\.group/);
  });

  it('三处裸字面绝迹：空骨架句、截断句、表头数组里的小说量词', () => {
    const ai = code('src/utils/writingAiCorpus.ts');
    expect(ai, '空骨架那句又写回裸字面').not.toContain("'（暂无章节）'");
    expect(ai, '截断那句又写回裸量词').not.toMatch(/\}\s*章省略/);
    const corpus = code('src/utils/writingCorpus.ts');
    expect(corpus, '表头又长出裸列名').not.toMatch(/\?\s*\[\s*'卷'\s*\]/);
    expect(corpus, '英文表头又长出裸列名').not.toMatch(/\?\s*\[\s*'Volume'\s*\]/);
  });

  it('三个生产文件零体裁字面判断（判据单一真源 = writingSchema / 词表下标）', () => {
    for (const f of ['src/utils/writingCorpus.ts', 'src/utils/writingAiCorpus.ts', PROVIDER]) {
      expect(code(f), `${f} 长出 genre 字面量判断`).not.toMatch(/genre\s*===\s*'/);
    }
  });

  it('骨架语料的两处生产调用仍带 genre（㉞ 那把锁未被子轮削掉）', () => {
    for (const f of ['src/pages/writingPage/useAiActions.ts', 'src/editor/panels/workbenchPanelHooks.ts']) {
      const src = code(f);
      const idx = src.indexOf('buildCatalogCorpus(');
      expect(idx, `${f} 没找到调用点`).toBeGreaterThan(-1);
      expect(src.slice(idx, src.indexOf('\n', src.indexOf(')', idx))), `${f} 的调用没传 genre`).toMatch(/genre/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ㉧ AI-5c（2026-11-10 轮 20）：注入链最后一批小说腔
//
// 病灶（轮 18 交账时抓出，逐条按磁盘复核）：
//   ① buildTimelineCorpus 的空骨架句 —— 中文写死「（暂无章节）」、英文写死 `(no chapters yet)`，
//      且该函数**连 genre 位都没有**；
//   ② 同函数 未绑章 / 绑章： / ; chapter: ；
//   ②′ 同函数 冲突行的 `章：` 与节题【章节骨架】/ `[Chapter skeleton]`
//      （轮 18 台账只点了 ①②，本轮按「同一张嘴必须同轮翻」把同函数同屏的两处一并收，
//        否则诗集这一屏会一半叫「诗作骨架」、一半叫「章」）；
//   ③ buildInspirationCorpus 的「未落章节拍」与「分发去向：挂章」；
//   ④ buildCatalogCorpus 的节题【未落章节拍（念头池）】（en 侧本无单位词 → 无物可换、不加格）；
//   ⑤ provider 概览段「章节数 / ## 章节列表 / N 章，共 M 字」+ 念头池节 summary「条未落章念头」
//      —— 与轮 18 刚修的索引表列名是**同一屏的上下两张嘴**。
//
// 判据（哪些事件算未绑、冲突怎么并、配额多少）一格未动，本轮只换措辞；
// 词全部走 CORPUS_NOUNS（⑭ 刀C 入库、㉞ T-F″ 起唯一入口），零新表、零新判据、零依赖。
// ─────────────────────────────────────────────────────────────────────────

const UNANCH: Record<string, string> = {
  novel: '未落章节拍',
  essay: '未落篇目',
  poetry: '未落诗作',
  script: '未落场次',
  diary: '未落日记',
};
const UNIT_ZH: Record<string, string> = { novel: '章节', essay: '篇目', poetry: '诗作', script: '场次', diary: '日记' };
const LINE_ZH: Record<string, string> = { novel: '章', essay: '篇', poetry: '首', script: '场', diary: '天' };
const UNIT_EN: Record<string, string> = {
  novel: 'chapters',
  essay: 'pieces',
  poetry: 'poems',
  script: 'scenes',
  diary: 'entries',
};
const ONE_EN: Record<string, string> = {
  novel: 'chapter',
  essay: 'piece',
  poetry: 'poem',
  script: 'scene',
  diary: 'entry',
};
const BIND_EN: Record<string, string> = {
  novel: 'a chapter',
  essay: 'a piece',
  poetry: 'a poem',
  script: 'a scene',
  diary: 'an entry',
};

const tev = (id: string, at: string, over: Partial<WritingTimelineEvent> = {}): WritingTimelineEvent =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at,
    timeKey: null,
    event: `事件${id}`,
    chapterId: null,
    storylineId: null,
    outlineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as never;

const tset = (id: string, name: string): WritingSetting =>
  ({
    id,
    bookId: 'b1',
    kind: 'character',
    name,
    subtitle: '',
    description: '',
    extra: '{}',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as never;

const beat = (id: string, title: string, chapterId: string | null, summary = ''): WritingOutline =>
  ({ id, bookId: 'b1', title, summary, chapterId, extra: '{}', sortOrder: 0, createdAt: 0, updatedAt: 0 }) as never;

describe('㉧ 纯函数层 · AI-5c 新登记的三格 + capEn', () => {
  it('zh.unanchored / en.unitOne / en.bindTo 五支全在册', () => {
    for (const g of GENRES) {
      const n = corpusNounsFor(g);
      expect(n.zh.unanchored, `${g} 的 unanchored 未登记`).toBe(UNANCH[g]);
      expect(n.en.unitOne, `${g} 的 unitOne 未登记`).toBe(ONE_EN[g]);
      expect(n.en.bindTo, `${g} 的 bindTo 未登记`).toBe(BIND_EN[g]);
    }
  });

  it('未登记 / 空串 / 脏值 / 未传参 —— 四种入口逐字回落小说那格（零回归的机制面）', () => {
    for (const g of FALLBACKS) {
      const n = corpusNounsFor(g as string);
      expect(n.zh.unanchored, String(g)).toBe('未落章节拍');
      expect(n.en.unitOne, String(g)).toBe('chapter');
      expect(n.en.bindTo, String(g)).toBe('a chapter');
    }
  });

  it('冠词跟着首音走：日记是 an entry，机械拼 "a " 会写出 a entry', () => {
    expect(corpusNounsFor('diary').en.bindTo).toBe('an entry');
    expect(corpusNounsFor('diary').en.unitOne).toBe('entry');
    for (const g of ['novel', 'essay', 'poetry', 'script']) {
      expect(corpusNounsFor(g).en.bindTo, `${g} 的冠词`).toBe(`a ${ONE_EN[g]}`);
    }
  });

  it('capEn 只做正字法：派生出的大写形逐字 = 改造前那三枚裸字面（不再登记 unitCap/unitOneCap）', () => {
    expect(capEn(corpusNounsFor('novel').en.unit)).toBe('Chapters');
    expect(capEn(corpusNounsFor('novel').en.unitOne)).toBe('Chapter');
    // 五支的「行标签 / 表头」写法都由表派生，不留第二种拼法
    for (const g of GENRES) {
      const n = corpusNounsFor(g);
      expect(capEn(n.en.unit), `${g} 的行标签`).toBe(`${ONE_EN[g][0].toUpperCase()}${n.en.unit.slice(1)}`);
      expect(capEn(n.en.unitOne)).toBe(`${ONE_EN[g][0].toUpperCase()}${ONE_EN[g].slice(1)}`);
      expect(capEn(n.en.unitOne)).not.toMatch(cjk);
    }
    expect(capEn('')).toBe('');
  });

  it('schema 在册体裁全覆盖；en 三格一律不夹汉字', () => {
    for (const g of WRITING_GENRES) {
      const n = corpusNounsFor(g.id);
      expect(n.zh.unanchored, `${g.id} 的 zh.unanchored 为空`).toBeTruthy();
      expect(n.en.unitOne, `${g.id} 的 en.unitOne 为空`).toBeTruthy();
      expect(n.en.bindTo, `${g.id} 的 en.bindTo 为空`).toBeTruthy();
      expect(`${n.en.unitOne}${n.en.bindTo}`, `${g.id} 的 en 格夹了汉字`).not.toMatch(cjk);
    }
  });
});

describe('㉧ 真调用层 · buildTimelineCorpus', () => {
  const one = [ch('c1', '', { sortOrder: 0, kind: '', title: '甲' })];

  it('空骨架句五支各说自己的量词（zh 吃 unit、en 吃 unit 复数 + 保留原有的 yet）', () => {
    for (const g of GENRES) {
      const { zh, en } = buildTimelineCorpus('b1', [], [], [], [], { genre: g });
      expect(zh, `${g} 的空骨架`).toContain(`（暂无${UNIT_ZH[g]}）`);
      expect(en, `${g} 的英文空骨架`).toContain(`(no ${UNIT_EN[g]} yet)`);
    }
  });

  it('节题【X骨架】/ [X skeleton] 五支逐字（novel = 改造前逐字）', () => {
    const ZH: Record<string, string> = {
      novel: '【章节骨架】',
      essay: '【篇目骨架】',
      poetry: '【诗作骨架】',
      script: '【场次骨架】',
      diary: '【日记骨架】',
    };
    const EN: Record<string, string> = {
      novel: '[Chapter skeleton]',
      essay: '[Piece skeleton]',
      poetry: '[Poem skeleton]',
      script: '[Scene skeleton]',
      diary: '[Entry skeleton]',
    };
    for (const g of GENRES) {
      const { zh, en } = buildTimelineCorpus('b1', [], one, [], [], { genre: g });
      expect(zh, `${g} 的中文节题`).toContain(ZH[g]);
      expect(en, `${g} 的英文节题`).toContain(EN[g]);
    }
  });

  it('绑X：/ 未绑X / ; x: 三处按支换词，事件文本与配额一字未动', () => {
    const events = [tev('e1', '第一时点', { chapterId: 'c1' }), tev('e2', '第二时点', { chapterId: 'nope' })];
    for (const g of GENRES) {
      const { zh, en } = buildTimelineCorpus('b1', events, one, [tset('s1', '主角')], [], { genre: g });
      expect(zh, `${g} 的绑定位`).toContain(`；绑${LINE_ZH[g]}：甲`);
      expect(zh, `${g} 的未绑定位`).toContain(`未绑${LINE_ZH[g]}`);
      expect(en, `${g} 的英文绑定位`).toContain(`; ${ONE_EN[g]}: 甲`);
      expect(en, `${g} 的英文未绑位仍是不带单位词的 unbound`).toContain('unbound');
      expect(zh, `${g} 丢了事件原文`).toContain('[第一时点] 事件e1');
    }
  });

  it('冲突行那一枚「章：」同样按支（与绑章同一张嘴）', () => {
    const events = [
      tev('e1', '同一天', { chapterId: 'c1' }),
      tev('e2', '同一天', { chapterId: 'c1', event: '事件e2' }),
    ];
    for (const g of GENRES) {
      const { zh, en } = buildTimelineCorpus('b1', events, one, [], [], { genre: g });
      expect(zh, `${g} 的冲突行`).toContain(`（${LINE_ZH[g]}：甲）`);
      expect(en, `${g} 的英文冲突行`).toContain(`(${ONE_EN[g]}: 甲)`);
    }
  });

  it('零回归：未传 opts / 空 / 脏体裁 —— 六枚字面逐字 = 改造前', () => {
    const empty = buildTimelineCorpus('b1', [], [], [], []);
    expect(empty.zh).toContain('【章节骨架】（暂无章节）');
    expect(empty.en).toContain('[Chapter skeleton] (no chapters yet)');
    const events = [tev('e1', '第一时点', { chapterId: 'c1' }), tev('e2', '同一天', { chapterId: 'c1' }), tev('e3', '同一天', { chapterId: 'nope' })];
    for (const opts of [undefined, {}, { genre: '' }, { genre: 'noval' }, { genre: 'novel' }]) {
      const { zh, en } = buildTimelineCorpus('b1', events, one, [], [], opts as { genre?: string });
      expect(zh, JSON.stringify(opts)).toContain('【章节骨架】');
      expect(zh, JSON.stringify(opts)).toContain('；绑章：甲');
      expect(zh, JSON.stringify(opts)).toContain('未绑章');
      expect(en, JSON.stringify(opts)).toContain('[Chapter skeleton]');
      expect(en, JSON.stringify(opts)).toContain('; chapter: 甲');
    }
  });

  it('四种非小说载体：整份语料再无「章」字；英文那份不夹汉字（数据位全 ASCII，作者填的不算措辞）', () => {
    // 标题/设定名/事件文本一律留 ASCII：中文数据进英文语料是**数据原样透传**（轮 18 同一取舍），
    // 拿它当「措辞夹了汉字」报红会是假红。
    const ascii = [ch('c1', '', { sortOrder: 0, kind: '', title: 'A1' })];
    const events = [tev('e1', 'T1', { chapterId: 'c1', event: 'evt1' }), tev('e2', 'T2', { chapterId: 'nope', event: 'evt2' })];
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      const { zh, en } = buildTimelineCorpus('b1', events, ascii, [tset('s1', 'Lead')], [], { genre: g });
      expect(zh, `${g} 的语料还说章`).not.toContain('章');
      expect(en, `${g} 的英文语料夹了汉字`).not.toMatch(cjk);
    }
  });
});

describe('㉧ 真调用层 · 念头池的两枚节题与分发去向', () => {
  const beats = [beat('o1', '怀表', null, '雨夜出现的那块表')];

  it('buildInspirationCorpus：未落X + 挂X + en bind to <a/an unit> 五支逐字', () => {
    for (const g of GENRES) {
      const { zh, en } = buildInspirationCorpus('b1', beats, [], [], g);
      expect(zh, `${g} 的念头定义`).toContain(`灵感收件箱=${UNANCH[g]}，`);
      expect(zh, `${g} 的去向`).toContain(`分发去向：挂${LINE_ZH[g]}/转时间线/转伏笔`);
      expect(en, `${g} 的英文去向`).toContain(`dispatch = bind to ${BIND_EN[g]} / timeline draft`);
      expect(zh, `${g} 丢了念头原文`).toContain('雨夜出现的那块表');
    }
  });

  it('buildCatalogCorpus 节题五支逐字；novel 那支 = 改造前【未落章节拍（念头池）】', () => {
    for (const g of GENRES) {
      const c = buildCatalogCorpus([], [], { genre: g });
      expect(c.zh, `${g} 的节题`).toContain(`【${UNANCH[g]}（念头池）】`);
    }
    for (const opts of [undefined, {}, { genre: '' }, { genre: 'poetyr' }]) {
      expect(buildCatalogCorpus([], [], opts).zh).toContain('【未落章节拍（念头池）】');
    }
  });

  it('零回归：不传体裁的旧调用形态，念头池那段逐字 = 改造前整串', () => {
    const { zh, en } = buildInspirationCorpus('b1', beats, [], []);
    expect(zh).toContain(
      '（念头=作者手记的灵感收件箱=未落章节拍，脑暴时尊重已有念头的语气与题材；分发去向：挂章/转时间线/转伏笔，标记〔已入…〕的不要重复建议）',
    );
    expect(en).toContain('dispatch = bind to a chapter / timeline draft / foreshadowing draft');
  });

  it('四种非小说载体：念头池整段语料再无「章」字', () => {
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      expect(buildInspirationCorpus('b1', beats, [], [], g).zh, `${g} 还在说章`).not.toContain('章');
      expect(buildCatalogCorpus([], [], { genre: g }).zh, `${g} 的骨架语料还在说章`).not.toContain('章');
    }
  });
});

describe('㉧ 真调用层 · provider 概览段（与轮 18 那张索引表同屏的第二张嘴）', () => {
  const PB = 'pb1';
  const pack = (genre: string) => {
    useWritingStore.setState({
      books: [
        {
          id: PB,
          title: '载体之书',
          description: '',
          genre,
          medium: '',
          status: 'draft',
          coverColor: '#4A338F',
          dailyGoal: 0,
          extra: '{}',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      activeBookId: PB,
      activeChapterId: null,
      activeSettingId: null,
      chapters: [ch('pc1', '', { sortOrder: 0, kind: '', title: '甲', wordCount: 120 }), ch('pc2', '', { sortOrder: 1, kind: '', title: '乙', wordCount: 80 })],
      settings: [],
      outlines: [],
      timelineEvents: [],
      storylines: [],
      foreshadowings: [],
    });
    return writingContextProvider.buildPack(PB, { now: 5000 })!;
  };
  const sec = (p: ReturnType<typeof pack>, key: string) => p.sections.find((s) => s.key === key)!;

  afterEach(() => setLang('zh-CN'));

  it('诗集：概览段三句 + 索引表列名同轮换词（不许一屏两张嘴）', () => {
    const p = pack('poetry');
    const ov = sec(p, 'book-overview');
    expect(ov.content).toContain('- 诗作数：2');
    expect(ov.content).toContain('## 诗作列表');
    expect(ov.summary).toBe('载体之书：2 首，共 200 字');
    expect(ov.content, '索引表列名与概览段分了家').toContain('| 序号 | 标题 | 字数 | 状态 |');
    expect(ov.content, '概览段还是小说腔').not.toContain('章节');
    expect(sec(p, 'inspirations').summary).toBe('0 条未落首念头');
    expect(sec(p, 'timeline-storylines').content).toContain('【诗作骨架】1. 甲 2. 乙');
  });

  it('零回归：未设体裁的书（genre 空串）三句逐字 = 改造前', () => {
    const p = pack('');
    const ov = sec(p, 'book-overview');
    expect(ov.content).toContain('- 章节数：2');
    expect(ov.content).toContain('## 章节列表');
    expect(ov.summary).toBe('载体之书：2 章，共 200 字');
    expect(sec(p, 'inspirations').summary).toBe('0 条未落章念头');
    expect(sec(p, 'timeline-storylines').content).toContain('【章节骨架】');
  });

  it('英文界面：Poems / Poem List / poems 与索引表同源，且不是简单加 s 的那类错形', () => {
    setLang('en-US');
    const p = pack('poetry');
    const ov = sec(p, 'book-overview');
    expect(ov.content).toContain('- Poems：2');
    expect(ov.content).toContain('## Poem List');
    expect(ov.summary).toBe('载体之书: 2 poems, 200 words');
    expect(ov.content).not.toContain('| Volume |');
  });

  it('日记的英文行标签是 Entries（复数）、表头是 Entry List（单数）——两形都由表派生', () => {
    setLang('en-US');
    const ov = sec(pack('diary'), 'book-overview');
    expect(ov.content).toContain('- Entries：2');
    expect(ov.content).toContain('## Entry List');
  });
});

describe('㉧ 接线层 · 四个调用点都带体裁 + 裸字面绝迹', () => {
  const PROVIDER = 'src/ai/providers/writingContextProvider.ts';
  const HOOKS = 'src/editor/panels/workbenchPanelHooks.ts';

  const callArgWindow = (src: string, fn: string) => {
    const idx = src.indexOf(`${fn}(`);
    expect(idx, `生产件没找到 ${fn} 调用点`).toBeGreaterThan(-1);
    return src.slice(idx, src.indexOf('\n', src.indexOf(')', idx)));
  };

  it('buildTimelineCorpus 的两个生产调用点，实参里都带着这本书的体裁（AU-7 ⑨）', () => {
    for (const f of [PROVIDER, HOOKS]) {
      const src = code(f);
      const win = callArgWindow(src, 'buildTimelineCorpus');
      expect(win, `${f} 算了 genre 却没接到行上`).toMatch(/genre/);
    }
    expect(code(HOOKS).split('buildTimelineCorpus(').length - 1).toBe(1);
  });

  it('buildInspirationCorpus 的两个生产调用点同样带体裁', () => {
    for (const f of [PROVIDER, HOOKS]) {
      expect(callArgWindow(code(f), 'buildInspirationCorpus'), `${f} 的调用没传 genre`).toMatch(/genre/);
    }
  });

  /**
   * **函数体窗口**取源码（不是整文件）：本轮只清了队首那五处，同文件里
   * `buildManuscriptCorpus`（〔章节骨架〕/〔当前章〕/「共 N 章」）与 AI 分析预设 prompt
   * （「请对照人设卡逐条检查当前章节正文」等 20+ 条）仍在册 —— 那是 AI-5d 的活。
   * 整文件级禁令会把那片范围外的红算到本刀头上，逼下一轮一把梭改二十句（轮 3 的教训同一族）。
   */
  const fnBody = (file: string, fn: string) => {
    const src = code(file);
    const from = src.indexOf(`export function ${fn}(`);
    expect(from, `${file} 里找不到 ${fn}`).toBeGreaterThan(-1);
    const next = src.indexOf('\nexport function ', from + 1);
    return next === -1 ? src.slice(from) : src.slice(from, next);
  };
  const win = (file: string, a: string, b: string) => {
    const src = code(file);
    const from = src.indexOf(a);
    const to = src.indexOf(b, from + 1);
    expect(from, `${file} 里找不到锚点 A`).toBeGreaterThan(-1);
    expect(to, `${file} 里找不到锚点 B`).toBeGreaterThan(from);
    return src.slice(from, to);
  };

  it('裸字面绝迹：本轮清掉的每一枚在**它所在的那段代码**里必须归零', () => {
    const tl = fnBody('src/utils/writingCorpus.ts', 'buildTimelineCorpus');
    for (const b of ['未绑章', '（暂无章节）', '(no chapters yet)', '；绑章：', '章：', '【章节骨架】', '[Chapter skeleton]', '; chapter: ']) {
      expect(tl, `时间线档案又长回裸字面 ${b}`).not.toContain(b);
    }
    const ins = fnBody('src/utils/writingCorpus.ts', 'buildInspirationCorpus');
    for (const b of ['未落章节拍', '挂章']) {
      expect(ins, `念头池又长回裸字面 ${b}`).not.toContain(b);
    }
    const cat = fnBody('src/utils/writingAiCorpus.ts', 'buildCatalogCorpus');
    expect(cat, '骨架节题又长回那枚裸字面').not.toContain('未落章节拍');
    const ov = win(PROVIDER, 'const overviewLines', 'const overview = makeSection(');
    for (const b of ['章节数', '章节列表', '章，共']) expect(ov, `概览段又长回裸字面 ${b}`).not.toContain(b);
    const isec = win(PROVIDER, 'const inspirationSection = makeSection(', 'corpusLines(buildInspirationCorpus(');
    expect(isec, '念头池节 summary 又长回裸字面').not.toContain('未落章念头');
    // 词表是小说那格的唯一存放点：**剥注释后**全文件只准出现一次
    // （AU-7 ⑧：本轮注释里举了两次反例，整文件裸计数会被自己的注释顶红）
    expect(code('src/utils/writingCorpus.ts').split('未落章节拍').length - 1).toBe(1);
  });

  it('四个生产文件零体裁字面判断（判据单一真源 = writingSchema / 词表下标）', () => {
    for (const f of ['src/utils/writingCorpus.ts', 'src/utils/writingAiCorpus.ts', PROVIDER, HOOKS]) {
      expect(code(f), `${f} 长出 genre 字面量判断`).not.toMatch(/genre\s*===\s*'/);
    }
  });

  it('新格有生产消费点（不是又一张只被测试吃的表）', () => {
    const corpus = code('src/utils/writingCorpus.ts');
    expect(corpus).toMatch(/nouns\.zh\.unanchored/);
    expect(corpus).toMatch(/nouns\.en\.unitOne/);
    expect(corpus).toMatch(/nouns\.en\.bindTo/);
    expect(code('src/utils/writingAiCorpus.ts')).toMatch(/nouns\.zh\.unanchored/);
    const prov = code(PROVIDER);
    expect(prov).toMatch(/corpusNounsFor\(book\.genre/);
    expect(prov).toMatch(/capEn\(nouns\.en\.unit\)/);
    expect(prov).toMatch(/capEn\(nouns\.en\.unitOne\)/);
  });
});
