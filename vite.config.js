import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite构建配置
// 数据流向：Vite通过此配置将src/client目录下的React/TypeScript代码打包构建
// 开发服务器代理/api请求到后端Express服务器（端口3001）
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/client'),
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
