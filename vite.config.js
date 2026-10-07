import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    sourcemap: false,
  },
  optimizeDeps: {
    include: ['three', 'howler', 'uuid'],
  },
  server: {
    port: 5173,
    open: true,
  },
});
