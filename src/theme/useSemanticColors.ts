// sight-folio: 语义色 Hook（2026-11-02，第十九轮）
//
// 把「当前明暗 + 当前卡片底色」交给 resolveSemanticPalette，得到一套已经过对比度校正的
// 语义色。组件里不再出现固定字面量（如 '#b45309' / 'rgba(245,158,11,0.12)'）——
// 深色底上自动换成偏亮的前景，浅色底上自动换成偏深的前景，tint / 描边始终与前景同源。
//
// 用法：
//   const sc = useSemanticColors();
//   <Box sx={{ color: sc.tone.warning.color, bgcolor: sc.tone.warning.bg }} />

import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { resolveSemanticPalette, type ResolvedSemanticColor, type StatusTone } from './semanticColors';

export interface SemanticColors {
  /** 当前明暗方案 */
  mode: 'light' | 'dark';
  /** 用于派生前景的卡片底色 */
  background: string;
  /** 语义族 → 已校正的取值 */
  tone: Record<StatusTone, ResolvedSemanticColor>;
}

/** 取主题能力之外（未包在 AppTheme 内）时的兜底底色，保证仍能解析出可读前景 */
const FALLBACK_BACKGROUND = { light: '#ffffff', dark: '#111827' } as const;

export function useSemanticColors(): SemanticColors {
  const theme = useTheme();
  const mode: 'light' | 'dark' = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const themeBackground = theme.palette.background?.paper;
  const background =
    typeof themeBackground === 'string' && /^(#|rgba?\()/i.test(themeBackground.trim())
      ? themeBackground
      : FALLBACK_BACKGROUND[mode];

  return useMemo(() => ({ mode, background, tone: resolveSemanticPalette(background, mode) }), [mode, background]);
}

export default useSemanticColors;
