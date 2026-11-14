// 排版设置的跨语言源码锁（R1，2026-11-06）
//
// 为什么必须存在：排版真源在前端（`writing_typography` / `writing_typography_books` 两个设置键），
// 而产物版式由 Rust 生成 —— Rust 侧只能**另抄一份**字体栈表与 clamp 区间。两份表一旦漂移，
// 症状是"写作台里选宋体，导出的书里是别的字面"，且**两边单测都会绿**（各自内部自洽）。
// 这是本案最容易被静默改坏的一处，所以钉成源码锁：改一边不改另一边直接红。
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { FONT_FAMILY_OPTIONS, LATIN_FONT_OPTIONS, DEFAULT_TYPOGRAPHY } from '../typography';
import {
  WRITING_TYPOGRAPHY_SETTINGS_KEY,
} from '../../store/typographyDefaultsStore';
import { BOOK_TYPOGRAPHY_SETTINGS_KEY } from '../../store/bookTypographyStore';

const RUST = readFileSync(`${process.cwd()}/src-tauri/src/application/writing/layout.rs`, 'utf8');
const STORE = readFileSync(`${process.cwd()}/src/store/typographyDefaultsStore.ts`, 'utf8');

describe('排版设置 → 产物版式：跨语言一致性锁', () => {
  it('设置键两侧逐字相同（Rust 读错键 = 静默用默认值，比报错更坏）', () => {
    expect(RUST).toContain(`"${WRITING_TYPOGRAPHY_SETTINGS_KEY}"`);
    expect(RUST).toContain(`"${BOOK_TYPOGRAPHY_SETTINGS_KEY}"`);
    // 前端自己也不能把这两个键改名而不同步 Rust
    expect(STORE).toContain(`= '${WRITING_TYPOGRAPHY_SETTINGS_KEY}'`);
  });

  it('每一个中文字体栈都必须在 Rust 表里有同串（少一条 = 该字体在产物里失效）', () => {
    for (const opt of FONT_FAMILY_OPTIONS) {
      if (!opt.stack) continue; // system 是空串（跟随系统），Rust 侧同样给空串
      expect(RUST, `中文栈缺失：${opt.key} → ${opt.stack}`).toContain(opt.stack);
    }
  });

  it('每一个西文栈同样要在 Rust 表里逐字存在', () => {
    for (const opt of LATIN_FONT_OPTIONS) {
      if (!opt.stack) continue;
      expect(RUST, `西文栈缺失：${opt.key} → ${opt.stack}`).toContain(opt.stack);
    }
  });

  it('内置默认值逐项对齐 DEFAULT_TYPOGRAPHY（对不上就是"产物比编辑器多改了点什么"）', () => {
    const body = RUST.slice(RUST.indexOf('impl Default for BookLayoutSpec'));
    const raw = (k: string): string | undefined =>
      new RegExp(`${k}:\\s*([0-9.]+|String::new\\(\\)|false|true)`).exec(body)?.[1];
    const num = (k: string): number => Number(raw(k));
    // Rust 里写 `16.0`、TS 里是 `16` —— 必须按数值比，按字面比是我一开始的错
    expect(num('font_size_px')).toBe(DEFAULT_TYPOGRAPHY.fontSize);
    expect(num('line_height')).toBe(DEFAULT_TYPOGRAPHY.lineHeight);
    expect(num('para_spacing_em')).toBe(DEFAULT_TYPOGRAPHY.paraSpacing);
    expect(raw('indent')).toBe(String(DEFAULT_TYPOGRAPHY.indent));
    expect(raw('font_family')).toBe('String::new()');
  });

  it('clamp 区间两侧一致（前端 14-22 / 1.4-2.6 / 0-2）', () => {
    expect(RUST).toContain('clamp(n, 14.0, 22.0)');
    expect(RUST).toContain('clamp(n, 1.4, 2.6)');
    expect(RUST).toContain('clamp(n, 0.0, 2.0)');
  });

  it('产物默认不许偷偷开首行缩进（应用默认是关的，偷偷开就是产物≠所见）', () => {
    expect(DEFAULT_TYPOGRAPHY.indent).toBe(false);
    expect(RUST).toContain('indent: false');
  });
});
