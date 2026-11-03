// 第三十三轮 · 字号批次 3（8 文件 / 354 处）的裸 px 扫描锁
//
// 病灶与批次 1（第 27 轮 29 文件）、批次 2（第 29 轮 7 文件 / 702 处）同型：
// `AppTheme.scaleTypography` 只缩放 MUI variant，组件里自写 `sx={{ fontSize: 12 }}`
// 与 `style={{ fontSize: 12 }}` 的文字**一个都不跟「设置 → 字体大小」档位** ——
// 用户切到「大」，写作台顶栏 / 工作台面板 / 画布页签 / 影响分析这些区域纹丝不动，
// 读到的还是那句「设置没生效」。本轮清的是按裸 px 降序排下来的 8 个文件。
//
// 本文件的价值同前两批：**新增即红**。谁在这 8 个文件里再写一个裸数字字号，或者
// 私自复制第二份换算实现，都会撞红。
//
// 口径备忘（第 26/28 轮定，勿混通道）：
//  · `src/editor/renderers/**` 不归界面字号（画布零 Emotion + 自有 zoom）—— 本清单不含；
//    `src/theme/**` 是档位定义处，本就该写 px —— 亦不含；
//  · 代码区（Monaco / xterm）走 `codeFontSize` 那条独立通道，数字口径不同，不许并进来；
//  · 判据先归一空白再匹配，**不许绑 prettier 的换行**（第 28 轮铁律）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(`${process.cwd()}/src/${rel}`, 'utf8');

/** 裸数字字号：`fontSize: 12` / `fontSize: 10.5,`（已包成 uiFontSize(...) 的不会命中） */
const RAW_FONT_SIZE_RE = /fontSize:\s*\d+(?:\.\d+)?\s*[,)}]/;

describe('字号批次 3（第 33 轮 8 文件 / 354 处）· 裸 px 不得回潮', () => {
  it('扫描判据自证：正则扫得动才谈得上「锁」（扫不动 = 假绿）', () => {
    expect(RAW_FONT_SIZE_RE.test('sx={{ fontSize: 12, color: "red" }}')).toBe(true);
    expect(RAW_FONT_SIZE_RE.test('fontSize: 10.5,')).toBe(true);
    expect(RAW_FONT_SIZE_RE.test('fontSize: 15 }')).toBe(true);
    // 已挂档位的写法必须判为「合规」，否则锁会把正确代码也拦红
    expect(RAW_FONT_SIZE_RE.test('fontSize: uiFontSize(12),')).toBe(false);
    expect(RAW_FONT_SIZE_RE.test('fontSize: inlineDiffFont.fontSize,')).toBe(false);
  });

  // 清单 = 本轮按「未登记文件裸 px 降序」取的前 8 个（均为 MUI sx / 内联 style 的真界面文字与图标）
  const BATCH3 = [
    'editor/SceneEditor.tsx',
    'editor/panels/workbenchComponents.tsx',
    'editor/panels/BookMetaPanel.tsx',
    'editor/components/EditorContextMenu.tsx',
    'editor/panels/WorkbenchEditorPane.tsx',
    'pages/PublishedScenesPage.tsx',
    'editor/panels/ImpactAnalysisPanel.tsx',
    'editor/sceneEditor/projectCanvas.tsx',
  ];

  it('清单齐 8 个文件（少一个就是一次「清单跟不上改动」的重演）', () => {
    expect(BATCH3).toHaveLength(8);
  });

  it.each(BATCH3)('%s：都经 uiFontSize 换算，且不得再有裸 px 字号', (rel: string) => {
    const src = read(rel);
    expect(src.includes('uiFontSize('), `${rel} 必须经 uiFontSize 换算界面字号`).toBe(true);
    const line = src.split('\n').find((l) => RAW_FONT_SIZE_RE.test(l));
    expect(line, `${rel} 又出现了不跟随档位的裸 px 字号：${line?.trim()}`).toBeUndefined();
  });

  it.each(BATCH3)('%s：uiFontSize 只从单一真源 theme/appearanceScales 导入', (rel: string) => {
    const src = read(rel);
    expect(src, `${rel} 未经 appearanceScales 拿到 uiFontSize`).toMatch(
      /import\s*\{[^}]*\buiFontSize\b[^}]*\}\s*from\s*['"][^'"]*theme\/appearanceScales['"]/,
    );
  });

  it('换算实现全仓唯一：appearanceScales 之外不得再出现第二份 uiFontSize 定义', () => {
    // 有人复制一份「自己乘系数」的实现 = 档位口径立刻分成两支，切档只有半边动
    const dup = BATCH3.filter((rel) => /function\s+uiFontSize|const\s+uiFontSize\s*=/.test(read(rel)));
    expect(dup, `以下文件私自定义了 uiFontSize：${dup.join(', ')}`).toEqual([]);
  });
});

describe('批次 3 的独立通道不许被误并（防「顺手统一」把好口径拆掉）', () => {
  it('WorkbenchEditorPane 的代码区仍走 codeFontSize，不套 uiFontSize', () => {
    // 代码区字号是第 24 轮定的独立通道（基准 × 档位系数取整，吃数字不吃 calc 串）。
    // 若有人把它「并进」uiFontSize，Monaco options 会当场拿到非法值。
    const src = read('editor/panels/WorkbenchEditorPane.tsx');
    expect(src).not.toMatch(/options=\{[^}]*fontSize:\s*uiFontSize\(/);
  });

  it('画布渲染区（editor/renderers）与档位定义处（theme）仍在豁免口径内', () => {
    // 这两块「不跟界面字号」是**决定**而不是漏网，写在这里防下一轮把它们当存量扫进来批量改。
    const canvas = read('editor/renderers/canvasEntity.css');
    expect(canvas).toContain('font-size');
    const scales = read('theme/appearanceScales.ts');
    expect(scales).toContain('export function uiFontSize');
  });
});
