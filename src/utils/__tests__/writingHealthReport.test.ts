// 全书体检报告导出（utils/writingHealthReport）单测。
//
// 报告是这套一致性能力唯一「能拿给别人看」的产出，所以锁四件事：
// ① 口径不重算：报告内容必须与 buildProofreadReport 的产出一致（分组、条数、文案）；
// ② 章名要带出来——作者看报告是为了知道"去哪一章改"；
// ③ **转义**：章名/设定名/伏笔标题全是作者自由文本，不转义等于允许正文里一段
//    <script> 跟着报告一起被导出去；
// ④ 时间注入而非内部取时，保证同输入同输出（可测、可复现）。
import { describe, it, expect, beforeEach } from 'vitest';
import { buildHealthReportHtml, buildHealthReportMarkdown, formatReportTime } from '../writingHealthReport';
import { buildProofreadReport } from '../writingProofread';
import { setLang } from '../../i18n';
import type { WritingChapter } from '../../services/tauri';

const chapter = (id: string, over: Partial<WritingChapter> = {}): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: `章 ${id}`,
    content: '正常正文内容若干。',
    sortOrder: 0,
    wordCount: 8,
    status: 'draft',
    volume: '',
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as WritingChapter;

/**
 * 造一份同时含 block / warning、跨至少两个组发现的真报告
 * （不手搓 finding，避免测的是假口径）。
 *
 * 两个引擎口径必须照着装进夹具里，否则fixture 本身就是错的：
 * ① 章账判定是 `空章` 优先于 `谎报完稿`（else-if），所以"谎报完稿"那章要**有正文但字数记 0**；
 * ② 一致性组要求全书至少有一章有正文（整本没开写时不该判"人物集体缺席"）。
 */
function sample() {
  const chapters: WritingChapter[] = [
    chapter('c_empty', { title: '空缺那一章', content: '', wordCount: 0 }),
    chapter('c_fin0', { title: '谎报完稿章', content: '开头写了一点。', wordCount: 0, status: 'finished' }),
  ];
  const settings = [{ id: 's_dead', name: '从未出场的人物', extra: '{}' }];
  const report = buildProofreadReport(chapters, [], [], [], [], settings);
  const titleById = new Map(chapters.map((c) => [c.id, c.title]));
  return {
    bookTitle: '长夜将尽',
    generatedAt: new Date(2026, 9, 28, 9, 5), // 2026-10-28 09:05（本地时间，避免时区漂移）
    chapters,
    settingCount: settings.length,
    report,
    chapterTitle: (id: string) => titleById.get(id) ?? '',
  };
}

beforeEach(() => setLang('zh-CN'));

describe('writingHealthReport', () => {
  it('formatReportTime 用固定的本地格式，不随 locale 漂移', () => {
    expect(formatReportTime(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05 07:03');
  });

  it('Markdown 含书名/汇总/分组标题/发现原文/章名落点', () => {
    const md = buildHealthReportMarkdown(sample());

    expect(md).toContain('长夜将尽');
    expect(md).toContain('2026-10-28 09:05');
    // 汇总里三个数都要在（block 至少 1 条：谎报完稿）
    expect(md).toMatch(/必须处理 [1-9]\d* 项/);
    // 分组标题用组名而不是组 id
    expect(md).toContain('章账');
    expect(md).toContain('一致性');
    // 发现正文与章名落点
    expect(md).toContain('谎报完稿');
    expect(md).toContain('空缺那一章');
    expect(md).toContain('从未出场的人物');
  });

  it('导出条目数 = 引擎发现数（不允许报告与屏幕两套结论）', () => {
    const input = sample();
    const md = buildHealthReportMarkdown(input);
    const listed = md
      .split('\n')
      .filter((l) => l.startsWith('- 〔')).length;
    expect(listed).toBe(input.report.issues.length);
  });

  it('组顺序遵循 PROOFREAD_GROUPS，组内必须处理的排前面', () => {
    const md = buildHealthReportMarkdown(sample());
    // 章账在一致性之前（PROOFREAD_GROUPS 顺序）
    expect(md.indexOf('章账')).toBeGreaterThanOrEqual(0);
    expect(md.indexOf('章账')).toBeLessThan(md.indexOf('一致性'));
    // 谎报完稿是 block，应排在同为章账组的空章之前
    expect(md.indexOf('谎报完稿')).toBeLessThan(md.indexOf('空缺那一章'));
  });

  it('零发现时给出明确"没有发现问题"，而不是留一份空壳文档', () => {
    const input = { ...sample(), report: buildProofreadReport([], [], [], [], [], []) };
    const md = buildHealthReportMarkdown(input);
    expect(md).toContain('没有发现问题');
    expect(md).not.toContain('## ');

    const html = buildHealthReportHtml(input);
    expect(html).toContain('没有发现问题');
  });

  it('章账口径：空章优先于"谎报完稿"，两者不同时报同一章', () => {
    // 有正文但字数记 0 → 谎报完稿（block）
    const lying = buildProofreadReport(
      [chapter('a', { content: '写了一点。', wordCount: 0, status: 'finished' })],
      [], [], [], [], [],
    );
    expect(lying.issues.map((i) => i.messageKey)).toEqual(['FinishedNoWords']);
    // 完全空章 → 只报空章，不再叠加一条"标记完稿但 0 字"
    const empty = buildProofreadReport(
      [chapter('b', { content: '', wordCount: 0, status: 'finished' })],
      [], [], [], [], [],
    );
    expect(empty.issues.map((i) => i.messageKey)).toEqual(['EmptyChapter']);
  });

  it('HTML 必须转义作者自由文本（章名/设定名里的标签不能变成真标签）', () => {
    const chapters = [
      chapter('xss', {
        title: '<script>alert(1)</script>',
        content: '',
        wordCount: 0,
      }),
    ];
    const settings = [{ id: 's', name: '<img src=x onerror=alert(2)>', extra: '{}' }];
    const report = buildProofreadReport(chapters, [], [], [], [], settings);
    const html = buildHealthReportHtml({
      bookTitle: '<b>粗体书名</b>',
      generatedAt: new Date(2026, 9, 28, 9, 5),
      chapters,
      settingCount: settings.length,
      report,
      chapterTitle: (id: string) => (id === 'xss' ? '<script>alert(1)</script>' : ''),
    });

    // 真标签不得出现，转义形态必须在
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>粗体书名</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;粗体书名&lt;/b&gt;');
  });

  it('同输入同输出（导出可复现，不受运行时刻影响）', () => {
    expect(buildHealthReportMarkdown(sample())).toBe(buildHealthReportMarkdown(sample()));
    expect(buildHealthReportHtml(sample())).toBe(buildHealthReportHtml(sample()));
  });
});
