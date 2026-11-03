import { invoke } from './core';

/**
 * 设置库前端入口。
 *
 * ── 两条通道，判据只有一个：进程里有没有 Tauri 的 IPC 桥 ──────────────────
 *  ① 桌面壳内（`window.__TAURI_INTERNALS__` 存在）→ 一律走 `invoke`，落到 SQLite 的
 *     `user_settings` 表。**这条通道上的任何失败都原样 reject**，绝不退到浏览器存储：
 *     真故障一旦被判成"兜底成功"，健康条就会对着一个已经丢掉整套设置的进程说"没问题"，
 *     那是本仓第 23 轮专门立 `get_database_status` 要消灭的那类谎（静默退内存、界面照说已保存）。
 *  ② 纯浏览器（`npm run dev` 后用浏览器直开 23010 / 静态站）→ IPC 桥根本不存在，
 *     `core.ts` 的守卫会把每个命令都 reject 掉，于是设置域七个域全部读不回、健康条弹
 *     「当前环境连不上设置库（非桌面应用 / IPC 不可用）」，用户在浏览器里怎么改都是空的。
 *     这不是故障，是环境本来就没有后端 —— 本文件从这里开始给它一条**同形状**的
 *     localStorage 兜底通道，让浏览器里也能改设置、读回、跑健康自检。
 *
 * 兜底通道的边界（写给下一个读这段代码的人，别把它当成"设置库的另一份真源"）：
 *  · 只在 ① 判假时启用，桌面壳内永不参与；
 *  · 它是**浏览器站点数据**，不进应用备份导出、不是 `config.db`，`databaseStatus()` 的
 *    location 会直说 `(browser localStorage)`，健康条那行「设置库存放位置」因此不说谎；
 *  · 它**不广播**：跨窗口同步走的是 Tauri 事件（见 `settingsSyncStore`），浏览器多标签之间
 *    只共享存储不共享推送，所以浏览器里两个窗口可能一个新一旧 —— 这是既定限制，不是回归。
 */

/** 是否运行在 Tauri 桌面壳内。每次调用现取，不在模块加载时定死（jsdom 用例要能切） */
function inTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 浏览器兜底通道的键前缀：与界面里那些 `workbench.*` / `ps.*` 散装键隔开 */
export const BROWSER_SETTINGS_PREFIX = 'sightfolio.settings:';

const browserKey = (key: string): string => `${BROWSER_SETTINGS_PREFIX}${key}`;

/**
 * 取可用的 localStorage。
 * Safari 隐私模式下 `localStorage` 对象存在但一动就抛，所以这里探一次再交出去；
 * 探不到就返回 null，让调用方 reject —— 兜底通道也不可用时，健康条必须说真话。
 */
function browserStore(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    localStorage.getItem(browserKey('__probe__'));
    return localStorage;
  } catch {
    return null;
  }
}

function rejectNoBrowserStore(op: string, key: string): never {
  throw new Error(
    `[settings] 非桌面环境且浏览器存储不可用，${op} "${key}" 失败（隐私模式 / 存储被禁）。请在桌面应用内使用：npm run tauri dev`,
  );
}

/** 只打一次的开发期提示：浏览器兜底不是桌面设置库，别把这里的读数当成真库验证过 */
let browserModeNoticeShown = false;
function noticeBrowserMode(): void {
  if (browserModeNoticeShown || typeof console === 'undefined') return;
  browserModeNoticeShown = true;
  console.info('[settings] 未检测到 Tauri IPC，设置已切到浏览器 localStorage 兜底通道（非应用设置库，不进备份导出）。');
}

export const settingsApi = {
  async get(key: string): Promise<string | null> {
    if (inTauriShell()) return invoke<string | null>('get_setting', { key });
    noticeBrowserMode();
    const store = browserStore();
    if (!store) rejectNoBrowserStore('读取', key);
    return store.getItem(browserKey(key));
  },

  async set(key: string, value: string): Promise<void> {
    if (inTauriShell()) return invoke<void>('set_setting', { key, value });
    noticeBrowserMode();
    const store = browserStore();
    if (!store) rejectNoBrowserStore('写入', key);
    store.setItem(browserKey(key), value);
  },

  async delete(key: string): Promise<void> {
    if (inTauriShell()) return invoke<void>('delete_setting', { key });
    noticeBrowserMode();
    const store = browserStore();
    if (!store) rejectNoBrowserStore('删除', key);
    store.removeItem(browserKey(key));
  },

  /**
   * 后端自报的设置库落点（Rust `get_database_status`）。
   *
   * 为什么要这条命令：`connection` 在打不开磁盘库时会**静默退回内存库**，
   * 界面却照常显示「设置已保存」—— 用户重启才发现整套设置没了，这就是「关软件设置就没了」
   * 最难自查的一种成因。前端 `store/settingsHealthStore.ts` 用它把落点摊到设置抽屉的健康条上。
   *
   * 浏览器兜底通道下没有后端可问，直接自报真实落点：`persistent` 说的是"关页面重开还在不在"
   * （localStorage 成立），`location` 明写 `(browser localStorage)`，不冒充 `config.db`。
   */
  async databaseStatus(): Promise<{ persistent: boolean; location: string }> {
    if (inTauriShell()) return invoke<{ persistent: boolean; location: string }>('get_database_status');
    noticeBrowserMode();
    const store = browserStore();
    if (!store) rejectNoBrowserStore('读取数据库状态', 'database_status');
    return { persistent: true, location: '(browser localStorage)' };
  },
};
