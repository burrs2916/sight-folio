// sight-folio: 语音输入封装（Web Speech API / SpeechRecognition）。
//
// 方案 A：纯前端、无后端依赖，macOS（Tauri WKWebView，Safari/WebKit 内核）与
// Windows（Tauri WebView2，Chromium 内核）都支持 `SpeechRecognition` 或
// `webkitSpeechRecognition` 前缀实现。
//
// 职责：平台支持检测 + 识别器创建 + 事件归一（结果/结束/错误回调）。
// 不做 UI，不持有 React 状态——由调用方（输入条组件）管理按钮与文案。

/** Web Speech API 的最小接口（TS DOM lib 未内置 SpeechRecognition，这里按标准补全） */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

/** 构造器形态（window.SpeechRecognition 或 window.webkitSpeechRecognition） */
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 当前环境是否支持语音识别（macOS WKWebView / Windows WebView2 均可用，探测不到则隐藏入口） */
export function isSpeechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

/** 从事件结果中提取最终（isFinal）拼接文本；无最终片段返回空串 */
export function collectFinalTranscript(ev: SpeechRecognitionEventLike): string {
  let out = '';
  for (let i = 0; i < ev.results.length; i++) {
    const r = ev.results[i];
    if (!r.isFinal || r.length === 0) continue;
    const alt = r[0];
    if (alt?.transcript) out += alt.transcript;
  }
  return out.trim();
}

// ─── 麦克风权限探测与申请 ───
// Web Speech API 不负责授权：未授权时直接 rec.start() 会抛 not-allowed 报错。
// 这里先用 permissions.query 探测、getUserMedia 实测拉起系统/浏览器授权弹窗，
// 授权成功立即释放媒体流（SpeechRecognition 独立拾音，无需持有流），
// 保证「点击语音 → 先拿权限 → 再开始识别」，而不是点击即报错。

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** 查询麦克风权限状态（不触发授权弹窗）；浏览器未暴露该能力时返回 'unsupported' */
export async function queryMicPermission(): Promise<MicPermissionState> {
  try {
    const perms = navigator.permissions;
    if (!perms || typeof perms.query !== 'function') return 'unsupported';
    // TS DOM lib 未收录 'microphone' 权限名，按标准实现 cast
    const status = await perms.query({ name: 'microphone' } as unknown as PermissionDescriptor);
    return (status.state ?? 'prompt') as MicPermissionState;
  } catch {
    return 'unsupported';
  }
}

/** 主动申请麦克风权限（getUserMedia 实测会拉起系统/浏览器授权弹窗），成功即释放媒体流 */
export async function requestMicPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  try {
    const md = navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') return 'unsupported';
    const stream = await md.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'denied'; // 用户拒绝 / 系统未授权 / 非安全上下文
    }
    return 'unsupported'; // 无麦克风设备、媒体能力不可用等
  }
}

/**
 * 「点击语音」入口的统一权限保障，返回：
 * - 'granted'    已授权，可直接开始识别
 * - 'denied'     用户/系统明确拒绝，调用方展示引导
 * - 'fallthrough' 无法探测也无法申请（如无 mediaDevices），交给 SpeechRecognition 自行弹窗/报错
 */
export async function ensureMicPermission(): Promise<'granted' | 'denied' | 'fallthrough'> {
  const state = await queryMicPermission();
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  // prompt（未决，应弹授权窗）或 unsupported（探测不可用）→ 尝试实测申请
  const result = await requestMicPermission();
  if (result === 'granted') return 'granted';
  if (result === 'denied') return 'denied';
  return 'fallthrough';
}

/**
 * macOS：主动请求系统「语音识别」权限（Web Speech API 在 macOS 走 SFSpeechRecognizer，
 * 对应独立的 TCC 权限项，与「麦克风」无关）。
 *
 * 返回：
 * - 'authorized'    已授权，可开始识别
 * - 'denied'        用户拒绝 → 调用方展开引导（此时设置里已有条目，可引导去打开）
 * - 'notDetermined' / 'restricted' → 同样视为未放行，调用方展开引导
 * - 'needs-app-launch' 当前以非 LaunchServices 形态启动（终端/Cursor 直接运行裸二进制），
 *   系统 TCC 判定为非法进程。此时**绝不能继续调用 SpeechRecognition.start()**：
 *   WebKit 会在 start() 内部代发 SFSpeechRecognizer 授权请求（崩溃栈为
 *   __TCCAccessRequest_block_invoke → __TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__），
 *   TCC 直接以 SIGABRT 终止整个应用。调用方必须展开"请用 .app 启动"引导并中止流程。
 * - 'unsupported'  当前环境无该 Tauri command（浏览器预览 / 非 macOS / 其它错误）→ 跳过，走原流程
 */
export async function requestSpeechAuthorization(): Promise<
  'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'needs-app-launch' | 'unsupported'
> {
  // 非 Tauri 环境（浏览器预览 / 静态托管）无后端 command，直接跳过。
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return 'unsupported';
  }
  try {
    // 动态引入：仅在本函数被调用时加载，避免模块顶层强依赖 Tauri 运行时。
    const { invoke } = await import('@tauri-apps/api/core');
    const st = await invoke<string>('request_speech_authorization');
    const s = st as 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'needs-app-launch' | 'unsupported';
    return s ?? 'unsupported';
  } catch (err) {
    // Rust 侧闸门用错误码「launch-must-be-bundled」拦截非法启动形态（见 speech.rs）：
    // 必须原样透传给调用方做拦截，绝不能吞成 unsupported 后继续 start()。
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('launch-must-be-bundled') || msg.includes('no-bundle')) {
      return 'needs-app-launch';
    }
    return 'unsupported';
  }
}

export interface SpeechInputHooks {
  onResult?: (finalText: string) => void;
  onError?: (errorCode: string, detail?: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export interface SpeechInputController {
  /** 开始识别；已启动时忽略，避免 InvalidStateError 崩溃 */
  start(): void;
  /** 手动结束（触发最终结果回调） */
  stop(): void;
  /** 取消识别（丢弃结果） */
  cancel(): void;
}

/** 创建语音识别控制器；当前环境不支持时返回 null（调用方据此隐藏按钮） */
export function createSpeechInput(lang: string, hooks: SpeechInputHooks): SpeechInputController | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  let started = false;

  rec.onresult = (ev) => {
    const text = collectFinalTranscript(ev);
    if (text) hooks.onResult?.(text);
  };
  rec.onerror = (ev) => {
    hooks.onError?.(ev.error, ev.message ?? '');
  };
  rec.onend = () => {
    started = false;
    hooks.onEnd?.();
  };
  rec.onstart = () => {
    started = true;
    hooks.onStart?.();
  };

  return {
    start() {
      if (started) return;
      try {
        rec.start();
      } catch {
        // 某些引擎在未授权或重复调用时会同步抛错；交给 onerror/onend 兜底，不向上炸
        hooks.onEnd?.();
      }
    },
    stop() {
      if (!started) return;
      try {
        rec.stop();
      } catch {
        // ignore
      }
    },
    cancel() {
      if (!started) return;
      try {
        rec.abort();
      } catch {
        // ignore
      }
    },
  };
}
