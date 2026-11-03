// 「已完结」↔「完结作品」关联回归锁（2026-11-03）
//
// 用户报障：把作品设成「已完结」后，完结作品模块里看不到这本书。
// 实测数据坐实：writing_books 里该书 status='finished'，completed_works 表 0 行 ——
// 因为 completed_works 是**导出产物登记表**（format/file_path/file_size/is_file_missing），
// 而「已完结」只是 writing_books.status 上的创作状态，两条数据原本毫无关联，页面又是
// 只从产物表起列表，于是标完结的书在完结作品页无处显形。
//
// 修法与锁点：页面额外从 books 侧算出「已完结 + 零产物」集合并展示出口；但**不许**为了
// 让它出现在列表里而伪造一条 CompletedWork（空 file_path 会把 is_file_missing 的判读
// 带偏：文件真丢了 vs 从来没导出，是两件事）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const page = readFileSync(`${ROOT}/src/pages/PublishedScenesPage.tsx`, 'utf8');
const zh = JSON.parse(readFileSync(`${ROOT}/src/i18n/zh-CN.json`, 'utf8')) as Record<string, Record<string, string>>;
const en = JSON.parse(readFileSync(`${ROOT}/src/i18n/en-US.json`, 'utf8')) as Record<string, Record<string, string>>;

describe('① 完结作品页必须认得「已标完结的书」', () => {
  it('用 writingSchema 的唯一判读入口 isBookFinished，而不是散落字符串比较', () => {
    expect(page).toMatch(/import \{ isBookFinished \} from '..\/utils\/writingSchema';/);
    expect(page).toMatch(/isBookFinished\(b\.status\)/);
  });

  it('已完结集合要排除已有产物的书（同一本书不许出现两次）', () => {
    const at = page.indexOf('const finishedPendingBooks');
    expect(at).toBeGreaterThan(-1);
    const memo = page.slice(at, at + 1200);
    expect(memo).toMatch(/new Set\(works\.map\(\(w\) => w\.bookId\)\)/);
    expect(memo).toMatch(/exportedBookIds\.has\(b\.id\)/);
  });

  it('空态判定同时考虑待导出的已完结书（否则标完结后仍写「暂无完结作品」）', () => {
    expect(page).toMatch(/filteredWorks\.length === 0 && finishedPendingBooks\.length === 0 \? \(/);
  });

  it('冷启动进本页也会刷书目（否则 books 为空，关联静默失效）', () => {
    const at = page.indexOf('挂载首刷走宏任务');
    expect(at).toBeGreaterThan(-1);
    const effect = page.slice(at, at + 600);
    expect(effect).toMatch(/void loadBooks\(\)/);
    expect(effect).toMatch(/\[loadWorks, loadBooks\]/);
  });
});

describe('② 不许伪造导出产物', () => {
  it('页面不直接写产物表：completed_works 的落库只属于导出链路', () => {
    expect(page).not.toMatch(/completedWorksApi\.save\(/);
    expect(page).not.toMatch(/save_completed_work/);
  });

  it('待导出带只给「回到写作台」的出口（openWritingDesk），不给假下载', () => {
    const at = page.indexOf('function FinishedPendingBand');
    expect(at).toBeGreaterThan(-1);
    const comp = page.slice(at, at + 2200);
    expect(comp).toMatch(/onOpenDesk\(b\.id\)/);
  });
});

describe('③ 文案双语齐备（缺一侧会在对端语言渲染成裸 key）', () => {
  for (const key of ['pendingTitle', 'pendingHint']) {
    it(`published.${key} 在 zh-CN / en-US 都存在且非空`, () => {
      expect(zh.published?.[key]?.trim().length ?? 0).toBeGreaterThan(0);
      expect(en.published?.[key]?.trim().length ?? 0).toBeGreaterThan(0);
    });
  }
});
