// 整章改写落点守卫（需求缺口⑤，第十二轮批②）· 回归锁
//
// 行为锁：decideFullTextApply 三种判定——
// ① 发起后正文未动 → apply（正常覆盖，零回归）；
// ② 发起后正文被改动（用户在 30s+ 生成期间继续写了字）→ reject-changed（拒绝覆盖）；
// ③ 快照缺失（异常路径/旧结果）→ apply（与既有无锚点放行口径一致，不卡死正常流程）；
// ④ 跨章兜底（章 id 变了）→ reject-changed（绝不用 A 章结果覆盖 B 章）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideFullTextApply } from '../inlineRangeGuard';

describe('decideFullTextApply 整章覆盖判定', () => {
  const anchor = { chapterId: 'c1', text: '第一章原文' };

  it('正文未动：放行覆盖（零回归路径）', () => {
    expect(decideFullTextApply(anchor, { chapterId: 'c1', text: '第一章原文' })).toBe('apply');
  });

  it('生成期间正文被改动：拒绝覆盖（用户新写的字不能被静默吞掉）', () => {
    expect(decideFullTextApply(anchor, { chapterId: 'c1', text: '第一章原文 + 期间新写的段落' })).toBe(
      'reject-changed',
    );
  });

  it('快照缺失：放行（与既有无锚点路径口径一致）', () => {
    expect(decideFullTextApply(null, { chapterId: 'c1', text: '任意' })).toBe('apply');
  });

  it('跨章兜底：章变了即使文本巧合相同也拒绝', () => {
    expect(decideFullTextApply(anchor, { chapterId: 'c2', text: '第一章原文' })).toBe('reject-changed');
  });
});

// 接线锁：useAiActions 的发起/应用/跨章清理三点必须都接上守卫，漏一处即破防。
describe('useAiActions 整章守卫接线', () => {
  const src = readFileSync(`${process.cwd()}/src/pages/writingPage/useAiActions.ts`, 'utf8');

  it('发起时按选区有无落快照：无选区记整章文本 + 章 id', () => {
    expect(src).toMatch(/inlineFullTextRef\.current = selectionRange[\s\S]{0,120}?chapterId: activeChapter\?\.id/);
  });

  it('应用无选区分支：setContent 前必须先过 decideFullTextApply，拒绝路径不落笔', () => {
    const apply = src.slice(src.indexOf('const handleApplyInlineResult'), src.indexOf('const openSettingAi'));
    const guardAt = apply.indexOf('decideFullTextApply');
    const setContentAt = apply.indexOf('editor.commands.setContent(html)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(setContentAt).toBeGreaterThan(guardAt); // 守卫在覆盖之前
    expect(apply).toContain("writing.inlineFullTextStale");
  });

  it('跨章守卫同步清理整章快照（防旧章快照配新章 id 误判）', () => {
    const crossChapter = src.slice(
      src.indexOf('inlineChapterIdRef.current !== nextId'),
      src.indexOf('setInlineResult(null);\n      inlineSelectionRef.current = null;') + 120,
    );
    expect(crossChapter).toContain('inlineFullTextRef.current = null;');
  });
});
