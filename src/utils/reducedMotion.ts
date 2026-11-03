// 「减少动效」偏好的 JS 侧读数（第二十六轮）
//
// 为什么 CSS 之外还要一条通道：动效偏好（应用内 reduce 档 / 系统 prefers-reduced-motion）
// 由 theme/AppTheme.tsx 的 MuiCssBaseline 注入全局 `*` 规则，其中 `scroll-behavior: auto !important`
// 只能管「没显式指定行为」的滚动；代码里 `el.scrollIntoView({ behavior: 'smooth' })` 是**显式 smooth**，
// 规范上优先于 CSS。实测口径：档位开着，项目树定位 / 校对结论跳转 / 扫描文件定位 / 语料分组揭示 /
// 时间线新卡定位 / AI 对话滚底仍然一路平滑滑行 —— 用户点了「减少动效」却还在动。
//
// 口径与 themeStore 的 systemMode 一致：档位 + 系统读数一起解析（resolveMotionWithSystem 唯一真源），
// 换算只在 appearanceScales.scrollBehaviorForMotion 一处。
//
// 为什么是「现取」而不是 hook：这些都是**一次性动作**（点击后滚一下），不需要因为档位变化重渲染；
// 而 effect / callback 里的闭包会把订阅来的旧值冻住 —— 与写作偏好防抖窗口同一口径（见 WritingPage
// 里 `useWritingPrefsStore.getState()` 现取的注释）。做成 hook 反而制造一个没人订阅的读数。
import { useThemeStore, resolveMotionWithSystem } from '../store/themeStore';
import { scrollBehaviorForMotion } from '../theme/appearanceScales';

/** 本窗口此刻是否真的要压缩动效（档位 reduce，或档位 auto 且系统开了「减弱动态效果」） */
export function isMotionReduced(): boolean {
  const { config, systemReducedMotion } = useThemeStore.getState();
  return resolveMotionWithSystem(config.motion, systemReducedMotion);
}

/**
 * JS 滚动 API 此刻该用的 behavior。
 * 用法：`el.scrollIntoView({ block: 'nearest', behavior: currentScrollBehavior() })`
 */
export function currentScrollBehavior(): ScrollBehavior {
  return scrollBehaviorForMotion(isMotionReduced());
}
