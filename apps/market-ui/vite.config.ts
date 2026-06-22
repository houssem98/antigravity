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
  build: {
    // Split the heaviest libraries into their own long-cached chunks so they
    // load only on routes that need them and don't bloat the initial bundle.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'pdf': ['@react-pdf/renderer'],
          'charts': ['recharts', 'lightweight-charts'],
          'markdown': ['react-markdown'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
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
