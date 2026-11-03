// aiChatStyleRound40.test.tsx —— 阶段 B 批次 3「对话框风格」回归锁（2026-11-02 第四十轮）。
//
// 病史：工作室/对话页 AI 气泡是四套实现里唯一不跑 Markdown 的（写作台弹窗回复 = 裸 Typography
// pre-wrap）；约 115 处裸 px 字号不吃「设置 → 字体大小」档位；三处深色档写死颜色不跟皮肤。
//
// 锁四组：
//   ① 对话框文件剥注释后 fontSize 不许再出现裸数字（清零判据读源文件，本仓 rg 跳 __tests__；
//     第 40 轮为 8 文件，第 41 轮批次 4 把 ChatMarkdown 薄壳并入 aiMarkdown 后收编为 7 文件）。
//   ② WritingAiChatDialog 助手回复必须走 aiMarkdown.MarkdownView（含流式气泡），用户消息保持纯文本。
//   ③ aiMarkdown fontSize 变体机制（variantScale/vpx 算术 + 流式缓存按变体隔离的接线锁）。
//   ④ 深色档三处：InlineChat 浮窗底 / workbenchComponents 爆炸半径条 / aiToolSteps 展开详情下限。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownView } from '../aiMarkdown';
import { variantScale, vpx, BODY_FONT_PX } from '../aiMarkdownScale';

(globalThis as unknown as Record<string, boolean>).IS_REACT_ACT_ENVIRONMENT = true;

// 否定式判据先剥注释再匹配（任务书陷阱⑥）；JSDoc 与行注释同样剥掉
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'));

// 第 41 轮批次 4：ChatMarkdown.tsx 已薄封装为 MarkdownView 的 fontSize=14 变体，文件内不再有
// 任何字号字面量，也不再直接调用 uiFontSize/vpx（口径由 aiMarkdown 真源承担），故从本清单移除；
// 薄壳本体与移植功能的锁在 src/ai/chat/__tests__/aiChatMarkdownMergeRound41.test.tsx。
const STYLE_FILES = [
  'src/ai/chat/MessageBubble.tsx',
  'src/ai/chat/ToolCallCard.tsx',
  'src/editor/panels/aiMarkdown.tsx',
  'src/editor/panels/aiToolSteps.tsx',
  'src/editor/panels/InlineChat.tsx',
  'src/ai/WelcomeView.tsx',
  'src/pages/WritingAiChatDialog.tsx',
];

describe('批次3① · 裸 px 字号清零锁（第 41 轮收编后 · 7 文件）', () => {
  it.each(STYLE_FILES)('%s 剥注释后不许出现 fontSize 裸数字（第 41 轮起 7 文件，ChatMarkdown 薄壳化另锁）', (p) => {
    expect(read(p)).not.toMatch(/\bfontSize:\s*-?\d/);
  });

  it('收尾文件必须真的接了档位字号通道（防止整段被误删造成的假清零）', () => {
    for (const p of STYLE_FILES) {
      // aiMarkdown 走变体模块 vpx()（内部 uiFontSize），其余文件直接 uiFontSize()
      expect(read(p)).toMatch(/uiFontSize\(|vpx\(/);
    }
  });

  it('变体算术真源单独成模块（react-refresh 边界 + 批次 4 共用倍率口径）', () => {
    const scaleSrc = read('src/editor/panels/aiMarkdownScale.ts');
    expect(scaleSrc).toMatch(/export const BODY_FONT_PX = 11\.5/);
    expect(scaleSrc).toMatch(/uiFontSize\(Math\.round\(px \* k \* 100\) \/ 100\)/);
    expect(read('src/editor/panels/aiMarkdown.tsx')).toMatch(/from '.\/aiMarkdownScale'/);
  });
});

describe('批次3① · WritingAiChatDialog 回复接入 MarkdownView', () => {
  const src = read('src/pages/WritingAiChatDialog.tsx');

  it('从 aiMarkdown 引入 MarkdownView（复用工作台渲染器，不再 fork）', () => {
    expect(src).toMatch(/import \{ MarkdownView \} from '..\/editor\/panels\/aiMarkdown'/);
  });

  it('历史助手消息走 MarkdownView（fontSize 13 变体保持弹窗正文视觉不回归）', () => {
    expect(src).toMatch(/<MarkdownView content=\{m\.content\} fontSize=\{13\} \/>/);
    expect(src).toMatch(/m\.role === 'user' \?/); // 用户消息保持纯文本分支在位
  });

  it('流式气泡走 MarkdownView streaming 模式（尾修补/未闭合围栏能力同步获得）', () => {
    expect(src).toMatch(/<MarkdownView content=\{streamText\}[^>]*streaming/);
    expect(src).not.toMatch(/\}\}>\{streamText\}</); // 旧裸 Typography 插值不许回潮
  });
});

describe('批次3①/④ · aiMarkdown fontSize 变体机制', () => {
  it('工作台侧栏默认正文 11.5px（默认值漂移即红：变体倍率全以它为分母）', () => {
    expect(BODY_FONT_PX).toBe(11.5);
  });

  it('variantScale：缺省/非法回 1，合法值按正文比例', () => {
    expect(variantScale(undefined)).toBe(1);
    expect(variantScale(11.5)).toBe(1);
    expect(variantScale(0)).toBe(1);
    expect(variantScale(-5)).toBe(1);
    expect(variantScale(23)).toBe(2);
    expect(variantScale(13)).toBeCloseTo(13 / 11.5);
  });

  it('vpx：先乘倍率再进 uiFontSize，浮点在两位小数处收口（13px 变体不许产出 12.99999…）', () => {
    expect(vpx(11.5, 1)).toBe('calc(11.5px * var(--app-font-scale, 1))');
    expect(vpx(11.5, variantScale(13))).toBe('calc(13px * var(--app-font-scale, 1))');
    expect(vpx(9.5, 2)).toBe('calc(19px * var(--app-font-scale, 1))');
  });

  it('流式增量缓存按变体隔离（不带变体键则后到变体静默错套先到字号）', () => {
    const src = read('src/editor/panels/aiMarkdown.tsx');
    expect(src).toMatch(/streamingStableCache\.set\(cacheKeyOf\(k, stable\)/);
    expect(src).not.toMatch(/streamingStableCache\.set\(stable, nodes\)/);
  });

  it('MarkdownView 缺省渲染与 13px 变体渲染的内容语义一致（标题/加粗/代码块都在）', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const content = '段落 **重点**\n\n```ts\nconst a = 1;\n```';
    try {
      await act(async () => {
        root.render(<MarkdownView content={content} />);
      });
      expect(host.textContent).toContain('段落');
      expect(host.querySelector('strong')?.textContent).toBe('重点');
      expect(host.querySelector('pre')?.textContent).toContain('const a = 1;');

      await act(async () => {
        root.render(<MarkdownView content={content} fontSize={13} />);
      });
      expect(host.textContent).toContain('段落');
      expect(host.querySelector('strong')?.textContent).toBe('重点');
      expect(host.querySelector('pre')?.textContent).toContain('const a = 1;');

      await act(async () => {
        root.render(<MarkdownView content={'流式 **加粗中'} fontSize={13} streaming />);
      });
      expect(host.querySelector('strong')?.textContent).toBe('加粗中'); // 变体下尾修补仍生效
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

describe('批次3③ · 深色档三处锁', () => {
  it('InlineChat 浮窗底吃当前皮肤 paper 通道，GitHub 深灰/纯白写死值不许回潮', () => {
    const src = read('src/editor/panels/InlineChat.tsx');
    expect(src).not.toMatch(/rgba\(13,\s*17,\s*23/);
    expect(src).toMatch(/--template-palette-background-paperChannel\) \/ 0\.98\)/);
  });

  it('workbenchComponents 爆炸半径条走 warning 通道且带 dark 分支', () => {
    const src = read('src/editor/panels/workbenchComponents.tsx');
    expect(src).not.toMatch(/rgba\(255,\s*152,\s*0/);
    expect(src).toMatch(/--template-palette-warning-mainChannel\) \/ 0\.12\)/); // dark
    expect(src).toMatch(/--template-palette-warning-mainChannel\) \/ 0\.05\)/); // light
  });

  it('aiToolSteps 展开详情：字号下限 10/10.5 且正文走 text.primary（9px 弱色不可读不许回潮）', () => {
    const src = read('src/editor/panels/aiToolSteps.tsx');
    expect(src).toMatch(/fontSize: uiFontSize\(10\.5\)[\s\S]*color: 'text\.primary'/);
    expect(src).not.toMatch(/fontSize: uiFontSize\(9(\.5)?\)/);
    expect(src).toMatch(/color: failed \? 'error\.main' : 'text\.primary'/);
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});
