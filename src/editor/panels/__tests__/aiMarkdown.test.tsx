// sight-folio: aiMarkdown 流式增量渲染单元测试
// 覆盖：splitStreamingMarkdown 稳定边界切分、未闭合代码围栏不吞内容（围栏后的文字实时可见）、
// 增量渲染下历史文本保持不丢失。渲染方式与 ChatMarkdown.test.tsx 一致：react-dom/client 原生 createRoot + act。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { splitStreamingMarkdown, repairStreamingTailInline, MarkdownView } from '../aiMarkdown';

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
  await mount(<MarkdownView content="" streaming />);
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
});

describe('splitStreamingMarkdown', () => {
  it('空串返回全空', () => {
    expect(splitStreamingMarkdown('')).toEqual({ stable: '', tail: '', openFence: false });
  });

  it('单段无空行：整段视为不稳定尾部', () => {
    expect(splitStreamingMarkdown('第一段')).toEqual({ stable: '', tail: '第一段', openFence: false });
  });

  it('空行分隔：前段稳定，末段进尾部', () => {
    const s = splitStreamingMarkdown('第一段\n第二行\n\n第三段');
    expect(s.stable).toBe('第一段\n第二行\n\n');
    expect(s.tail).toBe('第三段');
    expect(s.openFence).toBe(false);
  });

  it('闭合代码围栏后立即稳定', () => {
    const s = splitStreamingMarkdown('说明\n\n```ts\nconst a = 1;\n```\n收尾');
    expect(s.openFence).toBe(false);
    expect(s.stable).toContain('```ts');
    expect(s.stable).toContain('```\n');
    expect(s.tail).toBe('收尾');
  });

  it('未闭合代码围栏：整段进尾部并标记 openFence（围栏后内容不被吞）', () => {
    const s = splitStreamingMarkdown('说明\n\n```ts\nconst a = 1;\n还有后续文本');
    expect(s.stable).toBe('说明\n\n');
    expect(s.tail).toBe('```ts\nconst a = 1;\n还有后续文本');
    expect(s.openFence).toBe(true);
  });
});

describe('repairStreamingTailInline', () => {
  it('空串原样返回', () => {
    expect(repairStreamingTailInline('')).toBe('');
  });

  it('未闭合 ** 在末尾补闭合（流式加粗不再裸星号）', () => {
    expect(repairStreamingTailInline('这句是 **重点内容')).toBe('这句是 **重点内容**');
  });

  it('未闭合 * 补闭合', () => {
    expect(repairStreamingTailInline('斜体 *中')).toBe('斜体 *中*');
  });

  it('未闭合 ` 补闭合', () => {
    expect(repairStreamingTailInline('行内 `代码中')).toBe('行内 `代码中`');
  });

  it('已闭合的标记不重复补', () => {
    expect(repairStreamingTailInline('**正常** 内容')).toBe('**正常** 内容');
    expect(repairStreamingTailInline('`code` 和 *it*')).toBe('`code` 和 *it*');
  });

  it('乘号/幂等非 flanking 星号不误补', () => {
    expect(repairStreamingTailInline('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(repairStreamingTailInline('a**b')).toBe('a**b');
    expect(repairStreamingTailInline('2 * 3')).toBe('2 * 3');
  });

  it('行内 code 内的星号不参与判定', () => {
    expect(repairStreamingTailInline('`a*b` 后')).toBe('`a*b` 后');
  });

  it('嵌套按 LIFO 逆序补全', () => {
    expect(repairStreamingTailInline('**外层 *内层')).toBe('**外层 *内层* **');
  });
});

describe('MarkdownView streaming', () => {
  it('流式中稳定段落立即以 Markdown 形态渲染', async () => {
    await act(async () => {
      root!.render(<MarkdownView content={'第一段正式内容'} streaming />);
    });
    expect(textOf()).toContain('第一段正式内容');
  });

  it('未闭合代码围栏：围栏后的文字实时可见（旧实现会被吞直到围栏闭合）', async () => {
    await act(async () => {
      root!.render(<MarkdownView content={'开始\n\n```ts\nconst a = 1;\n围栏还没闭合但这段文字必须可见'} streaming />);
    });
    expect(textOf()).toContain('开始');
    expect(textOf()).toContain('const a = 1;');
    expect(textOf()).toContain('围栏还没闭合但这段文字必须可见');
  });

  it('围栏闭合后恢复为代码块渲染（pre 高亮）', async () => {
    await act(async () => {
      root!.render(<MarkdownView content={'```ts\nconst a = 1;\n```'} streaming />);
    });
    const pre = host?.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('const a = 1;');
  });

  it('增量渲染：内容增长后历史文本保持且不丢失', async () => {
    await act(async () => {
      root!.render(<MarkdownView content={'第一段\n\n第二段'} streaming />);
    });
    await act(async () => {
      root!.render(<MarkdownView content={'第一段\n\n第二段\n\n第三段'} streaming />);
    });
    expect(textOf()).toContain('第一段');
    expect(textOf()).toContain('第二段');
    expect(textOf()).toContain('第三段');
  });

  it('流式中未闭合加粗标记以加粗形态实时渲染（不出现裸星号）', async () => {
    await act(async () => {
      root!.render(<MarkdownView content={'这是 **加粗中的内容'} streaming />);
    });
    expect(textOf()).not.toContain('**');
    expect(textOf()).toContain('加粗中的内容');
    const strong = host?.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('加粗中的内容');
  });

  it('流式中未闭合行内 code 以 code 形态实时渲染', async () => {
    await act(async () => {
      root!.render(<MarkdownView content={'变量 `count 递增中'} streaming />);
    });
    expect(textOf()).not.toContain('`');
    const codeEl = host?.querySelector('code');
    expect(codeEl).not.toBeNull();
    expect(codeEl?.textContent).toContain('count 递增中');
  });

  it('闭合后稳定段仍按普通 markdown 渲染（修补不干扰稳态）', async () => {
    await act(async () => {
      root!.render(<MarkdownView content={'这是 **加粗** 内容'} streaming />);
    });
    expect(textOf()).not.toContain('**');
    const strong = host?.querySelector('strong');
    expect(strong?.textContent).toBe('加粗');
  });
});
