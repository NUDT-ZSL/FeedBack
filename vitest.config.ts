import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 离线测试配置：node 环境，不启动浏览器、不访问网络。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
