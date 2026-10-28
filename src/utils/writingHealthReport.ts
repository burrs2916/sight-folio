// 全书体检报告导出（批次②）：把体检清单导成一页可分享的文档。
//
// 刻意只做 Markdown / HTML 两种**自包含纯文本**格式，不接既有 PDF/DOCX/EPUB 那条导出链：
// 那条链自身的排版缺陷（EPUB 无 CSS、DOCX 缺 styles.xml、PDF 表格残渣）在
// docs/功能推进方案-增删减.md 里已记为待办，报告不该被它的缺陷拖累。
// HTML 版自带打印样式，浏览器打开即可「打印成 PDF」，零额外依赖。
//
// 口径铁律：入参 `report` 由调用方从 `buildProofreadReport` 传入，本模块**不重算**——
// 保证「屏幕上看到的」与「导出的」永远是同一份，不会出现两套结论。
import {
  PROOFREAD_GROUPS,
  proofreadGroupLabelKey,
  proofreadSeverityRank,
  type ProofreadFinding,
  type ProofreadReport,
} from './writingProofread';
import type { WritingChapter } from '../services/tauri';
import { t } from '../i18n';

export interface HealthReportInput {
  bookTitle: string;
  /**
   * 注入而非内部 `new Date()`：同一份数据要能产出确定性的输出（可测、可复现）。
   * 调用方在点导出的那一刻传 `new Date()`。
   */
  generatedAt: Date;
  chapters: WritingChapter[];
  /** 只用于统计卡张数 */
  settingCount: number;
  report: ProofreadReport;
  /** 章 id → 章名（发现行的落点要写成作者认得出的章名，不是 id） */
  chapterTitle: (id: string) => string;
}

/** 严重性短标签（导出用，不带界面上的解释性长句） */
function severityLabel(issue: ProofreadFinding): string {
  if (issue.severity === 'block') return t('writing.healthReportSevBlock');
  if (issue.severity === 'warning') return t('writing.healthReportSevWarning');
  return t('writing.healthReportSevNormal');
}

function issueText(issue: ProofreadFinding): string {
  return t(`writing.proofreadIssue.${issue.messageKey}`, issue.args);
}

/**
 * 一行发现拆成三段（严重性 / 正文 / 落点章名），Markdown 与 HTML **共用同一拆法**。
 * 两个序列化器各定一套规则的话，同一份报告在两种导出里会长得不一样。
 *
 * 章账/一致性这类发现的文案本身已带《标题》，再补一次章名就成了
 * 「《谎报完稿章》标记完稿但 0 字 · 谎报完稿章」这种重复，所以已含则不加。
 */
interface IssueParts {
  severity: string;
  text: string;
  /** 需要额外标注的章名；空串 = 不加 */
  chapter: string;
}

function issueParts(issue: ProofreadFinding, chapterTitle: (id: string) => string): IssueParts {
  const text = issueText(issue);
  const tg = issue.target;
  if (tg?.type !== 'chapter') return { severity: severityLabel(issue), text, chapter: '' };
  const name = chapterTitle(tg.id);
  return { severity: severityLabel(issue), text, chapter: !name || text.includes(name) ? '' : name };
}

const formatIssue = (issue: ProofreadFinding, chapterTitle: (id: string) => string): string => {
  const p = issueParts(issue, chapterTitle);
  return `〔${p.severity}〕${p.text}${p.chapter ? ` · ${p.chapter}` : ''}`;
};

/** 本地时间格式化：不用 toLocaleString（随区域/时区漂移，导出内容会不稳定） */
export function formatReportTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 按七组归堆（组内按严重性升序 = 必须处理的在前），空组不出现在文档里 */
function grouped(report: ProofreadReport): { group: (typeof PROOFREAD_GROUPS)[number]; items: ProofreadFinding[] }[] {
  return PROOFREAD_GROUPS.map((g) => ({
    group: g,
    items: report.issues
      .filter((i) => i.group === g)
      .sort((a, b) => proofreadSeverityRank(a) - proofreadSeverityRank(b)),
  })).filter((x) => x.items.length > 0);
}

function summaryLine(input: HealthReportInput): string {
  const { report } = input;
  const block = report.issues.filter((i) => i.severity === 'block').length;
  const warning = report.issues.filter((i) => i.severity === 'warning').length;
  return t('writing.healthReportSummary', {
    n: report.issues.length,
    block,
    warning,
    normal: report.issues.length - block - warning,
  });
}

function statsLine(input: HealthReportInput): string {
  const words = input.chapters.reduce((n, c) => n + (c.wordCount ?? 0), 0);
  return t('writing.healthReportStats', {
    chapters: input.chapters.length,
    words,
    settings: input.settingCount,
  });
}

/** Markdown 版：适合贴进笔记/聊天/协作工具 */
export function buildHealthReportMarkdown(input: HealthReportInput): string {
  const lines: string[] = [
    `# ${t('writing.healthReportTitle', { book: input.bookTitle })}`,
    '',
    `> ${summaryLine(input)}`,
    '',
    `${t('writing.healthReportGenerated', { time: formatReportTime(input.generatedAt) })} · ${statsLine(input)}`,
  ];
  const groups = grouped(input.report);
  if (groups.length === 0) {
    lines.push('', t('writing.healthReportNone'));
    return lines.join('\n');
  }
  for (const g of groups) {
    lines.push('', `## ${t(proofreadGroupLabelKey(g.group))}（${g.items.length}）`);
    for (const issue of g.items) lines.push(`- ${formatIssue(issue, input.chapterTitle)}`);
  }
  return lines.join('\n');
}

const escapeHtml = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** severity → 打印友好的色值（与界面同一语义三色） */
function severityClass(issue: ProofreadFinding): string {
  if (issue.severity === 'block') return 'b';
  if (issue.severity === 'warning') return 'w';
  return 'n';
}

/**
 * HTML 版：自包含 + 打印样式，浏览器打开即可「打印成 PDF」。
 *
 * 转义是硬要求，不是洁癖：章名、设定名、伏笔标题全是作者自由文本，
 * 不转义就等于允许正文里一段 `<script>` 跟着报告一起被导出去。
 */
export function buildHealthReportHtml(input: HealthReportInput): string {
  const parts: string[] = [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${escapeHtml(t('writing.healthReportTitle', { book: input.bookTitle }))}</title>`,
    '<style>',
    'body{font:14px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#1f2328}',
    'h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;margin:22px 0 6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb}',
    '.meta{color:#6b7280;font-size:12px;margin:0 0 2px}.sum{font-size:13px;margin:0 0 14px;padding:8px 10px;background:#f6f7f9;border-radius:6px}',
    'ul{margin:0;padding-left:18px}li{margin:3px 0}.tag{font-size:11px;padding:0 5px;border-radius:3px;margin-right:6px}',
    '.b .tag{color:#8a3f31;background:#fbecea}.w .tag{color:#7a5f24;background:#fbf3e2}.n .tag{color:#4b5563;background:#f1f2f4}',
    '.none{color:#3f6b45;font-size:13px}',
    '@media print{body{margin:0;max-width:none}h2{break-after:avoid}li{break-inside:avoid}}',
    '</style></head><body>',
    `<h1>${escapeHtml(t('writing.healthReportTitle', { book: input.bookTitle }))}</h1>`,
    `<p class="sum">${escapeHtml(summaryLine(input))}</p>`,
    `<p class="meta">${escapeHtml(t('writing.healthReportGenerated', { time: formatReportTime(input.generatedAt) }))} · ${escapeHtml(statsLine(input))}</p>`,
  ];

  const groups = grouped(input.report);
  if (groups.length === 0) {
    parts.push(`<p class="none">${escapeHtml(t('writing.healthReportNone'))}</p>`);
  }
  for (const g of groups) {
    parts.push(
      `<h2>${escapeHtml(t(proofreadGroupLabelKey(g.group)))}（${g.items.length}）</h2><ul>`,
    );
    for (const issue of g.items) {
      const p = issueParts(issue, input.chapterTitle);
      parts.push(
        `<li class="${severityClass(issue)}"><span class="tag">${escapeHtml(p.severity)}</span>${escapeHtml(p.text)}${p.chapter ? ` · ${escapeHtml(p.chapter)}` : ''}</li>`,
      );
    }
    parts.push('</ul>');
  }
  parts.push('</body></html>');
  return parts.join('\n');
}
