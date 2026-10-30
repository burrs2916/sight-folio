// 左栏「章节」tab 视图态切书复位 · 回归锁（2026-10-31，第十轮）
//
// 事故：selectionMode / selectedChapterIds / chapterQuery 是 WritingPage 本地 state，
// 而 store.setActiveBook 只清 chapters/activeChapterId 等 store 字段，两份状态不同步：
// 到 B 书点「批量删除」时，store 侧 deleteChapter/setChapterVolume 按残留在
// selectedChapterIds 里的 A 书 id 查不到当前 chapters → 首行守卫静默 return，
// 对话框却照常提示「确认删除 N 章」并弹成功 = 假成功；底部继续显示幽灵「已选 N 章」；
// A 书搜索词带到 B 书把新章列表过滤成「无匹配」。
//
// 修法（WritingPage 切书 effect）：activeBookId 变化即 resetBatch() + setChapterQuery('')，
// 口径与 store 侧 setActiveBook 清 activeChapterId/activeSettingId 一致——换书即视图归零。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const pageSrc = readFileSync(`${ROOT}/src/pages/WritingPage.tsx`, 'utf8');

describe('左栏批量/检索态切书复位接线', () => {
  it('页面必须解构并使用 resetBatch（此前导出却从未被调用 = 缺口）', () => {
    expect(pageSrc).toMatch(/const \{[^}]*resetBatch[^}]*\} =\s*\n?\s*useBatchOperations\(\)/);
  });

  it('存在以 activeBookId 为依赖、同时复位批量态与章节搜索词的 effect', () => {
    // 定位含 resetBatch + setChapterQuery 的 effect 体
    const m = pageSrc.match(
      /useEffect\(\s*\(\) => \{[\s\S]*?resetBatch\(\);[\s\S]*?setChapterQuery\(''\);[\s\S]*?\}, \[[^\]]*activeBookId[^\]]*resetBatch[^\]]*\]\);/,
    );
    expect(m).not.toBeNull();
  });

  it('复位 effect 依赖数组含 activeBookId（换书即触发）', () => {
    const depIdx = pageSrc.indexOf('resetBatch();');
    expect(depIdx).toBeGreaterThan(-1);
    const tail = pageSrc.slice(depIdx, depIdx + 200);
    expect(tail).toMatch(/\[[^\]]*activeBookId[^\]]*\]/);
  });
});
