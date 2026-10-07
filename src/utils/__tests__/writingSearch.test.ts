// 全书搜索纯函数口径测试（utils/writingSearch）：
// 长篇跨章检索的唯一口径——剥标签、大小写、正则、片段上下文、空查询短路、HTML 安全替换。
import { describe, it, expect } from 'vitest';
import { stripTags, searchBookInChapters, replaceTextInHtml, compileSearchPattern } from '../writingSearch';
import type { WritingChapter } from '../../services/tauri';

const ch = (id: string, title: string, content: string): Pick<WritingChapter, 'id' | 'title' | 'content'> => ({
  id,
  title,
  content,
});

describe('stripTags', () => {
  it('标签剥为空格（防相邻文字粘连），空白折叠并去首尾', () => {
    expect(stripTags('<p>雨落&lt;在&gt;檐</p><p>下</p>')).not.toContain('<');
    expect(stripTags('<p>雨落</p><p>檐下</p>')).toBe('雨落 檐下');
  });
});

describe('searchBookInChapters —— 全书跨章搜索', () => {
  const chapters = [
    ch('c1', '第一章', '<p>雨落在檐下，她数着雨。</p><p>雨落在青石。</p>'),
    ch('c2', '第二章', '<p>他没有回头。</p>'),
    ch('c3', '第三章', '<p>Rain falls on the stone. rain again.</p>'),
  ];

  it('跨章命中：每章返回命中总数与片段（上下文 ±30 字符）', () => {
    const hits = searchBookInChapters(chapters, '雨落');
    expect(hits.map((h) => h.chapterId)).toEqual(['c1']);
    expect(hits[0].count).toBe(2);
    expect(hits[0].snippets.length).toBe(2);
    expect(hits[0].snippets[0].match).toBe('雨落');
    expect(hits[0].snippets[1].before).toContain('她数着雨。');
  });

  it('大小写不敏感（默认）；空查询与无命中都返回空数组', () => {
    expect(searchBookInChapters(chapters, 'rain')[0].chapterId).toBe('c3');
    expect(searchBookInChapters(chapters, 'RAIN')[0].chapterId).toBe('c3');
    expect(searchBookInChapters(chapters, '')).toEqual([]);
    expect(searchBookInChapters(chapters, '   ')).toEqual([]);
    expect(searchBookInChapters(chapters, '不存在的词')).toEqual([]);
  });

  it('区分大小写：Rain 只命中大写原始串', () => {
    const hits = searchBookInChapters(chapters, 'rain', { caseSensitive: true });
    expect(hits[0].chapterId).toBe('c3');
    expect(hits[0].count).toBe(1);
    expect(hits[0].snippets[0].match).toBe('rain');
    expect(searchBookInChapters(chapters, 'RAIN', { caseSensitive: true })).toEqual([]);
  });

  it('正则模式：按表达式匹配并可区分大小写', () => {
    const hits = searchBookInChapters(chapters, 'r[a-z]+n', { useRegex: true });
    expect(hits[0].chapterId).toBe('c3');
    expect(hits[0].count).toBe(2);
    const csHits = searchBookInChapters(chapters, '^Rain', { useRegex: true, caseSensitive: true });
    expect(csHits[0].count).toBe(1);
    expect(searchBookInChapters(chapters, '^rain', { useRegex: true, caseSensitive: true })).toEqual([]);
  });

  it('非法正则返回空数组（不抛出）', () => {
    expect(searchBookInChapters(chapters, '[a-', { useRegex: true })).toEqual([]);
  });

  it('零宽正则不死循环且正确计数', () => {
    const hits = searchBookInChapters([ch('cx', '章', '<p>ab</p>')], '.*?', {
      useRegex: true,
      maxSnippetsPerChapter: 3,
    });
    expect(hits.length).toBe(1);
    expect(hits[0].count).toBeGreaterThan(0);
  });

  it('每章片段默认封顶 3 条，但 count 记全量', () => {
    const many = ch('cx', '章', '<p>喵</p>'.repeat(8));
    const hits = searchBookInChapters([many], '喵');
    expect(hits[0].count).toBe(8);
    expect(hits[0].snippets.length).toBe(3);
  });
});

describe('replaceTextInHtml —— 保留标签结构的文本替换', () => {
  it('字面量替换：保留标签、多处处替换', () => {
    expect(replaceTextInHtml('<p>雨落</p><p>雨落</p>', '雨落', '雪')).toBe('<p>雪</p><p>雪</p>');
  });

  it('区分大小写：默认不敏感，开启后只替换大小写一致的', () => {
    expect(replaceTextInHtml('<p>Rain rain</p>', 'rain', '雪')).toBe('<p>雪 雪</p>');
    expect(replaceTextInHtml('<p>Rain rain</p>', 'rain', '雪', { caseSensitive: true })).toBe('<p>Rain 雪</p>');
  });

  it('正则替换 + 大小写组合', () => {
    expect(replaceTextInHtml('<p>a1 b22</p>', '\\d+', 'N', { useRegex: true })).toBe('<p>aN bN</p>');
    expect(replaceTextInHtml('<p>Hello hello</p>', '^hello', 'Hi', { useRegex: true, caseSensitive: true })).toBe(
      '<p>Hello hello</p>',
    );
    expect(replaceTextInHtml('<p>hello hello</p>', '^hello', 'Hi', { useRegex: true, caseSensitive: true })).toBe(
      '<p>Hi hello</p>',
    );
  });

  it('非法正则原样返回', () => {
    expect(replaceTextInHtml('<p>x</p>', '[a-', 'y', { useRegex: true })).toBe('<p>x</p>');
  });

  it('replacement 中的 $ 不展开（字面量对待）', () => {
    expect(replaceTextInHtml('<p>a</p>', 'a', '$1')).toBe('<p>$1</p>');
  });
});

describe('compileSearchPattern —— 选项口径', () => {
  it('空查询返回 null；字面量自动转义特殊字符', () => {
    expect(compileSearchPattern('  ')).toBeNull();
    const re = compileSearchPattern('a.b', {});
    expect(re?.source).toContain('\\.');
  });

  it('非法正则返回 null', () => {
    expect(compileSearchPattern('[a-', { useRegex: true })).toBeNull();
  });
});
