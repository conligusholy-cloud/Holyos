# BS2 — soukromá sekce (bestseries2.cz)

Samostatná aplikace oddělená od HolyOS: vlastní Railway projekt, vlastní Postgres, vlastní doména.
HolyOS s ní sdílí jen SSO správců (jednorázový token podepsaný `BS2_SSO_SECRET`) a odkaz v sidebaru,
který vidí jen vybraní lidé (výchozí: Tomáš Holý a Jan Holý).

## Co umí

- **Podporovatelé** — tabulka `supporters` (e-mail = klíč, jméno, příjmení, nick, heslo, stav, další údaje JSONB).
- **Import CSV / XLSX** (`/admin/import`) — sloupce podle hlavičky (E-mail, Jméno, Příjmení, „Jméno a příjmení"), ostatní
  sloupce do „dalších údajů". Upsert podle e-mailu, nikdy nepřepíše nick/heslo. Volba „jen vyzkoušet".
- **První přihlášení** podporovatele: `/activate` → e-mail musí být v seznamu → zvolí nick + heslo → účet `active`.
  Cizí e-mail se dál nedostane. Pak `/login` nickem nebo e-mailem. Rate-limit 20 pokusů / 15 min na IP.
- **Správa** (SSO z HolyOS): přehled, seznam s hledáním/filtrem, detail, přidat ručně, reset přihlášení
  (smaže nick+heslo → znovu aktivace), blokovat/odblokovat, smazat, log akcí (`admin_log`).
- Vše responzivní (mobile-first; na mobilu je seznam jako karty), `noindex`.

## Databáze

V projektu BS2 na Railway přidej **PostgreSQL** (+ New → Database → PostgreSQL) a do služby BS2 dej proměnnou
`DATABASE_URL = ${{Postgres.DATABASE_URL}}` (reference). Schéma se založí samo při startu (`db.js → migrate()`).

## Nasazení (jednou)

1. **Railway → New Service → GitHub repo** (stejné repo jako HolyOS)
   - Settings → **Root Directory**: `apps/bs2`
   - Start command se vezme z `package.json` (`npm start`)
2. **Variables** služby BS2:
   - `BS2_SSO_SECRET` = dlouhý náhodný řetězec (stejný dej i do HolyOS)
   - `BS2_SESSION_SECRET` = jiný náhodný řetězec
   - `HOLYOS_URL` = `https://app.holyos.cz`
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (viz Databáze)
   - `BS2_PUBLIC_URL` = `https://www.bestseries2.cz` (jen pro zobrazení odkazu v adminu)
   - volitelně `BS2_ALLOWED_PIDS` = `1,2` (person id z HolyOS — pojistka i na této straně)
3. **Doména**: Settings → Networking → Custom Domain `bestseries2.cz` (+ `www.bestseries2.cz`).
   Railway ukáže CNAME cíl → ve WEDOS u domény *editovat DNS záznamy*:
   - `www` CNAME → `<xxx>.up.railway.app`
   - kořen `@`: WEDOS neumí CNAME na kořen → buď ALIAS/ANAME (pokud nabídne), nebo přesměrování `bestseries2.cz → www.bestseries2.cz`
4. **HolyOS** (služba HolyOS → Variables, pak redeploy):
   - `BS2_URL` = `https://www.bestseries2.cz`
   - `BS2_SSO_SECRET` = stejná hodnota jako výše
   - volitelně `BS2_NAME` = název položky v sidebaru (výchozí „Soukromá sekce")
   - volitelně `BS2_ALLOWED_PERSON_IDS` = `1,2` (jinak se bere Tomáš Holý + Jan Holý podle jména)

Generování tajemství (PowerShell): `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }) -as [byte[]])`

## Lokálně

```
cd apps/bs2 && npm install
$env:BS2_SSO_SECRET="test"; $env:HOLYOS_URL="http://localhost:3000"; npm start   # http://localhost:3100
```
