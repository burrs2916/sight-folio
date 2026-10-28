// sight-folio: speechInput（Web Speech API 封装）单元测试。
// 覆盖：平台支持检测（macOS WKWebView / Windows WebView2 两种前缀）、
// 结果提取（只取 isFinal 片段）、控制器生命周期（start/stop/cancel 防重入、错误兜底回调）。
// 纯逻辑测试：jsdom 下桩掉 window 级构造器，不依赖真实麦克风。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isSpeechRecognitionSupported,
  createSpeechInput,
  collectFinalTranscript,
  queryMicPermission,
  requestMicPermission,
  ensureMicPermission,
  requestSpeechAuthorization,
  type SpeechRecognitionLike,
  type SpeechRecognitionEventLike,
} from '../speechInput';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import * as tauriCore from '@tauri-apps/api/core';

/** 可编程桩 SpeechRecognition 构造器，实例挂回调与状态，供断言回调次序 */
class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((e: { error: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognition.instances.push(this);
  }
}

function lastInst(): FakeRecognition {
  const i = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  if (!i) throw new Error('FakeRecognition 尚未实例化');
  return i;
}

function installCtor(name: 'SpeechRecognition' | 'webkitSpeechRecognition') {
  const w = window as unknown as Record<string, unknown>;
  w[name] = FakeRecognition;
  return FakeRecognition;
}

function uninstallCtors() {
  const w = window as unknown as Record<string, unknown>;
  FakeRecognition.instances = [];
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
}

beforeEach(() => {
  uninstallCtors();
});
afterEach(() => {
  uninstallCtors();
  vi.restoreAllMocks();
});

describe('isSpeechRecognitionSupported 平台检测', () => {
  it('标准前缀 SpeechRecognition 存在 → 支持（Windows WebView2 / Chromium）', () => {
    installCtor('SpeechRecognition');
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it('仅 webkit 前缀存在 → 支持（macOS WKWebView / Safari 内核）', () => {
    installCtor('webkitSpeechRecognition');
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it('两种前缀都不存在 → 不支持（隐藏按钮降级）', () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
  });
});

describe('collectFinalTranscript 结果提取', () => {
  it('只取 isFinal 片段并按出现顺序拼接', () => {
    const ev = {
      resultIndex: 0,
      results: [
        { isFinal: false, length: 1, 0: { transcript: '中间' } },
        { isFinal: true, length: 1, 0: { transcript: ' 你好' } },
        { isFinal: true, length: 1, 0: { transcript: ' 世界' } },
      ],
    } as unknown as SpeechRecognitionEventLike;
    expect(collectFinalTranscript(ev)).toBe('你好 世界');
  });

  it('无 isFinal 片段返回空串', () => {
    const ev = {
      resultIndex: 0,
      results: [{ isFinal: false, length: 1, 0: { transcript: 'x' } }],
    } as unknown as SpeechRecognitionEventLike;
    expect(collectFinalTranscript(ev)).toBe('');
  });
});

describe('createSpeechInput 控制器', () => {
  it('环境不支持时返回 null（调用方据此隐藏按钮）', () => {
    expect(createSpeechInput('zh-CN', {})).toBeNull();
  });

  it('start 触发 onStart，stop 委托底层 stop，重复 start 防重入；onend 到来时 onEnd 收尾', () => {
    installCtor('SpeechRecognition');
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const ctrl = createSpeechInput('zh-CN', { onStart, onEnd });
    expect(ctrl).not.toBeNull();
    ctrl!.start();
    ctrl!.start(); // 重复调用应被 started 挡掉（不上抛、不再调底层）
    // 底层 start 被真实调用（onstart 已在桩内派发 → onStart ×1）
    expect(onStart).toHaveBeenCalledTimes(1);
    // 引擎语义：stop() 后由引擎派发 onend，这里模拟收尾
    ctrl!.stop();
    expect(lastInst().stop).toHaveBeenCalledTimes(1);
    lastInst().onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    ctrl!.stop(); // 已停止（started=false）再 stop 忽略
    expect(lastInst().stop).toHaveBeenCalledTimes(1);
  });

  it('cancel 委托底层 abort（丢弃结果），onend 到来时 onEnd 收尾且不抛错', () => {
    installCtor('webkitSpeechRecognition');
    const onEnd = vi.fn();
    const ctrl = createSpeechInput('en-US', { onEnd });
    ctrl!.start();
    ctrl!.cancel();
    expect(lastInst().abort).toHaveBeenCalledTimes(1);
    lastInst().onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('onresult 只把 final 文本交给 onResult 钩子', () => {
    installCtor('SpeechRecognition');
    const onResult = vi.fn();
    const ctrl = createSpeechInput('zh-CN', { onResult });
    ctrl!.start();
    const inst = lastInst();
    inst.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: true, length: 1, 0: { transcript: '修一修' } },
        { isFinal: false, length: 1, 0: { transcript: '待定' } },
      ],
    } as unknown as SpeechRecognitionEventLike);
    expect(onResult).toHaveBeenCalledWith('修一修');
  });

  it('onerror 透传错误码；no-speech 也交给钩子（组件层决定是否提示）', () => {
    installCtor('SpeechRecognition');
    const onError = vi.fn();
    const ctrl = createSpeechInput('zh-CN', { onError });
    ctrl!.start();
    const inst = lastInst();
    inst.onerror?.({ error: 'no-speech', message: 'some detail' });
    expect(onError).toHaveBeenCalledWith('no-speech', 'some detail');
  });

  it('底层 start 同步抛错时不向上炸（catch 兜底并走 onEnd）', () => {
    installCtor('SpeechRecognition');
    const onEnd = vi.fn();
    const ctrl = createSpeechInput('zh-CN', { onEnd });
    // 桩实例的 start 直接抛同步错误（某些引擎在未授权时行为）
    lastInst().start = vi.fn(() => {
      throw new Error('InvalidStateError');
    });
    expect(() => ctrl!.start()).not.toThrow();
    expect(onEnd).toHaveBeenCalled();
  });
});

describe('麦克风权限探测与申请', () => {
  const origPerms = Object.getOwnPropertyDescriptor(Navigator.prototype, 'permissions');
  const origMedia = Object.getOwnPropertyDescriptor(Navigator.prototype, 'mediaDevices');

  /** 可编程 permissions.query 桩（默认权限状态可控） */
  function installPermissions(state: 'granted' | 'denied' | 'prompt' | (() => never)) {
    const query = vi.fn(
      typeof state === 'function'
        ? () => Promise.reject(new Error('permissions.query unavailable'))
        : () => Promise.resolve({ state }),
    );
    // jsdom 未实现 Permissions API，直接在 navigator 上装配
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } });
    return query;
  }

  /** 可编程 mediaDevices.getUserMedia 桩 */
  function installMediaDevices(impl?: () => Promise<unknown> | never) {
    const getUserMedia = vi.fn(
      impl ??
        (async () => ({
          getTracks: () => [{ stop: () => {} }],
        })),
    );
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    return getUserMedia;
  }

  function uninstallAll() {
    if (origPerms) Object.defineProperty(navigator, 'permissions', origPerms);
    else delete (navigator as { permissions?: unknown }).permissions;
    if (origMedia) Object.defineProperty(navigator, 'mediaDevices', origMedia);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  }

  it('queryMicPermission：granted 直接返回，query 不可用（抛错）时降级 unsupported', async () => {
    installPermissions('granted');
    await expect(queryMicPermission()).resolves.toBe('granted');
    uninstallAll();

    installPermissions(() => {
      throw new Error('nope');
    });
    await expect(queryMicPermission()).resolves.toBe('unsupported');
    uninstallAll();

    installPermissions('denied');
    await expect(queryMicPermission()).resolves.toBe('denied');
  });

  it('queryMicPermission：环境未暴露 permissions → unsupported', async () => {
    uninstallAll();
    await expect(queryMicPermission()).resolves.toBe('unsupported');
  });

  it('requestMicPermission：getUserMedia 成功 → granted 并立即释放轨道', async () => {
    const stop = vi.fn();
    const getUserMedia = installMediaDevices(async () => ({ getTracks: () => [{ stop }] }));
    await expect(requestMicPermission()).resolves.toBe('granted');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalled();
  });

  it('requestMicPermission：NotAllowedError（用户拒绝/系统未授权）→ denied', async () => {
    installMediaDevices(() => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    await expect(requestMicPermission()).resolves.toBe('denied');
    uninstallAll();
    // SecurityError（非安全上下文）同样归为 denied
    installMediaDevices(() => {
      throw Object.assign(new Error('insecure'), { name: 'SecurityError' });
    });
    await expect(requestMicPermission()).resolves.toBe('denied');
  });

  it('requestMicPermission：无设备等其余异常 → unsupported', async () => {
    installMediaDevices(() => {
      throw Object.assign(new Error('no device'), { name: 'NotFoundError' });
    });
    await expect(requestMicPermission()).resolves.toBe('unsupported');
  });

  it('requestMicPermission：环境未暴露 mediaDevices → unsupported', async () => {
    uninstallAll();
    await expect(requestMicPermission()).resolves.toBe('unsupported');
  });

  it('ensureMicPermission：已授权（granted）→ granted，不再重复申请', async () => {
    installPermissions('granted');
    const getUserMedia = installMediaDevices();
    await expect(ensureMicPermission()).resolves.toBe('granted');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('ensureMicPermission：明确被拒（denied）→ denied，不发起申请', async () => {
    installPermissions('denied');
    const getUserMedia = installMediaDevices();
    await expect(ensureMicPermission()).resolves.toBe('denied');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('ensureMicPermission：prompt（未决）→ 实测申请，成功 → granted', async () => {
    installPermissions('prompt');
    installMediaDevices(async () => ({ getTracks: () => [{ stop: () => {} }] }));
    await expect(ensureMicPermission()).resolves.toBe('granted');
  });

  it('ensureMicPermission：prompt 但申请被拒 → denied', async () => {
    installPermissions('prompt');
    installMediaDevices(() => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    await expect(ensureMicPermission()).resolves.toBe('denied');
  });

  it('ensureMicPermission：探测与申请均不可用 → fallthrough（交由识别器自行报错）', async () => {
    uninstallAll();
    await expect(ensureMicPermission()).resolves.toBe('fallthrough');
  });

  it('ensureMicPermission：探测不可用但申请可用 → 走申请路径', async () => {
    installPermissions(() => {
      throw new Error('nope');
    });
    installMediaDevices(async () => ({ getTracks: () => [{ stop: () => {} }] }));
    await expect(ensureMicPermission()).resolves.toBe('granted');
  });
});

describe('requestSpeechAuthorization', () => {
  const tauriFlag = '__TAURI_INTERNALS__';
  const spyInvoke = () => vi.mocked(tauriCore.invoke);

  function setTauri(present: boolean) {
    const w = window as unknown as Record<string, unknown>;
    if (present) w[tauriFlag] = { app: {} };
    else delete w[tauriFlag];
  }

  beforeEach(() => {
    setTauri(true);
    spyInvoke().mockReset();
  });

  it('非 Tauri 环境 → unsupported（浏览器预览/静态托管）', async () => {
    setTauri(false);
    await expect(requestSpeechAuthorization()).resolves.toBe('unsupported');
    expect(spyInvoke()).not.toHaveBeenCalled();
  });

  it('Tauri 环境 invoke 返回 authorized → authorized', async () => {
    spyInvoke().mockResolvedValue('authorized');
    await expect(requestSpeechAuthorization()).resolves.toBe('authorized');
    expect(spyInvoke()).toHaveBeenCalledWith('request_speech_authorization');
  });

  it('Tauri 环境 invoke 返回 denied → denied（调用方据其展开引导条）', async () => {
    spyInvoke().mockResolvedValue('denied');
    await expect(requestSpeechAuthorization()).resolves.toBe('denied');
  });

  it('Tauri 环境 invoke 抛 launch-must-be-bundled（非 LaunchServices 启动）→ needs-app-launch（调用方必须中止 start()）', async () => {
    spyInvoke().mockRejectedValue('launch-must-be-bundled');
    await expect(requestSpeechAuthorization()).resolves.toBe('needs-app-launch');
  });

  it('Tauri 环境 invoke 抛 Error(launch-must-be-bundled) → needs-app-launch', async () => {
    spyInvoke().mockRejectedValue(new Error('launch-must-be-bundled'));
    await expect(requestSpeechAuthorization()).resolves.toBe('needs-app-launch');
  });

  it('Tauri 环境 invoke 抛其它错误 → unsupported（降级走原麦克风流程）', async () => {
    spyInvoke().mockRejectedValue(new Error('command not found'));
    await expect(requestSpeechAuthorization()).resolves.toBe('unsupported');
  });
});
