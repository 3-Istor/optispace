import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy target: the backend published by docker compose on 8081.
const backendHost = process.env.BACKEND_HOST || 'http://localhost:8081';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    host: true, 
    allowedHosts: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: backendHost,
        changeOrigin: true,
        rewrite: (path) => path
      }
    }
  }
})
