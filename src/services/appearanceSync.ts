// 外观设置跨窗口同步（第十九轮）
//
// 病灶：写作台 / 代码工作台是**独立 webview 窗口**，各自跑一份 store。设置库虽是唯一真源，
// 但只在「窗口启动时」被 init() 读一次 —— 于是主窗口把主题从浅色改成深色后，已经开着的
// 写作台窗口仍是浅色，用户看到的就是「设置改了三遍另一边不生效」。业务数据侧早就有
// content-saved / book-meta-changed 这类广播范式，外观域一直缺一条，本模块补上。
//
// 口径：
//  ① 写盘方在 persist 的同一处广播「已生效的完整配置」，接收方直接 hydrate，
//     不再回读设置库（避免读到尚未落库的旧值）。
//  ② 接收方只改内存、绝不回写设置库（见各 store 的 hydrate），因此不存在回声循环。
//  ③ 非 Tauri 环境（vite dev 直开 / vitest）静默跳过：设置本身仍在本窗口生效，
//     不能因为没有 IPC 就把整条链路报错给作者看。
import { emit, listen } from '@tauri-apps/api/event';

/** 外观域广播事件名（各窗口共用） */
export const APPEARANCE_CHANGED_EVENT = 'appearance-changed';

/**
 * 设置域里需要跨窗口即时跟随的子项：广播时带上 scope，接收方只 hydrate 对应的那一份。
 * 'writing'（写作偏好）为第二十四轮新增 —— 专注模式 / 打字机滚动 / 保存节奏这些行为，
 * 主窗口改了，正开着的写作台窗口必须同一时刻跟着变，否则两边写的书是两套手感。
 * 'typographyBooks'（书级排版覆盖）为第三十轮 P1 新增：写作台正是独立窗口，
 * 「这本书单独调过的字号 / 纸色」如果只在发起窗口生效，两边同一本书就是两套排版。
 */
export type AppearanceScope = 'theme' | 'layout' | 'typography' | 'language' | 'writing' | 'typographyBooks';

export interface AppearanceChangedPayload {
  scope: AppearanceScope;
  /** 已生效的完整配置（ThemeConfig / LayoutConfig / BookTypography / Lang / 书级覆盖表 之一） */
  config: unknown;
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 广播一次外观配置变化；非 Tauri 环境与广播失败都静默忽略（不影响本窗口生效与落库）。 */
export function broadcastAppearanceChange(scope: AppearanceScope, config: unknown): void {
  if (!inTauri()) return;
  emit(APPEARANCE_CHANGED_EVENT, { scope, config } satisfies AppearanceChangedPayload).catch(() => {
    /* 广播失败只影响其它窗口的即时跟随，设置本身已在本窗口生效并落库 */
  });
}

/**
 * 订阅其它窗口的外观配置变化，返回注销函数。
 * 订阅是异步建立的（listen 返回 Promise），组件可能在建立前就卸载 —— 用 cancelled 标记
 * 把后到的 unlisten 立刻注销掉，避免留下没人回收的监听器。
 */
export function subscribeAppearanceChanges(handler: (payload: AppearanceChangedPayload) => void): () => void {
  if (!inTauri()) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  listen<AppearanceChangedPayload>(APPEARANCE_CHANGED_EVENT, (e) => handler(e.payload))
    .then((u) => {
      if (cancelled) u();
      else unlisten = u;
    })
    .catch(() => {
      /* 订阅不上等于没有跨窗口跟随，本窗口照常工作 */
    });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
