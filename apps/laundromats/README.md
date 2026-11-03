# Laundromats (laundromats.eu)

Samostatný veřejný server pro NOVÉ zájemce o prádlomat. Oddělený od BS2 / Best Series 2.0 (podporovatelé): bez databáze, bez účtů, bez admin rozhraní.

- Stránky: `/cesta`, `/cesta/info`, `/cesta/vlastni-kapital`, `/cesta/financovani`, `/cesta/schuzka` + polská verze `/cesta/pl…`; `/` přesměruje na `/cesta`.
- Rezervace schůzky se předává do HolyOS (veřejné `/api/compounder/meeting-*`); potvrzovací e-mail odešle HolyOS přes `/api/auth/lm/send-mail`.

## Nasazení (Railway, NOVÁ služba)
1. Railway → projekt → New Service → GitHub repo → Root Directory `apps/laundromats`.
2. Proměnné služby laundromats:
   - `HOLYOS_URL` = `https://app.holyos.cz`
   - `PUBLIC_URL` = `https://laundromats.eu`
   - `LM_SSO_SECRET` = dlouhé náhodné heslo (např. `openssl rand -hex 32`)
3. Stejné `LM_SSO_SECRET` (a `LM_URL=https://laundromats.eu`) nastavit i ve službě HolyOS, pak HolyOS redeploy.
4. Settings → Networking → Custom Domain: `laundromats.eu` a `www.laundromats.eu`; u registrátora nastavit DNS podle hodnot z Railway (CNAME / A záznam).

Texty stránek se drží shodné s apps/bs2 (cesta-*.js); při změně textu v BS2 je potřeba udělat stejnou změnu zde.

## Podstránky a aplikace lokalit
- `/cesta/compounder`, `/cesta/pradlomaty` — převzato z BS2, upraveno pro zájemce. Stroje z HolyOS `/api/auth/lm/products` (cache 5 min).
  - `LM_SHOW_PRICES=1` zobrazí ceny, `LM_PRODUCT_IDS=1,2,3` zúží nabídku.
- Aplikace `/cesta/hledat` (Najít místo), `/cesta/zhodnotit` (Zhodnotit místo). Staré adresy (/compounder, /hledat…, subdoména lokality.*) se přesměrují.
  - `lm-location-app.js` je odvozený z `apps/bs2/location-app.js` (bez kreditů, balíčků, Stripe, ukládání).
  - Přístup jen pro přihlášené (účty laundromats.eu) a správce z HolyOS (/sso).

## Účty registrovaných uživatelů (lm-account.js)
- Veřejná je jen úvodní stránka a cesta (/cesta, Ekonomika z SMS). Compounder, Prádlomaty, /cesta/ucet/ekonomika, Najít a Zhodnotit místo vyžadují přihlášení.
- /cesta/registrace → e-mail s ověřením (/cesta/overit) → přihlášen; /cesta/prihlaseni, /cesta/zapomenute-heslo, /cesta/nove-heslo, /cesta/ucet (rozcestník + údaje + heslo), /cesta/odhlasit.
- Účty v HolyOS (model LmAccount, /api/auth/lm/accounts/*), relace v cookie lm_acc (30 dní), kontrola platnosti v HolyOS á 5 min.
