# =============================================================================
# HolyOS — produkční image pro Railway
# =============================================================================
# Cíl: rychlé opakované deploye přes vrstvenou cache.
#  • Chromium se instaluje SYSTÉMOVĚ z apt (ne bundled z puppeteeru) → npm ci
#    nestahuje ~150 MB Chromia. Nejčastěji přestavovaná vrstva (závislosti) je
#    tak lehká a rychlá i při studené cache; bump závislostí už Chromium neřeší.
#  • apt vrstva (vč. Chromia) se přebuildí jen při změně Dockerfile → z cache.
#  • npm ci vrstva se přebuildí jen při změně package*.json → z cache.
#  • Zdrojové soubory jsou v poslední (levné) vrstvě.

FROM node:22-bookworm-slim

ENV NODE_ENV=production

# Puppeteer: nestahuj bundled Chromium (šetří ~150 MB při npm ci) a používej
# systémový binárník z apt níže.
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + fonty pro headless generování PDF (faktury/objednávky/smlouvy) a tisk.
# Balík `chromium` si sám přitáhne všechny potřebné systémové knihovny.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Závislosti — cache vrstva (přebuildí se jen při změně package*.json).
#    npm ci: rychlý, deterministický (lock je srovnaný). Chromium se nestahuje.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 2) Prisma client (potřebuje schema).
COPY prisma ./prisma
RUN npx prisma generate

# 3) Zbytek zdrojáků — mění se nejčastěji, poslední levná vrstva.
COPY . .

# Migrace při startu (idempotentní), pak server. (railway.json startCommand = npm start dělá totéž.)
CMD ["sh", "-c", "npx prisma migrate deploy && node app.js"]
