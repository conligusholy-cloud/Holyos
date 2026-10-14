// vite.config.js
import { defineConfig, loadEnv } from "file:///sessions/dazzling-friendly-clarke/mnt/V%C3%BDroba/clients/pwa-sklad/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/dazzling-friendly-clarke/mnt/V%C3%BDroba/clients/pwa-sklad/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/dazzling-friendly-clarke/mnt/V%C3%BDroba/clients/pwa-sklad/node_modules/vite-plugin-pwa/dist/index.js";
var vite_config_default = defineConfig(function(_a) {
  var mode = _a.mode;
  var env = loadEnv(mode, process.cwd(), "");
  var apiTarget = env.VITE_API_PROXY || "http://localhost:3000";
  var isProd = mode === "production";
  return {
    base: isProd ? "/pwa/" : "/",
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        // ne auto — uživatel potvrdí reload
        injectRegister: "auto",
        strategies: "generateSW",
        includeAssets: [
          "favicon.ico",
          "apple-touch-icon-180x180.png",
          "logo.svg",
          "pwa-64x64.png",
          "pwa-192x192.png",
          "pwa-512x512.png",
          "maskable-icon-512x512.png"
        ],
        manifest: {
          id: "/pwa/",
          scope: "/pwa/",
          start_url: "/pwa/",
          name: "HolyOS Sklad",
          short_name: "Sklad",
          description: "HolyOS \u2014 PWA pro skladov\xE9 operace (SUNMI L2H)",
          theme_color: "#1e1e2e",
          background_color: "#1e1e2e",
          display: "standalone",
          orientation: "portrait",
          lang: "cs",
          icons: [
            { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "maskable-icon-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable"
            }
          ]
        },
        workbox: {
          // Precache app shell — Workbox si v runtime hlídá revision hashes.
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
          // Navigace: pro SPA offline → fallback na index.html; /api/* vylučujeme.
          navigateFallback: "/pwa/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // /api/* nikdy neukládat do SW — IndexedDB je autorita pro offline.
              urlPattern: /^\/api\/.*/,
              handler: "NetworkOnly"
            }
          ],
          cleanupOutdatedCaches: true
        },
        devOptions: {
          enabled: false
          // SW jen v produkci
        }
      })
    ],
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: false
        }
      }
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      target: "es2020",
      // Split chunky pro rychlejší initial load + lepší cache reuse mezi deploy.
      // react a scanner jsou stabilní, mění se zřídka — dostanou long-term cache.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            scanner: ["@zxing/browser", "@zxing/library"],
            idb: ["idb"]
          }
        }
      },
      // Zvýšení warning limitu, aby vite nepumpoval na rozumné chunky.
      chunkSizeWarningLimit: 400
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvZGF6emxpbmctZnJpZW5kbHktY2xhcmtlL21udC9WXHUwMEZEcm9iYS9jbGllbnRzL3B3YS1za2xhZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL2RhenpsaW5nLWZyaWVuZGx5LWNsYXJrZS9tbnQvVlx1MDBGRHJvYmEvY2xpZW50cy9wd2Etc2tsYWQvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL2RhenpsaW5nLWZyaWVuZGx5LWNsYXJrZS9tbnQvViVDMyVCRHJvYmEvY2xpZW50cy9wd2Etc2tsYWQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJztcclxuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcclxuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSc7XHJcbi8vIEhvbHlPUyBcdTIwMTQgUFdBIHNrbGFkIFx1MjAxNCBWaXRlIGtvbmZpZ3VyYWNlLlxyXG4vL1xyXG4vLyBEZXY6XHJcbi8vICAgLSBiYXNlID0gJy8nXHJcbi8vICAgLSBITVIgYmV6IFNlcnZpY2UgV29ya2VydSAoVml0ZVBXQSBkZXYgd29ya2Fyb3VuZHkgYlx1MDBGRHZhalx1MDBFRCBsXHUwMEUxbWF2XHUwMEU5KVxyXG4vL1xyXG4vLyBQcm9kIChgbnBtIHJ1biBidWlsZGApOlxyXG4vLyAgIC0gYmFzZSA9ICcvcHdhLycgXHUyMDE0IEhvbHlPUyBFeHByZXNzIGhvc3R1amUgZGlzdCBuYSAvcHdhL1xyXG4vLyAgIC0gVml0ZVBXQSB2eWdlbmVydWplIHN3LmpzLCBtYW5pZmVzdC53ZWJtYW5pZmVzdCwgcmVnaXN0ZXJTVy5qc1xyXG4vLyAgIC0gcHJlY2FjaGUgamVuIGFwcCBzaGVsbCAoSlMvQ1NTL0hUTUwvaWtvbnkpOyAvYXBpLyogc2Ugelx1MDBFMW1cdTAxMUJyblx1MDExQiBuaWtkeVxyXG4vLyAgICAgbmV6YXBpc3VqZSBkbyBTZXJ2aWNlIFdvcmtlcnUgKG1cdTAwRTFtZSBJbmRleGVkREIgY2FjaGUgdmxhc3RuXHUwMEVEKVxyXG4vL1xyXG4vLyBDT1JTOiBQV0EgYlx1MDExQlx1MDE3RVx1MDBFRCBuYSBzdGVqblx1MDBFOW0gb3JpZ2ludSBqYWtvIGJhY2tlbmQgKGhvc3Rvdlx1MDBFMW5vIHogRXhwcmVzcyksXHJcbi8vIHRha1x1MDE3RWUgQmVhcmVyIHRva2VuIHYgQXV0aG9yaXphdGlvbiBoZWFkZXIgZnVuZ3VqZSBiZXogcHJlZmxpZ2h0IGtvbXBsaWthY1x1MDBFRC5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKGZ1bmN0aW9uIChfYSkge1xyXG4gICAgdmFyIG1vZGUgPSBfYS5tb2RlO1xyXG4gICAgdmFyIGVudiA9IGxvYWRFbnYobW9kZSwgcHJvY2Vzcy5jd2QoKSwgJycpO1xyXG4gICAgdmFyIGFwaVRhcmdldCA9IGVudi5WSVRFX0FQSV9QUk9YWSB8fCAnaHR0cDovL2xvY2FsaG9zdDozMDAwJztcclxuICAgIHZhciBpc1Byb2QgPSBtb2RlID09PSAncHJvZHVjdGlvbic7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGJhc2U6IGlzUHJvZCA/ICcvcHdhLycgOiAnLycsXHJcbiAgICAgICAgcGx1Z2luczogW1xyXG4gICAgICAgICAgICByZWFjdCgpLFxyXG4gICAgICAgICAgICBWaXRlUFdBKHtcclxuICAgICAgICAgICAgICAgIHJlZ2lzdGVyVHlwZTogJ3Byb21wdCcsIC8vIG5lIGF1dG8gXHUyMDE0IHVcdTAxN0VpdmF0ZWwgcG90dnJkXHUwMEVEIHJlbG9hZFxyXG4gICAgICAgICAgICAgICAgaW5qZWN0UmVnaXN0ZXI6ICdhdXRvJyxcclxuICAgICAgICAgICAgICAgIHN0cmF0ZWdpZXM6ICdnZW5lcmF0ZVNXJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVBc3NldHM6IFtcclxuICAgICAgICAgICAgICAgICAgICAnZmF2aWNvbi5pY28nLFxyXG4gICAgICAgICAgICAgICAgICAgICdhcHBsZS10b3VjaC1pY29uLTE4MHgxODAucG5nJyxcclxuICAgICAgICAgICAgICAgICAgICAnbG9nby5zdmcnLFxyXG4gICAgICAgICAgICAgICAgICAgICdwd2EtNjR4NjQucG5nJyxcclxuICAgICAgICAgICAgICAgICAgICAncHdhLTE5MngxOTIucG5nJyxcclxuICAgICAgICAgICAgICAgICAgICAncHdhLTUxMng1MTIucG5nJyxcclxuICAgICAgICAgICAgICAgICAgICAnbWFza2FibGUtaWNvbi01MTJ4NTEyLnBuZycsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgbWFuaWZlc3Q6IHtcclxuICAgICAgICAgICAgICAgICAgICBpZDogJy9wd2EvJyxcclxuICAgICAgICAgICAgICAgICAgICBzY29wZTogJy9wd2EvJyxcclxuICAgICAgICAgICAgICAgICAgICBzdGFydF91cmw6ICcvcHdhLycsXHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ0hvbHlPUyBTa2xhZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgc2hvcnRfbmFtZTogJ1NrbGFkJyxcclxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0hvbHlPUyBcdTIwMTQgUFdBIHBybyBza2xhZG92XHUwMEU5IG9wZXJhY2UgKFNVTk1JIEwySCknLFxyXG4gICAgICAgICAgICAgICAgICAgIHRoZW1lX2NvbG9yOiAnIzFlMWUyZScsXHJcbiAgICAgICAgICAgICAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyMxZTFlMmUnLFxyXG4gICAgICAgICAgICAgICAgICAgIGRpc3BsYXk6ICdzdGFuZGFsb25lJyxcclxuICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbjogJ3BvcnRyYWl0JyxcclxuICAgICAgICAgICAgICAgICAgICBsYW5nOiAnY3MnLFxyXG4gICAgICAgICAgICAgICAgICAgIGljb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgc3JjOiAncHdhLTY0eDY0LnBuZycsIHNpemVzOiAnNjR4NjQnLCB0eXBlOiAnaW1hZ2UvcG5nJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB7IHNyYzogJ3B3YS0xOTJ4MTkyLnBuZycsIHNpemVzOiAnMTkyeDE5MicsIHR5cGU6ICdpbWFnZS9wbmcnIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgc3JjOiAncHdhLTUxMng1MTIucG5nJywgc2l6ZXM6ICc1MTJ4NTEyJywgdHlwZTogJ2ltYWdlL3BuZycgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3JjOiAnbWFza2FibGUtaWNvbi01MTJ4NTEyLnBuZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaXplczogJzUxMng1MTInLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2ltYWdlL3BuZycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwdXJwb3NlOiAnbWFza2FibGUnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgd29ya2JveDoge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFByZWNhY2hlIGFwcCBzaGVsbCBcdTIwMTQgV29ya2JveCBzaSB2IHJ1bnRpbWUgaGxcdTAwRURkXHUwMEUxIHJldmlzaW9uIGhhc2hlcy5cclxuICAgICAgICAgICAgICAgICAgICBnbG9iUGF0dGVybnM6IFsnKiovKi57anMsY3NzLGh0bWwsaWNvLHBuZyxzdmcsd2VibWFuaWZlc3R9J10sXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gTmF2aWdhY2U6IHBybyBTUEEgb2ZmbGluZSBcdTIxOTIgZmFsbGJhY2sgbmEgaW5kZXguaHRtbDsgL2FwaS8qIHZ5bHVcdTAxMER1amVtZS5cclxuICAgICAgICAgICAgICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrOiAnL3B3YS9pbmRleC5odG1sJyxcclxuICAgICAgICAgICAgICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrRGVueWxpc3Q6IFsvXlxcL2FwaVxcLy9dLFxyXG4gICAgICAgICAgICAgICAgICAgIHJ1bnRpbWVDYWNoaW5nOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIC9hcGkvKiBuaWtkeSBuZXVrbFx1MDBFMWRhdCBkbyBTVyBcdTIwMTQgSW5kZXhlZERCIGplIGF1dG9yaXRhIHBybyBvZmZsaW5lLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXJsUGF0dGVybjogL15cXC9hcGlcXC8uKi8sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVyOiAnTmV0d29ya09ubHknLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICAgICAgY2xlYW51cE91dGRhdGVkQ2FjaGVzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGRldk9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiBmYWxzZSwgLy8gU1cgamVuIHYgcHJvZHVrY2lcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgc2VydmVyOiB7XHJcbiAgICAgICAgICAgIGhvc3Q6IHRydWUsXHJcbiAgICAgICAgICAgIHBvcnQ6IDUxNzMsXHJcbiAgICAgICAgICAgIHByb3h5OiB7XHJcbiAgICAgICAgICAgICAgICAnL2FwaSc6IHtcclxuICAgICAgICAgICAgICAgICAgICB0YXJnZXQ6IGFwaVRhcmdldCxcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgc2VjdXJlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBidWlsZDoge1xyXG4gICAgICAgICAgICBvdXREaXI6ICdkaXN0JyxcclxuICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxyXG4gICAgICAgICAgICB0YXJnZXQ6ICdlczIwMjAnLFxyXG4gICAgICAgICAgICAvLyBTcGxpdCBjaHVua3kgcHJvIHJ5Y2hsZWpcdTAxNjFcdTAwRUQgaW5pdGlhbCBsb2FkICsgbGVwXHUwMTYxXHUwMEVEIGNhY2hlIHJldXNlIG1lemkgZGVwbG95LlxyXG4gICAgICAgICAgICAvLyByZWFjdCBhIHNjYW5uZXIganNvdSBzdGFiaWxuXHUwMEVELCBtXHUwMTFCblx1MDBFRCBzZSB6XHUwMTU5XHUwMEVEZGthIFx1MjAxNCBkb3N0YW5vdSBsb25nLXRlcm0gY2FjaGUuXHJcbiAgICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgIG91dHB1dDoge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hbnVhbENodW5rczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWFjdDogWydyZWFjdCcsICdyZWFjdC1kb20nLCAncmVhY3Qtcm91dGVyLWRvbSddLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzY2FubmVyOiBbJ0B6eGluZy9icm93c2VyJywgJ0B6eGluZy9saWJyYXJ5J10sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkYjogWydpZGInXSxcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gWnZcdTAwRkRcdTAxNjFlblx1MDBFRCB3YXJuaW5nIGxpbWl0dSwgYWJ5IHZpdGUgbmVwdW1wb3ZhbCBuYSByb3p1bW5cdTAwRTkgY2h1bmt5LlxyXG4gICAgICAgICAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDQwMCxcclxuICAgICAgICB9LFxyXG4gICAgfTtcclxufSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBb1gsU0FBUyxjQUFjLGVBQWU7QUFDMVosT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQWV4QixJQUFPLHNCQUFRLGFBQWEsU0FBVSxJQUFJO0FBQ3RDLE1BQUksT0FBTyxHQUFHO0FBQ2QsTUFBSSxNQUFNLFFBQVEsTUFBTSxRQUFRLElBQUksR0FBRyxFQUFFO0FBQ3pDLE1BQUksWUFBWSxJQUFJLGtCQUFrQjtBQUN0QyxNQUFJLFNBQVMsU0FBUztBQUN0QixTQUFPO0FBQUEsSUFDSCxNQUFNLFNBQVMsVUFBVTtBQUFBLElBQ3pCLFNBQVM7QUFBQSxNQUNMLE1BQU07QUFBQSxNQUNOLFFBQVE7QUFBQSxRQUNKLGNBQWM7QUFBQTtBQUFBLFFBQ2QsZ0JBQWdCO0FBQUEsUUFDaEIsWUFBWTtBQUFBLFFBQ1osZUFBZTtBQUFBLFVBQ1g7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxRQUNKO0FBQUEsUUFDQSxVQUFVO0FBQUEsVUFDTixJQUFJO0FBQUEsVUFDSixPQUFPO0FBQUEsVUFDUCxXQUFXO0FBQUEsVUFDWCxNQUFNO0FBQUEsVUFDTixZQUFZO0FBQUEsVUFDWixhQUFhO0FBQUEsVUFDYixhQUFhO0FBQUEsVUFDYixrQkFBa0I7QUFBQSxVQUNsQixTQUFTO0FBQUEsVUFDVCxhQUFhO0FBQUEsVUFDYixNQUFNO0FBQUEsVUFDTixPQUFPO0FBQUEsWUFDSCxFQUFFLEtBQUssaUJBQWlCLE9BQU8sU0FBUyxNQUFNLFlBQVk7QUFBQSxZQUMxRCxFQUFFLEtBQUssbUJBQW1CLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxZQUM5RCxFQUFFLEtBQUssbUJBQW1CLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxZQUM5RDtBQUFBLGNBQ0ksS0FBSztBQUFBLGNBQ0wsT0FBTztBQUFBLGNBQ1AsTUFBTTtBQUFBLGNBQ04sU0FBUztBQUFBLFlBQ2I7QUFBQSxVQUNKO0FBQUEsUUFDSjtBQUFBLFFBQ0EsU0FBUztBQUFBO0FBQUEsVUFFTCxjQUFjLENBQUMsNENBQTRDO0FBQUE7QUFBQSxVQUUzRCxrQkFBa0I7QUFBQSxVQUNsQiwwQkFBMEIsQ0FBQyxVQUFVO0FBQUEsVUFDckMsZ0JBQWdCO0FBQUEsWUFDWjtBQUFBO0FBQUEsY0FFSSxZQUFZO0FBQUEsY0FDWixTQUFTO0FBQUEsWUFDYjtBQUFBLFVBQ0o7QUFBQSxVQUNBLHVCQUF1QjtBQUFBLFFBQzNCO0FBQUEsUUFDQSxZQUFZO0FBQUEsVUFDUixTQUFTO0FBQUE7QUFBQSxRQUNiO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDTDtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sT0FBTztBQUFBLFFBQ0gsUUFBUTtBQUFBLFVBQ0osUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFVBQ2QsUUFBUTtBQUFBLFFBQ1o7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUFBLElBQ0EsT0FBTztBQUFBLE1BQ0gsUUFBUTtBQUFBLE1BQ1IsV0FBVztBQUFBLE1BQ1gsUUFBUTtBQUFBO0FBQUE7QUFBQSxNQUdSLGVBQWU7QUFBQSxRQUNYLFFBQVE7QUFBQSxVQUNKLGNBQWM7QUFBQSxZQUNWLE9BQU8sQ0FBQyxTQUFTLGFBQWEsa0JBQWtCO0FBQUEsWUFDaEQsU0FBUyxDQUFDLGtCQUFrQixnQkFBZ0I7QUFBQSxZQUM1QyxLQUFLLENBQUMsS0FBSztBQUFBLFVBQ2Y7QUFBQSxRQUNKO0FBQUEsTUFDSjtBQUFBO0FBQUEsTUFFQSx1QkFBdUI7QUFBQSxJQUMzQjtBQUFBLEVBQ0o7QUFDSixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
