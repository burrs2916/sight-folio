// 第三十二轮 · 圆角档位收尾的扫描锁（收第 31 轮待办 1「逐处拍板 + 例外清单登记」）
//
// 背景：「圆角风格」这一维从前只喂 MUI variant，非 variant 的写法一律不跟 ——
// 用户切到「直角」仍看到一堆圆角卡片，读到的还是那句「设置没生效」。第 31 轮建好
// `--app-radius-base` 通道（渲染锁见 radiusChannelRound31），本轮把**存量**清完：
// 该跟档位的挂上档位，几何值 / 胶囊 / 画布就地写理由并登记成下方例外清单。
//
// 本文件的价值不在「放行例外」，而在**新增即红**：任何人不写理由再塞一个
// `borderRadius: '<px>'` 字面量，或把已登记的例外悄悄删掉注释 / 改了值，都会撞红。
//
// 判据口径（沿用第 28/29 轮铁律）：先归一空白再匹配，不绑 prettier 换行。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const SRC_ROOT = `${process.cwd()}/src`;

/** 递归取 src 下的 .ts/.tsx（排除测试与 theme 自身：档位定义本来就该是 px） */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = `${dir}/${name}`;
    if (!statSync(abs).isDirectory()) {
      if (/\.(ts|tsx)$/.test(name) && !name.includes('.test.')) out.push(abs);
      continue;
    }
    if (name === '__tests__') continue;
    out.push(...listSourceFiles(abs));
  }
  return out;
}

const relOf = (abs: string) => abs.slice(SRC_ROOT.length + 1);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `borderRadius: '<字面量>'`（单双引号都认；含 !important 与四角分别取值那些） */
const STRING_RADIUS_RE = /borderRadius:\s*(['"])((?:(?!\1)[^])*?)\1/g;

/**
 * 只管**带 px 的长度**：`'50%'` / `'999px'` 之外的百分比与半高胶囊一类不是圆角档的候选，
 * 第 31 轮已明文「`'50%'` 与 `999` 是圆形/胶囊指示物，不是圆角档」，别把它们卷进来当病灶。
 */
const hasPx = (v: string) => /\d+(\.\d+)?px/.test(v);

/** 例外清单：key = 文件，value = 该文件允许出现的圆角字面量（已逐处拍板并就地写了理由） */
const EXCEPTIONS: Record<string, { value: string; reason: string }[]> = {
  // —— 胶囊 / 半高：随控件高度走的几何值，套档位会在 large/round 档糊成药丸 ——
  'editor/panels/workbenchComponents.tsx': [
    { value: '11px', reason: 'height:22 的快捷动作 chip，11px = 高度一半，是胶囊不是圆角档' },
  ],
  'pages/writingPage/AiSelectionMenu.tsx': [
    { value: '18px', reason: '浮层工具条刻意做成胶囊，跟档位会在「直角」档塌成方框' },
  ],
  'utils/languageIcon.tsx': [{ value: '4px', reason: '14px 语言缩写徽章，4px≈边长 28%；跟档位会撑成圆形糊掉两字母' }],
  // —— 正文纸面：归「正文默认排版」管，不归界面圆角档（第 26 轮定的通道划分）——
  'pages/writingPage/editorSx.ts': [
    { value: '2px', reason: '正文行内 mark / 批注色块的微圆角，跟档位会撑成药丸破坏排版' },
  ],
  // —— 只圆两角的多值形状：单值档位表达不了 ——
  'pages/WritingStatsDialog.tsx': [{ value: '2px 2px 0 0', reason: '柱状图柱体只圆顶两角，随柱高柱宽走的几何值' }],
  'pages/WritingPage.tsx': [{ value: '2px 2px 0 0', reason: 'Tabs 指示条高 3px 只圆顶两角，跟档位会把细线撑成半圆' }],
  // —— 画布区：第 26/30/31 轮口径「画布零 Emotion + 自有 zoom，独立视觉语言」——
  'editor/renderers/shapeDecorations.tsx': [
    { value: '5px 5px 0 0', reason: '画布装饰形状顶标签，画布区不跟界面圆角档' },
  ],
  'editor/renderers/writingPanes.tsx': [
    { value: '2px 2px 0 0', reason: '画布写作面板页签指示条，画布区不跟界面圆角档' },
  ],
};

/** 画布渲染区整目录按既有口径豁免（不是漏网，是通道划分） */
const CANVAS_DIR = 'editor/renderers/';

function collectStringPxRadius() {
  const hits: { rel: string; value: string }[] = [];
  for (const abs of listSourceFiles(SRC_ROOT)) {
    const rel = relOf(abs);
    if (rel.startsWith('theme/')) continue; // 档位定义处本就该写 px
    const src = readFileSync(abs, 'utf8');
    for (const m of src.matchAll(STRING_RADIUS_RE)) {
      const value = norm(m[2]);
      if (hasPx(value)) hits.push({ rel, value });
    }
  }
  return hits;
}

describe('圆角档位收尾（第 32 轮）· 字面量 px 不得在未登记的情况下出现', () => {
  const hits = collectStringPxRadius();

  it('扫到了东西（扫不动 = 正则失效，锁会假绿，先自证）', () => {
    expect(hits.length).toBeGreaterThan(10);
  });

  it('每一处都落在「档位通道 / 画布区 / 例外清单」三者之一', () => {
    const offenders: string[] = [];
    for (const { rel, value } of hits) {
      if (value.includes('var(--app-radius-base')) continue; // 已挂档位通道
      if (rel.startsWith(CANVAS_DIR)) continue; // 画布区按口径豁免
      const allowed = EXCEPTIONS[rel]?.some((e) => e.value === value);
      if (!allowed) offenders.push(`${rel} : borderRadius: '${value}'`);
    }
    expect(offenders, `出现未登记的硬编码圆角：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('例外清单不得空转：登记的每一处至今仍真实存在（改了值/删了代码就要同步销账）', () => {
    const stale: string[] = [];
    for (const [rel, entries] of Object.entries(EXCEPTIONS)) {
      const present = hits.filter((h) => h.rel === rel).map((h) => h.value);
      for (const e of entries) {
        if (!present.includes(e.value)) stale.push(`${rel} : '${e.value}'`);
      }
    }
    expect(stale, `例外清单里的这几处已经不在代码里了，请销账：\n${stale.join('\n')}`).toEqual([]);
  });

  it('登记的每一处旁边都留着理由注释（防「注释被顺手删掉、下轮又当漏网重扫」）', () => {
    const uncommented: string[] = [];
    for (const rel of Object.keys(EXCEPTIONS)) {
      // 画布区整目录按第 26/31 轮口径整体豁免，不逐处要求就地注释（那里另有 CV_RADIUS 例外锁）
      if (rel.startsWith(CANVAS_DIR)) continue;
      const src = readFileSync(`${SRC_ROOT}/${rel}`, 'utf8');
      if (!src.includes('圆角例外')) uncommented.push(rel);
    }
    expect(uncommented, `以下文件缺「圆角例外」就地理由：\n${uncommented.join('\n')}`).toEqual([]);
  });
});

describe('已挂档位的四处：不许退回硬编码（本轮拍板结果锁死）', () => {
  const read = (rel: string) => readFileSync(`${SRC_ROOT}/${rel}`, 'utf8');

  it('workbenchComponents 三处（composer 卡 / AI 输入框 / 麦克风引导条）走 MUI 乘数', () => {
    const src = read('editor/panels/workbenchComponents.tsx');
    expect(src).not.toMatch(/borderRadius:\s*['"]20px['"]/); // composer 外壳
    expect(src).not.toMatch(/borderRadius:\s*['"]12px['"]/); // AI 输入框
    expect(src).not.toMatch(/borderRadius:\s*['"]10px['"]/); // 麦克风引导条
  });

  it('ReviewFindingsPanel 筛选按钮走 --app-radius-base 通道', () => {
    const src = read('editor/panels/ReviewFindingsPanel.tsx');
    expect(src).toContain('var(--app-radius-base');
    expect(src).not.toMatch(/borderRadius:\s*['"]8px\s*!important['"]/);
  });

  it('除已登记的胶囊例外外，workbenchComponents 不再出现字符串 px 圆角', () => {
    const src = read('editor/panels/workbenchComponents.tsx');
    const rest = [...src.matchAll(/borderRadius:\s*(['"])((?:(?!\1)[^])*?)\1/g)]
      .map((m) => norm(m[2]))
      .filter((v) => v !== '11px');
    expect(rest).toEqual([]);
  });
});
