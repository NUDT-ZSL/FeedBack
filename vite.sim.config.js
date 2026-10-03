import { defineConfig } from 'vite';

// 离线模拟/批量验证入口的打包配置：把 src/sim/batch.ts 打成单个 Node ESM 文件
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist-sim',
    emptyOutDir: true,
    lib: {
      entry: 'src/sim/batch.ts',
      formats: ['es'],
      fileName: () => 'batch.mjs'
    },
    rollupOptions: {
      external: [/^node:/]
    }
  }
});
