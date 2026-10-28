/**
 * 画布画像引擎（统一入口）——barrel re-export
 *
 * 实现按域拆到 ./portraits/ 子目录（纯移动零行为变更）；此处仅 re-export
 * 原 portraits.ts 的全部 24 个公开符号，对外 API 面保持不变。
 */
export { openDirectorySubtree, rerenderDirectoryTree } from './portraits/directory';
export { expandCallChain } from './portraits/expandCallChain';
export { runImpactPortraitFor } from './portraits/impact';
export { LEAK_CONSOLE_RE, countSwallowedLoggerErrors, countCommentedCode } from './portraits/metrics-scan';
export { runPortrait, VIEW_TEMPLATE_PORTRAIT, portraitForTemplate } from './portraits/runner';
export { currentInsights, fileConfig } from './portraits/shared';
export { hasLegacySymbolBands } from './portraits/symbols';
export type { DataFlowPortraitKind, FunctionPortraitKind, GraphPortraitKind, GridPortraitKind, ImpactTarget, PatternPortraitKind, PortraitKind, PortraitMode, PortraitOutcome, SymbolPortraitKind, TargetedPortraitKind } from './portraits/types';
