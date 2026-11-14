/**
 * ㉜ T-F′（2026-11-10 轮 8）：统计页签的三段标题——分组段、单位体量段、无组那一组的兜底名——按载体锁。
 *
 * 病灶（轮 6 复核抓出）：`bandGroup / bandUnitSize` 两个槽位自 ㉓-1 就存在，却只登记了 diary，
 * 散文/诗/剧本三支全无覆盖 → 诗集统计页此刻就印着「卷分布」段标题 + 「未分卷」分组
 * （`writingPanes.tsx:2641/:2674/:2755` 三处无条件渲染，不随体裁隐藏）。
 * 轮 6 把 statsHint 换成「分组体量」只能算不撒谎，这一刀才把界面本身叫对名。
 *
 * 名词一条都不新造：篇/首/场、分组/幕、未分组/未分幕/未归年月全部取自
 * `writingCorpus.ts:502-525` 的现成口径（AI 语料早按体裁这么说了，界面没有理由不跟）。
 *
 * 三层锁沿用 ㉓-1 / ㉚ / ㉛ 的形状：
 *   ① 纯函数层：四体裁 × 三槽位覆盖在册、小说（含空/脏值）逐字回落；
 *   ② 词表层：十条新串双语齐备、不蹭邻居体裁的单位词、覆盖句 ≠ 回落句；
 *   ③ 接线层：统计带分组名走解析器、裸键形状绝迹、两枚段标题调用点仍在；
 *      时间线页签的同名两句不在本刀口径（T-F′ 点名的是统计页签三张嘴）→ 轮 8 数量钉死记债，
 *      **㉞ T-F″（轮 10）已接掉，那条锁同步翻成绝迹锁**——记债锁的用途就是让还账的人改断言，
 *      不是让它永远绿着。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { surfaceKeyForGenre, surfaceDefaultKey, type SurfaceSlot } from '../writingSchema';
import { t, setLang } from '../../i18n';

const zh = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
const en = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
const cjk = /[\u4e00-\u9fff]/;

const BAND_SLOTS: SurfaceSlot[] = ['bandGroup', 'bandUnitSize', 'bandUncategorized'];
const GENRES = ['essay', 'poetry', 'script', 'diary'];
const NOVELISH = ['novel', '', 'diaryy', 'Novel'];

/** 回落键 = 统计页签改造前就在用的三条原键（抄错一条 = 改了小说的界面） */
const FALLBACK: Record<string, string> = {
  bandGroup: 'writing.statsBandVolume',
  bandUnitSize: 'writing.statsBandChapterSize',
  bandUncategorized: 'writing.statsUncategorized',
};

describe('㉜ 纯函数层 · 三枚统计带槽位的覆盖与回落', () => {
  it('小说 / 空 / 脏体裁 × 三槽位全部回落原键（小说侧逐字零回归的机制保证）', () => {
    for (const genre of NOVELISH) {
      for (const slot of BAND_SLOTS) {
        expect(surfaceKeyForGenre(genre, slot), `${genre || '(空)'} / ${slot}`).toBe(FALLBACK[slot]);
        expect(surfaceDefaultKey(slot), `${slot} 的回落键被改动`).toBe(FALLBACK[slot]);
      }
    }
  });

  it('四体裁 × 三槽位全部登记在 writing.{genre}.{slot}（漏一格 = 那一格继续印「卷」）', () => {
    for (const genre of GENRES) {
      for (const slot of BAND_SLOTS) {
        expect(surfaceKeyForGenre(genre, slot), `${genre} / ${slot} 没登记进覆盖表`)
          .toBe(`writing.${genre}.${slot}`);
      }
    }
  });
});

describe('㉜ 词表层 · 十条新串双语齐备且不蹭邻居单位词', () => {
  afterEach(() => setLang('zh-CN'));

  it('writing.{essay,poetry,script} 三键 + writing.diary.bandUncategorized 在中英两份一一对应', () => {
    for (const genre of GENRES) {
      for (const slot of BAND_SLOTS) {
        const zhLeaf = zh.writing[genre]?.[slot];
        const enLeaf = en.writing[genre]?.[slot];
        expect(typeof zhLeaf, `zh 缺 writing.${genre}.${slot}`).toBe('string');
        expect(typeof enLeaf, `en 缺 writing.${genre}.${slot}`).toBe('string');
        expect(zhLeaf, `${genre}.${slot} 中文侧不许是英文`).toMatch(cjk);
        expect(enLeaf, `${genre}.${slot} 英文侧不许夹汉字`).not.toMatch(cjk);
      }
    }
  });

  it('覆盖句必须≠回落句：与小说原句一字不差 = 这条槽位是空的', () => {
    for (const lang of ['zh-CN', 'en-US'] as const) {
      setLang(lang);
      for (const genre of GENRES) {
        for (const slot of BAND_SLOTS) {
          expect(t(surfaceKeyForGenre(genre, slot)), `${lang} ${genre}.${slot} 覆盖是空的`)
            .not.toBe(t(surfaceDefaultKey(slot)));
        }
      }
    }
  });

  it('三句连读不蹭邻居体裁的单位词，各自的词必须在场（「场景」「编辑」两处已知误伤先摘）', () => {
    setLang('zh-CN');
    const FOREIGN: Record<string, string[]> = {
      essay: ['章', '诗', '幕', '场', '首', '天', '日记', '卷', '辑'],
      poetry: ['章', '篇', '幕', '场', '天', '日记', '卷', '辑'],
      script: ['章', '篇', '诗', '首', '天', '日记', '卷', '辑'],
      diary: ['章', '卷', '幕', '场', '篇', '首', '辑'],
    };
    const OWN: Record<string, string[]> = {
      essay: ['篇'], poetry: ['首'], script: ['幕', '场'], diary: ['天', '年月'],
    };
    for (const genre of GENRES) {
      const rendered = BAND_SLOTS.map((slot) => t(surfaceKeyForGenre(genre, slot))).join(' / ');
      const scanned = rendered.replace(/场景/g, '').replace(/编辑/g, '');
      for (const bad of FOREIGN[genre]) expect(scanned, `${genre} 的三句统计带标题不许说「${bad}」`).not.toContain(bad);
      for (const own of OWN[genre]) expect(rendered, `${genre} 至少要说自己的「${own}」`).toContain(own);
    }
  });

  it('小说三句原句逐字在场：卷分布 / 章节体量 / 未分卷（回落键不许被改值）', () => {
    setLang('zh-CN');
    expect(t('writing.statsBandVolume')).toBe('卷分布');
    expect(t('writing.statsBandChapterSize')).toBe('章节体量');
    expect(t('writing.statsUncategorized')).toBe('未分卷');
  });
});

describe('㉜ 接线层 · 统计页签三张嘴同源', () => {
  const src = readFileSync('src/editor/renderers/writingPanes.tsx', 'utf-8');

  it('两枚段标题仍走 surfaceKeyForGenre（防有人把它们改回裸键）', () => {
    expect(src).toContain("surfaceKeyForGenre(book?.genre ?? '', 'bandGroup')");
    expect(src).toContain("surfaceKeyForGenre(book?.genre ?? '', 'bandUnitSize')");
  });

  it('分组行的兜底组名改吃 bandUncategorized 槽位，旧裸键形状在统计带绝迹', () => {
    expect(src).toContain("v.volume || t(surfaceKeyForGenre(book?.genre ?? '', 'bandUncategorized'))");
    expect(src).not.toContain("v.volume || t('writing.statsUncategorized')");
  });

  it('时间线页签那两句已接掉（㉞ T-F″ 还账：轮 8 的「数量=2 记债锁」就地翻成绝迹锁）', () => {
    expect(src).not.toContain("lane.name || t('writing.statsUncategorized')");
    // 两句都必须吃解析器，且吃的是**时间线自己的** tlGenre（不是统计页签的 book?.genre）
    expect(src.match(/lane\.name \|\| t\(surfaceKeyForGenre\(tlGenre, 'bandUncategorized'\)\)/g)?.length).toBe(2);
  });
});
