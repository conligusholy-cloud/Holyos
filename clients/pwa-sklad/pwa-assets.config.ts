// HolyOS PWA — konfigurace generátoru ikon.
//
// Z jednoho source SVG (`assets/logo.svg`) generuje všechny potřebné PNG
// varianty do `public/`. Spouští se manuálně přes `npm run generate-pwa-assets`.

import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset,
  // Source SVG leží v public/, generované PNG ikony budou vedle něj (také public/).
  images: ['public/logo.svg'],
});
