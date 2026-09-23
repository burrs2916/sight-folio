// sight-folio: 分析器插件体系类型定义
// 对应需求文档 §4.3 AnalyzerManifest / §4.4 实体类型注册 / §4.5 视角模板
// 每种编程语言对应一个分析器插件，通过 AnalyzerManifest 向核心引擎声明自身能力。

/** 分析器插件能力集（§4.3） */
export interface AnalyzerCapabilities {
  /** 代码扫描能力 */
  scanning: boolean;
  /** 审查规则能力 */
  rules: boolean;
  /** 依赖分析能力 */
  dependencyAnalysis: boolean;
  /** 自定义渲染能力 */
  rendering: boolean;
}

/** 实体属性定义 */
export interface PropertyDef {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "color";
  options?: string[];
  default?: unknown;
}

/** 默认图层配置（视角模板内） */
export interface LayerDef {
  /** 图层类型标识 */
  type: string;
  /** 图层显示名称 */
  name: string;
  /** 图层颜色 */
  color: string;
}

/** 画布布局预设（视角模板内） */
export interface ViewLayout {
  scale: number;
  panX: number;
  panY: number;
  grid: boolean;
}

/** 实体类型注册（§4.4 ComponentTypeRegistration） */
export interface ComponentTypeRegistration {
  /** 实体类型标识，如 "module" / "class" / "function" */
  type: string;
  /** 显示名称 */
  name: string;
  /** 图标（MUI icon name） */
  icon: string;
  /** 默认颜色 */
  color: string;
  /** 属性定义 */
  properties: PropertyDef[];
  /** 默认挂载的图层类型 */
  defaultLayer: string;
}

/** 视角模板注册（§4.5 ViewTemplateRegistration） */
export interface ViewTemplateRegistration {
  /** 视角模板标识 */
  type: string;
  /** 显示名称（如 "架构总览" / "依赖关系图"） */
  name: string;
  /** 描述 */
  description: string;
  /** 图标 */
  icon: string;
  /** 默认图层配置 */
  defaultLayers: LayerDef[];
  /** 画布布局预设（缩放、平移、网格） */
  layout: ViewLayout;
}

/** 图层类型注册（LayerTypeRegistry） */
export interface LayerTypeRegistration {
  /** 图层类型标识，如 "presentation" / "business" / "domain" / "infra" */
  type: string;
  /** 图层显示名称 */
  name: string;
  /** 图标（MUI icon name） */
  icon: string;
  /** 默认颜色 */
  color: string;
  /** 描述 */
  description?: string;
}

/** 事件处理器注册（EventHandlerRegistry） */
export interface EventHandlerRegistration {
  /** 触发事件标识，如 "entity:click" / "entity:hover" */
  event: string;
  /** 处理器标识，如 "navigate-to-source" */
  handlerId: string;
  /** 处理器显示名称 */
  name: string;
  /** 描述 */
  description?: string;
}

/** 规则严重度 */
export type RuleSeverity = "critical" | "warning" | "info";

/** 规则分类 */
export type RuleCategory = "complexity" | "coupling" | "layering" | "metadata" | "metric";

/** 规则注册（RuleRegistry） */
export interface RuleRegistration {
  /** 规则唯一标识 */
  id: string;
  /** 规则显示名称 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 严重度 */
  severity: RuleSeverity;
  /** 规则分类 */
  category: RuleCategory;
}

/** 分析器插件清单（§4.3 AnalyzerManifest） */
export interface AnalyzerManifest {
  /** 唯一标识，如 "typescript-analyzer" */
  id: string;
  /** 显示名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 支持的语言（展示名，如 "C/C++"）。实际匹配后端 detect_language 返回的小写 id */
  language: string;
  /**
   * 语言别名（小写 id 列表），用于匹配后端 detect_language 返回的语言标记。
   * 当展示名无法直接等于后端 id 时使用，例如 C/C++ 插件声明 ["cpp","c"]，
   * 否则 activateAnalyzerForLanguage("cpp") 永远匹配不到 "C/C++"。
   */
  languageAliases?: string[];
  /**
   * 语言分组的短展示名（i18n key），实体图鉴「按语言」分组标签用。
   * 缺省回退 manifest.name（全名，如「小说写作分析器」——作分组标签太长）。
   */
  langNameKey?: string;
  /** 插件能力集 */
  capabilities: AnalyzerCapabilities;
  /** 插件注册的实体类型 */
  entityTypes: ComponentTypeRegistration[];
  /** 插件注册的视角模板 */
  viewTemplates: ViewTemplateRegistration[];
  /** 插件注册的图层定义 */
  layerTypes: LayerTypeRegistration[];
  /** 插件注册的事件处理器 */
  eventHandlers: EventHandlerRegistration[];
  /** 插件注册的审查规则 */
  rules: RuleRegistration[];
}
