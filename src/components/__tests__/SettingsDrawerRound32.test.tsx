// 第三十二轮 · 「书级排版」看得见是哪几本 + 收回粒度可细到一本书
//
// 收的是第 31 轮待办 7 的两条遗留（第 30 轮明文「明确不做 ≠ 漏做」，本轮两条一起收）：
//  ① 抽屉只报「N 本书单独调过」，不报**是哪几本** —— 作者认不出对象，就没法判断那本书的
//     排版是不是自己有意调过的，这个读数等于没报告；
//  ② 唯一的收回出口是「全部收回」，想只让一本书回到跟随默认，只能去写作台一本本手动改回去。
//
// 这一域的底色仍是用户那句原话：设置要**看得见、改得动、关软件重启还在**。
// 所以每一例都验到「落进设置库」那一层，而不是只验界面抹干净了。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AppTheme from '../../theme/AppTheme';
import SettingsDrawer from '../layout/SettingsDrawer';
import { TypographyPopover } from '../../pages/writingPage/TypographyPopover';
import { BUILT_IN_PROFILES, useAppearanceStore } from '../../store/appearanceStore';
import { useThemeStore } from '../../store/themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../../store/layoutStore';
import { useTypographyDefaultsStore } from '../../store/typographyDefaultsStore';
import { useWritingPrefsStore, DEFAULT_WRITING_PREFS } from '../../store/writingPrefsStore';
import { useLanguageStore } from '../../store/languageStore';
import { useSettingsSyncStore } from '../../store/settingsSyncStore';
import { useSettingsHealthStore } from '../../store/settingsHealthStore';
import { useBookTypographyStore, BOOK_TYPOGRAPHY_SETTINGS_KEY } from '../../store/bookTypographyStore';
import { useWritingStore } from '../../store/writingStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import { setLang } from '../../i18n';
import zhCN from '../../i18n/zh-CN.json';
import enUS from '../../i18n/en-US.json';

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function renderDrawer() {
  return render(
    <AppTheme>
      <SettingsDrawer open onClose={() => {}} />
    </AppTheme>,
  );
}

/** 只填 books 这一格：抽屉要用书名反查 bookId（第 32 轮待办 7①） */
function seedBooks() {
  useWritingStore.setState({
    books: [
      { id: 'book-a', title: '山海拾遗' },
      { id: 'book-b', title: '长夜唱片' },
    ] as never,
  });
}

beforeEach(() => {
  cleanup();
  kv.clear();
  setLang('zh-CN');
  useThemeStore.setState({
    config: {
      mode: 'system',
      preset: 'default',
      fontSize: 'medium',
      borderRadius: 'medium',
      motion: 'auto',
      uiFont: 'system',
    },
    systemMode: 'light',
    systemReducedMotion: false,
    initialized: true,
  });
  useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT_CONFIG }, initialized: true });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
  useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS }, initialized: true });
  useLanguageStore.setState({ lang: 'zh-CN', initialized: true });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
  });
  useSettingsSyncStore.getState().reset();
  useSettingsHealthStore.getState().reset();
  useBookTypographyStore.getState().reset();
  useWritingStore.setState({ books: [] as never });
});

describe('抽屉 · 逐本点名（待办 7①）', () => {
  it('报出书名，而不是只报一个数字', () => {
    seedBooks();
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20, lineHeight: 2.2 } });
    renderDrawer();
    const list = screen.getByTestId('settings-book-typography-list');
    expect(list.textContent).toContain('山海拾遗');
    // 「单独设了 2 项」——让作者知道按下去会冲掉几项
    expect(list.textContent).toContain('2');
  });

  it('覆盖表里残留已删除作品的 id 时如实标出，并仍然可以收回（不静默藏掉）', () => {
    seedBooks();
    useBookTypographyStore.getState().hydrate({ 'book-ghost': { paper: 'sepia' } });
    renderDrawer();
    expect(screen.getByTestId('settings-book-typography-list').textContent).toContain('已删除的作品');
  });

  it('「跟随默认」只冲掉点名的那一本，另一本单独调过的排版原样留着（待办 7② 的粒度）', async () => {
    seedBooks();
    useBookTypographyStore.getState().hydrate({
      'book-a': { fontSize: 20 },
      'book-b': { lineHeight: 2.2 },
    });
    renderDrawer();
    fireEvent.click(screen.getByTestId('settings-book-typography-clear-one-book-a'));
    await settle();
    const left = useBookTypographyStore.getState().overrides;
    expect(left['book-a']).toBeUndefined();
    expect(left['book-b']).toEqual({ lineHeight: 2.2 });
    // 且真的落库（只把界面抹干净一档不算生效）
    expect(JSON.stringify(JSON.parse(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!).overrides)).not.toContain('book-a');
    expect(JSON.stringify(JSON.parse(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!).overrides)).toContain('book-b');
  });

  it('没有书单独调过时不画那一列（空态不占位）', () => {
    seedBooks();
    renderDrawer();
    expect(screen.queryByTestId('settings-book-typography-list')).toBeNull();
  });
});

describe('store · 收回粒度可细到单个字段（待办 7②）', () => {
  it('只摘掉点名的字段，其余单独调过的项保留', () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20, lineHeight: 2.2, indent: true } });
    useBookTypographyStore.getState().clearBookTypographyFields('book-a', ['fontSize']);
    expect(useBookTypographyStore.getState().overrides['book-a']).toEqual({ lineHeight: 2.2, indent: true });
  });

  it('收回最后一项时整条删除，不留空对象（否则「N 本书单独调过」会虚高）', async () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20 } });
    useBookTypographyStore.getState().clearBookTypographyFields('book-a', ['fontSize']);
    expect(useBookTypographyStore.getState().overrides).toEqual({});
    await settle();
    expect(JSON.parse(kv.get(BOOK_TYPOGRAPHY_SETTINGS_KEY)!)).toMatchObject({ version: 1, overrides: {} });
  });

  it('书不存在 / 字段名不在这本书上时不动盘（避免一次无意义的写入与广播）', () => {
    useBookTypographyStore.getState().hydrate({ 'book-a': { fontSize: 20 } });
    useBookTypographyStore.getState().clearBookTypographyFields('book-ghost', ['fontSize']);
    useBookTypographyStore.getState().clearBookTypographyFields('book-a', []);
    // 没写盘 = 该 scope 仍停在第 30 轮补的 idle 基线格，且设置库里根本没长出这个键
    expect(useSettingsSyncStore.getState().status.typographyBooks).toBe('idle');
    expect(kv.has(BOOK_TYPOGRAPHY_SETTINGS_KEY)).toBe(false);
  });
});

describe('写作台排版面板 · 字段级「跟随默认」（store 有 action 还必须有出口）', () => {
  const anchor = document.createElement('button');

  const renderPanel = (overriddenFields: (keyof typeof DEFAULT_TYPOGRAPHY)[], onFollow = vi.fn()) => {
    render(
      <AppTheme>
        <TypographyPopover
          anchorEl={anchor}
          onClose={() => {}}
          typo={{ ...DEFAULT_TYPOGRAPHY }}
          onChange={() => {}}
          canOverride
          overriddenFields={overriddenFields}
          onFollowDefaultField={onFollow}
        />
      </AppTheme>,
    );
    return onFollow;
  };

  it('只给「这本书真的调过」的那几项画出口，没调过的字段不出现死按钮', () => {
    renderPanel(['fontSize']);
    expect(screen.getByTestId('typography-follow-default-fontSize')).toBeTruthy();
    expect(screen.queryByTestId('typography-follow-default-lineHeight')).toBeNull();
  });

  it('点某一项的出口，只把这一项交回去（字段名如实带出去）', () => {
    const onFollow = renderPanel(['fontSize', 'lineHeight']);
    fireEvent.click(screen.getByTestId('typography-follow-default-fontSize'));
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow).toHaveBeenCalledWith('fontSize');
  });
});

describe('新增文案双包齐（本仓铁律：只补一门 = 另一门界面出现裸 key）', () => {
  const KEYS = [
    'bookTypographyBookFields',
    'bookTypographyBookUnknown',
    'bookTypographyClearOne',
    'bookTypographyClearedOne',
  ];
  it.each(KEYS)('settings.%s 在 zh-CN / en-US 两包都在位', (key: string) => {
    // 整包不是 Record<string,string>（个别节点下面还有第三层），所以只按 settings 这一格取
    const zh = (zhCN as unknown as { settings: Record<string, string> }).settings;
    const en = (enUS as unknown as { settings: Record<string, string> }).settings;
    expect(zh[key], `zh-CN 缺 settings.${key}`).toBeTruthy();
    expect(en[key], `en-US 缺 settings.${key}`).toBeTruthy();
  });
});
