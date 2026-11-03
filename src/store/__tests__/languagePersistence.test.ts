// 界面语言持久化回归锁（2026-11-02，第十九轮）
//
// 病灶：语言此前只写浏览器 localStorage，与主题 / 布局 / 正文排版不是同一套持久化口径。
// 独立窗口（写作台 / 代码工作台）不一定共享同一份 localStorage，主窗口切成英文另一边可能
// 还是中文；设置抽屉里也没有语言入口，用户只能靠顶栏一个盲切按钮。现在语言以应用设置库
// 为准（键 'language'），旧的 localStorage 值一次性迁移进来。
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { useLanguageStore, LANGUAGE_SETTINGS_KEY } from '../languageStore';
import { getLang, setLang } from '../../i18n';

const LEGACY_KEY = 'project-sight-locale';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  kv.clear();
  localStorage.clear();
  localStorage.setItem(LEGACY_KEY, 'zh-CN');
  setLang('zh-CN');
  useLanguageStore.setState({ lang: 'zh-CN', initialized: false });
});

describe('界面语言 · 写设置库并重开读回', () => {
  it('改语言即写设置库，并同步 i18n 读数（界面文案当场跟着变）', async () => {
    useLanguageStore.getState().setLanguage('en-US');
    await flush();

    expect(kv.get(LANGUAGE_SETTINGS_KEY)).toBe('en-US');
    expect(getLang()).toBe('en-US');
    expect(useLanguageStore.getState().lang).toBe('en-US');
  });

  it('模拟重开：内存态清空后 init 读回上次选的语言', async () => {
    useLanguageStore.getState().setLanguage('en-US');
    await flush();

    useLanguageStore.setState({ lang: 'zh-CN', initialized: false });
    setLang('zh-CN');
    await useLanguageStore.getState().init();

    expect(useLanguageStore.getState().lang).toBe('en-US');
    expect(getLang()).toBe('en-US');
    expect(useLanguageStore.getState().initialized).toBe(true);
  });

  it('设置库为空时迁移旧 localStorage 值，迁移后清理旧键并落库', async () => {
    localStorage.setItem(LEGACY_KEY, 'en-US');

    await useLanguageStore.getState().init();
    await flush();

    expect(useLanguageStore.getState().lang).toBe('en-US');
    expect(kv.get(LANGUAGE_SETTINGS_KEY)).toBe('en-US');
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('设置库里的脏语言值一律不采信，回落到 i18n 推导值', async () => {
    kv.set(LANGUAGE_SETTINGS_KEY, 'klingon');

    await useLanguageStore.getState().init();

    expect(useLanguageStore.getState().lang).toBe('zh-CN');
    expect(getLang()).toBe('zh-CN');
  });

  it('顶栏按钮与抽屉同源：toggleLanguage 改的是同一份读数', async () => {
    useLanguageStore.getState().toggleLanguage();
    await flush();
    expect(useLanguageStore.getState().lang).toBe('en-US');

    // 直接调 i18n（历史调用方 / 单测）也要把 store 镜像带回正确值，不能出现两处高亮不一致
    setLang('zh-CN');
    expect(useLanguageStore.getState().lang).toBe('zh-CN');
  });

  it('跨窗口 hydrate 只改内存，绝不回写设置库（回声不该再落一次盘）', async () => {
    await useLanguageStore.getState().init();
    kv.clear();

    useLanguageStore.getState().hydrate('en-US');
    await flush();

    expect(useLanguageStore.getState().lang).toBe('en-US');
    expect(getLang()).toBe('en-US');
    expect(kv.has(LANGUAGE_SETTINGS_KEY)).toBe(false);
  });

  it('hydrate 收到脏值 / 同值时不动状态', () => {
    useLanguageStore.getState().hydrate('klingon');
    expect(useLanguageStore.getState().lang).toBe('zh-CN');

    useLanguageStore.getState().hydrate('zh-CN');
    expect(useLanguageStore.getState().lang).toBe('zh-CN');
  });
});
