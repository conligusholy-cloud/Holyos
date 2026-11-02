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
