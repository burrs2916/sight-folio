// sight-folio: 实体图标统一映射
// 分析器插件注册的实体 icon 名（ComponentTypeRegistration.icon / ComponentDefinition.icon）
// → MUI 图标组件。所有展示实体图标的地方（实体管理页 / 画像卡 / 面板）统一从这里解析，
// 避免各处各自硬编码导致 class/function/interface 图标撞车。
//
// ─── 解析规则：具体优先于通用（本文件的立身之本）───
// 调用方手里未必有 icon 名：画布/预览这类路径只拿得到实体 **type**（struct/trait/crate…）。
// 早期版本只按 icon 名单表查，type 传进来必然全部落空 → 结构体/Trait/Crate 一律显示成
// 通用扩展图标。后来补了 type 级兜底，但把"icon 名"无条件排在第一优先级，
// 于是又踩进第二个坑，且这个坑更隐蔽：
//
//   分析器作者手边没有贴切的 icon 名时，会**顺手复用一个粗粒度的名字**。
//   实测 cpp/csharp/go/rust/swift 五家都把 struct 声明成 `view_module`（= 类图标），
//   rustAnalyzer 把 trait 声明成 `extension` —— 那正好就是通用回退图标本身。
//   结果：「类」和「结构体」在实体管理里长得一模一样，Trait 看起来像"没图标"。
//   type 级映射明明有正确答案（struct→DataObject、trait→Api），却被 icon 名挡在门外。
//
// 所以优先级不能按"来源"排（插件声明 > 内置兜底），而要按**信息量**排：
//   1) icon 名精确命中，且不属于粗粒度名单 → 采信（插件的精确声明最权威）
//   2) 否则先试 type 级映射（struct/trait/crate 这类语义在这里才有精确答案）
//   3) 再退回粗粒度 icon 名的映射（比通用回退强）
//   4) 全落空才用通用图标 —— 回退必须是罕见事件，不能是常态
//
// 这条规则同时是**防复发**的：以后新增分析器再顺手写 `view_module`，
// 也不会把结构体的图标顶掉。
import type { ComponentType, ReactNode } from "react";
import DescriptionIcon from "@mui/icons-material/Description";
import FolderIcon from "@mui/icons-material/Folder";
import InventoryIcon from "@mui/icons-material/Inventory2";
import ArchiveIcon from "@mui/icons-material/Archive";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import DataObjectIcon from "@mui/icons-material/DataObject";
import FunctionsIcon from "@mui/icons-material/Functions";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import HubIcon from "@mui/icons-material/Hub";
import LinkIcon from "@mui/icons-material/Link";
import LayersIcon from "@mui/icons-material/Layers";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import CodeIcon from "@mui/icons-material/Code";
import ExtensionIcon from "@mui/icons-material/Extension";
import ApiIcon from "@mui/icons-material/Api";
import DashboardIcon from "@mui/icons-material/AutoAwesomeMosaic";
import BusinessCenterIcon from "@mui/icons-material/BusinessCenter";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import ClassIcon from "@mui/icons-material/Class";
import DiamondIcon from "@mui/icons-material/Diamond";
import DnsIcon from "@mui/icons-material/Dns";
import DomainIcon from "@mui/icons-material/Domain";
import DeviceHubIcon from "@mui/icons-material/DeviceHub";
import ScatterPlotIcon from "@mui/icons-material/ScatterPlot";
import ImageIcon from "@mui/icons-material/Image";
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import WarningIcon from "@mui/icons-material/WarningAmber";
import WebIcon from "@mui/icons-material/Web";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import ShieldIcon from "@mui/icons-material/GppMaybe";
import SchemaIcon from "@mui/icons-material/Schema";
import SyncAltIcon from "@mui/icons-material/SyncAlt";
import SpeedIcon from "@mui/icons-material/Speed";
import WidgetsIcon from "@mui/icons-material/Widgets";

/**
 * icon 名 → 图标组件。
 *
 * 这张表必须覆盖 **所有** 分析器插件里出现过的 icon 名，
 * 漏一个就退化成通用图标且不报错 —— 是最难被发现的一类 UI 缺陷。
 * 新增分析器时若声明了新 icon 名，同步在这里补一行。
 */
const ICON_COMPONENTS: Record<string, ComponentType<any>> = {
  // ─── 核心实体 ───
  description: DescriptionIcon, // 文件
  image: ImageIcon, // 图片资源（png/jpg/svg/ico…）
  font_download: FontDownloadIcon, // 资源文件（字体/媒体/压缩/二进制）
  folder: FolderIcon, // 文件夹
  inventory: ArchiveIcon, // 包 / Crate（与 module 必须可区分）
  inventory_2: InventoryIcon, // 模块
  // ─── 代码符号 ───
  view_module: ViewModuleIcon, // 类
  class: ClassIcon, // 类（显式声明）
  data_object: DataObjectIcon, // 结构体 / 纯数据聚合（与"类"必须能一眼区分）
  functions: FunctionsIcon, // 函数（ƒ 符号）
  account_tree: AccountTreeIcon, // 接口 / 架构总览
  hub: HubIcon, // 依赖图 / 节点
  diamond: DiamondIcon, // 数据类 / 值对象（Kotlin data class 等）
  api: ApiIcon, // 协议 / 契约 / Trait
  // ─── 分析元素 ───
  link: LinkIcon, // 依赖关系
  layers: LayersIcon, // 架构分层
  text_fields: TextFieldsIcon, // 标注文本
  code: CodeIcon, // 代码预览
  extension: ExtensionIcon, // 通用 / 插件式扩展点
  family_tree: DeviceHubIcon, // 继承关系
  call_split: CallSplitIcon, // 调用链 / 协程流
  scatter_plot: ScatterPlotIcon, // 散点 / 耦合分布
  auto_awesome_mosaic: DashboardIcon, // 组件树 / 拼图式总览
  thumbnail: ImageIcon, // 缩略图
  warning: WarningIcon, // 风险视图（unsafe 等）
  whatshot: WhatshotIcon, // 复杂度热度
  // ─── 架构分层图标 ───
  web: WebIcon, // 表现层
  business_center: BusinessCenterIcon, // 业务层
  domain: DomainIcon, // 领域层
  dns: DnsIcon, // 基础设施层
};

/**
 * 实体 type → 图标组件（第二级兜底）。
 *
 * 用于调用方只有 type 没有 icon 名的场景（画布预览、画像卡缩略图）。
 * 语义按"这个东西在代码里是什么"来选，而不是照抄某个语言的习惯 ——
 * 同一个 struct 在 Rust/Go/C++ 里都该长一样。
 */
const TYPE_ICONS: Record<string, ComponentType<any>> = {
  // 容器（四者必须互不相同：它们经常同屏出现在同一棵目录树里）
  file: DescriptionIcon,
  image: ImageIcon, // 图片资源（与 file 必须可一眼区分）
  asset: FontDownloadIcon, // 资源文件（字体/媒体/压缩/二进制，与 file/image 可区分）
  folder: FolderIcon,
  module: InventoryIcon,
  package: ArchiveIcon,
  crate: WidgetsIcon, // Crate = Rust 编译/分发单元，与语言无关的"包"区分开
  // 符号
  class: ClassIcon,
  struct: DataObjectIcon, // 结构体 = 纯数据聚合，与"类"必须能一眼区分
  trait: ApiIcon, // Trait / Protocol = 行为契约
  interface: AccountTreeIcon,
  function: FunctionsIcon,
  // 分析元素
  "dependency-edge": LinkIcon,
  dependency: HubIcon,
  "layer-marker": LayersIcon,
  layering: LayersIcon,
  "annotation-text": TextFieldsIcon,
  "code-preview": CodeIcon,
  "pattern-node": ExtensionIcon,
  // 视图型实体
  architecture: SchemaIcon,
  inheritance: DeviceHubIcon,
  "interface-impl": SyncAltIcon,
  "call-graph": CallSplitIcon,
  "coroutine-flow": CallSplitIcon,
  "component-tree": DashboardIcon,
  complexity: SpeedIcon,
  coupling: ScatterPlotIcon,
  "unsafe-risk": ShieldIcon,
};

/**
 * 粗粒度 icon 名：语义太宽，多个不同实体类型都会声明它。
 *
 * 命中这些名字时**不直接采信**，先让位给 type 级映射；只有 type 也没有答案
 * 才退回来用它。判定标准只有一条：**这个名字是否被语义不同的多个 type 共用过**。
 * - `view_module`：class 与 struct 共用（五个分析器实测）
 * - `extension`  ：就是通用回退图标本身，等价于"没图标"
 * - `account_tree`：interface / architecture / 协议 / Module 混入 混用
 * - `description`：file 与 module（"源文件"）混用
 * - `hub`        ：dependency 与 interface-impl 混用
 * - `inventory`  ：package 与 crate 混用
 * - `folder`     ：folder 与 python 的 package 混用
 * - `family_tree`：inheritance 与 component-tree 混用
 */
const COARSE_ICON_NAMES = new Set([
  "view_module",
  "extension",
  "account_tree",
  "description",
  "hub",
  "inventory",
  "folder",
  "family_tree",
]);

/** 该 icon 名 / type 是否有精确图标（false 表示会走通用回退，供测试与开发期自检） */
export function hasEntityIcon(key: string | undefined): boolean {
  if (!key) return false;
  return key in ICON_COMPONENTS || key in TYPE_ICONS;
}

/**
 * 解析实体图标组件（具体优先于通用，四级，见文件头说明）。
 *
 * @param icon  插件声明的 icon 名
 * @param type  实体 type —— 对 struct/trait/crate 这类语义，这里才有精确答案
 */
export function resolveEntityIconComponent(
  icon?: string,
  type?: string
): ComponentType<any> {
  // 1) icon 名精确且不粗粒度 → 采信插件声明
  if (icon && !COARSE_ICON_NAMES.has(icon)) {
    const byIcon = ICON_COMPONENTS[icon];
    if (byIcon) return byIcon;
    // 插件把 type 当 icon 传进来的历史调用点也能兜住
    const iconAsType = TYPE_ICONS[icon];
    if (iconAsType) return iconAsType;
  }
  // 2) type 级语义映射（结构体/Trait/Crate/标注文本在这一级拿到正确图标）
  if (type) {
    const byType = TYPE_ICONS[type];
    if (byType) return byType;
    const typeAsIcon = ICON_COMPONENTS[type];
    if (typeAsIcon) return typeAsIcon;
  }
  // 3) 粗粒度 icon 名兜底（仍强于通用回退）
  if (icon) {
    const coarse = ICON_COMPONENTS[icon] ?? TYPE_ICONS[icon];
    if (coarse) return coarse;
  }
  // 4) 通用回退
  return ExtensionIcon;
}

/** 按 icon 名（可选 type 兜底）解析图标元素 */
export function resolveEntityIcon(
  icon: string | undefined,
  fontSize = 18,
  type?: string
): ReactNode {
  const Cmp = resolveEntityIconComponent(icon, type);
  return <Cmp sx={{ fontSize }} />;
}
