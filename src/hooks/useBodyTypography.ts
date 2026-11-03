// 正文排版的「非 Emotion 消费通道」（第二十六轮）
//
// 为什么单独一个 hook：写作台的正文排版走 `buildEditorBodySx(typo, dark)`（Emotion sx），
// 而工作室画布里的章节卡受「画布零 Emotion」性能约定约束（见 editor/renderers/canvasTheme.ts
// 文件头：一个文件实体 26 个 emotion 组件 = 平移一次重挂载 200ms），只能写 inline style +
// 静态 CSS。两条渲染链路要读**同一份档位**，否则就是「抽屉改了、画布没跟」的老病灶。
//
// 订阅口径：
//  - `typographyDefaultsStore.config` —— 抽屉改「正文默认排版」/ 另一窗口广播过来时，
//    这里必须重算。`loadTypography()` 读的是 utils/typography 的模块级默认值，本身不是
//    响应式读数，不订阅这个 store 就会停在旧档位。
//  - `bookTypographyStore.overrides`（第三十轮 P1）—— 同样层级的第二条读数：书级覆盖换进
//    设置库之后也是异步读回、且可被另一窗口改写，不订阅它，画布上的章节卡会停在
//    「这本书还没单独调过排版」的那一版。
//  - `themeStore` 的 mode + systemMode —— 纸色（米黄 / 护眼绿）在明暗下是两套色值，
//    与 AppTheme 同一口径取「已解析的实际明暗」，不在渲染期直接读 matchMedia。
import { useMemo } from 'react';
import { useTypographyDefaultsStore } from '../store/typographyDefaultsStore';
import { useBookTypographyStore } from '../store/bookTypographyStore';
import { useThemeStore, resolveModeWithSystem } from '../store/themeStore';
import { bodyTypographyCssVars, loadTypography } from '../utils/typography';

/**
 * 某本书当前的正文排版 → 可写进 inline style 的 CSS 变量。
 * @param bookId 目标书；null 即「没有书级覆盖」，取全局默认排版（与 loadTypography 同口径）
 */
export function useBodyTypographyCssVars(bookId: string | null): Record<string, string> {
  // 只订阅「档位变了」这件事：值本身仍由 loadTypography 现取，保证书级覆盖优先
  const globalConfig = useTypographyDefaultsStore((s) => s.config);
  const bookOverrides = useBookTypographyStore((s) => s.overrides);
  const mode = useThemeStore((s) => s.config.mode);
  const systemMode = useThemeStore((s) => s.systemMode);
  const dark = resolveModeWithSystem(mode, systemMode) === 'dark';
  // globalConfig / bookOverrides 是**故意**进依赖的：loadTypography 读的是 utils/typography 里
  // 两份模块级读数（全局默认 + 书级覆盖），它们都不是响应式的；不订阅这两个 store，
  // 抽屉改「正文默认排版」或另一窗口改了这本书的排版时，这份 CSS 变量就会停在旧档位。
  return useMemo(
    () => bodyTypographyCssVars(loadTypography(bookId), dark),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [globalConfig, bookOverrides, dark, bookId],
  );
}
