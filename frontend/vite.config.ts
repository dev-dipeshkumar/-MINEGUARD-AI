import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /api to FastAPI so the UI and API share an origin in
// the browser (no CORS juggling, no hardcoded API origin in client code).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['sb-2yqqq75gfg9c.vercel.run'],
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'https://mineguard-ai-rafx.onrender.com',
        changeOrigin: true,
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split the heavy 3D / map libs so the main bundle stays small.
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          leaflet: ['leaflet', 'react-leaflet'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
