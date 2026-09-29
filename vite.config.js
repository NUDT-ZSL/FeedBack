import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: false
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 2048
  }
});
