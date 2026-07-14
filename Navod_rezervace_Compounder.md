# Rezervace lokality Compounder — jak to funguje (od rezervace po zaplacení faktury)

Jednoduchý průvodce procesem pro obchodníky. Popisuje, co dělá **zákazník** v portálu a co děláš **ty v HolyOS**, včetně lhůt a stavů.

> Ceny jsou uvedené **bez DPH**. Časy a lhůty níže jsou výchozí — dají se změnit v nastavení (⚙️) modulu Compounding.

---

## Stavy rezervace ve zkratce

| Stav | Co znamená | Pro ostatní zákazníky |
|------|------------|------------------------|
| **Blokace (hold)** | Zákazník klikl „Rezervovat", drží se mu místo 1 h | „Obsazeno" + odpočet |
| **Rezervováno** | Vyplnil údaje a potvrdil, čeká se na podpis a poplatek | „Obsazeno" |
| **Aktivní** | Rezervační poplatek zaplacen, čeká se na kupní smlouvu a doplacení | „Obsazeno" |
| **Dokončeno** | Kupní cena zaplacena — lokalita prodána | — |
| **Zrušeno / vypršelo** | Ruční zrušení nebo nedodržení lhůty | Lokalita se uvolní |

---

## Proces krok za krokem

### 1) Zákazník klikne „Rezervovat" (portál → Investor)
Vybere lokalitu a klikne **Rezervovat**. Tím se mu místo **zablokuje na 1 hodinu** (blokace/hold). Ostatní u té lokality uvidí **„Obsazeno"** s odpočtem, kolik času zbývá.

### 2) Zákazník vyplní údaje a potvrdí rezervaci
Zadá **hlavičku** (jméno/firma, IČO, adresa) a **počet dní** rezervace. Po potvrzení je stav **Rezervováno** a spočítají se lhůty:

- **Rezervační poplatek** = počet dní × **20 000 Kč/den** (výchozí sazba).
- **Podpis rezervační smlouvy** do **1 dne**.
- **Zaplacení poplatku** do **1 dne po podpisu**.
- **Rezervační doba** = počet zvolených dní (dokdy musí proběhnout kupní smlouva).

➡️ V tu chvíli přijde **Janovi a Tomášovi (a přiřazenému obchodníkovi) upozornění do Velína** (push + zvonek).

### 3) Rezervační smlouva
Se zákazníkem se **podepíše rezervační smlouva** (do lhůty pro podpis). Smlouvu vygeneruje HolyOS.

### 4) Rezervační poplatek — faktura
Zákazník dostane fakturu na rezervační poplatek a **zaplatí ji** ve lhůtě.
Jakmile poplatek přijde na účet, v HolyOS u rezervace klikneš na **„Poplatek přišel"**.
→ Stav se změní na **Aktivní**. Lokalita zůstává blokovaná po celou rezervační dobu.

### 5) Kupní smlouva + kupní cena — faktura
Během rezervační doby se uzavře **kupní smlouva** a zákazník dostane fakturu na **kupní cenu**.
Jakmile kupní cena přijde na účet, klikneš na **„Kupní cena přišla"**.
→ Stav se změní na **Dokončeno** — lokalita je prodaná. ✅

---

## Kde to najdeš v HolyOS
**Prodejní objednávky → Compounder / přehled rezervací.** V tabulce rezervací vidíš u každé lokalitu, kupujícího, poplatek, kupní cenu, stav a lhůty. Tlačítka podle stavu:

- Stav **Rezervováno** → **„Poplatek přišel"** (nebo „Zrušit").
- Stav **Aktivní** → **„Kupní cena přišla"** (nebo „Zrušit").

Platby se zatím **označují ručně** (potvrzení, že faktura byla zaplacena). Automatické párování s bankovním výpisem se připravuje.

---

## Když se lhůta nedodrží nebo rezervace zruší
- Nezaplacený **poplatek** do lhůty → rezervace **vyprší** a lokalita se uvolní.
- Nezaplacená **kupní cena** do konce rezervační doby → **vyprší** a uvolní se.
- Rezervaci můžeš kdykoli **ručně zrušit** tlačítkem „Zrušit".
- Po zrušení/vypršení si stejný zákazník může tutéž lokalitu rezervovat znovu až **za 2 dny**.

---

*Interní návod Best Series — Compounder. Konkrétní částky a lhůty se řídí nastavením (⚙️) modulu Compounding a mohou se lišit.*
