// 正文格式体检与规范化（F1）
//
// 语料故意取自真库第一章的真实形态（段首 `&nbsp; &nbsp; ...` 手工缩进），
// 以及三套缩进口径各自的产物形态。规范一旦改动，这里必须同步 —— 因为它同时是
// 写作侧提示与导出侧规范化的共同判据。
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPEC_EN,
  DEFAULT_SPEC_ZH,
  FORMAT_RULES,
  lintFormat,
  normalizeFormat,
  summarize,
  type FormatIssue,
} from '../writingFormat';

const rules = (issues: FormatIssue[]) => issues.map((i) => i.rule);

describe('lintFormat：中文正文', () => {
  it('抓出段首硬空格冒充缩进（真库第一章就是这个写法）', () => {
    const html =
      '<p>&nbsp; &nbsp; &nbsp; &nbsp; 她一连说了十几声谢谢，一声比一声轻。</p>';
    expect(rules(lintFormat(html, DEFAULT_SPEC_ZH))).toContain('leadingSpace');
  });

  it('抓出 padding-left 冒充实首行缩进（编辑器工具栏那条口径）', () => {
    const html = '<p style="padding-left: 2em" data-text-indent="2">整段左缩进。</p>';
    expect(rules(lintFormat(html, DEFAULT_SPEC_ZH))).toContain('paddingIndent');
  });

  it('标点类**不归本层**：结构与文本两套判据不许重叠报同一问题', () => {
    const html =
      '<p>&nbsp;&nbsp;薰儿说,谢谢.然后走了...不,她没有回头。</p><p>他等了一--天。</p>';
    const got = rules(lintFormat(html, DEFAULT_SPEC_ZH));
    // 交给 proofreadEngine（带词典、有 fix、可定位）与 chapterTextIssues，本层一条都不报
    expect(got).not.toContain('halfwidthPunct');
    expect(got).not.toContain('ellipsisDots');
    expect(got).not.toContain('doubleDash');
    // 结构类照报，说明不是整体失灵
    expect(got).toContain('leadingSpace');
  });

  it('抓出空段、连续换行冒充分段、正文里手写标题', () => {
    const html =
      '<p>第一段</p><p>&nbsp;</p><p>第二段<br><br>其实是两段</p><p><h3>我手写了个标题</h3></p>';
    const got = rules(lintFormat(html, DEFAULT_SPEC_ZH));
    expect(got).toContain('emptyPara');
    expect(got).toContain('brAsBreak');
    expect(got).toContain('headingInBody');
  });

  it('开启 pangu 时报中西文之间缺空格', () => {
    expect(rules(lintFormat('<p>他用Vue写了三年</p>', DEFAULT_SPEC_ZH))).toContain('missingPangu');
    // 关掉就不该报（设置里可以关，不许强加作者）
    expect(
      rules(lintFormat('<p>他用Vue写了三年</p>', { ...DEFAULT_SPEC_ZH, pangu: false })),
    ).not.toContain('missingPangu');
  });

  it('干净的中文正文应当零问题（规范不许凭空找事）', () => {
    const clean = '<p>船离港那天没有风，海面平得像一块刚打磨过的青石。</p><p>薰儿把纸折成四折，塞进袖口。</p>';
    expect(lintFormat(clean, DEFAULT_SPEC_ZH)).toEqual([]);
  });
});

describe('lintFormat：西文规则与中文不同', () => {
  it('英文段不因"没有首行缩进"被抓；标点同样不归本层', () => {
    const html = '<p>She said thanks, then left。Nobody saw her go.</p>';
    const got = rules(lintFormat(html, DEFAULT_SPEC_EN));
    // 全角/半角标点都是文本层（引擎）的活，本层一条不报
    expect(got).not.toContain('fullwidthPunct');
    expect(got).not.toContain('halfwidthPunct');
    // 但结构问题不分语言都要抓
    const dirty = rules(lintFormat('<p>&nbsp;&nbsp;She left.</p>', DEFAULT_SPEC_EN));
    expect(dirty).toContain('leadingSpace');
  });

  it('英文不做 pangu，也不按中文长段阈值报错', () => {
    const long = `<p>${'word '.repeat(600)}</p>`;
    const got = rules(lintFormat(long, DEFAULT_SPEC_EN));
    expect(got).not.toContain('longPara');
    expect(got).not.toContain('missingPangu');
  });
});

describe('normalizeFormat：只改无歧义的排版噪声', () => {
  it('摘掉段首硬空格缩进，正文一个字不少', () => {
    const html = '<p>&nbsp; &nbsp; 她一连说了十几声谢谢。</p>';
    const out = normalizeFormat(html, DEFAULT_SPEC_ZH);
    expect(out).toBe('<p>她一连说了十几声谢谢。</p>');
  });

  it('删空段、折叠连续换行成分段边界', () => {
    const out = normalizeFormat('<p>第一段</p><p>&nbsp;</p><p>第二段<br><br>第三段</p>', DEFAULT_SPEC_ZH);
    expect(out).not.toMatch(/<p[^>]*>\s*<\/p>/);
    expect(out).toContain('</p><p>');
    expect(out.replace(/<[^>]+>/g, '')).toContain('第二段');
    expect(out.replace(/<[^>]+>/g, '')).toContain('第三段');
  });

  it('本层绝不碰标点：标点是引擎的活，两边都改会互相打脸', () => {
    const out = normalizeFormat('<p>他说,好。Vue 3.4 发布了 v1.2.3，走了... </p>', DEFAULT_SPEC_ZH);
    expect(out).toContain('他说,好。');   // 半角逗号原样保留
    expect(out).toContain('3.4');
    expect(out).toContain('v1.2.3');
    expect(out).toContain('...');
    expect(out).not.toContain('……');
  });

  it('pangu 补的是薄空格，不是普通空格（视觉窄、不参与对齐抖动）', () => {
    const out = normalizeFormat('<p>他用Vue写了三年</p>', DEFAULT_SPEC_ZH);
    // 边界只有两处：用|Vue 与 Vue|写
    expect(out).toContain('用\u2009Vue');
    expect(out).toContain('Vue\u2009写');
    // 两个汉字之间绝不许多插东西
    expect(out).toContain('他');
    expect(out).toContain('了三年');
  });

  it('规范化后再体检，硬空格/空段/换行分段类问题应清零', () => {
    const dirty = '<p>&nbsp;&nbsp;第一段</p><p> </p><p>第二段<br><br>第三段</p>';
    const fixed = normalizeFormat(dirty, DEFAULT_SPEC_ZH);
    const left = rules(lintFormat(fixed, DEFAULT_SPEC_ZH));
    expect(left).not.toContain('leadingSpace');
    expect(left).not.toContain('emptyPara');
    expect(left).not.toContain('brAsBreak');
  });

  it('规范化是幂等的：跑两遍结果一样（重导不许产生字节噪音）', () => {
    const html = '<p>&nbsp; 薰儿说，好。他用Vue写了三年 </p>';
    const once = normalizeFormat(html, DEFAULT_SPEC_ZH);
    expect(normalizeFormat(once, DEFAULT_SPEC_ZH)).toBe(once);
  });
});

describe('真库第一章形态：体检 → 一键修 → 复检', () => {
  // 取自真库第一章首段的真实结构（段首四个硬空格 + 紧跟一个高亮 mark）
  const REAL =
    '<p>&nbsp; &nbsp; &nbsp; &nbsp; <mark data-color="#f9a8d4" style="background-color: rgb(249, 168, 212); color: inherit;">谢谢谢谢谢</mark>谢先，薰儿</p>' +
    '<p>她一连说了十几声谢谢，一声比一声轻，到最后连自己都听不见了。</p>';

  it('体检要报出段首硬空格缩进', () => {
    expect(rules(lintFormat(REAL, DEFAULT_SPEC_ZH))).toContain('leadingSpace');
  });

  it('一键修只吃掉缩进，正文与高亮一个字符都不动', () => {
    const out = normalizeFormat(REAL, DEFAULT_SPEC_ZH);
    expect(out).not.toContain('&nbsp;');
    expect(out).toContain('data-color="#f9a8d4"');
    expect(out.replace(/<[^>]+>/g, '')).toContain('谢先，薰儿');
    expect(rules(lintFormat(out, DEFAULT_SPEC_ZH))).not.toContain('leadingSpace');
  });

  it('修完是幂等的：再修一遍不动（重导不产生字节噪音）', () => {
    const once = normalizeFormat(REAL, DEFAULT_SPEC_ZH);
    expect(normalizeFormat(once, DEFAULT_SPEC_ZH)).toBe(once);
  });
});

describe('计数（报告要能说清规模）', () => {
  it('同一段落类型的问题合并成一条并带真实条数', () => {
    const html = '<p>&nbsp;&nbsp;甲</p><p>&nbsp;&nbsp;乙</p><p>&nbsp;&nbsp;丙</p>';
    const got = lintFormat(html, DEFAULT_SPEC_ZH).find((i) => i.rule === 'leadingSpace');
    expect(got?.count).toBe(3);
  });
});

describe('规则表自身', () => {
  it('每条规则都有中文名与严重度，UI 不许硬编码规则清单', () => {
    for (const meta of Object.values(FORMAT_RULES)) {
      expect(meta.label.length).toBeGreaterThan(1);
      expect(['error', 'warn', 'info']).toContain(meta.severity);
    }
  });

  it('summarize 按 error > warn > info 排（徽标要先给用户最疼的）', () => {
    const issues: FormatIssue[] = [
      { rule: 'trailingSpace', count: 1, excerpt: '' },
      { rule: 'leadingSpace', count: 1, excerpt: '' },
      { rule: 'emptyPara', count: 1, excerpt: '' },
    ];
    expect(summarize(issues).map((s) => s.meta.severity)).toEqual(['error', 'warn', 'info']);
  });
});
