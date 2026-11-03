// 界面语言的持久化口径（第十九轮新增设置项）
//
// 为什么需要它：语言此前只写浏览器 localStorage（'project-sight-locale'），与主题 / 布局 /
// 正文排版不是同一套持久化。后果有两处：
//  ① 独立窗口（写作台 / 代码工作台）不一定共享同一份 localStorage，主窗口切了英文，
//     另一边可能还是中文 —— 用户口中的「设置没生效」；
//  ② 设置抽屉里没有语言入口，用户只能从顶栏一个「切到另一门语言」的按钮盲切。
// 现在语言与其余外观项一样以应用设置库为准（键 LANGUAGE_SETTINGS_KEY），启动 init() 读回，
// 旧的 localStorage 值一次性迁移进设置库；抽屉与顶栏共用本 store，读数只有一份。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { broadcastAppearanceChange } from '../services/appearanceSync';
import { persistSettings } from './settingsSyncStore';
// 读回迟到竞态防护（第三十四轮）：口径与为什么需要它见 settingsReadbackGuard.ts 文件头
import { attachSettingsReadbackGuard } from './settingsReadbackGuard';
import { getLang, setLang, subscribeLang } from '../i18n';
import type { Lang } from '../i18n';

/** 界面语言的专用持久化键（写入应用设置库，重启由 init 读回）。 */
export const LANGUAGE_SETTINGS_KEY = 'language';
/** 历史遗留键：早期只写 localStorage，init 时一次性迁移进设置库。 */
const LEGACY_LANGUAGE_STORAGE_KEY = 'project-sight-locale';

const LANGS: Lang[] = ['zh-CN', 'en-US'];

/** 只有词典里真实存在的语言才可信，脏值（手改设置库 / 降级安装）一律回落 null。 */
function normalizeLang(value: unknown): Lang | null {
  return LANGS.includes(value as Lang) ? (value as Lang) : null;
}

function loadLegacyLang(): Lang | null {
  try {
    return normalizeLang(localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY));
  } catch {
    /* localStorage 不可用时忽略 */
    return null;
  }
}

function persist(lang: Lang): void {
  broadcastAppearanceChange('language', lang);
  // 第二十轮：统一可信层（失败重试 + 状态可读）
  persistSettings('language', LANGUAGE_SETTINGS_KEY, lang);
}

interface LanguageState {
  lang: Lang;
  initialized: boolean;

  init: () => Promise<void>;
  setLanguage: (lang: Lang) => void;
  toggleLanguage: () => void;
  /** 跨窗口跟随：只改内存并同步 i18n，绝不回写设置库（来源已是另一窗口的落盘动作） */
  hydrate: (lang: unknown) => void;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  // i18n 模块加载时已按「localStorage > 浏览器语言」推出一版读数，先拿它兜底，
  // 避免 init() 回来之前闪一下错误语言。
  lang: getLang(),
  initialized: false,

  init: async () => {
    // 第三十四轮：门控超时后用户可能已经在顶栏 / 抽屉里切过语言。这一域是**标量**读数，
    // 没有「按字段并回来」的余地 —— 改过就整域以内存为准，且三条写入分支一条都不能走：
    // 走「库值」会吞掉他刚选的语言，走「legacy 迁移」或「首装写推导值」更会把他的选择盖掉。
    const mark = languageReadback.capture();
    try {
      const saved = normalizeLang(await settingsApi.get(LANGUAGE_SETTINGS_KEY));
      if (languageReadback.isStale(mark)) {
        set({ initialized: true });
        return;
      }
      if (saved) {
        setLang(saved);
        set({ lang: saved, initialized: true });
        return;
      }
      const legacy = loadLegacyLang();
      if (legacy) {
        setLang(legacy);
        set({ lang: legacy, initialized: true });
        persist(legacy);
        try {
          localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
        } catch {
          /* localStorage 不可用时忽略 */
        }
        return;
      }
      // 全新安装：把 i18n 推导出的读数落进设置库，后续所有窗口据此对齐
      const derived = getLang();
      set({ lang: derived, initialized: true });
      persist(derived);
    } catch (error) {
      console.error('[LanguageStore] 从设置库加载界面语言失败:', error);
      if (languageReadback.isStale(mark)) {
        set({ initialized: true });
        return;
      }
      set({ lang: getLang(), initialized: true });
    }
  },

  setLanguage: (lang: Lang) => {
    const next = normalizeLang(lang);
    if (!next || next === get().lang) return;
    setLang(next);
    set({ lang: next });
    persist(next);
  },

  toggleLanguage: () => {
    get().setLanguage(get().lang === 'zh-CN' ? 'en-US' : 'zh-CN');
  },

  hydrate: (lang: unknown) => {
    const next = normalizeLang(lang);
    if (!next || next === get().lang) return;
    setLang(next);
    set({ lang: next });
  },
}));

// 镜像订阅放在模块级、只挂一次：无论从哪一处改语言（顶栏按钮 / 设置抽屉 / 另一窗口
// 广播 / 历史调用方直接调 setLang），store 的读数都跟着 i18n 走，界面不会出现两处不一致。
subscribeLang(() => useLanguageStore.setState({ lang: getLang() }));

export type { Lang };

/**
 * 读回竞态防护（第三十四轮）。`select` 取标量 `lang`：任何一次变化都是「用户改过这一域」，
 * 因此合并粒度就是整域（见 mergeStaleReadback 的标量分支）。
 * 注意模块级那条 `subscribeLang` 镜像订阅也会喂到这里 —— 这是对的：无论从哪一处改的语言，
 * 都属于「本窗口在拍号之后有了新读数」，迟到库值同样不许盖。
 */
const languageReadback = attachSettingsReadbackGuard(useLanguageStore, {
  scope: 'language',
  select: (s) => s.lang,
  fields: ['lang'],
});
