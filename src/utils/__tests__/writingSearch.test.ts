// 全书搜索纯函数口径测试（utils/writingSearch）：
// 长篇跨章检索的唯一口径——剥标签、大小写不敏感、片段上下文、空查询短路。
import { describe, it, expect } from 'vitest';
import { stripTags, searchBookInChapters } from '../writingSearch';
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
    ch('c3', '第三章', '<p>Rain falls on the stone.</p>'),
  ];

  it('跨章命中：每章返回命中总数与片段（上下文 ±30 字符）', () => {
    const hits = searchBookInChapters(chapters, '雨落');
    expect(hits.map((h) => h.chapterId)).toEqual(['c1']);
    expect(hits[0].count).toBe(2);
    expect(hits[0].snippets.length).toBe(2);
    expect(hits[0].snippets[0].match).toBe('雨落');
    expect(hits[0].snippets[1].before).toContain('她数着雨。');
  });

  it('大小写不敏感；空查询与无命中都返回空数组', () => {
    expect(searchBookInChapters(chapters, 'rain')[0].chapterId).toBe('c3');
    expect(searchBookInChapters(chapters, '')).toEqual([]);
    expect(searchBookInChapters(chapters, '   ')).toEqual([]);
    expect(searchBookInChapters(chapters, '不存在的词')).toEqual([]);
  });

  it('每章片段默认封顶 3 条，但 count 记全量', () => {
    const many = ch('cx', '章', '<p>喵</p>'.repeat(8));
    const hits = searchBookInChapters([many], '喵');
    expect(hits[0].count).toBe(8);
    expect(hits[0].snippets.length).toBe(3);
  });
});
