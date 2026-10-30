// 章详情「叙事节拍」区块的接线与词典审计（第七轮：头注释欠账兑现）
//
// 判定逻辑本身由 utils/__tests__/writingOutline.test.ts 的纯函数单测锁死；
// 这里锁两件事：
// ① 面板接线——「已导入」必须真的置灰按钮（防重复导入产生双胞胎草稿事件）、
//    点击必须走 createTimelineEvent 且携带 outlineId（数据即真相判定的根基，
//    丢了 outlineId 绑定，导入后就再也认不出"这条是那个节拍导的"）；
// ② 新文案键在双语词典齐备（缺键界面显示裸 key）。
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const src = readFileSync(`${ROOT}/src/pages/ChapterDetailsPanel.tsx`, 'utf8');

describe('章详情节区块接线', () => {
  it('导入动作绑定 outlineId——createTimelineEvent 必带节拍 id', () => {
    expect(src).toMatch(/createTimelineEvent\(\{[\s\S]*?outlineId:\s*beat\.id[\s\S]*?\}\)/);
  });

  it('已导入的节拍按钮置灰（disabled={imported …}），防重复导入', () => {
    expect(src).toMatch(/disabled=\{imported \|\| importingBeatId !== null\}/);
  });

  it('草稿事件 at 留空——落进「待补全草稿事件」工作台的约定语义', () => {
    expect(src).toMatch(/createTimelineEvent\(\{[\s\S]*?at:\s*''[\s\S]*?\}\)/);
  });

  it('节拍清单按 sortOrder 展示序（不改 beatsOfChapter 的保序契约，排序在消费方）', () => {
    expect(src).toMatch(/beatsOfChapter\(outlines, chapter\.id\)\.slice\(\)\.sort\(\(a, b\) => a\.sortOrder - b\.sortOrder\)/);
  });
});

describe('本轮新增文案键的词典审计', () => {
  const KEYS = [
    'writing.chapterBeatsTitle',
    'writing.chapterBeatsEmpty',
    'writing.chapterBeatImport',
    'writing.chapterBeatImported',
    'writing.chapterBeatImportDone',
    'writing.chapterBeatImportFail',
    'writing.inlineRangeStale',
    'writing.inlineRangeMoved',
    'writing.inlineWholeChapterHint',
  ];
  for (const file of ['zh-CN', 'en-US']) {
    for (const k of KEYS) {
      it(`${file}.json 含 ${k}`, () => {
        const dict = JSON.parse(readFileSync(`${ROOT}/src/i18n/${file}.json`, 'utf8'));
        const hit = k
          .split('.')
          .reduce<Record<string, unknown> | undefined>(
            (o, seg) => (o?.[seg] !== undefined ? (o[seg] as never) : undefined),
            dict as never,
          );
        expect(hit, `缺键 ${k}（界面会显示裸键）`).toBeTruthy();
      });
    }
  }
});
