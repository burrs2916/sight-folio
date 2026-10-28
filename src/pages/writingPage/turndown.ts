// 章节正文 HTML→Markdown 转换实例（导出 Markdown 用）
import TurndownService from 'turndown';

export const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

// 批次② T4：表格 → GFM 表格（turndown 默认把 table 文本化，会丢结构；导出 Markdown 时不丢表格）
turndown.addRule('table', {
  filter: 'table',
  replacement(_content, node) {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const lines: string[] = [];
    rows.forEach((row, ri) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map((c) =>
        (c.textContent ?? '').trim().replace(/\|/g, '\\|').replace(/\n/g, ' '),
      );
      if (cells.length === 0) return;
      lines.push(`| ${cells.join(' | ')} |`);
      // 表头行下补分隔行（GFM 必需）
      if (ri === 0 && row.querySelector('th')) {
        lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
      }
    });
    return `\n\n${lines.join('\n')}\n\n`;
  },
});

// 批次③ T9：图片显式规则——导出 Markdown 时 src 原样输出（data URI 内联 / 外部 URL /
// 相对路径均适用），不依赖 turndown 默认对未知协议的猜测，保证 <img> 只产出标准
// `![alt](src)` 语法且不丢 title。
turndown.addRule('imageDataUri', {
  filter: (node) => node.nodeName === 'IMG',
  replacement(_content, node) {
    const img = node as HTMLImageElement;
    const src = img.getAttribute('src') ?? '';
    if (!src) return '';
    const alt = img.getAttribute('alt') ?? '';
    const title = img.getAttribute('title');
    const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
    return `![${alt}](${src}${titlePart})`;
  },
});
