// sight-folio: ChatMarkdown 渲染逻辑单元测试
// 覆盖：代码块切分（复用 parseBlocks）、内联 code/bold/italic/link、标题/列表、
// 危险协议链接过滤、XSS 安全（零 innerHTML）。渲染方式与项目其他组件测试一致：
// react-dom/client 原生 createRoot + act。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { ChatMarkdown } from '../ChatMarkdown';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}
function textOf(): string {
  return host?.textContent || '';
}

beforeEach(async () => {
  await mount(<ChatMarkdown content="" />);
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
});

describe('ChatMarkdown', () => {
  it('renders plain paragraphs', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown content={'第一段\n第二段'} />);
    });
    expect(textOf()).toContain('第一段');
    expect(textOf()).toContain('第二段');
  });

  it('splits fenced code blocks from text', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown content={'说明如下：\n```ts\nconst a = 1;\n```\n完。'} />);
    });
    const pre = host?.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('const a = 1;');
    expect(textOf()).toContain('说明如下：');
    expect(textOf()).toContain('完。');
    expect(textOf()).toContain('ts'); // 头部语言标签
  });

  it('highlights code tokens inside code blocks (colored spans)', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown content={'```js\nconst x = "hi";\n```'} />);
    });
    const pre = host?.querySelector('pre');
    expect(pre).not.toBeNull();
    const colored = pre?.querySelectorAll('span[style*="color"]');
    expect(colored?.length ?? 0).toBeGreaterThan(0);
  });

  it('renders inline code, bold and italic', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown content={'使用 `npm i` 安装，**务必**关注，*斜体* 亦然'} />);
    });
    expect(host?.querySelectorAll('code').length ?? 0).toBeGreaterThanOrEqual(1);
    expect(host?.querySelector('strong')).not.toBeNull();
    expect(host?.querySelector('em')).not.toBeNull();
    expect(host?.querySelector('strong')?.textContent).toContain('务必');
  });

  it('renders markdown links as anchors with safe protocols only', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown content={'[官网](https://example.com) 和 [危险](javascript:alert(1))'} />);
    });
    const anchors = host?.querySelectorAll('a');
    expect(anchors?.length).toBe(1); // 危险链接不渲染为 <a>
    expect(anchors?.[0].getAttribute('href')).toBe('https://example.com');
    expect(textOf()).toContain('危险');
  });

  it('renders headings and lists', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown content={'# 标题\n\n- 甲\n- 乙'} />);
    });
    expect(host?.querySelector('ul')).not.toBeNull();
    expect(textOf()).toContain('标题');
    expect(textOf()).toContain('甲');
    expect(textOf()).toContain('乙');
    expect(host?.querySelector('strong')).toBeNull();
  });

  it('never uses innerHTML (XSS safety)', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown content={'<img src=x onerror=alert(1)> ```html\n<b>hi</b>\n```'} />);
    });
    expect(host?.querySelector('img')).toBeNull();
    expect(textOf()).toContain('<img src=x onerror=alert(1)>');
    expect(host?.querySelector('pre b')).toBeNull(); // 代码块内也是文本渲染
  });
});

describe('ChatMarkdown streaming 增量渲染', () => {
  it('流式未断行：正文整体仍可见（tail 按字面渲染不吞内容）', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown streaming content={'流式输出中'} />);
    });
    expect(textOf()).toContain('流式输出中');
  });

  it('流式代码块未闭合：围栏内代码按字面等宽渲染，不闪烁不吞内容', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown streaming content={'说明\n\n```ts\nconst a = 1;\n'} />);
    });
    const pre = host?.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('const a = 1;');
    expect(textOf()).toContain('说明');
  });

  it('流式稳定前缀 + 尾部标记修补：未闭合加粗实时生效不裸奔星号', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown streaming content={'第一段\n\n第二段加粗 **重点'} />);
    });
    // 稳定前缀「第一段」正常段落渲染
    expect(textOf()).toContain('第一段');
    // 尾部未闭合 ** 被修补闭合，不出现裸奔跑的星号结尾
    expect(textOf()).toContain('第二段加粗');
    expect(textOf()).toContain('重点');
    // 修补逻辑补上闭合符后星号不再裸奔（文本里只剩成对 **）
    const stars = textOf().match(/\*/g) ?? [];
    expect(stars.length % 2).toBe(0);
  });

  it('流式闭合后与静态渲染分段一致（稳定内容按 Markdown 解析，代码块成卡片）', async () => {
    await act(async () => {
      root!.render(<ChatMarkdown streaming content={'完\n\n```ts\nconst a = 1;\n```\n收尾\n\n后文'} />);
    });
    const pre = host?.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('const a = 1;');
    expect(textOf()).toContain('完');
    expect(textOf()).toContain('收尾');
    expect(textOf()).toContain('后文');
  });

  it('增量缓存隔离：对话页与工作台侧栏不共享缓存（各自样式独立）', async () => {
    // chatStreamingCache 是模块私有，无法直接断言；此测试保证 streaming 模式可多次挂载渲染不抛错
    await act(async () => {
      root!.render(<ChatMarkdown streaming content={'甲段\n\n乙段\n\n丙段'} />);
    });
    expect(textOf()).toContain('甲段');
    expect(textOf()).toContain('乙段');
    expect(textOf()).toContain('丙段');
  });
});
