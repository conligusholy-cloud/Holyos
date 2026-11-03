# Úvodní stránka laundromats.eu — chybějící podklady

Stránka: `apps/laundromats/home-page.js` (texty ve slovníku `T.cs`, jazyky v `LANGS`).
Náhled: `https://laundromats.eu/uvod`. Na `/` se zapne proměnnou `LM_HOME_LIVE=1` (do té doby `/` → `/cesta`).
Formulář je funkční: `/api/inquiry` → HolyOS `/api/compounder/lm-inquiry` → kontakt (Jan Holý) + upozornění do Velína.

## Doplnit před zveřejněním

1. **Hlavní fotografie** — skutečný venkovní prádlomat v reálném prostředí (WebP, ~1600 px, < 250 kB). Teď je tam produktový snímek s popiskem „Ilustrační snímek zařízení“.
2. **Galerie provozoven** — 4–8 fotografií skutečných provozů (sekce Naše síť, místo označené čárkovaně).
3. **Mapa sítě** — seznam adres / měst, které lze zveřejnit (body se nezobrazí, dokud seznam nedodáme).
4. **Logo Best Series** (SVG/PNG) a **URL webu výrobce** (sekce Technologie — teď „odkaz doplníme“).
5. **Identita provozovatele webu** — firma, IČO, sídlo, kontaktní telefon (patička).
6. **Zásady zpracování osobních údajů** — text pro `/gdpr` (správce, účel, doba uložení, práva).
7. **Překlady** — další jazyky doplnit do `T` a `LANGS` (přepínač se zobrazí sám, až bude víc jazyků).
8. Později: doložené **případové studie** a **kalkulačka** do sekce Ekonomika (`#eco-ext`).
