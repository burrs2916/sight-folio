// TXT 导入纯函数口径测试（utils/writingImport）：
// 存量文本迁入的唯一分章口径——章标题正则、空行兜底、HTML 转义、字数。
import { describe, it, expect } from 'vitest';
import { splitChaptersFromText, textToChapterHtml, countChapterWords, escapeHtml } from '../writingImport';

describe('splitChaptersFromText —— 粘贴正文分章', () => {
  it('章标题行 ≥2 才按标题切：标题取行前 40 字、首标题前的内容并入第一章', () => {
    const raw = [
      '这是一段开篇引言。',
      '',
      '第一章 起点',
      '雨落在檐下。',
      '',
      '第二章 转折',
      '他没有回头。',
      '他翻到第一章之外的笔记，停了。', // 行首正文句含句读标点，不误切
    ].join('\n');
    const out = splitChaptersFromText(raw, '片段');
    expect(out.map((c) => c.title)).toEqual(['第一章 起点', '第二章 转折']);
    expect(out[0].body).toContain('这是一段开篇引言。');
    expect(out[0].body).toContain('雨落在檐下。');
    expect(out[1].body).toContain('他没有回头。');
    expect(out[1].body).toContain('他翻到第一章之外的笔记，停了。');
  });

  it('无标题：按空行大块切，块首行做标题；单块整体为单章（fallbackTitle）', () => {
    const out = splitChaptersFromText('第一段内容\n第二行\n\n另一个大块开头\n细节', '片段');
    expect(out.map((c) => c.title)).toEqual(['第一段内容', '另一个大块开头']);
    expect(out[0].body).toBe('第二行');
    const single = splitChaptersFromText('只有一段完整文本', '片段');
    expect(single).toEqual([{ title: '片段', body: '只有一段完整文本' }]);
    expect(splitChaptersFromText('   \n  ', '片段')).toEqual([]);
  });

  it('序章/番外/Chapter N 也识别为标题行；标题截 40 字', () => {
    const out = splitChaptersFromText('楔子 开端\n内容A\n\nChapter 2 The Turn\n内容B', '片段');
    expect(out.map((c) => c.title)).toEqual(['楔子 开端', 'Chapter 2 The Turn']);
    const long = splitChaptersFromText(
      `第一章 ${'长'.repeat(50)}\n内容\n\n第二章 ${'短'.repeat(50)}\n内容2`,
      '片段',
    );
    expect(long).toHaveLength(2);
    expect(long[0].title.length).toBe(40);
    expect(long[1].title.length).toBe(40);
  });
});

describe('textToChapterHtml / countChapterWords / escapeHtml', () => {
  it('换行切段、转义五类字符、空段跳过', () => {
    expect(textToChapterHtml('段一\n\n段二')).toBe('<p>段一</p><p>段二</p>');
    expect(textToChapterHtml('<b>&"\'</b>\n后行')).toBe('<p>&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;</p><p>后行</p>');
    expect(textToChapterHtml('  \n \n')).toBe('');
    expect(escapeHtml('a<b>&"\'c')).toBe('a&lt;b&gt;&amp;&quot;&#39;c');
  });

  it('字数去空白统计', () => {
    expect(countChapterWords('雨落 檐下\n第二行')).toBe(7);
    expect(countChapterWords('   ')).toBe(0);
  });
});
