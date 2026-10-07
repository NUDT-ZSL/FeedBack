import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [
    react({
      jsxRuntime: 'automatic'
    })
  ],
  optimizeDeps: {
    include: ['react', 'react-dom', 'uuid', 'canvas-confetti']
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom']
        }
      }
    }
  }
});
