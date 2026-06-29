import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    cesium(), // Handles CesiumJS static assets and WASM workers
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // react-plotly.js CJS requires 'plotly.js/dist/plotly'; redirect to the
      // already-installed plotly.js-dist-min which exports the same object
      'plotly.js/dist/plotly': 'plotly.js-dist-min',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 5000, // CesiumJS is large
    rollupOptions: {
      output: {
        manualChunks: {
          plotly: ['plotly.js-dist-min'],
        },
      },
    },
  },
  define: {
    // CesiumJS requires this global
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
});
