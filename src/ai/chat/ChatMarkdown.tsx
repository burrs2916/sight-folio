// sight-folio: AI 对话页 Markdown 渲染入口（第 41 轮批次 4 并源后 = 薄封装）
//
// 病史：本文件曾是工作台侧栏 aiMarkdown.tsx 的分叉副本（同 parseBlocks/流式修复/8 条缓存，
// 只差 14 vs 11.5px 两套硬编码字号），两份实现各自漂移、修一漏一。
// 并源口径：解析/流式/代码卡/字号档位全部收归 aiMarkdown.MarkdownView 单一真源，
// 对话页只声明正文变体字号 14px（整树按 BODY_FONT_PX 比例缩放，倍率算术见 aiMarkdownScale.ts）。
// 原对话页特有的三样功能（[text](url) 仅 http/https、整段 > 引用块、strong/em 内嵌行内解析）
// 已在第 41 轮移植进 aiMarkdown，成为侧栏与对话页的统一能力；模块私有流式缓存随副本一同退场，
// 缓存按「变体倍率 + 前缀文本」隔离（见 aiMarkdown.tsx streamingStableCache 注释）。
// 保留本模块的原因：MessageBubble 等外部 import 面不断链（行为锁见 __tests__/ChatMarkdown.test.tsx）。

import { MarkdownView } from '../../editor/panels/aiMarkdown';

export interface ChatMarkdownProps {
  content: string;
  /** 流式输出中：稳定前缀走增量缓存（历史节点引用不变），尾部按字面渲染防闪烁 */
  streaming?: boolean;
}

/** 对话页 Markdown 渲染入口：aiMarkdown 的 14px 正文变体（复制按钮口径走 workbench.aiCode.* i18n） */
export function ChatMarkdown({ content, streaming }: ChatMarkdownProps) {
  return <MarkdownView content={content} streaming={streaming} fontSize={14} />;
}

export default ChatMarkdown;
