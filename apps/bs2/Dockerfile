# BS2 — malý obraz s cache vrstvou závislostí: při změně kódu se neinstaluje npm znovu (deploy ~30 s místo minut)
FROM node:18-alpine
ENV NODE_ENV=production TZ=Europe/Prague
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
