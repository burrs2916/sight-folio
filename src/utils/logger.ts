import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp?: number;
}

const logQueue: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 1000;
const MAX_QUEUE_SIZE = 20;

const isProduction = import.meta.env.PROD;

/** `logger.throttled` 的每 key 上次输出时间戳（仅开发期使用） */
const throttleMarks = new Map<string, number>();

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushLogs();
  }, FLUSH_INTERVAL);
}

async function flushLogs() {
  if (logQueue.length === 0) return;
  const batch = logQueue.splice(0, logQueue.length);
  try {
    await invoke("write_log_batch", { entries: batch });
  } catch (e) {
    console.error("[Logger] Failed to flush logs:", e);
  }
}

function enqueue(entry: LogEntry) {
  logQueue.push(entry);
  if (logQueue.length >= MAX_QUEUE_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushLogs();
  } else {
    scheduleFlush();
  }
}

function createEntry(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): LogEntry {
  return {
    level,
    module,
    message,
    data,
    timestamp: Date.now(),
  };
}

export const logger = {
  debug(module: string, message: string, data?: Record<string, unknown>) {
    if (isProduction) return;
    const entry = createEntry("debug", module, message, data);
    enqueue(entry);
    console.debug(`[${module}] ${message}`, data ?? "");
  },

  info(module: string, message: string, data?: Record<string, unknown>) {
    if (isProduction) return;
    const entry = createEntry("info", module, message, data);
    enqueue(entry);
    console.info(`[${module}] ${message}`, data ?? "");
  },

  warn(module: string, message: string, data?: Record<string, unknown>) {
    const entry = createEntry("warn", module, message, data);
    enqueue(entry);
    console.warn(`[${module}] ${message}`, data ?? "");
  },

  error(module: string, message: string, data?: Record<string, unknown>) {
    const entry = createEntry("error", module, message, data);
    enqueue(entry);
    console.error(`[${module}] ${message}`, data ?? "");
  },

  /**
   * 渲染热路径专用：**惰性 + 限频**的 info 日志。
   *
   * 为什么需要它（R37 卡顿攻坚）：画布的 `visibleEntityIds`、`fit` 计算这类
   * useMemo/useEffect 会随平移缩放每帧重算，里面原本直接写 `logger.info(...)`。
   * 三重代价叠在一起：
   *   1. 参数对象是**立即求值**的 —— 哪怕日志最终没人看，`Array.from(ids).slice(0,3)`
   *      这种表达式也会为 500 个实体先分配一个 500 长度数组；
   *   2. `enqueue` 每满 20 条就立刻 `invoke("write_log_batch")`，平移一秒钟能打出
   *      几十条 → 前端与 Rust 之间持续的 IPC 往返；
   *   3. `console.info` 携带对象时 devtools 会保留引用并做结构化格式化，本身就不便宜。
   *
   * 这里把 data 改成 thunk（不触发就不求值），并按 key 限频。热路径被限流时的
   * 代价只剩「一次 Map 查找 + 一次 Date.now()」。
   *
   * @param key    限频键（同一 key 共享节流窗口）
   * @param minIntervalMs 最小间隔，默认 2s
   */
  throttled(
    key: string,
    module: string,
    message: string,
    dataFn?: () => Record<string, unknown>,
    minIntervalMs = 2000
  ) {
    if (isProduction) return;
    const now = Date.now();
    const last = throttleMarks.get(key);
    if (last !== undefined && now - last < minIntervalMs) return;
    throttleMarks.set(key, now);
    const data = dataFn?.();
    enqueue(createEntry("info", module, message, data));
    console.info(`[${module}] ${message}`, data ?? "");
  },

  async flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushLogs();
  },

  async getLogDir(): Promise<string> {
    return invoke<string>("get_log_dir_path");
  },
};

export default logger;
