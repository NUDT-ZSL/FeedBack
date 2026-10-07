import { defineConfig } from 'vitest/config';
import path from 'path';

// 独立于 vite.config.ts：测试只跑纯逻辑内核，默认使用 Node 环境（无浏览器）。
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
