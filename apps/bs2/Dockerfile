# BS2 — malý obraz s cache vrstvou závislostí: při změně kódu se neinstaluje npm znovu (deploy ~30 s místo minut)
FROM node:18-alpine
ENV NODE_ENV=production TZ=Europe/Prague
# Chromium z Alpine balíčků pro screenshot staré podpory (puppeteer-core se připojí na tenhle binárka,
# vlastní Chromium si nestahuje — menší a rychlejší build).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
