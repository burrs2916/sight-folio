// 本机 Ollama 卡片的自动行为回归锁（2026-11-07 口径：自动扫描 + 自动识别 + 自动接入）。
//
// 钉的是四件事，每件都对应一种"用户会误会"的走法：
// ① 打开就自己扫一次（不点按钮也要扫）；扫到就自己接入并刷新模型表（否则助手选不到）；
// ② 自动那一轮**静默**（不弹 toast）——每次开设置都挨一条提示就是噪音；手动点按钮才回执；
// ③ 没找到时只在状态行说话，**不弹红**（没装 Ollama 是常态，不是错误）；
// ④ 「重新扫描本地 Ollama」是常驻控件（入口铁律），扫描中也不许消失。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  scanOllama: vi.fn(),
  importOllamaModels: vi.fn(),
  loadProviders: vi.fn(),
  loadEndpoints: vi.fn(),
  loadModels: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

// i18n 替身要把参数一并拼出来：只回键名的话，「未发现」那条永远看不见死因，
// 断言会退化成「文案里有没有这个键」，测不到组件到底有没有把 attempts 交给 t()。
vi.mock('../../i18n', () => ({
  t: (key: string, args?: Record<string, string | number>) =>
    args && Object.keys(args).length ? `${key}|${Object.values(args).join(',')}` : key,
}));
vi.mock('../../services/agent', () => ({
  agentApi: { scanOllama: h.scanOllama, importOllamaModels: h.importOllamaModels },
}));
vi.mock('../../store/agentStore', () => ({
  useAgentStore: {
    getState: () => ({ loadProviders: h.loadProviders, loadEndpoints: h.loadEndpoints, loadModels: h.loadModels }),
  },
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: { getState: () => ({ success: h.success, error: h.error }) },
}));

import OllamaLocalPanel from '../OllamaLocalPanel';

const foundScan = {
  found: true,
  baseUrl: 'http://127.0.0.1:11434',
  openaiBaseUrl: 'http://127.0.0.1:11434/v1',
  models: [
    {
      refKey: 'qwen2.5:7b-instruct',
      name: 'qwen2.5:7b-instruct',
      sizeBytes: 4705922955,
      parameterSize: '7.6B',
      quantization: 'Q4_K_M',
      contextLength: 40960,
      capabilities: ['completion', 'tools', 'thinking'],
    },
    { refKey: 'llama3:8b', name: 'llama3:8b', sizeBytes: 0, parameterSize: '', quantization: '', contextLength: 0, capabilities: [] },
  ],
  attempts: [],
};
const absentScan = {
  found: false,
  baseUrl: '',
  openaiBaseUrl: '',
  models: [],
  attempts: ['http://127.0.0.1:11434/api/tags → connection refused'],
};
const adopt = {
  providerId: 'prov_1',
  endpointId: 'ep_1',
  added: ['qwen2.5:7b-instruct', 'llama3:8b'],
  kept: [],
  refreshed: [],
  createdProvider: true,
  createdEndpoint: true,
};

let host: HTMLDivElement;
let root: Root;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<OllamaLocalPanel />));
}

/** 等自动扫描的异步链跑完（两轮微任务足以穿过 await 链） */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const qa = (sel: string) => host.querySelector(sel);
const btn = () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('agent.ollamaScan'));

beforeEach(() => {
  vi.clearAllMocks();
  h.scanOllama.mockResolvedValue(foundScan);
  h.importOllamaModels.mockResolvedValue(adopt);
  h.loadProviders.mockResolvedValue(undefined);
  h.loadEndpoints.mockResolvedValue(undefined);
  h.loadModels.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('OllamaLocalPanel', () => {
  it('打开就自动扫描一次，扫到就自动接入并刷新模型表', async () => {
    mount();
    await settle();
    expect(h.scanOllama).toHaveBeenCalledTimes(1);
    expect(h.importOllamaModels).toHaveBeenCalledTimes(1);
    // 模型表不刷新的话，作者扫完了在助手下拉里还是看不见 —— 这条最容易漏
    expect(h.loadModels).toHaveBeenCalled();
    expect(h.loadProviders).toHaveBeenCalled();
    expect(qa('[data-testid="ollama-model-qwen2.5:7b-instruct"]')).toBeTruthy();
    expect(host.textContent).toContain('agent.ollamaFound');
    // 上下文自动识别要看得见：报得出才显示，且显示的是服务报的那个数（40960 → 40K）
    expect(host.textContent).toContain('agent.ollamaCtx|40');
    // 没报的那个模型（contextLength: 0）不许冒充一个读数出来
    expect(host.textContent).not.toContain('agent.ollamaCtx|0');
  });

  it('自动那一轮保持静默；点「重新扫描」才给回执', async () => {
    mount();
    await settle();
    expect(h.success).not.toHaveBeenCalled();
    const b = btn();
    expect(b).toBeTruthy();
    await act(async () => {
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.scanOllama).toHaveBeenCalledTimes(2);
    expect(h.success).toHaveBeenCalledTimes(1);
  });

  it('未发现时只在状态行说话：不弹红、不接入', async () => {
    h.scanOllama.mockResolvedValue(absentScan);
    mount();
    await settle();
    expect(host.textContent).toContain('agent.ollamaNotFound');
    expect(host.textContent).toContain('connection refused'); // 死因原样带出，不写成"未安装"
    expect(h.error).not.toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
    expect(h.importOllamaModels).not.toHaveBeenCalled();
  });

  it('在线但没拉模型：不接入空端点，说的是拉模型而不是没装', async () => {
    h.scanOllama.mockResolvedValue({ ...foundScan, models: [] });
    mount();
    await settle();
    expect(host.textContent).toContain('agent.ollamaOnlineNoModels');
    expect(h.importOllamaModels).not.toHaveBeenCalled();
  });

  it('只补齐了上下文（没有新模型）也要刷模型表，否则界面上还是那条占位值', async () => {
    h.importOllamaModels.mockResolvedValue({
      ...adopt,
      added: [],
      kept: ['qwen2.5:7b-instruct', 'llama3:8b'],
      refreshed: ['qwen2.5:7b-instruct', 'llama3:8b'],
    });
    mount();
    await settle();
    expect(h.loadModels).toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled(); // 自动那一轮仍然静默
    const b = btn();
    await act(async () => {
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.success).toHaveBeenCalledTimes(1);
    expect(h.success.mock.calls[0][0]).toContain('agent.ollamaRefreshed|2');
  });

  it('扫描命令本身抛错也落到状态行（打开设置页不该挨一发红 toast）', async () => {
    h.scanOllama.mockRejectedValue(new Error('boom'));
    mount();
    await settle();
    expect(host.textContent).toContain('agent.ollamaNotFound');
    expect(host.textContent).toContain('Error: boom');
    expect(h.error).not.toHaveBeenCalled();
  });

  it('常驻入口写在按钮上：扫描中也不藏起来', async () => {
    let release: (v: unknown) => void = () => {};
    h.scanOllama.mockImplementation(() => new Promise((res) => (release = res)));
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    const b = btn();
    expect(b).toBeTruthy(); // 正在扫也看得见（只是禁用），不玩"扫完才出现"
    expect(b?.disabled).toBe(true);
    release(foundScan);
    await settle();
  });
});
