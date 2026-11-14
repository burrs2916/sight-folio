/**
 * ㉛ T-F（2026-11-10 轮 6）：L2 pane 引导语 + 栏头 / 视图名的体裁接线锁。
 *
 * 病灶（轮 5 交账时实测的十句 `editor.writing.studioPane.*Hint`，摘掉「场景」后扫单位词）：
 * 五句写死小说单位 —— 伏笔说「埋设章 / 跨章」、灵感说「挂章」、校对说「章文本」、
 * 统计说「卷分布 / 章节体量」、总览说「伏笔跨章」。诗集作者打开统计页读到「卷分布」
 * 就是在骗他：诗集没有卷。
 *
 * 同轮并发复核还抓到三处「同一个概念长第二张嘴」：
 *  ① 剧本页签已叫「角色表」，`WritingStudioPane` 的 characters 栏头仍吃
 *     `PANE_LABEL_KEY['characters'] = 'writing.viewKind.characters'`（人物设定）；
 *  ② `WritingInspectorPanel` 出口按钮拼裸键 `writing.viewKind.${target}`；
 *  ③ `projectCanvas` 两处拖载体 toast 顶「大纲」。
 *
 * 锁的形状沿用 ㉚ 三层，缺一层就可能重演「定义 100% / 运行时 0%」：
 *   ① 纯函数层：`studioPaneHintKey` 的覆盖与回落（回落 = 小说逐字不动的机制保证）；
 *   ② 接线层：四张裸键表在全仓绝迹，只准住在 writingSchema 的回落表里；
 *   ③ 词表层：20 条新串双语齐备、各说各话、不蹭邻居体裁的单位词。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import {
  studioPaneHintKey,
  surfaceKeyForGenre,
  surfaceDefaultKey,
  viewKindLabelKey,
  type SurfaceSlot,
} from '../writingSchema';
import { t, setLang } from '../../i18n';

const zhJson = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
const enJson = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
const cjk = /[\u4e00-\u9fff]/;

/** 十枚 pane（与 `WritingStudioPane.StudioPaneKind` 同一清单） */
const ALL_PANES = [
  'storyline', 'characters', 'worldview', 'timeline', 'storylines',
  'foreshadowings', 'inspirations', 'proofread', 'stats', 'overview',
];
/** 本轮登记了槽位的六枚（话里有正文单位词） */
const SLOTTED_PANES = ['storyline', 'foreshadowings', 'inspirations', 'proofread', 'stats', 'overview'];
/** 轮 6 逐条实测：这四句本来就不含单位词，补覆盖 = 无事生非 */
const UNROOLED_PANES = ['characters', 'worldview', 'timeline', 'storylines'];
/** 本轮新登记的五条槽位（paneHint 是旧槽位，㉚ 已覆盖） */
const NEW_SLOTS: SurfaceSlot[] = ['foreshadowingsHint', 'inspirationsHint', 'proofreadHint', 'statsHint', 'overviewHint'];
const GENRES = ['essay', 'poetry', 'script', 'diary'];
const NOVELISH = ['novel', '', 'diaryy', 'Novel'];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return ['__tests__', '__bench__', 'node_modules'].includes(e.name) ? [] : walk(p);
    return p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
  });
const read = (p: string) => readFileSync(p, 'utf-8');

describe('㉛ studioPaneHintKey · 覆盖与回落', () => {
  it('清单自锁：有槽位的 + 没槽位的 = 十枚 pane，一个不漏不多', () => {
    expect([...SLOTTED_PANES, ...UNROOLED_PANES].sort()).toEqual([...ALL_PANES].sort());
  });

  it('小说 / 空 / 脏体裁 × 十枚 pane 全部回落原键（小说十个字都不许变）', () => {
    for (const genre of NOVELISH) {
      for (const pane of ALL_PANES) {
        expect(studioPaneHintKey(genre, pane), `${genre || '(空)'} / ${pane}`)
          .toBe(`editor.writing.studioPane.${pane}Hint`);
      }
    }
  });

  it('storyline 仍走 ㉚ 的 paneHint 槽位（一轮两把刀共用同一格，不许另开第六槽）', () => {
    for (const genre of ['novel', '', ...GENRES]) {
      expect(studioPaneHintKey(genre, 'storyline')).toBe(surfaceKeyForGenre(genre, 'paneHint'));
    }
  });

  it('散文/诗/剧本/日记：五枚有单位词的引导语换成本体裁的词，四枚没有的原样不动', () => {
    for (const genre of GENRES) {
      for (const slot of NEW_SLOTS) {
        expect(surfaceKeyForGenre(genre, slot), `${genre}.${slot} 没登记进覆盖表`)
          .toBe(`writing.${genre}.${slot}`);
        expect(studioPaneHintKey(genre, slot.replace(/Hint$/, '') as string)).toBe(`writing.${genre}.${slot}`);
      }
      for (const pane of UNROOLED_PANES) {
        expect(studioPaneHintKey(genre, pane), `${genre} / ${pane} 这句本来就没单位词，不该被改`)
          .toBe(`editor.writing.studioPane.${pane}Hint`);
      }
    }
  });

  it('五枚槽位的回落键 = 删除 PANE_HINT_KEY 前那五条原键（抄错一条 = 改了小说文案）', () => {
    for (const slot of NEW_SLOTS) {
      // 槽位名本身就带 Hint 后缀，与 i18n 叶子同名 —— 别再拼第二个 Hint
      expect(surfaceDefaultKey(slot)).toBe(`editor.writing.studioPane.${slot}`);
    }
  });
});

describe('㉛ 词表层 · 二十条新串双语齐备且不蹭邻居单位词', () => {
  afterEach(() => setLang('zh-CN'));

  it('writing.{diary,essay,poetry,script} 五键在中英两份里一一对应（禁只加中文）', () => {
    for (const genre of GENRES) {
      for (const slot of NEW_SLOTS) {
        const zhLeaf = zhJson.writing[genre]?.[slot];
        const enLeaf = enJson.writing[genre]?.[slot];
        expect(typeof zhLeaf, `zh 缺 writing.${genre}.${slot}`).toBe('string');
        expect(typeof enLeaf, `en 缺 writing.${genre}.${slot}`).toBe('string');
        expect(zhLeaf, `${genre}.${slot} 中文侧不许是英文`).toMatch(cjk);
        expect(enLeaf, `${genre}.${slot} 英文侧不许夹汉字`).not.toMatch(cjk);
      }
    }
  });

  it('不蹭邻居体裁的正文单位词（章/篇/首/幕/场/天 各有其主）', () => {
    setLang('zh-CN');
    const FOREIGN: Record<string, string[]> = {
      essay: ['章', '诗', '幕', '这天', '日记'],
      poetry: ['章', '篇', '幕', '这天', '日记'],
      script: ['章', '篇', '诗', '这天', '日记'],
      diary: ['章', '卷', '幕', '辑'],
    };
    const OWN: Record<string, string[]> = {
      essay: ['篇'], poetry: ['诗'], script: ['场'], diary: ['天'],
    };
    for (const genre of GENRES) {
      const rendered = NEW_SLOTS.map((slot) => t(surfaceKeyForGenre(genre, slot))).join(' / ');
      // 两个「蹭词」例外都是本仓付过学费的误伤：「场景」是设定卡实体名，
      // 「编辑」里的「辑」不是诗歌那个「辑」分组（轮 3 就误伤过一次，状态文件写死了）。
      const scanned = rendered.replace(/场景/g, '').replace(/编辑/g, '');
      for (const bad of FOREIGN[genre]) expect(scanned, `${genre} 的五句引导不许说「${bad}」`).not.toContain(bad);
      for (const own of OWN[genre]) expect(rendered, `${genre} 至少要说自己的「${own}」`).toContain(own);
    }
  });

  it('日记五句里「场」这个字一个都不许出现（它是剧本的正文单位）', () => {
    setLang('zh-CN');
    const rendered = NEW_SLOTS.map((slot) => t(surfaceKeyForGenre('diary', slot))).join(' / ').replace(/场景/g, '');
    expect(rendered, '日记引导语不许说「场」').not.toContain('场');
  });

  it('单位词不许漏进任何一句的邻居位置：小说原句仍住在回落键里，一字未改', () => {
    setLang('zh-CN');
    expect(t(surfaceDefaultKey('statsHint'))).toContain('卷分布');
    expect(t(surfaceDefaultKey('overviewHint'))).toContain('伏笔跨章');
    expect(t(surfaceDefaultKey('foreshadowingsHint'))).toContain('埋设章');
    // 覆盖句必须**不再**含这些小说说法，否则这条槽位等于没登记
    for (const genre of GENRES) {
      for (const slot of NEW_SLOTS) {
        const mine = t(surfaceKeyForGenre(genre, slot));
        expect(mine, `${genre}.${slot} 与小说回落句一字不差 = 覆盖是空的`).not.toBe(t(surfaceDefaultKey(slot)));
      }
    }
  });
});

describe('㉛ 接线层 · 四张嘴收进同一个解析器', () => {
  it('WritingStudioPane 的引导语表已删除，十枚 pane 一律现算', () => {
    const src = read('src/editor/renderers/WritingStudioPane.tsx');
    expect(src).toContain('t(studioPaneHintKey(genre, pane))');
    // 第二份真源不许留：表在 = 下一轮有人只改表不改解析器
    expect(src).not.toContain('PANE_HINT_KEY');
    expect(src).not.toContain("'editor.writing.studioPane.");
  });

  it('栏头改吃页签那张词表（剧本页签「角色表」与栏头不再两个名字）', () => {
    const src = read('src/editor/renderers/WritingStudioPane.tsx');
    expect(src).toContain('viewKindLabelKey(genre, PANE_VIEW_KIND[pane])');
    expect(src).not.toContain('PANE_LABEL_KEY');
  });

  it('检查器出口按钮 / 拖载体 toast 两处视图名走解析器', () => {
    expect(read('src/editor/panels/WritingInspectorPanel.tsx')).toContain('t(viewKindLabelKey(genre, target))');
    const canvas = read('src/editor/sceneEditor/projectCanvas.tsx');
    expect(canvas).toContain("viewKindLabelKey(dropGenre, 'catalog')");
    expect(canvas).toContain("viewKindLabelKey(preGenre, 'catalog')");
  });

  it('被收编的裸键只许住在 writingSchema 的回落表里（全仓扫，含测试目录）', () => {
    const bareKeys = [
      'writing.viewKind.catalog',
      'writing.viewKind.characters',
      ...NEW_SLOTS.map((s) => `editor.writing.studioPane.${s}Hint`),
    ];
    for (const key of bareKeys) {
      for (const p of walk('src')) {
        if (p.endsWith('utils/writingSchema.ts')) continue;
        expect(readFileSync(p, 'utf-8'), `${p} 还在把 ${key} 当字面量用`).not.toContain(`'${key}'`);
      }
    }
  });

  it('小说侧「人物设定」三字逐字不动；剧本侧栏头与页签同词', () => {
    setLang('zh-CN');
    expect(viewKindLabelKey('novel', 'characters')).toBe('writing.viewKind.characters');
    expect(t(viewKindLabelKey('novel', 'characters'))).toBe('人物设定');
    expect(t(viewKindLabelKey('', 'characters'))).toBe('人物设定');
    expect(t(viewKindLabelKey('script', 'characters'))).toBe('角色表');
  });

  it('五句旧小说串一个都不许删：它们现在是回落键，删了小说就印裸键', () => {
    for (const slot of NEW_SLOTS) {
      expect(typeof zhJson.editor.writing.studioPane[slot], `zh 回落键 ${slot} 被误删`).toBe('string');
      expect(typeof enJson.editor.writing.studioPane[slot], `en 回落键 ${slot} 被误删`).toBe('string');
    }
  });
});
