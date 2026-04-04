// vite.config.ts
import { defineConfig } from "file:///sessions/affectionate-keen-bardeen/mnt/V%C3%BDroba/node_modules/vite/dist/node/index.js";
import { resolve } from "path";
var __vite_injected_original_dirname = "/sessions/affectionate-keen-bardeen/mnt/V\xFDroba";
var vite_config_default = defineConfig({
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      "@shared": resolve(__vite_injected_original_dirname, "src/shared"),
      "@client": resolve(__vite_injected_original_dirname, "src/client")
    }
  },
  build: {
    outDir: "dist/client",
    rollupOptions: {
      input: {
        main: resolve(__vite_injected_original_dirname, "index.html"),
        "vytvoreni-arealu": resolve(__vite_injected_original_dirname, "modules/vytvoreni-arealu/index.html"),
        "vytvoreni-arealu-simulace": resolve(__vite_injected_original_dirname, "modules/vytvoreni-arealu/simulace.html"),
        "programovani-vyroby": resolve(__vite_injected_original_dirname, "modules/programovani-vyroby/index.html"),
        "programovani-vyroby-simulace": resolve(__vite_injected_original_dirname, "modules/programovani-vyroby/simulace.html"),
        "simulace-vyroby": resolve(__vite_injected_original_dirname, "modules/simulace-vyroby/index.html"),
        "pracovni-postup": resolve(__vite_injected_original_dirname, "modules/pracovni-postup/index.html"),
        "pracovni-postup-detail": resolve(__vite_injected_original_dirname, "modules/pracovni-postup/detail.html"),
        "pracovni-postup-koncept": resolve(__vite_injected_original_dirname, "modules/pracovni-postup/koncept.html"),
        "simulace-vyroby-root": resolve(__vite_injected_original_dirname, "simulace-vyroby/index.html")
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/storage": "http://localhost:3000",
      "/admin": "http://localhost:3000"
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvYWZmZWN0aW9uYXRlLWtlZW4tYmFyZGVlbi9tbnQvVlx1MDBGRHJvYmFcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy9hZmZlY3Rpb25hdGUta2Vlbi1iYXJkZWVuL21udC9WXHUwMEZEcm9iYS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvYWZmZWN0aW9uYXRlLWtlZW4tYmFyZGVlbi9tbnQvViVDMyVCRHJvYmEvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcm9vdDogJy4nLFxuICBwdWJsaWNEaXI6ICdwdWJsaWMnLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAc2hhcmVkJzogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvc2hhcmVkJyksXG4gICAgICAnQGNsaWVudCc6IHJlc29sdmUoX19kaXJuYW1lLCAnc3JjL2NsaWVudCcpLFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgb3V0RGlyOiAnZGlzdC9jbGllbnQnLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIGlucHV0OiB7XG4gICAgICAgIG1haW46IHJlc29sdmUoX19kaXJuYW1lLCAnaW5kZXguaHRtbCcpLFxuICAgICAgICAndnl0dm9yZW5pLWFyZWFsdSc6IHJlc29sdmUoX19kaXJuYW1lLCAnbW9kdWxlcy92eXR2b3JlbmktYXJlYWx1L2luZGV4Lmh0bWwnKSxcbiAgICAgICAgJ3Z5dHZvcmVuaS1hcmVhbHUtc2ltdWxhY2UnOiByZXNvbHZlKF9fZGlybmFtZSwgJ21vZHVsZXMvdnl0dm9yZW5pLWFyZWFsdS9zaW11bGFjZS5odG1sJyksXG4gICAgICAgICdwcm9ncmFtb3Zhbmktdnlyb2J5JzogcmVzb2x2ZShfX2Rpcm5hbWUsICdtb2R1bGVzL3Byb2dyYW1vdmFuaS12eXJvYnkvaW5kZXguaHRtbCcpLFxuICAgICAgICAncHJvZ3JhbW92YW5pLXZ5cm9ieS1zaW11bGFjZSc6IHJlc29sdmUoX19kaXJuYW1lLCAnbW9kdWxlcy9wcm9ncmFtb3Zhbmktdnlyb2J5L3NpbXVsYWNlLmh0bWwnKSxcbiAgICAgICAgJ3NpbXVsYWNlLXZ5cm9ieSc6IHJlc29sdmUoX19kaXJuYW1lLCAnbW9kdWxlcy9zaW11bGFjZS12eXJvYnkvaW5kZXguaHRtbCcpLFxuICAgICAgICAncHJhY292bmktcG9zdHVwJzogcmVzb2x2ZShfX2Rpcm5hbWUsICdtb2R1bGVzL3ByYWNvdm5pLXBvc3R1cC9pbmRleC5odG1sJyksXG4gICAgICAgICdwcmFjb3ZuaS1wb3N0dXAtZGV0YWlsJzogcmVzb2x2ZShfX2Rpcm5hbWUsICdtb2R1bGVzL3ByYWNvdm5pLXBvc3R1cC9kZXRhaWwuaHRtbCcpLFxuICAgICAgICAncHJhY292bmktcG9zdHVwLWtvbmNlcHQnOiByZXNvbHZlKF9fZGlybmFtZSwgJ21vZHVsZXMvcHJhY292bmktcG9zdHVwL2tvbmNlcHQuaHRtbCcpLFxuICAgICAgICAnc2ltdWxhY2Utdnlyb2J5LXJvb3QnOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NpbXVsYWNlLXZ5cm9ieS9pbmRleC5odG1sJyksXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgcHJveHk6IHtcbiAgICAgICcvYXBpJzogJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsXG4gICAgICAnL2F1dGgnOiAnaHR0cDovL2xvY2FsaG9zdDozMDAwJyxcbiAgICAgICcvc3RvcmFnZSc6ICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxuICAgICAgJy9hZG1pbic6ICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxuICAgIH0sXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBaVUsU0FBUyxvQkFBb0I7QUFDOVYsU0FBUyxlQUFlO0FBRHhCLElBQU0sbUNBQW1DO0FBR3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLE1BQU07QUFBQSxFQUNOLFdBQVc7QUFBQSxFQUNYLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLFdBQVcsUUFBUSxrQ0FBVyxZQUFZO0FBQUEsTUFDMUMsV0FBVyxRQUFRLGtDQUFXLFlBQVk7QUFBQSxJQUM1QztBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLGVBQWU7QUFBQSxNQUNiLE9BQU87QUFBQSxRQUNMLE1BQU0sUUFBUSxrQ0FBVyxZQUFZO0FBQUEsUUFDckMsb0JBQW9CLFFBQVEsa0NBQVcscUNBQXFDO0FBQUEsUUFDNUUsNkJBQTZCLFFBQVEsa0NBQVcsd0NBQXdDO0FBQUEsUUFDeEYsdUJBQXVCLFFBQVEsa0NBQVcsd0NBQXdDO0FBQUEsUUFDbEYsZ0NBQWdDLFFBQVEsa0NBQVcsMkNBQTJDO0FBQUEsUUFDOUYsbUJBQW1CLFFBQVEsa0NBQVcsb0NBQW9DO0FBQUEsUUFDMUUsbUJBQW1CLFFBQVEsa0NBQVcsb0NBQW9DO0FBQUEsUUFDMUUsMEJBQTBCLFFBQVEsa0NBQVcscUNBQXFDO0FBQUEsUUFDbEYsMkJBQTJCLFFBQVEsa0NBQVcsc0NBQXNDO0FBQUEsUUFDcEYsd0JBQXdCLFFBQVEsa0NBQVcsNEJBQTRCO0FBQUEsTUFDekU7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLE1BQ1QsWUFBWTtBQUFBLE1BQ1osVUFBVTtBQUFBLElBQ1o7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
