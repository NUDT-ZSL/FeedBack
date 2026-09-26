import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020'
  },
  server: {
    port: 5173,
    host: true,
    open: true
  },
  esbuild: {
    target: 'es2020'
  }
});
