import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['@react-three/fiber', '@react-three/drei', 'three']
  },
  build: {
    treeshake: true,
    sourcemap: false
  }
})
