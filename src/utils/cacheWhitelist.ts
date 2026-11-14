import { BROWSER_SETTINGS_PREFIX } from '../services/settings';

const ALLOWED_CACHE_KEYS: string[] = [
  'icon-settings',
  // 设置健康自检的跨启动标记（不在 sightfolio.settings: 前缀下，被 settingsHealthStore
  // 直接写在 localStorage 上）：删了它，「本次启动是否第一次拿到库读数」就永远判错。
  'settings_probe_last_boot',
];

/**
 * **受保护命名空间**（2026-11-03 李先生报修「设置完颜色主题，重启就不对」后新增）。
 *
 * 病灶：本模块的 `cleanupDisallowedKeys()` 被 `authStore.init()` 在**每次启动**调用
 * （authStore.ts:246 那句「系统重启时首先清空所有缓存」），而它按白名单遍历删除
 * **整个 localStorage + sessionStorage**。白名单原本只认认证域那十几个键，于是所有
 * 应用自己的持久层都落在清扫范围里：
 *   ① `sightfolio.settings:*` —— 设置库的浏览器兜底通道（主题色彩/布局/排版/语言/写作偏好）；
 *   ② `sight-folio:writing-draft:*` —— 崩溃恢复的正文草稿；
 *   ③ 工作台面板尺寸、AI 语料草稿、选书搜索历史等。
 * 实测时序是「store 先 init 读回 → 清扫后删键」，所以观感特别迷惑：**这一次启动看着是好的，
 * 下一次重启全回默认**，正是用户说的「持久化没做好」。桌面端设置库在 config.db 里删不掉，
 * 但 ② ③ 这些真·用户数据在 Tauri webview 的 localStorage 里，同样每次启动被清。
 *
 * 口径：认证清扫继续清它自己的键（下面的逻辑一行没改），但**不许越界删别的域**。
 * 新增自己的持久层时，把前缀登记进来，否则哪天又被清扫吃掉。
 */
const PROTECTED_KEY_PREFIXES: string[] = [
  // 设置库兜底通道（前缀常量由 settings.ts 独家持有，这里只引用）
  BROWSER_SETTINGS_PREFIX,
  // 崩溃恢复正文草稿、AI 语料草稿与生成态
  'sight-folio:',
  // **点号家族**（2026-11-04 全仓删除账 N1）：上面那条是冒号 `sight-folio:`，
  // 而仓里还有一批键写成点号 `sight-folio.`（如 AI 风格一致性开关、旧版书级排版键）。
  // 少登记这一条的后果是：这类键**每次启动被本模块删一次**，且因为冒号/点号只差一个字符，
  // 肉眼审查根本发现不了。回归锁见 storageKeyNamespaceRound46.test.ts（用真 isCacheKeyAllowed 判定）。
  'sight-folio.',
  // 工作台画布缓存等
  'ps.',
  // 工作台面板开关与宽度
  'workbench.',
  // 选书搜索历史
  'sightFolio.',
  // 界面语言与历史主题键（迁移期仍要能读到）
  'project-sight',
];

function isProtectedKey(key: string): boolean {
  return PROTECTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

const DYNAMIC_KEY_PATTERNS: RegExp[] = [
  /^auth_token$/,
  /^auth_token_refresh$/,
  /^accessToken$/,
  /^accessToken_refresh$/,
  /^refreshToken$/,
  /^expiresIn$/,
  /^userId$/,
  /^username$/,
  /^nickname$/,
  /^email$/,
  /^avatar$/,
  /^tenantId$/,
  /^tenantName$/,
  /^roles$/,
  /^permissions$/,
];

export function isCacheKeyAllowed(key: string): boolean {
  if (isProtectedKey(key)) return true;
  if (ALLOWED_CACHE_KEYS.includes(key)) return true;
  return DYNAMIC_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function registerDynamicKey(key: string): void {
  if (!isCacheKeyAllowed(key)) {
    ALLOWED_CACHE_KEYS.push(key);
  }
}

export function cleanupDisallowedKeys(): void {
  if (typeof window === 'undefined') return;

  const storages = [window.localStorage, window.sessionStorage];
  for (const storage of storages) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && !isCacheKeyAllowed(key)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  }
}

export function getDisallowedKeys(): string[] {
  if (typeof window === 'undefined') return [];

  const result: string[] = [];
  const storages = [window.localStorage, window.sessionStorage];
  for (const storage of storages) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && !isCacheKeyAllowed(key)) {
        result.push(key);
      }
    }
  }
  return result;
}
