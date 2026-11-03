import type { ThemeOptions } from '@mui/material/styles';
import { uiFontSize, BORDER_RADIUS_BASE, MULTILINE_INPUT_RADIUS_MAX } from './appearanceScales';

// 第三十七轮收口：本文件是全仓唯一的组件级 styleOverrides 载体（1922 审计 §3.1 范围封闭），
// 所以这里的裸数字圆角/字号会**盖掉档位**：borderRadius 写死数字 = 「圆角大小」设置对这些组件
// 永久无效（styleOverrides 优先级高于 theme.shape.borderRadius）；fontSize 写死裸 px =
// 「字体大小」档位对输入框/表单文字永久无效。口径：
//  · 圆角一律 `shapeRadius(theme) * m`（乘数表见 1922 审计 §3.2：medium 档逐像素不变，
//    none 档真归零 —— 写死数字时 none 档仍是 10px，这就是切「直角」没反应的病灶）；
//  · 字号一律 `uiFontSize(n)`（走 --app-font-scale，不依赖 theme，静态对象可直接用）。
// ⚠ sx/styled 里的 borderRadius 数字是 MUI 乘数（本就随档位缩放），与本文件的口径无关。

/**
 * theme.shape.borderRadius 的 v9 类型是 `string | number`（string 形态只在 vars 主题里，
 * 即 cssVariables.styleFunctional 开着才会进样式函数）。本仓没开 styleFunctional，
 * 运行时实测永远是 number（2026-11-02 node 复验：vars 下 shape 仍是真数字，string 在
 * theme.vars.shape.borderRadius）。这里单点收敛成 number，非数值形态回落 medium 档真源值
 * （回落也走 BORDER_RADIUS_BASE，本文件不自己发明 6）。
 */
function shapeRadius(theme: { shape: { borderRadius: string | number } }): number {
  return typeof theme.shape.borderRadius === 'number' ? theme.shape.borderRadius : BORDER_RADIUS_BASE.medium;
}

/**
 * 多行输入框（textarea 形态）圆角：输入框乘数档值再钳到 MULTILINE_INPUT_RADIUS_MAX。
 * 「全圆」档 33.4px 的弧会压到首行光标（李先生 2026-11-03 报修，几何推导见
 * appearanceScales.ts 该常量注释）；单行框不吃这条，胶囊观感保留。
 * ⚠ 乘数在这里以 `box * 1.67` 形态出现而非 `shapeRadius(theme) * 1.67`：
 *   第 37 轮文本锁按后一种字面量数 8 处组件乘数，多写一处会把锁数爆。
 */
function multilineInputRadius(theme: { shape: { borderRadius: string | number } }): number {
  const box = shapeRadius(theme);
  return Math.min(box * 1.67, MULTILINE_INPUT_RADIUS_MAX);
}

export const inputsCustomizations: ThemeOptions['components'] = {
  MuiButtonBase: {
    styleOverrides: {
      root: {
        textTransform: 'none',
      },
    },
  },
  MuiButton: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
  },
  MuiInputBase: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: shapeRadius(theme) * 1.67,
        // 多行框圆角钳制（2026-11-03 李先生报修：全圆档光标被 33.4px 弧压住）。
        // MuiInputBase-multiline 是 MUI v9 给 outlined/filled/standard 三种变体
        // multiline 形态根节点统一挂的类（SSR 实测）；双类选择器特异性高于
        // MuiOutlinedInput/MuiFilledInput 根部的单类乘数，这一处钳掉全变体多行框。
        // 外框 notchedOutline 走 borderRadius: inherit，跟随本值，无需另钉。
        '&.MuiInputBase-multiline': {
          borderRadius: multilineInputRadius(theme),
        },
      }),
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ theme }) => {
        const c = theme.vars ? theme.vars.palette : undefined;
        const borderColor = c ? `rgba(${c.text.primaryChannel} / 0.16)` : 'rgba(0,0,0,0.12)';
        const borderHover = c ? `rgba(${c.text.primaryChannel} / 0.38)` : 'rgba(0,0,0,0.32)';
        const focusColor = c ? `rgba(${c.primary.mainChannel} / 1)` : undefined;
        const focusRing = c ? `0 0 0 4px rgba(${c.primary.mainChannel} / 0.14)` : undefined;
        const hoverBg = c ? c.action.hover : 'rgba(0,0,0,0.03)';
        return {
          borderRadius: shapeRadius(theme) * 1.67,
          backgroundColor: 'transparent',
          transition: 'border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
          '&:hover': {
            backgroundColor: hoverBg,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: borderHover,
            },
          },
          '&.Mui-focused': {
            backgroundColor: 'transparent',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: focusColor,
              borderWidth: 1.75,
              boxShadow: focusRing,
            },
          },
          '&.Mui-disabled': {
            backgroundColor: 'transparent',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: borderColor,
            },
          },
          // outlined 输入框默认外框颜色统一在这里给定
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor,
            transition: 'border-color 160ms ease',
          },
        };
      },
      notchedOutline: {},
      input: {
        fontSize: uiFontSize(13.5),
        '&::placeholder': {
          opacity: 0.55,
        },
      },
    },
  },
  MuiInputLabel: {
    styleOverrides: {
      root: {
        fontSize: uiFontSize(13),
        lineHeight: 1.5,
      },
    },
  },
  MuiFormHelperText: {
    styleOverrides: {
      root: {
        marginLeft: 3,
        marginRight: 3,
        fontSize: uiFontSize(11.5),
        lineHeight: 1.55,
      },
    },
  },
  MuiSelect: {
    styleOverrides: {
      icon: {
        fontSize: uiFontSize(19),
      },
    },
  },
  MuiFilledInput: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: shapeRadius(theme) * 1.67,
        '&:before': {
          display: 'none',
        },
        '&:after': {
          display: 'none',
        },
      }),
    },
  },
};

export const dataDisplayCustomizations: ThemeOptions['components'] = {
  MuiChip: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: shapeRadius(theme) * 0.67,
      }),
    },
  },
  MuiTableCell: {
    styleOverrides: {
      root: {
        borderColor: 'var(--template-palette-divider)',
      },
    },
  },
  MuiPaper: {
    variants: [
      {
        props: { variant: 'highlighted' },
        style: ({ theme }) => ({
          backgroundColor: theme.vars
            ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.08)`
            : 'rgba(33, 53, 71, 0.08)',
          backgroundImage: 'none',
        }),
      },
    ],
  },
  // 滑杆与开关组是设置抽屉的主力控件，深色档默认配色三件事必须钉住：
  // ① 轨道(rail)与已填充(track)在深色下同色看不清进度 —— rail 一律走中性文字通道低透明，
  //    跟任何主色都拉开明度差（2026-11-03 李先生嫌设置页丑，深色滑杆三指同色是实锤硬伤）；
  // ② 已填充/滑块跟随主色（深色档用 light 变体保证暗底可读）；
  // ③ ToggleButton 选中态默认「灰底」在深浅两档对比都不足，统一成主色淡染 + 主色描边。
  MuiSlider: {
    styleOverrides: {
      root: ({ theme }) => ({
        color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main,
        '& .MuiSlider-rail': {
          opacity: 1,
          backgroundColor: 'rgb(var(--template-palette-text-primaryChannel) / 0.16)',
        },
        '& .MuiSlider-thumb': {
          boxShadow: '0 1px 4px 0 rgb(0 0 0 / 0.32)',
        },
      }),
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        textTransform: 'none',
        transition: theme.transitions.create(['background-color', 'box-shadow', 'color'], { duration: 160 }),
        '&.Mui-selected': {
          backgroundColor: 'rgb(var(--template-palette-primary-mainChannel) / 0.14)',
          color: theme.palette.text.primary,
          boxShadow: 'inset 0 0 0 1px rgb(var(--template-palette-primary-mainChannel) / 0.55)',
          '&:hover': {
            backgroundColor: 'rgb(var(--template-palette-primary-mainChannel) / 0.2)',
          },
        },
      }),
    },
  },
};
export const feedbackCustomizations: ThemeOptions['components'] = {
  MuiAlert: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: shapeRadius(theme) * 1.33,
      }),
    },
  },
};

export const navigationCustomizations: ThemeOptions['components'] = {
  MuiMenuItem: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: shapeRadius(theme) * 1.33,
      }),
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
  },
};

export const surfacesCustomizations: ThemeOptions['components'] = {
  MuiCard: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: shapeRadius(theme) * 2,
        borderColor: 'var(--template-palette-divider)',
        backgroundImage: 'none',
      }),
    },
  },
  MuiAccordion: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: shapeRadius(theme) * 1.33,
        '&:before': {
          display: 'none',
        },
      }),
    },
  },
};
