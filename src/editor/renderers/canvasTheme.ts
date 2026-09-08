// project-sight: 画布实体渲染器的「零 Emotion」主题令牌
//
// ─── 为什么需要这个文件（R37 卡顿攻坚的第四刀）───────────────────────────
//
// 画布上的实体渲染器（FileRenderer / ModuleRenderer / …）此前全部用 MUI 的
// `<Box sx={...}>` / `<Typography sx={...}>` / `<Tooltip>` 搭建。单个文件实体
// 就是 18 个 Box + 4 个 Typography + 4 个 Tooltip = **26 个 emotion styled 组件**。
// 每一个都要：
//   1. 把 sx 对象跑一遍 theme 解析（`px: 1` → `padding: 8px`，`bgcolor: "info.main"`
//      → 调色板查表）
//   2. emotion serializeStyles：对象 → CSS 字符串 → stylis 预处理 → hash
//   3. 判断 hash 是否已注入，未注入则 insertRule 进 <style>
// 而 Tooltip 更贵：每个实例带 useId / 4 个 useTimeout / useIsFocusVisible /
// Popper 占位与一整套事件绑定。
//
// 实测（jsdom 基准 `__bench__/renderCost.test.tsx`）：挂 200 个文件实体要
// **330ms**，平移导致的重挂载每轮 **210ms**。而画布虚拟化正是靠「进出视口时
// 挂载/卸载实体」工作的 —— 越平移越卡，根因就在这里。
//
// ─── 解法 ─────────────────────────────────────────────────────────────────
//
// 画布实体是**高频、大批量、样式高度动态**的场景，恰好是 CSS-in-JS 最不划算
// 的地方。改用「纯 DOM 元素 + inline style」：浏览器直接写 style 属性，没有
// 序列化、没有 hash、没有 CSSOM 插入。
//
// 唯一要解决的是「主题从哪来」。好消息是本项目的 AppTheme 已经开启
// `cssVariables: { cssVarPrefix: "template" }` —— MUI 会把整套调色板输出成
// CSS 自定义属性，并挂在 color-scheme 选择器上。于是渲染器只要写
// `color: "var(--template-palette-text-primary, …)"`，**明暗主题切换依然自动
// 生效**，却完全不需要在 JS 里碰 theme 对象。
//
// 本文件就是这批变量引用的唯一出处：改主题令牌只改这里，不必翻遍渲染器。
// 每个值都带 fallback，保证渲染器在没有 ThemeProvider 的环境（单测、独立预览
// 窗口）里也不会变成透明或黑块。

/** MUI CSS 变量前缀（与 `AppTheme.tsx` 的 `cssVarPrefix` 保持一致） */
const P = "--template-palette";

/**
 * 画布调色板。值形如 `var(--template-palette-x-y, 兜底色)`，可直接写进
 * inline style 的任何颜色位置。
 */
export const CV = {
  paper: `var(${P}-background-paper, #ffffff)`,
  bgDefault: `var(${P}-background-default, #ffffff)`,
  divider: `var(${P}-divider, rgba(0,0,0,0.12))`,
  text: `var(${P}-text-primary, rgba(0,0,0,0.87))`,
  text2: `var(${P}-text-secondary, rgba(0,0,0,0.6))`,
  text3: `var(${P}-text-disabled, rgba(0,0,0,0.38))`,
  primary: `var(${P}-primary-main, #1976d2)`,
  primaryLight: `var(${P}-primary-light, #42a5f5)`,
  onPrimary: `var(${P}-primary-contrastText, #fff)`,
  success: `var(${P}-success-main, #2e7d32)`,
  onSuccess: `var(${P}-success-contrastText, #fff)`,
  info: `var(${P}-info-main, #0288d1)`,
  onInfo: `var(${P}-info-contrastText, #fff)`,
  warning: `var(${P}-warning-main, #ed6c02)`,
  onWarning: `var(${P}-warning-contrastText, #fff)`,
  error: `var(${P}-error-main, #d32f2f)`,
  grey500: `var(${P}-grey-500, #9e9e9e)`,
  white: `var(${P}-common-white, #fff)`,

  // ── 柔和底色（soft）──────────────────────────────────────────────────
  // 注意：这里不是简单的重命名。旧渲染器写的是 `bgcolor: "info.soft"` /
  // `"warning.soft"`，但本项目的主题**从未定义过 soft 这一级** —— MUI 查表
  // 落空后会把字符串原样当 CSS 颜色输出，浏览器判为非法值直接丢弃，
  // 结果是模块卡/目录卡长期**没有底色**，只剩一圈边框浮在画布上。
  // 换成半透明实色：一份值在明暗两套主题下都成立（浅色上是淡彩，深色上是提亮），
  // 不需要为此引入 color-mix（旧版 WebView 不一定支持）。
  // R38：0.12 → 0.20 提亮 —— 用户反馈「颜色太暗淡」，12% 透明度的底色在
  // 浅色画布上几乎看不见，实体之间只能靠边框分辨，局促感由此而来。
  infoSoft: "rgba(59,130,246,0.20)",
  warningSoft: "rgba(245,158,11,0.20)",
} as const;

/**
 * 由主题色生成卡片淡底渐变（hex → 带 alpha 的 8 位 hex 拼接）。
 *
 * 专为「卡片底色提亮」设计（R38）：135° 方向从 15%~26% 透明度淡出到 4%，
 * 浅色画布上比纯白卡片有明确辨识度，深色画布上不会糊成一片。
 * 输入必须是 `#RRGGBB` 形式的 hex —— 各实体渲染器的 accent 常量
 * （CLASS_PURPLE / INTERFACE_PINK / LANG_COLORS / COMPLEXITY_COLORS …）
 * 全部满足；带 var() 或 rgba() 的串不能拼，走各自分支。
 */
export function tintGradient(hex: string, strong = 0x26, weak = 0x0a): string {
  const s = strong.toString(16).padStart(2, "0");
  const w = weak.toString(16).padStart(2, "0");
  return `linear-gradient(135deg, ${hex}${s} 0%, ${hex}${w} 60%, transparent 100%)`;
}

/**
 * 实体卡片圆角。原为 `var(--template-shape-borderRadius, 6px)` 跟随全局设置，
 * 但画布卡片是「高密度信息单元」而非普通表单控件 —— 6px 在大批量网格里
 * 显得生硬、卡顿感更明显。画布统一用 10px 更圆润的 premium 圆角，让上百张
 * 卡片并置时视觉更柔和、呼吸感更好（不再跟随全局圆角设置，画布有独立视觉语言）。
 */
export const CV_RADIUS = "10px";

/**
 * MUI `boxShadow: 1` 的等价字面量。角标用它拉出层次感；写成常量而不是让 MUI
 * 去查 `theme.shadows[1]`，是因为画布上同时存在几百个角标。
 */
export const SHADOW_1 =
  "0px 2px 1px -1px rgba(0,0,0,0.2),0px 1px 1px 0px rgba(0,0,0,0.14),0px 1px 3px 0px rgba(0,0,0,0.12)";

/**
 * 实体类型严格形状语言（R 形状语言：建模工具式可辨识轮廓）。
 * 每种实体在画布上有唯一 silhouette，远看即可区分类型，不再共用同一圆角矩形。
 *   file     → 折角文档（右上 dog-ear）
 *   folder   → 顶部标签（容器）
 *   module   → 层叠（背后错位描边）
 *   class    → 三段框（两条横向分隔线）
 *   interface→ 左侧 lollipop（圆点 + 引线）
 *   function → 全胶囊（pill）
 */
export type EntityShape = "file" | "folder" | "module" | "class" | "interface" | "function" | "image" | "default";

/** 各形状专属圆角（function 用超大值实现 pill） */
export function shapeRadius(shape: EntityShape): string {
  switch (shape) {
    case "file":
      return "8px";
    case "image":
      return "8px"; // 与 file 同属「文档类」轮廓家族，差异由图标 + 配色承担
    case "class":
      return "6px";
    case "interface":
      return "13px";
    case "function":
      return "999px";
    default:
      return "10px";
  }
}

/**
 * 实体卡片外壳的公共样式。所有项目实体渲染器（file/module/class/…）都是
 * 「撑满父容器 + 横向排布 + 左侧色条 + 右侧文字」的同一形态，抽出来避免
 * 每个渲染器各写一遍，也保证视觉一致。
 *
 * 注意：返回的是**新对象**。inline style 每次新建对象几乎零成本（React 只做
 * 浅比较后逐属性 setProperty），与 emotion 的「序列化 + hash + 插入」不是一个
 * 量级 —— 这正是本次重构的收益来源。
 */
export function shellStyle(opts: {
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed";
  opacity?: number;
  /** 实体类型形状（R 形状语言）：决定专属圆角 */
  shape?: EntityShape;
  extra?: React.CSSProperties;
}): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    gap: 6,
    // 垂直留白 3px：小卡片（高 32~40px）不再让内容贴边，整体更透气；
    // 水平留白 8 → 10px：色条与文字、文字与右边界拉开，密集网格下不挤。
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 10,
    paddingRight: 10,
    boxSizing: "border-box",
    background: opts.background ?? CV.paper,
    // border 拆三属性（不用简写）：Module/Class/Function 渲染器外部会叠加
    // borderLeft（承重左边框），简写 + 非简写混用触发 React
    // "Removing a style property during rerender" 警告（v2.8 修复）。
    borderWidth: opts.borderWidth ?? 1,
    borderStyle: opts.borderStyle ?? "solid",
    borderColor: opts.borderColor ?? CV.divider,
    borderRadius: opts.shape ? shapeRadius(opts.shape) : CV_RADIUS,
    position: "relative",
    overflow: "hidden",
    opacity: opts.opacity,
    ...opts.extra,
  };
}

/** 左侧语言/热力色条（绝对定位，宽 3px 通高；R38 支持加宽到 4px 提亮） */
export function stripeStyle(color: string, opacity = 0.7, width = 3): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height: "100%",
    backgroundColor: color,
    opacity,
  };
}

/** 画像徽标（符号数 / 引用数 / 技术债 …）的小色块 */
export function badgeStyle(bg: string, color: string = CV.white): React.CSSProperties {
  return {
    fontSize: 9,
    lineHeight: 1,
    padding: "2px 3px",
    borderRadius: 3,
    backgroundColor: bg,
    color,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

/**
 * AI 洞察药丸（标题行首的实底小标签）。
 *
 * ─── 为什么不做成第四个圆点 ────────────────────────────────────────────
 * 画布上已经有三个圆点在表达静态指标（右上=复杂度、右下=git 变更热度、
 * 左下=重复代码）。AI 洞察是**另一种性质的信息**：前三者是扫描算出来的客观
 * 数值，它是模型给出的判断。再加第四个同款圆点，用户分不清哪个是"机器数的"、
 * 哪个是"AI 说的"，四个角还全被占满。药丸形 + "AI" 字样本身就是区分标识，
 * 不需要对照图例。
 *
 * ─── 为什么是内联而不是绝对定位 ────────────────────────────────────────
 * 四个角里唯一空着的是左上角，但文件卡的标题正好从那里起排 —— 绝对定位的角标
 * 会直接盖住文件名。放在标题行首参与 flex 排布，既不遮挡，又占据视线最先落点。
 */
export function insightBadgeStyle(color: string): React.CSSProperties {
  return {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    height: 12,
    padding: "0 4px",
    borderRadius: 6,
    backgroundColor: color,
    color: "#fff",
    fontSize: 8,
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: 0.2,
    whiteSpace: "nowrap",
    boxShadow: `0 0 6px ${color}80`,
  };
}

/** 标题行容器：让「AI 药丸 + 标题」并排且标题仍可省略号截断 */
export const TITLE_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
};

/** 右上/右下角的圆形热力角标 */
export function dotStyle(
  color: string,
  pos: { top?: number; bottom?: number; left?: number; right?: number },
  square = false
): React.CSSProperties {
  return {
    position: "absolute",
    ...pos,
    width: 7,
    height: 7,
    borderRadius: square ? 2 : "50%",
    backgroundColor: color,
    boxShadow: `0 0 6px ${color}`,
  };
}

/** 实体主标题（文件名 / 模块名 / 类名）：单行省略（R39：11 → 12px，全览可读性） */
export const TITLE_STYLE: React.CSSProperties = {
  fontWeight: 500,
  fontSize: 12,
  lineHeight: 1.4,
  color: CV.text,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  margin: 0,
};

/** 加粗版主标题（模块/类/接口用 600） */
export const TITLE_BOLD_STYLE: React.CSSProperties = { ...TITLE_STYLE, fontWeight: 600 };

/** 副信息行（横向排布的小字 + 徽标） */
export const META_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  flexWrap: "wrap",
};

/** 副信息小字（R39：默认色 text3 → text2 —— 0.38 透明度的灰在全览时「像素太虚」；v2.12：字号 9.5 → 10.5 全览可读） */
export function metaStyle(color: string = CV.text2, weight = 400, size = 10.5): React.CSSProperties {
  return { fontSize: size, lineHeight: 1.3, color, fontWeight: weight };
}

/** 文字区（占据剩余宽度，允许省略号） */
export const BODY_STYLE: React.CSSProperties = { minWidth: 0, flex: 1 };

/** 图标区（不压缩） */
export const ICON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  marginLeft: 4,
  display: "flex",
  alignItems: "center",
};
