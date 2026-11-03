// 设置落盘的「可信层」（第二十轮）
//
// 病灶（第十九轮台账待办 1）：外观域五个 store 的 persist 都是
// `settingsApi.set(...).catch(console.error)`。写库失败时（非 Tauri 环境 / IPC 超时 / 库被占）
// 界面照样立刻变、抽屉底部照样写着「自动保存：每项设置即时生效」，作者关掉软件再打开才发现
// 没记住 —— 这句提示在失败时是**不诚实的**，而 console.error 对创作者等于没有提示。
//
// 本模块把「写设置库」收口成一个动作，做三件事：
//  ① 失败自动重试一次（写库失败最常见的原因是瞬时占用/瞬时超时，一次重试能吃掉绝大多数）；
//  ② 把每个 scope 的真实状态（保存中 / 已保存 / 失败）留在内存里，界面据此显示诚实文案，
//     并支持「重试」按钮把手动重放（重放用的是最后一次想写的值，不需要用户再点一遍设置）；
//  ③ 重试仍失败才弹一次 toast，并做节流 —— 拖一下字号滑杆会连着触发十几次写入，
//     不能因此刷一屏错误提示。
//
// 依赖方向：外观各 store → 本模块 → services/tauri(settingsApi) + toastStore + i18n。
// 本模块**不**反向 import 任何外观 store，避免循环依赖。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { useToastStore } from './toastStore';
import { t } from '../i18n';

/** 外观/设置域里会写设置库的写入方（与设置库 KV 键一一对应） */
export type SettingsScope =
  | 'theme'
  | 'layout'
  | 'typography'
  | 'language'
  | 'appearance'
  | 'writing'
  /** 书级排版覆盖（第三十轮 P1）：整张表一个键 writing_typography_books，不与全局默认共用 scope */
  | 'typographyBooks';

/** 单个 scope 的落盘状态：idle = 本次启动还没写过 */
export type SettingsSyncStatus = 'idle' | 'pending' | 'saved' | 'failed';

/** 失败时留住「本来想写什么」，让重试按钮能重放同一次写入 */
export interface PendingWrite {
  key: string;
  value: string;
}

/** 写库失败后的一次自动重试间隔：太短等于没给瞬时故障留出恢复时间，太长会让界面长时间挂「保存中」 */
const RETRY_DELAY_MS = 500;
/** 失败 toast 的节流窗口：连续调整设置时只提醒一次，不把界面变成报错刷屏 */
const TOAST_THROTTLE_MS = 15000;

let lastToastAt = 0;

function notifyFailureOnce(): void {
  const now = Date.now();
  if (now - lastToastAt < TOAST_THROTTLE_MS) return;
  lastToastAt = now;
  useToastStore.getState().warning(t('settings.persistFailedToast'));
}

/** 单次写入：失败后等一小段时间再试一次，返回最终是否成功 */
async function writeWithRetry(key: string, value: string): Promise<boolean> {
  try {
    await settingsApi.set(key, value);
    return true;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      await settingsApi.set(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

interface SettingsSyncState {
  status: Record<SettingsScope, SettingsSyncStatus>;
  /** 最近一次「确实写进设置库」的时间；界面用它把「自动保存」这句话变成可核对的事实 */
  lastSavedAt: number | null;
  lastErrorScope: SettingsScope | null;
  /** 写库失败待重放的写入（key/value 是本来要落盘的内容） */
  failedWrites: Partial<Record<SettingsScope, PendingWrite>>;

  /** 记录一次写入尝试并落库（fire-and-forget：调用方是 store 的同步 action，不能 await） */
  persist: (scope: SettingsScope, key: string, value: string) => void;
  /**
   * 可等待版写入（第二十一轮，供「导入设置备份」用）：与 persist 同一套状态读数与重试，
   * 但把最终结果还给调用方 —— 恢复一批设置必须知道哪一项真写进去了，才能如实报
   * 「已恢复 N 项 / M 项没写进去」，也要等真落库成功后再让各 store 读回。
   */
  persistAndWait: (scope: SettingsScope, key: string, value: string) => Promise<boolean>;
  /** 手动重放所有失败的写入（抽屉底部「重试」按钮） */
  retryFailed: () => void;
  /** 测试/退出登录等场景清空读数 */
  reset: () => void;
}

const IDLE_STATUS: Record<SettingsScope, SettingsSyncStatus> = {
  theme: 'idle',
  layout: 'idle',
  typography: 'idle',
  language: 'idle',
  appearance: 'idle',
  // 写作偏好（第二十四轮）：漏了这一格，overallStatus 汇总时该域永远读不到读数，
  // 抽屉底部那句「已自动保存」就会对写作偏好说不准。
  writing: 'idle',
  // 书级排版覆盖（第三十轮 P1）：同一条铁律 —— 少这一格，这一域写库成功/失败都进不了
  // 抽屉底部那句状态汇总，「已自动保存」又会对排版说不准。
  typographyBooks: 'idle',
};

export const useSettingsSyncStore = create<SettingsSyncState>((set, get) => ({
  status: { ...IDLE_STATUS },
  lastSavedAt: null,
  lastErrorScope: null,
  failedWrites: {},

  persist: (scope, key, value) => {
    void get().persistAndWait(scope, key, value);
  },

  persistAndWait: async (scope, key, value) => {
    set((s) => ({
      status: { ...s.status, [scope]: 'pending' },
      // 本次写入接管该 scope：上一轮的失败记录作废（用户已经改了新值）
      failedWrites: { ...s.failedWrites, [scope]: undefined },
    }));
    const ok = await writeWithRetry(key, value);
    if (ok) {
      set((s) => ({
        status: { ...s.status, [scope]: 'saved' },
        lastSavedAt: Date.now(),
        lastErrorScope: s.lastErrorScope === scope ? null : s.lastErrorScope,
        failedWrites: { ...s.failedWrites, [scope]: undefined },
      }));
      return true;
    }
    set((s) => ({
      status: { ...s.status, [scope]: 'failed' },
      lastErrorScope: scope,
      failedWrites: { ...s.failedWrites, [scope]: { key, value } },
    }));
    notifyFailureOnce();
    return false;
  },

  retryFailed: () => {
    const entries = (Object.entries(get().failedWrites) as [SettingsScope, PendingWrite | undefined][]).filter(
      (entry): entry is [SettingsScope, PendingWrite] => Boolean(entry[1]),
    );
    for (const [scope, write] of entries) get().persist(scope, write.key, write.value);
  },

  reset: () => {
    // 连 toast 节流一起清掉：回归测试要能重复观察「失败提示只弹一次」这条口径，
    // 生产侧没有调用点，留着旧值也不会影响界面。
    lastToastAt = 0;
    set({ status: { ...IDLE_STATUS }, lastSavedAt: null, lastErrorScope: null, failedWrites: {} });
  },
}));

/**
 * 汇总给界面的一句话状态：任一 scope 没救回来就报失败，其次是有 scope 正在写。
 * 纯函数、收读数而不是整个 state —— 组件里按字段订阅（status / lastSavedAt 各一个原子读数）
 * 再调它，避免 zustand 选择器每次返回新对象触发 useSyncExternalStore 的无限重渲染。
 */
export function overallStatus(
  status: Record<SettingsScope, SettingsSyncStatus>,
  lastSavedAt: number | null,
): { status: SettingsSyncStatus; failedCount: number } {
  const values = Object.values(status);
  const failedCount = values.filter((v) => v === 'failed').length;
  if (failedCount > 0) return { status: 'failed', failedCount };
  if (values.some((v) => v === 'pending')) return { status: 'pending', failedCount };
  if (lastSavedAt) return { status: 'saved', failedCount };
  return { status: 'idle', failedCount };
}

/**
 * 外观各 store 的统一写入口。
 * 之所以是模块级函数而不是 hook：调用点在 zustand action 内部（非组件），
 * 且它只读 store 的 getState，不需要订阅。
 */
export function persistSettings(scope: SettingsScope, key: string, value: string): void {
  useSettingsSyncStore.getState().persist(scope, key, value);
}
