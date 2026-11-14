// 结构层（writingFormat）接入现有校对报告与一键修的整合锁（F2，2026-11-06）
//
// 为什么单独一把锁：结构层与文本层两套判据必须**同一份报告出现、同一个一键修生效、
// 且不许重叠报同一问题**。这三件事分散在三个文件里，各自单测都绿不代表合起来对。
import { describe, it, expect } from 'vitest';
import { chapterTextIssues } from '../writingProofread';
import { applyAutoFixesHtml } from '../../editor/proofread/chapterAutoFix';
import type { WritingChapter } from '../../services/tauri';

const chapter = (content: string): WritingChapter => ({
  id: 'c1',
  bookId: 'b1',
  title: '第一章',
  content,
  sortOrder: 1,
  parentId: null,
  wordCount: 0,
  status: 'draft',
  volume: '',
  kind: '',
  extra: '{}',
  createdAt: 0,
  updatedAt: 0,
});

const keys = (c: WritingChapter) => chapterTextIssues(c).map((i) => i.messageKey);

describe('结构层进报告', () => {
  it('段首硬空格缩进会成为一条可跳转的发现，并带真实条数', () => {
    const found = chapterTextIssues(chapter('<p>&nbsp;&nbsp;甲段</p><p>&nbsp;&nbsp;乙段</p>'))
      .find((i) => i.messageKey === 'StructLeadingIndent');
    expect(found).toBeTruthy();
    expect(found?.args?.n).toBe(2);
    // 定位锚必须带上，否则面板点了跳不过去（"发现即点即跳"是这套报告的硬要求）
    expect((found?.locator as { anchor?: string })?.anchor).toBeTruthy();
  });

  it('干净的中文正文不该产生任何 Struct 类发现', () => {
    const got = keys(chapter('<p>船离港那天没有风，海面平得像一块刚打磨过的青石。</p>'));
    expect(got.filter((k) => k.startsWith('Struct'))).toEqual([]);
  });

  it('标点类只由文本层报，结构层不许重复报同一问题', () => {
    // 只有省略号问题、没有空白问题：结构层就该一条不报，标点交给引擎（有词典、有 fix、可定位）
    const got = keys(chapter('<p>他等了一整天...该来的还是会来。</p>'));
    expect(got.filter((k) => k.startsWith('Struct'))).toEqual([]);
  });

  it('尾随空格属空白，归结构层报（引擎在纯文本口径下看不见它）', () => {
    // 空格在 `</p>` **之内**才算段末冗余；标签之间的空白是 HTML 排版噪音，不算正文问题
    expect(keys(chapter('<p>他等了一整天。  </p>'))).toContain('StructTrailingSpace');
    expect(keys(chapter('<p>他等了一整天。</p>   <p>另一段</p>'))).not.toContain('StructTrailingSpace');
  });
});

describe('一键修同时吃下结构层', () => {
  it('段首手工缩进被清掉，且回执能说清"动过排版"', () => {
    const r = applyAutoFixesHtml('<p>&nbsp;&nbsp;她一连说了十几声谢谢。</p>');
    expect(r.html).not.toContain('&nbsp;');
    expect(r.html).toContain('她一连说了十几声谢谢');
    expect(r.structFixed).toBe(true);
    // 只有结构改动时也必须计数：调用方靠 fixedCount>0 决定要不要落库，
    // 不计这一条 = 修了却不保存，等于没修
    expect(r.fixedCount).toBeGreaterThan(0);
  });

  it('修完再修一遍不应再动（幂等，重导不产生字节噪音）', () => {
    const once = applyAutoFixesHtml('<p>&nbsp;&nbsp;甲段</p><p>&nbsp;</p><p>乙段<br><br>丙段</p>');
    const twice = applyAutoFixesHtml(once.html);
    expect(twice.html).toBe(once.html);
    expect(twice.structFixed).toBe(false);
  });

  it('结构层修完后，报告里对应的 Struct 发现应消失', () => {
    const dirty = '<p>&nbsp;&nbsp;甲段</p><p>&nbsp;</p>';
    const before = chapterTextIssues(chapter(dirty)).map((i) => i.messageKey);
    expect(before).toContain('StructLeadingIndent');
    const fixed = applyAutoFixesHtml(dirty).html;
    const after = chapterTextIssues(chapter(fixed)).map((i) => i.messageKey);
    expect(after).not.toContain('StructLeadingIndent');
    expect(after).not.toContain('StructEmptyPara');
  });
});
