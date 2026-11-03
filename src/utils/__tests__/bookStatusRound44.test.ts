// 作品状态四态口径锁（2026-11-03 插单六）。
//
// 报修现场：李先生「作品一直停在连载中，改不成完本」。根因不是写不进去，而是
// ① 全项目只有一枚两态 ToggleButtonGroup 能写；② 判读处全是 `=== 'finished' ? 已完本 : 连载中`
// 三元式，任何新状态都会被无条件误标成「连载中」。所以这条锁要同时钉住两件事：
// 词表本身（四态 + 旧值归一 + 标签键可翻译），以及「三元式不许回来」。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zhCN from '../../i18n/zh-CN.json';
import enUS from '../../i18n/en-US.json';
import { BOOK_STATUSES, bookStatusDef, isBookFinished } from '../writingSchema';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('BOOK_STATUSES 四态词表', () => {
  it('四态齐备且顺序即 UI 顺序（连载中 → 已完结 → 暂停更新 → 已弃坑）', () => {
    expect(BOOK_STATUSES.map((s) => s.id)).toEqual(['ongoing', 'finished', 'hiatus', 'abandoned']);
  });

  it('只有终态用实心：已完结 / 已弃坑 = terminal，进行态 = 描边', () => {
    expect(BOOK_STATUSES.filter((s) => s.terminal).map((s) => s.id)).toEqual(['finished', 'abandoned']);
  });

  it('配色只允许语义色名（禁出现具体色值，遵「颜色必须用主题令牌」）', () => {
    const allowed = new Set(['default', 'success', 'warning', 'error']);
    for (const s of BOOK_STATUSES) {
      expect(allowed.has(s.chipColor)).toBe(true);
      expect(s.chipColor).not.toMatch(/[#(]/);
    }
  });

  it('id / labelKey 都不许重复（重复会让 ToggleButtonGroup 与菜单出现两枚同名项）', () => {
    expect(new Set(BOOK_STATUSES.map((s) => s.id)).size).toBe(BOOK_STATUSES.length);
    expect(new Set(BOOK_STATUSES.map((s) => s.labelKey)).size).toBe(BOOK_STATUSES.length);
  });

  it('四个标签键在中英双语包都存在且非空（缺一边就是半个功能）', () => {
    for (const s of BOOK_STATUSES) {
      const [ns, key] = s.labelKey.split('.');
      for (const pack of [zhCN, enUS] as Array<Record<string, unknown>>) {
        const block = pack[ns] as Record<string, unknown> | undefined;
        expect(typeof block?.[key], `${s.labelKey} 缺键`).toBe('string');
        expect((block?.[key] as string).length, `${s.labelKey} 空文案`).toBeGreaterThan(0);
      }
    }
  });
});

describe('bookStatusDef 旧值归一（零迁移的落点）', () => {
  it("'' / 'draft' 都归「连载中」—— 与改造前三元式的判读逐字一致，老书零视觉回归", () => {
    expect(bookStatusDef('').id).toBe('ongoing');
    expect(bookStatusDef('draft').id).toBe('ongoing');
    // 后端建书路径写死过 'draft'（application/writing），历史上从没被 UI 改过
    expect(bookStatusDef('draft').labelKey).toBe('dashboard.statusOngoing');
  });

  it('null / undefined / 脏值一律回落连载中，不造「未知状态」分支', () => {
    expect(bookStatusDef(null).id).toBe('ongoing');
    expect(bookStatusDef(undefined).id).toBe('ongoing');
    expect(bookStatusDef('已完成').id).toBe('ongoing');
    expect(bookStatusDef('FINISHED').id).toBe('ongoing'); // 大小写不认，宁可回落也不猜
  });

  it('规范码原样认，且 isBookFinished 只认 finished', () => {
    for (const s of BOOK_STATUSES) expect(bookStatusDef(s.id).id).toBe(s.id);
    expect(isBookFinished('finished')).toBe(true);
    expect(isBookFinished('draft')).toBe(false);
    expect(isBookFinished('abandoned')).toBe(false);
  });
});

describe("散落的 `=== 'finished'` 三元判读不许回来", () => {
  // 这四枚文件是书状态的读写面。留着三元式 = 新状态被误标成「连载中」的复发路径。
  const GUARDED = [
    'pages/BookshelfPage.tsx',
    'pages/SceneEditorPage.tsx',
    'editor/panels/BookMetaPanel.tsx',
    'ai/providers/writingContextProvider.ts',
  ];

  it.each(GUARDED)('%s 不再直接判 book.status 字符串', (rel) => {
    const text = readFileSync(join(SRC_DIR, rel), 'utf8');
    expect(text).not.toMatch(/book\.status === 'finished'/);
    expect(text).not.toMatch(/\bb\.status === 'finished'/);
    expect(text).not.toMatch(/activeBook\.status === 'finished'/);
  });

  it('四处判读全部走口径表（直接引用 bookStatusDef，或整体交给共享控件 BookStatusChip）', () => {
    // 书架把判读整枚交给共享 chip，自己不碰状态字符串 —— 这同样是「口径唯一」，
    // 硬要求它 import bookStatusDef 反而会逼人为了过锁写一句无用引用。
    for (const rel of [...GUARDED, 'pages/BookStatusControl.tsx']) {
      const text = readFileSync(join(SRC_DIR, rel), 'utf8');
      const hooked = /bookStatusDef/.test(text) || /BookStatusChip/.test(text);
      expect(hooked, `${rel} 未接入口径表`).toBe(true);
    }
  });
});
