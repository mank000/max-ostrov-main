import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom', '@maxhub/max-ui'],
    alias: {
      '@maxhub/max-ui': decodeURIComponent(
        new URL('./node_modules/@maxhub/max-ui', import.meta.url).pathname,
      ),
    },
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
})
