// sight-folio: 设置「读回迟到」竞态防护（第三十四轮）
//
// 病灶（七个设置域同型，此前一处防护都没有）：
//   `App.tsx` 的首帧门控只等 `APPEARANCE_READBACK_TIMEOUT_MS = 1500ms`，到点就放行界面
//   （设计意图是对的：读回走 IPC，某一项永远回不来时不能把整个应用挂住）。于是留下一个窗口：
//
//     t=0     init() 发出 settingsApi.get(...)
//     t=1.5s  门控超时 → 界面出现，内存还是**内置默认值**
//     t=1.6s  用户点「深色」→ setMode() → 内存 {mode:dark} → 落库（整份 config 一次写）
//     t=3.0s  init() 的迟到读数回来，**无条件 set(库值)** → 内存被盖回旧的那一套
//
//   观感就是用户反复说的那句话：「设置点了没生效」「关掉软件再开又回去了」。更糟的是第二跳：
//   盖回之后用户再改任何一项，写的都是「旧内存 + 这一项」，于是 t=1.6s 那次改动**在库里也被冲掉**，
//   从「界面回退」升级成「数据真的丢了」。
//
//   还有一层不看见的伤害：t=1.6s 那次写入是以**内置默认**为基底的整份覆盖，库里其余维度
//   （比如用户很久前调好的 fontSize）当场被默认值冲掉 —— 这不是迟到读数的错，是「内存还没初始化
//   就整份落库」的错，只有把迟到读数按字段并回来才修得回去。
//
// 本模块的口径（一次做对，七个域共用，不各写一份）：
//  ① **改过就知道**：订阅 store，只在「本域真正落库的那几个字段」发生变化时记一次号，并记下
//     到底是哪几个字段被改过（`dirtyKeys`）。`initialized` 之类的非落库字段翻动不算（否则
//     React StrictMode 双跑 init 会被判成「用户改过」，白写一次库）。
//  ② **迟到读数不整份盖**：`init()` 发请求前拍号，回来后若已 stale，就把库读数当**底**、
//     把用户改过的那几项当**面**做一次合并 —— 用户碰过的以内存为准，没碰过的以库为准
//     （顺手把 ① 里被默认值冲掉的维度修回去），合并结果与内存逐字段相同才免写。
//  ③ **门控照常放行**：无论合并与否，`initialized` 都必须置真。挡在这里的代价是白屏，
//     比「闪一下」大得多 —— 这条是第一帧门控立项时的取舍，本轮不改。
import type { StoreApi } from 'zustand';
import type { SettingsScope } from './settingsSyncStore';

/** 脏字段哨兵：整域以内存现值为准。用于标量读数，以及「显式重写成同一值」这类比不出差异的改动 */
export const EVERY_FIELD = '*';

/**
 * 本次启动的迟到读回账（第三十五轮）。
 *
 * 为什么要计数：第三十四轮把「迟到读数不再整份盖」做完了，但这件事**只有 console 里没有界面**。
 * 用户在门控超时后改了一档，界面没跳回去 —— 他看到的结果和「设置没生效」长得一模一样，
 * 只是这次数据是好的。健康条于是需要能说这一句：「本次启动有 N 次设置读回迟到，已按你改过的那几项保留」。
 *
 * 口径：
 *  · 记在 **guard 内部**（`isStale` 判定为真那一刻），七域一行登记代码都不用各写一份；
 *  · **同一次拍号只记一次**：`isStale(mark)` 可能在多个分支里被调，StrictMode 双跑 init 更是两次
 *    请求同一份改动，报两条会让人以为故障比实际严重；
 *  · 只在内存里，**不新增 KV 键**：它描述的是「本次启动」，跨启动留着反而会说谎。
 */
export interface LateReadbackSnapshot {
  /** 迟到命中次数（按拍号去重后） */
  count: number;
  /** 命中过哪些域（去重、按 SETTINGS_SCOPE_ORDER 稳定排序，界面不会每次换个顺序） */
  scopes: SettingsScope[];
  /** 最近一次命中的时刻；null = 本次启动还没发生过 */
  lastAt: number | null;
}

/**
 * 与 settingsSyncStore.SettingsScope 对齐的稳定展示顺序。
 * 刻意写成 `Record<SettingsScope, number>` 而不是数组：第八个域进来时若忘了登记，
 * **tsc 当场红**，而不是让界面少报一个域名（数组会静默漏，Record 不会）。
 */
const SCOPE_ORDER: Record<SettingsScope, number> = {
  theme: 0,
  layout: 1,
  typography: 2,
  typographyBooks: 3,
  writing: 4,
  language: 5,
  appearance: 6,
};

let lateCount = 0;
const lateScopes = new Set<SettingsScope>();
let lateLastAt: number | null = null;
const lateListeners = new Set<() => void>();

/** 取本次启动的迟到读回账（界面/自检用读数） */
export function getLateReadbackSnapshot(): LateReadbackSnapshot {
  return {
    count: lateCount,
    scopes: [...lateScopes].sort((a, b) => SCOPE_ORDER[a] - SCOPE_ORDER[b]),
    lastAt: lateLastAt,
  };
}

/** 订阅迟到读回账变化；返回退订函数 */
export function subscribeLateReadbacks(listener: () => void): () => void {
  lateListeners.add(listener);
  return () => lateListeners.delete(listener);
}

function recordLateReadback(scope: SettingsScope): void {
  lateCount += 1;
  lateScopes.add(scope);
  lateLastAt = Date.now();
  // 复制一份再遍历：监听器里可能退订自己（React 卸载），直接迭代 Set 会在中途改尺寸
  [...lateListeners].forEach((listener) => listener());
}

/** 清空迟到读回账（回归用例用：这些计数是模块级的，不清会串到下一条用例） */
export function resetLateReadbacks(): void {
  lateCount = 0;
  lateScopes.clear();
  lateLastAt = null;
  [...lateListeners].forEach((listener) => listener());
}

export interface ReadbackGuard {
  /** 发请求前拍号；返回值交给 `isStale` 比对 */
  capture(): number;
  /** 拍号之后本窗口是否自己改过这一域（改过 ⇒ 迟到读数不得整份盖内存） */
  isStale(mark: number): boolean;
  /** 拍号之后被改过的字段名（含 `EVERY_FIELD` 哨兵）；合并时这些字段以内存现值为准 */
  dirtyKeys(): Set<string>;
  /** 测试用：清到「本次启动还没读回、也没改过」的形态 */
  reset(): void;
}

export interface ReadbackGuardBinding<S extends object> {
  /**
   * 这一域在可信层里的 scope（第三十五轮）。两个用途：迟到读回账要报名字；
   * 界面那句「哪几项读回迟到了」用它反查显示名（见 SettingsHealthNotice）。
   */
  scope: SettingsScope;
  /** 取本域落库的那份读数（对象则按字段逐个比，标量则整体比） */
  select: (state: S) => unknown;
  /**
   * 参与比对与合并的字段清单 = 这一域真正落进设置库的字段。
   * 刻意要求显式列出而不是 `Object.keys(读数)`：`initialized` / 界面私有字段混进来会让
   * 「门控标志翻动」被误判成「用户改过设置」。
   * 例外：**映射型**读数（书级排版覆盖表：键就是 bookId）传 `null` —— 键集是运行时数据，
   * 写死清单等于要求用户每新建一本书就改一次代码，此时按「两侧键集并集」逐键比。
   */
  fields: readonly string[] | null;
  /**
   * 「字段值一个都没变、但读数换了新对象」算不算用户改过（默认 **算**）。
   *
   * 算的理由：`setConfig({ mode: 'system' })` 这类「把某项显式写回当前值」的调用比不出差异，
   *   但它是一次真实意图，不算就会被库读数吃掉。
   * 关的场景：`select` 取的是**整份 state**（外观预设域就是）时，`initialized` 这类非落库字段
   *   翻动也会换出新对象，算进来会让 React StrictMode 双跑 init 被判成「用户改过」，白写一次库。
   */
  countSameValueRewrite?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 挂一个防护到 store 上：只订阅一次，返回该域的 guard。
 *
 * 为什么订阅而不是在每个 action 里手写 `touch()`：本仓七个域一共 30+ 个写入口，逐处接线必然漏
 * （第 24 轮「只建 store 没接消费点」就是同一类半成品）。挂在订阅上，**以后新增的 action 自动被覆盖**，
 * 漏不出来。
 */
export function attachSettingsReadbackGuard<S extends object>(
  store: Pick<StoreApi<S>, 'subscribe'>,
  binding: ReadbackGuardBinding<S>,
): ReadbackGuard {
  let revision = 0;
  let dirty = new Set<string>();
  /** 已经记过账的拍号（第三十五轮）：同一次读回在多个分支里判 stale、或 StrictMode 双跑，只算一次事件 */
  let lastCountedMark: number | null = null;

  store.subscribe((state, prev) => {
    if (prev === undefined || state === prev) return;
    const next = binding.select(state);
    const before = binding.select(prev);
    if (next === before) return; // 本域读数没动（是别的字段变了）→ 不算改过设置
    revision += 1;

    if (!isRecord(next) || !isRecord(before)) {
      // 标量读数（界面语言）：整体就是这一个值，改动即整域以内存为准
      dirty = new Set(dirty).add(EVERY_FIELD);
      return;
    }
    const keys =
      binding.fields === null || binding.fields === undefined
        ? new Set([...Object.keys(next), ...Object.keys(before)])
        : new Set<string>(binding.fields);
    const changed = new Set<string>();
    for (const key of keys) {
      if (next[key] !== before[key]) changed.add(key);
    }
    if (changed.size === 0) {
      if (binding.countSameValueRewrite === false) return;
      // 用户显式把某一项写回成「看起来没变」的值（库里已是 medium，他又点了一次「中」）：
      // 值比不出差异，但意图是真实的，按整域以内存为准，否则他那一次点击会被库读数吃掉。
      dirty = new Set(dirty).add(EVERY_FIELD);
      return;
    }
    const merged = new Set(dirty);
    changed.forEach((key) => merged.add(key));
    dirty = merged;
  });

  return {
    capture: () => {
      // 新一轮读回从干净账开始：脏字段只统计**这次拍号之后**的改动
      dirty = new Set<string>();
      return revision;
    },
    isStale: (mark) => {
      const stale = revision !== mark;
      // 记在判定这一步：七域的 init 长得一样（拍号 → 读库 → 判 stale → 合并），
      // 计数放在 guard 里就**不可能有哪一域漏记**；放在各域 init 里则迟早漏（第 24 轮那类半成品）。
      if (stale && lastCountedMark !== mark) {
        lastCountedMark = mark;
        recordLateReadback(binding.scope);
      }
      return stale;
    },
    dirtyKeys: () => dirty,
    reset: () => {
      revision = 0;
      dirty = new Set<string>();
      lastCountedMark = null;
    },
  };
}

/**
 * 合并一份迟到的库读数：库为底、用户改过的那几项为面。
 * 归一化（脏值回落 / 缺字段补默认）必须在调用前做完，这里只管取舍。
 */
export function mergeStaleReadback<T extends object>(dbReading: T, current: T, dirty: Set<string>): T {
  if (dirty.has(EVERY_FIELD)) return current;
  const db = dbReading as Record<string, unknown>;
  const mem = current as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...db };
  for (const key of Object.keys(db)) {
    if (!dirty.has(key)) continue;
    // 用户在窗口里把这一项**删掉了**（书级收回 / customPrimary 清空）：内存里是 undefined，
    // 这里必须真删，不能留一条值为 undefined 的键 —— 否则「N 本书单独调过」会把它数进去。
    if (mem[key] === undefined) delete merged[key];
    else merged[key] = mem[key];
  }
  // 内存里有、库里没有的字段（新维度 / 老库缺字段）：只要是用户改过的就带上，别把它弄丢
  for (const key of Object.keys(mem)) {
    if (!(key in merged) && dirty.has(key)) merged[key] = mem[key];
  }
  return merged as T;
}

/** 合并结果与内存现值是否逐字段相同（相同就不用再写一次库：这是第 20 轮「不白写盘」口径的延续） */
export function isSameReadbackByFields(a: object, b: object, fields?: readonly string[] | null): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = fields ?? new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const key of keys) if (x[key] !== y[key]) return false;
  return Object.keys(x).length === Object.keys(y).length;
}
