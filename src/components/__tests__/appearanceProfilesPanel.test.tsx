// 外观预设面板渲染锁（2026-11-02）
//
// 界面层的两条可见要求：
//  ① 卡片上直接带配色预览 —— 底色方块 + 主色圆点，取值与 preset 注册表同源，
//     让创作者「看卡片颜色就能判断这套预设是什么色」，不用先套上去试；
//  ② 外观预设章节默认收起 —— 12 张卡片全展开会把设置抽屉撑得很长，需要时再点开。
// 同时锁住「预设 → 卡片 → 点击生效」这条链路不被两边改动破坏。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore } from '../../store/layoutStore';
import { resolvePreset } from '../../theme/themePresets';
import { setLang } from '../../i18n';

const ZH_NAMES = [
  '标准办公',
  '大屏监控',
  '编辑模式',
  '夜间模式',
  '素笺淡墨',
  '暖光阅读',
  '林间清绿',
  '海蓝工坊',
  '紫韵创作',
  '午夜靛蓝',
  '石墨极简',
  '随光自动',
];

const EN_NAMES = [
  'Standard Office',
  'Big Screen Monitor',
  'Edit Mode',
  'Night Mode',
  'Ivory Paper',
  'Warm Reading',
  'Forest Green',
  'Ocean Workshop',
  'Violet Studio',
  'Midnight Indigo',
  'Graphite Minimal',
  'Follow System',
];

function renderDrawer() {
  return render(
    <AppTheme>
      <SettingsDrawer open onClose={() => {}} />
    </AppTheme>,
  );
}

/** 外观预设章节的标题行（用 data-testid 定位，不依赖类名／样式，也不受语言影响） */
function appearanceSummary(): HTMLElement {
  return screen.getByTestId('appearance-preset-summary');
}

/** 展开外观预设章节（默认收起，先断言收起再点开，顺带覆盖折叠行为） */
function expandAppearanceSection() {
  const summary = appearanceSummary();
  expect(summary.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(summary);
  expect(summary.getAttribute('aria-expanded')).toBe('true');
}

beforeEach(() => {
  cleanup();
  useThemeStore.getState().resetConfig();
  useLayoutStore.getState().resetLayout();
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
});

describe('外观预设面板 · 默认收起', () => {
  it('打开抽屉时外观预设章节是收起的，点击标题可展开／再收起', () => {
    setLang('zh-CN');
    renderDrawer();
    const summary = appearanceSummary();
    expect(summary.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('外观预设面板 · 卡片配色预览', () => {
  it('每套预设都有配色方块，取值与 preset 注册表同源（可据此判断主题色）', () => {
    setLang('zh-CN');
    renderDrawer();
    expandAppearanceSection();

    for (const profile of BUILT_IN_PROFILES) {
      const def = resolvePreset(profile.theme.preset, profile.theme.customPrimary);
      // dark 预设展示深色层，light 预设展示浅色层（system 预览两层，见下一条）
      const mode = profile.theme.mode === 'dark' ? 'dark' : 'light';
      const swatch = screen.getByTestId(`appearance-swatch-${profile.id}-${mode}`);
      expect(swatch.dataset.primary, `${profile.id} 色卡主色与注册表不一致`).toBe(def[mode].primary.main);
      expect(swatch.dataset.background, `${profile.id} 色卡底色与注册表不一致`).toBe(def[mode].background.default);

      // 颜色确实被画上去（内联样式非空），而不只是挂在 data 属性上
      const dot = screen.getByTestId(`appearance-swatch-dot-${profile.id}-${mode}`);
      expect(dot.style.background || dot.style.backgroundColor, `${profile.id} 主色圆点未上色`).toBeTruthy();
    }
  });

  it('system 预设同时给出浅色与深色两层预览，其余预设各一层', () => {
    setLang('zh-CN');
    renderDrawer();
    expandAppearanceSection();

    const blueDef = resolvePreset('blue');
    const light = screen.getByTestId('appearance-swatch-system-light');
    const dark = screen.getByTestId('appearance-swatch-system-dark');
    expect(light.dataset.primary).toBe(blueDef.light.primary.main);
    expect(dark.dataset.primary).toBe(blueDef.dark.primary.main);

    for (const profile of BUILT_IN_PROFILES.filter((p) => p.theme.mode !== 'system')) {
      const shown = profile.theme.mode === 'dark' ? 'dark' : 'light';
      expect(screen.getByTestId(`appearance-swatch-${profile.id}-${shown}`)).toBeTruthy();
      if (profile.theme.mode === 'dark') {
        expect(screen.queryByTestId(`appearance-swatch-${profile.id}-light`)).toBeNull();
      } else {
        expect(screen.queryByTestId(`appearance-swatch-${profile.id}-dark`)).toBeNull();
      }
    }
  });
});

describe('外观预设面板 · 名称与应用', () => {
  it('中文环境下渲染出全部 12 套预设名称（无裸 key）', () => {
    setLang('zh-CN');
    renderDrawer();
    expandAppearanceSection();
    for (const name of ZH_NAMES) {
      expect(screen.getByText(name), `缺少预设卡片：${name}`).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/appearance\.profile\./);
  });

  it('英文环境下同一批卡片切换为英文名称', () => {
    setLang('en-US');
    renderDrawer();
    expandAppearanceSection();
    for (const name of EN_NAMES) {
      expect(screen.getByText(name), `缺少预设卡片：${name}`).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/appearance\.profile\./);
  });

  it('点击卡片真正应用该预设（声明的维度落地，未声明的维度不被越权改掉）', () => {
    // 先把两个「内置预设一律不声明」的维度调到非默认值：
    // 应用预设后它们必须原样保留 —— 点一张预设卡不该顺手改掉创作者的动效习惯与限宽偏好。
    useThemeStore.getState().setMotion('reduce');
    useLayoutStore.getState().setContentWidth('wide');
    setLang('zh-CN');
    renderDrawer();
    expandAppearanceSection();

    fireEvent.click(screen.getByText('紫韵创作'));

    const violet = BUILT_IN_PROFILES.find((p) => p.id === 'violet')!;
    expect(useAppearanceStore.getState().activeProfileId).toBe('violet');

    // 逐项断言而不是整对象 toEqual：预设每新增一个可选维度（motion / contentWidth / typography），
    // 整对象比较就会把「本套预设本来不管的这一维」误报成「应用失败」。锁的是声明过的字段。
    const theme = useThemeStore.getState().config;
    expect(theme.mode).toBe(violet.theme.mode);
    expect(theme.preset).toBe(violet.theme.preset);
    expect(theme.fontSize).toBe(violet.theme.fontSize);
    expect(theme.borderRadius).toBe(violet.theme.borderRadius);
    expect(theme.motion).toBe('reduce');

    const layout = useLayoutStore.getState().config;
    for (const key of ['preset', 'sidebarCollapsed', 'sidebarWidth', 'sidebarPosition', 'contentPadding', 'navbarStyle'] as const) {
      expect(layout[key], `布局字段 ${key} 未按预设落地`).toBe(violet.layout[key]);
    }
    expect(layout.contentWidth).toBe('wide');
  });
});
