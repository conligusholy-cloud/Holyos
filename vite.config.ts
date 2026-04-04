import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@client': resolve(__dirname, 'src/client'),
    },
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'vytvoreni-arealu': resolve(__dirname, 'modules/vytvoreni-arealu/index.html'),
        'vytvoreni-arealu-simulace': resolve(__dirname, 'modules/vytvoreni-arealu/simulace.html'),
        'programovani-vyroby': resolve(__dirname, 'modules/programovani-vyroby/index.html'),
        'programovani-vyroby-simulace': resolve(__dirname, 'modules/programovani-vyroby/simulace.html'),
        'simulace-vyroby': resolve(__dirname, 'modules/simulace-vyroby/index.html'),
        'pracovni-postup': resolve(__dirname, 'modules/pracovni-postup/index.html'),
        'pracovni-postup-detail': resolve(__dirname, 'modules/pracovni-postup/detail.html'),
        'pracovni-postup-koncept': resolve(__dirname, 'modules/pracovni-postup/koncept.html'),
        'simulace-vyroby-root': resolve(__dirname, 'simulace-vyroby/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/storage': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
    },
  },
});
