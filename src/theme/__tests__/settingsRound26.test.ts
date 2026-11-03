// 第二十六轮 · 档位生效链路的回归锁
//
// 这一轮治的四件事，都属于同一类病灶 —— **档位存了、界面没接**：
//  ① `--app-font-size-base` 由 AppTheme 注入 :root，但全仓没有一处 `var()` 读它（死变量）；
//  ② `data-app-motion` 属性同理，注释还声称「静态 CSS 靠它跟随减少动效」；
//     真正的第二条通道在 JS 侧：CSS 的 `scroll-behavior:auto` 压不住显式 `behavior:'smooth'`；
//  ③ 界面 chrome（设置抽屉 / 顶栏 / 侧栏菜单 / 备份区 / 健康条）里 80+ 处裸 px 字号，
//     「字体大小」档位只缩放 MUI variant，这些文字一个都不跟 —— 用户读到的是「切了没反应」；
//  ④ 「正文默认排版」只有写作台读得到，画布里的章节编辑器字号/行高/段距/纸色全是写死值。
// 本文件把这些链路逐条锁住，任何一处改回写死值都会红。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FONT_SIZE_BASE,
  FONT_SIZE_SCALE,
  scrollBehaviorForMotion,
  uiFontSize,
  uiFontSizeRem,
} from '../appearanceScales';
import { bodyTypographyCssVars, DEFAULT_TYPOGRAPHY, resolveBodyFont } from '../../utils/typography';
import type { BookTypography } from '../../utils/typography';
import { useThemeStore } from '../../store/themeStore';
import { currentScrollBehavior, isMotionReduced } from '../../utils/reducedMotion';

const read = (rel: string) => readFileSync(`${process.cwd()}/src/${rel}`, 'utf8');

const { kv } = vi.hoisted(() => ({ kv: new Map<string, string>() }));
vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.set(key, value);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
  },
}));

beforeEach(() => {
  kv.clear();
  useThemeStore.setState({
    config: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium', motion: 'auto' },
    systemMode: 'light',
    systemReducedMotion: false,
  });
});

describe('① uiFontSize：界面裸 px 字号接上「字体大小」档位', () => {
  it('换算只在 appearanceScales 一处，产出走 --app-font-scale', () => {
    expect(uiFontSize(12)).toBe('calc(12px * var(--app-font-scale, 1))');
    expect(uiFontSizeRem(0.84)).toBe('calc(0.84rem * var(--app-font-scale, 1))');
  });

  it('medium 档系数为 1 → 计算结果与改前逐像素一致（老用户观感不变）', () => {
    expect(FONT_SIZE_SCALE.medium).toBe(1);
    // 系数 1 时 calc(12px * 1) === 12px，档位表本身也要守住这个前提
    expect(FONT_SIZE_BASE.medium).toBe(14);
  });

  it('设置抽屉与界面 chrome 不得再出现裸 px 字号', () => {
    for (const rel of [
      'components/layout/SettingsDrawer.tsx',
      'components/layout/AppNavbar.tsx',
      'components/layout/MenuContent.tsx',
      'components/layout/SideMenu.tsx',
      'components/layout/SettingsBackupSection.tsx',
      'components/layout/SettingsHealthNotice.tsx',
      'components/layout/DeskSettingsPanel.tsx',
    ]) {
      const src = read(rel);
      expect(src.includes('uiFontSize('), `${rel} 必须经 uiFontSize 换算界面字号`).toBe(true);
      expect(src, `${rel} 仍有不跟随档位的裸 px 字号`).not.toMatch(/fontSize:\s*\d+(\.\d+)?\s*[,)}]/);
    }
  });
});

describe('② 减少动效：CSS 之外的第二条通道（JS 滚动）', () => {
  it('档位 → 滚动行为：reduce 走 auto，full 走 smooth', () => {
    expect(scrollBehaviorForMotion(true)).toBe('auto');
    expect(scrollBehaviorForMotion(false)).toBe('smooth');
  });

  it('应用内 reduce 档 / 系统读数 任一成立即压缩；读数现取，切档当场生效', () => {
    expect(isMotionReduced()).toBe(false);
    expect(currentScrollBehavior()).toBe('smooth');
    // 档位 reduce：不等系统读数
    useThemeStore.getState().setMotion('reduce');
    expect(isMotionReduced()).toBe(true);
    expect(currentScrollBehavior()).toBe('auto');
    // 回到 auto 档 → 由系统读数决定
    useThemeStore.getState().setMotion('auto');
    useThemeStore.setState({ systemReducedMotion: true });
    expect(isMotionReduced()).toBe(true);
    expect(currentScrollBehavior()).toBe('auto');
  });

  it('滚动消费点一律现取档位，不留 smooth 字面量', () => {
    for (const rel of [
      'editor/panels/ProjectTree.tsx',
      'editor/panels/ScannedFilesPanel.tsx',
      'editor/panels/ReviewFindingsPanel.tsx',
      'editor/renderers/writingPanes.tsx',
      'pages/LibraryPage.tsx',
      'pages/AiAgentPage.tsx',
    ]) {
      const src = read(rel);
      expect(src.includes('currentScrollBehavior()'), `${rel} 的滚动必须读动效档位`).toBe(true);
      expect(src).not.toMatch(/behavior:\s*['"]smooth['"]/);
    }
  });

  it('无人读的 data-app-motion 属性不得回潮（reduce 的生效通道是 CssBaseline + JS 侧读数）', () => {
    const appTheme = read('theme/AppTheme.tsx');
    const scales = read('theme/appearanceScales.ts');
    expect(appTheme).not.toMatch(/setAttribute\(\s*'data-app-motion'/);
    expect(scales).not.toMatch(/export function motionDataAttribute/);
    // CssBaseline 那条注入仍在（它才是「全局压缩动效」的实现）
    expect(appTheme).toMatch(/REDUCED_MOTION_SELECTOR/);
    expect(appTheme).toMatch(/reducedMotion \? \{ \[REDUCED_MOTION_SELECTOR\]/);
  });
});

describe('③ 画布章节编辑器：正文排版与 --app-font-size-base 真的被静态 CSS 读', () => {
  const css = read('editor/renderers/canvasEntity.css');

  it('七项排版档位都有 var() 消费者', () => {
    for (const v of [
      '--ps-body-font-size',
      '--ps-body-line-height',
      '--ps-body-para-spacing',
      '--ps-body-font-family',
      '--ps-body-text-indent',
      '--ps-body-page-width',
      '--ps-body-paper',
    ]) {
      expect(css.includes(`var(${v}`), `canvasEntity.css 必须读 ${v}`).toBe(true);
    }
  });

  it('--app-font-size-base 不再是注入了没人读的死变量', () => {
    expect(css).toMatch(/var\(--app-font-size-base/);
  });

  it('组件侧经 useBodyTypographyCssVars 注入，且纸面卡与内嵌页签两处都注入', () => {
    const src = read('editor/renderers/WritingChapterEditor.tsx');
    expect(src).toMatch(/useBodyTypographyCssVars\(bookId \|\| null\)/);
    expect(src.match(/\.\.\.bodyTypographyVars/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src.match(/className="ps-workbench"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('画布标题层级与写作台 editorSx 同值（同一份正文两套渲染器不许两个比例）', () => {
    const editorSx = read('pages/writingPage/editorSx.ts');
    const h1 = /'& h1': \{ fontSize: '([\d.]+)rem'/.exec(editorSx)?.[1];
    const cssH1 = /\.ps-workbench \.ProseMirror h1 \{\s*font-size: ([\d.]+)rem/.exec(css)?.[1];
    expect(cssH1, '画布 h1 字号找不到').toBe(h1);
  });
});

describe('bodyTypographyCssVars：档位 → CSS 变量的换算口径', () => {
  it('字号/行高/页宽直取；段距按 MUI spacing 8px 换算，与写作台 my 同源', () => {
    const vars = bodyTypographyCssVars(
      { ...DEFAULT_TYPOGRAPHY, fontSize: 18, lineHeight: 2.2, pageWidth: 900, paraSpacing: 1.5 },
      false,
    );
    expect(vars['--ps-body-font-size']).toBe('18px');
    expect(vars['--ps-body-line-height']).toBe('2.2');
    expect(vars['--ps-body-page-width']).toBe('900px');
    expect(vars['--ps-body-para-spacing']).toBe('12px');
  });

  it('缩进关掉时注入 0px 而不是缺席（缺席会让浏览器留着上一档的缩进）', () => {
    expect(bodyTypographyCssVars({ ...DEFAULT_TYPOGRAPHY, indent: false }, false)['--ps-body-text-indent']).toBe('0px');
    expect(bodyTypographyCssVars({ ...DEFAULT_TYPOGRAPHY, indent: true }, false)['--ps-body-text-indent']).toBe('2em');
  });

  it('字族/纸色「跟随」档刻意缺席：不注入才谈得上 inherit / 跟随主题纸面', () => {
    const vars = bodyTypographyCssVars(DEFAULT_TYPOGRAPHY, false);
    expect(vars['--ps-body-font-family']).toBeUndefined();
    expect(vars['--ps-body-paper']).toBeUndefined();
    expect(resolveBodyFont('system', 'system')).toBe('');
  });

  it('纸色在明暗两档下是两套值（暗色不能给刺眼米黄）', () => {
    const typo: BookTypography = { ...DEFAULT_TYPOGRAPHY, paper: 'sepia' };
    const light = bodyTypographyCssVars(typo, false)['--ps-body-paper'];
    const dark = bodyTypographyCssVars(typo, true)['--ps-body-paper'];
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(light).not.toBe(dark);
  });
});
