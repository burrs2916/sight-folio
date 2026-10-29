// 校对体检口径（utils/writingProofread）单测：
//   - chapterTextIssues 五类文本检查（重复标点/三连同字/超长段落/连续空行/引号混用）
//   - buildProofreadReport 六组分组与跳转 target
// 这两条错了会出现「校对页签报假问题」或「发现行点了跳不走」。
import { describe, it, expect } from 'vitest';
import {
  buildProofreadReport,
  chapterTextIssues,
  filterProofreadIssues,
  sortProofreadIssues,
  stripHtmlText,
} from '../writingProofread';
import type { WritingChapter, WritingForeshadowing, WritingOutline, WritingTimelineEvent } from '../../services/tauri';

const ch = (id: string, content = '', wordCount = 0, status = 'draft'): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: id,
    content,
    sortOrder: 0,
    wordCount,
    status,
    volume: '',
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

const beat = (id: string, extra = '{}'): WritingOutline =>
  ({
    id,
    bookId: 'b1',
    title: `节拍 ${id}`,
    summary: '',
    chapterId: null,
    extra,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingOutline;

const ev = (id: string, at: string, storylineId: string | null = null): WritingTimelineEvent =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at,
    event: `事件 ${id}`,
    chapterId: null,
    storylineId,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingTimelineEvent;

const fs = (id: string, plant: string, payoff: string): WritingForeshadowing =>
  ({
    id,
    bookId: 'b1',
    title: `伏笔 ${id}`,
    description: '',
    plantChapterId: plant,
    payoffChapterId: payoff,
    status: 'pending',
    storylineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingForeshadowing;

describe('chapterTextIssues —— 五类文本检查', () => {
  it('重复标点：。。报 1 条并带计数', () => {
    const issues = chapterTextIssues(ch('c1', '他说好。。然后走了'));
    expect(issues.filter((i) => i.messageKey === 'RepeatPunct')).toHaveLength(1);
  });

  it('三连同字：了了了报 1 条；普通叠词（慢慢）不报', () => {
    expect(chapterTextIssues(ch('c1', '完了了了，都完了'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: 'RepeatChar' })]),
    );
    expect(chapterTextIssues(ch('c1', '他慢慢地走'))).toEqual([]);
  });

  it('超长段落：601 字单段报 1 条；600 字不报', () => {
    expect(chapterTextIssues(ch('c1', '字'.repeat(601)))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: 'LongParagraph' })]),
    );
    expect(chapterTextIssues(ch('c1', '字'.repeat(600)))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: 'LongParagraph' })]),
    );
  });

  it('连续空行与引号混用', () => {
    expect(chapterTextIssues(ch('c1', 'a\n\n\nb'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: 'BlankLines' })]),
    );
    expect(chapterTextIssues(ch('c1', '他说“好”然后说"行"'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: 'QuoteMix' })]),
    );
  });

  it('每条发现都带章跳转 target（renderable ≠ useful）', () => {
    const issues = chapterTextIssues(ch('c1', '好。。'));
    expect(issues.every((i) => i.target?.type === 'chapter' && i.target.id === 'c1')).toBe(true);
  });

  it('批次③：错别字 / 重复用词 / 敏感词各报 1 条汇总行（带计数）', () => {
    const issues = chapterTextIssues(ch('c1', '他行事一诺千斤。我不信我不信，还提到法轮功。'));
    expect(issues.filter((i) => i.messageKey === 'TypoPhrase')).toHaveLength(1);
    expect(issues.filter((i) => i.messageKey === 'RepeatPhrase')).toHaveLength(1);
    expect(issues.filter((i) => i.messageKey === 'SensitiveWord')).toHaveLength(1);
    const typo = issues.find((i) => i.messageKey === 'TypoPhrase');
    expect(typo?.args?.n).toBeGreaterThan(0);
  });

  it('批次③：正确成语（一诺千金）不误报；HTML 剥标签后按纯文本口径检测', () => {
    expect(chapterTextIssues(ch('c1', '他行事一诺千金。'))).toEqual([]);
    const issues = chapterTextIssues(ch('c1', '<p>他行事一诺千斤。</p><p>还有法轮功。</p>'));
    expect(issues.filter((i) => i.messageKey === 'TypoPhrase')).toHaveLength(1);
    expect(issues.filter((i) => i.messageKey === 'SensitiveWord')).toHaveLength(1);
  });

  it('stripHtmlText：段标签归一为换行、实体解码、无残留标签', () => {
    expect(stripHtmlText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n第二段');
    expect(stripHtmlText('<p>a<br/>b</p>')).toBe('a\nb');
    expect(stripHtmlText('&lt;tag&gt; &amp; &quot;q&quot; &nbsp;x')).toBe('<tag> & "q"  x');
  });
});

describe('buildProofreadReport —— 六组分组与跳转', () => {
  it('空章 / 完稿 0 字 / 预警伏笔 / 冲突事件 / 草稿 / 未挂线 / 未分发念头 各就各组', () => {
    const chapters = [ch('ch1', '', 0, 'draft'), ch('ch2', '正文', 100, 'finished'), ch('ch3', '', 0, 'finished')];
    const outlines = [beat('b1')]; // 未分发念头（无 extra 挂载、未转时间线/伏笔）
    const events = [ev('e1', '第三日'), ev('e2', '第三日'), ev('e3', ''), ev('e4', '第五日', 'sl1')];
    const foreshadowings = [fs('f1', 'ch2', 'ch1')]; // 回收章(ch1 序 0) ≤ 埋设章(ch2 序 1) → 预警
    const report = buildProofreadReport(chapters, outlines, events, foreshadowings, [{ id: 'sl1' }]);

    expect(report.counts['chapter-account']).toBe(2); // ch1 空章 + ch3 完稿 0 字
    expect(report.counts['foreshadow']).toBe(1);
    expect(report.counts['timeline']).toBe(3); // 冲突 e1/e2 两行 + 草稿 e3 汇总 1 行
    // e1/e2/e3 未挂线汇总 1 行 + sl1 唯一的事件(e4)没落到章节 → 悬空线 1 行（⑤″ 线级体检）
    expect(report.counts['storyline']).toBe(2);
    expect(report.issues.find((i) => i.key === 'sl:sl1:unanchored')?.target).toEqual({
      type: 'storyline',
      id: 'sl1',
    });
    expect(report.counts['idea']).toBe(1);

    // 伏笔行 → 跳伏笔实体；冲突行 → 跳时间线事件
    const fsIssue = report.issues.find((i) => i.group === 'foreshadow');
    expect(fsIssue?.target).toEqual({ type: 'foreshadowing', id: 'f1' });
    const conflictIssue = report.issues.find((i) => i.messageKey === 'TimelineConflictRow');
    expect(conflictIssue?.target?.type).toBe('timeline-event');
  });

  it('体检全绿：空书零发现、counts 全 0', () => {
    const report = buildProofreadReport([], [], [], [], []);
    expect(report.issues).toHaveLength(0);
    for (const g of Object.keys(report.counts)) expect(report.counts[g as keyof typeof report.counts]).toBe(0);
  });

  it('已分发的念头不再计入未分发（beatImported 查重口径）', () => {
    const outlines = [beat('b1')];
    const events = [ev('e1', '')]; // event="事件 e1" ≠ beatEventText(b1)="节拍 b1" → 不算已转
    const withImport = [{ ...ev('e9', ''), event: '节拍 b1' } as WritingTimelineEvent];
    expect(buildProofreadReport([], outlines, events, [], []).counts['idea']).toBe(1);
    expect(buildProofreadReport([], outlines, withImport, [], []).counts['idea']).toBe(0);
  });
});

describe('filterProofreadIssues / sortProofreadIssues —— 左栏严重性过滤与排序', () => {
  const mkIssue = (
    key: string,
    group: 'chapter-text' | 'chapter-account' | 'foreshadow' | 'timeline' | 'storyline' | 'idea',
    messageKey: string,
    severity?: 'block' | 'warning',
    target?: { type: 'chapter'; id: string },
  ) => ({ key, group, messageKey, ...(severity ? { severity } : {}), ...(target ? { target } : {}) });

  it('过滤：all 原样返回；block/warning 分别命中对应级别；无 severity 行只在 all 出现', () => {
    const issues = [
      mkIssue('a:1', 'chapter-text', 'TypoPhrase', 'warning'),
      mkIssue('b:1', 'chapter-account', 'FinishedNoWords', 'block'),
      mkIssue('c:1', 'timeline', 'TimelineDraftRow'), // 无 severity（兼容未标注行）
    ] as Parameters<typeof filterProofreadIssues>[0];
    expect(filterProofreadIssues(issues, 'all')).toHaveLength(3);
    expect(filterProofreadIssues(issues, 'block').map((i) => i.key)).toEqual(['b:1']);
    expect(filterProofreadIssues(issues, 'warning').map((i) => i.key)).toEqual(['a:1']);
  });

  it('排序 severity：block 优先、warning 次之、无 severity 最后，同级别稳定', () => {
    const issues = [
      mkIssue('c:1', 'timeline', 'TimelineDraftRow'),
      mkIssue('a:1', 'chapter-text', 'TypoPhrase', 'warning'),
      mkIssue('b:1', 'chapter-account', 'FinishedNoWords', 'block'),
      mkIssue('d:1', 'chapter-text', 'RepeatPunct', 'warning'),
    ] as Parameters<typeof sortProofreadIssues>[0];
    expect(sortProofreadIssues(issues, 'severity').map((i) => i.key)).toEqual(['b:1', 'a:1', 'd:1', 'c:1']);
  });

  it('排序 chapter：章 target 按 chapterOrder 序在前，无章 target 排最后；default 保持派发序', () => {
    const issues = [
      mkIssue('c:1', 'timeline', 'TimelineDraftRow'),
      mkIssue('a:1', 'chapter-text', 'TypoPhrase', 'warning', { type: 'chapter', id: 'ch3' }),
      mkIssue('b:1', 'chapter-text', 'RepeatChar', 'warning', { type: 'chapter', id: 'ch1' }),
    ] as Parameters<typeof sortProofreadIssues>[0];
    expect(sortProofreadIssues(issues, 'chapter', ['ch1', 'ch2', 'ch3']).map((i) => i.key)).toEqual([
      'b:1',
      'a:1',
      'c:1',
    ]);
    expect(sortProofreadIssues(issues, 'default')).toEqual(issues);
  });

  it('排序 type：按 messageKey 字典序（同键按 key 稳定）', () => {
    const issues = [
      mkIssue('a:1', 'chapter-text', 'TypoPhrase', 'warning'),
      mkIssue('b:1', 'chapter-text', 'RepeatChar', 'warning'),
      mkIssue('c:1', 'chapter-text', 'BlankLines'),
    ] as Parameters<typeof sortProofreadIssues>[0];
    expect(sortProofreadIssues(issues, 'type').map((i) => i.key)).toEqual(['c:1', 'b:1', 'a:1']);
  });

  it('buildProofreadReport：完稿 0 字为 block、空章为 warning（配合左栏严重性过滤）', () => {
    const chapters = [ch('ch1', '', 0, 'draft'), ch('ch3', '完稿无字', 0, 'finished')];
    const report = buildProofreadReport(chapters, [], [], [], []);
    const empty = report.issues.find((i) => i.key === 'ch1:empty');
    const fin0 = report.issues.find((i) => i.key === 'ch3:fin0');
    expect(empty?.severity).toBe('warning');
    expect(fin0?.severity).toBe('block');
  });
});
