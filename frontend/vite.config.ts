import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, /api (including the WebSocket) is proxied to the Go backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', ws: true },
    },
  },
})
