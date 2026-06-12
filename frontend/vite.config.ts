import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/data': 'http://localhost:3001',
      '/version': 'http://localhost:3001',
      '/automation': 'http://localhost:3001',
      '/settings': 'http://localhost:3001',
      '/css': 'http://localhost:3001',
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
})
