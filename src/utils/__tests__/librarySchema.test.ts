// 语料库统一分类与标签枚举（utils/librarySchema）纯函数单测
//
// 锁的约束：
// - 枚举规模稳定：分类恰 30 项、标签恰 28 项、四组各 7 项（后端白名单同源断言）。
// - 分类集合与标签集合互不相交，前端 chip 单选/多选才能正交组合、编辑回填不歧义。
// - 枚举值即存储值：判定函数只认清单内的原样中文值（不归一、不模糊匹配）。

import { describe, it, expect } from 'vitest';
import { CORPUS_CATEGORIES, CORPUS_TAG_GROUPS, CORPUS_ALL_TAGS, isCorpusCategory, isCorpusTag } from '../librarySchema';

const GROUP_SIZES: number[] = CORPUS_TAG_GROUPS.map((g) => g.tags.length);

describe('统一分类与标签枚举', () => {
  it('分类恰 30 项且唯一', () => {
    expect(CORPUS_CATEGORIES).toHaveLength(30);
    expect(new Set(CORPUS_CATEGORIES).size).toBe(30);
    expect(CORPUS_CATEGORIES[8]).toBe('恐怖灵异'); // 16 项版本之后新增档位的锚点
    expect(CORPUS_CATEGORIES[29]).toBe('其他'); // 兜底分类恒为末位
  });

  it('标签恰 28 项、四组各 7 项且组内唯一', () => {
    expect(CORPUS_ALL_TAGS).toHaveLength(28);
    expect(GROUP_SIZES).toEqual([7, 7, 7, 7]);
    expect(new Set(CORPUS_ALL_TAGS).size).toBe(28);
    // 分组 key 稳定，i18n labelKey 齐备（渲染时 t(labelKey)）
    expect(CORPUS_TAG_GROUPS.map((g) => g.key)).toEqual(['tone', 'narrative', 'theme', 'reference']);
    for (const g of CORPUS_TAG_GROUPS) {
      expect(g.labelKey.startsWith('library.tagGroup'), g.key).toBe(true);
    }
  });

  it('分类与标签互不相交（正交可组合、回填不歧义）', () => {
    for (const cat of CORPUS_CATEGORIES) {
      expect(isCorpusTag(cat), `分类「${cat}」不应同时是标签`).toBe(false);
    }
    for (const tag of CORPUS_ALL_TAGS) {
      expect(isCorpusCategory(tag), `标签「${tag}」不应同时是分类`).toBe(false);
    }
  });

  it('判定函数只认清单内原样值', () => {
    expect(isCorpusCategory('玄幻')).toBe(true);
    expect(isCorpusCategory('')).toBe(false);
    expect(isCorpusCategory('玄幻小说')).toBe(false); // 归一化/模糊匹配一律不认
    expect(isCorpusTag('热血')).toBe(true);
    expect(isCorpusTag('群像')).toBe(true);
    expect(isCorpusTag('自定义标签')).toBe(false);
  });
});
