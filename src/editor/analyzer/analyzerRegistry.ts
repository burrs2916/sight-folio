// sight-folio: 分析器插件注册表（核心引擎侧）
// 对应需求文档 §4.2 插件架构图中的"Analyzer 插件注册表"：
//   ├─ ComponentTypeRegistry（实体类型注册）→ 桥接 componentRegistry
//   ├─ ViewTemplateRegistry（视角模板注册）
//   ├─ LayerTypeRegistry（图层类型注册）
//   ├─ EventHandlerRegistry（事件处理器注册）
//   └─ RuleRegistry（规则引擎注册）
// 使用 useSyncExternalStore 订阅机制，UI 可实时响应插件加载/切换。

import { useSyncExternalStore } from "react";
import { componentRegistry } from "../registryCore";
import { t, resolveFragments } from "../../i18n";
import type {
  AnalyzerManifest,
  ComponentTypeRegistration,
  EventHandlerRegistration,
  LayerTypeRegistration,
  RuleRegistration,
  ViewTemplateRegistration,
} from "./types";

/** 子注册表条目：记录所属分析器 id */
interface RegistryEntry<T> {
  analyzerId: string;
  item: T;
}

class AnalyzerRegistryImpl {
  private manifests = new Map<string, AnalyzerManifest>();
  private viewTemplates = new Map<string, RegistryEntry<ViewTemplateRegistration>>();
  private layerTypes = new Map<string, RegistryEntry<LayerTypeRegistration>>();
  private eventHandlers = new Map<string, RegistryEntry<EventHandlerRegistration>>();
  private rules = new Map<string, RegistryEntry<RuleRegistration>>();

  /** 已激活的分析器插件集合（混合项目可同时激活多个语言插件） */
  private activeIds = new Set<string>();
  /** 主插件（当前选中/优先展示；PluginSelector 与顶栏 chip 使用） */
  private primaryId: string | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  // ─── 插件生命周期 ───

  /** 注册一个分析器插件（加载 → 注册实体/视角/图层/事件/规则 → 就绪） */
  register(manifest: AnalyzerManifest): void {
    if (this.manifests.has(manifest.id)) {
      console.warn(`[AnalyzerRegistry] Analyzer "${manifest.id}" already registered, overwriting.`);
      this.unregisterInternal(manifest.id);
    }
    this.manifests.set(manifest.id, manifest);

    // 视角模板（内部 key 带 analyzerId 命名空间：不同插件可注册同名模板类型，
    // 如 architecture/dependency，互不覆盖 —— §4.1"每种语言一个插件"共存的前提）
    for (const vt of manifest.viewTemplates) {
      this.viewTemplates.set(`${manifest.id}:${vt.type}`, { analyzerId: manifest.id, item: vt });
    }
    // 图层类型（同样带命名空间：business/domain/infra 等通用图层名各插件独立）
    for (const lt of manifest.layerTypes) {
      this.layerTypes.set(`${manifest.id}:${lt.type}`, { analyzerId: manifest.id, item: lt });
    }
    // 事件处理器（命名空间 + event + handlerId）
    for (const eh of manifest.eventHandlers) {
      const key = `${manifest.id}:${eh.event}:${eh.handlerId}`;
      this.eventHandlers.set(key, { analyzerId: manifest.id, item: eh });
    }
    // 规则（命名空间 + rule id）
    for (const r of manifest.rules) {
      this.rules.set(`${manifest.id}:${r.id}`, { analyzerId: manifest.id, item: r });
    }

    // 首个注册的插件自动激活（主插件）
    if (this.activeIds.size === 0) {
      this.activateId(manifest.id, true);
    }

    console.log(
      `[AnalyzerRegistry] Analyzer "${manifest.id}" (${manifest.language}) registered: ` +
        `${manifest.entityTypes.length} entity types, ${manifest.viewTemplates.length} view templates, ` +
        `${manifest.layerTypes.length} layer types, ${manifest.eventHandlers.length} event handlers, ${manifest.rules.length} rules`
    );
    this.emit();
  }

  /** 卸载一个分析器插件（清理注册 → 释放资源） */
  unregister(id: string): boolean {
    if (!this.manifests.has(id)) return false;
    this.unregisterInternal(id);
    this.activeIds.delete(id);
    if (this.primaryId === id) {
      this.primaryId = this.activeIds.size > 0 ? Array.from(this.activeIds)[0] : null;
      if (this.primaryId) {
        const m = this.manifests.get(this.primaryId);
        if (m) this.syncEntityTypes(m);
      }
    }
    this.emit();
    return true;
  }

  private unregisterInternal(id: string): void {
    this.manifests.delete(id);
    for (const [k, v] of this.viewTemplates) if (v.analyzerId === id) this.viewTemplates.delete(k);
    for (const [k, v] of this.layerTypes) if (v.analyzerId === id) this.layerTypes.delete(k);
    for (const [k, v] of this.eventHandlers) if (v.analyzerId === id) this.eventHandlers.delete(k);
    for (const [k, v] of this.rules) if (v.analyzerId === id) this.rules.delete(k);
  }

  // ─── 激活/切换（多插件共存：混合项目可同时激活多个语言插件）───

  /** 内部激活逻辑：加入激活集合并桥接实体类型到 componentRegistry */
  private activateId(id: string, asPrimary: boolean): void {
    this.activeIds.add(id);
    if (asPrimary || !this.primaryId) this.primaryId = id;
    const manifest = this.manifests.get(id);
    if (manifest) this.syncEntityTypes(manifest);
  }

  /** 设置主插件（排他语义：仅切换主展示，其他已激活插件保持激活） */
  setActiveAnalyzer(id: string): boolean {
    const manifest = this.manifests.get(id);
    if (!manifest) {
      console.warn(`[AnalyzerRegistry] Analyzer "${id}" not found.`);
      return false;
    }
    if (this.primaryId !== id || !this.activeIds.has(id)) {
      this.activateId(id, true);
      this.emit();
    }
    return true;
  }

  /** 追加激活一个插件（不改变主插件；用于混合项目自动识别） */
  activateAdditionalAnalyzer(id: string): boolean {
    const manifest = this.manifests.get(id);
    if (!manifest) return false;
    if (!this.activeIds.has(id)) {
      this.activateId(id, false);
      this.emit();
    }
    return true;
  }

  /** 取消激活一个插件（主插件被取消时自动指定新的主插件） */
  deactivateAnalyzer(id: string): boolean {
    if (!this.activeIds.delete(id)) return false;
    if (this.primaryId === id) {
      this.primaryId = this.activeIds.size > 0 ? Array.from(this.activeIds)[0] : null;
      if (this.primaryId) {
        const m = this.manifests.get(this.primaryId);
        if (m) this.syncEntityTypes(m);
      }
    }
    this.emit();
    return true;
  }

  /**
   * 实体类型桥接：把插件声明的 ComponentTypeRegistration 注册为可用的
   * ComponentDefinition（§4.4 ComponentTypeRegistry）。已存在的类型（如
   * file/module 等核心实体）跳过，保持非破坏性。
   */
  private syncEntityTypes(manifest: AnalyzerManifest): void {
    let synced = 0;
    for (const et of manifest.entityTypes) {
      if (componentRegistry.has(et.type)) continue;
      componentRegistry.register({
        type: et.type,
        name: et.name,
        icon: et.icon,
        description: t("analyzer.entityProvidedBy", { analyzer: resolveFragments(manifest.name), entity: resolveFragments(et.name) }),
        category: `analyzer-${manifest.id}`,
        version: manifest.version,
        // 语言维度：取 analyzer 声明的小写 id（languageAliases 须对齐后端 detect_language；
        // 无别名时回退到展示名小写，C# 等需确保声明 aliases）。
        languages: manifest.languageAliases && manifest.languageAliases.length
          ? manifest.languageAliases
          : [manifest.language.toLowerCase()],
        defaultSize: { width: 200, height: 80 },
        defaultConfig: {
          // 解引用为显示文本（IA 修复）：此前存 i18n key，凡落卡未带 name 覆盖的
          // （大纲/便签模板、建档失败降级的壳卡），画布卡标题直接裸显
          // analyzer.writing.entity.*.name。display 侧 resolveFragments 对纯文本原样放行，双向安全。
          name: resolveFragments(et.name),
          entityType: et.type,
          color: et.color,
          layerType: et.defaultLayer,
          ...et.properties.reduce<Record<string, unknown>>((acc, p) => {
            if (p.default !== undefined) acc[p.key] = p.default;
            return acc;
          }, {}),
        },
        capabilities: {
          resizable: true,
          rotatable: false,
          draggable: true,
          connectable: true,
          embeddable: false,
        },
        // 渲染器按实体类型精确分配（每种实体有专属画像渲染器）
        renderer: {
          loader: async () => {
            switch (et.type) {
              case "file":
                return { default: (await import("../renderers/FileRenderer")).FileRenderer };
              case "folder":
                return { default: (await import("../renderers/FolderRenderer")).FolderRenderer };
              case "module":
                return { default: (await import("../renderers/ModuleRenderer")).ModuleRenderer };
              case "class":
                return { default: (await import("../renderers/ClassRenderer")).ClassRenderer };
              case "function":
                return { default: (await import("../renderers/FunctionRenderer")).FunctionRenderer };
              case "interface":
                return { default: (await import("../renderers/InterfaceRenderer")).InterfaceRenderer };
              default:
                return { default: (await import("../renderers/ModuleRenderer")).ModuleRenderer };
            }
          },
        },
        builtIn: true,
        enabled: true,
      });
      synced++;
    }
    if (synced > 0) {
      console.log(`[AnalyzerRegistry] Synced ${synced} entity types from "${manifest.id}" to componentRegistry`);
    }
  }

  // ─── 查询 ───

  getAnalyzer(id: string): AnalyzerManifest | undefined {
    return this.manifests.get(id);
  }

  getAllAnalyzers(): AnalyzerManifest[] {
    return Array.from(this.manifests.values());
  }

  /** 主插件（当前选中/优先展示） */
  getActiveAnalyzer(): AnalyzerManifest | null {
    return this.primaryId ? this.manifests.get(this.primaryId) ?? null : null;
  }

  getActiveAnalyzerId(): string | null {
    return this.primaryId;
  }

  /** 全部已激活插件 id（主插件 + 附加插件） */
  getActiveAnalyzerIds(): string[] {
    return Array.from(this.activeIds);
  }

  /** 指定插件是否处于激活状态 */
  isAnalyzerActive(id: string): boolean {
    return this.activeIds.has(id);
  }

  /** 视角模板注册表（ViewTemplateRegistry） */
  getViewTemplates(analyzerId?: string): ViewTemplateRegistration[] {
    const all = Array.from(this.viewTemplates.values());
    const filtered = analyzerId ? all.filter((e) => e.analyzerId === analyzerId) : all;
    return filtered.map((e) => e.item);
  }

  /** 图层类型注册表（LayerTypeRegistry） */
  getLayerTypes(analyzerId?: string): LayerTypeRegistration[] {
    const all = Array.from(this.layerTypes.values());
    const filtered = analyzerId ? all.filter((e) => e.analyzerId === analyzerId) : all;
    return filtered.map((e) => e.item);
  }

  /** 事件处理器注册表（EventHandlerRegistry） */
  getEventHandlers(analyzerId?: string): EventHandlerRegistration[] {
    const all = Array.from(this.eventHandlers.values());
    const filtered = analyzerId ? all.filter((e) => e.analyzerId === analyzerId) : all;
    return filtered.map((e) => e.item);
  }

  /** 规则引擎注册表（RuleRegistry） */
  getRules(analyzerId?: string): RuleRegistration[] {
    const all = Array.from(this.rules.values());
    const filtered = analyzerId ? all.filter((e) => e.analyzerId === analyzerId) : all;
    return filtered.map((e) => e.item);
  }

  // ─── 订阅机制（useSyncExternalStore 友好） ───

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }
}

export const analyzerRegistry = new AnalyzerRegistryImpl();

/** React Hook：订阅注册表版本号，任何插件注册/切换都会触发重渲染 */
export function useAnalyzerVersion(): number {
  return useSyncExternalStore(analyzerRegistry.subscribe, analyzerRegistry.getVersion, analyzerRegistry.getVersion);
}

/** 便捷 Hook：当前激活的分析器插件 */
export function useActiveAnalyzer(): AnalyzerManifest | null {
  useAnalyzerVersion();
  return analyzerRegistry.getActiveAnalyzer();
}

/** 便捷 Hook：全部已激活的分析器插件 */
export function useActiveAnalyzerIds(): string[] {
  useAnalyzerVersion();
  return analyzerRegistry.getActiveAnalyzerIds();
}
