# =============================================================================
# HolyOS — produkční image pro Railway
# =============================================================================
# Cíl: rychlé opakované deploye přes vrstvenou cache.
#  • Vrstva se závislostmi (npm ci + stažení Chromia pro puppeteer) se přebuildí
#    JEN když se změní package*.json → jinak se vezme z cache (deploy ~1–2 min).
#  • Zdrojové soubory jsou v poslední (levné) vrstvě.
# Chromium zůstává bundled od puppeteeru (stejný jako dosud) — jen doplňujeme
# systémové knihovny, které headless Chromium potřebuje ke spuštění.

FROM node:22-slim

ENV NODE_ENV=production

# Systémové knihovny pro headless Chromium (generování PDF faktur/objednávek + tisk).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation fonts-noto-color-emoji \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
      libdbus-1-3 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 libnss3 \
      libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Závislosti — cache vrstva (přebuildí se jen při změně package*.json).
#    npm install (ne ci): tolerantní k drobnému nesouladu package.json ↔ lock.
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 2) Prisma client (potřebuje schema).
COPY prisma ./prisma
RUN npx prisma generate

# 3) Zbytek zdrojáků — mění se nejčastěji, poslední levná vrstva.
COPY . .

# Migrace při startu (idempotentní), pak server. (railway.json startCommand = npm start dělá totéž.)
CMD ["sh", "-c", "npx prisma migrate deploy && node app.js"]
