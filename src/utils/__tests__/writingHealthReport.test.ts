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
 * 2026-11-07 「章账」组整组撤除（层级名由创作者自定义 → 系统无从判定哪个节点该有正文），
 * 夹具因此改成用**章文本**提供带章落点的 warning、用**一致性**提供 block：
 * ① c_empty 是空章，它必须"什么都不是"——它留在夹具里就是为了被下面那条 not.toContain 钉住；
 * ② 一致性组要求全书至少有一章有正文（整本没开写时不该判"人物集体缺席"）；
 * ③ 归一化重名的那对卡是全场唯一的 block，组内排序靠它验。
 */
function sample() {
  const chapters: WritingChapter[] = [
    chapter('c_empty', { title: '空缺那一章', content: '', wordCount: 0 }),
    chapter('c_punct', { title: '第三章 长夜', content: '他好。。然后走了', wordCount: 7 }),
  ];
  const settings = [
    { id: 's_dup_a', name: '陈默', extra: '{}' },
    { id: 's_dup_b', name: '陈默 ', extra: '{}' },
    { id: 's_dead', name: '从未出场的人物', extra: '{}' },
  ];
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
    // 汇总里三个数都要在（block 至少 1 条：归一化重名）
    expect(md).toMatch(/必须处理 [1-9]\d* 项/);
    // 分组标题用组名而不是组 id
    expect(md).toContain('章文本');
    expect(md).toContain('一致性');
    // 「章账」组已撤除：导航与导出都不许再出现这个组名
    expect(md).not.toContain('章账');
    // 发现落点要写成作者认得出的章名，而不是 id
    expect(md).toContain('第三章 长夜');
    // 空章不再是发现：撤报要撤干净，含导出
    expect(md).not.toContain('空缺那一章');
    expect(md).toContain('从未出场的人物');
  });

  it('导出条目数 = 引擎发现数（不允许报告与屏幕两套结论）', () => {
    const input = sample();
    const md = buildHealthReportMarkdown(input);
    const listed = md.split('\n').filter((l) => l.startsWith('- 〔')).length;
    expect(listed).toBe(input.report.issues.length);
  });

  it('组顺序遵循 PROOFREAD_GROUPS，组内必须处理的排前面', () => {
    const md = buildHealthReportMarkdown(sample());
    // 章文本在一致性之前（PROOFREAD_GROUPS 顺序）
    expect(md.indexOf('章文本')).toBeGreaterThanOrEqual(0);
    expect(md.indexOf('章文本')).toBeLessThan(md.indexOf('一致性'));
    // 组内排序在一致性组验：它同时含「归一化重名」(block) 与「零提及」(warning)
    const consistency = (md.split('## 一致性')[1] ?? '').split('\n').filter((l) => l.startsWith('- 〔'));
    expect(consistency.length).toBeGreaterThanOrEqual(2);
    expect(consistency[0]).toContain('必须处理');
    expect(consistency.some((l) => l.includes('建议处理'))).toBe(true);
  });

  it('零发现时给出明确"没有发现问题"，而不是留一份空壳文档', () => {
    const input = { ...sample(), report: buildProofreadReport([], [], [], [], [], []) };
    const md = buildHealthReportMarkdown(input);
    expect(md).toContain('没有发现问题');
    expect(md).not.toContain('## ');

    const html = buildHealthReportHtml(input);
    expect(html).toContain('没有发现问题');
  });

  it('章账整组撤除：空章 / 标了完稿却 0 字 / 空卷都不进报告（导出同步）', () => {
    const empty = buildProofreadReport(
      [
        chapter('a', { content: '', wordCount: 0 }),
        chapter('b', { content: '写了一点。', wordCount: 0, status: 'finished' }),
        chapter('v', { title: '第一卷', kind: '卷', content: '', wordCount: 0 }),
      ],
      [],
      [],
      [],
      [],
      [],
    );
    expect(empty.issues).toEqual([]);
    const md = buildHealthReportMarkdown({ ...sample(), report: empty });
    expect(md).toContain('没有发现问题');
    expect(md).not.toContain('章账');
  });

  it('HTML 必须转义作者自由文本（章名/设定名里的标签不能变成真标签）', () => {
    const chapters = [
      chapter('xss', {
        title: '<script>alert(1)</script>',
        // 撤掉章账后，让这一章仍产出发现的正路是**它真有文字**；
        // 正文非空同时把一致性组叫醒（整本无正文时一致性组整组静默，设定名根本进不了报告，
        // 下面那条 <img> 的转义断言就成了空断言——这是本轮顺手补严的地方）。
        content: '他好。。然后走了',
        wordCount: 7,
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
    // 设定名同样必须走转义，且这里断言的是「它以转义形态真的进了报告」
    expect(html).toContain('&lt;img src=x');
  });

  it('同输入同输出（导出可复现，不受运行时刻影响）', () => {
    expect(buildHealthReportMarkdown(sample())).toBe(buildHealthReportMarkdown(sample()));
    expect(buildHealthReportHtml(sample())).toBe(buildHealthReportHtml(sample()));
  });
});
