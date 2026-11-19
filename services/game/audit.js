// =============================================================================
// Laundromat Tycoon — kdo kdy přišel o kus firmy a proč
// =============================================================================
// Podíly se dnes mění na deseti místech: prodej, odkup, převod na třetího,
// kapitálový vstup, konverze půjčky, propadlá zástava, veřejná nabídka,
// dražba. Po každé takové změně zůstane v databázi jen nový stav — ne to,
// co bylo předtím. Když se hráč zeptá, kam se poděla pětina jeho firmy,
// nemáme co otevřít.
//
// Tenhle modul to zapisuje. Ne po jednotlivých řádcích, ale OTISKEM před
// a po: na začátku transakce se sejme, kdo ve firmě kolik drží, na konci
// znovu, a rozdíl se zapíše. Důvod, proč takhle:
//
//   Ředění se jinak neuhlídá. Kapitálový vstup sáhne na podíly všech
//   dosavadních investorů najednou — kdyby se zapisovalo u každého
//   update zvlášť, stačilo by na jeden zapomenout a chyběl by právě tam,
//   kde se někomu ubralo bez jeho vědomí.
//
//   Nové způsoby změny se nemusí dopisovat. Kdo příště přidá další cestu,
//   jak podíl převést, dostane zápis zadarmo — pokud otisk obalí kolem
//   své transakce.
//
// Zapisuje se UVNITŘ transakce schválně: buď se převod i jeho záznam
// stanou oba, nebo ani jeden. Audit, který může chybět, není audit.

'use strict';

const DRZ = require('./drzitel');

// Kdo ve firmě kolik drží. Mapa držitel → podíl, sečtená na držitele,
// protože jeden držitel může mít víc řádek.
//
// Klíčuje se klíčem držitele ('h:17', 'f:3'), ne investor_id. Dokud se tu
// četlo investor_id naprímo, spadly všechny fondové podíly do jediného koše
// pod klíčem null — dva různé fondy v jedné firmě se slévaly v jeden
// a zápis pak padal na NOT NULL, protože žádné investor_id neexistovalo.
async function otisk(tx, firmaId) {
  const rows = await tx.gameEquity.findMany({
    where: { firma_id: firmaId, stav: 'bezi' },
    select: { investor_id: true, fond_id: true, podil: true },
  });
  return DRZ.soucet(rows);
}

// Rozdíl dvou otisků. Vrací jen to, co se doopravdy pohnulo — drobné
// odchylky z plovoucí čárky nejsou změna vlastnictví.
const PRAH = 1e-9;
function zmeny(pred, po) {
  const out = [];
  const vsichni = new Set(Array.from(pred.keys()).concat(Array.from(po.keys())));
  vsichni.forEach((k) => {
    const a = pred.get(k) || 0;
    const b = po.get(k) || 0;
    if (Math.abs(b - a) > PRAH) out.push({ drzitel: k, pred: a, po: b });
  });
  // Řadí se podle klíče, který je řetězec — číselné odečítání by tu dávalo
  // NaN a pořadí by záviselo na tom, jak se mapa zrovna probírá.
  return out.sort((x, y) => String(x.drzitel).localeCompare(String(y.drzitel)));
}

// Zápis rozdílu. Volá se na konci transakce, se stejným tx.
async function zapis(tx, firmaId, pred, info) {
  const po = await otisk(tx, firmaId);
  const l = zmeny(pred, po);
  if (!l.length) return 0;
  await tx.gameVlastnictvi.createMany({
    data: l.map((z) => ({
      firma_id: firmaId,
      // Klíč zpátky na sloupce. Držitel bez platného klíče se sem nedostane:
      // soucet() takový řádek vůbec nezapočítá.
      investor_id: (DRZ.zKlice(z.drzitel) || {}).typ === 'hrac'
        ? DRZ.zKlice(z.drzitel).id : null,
      fond_id: (DRZ.zKlice(z.drzitel) || {}).typ === 'fond'
        ? DRZ.zKlice(z.drzitel).id : null,
      podil_pred: z.pred,
      podil_po: z.po,
      duvod: String((info && info.duvod) || '?').slice(0, 16),
      trade_id: (info && info.trade_id) || null,
      protistrana_id: (info && info.protistrana_id) || null,
    })),
  });
  return l.length;
}

module.exports = { otisk, zmeny, zapis, PRAH };
