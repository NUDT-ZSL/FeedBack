import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  resolve: {
    extensions: ['.ts', '.js']
  },
  server: {
    port: 3000,
    open: true
  }
});
