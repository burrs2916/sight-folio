// 本机 Ollama 状态文案的**选择逻辑**（纯函数，零 React）。
//
// 为什么要单独收拢：这块只有四种状态，但四种里最容易出错的是"把没扫到说成扫到了"
// 与"把在线但没模型说成没装 Ollama"——两者对作者的下一步动作完全不同（前者去开服务，
// 后者去 ollama pull）。把判定抽出来才能被单测钉住，而不是散在组件的三元表达式里。
import type { OllamaScanResult } from '../services/agent';

export type OllamaTone = 'idle' | 'scanning' | 'found' | 'online-no-models' | 'not-found';

export interface OllamaStatusView {
  tone: OllamaTone;
  /** i18n 键（agent.*） */
  messageKey: string;
  args?: Record<string, string | number>;
}

/**
 * 一次扫描 → 一行状态。
 * 顺序即优先级：正在扫的时候不许显示上一轮的旧结论（那会让人以为扫描已经完了）。
 */
export function ollamaStatusView(scanning: boolean, scan: OllamaScanResult | null): OllamaStatusView {
  if (scanning) return { tone: 'scanning', messageKey: 'agent.ollamaScanning' };
  if (!scan) return { tone: 'idle', messageKey: 'agent.ollamaIdle' };
  if (scan.found && scan.models.length > 0) {
    return {
      tone: 'found',
      messageKey: 'agent.ollamaFound',
      args: { n: scan.models.length, url: scan.baseUrl },
    };
  }
  // 服务在线但一个模型都没拉：这不是"没装 Ollama"，提示得指向 `ollama pull`
  if (scan.found) {
    return { tone: 'online-no-models', messageKey: 'agent.ollamaOnlineNoModels', args: { url: scan.baseUrl } };
  }
  // 未扫到：死因分层——没候选地址（客户端没起来）/ 单条原样 / 多条报出试了几个。
  // 这层只选 key 和传数据，自然语言文案一律由 i18n 资源负责（禁止中英文案混进 args）。
  const attempts = scan.attempts;
  if (attempts.length === 0) return { tone: 'not-found', messageKey: 'agent.ollamaNoCandidate' };
  if (attempts.length === 1) {
    return { tone: 'not-found', messageKey: 'agent.ollamaNotFound', args: { reason: attempts[0] } };
  }
  return {
    tone: 'not-found',
    messageKey: 'agent.ollamaNotFoundMulti',
    args: { reason: attempts[0], n: attempts.length },
  };
}

/** 模型体积：Ollama 给的是字节数；拿不到（0）就显示空串，不显示 "0 B" 冒充测量值。 */
export function ollamaSizeLabel(sizeBytes: number): string {
  if (!sizeBytes || sizeBytes <= 0) return '';
  const gb = sizeBytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024 / 1024))} MB`;
}

/**
 * 能力表 → 是不是推理模型（与 Rust 侧 `reasoning_from_capabilities` 同一口径）。
 * 空数组表示这台服务没报（`/api/tags` 里 capabilities 是 null），此时返回 false：
 * **报不出就是不知道**，不许默认它是、也不许默认它不是推理模型之外的任何东西。
 */
export function ollamaReasoningFlag(capabilities: string[] | undefined): boolean {
  return (capabilities || []).some((c) => c.toLowerCase() === 'thinking' || c.toLowerCase() === 'reasoning');
}

/**
 * 上下文长度 → 千（K）粒度读数：40960 → 40、131072 → 128。
 * 拿不到（0 / 负数）返回 **null**，让调用方什么都不显示 —— 显示 "0K" 等于编一个数。
 * 这里只出数字不出单位文案，i18n 的 "K 上下文" 由组件拼。
 */
export function ollamaContextK(contextLength: number): number | null {
  if (!contextLength || contextLength <= 0) return null;
  return Math.max(1, Math.round(contextLength / 1024));
}
