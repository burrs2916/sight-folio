/**
 * 画像常量
 *
 * GRID 红橙阈值色板、画像阈值、模块色板、代码语言集合。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */



/** 等级 → 语义色（与 FileRenderer 热度档一致） */
export const GRID_TIER_COLOR: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  extreme: '#ef4444',
};

/** 画像红/橙阈值集中（便于调参，避免散落魔法数字）。仅覆盖本项目新增画像；risk/techDebt 复用既有 GRID_TIER_COLOR。 */
export const PORTRAIT_THRESHOLDS = {
  security: { red: 6, orange: 2 },
  apiSurface: { red: 12, orange: 4 },
  ripple: { red: 30, orange: 8 },
  deadCode: { red: 10, orange: 2 }, // 零引用符号数量分档
  errorHandling: { red: 5, orange: 2 },
  logging: { red: 8, orange: 3 }, // console 泄漏 + 吞 error 日志合计
};

/** v2.17 依赖画像模块簇色板（高区分度 10 色，按顶层目录哈希取色） */
export const MODULE_PALETTE = [
  '#0ea5e9',
  '#f97316',
  '#8b5cf6',
  '#10b981',
  '#ef4444',
  '#eab308',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
  '#f59e0b',
];
export const CODE_LANGS = new Set([
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'rust',
  'go',
  'java',
  'csharp',
  'cpp',
  'c',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'dart',
  'scala',
  'html',
  'vue',
  'svelte',
  'sql',
]);
