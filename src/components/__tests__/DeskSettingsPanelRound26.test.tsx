// 写作台独立窗口的设置面板回归锁（2026-11-02，第二十六轮，落第 25 轮待办 2）
//
// 病灶：SettingsDrawer 只挂在主布局分支，写作台（desk=1）零设置入口，⌘, 也被刻意关掉 ——
// 「正写着想调保存节奏 / 打字机滚动」必须回主窗口。补的这个面板**不新建第二条持久化链路**，
// 写的就是主抽屉那批 store 的同一批 action，所以这里重点锁三件事：
//  ① 档位点得动、读数真的变、当场落进应用设置库（关窗口不丢）；
//  ② 主窗口与写作台读的是同一份 store → 另一边改了这边跟着变（不额外接线也不许脱钩）；
//  ③ 禅模式下不出现浮层，但 ⌘ 快捷键那条入口仍在。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import DeskSettingsPanel, { WritingDeskSettingsHost } from '../layout/DeskSettingsPanel';
import { useThemeStore } from '../../store/themeStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useWritingPrefsStore, DEFAULT_WRITING_PREFS, WRITING_PREFS_SETTINGS_KEY } from '../../store/writingPrefsStore';
import { useLanguageStore } from '../../store/languageStore';
import { useSettingsSyncStore } from '../../store/settingsSyncStore';
import { useSettingsPanelStore } from '../../store/settingsPanelStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { WRITING_TYPOGRAPHY_SETTINGS_KEY } from '../../store/typographyDefaultsStore';
import { setLang, t } from '../../i18n';

const { kv, failNextWrite } = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  failNextWrite: { on: false },
}));

vi.mock('../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (failNextWrite.on) throw new Error('写库失败（测试注入）');
      kv.set(key, value);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
  },
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

function renderPanel() {
  return render(
    <AppTheme>
      <DeskSettingsPanel open onClose={() => {}} />
    </AppTheme>,
  );
}

beforeEach(() => {
  cleanup();
  kv.clear();
  failNextWrite.on = false;
  setLang('zh-CN');
  useThemeStore.setState({
    config: { mode: 'light', preset: 'default', fontSize: 'medium', borderRadius: 'medium', motion: 'auto' },
    systemMode: 'light',
    systemReducedMotion: false,
  });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
  useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS }, initialized: true });
  useLanguageStore.setState({ lang: 'zh-CN', initialized: true });
  useSettingsSyncStore.getState().reset();
  useSettingsPanelStore.getState().setOpen(false);
});

describe('写作台设置面板 · 档位生效并落库', () => {
  it('面板里改「自动保存节奏」：读数当场变 + 落进设置库（重启仍是这一档）', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('desk-setting-steady'));
    expect(useWritingPrefsStore.getState().config.saveCadence).toBe('steady');
    await settle();
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY) ?? '{}').saveCadence).toBe('steady');
  });

  it('改「正文默认排版」的字号：写的是 writing_typography 键，与主抽屉同一个域', async () => {
    renderPanel();
    const slider = screen.getByRole('slider', { name: t('writing.typography.fontSize') });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await settle();
    const next = useTypographyDefaultsStore.getState().config.fontSize;
    expect(next).toBe(DEFAULT_TYPOGRAPHY.fontSize + 1);
    expect(JSON.parse(kv.get(WRITING_TYPOGRAPHY_SETTINGS_KEY) ?? '{}').fontSize).toBe(next);
  });

  it('改「颜色模式」即时生效，主窗口的 themeStore 是同一份读数（跨窗口靠既有广播，不另接线）', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('desk-setting-dark'));
    expect(useThemeStore.getState().config.mode).toBe('dark');
    await settle();
    expect(JSON.parse(kv.get('theme') ?? '{}').mode).toBe('dark');
  });

  it('写库失败时这边也看得见并可重放（第二十一轮在抽屉里修的口径不许在这边重演）', async () => {
    renderPanel();
    failNextWrite.on = true;
    fireEvent.click(screen.getByTestId('desk-setting-off'));
    // 可信层是「失败 → 等 500ms 自动重试一次 → 仍失败才判 failed」，等够一个重试窗口
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(useSettingsSyncStore.getState().status.writing).toBe('failed');
    expect(screen.getByTestId('desk-sync-status').textContent).toContain(t('settings.syncFailedNote'));
    // 重放：清掉故障后点「重试」，这次必须真落库
    failNextWrite.on = false;
    fireEvent.click(screen.getByTestId('desk-sync-retry'));
    await settle();
    expect(useSettingsSyncStore.getState().status.writing).toBe('saved');
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY) ?? '{}').typewriterScroll).toBe('off');
  });
});

describe('写作台设置入口（宿主）', () => {
  it('普通 / 专注态给入口按钮，点了即开面板', () => {
    render(
      <AppTheme>
        <WritingDeskSettingsHost />
      </AppTheme>,
    );
    fireEvent.click(screen.getByTestId('desk-settings-open'));
    expect(useSettingsPanelStore.getState().open).toBe(true);
  });

  // 断言口径变更（2026-11-03）：本条原锁「禅模式下浮层收起」，用户实测后否决了该设计
  // —— 独立窗口的齿轮是唯一可见出口，zen 下连它一起消失即为「界面没功能了」。
  // 新契约：档位不得抹掉任何功能入口。此处由「断言不存在」改为「断言在位且可用」。
  it('禅模式下设置入口仍在位且不静音，点了照样开面板', () => {
    act(() => useWritingPrefsStore.getState().setFocusMode('zen'));
    const { rerender } = render(
      <AppTheme>
        <WritingDeskSettingsHost />
      </AppTheme>,
    );
    expect(screen.getByTestId('desk-settings-open')).toBeTruthy();
    fireEvent.click(screen.getByTestId('desk-settings-open'));
    expect(useSettingsPanelStore.getState().open).toBe(true);
    useSettingsPanelStore.getState().setOpen(true);
    rerender(
      <AppTheme>
        <WritingDeskSettingsHost />
      </AppTheme>,
    );
    expect(screen.getByTestId('desk-settings-close')).toBeTruthy();
  });

  it('快捷键入口与主窗口共用同一个 store 动作（⌘ 在写作台同样能开合）', () => {
    render(
      <AppTheme>
        <WritingDeskSettingsHost />
      </AppTheme>,
    );
    // useSettingsShortcut 由 App 挂载，这里验的是它要动的那个读数是否同源
    expect(useSettingsPanelStore.getState().open).toBe(false);
    act(() => useSettingsPanelStore.getState().toggle());
    expect(screen.getByTestId('desk-settings-close')).toBeTruthy();
  });
});
