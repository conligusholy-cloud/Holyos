# Nasazení aplikace Výroba na web

## Co je potřeba

- Účet na [Railway.app](https://railway.app) (hosting pro Node.js, od $5/měs)
- Doména z Wedosu (např. vyroba-bestseries.cz)
- Git nainstalovaný na počítači

---

## Krok 1: Příprava Git repozitáře

Otevři PowerShell ve složce projektu a spusť:

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba

git init
git add .
git commit -m "Initial commit"
```

Pak vytvoř repozitář na GitHubu (může být privátní) a propoj ho:

```powershell
git remote add origin https://github.com/TVUJ-UCET/vyroba.git
git push -u origin main
```

---

## Krok 2: Railway.app

1. Jdi na [railway.app](https://railway.app) a přihlas se přes GitHub
2. Klikni **"New Project"** → **"Deploy from GitHub repo"**
3. Vyber svůj repozitář `vyroba`
4. Railway automaticky detekuje Node.js a spustí `npm start`

### Nastavení proměnných prostředí

V Railway dashboardu jdi do **Variables** a přidej:

| Proměnná | Hodnota |
|---|---|
| `FACTORIFY_BASE_URL` | `https://bs.factorify.cloud` |
| `FACTORIFY_TOKEN` | `CARD:2323516779` |
| `SESSION_SECRET` | (vygeneruj si náhodný řetězec, např. přes https://randomkeygen.com) |
| `NODE_ENV` | `production` |

Port nastavovat nemusíš — Railway ho nastaví automaticky přes `PORT`.

---

## Krok 3: Vlastní doména (Wedos)

### Na Railway:
1. Jdi do **Settings** → **Networking** → **Custom Domain**
2. Přidej svou doménu (např. `vyroba.bestseries.cz`)
3. Railway ti ukáže CNAME záznam, který musíš nastavit

### Na Wedosu:
1. Přihlas se do administrace Wedos
2. Jdi do **DNS správa** tvé domény
3. Přidej nový **CNAME záznam**:
   - **Název**: `vyroba` (nebo `@` pro hlavní doménu)
   - **Hodnota**: ten CNAME z Railway (např. `xyz.up.railway.app`)
   - **TTL**: 3600
4. Počkej 5–30 minut na propagaci DNS

### SSL certifikát:
Railway automaticky vygeneruje SSL certifikát (HTTPS) — nemusíš nic řešit.

---

## Krok 4: První přihlášení

1. Otevři svou doménu v prohlížeči
2. Přihlas se výchozím účtem: **admin** / **admin**
3. **DŮLEŽITÉ**: Ihned jdi do **Správa uživatelů** (v sidebaru dole) a:
   - Změň si admin heslo (smaž admin účet a vytvoř nový admin účet se silným heslem)
   - Přidej účty pro kolegy

---

## Lokální vývoj

Pro lokální vývoj stačí:

```powershell
node server.js
```

Aplikace poběží na `http://localhost:3000`. Proxy server na portu 3001 už nepotřebuješ — vše běží přes server.js.

---

## Důležité soubory

| Soubor | Popis |
|---|---|
| `server.js` | Hlavní server (statické soubory + proxy + auth) |
| `proxy-server.js` | Starý CORS proxy (už nepotřebuješ pro produkci) |
| `.env` | Lokální konfigurace (NENAHRÁVEJ na Git!) |
| `data/users.json` | Databáze uživatelů (vytvořena automaticky) |
| `package.json` | Node.js konfigurace |
| `.gitignore` | Soubory ignorované Gitem |

---

## Údržba

- **Aktualizace**: Pushnout změny na GitHub → Railway automaticky nasadí novou verzi
- **Logy**: V Railway dashboardu klikni na **Deployments** → **View Logs**
- **Uživatelé**: Spravuj přes `/admin/users` v prohlížeči
- **Záloha dat**: `data/users.json` a `data/storage/` obsahují uživatelská data — Railway má persistent storage, ale doporučuji pravidelné zálohy
