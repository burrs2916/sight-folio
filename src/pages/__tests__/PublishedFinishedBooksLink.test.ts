// 「已完结」↔「完结作品」关联回归锁 —— 2026-11-03 B5a 重写。
//
// 历史：本锁最早盯的是临时补丁 FinishedPendingBand（2026-11-03 上午的止血片）。
// 需求 §12 明确：P0 正式结构落地时该带「由正式结构取代并删除」。B5a 把页面重做为
// 「一级书卡片 → 二级版本时间线」，R1 的正式口径变成：
//   **已标完结的书（或已有锁定版本的书）一律成卡**；0 版本卡上直接给锁定出口。
// 断言相应从「带组件存在」升级为「书卡片是页面的唯一一级实体、旧产物表依赖清零」。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const page = readFileSync(`${ROOT}/src/pages/PublishedScenesPage.tsx`, 'utf8');
const zhJson = JSON.parse(readFileSync(`${ROOT}/src/i18n/zh-CN.json`, 'utf-8')) as Record<string, Record<string, string>>;
const enJson = JSON.parse(readFileSync(`${ROOT}/src/i18n/en-US.json`, 'utf-8')) as Record<string, Record<string, string>>;

describe('① R1：完结声明必须能在成品页显形', () => {
  it('一级卡片入选口径 = 已标完结 或 已有锁定版本（isBookFinished 唯一判读入口）', () => {
    expect(page).toMatch(/import \{ isBookFinished \} from '\.\.\/utils\/writingSchema';/);
    expect(page).toMatch(/isBookFinished\(b\.status\) \|\| \(versionsByBook\[b\.id\]\?\.length \?\? 0\) > 0/);
  });

  it('0 版本的书渲染「尚无定稿版本」提示与「去写作台锁定一版」出口', () => {
    expect(page).toMatch(/t\('published\.noVersionYet'\)/);
    expect(page).toMatch(/t\('published\.goLockVersion'\)/);
    expect(page).toMatch(/published-card-lock-\$\{book\.id\}/);
  });

  it('临时补丁 FinishedPendingBand 已被正式结构取代（需求 §12），不得回流', () => {
    expect(page).not.toMatch(/FinishedPendingBand/);
  });
});

describe('② 书名现取，杜绝副本（需求 §3 设计约束 1）', () => {
  it('页面不再出现任何 bookTitle 冗余字段读写', () => {
    expect(page).not.toMatch(/bookTitle/);
  });

  it('标题一律来自 writingStore 的书目对象（join 语义的前端承担体）', () => {
    expect(page).toMatch(/useWritingStore\(\(s\) => s\.books\)/);
    expect(page).toMatch(/books\.find\(\(b\) => b\.id === openBookId\)/);
  });
});

describe('③ 与旧产物登记表彻底切割（B6 退役的前置）', () => {
  it('不再 import/调用 completedWorksApi 与旧表命令', () => {
    expect(page).not.toMatch(/completedWorksApi/);
    expect(page).not.toMatch(/save_completed_work|list_completed_works|import_completed_works|move_completed_work/);
  });

  it('版本层命令全部接线：list / setFinal / delete / snapshot / 作品库根', () => {
    for (const call of [
      /workVersionApi\.list\(/,
      /workVersionApi\.setFinal\(/,
      /workVersionApi\.delete\(/,
      /workVersionApi\.snapshot\(/,
      /workVersionApi\.getLibraryRoot\(/,
    ]) {
      expect(page, `缺命令接线：${call}`).toMatch(call);
    }
  });

  it('导出按钮是 disabled 占位（B4 前不接旧「另存为」链路）', () => {
    expect(page).toMatch(/disabled data-testid=\{`published-version-export-\$\{version\.seq\}`\}/);
    expect(page).toMatch(/exportSoonHint/);
  });
});

describe('④ 文案双语齐备 + 占位符一致（缺一侧 = 对端语言渲染裸 key）', () => {
  const KEYS = [
    'subtitleV2', 'backToBooks', 'rootChipLabel', 'rootOpen', 'rootOpenFailed', 'rootLoadFailed',
    'filterFinalAll', 'filterHasFinal', 'filterNoFinal', 'bookCount', 'timelineEmpty', 'goLockVersion',
    'setFinal', 'setFinalDone', 'setFinalFailed', 'versionDeleted', 'deletedFilesRetainedHint', 'deleteVersionFailed',
    'snapshotFailed', 'confirmDeleteVersion', 'confirmDeleteVersionDesc', 'deleteVersion',
    'emptyTitleV2', 'emptyHintV2', 'cardFinishedChip', 'cardLockedChip', 'latestVersionN', 'finalTag',
    'versionCountN', 'noVersionYet', 'lockedOn', 'exportBtn', 'exportSoonHint', 'alreadyFinal',
    'snapshotChapters', 'fingerprintLabel', 'untitledChapter',
  ];
  for (const key of KEYS) {
    it(`published.${key} 双语存在且占位符一致`, () => {
      const z = zhJson.published?.[key];
      const e = enJson.published?.[key];
      expect(z, `zh 缺 published.${key}`).toBeTruthy();
      expect(e, `en 缺 published.${key}`).toBeTruthy();
      const ph = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(ph(e!), `published.${key} 双语占位符不一致`).toBe(ph(z!));
    });
  }
});
