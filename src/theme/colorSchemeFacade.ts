// 明暗的 DOM 门面（2026-11-03 李先生报修「重启后颜色会乱、深色文字压深色背景」）。
//
// 机理：本仓的 MUI 主题走 cssVariables，界面颜色实际取自挂在 `data-mui-color-scheme`
// 上的那一套 CSS 变量；而 `theme.palette`（JS 侧、走 defaultColorScheme）由
// theme/AppTheme.tsx 的 useMemo 定。两者一旦不是同一套明暗，就会出现**半套主题**：
// 走内联样式的区域已是深底，走 var() 的文字仍是浅色套的深字。
// 浏览器实测读数：attr=light、body 底 #f1f2f7 字 #1f2937，主内容区底 #121a32，
// 「书架」标题对比度 1.17:1、空态说明 1.10:1。
//
// 为什么会分叉：MUI 的 CssVarsProvider 也写同一个属性，用的是它自己那份 mode 状态 ——
// 它把 mode 存进 localStorage['mui-mode']，读回时**优先于** defaultMode
// （useCurrentColorScheme.mjs:64），默认档还是 'system'。于是设置库水合好的深色会被盖掉。
//
// 三道闸（缺一道就能重现，逐条有锁）：
//  ① AppTheme 只交「当前那一套 colorScheme」⇒ MUI 推导 mode 时只能等于我们的明暗；
//  ② ThemeProvider `storageManager={null}` ⇒ 拔掉 localStorage['mui-mode'] 这条库外真源；
//  ③ 本 hook 挂在**祖先组件的 passive effect** 上 ⇒ 同一轮提交里祖先晚于后代，
//     「谁后跑谁赢」被固定成事实，而不是靠渲染顺序运气。
//
// 唯一写入口放在这里而不是散在 App 里：测试要能拿真代码跑（见
// theme/__tests__/colorSchemeDomRound46.test.tsx），而不是在测试里抄一遍同样三行。
import { useEffect } from 'react';

/** 把当前生效明暗写到 DOM 门面上（每轮提交最后一次写，祖先侧 passive effect）。 */
export function useColorSchemeFacade(resolvedMode: 'light' | 'dark'): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-mui-color-scheme', resolvedMode);
  }, [resolvedMode]);
}
