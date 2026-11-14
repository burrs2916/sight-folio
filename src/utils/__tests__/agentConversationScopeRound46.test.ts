// 会话归属判定的回归锁（2026-11-04 全仓删除账 ③d）。
// 背景：ai_conversations 没有归属列，归属只能从标题的「 · 书名」段读。
// 旧实现 `title.includes(bookTitle)` 是**子串**匹配 —— 删《长夜》会连带删掉《长夜难明》的会话，
// 这是"删除误伤"里最恶性的一类，必须用断言钉死。
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  bookScopedConversations,
  conversationBelongsToBook,
  describeConversationTitles,
} from '../agentConversationScope';

const conv = (id: string, title: string) => ({ id, title });

describe('会话归属：按分隔符切段精确比对', () => {
  it('三种建会话写法都能认出来（AI 页 / 带章名 / 面板同名会话）', () => {
    expect(conversationBelongsToBook('新对话 · 长夜', '长夜')).toBe(true);
    expect(conversationBelongsToBook('新对话 · 长夜 › 第一章', '长夜')).toBe(true);
    expect(conversationBelongsToBook('语料参谋 · 长夜', '长夜')).toBe(true);
    expect(conversationBelongsToBook('写作台 · 长夜', '长夜')).toBe(true);
  });

  it('子串不再算命中：删《长夜》不得碰《长夜难明》（旧实现的误删）', () => {
    expect(conversationBelongsToBook('新对话 · 长夜难明', '长夜')).toBe(false);
    expect(conversationBelongsToBook('新对话 · 长夜难明 › 第一章', '长夜')).toBe(false);
    // 反向也要成立：书名更长时不能反过来吃掉短书名的会话
    expect(conversationBelongsToBook('新对话 · 长夜', '长夜难明')).toBe(false);
  });

  it('书名只出现在正文式标题里不算归属', () => {
    expect(conversationBelongsToBook('关于长夜的讨论', '长夜')).toBe(false);
  });

  it('空书名一律不匹配（没有书名就没有范围）', () => {
    expect(bookScopedConversations([conv('a', '新对话 · 长夜')], '')).toEqual([]);
    expect(bookScopedConversations([conv('a', '新对话 · 长夜')], null)).toEqual([]);
    expect(bookScopedConversations([conv('a', '新对话 · 长夜')], undefined)).toEqual([]);
  });

  it('结果保持传入顺序（侧栏分组与将删清单要用同一可见顺序）', () => {
    const list = [
      conv('1', '新对话 · 长夜'),
      conv('2', '画布优化'),
      conv('3', '语料参谋 · 长夜'),
      conv('4', '新对话 · 长夜难明'),
    ];
    expect(bookScopedConversations(list, '长夜').map((c) => c.id)).toEqual(['1', '3']);
  });
});

describe('将删清单文案（归属只能靠标题，所以边界必须看得见）', () => {
  it('5 条以内全列，超出折叠成「…等 N 个」', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(describeConversationTitles(five)).toBe('a、b、c、d、e');
    expect(describeConversationTitles([...five, 'f', 'g'])).toBe('a、b、c、d、e…等 7 个');
  });

  it('空清单返回空串，不返回「…等 0 个」这种谎话', () => {
    expect(describeConversationTitles([])).toBe('');
  });
});

describe('源码扫描锁：分组与删除必须同一把尺子', () => {
  const src = readFileSync(`${process.cwd()}/src/pages/AiAgentPage.tsx`, 'utf8');

  it('AiAgentPage 不许再出现 title.includes(...) 式的归属匹配', () => {
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => !line.trim().startsWith('//') && /title\.includes\(/.test(line));
    expect(offenders.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  it('归属判定只允许走 agentConversationScope 一个出口', () => {
    expect(src).toContain('bookScopedConversations');
    // 两步点击的旧态（confirmClear）已被全局确认卡取代，留着就是两张卡叠加
    expect(src).not.toContain('confirmClear');
  });
});
