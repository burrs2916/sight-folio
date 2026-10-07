import * as React from 'react';
import { ThemeProvider, createTheme, alpha } from '@mui/material/styles';
import type { ThemeOptions, ColorSystemOptions } from '@mui/material/styles';
import { inputsCustomizations } from './customizations';
import { dataDisplayCustomizations } from './customizations';
import { feedbackCustomizations } from './customizations';
import { navigationCustomizations } from './customizations';
import { surfacesCustomizations } from './customizations';
import { typography, shadows, gray, blue, green, orange, red, brand, indigo } from './themePrimitives';
import type { ThemeConfig, ThemePreset } from '../store/themeStore';
import { generatePalette } from './colorUtils';

const purple = {
  300: brand[400],
  600: brand[600],
  800: brand[800],
};

interface AppThemeProps {
  children: React.ReactNode;
  disableCustomTheme?: boolean;
  themeComponents?: ThemeOptions['components'];
  config?: ThemeConfig;
}

const FONT_SIZE_MAP: Record<string, number> = {
  small: 13,
  medium: 14,
  large: 16,
};

const BORDER_RADIUS_MAP: Record<string, number> = {
  none: 0,
  small: 2,
  medium: 6,
  large: 12,
  round: 20,
};

/**
 * 靛蓝工作台主题（LibraryPage「现代工作台靛蓝」局部主题的 preset 定义）。
 *
 * 历史：LibraryPage 曾在页面内自建整套局部主题（靛蓝主色 + 灰蓝底白卡 + 深暗底），
 * 侧边栏/顶栏保持品牌紫。该主题因全局 theme 启用了 cssVariables 而必须「全新构造 +
 * cssVariables:false」才能生效（嵌套 createTheme(appTheme, {...}) 会让 sx 编译成
 * var(--template-*) 品牌紫）。这里把色板收敛为主题层 preset：页面只声明 preset 名，
 * 不再内联整段色值；圆角并入全局 BORDER_RADIUS_MAP（不再独立写 10）。
 */
interface WorkbenchPalette {
  light: ColorSystemOptions;
  dark: ColorSystemOptions;
}

export const WORKBENCH_PRESETS: Record<string, WorkbenchPalette> = {
  indigo: {
    light: {
      palette: {
        primary: { main: '#4f46e5', light: '#818cf8', dark: '#4338ca', contrastText: '#ffffff' },
        secondary: { main: '#6b5ce0', light: '#9386ec', dark: '#4f43b0', contrastText: '#ffffff' },
        background: { default: '#f4f6fb', paper: '#ffffff' },
        text: { primary: '#1e2433', secondary: '#5b6273' },
        divider: '#e2e8f0',
      },
    },
    dark: {
      palette: {
        primary: { main: '#818cf8', light: '#a5b4fc', dark: '#6366f1', contrastText: '#0f172a' },
        secondary: { main: '#9386ec', light: '#b4a9f2', dark: '#6b5ce0', contrastText: '#0f172a' },
        background: { default: '#0f1420', paper: '#171e2e' },
        text: { primary: '#e2e8f0', secondary: '#94a3b8' },
        divider: '#334155',
      },
    },
  },
};

/** 用全局主题的 typography/components + 指定工作台 preset 色板组装局部主题色板。
 *  返回 { light, dark }，供页面在全新构造（cssVariables:false）时直接作为 colorSchemes 使用。 */
export function getWorkbenchColorSchemes(preset: string): WorkbenchPalette | null {
  return WORKBENCH_PRESETS[preset] ?? null;
}

function getPresetPrimary(preset: ThemePreset, customPrimary?: string) {
  if (preset === 'custom' && customPrimary) {
    return generatePalette(customPrimary);
  }

  switch (preset) {
    case 'blue':
      return {
        light: blue[300],
        main: blue[600],
        dark: blue[800],
        contrastText: '#ffffff',
      };
    case 'green':
      return {
        light: green[300],
        main: green[600],
        dark: green[800],
        contrastText: '#ffffff',
      };
    case 'orange':
      return {
        light: orange[300],
        main: orange[600],
        dark: orange[800],
        contrastText: '#ffffff',
      };
    case 'purple':
      return {
        light: purple[300],
        main: purple[600],
        dark: purple[800],
        contrastText: '#ffffff',
      };
    case 'indigo':
      return {
        light: indigo[400],
        main: indigo[600],
        dark: indigo[700],
        contrastText: '#ffffff',
      };
    case 'default':
    default:
      return undefined;
  }
}

function buildColorSchemes(preset: ThemePreset, customPrimary?: string) {
  const presetPrimary = getPresetPrimary(preset, customPrimary);

  const lightPrimary = presetPrimary || {
    light: brand[300],
    main: brand[700],
    dark: brand[800],
    contrastText: '#ffffff',
  };

  const darkPrimary = presetPrimary
    ? {
        light: presetPrimary.light,
        main: presetPrimary.main,
        dark: presetPrimary.dark,
        contrastText: '#ffffff',
      }
    : {
        // 暗色主题下品牌紫整体提亮（brand300 + 深紫文字），保证主色文字/图形在深底 ≥4.5:1，
        // 与 LibraryPage 暗色「亮主色 + 深文字」的既有先例一致；品牌 ramp 本身不变。
        light: brand[200],
        main: brand[300],
        dark: brand[400],
        contrastText: brand[900],
      };

  return {
    light: {
      palette: {
        primary: lightPrimary,
        secondary: {
          light: gray[300],
          main: gray[500],
          dark: gray[700],
          contrastText: '#ffffff',
        },
        info: {
          light: blue[300],
          main: blue[600],
          dark: blue[800],
          contrastText: '#ffffff',
        },
        warning: {
          light: orange[300],
          main: orange[800],
          dark: orange[900],
          contrastText: '#ffffff',
        },
        error: {
          light: red[300],
          main: red[600],
          dark: red[800],
          contrastText: '#ffffff',
        },
        success: {
          light: green[300],
          main: green[700],
          dark: green[800],
          contrastText: '#ffffff',
        },
        grey: { ...gray },
        divider: alpha(gray[300], 0.4),
        background: {
          default: '#FBF7EF',
          paper: '#ffffff',
        },
        text: {
          primary: gray[800],
          secondary: gray[600],
        },
        action: {
          hover: alpha(gray[200], 0.2),
          selected: `${alpha(gray[200], 0.3)}`,
        },
        baseShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
      },
    },
    dark: {
      palette: {
        primary: darkPrimary,
        secondary: {
          light: gray[300],
          main: gray[500],
          dark: gray[700],
          contrastText: '#ffffff',
        },
        info: {
          light: blue[300],
          main: blue[500],
          dark: blue[700],
          contrastText: '#ffffff',
        },
        warning: {
          light: orange[300],
          main: orange[500],
          dark: orange[700],
          contrastText: '#ffffff',
        },
        error: {
          light: red[300],
          main: red[500],
          dark: red[700],
          contrastText: '#ffffff',
        },
        success: {
          light: green[300],
          main: green[500],
          dark: green[700],
          contrastText: '#ffffff',
        },
        grey: { ...gray },
        divider: alpha(gray[700], 0.6),
        background: {
          default: gray[900],
          paper: gray[800],
        },
        text: {
          primary: '#f9fafb',
          secondary: gray[400],
        },
        action: {
          hover: alpha(gray[600], 0.2),
          selected: alpha(gray[600], 0.3),
        },
        baseShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
      },
    },
  };
}

export default function AppTheme(props: AppThemeProps) {
  const { children, disableCustomTheme, themeComponents, config } = props;
  const resolvedPreset = config?.preset || 'default';
  const customPrimary = config?.customPrimary;
  const fontSize = config?.fontSize || 'medium';
  const borderRadius = config?.borderRadius || 'medium';

  const theme = React.useMemo(() => {
    if (disableCustomTheme) return {};

    const colorSchemes = buildColorSchemes(resolvedPreset, customPrimary);
    const baseFontSize = FONT_SIZE_MAP[fontSize] || 14;
    const baseBorderRadius = BORDER_RADIUS_MAP[borderRadius] ?? 6;

    return createTheme({
      cssVariables: {
        colorSchemeSelector: 'data-mui-color-scheme',
        cssVarPrefix: 'template',
      },
      colorSchemes,
      typography: {
        ...typography,
        fontSize: baseFontSize,
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
            '@media (prefers-reduced-motion: reduce)': {
              '*, *::before, *::after': {
                animationDuration: '0.01ms !important',
                animationIterationCount: '1 !important',
                transitionDuration: '0.01ms !important',
                scrollBehavior: 'auto !important',
              },
            },
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
  }, [disableCustomTheme, themeComponents, resolvedPreset, customPrimary, fontSize, borderRadius]);

  if (disableCustomTheme) {
    return <React.Fragment>{children}</React.Fragment>;
  }

  return (
    <ThemeProvider theme={theme} disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
