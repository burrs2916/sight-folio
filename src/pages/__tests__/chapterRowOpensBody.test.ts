// 写作台「点章落在哪一页」的接线锁（2026-11-07 李先生定口径）。
//
// 病灶：目录树点章后追加的动作把右栏切到「章详情」，于是每次点章都先停在元信息页上，
// 要再点一次「正文」才开始写。作者的主任务是写字，默认位必须给正文。
//
// 为什么用源码审计而不是组件渲染测试：这条口径的全部逻辑就是 WritingPage 传给
// ChapterTreePanel 的那个回调里的一行 setRightTab(...)，而 WritingPage 是五千多行、
// 依赖 tauri invoke 的整页组件，为它搭一套可渲染替身的成本远高于它在这里能买到的保护。
// 组件侧的契约（点行要带章 id 调用打开回调）另有 ChapterTreePanel.test.tsx 钉住。
//
// 关键是那条**正控**：章详情的常驻入口必须还在。少了它，这个审计会因为「details 被整体
// 删光」而假绿——那正是把功能删了却测成通过的写法。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src/pages/WritingPage.tsx');
const src = readFileSync(SRC, 'utf8');

/** 取 `marker` 之后到该回调闭合 `}}` 之间的源码片段。 */
function callbackBody(marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `WritingPage 里找不到 ${marker}`).toBeGreaterThanOrEqual(0);
  const tail = src.slice(at);
  const end = tail.indexOf('}}');
  expect(end, `${marker} 的回调没有闭合`).toBeGreaterThan(0);
  return tail.slice(0, end);
}

describe('写作台点章的默认落点', () => {
  it('目录树点章 = 落正文（右栏不再抢默认位给章详情）', () => {
    const body = callbackBody('onChapterOpened={(id) => {');
    expect(body).toContain("setRightTab('body')");
    expect(body).not.toContain("setRightTab('details')");
    // 落点之外该做的两件事不能丢：选中这一章、收起可能遮蔽正文的设定卡
    expect(body).toContain('setActiveChapter(id)');
    expect(body).toContain('setActiveSetting(null)');
  });

  it('正控：章详情仍有常驻入口（抽屉那颗按钮照常切 details，不许被一起删掉）', () => {
    const body = callbackBody('onOpenChapterDetails={() => {');
    expect(body).toContain("setRightTab('details')");
  });
});
