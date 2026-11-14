// 「密钥那一栏该说什么」的回归锁（纯函数）。
// 钉的是最容易伤人的一件事：**本地服务不需要密钥**不许被说成**缺了个密钥**。
// 前者作者什么都不用做，后者会让他去随便粘一串字符 —— 一句文案把人支走就是 bug。
import { describe, expect, it } from 'vitest';
import { authTypeAfterBaseUrlEdit, defaultAuthType, isLoopbackBaseUrl, providerKeyState } from '../agentProviderKey';

describe('isLoopbackBaseUrl', () => {
  it('回环的三种写法都认（含 IPv6 带方括号、缺 scheme）', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLoopbackBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLoopbackBaseUrl('http://[::1]:11434/v1')).toBe(true);
    expect(isLoopbackBaseUrl('127.0.0.1:11434/v1')).toBe(true);
    expect(isLoopbackBaseUrl('http://127.0.1.1:11434')).toBe(true); // 127.0.0.0/8 整段都是本机
  });

  it('远端一律不算本机，解析不出来也不算（宁可少说"无需 Key"）', () => {
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackBaseUrl('https://box.local/ai/ollama')).toBe(false);
    expect(isLoopbackBaseUrl('http://192.168.1.20:11434/v1')).toBe(false);
    expect(isLoopbackBaseUrl('')).toBe(false);
    expect(isLoopbackBaseUrl(undefined)).toBe(false);
    expect(isLoopbackBaseUrl('http://')).toBe(false);
  });
});

describe('providerKeyState', () => {
  const eps = [
    { id: 'ep_1', providerId: 'prov_ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
    { id: 'ep_2', providerId: 'prov_openai', baseUrl: 'https://api.openai.com/v1' },
  ];

  it('有 key 就显示掩码，不看地址', () => {
    expect(providerKeyState({ id: 'prov_openai', apiKey: 'sk-abcd' }, eps)).toBe('masked');
  });

  it('没 key 且服务在本机回环 = 无需 Key，不是缺口', () => {
    expect(providerKeyState({ id: 'prov_ollama', apiKey: '' }, eps)).toBe('local-noneed');
  });

  it('没 key 且服务在远端 = 真的没配', () => {
    expect(providerKeyState({ id: 'prov_openai', apiKey: '' }, eps)).toBe('missing');
  });

  it('按 id 匹配端点：不许把别家的本机端点算到自己头上', () => {
    expect(providerKeyState({ id: 'prov_other', apiKey: '' }, eps)).toBe('missing');
    // 改名的 Ollama（provider 名字根本没用上）依旧判对
    expect(providerKeyState({ id: 'prov_ollama', apiKey: '' }, eps)).toBe('local-noneed');
  });

  it('空白 key 与没 id 都不许猜成"无需 Key"', () => {
    expect(providerKeyState({ id: 'prov_ollama', apiKey: '   ' }, eps)).toBe('local-noneed');
    expect(providerKeyState({ apiKey: '' }, eps)).toBe('missing');
  });
});

describe('defaultAuthType', () => {
  it('本机地址的新端点默认就是无需密钥', () => {
    expect(defaultAuthType(undefined, 'http://127.0.0.1:11434/v1')).toBe('none');
    expect(defaultAuthType('', 'http://localhost:11434/v1')).toBe('none');
  });

  it('云端地址仍按 bearer 默认；已存过 auth_type 的老端点一律照原值', () => {
    expect(defaultAuthType(undefined, 'https://api.openai.com/v1')).toBe('bearer');
    expect(defaultAuthType(undefined, '')).toBe('bearer');
    expect(defaultAuthType('bearer', 'http://127.0.0.1:11434/v1')).toBe('bearer');
    expect(defaultAuthType('x-api-key', 'http://127.0.0.1:11434/v1')).toBe('x-api-key');
  });
});

describe('authTypeAfterBaseUrlEdit', () => {
  it('填成本机地址时把默认的 bearer 带成 none', () => {
    expect(authTypeAfterBaseUrlEdit('bearer', 'http://127.0.0.1:11434/v1')).toBe('none');
  });

  it('手选过的方式不许被地址覆盖；云端地址什么都不动', () => {
    expect(authTypeAfterBaseUrlEdit('x-api-key', 'http://127.0.0.1:11434/v1')).toBe('x-api-key');
    expect(authTypeAfterBaseUrlEdit('custom', 'http://127.0.0.1:11434/v1')).toBe('custom');
    expect(authTypeAfterBaseUrlEdit('none', 'http://127.0.0.1:11434/v1')).toBe('none');
    expect(authTypeAfterBaseUrlEdit('bearer', 'https://api.openai.com/v1')).toBe('bearer');
  });
});
