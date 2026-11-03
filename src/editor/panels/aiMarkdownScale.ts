// sight-folio: aiMarkdown 字号变体的算术真源（第 40 轮批次 3，与渲染组件分文件的两个理由：
// ① react-refresh/only-export-components 边界——渲染器文件只导出组件，纯函数另置一处；
// ② 批次 4 将把 ChatMarkdown 收编为本渲染器的 fontSize 变体，届时两侧共用这里的倍率口径，
//    不再出现第二份字号常量副本（历史病灶：14 vs 11.5 两套硬编码分叉）。

import { uiFontSize } from '../../theme/appearanceScales';

/** 正文默认字号（px）：工作台侧栏的历史取值，medium 档逐像素不变；变体 fontSize 缺省即此值 */
export const BODY_FONT_PX = 11.5;

/** 变体倍率：正文 px / 默认正文 px。fontSize 缺省或非法 → 1（工作台侧栏零漂移） */
export function variantScale(fontSize?: number): number {
  return fontSize && fontSize > 0 ? fontSize / BODY_FONT_PX : 1;
}

/** 字号计算：先乘变体倍率（保留两位小数防浮点尾巴进 CSS），再交 uiFontSize 吃全局字体档位 */
export function vpx(px: number, k: number): string {
  return uiFontSize(Math.round(px * k * 100) / 100);
}
