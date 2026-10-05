# BS2 — soukromá sekce (bestseries2.cz)

Samostatná aplikace oddělená od HolyOS: vlastní Railway služba, vlastní doména, vlastní data.
HolyOS s ní sdílí jen SSO (jednorázový token podepsaný `BS2_SSO_SECRET`) a odkaz v sidebaru,
který vidí jen vybraní lidé (výchozí: Tomáš Holý a Jan Holý).

## Nasazení (jednou)

1. **Railway → New Service → GitHub repo** (stejné repo jako HolyOS)
   - Settings → **Root Directory**: `apps/bs2`
   - Start command se vezme z `package.json` (`npm start`)
2. **Variables** služby BS2:
   - `BS2_SSO_SECRET` = dlouhý náhodný řetězec (stejný dej i do HolyOS)
   - `BS2_SESSION_SECRET` = jiný náhodný řetězec
   - `HOLYOS_URL` = `https://app.holyos.cz`
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
