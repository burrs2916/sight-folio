// 工作室 AI 会话标题 · 回归锁（2026-10-31，第十四轮）
//
// 病灶：ensureConversation 建会话时标题恒用 `工作台 · {activeFile.name ?? '?'}`。
// 书场景（novel-zh）没有 activeFile（画布不绑源码文件），于是工作室里每开一轮
// 新对话标题都是「工作台 · ·?」——历史列表全部同名，创作者根本分不清哪轮聊的
// 是哪本书、哪个问题（写长篇常几十轮对话，同名 = 历史形同虚设）。
//
// 修法：抽出 resolveConvTitle 纯函数按场景分流——书场景带书名（《长夜》），
// 书名未就绪退化「工作室 AI 对话」；代码场景维持原口径不变。
import { describe, it, expect } from 'vitest';
import { resolveConvTitle } from '../workbenchPanelHooks';

describe('resolveConvTitle 场景分流', () => {
  it('书场景带书名 → 标题含书名', () => {
    const title = resolveConvTitle({ isBookScene: true, bookTitle: '长夜' });
    expect(title).toContain('长夜');
    // 绝不能再是 '?' 占位
    expect(title).not.toContain('?');
  });
  it('书场景书名未就绪 → 退化可辨标题（非问号）', () => {
    const title = resolveConvTitle({ isBookScene: true, bookTitle: null });
    expect(title).not.toContain('?');
    expect(title.length).toBeGreaterThan(0);
    // 与带书名时不同（书名缺失也要有独立可辨文案）
    expect(title).not.toBe(resolveConvTitle({ isBookScene: true, bookTitle: '长夜' }));
  });
  it('代码场景维持原口径（activeFile.name）', () => {
    expect(resolveConvTitle({ isBookScene: false, activeFileName: 'App.tsx' })).toContain('App.tsx');
  });
  it('代码场景无文件时回退 ?（旧行为保留）', () => {
    expect(resolveConvTitle({ isBookScene: false, activeFileName: null })).toContain('?');
  });
});
