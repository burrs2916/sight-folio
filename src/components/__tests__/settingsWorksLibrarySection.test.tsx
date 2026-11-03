// 设置页「成品作品库」分区行为测试（完结作品重设计 · B3）。
//
// 钉死的契约（全部来自需求 §4 / D7）：
// 1. 读取走 workVersionApi.getLibraryRoot，路径与「默认/自定义」标记如实渲染；
// 2. 读取失败 → 界面如实展示错误，不得画出任何路径（禁止静默降级回「另存为」那类谎）；
// 3. 更改位置走目录选择器 → setLibraryRoot；成功才更新界面读数；
// 4. 更改失败 → 报错上屏，且界面保持旧路径 —— 后端失败不落库，前端也不许把没生效的路径画上界面；
// 5. 取消目录选择 → 不发 set；
// 6. i18n 双语键齐全、占位符一致（缺语言=界面漏字典）。
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const getRootImpl = vi.fn();
const setRootImpl = vi.fn();
const openDialogImpl = vi.fn();
const toast = { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() };

vi.mock('../../services/workVersion', () => ({
  workVersionApi: {
    getLibraryRoot: () => getRootImpl(),
    setLibraryRoot: (path: string) => setRootImpl(path),
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (options: unknown) => openDialogImpl(options),
}));
vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => toast },
}));
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import SettingsWorksLibrarySection from '../layout/SettingsWorksLibrarySection';

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const renderSection = async () => {
  render(<SettingsWorksLibrarySection />);
  await settle();
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsWorksLibrarySection', () => {
  it('读取成功：路径与默认标记如实渲染', async () => {
    getRootImpl.mockResolvedValue({ path: '/Users/x/Documents/SightFolio 作品库', isDefault: true });
    await renderSection();
    expect(getRootImpl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings-works-library-path').textContent).toBe('/Users/x/Documents/SightFolio 作品库');
    expect(screen.getByTestId('settings-works-library-tag').textContent).toBe('settings.worksLibraryDefaultTag');
  });

  it('自定义根显示自定义标记而不是默认标记', async () => {
    getRootImpl.mockResolvedValue({ path: '/Volumes/NAS/作品库', isDefault: false });
    await renderSection();
    expect(screen.getByTestId('settings-works-library-tag').textContent).toBe('settings.worksLibraryCustomTag');
  });

  it('读取失败：错误上屏且不画任何路径', async () => {
    getRootImpl.mockRejectedValue(new Error('无法创建作品库目录 /x：Permission denied'));
    await renderSection();
    const box = screen.getByTestId('settings-works-library-error');
    expect(box.textContent).toContain('无法创建作品库目录 /x：Permission denied');
    expect(screen.queryByTestId('settings-works-library-path')).toBeNull();
  });

  it('更改位置：目录选择器 → set 成功后界面更新并提示', async () => {
    getRootImpl.mockResolvedValue({ path: '/old/root', isDefault: true });
    openDialogImpl.mockResolvedValue('/new/root');
    setRootImpl.mockResolvedValue({ path: '/new/root', isDefault: false });
    await renderSection();

    fireEvent.click(screen.getByTestId('settings-works-library-change'));
    await settle();

    expect(openDialogImpl).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(setRootImpl).toHaveBeenCalledWith('/new/root');
    expect(screen.getByTestId('settings-works-library-path').textContent).toBe('/new/root');
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('/new/root'));
  });

  it('更改失败：报错且界面保持旧路径（没生效的路径不上屏）', async () => {
    getRootImpl.mockResolvedValue({ path: '/old/root', isDefault: false });
    openDialogImpl.mockResolvedValue('/broken/root');
    setRootImpl.mockRejectedValue(new Error('无法创建作品库目录 /broken/root：Read-only'));
    await renderSection();

    fireEvent.click(screen.getByTestId('settings-works-library-change'));
    await settle();

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Read-only'));
    expect(screen.getByTestId('settings-works-library-path').textContent).toBe('/old/root');
  });

  it('取消目录选择不发 set', async () => {
    getRootImpl.mockResolvedValue({ path: '/old/root', isDefault: true });
    openDialogImpl.mockResolvedValue(null);
    await renderSection();

    fireEvent.click(screen.getByTestId('settings-works-library-change'));
    await settle();

    expect(setRootImpl).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-works-library-path').textContent).toBe('/old/root');
  });

  it('重新读取按钮再走一次 get', async () => {
    getRootImpl.mockResolvedValue({ path: '/a', isDefault: true });
    await renderSection();
    fireEvent.click(screen.getByTestId('settings-works-library-reload'));
    await settle();
    expect(getRootImpl).toHaveBeenCalledTimes(2);
  });
});

describe('作品库分区的结构锁与 i18n 双语', () => {
  it('章节索引里有 worksLibrary（搜索能定位到它）', async () => {
    const { getSectionIndex } = await import('../layout/settingsOptions');
    expect(getSectionIndex().some((s) => s.id === 'worksLibrary')).toBe(true);
  });

  it('zh/en 双语键齐全且占位符一致', async () => {
    const root = process.cwd();
    const zh = JSON.parse(readFileSync(`${root}/src/i18n/zh-CN.json`, 'utf-8')) as Record<string, Record<string, string>>;
    const en = JSON.parse(readFileSync(`${root}/src/i18n/en-US.json`, 'utf-8')) as Record<string, Record<string, string>>;
    const keys = [
      'worksLibrary', 'worksLibraryHint', 'worksLibraryCurrent', 'worksLibraryDefaultTag',
      'worksLibraryCustomTag', 'worksLibraryChange', 'worksLibraryReload', 'worksLibraryLoading',
      'worksLibraryChanged', 'worksLibraryChangeFailed', 'worksLibraryLoadFailed',
    ];
    for (const key of keys) {
      expect(zh.settings?.[key], `zh 缺 settings.${key}`).toBeTruthy();
      expect(en.settings?.[key], `en 缺 settings.${key}`).toBeTruthy();
      const zhPh = (zh.settings[key].match(/\{\w+\}/g) ?? []).sort().join(',');
      const enPh = (en.settings[key].match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(enPh, `settings.${key} 双语占位符不一致`).toBe(zhPh);
    }
  });
});
