import * as React from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ThemeOptions } from '@mui/material/styles';
import { inputsCustomizations } from './customizations';
import { dataDisplayCustomizations } from './customizations';
import { feedbackCustomizations } from './customizations';
import { navigationCustomizations } from './customizations';
import { surfacesCustomizations } from './customizations';
import { typography, shadows } from './themePrimitives';
import { buildColorSchemes } from './themePresets';
import {
  radiusBasePx,
  FONT_SIZE_BASE,
  FONT_SIZE_SCALE,
  REDUCED_MOTION_DECLARATIONS,
  REDUCED_MOTION_SELECTOR,
  appearanceCssVars,
  resolveUiFontStack,
  scaleTypography,
} from './appearanceScales';
import { useThemeStore, resolveModeWithSystem, resolveMotionWithSystem } from '../store/themeStore';
import type { ThemeConfig } from '../store/themeStore';

interface AppThemeProps {
  children: React.ReactNode;
  disableCustomTheme?: boolean;
  themeComponents?: ThemeOptions['components'];
  config?: ThemeConfig;
}

/**
 * 应用根主题：把 preset 色板（唯一真源见 themePresets.ts）+ 字号 / 圆角档位组装成 MUI 主题。
 * 「主题色彩是否生效」取决于两件事：色板真的改写了 colorSchemes（本文件），以及界面真的
 * 用主题令牌而非硬编码色（由各页面 / 组件保证）。
 *
 * 「字体大小是否生效」的病灶（第十八轮修）：此前这里只写 `typography.fontSize`（unitless px），
 * 但 themePrimitives 的 h1…caption 全部用 `pxToRem()` 定死 rem，MUI variant 文字并不读
 * `typography.fontSize`，于是切档位只有极少数写死 unitless 的控件变、正文标题纹丝不动。
 * 现在按档位系数等比缩放全部 variant（scaleTypography），档位定义见 appearanceScales.ts。
 */
export default function AppTheme(props: AppThemeProps) {
  const { children, disableCustomTheme, themeComponents, config } = props;
  const resolvedPreset = config?.preset || 'default';
  const customPrimary = config?.customPrimary;
  const fontSize = config?.fontSize || 'medium';
  const borderRadius = config?.borderRadius || 'medium';
  // 自定义圆角数值（2026-11-03 档位改版）：仅 custom 档被 radiusBasePx 读取并生效
  const borderRadiusCustom = config?.borderRadiusCustom;
  // 界面字体族（第二十三轮）：只管 MUI 这棵树的字族；写作台纸面走「正文默认排版」那套字体，
  // 两条链路各管一段，互不越界（此前 UI 字体写死在 themePrimitives，只能改代码）。
  const uiFont = resolveUiFontStack(config?.uiFont);
  // 实际生效的明暗（system 解析成 light/dark）。这里不仅是给变量选择器用，更关键的是
  // 把它作为 `defaultColorScheme` 传给 createTheme —— 见下方注释。
  // 第二十轮：系统明暗取 store 的 systemMode 读数而不是渲染期直接读 matchMedia ——
  // 后者变化不会让下面的 useMemo 重算，「跟随」档位下操作系统切深色时 MUI 主题会停在浅色。
  const systemMode = useThemeStore((s) => s.systemMode);
  const resolvedMode = resolveModeWithSystem(config?.mode ?? 'system', systemMode);
  // 动效是否压缩：档位（auto/reduce）+ 系统读数共同决定，读数同样走 store 而不是渲染期 matchMedia
  const systemReducedMotion = useThemeStore((s) => s.systemReducedMotion);
  const reducedMotion = resolveMotionWithSystem(config?.motion, systemReducedMotion);

  const theme = React.useMemo(() => {
    if (disableCustomTheme) return {};

    // **只带当前明暗那一套 colorScheme**（2026-11-03 李先生报修「重启后深字压深底」的根修）。
    //
    // 为什么：MUI v9 的 ThemeProvider 就是 CssVarsProvider，它自己持有一份 mode 状态
    // （@mui/system/cssVars/createCssVarsProvider.mjs:84 —— light 与 dark 两套都在时取
    // `defaultMode` prop，而该 prop 我们无处可传：v9 的 createTheme 已不接受 cssVariables.defaultMode，
    // 缺省就是 'system'），随后用 effect 把 `data-mui-color-scheme` 按**它自己那份**写回 DOM
    // （同文件 191–193 行）。于是出现两个写者：我们的 theme.palette 是深色，
    // MUI 按 system→light 把属性盖成 light，CSS 变量整套回到浅色 ——
    // 走内联样式的区域是深底、走 var() 的文字还是浅色套的深字，实测「书架」标题 1.17:1。
    //
    // 只交一套方案后，MUI 那行判据走到 `colorSchemes[defaultColorScheme].palette.mode`，
    // 也就是**只能从我们的主题对象推导**，两份真源合成一份，结构上不再可能分叉。
    // 业务侧没有任何地方读 `theme.colorSchemes.light/dark`（唯一读点是本闸门的回归测试），
    // 换明暗时本文件按 resolvedMode 重建主题，两套色板不需要同时挂在主题上。
    const allSchemes = buildColorSchemes(resolvedPreset, customPrimary);
    const colorSchemes = { [resolvedMode]: allSchemes[resolvedMode] };
    // 兜底不许自造档位值（第三十七轮待办② · 第 39 轮收齐三兄弟）：
    // 脏档位回落 medium 真源，数值只在 appearanceScales.ts 一份。
    const baseFontSize = FONT_SIZE_BASE[fontSize] ?? FONT_SIZE_BASE.medium;
    const fontScale = FONT_SIZE_SCALE[fontSize] ?? FONT_SIZE_SCALE.medium;
    // 脏档位/脏数值统一经 radiusBasePx 收敛（唯一口径，见 appearanceScales 头注）
    const baseBorderRadius = radiusBasePx({ borderRadius, borderRadiusCustom });

    return createTheme({
      cssVariables: {
        colorSchemeSelector: 'data-mui-color-scheme',
        cssVarPrefix: 'template',
      },
      colorSchemes,
      // 关键：MUI 的 cssVariables 主题下，`theme.palette` 取自「默认色彩方案」，
      // 默认恒为 light —— 于是 `theme.palette.mode` 永远是 'light'、`theme.palette.background.*`
      // 永远是浅色值，页面里大量 `theme.palette.mode === 'dark' ? 深色 : 浅色` 分支与
      // `alpha(theme.palette.X, a)` 全部失真（深色模式下拿到浅色底 / 浅色文字底）。
      // 指定 defaultColorScheme 跟随实际明暗后，`theme.palette` 即反映当前明暗，
      // 这些既有分支无需逐个改写就恢复正确；light / dark 两套 CSS 变量块仍照常注入。
      defaultColorScheme: resolvedMode,
      typography: {
        ...scaleTypography(typography, fontScale),
        fontSize: baseFontSize,
        // 必须放在展开之后：scaleTypography 透传了 themePrimitives 的 fontFamily（历史值），
        // 放在展开前会被它盖回，「界面字体」档位就成了一处只存不读的设置。
        fontFamily: uiFont,
      },
      shadows,
      shape: {
        borderRadius: baseBorderRadius,
      },
      components: {
        // 全局 prefers-reduced-motion 兜底：把非必要的 transition/animation 时长
        // 压缩到 0.01ms（动画终点仍可达，仅去掉运动过程），滚动改回即时跳转。
        // 对保留必要状态反馈（loading 指示、焦点环等）不设例外，统一收效于时长压缩。
        MuiCssBaseline: {
          styleOverrides: {
            // ① 操作系统开了「减弱动态效果」：无条件收效（既有兜底，口径不变）
            '@media (prefers-reduced-motion: reduce)': {
              [REDUCED_MOTION_SELECTOR]: REDUCED_MOTION_DECLARATIONS,
            },
            // ② 应用内「减少动效」档位（第二十一轮）：系统没开也能在应用里关掉，
            //    不必为了这一件事去改影响所有软件的系统设置
            ...(reducedMotion ? { [REDUCED_MOTION_SELECTOR]: REDUCED_MOTION_DECLARATIONS } : {}),
          },
        },
        ...inputsCustomizations,
        ...dataDisplayCustomizations,
        ...feedbackCustomizations,
        ...navigationCustomizations,
        ...surfacesCustomizations,
        ...themeComponents,
      },
    });
  }, [
    disableCustomTheme,
    themeComponents,
    resolvedPreset,
    customPrimary,
    fontSize,
    borderRadius,
    borderRadiusCustom,
    uiFont,
    resolvedMode,
    reducedMotion,
  ]);

  // 档位同时写进 documentElement 的 CSS 变量：静态 CSS（.ps-workbench .ProseMirror 等）
  // 与非 MUI 渲染区拿不到 theme，只能靠变量继承跟随字号 / 圆角档位。
  // 第三十一轮起注入三项：--app-font-scale / --app-font-size-base / --app-radius-base。
  // 圆角为何不只靠 MUI 的 --template-shape-borderRadius：见 appearanceScales 头部注释——
  // 那条依赖 MUI cssVarPrefix 配置与 CssBaseline 在挂载，本仓自己的通道没有这层耦合。
  // 放在这里而不是各组件里，保证「一处生效、全局同源」。
  // 注意口径边界（第二十四轮订正 / 第二十六轮补全）：
  //  ① **Monaco / xterm 不读 CSS 变量**，它们只接受数字，走的是另一条通道
  //     （theme/appearanceScales.codeFontSize + hooks/useCodeFont.ts）。
  //     以前这句注释写着「Monaco 靠变量继承」，是假的 —— 假注释比没注释更贵：它让后来人以为
  //     不用接线，于是「字体大小」在代码工作台长期不生效。
  //  ② 第二十六轮删掉了同一处写的 `data-app-motion` 属性：全仓没有任何选择器读它，
  //     而「减少动效」经下面的 MuiCssBaseline 已经是**全局**规则（`*` 选择器不分区内外），
  //     再造一个没人读的入口就是「看着有、其实没接」。动效档位真正的第二条通道在 JS 侧，
  //     见 appearanceScales.scrollBehaviorForMotion。
  // 字号 / 圆角档位写进 DOM（明暗**不在这里写**，见下面第 ③ 条）。
  //
  // ③ 明暗的 DOM 门面（2026-11-03 李先生报修「重启后深字压深底」）：
  //    `data-mui-color-scheme` 一度由 App.tsx 的 passive effect 写，本文件又另建了一份主题对象，
  //    两边可能不是同一套明暗 —— 实测 attr=light、body 底 #f1f2f7 字 #1f2937，
  //    而主内容区底 #121a32，「书架」标题对比度只有 1.17:1。
  //    本文件试过自己写（layout effect），但 MUI 的 provider 也会写同一个属性，
  //    两个写者永远比谁后跑。最终口径：**应用侧一个写者都不留**，
  //    靠上面「只交当前那一套 colorScheme」让 MUI 的内部 mode 只能从我们的主题对象推导，
  //    属性由 MUI 独家写、值与我们同源（回归锁见 theme/__tests__/colorSchemeDomRound46.test.tsx）。
  React.useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const vars = appearanceCssVars({ fontSize, borderRadius, borderRadiusCustom });
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  }, [resolvedMode, fontSize, borderRadius, borderRadiusCustom]);

  if (disableCustomTheme) {
    return <React.Fragment>{children}</React.Fragment>;
  }

  return (
    <ThemeProvider
      theme={theme}
      // MUI 的 provider 默认把 mode 存进 localStorage['mui-mode']，读回时**优先于** defaultMode
      // （useCurrentColorScheme.mjs:64）。那是设置库之外的第三条真源：上一次启动留下的 'light'
      // 会把本次水合好的深色盖掉。存储关掉，mode 只由我们的主题对象决定。
      storageManager={null}
      defaultMode={resolvedMode}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
