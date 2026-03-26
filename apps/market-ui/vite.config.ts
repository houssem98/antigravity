import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [inspectAttr(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: [
      '@react-pdf/renderer',
      'pako',
    ],
  },
  server: {
    proxy: {
      '/api/history': 'http://localhost:3002',
      '/api/fundamentals': 'http://localhost:3002',
      '/api/financials': 'http://localhost:3002',
      '/api/quote': 'http://localhost:3002',
      '/api/crypto': 'http://localhost:3002',
      '/api/social': 'http://localhost:3002',
      '/api/predictions': 'http://localhost:3002',
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
});
