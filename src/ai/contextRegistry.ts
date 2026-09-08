import type { AiContextProvider } from "./contextTypes";

/**
 * AI 上下文供给注册表（单例）。
 *
 * 与 analyzerRegistry / componentRegistry 同构：模块自己往里注册，AI 层只按协议消费。
 * 现阶段只有项目扫描一个供给者；未来画布、报告、设备等模块接入时，
 * 只需实现 AiContextProvider 并 register，AI 层与 UI 无需任何改动。
 */
class AiContextRegistry {
  private providers = new Map<string, AiContextProvider>();

  register(provider: AiContextProvider): void {
    if (this.providers.has(provider.moduleId)) {
      console.warn(`[aiContextRegistry] 模块 ${provider.moduleId} 重复注册，已覆盖`);
    }
    this.providers.set(provider.moduleId, provider);
  }

  unregister(moduleId: string): void {
    this.providers.delete(moduleId);
  }

  get(moduleId: string): AiContextProvider | undefined {
    return this.providers.get(moduleId);
  }

  list(): AiContextProvider[] {
    return Array.from(this.providers.values());
  }

  /** 列出在指定作用域下确实有数据可供给的模块 */
  listAvailable(scopeId: string): AiContextProvider[] {
    return this.list().filter((p) => {
      try {
        return p.isAvailable(scopeId);
      } catch (err) {
        console.error(`[aiContextRegistry] ${p.moduleId}.isAvailable 抛错`, err);
        return false;
      }
    });
  }
}

export const aiContextRegistry = new AiContextRegistry();
