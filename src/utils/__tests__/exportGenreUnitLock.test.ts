// ㉱ E-A′（2026-11-11）：导出单位词的跨语言一致性锁（形状抄 typographyExportLock）。
//
// 为什么必须存在：量词表前端一份（i18n `writing.unitClassifier.*`）、Rust 一份
// （`layout::export_unit_classifier`，导出日志行用它）。两份表一旦漂移，症状是
// 「屏幕数首、日志数章」，且两边单测各自全绿。改一边不改另一边，这里直接红。
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import zhMessages from '../../i18n/zh-CN.json';

const LAYOUT = readFileSync(`${process.cwd()}/src-tauri/src/application/writing/layout.rs`, 'utf8');
const EXPORT_JOBS = readFileSync(`${process.cwd()}/src-tauri/src/application/work_version/export_jobs.rs`, 'utf8');
const DOCX = readFileSync(`${process.cwd()}/src-tauri/src/application/writing/docx_export.rs`, 'utf8');
const PDF = readFileSync(`${process.cwd()}/src-tauri/src/application/writing/pdf_export.rs`, 'utf8');

const classifier = zhMessages.writing.unitClassifier as Record<string, string>;

describe('㉱ 导出单位词/缩进：Rust ↔ i18n 源码锁', () => {
  it('Rust 量词表每个体裁的词与 i18n 量词表逐字同（少一条 = 日志和屏幕两种叫法）', () => {
    const body = LAYOUT.slice(LAYOUT.indexOf('pub fn export_unit_classifier'));
    for (const g of ['essay', 'poetry', 'script', 'diary'] as const) {
      expect(body, `Rust 表缺体裁 ${g}`).toContain(`"${g}" => "${classifier[g]}"`);
    }
    // 小说是兜底支（`_ => "章"`），不写 id —— 表尾的 match 臂必须落「章」
    expect(body.slice(body.lastIndexOf('_ =>'))).toContain('"\u7ae0"');
  });

  it('缩进体裁闸只认 poetry 一枚 id，且不许长出第二处自判', () => {
    expect(LAYOUT).toContain('zh_book && genre != "poetry"');
    // 咽喉必须走 finalise_for_book（入口共用一枚判据），不许回退成两参 indent_for_book 直调
    expect(EXPORT_JOBS).toContain('finalise_for_book(layout, &all_text, genre)');
    expect(EXPORT_JOBS).not.toMatch(/indent_for_book\(layout, zh_book\)/);
  });

  it('导出日志行的量词走表，裸「[format] 章《」绝迹', () => {
    expect(EXPORT_JOBS).toContain('{unit}《{}》结构层修正');
    expect(EXPORT_JOBS).not.toContain('[format] \u7ae0《');
  });

  it('DOCX 段落层与 PDF 排版层不许再私加缩进（F4 贯通两层）', () => {
    // DOCX：段落 pPr 只准从 body_ppr（layout 裁定）来；函数体内不许再立硬编码 const
    expect(DOCX).toContain('let body_ppr = if layout.indent');
    const docxFns = DOCX.slice(DOCX.indexOf('fn paragraph('));
    expect(docxFns).not.toMatch(/const INDENT_PPR/);
    // PDF：首行缩进必须吃 lay.indent_em（from_spec 算好的开关），不许回到 body*2.0
    expect(PDF).toContain('lay.body * lay.indent_em');
    expect(PDF).not.toMatch(/let indent = lay\.body \* 2\.0;/);
  });
});
