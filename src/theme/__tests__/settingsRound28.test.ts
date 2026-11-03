// 第二十八轮 · 第 27 轮「消费点/覆盖面」的源码扫描锁（待办 1 的 ③④⑤）
//
// 扫描锁在这个仓库不是装饰：第 26 轮实测「字体大小切到『大』主界面大面积不变」，
// 病根就是散落的裸 px；第 27 轮清了 29 个文件却没进清单（推进记录原话：
// 「下一轮谁再往里写裸 px 不会有人拦」）。本文件把三件事钉死：
//  ⑤ 批次 1 的 29 个文件不得再出现裸 px 字号（含 WritingPage 本体 —— 上轮漏进清单的就是它）；
//  ④ 打字机滚动的居中算法全仓只许有一份执行体（utils/typewriterScroll.ts），
//     写作台与画布两个消费点必须各就其位（画布现取档位 + 只读不滚）；
//  ③ 全出血页开关的 App.tsx 消费式 + 抽屉接线 + i18n 双包在位；
//  ② 备份恢复对 appearance_profiles 走 adoptProfiles，禁止回退成 init()（会把选中态盖掉）。
// 铁律：判据先归一空白再匹配，不许绑 prettier 的换行。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(`${process.cwd()}/src/${rel}`, 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ');

/** 递归收集 src 下的 ts/tsx（跳过测试目录 —— 测试里出现相关字面量是合法的） */
function collectSource(dir = 'src', acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) collectSource(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/__tests__/.test(p)) acc.push(p);
  }
  return acc;
}

describe('⑤ 字号批次 1（第 27 轮 29 文件 / 546 处）· 裸 px 不得回潮', () => {
  // 清单 = 第 27 轮收工记录点名的 29 个文件（WritingPage 本体 + writingPage/** 28 个）
  const BATCH1 = [
    'pages/WritingPage.tsx',
    'pages/writingPage/InspirationExpandPanel.tsx',
    'pages/writingPage/SettingHistoryPanel.tsx',
    'pages/writingPage/InlineAiResultDialog.tsx',
    'pages/writingPage/EmotionArcPanel.tsx',
    'pages/writingPage/TypographyPopover.tsx',
    'pages/writingPage/ShortcutsDialog.tsx',
    'pages/writingPage/AiFlavorPanel.tsx',
    'pages/writingPage/InlineAiDialog.tsx',
    'pages/writingPage/CraftComparePanel.tsx',
    'pages/writingPage/SettingAiCompleteDialog.tsx',
    'pages/writingPage/AnnotationViewDialog.tsx',
    'pages/writingPage/ExternalCapturePanel.tsx',
    'pages/writingPage/ExternalCaptureDialog.tsx',
    'pages/writingPage/ExportCountBadge.tsx',
    'pages/writingPage/useToolbarButtons.tsx',
    'pages/writingPage/useDialogActions.tsx',
    'pages/writingPage/FindReplaceDialog.tsx',
    'pages/writingPage/AiCorpusPanel.tsx',
    'pages/writingPage/WritingDrawer.tsx',
    'pages/writingPage/AiSelectionMenu.tsx',
    'pages/writingPage/ShowTellPanel.tsx',
    'pages/writingPage/CorpusReferencePanel.tsx',
    'pages/writingPage/WritingHealthDialog.tsx',
    'pages/writingPage/TimelineDraftDialog.tsx',
    'pages/writingPage/MaterialAssistDialog.tsx',
    'pages/writingPage/AiReviewDialog.tsx',
    'pages/writingPage/ProofreadPanel.tsx',
    'pages/writingPage/AnnotationCreateDialog.tsx',
  ];

  it('清单齐 29 个文件（少一个就是一次「清单跟不上改动」的重演）', () => {
    expect(BATCH1).toHaveLength(29);
  });

  it('每个文件都经 uiFontSize 换算，且不得再有裸 px 字号', () => {
    for (const rel of BATCH1) {
      const src = read(rel);
      expect(src.includes('uiFontSize('), `${rel} 必须经 uiFontSize 换算界面字号`).toBe(true);
      expect(src, `${rel} 又出现了不跟随档位的裸 px 字号`).not.toMatch(/fontSize:\s*\d+(\.\d+)?\s*[,)}]/);
    }
  });
});

describe('④ 打字机滚动 · 全仓只许一个执行体，两个消费点各就其位', () => {
  it('几何判据（1/4 视高阈值 / 偏移量）只出现在 utils/typewriterScroll.ts', () => {
    const offenders = collectSource()
      .filter((p) => !p.endsWith('utils/typewriterScroll.ts'))
      .filter((p) => {
        const src = norm(readFileSync(p, 'utf8'));
        return src.includes('viewH / 4') || src.includes('offsetFromCenter');
      });
    expect(offenders, '第二份居中算法必然与第一份漂移 —— 这正是抽出唯一执行体的原因').toEqual([]);
  });

  it('写作台消费点：走共用判定 + 共用算法，外层滚动容器显式传入', () => {
    const src = norm(read('pages/WritingPage.tsx'));
    expect(src).toContain('if (!shouldCenterCaret(prefs.typewriterScroll, prefs.focusMode)) return;');
    expect(src).toContain('centerCaretInViewport(editor, editorScrollRef.current)');
    // 档位现取：用订阅值会把回调冻在旧档位（第 25 轮 saveDebounceMs 的教训）
    expect(src).toContain('useWritingPrefsStore.getState().config');
  });

  it('画布章节编辑器消费点：只读审阅态不滚 + 档位现取 + 不传 scrollEl（容器是 ProseMirror 自己）', () => {
    const src = norm(read('editor/renderers/WritingChapterEditor.tsx'));
    expect(src).toContain('onSelectionUpdate:');
    expect(src).toContain('if (!ed.isEditable) return;');
    expect(src).toContain('useWritingPrefsStore.getState().config');
    expect(src).toContain('shouldCenterCaret(prefs.typewriterScroll, prefs.focusMode)');
    expect(src).toContain('centerCaretInViewport(ed)');
    expect(src).not.toContain('centerCaretInViewport(ed,');
  });
});

describe('③ 全出血页开关 · App.tsx 消费式与抽屉接线', () => {
  it('shellFollowsLayout = 非全出血页恒真 || 开关读数；内容壳三处（padding/maxWidth/mx）全走它', () => {
    const src = norm(read('App.tsx'));
    expect(src).toContain(
      'const shellFollowsLayout = !isFullBleedRoute || resolveFullBleedFollowsLayout(layoutConfig?.fullBleedFollowsLayout);',
    );
    expect(src).toContain('p: shellFollowsLayout ? contentPad : 0');
    expect(src).toContain('maxWidth: shellFollowsLayout ? { sm:');
    expect(src).toContain('mx: shellFollowsLayout ?');
    // 三条全出血路由还在（开关只是允许它们跟随布局，不是把它们从全出血清单里删掉）
    expect(src).toContain("location.pathname.startsWith('/analyzer')");
    expect(src).toContain("location.pathname.startsWith('/library')");
    expect(src).toContain("location.pathname.startsWith('/ai')");
  });

  it('抽屉开关接线到 layoutStore 的同一个 action（不许第二条写入链路）', () => {
    const src = norm(read('components/layout/SettingsDrawer.tsx'));
    expect(src).toContain('data-testid="full-bleed-follows-layout-switch"');
    expect(src).toContain('onChange={(e) => setFullBleedFollowsLayout(e.target.checked)}');
    expect(src).toContain('layoutConfig.fullBleedFollowsLayout === true');
  });

  it('新设置项的文案在 zh / en 双包都在（缺一个就是英文界面裸 key）', () => {
    const zhPack = JSON.parse(read('i18n/zh-CN.json')) as Record<string, Record<string, string>>;
    const enPack = JSON.parse(read('i18n/en-US.json')) as Record<string, Record<string, string>>;
    for (const key of [
      'fullBleedFollowsLayout',
      'fullBleedFollowsLayoutHint',
      'presetIncludeWriting',
      'presetIncludeWritingHint',
    ]) {
      expect(zhPack.settings?.[key], `zh-CN 缺 settings.${key}`).toBeTruthy();
      expect(enPack.settings?.[key], `en-US 缺 settings.${key}`).toBeTruthy();
    }
  });
});

describe('② 备份恢复 · appearance_profiles 禁止走 init()', () => {
  it('adoptIntoStores 走 adoptProfiles；文件里不得再出现 useAppearanceStore.getState().init()', () => {
    const src = norm(read('utils/settingsBackup.ts'));
    expect(src).toContain('useAppearanceStore.getState().adoptProfiles(raw)');
    expect(src).not.toContain('useAppearanceStore.getState().init()');
  });

  it('全部键落库后才反查预设高亮：反查位于 applied 判定内、且在逐项落库循环之后', () => {
    const src = norm(read('utils/settingsBackup.ts'));
    const persistAt = src.indexOf('adoptIntoStores(key, raw)'); // 循环体内的逐项采纳
    const guardAt = src.indexOf('if (applied.includes(APPEARANCE_PROFILES_KEY))');
    const detectAt = src.indexOf('detectActiveProfile');
    expect(persistAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(detectAt).toBeGreaterThan(-1);
    // 顺序锁：逐项采纳 → （循环结束）→ applied 判定 → 反查。反查若在循环内，会读到没恢复完的中间态。
    expect(guardAt).toBeGreaterThan(persistAt);
    expect(detectAt).toBeGreaterThan(guardAt);
  });
});
