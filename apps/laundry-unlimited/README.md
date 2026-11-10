# Laundry Unlimited (laundry-unlimited.com)

Samostatný veřejný web pro hledání **master franšízantů** + administrace poptávek. Vlastní služba na Railway s vlastní PostgreSQL databází (tabulka `inquiries` se vytvoří sama při startu).

- Stránky: `/` (úvod: model, co získáte, koho hledáme), `/apply` (poptávka: kontakt), `/questionnaire/:token` (navazující dotazník), `/thanks`.
- Jazyky: EN (výchozí, `/`), CS `/cs`, PL `/pl`, DE `/de`. Texty v `i18n.js`. Při návštěvě `/` se jazyk zvolí podle prohlížeče.
- Administrace `/admin` (seznam poptávek, stavy, poznámky, CSV export). Otevírá se přes SSO z HolyOS (menu Soukromé → Laundry Unlimited). Nové poptávky posílají notifikaci do Velínu / zvonečku (Tomáš, Jan).
- Logo: pokud do `public/` nahraješ `logo.png` (nebo `logo.svg` / `logo.webp`), použije se místo vektorové náhrady.

## Nasazení (Railway, NOVÁ služba)
1. Railway → projekt → **New Service → GitHub repo** → Root Directory `apps/laundry-unlimited`.
2. Přidat **PostgreSQL** (New → Database → PostgreSQL) a v proměnných služby nastavit `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference na novou databázi).
3. Proměnné služby:
   - `HOLYOS_URL` = `https://app.holyos.cz`
   - `PUBLIC_URL` = `https://laundry-unlimited.com`
   - `LU_SSO_SECRET` = dlouhé náhodné heslo (např. `openssl rand -hex 32`)
4. Ve službě **HolyOS** nastavit stejné `LU_SSO_SECRET` a `LU_URL=https://laundry-unlimited.com`, pak HolyOS redeploy (položka v menu se ukáže Tomášovi a Janovi; `LU_ALLOWED_PERSON_IDS` přepíše výchozí).
5. Settings → Networking → Custom Domain: `laundry-unlimited.com` a `www.laundry-unlimited.com`. DNS (WEDOS): holá doména ALIAS na hodnotu z Railway, `www` CNAME na hodnotu z Railway, plus TXT `_railway-verify`.
