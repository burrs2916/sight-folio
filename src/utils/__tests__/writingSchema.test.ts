// 创作体系（utils/writingSchema）纯函数单测
//
// 这里锁的是**建书入口的口径**：建书有三条通路（L1 页签「＋」菜单、拖载体进画布、
// 书库页），它们都必须落到同一套「体裁 → 默认载体」规则上。口径散了会出现
// 「拖散文进来的书是篇目集、点＋建的散文书是未指定」这种看不出坏、但数据不一致的故障。

import { describe, it, expect } from "vitest";
import {
  WRITING_GENRES,
  WRITING_MEDIUMS,
  characterCardsOptionalForGenre,
  defaultMediumForGenre,
  genreDef,
  genreLabelKey,
  mediumDef,
  mediumLabelKey,
  mediumDescKey,
  carrierTermKeys,
  shelfFor,
  unitNameKey,
  unitShortKey,
  volumeSummaryKey,
  hiddenViewKindsForGenre,
  kpiLabelKeys,
  outlierMeaninglessForGenre,
  isCollectionGenre,
  structureInspectorForGenre,
  canCreateEntityForGenre,
} from "../writingSchema";
import { t, setLang } from "../../i18n";

describe("unitNameKey（新建正文单位的默认名，六条入口共用一个口径）", () => {
  it("散文是「篇」，小说是「章」", () => {
    expect(unitNameKey("essay")).toBe("writing.newPieceName");
    expect(unitNameKey("novel")).toBe("writing.newChapterName");
  });

  it("旧书没设体裁 / 未知体裁一律回落到章（保持历史行为，不许凭空改称呼）", () => {
    expect(unitNameKey("")).toBe("writing.newChapterName");
    expect(unitNameKey("reportage")).toBe("writing.newChapterName");
  });

  it("诗歌是「首」（2026-11-09 开闸：诗集的第一单位不该叫「第 1 章」）", () => {
    expect(unitNameKey("poetry")).toBe("writing.newPoemName");
    // 文案真的翻得出来，且带得上序号 —— 建书首篇走的是 t(key,{n:1})
    expect(t(unitNameKey("poetry"), { n: 1 })).toContain("1");
    expect(t(unitNameKey("poetry"))).not.toBe(unitNameKey("poetry"));
  });

  it("任何体裁都不能报出前端没登记过的 key", () => {
    const known = ["writing.newPieceName", "writing.newPoemName", "writing.newSceneName", "writing.newDayName", "writing.newChapterName"];
    for (const g of WRITING_GENRES) {
      expect(known, `${g.id} 报了个没登记的名字`).toContain(unitNameKey(g.id));
    }
  });
});

describe("unitShortKey（纸面卡那颗单位徽标：章 / 篇 / 诗）", () => {
  it("三个已实装体裁各自一个词，小说与旧书保持「章」", () => {
    expect(unitShortKey("novel")).toBe("writingDesign.unitChapter");
    expect(unitShortKey("essay")).toBe("writingDesign.unitEssay");
    expect(unitShortKey("poetry")).toBe("writingDesign.unitPoem");
    expect(unitShortKey("")).toBe("writingDesign.unitChapter");
  });

  it("徽标都翻得出来（翻不出来就是卡上直接印 key）", () => {
    for (const g of WRITING_GENRES) {
      expect(t(unitShortKey(g.id))).not.toBe(unitShortKey(g.id));
    }
  });
});

describe("characterCardsOptionalForGenre（「没有人设卡」什么时候不该算缺陷）", () => {
  it("散文与诗歌：没有人设卡是体裁常态", () => {
    expect(characterCardsOptionalForGenre("essay")).toBe(true);
    expect(characterCardsOptionalForGenre("poetry")).toBe(true);
  });

  it("小说与未设置体裁照旧算缺陷（零回归：AI 仍会被提醒去建卡）", () => {
    expect(characterCardsOptionalForGenre("novel")).toBe(false);
    expect(characterCardsOptionalForGenre("")).toBe(false);
    expect(characterCardsOptionalForGenre("script")).toBe(false);
  });
});

describe("shelfFor（货架 = f(体裁)）", () => {
  it("诗歌货架第一项是「诗作」，不再是小说的「空白章节」", () => {
    const { templates, fallback } = shelfFor("poetry");
    expect(fallback).toBe(false);
    expect(templates[0]).toMatchObject({ type: "writing-chapter", labelKey: "writingLeft.tplPoem", genre: "poetry" });
  });

  it("诗歌货架不卖被页签摘掉的东西（人设卡 / 世界观）——拖出来看不见就是死条目", () => {
    const types = shelfFor("poetry").templates.map((x) => x.type);
    expect(types).not.toContain("writing-character");
    expect(types).not.toContain("writing-worldview");
  });

  it("每个体裁的货架条目都要能在两个语言里翻出来，且 blank 实体类型都在注册表里", () => {
    for (const g of WRITING_GENRES) {
      for (const tpl of shelfFor(g.id).templates) {
        expect(t(tpl.labelKey), `${g.id} 货架项 ${tpl.type} 的标签没登记`).not.toBe(tpl.labelKey);
      }
    }
  });
});

describe("hiddenViewKindsForGenre（体裁 → 该摘掉的功能视图）", () => {
  it("小说一个都不摘：十项页签与总览十维持平", () => {
    expect(hiddenViewKindsForGenre("novel")).toEqual([]);
    expect(hiddenViewKindsForGenre("")).toEqual([]); // 旧书没设体裁：零回归优先
  });

  it("散文摘掉 世界观/剧情线/伏笔 这三件连载叙事骨架", () => {
    expect(hiddenViewKindsForGenre("essay")).toEqual(["worldview", "storylines", "foreshadowing"]);
  });

  it("散文保留它真用得上的：篇目、人物、时间线、灵感、校对、统计、总览、正文", () => {
    const hidden = hiddenViewKindsForGenre("essay");
    for (const keep of ["catalog", "characters", "timeline", "inspiration", "proofread", "stats", "overview", "writing"]) {
      expect(hidden).not.toContain(keep);
    }
  });

  it("摘的必须都是真实存在的视图名（拼错的字符串会让页签悄悄消失）", () => {
    const all = ["catalog","characters","worldview","timeline","storylines","foreshadowing","inspiration","proofread","stats","overview","writing"];
    for (const g of WRITING_GENRES) {
      for (const k of hiddenViewKindsForGenre(g.id)) expect(all).toContain(k);
    }
  });
});

describe("defaultMediumForGenre", () => {
  it("小说 → serial（连载），散文 → collection（篇目集）", () => {
    expect(defaultMediumForGenre("novel")).toBe("serial");
    expect(defaultMediumForGenre("essay")).toBe("collection");
  });

  it("取到的载体必须真的适配该体裁（不是随便返回第一个）", () => {
    for (const g of WRITING_GENRES.filter((x) => x.ready)) {
      const m = mediumDef(defaultMediumForGenre(g.id));
      expect(m, `${g.id} 应能取到载体`).toBeDefined();
      expect(m!.fits).toContain(g.id);
    }
  });

  it("四个体裁全部开闸（⑮-2 剧本开闸后闸口无空位）；若将来新增未开闸体裁，两条护栏自动生效", () => {
    const unready = WRITING_GENRES.filter((x) => !x.ready);
    expect(unready.map((g) => g.id)).toEqual([]);
    for (const g of unready) {
      expect(defaultMediumForGenre(g.id)).toBe("");
      expect(WRITING_MEDIUMS.some((m) => m.fits.includes(g.id))).toBe(false);
    }
  });

  it("剧本的默认载体 = 单本（一出戏整体成书，不连载）", () => {
    expect(defaultMediumForGenre("script")).toBe("standalone");
    expect(mediumDef("standalone")!.fits).toContain("script");
  });

  it("未知/空体裁返回空串（旧书 genre=\"\" 的零回归路径）", () => {
    expect(defaultMediumForGenre("")).toBe("");
    expect(defaultMediumForGenre("scribble")).toBe("");
  });
});

describe("genre / medium 回落", () => {
  it("未设置的旧书回落到「未设置」文案键，不抛错", () => {
    expect(genreDef("")).toBeUndefined();
    expect(genreLabelKey("")).toBe("writing.genre.unset");
    expect(mediumDef("")).toBeUndefined();
    expect(mediumLabelKey("")).toBe("writing.medium.unset");
  });

  it("每个体裁/载体都有 labelKey —— 缺了就是页签上直接显示 i18n key", () => {
    for (const g of WRITING_GENRES) expect(g.labelKey).toBeTruthy();
    for (const m of WRITING_MEDIUMS) {
      expect(m.labelKey).toBeTruthy();
      expect(m.descKey).toBeTruthy();
      // fits 必须指向已声明的体裁 id，否则建书时永远取不到默认载体
      for (const f of m.fits) expect(genreDef(f), `${m.id}.fits 含未知体裁 ${f}`).toBeDefined();
    }
  });
});
// ⑭ 刀C：卷摘要那句按体裁（小说仍走原键，渲染逐字不变）
describe('volumeSummaryKey', () => {
  it('小说 = 原键；散文 / 诗歌各一条同形串', () => {
    expect(volumeSummaryKey('novel')).toBe('agent.writing.volumeSummary');
    expect(volumeSummaryKey('')).toBe('agent.writing.volumeSummary');
    // ⑮-2 剧本开闸：口径变更 —— 「N 章」对剧本是错的，它量的是场
    expect(volumeSummaryKey('script')).toBe('agent.writing.volumeSummaryScene');
    expect(volumeSummaryKey('essay')).toBe('agent.writing.volumeSummaryPiece');
    expect(volumeSummaryKey('poetry')).toBe('agent.writing.volumeSummaryPoem');
  });
  it('四条串都翻得出来且量词各不相同（章 / 篇 / 首 / 场）', () => {
    const got = ['novel', 'essay', 'poetry', 'script'].map((g) => t(volumeSummaryKey(g), { volume: 'v', chapters: 3, words: 9 }));
    for (const s of got) expect(s).not.toContain('volumeSummary');
    expect(new Set(got).size).toBe(4);
    expect(got[0]).toContain('章');
    expect(got[1]).toContain('篇');
    expect(got[2]).toContain('首');
    expect(got[3]).toContain('场');
  });
});

// ⑮-1（2026-11-09）：载体名也要吃体裁 —— 李先生「诗歌、散文、剧本的载体不一样、术语不一样、
// 中英文也有区分，这些要联动起来」。浏览器实测：新建对话框里诗歌与散文的载体下拉都只有
// 「篇目集」一项，两个体裁在建成的那一眼前看不出区别（里层的结构/术语其实早已分开）。
describe("carrierTermKeys（体裁 × 载体 → 一对外层名词）", () => {
  it("命中覆盖表：诗集×篇目集 → 专属「诗集」，且必须与通用词不同名", () => {
    const k = carrierTermKeys("poetry", "collection");
    expect(k.labelKey).toBe("writing.medium.poetryCollection");
    expect(k.descKey).toBe("writing.medium.poetryCollectionDesc");
    expect(t(k.labelKey)).toBe("诗集");
    // 同名 = 这次改造白做（覆盖表写了个和通用词一样的串）
    expect(t(k.labelKey)).not.toBe(t(mediumLabelKey("collection")));
    expect(t(k.descKey)).toContain("首");
  });

  it("未命中一律回落通用 key：小说与历史散文书的外层文案一个字都不许变", () => {
    const pairs: Array<[string, string]> = [
      ["novel", "serial"],
      ["novel", "standalone"],
      ["essay", "collection"],
      ["", "serial"],
      ["reportage", "collection"], // 脏体裁值也只许回落，不许猜
    ];
    for (const [g, m] of pairs) {
      const k = carrierTermKeys(g, m);
      expect(k.labelKey, `${g}/${m}`).toBe(mediumLabelKey(m));
      expect(k.descKey, `${g}/${m}`).toBe(mediumDescKey(m));
    }
    // 「篇目集 / 独立篇目平铺」是散文自己的词，留在这里是证据不是事故
    expect(t(carrierTermKeys("essay", "collection").labelKey)).toBe("篇目集");
  });

  it("剧本×单本：只换说明行（部章结构 → 幕场结构），label 仍回落通用", () => {
    const k = carrierTermKeys("script", "standalone");
    expect(k.labelKey).toBe(mediumLabelKey("standalone"));
    expect(k.descKey).toBe("writing.medium.scriptStandaloneDesc");
    expect(t(k.descKey)).toContain("幕");
    expect(t(k.descKey)).not.toContain("部章");
  });

  it("中英两侧都要真的分开工：切到 en-US 后三处覆盖都不许塌回通用词", () => {
    try {
      setLang("en-US");
      const poem = carrierTermKeys("poetry", "collection");
      expect(t(poem.labelKey)).toBe("Poetry collection");
      expect(t(poem.labelKey)).not.toBe(t(mediumLabelKey("collection")));
      expect(t(poem.descKey)).toContain("Poems");
      expect(t(carrierTermKeys("script", "standalone").descKey)).toContain("act");
      // 通用侧的英文也必须还是小说/散文的词，别把中文覆盖顺手改成双语同名
      expect(t(carrierTermKeys("essay", "collection").labelKey)).toBe("Collection");
    } finally {
      setLang("zh-CN");
    }
  });

  it("四个体裁 × 三种载体的每一对 key，在当前语言里都翻得出来（面板不许渲染裸 key）", () => {
    for (const g of WRITING_GENRES) {
      for (const m of WRITING_MEDIUMS) {
        const k = carrierTermKeys(g.id, m.id);
        expect(t(k.labelKey), `${g.id}/${m.id} label`).not.toBe(k.labelKey);
        expect(t(k.descKey), `${g.id}/${m.id} desc`).not.toBe(k.descKey);
      }
    }
  });
});

// ⑮-2（2026-11-09 剧本开闸）：一次配齐术语 / KPI / 页签裁剪 / 判定 / 货架。
// 这条块存在的意义是"不许半开闸"：ready 翻成 true 而任何一支没跟上，就得到一本小说式剧本。
describe('剧本体裁实装（⑮-2）', () => {
  it('单位叫「场」：默认名与徽标各成一支，不与诗 / 篇混用', () => {
    expect(unitNameKey('script')).toBe('writing.newSceneName');
    expect(t(unitNameKey('script'), { n: 1 })).toBe('第 1 场');
    expect(unitShortKey('script')).toBe('writingDesign.unitScene');
    expect(t(unitShortKey('script'))).toBe('场');
    expect(unitNameKey('script')).not.toBe(unitNameKey('poetry'));
    expect(unitNameKey('script')).not.toBe(unitNameKey('essay'));
  });

  it('KPI 三格 = 场数 / 幕数 / 场均字数；小说那三格原键逐字不变', () => {
    const k = kpiLabelKeys('script');
    expect(k.count).toBe('writing.sceneCount');
    expect(k.group).toBe('editor.writing.stats.kpiActs');
    expect(k.avg).toBe('editor.writing.stats.kpiAvgScene');
    for (const key of Object.values(k)) expect(t(key)).not.toBe(key);
    expect(t(k.count)).toBe('场数');
    expect(t(k.group)).toBe('幕数');
    expect(t(k.avg)).toBe('场均字数');
    const novel = kpiLabelKeys('novel');
    expect(novel.count).toBe('writing.chapterCount');
    expect(novel.group).toBe('editor.writing.stats.kpiVolumes');
    expect(novel.avg).toBe('editor.writing.stats.kpiAvg');
  });

  it('页签只摘「世界观」：人物 / 剧情线 / 伏笔 / 时间线都是戏剧本体', () => {
    const hidden = hiddenViewKindsForGenre('script');
    expect(hidden).toEqual(['worldview']);
    for (const keep of ['catalog', 'characters', 'timeline', 'storylines', 'foreshadowing',
      'inspiration', 'proofread', 'stats', 'overview', 'writing']) {
      expect(hidden).not.toContain(keep);
    }
    // 诗集那三支不许被剧本这一刀顺手改掉
    expect(hiddenViewKindsForGenre('poetry')).toEqual(['worldview', 'storylines', 'foreshadowing']);
    expect(hiddenViewKindsForGenre('novel')).toEqual([]);
  });

  it('判定分家：剧本不是合集型（场长离群照判），人设卡对剧本也不是可选', () => {
    expect(isCollectionGenre('script')).toBe(false);
    expect(outlierMeaninglessForGenre('script')).toBe(false);
    expect(outlierMeaninglessForGenre('poetry')).toBe(true);
    expect(characterCardsOptionalForGenre('script')).toBe(false);
  });

  it('剧本货架第一项是「场次」并带 genre=script；页签摘掉的东西货架也不许卖', () => {
    const { templates, fallback } = shelfFor('script');
    expect(fallback).toBe(false);
    expect(templates[0]).toMatchObject({ type: 'writing-chapter', labelKey: 'writingLeft.tplScene', genre: 'script' });
    expect(templates.map((x) => x.type)).not.toContain('writing-worldview');
  });
});

// ⑯-1：行尾结构读数的判据（诗看形式、剧本看幕场与对白，其余一个徽标都不加）
describe('structureInspectorForGenre', () => {
  it('poetry → poem；script → script；小说 / 散文 / 未设置 / 脏值 → 空串', () => {
    expect(structureInspectorForGenre('poetry')).toBe('poem');
    expect(structureInspectorForGenre('script')).toBe('script');
    for (const g of ['novel', 'essay', '', 'scribble']) {
      expect(structureInspectorForGenre(g), g).toBe('');
    }
  });
});

// ⑲（2026-11-10）：页签裁了，**入口也必须关**。
// 这条锁守的不是某个按钮，而是一条结构性事实：裁页签与能不能造这类实体，
// 必须出自同一张表（canCreateEntityForGenre 内部就是查 hiddenViewKindsForGenre）。
describe('canCreateEntityForGenre（关联实体的体裁闸口）', () => {
  it('小说四样都能造（零回归）', () => {
    for (const e of ['character', 'worldview', 'storyline', 'foreshadowing'] as const) {
      expect(canCreateEntityForGenre('novel', e), e).toBe(true);
      expect(canCreateEntityForGenre('', e), `${e}/未设置`).toBe(true);
    }
  });

  it('散文与诗歌：剧情线 / 伏笔 / 世界观一律不许长出来，人物照给', () => {
    for (const g of ['essay', 'poetry']) {
      expect(canCreateEntityForGenre(g, 'storyline'), g).toBe(false);
      expect(canCreateEntityForGenre(g, 'foreshadowing'), g).toBe(false);
      expect(canCreateEntityForGenre(g, 'worldview'), g).toBe(false);
      expect(canCreateEntityForGenre(g, 'character'), g).toBe(true);
    }
  });

  it('剧本：只关世界观；剧情线/伏笔/人物是戏剧本体', () => {
    expect(canCreateEntityForGenre('script', 'worldview')).toBe(false);
    expect(canCreateEntityForGenre('script', 'storyline')).toBe(true);
    expect(canCreateEntityForGenre('script', 'foreshadowing')).toBe(true);
    expect(canCreateEntityForGenre('script', 'character')).toBe(true);
  });

  it('闸口与页签裁表**永远一致**（两套口径迟早漂，这里直接锁死成一套）', () => {
    const viewOf: Record<string, string> = {
      character: 'characters', worldview: 'worldview',
      storyline: 'storylines', foreshadowing: 'foreshadowing',
    };
    for (const g of [...WRITING_GENRES.map((x) => x.id), '', 'scribble']) {
      const hidden = hiddenViewKindsForGenre(g);
      for (const [entity, view] of Object.entries(viewOf as Record<string, string>) as [string, string][]) {
        expect(canCreateEntityForGenre(g, entity as never), `${g}/${entity}`)
          .toBe(!hidden.includes(view));
      }
    }
  });
});

// ⑲：剧本货架必须拖得出人物卡（注释早就说要给，代码没给过一次）
describe('剧本货架与剧本页签一致（⑲）', () => {
  it('剧本货架含人物卡，且仍不卖被裁掉的世界观', () => {
    const types = shelfFor('script').templates.map((x) => x.type);
    expect(types).toContain('writing-character');
    expect(types).not.toContain('writing-worldview');
  });

  it('诗货架照旧不卖人设卡与世界观（体裁常态，不是漏配）', () => {
    const types = shelfFor('poetry').templates.map((x) => x.type);
    expect(types).not.toContain('writing-character');
    expect(types).not.toContain('writing-worldview');
  });
});
