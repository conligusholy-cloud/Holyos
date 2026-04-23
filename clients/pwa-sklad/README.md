# HolyOS — PWA Sklad (klient pro SUNMI L2H/L3)

Tenký webový klient pro čtečky v provozu. Volá HolyOS backend (`/api/wh/*`,
`/api/print/*`, `/api/auth/*`) jako Bearer klient — PWA běží na samostatném
originu na čtečce, HolyOS ale umí cookie i header, takže backend žádné
úpravy nepotřebuje.

## Stav milestonů

- **M1 – Skeleton + Auth + Dashboard** ✅
  - Vite + React 18 + TS
  - react-router v6, protected routes
  - `AuthContext` + Bearer token v `localStorage`, `apiFetch` s 401 auto-logoutem
  - Login obrazovka + Dashboard s 5 dlaždicemi (Příjem / Výdej / Přesun / Inventura / Picking)
  - Placeholder stránky akcí
  - Mobile-first CSS s HolyOS paletou, touch targety ≥ 48 px
- **M2 – Offline katalog + Write queue** ✅
  - IndexedDB (`idb`) s v1 schema: `materials`, `locations`, `write_queue`, `meta`
  - `pullCatalog()` — delta sync materiálů přes `/api/wh/sync/materials?since=`, full refresh lokací
  - `flushPending()` — odesílá odložené pohyby na `/api/wh/moves` s `client_uuid` dedup (201 nový / 200 deduped / 4xx failed / síť → zůstává pending)
  - `SyncContext` — auto-flush na offline→online, auto-pull po loginu když IDB prázdná
  - Persistentní `Device ID` (localStorage) → posílán v `X-Device-Id`
  - Dashboard bottom bar ukazuje real online stav + pending count
  - `/debug` stránka: ruční sync, flush, retry/delete selhalých pohybů, view device ID
- **M3 – Příjem / Výdej / Přesun** ✅
  - `useBarcodeScanner` hook — window keydown buffer pro SUNMI keyboard-wedge (rychlá sekvence + Enter = scan, ignoruje user typing)
  - `CameraScanner` fallback přes `@zxing/browser` (dev notebook, telefon, SUNMI bez scanneru)
  - `lookupMaterialByQr` / `lookupLocationByQr` — online via API, offline fallback na IDB `by-barcode` index, `NotFoundError` pro 404
  - Generický `MoveWizard` data-driven na `StepId[]` — tři stránky (`ReceivePage`, `IssuePage`, `TransferPage`) se liší jen konfigurací kroků
  - Numpad pro quantity s desetinnou čárkou, touch targety 64 px
  - Submit zapisuje přes `enqueueMove()` → online rovnou flush, offline čeká ve frontě; úspěchová obrazovka vždy (idempotence backendu přes `client_uuid` to zaručuje)
- **M4 – Inventura + Picking dávek** ✅
  - Inventura: `InventoryListPage` → `InventoryDetailPage` (progress + seznam items + tlačítko Dokončit) → `InventoryCountPage` (numpad + volitelný sken materiálu pro ověření, `PUT /inventories/:invId/items/:itemId`)
  - Finish inventury volá `POST /finish-v2` — backend vygeneruje `inventory_adjust` pohyby pro rozdíly a odemkne lokace
  - Picking: `PickingListPage` (open + picking) → `PickingDetailPage` (progress, items sort_order) → `PickingPickPage` (volitelný sken lokace + materiálu, numpad, 0 = skip, < qty = short)
  - Pick je idempotentní přes `client_uuid` (generovaný per session); auto-done navigace zpět při 100 %
  - **Záměrně online-only** — inventura/pick nepoužívá write_queue (jiné endpointy než `/moves`), operátor v provozu je na Wi-Fi. Lze doplnit později.
- **M5 – Service Worker + produkční build + distribuce** ✅
  - `vite-plugin-pwa` (generateSW) — precache app shell, `/api/*` je `NetworkOnly` (IDB je autorita pro offline)
  - Manifest: display standalone, orientation portrait, theme `#1e1e2e`, scope `/pwa/`
  - Ikony generované `@vite-pwa/assets-generator` z jednoho source SVG (`assets/logo.svg`)
  - `PwaUpdatePrompt` komponenta — banner při dostupné nové verzi, klik Obnovit → reload
  - Produkce hostuje HolyOS Express z `/pwa` (přidáno v `app.js`); root `package.json` build chainuje PWA build při Railway deploy
  - Base path `/pwa/` jen v `mode === 'production'`, v dev stále `/`

## Struktura projektu

```
clients/pwa-sklad/
├── index.html
├── package.json
├── vite.config.ts            # /api proxy na VITE_API_PROXY
├── tsconfig.json
├── tsconfig.node.json
├── .env.example              # zkopíruj do .env.local
└── src/
    ├── main.tsx              # React root (AuthProvider > SyncProvider > App)
    ├── App.tsx               # Router
    ├── device.ts             # getDeviceId() — persistentní ID v localStorage
    ├── vite-env.d.ts
    ├── api/
    │   ├── client.ts         # apiFetch, token, X-Device-Id header, 401 handler
    │   ├── inventory.ts      # listInventories, getInventory, updateItem, finish-v2
    │   └── batches.ts        # listBatches, getBatch, pickItem, complete
    ├── auth/
    │   ├── AuthContext.tsx
    │   ├── ProtectedRoute.tsx
    │   └── types.ts
    ├── db/
    │   ├── schema.ts         # IDB v1 schema + types
    │   ├── catalogRepo.ts    # materials + locations: upsert, lookup, counts
    │   ├── queueRepo.ts      # write queue: enqueue, mark*, listPending, ...
    │   └── metaRepo.ts       # key/value (last_sync, ...)
    ├── sync/
    │   ├── catalogSync.ts    # pullMaterials (delta), pullLocations, pullCatalog
    │   ├── queueFlusher.ts   # flushPending — POST /api/wh/moves + dedup handling
    │   ├── lookup.ts         # lookupMaterialByQr + lookupLocationByQr (API → cache fallback)
    │   └── SyncContext.tsx   # sync stav + akce (auto-flush online, auto-pull)
    ├── hooks/
    │   ├── useOnlineStatus.ts
    │   └── useBarcodeScanner.ts    # SUNMI keyboard-wedge listener
    ├── components/
    │   ├── SyncBottomBar.tsx
    │   ├── CameraScanner.tsx
    │   ├── Numpad.tsx              # sdílený numpad (MoveWizard, Inventory, Picking)
    │   ├── PwaUpdatePrompt.tsx     # M5 — banner nová verze / offline ready
    │   └── move-wizard/
    │       ├── MoveWizard.tsx      # orchestrátor: state, submit, success
    │       ├── ScanStep.tsx        # materiál | lokace — hw scan + kamera + input
    │       ├── QuantityStep.tsx    # numpad
    │       ├── ConfirmStep.tsx     # souhrn + potvrdit
    │       ├── SuccessStep.tsx     # online/offline feedback
    │       └── types.ts
    ├── pages/
    │   ├── LoginPage.tsx
    │   ├── DashboardPage.tsx
    │   ├── ReceivePage.tsx
    │   ├── IssuePage.tsx
    │   ├── TransferPage.tsx
    │   ├── InventoryListPage.tsx
    │   ├── InventoryDetailPage.tsx
    │   ├── InventoryCountPage.tsx
    │   ├── PickingListPage.tsx
    │   ├── PickingDetailPage.tsx
    │   ├── PickingPickPage.tsx
    │   └── DebugSyncPage.tsx # /debug — stav, counts, ruční sync/flush, retry
    └── styles/
        └── global.css
```

## PowerShell: rychlý start

Spusť v pořadí v PowerShellu (PS 5.1 i PS 7 fungují):

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba\clients\pwa-sklad

# 1) First run: instalace závislostí
npm install

# 2) Nastav API proxy — buď lokální HolyOS, nebo Railway URL
Copy-Item .env.example .env.local
# .env.local pak edituj:
#   VITE_API_PROXY=http://localhost:3000
#   nebo
#   VITE_API_PROXY=https://<tvuj-railway-host>

# 3) Start dev serveru (HMR)
npm run dev
```

Vite pak vypíše dvě adresy:

- `Local:   http://localhost:5173/` – na notebooku
- `Network: http://192.168.x.y:5173/` – tohle otevři přímo v prohlížeči
  na SUNMI čtečce (musí být ve stejné LAN)

Vite proxuje `/api/*` na `VITE_API_PROXY`, takže z pohledu PWA je to
jeden origin a dev běží bez CORS.

### Produkční build

```powershell
npm run build        # vyplivne clients/pwa-sklad/dist/
npm run preview      # ověření produkčního bundlu lokálně na :4173
```

### Typecheck

```powershell
npm run typecheck
```

## Auth flow

1. `POST /api/auth/login` s `{ username, password }` → `{ token, user }`
2. Token se uloží do `localStorage` pod klíčem `holyos.pwa.token`
3. Každé další volání posílá `Authorization: Bearer <token>`
4. Při mountu aplikace `GET /api/auth/me` ověří, že token je pořád platný
5. 401 z kteréhokoli volání → auto-logout + redirect `/login`

Backend (`middleware/auth.js`) přijímá **i** cookie **i** Bearer — pro PWA
záměrně nepoužíváme cookie: PWA běží na jiném originu (zařízení), a
Bearer token je v tomhle kontextu čistší vzor.

## Produkční úvaha — CORS

`app.js` má `cors({ origin: process.env.CORS_ORIGIN || true, credentials: true })`.
Pokud PWA poběží na jiném originu (např. `https://sklad.bestseries.cz` proti
`https://api.bestseries.cz`), stačí default `true`. Pokud budeme chtít
whitelist, nastaví se `CORS_ORIGIN` na Railway.

`Authorization` header je na wildcard originu povolený bez problému —
jediný potenciální háček by byl preflight OPTIONS, který `cors` balíček
řeší automaticky.

## Smoke checklist (M1)

Po `npm run dev`:

1. `/` → redirect na `/login` (kvůli `ProtectedRoute`)
2. Login chybnými údaji → zobrazí chybu z backendu (`Neplatné přihlašovací údaje`)
3. Login správnými údaji → redirect na `/` s dashboardem a jménem uživatele
4. Dashboard → 5 dlaždic, každá otevře placeholder obrazovku s popiskem M3/M4
5. Tlačítko **Odhlásit** → token zmizí z localStorage, redirect na `/login`
6. Reload stránky po loginu → aplikace sama ověří token přes `/api/auth/me`
7. Zkus vymazat localStorage ručně → příští request dostane 401 a pošle tě na login
8. Na SUNMI čtečce: žádné horizontální skrolování, tlačítka min 48 px, text čitelný bez zoomu

## Smoke checklist (M2)

Po instalaci nové závislosti:

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba\clients\pwa-sklad
npm install      # dotáhne idb
npm run dev
```

V prohlížeči:

1. Po loginu se dashboard chvíli načte a bottom bar ukáže `● Online`.
   Klikni bar → `/debug`.
2. **Katalog** — `Materiály` a `Lokace` by měly mít nenulové counts, a
   *Poslední sync* aktuální čas (během několika sekund po loginu proběhl
   auto-pull). Pokud ne, klikni `Sync teď (delta)`.
3. **Full refresh** přepíše katalog, counts by měly odpovídat celkovému
   `/api/wh/sync/materials?count=` a `/sync/locations`.
4. **Offline režim** — Chrome DevTools → Network → *Offline*. Bottom bar
   přejde na `⌀ Offline`. Ruční flush v `/debug` je disabled.
5. Simulace pending pohybu (dokud nemáme UI z M3): v DevTools console
   spusť
   ```js
   import('/src/db/queueRepo.ts').then(m => m.enqueueMove({
     type: 'receipt', material_id: 1, warehouse_id: 1, quantity: 5
   }));
   ```
   `/debug` okamžitě ukáže 1 ve frontě, bottom bar taky.
6. Zapni síť zpět → auto-flush proběhne, pending zmizí (nebo přejde do
   *Selhalé* pokud backend řekne 400; debug stránka má **Zkusit znovu** /
   **Smazat**).
7. Druhé volání stejného `client_uuid` (resend) → backend vrátí 200 s
   `_deduped: true`; `FlushResult.deduped` += 1.
8. `Device ID` ve spodní debug kartě se mezi reloady nemění (persist přes
   localStorage).

## Smoke checklist (M3)

Po dotažení nových balíčků:

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba\clients\pwa-sklad
npm install      # @zxing/browser + @zxing/library
npm run dev
```

Na dashboardu:

1. Klikni **Příjem** → wizard: `1/4 Naskenujte materiál`. Zkus:
   - Ručně opsat barcode existujícího materiálu do inputu + `Ověřit` → advance
   - Klikni **📷 Kamera** → povolit kameru → namířit na QR → advance
   - Na SUNMI čtečce zmáčkni fyzické tlačítko (keyboard-wedge) → advance
2. Krok `2/4 Naskenujte cílovou lokaci` — stejný flow, location.
3. Krok `3/4` — numpad, zadej např. `5,5`, `Pokračovat`.
4. Krok `4/4` — souhrn s materiálem, množstvím, lokací; klik **Potvrdit pohyb**.
5. Zobrazí se obrazovka úspěchu se zprávou „Pohyb byl odeslán na server."
   V `/debug` bottom baru se pending **nezvýší** (flush byl synchronní).
6. V backendu (HolyOS ➜ modul Sklad 2 nebo přímo `/api/wh/moves?limit=5`)
   by měl být nový pohyb s naším `client_uuid` a `device_id` =
   Device ID z `/debug`.
7. **Výdej** a **Přesun** analogicky — Přesun má 4 skenovací kroky (zdroj + cíl).
8. **Offline test**: DevTools → Network → Offline → projdi wizard. Po potvrzení
   bottom bar ukáže `1 ve frontě`. Zapni síť → auto-flush, pohyb dolet do backendu.
9. **Dedup sanity**: v `/debug` klikni `Odeslat teď`. Výsledek: 0 dedup (už synced).
   Druhý flush při online je no-op.

## Smoke checklist (M4)

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba\clients\pwa-sklad
npm run dev
```

**Inventura** (předpoklad: v HolyOS webu existuje `in_progress` inventura
s položkami — nejlépe přes `POST /api/wh/inventories` + `/start`):

1. Dashboard → **Inventura** → seznam inventur (jen aktivní).
2. Klikni inventuru → detail s progress 0 %, seznam položek (pending).
3. Klikni libovolnou položku → obrazovka *Počítat*: očekávané, numpad, Uložit.
4. Na SUNMI čtečce zkus naskenovat materiál — `✓ název (kód)` potvrdí match,
   jiný materiál zobrazí varování.
5. Ulož → návrat na detail, progress +1, položka je zelená, diff indikátor.
6. Spočítat pár dalších, pak **Dokončit inventuru** → potvrzovací dialog →
   success screen s počtem vygenerovaných adjustačních pohybů + breakdown
   (no_location / no_actual / no_diff).
7. V backendu (`GET /api/wh/moves?type=inventory_adjust&reference_id=<invId>`)
   by měly ležet pohyby s `client_uuid` typu `00000000-0000-4000-8000-{invId:6}{itemId:6}`.

**Picking** (předpoklad: `POST /api/wh/batches` vytvořená dávka s položkami):

1. Dashboard → **Picking** → seznam otevřených (`open` + `picking`).
2. Klikni dávku → detail se sort_order items a progress.
3. Klikni pending položku → obrazovka *Vychystat*: požadované, lokace
   (pokud chybí, musí se nejdřív naskenovat), numpad pre-filled na požadované
   množství.
4. Happy path: klik **Napickovat** (= požadované) → návrat na detail,
   položka „picked", batch přejde `open → picking` při prvním picku.
5. Short path: snížit quantity pod požadované → **Napickovat** → položka „short".
6. Skip: klikni **Přeskočit (0)** → confirm → položka „skipped".
7. Po dokončení všech items → batch auto-done (status `done`), tap na item
   je disabled.
8. Dedup sanity: resend přes stejný `client_uuid` (v DevTools Network replay
   requestu) → backend ho přijme bez duplikace pohybu.

## M5 — Produkční build, ikony, distribuce na SUNMI

### Jednou: vygenerovat ikony

Po doinstalaci balíčků (`npm install`) vygeneruj PNG ikony z `assets/logo.svg`:

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba\clients\pwa-sklad
npm install
npm run generate-pwa-assets
```

V `public/` se objeví `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`,
`maskable-icon-512x512.png`, `apple-touch-icon.png`, `favicon.ico`.
Commit tyhle soubory do gitu — generují se deterministicky, ale nechceme
je pouštět při každém deploy.

### Produkční build (lokální ověření)

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba\clients\pwa-sklad
npm run build       # → dist/ s base '/pwa/', sw.js, manifest, precache
npm run preview     # spustí produkční bundle lokálně, default port 4173
```

Otevři http://localhost:4173/pwa/ — mělo by jet jako produkce (SW aktivní,
offline shell funkční po prvním loadu).

### Produkce přes Railway

Root `package.json` má nyní `build` skript, který chainuje:

```
npx prisma generate
  && npm --prefix clients/pwa-sklad ci
  && npm --prefix clients/pwa-sklad run build
```

Při `railway up` tak `clients/pwa-sklad/dist/` vznikne přímo na buildu a
HolyOS Express ho servuje pod `/pwa`. Stačí deploy HolyOS:

```powershell
cd C:\Users\Tomáš\Projekty\Výroba\Výroba
railway up
```

Po nasazení je PWA na **https://app.holyos.cz/pwa/**.

### Install na SUNMI L2H

Na čtečce:

1. Otevři Chrome → **https://app.holyos.cz/pwa/**
2. Chrome menu (⋮) → **Add to Home screen** → potvrď jméno „Sklad"
3. Launcher dostane ikonu, start otevře app v standalone režimu (bez URL baru)
4. První spuštění: přihlášení → čeká pár sekund na initial pull katalogu
   (bottom bar ukáže `● Online` a counts v `/debug`)
5. Od teď funguje i offline — pohyb se zapíše do write queue, auto-flush
   proběhne při návratu online

### Smoke checklist (M5)

Po `railway up` s novým buildem:

1. `https://app.holyos.cz/pwa/` se načte, DevTools → Application → Service
   Workers → `sw.js` je `activated and is running`.
2. Application → Manifest: vidíš jméno, ikony, display `standalone`.
3. Application → Cache Storage → precache obsahuje app shell (JS/CSS/HTML).
4. Network tab → volání `/api/auth/login` prochází přes SW jako `NetworkOnly`
   (SW header je vidět, ale cache nevzniká).
5. Install dialog se objeví (adresní řádek, ikona „install app") — instalace
   přidá ikonu na plochu.
6. Vydej nový build (změň něco v UI, `railway up` znova) → otevři PWA →
   během pár sekund se objeví `Je dostupná nová verze` banner →
   **Obnovit** → reload s novou verzí.
7. Offline režim (DevTools → Network → Offline): aplikace se pořád spouští
   (offline shell), `/api/*` volání failují a flow write queue se chová
   jak z M2.

## Kam dál

- Rozšíření write_queue na inventuru/pick — pro skutečný offline flow
  mimo WiFi (scope cca +1 milník)
- Push notifications pro dávky k vychystání (pokud je potřeba)
- Sériová čísla, šarže, FIFO (zbývající odložené položky z briefu)
