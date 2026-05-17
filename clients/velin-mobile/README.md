# Velín — mobilní klient HolyOS

Kapesní HolyOS pro každého kolegu. Velín dostane denní plán, doručí úkoly přes push, vede chat nad úkolem, sbírá zpětnou vazbu a docházku přes GPS fence.

## Stack

- **Expo SDK 51** (React Native 0.74) + TypeScript
- `@react-navigation/native` + `@react-navigation/bottom-tabs` — bez expo-router, přímá kontrola nad navigací
- `expo-secure-store` — JWT a profile v Keychainu (iOS) / EncryptedSharedPreferences (Android)
- `expo-notifications` — push přes Expo Push API (běží i bez EAS, ale produkční push z exp.host musí mít EAS build)

## Spuštění lokálně

```bash
cd clients/velin-mobile
npm install
npm start
```

Otevře se Expo Dev Tools v prohlížeči s QR kódem. Naskenuj telefonem v aplikaci Expo Go (App Store / Google Play).

### API base

Velín čte `apiBase` z `app.json` (`extra.apiBase`). Výchozí: `https://app.holyos.cz`.

Pro lokální vývoj proti HolyOS běžícímu na PC:

1. Najdi LAN IP svého PC: `ipconfig` → IPv4 (např. `192.168.1.42`)
2. V `app.json` přepiš `extra.apiBase` na `http://192.168.1.42:3000`
3. Telefon i PC musí být na stejné Wi-Fi
4. HolyOS server musí poslouchat na `0.0.0.0`, ne jen `localhost` (defaultně OK)

Nepoužívat `localhost` — z telefonu by to vedlo na samotný telefon, ne na PC.

## Aktivace zařízení — flow

1. Kolega si stáhne Velín (Expo Go pro test, později EAS build z App Store / Google Play).
2. Spustí ho → obrazovka Login → zadá HolyOS uživatelské jméno + heslo.
3. App pošle credentials na `/api/auth/login` → dostane JWT.
4. App si vyžádá oprávnění k notifikacím (iOS dialog, Android auto).
5. App získá Expo push token a pošle ho na `/api/velin/devices/register` se získaným JWT.
6. Backend vytvoří `DeviceRegistration` pro Person přihlášeného Usera.
7. App skočí na Tabs → MyDay → fetch `/api/velin/my-day`.

Při restartu aplikace se neptá znova — pokud JWT v SecureStore drží, jde rovnou na MyDay. Po expiraci (24 h default) volání `/me` vrátí 401 → JWT smaže → Login.

## Důležité pro push

- **Expo Go**: získání push tokenu funguje, ale produkční push z exp.host se na něj nedoručí (Apple/Google to blokují). Pro reálný end-to-end test musíš udělat EAS dev build.
- **Simulátor / emulátor**: push nefunguje (Apple/Google to nepodporují). Vždy testovat na fyzickém zařízení.
- **iOS**: vyžaduje Apple Developer Account ($99/rok) pro EAS build a publikování.
- **Android**: `eas build` zvládne bez Google Play účtu, jen pro publikování na Play Store potřebuješ ($25 jednorázově).

### EAS dev build (až bude potřeba reálný push)

```bash
npm install -g eas-cli
eas login
eas init        # vytvoří project, doplní extra.eas.projectId do app.json
eas build --profile development --platform android   # nebo ios
```

EAS build pošle APK / IPA → instaluje se přes Expo Orbit / TestFlight / direct download.

## Struktura

```
clients/velin-mobile/
├── App.tsx                  # Root navigace
├── app.json                 # Expo config (název, ikona, apiBase, permissions)
├── package.json
├── tsconfig.json
├── babel.config.js
├── screens/
│   ├── Gate.tsx             # Startovní rozcestník (JWT check)
│   ├── Login.tsx            # HolyOS přihlášení
│   ├── MyDay.tsx            # Dnešní plán + úkoly
│   └── Me.tsx               # Profil + odhlášení
└── lib/
    ├── api.ts               # Fetch wrapper, typed endpointy
    ├── auth.ts              # SecureStore (JWT, person_id, displayName)
    ├── push.ts              # Expo notifications + token registration
    └── theme.ts             # Barvy, spacing, radius
```

## Asset placeholder

`app.json` referencuje `./assets/icon.png`, `splash.png`, `adaptive-icon.png` a `notification-icon.png`. Vygeneruj je až bude potřeba (`npx expo prebuild` nebo manuálně). Bez nich Expo CLI varuje, ale spustí.

Doporučená velikost ikony: 1024×1024 PNG (transparentní pozadí pro adaptive icon).

## Co dál (Fáze 1+)

- **Fáze 1** — Detail úkolu (Accept / Start / Block / Complete), chat nad úkolem, foto z výroby
- **Fáze 2** — Večerní reflexe (mood, energy, wins, struggles)
- **Fáze 3** — Docházka přes GPS fence (background location)
- **Fáze 4** — Integrace s plánovačem prádlomatů (norma TAC+Tpz se promítne do `estimated_min`)
- **Fáze 5** — AI dispečer Mistr autonomně rozděluje úkoly

Detaily v paměti: `holyos_velin_iniciativa.md`.
