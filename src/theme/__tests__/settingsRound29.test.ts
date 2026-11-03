// 第二十九轮 · 字号批次 2（7 文件 / 702 处）的裸 px 扫描锁
//
// 病灶与批次 1 同型：`uiFontSize` 之前的轮次只缩放 MUI variant，组件里自写
// `sx={{ fontSize: 12 }}` 的文字一个都不跟「设置 → 字体大小」档位 —— 用户读到的是
// 「设置没生效」。第 27 轮清了批次 1 的 29 个文件，第 28 轮待办点名批次 2 的这 7 个
// （LibraryPage / AiAgentPage / EntityPortraitPanel / ComponentCenterPanel /
//  WorkbenchAiPanel / SceneEditorPage / WritingInspectorPanel）。
// 第 28 轮立的规矩在这里兑现：**改完立刻进扫描锁清单**，否则下一轮谁再写裸 px 没人拦。
//
// 口径备忘（第 26/28 轮定，勿混通道）：
//  · src/editor/renderers/** 不归界面字号（画布零 Emotion + 自有 zoom）—— 本清单不含；
//  · 画布正文字号归「正文默认排版」，不归「字体大小」；
//  · 代码区（Monaco/xterm）走 codeFontSize 那条通道（如 WorkbenchAiPanel 的
//    `fontSize: inlineDiffFont.fontSize`，非裸数字、不锁也不该锁）；
//  · 判据先归一空白再匹配，不许绑 prettier 的换行（第 28 轮铁律）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(`${process.cwd()}/src/${rel}`, 'utf8');

describe('字号批次 2（第 29 轮 7 文件 / 702 处）· 裸 px 不得回潮', () => {
  // 清单 = 第 28 轮待办 1 点名的 7 个文件（按裸 px 降序进组）
  const BATCH2 = [
    'pages/LibraryPage.tsx',
    'pages/AiAgentPage.tsx',
    'editor/panels/EntityPortraitPanel.tsx',
    'editor/panels/ComponentCenterPanel.tsx',
    'editor/panels/WorkbenchAiPanel.tsx',
    'pages/SceneEditorPage.tsx',
    'editor/panels/WritingInspectorPanel.tsx',
  ];

  it('清单齐 7 个文件（少一个就是一次「清单跟不上改动」的重演）', () => {
    expect(BATCH2).toHaveLength(7);
  });

  it('每个文件都经 uiFontSize 换算，且不得再有裸 px 字号', () => {
    for (const rel of BATCH2) {
      const src = read(rel);
      expect(src.includes('uiFontSize('), `${rel} 必须经 uiFontSize 换算界面字号`).toBe(true);
      expect(src, `${rel} 又出现了不跟随档位的裸 px 字号`).not.toMatch(/fontSize:\s*\d+(\.\d+)?\s*[,)}]/);
    }
  });

  it('uiFontSize 一律从单一真源 theme/appearanceScales 导入（不许第二份换算实现）', () => {
    for (const rel of BATCH2) {
      const src = read(rel);
      expect(src, `${rel} 未经 appearanceScales 拿到 uiFontSize`).toMatch(
        /import\s*\{\s*uiFontSize\s*\}\s*from\s*['"][^'"]*theme\/appearanceScales['"]/,
      );
    }
  });
});

describe('批次 2 的既有通道不许被误并（防「顺手统一」把好口径拆掉）', () => {
  it('WorkbenchAiPanel 的 AI 建议对照仍走 codeFontSize 那条线（inlineDiffFont），不套 uiFontSize', () => {
    // 代码区字号是第 24 轮定的独立通道：基准 × 档位系数取整，吃的是数字不是 calc 串。
    // 若有人把它「并进」uiFontSize 字符串，Monaco options 会当场拿到非法值。
    const src = read('editor/panels/WorkbenchAiPanel.tsx');
    expect(src).toContain('fontSize: inlineDiffFont.fontSize');
    expect(src).not.toMatch(/options=\{[^}]*fontSize:\s*uiFontSize\(/);
  });
});
