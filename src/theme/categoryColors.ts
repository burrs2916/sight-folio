// sight-folio: 分类/状态语义色 token
// -----------------------------------------------------------------------------
// 画像菜单（SceneEditorPage 工具栏「更多画像」）与画板菜单（写作预设板）的
// 图标辨识色，以及「文件监视中」状态色。原为页面内散落的十六进制字面量，
// 这里收敛为单一数据源：同组视觉用同一命名 token，改一处全组生效。
// 注意：这些色与主题 palette 的语义色（primary/success/error…）无依赖，
// 仅服务于画像分类的图标辨识，不改动既有业务色值。

/** 画像/画板菜单图标的分类辨识色（按语义命名，而非按画像 key 命名） */
export const PORTRAIT_ICON_COLORS = {
  /** 结构/关系类（moduleGraph、callGraph、overview、storyboard） */
  violet: '#8b5cf6',
  /** 组织/文档类（directory、changeCoupling、techDebt、docsCoverage、relation） */
  amber: '#f59e0b',
  /** 接口/符号类（symbols、apiTrace） */
  blue: '#3b82f6',
  /** 架构/依赖类（dependency、architecture） */
  indigo: '#6366f1',
  /** 关联/协作类（coupling、busFactor） */
  fuchsia: '#a855f7',
  /** 分层/扩散类（layering、ripple） */
  sky: '#0ea5e9',
  /** 数据/重复类（dataFlow、duplication、commentRatio） */
  teal: '#14b8a6',
  /** 执行/覆盖类（executionFlow、testCoverage） */
  green: '#22c55e',
  /** 风险/缺陷类（taintFlow、hotspotFunctions、risk、syntax、security） */
  red: '#ef4444',
  /** 模式/接口面类（patterns、apiSurface） */
  cyan: '#38bdf8',
  /** 分布/象限类（quadrant） */
  purple: '#d946ef',
  /** 复杂度/健壮性类（complexity、errorHandling） */
  orange: '#f97316',
  /** 变更/热度类（churn） */
  pink: '#ec4899',
  /** 存量/日志类（deadCode、logging） */
  slate: '#64748b',
} as const;

/** 未知体裁时的画像兜底色（原为散落的 #8b5cf6） */
export const PORTRAIT_FALLBACK_COLOR = PORTRAIT_ICON_COLORS.violet;

/** 「文件监视中」状态色（watching 圆点/文字/徽标，原为散落的 #4caf50） */
export const WATCHING_STATUS_COLOR = '#4caf50';
