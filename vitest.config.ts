import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 离线批量验证入口：纯 Node 环境，无需浏览器/网络
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
