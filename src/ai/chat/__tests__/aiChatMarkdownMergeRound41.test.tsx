// aiChatMarkdownMergeRound41.test.tsx —— 阶段 B 批次 4「Markdown 渲染器并源」回归锁（2026-11-02 第四十一轮）。
//
// 病史：ChatMarkdown.tsx 与 aiMarkdown.tsx 是分叉副本（同 parseBlocks/流式修复/8 条缓存，只差
// 14 vs 11.5px 两套硬编码字号），对话页还多出链接/引用块/内联嵌套三样侧栏没有的能力。
// 并源后：aiMarkdown 是唯一真源，ChatMarkdown 只剩 fontSize=14 薄封装。
//
// 锁三组：
//   ① 薄壳纯度——ChatMarkdown 不许回潮出第二份解析器/缓存/字号副本。
//   ② 移植差集在位——aiMarkdown 收编链接（仅 http/https）、引用块、strong/em 内联递归。
//   ③ 行为锁——对话页与侧栏两条入口渲染语义一致；第 40 轮 STYLE_FILES 收编口径不回潮。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatMarkdown } from '../ChatMarkdown';
import { MarkdownView } from '../../../editor/panels/aiMarkdown';
import { t } from '../../../i18n';

(globalThis as unknown as Record<string, boolean>).IS_REACT_ACT_ENVIRONMENT = true;

// 否定式判据先剥注释再匹配（任务书陷阱⑥）；JSDoc 与行注释同样剥掉
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'));

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

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  document.body.innerHTML = '';
});

describe('批次4① · ChatMarkdown 薄壳纯度锁', () => {
  const src = read('src/ai/chat/ChatMarkdown.tsx');

  it('入口只剩对 aiMarkdown.MarkdownView 的转发（单一真源）', () => {
    expect(src).toMatch(/import \{ MarkdownView \} from '\.\.\/\.\.\/editor\/panels\/aiMarkdown'/);
    expect(src).toMatch(/<MarkdownView content=\{content\} streaming=\{streaming\} fontSize=\{14\} \/>/);
  });

  it('不许回潮出第二份解析器、流式缓存、代码卡或字号副本', () => {
    for (const symbol of ['parseBlocks', 'renderInline', 'splitStreamingMarkdown', 'highlightCode']) {
      expect(src).not.toContain(symbol);
    }
    expect(src).not.toMatch(/new Map/);
    expect(src).not.toMatch(/useState|useTheme|ContentCopyIcon|uiFontSize|vpx\(/);
    expect(src).not.toMatch(/\bfontSize:\s*-?\d/); // 壳内无字号字面量（裸 px 清零口径随薄壳自动化）
  });
});

describe('批次4② · 差集移植在位锁（aiMarkdown 单一真源）', () => {
  const src = read('src/editor/panels/aiMarkdown.tsx');

  it('链接语法进内联解析：切分正则与链接分支同在', () => {
    expect(src).toContain('\\[[^\\]\\n]+\\]\\([^)\\s]+\\)');
    expect(src).toContain('/^https?:\\/\\//i.test(url)'); // 危险协议闸：非 http/https 不产 a 标签
  });

  it('引用块分支在位：整段每行 > 开头才判引用', () => {
    expect(src).toContain('/^\\s*>\\s?/');
  });

  it('strong/em 内联递归解析（粗体里的 code 不再裸奔）', () => {
    expect(src).toMatch(/<strong key=\{key\}>\{renderInline\(part\.slice\(2, -2\), key\)\}<\/strong>/);
    expect(src).toMatch(/<em key=\{key\}>\{renderInline\(part\.slice\(1, -1\), key\)\}<\/em>/);
  });
});

describe('批次4③ · 行为锁：对话页入口', () => {
  it('安全链接渲染为 a（noopener/noreferrer/_blank），危险协议降级纯文本', async () => {
    await mount(<ChatMarkdown content={'[官网](https://example.com) 和 [危险](javascript:alert(1))'} />);
    const anchors = host?.querySelectorAll('a');
    expect(anchors?.length).toBe(1);
    expect(anchors?.[0].getAttribute('href')).toBe('https://example.com');
    expect(anchors?.[0].getAttribute('rel')).toContain('noopener');
    expect(textOf()).toContain('危险');
  });

  it('整段引用块去 > 前缀渲染，普通段落不受影响', async () => {
    await mount(<ChatMarkdown content={'> 引用一行\n> 引用二行\n\n普通段落'} />);
    expect(textOf()).toContain('引用一行');
    expect(textOf()).toContain('引用二行');
    expect(textOf()).toContain('普通段落');
    expect(textOf()).not.toContain('>');
  });

  it('粗体嵌套行内 code：strong 内产出 code 节点', async () => {
    await mount(<ChatMarkdown content={'粗体里有 **粗含 `代码` 的字** 结束'} />);
    const strong = host?.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.querySelector('code')?.textContent).toBe('代码');
  });

  it('代码块复制按钮走统一 i18n 口径（workbench.aiCode.copy，副本键 agent.chat.copy 已退役）', async () => {
    await mount(<ChatMarkdown content={'```ts\nconst a = 1;\n```'} />);
    const btn = host?.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe(t('workbench.aiCode.copy'));
  });
});

describe('批次4③ · 行为锁：工作台侧栏缺省变体同受益', () => {
  it('侧栏（无 fontSize）链接与引用块能力同在', async () => {
    await mount(<MarkdownView content={'参见 [文档](https://doc.example.com/a)\n\n> 侧栏引用'} />);
    expect(host?.querySelectorAll('a')?.length).toBe(1);
    expect(host?.querySelector('a')?.getAttribute('href')).toBe('https://doc.example.com/a');
    expect(textOf()).toContain('侧栏引用');
    expect(textOf()).not.toContain('>');
  });
});

describe('批次4③ · 第 40 轮 STYLE_FILES 收编口径不回潮', () => {
  it('aiChatStyleRound40 的裸 px 清单不再列 ChatMarkdown（薄壳后字号由真源承担）', () => {
    const round40 = read('src/editor/panels/__tests__/aiChatStyleRound40.test.tsx');
    expect(round40).not.toMatch(/'src\/ai\/chat\/ChatMarkdown\.tsx'/);
    expect(round40).toContain("'src/ai/chat/MessageBubble.tsx'");
  });
});
