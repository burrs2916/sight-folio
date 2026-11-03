// 代码区字号钩子（第二十四轮）
//
// 为什么单独一个 hook：设置抽屉的「字体大小」档位此前只进了 MUI 主题树，而 Monaco 与 xterm
// 都不吃 MUI theme、也不吃 CSS 变量，它们只接受一个数字 —— 那几处于是各自写死了 13 / 12 / 11，
// 结果是「字号切到『大』，代码工作台与终端纹丝不动」。本钩子把档位 → 数字的换算收在一处：
// 档位定义与系数在 theme/appearanceScales.ts（单一真源），这里只负责订阅当前档位。
//
// 订阅 themeStore 而不是 AppTheme 的 theme：主题对象每次重建引用都变，会让 Monaco 的 options
// 反复触发 updateOptions；字号档位是原子读数，只在真的换档时才重渲染。
// 跨窗口同样自动跟随：另一窗口改档位 → themeStore.hydrate → 本钩子读到新值。
import { useMemo } from 'react';
import { useThemeStore } from '../store/themeStore';
import { applyCodeFontZoom, applyCodeFontLineHeight, clampCodeFontZoom, codeFontSize } from '../theme/appearanceScales';
import type { CodeFontRole } from '../theme/appearanceScales';

export interface CodeFont {
  /** 传给 Monaco `fontSize` / xterm `options.fontSize` 的像素值 */
  fontSize: number;
  /** 与字号同源缩放，避免「字放大而行高不变」的挤压 */
  lineHeight: number;
}

/**
 * @param role 该代码区的角色（决定基准字号），见 theme/appearanceScales.CODE_FONT_BASE
 * @param zoom 代码字号微调**步数**（第三十六轮）。只有代码编辑器主体传它 ——
 *   差异对照 / 终端 / 行内 diff 历来不吃这个微调（对标 Zed 只管 buffer 字号），
 *   默认 0 步即「只跟档位」，所以那几处调用点一字未改、观感也不变。
 *   步数取自设置库 theme 域：档位与微调都在同一条订阅上，任一边变了本钩子就重算，
 *   跨窗口（另一窗口改了微调）经 themeStore.hydrate 自动跟着变。
 */
export function useCodeFont(role: CodeFontRole, zoom = 0): CodeFont {
  const fontSize = useThemeStore((s) => s.config.fontSize);
  return useMemo(() => {
    const px = applyCodeFontZoom(codeFontSize(role, fontSize), clampCodeFontZoom(zoom));
    return { fontSize: px, lineHeight: applyCodeFontLineHeight(px) };
  }, [role, fontSize, zoom]);
}
