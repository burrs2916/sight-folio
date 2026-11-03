// 圆角档位生效链路锁（第三十一轮，待办 1「一刀三处」的第 ③ 件 + 实测取证）
//
// 背景（两轮审计在这里打过对台，全部以本文件的渲染实测为准）：
//  · 第 29 轮台账口径「非 MUI 区用 var(--template-shape-borderRadius)」——16:54 审计判其
//    「不存在」（依据：源码 grep 0 命中 + createTheme({cssVariables:true}) 得到 --mui- 前缀）。
//  · 本轮用本仓**真实配置**（AppTheme 的 cssVariables.cssVarPrefix = 'template'）渲染取证：
//    那条变量确实由 CssBaseline 注入到 :root 且随档位变 —— 审计的实验做在默认前缀上，
//    而变量名是运行时按前缀拼接的，源码 grep 不到属正常，两个判据都命不中它。
//  · 判归判，通道照建：MUI 那条姓 MUI（前缀改配 / CssBaseline 撤挂即全体断供），
//    本仓非 MUI 渲染区统一改走自己的 --app-radius-base（AppTheme 逐项 setProperty 落
//    documentElement 内联样式）。
//
// 本文件锁四件事，缺一即红：
//  ① AppTheme 把 --app-radius-base 按档位写进 :root，**档位切换就地更新**
//     （这一条同时锁 effect 依赖数组必须含 borderRadius —— 少一项就是「切了圆角档变量不动」）；
//  ② MUI 的 --template-shape-borderRadius 在本仓配置下真实存在且随档位 —— 把上面那段
//     审计争议以可证伪的方式钉死，后人再按「它不存在」立论批量替换时会先撞红本锁；
//  ③ 设置抽屉的原生 color 色卡读 --app-radius-base，不再引用 MUI 前缀变量（扫描锁）；
//  ④ 例外清单如实登记：画布区圆角（canvasTheme CV_RADIUS / canvasEntity.css）是**设计决策**
//     不跟随档位（第 30 轮红线，动它先问李先生）。
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import CssBaseline from '@mui/material/CssBaseline';
import AppTheme from '../AppTheme';
import { BORDER_RADIUS_BASE } from '../appearanceScales';
import type { ThemeConfig } from '../../store/themeStore';
import { readFileSync } from 'node:fs';

function cfg(borderRadius: ThemeConfig['borderRadius'], borderRadiusCustom?: number): ThemeConfig {
  return { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius, borderRadiusCustom };
}

/** 文档里全部注入样式（Emotion style 标签）拼成一个串 */
function injectedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

describe('圆角档位 → CSS 变量通道（第三十一轮收口）', () => {
  afterEach(() => {
    // AppTheme 的 effect 直接写 documentElement 内联样式，不清理会跨用例残留
    document.documentElement.style.removeProperty('--app-radius-base');
    document.documentElement.style.removeProperty('--app-font-scale');
    document.documentElement.style.removeProperty('--app-font-size-base');
  });

  it('① 档位写进 :root 内联样式，且切档后就地更新（锁 effect 依赖含 borderRadius）', () => {
    const { rerender } = render(
      <AppTheme config={cfg('custom', 12)}>
        <CssBaseline />
      </AppTheme>,
    );
    expect(document.documentElement.style.getPropertyValue('--app-radius-base')).toBe('12px');

    // 2026-11-03 档位改版：自定义数值改值（不换档位）也必须就地更新 —— 锁 effect 依赖含 borderRadiusCustom
    rerender(
      <AppTheme config={cfg('custom', 20)}>
        <CssBaseline />
      </AppTheme>,
    );
    expect(document.documentElement.style.getPropertyValue('--app-radius-base')).toBe('20px');

    rerender(
      <AppTheme config={cfg('small')}>
        <CssBaseline />
      </AppTheme>,
    );
    expect(document.documentElement.style.getPropertyValue('--app-radius-base')).toBe(`${BORDER_RADIUS_BASE.small}px`);

    rerender(
      <AppTheme config={cfg('none')}>
        <CssBaseline />
      </AppTheme>,
    );
    expect(document.documentElement.style.getPropertyValue('--app-radius-base')).toBe('0px');
  });

  it('② MUI --template-shape-borderRadius 在本仓前缀配置下真实注入且随档位（钉死审计争议）', () => {
    const { rerender } = render(
      <AppTheme config={cfg('medium')}>
        <CssBaseline enableColorScheme />
      </AppTheme>,
    );
    expect(injectedCss()).toContain(`--template-shape-borderRadius:${BORDER_RADIUS_BASE.medium}px`);
    rerender(
      <AppTheme config={cfg('custom', 20)}>
        <CssBaseline enableColorScheme />
      </AppTheme>,
    );
    expect(injectedCss()).toContain('--template-shape-borderRadius:20px');
  });

  it('③ 设置抽屉原生 color 色卡走本仓通道，MUI 前缀变量不得再出现在抽屉里（扫描锁）', () => {
    const drawer = readFileSync(`${process.cwd()}/src/components/layout/SettingsDrawer.tsx`, 'utf8');
    expect(drawer).toContain('var(--app-radius-base');
    expect(drawer).not.toContain('--template-shape-borderRadius');
  });

  it('④ 画布区不跟随档位是登记过的设计决策，不是漏网（改动须留痕）', () => {
    const canvasTheme = readFileSync(`${process.cwd()}/src/editor/renderers/canvasTheme.ts`, 'utf8');
    // 常量 + 「不跟随全局」注记必须同框出现：有人悄悄把画布拉回档位而没走拍板流程，这里先撞红
    expect(canvasTheme).toMatch(/CV_RADIUS\s*=\s*['"]10px['"]/);
    expect(canvasTheme).toMatch(/不再跟随全局圆角设置/);
  });
});
