/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/i18n-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src-tauri'],
    // 等待预算：默认 5000ms 在全量跑（4128 条 / tests 304s / collect 181s，本机 2026-11-10 实测）
    // 下会被"机器忙"顶穿。证据是**红点每次换一条**：先是 Round20「写库失败时不再谎称已保存」，
    // 给那两条单独抬到 20s 之后，同一轮里红点搬到 Round19 两条 + Round20「段首缩进」——
    // 逐条补是打地鼠，而这些用例单发全部 8/8 绿。抬预算不减任何断言、不 skip、不吞失败，
    // 真挂死的用例照样失败，只是多等 15s。根因（测试里用真睡 700ms 的 settle() 而不是按状态等待）
    // 记在台账 S24，**没销账**。
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.{test,spec}.{ts,tsx}'],
    },
  },
});
