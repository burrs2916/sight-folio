// 章节级自动修复纯函数取证（工作室校对一键修复，T2）
import { describe, it, expect } from 'vitest';
import { applyAutoFixesHtml, hasAutoFixableHtml, hasAutoFixableInText, wordCountOfHtml } from '../chapterAutoFix';

describe('applyAutoFixesHtml', () => {
  it('替换唯一候选错词（悬梁刺骨→悬梁刺股）并保留段落标签', () => {
    const { html, fixedCount } = applyAutoFixesHtml('<p>他悬梁刺骨地学习。</p>');
    expect(fixedCount).toBe(1);
    expect(html).toBe('<p>他悬梁刺股地学习。</p>');
  });

  it('三个中文句号 → 省略号（punct fix）', () => {
    const { html, fixedCount } = applyAutoFixesHtml('<p>他走了。。。</p>');
    expect(fixedCount).toBe(1);
    expect(html).toBe('<p>他走了……</p>');
  });

  it('跨多个文本节点逐处替换且保留内联标签', () => {
    const { html, fixedCount } = applyAutoFixesHtml('<p><strong>悬梁刺骨</strong>又<em>悬梁刺骨</em>了。</p>');
    expect(fixedCount).toBe(2);
    expect(html).toBe('<p><strong>悬梁刺股</strong>又<em>悬梁刺股</em>了。</p>');
  });

  it('无 fix 的问题（敏感词）不自动改动', () => {
    const html = '<p>他使用了某些违禁词汇。</p>';
    const { html: out, fixedCount } = applyAutoFixesHtml(html);
    expect(fixedCount).toBe(0);
    expect(out).toBe(html);
  });

  it('空内容与纯文本无标签兼容', () => {
    expect(applyAutoFixesHtml('').fixedCount).toBe(0);
    const { html, fixedCount } = applyAutoFixesHtml('他悬梁刺骨。');
    expect(fixedCount).toBe(1);
    expect(html).toBe('他悬梁刺股。');
  });
});

describe('hasAutoFixable*', () => {
  it('检测纯文本与 HTML 是否存在可修复项', () => {
    expect(hasAutoFixableInText('他悬梁刺骨。')).toBe(true);
    expect(hasAutoFixableHtml('<p>他悬梁刺骨。</p>')).toBe(true);
    expect(hasAutoFixableHtml('<p>他正常工作。</p>')).toBe(false);
  });
});

describe('wordCountOfHtml', () => {
  it('去空白统计字数（与写作台 countWords 同口径）', () => {
    expect(wordCountOfHtml('<p>他走了。</p>')).toBe(4);
    expect(wordCountOfHtml('<p> 你好 </p>')).toBe(2);
  });
});
