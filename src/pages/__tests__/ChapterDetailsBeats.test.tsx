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

// —— 第八轮：节拍→草稿→正式事件 闭环最后一段「就地补时点」——
// 草稿事件（at 空）在章详情可见但此前只能删或跳体检工作台——任务链断在眼前。
// 这里锁接线：① 行内编辑器只在缺时点（!isComplete）时渲染；② 提交走
// updateTimelineEvent 且落的是 trim 后的值（空串不得写库——写了事件仍是不完整，
// 却抹掉了草稿痕迹）；③ 逐键不写库（无 onChange 直接落库的通路）。
describe('章详情草稿就地补时点接线', () => {
  it('行内编辑器仅对缺时点草稿渲染（完整事件不展示输入框）', () => {
    expect(src).toMatch(/!isComplete\(ev\)\s*&&\s*<DraftAtEditor\s+event=\{ev\}\s*\/>/);
  });
  it('提交走 updateTimelineEvent 且落 trim 后的非空值（空串拒写，防抹掉草稿痕迹）', () => {
    expect(src).toMatch(/updateTimelineEvent\(event\.id,\s*\{ at: v \}\)/);
    expect(src).toMatch(/const v = at\.trim\(\);\s*if \(saving \|\| v === '' \|\| v === savedRef\.current\) return;/);
  });
  it('逐键不写库：onChange 只更新本地草稿态，提交仅由失焦/回车触发', () => {
    const editor = src.slice(src.indexOf('function DraftAtEditor'), src.indexOf('/** 人物 / 场景共用绑定 chip'));
    expect(editor).not.toMatch(/onChange=\{[^}]*updateTimelineEvent/);
    expect(editor).toMatch(/onBlur=\{\(\) => void commit\(\)\}/);
    expect(editor).toMatch(/e\.key === 'Enter'/);
  });
  it('换事件重置本地态交给 key 重挂（不用 useEffect setState 反模式，savedRef 防同挂载内重复写库）', () => {
    const editor = src.slice(src.indexOf('function DraftAtEditor'), src.indexOf('/** 人物 / 场景共用绑定 chip'));
    // 不得在 DraftAtEditor 里用 useEffect 重置（React 反模式）
    expect(editor).not.toMatch(/useEffect\(/);
    // 已落账文本用 savedRef 防重复写库
    expect(editor).toMatch(/const savedRef = useRef\(''\);/);
    // 列表外层以 key={ev.id} 包裹，换事件即重挂——本地态自然归零
    expect(src).toMatch(/chapterTimelineEvents\.map\(\(ev\) => \(\s*<Box key=\{ev\.id\}/);
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
    'writing.chapterDraftAtHint',
    'writing.chapterDraftAtSaveFailed',
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
