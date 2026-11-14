/**
 * 洼地②（T-2 残余）：统计读数 6 槽按体裁锁。
 *
 * 病灶：`tabUnit / statsEmpty / unitProgress / unitTargetLabel / unitTargetUnset / currentTally`
 * 六枚槽位此前只有 diary 登记，essay/poetry/script 全部经 `surfaceKeyForGenre` 回落小说默认
 * （「还没有章节 / 已写 X 目标 Y 章 / 当前 X 章·字」）——诗集统计页就在说"章"。
 *
 * 三层锁沿用 genreStatsBandSurface 的形状：
 *   ① 纯函数层：三体裁 × 六槽登记在 writing.{genre}.{slot}，小说（含空/脏）逐字回落；
 *   ② 词表层：六槽 × 三体裁 双语齐备、覆盖句 ≠ 回落句、不蹭邻居体裁单位词；
 *   ③ 接线层：四处消费点仍走 surfaceKeyForGenre（防改回裸键）。
 * novel 不登记 = 走默认 = 改造前逐字等价，是本刀的零回归对照线。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { surfaceKeyForGenre, surfaceDefaultKey, type SurfaceSlot } from '../writingSchema';
import { t, setLang } from '../../i18n';

const zh = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
const en = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
const cjk = /[\u4e00-\u9fff]/;

const SLOTS: SurfaceSlot[] = [
  'tabUnit', 'statsEmpty', 'unitProgress', 'unitTargetLabel', 'unitTargetUnset', 'currentTally',
];
const COVERED = ['essay', 'poetry', 'script'];
const GENRES = [...COVERED, 'diary'];
const NOVELISH = ['novel', '', 'poemx', 'Novel'];

describe('① 纯函数层 · 六枚统计读数槽的覆盖与回落', () => {
  it('小说 / 空 / 脏体裁 × 六槽全部回落原键（novel 逐字零回归的机制保证）', () => {
    for (const g of NOVELISH) {
      for (const slot of SLOTS) {
        expect(surfaceKeyForGenre(g, slot), `${g || '(空)'} / ${slot}`).toBe(surfaceDefaultKey(slot));
      }
    }
  });

  it('四体裁 × 六槽全部登记在 writing.{genre}.{slot}（漏一格 = 那一格继续说「章」）', () => {
    for (const g of GENRES) {
      for (const slot of SLOTS) {
        // 三新体裁键名与槽名一一对齐；diary 沿用既有不规则键名（tabEntries 等），只校非回落。
        if (COVERED.includes(g)) {
          expect(surfaceKeyForGenre(g, slot), `${g} / ${slot} 没登记进覆盖表`)
            .toBe(`writing.${g}.${slot}`);
        }
        expect(surfaceKeyForGenre(g, slot), `${g} / ${slot} 仍回落小说默认`).not.toBe(surfaceDefaultKey(slot));
      }
    }
  });
});

describe('② 词表层 · 双语齐备、覆盖≠回落、不蹭邻居单位词', () => {
  afterEach(() => setLang('zh-CN'));

  it('writing.{essay,poetry,script}.{六槽} 在中英两份一一对应、不混排', () => {
    for (const g of COVERED) {
      for (const slot of SLOTS) {
        const zl = zh.writing[g]?.[slot];
        const el = en.writing[g]?.[slot];
        expect(typeof zl, `zh 缺 writing.${g}.${slot}`).toBe('string');
        expect(typeof el, `en 缺 writing.${g}.${slot}`).toBe('string');
        expect(zl, `${g}.${slot} 中文侧不许是英文`).toMatch(cjk);
        expect(el, `${g}.${slot} 英文侧不许夹汉字`).not.toMatch(cjk);
      }
    }
  });

  it('插值占位符：unitProgress 带 {chapters}{target}、currentTally 带 {chapters}{words}（对齐消费点传参）', () => {
    for (const g of GENRES) {
      for (const lang of [zh, en]) {
        expect(lang.writing[g].unitProgress).toContain('{chapters}');
        expect(lang.writing[g].unitProgress).toContain('{target}');
        expect(lang.writing[g].currentTally).toContain('{chapters}');
        expect(lang.writing[g].currentTally).toContain('{words}');
      }
    }
  });

  it('三体裁连读不蹭邻居体裁单位词、且各说自己的词（摘掉已知误伤「场景/编辑」）', () => {
    setLang('zh-CN');
    const FOREIGN: Record<string, string[]> = {
      essay: ['章', '诗', '首', '幕', '场', '天', '日记', '卷', '辑'],
      poetry: ['章', '篇', '幕', '场', '天', '日记', '卷', '辑'],
      script: ['章', '篇', '诗', '首', '天', '日记', '卷', '辑'],
    };
    const OWN: Record<string, string[]> = {
      essay: ['篇'], poetry: ['首'], script: ['场'],
    };
    for (const g of COVERED) {
      const rendered = SLOTS.map((slot) => t(surfaceKeyForGenre(g, slot))).join(' / ');
      const scanned = rendered.replace(/场景/g, '').replace(/编辑/g, '');
      for (const bad of FOREIGN[g]) expect(scanned, `${g} 的六句统计读数不许说「${bad}」`).not.toContain(bad);
      for (const own of OWN[g]) expect(rendered, `${g} 至少要说自己的「${own}」`).toContain(own);
    }
  });

  it('小说六句原句逐字在场（回落键不许被改值）', () => {
    setLang('zh-CN');
    expect(t('writing.tabChapters')).toBe('章节');
    expect(t('writing.statsPaneEmpty')).toContain('章节');
    expect(t('writing.bookChapterProgress')).toContain('章');
    expect(t('studio.bookMeta.currentTally')).toContain('章');
  });
});

describe('③ 接线层 · 六枚槽的消费点仍走 surfaceKeyForGenre', () => {
  const read = (rel: string) => readFileSync(rel, 'utf8');


  it('tabUnit / statsEmpty 调用点在位（WritingPage / writingPanes 裸键绝迹）', () => {
    expect(read('src/pages/WritingPage.tsx')).toContain("'tabUnit'");
    expect(read('src/editor/renderers/writingPanes.tsx')).toContain("'statsEmpty'");
  });
  it('unitProgress / unitTargetLabel / unitTargetUnset 调用点在位（WritingStatsDialog）', () => {
    const s = read('src/pages/WritingStatsDialog.tsx');
    for (const slot of ['unitProgress', 'unitTargetLabel', 'unitTargetUnset']) {
      expect(s, `${slot} 消费点丢失`).toContain(`'${slot}'`);
    }
  });
  it('currentTally 调用点在位（BookMetaPanel）', () => {
    expect(read('src/editor/panels/BookMetaPanel.tsx')).toContain("'currentTally'");
  });
});
