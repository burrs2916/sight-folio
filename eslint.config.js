import js from '@eslint/js';
// 依赖口径修正：改用 package.json 已声明的 @typescript-eslint/parser + plugin（v8 自带 flat/recommended），
// 不再 import 聚合包 `typescript-eslint` —— 该包从未声明/安装，导致本文件加载即 ERR_MODULE_NOT_FOUND，
// `npm run lint` 直接不可用（`npm run lint:fix` 同理）。
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist/**', 'src-tauri/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // ── 降级：eslint-plugin-react-hooks v7 的 React Compiler 规则集 ──
      // v7 的 `configs.recommended` 从 2 条（rules-of-hooks + exhaustive-deps）扩到 16 条，
      // 新增 14 条 Compiler 规则；本仓库尚未做 Compiler 迁移，全量一次性触发 160+ 处。
      // 统一降为 warn：保留可见性、不阻塞 lint 闸门（error 只留真实缺陷），
      // 待按文件迁移后再把对应规则逐条升回 error。v7 未提供 classic 预设，故显式列举。
      ...Object.fromEntries(
        [
          'static-components',
          'use-memo',
          'preserve-manual-memoization',
          'incompatible-library',
          'immutability',
          'globals',
          'refs',
          'set-state-in-effect',
          'error-boundaries',
          'purity',
          'set-state-in-render',
          'unsupported-syntax',
          'config',
          'gating',
        ].map((r) => [`react-hooks/${r}`, 'warn']),
      ),
      'react-refresh/only-export-components': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // 两处「刻意为之」的既有模式，用规则自带选项表达意图（而非逐行 disable 注释）：
      // ① no-empty：全仓 11 处空块都是 `catch {}` —— JSON.parse fallback / adapter.disconnect
      //    这类 best-effort 分支刻意吞错；② no-empty-object-type：MUI 主题增强惯用的
      //    `interface PaletteColor extends ColorRange {}`（以及 scene.ts 的 AnalysisCategory），
      //    官方为单一继承的空接口提供了这个开关。
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
  },
];
