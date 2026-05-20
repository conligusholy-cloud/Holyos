# Jak přidat kolegu do TestFlight (pro Tomáše)

Aby kolega dostal Velín na svůj iPhone, musíš ho přidat do **TestFlight skupiny „Team (Expo)"** v App Store Connect. Postup zabere asi **2 minuty na kolegu**.

## Krok 1: Získej od kolegy jeho Apple ID e-mail

Řekni mu, ať se na iPhonu podívá:
- **Nastavení** → klepni na **jeho jméno úplně nahoře**
- Pod jménem je **e-mailová adresa** — to je jeho Apple ID
- Pošli ti tu adresu (např. WhatsAppem, mailem, papírem)

> ⚠️ Pozor: musí to být přesně ta adresa, kterou má na iPhonu jako Apple ID. Ne pracovní mail, pokud Apple ID je osobní gmail.

## Krok 2: Přidej kolegu v App Store Connect

1. Otevři **https://appstoreconnect.apple.com/access/users**
2. Přihlas se (`holyto@atlas.cz`)
3. Klikni modré **„+ Pozvat uživatele"** (vlevo nahoře)
4. Vyplň:
   - **First name:** křestní jméno kolegy
   - **Last name:** příjmení
   - **Email:** ten Apple ID e-mail co ti kolega dal
   - **Roles:** zaškrtni **Developer** (minimum nutné pro TestFlight tester)
   - **Apps:** ponech default (Access to all apps)
5. **Pozvat**

Apple pošle kolegovi pozvánku na jeho e-mail s názvem *„You're invited to App Store Connect"*. Musí ji **přijmout** (klepne odkaz v e-mailu → akceptuje podmínky).

## Krok 3: Přidej kolegu do TestFlight skupiny „Team (Expo)"

1. V App Store Connect přejdi na **Velín** → záložka **TestFlight**
2. V left sidebar pod **INTERNAL TESTING** klepni na **Team (Expo)**
3. Klepni záložku **Testers**
4. Klikni **+ Add Testers** (vpravo nahoře)
5. V dialogu zaškrtni kolegu (uvidíš ho v seznamu, pokud krok 2 dokončil)
6. **Add**

Kolega dostane druhý e-mail od TestFlight: **„Tomáš invited you to test Velín on TestFlight"**. Z tohoto e-mailu už pokračuje podle [INSTALACE_PRO_KOLEGY.md](./INSTALACE_PRO_KOLEGY.md).

## Krok 4: Ujisti se, že má HolyOS účet

Kolega potřebuje **HolyOS přihlašovací jméno + heslo**, jinak se v Velínu nepřihlásí.

V HolyOS webu:
1. `https://app.holyos.cz` → modul **Lidé a HR**
2. Najdi kolegu — musí být v seznamu jako **Person**
3. Klikni úpravu — v detailu musí mít **přiřazený User** (uživatelský účet)
4. Pokud nemá User: klikni „Vytvořit účet" → nastav username + heslo
5. Pošli mu credentials (best practice: heslo mu řekni ústně, ne mailem)

## Co celé znamená dohromady

Kolega potřebuje **TŘI věci**:
1. **Apple ID** — má (každý iPhone uživatel)
2. **Pozvánku do TestFlight** — odešleš mu skrz kroky 2-3 výše
3. **HolyOS účet (User + Person)** — odešleš mu skrz krok 4

Pokud má všechny tři, instalace Velína mu zabere 3 minuty (podle [INSTALACE_PRO_KOLEGY.md](./INSTALACE_PRO_KOLEGY.md)).

## Při novém buildu (každé ~2 měsíce)

Když postavíš novou verzi Velína (`eas build` + `eas submit`):
- Apple processing zpracuje build (~10 min)
- TestFlight **automaticky** propojí build se skupinou Team (Expo)
- **Všichni kolegové, kteří už jsou v Team (Expo), dostanou push** „Velín 0.1.x dostupný"
- Kolega v TestFlightu klepne Aktualizovat → bez dalšího setupu

Nemusíš opakovaně pozvánky posílat — stačí kolegu jednou přidat, zůstává tam navždy.

## Limity

- **Internal Testing skupina:** max 100 testerů (více než dost pro Best Series)
- **TestFlight builds:** každý platí 90 dnů od uploadu, pak musíš rebuild
- **External Testing (10 000 testerů, public link):** vyžaduje Apple review prvního buildu (~24 h), pak rychle. Pro Velín nepotřebujeme — Internal stačí.

---

— *Tomáš Holý · Velín admin · `holyto@atlas.cz`*
