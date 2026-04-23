import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// HolyOS — PWA sklad — Vite konfigurace.
//
// Dev:
//   - base = '/'
//   - HMR bez Service Workeru (VitePWA dev workaroundy bývají lámavé)
//
// Prod (`npm run build`):
//   - base = '/pwa/' — HolyOS Express hostuje dist na /pwa/
//   - VitePWA vygeneruje sw.js, manifest.webmanifest, registerSW.js
//   - precache jen app shell (JS/CSS/HTML/ikony); /api/* se záměrně nikdy
//     nezapisuje do Service Workeru (máme IndexedDB cache vlastní)
//
// CORS: PWA běží na stejném originu jako backend (hostováno z Express),
// takže Bearer token v Authorization header funguje bez preflight komplikací.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY || 'http://localhost:3000';
  const isProd = mode === 'production';

  return {
    base: isProd ? '/pwa/' : '/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt', // ne auto — uživatel potvrdí reload
        injectRegister: 'auto',
        strategies: 'generateSW',
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon-180x180.png',
          'logo.svg',
          'pwa-64x64.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'maskable-icon-512x512.png',
        ],
        manifest: {
          id: '/pwa/',
          scope: '/pwa/',
          start_url: '/pwa/',
          name: 'HolyOS Sklad',
          short_name: 'Sklad',
          description: 'HolyOS — PWA pro skladové operace (SUNMI L2H)',
          theme_color: '#1e1e2e',
          background_color: '#1e1e2e',
          display: 'standalone',
          orientation: 'portrait',
          lang: 'cs',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Precache app shell — Workbox si v runtime hlídá revision hashes.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
          // Navigace: pro SPA offline → fallback na index.html; /api/* vylučujeme.
          navigateFallback: '/pwa/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // /api/* nikdy neukládat do SW — IndexedDB je autorita pro offline.
              urlPattern: /^\/api\/.*/,
              handler: 'NetworkOnly',
            },
          ],
          cleanupOutdatedCaches: true,
        },
        devOptions: {
          enabled: false, // SW jen v produkci
        },
      }),
    ],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2020',
      // Split chunky pro rychlejší initial load + lepší cache reuse mezi deploy.
      // react a scanner jsou stabilní, mění se zřídka — dostanou long-term cache.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            scanner: ['@zxing/browser', '@zxing/library'],
            idb: ['idb'],
          },
        },
      },
      // Zvýšení warning limitu, aby vite nepumpoval na rozumné chunky.
      chunkSizeWarningLimit: 400,
    },
  };
});
