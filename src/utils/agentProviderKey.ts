// 供应商卡片上「密钥那一栏该说什么」的判定（纯函数，零 React）。
//
// 为什么单独收拢：本机 Ollama 自动接入时故意**不写密钥**（它不校验密钥，塞一个假 key
// 比留空更不诚实）。可界面原先一律显示「未配置 Key」，把一件**本来就不需要的东西**
// 说成一个**缺口**，作者会去随便粘一串字符进来。三种状态必须分开说话：
//   masked      —— 有 key：照常显示掩码
//   local-noneed —— 没 key，但它整个服务就在本机回环上：这不是缺口，是设计
//   missing     —— 没 key 且服务在远端：这才是真的没配
// 判据只看「端点是不是回环地址」，不看供应商叫什么名字：用户把 Ollama 改名了照样对，
// 一家手工建的局域网服务也不会被误判成"不需要 key"。
export type ProviderKeyState = 'masked' | 'local-noneed' | 'missing';

interface KeyedProvider {
  id?: string;
  apiKey?: string;
}
interface EndpointLike {
  providerId?: string;
  baseUrl?: string;
}

/**
 * base_url 是否指向本机回环（127.0.0.0/8、localhost、::1）。
 * 容忍没写 scheme 的写法（`127.0.0.1:11434/v1`）；解析不出来一律算"不是本机"，
 * 宁可少说一句"无需 Key"，也不许把远端服务说成不需要密钥。
 */
export function isLoopbackBaseUrl(baseUrl: string | undefined): boolean {
  const raw = (baseUrl || '').trim();
  if (!raw) return false;
  let host = '';
  try {
    host = new URL(raw.includes('://') ? raw : `http://${raw}`).hostname;
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

/** 一家供应商的密钥状态：有 key 就是 masked；没 key 再看它有没有端点跑在本机回环上。 */
export function providerKeyState(p: KeyedProvider, endpoints: EndpointLike[]): ProviderKeyState {
  if ((p.apiKey || '').trim()) return 'masked';
  const pid = (p.id || '').trim();
  if (!pid) return 'missing'; // 连 id 都没有就别猜它有哪些端点
  const local = endpoints.some((e) => (e.providerId || '').trim() === pid && isLoopbackBaseUrl(e.baseUrl));
  return local ? 'local-noneed' : 'missing';
}

/**
 * 新建端点时的默认认证方式：地址在本机回环 → `none`（本地服务没有 Key 这回事），
 * 否则沿用云端默认的 `bearer`。已经存过 auth_type 的老端点**一律照原值**，
 * 这个默认只管"还没填过"的那一次。
 */
export function defaultAuthType(savedAuthType: string | undefined, baseUrl: string | undefined): string {
  if ((savedAuthType || '').trim()) return savedAuthType as string;
  return isLoopbackBaseUrl(baseUrl) ? 'none' : 'bearer';
}

/**
 * 改地址时要不要把认证方式带成 `none`：**只在他还没动过默认 bearer 时带**。
 * 用户自己选过 x-api-key / custom / none，就算把地址改成本机也不许覆盖他的手选。
 */
export function authTypeAfterBaseUrlEdit(prevAuthType: string, nextBaseUrl: string): string {
  return prevAuthType === 'bearer' && isLoopbackBaseUrl(nextBaseUrl) ? 'none' : prevAuthType;
}
