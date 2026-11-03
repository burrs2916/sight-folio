// 写作偏好「真的能改、真的生效、真的记住」回归锁（2026-11-02，第二十五轮）
//
// 病灶（本轮开工时实测的现状）：第二十四轮建好了 writingPrefsStore（含落盘、跨窗口广播、
// 首帧读回门控），但**一个消费点都没接**：
//  ① WritingPage 仍用组件私有 useState('normal') 持有专注模式 → 今天开禅模式，明天重启回到普通态，
//     正是该 store 文件头写着要治的那条「设置不记住」；
//  ② 打字机滚动仍写死 `focusModeRef.current !== 'zen'` → 「总是 / 关闭」两档只存不读；
//  ③ 自动保存防抖仍是三处硬编码 800ms（WritingPage 两处 + WritingChapterEditor 自己的一份常量）
//     → 「快 / 稳健」两档是死的；
//  ④ 设置抽屉里没有这一域的入口 → 用户根本改不到；
//  ⑤ 「恢复默认」不带这一域（reset() 写好却无调用点）、设置备份也不含 writing_prefs
//     → 换设备导回来会静默丢掉这三项。
// 本文件把「档位口径 + 落盘与重启读回 + 恢复默认 + 备份纳入 + 消费点确实读 store」全部锁住。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

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

import {
  useWritingPrefsStore,
  WRITING_PREFS_SETTINGS_KEY,
  DEFAULT_WRITING_PREFS,
  SAVE_CADENCE_MS,
  normalizeWritingPrefs,
  isSameWritingPrefs,
  saveDebounceMs,
  shouldCenterCaret,
  nextDeskFocusMode,
} from '../writingPrefsStore';
import { useAppearanceStore, BUILT_IN_PROFILES } from '../appearanceStore';
import { useThemeStore } from '../themeStore';
import { useLayoutStore, DEFAULT_LAYOUT_CONFIG } from '../layoutStore';
import { useTypographyDefaultsStore } from '../typographyDefaultsStore';
import { DEFAULT_TYPOGRAPHY } from '../../utils/typography';
import {
  BACKUPABLE_SETTINGS_KEYS,
  collectSettingsSnapshot,
  parseSettingsSnapshot,
  applySettingsSnapshot,
  snapshotKeys,
} from '../../utils/settingsBackup';

/** 等 fire-and-forget 的写入链跑完 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function resetMemory() {
  useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS }, initialized: true });
  useThemeStore.setState({
    config: { mode: 'system', preset: 'default', fontSize: 'medium', borderRadius: 'medium' },
    initialized: true,
  });
  useLayoutStore.setState({ config: { ...DEFAULT_LAYOUT_CONFIG }, initialized: true });
  useTypographyDefaultsStore.setState({ config: { ...DEFAULT_TYPOGRAPHY }, initialized: true });
  useAppearanceStore.setState({
    profiles: [...BUILT_IN_PROFILES],
    activeProfileId: null,
    baseProfileId: null,
    isModified: false,
    initialized: true,
  });
}

beforeEach(() => {
  kv.clear();
  resetMemory();
});

describe('写作偏好 · 档位口径（单一真源）', () => {
  it('三档保存节奏递增，标准档就是历史上的那个 800ms（老用户观感不变）', () => {
    expect(SAVE_CADENCE_MS.fast).toBeLessThan(SAVE_CADENCE_MS.standard);
    expect(SAVE_CADENCE_MS.standard).toBeLessThan(SAVE_CADENCE_MS.steady);
    // 标准档 = 本仓硬编码时代的那个 800ms：默认档必须让老用户观感不变
    expect(saveDebounceMs('standard')).toBe(800);
    expect(saveDebounceMs('fast')).toBe(400);
    expect(saveDebounceMs('steady')).toBe(1500);
  });

  it('脏档位回落标准档，绝不把 undefined 带进排程处', () => {
    expect(saveDebounceMs('instant' as never)).toBe(800);
  });

  it('打字机滚动三档的判定只有一份口径（关 / 仅禅模式 / 总是）', () => {
    expect(shouldCenterCaret('off', 'zen')).toBe(false);
    expect(shouldCenterCaret('off', 'normal')).toBe(false);
    // 仅禅模式 = 第廿四轮之前的唯一行为，作为默认档
    expect(shouldCenterCaret('zen', 'zen')).toBe(true);
    expect(shouldCenterCaret('zen', 'focus')).toBe(false);
    // 总是 = 本轮新增的能力：不牺牲左右栏也能让光标居中
    expect(shouldCenterCaret('always', 'normal')).toBe(true);
    expect(shouldCenterCaret('always', 'focus')).toBe(true);
    expect(shouldCenterCaret('always', 'zen')).toBe(true);
  });

  it('专注模式循环顺序固定：普通 → 专注 → 禅 → 普通（工具栏与命令面板共用）', () => {
    expect(nextDeskFocusMode('normal')).toBe('focus');
    expect(nextDeskFocusMode('focus')).toBe('zen');
    expect(nextDeskFocusMode('zen')).toBe('normal');
  });

  it('归一化：档位外的脏值 / 缺字段逐项回落，不是一键清零', () => {
    expect(normalizeWritingPrefs({ focusMode: 'ultra' as never, saveCadence: 'steady' })).toEqual({
      focusMode: DEFAULT_WRITING_PREFS.focusMode,
      typewriterScroll: DEFAULT_WRITING_PREFS.typewriterScroll,
      saveCadence: 'steady',
    });
    expect(normalizeWritingPrefs(null)).toEqual({ ...DEFAULT_WRITING_PREFS });
    expect(isSameWritingPrefs(DEFAULT_WRITING_PREFS, normalizeWritingPrefs({}))).toBe(true);
  });
});

describe('写作偏好 · 落盘与重启读回', () => {
  it('改档位即时写进设置库，清掉内存再 init 读回同一套（关掉软件不失效）', async () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    useWritingPrefsStore.getState().setTypewriterScroll('always');
    useWritingPrefsStore.getState().setSaveCadence('fast');
    await flush();
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY)!)).toEqual({
      focusMode: 'zen',
      typewriterScroll: 'always',
      saveCadence: 'fast',
    });

    useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS }, initialized: false });
    await useWritingPrefsStore.getState().init();
    expect(useWritingPrefsStore.getState().config).toEqual({
      focusMode: 'zen',
      typewriterScroll: 'always',
      saveCadence: 'fast',
    });
  });

  it('库里是脏值时读回回落缺省档，而不是把档位外的字符串带进界面', async () => {
    kv.set(WRITING_PREFS_SETTINGS_KEY, JSON.stringify({ focusMode: 'sepia', typewriterScroll: 'always' }));
    await useWritingPrefsStore.getState().init();
    const config = useWritingPrefsStore.getState().config;
    expect(config.focusMode).toBe(DEFAULT_WRITING_PREFS.focusMode);
    expect(config.typewriterScroll).toBe('always');
  });

  it('同一档位重复设置不再写盘（避免无谓落库与广播）', async () => {
    const before = kv.get(WRITING_PREFS_SETTINGS_KEY);
    useWritingPrefsStore.getState().setFocusMode(DEFAULT_WRITING_PREFS.focusMode);
    await flush();
    expect(kv.get(WRITING_PREFS_SETTINGS_KEY)).toBe(before);
  });

  it('跨窗口 hydrate 只改内存，不回写设置库（否则两窗口互相回声）', async () => {
    kv.set(WRITING_PREFS_SETTINGS_KEY, 'SENTINEL');
    useWritingPrefsStore.getState().hydrate({ focusMode: 'focus', typewriterScroll: 'always', saveCadence: 'steady' });
    await flush();
    expect(useWritingPrefsStore.getState().config.focusMode).toBe('focus');
    expect(kv.get(WRITING_PREFS_SETTINGS_KEY)).toBe('SENTINEL');
  });
});

describe('写作偏好 · 「恢复默认」覆盖第四域', () => {
  it('resetAll 把写作偏好一起复位并落库（此前 reset() 无调用点，点完仍留着禅模式）', async () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    useWritingPrefsStore.getState().setSaveCadence('steady');
    await flush();

    useAppearanceStore.getState().resetAll();
    await flush();

    expect(useWritingPrefsStore.getState().config).toEqual({ ...DEFAULT_WRITING_PREFS });
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY)!)).toEqual({ ...DEFAULT_WRITING_PREFS });
  });
});

describe('写作偏好 · 纳入设置备份与恢复', () => {
  it('可备份键含 writing_prefs，且 scope 用可信层的 writing', () => {
    const item = BACKUPABLE_SETTINGS_KEYS.find((k) => k.key === WRITING_PREFS_SETTINGS_KEY);
    expect(item?.scope).toBe('writing');
    // 这条计数锁的用意是「新增设置域必须在这里登记一次」（第 25 轮立的规矩）。
    // 第三十轮 P1 书级排版迁进设置库 → 第 7 个键，配套断言见 bookTypographyRound30.test.ts。
    expect(BACKUPABLE_SETTINGS_KEYS).toHaveLength(7);
  });

  it('导出 → 换环境恢复：写作偏好随快照回来并就地生效（不再静默少一域）', async () => {
    useWritingPrefsStore.getState().setFocusMode('zen');
    useWritingPrefsStore.getState().setTypewriterScroll('always');
    await flush();

    const snapshot = await collectSettingsSnapshot();
    expect(snapshot.settings[WRITING_PREFS_SETTINGS_KEY]).toContain('always');
    expect(snapshotKeys(snapshot).map((k) => k.key)).toContain(WRITING_PREFS_SETTINGS_KEY);

    const text = JSON.stringify(snapshot);
    // 换设备：清空本机 → 从备份文本恢复
    kv.clear();
    useWritingPrefsStore.setState({ config: { ...DEFAULT_WRITING_PREFS } });
    const parsed = parseSettingsSnapshot(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await applySettingsSnapshot(parsed.snapshot);
    expect(result.failed).toEqual([]);
    expect(result.applied).toContain(WRITING_PREFS_SETTINGS_KEY);
    expect(useWritingPrefsStore.getState().config).toMatchObject({ focusMode: 'zen', typewriterScroll: 'always' });
    expect(JSON.parse(kv.get(WRITING_PREFS_SETTINGS_KEY)!)).toMatchObject({ focusMode: 'zen' });
  });

  it('老备份（没有 writing_prefs 键）照旧可恢复，且不把本机现值清零', async () => {
    const legacy = {
      kind: 'sight-folio-settings',
      version: 1,
      exportedAt: '',
      settings: { theme: JSON.stringify({ mode: 'dark', preset: 'blue', fontSize: 'medium', borderRadius: 'small' }) },
    };
    useWritingPrefsStore.getState().setFocusMode('focus');
    const parsed = parseSettingsSnapshot(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await applySettingsSnapshot(parsed.snapshot);
    expect(useWritingPrefsStore.getState().config.focusMode).toBe('focus');
  });
});

describe('写作偏好 · 消费点确实读 store（防止「只存不读」回潮）', () => {
  const root = process.cwd();
  const writingPage = readFileSync(`${root}/src/pages/WritingPage.tsx`, 'utf8');
  const chapterEditor = readFileSync(`${root}/src/editor/renderers/WritingChapterEditor.tsx`, 'utf8');

  it('专注模式不再是 WritingPage 的私有 state', () => {
    expect(writingPage).toMatch(/useWritingPrefsStore\(\(s\) => s\.config\.focusMode\)/);
    expect(writingPage).not.toMatch(/useState<'normal' \| 'focus' \| 'zen'>/);
    // 循环切档只有一份口径
    expect(writingPage).toMatch(/nextDeskFocusMode\(/);
    expect(writingPage).not.toMatch(/if \(v === 'normal'\) return 'focus';/);
  });

  it('打字机滚动走 shouldCenterCaret，档位与专注模式一起现取（改完不用重开窗口）', () => {
    expect(writingPage).toMatch(/shouldCenterCaret\(prefs\.typewriterScroll, prefs\.focusMode\)/);
    expect(writingPage).not.toMatch(/focusModeRef\.current !== 'zen'/);
  });

  it('保存排程读当前节奏档位，三处硬编码 800ms 全部拆除', () => {
    expect(writingPage).toMatch(/saveDebounceMs\(useWritingPrefsStore\.getState\(\)\.config\.saveCadence\)/);
    expect(writingPage).not.toMatch(/SAVE_DEBOUNCE_MS/);
    expect(chapterEditor).toMatch(/saveDebounceMs\(useWritingPrefsStore\.getState\(\)\.config\.saveCadence\)/);
    expect(chapterEditor).not.toMatch(/SAVE_DEBOUNCE_MS = 800/);
  });

  it('第廿四轮留下的常量别名文件已拆掉（零引用的死导出不能留着误导下一个改代码的人）', () => {
    expect(existsSync(`${root}/src/pages/writingPage/constants.ts`)).toBe(false);
  });
});
