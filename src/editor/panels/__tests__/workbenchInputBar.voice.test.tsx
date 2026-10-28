// sight-folio: WorkbenchInputBar 语音输入集成测试（jsdom + react-dom/client 原生 createRoot）。
// 覆盖：平台不支持时麦克风按钮不渲染（M6）、支持时点击开始/再次点击结束（M3）、
// 识别结果回填输入框不自动发送（M4）、错误码 toast（not-allowed/errService）与 no-speech 静默。
// speechInput 模块整体 mock：isSpeechRecognitionSupported 可控、createSpeechInput 返回可编程控制器。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WorkbenchInputBarCtx } from '../workbenchComponents';

const h = vi.hoisted(() => {
  const cfg = { supported: true };
  const created: Array<{ lang: string; hooks: Record<string, (p?: unknown) => void> }> = [];
  const ctrl = { start: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
  const toast = vi.fn();
  const ensureMic = vi.fn(async () => 'granted' as 'granted' | 'denied' | 'fallthrough');
  const speechAuth = vi.fn(
    async () =>
      'authorized' as 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'needs-app-launch' | 'unsupported',
  );
  return { cfg, created, ctrl, toast, ensureMic, speechAuth };
});

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (sel: (s: { interruptRequested: boolean }) => unknown) => sel({ interruptRequested: false }),
    {
      getState: () => ({ requestInterrupt: vi.fn(), interruptRequested: false }),
    },
  ),
}));

vi.mock('../speechInput', () => ({
  isSpeechRecognitionSupported: () => h.cfg.supported,
  ensureMicPermission: () => h.ensureMic(),
  requestSpeechAuthorization: () => h.speechAuth(),
  createSpeechInput: (lang: string, hooks: Record<string, (p?: unknown) => void>) => {
    h.created.push({ lang, hooks });
    return h.ctrl;
  },
}));

vi.mock('../../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ showToast: h.toast }) },
}));

import { WorkbenchInputBar } from '../workbenchComponents';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function makeCtx(over: Partial<WorkbenchInputBarCtx> = {}): WorkbenchInputBarCtx {
  return {
    view: 'chat',
    input: '',
    setInput: vi.fn(),
    editInput: '',
    setEditInput: vi.fn(),
    inputRef: { current: null },
    editInputRef: { current: null },
    submitInput: vi.fn(),
    detectHashMention: vi.fn(),
    detectSlashCommand: vi.fn(),
    setSlashAnchor: vi.fn(),
    setSlashQuery: vi.fn(),
    setSlashTarget: vi.fn(),
    slashAnchor: null,
    slashQuery: '',
    slashTarget: 'chat',
    fileDiagnostics: [],
    fixErrors: vi.fn(),
    quickAction: vi.fn(),
    queued: [],
    isBookScene: false,
    agents: [],
    selectedAgentId: null,
    selectAgent: vi.fn(),
    ...over,
  };
}

async function mount(over: Partial<WorkbenchInputBarCtx> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<WorkbenchInputBar ctx={makeCtx(over)} selection={null} isStreaming={false} />);
  });
}

function micButton(): HTMLButtonElement | null {
  return document.querySelector('[aria-label="语音输入"], [aria-label="停止"]');
}

beforeEach(() => {
  h.cfg.supported = true;
  h.created.length = 0;
  h.ctrl.start.mockClear();
  h.ctrl.stop.mockClear();
  h.ctrl.cancel.mockClear();
  h.toast.mockClear();
  h.ensureMic.mockClear();
  h.ensureMic.mockResolvedValue('granted');
  h.speechAuth.mockClear();
  h.speechAuth.mockResolvedValue('authorized');
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

describe('WorkbenchInputBar 语音输入（方案 A / Web Speech API）', () => {
  it('平台不支持时麦克风按钮不渲染，斜杠命令入口保留（M6 降级）', async () => {
    h.cfg.supported = false;
    await mount();
    expect(micButton()).toBeNull();
    expect(document.querySelector('[aria-label="斜杠命令"]')).not.toBeNull();
    // 不支持时也不创建控制器
    expect(h.created.length).toBe(0);
  });

  it('支持时挂载即创建控制器（按 UI 语言 zh-CN），点击开始、再次点击结束（M3）', async () => {
    await mount();
    expect(h.created.length).toBe(1);
    expect(h.created[0].lang).toBe('zh-CN');

    const btn = micButton();
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 点击先走权限申请（mock granted）再启动识别，异步链 flush 后断言
    await vi.waitFor(() => expect(h.ctrl.start).toHaveBeenCalledTimes(1));
    // start 后引擎派发 onstart → listening=true → 按钮文案切为「停止」
    await act(async () => {
      (h.created[0].hooks.onStart as () => void)();
    });
    expect(micButton()?.getAttribute('aria-label')).toBe('停止');

    await act(async () => {
      micButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.ctrl.stop).toHaveBeenCalledTimes(1);
  });

  it('识别结果回填输入框（已输入内容拼接），不自动发送（M4）', async () => {
    const setInput = vi.fn();
    const submitInput = vi.fn();
    await mount({ input: '开头：', setInput, submitInput });
    // 引擎派发 onresult（isFinal 文本已由 speechInput 提取）
    await act(async () => {
      (h.created[0].hooks.onResult as (t: string) => void)('你好世界');
    });
    expect(setInput).toHaveBeenCalledWith('开头： 你好世界');
    expect(submitInput).not.toHaveBeenCalled();
  });

  it('输入框为空时回填不加多余前缀空格', async () => {
    const setInput = vi.fn();
    await mount({ input: '', setInput });
    await act(async () => {
      (h.created[0].hooks.onResult as (t: string) => void)('你好');
    });
    expect(setInput).toHaveBeenCalledWith('你好');
  });

  it('not-allowed / service-not-allowed → 展开权限引导条而非错误 toast', async () => {
    await mount();
    await act(async () => {
      (h.created[0].hooks.onError as (code: string) => void)('not-allowed');
    });
    // 权限被拒：展示引导条（重试/关闭按钮），不弹错误 toast
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();
    expect(h.toast).not.toHaveBeenCalledWith(expect.stringContaining('麦克风权限'), 'error');
    expect(h.toast).not.toHaveBeenCalled();

    await act(async () => {
      (h.created[0].hooks.onError as (code: string) => void)('service-not-allowed');
    });
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();
  });

  it('其他错误码（语音服务不可用）→ error toast', async () => {
    await mount();
    await act(async () => {
      (h.created[0].hooks.onError as (code: string) => void)('language-not-supported');
    });
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('语音服务'), 'error');
  });

  it('点击语音时先申请权限：granted → 启动识别', async () => {
    h.ensureMic.mockResolvedValue('granted');
    await mount();
    const btn = micButton();
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.ensureMic).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.ctrl.start).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[aria-label="重试"]')).toBeNull();
  });

  it('点击语音时权限被拒（denied）→ 不启动识别，展开引导条且无 toast', async () => {
    h.ensureMic.mockResolvedValue('denied');
    await mount();
    const btn = micButton();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.ensureMic).toHaveBeenCalledTimes(1);
    expect(h.ctrl.start).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="关闭提示"]')).not.toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('语音识别授权被拒（speechAuth=denied）→ 不调用麦克风、展开引导条且无 toast', async () => {
    h.speechAuth.mockResolvedValue('denied');
    await mount();
    const btn = micButton();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.speechAuth).toHaveBeenCalledTimes(1);
    expect(h.ensureMic).not.toHaveBeenCalled();
    expect(h.ctrl.start).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('语音识别授权未决（speechAuth=notDetermined）→ 同样展开引导条', async () => {
    h.speechAuth.mockResolvedValue('notDetermined');
    await mount();
    const btn = micButton();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.speechAuth).toHaveBeenCalledTimes(1);
    expect(h.ensureMic).not.toHaveBeenCalled();
    expect(h.ctrl.start).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();
  });

  it('语音识别需应用启动（speechAuth=needs-app-launch）→ 绝不调 start()（防 WebKit 代发授权崩溃），展开启动引导', async () => {
    h.speechAuth.mockResolvedValue('needs-app-launch');
    await mount();
    const btn = micButton();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 关键防线：该状态下 WebKit 的 SpeechRecognition.start() 会内部代发
    // SFSpeechRecognizer 授权请求，非 LaunchServices 形态下 TCC 直接 SIGABRT。
    // 因此必须：不探测麦克风、不启动识别、只展开"用 .app 启动"引导。
    expect(h.speechAuth).toHaveBeenCalledTimes(1);
    expect(h.ensureMic).not.toHaveBeenCalled();
    expect(h.ctrl.start).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('权限探测与申请均不可用（fallthrough）→ 直接启动识别，识别器自行报错兜底', async () => {
    h.ensureMic.mockResolvedValue('fallthrough');
    await mount();
    const btn = micButton();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(h.ctrl.start).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[aria-label="重试"]')).toBeNull();
  });

  it('引导条「重试」再次申请权限：批准后启动识别；「关闭提示」收起引导条', async () => {
    h.ensureMic.mockResolvedValue('denied');
    await mount();
    const btn = micButton();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();

    // 用户在系统设置开启后点「重试」→ 再次申请 → granted → 启动
    h.ensureMic.mockResolvedValue('granted');
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="重试"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.ensureMic).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(h.ctrl.start).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[aria-label="重试"]')).toBeNull();

    // 再次点击语音（此时权限仍被拒）→ 重新展开引导条
    h.ensureMic.mockResolvedValue('denied');
    await act(async () => {
      micButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="重试"]')).not.toBeNull();
    // 点「关闭提示」收起引导条
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="重试"]')).toBeNull();
  });

  it('no-speech 静默不打扰（无 toast）', async () => {
    await mount();
    await act(async () => {
      (h.created[0].hooks.onError as (code: string) => void)('no-speech');
    });
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('卸载时 cancel 清理识别器（防止后台继续拾音）', async () => {
    await mount();
    expect(h.created.length).toBe(1);
    await act(async () => {
      h.created[0].hooks.onStart?.();
    });
    // 卸载路由：根节点 unmount 触发 effect cleanup → cancel
    if (root) await act(async () => root!.unmount());
    root = null;
    expect(h.ctrl.cancel).toHaveBeenCalledTimes(1);
  });
});
