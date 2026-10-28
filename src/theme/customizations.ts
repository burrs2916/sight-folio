import type { ThemeOptions } from '@mui/material/styles';

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
      root: {
        borderRadius: 10,
      },
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
          borderRadius: 10,
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
        fontSize: 13.5,
        '&::placeholder': {
          opacity: 0.55,
        },
      },
    },
  },
  MuiInputLabel: {
    styleOverrides: {
      root: {
        fontSize: 13,
        lineHeight: 1.5,
      },
    },
  },
  MuiFormHelperText: {
    styleOverrides: {
      root: {
        marginLeft: 3,
        marginRight: 3,
        fontSize: 11.5,
        lineHeight: 1.55,
      },
    },
  },
  MuiSelect: {
    styleOverrides: {
      icon: {
        fontSize: 19,
      },
    },
  },
  MuiFilledInput: {
    styleOverrides: {
      root: {
        borderRadius: 10,
        '&:before': {
          display: 'none',
        },
        '&:after': {
          display: 'none',
        },
      },
    },
  },
};

export const dataDisplayCustomizations: ThemeOptions['components'] = {
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 4,
      },
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
};

export const feedbackCustomizations: ThemeOptions['components'] = {
  MuiAlert: {
    styleOverrides: {
      root: {
        borderRadius: 8,
      },
    },
  },
};

export const navigationCustomizations: ThemeOptions['components'] = {
  MuiMenuItem: {
    styleOverrides: {
      root: {
        borderRadius: 8,
      },
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
      root: {
        borderRadius: 12,
        borderColor: 'var(--template-palette-divider)',
        backgroundImage: 'none',
      },
    },
  },
  MuiAccordion: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        '&:before': {
          display: 'none',
        },
      },
    },
  },
};
