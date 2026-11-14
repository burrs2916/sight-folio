/**
 * ㉣ N-23（2026-11-11 轮 72 续）：书的自动名跟载体走。
 *
 * 立刀缘由（真人原话）：「我们点击日记以后，它的正文怎么开头是"第一首"？哪来的第一首？」
 * 取证：代码 + 真库全表三形扫描 `第一首 / 第1首 / 第 1 首` **零命中**；库里唯一的「第 1 首」
 * 属于那本 poetry 书。真因 = 四本书全叫《新建作品 N》，**书名里不含体裁**，从载体卡点进去
 * 根本分不出哪本是哪本。这一把补的就是这条最小可辨面。
 *
 * 锁四件：① 五体裁键互不相同、未设/脏/未开闸落回历史键（零回归线）
 * ② zh/en 六条都有实值且 `{n}` 占位符**两侧形状一致**（缺一个花括号就是 TypeError）
 * ③ 中文实值各含自己的载体词、日记侧不许说 章/首/篇/卷/场
 * ④ 建书入口不许再直调历史键（源码锁 —— 本仓「定义了没人消费 / 消费点绕开真源」的头号病灶）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultBookNameKeyForGenre, WRITING_GENRES } from '../writingSchema';
import zh from '../../i18n/zh-CN.json';
import en from '../../i18n/en-US.json';

const HIST = 'studio.defaultBookName';
const leaf = (k: string) => k.split('.').pop() as string;
const at = (bag: unknown, k: string) => ((bag as { studio: Record<string, unknown> }).studio[leaf(k)] ?? '') as string;

describe('㉣ N-23 · 自动名判口径', () => {
  it('五个已开闸体裁各领自己的键，键名互不相同', () => {
    const ready = WRITING_GENRES.filter((g) => g.ready).map((g) => g.id);
    expect(ready.length).toBeGreaterThanOrEqual(5);
    const keys = ready.map((g) => defaultBookNameKeyForGenre(g));
    expect(new Set(keys).size).toBe(keys.length);
    expect(defaultBookNameKeyForGenre('diary')).toBe('studio.defaultBookName_diary');
    expect(defaultBookNameKeyForGenre('poetry')).toBe('studio.defaultBookName_poetry');
  });

  it('未设 / 脏值 / 未开闸 → 落回历史键，逐字不改旧行为', () => {
    for (const g of ['', '   ', 'xxx', 'novel-x']) expect(defaultBookNameKeyForGenre(g)).toBe(HIST);
    for (const g of WRITING_GENRES.filter((x) => !x.ready).map((x) => x.id)) {
      expect(defaultBookNameKeyForGenre(g), `未开闸 ${g} 不许提前改名`).toBe(HIST);
    }
  });
});

describe('㉣ N-23 · 双语实值与占位符形状', () => {
  it('zh / en 都有非空实值，`{n}` 两侧同形（缺一边就是运行时炸）', () => {
    const keys = [HIST, ...WRITING_GENRES.filter((g) => g.ready).map((g) => defaultBookNameKeyForGenre(g.id))];
    for (const k of keys) {
      const z = at(zh, k);
      const e = at(en, k);
      expect(z.length, `zh 缺 ${k}`).toBeGreaterThan(0);
      expect(e.length, `en 缺 ${k}`).toBeGreaterThan(0);
      expect(z.includes('{n}'), `zh ${k} 少 {n}`).toBe(true);
      expect(e.includes('{n}'), `en ${k} 少 {n}`).toBe(true);
      // 恰好一个 {n}（本仓 lib 目标无 replaceAll，用 split 计数）
      expect(z.split('{n}').length, `${k} 的 {n} 数量不对（zh）`).toBe(2);
      expect(e.split('{n}').length, `${k} 的 {n} 数量不对（en）`).toBe(2);
    }
  });

  it('中文书名各含自己的载体词；日记/诗集侧不许冒章篇卷首', () => {
    const word: Record<string, string> = { novel: '小说', essay: '散文', poetry: '诗集', script: '剧本', diary: '日记' };
    for (const [g, w] of Object.entries(word)) {
      expect(at(zh, defaultBookNameKeyForGenre(g))).toContain(w);
    }
    for (const g of ['diary', 'poetry', 'essay', 'script']) {
      expect(at(zh, defaultBookNameKeyForGenre(g))).not.toMatch(/章|卷|辑/);
    }
    // 五个体裁的自动名不许撞成同一条
    const names = WRITING_GENRES.filter((x) => x.ready).map((x) => at(zh, defaultBookNameKeyForGenre(x.id)));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('㉣ N-23 · 消费点不许绕开真源', () => {
  it('建书入口不再直调历史键（只剩 writingSchema 里那条兑底）', () => {
    const src = readFileSync('src/utils/studioBook.ts', 'utf8');
    expect(src).toContain('t(defaultBookNameKeyForGenre(genre)');
    expect(src.includes("t('studio.defaultBookName'"), '建书入口不许绕开 defaultBookNameKeyForGenre').toBe(false);
  });
});
