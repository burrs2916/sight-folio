// 设置库健康自检（第二十一轮）
//
// 要解决的真问题：用户报「设置改完关掉软件再打开就没了」。第二十轮已经把**写库失败**做成可见
// （settingsSyncStore：状态读数 + 重试 + toast），但仍有一类情况看不穿 ——
// Rust 侧 `Database::new` 打开 config.db 失败时会**静默退回 `Connection::open_in_memory()`**
// （src-tauri/src/infrastructure/database/connection.rs）。此时前端每次 `set_setting` 都「成功」，
// 落盘状态一路显示「已自动保存」，但库是内存库，关掉进程即清空：重启后设置全部回到旧值。
// 生产包里 config.db 落在**可执行文件同级目录**，从只读 DMG、被移走的 .app、或每次换路径的构建
// 产物启动时，都会踩到这条静默退路。
//
// 判定口径（宁可漏报，绝不误报）：
//  ① 写一次探针 + 读回：写失败 / 读不回 / 读回的不是探针记录形态 = 设置库不可用
//     （非 Tauri 环境、IPC 故障）。**2026-11-03 起回显不再逐字比对本次 bootId**：
//     dev 的 StrictMode 会把挂载 effect 跑两遍、多窗口也各跑一个探针，后写的合法探针
//     盖掉先写的是常态不是故障 —— 逐字比对把这种并发误判成「连不上」（李先生当日
//     开机弹窗病灶，锁见 __tests__/settingsProbeRace.test.ts）。读回**任一合法探针
//     记录**即证明写读通道通；真故障（set/get 抛、写了读不回、内容被污染）照抓。
//     同窗口的并发由本文件的**单飞锁**收敛成一次自检（多窗口跨进程撞车由上面的
//     宽容回显兜住）；
//  ② **跨启动**判据：上次启动把 boot 标记同时写进设置库与本机 localStorage。本次启动若 localStorage
//     留着上次的标记、设置库却查不到任何探针，说明库没跨启动留住东西（内存库特征）。库里有探针
//     （哪怕 bootId 与本机标记不同）一律判 ok —— 多窗口各自写探针属正常，只有「整体消失」才能
//     证明没持久化，这条避免多窗口竞争造成误报。
//
// 探针键独立于设置项，且**刻意不走** settingsSyncStore.persistSettings：那层负责「用户改设置」的
// 落盘状态读数，诊断写入混进去会把「已自动保存」这句话变得不可信。
import { create } from 'zustand';
import { settingsApi } from '../services/tauri';
import { t } from '../i18n';
import { useToastStore } from './toastStore';
import {
  getLateReadbackSnapshot,
  subscribeLateReadbacks,
  resetLateReadbacks,
  type LateReadbackSnapshot,
} from './settingsReadbackGuard';

/** 探针在设置库里的键（不是设置项，不参与设置导出/导入） */
export const SETTINGS_PROBE_KEY = 'settings_probe';
/** 本机上一次启动的 boot 标记（localStorage：与设置库互为对照，才能看出库有没有跨启动留住东西） */
const LAST_BOOT_STORAGE_KEY = 'settings_probe_last_boot';

export type SettingsHealthStatus = 'unknown' | 'ok' | 'unavailable' | 'not_persisted';

interface ProbeRecord {
  /** 本次启动生成的随机标记 */
  bootId: string;
  /** 写入时刻（Unix ms），界面据此说明「探针是什么时候打的」 */
  at: number;
}

interface SettingsHealthState {
  status: SettingsHealthStatus;
  /** 自检完成时刻；null = 还没跑过 */
  checkedAt: number | null;
  /** 设置库中是否读到了上一次启动留下的探针（诊断用读数） */
  probeRestored: boolean;
  /**
   * 后端自报的数据库落点（第二十三轮）。null = 这条命令不可用（老后端 / 非桌面环境），
   * 界面此时不显示这一行，而不是显示一个空路径让人以为设置不存在。
   */
  dbLocation: string | null;
  /** 后端自报「这次是不是文件库」。null 同上；false = 内存库，改动关掉进程即丢 */
  dbPersistent: boolean | null;
  /**
   * 本次启动的**设置读回迟到**账（第三十五轮）。
   *
   * 与上面那几个读数不是一回事：探针说的是「这台机器的库留不留得住」，这一格说的是
   * 「本次启动有一批库读数回来晚了，而软件有没有把它们按字段并回来而不是整份盖掉」。
   * 第三十四轮修完行为后这件事只剩 console 里没有，用户看到的就是「我点了它没跳回去」——
   * 观感和「设置没生效」一模一样，只是这次数据是对的。界面必须把这句实话补上。
   */
  lateReadbacks: LateReadbackSnapshot;
  /** 跑一次启动自检（App 挂载时调一次；重复调用会重新读数，供「重试」入口复用） */
  probe: () => Promise<void>;
  /** 清空自检读数（回归用例用）：连本机对照标记一起清掉，否则重放自检会误报 not_persisted */
  reset: () => void;
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    // 隐私模式 / WebView 存储被禁：读不到就当没有标记，不能因此报错
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage?.setItem(key, value);
  } catch {
    /* 同上：localStorage 不可用时静默放弃，判据会退化成「不报 not_persisted」 */
  }
}

function removeStorage(key: string): void {
  try {
    localStorage?.removeItem(key);
  } catch {
    /* 同上：清不掉不影响判定走向（最坏是多报一次 not_persisted，仍偏向说实话） */
  }
}

/** 本次启动的 boot 标记（同一窗口内稳定，多窗口各自不同 —— 见文件头对误报的处理） */
function newBootId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 合法探针记录形态（2026-11-03 判据改形）：并发环境下回显很可能是**别的窗口/别的挂载**
 * 写的记录，形态正确即证明写读通道通；只有形态不对（被污染）才是库的问题。
 */
function isProbeRecord(v: unknown): v is ProbeRecord {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ProbeRecord).bootId === 'string' &&
    typeof (v as ProbeRecord).at === 'number'
  );
}

/**
 * 后端自报的落点读数：拿不到就返回 null（老后端没这条命令 / 非桌面环境 / IPC 失败）。
 * 这条通道只是「多说一句实话」，任何失败都不该影响探针本身，所以整段吞掉异常。
 */
async function readDatabaseStatus(): Promise<{ persistent: boolean; location: string } | null> {
  try {
    // 老后端的 settingsApi 上没有这个方法（单测里的 mock 也没有）：按「拿不到」处理
    const fn = settingsApi.databaseStatus;
    if (typeof fn !== 'function') return null;
    const status = await fn.call(settingsApi);
    if (!status || typeof status.location !== 'string') return null;
    return { persistent: Boolean(status.persistent), location: status.location };
  } catch {
    return null;
  }
}

export const useSettingsHealthStore = create<SettingsHealthState>((set) => {
  /**
   * 单飞锁（2026-11-03）：dev 的 StrictMode 双挂载、健康条「重试」连点都会让 probe 被并发调用，
   * 同窗口两个探针互踩既浪费写也制造回显竞态。并发调用合流到同一次自检；结束后释放，
   * 「重试」在上一轮真正落地前拿到的就是这同一轮的结果（探针本来就是本次启动口径）。
   */
  let probeInFlight: Promise<void> | null = null;

  const doProbe = async (): Promise<void> => {
    const lastBootId = readStorage(LAST_BOOT_STORAGE_KEY);
    // 先取后端自报的落点：这条比探针更硬 —— 进程内部才知道库究竟开在文件还是内存里，
    // 探针只能从「跨启动有没有留住」反推。读数同时喂给界面那句「设置存在哪儿」。
    const db = await readDatabaseStatus();
    set({ dbLocation: db?.location ?? null, dbPersistent: db?.persistent ?? null });
    if (db && db.persistent === false) {
      set({ status: 'not_persisted', checkedAt: Date.now(), probeRestored: false });
      notifyDegraded('not_persisted');
      return;
    }
    let record: ProbeRecord | null = null;
    try {
      const saved = await settingsApi.get(SETTINGS_PROBE_KEY);
      record = saved ? (JSON.parse(saved) as ProbeRecord) : null;
    } catch (error) {
      console.error('[SettingsHealth] 读取设置库探针失败:', error);
      set({ status: 'unavailable', checkedAt: Date.now(), probeRestored: false });
      notifyDegraded('unavailable');
      return;
    }

    // ① 写读回：写不进去 / 读不回 / 读回的不再是探针记录 = 设置库现在就用不了。
    // 回显**不逐字比对本次 bootId**（2026-11-03 判据改形）：多窗口并发探针、后写的合法
    // 记录盖掉先写的是常态；读到谁的合法记录都证明写读通道通。真故障照样露馅：
    // set/get 抛走 catch，「写了读不回」是 null，库内容被污染则形态不对。
    const bootId = newBootId();
    const at = Date.now();
    try {
      await settingsApi.set(SETTINGS_PROBE_KEY, JSON.stringify({ bootId, at }));
      const echoed = await settingsApi.get(SETTINGS_PROBE_KEY);
      if (!echoed || !isProbeRecord(JSON.parse(echoed))) {
        set({ status: 'unavailable', checkedAt: at, probeRestored: false });
        notifyDegraded('unavailable');
        return;
      }
    } catch (error) {
      console.error('[SettingsHealth] 写设置库探针失败:', error);
      set({ status: 'unavailable', checkedAt: at, probeRestored: false });
      notifyDegraded('unavailable');
      return;
    }

    // ② 跨启动判据：本机有上次标记，库里却连一份探针都没有 = 库没跨启动持久化
    if (lastBootId && !record) {
      writeStorage(LAST_BOOT_STORAGE_KEY, bootId);
      set({ status: 'not_persisted', checkedAt: at, probeRestored: false });
      notifyDegraded('not_persisted');
      return;
    }

    writeStorage(LAST_BOOT_STORAGE_KEY, bootId);
    set({ status: 'ok', checkedAt: at, probeRestored: Boolean(record) });
  };

  return {
    status: 'unknown',
    checkedAt: null,
    probeRestored: false,
    dbLocation: null,
    dbPersistent: null,
    // 初始就取一次快照，而不是等订阅回调：七个域的 init 比这个模块被加载更早，
    // 迟到事件很可能**已经发生过了**（首帧门控 1500ms 一过界面就能点）。只等推送会漏报。
    lateReadbacks: getLateReadbackSnapshot(),

    probe: () => {
      if (!probeInFlight) {
        probeInFlight = doProbe().finally(() => {
          probeInFlight = null;
        });
      }
      return probeInFlight;
    },

    reset: () => {
      // 单飞锁一并释放：reset 的用途是让回归用例可重放（生产侧没有调用点），
      // 不释放的话「上一轮还没落地就 reset」会把下一条用例的 probe 吞成旧结果。
      probeInFlight = null;
      // 本机对照标记（localStorage）也在 reset 里一起清掉：「跨启动没留住」这条判据的成立前提是
      // 「本机有上次的标记、库里却连一份探针都没有」。标记不清，重放自检时上一次 probe 刚写进去的
      // bootId 会让本次探针（库里刚被清空）被判成 not_persisted —— 这个误报只会出现在**同一进程内
      // 重复跑 reset + probe** 的场合（回归用例正是这种跑法），生产侧每个窗口启动只 probe 一次。
      // 因此清标记换到的是「自检可重放」，不会削弱真实场景里的诊断能力。
      removeStorage(LAST_BOOT_STORAGE_KEY);
      // 迟到读回账的**真源在 guard**（模块级计数），这里一并清掉：reset 的用途是让回归用例可重放，
      // 只清镜像不清真源，下一条用例仍会读到上一条留下的次数。生产侧没有任何地方调 reset
      // （App 只调 probe），所以清源不会抹掉真实用户本次启动的读数。
      resetLateReadbacks();
      set({
        status: 'unknown',
        checkedAt: null,
        probeRestored: false,
        dbLocation: null,
        dbPersistent: null,
        lateReadbacks: getLateReadbackSnapshot(),
      });
    },
  };
});

/**
 * 降级提示只在自检结果变化时弹一次（应用启动只跑一次 probe，天然不刷屏）。
 * 只警告不阻断：界面照常可改可看，差别只是「这次改的东西可能记不住」，
 * 但这句话必须由软件主动说，而不是等用户重启后自己发现。
 */
function notifyDegraded(status: 'unavailable' | 'not_persisted'): void {
  useToastStore
    .getState()
    .warning(status === 'unavailable' ? t('settings.healthUnavailable') : t('settings.healthNotPersisted'));
}

/**
 * 把 guard 的迟到读回账推进来（第三十五轮）。
 *
 * 为什么订阅而不是让界面自己去读 guard：健康条要在「已经画完之后」某次读回迟到时自己冒出来，
 * 直接读模块级变量 React 不会重渲染。为什么不反过来让 guard 写这个 store：那会让竞态防护模块
 * 反向依赖界面层读数，而它的真源只能是「有没有发生过迟到」这一件事。
 */
subscribeLateReadbacks(() => {
  useSettingsHealthStore.setState({ lateReadbacks: getLateReadbackSnapshot() });
});
