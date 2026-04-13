# HolyOS — Nastavení PostgreSQL na Railway

## Krok 1: Přidej PostgreSQL na Railway

1. Otevři [Railway Dashboard](https://railway.app/dashboard)
2. Otevři svůj projekt HolyOS
3. Klikni **+ New** → **Database** → **Add PostgreSQL**
4. Railway vytvoří PostgreSQL instanci a přidá `DATABASE_URL` do proměnných

## Krok 2: Získej connection string

1. Klikni na nově vytvořenou PostgreSQL službu
2. Přejdi na záložku **Variables**
3. Zkopíruj hodnotu `DATABASE_URL`
   - Vypadá nějak takhle: `postgresql://postgres:xxxx@xxx.railway.app:5432/railway`

## Krok 3: Nastav lokální .env

Přidej do `.env` souboru:

```
DATABASE_URL="postgresql://postgres:xxxx@xxx.railway.app:5432/railway"
JWT_SECRET="vymysli-si-dlouhy-nahodny-retezec"
ANTHROPIC_API_KEY="sk-ant-..."
```

## Krok 4: Spusť migrace

```bash
# Vygeneruj Prisma klienta
npx prisma generate

# Vytvoř tabulky v databázi
npx prisma migrate dev --name init

# Ověř, že tabulky existují
npx prisma studio
```

## Krok 5: Migruj data z JSON souborů

```bash
# Přenes data z data/hr.json, users.json atd. do PostgreSQL
npm run db:seed
```

## Krok 6: Otestuj lokálně

```bash
# Spusť nový Express server
npm run dev

# Otevři http://localhost:3000/api/health
# Mělo by vrátit: { "status": "ok", "version": "0.3.0" }
```

## Krok 7: Deploy na Railway

```bash
# Railway automaticky spustí npm start, který:
# 1. Spustí prisma migrate deploy (aplikuje migrace)
# 2. Spustí node app.js

railway up
```

## Krok 8: Nastav proměnné na Railway

V Railway dashboardu přidej do svého serveru tyto proměnné:
- `DATABASE_URL` → bude automaticky z PostgreSQL service (použij Reference: `${{Postgres.DATABASE_URL}}`)
- `JWT_SECRET` → tvůj tajný klíč
- `ANTHROPIC_API_KEY` → API klíč pro Claude
- `NODE_ENV` → `production`

## Důležité poznámky

- **Starý server** je stále k dispozici: `npm run start:old` spustí původní `server.js`
- **Nový server** běží na `app.js` s Express, Prisma a JWT
- **Frontend** se nemění — stávající HTML/JS moduly fungují beze změn
- **Hesla uživatelů** se při migraci resetují na `changeme` — uživatelé si je změní po prvním přihlášení
- **Prisma Studio** (`npm run db:studio`) je grafický prohlížeč databáze — skvělé pro kontrolu dat

## Troubleshooting

### "Cannot find module '@prisma/client'"
```bash
npx prisma generate
```

### "relation does not exist"
```bash
npx prisma migrate dev
```

### "connection refused"
Ověř, že `DATABASE_URL` v `.env` je správný a PostgreSQL běží.
