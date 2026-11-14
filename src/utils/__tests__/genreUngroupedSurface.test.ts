/**
 * ㉞ T-F″（2026-11-10 轮 10）：「无组那一组」的兜底名，在**界面与语料**两侧都按载体取词。
 *
 * 病灶（轮 8 交账时用新证据抓出，与 ㉜ T-F′ 同一把尺子）：轮 8 只把统计页签那三张嘴接进
 * `bandUncategorized` 槽位，而「未分卷」这三个字还有四处硬编码活着 ——
 *   ① `writingOverview.ts` 总览卷行：`v.volume || "未分卷"`，**硬编码中文、连 i18n 都没走**
 *      → 英文界面的 /ai 洞察卡直接印汉字；
 *   ② ③ `writingAiCorpus.ts` 大纲骨架 ×2：`volumeNameOf(...) || '未分卷'`
 *      → 喂给模型的原话就是「未分卷」，诗集据此以为自己有一个「卷」层；
 *      且同一枚硬编码同时喂 zh 与 en 两份语料 → **英文语料里夹着汉字**；
 *   ④ ⑤ `writingPanes.tsx` 时间线 chapter 视图组头 ×2：`lane.name || t('writing.statsUncategorized')`
 *      → 走的是小说专用键（轮 8 把数量=2 钉成记债锁，本刀连账一起还）。
 *
 * 措辞一条都不新造：界面取 `writing.{genre}.bandUncategorized`（㉜ 已入库），
 * 语料取 `CORPUS_NOUNS[...].ungrouped`（⑭ 刀C 已入库）—— 两族都是现成口径。
 *
 * 零回归的形状：小说（含空 / 脏体裁 / 未传参）逐字回落「未分卷」，
 * 分别由 `corpusNounsFor` 与 `surfaceKeyForGenre` 的回落分支保证。
 *
 * 三层锁沿用 ㉓-1 / ㉚ / ㉛ / ㉜ 的形状：
 *   ① 纯函数层：五支语料量词覆盖在册、小说/空/脏值逐字回落；
 *   ② 真调用层：buildCatalogCorpus / buildBookOverview 各体裁实际输出对账（含「英文不夹汉字」）；
 *   ③ 接线层：**genre 真的从调用点传下来了**（W-0a 的教训：定义 100%、运行时 20%）+ 裸字面绝迹。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { corpusNounsFor } from '../writingCorpus';
import { buildCatalogCorpus } from '../writingAiCorpus';
import { buildBookOverview, type BookOverviewInput } from '../writingOverview';
import { setLang } from '../../i18n';
import type { WritingChapter } from '../../services/tauri';

const cjk = /[\u4e00-\u9fff]/;

/** 遗留扁平模型书（全书无 parentId）→ 卷归属按 chapter.volume 字符串解析 */
const ch = (id: string, volume: string, title = id): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title,
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
  }) as never;

describe('㉞ 纯函数层 · corpusNounsFor 的 ungrouped 五支与回落', () => {
  it('小说 / 空 / 脏体裁 / 未传参 → 逐字回落小说那句（零回归的机制保证）', () => {
    for (const g of [undefined, '', 'novel', 'diaryy', 'Novel']) {
      expect(corpusNounsFor(g as string).zh.ungrouped, `${String(g)} 的中文兜底名`).toBe('未分卷');
      expect(corpusNounsFor(g as string).en.ungrouped, `${String(g)} 的英文兜底名`).toBe('no volume');
    }
  });

  it('四支非小说各有自己的词，且不等于小说那句（漏登记 = 继续印「未分卷」）', () => {
    expect(corpusNounsFor('essay').zh.ungrouped).toBe('未分组');
    expect(corpusNounsFor('poetry').zh.ungrouped).toBe('未分组');
    expect(corpusNounsFor('script').zh.ungrouped).toBe('未分幕');
    expect(corpusNounsFor('diary').zh.ungrouped).toBe('未归年月');
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      expect(corpusNounsFor(g).zh.ungrouped).not.toBe('未分卷');
      // 英文侧必须是英文（本条同时是「英文语料夹汉字」这类回归的通用闸）
      expect(corpusNounsFor(g).en.ungrouped, `${g} 的英文兜底名夹了汉字`).not.toMatch(cjk);
    }
  });
});

describe('㉞ 真调用层 · buildCatalogCorpus 的骨架组名', () => {
  const chapters = [ch('c1', ''), ch('c2', '')];

  it('未传 genre / 小说 / 空 / 脏值：中文骨架仍逐字说小说那句', () => {
    for (const opts of [undefined, { genre: '' }, { genre: 'novel' }, { genre: 'scribble' }]) {
      const c = buildCatalogCorpus(chapters, [], opts);
      expect(c.zh, JSON.stringify(opts)).toContain('- 未分卷：');
    }
  });

  it('诗 / 散文 / 剧本 / 日记各领自己的词，不再顶着「卷」', () => {
    expect(buildCatalogCorpus(chapters, [], { genre: 'poetry' }).zh).toContain('- 未分组：');
    expect(buildCatalogCorpus(chapters, [], { genre: 'essay' }).zh).toContain('- 未分组：');
    expect(buildCatalogCorpus(chapters, [], { genre: 'script' }).zh).toContain('- 未分幕：');
    expect(buildCatalogCorpus(chapters, [], { genre: 'diary' }).zh).toContain('- 未归年月：');
    for (const g of ['essay', 'poetry', 'script', 'diary']) {
      expect(buildCatalogCorpus(chapters, [], { genre: g }).zh, `${g} 的骨架还在说「未分卷」`)
        .not.toContain('未分卷');
    }
  });

  it('英文骨架任何体裁都不夹汉字（改造前 zh/en 共用同一枚中文硬编码 = 本刀抓到的第二条）', () => {
    for (const g of [undefined, 'novel', 'essay', 'poetry', 'script', 'diary']) {
      const en = buildCatalogCorpus(chapters, [], { genre: g as string }).en;
      expect(en, `${String(g)} 的英文骨架夹了汉字`).not.toMatch(cjk);
    }
    expect(buildCatalogCorpus(chapters, [], { genre: 'novel' }).en).toContain('- no volume:');
    expect(buildCatalogCorpus(chapters, [], { genre: 'script' }).en).toContain('- unplaced:');
  });

  it('作者起的组名原样透传，绝不被兜底词覆盖（体裁措辞只兜「无组」那一组）', () => {
    const withVol = [ch('c1', '上辑'), ch('c2', '')];
    const c = buildCatalogCorpus(withVol, [], { genre: 'poetry' });
    expect(c.zh).toContain('- 上辑：');
    expect(c.zh).toContain('- 未分组：');
  });

  it('chapterLimit 与 genre 共存时截断行为不变（配额一格未动，㉥ 只换了那句的量词）', () => {
    const many = [ch('c1', ''), ch('c2', ''), ch('c3', '')];
    const c = buildCatalogCorpus(many, [], { chapterLimit: 1, genre: 'poetry' });
    expect(c.zh).toContain('- 未分组：');
    // 配额读数照旧（可见 1 首 + 省略 2 首）；量词自 ㉥ AI-5b 起按载体取 ——
    // 原断言钉的是改造前那句小说量词，改吃「首」不是削断言，是把措辞锁到新口径上。
    expect(c.zh).toContain('其余 2 首省略');
  });
});

describe('㉞ 真调用层 · buildBookOverview 不再生产成品文案', () => {
  const base = {
    bookTitle: '长夜',
    chapters: [ch('c1', ''), ch('c2', '第一卷')],
    settings: [],
    outlines: [],
    timelineEvents: [],
    storylines: [],
    foreshadowings: [],
  } satisfies BookOverviewInput;

  it('无组那一行 volume 是空串：空串是数据，「未分卷」是文案 —— 文案归渲染层', () => {
    const o = buildBookOverview(base);
    expect(o.volumes.map((v) => v.volume)).toContain('');
    expect(o.volumes.map((v) => v.volume)).toContain('第一卷');
    expect(o.volumes.some((v) => v.volume === '未分卷'), '数据层又长出成品文案').toBe(false);
  });
});

describe('㉞ 接线层 · genre 真的从调用点传下来了 + 裸字面绝迹', () => {
  // W-0a 的教训：体裁参数「定义了没人传」时，纯函数与词表两层全绿，运行时照旧小说口径。
  it('buildCatalogCorpus 两处生产调用都带 genre', () => {
    const files = ['src/pages/writingPage/useAiActions.ts', 'src/editor/panels/workbenchPanelHooks.ts'];
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      const idx = src.indexOf('buildCatalogCorpus(');
      expect(idx, `${f} 没找到 buildCatalogCorpus 调用`).toBeGreaterThan(-1);
      // 取调用点后一段实参窗口：genre 必须真的出现在**实参里**，不是文件里某处
      const argsWindow = src.slice(idx, src.indexOf('\n', src.indexOf(')', idx)));
      expect(argsWindow, `${f} 的调用没传 genre`).toMatch(/genre/);
      expect(src.indexOf('buildCatalogCorpus(', idx + 1), `${f} 冒出第二个调用点，需逐点核对`).toBe(-1);
    }
  });

  it('数据层与语料层不再硬编码「未分卷」（措辞一律走槽位表 / CORPUS_NOUNS）', () => {
    for (const f of ['src/utils/writingOverview.ts', 'src/utils/writingAiCorpus.ts']) {
      expect(readFileSync(f, 'utf-8'), `${f} 又写回硬编码`).not.toContain('未分卷');
    }
  });

  it('总览洞察卡改吃 bandUncategorized 槽位，且不吃小说裸键', () => {
    const src = readFileSync('src/ai/WritingBookInsights.tsx', 'utf-8');
    expect(src).toContain("surfaceKeyForGenre(bookGenre, 'bandUncategorized')");
    expect(src).not.toContain('未分卷');
    expect(src).not.toContain("t('writing.statsUncategorized')");
  });

  it('CORPUS_NOUNS 的下标式全仓只剩 corpusNounsFor 一处（防第二份体裁→量词判据）', () => {
    const files = ['src/utils/writingCorpus.ts', 'src/utils/writingAiCorpus.ts'];
    let hits = 0;
    for (const f of files) {
      hits += (readFileSync(f, 'utf-8').match(/CORPUS_NOUNS\[/g) ?? []).length;
    }
    expect(hits, 'CORPUS_NOUNS 又长出第二处下标式消费').toBe(1);
  });
});

afterEach(() => setLang('zh-CN'));
