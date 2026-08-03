import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

const ONE_YEAR = 31_536_000;

/** Keep costly optional engines out of the route's initial dependency graph. */
function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, '/');
  if (normalizedId.includes('/node_modules/cesium/')) return 'cesium';
  if (normalizedId.includes('/node_modules/plotly.js-dist-min/')) return 'plotly';
  if (normalizedId.includes('/node_modules/react-plotly.js/')) return 'plotly-react';
  if (normalizedId.includes('/node_modules/react-dom/') || normalizedId.includes('/node_modules/react/')) return 'react-vendor';
  if (normalizedId.includes('/node_modules/')) return 'vendor';
  return undefined;
}

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2,ttf,wasm}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'plotly.js/dist/plotly': 'plotly.js-dist-min',
      'cesium-wind-layer': path.resolve(__dirname, './src/stubs/cesium-wind-layer.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    manifest: true,
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks,
      },
    },
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
    __ASSET_CACHE_MAX_AGE__: JSON.stringify(ONE_YEAR),
  },
});
