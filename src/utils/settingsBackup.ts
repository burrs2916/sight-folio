// 设置导出 / 导入（第二十一轮新增能力）
//
// 为什么现在要它：本轮之前，「设置会不会丢」完全押在一个本地 SQLite KV 上。用户换设备、重装系统、
// 或踩到 Rust 侧那条静默的内存库退路（见 store/settingsHealthStore.ts 文件头）时，精心调好的一整套
// 外观与预设没有任何退路 —— 只能重调。导出一份带版本号的 JSON 之后：
//  ① 设置「有没有真的存下来」变成一份可肉眼核对的文件，而不是信一句界面文案；
//  ② 换环境可以一次搬走，不必逐个域重调；
//  ③ 出问题时用户能把手上的备份发给开发者复现，而不是一句「设置不见了」。
//
// 口径：
// - 导出「会写进设置库的全部设置项」（与 docs/设置功能推进记录.md 的持久化口径表一一对应，现为 7 键）。
//   诊断探针（settings_probe）不属于设置项，不进快照。
//   **新增设置域必须同时补进 BACKUPABLE_SETTINGS_KEYS**，否则备份会静默缺这一域（第二十五轮的病灶）。
// - 导入**只写快照里真实存在的键**，快照里没有的键保持本机现值 —— 半份备份不该把其余设置清零。
// - 写入统一走 settingsSyncStore.persistAndWait（可信层的可等待入口），不绕开它直接 settingsApi.set：
//   绕开就等于让这一项的失败重新变回看不见的。写成功才让各 store 就地生效，写失败如实上报。
import { settingsApi } from '../services/tauri';
import { useSettingsSyncStore, type SettingsScope } from '../store/settingsSyncStore';
import { useThemeStore, THEME_SETTINGS_KEY } from '../store/themeStore';
import { useLayoutStore } from '../store/layoutStore';
import { useTypographyDefaultsStore, WRITING_TYPOGRAPHY_SETTINGS_KEY } from '../store/typographyDefaultsStore';
import { useBookTypographyStore, BOOK_TYPOGRAPHY_SETTINGS_KEY } from '../store/bookTypographyStore';
import { useWritingPrefsStore, WRITING_PREFS_SETTINGS_KEY } from '../store/writingPrefsStore';
import { useLanguageStore } from '../store/languageStore';
import { useAppearanceStore } from '../store/appearanceStore';
import type { ThemeConfig } from '../store/themeStore';
import type { LayoutConfig } from '../store/layoutStore';
import type { WritingPrefs } from '../store/writingPrefsStore';
import type { BookTypography } from './typography';
import { logger } from './logger';

/** 快照结构版本：读回侧据此判断兼容性（新增设置项不需要升版本，缺字段即「那份备份不管这一维度」） */
export const SETTINGS_SNAPSHOT_VERSION = 1;
/** 文件身份标记：防止用户误选到别的 JSON（书备份、报告等）把它当设置导入 */
export const SETTINGS_SNAPSHOT_KIND = 'sight-folio-settings';
/** 外观预设与布局在设置库里的键（layoutStore 未导出常量，这里与其内部字面量一致） */
const LAYOUT_SETTINGS_KEY = 'layout';
const APPEARANCE_PROFILES_KEY = 'appearance_profiles';

/**
 * 设置域会写设置库的 7 个键（顺序即导出与界面展示顺序；scope 对应落盘状态读数）。
 *
 * 第二十五轮补上 writing_prefs：第二十四轮新增写作偏好域时只改了 store 侧，这里没跟上，
 * 于是「导出备份」看起来是完整的一套，实际静默少了专注模式 / 打字机滚动 / 保存节奏 ——
 * 换设备导回来才发现这三项回到默认，属于本仓反复在清的「备份假装完整」。
 * 第三十轮 P1 补上 writing_typography_books：书级排版此前根本不在设置库里（躺在 localStorage），
 * 所以「导出备份」从来没有它；这一轮把它连同备份键一起补上，病灶才算真的收口。
 * 口径不变：新增键不需要升快照版本，老备份缺这个键即「那份备份不管这一维度」，恢复时保留本机现值。
 */
export const BACKUPABLE_SETTINGS_KEYS: { key: string; scope: SettingsScope; labelKey: string }[] = [
  { key: THEME_SETTINGS_KEY, scope: 'theme', labelKey: 'settings.backupKeyTheme' },
  { key: LAYOUT_SETTINGS_KEY, scope: 'layout', labelKey: 'settings.backupKeyLayout' },
  { key: WRITING_TYPOGRAPHY_SETTINGS_KEY, scope: 'typography', labelKey: 'settings.backupKeyTypography' },
  { key: BOOK_TYPOGRAPHY_SETTINGS_KEY, scope: 'typographyBooks', labelKey: 'settings.backupKeyTypographyBooks' },
  { key: WRITING_PREFS_SETTINGS_KEY, scope: 'writing', labelKey: 'settings.backupKeyWriting' },
  { key: 'language', scope: 'language', labelKey: 'settings.backupKeyLanguage' },
  { key: APPEARANCE_PROFILES_KEY, scope: 'appearance', labelKey: 'settings.backupKeyProfiles' },
];

export interface SettingsSnapshot {
  kind: typeof SETTINGS_SNAPSHOT_KIND;
  version: number;
  exportedAt: string;
  /** KV 键 → 该键在设置库里的原始字符串值（与库里存的一模一样，不做二次编码） */
  settings: Record<string, string>;
}

/** 读不到 / 解析失败的原因码，界面据此给不同的诚实文案 */
export type SnapshotParseError = 'empty' | 'invalid_json' | 'not_settings' | 'no_items';

export type SnapshotParseResult = { ok: true; snapshot: SettingsSnapshot } | { ok: false; error: SnapshotParseError };

/** 从设置库读出当前全部外观设置（缺失的键跳过，不写空串冒充「有值」） */
export async function collectSettingsSnapshot(): Promise<SettingsSnapshot> {
  const settings: Record<string, string> = {};
  for (const { key } of BACKUPABLE_SETTINGS_KEYS) {
    try {
      const value = await settingsApi.get(key);
      if (value !== null && value !== undefined) settings[key] = value;
    } catch (error) {
      // 单键读失败不影响其余键：导出的价值在于「能拿回多少是多少」，
      // 但这条得留在日志里，否则用户以为备份完整、恢复时才发现少一域。
      logger.warn('settingsBackup', '读取设置键失败，已跳过该键', { key, error: String(error) });
    }
  }
  return {
    kind: SETTINGS_SNAPSHOT_KIND,
    version: SETTINGS_SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };
}

/** 序列化成给人看、也给 git 存管用的格式（缩进 2，键序稳定，diff 不会整片变红） */
export function serializeSettingsSnapshot(snapshot: SettingsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** 建议文件名（带日期，同一天多次导出仍可区分时刻） */
export function snapshotFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `sight-folio-settings-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}.json`;
}

/**
 * 解析并校验用户递来的 JSON：只认「我们导出的那种」。
 * 这里刻意不做宽容处理（比如接受一个裸的 { theme, layout } 对象）—— 猜错结构的后果是
 * 把用户的设置库写坏，而报错重选一次文件的代价几乎为零。
 */
export function parseSettingsSnapshot(text: string): SnapshotParseResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'not_settings' };
  const candidate = parsed as Partial<SettingsSnapshot>;
  if (candidate.kind !== SETTINGS_SNAPSHOT_KIND || !candidate.settings || typeof candidate.settings !== 'object') {
    return { ok: false, error: 'not_settings' };
  }
  const settings: Record<string, string> = {};
  for (const { key } of BACKUPABLE_SETTINGS_KEYS) {
    const raw = (candidate.settings as Record<string, unknown>)[key];
    if (typeof raw === 'string' && raw.length > 0) settings[key] = raw;
  }
  // 一个可认的键都没有：这份 JSON 结构对但内容是空的，恢复它等于什么都没做，如实报错而不是「成功 0 项」
  if (Object.keys(settings).length === 0) return { ok: false, error: 'no_items' };
  return {
    ok: true,
    snapshot: {
      kind: SETTINGS_SNAPSHOT_KIND,
      version: typeof candidate.version === 'number' ? candidate.version : SETTINGS_SNAPSHOT_VERSION,
      exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : '',
      settings,
    },
  };
}

/** 快照里包含哪些设置键（界面按此列出「这份备份会改哪几项」，导入前先看清再动手） */
export function snapshotKeys(snapshot: SettingsSnapshot): { key: string; labelKey: string }[] {
  return BACKUPABLE_SETTINGS_KEYS.filter((item) => typeof snapshot.settings[item.key] === 'string').map(
    ({ key, labelKey }) => ({
      key,
      labelKey,
    }),
  );
}

export interface ApplyResult {
  /** 真的写进设置库并被本窗口采用的键 */
  applied: string[];
  /** 写库失败（含一次自动重试后仍失败）的键 —— 这些项本窗口没动，重启也不会变 */
  failed: string[];
}

/** 把一项已落库的设置并到本窗口内存（各 store 的 hydrate 只改内存，不会再写一次库造成回声） */
function adoptIntoStores(key: string, raw: string): void {
  try {
    if (key === THEME_SETTINGS_KEY) {
      useThemeStore.getState().hydrate(JSON.parse(raw) as Partial<ThemeConfig>);
    } else if (key === LAYOUT_SETTINGS_KEY) {
      useLayoutStore.getState().hydrate(JSON.parse(raw) as Partial<LayoutConfig>);
    } else if (key === WRITING_TYPOGRAPHY_SETTINGS_KEY) {
      useTypographyDefaultsStore.getState().hydrate(JSON.parse(raw) as Partial<BookTypography>);
    } else if (key === BOOK_TYPOGRAPHY_SETTINGS_KEY) {
      // 书级排版（第三十轮 P1）：hydrate 认「带 version 的信封」，与写入口径同一份解析，
      // 只改内存与渲染层读数 —— 这一步之前已经落过库，再写一次就是回声。
      useBookTypographyStore.getState().hydrate(JSON.parse(raw));
    } else if (key === WRITING_PREFS_SETTINGS_KEY) {
      // 写作偏好：hydrate 只改内存（不再写一次库造成回声），专注模式 / 打字机滚动 / 保存节奏就地跟随
      useWritingPrefsStore.getState().hydrate(JSON.parse(raw) as Partial<WritingPrefs>);
    } else if (key === 'language') {
      // 语言在库里是裸字符串（'zh-CN'），不是 JSON —— 与 languageStore 的写入口径保持一致
      useLanguageStore.getState().hydrate(raw);
    } else if (key === APPEARANCE_PROFILES_KEY) {
      // 预设列表没有 hydrate：第 25 轮待办 5 的病灶正是这里曾走 `init()` ——
      // 那会把 activeProfileId / isModified 一并盖成导出那一刻的值，于是「恢复备份」
      // 顺手改掉了用户此刻正在用的那套（部分键恢复时更是让高亮指向与界面不符的预设）。
      // 现只采纳预设清单，选中态由调用方在全部键落库后按实际生效值重新反查。
      useAppearanceStore.getState().adoptProfiles(raw);
    }
  } catch (error) {
    logger.warn('settingsBackup', '设置已落库但并入本窗口失败，重启后仍会生效', { key, error: String(error) });
  }
}

/**
 * 应用一份快照：先落库、落成功才让界面就地生效。
 * 顺序不能反：先改界面再落库的话，落库失败时界面已经是一套「其实没存住」的设置，
 * 正是本轮在收拾的那类「看起来生效了」的假象。
 */
export async function applySettingsSnapshot(snapshot: SettingsSnapshot): Promise<ApplyResult> {
  const applied: string[] = [];
  const failed: string[] = [];
  const sync = useSettingsSyncStore.getState();
  for (const { key, scope } of BACKUPABLE_SETTINGS_KEYS) {
    const raw = snapshot.settings[key];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const ok = await sync.persistAndWait(scope, key, raw);
    if (!ok) {
      failed.push(key);
      continue;
    }
    adoptIntoStores(key, raw);
    applied.push(key);
  }
  // 全部键落库之后再反查预设高亮（第二十七轮）：反查要用的是「这台机器现在的实际生效值」，
  // 放在循环里会读到还没恢复完的主题/布局。恢复一份自洽的备份 → 高亮回到那张卡；
  // 只恢复了几域 → 高亮如实变成「已微调」或清空，而不是假装还在某套预设上。
  if (applied.includes(APPEARANCE_PROFILES_KEY)) {
    useAppearanceStore
      .getState()
      .detectActiveProfile(useThemeStore.getState().config, useLayoutStore.getState().config);
  }
  return { applied, failed };
}
