// 设置抽屉界面层回归锁（2026-11-02，第二十轮）
//
// 本轮四条「看得见」的保证，全部从界面点进去、从 store 与设置库读出来：
//  ① 段首缩进开关：此前只有 checked 没有 onChange，是抽屉里最后一个死控件；
//  ② 侧栏折叠开关：折叠态下宽度滑杆一直灰着，抽屉里此前没有任何地方能解开；
//  ③ 自定义预设改名（内置不可改）+ 另存为预设的自动命名走 i18n；
//  ④ 底部那句「自动保存」跟着真实落盘状态走：写入中 / 已保存到几点 / 失败 + 重试。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useLanguageStore } from '../../store/languageStore';
import { useSettingsSyncStore } from '../../store/settingsSyncStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { setLang, t } from '../../i18n';

const { kv, failWrite } = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  failWrite: { current: false },
}));

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      // 模拟写库失败：抛错后由 settingsSyncStore 负责重试与状态记录
      if (failWrite.current) throw new Error('settings store unavailable');
      kv.set(key, value);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
  },
}));

function renderDrawer() {
  return render(
    <AppTheme>
      <SettingsDrawer open onClose={() => {}} />
    </AppTheme>,
  );
}

/** 展开指定标题的折叠章节（正文排版章节默认收起） */
function expandSection(title: string) {
  const label = screen.getByText(title);
  const summary = label.closest('button') ?? label.parentElement;
  fireEvent.click(summary as Element);
}

/** 等 fire-and-forget 写入链跑完（含失败后 500ms 自动重试间隔） */
const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

beforeEach(() => {
  cleanup();
  kv.clear();
  setLang('zh-CN');
  failWrite.current = false;
  // 只铺内存读数，不调 resetXxx()：那些 action 会写盘，会把「落盘状态」测试的起点污染成 saved
  useThemeStore.setState({
    config: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    systemMode: 'light',
    initialized: true,
  });
  useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT_CONFIG }, initialized: true });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
  useLanguageStore.setState({ lang: 'zh-CN', initialized: true });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
  useSettingsSyncStore.getState().reset();
});

describe('设置抽屉 · 段首缩进开关', () => {
  it('点一下真的会翻，并且写进设置库（此前是无 onChange 的死控件）', async () => {
    renderDrawer();
    expandSection(t('settings.bodyTypography'));

    // MUI v9 的 Switch 输入框是 role="switch"（不是 checkbox），这里按真实可访问性角色取
    const input = screen.getByRole('switch', { name: new RegExp(t('writing.typography.indent')) }) as HTMLInputElement;
    expect(input.checked).toBe(false);

    fireEvent.click(input);

    expect(useTypographyDefaultsStore.getState().config.indent).toBe(true);
    expect(
      (screen.getByRole('switch', { name: new RegExp(t('writing.typography.indent')) }) as HTMLInputElement).checked,
    ).toBe(true);
    await settle();
    expect(JSON.parse(kv.get('writing_typography') as string).indent).toBe(true);
  });
});

describe('设置抽屉 · 侧栏折叠开关', () => {
  it('抽屉里就能折叠/展开侧栏，折叠时宽度滑杆禁用并有说明', () => {
    renderDrawer();

    const input = screen.getByRole('switch', { name: new RegExp(t('settings.sidebarCollapse')) }) as HTMLInputElement;
    fireEvent.click(input);

    expect(useLayoutStore.getState().config.sidebarCollapsed).toBe(true);
    expect(screen.getByText(new RegExp(t('settings.sidebarWidthCollapsedHint')))).toBeTruthy();
    const thumb = screen.getByRole('slider', { name: t('settings.sidebarWidth') });
    // MUI v9 的禁用类名收敛到通用的 Mui-disabled
    expect((thumb.closest('.MuiSlider-root') as HTMLElement).className).toContain('Mui-disabled');

    // 再点一次展开：滑杆恢复可用（这一章在抽屉内自洽，不必去抽屉外找按钮）
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(t('settings.sidebarCollapse')) }));
    expect(useLayoutStore.getState().config.sidebarCollapsed).toBe(false);
    expect(
      (screen.getByRole('slider', { name: t('settings.sidebarWidth') }).closest('.MuiSlider-root') as HTMLElement).className,
    ).not.toContain('Mui-disabled');
    // 折叠提示随之消失
    expect(screen.queryByText(new RegExp(t('settings.sidebarWidthCollapsedHint')))).toBeNull();
  });
});

describe('设置抽屉 · 预设改名', () => {
  it('自定义预设可改名，改完即写进设置库', async () => {
    const id = useAppearanceStore.getState().saveCurrentAsProfile('我的稿纸');
    renderDrawer();
    expandSection(t('settings.appearancePreset'));

    fireEvent.click(screen.getByTestId(`appearance-rename-btn-${id}`));
    const input = (screen.getByTestId(`appearance-rename-${id}`).querySelector('input') as HTMLInputElement)!;
    expect(input.value).toBe('我的稿纸');

    fireEvent.change(input, { target: { value: '深夜长稿' } });
    fireEvent.click(screen.getByTestId(`appearance-rename-commit-${id}`));

    expect(useAppearanceStore.getState().getProfile(id)?.name).toBe('深夜长稿');
    await settle();
    expect(JSON.parse(kv.get('appearance_profiles') as string).profiles[0].name).toBe('深夜长稿');
  });

  it('内置预设不给改名入口（它的名字是 i18n key，改了翻译就断）', () => {
    renderDrawer();
    expandSection(t('settings.appearancePreset'));

    expect(screen.queryByTestId('appearance-rename-btn-office')).toBeNull();
    expect(screen.queryByTestId('appearance-delete-office')).toBeNull();
  });

  it('留空自动命名走当前语言：中文「外观方案 1」，英文「Appearance 1」', () => {
    const zhId = useAppearanceStore.getState().saveCurrentAsProfile();
    expect(useAppearanceStore.getState().getProfile(zhId)?.name).toBe('外观方案 1');

    setLang('en-US');
    const enId = useAppearanceStore.getState().saveCurrentAsProfile();
    expect(useAppearanceStore.getState().getProfile(enId)?.name).toBe('Appearance 2');
    setLang('zh-CN');
  });
});

describe('设置抽屉 · 底部落盘状态', () => {
  it('写入过程与结果都对得上：先「正在写入」，落库成功后带出可对账的时间', async () => {
    renderDrawer();
    // 打开抽屉这件事本身就会反查预设并落一次盘 —— 那句提示必须跟着真实状态走，
    // 不能永远是静止的「自动保存」字样
    expect(screen.getByTestId('settings-sync-status').textContent).toContain(t('settings.syncPendingNote'));

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('settings.modeDark')) }));
    await settle();

    expect(useSettingsSyncStore.getState().status.theme).toBe('saved');
    const note = screen.getByTestId('settings-sync-status').textContent ?? '';
    expect(note).toContain('已自动保存');
    // 时间真的渲染出来了（不是空串把 {time} 占位符吃掉）
    expect(note).toMatch(/\d{1,2}:\d{2}/);
  });

  it('本次启动没写过任何设置时，说明的是「即时生效、无需手动保存」', () => {
    renderDrawer();
    // 反查预设的写入已跑完，此时把读数清成初始态，等价于「刚打开面板、还没动过任何设置」
    act(() => useSettingsSyncStore.getState().reset());

    expect(screen.getByTestId('settings-sync-status').textContent).toContain(t('settings.autoSaveNote'));
  });

  it('写库失败时不再谎称已保存，而是给失败说明 + 重试出口', async () => {
    failWrite.current = true;
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('settings.modeDark')) }));
    await settle();

    expect(screen.getByTestId('settings-sync-status').textContent).toContain(t('settings.syncFailedNote'));
    const retry = screen.getByTestId('settings-sync-retry');

    failWrite.current = false;
    fireEvent.click(retry);
    await settle();

    expect(screen.getByTestId('settings-sync-status').textContent).toContain('已自动保存');
    expect(kv.get('theme')).toBeTruthy();
  });
});
