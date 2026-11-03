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

  it('导出入口已接快照流水线（B4b 改判）：disabled 占位与 exportSoonHint 不许回流', () => {
    // 改判说明（红线 3）：B5a 时导出流水线未建，按钮刻意 disabled 占位（UI 不撒谎）。
    // B4b 完成接线，占位语义作废：这里反向锁「不许退回 disabled/预告文案」，
    // 并正向锁新入口必须走快照队列命令面（而不是旧「另存为」链路）。
    expect(page).not.toMatch(/exportSoonHint/);
    expect(page).not.toMatch(/disabled data-testid=\{`published-version-export/);
    expect(page).toMatch(/from '\.\/publishedPage\/ExportVersionDialog'/);
    for (const call of [
      /workVersionApi\.enqueueExport\(/,
      /workVersionApi\.listExportJobs\(/,
      /workVersionApi\.retryExportJob/,
      /workVersionApi\.dismissExportJob/,
      /workVersionApi\.listArtifacts\(/,
      /workVersionApi\.revealArtifact\(/,
      /workVersionApi\.copyArtifactTo\(/,
    ]) {
      expect(page, `缺 B4b 导出接线：${call}`).toMatch(call);
    }
    // 导出弹窗组件自身只交「版本 + 格式」，正文/路径都不经前端（§5.2 取数死口径）
    const dialog = readFileSync(`${ROOT}/src/pages/publishedPage/ExportVersionDialog.tsx`, 'utf8');
    expect(dialog).toMatch(/enqueueExport\(version\.id, formats\)/);
    expect(dialog).not.toMatch(/saveDialog|save as|另存为/);
  });
});

describe('④ 文案双语齐备 + 占位符一致（缺一侧 = 对端语言渲染裸 key）', () => {
  const KEYS = [
    'subtitleV2', 'backToBooks', 'rootChipLabel', 'rootOpen', 'rootOpenFailed', 'rootLoadFailed',
    'filterFinalAll', 'filterHasFinal', 'filterNoFinal', 'bookCount', 'timelineEmpty', 'goLockVersion',
    'setFinal', 'setFinalDone', 'setFinalFailed', 'versionDeleted', 'deletedFilesRetainedHint', 'deleteVersionFailed',
    'snapshotFailed', 'confirmDeleteVersion', 'confirmDeleteVersionDesc', 'deleteVersion',
    'emptyTitleV2', 'emptyHintV2', 'cardFinishedChip', 'cardLockedChip', 'latestVersionN', 'finalTag',
    'versionCountN', 'noVersionYet', 'lockedOn', 'exportBtn', 'alreadyFinal',
    'snapshotChapters', 'fingerprintLabel', 'untitledChapter',
    // B4b 导出接线新增键
    'exportDialogTitle', 'exportFormatsHint', 'exportFormatsLabel', 'exportNeedFormat', 'exportSubmit',
    'exportEnqueued', 'exportEnqueueFailed', 'jobsPanelTitle', 'jobQueued', 'jobRunning', 'jobFailed',
    'jobRetry', 'jobDismiss', 'jobActionFailed', 'artifactsLabel', 'artifactsEmpty', 'artifactMissing',
    'artifactReveal', 'artifactCopy', 'artifactCopied', 'artifactCopyFailed', 'artifactRegenerate',
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
