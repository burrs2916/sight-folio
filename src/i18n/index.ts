import { useSyncExternalStore } from "react";
import zhCN from "./zh-CN.json";
import enUS from "./en-US.json";

/**
 * 轻量国际化引擎（零依赖，结构对齐参考项目 snap-craft 的 i18n/index.ts，
 * 但存储键与标题处理适配本项目 sight-folio）。
 *
 * - 语言：zh-CN / en-US，持久化到 localStorage('sight-folio-locale')
 * - 启动时按 已保存 > 浏览器语言 推断
 * - 通过 useSyncExternalStore 订阅语言变化，切换时组件自动重渲染
 * - 纯前端 UI 文案翻译；后端返回的内容（OCR 文本、扫描数据等）不属于 UI 文案，不在此处理
 *
 * 约定：
 * - 所有用户可见 UI 文案必须走 t('namespace.key')，禁止硬编码中文/英文。
 * - 参数占位符用 {name}，如 t('footer.analysisCount', { n: 3 })。
 * - 新增语言只需在 resources 增加一份字典并实现 Lang 类型分支。
 */

export type Lang = "zh-CN" | "en-US";

/** 双语文本：用于预设的 title/description/prompt 等「数据驱动」文案，按当前 UI 语言选取 */
export type LangText = { "zh-CN": string; "en-US": string };

/** 取与当前 UI 语言匹配的双语文本（数据驱动文案，不进 JSON 语言包） */
export function pickLang(text: LangText | undefined): string {
  if (!text) return "";
  return text[current] ?? text["zh-CN"] ?? "";
}

const LANGS: Lang[] = ["zh-CN", "en-US"];
const STORAGE_KEY = "project-sight-locale";

type Dict = { [k: string]: string | Dict };

const resources: Record<Lang, Dict> = {
  "zh-CN": zhCN as unknown as Dict,
  "en-US": enUS as unknown as Dict,
};

function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh-CN" || saved === "en-US") return saved;
  } catch {
    /* localStorage 不可用时忽略，回落到浏览器语言 */
  }
  const nav = (typeof navigator !== "undefined" && navigator.language) || "zh-CN";
  return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

let current: Lang = getInitialLang();
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((l) => l());
}

function persist(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* 忽略写入失败 */
  }
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", lang);
  }
}

function applyLang(lang: Lang) {
  if (!LANGS.includes(lang) || lang === current) return;
  current = lang;
  persist(lang);
  notifyListeners();
}

persist(current);

export function setLang(lang: Lang) {
  applyLang(lang);
}

export function toggleLang() {
  applyLang(current === "zh-CN" ? "en-US" : "zh-CN");
}

export function getLang(): Lang {
  return current;
}

// 深层查找：先按完整 key 直接命中，否则按 '.' 拆分逐层查找；未命中回退 zh-CN，再回退 key 本身
function resolve(dict: Dict, key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(dict, key)) {
    const v = dict[key];
    if (typeof v === "string") return v;
  }
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

export interface TParams {
  [k: string]: string | number;
}

export function translate(key: string, params?: TParams): string {
  const dict = resources[current] ?? resources["zh-CN"];
  let str = resolve(dict, key);
  if (str === undefined) str = resolve(resources["zh-CN"], key); // 回退到中文
  if (str === undefined) return key; // 最终回退到 key 本身，避免空白
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (_m, name: string) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`
    );
  }
  return str;
}

// 稳定的模块级 t：JSX 与回调共用同一引用，避免 useCallback 依赖抖动
export const t = translate;

/**
 * 旧中文系统名 → 候选 key 索引（zh 值反查）。
 *
 * 背景：i18n key 化（第十一轮）之前，分析器模板名 / 默认视图名等注册数据直接存
 * 中文文本（如「架构总览」「目录树」），并已随场景持久化进 DB。渲染侧拿到的
 * 是中文而非 key，切语言不翻译。这里构建一次 zh 值 → keys 反查索引，
 * resolveFragments 对整段精确匹配的中文文本翻译为当前语言；
 * 用户自定义中文名（语言包里没有对应值）反查不到，原样保留。
 */
const ZH_VALUE_KEYS = new Map<string, string[]>();
(function buildZhValueIndex() {
  const walk = (obj: Dict, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") {
        const arr = ZH_VALUE_KEYS.get(v) ?? [];
        arr.push(key);
        ZH_VALUE_KEYS.set(v, arr);
      } else {
        walk(v as Dict, key);
      }
    }
  };
  walk(resources["zh-CN"], "");
})();

/** 归一化译文用于一致性比较（忽略大小写与首尾空白） */
function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 对可能含 i18n key 片段的字符串做解引用。
 *
 * 场景：注册类数据在模块加载时把多个 key 拼进模板（如
 * `${manifest.name} 提供的「${et.name}」实体`），渲染侧拿到的不是单个完整 key，
 * t() 整串必然回退。这里把串内的点分 key 片段逐个解引用，
 * 非 key 文本（路径、小数、URL）由 t() 回退逻辑原样保留。
 *
 * 兼容：整段文本若精确命中 zh 语言包某个值（旧中文系统名，如「架构总览」），
 * 且所有候选 key 的当前语言译文一致，则整体翻译为当前语言；
 * 否则原样返回（用户自定义中文名不受影响）。
 */
const KEY_FRAGMENT_RE = /[a-z][\w-]*\.[a-zA-Z][\w.-]*/g;
export function resolveFragments(s: string | undefined | null): string {
  if (!s) return "";
  // 整段旧中文系统名（不含点分 key 片段时才走反查，避免干扰模板串）
  const trimmed = s.trim();
  if (!/[a-z][\w-]*\.[a-zA-Z][\w.-]*/.test(s) && /[\u4e00-\u9fff]/.test(trimmed)) {
    const candidates = ZH_VALUE_KEYS.get(trimmed);
    if (candidates && candidates.length > 0) {
      const resolved = candidates.map((k) => translate(k));
      if (resolved.every((r) => normalizeForCompare(r) === normalizeForCompare(resolved[0]))) {
        return resolved[0];
      }
    }
  }
  return s.replace(KEY_FRAGMENT_RE, (m) => {
    const v = translate(m);
    return v === m ? m : v;
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Lang {
  return current;
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { t, lang, toggleLang, setLang };
}

export default useI18n;
