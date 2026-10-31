// buildFollowups 书场景「下一步追问」按题材分流回归锁（2026-10-31 第十五轮 批次4）。
//
// 锁定两件事：
//   ① 联动 bug：stats 题材给「对照目标评估进度」专属追问，不再错用通用「润色上面这段正文」
//      （统计视图里 AI 给的是数据结论，正文向追问完全错位）——也依赖调用方把 ctx.bookTopic
//      挂进 useMemo 依赖（见 workbenchPanelHooks），本函数保证给定 bookTopic 输出正确分流。
//   ② overview 保持 4 条跨维度体检；其余书题材保持通用写作向 3 条；代码场景不受影响。
import { describe, it, expect } from 'vitest';
import { buildFollowups } from '../workbenchPanelHooks';

const base = { hasActiveFile: false, producedCode: false, hasDiagnostics: false, hasScope: false };
const keys = (list: ReturnType<typeof buildFollowups>) => list.map((x) => x.key);

describe('buildFollowups · 书场景题材分流', () => {
  it('stats：目标评估专属追问（呼应已注入的目标/进度语料）', () => {
    const out = buildFollowups({ ...base, isBookScene: true, bookTopic: 'stats' });
    expect(keys(out)).toEqual(['statsGoal', 'statsPlan', 'statsBlocker']);
    expect(out.length).toBeLessThanOrEqual(3);
    // 不含任何「正文向」通用追问
    expect(keys(out)).not.toContain('improve');
    expect(keys(out)).not.toContain('continue');
  });

  it('overview：4 条跨维度体检追问', () => {
    const out = buildFollowups({ ...base, isBookScene: true, bookTopic: 'overview' });
    expect(out).toHaveLength(4);
    expect(keys(out)).toEqual(['ovTimeline', 'ovForeshadow', 'ovOrphan', 'ovLoose']);
  });

  it('其余书题材（characters/catalog/writing…）：通用写作向 3 条', () => {
    for (const t of ['characters', 'worldview', 'catalog', 'writing', 'proofread', 'inspiration']) {
      const out = buildFollowups({ ...base, isBookScene: true, bookTopic: t });
      expect(keys(out)).toEqual(['improve', 'consistency', 'continue']);
    }
  });

  it('代码场景：不出现书向追问', () => {
    const out = buildFollowups({ hasActiveFile: true, producedCode: true, hasDiagnostics: false, hasScope: false });
    expect(keys(out)).not.toContain('statsGoal');
    expect(keys(out)).not.toContain('improve');
  });
});
