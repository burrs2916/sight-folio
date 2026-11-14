// 本机 Ollama 状态判定的回归锁（纯函数，四态各一条）。
// 最容易出错的两处：把"没扫到"说成"扫到了"、把"在线但没拉模型"说成"没装 Ollama"——
// 这两句会让作者去做完全不同的下一步，混了就等于把人支走。
import { describe, expect, it } from 'vitest';
import { ollamaContextK, ollamaReasoningFlag, ollamaSizeLabel, ollamaFailReason, ollamaStatusView } from '../ollamaStatus';
import type { OllamaScanResult } from '../../services/agent';

function scan(over: Partial<OllamaScanResult> = {}): OllamaScanResult {
  return {
    found: false,
    baseUrl: '',
    openaiBaseUrl: '',
    models: [],
    attempts: [],
    ...over,
  };
}

describe('ollamaStatusView', () => {
  it('正在扫描时盖住上一轮结论（否则看着像已经扫完了）', () => {
    const stale = scan({
      found: true,
      baseUrl: 'http://127.0.0.1:11434',
      models: [{ refKey: 'a', name: 'a', sizeBytes: 0, parameterSize: '', quantization: '', contextLength: 0, capabilities: [] }],
    });
    expect(ollamaStatusView(true, stale)).toEqual({ tone: 'scanning', messageKey: 'agent.ollamaScanning' });
  });

  it('还没扫过 → idle，不猜结果', () => {
    expect(ollamaStatusView(false, null)).toEqual({ tone: 'idle', messageKey: 'agent.ollamaIdle' });
  });

  it('发现模型 → found，带模型数与真实地址', () => {
    const v = ollamaStatusView(
      false,
      scan({
        found: true,
        baseUrl: 'http://127.0.0.1:11434',
        models: [
          { refKey: 'qwen2.5:7b', name: 'qwen2.5:7b', sizeBytes: 1, parameterSize: '', quantization: '', contextLength: 32768, capabilities: ['completion', 'tools'] },
          { refKey: 'llama3:8b', name: 'llama3:8b', sizeBytes: 1, parameterSize: '', quantization: '', contextLength: 8192, capabilities: [] },
        ],
      }),
    );
    expect(v.tone).toBe('found');
    expect(v.args).toEqual({ n: 2, url: 'http://127.0.0.1:11434' });
  });

  it('服务在线但没拉模型 ≠ 未发现本机 Ollama（两个键必须不同）', () => {
    const online = ollamaStatusView(false, scan({ found: true, baseUrl: 'http://127.0.0.1:11434' }));
    const absent = ollamaStatusView(false, scan({ attempts: ['x → refused'] }));
    expect(online.messageKey).toBe('agent.ollamaOnlineNoModels');
    expect(absent.messageKey).toBe('agent.ollamaNotFound');
    expect(online.messageKey).not.toBe(absent.messageKey);
  });

  it('未发现时把死因原样带出来，不写成"未安装"', () => {
    const v = ollamaStatusView(false, scan({ attempts: ['http://127.0.0.1:11434/api/tags → refused'] }));
    expect(v.args?.reason).toBe('http://127.0.0.1:11434/api/tags → refused');
  });
});

describe('ollamaFailReason / ollamaSizeLabel', () => {
  it('一条地址原样；多条报出试过几个', () => {
    expect(ollamaFailReason([])).toBe('no-candidate');
    expect(ollamaFailReason(['a'])).toBe('a');
    expect(ollamaFailReason(['a', 'b', 'c'])).toBe('a（共试了 3 个地址）');
  });

  it('拿不到体积不显示 0 B 冒充测量值', () => {
    expect(ollamaSizeLabel(0)).toBe('');
    expect(ollamaSizeLabel(-1)).toBe('');
    expect(ollamaSizeLabel(4705922955)).toBe('4.4 GB');
    expect(ollamaSizeLabel(524288000)).toBe('500 MB');
  });

  it('上下文读数按千取整；服务没报就不出数（0K 等于编数）', () => {
    expect(ollamaContextK(40960)).toBe(40); // qwen3:32b 实测值
    expect(ollamaContextK(131072)).toBe(128); // gpt-oss:20b 实测值
    expect(ollamaContextK(4096)).toBe(4);
    expect(ollamaContextK(2048)).toBe(2);
    expect(ollamaContextK(0)).toBeNull();
    expect(ollamaContextK(-1)).toBeNull();
  });

  it('能力表认推理模型：thinking/reasoning 都认，没报就是 false', () => {
    expect(ollamaReasoningFlag(['completion', 'tools', 'thinking'])).toBe(true); // gpt-oss 实测形态
    expect(ollamaReasoningFlag(['Reasoning'])).toBe(true);
    expect(ollamaReasoningFlag(['completion', 'tools'])).toBe(false);
    expect(ollamaReasoningFlag([])).toBe(false);
    expect(ollamaReasoningFlag(undefined)).toBe(false);
  });
});
