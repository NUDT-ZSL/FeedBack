import { defineConfig } from 'vitest/config';

// 独立的测试配置：不加载 vite.config.ts 中的开发服插件，
// 保证测试在纯 Node 环境离线运行，无需浏览器与网络。
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup/localStorageMock.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
  },
});
