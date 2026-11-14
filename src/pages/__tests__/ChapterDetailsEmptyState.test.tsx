// 章详情空态布局回归锁（2026-10-31，第九轮布局修复）
//
// 事故场景：未选中章（删完/切无章书）时点「章详情」tab——
// ① 九维统筹卡（ChapterOverviewPanel）因 chapterId 空自显示「无章上下文」占位，
//    叠在下方 ChapterDetailsPanel 自己的「未选中章」空态之上，同一屏出现
//    **两个空态上下堆叠**，即「切到章详情布局就乱」在空态场景的残留病灶。
// ② 章详情空态容器写 `flex:1 + justifyContent:center`，但外层 details 容器是
//    block 滚动区（非 flex 父），flex:1（flex-grow）在此完全不生效 → 提示文字
//    贴顶不居中，像渲染坏了。
// 修法：details 分支统筹卡外层加 `{activeChapterId && (...)}`——空态统一交给
// ChapterDetailsPanel 一个出口；空态容器改 `minHeight:100%` 撑满滚动视口高，
// justify 居中真正生效。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const pageSrc = readFileSync(`${ROOT}/src/pages/WritingPage.tsx`, 'utf8');
const panelSrc = readFileSync(`${ROOT}/src/pages/ChapterDetailsPanel.tsx`, 'utf8');

describe('章详情空态布局接线', () => {
  it('details 分支：九维统筹卡仅在 activeChapterId 存在时渲染（防双空态堆叠）', () => {
    // 取 details 分支片段（从渲染链起点到设定卡分支前）。
    // 2026-11-07 链首多了「归类节点 → 只读卷概览」这一臂（卷不该拿到可编辑正文框），
    // 锚点因此跟着链首走；下面三条断言一字未改。
    const details = pageSrc.slice(
      pageSrc.indexOf('{activeNodeIsGrouping && activeChapter ? ('),
      pageSrc.indexOf(') : activeSetting ? ('),
    );
    expect(details).toMatch(/\{activeChapterId && \(/);
    // 且统筹卡调用必须整体在该守卫之内（守卫出现位置早于 ChapterOverviewPanel）
    expect(details.indexOf('{activeChapterId && (')).toBeLessThan(details.indexOf('<ChapterOverviewPanel'));
    // ChapterDetailsPanel 无条件渲染（空态出口唯一）
    expect(details).toMatch(/<ChapterDetailsPanel/);
  });

  it('章详情空态：用 minHeight:100% 撑满滚动容器（不依赖 block 父里无效的 flex:1）', () => {
    const empty = panelSrc.slice(
      panelSrc.indexOf('if (!chapter) {'),
      panelSrc.indexOf('const cover = parseChapterCover'),
    );
    expect(empty).toMatch(/minHeight: '100%'/);
    expect(empty).not.toMatch(/flex: 1/);
    expect(empty).toMatch(/justifyContent: 'center'/);
  });

  it('正文态（activeChapterId 存在）统筹卡零回归：fit=content 传参不动', () => {
    expect(pageSrc).toMatch(/<ChapterOverviewPanel[\s\S]{0,200}?fit="content"/);
  });
});
