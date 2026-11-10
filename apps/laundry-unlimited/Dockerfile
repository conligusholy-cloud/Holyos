# Laundry Unlimited — malý obraz (express + jsonwebtoken + pg); vrstvená cache závislostí
FROM node:18-alpine
ENV NODE_ENV=production TZ=Europe/Prague
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
